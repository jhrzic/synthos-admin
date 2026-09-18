// ---------------------------------------------------------------------------
// TASK-SCOPED, SINGLE-USE ACTIVATION — the one way work may run while the
// global queued-task processing switch (lib/queued-task-processing.ts) is OFF.
//
//   ISSUED ──(atomic claim with the root task)──▶ CLAIMED ──▶ COMPLETED
//      │                                            │   └────▶ ABORTED
//      └────────────▶ ABORTED | EXPIRED              └──────▶ EXPIRED
//
// An activation names ONE root task, its workspace, ONE deterministic
// capability, the canonical hash of that task's parameters, the approving
// actor and an expiry (at most ACTIVATION_MAX_TTL_MS). Its correlation id and
// the one derived child task it may create are fixed at issue, never taken
// from a caller.
//
// The claim is a single SQLite transaction: the activation moves ISSUED →
// CLAIMED (and receives its lease id) in the same transaction that moves the
// root task READY/TODO → RUNNING. Exactly one caller can win it.
//
// After the claim, the CLAIMED row IS the execution lease. Every gate that may
// honour it re-reads it from the database and checks it against what that
// gate is about to do (task, workspace, capability, parameter hash,
// correlation / idempotency key, child task). Nothing process-local, no
// environment variable and no caller-supplied flag can stand in for it.
//
// Honoured ONLY at: orchestrator selection and advanceTask (ISSUED), the
// atomic claim (ISSUED → CLAIMED), and — while CLAIMED — the child task's
// RUNNING transition, the two execution claims bound to this activation, and
// executeEnvelope for the exact capability + parameter hash. NEVER at the
// spend guard, the model kernel, external execution, continuity resume or
// scheduled work: those stay closed, and reaching them with this activation's
// task aborts it.
//
// An activation never marks a task DONE. Completion is recorded only after the
// normal path has produced a DONE root, a DONE child, an artifact, a VERIFIED
// Aegis review and a receipt that verifies.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase, verifyReceipt, ORCHESTRATOR_ELIGIBLE_STATUSES } from './persistence';

export const ACTIVATION_MAX_TTL_MS = 10 * 60_000;
export const ACTIVATION_STATUSES = ['ISSUED', 'CLAIMED', 'COMPLETED', 'ABORTED', 'EXPIRED'] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

/** Deterministic, non-model, non-network capabilities an activation may name, and the child each derives. */
export const ACTIVATION_CAPABILITIES: Readonly<Record<string, { childPrefix: string }>> = Object.freeze({
  'files.write_artifact': { childPrefix: 'files-artifact' },
});

// Table: queued_task_activations — schema migration 3 in lib/persistence.ts (ACTIVATION_TABLE_SQL).

export interface ActivationRecord {
  activation_id: string; root_task_id: string; workspace_id: string; capability: string;
  parameter_hash: string; correlation_id: string; child_task_id: string; approved_by: string;
  status: ActivationStatus; created_at: string; expires_at: string;
  lease_id: string | null; claimed_at: string | null; finished_at: string | null; finish_reason: string | null;
}

/** What a gate is about to do. Compared field by field with the lease. */
export interface GateScope {
  taskId?: string | null;
  workspaceId?: string | null;
  capability?: string | null;
  parameters?: unknown;
  idempotencyKey?: string | null;
  payloadHash?: string | null;
  actorUserId?: string | null;
}

export class ActivationError extends Error {
  readonly code = 'ACTIVATION_REFUSED';
  constructor(message: string) { super(message); this.name = 'ActivationError'; }
}

// --- canonical forms -------------------------------------------------------

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, canonical((value as any)[k])]));
  }
  return value;
}

/** sha256 of the key-sorted JSON of a task's parameters. */
export function canonicalParameterHash(parameters: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(parameters ?? {}))).digest('hex');
}

/** The parameters a queued task will be executed with (the orchestrator's own parse). */
export function taskParameters(parametersJson: string | null | undefined): Record<string, unknown> {
  try { return parametersJson ? JSON.parse(parametersJson) : {}; } catch { return {}; }
}

export const activationCorrelationId = (rootTaskId: string) => `orchestration:${rootTaskId}`;

/** Must equal lib/fabric/envelope.ts deriveIdempotentTaskId(prefix, correlation) — pinned by test. */
export function derivedChildTaskId(capability: string, correlationId: string): string | null {
  const spec = ACTIVATION_CAPABILITIES[capability];
  if (!spec) return null;
  return `jarvis-${spec.childPrefix}-${correlationId.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)}`;
}

