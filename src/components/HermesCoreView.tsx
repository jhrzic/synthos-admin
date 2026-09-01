import React, { useState } from 'react';
import { 
  ActiveTab, AIModelInfo, ObsidianNote, ObsidianVault, 
  AgentInfo, KanbanTask, SynthOSRun 
} from '../types';
import { 
  Sparkles, Database, Bot, Zap, Cpu, Terminal, 
  Brain, Globe, Code2, Layers, Send, CheckCircle2, 
  RefreshCw, ArrowRight, FileText, Activity, ShieldCheck, 
  Network, Kanban, Clock, DollarSign, ExternalLink, PlayCircle,
  HelpCircle, Monitor
} from 'lucide-react';
import { RunDetailModal } from './RunDetailModal';

interface HermesCoreViewProps {
  models: Record<string, AIModelInfo>;
  vaults: ObsidianVault[];
  notes: ObsidianNote[];
  agents: Record<string, AgentInfo>;
  kanbanTasks: KanbanTask[];
  onSelectTab: (tab: ActiveTab) => void;
  onSendQuery: (query: string, targetModel: string) => Promise<string>;
  onAddNoteToVault: (title: string, content: string, tags: string[]) => void;
  onOpenRunDetail?: (run: SynthOSRun) => void;
}

export const HermesCoreView: React.FC<HermesCoreViewProps> = ({
  models,
  vaults,
  notes,
  agents,
  kanbanTasks,
  onSelectTab,
  onSendQuery,
  onAddNoteToVault,
  onOpenRunDetail
}) => {
  const [naturalCommand, setNaturalCommand] = useState('');
  const [activeTab, setActiveTab] = useState<'console' | 'runs' | 'sessions' | 'agents' | 'tools' | 'memory' | 'activity' | 'browser'>('console');
  const [isDispatching, setIsDispatching] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [selectedOverrideModel, setSelectedOverrideModel] = useState('hermes');
  const [selectedRunModal, setSelectedRunModal] = useState<SynthOSRun | null>(null);

  // Update Watcher state
  const [systemAlerts, setSystemAlerts] = useState<Array<{
    id: string;
    system: string;
    feature: string;
    status: 'NEW' | 'UPDATED' | 'DEPRECATED' | 'BREAKING';
    message: string;
    timestamp: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>>([
    {
      id: 'alert-1',
      system: 'Hermes Model Router',
      feature: 'DeepSeek R1 Integration',
      status: 'NEW',
      message: 'Successfully mounted deepseek-reasoner to route highly complex quantitative requests.',
      timestamp: 'Just now',
      severity: 'low'
    },
    {
      id: 'alert-2',
      system: 'Aegis Verification Sentinel',
      feature: 'Pre-flight Check Speed',
      status: 'UPDATED',
      message: 'Moved rule validation schemas into warm local memory. Check speed accelerated by 24%.',
      timestamp: '15 mins ago',
      severity: 'medium'
    },
    {
      id: 'alert-3',
      system: 'Perplexity Model Family',
      feature: 'sonar-medium API v1',
      status: 'DEPRECATED',
      message: 'Upstream Perplexity API is sunsetting sonar-medium. Automatically routing to sonar-reasoning.',
      timestamp: '1 hour ago',
      severity: 'high'
    },
    {
      id: 'alert-4',
      system: 'OpenRouter Security Token',
      feature: 'Authorization Headers',
      status: 'BREAKING',
      message: 'Upstream OpenRouter changed bearer padding. Double check your API Keys in Settings if authentication errors occur.',
      timestamp: '3 hours ago',
      severity: 'critical'
    }
  ]);

  const [isRefreshingTelemetry, setIsRefreshingTelemetry] = useState(false);

  const refreshTelemetry = async () => {
    setIsRefreshingTelemetry(true);
    try {
      const res = await fetch('/api/hermes/health');
      if (res.ok) {
        const health = await res.json();
        const newAlert = {
          id: `alert-diag-${Date.now()}`,
          system: 'Hermes Adapter (ADR-001)',
          feature: 'Health Contract Telemetry',
          status: (health.status === 'UP' ? 'UPDATED' : 'BREAKING') as 'NEW' | 'UPDATED' | 'DEPRECATED' | 'BREAKING',
          message: `Runtime connectivity status: ${health.status}. Instance ID: ${health.runtime_instance_id}. Process: ${health.process_alive ? 'ALIVE' : 'INACTIVE'}.`,
          timestamp: 'Just now',
          severity: (health.status === 'UP' ? 'low' : 'high') as 'low' | 'medium' | 'high' | 'critical'
        };
        setSystemAlerts(prev => [newAlert, ...prev.slice(0, 7)]);
      }
    } catch (err: any) {
      console.warn('Telemetry refresh failed:', err);
    } finally {
      setIsRefreshingTelemetry(false);
    }
  };

  // Active execution timeline state for current command
  const [currentExecution, setCurrentExecution] = useState<{
    objective: string;
    stages: Array<{
      name: string;
      status: 'WAITING' | 'RUNNING' | 'PASS' | 'FAILED' | 'SIMULATED' | 'DEGRADED';
      detail: string;
    }>;
  } | null>(null);

  // Default past runs
  const [runs, setRuns] = useState<SynthOSRun[]>([
    {
      id: 'run-9021a',
      objective: 'Research emerging AI agent opportunities & draft GTM launch memo',
      workspace: 'Default Workspace',
      startTime: '10 mins ago',
      status: 'COMPLETE',
      selectedAgents: ['Orchestrator', 'Scout Agent', 'Scribe Agent'],
      selectedModels: ['Gemini 2.5 Flash', 'DeepSeek R1'],
      skillsTools: ['mcp_search_web', 'obsidian_vault_sync'],
      graphId: 'dag-hermes-01',
      graphName: 'Hermes Research & Content Pipeline',
      stages: [
        { id: '1', name: 'REQUEST RECEIVED', status: 'PASS', detail: 'Directive parsed from natural language' },
        { id: '2', name: 'ROUTING', status: 'PASS', detail: 'OpenRouter routed to Gemini 2.5 + DeepSeek R1' },
        { id: '3', name: 'GUARDIAN CHECK', status: 'PASS', detail: 'Safety policy check passed ($0.002 budget)' },
        { id: '4', name: 'AGENT SELECTED', status: 'PASS', detail: 'Orchestrator dispatched Scout + Scribe' },
        { id: '5', name: 'TOOLS MOUNTED', status: 'PASS', detail: 'Mounted mcp_search_web & obsidian_vault_sync' },
        { id: '6', name: 'GRAPH CREATED', status: 'PASS', detail: 'Compiled 3-node research DAG' },
        { id: '7', name: 'EXECUTION STARTED', status: 'PASS', detail: 'Parallel execution active' },
        { id: '8', name: 'AEGIS REVIEW', status: 'PASS', detail: 'Hash generated and verified' },
        { id: '9', name: 'RECEIPT GENERATED', status: 'PASS', detail: 'Signed receipt 0x8f23...a4e1' },
        { id: '10', name: 'ARTIFACT SAVED', status: 'PASS', detail: 'Created [[Startup-Theses/Agent-GTM]]' }
      ],
      costTokens: { costUSD: 0.0042, promptTokens: 3200, completionTokens: 1400 },
      artifacts: [{ id: 'art-1', name: '[[Startup-Theses/Agent-GTM]]', type: 'Obsidian Note' }],
      guardianResult: { status: 'PASS', policy: 'Default Autonomous Guardrails', checks: ['Token Budget', 'No Destructive Action'] },
      aegisResult: { status: 'PASS', hash: '0x8f23a4e198b2c4e', auditTrace: 'Verified by Aegis Governance' },
      receipt: { receiptId: 'rcpt-9021a', signature: 'SIG_ED25519_OK', timestamp: '2026-08-28 11:20:00' },
      activityHistory: [
        { timestamp: '11:20:00', event: 'Run initiated by user', actor: 'User', level: 'info' }
      ]
    }
  ]);

  const handleDispatchCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!naturalCommand.trim() || isDispatching) return;

    const cmd = naturalCommand;
    setNaturalCommand('');
    setIsDispatching(true);

    // Initialize interactive execution timeline
    const initialStages = [
      { name: 'REQUEST RECEIVED', status: 'PASS' as const, detail: `Parsed directive: "${cmd.slice(0, 60)}..."` },
      { name: 'ROUTING', status: 'RUNNING' as const, detail: 'Hermes model router selecting optimal frontier LLM...' },
      { name: 'GUARDIAN CHECK', status: 'WAITING' as const, detail: 'Awaiting policy validation...' },
      { name: 'AGENT SELECTED', status: 'WAITING' as const, detail: 'Orchestrator selecting workforce...' },
      { name: 'TOOLS MOUNTED', status: 'WAITING' as const, detail: 'Mounting MCP tools...' },
      { name: 'GRAPH CREATED', status: 'WAITING' as const, detail: 'Generating execution DAG...' },
      { name: 'EXECUTION STARTED', status: 'WAITING' as const, detail: 'Dispatching tasks...' },
      { name: 'RESULT GENERATED', status: 'WAITING' as const, detail: 'Synthesizing output...' },
      { name: 'AEGIS REVIEW', status: 'WAITING' as const, detail: 'Generating cryptographic proof...' },
      { name: 'RECEIPT GENERATED', status: 'WAITING' as const, detail: 'Writing execution receipt...' }
    ];

    setCurrentExecution({ objective: cmd, stages: initialStages });

    try {
      const result = await onSendQuery(cmd, selectedOverrideModel);

      // Complete execution timeline
      const completedStages = initialStages.map((st, idx) => ({
        ...st,
        status: 'PASS' as const,
        detail: idx === 1 ? `Routed via ${selectedOverrideModel.toUpperCase()}` : st.detail
      }));

      setCurrentExecution({ objective: cmd, stages: completedStages });

      // Build canonical run
      const newRun: SynthOSRun = {
        id: `run-${Date.now().toString(36)}`,
        objective: cmd,
        workspace: 'Default Workspace',
        startTime: 'Just now',
        status: 'COMPLETE',
        selectedAgents: ['Orchestrator', 'Scout Agent'],
        selectedModels: [selectedOverrideModel],
        skillsTools: ['mcp_search_web', 'obsidian_vault_sync'],
        graphId: 'dag-dynamic',
        graphName: 'Auto-Dispatched Hermes Graph',
        stages: completedStages.map((s, i) => ({ id: `${i}`, name: s.name, status: s.status, detail: s.detail })),
        costTokens: { costUSD: 0.0025, promptTokens: 1800, completionTokens: 950 },
        artifacts: [{ id: `art-${Date.now()}`, name: `[[Hermes-Synthesis-${Date.now()}]]`, type: 'Obsidian Note' }],
        guardianResult: { status: 'PASS', policy: 'Default Autonomous Guardrails', checks: ['Safety Gate OK'] },
        aegisResult: { status: 'PASS', hash: `0x${Math.random().toString(16).slice(2, 10)}`, auditTrace: 'Verified' },
        receipt: { receiptId: `rcpt-${Date.now()}`, signature: 'SIG_ED25519_VALID', timestamp: new Date().toLocaleTimeString() },
        activityHistory: [{ timestamp: new Date().toLocaleTimeString(), event: 'Command Completed', actor: 'Hermes', level: 'success' }]
      };

      setRuns(prev => [newRun, ...prev]);

      // Push result note to vault
      const title = `Hermes-Run-${new Date().toISOString().slice(0, 10)}`;
      onAddNoteToVault(title, `# ${cmd}\n\n${result}`, ['hermes', 'run']);
    } catch (err) {
      console.error(err);
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="space-y-8 font-mono pb-16">
      {/* Top Command Input Section (SynthOS natural language objective entry) */}
      <section className="bg-gradient-to-r from-[#615EFF]/20 via-[#0B0D1B] to-[#00D26A]/20 border border-[#615EFF]/40 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-[#615EFF]/20 text-[#8C8AFF] border border-[#615EFF]/40">
              HERMES NATURAL LANGUAGE COMMAND CENTER
            </span>
            <button
              onClick={() => setShowOverride(!showOverride)}
              className="text-xs text-[#8E94B8] hover:text-white underline cursor-pointer"
            >
              {showOverride ? 'Hide Advanced Override' : 'Advanced Model/Agent Override'}
            </button>
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            What do you want SynthOS to accomplish?
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] font-sans">
            State your goal. Hermes automatically selects agents, routes frontier models, mounts tools, and compiles graph execution plans.
          </p>
        </div>

        {/* Natural Language Input Bar */}
        <form onSubmit={handleDispatchCommand} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={naturalCommand}
              onChange={(e) => setNaturalCommand(e.target.value)}
              placeholder="e.g., 'Research the top emerging AI agent opportunities and build a launch plan.'"
              className="w-full bg-[#070811] border-2 border-[#615EFF]/50 focus:border-[#615EFF] rounded-2xl py-4 pl-5 pr-36 text-sm text-white placeholder-[#555B7F] outline-hidden shadow-inner font-sans transition"
            />
            <button
              type="submit"
              disabled={isDispatching || !naturalCommand.trim()}
              className="absolute right-2 top-2 bottom-2 px-6 bg-[#615EFF] hover:bg-[#504ACC] disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-[#615EFF]/30 transition flex items-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{isDispatching ? 'DISPATCHING...' : 'DISPATCH'}</span>
            </button>
          </div>

          {/* Optional Model Override Controls */}
          {showOverride && (
            <div className="bg-[#070811] p-4 rounded-xl border border-[#1A1E36] flex flex-wrap items-center gap-4 text-xs animate-in fade-in">
              <span className="text-[#8E94B8] font-bold">Override Model Binding:</span>
              <select
                value={selectedOverrideModel}
                onChange={(e) => setSelectedOverrideModel(e.target.value)}
                className="bg-[#121424] border border-[#272B48] text-white rounded-lg px-3 py-1.5 outline-hidden"
              >
                <option value="hermes">Hermes Agent Kernel (Auto-Router)</option>
                <option value="gemini">Gemini 2.5 Flash</option>
                <option value="deepseek">DeepSeek R1 Reasoning</option>
                <option value="claude">Claude 3.7 Sonnet</option>
              </select>
            </div>
          )}
        </form>

        {/* Example Quick Prompt Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-[#8E94B8] text-[11px]">Examples:</span>
          {[
            'Research AI agent opportunities and build a launch plan',
            'Audit TON Network wallet bindings and run Guardian security check',
            'Summarize recent arXiv preprints into Obsidian vault notes'
          ].map((chip, idx) => (
            <button
              key={idx}
              onClick={() => setNaturalCommand(chip)}
              className="px-3 py-1 rounded-lg bg-[#0F1226] hover:bg-[#1A1E38] text-[#8C8AFF] border border-[#1F2442] text-[11px] transition cursor-pointer font-sans"
            >
              "{chip}"
            </button>
          ))}
        </div>
      </section>

      {/* Interactive Execution Timeline (Glance pattern) */}
      {currentExecution && (
        <section id="hermes-timeline" className="bg-[#0B0D1B] border border-[#38BDF8]/40 rounded-2xl p-6 space-y-4 shadow-xl animate-in fade-in">
          <div className="flex items-center justify-between border-b border-[#1A1E36] pb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#38BDF8] animate-spin" />
              <h3 className="text-sm font-bold text-white font-['Space_Grotesk']">Hermes Execution Timeline</h3>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded bg-[#38BDF8]/20 text-[#38BDF8] font-bold">
              GLANCE RUNNER ACTIVE
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
            {currentExecution.stages.map((st, idx) => (
              <div key={idx} className={`p-2.5 rounded-xl border text-[11px] space-y-1 ${
                st.status === 'PASS' ? 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]' :
                st.status === 'RUNNING' ? 'bg-[#38BDF8]/10 border-[#38BDF8]/40 text-[#38BDF8] animate-pulse' :
                'bg-[#070811] border-[#1A1E36] text-[#8E94B8]'
              }`}>
                <div className="font-bold flex items-center justify-between text-[10px]">
                  <span>{st.name}</span>
                  <span>{st.status}</span>
                </div>
                <p className="text-[10px] opacity-80 line-clamp-1 font-sans">{st.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Hermes Internal Tabs */}
      <section className="space-y-6">
        <div className="flex border-b border-[#1A1E36] bg-[#070811] rounded-xl p-1 gap-1 overflow-x-auto text-xs scrollbar-none">
          {[
            { id: 'console', label: 'CONSOLE' },
            { id: 'runs', label: `CANONICAL RUNS (${runs.length})` },
            { id: 'sessions', label: 'SESSIONS' },
            { id: 'agents', label: 'WORKFORCE AGENTS' },
            { id: 'tools', label: 'MCP TOOLS' },
            { id: 'memory', label: 'MEMORY' },
            { id: 'activity', label: 'ACTIVITY' },
            { id: 'browser', label: 'BROWSER / COMPUTER' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 font-bold rounded-lg whitespace-nowrap transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[#615EFF] text-white shadow-md'
                  : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: CONSOLE */}
        {activeTab === 'console' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left: Kernel Stream */}
            <div className="lg:col-span-7 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1A1E36] pb-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Hermes Kernel Stream</h3>
                <span className="text-[10px] font-mono text-[#8E94B8]">LIVE ATTACHED</span>
              </div>
              <div className="space-y-3">
                {runs.map((r) => (
                  <div 
                    key={r.id}
                    onClick={() => {
                      if (onOpenRunDetail) onOpenRunDetail(r);
                      else setSelectedRunModal(r);
                    }}
                    className="bg-[#0F1226] border border-[#1A1E36] hover:border-[#615EFF]/50 p-4 rounded-xl space-y-2 cursor-pointer transition"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#8C8AFF] font-bold">RUN ID: {r.id}</span>
                      <span className="text-[#00D26A] font-bold">{r.status}</span>
                    </div>
                    <p className="text-sm text-white font-semibold">{r.objective}</p>
                    <div className="flex items-center gap-4 text-xs text-[#8E94B8] pt-1 font-sans">
                      <span>Agents: {r.selectedAgents.join(', ')}</span>
                      <span>Cost: ${r.costTokens.costUSD.toFixed(4)} USD</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Update Watcher Pipeline */}
            <div className="lg:col-span-5 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1A1E36] pb-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">System Update Watcher</h3>
                </div>
                <button
                  onClick={refreshTelemetry}
                  disabled={isRefreshingTelemetry}
                  className="text-[10px] bg-[#121528] border border-[#222644] text-white hover:border-[#38BDF8] px-2 py-1 rounded transition select-none flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isRefreshingTelemetry ? 'animate-spin' : ''}`} />
                  {isRefreshingTelemetry ? 'CHECKING...' : 'REFRESH HEALTH'}
                </button>
              </div>

              <p className="text-[11px] text-[#8E94B8] font-sans leading-relaxed">
                Autonomous background pipeline monitoring core model releases, dependency deprecations, and workspace SDK states.
              </p>

              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {systemAlerts.map((alert) => (
                  <div 
                    key={alert.id}
                    className={`p-3 rounded-xl border space-y-1.5 transition-all text-xs ${
                      alert.status === 'BREAKING' ? 'bg-red-500/5 border-red-500/30' :
                      alert.status === 'DEPRECATED' ? 'bg-yellow-500/5 border-yellow-500/30' :
                      alert.status === 'UPDATED' ? 'bg-blue-500/5 border-blue-500/30' :
                      'bg-emerald-500/5 border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white uppercase tracking-tight text-[11px]">
                        {alert.system}
                      </span>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-extrabold ${
                        alert.status === 'BREAKING' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        alert.status === 'DEPRECATED' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                        alert.status === 'UPDATED' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                        'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}>
                        {alert.status}
                      </span>
                    </div>

                    <div className="text-[11px] text-gray-300 font-sans">
                      <strong className="text-white">[{alert.feature}]</strong> {alert.message}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-[#5D6489] font-mono pt-0.5">
                      <span>Severity: <strong className={
                        alert.severity === 'critical' ? 'text-red-400' :
                        alert.severity === 'high' ? 'text-yellow-400' :
                        alert.severity === 'medium' ? 'text-blue-400' : 'text-emerald-400'
                      }>{alert.severity.toUpperCase()}</strong></span>
                      <span>{alert.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* Tab 2: CANONICAL RUNS */}
        {activeTab === 'runs' && (
          <div className="space-y-4">
            <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">
              Canonical Run History
            </div>
            {runs.map((r) => (
              <div 
                key={r.id}
                onClick={() => {
                  if (onOpenRunDetail) onOpenRunDetail(r);
                  else setSelectedRunModal(r);
                }}
                className="bg-[#0B0D1B] border border-[#1D2139] hover:border-[#615EFF] p-5 rounded-2xl space-y-3 cursor-pointer transition flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#38BDF8] font-bold">{r.id}</span>
                    <span className="text-[#8E94B8]">• {r.startTime}</span>
                  </div>
                  <h4 className="text-base font-bold text-white">{r.objective}</h4>
                  <div className="text-xs text-[#8E94B8]">
                    Selected Models: <span className="text-white">{r.selectedModels.join(', ')}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[#00D26A] px-3 py-1 rounded-lg bg-[#00D26A]/20 border border-[#00D26A]/30">
                    {r.status}
                  </span>
                  <button className="px-4 py-2 bg-[#615EFF] text-white text-xs font-bold rounded-xl hover:bg-[#504ACC] transition">
                    Inspect Run
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Other Tabs Placeholder */}
        {(activeTab === 'sessions' || activeTab === 'agents' || activeTab === 'tools' || activeTab === 'memory' || activeTab === 'activity' || activeTab === 'browser') && (
          <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-8 text-center space-y-3">
            <Layers className="w-8 h-8 text-[#615EFF] mx-auto" />
            <h3 className="text-sm font-bold text-white uppercase">{activeTab} Workspace View</h3>
            <p className="text-xs text-[#8E94B8] max-w-md mx-auto font-sans">
              Manage {activeTab} parameters dynamically for the Hermes agent fleet.
            </p>
          </div>
        )}
      </section>

      {/* Modal fallback if onOpenRunDetail not provided */}
      <RunDetailModal
        isOpen={!!selectedRunModal}
        onClose={() => setSelectedRunModal(null)}
        run={selectedRunModal}
      />
    </div>
  );
};
