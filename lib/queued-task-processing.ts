// ---------------------------------------------------------------------------
// QUEUED-TASK PROCESSING CONTROL — one fail-closed switch for everything that
// would pick up, start, resume or dispatch task work.
//
//   canonical configuration: platform_settings['execution.queuedTaskProcessing']
//   stored value:            {"queuedTaskProcessingEnabled": false}
//
// EFFECTIVE value is ENABLED only when the stored value parses to exactly
// {"queuedTaskProcessingEnabled": true}. Missing, malformed, a database error
// or anything else is DISABLED — fail closed. There is no environment
// override: the switch lives in canonical configuration only.
//
// While DISABLED nothing may: claim a queued task, transition a task to
// RUNNING, insert an execution claim, dispatch provider / local / Antigravity
// work (and so create a provider-usage ledger row), retry or resume
// execution, or enqueue/execute scheduled work. The gate is asserted at each
// of those points (see QUEUED_TASK_PROCESSING_GATES), not only in the
// scheduler tick. Bookkeeping — stale-ledger settlement, receipt
// verification, authority-chain signing, reconciliation reads — continues.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';
import { getStoredPlatformSetting } from './platform-settings';
import { verifyActivationLease, abortActivationIfRelated, type GateScope } from './task-activation';

export const QUEUED_TASK_PROCESSING_SETTING = 'execution.queuedTaskProcessing';
export const QUEUED_TASK_PROCESSING_DEFAULT = Object.freeze({ queuedTaskProcessingEnabled: false });

export type QueuedTaskProcessingState = 'ENABLED' | 'DISABLED' | 'MISSING' | 'MALFORMED' | 'UNREADABLE';

export interface QueuedTaskProcessingStatus {
  enabled: boolean;
  state: QueuedTaskProcessingState;
  storedValue: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string;
}

/** Every point that asserts the gate (reported in Admin, pinned by tests). */
export const QUEUED_TASK_PROCESSING_GATES = [
  'orchestrator.tick',                  // lib/fabric/orchestrator.ts runOrchestrationTick (incl. approved-task resume)
  'orchestrator.advanceTask',           // lib/fabric/orchestrator.ts advanceTask — before the claim
  'persistence.claimOrchestratorTask',  // lib/persistence.ts — the atomic READY/TODO → RUNNING claim
  'persistence.updateTaskStatus.RUNNING', // lib/persistence.ts — any transition INTO RUNNING
  'persistence.claimExecution',         // lib/persistence.ts — execution_claims insert
  'kernel.executeEnvelope',             // lib/fabric/envelope.ts executeEnvelope — every capability execution
  'kernel.executeAgentTask',            // lib/fabric/kernel.ts executeAgentTask — every model task
  'spend.authorizePaidCall',            // lib/spend/guard.ts — provider/local/Antigravity dispatch, before any ledger row
  'scheduler.runDueSchedules',          // lib/fabric/scheduler.ts — scheduled work: no occurrence, no enqueue
  'continuity.tryResume',               // lib/continuity/resume.ts — scheduler tick and operator resume
  'externalExecutions.dispatch',        // lib/external-executions.ts — Windmill / Antigravity dispatch
] as const;
export type QueuedTaskProcessingGate = (typeof QUEUED_TASK_PROCESSING_GATES)[number];

export class QueuedTaskProcessingDisabledError extends Error {
  readonly code = 'QUEUED_TASK_PROCESSING_DISABLED';
  constructor(readonly gate: QueuedTaskProcessingGate, readonly status: QueuedTaskProcessingStatus) {
    super(`QUEUED_TASK_PROCESSING_DISABLED at ${gate}: queued-task processing is ${status.state} (${status.reason}). No task was claimed, started or dispatched.`);
    this.name = 'QueuedTaskProcessingDisabledError';
  }
}

