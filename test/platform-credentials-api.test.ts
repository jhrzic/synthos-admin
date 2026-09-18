import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';

const REPO_ROOT = process.cwd();
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-platform-cred-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getDatabase } from '../lib/persistence';
import { createUser, login } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import {
  getProviderCredentialStatus, listProviderCredentialStatuses,
  saveModelCredential, deleteModelCredential, resolveModelApiKey,
  SUPPORTED_MODEL_PROVIDERS,
} from '../lib/model-credentials';

// ---------------------------------------------------------------------------
// PUSH 2B — the provider-parameterized platform credential API.
//
// The thing under test is not "can a key be saved" but "can a key ESCAPE".
// A credential surface is only worth having if the value goes in and never
// comes back out — not in a status, not in a list, not in an error, not in
// the activity ledger. Most of this file is that one question asked from
// several directions.
//
// The rest asserts the two rules that make the API predictable: environment
// precedence is preserved, and an unauthorized caller gets nothing.
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'synthos_session';
let agServer: http.Server;
let agRequests = 0;
const WS_A = `ws-cred-a-${Date.now()}`;
const WS_B = `ws-cred-b-${Date.now()}`;

/** Obvious fakes. The point of this file is that they never come back. */
const STORED_OPENAI_KEY = 'sk-stored-openai-value-must-never-be-returned';
const STORED_GEMINI_KEY = 'AIza-stored-gemini-value-must-never-be-returned';
const ENV_OPENAI_KEY = 'sk-environment-openai-value-must-never-be-returned';

let child: ChildProcess;
let BASE_URL: string;
let adminToken: string;   // workspace admin of WS_A — NOT a platform admin
let platformToken: string; // platform_admin, the only role that may touch model credentials
let memberToken: string;  // plain member of WS_A
let otherToken: string;   // admin of WS_B only

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') { const p = addr.port; srv.close(() => resolve(p)); }
      else srv.close(() => reject(new Error('no free port')));
    });
  });
}

const cookie = (t: string) => `${SESSION_COOKIE_NAME}=${t}`;

