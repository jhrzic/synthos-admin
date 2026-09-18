// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ModelFamiliesPanel } from '../src/components/registry/ModelFamiliesPanel';
import type { RegistryModel, RegistryProvider } from '../src/components/registry/useModelRegistry';

// ---------------------------------------------------------------------------
// MODEL REGISTRY VISIBILITY. The panel renders whatever the LOCAL registry
// holds — a provider/family/version added by an import appears with no code
// change — and an aggregator's offering stays blocked until mapped. Synthetic
// names only; every request is a local /api/registry read.
// ---------------------------------------------------------------------------

const provider = (id: string, extra: Partial<RegistryProvider> = {}): RegistryProvider => ({
  providerId: id, displayName: id, protocol: 'openai.chat_completions', adapterDispatch: 'x', manifestVersion: '1', source: 'PLUGIN', approvedHosts: [],
  endpoint: { ok: true, host: `api.${id}.example`, overridden: false, reason: null }, credential: { ready: false, source: 'NONE' }, billing: 'METERED', modelCount: 1, executableCount: 0, health: 'UNKNOWN', ...extra,
});
const model = (providerId: string, modelId: string, extra: Partial<RegistryModel> = {}): RegistryModel => ({
  providerId, providerDisplayName: providerId, modelId, displayName: modelId, aliases: [], lifecycle: 'ACTIVE',
  limits: { contextTokens: 1000, outputTokens: 100 }, modalities: { input: ['text'], output: ['text'] },
  capabilities: [{ id: 'text.output', supported: true, verification: 'PUBLISHER_ASSERTED', source: 'manifest' }], outputContracts: ['LITERAL'],
  protocol: 'openai.chat_completions', source: 'PLUGIN', manifestVersion: 'zeta-1', adminState: 'DISABLED', availability: 'NOT_CONFIGURED', executable: false,
  blockers: [{ state: 'NOT_CONFIGURED', reason: 'no credential configured for zeta' }],
  pricing: { state: 'CURRENT', current: { rates: { input: 1, output: 2, cachedInput: null }, unit: 'tokens', currency: 'USD', staleAfter: '2027-01-01T00:00:00Z', source: 'manifest', approval: 'APPROVED' } as any, versionKey: 'k' },
  paid: true, routeKind: 'DIRECT', ...extra,
});

const identity = {
  success: true, providerCallsMade: 0,
  families: [{ familyId: 'zeta-large', displayName: 'Zeta Large', publisher: 'zeta', versions: [{ canonicalVersionId: 'zeta/zeta-large-7', lifecycle: 'ACTIVE', releaseDate: '2026-09-01', definedBy: 'PUBLISHER' }] }],
  routes: [
    { providerId: 'zeta', modelId: 'zeta-large-7', canonicalVersionId: 'zeta/zeta-large-7', status: 'IMPLICIT_PUBLISHER', resolved: true },
    { providerId: 'hub-agg', modelId: 'zeta/zeta-large-latest', canonicalVersionId: null, proposedVersionId: 'zeta/zeta-large-7', status: 'UNMAPPED', resolved: false, reason: 'an aggregator id is not a version until an operator maps it' },
  ],
  deployments: { zeta: ['default'], 'hub-agg': ['default'] },
};

const calls: string[] = [];
const stubFetch = (fail: string[] = []) => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const path = url.split('?')[0];
    if (fail.includes(path)) return new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 });
    const body = path === '/api/registry/identity' ? identity
      : path === '/api/registry/qualifications' ? { success: true, qualifications: [{ qualificationId: 'q1', providerId: 'zeta', modelId: 'zeta-large-7', taskClass: 'literal_transformation', state: 'VALID', quality: 1, reliability: 1, expiresAt: '2026-12-31', stateReasons: [] }] }
      : path === '/api/registry/route-imports' ? { success: true, importers: [], refresh: { enabled: false, cadenceHours: 24, importers: [] } }
      : path === '/api/registry/task-classes' ? { success: true, taskClasses: [{ taskClassId: 'literal_transformation' }] }
      : { success: true };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
};

