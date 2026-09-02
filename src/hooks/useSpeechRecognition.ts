import { useState, useRef, useCallback, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Pass IX / Workstream AA — shared microphone/speech-recognition layer.
//
// Real browser Web Speech API only (SpeechRecognition /
// webkitSpeechRecognition) — Chromium/WebKit-based browsers. No
// getUserMedia call of its own: the Web Speech API requests microphone
// access implicitly when `.start()` is called, and permission
// grant/denial surfaces as real `onstart`/`onerror` events, never
// fabricated. AA6 — this file is shared INFRASTRUCTURE (capability
// detection, permission, start/stop, transcripts, errors, cleanup,
// cross-assistant collision prevention); it has no opinion about WHAT an
// assistant does with a transcript — Jarvis and Apollo each keep their own
// separate handler and routing, wired by their own component code.
// ---------------------------------------------------------------------------

export type MicState =
  | 'idle'
  | 'unsupported'
  | 'listening'
  | 'permission-denied'
  | 'no-device'
  | 'error';

export interface MicErrorInfo {
  /** The real event.error value from the browser (e.g. "not-allowed", "audio-capture", "network"). */
  code: string;
  /** A short, honest, user-facing message — never a raw stack trace. */
  message: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser to use voice input.',
  'service-not-allowed': 'Speech recognition is blocked by browser or system policy.',
  'audio-capture': 'No microphone was found. Connect a microphone and try again.',
  'no-speech': 'No speech was detected.',
  'network': 'A network error interrupted speech recognition. Check your connection and try again.',
  'aborted': 'Voice input was stopped.',
  'language-not-supported': 'The requested recognition language is not supported by this browser.',
};

/** AA2 — real capability check, never assumed from a mic icon being present. */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * AA3 — best-effort pre-flight permission check via the Permissions API.
 * Honestly returns 'unknown' rather than guessing on browsers that don't
 * support querying the "microphone" permission descriptor (notably
 * Firefox, and older Safari) — the real state is only knowable there once
 * `.start()` is actually attempted.
 */
export async function checkMicrophonePermissionState(): Promise<MicPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// AA9 — cross-assistant collision prevention. Jarvis (JarvisView,
// GlobalVoiceOverlay) and Apollo (ApolloVoiceView) each hold their own hook
// instance/recognizer — nothing about the browser API itself stops two
// separate recognizers from both being active. This module-level registry
// is the one piece of real shared state: starting a new recognizer always
// stops any other instance's active recognizer first, so at most one
// browser SpeechRecognition session is ever running at a time, regardless
// of which assistant started it.
// ---------------------------------------------------------------------------
let activeRecognizer: { instanceId: number; stop: () => void } | null = null;
let nextInstanceId = 1;

export const useSpeechRecognition = (onFinalSpeech: (text: string) => void) => {
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [micState, setMicState] = useState<MicState>(() => (isSpeechRecognitionSupported() ? 'idle' : 'unsupported'));
  const [error, setError] = useState<MicErrorInfo | null>(null);
  const recognitionRef = useRef<any>(null);
  const instanceIdRef = useRef<number>(nextInstanceId++);
  // AA10 — a short-window dedup guard: some browsers can fire a final
  // result twice in quick succession around stop/end; this ensures one
  // spoken utterance produces exactly one submitted command.
  const lastFinalRef = useRef<{ text: string; at: number } | null>(null);

  const handleSpeechResult = useCallback((event: any) => {
    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }

    const trimmedFinal = final.trim();
    if (trimmedFinal) {
      const now = Date.now();
      const last = lastFinalRef.current;
      const isDuplicate = !!last && last.text === trimmedFinal && now - last.at < 1500;
      setLiveTranscript('');
      if (!isDuplicate) {
        lastFinalRef.current = { text: trimmedFinal, at: now };
        onFinalSpeech(trimmedFinal);
      }
    } else {
      setLiveTranscript(interim);
    }
  }, [onFinalSpeech]);

  const clearTranscript = useCallback(() => {
    setLiveTranscript('');
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    if (activeRecognizer?.instanceId === instanceIdRef.current) {
      activeRecognizer = null;
    }
    setIsListening(false);
    clearTranscript();
  }, [clearTranscript]);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicState('unsupported');
      return false;
    }

    // AA9 — stop any other assistant's active recognizer before starting
    // this one. Real stop, not just a state flip — the other component's
    // isListening will flip to false via its own onend handler.
    if (activeRecognizer && activeRecognizer.instanceId !== instanceIdRef.current) {
      activeRecognizer.stop();
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* no-op */ }
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setMicState('listening');
        setError(null);
        clearTranscript();
        activeRecognizer = { instanceId: instanceIdRef.current, stop: stopListening };
      };

      recognition.onresult = handleSpeechResult;

      recognition.onerror = (event: any) => {
        const code = event?.error || 'unknown';
        // AA11 — no-speech is a transient, expected condition during a
        // continuous session (silence between utterances), never a
        // real failure — recognition keeps running, no error state shown.
        if (code === 'no-speech') return;

        console.warn('Speech recognition error:', code);
        setIsListening(false);
        if (activeRecognizer?.instanceId === instanceIdRef.current) activeRecognizer = null;

        // AA11/AA12 — real, mapped, honest states. Never a raw stack trace.
        const mappedState: MicState =
          code === 'not-allowed' || code === 'service-not-allowed' ? 'permission-denied'
          : code === 'audio-capture' ? 'no-device'
          : 'error';
        setMicState(mappedState);
        setError({ code, message: ERROR_MESSAGES[code] || `Speech recognition error: ${code}` });
      };

      recognition.onend = () => {
        setIsListening(false);
        if (activeRecognizer?.instanceId === instanceIdRef.current) activeRecognizer = null;
        setMicState((prev) => (prev === 'listening' ? 'idle' : prev));
      };

      recognitionRef.current = recognition;
      recognition.start();
      return true;
    } catch (err) {
      console.warn('Speech recognition start failed:', err);
      setIsListening(false);
      setMicState('error');
      setError({ code: 'start-failed', message: 'Voice input could not be started.' });
      return false;
    }
  }, [handleSpeechResult, clearTranscript, stopListening]);

  // AA8 — orphan-capture prevention: a component that unmounts while
  // listening (navigating away, closing the assistant surface) must not
  // leave a live browser recognizer running in the background.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* no-op */ }
      }
      if (activeRecognizer?.instanceId === instanceIdRef.current) {
        activeRecognizer = null;
      }
    };
  }, []);

  return {
    liveTranscript,
    clearTranscript,
    handleSpeechResult,
    isListening,
    startListening,
    stopListening,
    micState,
    error,
  };
};
