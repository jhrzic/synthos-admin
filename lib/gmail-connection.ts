// ---------------------------------------------------------------------------
// TOOL PACK 2 — Gmail account connections, workspace-scoped.
//
// WHAT THIS IS
// The credential boundary for Gmail. It stores one or more connected Google
// accounts per workspace, keeps their OAuth tokens encrypted at rest, refreshes
// an access token when it has expired, and answers "is this workspace connected,
// and to which accounts".
//
// WHAT IT IS NOT
// Not a second credential store. It reuses the SAME AES-256-GCM helper
// (lib/voice-credentials.ts) that lib/model-credentials.ts uses, keyed the same
// way. What differs is the SCOPE, and that difference is deliberate: a model
// API key is platform-level because SynthOS pays for it, whereas a Gmail
// account belongs to the workspace that connected it. Putting a mailbox in a
// provider-keyed global table would have made every workspace share one inbox.
//
// ---------------------------------------------------------------------------
// TOKENS NEVER LEAVE THIS MODULE IN PLAINTEXT
// ---------------------------------------------------------------------------
// The only function that returns a usable access token is
// resolveAccessToken(), which lib/gmail-client.ts calls immediately before an
// HTTP request. Every other export returns a REDACTED view: the account email,
// the status, the scopes, timestamps. There is no getter for a refresh token,
// no route that serialises one, and GmailConnectionView (the safe projection)
// has no field that could carry one — so "do not expose OAuth tokens" is a
// property of the types, not a rule someone has to remember at each call site.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from './persistence';
import { encryptVoiceSecret, decryptVoiceSecret } from './voice-credentials';
import { scrubSecrets } from './redact';

export type GmailConnectionStatus = 'CONNECTED' | 'NEEDS_REAUTH' | 'REVOKED';

/**
 * The ONLY shape a connection is exposed as outside this module.
 *
 * Note what is absent: no refresh token, no access token, not even a boolean
 * hinting at their contents beyond whether one is present at all. A route can
 * serialise this object wholesale and cannot leak a secret by doing so.
 */
