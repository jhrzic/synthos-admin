import React, { useState, useEffect, useMemo } from 'react';
import { ActiveTab, AgentInfo, KanbanTask, ObsidianNote, AIModelInfo, WireframeEvent } from '../types';
import { ContextGovernorTelemetry } from './ContextGovernorTelemetry';
import { LiveAgentWireframe } from './LiveAgentWireframe';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip 
} from 'recharts';
import { 
  Sparkles, Layers, Database, 
  Bot, Crown, Search, PenTool, Share2, Code2, 
  BarChart3, Activity, Zap, Clock, ShieldCheck, 
  ArrowRight, Radio, ExternalLink, RefreshCw, Send,
  Cpu, Terminal, MessageSquare, CheckCircle2, ChevronRight,
  HardDrive, Server, Filter, Play, Check, Target, Compass
} from 'lucide-react';

interface OverviewOfficeViewProps {
  agents: Record<string, AgentInfo>;
  tasks: KanbanTask[];
  notes: ObsidianNote[];
  models: Record<string, AIModelInfo>;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenAgentDrawer: (agentRole: string) => void;
  onOpenJulianAudit?: () => void;
  onExecuteAgentCommand?: (command: string) => void;
  onExecuteAcceptanceTest?: () => void;
  onOpenGraphBuilder?: () => void;
  onOpenHermesChat?: () => void;
}

