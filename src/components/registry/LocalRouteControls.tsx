import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { Badge } from '../verification/outcome';
import type { RegistryModel } from './useModelRegistry';

// ---------------------------------------------------------------------------
// LOCAL ROUTE CONTROLS — the Admin surface for controls that were API-only.
//
// Registry-driven: routes come from the registry (routeKind LOCAL), never a
// hardcoded model name. Before any change the exact provider / model /
// canonical version / deployment / substance hash is shown, and every change
// needs an explicit confirmation naming exactly what will change.
//
// Qualification, model enablement and execution permission are THREE
// SEPARATE AUTHORITIES. Changing one never changes another, and there is no
// bulk action. Every change goes through an authenticated, audited API.
// ---------------------------------------------------------------------------

const box = 'p-3 bg-[#05060C] border border-[#1C2038] rounded-xl';
const btn = 'px-2 py-1 rounded-md text-[10px] font-mono border border-[#2D3352] text-[#C9CCE6] hover:border-[#615EFF] disabled:opacity-40';

/** A state-changing button that needs a second, explicit confirmation naming the exact change. */
export const ConfirmButton: React.FC<{ label: string; confirmText: string; disabled?: boolean; testId: string; onConfirm: () => void }> = ({ label, confirmText, disabled, testId, onConfirm }) => {
  const [armed, setArmed] = useState(false);
  if (!armed) return <button className={btn} disabled={disabled} data-testid={testId} onClick={() => setArmed(true)}>{label}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 border border-[#E8A845]/50 rounded-md px-2 py-1" data-testid={`${testId}-confirm`}>
      <span className="text-[10px] text-[#E8A845]">Confirm: {confirmText}</span>
      <button className={btn} data-testid={`${testId}-yes`} onClick={() => { setArmed(false); onConfirm(); }}>Confirm</button>
      <button className={btn} data-testid={`${testId}-no`} onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
};

interface Props {
  workspaceId: string;
  models: RegistryModel[];
  identityRoutes: any[];
  qualifications: any[];
  onChanged: () => void;
}

export const LocalRouteControls: React.FC<Props> = ({ workspaceId, models, identityRoutes, qualifications, onChanged }) => {
  const local = useMemo(() => models.filter((m: any) => m.routeKind === 'LOCAL'), [models]);
  const [sel, setSel] = useState('');
  const [substance, setSubstance] = useState<any | null>(null);
  const [spend, setSpend] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const model: any = local.find((m) => `${m.providerId}/${m.modelId}` === sel) ?? null;
  const ident = model ? identityRoutes.find((r) => r.providerId === model.providerId && r.modelId === model.modelId) : null;
  const rq = model ? qualifications.filter((q) => q.providerId === model.providerId && q.modelId === model.modelId) : [];

  const loadSpend = useCallback(() => {
    fetch('/api/master-admin/spend').then((r) => r.json()).then((j) => j?.success && setSpend(j.status)).catch(() => {});
  }, []);
  // Read the (platform-admin) execution state only once an operator picks a
  // local route: the registry panel itself reads only /api/registry/*.
  useEffect(() => { setSubstance(null); if (sel) loadSpend(); }, [sel, loadSpend]);

  const post = async (url: string, body: any) => {
    setMsg(null);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, ...body }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? 'Done.' : `Refused: ${j?.error || `HTTP ${r.status}`}`);
    onChanged(); loadSpend();
  };
  const readSubstance = async () => {
    const r = await fetch(`/api/registry/local-substance?modelId=${encodeURIComponent(model.modelId)}`);
    setSubstance(await r.json().catch(() => ({ success: false, error: 'unreadable' })));
  };

  const price = model?.pricing?.current;
  const priceIsZero = !!price && price.rates?.input === 0 && price.rates?.output === 0 && price.rates?.cachedInput === 0 && !(price.tiers || []).length && !(price.toolCharges || []).length && !(price.modalityCharges || []).length;
  const enabled = model?.adminState === 'ENABLED';
  const localOn = spend?.policy?.localExecutionEnabled === true;
  const approvedHash = ident?.substanceHash ?? null;
  const target = model ? `${model.providerId}/${model.modelId} → ${ident?.canonicalVersionId ?? 'no canonical version'} @ default` : '';

  return (
    <div className={`${box} space-y-2 text-[10px]`} data-testid="local-route-controls">
      <div className="text-white flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" />Local route controls</div>
      <div className="flex gap-2 items-start text-[#E8A845]" data-testid="authority-separation-warning">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Qualification, model enablement and execution permission are separate authorities. Changing one never changes another: enabling a model does not switch local or paid execution on, and switching local execution on does not enable any model. There is no bulk action.</span>
      </div>
      <select className="bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1.5 text-xs text-white" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Local route" data-testid="local-route-select">
        <option value="">local route… ({local.length} in the registry)</option>
        {local.map((m: any) => <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>{m.providerId}/{m.modelId}</option>)}
      </select>

      {model && (
        <div className="space-y-2" data-testid="local-route-detail">
          <div className="font-mono text-[#C9CCE6]" data-testid="local-route-identity">
            provider {model.providerId} · model {model.modelId} · version {ident?.canonicalVersionId ?? 'UNMAPPED'} ({ident?.status ?? 'UNMAPPED'}) · deployment default · substance {approvedHash ?? 'NOT BOUND'}
          </div>

          {/* Substance */}
          <div className="border-t border-[#141628] pt-1.5" data-testid="substance-review">
            <div className="text-white">Model substance</div>
            <button className={btn} data-testid="substance-read" onClick={readSubstance}>Read current substance from disk (no inference)</button>
            {substance && (substance.success ? (
              <div className="font-mono text-[#8E94B8] mt-1" data-testid="substance-current">
                manifest {substance.substance.manifestDigest} · config {substance.substance.configDigest} · weights {substance.substance.weightsDigest} ({substance.substance.weightsBytes} bytes) · {substance.substance.format}/{substance.substance.family}/{substance.substance.parameterSize}/{substance.substance.quantization} · hash {substance.substanceHash}{' '}
                <Badge tone={substance.substanceHash === approvedHash ? 'success' : 'warning'}>{substance.substanceHash === approvedHash ? 'MATCHES APPROVED' : approvedHash ? 'DIFFERS FROM APPROVED' : 'NOT YET BOUND'}</Badge>
                {ident?.canonicalVersionId && substance.substanceHash !== approvedHash && (
                  <div className="mt-1">
                    <ConfirmButton testId="substance-bind" label="Bind this substance to the mapping" confirmText={`bind ${substance.substanceHash} to ${target}`}
                      onConfirm={() => post('/api/registry/route-mappings/approve', { providerId: model.providerId, modelId: model.modelId, canonicalVersionId: ident.canonicalVersionId, substance: substance.substance })} />
                  </div>
                )}
              </div>
            ) : <div className="text-[#FF6B6B]" data-testid="substance-error">{substance.error}</div>)}
          </div>

          {/* Price */}
          <div className="border-t border-[#141628] pt-1.5" data-testid="price-review">
            <div className="text-white">Local $0 price</div>
            <div className="font-mono text-[#8E94B8]" data-testid="price-current">
              {model.pricing?.versionKey ?? 'no price record'} · {model.pricing?.state} · input {price?.rates?.input ?? '?'} · cached {price?.rates?.cachedInput ?? 'UNSTATED'} · output {price?.rates?.output ?? '?'} · {price?.approval ?? ''}
            </div>
            <ConfirmButton testId="price-approve" label="Approve this exact $0 price" disabled={!price || price.approval === 'APPROVED' || !priceIsZero}
              confirmText={`approve ${model.pricing?.versionKey} for ${target}`}
              onConfirm={() => post('/api/registry/models/approve-local-price', { providerId: model.providerId, modelId: model.modelId, versionKey: model.pricing?.versionKey })} />
          </div>

          {/* Qualification evidence */}
          <div className="border-t border-[#141628] pt-1.5" data-testid="qualification-evidence">
            <div className="text-white">Qualifications ({rq.length})</div>
            {rq.length === 0 && <div className="text-[#6A7097]">None. A route runs only for a task class it is qualified for.</div>}
            {rq.map((q: any) => (
              <div key={q.qualificationId} className="font-mono text-[#8E94B8]" data-testid="qualification-row">
                {q.qualificationId} · {q.taskClass} · <Badge tone={q.state === 'VALID' ? 'success' : 'warning'}>{q.state}</Badge> · run {q.runId ?? 'none'} · suite {q.suite} · expires {q.expiresAt} · evidence {q.evidence?.usageIds?.length ?? 0} ledger rows / {q.evidence?.receiptIds?.length ?? 0} receipts{q.stateReasons?.length ? ` · ${q.stateReasons.join('; ')}` : ''}
              </div>
            ))}
          </div>

          {/* Enablement */}
          <div className="border-t border-[#141628] pt-1.5" data-testid="model-enablement">
            <div className="text-white">Model enablement: <Badge tone={enabled ? 'success' : 'inert'}>{enabled ? 'ENABLED' : 'DISABLED'}</Badge></div>
            {enabled
              ? <ConfirmButton testId="model-disable" label="Disable this model" confirmText={`disable ${target}`} onConfirm={() => post('/api/registry/models/action', { providerId: model.providerId, modelId: model.modelId, action: 'DISABLE', reason: 'operator: disabled from Local route controls' })} />
              : <ConfirmButton testId="model-enable" label="Enable this model (only this route)" confirmText={`enable ${target} — local execution stays ${localOn ? 'ON' : 'OFF'}`} onConfirm={() => post('/api/registry/models/action', { providerId: model.providerId, modelId: model.modelId, action: 'ENABLE' })} />}
          </div>
        </div>
      )}

      {/* Execution permission (global; independent of any model) — shown once a local route is selected */}
      {model && <div className="border-t border-[#141628] pt-1.5" data-testid="local-execution-switch">
        <div className="text-white">Local $0 execution: <Badge tone={localOn ? 'warning' : 'inert'}>{spend ? (localOn ? 'ON' : 'OFF') : 'UNKNOWN'}</Badge> · paid execution: <Badge tone={spend?.policy?.paidExecutionEnabled ? 'warning' : 'inert'}>{spend ? (spend.policy.paidExecutionEnabled ? 'ON' : 'OFF') : 'UNKNOWN'}</Badge></div>
        <ConfirmButton testId="local-execution-toggle" label={localOn ? 'Switch local execution OFF' : 'Switch local execution ON'} disabled={!spend}
          confirmText={`switch local $0 execution ${localOn ? 'OFF' : 'ON'} — no model is enabled or disabled by this`}
          onConfirm={() => post('/api/master-admin/spend/kill', { scope: 'local-execution', enabled: !localOn })} />
      </div>}
      {msg && <div className="text-[#8E94B8]" data-testid="local-route-msg">{msg}</div>}
    </div>
  );
};
