// ---------------------------------------------------------------------------
// TASK BOARD — the canonical server task records, as the Admin's Tasks view.
//
// One task authority: the `tasks` table (lib/persistence.ts). This module only
// READS it and the evidence tables that hang off it; it never changes a task.
// Every field is a recorded fact or `null` (the UI shows NOT RECORDED): task
// class / output contract (task_continuity), the route the canonical router
// selected (routing_decisions), qualification for that route and class,
// Guardian's verdict, spend-ledger rows, Aegis reviews, receipts (verified),
// artifacts with their retrieval (quarantine) status, continuity state and
// the operator reconciliation trail.
// ---------------------------------------------------------------------------

import { getDatabase, verifyReceipt } from './persistence';
import { reconciliationTrail } from './continuity/orphans';
import { listQualifications } from './registry/qualification';

export type BoardStage = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'RECONCILING' | 'VERIFYING' | 'DONE' | 'INCOMPLETE' | 'FAILED' | 'CANCELLED' | 'OTHER';

export const BOARD_STAGES: readonly BoardStage[] = ['QUEUED', 'RUNNING', 'PAUSED', 'RECONCILING', 'VERIFYING', 'DONE', 'INCOMPLETE', 'FAILED', 'CANCELLED', 'OTHER'];

export function stageOf(status: string): BoardStage {
  if (['TODO', 'READY', 'WAITING_FOR_APPROVAL', 'AWAITING_APPROVAL'].includes(status)) return 'QUEUED';
  if (['RUNNING', 'IN_PROGRESS', 'EXECUTING', 'DISPATCHED'].includes(status)) return 'RUNNING';
  if (status.startsWith('PAUSED_') || status === 'AWAITING_CONTINUATION') return 'PAUSED';
  if (status === 'RECONCILING_UNKNOWN_EXECUTION') return 'RECONCILING';
  if (['AWAITING_VERIFICATION', 'AWAITING_RECEIPT', 'VERIFYING'].includes(status)) return 'VERIFYING';
  if (['DONE', 'VERIFIED'].includes(status)) return 'DONE';
  if (status === 'INCOMPLETE') return 'INCOMPLETE';
  if (['FAILED', 'VERIFICATION_FAILED', 'BLOCKED', 'REJECTED'].includes(status)) return 'FAILED';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'OTHER';
}

export interface BoardTask {
  taskId: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: string;
  stage: BoardStage;
  assignedAgent: string | null;
  assignedModel: string | null;
  createdAt: string;
  updatedAt: string;
  autonomyEligible: boolean;
  legacy: boolean;
  taskClass: string | null;
  outputContract: string | null;
  route: { providerId: string; modelId: string; canonicalVersionId: string | null; outcome: string; decidedAt: string } | null;
  qualification: { state: string; qualificationId: string } | null;
  guardian: { verdict: string; at: string } | null;
  spend: { rows: number; statuses: string[]; actualCostUsd: number | null } | null;
  aegis: { decision: string; score: number | null; at: string } | null;
  receipts: { count: number; verified: number; latestId: string | null };
  artifacts: { count: number; quarantined: number; statuses: string[] };
  continuity: string | null;
  reconciliation: { findings: number; latestFinding: string | null } | null;
}

