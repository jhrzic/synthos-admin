import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 4: graph execution migrated onto the
// canonical fabric. Same method as test/fabric-characterization.test.ts and
// test/vault-notes-endpoint.test.ts: spawn the real, unmodified
// `tsx server.ts`, real HTTP requests, real SQLite/filesystem inspection —
// not a description of the source code.
//
// GEMINI_API_KEY is deliberately absent from this process and the spawned
// server's environment (same as every other fabric test file in this repo
// — no real key is available in this environment). That means a COMPUTE
// node's real-Gemini-SUCCESS path (and therefore the aggregate graph-run
// receipt's full VERIFIED path) is NOT live-executed here — it is proven
// STATICALLY in test/graph-windmill-target.test.ts and by construction (the
// aggregate path reuses the exact task/artifact/Aegis/receipt primitives
// already live-verified for lib/fabric/kernel.ts in Steps 1b-2). What IS
// live-executed here, with real HTTP/DB/filesystem: the COMPUTE
// BLOCKED_MISSING_CREDENTIAL path (real, since no key is configured), and
// the EXTERNAL_ACTION/Windmill path end-to-end against a real local mock
// Windmill server (same fixture pattern as test/external-executions.test.ts
// — a real HTTP server, not a stub function).
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-graph-step4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;
process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';

import { getDatabase, getTaskReceipts, verifyReceipt } from '../lib/persistence';
import { createUser, login } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { createWindmillTarget } from '../lib/windmill-targets';
import { VAULT_ROOT } from '../lib/vault';
import { classifyGraphNode } from '../lib/graph-execution';

const SESSION_COOKIE_NAME = 'synthos_session';
const WS = `ws-graph-step4-${Date.now()}`;
let userToken: string;
let actorUserId: string;

let mockWindmill: http.Server;
let windmillPort: number;
const jobs = new Map<string, { state: 'success' | 'failure'; result?: unknown }>();
const JOB_OK = '66666666-6666-6666-6666-666666666666';

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

async function executeGraph(body: any): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}/api/graphs/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(userToken) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  getDatabase();
  ensureWorkspace(WS, 'Graph Step 4 Test Workspace');
  const user = createUser({ email: `graph-step4-${Date.now()}@example.test`, password: 'correct horse battery staple 7', displayName: 'Graph Step 4 Tester' });
  grantMembership(user.user_id, WS, 'member');
  const loginResult = login(user.email, 'correct horse battery staple 7');
  if (!loginResult) throw new Error('setup: real login() failed');
  userToken = loginResult.rawToken;
  actorUserId = user.user_id;

  // Real local mock Windmill server — same shape as test/external-executions.test.ts.
  mockWindmill = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url || '';
      if (req.method === 'GET' && url === '/api/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('v-graph-step4'); }
      if (req.method === 'GET' && url === '/api/users/whoami') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ username: 'graph-step4-runner' })); }
      if (req.method === 'POST' && /\/jobs\/run\//.test(url)) {
        jobs.set(JOB_OK, { state: 'success', result: { finding: 'real synthetic external-action output' } });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(JOB_OK);
      }
      if (req.method === 'GET' && url.endsWith(`/jobs_u/get/${JOB_OK}`)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ type: 'CompletedJob', running: false, success: true, canceled: false }));
      }
      if (req.method === 'GET' && url.endsWith(`/jobs_u/get_completed_job_result/${JOB_OK}`)) {
        const job = jobs.get(JOB_OK);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(job?.result ?? {}));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => mockWindmill.listen(0, '127.0.0.1', resolve));
  const addr = mockWindmill.address();
  windmillPort = typeof addr === 'object' && addr ? addr.port : 0;

  PORT = await freePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SYNTHOS_DB_PATH: TEST_DB_PATH,
    PORT: String(PORT),
    MCP_ALLOW_LOCAL_ENDPOINTS: 'true',
    WINDMILL_BASE_URL: `http://127.0.0.1:${windmillPort}`,
    WINDMILL_TOKEN: 'graph-step4-token',
    WINDMILL_WORKSPACE: 'graph-step4-ws',
  };
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
  await new Promise<void>((resolve) => mockWindmill.close(() => resolve()));
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', WS), { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('classifyGraphNode: pure taxonomy, no runtime behavior of its own', () => {
  it('a non-agent node classifies CONTROL (never dispatched today, classification only)', () => {
    expect(classifyGraphNode({ id: 'n1', type: 'logic' })).toBe('CONTROL');
    expect(classifyGraphNode({ id: 'n2', type: 'trigger' })).toBe('CONTROL');
  });
  it('a native agent node (no windmill target) classifies COMPUTE', () => {
    expect(classifyGraphNode({ id: 'n3', type: 'agent' })).toBe('COMPUTE');
    expect(classifyGraphNode({ id: 'n4' })).toBe('COMPUTE'); // default type is 'agent'
  });
  it('an agent node with a real windmill runtime + target classifies EXTERNAL_ACTION', () => {
    expect(classifyGraphNode({ id: 'n5', type: 'agent', runtime: 'windmill', windmillTargetId: 'wmt-1' } as any)).toBe('EXTERNAL_ACTION');
  });
  it('a windmill runtime with no target id does NOT classify EXTERNAL_ACTION (G2 — no hidden fallback)', () => {
    expect(classifyGraphNode({ id: 'n6', type: 'agent', runtime: 'windmill' } as any)).toBe('COMPUTE');
  });
});

