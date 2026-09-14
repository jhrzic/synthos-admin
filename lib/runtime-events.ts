import crypto from 'node:crypto';
import { getDatabase } from './persistence';

// ---------------------------------------------------------------------------
// Pass V / Workstream I — a small, bounded runtime-event ledger.
//
// Real events only: a skill execution attempt actually made, an MCP probe
// actually run, a Hermes health transition actually observed. Never a UI
// render, never a fabricated count. `detail_json` carries only bounded,
// non-sensitive metadata (provider/model/status/latency/ids) — raw prompts,
// API keys, tokens, passwords, and setup tokens must never be passed in
// `detail`, per I2.
// ---------------------------------------------------------------------------

export type RuntimeEventType =
  | 'SKILL_EXECUTION'
  | 'MCP_PROBE'
  | 'HERMES_HEALTH_CHECK'
  | 'PROVIDER_CALL'
  | 'EXTERNAL_EXECUTION'
  // PASS 2 — every capability invocation through lib/fabric/envelope.ts,
  // including the ones that were REFUSED. Before this, executeEnvelope's four
  // refusal paths (unregistered capability, NOT_CONFIGURED/UNSUPPORTED,
  // Guardian-unenforced external action, APPROVAL_REQUIRED) returned a value
  // to the caller and persisted nothing at all — a blocked execution left no
  // trace anywhere, so "prove nothing ran without Guardian's consent" was
  // unanswerable after the fact.
  | 'CAPABILITY_INVOCATION'
  // PUSH 2B — development-loop state changes. Additive: every existing
  // producer still emits only its original types. This is what a live
  // Development surface observes, so a UI never has to invent progress.
  | 'DEVELOPMENT_TASK';

export type RuntimeEventTargetType = 'skill' | 'mcp_server' | 'hermes_runtime' | 'provider' | 'external_execution' | 'capability' | 'development_task';

// ADR-006 — RUNNING/SUBMITTED/CANCELLED added for the external-execution
// lifecycle (Workstream M). Purely additive: every existing producer of
// this type still only ever emits the original five values.
export type RuntimeEventStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'NOT_IMPLEMENTED'
  | 'TIMEOUT'
  // PUSH 2B — BLOCKED is added rather than folded into FAILED. A Guardian
  // refusal is not a failure: nothing was attempted, and a surface that
  // showed them as the same thing would teach an operator to ignore both.
  | 'BLOCKED'
  | 'SUBMITTED'
  | 'RUNNING'
  | 'CANCELLED'
  // PASS 2 — the outcomes an attempt ledger has to be able to express.
  // BLOCKED is Guardian (or the envelope's external-action rule) refusing
  // before anything ran; APPROVAL_REQUIRED is a deferral, not a denial; and
  // UNKNOWN is a provider whose real state we could not determine — never to
  // be collapsed into FAILED, which would be an assertion we cannot make.
  | 'BLOCKED'
  | 'APPROVAL_REQUIRED'
  | 'UNKNOWN';

/**
 * Statuses that are SECURITY EVIDENCE rather than routine telemetry.
 *
 * This ledger is a bounded ring: every insert prunes the 500 oldest rows once
 * the table passes 5,000. That is fine for health probes and fine for
 * successes, and it was wrong the moment refused attempts started living here
 * — a burst of routine SUCCESS rows would silently evict the record of a
 * blocked execution, which is the one row an operator would later need.
 *
 * So the prune skips these first. They are still bounded (see
 * HARD_CEILING_MULTIPLIER below) because an unbounded table is its own
 * availability problem, but routine traffic can no longer displace them.
 */
export const SECURITY_RELEVANT_STATUSES: ReadonlySet<RuntimeEventStatus> = new Set([
  'BLOCKED',
  'APPROVAL_REQUIRED',
]);

export interface RuntimeEventRecord {
  event_id: string;
  workspace_id: string | null;
  event_type: RuntimeEventType;
  target_type: RuntimeEventTargetType;
  target_id: string;
  status: RuntimeEventStatus;
  latency_ms: number | null;
  detail_json: string | null;
  created_at: string;
}

/** I3 — bounded retention. Enforced at insert time; no cron/scheduler needed. */
const MAX_RUNTIME_EVENTS = 5000;
const PRUNE_BATCH = 500;
/** Security evidence is pruned only past this multiple of the soft cap. */
const HARD_CEILING_MULTIPLIER = 4;

/**
 * How often the retention check is even attempted, counted in inserts.
 *
 * Sampling rather than every-insert. With a 5,000-row soft cap and a 500-row
 * prune batch, checking every 100 inserts cannot let the table exceed the cap
 * by more than 100 rows before housekeeping runs — a bound that is irrelevant
 * to a retention policy and decisive for write contention.
 */
