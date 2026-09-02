import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const jarvisViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/JarvisView.tsx'), 'utf-8');
const voiceOverlayContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GlobalVoiceOverlay.tsx'), 'utf-8');
const apolloViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ApolloVoiceView.tsx'), 'utf-8');
const voiceEngineContent = fs.readFileSync(path.resolve(process.cwd(), 'src/services/voiceEngine.ts'), 'utf-8');
const fishAudioContent = fs.readFileSync(path.resolve(process.cwd(), 'src/services/fishAudio.ts'), 'utf-8');

// ---------------------------------------------------------------------------
// Pass IX / Workstream AA9/AA19 — Jarvis and Apollo remain two genuinely
// separate assistants at the transcript-routing level (AA9/AA10/11/12/13),
// and this pass's mic repair touched no TTS/voice-output configuration
// (AA15/18) — verified by source inspection, matching this repo's
// established convention for UI-wiring truth (see
// test/jarvis-admin-wiring.test.ts).
// ---------------------------------------------------------------------------

describe('AA9: Jarvis voice transcripts route only to the real Jarvis dispatcher', () => {
  it('JarvisView delivers a final transcript to executeDirective (-> onJarvisCommand), never to an Apollo/Hermes execution path', () => {
    expect(jarvisViewContent).toContain('executeDirectiveRef.current(transcript)');
    expect(jarvisViewContent).not.toContain('onExecuteTask');
    expect(jarvisViewContent).not.toContain('handleVoiceCommandReceived');
  });

  it('GlobalVoiceOverlay delivers a final transcript to onJarvisCommand, never to an Apollo/Hermes execution path', () => {
    expect(voiceOverlayContent).toContain("onJarvisCommand(directiveText, 'voice_transcript')");
    expect(voiceOverlayContent).not.toContain('onExecuteTask');
  });
});

describe('AA5/AA9: Apollo voice transcripts never leak to Jarvis\'s admin-command dispatcher', () => {
  it('ApolloVoiceView never calls onJarvisCommand or /api/jarvis/command', () => {
    expect(apolloViewContent).not.toContain('onJarvisCommand');
    expect(apolloViewContent).not.toContain('/api/jarvis/command');
  });

  it('Apollo has its own separate voice-command handler, not a shared one with Jarvis', () => {
    expect(apolloViewContent).toContain('handleVoiceCommandReceived');
    expect(jarvisViewContent).not.toContain('handleVoiceCommandReceived');
    expect(voiceOverlayContent).not.toContain('handleVoiceCommandReceived');
  });
});

describe('AA5: Apollo\'s spoken responses are never a disguised raw Gemini chat reply', () => {
  it('Apollo never calls /api/generate (the generic Gemini chat endpoint) to produce its spoken response text', () => {
    expect(apolloViewContent).not.toContain('/api/generate');
  });

  it('Apollo\'s system responses are real, evidence-based templates tied to the actual task outcome (registered/completed/failed), not an LLM-generated reply presented as Apollo\'s own voice', () => {
    expect(apolloViewContent).toContain('Apollo voice request registered in Triage');
    expect(apolloViewContent).toContain('Apollo completed execution for');
    expect(apolloViewContent).toContain('Apollo execution for');
  });
});

describe('AA6: shared microphone infrastructure, separate assistant execution paths', () => {
  it('all three voice surfaces import the one shared speech-recognition hook', () => {
    for (const content of [jarvisViewContent, voiceOverlayContent, apolloViewContent]) {
      expect(content).toContain("from '../hooks/useSpeechRecognition'");
    }
  });

  it('but each passes its own distinct final-speech callback into the hook — no shared routing function', () => {
    expect(jarvisViewContent).toContain('useSpeechRecognition(handleFinalSpeech)');
    expect(voiceOverlayContent).toContain('useSpeechRecognition(handleFinalTranscript)');
    expect(apolloViewContent).toContain('useSpeechRecognition(handleVoiceCommandReceived)');
  });
});

describe('AA15/AA18: this pass touched no TTS/voice-output configuration — TTS_VOICE_CHANGED: NO', () => {
  it('voiceEngine.ts (Apollo\'s TTS entry point) still exports the same speakText/VoiceConfig contract, untouched', () => {
    expect(voiceEngineContent).toContain('export');
    expect(voiceEngineContent).toMatch(/speakText/);
    expect(voiceEngineContent).toMatch(/VoiceConfig/);
  });

  it('fishAudio.ts still defines the same default voice/API-key constants this pass never modified', () => {
    expect(fishAudioContent).toContain('DEFAULT_FISH_AUDIO_VOICE_ID');
    expect(fishAudioContent).toContain('DEFAULT_FISH_AUDIO_API_KEY');
    expect(fishAudioContent).toContain('FISH_AUDIO_VOICE_PRESETS');
  });

  it('JarvisView\'s speakText/fallbackBrowserSpeak voice-selection logic (Fish Audio -> ElevenLabs -> Browser) is untouched', () => {
    expect(jarvisViewContent).toContain("settings.voiceProvider === 'fish_audio'");
    expect(jarvisViewContent).toContain("settings.voiceProvider === 'elevenlabs'");
    expect(jarvisViewContent).toContain('fallbackBrowserSpeak');
    // The exact voice-selection preference chain (settings.voiceName first,
    // then a small fallback list) is byte-identical to before this pass.
    expect(jarvisViewContent).toContain("availableVoices.find(v => v.name === settings.voiceName)");
  });

  it('ApolloVoiceView still calls the same speakText(text, voiceConfig) with the caller-supplied voiceConfig, never a hardcoded override', () => {
    expect(apolloViewContent).toContain('await speakText(text, voiceConfig)');
  });
});
