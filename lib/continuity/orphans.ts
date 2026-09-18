// ---------------------------------------------------------------------------
// ORPHANED RUNNING TASKS — reconciled from append-only evidence, never retried.
//
// A task can be left RUNNING when the process that owned it stopped
// mid-execution (a restart, a crash). No process owns it any more, so it will
// never finish, and nothing may re-run it blindly: its model call may already
// have been processed and billed.
//
// Verdict, from evidence only (nothing is deleted or rewritten; the decision
// is appended as an activity event plus a status-history row):
//
//   receipt on record                       → outcome KNOWN (DONE)
//   no EXECUTION_STARTED                    → never dispatched → READY
//   a ledger row is RESERVED, never sent    → never dispatched → READY
//                                             (the stale reservation is released)
//   a ledger row is ambiguous               → RECONCILING_UNKNOWN_EXECUTION
//   started, no ledger row, while the spend
//     guard was reserving before dispatch   → never dispatched → READY
//   started, no ledger row, BEFORE the spend
//     ledger existed                        → RECONCILING_UNKNOWN_EXECUTION
//                                             (absence of a row proves nothing)
//
// Ownership: a RUNNING task whose last update is AFTER this process started
// may still be executing here — it is refused.
// ---------------------------------------------------------------------------

import { getDatabase, updateTaskStatus, recordActivityEvent } from '../persistence';
import { recordRegistryEvent } from '../registry/store';

/**
 * From this instant every provider call reserved a spend-ledger row BEFORE
 * dispatch (commit 22e955f, "production spend guard — hard ceilings on every
 * paid provider call", 2026-09-18T00:17:58-04:00). Before it, a call left no
 * row, so a missing row proves nothing.
 */
export const SPEND_LEDGER_GUARD_SINCE = '2026-09-18T04:17:58.000Z';

const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

export type OrphanVerdict = 'OUTCOME_KNOWN_DONE' | 'NEVER_DISPATCHED' | 'AMBIGUOUS_DISPATCH';

export interface OrphanEvidence {
  taskId: string;
  workspaceId: string;
  statusHistory: Array<{ status: string; at: string }>;
  activity: string[];
  executionStartedAt: string | null;
  ledgerRows: Array<{ usageId: string; status: string; dispatchedAt: string | null; providerRequestId: string | null }>;
  ledgerGuardActiveAtStart: boolean;
  claims: number;
  artifacts: number;
  reviews: number;
  receipts: number;
  continuityState: string | null;
  lastUpdate: string;
  processStartedAt: string;
}

export function orphanEvidence(taskId: string, processStartedAt = PROCESS_STARTED_AT): OrphanEvidence | null {
  const db = getDatabase();
  const t = db.prepare('SELECT task_id, workspace_id, status, updated_at FROM tasks WHERE task_id = ?').get(taskId) as any;
  if (!t) return null;
  const count = (sql: string) => { try { return (db.prepare(sql).get(taskId) as any)?.n ?? 0; } catch { return 0; } };
  const history = (db.prepare('SELECT status, created_at FROM task_status_history WHERE task_id = ? ORDER BY id').all(taskId) as any[]).map((r) => ({ status: r.status, at: r.created_at }));
  const events = db.prepare('SELECT event_type, created_at FROM activity_events WHERE task_id = ? ORDER BY rowid').all(taskId) as any[];
  const started = events.filter((e) => e.event_type === 'EXECUTION_STARTED').pop()?.created_at ?? null;
  let ledger: OrphanEvidence['ledgerRows'] = [];
  try {
    ledger = (db.prepare('SELECT usage_id, status, dispatched_at, provider_request_id FROM provider_usage WHERE task_id = ? ORDER BY created_at').all(taskId) as any[])
      .map((r) => ({ usageId: r.usage_id, status: r.status, dispatchedAt: r.dispatched_at, providerRequestId: r.provider_request_id }));
  } catch { /* no ledger table */ }
  let continuityState: string | null = null;
  try { continuityState = (db.prepare('SELECT state FROM task_continuity WHERE task_id = ?').get(taskId) as any)?.state ?? null; } catch { /* no continuity table */ }
  return {
    taskId, workspaceId: t.workspace_id, statusHistory: history, activity: events.map((e) => e.event_type),
    executionStartedAt: started, ledgerRows: ledger,
    ledgerGuardActiveAtStart: !!started && Date.parse(started) >= Date.parse(SPEND_LEDGER_GUARD_SINCE),
    claims: count('SELECT COUNT(*) AS n FROM execution_claims WHERE task_id = ?'),
    artifacts: count('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?'),
    reviews: count('SELECT COUNT(*) AS n FROM quality_reviews WHERE task_id = ?'),
    receipts: count('SELECT COUNT(*) AS n FROM receipts WHERE task_id = ?'),
    continuityState, lastUpdate: t.updated_at, processStartedAt,
  };
}