async function api(method: 'GET' | 'POST', url: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: cookie(token) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body is itself the evidence */ }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  getDatabase();
  ensureWorkspace(WS_A, 'Credential API Workspace A');
  ensureWorkspace(WS_B, 'Credential API Workspace B');

  const admin = createUser({ email: `cred-admin-${Date.now()}@example.test`, password: 'correct horse battery staple 1', displayName: 'Cred Admin' });
  const member = createUser({ email: `cred-member-${Date.now()}@example.test`, password: 'correct horse battery staple 2', displayName: 'Cred Member' });
  const other = createUser({ email: `cred-other-${Date.now()}@example.test`, password: 'correct horse battery staple 3', displayName: 'Cred Other' });
  grantMembership(admin.user_id, WS_A, 'admin');
  grantMembership(member.user_id, WS_A, 'member');
  grantMembership(other.user_id, WS_B, 'admin');
  const platform = createUser({ email: `cred-platform-${Date.now()}@example.test`, password: 'correct horse battery staple 4', displayName: 'Cred Platform', platformRole: 'platform_admin' });

  adminToken = login(admin.email, 'correct horse battery staple 1')!.rawToken;
  memberToken = login(member.email, 'correct horse battery staple 2')!.rawToken;
  otherToken = login(other.email, 'correct horse battery staple 3')!.rawToken;
  platformToken = login(platform.email, 'correct horse battery staple 4')!.rawToken;

  const PORT = await freePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;

  const env: NodeJS.ProcessEnv = { ...process.env, SYNTHOS_DB_PATH: TEST_DB_PATH, PORT: String(PORT) };
  // Deterministic: the server must start with NO provider environment keys,
  // so "NOT_CONFIGURED" and "STORED" are properties of the code rather than
  // of whatever shell happens to run the suite.
  delete env.OPENAI_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.ANTIGRAVITY_API_KEY;
  delete env.ANTIGRAVITY_ENABLED;
  delete env.SYNTHOS_AUTONOMY_LEVEL;
  // A counting stand-in for Google's managed-agent endpoint. The control
  // surface must never contact Antigravity; this proves it by observation.
  agServer = http.createServer((_req, res) => { agRequests += 1; res.writeHead(500); res.end('{}'); });
  await new Promise<void>((r) => agServer.listen(0, '127.0.0.1', () => r()));
  env.ANTIGRAVITY_BASE_URL = `http://127.0.0.1:${(agServer.address() as any).port}`;

  child = spawn(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['server.ts'], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`server did not start in 25s:\n${out}`)), 25000);
    child.stdout?.on('data', (d) => { out += d.toString(); if (out.includes('Server running on')) { clearTimeout(t); resolve(); } });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited early (${c}):\n${out}`)); });
  });
}, 40000);

afterAll(async () => {
  if (agServer) await new Promise<void>((r) => agServer.close(() => r()));
  if (child && !child.killed) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  delete process.env.OPENAI_API_KEY;
});

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  for (const p of SUPPORTED_MODEL_PROVIDERS) deleteModelCredential(p);
});

describe('1. ONE route serves every provider — extensible without a new endpoint', () => {
  it('lists every supported provider, and openai is genuinely among them', async () => {
    const { status, json } = await api('GET', `/api/platform/model-credentials?workspaceId=${WS_A}`, platformToken);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const names = json.providers.map((p: any) => p.provider).sort();
    expect(names).toEqual([...SUPPORTED_MODEL_PROVIDERS].sort());
    expect(names).toContain('openai');
    expect(names).toContain('gemini');
  });

  it('an unknown provider is refused by name rather than silently treated as one of the real ones', async () => {
    const { status, json } = await api('GET', `/api/platform/model-credentials/anthropic?workspaceId=${WS_A}`, platformToken);
    expect(status).toBe(400);
    expect(json.error).toContain('Unsupported provider');
    expect(json.error).toContain('anthropic');
  });

  it('an unknown provider cannot be written to either', async () => {
    const { status } = await api('POST', '/api/platform/model-credentials/notaprovider', platformToken, { workspaceId: WS_A, apiKey: 'x' });
    expect(status).toBe(400);
  });
});

describe('2. TRUTHFUL STATE — the vocabulary an operator surface renders', () => {
  it('with nothing configured the state is NOT_CONFIGURED, and configured is false', async () => {
    const { json } = await api('GET', `/api/platform/model-credentials/openai?workspaceId=${WS_A}`, platformToken);
    expect(json.status.state).toBe('NOT_CONFIGURED');
    expect(json.status.configured).toBe(false);
    expect(json.status.envVar).toBe('OPENAI_API_KEY');
    expect(json.status.storedRowPresent).toBe(false);
  });

  it('a stored key reads STORED, and the state flips back when it is deleted', async () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    expect(getProviderCredentialStatus('openai').state).toBe('STORED');
    expect(getProviderCredentialStatus('openai').configured).toBe(true);

    deleteModelCredential('openai');
    expect(getProviderCredentialStatus('openai').state).toBe('NOT_CONFIGURED');
    expect(getProviderCredentialStatus('openai').configured).toBe(false);
  });

  it('ENVIRONMENT PRECEDENCE is preserved: an env var wins over a stored row, and says so', () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    process.env.OPENAI_API_KEY = ENV_OPENAI_KEY;
    try {
      const status = getProviderCredentialStatus('openai');
      expect(status.state).toBe('ENVIRONMENT');
      expect(status.storedRowPresent).toBe(true);
      // The operator who saved a key and saw nothing change is told why.
      expect(status.overriddenByEnvironment).toBe(true);
      // And the key actually in use is the environment one.
      expect(resolveModelApiKey('openai').source).toBe('environment');
    } finally { delete process.env.OPENAI_API_KEY; }
  });

  it('a stored OpenAI key really resolves for execution — the point of storing it', () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    const resolved = resolveModelApiKey('openai');
    expect(resolved.source).toBe('server_store');
    expect(resolved.apiKey).toBe(STORED_OPENAI_KEY);
  });

  it('delete removes only the STORED row and never claims to have removed an environment variable', () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    process.env.OPENAI_API_KEY = ENV_OPENAI_KEY;
    try {
      deleteModelCredential('openai');
      const status = getProviderCredentialStatus('openai');
      expect(status.storedRowPresent).toBe(false);
      // Still configured, because the environment still supplies it. Reporting
      // NOT_CONFIGURED here would be a lie the operator would act on.
      expect(status.state).toBe('ENVIRONMENT');
      expect(status.configured).toBe(true);
    } finally { delete process.env.OPENAI_API_KEY; }
  });

  it('providers are independent — configuring one says nothing about another', () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    const all = listProviderCredentialStatuses();
    expect(all.find((p) => p.provider === 'openai')!.configured).toBe(true);
    expect(all.find((p) => p.provider === 'gemini')!.configured).toBe(false);
  });
});

describe('3. SECRET REDACTION — the value goes in and never comes back out', () => {
  it('saving over HTTP returns a status that does not contain the key anywhere in the response', async () => {
    const { status, json, text } = await api('POST', '/api/platform/model-credentials/openai', platformToken, { workspaceId: WS_A, apiKey: STORED_OPENAI_KEY });
    expect(status).toBe(200);
    expect(json.status.state).toBe('STORED');
    // The whole response body, not just the field we expected to be safe.
    expect(text).not.toContain(STORED_OPENAI_KEY);
  });

  it('neither the single-provider read nor the list ever carries a value', async () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    saveModelCredential({ provider: 'gemini', apiKey: STORED_GEMINI_KEY, userId: 'test' });

    const one = await api('GET', `/api/platform/model-credentials/openai?workspaceId=${WS_A}`, platformToken);
    const all = await api('GET', `/api/platform/model-credentials?workspaceId=${WS_A}`, platformToken);
    for (const body of [one.text, all.text]) {
      expect(body).not.toContain(STORED_OPENAI_KEY);
      expect(body).not.toContain(STORED_GEMINI_KEY);
    }
  });

  it('a verify against a bogus key surfaces the failure without echoing the key back', async () => {
    const { text } = await api('POST', '/api/platform/model-credentials/openai', platformToken, {
      workspaceId: WS_A, action: 'save', apiKey: STORED_OPENAI_KEY,
    });
    // Save triggers a real verification attempt; it fails (no such account),
    // and that failure must not carry the credential.
    expect(text).not.toContain(STORED_OPENAI_KEY);
  });

  it('the key is encrypted at rest — the raw value is not sitting in the table', () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    const rows = getDatabase().prepare('SELECT * FROM model_credentials').all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(STORED_OPENAI_KEY);
  });

  it('no credential reaches the activity ledger, the runtime event ledger, or receipts', () => {
    saveModelCredential({ provider: 'openai', apiKey: STORED_OPENAI_KEY, userId: 'test' });
    const db = getDatabase();
    for (const table of ['activity_events', 'runtime_events', 'receipts', 'artifacts', 'memory_index', 'development_tasks']) {
      let rows: any[] = [];
      try { rows = db.prepare(`SELECT * FROM ${table}`).all() as any[]; } catch { continue; }
      expect(JSON.stringify(rows)).not.toContain(STORED_OPENAI_KEY);
    }
  });
});

describe('4. AUTHORIZATION — unauthorized callers get nothing', () => {
  it('no session at all is refused', async () => {
    const { status } = await api('GET', `/api/platform/model-credentials?workspaceId=${WS_A}`);
    expect(status).toBe(401);
  });

  // THE AUTHORITY FIX. Model credentials are platform-global; administering
  // one customer workspace confers no authority over them.
  it('a workspace ADMIN (not platform admin) cannot read, save, verify or delete — on either route family', async () => {
    const reads = [
      `/api/platform/model-credentials?workspaceId=${WS_A}`,
      `/api/platform/model-credentials/openai?workspaceId=${WS_A}`,
      `/api/business/model-credential?workspaceId=${WS_A}`,
      `/api/business/model-credentials?workspaceId=${WS_A}`,
    ];
    for (const url of reads) {
      expect((await api('GET', url, adminToken)).status, url).toBe(403);
    }
    for (const action of ['save', 'verify', 'delete']) {
      const a = await api('POST', '/api/platform/model-credentials/openai', adminToken, { workspaceId: WS_A, action, apiKey: 'sk-ws-admin-attempt' });
      expect(a.status, `platform ${action}`).toBe(403);
      const b = await api('POST', '/api/business/model-credential', adminToken, { workspaceId: WS_A, provider: 'openai', action, apiKey: 'sk-ws-admin-attempt' });
      expect(b.status, `business ${action}`).toBe(403);
    }
    expect(getProviderCredentialStatus('openai').storedRowPresent).toBe(false);
    expect(JSON.stringify(getDatabase().prepare('SELECT * FROM model_credentials').all())).not.toContain('sk-ws-admin-attempt');
  });

  it('a platform admin needs NO workspace membership to manage platform credentials', async () => {
    const { status, json } = await api('GET', '/api/platform/model-credentials', platformToken);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('a plain workspace MEMBER cannot read credential state — this is admin-only', async () => {
    const { status } = await api('GET', `/api/platform/model-credentials?workspaceId=${WS_A}`, memberToken);
    expect(status).toBe(403);
  });

  it('a member cannot write a credential either', async () => {
    const { status } = await api('POST', '/api/platform/model-credentials/openai', memberToken, { workspaceId: WS_A, apiKey: 'sk-should-never-be-stored' });
    expect(status).toBe(403);
    expect(getProviderCredentialStatus('openai').storedRowPresent).toBe(false);
  });

  it('an admin of ANOTHER workspace cannot use this workspace to reach the surface', async () => {
    const read = await api('GET', `/api/platform/model-credentials?workspaceId=${WS_A}`, otherToken);
    expect(read.status).toBe(403);
    const write = await api('POST', '/api/platform/model-credentials/openai', otherToken, { workspaceId: WS_A, apiKey: 'sk-cross-workspace-attempt' });
    expect(write.status).toBe(403);
    expect(getProviderCredentialStatus('openai').storedRowPresent).toBe(false);
  });

  it('a refused write leaves no trace of the attempted key anywhere', async () => {
    await api('POST', '/api/platform/model-credentials/openai', memberToken, { workspaceId: WS_A, apiKey: 'sk-refused-write-value' });
    const rows = getDatabase().prepare('SELECT * FROM model_credentials').all() as any[];
    expect(JSON.stringify(rows)).not.toContain('sk-refused-write-value');
  });
});

describe('5. THE CONCIERGE PATH IS UNCHANGED', () => {
  it('the existing Gemini route still works and still reports its own shape', async () => {
    const { status, json } = await api('GET', `/api/business/model-credential?workspaceId=${WS_A}`, platformToken);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status.provider).toBe('gemini');
    expect(json.status).toHaveProperty('apiKeyPresent');
  });

  it('a key saved through the shared provider route is visible to the Concierge route — one store, not two', async () => {
    await api('POST', '/api/platform/model-credentials/gemini', platformToken, { workspaceId: WS_A, apiKey: STORED_GEMINI_KEY });
    const { json } = await api('GET', `/api/business/model-credential?workspaceId=${WS_A}`, platformToken);
    expect(json.status.apiKeyPresent).toBe(true);
    expect(json.status.source).toBe('server_store');
  });
});

describe('6. DEVELOPMENT-LOOP API COMPLETENESS — every step of the copy/paste-free flow is reachable', () => {
  let devTaskId: string;

  it('a task can be created over HTTP by a workspace admin', async () => {
    const { status, json } = await api('POST', '/api/development/tasks', adminToken, {
      workspaceId: WS_A, title: 'API completeness task',
      instruction: 'Create a file, read it back and report the contents.',
    });
    expect(status).toBe(200);
    expect(json.task.state).toBe('WAITING_FOR_REVIEW');
    devTaskId = json.task.dev_task_id;
  });

  it('a member may READ the queue but may not create, review, approve or dispatch', async () => {
    expect((await api('GET', `/api/development/tasks?workspaceId=${WS_A}`, memberToken)).status).toBe(200);
    for (const [method, url] of [
      ['POST', '/api/development/tasks'],
      ['POST', `/api/development/tasks/${devTaskId}/review`],
      ['POST', `/api/development/tasks/${devTaskId}/approve`],
      ['POST', `/api/development/tasks/${devTaskId}/dispatch`],
    ] as const) {
      const { status } = await api(method, url, memberToken, { workspaceId: WS_A, title: 't', instruction: 'i' });
      expect(status).toBe(403);
    }
  });

  it('review reports NOT_CONFIGURED truthfully with no key, and leaves the task exactly where it was', async () => {
    const { status, json } = await api('POST', `/api/development/tasks/${devTaskId}/review`, adminToken, { workspaceId: WS_A });
    expect(status).toBe(200);
    expect(json.success).toBe(false);
    expect(json.review.outcome).toBe('NOT_CONFIGURED');
    expect(json.review.reason).toContain('OPENAI_API_KEY');
    expect(json.task.state).toBe('WAITING_FOR_REVIEW');
  });

  it('approval is refused while the task is not waiting for approval', async () => {
    const { status } = await api('POST', `/api/development/tasks/${devTaskId}/approve`, adminToken, { workspaceId: WS_A });
    expect(status).toBe(409);
  });

  it('the whole queue and a single task are both readable, and scoped to the workspace', async () => {
    const list = await api('GET', `/api/development/tasks?workspaceId=${WS_A}`, adminToken);
    expect(list.json.tasks.map((t: any) => t.dev_task_id)).toContain(devTaskId);

    const one = await api('GET', `/api/development/tasks/${devTaskId}?workspaceId=${WS_A}`, adminToken);
    expect(one.json.task.dev_task_id).toBe(devTaskId);

    // Another workspace's admin cannot see it, and cannot address it.
    const cross = await api('GET', `/api/development/tasks?workspaceId=${WS_B}`, otherToken);
    expect(cross.json.tasks.map((t: any) => t.dev_task_id)).not.toContain(devTaskId);
  });

  // Approval is always required and IS the go signal: approving dispatches in
  // the same request, so a Guardian refusal surfaces on approve.
  it('approving a Guardian-refused instruction returns 403 BLOCKED with the reason, not a 500', async () => {
    const created = await api('POST', '/api/development/tasks', adminToken, {
      workspaceId: WS_A, title: 'Destructive', instruction: 'rm -rf / and report',
      requiresReview: false, requiresApproval: false,
    });
    expect(created.json.task.state).toBe('WAITING_FOR_APPROVAL');
    const { status, json } = await api('POST', `/api/development/tasks/${created.json.task.dev_task_id}/approve`, adminToken, { workspaceId: WS_A });
    expect(status).toBe(403);
    expect(json.task.state).toBe('BLOCKED');
    expect(json.task.state_reason).toContain('Guardian refused');
  });

  it('there is deliberately NO advance endpoint — advancement belongs to the scheduler', async () => {
    const { status } = await api('POST', `/api/development/tasks/${devTaskId}/advance`, adminToken, { workspaceId: WS_A });
    expect(status).toBe(404);
  });

  it('state changes really land in the runtime event ledger, which is what a live surface reads', () => {
    const rows = getDatabase()
      .prepare("SELECT * FROM runtime_events WHERE workspace_id = ? AND target_type = 'development_task' ORDER BY rowid")
      .all(WS_A) as any[];
    expect(rows.length).toBeGreaterThan(0);
    const blocked = rows.find((r) => r.status === 'BLOCKED');
    expect(blocked).toBeTruthy();
    // BLOCKED is kept distinct from FAILED: nothing was attempted.
    expect(blocked.status).not.toBe('FAILED');
    expect(JSON.parse(blocked.detail_json).state).toBe('BLOCKED');
  });

  it('the live event stream is authenticated and emits only real recorded events', async () => {
    expect((await api('GET', `/api/development/events?workspaceId=${WS_A}`)).status).toBe(401);

    const res = await fetch(`${BASE_URL}/api/development/events?workspaceId=${WS_A}`, { headers: { Cookie: cookie(adminToken) } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const frame = Buffer.from(value!).toString('utf8');
    // Primed from the ledger, so a freshly opened surface is correct immediately.
    expect(frame).toMatch(/event: (runtime|ready)/);
    expect(frame).not.toContain(STORED_OPENAI_KEY);
    await reader.cancel();
  });
});


// ---------------------------------------------------------------------------
// CONTROL-PLANE GAPS — readiness leak, and Antigravity/autonomy from the Admin.
// ---------------------------------------------------------------------------

describe('7. BUSINESS READINESS does not leak platform configuration to a workspace', () => {
  const rowsFor = async (token: string) => {
    const { status, json } = await api('GET', `/api/business/readiness?workspaceId=${WS_A}`, token);
    expect(status).toBe(200);
    return Object.fromEntries((json.items as any[]).map((i) => [i.key, i]));
  };

  it('a member and a workspace admin see MANAGED — identical whether a platform key exists or not', async () => {
    const before = { member: await rowsFor(memberToken), admin: await rowsFor(adminToken) };
    saveModelCredential({ provider: 'gemini', apiKey: STORED_GEMINI_KEY, userId: 'test' });
    const after = { member: await rowsFor(memberToken), admin: await rowsFor(adminToken) };
    for (const who of ['member', 'admin'] as const) {
      for (const key of ['LLM', 'VOICE_OUTPUT']) {
        expect(after[who][key].state, `${who} ${key}`).toBe('MANAGED');
        expect(after[who][key]).toEqual(before[who][key]); // not an oracle
      }
      const text = JSON.stringify(after[who]);
      expect(text).not.toMatch(/GEMINI_API_KEY|encrypted store|environment|free tier|FREE_TIER/i);
    }
  });

  it('workspace-scoped readiness is still reported to members', async () => {
    const rows = await rowsFor(memberToken);
    for (const key of ['ASSISTANT', 'KNOWLEDGE', 'PUBLICATION', 'DOMAIN']) expect(rows[key]).toBeTruthy();
  });

  it('a platform admin who is a member of the workspace sees the real platform detail', async () => {
    const u = createUser({ email: `cred-platform-member-${Date.now()}@example.test`, password: 'correct horse battery staple 5', displayName: 'P', platformRole: 'platform_admin' });
    grantMembership(u.user_id, WS_A, 'member');
    const token = login(u.email, 'correct horse battery staple 5')!.rawToken;
    saveModelCredential({ provider: 'gemini', apiKey: STORED_GEMINI_KEY, userId: 'test' });
    const rows = await rowsFor(token);
    expect(rows.LLM.state).toBe('READY');
    expect(JSON.stringify(rows)).not.toContain(STORED_GEMINI_KEY);
  });

  it('another workspace\'s admin cannot read this workspace\'s readiness at all', async () => {
    const { status } = await api('GET', `/api/business/readiness?workspaceId=${WS_A}`, otherToken);
    expect(status).toBe(403);
  });
});

describe('8. ANTIGRAVITY + AUTONOMY are operated from the Admin by a platform admin only', () => {
  const auditRows = (targetId: string) =>
    getDatabase().prepare('SELECT event_type, detail_json FROM admin_audit_events WHERE target_id = ? ORDER BY created_at').all(targetId) as any[];

  it('member, workspace admin and another workspace\'s admin get 403 on every control', async () => {
    for (const token of [memberToken, adminToken, otherToken]) {
      expect((await api('GET', '/api/master-admin/antigravity', token)).status).toBe(403);
      expect((await api('POST', '/api/master-admin/antigravity/enabled', token, { enabled: true })).status).toBe(403);
      expect((await api('POST', '/api/master-admin/autonomy', token, { level: 'APPROVAL_GATED_EXTERNAL' })).status).toBe(403);
      expect((await api('POST', '/api/master-admin/antigravity/credential', token, { action: 'save', apiKey: 'ag-forbidden-attempt-000000' })).status).toBe(403);
    }
    expect(JSON.stringify(getDatabase().prepare('SELECT * FROM model_credentials').all())).not.toContain('ag-forbidden-attempt');
  });

  it('defaults are safe: disabled, INTERNAL_AUTOMATION, NOT_READY, never live-verified', async () => {
    const { status, json } = await api('GET', '/api/master-admin/antigravity', platformToken);
    expect(status).toBe(200);
    expect(json.status.implementation).toBe('IMPLEMENTED');
    expect(json.status.enabled.value).toBe(false);
    expect(json.status.autonomy.level).toBe('INTERNAL_AUTOMATION');
    expect(json.status.readiness).toBe('NOT_READY');
    expect(json.status.lastLiveVerified).toBeNull();
  });

  it('credential, enablement and autonomy can all be set from the Admin, audited, effective without a restart', async () => {
    const save = await api('POST', '/api/master-admin/antigravity/credential', platformToken, { action: 'save', apiKey: 'ag-admin-saved-key-must-not-echo-0000' });
    expect(save.status).toBe(200);
    expect(save.text).not.toContain('ag-admin-saved-key-must-not-echo');
    expect(save.json.status.credential.state).toBe('CONFIGURED');
    expect(save.json.status.credential.source).toBe('antigravity_store');

    const en = await api('POST', '/api/master-admin/antigravity/enabled', platformToken, { enabled: true });
    expect(en.status).toBe(200);
    expect(en.json.status.enabled).toMatchObject({ value: true, source: 'platform_setting', locked: false });
    expect(en.json.status.readiness).toBe('READY_FOR_LIVE_VERIFICATION');

    const au = await api('POST', '/api/master-admin/autonomy', platformToken, { level: 'APPROVAL_GATED_EXTERNAL' });
    expect(au.status).toBe(200);
    expect(au.json.status.autonomy.level).toBe('APPROVAL_GATED_EXTERNAL');

    // The RUNNING server (not this process) now sees the capability as dispatchable.
    const again = await api('GET', '/api/master-admin/antigravity', platformToken);
    expect(again.json.status.readiness).toBe('READY_FOR_LIVE_VERIFICATION');

    expect(auditRows('antigravity').map((r) => r.event_type)).toContain('RUNTIME_CREDENTIAL_SAVED');
    expect(auditRows('antigravity.enabled').map((r) => r.event_type)).toContain('PLATFORM_SETTING_CHANGED');
    const autonomyAudit = auditRows('autonomy.level');
    expect(autonomyAudit.length).toBeGreaterThan(0);
    expect(JSON.parse(autonomyAudit[autonomyAudit.length - 1].detail_json)).toMatchObject({ from: 'INTERNAL_AUTOMATION', to: 'APPROVAL_GATED_EXTERNAL' });
    const audited = JSON.stringify(getDatabase().prepare('SELECT * FROM admin_audit_events').all());
    expect(audited).not.toContain('ag-admin-saved-key-must-not-echo');

    // Restore the safe state for anything that runs after.
    await api('POST', '/api/master-admin/antigravity/enabled', platformToken, { enabled: false });
    await api('POST', '/api/master-admin/autonomy', platformToken, { level: 'INTERNAL_AUTOMATION' });
    const del = await api('POST', '/api/master-admin/antigravity/credential', platformToken, { action: 'delete' });
    expect(del.json.status.credential.state).toBe('NOT_CONFIGURED');
  });

  it('an invalid autonomy level or a non-boolean enable is refused', async () => {
    expect((await api('POST', '/api/master-admin/autonomy', platformToken, { level: 'FULLY_AUTONOMOUS' })).status).toBe(400);
    expect((await api('POST', '/api/master-admin/antigravity/enabled', platformToken, { enabled: 'yes' })).status).toBe(400);
  });

  it('no control in this suite ever contacted Antigravity', () => {
    expect(agRequests).toBe(0);
  });
});
