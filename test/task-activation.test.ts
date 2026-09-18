import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// TASK-SCOPED, SINGLE-USE ACTIVATION (lib/task-activation.ts).
//
// Isolated database and vault. The Vitest-only override that opens the global
// gate for the rest of the suite is REMOVED here: every test runs with
// queued-task processing at its real default, OFF, and it is asserted OFF at
// the end. A counting fetch stub stands in for the network, so "no provider
// or network call" is an observation.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-activation-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'activation.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'e'.repeat(64);
delete process.env.SYNTHOS_AUTONOMY_LEVEL; // the default: INTERNAL_AUTOMATION

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('task-activation');
delete process.env.GEMINI_API_KEY;
delete process.env.WINDMILL_BASE_URL;

import { readQueuedTaskProcessing, ensureQueuedTaskProcessingSetting, QueuedTaskProcessingDisabledError } from '../lib/queued-task-processing';
import {
  issueTaskActivation, getActivation, finishActivation, settleActivation, derivedChildTaskId, activationCorrelationId,
  canonicalParameterHash, ActivationError, ACTIVATION_MAX_TTL_MS,
} from '../lib/task-activation';
import {
  getDatabase, createOrchestratedTask, getOrchestratorTask, claimTaskForOrchestration, claimTaskForOrchestrationDetailed,
  acquireExecutionClaim, updateTaskStatus, verifyReceipt, SCHEMA_VERSION,
} from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { runOrchestrationTick, advanceTask } from '../lib/fabric/orchestrator';
import { executeEnvelope, deriveIdempotentTaskId } from '../lib/fabric/envelope';
import { executeAgentTask } from '../lib/fabric/kernel';
import { authorizePaidCall, guardedPaidCall } from '../lib/spend/guard';
import { ensureUsageTable } from '../lib/spend/ledger';
import { submitExternalExecution, retryExternalExecution } from '../lib/external-executions';
import { tryResume } from '../lib/continuity/resume';
import { runDueSchedules, createValidatedSchedule } from '../lib/fabric/scheduler';
import { getScheduleOccurrences, getSchedule } from '../lib/persistence';

const WS = 'ws-activation';
const OTHER_WS = 'ws-activation-other';
const CAP = 'files.write_artifact';
const OVERRIDE = process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING;
let fetchCalls = 0;
let n = 0;

const db = () => getDatabase();
const count = (table: string, where = '1=1', ...args: unknown[]) => (db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args) as any).n as number;
const usageRows = () => { ensureUsageTable(); return count('provider_usage'); };
const statusOf = (taskId: string) => (db().prepare('SELECT status FROM tasks WHERE task_id = ?').get(taskId) as any)?.status;
const params = (i: number) => ({ title: `Activation probe ${i}`, content: `Deterministic activation probe ${i}. No model, no network.` });

function probe(p: Record<string, unknown> = params(++n), ws = WS): { taskId: string; parameters: Record<string, unknown> } {
  const taskId = `activation-probe-${String(++n).padStart(3, '0')}`;
  createOrchestratedTask({ taskId, workspaceId: ws, title: String(p.title ?? taskId), description: 'Activation probe', assignedAgent: 'tool:files.write_artifact', assignedModel: 'none', capability: CAP, parameters: p });
  db().prepare("UPDATE tasks SET status = 'READY' WHERE task_id = ?").run(taskId);
  return { taskId, parameters: p };
}
const issue = (t: { taskId: string; parameters: unknown }, over: Partial<Parameters<typeof issueTaskActivation>[0]> = {}) =>
  issueTaskActivation({ taskId: t.taskId, workspaceId: WS, capability: CAP, parameters: t.parameters, approvedBy: 'test-operator', ...over });

/** A task with a CLAIMED lease (claimed directly, nothing executed yet). */
function claimed() {
  const t = probe();
  const a = issue(t);
  const c = claimTaskForOrchestrationDetailed(t.taskId, WS);
  expect(c).toEqual({ won: true, activationId: a.activation_id });
  return { ...t, a };
}

