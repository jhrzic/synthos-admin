import React, { useCallback, useEffect, useState } from 'react';
import { GitBranch, RefreshCw, PauseCircle, PlayCircle, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Badge, TaskStatusBadge, isPausedStatus, type Tone } from '../verification/outcome';

// ---------------------------------------------------------------------------
// ROUTING & CONTINUITY — task detail.
//
// Reads GET /api/tasks/:id/continuity (local; no provider call): the task
// class, routing mode and requirements, every persisted routing decision
// (selected family/version, route/deployment, qualification, price version,
// plain-language explanation, and every rejected candidate with its reason),
// the segment chain, signed checkpoints, side effects, and the evidence
// chain to receipts. Paused is shown as paused — never as failed — and the
// two operator actions (resume, reconcile an unknown outcome) are explicit.
// ---------------------------------------------------------------------------

const box = 'p-3 bg-[#05060C] border border-[#1C2038] rounded-xl';
const btn = 'px-2 py-1 rounded-md text-[10px] font-mono border border-[#2D3352] text-[#C9CCE6] hover:border-[#615EFF] disabled:opacity-40';
const segTone = (s: string): Tone => (s === 'COMPLETED' || s === 'ACCEPTED_BY_RECONCILIATION' ? 'success' : s === 'FAILED' ? 'error' : s === 'RUNNING' ? 'inert' : 'warning');

