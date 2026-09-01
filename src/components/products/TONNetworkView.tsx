import React, { useState } from 'react';
import { 
  Globe, ShieldCheck, Wallet, MessageSquare, BarChart3, 
  GitMerge, Zap, CheckCircle2, AlertTriangle, Layers, 
  ArrowUpRight, RefreshCw, Activity, Terminal
} from 'lucide-react';

interface TONCapability {
  id: string;
  name: string;
  description: string;
  status: 'LIVE' | 'PARTIAL' | 'UI ONLY' | 'MOCK' | 'MISSING';
  statusDetail: string;
  actionLabel?: string;
}

export const TONNetworkView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'wallets' | 'miniapp' | 'guardians' | 'graph' | 'analytics'>('overview');

  const capabilities: TONCapability[] = [
    {
      id: 'wallets',
      name: 'TON Connect Wallets',
      description: 'Tonkeeper & MyTonWallet bindings for automated smart contract dispatches and token micro-transactions.',
      status: 'PARTIAL',
      statusDetail: 'Wallet connection UI & Tonkeeper adapter ready; mainnet transactions require user key signature.',
      actionLabel: 'Connect Wallet'
    },
    {
      id: 'miniapp',
      name: 'Telegram Mini App (v2.4)',
      description: 'Embedded Telegram Mini App container for mobile agent interaction inside Telegram threads.',
      status: 'UI ONLY',
      statusDetail: 'Responsive Telegram WebApp frame rendered; Telegram Bot Token needs configuration in Settings.',
      actionLabel: 'Open Mini App Preview'
    },
    {
      id: 'guardians',
      name: 'TON Guardian Node Readiness',
      description: 'Distributed consensus verification nodes enforcing execution bounds on agent transaction payloads.',
      status: 'MOCK',
      statusDetail: '8/8 Guardian nodes simulated in local memory; RPC node validation mock active.',
      actionLabel: 'Run Guardian Audit'
    },
    {
      id: 'graph',
      name: 'TON Graph Operations',
      description: 'Decentralized indexing and GraphQL query pipelines for tracking TON smart contract state changes.',
      status: 'PARTIAL',
      statusDetail: 'GraphQL query schema defined; connects to TON Center public RPC endpoints.',
      actionLabel: 'Run GraphQL Query'
    },
    {
      id: 'analytics',
      name: 'TON Referral & Growth Analytics',
      description: 'Viral referral loops and on-chain user acquisition metrics for Telegram Mini App campaigns.',
      status: 'MOCK',
      statusDetail: 'Referral tracking dashboard powered by simulated event stream.',
      actionLabel: 'View Referral Tree'
    }
  ];

  const getStatusBadge = (status: TONCapability['status']) => {
    switch (status) {
      case 'LIVE':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/40">LIVE</span>;
      case 'PARTIAL':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40">PARTIAL</span>;
      case 'UI ONLY':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#A5A2FF]/20 text-[#A5A2FF] border border-[#A5A2FF]/40">UI ONLY</span>;
      case 'MOCK':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40">MOCK</span>;
      case 'MISSING':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#FF5E8E]/20 text-[#FF5E8E] border border-[#FF5E8E]/40">MISSING</span>;
    }
  };

  return (
    <div className="space-y-6 font-mono pb-12">
      {/* Product Banner */}
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
                TON Mission Control: Wallets (Tonkeeper/MyTonWallet), Guardians, Telegram Mini App, Analytics & Graph Operations.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="px-3 py-1 rounded-lg bg-[#0088CC]/20 text-[#0088CC] font-bold border border-[#0088CC]/30">
              TON MAINNET: CONNECTED
            </span>
            <span className="px-3 py-1 rounded-lg bg-[#00D26A]/20 text-[#00D26A] font-bold border border-[#00D26A]/30">
              GUARDIANS: 8/8 READY
            </span>
          </div>
        </div>

        {/* Quick Nav Tabs */}
        <div className="flex border-t border-[#0088CC]/20 pt-4 text-xs gap-2 overflow-x-auto scrollbar-none">
          {[
            { id: 'overview', label: 'OVERVIEW & STATUS' },
            { id: 'wallets', label: 'WALLETS' },
            { id: 'miniapp', label: 'TELEGRAM MINI APP' },
            { id: 'guardians', label: 'GUARDIANS' },
            { id: 'graph', label: 'GRAPH OPERATIONS' },
            { id: 'analytics', label: 'GROWTH & REFERRALS' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[#0088CC] text-white shadow-lg shadow-[#0088CC]/25'
                  : 'bg-[#0B0D1B] text-[#8E94B8] hover:text-white border border-[#1F2442]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">
            TON Ecosystem Feature Audit & Real Capabilities
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {capabilities.map((cap) => (
              <div 
                key={cap.id} 
                className="bg-[#0B0D1B] border border-[#1D2139] hover:border-[#0088CC]/50 rounded-2xl p-5 space-y-3 transition flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white font-['Space_Grotesk']">{cap.name}</h3>
                    {getStatusBadge(cap.status)}
                  </div>
                  <p className="text-xs text-[#A3A8CC] font-sans leading-relaxed">{cap.description}</p>
                </div>

                <div className="pt-3 border-t border-[#171A2E] space-y-2">
                  <div className="text-[11px] text-[#8E94B8] font-sans flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0 mt-0.5" />
                    <span>{cap.statusDetail}</span>
                  </div>

                  {cap.actionLabel && (
                    <button className="w-full py-2 bg-[#0088CC]/20 border border-[#0088CC]/40 hover:bg-[#0088CC] text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer">
                      <span>{cap.actionLabel}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'wallets' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Wallet className="w-6 h-6 text-[#0088CC]" />
            <div>
              <h2 className="text-base font-bold text-white">TON Wallet Binding & Micro-Transactions</h2>
              <p className="text-xs text-[#8E94B8] font-sans">Tonkeeper & MyTonWallet integration for agent execution rewards.</p>
            </div>
          </div>

          <div className="p-4 bg-[#070811] rounded-xl border border-[#151728] space-y-2 text-xs">
            <div className="flex justify-between items-center text-[#00D26A]">
              <span>Tonkeeper Wallet Binding:</span>
              <span className="font-bold">EQA...9x2F (Active)</span>
            </div>
            <div className="flex justify-between items-center text-[#38BDF8]">
              <span>MyTonWallet Binding:</span>
              <span className="font-bold">EQD...3m8B (Standby)</span>
            </div>
            <div className="flex justify-between items-center text-[#8E94B8]">
              <span>On-Chain Balance:</span>
              <span className="text-white font-bold">142.50 TON</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'miniapp' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-6 h-6 text-[#229ED9]" />
            <div>
              <h2 className="text-base font-bold text-white">Telegram Mini App Container</h2>
              <p className="text-xs text-[#8E94B8] font-sans">Run Hermes commands directly inside Telegram chats.</p>
            </div>
          </div>

          <div className="aspect-video max-w-lg mx-auto bg-[#070811] border border-[#229ED9]/40 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs border-b border-[#1A1E36] pb-2 text-[#229ED9]">
              <span className="font-bold">Telegram Mini App v2.4</span>
              <span className="text-[10px] bg-[#229ED9]/20 px-2 py-0.5 rounded">PREVIEW FRAME</span>
            </div>
            <div className="text-center space-y-2 py-6">
              <MessageSquare className="w-10 h-10 text-[#229ED9] mx-auto animate-bounce" />
              <div className="text-xs font-bold text-white">Connected to #orchestrator-bridge</div>
              <div className="text-[11px] text-[#8E94B8]">Ready to process natural language directives.</div>
            </div>
            <button className="w-full py-2 bg-[#229ED9] text-white font-bold text-xs rounded-xl shadow-lg cursor-pointer">
              Launch Mini App Interface
            </button>
          </div>
        </div>
      )}

      {(activeTab === 'guardians' || activeTab === 'graph' || activeTab === 'analytics') && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 text-center space-y-3">
          <Activity className="w-8 h-8 text-[#0088CC] mx-auto" />
          <h3 className="text-sm font-bold text-white uppercase">{activeTab} Workspace Module</h3>
          <p className="text-xs text-[#8E94B8] max-w-md mx-auto font-sans">
            Fully backed by local simulated event stream and ready for full TON RPC Node production binding.
          </p>
        </div>
      )}
    </div>
  );
};
