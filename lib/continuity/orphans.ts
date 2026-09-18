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
import crypto from 'node:crypto';
import { recordRegistryEvent } from '../registry/store';
import { recordAdminAuditEvent } from '../audit';
import { resolveUnknownSegment } from './controller';

/**
 * From this instant every provider call reserved a spend-ledger row BEFORE
 * dispatch (commit 22e955f, "production spend guard — hard ceilings on every
 * paid provider call", 2026-09-18T00:17:58-04:00). Before it, a call left no
 * row, so a missing row proves nothing.
 */
export const SPEND_LEDGER_GUARD_SINCE = '2026-09-18T04:17:58.000Z';

export const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

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

// ---------------------------------------------------------------------------
// SHUTDOWN SETTLEMENT — the drain's last step (lib/fabric/scheduler.ts).
//
// After the bounded wait, anything THIS process started and did not finish is
// marked durably before exit, from its own evidence:
//   ledger RESERVED, never sent      → PRE_DISPATCH_FAILURE at $0 (released)
//   ledger DISPATCHED (sent, no answer) → UNKNOWN — may have been processed;
//                                       never retried
//   task with a receipt              → DONE (outcome known)
//   task never dispatched            → resumable (continuity pause, or READY)
//   task with an ambiguous dispatch  → RECONCILING_UNKNOWN_EXECUTION
// Nothing is deleted or rewritten: statuses are appended, events recorded,
// checkpoints, provider events and idempotency keys untouched.
// ---------------------------------------------------------------------------

export type ShutdownOutcome = 'NEVER_DISPATCHED' | 'COMPLETED' | 'KNOWN_PROVIDER_FAILURE' | 'AMBIGUOUS';

export interface ShutdownSettlement {
  releasedReservations: string[];
  markedUnknown: string[];
  tasks: Array<{ taskId: string; outcome: ShutdownOutcome; from: string; to: string; reason: string }>;
}

const OPEN_TASK_STATES = ['RUNNING', 'AWAITING_VERIFICATION', 'AWAITING_RECEIPT'];

