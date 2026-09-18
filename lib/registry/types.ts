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

export type ManifestSource = 'PLUGIN' | 'SIGNED_IMPORT' | 'ADMIN' | 'DISCOVERY';

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
}
