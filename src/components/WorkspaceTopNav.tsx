import React, { useState, useRef, useEffect } from 'react';
import { ActiveTab } from '../types';
import {
  LayoutDashboard, MessageSquare, Terminal, Radio, Layers, Bot, Zap, Kanban,
  Cpu, Server, Code2, Clock, Globe, HardDrive, Database, FileCheck, Sparkles,
  BarChart2, ShieldCheck, Activity, LineChart, FileText, Sliders, RefreshCw,
  ChevronDown, Check, Shield, CircleDot, GitMerge, Compass, Crown, Network,
  Lock, Eye, FolderKanban, Workflow, BrainCircuit, ListChecks
} from 'lucide-react';

export type WorkspaceType = 
  | 'hermes'
  | 'claude'
  | 'gemini'
  | 'codex'
  | 'cursor'
  | 'antigravity'
  | 'openclaw'
  | 'orchestrator';

interface WorkspaceTopNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  activeWorkspace?: WorkspaceType;
  gatewayStatus?: {
    running: boolean;
    pid: number;
    uptimeSec: number;
    version: string;
  };
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

interface WorkspaceConfig {
  name: string;
  badgeText: string;
  statusText: 'LIVE' | 'PARTIAL' | 'NOT CONNECTED' | 'MISSING';
  statusColor: string;
  accentColor: string;
  primaryTabs: NavItem[];
  moreTabs: NavItem[];
}

