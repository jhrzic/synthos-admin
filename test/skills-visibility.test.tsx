// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { SkillRegistryView } from '../src/components/SkillRegistryView';

// ---------------------------------------------------------------------------
// SKILLS VISIBILITY — the Admin Skills surface renders the canonical skills
// authority (lib/skills.ts via /api/skills): real records only, the three
// empty states distinguished, every field shown or marked NOT RECORDED.
// ---------------------------------------------------------------------------

const skill = (id: string, extra: Record<string, unknown> = {}) => ({
  skill_id: id, workspace_id: 'ws', name: `Skill ${id}`, description: 'd', category: 'tool', version: '1.2.0', enabled: true, status: 'NOT_CONFIGURED',
  source_type: 'manual', source_ref: null, markdown_spec: null, execution_target_type: 'deterministic', execution_target_ref: 'vault.list', credential_configured: false,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-10T00:00:00Z', callCount: 2, successCount: 1, lastTestedAt: '2026-09-11T00:00:00Z', ...extra,
});

const stub = (skillsResponse: { status: number; body: any }) => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${url}`);
    const p = url.split('?')[0];
    if (p === '/api/skills') return new Response(JSON.stringify(skillsResponse.body), { status: skillsResponse.status });
    if (p.endsWith('/executability')) return new Response(JSON.stringify({ success: true, executability: { executable: false, reason: 'NO_TARGET', message: 'no execution target is set' } }), { status: 200 });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }));
  return calls;
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Skills surface', () => {
  it('renders whatever the registry returns (a newly installed skill appears with no UI change), with every field', async () => {
    stub({ status: 200, body: { success: true, skills: [skill('sk-new-7f', { name: 'Brand-new installed skill' })] } });
    const nav = vi.fn();
    render(<SkillRegistryView activeWorkspaceId="ws" onNavigate={nav} />);
    await waitFor(() => expect(screen.getAllByText('Brand-new installed skill').length).toBeGreaterThan(0));
    const rec = screen.getByTestId('skill-record').textContent!;
    for (const want of ['sk-new-7f', 'v1.2.0', 'owner NOT RECORDED', 'manual', 'NOT_CONFIGURED', 'ENABLED', 'Compatible agents', 'deterministic: vault.list', 'Input / output contract', 'NOT RECORDED', '1/2 test attempts succeeded', 'workspace admin', '2026-09-10T00:00:00Z']) expect(rec, want).toContain(want);
    await waitFor(() => expect(screen.getByTestId('skill-blocking-reason').textContent).toBe('NO_TARGET: no execution target is set'));
    fireEvent.click(screen.getByText('Agent Registry'));
    fireEvent.click(screen.getByText('Tools'));
    expect(nav.mock.calls.map((c) => c[0])).toEqual(['agent-fleet', 'tool-registry']);
  });

  it('distinguishes none installed, not accessible and failed to load', async () => {
    stub({ status: 200, body: { success: true, skills: [] } });
    render(<SkillRegistryView activeWorkspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('skills-empty-state').getAttribute('data-empty-kind')).toBe('NONE_INSTALLED'));
    cleanup();
    stub({ status: 403, body: { success: false, error: 'Forbidden' } });
    render(<SkillRegistryView activeWorkspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('skills-empty-state').textContent).toMatch(/not accessible.*not an empty registry/));
    cleanup();
    stub({ status: 500, body: { success: false, error: 'db locked' } });
    render(<SkillRegistryView activeWorkspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('skills-empty-state').textContent).toMatch(/failed to load.*not an empty registry/));
    expect(screen.queryByText('No skills are installed for this workspace.')).toBeNull();
  });

  it('loading the surface only reads: no install, enable, execute or external call', async () => {
    const calls = stub({ status: 200, body: { success: true, skills: [skill('sk-1')] } });
    render(<SkillRegistryView activeWorkspaceId="ws" />);
    await waitFor(() => expect(screen.getByTestId('skill-record')).toBeTruthy());
    expect(calls.every((c) => c.startsWith('GET /api/skills'))).toBe(true);
  });

  it('there is no hardcoded skill inventory; the server scopes and authorizes every skills route', () => {
    const view = fs.readFileSync(path.join(process.cwd(), 'src/components/SkillRegistryView.tsx'), 'utf8');
    expect(view).not.toMatch(/const (SKILLS|DEFAULT_SKILLS|SAMPLE_SKILLS)\b/);
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(server).toContain('app.get("/api/skills", requireWorkspaceMember(fromQuery)');
    // /api/skills/discover is on the deliberate public allowlist (a bounded
    // repo scan with no workspace data; test/api-security-routes.test.ts).
    for (const m of server.matchAll(/app\.(get|post|patch|put|delete)\("(\/api\/skills[^"]*)", ([A-Za-z(]+)/g)) {
      if (m[2] === '/api/skills/discover') continue;
      expect(m[3], m[0]).toMatch(/^require/);
    }
  });
});
