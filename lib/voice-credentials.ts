// ---------------------------------------------------------------------------
// P0 voice regression — canonical server-side voice credential store.
//
// WHY THIS EXISTS. Before this module the Fish Audio API key had no
// server-side home at all. The Settings UI wrote it to browser localStorage
// and every TTS call shipped it back to /api/voice/tts in the request body,
// which meant (a) the secret lived in the browser, (b) the server could only
// ever see a key a client chose to send, and (c) two different localStorage
// stores ('hermes_jarvis_settings' and 'hermes_voice_config') each held a
// *different* copy, so a key typed into one surface was invisible to the
// other. That last point is the Jarvis robot-voice regression: Jarvis read
// the store the key was not in, sent an empty key, and fell back to browser
// speech synthesis.
//
// The credential is encrypted at rest with AES-256-GCM, reusing the exact
// envelope format lib/mcp-client.ts already uses for MCP bearer tokens
// (iv.tag.ciphertext, all base64). The key is taken from
// MCP_CREDENTIAL_ENCRYPTION_KEY when set, so a deployment that already
// manages that secret keeps one key for both subsystems. When it is not set
// we self-provision a local 32-byte key file under the signing key dir, the
// same way lib/persistence.ts:ensureSigningKeyPair() self-provisions the
// Ed25519 receipt keypair — that is a deliberate, existing pattern in this
// repo, and it means a local install needs zero environment setup to stop
// storing an API key in the browser.
//
// SECURITY_LIMITATION (stated, not claimed away — same honesty as
// lib/mcp-client.ts): this is application-managed symmetric encryption, not a
// KMS/HSM. If the SQLite file and the key file are compromised together the
// credential is recoverable. It is a real improvement over a secret sitting
// in localStorage and travelling in every TTS request body; it is not
// hardware-backed secrecy.
//
// No function here ever returns a secret VALUE to an API response or a log
// line. getVoiceCredentialStatus() reports presence only. The plaintext key
// leaves this module through exactly one door — getVoiceCredential() — which
// is called only by the server-side Fish Audio fetch in server.ts.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { getDatabase, getSigningKeyDir } from './persistence';

export type VoiceProvider = 'fish_audio' | 'elevenlabs' | 'openai';

/**
 * Fish Audio TTS model identifiers, verified against the current
 * documented contract for POST https://api.fish.audio/v1/tts.
 *
 * `model` is an optional HTTP HEADER on that endpoint — NOT a body field —
 * and the server defaults to "s2.1-pro" when the header is absent. The code
 * this replaces sent no model header at all (so it silently used the paid
 * s2.1-pro default) and, on the error retry path, sent `model: "s2.1-pro"`
 * in a JSON BODY to a different endpoint shape, where it does nothing.
 */
export const FISH_AUDIO_MODELS = ['s1', 's2-pro', 's2.1-pro', 's2.1-pro-free'] as const;
export type FishAudioModel = (typeof FISH_AUDIO_MODELS)[number];

/** The documented default when no `model` header is sent. */
export const FISH_AUDIO_DEFAULT_MODEL: FishAudioModel = 's2.1-pro';

/**
 * The free tier. Used as an automatic retry when the paid tier reports 402
 * "Insufficient API credit" — Fish Audio bills API credit separately from
 * platform credit, so a working account can still hard-fail a TTS call.
 */
export const FISH_AUDIO_FREE_MODEL: FishAudioModel = 's2.1-pro-free';

export function isFishAudioModel(value: unknown): value is FishAudioModel {
  return typeof value === 'string' && (FISH_AUDIO_MODELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Encryption key resolution
// ---------------------------------------------------------------------------

const VOICE_KEY_FILENAME = 'voice_credential.key';

function voiceKeyPath(): string {
  return path.join(getSigningKeyDir(), VOICE_KEY_FILENAME);
}

/**
 * Resolves the 32-byte AES key. Prefers MCP_CREDENTIAL_ENCRYPTION_KEY (any
 * length, sha256'd to 32 bytes — identical derivation to lib/mcp-client.ts)
 * so one managed secret covers both credential stores. Otherwise
 * self-provisions a local key file at 0600.
 */
export function getVoiceEncryptionKey(): Buffer {
  const raw = process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
  if (raw) return crypto.createHash('sha256').update(raw).digest();

  const keyPath = voiceKeyPath();
  if (fs.existsSync(keyPath)) {
    const stored = fs.readFileSync(keyPath, 'utf8').trim();
    if (stored.length > 0) return crypto.createHash('sha256').update(stored).digest();
  }

  const keyDir = getSigningKeyDir();
  if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });
  const generated = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(keyPath, generated, { encoding: 'utf8', mode: 0o600 });
  return crypto.createHash('sha256').update(generated).digest();
}

