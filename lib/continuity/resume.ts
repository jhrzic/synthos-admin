// ---------------------------------------------------------------------------
// CONTINUITY RESUME — driven by the existing scheduler tick, not a timer of
// its own.
//
// For each paused task it asks the canonical router (a preview; nothing is
// persisted, nothing dispatched) whether a qualified route can take it now.
// If so, the task moves to RESUMING and back to READY, and the normal
// orchestration path carries it forward — passing every gate again (router,
// Guardian, spend guard, Aegis). If not, it stays paused with the current
// reason. PAUSED_AWAITING_APPROVAL and RECONCILING_UNKNOWN_EXECUTION are
// never resumed by the sweep: they need a human decision or proof.
// ---------------------------------------------------------------------------

import { updateTaskStatus, recordActivityEvent } from '../persistence';
import { routeTask, type RoutingRequirements } from '../registry/router';
import { listPausedTasks, transition, floorFrom, getContinuity, type ContinuityRecord } from './controller';

const MIN_RECHECK_MS = 60_000;
const MAX_PER_TICK = 5;
const lastChecked = new Map<string, number>();

export function tryResume(c: ContinuityRecord, actor: string, force = false): { resumed: boolean; reason: string } {
  if (c.state === 'PAUSED_AWAITING_APPROVAL' && !force) return { resumed: false, reason: 'waiting for a human approval' };
  if (c.state === 'RECONCILING_UNKNOWN_EXECUTION') return { resumed: false, reason: 'an ambiguous outcome must be reconciled first; it is never retried automatically' };
  if (c.state === 'AWAITING_CONTINUATION') {
    updateTaskStatus(c.taskId, 'READY', undefined, c.workspaceId);
    return { resumed: true, reason: 'continuation ready' };
  }
  const floor = Object.keys(c.excludedRoutes).length ? floorFrom(null, c, 0, 0, null, []) : null;
  const preview = routeTask({ workspaceId: c.workspaceId, taskId: c.taskId, requirements: c.requirements as RoutingRequirements, constraints: c.constraints, floor, persist: false });
  if (preview.outcome !== 'SELECTED' || !preview.selected) return { resumed: false, reason: preview.explanation };
  transition(c.taskId, c.workspaceId, 'RESUMING', `A qualified route is available again (${preview.selected.providerId}/${preview.selected.modelId}); resuming through the normal path.`, { actor });
  updateTaskStatus(c.taskId, 'READY', undefined, c.workspaceId);
  return { resumed: true, reason: preview.explanation };
}

/** Called from the scheduler tick. Bounded; never dispatches. */
export function continuityTickForScheduler(now = Date.now()): { considered: number; resumed: string[] } {
  const resumed: string[] = [];
  let considered = 0;
  for (const c of listPausedTasks()) {
    if (considered >= MAX_PER_TICK) break;
    if (now - (lastChecked.get(c.taskId) ?? 0) < MIN_RECHECK_MS) continue;
    lastChecked.set(c.taskId, now);
    considered++;
    try {
      const r = tryResume(c, 'scheduler');
      if (r.resumed) resumed.push(c.taskId);
    } catch { /* one task's failure never stops the sweep */ }
  }
  return { considered, resumed };
}

/** An operator's explicit resume (e.g. after granting an approval). */
export function resumeByOperator(taskId: string, actor: string): { ok: boolean; reason: string } {
  const c = getContinuity(taskId);
  if (!c) return { ok: false, reason: 'no continuity record for this task' };
  const r = tryResume(c, actor, true);
  try { recordActivityEvent({ taskId, expectedWorkspaceId: c.workspaceId, eventType: r.resumed ? 'TASK_RESUMED' : 'RESUME_REFUSED', agentId: actor, payload: { reason: r.reason } }); } catch { /* evidence only */ }
  return { ok: r.resumed, reason: r.reason };
}

export function resetResumeThrottleForTests(): void {
  lastChecked.clear();
}