/** Terminate whatever is live so the next test can issue (one live activation at most). */
function clearLive() {
  db().prepare("UPDATE queued_task_activations SET status = 'ABORTED', finished_at = ?, finish_reason = 'test cleanup' WHERE status IN ('ISSUED','CLAIMED')").run(new Date().toISOString());
}

beforeAll(() => {
  delete process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING; // the real default: OFF
  getDatabase();
  ensureWorkspace(WS, 'Activation');
  ensureWorkspace(OTHER_WS, 'Activation other');
  ensureQueuedTaskProcessingSetting();
});
afterAll(() => { if (OVERRIDE !== undefined) process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING = OVERRIDE; });
beforeEach(() => {
  fetchCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { fetchCalls += 1; throw new Error('network forbidden in the activation tests'); }) as any);
  clearLive();
});
afterEach(() => { vi.unstubAllGlobals(); expect(readQueuedTaskProcessing()).toMatchObject({ enabled: false, state: 'DISABLED' }); });

describe('schema', () => {
  it('migration 3 creates the activation table, empty', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(db().prepare("SELECT name FROM sqlite_master WHERE name = 'queued_task_activations'").get()).toBeTruthy();
  });
  it('the child id is the one the envelope derives', () => {
    const corr = activationCorrelationId('activation-probe-001');
    expect(derivedChildTaskId(CAP, corr)).toBe(deriveIdempotentTaskId('files-artifact', corr));
    expect(derivedChildTaskId('vault.write', corr)).toBeNull();
  });
});

describe('issuing', () => {
  it('binds task, workspace, capability, parameter hash, actor, expiry, correlation and child', () => {
    const t = probe();
    const a = issue(t);
    expect(a).toMatchObject({ root_task_id: t.taskId, workspace_id: WS, capability: CAP, parameter_hash: canonicalParameterHash(t.parameters), approved_by: 'test-operator', status: 'ISSUED', correlation_id: `orchestration:${t.taskId}`, child_task_id: `jarvis-files-artifact-orchestration-${t.taskId}`, lease_id: null });
    expect(Date.parse(a.expires_at) - Date.parse(a.created_at)).toBe(ACTIVATION_MAX_TTL_MS);
  });
  it('refuses a non-deterministic capability, a wrong hash, a wrong workspace, a longer lifetime, no actor, and a second live activation', () => {
    const t = probe();
    expect(() => issue(t, { capability: 'vault.write' })).toThrow(ActivationError);
    expect(() => issue(t, { parameters: { title: 'x', content: 'different' } })).toThrow(/stored parameters/);
    expect(() => issue(t, { workspaceId: OTHER_WS })).toThrow(/No such task/);
    expect(() => issue(t, { ttlMs: ACTIVATION_MAX_TTL_MS + 1 })).toThrow(/lifetime/);
    expect(() => issue(t, { approvedBy: ' ' })).toThrow(/approving actor/);
    issue(t);
    expect(() => issue(probe())).toThrow(/only one may be live/);
  });
});

