import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// SYNTHOS_SCHEDULER_DISABLED=1: a real server process starts with NO scheduler
// (nothing dispatches on a timer). Required so verification copies and any
// non-canonical instance can never become a second scheduler.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-nosched-'));
let child: ChildProcess | null = null;
let out = '';
let base = '';

beforeAll(async () => {
  const port = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => r(p)); }); });
  base = `http://127.0.0.1:${port}`;
  const env: Record<string, string> = { ...process.env as any, PORT: String(port), SYNTHOS_BIND_HOST: '127.0.0.1', SYNTHOS_DB_PATH: path.join(TMP, 'n.db'), SYNTHOS_SIGNING_KEY_DIR: path.join(TMP, 'keys'), SYNTHOS_VAULT_PATH: path.join(TMP, 'vault'), DISABLE_HMR: 'true', SYNTHOS_SCHEDULER_DISABLED: '1' };
  for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_ENABLED', 'VITEST', 'VITEST_WORKER_ID', 'VITEST_POOL_ID']) delete env[k];
  child = spawn(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'), ['server.ts'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 30000);
    child!.stdout?.on('data', (d) => { out += d.toString(); if (out.includes('Server running on')) { clearTimeout(t); resolve(); } });
    child!.stderr?.on('data', (d) => { out += d.toString(); });
    child!.on('exit', (c) => { clearTimeout(t); reject(new Error(`exited ${c}:\n${out}`)); });
  });
}, 45000);

afterAll(async () => {
  if (child && !child.killed) { child.removeAllListeners('exit'); child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('scheduler kill switch', () => {
  it('logs that no scheduler started, and the scheduler never ticks', async () => {
    expect(out).toContain('SCHEDULER: DISABLED by SYNTHOS_SCHEDULER_DISABLED=1');
    await new Promise((r) => setTimeout(r, 11000)); // longer than one 10 s tick
    const ready = await (await fetch(`${base}/api/ready`)).json();
    const sched = (ready.systems as any[]).find((s) => /Scheduler/.test(s.system));
    expect(sched?.status).not.toBe('HEALTHY');
    expect(out).not.toMatch(/\[scheduler\] tick/);
  }, 30000);
});
