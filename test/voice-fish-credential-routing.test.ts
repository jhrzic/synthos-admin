import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// P0 VOICE REGRESSION — Jarvis spoke with the browser's robot voice while the
// UI claimed Fish Audio was active. Two independent defects produced it, and
// this file locks both closed.
//
// DEFECT 1 — the credential never reached the server.
//   Two Settings surfaces wrote the Fish Audio key to two DIFFERENT
//   localStorage stores ('hermes_jarvis_settings' and 'hermes_voice_config').
//   Jarvis read the one the key was not in, so it posted an empty apiKey to
//   /api/tts. With no FISH_AUDIO_API_KEY in the environment either, the route
//   answered API_KEY_NOT_CONFIGURED.
//
// DEFECT 2 — that failure was accepted as audio.
//   The route returned HTTP 200 with a JSON body on failure, and the client's
//   acceptance check ended in `|| response.status === 200`, which made the
//   content-type test dead code. The 179-byte JSON error cleared the
//   `byteLength > 50` floor, was handed to an <audio> element, failed to
//   decode, and fell through to speechSynthesis.
//
// These are source/behaviour assertions in the style this repo already uses
// for UI-wiring truth (see test/jarvis-admin-wiring.test.ts).
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');

const serverContent = read('server.ts');
const voiceCredentialsContent = read('lib/voice-credentials.ts');
const voiceEngineContent = read('src/services/voiceEngine.ts');
const fishAudioContent = read('src/services/fishAudio.ts');
const jarvisViewContent = read('src/components/JarvisView.tsx');
const settingsViewContent = read('src/components/SettingsView.tsx');
const appContent = read('src/App.tsx');

function ttsRouteSlice(): string {
  const idx = serverContent.indexOf('app.post(["/api/voice/tts", "/api/tts"]');
  expect(idx).toBeGreaterThan(-1);
  const next = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, next === -1 ? undefined : next);
}

/**
 * The Fish Audio request itself now lives in ONE function shared by the admin
 * TTS route and the public business-assistant voice route — a second call site
 * appeared and copying the request would have meant two places to keep the
 * `model`-is-a-header rule, the 402 free-tier retry and the empty-audio guard
 * correct. These assertions follow the logic; none of them was relaxed.
 */
function fishSynthesisSlice(): string {
  const idx = voiceCredentialsContent.indexOf('export async function synthesizeFishAudio');
  expect(idx).toBeGreaterThan(-1);
  return voiceCredentialsContent.slice(idx);
}

describe('1: the reference voice reaches the Fish Audio request body', () => {
  it('the resolver returns a reference_id and names where it came from', () => {
    expect(voiceCredentialsContent).toContain('export function resolveFishConfig');
    expect(voiceCredentialsContent).toContain('referenceIdSource');
    for (const source of ["'request'", "'server_store'", "'environment'"]) {
      expect(voiceCredentialsContent).toContain(source);
    }
  });

  it('the Fish request body carries reference_id from the resolved config', () => {
    const slice = fishSynthesisSlice();
    expect(slice).toContain('https://api.fish.audio/v1/tts');
    expect(slice).toContain('reference_id: resolved.referenceId');
    // And the route reaches the provider only through that one function.
    expect(ttsRouteSlice()).toContain('await synthesizeFishAudio({');
    expect(ttsRouteSlice()).not.toContain('https://api.fish.audio/v1/tts');
  });

  it('a MISSING reference voice is refused, never silently synthesized with a stock voice', () => {
    // "A generic Fish default voice does NOT count as success" — the point of
    // the product is the configured cloned voice.
    expect(fishSynthesisSlice()).toContain('if (!resolved.referenceId)');
    expect(fishSynthesisSlice()).toContain('REFERENCE_ID_NOT_CONFIGURED');
    expect(ttsRouteSlice()).toContain('REFERENCE_ID_NOT_CONFIGURED');
  });

  it('Jarvis passes its configured voice id into the canonical engine', () => {
    expect(jarvisViewContent).toContain('speakViaVoiceEngine(text, {');
    expect(jarvisViewContent).toContain('voiceId: targetVoiceId');
  });
});

