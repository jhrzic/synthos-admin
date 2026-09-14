// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ModelProviderCredentialsCard } from '../src/components/ModelProviderCredentialsCard';

// ---------------------------------------------------------------------------
// PUSH 2F — one credential source, and no field that pretends to be one.
//
// THE DEFECT THIS LOCKS OUT. Settings → Connected accepted a real API key for
// eight services into localStorage['hermes_jarvis_settings'].customApiKeys,
// which no server route has ever read. A real OpenAI key was entered there,
// the UI accepted it silently, and the platform reported NOT_CONFIGURED for
// days. Finding it took a full investigation across every database on the
// machine.
//
// That is precisely the failure AGENTS.md section 3 forbids: a control that
// changes frontend state and implies success. These tests are mostly
// STRUCTURAL — they read the shipped source — because the property that
// matters is "no code path exists that can do this again", not "this render
// happened to look right".
// ---------------------------------------------------------------------------

const WS = 'ws-cred-source';
const SETTINGS = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SettingsView.tsx'), 'utf8');
const APP = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

let fetchMock: ReturnType<typeof vi.fn>;
function mockBackend(handlers: Record<string, unknown>) {
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(handlers)) {
      if (u.includes(pattern)) return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
    }
    return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '{}' } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('1. THE LEGACY GRID can no longer collect a credential nothing reads', () => {
  it('every provider row declares what it is REALLY wired to', () => {
    // The fix is the classification itself: a row cannot exist without saying
    // whether a server actually receives what is typed into it.
    for (const w of ["wiring: 'MODEL_PROVIDERS'", "wiring: 'SERVER'", "wiring: 'NOT_WIRED'"]) {
      expect(SETTINGS).toContain(w);
    }
  });

  it('OpenAI has NO input in the legacy grid — it points at the one real store instead', () => {
    expect(SETTINGS).toContain("{ key: 'openai'");
    expect(SETTINGS).toMatch(/key: 'openai'[^\n]*wiring: 'MODEL_PROVIDERS'/);
    // Two working inputs for one credential is the thing being removed, not
    // replaced with a second copy.
    expect(SETTINGS).toContain('Configured in <span className="font-bold">Model Providers</span>');
  });

  it('providers with no server mapping are DISABLED, not quietly collecting keys', () => {
    expect(SETTINGS).toContain('Not wired to any runtime');
    expect(SETTINGS).toMatch(/disabled\s*\n?\s*value=""/);
    expect(SETTINGS).toContain('would be stored in this');
    for (const p of ['openrouter', 'anthropic', 'deepseek', 'perplexity', 'kimi', 'cursor']) {
      expect(SETTINGS).toMatch(new RegExp(`key: '${p}'[^\\n]*wiring: 'NOT_WIRED'`));
    }
  });

  it('Fish Audio still works — it was always a real server delegate, and was not broken by the fix', () => {
    expect(SETTINGS).toMatch(/key: 'fish_audio'[^\n]*wiring: 'SERVER'/);
    expect(SETTINGS).toContain('void persistVoiceCredential(val)');
  });

  it('no row writes a provider key into settings state any more', () => {
    // The old handler did `customApiKeys: { ...s.customApiKeys, [item.key]: val }`.
    // Its absence is the guarantee; the only remaining write clears the field.
    expect(SETTINGS).not.toContain('[item.key]: item.key === \'fish_audio\' ? \'\' : val');
    expect(SETTINGS).not.toMatch(/customApiKeys:\s*\{\s*\.\.\.s\.customApiKeys,\s*\[item\.key\]:\s*val/);
  });
});

describe('2. A BROWSER VALUE can never produce a configured/connected state', () => {
  it('the setup wizard badge no longer treats a localStorage key as connected', () => {
    // This single expression could turn the badge "Swarm Credentials
    // Configured" on the strength of a value no server had ever seen.
    expect(SETTINGS).not.toContain('settings.customApiKeys?.openrouter ||');
    expect(SETTINGS).toContain('isConnected: Boolean(credentialStatus?.apiKeyPresent || settings.security?.vault_permissions.write_access)');
  });

  it('no provider status anywhere is derived from customApiKeys', () => {
    const suspicious = SETTINGS.split('\n').filter((l) =>
      l.includes('customApiKeys') && /isConnected|configured|CONFIGURED|AVAILABLE|CONNECTED/.test(l));
    expect(suspicious).toEqual([]);
  });

  it('the browser stops persisting provider keys it cannot use', () => {
    expect(APP).toContain('BROWSER_UNPERSISTED_PROVIDER_KEYS');
    for (const p of ['openai', 'gemini', 'openrouter', 'anthropic', 'deepseek', 'perplexity', 'kimi', 'cursor', 'fish_audio']) {
      expect(APP).toMatch(new RegExp(`${p}: undefined`));
    }
  });

  it('elevenlabs is deliberately still persisted, because browser code really uses it', () => {
    // Preserving genuinely-used legacy behaviour is part of the fix, not an
    // oversight: JarvisView sends this as an xi-api-key header.
    const decl = APP.slice(APP.indexOf('BROWSER_UNPERSISTED_PROVIDER_KEYS'), APP.indexOf('const LAST_WORKSPACE_STORAGE_KEY'));
    expect(decl).not.toContain('elevenlabs');
    const jarvis = fs.readFileSync(path.resolve(process.cwd(), 'src/components/JarvisView.tsx'), 'utf8');
    expect(jarvis).toContain('customApiKeys.elevenlabs');
  });

  it('no automatic migration of a previously stored provider secret exists', () => {
    // A key the server never saw is not ours to move. The only migration in
    // the app remains the pre-existing Fish Audio one.
    expect(APP).not.toMatch(/customApiKeys\.openai/);
    expect(APP).not.toMatch(/model-credentials/);
  });
});

describe('3. MODEL PROVIDERS is the one authoritative path, and it is server-backed', () => {
  it('saving OpenAI goes to the real credential API, not to settings state', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [{ provider: 'openai', state: 'NOT_CONFIGURED', configured: false, envVar: 'OPENAI_API_KEY', storedRowPresent: false, overriddenByEnvironment: false, updatedAt: null }],
      },
    });
    render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);
    fireEvent.change(await screen.findByPlaceholderText(/Paste the API key/i), { target: { value: 'sk-openai-goes-to-the-server' } });
    fireEvent.click(screen.getByText('Save & Verify'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(post).toBeTruthy();
      expect(String(post![0])).toContain('/api/platform/model-credentials/openai');
      const body = JSON.parse(post![1].body);
      expect(body.apiKey).toBe('sk-openai-goes-to-the-server');
      expect(body.workspaceId).toBe(WS);
    });
  });

  it('saving Gemini uses the same route, parameterized — one endpoint, not one per provider', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [{ provider: 'gemini', state: 'NOT_CONFIGURED', configured: false, envVar: 'GEMINI_API_KEY', storedRowPresent: false, overriddenByEnvironment: false, updatedAt: null }],
      },
    });
    render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);
    fireEvent.change(await screen.findByPlaceholderText(/Paste the API key/i), { target: { value: 'AIza-gemini-goes-to-the-server' } });
    fireEvent.click(screen.getByText('Save & Verify'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(String(post![0])).toContain('/api/platform/model-credentials/gemini');
    });
  });

  it('status is read from the server, and the secret is never rendered', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [
          { provider: 'openai', state: 'STORED', configured: true, envVar: 'OPENAI_API_KEY', storedRowPresent: true, overriddenByEnvironment: false, updatedAt: '2026-09-14T09:00:00.000Z' },
          { provider: 'gemini', state: 'ENVIRONMENT', configured: true, envVar: 'GEMINI_API_KEY', storedRowPresent: false, overriddenByEnvironment: false, updatedAt: null },
        ],
      },
    });
    const { container } = render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);

    expect(await screen.findByText('STORED')).toBeTruthy();
    expect(screen.getByText('ENVIRONMENT')).toBeTruthy();
    expect(container.textContent).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(container.textContent).not.toMatch(/AIza[A-Za-z0-9]{8,}/);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(`workspaceId=${WS}`))).toBe(true);
  });

  it('environment precedence is surfaced, so a stored key that is being overridden explains itself', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [{ provider: 'openai', state: 'ENVIRONMENT', configured: true, envVar: 'OPENAI_API_KEY', storedRowPresent: true, overriddenByEnvironment: true, updatedAt: '2026-09-14T09:00:00.000Z' }],
      },
    });
    render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);
    expect(await screen.findByText(/takes\s+precedence/i)).toBeTruthy();
    // And an environment-supplied key offers no edit control at all.
    expect(screen.queryByPlaceholderText(/Paste the API key/i)).toBeNull();
  });

  it('without a workspace it refuses to render a credential surface rather than guessing scope', () => {
    mockBackend({});
    render(<ModelProviderCredentialsCard activeWorkspaceId={undefined} />);
    expect(screen.getByText(/Select a workspace/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
