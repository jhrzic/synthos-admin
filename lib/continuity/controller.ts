// ---------------------------------------------------------------------------
// EXECUTION CONTINUITY CONTROLLER.
//
// Keeps a task moving across capacity limits WITHOUT a second task system,
// scheduler, router, spend authority, verifier or receipt authority:
//
//   task status          the existing tasks table (new non-terminal states)
//   resume               the existing scheduler tick (continuityTickForScheduler)
//   route selection      the canonical router (lib/registry/router.ts)
//   may it dispatch      the spend guard, per segment (reservation is atomic there)
//   is it right          Aegis scoped verification, per segment and on assembly
//   what happened        signed checkpoints, signed with the receipt authority's key
//
// A task's work is a chain of SEGMENTS. Each segment runs on one route
// (canonical version / provider route / deployment) chosen by a persisted
// routing decision, and records its input hash, checkpoint, ledger row, price
// snapshot, provider response id, usage, termination, Aegis result, receipt
// and artifact hashes. The task is DONE only when every segment and the
// assembled whole satisfy the contract.
//
// Recoverable conditions never become a generic FAILED. They become:
//   CHECKPOINTING · AWAITING_CONTINUATION · ROUTE_SWITCHING · RESUMING
//   PAUSED_AWAITING_CAPACITY · PAUSED_AWAITING_QUALIFIED_CAPACITY
//   PAUSED_AWAITING_BUDGET · PAUSED_AWAITING_APPROVAL
//   RECONCILING_UNKNOWN_EXECUTION
//
// An ambiguous outcome (timeout after dispatch, network loss) is never
// retried and never switched away from until there is PROOF the provider did
// not accept it (a provider lookup, or an operator's recorded resolution).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase, updateTaskStatus, recordActivityEvent, canonicalizePayload, signReceiptPayload, verifyReceiptSignature } from '../persistence';
import { recordRegistryEvent } from '../registry/store';
import type { RoutingDecision, ContinuationFloor } from '../registry/router';
import type { PrivacyClass } from '../registry/types';
import continuationPolicyData from '../registry/data/continuation-policy.json';

export const PAUSE_STATES = ['PAUSED_AWAITING_CAPACITY', 'PAUSED_AWAITING_QUALIFIED_CAPACITY', 'PAUSED_AWAITING_BUDGET', 'PAUSED_AWAITING_APPROVAL', 'PAUSED_AWAITING_REPLAN'] as const;
export const CONTINUITY_STATES = ['CHECKPOINTING', 'AWAITING_CONTINUATION', 'ROUTE_SWITCHING', 'RESUMING', ...PAUSE_STATES, 'RECONCILING_UNKNOWN_EXECUTION'] as const;
export type PauseState = (typeof PAUSE_STATES)[number];
export type ContinuityState = (typeof CONTINUITY_STATES)[number] | 'RUNNING' | 'DONE' | 'INCOMPLETE' | 'FAILED';

/** A route left mid-task is not re-selected for this long (no bouncing). */
export const ROUTE_RECOVERY_MINUTES = 15;
/**
 * CONTINUATION POLICY (data: lib/registry/data/continuation-policy.json).
 * No fixed segment count ends a task. It continues while each segment makes
 * verified forward progress and authorised budget remains; it pauses — never
 * fails, never discards work — when progress stalls (PAUSED_AWAITING_REPLAN),
 * when its authorised task spend is reached (PAUSED_AWAITING_BUDGET), or at a
 * very high absolute safety ceiling that only a malfunction could reach.
 */
export interface ContinuationPolicy { version: string; maxNoProgressSegments: number; minProgressChars: number; maxShingleOverlap: number; maxTaskSpendUsd: number; safetySegmentCeiling: number }
export function continuationPolicy(): ContinuationPolicy {
  return continuationPolicyData as ContinuationPolicy;
}
/** Bounded summary carried to a continuation. */
export const CONTINUATION_TAIL_CHARS = 2000;

