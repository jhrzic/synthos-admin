import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

// ---------------------------------------------------------------------------
// GRAPH NODES — output contracts and scoped verification, live.
//
// The real, unmodified `tsx server.ts` is spawned against an isolated DB and
// vault. Its native COMPUTE nodes call the real shared Gemini adapter through
// the real spend guard, pointed (GEMINI_BASE_URL) at a local HTTP double that
// records every request and replies with a scripted text and finishReason.
// Nothing leaves 127.0.0.1.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-graph-contract-'));
const DB = path.join(TMP, 'graph.db');
process.env.SYNTHOS_DB_PATH = DB;
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'g'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('graph-contract');

import { getDatabase, getTaskReceipts, verifyReceipt, getTaskWithHistory, getTaskArtifacts } from '../lib/persistence';
import { createUser, login } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { classifyModelRequest } from '../lib/model-router';
import { searchWorkspaceMemory, reindexWorkspaceMemory, getArtifactRetrievalStatus } from '../lib/memory-index';
import { allowPaidExecutionForTest } from './helpers/spend';
import { listUsageForKey } from '../lib/spend/ledger';
import { DEFAULT_SPEND_POLICY } from '../lib/spend/policy';

const WS = `ws-graph-contract-${Date.now()}`;
const MODEL_ALIAS = 'gemini-3.6-flash';
const ROUTE = classifyModelRequest(MODEL_ALIAS);
if (ROUTE.provider !== 'GEMINI') throw new Error(`${MODEL_ALIAS} no longer routes to Gemini`);
const MODEL = ROUTE.resolvedModel;
let token = '';
let BASE = '';
let child: ChildProcess;
let gemini: http.Server;

