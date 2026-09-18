import type React from 'react';
import {
  LayoutDashboard, Kanban, Activity, Bot, ShieldCheck, FileCheck, Clock, Server, Crown, Cpu, Sparkles,
  Code2, Terminal, Compass, Globe, GitMerge, Wrench, Zap, HardDrive, Database, Search, MessageSquare,
  Layers, Shield, Building2, Sliders, Network, UserCheck, BarChart2, Radio, CheckSquare, Boxes,
} from 'lucide-react';
import type { ActiveTab } from '../types';

// ---------------------------------------------------------------------------
// CANONICAL ADMIN NAVIGATION — the single definition every navigation surface
// derives from: the desktop rail, the mobile drawer (the same rail), the
// command palette, the header quick links and the workspace top bar labels.
// A destination appears once, under one name. Nested views (an agent's
// detail, a Hermes sub-view) light up their parent through `activeFor` and
// NESTED_ROUTES. `access` hides platform-admin destinations from other users
// — presentation only: the server authorizes every API independently.
//
// Deep links: every destination has a stable hash path (#/agents, #/skills…),
// an agent's detail is #/agents/<role>, and any tab id also resolves as
// #/<tabId>. Before this there were no URLs at all, so nothing older breaks.
// ---------------------------------------------------------------------------

export type NavAccess = 'MEMBER' | 'PLATFORM_ADMIN';
export type NavGroupName = 'OPERATIONS' | 'AGENTS' | 'WORKSPACES' | 'BUILD' | 'KNOWLEDGE' | 'GOVERNANCE' | 'PRODUCTS' | 'SYSTEM' | 'MASTER ADMIN';

export interface NavDestination {
  /** Stable key, also the deep-link path segment. */
  key: string;
  tabId: ActiveTab;
  label: string;
  group: NavGroupName;
  icon: React.ElementType;
  color: string;
  access: NavAccess;
  keywords: string[];
  /** Other tab ids that are this destination (legacy ids, sub-views). */
  activeFor?: ActiveTab[];
  /** Dynamic count shown next to the label. */
  badge?: 'notes' | 'kanbanStages';
  /** Stable DOM id for the rail entry (kept from earlier releases). */
  domId?: string;
}

export const NAV_GROUP_ORDER: NavGroupName[] = ['OPERATIONS', 'AGENTS', 'WORKSPACES', 'BUILD', 'KNOWLEDGE', 'GOVERNANCE', 'PRODUCTS', 'SYSTEM', 'MASTER ADMIN'];

const d = (x: Omit<NavDestination, 'access'> & { access?: NavAccess }): NavDestination => ({ access: 'MEMBER', ...x });

