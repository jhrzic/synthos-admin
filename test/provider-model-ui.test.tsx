// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { ProviderModelCatalog } from '../src/components/ProviderModelCatalog';

// ---------------------------------------------------------------------------
// THE UI RENDERS MANY MODELS PER PROVIDER, AND INFERS NOTHING.
//
// The old surface was one card per provider with the version in its title, so
// a provider could only ever show one model and "Claude" was permanently
// "Claude 3.7 Sonnet". These tests assert the rendered DOM: several models
// under one provider, the routed default marked distinctly, and availability
// taken from the payload rather than inferred from the provider existing.
// ---------------------------------------------------------------------------

const model = (over: Record<string, unknown>) => ({
  displayName: 'x', family: 'Gemini', capabilityTags: ['text'], modalities: ['text'],
  aliases: [], source: 'DOCUMENTED_CATALOG', isProviderDefault: false,
  lifecycle: 'DISCOVERED', execution: 'SUPPORTED', routing: 'ROUTABLE',
  verification: 'CONFIGURED', routesToRouterProvider: true, ...over,
});

const PAYLOAD = {
  success: true,
  providers: [
    {
      providerId: 'google', displayName: 'Google', family: 'Gemini',
      execution: 'SUPPORTED', routerProvider: 'GEMINI',
      credentialEnvVar: 'GEMINI_API_KEY', credentialPresent: true,
      hasDiscoveryEndpoint: true, adapterNote: '',
      providerState: 'CREDENTIAL_PRESENT', providerReason: 'configured, never attempted',
      lastVerifiedAt: null, acceptsUncataloguedIds: false,
      defaultModelId: 'gemini-3.1-flash-lite',
      discoveredCount: 3, executableCount: 3, routableCount: 2,
      refreshOutcome: 'LIVE', refreshError: null, stale: false,
      models: [
        model({ modelId: 'gemini-3.1-flash-lite', isProviderDefault: true }),
        model({ modelId: 'gemini-3.7-flash' }),
        model({ modelId: 'gemini-3.1-pro-preview', routing: 'NOT_ROUTABLE', verification: 'NOT_CONFIGURED' }),
      ],
    },
    {
      // THE CORRECTION UNDER TEST: known models, zero executable.
      providerId: 'anthropic', displayName: 'Anthropic', family: 'Claude',
      execution: 'EXECUTION_UNAVAILABLE', routerProvider: null,
      credentialEnvVar: 'ANTHROPIC_API_KEY', credentialPresent: false,
      hasDiscoveryEndpoint: true,
      adapterNote: 'No Anthropic execution adapter exists in this build, so no Claude model can be dispatched.',
      providerState: 'NO_CREDENTIAL', providerReason: 'no adapter',
      lastVerifiedAt: null, acceptsUncataloguedIds: false,
      defaultModelId: null,
      discoveredCount: 2, executableCount: 0, routableCount: 0,
      refreshOutcome: 'DOCUMENTED_NO_CREDENTIAL', refreshError: null, stale: false,
      models: [
        model({ modelId: 'claude-opus-5', family: 'Claude', execution: 'EXECUTION_UNAVAILABLE', routing: 'NOT_ROUTABLE', verification: 'UNKNOWN' }),
        model({ modelId: 'claude-sonnet-5', family: 'Claude', execution: 'EXECUTION_UNAVAILABLE', routing: 'NOT_ROUTABLE', verification: 'UNKNOWN' }),
      ],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => PAYLOAD })) as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('one provider renders many models', () => {
  it('shows all three Gemini model ids, not just the default', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('gemini-3.1-flash-lite')).toBeTruthy());
    // The point: every model id appears, addressable and distinct.
    expect(screen.getByText('gemini-3.7-flash')).toBeTruthy();
    expect(screen.getByText('gemini-3.1-pro-preview')).toBeTruthy();
    expect(document.body.textContent).toContain('Models discovered: 3');
  });

  it('marks the routed default distinctly from the others', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('gemini-3.1-flash-lite')).toBeTruthy());
    // Exactly one default badge — a default is a selection, not the only model.
    expect(screen.getAllByText('ROUTED DEFAULT')).toHaveLength(1);
  });

  it('renders the provider name without a model version in it', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('Google')).toBeTruthy());
    // The conflated labels are gone: no provider heading carries a version.
    const text = document.body.textContent || '';
    expect(text).not.toContain('Claude 3.7 Sonnet');
    expect(text).not.toContain('Gemini 3.7 / 3.6 Flash');
  });
});

describe('availability is taken from evidence, never inferred', () => {
  it('a configured model is not shown as verified', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('gemini-3.1-flash-lite')).toBeTruthy());
    const text = document.body.textContent || '';
    // CONFIGURED means a key resolves — not that a call has ever worked.
    expect(text).toContain('CONFIGURED');
    expect(text).not.toContain('LIVE VERIFIED');
    // And a model nothing can call reads UNVERIFIED, not "failed".
    expect(text).toContain('UNVERIFIED');
  });

  it('per-model availability differs within the same provider', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('gemini-3.1-pro-preview')).toBeTruthy());
    // If availability were inferred from the provider, every model under one
    // provider would read identically. They must not.
    expect(screen.getAllByText('CONFIGURED').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('NOT CONFIGURED')).toBeTruthy();
    // Routing differs per model within one provider too.
    expect(screen.getAllByText('ROUTABLE').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('NOT ROUTABLE').length).toBeGreaterThanOrEqual(1);
  });

  it('a provider with no adapter still lists its known models, marked unexecutable', async () => {
    // THE CORRECTION. Showing zero Claude models because execution is
    // unavailable was its own untruth; the fleet is knowable either way.
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('Anthropic')).toBeTruthy());

    // The models are present and addressable...
    expect(screen.getByText('claude-opus-5')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy();

    const text = document.body.textContent || '';
    // ...and plainly not executable, not routable, not verified.
    expect(text).toContain('ADAPTER NOT CONFIGURED');
    expect(text).toContain('NO ADAPTER');
    expect(text).toContain('NOT ROUTABLE');
    expect(text).not.toContain('No catalogued models');
    // The stale version that started this is still absent.
    expect(text).not.toMatch(/claude-3[.-]7/i);
  });

  it('shows discovered and executable counts side by side', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('Anthropic')).toBeTruthy());
    const text = (document.body.textContent || '').replace(/\s+/g, ' ');
    // Either number alone would mislead. Both, together.
    expect(text).toContain('Models discovered: 2');
    expect(text).toContain('Executable: 0');
    expect(text).toContain('Models discovered: 3');
    expect(text).toContain('Executable: 3');
  });
});

describe('the catalog surface does not claim a count before it has one', () => {
  it('shows an em-dash until the fetch resolves', async () => {
    let release: (v: any) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { release = r; })) as any);
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    // Before resolution it must not claim "0 provider(s)" — that would read as
    // "none exist" rather than "not loaded".
    expect(document.body.textContent).toContain('—');
    expect(document.body.textContent).not.toContain('0 provider(s)');
    release({ ok: true, status: 200, json: async () => PAYLOAD });
    await waitFor(() => expect(document.body.textContent).toContain('2 provider(s)'));
  });

  it('reports a failed read as a failure, not as an empty catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) })) as any);
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(document.body.textContent).toContain('Could not read the model catalog'));
    expect(document.body.textContent).toContain('boom');
  });
});
