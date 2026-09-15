// ---------------------------------------------------------------------------
// SYNTHOS — the ONE canonical runtime voice configuration.
//
// THE MISMATCH THIS CLOSES, AND WHERE IT ACTUALLY CAME FROM
//
// The reported symptom was "CLI and dashboard disagree about the voice." The
// cause was not a display bug and could not have been fixed by making one
// screen mirror another. Runtime voice configuration was genuinely split across
// two stores that never synchronised:
//
//   * WHICH PROVIDER SPEAKS lived in the browser, in
//     `localStorage['hermes_voice_config']` (src/App.tsx), defaulting to
//     'web_speech'. The server never saw it, never stored it, and could not
//     report it. A second browser — or a cleared cache — showed a different
//     "current configuration" for the same deployment, and neither was
//     authoritative.
//
//   * THE CREDENTIAL, VOICE AND MODEL lived server-side in `voice_credentials`
//     (lib/voice-credentials.ts), resolved per request with a documented
//     precedence.
//
// So the dashboard was never reading runtime configuration at all. It showed a
// per-browser preference while the runtime resolved something else entirely.
// This module makes the SERVER the single source of truth for the whole thing,
// so "what the dashboard shows" and "what the runtime does" are by construction
// the same answer.
//
// FIVE FIELDS THAT MUST NOT COLLAPSE INTO EACH OTHER
//
// An opaque provider voice id must never determine what the agent is called.
// These are five independent facts and are stored as five columns:
//
//   agentDisplayName   "Avery"              what the business calls its agent
//   voiceProfileName   "Warm British"       a human label for the voice
//   provider           "fish_audio"         who synthesises
//   providerVoiceId    "7f92f8afb8ec..."    the provider's opaque handle
//   ttsModel           "speech-1.6"         the provider's model tier
//
// STT is deliberately NOT in this table: speech-to-text runs in the visitor's
// own browser via the Web Speech API and has no server-side provider or model
// to configure. Recording it here would imply a choice that does not exist.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';
import { resolveFishConfig } from './voice-credentials';

