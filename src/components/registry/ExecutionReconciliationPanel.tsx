import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ClipboardCheck, RefreshCw } from 'lucide-react';
import { Badge, TaskStatusBadge } from '../verification/outcome';
import { ConfirmButton } from './LocalRouteControls';

// ---------------------------------------------------------------------------
// AMBIGUOUS-EXECUTION RECONCILIATION — task detail.
//
// For a task in RECONCILING_UNKNOWN_EXECUTION: what to look for in the
// provider's own records (derived from the task's append-only evidence — no
// provider is contacted), the operator form, and the complete evidence trail.
// Submitting records the operator's finding; it never retries anything and
// can never turn a response-less task into a verified success.
// ---------------------------------------------------------------------------

const box = 'p-3 bg-[#05060C] border border-[#1C2038] rounded-xl';
const input = 'w-full bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1.5 text-xs text-white';
const label = 'text-[10px] text-[#6A7097] uppercase';

const FINDING_HELP: Record<string, string> = {
  PROVIDER_CONFIRMED_COMPLETED: 'The provider records a completed response. SynthOS never received it, so the task becomes INCOMPLETE — not done.',
  PROVIDER_CONFIRMED_FAILED: 'The provider records the request, and it failed. The task becomes FAILED.',
  PROVIDER_CONFIRMED_NO_REQUEST: 'The provider has no record of the request in the window. The task becomes CANCELLED; nothing is re-run.',
  PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE: 'Usage shows a request, but no response can be found. The task becomes INCOMPLETE.',
  EVIDENCE_INCONCLUSIVE: 'The records cannot settle it. The evidence is recorded and the outcome stays UNKNOWN.',
};
const ALLOWS_RESPONSE_ID = new Set(['PROVIDER_CONFIRMED_COMPLETED', 'PROVIDER_CONFIRMED_FAILED']);
const ALLOWS_USAGE = new Set(['PROVIDER_CONFIRMED_COMPLETED', 'PROVIDER_CONFIRMED_FAILED', 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE']);

export const ExecutionReconciliationPanel: React.FC<{ workspaceId: string; taskId: string }> = ({ workspaceId, taskId }) => {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({ finding: '', evidenceSource: '', windowStart: '', windowEnd: '', provider: '', model: '', dashboardFinding: '', note: '', providerResponseId: '', inputTokens: '', outputTokens: '', costUsd: '', correctsEventId: '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const load = useCallback(() => {
    setError(null);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/execution-reconciliation?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        // A task that exists only on this browser's board has no server record: nothing to reconcile.
        if (r.status === 404) { setData({ notFound: true }); return; }
        if (!r.ok || !j?.success) { setError(j?.error || `HTTP ${r.status}`); return; }
        setData(j);
      })
      .catch((e) => setError(String(e?.message || e)));
  }, [taskId, workspaceId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="text-xs text-[#7E8BB5]" data-testid="execution-reconciliation">Reconciliation record: UNKNOWN ({error})</div>;
  if (!data) return <div className="text-xs text-[#7E8BB5]" data-testid="execution-reconciliation">Loading reconciliation record…</div>;
  if (data.notFound) return null;
  const g = data.guide;
  const trail: any[] = data.trail || [];
  if (!g) return null;
  const reconciling = g.status === 'RECONCILING_UNKNOWN_EXECUTION';
  if (!reconciling && trail.length === 0) return null;
  const latestDecisive = [...trail].reverse().find((t) => t.finding !== 'EVIDENCE_INCONCLUSIVE');

  const submit = async () => {
    setMsg(null);
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const usage = ALLOWS_USAGE.has(f.finding) && (f.inputTokens || f.outputTokens || f.costUsd) ? { inputTokens: num(f.inputTokens), outputTokens: num(f.outputTokens), costUsd: num(f.costUsd) } : null;
    const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/execution-reconciliation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId, confirm: true, finding: f.finding, evidenceSource: f.evidenceSource, windowStart: f.windowStart, windowEnd: f.windowEnd,
        provider: f.provider, model: f.model, dashboardFinding: f.dashboardFinding, note: f.note,
        providerResponseId: ALLOWS_RESPONSE_ID.has(f.finding) && f.providerResponseId.trim() ? f.providerResponseId.trim() : null,
        usage, correctsEventId: f.correctsEventId || null,
      }),
    });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? (j.changed ? `Recorded: ${j.finding} → ${j.status}` : 'Already recorded (identical submission): nothing changed') : `Refused: ${j?.error || `HTTP ${r.status}`}`);
    load();
  };

  const ready = f.finding && f.evidenceSource.trim() && f.windowStart && f.windowEnd && f.provider.trim() && f.model.trim() && f.dashboardFinding.trim().length >= 10 && f.note.trim().length >= 10;

  return (
    <div className="space-y-3" data-testid="execution-reconciliation">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-[#E8A845]" />
        <span className="text-white font-bold">Execution reconciliation</span>
        <TaskStatusBadge status={g.status} />
        <button className="px-2 py-1 rounded-md text-[10px] font-mono border border-[#2D3352] text-[#C9CCE6]" onClick={load}><RefreshCw className="w-3 h-3 inline" /></button>
      </div>

      {reconciling && (
        <div className={`${box} space-y-1 text-[11px] text-[#C9CCE6]`} data-testid="reconciliation-guide">
          <div className="text-[#E8A845]"><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />A provider request may have been sent and its outcome was never recorded. SynthOS will not retry it. Check the provider's own records, then record what you found.</div>
          <div>Dispatch started: <span className="font-mono text-white">{g.executionStartedAt ?? 'UNKNOWN'}</span></div>
          <div>Look in window (UTC): <span className="font-mono text-white" data-testid="guide-window">{g.suggestedWindow ? `${g.suggestedWindow.start} → ~${g.suggestedWindow.end}` : 'UNKNOWN'}</span></div>
          <div>Provider: <span className="font-mono text-white">{g.provider ?? 'UNKNOWN'}</span> · endpoint <span className="font-mono text-white">{g.endpoint ?? 'UNKNOWN'}</span> · model <span className="font-mono text-white" data-testid="guide-model">{g.model ?? 'UNKNOWN'}</span></div>
          <div>Instruction sent: <span className="text-white" data-testid="guide-instruction">{g.instruction ? `"${g.instruction}"` : 'UNKNOWN'}</span></div>
          <div>Known request / response ids: <span className="font-mono text-white">{[...g.knownIdentifiers.providerRequestIds, ...g.knownIdentifiers.responseIds].join(', ') || 'none recorded'}</span></div>
          {g.exclude.length > 0 && (
            <div data-testid="guide-exclude">Exclude (other tasks on the same model started soon after): {g.exclude.map((x: any) => <span key={x.taskId} className="font-mono text-white mr-2">{x.taskId} at {x.startedAt}</span>)}</div>
          )}
          <div className="text-[#8E94B8]">Best evidence: the provider dashboard's request/response logs for that window. Record only what the provider shows — leave response id and usage empty unless you actually see them.</div>
        </div>
      )}

      {(reconciling || latestDecisive) && (
        <div className={`${box} space-y-2`} data-testid="reconciliation-form">
          {!reconciling && latestDecisive && <div className="text-[10px] text-[#E8A845]">Already reconciled by {latestDecisive.eventId} ({latestDecisive.finding}). A different finding is recorded as an appended correction of that event.</div>}
          <div>
            <div className={label}>Finding</div>
            <select className={input} value={f.finding} onChange={set('finding')} aria-label="Finding" data-testid="reconciliation-finding">
              <option value="">choose what the provider records show…</option>
              {(data.findings as string[]).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            {f.finding && <div className="text-[10px] text-[#8E94B8] mt-1">{FINDING_HELP[f.finding]}</div>}
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div><div className={label}>Evidence source</div><input className={input} value={f.evidenceSource} onChange={set('evidenceSource')} placeholder="e.g. provider dashboard → Logs → Responses" aria-label="Evidence source" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><div className={label}>Window start (UTC)</div><input className={input} value={f.windowStart} onChange={set('windowStart')} placeholder="2026-01-01T00:00:00Z" aria-label="Window start" /></div>
              <div><div className={label}>Window end (UTC)</div><input className={input} value={f.windowEnd} onChange={set('windowEnd')} placeholder="2026-01-01T00:02:00Z" aria-label="Window end" /></div>
            </div>
            <div><div className={label}>Provider</div><input className={input} value={f.provider} onChange={set('provider')} aria-label="Provider" /></div>
            <div><div className={label}>Model</div><input className={input} value={f.model} onChange={set('model')} aria-label="Model" /></div>
          </div>
          <div><div className={label}>Dashboard finding</div><textarea className={input} rows={2} value={f.dashboardFinding} onChange={set('dashboardFinding')} placeholder="What the provider records show, in words" aria-label="Dashboard finding" /></div>
          <div><div className={label}>Note</div><textarea className={input} rows={2} value={f.note} onChange={set('note')} placeholder="How you checked, and anything that limits the evidence" aria-label="Note" /></div>
          {ALLOWS_RESPONSE_ID.has(f.finding) && <div><div className={label}>Provider response id (only if shown)</div><input className={input} value={f.providerResponseId} onChange={set('providerResponseId')} aria-label="Provider response id" /></div>}
          {ALLOWS_USAGE.has(f.finding) && (
            <div className="grid grid-cols-3 gap-2">
              <div><div className={label}>Input tokens (if shown)</div><input className={input} value={f.inputTokens} onChange={set('inputTokens')} aria-label="Input tokens" /></div>
              <div><div className={label}>Output tokens (if shown)</div><input className={input} value={f.outputTokens} onChange={set('outputTokens')} aria-label="Output tokens" /></div>
              <div><div className={label}>Cost USD (if shown)</div><input className={input} value={f.costUsd} onChange={set('costUsd')} aria-label="Cost USD" /></div>
            </div>
          )}
          {!reconciling && latestDecisive && (
            <label className="text-[10px] text-[#C9CCE6] flex gap-2 items-center"><input type="checkbox" checked={f.correctsEventId === latestDecisive.eventId} onChange={(e) => setF({ ...f, correctsEventId: e.target.checked ? latestDecisive.eventId : '' })} />This corrects {latestDecisive.eventId}</label>
          )}
          <ConfirmButton testId="reconciliation-submit" label="Record this finding" disabled={!ready} confirmText={`record ${f.finding || '…'} for ${taskId} — this is appended to the audit trail and cannot be edited`} onConfirm={submit} />
          {msg && <div className="text-[10px] text-[#C9CCE6]" data-testid="reconciliation-msg">{msg}</div>}
        </div>
      )}

      <div className="space-y-1" data-testid="reconciliation-trail">
        <div className={label}>Evidence trail ({trail.length})</div>
        {trail.length === 0 && <div className="text-[10px] text-[#7E8BB5]">No finding recorded yet. The outcome is UNKNOWN.</div>}
        {trail.map((t) => (
          <div key={t.eventId} className={`${box} text-[10px] text-[#C9CCE6]`} data-testid="reconciliation-trail-entry">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge tone={t.finding === 'EVIDENCE_INCONCLUSIVE' ? 'warning' : 'inert'}>{t.eventType}</Badge>
              <span className="font-mono text-white">{t.finding}</span> → <span className="font-mono">{t.resultingStatus}</span>
              <span className="text-[#8E94B8]">by {t.actor} at {t.at}</span>
              {t.correctsEventId && <span className="text-[#E8A845]">corrects {t.correctsEventId}</span>}
            </div>
            <div className="text-[#8E94B8] mt-1">
              {t.evidence.evidenceSource} · window {t.evidence.windowStart} → {t.evidence.windowEnd} · {t.evidence.provider}/{t.evidence.model}
              {t.evidence.providerResponseId ? ` · response ${t.evidence.providerResponseId}` : ''}
              {t.evidence.operatorReportedUsage ? ` · operator-reported usage ${JSON.stringify(t.evidence.operatorReportedUsage)}` : ''}
            </div>
            <div className="mt-1" data-testid="reconciliation-truths">
              provider truth <span className="font-mono text-white">{t.finding}</span> · SynthOS execution truth <span className="font-mono text-white">{t.executionTruth ?? 'NOT RECORDED on this event'}</span>{t.reasonCode ? <> · reason <span className="font-mono">{t.reasonCode}</span></> : null}
              {t.transition ? <div className="font-mono text-[#8E94B8]">{t.transition.join(' → ')}</div> : null}
            </div>
            <div className="mt-1">{t.evidence.dashboardFinding}</div>
            <div className="mt-1 text-[#8E94B8]">{t.evidence.note}</div>
            <div className="mt-1 font-mono text-[#6A7097]">submission {String(t.submissionHash).slice(0, 16)}…</div>
          </div>
        ))}
      </div>
    </div>
  );
};
