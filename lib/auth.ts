// ---------------------------------------------------------------------------
// SYNTHOS — real identity: users, password hashing, session tokens.
//
// No external identity platform, no OAuth/SAML, no fabricated SSO claim —
// this is the smallest secure local mechanism that fits an app with no
// prior identity model at all. Node's built-in crypto.scrypt is a real,
// strong KDF; no bcrypt/argon2 dependency is needed to get one.
//
// Nothing here ever persists a secret in recoverable form:
//   - password_hash/password_salt are a scrypt digest + its salt, never
//     the plaintext password.
//   - user_sessions.token_hash is sha256(raw token). The raw token is
//     generated once, handed to the caller (to become an HttpOnly cookie
//     value), and never stored anywhere. A stolen database backup cannot
//     be used to forge a session.
//
// Pure module (no server.ts import), so it's importable directly in tests
// without triggering server.ts's self-executing startServer().
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from './persistence';

export interface UserRecord {
  user_id: string;
  email: string;
  display_name: string;
  platform_role: 'platform_admin' | 'standard';
  status: 'active' | 'disabled' | 'setup_required';
  created_at: string;
  updated_at: string;
}

interface UserRow extends UserRecord {
  password_hash: string;
  password_salt: string;
}

export interface SessionRecord {
  session_id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

const SCRYPT_KEYLEN = 64;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function toUserRecord(row: UserRow): UserRecord {
  return {
    user_id: row.user_id,
    email: row.email,
    display_name: row.display_name,
    platform_role: row.platform_role,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

/** True only if no user has ever been created — gates the one-time bootstrap endpoint. */
export function anyUserExists(): boolean {
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n > 0;
}

export function createUser(params: {
  email: string;
  password: string;
  displayName: string;
  platformRole?: 'platform_admin' | 'standard';
}): UserRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const userId = `user-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const { hash, salt } = hashPassword(params.password);
  const normalizedEmail = params.email.trim().toLowerCase();

  db.prepare(`
    INSERT INTO users (user_id, email, display_name, password_hash, password_salt, platform_role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(userId, normalizedEmail, params.displayName, hash, salt, params.platformRole || 'standard', now, now);

  return { user_id: userId, email: normalizedEmail, display_name: params.displayName, platform_role: params.platformRole || 'standard', status: 'active', created_at: now, updated_at: now };
}

/**
 * Admin-created account, awaiting first login (Pass IV / D2). No email is
 * ever sent — this codebase has no mail infrastructure. The account gets a
 * real password hash of a random, internally-generated, immediately
 * discarded string (never the empty string, never a guessable default) —
 * login is cryptographically impossible until the recipient completes
 * setup via a real one-time token (see createSetupToken). Status
 * 'setup_required' keeps it out of both `login()` and `resolveSessionUser`
 * (both already reject any non-'active' status).
 */
export function createPendingUser(params: {
  email: string;
  displayName: string;
  platformRole?: 'platform_admin' | 'standard';
}): UserRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const userId = `user-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const unguessablePlaceholder = crypto.randomBytes(32).toString('hex');
  const { hash, salt } = hashPassword(unguessablePlaceholder);
  const normalizedEmail = params.email.trim().toLowerCase();

  db.prepare(`
    INSERT INTO users (user_id, email, display_name, password_hash, password_salt, platform_role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'setup_required', ?, ?)
  `).run(userId, normalizedEmail, params.displayName, hash, salt, params.platformRole || 'standard', now, now);

  return { user_id: userId, email: normalizedEmail, display_name: params.displayName, platform_role: params.platformRole || 'standard', status: 'setup_required', created_at: now, updated_at: now };
}

const SETUP_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export interface SetupTokenResult {
  rawToken: string;
  expiresAt: string;
}

/** Creates a real one-time setup token. The raw value is returned exactly once — only its hash is ever stored. */
export function createSetupToken(userId: string): SetupTokenResult {
  const db = getDatabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS).toISOString();
  const rawToken = crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenId = `setup-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  db.prepare(`
    INSERT INTO setup_tokens (token_id, user_id, token_hash, created_at, expires_at, used_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL)
  `).run(tokenId, userId, tokenHash, nowIso, expiresAt);

  return { rawToken, expiresAt };
}

interface SetupTokenRow {
  token_id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

/** Real validation: exists, unused, unrevoked, unexpired. Returns the associated (still setup_required) user, or null. */
export function resolveSetupToken(rawToken: string | undefined | null): UserRecord | null {
  if (!rawToken) return null;
  const db = getDatabase();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const token = db.prepare('SELECT * FROM setup_tokens WHERE token_hash = ?').get(tokenHash) as SetupTokenRow | undefined;
  if (!token) return null;
  if (token.used_at || token.revoked_at) return null;
  if (new Date(token.expires_at).getTime() <= Date.now()) return null;

  const user = getUserById(token.user_id);
  if (!user || user.status !== 'setup_required') return null;
  return user;
}

/**
 * Completes onboarding: sets a real password, activates the account, marks
 * the token used (single-use, enforced at read time above too), and logs
 * the user in immediately (D4: "user completes password setup -> user
 * logs in" is one step). Returns null if the token is invalid for any
 * reason — never partially applies a setup.
 */
export function completeSetup(rawToken: string, password: string): { user: UserRecord; rawSessionToken: string; session: SessionRecord } | null {
  const user = resolveSetupToken(rawToken);
  if (!user) return null;

  const db = getDatabase();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = new Date().toISOString();
  const { hash, salt } = hashPassword(password);

  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, status = ?, updated_at = ? WHERE user_id = ?')
    .run(hash, salt, 'active', now, user.user_id);
  db.prepare('UPDATE setup_tokens SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);

  const loginResult = login(user.email, password);
  if (!loginResult) return null; // should be unreachable — password was just set
  return { user: loginResult.user, rawSessionToken: loginResult.rawToken, session: loginResult.session };
}

export function getUserByEmail(email: string): UserRow | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as UserRow | undefined;
  return row || null;
}

export function getUserById(userId: string): UserRecord | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as UserRow | undefined;
  return row ? toUserRecord(row) : null;
}

export function listUsers(): UserRecord[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[];
  return rows.map(toUserRecord);
}

/**
 * Returns null if the user doesn't exist, or an object with `error` set if
 * disabling would remove the last active platform_admin (same
 * unrecoverable-lockout risk as demoting the last admin — see
 * setPlatformRole). Enabling a user never has this restriction.
 */
export function setUserStatus(userId: string, status: 'active' | 'disabled'): { user?: UserRecord; error?: string } | null {
  const user = getUserById(userId);
  if (!user) return null;

  if (status === 'disabled' && user.platform_role === 'platform_admin' && user.status === 'active' && countActivePlatformAdmins() <= 1) {
    return { error: 'Cannot disable the last active platform administrator.' };
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE user_id = ?').run(status, now, userId);
  return { user: getUserById(userId)! };
}

/** How many active platform_admin accounts currently exist — used to guard the last-admin invariant. */
export function countActivePlatformAdmins(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE platform_role = 'platform_admin' AND status = 'active'").get() as { n: number };
  return row.n;
}

export interface RoleChangeResult {
  success: boolean;
  user?: UserRecord;
  error?: string;
}

/**
 * Changes a user's platform role. Refuses (rather than silently allowing)
 * any change that would leave zero active platform_admin accounts — with
 * no email/SSO recovery path in this codebase, that would be an
 * unrecoverable lockout, not just an inconvenience.
 */
export function setPlatformRole(userId: string, role: 'platform_admin' | 'standard'): RoleChangeResult {
  const user = getUserById(userId);
  if (!user) return { success: false, error: 'User not found.' };
  if (user.platform_role === role) return { success: true, user };

  if (user.platform_role === 'platform_admin' && role === 'standard') {
    if (user.status === 'active' && countActivePlatformAdmins() <= 1) {
      return { success: false, error: 'Cannot remove the last active platform administrator.' };
    }
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET platform_role = ?, updated_at = ? WHERE user_id = ?').run(role, now, userId);
  return { success: true, user: getUserById(userId)! };
}

/**
 * Verifies credentials and, if valid, creates a real session. Returns null
 * on any failure — the caller must use one generic "invalid credentials"
 * message for every failure mode (unknown email, wrong password, disabled
 * account) so a login attempt can never be used to enumerate real emails.
 */
export function login(email: string, password: string): { user: UserRecord; rawToken: string; session: SessionRecord } | null {
  const row = getUserByEmail(email);
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (!verifyPassword(password, row.password_hash, row.password_salt)) return null;

  const db = getDatabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const rawToken = crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const sessionId = `sess-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  db.prepare(`
    INSERT INTO user_sessions (session_id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(sessionId, row.user_id, tokenHash, nowIso, expiresAt, nowIso);

  return {
    user: toUserRecord(row),
    rawToken,
    session: { session_id: sessionId, user_id: row.user_id, created_at: nowIso, expires_at: expiresAt, last_seen_at: nowIso, revoked_at: null },
  };
}

/**
 * Resolves a raw session token (from the request cookie) to the real,
 * currently-authenticated user — or null if the token is unknown,
 * expired, or revoked. Never trusts anything except this server-side
 * lookup; the token itself carries no embedded claims to verify locally
 * (no JWT-style "trust the signature" shortcut — every request does a
 * real revocation-aware database check).
 */
export function resolveSessionUser(rawToken: string | undefined | null): UserRecord | null {
  if (!rawToken) return null;
  const db = getDatabase();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const session = db.prepare('SELECT * FROM user_sessions WHERE token_hash = ?').get(tokenHash) as SessionRecord | undefined;
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  const userRow = db.prepare('SELECT * FROM users WHERE user_id = ?').get(session.user_id) as UserRow | undefined;
  if (!userRow || userRow.status !== 'active') return null;

  db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE session_id = ?').run(new Date().toISOString(), session.session_id);
  return toUserRecord(userRow);
}

export function revokeSessionByToken(rawToken: string | undefined | null): void {
  if (!rawToken) return;
  const db = getDatabase();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), tokenHash);
}

export const SESSION_COOKIE_NAME = 'synthos_session';

/** Minimal, dependency-free cookie header parser — reads only what this app needs. */
export function parseCookies(cookieHeader: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}
