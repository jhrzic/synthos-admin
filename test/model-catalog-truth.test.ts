import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  CATALOG_PROVIDERS,
  catalogModels,
  documentedModelsForProvider,
  modelsForProvider,
  defaultModelForProvider,
  getCatalogProvider,
  resolveModelState,
  isModelUsable,
  catalogAgreesWithRouter,
  providerForSeat,
  modelsForSeat,
  type CatalogModel,
} from '../lib/model-catalog';
import { classifyModelRequest, resolveDefaultOpenAiModel } from '../lib/model-router';

// ---------------------------------------------------------------------------
// CATALOG, EXECUTION AND ROUTING ARE THREE SEPARATE FACTS.
//
// Two defects were fixed in sequence here, and the second is the reason these
// tests exist in this shape.
//
// First: the Admin held one registry entry per SEAT with the model version
// smuggled into its display name ('Claude 3.7 Sonnet / Opus'), so a provider
// structurally WAS one model.
//
// Second: the first fix showed ZERO models for any provider without an
// execution adapter. That traded one untruth for another — a provider's fleet
// is knowable whether or not SynthOS can call it, and "Anthropic: 0 models" is
// false in a way that "Anthropic: 4 known, 0 executable" is not.
//
// So the invariant under test is that a model can be DISCOVERED while being
// EXECUTION_UNAVAILABLE and NOT_ROUTABLE, and that no axis is inferred from
// another.
// ---------------------------------------------------------------------------

const NO_CREDENTIAL = { credentialPresent: false, liveVerified: false };
const CREDENTIALED = { credentialPresent: true, liveVerified: false };
const VERIFIED = { credentialPresent: true, liveVerified: true };

describe('provider and model are separate concepts', () => {
  it('a provider is addressed by id and its name carries no model version', () => {
    for (const provider of CATALOG_PROVIDERS) {
      expect(provider.providerId).toMatch(/^[a-z]+$/);
      expect(provider.displayName, provider.providerId).not.toMatch(/\d+\.\d+/);
    }
  });

  it('every model has its own addressable id, distinct from its provider', () => {
    const models = catalogModels();
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.modelId, model.displayName).toBeTruthy();
      expect(model.modelId).not.toBe(model.providerId);
      expect(getCatalogProvider(model.providerId), model.modelId).toBeTruthy();
    }
  });

  it('one provider exposes multiple models', () => {
    const multi = CATALOG_PROVIDERS
      .map((p) => modelsForProvider(p.providerId).length)
      .filter((n) => n > 1);
    expect(multi.length).toBeGreaterThan(0);
  });

  it('a seat is not a model, and several seats may share one provider', () => {
    // `claude` and `claudecode` are both Anthropic seats; neither is a model.
    expect(providerForSeat('claude')?.providerId).toBe('anthropic');
    expect(providerForSeat('claudecode')?.providerId).toBe('anthropic');
    expect(providerForSeat('chatgpt')?.providerId).toBe('openai');
    expect(providerForSeat('codex')?.providerId).toBe('openai');
    // A seat's selectable models are its provider's, not one welded version.
    expect(modelsForSeat('claude').length).toBe(modelsForProvider('anthropic').length);
  });
});

