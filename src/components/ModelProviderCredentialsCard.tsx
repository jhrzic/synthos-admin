import React, { useState, useEffect, useCallback } from 'react';
import { KeyRound, Loader2, CheckCircle2, AlertTriangle, Trash2, ShieldCheck, Server } from 'lucide-react';

// ---------------------------------------------------------------------------
// MODEL PROVIDERS — the operator surface over the SERVER-SIDE encrypted
// credential store (/api/platform/model-credentials), added in Push 2B.
//
// This is deliberately separate from, and visually distinguished from, the
// browser-held BYOK fields elsewhere in Settings. Those live in local client
// settings; these are encrypted at rest on the server and are the keys the
// Execution Fabric actually runs with. Presenting them as the same thing
// would leave an operator unable to tell why a key they "saved" changed
// nothing.
//
// The stored secret is never requested, never returned and never rendered.
// The only things shown are the safe state vocabulary the API exposes —
// ENVIRONMENT / STORED / NOT_CONFIGURED — plus whether an environment
// variable is currently overriding a stored row, which is the one thing an
// operator cannot deduce on their own.
// ---------------------------------------------------------------------------

interface ProviderStatus {
  provider: string;
  state: 'ENVIRONMENT' | 'STORED' | 'NOT_CONFIGURED';
  configured: boolean;
  envVar: string;
  storedRowPresent: boolean;
  overriddenByEnvironment: boolean;
  updatedAt: string | null;
}

interface VerificationResult {
  ok: boolean;
  model?: string;
  sample?: string;
  error?: string;
}

interface ModelProviderCredentialsCardProps {
  activeWorkspaceId?: string;
}

const STATE_STYLE: Record<string, string> = {
  ENVIRONMENT: 'bg-[#38BDF8]/10 border-[#38BDF8]/40 text-[#38BDF8]',
  STORED: 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]',
  NOT_CONFIGURED: 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]',
};

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI (ChatGPT review seat)',
  gemini: 'Gemini (Execution Fabric · Concierge · Antigravity credential)',
};

