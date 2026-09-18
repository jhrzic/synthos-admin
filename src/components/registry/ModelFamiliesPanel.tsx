import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitMerge, Upload, ShieldCheck, RefreshCw } from 'lucide-react';
import { Badge, type Tone } from '../verification/outcome';
import type { RegistryModel, RegistryProvider } from './useModelRegistry';
import { LocalRouteControls } from './LocalRouteControls';

// ---------------------------------------------------------------------------
// MODEL REGISTRY BY FAMILY — family → canonical version → routes.
//
// One canonical version may be reached by several routes (the publisher
// directly, an aggregator, a local runtime, a private deployment). An
// aggregator's id is never a new model: until an operator approves which
// version it serves, its offering is listed under "Unmapped / pending" and
// cannot run. Each route shows its kind, price (free is volatile unless
// guaranteed), capabilities, limits, deprecation, health, availability and
// its TASK qualifications (state, quality, reliability, expiry).
//
// Everything here reads the local registry. Route imports are metadata files
// an operator supplies; scheduled refresh is OFF unless switched on.
// ---------------------------------------------------------------------------

const box = 'p-3 bg-[#05060C] border border-[#1C2038] rounded-xl';
const btn = 'px-2 py-1 rounded-md text-[10px] font-mono border border-[#2D3352] text-[#C9CCE6] hover:border-[#615EFF] disabled:opacity-40';
const input = 'bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#615EFF]';
const qTone = (s: string): Tone => (s === 'VALID' ? 'success' : s === 'EXPIRED' || s === 'INVALIDATED' ? 'warning' : 'error');
const mapTone = (s: string): Tone => (['AUTHORITATIVE', 'APPROVED', 'IMPLICIT_PUBLISHER'].includes(s) ? 'success' : s === 'CONFLICT' ? 'error' : 'warning');

interface Props {
  workspaceId: string;
  models: RegistryModel[];
  providers: RegistryProvider[];
  onChanged: () => void;
}