export function settleInterruptedAtShutdown(p: { processStartedAt?: string; actor: string }): ShutdownSettlement {
  const since = p.processStartedAt ?? PROCESS_STARTED_AT;
  const db = getDatabase();
  const now = new Date().toISOString();
  const out: ShutdownSettlement = { releasedReservations: [], markedUnknown: [], tasks: [] };
  try {
    for (const r of db.prepare("SELECT usage_id FROM provider_usage WHERE status = 'RESERVED' AND dispatched_at IS NULL AND created_at >= ?").all(since) as any[]) {
      db.prepare("UPDATE provider_usage SET status = 'PRE_DISPATCH_FAILURE', reason_code = 'SERVICE_SHUTDOWN', reason = 'Reserved but never sent before the service shut down.', estimated_cost_usd = 0, actual_cost_usd = 0, actual_cost_state = 'KNOWN', completed_at = ? WHERE usage_id = ? AND status = 'RESERVED'").run(now, r.usage_id);
      out.releasedReservations.push(r.usage_id);
    }
    for (const r of db.prepare("SELECT usage_id FROM provider_usage WHERE status = 'DISPATCHED' AND created_at >= ?").all(since) as any[]) {
      db.prepare("UPDATE provider_usage SET status = 'UNKNOWN', reason_code = 'SERVICE_SHUTDOWN', reason = 'Sent, and the service shut down before its outcome was recorded. It may have been processed; it will not be retried automatically.', completed_at = ? WHERE usage_id = ? AND status = 'DISPATCHED'").run(now, r.usage_id);
      out.markedUnknown.push(r.usage_id);
    }
  } catch { /* no ledger table: nothing to settle */ }

  const tasks = db.prepare(`SELECT task_id, workspace_id, status FROM tasks WHERE status IN (${OPEN_TASK_STATES.map(() => '?').join(', ')}) AND updated_at >= ?`).all(...OPEN_TASK_STATES, since) as any[];
  for (const t of tasks) {
    const e = orphanEvidence(t.task_id, since)!;
    const rows = e.ledgerRows;
    const ambiguous = rows.some((r) => ['UNKNOWN', 'TIMEOUT_AFTER_DISPATCH', 'DISPATCHED', 'SUCCESS'].includes(r.status));
    const knownFailure = !ambiguous && rows.some((r) => ['PROVIDER_REJECTION', 'KNOWN_FAILURE'].includes(r.status));
    let outcome: ShutdownOutcome; let to: string; let reason: string;
    if (e.receipts > 0) { outcome = 'COMPLETED'; to = 'DONE'; reason = 'a signed receipt was recorded before the shutdown finished'; }
    else if (ambiguous) { outcome = 'AMBIGUOUS'; to = 'RECONCILING_UNKNOWN_EXECUTION'; reason = `interrupted by service shutdown after a provider request was sent (${rows.map((r) => `${r.usageId}=${r.status}`).join(', ')}); it may have been processed and is never retried automatically`; }
    else { outcome = knownFailure ? 'KNOWN_PROVIDER_FAILURE' : 'NEVER_DISPATCHED'; to = 'PAUSED_AWAITING_CAPACITY'; reason = knownFailure ? 'interrupted by service shutdown after a known provider refusal; nothing was processed; resumes after the restart' : 'interrupted by service shutdown before any provider request was sent; resumes after the restart'; }
    let continuityState: string | null = null;
    try { continuityState = (db.prepare('SELECT state FROM task_continuity WHERE task_id = ?').get(t.task_id) as any)?.state ?? null; } catch { /* none */ }
    recordActivityEvent({ taskId: t.task_id, expectedWorkspaceId: t.workspace_id, eventType: 'SHUTDOWN_INTERRUPTED', agentId: p.actor, payload: { outcome, fromStatus: t.status, toStatus: to, reason, ledgerRows: rows } });
    if (continuityState !== null) {
      // The continuity controller owns the transition (it appends status + event).
      try {
        for (const seg of db.prepare("SELECT segment_id FROM task_segments WHERE task_id = ? AND status = 'RUNNING'").all(t.task_id) as any[]) {
          db.prepare('UPDATE task_segments SET status = ?, status_reason = ?, completed_at = ? WHERE segment_id = ?').run(outcome === 'AMBIGUOUS' ? 'UNKNOWN' : 'BLOCKED', `service shutdown: ${reason}`.slice(0, 500), now, seg.segment_id);
        }
      } catch { /* no segments */ }
      db.prepare('UPDATE task_continuity SET state = ?, state_reason = ? WHERE task_id = ?').run(to === 'DONE' ? 'DONE' : to, reason.slice(0, 1000), t.task_id);
    }
    updateTaskStatus(t.task_id, to, undefined, t.workspace_id);
    out.tasks.push({ taskId: t.task_id, outcome, from: t.status, to, reason });
  }
  recordRegistryEvent('SHUTDOWN_SETTLED', { actor: p.actor, releasedReservations: out.releasedReservations.length, markedUnknown: out.markedUnknown.length, tasks: out.tasks.map((x) => `${x.taskId}:${x.outcome}`) });
  return out;
}

// ---------------------------------------------------------------------------
// OPERATOR RECONCILIATION OF AN AMBIGUOUS EXECUTION — the one audited action
// that ends (or records evidence about) RECONCILING_UNKNOWN_EXECUTION.
//
// The operator checks the provider's own records (dashboard logs / usage) and
// submits a FINDING with its evidence. This action only RECORDS what the
// operator found; it never calls a provider, never retries, never edits an
// earlier status or event, and never fabricates output, tokens, response ids,
// artifacts, reviews, receipts or ledger rows. Operator-reported usage stays
// inside the reconciliation event, labelled as operator-reported.
//
//   PROVIDER_CONFIRMED_COMPLETED               → INCOMPLETE (the output never reached SynthOS)
//   PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE  → INCOMPLETE
//   PROVIDER_CONFIRMED_FAILED                  → FAILED
//   PROVIDER_CONFIRMED_NO_REQUEST              → CANCELLED (never dispatched; not re-run by this action)
//   EVIDENCE_INCONCLUSIVE                      → stays RECONCILING_UNKNOWN_EXECUTION
//
// None of these can make a task DONE/VERIFIED: a success needs a real
// artifact, Aegis verification and a receipt, which only execution produces.
//
// Idempotent: the same evidence submission (by content hash) changes nothing.
// A later, different finding on a task already reconciled is a CORRECTION: it
// must name the event it corrects, and it is appended — never an edit.
// Tasks under the continuity controller with an UNKNOWN segment are delegated
// to its segment resolver so there is one reconciliation system.
// ---------------------------------------------------------------------------

