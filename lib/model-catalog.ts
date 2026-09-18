// ---------------------------------------------------------------------------
// CANONICAL MODEL CATALOG.
//
// THE DEFECT THIS EXISTS TO FIX
// The Admin represented every provider as though it had exactly one model.
// src/data/mockData.ts held one entry per *seat* — `claude`, `chatgpt`,
// `gemini` — and smuggled model identity into the display name:
//
//     name: 'Claude 3.7 Sonnet / Opus'
//     name: 'Gemini 3.7 / 3.6 Flash'
//     name: 'ChatGPT o3 / GPT-4.5'
//
// There was no `modelId` field at all. So "Claude" WAS "Claude 3.7 Sonnet",
// structurally, and the only way to update a model was to edit a label. That
// is why the Admin still showed a stale Claude version long after it meant
// anything.
//
// PROVIDER AND MODEL ARE SEPARATE CONCEPTS HERE
// A provider is a vendor plus an execution mapping. A model is an addressable
// id belonging to a provider. One provider may expose many models, and the
// model the router currently defaults to is a *selection*, not the provider's
// whole surface.
//
// WHERE THE DATA COMES FROM — AND WHERE IT DOES NOT
// Every model id below is sourced from lib/model-router.ts, which is the
// routing authority and the only thing in this build that knows what can
// actually be dispatched. Nothing here is invented:
//
//   * Gemini ids are the three `normalizeGeminiModel()` recognises.
//   * OpenAI's default comes from `resolveDefaultOpenAiModel()`. The router is
//     deliberately PREFIX-based for OpenAI (`gpt-*`, `o1`-`o9`) rather than an
//     allowlist, because OpenAI retires snapshots faster than this file can be
//     edited. So this catalog does not pretend to enumerate OpenAI's line-up —
//     it lists the configured default and records that the prefix rule admits
//     others. Listing invented snapshot names would be the original bug again.
//   * Providers with no execution mapping come from the router's own
//     RECOGNIZED_UNCONFIGURED_PROVIDERS list, and are marked UNAVAILABLE.
//
// THIS IS NOT A SECOND ROUTER
// The catalog answers "what models exist and what is their real state". It
// never decides where a call goes; lib/model-router.ts does that, unchanged.
// ---------------------------------------------------------------------------

import {
  DEFAULT_OPENAI_MODEL,
  resolveDefaultOpenAiModel,
  classifyModelRequest,
  type ExecutableProvider,
} from './model-router';

/** Stable provider keys. Not display strings — those change. */
export type CatalogProviderId =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'deepseek'
  | 'nousresearch'
  | 'perplexity';

/**
 * Whether this build can dispatch to a provider at all.
 *
 * `EXECUTABLE` means lib/model-router.ts has a real mapping (today: OpenAI and
 * Gemini). `RECOGNIZED` means the router knows the name well enough to refuse
 * precisely, but there is no execution mapping. Registry presence is never
 * execution proof, which is the distinction the old single-entry shape lost.
 */
export type ProviderExecution = 'EXECUTABLE' | 'RECOGNIZED';

/**
 * Truthful availability for one model.
 *
 * Extends the vocabulary already in lib/provider-state.ts rather than
 * introducing a parallel one — a second status vocabulary for the same
 * question is how two surfaces start disagreeing. Provider-level truth still
 * comes from resolveProviderState(); these add the model-level cases that a
 * provider state cannot express.
 */
export type ModelAvailability =
  /** A real call to this provider succeeded. The only "usable" reading. */
  | 'LIVE_VERIFIED'
  /** Provider is executable and a credential resolves. Not yet proven. */
  | 'CONFIGURED'
  /** Provider is executable but no credential resolves. */
  | 'NOT_CONFIGURED'
  /** No execution mapping in this build. Cannot be dispatched at all. */
  | 'UNAVAILABLE'
  /** Superseded upstream; kept so a stale reference is labelled, not silent. */
  | 'DEPRECATED'
  /** Catalogued, but this build cannot determine its state. */
  | 'UNKNOWN';

export interface CatalogProvider {
  providerId: CatalogProviderId;
  /** Vendor display name. The provider, never a model. */
  displayName: string;
  /** Vendor family, for grouping seats and models. */
  family: string;
  execution: ProviderExecution;
  /** Router's provider token, when this provider is executable. */
  routerProvider: ExecutableProvider | null;
  /** Env var carrying the credential, when one applies. */
  credentialEnvVar: string | null;
  /**
   * True when the router accepts ids beyond those catalogued, so the UI can
   * say "and others" instead of implying the list is exhaustive.
   */
  acceptsUncataloguedIds: boolean;
  /** Why a provider is not executable. Empty when it is. */
  note: string;
}

