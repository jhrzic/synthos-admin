// ---------------------------------------------------------------------------
// PROVIDER USAGE LEDGER — one durable row per paid-provider attempt.
//
// Every attempt is recorded, including the ones that were BLOCKED before any
// network call, so "why did nothing run" and "what did it cost" are both
// answerable from one table.
//
// ESTIMATED vs ACTUAL are separate columns and never merged:
//   estimated_cost_usd  computed BEFORE dispatch from configured pricing and a
//                       conservative token estimate. Always present when the
//                       call was permitted.
//   actual_cost_usd     computed AFTER, only from token counts the provider
//                       itself reported. NULL with actual_cost_state
//                       'ACTUAL_COST_UNKNOWN' whenever that is not possible.
// Budget arithmetic uses actual when known, otherwise the estimate — the
// conservative figure — so an unknown cost can never read as zero.
//
// Metadata calls (model-catalog discovery, Antigravity status polls) are not
// inference and never produce a row here.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from '../persistence';

export const USAGE_STATUSES = [
  'BLOCKED',                 // refused by policy before any network call
  'RESERVED',                // permitted; budget held; not yet sent
  'DISPATCHED',              // a paid request left the process; outcome pending
  'SUCCESS',
  'PROVIDER_REJECTION',      // provider answered 4xx (auth, invalid model, 429 …) — not processed
  'KNOWN_FAILURE',           // failed with a known outcome (connection refused, empty 200 …)
  'PRE_DISPATCH_FAILURE',    // failed before any paid request was sent — cost 0
  'TIMEOUT_AFTER_DISPATCH',  // sent, then timed out — may have been processed and billed
  'UNKNOWN',                 // sent, outcome not determinable (5xx, reset, crash)
  'OPERATOR_CLEARED',        // an operator reviewed an ambiguous row and allowed a new attempt
] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

/** Rows that may have incurred cost — counted against budgets. */
export const COST_BEARING_STATUSES: UsageStatus[] = ['RESERVED', 'DISPATCHED', 'SUCCESS', 'KNOWN_FAILURE', 'TIMEOUT_AFTER_DISPATCH', 'UNKNOWN', 'OPERATOR_CLEARED'];
/** Ambiguous outcomes: never automatically retried. */
export const AMBIGUOUS_STATUSES: UsageStatus[] = ['TIMEOUT_AFTER_DISPATCH', 'UNKNOWN'];

export interface UsageRow {
  usage_id: string;
  task_class?: string | null;
  canonical_version_id?: string | null;
  deployment_id?: string | null;
  routing_decision_id?: string | null;
  segment_id?: string | null;
  provider: string;
  model: string;
  call_site: string;
  workspace_id: string | null;
  task_id: string | null;
  correlation_id: string | null;
  idempotency_key: string;
  attempt: number;
  status: UsageStatus;
  reason_code: string | null;
  reason: string | null;
  provider_request_id: string | null;
  input_chars: number | null;
  estimated_input_tokens: number | null;
  max_output_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  actual_cost_state: 'KNOWN' | 'ACTUAL_COST_UNKNOWN' | null;
  cost_tier: string | null;
  approval_id: string | null;
  price_version: string | null;
  price_snapshot_json: string | null;
  /** How the provider said the response ended. A billed SUCCESS can still be an INCOMPLETE answer. */
  provider_termination: string | null;
  created_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
}

let ensured = false;
export function ensureUsageTable(): void {
  const db = getDatabase();
  if (ensured) {
    // A test that closes and reopens the database gets a fresh handle.
    try { db.prepare('SELECT 1 FROM provider_usage LIMIT 1').get(); return; } catch { ensured = false; }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_usage (
      usage_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      call_site TEXT NOT NULL,
      workspace_id TEXT,
      task_id TEXT,
      correlation_id TEXT,
      idempotency_key TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason_code TEXT,
      reason TEXT,
      provider_request_id TEXT,
      input_chars INTEGER,
      estimated_input_tokens INTEGER,
      max_output_tokens INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      estimated_cost_usd REAL,
      actual_cost_usd REAL,
      actual_cost_state TEXT,
      cost_tier TEXT,
      approval_id TEXT,
      price_version TEXT,
      price_snapshot_json TEXT,
      provider_termination TEXT,
      created_at TEXT NOT NULL,
      dispatched_at TEXT,
      completed_at TEXT,
      UNIQUE (idempotency_key, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_status ON provider_usage(status);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_key ON provider_usage(idempotency_key);
    CREATE TABLE IF NOT EXISTS spend_alerts (
      alert_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      period_key TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      spent_usd REAL NOT NULL,
      limit_usd REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (scope, period_key, threshold)
    );
  `);
  // Columns added after the table first shipped.
  const cols = (db.prepare('PRAGMA table_info(provider_usage)').all() as any[]).map((c) => c.name);
  if (!cols.includes('price_version')) db.exec('ALTER TABLE provider_usage ADD COLUMN price_version TEXT');
  if (!cols.includes('price_snapshot_json')) db.exec('ALTER TABLE provider_usage ADD COLUMN price_snapshot_json TEXT');
  if (!cols.includes('provider_termination')) db.exec('ALTER TABLE provider_usage ADD COLUMN provider_termination TEXT');
  // Routing evidence: which canonical version, route, deployment and decision
  // this call ran under (null for rows written before the router existed).
  for (const c of ['task_class', 'canonical_version_id', 'deployment_id', 'routing_decision_id', 'segment_id']) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE provider_usage ADD COLUMN ${c} TEXT`);
  }
  ensured = true;
}

export function newUsageId(): string {
  return `use-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function insertUsageRow(row: Partial<UsageRow> & Pick<UsageRow, 'usage_id' | 'provider' | 'model' | 'call_site' | 'idempotency_key' | 'attempt' | 'status' | 'created_at'>): void {
  ensureUsageTable();
  const keys = Object.keys(row);
  getDatabase().prepare(`INSERT INTO provider_usage (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => (row as any)[k] ?? null));
}

