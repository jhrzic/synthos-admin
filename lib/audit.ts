// ---------------------------------------------------------------------------
// SYNTHOS — real audit trail for authority-changing admin actions.
//
// Deliberately NOT a reuse of `activity_events` (task-execution-scoped,
// NOT NULL task_id, task-scoped reader only — see lib/persistence.ts) and
// deliberately NOT a general-purpose logging system. This records exactly
// one class of thing: who changed what authority, when. Matches this
// codebase's existing pattern of small, purpose-built tables per real need
// (skill_test_events, kil_observations, ton_telemetry_events) rather than
// one universal log.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from './persistence';

export type AdminEventType =
  | 'USER_CREATED'
  | 'USER_ENABLED'
  | 'USER_DISABLED'
  | 'PLATFORM_ROLE_CHANGED'
  | 'MEMBERSHIP_ASSIGNED'
  | 'MEMBERSHIP_ROLE_CHANGED'
  | 'MEMBERSHIP_REMOVED'
  | 'WORKSPACE_CREATED'
  | 'SETUP_TOKEN_ISSUED'
  | 'WINDMILL_TARGET_CREATED'
  | 'WINDMILL_TARGET_UPDATED'
  | 'BACKUP_RESTORE_STAGED';

export interface AdminAuditEventRecord {
  event_id: string;
  actor_user_id: string;
  event_type: AdminEventType;
  target_type: string;
  target_id: string;
  detail_json: string | null;
  created_at: string;
}

export function recordAdminAuditEvent(params: {
  actorUserId: string;
  eventType: AdminEventType;
  targetType: string;
  targetId: string;
  detail?: Record<string, any>;
}): AdminAuditEventRecord {
  const db = getDatabase();
  const eventId = `aud-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const detailJson = params.detail ? JSON.stringify(params.detail) : null;

  db.prepare(`
    INSERT INTO admin_audit_events (event_id, actor_user_id, event_type, target_type, target_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, params.actorUserId, params.eventType, params.targetType, params.targetId, detailJson, now);

  return {
    event_id: eventId,
    actor_user_id: params.actorUserId,
    event_type: params.eventType,
    target_type: params.targetType,
    target_id: params.targetId,
    detail_json: detailJson,
    created_at: now,
  };
}

export function listRecentAdminAuditEvents(limit = 50): AdminAuditEventRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM admin_audit_events ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 200)) as AdminAuditEventRecord[];
}
