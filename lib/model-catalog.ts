// ---------------------------------------------------------------------------
// CANONICAL MODEL CATALOG.
//
// THREE SEPARATE CONCEPTS, AND KEEPING THEM SEPARATE IS THE WHOLE POINT
//
//   1. CATALOG    — what models are known to exist for a provider.
//   2. EXECUTION  — whether SynthOS has an adapter that can call them.
//   3. ROUTING    — whether a model is selected/eligible for a task now.
//
// A model may legitimately be DISCOVERED, EXECUTION_UNAVAILABLE and
// NOT_ROUTABLE all at once. That is not a contradiction; it is the truth about
// every Claude model in this build today.
//
// TWO DEFECTS THIS MODULE HAS NOW CORRECTED, IN ORDER
//
// First, the Admin represented each provider as though it had exactly one
// model: the registry held one entry per SEAT and smuggled model identity into
// the display name ('Claude 3.7 Sonnet / Opus', 'Gemini 3.7 / 3.6 Flash'),
// with no modelId field anywhere. A provider structurally WAS one model.
//
// Second — and this was the first version of this file getting it wrong — the
// fix showed ZERO models for any provider without an execution adapter. That
// traded one untruth for another. A provider's model fleet is knowable whether
// or not SynthOS can call it, and "Anthropic: 0 models" is false in a way that
// "Anthropic: 4 models, 0 executable" is not.
//
// WHERE MODEL IDS COME FROM — NEVER INVENTION
//
//   PROVIDER_API       a live metadata call to the provider's own model-list
//                      endpoint. Metadata only; see lib/model-discovery.ts for
//                      the zero-inference guarantee.
//   DOCUMENTED_CATALOG official provider documentation and this project's own
//                      canonical model table (docs/synthos/CLAUDE.md). Used
//                      when no credential or no discovery endpoint is
//                      available — which is the Anthropic case today.
//
// THIS IS NOT A SECOND ROUTER
// The catalog answers "what exists and what is its state". lib/model-router.ts
// decides where a call goes, and is unchanged.
// ---------------------------------------------------------------------------

import {
  DEFAULT_OPENAI_MODEL,
  resolveDefaultOpenAiModel,
  classifyModelRequest,
  type ExecutableProvider,
} from './model-router';

export type CatalogProviderId =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'deepseek'
  | 'nousresearch'
  | 'perplexity'
  | 'openrouter'
  | 'ollama';

/** Where a catalog entry's identity came from. Never "we made it up". */
export type ModelSource = 'PROVIDER_API' | 'DOCUMENTED_CATALOG';

/** AXIS 1 — catalog lifecycle. What is known about the model's existence. */
export type CatalogLifecycle =
  /** Present in the provider's current catalog. */
  | 'DISCOVERED'
  /** Still listed, but the provider marks it superseded. */
  | 'DEPRECATED'
  /** Was in a previous refresh and is no longer listed. Kept, not deleted. */
  | 'REMOVED';

/** AXIS 2 — can SynthOS call it? A property of THIS codebase, not the vendor. */
export type ExecutionSupport =
  /** An adapter exists in this build and the router dispatches to it. */
  | 'SUPPORTED'
  /** No adapter. Nothing here can call this model, credential or not. */
  | 'EXECUTION_UNAVAILABLE';

/** AXIS 3 — may a task route to it right now? */
export type RoutingEligibility =
  /** Executable, credentialed, and the router accepts the id. */
  | 'ROUTABLE'
  /** Known, but not eligible — no adapter, no credential, or removed. */
  | 'NOT_ROUTABLE';

/**
 * Verification, kept as its own axis because a credential is not proof.
 * Mirrors the vocabulary in lib/provider-state.ts rather than duplicating it.
 */
export type VerificationState =
  | 'LIVE_VERIFIED'
  | 'CONFIGURED'
  | 'NOT_CONFIGURED'
  | 'UNKNOWN';

export interface CatalogProvider {
  providerId: CatalogProviderId;
  /** Vendor display name. The provider, never a model. */
  displayName: string;
  family: string;
  execution: ExecutionSupport;
  /** Router's provider token when an adapter exists. */
  routerProvider: ExecutableProvider | null;
  credentialEnvVar: string | null;
  /** True when the router accepts ids beyond those catalogued. */
  acceptsUncataloguedIds: boolean;
  /** Whether the provider exposes a model-list endpoint this build can call. */
  hasDiscoveryEndpoint: boolean;
  /** Why execution is unavailable. Empty when it is available. */
  adapterNote: string;
}

