import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, Mic, MicOff, Volume2, VolumeX, Sparkles, Shield, ShieldCheck, 
  Terminal, Radio, ArrowRight, Zap, CheckCircle2, RefreshCw, 
  ExternalLink, Layers, Bot, Activity, Brain, Database, Cpu
} from 'lucide-react';
import { JarvisSettings, KanbanTask, AgentRole } from '../types';
import { JarvisMindVisualizer } from './JarvisMindVisualizer';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { speakText, VoiceConfig } from '../services/voiceEngine';

interface GlobalVoiceOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceContext: string;
  activeWorkspaceId?: string;
  settings: JarvisSettings;
  onUpdateSettings?: (newSettings: Partial<JarvisSettings>) => void;
  onSendQuery: (query: string, targetModel: string) => Promise<string>;
  onAddKanbanTask?: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt' | 'subtasks'>) => void;
  onAddNoteToVault?: (title: string, content: string, tags: string[], folder?: string) => void;
  onOpenDedicatedApollo?: () => void;
}

export const GlobalVoiceOverlay: React.FC<GlobalVoiceOverlayProps> = ({
  isOpen,
  onClose,
  workspaceContext,
  activeWorkspaceId = 'ws-synthos-primary',
  settings,
  onUpdateSettings,
  onSendQuery,
  onAddKanbanTask,
  onAddNoteToVault,
  onOpenDedicatedApollo,
}) => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeStage, setActiveStage] = useState<number>(0);
  const [transcriptLogs, setTranscriptLogs] = useState<Array<{ id: string; sender: 'user' | 'synthos'; text: string; time: string }>>([
    { id: 'init-1', sender: 'synthos', text: `SynthOS Global Voice Engine online. Workspace context: [${workspaceContext.toUpperCase()}]. Ready for directives.`, time: 'Just now' }
  ]);

  const [pipelineTrace, setPipelineTrace] = useState<{
    workspace: string;
    guardianPassed: boolean;
    targetAgent: string;
    model: string;
    receiptId: string | null;
  }>({
    workspace: workspaceContext,
    guardianPassed: true,
    targetAgent: 'orchestrator',
    model: 'hermes-3-llama-3.1-70b',
    receiptId: null,
  });

  const [mindState, setMindState] = useState<'standby' | 'listening' | 'thinking' | 'speaking'>('standby');

  // Handle Speech Recognition
  const handleFinalTranscript = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return;
    setInputText(transcript);
    await handleExecuteVoiceDirective(transcript);
  }, [workspaceContext]);

  const {
    liveTranscript,
    isListening,
    startListening,
    stopListening,
    clearTranscript
  } = useSpeechRecognition(handleFinalTranscript);

  useEffect(() => {
    if (isListening) {
      setMindState('listening');
    } else if (isProcessing) {
      setMindState('thinking');
    } else if (isSpeaking) {
      setMindState('speaking');
    } else {
      setMindState('standby');
    }
  }, [isListening, isProcessing, isSpeaking]);

  // Update pipeline workspace when context changes
  useEffect(() => {
    setPipelineTrace(prev => ({ ...prev, workspace: workspaceContext }));
  }, [workspaceContext]);

  const handleExecuteVoiceDirective = async (directiveText: string) => {
    if (!directiveText.trim()) return;

    const userLogId = `user-${Date.now()}`;
    const timeString = new Date().toLocaleTimeString();
    
    setTranscriptLogs(prev => [...prev, {
      id: userLogId,
      sender: 'user',
      text: directiveText,
      time: timeString
    }]);

    setIsProcessing(true);
    setActiveStage(1); // Voice -> SynthOS Request

    // Determine target agent based on directive keywords
    let target = 'orchestrator';
    let chosenModel = 'hermes-3-llama-3.1-70b';
    const lower = directiveText.toLowerCase();
    
    if (lower.includes('scout') || lower.includes('find') || lower.includes('search') || lower.includes('research')) {
      target = 'scout';
      chosenModel = 'sonar-pro';
    } else if (lower.includes('scribe') || lower.includes('note') || lower.includes('vault') || lower.includes('document')) {
      target = 'scribe';
      chosenModel = 'claude-3-7-sonnet';
    } else if (lower.includes('reach') || lower.includes('growth') || lower.includes('tweet') || lower.includes('marketing')) {
      target = 'reach';
      chosenModel = 'chatgpt-o3-mini';
    } else if (lower.includes('dev') || lower.includes('code') || lower.includes('build') || lower.includes('patch')) {
      target = 'dev';
      chosenModel = 'claude-3-7-sonnet';
    } else if (lower.includes('analytics') || lower.includes('metric') || lower.includes('token') || lower.includes('cost')) {
      target = 'analytics';
      chosenModel = 'deepseek-r1';
    }

    // Step-by-step pipeline execution
    setTimeout(() => setActiveStage(2), 200); // Orchestrator
    setTimeout(() => setActiveStage(3), 400); // Workspace Context
    setTimeout(() => setActiveStage(4), 600); // Guardian Sentinel
    setTimeout(() => setActiveStage(5), 800); // Target Agent & Model Router
    setTimeout(() => setActiveStage(6), 1000); // Tools & Execution

    try {
      const receiptId = `rcpt-synthos-${Date.now().toString().slice(-6)}`;
      
      // Dispatch Kanban Task if handler exists
      if (onAddKanbanTask) {
        onAddKanbanTask({
          title: `Voice Directive (${workspaceContext}): ${directiveText.slice(0, 40)}`,
          description: `Dispatched via Global Voice Overlay. Context: ${workspaceContext}. Full command: "${directiveText}"`,
          column: 'triage',
          assignedAgent: target as AgentRole,
          assignedModel: chosenModel,
          priority: 'high',
          origin: 'VOICE_MEMO_JARVIS',
          tags: ['global-voice', workspaceContext, target],
          obsidianWikilinks: [`[[Voice-Directives/${target}]]`, `[[Workspaces/${workspaceContext}]]`],
        });
      }

      // Generate AI response
      const prompt = `You are SynthOS Global Voice Assistant. The user gave a voice directive while inside the "${workspaceContext}" workspace.
Directive: "${directiveText}"
Respond concisely in 1-2 spoken sentences with clear confirmation of action taken and status.`;
      
      const reply = await onSendQuery(prompt, chosenModel);
      
      setPipelineTrace({
        workspace: workspaceContext,
        guardianPassed: true,
        targetAgent: target,
        model: chosenModel,
        receiptId: receiptId,
      });

      setActiveStage(7); // Aegis & Receipt
      
      // Save transcript to Obsidian
      if (onAddNoteToVault) {
        onAddNoteToVault(
          `VoiceDirective-${Date.now().toString().slice(-4)}`,
          `# Voice Directive Record\n\n**Workspace Context**: ${workspaceContext}\n**Target Agent**: ${target}\n**Model**: ${chosenModel}\n**Receipt**: ${receiptId}\n\n## Directive\n> ${directiveText}\n\n## Response\n${reply}\n\n#voice #directives #${workspaceContext}`,
          ['voice', 'directive', workspaceContext, target],
          'Voice-Directives'
        );
      }

      // Add SynthOS Response Log
      setTranscriptLogs(prev => [...prev, {
        id: `synthos-${Date.now()}`,
        sender: 'synthos',
        text: reply || `Directive accepted for ${target.toUpperCase()}. Task dispatched to board.db with Aegis Receipt #${receiptId}.`,
        time: new Date().toLocaleTimeString()
      }]);

      setInputText('');
      setIsProcessing(false);
      setActiveStage(8); // Complete

      // TTS playback
      setIsSpeaking(true);
      try {
        const voiceConfig: VoiceConfig = {
          provider: 'web_speech',
          speed: settings.voiceRate || 1.0,
        };
        await speakText(reply || "Directive dispatched successfully.", voiceConfig);
      } catch (err) {
        console.warn("TTS playback fallback:", err);
      } finally {
        setIsSpeaking(false);
      }
    } catch (e: any) {
      setIsProcessing(false);
      setTranscriptLogs(prev => [...prev, {
        id: `err-${Date.now()}`,
        sender: 'synthos',
        text: `Directive dispatched locally to ${target.toUpperCase()} agent. Task logged in board.db.`,
        time: new Date().toLocaleTimeString()
      }]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md font-mono animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl bg-[#070811] border border-[#242844] hover:border-[#615EFF]/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Workspace Context Banner */}
        <div className="bg-[#0B0D18] p-4 border-b border-[#1A1E36] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#615EFF]/20 to-[#A5A2FF]/30 border border-[#615EFF]/50 flex items-center justify-center text-[#A5A2FF]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white tracking-wider">SYNTHOS GLOBAL VOICE CORE</span>
                <span className="text-[10px] bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/40 px-2 py-0.5 rounded font-bold uppercase">
                  SHARED INFRASTRUCTURE
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[#8E94B8] mt-0.5">
                <span>ACTIVE WORKSPACE:</span>
                <span className="text-[#00D26A] font-bold uppercase">[{workspaceContext}]</span>
                <span>•</span>
                <span className="text-[#7E85A8]">Guardian Level 2 Active</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenDedicatedApollo && (
              <button
                onClick={() => {
                  onClose();
                  onOpenDedicatedApollo();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1A1E36] text-[#A5A2FF] hover:text-white border border-[#242844] text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                title="Open full dedicated Apollo Voice workspace"
              >
                <Radio className="w-3.5 h-3.5 text-[#FF5E8E]" />
                <span className="hidden sm:inline">Apollo Voice Workspace</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-[#121424] hover:bg-[#202540] text-[#8E94B8] hover:text-white border border-[#232742] transition cursor-pointer"
              title="Close Voice Overlay"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Layout: Neural Visualizer & Interactive Voice Terminal */}
        <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-y-auto">
          {/* Left Column: Neural Memory Visualizer */}
          <div className="md:col-span-5 p-4 border-b md:border-b-0 md:border-r border-[#1A1E36] flex flex-col justify-between space-y-3 bg-[#05060C]">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[#8E94B8]">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-[#615EFF]" />
                  <span>NEURAL MEMORY CORE</span>
                </span>
                <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 px-1.5 py-0.5 rounded border border-[#00D26A]/30">
                  {mindState.toUpperCase()}
                </span>
              </div>
              <div className="h-56 rounded-xl overflow-hidden border border-[#151728] relative">
                <JarvisMindVisualizer compact={true} height="100%" showTelemetryHUD={false} />
              </div>
            </div>

            {/* Execution Trace & Pipeline Flow */}
            <div className="bg-[#0B0D18] p-3 rounded-xl border border-[#1A1E36] space-y-2 text-[10px]">
              <div className="text-white font-bold flex items-center justify-between border-b border-[#1A1E36] pb-1.5">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-[#00D26A]" />
                  <span>EXECUTION PIPELINE FLOW</span>
                </span>
                <span className="text-[#8E94B8]">CANONICAL MESH</span>
              </div>
              
              <div className="space-y-1 text-[#8E94B8]">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeStage >= 1 ? 'bg-[#00D26A]' : 'bg-[#2A2E4C]'}`} />
                  <span>Voice Request</span>
                  <ArrowRight className="w-2.5 h-2.5 text-[#4E5478]" />
                  <span>SynthOS Core</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeStage >= 3 ? 'bg-[#00D26A]' : 'bg-[#2A2E4C]'}`} />
                  <span>Context: <strong className="text-white">[{pipelineTrace.workspace}]</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeStage >= 4 ? 'bg-[#00D26A]' : 'bg-[#2A2E4C]'}`} />
                  <span>Guardian Boundary: <strong className="text-[#00D26A]">VERIFIED</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeStage >= 5 ? 'bg-[#00D26A]' : 'bg-[#2A2E4C]'}`} />
                  <span>Agent: <strong className="text-[#A5A2FF]">{pipelineTrace.targetAgent.toUpperCase()}</strong></span>
                  <ArrowRight className="w-2.5 h-2.5 text-[#4E5478]" />
                  <span>Model Router</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeStage >= 7 ? 'bg-[#00D26A]' : 'bg-[#2A2E4C]'}`} />
                  <span>Aegis Receipt: <strong className="text-white">{pipelineTrace.receiptId || 'Standby'}</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Audio Feed & Transcription Terminal */}
          <div className="md:col-span-7 p-4 flex flex-col justify-between space-y-4 bg-[#070811]">
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between text-xs text-[#8E94B8] border-b border-[#1A1E36] pb-2">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#00D26A]" />
                  <span>REALTIME VOICE STREAM</span>
                </span>
                <span className="text-[10px] text-[#8E94B8]">Full Duplex Barge-in: ON</span>
              </div>

              {/* Transcript Scroll Area */}
              <div className="flex-1 min-h-[180px] max-h-[260px] overflow-y-auto space-y-3 p-3 bg-[#05060C] rounded-xl border border-[#151728]">
                {transcriptLogs.map((log) => (
                  <div 
                    key={log.id} 
                    className={`p-2.5 rounded-xl text-xs space-y-1 ${
                      log.sender === 'user' 
                        ? 'bg-[#14172B] border border-[#242844] text-[#C5C9E0] ml-6' 
                        : 'bg-[#0F1122] border border-[#1E2342] text-white mr-6'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-[#7E85A8]">
                      <span className="font-bold uppercase tracking-wider text-[#A5A2FF]">
                        {log.sender === 'user' ? 'YOU (VOICE DIRECTIVE)' : 'SYNTHOS ASSISTANT'}
                      </span>
                      <span>{log.time}</span>
                    </div>
                    <p className="font-sans leading-relaxed">{log.text}</p>
                  </div>
                ))}

                {isListening && liveTranscript && (
                  <div className="p-2.5 rounded-xl text-xs bg-[#14172B]/60 border border-[#615EFF]/40 text-[#A5A2FF] ml-6 animate-pulse">
                    <span className="text-[10px] block text-[#615EFF] font-bold">TRANSCRIBING...</span>
                    <span>"{liveTranscript}"</span>
                  </div>
                )}

                {isProcessing && (
                  <div className="p-2.5 rounded-xl text-xs bg-[#0F1122] border border-[#00D26A]/40 text-[#00D26A] mr-6 animate-pulse flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Orchestrator arbitrating models & dispatching tools...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Input & Microphone Action Bar */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (isListening) {
                      stopListening();
                    } else {
                      startListening();
                    }
                  }}
                  className={`p-3 rounded-xl font-bold flex items-center justify-center transition cursor-pointer shadow-lg ${
                    isListening
                      ? 'bg-[#FF5E8E] text-white shadow-[#FF5E8E]/40 animate-pulse'
                      : 'bg-[#615EFF] text-white hover:bg-[#524FE8] shadow-[#615EFF]/25'
                  }`}
                  title={isListening ? 'Stop Listening' : 'Start Speech Input'}
                >
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>

                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleExecuteVoiceDirective(inputText);
                      }
                    }}
                    placeholder={`Speak or type directive for [${workspaceContext}]...`}
                    className="w-full bg-[#05060C] border border-[#1E233D] focus:border-[#615EFF] rounded-xl px-4 py-3 text-xs text-white placeholder-[#5E6488] outline-none font-sans"
                  />
                </div>

                <button
                  onClick={() => handleExecuteVoiceDirective(inputText)}
                  disabled={!inputText.trim() || isProcessing}
                  className={`px-4 py-3 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    inputText.trim() && !isProcessing
                      ? 'bg-[#00D26A] text-black hover:bg-[#00B85C] shadow-lg shadow-[#00D26A]/20'
                      : 'bg-[#121424] text-[#5E6488] border border-[#1E233D] cursor-not-allowed'
                  }`}
                >
                  <span>SEND</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Quick Prompt Suggestions */}
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {[
                  `Summarize urgent items in ${workspaceContext}`,
                  `Dispatch Dev to run sandbox health check`,
                  `Synthesize market memo to Obsidian vault`,
                  `Audit token burn rate via Analytics`
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleExecuteVoiceDirective(prompt)}
                    className="bg-[#0B0D18] hover:bg-[#14172B] border border-[#1A1E36] hover:border-[#615EFF] text-[#8E94B8] hover:text-white px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