/** Providers that can actually synthesise in this build. Not a wish list. */
export const VOICE_PROVIDERS = ['web_speech', 'fish_audio', 'elevenlabs', 'openai'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export function isVoiceProvider(v: unknown): v is VoiceProvider {
  return typeof v === 'string' && (VOICE_PROVIDERS as readonly string[]).includes(v);
}

/**
 * `web_speech` is the browser's built-in synthesiser. It needs no credential
 * and always works, which is why it is the safe default — but it is a robot
 * voice, and must never be reported as though a real provider spoke.
 */
export const DEFAULT_PROVIDER: VoiceProvider = 'web_speech';

export interface VoiceSettings {
  agentDisplayName: string | null;
  voiceProfileName: string | null;
  provider: VoiceProvider;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

const SINGLETON_ID = 'default';

function ensureTable(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS voice_settings (
      settings_id        TEXT PRIMARY KEY,
      agent_display_name TEXT,
      voice_profile_name TEXT,
      provider           TEXT NOT NULL,
      updated_by_user_id TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
  `);
}

/**
 * The stored settings, or the honest default when nothing has been saved.
 *
 * Never invents an agent name or a voice profile name — an unset label reads as
 * null, so the UI can say "not set" rather than showing a placeholder the
 * operator never chose.
 */
export function getVoiceSettings(): VoiceSettings {
  ensureTable();
  const row = getDatabase()
    .prepare('SELECT * FROM voice_settings WHERE settings_id = ?')
    .get(SINGLETON_ID) as any;

  if (!row) {
    return {
      agentDisplayName: null,
      voiceProfileName: null,
      provider: DEFAULT_PROVIDER,
      updatedAt: null,
      updatedByUserId: null,
    };
  }
  return {
    agentDisplayName: row.agent_display_name ?? null,
    voiceProfileName: row.voice_profile_name ?? null,
    provider: isVoiceProvider(row.provider) ? row.provider : DEFAULT_PROVIDER,
    updatedAt: row.updated_at ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
  };
}

export interface SaveVoiceSettingsParams {
  agentDisplayName?: string | null;
  voiceProfileName?: string | null;
  provider?: VoiceProvider;
  updatedByUserId?: string | null;
}

/**
 * Partial update. An omitted field keeps its current value; an explicit `null`
 * clears it. The distinction matters — saving only the provider must not wipe
 * the agent's name, which is exactly the kind of silent data loss that made the
 * old two-store arrangement untrustworthy.
 */
export function saveVoiceSettings(params: SaveVoiceSettingsParams): VoiceSettings {
  ensureTable();
  const current = getVoiceSettings();
  const now = new Date().toISOString();

  const agentDisplayName = params.agentDisplayName === undefined
    ? current.agentDisplayName
    : (params.agentDisplayName?.trim() || null);
  const voiceProfileName = params.voiceProfileName === undefined
    ? current.voiceProfileName
    : (params.voiceProfileName?.trim() || null);
  const provider = params.provider === undefined ? current.provider : params.provider;

  getDatabase().prepare(`
    INSERT INTO voice_settings (settings_id, agent_display_name, voice_profile_name, provider, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(settings_id) DO UPDATE SET
      agent_display_name = excluded.agent_display_name,
      voice_profile_name = excluded.voice_profile_name,
      provider           = excluded.provider,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at         = excluded.updated_at
  `).run(SINGLETON_ID, agentDisplayName, voiceProfileName, provider, params.updatedByUserId ?? null, now, now);

  return getVoiceSettings();
}

// ---------------------------------------------------------------------------
// The resolved runtime voice configuration.
//
// This is the function the dashboard reads AND the function that describes what
// the runtime will actually do. That is the whole point: there is no second
// path that could report something different from what happens, because the
// same resolution produces both answers.
// ---------------------------------------------------------------------------


export interface ResolvedVoiceRuntime {
  /** What the business calls its agent. Independent of every field below. */
  agentDisplayName: string | null;
  /** A human label for the voice. Independent of the opaque id below. */
  voiceProfileName: string | null;
  provider: VoiceProvider;
  providerSource: 'server_store' | 'default';
  /** The provider's opaque handle. NEVER the agent's name. */
  providerVoiceId: string | null;
  providerVoiceIdSource: 'server_store' | 'environment' | 'none';
  ttsModel: string | null;
  ttsModelSource: 'server_store' | 'environment' | 'default' | 'none';
  /** Whether a credential exists for the selected provider, and where from. */
  credentialPresent: boolean;
  credentialSource: 'server_store' | 'environment' | 'none';
  /**
   * Whether the selected provider can actually speak right now. `web_speech`
   * is always ready (it is the browser's own synthesiser and needs no key).
   */
  ready: boolean;
  /** Why not, when `ready` is false. */
  reason: string | null;
  /**
   * Speech-to-text. Fixed, and reported so nothing has to infer it: recognition
   * runs in the visitor's browser and no audio reaches this server.
   */
  sttProvider: 'browser_web_speech_api';
  sttModel: null;
  sttNote: string;
}

const STT_NOTE =
  'Speech-to-text runs in the browser via the Web Speech API. No audio is uploaded to or stored by this server, and there is no server-side STT provider or model to configure.';

export function resolveVoiceRuntime(env: NodeJS.ProcessEnv = process.env): ResolvedVoiceRuntime {
  const settings = getVoiceSettings();
  const base = {
    agentDisplayName: settings.agentDisplayName,
    voiceProfileName: settings.voiceProfileName,
    provider: settings.provider,
    providerSource: (settings.updatedAt ? 'server_store' : 'default') as 'server_store' | 'default',
    sttProvider: 'browser_web_speech_api' as const,
    sttModel: null,
    sttNote: STT_NOTE,
  };

  if (settings.provider === 'web_speech') {
    return {
      ...base,
      providerVoiceId: null, providerVoiceIdSource: 'none',
      ttsModel: null, ttsModelSource: 'none',
      credentialPresent: false, credentialSource: 'none',
      ready: true,
      reason: null,
    };
  }

  if (settings.provider === 'fish_audio') {
    // The SAME resolver the synthesis path uses — not a parallel reimplementation.
    const fish = resolveFishConfig({});
    const ready = Boolean(fish.apiKey) && Boolean(fish.referenceId);
    return {
      ...base,
      providerVoiceId: fish.referenceId,
      providerVoiceIdSource: fish.referenceIdSource === 'request' ? 'server_store' : fish.referenceIdSource,
      ttsModel: fish.model,
      ttsModelSource: fish.modelSource === 'request' ? 'server_store' : fish.modelSource,
      credentialPresent: Boolean(fish.apiKey),
      credentialSource: fish.keySource,
      ready,
      reason: ready
        ? null
        : !fish.apiKey
          ? 'No Fish Audio API key is configured, in the server store or the environment.'
          : 'No Fish Audio reference voice is configured, so the intended cloned voice cannot be used.',
    };
  }

  // elevenlabs / openai — real synthesis paths, gated on an environment key.
  const envVar = settings.provider === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'OPENAI_API_KEY';
  const present = Boolean((env[envVar] || '').trim());
  return {
    ...base,
    providerVoiceId: null, providerVoiceIdSource: 'none',
    ttsModel: null, ttsModelSource: 'none',
    credentialPresent: present,
    credentialSource: present ? 'environment' : 'none',
    ready: present,
    reason: present ? null : `No ${envVar} is configured in this deployment's environment.`,
  };
}
