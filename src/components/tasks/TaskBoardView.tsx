import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Kanban, RefreshCw, X } from 'lucide-react';
import { Badge, TaskStatusBadge } from '../verification/outcome';
import { ExecutionReconciliationPanel } from '../registry/ExecutionReconciliationPanel';
import { TaskRoutingPanel } from '../registry/TaskRoutingPanel';

// ---------------------------------------------------------------------------
// TASKS — the canonical server task records (GET /api/tasks, lib/task-board.ts).
//
// Replaces the browser-local board: nothing here is stored in the browser and
// nothing is mutated from this view. Stages come from the real task
// lifecycle. Every field is a recorded fact or NOT RECORDED. Task actions
// (cancel / archive / requeue) stay in Queue Review, where each needs a
// reason and a confirmation and is audited; reconciliation of an ambiguous
// execution is in the task's detail.
// ---------------------------------------------------------------------------

const STAGES = ['QUEUED', 'RUNNING', 'PAUSED', 'RECONCILING', 'VERIFYING', 'DONE', 'INCOMPLETE', 'FAILED', 'CANCELLED', 'OTHER'] as const;
const NR = <span className="text-[#6A7097]">NOT RECORDED</span>;
const box = 'p-3 bg-[#05060C] border border-[#1C2038] rounded-xl';

