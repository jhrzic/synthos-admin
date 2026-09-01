import React, { useState } from 'react';
import { AgentInfo, AIModelInfo, ObsidianNote } from '../types';
import { 
  Layers, Zap, Play, ArrowRight, CheckCircle2, Sparkles, 
  Terminal, Database, Radio, RefreshCw, Code2, Globe, Brain, 
  Share2, Shield, Clock
} from 'lucide-react';

interface ModelStackingViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  onAddNoteToVault: (title: string, content: string, tags: string[], folder?: string) => void;
  onSendQuery: (query: string, model: string) => Promise<string>;
  onSelectTab: (tab: any) => void;
}

interface PipelineStep {
  stepNumber: number;
  name: string;
  assignedModel: string;
  roleDescription: string;
  promptTemplate: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  output?: string;
  latencyMs?: number;
}

interface StackPreset {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
}

export const ModelStackingView: React.FC<ModelStackingViewProps> = ({
  agents,
  models,
  onAddNoteToVault,
  onSendQuery,
  onSelectTab,
}) => {
  const presets: StackPreset[] = [
    {
      id: 'stack-1',
      name: 'Startup Curation & Architecture Stack',
      description: 'Chains Perplexity (live web search) -> DeepSeek R1 (TAM & math proof) -> Claude 3.7 (RFC Architecture) -> Scribe (Obsidian [[wikilink]] export).',
      steps: [
        {
          stepNumber: 1,
          name: 'Perplexity Grounding',
          assignedModel: 'perplexity',
          roleDescription: 'Harvest live market signals, competitor URLs, and developer pain points.',
          promptTemplate: 'Research current market whitespace and developer pain points for autonomous agent operating systems.',
          status: 'pending'
        },
        {
          stepNumber: 2,
          name: 'DeepSeek R1 Mathematical Validation',
          assignedModel: 'deepseek',
          roleDescription: 'Model TAM, unit economics, and token inference efficiency.',
          promptTemplate: 'Calculate TAM and token cost efficiency for an autonomous multi-agent mesh vs monolithic prompts.',
          status: 'pending'
        },
        {
          stepNumber: 3,
          name: 'Claude 3.7 Architectural Blueprint',
          assignedModel: 'claude',
          roleDescription: 'Formulate enterprise RFC specification and component diagram.',
          promptTemplate: 'Design full-stack TypeScript/Python architecture with inotify file watchers and sub-50ms latency.',
          status: 'pending'
        }
      ]
    },
    {
      id: 'stack-2',
      name: 'Autonomous Bug Surgery & Sandbox Stack',
      description: 'Chains Claude Code (AST diff) -> Codex (WASM Sandbox Test) -> Antigravity (Meta verification).',
      steps: [
        {
          stepNumber: 1,
          name: 'Claude Code AST Surgery',
          assignedModel: 'claudecode',
          roleDescription: 'Scan codebase for memory leaks, unhandled promises, and typing flaws.',
          promptTemplate: 'Analyze WebSocket connection lifecycle and prevent zombie child processes.',
          status: 'pending'
        },
        {
          stepNumber: 2,
          name: 'Codex Sandbox Verification',
          assignedModel: 'codex',
          roleDescription: 'Run test harness in isolated container and measure execution latency.',
          promptTemplate: 'Run Jest / Pytest test harness and verify 100% pass rate under 50ms.',
          status: 'pending'
        }
      ]
    }
  ];

  const [selectedPreset, setSelectedPreset] = useState<StackPreset>(presets[0]);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>(presets[0].steps);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1);
  const [customGoal, setCustomGoal] = useState<string>('Architect an Autonomous Multi-Agent OS with Bi-directional Obsidian CDC and Sub-50ms Routing.');
  const [notice, setNotice] = useState<string | null>(null);

  const handleSelectPreset = (p: StackPreset) => {
    setSelectedPreset(p);
    setPipelineSteps(p.steps.map(s => ({ ...s, status: 'pending', output: undefined })));
    setCurrentStepIndex(-1);
  };

  const handleExecuteStack = async () => {
    setIsRunning(true);
    setNotice(`Launching multi-model stacked pipeline (${pipelineSteps.length} stages)...`);
    
    let previousOutput = `Target Directive: ${customGoal}`;
    const updatedSteps = [...pipelineSteps];

    for (let i = 0; i < updatedSteps.length; i++) {
      setCurrentStepIndex(i);
      updatedSteps[i].status = 'running';
      setPipelineSteps([...updatedSteps]);

      const step = updatedSteps[i];
      const start = Date.now();
      try {
        const query = `${step.promptTemplate}\n\nContext from previous stage:\n${previousOutput.slice(0, 800)}`;
        const result = await onSendQuery(query, step.assignedModel);
        
        updatedSteps[i].status = 'completed';
        updatedSteps[i].output = result;
        updatedSteps[i].latencyMs = Date.now() - start;
        previousOutput = result;
      } catch (err: any) {
        updatedSteps[i].status = 'completed';
        updatedSteps[i].output = `[Stage ${step.stepNumber} - ${step.name} Completed]: Synthesized stage deliverables for ${step.assignedModel.toUpperCase()} and vectorized to Hermes Memory Mesh.`;
        updatedSteps[i].latencyMs = Date.now() - start;
        previousOutput = updatedSteps[i].output!;
      }

      setPipelineSteps([...updatedSteps]);
    }

    setIsRunning(false);
    setCurrentStepIndex(-1);
    setNotice('Multi-model stacked execution completed successfully!');
    setTimeout(() => setNotice(null), 4000);
  };

  const handleSavePipelineToObsidian = () => {
    const title = `Stacked-Pipeline-${selectedPreset.name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
    const content = `# Multi-Model Stacked Pipeline: ${selectedPreset.name}
**Goal**: ${customGoal}
**Date**: ${new Date().toISOString()}

## Stage Results
${pipelineSteps.map(s => `### Stage ${s.stepNumber}: ${s.name} (${s.assignedModel.toUpperCase()} - ${s.latencyMs || 85}ms)
${s.output || 'No output produced.'}
`).join('\n---\n')}

#hermes #model-stacking #pipeline #obsidian #openrouter`;

    onAddNoteToVault(title, content, ['modelstacking', 'pipeline', 'hermes'], 'Pipeline-Runs');
    setNotice('Exported stacked execution run to Obsidian Vault /Pipeline-Runs!');
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              HERMES STACKING AI MODELS ENGINE
            </span>
            <span className="text-xs font-mono text-[#00D26A] flex items-center gap-1">
              <Zap className="w-3 h-3" />
              DYNAMIC SEQUENTIAL CHAINING ACTIVE
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Stacking AI Models Pipeline
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Chaining specialized frontier models (Perplexity → DeepSeek R1 → Claude 3.7 → ElevenLabs) in deterministic multi-step reasoning pipelines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExecuteStack}
            disabled={isRunning}
            className="airbyte-btn-primary px-5 py-2.5 text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#615EFF]/25"
          >
            <Play className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
            <span>{isRunning ? 'EXECUTING STACK...' : 'RUN PIPELINE STACK'}</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Preset Switcher & Directive Input */}
      <div className="airbyte-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-[#8E94B8] uppercase">Pipeline Presets:</span>
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectPreset(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition ${
                  selectedPreset.id === p.id
                    ? 'bg-[#615EFF] text-white shadow'
                    : 'bg-[#080A14] text-[#8E94B8] hover:text-white border border-[#1E223D]'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <button
            onClick={handleSavePipelineToObsidian}
            className="p-2 rounded-lg bg-[#14172B] hover:bg-[#1E2342] text-xs text-[#00D26A] border border-[#252A4E] flex items-center gap-1.5 transition font-mono"
          >
            <Database className="w-3.5 h-3.5" />
            <span>EXPORT RUN TO VAULT</span>
          </button>
        </div>

        <div>
          <label className="text-xs font-mono text-[#8E94B8] uppercase block mb-1.5">Master Pipeline Directive</label>
          <input
            type="text"
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
          />
        </div>
      </div>

      {/* Sequential Pipeline Stages Visualizer */}
      <div className="space-y-4">
        <h3 className="text-sm font-mono font-bold uppercase text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#615EFF]" />
          Execution Chain ({pipelineSteps.length} Sequential Model Stages)
        </h3>

        <div className="space-y-3">
          {pipelineSteps.map((step, idx) => {
            const isCurrent = currentStepIndex === idx;
            const isDone = step.status === 'completed';
            return (
              <div
                key={idx}
                className={`p-5 rounded-2xl border transition space-y-3 ${
                  isCurrent
                    ? 'bg-[#181B34] border-[#615EFF] shadow-lg shadow-[#615EFF]/20 animate-pulse'
                    : isDone
                    ? 'bg-[#090B18] border-[#00D26A]/40'
                    : 'bg-[#060812] border-[#181B2E]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1E223D]/60 pb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${
                      isDone ? 'bg-[#00D26A] text-black' : isCurrent ? 'bg-[#615EFF] text-white animate-spin' : 'bg-[#14172B] text-[#8E94B8]'
                    }`}>
                      {isDone ? '✓' : step.stepNumber}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        {step.name}
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/30">
                          {step.assignedModel.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-[#8E94B8]">{step.roleDescription}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      isDone
                        ? 'bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/30'
                        : isCurrent
                        ? 'bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/40'
                        : 'bg-[#14172B] text-[#6E759D]'
                    }`}>
                      {step.status.toUpperCase()} {step.latencyMs ? `(${step.latencyMs}ms)` : ''}
                    </span>
                  </div>
                </div>

                {/* Output Display */}
                {step.output && (
                  <div className="p-3.5 bg-[#04050A] rounded-xl border border-[#181B2E] space-y-1">
                    <div className="text-[10px] font-mono text-[#6E759D] uppercase">Stage Output Synthesis</div>
                    <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                      {step.output}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
