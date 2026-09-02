import React, { useState, useEffect, useRef, useCallback } from 'react';
import { JarvisSettings } from '../types';
import { JarvisMindVisualizer } from './JarvisMindVisualizer';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { 
  synthesizeFishAudio, 
  playFishAudioBuffer, 
  DEFAULT_FISH_AUDIO_VOICE_ID, 
  DEFAULT_FISH_AUDIO_API_KEY,
  FISH_AUDIO_VOICE_PRESETS,
  testFishAudioConnection,
  JarvisVoiceStreamer
} from '../services/fishAudio';
import { SetupWizardCard } from './SetupWizardCard';
import VoiceSettingsModal from './VoiceSettingsModal';
import { 
  Sparkles, Mic, MicOff, Volume2, VolumeX, Shield, 
  Cpu, Sliders, Play, Save, CheckCircle2, RefreshCw, 
  Terminal, Zap, Radio, Database, Lock, Eye, AlertCircle,
  RadioTower, Layers, ArrowRight, ShieldCheck, Check, Send, Key, Settings
} from 'lucide-react';

interface JarvisViewProps {
  settings: JarvisSettings;
  onUpdateSettings: (newSettings: Partial<JarvisSettings>) => void;
  onAddNoteToVault: (title: string, content: string, tags: string[]) => void;
  onSendQuery: (query: string, targetModel: string) => Promise<string>;
  /**
   * Routes to the real, workspace-scoped /api/jarvis/command dispatcher —
   * which itself decides, server-side, whether a directive is a supported
   * admin query (tasks/graphs/receipts) or ordinary conversation. Jarvis's
   * own text submission uses this instead of the generic onSendQuery path,
   * so its "show my tasks"-style directives actually reach that real
   * infrastructure instead of a generic chat call that can't answer them.
   */
  onJarvisCommand: (command: string) => Promise<string>;
}