export interface CatalogModel {
  providerId: CatalogProviderId;
  /** The id a caller passes to the router. Addressable, not a label. */
  modelId: string;
  displayName: string;
  family: string;
  capabilityTags: string[];
  modalities: string[];
  /** The provider's default routed model. A selection, not its only model. */
  isProviderDefault: boolean;
  deprecated: boolean;
}

// ---------------------------------------------------------------------------
// PROVIDERS
// ---------------------------------------------------------------------------

export const CATALOG_PROVIDERS: readonly CatalogProvider[] = Object.freeze([
  {
    providerId: 'openai',
    displayName: 'OpenAI',
    family: 'OpenAI',
    execution: 'EXECUTABLE',
    routerProvider: 'OPENAI',
    credentialEnvVar: 'OPENAI_API_KEY',
    // The router admits any `gpt-*` or `o1`-`o9` id on purpose.
    acceptsUncataloguedIds: true,
    note: '',
  },
  {
    providerId: 'google',
    displayName: 'Google',
    family: 'Gemini',
    execution: 'EXECUTABLE',
    routerProvider: 'GEMINI',
    credentialEnvVar: 'GEMINI_API_KEY',
    acceptsUncataloguedIds: false,
    note: '',
  },
  {
    providerId: 'anthropic',
    displayName: 'Anthropic',
    family: 'Claude',
    execution: 'RECOGNIZED',
    routerProvider: null,
    credentialEnvVar: null,
    acceptsUncataloguedIds: false,
    note: 'Recognized by the router so a request can be refused by name. No execution mapping exists in this build, so no Claude model can be dispatched.',
  },
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    family: 'DeepSeek',
    execution: 'RECOGNIZED',
    routerProvider: null,
    credentialEnvVar: null,
    acceptsUncataloguedIds: false,
    note: 'Recognized by the router. No execution mapping in this build.',
  },
  {
    providerId: 'nousresearch',
    displayName: 'Nous Research',
    family: 'Hermes',
    execution: 'RECOGNIZED',
    routerProvider: null,
    credentialEnvVar: null,
    acceptsUncataloguedIds: false,
    note: 'Local Hermes runtime is disabled (HERMES_LOCAL_ENABLED=false) and broken upstream. No model can be dispatched.',
  },
  {
    providerId: 'perplexity',
    displayName: 'Perplexity',
    family: 'Sonar',
    execution: 'RECOGNIZED',
    routerProvider: null,
    credentialEnvVar: null,
    acceptsUncataloguedIds: false,
    note: 'Recognized by the router. No execution mapping in this build.',
  },
]);

// ---------------------------------------------------------------------------
// MODELS
//
// Only ids this build can actually name truthfully. A provider with no
// execution mapping gets NO model entries rather than invented ones: listing
// "Claude 3.7 Sonnet" here would recreate the exact defect this module exists
// to remove, because nothing in this build can dispatch it.
// ---------------------------------------------------------------------------

const GEMINI_MODELS: readonly CatalogModel[] = Object.freeze([
  {
    providerId: 'google',
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    family: 'Gemini',
    capabilityTags: ['text', 'fast', 'default'],
    modalities: ['text'],
    isProviderDefault: true,
    deprecated: false,
  },
  {
    providerId: 'google',
    modelId: 'gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash',
    family: 'Gemini',
    capabilityTags: ['text', 'fast'],
    modalities: ['text'],
    isProviderDefault: false,
    deprecated: false,
  },
  {
    providerId: 'google',
    modelId: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro (preview)',
    family: 'Gemini',
    capabilityTags: ['text', 'reasoning', 'preview'],
    modalities: ['text'],
    isProviderDefault: false,
    deprecated: false,
  },
]);

/**
 * OpenAI's configured default, read at call time rather than frozen, because
 * OPENAI_MODEL may override it. Built as a function so the catalog reflects
 * configuration instead of a literal captured at import.
 */