/** Read the control. Never throws; anything but an explicit true is DISABLED. */
export function readQueuedTaskProcessing(): QueuedTaskProcessingStatus {
  // Test harness only: the suite's pre-existing execution tests run with the
  // gate open. Honoured solely under the Vitest runner (VITEST is never set in
  // production); the gate tests remove it to exercise the real fail-closed path.
  if (process.env.VITEST && process.env.SYNTHOS_TEST_QUEUED_TASK_PROCESSING === 'enabled') {
    return { enabled: true, state: 'ENABLED', storedValue: null, updatedAt: null, updatedBy: null, reason: 'test harness override (Vitest only)' };
  }
  let row: { setting_value: unknown; updated_at?: string; updated_by_user_id?: string | null } | undefined;
  try {
    row = getDatabase().prepare('SELECT setting_value, updated_at, updated_by_user_id FROM platform_settings WHERE setting_key = ?').get(QUEUED_TASK_PROCESSING_SETTING) as any;
  } catch (err: any) {
    return { enabled: false, state: 'UNREADABLE', storedValue: null, updatedAt: null, updatedBy: null, reason: `configuration could not be read (${String(err?.message || err).slice(0, 120)}) — fail closed` };
  }
  if (!row) return { enabled: false, state: 'MISSING', storedValue: null, updatedAt: null, updatedBy: null, reason: 'no stored value — fail closed' };
  const stored = typeof row.setting_value === 'string' ? row.setting_value : null;
  const meta = { storedValue: stored, updatedAt: row.updated_at ?? null, updatedBy: row.updated_by_user_id ?? null };
  let parsed: any;
  try { parsed = stored === null ? undefined : JSON.parse(stored); } catch { parsed = undefined; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.queuedTaskProcessingEnabled !== 'boolean' || Object.keys(parsed).length !== 1) {
    return { enabled: false, state: 'MALFORMED', ...meta, reason: 'stored value is not {"queuedTaskProcessingEnabled": <boolean>} — fail closed' };
  }
  return parsed.queuedTaskProcessingEnabled === true
    ? { enabled: true, state: 'ENABLED', ...meta, reason: 'explicitly enabled' }
    : { enabled: false, state: 'DISABLED', ...meta, reason: 'explicitly disabled' };
}

const blocked: Record<string, number> = {};
const PRE_CLAIM_GATES = new Set<string>(['orchestrator.tick', 'orchestrator.advanceTask', 'persistence.claimOrchestratorTask']);
/** In-memory counters of refusals per gate (diagnostics only; no writes). */
export function queuedTaskProcessingRefusals(): Record<string, number> { return { ...blocked }; }

/**
 * Throw unless queued-task processing is ENABLED — or, for the three lease
 * gates only, a CLAIMED task activation (lib/task-activation.ts) re-read from
 * the database covers exactly the action described by `scope`. A refusal that
 * names the live activation's task aborts that activation.
 */
export function assertQueuedTaskProcessing(gate: QueuedTaskProcessingGate, scope?: GateScope): void {
  const s = readQueuedTaskProcessing();
  if (s.enabled) return;
  // Pre-claim gates (tick, advanceTask, the claim) are refused here; their
  // callers verify an ISSUED activation themselves (lib/task-activation.ts).
  if (!PRE_CLAIM_GATES.has(gate)) {
    const lease = verifyActivationLease(gate, scope);
    if (lease.ok) return;
    try { abortActivationIfRelated(gate, scope, lease.reason); } catch { /* the refusal stands either way */ }
  }
  blocked[gate] = (blocked[gate] ?? 0) + 1;
  throw new QueuedTaskProcessingDisabledError(gate, s);
}

/** Non-throwing form for paths that return a refusal value instead. */
export function queuedTaskProcessingRefusal(gate: QueuedTaskProcessingGate, scope?: GateScope): QueuedTaskProcessingDisabledError | null {
  try { assertQueuedTaskProcessing(gate, scope); return null; } catch (e) { return e as QueuedTaskProcessingDisabledError; }
}

/** Persist the default OFF value if (and only if) no value is stored. Never overwrites. */
export function ensureQueuedTaskProcessingSetting(): void {
  try {
    getStoredPlatformSetting(QUEUED_TASK_PROCESSING_SETTING); // creates the settings table if absent
    const now = new Date().toISOString();
    getDatabase().prepare('INSERT OR IGNORE INTO platform_settings (setting_key, setting_value, updated_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(QUEUED_TASK_PROCESSING_SETTING, JSON.stringify(QUEUED_TASK_PROCESSING_DEFAULT), 'system:default-off', now, now);
  } catch { /* unreadable store: the reader already fails closed */ }
}

/** Set the control explicitly (operator action; the caller records the audit event). */
export function setQueuedTaskProcessing(enabled: boolean, actor: string): QueuedTaskProcessingStatus {
  getStoredPlatformSetting(QUEUED_TASK_PROCESSING_SETTING); // creates the settings table if absent
  const now = new Date().toISOString();
  getDatabase().prepare(`INSERT INTO platform_settings (setting_key, setting_value, updated_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`)
    .run(QUEUED_TASK_PROCESSING_SETTING, JSON.stringify({ queuedTaskProcessingEnabled: enabled === true }), actor, now, now);
  return readQueuedTaskProcessing();
}
