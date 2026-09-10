/**
 * Voice Engine Client Service — THE canonical browser-side TTS path.
 *
 * Every surface that speaks (Jarvis, GlobalVoiceOverlay, Apollo,
 * MasterAdminView, VoiceSettingsModal) goes through speakText() here, which
 * proxies to the server route /api/voice/tts. There is deliberately no second
 * client-side Fish Audio implementation and no direct browser -> api.fish.audio
 * call: the browser never holds or sends the provider secret, and the app's own
 * CSP (connect-src 'self') would block such a call anyway.
 *
 * P0 regression note — why this file changed. The previous version accepted
 * ANY 200 response as audio. The server returned HTTP 200 with a JSON
 * `{status:"DEGRADED"}` body on every failure, so a failed synthesis was
 * handed to the audio player as if it were an MP3. Playback then failed and
 * the code quietly fell back to window.speechSynthesis — the robot voice —
 * while the UI still reported Fish Audio as active. Two rules now prevent
 * that recurring:
 *
 *   1. Audio is only audio if the response says so (ok status + audio
 *      content-type + a plausible byte length). Nothing else is played.
 *   2. A fallback is always REPORTED. speakText() resolves with a
 *      VoiceOutcome saying what actually spoke and why, so a caller can show
 *      a degraded state instead of silently implying the configured voice
 *      was used.
 */

export interface VoiceConfig {
  provider: 'fish_audio' | 'elevenlabs' | 'openai' | 'openai_realtime' | 'web_speech';
  /**
   * @deprecated Never sent to the server. The Fish Audio key lives in the
   * server-side encrypted credential store (see lib/voice-credentials.ts).
   * Retained only so existing callers still typecheck.
   */
  apiKey?: string;
  /** Fish Audio reference_id — the cloned/custom voice. Not a secret. */
  voiceId?: string;
  /** Fish Audio model tier. Not a secret. */
  model?: string;
  speed?: number;
}

/** What actually produced the sound, and why — never inferred, always reported. */
export interface VoiceOutcome {
  requestedProvider: VoiceConfig['provider'];
  /** The source that genuinely spoke. 'web_speech' here means the robot voice. */
  actualSource: 'fish_audio' | 'elevenlabs' | 'openai' | 'openai_realtime' | 'web_speech' | 'none';
  /** True only when the requested provider really produced the audio. */
  ok: boolean;
  /** True when browser speech synthesis stood in for the requested provider. */
  fellBackToWebSpeech: boolean;
  /** Machine-readable cause, e.g. API_KEY_NOT_CONFIGURED, PROVIDER_INSUFFICIENT_CREDIT. */
  reason?: string;
  /** Human-readable, already sanitized server-side. Safe to show in the UI. */
  detail?: string;
  /** Provenance echoed by the server for a successful synthesis. */
  model?: string | null;
  referenceId?: string | null;
}

// STEP 6 corrective pass (B1) — module-level so every caller of this
// shared service (GlobalVoiceOverlay, HermesChatView, ApolloVoiceView,
// MasterAdminView, VoiceSettingsModal) cancels through the same real
// state, rather than each tracking its own. Never allow overlapping
// Jarvis/voice speech: a new speakText() call always stops whatever this
// service was previously playing before it starts anything new.
let activeAudio: HTMLAudioElement | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let activeContext: AudioContext | null = null;

/** Stops any audio or Web Speech utterance this service is currently playing. Exported so a caller (e.g. a new-request guard) can stop speech explicitly, not only implicitly on the next speakText() call. */
export function stopSpeaking(): void {
  if (activeAudio) {
    try { activeAudio.pause(); } catch { /* best effort */ }
    activeAudio = null;
  }
  if (activeSource) {
    try { activeSource.stop(); } catch { /* best effort */ }
    activeSource = null;
  }
  if (activeContext) {
    try { void activeContext.close(); } catch { /* best effort */ }
    activeContext = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Second playback route: decode the bytes with Web Audio and play them
 * directly, bypassing the <audio> element entirely.
 *
 * Worth having because the two routes fail for different reasons. An
 * <audio> element loading a blob: URL can be refused by the embedding
 * context ("Media load rejected by URL safety check") even when the bytes
 * are a perfectly valid MP3 — decodeAudioData on the same bytes succeeds.
 * Without this, a real Fish Audio response would be discarded and the robot
 * voice would speak instead, which is the failure mode this whole fix
 * exists to remove. Resolves true only if audio genuinely played.
 */
async function playViaWebAudio(blob: Blob): Promise<boolean> {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return false;
    const ctx: AudioContext = new Ctor();
    activeContext = ctx;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* may need a gesture; decode still worth trying */ }
    }
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(ctx.destination);
    activeSource = source;

    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      source.start(0);
      // Safety net: never hang the caller if onended is missed.
      setTimeout(resolve, Math.ceil(decoded.duration * 1000) + 500);
    });

    if (activeSource === source) activeSource = null;
    if (activeContext === ctx) {
      try { await ctx.close(); } catch { /* best effort */ }
      activeContext = null;
    }
    return true;
  } catch {
    return false;
  }
}