export const RECONCILIATION_FINDINGS = [
  'PROVIDER_CONFIRMED_COMPLETED',
  'PROVIDER_CONFIRMED_FAILED',
  'PROVIDER_CONFIRMED_NO_REQUEST',
  'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE',
  'EVIDENCE_INCONCLUSIVE',
] as const;
export type ReconciliationFinding = (typeof RECONCILIATION_FINDINGS)[number];

const FINDING_STATUS: Record<ReconciliationFinding, string> = {
  PROVIDER_CONFIRMED_COMPLETED: 'INCOMPLETE',
  PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE: 'INCOMPLETE',
  PROVIDER_CONFIRMED_FAILED: 'FAILED',
  PROVIDER_CONFIRMED_NO_REQUEST: 'CANCELLED',
  EVIDENCE_INCONCLUSIVE: 'RECONCILING_UNKNOWN_EXECUTION',
};
const RECONCILED_STATUSES = new Set(['INCOMPLETE', 'FAILED', 'CANCELLED']);
const RECONCILIATION_EVENTS = ['EXECUTION_RECONCILED', 'EXECUTION_RECONCILIATION_EVIDENCE', 'EXECUTION_RECONCILIATION_CORRECTED'];

export interface ReconciliationSubmission {
  workspaceId: string;
  taskId: string;
  actor: string;
  finding: string;
  evidenceSource: string;
  windowStart: string;
  windowEnd: string;
  provider: string;
  model: string;
  dashboardFinding: string;
  note: string;
  providerResponseId?: string | null;
  usage?: { inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null } | null;
  /** Required when the task has already been reconciled: the event this submission corrects. */
  correctsEventId?: string | null;
}

export interface ReconciliationTrailEntry {
  eventId: string;
  eventType: string;
  actor: string;
  at: string;
  finding: string;
  resultingStatus: string;
  submissionHash: string;
  evidence: Record<string, unknown>;
  correctsEventId: string | null;
}

const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const text = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

export function reconciliationTrail(taskId: string): ReconciliationTrailEntry[] {
  const rows = getDatabase().prepare(`SELECT event_id, event_type, agent_id, payload_json, created_at FROM activity_events WHERE task_id = ? AND event_type IN (${RECONCILIATION_EVENTS.map(() => '?').join(',')}) ORDER BY rowid`).all(taskId, ...RECONCILIATION_EVENTS) as any[];
  return rows.map((r) => {
    let p: any = {};
    try { p = JSON.parse(r.payload_json || '{}'); } catch { /* unreadable payload stays empty */ }
    return { eventId: r.event_id, eventType: r.event_type, actor: r.agent_id, at: r.created_at, finding: p.finding, resultingStatus: p.resultingStatus, submissionHash: p.submissionHash, evidence: p.evidence ?? {}, correctsEventId: p.correctsEventId ?? null };
  });
}

/** Where the dispatch would have gone, for the providers whose adapters SynthOS has used. */
const DISPATCH_ENDPOINT: Record<string, string> = { openai: 'POST /v1/responses' };

/**
 * What an operator must look for in the provider's own records. Derived from
 * the task's append-only evidence — nothing is fetched from any provider.
 */
