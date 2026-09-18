import React, { useState, useEffect } from 'react';
import { ActiveTab, AIModelInfo, AgentInfo, KANBAN_COLUMN_IDS } from '../types';
import { navGroupsFor, isDestinationActive, NAV_DESTINATIONS } from '../navigation/canonical-nav';
import { BuildIdentityFooter } from './BuildIdentityFooter';
import { useAuthority } from '../authority/AuthorityContext';
import { 
  LayoutDashboard, Layers, GitMerge, Database, Globe, Sliders, 
  ChevronLeft, ChevronRight, ChevronDown, Menu, Kanban, Activity, Bot, 
  HardDrive, Terminal, ShieldCheck, CheckCircle2, FileCheck, 
  Building2, Server, HelpCircle, Command, Sparkles, Network, Code2, Crown,
  Volume2, Radio, MessageSquare, Clock, BarChart2, RefreshCw, Cpu,
  Shield, CheckSquare, Key, Zap, Flame, Compass, Box, UserCheck, Search, Wrench
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
  /** Real, authenticated user's own workspace memberships (Pass IV / E1) — never a hardcoded sample list. */
  authorizedWorkspaces?: Array<{ workspace_id: string; workspace_name: string }>;
  /** The signed-in user's platform role; platform-admin destinations are hidden from others (the server enforces it too). */
  platformRole?: string | null;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  setActiveTab,
  notesCount,
  kanbanTaskCount,
  isVisible = true,
  onOpenHelp,
  activeWorkspaceId = 'ws-synthos-primary',
  onSwitchWorkspace,
  authorizedWorkspaces = [],
  platformRole = null,
}) => {
  const authority = useAuthority();
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
      'AGENTS': true,
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

  /**
   * One navigation entry. Declared explicitly rather than inferred, so the
   * optional fields are part of the contract instead of an accident of which
   * literal happened to set them. The render already guarded each with
   * `item.x && ...`, so nothing crashed — but nothing typed them either, and
   * a mistyped `statusTagg` would have been silently invisible on labels that
   * report wiring truth.
   *
   * PRODUCT PRESERVATION: the statusTag chip is kept, not deleted. Nothing
   * supplies one today, so it renders for no item — which is the honest
   * state. The intended UX is a per-surface wiring indicator, and this is
   * where real wiring state belongs when it exists.
   */
  interface NavItem {
    id: ActiveTab;
    label: string;
    icon: React.ElementType;
    color: string;
    badge?: string;
    statusTag?: 'LIVE' | 'PARTIAL' | 'NOT CONNECTED' | 'UNKNOWN';
    hasSubMenu?: boolean;
    navId?: string;
  }

  interface NavGroup {
    category: string;
    items: NavItem[];
    /**
     * Set on one group and read by nothing. Kept in the contract rather than
     * dropped, because it records an intent (this group is the workspace
     * switcher) that the render does not yet act on. Zero readers is not by
     * itself grounds for removal.
     */
    isWorkspaces?: boolean;
  }

  // Derived from the ONE canonical navigation definition
  // (src/navigation/canonical-nav.ts). The mobile drawer is this same rail.
  const navigationGroups: NavGroup[] = navGroupsFor({ platformRole }).map((g) => ({
    category: g.group,
    isWorkspaces: g.group === 'WORKSPACES' || undefined,
    items: g.items.map((dest) => ({
      id: dest.tabId,
      label: dest.label,
      icon: dest.icon,
      color: dest.color,
      badge: dest.badge === 'notes' ? `${notesCount}` : undefined,
      navId: dest.key,
    })),
  }));

  return (
    <>
      {/* Mobile Drawer Button */}
      {/* Above the content column (which otherwise covered it on phones, so
          the drawer could not be opened by touch), hidden while open. */}
      <div className={`md:hidden fixed bottom-4 left-4 z-[60] ${isMobileOpen ? 'hidden' : ''}`}>
        <button
          onClick={() => setIsMobileOpen(true)}
          data-testid="mobile-nav-open"
          aria-label="Open navigation"
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
        className={`fixed md:sticky md:top-[68px] h-screen md:h-[calc(100vh-68px)] top-0 bottom-0 left-0 z-40 bg-[#0b0c0f]/95 backdrop-blur-xl border-r border-white/[0.065] flex flex-col justify-between transition-all duration-300 font-sans shrink-0 select-none ${
          isMobileOpen
            ? 'translate-x-0 w-64 p-3 z-50'
            : isVisible
              ? '-translate-x-full md:translate-x-0'
              : '-translate-x-full md:hidden'
        } ${isVisible && isCollapsed ? 'md:w-14 md:p-2' : isVisible ? 'md:w-64 md:p-3' : ''}`}
      >
        {/* Top Header & Collapse Toggle */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] shrink-0">
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
          <div className="py-3 px-2 border-b border-white/[0.06] space-y-1.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold text-[#555A7E] uppercase block font-mono tracking-wider">
                ENVIRONMENT
              </span>
              {/* Real control-plane connection state (authority context), not a static claim. */}
              <span className={`text-[9px] font-mono font-bold ${authority.status === 'CONNECTED' ? 'text-[#00D26A]' : authority.status === 'UNREACHABLE' ? 'text-[#FF6B6B]' : 'text-[#6C7293]'}`} data-testid="sidebar-connection">
                {authority.status === 'CONNECTED' ? '● CONNECTED' : authority.status === 'UNREACHABLE' ? '● UNREACHABLE' : '○ CHECKING'}
              </span>
            </div>
            {authorizedWorkspaces.length === 0 ? (
              <div className="w-full bg-[#05060D] text-[10px] text-[#555A7E] border border-[#1E2240] rounded-lg px-2 py-1.5 font-sans">
                No authorized workspaces
              </div>
            ) : (
              <select
                value={activeWorkspaceId}
                onChange={(e) => {
                  if (onSwitchWorkspace) {
                    onSwitchWorkspace(e.target.value);
                  }
                }}
                className="w-full bg-[#05060D] text-[11px] font-bold text-[#A5A2FF] hover:text-white border border-[#1E2240] focus:border-[#615EFF] rounded-lg px-2 py-1.5 outline-hidden transition cursor-pointer font-sans"
              >
                {authorizedWorkspaces.map((w) => (
                  <option key={w.workspace_id} value={w.workspace_id}>{w.workspace_name}</option>
                ))}
              </select>
            )}
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
                      const isActive = isDestinationActive(NAV_DESTINATIONS.find((x) => x.key === item.navId)!, activeTab);

                      return (
                        <div key={item.navId} className="space-y-0.5">
                          <button
                            id={`nav-${item.id}`}
                            data-nav-key={item.navId}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => {
                              setActiveTab(item.id);
                              setIsMobileOpen(false);
                            }}
                            className={`group relative w-full flex items-center ${
                              isCollapsed ? 'justify-center p-2.5' : 'justify-between px-2.5 py-1.5'
                            } rounded-lg text-[13px] font-medium transition-colors cursor-pointer select-none ${
                              isActive
                                ? 'bg-white/[0.075] text-white shadow-[inset_3px_0_0_#7170ff] font-semibold'
                                : 'text-[#8a8f98] hover:bg-white/[0.04] hover:text-[#f7f8f8]'
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
          <div className="min-w-0 flex-1 pr-1"><BuildIdentityFooter compact={isCollapsed} /></div>
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
