import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  CATALOG_PROVIDERS,
  catalogModels,
  modelsForProvider,
  defaultModelForProvider,
  getCatalogProvider,
  resolveModelAvailability,
  isModelUsable,
  catalogAgreesWithRouter,
  type CatalogModel,
} from '../lib/model-catalog';
import { classifyModelRequest, resolveDefaultOpenAiModel } from '../lib/model-router';

// ---------------------------------------------------------------------------
// PROVIDER IS NOT MODEL.
//
// The Admin's registry held one entry per provider and smuggled model identity
// into the display name — 'Claude 3.7 Sonnet / Opus', 'Gemini 3.7 / 3.6 Flash',
// 'ChatGPT o3 / GPT-4.5' — with no modelId field anywhere. A provider
// structurally WAS one model, which is why a stale Claude version survived in
// the UI: the only way to change a model was to edit a label.
//
// These tests pin the separation, and pin the thing that makes a separate
// catalog safe: it must not drift from the router.
// ---------------------------------------------------------------------------

describe('provider and model are separate concepts', () => {
  it('a provider is addressed by id, not by a model name', () => {
    for (const provider of CATALOG_PROVIDERS) {
      expect(provider.providerId).toMatch(/^[a-z]+$/);
      // A provider's display name must not carry a version number — that is
      // how model identity got hidden inside provider labels.
      expect(provider.displayName, provider.providerId).not.toMatch(/\d+\.\d+/);
    }
  });

  it('every model carries its own addressable id, separate from its provider', () => {
    const models = catalogModels();
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.modelId, model.displayName).toBeTruthy();
      expect(model.providerId, model.modelId).toBeTruthy();
      // The id must not BE the provider id — that is the conflation.
      expect(model.modelId).not.toBe(model.providerId);
      expect(getCatalogProvider(model.providerId), model.modelId).toBeTruthy();
    }
  });

  it('one provider exposes multiple models', () => {
    // The whole point. At least one provider must have more than one model, or
    // the structure still collapses to one-model-per-provider in practice.
    const multi = CATALOG_PROVIDERS
      .map((p) => ({ id: p.providerId, n: modelsForProvider(p.providerId).length }))
      .filter((p) => p.n > 1);
    expect(multi.length).toBeGreaterThan(0);
  });

  it('a default model is a selection, not the provider’s only model', () => {
    for (const provider of CATALOG_PROVIDERS) {
      const models = modelsForProvider(provider.providerId);
      if (models.length === 0) continue;
      const defaults = models.filter((m) => m.isProviderDefault);
      // Exactly one default, and it is flagged rather than implied by position.
      expect(defaults.length, provider.providerId).toBe(1);
      expect(defaultModelForProvider(provider.providerId)).toBe(defaults[0].modelId);
      // Non-default models are still real catalog entries.
      if (models.length > 1) {
        expect(models.filter((m) => !m.isProviderDefault).length).toBeGreaterThan(0);
      }
    }
  });

  it('the routed default is marked distinctly from the rest', () => {
    const google = modelsForProvider('google');
    expect(google.length).toBeGreaterThan(1);
    const flagged = google.filter((m) => m.isProviderDefault).map((m) => m.modelId);
    expect(flagged).toHaveLength(1);
    // And it is the id the router actually resolves a bare provider alias to.
    // Narrowed rather than cast: classifyModelRequest returns a discriminated
    // union and the UNSUPPORTED branch genuinely has no resolvedModel.
    const routed = classifyModelRequest('gemini');
    expect(routed.provider).toBe('GEMINI');
    if (routed.provider === 'GEMINI' || routed.provider === 'OPENAI') {
      expect(routed.resolvedModel).toBe(flagged[0]);
    }
  });
});

describe('catalog presence is not execution proof', () => {
  const anyModel = (): CatalogModel => catalogModels()[0];

  it('a catalogued model with no credential is NOT_CONFIGURED, never usable', () => {
    const availability = resolveModelAvailability(anyModel(), { credentialPresent: false, liveVerified: false });
    expect(availability).toBe('NOT_CONFIGURED');
    expect(isModelUsable(availability)).toBe(false);
  });

  it('a credential alone is CONFIGURED, still not usable', () => {
    const availability = resolveModelAvailability(anyModel(), { credentialPresent: true, liveVerified: false });
    expect(availability).toBe('CONFIGURED');
    // The distinction the provider ledger already enforces: having a key is
    // not evidence the provider works.
    expect(isModelUsable(availability)).toBe(false);
  });

  it('only a real successful call reads as usable', () => {
    const availability = resolveModelAvailability(anyModel(), { credentialPresent: true, liveVerified: true });
    expect(availability).toBe('LIVE_VERIFIED');
    expect(isModelUsable(availability)).toBe(true);
  });

  it('a provider with no execution mapping is UNAVAILABLE even with a credential', () => {
    // No amount of credential makes a provider dispatchable when nothing in
    // this build calls it. Availability must not be inferred from the provider
    // merely existing in the catalog.
    const pretend: CatalogModel = {
      providerId: 'anthropic',
      modelId: 'some-claude-id',
      displayName: 'Some Claude',
      family: 'Claude',
      capabilityTags: [],
      modalities: ['text'],
      isProviderDefault: false,
      deprecated: false,
    };
    expect(resolveModelAvailability(pretend, { credentialPresent: true, liveVerified: true })).toBe('UNAVAILABLE');
  });
});

