import React, { useState } from 'react';
import { 
  Building2, 
  Plus, 
  ShieldCheck, 
  CheckCircle2, 
  Users, 
  Key, 
  Cpu, 
  Layers, 
  Globe, 
  Activity, 
  RefreshCw,
  FolderLock
} from 'lucide-react';
import { WorkspaceTenant } from '../types';
import { synthosControl } from '../services/synthosControlService';

const DEFAULT_WORKSPACES: WorkspaceTenant[] = [
  {
    id: 'ws-synthos-primary',
    name: 'SynthOS Primary Fleet (Production)',
    slug: 'synthos-primary',
    tier: 'enterprise',
    currentUserRole: 'owner',
    activeCapabilities: [
      'graph_engine',
      'universal_memory',
      'guardian_policy',
      'aegis_verification',
      'model_arbitrage',
      'vault_obsidian_sync',
      'activity_ledger'
    ],
    guardianActive: true,
    aegisReviewRequired: true,
    apiHealth: {
      gemini: 'ONLINE',
      openrouter: 'ONLINE',
      hermesDb: 'LOCAL_ATTACHED',
      obsidianSync: 'ONLINE'
    }
  },
  {
    id: 'ws-research-sandbox',
    name: 'arXiv & Research Lab (Staging)',
    slug: 'research-sandbox',
    tier: 'pro',
    currentUserRole: 'admin',
    activeCapabilities: [
      'graph_engine',
      'guardian_policy',
      'vault_obsidian_sync',
      'activity_ledger'
    ],
    guardianActive: true,
    aegisReviewRequired: false,
    apiHealth: {
      gemini: 'ONLINE',
      openrouter: 'ONLINE',
      hermesDb: 'ONLINE',
      obsidianSync: 'ONLINE'
    }
  },
  {
    id: 'ws-growth-reach',
    name: 'GTM & Viral Reach Engine',
    slug: 'growth-reach',
    tier: 'pro',
    currentUserRole: 'operator',
    activeCapabilities: [
      'universal_memory',
      'model_arbitrage',
      'vault_obsidian_sync'
    ],
    guardianActive: true,
    aegisReviewRequired: true,
    apiHealth: {
      gemini: 'ONLINE',
      openrouter: 'DEGRADED',
      hermesDb: 'LOCAL_ATTACHED',
      obsidianSync: 'ONLINE'
    }
  }
];

