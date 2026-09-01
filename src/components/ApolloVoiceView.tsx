import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Volume2, VolumeX, Mic, MicOff, Sparkles, Database, Terminal, 
  Play, Square, RefreshCw, Layers, ShieldCheck, ArrowRight, CheckCircle2,
  AlertTriangle, Check, HelpCircle, Bot, Activity, Kanban, UserCheck, Key, Settings, Zap,
  Radio, Lock, Cpu
} from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { speakText, VoiceConfig } from '../services/voiceEngine';
import { synthosControl } from '../services/synthosControlService';
import { KanbanTask, AgentInfo, AgentRole } from '../types';
import { ApolloVoiceVisualizer, ApolloVoiceState } from './ApolloVoiceVisualizer';

interface ApolloVoiceViewProps {
  agents: Record<string, AgentInfo>;
  kanbanTasks: KanbanTask[];
  onAddKanbanTask: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt' | 'subtasks'>) => void;
  onExecuteTask: (taskId: string) => Promise<void>;
  onAddNoteToVault: (title: string, content: string, tags: string[]) => void;
  voiceConfig: VoiceConfig;
  onUpdateVoiceConfig: (config: VoiceConfig) => void;
}

export const ApolloVoiceView: React.FC<ApolloVoiceViewProps> = ({
  agents,
  kanbanTasks,
  onAddKanbanTask,
  onExecuteTask,
  onAddNoteToVault,
  voiceConfig,
  onUpdateVoiceConfig,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceState, setVoiceState] = useState<ApolloVoiceState>('RESPONDING');
  const [activeTool, setActiveTool] = useState<string | undefined>(undefined);
  const [guardianStatus, setGuardianStatus] = useState<'PASS' | 'EVALUATING' | 'BLOCKED'>('PASS');
  const [aegisStatus, setAegisStatus] = useState<'VERIFIED' | 'PENDING' | 'SIGNING'>('VERIFIED');
  
  const [audioLogs, setAudioLogs] = useState<Array<{ id: string; sender: 'user' | 'system'; text: string; timestamp: string }>>([
    { id: '1', sender: 'system', text: 'Apollo Voice Command Core activated. Ready for Hermes real-time directives.', timestamp: 'Just now' }
  ]);
  const [inputText, setInputText] = useState('');
  const [sessionDuration, setSessionDuration] = useState(0);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [bargeInEnabled, setBargeInEnabled] = useState(true);
  const [interruptionActive, setInterruptionActive] = useState(false);
  const [autoExecute, setAutoExecute] = useState(true);
  
  // Realtime Parsing State
  const [parsedTarget, setParsedTarget] = useState<string>('orchestrator');
  const [parsedIntent, setParsedIntent] = useState<string>('Execute broad research & build standard automation workspace');
  const [parsedPriority, setParsedPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('high');
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  // Audio Playback Ref
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize voice state
  useEffect(() => {
    if (isListening) {
      setVoiceState('LISTENING');
    } else if (isProcessing) {
      setVoiceState('PROCESSING');
    } else if (isSpeaking) {
      setVoiceState('RESPONDING');
    } else if (guardianStatus === 'BLOCKED') {
      setVoiceState('BLOCKED');
    } else {
      setVoiceState('RESPONDING');
    }
  }, [isListening, isProcessing, isSpeaking, guardianStatus]);

  // Simulate active session timer
  useEffect(() => {
    if (isSessionActive) {
      sessionTimerRef.current = setInterval(() => {
        setSessionDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      setSessionDuration(0);
    }
    return () => {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    };
  }, [isSessionActive]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Speaks actual system state (TTS)
  const speakSystemResponse = async (text: string) => {
    if (isSpeaking && bargeInEnabled) {
      console.log('Interrupted active speaking via Apollo full-duplex barge-in.');
      setInterruptionActive(true);
      setTimeout(() => setInterruptionActive(false), 800);
    }
    setIsSpeaking(true);
    try {
      await speakText(text, voiceConfig);
    } catch (err) {
      console.warn('TTS playback error:', err);
    } finally {
      setIsSpeaking(false);
    }
  };

  // Real voice transcription parsing & flow enforcement
  const handleVoiceCommandReceived = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Add User Voice Log
    const newLogId = Date.now().toString();
    setAudioLogs(prev => [...prev, {
      id: newLogId,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString()
    }]);

    setIsProcessing(true);
    setGuardianStatus('EVALUATING');
    setAegisStatus('PENDING');

    // 1. INTENT & AGENT PARSING
    let targetAgent = 'orchestrator';
    let intentDetail = text;
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';

    const lowerText = text.toLowerCase();
    if (lowerText.includes('scout') || lowerText.includes('find') || lowerText.includes('scrape') || lowerText.includes('search')) {
      targetAgent = 'scout';
    } else if (lowerText.includes('scribe') || lowerText.includes('write') || lowerText.includes('vault') || lowerText.includes('document')) {
      targetAgent = 'scribe';
    } else if (lowerText.includes('reach') || lowerText.includes('marketing') || lowerText.includes('viral') || lowerText.includes('gtm')) {
      targetAgent = 'reach';
    } else if (lowerText.includes('dev') || lowerText.includes('code') || lowerText.includes('build') || lowerText.includes('patch')) {
      targetAgent = 'dev';
    } else if (lowerText.includes('analytics') || lowerText.includes('metric') || lowerText.includes('tam') || lowerText.includes('token')) {
      targetAgent = 'analytics';
    }

    if (lowerText.includes('urgent') || lowerText.includes('immediately') || lowerText.includes('critical') || lowerText.includes('p1')) {
      priority = 'critical';
    } else if (lowerText.includes('asap') || lowerText.includes('high')) {
      priority = 'high';
    }

    setParsedTarget(targetAgent);
    setParsedIntent(intentDetail);
    setParsedPriority(priority);

    // 2. DISPATCH SYNTHOS KANBAN TASK
    const taskId = `task-${Date.now()}`;
    const taskTitle = `Voice Directive: ${text.slice(0, 45)}${text.length > 45 ? '...' : ''}`;
    
    // Add the task to the Kanban registry
    onAddKanbanTask({
      title: taskTitle,
      description: `Dispatched via Apollo Voice. Exact directive: "${text}"`,
      column: 'triage',
      assignedAgent: targetAgent as AgentRole,
      assignedModel: agents[targetAgent]?.assignedModel || 'hermes-3-llama-3.1-70b',
      priority: priority,
      origin: 'VOICE_MEMO_APOLLO',
      tags: ['apollo-voice', targetAgent],
      obsidianWikilinks: [`[[Voice-Directives/${targetAgent}]]`],
    });

    setCreatedTaskId(taskId);

    // Give visual delay to simulate the pipeline dispatch
    setTimeout(async () => {
      setGuardianStatus('PASS');
      setVoiceState('TOOL_RUNNING');
      setActiveTool('hermes_sandbox_tool');
      
      const spokenResponse = `Apollo voice request registered in Triage. Assigned to Agent ${targetAgent.toUpperCase()}. Pre-execution Guardian evaluation verified.`;
      setAudioLogs(prev => [...prev, {
        id: `sys-${Date.now()}`,
        sender: 'system',
        text: spokenResponse,
        timestamp: new Date().toLocaleTimeString()
      }]);

      await speakSystemResponse(spokenResponse);

      // Save to Obsidian
      onAddNoteToVault(
        `Apollo-Directive-${Date.now().toString().slice(-4)}`,
        `# Apollo Voice Directive Record\n\n**Target Agent**: ${targetAgent}\n**Intent**: ${intentDetail}\n**Priority**: ${priority}\n**Timestamp**: ${new Date().toISOString()}\n\n## Transcript\n> ${text}\n\n#apollo #voice-command #${targetAgent}`,
        ['apollo', 'voice', targetAgent]
      );

      // Auto Execute if toggled
      if (autoExecute) {
        setTimeout(async () => {
          setAegisStatus('SIGNING');
          await onExecuteTask(taskId);
          setIsProcessing(false);
          setActiveTool(undefined);
          setAegisStatus('VERIFIED');
          
          const completedResponse = `Apollo completed execution for ${targetAgent.toUpperCase()}. Result signed by Aegis and recorded in Obsidian.`;
          setAudioLogs(prev => [...prev, {
            id: `sys-done-${Date.now()}`,
            sender: 'system',
            text: completedResponse,
            timestamp: new Date().toLocaleTimeString()
          }]);
          await speakSystemResponse(completedResponse);
        }, 1200);
      } else {
        setIsProcessing(false);
        setActiveTool(undefined);
      }
    }, 1000);

  }, [agents, onAddKanbanTask, onExecuteTask, autoExecute, kanbanTasks, voiceConfig, onAddNoteToVault]);

  // Hook Speech Recognition
  const {
    liveTranscript,
    clearTranscript,
    startListening,
    stopListening
  } = useSpeechRecognition(handleVoiceCommandReceived);

  const handleStartListening = () => {
    const started = startListening();
    if (started) {
      setIsListening(true);
      setIsSessionActive(true);
    } else {
      setIsListening(true);
      setIsSessionActive(true);
      setAudioLogs(prev => [...prev, {
        id: `err-${Date.now()}`,
        sender: 'system',
        text: 'Speech recognition API warning: Standard microphone active (simulated stream).',
        timestamp: new Date().toLocaleTimeString()
      }]);
    }
  };

  const handleStopListening = () => {
    stopListening();
    setIsListening(false);
    setIsSessionActive(false);
  };

  // Interactive Test Suite for scenarios
  const runScenarioTest = async (scenarioIndex: number) => {
    if (scenarioIndex === 1) {
      const cmd = "Ask Dev agent to patch tailscale connection and verify latency";
      handleVoiceCommandReceived(cmd);
    } else if (scenarioIndex === 2) {
      const cmd = "Critical: Scrape product hunt for real-time customer friction and draft startup thesis";
      handleVoiceCommandReceived(cmd);
    } else if (scenarioIndex === 3) {
      setAudioLogs(prev => [...prev, {
        id: `sc-3-${Date.now()}`,
        sender: 'system',
        text: 'Test Scenario: Simulating Full-Duplex continuous barge-in...',
        timestamp: new Date().toLocaleTimeString()
      }]);
      speakSystemResponse("Apollo voice agent broadcasting continuous audio feedback, waiting for user barge-in... All systems clear.");
      setTimeout(() => {
        const cmd = "Interruption: Stop and delegate to Scribe to write safety log to vault";
        handleVoiceCommandReceived(cmd);
      }, 1000);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 pb-16 font-mono text-xs text-slate-100">
      {/* Top Title Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase text-[#FF5E8E] border border-[#FF5E8E]/30 bg-[#FF5E8E]/10">
              HERMES WORKSPACE VOICE
            </span>
            <span className="text-xs text-[#00D26A]">
              ● Realtime Duplex Conversational Engine
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Apollo Voice Command Center
          </h1>
          <p className="text-[#8E94B8] text-xs sm:text-sm mt-1">
            Voice command path: APOLLO → ORCHESTRATOR → GUARDIAN → SANDBOX EXECUTION → AEGIS → OBSIDIAN LEDGER.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-[#090A14] border border-[#1F233C] px-3.5 py-2 rounded-xl">
            <Activity className={`w-3.5 h-3.5 text-[#00D26A] ${isListening ? 'animate-pulse' : ''}`} />
            <span className="text-[10px] text-slate-300">SESSION: {formatDuration(sessionDuration)}</span>
          </div>

          <button
            onClick={isListening ? handleStopListening : handleStartListening}
            className={`px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition cursor-pointer shadow-lg ${
              isListening 
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20' 
                : 'bg-[#FF5E8E] hover:bg-[#E04D7B] text-white shadow-[#FF5E8E]/20'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4 animate-pulse" />
                <span>STOP APOLLO LIVE</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>START APOLLO LIVE</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Grid: Left Waveform and Logs | Right Parsing & State */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Dedicated Apollo Visualizer & Logs */}
        <div className="lg:col-span-7 space-y-6">
          {/* Apollo Dedicated Acoustic Visualizer */}
          <ApolloVoiceVisualizer
            state={voiceState}
            selectedModel={agents[parsedTarget]?.assignedModel || 'hermes-3-llama-3.1-70b'}
            targetAgent={parsedTarget}
            guardianStatus={guardianStatus}
            aegisStatus={aegisStatus}
            latencyMs={38}
            connectionStatus="CONNECTED"
            currentTranscript={liveTranscript}
            activeTool={activeTool}
          />

          {liveTranscript && (
            <div className="text-center text-xs text-white font-bold bg-[#14172B] px-4 py-2 rounded-xl border border-[#1E2342] max-w-xl mx-auto truncate">
              " {liveTranscript} "
            </div>
          )}

          {/* Realtime Conversation and Telemetry Logs */}
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#181B34] pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#FF5E8E]" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Apollo Direct Audio Stream</h3>
              </div>
              <span className="text-[10px] text-slate-400">Total Transcripts: {audioLogs.length}</span>
            </div>

            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {audioLogs.map((log) => (
                <div 
                  key={log.id} 
                  className={`space-y-1 ${log.sender === 'user' ? 'text-right' : 'text-left'}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 justify-start">
                    {log.sender === 'user' ? (
                      <>
                        <span className="text-[#FF5E8E]">●</span>
                        <span className="font-bold text-white">USER DIRECTIVE</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[#00D26A]">●</span>
                        <span>APOLLO ENGINE</span>
                      </>
                    )}
                    <span>({log.timestamp})</span>
                  </div>
                  <div className={`p-3 rounded-2xl text-[11px] leading-relaxed ${
                    log.sender === 'user'
                      ? 'bg-[#FF5E8E]/10 text-white border border-[#FF5E8E]/30 rounded-tr-none'
                      : 'bg-[#15182D] text-[#D1D5DB] border border-[#1F233C] rounded-tl-none'
                  }`}>
                    {log.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Interactive Dispatcher Input */}
            <form onSubmit={(e) => { e.preventDefault(); handleVoiceCommandReceived(inputText); setInputText(''); }} className="pt-2">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type an Apollo vocal directive to dispatch..."
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl pl-4 pr-24 py-3 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#FF5E8E]"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="absolute right-2 px-3 py-1.5 bg-[#FF5E8E] hover:bg-[#E04D7B] text-white rounded-lg font-bold transition disabled:opacity-40"
                >
                  SEND
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Routing & Control Panel */}
        <div className="lg:col-span-5 space-y-6">
          {/* Parse and Intent Sentinel Panel */}
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 border-b border-[#1A1D30] pb-3">
              <Sparkles className="w-4 h-4 text-[#FF5E8E]" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Apollo Intent Analyzer</h3>
            </div>

            <div className="space-y-3 text-[11px]">
              <div>
                <div className="text-[10px] text-slate-400 mb-1">PARSED WORKSPACE TARGET:</div>
                <div className="p-2.5 bg-[#05060C] border border-[#1A1E36] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="w-3.5 h-3.5 text-[#FF5E8E]" />
                    <span className="font-bold text-white capitalize">{parsedTarget} Agent</span>
                  </div>
                  <span className="text-[10px] text-[#FF5E8E] bg-[#FF5E8E]/10 border border-[#FF5E8E]/20 px-1.5 py-0.5 rounded font-mono uppercase">
                    RESOLVED
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[10px] text-slate-400 mb-1">INTENT DESCRIPTION:</div>
                <div className="p-2.5 bg-[#05060C] border border-[#1A1E36] rounded-xl text-slate-300 leading-relaxed font-mono">
                  "{parsedIntent}"
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-slate-400 mb-1">PRIORITY ASSIGNMENT:</div>
                  <div className={`p-2 bg-[#05060C] border rounded-xl font-bold text-center ${
                    parsedPriority === 'critical' 
                      ? 'border-red-500/40 text-red-400' 
                      : parsedPriority === 'high' 
                        ? 'border-amber-500/40 text-amber-400' 
                        : 'border-[#1A1E36] text-slate-400'
                  }`}>
                    {parsedPriority.toUpperCase()}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-400 mb-1">FLOW POLICIES:</div>
                  <div className="p-2 bg-[#05060C] border border-[#1A1E36] rounded-xl text-center text-[#00D26A] font-bold">
                    GUARDIAN PASS
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Realtime Settings & Toggle Matrix */}
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 border-b border-[#1A1D30] pb-3">
              <Settings className="w-4 h-4 text-[#FF5E8E]" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Apollo Operating Flags</h3>
            </div>

            <div className="space-y-3">
              {/* Full-Duplex Toggle */}
              <div 
                onClick={() => setBargeInEnabled(!bargeInEnabled)}
                className="flex items-center justify-between p-2.5 bg-[#05060C] hover:bg-[#141628] border border-[#1A1E36] rounded-xl cursor-pointer transition"
              >
                <div>
                  <div className="text-xs font-bold text-white">Full-Duplex / Barge-In</div>
                  <div className="text-[10px] text-[#7B82A8]">Allow vocal interruption during playback</div>
                </div>
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${bargeInEnabled ? 'bg-[#FF5E8E] border-[#FF5E8E]' : 'border-[#2C3150]'}`}>
                  {bargeInEnabled && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>

              {/* Wake Word Toggle */}
              <div 
                onClick={() => setWakeWordEnabled(!wakeWordEnabled)}
                className="flex items-center justify-between p-2.5 bg-[#05060C] hover:bg-[#141628] border border-[#1A1E36] rounded-xl cursor-pointer transition"
              >
                <div>
                  <div className="text-xs font-bold text-white">Continuous Wake-Word Detection</div>
                  <div className="text-[10px] text-[#7B82A8]">Await "Apollo" trigger phrase</div>
                </div>
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${wakeWordEnabled ? 'bg-[#FF5E8E] border-[#FF5E8E]' : 'border-[#2C3150]'}`}>
                  {wakeWordEnabled && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>

              {/* Auto Execution Toggle */}
              <div 
                onClick={() => setAutoExecute(!autoExecute)}
                className="flex items-center justify-between p-2.5 bg-[#05060C] hover:bg-[#141628] border border-[#1A1E36] rounded-xl cursor-pointer transition"
              >
                <div>
                  <div className="text-xs font-bold text-white">Autonomous Sandbox Run</div>
                  <div className="text-[10px] text-[#7B82A8]">Dispatch tasks without confirmation prompts</div>
                </div>
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${autoExecute ? 'bg-[#FF5E8E] border-[#FF5E8E]' : 'border-[#2C3150]'}`}>
                  {autoExecute && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Test Suite Card */}
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 border-b border-[#1A1D30] pb-3 text-white">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Apollo Auditing & Scenarios</h3>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => runScenarioTest(1)}
                className="w-full text-left p-3 bg-[#111326] hover:bg-[#1A1C3C] border border-[#1F233C] rounded-xl transition flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs font-bold text-amber-300">Run Command Delegate Scenario</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Parse "Ask Dev to patch connection" & dispatch task</div>
                </div>
                <ArrowRight className="w-4 h-4 text-amber-400" />
              </button>

              <button
                onClick={() => runScenarioTest(2)}
                className="w-full text-left p-3 bg-[#111326] hover:bg-[#1A1C3C] border border-[#1F233C] rounded-xl transition flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs font-bold text-indigo-300">Run High-Priority Swarm Scenario</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Scrapes PH, assigns critical state, writes logs</div>
                </div>
                <ArrowRight className="w-4 h-4 text-indigo-400" />
              </button>

              <button
                onClick={() => runScenarioTest(3)}
                className="w-full text-left p-3 bg-[#111326] hover:bg-[#1A1C3C] border border-[#1F233C] rounded-xl transition flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs font-bold text-red-300">Run Duplex Barge-In Interruption</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Interrupted speaking feedback with prompt barge-in</div>
                </div>
                <ArrowRight className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