const HEX64 = /^[0-9a-f]{64}$/;
const iso = (s: unknown) => (typeof s === 'string' && s && !Number.isNaN(Date.parse(s)) ? Date.parse(s) : null);

/** Structural validity. Anything that fails is MALFORMED and honoured nowhere. */
export function malformedReason(r: any): string | null {
  if (!r || typeof r !== 'object') return 'no record';
  for (const k of ['activation_id', 'root_task_id', 'workspace_id', 'capability', 'parameter_hash', 'correlation_id', 'child_task_id', 'approved_by', 'status', 'created_at', 'expires_at']) {
    if (typeof r[k] !== 'string' || !r[k].trim()) return `field ${k} is missing`;
  }
  if (!(ACTIVATION_STATUSES as readonly string[]).includes(r.status)) return `status ${r.status} is not a lifecycle state`;
  if (!ACTIVATION_CAPABILITIES[r.capability]) return `capability ${r.capability} is not an activation capability`;
  if (!HEX64.test(r.parameter_hash)) return 'parameter_hash is not a sha256';
  const created = iso(r.created_at); const expires = iso(r.expires_at);
  if (created === null || expires === null) return 'timestamps are not ISO dates';
  if (expires <= created || expires - created > ACTIVATION_MAX_TTL_MS) return 'expiry is outside the permitted window';
  if (r.correlation_id !== activationCorrelationId(r.root_task_id)) return 'correlation id is not the root task\'s';
  if (r.child_task_id !== derivedChildTaskId(r.capability, r.correlation_id)) return 'child task id is not the derived one';
  if (r.status === 'CLAIMED' && (typeof r.lease_id !== 'string' || !r.lease_id || iso(r.claimed_at) === null)) return 'CLAIMED without a lease';
  return null;
}

// --- reading ---------------------------------------------------------------

type LiveRead =
  | { kind: 'NONE' }
  | { kind: 'UNREADABLE'; reason: string }
  | { kind: 'MALFORMED'; reason: string; row: any }
  | { kind: 'EXPIRED'; row: ActivationRecord }
  | { kind: 'LIVE'; row: ActivationRecord };

/** The single ISSUED or CLAIMED activation, if any. Never throws. */
export function readLiveActivation(nowMs = Date.now()): LiveRead {
  let rows: any[];
  try {
    rows = getDatabase().prepare("SELECT * FROM queued_task_activations WHERE status IN ('ISSUED','CLAIMED')").all() as any[];
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/no such table/i.test(msg)) return { kind: 'NONE' };
    return { kind: 'UNREADABLE', reason: msg.slice(0, 160) };
  }
  if (rows.length === 0) return { kind: 'NONE' };
  if (rows.length > 1) return { kind: 'UNREADABLE', reason: 'more than one live activation' };
  const row = rows[0];
  const bad = malformedReason(row);
  if (bad) return { kind: 'MALFORMED', reason: bad, row };
  if ((iso(row.expires_at) as number) <= nowMs) {
    finishActivation(row.activation_id, 'EXPIRED', 'expired before completion');
    return { kind: 'EXPIRED', row };
  }
  return { kind: 'LIVE', row };
}

export function getActivation(activationId: string): ActivationRecord | null {
  try { return (getDatabase().prepare('SELECT * FROM queued_task_activations WHERE activation_id = ?').get(activationId) as any) ?? null; } catch { return null; }
}

// --- lifecycle writes ------------------------------------------------------

/** ISSUED/CLAIMED → a terminal state. Never touches a task. Returns whether it changed the row. */
export function finishActivation(activationId: string, status: 'COMPLETED' | 'ABORTED' | 'EXPIRED', reason: string): boolean {
  try {
    const r: any = getDatabase().prepare(
      "UPDATE queued_task_activations SET status = ?, finished_at = ?, finish_reason = ? WHERE activation_id = ? AND status IN ('ISSUED','CLAIMED')",
    ).run(status, new Date().toISOString(), reason.slice(0, 500), activationId);
    return Number(r?.changes ?? 0) === 1;
  } catch { return false; }
}

/**
 * Issue an activation for one queued task. Operator action (the caller records
 * the audit event). Refuses unless the task is exactly what will run.
 */
