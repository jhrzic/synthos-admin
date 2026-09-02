import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe, ShieldCheck, Wallet, BarChart3,
  GitMerge, RefreshCw, Activity, AlertTriangle, CheckCircle2,
  XCircle, HelpCircle, Loader2
} from 'lucide-react';

interface TONNetworkViewProps {
  activeWorkspaceId?: string;
}

type ApprovalStatus = 'not_configured' | 'submitted' | 'approved';

interface TonReadinessItem {
  id: string;
  label: string;
  status: ApprovalStatus;
  detail: string;
}

interface TonReadiness {
  network: 'mainnet' | 'testnet';
  manifest: { configured: boolean; url: string; reachable: boolean | null };
  rpc: { endpoint: string; apiKeyConfigured: boolean; reachable: boolean | null };
  tonapi: { apiKeyConfigured: boolean };
  escrow: { configured: boolean; address: string | null; active: boolean | null };
  checklist: TonReadinessItem[];
  readyCount: number;
  totalCount: number;
  controllerReady: boolean;
  lastCheckedAt: string | null;
}

interface TonGuardian {
  name: string;
  label: string;
  capability: string;
  installed: boolean;
  status: string | null;
}

interface TonStatusResponse {
  success: boolean;
  workspaceId: string;
  readiness: TonReadiness;
  guardians: { installedCount: number; totalCount: number; items: TonGuardian[] };
  hasTelemetry: boolean;
  timestamp: string;
  error?: string;
}

interface TonTelemetrySnapshot {
  rangeDays: number;
  hasTelemetry: boolean;
  metrics: {
    managedSpendUsd: number | null;
    verifiedInstalls: number | null;
    fraudBlockRate: number | null;
    d7Roas: number | null;
    settledUsdt: number | null;
    acquisitions: number | null;
    verifiedEvents: number | null;
    payoutCount: number | null;
    uniqueChannels: number | null;
    linkedWallets: number | null;
    averageLatencyMs: number | null;
  };
  activity: Array<{
    id: string;
    eventType: string;
    channel: string | null;
    walletHint: string | null;
    verified: boolean;
    blockedReason: string | null;
    occurredAt: string;
  }>;
  topology: {
    channels: Array<{ name: string; events: number }>;
    wallets: Array<{ hint: string; events: number }>;
  };
}

const TABS = [
  { id: 'overview', label: 'OVERVIEW', icon: Globe },
  { id: 'network-build', label: 'NETWORK BUILD', icon: GitMerge },
  { id: 'telemetry', label: 'TELEMETRY', icon: BarChart3 },
  { id: 'guardians', label: 'GUARDIANS', icon: ShieldCheck },
  { id: 'configuration', label: 'CONFIGURATION', icon: Wallet },
] as const;

