// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import { NAV_DESTINATIONS, NESTED_ROUTES, navGroupsFor, destinationForTab, isDestinationActive, hashForTab, tabForHash, canonicalLabel, normalizeContextTabs } from '../src/navigation/canonical-nav';
import { RENDERED_TABS, DIRECT_RENDERED_TABS, AGENT_DETAIL_TABS, MODEL_SEAT_TABS, MASTER_ADMIN_TABS } from '../src/navigation/rendered-tabs';
import { AGENT_DEFINITIONS } from '../src/data/agentDefinitions';
import { SidebarNav } from '../src/components/SidebarNav';
import { CommandPalette } from '../src/components/CommandPalette';

// ---------------------------------------------------------------------------
// ONE NAVIGATION DEFINITION. Every surface derives from
// src/navigation/canonical-nav.ts; every destination renders a real screen.
// ---------------------------------------------------------------------------

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const APP = read('src/App.tsx');
afterEach(() => cleanup());

const REQUIRED: Array<[string, string]> = [
  ['Agent Registry', 'agent-fleet'], ['Skills', 'skill-registry'], ['Model Registry', 'model-registry'], ['Model Router', 'model-router'],
  ['Graph Runs', 'graph-runs'], ['Tasks', 'kanban'], ['Execution Receipts', 'receipts'], ['External Executions', 'external-executions'],
  ['Vault', 'obsidian'], ['Brain / Memory', 'agent-memory'], ['Approvals', 'approval-queue'], ['Guardian / Governance', 'guardian-aegis'],
  ['Activity Ledger', 'activity-ledger'], ['Diagnostics & Build', 'master-admin-platform'],
];

describe('canonical navigation definition', () => {
  it('contains every required destination under one name, and Agent Detail as a nested route of Agent Registry', () => {
    for (const [label, tab] of REQUIRED) {
      const found = NAV_DESTINATIONS.filter((d) => d.tabId === tab);
      expect(found, `${label} → ${tab}`).toHaveLength(1);
      expect(found[0].label).toBe(label);
    }
    expect(NESTED_ROUTES).toContainEqual(expect.objectContaining({ key: 'agent-detail', parentKey: 'agents', prefix: 'agent-' }));
    expect(destinationForTab('agent-scout')?.key).toBe('agents');
    expect(NAV_DESTINATIONS.filter((d) => d.group === 'AGENTS').map((d) => d.label)).toEqual(['Agent Registry', 'Skills', 'Tools', 'Model Registry', 'Model Router']);
  });

  it('has no duplicate keys, tab ids or labels, and no tab owned twice through aliases', () => {
    const uniq = (xs: string[]) => new Set(xs).size === xs.length;
    expect(uniq(NAV_DESTINATIONS.map((d) => d.key))).toBe(true);
    expect(uniq(NAV_DESTINATIONS.map((d) => d.tabId))).toBe(true);
    expect(uniq(NAV_DESTINATIONS.map((d) => d.label))).toBe(true);
    const owned = NAV_DESTINATIONS.flatMap((d) => [d.tabId, ...(d.activeFor ?? [])]);
    expect(uniq(owned)).toBe(true);
  });

  it('every destination and alias renders a real screen; nothing points at a placeholder', () => {
    for (const d of NAV_DESTINATIONS) {
      expect(RENDERED_TABS.has(d.tabId), d.tabId).toBe(true);
      for (const a of d.activeFor ?? []) expect(RENDERED_TABS.has(a), a).toBe(true);
    }
  });
});