export function issueTaskActivation(p: { taskId: string; workspaceId: string; capability: string; parameters: unknown; approvedBy: string; ttlMs?: number; now?: Date }): ActivationRecord {
  const ttl = p.ttlMs ?? ACTIVATION_MAX_TTL_MS;
  if (!p.approvedBy || !p.approvedBy.trim()) throw new ActivationError('An activation needs an approving actor.');
  if (!(ttl > 0 && ttl <= ACTIVATION_MAX_TTL_MS)) throw new ActivationError(`Activation lifetime must be between 1 ms and ${ACTIVATION_MAX_TTL_MS} ms.`);
  if (!ACTIVATION_CAPABILITIES[p.capability]) throw new ActivationError(`"${p.capability}" is not a deterministic activation capability.`);
  const db = getDatabase();
  const task: any = db.prepare('SELECT task_id, workspace_id, status, capability, parameters_json, autonomy_eligible FROM tasks WHERE task_id = ?').get(p.taskId);
  if (!task || task.workspace_id !== p.workspaceId) throw new ActivationError('No such task in that workspace.');
  if (!(ORCHESTRATOR_ELIGIBLE_STATUSES as readonly string[]).includes(task.status) || Number(task.autonomy_eligible) !== 1) throw new ActivationError(`Task is ${task.status} / autonomy_eligible=${task.autonomy_eligible}; it is not a queued orchestrator task.`);
  if (task.capability !== p.capability) throw new ActivationError('The task\'s capability is not the activated capability.');
  const hash = canonicalParameterHash(p.parameters);
  if (canonicalParameterHash(taskParameters(task.parameters_json)) !== hash) throw new ActivationError('The task\'s stored parameters do not match the activated parameters.');
  const now = p.now ?? new Date();
  const correlation = activationCorrelationId(p.taskId);
  const rec: ActivationRecord = {
    activation_id: `act-run-${now.getTime()}-${crypto.randomBytes(4).toString('hex')}`,
    root_task_id: p.taskId, workspace_id: p.workspaceId, capability: p.capability, parameter_hash: hash,
    correlation_id: correlation, child_task_id: derivedChildTaskId(p.capability, correlation)!,
    approved_by: p.approvedBy, status: 'ISSUED', created_at: now.toISOString(), expires_at: new Date(now.getTime() + ttl).toISOString(),
    lease_id: null, claimed_at: null, finished_at: null, finish_reason: null,
  };
  try {
    db.prepare(`INSERT INTO queued_task_activations (activation_id, root_task_id, workspace_id, capability, parameter_hash, correlation_id, child_task_id, approved_by, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?)`)
      .run(rec.activation_id, rec.root_task_id, rec.workspace_id, rec.capability, rec.parameter_hash, rec.correlation_id, rec.child_task_id, rec.approved_by, rec.created_at, rec.expires_at);
  } catch (err: any) {
    if (/UNIQUE/i.test(String(err?.message))) throw new ActivationError('Another activation is already ISSUED or CLAIMED; only one may be live.');
    throw err;
  }
  return rec;
}

// --- checks used by the gates ---------------------------------------------

/** Orchestrator selection: the live ISSUED activation, well-formed and unexpired. */
export function selectIssuedActivation(): ActivationRecord | null {
  const live = readLiveActivation();
  return live.kind === 'LIVE' && live.row.status === 'ISSUED' ? live.row : null;
}

/** advanceTask, before the claim: this exact task is the one an ISSUED activation names. */
export function verifyIssuedActivationFor(task: { task_id: string; workspace_id?: string | null; capability?: string | null; parameters_json?: string | null }): { ok: true; activationId: string } | { ok: false; reason: string } {
  const live = readLiveActivation();
  if (live.kind !== 'LIVE') return { ok: false, reason: `no usable activation (${live.kind}${'reason' in live ? `: ${live.reason}` : ''})` };
  const a = live.row;
  if (a.status !== 'ISSUED') return { ok: false, reason: 'the live activation is already claimed' };
  const mismatch = a.root_task_id !== task.task_id ? 'task'
    : a.workspace_id !== task.workspace_id ? 'workspace'
      : a.capability !== task.capability ? 'capability'
        : a.parameter_hash !== canonicalParameterHash(taskParameters(task.parameters_json)) ? 'parameter hash' : null;
  if (mismatch) {
    if (a.root_task_id === task.task_id) finishActivation(a.activation_id, 'ABORTED', `advanceTask: ${mismatch} mismatch`);
    return { ok: false, reason: `activation ${a.activation_id} does not match this task (${mismatch})` };
  }
  return { ok: true, activationId: a.activation_id };
}

/**
 * The atomic claim. Returns null when no live activation names this task (the
 * caller then refuses as usual). Otherwise exactly one caller gets won=true:
 * the activation (ISSUED → CLAIMED, lease issued) and the root task
 * (READY/TODO → RUNNING) change in one transaction or not at all.
 */
