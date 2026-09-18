// ---------------------------------------------------------------------------
// PROVIDER & MODEL REGISTRY — types.
//
// The registry is the ONE local authority for which providers and models
// exist, what they can do, what they cost and whether they may run. It is
// populated only from versioned manifests (data), never from UI constants,
// never by polling a provider, never by asking a model. See ./index.ts.
// ---------------------------------------------------------------------------

export const REGISTRY_SCHEMA_VERSION = 'synthos.registry/v1';

/** Wire protocols this build can speak. A provider manifest names one; the adapter is shared. */
export type ProtocolId = 'openai.responses' | 'openai.chat_completions' | 'gemini.generate_content' | 'gemini.interactions' | 'anthropic.messages';

export type AuthType = 'BEARER' | 'API_KEY_HEADER' | 'NONE';

export type ManifestSource = 'PLUGIN' | 'SIGNED_IMPORT' | 'ADMIN' | 'DISCOVERY' | 'ROUTE_IMPORT';

/**
 * How a provider route reaches a model. The same canonical model version may
 * be offered by several routes (the publisher directly, an aggregator, a
 * local runtime, a private endpoint) — they are never different models.
 */
export type RouteKind = 'DIRECT' | 'AGGREGATOR' | 'LOCAL' | 'ENTERPRISE';

/** Privacy classes, weakest to strongest. A route never downgrades below what a task requires. */
export const PRIVACY_CLASSES = ['STANDARD', 'NO_TRAINING', 'ZERO_RETENTION', 'LOCAL_ONLY'] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