describe('2: model selection matches the current Fish Audio contract', () => {
  it('model is sent as an HTTP HEADER, which is where /v1/tts reads it', () => {
    const slice = fishSynthesisSlice();
    // The header form. Body-level `model` is ignored by this endpoint.
    const headersIdx = slice.indexOf('headers: {');
    expect(headersIdx).toBeGreaterThan(-1);
    const headersBlock = slice.slice(headersIdx, slice.indexOf('body:', headersIdx));
    expect(headersBlock).toContain('model: fishModel');
    // ...and it must NOT be smuggled into the JSON body, where it does nothing.
    const bodyBlock = slice.slice(slice.indexOf('body: JSON.stringify({', headersIdx), slice.indexOf('let usedModel'));
    expect(bodyBlock).not.toContain('model:');
  });

  it('only documented model values are accepted', () => {
    expect(voiceCredentialsContent).toContain("'s1', 's2-pro', 's2.1-pro', 's2.1-pro-free'");
    expect(voiceCredentialsContent).toContain("FISH_AUDIO_DEFAULT_MODEL: FishAudioModel = 's2.1-pro'");
  });

  it('an unsupported model is rejected at the credentials route rather than sent to the provider', () => {
    expect(serverContent).toContain('Unsupported Fish Audio model');
  });

  it('a 402 (API credit exhausted) retries once on the documented free tier', () => {
    const slice = fishSynthesisSlice();
    expect(slice).toContain('response.status === 402');
    expect(slice).toContain('FISH_AUDIO_FREE_MODEL');
    // The original 402 stays the reported cause, not the retry's error.
    expect(slice).toContain('PROVIDER_INSUFFICIENT_CREDIT');
  });

  it('the public assistant route shares that same path rather than repeating it', () => {
    const i = serverContent.indexOf('app.post("/api/public/assistant/:publicKey/speak"');
    expect(i).toBeGreaterThan(-1);
    const slice = serverContent.slice(i, i + 3000);
    expect(slice).toContain('await synthesizeFishAudio({');
    expect(slice).not.toContain('https://api.fish.audio');
    // Exactly one place in the entire codebase performs the synthesis call.
    expect((serverContent.match(/fetch\(["']https:\/\/api\.fish\.audio/g) || []).length).toBe(0);
    expect((voiceCredentialsContent.match(/fetch\(["']https:\/\/api\.fish\.audio/g) || []).length).toBe(1);
  });
});

describe('3: a failure is never HTTP 200 — the bug that made JSON play as audio', () => {
  it('every Fish failure path returns a real error status', () => {
    const slice = ttsRouteSlice();
    expect(slice).toContain('res.status(503)');
    expect(slice).toContain('res.status(502)');
    // The old shape: a degraded result dressed as success.
    expect(slice).not.toContain('res.status(200).json({\n            success: false');
  });

  it('an empty/short provider body is refused rather than sent as audio', () => {
    const slice = ttsRouteSlice();
    expect(fishSynthesisSlice()).toContain('EMPTY_AUDIO_RESPONSE');
    expect(fishSynthesisSlice()).toContain('buf.byteLength < 128');
  });

  it('the client no longer treats "status === 200" as proof of audio', () => {
    // The exact defect string. If this ever comes back, the robot voice does too.
    expect(fishAudioContent).not.toContain('response.status === 200');
    expect(voiceEngineContent).not.toContain('res.status === 200');
  });

  it('the client requires a genuine audio content-type before playing', () => {
    for (const content of [fishAudioContent, voiceEngineContent]) {
      expect(content).toContain("includes('audio')");
      expect(content).toContain("includes('octet-stream')");
    }
  });
});

describe('4: the browser never holds or sends the Fish Audio secret', () => {
  it('the canonical engine sends no apiKey field to the server', () => {
    const speakIdx = voiceEngineContent.indexOf('body: JSON.stringify({');
    expect(speakIdx).toBeGreaterThan(-1);
    const body = voiceEngineContent.slice(speakIdx, speakIdx + 400);
    expect(body).not.toMatch(/apiKey:/);
  });

  it('the TTS route resolves the credential server-side and ignores any client-sent key', () => {
    // The credential is resolved inside the shared synthesis function, which
    // the route reaches only by calling it — so the route has no opportunity
    // to substitute a caller-supplied key even by accident.
    expect(fishSynthesisSlice()).toContain('resolveFishConfig({');
    expect(ttsRouteSlice()).toContain('await synthesizeFishAudio({');
    for (const slice of [ttsRouteSlice(), fishSynthesisSlice()]) {
      expect(slice).not.toContain('clientKey');
      expect(slice).not.toContain('req.body.apiKey');
    }
  });

  it('there is no direct browser -> api.fish.audio synthesis call any more', () => {
    // It required the secret in the browser and was CSP-blocked regardless.
    const directCalls = (fishAudioContent.match(/fetch\('https:\/\/api\.fish\.audio/g) || []).length;
    expect(directCalls).toBe(0);
  });

  it('the key is never persisted to browser storage, and an old stored key is migrated then scrubbed', () => {
    expect(appContent).toContain('synthos_voice_credential_migrated');
    expect(appContent).toContain("delete parsed.FISH_AUDIO_API_KEY");
    // The settings writer strips the secret before writing localStorage.
    expect(appContent).toContain('const { FISH_AUDIO_API_KEY, ...safeSettings }');
  });

  it('both Settings surfaces write the key to the server, not into local settings state', () => {
    expect(settingsViewContent).toContain("fetch('/api/voice/credentials'");
    expect(jarvisViewContent).toContain("fetch('/api/voice/credentials'");
    // The old pattern that produced two competing browser copies.
    expect(settingsViewContent).not.toContain('FISH_AUDIO_API_KEY: val');
    expect(jarvisViewContent).not.toContain('FISH_AUDIO_API_KEY: val');
  });

  it('the credentials API returns presence only — never the key value', () => {
    expect(voiceCredentialsContent).toContain('export function getVoiceCredentialStatus');
    const statusFn = voiceCredentialsContent.slice(
      voiceCredentialsContent.indexOf('export function getVoiceCredentialStatus')
    );
    expect(statusFn).toContain('apiKeyPresent');
    // A status object must not carry a decrypted key.
    expect(statusFn.slice(0, 600)).not.toContain('apiKey:');
  });
});

describe('5: Jarvis routes through the one canonical path', () => {
  it('Jarvis speaks via voiceEngine, not its own second Fish implementation', () => {
    expect(jarvisViewContent).toContain("import { speakText as speakViaVoiceEngine");
    expect(jarvisViewContent).toContain('await speakViaVoiceEngine(text, {');
    // The Jarvis-only duplicate path is gone.
    expect(jarvisViewContent).not.toContain('const buffer = await synthesizeFishAudio(');
  });

  it('only the concise spokenSummary is spoken — the P3 contract is intact', () => {
    const idx = jarvisViewContent.indexOf('const result = await onJarvisCommand(query);');
    expect(idx).toBeGreaterThan(-1);
    const slice = jarvisViewContent.slice(idx, idx + 1200);
    expect(slice).toContain('const { reply, spokenSummary } = result;');
    expect(slice).toContain('speakText(spoken)');
    expect(slice).not.toMatch(/speakText\(reply\)/);
  });

  it('the in-flight duplicate-submission guard is untouched', () => {
    // JarvisView's guard is isLoadingRef (see test/jarvis-duplicate-submission.test.ts).
    expect(jarvisViewContent).toContain('isLoadingRef');
  });
});

describe('5b: real provider audio is not thrown away, and is never played twice', () => {
  it('a failed <audio> element falls back to Web Audio BEFORE conceding to browser speech', () => {
    // A blob: URL can be refused by the embedding context ("Media load
    // rejected by URL safety check") even when the bytes are a valid MP3 that
    // decodeAudioData handles fine. Without this second route, genuine Fish
    // Audio output would be discarded and the robot voice would speak.
    expect(voiceEngineContent).toContain('async function playViaWebAudio');
    expect(voiceEngineContent).toContain('decodeAudioData');
    const degradeIdx = voiceEngineContent.indexOf('const degrade =');
    expect(degradeIdx).toBeGreaterThan(-1);
    const degradeBlock = voiceEngineContent.slice(degradeIdx, degradeIdx + 900);
    // Web Audio is attempted first; only if it fails do we call fallback().
    expect(degradeBlock.indexOf('playViaWebAudio')).toBeLessThan(degradeBlock.indexOf('fallback(text, config, reason, detail)'));
  });

  it('Web Audio success is reported as the PROVIDER speaking, not as a fallback', () => {
    const degradeIdx = voiceEngineContent.indexOf('const degrade =');
    const degradeBlock = voiceEngineContent.slice(degradeIdx, degradeIdx + 900);
    expect(degradeBlock).toContain('fellBackToWebSpeech: false');
    expect(degradeBlock).toContain('actualSource: config.provider');
  });

  it('the outcome settles exactly once — play() rejection AND onerror both fire for one failure', () => {
    // Without this guard each of the two events started its own Web Audio
    // playback and the reply was spoken twice, overlapping itself.
    expect(voiceEngineContent).toContain('let settled = false;');
    const settleGuards = (voiceEngineContent.match(/if \(settled\) return;/g) || []).length;
    expect(settleGuards).toBeGreaterThanOrEqual(2);
  });

  it('stopSpeaking() also tears down the Web Audio route, so a new reply cannot overlap an old one', () => {
    const stopIdx = voiceEngineContent.indexOf('export function stopSpeaking');
    const stopBlock = voiceEngineContent.slice(stopIdx, stopIdx + 700);
    expect(stopBlock).toContain('activeSource');
    expect(stopBlock).toContain('activeContext');
    expect(stopBlock).toContain('speechSynthesis.cancel()');
  });
});

describe('6: encrypted-at-rest credential storage round-trips', () => {
  const ORIGINAL = process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'unit-test-key-material';
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = ORIGINAL;
  });

  it('encrypts to the iv.tag.ciphertext envelope and decrypts back', async () => {
    const { encryptVoiceSecret, decryptVoiceSecret } = await import('../lib/voice-credentials');
    const secret = 'sk-fish-test-value-not-a-real-key';
    const stored = encryptVoiceSecret(secret);

    expect(stored.split('.')).toHaveLength(3);
    // The plaintext must not be recoverable by reading the stored string.
    expect(stored).not.toContain(secret);
    expect(decryptVoiceSecret(stored)).toBe(secret);
  });

  it('a tampered envelope fails authentication rather than returning garbage', async () => {
    const { encryptVoiceSecret, decryptVoiceSecret } = await import('../lib/voice-credentials');
    const stored = encryptVoiceSecret('sk-fish-test-value');
    const [iv, tag, ct] = stored.split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] = flipped[0] ^ 0xff;
    expect(() => decryptVoiceSecret([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });

  it('a different key cannot decrypt another key\'s envelope', async () => {
    const { encryptVoiceSecret, decryptVoiceSecret } = await import('../lib/voice-credentials');
    const stored = encryptVoiceSecret('sk-fish-test-value');
    process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(() => decryptVoiceSecret(stored)).toThrow();
  });
});

describe('7: provider errors are surfaced, but sanitized', () => {
  it('anything key-shaped is stripped from a provider error before it is returned or logged', async () => {
    const { sanitizeProviderError } = await import('../lib/voice-credentials');
    const raw = 'Unauthorized for sk-fish-abcdef1234567890 using Bearer sk-fish-abcdef1234567890';
    const clean = sanitizeProviderError(raw);
    expect(clean).not.toContain('sk-fish-abcdef1234567890');
    expect(clean).toContain('[REDACTED_KEY]');
  });

  it('the real provider failure is reported rather than collapsed into a generic message', () => {
    // The operator-facing route still surfaces the provider's own cause.
    const route = ttsRouteSlice();
    expect(route).toContain('providerStatus');
    expect(route).toContain('synth.providerError');
    const shared = fishSynthesisSlice();
    expect(shared).toContain('PROVIDER_AUTH_REJECTED');
    expect(shared).toContain('sanitizeProviderError');
  });

  it('the PUBLIC assistant route does the opposite and never leaks the provider message', () => {
    // A visitor on someone else's website must not learn that a business's
    // Fish Audio balance ran out, or which credential is missing.
    const i = serverContent.indexOf('app.post("/api/public/assistant/:publicKey/speak"');
    const slice = serverContent.slice(i, i + 3000);
    expect(slice).toContain('console.error');
    expect(slice).toContain('The spoken reply could not be generated');
    expect(slice).not.toContain('error: `Fish Audio API error');
    expect(slice).not.toContain('providerStatus: synth.providerStatus');
  });
});
