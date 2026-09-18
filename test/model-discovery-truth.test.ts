import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  refreshModelCatalog,
  effectiveModelsForProvider,
  storedModelsForProvider,
  lastRefresh,
} from '../lib/model-discovery';
import { defaultModelForProvider, documentedModelsForProvider } from '../lib/model-catalog';
import { resolveRoute } from '../lib/registry';

// ---------------------------------------------------------------------------
// CATALOG SYNC MUST BE FREE, HONEST WHEN IT FAILS, AND MUST NOT TOUCH ROUTING.
//
// Three properties, each of which would be a real defect if violated:
//
//   1. A refresh spends no generation tokens. A "refresh models" button that
//      quietly costs inference per provider is a billing surprise.
//   2. A failed refresh preserves the last-known catalog and says it is
//      stale. Emptying a provider after a network blip would read as "this
//      provider has no models", which is the untruth class this whole effort
//      exists to remove.
//   3. Discovering a new model does not change what production routes to. A
//      provider shipping a model must never silently redirect traffic.
// ---------------------------------------------------------------------------

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_GEMINI_KEY = process.env.GEMINI_API_KEY;

/**
 * Live discovery is credential-gated: with no key, fetchLiveModelIds returns
 * null and the provider falls back to documented metadata WITHOUT calling
 * fetch. That is correct behaviour, so the tests exercising the live path have
 * to supply a key — otherwise they silently assert against the documented
 * path and prove nothing about discovery.
 *
 * These are placeholder values. Nothing real is contacted: fetch is stubbed in
 * every test below.
 */
function withTestCredentials(): void {
  process.env.OPENAI_API_KEY = 'sk-not-a-real-key-for-discovery-tests';
  process.env.GEMINI_API_KEY = 'not-a-real-key-for-discovery-tests';
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  if (ORIGINAL_GEMINI_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_GEMINI_KEY;
  vi.restoreAllMocks();
});

describe('a catalog refresh performs no inference', () => {
  it('issues GET requests only, and never sends a body', async () => {
    const calls: Array<{ url: string; method: string; hasBody: boolean }> = [];
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      calls.push({
        url: typeof input === 'string' ? input : String(input?.url ?? ''),
        method: String(init?.method ?? 'GET'),
        hasBody: init?.body !== undefined && init?.body !== null,
      });
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ data: [], models: [] }) } as any;
    }) as any;

    await refreshModelCatalog('MANUAL');

    // Whatever was called, all of it was metadata.
    for (const call of calls) {
      expect(call.method.toUpperCase(), call.url).toBe('GET');
      expect(call.hasBody, call.url).toBe(false);
      // And no generation endpoint was touched.
      expect(call.url).not.toMatch(/chat\/completions|\/responses|generateContent|:generate/i);
    }
  });

  it('reports zero inference calls in its own report', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ data: [], models: [] }),
    })) as any;
    const report = await refreshModelCatalog('MANUAL');
    expect(report.inferenceCalls).toBe(0);
  });

  it('the discovery module imports no generation path', () => {
    // Structural, not behavioural — but the structure is the guarantee. If
    // this module ever imports a generation adapter, a refresh could become
    // billable without any test noticing at runtime.
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/model-discovery.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .*?from '([^']+)';/gm)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec, `imports ${spec}`).not.toMatch(/model-openai|model-gemini|fabric\/model|generate/i);
    }
    // And no request in this file carries a body.
    expect(src).not.toMatch(/method:\s*['"]POST['"]/);
  });
});

describe('a failed refresh preserves the last-known catalog and marks it stale', () => {
  it('keeps models and records FAILED_STALE rather than emptying the provider', async () => {
    // First: a successful refresh that stores a known list.
    withTestCredentials();
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      const body = url.includes('openai')
        ? { data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-probe-model' }] }
        : { models: [{ name: 'models/gemini-3.1-flash-lite' }] };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) } as any;
    }) as any;
    await refreshModelCatalog('MANUAL');
    const before = effectiveModelsForProvider('openai').map((m) => m.modelId);
    expect(before).toContain('gpt-probe-model');

    // Then: the provider becomes unreachable.
    globalThis.fetch = vi.fn(async () => { throw new Error('network unreachable'); }) as any;
    const report = await refreshModelCatalog('MANUAL');

    const openai = report.providers.find((p) => p.providerId === 'openai');
    expect(openai?.outcome).toBe('FAILED_STALE');
    expect(openai?.error).toBeTruthy();
    expect(report.anyStale).toBe(true);

    // The catalog is intact — NOT emptied.
    const after = effectiveModelsForProvider('openai').map((m) => m.modelId);
    expect(after).toEqual(before);
    expect(after.length).toBeGreaterThan(0);
  });

  it('a provider with no credential falls back to documented metadata, not to empty', async () => {
    // Deliberately NO credentials: the point is that the absence of a key is
    // not a failure, and must not empty the provider.
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    globalThis.fetch = vi.fn(async () => { throw new Error('should not be called'); }) as any;
    const report = await refreshModelCatalog('MANUAL');

    const anthropic = report.providers.find((p) => p.providerId === 'anthropic');
    // No Anthropic credential exists, so this is not a failure — it is the
    // documented path, and it must still yield models.
    expect(anthropic?.outcome).toMatch(/DOCUMENTED_NO_CREDENTIAL|DOCUMENTED_NO_ENDPOINT/);
    expect(anthropic?.discoveredCount).toBeGreaterThan(0);
    expect(effectiveModelsForProvider('anthropic').length).toBeGreaterThan(0);
  });
});

