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
  RadioTower, Layers, ArrowRight, ShieldCheck, Check, Send, Key, Settings,
  History, Plus, X, Loader2
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
  onJarvisCommand: (command: string, messageType?: 'text' | 'voice_transcript') => Promise<string>;
  /** Real workspace-scoped session history — see lib/jarvis-sessions.ts. */
  activeWorkspaceId?: string;
  /** Starts a fresh Jarvis session on the next directive. */
  onNewJarvisSession?: () => void;
}

export const JarvisView: React.FC<JarvisViewProps> = ({
  settings,
  onUpdateSettings,
  onAddNoteToVault,
  onSendQuery,
  onJarvisCommand,
  activeWorkspaceId,
  onNewJarvisSession,
}) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';
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

  // Real Jarvis session history — see lib/jarvis-sessions.ts. A modest
  // surface only: New Chat + a list of recent real sessions + a real
  // transcript viewer for one of them. Independent of the live hudLogs
  // feed above, which stays untouched.
  interface JarvisSessionSummary {
    session_id: string;
    title: string | null;
    updated_at: string;
    messageCount: number;
    lastMessagePreview: string | null;
  }
  interface JarvisTranscriptMessage {
    message_id: string;
    role: 'user' | 'assistant';
    content: string;
    message_type: string;
    created_at: string;
  }
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [recentSessions, setRecentSessions] = useState<JarvisSessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [openTranscript, setOpenTranscript] = useState<{ sessionId: string; title: string | null; messages: JarvisTranscriptMessage[] } | null>(null);

  const fetchRecentSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch(`/api/jarvis/sessions?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      setRecentSessions(res.ok && data.success !== false ? (data.sessions || []) : []);
    } catch {
      setRecentSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (showSessionHistory) fetchRecentSessions();
  }, [showSessionHistory, fetchRecentSessions]);

  const handleOpenTranscript = async (sessionId: string, title: string | null) => {
    try {
      const res = await fetch(`/api/jarvis/sessions/${encodeURIComponent(sessionId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setOpenTranscript({ sessionId, title, messages: data.messages || [] });
      }
    } catch {
      // Real network failure — leave the transcript viewer closed rather
      // than showing a fabricated one.
    }
  };

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

  // AA4/AA10 — a final spoken transcript is delivered through the exact
  // same dispatcher a typed directive uses (executeDirectiveRef, defined
  // below — a plain-assignment ref, not a hook, so it's safe to reference
  // here ahead of its definition), completing the required
  // capture -> transcript -> dispatch -> response flow automatically,
  // rather than only populating the text box and waiting for a manual
  // click. clearTranscript() empties the interim-transcript display; the
  // hook's own dedup guard (lastFinalRef) already prevents a duplicate
  // final result from dispatching twice.
  const handleFinalSpeech = useCallback((transcript: string) => {
    if (!transcript.trim()) return;
    setInputText('');
    clearTranscript();
    showCaptionWithAutoDismiss(`Heard: "${transcript}"`);
    executeDirectiveRef.current(transcript);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearTranscript
    // is declared below (destructured from useSpeechRecognition, which this
    // very callback is passed into) and is referentially stable across
    // renders (see useSpeechRecognition's own useCallback with []), so it's
    // safe to omit here — listing it would be a genuine reference-before-
    // declaration error in the dependency array (unlike the callback body
    // above, which only runs later and by then it's assigned).
  }, [showCaptionWithAutoDismiss]);

  const {
    liveTranscript,
    clearTranscript,
    isListening,
    startListening,
    stopListening,
    micState,
    error: micError,
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
        showCaptionWithAutoDismiss(
          micState === 'unsupported'
            ? "This browser doesn't support voice input. Type your directive below."
            : "Voice input is not available. Type your directive below."
        );
      }
    }
  };

  // AA7/AA11 — a real browser error (permission denied, no device, etc.)
  // arriving mid-session, surfaced honestly rather than only console-logged.
  useEffect(() => {
    if (micError && (micState === 'permission-denied' || micState === 'no-device' || micState === 'error')) {
      showCaptionWithAutoDismiss(micError.message);
    }
  }, [micError, micState, showCaptionWithAutoDismiss]);

  // AA4 — the one real dispatcher, shared by typed submission and voice
  // transcript delivery, so a spoken directive reaches the exact same
  // authenticated /api/jarvis/command path (via onJarvisCommand) with the
  // same admin-intent routing as typed input — never a separate,
  // parallel voice-only code path.
  const executeDirective = useCallback(async (query: string) => {
    if (!query.trim() || isLoading) return;

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
  }, [isLoading, onJarvisCommand, settings.voiceEnabled, settings.autoSyncObsidian, onAddNoteToVault, showCaptionWithAutoDismiss]);

  const handleExecute = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    const query = inputText;
    setInputText('');
    clearTranscript();
    await executeDirective(query);
  };

  // Always-fresh reference to the latest executeDirective closure — plain
  // assignment during render (not a useEffect) is intentional: it only
  // needs to be current by the time the next browser speech-recognition
  // event fires, which is always after this render completes.
  const executeDirectiveRef = useRef(executeDirective);
  executeDirectiveRef.current = executeDirective;

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
            {activeApiKey && activeApiKey.length > 5 ? (
              <span className="text-xs font-mono text-[#00D26A]">
                ●●●● Fish Audio credentials configured ({activeVoiceId.slice(0, 8)}...)
              </span>
            ) : (
              <span className="text-xs font-mono text-[#7E8BB5]">
                ○○○○ Fish Audio: NOT_CONFIGURED — falls back to browser speech synthesis
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Autonomous Voice & Neural Hub
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Low-latency conversational neural voice stream, dynamic multi-agent arbitration, and Obsidian vault synchronization.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onNewJarvisSession && (
            <button
              onClick={() => { onNewJarvisSession(); setShowSessionHistory(false); }}
              title="Start a new Jarvis session"
              className="px-3.5 py-2 rounded-xl bg-[#14172B] hover:bg-[#1E2342] border border-[#252A4E] text-[#A5A2FF] text-xs font-bold font-mono flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>NEW CHAT</span>
            </button>
          )}

          <button
            onClick={() => setShowSessionHistory((v) => !v)}
            title="Recent Jarvis sessions"
            className={`px-3.5 py-2 rounded-xl border text-xs font-bold font-mono flex items-center gap-1.5 transition cursor-pointer ${
              showSessionHistory ? 'bg-[#615EFF]/20 border-[#615EFF] text-white' : 'bg-[#14172B] hover:bg-[#1E2342] border-[#252A4E] text-[#A5A2FF]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>HISTORY</span>
          </button>

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

      {/* Real, workspace-scoped session history — see lib/jarvis-sessions.ts */}
      {showSessionHistory && (
        <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-[#615EFF]" />
              Recent Sessions — Workspace: {workspaceId}
            </span>
            <button onClick={fetchRecentSessions} className="text-[#8E94B8] hover:text-white cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {isLoadingSessions ? (
            <div className="flex items-center gap-2 text-xs text-[#8E94B8] py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading sessions…
            </div>
          ) : recentSessions.length === 0 ? (
            <p className="text-xs text-[#5F6589] text-center py-4">No prior Jarvis sessions exist for this workspace yet.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recentSessions.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => handleOpenTranscript(s.session_id, s.title)}
                  className="w-full text-left p-3 rounded-xl bg-[#080911] border border-[#161828] hover:border-[#615EFF] transition cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white truncate">{s.title || 'Untitled session'}</span>
                    <span className="text-[10px] text-[#5F6589] shrink-0">{new Date(s.updated_at).toLocaleString()}</span>
                  </div>
                  <p className="text-[11px] text-[#8E94B8] mt-1 line-clamp-1">{s.lastMessagePreview || 'No messages yet.'}</p>
                  <span className="text-[10px] text-[#5F6589]">{s.messageCount} message(s)</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Real session transcript viewer */}
      {openTranscript && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0B0D18] border border-[#252A4E] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[#1E2238]">
              <span className="text-sm font-bold text-white font-mono">{openTranscript.title || 'Untitled session'}</span>
              <button onClick={() => setOpenTranscript(null)} className="text-[#8E94B8] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              {openTranscript.messages.length === 0 ? (
                <p className="text-xs text-[#5F6589] text-center py-6">No messages recorded in this session.</p>
              ) : (
                openTranscript.messages.map((m) => (
                  <div key={m.message_id} className={`p-3 rounded-xl text-xs ${m.role === 'user' ? 'bg-[#14172B] border border-[#252A4E]' : 'bg-[#615EFF]/10 border border-[#615EFF]/30'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-bold font-mono ${m.role === 'user' ? 'text-[#A5A2FF]' : 'text-[#615EFF]'}`}>
                        {m.role === 'user' ? 'USER' : 'JARVIS'}{m.message_type === 'voice_transcript' ? ' (voice)' : ''}
                      </span>
                      <span className="text-[10px] text-[#5F6589]">{new Date(m.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-[#E2E8F0] whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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
                    disabled={micState === 'unsupported'}
                    className={`p-2 rounded-lg border transition ${
                      micState === 'unsupported'
                        ? 'bg-[#121422] text-[#4A4F6E] border-[#1A1E36] cursor-not-allowed'
                        : isListening
                          ? 'bg-red-500 text-white border-red-400 animate-pulse'
                          : micState === 'permission-denied' || micState === 'no-device' || micState === 'error'
                            ? 'bg-[#3A1A2C] text-red-400 border-red-500/40'
                            : 'bg-[#121422] text-[#8E94B8] hover:text-white border-[#222744]'
                    }`}
                    title={
                      micState === 'unsupported' ? "Voice input not supported in this browser"
                      : micState === 'permission-denied' ? 'Microphone permission denied — click to try again'
                      : micState === 'no-device' ? 'No microphone detected — click to try again'
                      : 'Toggle Microphone'
                    }
                  >
                    {micState === 'unsupported' ? <MicOff className="w-3.5 h-3.5" />
                      : isListening ? <MicOff className="w-3.5 h-3.5" />
                      : (micState === 'permission-denied' || micState === 'no-device' || micState === 'error') ? <AlertCircle className="w-3.5 h-3.5" />
                      : <Mic className="w-3.5 h-3.5" />}
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