export interface CatalogModel {
  providerId: CatalogProviderId;
  /** The id a caller would pass. Addressable, not a label. */
  modelId: string;
  displayName: string;
  family: string;
  capabilityTags: string[];
  modalities: string[];
  lifecycle: CatalogLifecycle;
  source: ModelSource;
  /** Ids the provider treats as pointing at this model. */
  aliases: string[];
  /** The provider's default routed model, when this build routes to it. */
  isProviderDefault: boolean;
}

// ---------------------------------------------------------------------------
// PROVIDERS
// ---------------------------------------------------------------------------

export const CATALOG_PROVIDERS: readonly CatalogProvider[] = Object.freeze([
  {
    providerId: 'openai',
    displayName: 'OpenAI',
    family: 'OpenAI',
    execution: 'SUPPORTED',
    routerProvider: 'OPENAI',
    credentialEnvVar: 'OPENAI_API_KEY',
    acceptsUncataloguedIds: true,
    hasDiscoveryEndpoint: true,
    adapterNote: '',
  },
  {
    providerId: 'google',
    displayName: 'Google',
    family: 'Gemini',
    execution: 'SUPPORTED',
    routerProvider: 'GEMINI',
    credentialEnvVar: 'GEMINI_API_KEY',
    acceptsUncataloguedIds: false,
    hasDiscoveryEndpoint: true,
    adapterNote: '',
  },
  {
    providerId: 'anthropic',
    displayName: 'Anthropic',
    family: 'Claude',
    execution: 'EXECUTION_UNAVAILABLE',
    routerProvider: null,
    credentialEnvVar: 'ANTHROPIC_API_KEY',
    acceptsUncataloguedIds: false,
    // Anthropic does publish a model-list endpoint, but this build holds no
    // Anthropic credential, so it cannot be called. The catalog falls back to
    // documented metadata — which is why models are still listed.
    hasDiscoveryEndpoint: true,
    adapterNote:
      'No Anthropic execution adapter exists in this build, so no Claude model can be dispatched. '
      + 'The models below are catalogued from documented provider metadata, not from a live call, and '
      + 'none is routable.',
  },
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    family: 'DeepSeek',
    execution: 'EXECUTION_UNAVAILABLE',
    routerProvider: null,
    credentialEnvVar: 'DEEPSEEK_API_KEY',
    acceptsUncataloguedIds: false,
    hasDiscoveryEndpoint: true,
    adapterNote: 'No DeepSeek execution adapter exists in this build. Catalogued from documented metadata only.',
  },
  {
    providerId: 'nousresearch',
    displayName: 'Nous Research',
    family: 'Hermes',
    execution: 'EXECUTION_UNAVAILABLE',
    routerProvider: null,
    credentialEnvVar: null,
    acceptsUncataloguedIds: false,
    hasDiscoveryEndpoint: false,
    adapterNote:
      'The local Hermes runtime is disabled (HERMES_LOCAL_ENABLED=false) and broken upstream. '
      + 'Catalogued from documented metadata only.',
  },
  {
    providerId: 'ollama',
    displayName: 'Ollama (local)',
    family: 'Local',
    execution: 'EXECUTION_UNAVAILABLE',
    routerProvider: null,
    credentialEnvVar: null,
    acceptsUncataloguedIds: false,
    // Ollama exposes /api/tags locally, but no adapter here calls it.
    hasDiscoveryEndpoint: true,
    adapterNote: 'No Ollama adapter exists in this build. Catalogued from the project model table only.',
  },
  {
    providerId: 'perplexity',
    displayName: 'Perplexity',
    family: 'Sonar',
    execution: 'EXECUTION_UNAVAILABLE',
    routerProvider: null,
    credentialEnvVar: 'PERPLEXITY_API_KEY',
    acceptsUncataloguedIds: false,
    hasDiscoveryEndpoint: false,
    adapterNote:
      'No Perplexity execution adapter exists in this build, and no documented model list is held here, '
      + 'so the catalog is empty rather than guessed.',
  },
  {
    providerId: 'openrouter',
    displayName: 'OpenRouter',
    family: 'Aggregator',
    execution: 'EXECUTION_UNAVAILABLE',
    routerProvider: null,
    credentialEnvVar: 'OPENROUTER_API_KEY',
    acceptsUncataloguedIds: true,
    // OpenRouter's /api/v1/models is public, but no adapter here calls it and
    // its catalog is the union of other vendors' — listing it from static
    // metadata would be stale the day it was written.
    hasDiscoveryEndpoint: true,
    adapterNote:
      'No OpenRouter execution adapter exists in this build. Its catalog is an aggregate of other '
      + 'vendors and is not mirrored here from static metadata; it would need live discovery to be true.',
  },
]);

