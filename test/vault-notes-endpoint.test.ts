import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import net from 'node:net';

// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 2: POST /api/vault/notes, the real
// server-backed replacement for src/App.tsx's formerly-fake-only
// handleAddNoteToVault(). Same method as test/fabric-characterization.test.ts:
// spawn the real, unmodified `tsx server.ts`, real HTTP requests, real
// DB/filesystem inspection — not a description of the source code.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-vault-notes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getDatabase } from '../lib/persistence';
import { createUser, login } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { VAULT_ROOT } from '../lib/vault';

const SESSION_COOKIE_NAME = 'synthos_session';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error('could not allocate a free port')));
      }
    });
  });
}

let child: ChildProcess;
let PORT: number;
let BASE_URL: string;

const WS_A = `ws-vault-notes-a-${Date.now()}`;
const WS_B = `ws-vault-notes-b-${Date.now()}`;
let userAToken: string;
let userBToken: string;

function cookieHeader(rawToken: string): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}`;
}

async function postNote(body: any, cookie?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}/api/vault/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  getDatabase();
  ensureWorkspace(WS_A, 'Vault Notes Test A');
  ensureWorkspace(WS_B, 'Vault Notes Test B');
  const userA = createUser({ email: `vault-notes-a-${Date.now()}@example.test`, password: 'correct horse battery staple 1', displayName: 'Vault Notes A' });
  const userB = createUser({ email: `vault-notes-b-${Date.now()}@example.test`, password: 'correct horse battery staple 2', displayName: 'Vault Notes B' });
  grantMembership(userA.user_id, WS_A, 'member');
  grantMembership(userB.user_id, WS_B, 'member');
  const loginA = login(userA.email, 'correct horse battery staple 1');
  const loginB = login(userB.email, 'correct horse battery staple 2');
  if (!loginA || !loginB) throw new Error('setup: real login() failed');
  userAToken = loginA.rawToken;
  userBToken = loginB.rawToken;

  PORT = await freePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;
  const env: NodeJS.ProcessEnv = { ...process.env, SYNTHOS_DB_PATH: TEST_DB_PATH, PORT: String(PORT) };
  delete env.GEMINI_API_KEY;

  child = spawn(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['server.ts'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    let out = '';
    const timeout = setTimeout(() => reject(new Error(`server did not start within 20s. stdout so far:\n${out}`)), 20000);
    child.stdout?.on('data', (d) => {
      out += d.toString();
      if (out.includes('Server running on')) { clearTimeout(timeout); resolve(); }
    });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited early (code ${code}). Output:\n${out}`)); });
  });
}, 30000);

afterAll(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  // Clean up any real vault files this run created.
  for (const ws of [WS_A, WS_B]) {
    try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', ws), { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('POST /api/vault/notes: auth and validation', () => {
  it('no session cookie -> 401', async () => {
    const { status } = await postNote({ workspaceId: WS_A, title: 't', content: 'c' });
    expect(status).toBe(401);
  });

  it('real session, wrong workspace membership -> 403', async () => {
    const { status } = await postNote({ workspaceId: WS_A, title: 't', content: 'c' }, cookieHeader(userBToken));
    expect(status).toBe(403);
  });

  it('missing title -> 400, missing content -> 400', async () => {
    const noTitle = await postNote({ workspaceId: WS_A, content: 'c' }, cookieHeader(userAToken));
    expect(noTitle.status).toBe(400);
    const noContent = await postNote({ workspaceId: WS_A, title: 't' }, cookieHeader(userAToken));
    expect(noContent.status).toBe(400);
  });
});

describe('POST /api/vault/notes: real persistence (no taskId supplied)', () => {
  it('creates a real task, a real artifact row, and a real file on disk — honest success, not a client-side echo', async () => {
    const { status, json } = await postNote(
      { workspaceId: WS_A, title: 'Live Note Test', content: 'Real note body.', tags: ['a', 'b'] },
      cookieHeader(userAToken)
    );
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.workspaceId).toBe(WS_A);
    expect(typeof json.taskId).toBe('string');
    expect(typeof json.artifact.id).toBe('string');

    const db = getDatabase();
    const taskRow = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(json.taskId) as any;
    expect(taskRow).toBeDefined();
    expect(taskRow.workspace_id).toBe(WS_A);
    expect(taskRow.status).toBe('DONE');

    const artifactRow = db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(json.artifact.id) as any;
    expect(artifactRow).toBeDefined();
    expect(artifactRow.content_hash).toBe(json.artifact.contentHash);
    expect(fs.existsSync(artifactRow.disk_path)).toBe(true);
    const realContent = fs.readFileSync(artifactRow.disk_path, 'utf8');
    expect(realContent).toContain('Real note body.');
    expect(realContent).toContain('Live Note Test');

    const activityRow = db.prepare("SELECT * FROM activity_events WHERE task_id = ? AND event_type = 'VAULT_NOTE_SAVED'").get(json.taskId);
    expect(activityRow).toBeDefined();

    // Real memory indexing (immediate, unlike the execute-agent-task path).
    const memRow = db.prepare('SELECT * FROM memory_index WHERE artifact_id = ?').get(json.artifact.id);
    expect(memRow).toBeDefined();
  });
});

describe('POST /api/vault/notes: cross-workspace taskId reuse is blocked (same protection as /api/execute-agent-task, Phase 0b)', () => {
  it('reusing a real Workspace A task_id from an authorized Workspace B request -> 403 WORKSPACE_MISMATCH, zero writes', async () => {
    const first = await postNote({ workspaceId: WS_A, title: 'Owner Note', content: 'owned by A' }, cookieHeader(userAToken));
    expect(first.status).toBe(200);
    const sharedTaskId = first.json.taskId;

    const db = getDatabase();
    const before = db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(sharedTaskId) as any;

    const second = await postNote({ workspaceId: WS_B, taskId: sharedTaskId, title: 'Hijack Attempt', content: 'by B' }, cookieHeader(userBToken));
    expect(second.status).toBe(403);
    expect(second.json.reason).toBe('WORKSPACE_MISMATCH');

    const after = db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(sharedTaskId) as any;
    expect(after.n).toBe(before.n); // no new artifact written for the rejected attempt
  });
});
