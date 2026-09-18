import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, RefreshCw, ShieldCheck, History, Upload, KeyRound, Search } from 'lucide-react';
import { useModelRegistry, modelKey, type RegistryModel } from './registry/useModelRegistry';
import { filterRegistryModels } from './registry/RegistryModelSelect';

// ---------------------------------------------------------------------------
// MODEL REGISTRY — provider → models, from the persisted local registry.
//
// Same place in the Admin as the old provider/model catalog (kept, rewired):
// that view read a hardcoded documented list plus provider model-list polls.
// This one reads ONLY GET /api/registry/models — installed provider plugins,
// signed manifest imports and Admin registrations — so a new model appears here
// with no code change, and rendering it contacts no provider.
//
// Installation is not permission. Each model shows its admin state
// (INSTALLED / QUALIFIED / ENABLED / DISABLED), its computed availability, and
// every blocker with the registry's own reason. Qualify / enable / disable are
// explicit, audited platform-admin actions.
// ---------------------------------------------------------------------------

const TONE: Record<string, string> = {
  AVAILABLE: 'text-[#00D26A] border-[#00D26A]/40 bg-[#00D26A]/10',
  DEPRECATED: 'text-[#E8A845] border-[#E8A845]/40 bg-[#E8A845]/10',
  DEGRADED: 'text-[#E8A845] border-[#E8A845]/40 bg-[#E8A845]/10',
  PRICE_STALE: 'text-[#E8A845] border-[#E8A845]/40 bg-[#E8A845]/10',
  REMOVED: 'text-[#FF6B6B] border-[#FF6B6B]/40 bg-[#FF6B6B]/10',
  DISABLED: 'text-[#FF6B6B] border-[#FF6B6B]/40 bg-[#FF6B6B]/10',
  POLICY_BLOCKED: 'text-[#FF6B6B] border-[#FF6B6B]/40 bg-[#FF6B6B]/10',
};
const tone = (s: string) => TONE[s] || 'text-[#7E8BB5] border-[#7E8BB5]/30 bg-[#7E8BB5]/10';
const btn = 'px-2 py-1 rounded-md text-[10px] font-mono border border-[#2D3352] text-[#C9CCE6] hover:border-[#615EFF] disabled:opacity-40';
const input = 'bg-[#080A16] border border-[#1E223D] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#615EFF]';

interface Props {
  workspaceId: string;
  /** Pre-filter to one registry provider (e.g. from a provider seat dashboard). */
  providerId?: string;
}