const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function listBoardTasks(workspaceId: string, opts: { limit?: number } = {}): { tasks: BoardTask[]; total: number } {
  const db = getDatabase();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
  const total = (db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?').get(workspaceId) as any).n;
  const rows = db.prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC, task_id LIMIT ?').all(workspaceId, limit) as any[];
  const quals = safe(() => listQualifications(), [] as any[]);

  const tasks = rows.map((t): BoardTask => {
    const id = t.task_id as string;
    const cont = safe(() => db.prepare('SELECT task_class, contract_json, state FROM task_continuity WHERE task_id = ?').get(id) as any, null);
    let contract: string | null = null;
    try { contract = cont?.contract_json ? (JSON.parse(cont.contract_json)?.mode ?? null) : null; } catch { contract = null; }
    const dec = safe(() => db.prepare('SELECT selected_json, outcome, guardian_json, created_at FROM routing_decisions WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(id) as any, null);
    let route: BoardTask['route'] = null;
    let guardian: BoardTask['guardian'] = null;
    if (dec) {
      try { const sel = dec.selected_json ? JSON.parse(dec.selected_json) : null; if (sel) route = { providerId: sel.providerId, modelId: sel.modelId, canonicalVersionId: sel.canonicalVersionId ?? null, outcome: dec.outcome, decidedAt: dec.created_at }; } catch { /* unreadable: not recorded */ }
      try { const g = dec.guardian_json ? JSON.parse(dec.guardian_json) : null; if (g) guardian = { verdict: String(g.verdict ?? g.decision ?? (g.allowed === false ? 'REFUSED' : g.allowed === true ? 'ALLOWED' : 'RECORDED')), at: dec.created_at }; } catch { /* not recorded */ }
    }
    if (!guardian) {
      const gb = safe(() => db.prepare("SELECT created_at FROM activity_events WHERE task_id = ? AND event_type = 'GUARDIAN_BLOCKED' ORDER BY rowid DESC LIMIT 1").get(id) as any, null);
      if (gb) guardian = { verdict: 'BLOCKED', at: gb.created_at };
    }
    const taskClass = cont?.task_class ?? null;
    const q = route && taskClass ? quals.find((x: any) => x.providerId === route!.providerId && x.modelId === route!.modelId && x.taskClass === taskClass) : null;
    const usage = safe(() => db.prepare('SELECT status, actual_cost_usd FROM provider_usage WHERE task_id = ?').all(id) as any[], []);
    const review = safe(() => db.prepare('SELECT decision, score, created_at FROM quality_reviews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(id) as any, null);
    const receipts = safe(() => db.prepare('SELECT * FROM receipts WHERE task_id = ? ORDER BY created_at DESC').all(id) as any[], []);
    const arts = safe(() => db.prepare('SELECT retrieval_status FROM artifacts WHERE task_id = ?').all(id) as any[], []);
    const trail = t.status === 'RECONCILING_UNKNOWN_EXECUTION' || safe(() => (db.prepare("SELECT COUNT(*) n FROM activity_events WHERE task_id = ? AND event_type LIKE 'EXECUTION_RECONCILI%'").get(id) as any).n > 0, false)
      ? safe(() => reconciliationTrail(id), [])
      : null;
    const costs = usage.map((u) => u.actual_cost_usd).filter((c) => typeof c === 'number');
    return {
      taskId: id, workspaceId: t.workspace_id, title: t.title, description: t.description ? String(t.description).slice(0, 400) : null,
      status: t.status, stage: stageOf(t.status), assignedAgent: t.assigned_agent ?? null, assignedModel: t.assigned_model ?? null,
      createdAt: t.created_at, updatedAt: t.updated_at, autonomyEligible: Number(t.autonomy_eligible) === 1,
      legacy: (t.assigned_model === 'n/a' || !t.assigned_model) && ['TODO', 'READY'].includes(t.status) && !taskClass,
      taskClass, outputContract: contract, route, qualification: q ? { state: q.state, qualificationId: q.qualificationId } : null,
      guardian, spend: usage.length ? { rows: usage.length, statuses: [...new Set(usage.map((u) => u.status as string))], actualCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null } : null,
      aegis: review ? { decision: review.decision, score: review.score ?? null, at: review.created_at } : null,
      receipts: { count: receipts.length, verified: receipts.filter((r) => safe(() => verifyReceipt(r), false)).length, latestId: receipts[0]?.receipt_id ?? null },
      artifacts: { count: arts.length, quarantined: arts.filter((a) => a.retrieval_status === 'QUARANTINED').length, statuses: [...new Set(arts.map((a) => String(a.retrieval_status ?? 'ACTIVE')))] },
      continuity: cont?.state ?? null,
      reconciliation: trail ? { findings: trail.length, latestFinding: trail.length ? trail[trail.length - 1].finding : null } : null,
    };
  });
  return { tasks, total };
}
