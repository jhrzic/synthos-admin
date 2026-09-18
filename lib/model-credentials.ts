// ---------------------------------------------------------------------------
// MODEL PROVIDER CREDENTIALS — encrypted, server-side, never in the browser.
//
// WHY THIS EXISTS
//
// Conversational phrasing needs a model key. Until now the only way to supply
// one was an environment variable, which for this deployment means editing a
// .env file and rebuilding a container. That is engineering intervention for a
// configuration change, and it is the same problem the voice credential store
// already solved for Fish Audio — so this mirrors that module rather than
// inventing a second approach.
//
// WHAT IT DELIBERATELY DOES NOT CHANGE
//
// Nothing about provider selection, model mapping, the circuit breaker, or the
// grounding rules. It only answers "is there a key, and what is it" for the
// existing router. Precedence is: environment first, then this store — so an
// operator who sets a real environment variable is never silently overridden
// by something typed into a browser form.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';
import { encryptVoiceSecret, decryptVoiceSecret } from './voice-credentials';
import { scrubSecrets } from './redact';

/** Providers this build can actually execute. Not a wish list. */
export const SUPPORTED_MODEL_PROVIDERS = ['gemini', 'openai'] as const;
export type ModelProvider = (typeof SUPPORTED_MODEL_PROVIDERS)[number];

export function isModelProvider(v: unknown): v is ModelProvider {
  return typeof v === 'string' && (SUPPORTED_MODEL_PROVIDERS as readonly string[]).includes(v);
}

/** The environment variable each provider reads, so precedence is inspectable. */
const PROVIDER_ENV_VAR: Record<ModelProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export type ModelKeySource = 'environment' | 'server_store' | 'none';

/**
 * PUSH 2B — the safe, provider-parameterized state an operator surface may
 * see. Deliberately a small closed vocabulary rather than the raw source:
 * it answers "can this provider run, and where did the key come from" and
 * nothing else. A secret VALUE is never part of any of these shapes.
 *
 *   ENVIRONMENT     — a real deployment environment variable supplies it.
 *                     It cannot be replaced or deleted through the API,
 *                     because environment precedence is the canonical rule.
 *   STORED          — an encrypted server-side row supplies it.
 *   NOT_CONFIGURED  — neither exists; the provider genuinely cannot run.
 */
export type ProviderCredentialState = 'ENVIRONMENT' | 'STORED' | 'NOT_CONFIGURED';

export interface ProviderCredentialStatus {
  provider: ModelProvider;
  /** The single word an operator surface should render. */
  state: ProviderCredentialState;
  /** True when a key resolves from either source — i.e. the provider can actually be called. */
  configured: boolean;
  envVar: string;
  /** Whether an encrypted row exists at all, independent of whether it is the one in use. */
  storedRowPresent: boolean;
  /**
   * True when an environment variable is winning over a stored row. Surfaced
   * because an operator who saves a key and sees no change deserves to be
   * told why, rather than concluding the save failed.
   */
  overriddenByEnvironment: boolean;
  updatedAt: string | null;
}

export interface ModelCredentialStatus {
  provider: ModelProvider;
  apiKeyPresent: boolean;
  source: ModelKeySource;
  envVar: string;
  updatedAt: string | null;
}

interface Row {
  provider: string;
  api_key_encrypted: string | null;
  updated_at: string | null;
}

