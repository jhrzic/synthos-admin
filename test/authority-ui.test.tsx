// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { AuthorityProvider, AuthorityBanner, RequireCanonical } from '../src/authority/AuthorityContext';
import { TaskBoardView } from '../src/components/tasks/TaskBoardView';
import { AgentRegistryView } from '../src/components/agents/AgentRegistryView';

// ---------------------------------------------------------------------------
// Unavailable is never shown as empty: the authority banner, the fail-closed
// gate around every view, the server-backed Tasks board and the Agent
// Registry. Synthetic data; every request is a local /api read.
// ---------------------------------------------------------------------------

const authority = { success: true, controlPlane: { role: 'CANONICAL', deployment: 'canonical control plane (launchd com.synthos.admin)', environment: 'production', commit: 'a'.repeat(40), tree: 'CLEAN', database: { name: 'synthos-admin.db', schemaVersion: 2, supported: 2, fingerprint: 'sha256:abcdef0123456789' } }, access: { path: 'GATEWAY', gateway: 'admin.getsynthos.com' }, verifiedAt: '2026-09-18T20:00:00.000Z' };
const calls: Array<{ method: string; url: string }> = [];
const stub = (routes: Record<string, { status: number; body: any }>) => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method || 'GET', url });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const r = key ? routes[key] : { status: 404, body: { success: false } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }));
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('authority context', () => {
  it('connected: banner shows identity, access path, schema, runtime SHA and that data is canonical; views render', async () => {
    stub({ '/api/authority': { status: 200, body: authority } });
    render(<AuthorityProvider><AuthorityBanner /><RequireCanonical><div data-testid="view">view</div></RequireCanonical></AuthorityProvider>);
    await waitFor(() => expect(screen.getByTestId('authority-banner').getAttribute('data-authority-status')).toBe('CONNECTED'));
    const t = screen.getByTestId('authority-banner').textContent!;
    for (const want of ['CANONICAL CONTROL PLANE · CONNECTED', 'canonical control plane (launchd com.synthos.admin)', 'via gateway admin.getsynthos.com', 'synthos-admin.db', 'schema v2/2', 'runtime aaaaaaa', 'last verified 2026-09-18T20:00:00.000Z', 'data CANONICAL']) expect(t, want).toContain(want);
    expect(screen.getByTestId('view')).toBeTruthy();
  });

  it('unreachable (gateway 503): banner says so and every view is replaced — no empty data', async () => {
    stub({ '/api/authority': { status: 503, body: { success: false, controlPlane: 'UNREACHABLE' } } });
    render(<AuthorityProvider><AuthorityBanner /><RequireCanonical><div data-testid="view">0 tasks</div></RequireCanonical></AuthorityProvider>);
    await waitFor(() => expect(screen.getByTestId('control-plane-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('view')).toBeNull();
    expect(screen.getByTestId('authority-rw').textContent).toBe('read/write UNAVAILABLE · data UNAVAILABLE');
    expect(screen.getByTestId('authority-state').textContent).toBe('CONTROL PLANE UNREACHABLE');
  });

  it('App wraps every operational view in the shared authority gate', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('<AuthorityBanner />');
    const gate = app.indexOf('<RequireCanonical>'); const end = app.indexOf('</RequireCanonical>');
    expect(gate).toBeGreaterThan(-1);
    for (const v of ['<TaskBoardView', '<AgentRegistryView', '<SkillRegistryView', '<ProviderModelCatalog', '<ModelRouterView', '<GraphRunsView', '<CanonicalReceiptsView', '<ActivityLedgerView', '<ObsidianView', '<AgentMemoryView', '<ApprovalQueueView', '<MasterAdminView']) {
      const i = app.indexOf(v); expect(i, v).toBeGreaterThan(gate); expect(i, v).toBeLessThan(end);
    }
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(main).toContain('<AuthorityProvider>');
  });
});

const task = (id: string, extra: Record<string, unknown> = {}) => ({ taskId: id, workspaceId: 'ws', title: `Task ${id}`, description: null, status: 'DONE', stage: 'DONE', assignedAgent: 'scribe', assignedModel: 'model-x', createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', autonomyEligible: false, legacy: false, taskClass: null, outputContract: null, route: null, qualification: null, guardian: null, spend: null, aegis: null, receipts: { count: 0, verified: 0, latestId: null }, artifacts: { count: 0, quarantined: 0, statuses: [] }, continuity: null, reconciliation: null, ...extra });

describe('server-backed Tasks board', () => {
  it('renders canonical tasks by lifecycle stage with NOT RECORDED fields, and loading only reads', async () => {
    stub({ '/api/tasks': { status: 200, body: { success: true, total: 3, tasks: [task('t1'), task('t2', { status: 'TODO', stage: 'QUEUED', legacy: true, assignedModel: 'n/a' }), task('t3', { status: 'RECONCILING_UNKNOWN_EXECUTION', stage: 'RECONCILING', reconciliation: { findings: 0, latestFinding: null } })] } }, '/api/tasks/': { status: 404, body: { success: false } } });
    render(<TaskBoardView workspaceId="ws" />);
    await waitFor(() => expect(screen.getAllByTestId('task-card')).toHaveLength(3));
    expect(screen.getAllByTestId('task-stage').map((e) => e.getAttribute('data-stage'))).toEqual(['QUEUED', 'RECONCILING', 'DONE']);
    expect(screen.getByText('LEGACY')).toBeTruthy();
    fireEvent.click(screen.getByText('Task t1'));
    const fields = screen.getByTestId('task-detail-fields').textContent!;
    expect(fields).toMatch(/task classNOT RECORDED/); expect(fields).toMatch(/guardianNOT RECORDED/);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('an unavailable API is UNAVAILABLE, not an empty board; a truly empty workspace says so', async () => {
    stub({ '/api/tasks': { status: 503, body: { success: false, controlPlane: 'UNREACHABLE' } } });
    render(<TaskBoardView workspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('task-board-unavailable').textContent).toMatch(/UNAVAILABLE.*not an empty board/));
    cleanup();
    stub({ '/api/tasks': { status: 200, body: { success: true, total: 0, tasks: [] } } });
    render(<TaskBoardView workspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('task-board-empty')).toBeTruthy());
  });

  it('the Tasks tab renders the server board; no browser-local board and no invented starter tasks in production', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain("{(activeTab === 'kanban' || activeTab === 'hermes-kanban') && (");
    expect(app).not.toMatch(/<KanbanView\b/);
    expect(app).not.toContain('INITIAL_KANBAN_TASKS');
  });
});

describe('Agent Registry: recorded facts only', () => {
  const agent = { agentId: 'scribe', kind: 'AGENT_ROLE', workspaceId: 'ws', source: 'CANONICAL_TASK_RECORD', taskCount: 3, byStage: { DONE: 1, FAILED: 1, RECONCILING: 1 }, succeeded: 1, failed: 1, modelsUsed: ['model-x'], firstSeenAt: '2026-09-01T00:00:00Z', lastActivityAt: '2026-09-18T00:00:00Z', recentTasks: [{ taskId: 't1', title: 'Real task', status: 'DONE', updatedAt: '2026-09-18T00:00:00Z', assignedModel: 'model-x' }] };
  it('lists agents from the task record and shows every unrecorded field as NOT RECORDED; #/agents/<role> selects one', async () => {
    window.location.hash = '#/agents/scribe';
    stub({ '/api/agents': { status: 200, body: { success: true, agents: [agent] } } });
    render(<AgentRegistryView workspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('agent-detail-fields')).toBeTruthy());
    const t = screen.getByTestId('agent-detail-fields').textContent!;
    expect(t).toMatch(/Succeeded \/ failed1 \/ 1 \(from task status\)/);
    for (const f of ['Tier', 'Capabilities', 'Assigned skills', 'Allowed tools', 'Approval policy', 'Enabled']) expect(t).toMatch(new RegExp(`${f}NOT RECORDED`));
    expect(screen.getByTestId('agent-recent-tasks').textContent).toContain('Real task');
    expect(document.body.textContent).not.toMatch(/ONLINE|memory file|uptime/i);
  });

  it('unavailable is not an empty roster; no agents is stated honestly', async () => {
    stub({ '/api/agents': { status: 500, body: { success: false, error: 'boom' } } });
    render(<AgentRegistryView workspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('agent-registry-unavailable').textContent).toMatch(/not an empty roster/));
    cleanup();
    stub({ '/api/agents': { status: 200, body: { success: true, agents: [] } } });
    render(<AgentRegistryView workspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('agent-registry-empty')).toBeTruthy());
  });
});