export const WorkspaceTopNav: React.FC<WorkspaceTopNavProps> = ({
  activeTab,
  setActiveTab,
  activeWorkspace,
  gatewayStatus = { running: true, pid: 14092, uptimeSec: 18420, version: '4.2.0-hermes-core' }
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

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

  // Determine current workspace
  const currentWorkspace: WorkspaceType = React.useMemo(() => {
    if (activeWorkspace) return activeWorkspace;
    if (activeTab.startsWith('hermes') || activeTab === 'hermes') return 'hermes';
    if (activeTab === 'agent-claude' || activeTab === 'claude' || activeTab === 'claudecode') return 'claude';
    if (activeTab === 'agent-gemini' || activeTab === 'gemini') return 'gemini';
    if (activeTab === 'agent-codex' || activeTab === 'codex') return 'codex';
    if (activeTab === 'agent-cursor' || activeTab === 'cursor') return 'cursor';
    if (activeTab === 'agent-antigravity' || activeTab === 'antigravity') return 'antigravity';
    if (activeTab === 'agent-openclaw' || activeTab === 'openclaw') return 'openclaw';
    if (activeTab === 'agent-orchestrator') return 'orchestrator';
    return 'hermes';
  }, [activeTab, activeWorkspace]);

  // Configurations for each workspace
  const configs: Record<WorkspaceType, WorkspaceConfig> = {
    hermes: {
      name: 'HERMES AGENTOS',
      badgeText: 'HERMES OS',
      statusText: 'LIVE',
      statusColor: '#00D26A',
      accentColor: '#615EFF',
      primaryTabs: [
        { id: 'hermes-core', label: 'Overview', icon: LayoutDashboard, color: '#A5A2FF' },
        { id: 'hermes-chat', label: 'Chat', icon: MessageSquare, color: '#615EFF', badge: 'LIVE', badgeColor: '#00D26A' },
        { id: 'hermes-terminal', label: 'Terminal', icon: Terminal, color: '#00D26A' },
        { id: 'hermes-apollo', label: 'Apollo Voice', shortLabel: 'Apollo', icon: Radio, color: '#FF5E8E' },
        { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
        { id: 'hermes-agents', label: 'Agents', icon: Bot, color: '#A5A2FF' },
        { id: 'hermes-bot-mode', label: 'Bot Mode', icon: Zap, color: '#F59E0B' },
        { id: 'hermes-kanban', label: 'Kanban', icon: Kanban, color: '#00D26A' },
      ],
      moreTabs: [
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
      ]
    },
    claude: {
      name: 'CLAUDE WORKSPACE',
      badgeText: 'CLAUDE 3.7',
      statusText: 'PARTIAL',
      statusColor: '#F59E0B',
      accentColor: '#F97316',
      primaryTabs: [
        { id: 'agent-claude', label: 'Overview', icon: LayoutDashboard, color: '#F97316' },
        { id: 'claude', label: 'Chat', icon: MessageSquare, color: '#F97316' },
        { id: 'claude-artifacts', label: 'Projects', icon: FolderKanban, color: '#38BDF8' },
        { id: 'kanban', label: 'Tasks', icon: Kanban, color: '#00D26A' },
        { id: 'claude-artifacts', label: 'Files', icon: FileCheck, color: '#A5A2FF' },
        { id: 'graph-runs', label: 'Runs', icon: Activity, color: '#EC4899' },
        { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
        { id: 'skill-registry', label: 'Tools', icon: Code2, color: '#615EFF' },
        { id: 'model-router', label: 'Models', icon: Sparkles, color: '#F97316' },
      ],
      moreTabs: [
        { id: 'guardian-aegis', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts', label: 'Receipts', icon: FileCheck, color: '#38BDF8' },
        { id: 'agent-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'hermes-analytics', label: 'Analytics', icon: BarChart2, color: '#00D26A' },
        { id: 'activity-ledger', label: 'Logs', icon: FileText, color: '#9AA2C6' },
      ]
    },
    gemini: {
      name: 'GEMINI WORKSPACE',
      badgeText: 'GEMINI 2.5',
      statusText: 'LIVE',
      statusColor: '#00D26A',
      accentColor: '#1A73E8',
      primaryTabs: [
        { id: 'agent-gemini', label: 'Overview', icon: LayoutDashboard, color: '#1A73E8' },
        { id: 'gemini', label: 'Chat', icon: MessageSquare, color: '#1A73E8', badge: 'LIVE', badgeColor: '#00D26A' },
        { id: 'content-library', label: 'Research', icon: Layers, color: '#38BDF8' },
        { id: 'gemini', label: 'Multimodal', icon: Sparkles, color: '#EC4899' },
        { id: 'kanban', label: 'Tasks', icon: Kanban, color: '#00D26A' },
        { id: 'claude-artifacts', label: 'Files', icon: FileCheck, color: '#A5A2FF' },
        { id: 'graph-runs', label: 'Runs', icon: Activity, color: '#EC4899' },
        { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
        { id: 'model-router', label: 'Models', icon: Sparkles, color: '#1A73E8' },
      ],
      moreTabs: [
        { id: 'guardian-aegis', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts', label: 'Receipts', icon: FileCheck, color: '#38BDF8' },
        { id: 'agent-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'hermes-analytics', label: 'Analytics', icon: BarChart2, color: '#00D26A' },
        { id: 'activity-ledger', label: 'Logs', icon: FileText, color: '#9AA2C6' },
      ]
    },
    codex: {
      name: 'CODEX WORKSPACE',
      badgeText: 'CODEX DEV',
      statusText: 'PARTIAL',
      statusColor: '#F59E0B',
      accentColor: '#00D26A',
      primaryTabs: [
        { id: 'agent-codex', label: 'Overview', icon: LayoutDashboard, color: '#00D26A' },
        { id: 'codex', label: 'Chat', icon: MessageSquare, color: '#00D26A' },
        { id: 'kanban', label: 'Tasks', icon: Kanban, color: '#00D26A' },
        { id: 'hermes-terminal', label: 'Terminal', icon: Terminal, color: '#38BDF8' },
        { id: 'claude-artifacts', label: 'Files', icon: FileCheck, color: '#A5A2FF' },
        { id: 'codex', label: 'Diffs', icon: Code2, color: '#F59E0B' },
        { id: 'graph-runs', label: 'Runs', icon: Activity, color: '#EC4899' },
        { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
        { id: 'model-router', label: 'Models', icon: Sparkles, color: '#00D26A' },
      ],
      moreTabs: [
        { id: 'guardian-aegis', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts', label: 'Receipts', icon: FileCheck, color: '#38BDF8' },
        { id: 'agent-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'hermes-analytics', label: 'Analytics', icon: BarChart2, color: '#00D26A' },
        { id: 'activity-ledger', label: 'Logs', icon: FileText, color: '#9AA2C6' },
      ]
    },
    cursor: {
      name: 'CURSOR WORKSPACE',
      badgeText: 'CURSOR IDE',
      statusText: 'NOT CONNECTED',
      statusColor: '#94A3B8',
      accentColor: '#A855F7',
      primaryTabs: [
        { id: 'agent-cursor', label: 'Overview', icon: LayoutDashboard, color: '#A855F7' },
        { id: 'cursor', label: 'Workspace', icon: Sliders, color: '#A855F7' },
        { id: 'cursor', label: 'Chat', icon: MessageSquare, color: '#38BDF8' },
        { id: 'kanban', label: 'Tasks', icon: Kanban, color: '#00D26A' },
        { id: 'claude-artifacts', label: 'Files', icon: FileCheck, color: '#A5A2FF' },
        { id: 'hermes-terminal', label: 'Terminal', icon: Terminal, color: '#38BDF8' },
        { id: 'codex', label: 'Diffs', icon: Code2, color: '#F59E0B' },
        { id: 'graph-runs', label: 'Runs', icon: Activity, color: '#EC4899' },
        { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
        { id: 'model-router', label: 'Models', icon: Sparkles, color: '#A855F7' },
      ],
      moreTabs: [
        { id: 'guardian-aegis', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts', label: 'Receipts', icon: FileCheck, color: '#38BDF8' },
        { id: 'agent-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'hermes-analytics', label: 'Analytics', icon: BarChart2, color: '#00D26A' },
        { id: 'activity-ledger', label: 'Logs', icon: FileText, color: '#9AA2C6' },
      ]
    },
    antigravity: {
      name: 'ANTIGRAVITY WORKSPACE',
      badgeText: 'DAG QUANT',
      statusText: 'PARTIAL',
      statusColor: '#F59E0B',
      accentColor: '#8A5CF5',
      primaryTabs: [
        { id: 'agent-antigravity', label: 'Overview', icon: LayoutDashboard, color: '#8A5CF5' },
        { id: 'graph-builder', label: 'Graph', icon: GitMerge, color: '#38BDF8' },
        { id: 'hermes-oracle', label: 'Quant', icon: BrainCircuit, color: '#EC4899' },
        { id: 'kanban', label: 'Tasks', icon: Kanban, color: '#00D26A' },
        { id: 'graph-runs', label: 'Runs', icon: Activity, color: '#EC4899' },
        { id: 'agent-fleet', label: 'Agents', icon: Bot, color: '#A5A2FF' },
        { id: 'guardian-aegis', label: 'Governance', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
        { id: 'model-router', label: 'Models', icon: Sparkles, color: '#8A5CF5' },
      ],
      moreTabs: [
        { id: 'guardian-aegis', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts', label: 'Receipts', icon: FileCheck, color: '#38BDF8' },
        { id: 'agent-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'hermes-analytics', label: 'Analytics', icon: BarChart2, color: '#00D26A' },
        { id: 'activity-ledger', label: 'Logs', icon: FileText, color: '#9AA2C6' },
      ]
    },
    openclaw: {
      name: 'OPENCLAW WORKSPACE',
      badgeText: 'CRAWLER MESH',
      statusText: 'PARTIAL',
      statusColor: '#F59E0B',
      accentColor: '#14B8A6',
      primaryTabs: [
        { id: 'agent-openclaw', label: 'Overview', icon: LayoutDashboard, color: '#14B8A6' },
        { id: 'openclaw', label: 'Chat', icon: MessageSquare, color: '#14B8A6' },
        { id: 'kanban', label: 'Tasks', icon: Kanban, color: '#00D26A' },
        { id: 'hermes-sessions', label: 'Sessions', icon: Layers, color: '#38BDF8' },
        { id: 'agent-fleet', label: 'Agents', icon: Bot, color: '#A5A2FF' },
        { id: 'skill-registry', label: 'Tools', icon: Code2, color: '#615EFF' },
        { id: 'telegram-chat', label: 'Channels', icon: Globe, color: '#20B2AA' },
        { id: 'schedule-cron', label: 'Schedules', icon: Clock, color: '#EC4899' },
        { id: 'activity-ledger', label: 'Logs', icon: FileText, color: '#9AA2C6' },
      ],
      moreTabs: [
        { id: 'guardian-aegis', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts', label: 'Receipts', icon: FileCheck, color: '#38BDF8' },
        { id: 'agent-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'hermes-analytics', label: 'Analytics', icon: BarChart2, color: '#00D26A' },
      ]
    },
    orchestrator: {
      name: 'ORCHESTRATOR WORKSPACE',
      badgeText: 'FLEET MASTER',
      statusText: 'LIVE',
      statusColor: '#00D26A',
      accentColor: '#EC4899',
      primaryTabs: [
        { id: 'agent-orchestrator', label: 'Overview', icon: LayoutDashboard, color: '#EC4899' },
        { id: 'kanban', label: 'Objectives', icon: ListChecks, color: '#00D26A' },
        { id: 'kanban', label: 'Tasks', icon: Kanban, color: '#38BDF8' },
        { id: 'agent-wireframe', label: 'Delegation', icon: Network, color: '#615EFF' },
        { id: 'graph-runs', label: 'Runs', icon: Activity, color: '#EC4899' },
        { id: 'agent-fleet', label: 'Agents', icon: Bot, color: '#A5A2FF' },
        { id: 'guardian-aegis', label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts', label: 'Receipts', icon: FileCheck, color: '#38BDF8' },
      ],
      moreTabs: [
        { id: 'agent-memory', label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'obsidian', label: 'Knowledge', icon: Database, color: '#EC4899' },
        { id: 'activity-ledger', label: 'Activity', icon: Activity, color: '#38BDF8' },
        { id: 'hermes-analytics', label: 'Analytics', icon: LineChart, color: '#615EFF' },
        { id: 'activity-ledger', label: 'Logs', icon: FileText, color: '#9AA2C6' },
      ]
    }
  };

  const activeConfig = configs[currentWorkspace] || configs.hermes;
  const isMoreActive = activeConfig.moreTabs.some(t => t.id === activeTab);
  const activeMoreItem = activeConfig.moreTabs.find(t => t.id === activeTab);

  return (
    <div className="w-full bg-[#080A16] border-b border-[#1A1D33] px-3 sm:px-6 py-2 shrink-0 relative z-30">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        
        {/* Left Badge & Workspace Context */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div 
              className="w-2.5 h-2.5 rounded-full shadow-lg animate-pulse" 
              style={{ 
                backgroundColor: activeConfig.accentColor,
                boxShadow: `0 0 10px ${activeConfig.accentColor}`
              }} 
            />
            <span className="text-xs font-bold text-white tracking-wider font-['Space_Grotesk']">
              {activeConfig.name}
            </span>
          </div>

          {/* Evidence-Based Status Pill */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#121528] border border-[#222744] text-[10px] font-mono">
            <span style={{ color: activeConfig.statusColor }}>●</span>
            <span className="font-bold tracking-wider" style={{ color: activeConfig.statusColor }}>
              {activeConfig.statusText}
            </span>
            {currentWorkspace === 'hermes' && (
              <>
                <span className="text-[#454B72]">|</span>
                <span className="text-[#8E94B8]">v{gatewayStatus.version}</span>
                <span className="text-[#454B72]">|</span>
                <span className="text-[#8E94B8]">PID:{gatewayStatus.pid}</span>
              </>
            )}
          </div>
        </div>

        {/* Top Navigation Tabs */}
        <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {activeConfig.primaryTabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id || (tab.id === 'hermes-core' && (activeTab === 'hermes' || activeTab === 'hermes-overview'));

            return (
              <button
                key={`${tab.id}-${tab.label}-${idx}`}
                id={`ws-top-${currentWorkspace}-${tab.label.toLowerCase()}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                  isActive
                    ? 'text-white shadow-md border'
                    : 'text-[#9AA2C6] hover:text-white hover:bg-[#121426] border border-transparent'
                }`}
                style={{
                  backgroundColor: isActive ? activeConfig.accentColor : undefined,
                  borderColor: isActive ? '#FFFFFF40' : undefined,
                }}
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
          {activeConfig.moreTabs.length > 0 && (
            <div className="relative shrink-0" ref={moreRef}>
              <button
                id={`ws-top-${currentWorkspace}-more-button`}
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
                  id={`ws-top-${currentWorkspace}-more-menu`}
                  className="absolute right-0 mt-1.5 w-64 max-h-[75vh] overflow-y-auto bg-[#0B0D1E] border border-[#272C4E] rounded-xl shadow-2xl p-1.5 z-50 divide-y divide-[#171A30]"
                >
                  <div className="px-2 py-1.5 text-[10px] font-bold text-[#62688F] uppercase font-mono tracking-wider">
                    Extended Controls ({activeConfig.moreTabs.length})
                  </div>

                  <div className="py-1 space-y-0.5">
                    {activeConfig.moreTabs.map((tab, idx) => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.id;

                      return (
                        <button
                          key={`${tab.id}-${tab.label}-${idx}`}
                          id={`ws-more-${currentWorkspace}-${tab.label.toLowerCase().replace(/\s+/g, '-')}`}
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
          )}
        </div>

      </div>
    </div>
  );
};