export function claimTaskUnderActivation(taskId: string, workspaceId: string, nowIso: string): { won: boolean; activationId: string } | null {
  const db = getDatabase();
  let live: LiveRead;
  try { live = readLiveActivation(Date.parse(nowIso) || Date.now()); } catch { return null; }
  if (live.kind !== 'LIVE' || live.row.root_task_id !== taskId) return null;
  const a = live.row;
  if (a.status === 'CLAIMED') return { won: false, activationId: a.activation_id };
  let abortReason: string | null = null;
  db.exec('BEGIN IMMEDIATE');
  try {
    const task: any = db.prepare('SELECT workspace_id, capability, parameters_json, autonomy_eligible FROM tasks WHERE task_id = ?').get(taskId);
    abortReason = !task ? 'root task vanished'
      : task.workspace_id !== workspaceId || a.workspace_id !== workspaceId ? 'workspace mismatch at claim'
        : task.capability !== a.capability ? 'capability mismatch at claim'
          : canonicalParameterHash(taskParameters(task.parameters_json)) !== a.parameter_hash ? 'parameter hash mismatch at claim'
            : Number(task.autonomy_eligible) !== 1 ? 'root task is not autonomy-eligible' : null;
    if (abortReason) { db.exec('ROLLBACK'); finishActivation(a.activation_id, 'ABORTED', abortReason); throw new ActivationError(`Activation ${a.activation_id} refused: ${abortReason}.`); }
    const lease = `lease-${crypto.randomBytes(8).toString('hex')}`;
    const act: any = db.prepare("UPDATE queued_task_activations SET status = 'CLAIMED', lease_id = ?, claimed_at = ? WHERE activation_id = ? AND status = 'ISSUED' AND expires_at > ?")
      .run(lease, nowIso, a.activation_id, nowIso);
    if (Number(act?.changes ?? 0) !== 1) { db.exec('ROLLBACK'); return { won: false, activationId: a.activation_id }; }
    const eligible = ORCHESTRATOR_ELIGIBLE_STATUSES.map(() => '?').join(', ');
    const t: any = db.prepare(`UPDATE tasks SET status = 'RUNNING', updated_at = ? WHERE task_id = ? AND workspace_id = ? AND status IN (${eligible})`)
      .run(nowIso, taskId, workspaceId, ...ORCHESTRATOR_ELIGIBLE_STATUSES);
    if (Number(t?.changes ?? 0) !== 1) {
      db.exec('ROLLBACK');
      finishActivation(a.activation_id, 'ABORTED', 'root task was no longer queued at claim');
      return { won: false, activationId: a.activation_id };
    }
    db.prepare('INSERT INTO task_status_history (task_id, status, created_at) VALUES (?, ?, ?)').run(taskId, 'RUNNING', nowIso);
    db.exec('COMMIT');
    return { won: true, activationId: a.activation_id };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    if (!(err instanceof ActivationError)) finishActivation(a.activation_id, 'ABORTED', `claim failed: ${String((err as any)?.message || err).slice(0, 200)}`);
    throw err;
  }
}

/** Gates that may honour a CLAIMED lease (each checks it against its own action). */
export const LEASE_GATES = ['persistence.updateTaskStatus.RUNNING', 'persistence.claimExecution', 'kernel.executeEnvelope'] as const;

/**
 * Re-read the lease and check it against what this gate is about to do.
 * `related` is true when the scope names this activation's root or child task
 * (or its correlation id) — a refusal then aborts the activation.
 */
