import React, { useState, useEffect } from 'react';
import { ActiveTab } from '../types';
import { 
  Sparkles, Database, Bot, Zap, Cpu, Terminal, 
  Globe, Radio, Shield, CheckCircle2, ExternalLink, 
  Menu, Crown, Activity, Layers, Sliders, Layout
} from 'lucide-react';

interface AirbyteHeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  obsidianSyncStatus?: string;
  botModeActive?: boolean;
  onOpenQuickPrompt: () => void;
  isSidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  onOpenTour?: () => void;
  onToggleVoice?: () => void;
  freeModelsCount?: number;
  activeAgentsCount?: number;
  vaultsCount?: number;
  blockedCount?: number;
  latencyMs?: number;
  activeWorkspaceId?: string;
}

export const AirbyteHeader: React.FC<AirbyteHeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenQuickPrompt,
  isSidebarVisible,
  onToggleSidebar,
  onOpenTour,
  onToggleVoice,
  freeModelsCount = 29,
  activeAgentsCount = 7,
  vaultsCount = 4,
  blockedCount = 0,
  latencyMs = 34,
  activeWorkspaceId = 'ws-synthos-primary',
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  const getWorkspaceDetails = () => {
    switch (activeWorkspaceId) {
      case 'ws-research-sandbox':
        return { name: 'arXiv Lab', tier: 'STAGING', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' };
      case 'ws-growth-reach':
        return { name: 'Reach GTM', tier: 'VIRAL ENGINE', color: 'text-pink-400 border-pink-500/30 bg-pink-500/10' };
      default:
        return { name: 'Primary Fleet', tier: 'PRODUCTION', color: 'text-[#00D26A] border-[#00D26A]/30 bg-[#00D26A]/10' };
    }
  };

  const wsInfo = getWorkspaceDetails();

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}:${seconds}`);
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Top Status Cards (Requirement #3)
  const statusCards = [
    {
      name: 'ORCHESTRATOR',
      state: 'ACTIVE',
      stateColor: '#00D26A',
      metric: `${activeAgentsCount} agents`,
      onClick: () => setActiveTab('overview'),
    },
    {
      name: 'HERMES',
      state: 'CONNECTED',
      stateColor: '#615EFF',
      metric: 'Local',
      onClick: () => setActiveTab('hermes-core'),
    },
    {
      name: 'MODEL ROUTER',
      state: 'ONLINE',
      stateColor: '#38BDF8',
      metric: `${freeModelsCount} models`,
      onClick: () => setActiveTab('model-router'),
    },
    {
      name: 'MEMORY',
      state: 'SYNCED',
      stateColor: '#EC4899',
      metric: `${vaultsCount} vaults`,
      onClick: () => setActiveTab('obsidian'),
    },
    {
      name: 'GUARDIAN',
      state: 'ACTIVE',
      stateColor: '#F59E0B',
      metric: `${blockedCount} blocked`,
      onClick: () => setActiveTab('guardian-aegis'),
    },
    {
      name: 'LATENCY',
      state: `${latencyMs} ms`,
      stateColor: '#00D26A',
      metric: 'Optimal',
      onClick: () => setActiveTab('system-diagnostics'),
    },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#070812]/95 backdrop-blur-xl border-b border-[#181B2E] text-[#F3F4F9]">
      {/* Main Navigation & Telemetry Bar */}
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 h-16 py-2 flex items-center justify-between gap-4">
        {/* Left: Sidebar Toggle + Brand Logo */}
        <div className="flex items-center gap-3 select-none shrink-0">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-2 rounded-xl bg-[#0C0E1E] hover:bg-[#161B38] border border-[#1E2345] text-[#8E94B8] hover:text-white transition cursor-pointer flex items-center justify-center"
              title={isSidebarVisible ? "Collapse Left Navigation" : "Expand Left Navigation"}
            >
              <Menu className="w-5 h-5 text-[#8C8AFF]" />
            </button>
          )}

          <div 
            className="flex items-center gap-3 cursor-pointer select-none shrink-0 group"
            onClick={() => setActiveTab('overview')}
          >
            {/* Glowing Dual-Ring Logo */}
            <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-[#615EFF] via-[#8C8AFF] to-[#EC4899] p-0.5 shadow-[0_0_16px_rgba(97,94,255,0.4)] flex items-center justify-center transition-transform group-hover:scale-105">
              <div className="w-full h-full rounded-full bg-[#070812] flex items-center justify-center p-1">
                <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-[#615EFF] to-[#38BDF8] shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="font-extrabold text-xl tracking-tight text-white font-['Space_Grotesk']">
                SYNTHOS
              </span>
              <span className="text-xs font-mono text-[#787F9E] hidden sm:inline">
                / {wsInfo.name}
              </span>
              <span className={`text-[9px] font-mono font-bold px-2 py-0.5 border rounded-md uppercase ${wsInfo.color}`}>
                {wsInfo.tier}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Top Status Strip (Replacing Duplicate Navigation) */}
        <div className="hidden md:flex items-center gap-2 overflow-x-auto py-1 px-2 scrollbar-none">
          {statusCards.map((card) => (
            <button
              key={card.name}
              onClick={card.onClick}
              className="px-3 py-1.5 rounded-xl bg-[#0B0D1B] border border-[#1A1E36] hover:border-[#615EFF]/50 text-left transition cursor-pointer flex items-center gap-2.5 shrink-0 group"
              title={`View ${card.name} details`}
            >
              <div className="flex flex-col">
                <span className="text-[9px] font-mono font-bold text-[#6A7097] tracking-wider leading-tight group-hover:text-[#A5A2FF] transition-colors">
                  {card.name}
                </span>
                <div className="flex items-center gap-1.5 leading-tight">
                  <span 
                    className="w-1.5 h-1.5 rounded-full shrink-0 shadow-[0_0_6px_currentColor]" 
                    style={{ backgroundColor: card.stateColor }}
                  />
                  <span className="text-[11px] font-mono font-bold text-white">
                    {card.state}
                  </span>
                  <span className="text-[10px] font-mono text-[#8E94B8] pl-1 border-l border-[#1F2442]">
                    {card.metric}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Right: Quick Triggers & Telemetry */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Tour Button */}
          <button
            id="btn-restart-tour"
            onClick={onOpenTour}
            className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono font-bold text-white bg-gradient-to-r from-[#615EFF] to-[#38BDF8] px-3 py-1.5 rounded-full shadow-[0_0_10px_rgba(97,94,255,0.4)] hover:opacity-90 transition cursor-pointer"
            title="Start Interactive Guided Walkthrough"
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
            <span>TOUR</span>
          </button>

          {/* Clock */}
          <div className="hidden xl:flex items-center gap-1.5 bg-[#090B18] border border-[#1C2038] px-3 py-1.5 rounded-full text-xs font-mono text-[#8E94B8]">
            <span className="w-2 h-2 rounded-full bg-[#00D26A] animate-pulse" />
            <span className="text-white font-bold">{currentTime || '12:27:20'}</span>
          </div>

          {/* Jarvis Voice Orb Trigger */}
          <button
            id="header-jarvis-orb"
            onClick={onToggleVoice || (() => setActiveTab('jarvis'))}
            className="p-2 rounded-full bg-[#0F1124] hover:bg-[#1A1D3A] border border-[#615EFF]/50 text-[#A5A2FF] transition flex items-center justify-center relative group cursor-pointer"
            title="Jarvis Voice Assistant"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF5E8E] shadow-[0_0_8px_#FF5E8E] animate-pulse"></span>
          </button>

          {/* CMD+K Search Palette */}
          <button 
            id="header-search"
            onClick={onOpenQuickPrompt}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0F1122] hover:bg-[#181B34] border border-[#222744] text-xs text-[#8E94B8] hover:text-white transition font-mono cursor-pointer"
            title="Press Cmd+K for Command Palette"
          >
            <Zap className="w-3.5 h-3.5 text-[#615EFF]" />
            <span>CMD+K</span>
          </button>
        </div>
      </div>
    </header>
  );
};
