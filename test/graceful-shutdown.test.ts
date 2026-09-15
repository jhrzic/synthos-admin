import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// DAY 1 (production deployment gate) — graceful shutdown.
//
// docs/PRODUCTION-READINESS.md listed "no graceful-shutdown handler
// (server.close() on SIGTERM)" as a known deployment gap. It matters more than
// the usual amount here because every container platform stops a process with
// SIGTERM, so on a real deployment this path runs on EVERY redeploy — and
// because this app runs SQLite in WAL mode, where an abrupt kill leaves
// committed pages stranded in the -wal sidecar.
//
// These are real process tests: a real production bundle is spawned, a real
// signal is sent, and the real files on disk are inspected afterwards. There is
// no mock of the signal, the server, or the database.
//
// The bundle (dist/server.cjs) must already be built — this asserts that rather
// than silently passing when it is absent.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const BUNDLE = path.join(ROOT, 'dist', 'server.cjs');
const bundleExists = fs.existsSync(BUNDLE);

let child: ChildProcess | null = null;
let tmpDir: string | null = null;

afterEach(() => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  child = null;
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(port: number, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  return false;
}

/**
 * Spawn the real production bundle against a fully isolated directory.
 *
 * The cwd matters and is not incidental. lib/backup.ts's BACKUP_ROOT and
 * lib/vault.ts's VAULT_ROOT are both fixed relative to process.cwd(), so a
 * server spawned with the repo as its cwd writes into the repository's own
 * backups/ and vault/ directories — which made this file race against
 * backup-restore-drill.test.ts whenever the two ran in parallel, producing a
 * genuine "no such table: users" flake in a file it never touched. Giving the
 * child its own cwd isolates all four state roots (db, keys, backups, vault)
 * instead of only the two that have environment overrides.
 *
 * node_modules is symlinked in because the bundle is built with
 * --packages=external and still resolves express/ws/dotenv at runtime.
 */
async function startServer(port: number): Promise<{ stdout: () => string }> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-shutdown-'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmpDir, 'node_modules'), 'dir');
  // The bundle serves the built client from ./dist relative to cwd.
  fs.symlinkSync(path.join(ROOT, 'dist'), path.join(tmpDir, 'dist'), 'dir');
  let stdout = '';
  child = spawn(process.execPath, [BUNDLE], {
    cwd: tmpDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      SYNTHOS_DB_PATH: path.join(tmpDir, 'synthos.db'),
      SYNTHOS_SIGNING_KEY_DIR: path.join(tmpDir, 'keys'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (b) => { stdout += b.toString(); });
  child.stderr?.on('data', (b) => { stdout += b.toString(); });
  const up = await waitForHealth(port);
  expect(up, 'production bundle did not become healthy').toBe(true);
  return { stdout: () => stdout };
}

/** Resolve with the real exit code once the child actually exits. */
function waitForExit(proc: ChildProcess, timeoutMs = 15000): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    proc.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}

describe.skipIf(!bundleExists)('graceful shutdown — real process, real signal', () => {
  // Deliberately TWO spawns, not four. Each spawn is a real production server
  // competing for CPU with every other test file vitest runs in parallel, and
  // four of them was enough to intermittently time out an unrelated 5s
  // concurrency assertion in test/scheduler.test.ts. Folding the independent
  // assertions onto shared spawns keeps the same coverage at half the load —
  // the alternative was loosening another file's timeout to accommodate this
  // one, which would have hidden real contention rather than removed it.

  it('SIGTERM: drains in order, checkpoints the WAL, exits 0, and is idempotent', async () => {
    const { stdout } = await startServer(3471);
    const dbPath = path.join(tmpDir!, 'synthos.db');

    // Force the lazily-opened database open with a real request that reads it.
    // A 401 is the expected, correct answer — it proves the route really ran.
    const res = await fetch('http://127.0.0.1:3471/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe@example.invalid', password: 'not-a-real-password' }),
    });
    expect(res.status).toBe(401);

    expect(fs.existsSync(`${dbPath}-wal`), 'WAL mode should produce a -wal sidecar').toBe(true);
    const walBefore = fs.statSync(`${dbPath}-wal`).size;
    expect(walBefore).toBeGreaterThan(0);

    // Two signals: the second must not start a second drain.
    child!.kill('SIGTERM');
    child!.kill('SIGTERM');
    const code = await waitForExit(child!);
    expect(code, 'a clean drain must exit 0, never a signal death').toBe(0);

    const log = stdout();
    expect(log).toContain('[Shutdown] SIGTERM received');
    expect(log).toContain('[Shutdown] Database checkpointed and closed');

    // Order is the correctness property: arming must stop before draining, or a
    // scheduler tick can dispatch real work into a dying process.
    const schedulerAt = log.indexOf('[Shutdown] Scheduler stopped');
    const httpAt = log.indexOf('[Shutdown] HTTP server closed');
    expect(schedulerAt).toBeGreaterThan(-1);
    expect(httpAt).toBeGreaterThan(-1);
    expect(schedulerAt).toBeLessThan(httpAt);

    // Drain entered exactly once despite two signals.
    const drains = log.split('[Shutdown] SIGTERM received. Draining.').length - 1;
    expect(drains, 'drain must be entered exactly once').toBe(1);

    // TRUNCATE checkpoint folds the WAL back and removes the sidecars.
    expect(fs.existsSync(`${dbPath}-wal`), '-wal must not survive a clean shutdown').toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`), '-shm must not survive a clean shutdown').toBe(false);
    // The pages went into the main file rather than being discarded.
    expect(fs.statSync(dbPath).size).toBeGreaterThan(walBefore / 4);
  }, 60000);

  // SIGINT is proven WITHOUT a second spawn, deliberately. Each spawn is a real
  // production server competing for CPU with every other file vitest runs in
  // parallel, and this suite already contains one spawned-server file
  // (jarvis-duplicate-submission). Two heavy files was enough to intermittently
  // time out a 5s concurrency assertion over there. Since SIGINT and SIGTERM are
  // registered to the same `shutdown` function, the behavioural proof above
  // covers both paths; what remains to check is only that the wiring is real,
  // which a source assertion does exactly — the same convention this repo uses
  // in test/voice-routing-separation.test.ts.
  it('SIGINT is wired to the identical shutdown path, not a second implementation', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    expect(src).toContain("process.on('SIGTERM', () => shutdown('SIGTERM'))");
    expect(src).toContain("process.on('SIGINT', () => shutdown('SIGINT'))");
    // One drain implementation, not two that can drift apart.
    expect(
      src.split('const shutdown = (signal: string) =>').length - 1,
      'there must be exactly one shutdown implementation',
    ).toBe(1);
  });
});

describe('the bundle under test is really there', () => {
  it('dist/server.cjs exists — otherwise the suite above silently skips', () => {
    expect(
      bundleExists,
      'run `npm run build` before this suite; a missing bundle must not read as a pass',
    ).toBe(true);
  });
});