// Scripted replies, chosen by a marker in the node description.
type Reply = { text: string; finishReason: string | null };
let replies: Record<string, Reply> = {};
let requests: Array<{ path: string; prompt: string; maxOut: number | undefined }> = [];

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  getDatabase();
  ensureWorkspace(WS, 'Graph contracts');
  const user = createUser({ email: `graph-contract-${Date.now()}@example.test`, password: 'correct horse battery staple 9', displayName: 'Graph Contract' });
  grantMembership(user.user_id, WS, 'member');
  token = login(user.email, 'correct horse battery staple 9')!.rawToken;

  // Paid execution ON in this isolated DB only, Gemini only, fixture prices.
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  allowPaidExecutionForTest([['gemini', MODEL]], {
    providers: { ...Object.fromEntries(Object.keys(DEFAULT_SPEND_POLICY.providers).map((p) => [p, off])), gemini: { enabled: true, dailyUsd: 50, monthlyUsd: 50, maxConcurrent: 5 } },
  });

  gemini = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = JSON.parse(body || '{}');
      const prompt = JSON.stringify(p.contents ?? '');
      requests.push({ path: req.url || '', prompt, maxOut: p.generationConfig?.maxOutputTokens });
      const key = Object.keys(replies).find((k) => prompt.includes(k));
      const r = key ? replies[key] : { text: 'unscripted', finishReason: 'STOP' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        responseId: `resp-${requests.length}`,
        candidates: [{ content: { role: 'model', parts: [{ text: r.text }] }, ...(r.finishReason ? { finishReason: r.finishReason } : {}) }],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8, totalTokenCount: 48 },
      }));
    });
  });
  await new Promise<void>((r) => gemini.listen(0, '127.0.0.1', () => r()));

  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env, PORT: String(port), SYNTHOS_DB_PATH: DB,
    GEMINI_API_KEY: 'test-gemini-key-not-real',
    GEMINI_BASE_URL: `http://127.0.0.1:${(gemini.address() as any).port}`,
  };
  child = spawn(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['server.ts'], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 25000);
    child.stdout?.on('data', (d) => { out += d; if (out.includes('Server running on')) { clearTimeout(t); resolve(); } });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited (${c}):\n${out}`)); });
  });
}, 40000);

afterAll(async () => {
  if (child && !child.killed) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
  await new Promise<void>((r) => gemini.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => { requests = []; replies = {}; });

async function run(nodes: any[]) {
  const runId = `run-contract-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await fetch(`${BASE}/api/graphs/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `synthos_session=${token}` },
    body: JSON.stringify({ workspaceId: WS, confirmed: true, runId, nodes, edges: [] }),
  });
  return { runId, status: res.status, json: await res.json() };
}
const node = (id: string, marker: string, extra: Record<string, unknown> = {}) => ({ id, type: 'agent', name: `Node ${id}`, description: `Task ${marker}`, assignedAgent: 'scribe', assignedModel: MODEL_ALIAS, ...extra });
const receipts = (taskId: string) => getTaskReceipts(taskId).map((r) => ({ ...JSON.parse(r.payload_json), verified: verifyReceipt(r) }));
const inMemory = (artifactId: string, q: string) => searchWorkspaceMemory(WS, q, 50).map((r) => r.artifact_id).includes(artifactId);

// ============================================================================
describe('graph node — LITERAL contract', () => {
  it('exact literal: node passes on all required scopes, the contract prompt replaces the persona, graph COMPLETED with a COMPLETED receipt', async () => {
    replies = { MK_LIT_OK: { text: 'GRAPH-OK', finishReason: 'STOP' }, MK_NARR: { text: 'A narrative follow-up section.', finishReason: 'STOP' } };
    const { runId, status, json } = await run([
      node('lit', 'MK_LIT_OK', { outputContract: { mode: 'LITERAL', literal: 'GRAPH-OK' } }),
      node('narr', 'MK_NARR'),
    ]);
    expect(status).toBe(200);
    expect(json.status).toBe('COMPLETED');
    expect(json.success).toBe(true);
    const [lit] = json.nodes;
    expect(lit.status).toBe('DONE');
    expect(lit.outputContract).toEqual({ mode: 'LITERAL', literal: 'GRAPH-OK' });
    expect(lit.verification).toMatchObject({ completion: 'PASS', instructionCompliance: 'PASS', decision: 'VERIFIED' });
    expect(lit.termination.status).toBe('COMPLETE');
    // Persona never overrides a LITERAL contract; NARRATIVE nodes keep it.
    expect(requests[0].prompt).toContain('OUTPUT CONTRACT: reply with exactly the following text');
    expect(requests[1].prompt).not.toContain('OUTPUT CONTRACT');
    // One aggregate receipt stating outcome + scope.
    expect(json.graphRunReceipt).toMatchObject({ verified: true, outcome: 'COMPLETED' });
    const [agg] = receipts(`task-${runId}`);
    expect(agg).toMatchObject({ outcome: 'COMPLETED', verified: true });
    expect(agg.verificationScope).toBeTruthy();
    expect(requests).toHaveLength(2);
  });

  it('wrong literal: node VERIFICATION_FAILED, graph halts, the next node is never called, evidence quarantined', async () => {
    replies = { MK_LIT_BAD: { text: 'Here is a memo about grqzx instead.', finishReason: 'STOP' }, MK_AFTER: { text: 'should not run', finishReason: 'STOP' } };
    const { runId, json } = await run([
      node('lit', 'MK_LIT_BAD', { outputContract: { mode: 'LITERAL', literal: 'GRAPH-OK' } }),
      node('after', 'MK_AFTER'),
    ]);
    expect(json.success).toBe(false);
    expect(json.status).toBe('FAILED');
    expect(json.failedAtNode).toBe('lit');
    expect(json.nodeTrace.status).toBe('VERIFICATION_FAILED');
    expect(json.nodeTrace.gate.passed).toBe(false);
    expect(json.nodeTrace.verification).toMatchObject({ integrity: 'PASS', completion: 'PASS', instructionCompliance: 'FAIL' });
    expect(json.nodeTrace.quarantined).toBe(true);
    expect(json.nodeTrace.receiptOutcome).toBe('VERIFICATION_FAILED');
    // No advance: exactly one provider request, and no aggregate task.
    expect(requests).toHaveLength(1);
    expect(getTaskWithHistory(`task-${runId}`).task).toBeFalsy();
    // Per-node evidence: task terminal, audit receipt, artifact quarantined.
    const evidenceTask = json.nodeTrace.taskId;
    expect(getTaskWithHistory(evidenceTask).task!.status).toBe('VERIFICATION_FAILED');
    expect(receipts(evidenceTask)[0]).toMatchObject({ outcome: 'VERIFICATION_FAILED', verified: true });
    const art = getTaskArtifacts(evidenceTask)[0];
    expect(getArtifactRetrievalStatus(art.artifact_id)!.status).toBe('QUARANTINED');
    reindexWorkspaceMemory(WS);
    expect(inMemory(art.artifact_id, 'grqzx')).toBe(false);
  });
});

// ============================================================================
describe('graph node — truncation and missing termination', () => {
  it('truncation (MAX_TOKENS) after a passing node: node INCOMPLETE, run PARTIAL, no aggregate, excluded from memory', async () => {
    replies = { MK_FIRST: { text: 'First section complete.', finishReason: 'STOP' }, MK_TRUNC: { text: 'The analysis begins and then vtrunq', finishReason: 'MAX_TOKENS' }, MK_THIRD: { text: 'never', finishReason: 'STOP' } };
    const { runId, json } = await run([node('a', 'MK_FIRST'), node('b', 'MK_TRUNC'), node('c', 'MK_THIRD')]);
    expect(json.status).toBe('PARTIAL');
    expect(json.completedNodes).toBe(1);
    expect(json.nodeTrace.status).toBe('INCOMPLETE');
    expect(json.nodeTrace.termination.status).toBe('INCOMPLETE');
    expect(requests).toHaveLength(2);
    expect(getTaskWithHistory(`task-${runId}`).task).toBeFalsy();
    const art = getTaskArtifacts(json.nodeTrace.taskId)[0];
    expect(receipts(json.nodeTrace.taskId)[0].outcome).toBe('INCOMPLETE');
    reindexWorkspaceMemory(WS);
    expect(inMemory(art.artifact_id, 'vtrunq')).toBe(false);
  });

  it('missing termination: NARRATIVE passes (stated as NOT_REPORTED), LITERAL and JSON_OBJECT are INCOMPLETE', async () => {
    replies = { MK_NR_N: { text: 'Narrative with no finish reason.', finishReason: null } };
    const narr = await run([node('n', 'MK_NR_N')]);
    expect(narr.json.status).toBe('COMPLETED');
    expect(narr.json.nodes[0].verification.completion).toBe('NOT_REPORTED');
    // The aggregate cannot claim completion its nodes did not report.
    expect(narr.json.graphRunReceipt.verificationScope).toMatch(/NOT_REPORTED|not report|unverified/i);

    replies = { MK_NR_L: { text: 'GRAPH-OK', finishReason: null } };
    const lit = await run([node('l', 'MK_NR_L', { outputContract: { mode: 'LITERAL', literal: 'GRAPH-OK' } })]);
    expect(lit.json.nodeTrace.status).toBe('INCOMPLETE');

    replies = { MK_NR_J: { text: '{"a":1}', finishReason: null } };
    const js = await run([node('j', 'MK_NR_J', { outputContract: { mode: 'JSON_OBJECT', requiredKeys: ['a'] } })]);
    expect(js.json.nodeTrace.status).toBe('INCOMPLETE');
  });
});

// ============================================================================
describe('graph contracts are validated before anything runs', () => {
  it('an invalid contract on a later node refuses the whole run before any provider request', async () => {
    const { status, json } = await run([node('ok', 'MK_X'), node('bad', 'MK_Y', { outputContract: { mode: 'LITERAL' } })]);
    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_OUTPUT_CONTRACT');
    expect(json.nodeId).toBe('bad');
    expect(requests).toHaveLength(0);
  });

  it('a capability node may not declare a LITERAL / JSON_OBJECT contract it cannot honour', async () => {
    const { status, json } = await run([{ id: 'cap', type: 'capability', capability: 'aeo.audit', outputContract: { mode: 'JSON_OBJECT' } }]);
    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_OUTPUT_CONTRACT');
    expect(requests).toHaveLength(0);
  });

  it('no retry, fallback or duplicate call: one ledgered paid request per executed node, none after the halt', async () => {
    replies = { MK_R1: { text: 'fine', finishReason: 'STOP' }, MK_R2: { text: 'not the literal', finishReason: 'STOP' }, MK_R3: { text: 'never', finishReason: 'STOP' } };
    const { runId, json } = await run([
      node('r1', 'MK_R1'),
      node('r2', 'MK_R2', { outputContract: { mode: 'LITERAL', literal: 'GRAPH-OK' } }),
      node('r3', 'MK_R3'),
    ]);
    expect(json.nodeTrace.status).toBe('VERIFICATION_FAILED');
    expect(requests).toHaveLength(2);
    for (const r of requests) expect(r.path).toMatch(/:generateContent$/);
    expect(listUsageForKey(`graph:${runId}:r1`)).toHaveLength(1);
    expect(listUsageForKey(`graph:${runId}:r2`)).toHaveLength(1);
    expect(listUsageForKey(`graph:${runId}:r3`)).toHaveLength(0);
  });
});
