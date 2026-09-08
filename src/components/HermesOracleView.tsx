import React, { useState, useEffect, useCallback } from 'react';
import { AgentInfo, AIModelInfo, ObsidianNote, KanbanTask } from '../types';
import {
  Brain, Activity, Radio, Shield, Sparkles, RefreshCw,
  Terminal, Search, Layers, CheckCircle2, ArrowRight,
  Database, FileText, AlertTriangle, Play, Ban
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Pass X / Workstream F — this screen previously rendered a fully fabricated
// "Memory Signal Matrix": a hardcoded 15-agent array (INITIAL_AGENT_MEMORIES
// in src/data/agentDefinitions.ts) presenting invented per-agent memory
// sizes, "synapse connections," signal-health percentages, latency,
// throughput and error-rate numbers as real live telemetry, a hardcoded
// "15/15 SIGNALS ONLINE" banner, and per-file "SYNCED" badges for files that
// don't correspond to anything on disk. Worse: the "TEST SIGNAL" action's
// failure path fabricated a fake success ("responded in 74ms... Healthy")
// when the real query actually failed — silently converting a real error
// into a fake pass. None of that is here anymore.
//
// This app has no per-agent memory/telemetry instrumentation anywhere in
// its real backend — only one real signal exists for this screen: the
// Hermes dedicated runtime's health check (GET /api/hermes/health, already
// used honestly elsewhere — see AirbyteHeader/MasterAdminView). Everything
// else below is the real, static agent roster config already passed into
// this component as the `agents` prop (name, description, capabilities,
// rules, assigned model) — never fabricated numbers.
// ---------------------------------------------------------------------------

interface HermesOracleViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  notes: ObsidianNote[];
  tasks?: KanbanTask[];
  onSelectTab: (tab: any) => void;
  onSendQuery: (query: string, model: string) => Promise<string>;
  onAddNoteToVault?: (title: string, content: string, tags: string[]) => void;
}

interface HermesHealthReport {
  status: string;
  connectivity_status?: string;
  auth_status?: string;
  runtime_version?: string;
  process_alive?: boolean;
  error?: string;
}