describe('the authorized run', () => {
  it('passes every necessary gate, produces normal evidence, completes, and leaves the global switch OFF', async () => {
    const t = probe();
    const a = issue(t);
    const usageBefore = usageRows();
    const tick = await runOrchestrationTick({});
    expect(tick.activationId).toBe(a.activation_id);
    expect(tick.considered).toBe(1);
    expect(tick.steps).toHaveLength(1);
    const step = tick.steps[0];
    expect(step.outcome).toBe('ADVANCED');
    expect(step.aegisDecision).toBe('VERIFIED');

    const child = a.child_task_id;
    expect(statusOf(t.taskId)).toBe('DONE');
    expect(statusOf(child)).toBe('DONE');
    expect(count('artifacts', 'task_id = ?', child)).toBe(1);
    expect((db().prepare('SELECT decision FROM quality_reviews WHERE task_id = ?').get(child) as any).decision).toBe('VERIFIED');
    const receipt: any = db().prepare('SELECT * FROM receipts WHERE task_id = ?').get(child);
    expect(receipt.receipt_id).toBe(step.receiptId);
    expect(verifyReceipt(receipt)).toBe(true);
    expect(db().prepare('SELECT idempotency_key, task_id, status FROM execution_claims WHERE task_id IN (?, ?) ORDER BY idempotency_key').all(t.taskId, child))
      .toEqual([
        { idempotency_key: `orchestration-task:${t.taskId}`, task_id: t.taskId, status: 'DONE' },
        { idempotency_key: `orchestration:${t.taskId}`, task_id: child, status: 'DONE' },
      ].sort((x, y) => x.idempotency_key.localeCompare(y.idempotency_key)));
    const done = getActivation(a.activation_id)!;
    expect(done).toMatchObject({ status: 'COMPLETED' });
    expect(done.lease_id).toMatch(/^lease-/);
    expect(done.claimed_at && done.finished_at).toBeTruthy();
    expect(usageRows()).toBe(usageBefore);
    expect(fetchCalls).toBe(0);

    // Replay: a second tick, advanceTask and the claim cannot reuse it.
    const again = await runOrchestrationTick({});
    expect(again.considered).toBe(0);
    expect(again.activationId).toBeUndefined();
    const replay = await advanceTask(getOrchestratorTask(t.taskId, WS)!);
    expect(replay.outcome).toBe('DEFERRED');
    expect(() => claimTaskForOrchestration(t.taskId, WS)).toThrow(QueuedTaskProcessingDisabledError);
    expect(count('receipts', 'task_id = ?', child)).toBe(1);
    expect(getActivation(a.activation_id)!.status).toBe('COMPLETED');
  });

  it('the tick considers only the activated task: other eligible tasks stay queued', async () => {
    const other = probe();
    const t = probe();
    issue(t);
    const tick = await runOrchestrationTick({});
    expect(tick.steps.map((s) => s.taskId)).toEqual([t.taskId]);
    expect(statusOf(other.taskId)).toBe('READY');
  });

  it('normal rules are not bypassed: Guardian refusal blocks the task, aborts the activation, and writes no receipt', async () => {
    const t = probe({ title: 'Probe', content: 'sudo reboot the host' });
    const a = issue(t);
    const step = await advanceTask(getOrchestratorTask(t.taskId, WS)!);
    expect(step.outcome).toBe('BLOCKED');
    expect(statusOf(t.taskId)).toBe('BLOCKED');
    expect(count('receipts', 'task_id = ?', a.child_task_id)).toBe(0);
    expect(getActivation(a.activation_id)!.status).toBe('ABORTED');
  });

  it('completion requires the normal evidence: without it, or with an unexpected extra task, the activation is ABORTED', async () => {
    const c = claimed();
    expect(settleActivation(c.a.activation_id, 'ADVANCED')).toBe('ABORTED'); // root not DONE, no child, no receipt
    expect(getActivation(c.a.activation_id)!.finish_reason).toMatch(/root task is not DONE/);
    expect(statusOf(c.taskId)).toBe('RUNNING'); // the activation never marked the task DONE

    // A fully evidenced run, then a (hand-made) CLAIMED record over it with an extra task created after its claim.
    const t = probe(); const a = issue(t);
    await runOrchestrationTick({});
    expect(getActivation(a.activation_id)!.status).toBe('COMPLETED');
    const claimedAt = new Date(Date.now() - 1000).toISOString();
    db().prepare(`INSERT INTO queued_task_activations (activation_id, root_task_id, workspace_id, capability, parameter_hash, correlation_id, child_task_id, approved_by, status, created_at, expires_at, lease_id, claimed_at)
      VALUES ('act-extra', ?, ?, ?, ?, ?, ?, 'test', 'CLAIMED', ?, ?, 'lease-x', ?)`)
      .run(t.taskId, WS, CAP, a.parameter_hash, a.correlation_id, a.child_task_id, claimedAt, new Date(Date.now() + 60_000).toISOString(), claimedAt);
    probe(); // an additional task, created after the claim
    expect(settleActivation('act-extra', 'ADVANCED')).toBe('ABORTED');
    expect(getActivation('act-extra')!.finish_reason).toMatch(/unexpected additional/);
  });
});