export const TaskRoutingPanel: React.FC<{ workspaceId: string; taskId: string }> = ({ workspaceId, taskId }) => {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/continuity?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.success) { setError(j?.error || `HTTP ${r.status}`); return; }
        setData(j);
      })
      .catch((e) => setError(String(e?.message || e)));
  }, [taskId, workspaceId]);
  useEffect(() => { load(); }, [load]);

  const post = async (path: string, body: Record<string, unknown>) => {
    setMsg(null);
    const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/continuity/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, ...body }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? `Done: ${j.reason || j.state || 'ok'}` : `Refused: ${j?.reason || j?.error || `HTTP ${r.status}`}`);
    load();
  };

  if (error) return <div className="text-xs text-[#7E8BB5]" data-testid="task-routing-panel">Routing record: UNKNOWN ({error})</div>;
  if (!data) return <div className="text-xs text-[#7E8BB5]" data-testid="task-routing-panel">Loading routing record…</div>;
  const c = data.continuity;
  if (!c) return <div className={`${box} text-[#7E8BB5]`} data-testid="task-routing-panel">No routing record: this task has not been routed by the canonical router (it predates it, or has not run).</div>;

  const unknownSeg = (data.segments as any[]).find((s) => s.status === 'UNKNOWN');
  const decisions = [...(data.decisions as any[])].reverse();

  return (
    <div className="space-y-3" data-testid="task-routing-panel">
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="w-4 h-4 text-[#8C8AFF]" />
        <span className="text-white font-bold">Routing &amp; continuity</span>
        <TaskStatusBadge status={c.state} />
        <Badge tone="inert">CLASS: {c.taskClass}</Badge>
        <Badge tone="inert">CONTRACT: {c.contract?.mode ?? 'UNKNOWN'}</Badge>
        <Badge tone="inert">PRIVACY: {c.privacyClass}</Badge>
        <Badge tone="inert">SEGMENTS: {c.segmentCount}</Badge>
        <button className={btn} onClick={load}><RefreshCw className="w-3 h-3 inline" /></button>
      </div>
      {c.stateReason && (
        <div className={`${box} text-[#C9CCE6]`}>
          {isPausedStatus(c.state) ? <PauseCircle className="w-3.5 h-3.5 inline mr-1 text-[#E8A845]" /> : null}
          {c.stateReason}
        </div>
      )}
      {msg && <div className="text-[10px] text-[#C9CCE6]">{msg}</div>}

      {/* Operator actions */}
      {(isPausedStatus(c.state) || c.state === 'AWAITING_CONTINUATION') && c.state !== 'RECONCILING_UNKNOWN_EXECUTION' && (
        <button className={btn} onClick={() => post('resume', {})} data-testid="continuity-resume"><PlayCircle className="w-3 h-3 inline mr-1" />Resume if a qualified route is available</button>
      )}
      {c.state === 'RECONCILING_UNKNOWN_EXECUTION' && unknownSeg && (
        <div className={`${box} space-y-2`} data-testid="continuity-reconcile">
          <div className="text-[#E8A845]"><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />Segment {unknownSeg.sequence} on {unknownSeg.providerId}/{unknownSeg.modelId} may have been processed (ledger {unknownSeg.budgetUsageId ?? 'UNKNOWN'}). It is never retried automatically.</div>
          <input className="w-full bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1.5 text-xs text-white" placeholder="Evidence (provider dashboard, request id, support reply…)" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          <div className="flex gap-2">
            <button className={btn} disabled={evidence.trim().length < 3} onClick={() => post('reconcile', { segmentId: unknownSeg.segmentId, resolution: 'NOT_ACCEPTED', evidence })}>Not accepted by provider — continue</button>
            <button className={btn} disabled={evidence.trim().length < 3} onClick={() => post('reconcile', { segmentId: unknownSeg.segmentId, resolution: 'ACCEPTED', evidence })}>Provider processed it — mark INCOMPLETE</button>
            <button className={btn} disabled={evidence.trim().length < 3} onClick={() => post('reconcile', { segmentId: unknownSeg.segmentId, resolution: 'ABANDON', evidence })}>Abandon</button>
          </div>
        </div>
      )}

      {/* Requirements */}
      <div className={box}>
        <div className="text-[10px] text-[#6A7097] uppercase mb-1">Requirements</div>
        <div className="text-[#C9CCE6] text-[10px]">
          capabilities {(c.requirements?.capabilities || []).join(', ') || '—'} · modality {(c.requirements?.modality?.input || []).join('+')}→{(c.requirements?.modality?.output || []).join('+')} · ~{c.requirements?.estimatedInputTokens ?? '?'} in / {c.requirements?.expectedOutputTokens ?? '?'} out tokens · tools {(c.requirements?.tools || []).join(', ') || 'none'}
          {c.constraints?.mode ? <> · mode {c.constraints.mode}</> : null}
          {c.constraints?.pinnedRoute ? <> · pinned {c.constraints.pinnedRoute.providerId}/{c.constraints.pinnedRoute.modelId}</> : null}
        </div>
      </div>

      {/* Decisions */}
      <div className="space-y-2">
        <div className="text-[10px] text-[#6A7097] uppercase">Router decisions ({decisions.length})</div>
        {decisions.map((d: any) => (
          <div key={d.decisionId} className={box} data-testid="routing-decision">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={d.outcome === 'SELECTED' ? 'success' : d.outcome === 'GUARDIAN_REFUSED' ? 'error' : 'warning'}>{d.outcome}</Badge>
              <span className="text-[10px] text-[#8E94B8]">{d.mode} · {d.policy.policyId} v{d.policy.version} · {new Date(d.createdAt).toLocaleString()}</span>
            </div>
            {d.selected && (
              <div className="mt-1 text-[10px] text-[#C9CCE6]">
                version <span className="text-white">{d.selected.canonicalVersionId ?? 'UNMAPPED'}</span>{d.selected.familyId ? <> (family {d.selected.familyId})</> : null}
                {' '}· route <span className="text-white">{d.selected.providerId}/{d.selected.modelId}</span> [{d.selected.routeKind}] · deployment {d.selected.deploymentId}
                {' '}· qualification {d.selected.qualificationId} · price {d.selected.priceVersion ?? 'no charge'}{d.selected.estimatedCostUsd != null ? <> · est. ≤ ${Number(d.selected.estimatedCostUsd).toFixed(6)}</> : null}
              </div>
            )}
            <div className="mt-1 text-[#C9CCE6]">{d.explanation}</div>
            <button className={`${btn} mt-1`} onClick={() => setOpen({ ...open, [d.decisionId]: !open[d.decisionId] })}>{open[d.decisionId] ? 'Hide' : 'Show'} {d.candidates.length} candidates</button>
            {open[d.decisionId] && <CandidateTable candidates={d.candidates} />}
          </div>
        ))}
      </div>

      {/* Segments */}
      <div className="space-y-1">
        <div className="text-[10px] text-[#6A7097] uppercase">Segments</div>
        {(data.segments as any[]).length === 0 && <div className="text-[10px] text-[#7E8BB5]">No segment has run.</div>}
        {(data.segments as any[]).map((s) => (
          <div key={s.segmentId} className={`${box} text-[10px]`} data-testid="continuity-segment">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white">#{s.sequence}</span>
              <Badge tone={segTone(s.status)}>{s.status}</Badge>
              <span className="text-[#C9CCE6]">{s.providerId}/{s.modelId} @ {s.deploymentId} · {s.canonicalVersionId ?? 'UNMAPPED'}</span>
            </div>
            <div className="text-[#8E94B8] mt-1">
              ledger {s.budgetUsageId ?? '—'} · price {s.priceVersion ?? '—'} · response {s.providerResponseId ?? '—'} · termination {s.termination?.status ?? '—'}{s.termination?.reason ? ` (${s.termination.reason})` : ''}
              {' '}· input #{String(s.inputHash).slice(0, 10)}{s.outputHash ? ` · output #${String(s.outputHash).slice(0, 10)}` : ''} · Aegis {s.aegisDecision ?? '—'} · receipt {s.receiptId ?? '—'}
            </div>
            {s.statusReason && <div className="text-[#C9CCE6] mt-1">{s.statusReason}</div>}
          </div>
        ))}
      </div>

      {/* Checkpoints */}
      <div className="space-y-1">
        <div className="text-[10px] text-[#6A7097] uppercase">Checkpoints (signed)</div>
        {(data.checkpoints as any[]).length === 0 && <div className="text-[10px] text-[#7E8BB5]">None.</div>}
        {(data.checkpoints as any[]).map((k) => (
          <div key={k.checkpointId} className={`${box} text-[10px]`} data-testid="continuity-checkpoint">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white">#{k.sequence} {k.reason}</span>
              <Badge tone={k.verified ? 'success' : 'error'}>{k.verified ? <><ShieldCheck className="w-3 h-3" />SIGNATURE VERIFIES</> : 'SIGNATURE FAILS'}</Badge>
              <span className="text-[#8E94B8]">key {k.fingerprint} · {k.retention}</span>
            </div>
            <div className="text-[#8E94B8] mt-1">
              remaining: {(k.payload.remainingWork || []).join('; ') || '—'} · performed side effects {k.payload.sideEffectsPerformed.length} · must not repeat {k.payload.prohibitedRepeats.length} · pending external {k.payload.pendingExternalActions.length} · spent ${k.payload.budget.spentUsd}
            </div>
          </div>
        ))}
      </div>

      {/* Side effects + evidence chain */}
      <div className={`${box} text-[10px]`}>
        <div className="text-[#6A7097] uppercase mb-1">Side effects</div>
        {(data.sideEffects as any[]).length === 0 ? <div className="text-[#7E8BB5]">None recorded.</div> : (data.sideEffects as any[]).map((e) => (
          <div key={e.idempotencyKey} className="text-[#C9CCE6]">{e.kind} · {e.status} · {e.idempotencyKey}{e.evidenceRef ? ` · ${e.evidenceRef}` : ''}</div>
        ))}
      </div>
      <div className={`${box} text-[10px]`} data-testid="continuity-activity">
        <div className="text-[#6A7097] uppercase mb-1">Evidence chain</div>
        {(data.activity as any[]).map((e) => (
          <div key={e.event_id ?? `${e.event_type}-${e.created_at}`} className="text-[#C9CCE6]">{new Date(e.created_at).toLocaleTimeString()} · <span className="text-white">{e.event_type}</span></div>
        ))}
        {(data.receipts as any[]).map((r) => (
          <div key={r.receiptId} className="text-[#C9CCE6]">receipt {r.receiptId} · {r.verified ? 'verifies' : 'DOES NOT VERIFY'} · outcome {r.payload?.outcome ?? 'NOT STATED'} · decision {r.payload?.routingDecisionId ?? '—'} · version {r.payload?.canonicalVersionId ?? '—'} · segments {(r.payload?.segmentIds || []).length}</div>
        ))}
      </div>
    </div>
  );
};