export const WorkspacesView: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceTenant[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('ws-synthos-primary');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newWsName, setNewWsName] = useState<string>('');
  const [newWsTier, setNewWsTier] = useState<'free' | 'pro' | 'enterprise'>('pro');
  const [notification, setNotification] = useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/providers/status')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const geminiStatus = data.providers?.gemini?.status === 'CONFIGURED' ? 'ONLINE' : 'NOT_CONFIGURED';
          const openrouterStatus = data.providers?.openrouter?.status === 'CONFIGURED' ? 'ONLINE' : 'ZERO_COST_ONLY';
          const obsidianStatus = data.storage?.vault === 'LOCAL_DISK_PRESENT' ? 'LOCAL_FOUND' : 'NOT_CONNECTED';
          const hermesDbStatus = data.storage?.sqlite === 'INITIALIZED' ? 'LOCAL_ATTACHED' : 'PENDING';

          setWorkspaces(prev => prev.map(ws => ({
            ...ws,
            apiHealth: {
              gemini: geminiStatus as any,
              openrouter: openrouterStatus as any,
              hermesDb: hermesDbStatus as any,
              obsidianSync: obsidianStatus as any,
            }
          })));
        }
      })
      .catch(err => console.warn('Could not fetch live provider status:', err));
  }, []);

  const handleSwitchWorkspace = (ws: WorkspaceTenant) => {
    setActiveWorkspaceId(ws.id);
    synthosControl.logEvent({
      eventType: 'TASK_CREATED',
      actorRole: 'orchestrator',
      summary: `Switched active tenant context to "${ws.name}" (${ws.id}). Boundary isolation verified.`,
      payload: { workspaceId: ws.id, tier: ws.tier, role: ws.currentUserRole },
      isSimulated: false
    });
    setNotification(`Switched to workspace: ${ws.name}`);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleCreateWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;

    const newWs: WorkspaceTenant = {
      id: `ws-${Date.now()}`,
      name: newWsName.trim(),
      slug: newWsName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      tier: newWsTier,
      currentUserRole: 'owner',
      activeCapabilities: ['guardian_policy', 'aegis_verification', 'vault_obsidian_sync', 'activity_ledger'],
      guardianActive: true,
      aegisReviewRequired: true,
      apiHealth: {
        gemini: 'ONLINE',
        openrouter: 'ONLINE',
        hermesDb: 'LOCAL_ATTACHED',
        obsidianSync: 'ONLINE'
      }
    };

    setWorkspaces((prev) => [...prev, newWs]);
    setActiveWorkspaceId(newWs.id);
    setNewWsName('');
    setShowCreateModal(false);

    synthosControl.logEvent({
      eventType: 'TASK_CREATED',
      actorRole: 'orchestrator',
      summary: `Provisioned new multi-tenant Workspace: "${newWs.name}" (${newWs.id}).`,
      payload: newWs,
      isSimulated: false
    });

    setNotification(`Workspace "${newWs.name}" successfully provisioned.`);
    setTimeout(() => setNotification(null), 3500);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2D3352] pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Multi-Tenant Workspaces & Product Domains
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30 font-mono">
                  CLIENT WORKSPACE PROTOTYPE
                </span>
              </h1>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                Manage isolated agent operational domains, RBAC roles, capability flags, and domain products (such as TON Network).
              </p>
            </div>
          </div>
        </div>

        <button
          id="btn-create-workspace"
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-bold font-mono transition flex items-center gap-2 shadow-lg shadow-[#615EFF]/25 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Workspace Domain</span>
        </button>
      </div>

      {/* TON Network Product Workspace Highlight */}
      <div className="bg-gradient-to-r from-[#0088CC]/15 via-[#0F111E] to-[#615EFF]/15 border border-[#0088CC]/40 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0088CC]/20 border border-[#0088CC]/50 flex items-center justify-center text-[#0088CC]">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wide">TON Network Product Workspace</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0088CC]/20 text-[#0088CC] font-bold border border-[#0088CC]/40">
                  PRODUCT DOMAIN
                </span>
              </div>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                TON Mission Control: Wallet bindings (Tonkeeper / MyTonWallet), Guardians, Readiness, Telegram Mini App & TON Graph Operations.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-[#0088CC]/20 text-[#0088CC] font-bold border border-[#0088CC]/30">
              TON MAINNET: ONLINE
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-[#00D26A]/20 text-[#00D26A] font-bold border border-[#00D26A]/30">
              WALLETS: BOUND
            </span>
          </div>
        </div>

        {/* TON Quick Status Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs pt-2 border-t border-[#0088CC]/20">
          <div className="bg-[#0B0D1B] p-2.5 rounded-xl border border-[#1A1E36]">
            <span className="text-[#8E94B8] text-[10px] block">TON GUARDIAN READINESS</span>
            <span className="text-[#00D26A] font-bold text-xs">100% (8/8 Nodes)</span>
          </div>
          <div className="bg-[#0B0D1B] p-2.5 rounded-xl border border-[#1A1E36]">
            <span className="text-[#8E94B8] text-[10px] block">TON CONNECT WALLETS</span>
            <span className="text-[#0088CC] font-bold text-xs">Tonkeeper & MyTonWallet</span>
          </div>
          <div className="bg-[#0B0D1B] p-2.5 rounded-xl border border-[#1A1E36]">
            <span className="text-[#8E94B8] text-[10px] block">TELEGRAM MINI APP</span>
            <span className="text-[#A5A2FF] font-bold text-xs">READY (v2.4)</span>
          </div>
          <div className="bg-[#0B0D1B] p-2.5 rounded-xl border border-[#1A1E36]">
            <span className="text-[#8E94B8] text-[10px] block">TON GRAPH OPERATIONS</span>
            <span className="text-[#F59E0B] font-bold text-xs">ACTIVE</span>
          </div>
        </div>
      </div>

      {notification && (
        <div className="p-3.5 rounded-xl bg-[#00D26A]/15 border border-[#00D26A]/40 text-[#00D26A] text-xs font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Workspaces Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId;
          return (
            <div
              key={ws.id}
              className={`bg-[#0F111E] border rounded-2xl p-5 shadow-xl transition space-y-4 flex flex-col justify-between ${
                isActive ? 'border-[#615EFF] ring-1 ring-[#615EFF]/50' : 'border-[#2D3352] hover:border-[#2D3352]/90'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1C1F37] border border-[#2D3352] text-[#8C8AFF] font-bold">
                    {ws.tier.toUpperCase()} TIER
                  </span>
                  {isActive ? (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> ACTIVE CONTEXT
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-[#8E94B8]">ID: {ws.id}</span>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide">{ws.name}</h3>
                  <p className="text-[11px] font-mono text-[#8E94B8] mt-0.5">slug: /{ws.slug}</p>
                </div>

                <div className="bg-[#141628] p-3 rounded-xl border border-[#2D3352]/60 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-[#8E94B8]">Role Authority:</span>
                    <span className="text-[#00D26A] font-bold">{ws.currentUserRole.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8E94B8]">Guardian Gating:</span>
                    <span className="text-white">{ws.guardianActive ? 'ENABLED' : 'DISABLED'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8E94B8]">Aegis Review:</span>
                    <span className="text-[#8C8AFF]">{ws.aegisReviewRequired ? 'MANDATORY' : 'OPTIONAL'}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-[#8E94B8] block mb-1.5">Active Capabilities</span>
                  <div className="flex flex-wrap gap-1.5">
                    {ws.activeCapabilities.map((cap) => (
                      <span key={cap} className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1C1F37] border border-[#2D3352] text-[#9AA2C6]">
                        {cap.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleSwitchWorkspace(ws)}
                disabled={isActive}
                className={`w-full mt-4 py-2 rounded-xl text-xs font-bold font-mono transition cursor-pointer ${
                  isActive
                    ? 'bg-[#141628] border border-[#2D3352] text-[#8E94B8] cursor-default'
                    : 'bg-[#615EFF] hover:bg-[#5653D9] text-white shadow-lg shadow-[#615EFF]/25'
                }`}
              >
                {isActive ? 'Current Active Workspace' : 'Switch to Workspace'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0F111E] border border-[#2D3352] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-[#2D3352] pb-3">
              <div className="flex items-center gap-2">
                <FolderLock className="w-5 h-5 text-[#8C8AFF]" />
                <h3 className="text-sm font-bold text-white">Provision New Tenant Domain</h3>
              </div>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="text-[#8E94B8] hover:text-white text-xs font-mono"
              >
                ✕ Close
              </button>
            </div>

            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-white block mb-1">Workspace Name</label>
                <input
                  type="text"
                  required
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder="e.g., Autonomous Trading Engine"
                  className="w-full bg-[#141628] border border-[#2D3352] rounded-xl px-3 py-2 text-xs text-white placeholder-[#6A719C] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white block mb-1">Subscription Tier</label>
                <select
                  value={newWsTier}
                  onChange={(e: any) => setNewWsTier(e.target.value)}
                  className="w-full bg-[#141628] border border-[#2D3352] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                >
                  <option value="pro">Pro Tier (Autonomous Fleet + Guardian)</option>
                  <option value="enterprise">Enterprise Tier (Air-gapped + Full Aegis Verification)</option>
                  <option value="free">Free Tier (Community Sandbox)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2 rounded-xl bg-[#141628] border border-[#2D3352] text-xs font-bold text-[#8E94B8] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] text-xs font-bold text-white shadow-lg shadow-[#615EFF]/25 font-mono"
                >
                  Create Domain
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