describe('exactly one claim', () => {
  it('only the activated root can claim, and a second claim loses', () => {
    const other = probe();
    const t = probe();
    const a = issue(t);
    expect(() => claimTaskForOrchestration(other.taskId, WS)).toThrow(QueuedTaskProcessingDisabledError);
    expect(claimTaskForOrchestrationDetailed(t.taskId, WS)).toEqual({ won: true, activationId: a.activation_id });
    expect(claimTaskForOrchestrationDetailed(t.taskId, WS)).toEqual({ won: false, activationId: a.activation_id });
    expect(count('task_status_history', "task_id = ? AND status = 'RUNNING'", t.taskId)).toBe(1);
    expect(getActivation(a.activation_id)!.status).toBe('CLAIMED');
    expect(statusOf(other.taskId)).toBe('READY');
  });

  it('two concurrent runs of the same task: one ADVANCED, one NOT_CLAIMED, and the loser does not disturb the winner', async () => {
    const t = probe();
    const a = issue(t);
    const row = getOrchestratorTask(t.taskId, WS)!;
    const [x, y] = await Promise.all([advanceTask(row), advanceTask(row)]);
    expect([x.outcome, y.outcome].sort()).toEqual(['ADVANCED', 'NOT_CLAIMED']);
    expect(getActivation(a.activation_id)!.status).toBe('COMPLETED');
    expect(count('receipts', 'task_id = ?', a.child_task_id)).toBe(1);
  });
});