describe('a discovered model can exist with no execution adapter', () => {
  it('Anthropic has catalogued models and zero executable ones', () => {
    // THE CORRECTION. Showing no Claude models because execution is
    // unavailable was its own untruth.
    const models = documentedModelsForProvider('anthropic');
    expect(models.length).toBeGreaterThan(0);

    const provider = getCatalogProvider('anthropic');
    expect(provider?.execution).toBe('EXECUTION_UNAVAILABLE');

    for (const model of models) {
      const state = resolveModelState(model, VERIFIED);
      // Known...
      expect(state.lifecycle, model.modelId).toBe('DISCOVERED');
      // ...but not callable, and not routable, even with a credential and a
      // prior success on record.
      expect(state.execution, model.modelId).toBe('EXECUTION_UNAVAILABLE');
      expect(state.routing, model.modelId).toBe('NOT_ROUTABLE');
      expect(isModelUsable(state), model.modelId).toBe(false);
    }
  });

  it('zero execution support does not imply zero catalog entries', () => {
    const unexecutable = CATALOG_PROVIDERS.filter((p) => p.execution === 'EXECUTION_UNAVAILABLE');
    expect(unexecutable.length).toBeGreaterThan(0);
    // At least one non-executable provider must still list models, or the
    // regression has returned.
    const withModels = unexecutable.filter((p) => documentedModelsForProvider(p.providerId).length > 0);
    expect(withModels.map((p) => p.providerId)).toContain('anthropic');
  });

  it('a non-executable model is never LIVE_VERIFIED, whatever the evidence', () => {
    const claude = documentedModelsForProvider('anthropic')[0];
    for (const evidence of [NO_CREDENTIAL, CREDENTIALED, VERIFIED]) {
      // Nothing can call it, so there is nothing to verify — UNKNOWN, not
      // "failed" and certainly not "verified".
      expect(resolveModelState(claude, evidence).verification).toBe('UNKNOWN');
    }
  });

  it('an unavailable provider explains why, so the gap is legible', () => {
    for (const provider of CATALOG_PROVIDERS) {
      if (provider.execution === 'SUPPORTED') continue;
      expect(provider.adapterNote.length, provider.providerId).toBeGreaterThan(20);
    }
  });

  it('a provider with no documented list stays empty rather than guessing', () => {
    // Perplexity has no model list held here and no callable endpoint. An
    // invented id would be worse than an empty catalog.
    expect(documentedModelsForProvider('perplexity')).toHaveLength(0);
    expect(getCatalogProvider('perplexity')?.adapterNote).toMatch(/empty rather than guessed/);
  });
});

describe('routing is its own axis', () => {
  it('an executable model needs a credential before it is routable', () => {
    const gemini = documentedModelsForProvider('google').find((m) => m.isProviderDefault) as CatalogModel;
    expect(resolveModelState(gemini, NO_CREDENTIAL).routing).toBe('NOT_ROUTABLE');
    expect(resolveModelState(gemini, CREDENTIALED).routing).toBe('ROUTABLE');
  });

  it('a credential alone is CONFIGURED, not verified', () => {
    const gemini = documentedModelsForProvider('google')[0];
    const state = resolveModelState(gemini, CREDENTIALED);
    expect(state.verification).toBe('CONFIGURED');
    expect(isModelUsable(state)).toBe(false);
  });

  it('only a real successful call reads as usable', () => {
    const gemini = documentedModelsForProvider('google')[0];
    const state = resolveModelState(gemini, VERIFIED);
    expect(state.verification).toBe('LIVE_VERIFIED');
    expect(isModelUsable(state)).toBe(true);
  });

  it('a REMOVED model is not routable even where execution is supported', () => {
    const gemini = documentedModelsForProvider('google')[0];
    const retired: CatalogModel = { ...gemini, lifecycle: 'REMOVED' };
    expect(resolveModelState(retired, VERIFIED).routing).toBe('NOT_ROUTABLE');
  });

  it('exactly one default per routable provider, and it is what the router resolves', () => {
    for (const provider of CATALOG_PROVIDERS) {
      const models = documentedModelsForProvider(provider.providerId);
      const defaults = models.filter((m) => m.isProviderDefault);
      if (provider.execution !== 'SUPPORTED') {
        // A default is meaningless where nothing routes.
        expect(defaults, provider.providerId).toHaveLength(0);
        continue;
      }
      expect(defaults.length, provider.providerId).toBe(1);
      expect(defaultModelForProvider(provider.providerId)).toBe(defaults[0].modelId);
    }
    const routed = classifyModelRequest('gemini');
    expect(routed.provider).toBe('GEMINI');
    if (routed.provider === 'GEMINI' || routed.provider === 'OPENAI') {
      expect(routed.resolvedModel).toBe(defaultModelForProvider('google'));
    }
  });
});