describe('STEP 4 LIVE: COMPUTE node, no GEMINI_API_KEY configured — real BLOCKED, no per-node task, halted FAILED', () => {
  it('a graph with one native agent node halts FAILED, BLOCKED_MISSING_CREDENTIAL, and creates zero per-node task rows', async () => {
    const runId = `run-step4-blocked-${Date.now()}`;
    const nodeId = 'compute-1';
    const { status, json } = await executeGraph({
      workspaceId: WS, confirmed: true, runId,
      nodes: [{ id: nodeId, type: 'agent', name: 'Native Compute Node' }],
      edges: [],
    });
    expect(status).toBe(200);
    expect(json.success).toBe(false);
    expect(json.status).toBe('FAILED'); // zero completed nodes before halt
    expect(json.completedNodes).toBe(0);
    expect(json.failedAtNode).toBe(nodeId);

    // The real, ordered node trace — this IS the node-level evidence, not a
    // per-node task record.
    const trace = json.nodeTrace;
    expect(trace.nodeId).toBe(nodeId);
    expect(trace.graphRunId).toBe(runId);
    expect(trace.order).toBe(0);
    expect(trace.classification).toBe('COMPUTE');
    expect(trace.status).toBe('BLOCKED');
    expect(trace.gate.passed).toBe(false);
    expect(trace.failure.reason).toBe('BLOCKED_MISSING_CREDENTIAL');
    expect(typeof trace.startedAt).toBe('string');
    expect(typeof trace.finishedAt).toBe('string');
    expect(trace.receiptId).toBeNull();
    expect(trace.artifact).toBeNull();

    // STEP 4's actual claim: no per-node task exists for a COMPUTE node —
    // not even the old naming convention `task-${runId}-${nodeId}` a
    // BLOCKED native node used to get under the pre-Step-4 kernel HTTP path.
    const db = getDatabase();
    const oldStyleTaskId = `task-${runId}-${nodeId}`;
    const row = db.prepare('SELECT task_id FROM tasks WHERE task_id = ?').get(oldStyleTaskId);
    expect(row).toBeUndefined();

    // Same real, ordered trace is persisted into the graph run's own record.
    const runRow = db.prepare('SELECT * FROM graph_runs WHERE run_id = ?').get(runId) as any;
    expect(runRow).toBeDefined();
    expect(runRow.status).toBe('FAILED');
    const state = JSON.parse(runRow.state_json);
    expect(state.nodeResults[nodeId].classification).toBe('COMPUTE');
    expect(state.nodeResults[nodeId].status).toBe('BLOCKED');
  });
});