export interface BoardTask {
  taskId: string; workspaceId: string; title: string; description: string | null; status: string; stage: string;
  assignedAgent: string | null; assignedModel: string | null; createdAt: string; updatedAt: string; autonomyEligible: boolean; legacy: boolean;
  taskClass: string | null; outputContract: string | null;
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

export const TaskBoardView: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const [data, setData] = useState<{ tasks: BoardTask[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hideLegacy, setHideLegacy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.success || !Array.isArray(j.tasks)) { setError(j?.error || (j?.controlPlane === 'UNREACHABLE' ? 'control plane unreachable' : `HTTP ${r.status}`)); setData(null); return; }
        setData({ tasks: j.tasks, total: j.total });
      })
      .catch((e) => { setError(String(e?.message || e)); setData(null); });
  }, [workspaceId]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => (data?.tasks ?? []).filter((t) => (!hideLegacy || !t.legacy) && (!q.trim() || `${t.title} ${t.taskId} ${t.assignedAgent ?? ''} ${t.status}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, q, hideLegacy]);
  const open = data?.tasks.find((t) => t.taskId === openId) ?? null;

  return (
    <div className="space-y-4" data-testid="task-board">
      <div className="flex flex-wrap items-center gap-3">
        <Kanban className="w-5 h-5 text-[#00D26A]" />
        <h1 className="text-lg font-bold text-white">Tasks</h1>
        <Badge tone="inert">CANONICAL SERVER RECORD</Badge>
        <span className="text-xs text-[#8E94B8] font-mono" data-testid="task-board-count">{data ? `${visible.length} shown of ${data.total}` : error ? 'UNAVAILABLE' : 'Loading…'}</span>
        <input className="bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1 text-xs text-white" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tasks" />
        <label className="text-xs text-[#8E94B8] flex items-center gap-1"><input type="checkbox" checked={hideLegacy} onChange={(e) => setHideLegacy(e.target.checked)} />hide legacy queued</label>
        <button onClick={load} className="p-1.5 rounded-lg border border-[#2D3352] text-[#8E94B8]" aria-label="Refresh tasks"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      <p className="text-xs text-[#8E94B8] max-w-3xl">Read-only view of the task table. Nothing is created, run or changed from here. Cancel / archive / requeue are in Diagnostics → Queue Review (reason + confirmation, audited); an ambiguous execution is reconciled from the task's detail.</p>

      {error ? (
        <div className="p-8 text-center text-[#FF6B6B] border border-[#FF6B6B]/30 rounded-xl" data-testid="task-board-unavailable">Tasks are UNAVAILABLE: {error}. This is not an empty board.</div>
      ) : !data ? (
        <div className="p-8 text-center text-[#8E94B8]">Loading the task record…</div>
      ) : data.total === 0 ? (
        <div className="p-8 text-center text-[#8E94B8]" data-testid="task-board-empty">No tasks exist in this workspace.</div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" data-testid="task-board-stages">
          {STAGES.map((stage) => {
            const ts = visible.filter((t) => t.stage === stage);
            if (!ts.length) return null;
            return (
              <div key={stage} className="bg-[#0A0B14] border border-[#1C2038] rounded-xl p-2 min-w-0" data-testid="task-stage" data-stage={stage}>
                <div className="text-[10px] font-mono text-[#8E94B8] px-1 pb-1 flex justify-between"><span>{stage}</span><span>{ts.length}</span></div>
                <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                  {ts.map((t) => (
                    <button key={t.taskId} onClick={() => setOpenId(t.taskId)} className="w-full text-left p-2 rounded-lg bg-[#05060C] border border-[#1C2038] hover:border-[#615EFF]" data-testid="task-card">
                      <div className="text-xs text-white line-clamp-2">{t.title}</div>
                      <div className="flex flex-wrap gap-1 mt-1 items-center">
                        <TaskStatusBadge status={t.status} />
                        {t.legacy && <Badge tone="inert">LEGACY</Badge>}
                        {t.receipts.count > 0 && <Badge tone={t.receipts.verified === t.receipts.count ? 'success' : 'warning'}>RECEIPT {t.receipts.verified}/{t.receipts.count}</Badge>}
                        {t.artifacts.quarantined > 0 && <Badge tone="warning">QUARANTINED</Badge>}
                      </div>
                      <div className="text-[10px] font-mono text-[#6A7097] mt-1 truncate">{t.assignedAgent ?? 'no agent'} · {t.assignedModel ?? 'no model'} · {t.updatedAt.slice(0, 16)}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={() => setOpenId(null)}>
          <aside className="w-full max-w-2xl h-full overflow-y-auto bg-[#0B0C14] border-l border-[#1C2038] p-4 space-y-3" onClick={(e) => e.stopPropagation()} data-testid="task-detail">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0"><div className="text-white font-bold">{open.title}</div><div className="text-[10px] font-mono text-[#6A7097] break-all">{open.taskId}</div></div>
              <button onClick={() => setOpenId(null)} aria-label="Close"><X className="w-4 h-4 text-[#8E94B8]" /></button>
            </div>
            <dl className={`${box} grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px] font-mono text-[#C9CCE6]`} data-testid="task-detail-fields">
              <dt className="text-[#6A7097]">status</dt><dd><TaskStatusBadge status={open.status} /> {open.legacy && <Badge tone="inert">LEGACY — unchanged</Badge>}</dd>
              <dt className="text-[#6A7097]">agent / model</dt><dd>{open.assignedAgent ?? NR} · {open.assignedModel ?? NR}</dd>
              <dt className="text-[#6A7097]">task class</dt><dd>{open.taskClass ?? NR}</dd>
              <dt className="text-[#6A7097]">output contract</dt><dd>{open.outputContract ?? NR}</dd>
              <dt className="text-[#6A7097]">route</dt><dd>{open.route ? `${open.route.providerId}/${open.route.modelId} → ${open.route.canonicalVersionId ?? 'UNMAPPED'} (${open.route.outcome}, ${open.route.decidedAt})` : NR}</dd>
              <dt className="text-[#6A7097]">qualification</dt><dd>{open.qualification ? `${open.qualification.state} (${open.qualification.qualificationId})` : NR}</dd>
              <dt className="text-[#6A7097]">guardian</dt><dd>{open.guardian ? `${open.guardian.verdict} (${open.guardian.at})` : NR}</dd>
              <dt className="text-[#6A7097]">spend ledger</dt><dd>{open.spend ? `${open.spend.rows} row(s): ${open.spend.statuses.join(', ')}${open.spend.actualCostUsd != null ? ` · $${open.spend.actualCostUsd.toFixed(6)}` : ''}` : 'no ledger row'}</dd>
              <dt className="text-[#6A7097]">aegis review</dt><dd>{open.aegis ? `${open.aegis.decision}${open.aegis.score != null ? ` (${open.aegis.score})` : ''} · ${open.aegis.at}` : NR}</dd>
              <dt className="text-[#6A7097]">receipts</dt><dd>{open.receipts.count ? `${open.receipts.verified}/${open.receipts.count} verify · latest ${open.receipts.latestId}` : 'none'}</dd>
              <dt className="text-[#6A7097]">artifacts</dt><dd>{open.artifacts.count ? `${open.artifacts.count} (${open.artifacts.statuses.join(', ')})` : 'none'}</dd>
              <dt className="text-[#6A7097]">continuity</dt><dd>{open.continuity ?? NR}</dd>
              <dt className="text-[#6A7097]">reconciliation</dt><dd>{open.reconciliation ? `${open.reconciliation.findings} finding(s)${open.reconciliation.latestFinding ? ` · latest ${open.reconciliation.latestFinding}` : ''}` : 'not applicable'}</dd>
              <dt className="text-[#6A7097]">created / updated</dt><dd>{open.createdAt} · {open.updatedAt}</dd>
            </dl>
            {open.description && <div className={`${box} text-xs text-[#C9CCE6] whitespace-pre-wrap`}>{open.description}</div>}
            <ExecutionReconciliationPanel workspaceId={open.workspaceId} taskId={open.taskId} />
            <TaskRoutingPanel workspaceId={open.workspaceId} taskId={open.taskId} />
          </aside>
        </div>
      )}
    </div>
  );
};
