// ---------------------------------------------------------------------------
// QUEUED-TASK REVIEW — an operator view over the EXISTING task table.
//
// Not a second task system: it reads tasks, continuity records, the model
// registry, qualifications and the spend policy, and explains — per queued
// task — whether it could run right now and exactly why not. Reading it
// changes nothing.
//
// Actions (CANCEL, ARCHIVE, REQUEUE) are separate, explicit, workspace-scoped,
// confirmed, audited by the caller and idempotent: applying the same action
// twice changes nothing the second time. Nothing here runs a task.
// ---------------------------------------------------------------------------

import { getDatabase, updateTaskStatus, recordActivityEvent } from './persistence';
import { resolveRoute, ensureRegistry } from './registry';
import { listQualifications, findQualification, getTaskClass } from './registry/qualification';
import { routeTask, requirementsFor } from './registry/router';
import { getSpendPolicy } from './spend/policy';
import { isDraining } from './runtime-lifecycle';
import { readQueuedTaskProcessing } from './queued-task-processing';

const QUEUED = ['TODO', 'READY', 'PAUSED_AWAITING_CAPACITY', 'PAUSED_AWAITING_QUALIFIED_CAPACITY', 'PAUSED_AWAITING_BUDGET', 'PAUSED_AWAITING_APPROVAL', 'PAUSED_AWAITING_REPLAN', 'RECONCILING_UNKNOWN_EXECUTION', 'WAITING_FOR_APPROVAL'];
const CANCELLABLE = ['TODO', 'READY', 'PAUSED_AWAITING_CAPACITY', 'PAUSED_AWAITING_QUALIFIED_CAPACITY', 'PAUSED_AWAITING_BUDGET', 'PAUSED_AWAITING_APPROVAL', 'PAUSED_AWAITING_REPLAN'];

export type QueueAction = 'CANCEL' | 'ARCHIVE' | 'REQUEUE';

export interface QueuedTaskReview {
  taskId: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  taskClass: string | null;
  outputContract: string | null;
  assignedModel: string | null;
  pinnedRoute: { providerId: string; modelId: string } | null;
  autonomyEligible: boolean;
  qualificationValid: boolean;
  couldExecuteNow: boolean;
  blockedBecause: string[];
  actions: Array<{ action: QueueAction; allowed: boolean; reason: string }>;
}