describe('mismatches are refused (and abort the activation when they name its task)', () => {
  it('task: another task cannot use it, and it stays ISSUED', async () => {
    const other = probe();
    const t = probe();
    const a = issue(t);
    const step = await advanceTask(getOrchestratorTask(other.taskId, WS)!);
    expect(step.outcome).toBe('DEFERRED');
    expect(statusOf(other.taskId)).toBe('READY');
    expect(getActivation(a.activation_id)!.status).toBe('ISSUED');
  });

  it('workspace', async () => {
    const t = probe(); const a = issue(t);
    const step = await advanceTask({ ...getOrchestratorTask(t.taskId, WS)!, workspace_id: OTHER_WS });
    expect(step.outcome).toBe('DEFERRED');
    expect(getActivation(a.activation_id)!.status).toBe('ABORTED');
    expect(statusOf(t.taskId)).toBe('READY');
  });

  it('capability changed after issue', async () => {
    const t = probe(); const a = issue(t);
    db().prepare("UPDATE tasks SET capability = 'vault.write' WHERE task_id = ?").run(t.taskId);
    expect((await advanceTask(getOrchestratorTask(t.taskId, WS)!)).outcome).toBe('DEFERRED');
    expect(getActivation(a.activation_id)!.status).toBe('ABORTED');
  });

  it('parameters changed after issue (hash mismatch), at advanceTask and at the claim', async () => {
    const t = probe(); const a = issue(t);
    db().prepare('UPDATE tasks SET parameters_json = ? WHERE task_id = ?').run(JSON.stringify({ title: 'x', content: 'changed' }), t.taskId);
    expect((await advanceTask(getOrchestratorTask(t.taskId, WS)!)).outcome).toBe('DEFERRED');
    expect(getActivation(a.activation_id)!.status).toBe('ABORTED');

    const u = probe(); const b = issue(u);
    db().prepare('UPDATE tasks SET parameters_json = ? WHERE task_id = ?').run(JSON.stringify({ title: 'x', content: 'changed' }), u.taskId);
    expect(() => claimTaskForOrchestrationDetailed(u.taskId, WS)).toThrow(/parameter hash mismatch/);
    expect(getActivation(b.activation_id)!.status).toBe('ABORTED');
    expect(statusOf(u.taskId)).toBe('READY');
  });

  it('correlation and parameter mismatches at executeEnvelope', async () => {
    const c = claimed();
    const r = await executeEnvelope({ workspaceId: WS, actorUserId: 'orchestrator', capability: CAP, action: 'execute', parameters: c.parameters, rawText: 'x', taskId: c.taskId, idempotencyKey: 'orchestration:something-else' });
    expect(r.outcome).toBe('BLOCKED');
    expect(getActivation(c.a.activation_id)!.status).toBe('ABORTED');

    const d = claimed();
    const r2 = await executeEnvelope({ workspaceId: WS, actorUserId: 'orchestrator', capability: CAP, action: 'execute', parameters: { title: 'x', content: 'other' }, rawText: 'x', taskId: d.taskId, idempotencyKey: d.a.correlation_id });
    expect(r2.outcome).toBe('BLOCKED');
    expect(getActivation(d.a.activation_id)!.status).toBe('ABORTED');

    const e = claimed();
    const r3 = await executeEnvelope({ workspaceId: WS, actorUserId: 'orchestrator', capability: 'vault.write', action: 'execute', parameters: e.parameters, rawText: 'x', taskId: e.taskId, idempotencyKey: e.a.correlation_id });
    expect(r3.outcome).toBe('BLOCKED');
    expect(getActivation(e.a.activation_id)!.status).toBe('ABORTED');
  });

  it('child: an arbitrary child cannot claim execution or start RUNNING; the bound child can', () => {
    const c = claimed();
    expect(() => acquireExecutionClaim({ workspaceId: WS, actorUserId: 'orchestrator', capability: CAP, idempotencyKey: c.a.correlation_id, payloadHash: 'h', taskId: 'jarvis-files-artifact-somewhere-else' })).toThrow(QueuedTaskProcessingDisabledError);
    expect(getActivation(c.a.activation_id)!.status).toBe('ABORTED');

    const d = claimed();
    const stray = probe();
    expect(() => updateTaskStatus(stray.taskId, 'RUNNING', undefined, WS)).toThrow(QueuedTaskProcessingDisabledError);
    expect(statusOf(stray.taskId)).toBe('READY');
    expect(getActivation(d.a.activation_id)!.status).toBe('CLAIMED'); // an unrelated refusal does not abort it
    // The bound execution claims and the bound child's RUNNING transition are permitted.
    expect(acquireExecutionClaim({ workspaceId: WS, actorUserId: 'orchestrator', capability: CAP, idempotencyKey: `orchestration-task:${d.taskId}`, payloadHash: `orchestration-task:${d.taskId}`, taskId: d.taskId }).outcome).toBe('ACQUIRED');
    createOrchestratedTask({ taskId: d.a.child_task_id, workspaceId: WS, title: 'child', description: 'child', assignedAgent: 'x', assignedModel: 'none' });
    updateTaskStatus(d.a.child_task_id, 'RUNNING', undefined, WS);
    expect(statusOf(d.a.child_task_id)).toBe('RUNNING');
    // …but the root never re-enters RUNNING through updateTaskStatus.
    expect(() => updateTaskStatus(d.taskId, 'RUNNING', undefined, WS)).toThrow(QueuedTaskProcessingDisabledError);
  });
});

