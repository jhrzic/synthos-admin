import React, { useMemo, useState } from 'react';
import { useModelRegistry, modelKey, type RegistryModel } from './useModelRegistry';

// ---------------------------------------------------------------------------
// REGISTRY MODEL SELECT — the one model selector.
//
// Every option comes from the persisted local registry. This component holds
// no model names, no provider names and no provider-specific logic: a model
// installed by a plugin, a signed manifest or an Admin registration appears
// here with no code change. Models that cannot run are listed, disabled, with
// the registry's own reason — never hidden, never guessed.
//
// The value is the canonical `provider/model` id, which propagates unchanged
// to the task, the spend guard, the ledger, Aegis and the receipt.
// ---------------------------------------------------------------------------

export interface RegistryModelSelectProps {
  workspaceId: string | undefined;
  value: string;
  onChange: (canonicalId: string, model: RegistryModel | null) => void;
  /** The task's output contract — models that do not declare it are disabled. */
  outputContract?: 'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT';
  /** Show the filter bar (provider / capability / modality / availability / pricing / health). */
  showFilters?: boolean;
  /** Let a non-executable model be chosen (e.g. to record intent before an admin enables it). Default false. */
  allowUnavailable?: boolean;
  label?: string;
  id?: string;
  className?: string;
}

const inputCls = 'bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#615EFF]';

export function reasonFor(m: RegistryModel): string {
  if (m.executable) return m.availability === 'AVAILABLE' ? 'available' : `${m.availability.toLowerCase()} — ${m.blockers[0]?.reason ?? ''}`;
  const b = m.blockers.find((x) => x.state !== 'DEPRECATED' && x.state !== 'DEGRADED') ?? m.blockers[0];
  return `${m.availability}${b ? ` — ${b.reason}` : ''}`;
}

export function filterRegistryModels(models: RegistryModel[], f: { provider: string; capability: string; modality: string; availability: string; pricing: string; health: string; workspace: string }, providerHealth: Record<string, string>): RegistryModel[] {
  return models.filter((m) =>
    (!f.provider || m.providerId === f.provider)
    && (!f.capability || m.capabilities.some((c) => c.id === f.capability && c.supported))
    && (!f.modality || m.modalities.input.includes(f.modality) || m.modalities.output.includes(f.modality))
    && (!f.availability || (f.availability === 'EXECUTABLE' ? m.executable : m.availability === f.availability))
    && (!f.pricing || m.pricing.state === f.pricing)
    && (!f.health || providerHealth[m.providerId] === f.health)
    && (!f.workspace || (f.workspace === 'PERMITTED' ? !m.blockers.some((b) => /workspace/.test(b.reason)) : m.blockers.some((b) => /workspace/.test(b.reason)))));
}

export const RegistryModelSelect: React.FC<RegistryModelSelectProps> = ({ workspaceId, value, onChange, outputContract, showFilters = false, allowUnavailable = false, label, id, className }) => {
  const reg = useModelRegistry(workspaceId, { outputContract });
  const [f, setF] = useState({ provider: '', capability: '', modality: '', availability: '', pricing: '', health: '', workspace: '' });
  const health = useMemo(() => Object.fromEntries(reg.providers.map((p) => [p.providerId, p.health])), [reg.providers]);
  const visible = useMemo(() => filterRegistryModels(reg.models, f, health), [reg.models, f, health]);
  const byProvider = useMemo(() => {
    const groups = new Map<string, RegistryModel[]>();
    for (const m of visible) {
      const k = m.providerDisplayName || m.providerId;
      groups.set(k, [...(groups.get(k) || []), m]);
    }
    // Executable first inside each group, then by name — the data decides, not a list.
    for (const [k, list] of groups) groups.set(k, [...list].sort((a, b) => Number(b.executable) - Number(a.executable) || a.displayName.localeCompare(b.displayName)));
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);
  const opts = (xs: string[]) => [...new Set(xs)].filter(Boolean).sort();
  const capabilities = opts(reg.models.flatMap((m) => m.capabilities.filter((c) => c.supported).map((c) => c.id)));
  const modalities = opts(reg.models.flatMap((m) => [...m.modalities.input, ...m.modalities.output]));
  const executableCount = reg.models.filter((m) => m.executable).length;
  const selected = reg.models.find((m) => modelKey(m) === value) || null;

  return (
    <div className={`space-y-1.5 ${className || ''}`} data-testid="registry-model-select">
      {label && <label htmlFor={id} className="text-[10px] font-mono uppercase text-[#8E94B8] block">{label}</label>}
      {showFilters && (
        <div className="flex flex-wrap gap-1.5">
          <select aria-label="Provider" className={inputCls} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
            <option value="">All providers</option>
            {reg.providers.map((p) => <option key={p.providerId} value={p.providerId}>{p.displayName}</option>)}
          </select>
          <select aria-label="Capability" className={inputCls} value={f.capability} onChange={(e) => setF({ ...f, capability: e.target.value })}>
            <option value="">Any capability</option>
            {capabilities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Modality" className={inputCls} value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value })}>
            <option value="">Any modality</option>
            {modalities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Availability" className={inputCls} value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })}>
            <option value="">Any state</option>
            <option value="EXECUTABLE">Executable now</option>
            {reg.states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Pricing" className={inputCls} value={f.pricing} onChange={(e) => setF({ ...f, pricing: e.target.value })}>
            <option value="">Any pricing</option>
            {['CURRENT', 'STALE', 'MISSING', 'CONFLICTING', 'NOT_APPROVED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Health" className={inputCls} value={f.health} onChange={(e) => setF({ ...f, health: e.target.value })}>
            <option value="">Any health</option>
            {['OK', 'DEGRADED', 'UNKNOWN'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Workspace permission" className={inputCls} value={f.workspace} onChange={(e) => setF({ ...f, workspace: e.target.value })}>
            <option value="">Any permission</option>
            <option value="PERMITTED">Workspace permits</option>
            <option value="DENIED">Workspace denies</option>
          </select>
        </div>
      )}
      <select
        id={id}
        className={`${inputCls} w-full`}
        value={value}
        onChange={(e) => onChange(e.target.value, reg.models.find((m) => modelKey(m) === e.target.value) || null)}
        disabled={reg.loading}
      >
        <option value="">{reg.loading ? 'Loading the model registry…' : reg.error ? `Registry unavailable: ${reg.error}` : executableCount === 0 ? 'No model can run yet — see reasons below' : 'Select a model…'}</option>
        {value && !selected && !reg.loading && <option value={value}>{value} — not in the registry</option>}
        {byProvider.map(([provider, list]) => (
          <optgroup key={provider} label={`${provider} (${list.filter((m) => m.executable).length}/${list.length} executable)`}>
            {list.map((m) => (
              <option key={modelKey(m)} value={modelKey(m)} disabled={!m.executable && !allowUnavailable} title={reasonFor(m)}>
                {m.displayName}{m.displayName !== m.modelId ? ` · ${m.modelId}` : ''} — {m.executable ? m.availability : reasonFor(m)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected && (
        <div className="text-[10px] font-mono text-[#8E94B8]" data-testid="registry-model-selected">
          {modelKey(selected)} · {selected.availability}{!selected.executable ? ` — ${reasonFor(selected)}` : ''}
          {selected.pricing.current ? ` · ${selected.pricing.current.rates.input}/${selected.pricing.current.rates.output} ${selected.pricing.current.currency} per 1M ${selected.pricing.current.unit} (${selected.pricing.state})` : ` · pricing ${selected.pricing.state}`}
        </div>
      )}
    </div>
  );
};

export default RegistryModelSelect;