export const ModelProviderCredentialsCard: React.FC<ModelProviderCredentialsCardProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || '';
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [verification, setVerification] = useState<Record<string, VerificationResult>>({});

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/platform/model-credentials?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (res.status === 403) throw new Error('Model-provider credentials are platform configuration and need the platform administrator role.');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to read credential status');
      setProviders(json.providers || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to read credential status');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (provider: string, action: 'save' | 'verify' | 'delete') => {
    setBusy(`${provider}:${action}`);
    setError(null);
    try {
      const body: Record<string, unknown> = { workspaceId, action };
      if (action === 'save') body.apiKey = drafts[provider] || '';
      const res = await fetch(`/api/platform/model-credentials/${encodeURIComponent(provider)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || `${action} failed`);
      // The draft is cleared immediately so a key never lingers in a DOM input
      // after it has been handed to the server.
      if (action === 'save') setDrafts((d) => ({ ...d, [provider]: '' }));
      if (json.verification) setVerification((v) => ({ ...v, [provider]: json.verification }));
      await load();
    } catch (e: any) {
      setError(e?.message || `${action} failed`);
    } finally {
      setBusy(null);
    }
  }, [workspaceId, drafts, load]);

  if (!workspaceId) {
    return (
      <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6">
        <p className="text-xs text-[#8E94B8]">Select a workspace to manage server-side model provider credentials.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 space-y-5">
      <div className="border-b border-[#161828] pb-4">
        <h3 className="text-base font-bold text-white font-['Space_Grotesk'] flex items-center gap-2">
          <Server className="w-5 h-5 text-[#615EFF]" />
          <span>Model Providers — server-side encrypted store</span>
        </h3>
        <p className="text-xs text-[#8E94B8] mt-0.5">
          These are the credentials the Execution Fabric actually runs with. Stored encrypted on the server, never returned to the
          browser. This is the only place a model-provider key is entered.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-[10px] underline cursor-pointer shrink-0">dismiss</button>
        </div>
      )}

      {/* Unreadable is not the same as absent. With no successful read there is
          no provider state to show, so the card says so persistently rather
          than rendering an empty list a reader could take for "none set". */}
      {!loading && providers.length === 0 && (
        <div className="p-4 rounded-xl border border-[#7E8BB5]/40 bg-[#7E8BB5]/10 text-[11px] font-mono text-[#8E94B8]">
          {workspaceId ? 'SERVER STATE UNKNOWN — credential status could not be read.' : 'SERVER STATE UNKNOWN — no workspace selected.'}
        </div>
      )}

      {loading && providers.length === 0 && (
        <div className="p-6 text-center text-xs text-[#8E94B8] flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading credential status…
        </div>
      )}

      <div className="space-y-3">
        {providers.map((p) => {
          const v = verification[p.provider];
          return (
            <div key={p.provider} className="bg-[#05060C] border border-[#1A1E36] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-[#8C8AFF]" />
                    <span className="text-sm font-bold text-white">{PROVIDER_LABEL[p.provider] || p.provider}</span>
                  </div>
                  <p className="text-[10px] text-[#6A7097] mt-0.5 font-mono">{p.envVar}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border shrink-0 ${STATE_STYLE[p.state]}`}>{p.state}</span>
              </div>

              {p.overriddenByEnvironment && (
                <div className="p-2.5 rounded-lg bg-[#E8A845]/10 border border-[#E8A845]/40 text-[11px] text-[#E8A845]">
                  A stored key exists, but <span className="font-mono">{p.envVar}</span> is set in the deployment environment and takes
                  precedence. The environment key is the one in use.
                </div>
              )}

              {p.state === 'ENVIRONMENT' && !p.storedRowPresent && (
                <p className="text-[11px] text-[#6A7097]">
                  Supplied by the deployment environment. It cannot be replaced or removed from here — that is deployment configuration.
                </p>
              )}

              {p.state !== 'ENVIRONMENT' && (
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="password"
                    autoComplete="off"
                    value={drafts[p.provider] || ''}
                    onChange={(e) => setDrafts({ ...drafts, [p.provider]: e.target.value })}
                    placeholder={p.storedRowPresent ? 'Enter a new key to replace the stored one' : 'Paste the API key'}
                    className="flex-1 min-w-[220px] bg-[#0B0D1B] border border-[#1F2442] rounded-lg px-3 py-2 text-xs text-white placeholder-[#4B5070] outline-none focus:border-[#615EFF] font-mono"
                  />
                  <button
                    disabled={!(drafts[p.provider] || '').trim() || busy === `${p.provider}:save`}
                    onClick={() => act(p.provider, 'save')}
                    className="px-3 py-2 rounded-lg bg-[#615EFF] hover:bg-[#524EFA] disabled:opacity-40 text-[11px] font-bold text-white cursor-pointer"
                  >
                    {busy === `${p.provider}:save` ? 'Saving…' : 'Save & Verify'}
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  disabled={!p.configured || busy === `${p.provider}:verify`}
                  onClick={() => act(p.provider, 'verify')}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[10px] font-bold text-[#8E94B8] hover:text-white disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3 h-3" /> {busy === `${p.provider}:verify` ? 'Verifying…' : 'Verify with a real call'}
                </button>
                {p.storedRowPresent && (
                  <button
                    disabled={busy === `${p.provider}:delete`}
                    onClick={() => act(p.provider, 'delete')}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0B0D1B] border border-[#FF6B6B]/30 text-[10px] font-bold text-[#FF6B6B] hover:bg-[#FF6B6B]/10 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3 h-3" /> Remove stored key
                  </button>
                )}
                {p.updatedAt && <span className="text-[10px] text-[#4B5070]">stored key updated {new Date(p.updatedAt).toLocaleString()}</span>}
              </div>

              {v && (
                <div className={`p-2.5 rounded-lg text-[11px] border ${v.ok ? 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]' : 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]'}`}>
                  {v.ok
                    ? <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Verified against the real provider — model <span className="font-mono">{v.model}</span></span>
                    : <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {v.error}</span>}
                </div>
              )}

              {p.state === 'NOT_CONFIGURED' && (
                <p className="text-[11px] text-[#6A7097]">
                  Not configured. Anything that needs this provider reports NOT_CONFIGURED rather than running on a different one.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ModelProviderCredentialsCard;