type TabId = (typeof TABS)[number]['id'];

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, { label: string; cls: string; Icon: any }> = {
    approved: { label: 'APPROVED', cls: 'bg-[#00D26A]/20 text-[#00D26A] border-[#00D26A]/40', Icon: CheckCircle2 },
    submitted: { label: 'SUBMITTED', cls: 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/40', Icon: HelpCircle },
    not_configured: { label: 'NOT_CONFIGURED', cls: 'bg-[#8E94B8]/15 text-[#8E94B8] border-[#8E94B8]/30', Icon: XCircle },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${cls}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export const TONNetworkView: React.FC<TONNetworkViewProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [status, setStatus] = useState<TonStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState<TonTelemetrySnapshot | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(true);

  const [installingGuardians, setInstallingGuardians] = useState(false);
  const [guardianNotice, setGuardianNotice] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/ton/status?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setStatusError(data.error || `HTTP ${res.status}`);
        setStatus(null);
      } else {
        setStatus(data);
      }
    } catch (err: any) {
      setStatusError(err?.message || 'Network error contacting TON status API.');
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [workspaceId]);

  const fetchTelemetry = useCallback(async () => {
    setTelemetryLoading(true);
    try {
      const res = await fetch(`/api/ton/telemetry?workspaceId=${encodeURIComponent(workspaceId)}&rangeDays=30`);
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setTelemetry(data);
      } else {
        setTelemetry(null);
      }
    } catch {
      setTelemetry(null);
    } finally {
      setTelemetryLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchStatus();
    fetchTelemetry();
  }, [fetchStatus, fetchTelemetry]);

  const handleInstallGuardians = async () => {
    setInstallingGuardians(true);
    setGuardianNotice(null);
    try {
      const res = await fetch('/api/ton/guardians', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setGuardianNotice(`Installed. ${data.installedCount}/${data.totalCount} guardian records present for this workspace.`);
        await fetchStatus();
      } else {
        setGuardianNotice(`FAILED — ${data.error || `HTTP ${res.status}`}`);
      }
    } catch (err: any) {
      setGuardianNotice(`FAILED — ${err?.message || 'network error'}`);
    } finally {
      setInstallingGuardians(false);
    }
  };

  const readiness = status?.readiness;

  return (
    <div className="space-y-6 font-mono pb-12">
      {/* Product Banner — every claim here is derived from real API state */}
      <div className="bg-gradient-to-r from-[#0088CC]/20 via-[#0B0D1B] to-[#615EFF]/20 border border-[#0088CC]/40 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#0088CC]/20 border border-[#0088CC]/50 flex items-center justify-center text-[#0088CC] shrink-0">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">
                  TON Network Product Workspace
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0088CC]/20 text-[#0088CC] font-bold border border-[#0088CC]/40">
                  PRODUCT DOMAIN
                </span>
              </div>
              <p className="text-xs text-[#8E94B8] mt-1 font-sans">
                Workspace: <span className="text-white">{workspaceId}</span> · Network: <span className="text-white">{readiness?.network?.toUpperCase() || 'UNKNOWN'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {statusLoading ? (
              <span className="px-3 py-1 rounded-lg bg-[#8E94B8]/15 text-[#8E94B8] font-bold border border-[#8E94B8]/30 inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> CHECKING
              </span>
            ) : statusError ? (
              <span className="px-3 py-1 rounded-lg bg-[#FF5E8E]/20 text-[#FF5E8E] font-bold border border-[#FF5E8E]/30">
                STATUS UNAVAILABLE
              </span>
            ) : readiness ? (
              <span className={`px-3 py-1 rounded-lg font-bold border ${
                readiness.controllerReady
                  ? 'bg-[#00D26A]/20 text-[#00D26A] border-[#00D26A]/30'
                  : 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30'
              }`}>
                {readiness.readyCount}/{readiness.totalCount} READINESS GATES APPROVED
              </span>
            ) : null}
            <button
              onClick={() => { fetchStatus(); fetchTelemetry(); }}
              disabled={statusLoading}
              className="p-2 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Re-run live probe"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex border-t border-[#0088CC]/20 pt-4 text-xs gap-2 overflow-x-auto scrollbar-none">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-[#0088CC] text-white shadow-lg shadow-[#0088CC]/25'
                  : 'bg-[#0B0D1B] text-[#8E94B8] hover:text-white border border-[#1F2442]'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {statusError && (
        <div className="bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-2xl p-4 flex items-start gap-2 text-xs text-[#FF5E8E]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>TON status API error: {statusError}</span>
        </div>
      )}

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5 space-y-3">
            <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">Readiness Checklist</div>
            {statusLoading ? (
              <div className="text-xs text-[#8E94B8]">Loading…</div>
            ) : readiness ? (
              <div className="space-y-2">
                {readiness.checklist.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs border-b border-[#171A2E] pb-2 last:border-0">
                    <div>
                      <div className="text-white font-semibold">{item.label}</div>
                      <div className="text-[#8E94B8] text-[10px]">{item.detail}</div>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[#8E94B8]">TON status unavailable.</div>
            )}
          </div>

          <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5 space-y-3">
            <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">Workspace Summary</div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-[#8E94B8]">Guardians installed</span><span className="text-white font-bold">{status ? `${status.guardians.installedCount}/${status.guardians.totalCount}` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#8E94B8]">Telemetry received</span><span className="text-white font-bold">{status ? (status.hasTelemetry ? 'YES' : 'NOT YET') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#8E94B8]">Last probe</span><span className="text-white font-bold">{readiness?.lastCheckedAt ? new Date(readiness.lastCheckedAt).toLocaleString() : 'NEVER'}</span></div>
              <div className="flex justify-between"><span className="text-[#8E94B8]">RPC endpoint reachable</span><span className="text-white font-bold">{readiness?.rpc.reachable === null ? 'UNKNOWN' : readiness?.rpc.reachable ? 'YES' : 'NO'}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* NETWORK BUILD */}
      {activeTab === 'network-build' && (
        <div className="space-y-4">
          <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-[#8E94B8] uppercase tracking-wider">
              <GitMerge className="w-4 h-4" /> Deployment Prerequisites
            </div>
            {readiness ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {readiness.checklist.map((item) => (
                  <div key={item.id} className="p-3 bg-[#070811] rounded-xl border border-[#151728] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white font-semibold">{item.label}</span>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="text-[10px] text-[#8E94B8]">{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[#8E94B8]">No readiness data available.</div>
            )}
          </div>

          <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-2xl p-4 text-xs text-[#F59E0B] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold mb-1">External blockers (not code — cannot be resolved from this screen)</div>
              <ul className="list-disc list-inside space-y-0.5 text-[#E8C48A]">
                <li>Undeployed TON Connect manifest at the expected public URL</li>
                <li>Unaudited/unconfirmed escrow contract on-chain state</li>
                <li>No live TON mini-app or bot yet posting real telemetry to this workspace</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TELEMETRY */}
      {activeTab === 'telemetry' && (
        <div className="space-y-4">
          {telemetryLoading ? (
            <div className="text-xs text-[#8E94B8]">Loading telemetry…</div>
          ) : !telemetry || !telemetry.hasTelemetry ? (
            <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-8 text-center space-y-2">
              <Activity className="w-8 h-8 text-[#0088CC] mx-auto opacity-50" />
              <p className="text-sm text-white font-semibold">No TON telemetry has been received for this workspace.</p>
              <p className="text-xs text-[#8E94B8] max-w-md mx-auto">
                Metrics stay unavailable until a real TON mini-app or bot posts events to
                <code className="mx-1 px-1.5 py-0.5 bg-[#070811] rounded text-[#0088CC]">POST /api/ton/telemetry</code>
                for this workspace. Nothing is shown here until that happens.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Managed Spend', value: telemetry.metrics.managedSpendUsd, fmt: (v: number) => `$${v.toFixed(2)}` },
                  { label: 'Verified Installs', value: telemetry.metrics.verifiedInstalls, fmt: (v: number) => `${v}` },
                  { label: 'Fraud Block Rate', value: telemetry.metrics.fraudBlockRate, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
                  { label: 'D7 ROAS', value: telemetry.metrics.d7Roas, fmt: (v: number) => `${v.toFixed(2)}x` },
                  { label: 'Settled USDT', value: telemetry.metrics.settledUsdt, fmt: (v: number) => `${v.toFixed(2)}` },
                  { label: 'Acquisitions', value: telemetry.metrics.acquisitions, fmt: (v: number) => `${v}` },
                  { label: 'Unique Channels', value: telemetry.metrics.uniqueChannels, fmt: (v: number) => `${v}` },
                  { label: 'Linked Wallets', value: telemetry.metrics.linkedWallets, fmt: (v: number) => `${v}` },
                ].map((m) => (
                  <div key={m.label} className="bg-[#0B0D1B] border border-[#1D2139] rounded-xl p-3">
                    <div className="text-[10px] text-[#8E94B8] uppercase">{m.label}</div>
                    <div className="text-lg font-bold text-white">{m.value === null ? '—' : m.fmt(m.value)}</div>
                  </div>
                ))}
              </div>

              <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5 space-y-2">
                <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">Recent Activity ({telemetry.activity.length})</div>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {telemetry.activity.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between text-[11px] border-b border-[#171A2E] py-1.5 last:border-0">
                      <span className="text-white">{ev.eventType}{ev.channel ? ` · ${ev.channel}` : ''}</span>
                      <span className={ev.verified ? 'text-[#00D26A]' : ev.blockedReason ? 'text-[#FF5E8E]' : 'text-[#8E94B8]'}>
                        {ev.verified ? 'verified' : ev.blockedReason || 'unverified'}
                      </span>
                      <span className="text-[#8E94B8]">{new Date(ev.occurredAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* GUARDIANS */}
      {activeTab === 'guardians' && (
        <div className="space-y-4">
          <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">
                {status ? `${status.guardians.installedCount}/${status.guardians.totalCount} Guardians Installed` : 'Guardian State'}
              </div>
              <button
                onClick={handleInstallGuardians}
                disabled={installingGuardians}
                className="px-3 py-1.5 bg-[#0088CC]/20 border border-[#0088CC]/40 hover:bg-[#0088CC] text-white text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-50"
              >
                {installingGuardians ? 'Installing…' : 'Install Guardians'}
              </button>
            </div>
            {guardianNotice && <p className="text-[11px] text-[#8E94B8]">{guardianNotice}</p>}
            <div className="space-y-2">
              {(status?.guardians.items || []).map((g) => (
                <div key={g.name} className="flex items-center justify-between p-3 bg-[#070811] rounded-xl border border-[#151728]">
                  <div>
                    <div className="text-xs text-white font-semibold">{g.label}</div>
                    <div className="text-[10px] text-[#8E94B8]">{g.capability}</div>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    g.installed
                      ? 'bg-[#00D26A]/20 text-[#00D26A] border-[#00D26A]/40'
                      : 'bg-[#8E94B8]/15 text-[#8E94B8] border-[#8E94B8]/30'
                  }`}>
                    {g.installed ? (g.status || 'INSTALLED').toUpperCase() : 'NOT_INSTALLED'}
                  </span>
                </div>
              ))}
              {!status && <div className="text-xs text-[#8E94B8]">Guardian state unavailable.</div>}
            </div>
          </div>
        </div>
      )}

      {/* CONFIGURATION */}
      {activeTab === 'configuration' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5 space-y-3">
          <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">Configuration Metadata</div>
          <p className="text-[10px] text-[#8E94B8]">API keys and secrets are never displayed here — only presence/absence and public, non-secret values.</p>
          {readiness ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between border-b border-[#171A2E] pb-2"><span className="text-[#8E94B8]">Network</span><span className="text-white font-bold">{readiness.network}</span></div>
              <div className="flex justify-between border-b border-[#171A2E] pb-2"><span className="text-[#8E94B8]">RPC endpoint</span><span className="text-white font-bold">{readiness.rpc.endpoint}</span></div>
              <div className="flex justify-between border-b border-[#171A2E] pb-2"><span className="text-[#8E94B8]">TONCENTER_API_KEY configured</span><span className="text-white font-bold">{readiness.rpc.apiKeyConfigured ? 'YES' : 'NOT_CONFIGURED'}</span></div>
              <div className="flex justify-between border-b border-[#171A2E] pb-2"><span className="text-[#8E94B8]">TONAPI_API_KEY configured</span><span className="text-white font-bold">{readiness.tonapi.apiKeyConfigured ? 'YES' : 'NOT_CONFIGURED'}</span></div>
              <div className="flex justify-between border-b border-[#171A2E] pb-2"><span className="text-[#8E94B8]">Manifest URL</span><span className="text-white font-bold">{readiness.manifest.configured ? readiness.manifest.url : 'NOT_CONFIGURED'}</span></div>
              <div className="flex justify-between"><span className="text-[#8E94B8]">Escrow address</span><span className="text-white font-bold">{readiness.escrow.address || 'NOT_CONFIGURED'}</span></div>
            </div>
          ) : (
            <div className="text-xs text-[#8E94B8]">Configuration state unavailable.</div>
          )}
        </div>
      )}
    </div>
  );
};