export function reviewQueuedTasks(opts: { workspaceId?: string | null; limit?: number } = {}): QueuedTaskReview[] {
  ensureRegistry();
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM tasks WHERE status IN (${QUEUED.map(() => '?').join(', ')}) ${opts.workspaceId ? 'AND workspace_id = ?' : ''} ORDER BY created_at ASC LIMIT ?`)
    .all(...QUEUED, ...(opts.workspaceId ? [opts.workspaceId] : []), Math.min(Math.max(opts.limit ?? 200, 1), 1000)) as any[];
  const policy = getSpendPolicy();
  return rows.map((t) => {
    let cont: any = null;
    try { cont = db.prepare('SELECT task_class, contract_json FROM task_continuity WHERE task_id = ?').get(t.task_id); } catch { /* none */ }
    let params: any = null;
    try { params = t.parameters_json ? JSON.parse(t.parameters_json) : null; } catch { /* not JSON */ }
    const taskClass: string | null = cont?.task_class ?? params?.taskClass ?? null;
    let outputContract: string | null = null;
    try { outputContract = cont?.contract_json ? JSON.parse(cont.contract_json)?.mode ?? null : params?.outputContract?.mode ?? null; } catch { /* none */ }
    const assigned = t.assigned_model && t.assigned_model !== 'n/a' ? String(t.assigned_model) : null;
    const route = assigned ? resolveRoute(assigned) : null;
    const pinnedRoute = route && route.ok ? { providerId: route.providerId, modelId: route.modelId } : null;
    const blocked: string[] = [];
    const eligible = Number(t.autonomy_eligible) === 1;
    if (!eligible) blocked.push('not autonomy-eligible: the orchestrator never selects it; only an explicit REQUEUE could');
    if (!taskClass) blocked.push('no task class recorded: the canonical router has nothing to qualify it against');
    else if (!getTaskClass(taskClass)) blocked.push(`task class ${taskClass} is not registered`);
    if (t.assigned_model === 'n/a' || (assigned && !pinnedRoute)) blocked.push(`assigned model "${t.assigned_model}" is not a registered model route`);
    if (t.status === 'RECONCILING_UNKNOWN_EXECUTION') blocked.push('an earlier dispatch has an unknown outcome; it must be reconciled before anything runs');
    if (t.status === 'WAITING_FOR_APPROVAL') blocked.push('waiting for a human approval');
    if (!policy.modelExecutionEnabled) blocked.push('all model execution is switched off');
    if (isDraining()) blocked.push('the service is draining');
    const processing = readQueuedTaskProcessing();
    if (!processing.enabled) blocked.push(`queued-task processing is ${processing.state} (${processing.reason})`);
    let qualificationValid = false;
    let routable = false;
    if (taskClass && getTaskClass(taskClass)) {
      qualificationValid = pinnedRoute ? findQualification(pinnedRoute.providerId, pinnedRoute.modelId, { taskClass }).ok : listQualifications({ taskClass }).some((q) => q.state === 'VALID');
      if (!qualificationValid) blocked.push(`no VALID qualification for ${taskClass}${pinnedRoute ? ` on ${pinnedRoute.providerId}/${pinnedRoute.modelId}` : ''}`);
      const req = requirementsFor({ taskClass, outputContract: outputContract ?? undefined, inputChars: 1000 });
      if (!('error' in req)) {
        const d = routeTask({ workspaceId: t.workspace_id, requirements: req, constraints: pinnedRoute ? { pinnedRoute } : {}, persist: false });
        routable = !!d.selected;
        if (!d.selected) blocked.push(`router: ${d.explanation}`);
      }
    }
    const couldExecuteNow = eligible && ['TODO', 'READY'].includes(t.status) && routable && !isDraining() && processing.enabled;
    const actions: QueuedTaskReview['actions'] = [
      { action: 'CANCEL', allowed: CANCELLABLE.includes(t.status), reason: CANCELLABLE.includes(t.status) ? 'moves it to CANCELLED; history kept' : `not cancellable from ${t.status}` },
      { action: 'ARCHIVE', allowed: CANCELLABLE.includes(t.status), reason: CANCELLABLE.includes(t.status) ? 'retires it as legacy (CANCELLED, recorded as an archive); history kept' : `not archivable from ${t.status}` },
      {
        action: 'REQUEUE',
        allowed: !eligible && ['TODO', 'READY'].includes(t.status) && !!taskClass && (!assigned || !!pinnedRoute),
        reason: eligible ? 'already autonomy-eligible' : !['TODO', 'READY'].includes(t.status) ? `not requeueable from ${t.status}` : !taskClass ? 'no task class recorded: it could not be routed' : assigned && !pinnedRoute ? 'its assigned model is not a registered route' : 'makes it autonomy-eligible; the switches, qualification and router still decide whether it runs',
      },
    ];
    return {
      taskId: t.task_id, workspaceId: t.workspace_id, title: t.title, createdAt: t.created_at, updatedAt: t.updated_at, state: t.status,
      taskClass, outputContract, assignedModel: t.assigned_model ?? null, pinnedRoute, autonomyEligible: eligible, qualificationValid,
      couldExecuteNow, blockedBecause: couldExecuteNow ? [] : blocked, actions,
    };
  });
}

/** Apply one explicit operator action. Idempotent; workspace-scoped; the caller audits. */
export function applyQueueAction(p: { workspaceId: string; taskId: string; action: QueueAction; reason: string; actor: string; confirm: boolean }): { ok: true; changed: boolean; state: string } | { ok: false; error: string } {
  if (!p.confirm) return { ok: false, error: 'an explicit confirmation is required' };
  if (!p.reason || p.reason.trim().length < 3) return { ok: false, error: 'a reason is required' };
  const db = getDatabase();
  const t = db.prepare('SELECT task_id, workspace_id, status, autonomy_eligible FROM tasks WHERE task_id = ?').get(p.taskId) as any;
  if (!t || t.workspace_id !== p.workspaceId) return { ok: false, error: `task ${p.taskId} is not in workspace ${p.workspaceId}` };
  const review = reviewQueuedTasks({ workspaceId: p.workspaceId }).find((r) => r.taskId === p.taskId);
  if (p.action === 'CANCEL' || p.action === 'ARCHIVE') {
    if (t.status === 'CANCELLED') return { ok: true, changed: false, state: t.status };
    if (!CANCELLABLE.includes(t.status)) return { ok: false, error: `a ${t.status} task cannot be ${p.action === 'CANCEL' ? 'cancelled' : 'archived'}` };
    recordActivityEvent({ taskId: p.taskId, expectedWorkspaceId: p.workspaceId, eventType: p.action === 'CANCEL' ? 'TASK_CANCELLED_BY_OPERATOR' : 'TASK_ARCHIVED_BY_OPERATOR', agentId: p.actor, payload: { fromStatus: t.status, reason: p.reason } });
    updateTaskStatus(p.taskId, 'CANCELLED', undefined, p.workspaceId);
    return { ok: true, changed: true, state: 'CANCELLED' };
  }
  if (p.action === 'REQUEUE') {
    if (Number(t.autonomy_eligible) === 1) return { ok: true, changed: false, state: t.status };
    const allowed = review?.actions.find((a) => a.action === 'REQUEUE');
    if (!allowed?.allowed) return { ok: false, error: `cannot requeue: ${allowed?.reason ?? 'not queued'}` };
    db.prepare('UPDATE tasks SET autonomy_eligible = 1 WHERE task_id = ? AND workspace_id = ?').run(p.taskId, p.workspaceId);
    recordActivityEvent({ taskId: p.taskId, expectedWorkspaceId: p.workspaceId, eventType: 'TASK_REQUEUED_BY_OPERATOR', agentId: p.actor, payload: { reason: p.reason, note: 'autonomy-eligible; switches, qualification and router still decide' } });
    return { ok: true, changed: true, state: t.status };
  }
  return { ok: false, error: 'action must be CANCEL, ARCHIVE or REQUEUE' };
}