export const ModelFamiliesPanel: React.FC<Props> = ({ workspaceId, models, providers, onChanged }) => {
  const [identity, setIdentity] = useState<any | null>(null);
  const [quals, setQuals] = useState<any[]>([]);
  const [imports, setImports] = useState<any | null>(null);
  const [taskClasses, setTaskClasses] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [importText, setImportText] = useState<Record<string, string>>({});
  const [mapForm, setMapForm] = useState<Record<string, { canonicalVersionId: string; familyId: string; publisher: string }>>({});
  const [qForm, setQForm] = useState({ route: '', taskClass: '', source: 'SANDBOX' });
  const [run, setRun] = useState<any | null>(null);

  const q = `workspaceId=${encodeURIComponent(workspaceId)}`;
  const load = useCallback(() => {
    fetch(`/api/registry/identity?${q}`).then((r) => r.json()).then((j) => j?.success && setIdentity(Array.isArray(j.routes) ? j : null)).catch(() => {});
    fetch(`/api/registry/qualifications?${q}`).then((r) => r.json()).then((j) => j?.success && setQuals(Array.isArray(j.qualifications) ? j.qualifications : [])).catch(() => {});
    fetch(`/api/registry/route-imports?${q}`).then((r) => r.json()).then((j) => j?.success && setImports(Array.isArray(j.importers) ? j : null)).catch(() => {});
    fetch(`/api/registry/task-classes?${q}`).then((r) => r.json()).then((j) => { if (j?.success && Array.isArray(j.taskClasses)) { setTaskClasses(j.taskClasses); setQForm((f) => (f.taskClass ? f : { ...f, taskClass: j.taskClasses[0]?.taskClassId || '' })); } }).catch(() => {});
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const call = async (url: string, body: any, method = 'POST') => {
    setMsg(null);
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, ...body }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? 'Done.' : `Refused: ${j?.error || j?.result?.error || `HTTP ${r.status}`}`);
    load(); onChanged();
    return j;
  };

  const byKey = useMemo(() => new Map(models.map((m) => [`${m.providerId}/${m.modelId}`, m])), [models]);
  const health = useMemo(() => new Map(providers.map((p) => [p.providerId, p.health])), [providers]);
  const routes: any[] = identity?.routes || [];
  const resolved = routes.filter((r) => r.resolved);
  const unresolved = routes.filter((r) => !r.resolved);
  const versionsWithRoutes = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of resolved) map.set(r.canonicalVersionId, [...(map.get(r.canonicalVersionId) || []), r]);
    return map;
  }, [resolved]);
  const unfamilied = [...versionsWithRoutes.keys()].filter((v) => !(identity?.families || []).some((f: any) => f.versions.some((x: any) => x.canonicalVersionId === v)));

  const RouteRow: React.FC<{ r: any }> = ({ r }) => {
    const m = byKey.get(`${r.providerId}/${r.modelId}`);
    const rq = quals.filter((x) => x.providerId === r.providerId && x.modelId === r.modelId);
    return (
      <div className="border-t border-[#141628] py-1.5 text-[10px]" data-testid="registry-route">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-white">{r.providerId}/{r.modelId}</span>
          <Badge tone="inert">{m?.routeKind ?? 'DIRECT'}</Badge>
          <Badge tone={mapTone(r.status)}>{r.status}</Badge>
          {m && <Badge tone={m.executable ? 'success' : 'inert'}>{m.availability}</Badge>}
          {m?.freeTier?.free && <Badge tone={m.freeTier.guaranteed ? 'success' : 'warning'}>{m.freeTier.guaranteed ? 'FREE' : 'FREE — VOLATILE'}</Badge>}
          <span className="text-[#8E94B8]">health {health.get(r.providerId) ?? 'UNKNOWN'}</span>
        </div>
        {m && (
          <div className="text-[#8E94B8] mt-0.5">
            price {m.pricing.current ? `${m.pricing.current.rates.input}/${m.pricing.current.rates.output} ${m.pricing.current.currency}/M ${m.pricing.current.unit} (${m.pricing.state})` : m.paid ? `UNKNOWN (${m.pricing.state})` : 'no charge'}
            {' '}· ctx {m.limits.contextTokens ?? 'UNKNOWN'} · out {m.limits.outputTokens ?? 'UNKNOWN'} · {m.capabilities.filter((c) => c.supported).map((c) => c.id).join(', ') || 'no capabilities declared'}
            {' '}· contracts {m.outputContracts.join('/')} · {m.lifecycle}{m.blockers.find((b) => b.state === 'DEPRECATED') ? ` · ${m.blockers.find((b) => b.state === 'DEPRECATED')!.reason}` : ''}
          </div>
        )}
        <div className="flex flex-wrap gap-1 mt-1">
          {rq.length === 0 ? <span className="text-[#7E8BB5]">Not qualified for any task class.</span> : rq.map((x) => (
            <Badge key={x.qualificationId} tone={qTone(x.state)} title={x.stateReasons.join('; ') || `expires ${x.expiresAt}`}>{x.taskClass} · {x.state} · q{Number(x.quality).toFixed(2)} r{Number(x.reliability).toFixed(2)} · until {String(x.expiresAt).slice(0, 10)}</Badge>
          ))}
        </div>
      </div>
    );
  };

  const importers: any[] = imports?.importers || [];
  const refresh = imports?.refresh;

  return (
    <div className="space-y-3 font-mono text-xs" data-testid="model-families">
      <div className="flex items-center gap-2">
        <GitMerge className="w-4 h-4 text-[#8C8AFF]" />
        <span className="text-white font-bold">Models by family · canonical version · route</span>
        <button className={btn} onClick={load}><RefreshCw className="w-3 h-3 inline" /></button>
      </div>
      {msg && <div className="text-[#C9CCE6]">{msg}</div>}

      {(identity?.families || []).map((f: any) => (
        <div key={f.familyId} className={box} data-testid="registry-family">
          <div className="text-white">{f.displayName} <span className="text-[#6A7097]">({f.familyId} · publisher {f.publisher})</span></div>
          {f.versions.map((v: any) => (
            <div key={v.canonicalVersionId} className="mt-2">
              <div className="text-[#C9CCE6]">{v.canonicalVersionId} <span className="text-[#6A7097]">· {v.lifecycle}{v.releaseDate ? ` · released ${v.releaseDate}` : ''} · defined by {v.definedBy}</span></div>
              {(versionsWithRoutes.get(v.canonicalVersionId) || []).map((r) => <RouteRow key={`${r.providerId}/${r.modelId}`} r={r} />)}
            </div>
          ))}
        </div>
      ))}
      {unfamilied.length > 0 && (
        <div className={box}>
          <div className="text-white">Versions without a declared family</div>
          {unfamilied.map((v) => (
            <div key={v} className="mt-2">
              <div className="text-[#C9CCE6]">{v}</div>
              {(versionsWithRoutes.get(v) || []).map((r) => <RouteRow key={`${r.providerId}/${r.modelId}`} r={r} />)}
            </div>
          ))}
        </div>
      )}

      {/* Unresolved */}
      <div className={box} data-testid="registry-unmapped">
        <div className="text-white">Unmapped / pending / conflicting route offerings ({unresolved.length}) — cannot run</div>
        {unresolved.map((r) => {
          const k = `${r.providerId}/${r.modelId}`;
          const f = mapForm[k] || { canonicalVersionId: r.proposedVersionId || '', familyId: '', publisher: '' };
          return (
            <div key={k} className="border-t border-[#141628] py-1.5">
              <RouteRow r={r} />
              <div className="text-[10px] text-[#8E94B8]">{r.reason}{r.proposedVersionId ? ` · proposes ${r.proposedVersionId}` : ''}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                <input className={input} placeholder="publisher/version" value={f.canonicalVersionId} onChange={(e) => setMapForm({ ...mapForm, [k]: { ...f, canonicalVersionId: e.target.value } })} aria-label="Canonical version" />
                <input className={input} placeholder="family id (new version only)" value={f.familyId} onChange={(e) => setMapForm({ ...mapForm, [k]: { ...f, familyId: e.target.value } })} aria-label="Family id" />
                <button className={btn} disabled={!f.canonicalVersionId} onClick={() => call('/api/registry/route-mappings/approve', { providerId: r.providerId, modelId: r.modelId, canonicalVersionId: f.canonicalVersionId, family: f.familyId ? { familyId: f.familyId, displayName: f.familyId, publisher: f.canonicalVersionId.split('/')[0] } : null })}>Approve mapping (audited)</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Route imports */}
      <div className={box} data-testid="route-imports">
        <div className="text-white flex items-center gap-2"><Upload className="w-3.5 h-3.5" />Route imports — metadata only, zero inference tokens</div>
        {importers.map((i) => (
          <div key={i.importerId} className="border-t border-[#141628] py-1.5 text-[10px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white">{i.importerId}</span>
              <Badge tone={i.state === 'CURRENT' ? 'success' : i.state === 'STALE' ? 'warning' : 'inert'}>{i.state}</Badge>
              <span className="text-[#8E94B8]">{i.offerings} offerings · last success {i.lastSuccessAt ?? 'never'}{i.lastError ? ` · last error: ${i.lastError}` : ''}</span>
            </div>
            <div className="text-[#6A7097]">{i.description}</div>
            <textarea className={`${input} w-full h-16 mt-1`} placeholder={i.importerId === 'signed-offline' ? 'Paste a signed registry manifest (JSON)' : "Paste the route's model-list document (JSON)"} value={importText[i.importerId] || ''} onChange={(e) => setImportText({ ...importText, [i.importerId]: e.target.value })} aria-label={`${i.importerId} document`} />
            <button className={`${btn} mt-1`} disabled={!importText[i.importerId]} onClick={() => { let payload: any; try { payload = JSON.parse(importText[i.importerId]); } catch { setMsg('The document is not valid JSON.'); return; } call(`/api/registry/route-imports/${encodeURIComponent(i.importerId)}`, { payload }); }}>Import (nothing is qualified or enabled)</button>
            {i.importerId !== 'signed-offline' && (
              <button className={`${btn} mt-1 ml-2`} data-testid={`route-pull-${i.importerId}`} onClick={() => call(`/api/registry/route-imports/${encodeURIComponent(i.importerId)}/refresh`, {})}>Pull once from the route (GET /models — needs manual discovery ON)</button>
            )}
          </div>
        ))}
        {refresh && (
          <div className="border-t border-[#141628] pt-1.5 text-[10px]" data-testid="route-refresh-settings">
            <span className="text-[#C9CCE6]">Scheduled refresh: </span>
            <Badge tone={refresh.enabled ? 'warning' : 'inert'}>{refresh.enabled ? `ON · every ${refresh.cadenceHours}h · ${refresh.importers.join(', ') || 'no importers'}` : 'OFF'}</Badge>
            <button className={`${btn} ml-2`} onClick={() => call('/api/registry/route-refresh', { enabled: !refresh.enabled, cadenceHours: refresh.cadenceHours, importers: refresh.importers.length ? refresh.importers : ['openrouter'] }, 'PUT')}>{refresh.enabled ? 'Switch off' : 'Switch on (GET /models, metadata only)'}</button>
          </div>
        )}
      </div>

      {/* Local route controls: substance, exact $0 price, qualification evidence, enablement, local execution */}
      <LocalRouteControls workspaceId={workspaceId} models={models} identityRoutes={routes} qualifications={quals} onChanged={() => { load(); onChanged(); }} />

      {/* Qualification */}
      <div className={`${box} space-y-2`} data-testid="qualification-runner">
        <div className="text-white flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" />Qualify a route for a task class</div>
        <div className="text-[10px] text-[#8E94B8]">Runs the class's evaluation suite through the canonical router, Guardian and the spend guard — each case gets a routing decision, a ledger row, an Aegis review and a signed receipt (paid calls need paid execution ON; a LOCAL $0 route needs local execution ON). A passed run qualifies nothing until an operator approves it with canary ledger evidence.</div>
        <div className="flex flex-wrap gap-1">
          <select className={input} value={qForm.route} onChange={(e) => setQForm({ ...qForm, route: e.target.value })} aria-label="Route">
            <option value="">route…</option>
            {models.map((m) => <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}|${m.modelId}`}>{m.providerId}/{m.modelId}</option>)}
          </select>
          <select className={input} value={qForm.taskClass} onChange={(e) => setQForm({ ...qForm, taskClass: e.target.value })} aria-label="Task class">
            {taskClasses.map((c) => <option key={c.taskClassId} value={c.taskClassId}>{c.taskClassId}</option>)}
          </select>
          <select className={input} value={qForm.source} onChange={(e) => setQForm({ ...qForm, source: e.target.value })} aria-label="Evidence source">
            <option value="SANDBOX">SANDBOX</option><option value="CANARY">CANARY</option>
          </select>
          <button className={btn} disabled={!qForm.route || !qForm.taskClass} onClick={async () => { const [providerId, modelId] = qForm.route.split('|'); const j = await call('/api/registry/qualifications/runs', { providerId, modelId, taskClass: qForm.taskClass }); if (j?.success) setRun({ runId: j.runId, status: 'OPEN' }); }}>Start run</button>
          {run && <>
            <button className={btn} onClick={async () => { const j = await call(`/api/registry/qualifications/runs/${run.runId}/execute`, { source: qForm.source }); if (j?.run) setRun({ ...j.run, refused: j.refused }); }}>Execute cases (once each, no retry)</button>
            <button className={btn} onClick={async () => { const j = await call(`/api/registry/qualifications/runs/${run.runId}/evaluate`, {}); if (j) setRun({ ...run, evaluation: j }); }}>Evaluate</button>
            <button className={btn} onClick={() => call(`/api/registry/qualifications/runs/${run.runId}/approve`, {})}>Approve qualification</button>
          </>}
        </div>
        {run && (
          <div className="text-[10px] text-[#C9CCE6]">
            run {run.runId} · {run.status ?? 'OPEN'} · {(run.results || []).length} results{run.refused?.length ? ` · ${run.refused.length} refused (${run.refused[0].reason})` : ''}
            {run.evaluation ? ` · ${run.evaluation.success ? `${run.evaluation.status} quality ${run.evaluation.quality} reliability ${run.evaluation.reliability}${run.evaluation.reasons?.length ? ` (${run.evaluation.reasons.join('; ')})` : ''}` : run.evaluation.error}` : ''}
          </div>
        )}
      </div>
    </div>
  );
};
