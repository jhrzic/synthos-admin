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
  | 'PROVIDER_CALL';

export type RuntimeEventTargetType = 'skill' | 'mcp_server' | 'hermes_runtime' | 'provider';

export type RuntimeEventStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'NOT_IMPLEMENTED'
  | 'TIMEOUT';

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

  const countRow = db.prepare('SELECT COUNT(*) AS n FROM runtime_events').get() as { n: number };
  if (countRow.n > MAX_RUNTIME_EVENTS) {
    db.prepare(
      `DELETE FROM runtime_events WHERE event_id IN (
         SELECT event_id FROM runtime_events ORDER BY created_at ASC LIMIT ?
       )`
    ).run(PRUNE_BATCH);
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
    .prepare(`SELECT * FROM runtime_events ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...args) as RuntimeEventRecord[];
}
