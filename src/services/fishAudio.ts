/**
 * Fish Audio TTS Integration Service & WebSocket Live Voice Streamer
 * High-performance neural text-to-speech with ultra-low latency streaming (<150ms)
 * Automatic persistent binding without browser popups or alert dialogs.
 */

export interface FishAudioOptions {
  apiKey?: string;
  voiceId?: string;
  FISH_AUDIO_API_KEY?: string;
  FISH_AUDIO_DEFAULT_VOICE_ID?: string;
  latencyMode?: 'low' | 'balanced';
  format?: 'mp3' | 'opus' | 'wav';
}

export const DEFAULT_FISH_AUDIO_VOICE_ID = '7f92f8afb8ec43bf81429cc1c9199cb1';
export const DEFAULT_FISH_AUDIO_API_KEY = '';
export const DEFAULT_FISH_AUDIO_WS_URL = 'wss://api.fish.audio/v1/tts/live';
export const DEFAULT_FISH_AUDIO_FALLBACK_LATENCY_MS = 800;

export const FISH_AUDIO_VOICE_PRESETS = [
  { id: '7f92f8afb8ec43bf81429cc1c9199cb1', name: 'Evelyn (Neutral Collaborator - Default)', tags: 'Calm • Low Jitter' },
  { id: '05b36da8574341d0803391491850db20', name: 'Adrian (Technical Deep)', tags: 'Sub-150ms • Clear' },
  { id: '800a830b8c8a4d2698942b4b8408cf57', name: 'Dexter (Deep Reasoning)', tags: 'Authoritative • Crisp' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Nova (Expressive Fast)', tags: 'Conversational' },
];

/**
 * Resolves the NON-SECRET voice selection from local settings.
 *
 * P0 regression fix: this used to also dig the Fish Audio API KEY out of
 * localStorage ('hermes_jarvis_settings') and hand it to callers, who then
 * posted it to the server in every TTS request body. Two problems, both of
 * which produced the robot voice:
 *
 *   - The secret lived in the browser, so the server could only ever use a
 *     key some client chose to send.
 *   - The key was written to TWO different localStorage stores by two
 *     different Settings surfaces ('hermes_jarvis_settings' and
 *     'hermes_voice_config'). Jarvis read the one it was NOT saved in, sent
 *     an empty key, and fell through to browser speech synthesis.
 *
 * The key now lives server-side only (lib/voice-credentials.ts). A voice id
 * is not a secret — it names a voice, it does not authenticate — so it stays
 * readable here.
 */
export function getPersistentFishAudioVoiceId(options?: FishAudioOptions): string {
  // DAYS 2-3 PART B — the localStorage reads and the hardcoded fallback are
  // GONE, and their absence is the fix.
  //
  // The comment above describes the half of this bug that was already fixed
  // (the API key). The other half survived: the VOICE ID was still read from
  // two different localStorage stores, then sent to the server in the request
  // body — and lib/voice-credentials.ts::resolveFishConfig gives a request-
  // supplied reference_id precedence over the server store. So a stale value in
  // one browser silently overrode the voice the deployment was configured to
  // use, while the configuration screen went on displaying the server's value.
  // That is the CLI-vs-dashboard mismatch, in its remaining form: not two
  // screens disagreeing, but the browser quietly winning.
  //
  // Falling back to a hardcoded id made it worse by guaranteeing SOME voice
  // came out, so the misconfiguration never surfaced as a failure.
  //
  // Returning '' when the caller supplies nothing is deliberate: an empty
  // reference_id means the server resolves its own stored voice, which is the
  // one the dashboard shows. The server remains the single source of truth.
  return (options?.FISH_AUDIO_DEFAULT_VOICE_ID || options?.voiceId || '').trim();
}

/**
 * Low-Latency WebSocket Voice Streamer for Jarvis
 */
export class JarvisVoiceStreamer {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private voiceId: string;
  private isConnecting: boolean = false;
  private onAudioChunkCallback?: (chunk: ArrayBuffer) => void;
  private onErrorCallback?: (err: any) => void;
  private onOpenCallback?: () => void;
  private onCloseCallback?: () => void;
  private textBufferQueue: string[] = [];

  // NOTE (P0 voice fix): this WebSocket streamer authenticates from the
  // BROWSER, so it only works if a key is passed in explicitly. It no longer
  // harvests one from localStorage, because the Fish Audio credential now
  // lives server-side only. With no key supplied the socket simply never
  // authenticates — it is dormant, not a fallback, and nothing in the Jarvis
  // speech path depends on it. The canonical path is
  // voiceEngine.speakText() -> /api/voice/tts.
  constructor(apiKey?: string, voiceId?: string) {
    this.apiKey = (apiKey || '').trim();
    this.voiceId = getPersistentFishAudioVoiceId({ voiceId });
  }

  public setCredentials(apiKey: string, voiceId?: string): void {
    this.apiKey = apiKey.trim();
    if (voiceId) this.voiceId = voiceId.trim();
  }

  public connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        resolve(true);
        return;
      }

      this.isConnecting = true;
      try {
        // Connect to Fish Audio Live WebSocket endpoint
        const wsUrl = DEFAULT_FISH_AUDIO_WS_URL;
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          this.isConnecting = false;
          // Send initial authentication handshake
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'start',
              apikey: this.apiKey,
              reference_id: this.voiceId,
              format: 'mp3',
              latency: 'low'
            }));
          }
          if (this.onOpenCallback) this.onOpenCallback();
          
          // Flush any buffered texts
          while (this.textBufferQueue.length > 0) {
            const nextText = this.textBufferQueue.shift();
            if (nextText) this.sendText(nextText);
          }

          resolve(true);
        };

        this.ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            if (this.onAudioChunkCallback) {
              this.onAudioChunkCallback(event.data);
            }
          }
        };

        this.ws.onerror = (err) => {
          this.isConnecting = false;
          if (this.onErrorCallback) this.onErrorCallback(err);
          resolve(false);
        };

        this.ws.onclose = () => {
          this.isConnecting = false;
          if (this.onCloseCallback) this.onCloseCallback();
        };
      } catch (err) {
        this.isConnecting = false;
        if (this.onErrorCallback) this.onErrorCallback(err);
        resolve(false);
      }
    });
  }

  public sendText(text: string): void {
    if (!text || !text.trim()) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'text',
        text: text.trim()
      }));
    } else {
      this.textBufferQueue.push(text);
      this.connect();
    }
  }

  public flush(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'finish' }));
    }
  }

  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public onAudioChunk(cb: (chunk: ArrayBuffer) => void): void {
    this.onAudioChunkCallback = cb;
  }

  public onError(cb: (err: any) => void): void {
    this.onErrorCallback = cb;
  }

  public onOpen(cb: () => void): void {
    this.onOpenCallback = cb;
  }

  public onClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }
}

