import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AGENT_DEFINITIONS } from '../src/data/agentDefinitions';
import { NAV_DESTINATIONS } from '../src/navigation/canonical-nav';

// ---------------------------------------------------------------------------
// Regression test for: "Cannot read properties of undefined (reading
// 'systemPrompt')" when opening the Gemini workspace from the sidebar.
//
// Root cause: SidebarNav.tsx has always listed 'agent-gemini' as a workspace
// tab, and App.tsx's getAgentRoleFromTab() has always derived role 'gemini'
// from it, but AGENT_DEFINITIONS (src/data/agentDefinitions.ts) never had a
// 'gemini' key — it was dropped when the agent roster was split out of
// src/data/mockData.ts's INITIAL_AGENTS (which does have a real 'gemini'
// entry) into agentDefinitions.ts. agents['gemini'] was therefore always
// undefined, and AgentView reads agent.systemPrompt unconditionally during
// its first render (useState(agent.systemPrompt || '')), crashing the whole
// workspace the moment a user clicked it.
//
// This existed since agentDefinitions.ts's very first commit — it is not a
// regression from the Jarvis/context work.
// ---------------------------------------------------------------------------

const sidebarContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SidebarNav.tsx'), 'utf-8');
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

// Tabs that start with 'agent-' but are routed to a dedicated view, not
// AgentView, and so are legitimately absent from AGENT_DEFINITIONS.
const NON_AGENT_VIEW_TABS = new Set(['agent-fleet', 'agent-memory']);

// The sidebar renders the canonical navigation (src/navigation/canonical-nav.ts).
function sidebarAgentTabIds(): string[] {
  return NAV_DESTINATIONS.map((d) => d.tabId as string).filter((id) => id.startsWith('agent-') && !NON_AGENT_VIEW_TABS.has(id));
}

describe('Every sidebar agent workspace tab resolves to a real AGENT_DEFINITIONS entry', () => {
  const tabIds = sidebarAgentTabIds();

  it('no navigation entry opens a hardcoded agent persona (removed from production 2026-09-18)', () => {
    // The persona pages (AgentView over AGENT_DEFINITIONS) are no longer navigable:
    // agents are shown from the canonical task record (lib/agent-roster.ts).
    expect(tabIds).toEqual([]);
  });

  it.each(tabIds)('%s has a matching AGENT_DEFINITIONS role with a real systemPrompt', (tabId) => {
    const role = tabId.replace('agent-', '');
    const agent = AGENT_DEFINITIONS[role];
    expect(agent, `AGENT_DEFINITIONS['${role}'] is missing — clicking "${tabId}" in the sidebar would crash AgentView with "Cannot read properties of undefined (reading 'systemPrompt')"`).toBeDefined();
    expect(typeof agent.systemPrompt).toBe('string');
    expect(agent.systemPrompt.length).toBeGreaterThan(0);
  });
});

describe('AGENT_DEFINITIONS.gemini specifically (the confirmed crash case)', () => {
  it('exists, with the real Gemini persona data (not a fabricated placeholder)', () => {
    const gemini = AGENT_DEFINITIONS['gemini'];
    expect(gemini).toBeDefined();
    expect(gemini.role).toBe('gemini');
    expect(gemini.name).toBe('Gemini 3.1 Pro / Flash');
    expect(gemini.systemPrompt).toContain('Gemini');
    expect(gemini.capabilities.length).toBeGreaterThan(0);
  });
});

describe('App.tsx no longer renders agent personas', () => {
  it('AgentView / AgentFleetView / AgentDrawer are not mounted; legacy agent-<role> tabs redirect to recorded facts', () => {
    expect(appContent).not.toMatch(/<AgentView\b|<AgentFleetView\b|<AgentDrawer\b/);
    expect(appContent).toContain('<AgentRegistryView');
    expect(appContent).toContain("setActiveTab('agent-fleet');");
    expect(appContent).toMatch(/#\/agents\/\$\{encodeURIComponent\(role\)\}/);
  });
});