export const HermesOracleView: React.FC<HermesOracleViewProps> = ({
  agents,
  onSelectTab,
  onSendQuery,
  onAddNoteToVault,
}) => {
  const agentList = Object.entries(agents);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>(agentList[0]?.[0] || '');
  const [health, setHealth] = useState<HermesHealthReport | null>(null);
  const [healthLatencyMs, setHealthLatencyMs] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testFailed, setTestFailed] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const activeAgent = agents[selectedAgentKey] || agentList[0]?.[1];

  const runHealthCheck = useCallback(async () => {
    setIsScanning(true);
    setScanMessage('Requesting real Hermes runtime health status...');
    const startTime = Date.now();
    try {
      const res = await fetch('/api/hermes/health');
      const json = await res.json().catch(() => ({ status: 'UNKNOWN' }));
      const latency = Date.now() - startTime;
      setHealth(json);
      setHealthLatencyMs(latency);
      setScanMessage(`Real Hermes health check complete (${latency}ms). Status: ${json.status || 'UNKNOWN'}.`);
    } catch (err: any) {
      setHealth({ status: 'UNKNOWN', error: err?.message || 'Request failed' });
      setHealthLatencyMs(null);
      setScanMessage(`Hermes health check failed: ${err?.message || 'request failed'}.`);
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  }, []);

  useEffect(() => {
    runHealthCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestAgentSignal = async (key: string) => {
    const ag = agents[key];
    if (!ag) return;
    setTestFailed(false);
    setTestOutput(`Sending a real diagnostic query to ${ag.name}...`);
    try {
      const reply = await onSendQuery(
        `Perform a brief self-diagnostic and report your current operating status.`,
        ag.assignedModel || key
      );
      setTestOutput(`[REAL RESPONSE — ${ag.name}]:\n${reply}`);
    } catch (e: any) {
      // Pass X fix — this previously fabricated a fake success message on a
      // real failure ("responded in 74ms... Healthy"). A real error is now
      // reported as a real error.
      setTestFailed(true);
      setTestOutput(`[QUERY FAILED — ${ag.name}]: ${e?.message || 'The query did not complete.'}`);
    }
  };

  const handleExportAgentConfigToObsidian = (agent: AgentInfo) => {
    if (!onAddNoteToVault) return;
    const title = `Agent-Config-${agent.name}-${new Date().toISOString().slice(0, 10)}`;
    const content = `# Agent Configuration: ${agent.name}
**Role**: ${agent.role}
**Title**: ${agent.title}
**Status**: ${agent.status}
**Assigned Model**: ${agent.assignedModel}${agent.secondaryModel ? ` (fallback: ${agent.secondaryModel})` : ''}

## Description
${agent.description}

## Capabilities
${(agent.capabilities || []).map((c) => `- ${c}`).join('\n') || '_None configured._'}

${agent.rules && agent.rules.length > 0 ? `## Operating Rules\n${agent.rules.map((r) => `- ${r}`).join('\n')}\n` : ''}
This is a real snapshot of this agent's static configuration — not measured runtime telemetry (no
per-agent memory/latency/throughput instrumentation exists in this app).

#hermes #agent-config #oracle #obsidian`;
    onAddNoteToVault(title, content, ['hermes', 'agent-config', selectedAgentKey]);
    setScanMessage(`Exported ${agent.name}'s real configuration to the Vault.`);
    setTimeout(() => setScanMessage(null), 3000);
  };

  const filteredAgents = agentList.filter(([, a]) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const healthColor = health?.status === 'UP' || health?.status === 'HEALTHY'
    ? '#00D26A'
    : health?.status === 'UNKNOWN'
      ? '#7E8BB5'
      : '#FF6B6B';

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              HERMES ORACLE • AGENT ROSTER & RUNTIME HEALTH
            </span>
            <span className="text-xs font-mono flex items-center gap-1" style={{ color: healthColor }}>
              <Activity className="w-3 h-3" />
              HERMES RUNTIME: {health ? health.status : '…'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Hermes Oracle & Agent Roster
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Real agent configuration (roster, capabilities, assigned models) and the one real Hermes runtime health signal this app actually measures.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={runHealthCheck}
            disabled={isScanning}
            className="airbyte-btn-secondary px-4 py-2.5 text-xs font-semibold flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 text-[#A5A2FF] ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'CHECKING...' : 'RECHECK HERMES HEALTH'}</span>
          </button>

          <button
            onClick={() => activeAgent && handleExportAgentConfigToObsidian(activeAgent)}
            disabled={!activeAgent || !onAddNoteToVault}
            className="airbyte-btn-primary px-4 py-2.5 text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#615EFF]/25 disabled:opacity-40"
          >
            <Database className="w-3.5 h-3.5" />
            <span>EXPORT CONFIG TO VAULT</span>
          </button>
        </div>
      </div>

      {scanMessage && (
        <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
          <span>{scanMessage}</span>
        </div>
      )}

      {/* Top Metric Cards — every value here is real */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="airbyte-card p-5 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Configured Agents</div>
          <div className="text-2xl font-extrabold text-white font-['Space_Grotesk']">
            {agentList.length}
          </div>
          <div className="text-[11px] text-[#8E94B8] font-mono">Real roster config</div>
        </div>

        <div className="airbyte-card p-5 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Hermes Runtime Status</div>
          <div className="text-2xl font-extrabold font-['Space_Grotesk']" style={{ color: healthColor }}>
            {health ? health.status : '…'}
          </div>
          <div className="text-[11px] text-[#8E94B8] font-mono">
            {health?.error ? health.error : 'GET /api/hermes/health'}
          </div>
        </div>

        <div className="airbyte-card p-5 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Capabilities Cataloged</div>
          <div className="text-2xl font-extrabold text-white font-['Space_Grotesk']">
            {agentList.reduce((acc, [, a]) => acc + (a.capabilities?.length || 0), 0)}
          </div>
          <div className="text-[11px] text-[#A5A2FF] font-mono">Across all configured agents</div>
        </div>

        <div className="airbyte-card p-5 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Last Health-Check Latency</div>
          <div className="text-2xl font-extrabold text-[#EC4899] font-['Space_Grotesk']">
            {healthLatencyMs !== null ? <>{healthLatencyMs} <span className="text-xs text-[#8E94B8] font-mono">ms</span></> : '—'}
          </div>
          <div className="text-[11px] text-[#8E94B8] font-mono">Real round-trip, not simulated</div>
        </div>
      </div>

      {/* Main Grid: Agent Roster & Detailed Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Agent Roster */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold uppercase text-white flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#615EFF]" />
              Agent Roster ({filteredAgents.length})
            </h2>
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#6E759D]" />
              <input
                type="text"
                placeholder="Filter agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2 py-1.5 bg-[#05060B] border border-[#1E223D] rounded-lg text-xs text-white placeholder-[#555B80] focus:outline-none focus:border-[#615EFF]"
              />
            </div>
          </div>

          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
            {filteredAgents.map(([key, a]) => {
              const isSelected = key === selectedAgentKey;
              return (
                <div
                  key={key}
                  onClick={() => setSelectedAgentKey(key)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-[#181B34] border-[#615EFF] shadow-md shadow-[#615EFF]/15'
                      : 'bg-[#0B0D1B] border-[#181B2E] hover:border-[#282D4E]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: a.status === 'active' ? '#00D26A' : a.status === 'busy' ? '#EAB308' : '#7E8BB5' }}
                    />
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        {a.name}
                      </div>
                      <div className="text-[10px] text-[#6E759D] font-mono flex items-center gap-2 mt-0.5">
                        <span>{a.capabilities?.length || 0} capabilities</span>
                        <span>•</span>
                        <span>{a.assignedModel}</span>
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#1A1D30] text-[#8E94B8] border border-[#282D4E] uppercase">
                    {a.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Agent Real Config Inspector */}
        <div className="lg:col-span-7 space-y-4">
          {activeAgent && (
            <div className="airbyte-card p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1A1D30] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white font-['Space_Grotesk']">
                      {activeAgent.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/40 uppercase">
                      {activeAgent.title}
                    </span>
                  </div>
                  <p className="text-xs text-[#8E94B8] mt-0.5">
                    {activeAgent.description}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTestAgentSignal(selectedAgentKey)}
                    className="px-3 py-1.5 rounded-lg bg-[#14172B] hover:bg-[#1E2342] border border-[#252A4E] text-[#00D26A] text-xs font-mono font-bold flex items-center gap-1.5 transition"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>SEND TEST QUERY</span>
                  </button>

                  <button
                    onClick={() => onSelectTab(`agent-${selectedAgentKey}` as any)}
                    className="px-3 py-1.5 rounded-lg bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-mono font-bold flex items-center gap-1.5 transition"
                  >
                    <span>VIEW AGENT</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Real assigned-model config */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-[#05060C] border border-[#181B2E] rounded-xl col-span-2">
                  <span className="text-[10px] font-mono text-[#6E759D] block uppercase">Assigned Model</span>
                  <span className="text-base font-bold text-white font-mono">{activeAgent.assignedModel}</span>
                </div>
                <div className="p-3 bg-[#05060C] border border-[#181B2E] rounded-xl col-span-2">
                  <span className="text-[10px] font-mono text-[#6E759D] block uppercase">Fallback Model</span>
                  <span className="text-base font-bold text-[#A5A2FF] font-mono">{activeAgent.secondaryModel || 'None configured'}</span>
                </div>
              </div>

              {/* Real capabilities list */}
              <div className="space-y-3">
                <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#A5A2FF]" />
                  Configured Capabilities
                </h4>
                {activeAgent.capabilities && activeAgent.capabilities.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeAgent.capabilities.map((cap, idx) => (
                      <div key={idx} className="p-2.5 bg-[#080A14] border border-[#181B2E] rounded-lg flex items-center gap-2 text-xs">
                        <FileText className="w-3.5 h-3.5 text-[#615EFF] shrink-0" />
                        <span className="font-mono text-gray-200">{cap}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-[#080A14] border border-[#181B2E] rounded-lg flex items-center gap-2 text-xs text-[#6A7097]">
                    <Ban className="w-3.5 h-3.5 shrink-0" />
                    No capabilities configured for this agent.
                  </div>
                )}
              </div>

              {/* Operating Rules & Guardrails — real, if present */}
              {activeAgent.rules && activeAgent.rules.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#EC4899]" />
                    Permanent Operating Rules & Guardrails
                  </h4>
                  <div className="space-y-1.5 bg-[#05060C] p-3 rounded-xl border border-[#181B2E]">
                    {activeAgent.rules.map((rule, i) => (
                      <div key={i} className="text-xs text-[#9AA2C6] flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#00D26A] mt-0.5 shrink-0" />
                        <span>{rule}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Real query test output */}
              {testOutput && (
                <div className={`p-4 border rounded-xl space-y-2 animate-fadeIn ${testFailed ? 'bg-[#2B0F13] border-[#FF6B6B]/40' : 'bg-[#05060C] border-[#615EFF]/40'}`}>
                  <div className={`text-[10px] font-mono uppercase flex items-center gap-1.5 ${testFailed ? 'text-[#FF6B6B]' : 'text-[#A5A2FF]'}`}>
                    {testFailed ? <AlertTriangle className="w-3.5 h-3.5" /> : <Terminal className="w-3.5 h-3.5" />}
                    {testFailed ? 'Real Query Failure' : 'Real Query Response'}
                  </div>
                  <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                    {testOutput}
                  </pre>
                </div>
              )}

              {/* Real Hermes runtime detail */}
              {health && (
                <div className="p-3.5 bg-[#080A14] border border-[#181B2E] rounded-xl flex items-center gap-2 text-xs">
                  <Radio className="w-3.5 h-3.5 shrink-0" style={{ color: healthColor }} />
                  <span className="text-[#8E94B8]">
                    Hermes dedicated runtime (shared across all agents, not per-agent):{' '}
                    <strong style={{ color: healthColor }}>{health.status}</strong>
                    {health.connectivity_status ? ` · connectivity: ${health.connectivity_status}` : ''}
                    {health.auth_status ? ` · auth: ${health.auth_status}` : ''}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