function readRow(provider: ModelProvider | RuntimeCredentialSlot): Row | undefined {
  // A credential lookup must never be the thing that takes a request down.
  // This is now called from the execution kernel, where an unreachable or
  // not-yet-migrated database would otherwise turn "no key stored" into a
  // 500. Absent is reported as absent; the environment is still consulted
  // by the caller either way.
  try {
    return getDatabase()
      .prepare('SELECT provider, api_key_encrypted, updated_at FROM model_credentials WHERE provider = ?')
      .get(provider) as Row | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the usable key for a provider.
 *
 * ENVIRONMENT WINS. A key deliberately placed in the deployment environment is
 * a stronger statement of intent than one typed into a form, and an operator
 * debugging a provider must be able to trust that the variable they set is the
 * one in use.
 */
export function resolveModelApiKey(provider: ModelProvider): { apiKey: string; source: ModelKeySource } {
  const envKey = (process.env[PROVIDER_ENV_VAR[provider]] || '').trim();
  if (envKey) return { apiKey: envKey, source: 'environment' };

  const row = readRow(provider);
  if (row?.api_key_encrypted) {
    try {
      const apiKey = decryptVoiceSecret(row.api_key_encrypted).trim();
      if (apiKey) return { apiKey, source: 'server_store' };
    } catch {
      // A key that cannot be decrypted is not a key. Reported as absent rather
      // than crashing a customer conversation — and the status call below
      // still shows a row exists, so the mismatch is visible to the operator.
    }
  }
  return { apiKey: '', source: 'none' };
}

/** PRESENT/MISSING and provenance only. The value is never returned. */
export function getModelCredentialStatus(provider: ModelProvider): ModelCredentialStatus {
  const resolved = resolveModelApiKey(provider);
  const row = readRow(provider);
  return {
    provider,
    apiKeyPresent: Boolean(resolved.apiKey),
    source: resolved.source,
    envVar: PROVIDER_ENV_VAR[provider],
    updatedAt: row?.updated_at ?? null,
  };
}

export function saveModelCredential(params: {
  provider: ModelProvider; apiKey: string; userId: string;
}): ModelCredentialStatus {
  const apiKey = String(params.apiKey || '').trim();
  if (!apiKey) throw new Error('An API key is required.');
  if (apiKey.length > 500) throw new Error('That does not look like an API key.');

  const now = new Date().toISOString();
  const encrypted = encryptVoiceSecret(apiKey);
  getDatabase().prepare(`
    INSERT INTO model_credentials (provider, api_key_encrypted, updated_by_user_id, created_at, updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET
      api_key_encrypted = excluded.api_key_encrypted,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at
  `).run(params.provider, encrypted, params.userId, now, now);
  return getModelCredentialStatus(params.provider);
}

export function deleteModelCredential(provider: ModelProvider): void {
  getDatabase().prepare('DELETE FROM model_credentials WHERE provider = ?').run(provider);
}

/**
 * A real call proving the stored key works, before a customer ever meets it.
 *
 * It is a paid model call, so it goes through the canonical router like any
 * other: restricted to this provider, on a route QUALIFIED for
 * literal_transformation (credential.verify.* in the task-class data), then
 * Guardian and the spend guard. There is no default "verification model":
 * with nothing qualified on this provider the answer is that it cannot be
 * verified by a model call yet — never a guess. Returns the observed model,
 * never the key.
 */
export async function verifyModelCredential(provider: ModelProvider): Promise<
  { ok: true; model: string; sample: string } | { ok: false; error: string }
> {
  const { apiKey } = resolveModelApiKey(provider);
  // Not an attempt: nothing was sent, so recording a provider failure here
  // would blame the provider for a missing key.
  if (!apiKey) return { ok: false, error: 'No API key is configured for this provider.' };
  const { routedModelCall } = await import('./fabric/routed-call');
  const { requestKey } = await import('./spend/adapters');
  const r = await routedModelCall({
    callSite: `credential.verify.${provider}`, workspaceId: null, prompt: 'Reply with exactly: ready', maxOutputTokens: 16,
    routing: { permittedProviders: [provider] }, idempotencyKey: requestKey(`credential.verify.${provider}`),
  });
  if (!r.ok) {
    // Provider errors can echo a key back; the shared scrubber runs first.
    const safe = scrubSecrets(r.code === 'NO_QUALIFIED_ROUTE' ? `Cannot verify by a model call yet: no ${provider} route is qualified for literal_transformation. ${r.error}` : r.error, 300);
    return { ok: false, error: r.code === 'SPEND_BLOCKED' ? `BLOCKED_BUDGET (${r.spendCode ?? 'UNKNOWN'}): ${safe}` : safe };
  }
  // routedModelCall records the provider attempt (lib/provider-state.ts evidence).
  return { ok: true, model: r.modelUsed, sample: r.output.trim().slice(0, 80) };
}

// ---------------------------------------------------------------------------
// PUSH 2B — provider-parameterized platform credential surface.
//
// WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
//
// It adds one safe status shape and one list, so a single HTTP route can
// serve every provider instead of a hardcoded route per provider. It adds NO
// new credential storage: the same model_credentials table, the same
// AES-256-GCM envelope, the same environment-wins precedence.
//
// SCOPE, STATED PLAINLY. This storage is PLATFORM-GLOBAL — model_credentials
// is keyed by provider alone. The HTTP surface in server.ts is workspace-admin
// AUTHORIZED (a caller must prove workspace admin), but a key saved by one
// workspace's admin is the key every workspace uses. Making storage truly
// per-workspace would mean adding workspace_id to the key and threading a
// workspace through resolveModelApiKey(), which lib/conversation/llm.ts calls
// with no workspace context at all — a real regression risk to the shipped
// Concierge path for a multi-tenancy this deployment does not yet have. The
// honest position is: authorization is workspace-scoped, storage is global,
// and that is written down rather than implied.
// ---------------------------------------------------------------------------

/** Safe, secret-free status for one provider. Never returns or derives from the key's value. */
export function getProviderCredentialStatus(provider: ModelProvider): ProviderCredentialStatus {
  const envVar = PROVIDER_ENV_VAR[provider];
  const envPresent = Boolean((process.env[envVar] || '').trim());
  const row = readRow(provider);
  const storedRowPresent = Boolean(row?.api_key_encrypted);
  const resolved = resolveModelApiKey(provider);

  const state: ProviderCredentialState =
    resolved.source === 'environment' ? 'ENVIRONMENT'
    : resolved.source === 'server_store' ? 'STORED'
    : 'NOT_CONFIGURED';

  return {
    provider,
    state,
    configured: Boolean(resolved.apiKey),
    envVar,
    storedRowPresent,
    overriddenByEnvironment: envPresent && storedRowPresent,
    updatedAt: row?.updated_at ?? null,
  };
}

/** Every provider this build can execute, with its real state. The list is the extension point — a new provider needs no new endpoint. */
export function listProviderCredentialStatuses(): ProviderCredentialStatus[] {
  return SUPPORTED_MODEL_PROVIDERS.map((p) => getProviderCredentialStatus(p));
}


// ---------------------------------------------------------------------------
// RUNTIME CREDENTIAL SLOTS — keys for execution runtimes that are NOT model
// providers.
//
// Antigravity is a managed-agent runtime, not a model the router selects, so it
// is deliberately NOT in SUPPORTED_MODEL_PROVIDERS (that list drives routing).
// Its key still lives in THIS store — same table, same encryption, same
// environment-first precedence, same platform_admin-only routes — rather than
// in a second secret store.
// ---------------------------------------------------------------------------
export const RUNTIME_CREDENTIAL_SLOTS = ['antigravity'] as const;
export type RuntimeCredentialSlot = (typeof RUNTIME_CREDENTIAL_SLOTS)[number];

const RUNTIME_ENV_VAR: Record<RuntimeCredentialSlot, string> = { antigravity: 'ANTIGRAVITY_API_KEY' };

export function isRuntimeCredentialSlot(v: unknown): v is RuntimeCredentialSlot {
  return typeof v === 'string' && (RUNTIME_CREDENTIAL_SLOTS as readonly string[]).includes(v);
}

export function resolveRuntimeCredential(slot: RuntimeCredentialSlot): { apiKey: string; source: ModelKeySource } {
  const envKey = (process.env[RUNTIME_ENV_VAR[slot]] || '').trim();
  if (envKey) return { apiKey: envKey, source: 'environment' };
  const row = readRow(slot);
  if (row?.api_key_encrypted) {
    try {
      const apiKey = decryptVoiceSecret(row.api_key_encrypted).trim();
      if (apiKey) return { apiKey, source: 'server_store' };
    } catch { /* undecryptable is absent; status still shows the row exists */ }
  }
  return { apiKey: '', source: 'none' };
}

export function saveRuntimeCredential(params: { slot: RuntimeCredentialSlot; apiKey: string; userId: string }): RuntimeCredentialStatus {
  const apiKey = String(params.apiKey || '').trim();
  if (!apiKey) throw new Error('An API key is required.');
  if (apiKey.length > 500) throw new Error('That does not look like an API key.');
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO model_credentials (provider, api_key_encrypted, updated_by_user_id, created_at, updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET
      api_key_encrypted = excluded.api_key_encrypted,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at
  `).run(params.slot, encryptVoiceSecret(apiKey), params.userId, now, now);
  return getRuntimeCredentialStatus(params.slot);
}

export function deleteRuntimeCredential(slot: RuntimeCredentialSlot): void {
  getDatabase().prepare('DELETE FROM model_credentials WHERE provider = ?').run(slot);
}

export interface RuntimeCredentialStatus {
  slot: RuntimeCredentialSlot;
  state: ProviderCredentialState;
  configured: boolean;
  envVar: string;
  storedRowPresent: boolean;
  overriddenByEnvironment: boolean;
  updatedAt: string | null;
}

/** Presence and provenance only. The value is never returned. */
export function getRuntimeCredentialStatus(slot: RuntimeCredentialSlot): RuntimeCredentialStatus {
  const envVar = RUNTIME_ENV_VAR[slot];
  const envPresent = Boolean((process.env[envVar] || '').trim());
  const row = readRow(slot);
  const storedRowPresent = Boolean(row?.api_key_encrypted);
  const resolved = resolveRuntimeCredential(slot);
  return {
    slot,
    state: resolved.source === 'environment' ? 'ENVIRONMENT' : resolved.source === 'server_store' ? 'STORED' : 'NOT_CONFIGURED',
    configured: Boolean(resolved.apiKey),
    envVar,
    storedRowPresent,
    overriddenByEnvironment: envPresent && storedRowPresent,
    updatedAt: row?.updated_at ?? null,
  };
}