export function getCatalogProvider(providerId: string): CatalogProvider | undefined {
  return CATALOG_PROVIDERS.find((p) => p.providerId === providerId);
}

// ---------------------------------------------------------------------------
// DOCUMENTED CATALOG
//
// Used when a live model-list call is not possible. Every id below is taken
// from official provider metadata or this project's own canonical model table
// in docs/synthos/CLAUDE.md — the same table the cost tiers are derived from.
// Nothing here is guessed, and a provider with no documented list gets no
// entries rather than invented ones.
// ---------------------------------------------------------------------------

interface DocumentedModel {
  modelId: string;
  displayName: string;
  capabilityTags: string[];
  modalities?: string[];
  aliases?: string[];
  deprecated?: boolean;
}

const DOCUMENTED_MODELS: Partial<Record<CatalogProviderId, DocumentedModel[]>> = {
  anthropic: [
    {
      modelId: 'claude-opus-5',
      displayName: 'Claude Opus 5',
      capabilityTags: ['text', 'reasoning', 'frontier'],
    },
    {
      modelId: 'claude-sonnet-5',
      displayName: 'Claude Sonnet 5',
      capabilityTags: ['text', 'reasoning', 'default-worker'],
    },
    {
      modelId: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      capabilityTags: ['text', 'fast', 'bulk'],
      // The project table refers to this model by its undated alias.
      aliases: ['claude-haiku-4-5'],
    },
    {
      modelId: 'claude-fable-5-1',
      displayName: 'Claude Fable 5.1',
      capabilityTags: ['text', 'reasoning', 'gated'],
      aliases: ['claude-fable-5'],
    },
  ],
  deepseek: [
    {
      modelId: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      capabilityTags: ['text', 'bulk'],
    },
  ],
  nousresearch: [
    {
      modelId: 'hermes3:8b',
      displayName: 'Hermes 3 (8B)',
      capabilityTags: ['text', 'local', 'open-weights'],
    },
  ],
  ollama: [
    {
      modelId: 'qwen2.5-coder:14b',
      displayName: 'Qwen 2.5 Coder (14B)',
      capabilityTags: ['text', 'code', 'local'],
    },
    {
      modelId: 'hermes3:8b',
      displayName: 'Hermes 3 (8B)',
      capabilityTags: ['text', 'local'],
    },
  ],
};