/** One concrete place a route executes: endpoint, region, account binding, limits, policy boundary. */
export interface DeploymentSpec {
  deploymentId: string;
  region: string | null;
  /** Env var overriding this deployment's base URL (validated by ./endpoints.ts). Null → the provider's. */
  baseUrlEnvVar: string | null;
  /** Credential binding. Null → the provider's auth. */
  credentialSlot: string | null;
  envVars: string[];
  rateLimits: { requestsPerMinute: number | null; tokensPerMinute: number | null; tokensPerDay: number | null };
  privacyClass: PrivacyClass;
  dataRetention: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

/** Where a capability claim came from and how far it has been checked. */
export type CapabilityVerification = 'DOCUMENTED' | 'PUBLISHER_ASSERTED' | 'ADMIN_ASSERTED' | 'VERIFIED' | 'UNVERIFIED';

export interface CapabilityRecord {
  /** Normalized id (see KNOWN_CAPABILITIES) or a namespaced extension `x.<provider>.<name>`. */
  id: string;
  supported: boolean;
  /** Free-form, capability-specific detail (e.g. a limit). Retained verbatim. */
  detail?: Record<string, unknown> | null;
  source: string;
  verification: CapabilityVerification;
  effectiveDate: string | null;
  // Stamped by the store on import — never trusted from the manifest body.
  provenance?: ManifestSource;
  manifestVersion?: string;
  adapterVersion?: string;
  lastUpdated?: string;
}

export interface PriceRates {
  /** USD (or `currency`) per million units. */
  input: number;
  output: number;
  cachedInput: number | null;
}

export interface PricingRecord {
  currency: string;
  unit: 'tokens' | 'chars';
  rates: PriceRates;
  /** How reasoning tokens are billed. UNKNOWN blocks estimation of reasoning models. */
  reasoningTokens: 'BILLED_AS_OUTPUT' | 'NOT_BILLED' | 'NOT_APPLICABLE' | 'UNKNOWN';
  /** Above a prompt-size threshold, different rates. */
  tiers: Array<{ thresholdTokens: number; rates: PriceRates }>;
  toolCharges: Array<{ tool: string; unit: string; usd: number }>;
  modalityCharges: Array<{ modality: string; unit: string; usd: number }>;
  effectiveFrom: string;
  effectiveUntil: string | null;
  source: string;
  /** When the source was last confirmed. */
  verifiedAt: string;
  /** After this instant the price is STALE and blocks paid execution. */
  staleAfter: string;
  approval: 'APPROVED' | 'UNREVIEWED';
}

export type ModelLifecycle = 'ACTIVE' | 'PREVIEW' | 'DEPRECATED' | 'REMOVED';

export interface ModelManifest {
  modelId: string;
  aliases: string[];
  displayName: string;
  lifecycle: ModelLifecycle;
  releaseDate: string | null;
  deprecationDate: string | null;
  shutdownDate: string | null;
  limits: { contextTokens: number | null; outputTokens: number | null };
  modalities: { input: string[]; output: string[] };
  capabilities: CapabilityRecord[];
  supportedParameters: string[];
  outputContracts: Array<'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT'>;
  pricing: PricingRecord[];
  adapterCompatibility: { protocol: ProtocolId; minAdapterVersion: string };
  restrictions: { regions: string[]; compliance: string[] };
  /** Unknown top-level provider metadata, retained rather than discarded. */
  extensions?: Record<string, unknown>;
  /**
   * IDENTITY — the model family and the immutable canonical version this route
   * offering serves. A DIRECT route whose provider is the family's publisher is
   * authoritative; any other route only PROPOSES a mapping, which needs an
   * audited approval before it is trusted. Absent → the publisher-issued id.
   */
  family?: { familyId: string; displayName: string; publisher: string } | null;
  canonicalVersionId?: string | null;
  /** Free access, and whether it is contractually guaranteed. Free is volatile unless guaranteed. */
  freeTier?: { free: boolean; guaranteed: boolean } | null;
}

export interface ProviderManifestBody {
  providerId: string;
  displayName: string;
  protocol: ProtocolId;
  adapterVersion: string;
  approvedHosts: string[];
  defaultBaseUrl: string;
  /** Env var that may override the base URL. Validated by ./endpoints.ts. */
  baseUrlEnvVar: string | null;
  auth: { type: AuthType; credentialSlot: string | null; envVars: string[] };
  /** Whether a paid call to this provider is priced per token/char. */
  billing: 'METERED' | 'MANAGED_AGENT' | 'FREE_LOCAL';
  restrictions: { regions: string[]; compliance: string[] };
  /** Defaults to DIRECT. */
  routeKind?: RouteKind;
  /** Concrete deployments. Absent → one 'default' deployment from the provider fields. */
  deployments?: DeploymentSpec[];
  /** Provider-supported request idempotency (a header carrying SynthOS's key). */
  idempotency?: { header: string } | null;
  /** Provider-supported lookup of a request's outcome by that key: path template with {key}. */
  reconciliation?: { lookupPath: string } | null;
  /** Default privacy class for deployments that do not state one. */
  privacyClass?: PrivacyClass;
}

export interface ManifestSignature {
  algorithm: 'ed25519';
  keyId: string;
  /** base64 signature over canonicalManifestJson(manifest without `signature`). */
  value: string;
}

export interface RegistryManifest {
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  manifestVersion: string;
  provenance: { publisher: string; generatedAt: string; notes?: string };
  provider: ProviderManifestBody;
  models: ModelManifest[];
  signature?: ManifestSignature;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Operator decisions, stored. Never inferred. */
export type AdminState = 'INSTALLED' | 'QUALIFIED' | 'ENABLED' | 'DISABLED';

/** Computed availability. The first failing condition wins; every failure is listed. */
export type AvailabilityState =
  | 'AVAILABLE'
  | 'UNQUALIFIED'
  | 'METADATA_REQUIRED'
  | 'PRICING_REQUIRED'
  | 'PRICE_STALE'
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'DEGRADED'
  | 'POLICY_BLOCKED'
  | 'DEPRECATED'
  | 'REMOVED'
  | 'UNSUPPORTED_BY_ADAPTER'
  | 'QUALIFIED'
  | 'ENABLED'
  | 'INSTALLED';

export const ALL_STATES: AvailabilityState[] = [
  'INSTALLED', 'UNQUALIFIED', 'METADATA_REQUIRED', 'PRICING_REQUIRED', 'QUALIFIED', 'ENABLED', 'AVAILABLE',
  'NOT_CONFIGURED', 'DISABLED', 'DEGRADED', 'PRICE_STALE', 'POLICY_BLOCKED', 'DEPRECATED', 'REMOVED', 'UNSUPPORTED_BY_ADAPTER',
];

export interface Blocker { state: AvailabilityState; reason: string }

export interface ExecutionContextConstraints {
  workspaceId?: string | null;
  /** The task's output contract mode — the model must support it. */
  outputContract?: 'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT';
  /** Normalized capability ids the task needs. */
  requiredCapabilities?: string[];
  /**
   * The dispatch path already holds the credential it is about to send, so the
   * spend guard's gate does not re-derive credential presence. Every other
   * check (endpoint included) still applies.
   */
  credentialHeld?: boolean;
}

export interface ModelView {
  providerId: string;
  providerDisplayName: string;
  modelId: string;
  displayName: string;
  aliases: string[];
  lifecycle: ModelLifecycle;
  releaseDate: string | null;
  deprecationDate: string | null;
  shutdownDate: string | null;
  limits: ModelManifest['limits'];
  modalities: ModelManifest['modalities'];
  capabilities: CapabilityRecord[];
  outputContracts: ModelManifest['outputContracts'];
  protocol: ProtocolId;
  source: ManifestSource;
  manifestVersion: string;
  recordHash: string;
  adminState: AdminState;
  availability: AvailabilityState;
  executable: boolean;
  blockers: Blocker[];
  pricing: {
    state: 'CURRENT' | 'STALE' | 'MISSING' | 'CONFLICTING' | 'NOT_APPROVED';
    current: PricingRecord | null;
    versionKey: string | null;
  };
  paid: boolean;
  /** How this offering is reached, and whether it is free (volatile unless guaranteed). */
  routeKind: RouteKind;
  freeTier: { free: boolean; guaranteed: boolean } | null;
}