function openAiModels(): CatalogModel[] {
  const configured = resolveDefaultOpenAiModel();
  const models: CatalogModel[] = [{
    providerId: 'openai',
    modelId: configured,
    displayName: configured,
    family: 'OpenAI',
    capabilityTags: ['text', 'default'],
    modalities: ['text'],
    isProviderDefault: true,
    deprecated: false,
  }];
  // When OPENAI_MODEL overrides the fallback, both are real and worth showing:
  // the operator's selection, and the built-in fallback it replaced.
  if (configured !== DEFAULT_OPENAI_MODEL) {
    models.push({
      providerId: 'openai',
      modelId: DEFAULT_OPENAI_MODEL,
      displayName: `${DEFAULT_OPENAI_MODEL} (built-in fallback)`,
      family: 'OpenAI',
      capabilityTags: ['text', 'fallback'],
      modalities: ['text'],
      isProviderDefault: false,
      deprecated: false,
    });
  }
  return models;
}

/** Every catalogued model, across providers. */
export function catalogModels(): CatalogModel[] {
  return [...openAiModels(), ...GEMINI_MODELS];
}

/** Models belonging to one provider. Empty is a truthful answer. */
export function modelsForProvider(providerId: CatalogProviderId): CatalogModel[] {
  return catalogModels().filter((m) => m.providerId === providerId);
}

export function getCatalogProvider(providerId: string): CatalogProvider | undefined {
  return CATALOG_PROVIDERS.find((p) => p.providerId === providerId);
}

/** The provider's default routed model id, or null when it has none. */
export function defaultModelForProvider(providerId: CatalogProviderId): string | null {
  return modelsForProvider(providerId).find((m) => m.isProviderDefault)?.modelId ?? null;
}

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------

export interface AvailabilityEvidence {
  /** True when a credential resolves for this provider. */
  credentialPresent: boolean;
  /** True when a real call to this provider has succeeded. */
  liveVerified: boolean;
}

/**
 * Resolve one model's availability from real evidence.
 *
 * Deliberately takes evidence as an argument rather than reading the database
 * itself: this keeps the catalog a pure module, and keeps the provider ledger
 * (lib/provider-state.ts) the single place that decides what "verified" means.
 */
export function resolveModelAvailability(
  model: CatalogModel,
  evidence: AvailabilityEvidence,
): ModelAvailability {
  if (model.deprecated) return 'DEPRECATED';
  const provider = getCatalogProvider(model.providerId);
  if (!provider) return 'UNKNOWN';
  // No execution mapping outranks every other signal: a credential cannot make
  // a provider dispatchable when nothing in this build calls it.
  if (provider.execution !== 'EXECUTABLE') return 'UNAVAILABLE';
  if (evidence.liveVerified) return 'LIVE_VERIFIED';
  if (evidence.credentialPresent) return 'CONFIGURED';
  return 'NOT_CONFIGURED';
}

/** Availability may be read as usable only when a real call has succeeded. */
export function isModelUsable(availability: ModelAvailability): boolean {
  return availability === 'LIVE_VERIFIED';
}

/**
 * Does the router actually send this model id to the provider the catalog
 * claims? Guards against the catalog and the router drifting apart, which is
 * the failure mode a separate catalog introduces if nothing checks it.
 */
export function catalogAgreesWithRouter(model: CatalogModel): boolean {
  const provider = getCatalogProvider(model.providerId);
  if (!provider || provider.execution !== 'EXECUTABLE') return true;
  const classification = classifyModelRequest(model.modelId);
  return classification.provider === provider.routerProvider;
}

// ---------------------------------------------------------------------------
// SEATS
//
// A seat is an Admin tab / agent slot — `claude`, `chatgpt`, `gemini`,
// `hermes`. It is NOT a model, and it is not quite a provider either: several
// seats can belong to one provider (`claude` and `claudecode` are both
// Anthropic; `chatgpt` and `codex` are both OpenAI).
//
// Kept deliberately separate so a seat can later select any model its provider
// exposes, rather than being welded to one version the way the old registry
// welded `claude` to "Claude 3.7 Sonnet". Nothing here hardwires a seat to a
// model id.
// ---------------------------------------------------------------------------

/** Seat id (as used by the Admin registry) to the provider it belongs to. */
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

/** The provider a seat belongs to, or null for a seat with no provider. */
export function providerForSeat(seatId: string): CatalogProvider | null {
  const providerId = SEAT_PROVIDER[seatId.toLowerCase()];
  return providerId ? getCatalogProvider(providerId) ?? null : null;
}

/** Models a seat may select, which is its provider's catalogued models. */
export function modelsForSeat(seatId: string): CatalogModel[] {
  const provider = providerForSeat(seatId);
  return provider ? modelsForProvider(provider.providerId) : [];
}
