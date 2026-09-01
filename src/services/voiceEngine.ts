/**
 * Voice Engine Client Service
 * Supports Fish Audio, ElevenLabs, OpenAI TTS, and native Web Speech API
 */

export interface VoiceConfig {
  provider: 'fish_audio' | 'elevenlabs' | 'openai' | 'openai_realtime' | 'web_speech';
  apiKey?: string;
  voiceId?: string;
  speed?: number;
}

export async function speakText(text: string, config: VoiceConfig): Promise<void> {
  // If Web Speech is explicitly selected
  if (config.provider === 'web_speech') {
    return playWebSpeech(text, config.speed);
  }

  try {
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        provider: config.provider,
        apiKey: config.apiKey,
        voiceId: config.voiceId,
        speed: config.speed || 1.0,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'TTS synthesis failed' }));
      console.warn(`[Voice Engine] ${config.provider} API response not ok (${res.status}):`, err.error || err);
      // Fallback to client-side Web Speech synthesis immediately
      return playWebSpeech(text, config.speed);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('audio') && !contentType.includes('octet-stream')) {
      return playWebSpeech(text, config.speed);
    }

    const blob = await res.blob();
    if (blob.size < 50) {
      return playWebSpeech(text, config.speed);
    }

    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    
    return new Promise((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        playWebSpeech(text, config.speed).then(resolve);
      };
      audio.play().catch(() => {
        URL.revokeObjectURL(audioUrl);
        playWebSpeech(text, config.speed).then(resolve);
      });
    });
  } catch (error) {
    console.warn(`[Voice Engine] ${config.provider} caught error, falling back to Web Speech:`, error);
    return playWebSpeech(text, config.speed);
  }
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
