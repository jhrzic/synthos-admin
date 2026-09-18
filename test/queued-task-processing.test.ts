import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// QUEUED-TASK PROCESSING — the fail-closed control (lib/queued-task-processing.ts).
//
// These tests REMOVE the Vitest-only override that the rest of the suite runs
// with, so every assertion below is against the real production default.
// A counting fetch stub stands in for the network: any provider, local model
// or Antigravity request would be counted, so "no dispatch" is an observation.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-qtp-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'qtp.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'd'.repeat(64);
process.env.SYNTHOS_AUTONOMY_LEVEL = 'BOUNDED';

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('queued-task-processing');
delete process.env.GEMINI_API_KEY;
delete process.env.WINDMILL_BASE_URL;

import {
  readQueuedTaskProcessing, ensureQueuedTaskProcessingSetting, setQueuedTaskProcessing,
  QUEUED_TASK_PROCESSING_SETTING, QUEUED_TASK_PROCESSING_GATES, QueuedTaskProcessingDisabledError,
} from '../lib/queued-task-processing';
import {
  getDatabase, createOrchestratedTask, getOrchestratorTask, claimTaskForOrchestration,
  acquireExecutionClaim, updateTaskStatus, signReceiptPayload, verifyReceipt, canonicalizePayload,
} from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { advanceTask, runOrchestrationTick } from '../lib/fabric/orchestrator';
import { runDueSchedules, createValidatedSchedule } from '../lib/fabric/scheduler';
import { getSchedule, getScheduleOccurrences } from '../lib/persistence';
import { executeEnvelope } from '../lib/fabric/envelope';
import { executeAgentTask } from '../lib/fabric/kernel';
import { authorizePaidCall, guardedPaidCall } from '../lib/spend/guard';
import { ensureUsageTable, insertUsageRow, reconcileStaleUsage, listUsageForKey } from '../lib/spend/ledger';
import { submitExternalExecution, retryExternalExecution } from '../lib/external-executions';
import { openContinuity, transition, getContinuity } from '../lib/continuity/controller';
import { tryResume, resumeByOperator } from '../lib/continuity/resume';

const WS = 'ws-qtp';
let fetchCalls = 0;
const OVERRIDE = process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING;

