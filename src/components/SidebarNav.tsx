import React, { useState, useEffect } from 'react';
import { ActiveTab, AIModelInfo, AgentInfo } from '../types';
import { 
  LayoutDashboard, Layers, GitMerge, Database, Globe, Sliders, 
  ChevronLeft, ChevronRight, ChevronDown, Menu, Kanban, Activity, Bot, 
  HardDrive, Terminal, ShieldCheck, CheckCircle2, FileCheck, 
  Building2, Server, HelpCircle, Command, Sparkles, Network, Code2, Crown,
  Volume2, Radio, MessageSquare, Clock, BarChart2, RefreshCw, Cpu,
  Shield, CheckSquare, Lock, Key, Zap, Flame, Compass, Box, UserCheck
} from 'lucide-react';

interface SidebarNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  models: Record<string, AIModelInfo>;
  agents: Record<string, AgentInfo>;
  notesCount: number;
  botTaskCount: number;
  kanbanTaskCount: number;
  isVisible?: boolean;
  onToggleVisible?: () => void;
  onOpenHelp?: () => void;
  activeWorkspaceId?: string;
  onSwitchWorkspace?: (workspaceId: string) => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  setActiveTab,
  notesCount,
  kanbanTaskCount,
  isVisible = true,
  onOpenHelp,
  activeWorkspaceId = 'ws-synthos-primary',
  onSwitchWorkspace
}) => {
  // Collapsed rail state persisted locally, default to FALSE for clear navigation accessibility
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('synthos_sidebar_collapsed');
      return saved !== null ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  // Collapsible section state persisted locally
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('synthos_nav_expanded_sections');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      'OPERATIONS': true,
      'WORKSPACES': true,
      'BUILD': true,
      'KNOWLEDGE': true,
      'GOVERNANCE': true,
      'PRODUCTS': false,
      'SYSTEM': false,
      'MASTER ADMIN': true,
    };
  });

  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem('synthos_sidebar_collapsed', JSON.stringify(isCollapsed));
    } catch (e) {
      console.warn('Could not persist sidebar collapse:', e);
    }
  }, [isCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem('synthos_nav_expanded_sections', JSON.stringify(expandedSections));
    } catch (e) {
      console.warn('Could not persist expanded sections:', e);
    }
  }, [expandedSections]);

  const toggleSection = (category: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Canonical Navigation Structure
  const navigationGroups = [
    {
      category: 'OPERATIONS',
      items: [
        { id: 'overview' as ActiveTab, label: 'Overview', icon: LayoutDashboard, color: '#A5A2FF' },
        { id: 'kanban' as ActiveTab, label: 'Kanban', icon: Kanban, badge: '6 Stg', color: '#00D26A' },
        { id: 'graph-runs' as ActiveTab, label: 'Active Runs', icon: Activity, color: '#EC4899' },
        { id: 'agent-wireframe' as ActiveTab, label: 'Agent Wireframe', icon: Network, color: '#615EFF' },
        { id: 'guardian-aegis' as ActiveTab, label: 'Approvals', icon: ShieldCheck, color: '#F59E0B' },
        { id: 'receipts' as ActiveTab, label: 'Results & Receipts', icon: FileCheck, color: '#38BDF8' },
      ]
    },
    {
      category: 'WORKSPACES',
      isWorkspaces: true,
      items: [
        { id: 'agent-orchestrator' as ActiveTab, label: 'Orchestrator', icon: Crown, statusTag: 'LIVE', color: '#EC4899' },
        { id: 'hermes-core' as ActiveTab, label: 'Hermes', icon: Cpu, statusTag: 'LIVE', color: '#615EFF' },
        { id: 'agent-claude' as ActiveTab, label: 'Claude', icon: Sparkles, statusTag: 'PARTIAL', color: '#F97316' },
        { id: 'agent-gemini' as ActiveTab, label: 'Gemini', icon: Sparkles, statusTag: 'LIVE', color: '#1A73E8' },
        { id: 'agent-codex' as ActiveTab, label: 'Codex', icon: Code2, statusTag: 'PARTIAL', color: '#00D26A' },
        { id: 'agent-cursor' as ActiveTab, label: 'Cursor', icon: Terminal, statusTag: 'NOT CONNECTED', color: '#A855F7' },
        { id: 'agent-antigravity' as ActiveTab, label: 'Antigravity', icon: Compass, statusTag: 'PARTIAL', color: '#8A5CF5' },
        { id: 'agent-openclaw' as ActiveTab, label: 'OpenClaw', icon: Globe, statusTag: 'PARTIAL', color: '#14B8A6' },
      ]
    },
    {
      category: 'BUILD',
      items: [
        { id: 'graph-builder' as ActiveTab, label: 'Graph Builder', icon: GitMerge, color: '#38BDF8' },
        { id: 'graph-runs' as ActiveTab, label: 'Graph Runtime', icon: Activity, color: '#EC4899' },
        { id: 'skill-registry' as ActiveTab, label: 'Skills Registry', icon: Cpu, color: '#615EFF' },
        { id: 'bot-mode' as ActiveTab, label: 'Automation', icon: Terminal, color: '#F59E0B' },
        { id: 'startup-generator' as ActiveTab, label: 'Launchpad', icon: Zap, color: '#00D26A' },
      ]
    },
    {
      category: 'KNOWLEDGE',
      items: [
        { id: 'agent-memory' as ActiveTab, label: 'Memory', icon: HardDrive, color: '#8C8AFF' },
        { id: 'obsidian' as ActiveTab, label: 'Obsidian / Vault', icon: Database, badge: `${notesCount}`, color: '#EC4899' },
        { id: 'hermes-oracle' as ActiveTab, label: 'Intelligence', icon: Sparkles, color: '#A5A2FF' },
        { id: 'lead-scraper' as ActiveTab, label: 'Radar', icon: Globe, color: '#20B2AA' },
        { id: 'content-library' as ActiveTab, label: 'Research Library', icon: Layers, color: '#38BDF8' },
      ]
    },
    {
      category: 'GOVERNANCE',
      items: [
        { id: 'guardian-aegis' as ActiveTab, label: 'Guardian Gate', icon: Shield, color: '#F59E0B' },
        { id: 'system-audit' as ActiveTab, label: 'Aegis Verifier', icon: ShieldCheck, color: '#00D26A' },
        { id: 'receipts' as ActiveTab, label: 'Cryptographic Receipts', icon: FileCheck, color: '#38BDF8' },
        { id: 'activity-ledger' as ActiveTab, label: 'Activity Ledger', icon: Activity, color: '#A5A2FF' },
        { id: 'policies' as ActiveTab, label: 'Operating Policies', icon: Lock, color: '#EC4899' },
      ]
    },
    {
      category: 'PRODUCTS',
      items: [
        { id: 'twins' as ActiveTab, label: 'Twins Concierge', icon: Sparkles, color: '#A5A2FF' },
        { id: 'ton' as ActiveTab, label: 'TON Network', icon: Globe, color: '#0088CC' },
        { id: 'demos' as ActiveTab, label: 'Product Demos', icon: Code2, color: '#00D26A' },
        { id: 'workspaces' as ActiveTab, label: 'Customer Workspaces', icon: Building2, color: '#F59E0B' },
      ]
    },
    {
      category: 'SYSTEM',
      items: [
        { id: 'jarvis' as ActiveTab, label: 'Jarvis Executive Hub', icon: Sparkles, color: '#EAB308' },
        { id: 'model-router' as ActiveTab, label: 'Model Arbitration', icon: Sliders, color: '#38BDF8' },
        { id: 'hermes-mcps' as ActiveTab, label: 'MCP Registry', icon: Server, color: '#F59E0B' },
        { id: 'message-bridge' as ActiveTab, label: 'Integrations & Bridge', icon: Network, color: '#615EFF' },
        { id: 'users-roles' as ActiveTab, label: 'Users & Roles', icon: UserCheck, color: '#00D26A' },
        { id: 'hermes-analytics' as ActiveTab, label: 'Usage & Costs', icon: BarChart2, color: '#00D26A' },
        { id: 'upstream-registry' as ActiveTab, label: 'Upstream Watchers', icon: Crown, color: '#D97706' },
        { id: 'settings' as ActiveTab, label: 'System Settings', icon: Sliders, color: '#9AA2C6' },
      ]
    },
    {
      category: 'MASTER ADMIN',
      items: [
        { id: 'master-admin-walkthrough' as ActiveTab, label: '12-Step Walkthrough', icon: CheckSquare, badge: 'SETUP', color: '#615EFF' },
        { id: 'master-admin-platform' as ActiveTab, label: 'Platform & Port 3000', icon: Server, color: '#38BDF8' },
        { id: 'master-admin-providers' as ActiveTab, label: 'Providers Matrix', icon: Zap, color: '#EAB308' },
        { id: 'master-admin-hermes' as ActiveTab, label: 'Hermes Admin', icon: Cpu, badge: 'v3.2', color: '#EC4899' },
        { id: 'master-admin-voice' as ActiveTab, label: 'Voice & Apollo', icon: Radio, color: '#FF5E8E' },
        { id: 'master-admin-mcps' as ActiveTab, label: 'MCPs & Tools', icon: Terminal, color: '#F59E0B' },
        { id: 'master-admin-storage' as ActiveTab, label: 'Storage & Vaults', icon: HardDrive, color: '#8C8AFF' },
        { id: 'master-admin-database' as ActiveTab, label: 'Database (board.db)', icon: Database, color: '#00D26A' },
        { id: 'master-admin-security' as ActiveTab, label: 'Security & Guardian', icon: Shield, color: '#F59E0B' },
        { id: 'master-admin-health' as ActiveTab, label: 'Health & Ping', icon: BarChart2, color: '#00D26A' },
        { id: 'master-admin-audit' as ActiveTab, label: '32-Step Audit', icon: FileCheck, color: '#38BDF8' },
      ]
    }
  ];

  return (
    <>
      {/* Mobile Drawer Button */}
      <div className="md:hidden fixed bottom-4 left-4 z-40">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="p-3 bg-[#615EFF] text-white rounded-full shadow-2xl flex items-center justify-center cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-xs z-50"
        />
      )}

      {/* Rail Navigation Sidebar */}
      <aside
        className={`fixed md:sticky md:top-[73px] h-screen md:h-[calc(100vh-73px)] top-0 bottom-0 left-0 z-40 bg-[#060710] border-r border-[#151728] flex flex-col justify-between transition-all duration-300 font-mono shrink-0 select-none ${
          isMobileOpen
            ? 'translate-x-0 w-64 p-3 z-50'
            : isVisible
              ? '-translate-x-full md:translate-x-0'
              : '-translate-x-full md:hidden'
        } ${isVisible && isCollapsed ? 'md:w-14 md:p-2' : isVisible ? 'md:w-64 md:p-3' : ''}`}
      >
        {/* Top Header & Collapse Toggle */}
        <div className="flex items-center justify-between pb-3 border-b border-[#151728] shrink-0">
          {!isCollapsed ? (
            <div className="flex items-center gap-2 px-1">
              <div className="w-3 h-3 rounded-full bg-[#615EFF] shadow-[0_0_8px_#615EFF]" />
              <span className="text-xs font-bold text-white tracking-tight font-['Space_Grotesk']">SYNTHOS AGENTOS</span>
            </div>
          ) : (
            <div className="w-full flex justify-center">
              <div className="w-3 h-3 rounded-full bg-[#615EFF] shadow-[0_0_8px_#615EFF]" />
            </div>
          )}

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden md:flex items-center justify-center w-6 h-6 rounded-lg bg-[#121424] border border-[#232742] text-[#8E94B8] hover:text-white hover:border-[#615EFF] transition cursor-pointer"
            title={isCollapsed ? 'Expand Navigation' : 'Collapse Navigation'}
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>
        
        {/* Environment Selector Dropdown for Left Rail */}
        {!isCollapsed && (
          <div className="py-2 px-2 border-b border-[#151728] space-y-1 shrink-0 bg-[#080916]/60">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold text-[#555A7E] uppercase block font-mono tracking-wider">
                ENVIRONMENT
              </span>
              <span className="text-[9px] font-mono text-[#00D26A] font-bold">● ONLINE</span>
            </div>
            <select
              value={activeWorkspaceId}
              onChange={(e) => {
                if (onSwitchWorkspace) {
                  onSwitchWorkspace(e.target.value);
                }
              }}
              className="w-full bg-[#05060D] text-[11px] font-bold text-[#A5A2FF] hover:text-white border border-[#1E2240] focus:border-[#615EFF] rounded-lg px-2 py-1.5 outline-hidden transition cursor-pointer font-sans"
            >
              <option value="ws-synthos-primary">Primary Fleet (Prod)</option>
              <option value="ws-research-sandbox">arXiv Sandbox (Stg)</option>
              <option value="ws-growth-reach">GTM Viral Engine (Dev)</option>
            </select>
          </div>
        )}

        {/* Navigation Items Grouped by Canonical Categories */}
        <div className="flex-1 overflow-y-auto py-2 space-y-2.5 scrollbar-thin">
          {navigationGroups.map((group) => {
            const isExpanded = expandedSections[group.category] ?? true;

            return (
              <div key={group.category} className="space-y-0.5">
                {/* Group Collapsible Header */}
                {!isCollapsed && (
                  <button
                    onClick={() => toggleSection(group.category)}
                    className="w-full flex items-center justify-between px-2.5 py-1 text-[9px] font-mono tracking-wider font-bold text-[#6C7293] hover:text-slate-200 uppercase rounded cursor-pointer transition"
                  >
                    <span>{group.category}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
                  </button>
                )}

                {/* Group Content (expanded or collapsed) */}
                {(isExpanded || isCollapsed) && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id || (item.hasSubMenu && activeTab.startsWith('hermes-'));

                      return (
                        <div key={item.id} className="space-y-0.5">
                          <button
                            id={`nav-${item.id}`}
                            onClick={() => {
                              setActiveTab(item.id);
                              setIsMobileOpen(false);
                            }}
                            className={`group relative w-full flex items-center ${
                              isCollapsed ? 'justify-center p-2.5' : 'justify-between px-2.5 py-1.5'
                            } rounded-xl text-xs font-medium transition cursor-pointer select-none ${
                              isActive
                                ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/30 font-bold'
                                : 'text-[#9AA2C6] hover:bg-[#121424] hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Icon
                                className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:scale-110"
                                style={{ color: isActive ? '#FFFFFF' : item.color }}
                              />
                              {!isCollapsed && <span className="truncate">{item.label}</span>}
                            </div>

                            {!isCollapsed && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                {item.statusTag && (
                                  <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded font-bold border ${
                                    item.statusTag === 'LIVE'
                                      ? 'bg-[#00D26A]/10 text-[#00D26A] border-[#00D26A]/30'
                                      : item.statusTag === 'PARTIAL'
                                        ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30'
                                        : item.statusTag === 'NOT CONNECTED'
                                          ? 'bg-[#94A3B8]/10 text-[#94A3B8] border-[#94A3B8]/30'
                                          : 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/30'
                                  }`}>
                                    {item.statusTag}
                                  </span>
                                )}
                                {item.badge && (
                                  <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded font-bold ${
                                    isActive ? 'bg-black/30 text-white' : 'bg-[#181B2E] text-[#8C8AFF]'
                                  }`}>
                                    {item.badge}
                                  </span>
                                )}
                              </div>
                            )}

                            {isCollapsed && (
                              <div className="absolute left-full ml-2 px-2.5 py-1 bg-[#121424] border border-[#272B48] text-white text-xs font-semibold rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                                {item.label}
                              </div>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="pt-2 border-t border-[#151728] flex items-center justify-between px-1 text-[10px] text-[#8E94B8] shrink-0">
          {!isCollapsed && <span>SYNTHOS v3.2</span>}
          {onOpenHelp && (
            <button 
              onClick={onOpenHelp}
              className="p-1.5 rounded-lg bg-[#121424] text-[#8E94B8] hover:text-white transition cursor-pointer"
              title="Page Information & Guide"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
};