export function verifyActivationLease(gate: string, scope: GateScope | undefined): { ok: true; activationId: string } | { ok: false; reason: string; related: boolean; activationId: string | null } {
  const live = readLiveActivation();
  if (live.kind !== 'LIVE') return { ok: false, reason: `no usable activation lease (${live.kind})`, related: false, activationId: null };
  const a = live.row;
  const s = scope ?? {};
  const related = !!(s.taskId && (s.taskId === a.root_task_id || s.taskId === a.child_task_id)) || (!!s.idempotencyKey && s.idempotencyKey === a.correlation_id);
  const refuse = (reason: string) => ({ ok: false as const, reason: `activation ${a.activation_id}: ${reason}`, related, activationId: a.activation_id });
  if (a.status !== 'CLAIMED') return refuse('not claimed');
  if (!(LEASE_GATES as readonly string[]).includes(gate)) return refuse(`${gate} is never opened by an activation`);
  if (s.workspaceId != null && s.workspaceId !== a.workspace_id) return refuse('workspace mismatch');
  switch (gate) {
    case 'persistence.updateTaskStatus.RUNNING':
      // The root is already RUNNING from the claim; only the bound child moves into RUNNING.
      return s.taskId === a.child_task_id ? { ok: true, activationId: a.activation_id } : refuse(`RUNNING is permitted only for child ${a.child_task_id}`);
    case 'persistence.claimExecution': {
      const rootKey = `orchestration-task:${a.root_task_id}`;
      const asRoot = s.idempotencyKey === rootKey && s.payloadHash === rootKey && s.taskId === a.root_task_id;
      const asChild = s.idempotencyKey === a.correlation_id && s.taskId === a.child_task_id;
      if (s.actorUserId !== 'orchestrator') return refuse('execution claim not made by the orchestrator');
      if (s.capability !== a.capability) return refuse('execution claim capability mismatch');
      return asRoot || asChild ? { ok: true, activationId: a.activation_id } : refuse('execution claim is not one of the two bound to this activation');
    }
    case 'kernel.executeEnvelope':
      if (s.taskId !== a.root_task_id) return refuse('task mismatch');
      if (s.actorUserId !== 'orchestrator') return refuse('not dispatched by the orchestrator');
      if (s.capability !== a.capability) return refuse('capability mismatch');
      if (s.idempotencyKey !== a.correlation_id) return refuse('correlation mismatch');
      if (canonicalParameterHash(s.parameters ?? {}) !== a.parameter_hash) return refuse('parameter hash mismatch');
      return { ok: true, activationId: a.activation_id };
    default:
      return refuse(`${gate} is never opened by an activation`);
  }
}

/** Abort the live activation if this scope names its task — used when a gate refuses. */
export function abortActivationIfRelated(gate: string, scope: GateScope | undefined, reason: string): void {
  const s = scope ?? {};
  if (!s.taskId && !s.idempotencyKey) return;
  const live = readLiveActivation();
  if (live.kind !== 'LIVE') return;
  const a = live.row;
  if ((s.taskId && (s.taskId === a.root_task_id || s.taskId === a.child_task_id)) || (s.idempotencyKey && s.idempotencyKey === a.correlation_id)) {
    finishActivation(a.activation_id, 'ABORTED', `${gate} refused: ${reason}`.slice(0, 500));
  }
}

/**
 * After the claimed run returns: COMPLETED only if the normal path produced a
 * DONE root, a DONE child, an artifact, a VERIFIED review and a verifying
 * receipt for the child. Anything else is ABORTED. Writes only the activation.
 */
export function settleActivation(activationId: string, outcome: string): ActivationStatus | null {
  const a = getActivation(activationId);
  if (!a || (a.status !== 'CLAIMED' && a.status !== 'ISSUED')) return a?.status ?? null;
  if (outcome !== 'ADVANCED') { finishActivation(activationId, 'ABORTED', `run ended ${outcome}`); return 'ABORTED'; }
  try {
    const db = getDatabase();
    const status = (id: string) => (db.prepare('SELECT status FROM tasks WHERE task_id = ?').get(id) as any)?.status;
    const receipt: any = db.prepare('SELECT algorithm, payload_json, signature, public_key FROM receipts WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(a.child_task_id);
    const review: any = db.prepare('SELECT decision FROM quality_reviews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(a.child_task_id);
    const artifact: any = db.prepare('SELECT artifact_id FROM artifacts WHERE task_id = ? LIMIT 1').get(a.child_task_id);
    const children = (db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE task_id NOT IN (?, ?) AND created_at >= ?').get(a.child_task_id, a.root_task_id, a.claimed_at ?? a.created_at) as any).n;
    const missing = status(a.root_task_id) !== 'DONE' ? 'root task is not DONE'
      : status(a.child_task_id) !== 'DONE' ? 'child task is not DONE'
        : !artifact ? 'no artifact for the child task'
          : review?.decision !== 'VERIFIED' ? 'Aegis did not verify the child task'
            : !receipt || !verifyReceipt(receipt) ? 'the child task has no verifying receipt'
              : Number(children) !== 0 ? 'an unexpected additional child task exists' : null;
    if (missing) { finishActivation(activationId, 'ABORTED', missing); return 'ABORTED'; }
    finishActivation(activationId, 'COMPLETED', 'root and child DONE; artifact, VERIFIED review and verifying receipt present');
    return 'COMPLETED';
  } catch (err: any) {
    finishActivation(activationId, 'ABORTED', `completion check failed: ${String(err?.message || err).slice(0, 200)}`);
    return 'ABORTED';
  }
}
