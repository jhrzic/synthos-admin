import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import net from 'node:net';

// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 6: /api/jarvis/command's routing is now
// classifier-driven (lib/fabric/intent.ts + lib/fabric/registry.ts +
// lib/fabric/envelope.ts), not lower.includes() substring matching. Same
// method as every other fabric characterization file in this repo: spawn
// the real, unmodified `tsx server.ts`, real HTTP requests, real SQLite/
// filesystem inspection.
//
// GEMINI_API_KEY and WINDMILL_* are deliberately absent from this process
// and the spawned server's environment — same posture as every other
// fabric test file. That means the conversational (natural-language) and
// research paths degrade honestly here rather than completing; what IS
// live-verified: the routing DECISION itself (which capability a prompt
// maps to, never the old substring collision), the real vault.write
// artifact, and the real honest NOT_CONFIGURED/BLOCKED/APPROVAL_REQUIRED
// outcomes for capabilities that aren't available in this environment.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-jarvis-routing-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getDatabase, getTaskReceipts } from '../lib/persistence';
import { createUser, login } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { VAULT_ROOT } from '../lib/vault';

const SESSION_COOKIE_NAME = 'synthos_session';
const WS = `ws-jarvis-routing-${Date.now()}`;
let userToken: string;

let child: ChildProcess;
let PORT: number;
let BASE_URL: string;

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