describe('the catalog does not drift from the router', () => {
  it('every executable model routes to the provider the catalog claims', () => {
    // A separate catalog is only safe if something checks it against the
    // routing authority. Without this, the two can disagree silently.
    for (const model of catalogModels()) {
      expect(catalogAgreesWithRouter(model), `${model.providerId}/${model.modelId}`).toBe(true);
    }
  });

  it('only providers the router can execute are marked EXECUTABLE', () => {
    for (const provider of CATALOG_PROVIDERS) {
      if (provider.execution !== 'EXECUTABLE') {
        expect(provider.routerProvider, provider.providerId).toBeNull();
        continue;
      }
      expect(provider.routerProvider, provider.providerId).toBeTruthy();
      // And it has at least one model, or "executable" means nothing.
      expect(modelsForProvider(provider.providerId).length, provider.providerId).toBeGreaterThan(0);
    }
  });

  it("OpenAI's catalogued default is the configured default, not a frozen literal", () => {
    // OPENAI_MODEL may override the built-in fallback; the catalog must follow
    // configuration rather than hardcoding a snapshot that OpenAI will retire.
    expect(defaultModelForProvider('openai')).toBe(resolveDefaultOpenAiModel());
  });

  it('a provider that accepts uncatalogued ids says so', () => {
    // OpenAI's router rule is prefix-based on purpose, so the catalog must not
    // imply its list is exhaustive.
    expect(getCatalogProvider('openai')?.acceptsUncataloguedIds).toBe(true);
    expect(getCatalogProvider('google')?.acceptsUncataloguedIds).toBe(false);
  });
});

describe('providers with no execution mapping carry no invented models', () => {
  it('Anthropic, DeepSeek, Nous and Perplexity have zero catalogued models', () => {
    // Listing "Claude 3.7 Sonnet" here would recreate the original defect:
    // a model name presented as real that nothing in this build can dispatch.
    for (const id of ['anthropic', 'deepseek', 'nousresearch', 'perplexity'] as const) {
      expect(modelsForProvider(id), id).toHaveLength(0);
      expect(getCatalogProvider(id)?.execution, id).toBe('RECOGNIZED');
    }
  });

  it('each non-executable provider explains why, so the gap is legible', () => {
    for (const provider of CATALOG_PROVIDERS) {
      if (provider.execution === 'EXECUTABLE') continue;
      expect(provider.note.length, provider.providerId).toBeGreaterThan(20);
    }
  });
});

describe('the stale one-model-per-provider labels are gone from the registry', () => {
  const REGISTRY = 'src/data/mockData.ts';

  it('no registry entry names a specific model version in its display name', () => {
    const src = fs.readFileSync(path.join(process.cwd(), REGISTRY), 'utf8');
    const start = src.indexOf('export const INITIAL_MODELS');
    const end = src.indexOf('export const', start + 10);
    const block = src.slice(start, end);
    // These were the conflated labels: a provider slot whose name was a model.
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

  it('the registry does not report performance for providers that never ran', () => {
    const src = fs.readFileSync(path.join(process.cwd(), REGISTRY), 'utf8');
    const start = src.indexOf('export const INITIAL_MODELS');
    const end = src.indexOf('export const', start + 10);
    const block = src.slice(start, end);
    // latency/tokensPerSec were invented figures — 145ms and 84 tok/s for a
    // provider whose own status field said `requires_key`.
    const latencies = [...block.matchAll(/latency:\s*(\d+)/g)].map((m) => Number(m[1]));
    const throughput = [...block.matchAll(/tokensPerSec:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(latencies.length).toBeGreaterThan(0);
    expect(latencies.every((n) => n === 0), `latencies: ${latencies.join(',')}`).toBe(true);
    expect(throughput.every((n) => n === 0), `throughput: ${throughput.join(',')}`).toBe(true);
  });
});