/** A fallback is a real event with a real cause — never a silent substitution. */
async function fallback(
  text: string,
  config: VoiceConfig,
  reason: string,
  detail?: string
): Promise<VoiceOutcome> {
  console.warn(`[Voice Engine] ${config.provider} unavailable (${reason}) — falling back to browser speech synthesis. ${detail || ''}`);
  await playWebSpeech(text, config.speed);
  return {
    requestedProvider: config.provider,
    actualSource: 'web_speech',
    ok: false,
    fellBackToWebSpeech: true,
    reason,
    detail,
  };
}

export async function speakText(text: string, config: VoiceConfig): Promise<VoiceOutcome> {
  stopSpeaking();

  // Web Speech explicitly selected is a SUCCESS, not a fallback — the user
  // asked for the browser voice and got it.
  if (config.provider === 'web_speech') {
    await playWebSpeech(text, config.speed);
    return {
      requestedProvider: 'web_speech',
      actualSource: 'web_speech',
      ok: true,
      fellBackToWebSpeech: false,
    };
  }

  let res: Response;
  try {
    res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        provider: config.provider,
        // No apiKey field. The server resolves the credential itself; the
        // browser is not a credential source.
        voiceId: config.voiceId,
        model: config.model,
        speed: config.speed || 1.0,
      }),
    });
  } catch (error: any) {
    return fallback(text, config, 'NETWORK_ERROR', error?.message);
  }

  if (!res.ok) {
    // The server now reports a real cause on a real error status. Surface it
    // rather than collapsing every failure into "TTS failed".
    const err = await res.json().catch(() => null);
    return fallback(
      text,
      config,
      err?.reason || `HTTP_${res.status}`,
      err?.error || `TTS request failed with HTTP ${res.status}.`
    );
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('audio') && !contentType.includes('octet-stream')) {
    // A 200 that is not audio is the exact shape that used to be played as if
    // it were audio. It is a failure, and it is named as one.
    const err = await res.json().catch(() => null);
    return fallback(
      text,
      config,
      err?.reason || 'NON_AUDIO_RESPONSE',
      err?.error || `Expected audio, received "${contentType || 'unknown content-type'}".`
    );
  }

  const blob = await res.blob();
  if (blob.size < 128) {
    return fallback(text, config, 'EMPTY_AUDIO_RESPONSE', `Received ${blob.size} bytes, which is not playable audio.`);
  }

  const model = res.headers.get('x-voice-model');
  const referenceId = res.headers.get('x-voice-reference-id');
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  activeAudio = audio;

  return new Promise<VoiceOutcome>((resolve) => {
    // A failed <audio> load fires BOTH the play() rejection and the element's
    // onerror. Without this guard each one starts its own Web Audio playback
    // and the reply is spoken twice, overlapping itself. Settle exactly once.
    let settled = false;

    const succeed = () => {
      if (settled) return;
      settled = true;
      if (activeAudio === audio) activeAudio = null;
      URL.revokeObjectURL(audioUrl);
      resolve({
        requestedProvider: config.provider,
        actualSource: config.provider,
        ok: true,
        fellBackToWebSpeech: false,
        model,
        referenceId,
      });
    };

    const degrade = (reason: string, detail: string) => {
      if (settled) return;
      settled = true;
      if (activeAudio === audio) activeAudio = null;
      // Try the Web Audio route before conceding to browser speech: the bytes
      // are already known to be provider audio, and only the <audio> element
      // route failed.
      playViaWebAudio(blob).then((played) => {
        URL.revokeObjectURL(audioUrl);
        if (played) {
          resolve({
            requestedProvider: config.provider,
            actualSource: config.provider,
            ok: true,
            fellBackToWebSpeech: false,
            model,
            referenceId,
          });
          return;
        }
        fallback(text, config, reason, detail).then(resolve);
      });
    };

    audio.onended = succeed;
    audio.onerror = () => degrade('PLAYBACK_ERROR', 'The browser could not decode the audio returned by the provider.');
    audio.play().catch((err) =>
      degrade('PLAYBACK_BLOCKED', err?.message || 'Audio playback was blocked by the browser.')
    );
  });
}

export function playWebSpeech(text: string, speed = 1.0): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