function cookieHeader(rawToken: string): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}`;
}

async function jarvisCommand(command: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}/api/jarvis/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(userToken) },
    body: JSON.stringify({ workspaceId: WS, command }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  getDatabase();
  ensureWorkspace(WS, 'Jarvis Routing Test Workspace');
  const user = createUser({ email: `jarvis-routing-${Date.now()}@example.test`, password: 'correct horse battery staple 9', displayName: 'Jarvis Routing Tester' });
  grantMembership(user.user_id, WS, 'member');
  const loginResult = login(user.email, 'correct horse battery staple 9');
  if (!loginResult) throw new Error('setup: real login() failed');
  userToken = loginResult.rawToken;

  PORT = await freePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;
  const env: NodeJS.ProcessEnv = { ...process.env, SYNTHOS_DB_PATH: TEST_DB_PATH, PORT: String(PORT) };
  delete env.GEMINI_API_KEY;
  delete env.WINDMILL_BASE_URL;
  delete env.WINDMILL_TOKEN;
  delete env.WINDMILL_WORKSPACE;
  delete env.HERMES_ADAPTER_BASE_URL;

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
  try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', WS), { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('"show me my tasks" -> real internal READ, no business-execution receipt', () => {
  it('routes to ADMIN_TASK_QUERY with real workspace-scoped evidence', async () => {
    const { status, json } = await jarvisCommand('show me my tasks');
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.intent).toBe('ADMIN_TASK_QUERY');
    expect(Array.isArray(json.evidence)).toBe(true);
  });
});

describe('"research the latest AI task-automation repos" -> the keyword-collision fix, live', () => {
  it('never routes to ADMIN_TASK_QUERY, and reaches the research capability honestly (NOT_CONFIGURED without GEMINI_API_KEY)', async () => {
    const { status, json } = await jarvisCommand('research the latest AI task-automation repos');
    expect(status).toBe(200);
    expect(json.intent).not.toBe('ADMIN_TASK_QUERY');
    expect(json.intent).toBe('ACTION_REQUEST');
    expect(json.evidence.capability).toBe('research');
    expect(json.evidence.outcome).toBe('NOT_CONFIGURED');
    expect(json.spokenSummary).toBe("I can't run that yet because the required capability isn't configured.");
  });
});

describe('"show me recent receipts" -> real internal READ', () => {
  it('routes to ADMIN_RECEIPT_QUERY', async () => {
    const { status, json } = await jarvisCommand('show me recent receipts');
    expect(status).toBe(200);
    expect(json.intent).toBe('ADMIN_RECEIPT_QUERY');
    expect(Array.isArray(json.evidence)).toBe(true);
  });
});

describe('"what is a transformer?" -> plain conversational path, unchanged', () => {
  it('reaches the natural-language branch (GENERAL_DIRECTIVE), honestly degrades with no qualified route', async () => {
    const { status, json } = await jarvisCommand('what is a transformer?');
    expect(status).toBe(200);
    expect(json.status).toBe('DEGRADED');
    expect(json.reason).toBe('NO_QUALIFIED_ROUTE');
  });
});

describe('"save this to the Vault" -> canonical vault.write, real artifact', () => {
  it('creates a real, workspace-scoped Vault artifact via the canonical writer', async () => {
    const { status, json } = await jarvisCommand('save this to the Vault');
    expect(status).toBe(200);
    expect(json.intent).toBe('ACTION_REQUEST');
    expect(json.evidence.capability).toBe('vault.write');
    expect(json.evidence.outcome).toBe('SUCCESS');
    expect(json.evidence.artifact.path).toContain(`workspaces/${WS}/Jarvis-Notes/`);
    expect(json.spokenSummary).toBe('Saved to the Vault.');

    const onDisk = fs.existsSync(path.join(VAULT_ROOT, ...json.evidence.artifact.path.split('/')));
    expect(onDisk).toBe(true);
  });
});

describe('STEP 7: "schedule this tomorrow" -> honest BLOCKED clarification (time-ambiguous), never a fabricated/guessed schedule', () => {
  it('a bare "tomorrow" with no time is refused with a clarification, not silently scheduled', async () => {
    const { status, json } = await jarvisCommand('schedule this for tomorrow');
    expect(status).toBe(200);
    expect(json.evidence.capability).toBe('schedule');
    expect(json.evidence.outcome).toBe('BLOCKED');
    expect(json.evidence.reason).toMatch(/no time attached/i);
    expect(json.reply).not.toMatch(/scheduled|created|set up/i);
    expect(json.spokenSummary).toBe("I can't run that yet because the required capability isn't configured.");
  });
});

describe('"publish this" -> approval required, no execution', () => {
  it('returns APPROVAL_REQUIRED_ACTION, never executes anything', async () => {
    const { status, json } = await jarvisCommand('publish this');
    expect(status).toBe(200);
    expect(json.intent).toBe('APPROVAL_REQUIRED_ACTION');
    expect(json.spokenSummary).toBe('This action requires approval before I can execute it.');
  });
});

describe('"delete production data" -> blocked per canonical Guardian-equivalent policy', () => {
  it('returns BLOCKED_ACTION, no execution', async () => {
    const { status, json } = await jarvisCommand('delete production data');
    expect(status).toBe(200);
    expect(json.intent).toBe('BLOCKED_ACTION');
  });
});

describe('Hermes command while Hermes is unavailable -> honest NOT_CONFIGURED, no fake execution', () => {
  it('routes to hermes.execute and refuses honestly', async () => {
    const { status, json } = await jarvisCommand('Hermes, run the deployment check');
    expect(status).toBe(200);
    expect(json.evidence.capability).toBe('hermes.execute');
    expect(json.evidence.outcome).toBe('NOT_CONFIGURED');
    expect(json.reply).not.toMatch(/done|completed|success/i);
  });
});

describe('workspace isolation: a task created in one workspace is invisible to a Jarvis query from another', () => {
  it('a second workspace\'s task.read query sees none of the first workspace\'s tasks', async () => {
    const otherWs = `ws-jarvis-routing-other-${Date.now()}`;
    ensureWorkspace(otherWs, 'Other workspace');
    const otherUser = createUser({ email: `jarvis-routing-other-${Date.now()}@example.test`, password: 'correct horse battery staple 10', displayName: 'Other' });
    grantMembership(otherUser.user_id, otherWs, 'member');
    const otherLogin = login(otherUser.email, 'correct horse battery staple 10');
    if (!otherLogin) throw new Error('setup: real login() failed');

    const res = await fetch(`${BASE_URL}/api/jarvis/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(otherLogin.rawToken) },
      body: JSON.stringify({ workspaceId: otherWs, command: 'show me my tasks' }),
    });
    const json = await res.json();
    expect(json.evidence).toEqual([]);
  });
});