export function patchUsageRow(usageId: string, patch: Partial<UsageRow>): void {
  ensureUsageTable();
  const keys = Object.keys(patch);
  if (!keys.length) return;
  getDatabase().prepare(`UPDATE provider_usage SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE usage_id = ?`)
    .run(...keys.map((k) => (patch as any)[k] ?? null), usageId);
}

export function getUsageRow(usageId: string): UsageRow | null {
  ensureUsageTable();
  return (getDatabase().prepare('SELECT * FROM provider_usage WHERE usage_id = ?').get(usageId) as UsageRow) ?? null;
}

export function listUsageForKey(idempotencyKey: string): UsageRow[] {
  ensureUsageTable();
  return getDatabase().prepare('SELECT * FROM provider_usage WHERE idempotency_key = ? ORDER BY attempt ASC').all(idempotencyKey) as UsageRow[];
}

export function listRecentUsage(limit = 100): UsageRow[] {
  ensureUsageTable();
  return getDatabase().prepare('SELECT * FROM provider_usage ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 500)) as UsageRow[];
}

/** UTC day and month boundaries — one calendar everyone can check. */
export function periodStarts(now = new Date()): { dayStart: string; monthStart: string; dayKey: string; monthKey: string } {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth(); const d = now.getUTCDate();
  const dayStart = new Date(Date.UTC(y, m, d)).toISOString();
  const monthStart = new Date(Date.UTC(y, m, 1)).toISOString();
  return { dayStart, monthStart, dayKey: dayStart.slice(0, 10), monthKey: monthStart.slice(0, 7) };
}

const COST_EXPR = `COALESCE(actual_cost_usd, estimated_cost_usd, 0)`;

/** Conservative spend since `since`, optionally scoped. */
export function spentSince(since: string, scope: { provider?: string; workspaceId?: string } = {}): number {
  ensureUsageTable();
  const where = [`created_at >= ?`, `status IN (${COST_BEARING_STATUSES.map(() => '?').join(', ')})`];
  const args: any[] = [since, ...COST_BEARING_STATUSES];
  if (scope.provider) { where.push('provider = ?'); args.push(scope.provider); }
  if (scope.workspaceId) { where.push('workspace_id = ?'); args.push(scope.workspaceId); }
  const row = getDatabase().prepare(`SELECT COALESCE(SUM(${COST_EXPR}), 0) AS s FROM provider_usage WHERE ${where.join(' AND ')}`).get(...args) as any;
  return Number(row?.s ?? 0);
}

/**
 * Calls occupying a concurrency slot. Synchronous providers hold a slot while
 * RESERVED/DISPATCHED for at most 15 minutes (a process that died mid-call
 * cannot hold a slot forever; the row itself is later marked UNKNOWN).
 * Antigravity holds its slot for as long as the remote run is in flight.
 */
export function inFlightCount(scope: { provider?: string; workspaceId?: string } = {}): number {
  ensureUsageTable();
  const staleCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const where = [`status IN ('RESERVED', 'DISPATCHED')`, `(provider = 'antigravity' OR created_at >= ?)`];
  const args: any[] = [staleCutoff];
  if (scope.provider) { where.push('provider = ?'); args.push(scope.provider); }
  if (scope.workspaceId) { where.push('workspace_id = ?'); args.push(scope.workspaceId); }
  return Number((getDatabase().prepare(`SELECT COUNT(*) AS n FROM provider_usage WHERE ${where.join(' AND ')}`).get(...args) as any)?.n ?? 0);
}

/**
 * Crash recovery: a synchronous call left RESERVED/DISPATCHED for more than 15
 * minutes belongs to a process that died. DISPATCHED becomes UNKNOWN (it may
 * have been billed, and must not be retried automatically); RESERVED never
 * left the process and becomes PRE_DISPATCH_FAILURE.
 */
export function reconcileStaleUsage(): number {
  ensureUsageTable();
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const now = new Date().toISOString();
  const db = getDatabase();
  const a = db.prepare(`UPDATE provider_usage SET status = 'UNKNOWN', reason_code = 'PROCESS_LOST', reason = 'The process handling this call stopped before its outcome was recorded. It may have been billed; it will not be retried automatically.', completed_at = ?
                         WHERE status = 'DISPATCHED' AND provider != 'antigravity' AND created_at < ?`).run(now, cutoff) as any;
  const b = db.prepare(`UPDATE provider_usage SET status = 'PRE_DISPATCH_FAILURE', reason_code = 'PROCESS_LOST', reason = 'Reserved but never sent before the process stopped.', estimated_cost_usd = 0, completed_at = ?
                         WHERE status = 'RESERVED' AND created_at < ?`).run(now, cutoff) as any;
  return Number(a?.changes ?? 0) + Number(b?.changes ?? 0);
}

export function recordSpendAlert(scope: string, periodKey: string, threshold: number, spentUsd: number, limitUsd: number): boolean {
  ensureUsageTable();
  try {
    getDatabase().prepare(`INSERT INTO spend_alerts (alert_id, scope, period_key, threshold, spent_usd, limit_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`alert-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, scope, periodKey, threshold, spentUsd, limitUsd, new Date().toISOString());
    return true;
  } catch {
    return false; // already alerted for this scope, period and threshold
  }
}

export function listSpendAlerts(limit = 50): any[] {
  ensureUsageTable();
  return getDatabase().prepare('SELECT * FROM spend_alerts ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}
