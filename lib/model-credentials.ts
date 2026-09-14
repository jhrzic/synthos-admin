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

function readRow(provider: ModelProvider): Row | undefined {
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
 * A real call to the provider proving the key works, before a customer ever
 * meets it. Returns the observed model, never the key.
 */
export async function verifyModelCredential(provider: ModelProvider): Promise<
  { ok: true; model: string; sample: string } | { ok: false; error: string }
> {
  const { apiKey } = resolveModelApiKey(provider);
  if (!apiKey) return { ok: false, error: 'No API key is configured for this provider.' };

  if (provider === 'openai') return verifyOpenAiCredential(apiKey);

  const { normalizeGeminiModel } = await import('./model-router');
  const model = normalizeGeminiModel();
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: 'Reply with the single word: ready',
      config: { maxOutputTokens: 10, temperature: 0 },
    });
    const sample = String((response as any)?.text ?? '').trim();
    if (!sample) return { ok: false, error: 'The provider accepted the key but returned nothing.' };
    return { ok: true, model, sample: sample.slice(0, 80) };
  } catch (err: any) {
    // Provider errors can echo the key back in a URL or header dump. Scrub any
    // long key-shaped token before this reaches a log or a response.
    const raw = String(err?.message || 'The provider call failed.');
    const safe = raw
      .replace(/AIza[A-Za-z0-9_-]{10,}/g, 'AIza…REDACTED…')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '…REDACTED…')
      .slice(0, 300);
    return { ok: false, error: safe };
  }
}

/**
 * A real OpenAI call proving the key works, before it is ever relied on in
 * a run. Deliberately routed through the SAME adapter the kernel executes
 * with (lib/fabric/model-openai.ts) rather than a private fetch: a
 * verification that exercises a different code path than production can
 * pass while production fails, which is worse than no verification.
 *
 * Returns the model the PROVIDER reported running, never the key.
 */
async function verifyOpenAiCredential(
  apiKey: string
): Promise<{ ok: true; model: string; sample: string } | { ok: false; error: string }> {
  const { resolveDefaultOpenAiModel } = await import('./model-router');
  const { generateViaOpenAI } = await import('./fabric/model-openai');
  const model = resolveDefaultOpenAiModel();

  const result = await generateViaOpenAI({
    apiKey,
    contents: 'Reply with the single word: ready',
    candidateModels: [model],
    timeoutMs: 20_000,
  });

  if (!result.output.trim()) {
    return { ok: false, error: result.lastProviderError || 'The provider accepted the key but returned nothing.' };
  }
  return { ok: true, model: result.modelUsed || model, sample: result.output.trim().slice(0, 80) };
}