/** Where the at-rest encryption key came from. Presence/provenance only, never the key. */
export function voiceEncryptionKeySource(): 'env' | 'local_key_file' {
  return process.env.MCP_CREDENTIAL_ENCRYPTION_KEY ? 'env' : 'local_key_file';
}

export function encryptVoiceSecret(plaintext: string): string {
  const key = getVoiceEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptVoiceSecret(stored: string): string {
  const key = getVoiceEncryptionKey();
  const [ivB64, tagB64, ciphertextB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Stored voice credential is malformed.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface VoiceCredentialRecord {
  provider: VoiceProvider;
  /** Decrypted API key, or null when none is stored. */
  apiKey: string | null;
  /** Fish Audio reference_id (the cloned/custom voice). Not a secret. */
  referenceId: string | null;
  /** Fish Audio model header value. Not a secret. */
  model: FishAudioModel | null;
  format: string | null;
  updatedAt: string | null;
}

export interface VoiceCredentialStatus {
  provider: VoiceProvider;
  apiKeyPresent: boolean;
  referenceIdPresent: boolean;
  /** Safe to return — a voice id identifies a voice, it does not authenticate. */
  referenceId: string | null;
  model: FishAudioModel | null;
  format: string | null;
  updatedAt: string | null;
}

export function saveVoiceCredential(params: {
  provider: VoiceProvider;
  apiKey?: string | null;
  referenceId?: string | null;
  model?: string | null;
  format?: string | null;
  userId: string;
}): VoiceCredentialStatus {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = readRow(params.provider);

  // An omitted/blank apiKey means "leave the stored key alone" — so saving a
  // voice id from the UI cannot silently wipe a working credential. An
  // explicit null clears it.
  let encrypted: string | null;
  if (params.apiKey === null) {
    encrypted = null;
  } else if (typeof params.apiKey === 'string' && params.apiKey.trim().length > 0) {
    encrypted = encryptVoiceSecret(params.apiKey.trim());
  } else {
    encrypted = existing?.api_key_encrypted ?? null;
  }

  const referenceId =
    params.referenceId === null
      ? null
      : typeof params.referenceId === 'string' && params.referenceId.trim().length > 0
        ? params.referenceId.trim()
        : (existing?.reference_id ?? null);

  const model = isFishAudioModel(params.model) ? params.model : (existing?.model ?? null);
  const format =
    typeof params.format === 'string' && params.format.trim().length > 0
      ? params.format.trim()
      : (existing?.format ?? null);

  db.prepare(
    `INSERT INTO voice_credentials (provider, api_key_encrypted, reference_id, model, format, updated_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       api_key_encrypted = excluded.api_key_encrypted,
       reference_id      = excluded.reference_id,
       model             = excluded.model,
       format            = excluded.format,
       updated_by_user_id= excluded.updated_by_user_id,
       updated_at        = excluded.updated_at`
  ).run(
    params.provider,
    encrypted,
    referenceId,
    model,
    format,
    params.userId,
    existing?.created_at ?? now,
    now
  );

  return getVoiceCredentialStatus(params.provider);
}

interface VoiceCredentialRow {
  provider: string;
  api_key_encrypted: string | null;
  reference_id: string | null;
  model: string | null;
  format: string | null;
  created_at: string;
  updated_at: string;
}

function readRow(provider: VoiceProvider): VoiceCredentialRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM voice_credentials WHERE provider = ?')
    .get(provider) as VoiceCredentialRow | undefined;
  return row ?? null;
}

/**
 * The one door the plaintext key leaves by. Server-side callers only.
 * Returns null rather than throwing when nothing is stored or the stored
 * envelope cannot be decrypted (e.g. the key file was rotated) — a broken
 * credential must degrade to a reported failure, never crash a TTS request.
 */
export function getVoiceCredential(provider: VoiceProvider): VoiceCredentialRecord | null {
  const row = readRow(provider);
  if (!row) return null;

  let apiKey: string | null = null;
  if (row.api_key_encrypted) {
    try {
      apiKey = decryptVoiceSecret(row.api_key_encrypted);
    } catch {
      apiKey = null;
    }
  }

  return {
    provider: row.provider as VoiceProvider,
    apiKey,
    referenceId: row.reference_id,
    model: isFishAudioModel(row.model) ? row.model : null,
    format: row.format,
    updatedAt: row.updated_at,
  };
}

/** Presence-only view. This is what an API response may contain. */
export function getVoiceCredentialStatus(provider: VoiceProvider): VoiceCredentialStatus {
  const row = readRow(provider);
  return {
    provider,
    apiKeyPresent: Boolean(row?.api_key_encrypted),
    referenceIdPresent: Boolean(row?.reference_id),
    referenceId: row?.reference_id ?? null,
    model: isFishAudioModel(row?.model) ? (row!.model as FishAudioModel) : null,
    format: row?.format ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export function deleteVoiceCredential(provider: VoiceProvider): void {
  getDatabase().prepare('DELETE FROM voice_credentials WHERE provider = ?').run(provider);
}

// ---------------------------------------------------------------------------
// Resolution — the single precedence order every TTS call uses
// ---------------------------------------------------------------------------

export type VoiceKeySource = 'server_store' | 'environment' | 'none';

export interface ResolvedFishConfig {
  apiKey: string;
  keySource: VoiceKeySource;
  referenceId: string | null;
  referenceIdSource: 'request' | 'server_store' | 'environment' | 'none';
  model: FishAudioModel;
  modelSource: 'request' | 'server_store' | 'environment' | 'default';
}

/**
 * Resolves the credential for a Fish Audio call.
 *
 * Precedence is deliberate: the server-side encrypted store wins over the
 * environment, and the browser is not a source at all. A client can still
 * choose the VOICE (reference_id) and MODEL per request — neither is a
 * secret — but it can never supply the key.
 */
export function resolveFishConfig(request: {
  referenceId?: unknown;
  model?: unknown;
}): ResolvedFishConfig {
  const stored = getVoiceCredential('fish_audio');

  const envKey = (process.env.FISH_AUDIO_API_KEY || '').trim();
  const storedKey = (stored?.apiKey || '').trim();

  let apiKey = '';
  let keySource: VoiceKeySource = 'none';
  if (storedKey) {
    apiKey = storedKey;
    keySource = 'server_store';
  } else if (envKey) {
    apiKey = envKey;
    keySource = 'environment';
  }

  const requestedReference =
    typeof request.referenceId === 'string' && request.referenceId.trim().length > 0
      ? request.referenceId.trim()
      : null;
  const envReference = (
    process.env.FISH_AUDIO_VOICE_ID ||
    process.env.FISH_AUDIO_DEFAULT_VOICE_ID ||
    ''
  ).trim();

  let referenceId: string | null = null;
  let referenceIdSource: ResolvedFishConfig['referenceIdSource'] = 'none';
  if (requestedReference) {
    referenceId = requestedReference;
    referenceIdSource = 'request';
  } else if (stored?.referenceId) {
    referenceId = stored.referenceId;
    referenceIdSource = 'server_store';
  } else if (envReference) {
    referenceId = envReference;
    referenceIdSource = 'environment';
  }

  const envModel = (process.env.FISH_AUDIO_MODEL || '').trim();
  let model: FishAudioModel = FISH_AUDIO_DEFAULT_MODEL;
  let modelSource: ResolvedFishConfig['modelSource'] = 'default';
  if (isFishAudioModel(request.model)) {
    model = request.model;
    modelSource = 'request';
  } else if (stored?.model) {
    model = stored.model;
    modelSource = 'server_store';
  } else if (isFishAudioModel(envModel)) {
    model = envModel;
    modelSource = 'environment';
  }

  return { apiKey, keySource, referenceId, referenceIdSource, model, modelSource };
}

/**
 * Strips anything key-shaped out of a provider error before it is logged or
 * returned. Fish Audio does not echo the key today, but a provider error body
 * is untrusted text and this route surfaces it to the UI by design (rule 9:
 * report the real failure) — so it gets scrubbed on the way out.
 */
export function sanitizeProviderError(raw: string): string {
  return raw
    .replace(/sk-[A-Za-z0-9_\-]{6,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{6,}/gi, 'Bearer [REDACTED_KEY]')
    .slice(0, 500);
}

// ---------------------------------------------------------------------------
// THE ONE FISH AUDIO SYNTHESIS CALL
//
// Extracted because a second call site appeared: the public business assistant
// needed voice output, and copying the request into another route immediately
// meant two places to keep the contract right — the `model` HTTP header that
// does nothing in the body, the free-tier retry on 402, the sub-128-byte
// "success" that is not audio. All three were learned the hard way once.
//
// Callers differ only in what they do with the failure: the admin route
// reports the provider's own message to an operator, the public route must
// not leak it to a visitor.
// ---------------------------------------------------------------------------

export type FishSynthesisResult =
  | { ok: true; audio: Buffer; mimeType: string; model: string; referenceId: string; keySource: VoiceKeySource }
  | {
      ok: false;
      reason: 'API_KEY_NOT_CONFIGURED' | 'REFERENCE_ID_NOT_CONFIGURED' | 'PROVIDER_INSUFFICIENT_CREDIT'
        | 'PROVIDER_AUTH_REJECTED' | 'MODEL_PROVIDER_UNAVAILABLE' | 'EMPTY_AUDIO_RESPONSE' | 'REQUEST_FAILED';
      providerStatus?: number;
      /** Already passed through sanitizeProviderError. Safe to log; never safe to show a customer. */
      providerError?: string;
      model?: string;
      referenceId?: string | null;
      keySource?: VoiceKeySource;
    };

export async function synthesizeFishAudio(params: {
  text: string;
  referenceId?: string;
  model?: string;
  format?: string;
  latency?: string;
  speed?: number;
}): Promise<FishSynthesisResult> {
  const resolved = resolveFishConfig({ referenceId: params.referenceId, model: params.model });

  if (!resolved.apiKey) {
    return { ok: false, reason: 'API_KEY_NOT_CONFIGURED', keySource: resolved.keySource };
  }
  if (!resolved.referenceId) {
    // A generic Fish default voice is NOT success for this product — the
    // configured cloned voice is the point, so a missing reference_id is
    // reported rather than quietly synthesized with whatever stock voice the
    // provider picks.
    return { ok: false, reason: 'REFERENCE_ID_NOT_CONFIGURED', keySource: resolved.keySource };
  }

  const format = params.format || process.env.FISH_AUDIO_AUDIO_FORMAT || 'mp3';
  const latency = params.latency || process.env.FISH_AUDIO_LATENCY_MODE || 'normal';

  // `model` is an HTTP HEADER on POST /v1/tts, not a body field. Sending it in
  // the body silently does nothing.
  const call = (fishModel: string) =>
    fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        'Content-Type': 'application/json',
        model: fishModel,
      },
      body: JSON.stringify({
        text: params.text,
        reference_id: resolved.referenceId,
        format,
        latency,
        prosody: { speed: Number(params.speed) || 1.0 },
      }),
    });

  let usedModel = resolved.model;
  let response: Response;
  try {
    response = await call(usedModel);
  } catch (err: any) {
    return { ok: false, reason: 'REQUEST_FAILED', providerError: sanitizeProviderError(err?.message || 'network error') };
  }

  // Fish meters API credit SEPARATELY from platform credit, so a live account
  // with an active subscription still 402s once the API balance runs out. The
  // free tier is a real documented model on the same endpoint honouring the
  // same reference_id, so it is worth one automatic retry.
  if (response.status === 402 && usedModel !== FISH_AUDIO_FREE_MODEL) {
    const original = sanitizeProviderError(await response.text());
    try {
      const retry = await call(FISH_AUDIO_FREE_MODEL);
      if (retry.ok) {
        usedModel = FISH_AUDIO_FREE_MODEL;
        response = retry;
        // Audio was produced, but only because the paid balance ran out and
        // the free tier caught it. That distinction is what FREE_TIER_ONLY
        // exists to keep visible.
        recordFishObservation({ paidCreditExhausted: true, failure: null });
      } else {
        // Keep the ORIGINAL 402 as the reported cause — the free-tier failure
        // is a consequence, not the diagnosis.
        return {
          ok: false, reason: 'PROVIDER_INSUFFICIENT_CREDIT', providerStatus: 402,
          providerError: `${original} | free-tier retry ${retry.status}: ${sanitizeProviderError(await retry.text())}`,
          model: resolved.model, referenceId: resolved.referenceId, keySource: resolved.keySource,
        };
      }
    } catch (err: any) {
      return {
        ok: false, reason: 'PROVIDER_INSUFFICIENT_CREDIT', providerStatus: 402,
        providerError: `${original} | free-tier retry failed: ${sanitizeProviderError(err?.message || 'network error')}`,
        model: resolved.model, referenceId: resolved.referenceId, keySource: resolved.keySource,
      };
    }
  }

  if (!response.ok) {
    recordFishObservation({ failure: `provider returned ${response.status}` });
    return {
      ok: false,
      reason: response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH_REJECTED' : 'MODEL_PROVIDER_UNAVAILABLE',
      providerStatus: response.status,
      providerError: sanitizeProviderError(await response.text()),
      model: usedModel, referenceId: resolved.referenceId, keySource: resolved.keySource,
    };
  }

  const buf = await response.arrayBuffer();
  // A 200 with no meaningful body is not audio. Caught here rather than
  // shipping an empty blob the player fails on silently.
  if (buf.byteLength < 128) {
    return {
      ok: false, reason: 'EMPTY_AUDIO_RESPONSE', providerStatus: 200,
      providerError: `${buf.byteLength} bytes returned, which is not playable audio.`,
      model: usedModel, referenceId: resolved.referenceId, keySource: resolved.keySource,
    };
  }

  const mimeType = format === 'opus' ? 'audio/ogg; codecs=opus' : format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  if (usedModel !== FISH_AUDIO_FREE_MODEL) recordFishObservation({ paidCreditExhausted: false, failure: null });
  return {
    ok: true, audio: Buffer.from(buf), mimeType,
    model: usedModel, referenceId: resolved.referenceId, keySource: resolved.keySource,
  };
}

// ---------------------------------------------------------------------------
// FISH AUDIO ACCOUNT STATE
//
// "The free-tier retry produces audio" is not the same as "voice is ready to
// sell". The paid API balance on this account is exhausted, and the retry is a
// genuine fallback, not a plan: the free tier is rate-limited and can be
// withdrawn by the provider at any time.
//
// So the state is named rather than inferred from whether the last request
// happened to succeed. FREE_TIER_ONLY is a real, distinct state that an owner
// must see before putting voice in front of customers.
//
// This is observed from real calls, not polled — there is no billing API here
// and inventing a balance figure would be worse than saying what we saw.
// ---------------------------------------------------------------------------

export type FishAccountState = 'PRODUCTION_READY' | 'FREE_TIER_ONLY' | 'NOT_CONFIGURED' | 'FAILED' | 'UNKNOWN';

interface FishObservation {
  state: FishAccountState;
  detail: string;
  observedAt: string | null;
}

let lastObservation: { paidCreditExhausted: boolean; lastFailure: string | null; at: string } | null = null;

/** Called by the synthesis path with what the provider actually did. */
export function recordFishObservation(params: { paidCreditExhausted?: boolean; failure?: string | null }): void {
  lastObservation = {
    paidCreditExhausted: params.paidCreditExhausted ?? lastObservation?.paidCreditExhausted ?? false,
    lastFailure: params.failure ?? null,
    at: new Date().toISOString(),
  };
}

export function getFishAccountState(): FishObservation {
  const status = getVoiceCredentialStatus('fish_audio');
  const envKey = Boolean((process.env.FISH_AUDIO_API_KEY || '').trim());
  if (!status.apiKeyPresent && !envKey) {
    return { state: 'NOT_CONFIGURED', detail: 'No Fish Audio API key is configured. Spoken replies are unavailable; text is unaffected.', observedAt: null };
  }
  if (!status.referenceIdPresent && !(process.env.FISH_AUDIO_VOICE_ID || '').trim()) {
    return { state: 'NOT_CONFIGURED', detail: 'A Fish Audio key is stored but no reference voice is set, so nothing can be synthesized.', observedAt: null };
  }
  if (!lastObservation) {
    return { state: 'UNKNOWN', detail: 'A Fish Audio key and voice are configured. No spoken reply has been generated yet, so the account state has not been observed.', observedAt: null };
  }
  if (lastObservation.paidCreditExhausted) {
    return {
      state: 'FREE_TIER_ONLY',
      detail: 'The paid Fish Audio API balance is exhausted. Spoken replies are falling back to the free tier, which is rate-limited and not a basis to sell voice. Top up the account before a paying customer relies on it.',
      observedAt: lastObservation.at,
    };
  }
  if (lastObservation.lastFailure) {
    return { state: 'FAILED', detail: `The last spoken reply failed: ${lastObservation.lastFailure}`, observedAt: lastObservation.at };
  }
  return { state: 'PRODUCTION_READY', detail: 'Spoken replies generated from the paid account.', observedAt: lastObservation.at };
}
