import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// SHUTDOWN DRAIN — the fix for the task-restart-1789678099 orphan.
//
// Old condition, reproduced: a task the service had started in the background
// was mid-dispatch when the service stopped; shutdown waited only for HTTP,
// exited, and left the task RUNNING with no record of the interruption.
//
// Real kernel, real spend guard, real continuity, one counting LOCAL FAKE
// provider on 127.0.0.1. No real provider is contacted.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-drain-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'drain.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('drain');

import { getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { qualifyModel, enableModel } from '../lib/registry';
import { importManifest } from '../lib/registry/store';
import { insertQualificationForTest, listQualifications } from '../lib/registry/qualification';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureUsageTable } from '../lib/spend/ledger';
import { invalidateProviderEndpointCache } from '../lib/spend/network-guard';
import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import { routedModelCall } from '../lib/fabric/routed-call';
import { runOrchestrationTick } from '../lib/fabric/orchestrator';
import { startScheduler, stopScheduler, getSchedulerHealth, resetSchedulerHealthForTests, drainAndSettle } from '../lib/fabric/scheduler';
import { settleInterruptedAtShutdown } from '../lib/continuity/orphans';
import { resetLifecycleForTests, beginDraining, lifecycleState } from '../lib/runtime-lifecycle';

const WS = 'ws-drain';
const PUB = 'drain-pub';
type Mode = 'ok' | 'slow' | 'hang' | 'slow429';
let mode: Mode = 'ok';
let requests = 0;
let server: http.Server;
const hung: http.ServerResponse[] = [];

beforeAll(async () => {
  getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Drain');
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests += 1;
      const answer = () => {
        if (mode === 'slow429') { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } })); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: `d-${requests}`, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'DRAIN OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
      };
      if (mode === 'hang') { hung.push(res); return; }
      if (mode === 'slow' || mode === 'slow429') { setTimeout(answer, 300); return; }
      answer();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.DRAIN_PUB_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.DRAIN_PUB_API_KEY = 'sk-drain-pub-0000000000000000000000';
  const now = Date.now(); const iso = (ms: number) => new Date(ms).toISOString();
  const r = importManifest({
    schemaVersion: 'synthos.registry/v1', manifestVersion: 'drain-1', provenance: { publisher: 'synthos-test-fixtures', generatedAt: iso(now) },
    provider: { providerId: PUB, displayName: PUB, protocol: 'openai.chat_completions', adapterVersion: '1.0.0', approvedHosts: ['api.drain-pub.example'], defaultBaseUrl: 'https://api.drain-pub.example/v1', baseUrlEnvVar: 'DRAIN_PUB_BASE_URL', auth: { type: 'BEARER', credentialSlot: null, envVars: ['DRAIN_PUB_API_KEY'] }, billing: 'METERED', restrictions: { regions: [], compliance: [] } },
    models: [{
      modelId: 'm', aliases: [], displayName: 'm', lifecycle: 'ACTIVE', releaseDate: null, deprecationDate: null, shutdownDate: null,
      limits: { contextTokens: 128000, outputTokens: 4096 }, modalities: { input: ['text'], output: ['text'] },
      capabilities: [{ id: 'text.input', supported: true, source: 'f', verification: 'PUBLISHER_ASSERTED', effectiveDate: null }, { id: 'text.output', supported: true, source: 'f', verification: 'PUBLISHER_ASSERTED', effectiveDate: null }],
      supportedParameters: ['max_tokens'], outputContracts: ['NARRATIVE', 'LITERAL', 'JSON_OBJECT'],
      pricing: [{ currency: 'USD', unit: 'tokens', rates: { input: 1, output: 2, cachedInput: 0.5 }, reasoningTokens: 'BILLED_AS_OUTPUT', tiers: [], toolCharges: [], modalityCharges: [], effectiveFrom: iso(now - 86_400_000), effectiveUntil: null, source: 'f', verifiedAt: iso(now), staleAfter: iso(now + 30 * 86_400_000), approval: 'APPROVED' }],
      adapterCompatibility: { protocol: 'openai.chat_completions', minAdapterVersion: '1.0.0' }, restrictions: { regions: [], compliance: [] },
    }],
  }, { source: 'PLUGIN', actor: 'test' });
  if (!r.ok) throw new Error(r.errors.join('; '));
  expect(qualifyModel(PUB, 'm', 'test').ok).toBe(true);
  expect(enableModel(PUB, 'm', 'test').ok).toBe(true);
  listQualifications();
  insertQualificationForTest({ providerId: PUB, modelId: 'm', taskClass: 'literal_transformation' });
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  const pol = saveSpendPolicy({ ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: true, global: { dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 }, providers: { ...Object.fromEntries(Object.keys(DEFAULT_SPEND_POLICY.providers).map((p) => [p, off])), [PUB]: { enabled: true, dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 } }, workspaceDefault: { dailyUsd: 10, maxConcurrent: 5 }, task: { maxEstimatedUsd: 1, maxInputChars: 200_000, maxOutputTokens: 1000, maxTier: 'PREMIUM' }, approvalThresholdUsd: 1 }, 'test');
  if (!pol.ok) throw new Error(pol.errors.join('; '));
});