export const NAV_DESTINATIONS: readonly NavDestination[] = Object.freeze([
  // OPERATIONS
  d({ key: 'overview', tabId: 'overview', label: 'Overview', group: 'OPERATIONS', icon: LayoutDashboard, color: '#A5A2FF', keywords: ['mission control', 'dashboard', 'home'] }),
  d({ key: 'tasks', tabId: 'kanban', label: 'Tasks', group: 'OPERATIONS', icon: Kanban, color: '#00D26A', badge: 'kanbanStages', keywords: ['kanban', 'tasks', 'board', 'task detail', 'reconcile'], activeFor: ['hermes-kanban'] }),
  d({ key: 'graph-runs', tabId: 'graph-runs', label: 'Graph Runs', group: 'OPERATIONS', icon: Activity, color: '#EC4899', keywords: ['runs', 'active runs', 'graph runtime', 'orchestration'] }),
  d({ key: 'approvals', tabId: 'approval-queue', label: 'Approvals', group: 'OPERATIONS', icon: ShieldCheck, color: '#F59E0B', keywords: ['approval queue', 'approve', 'pending'] }),
  d({ key: 'scheduler', tabId: 'scheduler', label: 'Scheduler', group: 'OPERATIONS', icon: Clock, color: '#EC4899', keywords: ['schedules', 'cron', 'loops'] }),
  d({ key: 'external-executions', tabId: 'external-executions', label: 'External Executions', group: 'OPERATIONS', icon: Server, color: '#38BDF8', keywords: ['windmill', 'external', 'executions'] }),

  // AGENTS — the agent area, in one place
  d({ key: 'agents', tabId: 'agent-fleet', label: 'Agent Registry', group: 'AGENTS', icon: Bot, color: '#EAB308', keywords: ['agents', 'fleet', 'workforce', 'roster'], activeFor: ['hermes-agents'] }),
  d({ key: 'skills', tabId: 'skill-registry', label: 'Skills', group: 'AGENTS', icon: Cpu, color: '#615EFF', keywords: ['skills', 'skill registry', 'mcp skills'], activeFor: ['hermes-skills'] }),
  d({ key: 'tools', tabId: 'tool-registry', label: 'Tools', group: 'AGENTS', icon: Wrench, color: '#38BDF8', keywords: ['tools', 'tool pack', 'capabilities'], activeFor: ['hermes-tools'] }),
  d({ key: 'models', tabId: 'model-registry', label: 'Model Registry', group: 'AGENTS', icon: Boxes, color: '#38BDF8', keywords: ['models', 'model families', 'versions', 'providers', 'routes', 'pricing', 'qualification'] }),
  d({ key: 'router', tabId: 'model-router', label: 'Model Router', group: 'AGENTS', icon: Sliders, color: '#38BDF8', keywords: ['canonical router', 'routing', 'router preview', 'model router'] }),

  // WORKSPACES (agent workspaces)
  d({ key: 'ws-orchestrator', tabId: 'agent-orchestrator', label: 'Orchestrator', group: 'WORKSPACES', icon: Crown, color: '#EC4899', keywords: ['orchestrator'] }),
  d({ key: 'ws-hermes', tabId: 'hermes-core', label: 'Hermes', group: 'WORKSPACES', icon: Cpu, color: '#615EFF', keywords: ['hermes'], activeFor: ['hermes', 'hermes-overview'] }),
  d({ key: 'ws-claude', tabId: 'agent-claude', label: 'Claude', group: 'WORKSPACES', icon: Sparkles, color: '#F97316', keywords: ['claude workspace'] }),
  d({ key: 'ws-gemini', tabId: 'agent-gemini', label: 'Gemini', group: 'WORKSPACES', icon: Sparkles, color: '#1A73E8', keywords: ['gemini workspace'] }),
  d({ key: 'ws-codex', tabId: 'agent-codex', label: 'Codex', group: 'WORKSPACES', icon: Code2, color: '#00D26A', keywords: ['codex workspace'] }),
  d({ key: 'ws-cursor', tabId: 'agent-cursor', label: 'Cursor', group: 'WORKSPACES', icon: Terminal, color: '#A855F7', keywords: ['cursor workspace'] }),
  d({ key: 'ws-antigravity', tabId: 'agent-antigravity', label: 'Antigravity', group: 'WORKSPACES', icon: Compass, color: '#8A5CF5', keywords: ['antigravity workspace'] }),
  d({ key: 'ws-openclaw', tabId: 'agent-openclaw', label: 'OpenClaw', group: 'WORKSPACES', icon: Globe, color: '#14B8A6', keywords: ['openclaw workspace'] }),

  // BUILD
  d({ key: 'development', tabId: 'development', label: 'Development', group: 'BUILD', icon: Code2, color: '#615EFF', keywords: ['development', 'dev tasks'] }),
  d({ key: 'graph-builder', tabId: 'graph-builder', label: 'Graph Builder', group: 'BUILD', icon: GitMerge, color: '#38BDF8', keywords: ['graph builder', 'workflow'] }),
  d({ key: 'automation', tabId: 'bot-mode', label: 'Automation', group: 'BUILD', icon: Terminal, color: '#F59E0B', keywords: ['automation', 'bot mode'], activeFor: ['hermes-bot-mode'] }),
  d({ key: 'launchpad', tabId: 'startup-generator', label: 'Launchpad', group: 'BUILD', icon: Zap, color: '#00D26A', keywords: ['launchpad', 'startup'] }),

  // KNOWLEDGE
  d({ key: 'memory', tabId: 'agent-memory', label: 'Brain / Memory', group: 'KNOWLEDGE', icon: HardDrive, color: '#8C8AFF', keywords: ['brain', 'memory', 'knowledge', 'recall'], activeFor: ['hermes-memory'] }),
  d({ key: 'vault', tabId: 'obsidian', label: 'Vault', group: 'KNOWLEDGE', icon: Database, color: '#EC4899', badge: 'notes', keywords: ['obsidian', 'vault', 'notes', 'knowledge mesh', 'graph'] }),
  d({ key: 'intelligence', tabId: 'hermes-oracle', label: 'Intelligence', group: 'KNOWLEDGE', icon: Sparkles, color: '#A5A2FF', keywords: ['intelligence', 'oracle'] }),
  d({ key: 'aeo-audit', tabId: 'aeo-audit', label: 'SEO / AEO / GEO Audit', group: 'KNOWLEDGE', icon: Search, color: '#20B2AA', keywords: ['seo', 'aeo', 'geo', 'audit'] }),
  d({ key: 'business-assistant', tabId: 'business-assistant', label: 'Business Assistant', group: 'KNOWLEDGE', icon: MessageSquare, color: '#8C8AFF', keywords: ['business assistant', 'conversations'] }),
  d({ key: 'radar', tabId: 'lead-scraper', label: 'Radar', group: 'KNOWLEDGE', icon: Globe, color: '#20B2AA', keywords: ['radar', 'leads'] }),
  d({ key: 'research-library', tabId: 'content-library', label: 'Research Library', group: 'KNOWLEDGE', icon: Layers, color: '#38BDF8', keywords: ['research', 'library', 'content'] }),

  // GOVERNANCE
  d({ key: 'governance', tabId: 'guardian-aegis', label: 'Guardian / Governance', group: 'GOVERNANCE', icon: Shield, color: '#F59E0B', keywords: ['guardian', 'aegis', 'governance', 'policy'], activeFor: ['hermes-approvals'] }),
  d({ key: 'verifier', tabId: 'system-audit', label: 'Aegis Verifier', group: 'GOVERNANCE', icon: ShieldCheck, color: '#00D26A', keywords: ['aegis verifier', 'system audit', 'diagnostics checks'], activeFor: ['system-diagnostics'] }),
  d({ key: 'receipts', tabId: 'receipts', label: 'Execution Receipts', group: 'GOVERNANCE', icon: FileCheck, color: '#38BDF8', keywords: ['receipts', 'signed', 'ed25519', 'evidence'] }),
  d({ key: 'activity', tabId: 'activity-ledger', label: 'Activity Ledger', group: 'GOVERNANCE', icon: Activity, color: '#A5A2FF', keywords: ['activity', 'ledger', 'events', 'audit trail'], activeFor: ['hermes-activity', 'hermes-logs'] }),

  // PRODUCTS
  d({ key: 'twins', tabId: 'twins', label: 'Twins Concierge', group: 'PRODUCTS', icon: Sparkles, color: '#A5A2FF', keywords: ['twins', 'concierge'] }),
  d({ key: 'ton', tabId: 'ton', label: 'TON Network', group: 'PRODUCTS', icon: Globe, color: '#0088CC', keywords: ['ton'] }),
  d({ key: 'demos', tabId: 'demos', label: 'Product Demos', group: 'PRODUCTS', icon: Code2, color: '#00D26A', keywords: ['demos'] }),
  d({ key: 'customer-workspaces', tabId: 'workspaces', label: 'Customer Workspaces', group: 'PRODUCTS', icon: Building2, color: '#F59E0B', keywords: ['workspaces', 'tenants', 'customers'] }),

  // SYSTEM
  d({ key: 'jarvis', tabId: 'jarvis', label: 'Jarvis Executive Hub', group: 'SYSTEM', icon: Sparkles, color: '#EAB308', keywords: ['jarvis', 'voice', 'executive'] }),
  d({ key: 'mcp', tabId: 'hermes-mcps', label: 'MCP Registry', group: 'SYSTEM', icon: Server, color: '#F59E0B', keywords: ['mcp', 'servers'] }),
  d({ key: 'integrations', tabId: 'message-bridge', label: 'Integrations & Bridge', group: 'SYSTEM', icon: Network, color: '#615EFF', keywords: ['integrations', 'bridge', 'telegram'] }),
  d({ key: 'users', tabId: 'users-roles', label: 'Users & Roles', group: 'SYSTEM', icon: UserCheck, color: '#00D26A', keywords: ['users', 'roles', 'members'] }),
  d({ key: 'usage', tabId: 'hermes-analytics', label: 'Usage & Costs', group: 'SYSTEM', icon: BarChart2, color: '#00D26A', keywords: ['usage', 'costs', 'spend'] }),
  d({ key: 'upstream', tabId: 'upstream-registry', label: 'Upstream Watchers', group: 'SYSTEM', icon: Crown, color: '#D97706', keywords: ['upstream', 'watchers'] }),
  d({ key: 'settings', tabId: 'settings', label: 'System Settings', group: 'SYSTEM', icon: Sliders, color: '#9AA2C6', keywords: ['settings', 'preferences'] }),

  // MASTER ADMIN (platform administrators; the server enforces this too)
  d({ key: 'diagnostics', tabId: 'master-admin-platform', label: 'Diagnostics & Build', group: 'MASTER ADMIN', icon: Server, color: '#38BDF8', access: 'PLATFORM_ADMIN', keywords: ['diagnostics', 'build', 'version', 'commit', 'schema', 'admin controls'], activeFor: ['master-admin'] }),
  d({ key: 'admin-walkthrough', tabId: 'master-admin-walkthrough', label: 'Setup Walkthrough', group: 'MASTER ADMIN', icon: CheckSquare, color: '#615EFF', access: 'PLATFORM_ADMIN', keywords: ['walkthrough', 'setup'] }),
  d({ key: 'admin-providers', tabId: 'master-admin-providers', label: 'Providers & Models', group: 'MASTER ADMIN', icon: Zap, color: '#EAB308', access: 'PLATFORM_ADMIN', keywords: ['providers matrix', 'credentials'], activeFor: ['master-admin-models'] }),
  d({ key: 'admin-hermes', tabId: 'master-admin-hermes', label: 'Hermes Admin', group: 'MASTER ADMIN', icon: Cpu, color: '#EC4899', access: 'PLATFORM_ADMIN', keywords: ['hermes admin'] }),
  d({ key: 'admin-voice', tabId: 'master-admin-voice', label: 'Voice & Apollo', group: 'MASTER ADMIN', icon: Radio, color: '#FF5E8E', access: 'PLATFORM_ADMIN', keywords: ['voice', 'apollo'] }),
  d({ key: 'admin-mcps', tabId: 'master-admin-mcps', label: 'MCPs & Tools', group: 'MASTER ADMIN', icon: Terminal, color: '#F59E0B', access: 'PLATFORM_ADMIN', keywords: ['mcps admin'] }),
  d({ key: 'admin-storage', tabId: 'master-admin-storage', label: 'Storage & Vaults', group: 'MASTER ADMIN', icon: HardDrive, color: '#8C8AFF', access: 'PLATFORM_ADMIN', keywords: ['storage', 'vaults'] }),
  d({ key: 'admin-database', tabId: 'master-admin-database', label: 'Database', group: 'MASTER ADMIN', icon: Database, color: '#00D26A', access: 'PLATFORM_ADMIN', keywords: ['database', 'sqlite'] }),
  d({ key: 'admin-security', tabId: 'master-admin-security', label: 'Security & Guardian', group: 'MASTER ADMIN', icon: Shield, color: '#F59E0B', access: 'PLATFORM_ADMIN', keywords: ['security'] }),
  d({ key: 'admin-health', tabId: 'master-admin-health', label: 'Health & Ping', group: 'MASTER ADMIN', icon: BarChart2, color: '#00D26A', access: 'PLATFORM_ADMIN', keywords: ['health', 'ping'] }),
  d({ key: 'admin-audit', tabId: 'master-admin-audit', label: 'Audit', group: 'MASTER ADMIN', icon: FileCheck, color: '#38BDF8', access: 'PLATFORM_ADMIN', keywords: ['audit', 'admin audit'] }),
]);

