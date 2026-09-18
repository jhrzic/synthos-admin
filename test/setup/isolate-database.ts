import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// GLOBAL TEST DATABASE ISOLATION.
//
// Runs as a vitest `setupFiles` entry, which executes BEFORE each test file's
// own module graph is imported. That ordering is the whole point: lib/
// persistence resolves its path the first time it is touched, so the variable
// has to be in place before any import runs.
//
// WHAT THIS REPLACES
// 63 of 112 test files set SYNTHOS_DB_PATH themselves. The other 49 did not,
// and anything in that group that touched persistence resolved to the
// production database through the development fallback in getDatabasePath().
// That is how three fixture workspaces and 78 dependent rows ended up in the
// live database, rendering as real client workspaces in the Admin sidebar.
//
// Patching 49 files individually was the alternative. It was rejected for the
// reason the vault helper gives for the same decision: 49 copies of "remember
// to set the variable" is 49 chances to set the wrong one, which has already
// happened once in this repo (a test set VAULT_ROOT, a name nothing reads).
// One central mechanism, one variable, one cleanup path.
//
// DEFENCE IN DEPTH
// This file makes isolation the default. lib/persistence.ts additionally
// REFUSES to resolve to the production database under test, so a file that
// somehow bypasses this setup fails loudly rather than writing rows. Neither
// alone would be sufficient: this one could be removed from the config, and
// the refusal alone would leave 49 files with no working database at all.
// ---------------------------------------------------------------------------

/**
 * Per-worker directory. Vitest runs files across parallel workers, and two
 * workers sharing one SQLite file produce lock contention that looks like a
 * flaky test. VITEST_WORKER_ID is unique per worker; the random suffix keeps
 * separate runs from colliding if cleanup ever fails.
 */
const workerId = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? '0';
const suffix = crypto.randomBytes(4).toString('hex');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `synthos-testdb-w${workerId}-${suffix}-`));
const dbPath = path.join(dir, 'test.db');

// A test file that sets its own path at module scope keeps it — those 63 files
// are already isolated and several rely on a specific shared path within the
// file. This only supplies a default for the files that set nothing.
if (!process.env.SYNTHOS_DB_PATH) {
  process.env.SYNTHOS_DB_PATH = dbPath;
}

// ARTIFACT VAULT + BACKUPS — the same isolation for the two directories that
// used to default to the repository's own ./vault and ./backups. Tests wrote
// thousands of artifacts into the real vault and hundreds of archives into
// ./backups, and every backup test then archived (and hashed) all of it — the
// cause of the backup tests' timeouts, which no timeout increase could fix.
if (!process.env.SYNTHOS_ARTIFACT_VAULT_DIR) {
  process.env.SYNTHOS_ARTIFACT_VAULT_DIR = path.join(dir, 'vault');
  fs.mkdirSync(process.env.SYNTHOS_ARTIFACT_VAULT_DIR, { recursive: true });
}
if (!process.env.SYNTHOS_BACKUP_DIR) {
  process.env.SYNTHOS_BACKUP_DIR = path.join(dir, 'backups');
}
for (const [name, prod] of [['SYNTHOS_ARTIFACT_VAULT_DIR', 'vault'], ['SYNTHOS_BACKUP_DIR', 'backups']] as const) {
  if (path.resolve(process.env[name]!) === path.resolve(process.cwd(), prod)) {
    throw new Error(`Test isolation failed: ${name} resolves to the repository's ${prod}/ directory. Refusing to run.`);
  }
}

// Belt and braces: whatever the path ended up being, it must not be production.
const production = path.resolve(process.cwd(), 'data', 'synthos-admin.db');
if (path.resolve(process.env.SYNTHOS_DB_PATH) === production) {
  throw new Error(
    'Test database isolation failed: SYNTHOS_DB_PATH resolves to the production '
    + `database (${production}). Refusing to run.`,
  );
}

/**
 * Remove the temporary database and its WAL/SHM siblings. SQLite in WAL mode
 * leaves `-wal` and `-shm` files next to the database; deleting only the `.db`
 * leaves those behind in the OS temp directory for every test file, every run.
 */
function cleanup(): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* best effort — a leftover file in tmpdir must never fail a test run */
    }
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* as above */
  }
}

process.on('exit', cleanup);


// ---------------------------------------------------------------------------
// FREE TEST SUITE. Installs the paid-endpoint guard in every worker before any
// test module loads: real provider hosts are unreachable under test unless
// SYNTHOS_LIVE_PROVIDER_TESTS=true and SYNTHOS_LIVE_TEST_BUDGET_USD are both
// set (lib/spend/network-guard.ts). It touches no database.
// ---------------------------------------------------------------------------
import '../../lib/spend/network-guard';

// ---------------------------------------------------------------------------
// QUEUED-TASK PROCESSING. Production default is OFF (fail closed; see
// lib/queued-task-processing.ts). Pre-existing tests that exercise execution
// run with the gate open through a Vitest-only override; the gate's own tests
// (test/queued-task-processing.test.ts) delete this to test the real default.
// ---------------------------------------------------------------------------
process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING = 'enabled';