afterAll(async () => {
  for (const r of hung) { try { r.destroy(); } catch {} }
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.DRAIN_PUB_BASE_URL; delete process.env.DRAIN_PUB_API_KEY;
  resetLifecycleForTests();
});

beforeEach(() => {
  resetLifecycleForTests(); resetSchedulerHealthForTests(); stopScheduler();
  mode = 'ok'; requests = 0;
  invalidateProviderEndpointCache();
  getDatabase().exec("DELETE FROM runtime_events WHERE target_type = 'provider'");
});

let seq = 0;
const startTask = () => {
  const taskId = `drain-task-${Date.now()}-${seq++}`;
  const done = executeAgentTask({ taskId, taskTitle: 'Drain', description: 'Reply with exactly: DRAIN OK', assignedAgent: 'scribe', assignedModel: `${PUB}/m`, taskClass: 'literal_transformation', outputContract: { mode: 'LITERAL', literal: 'DRAIN OK' }, spendIdempotencyKey: `drain:${taskId}` } as any, WS, createExecutionContext({ workspaceId: WS }));
  return { taskId, done };
};
const status = (id: string) => (getDatabase().prepare('SELECT status FROM tasks WHERE task_id = ?').get(id) as any)?.status;
const ledger = (id: string) => getDatabase().prepare('SELECT usage_id, status, reason_code FROM provider_usage WHERE task_id = ?').all(id) as any[];
const events = (id: string) => (getDatabase().prepare('SELECT event_type FROM activity_events WHERE task_id = ? ORDER BY rowid').all(id) as any[]).map((r) => r.event_type);
const waitFor = async (cond: () => boolean, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

describe('draining refuses new work', () => {
  it('shutdown before dispatch: a new task is refused with zero writes and zero requests; the orchestrator claims nothing; the guard sends nothing', async () => {
    const report = await drainAndSettle({ timeoutMs: 100, actor: 'test' });
    expect(report.settledWithinTimeout).toBe(true);
    expect(lifecycleState().state).toBe('DRAINING');
    const { taskId, done } = startTask();
    const r = await done;
    expect(r).toMatchObject({ status: 503, body: { reason: 'SERVICE_DRAINING' } });
    expect(status(taskId)).toBeUndefined(); // not even created
    const tick = await runOrchestrationTick({ workspaceId: WS });
    expect(tick).toMatchObject({ considered: 0, steps: [] });
    const call = await routedModelCall({ callSite: 'admin.provider_test', workspaceId: WS, model: `${PUB}/m`, prompt: 'Reply with exactly: X', idempotencyKey: `drain-guard-${Date.now()}` });
    expect(call.ok).toBe(false);
    expect(JSON.stringify(call)).toMatch(/SERVICE_DRAINING/);
    expect(requests).toBe(0);
  });

  it('the scheduler refuses to re-arm while draining, and a tick already armed claims nothing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      startScheduler(1000);
      vi.advanceTimersByTime(1000);
      expect(getSchedulerHealth().ticks).toBe(1);
      beginDraining('test');
      vi.advanceTimersByTime(3000);
      expect(getSchedulerHealth().ticks).toBe(1);
      expect(getSchedulerHealth().drainRefusedTicks).toBe(3);
      expect(getSchedulerHealth().lifecycle).toBe('DRAINING');
      stopScheduler();
      startScheduler(1000);
      expect(getSchedulerHealth().running).toBe(false);
    } finally { stopScheduler(); vi.useRealTimers(); }
  });
});