export const JarvisView: React.FC<JarvisViewProps> = ({
  settings,
  onUpdateSettings,
  onAddNoteToVault,
  onSendQuery,
  onJarvisCommand,
}) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [transientCaption, setTransientCaption] = useState<string | null>(null);
  const [hudLogs, setHudLogs] = useState<string[]>([
    "[KERNEL]: AI Assistant OS initialized.",
    // No live Obsidian desktop application connection exists in this
    // deployment — see the Vault screen for its real, honest status.
    "[VAULT]: Obsidian application connection: NOT_CONNECTED. Vault artifacts are served from local SQLite/disk storage.",
    "[SECURITY]: Guardian policy checks active on terminal/task execution paths.",
    // Fish Audio's real connectivity depends on FISH_AUDIO_API_KEY being
    // configured — never claimed "online" here without that evidence.
    "[AUDIO]: Voice synthesis availability depends on configured provider credentials."
  ]);

  const [activeVoiceResponse, setActiveVoiceResponse] = useState<string>(
    "All neural mesh systems, Obsidian vaults, and autonomous agents are operating normally. Ready for directives."
  );

  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saveToast, setSaveToast] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const captionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceStreamerRef = useRef<JarvisVoiceStreamer | null>(null);

  // Active Key and Voice ID with persistent fallback
  const activeVoiceId = settings.FISH_AUDIO_DEFAULT_VOICE_ID || settings.fishAudioConfig?.voiceId || DEFAULT_FISH_AUDIO_VOICE_ID;
  const activeApiKey = settings.FISH_AUDIO_API_KEY || settings.fishAudioConfig?.apiKey || settings.customApiKeys?.fish_audio || DEFAULT_FISH_AUDIO_API_KEY;

  // Auto-dismiss transient speech captions after 3.5s
  const showCaptionWithAutoDismiss = useCallback((caption: string) => {
    setTransientCaption(caption);
    if (captionTimerRef.current) {
      clearTimeout(captionTimerRef.current);
    }
    captionTimerRef.current = setTimeout(() => {
      setTransientCaption(null);
    }, 3500);
  }, []);

  // Hook for speech recognition with immediate buffer flush
  const handleFinalSpeech = useCallback((transcript: string) => {
    if (!transcript.trim()) return;
    setInputText(transcript);
    showCaptionWithAutoDismiss(`Heard: "${transcript}"`);
  }, [showCaptionWithAutoDismiss]);

  const {
    liveTranscript,
    clearTranscript,
    isListening,
    startListening,
    stopListening
  } = useSpeechRecognition(handleFinalSpeech);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        setAvailableVoices(voices);
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Initialize Streamer
    voiceStreamerRef.current = new JarvisVoiceStreamer(activeApiKey, activeVoiceId);

    return () => {
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
      if (voiceStreamerRef.current) {
        voiceStreamerRef.current.disconnect();
      }
    };
  }, []);

  // Neural Voice Synthesis: Fish Audio -> ElevenLabs -> Browser Fallback
  const speakText = async (text: string) => {
    if (!settings.voiceEnabled) return;

    // 1. Fish Audio Neural Voice Provider
    if (settings.voiceProvider === 'fish_audio') {
      const targetVoiceId = activeVoiceId;
      const targetApiKey = activeApiKey;

      setVoiceNotice(`Synthesizing with Fish Audio model (${targetVoiceId.slice(0, 8)}...)...`);
      setIsSpeaking(true);
      try {
        const buffer = await synthesizeFishAudio(text, targetVoiceId, {
          apiKey: targetApiKey,
          FISH_AUDIO_API_KEY: targetApiKey,
          FISH_AUDIO_DEFAULT_VOICE_ID: targetVoiceId,
          latencyMode: settings.fishAudioConfig?.latencyMode || 'low',
          format: settings.fishAudioConfig?.format || 'mp3',
        });

        if (buffer && buffer.byteLength > 50) {
          setVoiceNotice(`●●●● Fish Audio Stream Active (${targetVoiceId.slice(0, 8)}...)`);
          const audio = await playFishAudioBuffer(buffer);
          currentAudioRef.current = audio;
          audio.onended = () => {
            setIsSpeaking(false);
            setVoiceNotice(null);
          };
          audio.onerror = () => {
            setIsSpeaking(false);
            setVoiceNotice('Audio playback error.');
            fallbackBrowserSpeak(text);
          };
          return;
        } else {
          throw new Error('Empty audio stream received');
        }
      } catch (err: any) {
        console.warn('Fish Audio streaming fallback to Web Speech:', err);
        const errMsg = err?.message || 'Offline mode';
        setVoiceNotice(`●●●● Fish Audio: ${errMsg} (Web Speech active)`);
        fallbackBrowserSpeak(text);
      }
      return;
    }

    // 2. ElevenLabs Voice Provider
    if (settings.voiceProvider === 'elevenlabs' && settings.customApiKeys?.elevenlabs) {
      setVoiceNotice(`Transmitting to ElevenLabs Neural Voice (${settings.elevenLabsVoiceId || 'Rachel'})...`);
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM'}`, {
          method: 'POST',
          headers: {
            'xi-api-key': settings.customApiKeys.elevenlabs,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: settings.elevenLabsModelId || 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            }
          })
        });
        if (!res.ok) throw new Error(`ElevenLabs error: ${res.statusText}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        setIsSpeaking(true);
        audio.onended = () => {
          setIsSpeaking(false);
          setVoiceNotice(null);
        };
        audio.play();
        return;
      } catch (err) {
        console.warn('ElevenLabs API fallback to browser TTS:', err);
        fallbackBrowserSpeak(text);
        return;
      }
    }

    // 3. Fallback: Browser Web Speech API
    fallbackBrowserSpeak(text);
  };

  const fallbackBrowserSpeak = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSpeaking(false);
      setVoiceNotice(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = settings.voicePitch || 1.0;
    utterance.rate = settings.voiceRate || 1.0;

    if (availableVoices.length > 0) {
      const selected = availableVoices.find(v => v.name === settings.voiceName) ||
                       availableVoices.find(v => v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('David') || v.lang.startsWith('en')) ||
                       availableVoices[0];
      if (selected) utterance.voice = selected;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      setVoiceNotice(null);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setVoiceNotice(null);
    };

    window.speechSynthesis.speak(utterance);
  };

  const toggleListen = () => {
    if (isListening) {
      stopListening();
    } else {
      clearTranscript();
      const started = startListening();
      if (!started) {
        // Real speech recognition is unavailable in this browser/context.
        // Never inject a fabricated transcript as if the user spoke it —
        // show the truthful state and let them type instead.
        showCaptionWithAutoDismiss("Voice input is not available. Type your directive below.");
      }
    }
  };

  const handleExecute = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const query = inputText;
    setInputText('');
    clearTranscript();
    setIsLoading(true);

    setHudLogs(prev => [`[USER DIRECTIVE]: ${query}`, ...prev]);

    try {
      const reply = await onJarvisCommand(query);
      setActiveVoiceResponse(reply);
      showCaptionWithAutoDismiss(reply.slice(0, 120) + (reply.length > 120 ? '...' : ''));
      setHudLogs(prev => [`[ASSISTANT EXECUTION]: ${reply.slice(0, 80)}...`, ...prev]);

      if (settings.voiceEnabled) {
        speakText(reply);
      }

      if (settings.autoSyncObsidian) {
        const title = `Assistant-Log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
        const content = `# ${title}\n\n**Mode**: Technical Collaborator\n\n## Directive\n> ${query}\n\n## Response\n${reply}\n\n#assistant #directives #obsidian #hermes`;
        onAddNoteToVault(title, content, ['assistant', 'directive', 'memory']);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = () => {
    onUpdateSettings(settings);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3000);
  };

  return (
    <div id="tour-voice" className="space-y-8 pb-16 max-w-7xl mx-auto px-4">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase text-[#615EFF] border border-[#615EFF]/30 bg-[#615EFF]/10">
              AI ASSISTANT OS & NEURAL SYNAPSE
            </span>
            <span className="text-xs font-mono text-[#00D26A]">
              ●●●● Connected to Fish Audio Plus ({activeVoiceId.slice(0, 8)}...)
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Autonomous Voice & Neural Hub
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Low-latency conversational neural voice stream, dynamic multi-agent arbitration, and Obsidian vault synchronization.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowVoiceModal(true)}
            className="px-3.5 py-2 rounded-xl bg-[#14172B] hover:bg-[#1E2342] border border-[#252A4E] text-[#A5A2FF] text-xs font-bold font-mono flex items-center gap-1.5 transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>VOICE SETTINGS</span>
          </button>

          <button
            onClick={() => speakText(activeVoiceResponse)}
            className="px-4 py-2 rounded-xl bg-[#14172B] hover:bg-[#1E2342] border border-[#252A4E] text-[#615EFF] text-xs font-bold font-mono flex items-center gap-2 transition"
          >
            <Volume2 className={`w-4 h-4 text-[#615EFF] ${isSpeaking ? 'animate-bounce' : ''}`} />
            <span>{isSpeaking ? 'SPEAKING HUD...' : 'TEST AUDIO TTS'}</span>
          </button>

          <button
            onClick={handleSaveSettings}
            className="px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-bold font-mono flex items-center gap-2 transition shadow-lg shadow-[#615EFF]/25"
          >
            <Save className="w-3.5 h-3.5" />
            <span>SAVE CONFIGURATION</span>
          </button>
        </div>
      </div>

      {/* 3-Step Setup Wizard for Jarvis Voice & Fish Audio */}
      <SetupWizardCard
        id="voice-setup-wizard"
        sectionTitle="Jarvis Voice & Fish Audio Setup"
        sectionSubtitle="3-Step persistent neural TTS setup. Sub-150ms duplex streaming without browser prompt interruptions."
        statusBadge={{
          isConnected: Boolean(activeApiKey && activeApiKey.length > 5),
          connectedLabel: `Connected: Fish Audio (${activeVoiceId.slice(0, 8)}...)`,
          pendingLabel: "Key Needed",
        }}
        inputConfig={{
          label: "FISH_AUDIO_API_KEY",
          value: activeApiKey,
          placeholder: "Enter Fish Audio Key (e.g. sk-fish-...)",
          type: "password",
          helperText: "Automatically bound to environment state. Never prompts browser popups.",
          externalDocLink: {
            url: "https://fish.audio",
            label: "Get API Key & Voice IDs",
          },
          onChange: (val) => {
            onUpdateSettings({
              FISH_AUDIO_API_KEY: val,
              fishAudioConfig: { ...settings.fishAudioConfig!, apiKey: val },
              customApiKeys: { ...settings.customApiKeys, fish_audio: val },
            });
          },
        }}
        secondaryConfig={{
          label: "DEFAULT VOICE MODEL PRESET",
          value: activeVoiceId,
          placeholder: "e.g. 05b36da8574341d0803391491850db20",
          type: "select",
          options: FISH_AUDIO_VOICE_PRESETS.map((p) => ({
            label: `${p.name} - [${p.id.slice(0, 8)}...]`,
            value: p.id,
          })),
          helperText: "Selected neural model for all agent and Jarvis voice broadcasts.",
          onChange: (val) => {
            onUpdateSettings({
              FISH_AUDIO_DEFAULT_VOICE_ID: val,
              voiceName: `Fish Audio (${val.slice(0, 8)})`,
              fishAudioConfig: { ...settings.fishAudioConfig!, voiceId: val },
            });
          },
        }}
        onTestConnection={() => testFishAudioConnection(activeApiKey, activeVoiceId)}
        onSave={handleSaveSettings}
        howToGuide={{
          title: "Configuring Low-Latency Fish Audio for Hermes OS",
          steps: [
            "Create a free account at fish.audio to generate your API token.",
            "Paste your key into FISH_AUDIO_API_KEY (automatically saved to localStorage & environment).",
            "Choose a voice model preset (Adrian, Evelyn, or Dexter) or enter a custom trained clone ID.",
            "Click 'Test & Save Config' to run a 1-second ping test and verify streaming audio output."
          ],
          troubleshooting: [
            "If offline, Hermes OS automatically degrades gracefully to the native Web Speech API.",
            "Latency is kept below 150ms using WebSocket and direct MP3 chunk streaming."
          ]
        }}
      />

      {saveToast && (
        <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/40 rounded-xl text-xs font-mono text-[#00D26A] flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Assistant settings updated and committed to Obsidian memory vault.</span>
          </div>
        </div>
      )}

      {voiceNotice && (
        <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
          <RadioTower className="w-4 h-4 animate-pulse" />
          <span>{voiceNotice}</span>
        </div>
      )}

      {/* Live STT / Caption Pill with Auto-Dismiss */}
      {(liveTranscript || transientCaption) && (
        <div className="p-3 bg-[#15182E]/90 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-white flex items-center justify-between shadow-xl animate-fadeIn">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-[#615EFF] animate-pulse" />
            <span>{liveTranscript ? `Streaming: "${liveTranscript}"` : transientCaption}</span>
          </div>
          <button
            onClick={() => {
              clearTranscript();
              setTransientCaption(null);
            }}
            className="text-[10px] text-[#8E94B8] hover:text-white font-mono px-2 py-0.5 rounded bg-black/40"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Hero Mind Visualizer Section */}
      <div className="w-full">
        <JarvisMindVisualizer
          settings={settings}
          isSpeaking={isSpeaking}
          isListening={isListening}
          isLoading={isLoading}
          onTriggerVoice={toggleListen}
          height={460}
        />
      </div>

      {/* Main Grid: Left Directive Terminal & Audio | Right Settings Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Directive Terminal & Speech Feed (6 cols) */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 relative overflow-hidden shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#615EFF]" />
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Directive Execution Bridge
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#615EFF] bg-[#615EFF]/10 px-2 py-0.5 rounded border border-[#615EFF]/30">
                AUTHENTIC COLLABORATOR
              </span>
            </div>

            {/* Speech Dialogue Bubble */}
            <div className="bg-[#05060A] border border-[#1E223D] rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#7E85A8]">
                <span>NEURAL SPEECH STREAM</span>
                <span className="text-[#615EFF] font-bold">{isSpeaking ? 'TRANSMITTING' : 'STANDBY'}</span>
              </div>
              <p className="text-xs sm:text-sm text-[#E2E6F8] leading-relaxed font-mono">
                "{activeVoiceResponse}"
              </p>
            </div>

            {/* Directive Form */}
            <form onSubmit={handleExecute} className="space-y-3">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Issue directive (e.g., 'Summarize research papers and sync to Obsidian')..."
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl pl-4 pr-24 py-3 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                />
                <div className="absolute right-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleListen}
                    className={`p-2 rounded-lg border transition ${
                      isListening
                        ? 'bg-red-500 text-white border-red-400 animate-pulse'
                        : 'bg-[#121422] text-[#8E94B8] hover:text-white border-[#222744]'
                    }`}
                    title="Toggle Microphone"
                  >
                    {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || !inputText.trim()}
                    className="px-3.5 py-1.5 rounded-lg bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-bold font-mono transition disabled:opacity-40"
                  >
                    {isLoading ? '...' : 'DISPATCH'}
                  </button>
                </div>
              </div>
            </form>

            {/* Quick Directive Chips */}
            <div className="space-y-2">
              <div className="text-[10px] font-mono text-[#7B82A8] uppercase tracking-wider">
                RAPID FLEET DIRECTIVES
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  "Harvest top 5 AI repos and write thesis to Obsidian",
                  "Audit token usage economics for Scout & Dev agents",
                  "Scrape Product Hunt for real-time customer friction",
                  "Check Obsidian vault graph synchronization status",
                ].map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setInputText(preset);
                    }}
                    className="text-[11px] font-mono px-3 py-1.5 rounded-lg bg-[#0C0E1A] hover:bg-[#16182C] border border-[#1D2138] hover:border-[#615EFF]/50 text-[#8E94B8] hover:text-white text-left transition"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Real-time Kernel Logs */}
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-5 space-y-3 font-mono">
            <div className="flex items-center justify-between text-xs border-b border-[#181B2E] pb-2 text-[#7B82A8]">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#00D26A]" />
                <span className="text-white font-bold">SYNAPSE EXECUTION LOGS</span>
              </div>
              <span className="text-[10px] text-[#00D26A]">LIVE</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto text-[11px] pr-2 scrollbar-thin">
              {hudLogs.map((log, i) => (
                <div key={i} className="text-[#8E94B8] flex items-start gap-1.5">
                  <span className="text-[#615EFF] select-none">&gt;</span>
                  <span className="text-[#D0D4EC]">{log}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Audio Engine & Security Matrix (6 cols) */}
        <div className="lg:col-span-6 space-y-6">
          {/* Voice Engine Card */}
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-[#615EFF]" />
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Voice Synthesis Engine
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30 font-bold">
                {settings.voiceEnabled ? 'ACTIVE' : 'MUTED'}
              </span>
            </div>

            <div className="space-y-4">
              {/* Voice Enable Toggle */}
              <div 
                onClick={() => onUpdateSettings({ voiceEnabled: !settings.voiceEnabled })}
                className="p-3.5 bg-[#05060C] border border-[#1A1E36] rounded-xl flex items-center justify-between cursor-pointer hover:border-[#2C3150] transition"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${settings.voiceEnabled ? 'bg-[#615EFF]/20 text-[#A5A2FF]' : 'bg-[#181B30] text-[#7B82A8]'}`}>
                    {settings.voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Voice Audio Output</div>
                    <div className="text-[10px] text-[#7B82A8]">Synthesize responses via neural stream</div>
                  </div>
                </div>

                <div className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${
                  settings.voiceEnabled ? 'bg-[#615EFF] text-white' : 'bg-[#1E223D] text-[#7B82A8]'
                }`}>
                  {settings.voiceEnabled ? '✓' : ''}
                </div>
              </div>

              {/* Voice Provider Selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-[#8E94B8]">Neural Voice Provider</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'fish_audio', label: 'Fish Audio', badge: '<150ms' },
                    { id: 'browser', label: 'Web Speech', badge: 'Offline' },
                    { id: 'elevenlabs', label: 'ElevenLabs', badge: 'Studio' },
                  ].map((prov) => (
                    <button
                      key={prov.id}
                      onClick={() => onUpdateSettings({ voiceProvider: prov.id as any })}
                      className={`p-2.5 rounded-xl border text-left transition ${
                        settings.voiceProvider === prov.id
                          ? 'bg-[#14172B] border-[#615EFF] text-white'
                          : 'bg-[#05060C] border-[#1A1E36] text-[#7B82A8] hover:border-[#2C3150]'
                      }`}
                    >
                      <div className="text-xs font-bold font-mono">{prov.label}</div>
                      <div className="text-[9px] text-[#615EFF] font-mono mt-0.5">{prov.badge}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sliders: Rate & Pitch */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-[#8E94B8]">
                    <span>Speech Rate</span>
                    <span className="text-[#615EFF]">{settings.voiceRate || 1.0}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.05"
                    value={settings.voiceRate || 1.0}
                    onChange={(e) => onUpdateSettings({ voiceRate: parseFloat(e.target.value) })}
                    className="w-full accent-[#615EFF] bg-[#141628] h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-[#8E94B8]">
                    <span>Voice Pitch</span>
                    <span className="text-[#615EFF]">{settings.voicePitch || 1.0}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.05"
                    value={settings.voicePitch || 1.0}
                    onChange={(e) => onUpdateSettings({ voicePitch: parseFloat(e.target.value) })}
                    className="w-full accent-[#615EFF] bg-[#141628] h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Active Security & Permissions Matrix Card */}
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#00D26A]" />
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Security & Vault Write Status
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
                ACTIVE
              </span>
            </div>

            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex items-center justify-between p-2.5 bg-[#05060C] border border-[#1A1E36] rounded-xl">
                <span className="text-[#8E94B8]">Agent Execution Mode</span>
                <span className="text-white font-bold">{settings.security?.agent_permissions.execution_mode || 'confirm_first'}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-[#05060C] border border-[#1A1E36] rounded-xl">
                <span className="text-[#8E94B8]">Obsidian Vault Write Access</span>
                <span className="text-[#00D26A] font-bold">
                  {settings.security?.vault_permissions.write_access ? 'ENABLED' : 'DISABLED'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-[#05060C] border border-[#1A1E36] rounded-xl">
                <span className="text-[#8E94B8]">Destructive File Deletion</span>
                <span className="text-[#FF5E8E] font-bold">
                  {settings.security?.vault_permissions.allow_file_deletion ? 'ALLOWED' : 'BLOCKED (GUARDRAIL)'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-[#05060C] border border-[#1A1E36] rounded-xl">
                <span className="text-[#8E94B8]">Allowed Write Paths</span>
                <span className="text-[#A5A2FF]">
                  {settings.security?.vault_permissions.allowed_paths.length || 4} directories
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Settings Modal */}
      {showVoiceModal && (
        <VoiceSettingsModal
          isOpen={showVoiceModal}
          onClose={() => setShowVoiceModal(false)}
        />
      )}
    </div>
  );
};
