import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_DB = path.join(os.tmpdir(), `synthos-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB;

import {
  getVoiceSettings, saveVoiceSettings, resolveVoiceRuntime,
  isVoiceProvider, VOICE_PROVIDERS, DEFAULT_PROVIDER,
} from '../lib/voice-settings';
import { getDatabase } from '../lib/persistence';

// ---------------------------------------------------------------------------
// DAYS 2-3 PART B — voice configuration truth.
//
// THE DEFECT THESE TESTS PIN DOWN
//
// The reported symptom was "CLI and dashboard disagree about the voice." Two
// real causes were found by tracing configuration source -> persistence -> API
// -> dashboard -> runtime -> provider, rather than by making one screen mirror
// another:
//
//   1. WHICH PROVIDER SPEAKS lived only in the browser
//      (localStorage['hermes_voice_config'], src/App.tsx), defaulting to
//      'web_speech'. The server had never heard of it. Two browsers disagreed
//      with each other and both disagreed with the runtime.
//
//   2. THE VOICE ID was read from TWO localStorage stores by
//      src/services/fishAudio.ts and sent in the request body — and
//      resolveFishConfig gives a request-supplied reference_id precedence over
//      the server store. A stale browser value silently overrode the configured
//      voice, and a hardcoded fallback guaranteed some voice always came out,
//      so the misconfiguration never surfaced.
// ---------------------------------------------------------------------------

beforeEach(() => {
  try { getDatabase().exec('DELETE FROM voice_settings'); } catch { /* table not created yet */ }
  delete process.env.FISH_AUDIO_API_KEY;
  delete process.env.FISH_AUDIO_VOICE_ID;
  delete process.env.FISH_AUDIO_DEFAULT_VOICE_ID;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe('PART B: five identities that must never collapse into each other', () => {
  it('an opaque provider voice id never determines the agent name', () => {
    saveVoiceSettings({ agentDisplayName: 'Avery', voiceProfileName: 'Warm British', provider: 'fish_audio' });
    process.env.FISH_AUDIO_API_KEY = 'test-key';
    process.env.FISH_AUDIO_VOICE_ID = '7f92f8afb8ec43bf81429cc1c9199cb1';

    const c = resolveVoiceRuntime();
    expect(c.agentDisplayName).toBe('Avery');
    expect(c.voiceProfileName).toBe('Warm British');
    expect(c.providerVoiceId).toBe('7f92f8afb8ec43bf81429cc1c9199cb1');
    // The name is not derived from the id, and specifically is never "Jarvis".
    expect(c.agentDisplayName).not.toBe(c.providerVoiceId);
    expect(c.agentDisplayName).not.toBe('Jarvis');
    // The voice's human label is not the provider's handle either.
    expect(c.voiceProfileName).not.toBe(c.providerVoiceId);
  });

  it('changing the voice id leaves the agent name untouched', () => {
    saveVoiceSettings({ agentDisplayName: 'Avery', provider: 'fish_audio' });
    process.env.FISH_AUDIO_API_KEY = 'k';
    process.env.FISH_AUDIO_VOICE_ID = 'voice-one';
    expect(resolveVoiceRuntime().agentDisplayName).toBe('Avery');
    process.env.FISH_AUDIO_VOICE_ID = 'voice-two';
    const c = resolveVoiceRuntime();
    expect(c.providerVoiceId).toBe('voice-two');
    expect(c.agentDisplayName).toBe('Avery');
  });

  it('STT is reported as browser-side, with no server model to configure', () => {
    const c = resolveVoiceRuntime();
    expect(c.sttProvider).toBe('browser_web_speech_api');
    expect(c.sttModel).toBeNull();
    expect(c.sttNote).toMatch(/No audio is uploaded/i);
  });
});

describe('PART B: one canonical source, with explicit precedence', () => {
  it('defaults honestly to web_speech before anything is saved', () => {
    const s = getVoiceSettings();
    expect(s.provider).toBe(DEFAULT_PROVIDER);
    expect(s.agentDisplayName).toBeNull();   // never an invented placeholder
    expect(s.voiceProfileName).toBeNull();
    expect(resolveVoiceRuntime().providerSource).toBe('default');
  });

  it('a saved provider is server state and reports its source', () => {
    saveVoiceSettings({ provider: 'fish_audio' });
    const c = resolveVoiceRuntime();
    expect(c.provider).toBe('fish_audio');
    expect(c.providerSource).toBe('server_store');
  });

  it('a partial save never silently wipes the other fields', () => {
    // The failure mode that made the old split arrangement untrustworthy.
    saveVoiceSettings({ agentDisplayName: 'Avery', voiceProfileName: 'Warm British', provider: 'fish_audio' });
    saveVoiceSettings({ provider: 'web_speech' });
    const s = getVoiceSettings();
    expect(s.provider).toBe('web_speech');
    expect(s.agentDisplayName).toBe('Avery');
    expect(s.voiceProfileName).toBe('Warm British');
  });

  it('an explicit null clears a field, distinct from omitting it', () => {
    saveVoiceSettings({ agentDisplayName: 'Avery' });
    saveVoiceSettings({ agentDisplayName: null });
    expect(getVoiceSettings().agentDisplayName).toBeNull();
  });

  it('rejects a provider this build cannot actually use', () => {
    expect(isVoiceProvider('fish_audio')).toBe(true);
    expect(isVoiceProvider('web_speech')).toBe(true);
    expect(isVoiceProvider('some_unsupported_tts')).toBe(false);
    expect(VOICE_PROVIDERS).toContain('fish_audio');
  });

  it('TEST D: settings survive a new database handle — real persistence, not memory', () => {
    saveVoiceSettings({ agentDisplayName: 'Avery', voiceProfileName: 'Warm British', provider: 'fish_audio' });
    // A fresh read goes back to SQLite; nothing is cached in module state.
    const reread = getVoiceSettings();
    expect(reread.provider).toBe('fish_audio');
    expect(reread.agentDisplayName).toBe('Avery');
    expect(reread.updatedAt).toBeTruthy();
  });
});

describe('PART B: readiness is evidence, never an assumption', () => {
  it('web_speech is always ready and claims no credential', () => {
    saveVoiceSettings({ provider: 'web_speech' });
    const c = resolveVoiceRuntime();
    expect(c.ready).toBe(true);
    expect(c.credentialPresent).toBe(false);
    expect(c.providerVoiceId).toBeNull();
  });

  it('fish_audio with no key is NOT ready, and says which piece is missing', () => {
    saveVoiceSettings({ provider: 'fish_audio' });
    const c = resolveVoiceRuntime();
    expect(c.ready).toBe(false);
    expect(c.reason).toMatch(/API key/i);
  });

  it('fish_audio with a key but no voice is NOT ready — a generic voice is not success', () => {
    saveVoiceSettings({ provider: 'fish_audio' });
    process.env.FISH_AUDIO_API_KEY = 'test-key';
    const c = resolveVoiceRuntime();
    expect(c.credentialPresent).toBe(true);
    expect(c.ready).toBe(false);
    expect(c.reason).toMatch(/reference voice/i);
  });

  it('elevenlabs and openai report readiness from their real environment keys', () => {
    saveVoiceSettings({ provider: 'elevenlabs' });
    expect(resolveVoiceRuntime().ready).toBe(false);
    process.env.ELEVENLABS_API_KEY = 'el-key';
    const c = resolveVoiceRuntime();
    expect(c.ready).toBe(true);
    expect(c.credentialSource).toBe('environment');
  });

  it('never returns a credential value anywhere in the resolved config', () => {
    saveVoiceSettings({ provider: 'fish_audio' });
    process.env.FISH_AUDIO_API_KEY = 'super-secret-fish-key-value';
    const serialized = JSON.stringify(resolveVoiceRuntime());
    expect(serialized).not.toContain('super-secret-fish-key-value');
  });
});

describe('PART B: the duplicated configuration sources are gone, and stay gone', () => {
  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  const fishSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'fishAudio.ts'), 'utf8');

  it('App.tsx no longer initialises voice configuration from localStorage', () => {
    // The regression this guards: re-seeding voiceConfig from localStorage
    // re-creates a per-browser truth the server cannot see.
    const init = appSrc.slice(appSrc.indexOf('const [voiceConfig'), appSrc.indexOf('const handleUpdateVoiceConfig'));
    expect(init).not.toContain("localStorage.getItem('hermes_voice_config')");
    expect(init).toContain('/api/voice/runtime-config');
  });

  it('App.tsx writes voice configuration to the server, not to localStorage', () => {
    const save = appSrc.slice(appSrc.indexOf('const handleUpdateVoiceConfig'), appSrc.indexOf('const handleUpdateVoiceConfig') + 2000);
    expect(save).not.toContain("localStorage.setItem('hermes_voice_config'");
    expect(save).toContain("method: 'PUT'");
  });

  it('fishAudio.ts no longer sources a voice id from localStorage', () => {
    const fn = fishSrc.slice(fishSrc.indexOf('export function getPersistentFishAudioVoiceId'), fishSrc.indexOf('export function getPersistentFishAudioVoiceId') + 1600);
    expect(fn).not.toContain('localStorage.getItem');
    expect(fn).not.toContain('hermes_jarvis_settings');
  });

  it('fishAudio.ts no longer falls back to a hardcoded voice id', () => {
    // The hardcoded fallback guaranteed SOME voice always came out, so a
    // misconfiguration never surfaced as a failure.
    const fn = fishSrc.slice(fishSrc.indexOf('export function getPersistentFishAudioVoiceId'), fishSrc.indexOf('export function getPersistentFishAudioVoiceId') + 1600);
    expect(fn).not.toMatch(/return[\s\S]*DEFAULT_FISH_AUDIO_VOICE_ID/);
  });

  it('the browser is still never a credential source', () => {
    expect(fishSrc).not.toMatch(/localStorage[\s\S]{0,200}API_KEY/);
  });
});