export const CandidateTable: React.FC<{ candidates: any[] }> = ({ candidates }) => (
  <div className="overflow-x-auto mt-2" data-testid="router-candidates">
    <table className="w-full text-[10px] text-left">
      <thead className="text-[#6A7097]"><tr><th className="pr-2">Route</th><th className="pr-2">Version</th><th className="pr-2">Kind</th><th className="pr-2">Est. cost</th><th className="pr-2">Score</th><th>Rejected because</th></tr></thead>
      <tbody>
        {[...candidates].sort((a, b) => (a.disqualified.length - b.disqualified.length) || ((b.score ?? 0) - (a.score ?? 0))).map((c) => (
          <tr key={c.routeKey} className="border-t border-[#141628] text-[#C9CCE6] align-top">
            <td className="pr-2 text-white">{c.routeKey}</td>
            <td className="pr-2">{c.canonicalVersionId ?? 'UNMAPPED'}</td>
            <td className="pr-2">{c.routeKind}{c.free ? (c.freeGuaranteed ? ' · free' : ' · free (volatile)') : ''}</td>
            <td className="pr-2">{c.estimatedCostUsd == null ? 'UNKNOWN' : `$${Number(c.estimatedCostUsd).toFixed(6)}`}</td>
            <td className="pr-2" title={(c.scoreBreakdown || []).map((x: any) => `${x.weight} ${x.w}×${x.value === null ? 'unknown' : Number(x.value).toFixed(2)}`).join('\n')}>{c.score == null ? '—' : Number(c.score).toFixed(3)}</td>
            <td className="text-[#E8A845]">{c.disqualified.length ? c.disqualified.map((d: any) => `${d.code}: ${d.reason}`).join(' · ') : <span className="text-[#00D26A]">eligible</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
