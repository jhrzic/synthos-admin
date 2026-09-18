import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

import { getDatabasePath, PRODUCTION_DB_TEST_OVERRIDE } from '../lib/persistence';

// ---------------------------------------------------------------------------
// THE DATABASE MAY NOT BE THE PRODUCTION DATABASE UNDER TEST.
//
// The vault already had a guard for exactly this failure (see
// test/vault-isolation-guard.test.ts). The database did not, and the cost was
// three fixture workspaces plus 78 dependent rows written into the live
// database by a pre-isolation test run — where they then rendered in the
// production Admin sidebar as real client workspaces, indistinguishable by eye
// from genuine ones.
//
// These tests assert the refusal and the isolation, by behaviour.
// ---------------------------------------------------------------------------

const PRODUCTION = path.resolve(process.cwd(), 'data', 'synthos-admin.db');

const originalDbPath = process.env.SYNTHOS_DB_PATH;
const originalOverride = process.env[PRODUCTION_DB_TEST_OVERRIDE];

afterEach(() => {
  if (originalDbPath === undefined) delete process.env.SYNTHOS_DB_PATH;
  else process.env.SYNTHOS_DB_PATH = originalDbPath;
  if (originalOverride === undefined) delete process.env[PRODUCTION_DB_TEST_OVERRIDE];
  else process.env[PRODUCTION_DB_TEST_OVERRIDE] = originalOverride;
});

describe('a test run cannot resolve to the production database', () => {
  it('refuses when SYNTHOS_DB_PATH points straight at it', () => {
    process.env.SYNTHOS_DB_PATH = PRODUCTION;
    expect(() => getDatabasePath()).toThrow(/Refusing to open the production database/);
  });

  it('refuses when the path is unset and the development fallback would be used', () => {
    // This is the exact shape that caused the leak: no variable set, so
    // getDatabasePath() falls back to <cwd>/data/synthos-admin.db.
    delete process.env.SYNTHOS_DB_PATH;
    expect(() => getDatabasePath()).toThrow(/Refusing to open the production database/);
  });

  it('refuses a path that reaches production by a different spelling', () => {
    // Relative segments and a non-normalised path must not defeat the check —
    // it compares resolved absolute paths, not strings.
    process.env.SYNTHOS_DB_PATH = path.join(process.cwd(), 'data', '..', 'data', 'synthos-admin.db');
    expect(() => getDatabasePath()).toThrow(/Refusing to open the production database/);
  });

  it('names the variable a caller would need, so the failure is actionable', () => {
    process.env.SYNTHOS_DB_PATH = PRODUCTION;
    let message = '';
    try { getDatabasePath(); } catch (err: any) { message = String(err?.message ?? ''); }
    expect(message).toContain('SYNTHOS_DB_PATH');
    expect(message).toContain(PRODUCTION_DB_TEST_OVERRIDE);
  });

  it('allows production only behind the explicit override', () => {
    // The override exists so a deliberate destructive integration test is
    // possible. Nothing in this repository sets it.
    process.env.SYNTHOS_DB_PATH = PRODUCTION;
    process.env[PRODUCTION_DB_TEST_OVERRIDE] = '1';
    expect(getDatabasePath()).toBe(PRODUCTION);
  });

  it('nothing in the test suite sets that override', () => {
    const files = fs.readdirSync('test', { recursive: true, encoding: 'utf8' })
      .filter((f) => typeof f === 'string' && /\.(ts|tsx)$/.test(f))
      .filter((f) => !f.endsWith('database-isolation-guard.test.ts'));
    const offenders = files.filter((f) => {
      try { return fs.readFileSync(path.join('test', f), 'utf8').includes(PRODUCTION_DB_TEST_OVERRIDE); }
      catch { return false; }
    });
    expect(offenders).toEqual([]);
  });
});

describe('the global setup isolates every test file by default', () => {
  it('this very test file received an isolated path outside the repository', () => {
    // Asserted on the live value: whatever mechanism supplied it, the path this
    // file would actually open is not the production database and not inside
    // the repository's data directory.
    const active = path.resolve(process.env.SYNTHOS_DB_PATH as string);
    expect(active).not.toBe(PRODUCTION);
    expect(active.startsWith(path.resolve(process.cwd(), 'data'))).toBe(false);
  });

  it('gives parallel workers distinct paths', () => {
    // The per-worker directory carries the worker id, so two workers cannot
    // share one SQLite file and generate lock contention that reads as a flake.
    const active = process.env.SYNTHOS_DB_PATH as string;
    expect(active).toMatch(/synthos-testdb-w\d+/);
  });
});
