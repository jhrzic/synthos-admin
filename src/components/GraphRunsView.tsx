import React, { useState } from 'react';
import { ActiveTab } from '../types';
import { 
  Play, CheckCircle2, AlertCircle, Clock, RefreshCw, 
  Activity, ArrowRight, GitMerge, FileText, Database, 
  Search, Shield, Layers, ChevronRight
} from 'lucide-react';

interface GraphRunRecord {
  id: string;
  graphName: string;
  templateId: string;
  status: 'SUCCESS' | 'RUNNING' | 'FAILED';
  startedAt: string;
  duration: string;
  nodesExecuted: number;
  tokensConsumed: number;
  latencyMs: number;
  triggeredBy: string;
  logs: string[];
}

interface GraphRunsViewProps {
  onSelectTab?: (tab: ActiveTab) => void;
}

const MOCK_GRAPH_RUNS: GraphRunRecord[] = [
  {
    id: 'run-9041',
    graphName: 'Startup Research & Obsidian Memo Pipeline',
    templateId: 'tmpl-1',
    status: 'SUCCESS',
    startedAt: 'Today at 04:32:10',
    duration: '2.4s',
    nodesExecuted: 4,
    tokensConsumed: 1840,
    latencyMs: 38,
    triggeredBy: 'Orchestrator Agent',
    logs: [
      '[04:32:10] Executed node: Web Scraper (200+ arXiv preprints scraped)',
      '[04:32:11] Executed node: Scout Specialist Agent (clustered into 5 startup themes)',
      '[04:32:12] Executed node: DeepSeek R1 Engine (computed $14B TAM & unit economics)',
      '[04:32:12] Executed node: Scribe Obsidian Vectorizer (synced memo to [[Startup-Theses]])',
    ],
  },
  {
    id: 'run-9040',
    graphName: 'Aegis Verification Sentinel & Policy Gate',
    templateId: 'tmpl-2',
    status: 'SUCCESS',
    startedAt: 'Today at 03:15:45',
    duration: '1.1s',
    nodesExecuted: 3,
    tokensConsumed: 940,
    latencyMs: 24,
    triggeredBy: 'Guardian Sentinel',
    logs: [
      '[03:15:45] Executed node: Dev Engineer Sandbox (AST compiled zero errors)',
      '[03:15:46] Executed node: Guardian Policy Engine (passed 100% security rules)',
      '[03:15:46] Executed node: Aegis Sentinel Proof Generator (proof receipt logged)',
    ],
  },
  {
    id: 'run-9039',
    graphName: 'Voice Directive & Telegram Dispatch Loop',
    templateId: 'tmpl-3',
    status: 'SUCCESS',
    startedAt: 'Yesterday at 22:40:02',
    duration: '1.8s',
    nodesExecuted: 3,
    tokensConsumed: 1210,
    latencyMs: 42,
    triggeredBy: 'JARVIS Voice HUD',
    logs: [
      '[22:40:02] Audio directive transcribed via Fish Audio / Web Speech API',
      '[22:40:03] Model Router arbitrated prompt to Claude 3.7 Sonnet',
      '[22:40:03] Dispatched message to Telegram channel #orchestrator-bridge',
    ],
  },
];

export const GraphRunsView: React.FC<GraphRunsViewProps> = ({ onSelectTab }) => {
  const [runs, setRuns] = useState<GraphRunRecord[]>(MOCK_GRAPH_RUNS);
  const [selectedRunId, setSelectedRunId] = useState<string>(MOCK_GRAPH_RUNS[0].id);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];

  const filteredRuns = runs.filter((r) => {
    if (filterStatus === 'ALL') return true;
    return r.status === filterStatus;
  });

  return (
    <div className="space-y-6 font-mono text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1C1F38] pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Graph Runs & Execution Trace History
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30 font-semibold">
                EXECUTION STATE
              </span>
            </h1>
            <p className="text-xs text-[#8E94B8] mt-0.5">
              Inspect historical workflow graph runs, node execution telemetry, token consumption, and audit traces.
            </p>
          </div>
        </div>

        <button
          onClick={() => onSelectTab('graph-builder')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#716EFE] text-white text-xs font-bold shadow-lg shadow-[#615EFF]/25 transition cursor-pointer"
        >
          <GitMerge className="w-4 h-4" />
          Open Graph Builder
        </button>
      </div>

      {/* Main Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Runs List */}
        <div className="bg-[#080911] border border-[#161828] rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#161828]">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#615EFF]" />
              Run History ({filteredRuns.length})
            </span>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-[#101220] border border-[#232742] text-[11px] text-[#A5A2FF] rounded-lg px-2 py-1"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="RUNNING">Running</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          <div className="space-y-2">
            {filteredRuns.map((run) => {
              const isSelected = run.id === selectedRunId;
              return (
                <div
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`p-3 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-[#121424] border-[#615EFF] shadow-md shadow-[#615EFF]/15'
                      : 'bg-[#0B0D18] border-[#181B2E] hover:border-[#282D4A]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white truncate max-w-[170px]">
                      {run.graphName}
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#00D26A]/20 text-[#00D26A]">
                      {run.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#8E94B8]">
                    <span>{run.startedAt}</span>
                    <span className="text-[#A5A2FF] font-semibold">{run.duration}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Run Detail Inspector */}
        <div className="lg:col-span-2 bg-[#080911] border border-[#161828] rounded-2xl p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#161828] pb-4">
            <div>
              <div className="text-[10px] text-[#615EFF] font-bold uppercase tracking-wider mb-1">
                Run ID: {selectedRun.id}
              </div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                {selectedRun.graphName}
              </h2>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/30">
              STATUS 200 OK
            </span>
          </div>

          {/* Telemetry Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
              <span className="text-[10px] text-[#7A82A6] block">Duration</span>
              <span className="text-sm font-bold text-white">{selectedRun.duration}</span>
            </div>
            <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
              <span className="text-[10px] text-[#7A82A6] block">Nodes Executed</span>
              <span className="text-sm font-bold text-[#A5A2FF]">{selectedRun.nodesExecuted} Nodes</span>
            </div>
            <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
              <span className="text-[10px] text-[#7A82A6] block">Tokens Used</span>
              <span className="text-sm font-bold text-[#00D26A]">{selectedRun.tokensConsumed} tokens</span>
            </div>
            <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
              <span className="text-[10px] text-[#7A82A6] block">Latency</span>
              <span className="text-sm font-bold text-[#38BDF8]">{selectedRun.latencyMs}ms</span>
            </div>
          </div>

          {/* Execution Trace Logs */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-white block">Node Trace Logs</span>
            <div className="bg-[#05060A] border border-[#1A1D33] p-4 rounded-xl space-y-2 text-xs text-[#A2A9D4]">
              {selectedRun.logs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-[#00D26A] select-none font-bold">✓</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