export interface GmailConnectionView {
  connectionId: string;
  workspaceId: string;
  accountEmail: string;
  scopes: string[];
  status: GmailConnectionStatus;
  connectedByUserId: string;
  /** Whether a refresh token exists. Never the token. */
  hasRefreshToken: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  connection_id: string;
  workspace_id: string;
  account_email: string;
  refresh_token_encrypted: string | null;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
  scopes: string;
  status: GmailConnectionStatus;
  connected_by_user_id: string;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Scopes this build actually needs. Narrow on purpose — see the note below. */
export const GMAIL_REQUIRED_SCOPES = [
  // Read metadata and message bodies.
  'https://www.googleapis.com/auth/gmail.readonly',
  // Create drafts.
  'https://www.googleapis.com/auth/gmail.compose',
  // Send.
  'https://www.googleapis.com/auth/gmail.send',
] as const;

// Deliberately NOT requested: gmail.modify (would permit label and read-state
// changes), gmail.settings.* (filters, forwarding — standing configuration a
// compromise could use to redirect mail silently), or the full `mail.google.com`
// scope. Tool Pack 2 reads, drafts and sends; nothing it does needs the ability
// to reconfigure the mailbox, and a token that cannot do a thing is the only
// reliable way to guarantee it will not.

function toView(row: Row): GmailConnectionView {
  return {
    connectionId: row.connection_id,
    workspaceId: row.workspace_id,
    accountEmail: row.account_email,
    scopes: row.scopes ? row.scopes.split(' ').filter(Boolean) : [],
    status: row.status,
    connectedByUserId: row.connected_by_user_id,
    hasRefreshToken: !!row.refresh_token_encrypted,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// OAuth client configuration — environment only.
//
// The client id and secret identify the SynthOS application, not a user, so
// they are deployment configuration rather than per-workspace data. They are
// read from the environment and never stored in the database, because a value
// that lives in exactly one place cannot drift out of sync with itself.
// ---------------------------------------------------------------------------

export function gmailOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim() && !!(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
}

/** Overridable for tests, exactly as GITHUB_API_BASE_URL already is. */
export function gmailApiBase(): string {
  return (process.env.GMAIL_API_BASE_URL || 'https://gmail.googleapis.com').replace(/\/+$/, '');
}

export function googleTokenEndpoint(): string {
  return (process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// READS — every one takes a workspaceId. There is no unscoped variant.
// ---------------------------------------------------------------------------

export function listWorkspaceGmailConnections(workspaceId: string): GmailConnectionView[] {
  const rows: any = getDatabase()
    .prepare('SELECT * FROM gmail_connections WHERE workspace_id = ? ORDER BY created_at ASC')
    .all(workspaceId);
  return (rows || []).map(toView);
}

/**
 * Resolve one connection by workspace and account.
 *
 * `accountEmail` is optional: with one connected account the caller need not
 * name it. With several it MUST, because "send from the workspace's Gmail" is
 * ambiguous the moment there are two, and guessing would mean sending from an
 * account the approver did not authorize.
 */
export type GmailResolveFailureCode = 'NONE' | 'AMBIGUOUS' | 'NOT_FOUND' | 'NOT_USABLE';

export type GmailResolveOutcome =
  | { ok: true; connection: GmailConnectionView; reason?: undefined; code?: undefined }
  | { ok: false; connection?: undefined; reason: string; code: GmailResolveFailureCode };

export function resolveGmailConnection(
  workspaceId: string,
  accountEmail?: string | null,
): GmailResolveOutcome {
  const all = listWorkspaceGmailConnections(workspaceId);
  const usable = all.filter((c) => c.status === 'CONNECTED');

  if (accountEmail && accountEmail.trim()) {
    const wanted = accountEmail.trim().toLowerCase();
    const found = all.find((c) => c.accountEmail.toLowerCase() === wanted);
    if (!found) {
      return { ok: false, code: 'NOT_FOUND', reason: `No Gmail account "${accountEmail}" is connected to this workspace.` };
    }
    if (found.status !== 'CONNECTED') {
      return { ok: false, code: 'NOT_USABLE', reason: `Gmail account "${found.accountEmail}" is ${found.status}${found.lastError ? `: ${found.lastError}` : '.'}` };
    }
    return { ok: true, connection: found };
  }

  if (usable.length === 0) {
    return {
      ok: false,
      code: 'NONE',
      reason: all.length === 0
        ? 'No Gmail account is connected to this workspace.'
        : `No usable Gmail account: ${all.map((c) => `${c.accountEmail} is ${c.status}`).join(', ')}.`,
    };
  }
  if (usable.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS',
      reason: `This workspace has ${usable.length} connected Gmail accounts (${usable.map((c) => c.accountEmail).join(', ')}). Name the sender explicitly with the "account" parameter — an ambiguous sender is never guessed.`,
    };
  }
  return { ok: true, connection: usable[0] };
}

/**
 * Workspace ownership check, used by every Gmail executor before anything else.
 * A connection id from another workspace is reported as absent, never as
 * forbidden — confirming it exists is itself a cross-workspace disclosure.
 */
export function isConnectionInWorkspace(connectionId: string, workspaceId: string): boolean {
  const row: any = getDatabase()
    .prepare('SELECT 1 FROM gmail_connections WHERE connection_id = ? AND workspace_id = ?')
    .get(connectionId, workspaceId);
  return !!row;
}

// ---------------------------------------------------------------------------
// WRITES
// ---------------------------------------------------------------------------

export function upsertGmailConnection(params: {
  workspaceId: string;
  accountEmail: string;
  refreshToken?: string | null;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  scopes: string[];
  connectedByUserId: string;
}): GmailConnectionView {
  const db = getDatabase();
  const now = new Date().toISOString();
  const email = params.accountEmail.trim().toLowerCase();

  const existing: any = db
    .prepare('SELECT * FROM gmail_connections WHERE workspace_id = ? AND account_email = ?')
    .get(params.workspaceId, email);

  const connectionId = existing?.connection_id || `gmc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const refreshEnc = params.refreshToken ? encryptVoiceSecret(params.refreshToken) : (existing?.refresh_token_encrypted ?? null);
  const accessEnc = params.accessToken ? encryptVoiceSecret(params.accessToken) : null;

  if (existing) {
    db.prepare(
      `UPDATE gmail_connections
          SET refresh_token_encrypted = ?, access_token_encrypted = ?, access_token_expires_at = ?,
              scopes = ?, status = 'CONNECTED', last_error = NULL, updated_at = ?
        WHERE connection_id = ?`,
    ).run(refreshEnc, accessEnc, params.accessTokenExpiresAt ?? null, params.scopes.join(' '), now, connectionId);
  } else {
    db.prepare(
      `INSERT INTO gmail_connections (
         connection_id, workspace_id, account_email, refresh_token_encrypted, access_token_encrypted,
         access_token_expires_at, scopes, status, connected_by_user_id, last_verified_at, last_error,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CONNECTED', ?, NULL, NULL, ?, ?)`,
    ).run(
      connectionId, params.workspaceId, email, refreshEnc, accessEnc,
      params.accessTokenExpiresAt ?? null, params.scopes.join(' '), params.connectedByUserId, now, now,
    );
  }

  const row: any = db.prepare('SELECT * FROM gmail_connections WHERE connection_id = ?').get(connectionId);
  return toView(row);
}

export function markGmailConnectionStatus(
  connectionId: string,
  status: GmailConnectionStatus,
  error?: string | null,
): void {
  getDatabase()
    .prepare('UPDATE gmail_connections SET status = ?, last_error = ?, updated_at = ? WHERE connection_id = ?')
    // Scrubbed: a provider error body can echo a token back in a header dump.
    .run(status, error ? scrubSecrets(error, 300) : null, new Date().toISOString(), connectionId);
}

export function markGmailConnectionVerified(connectionId: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE gmail_connections SET last_verified_at = ?, status = 'CONNECTED', last_error = NULL, updated_at = ? WHERE connection_id = ?")
    .run(now, now, connectionId);
}

export function deleteGmailConnection(workspaceId: string, connectionId: string): boolean {
  const res: any = getDatabase()
    .prepare('DELETE FROM gmail_connections WHERE connection_id = ? AND workspace_id = ?')
    .run(connectionId, workspaceId);
  return !!res && res.changes > 0;
}

// ---------------------------------------------------------------------------
// TOKEN RESOLUTION — the one place a plaintext token exists, briefly.
// ---------------------------------------------------------------------------

export class GmailAuthError extends Error {
  readonly needsReauth: boolean;
  constructor(message: string, needsReauth = false) {
    super(message);
    this.name = 'GmailAuthError';
    this.needsReauth = needsReauth;
  }
}

const ACCESS_TOKEN_SKEW_MS = 60_000; // refresh a minute early rather than racing expiry

/**
 * Return a usable access token for a connection, refreshing if necessary.
 *
 * Throws GmailAuthError rather than returning an empty string, so a caller
 * cannot accidentally proceed with no credential and interpret the resulting
 * 401 as a recipient problem.
 */
export async function resolveAccessToken(connectionId: string, workspaceId: string): Promise<string> {
  const db = getDatabase();
  const row: any = db
    .prepare('SELECT * FROM gmail_connections WHERE connection_id = ? AND workspace_id = ?')
    .get(connectionId, workspaceId);
  if (!row) throw new GmailAuthError(`No Gmail connection "${connectionId}" exists in this workspace.`);
  if (row.status === 'REVOKED') throw new GmailAuthError(`Gmail connection for ${row.account_email} was revoked.`, true);

  // A live, unexpired access token is used as-is.
  if (row.access_token_encrypted && row.access_token_expires_at) {
    const expiresAt = new Date(row.access_token_expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > ACCESS_TOKEN_SKEW_MS) {
      try {
        return decryptVoiceSecret(row.access_token_encrypted);
      } catch {
        // A token that will not decrypt (rotated encryption key) is treated as
        // absent rather than fatal — the refresh path below can recover.
      }
    }
  }

  if (!row.refresh_token_encrypted) {
    markGmailConnectionStatus(row.connection_id, 'NEEDS_REAUTH', 'No refresh token is stored for this account.');
    throw new GmailAuthError(`Gmail account ${row.account_email} has no refresh token stored; it must be reconnected.`, true);
  }
  if (!gmailOAuthConfigured()) {
    throw new GmailAuthError('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not configured, so no access token can be refreshed.');
  }

  let refreshToken: string;
  try {
    refreshToken = decryptVoiceSecret(row.refresh_token_encrypted);
  } catch (err: any) {
    markGmailConnectionStatus(row.connection_id, 'NEEDS_REAUTH', 'Stored refresh token could not be decrypted.');
    throw new GmailAuthError(`Gmail refresh token for ${row.account_email} could not be decrypted; reconnect the account.`, true);
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(googleTokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // invalid_grant means the user revoked access or changed their password.
      const needsReauth = /invalid_grant|unauthorized_client/i.test(text);
      markGmailConnectionStatus(row.connection_id, needsReauth ? 'NEEDS_REAUTH' : 'CONNECTED', `Token refresh failed (HTTP ${res.status}).`);
      throw new GmailAuthError(`Gmail token refresh failed for ${row.account_email} (HTTP ${res.status}).`, needsReauth);
    }
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { throw new GmailAuthError('Google token endpoint returned a non-JSON response.'); }
    const accessToken = String(parsed?.access_token || '');
    if (!accessToken) throw new GmailAuthError('Google token endpoint returned no access_token.');

    const expiresInSec = Number(parsed?.expires_in) || 3600;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
    getDatabase()
      .prepare('UPDATE gmail_connections SET access_token_encrypted = ?, access_token_expires_at = ?, updated_at = ? WHERE connection_id = ?')
      .run(encryptVoiceSecret(accessToken), expiresAt, new Date().toISOString(), row.connection_id);

    return accessToken;
  } catch (err: any) {
    if (err instanceof GmailAuthError) throw err;
    if (err?.name === 'AbortError') throw new GmailAuthError('Gmail token refresh timed out.');
    throw new GmailAuthError(scrubSecrets(err?.message || String(err), 200));
  } finally {
    clearTimeout(timer);
  }
}

/** Whether this workspace can do anything with Gmail at all. */
export function gmailWorkspaceReadiness(workspaceId: string): {
  configured: boolean;
  reason: string;
  missingConfiguration: string | null;
  connections: GmailConnectionView[];
} {
  const connections = listWorkspaceGmailConnections(workspaceId);
  const usable = connections.filter((c) => c.status === 'CONNECTED');

  if (!gmailOAuthConfigured()) {
    return {
      configured: false,
      reason: 'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, then connect an account.',
      missingConfiguration: 'GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET',
      connections,
    };
  }
  if (usable.length === 0) {
    return {
      configured: false,
      reason: connections.length === 0
        ? 'Google OAuth is configured, but no Gmail account is connected to this workspace yet.'
        : `No usable Gmail account in this workspace: ${connections.map((c) => `${c.accountEmail} is ${c.status}`).join(', ')}.`,
      missingConfiguration: 'a connected Gmail account',
      connections,
    };
  }
  return {
    configured: true,
    reason: `${usable.length} connected Gmail account(s): ${usable.map((c) => c.accountEmail).join(', ')}.`,
    missingConfiguration: null,
    connections,
  };
}