describe('the catalog does not drift from the router', () => {
  it('every catalogued model agrees with the router about its provider', () => {
    for (const model of catalogModels()) {
      expect(catalogAgreesWithRouter(model), `${model.providerId}/${model.modelId}`).toBe(true);
    }
  });

  it('only providers with an adapter are marked SUPPORTED', () => {
    for (const provider of CATALOG_PROVIDERS) {
      if (provider.execution !== 'SUPPORTED') {
        expect(provider.routerProvider, provider.providerId).toBeNull();
        continue;
      }
      expect(provider.routerProvider, provider.providerId).toBeTruthy();
      expect(documentedModelsForProvider(provider.providerId).length).toBeGreaterThan(0);
    }
  });

  it("OpenAI's default follows configuration rather than a frozen literal", () => {
    expect(defaultModelForProvider('openai')).toBe(resolveDefaultOpenAiModel());
  });

  it('a provider accepting uncatalogued ids says so, so no list implies exhaustiveness', () => {
    expect(getCatalogProvider('openai')?.acceptsUncataloguedIds).toBe(true);
    expect(getCatalogProvider('google')?.acceptsUncataloguedIds).toBe(false);
  });
});

describe('model ids are sourced, never invented', () => {
  it('every catalogued id records where it came from', () => {
    for (const model of catalogModels()) {
      expect(['PROVIDER_API', 'DOCUMENTED_CATALOG'], model.modelId).toContain(model.source);
    }
  });

  it("the documented Claude ids match this project's canonical model table", () => {
    // docs/synthos/CLAUDE.md carries the cost-tier table those ids come from.
    // If the catalog and that table disagree, one of them is wrong.
    const ids = documentedModelsForProvider('anthropic').map((m) => m.modelId);
    expect(ids).toContain('claude-opus-5');
    expect(ids).toContain('claude-sonnet-5');
    // And the stale version that started all of this is absent.
    expect(ids.some((id) => id.includes('3-7') || id.includes('3.7'))).toBe(false);
  });

  it('an undated alias is recorded as an alias, not as a second model', () => {
    const haiku = documentedModelsForProvider('anthropic').find((m) => m.modelId.startsWith('claude-haiku'));
    expect(haiku).toBeTruthy();
    // The project table names it undated; the provider id is dated. One model.
    expect(haiku?.aliases).toContain('claude-haiku-4-5');
  });
});

describe('the stale one-model-per-provider registry labels are gone', () => {
  const REGISTRY = 'src/data/mockData.ts';

  function registryBlock(): string {
    const src = fs.readFileSync(path.join(process.cwd(), REGISTRY), 'utf8');
    const start = src.indexOf('export const INITIAL_MODELS');
    const end = src.indexOf('export const', start + 10);
    return src.slice(start, end);
  }

  it('no seat name asserts a model version', () => {
    const block = registryBlock();
    for (const stale of [
      'Claude 3.7 Sonnet / Opus',
      'Claude Code (3.7 Sonnet)',
      'Gemini 3.7 / 3.6 Flash',
      'ChatGPT o3 / GPT-4.5',
      'DeepSeek R1 / V3',
      'Nous Hermes 3 (405B / 70B)',
    ]) {
      expect(block, stale).not.toContain(stale);
    }
  });

  it('the registry reports no performance for providers that never ran', () => {
    const block = registryBlock();
    const latency = [...block.matchAll(/latency:\s*(\d+)/g)].map((m) => Number(m[1]));
    const throughput = [...block.matchAll(/tokensPerSec:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(latency.length).toBeGreaterThan(0);
    expect(latency.every((n) => n === 0), `latency: ${latency.join(',')}`).toBe(true);
    expect(throughput.every((n) => n === 0), `tokensPerSec: ${throughput.join(',')}`).toBe(true);
  });
});