const models = [model('zeta', 'zeta-large-7'), model('hub-agg', 'zeta/zeta-large-latest', { routeKind: 'AGGREGATOR', pricing: { state: 'UNKNOWN', current: null, versionKey: null }, blockers: [{ state: 'IDENTITY_UNRESOLVED', reason: 'UNMAPPED' }, { state: 'PRICING_UNKNOWN', reason: 'no price record' }] })];
const providers = [provider('zeta'), provider('hub-agg', { credential: { ready: true, source: 'ENV' } })];

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('model registry visibility', () => {
  it('renders a newly imported provider, family, version, route, deployment, states and qualification — from data only', async () => {
    stubFetch();
    render(<ModelFamiliesPanel workspaceId="ws" models={models} providers={providers} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Zeta Large/)).toBeTruthy());
    expect(screen.getAllByText(/zeta\/zeta-large-7/).length).toBeGreaterThan(0);
    const states = screen.getAllByTestId('registry-route-state').map((e) => e.textContent).join(' | ');
    expect(states).toMatch(/DISABLED/);
    expect(states).toMatch(/deployment default/);
    expect(states).toMatch(/credential NOT CONFIGURED/);
    expect(states).toMatch(/metadata: PLUGIN · manifest zeta-1 · 0\/1 capabilities independently verified/);
    expect(document.body.textContent).toMatch(/1\/2 USD\/M tokens \(CURRENT, APPROVED; stale after 2027-01-01\)/);
    expect(document.body.textContent).toMatch(/literal_transformation · VALID/);
    expect(screen.getAllByTestId('registry-route-blockers')[0].textContent).toMatch(/NOT_CONFIGURED: no credential configured for zeta/);
  });

  it('an aggregator offering is a route to a canonical version, listed as unmapped and blocked until an operator maps it', async () => {
    stubFetch();
    render(<ModelFamiliesPanel workspaceId="ws" models={models} providers={providers} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('registry-unmapped').textContent).toMatch(/hub-agg\/zeta\/zeta-large-latest/));
    const unmapped = screen.getByTestId('registry-unmapped').textContent!;
    expect(unmapped).toMatch(/cannot run/);
    expect(unmapped).toMatch(/proposes zeta\/zeta-large-7/);
    expect(unmapped).toMatch(/IDENTITY_UNRESOLVED/);
    expect(unmapped).toMatch(/PRICING_UNKNOWN/);
  });

  it('a failed registry read is shown as a failure, not as an empty registry', async () => {
    stubFetch(['/api/registry/identity']);
    render(<ModelFamiliesPanel workspaceId="ws" models={[]} providers={[]} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('model-families-error').textContent).toMatch(/identity \(boom\).*not an empty registry/));
    expect(screen.queryByTestId('model-families-empty')).toBeNull();
  });

  it('reads only the local registry, once: no external request and no polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubFetch();
      render(<ModelFamiliesPanel workspaceId="ws" models={models} providers={providers} onChanged={() => {}} />);
      await waitFor(() => expect(calls.length).toBe(4));
      vi.advanceTimersByTime(10 * 60_000);
      expect(calls.length).toBe(4);
      expect(calls.every((u) => u.startsWith('/api/registry/'))).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('no model selector hardcodes a production model name; selection goes through the registry', () => {
    const dir = path.join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name)) files.push(p); } };
    walk(dir);
    const MODEL = /(gpt-\d|claude-(opus|sonnet|haiku|fable)|gemini-\d|qwen\d|llama\d|deepseek-(chat|coder|r1)|hermes\d)/i;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<option[^>]*value=["'{]([^"'}]*)["'}]/g)) expect(MODEL.test(m[1]), `${path.relative(process.cwd(), f)}: <option value="${m[1]}">`).toBe(false);
    }
  });
});