/** Gemini ids the router itself recognises — the authority for this provider. */
const DOCUMENTED_GEMINI: DocumentedModel[] = [
  { modelId: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', capabilityTags: ['text', 'fast'] },
  { modelId: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', capabilityTags: ['text', 'fast'] },
  { modelId: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (preview)', capabilityTags: ['text', 'reasoning', 'preview'] },
];

function toCatalogModel(
  providerId: CatalogProviderId,
  doc: DocumentedModel,
  source: ModelSource,
  defaultModelId: string | null,
): CatalogModel {
  const provider = getCatalogProvider(providerId);
  return {
    providerId,
    modelId: doc.modelId,
    displayName: doc.displayName,
    family: provider?.family ?? providerId,
    capabilityTags: doc.capabilityTags,
    modalities: doc.modalities ?? ['text'],
    lifecycle: doc.deprecated ? 'DEPRECATED' : 'DISCOVERED',
    source,
    aliases: doc.aliases ?? [],
    // A default only means anything for a provider this build can route to.
    isProviderDefault: provider?.execution === 'SUPPORTED' && doc.modelId === defaultModelId,
  };
}

/**
 * The documented catalog for one provider. This is the fallback when live
 * discovery is unavailable, and the baseline the discovery diff compares to.
 */
export function documentedModelsForProvider(providerId: CatalogProviderId): CatalogModel[] {
  if (providerId === 'google') {
    return DOCUMENTED_GEMINI.map((d) => toCatalogModel('google', d, 'DOCUMENTED_CATALOG', 'gemini-3.1-flash-lite'));
  }
  if (providerId === 'openai') {
    const configured = resolveDefaultOpenAiModel();
    const docs: DocumentedModel[] = [{
      modelId: configured,
      displayName: configured,
      capabilityTags: ['text', 'default'],
    }];
    if (configured !== DEFAULT_OPENAI_MODEL) {
      docs.push({
        modelId: DEFAULT_OPENAI_MODEL,
        displayName: `${DEFAULT_OPENAI_MODEL} (built-in fallback)`,
        capabilityTags: ['text', 'fallback'],
      });
    }
    return docs.map((d) => toCatalogModel('openai', d, 'DOCUMENTED_CATALOG', configured));
  }
  const docs = DOCUMENTED_MODELS[providerId] ?? [];
  return docs.map((d) => toCatalogModel(providerId, d, 'DOCUMENTED_CATALOG', null));
}

/** The whole documented catalog, across providers. */
export function documentedCatalog(): CatalogModel[] {
  return CATALOG_PROVIDERS.flatMap((p) => documentedModelsForProvider(p.providerId));
}

/** Backwards-compatible alias used by existing callers. */
export function modelsForProvider(providerId: CatalogProviderId): CatalogModel[] {
  return documentedModelsForProvider(providerId);
}

export function catalogModels(): CatalogModel[] {
  return documentedCatalog();
}

/** The provider's default routed model id, or null when it has none. */
export function defaultModelForProvider(providerId: CatalogProviderId): string | null {
  return documentedModelsForProvider(providerId).find((m) => m.isProviderDefault)?.modelId ?? null;
}

// ---------------------------------------------------------------------------
// RESOLVING THE THREE AXES
// ---------------------------------------------------------------------------

export interface ModelStateEvidence {
  /** Does a credential resolve for this provider right now? */
  credentialPresent: boolean;
  /** Has a real call to this provider succeeded? */
  liveVerified: boolean;
}

export interface ResolvedModelState {
  lifecycle: CatalogLifecycle;
  execution: ExecutionSupport;
  routing: RoutingEligibility;
  verification: VerificationState;
}

/**
 * Resolve all three axes plus verification for one model.
 *
 * Execution is a property of this codebase and outranks every credential: a
 * key cannot make a provider callable when nothing here calls it. Routing
 * additionally requires a credential and a router that accepts the id.
 * Verification stays separate because a credential is never proof.
 */
export function resolveModelState(
  model: CatalogModel,
  evidence: ModelStateEvidence,
): ResolvedModelState {
  const provider = getCatalogProvider(model.providerId);
  const execution: ExecutionSupport = provider?.execution ?? 'EXECUTION_UNAVAILABLE';

  const verification: VerificationState = execution !== 'SUPPORTED'
    // Nothing here can call it, so there is nothing to verify — not "failed".
    ? 'UNKNOWN'
    : evidence.liveVerified
      ? 'LIVE_VERIFIED'
      : evidence.credentialPresent
        ? 'CONFIGURED'
        : 'NOT_CONFIGURED';

  const routable = execution === 'SUPPORTED'
    && evidence.credentialPresent
    && model.lifecycle !== 'REMOVED'
    && catalogAgreesWithRouter(model);

  return {
    lifecycle: model.lifecycle,
    execution,
    routing: routable ? 'ROUTABLE' : 'NOT_ROUTABLE',
    verification,
  };
}

/** Usable means a real call has succeeded. Nothing weaker counts. */
export function isModelUsable(state: ResolvedModelState): boolean {
  return state.verification === 'LIVE_VERIFIED' && state.execution === 'SUPPORTED';
}

/**
 * Does the router actually send this model id to the provider the catalog
 * claims? Guards against catalog/router drift, which is the risk a separate
 * catalog introduces if nothing checks it. Vacuously true for providers with
 * no adapter, since the router has no opinion about them.
 */
export function catalogAgreesWithRouter(model: CatalogModel): boolean {
  const provider = getCatalogProvider(model.providerId);
  if (!provider || provider.execution !== 'SUPPORTED') return true;
  return classifyModelRequest(model.modelId).provider === provider.routerProvider;
}

// ---------------------------------------------------------------------------
// SEATS
//
// A seat is an Admin tab / agent slot. It is not a model and not quite a
// provider — several seats share one provider. Kept separate so a seat can
// select any model its provider exposes rather than being welded to one
// version, which is how the stale label survived.
// ---------------------------------------------------------------------------

const SEAT_PROVIDER: Record<string, CatalogProviderId> = {
  chatgpt: 'openai',
  codex: 'openai',
  gemini: 'google',
  antigravity: 'google',
  claude: 'anthropic',
  claudecode: 'anthropic',
  deepseek: 'deepseek',
  hermes: 'nousresearch',
  perplexity: 'perplexity',
};

export function providerForSeat(seatId: string): CatalogProvider | null {
  const providerId = SEAT_PROVIDER[seatId.toLowerCase()];
  return providerId ? getCatalogProvider(providerId) ?? null : null;
}

export function modelsForSeat(seatId: string): CatalogModel[] {
  const provider = providerForSeat(seatId);
  return provider ? documentedModelsForProvider(provider.providerId) : [];
}
