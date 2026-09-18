import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

// ---------------------------------------------------------------------------
// RUNNING-VERSION EVIDENCE on /api/ready.
//
//   * a supplied build SHA is returned exactly;
//   * missing or malformed metadata reads UNKNOWN (never a guessed SHA);
//   * a SHA stamped from a MODIFIED checkout is withheld;
//   * no other environment value, path or credential is exposed.
// ---------------------------------------------------------------------------

import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports; the spawned server inherits it):
isolateVaultForTest('build-info');

import { readBuildInfo } from '../lib/build-info';
import { collectBuildInfo, toShell } from '../scripts/write-build-info.mjs';

const SHA = 'c0ffee0123456789abcdef0123456789abcdef01';
const CANARY = 'build-info-canary-value-7f3a9d';

describe('readBuildInfo — reads only the five SYNTHOS_BUILD_* values', () => {
  it('returns a supplied SHA, time and ref exactly', () => {
    const v = readBuildInfo({ SYNTHOS_BUILD_SHA: SHA, SYNTHOS_BUILD_TREE: 'CLEAN', SYNTHOS_BUILD_TIME: '2026-09-18T12:00:00.000Z', SYNTHOS_BUILD_REF: 'checkpoint/x-1', SYNTHOS_BUILD_SOURCE: 'LAUNCHER_GIT' });
    expect(v).toEqual({ commit: SHA, buildTime: '2026-09-18T12:00:00.000Z', ref: 'checkpoint/x-1', tree: 'CLEAN', source: 'LAUNCHER_GIT' });
  });

  it('missing metadata reads UNKNOWN everywhere', () => {
    expect(readBuildInfo({})).toEqual({ commit: 'UNKNOWN', buildTime: 'UNKNOWN', ref: 'UNKNOWN', tree: 'UNKNOWN', source: 'UNKNOWN' });
  });

  it('never fabricates: a short, uppercase or padded-garbage SHA, a bad time or an unsafe ref is UNKNOWN', () => {
    for (const bad of ['c0ffee', SHA.toUpperCase(), `${SHA}0`, `${SHA};rm -rf /`, 'HEAD']) {
      expect(readBuildInfo({ SYNTHOS_BUILD_SHA: bad, SYNTHOS_BUILD_TREE: 'CLEAN' }).commit, bad).toBe('UNKNOWN');
    }
    expect(readBuildInfo({ SYNTHOS_BUILD_TIME: 'yesterday' }).buildTime).toBe('UNKNOWN');
    expect(readBuildInfo({ SYNTHOS_BUILD_REF: 'a b $(x)' }).ref).toBe('UNKNOWN');
  });

  it('a SHA without a CLEAN tree is withheld — modified source is not that commit', () => {
    expect(readBuildInfo({ SYNTHOS_BUILD_SHA: SHA, SYNTHOS_BUILD_TREE: 'MODIFIED' }).commit).toBe('UNKNOWN');
    expect(readBuildInfo({ SYNTHOS_BUILD_SHA: SHA }).commit).toBe('UNKNOWN');
  });

  it('unrelated environment values are never included', () => {
    const v = readBuildInfo({ SYNTHOS_BUILD_SHA: SHA, SYNTHOS_BUILD_TREE: 'CLEAN', SYNTHOS_DB_PATH: `/tmp/${CANARY}.db`, HOME: `/Users/${CANARY}`, SOME_API_KEY: CANARY });
    expect(Object.keys(v).sort()).toEqual(['buildTime', 'commit', 'ref', 'source', 'tree']);
    expect(JSON.stringify(v)).not.toContain(CANARY);
  });
});