describe('draining waits, then settles durably', () => {
  it('successful drain: an in-flight call finishes within the bound; the task completes normally; nothing is settled', async () => {
    mode = 'slow';
    const { taskId, done } = startTask();
    await waitFor(() => requests === 1);
    const report = await drainAndSettle({ timeoutMs: 5000, actor: 'test' });
    expect(report.settledWithinTimeout).toBe(true);
    expect(report.outstandingAtTimeout).toEqual([]);
    expect(report.settlement.tasks).toEqual([]);
    expect((await done).body).toMatchObject({ status: 'DONE' });
    expect(status(taskId)).toBe('DONE');
    expect(requests).toBe(1);
  });

  it('a known provider failure during the drain settles by its own path (paused for capacity); nothing is retried', async () => {
    mode = 'slow429';
    const { taskId, done } = startTask();
    await waitFor(() => requests === 1);
    const report = await drainAndSettle({ timeoutMs: 5000, actor: 'test' });
    expect(report.settledWithinTimeout).toBe(true);
    await done;
    expect(status(taskId)).toMatch(/^PAUSED_AWAITING_/);
    expect(ledger(taskId).map((r) => r.status)).toEqual(['PROVIDER_REJECTION']);
    expect(requests).toBe(1);
  });

  it('OLD ORPHAN CONDITION, now settled: shutdown during a hung dispatch → bounded wait → RECONCILING_UNKNOWN_EXECUTION, ledger UNKNOWN, never retried', async () => {
    mode = 'hang';
    const { taskId, done } = startTask();
    await waitFor(() => requests === 1);
    expect(status(taskId)).toBe('RUNNING');
    const t0 = Date.now();
    const report = await drainAndSettle({ timeoutMs: 300, actor: 'test' });
    expect(Date.now() - t0).toBeLessThan(2000); // bounded
    expect(report.settledWithinTimeout).toBe(false);
    expect(report.outstandingAtTimeout.map((x) => x.taskId)).toContain(taskId);
    // This is where the old shutdown exited with the task RUNNING. Now it is settled:
    expect(report.settlement.tasks).toEqual([expect.objectContaining({ taskId, outcome: 'AMBIGUOUS', from: 'RUNNING', to: 'RECONCILING_UNKNOWN_EXECUTION' })]);
    expect(status(taskId)).toBe('RECONCILING_UNKNOWN_EXECUTION');
    const rows = ledger(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'UNKNOWN', reason_code: 'SERVICE_SHUTDOWN' });
    expect(report.settlement.markedUnknown).toEqual([rows[0].usage_id]);
    expect(events(taskId)).toContain('SHUTDOWN_INTERRUPTED');
    expect((getDatabase().prepare("SELECT status FROM task_segments WHERE task_id = ?").get(taskId) as any).status).toBe('UNKNOWN');
    // Lifecycle is observable and append-only.
    const life = (getDatabase().prepare("SELECT status, detail_json FROM runtime_events WHERE event_type = 'SERVICE_LIFECYCLE' ORDER BY rowid DESC LIMIT 2").all() as any[]).map((r) => [r.status, JSON.parse(r.detail_json).state]);
    expect(life).toEqual([['TIMEOUT', 'DRAINED'], ['RUNNING', 'DRAINING']]);
    // Release the hung request: the call is never re-sent.
    for (const r of hung.splice(0)) { try { r.destroy(); } catch {} }
    await done;
    expect(requests).toBe(1);
    expect(ledger(taskId)).toHaveLength(1);
    expect(status(taskId)).toBe('RECONCILING_UNKNOWN_EXECUTION');
  });

  it('settlement from evidence: a reservation never sent is released at $0 and its task becomes resumable', () => {
    const db = getDatabase();
    const id = `drain-reserved-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES (?, ?, 't', 'd', 'scribe', 'm', 'RUNNING', ?, ?)").run(id, WS, now, now);
    db.prepare("INSERT INTO provider_usage (usage_id, provider, model, call_site, workspace_id, task_id, idempotency_key, attempt, status, input_chars, estimated_cost_usd, created_at) VALUES (?, ?, 'm', 'kernel.model_task', ?, ?, ?, 1, 'RESERVED', 10, 0.01, ?)").run(`use-${id}`, PUB, WS, id, `k-${id}`, now);
    const s = settleInterruptedAtShutdown({ actor: 'test', processStartedAt: new Date(Date.now() - 60_000).toISOString() });
    expect(s.releasedReservations).toContain(`use-${id}`);
    expect(s.tasks.find((t) => t.taskId === id)).toMatchObject({ outcome: 'NEVER_DISPATCHED', to: 'PAUSED_AWAITING_CAPACITY' });
    expect(db.prepare('SELECT status, estimated_cost_usd, actual_cost_usd, actual_cost_state FROM provider_usage WHERE usage_id = ?').get(`use-${id}`)).toMatchObject({ status: 'PRE_DISPATCH_FAILURE', estimated_cost_usd: 0, actual_cost_usd: 0, actual_cost_state: 'KNOWN' });
    expect(status(id)).toBe('PAUSED_AWAITING_CAPACITY');
  });

  it('settlement never touches work this process did not start', () => {
    const db = getDatabase();
    const id = `drain-foreign-${Date.now()}`;
    const old = '2026-09-10T00:00:00.000Z';
    db.prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES (?, ?, 't', 'd', 'scribe', 'm', 'RUNNING', ?, ?)").run(id, WS, old, old);
    const s = settleInterruptedAtShutdown({ actor: 'test', processStartedAt: new Date(Date.now() - 1000).toISOString() });
    expect(s.tasks.find((t) => t.taskId === id)).toBeUndefined();
    expect(status(id)).toBe('RUNNING');
  });

  it('zero real provider calls: every request went to the local fake', () => {
    expect(process.env.DRAIN_PUB_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});