export const ProviderModelCatalog: React.FC<Props> = ({ workspaceId, providerId }) => {
  const reg = useModelRegistry(workspaceId);
  const [f, setF] = useState({ provider: providerId || '', capability: '', modality: '', availability: '', pricing: '', health: '', workspace: '' });
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, any[]>>({});
  const [admin, setAdmin] = useState<any | null>(null);
  const [adminDenied, setAdminDenied] = useState(false);
  const [manifestText, setManifestText] = useState('');
  const [registerProvider, setRegisterProvider] = useState('');
  const [registerText, setRegisterText] = useState('');
  const [keyForm, setKeyForm] = useState({ keyId: '', label: '', pem: '' });
  const [policyText, setPolicyText] = useState<{ mode: string; allowed: string; denied: string } | null>(null);
  const [priceProvider, setPriceProvider] = useState('');

  useEffect(() => { setF((x) => ({ ...x, provider: providerId || '' })); }, [providerId]);

  const loadAdmin = useCallback(() => {
    fetch('/api/registry/admin').then(async (r) => {
      if (r.status === 403 || r.status === 401) { setAdminDenied(true); return; }
      const j = await r.json().catch(() => null);
      if (j?.success) setAdmin(j);
    }).catch(() => setAdminDenied(true));
  }, []);
  useEffect(() => { loadAdmin(); }, [loadAdmin]);

  useEffect(() => {
    if (reg.workspacePolicy && policyText === null) {
      setPolicyText({ mode: reg.workspacePolicy.mode, allowed: reg.workspacePolicy.allowed.join('\n'), denied: reg.workspacePolicy.denied.join('\n') });
    }
  }, [reg.workspacePolicy, policyText]);

  const health = useMemo(() => Object.fromEntries(reg.providers.map((p) => [p.providerId, p.health])), [reg.providers]);
  const visible = useMemo(() => filterRegistryModels(reg.models, f, health)
    .filter((m) => !q || `${m.displayName} ${m.modelId} ${m.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase())), [reg.models, f, health, q]);

  const post = async (url: string, body: any, method = 'POST') => {
    setMsg(null);
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, ...body }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) setMsg(`Refused: ${j?.error || j?.result?.errors?.join('; ') || `HTTP ${r.status}`}`);
    else setMsg('Done.');
    reg.reload(); loadAdmin();
    return j;
  };

  const act = (m: RegistryModel, action: 'QUALIFY' | 'ENABLE' | 'DISABLE') =>
    post('/api/registry/models/action', { providerId: m.providerId, modelId: m.modelId, action, reason: action === 'DISABLE' ? 'Disabled from the Admin model registry' : undefined });

  const toggleHistory = async (m: RegistryModel) => {
    const k = modelKey(m);
    if (history[k]) { const { [k]: _, ...rest } = history; setHistory(rest); return; }
    const r = await fetch(`/api/registry/history?workspaceId=${encodeURIComponent(workspaceId)}&providerId=${encodeURIComponent(m.providerId)}&modelId=${encodeURIComponent(m.modelId)}`);
    const j = await r.json().catch(() => null);
    setHistory({ ...history, [k]: j?.history || [] });
  };

  const opts = (xs: string[]) => [...new Set(xs)].filter(Boolean).sort();

  return (
    <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5 space-y-4 font-mono" data-testid="model-registry">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#8C8AFF]" />
          <span className="text-sm font-bold text-white font-['Space_Grotesk']">Model Registry</span>
          <span className="text-[10px] text-[#6A7097]">local · manifest-driven · 0 provider calls to render</span>
        </div>
        <button className={btn} onClick={() => { reg.reload(); loadAdmin(); }}><RefreshCw className="w-3 h-3 inline mr-1" />Reload from registry</button>
      </div>
      {reg.error && <div className="text-xs text-[#FF6B6B]">Registry unavailable: {reg.error}</div>}
      {msg && <div className="text-xs text-[#C9CCE6]">{msg}</div>}

      {/* Providers */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] text-left">
          <thead className="text-[#6A7097]"><tr><th className="py-1 pr-2">Provider</th><th className="pr-2">Protocol / adapter</th><th className="pr-2">Manifest</th><th className="pr-2">Endpoint</th><th className="pr-2">Credential</th><th className="pr-2">Models</th><th>Health</th></tr></thead>
          <tbody>
            {reg.providers.filter((p) => !providerId || p.providerId === providerId).map((p) => (
              <tr key={p.providerId} className="border-t border-[#141628] text-[#C9CCE6]">
                <td className="py-1 pr-2 text-white">{p.displayName} <span className="text-[#6A7097]">({p.providerId})</span></td>
                <td className="pr-2">{p.protocol} · {p.adapterDispatch}</td>
                <td className="pr-2">{p.manifestVersion} · {p.source}</td>
                <td className="pr-2">{p.endpoint.ok ? `${p.endpoint.host}${p.endpoint.overridden ? ' (override)' : ''}` : <span className="text-[#FF6B6B]">REFUSED — {p.endpoint.reason}</span>}</td>
                <td className="pr-2">{p.credential.ready ? `ready (${p.credential.source})` : 'NOT_CONFIGURED'}</td>
                <td className="pr-2">{p.executableCount}/{p.modelCount} executable</td>
                <td>{p.health}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <Search className="w-3 h-3 text-[#6A7097]" />
        <input aria-label="Search models" className={input} placeholder="search id / name / alias" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Provider filter" className={input} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
          <option value="">All providers</option>
          {reg.providers.map((p) => <option key={p.providerId} value={p.providerId}>{p.displayName}</option>)}
        </select>
        <select aria-label="Capability filter" className={input} value={f.capability} onChange={(e) => setF({ ...f, capability: e.target.value })}>
          <option value="">Any capability</option>
          {opts(reg.models.flatMap((m) => m.capabilities.filter((c) => c.supported).map((c) => c.id))).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Modality filter" className={input} value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value })}>
          <option value="">Any modality</option>
          {opts(reg.models.flatMap((m) => [...m.modalities.input, ...m.modalities.output])).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Availability filter" className={input} value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })}>
          <option value="">Any state</option>
          <option value="EXECUTABLE">Executable now</option>
          {reg.states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Pricing filter" className={input} value={f.pricing} onChange={(e) => setF({ ...f, pricing: e.target.value })}>
          <option value="">Any pricing</option>
          {['CURRENT', 'STALE', 'MISSING', 'CONFLICTING', 'NOT_APPROVED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Health filter" className={input} value={f.health} onChange={(e) => setF({ ...f, health: e.target.value })}>
          <option value="">Any health</option>
          {['OK', 'DEGRADED', 'UNKNOWN'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Workspace filter" className={input} value={f.workspace} onChange={(e) => setF({ ...f, workspace: e.target.value })}>
          <option value="">Any permission</option>
          <option value="PERMITTED">Workspace permits</option>
          <option value="DENIED">Workspace denies</option>
        </select>
        <span className="text-[10px] text-[#6A7097]">{visible.length} of {reg.models.length}</span>
      </div>

      {/* Models */}
      <div className="space-y-1 max-h-[480px] overflow-y-auto">
        {visible.map((m) => {
          const k = modelKey(m);
          return (
            <div key={k} className="border border-[#141628] rounded-lg p-2 text-[10px] text-[#C9CCE6]" data-testid="registry-model-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded border font-bold ${tone(m.availability)}`}>{m.availability}</span>
                <span className="text-white font-bold">{m.displayName}</span>
                <span className="text-[#6A7097]">{k}{m.aliases.length ? ` · aliases ${m.aliases.join(', ')}` : ''}</span>
                <span className="text-[#6A7097]">admin: {m.adminState}</span>
                <span className="text-[#6A7097]">pricing: {m.pricing.state}{m.pricing.current ? ` · ${m.pricing.current.rates.input}/${m.pricing.current.rates.output} ${m.pricing.current.currency}/1M ${m.pricing.current.unit} · stale after ${m.pricing.current.staleAfter.slice(0, 10)}` : ''}</span>
                <span className="ml-auto flex gap-1">
                  {!adminDenied && <>
                    <button className={btn} onClick={() => act(m, 'QUALIFY')}>Qualify</button>
                    <button className={btn} onClick={() => act(m, 'ENABLE')}>Enable</button>
                    <button className={btn} onClick={() => act(m, 'DISABLE')}>Disable</button>
                  </>}
                  <button className={btn} onClick={() => toggleHistory(m)}><History className="w-3 h-3 inline" /></button>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {m.capabilities.map((c) => (
                  <span key={c.id} title={`${c.verification} · ${c.source}`} className={`px-1 rounded border ${c.id.startsWith('x.') ? 'border-[#8C8AFF]/40 text-[#8C8AFF]' : 'border-[#2D3352]'} ${c.supported ? '' : 'line-through opacity-60'}`}>{c.id}</span>
                ))}
                {m.capabilities.length === 0 && <span className="text-[#6A7097]">no capabilities declared</span>}
                <span className="text-[#6A7097]">in: {m.modalities.input.join(', ') || '—'} · out: {m.modalities.output.join(', ') || '—'} · contracts: {m.outputContracts.join(', ') || '—'} · context {m.limits.contextTokens ?? 'UNKNOWN'} · output {m.limits.outputTokens ?? 'UNKNOWN'}</span>
              </div>
              {!m.executable && <div className="mt-1 text-[#8E94B8]">Why not executable: {m.blockers.filter((b) => b.state !== 'DEPRECATED' && b.state !== 'DEGRADED').map((b) => `${b.state}: ${b.reason}`).join(' · ')}</div>}
              {m.executable && m.blockers.length > 0 && <div className="mt-1 text-[#E8A845]">{m.blockers.map((b) => `${b.state}: ${b.reason}`).join(' · ')}</div>}
              {history[k] && (
                <div className="mt-1 text-[#6A7097]">{history[k].length === 0 ? 'No history.' : history[k].map((h: any) => `${h.createdAt.slice(0, 19)} ${h.changeType} ${h.manifestVersion} ${h.recordHash.slice(0, 10)}`).join(' | ')}</div>
              )}
            </div>
          );
        })}
        {!reg.loading && visible.length === 0 && <div className="text-xs text-[#6A7097]">No registered model matches.</div>}
      </div>

      {/* Workspace policy */}
      {policyText && (
        <div className="border-t border-[#141628] pt-3 space-y-1.5">
          <div className="text-xs text-white font-bold">Workspace model policy — {workspaceId}</div>
          <div className="flex gap-3 text-[10px] text-[#C9CCE6]">
            {['INHERIT', 'ALLOWLIST'].map((mode) => (
              <label key={mode}><input type="radio" checked={policyText.mode === mode} onChange={() => setPolicyText({ ...policyText, mode })} /> {mode === 'INHERIT' ? 'Every platform-enabled model' : 'Only the allowed list'}</label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <textarea aria-label="Allowed models" className={`${input} h-16`} placeholder="provider/model per line" value={policyText.allowed} onChange={(e) => setPolicyText({ ...policyText, allowed: e.target.value })} />
            <textarea aria-label="Denied models" className={`${input} h-16`} placeholder="provider/model per line (always wins)" value={policyText.denied} onChange={(e) => setPolicyText({ ...policyText, denied: e.target.value })} />
          </div>
          <button className={btn} onClick={() => post('/api/registry/workspace-policy', { mode: policyText.mode, allowed: policyText.allowed.split('\n').map((x) => x.trim()).filter(Boolean), denied: policyText.denied.split('\n').map((x) => x.trim()).filter(Boolean) }, 'PUT')}>Save workspace policy</button>
        </div>
      )}

      {/* Platform-admin tools */}
      {adminDenied ? (
        <div className="text-[10px] text-[#6A7097] border-t border-[#141628] pt-3">Qualification, enablement, imports and discovery are platform-admin actions.</div>
      ) : admin && (
        <div className="border-t border-[#141628] pt-3 grid md:grid-cols-2 gap-3 text-[10px] text-[#C9CCE6]">
          <div className="space-y-1.5">
            <div className="text-xs text-white font-bold"><Upload className="w-3 h-3 inline mr-1" />Import a signed manifest</div>
            <textarea aria-label="Signed manifest JSON" className={`${input} h-24 w-full`} placeholder='{"schemaVersion":"synthos.registry/v1", …, "signature":{…}}' value={manifestText} onChange={(e) => setManifestText(e.target.value)} />
            <button className={btn} onClick={() => { try { post('/api/registry/import', { manifest: JSON.parse(manifestText) }); } catch { setMsg('That is not valid JSON.'); } }}>Import (signature required)</button>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-white font-bold">Register one model (same schema)</div>
            <select aria-label="Register under provider" className={input} value={registerProvider} onChange={(e) => setRegisterProvider(e.target.value)}>
              <option value="">Provider…</option>
              {reg.providers.map((p) => <option key={p.providerId} value={p.providerId}>{p.displayName}</option>)}
            </select>
            <textarea aria-label="Model manifest JSON" className={`${input} h-20 w-full`} placeholder='{"modelId": …, "capabilities": […], "pricing": […], …}' value={registerText} onChange={(e) => setRegisterText(e.target.value)} />
            <button className={btn} disabled={!registerProvider} onClick={() => { try { post('/api/registry/models', { providerId: registerProvider, model: JSON.parse(registerText) }); } catch { setMsg('That is not valid JSON.'); } }}>Register (lands UNQUALIFIED)</button>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-white font-bold"><KeyRound className="w-3 h-3 inline mr-1" />Trusted manifest signing keys</div>
            {admin.trustedKeys.length === 0 ? <div className="text-[#6A7097]">None — signed imports are refused until one is added.</div> : admin.trustedKeys.map((k: any) => <div key={k.keyId}>{k.keyId} · {k.label}</div>)}
            <input aria-label="Key id" className={input} placeholder="key id" value={keyForm.keyId} onChange={(e) => setKeyForm({ ...keyForm, keyId: e.target.value })} />
            <input aria-label="Key label" className={input} placeholder="label" value={keyForm.label} onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })} />
            <textarea aria-label="Public key PEM" className={`${input} h-14 w-full`} placeholder="-----BEGIN PUBLIC KEY-----" value={keyForm.pem} onChange={(e) => setKeyForm({ ...keyForm, pem: e.target.value })} />
            <button className={btn} onClick={() => post('/api/registry/trusted-keys', { keyId: keyForm.keyId, label: keyForm.label, publicKeyPem: keyForm.pem })}>Add trusted key</button>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-white font-bold"><ShieldCheck className="w-3 h-3 inline mr-1" />Manual discovery (OFF by default)</div>
            <div>Discovery reads provider model lists (metadata only, never inference). New ids become UNQUALIFIED candidates, never executable models. Nothing runs at startup or on a timer.</div>
            <label><input type="checkbox" checked={!!admin.manualDiscoveryEnabled} onChange={(e) => post('/api/registry/discovery', { enabled: e.target.checked })} /> Manual discovery enabled</label>
            <div className="flex gap-1">
              <button className={btn} disabled={!admin.manualDiscoveryEnabled} onClick={() => post('/api/models/refresh', {})}>Run discovery once</button>
            </div>
            <div>Candidates: {admin.discoveryCandidates.length === 0 ? 'none' : admin.discoveryCandidates.map((c: any) => `${c.providerId}/${c.modelId}`).join(', ')}</div>
            <div className="pt-1">Apply the last manual pricing refresh to a provider (changed models become UNQUALIFIED):</div>
            <select aria-label="Apply prices provider" className={input} value={priceProvider} onChange={(e) => setPriceProvider(e.target.value)}>
              <option value="">Provider…</option>
              {reg.providers.map((p) => <option key={p.providerId} value={p.providerId}>{p.displayName}</option>)}
            </select>
            <button className={btn} disabled={!priceProvider} onClick={() => post('/api/registry/apply-catalog-prices', { providerId: priceProvider })}>Apply prices</button>
          </div>
          <div className="md:col-span-2 space-y-0.5">
            <div className="text-xs text-white font-bold">Recent imports</div>
            {admin.imports.slice(0, 8).map((i: any) => (
              <div key={i.import_id}>{i.created_at.slice(0, 19)} · {i.source} · {i.provider_id} · {i.manifest_version} · {i.outcome} · signature {i.signature_status}{i.detail?.errors?.length ? ` · ${i.detail.errors[0]}` : ''}</div>
            ))}
          </div>
        </div>
      )}
      {reg.models.length > 0 && <div className="text-[10px] text-[#6A7097]">{reg.models.filter((m) => m.executable).length} of {reg.models.length} registered models can execute now.</div>}
    </div>
  );
};

export default ProviderModelCatalog;
