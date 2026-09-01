import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ActiveTab, ObsidianNote } from '../types';
import { 
  Search, Terminal, Database, Bot, Sparkles, 
  Layers, ArrowRight, Zap, X, Brain, Code2, Globe, 
  Compass, Kanban, Network, Crown, BarChart3, PenTool, Rocket,
  Mic, MicOff, Volume2, Radio, Check, MessageSquare, Clock, BookOpen, Share2, Activity,
  GitMerge, Shield
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: ActiveTab) => void;
  notes: ObsidianNote[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  notes,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Speech Recognition States
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [audioWaveLevels, setAudioWaveLevels] = useState<number[]>([4, 8, 12, 16, 12, 8, 4]);
  const [executedNotice, setExecutedNotice] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const audioIntervalRef = useRef<any>(null);
  const isHoldingRef = useRef<boolean>(false);
  const latestTranscriptRef = useRef<string>('');

  const quickActions: Array<{
    id: ActiveTab;
    label: string;
    category: string;
    icon: React.ReactNode;
    keywords: string[];
  }> = useMemo(() => [
    { 
      id: 'overview', 
      label: 'Open Mission Control', 
      category: 'Mission Control', 
      icon: <Layers className="w-4 h-4 text-[#A5A2FF]" />,
      keywords: ['mission control', 'overview', 'dashboard', 'hq', 'command center']
    },
    { 
      id: 'agent-fleet', 
      label: 'Open Workforce Overview', 
      category: 'Workforce', 
      icon: <Bot className="w-4 h-4 text-[#EC4899]" />,
      keywords: ['agents', 'fleet', 'workforce', 'orchestrator', 'scout', 'scribe', 'reach', 'dev', 'analytics', 'openclaw']
    },
    { 
      id: 'hermes-core', 
      label: 'Open Hermes Workspace', 
      category: 'Workforce', 
      icon: <Sparkles className="w-4 h-4 text-[#615EFF]" />,
      keywords: ['hermes', 'workspace', 'agent workspace', 'objective', 'command']
    },
    { 
      id: 'kanban', 
      label: 'Open Tasks Board', 
      category: 'Flows', 
      icon: <Kanban className="w-4 h-4 text-[#00D26A]" />,
      keywords: ['tasks', 'kanban', 'flows', 'backlog', 'doing', 'done', 'dependencies']
    },
    { 
      id: 'graph-builder', 
      label: 'Open Graph Builder', 
      category: 'Flows', 
      icon: <GitMerge className="w-4 h-4 text-[#8C8AFF]" />,
      keywords: ['graph builder', 'flows', 'workflow', 'dag', 'nodes', 'edges', 'canvas', 'pipeline', 'execution']
    },
    { 
      id: 'graph-runs', 
      label: 'Open Graph Runs', 
      category: 'Flows', 
      icon: <Activity className="w-4 h-4 text-[#38BDF8]" />,
      keywords: ['graph runs', 'flows', 'execution', 'telemetry', 'logs', 'history', 'trace']
    },
    { 
      id: 'bot-mode', 
      label: 'Open Automation', 
      category: 'Flows', 
      icon: <Clock className="w-4 h-4 text-[#EAB308]" />,
      keywords: ['automation', 'cron', 'schedules', 'jobs', 'bot mode', 'autonomous', 'timers']
    },
    { 
      id: 'model-router', 
      label: 'Open Model Router', 
      category: 'Models', 
      icon: <Network className="w-4 h-4 text-[#38BDF8]" />,
      keywords: ['model router', 'models', 'providers', 'stacking', 'openrouter', 'cost', 'latency', 'gemini', 'openai', 'claude', 'deepseek', 'kimi']
    },
    { 
      id: 'agent-memory', 
      label: 'Open Memory', 
      category: 'Knowledge', 
      icon: <Database className="w-4 h-4 text-[#EC4899]" />,
      keywords: ['brain', 'memory', 'knowledge', 'long-term', 'vector', 'context']
    },
    { 
      id: 'obsidian', 
      label: 'Open Vault / Obsidian', 
      category: 'Knowledge', 
      icon: <Database className="w-4 h-4 text-[#8C8AFF]" />,
      keywords: ['vault', 'obsidian', 'knowledge', 'notes', 'wikilinks', 'content library', 'memos']
    },
    { 
      id: 'model-router', 
      label: 'Open Model Router', 
      category: 'Models & Tools', 
      icon: <Network className="w-4 h-4 text-[#00D26A]" />,
      keywords: ['model router', 'models', 'providers', 'stacking', 'openrouter', 'cost', 'latency']
    },
    { 
      id: 'skill-registry', 
      label: 'Open Skills & MCP', 
      category: 'Models & Tools', 
      icon: <Terminal className="w-4 h-4 text-[#38BDF8]" />,
      keywords: ['skills', 'mcp', 'tools', 'registry', 'parameters', 'functions']
    },
    { 
      id: 'startup-generator', 
      label: 'Open Intelligence', 
      category: 'Intelligence', 
      icon: <Rocket className="w-4 h-4 text-[#FF5E8E]" />,
      keywords: ['intelligence', 'research', 'signals', 'lead scraper', 'auto content', 'repos']
    },
    { 
      id: 'idea-strategy', 
      label: 'Open Launchpad', 
      category: 'Intelligence', 
      icon: <Zap className="w-4 h-4 text-[#F59E0B]" />,
      keywords: ['launchpad', 'ideas', 'validation', 'gtm', 'studio leadgen', 'triage']
    },
    { 
      id: 'guardian-aegis', 
      label: 'Open Guardian & Aegis', 
      category: 'Governance', 
      icon: <Shield className="w-4 h-4 text-[#EC4899]" />,
      keywords: ['guardian', 'aegis', 'governance', 'policy', 'rules', 'security', 'audit']
    },
    { 
      id: 'receipts', 
      label: 'Open Execution Receipts', 
      category: 'Governance', 
      icon: <Check className="w-4 h-4 text-[#38BDF8]" />,
      keywords: ['receipts', 'governance', 'proofs', 'hashes', 'verification']
    },
    { 
      id: 'activity-ledger', 
      label: 'Open Activity Ledger', 
      category: 'Governance', 
      icon: <Activity className="w-4 h-4 text-[#EAB308]" />,
      keywords: ['activity ledger', 'governance', 'audit log', 'events', 'history']
    },
    { 
      id: 'workspaces', 
      label: 'Open Products / Workspaces', 
      category: 'Workspaces', 
      icon: <Layers className="w-4 h-4 text-[#00D26A]" />,
      keywords: ['workspaces', 'products', 'environments', 'isolation', 'ton network', 'telegram']
    },
    { 
      id: 'system-diagnostics', 
      label: 'Open Infrastructure', 
      category: 'System', 
      icon: <Database className="w-4 h-4 text-[#00D26A]" />,
      keywords: ['infrastructure', 'system', 'diagnostics', 'telemetry', 'health', 'vps']
    },
    { 
      id: 'jarvis', 
      label: 'Open Jarvis Executive Assistant', 
      category: 'System', 
      icon: <Sparkles className="w-4 h-4 text-[#FF5E8E]" />,
      keywords: ['jarvis', 'assistant', 'executive', 'global assistant', 'ai', 'voice', 'hud', 'mind']
    },
    { 
      id: 'settings', 
      label: 'Open Settings', 
      category: 'System', 
      icon: <Terminal className="w-4 h-4 text-[#8E94B8]" />,
      keywords: ['settings', 'config', 'voice', 'curriculum', 'guide', 'preferences']
    },

    // Models
    { 
      id: 'hermes', 
      label: 'Nous Hermes 3 (405B / 70B)', 
      category: 'Model', 
      icon: <Sparkles className="w-4 h-4 text-[#EC4899]" />,
      keywords: ['nous', 'hermes', 'hermes 3', '405b', '70b', 'nous research']
    },
    { 
      id: 'chatgpt', 
      label: 'ChatGPT o3 / GPT-4.5 Ultra', 
      category: 'Model', 
      icon: <Terminal className="w-4 h-4 text-[#10A37F]" />,
      keywords: ['chatgpt', 'openai', 'o3', 'gpt', 'gpt-4.5', 'gpt 4']
    },
    { 
      id: 'deepseek', 
      label: 'DeepSeek R1 Mathematical Proofs', 
      category: 'Model', 
      icon: <Brain className="w-4 h-4 text-[#4D6BFE]" />,
      keywords: ['deepseek', 'r1', 'reasoning', 'math', 'proofs', 'china']
    },
    { 
      id: 'kimi', 
      label: 'Kimi K1.5 (200k-2M Long Context)', 
      category: 'Model', 
      icon: <Layers className="w-4 h-4 text-[#3B82F6]" />,
      keywords: ['kimi', 'k1.5', 'moonshot', 'long context']
    },
    { 
      id: 'claudecode', 
      label: 'Claude Code 3.7 Terminal Agent', 
      category: 'Model', 
      icon: <Terminal className="w-4 h-4 text-[#D97706]" />,
      keywords: ['claude', 'claude code', 'anthropic', 'sonnet', '3.7']
    },
    { 
      id: 'gemini', 
      label: 'Gemini 3.7 / 3.6 Flash Multimodal Studio', 
      category: 'Model', 
      icon: <Sparkles className="w-4 h-4 text-[#615EFF]" />,
      keywords: ['gemini', 'gemini 3.7', 'gemini 3.6', 'google', 'multimodal', 'flash']
    },
    { 
      id: 'antigravity', 
      label: 'Google Antigravity Meta-Agent', 
      category: 'Model', 
      icon: <Compass className="w-4 h-4 text-[#8A5CF5]" />,
      keywords: ['antigravity', 'agent', 'deepmind', 'meta']
    },
    { 
      id: 'perplexity', 
      label: 'Perplexity Sonar Live Citations', 
      category: 'Model', 
      icon: <Globe className="w-4 h-4 text-[#20B2AA]" />,
      keywords: ['perplexity', 'sonar', 'citations', 'search']
    },
    { 
      id: 'codex', 
      label: 'Codex WASM Sandbox Runner', 
      category: 'Model', 
      icon: <Code2 className="w-4 h-4 text-[#00D26A]" />,
      keywords: ['codex', 'wasm', 'sandbox', 'runner']
    },

    // Autonomous & Executive
    { 
      id: 'bot-mode', 
      label: 'BOT MODE Autonomous Swarm Execution', 
      category: 'Autonomous', 
      icon: <Bot className="w-4 h-4 text-[#00D26A]" />,
      keywords: ['bot', 'bot mode', 'autonomous', 'swarm', 'auto execution']
    },
    { 
      id: 'jarvis', 
      label: 'Jarvis Executive Hub & Neural HUD', 
      category: 'Executive', 
      icon: <Sparkles className="w-4 h-4 text-[#EAB308]" />,
      keywords: ['jarvis', 'executive', 'voice', 'hud', 'settings']
    },
    { 
      id: 'settings', 
      label: 'System Settings & API Keys', 
      category: 'Settings', 
      icon: <Activity className="w-4 h-4 text-[#8E94B8]" />,
      keywords: ['settings', 'preferences', 'keys', 'config', 'security']
    }
  ], []);

  // Filter actions based on query
  const filteredActions = useMemo(() => {
    if (!query.trim()) return quickActions;
    const lower = query.toLowerCase().trim();
    return quickActions.filter(a => 
      a.label.toLowerCase().includes(lower) || 
      a.category.toLowerCase().includes(lower) ||
      a.keywords.some(k => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()))
    );
  }, [quickActions, query]);

  // Check speech recognition capability on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setIsSpeechSupported(false);
      }
    }
  }, []);

  // Reset states on open/close
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setSpeechError(null);
      setInterimTranscript('');
      setExecutedNotice(null);
      latestTranscriptRef.current = '';
    } else {
      stopRecording();
    }
  }, [isOpen]);

  // Handle Voice Intent Matching & Execution
  const executeSpokenIntent = (rawTranscript: string) => {
    const text = rawTranscript.trim().toLowerCase();
    if (!text) return;

    // Clean spoken filler words
    const cleanText = text
      .replace(/^(please|can you|could you|i want to|go to|open|show me|navigate to|switch to|jump to|launch)\s+/gi, '')
      .trim();

    // Look for direct action matches
    let matchedAction = quickActions.find(a => 
      cleanText === a.id || 
      cleanText === a.label.toLowerCase() ||
      a.keywords.some(k => cleanText === k.toLowerCase())
    );

    // If no direct exact match, look for inclusion matches
    if (!matchedAction) {
      matchedAction = quickActions.find(a => 
        cleanText.includes(a.id) ||
        cleanText.includes(a.category.toLowerCase()) ||
        a.keywords.some(k => cleanText.includes(k.toLowerCase()))
      );
    }

    if (matchedAction) {
      setExecutedNotice(`Executing Voice Intent: "${matchedAction.label}"`);
      setTimeout(() => {
        onSelectTab(matchedAction!.id);
        onClose();
      }, 500);
    } else {
      // Put spoken text into the search bar so filtered matches appear
      setQuery(cleanText);
      setSelectedIndex(0);
      setExecutedNotice(`Filtered by: "${cleanText}"`);
      setTimeout(() => setExecutedNotice(null), 2500);
    }
  };

  // Start Speech Recognition
  const startRecording = () => {
    if (isRecording) return;
    setSpeechError(null);
    setInterimTranscript('');
    latestTranscriptRef.current = '';
    isHoldingRef.current = true;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError('Speech recognition is not supported in this browser.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecording(true);
        // Start animated audio wave simulation
        audioIntervalRef.current = setInterval(() => {
          setAudioWaveLevels([
            Math.floor(Math.random() * 18) + 4,
            Math.floor(Math.random() * 26) + 6,
            Math.floor(Math.random() * 32) + 8,
            Math.floor(Math.random() * 28) + 6,
            Math.floor(Math.random() * 20) + 4,
            Math.floor(Math.random() * 30) + 8,
            Math.floor(Math.random() * 16) + 4,
          ]);
        }, 80);
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        const currentSpeech = (final || interim).trim();
        if (currentSpeech) {
          setInterimTranscript(currentSpeech);
          latestTranscriptRef.current = currentSpeech;
          setQuery(currentSpeech);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('SpeechRecognition error:', event.error);
        if (event.error === 'not-allowed') {
          setSpeechError('Microphone permission denied. Please allow microphone access.');
        } else if (event.error !== 'no-speech') {
          setSpeechError(`Voice error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
        if (audioIntervalRef.current) {
          clearInterval(audioIntervalRef.current);
        }
        // If the user was holding and released, execute intent
        if (latestTranscriptRef.current.trim()) {
          executeSpokenIntent(latestTranscriptRef.current);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      setSpeechError('Could not initialize microphone recognition.');
      setIsRecording(false);
    }
  };

  // Stop Speech Recognition
  const stopRecording = () => {
    isHoldingRef.current = false;
    if (audioIntervalRef.current) {
      clearInterval(audioIntervalRef.current);
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        // Ignore stop error
      }
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % (filteredActions.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredActions.length) % (filteredActions.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredActions[selectedIndex]) {
        onSelectTab(filteredActions[selectedIndex].id);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-16 sm:pt-24 px-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#090A14] border border-[#222644] rounded-2xl max-w-2xl w-full shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header with Hold to Record Button */}
        <div className="p-4 border-b border-[#1A1D30] flex items-center gap-3 bg-[#0A0B16]">
          <Search className="w-4 h-4 text-[#615EFF] shrink-0" />
          
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type query or hold mic: e.g. 'Open Kanban', 'Launch Startup Scout'..."
            className="flex-1 bg-transparent text-sm text-white placeholder-[#53597D] focus:outline-none font-mono"
            autoFocus
          />

          {/* Hold to Record Button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={() => {
                if (isRecording) stopRecording();
              }}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              onTouchCancel={stopRecording}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-2 transition-all duration-200 select-none ${
                isRecording
                  ? 'bg-gradient-to-r from-[#FF3B70] via-[#615EFF] to-[#00D26A] text-white shadow-lg shadow-[#FF3B70]/40 ring-2 ring-white/30 scale-105 animate-pulse'
                  : 'bg-[#121426] hover:bg-[#1C203C] border border-[#282D4E] text-[#A5A2FF] hover:text-white hover:border-[#615EFF] active:scale-95'
              }`}
              title="Hold down to speak your voice intent. Release to execute."
            >
              {isRecording ? (
                <>
                  <Radio className="w-3.5 h-3.5 text-white animate-spin" />
                  <span className="tracking-wider">RECORDING... (RELEASE)</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-[#615EFF]" />
                  <span>HOLD TO RECORD</span>
                </>
              )}
            </button>

            <button 
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#141628] text-[#8E94B8] hover:text-white text-xs transition"
              title="Close (ESC)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Voice HUD Strip (Active when recording or transcribing) */}
        {isRecording && (
          <div className="px-4 py-3 bg-[#0D0F22] border-b border-[#615EFF]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-white animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center gap-2.5">
              {/* Frequency Bars Visualizer */}
              <div className="flex items-center gap-1 h-5 px-2 bg-[#05060C] rounded-lg border border-[#222744]">
                {audioWaveLevels.map((lvl, idx) => (
                  <span
                    key={idx}
                    className="w-1 bg-gradient-to-t from-[#615EFF] to-[#00D26A] rounded-full transition-all duration-75"
                    style={{ height: `${lvl}px` }}
                  />
                ))}
              </div>

              <div className="truncate">
                <span className="text-[10px] text-[#A5A2FF] block uppercase tracking-wider">
                  Listening to voice intent...
                </span>
                <span className="text-white font-bold text-xs truncate block">
                  "{interimTranscript || 'Speak your intent now (e.g., Open Startup Generator, Show DeepSeek, Go to Kanban)...'}"
                </span>
              </div>
            </div>

            <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 border border-[#00D26A]/30 px-2 py-0.5 rounded-full shrink-0 font-bold self-start sm:self-auto">
              HOLD & SPEAK • RELEASE TO RUN
            </span>
          </div>
        )}

        {/* Executed Intent Notification Toast */}
        {executedNotice && (
          <div className="px-4 py-2.5 bg-[#00D26A]/15 border-b border-[#00D26A]/40 text-xs font-mono text-[#00D26A] flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5" />
              <span className="font-bold">{executedNotice}</span>
            </div>
            <span className="text-[10px] text-[#8E94B8]">Auto-Routing</span>
          </div>
        )}

        {/* Speech Error Notice */}
        {speechError && (
          <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/30 text-[11px] font-mono text-rose-300 flex items-center justify-between">
            <span>{speechError}</span>
            <button 
              onClick={() => setSpeechError(null)}
              className="text-rose-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Results List */}
        <div className="p-2 max-h-80 overflow-y-auto space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono text-[#6A7097] uppercase px-3 py-1.5">
            <span>Actions & Agent Routing ({filteredActions.length})</span>
            <span>Use ↑ ↓ to navigate, Enter to select</span>
          </div>

          {filteredActions.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-[#6A7097] space-y-2">
              <p>No matching commands or agents found for "{query}".</p>
              <p className="text-[11px] text-[#4E5478]">
                Try holding the record button and speaking "Open Kanban" or "Startup Generator".
              </p>
            </div>
          ) : (
            filteredActions.map((action, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={action.id}
                  onClick={() => {
                    onSelectTab(action.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs transition group ${
                    isSelected 
                      ? 'bg-[#15182C] border border-[#615EFF] shadow-lg shadow-[#615EFF]/10' 
                      : 'hover:bg-[#101222] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${isSelected ? 'bg-[#615EFF]/20 text-[#A5A2FF]' : 'bg-[#080913] text-[#7B82A8]'}`}>
                      {action.icon}
                    </div>
                    <div>
                      <span className={`font-semibold ${isSelected ? 'text-white' : 'text-[#D0D4EE] group-hover:text-white'}`}>
                        {action.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[#5B6188] bg-[#06070E] px-2 py-0.5 rounded border border-[#161828]">
                      {action.category}
                    </span>
                    {isSelected && (
                      <ArrowRight className="w-3.5 h-3.5 text-[#615EFF] animate-pulse" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Info with Voice Directive Tip */}
        <div className="px-4 py-2.5 bg-[#06070D] border-t border-[#161828] flex flex-col sm:flex-row sm:items-center justify-between text-[11px] font-mono text-[#6A7097] gap-2">
          <div className="flex items-center gap-2">
            <Mic className="w-3 h-3 text-[#615EFF]" />
            <span className="text-[#8E94B8]">
              Hold <strong className="text-white">Record</strong> or press <strong className="text-white">Enter</strong> to execute query
            </span>
          </div>
          <span>ESC to close • Hermes OpenRouter Protocol</span>
        </div>
      </div>
    </div>
  );
};
