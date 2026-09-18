import React, { useCallback, useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Badge } from '../verification/outcome';
import { ConfirmButton } from '../registry/LocalRouteControls';
import { ExecutionReconciliationPanel } from '../registry/ExecutionReconciliationPanel';

// ---------------------------------------------------------------------------
// QUEUE REVIEW — every queued task (existing task table), whether it could run
// under the current switches, exactly why not, and which operator actions are
// available. Reading it changes nothing. Actions are explicit: a reason and a
// second confirmation, workspace-scoped, audited and idempotent on the server.
// ---------------------------------------------------------------------------

export const QueueReviewPanel: React.FC = () => {
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [processing, setProcessing] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/master-admin/task-queue').then((r) => r.json()).then((j) => {
      if (j?.success) { setTasks(j.tasks); setProcessing(j.processing ?? null); setError(null); } else setError(j?.error || 'Queue review unavailable.');
    }).catch(() => setError('Queue review unavailable.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (t: any, action: string) => {
    const r = await fetch(`/api/task-queue/${encodeURIComponent(t.taskId)}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: t.workspaceId, action, reason: reason[t.taskId] || '', confirm: true }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? `${action}: ${j.changed ? `now ${j.state}` : 'already applied (no change)'}` : `Refused: ${j?.error || `HTTP ${r.status}`}`);
    load();
  };

  if (error) return <div className="text-xs text-[#FF6B6B]" data-testid="queue-review-error">{error}</div>;
  if (!tasks) return <div className="text-xs text-slate-400">Reading the task queue…</div>;
  const runnable = tasks.filter((t) => t.couldExecuteNow).length;

  return (
    <div className="space-y-3" data-testid="queue-review">
      <div className="text-white text-sm font-bold flex items-center gap-2"><ListChecks className="w-4 h-4" />Queue review</div>
      <div className={`p-3 rounded-xl border text-[11px] font-mono ${processing?.enabled ? 'border-[#E8A845]/50 text-[#E8A845]' : 'border-[#1C2038] text-[#C9CCE6]'}`} data-testid="queued-task-processing">
        <div>Queued-task processing: <span className="font-bold" data-testid="queued-task-processing-effective">{processing ? (processing.enabled ? 'ON' : 'OFF') : 'OFF (UNKNOWN — fail closed)'}</span>{processing ? ` · state ${processing.state} · stored ${processing.storedValue ?? 'none'}${processing.updatedAt ? ` · set ${processing.updatedAt} by ${processing.updatedBy ?? 'UNKNOWN'}` : ''}` : ''}</div>
        <div className="text-slate-500">{processing?.reason ?? 'not reported'} · enforced at {(processing?.gates ?? []).length} points: nothing is claimed, started, dispatched, resumed or scheduled while OFF; ledger and receipt bookkeeping continue.</div>
      </div>
      <div className="text-[11px] text-slate-400" data-testid="queue-review-summary">
        {tasks.length} queued task(s); {runnable} could execute under the current switches. Reviewing changes nothing — every action below needs a reason and a confirmation.
      </div>
      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.taskId} className="p-3 bg-[#06070E] border border-[#1A1D34] rounded-xl text-[10px] font-mono" data-testid="queue-task">
            <div className="flex flex-wrap gap-2 items-center text-white">
              <span data-testid="queue-task-id">{t.taskId}</span>
              <Badge tone="inert">{t.state}</Badge>
              <Badge tone={t.couldExecuteNow ? 'warning' : 'inert'}>{t.couldExecuteNow ? 'COULD EXECUTE NOW' : 'CANNOT EXECUTE'}</Badge>
            </div>
            <div className="text-slate-400">
              workspace {t.workspaceId} · created {t.createdAt} · class {t.taskClass ?? 'NOT RECORDED'} · contract {t.outputContract ?? 'NOT RECORDED'} · model {t.assignedModel ?? 'none'}{t.pinnedRoute ? ` (pinned ${t.pinnedRoute.providerId}/${t.pinnedRoute.modelId})` : ''} · autonomy-eligible {t.autonomyEligible ? 'yes' : 'no'} · valid qualification {t.qualificationValid ? 'yes' : 'no'}
            </div>
            {t.blockedBecause.length > 0 && <ul className="list-disc ml-4 text-slate-500" data-testid="queue-task-blockers">{t.blockedBecause.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>}
            {/* Ambiguous execution: the audited reconciliation action and its evidence trail. */}
            {t.state === 'RECONCILING_UNKNOWN_EXECUTION' && (
              <div className="mt-2 font-sans" data-testid="queue-task-reconciliation">
                <ExecutionReconciliationPanel workspaceId={t.workspaceId} taskId={t.taskId} />
              </div>
            )}
            <div className="flex flex-wrap gap-2 items-center mt-1">
              <input className="bg-[#080A16] border border-[#1E223D] rounded px-2 py-1 text-[10px] text-white" placeholder="reason (required)" value={reason[t.taskId] || ''} onChange={(e) => setReason({ ...reason, [t.taskId]: e.target.value })} aria-label={`reason for ${t.taskId}`} />
              {t.actions.map((a: any) => (
                <span key={a.action} title={a.reason}>
                  <ConfirmButton testId={`queue-${a.action.toLowerCase()}-${t.taskId}`} label={a.action} disabled={!a.allowed || !(reason[t.taskId] || '').trim()}
                    confirmText={`${a.action} ${t.taskId} — ${a.reason}`} onConfirm={() => act(t, a.action)} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {msg && <div className="text-[11px] text-slate-300" data-testid="queue-review-msg">{msg}</div>}
    </div>
  );
};