describe('discovery records a diff without changing routing', () => {
  it('detects a newly appearing model', async () => {
    withTestCredentials();
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      const body = url.includes('openai')
        ? { data: [{ id: 'gpt-5.6-terra' }] }
        : { models: [] };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) } as any;
    }) as any;
    await refreshModelCatalog('MANUAL');

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      const body = url.includes('openai')
        ? { data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-brand-new' }] }
        : { models: [] };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) } as any;
    }) as any;
    const report = await refreshModelCatalog('MANUAL');

    const openai = report.providers.find((p) => p.providerId === 'openai');
    expect(openai?.added).toContain('gpt-brand-new');
  });

  it('marks a vanished model REMOVED rather than deleting the record', async () => {
    withTestCredentials();
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      const body = url.includes('openai') ? { data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-retiring' }] } : { models: [] };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) } as any;
    }) as any;
    await refreshModelCatalog('MANUAL');

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      const body = url.includes('openai') ? { data: [{ id: 'gpt-5.6-terra' }] } : { models: [] };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) } as any;
    }) as any;
    const report = await refreshModelCatalog('MANUAL');

    const openai = report.providers.find((p) => p.providerId === 'openai');
    expect(openai?.removed).toContain('gpt-retiring');
    // The record survives, flagged — a retirement leaves evidence.
    const stored = storedModelsForProvider('openai');
    const retired = stored.find((m) => m.modelId === 'gpt-retiring');
    expect(retired?.lifecycle).toBe('REMOVED');
  });

  it('a new model does not become the routed default', async () => {
    withTestCredentials();
    const defaultBefore = defaultModelForProvider('openai');
    const routedBefore = resolveRoute('openai/gpt-9-supreme');

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      // A shiny new model appears first in the provider's list.
      const body = url.includes('openai')
        ? { data: [{ id: 'gpt-9-supreme' }, { id: 'gpt-5.6-terra' }] }
        : { models: [{ name: 'models/gemini-9-new' }, { name: 'models/gemini-3.1-flash-lite' }] };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) } as any;
    }) as any;
    await refreshModelCatalog('MANUAL');

    // Routing is unchanged. Discovery informs; the router decides.
    expect(defaultModelForProvider('openai')).toBe(defaultBefore);
    // A discovered id is a candidate, never a registered (routable) model.
    expect(routedBefore).toMatchObject({ ok: false, code: 'MODEL_NOT_REGISTERED' });
    expect(resolveRoute('openai/gpt-9-supreme')).toMatchObject({ ok: false, code: 'MODEL_NOT_REGISTERED' });
    // And a discovered id is not silently promoted to default.
    const stored = storedModelsForProvider('openai');
    expect(stored.find((m) => m.modelId === 'gpt-9-supreme')?.isProviderDefault ?? false).toBe(false);
  });

  it('stores a refresh report that can be read back', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ data: [], models: [] }),
    })) as any;
    await refreshModelCatalog('MANUAL');
    const report = lastRefresh();
    expect(report?.trigger).toBe('MANUAL');
    expect(report?.inferenceCalls).toBe(0);
    expect(report?.providers.length).toBeGreaterThan(0);
  });
});

describe('catalog is never empty merely because discovery has not run', () => {
  it('every provider with documented models reports them before any refresh', () => {
    // effectiveModelsForProvider falls back to documented metadata, so an
    // Admin opened before the first refresh still shows a real fleet.
    for (const providerId of ['anthropic', 'google', 'deepseek'] as const) {
      const documented = documentedModelsForProvider(providerId);
      if (documented.length === 0) continue;
      expect(effectiveModelsForProvider(providerId).length, providerId).toBeGreaterThan(0);
    }
  });
});
