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

const PAYLOAD = {
  success: true,
  providers: [
    {
      providerId: 'google', displayName: 'Google', family: 'Gemini',
      execution: 'EXECUTABLE', routerProvider: 'GEMINI',
      credentialEnvVar: 'GEMINI_API_KEY', credentialPresent: true,
      providerState: 'CREDENTIAL_PRESENT', providerReason: 'configured, never attempted',
      lastVerifiedAt: null, acceptsUncataloguedIds: false, note: '',
      defaultModelId: 'gemini-3.1-flash-lite', modelCount: 3,
      models: [
        { modelId: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', family: 'Gemini', capabilityTags: ['text'], modalities: ['text'], isProviderDefault: true,  deprecated: false, availability: 'CONFIGURED',     routesToRouterProvider: true },
        { modelId: 'gemini-3.7-flash',      displayName: 'Gemini 3.7 Flash',      family: 'Gemini', capabilityTags: ['text'], modalities: ['text'], isProviderDefault: false, deprecated: false, availability: 'CONFIGURED',     routesToRouterProvider: true },
        { modelId: 'gemini-3.1-pro-preview',displayName: 'Gemini 3.1 Pro',        family: 'Gemini', capabilityTags: ['text'], modalities: ['text'], isProviderDefault: false, deprecated: false, availability: 'NOT_CONFIGURED', routesToRouterProvider: true },
      ],
    },
    {
      providerId: 'anthropic', displayName: 'Anthropic', family: 'Claude',
      execution: 'RECOGNIZED', routerProvider: null,
      credentialEnvVar: null, credentialPresent: false,
      providerState: 'NO_CREDENTIAL', providerReason: 'no execution mapping',
      lastVerifiedAt: null, acceptsUncataloguedIds: false,
      note: 'Recognized by the router so a request can be refused by name. No execution mapping exists in this build.',
      defaultModelId: null, modelCount: 0, models: [],
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
    expect(document.body.textContent).toContain('3 models');
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
  });

  it('per-model availability differs within the same provider', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('gemini-3.1-pro-preview')).toBeTruthy());
    // If availability were inferred from the provider, every model under one
    // provider would read identically. They must not.
    expect(screen.getAllByText('CONFIGURED').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('NOT CONFIGURED')).toBeTruthy();
  });

  it('a provider with no execution mapping lists no models and says why', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('Anthropic')).toBeTruthy());
    const text = document.body.textContent || '';
    expect(text).toContain('NO EXECUTION MAPPING');
    expect(text).toContain('No catalogued models');
    // And critically: no invented Claude model id appears.
    expect(text).not.toMatch(/claude-[\d.]/i);
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
