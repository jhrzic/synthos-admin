import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  hashPassword,
  verifyPassword,
  createUser,
  getUserByEmail,
  getUserById,
  anyUserExists,
  login,
  resolveSessionUser,
  revokeSessionByToken,
  parseCookies,
  listUsers,
  setUserStatus,
} from '../lib/auth';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

describe('lib/auth: password hashing — real scrypt KDF, never plaintext', () => {
  it('hashPassword never returns the plaintext, and verifyPassword accepts the correct password', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse');
    expect(verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
  });

  it('verifyPassword rejects a wrong password', () => {
    const { hash, salt } = hashPassword('the-real-password');
    expect(verifyPassword('a-wrong-guess', hash, salt)).toBe(false);
  });

  it('the same password hashed twice produces different hashes (real random salt, not deterministic)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('lib/auth: users are real and persisted, never plaintext password storage', () => {
  it('createUser persists a real user, retrievable by id and email', () => {
    const user = createUser({ email: 'alice@example.com', password: 'alice-password-1', displayName: 'Alice' });
    expect(getUserById(user.user_id)?.email).toBe('alice@example.com');
    expect(getUserByEmail('alice@example.com')?.user_id).toBe(user.user_id);
  });

  it('email is normalized (case/whitespace) so the same person cannot register twice under variants', () => {
    createUser({ email: 'norm-test@example.com', password: 'x-password-1', displayName: 'Norm' });
    expect(getUserByEmail('  Norm-Test@Example.com  ')?.email).toBe('norm-test@example.com');
  });

  it('the raw password never appears anywhere on the stored user row', () => {
    const user = createUser({ email: 'noplain@example.com', password: 'super-secret-password', displayName: 'NoPlain' });
    const row = getUserByEmail('noplain@example.com') as any;
    expect(JSON.stringify(row)).not.toContain('super-secret-password');
    expect((user as any).password_hash).toBeUndefined();
    expect((user as any).password_salt).toBeUndefined();
  });

  it('listUsers never exposes password_hash/password_salt on the public record', () => {
    createUser({ email: 'listcheck@example.com', password: 'pw-listcheck-1', displayName: 'ListCheck' });
    const all = listUsers();
    for (const u of all) {
      expect((u as any).password_hash).toBeUndefined();
      expect((u as any).password_salt).toBeUndefined();
    }
  });
});

describe('lib/auth: bootstrap gating — anyUserExists reflects real state', () => {
  it('anyUserExists is true once at least one user has been created', () => {
    expect(anyUserExists()).toBe(true); // prior tests in this file already created users
  });
});

describe('lib/auth: login — generic failure for every wrong-guess case', () => {
  it('login succeeds with correct credentials and creates a real session', () => {
    createUser({ email: 'login-ok@example.com', password: 'right-password-1', displayName: 'LoginOK' });
    const result = login('login-ok@example.com', 'right-password-1');
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('login-ok@example.com');
    expect(result?.rawToken.length).toBeGreaterThan(20);
  });

  it('login returns null (not a different error) for an unknown email', () => {
    expect(login('nobody-at-all@example.com', 'whatever')).toBeNull();
  });

  it('login returns null (not a different error) for a wrong password on a real account', () => {
    createUser({ email: 'wrongpw@example.com', password: 'the-actual-password-1', displayName: 'WrongPw' });
    expect(login('wrongpw@example.com', 'not-the-password')).toBeNull();
  });

  it('login returns null for a disabled account even with the correct password', () => {
    const user = createUser({ email: 'disabled@example.com', password: 'disabled-password-1', displayName: 'Disabled' });
    setUserStatus(user.user_id, 'disabled');
    expect(login('disabled@example.com', 'disabled-password-1')).toBeNull();
  });
});

describe('lib/auth: session resolution — real revocation-aware lookup, no embedded-claim shortcut', () => {
  it('resolveSessionUser returns the real user for a valid, unexpired, unrevoked token', () => {
    createUser({ email: 'session-ok@example.com', password: 'session-password-1', displayName: 'SessionOK' });
    const result = login('session-ok@example.com', 'session-password-1')!;
    const resolved = resolveSessionUser(result.rawToken);
    expect(resolved?.user_id).toBe(result.user.user_id);
  });

  it('an unknown/garbage token resolves to null, not a fabricated identity', () => {
    expect(resolveSessionUser('not-a-real-token-at-all')).toBeNull();
  });

  it('a missing/undefined token resolves to null', () => {
    expect(resolveSessionUser(undefined)).toBeNull();
    expect(resolveSessionUser(null)).toBeNull();
  });

  it('revokeSessionByToken really invalidates the session — resolveSessionUser then returns null', () => {
    createUser({ email: 'revoke-test@example.com', password: 'revoke-password-1', displayName: 'RevokeTest' });
    const result = login('revoke-test@example.com', 'revoke-password-1')!;
    expect(resolveSessionUser(result.rawToken)).not.toBeNull();
    revokeSessionByToken(result.rawToken);
    expect(resolveSessionUser(result.rawToken)).toBeNull();
  });

  it('a session for a since-disabled user is rejected even though the token itself is still technically valid', () => {
    const user = createUser({ email: 'disable-after-login@example.com', password: 'dal-password-1', displayName: 'DAL' });
    const result = login('disable-after-login@example.com', 'dal-password-1')!;
    setUserStatus(user.user_id, 'disabled');
    expect(resolveSessionUser(result.rawToken)).toBeNull();
  });
});

describe('lib/auth: cookie parsing — minimal, dependency-free', () => {
  it('parses a single cookie value correctly', () => {
    expect(parseCookies('synthos_session=abc123')).toEqual({ synthos_session: 'abc123' });
  });

  it('parses multiple cookies and URL-decodes values', () => {
    expect(parseCookies('a=1; b=hello%20world; synthos_session=xyz')).toEqual({ a: '1', b: 'hello world', synthos_session: 'xyz' });
  });

  it('handles a missing/empty header safely', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});