/**
 * Synthesizes text with Fish Audio, through the server proxy only.
 *
 * TWO P0 BUGS WERE FIXED HERE, and both produced the robot voice:
 *
 * 1. THE ACCEPTANCE CHECK TREATED JSON AS AUDIO. It used to be:
 *
 *      if (response.ok && (ct.includes('audio') || ct.includes('octet-stream')
 *          || <a bare 200-status check>))
 *
 *    That trailing bare status check made the content-type test
 *    meaningless. The server answered every failure with HTTP 200 and a JSON
 *    `{status:"DEGRADED"}` body, which is well over the 50-byte floor, so the
 *    JSON was returned as "audio", handed to an <audio> element, failed to
 *    decode, and dropped through to speechSynthesis — while the UI reported
 *    "Fish Audio Stream Active".
 *
 * 2. IT CALLED api.fish.audio DIRECTLY FROM THE BROWSER as a second attempt,
 *    using a key read out of localStorage. That required the secret to be in
 *    the browser, and the app's own CSP (connect-src 'self') blocks the call
 *    anyway, so it was a dead path that existed only to leak a credential.
 *
 * The route now returns a real error status on failure, and this function
 * accepts a response as audio only when the server says it is audio.
 */
export async function synthesizeFishAudio(
  text: string,
  voiceId?: string,
  options?: FishAudioOptions
): Promise<ArrayBuffer> {
  const selectedVoiceId = voiceId || getPersistentFishAudioVoiceId(options);
  const latency = options?.latencyMode || 'low';
  const format = options?.format || 'mp3';

  const response = await fetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      provider: 'fish_audio',
      voiceId: selectedVoiceId,
      reference_id: selectedVoiceId,
      speed: 1.0,
      format,
      latency: latency === 'low' ? 'normal' : latency,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.error || `Fish Audio synthesis failed (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('audio') && !contentType.includes('octet-stream')) {
    const err = await response.json().catch(() => null);
    throw new Error(
      err?.error || `Fish Audio returned "${contentType || 'unknown content-type'}" instead of audio.`
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 128) {
    throw new Error(`Fish Audio returned ${buffer.byteLength} bytes, which is not playable audio.`);
  }
  return buffer;
}

/**
 * Ping Test helper for 3-Step Setup Wizard
 */
export async function testFishAudioConnection(apiKey?: string, voiceId?: string): Promise<{ success: boolean; message: string }> {
  const resolvedVoiceId = getPersistentFishAudioVoiceId({ voiceId });
  try {
    const testText = "Voice engine online.";
    const buffer = await synthesizeFishAudio(testText, resolvedVoiceId);
    // synthesizeFishAudio now throws on anything that is not real audio, so
    // reaching here means the provider genuinely returned playable bytes.
    return {
      success: true,
      message: `Connected to Fish Audio — voice ${resolvedVoiceId.slice(0, 8)}… returned ${buffer.byteLength} bytes of audio.`
    };
  } catch (err: any) {
    // Pass X / Workstream A2 — a failed connection must report FAILED, not a
    // disguised success. The browser speechSynthesis fallback genuinely
    // exists elsewhere in the app (JarvisView's fallbackBrowserSpeak), but
    // that is not the same thing as "Fish Audio is connected" — collapsing
    // the two here misled the exact UI surface this test result feeds.
    return {
      success: false,
      message: `Fish Audio connection test failed: ${err?.message || 'request failed'}. Falling back to browser speech synthesis until this is resolved.`
    };
  }
}

/**
 * Helper to play audio array buffer via HTML5 Audio + Web Audio Context fallback
 */
export async function playFishAudioBuffer(buffer: ArrayBuffer): Promise<HTMLAudioElement> {
  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.src = audioUrl;
  
  const cleanup = () => {
    URL.revokeObjectURL(audioUrl);
  };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });

  try {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      await playPromise;
    }
  } catch (playErr) {
    console.warn('HTML5 audio play error, falling back to Web Audio Context:', playErr);
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const decoded = await ctx.decodeAudioData(buffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        source.onended = () => {
          cleanup();
          if (audio.onended) {
            audio.onended(new Event('ended') as any);
          }
          ctx.close();
        };
        source.start(0);
      }
    } catch (ctxErr) {
      console.warn('AudioContext fallback error:', ctxErr);
    }
  }
  return audio;
}

/**
 * Browser Web Speech Synthesis Fallback
 */
export function playBrowserSpeechFallback(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    } else {
      resolve();
    }
  });
}

/**
 * Convenient all-in-one helper to synthesize and play speech using Fish Audio
 */
export async function speakWithFishAudio(
  text: string,
  apiKey?: string,
  voiceId?: string
): Promise<void> {
  try {
    const buffer = await synthesizeFishAudio(text, voiceId, { apiKey });
    await playFishAudioBuffer(buffer);
  } catch (err) {
    console.warn('Fish Audio speech playback fallback to browser speech:', err);
    await playBrowserSpeechFallback(text);
  }
}

export { type VoiceConfig, speakText, playWebSpeech } from './voiceEngine';
export { FishAudioClient, type FishAudioStreamConfig } from './fishAudioClient';
export { useJarvisVoice } from '../hooks/useJarvisVoice';