describe('rendered tabs agree with App.tsx in both directions', () => {
  it('each direct tab has an `activeTab === ...` branch, and each branch is listed', () => {
    const branches = new Set([...APP.matchAll(/activeTab === '([a-z0-9-]+)'/g)].map((m) => m[1]));
    for (const t of DIRECT_RENDERED_TABS) expect(branches.has(t), t).toBe(true);
    for (const b of branches) expect(RENDERED_TABS.has(b) || b === 'master-admin', b).toBe(true);
  });

  it('no tab renders two screens: model seats are not also direct tabs', () => {
    for (const t of MODEL_SEAT_TABS) expect((DIRECT_RENDERED_TABS as readonly string[]).includes(t), t).toBe(false);
  });

  it('model seats match isModelTab; Master Admin sections exist in MasterAdminView', () => {
    const seat = /const isModelTab[\s\S]*?\[([\s\S]*?)\]\.includes/.exec(APP)![1];
    expect([...seat.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort()).toEqual([...MODEL_SEAT_TABS].sort());
    const mav = read('src/components/MasterAdminView.tsx');
    const alias: Record<string, string> = { providers: 'models', security: 'guardian', storage: 'memory' };
    for (const t of MASTER_ADMIN_TABS) {
      const sec = t.replace('master-admin-', '');
      expect(mav.includes(`activeSection === '${alias[sec] ?? sec}'`), t).toBe(true);
    }
  });

  it('agent detail deep links exist exactly for the agents that have a definition', () => {
    const defined = Object.values(AGENT_DEFINITIONS).map((a) => a.tabKey).sort();
    expect([...AGENT_DETAIL_TABS].sort()).toEqual(defined);
  });
});

describe('active state, deep links and compatibility', () => {
  const rail = (tab: string) => NAV_DESTINATIONS.filter((d) => isDestinationActive(d, tab)).map((d) => d.key);
  it('exactly one rail entry is active for nested and legacy tabs', () => {
    expect(rail('agent-scout')).toEqual(['agents']);
    expect(rail('agent-claude')).toEqual(['ws-claude']);
    expect(rail('hermes-agents')).toEqual(['agents']);
    expect(rail('hermes-skills')).toEqual(['skills']);
    expect(rail('hermes-logs')).toEqual(['activity']);
    expect(rail('system-diagnostics')).toEqual(['verifier']);
    expect(rail('master-admin')).toEqual(['diagnostics']);
    expect(rail('model-registry')).toEqual(['models']);
    for (const t of RENDERED_TABS) expect(rail(t).length, t).toBeLessThanOrEqual(1);
  });

  it('every destination round-trips through its hash; agent detail and raw tab ids resolve; unknown hashes do not', () => {
    for (const d of NAV_DESTINATIONS) expect(tabForHash(hashForTab(d.tabId), RENDERED_TABS)).toBe(d.tabId);
    expect(hashForTab('agent-scout')).toBe('#/agents/scout');
    expect(tabForHash('#/agents/scout', RENDERED_TABS)).toBe('agent-scout');
    expect(tabForHash('#/agents/writer', RENDERED_TABS)).toBeNull(); // placeholder agent: not navigable
    expect(tabForHash('#/receipts', RENDERED_TABS)).toBe('receipts');
    expect(tabForHash('#/skill-registry', RENDERED_TABS)).toBe('skill-registry'); // raw tab id still works
    expect(tabForHash('#/no-such-page', RENDERED_TABS)).toBeNull();
    expect(tabForHash('', RENDERED_TABS)).toBeNull();
    expect(APP).toContain('tabForHash(window.location.hash, RENDERED_TABS)');
  });

  it('top bars keep one name per destination and drop duplicates', () => {
    const r = normalizeContextTabs(
      [{ id: 'agent-orchestrator', label: 'Overview' }, { id: 'kanban', label: 'Objectives' }, { id: 'kanban', label: 'Tasks' }, { id: 'guardian-aegis', label: 'Approvals' }],
      [{ id: 'activity-ledger', label: 'Activity' }, { id: 'activity-ledger', label: 'Logs' }, { id: 'guardian-aegis', label: 'Governance' }],
    );
    expect(r.primary.map((t) => t.label)).toEqual(['Overview', 'Tasks', 'Guardian / Governance']);
    expect(r.more.map((t) => t.label)).toEqual(['Activity Ledger']);
    expect(canonicalLabel('receipts')).toBe('Execution Receipts');
    expect(read('src/components/WorkspaceTopNav.tsx')).toContain('normalizeContextTabs(rawConfig.primaryTabs, rawConfig.moreTabs)');
  });
});

describe('every surface derives from the canonical definition', () => {
  it('no nav surface keeps its own destination list', () => {
    const sidebar = read('src/components/SidebarNav.tsx');
    expect(sidebar).toContain('navGroupsFor({ platformRole })');
    expect(sidebar).not.toMatch(/label: 'Agent Fleet'|label: 'Active Runs'|label: 'Graph Runtime'/);
    const palette = read('src/components/CommandPalette.tsx');
    expect(palette).toContain('navGroupsFor({ platformRole })');
    expect(palette).not.toMatch(/id: '[a-z-]+',\s*\n\s*label: 'Open /);
  });

  it('dynamic navigation targets elsewhere in the app all render', () => {
    const demos = [...read('src/components/products/FrontendDemosView.tsx').matchAll(/^\s+id: '([a-z0-9-]+)',/gm)].map((m) => m[1]);
    const tours = ['src/components/GuideWalkthroughView.tsx', 'src/components/FirstRunTour.tsx', 'src/components/OverviewOfficeView.tsx']
      .flatMap((f) => [...read(f).matchAll(/tab: '([a-z0-9-]+)'/g)].map((m) => m[1]));
    for (const t of [...demos, ...tours]) expect(RENDERED_TABS.has(t), t).toBe(true);
  });
});

describe('rendered navigation (desktop rail = mobile drawer, and command palette)', () => {
  const sidebar = (role: string | null, activeTab = 'overview') => {
    localStorage.setItem('synthos_nav_expanded_sections', JSON.stringify(Object.fromEntries(navGroupsFor({ platformRole: 'platform_admin' }).map((g) => [g.group, true]))));
    return render(
    <SidebarNav activeTab={activeTab as any} setActiveTab={() => {}} models={{}} agents={{}} notesCount={3} botTaskCount={0} kanbanTaskCount={0} platformRole={role} authorizedWorkspaces={[]} />,
    );
  };

  it('renders every visible destination once, in canonical groups, with nested active state', () => {
    sidebar('platform_admin', 'agent-scout');
    for (const g of navGroupsFor({ platformRole: 'platform_admin' })) {
      for (const d of g.items) expect(document.querySelectorAll(`[data-nav-key="${d.key}"]`).length, d.key).toBe(1);
    }
    const active = [...document.querySelectorAll('[aria-current="page"]')].map((e) => e.getAttribute('data-nav-key'));
    expect(active).toEqual(['agents']);
  });

  it('platform-admin destinations are hidden from standard users (presentation only)', () => {
    sidebar('standard');
    expect(document.querySelector('[data-nav-key="diagnostics"]')).toBeNull();
    expect(document.querySelector('[data-nav-key="agents"]')).not.toBeNull();
    cleanup();
    sidebar('platform_admin');
    expect(document.querySelector('[data-nav-key="diagnostics"]')).not.toBeNull();
  });

  it('the server still authorizes the admin APIs independently of the menu', () => {
    const server = read('server.ts');
    expect(server).toMatch(/app\.get\("\/api\/master-admin\/diagnostics", requirePlatformAdmin/);
  });

  it('the command palette lists the same destinations and names, filtered by role', () => {
    let selected: string | null = null;
    render(<CommandPalette isOpen onClose={() => {}} onSelectTab={(t) => { selected = t; }} notes={[]} platformRole="standard" />);
    for (const d of navGroupsFor({ platformRole: 'standard' }).flatMap((g) => g.items)) expect(screen.getAllByText(`Open ${d.label}`).length, d.label).toBe(1);
    expect(screen.queryByText('Open Diagnostics & Build')).toBeNull();
    fireEvent.click(screen.getByText('Open Model Registry'));
    expect(selected).toBe('model-registry');
  });
});