const PRUNE_CHECK_INTERVAL = 100;
let insertsSincePruneCheck = 0;

function shouldAttemptPrune(): boolean {
  insertsSincePruneCheck += 1;
  if (insertsSincePruneCheck < PRUNE_CHECK_INTERVAL) return false;
  insertsSincePruneCheck = 0;
  return true;
}

/** Test-only: forces the next insert to run the retention check. */
export function forcePruneCheckForTests(): void {
  insertsSincePruneCheck = PRUNE_CHECK_INTERVAL - 1;
}

export function recordRuntimeEvent(params: {
  workspaceId?: string | null;
  eventType: RuntimeEventType;
  targetType: RuntimeEventTargetType;
  targetId: string;
  status: RuntimeEventStatus;
  latencyMs?: number | null;
  detail?: Record<string, unknown>;
}): RuntimeEventRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const record: RuntimeEventRecord = {
    event_id: `rte-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    workspace_id: params.workspaceId ?? null,
    event_type: params.eventType,
    target_type: params.targetType,
    target_id: params.targetId,
    status: params.status,
    latency_ms: params.latencyMs ?? null,
    detail_json: params.detail ? JSON.stringify(params.detail) : null,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO runtime_events (event_id, workspace_id, event_type, target_type, target_id, status, latency_ms, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.event_id,
    record.workspace_id,
    record.event_type,
    record.target_type,
    record.target_id,
    record.status,
    record.latency_ms,
    record.detail_json,
    record.created_at
  );

  // Retention runs OFF the hot path.
  //
  // This used to do a COUNT(*) on every single insert, and a 500-row DELETE
  // whenever the table was oversized. That was cheap in isolation and not
  // cheap in aggregate: Pass 2 made executeEnvelope record an attempt row on
  // every capability invocation, so a per-insert scan plus a possible bulk
  // delete became per-invocation write pressure on the same SQLite file that
  // holds execution_claims.
  //
  // That matters because test/jarvis-duplicate-submission.test.ts spawns a
  // REAL second server process against the SAME database file, so the
  // exactly-once claim path and this ledger contend across processes. Holding
  // the write lock for a bulk delete while another writer is trying to insert
  // a claim is exactly how a marginal timing test starts failing.
  //
  // The INSERT above is untouched — durability and evidence are unchanged.
  // Only the housekeeping is sampled, so the amortised cost per insert is one
  // INSERT instead of INSERT + COUNT (+ DELETE).
  if (!shouldAttemptPrune()) return record;

  const countRow = db.prepare('SELECT COUNT(*) AS n FROM runtime_events').get() as { n: number };
  if (countRow.n > MAX_RUNTIME_EVENTS) {
    const securityStatuses = [...SECURITY_RELEVANT_STATUSES];
    const placeholders = securityStatuses.map(() => '?').join(', ');
    const pruned = db.prepare(
      `DELETE FROM runtime_events WHERE event_id IN (
         SELECT event_id FROM runtime_events
          WHERE status NOT IN (${placeholders})
          ORDER BY created_at ASC, rowid ASC LIMIT ?
       )`
    ).run(...securityStatuses, PRUNE_BATCH);

    // Only if routine rows could not free enough space.
    if ((pruned as any).changes === 0) {
      const stillOver = db.prepare('SELECT COUNT(*) AS n FROM runtime_events').get() as { n: number };
      if (stillOver.n > MAX_RUNTIME_EVENTS * HARD_CEILING_MULTIPLIER) {
        db.prepare(
          `DELETE FROM runtime_events WHERE event_id IN (
             SELECT event_id FROM runtime_events ORDER BY created_at ASC, rowid ASC LIMIT ?
           )`
        ).run(PRUNE_BATCH);
      }
    }
  }

  return record;
}

export function listRecentRuntimeEvents(params: {
  workspaceId?: string;
  targetType?: RuntimeEventTargetType;
  limit?: number;
} = {}): RuntimeEventRecord[] {
  const db = getDatabase();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (params.workspaceId) {
    clauses.push('workspace_id = ?');
    args.push(params.workspaceId);
  }
  if (params.targetType) {
    clauses.push('target_type = ?');
    args.push(params.targetType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  args.push(limit);
  return db
    // rowid is the insert-order tiebreaker. ISO timestamps have millisecond
    // resolution, and two events recorded in the same millisecond is routine —
    // a provider success immediately followed by a failure, say. Ordering by
    // created_at alone made "the most recent call" non-deterministic on a tie,
    // which let a superseded success be read as the current state.
    .prepare(`SELECT * FROM runtime_events ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...args) as RuntimeEventRecord[];
}
