// ---------------------------------------------------------------------------
// THE CANONICAL HUMAN-APPROVAL LIFECYCLE.
//
// This is the prerequisite for Tool Pack 2. Gmail — the first real
// EXTERNAL_ACTION — must not exist before it, because an outbound message is
// the first thing SynthOS can do that cannot be undone by deleting a row.
//
// THE INVARIANT, and everything here exists to serve it:
//
//     An EXTERNAL_ACTION cannot dispatch until Guardian permits it AND an
//     authorized human approval exists that is bound to exactly this action.
//
// Note the AND. Human approval does not override Guardian; Guardian does not
// substitute for human approval. Two independent gates, both required, neither
// able to satisfy the other. A system where a human can click past a policy
// denial has a policy engine for decoration.
//
// ---------------------------------------------------------------------------
// WHAT IS *NOT* BUILT HERE, deliberately
// ---------------------------------------------------------------------------
// No second task system. No second execution queue. No approval "engine" that
// runs anything. This module records decisions and answers one question —
// "may this action dispatch?" — for lib/fabric/envelope.ts, which remains the
// only dispatcher.
//
// Recurring standing grants (an "always allow newsletters to this list" policy)
// are explicitly out of scope for this pass. The consequence is deliberate and
// stated in C5/C6: a recurring schedule whose capability needs approval will
// stop at every occurrence. That is the safe failure, and it is better than
// shipping a grant model nobody has specified yet.
//
// ---------------------------------------------------------------------------
// STATE MODEL, and why APPROVED is not a task status
// ---------------------------------------------------------------------------
// The canonical task lifecycle is TODO → READY → RUNNING → AWAITING_VERIFICATION
// → AWAITING_RECEIPT → DONE. Two states are added to it:
//
//   WAITING_FOR_APPROVAL — a real durable state work SITS IN. It belongs on the
//                          task, because that is where "this is stuck waiting
//                          for a human" has to be visible.
//   REJECTED             — terminal, alongside FAILED.
//
// APPROVED is NOT added as a task status, and the instruction explicitly
// invited that judgement. "Approved" is a fact about a DECISION, not a state
// work rests in: work that has been approved is work that is *ready to run*. A
// task therefore returns to READY and the approval row carries the decision.
// Modelling it as a task status would create two representations of the same
// fact — the task says APPROVED, the approval row says APPROVED — and the
// first time they disagreed, nothing would say which was authoritative.
//
// The approval row's own statuses are PENDING → APPROVED → CONSUMED, or
// PENDING → REJECTED, or PENDING/APPROVED → EXPIRED.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase, canonicalizePayload } from './persistence';
import { recordRuntimeEvent } from './runtime-events';
import { scrubSecrets } from './redact';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONSUMED';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export interface ApprovalRecord {
  approval_id: string;
  workspace_id: string;
  task_id: string | null;
  correlation_id: string;
  capability: string;
  action: string;
  effect_class: string;
  requested_by_user_id: string;
  decided_by_user_id: string | null;
  guardian_decision: string;
  guardian_citation: string | null;
  action_summary: string;
  input_digest: string;
  status: ApprovalStatus;
  decision_reason: string | null;
  created_at: string;
  decided_at: string | null;
  expires_at: string | null;
  consumed_at: string | null;
  consumed_by_task_id: string | null;
}

