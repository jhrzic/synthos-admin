import React, { useState, useRef, useEffect } from 'react';
import { ActiveTab } from '../types';
import { useHermesHealth } from '../hooks/useHermesHealth';
import {
  LayoutDashboard, MessageSquare, Terminal, Radio, Layers, Bot, Zap, Kanban,
  Cpu, Server, Code2, Clock, Globe, HardDrive, Database, FileCheck, Sparkles,
  BarChart2, ShieldCheck, Activity, LineChart, FileText, Sliders, RefreshCw,
  ChevronDown, Check, Shield, CircleDot, Play
} from 'lucide-react';

interface HermesTopNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

interface NavItem {
  id: ActiveTab;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  badge?: string;
  badgeColor?: string;
}

export const HermesTopNav: React.FC<HermesTopNavProps> = ({
  activeTab,
  setActiveTab,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const { health } = useHermesHealth(15000);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Primary Visible Tabs
  const primaryTabs: NavItem[] = [
    { id: 'hermes-core', label: 'Overview', icon: LayoutDashboard, color: '#A5A2FF' },
    { id: 'hermes-chat', label: 'Chat', icon: MessageSquare, color: '#615EFF' },
    { id: 'hermes-terminal', label: 'Terminal', icon: Terminal, color: '#00D26A' },
    { id: 'hermes-apollo', label: 'Apollo Voice', shortLabel: 'Apollo', icon: Radio, color: '#FF5E8E' },
    { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
    { id: 'hermes-agents', label: 'Agents', icon: Bot, color: '#A5A2FF' },
    { id: 'hermes-bot-mode', label: 'Bot Mode', icon: Zap, color: '#F59E0B' },
    { id: 'hermes-kanban', label: 'Kanban', icon: Kanban, color: '#00D26A' },
  ];

  // Secondary Tabs inside More Dropdown
  const moreTabs: NavItem[] = [
    { id: 'hermes-skills', label: 'Skills', icon: Cpu, color: '#615EFF' },
    { id: 'hermes-mcps', label: 'MCPs', icon: Server, color: '#F59E0B' },
    { id: 'hermes-tools', label: 'Tools', icon: Code2, color: '#38BDF8' },
    { id: 'hermes-cron', label: 'Schedules / Cron', icon: Clock, color: '#EC4899' },
    { id: 'hermes-channels', label: 'Channels', icon: Globe, color: '#20B2AA' },
    { id: 'hermes-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
    { id: 'hermes-knowledge', label: 'Knowledge', icon: Database, color: '#EC4899' },
    { id: 'hermes-files', label: 'Files / Workspace', icon: FileCheck, color: '#38BDF8' },
    { id: 'hermes-models', label: 'Models', icon: Sparkles, color: '#A5A2FF' },
    { id: 'hermes-usage', label: 'Usage / Tokens', icon: BarChart2, color: '#00D26A' },
    { id: 'hermes-approvals', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
    { id: 'hermes-activity', label: 'Activity', icon: Activity, color: '#38BDF8' },
    { id: 'hermes-analytics', label: 'Analytics', icon: LineChart, color: '#615EFF' },
    { id: 'hermes-logs', label: 'Logs', icon: FileText, color: '#9AA2C6' },
    { id: 'hermes-gateway', label: 'Gateway / Runtime', icon: CircleDot, color: '#00D26A' },
    { id: 'hermes-manage', label: 'Manage / Config', icon: Sliders, color: '#9AA2C6' },
    { id: 'hermes-updates', label: 'Updates', icon: RefreshCw, color: '#D97706' },
  ];

  const isMoreActive = moreTabs.some(t => t.id === activeTab);
  const activeMoreItem = moreTabs.find(t => t.id === activeTab);

  return (
    <div className="w-full bg-[#080A16] border-b border-[#1A1D33] px-3 sm:px-6 py-2 shrink-0 relative z-30">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        
        {/* Left Badge & Workspace Context */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#615EFF] shadow-[0_0_10px_#615EFF] animate-pulse" />
            <span className="text-xs font-bold text-white tracking-wider font-['Space_Grotesk']">HERMES AGENTOS</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#121528] border border-[#222744] text-[10px] font-mono">
            <span style={{ 
              color: health.status === 'UP' ? '#00D26A' : 
                     health.status === 'DEGRADED' ? '#F59E0B' :
                     health.status === 'DOWN' ? '#EF4444' :
                     health.status === 'AUTH_ERROR' ? '#EF4444' : '#8E94B8' 
            }}>●</span>
            <span className="font-bold tracking-wider" style={{ 
              color: health.status === 'UP' ? '#00D26A' : 
                     health.status === 'DEGRADED' ? '#F59E0B' :
                     health.status === 'DOWN' ? '#EF4444' :
                     health.status === 'AUTH_ERROR' ? '#EF4444' : '#8E94B8' 
            }}>
              {health.status}
            </span>
            <span className="text-[#454B72]">|</span>
            <span className="text-[#8E94B8]">
              v{health.runtime_version}
            </span>
            {health.runtime_instance_id !== 'NOT_AVAILABLE' && health.runtime_instance_id !== 'UNKNOWN' && (
              <>
                <span className="text-[#454B72]">|</span>
                <span className="text-[#8E94B8]">ID:{health.runtime_instance_id}</span>
              </>
            )}
          </div>
        </div>

        {/* Top Navigation Tabs */}
        <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id || (tab.id === 'hermes-core' && (activeTab === 'hermes' || activeTab === 'hermes-overview'));

            return (
              <button
                key={tab.id}
                id={`hermes-top-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-[#615EFF] text-white shadow-md shadow-[#615EFF]/30 border border-[#7B78FF]'
                    : 'text-[#9AA2C6] hover:text-white hover:bg-[#121426] border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: isActive ? '#FFFFFF' : tab.color }} />
                <span>{tab.shortLabel || tab.label}</span>
                {tab.badge && (
                  <span className={`text-[8px] font-mono px-1 py-0.2 rounded font-bold ${
                    isActive ? 'bg-black/30 text-white' : 'bg-[#00D26A]/20 text-[#00D26A]'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* More ▾ Dropdown */}
          <div className="relative shrink-0" ref={moreRef}>
            <button
              id="hermes-top-more-button"
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                isMoreActive
                  ? 'bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/60 shadow-sm'
                  : 'text-[#9AA2C6] hover:text-white hover:bg-[#121426] border border-[#1E2240]'
              }`}
            >
              <span>{activeMoreItem ? `More: ${activeMoreItem.label}` : 'More'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isMoreOpen ? 'rotate-180 text-white' : 'text-[#9AA2C6]'}`} />
            </button>

            {/* Dropdown Menu */}
            {isMoreOpen && (
              <div 
                id="hermes-top-more-menu"
                className="absolute right-0 mt-1.5 w-64 max-h-[75vh] overflow-y-auto bg-[#0B0D1E] border border-[#272C4E] rounded-xl shadow-2xl p-1.5 z-50 divide-y divide-[#171A30]"
              >
                <div className="px-2 py-1.5 text-[10px] font-bold text-[#62688F] uppercase font-mono tracking-wider">
                  Extended Hermes Controls ({moreTabs.length})
                </div>

                <div className="py-1 space-y-0.5">
                  {moreTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;

                    return (
                      <button
                        key={tab.id}
                        id={`hermes-more-${tab.id}`}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setIsMoreOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                          isActive
                            ? 'bg-[#615EFF] text-white font-bold shadow-sm'
                            : 'text-[#9AA2C6] hover:bg-[#151933] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: isActive ? '#FFFFFF' : tab.color }} />
                          <span>{tab.label}</span>
                        </div>
                        {isActive && <Check className="w-3.5 h-3.5 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