describe('STEP 4 LIVE: EXTERNAL_ACTION (Windmill) node — unchanged, still gets its own real task + signed receipt', () => {
  it('a graph with one Windmill node completes, and that node alone carries a real, verifiable receipt; the graph run itself has no aggregate receipt (no native nodes)', async () => {
    const target = createWindmillTarget({ workspaceId: WS, name: 'Step4 target', remotePath: 'f/step4/report', kind: 'script', createdByUserId: actorUserId });
    const runId = `run-step4-windmill-${Date.now()}`;
    const nodeId = 'external-1';

    const { status, json } = await executeGraph({
      workspaceId: WS, confirmed: true, runId,
      nodes: [{ id: nodeId, type: 'agent', name: 'Windmill Node', runtime: 'windmill', windmillTargetId: target.id }],
      edges: [],
    });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status).toBe('COMPLETED');
    expect(json.nodesExecuted).toBe(1);

    const trace = json.nodes[0];
    expect(trace.classification).toBe('EXTERNAL_ACTION');
    expect(trace.agentOrRuntime).toBe('windmill');
    expect(trace.receiptId).toBeTruthy();
    expect(trace.externalExecutionId).toBeTruthy();

    // Real, independently-verifiable per-node receipt — unchanged from
    // before Step 4.
    const nodeTaskId = `task-${runId}-${nodeId}`;
    const receipts = getTaskReceipts(nodeTaskId);
    expect(receipts.length).toBe(1);
    expect(verifyReceipt(receipts[0])).toBe(true);

    // No native COMPUTE nodes ran, so no aggregate graph-run receipt was
    // built — an all-EXTERNAL_ACTION graph's own receipts stand alone.
    expect(json.graphRunReceipt).toBeNull();
    expect(json.finalState.graphRunReceipt).toBeNull();
  }, 15000);
});

describe('STEP 4 LIVE: mixed graph — EXTERNAL_ACTION success then COMPUTE halt — ordering, PARTIAL, and receipt survival', () => {
  it('the completed Windmill node keeps its real receipt even though the run halts PARTIAL at the next (COMPUTE) node', async () => {
    const target = createWindmillTarget({ workspaceId: WS, name: 'Step4 mixed target', remotePath: 'f/step4/mixed', kind: 'script', createdByUserId: actorUserId });
    const runId = `run-step4-mixed-${Date.now()}`;
    const externalNodeId = 'external-first';
    const computeNodeId = 'compute-second';

    const { status, json } = await executeGraph({
      workspaceId: WS, confirmed: true, runId,
      nodes: [
        { id: externalNodeId, type: 'agent', name: 'Windmill First', runtime: 'windmill', windmillTargetId: target.id },
        { id: computeNodeId, type: 'agent', name: 'Compute Second' },
      ],
      edges: [],
    });

    expect(status).toBe(200);
    expect(json.success).toBe(false);
    // One real node completed before the halt — PARTIAL, never collapsed
    // into FAILED (same distinction as before Step 4).
    expect(json.status).toBe('PARTIAL');
    expect(json.completedNodes).toBe(1);
    expect(json.failedAtNode).toBe(computeNodeId);
    // Ordering preserved: the completed node is the one declared first.
    expect(json.nodeExecution).toBeDefined();
    expect(json.nodeTrace.nodeId).toBe(computeNodeId);
    expect(json.nodeTrace.order).toBe(1);

    // The Windmill node's real receipt is untouched by the later halt.
    const externalTaskId = `task-${runId}-${externalNodeId}`;
    const receipts = getTaskReceipts(externalTaskId);
    expect(receipts.length).toBe(1);
    expect(verifyReceipt(receipts[0])).toBe(true);

    // The run's persisted state references BOTH nodes, in order, including
    // the one that halted it — reconstructable without any task query.
    const db = getDatabase();
    const runRow = db.prepare('SELECT * FROM graph_runs WHERE run_id = ?').get(runId) as any;
    const state = JSON.parse(runRow.state_json);
    expect(state.nodeResults[externalNodeId].order).toBe(0);
    expect(state.nodeResults[externalNodeId].classification).toBe('EXTERNAL_ACTION');
    expect(state.nodeResults[externalNodeId].receiptId).toBe(receipts[0].receipt_id);
    expect(state.nodeResults[computeNodeId].order).toBe(1);
    expect(state.nodeResults[computeNodeId].classification).toBe('COMPUTE');
    expect(state.nodeResults[computeNodeId].status).toBe('BLOCKED');
  }, 15000);
});

describe('STEP 4 workspace isolation: unaffected by the fabric migration', () => {
  it('a graph run created under WS is not visible to a different workspace', async () => {
    const db = getDatabase();
    const other = `ws-graph-step4-other-${Date.now()}`;
    ensureWorkspace(other, 'Other workspace');
    const runsForOther = db.prepare('SELECT run_id FROM graph_runs WHERE workspace_id = ?').all(other);
    expect(runsForOther.length).toBe(0);
    const runsForWs = db.prepare('SELECT run_id FROM graph_runs WHERE workspace_id = ?').all(WS);
    expect(runsForWs.length).toBeGreaterThan(0);
  });
});
