import React, { useCallback, useEffect, useState } from 'react';
import { Route, Play, RefreshCw, Scale, PauseCircle } from 'lucide-react';
import { Badge, TaskStatusBadge } from '../verification/outcome';
import { CandidateTable } from './TaskRoutingPanel';

// ---------------------------------------------------------------------------
// CANONICAL ROUTER — decision view.
//
// POST /api/router/preview evaluates every registered route offering for a
// hypothetical task: requirements → qualified → eligible versions → permitted
// routes → deployments → capacity → quality/reliability → cost. It returns
// the candidates, each rejection with its reason, the scores with their
// explicit weights, the selection and the policy version. Nothing is
// persisted and nothing is sent to any provider.
//
// Also here: the active routing policy and its versions, this workspace's
// routing constraints (a floor tasks cannot lower), paused tasks, and
// routing-evidence proposals (applied only when approved).
// ---------------------------------------------------------------------------

const box = 'p-3 bg-[#05060C] border border-[#1C2038] rounded-xl';
const btn = 'px-2 py-1 rounded-md text-[10px] font-mono border border-[#2D3352] text-[#C9CCE6] hover:border-[#615EFF] disabled:opacity-40';
const input = 'bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#615EFF]';

export const CanonicalRouterPanel: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const [taskClasses, setTaskClasses] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any | null>(null);
  const [paused, setPaused] = useState<any[]>([]);
  const [evidence, setEvidence] = useState<any | null>(null);
  const [form, setForm] = useState({ taskClass: '', outputContract: '', mode: 'BEST_QUALIFIED', inputChars: 2000, expectedOutputTokens: 1024, privacyClass: 'STANDARD' });
  const [decision, setDecision] = useState<any | null>(null);
  const [constraintsText, setConstraintsText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const q = `workspaceId=${encodeURIComponent(workspaceId)}`;
  const load = useCallback(() => {
    fetch(`/api/registry/task-classes?${q}`).then((r) => r.json()).then((j) => { if (j?.success && Array.isArray(j.taskClasses)) { setTaskClasses(j.taskClasses); setForm((f) => (f.taskClass ? f : { ...f, taskClass: j.taskClasses[0]?.taskClassId || '' })); } }).catch(() => {});
    fetch(`/api/router/policies?${q}`).then((r) => r.json()).then((j) => { if (j?.success) { setPolicies(j); setConstraintsText(JSON.stringify(j.workspaceRouting || {}, null, 2)); } }).catch(() => {});
    fetch(`/api/continuity/paused?${q}`).then((r) => r.json()).then((j) => { if (j?.success && Array.isArray(j.tasks)) setPaused(j.tasks); }).catch(() => {});
    fetch('/api/router/evidence').then(async (r) => { if (r.ok) { const j = await r.json(); if (j?.success) setEvidence(j); } }).catch(() => {});
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const preview = async () => {
    setMsg(null);
    const r = await fetch('/api/router/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, taskClass: form.taskClass, outputContract: form.outputContract || undefined, inputChars: Number(form.inputChars), expectedOutputTokens: Number(form.expectedOutputTokens), privacyClass: form.privacyClass, constraints: { mode: form.mode } }) });
    const j = await r.json().catch(() => null);
    if (!j?.success) { setMsg(`Refused: ${j?.error || `HTTP ${r.status}`}`); return; }
    setDecision(j.decision);
  };

  const saveConstraints = async () => {
    setMsg(null);
    let constraints: any;
    try { constraints = JSON.parse(constraintsText || '{}'); } catch { setMsg('Constraints must be valid JSON.'); return; }
    const r = await fetch('/api/router/workspace-routing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, constraints }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? 'Workspace routing constraints saved.' : `Refused: ${j?.error || `HTTP ${r.status}`}`);
    load();
  };

  const decide = async (proposalId: string, approve: boolean) => {
    const r = await fetch(`/api/router/evidence/${encodeURIComponent(proposalId)}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? (approve ? 'Approved.' : 'Rejected.') : `Refused: ${j?.error || `HTTP ${r.status}`}`);
    load();
  };

  const propose = async () => {
    const r = await fetch('/api/router/evidence/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'ROUTE_STATS' }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? (j.proposalId ? `Proposed ${j.proposalId} (${j.groups} route groups). It changes nothing until approved.` : `Not enough verified samples yet (${(j.skipped || []).length} groups below the minimum).`) : `Refused: ${j?.error || `HTTP ${r.status}`}`);
    load();
  };

  const active = policies?.active;
  return (
    <div className="space-y-4 font-mono text-xs" data-testid="canonical-router">
      <div className="flex flex-wrap items-center gap-2">
        <Route className="w-4 h-4 text-[#8C8AFF]" />
        <span className="text-sm font-bold text-white font-['Space_Grotesk']">Canonical Model Router</span>
        <span className="text-[10px] text-[#6A7097]">qualified routes only · no silent fallback · previews send nothing</span>
        <button className={btn} onClick={load}><RefreshCw className="w-3 h-3 inline" /></button>
      </div>
      {msg && <div className="text-[#C9CCE6]">{msg}</div>}

      {/* Preview */}
      <div className={`${box} space-y-2`}>
        <div className="text-[10px] text-[#6A7097] uppercase">Route a hypothetical task (preview)</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <select className={input} value={form.taskClass} onChange={(e) => setForm({ ...form, taskClass: e.target.value })} aria-label="Task class">
            {taskClasses.map((c) => <option key={c.taskClassId} value={c.taskClassId}>{c.displayName}</option>)}
          </select>
          <select className={input} value={form.outputContract} onChange={(e) => setForm({ ...form, outputContract: e.target.value })} aria-label="Output contract">
            <option value="">contract: class default</option><option value="NARRATIVE">NARRATIVE</option><option value="LITERAL">LITERAL</option><option value="JSON_OBJECT">JSON_OBJECT</option>
          </select>
          <select className={input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} aria-label="Routing mode">
            {(policies?.modes || ['BEST_QUALIFIED']).filter((m: string) => !m.startsWith('PINNED')).map((m: string) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className={input} type="number" value={form.inputChars} onChange={(e) => setForm({ ...form, inputChars: Number(e.target.value) })} aria-label="Input characters" title="Input characters" />
          <input className={input} type="number" value={form.expectedOutputTokens} onChange={(e) => setForm({ ...form, expectedOutputTokens: Number(e.target.value) })} aria-label="Expected output tokens" title="Expected output tokens" />
          <select className={input} value={form.privacyClass} onChange={(e) => setForm({ ...form, privacyClass: e.target.value })} aria-label="Privacy">
            {['STANDARD', 'NO_TRAINING', 'ZERO_RETENTION', 'LOCAL_ONLY'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button className={btn} onClick={preview} disabled={!form.taskClass} data-testid="router-preview"><Play className="w-3 h-3 inline mr-1" />Preview route (nothing is sent)</button>
        {decision && (
          <div className="space-y-2" data-testid="router-decision">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={decision.outcome === 'SELECTED' ? 'success' : decision.outcome === 'GUARDIAN_REFUSED' ? 'error' : 'warning'}>{decision.outcome}</Badge>
              {decision.waitState && <TaskStatusBadge status={decision.waitState} />}
              <span className="text-[10px] text-[#8E94B8]">{decision.mode} · {decision.policy.policyId} v{decision.policy.version}</span>
            </div>
            {decision.selected && (
              <div className="text-[#C9CCE6]">
                version <span className="text-white">{decision.selected.canonicalVersionId ?? 'UNMAPPED'}</span> · route <span className="text-white">{decision.selected.providerId}/{decision.selected.modelId}</span> [{decision.selected.routeKind}] · deployment {decision.selected.deploymentId} · qualification {decision.selected.qualificationId}
              </div>
            )}
            <div className="text-[#C9CCE6]">{decision.explanation}</div>
            <CandidateTable candidates={decision.candidates} />
          </div>
        )}
      </div>

      {/* Policy */}
      {active && (
        <div className={box} data-testid="router-policy">
          <div className="flex items-center gap-2 mb-1"><Scale className="w-3.5 h-3.5 text-[#8C8AFF]" /><span className="text-white">Active policy {active.policyId} v{active.version}</span></div>
          <div className="text-[10px] text-[#C9CCE6]">weights: {Object.entries(active.weights).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
          <div className="text-[10px] text-[#8E94B8] mt-1">default mode {active.defaultMode} · default route kinds {active.defaultRouteKinds.join(', ')} · capacity warn {active.capacity.warnAt} / act {active.capacity.actAt} · evidence min samples {active.evidence.minSamples}</div>
          <div className="text-[10px] text-[#8E94B8] mt-1">versions: {(policies.policies || []).map((p: any) => `${p.version} ${p.status}${p.approvedBy ? ` (approved by ${p.approvedBy})` : ''}`).join(' · ')}</div>
        </div>
      )}

      {/* Workspace constraints */}
      <div className={`${box} space-y-2`}>
        <div className="text-[10px] text-[#6A7097] uppercase">Workspace routing constraints (a floor tasks cannot lower)</div>
        <div className="text-[10px] text-[#8E94B8]">Keys: mode, minQuality, minReliability, maxCostUsd, permittedProviders, permittedAggregators, regions, localOnly, directOnly, preferFree, prohibited, preferred, prohibitDeprecated, pinnedVersion, pinnedRoute.</div>
        <textarea className={`${input} w-full h-28`} value={constraintsText} onChange={(e) => setConstraintsText(e.target.value)} aria-label="Workspace routing constraints" />
        <button className={btn} onClick={saveConstraints}>Save constraints (workspace admin)</button>
      </div>

      {/* Paused tasks */}
      <div className={box} data-testid="router-paused">
        <div className="text-[10px] text-[#6A7097] uppercase mb-1"><PauseCircle className="w-3 h-3 inline mr-1" />Paused / reconciling tasks ({paused.length}) — paused is not failed</div>
        {paused.length === 0 ? <div className="text-[#7E8BB5]">None.</div> : paused.map((p) => (
          <div key={p.taskId} className="flex flex-wrap items-center gap-2 py-1 border-t border-[#141628]">
            <span className="text-white">{p.taskId}</span><TaskStatusBadge status={p.state} /><span className="text-[#8E94B8]">{p.taskClass}</span>
            <span className="text-[#C9CCE6]">{p.stateReason}</span>
          </div>
        ))}
      </div>

      {/* Evidence */}
      <div className={box} data-testid="router-evidence">
        <div className="text-[10px] text-[#6A7097] uppercase mb-1">Routing evidence (applied only when approved)</div>
        {evidence === null ? <div className="text-[#7E8BB5]">Platform-admin only.</div> : (
          <>
            <div className="text-[#C9CCE6]">{evidence.samples} verified-execution samples recorded.</div>
            <button className={`${btn} mt-1`} onClick={propose}>Propose route statistics</button>
            {(evidence.proposals || []).map((p: any) => (
              <div key={p.proposal_id} className="flex flex-wrap items-center gap-2 py-1 border-t border-[#141628] mt-1">
                <span className="text-white">{p.proposal_id}</span><Badge tone={p.status === 'APPROVED' ? 'success' : p.status === 'REJECTED' ? 'error' : 'inert'}>{p.status}</Badge>
                <span className="text-[#8E94B8]">{p.kind} · scope {p.workspace_scope} · by {p.proposed_by}</span>
                {p.status === 'PROPOSED' && <><button className={btn} onClick={() => decide(p.proposal_id, true)}>Approve</button><button className={btn} onClick={() => decide(p.proposal_id, false)}>Reject</button></>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