describe('unusable records fail closed', () => {
  it('missing: no activation, no claim', async () => {
    const t = probe();
    expect((await runOrchestrationTick({})).considered).toBe(0);
    expect(() => claimTaskForOrchestration(t.taskId, WS)).toThrow(QueuedTaskProcessingDisabledError);
  });

  it('expired while ISSUED, and while CLAIMED', async () => {
    const t = probe();
    const a = issue(t, { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect((await runOrchestrationTick({})).considered).toBe(0);
    expect(getActivation(a.activation_id)!.status).toBe('EXPIRED');
    expect(statusOf(t.taskId)).toBe('READY');

    const u = probe();
    const b = issue(u, { ttlMs: 40 });
    expect(claimTaskForOrchestrationDetailed(u.taskId, WS).won).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    const r = await executeEnvelope({ workspaceId: WS, actorUserId: 'orchestrator', capability: CAP, action: 'execute', parameters: u.parameters, rawText: 'x', taskId: u.taskId, idempotencyKey: b.correlation_id });
    expect(r.outcome).toBe('BLOCKED');
    expect(getActivation(b.activation_id)!.status).toBe('EXPIRED');
  });

  it('completed and aborted records authorize nothing', async () => {
    for (const status of ['COMPLETED', 'ABORTED'] as const) {
      const t = probe(); const a = issue(t);
      finishActivation(a.activation_id, status, 'test');
      expect((await runOrchestrationTick({})).considered).toBe(0);
      expect(() => claimTaskForOrchestration(t.taskId, WS)).toThrow(QueuedTaskProcessingDisabledError);
    }
  });

  it.each([
    ['a non-sha256 parameter hash', { parameter_hash: 'zz' }],
    ['a foreign correlation id', { correlation_id: 'orchestration:someone-else' }],
    ['an arbitrary child id', { child_task_id: 'jarvis-files-artifact-anything' }],
    ['an unparseable expiry', { expires_at: 'soon' }],
    ['a lifetime beyond the limit', { expires_at: new Date(Date.now() + ACTIVATION_MAX_TTL_MS * 3).toISOString() }],
    ['a non-deterministic capability', { capability: 'research' }],
    ['no approving actor', { approved_by: ' ' }],
  ])('malformed (%s)', async (_label, over) => {
    const t = probe(); const a = issue(t);
    const sets = Object.keys(over).map((k) => `${k} = ?`).join(', ');
    db().prepare(`UPDATE queued_task_activations SET ${sets} WHERE activation_id = ?`).run(...Object.values(over), a.activation_id);
    expect((await runOrchestrationTick({})).considered).toBe(0);
    expect((await advanceTask(getOrchestratorTask(t.taskId, WS)!)).outcome).toBe('DEFERRED');
    expect(() => claimTaskForOrchestration(t.taskId, WS)).toThrow(QueuedTaskProcessingDisabledError);
    expect(statusOf(t.taskId)).toBe('READY');
  });

  it('CLAIMED without a lease is malformed', async () => {
    const c = claimed();
    db().prepare('UPDATE queued_task_activations SET lease_id = NULL WHERE activation_id = ?').run(c.a.activation_id);
    const r = await executeEnvelope({ workspaceId: WS, actorUserId: 'orchestrator', capability: CAP, action: 'execute', parameters: c.parameters, rawText: 'x', taskId: c.taskId, idempotencyKey: c.a.correlation_id });
    expect(r.outcome).toBe('BLOCKED');
  });

  it('unreadable (database error)', async () => {
    const t = probe(); issue(t);
    db().exec('ALTER TABLE queued_task_activations RENAME TO queued_task_activations_hidden');
    try {
      // "no such table" reads as no activation; any other read failure is UNREADABLE — both refuse.
      expect((await runOrchestrationTick({})).considered).toBe(0);
      expect(() => claimTaskForOrchestration(t.taskId, WS)).toThrow(QueuedTaskProcessingDisabledError);
      expect(statusOf(t.taskId)).toBe('READY');
    } finally {
      db().exec('ALTER TABLE queued_task_activations_hidden RENAME TO queued_task_activations');
    }
    // Two live rows (index dropped to simulate corruption) are UNREADABLE, never "pick one".
    db().exec('DROP INDEX uq_queued_task_activation_live');
    try {
      const u = probe(); issue(u);
      const x = probe();
      db().prepare(`INSERT INTO queued_task_activations SELECT 'act-dup', ?, workspace_id, capability, ?, ?, ?, approved_by, 'ISSUED', created_at, expires_at, NULL, NULL, NULL, NULL FROM queued_task_activations WHERE root_task_id = ?`)
        .run(x.taskId, canonicalParameterHash(x.parameters), activationCorrelationId(x.taskId), derivedChildTaskId(CAP, activationCorrelationId(x.taskId)), u.taskId);
      expect((await runOrchestrationTick({})).considered).toBe(0);
      expect(() => claimTaskForOrchestration(u.taskId, WS)).toThrow(QueuedTaskProcessingDisabledError);
    } finally {
      clearLive();
      db().exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_queued_task_activation_live ON queued_task_activations ((workspace_id IS NOT NULL)) WHERE status IN ('ISSUED','CLAIMED')");
    }
  });
});

describe('never bypassed, even with a CLAIMED lease — and reaching them aborts the activation', () => {
  it('paid-call authorization: provider, local and Antigravity sends never run; no usage row', async () => {
    const before = usageRows();
    for (const provider of ['openai', 'local-runtime', 'antigravity']) {
      const c = claimed();
      const send = vi.fn(async () => ({ ok: true } as any));
      const r: any = await guardedPaidCall({ provider, model: 'fixture', callSite: 'test', workspaceId: WS, taskId: c.taskId, idempotencyKey: `k-${c.taskId}`, inputChars: 5 } as any, send);
      expect(r).toMatchObject({ permitted: false, usageId: 'NOT_RECORDED', code: 'QUEUED_TASK_PROCESSING_DISABLED' });
      expect(send).not.toHaveBeenCalled();
      expect(getActivation(c.a.activation_id)!.status).toBe('ABORTED');
    }
    const c = claimed();
    expect(authorizePaidCall({ provider: 'openai', model: 'fixture', callSite: 'test', workspaceId: WS, taskId: c.a.child_task_id, idempotencyKey: 'k', inputChars: 5 } as any)).toMatchObject({ permitted: false, usageId: 'NOT_RECORDED' });
    expect(getActivation(c.a.activation_id)!.status).toBe('ABORTED');
    expect(usageRows()).toBe(before);
    expect(fetchCalls).toBe(0);
  });

  it('the model kernel', async () => {
    const c = claimed();
    const r = await executeAgentTask({ taskId: c.taskId, prompt: 'x' } as any, WS, { actorUserId: 'orchestrator' } as any);
    expect(r.status).toBe(503);
    expect(getActivation(c.a.activation_id)!.status).toBe('ABORTED');
  });

  it('external execution (Antigravity, Windmill) and retry', async () => {
    const c = claimed();
    await expect(submitExternalExecution({ workspaceId: WS, createdByUserId: 'orchestrator', runtime: 'antigravity' as any, taskId: c.taskId, input: { instruction: 'x' } })).rejects.toThrow(QueuedTaskProcessingDisabledError);
    expect(getActivation(c.a.activation_id)!.status).toBe('ABORTED');
    const d = claimed();
    await expect(submitExternalExecution({ workspaceId: WS, createdByUserId: 'orchestrator', targetId: 'wm', taskId: d.taskId, input: {} })).rejects.toThrow(QueuedTaskProcessingDisabledError);
    await expect(retryExternalExecution(WS, 'orchestrator', 'ext-any')).rejects.toThrow(QueuedTaskProcessingDisabledError);
    expect(fetchCalls).toBe(0);
  });

  it('continuity resume', () => {
    const c = claimed();
    const r = tryResume({ taskId: c.taskId, workspaceId: WS, state: 'AWAITING_CONTINUATION' } as any, 'scheduler', true);
    expect(r.resumed).toBe(false);
    expect(getActivation(c.a.activation_id)!.status).toBe('ABORTED');
  });

  it('scheduled work', async () => {
    const c = claimed();
    process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING = 'enabled'; // creating a schedule is not execution
    const s = await createValidatedSchedule({ workspaceId: WS, actorUserId: 'u1', capability: CAP, action: CAP, parameters: c.parameters, rawText: 'weekly', parsed: { recurrenceType: 'INTERVAL', intervalSeconds: 604800, nextRunAt: new Date(Date.now() - 60_000).toISOString(), matchedPhrase: 'weekly' } as any });
    delete process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING;
    const before = getSchedule(s.schedule_id)!;
    const r = await runDueSchedules();
    expect(r.processed).toBe(0);
    expect(r.refused).toBeTruthy();
    expect(getScheduleOccurrences(s.schedule_id)).toEqual([]);
    expect(getSchedule(s.schedule_id)!.next_run_at).toBe(before.next_run_at);
    expect(getActivation(c.a.activation_id)!.status).toBe('CLAIMED'); // untouched: scheduled work never names it
  });
});