const db = () => getDatabase();
const usageRows = () => { ensureUsageTable(); return (db().prepare('SELECT COUNT(*) AS n FROM provider_usage').get() as any).n as number; };
const statusOf = (taskId: string) => (db().prepare('SELECT status FROM tasks WHERE task_id = ?').get(taskId) as any)?.status;
const claimRows = () => { try { return (db().prepare('SELECT COUNT(*) AS n FROM execution_claims').get() as any).n as number; } catch { return 0; } };
const deleteSetting = () => db().prepare('DELETE FROM platform_settings WHERE setting_key = ?').run(QUEUED_TASK_PROCESSING_SETTING);
const storeRaw = (v: string) => {
  deleteSetting();
  db().prepare('INSERT INTO platform_settings (setting_key, setting_value, updated_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(QUEUED_TASK_PROCESSING_SETTING, v, 'test', new Date().toISOString(), new Date().toISOString());
};
let n = 0;
const newTask = (status = 'READY') => {
  const taskId = `qtp-task-${++n}`;
  createOrchestratedTask({ taskId, workspaceId: WS, title: `Queued ${n}`, description: 'An eligible queued task.', assignedAgent: 'researcher', assignedModel: 'fixture-model' });
  if (status !== 'TODO') db().prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run(status, taskId);
  return taskId;
};
const paidReq = (provider: string, key: string) => ({ provider, model: 'fixture-model', callSite: 'test.qtp', workspaceId: WS, idempotencyKey: key, inputChars: 10 });

beforeAll(() => {
  delete process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING; // the real default, not the suite override
  getDatabase();
  ensureWorkspace(WS, 'Queued-task processing');
});
afterAll(() => { if (OVERRIDE !== undefined) process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING = OVERRIDE; });
beforeEach(() => {
  fetchCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { fetchCalls += 1; throw new Error('network forbidden in the queued-task processing tests'); }) as any);
  ensureQueuedTaskProcessingSetting(); // creates the table
  deleteSetting();
  ensureQueuedTaskProcessingSetting(); // the production default: OFF
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('canonical configuration', () => {
  it('defaults to OFF, persisted as {"queuedTaskProcessingEnabled":false}, and never overwrites a stored value', () => {
    const s = readQueuedTaskProcessing();
    expect(s).toMatchObject({ enabled: false, state: 'DISABLED', storedValue: '{"queuedTaskProcessingEnabled":false}', updatedBy: 'system:default-off' });
    setQueuedTaskProcessing(true, 'operator');
    ensureQueuedTaskProcessingSetting();
    expect(readQueuedTaskProcessing().storedValue).toBe('{"queuedTaskProcessingEnabled":true}');
  });

  it('MISSING fails closed', () => {
    deleteSetting();
    expect(readQueuedTaskProcessing()).toMatchObject({ enabled: false, state: 'MISSING' });
    expect(() => claimTaskForOrchestration(newTask(), WS)).toThrow(QueuedTaskProcessingDisabledError);
  });

  it.each([
    ['not JSON', 'yes'], ['a bare true', 'true'], ['a string "true"', '{"queuedTaskProcessingEnabled":"true"}'],
    ['a number', '{"queuedTaskProcessingEnabled":1}'], ['an extra key', '{"queuedTaskProcessingEnabled":true,"x":1}'],
    ['an array', '[true]'], ['empty', ''], ['the wrong key', '{"enabled":true}'],
  ])('MALFORMED (%s) fails closed', (_label, raw) => {
    storeRaw(raw);
    expect(readQueuedTaskProcessing()).toMatchObject({ enabled: false, state: 'MALFORMED' });
    const t = newTask();
    expect(() => claimTaskForOrchestration(t, WS)).toThrow(QueuedTaskProcessingDisabledError);
    expect(statusOf(t)).toBe('READY');
  });

  it('a database error (unreadable configuration) fails closed', () => {
    setQueuedTaskProcessing(true, 'operator');
    const t = newTask();
    db().exec('ALTER TABLE platform_settings RENAME TO platform_settings_hidden');
    try {
      const s = readQueuedTaskProcessing();
      expect(s).toMatchObject({ enabled: false, state: 'UNREADABLE' });
      expect(() => claimTaskForOrchestration(t, WS)).toThrow(QueuedTaskProcessingDisabledError);
      expect(statusOf(t)).toBe('READY');
    } finally {
      db().exec('ALTER TABLE platform_settings_hidden RENAME TO platform_settings');
    }
  });

  it('the Vitest override is honoured only under the Vitest runner', () => {
    const vitest = process.env.VITEST;
    process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING = 'enabled';
    try {
      expect(readQueuedTaskProcessing().enabled).toBe(true);
      delete process.env.VITEST;
      expect(readQueuedTaskProcessing()).toMatchObject({ enabled: false, state: 'DISABLED' });
    } finally {
      process.env.VITEST = vitest;
      delete process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING;
    }
  });
});

describe('while OFF: nothing is claimed, started, dispatched, retried, resumed or scheduled', () => {
  it('an eligible queued task remains unclaimed by the orchestrator tick, advanceTask and the atomic claim', async () => {
    const t = newTask();
    const tick = await runOrchestrationTick({ workspaceId: WS });
    expect(tick.considered).toBe(0);
    expect(tick.steps).toEqual([]);
    expect(tick.refused).toMatch(/QUEUED_TASK_PROCESSING_DISABLED at orchestrator\.tick/);
    const step = await advanceTask(getOrchestratorTask(t, WS)!);
    expect(step.outcome).toBe('DEFERRED');
    expect(step.reason).toMatch(/orchestrator\.advanceTask/);
    expect(() => claimTaskForOrchestration(t, WS)).toThrow(/persistence\.claimOrchestratorTask/);
    expect(statusOf(t)).toBe('READY');
    const history = db().prepare("SELECT COUNT(*) AS n FROM task_status_history WHERE task_id = ? AND status = 'RUNNING'").get(t) as any;
    expect(history.n).toBe(0);
  });

  it('no transition into RUNNING and no execution claim', () => {
    const t = newTask();
    expect(() => updateTaskStatus(t, 'RUNNING', undefined, WS)).toThrow(/persistence\.updateTaskStatus\.RUNNING/);
    expect(statusOf(t)).toBe('READY');
    const before = claimRows();
    expect(() => acquireExecutionClaim({ workspaceId: WS, actorUserId: 'orchestrator', capability: 'model.task', idempotencyKey: `k-${t}`, payloadHash: `h-${t}`, taskId: t })).toThrow(/persistence\.claimExecution/);
    expect(claimRows()).toBe(before);
    // Bookkeeping transitions that are not a start remain available.
    updateTaskStatus(t, 'CANCELLED', undefined, WS);
    expect(statusOf(t)).toBe('CANCELLED');
  });

  it('provider, local and Antigravity dispatchers are never invoked and no provider-usage row is created', async () => {
    const rowsBefore = usageRows();
    for (const provider of ['openai', 'gemini', 'fixture-local', 'antigravity', 'openai_tts']) {
      const key = `qtp-${provider}-${Date.now()}`;
      const send = vi.fn(async () => ({ ok: true, value: 'x' } as any));
      const r: any = await guardedPaidCall(paidReq(provider, key) as any, send);
      expect(r.permitted).toBe(false);
      expect(r.code).toBe('QUEUED_TASK_PROCESSING_DISABLED');
      expect(r.usageId).toBe('NOT_RECORDED');
      expect(send).not.toHaveBeenCalled();
      expect(listUsageForKey(key)).toEqual([]);
      expect(authorizePaidCall(paidReq(provider, key) as any)).toMatchObject({ permitted: false, usageId: 'NOT_RECORDED' });
    }
    await expect(submitExternalExecution({ workspaceId: WS, createdByUserId: 'u1', runtime: 'antigravity' as any, input: { prompt: 'x' } })).rejects.toThrow(/externalExecutions\.dispatch/);
    await expect(submitExternalExecution({ workspaceId: WS, createdByUserId: 'u1', targetId: 'wm-1', input: {} })).rejects.toThrow(/externalExecutions\.dispatch/);
    expect(usageRows()).toBe(rowsBefore);
    expect(fetchCalls).toBe(0);
  });

  it('capability execution and the model-task kernel refuse before any attempt', async () => {
    const r = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write', parameters: {}, rawText: 'note' });
    expect(r.outcome).toBe('BLOCKED');
    expect((r as any).reason).toMatch(/kernel\.executeEnvelope/);
    const k = await executeAgentTask({ taskId: 'qtp-kernel-1', prompt: 'hello' } as any, WS, { actorUserId: 'u1' } as any);
    expect(k.status).toBe(503);
    expect((k.body as any).reason).toBe('QUEUED_TASK_PROCESSING_DISABLED');
    expect(db().prepare('SELECT COUNT(*) AS n FROM tasks WHERE task_id = ?').get('qtp-kernel-1')).toMatchObject({ n: 0 });
    expect(fetchCalls).toBe(0);
  });

  it('retries and resumes are blocked (external retry, scheduler resume sweep, operator resume)', async () => {
    await expect(retryExternalExecution(WS, 'u1', 'ext-any')).rejects.toThrow(/externalExecutions\.dispatch/);

    process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING = 'enabled'; // set up a paused task only
    const t = newTask();
    openContinuity({ taskId: t, workspaceId: WS, taskClass: 'literal_transformation', contract: { mode: 'LITERAL' }, requirements: {}, constraints: {}, privacyClass: 'INTERNAL' as any });
    transition(t, WS, 'AWAITING_CONTINUATION', 'paused for the test');
    delete process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING;
    const statusBefore = statusOf(t);

    const sweep = tryResume(getContinuity(t)!, 'scheduler');
    expect(sweep.resumed).toBe(false);
    expect(sweep.reason).toMatch(/continuity\.tryResume/);
    const op = resumeByOperator(t, 'operator');
    expect(op.ok).toBe(false);
    expect(op.reason).toMatch(/continuity\.tryResume/);
    expect(statusOf(t)).toBe(statusBefore);
    expect(getContinuity(t)!.state).toBe('AWAITING_CONTINUATION');
  });

  it('scheduled work cannot bypass the gate: a due schedule fires nothing and keeps its metadata', async () => {
    const due = new Date(Date.now() - 60_000).toISOString();
    process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING = 'enabled'; // creating a schedule is not execution
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write', parameters: {},
      rawText: 'save this to the Vault every week', parsed: { recurrenceType: 'INTERVAL', intervalSeconds: 604800, nextRunAt: due, matchedPhrase: 'every week' } as any,
    });
    delete process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING;
    const before = getSchedule(schedule.schedule_id)!;
    const tasksBefore = (db().prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n;

    const r = await runDueSchedules(new Date().toISOString());
    expect(r.processed).toBe(0);
    expect(r.refused).toMatch(/scheduler\.runDueSchedules/);
    expect(getScheduleOccurrences(schedule.schedule_id)).toEqual([]);
    const after = getSchedule(schedule.schedule_id)!;
    expect(after.next_run_at).toBe(before.next_run_at);
    expect(after.status).toBe(before.status);
    expect(after.last_run_at ?? null).toBe(before.last_run_at ?? null);
    expect((db().prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n).toBe(tasksBefore);
    expect(fetchCalls).toBe(0);
  });
});

describe('while OFF: bookkeeping continues', () => {
  it('stale ledger rows are still settled and receipts still verify', () => {
    ensureUsageTable();
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    insertUsageRow({ usage_id: 'qtp-stale-1', provider: 'openai', model: 'fixture-model', call_site: 'test', idempotency_key: 'qtp-stale-1', attempt: 1, status: 'RESERVED', created_at: old } as any);
    expect(reconcileStaleUsage()).toBeGreaterThanOrEqual(1);
    expect(listUsageForKey('qtp-stale-1')[0].status).toBe('PRE_DISPATCH_FAILURE');

    const payload = canonicalizePayload({ taskId: 'qtp-receipt', decision: 'APPROVED' });
    const signed = signReceiptPayload(payload);
    expect(verifyReceipt({ algorithm: signed.algorithm, payload_json: payload, signature: signed.signature, public_key: signed.publicKeyPem })).toBe(true);
    expect(verifyReceipt({ algorithm: signed.algorithm, payload_json: payload.replace('APPROVED', 'REJECTED'), signature: signed.signature, public_key: signed.publicKeyPem })).toBe(false);
  });
});

describe('explicitly ENABLED (isolated database)', () => {
  it('claims exactly one task, with no network or model call', async () => {
    setQueuedTaskProcessing(true, 'test-operator');
    expect(readQueuedTaskProcessing()).toMatchObject({ enabled: true, state: 'ENABLED', updatedBy: 'test-operator' });
    const a = newTask();
    const b = newTask();
    const rowsBefore = usageRows();
    expect(claimTaskForOrchestration(a, WS)).toBe(true);
    expect(claimTaskForOrchestration(a, WS)).toBe(false); // the atomic claim still has exactly one winner
    expect(statusOf(a)).toBe('RUNNING');
    expect(statusOf(b)).toBe('READY');
    expect(usageRows()).toBe(rowsBefore);
    expect(fetchCalls).toBe(0);
    setQueuedTaskProcessing(false, 'test-operator');
    expect(() => claimTaskForOrchestration(b, WS)).toThrow(QueuedTaskProcessingDisabledError);
  });
});

describe('wiring', () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  it('every declared gate is asserted in the source at its chokepoint', () => {
    const files = ['lib/fabric/orchestrator.ts', 'lib/persistence.ts', 'lib/fabric/kernel.ts', 'lib/fabric/envelope.ts', 'lib/spend/guard.ts', 'lib/fabric/scheduler.ts', 'lib/continuity/resume.ts', 'lib/external-executions.ts'].map(src).join('\n');
    for (const gate of QUEUED_TASK_PROCESSING_GATES) expect(files).toContain(`'${gate}'`);
  });
  it('the server persists the default before the scheduler starts and reports the effective value to Admin', () => {
    const s = src('server.ts');
    const ensure = s.indexOf('ensureQueuedTaskProcessingSetting()');
    expect(ensure).toBeGreaterThan(-1);
    expect(s).toMatch(/processing:\s*\{\s*\.\.\.readQueuedTaskProcessing\(\)/);
    expect(s).not.toMatch(/SYNTHOS_TEST_QUEUED_TASK_PROCESSING/);
  });
});