export function decideOrphan(e: OrphanEvidence): { verdict: OrphanVerdict; status: 'DONE' | 'READY' | 'RECONCILING_UNKNOWN_EXECUTION'; reason: string; releaseReservations: string[] } {
  if (e.receipts > 0) return { verdict: 'OUTCOME_KNOWN_DONE', status: 'DONE', reason: `a signed receipt is on record (${e.receipts}); the outcome is known`, releaseReservations: [] };
  const ambiguous = e.ledgerRows.filter((r) => ['DISPATCHED', 'TIMEOUT_AFTER_DISPATCH', 'UNKNOWN', 'SUCCESS', 'KNOWN_FAILURE'].includes(r.status) || (r.status === 'RESERVED' && r.dispatchedAt));
  if (ambiguous.length) return { verdict: 'AMBIGUOUS_DISPATCH', status: 'RECONCILING_UNKNOWN_EXECUTION', reason: `ledger row(s) ${ambiguous.map((r) => `${r.usageId}=${r.status}`).join(', ')} show a request may have been sent, and no receipt records the outcome`, releaseReservations: [] };
  const staleReservations = e.ledgerRows.filter((r) => r.status === 'RESERVED' && !r.dispatchedAt).map((r) => r.usageId);
  if (!e.executionStartedAt) return { verdict: 'NEVER_DISPATCHED', status: 'READY', reason: 'no EXECUTION_STARTED event: execution never began', releaseReservations: staleReservations };
  if (staleReservations.length) return { verdict: 'NEVER_DISPATCHED', status: 'READY', reason: `the only ledger rows were reserved and never sent (${staleReservations.join(', ')})`, releaseReservations: staleReservations };
  if (e.ledgerGuardActiveAtStart) return { verdict: 'NEVER_DISPATCHED', status: 'READY', reason: `execution started ${e.executionStartedAt}, after the spend guard began reserving a ledger row before every dispatch (${SPEND_LEDGER_GUARD_SINCE}); no row exists, so no request was sent`, releaseReservations: [] };
  return {
    verdict: 'AMBIGUOUS_DISPATCH', status: 'RECONCILING_UNKNOWN_EXECUTION',
    reason: `execution started ${e.executionStartedAt}, before the spend ledger existed (${SPEND_LEDGER_GUARD_SINCE}); the owning process then stopped. A missing ledger row proves nothing here, so whether the provider received the request cannot be determined`,
    releaseReservations: [],
  };
}

/**
 * Reconcile one orphaned RUNNING task. Appends evidence and a status; never
 * retries, never deletes, never edits history. Refuses if this process may
 * still own it, or if the continuity controller owns it.
 */
export function reconcileOrphanedRunningTask(taskId: string, actor: string, processStartedAt = PROCESS_STARTED_AT): { ok: true; verdict: OrphanVerdict; status: string; reason: string; evidence: OrphanEvidence } | { ok: false; error: string } {
  const e = orphanEvidence(taskId, processStartedAt);
  if (!e) return { ok: false, error: `task ${taskId} does not exist` };
  const current = e.statusHistory[e.statusHistory.length - 1]?.status;
  if (current !== 'RUNNING') return { ok: false, error: `task ${taskId} is ${current}, not RUNNING` };
  if (Date.parse(e.lastUpdate) >= Date.parse(processStartedAt)) return { ok: false, error: `task ${taskId} was updated at ${e.lastUpdate}, after this process started (${processStartedAt}); it may still be executing here` };
  if (e.continuityState) return { ok: false, error: `task ${taskId} has a continuity record (${e.continuityState}); the continuity controller reconciles it` };
  const d = decideOrphan(e);
  const db = getDatabase();
  for (const usageId of d.releaseReservations) {
    db.prepare("UPDATE provider_usage SET status = 'PRE_DISPATCH_FAILURE', actual_cost_usd = 0, actual_cost_state = 'KNOWN', reason = ? WHERE usage_id = ? AND status = 'RESERVED' AND dispatched_at IS NULL")
      .run(`stale reservation released by ${actor}: owning process gone, never dispatched`, usageId);
  }
  recordActivityEvent({
    taskId, expectedWorkspaceId: e.workspaceId, eventType: d.status === 'RECONCILING_UNKNOWN_EXECUTION' ? 'RECONCILIATION_REQUIRED' : 'ORPHAN_RECONCILED', agentId: actor,
    payload: { verdict: d.verdict, fromStatus: current, toStatus: d.status, reason: d.reason, releasedReservations: d.releaseReservations, evidence: { ...e, statusHistory: e.statusHistory.length } },
  });
  updateTaskStatus(taskId, d.status, undefined, e.workspaceId);
  recordRegistryEvent('ORPHAN_TASK_RECONCILED', { actor, taskId, verdict: d.verdict, status: d.status });
  return { ok: true, verdict: d.verdict, status: d.status, reason: d.reason, evidence: e };
}