describe('write-build-info — stamps a SHA only for an exactly-committed checkout', () => {
  let repo: string;
  const g = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-buildinfo-git-'));
    g('init', '-q', '-b', 'release-test');
    g('config', 'user.email', 'test@example.test'); g('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    g('add', '.'); g('commit', '-q', '-m', 'one');
  });
  afterAll(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best effort */ } });

  it('clean checkout: the exact HEAD SHA and branch', () => {
    const info = collectBuildInfo(repo, new Date('2026-09-18T12:00:00Z'));
    expect(info).toEqual({ schema: 1, tree: 'CLEAN', buildTime: '2026-09-18T12:00:00.000Z', commit: g('rev-parse', 'HEAD'), ref: 'release-test' });
  });

  it('modified or untracked files: no SHA, tree MODIFIED', () => {
    fs.writeFileSync(path.join(repo, 'b.txt'), 'untracked\n');
    const info = collectBuildInfo(repo);
    expect(info.tree).toBe('MODIFIED');
    expect((info as { commit?: string }).commit).toBeUndefined();
    fs.unlinkSync(path.join(repo, 'b.txt'));
  });

  it('not a git checkout: UNKNOWN tree, no SHA', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-buildinfo-plain-'));
    const info = collectBuildInfo(plain);
    expect(info.tree).toBe('UNKNOWN');
    expect((info as { commit?: string }).commit).toBeUndefined();
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('shell output carries only validated SYNTHOS_BUILD_* lines', () => {
    const out = toShell({ commit: 'not-a-sha', tree: 'CLEAN', buildTime: '2026-09-18T12:00:00Z', ref: 'x; rm -rf /', extra: CANARY }, 'LAUNCHER_GIT');
    expect(out.split('\n').every((l: string) => /^SYNTHOS_BUILD_(SHA|TIME|REF|TREE|SOURCE)=[A-Za-z0-9._:/-]+$/.test(l))).toBe(true);
    expect(out).not.toContain('SYNTHOS_BUILD_SHA');
    expect(out).not.toContain('SYNTHOS_BUILD_REF');
    expect(out).not.toContain(CANARY);
  });

  it('the build writes the manifest and the launcher exports only validated lines', () => {
    expect(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).scripts.build).toContain('node scripts/write-build-info.mjs --out dist/build-info.json');
    const sh = fs.readFileSync(path.join(process.cwd(), 'scripts/synthos-admin-service.sh'), 'utf8');
    expect(sh).toContain('--from dist/build-info.json --shell');
    expect(sh).toContain("'^SYNTHOS_BUILD_(SHA|TIME|REF|TREE|SOURCE)=[A-Za-z0-9._:/-]+$'");
    expect(sh).toMatch(/unset SYNTHOS_BUILD_SHA SYNTHOS_BUILD_TIME SYNTHOS_BUILD_REF SYNTHOS_BUILD_TREE SYNTHOS_BUILD_SOURCE/);
  });
});

describe('/api/ready over HTTP', () => {
  const REPO_ROOT = process.cwd();
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), `synthos-ready-${CANARY}-`));
  const DB = path.join(TMP, 'ready.db');
  let child: ChildProcess | null = null;
  let base = '';

  beforeAll(async () => {
    const port = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => r(p)); }); });
    base = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env, SYNTHOS_DB_PATH: DB, PORT: String(port), DISABLE_HMR: 'true',
      SYNTHOS_BUILD_SHA: SHA, SYNTHOS_BUILD_TREE: 'CLEAN', SYNTHOS_BUILD_TIME: '2026-09-18T12:00:00.000Z', SYNTHOS_BUILD_REF: 'checkpoint/ready-test', SYNTHOS_BUILD_SOURCE: 'LAUNCHER_GIT',
      SYNTHOS_READY_TEST_CANARY: CANARY,
    };
    for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_ENABLED']) delete env[k];
    child = spawn(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['server.ts'], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      let out = '';
      const t = setTimeout(() => reject(new Error(`server did not start in 25s:\n${out}`)), 25000);
      child!.stdout?.on('data', (d) => { out += d.toString(); if (out.includes('Server running on')) { clearTimeout(t); resolve(); } });
      child!.stderr?.on('data', (d) => { out += d.toString(); });
      child!.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited early (${c}):\n${out}`)); });
    });
  }, 40000);

  afterAll(async () => {
    if (child && !child.killed) { child.removeAllListeners('exit'); child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('reports the supplied SHA exactly, and nothing from the environment, paths or credentials', async () => {
    const res = await fetch(`${base}/api/ready`);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.version).toEqual({ commit: SHA, buildTime: '2026-09-18T12:00:00.000Z', ref: 'checkpoint/ready-test', tree: 'CLEAN', source: 'LAUNCHER_GIT' });
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(TMP);
    expect(text).not.toContain(REPO_ROOT);
    expect(text).not.toContain(os.homedir());
  });
});
