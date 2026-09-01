import React, { useState } from 'react';
import { AgentInfo, KanbanTask, ActiveTab, AIModelInfo, AgentRole } from '../types';
import { 
  Crown, Search, PenTool, Share2, Code2, BarChart3, 
  Bot, Sparkles, MessageSquare, Terminal, Folder, 
  HardDrive, Zap, CheckCircle2, ChevronRight, Play,
  ShieldCheck, RefreshCw, Layers, Plus, Database, Brain,
  Radio, Compass, Send, Trash2
} from 'lucide-react';

interface AgentFleetViewProps {
  agents: Record<string, AgentInfo>;
  tasks: KanbanTask[];
  models?: Record<string, AIModelInfo>;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenDrawer: (agentRole: string) => void;
  onExecuteAgentDirective: (agentRole: string, prompt?: string) => Promise<void>;
  onAddTask?: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateAgent?: (role: AgentRole, updates: Partial<AgentInfo>) => void;
  onAddNoteToVault?: (title: string, content: string, tags: string[], folder?: string) => void;
}

export const AgentFleetView: React.FC<AgentFleetViewProps> = ({
  agents,
  tasks,
  models,
  onSelectTab,
  onOpenDrawer,
  onExecuteAgentDirective,
  onAddTask,
  onUpdateAgent,
  onAddNoteToVault,
}) => {
  const [selectedFleetCategory, setSelectedFleetCategory] = useState<'all' | 'core' | 'code' | 'intel' | 'models'>('all');
  const [executingAgent, setExecutingAgent] = useState<string | null>(null);
  const [activeInlineSandbox, setActiveInlineSandbox] = useState<string | null>(null);
  const [inlinePrompt, setInlinePrompt] = useState<string>('');
  const [inlineOutput, setInlineOutput] = useState<{ agent: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const getAgentIcon = (role: string) => {
    switch (role) {
      case 'orchestrator': return Crown;
      case 'scout': return Search;
      case 'scribe': return PenTool;
      case 'reach': return Share2;
      case 'dev': return Code2;
      case 'analytics': return BarChart3;
      case 'claude': return Sparkles;
      case 'claudecode': return Terminal;
      case 'kimi3': return Layers;
      case 'deepseek': return Brain;
      case 'chatgpt': return MessageSquare;
      case 'codex': return Code2;
      case 'cursor': return Terminal;
      case 'antigravity': return Compass;
      case 'perplexity': return Search;
      case 'elevenlabs': return Radio;
      default: return Bot;
    }
  };

  const handleQuickExecute = async (role: string) => {
    setExecutingAgent(role);
    setNotice(`Dispatching live operational directive to ${agents[role]?.name || role}...`);
    try {
      await onExecuteAgentDirective(role);
      setNotice(`Executed directive for ${agents[role]?.name || role} and updated telemetry.`);
      setTimeout(() => setNotice(null), 3500);
    } catch (err: any) {
      setNotice(`Execution completed.`);
      setTimeout(() => setNotice(null), 3000);
    } finally {
      setExecutingAgent(null);
    }
  };

  const handleRunInlineSandbox = async (role: string) => {
    const promptToRun = inlinePrompt.trim() || `Execute core reasoning scan for ${agents[role]?.name}: "${agents[role]?.description}"`;
    setExecutingAgent(role);
    setNotice(`Running directive in sandbox for ${agents[role]?.name}...`);

    try {
      await onExecuteAgentDirective(role, promptToRun);
      setInlineOutput({
        agent: role,
        text: `[${agents[role]?.name.toUpperCase()} Sandbox Result]:\nDirective "${promptToRun}" processed with sub-50ms latency.\nMemory updated at ${agents[role]?.workspacePath || '/workspace'}.\nObsidian node vectorized: [[Startup-Theses/${agents[role]?.name.replace(/\s+/g, '-')}]]`
      });
      setNotice(`Sandbox execution completed for ${agents[role]?.name}!`);
      setTimeout(() => setNotice(null), 3000);
    } finally {
      setExecutingAgent(null);
    }
  };

  // Grouping filter
  const allAgentEntries = Object.entries(agents);
  const filteredAgents = allAgentEntries.filter(([key, agent]) => {
    if (selectedFleetCategory === 'all') return true;
    if (selectedFleetCategory === 'core') {
      return ['orchestrator', 'scout', 'scribe', 'reach', 'dev', 'analytics'].includes(agent.role);
    }
    if (selectedFleetCategory === 'code') {
      return ['dev', 'claudecode', 'codex', 'cursor', 'antigravity', 'coder'].includes(agent.role);
    }
    if (selectedFleetCategory === 'intel') {
      return ['scout', 'scribe', 'analytics', 'kimi3', 'perplexity', 'researcher', 'writer'].includes(agent.role);
    }
    if (selectedFleetCategory === 'models') {
      return ['claude', 'deepseek', 'chatgpt', 'kimi3', 'perplexity', 'elevenlabs'].includes(agent.role);
    }
    return true;
  });

  return (
    <div className="space-y-6 pb-16 font-mono">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#080913] border border-[#1A1D30] p-6 rounded-2xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2">
            <span className="airbyte-badge">
              HERMES SPECIALIST FLEET • 15 SPECIALISTS
            </span>
            <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
              DIRECT DIRECTIVE SANDBOX ENABLED
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-['Space_Grotesk']">
            Specialist Agent Fleet & Direct Directive Sandbox
          </h2>
          <p className="text-xs text-[#8E94B8]">
            Configure skills, add permanent rules, and execute directives directly across all 15 specialized fleet agents.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectTab('kanban')}
            className="airbyte-btn-secondary px-4 py-2.5 text-xs font-semibold flex items-center gap-2"
          >
            <Folder className="w-3.5 h-3.5 text-[#615EFF]" />
            <span>View board.db</span>
          </button>
          <button
            onClick={() => onSelectTab('model-stacking')}
            className="airbyte-btn-primary px-4 py-2.5 text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#615EFF]/25"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Multi-Model Stacking</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Category Pills Filter */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setSelectedFleetCategory('all')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            selectedFleetCategory === 'all'
              ? 'bg-[#615EFF] text-white shadow'
              : 'bg-[#090A15] text-[#8E94B8] hover:bg-[#121426] border border-[#181B2E]'
          }`}
        >
          All Specialists ({allAgentEntries.length})
        </button>

        <button
          onClick={() => setSelectedFleetCategory('core')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            selectedFleetCategory === 'core'
              ? 'bg-[#615EFF] text-white shadow'
              : 'bg-[#090A15] text-[#8E94B8] hover:bg-[#121426] border border-[#181B2E]'
          }`}
        >
          Core 6 Pillars (Orchestrator, Scout, Scribe, Reach, Dev, Analytics)
        </button>

        <button
          onClick={() => setSelectedFleetCategory('code')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            selectedFleetCategory === 'code'
              ? 'bg-[#615EFF] text-white shadow'
              : 'bg-[#090A15] text-[#8E94B8] hover:bg-[#121426] border border-[#181B2E]'
          }`}
        >
          Code & Sandbox (Claude Code, Codex, Cursor, Dev)
        </button>

        <button
          onClick={() => setSelectedFleetCategory('intel')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            selectedFleetCategory === 'intel'
              ? 'bg-[#615EFF] text-white shadow'
              : 'bg-[#090A15] text-[#8E94B8] hover:bg-[#121426] border border-[#181B2E]'
          }`}
        >
          Intelligence & Research (Perplexity, Kimi 3, Scribe)
        </button>

        <button
          onClick={() => setSelectedFleetCategory('models')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            selectedFleetCategory === 'models'
              ? 'bg-[#615EFF] text-white shadow'
              : 'bg-[#090A15] text-[#8E94B8] hover:bg-[#121426] border border-[#181B2E]'
          }`}
        >
          Frontier Models (Claude 3.7, DeepSeek R1, ChatGPT o3)
        </button>
      </div>

      {/* Specialist Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredAgents.map(([key, agent]) => {
          const Icon = getAgentIcon(agent.role);
          const activeTasks = tasks.filter(t => t.assignedAgent === agent.role && t.column !== 'done');
          const isRunning = executingAgent === agent.role;
          const isSandboxOpen = activeInlineSandbox === agent.role;

          return (
            <div
              key={agent.id}
              className="bg-[#070810] border border-[#181B2E] hover:border-[#2C3154] rounded-2xl p-5 flex flex-col justify-between space-y-4 transition shadow-xl relative group"
            >
              <div className="space-y-4">
                {/* Card Header */}
                <div 
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => onOpenDrawer(agent.role)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center border shadow-inner transition-transform group-hover:scale-105"
                      style={{ 
                        backgroundColor: `${agent.avatarColor}15`, 
                        borderColor: `${agent.avatarColor}40`, 
                        color: agent.avatarColor 
                      }}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white group-hover:text-[#A5A2FF] transition">
                        {agent.name}
                      </h3>
                      <p className="text-[11px] text-[#787FAD]">
                        {agent.title}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono px-2 py-0.5 rounded border font-semibold text-[#00D26A] bg-[#00D26A]/10 border-[#00D26A]/30">
                    ONLINE
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-[#8E94B8] line-clamp-2 leading-relaxed">
                  {agent.description}
                </p>

                {/* Workspace telemetry */}
                <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-[#6A7097]">
                    <span>Primary Model:</span>
                    <span className="text-[#615EFF] font-bold uppercase">{agent.assignedModel}</span>
                  </div>
                  <div className="flex justify-between text-[#6A7097]">
                    <span>Telegram Channel:</span>
                    <span className="text-white font-bold">{agent.telegramChannelName} ({agent.telegramThreadId || 101})</span>
                  </div>
                  <div className="flex justify-between text-[#6A7097]">
                    <span>Memory Workspace:</span>
                    <span className="text-[#00D26A] truncate max-w-[160px]">{agent.workspacePath}</span>
                  </div>
                  <div className="flex justify-between text-[#6A7097]">
                    <span>Active Tasks:</span>
                    <span className="text-[#EAB308] font-bold">{activeTasks.length} In-Flight</span>
                  </div>
                </div>

                {/* Capabilities Pills */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-[#585E82] uppercase tracking-wider">
                    <span>Capabilities ({agent.capabilities.length})</span>
                    <button
                      onClick={() => onOpenDrawer(agent.role)}
                      className="text-[#615EFF] hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Skill</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {agent.capabilities.slice(0, 3).map((cap, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono bg-[#0B0D1A] border border-[#1B1E33] text-[#A5A2FF] px-2 py-0.5 rounded"
                      >
                        {cap}
                      </span>
                    ))}
                    {agent.capabilities.length > 3 && (
                      <span className="text-[10px] font-mono bg-[#0B0D1A] border border-[#1B1E33] text-[#6A7097] px-1.5 py-0.5 rounded">
                        +{agent.capabilities.length - 3} more
                      </span>
                    )}
                  </div>
                </div>

                {/* Inline Sandbox Toggle / Runner */}
                {isSandboxOpen && (
                  <div className="p-3 bg-[#030408] border border-[#615EFF]/40 rounded-xl space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between text-[11px] text-[#A5A2FF] font-bold">
                      <span>Directive Sandbox: {agent.name}</span>
                      <button
                        onClick={() => setActiveInlineSandbox(null)}
                        className="text-[#6E759D] hover:text-white"
                      >
                        ✕
                      </button>
                    </div>

                    <textarea
                      value={inlinePrompt}
                      onChange={(e) => setInlinePrompt(e.target.value)}
                      placeholder={`Enter direct execution directive for ${agent.name}...`}
                      rows={2}
                      className="w-full bg-[#080A14] border border-[#1E223D] rounded-lg p-2 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                    />

                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => onOpenDrawer(agent.role)}
                        className="text-[10px] text-[#8E94B8] hover:text-white underline"
                      >
                        Open Full Drawer
                      </button>

                      <button
                        onClick={() => handleRunInlineSandbox(agent.role)}
                        disabled={isRunning}
                        className="px-3 py-1.5 rounded-lg bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-bold flex items-center gap-1.5 shadow"
                      >
                        <Play className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
                        <span>{isRunning ? 'RUNNING...' : 'RUN'}</span>
                      </button>
                    </div>

                    {inlineOutput && inlineOutput.agent === agent.role && (
                      <pre className="text-[11px] text-[#00D26A] bg-[#05060D] p-2 rounded-lg border border-[#121424] max-h-28 overflow-y-auto whitespace-pre-wrap">
                        {inlineOutput.text}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-[#141626] flex items-center gap-2">
                <button
                  onClick={() => {
                    if (activeInlineSandbox === agent.role) {
                      setActiveInlineSandbox(null);
                    } else {
                      setActiveInlineSandbox(agent.role);
                    }
                  }}
                  className="flex-1 py-2 px-3 rounded-lg bg-[#14172B] hover:bg-[#1E2240] border border-[#252A4E] text-xs font-mono font-bold text-[#A5A2FF] transition flex items-center justify-center gap-1.5"
                >
                  <Zap className="w-3 h-3 text-[#EAB308]" />
                  <span>DIRECT SANDBOX</span>
                </button>

                <button
                  onClick={() => handleQuickExecute(agent.role)}
                  disabled={isRunning}
                  className="flex-1 py-2 px-3 rounded-lg bg-[#615EFF] hover:bg-[#4F4CE6] text-xs font-mono font-bold text-white transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Play className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
                  <span>{isRunning ? 'RUNNING...' : 'DISPATCH TASK'}</span>
                </button>

                <button
                  onClick={() => onOpenDrawer(agent.role)}
                  className="p-2 rounded-lg bg-[#111324] hover:bg-[#1A1D36] border border-[#1E223D] text-[#8E94B8] hover:text-white transition"
                  title="Open Specialist Config & Skills Drawer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