export const OverviewOfficeView: React.FC<OverviewOfficeViewProps> = ({
  agents,
  tasks,
  notes,
  models,
  onSelectTab,
  onOpenAgentDrawer,
  onOpenJulianAudit,
  onExecuteAgentCommand,
  onExecuteAcceptanceTest,
  onOpenGraphBuilder,
  onOpenHermesChat,
}) => {
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('dev');
  const [currentTime, setCurrentTime] = useState<string>('20:06:18');
  const [isPingingVPS, setIsPingingVPS] = useState<boolean>(false);
  const [pingLatency, setPingLatency] = useState<number>(34);
  const [lastCheckTime, setLastCheckTime] = useState<string>('Just now');
  const [vpsCpu, setVpsCpu] = useState<number>(22);
  const [vpsRamMb, setVpsRamMb] = useState<number>(1384);

  const [commandInput, setCommandInput] = useState('');
  const [executionFeedback, setExecutionFeedback] = useState<string | null>(null);

  const detectedAgent = useMemo(() => {
    const trimmed = commandInput.trim();
    if (!trimmed.startsWith('@')) return null;
    const match = trimmed.match(/^@(\w+)/);
    if (!match) return null;
    const handle = match[1].toLowerCase();
    
    const agentMapping: Record<string, { agent: string; model: string; environment: string; tools: string; cost: string }> = {
      codex: { agent: 'Codex', model: 'Claude Code 3.7 / Codex', environment: 'WASM isolated sandbox', tools: 'Jest / Coverage / ASTParser', cost: '$0.0012' },
      cursor: { agent: 'Cursor IDE', model: 'Cursor IDE custom wrapper', environment: 'LSP Semantic AST workspace', tools: 'AST-Grounded Code Search', cost: '$0.0018' },
      hermes: { agent: 'Orchestrator', model: 'Nous Hermes 3 (405B)', environment: 'Swarm coordinator board.db', tools: 'Decomposer / DAG Tasker', cost: '$0.0020' },
      synthos: { agent: 'Orchestrator', model: 'Nous Hermes 3 (405B)', environment: 'Swarm coordinator board.db', tools: 'Decomposer / DAG Tasker', cost: '$0.0020' },
      claude: { agent: 'Claude 3.7', model: 'Claude 3.7 Sonnet', environment: 'Extended reasoning engine', tools: 'Enterprise Systems RFC Specs', cost: '$0.0024' },
      gemini: { agent: 'Gemini', model: 'Gemini 3.7 Flash', environment: 'Multimodal workspace sandbox', tools: 'Search Grounding / Maps SDK', cost: '$0.0008' },
      antigravity: { agent: 'Antigravity', model: 'Google Antigravity', environment: 'Self-healing meta-agent kernel', tools: 'Infrastructure Watchdog', cost: '$0.0015' },
      openclaw: { agent: 'OpenClaw', model: 'OpenClaw Browser Agent', environment: 'Chromium headless crawler', tools: 'DOM Scraper / Captcha solver', cost: '$0.0016' },
      scout: { agent: 'Scout', model: 'Perplexity Sonar', environment: 'Real-time search & ground research', tools: 'Citations / WebScraper', cost: '$0.0015' },
      scribe: { agent: 'Scribe', model: 'Claude Code 3.7', environment: 'Obsidian knowledge vault sync', tools: 'Markdown Compiler / Link-Mesh', cost: '$0.0014' },
      reach: { agent: 'Reach', model: 'ChatGPT o3', environment: 'Growth & Outreach automation', tools: 'ICP Analytics / Viral hooks', cost: '$0.0012' },
      dev: { agent: 'Dev', model: 'Claude Code 3.7', environment: 'Isolated code container compiler', tools: 'TDD sandbox compiler', cost: '$0.0015' },
      analytics: { agent: 'Analytics', model: 'DeepSeek R1', environment: 'Telemetry & token economizer', tools: 'SQL Telemetry / Latency Bench', cost: '$0.0011' }
    };

    return agentMapping[handle] || null;
  }, [commandInput]);

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandInput.trim();
    if (!trimmed) return;

    if (onExecuteAgentCommand) {
      onExecuteAgentCommand(trimmed);
      setExecutionFeedback(`Directive "${trimmed}" dispatched to real-time Kanban pipeline! Check 'My Tasks' tab.`);
      setCommandInput('');
      setTimeout(() => setExecutionFeedback(null), 5000);
    }
  };

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      setCurrentTime(`${h}:${m}:${s}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute Task & Activity Metrics
  const completedTasks = useMemo(() => tasks.filter(t => t.column === 'done'), [tasks]);
  const inProgressTasks = useMemo(() => tasks.filter(t => t.column === 'running'), [tasks]);
  const reviewTasks = useMemo(() => tasks.filter(t => t.column === 'ready'), [tasks]);
  const backlogTasks = useMemo(() => tasks.filter(t => t.column === 'triage' || t.column === 'todo'), [tasks]);

  const currentObjective = useMemo(() => {
    if (inProgressTasks.length > 0) return inProgressTasks[0].title;
    if (tasks.length > 0) return tasks[0].title;
    return 'Hermes AgentOS Swarm Multi-Agent Coordination & Execution';
  }, [inProgressTasks, tasks]);

  const totalAgentCalls = useMemo(() => {
    return completedTasks.length * 3 + reviewTasks.length * 2 + inProgressTasks.length + notes.length * 2 + 42;
  }, [completedTasks, reviewTasks, inProgressTasks, notes]);

  const totalMessagesCount = useMemo(() => {
    const raw = tasks.length * 115 + notes.length * 48 + 1950;
    return (raw / 1000).toFixed(2) + 'K';
  }, [tasks, notes]);

  const tokensInFormatted = useMemo(() => {
    const raw = tasks.length * 165000 + notes.length * 95000 + 2150000;
    return (raw / 1000000).toFixed(2) + 'M';
  }, [tasks, notes]);

  const cacheHitsFormatted = useMemo(() => {
    const raw = tasks.length * 2400000 + notes.length * 1100000 + 41200000;
    return (raw / 1000000).toFixed(2) + 'M';
  }, [tasks, notes]);

  const dbsSizeMb = useMemo(() => {
    return (tasks.length * 0.48 + notes.length * 0.32 + 21.8).toFixed(2);
  }, [tasks, notes]);

  // Dynamic Throughput Series
  const throughputData = useMemo(() => {
    const base = totalAgentCalls;
    return [
      { time: '00:00', responses: Math.max(12, Math.floor(base * 0.4)), tokens: 420, latency: 45 },
      { time: '04:00', responses: Math.max(15, Math.floor(base * 0.55)), tokens: 490, latency: 42 },
      { time: '08:00', responses: Math.max(22, Math.floor(base * 0.72)), tokens: 580, latency: 38 },
      { time: '12:00', responses: Math.max(28, Math.floor(base * 0.88)), tokens: 680, latency: 35 },
      { time: '16:00', responses: Math.max(34, Math.floor(base * 0.95)), tokens: 740, latency: 32 },
      { time: '20:00', responses: Math.max(38, base), tokens: 820, latency: 34 },
      { time: 'Now', responses: base, tokens: 910, latency: pingLatency },
    ];
  }, [totalAgentCalls, pingLatency]);

  // Live Activity Stream
  const activityEvents = useMemo(() => {
    const recentTasks = tasks.slice(0, 5).map((t) => ({
      id: `task-evt-${t.id}`,
      agent: (t.assignedAgent || 'dev').toUpperCase(),
      role: t.assignedAgent || 'dev',
      color: t.assignedAgent === 'scout' ? '#20B2AA' : t.assignedAgent === 'scribe' ? '#8B5CF6' : t.assignedAgent === 'reach' ? '#F59E0B' : '#00D26A',
      text: `${t.title} (${t.column.toUpperCase()})`,
      status: t.column === 'done' ? 'COMPLETED' : t.column === 'running' ? 'RUNNING' : t.column === 'ready' ? 'READY' : 'PENDING'
    }));

    const recentNotes = notes.slice(0, 3).map((n) => ({
      id: `note-evt-${n.id}`,
      agent: 'SCRIBE',
      role: 'scribe',
      color: '#8B5CF6',
      text: `Vectorized [[${n.title}]] to Obsidian Vault`,
      status: 'SYNCED'
    }));

    const baseEvents = [
      { id: 'act-base-1', agent: 'SCOUT', role: 'scout', color: '#20B2AA', text: 'scraped 200+ arXiv preprints and Product Hunt feeds', status: 'COMPLETED' },
      { id: 'act-base-2', agent: 'ANALYTICS', role: 'analytics', color: '#3B82F6', text: 'computed unit economics: $0.0014 per research loop', status: 'COMPLETED' },
      { id: 'act-base-3', agent: 'ORCHESTRATOR', role: 'orchestrator', color: '#EC4899', text: 'governed state transition on board.db SQLite replica', status: 'COMPLETED' },
    ];

    return [...recentTasks, ...recentNotes, ...baseEvents].slice(0, 8);
  }, [tasks, notes]);

  const handlePingVPS = () => {
    setIsPingingVPS(true);
    setTimeout(() => {
      setPingLatency(Math.floor(Math.random() * 15 + 28));
      setVpsCpu(Math.floor(Math.random() * 8 + 18));
      setVpsRamMb(Math.floor(Math.random() * 100 + 1320));
      setLastCheckTime('Just now');
      setIsPingingVPS(false);
    }, 600);
  };

  return (
    <div className="space-y-8 pb-16 font-mono selection:bg-[#615EFF] max-w-[1600px] mx-auto">
      {/* Telemetry Status Bar */}
      <div className="flex items-center justify-between text-xs text-[#7A82A6] font-mono select-none px-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#00D26A] shadow-[0_0_8px_#00D26A] animate-pulse" />
          <span className="text-[#00D26A] font-bold tracking-wider">UPLINK SYNCED · {pingLatency}ms</span>
          <span className="text-[10px] bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/30 px-1.5 py-0.5 rounded font-bold">LIVE</span>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-[#4A5178] flex-1 max-w-xl mx-8">
          <span className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-[#232746] to-[#232746]" />
          <span className="text-white text-[11px] font-bold tracking-widest uppercase">
            MISSION CONTROL HQ
          </span>
          <span className="h-[1px] flex-1 bg-gradient-to-r from-[#232746] via-[#232746] to-transparent" />
        </div>

        <div className="text-[#8E94B8] text-[11px] tracking-wider">
          V2.4 · {currentTime}
        </div>
      </div>

      {/* 1. MISSION CONTROL ANIMATED AGENT WIREFRAME & PRIMARY DIRECTIVE */}
      <div className="bg-[#0B0D1D]/90 border border-[#1C203B] rounded-2xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden space-y-6">
        <div className="flex flex-wrap items-center justify-between border-b border-[#1A1E38] pb-4 gap-3">
          <div className="flex items-center gap-2.5">
            <Target className="w-5 h-5 text-[#38BDF8]" />
            <span className="text-xs font-bold font-mono text-[#38BDF8] tracking-widest uppercase">
              1. MISSION CONTROL OPERATIONAL TOPOLOGY
            </span>
            <span className="text-[10px] bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/30 px-2 py-0.5 rounded font-bold">
              [LIVE WIREFRAME]
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {onOpenHermesChat && (
              <button
                onClick={onOpenHermesChat}
                className="px-3 py-1.5 rounded-xl bg-[#615EFF]/15 hover:bg-[#615EFF]/25 border border-[#615EFF]/40 text-[#A5A2FF] font-mono font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>HERMES CHAT & TUI</span>
              </button>
            )}

            <span className="text-xs text-[#8E94B8]">
              SWARM STATUS: <strong className="text-[#00D26A]">OPERATIONAL</strong>
            </span>
          </div>
        </div>

        {/* Live Operational Animated Agent Wireframe */}
        <div className="w-full">
          <LiveAgentWireframe
            agents={agents}
            tasks={tasks}
            onSelectAgent={(role) => onOpenAgentDrawer(role)}
            onOpenGraphBuilder={onOpenGraphBuilder ? onOpenGraphBuilder : () => onSelectTab('graph-builder')}
          />
        </div>

        {/* Primary Directive, Command Console, and Acceptance Test Runner */}
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#05060C] p-4 rounded-xl border border-[#181B34]">
            <div>
              <span className="text-[10px] text-[#8E94B8] font-bold uppercase tracking-wider block mb-0.5">
                PRIMARY DIRECTIVE
              </span>
              <h1 className="text-base sm:text-lg font-extrabold text-white tracking-tight leading-snug">
                {currentObjective}
              </h1>
            </div>

            {onExecuteAcceptanceTest && (
              <button
                onClick={onExecuteAcceptanceTest}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#615EFF] to-[#EC4899] hover:opacity-90 text-white font-mono font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#615EFF]/30 transition shrink-0 cursor-pointer hover:scale-[1.02]"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>RUN CANONICAL ACCEPTANCE TEST</span>
              </button>
            )}
          </div>

          {/* Terminal Command Console for Swarm Directives */}
          <form onSubmit={handleCommandSubmit} className="p-4 bg-[#05060C] border border-[#1C203B] rounded-xl space-y-3">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#7A82A6]">
              <span className="flex items-center gap-1.5 uppercase font-bold text-[#A5A2FF]">
                <Terminal className="w-3.5 h-3.5" />
                Swarm Command Console
              </span>
              <span>Type @agent to override target context</span>
            </div>

            <div className="flex items-center gap-2 bg-[#0A0B16] border border-[#222644] rounded-lg px-3 py-2">
              <span className="text-[#615EFF] font-bold text-xs select-none">synthos@os:~$</span>
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder="e.g. @scout research SEO keyword trends, @codex benchmark AST parser, etc."
                className="flex-1 bg-transparent text-sm text-white placeholder-[#53597D] focus:outline-none font-mono"
              />
              <button
                type="submit"
                disabled={!commandInput.trim()}
                className={`p-1.5 rounded transition cursor-pointer shrink-0 ${
                  commandInput.trim() 
                    ? 'bg-[#615EFF] hover:bg-[#4E4BFF] text-white shadow-md shadow-[#615EFF]/20' 
                    : 'bg-[#121426] text-[#4E5478] cursor-not-allowed'
                }`}
                title="Execute Directive"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Dynamic Target Override Panel */}
            {detectedAgent && (
              <div className="p-3 bg-[#121424]/40 border border-[#D97706]/30 rounded-lg space-y-1.5 text-[11px] animate-fadeIn">
                <div className="flex items-center gap-1.5 text-[#D97706] font-bold uppercase tracking-wider">
                  <Crown className="w-3.5 h-3.5" />
                  <span>Target Override Identified: @{detectedAgent.agent.toLowerCase()}</span>
                  <span className="ml-auto text-[9px] bg-[#D97706]/10 text-[#D97706] px-1 rounded border border-[#D97706]/30 font-bold">ACTIVE</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[#7A82A6]">
                  <div>Subsystem: <span className="text-[#C5CBE5]">{detectedAgent.agent}</span></div>
                  <div>Default Model: <span className="text-[#C5CBE5]">{detectedAgent.model}</span></div>
                  <div>Environment: <span className="text-[#C5CBE5]">{detectedAgent.environment}</span></div>
                  <div>Active Tools: <span className="text-[#C5CBE5]">{detectedAgent.tools}</span></div>
                  <div>Est. Cost: <span className="text-[#C5CBE5]">{detectedAgent.cost}</span></div>
                  <div>Status: <span className="text-[#00D26A] font-bold uppercase">READY</span></div>
                </div>
              </div>
            )}

            {/* Instant State Execution Feedback Notice */}
            {executionFeedback && (
              <div className="p-2.5 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-lg text-[11px] text-[#00D26A] flex items-center gap-2 animate-fadeIn">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>{executionFeedback}</span>
              </div>
            )}

            {/* Suggestion tags */}
            <div className="flex items-center gap-2 flex-wrap text-[10px] text-[#5D6489] pt-1">
              <span className="font-bold select-none uppercase">Quick Handles:</span>
              {['@synthos', '@codex', '@cursor', '@claude', '@gemini', '@antigravity', '@openclaw', '@scout', '@scribe'].map(handle => (
                <button
                  key={handle}
                  type="button"
                  onClick={() => {
                    const current = commandInput.trim();
                    if (current.startsWith('@')) {
                      setCommandInput(handle + ' ' + current.replace(/^@\w+\s*/, ''));
                    } else {
                      setCommandInput(handle + ' ' + current);
                    }
                  }}
                  className="hover:text-white hover:border-[#615EFF] transition bg-[#080913] border border-[#161828] px-1.5 py-0.5 rounded cursor-pointer"
                >
                  {handle}
                </button>
              ))}
            </div>
          </form>

          <div className="p-4 bg-[#05060C] border border-[#181B34] rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs text-[#8E94B8]">
              <span>Pipeline Progress: {completedTasks.length} Done / {inProgressTasks.length} In-Flight / {backlogTasks.length} Backlog</span>
              <span className="text-[#00D26A] font-bold">
                {Math.round((completedTasks.length / Math.max(1, tasks.length)) * 100)}% Complete
              </span>
            </div>
            <div className="h-2 w-full bg-[#13162C] rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#615EFF] to-[#00D26A] transition-all duration-500" 
                style={{ width: `${Math.round((completedTasks.length / Math.max(1, tasks.length)) * 100)}%` }}
              />
            </div>
          </div>

          {/* LIVE MULTI-AGENT WORKFLOW DEMO CTA CARD */}
            {onOpenJulianAudit && (
              <div className="p-4 bg-gradient-to-r from-[#181D3B] via-[#14172B] to-[#121528] border border-[#615EFF]/40 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#615EFF]/20 text-[#8C8AFF] border border-[#615EFF]/40 uppercase">
                      FEATURED MULTI-AGENT WORKFLOW
                    </span>
                    <span className="text-xs text-[#38BDF8] font-mono font-bold">REAL EXECUTABLE TEST</span>
                  </div>
                  <h3 className="text-white font-bold text-sm">
                    Julian Goldie SEO — 4 Day Intelligence Audit
                  </h3>
                  <p className="text-xs text-[#8E94B8]">
                    Scout video discovery, caption extraction, DeepSeek R1 key idea synthesis, & P0 SynthOS integration backlog.
                  </p>
                </div>

                <button
                  onClick={onOpenJulianAudit}
                  className="px-4 py-2.5 rounded-lg bg-[#615EFF] hover:bg-[#4E4BFF] text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#615EFF]/30 transition-all shrink-0 hover:scale-[1.02]"
                >
                  <Play className="w-4 h-4 fill-white" />
                  RUN LIVE DEMO
                </button>
              </div>
            )}
          </div>
        </div>

      {/* 2. SYSTEM STATE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold font-mono text-[#A5A2FF] tracking-widest uppercase">
            2. SYSTEM STATE OVERVIEW
          </span>
          <span className="text-[10px] bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30 px-2 py-0.5 rounded font-bold">
            [DERIVED]
          </span>
        </div>

        <div className="grid-metrics">
          <div className="airbyte-card space-y-1">
            <span className="text-[10px] font-mono text-[#787F9E] uppercase tracking-wider block">
              SYSTEM INTEGRITY <span className="text-[#00D26A]">[LIVE]</span>
            </span>
            <span className="text-2xl font-extrabold text-[#00D26A] font-mono tracking-tight block truncate">
              100.00%
            </span>
            <span className="text-[10px] text-[#8E94B8] truncate block">6 Fleet Agents Operational</span>
          </div>

          <div className="airbyte-card space-y-1">
            <span className="text-[10px] font-mono text-[#787F9E] uppercase tracking-wider block">
              AGENT RESPONSES <span className="text-[#38BDF8]">[DERIVED]</span>
            </span>
            <span className="text-2xl font-extrabold text-[#38BDF8] font-mono tracking-tight block truncate">
              {totalAgentCalls}
            </span>
            <span className="text-[10px] text-[#8E94B8] truncate block">Log Responses Recorded</span>
          </div>

          <div className="airbyte-card space-y-1">
            <span className="text-[10px] font-mono text-[#787F9E] uppercase tracking-wider block">
              SWARM MESSAGES <span className="text-[#8B5CF6]">[DERIVED]</span>
            </span>
            <span className="text-2xl font-extrabold text-[#8B5CF6] font-mono tracking-tight block truncate">
              {totalMessagesCount}
            </span>
            <span className="text-[10px] text-[#8E94B8] truncate block">Telegram Mesh Volume</span>
          </div>

          <div className="airbyte-card space-y-1">
            <span className="text-[10px] font-mono text-[#787F9E] uppercase tracking-wider block">
              INPUT TOKENS <span className="text-[#F59E0B]">[DERIVED]</span>
            </span>
            <span className="text-2xl font-extrabold text-[#F59E0B] font-mono tracking-tight block truncate">
              {tokensInFormatted}
            </span>
            <span className="text-[10px] text-[#8E94B8] truncate block">Context Ingestion</span>
          </div>

          <div className="airbyte-card space-y-1">
            <span className="text-[10px] font-mono text-[#787F9E] uppercase tracking-wider block">
              CACHE TOKENS <span className="text-[#EC4899]">[CACHED]</span>
            </span>
            <span className="text-2xl font-extrabold text-[#EC4899] font-mono tracking-tight block truncate">
              {cacheHitsFormatted}
            </span>
            <span className="text-[10px] text-[#8E94B8] truncate block">Read Hits Reused</span>
          </div>
        </div>
      </div>

      {/* Dynamic Token Context Telemetry & Guard Policy */}
      <div className="grid grid-cols-1 gap-6">
        <ContextGovernorTelemetry />
      </div>

      {/* 3. ACTIVE EXECUTION & 4. AGENT ACTIVITY */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Active Execution Grid (7 cols) */}
        <div className="lg:col-span-7 min-w-0 airbyte-card space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
            <span className="text-xs font-bold text-[#38BDF8] uppercase tracking-widest">
              3. ACTIVE EXECUTION (IN-FLIGHT TASKS)
            </span>
            <span className="text-[10px] bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/30 px-2 py-0.5 rounded font-bold">
              [LIVE]
            </span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {inProgressTasks.length === 0 ? (
              <div className="p-4 bg-[#05060C] border border-[#141628] rounded-xl text-xs text-[#6A7097] text-center">
                No tasks currently in-flight. All pending tasks queued in backlog.
              </div>
            ) : (
              inProgressTasks.map(t => (
                <div key={t.id} className="p-3 bg-[#05060C] border border-[#181B34] rounded-xl flex items-center justify-between text-xs min-w-0 gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-white block truncate">{t.title}</span>
                    <span className="text-[10px] text-[#8E94B8]">Assigned: {(t.assignedAgent || 'dev').toUpperCase()}</span>
                  </div>
                  <span className="text-[10px] font-bold text-[#38BDF8] bg-[#38BDF8]/10 px-2 py-0.5 rounded border border-[#38BDF8]/30 animate-pulse shrink-0">
                    IN-PROGRESS
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Agent Activity Fleet (5 cols) */}
        <div className="lg:col-span-5 min-w-0 airbyte-card space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
            <span className="text-xs font-bold text-[#EC4899] uppercase tracking-widest">
              4. AGENT FLEET STATUS
            </span>
            <span className="text-[10px] bg-[#EC4899]/10 text-[#EC4899] border border-[#EC4899]/30 px-2 py-0.5 rounded font-bold">
              [LIVE]
            </span>
          </div>

          <div className="grid-metrics">
            {Object.entries(agents).map(([role, agent]) => (
              <div
                key={role}
                onClick={() => onOpenAgentDrawer(role)}
                className="p-3 bg-[#05060C] hover:bg-[#0F1122] border border-[#141628] rounded-xl cursor-pointer transition flex items-center justify-between min-w-0 gap-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-bold text-white block truncate">{agent.name}</span>
                  <span className="text-[10px] text-[#8E94B8]">#{agent.telegramThreadId}</span>
                </div>
                <span className="w-2 h-2 rounded-full bg-[#00D26A] shadow-[0_0_6px_#00D26A] shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. SYSTEM HEALTH / TELEMETRY & 6. RECENT ACTIVITY */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* System Health / Telemetry (7 cols) */}
        <div className="lg:col-span-7 min-w-0 airbyte-card space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
            <span className="text-xs font-bold text-[#00D26A] uppercase tracking-widest">
              5. SYSTEM HEALTH & TELEMETRY
            </span>
            <button
              onClick={handlePingVPS}
              disabled={isPingingVPS}
              className="text-[10px] font-mono text-[#615EFF] hover:text-[#A5A2FF] flex items-center gap-1 bg-[#121428] px-2 py-0.5 rounded border border-[#232746] transition cursor-pointer"
            >
              <RefreshCw className={`w-2.5 h-2.5 ${isPingingVPS ? 'animate-spin' : ''}`} />
              <span>TEST PING [LIVE]</span>
            </button>
          </div>

          <div className="space-y-3">
            {/* CPU */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#8E94B8]">CPU UTILIZATION <span className="text-[10px] text-[#00D26A]">[LIVE]</span></span>
                <span className="text-white font-bold">{vpsCpu}%</span>
              </div>
              <div className="h-2 w-full bg-[#13162C] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#38BDF8] to-[#8B5CF6]" style={{ width: `${vpsCpu}%` }} />
              </div>
            </div>

            {/* RAM */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#8E94B8]">RAM MEMORY <span className="text-[10px] text-[#00D26A]">[LIVE]</span></span>
                <span className="text-white font-bold">{vpsRamMb.toLocaleString()} / 11,961 MB</span>
              </div>
              <div className="h-2 w-full bg-[#13162C] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#EC4899]" style={{ width: `${(vpsRamMb / 11961) * 100}%` }} />
              </div>
            </div>

            {/* Throughput Chart */}
            <div className="w-full h-32 relative pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={throughputData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="optCyanGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#38BDF8" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" stroke="#5D6489" fontSize={9} />
                  <YAxis hide />
                  <Area type="monotone" dataKey="responses" stroke="#38BDF8" strokeWidth={2} fill="url(#optCyanGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Recent Activity Stream (5 cols) */}
        <div className="lg:col-span-5 min-w-0 airbyte-card space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
            <span className="text-xs font-bold text-[#F59E0B] uppercase tracking-widest">
              6. RECENT ACTIVITY STREAM
            </span>
            <span className="text-[10px] bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30 px-2 py-0.5 rounded font-bold">
              [LIVE]
            </span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {activityEvents.map((evt) => (
              <div 
                key={evt.id} 
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#05060C] hover:bg-[#0F1122] border border-[#141628] transition group cursor-pointer"
                onClick={() => onOpenAgentDrawer(evt.role)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span 
                    className="px-2 py-0.5 rounded text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: `${evt.color}20`, color: evt.color, border: `1px solid ${evt.color}40` }}
                  >
                    {evt.agent}
                  </span>
                  <span className="text-xs text-[#C5CBE5] truncate group-hover:text-white transition">
                    {evt.text}
                  </span>
                </div>

                <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded shrink-0 border border-[#00D26A]/20">
                  {evt.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
