import React, { useState, useEffect, useCallback } from 'react';
import { ActiveTab } from '../types';
import { Clock, Activity, GitMerge, Loader2, AlertTriangle, RefreshCw, Database } from 'lucide-react';
import { TaskStatusBadge, ReceiptOutcomeBadge, ScopeChips, Badge, contractLabel } from './verification/outcome';

interface GraphRunsViewProps {
  onSelectTab?: (tab: ActiveTab) => void;
  activeWorkspaceId?: string;
}

interface GraphRunEntry {
  run_id: string;
  graph_id: string;
  workspace_id: string | null;
  status: string;
  current_node_id: string | null;
  state: {
    executionLog?: string[];
    totalNodes?: number;
    currentStep?: number;
    nodeResults?: Record<string, any>;
    failedNodeId?: string;
    completedNodeIds?: string[];
    totalCompletedNodes?: number;
    completedAt?: string;
    graphRunReceipt?: { receiptId?: string; taskId?: string; artifactId?: string; artifactPath?: string; aegisDecision?: string; aegisScore?: number | null; outcome?: string; verificationScope?: string } | null;
    error?: string;
  };
  created_at: string;
  updated_at: string;
}

interface GraphEntry {
  graph_id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// SYNTHOS — Graph Runs.
//
// Real, workspace-scoped run history from GET /api/graph-runs, backed by
// the actual graphs table (graph_id -> name lookup) and the real
// graph_runs.state_json the execution spine writes at every step. Nothing
// here is sample data — an empty workspace shows an empty state, not a
// fabricated execution history.
// ---------------------------------------------------------------------------

export const GraphRunsView: React.FC<GraphRunsViewProps> = ({ onSelectTab, activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';
  const [runs, setRuns] = useState<GraphRunEntry[]>([]);
  const [graphs, setGraphs] = useState<GraphEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runsRes, graphsRes] = await Promise.all([
        fetch(`/api/graph-runs?workspaceId=${encodeURIComponent(workspaceId)}`),
        fetch(`/api/graphs?workspaceId=${encodeURIComponent(workspaceId)}`),
      ]);
      const runsData = await runsRes.json();
      const graphsData = await graphsRes.json();
      if (!runsRes.ok || runsData.success === false) {
        setError(runsData.error || `HTTP ${runsRes.status}`);
        setRuns([]);
      } else {
        setRuns(runsData.runs || []);
        setSelectedRunId((runsData.runs || [])[0]?.run_id || null);
      }
      if (graphsRes.ok && graphsData.success !== false) {
        setGraphs(graphsData.graphs || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting Graph Runs API.');
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const graphName = (graphId: string) => graphs.find((g) => g.graph_id === graphId)?.name || graphId;

  const filteredRuns = runs.filter((r) => filterStatus === 'ALL' || r.status === filterStatus);
  const selectedRun = runs.find((r) => r.run_id === selectedRunId) || null;

  return (
    <div className="space-y-6 font-mono text-white">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1C1F38] pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Graph Runs</h1>
            <p className="text-xs text-[#8E94B8] mt-0.5">
              Real, workspace-scoped run history · Workspace: <span className="text-white">{workspaceId}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onSelectTab && (
            <button
              onClick={() => onSelectTab('graph-builder')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#716EFE] text-white text-xs font-bold shadow-lg shadow-[#615EFF]/25 transition cursor-pointer"
            >
              <GitMerge className="w-4 h-4" /> Open Graph Builder
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-2xl p-4 flex items-start gap-2 text-xs text-[#FF5E8E]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[#8E94B8] py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading graph runs…
        </div>
      ) : runs.length === 0 && !error ? (
        <div className="bg-[#080911] border border-[#161828] rounded-2xl p-10 text-center space-y-2">
          <Database className="w-8 h-8 text-[#8E94B8] mx-auto opacity-40" />
          <p className="text-xs text-[#8E94B8]">No graph runs exist for this workspace yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-[#080911] border border-[#161828] rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#161828]">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#615EFF]" /> Run History ({filteredRuns.length})
              </span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-[#101220] border border-[#232742] text-[11px] text-[#A5A2FF] rounded-lg px-2 py-1"
              >
                <option value="ALL">All Statuses</option>
                <option value="RUNNING">Running</option>
                <option value="COMPLETED">Completed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {filteredRuns.map((run) => {
                const isSelected = run.run_id === selectedRunId;
                const statusColor = run.status === 'COMPLETED' ? '#00D26A' : run.status === 'FAILED' ? '#FF5E8E' : '#F59E0B';
                return (
                  <div
                    key={run.run_id}
                    onClick={() => setSelectedRunId(run.run_id)}
                    className={`p-3 rounded-xl border transition cursor-pointer ${
                      isSelected ? 'bg-[#121424] border-[#615EFF] shadow-md shadow-[#615EFF]/15' : 'bg-[#0B0D18] border-[#181B2E] hover:border-[#282D4A]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-white truncate max-w-[170px]">{graphName(run.graph_id)}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${statusColor}20`, color: statusColor }}>
                        {run.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#8E94B8]">{new Date(run.created_at).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 bg-[#080911] border border-[#161828] rounded-2xl p-6 space-y-6">
            {!selectedRun ? (
              <div className="text-xs text-[#8E94B8] text-center py-16">Select a run to inspect it.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#161828] pb-4">
                  <div>
                    <div className="text-[10px] text-[#615EFF] font-bold uppercase tracking-wider mb-1">Run ID: {selectedRun.run_id}</div>
                    <h2 className="text-base font-bold text-white">{graphName(selectedRun.graph_id)}</h2>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/30">
                    {selectedRun.status}
                  </span>
                </div>

                {(() => {
                  // Render the shape the execution spine really writes:
                  // state.nodeResults keyed by nodeId. The previous panel read
                  // totalNodes/currentStep/executionLog, which the spine never
                  // wrote, so every run showed "—" and "no log entries" despite
                  // full per-node evidence being present.
                  const nodes = Object.values(selectedRun.state.nodeResults || {})
                    .sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0)) as any[];
                  const receipt = selectedRun.state.graphRunReceipt || null;
                  const dur = (n: any) =>
                    n?.startedAt && n?.finishedAt
                      ? `${new Date(n.finishedAt).getTime() - new Date(n.startedAt).getTime()}ms`
                      : 'UNKNOWN';
                  const runDur = nodes.length && nodes[0]?.startedAt && nodes[nodes.length - 1]?.finishedAt
                    ? `${new Date(nodes[nodes.length - 1].finishedAt).getTime() - new Date(nodes[0].startedAt).getTime()}ms`
                    : 'UNKNOWN';
                  return (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
                          <span className="text-[10px] text-[#7A82A6] block">Nodes Executed</span>
                          <span className="text-sm font-bold text-[#A5A2FF]">{nodes.length || '—'}</span>
                        </div>
                        <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
                          <span className="text-[10px] text-[#7A82A6] block">Current / Failed Node</span>
                          <span className="text-sm font-bold text-white truncate block">{selectedRun.current_node_id || '—'}</span>
                        </div>
                        <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
                          <span className="text-[10px] text-[#7A82A6] block">Run Duration</span>
                          <span className="text-sm font-bold text-white">{runDur}</span>
                        </div>
                        <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
                          <span className="text-[10px] text-[#7A82A6] block">Last Updated</span>
                          <span className="text-sm font-bold text-white">{new Date(selectedRun.updated_at).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      {receipt && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
                            <span className="text-[10px] text-[#7A82A6] block">Aegis</span>
                            <span className="text-sm font-bold text-[#00D26A]">{receipt.aegisDecision || 'UNKNOWN'}</span>
                          </div>
                          <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
                            <span className="text-[10px] text-[#7A82A6] block">Receipt</span>
                            <span className="text-xs font-bold text-[#8C8AFF] truncate block">{receipt.receiptId || 'UNKNOWN'}</span>
                          </div>
                          <div className="bg-[#0D0F1B] border border-[#1A1D33] p-3 rounded-xl">
                            <span className="text-[10px] text-[#7A82A6] block">Run Artifact</span>
                            <span className="text-xs font-bold text-white truncate block">{receipt.artifactPath || receipt.artifactId || 'UNKNOWN'}</span>
                          </div>
                          <div className="col-span-2 sm:col-span-3 flex flex-wrap items-center gap-2 text-[10px] text-[#7A82A6]">
                            <ReceiptOutcomeBadge outcome={receipt.outcome} />
                            <span>{receipt.verificationScope || 'Verification scope not recorded for this run.'}</span>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <span className="text-xs font-bold text-white block">Node Execution</span>
                        <div className="bg-[#05060A] border border-[#1A1D33] rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                          {nodes.length === 0 ? (
                            <p className="text-[#5A6083] text-xs p-4">No node results recorded for this run.</p>
                          ) : nodes.map((n: any) => (
                            <div key={n.nodeId} className="px-3 py-2 border-b border-[#141628] last:border-0 text-[11px]">
                              <div className="flex flex-wrap items-center gap-2">
                                <TaskStatusBadge status={n.status} />
                                <span className="text-white font-bold truncate">{n.nodeName || n.nodeId}</span>
                                <span className="text-[#5A6083]">{n.classification}</span>
                                <span className="text-[#7A82A6] ml-auto">{dur(n)}</span>
                              </div>
                              <div className="text-[10px] text-[#7A82A6] mt-0.5 flex flex-wrap gap-x-3">
                                <span>via {n.modelUsed || n.agentOrRuntime || 'UNKNOWN'}</span>
                                <span>gate {n.gate?.passed ? 'passed' : 'FAILED'}</span>
                                {n.receiptId && <span className="text-[#8C8AFF]">receipt {String(n.receiptId).slice(0, 18)}</span>}
                                {n.artifact && <span className="text-[#8C8AFF]">artifact</span>}
                              </div>
                              {(n.outputContract || n.verification || n.quarantined) && (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <Badge tone="inert">CONTRACT: {contractLabel(n.outputContract)}</Badge>
                                  {n.verification && <ScopeChips scopes={n.verification} />}
                                  {n.termination?.status && <Badge tone={n.termination.status === 'COMPLETE' ? 'success' : n.termination.status === 'INCOMPLETE' ? 'warning' : 'inert'}>TERMINATION: {n.termination.status}{n.termination.reason ? ` (${n.termination.reason})` : ''}</Badge>}
                                  {n.receiptOutcome && <ReceiptOutcomeBadge outcome={n.receiptOutcome} />}
                                  {n.quarantined && <Badge tone="error" title="Excluded from memory retrieval; evidence preserved.">QUARANTINED</Badge>}
                                  {n.taskId && <span className="text-[10px] text-[#8C8AFF]">task {String(n.taskId).slice(0, 28)}</span>}
                                </div>
                              )}
                              {n.gate && n.gate.passed === false && n.gate.reason && (
                                <div className="text-[10px] text-[#FF5E8E] mt-1">{n.gate.reason}</div>
                              )}
                              {n.failure && (
                                <div className="text-[10px] text-[#FF5E8E] mt-1">{n.failure.error || n.failure.reason}</div>
                              )}
                            </div>
                          ))}
                          {selectedRun.state.error && (
                            <div className="flex items-start gap-2 text-[#FF5E8E] p-3 border-t border-[#1A1D33] text-[11px]">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {selectedRun.state.error}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
