import React, { useCallback, useEffect, useState } from 'react';
import { Power, Wallet, AlertTriangle, Loader2, Gauge, ListChecks, ShieldAlert, Plus, Trash2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Master Admin → Spend Control.
//
// Every figure comes from the usage ledger (GET /api/master-admin/spend).
// Dollars are split into ACTUAL (from provider-reported tokens) and
// ESTIMATE-ONLY (rows the provider did not report usage for) — an estimate is
// never shown as an invoice. Every control is a platform_admin route, audited
// server-side, effective on the next paid call. Nothing here calls a provider.
// ---------------------------------------------------------------------------

type Policy = any;

const usd = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(4)}` : 'UNKNOWN');
const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI', gemini: 'Gemini', antigravity: 'Antigravity', openai_tts: 'OpenAI speech', elevenlabs: 'ElevenLabs', fish_audio: 'Fish Audio',
};

function Card({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#05060C] border border-[#1A1E36] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[#8E94B8]"><Icon className="w-3.5 h-3.5" /> {title}</div>
      {children}
    </div>
  );
}

function Num({ label, value, onChange, step = 0.01 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-[#C9CCE3]">
      <span>{label}</span>
      <input
        type="number" min={0} step={step} value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white font-mono text-right focus:outline-none focus:border-[#615EFF]"
      />
    </label>
  );
}

export function SpendControlPanel() {
  const [status, setStatus] = useState<any | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState({ provider: 'openai', model: '', unit: 'tokens', inputPerMillion: 0, outputPerMillion: 0, cachedInputPerMillion: '' as string | number });

  const apply = (json: any) => { if (json?.status) { setStatus(json.status); setDraft(JSON.parse(JSON.stringify(json.status.policy))); } };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/master-admin/spend');
      if (res.status === 403) throw new Error('Platform administrator role required.');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to read spend status.');
      apply(json); setError(null);
    } catch (e: any) { setError(e?.message || 'Failed to read spend status.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (url: string, body: unknown, tag: string) => {
    setBusy(tag); setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      apply(json);
      if (!res.ok || !json?.success) setError([json?.error, ...(json?.errors || [])].filter(Boolean).join(' · ') || `HTTP ${res.status}`);
    } catch (e: any) { setError(e?.message || 'Request failed.'); } finally { setBusy(null); }
  };

  if (!status || !draft) {
    return <div className="p-6 text-xs font-mono text-[#8E94B8]">{error ? <span className="text-[#FF6B6B]">{error}</span> : <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading spend ledger…</span>}</div>;
  }

  const set = (path: string[], v: any) => {
    const next = JSON.parse(JSON.stringify(draft));
    let o = next; for (const k of path.slice(0, -1)) o = o[k];
    o[path[path.length - 1]] = v; setDraft(next);
  };
  const master = status.policy.paidExecutionEnabled;

  return (
    <div className="space-y-4">
      {error && <div className="p-3 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}

      <Card icon={Power} title="Kill switches — new dispatches stop immediately">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className={`font-mono text-sm font-bold ${master ? 'text-[#5FE3A1]' : 'text-[#FF6B6B]'}`}>PAID EXECUTION {master ? 'ON' : 'OFF'}</div>
            <p className="text-[11px] text-[#6A7097]">Off means no paid provider request leaves the process. In-flight calls are not cut off mid-request.</p>
          </div>
          <button disabled={busy === 'kill-all'} onClick={() => post('/api/master-admin/spend/kill', { scope: 'all', enabled: !master }, 'kill-all')}
            className={`text-[11px] font-mono font-bold px-3 py-2 rounded-md ${master ? 'bg-[#FF6B6B] text-white' : 'border border-[#2A2F52] text-white hover:border-[#615EFF]'}`}>
            {master ? 'Disable all paid execution' : 'Enable paid execution'}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {status.providers.map((p: any) => (
            <button key={p.provider} disabled={busy === `kill-${p.provider}`} onClick={() => post('/api/master-admin/spend/kill', { scope: p.provider, enabled: !p.enabled }, `kill-${p.provider}`)}
              className="text-left border border-[#1E223D] rounded-lg px-3 py-2 hover:border-[#615EFF]">
              <div className="text-[11px] text-white">{PROVIDER_LABEL[p.provider] || p.provider}</div>
              <div className={`font-mono text-[10px] ${p.enabled ? 'text-[#5FE3A1]' : 'text-[#FF6B6B]'}`}>{p.enabled ? 'ENABLED — click to disable' : 'DISABLED — click to enable'}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card icon={Wallet} title="Spend today (UTC)">
          <div className="font-mono text-lg text-white">{usd(status.today.spentUsd)} <span className="text-[11px] text-[#6A7097]">of {usd(status.policy.global.dailyUsd)} · remaining {usd(status.remaining.globalTodayUsd)}</span></div>
          <p className="text-[11px] text-[#6A7097] font-mono">actual {usd(status.today.actualKnownUsd)} · estimate-only {usd(status.today.estimateOnlyUsd)} · {status.today.callsWithUnknownActualCost} call(s) with ACTUAL_COST_UNKNOWN</p>
          <p className="text-[11px] text-[#6A7097] font-mono">{status.today.calls} paid call(s) · {status.today.blockedCalls} blocked · {status.today.totalTokens} tokens reported · {status.inFlight} in flight</p>
        </Card>
        <Card icon={Wallet} title="Spend this month (UTC)">
          <div className="font-mono text-lg text-white">{usd(status.month.spentUsd)} <span className="text-[11px] text-[#6A7097]">of {usd(status.policy.global.monthlyUsd)} · remaining {usd(status.remaining.globalMonthUsd)}</span></div>
          <p className="text-[11px] text-[#6A7097] font-mono">actual {usd(status.month.actualKnownUsd)} · estimate-only {usd(status.month.estimateOnlyUsd)} · {status.month.calls} call(s)</p>
        </Card>
      </div>

      <Card icon={Gauge} title="Budgets and ceilings">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          <Num label="Global daily $" value={draft.global.dailyUsd} onChange={(v) => set(['global', 'dailyUsd'], v)} />
          <Num label="Global monthly $" value={draft.global.monthlyUsd} onChange={(v) => set(['global', 'monthlyUsd'], v)} />
          <Num label="Global concurrent paid calls" value={draft.global.maxConcurrent} step={1} onChange={(v) => set(['global', 'maxConcurrent'], v)} />
          <Num label="Per-workspace daily $" value={draft.workspaceDefault.dailyUsd} onChange={(v) => set(['workspaceDefault', 'dailyUsd'], v)} />
          <Num label="Per-workspace concurrent calls" value={draft.workspaceDefault.maxConcurrent} step={1} onChange={(v) => set(['workspaceDefault', 'maxConcurrent'], v)} />
          <Num label="Per-task max estimated $" value={draft.task.maxEstimatedUsd} onChange={(v) => set(['task', 'maxEstimatedUsd'], v)} />
          <Num label="Max input characters" value={draft.task.maxInputChars} step={1000} onChange={(v) => set(['task', 'maxInputChars'], v)} />
          <Num label="Max output tokens" value={draft.task.maxOutputTokens} step={64} onChange={(v) => set(['task', 'maxOutputTokens'], v)} />
          <Num label="Approval required above $" value={draft.approvalThresholdUsd} onChange={(v) => set(['approvalThresholdUsd'], v)} />
          <Num label="Antigravity per-run ceiling $" value={draft.antigravity.perRunCeilingUsd} onChange={(v) => set(['antigravity', 'perRunCeilingUsd'], v)} />
          <Num label="Antigravity max total tokens" value={draft.antigravity.maxTotalTokens} step={1000} onChange={(v) => set(['antigravity', 'maxTotalTokens'], v)} />
          <label className="flex items-center justify-between gap-2 text-[11px] text-[#C9CCE3]">
            <span>Highest cost tier a task may use</span>
            <select value={draft.task.maxTier} onChange={(e) => set(['task', 'maxTier'], e.target.value)} className="bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white">
              {['LOW_COST', 'STANDARD', 'PREMIUM'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="border-t border-[#161828] pt-3 space-y-2">
          <div className="text-[10px] font-mono uppercase text-[#6A7097]">Per provider — daily $ · monthly $ · concurrent · spent today / month</div>
          {status.providers.map((p: any) => (
            <div key={p.provider} className="grid grid-cols-12 gap-2 items-center text-[11px]">
              <span className="col-span-3 text-white">{PROVIDER_LABEL[p.provider] || p.provider}</span>
              <input type="number" min={0} step={0.01} value={draft.providers[p.provider].dailyUsd} onChange={(e) => set(['providers', p.provider, 'dailyUsd'], Number(e.target.value))} className="col-span-2 bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white font-mono text-right" />
              <input type="number" min={0} step={0.01} value={draft.providers[p.provider].monthlyUsd} onChange={(e) => set(['providers', p.provider, 'monthlyUsd'], Number(e.target.value))} className="col-span-2 bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white font-mono text-right" />
              <input type="number" min={0} step={1} value={draft.providers[p.provider].maxConcurrent} onChange={(e) => set(['providers', p.provider, 'maxConcurrent'], Number(e.target.value))} className="col-span-1 bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white font-mono text-right" />
              <span className="col-span-4 font-mono text-[10px] text-[#8E94B8]">{usd(p.spentTodayUsd)} / {usd(p.spentMonthUsd)} · {p.inFlight} in flight</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-[#585E82]">Fallback policy: NO_PAID_FALLBACK — one model per logical call. No field accepts "unlimited".</p>
          <button disabled={busy === 'policy'} onClick={() => post('/api/master-admin/spend/policy', { policy: { ...draft, paidExecutionEnabled: status.policy.paidExecutionEnabled } }, 'policy')}
            className="text-[11px] font-mono font-bold px-3 py-1.5 rounded-md bg-[#615EFF] hover:bg-[#524EFA] text-white disabled:opacity-40">Save budgets</button>
        </div>
      </Card>

      <Card icon={ListChecks} title="Pricing — from each provider's own price page">
        <p className="text-[11px] text-[#6A7097]">A model with no price here cannot be estimated, so it is blocked. That is also why a newly discovered model never becomes spendable on its own.</p>
        {status.pricing.length === 0 && <p className="text-[11px] font-mono text-[#7E8BB5]">NO PRICES CONFIGURED — every paid call is blocked with PRICING_UNKNOWN.</p>}
        {status.pricing.map((p: any) => (
          <div key={p.key} className="flex items-center justify-between text-[11px] font-mono text-[#C9CCE3] border-b border-[#11142A] py-1">
            <span>{p.key} <span className="text-[#6A7097]">({p.unit}) {p.tier}</span></span>
            <span>in ${p.inputPerMillion}/M · out ${p.outputPerMillion}/M{typeof p.cachedInputPerMillion === 'number' ? ` · cached $${p.cachedInputPerMillion}/M` : ''}
              <button className="ml-2 text-[#FF6B6B]" onClick={() => {
                const table = Object.fromEntries(status.pricing.filter((x: any) => x.key !== p.key).map((x: any) => [x.key, { unit: x.unit, inputPerMillion: x.inputPerMillion, outputPerMillion: x.outputPerMillion, ...(typeof x.cachedInputPerMillion === 'number' ? { cachedInputPerMillion: x.cachedInputPerMillion } : {}) }]));
                void post('/api/master-admin/spend/pricing', { pricing: table }, 'pricing');
              }}><Trash2 className="w-3 h-3 inline" /></button>
            </span>
          </div>
        ))}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <select value={priceDraft.provider} onChange={(e) => setPriceDraft({ ...priceDraft, provider: e.target.value })} className="bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white">
            {Object.keys(PROVIDER_LABEL).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input placeholder="model id" value={priceDraft.model} onChange={(e) => setPriceDraft({ ...priceDraft, model: e.target.value })} className="bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white font-mono" />
          <select value={priceDraft.unit} onChange={(e) => setPriceDraft({ ...priceDraft, unit: e.target.value })} className="bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white"><option value="tokens">per M tokens</option><option value="chars">per M chars</option></select>
          <input type="number" min={0} step={0.01} placeholder="input $/M" value={priceDraft.inputPerMillion} onChange={(e) => setPriceDraft({ ...priceDraft, inputPerMillion: Number(e.target.value) })} className="bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white font-mono" />
          <input type="number" min={0} step={0.01} placeholder="output $/M" value={priceDraft.outputPerMillion} onChange={(e) => setPriceDraft({ ...priceDraft, outputPerMillion: Number(e.target.value) })} className="bg-[#090A16] border border-[#1E223D] rounded-md px-2 py-1 text-xs text-white font-mono" />
          <button disabled={!priceDraft.model.trim() || busy === 'pricing'} onClick={() => {
            const table = Object.fromEntries(status.pricing.map((x: any) => [x.key, { unit: x.unit, inputPerMillion: x.inputPerMillion, outputPerMillion: x.outputPerMillion, ...(typeof x.cachedInputPerMillion === 'number' ? { cachedInputPerMillion: x.cachedInputPerMillion } : {}) }]));
            table[`${priceDraft.provider}:${priceDraft.model.trim()}`] = { unit: priceDraft.unit, inputPerMillion: priceDraft.inputPerMillion, outputPerMillion: priceDraft.outputPerMillion };
            void post('/api/master-admin/spend/pricing', { pricing: table }, 'pricing');
          }} className="text-[11px] font-mono font-bold px-2.5 py-1.5 rounded-md bg-[#615EFF] text-white disabled:opacity-40 flex items-center gap-1"><Plus className="w-3 h-3" /> Add price</button>
        </div>
      </Card>

      <Card icon={ShieldAlert} title="Needs an operator — ambiguous paid calls (never retried automatically)">
        {status.needsReconciliation.length === 0 ? <p className="text-[11px] font-mono text-[#7E8BB5]">None.</p> : status.needsReconciliation.map((r: any) => (
          <div key={r.usage_id} className="text-[11px] font-mono text-[#C9CCE3] border-b border-[#11142A] py-1.5 flex items-center justify-between gap-2">
            <span>{r.status} · {r.provider}:{r.model} · {r.call_site} · est {usd(r.estimated_cost_usd)} · {r.created_at}</span>
            <button className="text-[10px] border border-[#2A2F52] rounded px-2 py-0.5 hover:border-[#615EFF]" onClick={() => {
              const note = window.prompt('Why is a new attempt safe? (checked the provider dashboard, etc.)');
              if (note && note.trim()) void post(`/api/master-admin/spend/usage/${r.usage_id}/clear`, { note }, `clear-${r.usage_id}`);
            }}>Allow a new attempt</button>
          </div>
        ))}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card icon={ListChecks} title="By model — today">
          {status.byModelToday.length === 0 ? <p className="text-[11px] font-mono text-[#7E8BB5]">No paid calls today.</p> : status.byModelToday.map((m: any) => (
            <p key={`${m.provider}:${m.model}`} className="text-[11px] font-mono text-[#C9CCE3]">{m.provider}:{m.model} — {m.calls} call(s) · {usd(m.spentUsd)} · {m.totalTokens} tokens{m.callsWithUnknownActualCost ? ` · ${m.callsWithUnknownActualCost} unknown actual` : ''}</p>
          ))}
        </Card>
        <Card icon={AlertTriangle} title="Budget alerts and recent blocks">
          {status.alerts.length === 0 && status.recentBlocks.length === 0 && <p className="text-[11px] font-mono text-[#7E8BB5]">None.</p>}
          {status.alerts.map((a: any) => <p key={a.alert_id} className="text-[11px] font-mono text-[#E8A845]">{a.threshold}% · {a.scope} · {usd(a.spent_usd)} of {usd(a.limit_usd)}</p>)}
          {status.recentBlocks.map((b: any) => <p key={b.usage_id} className="text-[11px] font-mono text-[#8E94B8]">BLOCKED {b.reason_code} · {b.provider}:{b.model} · {b.call_site}</p>)}
        </Card>
      </div>
    </div>
  );
}

export default SpendControlPanel;