export interface NavViewer { platformRole?: string | null }

export function canSee(dest: NavDestination, viewer: NavViewer): boolean {
  return dest.access === 'MEMBER' || viewer.platformRole === 'platform_admin';
}

/** Rail groups for this viewer, in canonical order. */
export function navGroupsFor(viewer: NavViewer): Array<{ group: NavGroupName; items: NavDestination[] }> {
  return NAV_GROUP_ORDER
    .map((group) => ({ group, items: NAV_DESTINATIONS.filter((x) => x.group === group && canSee(x, viewer)) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Nested routes: views reached FROM a destination rather than listed in the
 * rail. Agent Detail is every agent-<role> view (AgentView); it lights up
 * Agent Registry unless the rail lists that agent itself (the WORKSPACES).
 */
export const NESTED_ROUTES = Object.freeze([
  { key: 'agent-detail', label: 'Agent Detail', parentKey: 'agents', prefix: 'agent-', except: ['agent-fleet', 'agent-memory'] as string[], pathPrefix: 'agents/' },
]);

/** The rail destination that owns a tab id: exact, then declared aliases, then nested route parent. */
export function destinationForTab(tab: string): NavDestination | null {
  const exact = NAV_DESTINATIONS.find((x) => x.tabId === tab) ?? NAV_DESTINATIONS.find((x) => x.activeFor?.includes(tab as ActiveTab));
  if (exact) return exact;
  const nested = NESTED_ROUTES.find((n) => tab.startsWith(n.prefix) && !n.except.includes(tab));
  return nested ? NAV_DESTINATIONS.find((x) => x.key === nested.parentKey) ?? null : null;
}

/** Whether a rail entry is the active one for the current tab (nested views included). */
export function isDestinationActive(dest: NavDestination, activeTab: string): boolean {
  return destinationForTab(activeTab)?.key === dest.key;
}

/** Canonical label for a tab id, or null when no destination owns it. */
export function canonicalLabel(tab: string): string | null {
  return NAV_DESTINATIONS.find((x) => x.tabId === tab)?.label ?? null;
}

// ---- deep links ------------------------------------------------------------

export function hashForTab(tab: string): string {
  const dest = NAV_DESTINATIONS.find((x) => x.tabId === tab);
  if (dest) return `#/${dest.key}`;
  const nested = NESTED_ROUTES.find((n) => tab.startsWith(n.prefix) && !n.except.includes(tab));
  if (nested) return `#/${nested.pathPrefix}${tab.slice(nested.prefix.length)}`;
  return `#/${tab}`;
}

/** Resolve a location hash to a tab id; null when it names nothing known. */
export function tabForHash(hash: string, knownTabs: ReadonlySet<string>): ActiveTab | null {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!path) return null;
  const byKey = NAV_DESTINATIONS.find((x) => x.key === path);
  if (byKey) return byKey.tabId;
  for (const n of NESTED_ROUTES) {
    if (path.startsWith(n.pathPrefix)) {
      const tab = `${n.prefix}${path.slice(n.pathPrefix.length)}`;
      if (knownTabs.has(tab)) return tab as ActiveTab;
    }
  }
  if (knownTabs.has(path)) return path as ActiveTab;
  return null;
}

/**
 * A workspace top bar may name its own home tab contextually ("Overview");
 * every other entry uses the canonical label, and each destination appears
 * once — the first occurrence wins, across primary and "more" tabs.
 */
export function normalizeContextTabs<T extends { id: string; label: string }>(primary: T[], more: T[]): { primary: T[]; more: T[] } {
  const seen = new Set<string>();
  const fix = (t: T, i: number, isPrimary: boolean): T | null => {
    if (seen.has(t.id)) return null;
    seen.add(t.id);
    if (isPrimary && i === 0) return t;
    const label = canonicalLabel(t.id);
    return label ? { ...t, label } : t;
  };
  const p = primary.map((t, i) => fix(t, i, true)).filter((x): x is T => !!x);
  const m = more.map((t, i) => fix(t, i, false)).filter((x): x is T => !!x);
  return { primary: p, more: m };
}