let ensured = false;
export function ensureContinuityTables(): void {
  const db = getDatabase();
  if (ensured) {
    try { db.prepare('SELECT 1 FROM task_segments LIMIT 1').get(); return; } catch { ensured = false; }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_continuity (
      task_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, task_class TEXT NOT NULL, contract_json TEXT NOT NULL,
      requirements_json TEXT NOT NULL, constraints_json TEXT NOT NULL, state TEXT NOT NULL, state_reason TEXT,
      segment_count INTEGER NOT NULL DEFAULT 0, current_segment_id TEXT, current_decision_id TEXT, current_route_key TEXT,
      last_checkpoint_id TEXT, excluded_routes_json TEXT NOT NULL DEFAULT '{}', privacy_class TEXT NOT NULL DEFAULT 'STANDARD',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_segments (
      segment_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, parent_task_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      contract_json TEXT NOT NULL, routing_decision_id TEXT, provider_id TEXT, model_id TEXT, deployment_id TEXT,
      canonical_version_id TEXT, input_hash TEXT NOT NULL, checkpoint_ref TEXT, budget_usage_id TEXT, price_version TEXT,
      price_snapshot_json TEXT, provider_response_id TEXT, usage_json TEXT, termination_json TEXT, aegis_review_id TEXT,
      aegis_decision TEXT, receipt_id TEXT, artifact_hashes_json TEXT NOT NULL DEFAULT '[]', output_hash TEXT,
      status TEXT NOT NULL, status_reason TEXT, started_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE (task_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS task_checkpoints (
      checkpoint_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, sequence INTEGER NOT NULL, reason TEXT NOT NULL,
      payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, signature TEXT NOT NULL, public_key TEXT NOT NULL,
      algorithm TEXT NOT NULL, retention TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_side_effects (
      idempotency_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, segment_id TEXT, kind TEXT NOT NULL, target TEXT,
      status TEXT NOT NULL, evidence_ref TEXT, recorded_at TEXT NOT NULL, performed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_segments_task ON task_segments (task_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_task_checkpoints_task ON task_checkpoints (task_id, sequence);
  `);
  const cols = (db.prepare('PRAGMA table_info(task_segments)').all() as any[]).map((c) => c.name);
  if (!cols.includes('output_text')) db.exec('ALTER TABLE task_segments ADD COLUMN output_text TEXT');
  if (!cols.includes('progress_json')) db.exec('ALTER TABLE task_segments ADD COLUMN progress_json TEXT');
  const ccols = (db.prepare('PRAGMA table_info(task_continuity)').all() as any[]).map((c) => c.name);
  if (!ccols.includes('no_progress_count')) db.exec('ALTER TABLE task_continuity ADD COLUMN no_progress_count INTEGER NOT NULL DEFAULT 0');
  // Authorised spend for this task's continuation; an operator's resume after a
  // spend pause adds one more policy increment (explicit authorisation).
  if (!ccols.includes('spend_allowance_usd')) db.exec('ALTER TABLE task_continuity ADD COLUMN spend_allowance_usd REAL');
  ensured = true;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ---- continuity record ----------------------------------------------------------------

export interface ContinuityRecord {
  taskId: string;
  workspaceId: string;
  taskClass: string;
  contract: { mode: string; literal?: string; requiredKeys?: string[] };
  requirements: any;
  constraints: any;
  state: ContinuityState;
  stateReason: string | null;
  segmentCount: number;
  currentSegmentId: string | null;
  currentDecisionId: string | null;
  currentRouteKey: string | null;
  lastCheckpointId: string | null;
  excludedRoutes: Record<string, { since: string; reason: string }>;
  privacyClass: PrivacyClass;
  /** Consecutive continuation segments that made no verified forward progress. */
  noProgressCount: number;
  /** Authorised spend for this task (USD); null → the policy default. */
  spendAllowanceUsd: number | null;
  createdAt: string;
  updatedAt: string;
}

function fromRow(r: any): ContinuityRecord {
  return {
    taskId: r.task_id, workspaceId: r.workspace_id, taskClass: r.task_class, contract: JSON.parse(r.contract_json), requirements: JSON.parse(r.requirements_json),
    constraints: JSON.parse(r.constraints_json), state: r.state, stateReason: r.state_reason, segmentCount: r.segment_count, currentSegmentId: r.current_segment_id,
    currentDecisionId: r.current_decision_id, currentRouteKey: r.current_route_key, lastCheckpointId: r.last_checkpoint_id,
    excludedRoutes: JSON.parse(r.excluded_routes_json || '{}'), privacyClass: r.privacy_class, noProgressCount: r.no_progress_count ?? 0, spendAllowanceUsd: r.spend_allowance_usd ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function getContinuity(taskId: string): ContinuityRecord | null {
  ensureContinuityTables();
  const r = getDatabase().prepare('SELECT * FROM task_continuity WHERE task_id = ?').get(taskId);
  return r ? fromRow(r) : null;
}

export function openContinuity(p: { taskId: string; workspaceId: string; taskClass: string; contract: object; requirements: object; constraints: object; privacyClass: PrivacyClass }): ContinuityRecord {
  ensureContinuityTables();
  const now = new Date().toISOString();
  getDatabase().prepare(`INSERT INTO task_continuity (task_id, workspace_id, task_class, contract_json, requirements_json, constraints_json, state, privacy_class, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET requirements_json = excluded.requirements_json, constraints_json = excluded.constraints_json, updated_at = excluded.updated_at`)
    .run(p.taskId, p.workspaceId, p.taskClass, JSON.stringify(p.contract), JSON.stringify(p.requirements), JSON.stringify(p.constraints), p.privacyClass, now, now);
  return getContinuity(p.taskId)!;
}

export function grantSpendAllowance(taskId: string, extraUsd: number): number {
  const c = getContinuity(taskId);
  if (!c) return 0;
  const next = (c.spendAllowanceUsd ?? continuationPolicy().maxTaskSpendUsd) + extraUsd;
  getDatabase().prepare('UPDATE task_continuity SET spend_allowance_usd = ?, updated_at = ? WHERE task_id = ?').run(next, new Date().toISOString(), taskId);
  return next;
}

export function updateRequirements(taskId: string, requirements: object): void {
  ensureContinuityTables();
  getDatabase().prepare('UPDATE task_continuity SET requirements_json = ?, updated_at = ? WHERE task_id = ?').run(JSON.stringify(requirements), new Date().toISOString(), taskId);
}

export function setNoProgressCount(taskId: string, n: number): void {
  ensureContinuityTables();
  patchContinuity(taskId, { no_progress_count: n });
}

/** Task spend so far (ledger), for the continuation budget. */
export function taskSpendUsd(taskId: string): number {
  try {
    const r = getDatabase().prepare("SELECT COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) AS s FROM provider_usage WHERE task_id = ? AND status NOT IN ('BLOCKED', 'PRE_DISPATCH_FAILURE', 'OPERATOR_CLEARED')").get(taskId) as any;
    return r?.s ?? 0;
  } catch { return 0; }
}

export function recordSegmentProgress(segmentId: string, progress: unknown): void {
  ensureContinuityTables();
  getDatabase().prepare('UPDATE task_segments SET progress_json = ? WHERE segment_id = ?').run(JSON.stringify(progress), segmentId);
}

function patchContinuity(taskId: string, patch: Partial<{ no_progress_count: number; state: ContinuityState; state_reason: string | null; segment_count: number; current_segment_id: string | null; current_decision_id: string | null; current_route_key: string | null; last_checkpoint_id: string | null; excluded_routes_json: string }>): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  getDatabase().prepare(`UPDATE task_continuity SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE task_id = ?`)
    .run(...keys.map((k) => (patch as any)[k]), new Date().toISOString(), taskId);
}

/**
 * Move the task into a continuity state. The task table carries the same
 * status (it is the one task system), and the activity ledger records why.
 */
export function transition(taskId: string, workspaceId: string, state: ContinuityState, reason: string, payload: Record<string, unknown> = {}): void {
  ensureContinuityTables();
  patchContinuity(taskId, { state, state_reason: reason.slice(0, 1000) });
  if (state !== 'RUNNING') updateTaskStatus(taskId, state, undefined, workspaceId);
  const eventType = (PAUSE_STATES as readonly string[]).includes(state) ? 'TASK_PAUSED'
    : state === 'RECONCILING_UNKNOWN_EXECUTION' ? 'RECONCILIATION_REQUIRED'
    : state === 'ROUTE_SWITCHING' ? 'ROUTE_SWITCH_PROPOSED'
    : state === 'RESUMING' ? 'TASK_RESUMED'
    : state === 'CHECKPOINTING' ? 'CHECKPOINT_STARTED'
    : `CONTINUITY_${state}`;
  try { recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType, agentId: 'continuity', payload: { state, reason, ...payload } }); } catch { /* evidence must not break the transition */ }
}

// ---- segments -----------------------------------------------------------------------------

export interface SegmentRecord {
  segmentId: string;
  taskId: string;
  sequence: number;
  routingDecisionId: string | null;
  providerId: string | null;
  modelId: string | null;
  deploymentId: string | null;
  canonicalVersionId: string | null;
  inputHash: string;
  checkpointRef: string | null;
  budgetUsageId: string | null;
  priceVersion: string | null;
  priceSnapshot: unknown;
  providerResponseId: string | null;
  usage: unknown;
  termination: unknown;
  aegisReviewId: string | null;
  aegisDecision: string | null;
  receiptId: string | null;
  artifactHashes: string[];
  outputHash: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'INCOMPLETE' | 'NO_PROGRESS' | 'BLOCKED' | 'FAILED' | 'UNKNOWN' | 'NOT_ACCEPTED' | 'ACCEPTED_BY_RECONCILIATION';
  statusReason: string | null;
  startedAt: string;
  completedAt: string | null;
}

function segFromRow(r: any): SegmentRecord {
  return {
    segmentId: r.segment_id, taskId: r.task_id, sequence: r.sequence, routingDecisionId: r.routing_decision_id, providerId: r.provider_id, modelId: r.model_id,
    deploymentId: r.deployment_id, canonicalVersionId: r.canonical_version_id, inputHash: r.input_hash, checkpointRef: r.checkpoint_ref, budgetUsageId: r.budget_usage_id,
    priceVersion: r.price_version, priceSnapshot: r.price_snapshot_json ? JSON.parse(r.price_snapshot_json) : null, providerResponseId: r.provider_response_id,
    usage: r.usage_json ? JSON.parse(r.usage_json) : null, termination: r.termination_json ? JSON.parse(r.termination_json) : null, aegisReviewId: r.aegis_review_id,
    aegisDecision: r.aegis_decision, receiptId: r.receipt_id, artifactHashes: JSON.parse(r.artifact_hashes_json || '[]'), outputHash: r.output_hash,
    status: r.status, statusReason: r.status_reason, startedAt: r.started_at, completedAt: r.completed_at,
  };
}

export function listSegments(taskId: string): SegmentRecord[] {
  ensureContinuityTables();
  return (getDatabase().prepare('SELECT * FROM task_segments WHERE task_id = ? ORDER BY sequence').all(taskId) as any[]).map(segFromRow);
}

export function openSegment(p: { taskId: string; contract: object; decision: RoutingDecision; inputHash: string; checkpointRef: string | null }): SegmentRecord {
  ensureContinuityTables();
  const c = getContinuity(p.taskId)!;
  const sequence = c.segmentCount + 1;
  const segmentId = `seg-${p.taskId.slice(0, 40)}-${sequence}-${crypto.randomBytes(3).toString('hex')}`;
  const s = p.decision.selected!;
  const now = new Date().toISOString();
  getDatabase().prepare(`INSERT INTO task_segments (segment_id, task_id, parent_task_id, sequence, contract_json, routing_decision_id, provider_id, model_id, deployment_id, canonical_version_id,
      input_hash, checkpoint_ref, price_version, price_snapshot_json, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)`)
    .run(segmentId, p.taskId, p.taskId, sequence, JSON.stringify(p.contract), p.decision.decisionId, s.providerId, s.modelId, s.deploymentId, s.canonicalVersionId,
      p.inputHash, p.checkpointRef, s.priceVersion, s.priceSnapshot ? JSON.stringify(s.priceSnapshot) : null, now);
  getDatabase().prepare('UPDATE routing_decisions SET segment_id = ? WHERE decision_id = ?').run(segmentId, p.decision.decisionId);
  patchContinuity(p.taskId, { segment_count: sequence, current_segment_id: segmentId, current_decision_id: p.decision.decisionId, current_route_key: `${s.providerId}/${s.modelId}@${s.deploymentId}`, state: 'RUNNING', state_reason: null });
  try { recordActivityEvent({ taskId: p.taskId, expectedWorkspaceId: c.workspaceId, eventType: 'SEGMENT_STARTED', agentId: 'continuity', payload: { segmentId, sequence, route: `${s.providerId}/${s.modelId}@${s.deploymentId}`, canonicalVersionId: s.canonicalVersionId, routingDecisionId: p.decision.decisionId, priceVersion: s.priceVersion } }); } catch { /* evidence only */ }
  return listSegments(p.taskId).find((x) => x.segmentId === segmentId)!;
}

export function closeSegment(segmentId: string, p: Partial<{ status: SegmentRecord['status']; statusReason: string | null; budgetUsageId: string | null; providerResponseId: string | null; usage: unknown; termination: unknown; aegisReviewId: string | null; aegisDecision: string | null; receiptId: string | null; artifactHashes: string[]; outputHash: string | null }>): void {
  ensureContinuityTables();
  const map: Record<string, [string, (v: any) => any]> = {
    status: ['status', (v) => v], statusReason: ['status_reason', (v) => v], budgetUsageId: ['budget_usage_id', (v) => v], providerResponseId: ['provider_response_id', (v) => v],
    usage: ['usage_json', (v) => (v == null ? null : JSON.stringify(v))], termination: ['termination_json', (v) => (v == null ? null : JSON.stringify(v))],
    aegisReviewId: ['aegis_review_id', (v) => v], aegisDecision: ['aegis_decision', (v) => v], receiptId: ['receipt_id', (v) => v],
    artifactHashes: ['artifact_hashes_json', (v) => JSON.stringify(v ?? [])], outputHash: ['output_hash', (v) => v],
  };
  const keys = Object.keys(p).filter((k) => map[k]);
  const sets = keys.map((k) => `${map[k][0]} = ?`);
  const vals = keys.map((k) => map[k][1]((p as any)[k]));
  const terminal = p.status && p.status !== 'RUNNING';
  getDatabase().prepare(`UPDATE task_segments SET ${sets.join(', ')}${terminal ? ', completed_at = ?' : ''} WHERE segment_id = ?`)
    .run(...vals, ...(terminal ? [new Date().toISOString()] : []), segmentId);
  if (terminal) {
    const seg = getDatabase().prepare('SELECT task_id, sequence FROM task_segments WHERE segment_id = ?').get(segmentId) as any;
    const c = seg ? getContinuity(seg.task_id) : null;
    if (c) try { recordActivityEvent({ taskId: c.taskId, expectedWorkspaceId: c.workspaceId, eventType: 'SEGMENT_COMPLETED', agentId: 'continuity', payload: { segmentId, sequence: seg.sequence, status: p.status, reason: p.statusReason ?? null, usageId: p.budgetUsageId ?? null, receiptId: p.receiptId ?? null } }); } catch { /* evidence only */ }
  }
}

// ---- side effects -------------------------------------------------------------------------

export type SideEffectKind = 'MESSAGE' | 'EMAIL' | 'PAYMENT' | 'TRANSFER' | 'DB_MUTATION' | 'FILE_WRITE' | 'DEPLOYMENT' | 'EXTERNAL_API' | 'APPROVAL' | 'PROVIDER_CALL';

/**
 * Record a side effect under a DURABLE idempotency key before performing it
 * (PENDING), and mark it PERFORMED after. A key that is already PERFORMED is
 * refused — a continuation can never repeat it.
 */
export function claimSideEffect(p: { taskId: string; segmentId?: string | null; kind: SideEffectKind; target?: string | null; idempotencyKey: string }): { ok: true } | { ok: false; code: 'ALREADY_PERFORMED' | 'PENDING_UNKNOWN'; status: string } {
  ensureContinuityTables();
  const existing = getDatabase().prepare('SELECT status FROM task_side_effects WHERE idempotency_key = ?').get(p.idempotencyKey) as any;
  if (existing) return { ok: false, code: existing.status === 'PERFORMED' ? 'ALREADY_PERFORMED' : 'PENDING_UNKNOWN', status: existing.status };
  getDatabase().prepare(`INSERT INTO task_side_effects (idempotency_key, task_id, segment_id, kind, target, status, recorded_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`)
    .run(p.idempotencyKey, p.taskId, p.segmentId ?? null, p.kind, p.target ?? null, new Date().toISOString());
  return { ok: true };
}

export function completeSideEffect(idempotencyKey: string, status: 'PERFORMED' | 'NOT_PERFORMED' | 'UNKNOWN', evidenceRef?: string | null): void {
  ensureContinuityTables();
  getDatabase().prepare('UPDATE task_side_effects SET status = ?, evidence_ref = ?, performed_at = ? WHERE idempotency_key = ?').run(status, evidenceRef ?? null, new Date().toISOString(), idempotencyKey);
}

/** Every side effect this task caused, from this ledger and the existing ones (emails, paid calls). */
export function sideEffectsOf(taskId: string): Array<{ kind: string; idempotencyKey: string; target: string | null; status: string; evidenceRef: string | null }> {
  ensureContinuityTables();
  const db = getDatabase();
  const out = (db.prepare('SELECT * FROM task_side_effects WHERE task_id = ? ORDER BY recorded_at').all(taskId) as any[])
    .map((r) => ({ kind: r.kind, idempotencyKey: r.idempotency_key, target: r.target, status: r.status, evidenceRef: r.evidence_ref }));
  try {
    for (const r of db.prepare("SELECT attempt_id, status, provider_message_id FROM gmail_send_attempts WHERE task_id = ?").all(taskId) as any[]) {
      out.push({ kind: 'EMAIL', idempotencyKey: `gmail:${r.attempt_id}`, target: null, status: r.status === 'SENT' ? 'PERFORMED' : r.status === 'FAILED' ? 'NOT_PERFORMED' : 'UNKNOWN', evidenceRef: r.provider_message_id ?? r.attempt_id });
    }
  } catch { /* gmail ledger not created in this database */ }
  try {
    for (const r of db.prepare("SELECT usage_id, idempotency_key, status FROM provider_usage WHERE task_id = ? AND status != 'BLOCKED'").all(taskId) as any[]) {
      out.push({ kind: 'PROVIDER_CALL', idempotencyKey: r.idempotency_key, target: null, status: r.status === 'SUCCESS' ? 'PERFORMED' : ['UNKNOWN', 'TIMEOUT_AFTER_DISPATCH', 'DISPATCHED', 'RESERVED'].includes(r.status) ? 'UNKNOWN' : 'NOT_PERFORMED', evidenceRef: r.usage_id });
    }
  } catch { /* usage ledger not created */ }
  return out;
}

// ---- checkpoints ----------------------------------------------------------------------------

export interface CheckpointPayload {
  checkpointVersion: 1;
  taskId: string;
  workspaceId: string;
  sequence: number;
  reason: string;
  objective: string;
  taskClass: string;
  contract: object;
  acceptanceCriteria: string[];
  completedSteps: Array<{ segmentId: string; sequence: number; status: string }>;
  verifiedOutputs: Array<{ segmentId: string; outputHash: string | null; artifactHashes: string[]; receiptId: string | null }>;
  artifactRefs: string[];
  brainRefs: string[];
  decisions: string[];
  openQuestions: string[];
  remainingWork: string[];
  toolState: Record<string, unknown>;
  pendingExternalActions: Array<{ kind: string; idempotencyKey: string }>;
  approvals: string[];
  budget: { spentUsd: number; reservedUsd: number };
  idempotencyKeys: string[];
  sideEffectsPerformed: Array<{ kind: string; idempotencyKey: string; evidenceRef: string | null }>;
  prohibitedRepeats: string[];
  currentRoute: string | null;
  /** Bounded summary of work so far, by reference plus a short tail. Never the raw prompt when privacy forbids it. */
  summary: { tailChars: number; tail: string | null; tailHash: string | null };
  createdAt: string;
}

export interface CheckpointRecord {
  checkpointId: string;
  taskId: string;
  sequence: number;
  reason: string;
  payload: CheckpointPayload;
  payloadHash: string;
  signature: string;
  publicKey: string;
  algorithm: string;
  retention: string;
  createdAt: string;
  verified: boolean;
}

export function writeCheckpoint(p: {
  taskId: string; reason: string; objective: string; acceptanceCriteria: string[]; remainingWork: string[]; openQuestions?: string[];
  brainRefs?: string[]; approvals?: string[]; toolState?: Record<string, unknown>; tail?: string | null;
}): CheckpointRecord {
  ensureContinuityTables();
  const c = getContinuity(p.taskId);
  if (!c) throw new Error(`no continuity record for ${p.taskId}`);
  const segs = listSegments(p.taskId);
  const effects = sideEffectsOf(p.taskId);
  const db = getDatabase();
  let spent = 0; let reserved = 0;
  try {
    const r = db.prepare("SELECT COALESCE(SUM(CASE WHEN status IN ('RESERVED','DISPATCHED') THEN COALESCE(estimated_cost_usd,0) ELSE 0 END),0) AS reserved, COALESCE(SUM(CASE WHEN status NOT IN ('RESERVED','DISPATCHED','BLOCKED') THEN COALESCE(actual_cost_usd, estimated_cost_usd, 0) ELSE 0 END),0) AS spent FROM provider_usage WHERE task_id = ?").get(p.taskId) as any;
    spent = r?.spent ?? 0; reserved = r?.reserved ?? 0;
  } catch { /* no ledger */ }
  const prior = (db.prepare('SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = ?').get(p.taskId) as any).n as number;
  // Privacy: a ZERO_RETENTION / LOCAL_ONLY task keeps work by reference and hash only.
  const keepTail = c.privacyClass === 'STANDARD' || c.privacyClass === 'NO_TRAINING';
  const tail = p.tail ? p.tail.slice(-CONTINUATION_TAIL_CHARS) : null;
  const payload: CheckpointPayload = {
    checkpointVersion: 1, taskId: p.taskId, workspaceId: c.workspaceId, sequence: prior + 1, reason: p.reason,
    objective: p.objective.slice(0, 4000), taskClass: c.taskClass, contract: c.contract, acceptanceCriteria: p.acceptanceCriteria,
    completedSteps: segs.map((s) => ({ segmentId: s.segmentId, sequence: s.sequence, status: s.status })),
    verifiedOutputs: segs.filter((s) => s.status === 'COMPLETED').map((s) => ({ segmentId: s.segmentId, outputHash: s.outputHash, artifactHashes: s.artifactHashes, receiptId: s.receiptId })),
    artifactRefs: segs.flatMap((s) => s.artifactHashes), brainRefs: p.brainRefs ?? [], decisions: segs.map((s) => s.routingDecisionId).filter((x): x is string => !!x),
    openQuestions: p.openQuestions ?? [], remainingWork: p.remainingWork, toolState: p.toolState ?? {},
    pendingExternalActions: effects.filter((e) => e.status === 'PENDING' || e.status === 'UNKNOWN').map((e) => ({ kind: e.kind, idempotencyKey: e.idempotencyKey })),
    approvals: p.approvals ?? [], budget: { spentUsd: Math.round(spent * 1e6) / 1e6, reservedUsd: Math.round(reserved * 1e6) / 1e6 },
    idempotencyKeys: effects.map((e) => e.idempotencyKey),
    sideEffectsPerformed: effects.filter((e) => e.status === 'PERFORMED').map((e) => ({ kind: e.kind, idempotencyKey: e.idempotencyKey, evidenceRef: e.evidenceRef })),
    prohibitedRepeats: effects.filter((e) => e.status === 'PERFORMED' || e.status === 'UNKNOWN' || e.status === 'PENDING').map((e) => e.idempotencyKey),
    currentRoute: c.currentRouteKey,
    summary: { tailChars: CONTINUATION_TAIL_CHARS, tail: keepTail ? tail : null, tailHash: tail ? sha256(tail) : null },
    createdAt: new Date().toISOString(),
  };
  const canonical = canonicalizePayload(payload as unknown as Record<string, any>);
  const signed = signReceiptPayload(canonical);
  const checkpointId = newId('ckpt');
  db.prepare(`INSERT INTO task_checkpoints (checkpoint_id, task_id, sequence, reason, payload_json, payload_hash, signature, public_key, algorithm, retention, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(checkpointId, p.taskId, payload.sequence, p.reason, canonical, sha256(canonical), signed.signature, signed.publicKeyPem, signed.algorithm, keepTail ? 'STANDARD' : 'REFERENCE_ONLY', payload.createdAt);
  patchContinuity(p.taskId, { last_checkpoint_id: checkpointId });
  try { recordActivityEvent({ taskId: p.taskId, expectedWorkspaceId: c.workspaceId, eventType: 'CHECKPOINT_CREATED', agentId: 'continuity', payload: { checkpointId, sequence: payload.sequence, reason: p.reason, payloadHash: sha256(canonical), fingerprint: signed.fingerprint, sideEffectsPerformed: payload.sideEffectsPerformed.length, prohibitedRepeats: payload.prohibitedRepeats.length } }); } catch { /* evidence only */ }
  return getCheckpoint(checkpointId)!;
}

export function getCheckpoint(checkpointId: string): CheckpointRecord | null {
  ensureContinuityTables();
  const r = getDatabase().prepare('SELECT * FROM task_checkpoints WHERE checkpoint_id = ?').get(checkpointId) as any;
  if (!r) return null;
  let verified = false;
  try { verified = sha256(r.payload_json) === r.payload_hash && verifyReceiptSignature(r.payload_json, r.signature, r.public_key); } catch { verified = false; }
  return {
    checkpointId: r.checkpoint_id, taskId: r.task_id, sequence: r.sequence, reason: r.reason, payload: JSON.parse(r.payload_json), payloadHash: r.payload_hash,
    signature: r.signature, publicKey: r.public_key, algorithm: r.algorithm, retention: r.retention, createdAt: r.created_at, verified,
  };
}

export function listCheckpoints(taskId: string): CheckpointRecord[] {
  ensureContinuityTables();
  return (getDatabase().prepare('SELECT checkpoint_id FROM task_checkpoints WHERE task_id = ? ORDER BY sequence').all(taskId) as any[]).map((r) => getCheckpoint(r.checkpoint_id)!);
}

/**
 * The minimal context a replacement route receives: the objective, contract,
 * constraints and approvals verbatim (never dropped), completed work by
 * reference, a bounded tail, and what must not be repeated. A checkpoint that
 * fails signature verification is refused.
 */
export function continuationContext(checkpointId: string, nextStep: string): { ok: true; text: string; inputHash: string } | { ok: false; error: string } {
  const ck = getCheckpoint(checkpointId);
  if (!ck) return { ok: false, error: 'checkpoint not found' };
  if (!ck.verified) return { ok: false, error: 'checkpoint signature does not verify; continuation refused' };
  const p = ck.payload;
  const lines = [
    'You are continuing a task that another execution segment started. Complete ONLY the next step below.',
    `OBJECTIVE: ${p.objective}`,
    `OUTPUT CONTRACT: ${JSON.stringify(p.contract)}`,
    p.acceptanceCriteria.length ? `ACCEPTANCE CRITERIA:\n- ${p.acceptanceCriteria.join('\n- ')}` : '',
    p.approvals.length ? `APPROVALS IN FORCE: ${p.approvals.join(', ')}` : '',
    `COMPLETED SEGMENTS (verified, by reference): ${p.verifiedOutputs.map((v) => `${v.segmentId}#${(v.outputHash ?? '').slice(0, 12)}`).join(', ') || 'none'}`,
    p.prohibitedRepeats.length ? `DO NOT REPEAT these already-performed actions: ${p.prohibitedRepeats.join(', ')}` : '',
    p.summary.tail ? `TEXT SO FAR ENDS WITH (continue seamlessly from here, do not restate it):\n"""${p.summary.tail}"""` : '',
    `NEXT STEP: ${nextStep}`,
  ].filter(Boolean);
  const text = lines.join('\n\n');
  return { ok: true, text, inputHash: sha256(text) };
}

// ---- switching ----------------------------------------------------------------------------------

/** The same-or-stronger floor a continuation must meet, derived from the route being left. */
export function floorFrom(decision: RoutingDecision | null, c: ContinuityRecord, qualifiedQuality: number, qualifiedReliability: number, contextTokens: number | null, capabilities: string[]): ContinuationFloor {
  const excluded = Object.entries(c.excludedRoutes).filter(([, v]) => Date.now() - Date.parse(v.since) < ROUTE_RECOVERY_MINUTES * 60_000).map(([k]) => k);
  return {
    minQuality: qualifiedQuality, minReliability: qualifiedReliability, privacyClass: c.privacyClass,
    minContextTokens: contextTokens, capabilities, outputContract: (c.contract as any).mode,
    // Only routes still cooling down; a recovered route is eligible again.
    excludeRoutes: [...new Set(excluded)],
  };
}

export function excludeRoute(taskId: string, routeKey: string, reason: string): void {
  const c = getContinuity(taskId);
  if (!c) return;
  const ex = { ...c.excludedRoutes, [routeKey]: { since: new Date().toISOString(), reason } };
  patchContinuity(taskId, { excluded_routes_json: JSON.stringify(ex) });
}

export function finish(taskId: string, state: 'DONE' | 'INCOMPLETE' | 'FAILED', reason: string): void {
  ensureContinuityTables();
  patchContinuity(taskId, { state, state_reason: reason.slice(0, 1000) });
}

// ---- reconciliation of UNKNOWN outcomes -----------------------------------------------------------

export type Resolution = 'NOT_ACCEPTED' | 'ACCEPTED' | 'ABANDON';

/**
 * An operator's (or a provider lookup's) resolution of an ambiguous segment.
 * NOT_ACCEPTED is the proof that lets the task continue — on any qualified
 * route — because nothing was processed. ACCEPTED means the provider did
 * process it; its output is not recoverable here, so the task is INCOMPLETE
 * and the paid call is recorded, never silently re-run. ABANDON cancels.
 */
export function resolveUnknownSegment(p: { taskId: string; segmentId: string; resolution: Resolution; actor: string; evidence: string }): { ok: true; state: string } | { ok: false; error: string } {
  const c = getContinuity(p.taskId);
  if (!c) return { ok: false, error: 'no continuity record' };
  if (c.state !== 'RECONCILING_UNKNOWN_EXECUTION') return { ok: false, error: `task is ${c.state}, not awaiting reconciliation` };
  const seg = listSegments(p.taskId).find((s) => s.segmentId === p.segmentId);
  if (!seg || seg.status !== 'UNKNOWN') return { ok: false, error: 'segment is not UNKNOWN' };
  if (!p.evidence || p.evidence.trim().length < 3) return { ok: false, error: 'a resolution must cite its evidence (provider dashboard, request id, support reply…)' };
  recordRegistryEvent('CONTINUITY_RECONCILED', { actor: p.actor, taskId: p.taskId, segmentId: p.segmentId, resolution: p.resolution });
  try { recordActivityEvent({ taskId: p.taskId, expectedWorkspaceId: c.workspaceId, eventType: 'RECONCILIATION_RESOLVED', agentId: p.actor, payload: { segmentId: p.segmentId, resolution: p.resolution, evidence: p.evidence.slice(0, 500) } }); } catch { /* evidence only */ }
  if (p.resolution === 'NOT_ACCEPTED') {
    closeSegment(p.segmentId, { status: 'NOT_ACCEPTED', statusReason: `operator: not accepted by the provider — ${p.evidence.slice(0, 200)}` });
    if (seg.budgetUsageId) {
      try { getDatabase().prepare(`UPDATE provider_usage SET status = 'OPERATOR_CLEARED', reason = ? WHERE usage_id = ? AND status IN ('TIMEOUT_AFTER_DISPATCH', 'UNKNOWN')`).run(`reconciled NOT_ACCEPTED by ${p.actor}: ${p.evidence.slice(0, 200)}`, seg.budgetUsageId); } catch { /* ledger optional */ }
    }
    if (c.currentRouteKey) excludeRoute(p.taskId, c.currentRouteKey, 'ambiguous outcome reconciled');
    transition(p.taskId, c.workspaceId, 'AWAITING_CONTINUATION', 'The ambiguous segment was proven not accepted; the task may continue on a qualified route.');
    updateTaskStatus(p.taskId, 'READY', undefined, c.workspaceId);
    return { ok: true, state: 'READY' };
  }
  if (p.resolution === 'ACCEPTED') {
    closeSegment(p.segmentId, { status: 'ACCEPTED_BY_RECONCILIATION', statusReason: `operator: the provider processed it — ${p.evidence.slice(0, 200)}` });
    finish(p.taskId, 'INCOMPLETE', 'The provider processed the ambiguous segment but its output was not received; it is not re-run automatically.');
    updateTaskStatus(p.taskId, 'INCOMPLETE', undefined, c.workspaceId);
    return { ok: true, state: 'INCOMPLETE' };
  }
  closeSegment(p.segmentId, { status: 'UNKNOWN', statusReason: `abandoned by ${p.actor}` });
  finish(p.taskId, 'FAILED', `abandoned by ${p.actor} during reconciliation`);
  updateTaskStatus(p.taskId, 'CANCELLED', undefined, c.workspaceId);
  return { ok: true, state: 'CANCELLED' };
}

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Automatic reconciliation, only where the route supports it: the provider
 * manifest declares an idempotency header AND a lookup path, so a request's
 * fate can be asked by its idempotency key. A 404 from such a lookup is proof
 * of non-acceptance; anything else leaves the task for an operator.
 */
export async function reconcileViaProvider(p: { taskId: string; segmentId: string; lookupUrl: string; headers: Record<string, string>; fetcher: Fetcher }): Promise<'NOT_ACCEPTED' | 'ACCEPTED' | 'STILL_UNKNOWN'> {
  try {
    const res = await p.fetcher(p.lookupUrl, { method: 'GET', redirect: 'error', headers: p.headers });
    if (res.status === 404) {
      const r = resolveUnknownSegment({ taskId: p.taskId, segmentId: p.segmentId, resolution: 'NOT_ACCEPTED', actor: 'reconciler', evidence: `provider lookup ${p.lookupUrl.replace(/\?.*$/, '')} returned 404 for the idempotency key` });
      return r.ok ? 'NOT_ACCEPTED' : 'STILL_UNKNOWN';
    }
    if (res.ok) {
      const r = resolveUnknownSegment({ taskId: p.taskId, segmentId: p.segmentId, resolution: 'ACCEPTED', actor: 'reconciler', evidence: `provider lookup found the request (HTTP ${res.status})` });
      return r.ok ? 'ACCEPTED' : 'STILL_UNKNOWN';
    }
  } catch { /* unreachable: still unknown */ }
  return 'STILL_UNKNOWN';
}

// ---- views --------------------------------------------------------------------------------------------

export function continuityView(taskId: string): { continuity: ContinuityRecord | null; segments: SegmentRecord[]; checkpoints: Array<Omit<CheckpointRecord, 'publicKey' | 'signature'> & { fingerprint: string }>; sideEffects: ReturnType<typeof sideEffectsOf> } {
  const c = getContinuity(taskId);
  return {
    continuity: c,
    segments: c ? listSegments(taskId) : [],
    checkpoints: c ? listCheckpoints(taskId).map(({ publicKey, signature, ...rest }) => ({ ...rest, fingerprint: sha256(publicKey).slice(0, 16) })) : [],
    sideEffects: c ? sideEffectsOf(taskId) : [],
  };
}

export function listPausedTasks(): ContinuityRecord[] {
  ensureContinuityTables();
  const states = [...PAUSE_STATES, 'RECONCILING_UNKNOWN_EXECUTION', 'AWAITING_CONTINUATION'];
  return (getDatabase().prepare(`SELECT * FROM task_continuity WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY updated_at`).all(...states) as any[]).map(fromRow);
}