export function reconciliationGuide(taskId: string): {
  taskId: string; status: string; executionStartedAt: string | null; suggestedWindow: { start: string; end: string } | null;
  model: string | null; provider: string | null; endpoint: string | null; instruction: string | null;
  knownIdentifiers: { providerRequestIds: string[]; responseIds: string[] }; exclude: Array<{ taskId: string; startedAt: string; model: string | null }>;
  evidence: OrphanEvidence | null;
} | null {
  const db = getDatabase();
  const t = db.prepare('SELECT task_id, status, assigned_model, description FROM tasks WHERE task_id = ?').get(taskId) as any;
  if (!t) return null;
  const e = orphanEvidence(taskId);
  const started = e?.executionStartedAt ?? null;
  const model = t.assigned_model && t.assigned_model !== 'n/a' ? String(t.assigned_model) : null;
  let provider: string | null = null;
  if (model) {
    try {
      const routes = db.prepare('SELECT DISTINCT provider_id FROM registry_models WHERE model_id = ?').all(model) as any[];
      if (routes.length === 1) provider = routes[0].provider_id;
    } catch { /* registry not provisioned */ }
    if (!provider) {
      const ev = db.prepare("SELECT payload_json FROM activity_events WHERE task_id = ? AND event_type IN ('PROVIDER_COMPLETED','PROVIDER_FAILED') ORDER BY rowid DESC LIMIT 1").get(taskId) as any;
      try { provider = ev ? JSON.parse(ev.payload_json)?.provider ?? null : null; } catch { /* stays null */ }
    }
    if (!provider) {
      // Other tasks on the same model that did record their provider.
      const ev = db.prepare("SELECT a.payload_json FROM activity_events a JOIN tasks t ON t.task_id = a.task_id WHERE t.assigned_model = ? AND a.event_type = 'PROVIDER_COMPLETED' ORDER BY a.rowid DESC LIMIT 1").get(model) as any;
      try { provider = ev ? JSON.parse(ev.payload_json)?.provider ?? null : null; } catch { /* stays null */ }
    }
  }
  let window: { start: string; end: string } | null = null;
  let exclude: Array<{ taskId: string; startedAt: string; model: string | null }> = [];
  if (started) {
    const s = Date.parse(started);
    // Through the end of the minute after the dispatch could have completed (~60 s adapter timeout).
    const end = Math.ceil((s + 60_000) / 60_000) * 60_000;
    window = { start: started, end: new Date(end).toISOString() };
    exclude = (db.prepare("SELECT a.task_id, a.created_at, t.assigned_model FROM activity_events a JOIN tasks t ON t.task_id = a.task_id WHERE a.event_type = 'EXECUTION_STARTED' AND a.task_id != ? AND a.created_at > ? AND a.created_at <= ? ORDER BY a.created_at").all(taskId, started, new Date(s + 15 * 60_000).toISOString()) as any[])
      .filter((r) => !model || r.assigned_model === model)
      .map((r) => ({ taskId: r.task_id, startedAt: r.created_at, model: r.assigned_model ?? null }));
  }
  const ids = e?.ledgerRows.map((r) => r.providerRequestId).filter((x): x is string => !!x) ?? [];
  return {
    taskId, status: t.status, executionStartedAt: started, suggestedWindow: window, model, provider,
    endpoint: provider ? DISPATCH_ENDPOINT[provider] ?? null : null,
    instruction: t.description ? String(t.description).slice(0, 1000) : null,
    knownIdentifiers: { providerRequestIds: ids, responseIds: [] }, exclude, evidence: e,
  };
}