/** How long an unused approval stays usable. Short on purpose — see requestApproval. */
export const DEFAULT_APPROVAL_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Ceiling on the human-readable summary shown in the queue. */
const SUMMARY_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------
// THE BINDING DIGEST — C3.
//
// This is the mechanism behind "approving a draft to Alice must not authorize a
// changed message to Bob". The digest covers the workspace, capability, action
// and the full input payload, canonicalized so that key order and whitespace
// cannot change it while the MEANING cannot change without changing it.
//
// It reuses canonicalizePayload from lib/persistence.ts — the same
// canonicalization the receipt signing path uses. That matters: if approval
// binding and receipt signing disagreed about what "the same payload" means,
// a receipt could attest work that no approval covered.
// ---------------------------------------------------------------------------
export function computeInputDigest(params: {
  workspaceId: string;
  capability: string;
  action: string;
  parameters: Record<string, unknown>;
  rawText?: string;
}): string {
  const canonical = canonicalizePayload({
    workspaceId: params.workspaceId,
    capability: params.capability,
    action: params.action,
    // JSON.stringify of the already-canonicalized object keeps nested ordering
    // stable; canonicalizePayload alone is shallow.
    parameters: canonicalizePayload((params.parameters ?? {}) as Record<string, unknown>),
    rawText: params.rawText ?? '',
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function rowToRecord(row: any): ApprovalRecord {
  return row as ApprovalRecord;
}

function recordApprovalEvent(
  approval: ApprovalRecord,
  status: 'SUCCESS' | 'BLOCKED' | 'FAILED',
  note: string,
): void {
  try {
    recordRuntimeEvent({
      workspaceId: approval.workspace_id,
      eventType: 'CAPABILITY_INVOCATION',
      targetType: 'capability',
      targetId: approval.capability,
      status,
      detail: {
        approvalId: approval.approval_id,
        approvalStatus: approval.status,
        correlationId: approval.correlation_id,
        capability: approval.capability,
        action: approval.action,
        effectClass: approval.effect_class,
        requestedBy: approval.requested_by_user_id,
        decidedBy: approval.decided_by_user_id,
        guardianDecision: approval.guardian_decision,
        inputDigest: approval.input_digest,
        note,
      },
    });
  } catch {
    /* evidence must never be the thing that fails an approval decision */
  }
}

// ---------------------------------------------------------------------------
// REQUEST
// ---------------------------------------------------------------------------

export interface RequestApprovalParams {
  workspaceId: string;
  taskId?: string | null;
  correlationId: string;
  capability: string;
  action: string;
  effectClass: string;
  requestedByUserId: string;
  /** Guardian's verdict, decided BEFORE the human is asked. */
  guardianDecision: string;
  guardianCitation?: string | null;
  /** Human-readable, bounded. Scrubbed before storage. */
  actionSummary: string;
  inputDigest: string;
  ttlMs?: number;
}

/**
 * Create a PENDING approval request.
 *
 * The summary is scrubbed through lib/redact.ts before it is stored. A summary
 * is assembled from the action's own inputs, and for an email tool those inputs
 * are attacker-influenceable text that will be rendered in the Admin queue; a
 * credential pasted into a draft body must not be persisted into the approval
 * record or displayed back. Scrubbing happens before truncation, the same order
 * lib/redact.ts already enforces elsewhere, because truncating first can split
 * a secret across the boundary and leave half of it visible.
 *
 * TTL is one hour by default, not indefinite. An approval is permission to do
 * something *now*; an approval granted on Monday and spent on Friday is
 * permission for a situation that no longer exists.
 */
export function requestApproval(params: RequestApprovalParams): ApprovalRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const ttl = params.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;

  const record: ApprovalRecord = {
    approval_id: `apr-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
    workspace_id: params.workspaceId,
    task_id: params.taskId ?? null,
    correlation_id: params.correlationId,
    capability: params.capability,
    action: params.action,
    effect_class: params.effectClass,
    requested_by_user_id: params.requestedByUserId,
    decided_by_user_id: null,
    guardian_decision: params.guardianDecision,
    guardian_citation: params.guardianCitation ?? null,
    action_summary: scrubSecrets(params.actionSummary || '(no summary supplied)', SUMMARY_MAX_CHARS),
    input_digest: params.inputDigest,
    status: 'PENDING',
    decision_reason: null,
    created_at: now,
    decided_at: null,
    expires_at: ttl > 0 ? new Date(Date.now() + ttl).toISOString() : null,
    consumed_at: null,
    consumed_by_task_id: null,
  };

  db.prepare(
    `INSERT INTO approvals (
       approval_id, workspace_id, task_id, correlation_id, capability, action, effect_class,
       requested_by_user_id, decided_by_user_id, guardian_decision, guardian_citation,
       action_summary, input_digest, status, decision_reason, created_at, decided_at,
       expires_at, consumed_at, consumed_by_task_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.approval_id, record.workspace_id, record.task_id, record.correlation_id,
    record.capability, record.action, record.effect_class, record.requested_by_user_id,
    record.decided_by_user_id, record.guardian_decision, record.guardian_citation,
    record.action_summary, record.input_digest, record.status, record.decision_reason,
    record.created_at, record.decided_at, record.expires_at, record.consumed_at,
    record.consumed_by_task_id,
  );

  recordApprovalEvent(record, 'BLOCKED', 'Approval requested; dispatch withheld pending a human decision.');
  return record;
}

// ---------------------------------------------------------------------------
// DECIDE
// ---------------------------------------------------------------------------

export type DecideFailureCode = 'NOT_FOUND' | 'WRONG_WORKSPACE' | 'ALREADY_DECIDED' | 'EXPIRED';

export type DecideOutcome =
  | { ok: true; approval: ApprovalRecord; reason?: undefined; code?: undefined }
  | { ok: false; approval?: undefined; reason: string; code: DecideFailureCode };

/**
 * Record a human decision.
 *
 * AUTHORITY IS NOT CHECKED HERE — it is enforced at the HTTP boundary by
 * requireWorkspaceAdmin, the same middleware every other privileged route uses.
 * This function takes an already-authenticated decider id.
 *
 * That split is deliberate rather than lazy: putting a role check in here as
 * well would mean two places deciding who may approve, and the Tool Pack 1
 * vulnerability was precisely two places deciding the same thing with
 * different logic. What this function DOES enforce is the workspace match, so a
 * correctly-authenticated admin of workspace A still cannot decide workspace
 * B's approval even if the route were ever wired wrongly.
 */
export function decideApproval(params: {
  approvalId: string;
  workspaceId: string;
  decidedByUserId: string;
  decision: ApprovalDecision;
  reason?: string | null;
  nowIso?: string;
}): DecideOutcome {
  const db = getDatabase();
  const now = params.nowIso || new Date().toISOString();

  const row: any = db.prepare('SELECT * FROM approvals WHERE approval_id = ?').get(params.approvalId);
  if (!row) return { ok: false, reason: `No approval "${params.approvalId}" exists.`, code: 'NOT_FOUND' };

  if (row.workspace_id !== params.workspaceId) {
    // Same message shape as NOT_FOUND on purpose: confirming that an approval
    // exists in another workspace is itself a cross-workspace disclosure.
    return { ok: false, reason: `No approval "${params.approvalId}" exists.`, code: 'WRONG_WORKSPACE' };
  }
  if (row.status !== 'PENDING') {
    return {
      ok: false,
      reason: `Approval "${params.approvalId}" is already ${row.status} and cannot be decided again.`,
      code: 'ALREADY_DECIDED',
    };
  }
  if (row.expires_at && row.expires_at <= now) {
    db.prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE approval_id = ? AND status = ?')
      .run('EXPIRED', now, params.approvalId, 'PENDING');
    return { ok: false, reason: `Approval "${params.approvalId}" expired at ${row.expires_at}.`, code: 'EXPIRED' };
  }

  // Guarded on status so two concurrent decisions cannot both apply.
  const res: any = db.prepare(
    `UPDATE approvals
        SET status = ?, decided_by_user_id = ?, decision_reason = ?, decided_at = ?
      WHERE approval_id = ? AND status = 'PENDING'`,
  ).run(params.decision, params.decidedByUserId, params.reason ?? null, now, params.approvalId);

  if (!res || res.changes === 0) {
    return { ok: false, reason: `Approval "${params.approvalId}" was decided concurrently.`, code: 'ALREADY_DECIDED' };
  }

  const updated = rowToRecord(db.prepare('SELECT * FROM approvals WHERE approval_id = ?').get(params.approvalId));
  recordApprovalEvent(
    updated,
    params.decision === 'APPROVED' ? 'SUCCESS' : 'BLOCKED',
    `Human decision: ${params.decision} by ${params.decidedByUserId}.`,
  );
  return { ok: true, approval: updated };
}

// ---------------------------------------------------------------------------
// THE GATE — what the envelope asks before dispatching an external action
// ---------------------------------------------------------------------------

export type ApprovalGateState = 'WAITING_FOR_APPROVAL' | 'REJECTED' | 'EXPIRED' | 'STALE_INPUTS';

export type ApprovalGateVerdict =
  | { allowed: true; approval: ApprovalRecord; state?: undefined; reason?: undefined }
  | {
      allowed: false;
      /** WAITING means "ask a human"; REJECTED/EXPIRED/STALE mean "this attempt is over". */
      state: ApprovalGateState;
      reason: string;
      /** The pending/decided record, when one exists. */
      approval?: ApprovalRecord;
    };

/**
 * Find the approval that authorizes exactly this action, or say why none does.
 *
 * MATCHING IS BY BINDING, NOT BY ID. The caller does not get to nominate which
 * approval covers it — it states what it is about to do, and this function
 * looks for an approval bound to that. An action cannot present a valid
 * approval that was granted for something else, because the digest is part of
 * the lookup rather than something checked afterwards.
 *
 * STALE_INPUTS is reported distinctly from WAITING_FOR_APPROVAL when an
 * approval exists for this capability and correlation but a DIFFERENT digest.
 * That is the Alice-to-Bob case, and the operator needs to be told the inputs
 * changed rather than left wondering why their approval did nothing.
 */
export function checkApprovalGate(params: {
  workspaceId: string;
  capability: string;
  action: string;
  inputDigest: string;
  correlationId: string;
  nowIso?: string;
}): ApprovalGateVerdict {
  const db = getDatabase();
  const now = params.nowIso || new Date().toISOString();

  const bound: any = db.prepare(
    `SELECT * FROM approvals
      WHERE workspace_id = ? AND capability = ? AND action = ? AND input_digest = ? AND correlation_id = ?
      ORDER BY created_at DESC`,
  ).all(params.workspaceId, params.capability, params.action, params.inputDigest, params.correlationId);

  const rows: ApprovalRecord[] = (bound || []).map(rowToRecord);

  const approved = rows.find((r) => r.status === 'APPROVED' && (!r.expires_at || r.expires_at > now));
  if (approved) return { allowed: true, approval: approved };

  const expired = rows.find((r) => r.status === 'APPROVED' && r.expires_at && r.expires_at <= now);
  if (expired) {
    db.prepare('UPDATE approvals SET status = ? WHERE approval_id = ? AND status = ?')
      .run('EXPIRED', expired.approval_id, 'APPROVED');
    return { allowed: false, state: 'EXPIRED', reason: `The approval for this action expired at ${expired.expires_at}.`, approval: expired };
  }

  // A row ALREADY in EXPIRED status — set either by the sweep or by
  // decideApproval refusing a lapsed decision.
  //
  // This branch was missing, and its absence was not harmless: with no match
  // here the lookup fell through to the bottom and reported
  // WAITING_FOR_APPROVAL, so an expired approval was described as though no
  // decision had ever been sought. The operator would be told the action was
  // waiting on them when in fact their permission had lapsed — two different
  // situations needing two different actions.
  const alreadyExpired = rows.find((r) => r.status === 'EXPIRED');
  if (alreadyExpired) {
    return {
      allowed: false,
      state: 'EXPIRED',
      reason: `The approval for this action expired at ${alreadyExpired.expires_at ?? 'an unrecorded time'} without being used.`,
      approval: alreadyExpired,
    };
  }

  const consumed = rows.find((r) => r.status === 'CONSUMED');
  if (consumed) {
    return {
      allowed: false,
      state: 'EXPIRED',
      reason: `The approval for this action was already used at ${consumed.consumed_at} (approvals are single-use).`,
      approval: consumed,
    };
  }

  const rejected = rows.find((r) => r.status === 'REJECTED');
  if (rejected) {
    return {
      allowed: false,
      state: 'REJECTED',
      reason: `A human rejected this action at ${rejected.decided_at}${rejected.decision_reason ? `: ${rejected.decision_reason}` : '.'}`,
      approval: rejected,
    };
  }

  const pending = rows.find((r) => r.status === 'PENDING');
  if (pending) {
    return {
      allowed: false,
      state: 'WAITING_FOR_APPROVAL',
      reason: `Waiting for a human decision on approval "${pending.approval_id}".`,
      approval: pending,
    };
  }

  // Nothing bound to THIS digest. Is there an approval for the same work with
  // different inputs? That is the changed-message case.
  const sameWork: any = db.prepare(
    `SELECT * FROM approvals
      WHERE workspace_id = ? AND capability = ? AND correlation_id = ? AND input_digest != ?
        AND status IN ('APPROVED','PENDING')
      ORDER BY created_at DESC LIMIT 1`,
  ).get(params.workspaceId, params.capability, params.correlationId, params.inputDigest);

  if (sameWork) {
    return {
      allowed: false,
      state: 'STALE_INPUTS',
      reason:
        `An approval exists for this work but was granted for different inputs (digest ` +
        `${String(sameWork.input_digest).slice(0, 12)}… vs ${params.inputDigest.slice(0, 12)}…). ` +
        `The action changed after it was approved, so the approval does not authorize it. A new approval is required.`,
      approval: rowToRecord(sameWork),
    };
  }

  return {
    allowed: false,
    state: 'WAITING_FOR_APPROVAL',
    reason: 'No human approval exists for this action.',
  };
}

/**
 * Spend an approval — C5, single use.
 *
 * The UPDATE is guarded on `status = 'APPROVED'`, so the database decides the
 * winner of a race rather than application logic. Two concurrent dispatches
 * holding the same approval: exactly one sees changes === 1 and proceeds, the
 * other sees 0 and is refused. This is the same INSERT-first/constraint-decides
 * pattern acquireExecutionClaim already uses for idempotency, and it is here
 * for the same reason — a read-then-write check has a gap, and for an outbound
 * email the gap is a duplicate send.
 */
export function consumeApproval(approvalId: string, taskId: string | null, nowIso?: string): boolean {
  const db = getDatabase();
  const now = nowIso || new Date().toISOString();
  const res: any = db.prepare(
    `UPDATE approvals SET status = 'CONSUMED', consumed_at = ?, consumed_by_task_id = ?
      WHERE approval_id = ? AND status = 'APPROVED'`,
  ).run(now, taskId, approvalId);
  const won = !!res && res.changes === 1;
  if (won) {
    const updated = rowToRecord(db.prepare('SELECT * FROM approvals WHERE approval_id = ?').get(approvalId));
    recordApprovalEvent(updated, 'SUCCESS', 'Approval consumed for dispatch; it cannot authorize another.');
  }
  return won;
}

/**
 * Record WHICH task spent an approval.
 *
 * Separate from consumeApproval because of an ordering reality: the approval
 * must be consumed BEFORE the executor runs (so a crash cannot leave it
 * spendable), but the task id is generated INSIDE the executor. So consumption
 * happens first with no task id, and this closes the link once the task exists.
 *
 * The live Part G run is what surfaced this: the approval showed CONSUMED with
 * consumed_by_task_id null, which left the audit trail able to say an approval
 * was spent but not what it authorized. correlation_id already joined the two
 * indirectly; this makes the link direct.
 *
 * Only ever fills a NULL — it cannot repoint an approval at a different task.
 */
export function linkConsumedApprovalToTask(approvalId: string, taskId: string): void {
  try {
    getDatabase()
      .prepare('UPDATE approvals SET consumed_by_task_id = ? WHERE approval_id = ? AND consumed_by_task_id IS NULL')
      .run(taskId, approvalId);
  } catch {
    /* a missing back-link is a visible gap, never a reason to fail the action */
  }
}

// ---------------------------------------------------------------------------
// QUERIES — the Admin queue and the evidence trail
// ---------------------------------------------------------------------------

export function getApproval(approvalId: string): ApprovalRecord | null {
  const row: any = getDatabase().prepare('SELECT * FROM approvals WHERE approval_id = ?').get(approvalId);
  return row ? rowToRecord(row) : null;
}

/** Workspace-scoped, always. There is no unscoped list function to misuse. */
export function listWorkspaceApprovals(
  workspaceId: string,
  opts: { status?: ApprovalStatus; limit?: number } = {},
): ApprovalRecord[] {
  const db = getDatabase();
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
  const rows: any = opts.status
    ? db.prepare('SELECT * FROM approvals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?')
        .all(workspaceId, opts.status, limit)
    : db.prepare('SELECT * FROM approvals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(workspaceId, limit);
  return (rows || []).map(rowToRecord);
}

export function listApprovalsForCorrelation(workspaceId: string, correlationId: string): ApprovalRecord[] {
  const rows: any = getDatabase()
    .prepare('SELECT * FROM approvals WHERE workspace_id = ? AND correlation_id = ? ORDER BY created_at ASC')
    .all(workspaceId, correlationId);
  return (rows || []).map(rowToRecord);
}

/**
 * Mark overdue PENDING/APPROVED rows EXPIRED.
 *
 * Deliberately a sweep rather than the only defence: checkApprovalGate also
 * checks expiry at read time, so an approval is never usable past its deadline
 * even if this never runs. The sweep exists so the QUEUE does not show stale
 * rows as actionable, not to enforce the rule.
 */
export function expireStaleApprovals(nowIso?: string): number {
  const db = getDatabase();
  const now = nowIso || new Date().toISOString();
  const res: any = db.prepare(
    `UPDATE approvals SET status = 'EXPIRED'
      WHERE status IN ('PENDING','APPROVED') AND expires_at IS NOT NULL AND expires_at <= ?`,
  ).run(now);
  return res?.changes ?? 0;
}