export function reconcileAmbiguousExecution(s: ReconciliationSubmission): { ok: true; changed: boolean; status: string; eventId: string; finding: ReconciliationFinding } | { ok: false; error: string } {
  const db = getDatabase();
  const t = db.prepare('SELECT task_id, workspace_id, status, assigned_model FROM tasks WHERE task_id = ?').get(s.taskId) as any;
  if (!t || t.workspace_id !== s.workspaceId) return { ok: false, error: `task ${s.taskId} is not in workspace ${s.workspaceId}` };
  if (!(RECONCILIATION_FINDINGS as readonly string[]).includes(s.finding)) return { ok: false, error: `finding must be one of ${RECONCILIATION_FINDINGS.join(', ')}` };
  const finding = s.finding as ReconciliationFinding;

  // ---- evidence validation (nothing is inferred or filled in) ----
  if (!text(s.evidenceSource, 3, 200)) return { ok: false, error: 'evidence source is required (e.g. "OpenAI dashboard → Logs → Responses")' };
  if (!UTC_RE.test(String(s.windowStart ?? '')) || !UTC_RE.test(String(s.windowEnd ?? ''))) return { ok: false, error: 'the UTC window start and end are required as ISO-8601 UTC times ending in Z' };
  if (Date.parse(s.windowEnd) <= Date.parse(s.windowStart)) return { ok: false, error: 'the window end must be after its start' };
  if (!text(s.provider, 2, 80) || !text(s.model, 2, 120)) return { ok: false, error: 'provider and model are required' };
  if (!text(s.dashboardFinding, 10, 2000)) return { ok: false, error: 'the dashboard finding is required: what the provider records show, in words' };
  if (!text(s.note, 10, 2000)) return { ok: false, error: 'an explanatory note is required' };
  const assigned = t.assigned_model && t.assigned_model !== 'n/a' ? String(t.assigned_model) : null;
  if (assigned && s.model.trim() !== assigned) return { ok: false, error: `the evidence is about model "${s.model.trim()}", but this task dispatched to "${assigned}"` };
  const started = orphanEvidence(s.taskId)?.executionStartedAt ?? null;
  if (started && (Date.parse(s.windowStart) > Date.parse(started) || Date.parse(s.windowEnd) < Date.parse(started))) {
    return { ok: false, error: `the window must include the dispatch time ${started}` };
  }
  const responseId = s.providerResponseId == null || s.providerResponseId === '' ? null : String(s.providerResponseId).trim();
  if (responseId !== null) {
    if (!/^[A-Za-z0-9_.:-]{4,200}$/.test(responseId)) return { ok: false, error: 'the provider response id has an unexpected format' };
    if (finding !== 'PROVIDER_CONFIRMED_COMPLETED' && finding !== 'PROVIDER_CONFIRMED_FAILED') return { ok: false, error: `a provider response id cannot accompany ${finding}` };
  }
  let usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null } | null = null;
  if (s.usage && Object.values(s.usage).some((v) => v !== null && v !== undefined && v !== ('' as any))) {
    if (finding === 'PROVIDER_CONFIRMED_NO_REQUEST' || finding === 'EVIDENCE_INCONCLUSIVE') return { ok: false, error: `usage figures cannot accompany ${finding}` };
    const n = (v: unknown, int: boolean) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && (!int || Number.isInteger(v)) ? v : NaN);
    usage = { inputTokens: n(s.usage.inputTokens, true), outputTokens: n(s.usage.outputTokens, true), costUsd: n(s.usage.costUsd, false) };
    if (Object.values(usage).some((v) => Number.isNaN(v))) return { ok: false, error: 'usage figures must be non-negative numbers (tokens as integers), and only those actually shown by the provider' };
  }

  const evidence = {
    evidenceSource: s.evidenceSource.trim(), windowStart: s.windowStart, windowEnd: s.windowEnd,
    provider: s.provider.trim(), model: s.model.trim(), dashboardFinding: s.dashboardFinding.trim(), note: s.note.trim(),
    providerResponseId: responseId, operatorReportedUsage: usage,
  };
  const submissionHash = crypto.createHash('sha256').update(JSON.stringify({ finding, ...evidence })).digest('hex');
  const trail = reconciliationTrail(s.taskId);
  const same = trail.find((x) => x.submissionHash === submissionHash);
  if (same) return { ok: true, changed: false, status: t.status, eventId: same.eventId, finding };

  const decisive = [...trail].reverse().find((x) => x.finding !== 'EVIDENCE_INCONCLUSIVE');
  let eventType = finding === 'EVIDENCE_INCONCLUSIVE' ? 'EXECUTION_RECONCILIATION_EVIDENCE' : 'EXECUTION_RECONCILED';
  let correctsEventId: string | null = null;
  if (t.status !== 'RECONCILING_UNKNOWN_EXECUTION') {
    if (!decisive || !RECONCILED_STATUSES.has(t.status)) return { ok: false, error: `task is ${t.status}: only a task in RECONCILING_UNKNOWN_EXECUTION can be reconciled` };
    if (!s.correctsEventId) return { ok: false, error: `task was already reconciled by ${decisive.eventId} (${decisive.finding}); conflicting evidence must be submitted as a correction naming that event` };
    if (s.correctsEventId !== decisive.eventId) return { ok: false, error: `a correction must name the latest reconciliation event, ${decisive.eventId}` };
    eventType = 'EXECUTION_RECONCILIATION_CORRECTED';
    correctsEventId = decisive.eventId;
  } else if (s.correctsEventId) {
    return { ok: false, error: 'this task has not been reconciled yet; there is nothing to correct' };
  }

  // Continuity-managed tasks: the segment resolver owns the state change.
  let continuityDelegated = false;
  if (t.status === 'RECONCILING_UNKNOWN_EXECUTION' && finding !== 'EVIDENCE_INCONCLUSIVE') {
    try {
      const seg = db.prepare("SELECT segment_id FROM task_segments WHERE task_id = ? AND status = 'UNKNOWN' ORDER BY sequence DESC LIMIT 1").get(s.taskId) as any;
      if (seg) continuityDelegated = true;
    } catch { /* no continuity tables */ }
  }

  const resultingStatus = FINDING_STATUS[finding];
  const eventId = recordActivityEvent({
    taskId: s.taskId, expectedWorkspaceId: s.workspaceId, eventType, agentId: s.actor,
    payload: {
      finding, resultingStatus, fromStatus: t.status, submissionHash, correctsEventId, evidence,
      provenance: 'OPERATOR_REPORTED — recorded as submitted; not verified against the provider by SynthOS',
      fabricated: { output: false, tokens: false, responseId: false, artifact: false, review: false, receipt: false, ledgerRow: false },
      retried: false,
    },
  });
  const recordedId = eventId.event_id;

  if (continuityDelegated) {
    // The continuity controller owns segment and continuity state. NO_REQUEST
    // maps to ABANDON (never NOT_ACCEPTED, which would resume the task: this
    // action never re-runs anything).
    const seg = db.prepare("SELECT segment_id FROM task_segments WHERE task_id = ? AND status = 'UNKNOWN' ORDER BY sequence DESC LIMIT 1").get(s.taskId) as any;
    const r = resolveUnknownSegment({ taskId: s.taskId, segmentId: seg.segment_id, resolution: finding === 'PROVIDER_CONFIRMED_NO_REQUEST' ? 'ABANDON' : 'ACCEPTED', actor: s.actor, evidence: `${evidence.evidenceSource}: ${evidence.dashboardFinding}` });
    const now = (db.prepare('SELECT status FROM tasks WHERE task_id = ?').get(s.taskId) as any).status;
    if (r.ok && now !== resultingStatus) updateTaskStatus(s.taskId, resultingStatus, undefined, s.workspaceId);
    if (!r.ok) updateTaskStatus(s.taskId, resultingStatus, undefined, s.workspaceId);
  } else if (resultingStatus !== t.status) {
    updateTaskStatus(s.taskId, resultingStatus, undefined, s.workspaceId);
  }
  recordAdminAuditEvent({ actorUserId: s.actor, eventType: 'EXECUTION_RECONCILED', targetType: 'task', targetId: s.taskId, detail: { workspaceId: s.workspaceId, activityEventId: recordedId, eventType, finding, fromStatus: t.status, resultingStatus, submissionHash, correctsEventId } });
  return { ok: true, changed: true, status: resultingStatus, eventId: recordedId, finding };
}
