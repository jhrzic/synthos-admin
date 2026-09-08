import React, { useState, useEffect, useCallback } from 'react';
import { ActiveTab, AgentInfo, KanbanTask, ObsidianNote, AIModelInfo } from '../types';
import { LiveAgentWireframe } from './LiveAgentWireframe';
import {
  Target, Bot, Play, ListChecks, GitBranch, ShieldCheck, BookOpen,
  Search, Wrench, Mic, ArrowRight, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, HelpCircle, Ban, Clock
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Pass X / Workstream A-D — this is a full rewrite. The previous version of
// this file computed every headline number from Math.random() or arbitrary
// multiplier formulas applied to real counts (e.g. `tasks.length * 165000 +
// notes.length * 95000 + 2150000` labeled "Input Tokens [DERIVED]"), and
// carried a "Swarm Command Console" / "RUN CANONICAL ACCEPTANCE TEST" flow
// that wrote a hand-authored fake research memo into the real Vault and sent
// real Telegram messages claiming a multi-agent research task had completed
// and been verified, when nothing had run. None of that is here anymore.
//
// Every number on this screen now comes from GET /api/overview
// (lib/overview.ts on the server — real SQL COUNT/SUM, workspace-scoped,
// server-authoritative) or from lib/runtime-status.ts's real, already-
// existing evidence-graded probe. Zero is a valid, honestly-rendered
// answer for a workspace that hasn't done anything yet.
// ---------------------------------------------------------------------------

interface OverviewOfficeViewProps {
  agents: Record<string, AgentInfo>;
  tasks: KanbanTask[];
  notes: ObsidianNote[];
  models: Record<string, AIModelInfo>;
  activeWorkspaceId: string;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenAgentDrawer: (agentRole: string) => void;
  onOpenGraphBuilder?: () => void;
  onOpenHermesChat?: () => void;
}

interface WorkspaceTaskCounts {
  total: number;
  active: number;
  done: number;
  failed: number;
}

interface KilSummary {
  total: number;
  promoted: number;
  blocked: number;
  promotionRate: number | null;
  averageEvidence: number | null;
}

interface OverviewActivityItem {
  kind: 'task' | 'graph_run' | 'receipt' | 'external_execution' | 'kil_promotion';
  id: string;
  label: string;
  status: string;
  timestamp: string;
}

interface WorkspaceOverviewReport {
  workspaceId: string;
  tasks: WorkspaceTaskCounts;
  graphCount: number;
  graphRunCount: number;
  receiptCount: number;
  vaultArtifactCount: number;
  skillCount: number;
  externalExecutionCount: number;
  kil: KilSummary;
  recentActivity: OverviewActivityItem[];
  generatedAt: string;
}

type RuntimeSystemStatus = 'HEALTHY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'NOT_IMPLEMENTED' | 'FAILED' | 'UNKNOWN';

interface RuntimeSystemReport {
  system: string;
  status: RuntimeSystemStatus;
  evidenceSource: string;
  lastCheck: string | null;
  detail?: string;
}

interface OverviewApiResponse {
  success: boolean;
  workspace: WorkspaceOverviewReport;
  runtime: { systems: RuntimeSystemReport[]; generatedAt: string };
  error?: string;
}

const RUNTIME_STATUS_STYLE: Record<RuntimeSystemStatus, { color: string; icon: React.ElementType; label: string }> = {
  HEALTHY: { color: '#00D26A', icon: CheckCircle2, label: 'HEALTHY' },
  DEGRADED: { color: '#F59E0B', icon: AlertTriangle, label: 'DEGRADED' },
  FAILED: { color: '#FF6B6B', icon: XCircle, label: 'FAILED' },
  NOT_CONFIGURED: { color: '#7E8BB5', icon: Ban, label: 'NOT CONFIGURED' },
  NOT_IMPLEMENTED: { color: '#7E8BB5', icon: Ban, label: 'NOT IMPLEMENTED' },
  UNKNOWN: { color: '#7E8BB5', icon: HelpCircle, label: 'UNKNOWN' },
};

const ACTIVITY_KIND_LABEL: Record<OverviewActivityItem['kind'], string> = {
  task: 'TASK',
  graph_run: 'GRAPH RUN',
  receipt: 'RECEIPT',
  external_execution: 'EXTERNAL EXEC',
  kil_promotion: 'KIL',
};

export const OverviewOfficeView: React.FC<OverviewOfficeViewProps> = ({
  agents,
  tasks,
  activeWorkspaceId,
  onSelectTab,
  onOpenAgentDrawer,
  onOpenGraphBuilder,
  onOpenHermesChat,
}) => {
  const [data, setData] = useState<OverviewApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/overview?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to load workspace overview');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Pass X fix: this must read the real server-backed task count
  // (data.workspace.tasks), not the `tasks` prop — that prop is
  // App.tsx's `kanbanTasks`, a client-side/localStorage-only board
  // (INITIAL_KANBAN_TASKS, never synced to the server's real `tasks`
  // table) — using it here produced a real, visible contradiction
  // against the "Tasks" summary card two sections down, which reads the
  // real count. The topology wireframe below still derives its own
  // per-node status from the client-side board — that is a separate,
  // pre-existing gap (Kanban is not itself backed by the server task
  // table) documented in docs/UI-IA-AUDIT.md, not fixed this pass.
  const runningTaskCount = data?.workspace.tasks.active ?? 0;
  const swarmStatusLabel = !data ? '…' : runningTaskCount > 0 ? 'ACTIVE' : 'STANDBY';
  const swarmStatusColor = runningTaskCount > 0 ? '#00D26A' : '#7E8BB5';

  const agentList = Object.entries(agents);

  return (
    <div className="space-y-6 pb-16 font-mono selection:bg-[#615EFF] max-w-[1600px] mx-auto">
      {/* Mission Control Topology — canonical architecture reference, with
          real per-node status derived from actual task assignment. */}
      <div className="bg-[#0B0D1D]/90 border border-[#1C203B] rounded-2xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden space-y-6">
        <div className="flex flex-wrap items-center justify-between border-b border-[#1A1E38] pb-4 gap-3">
          <div className="flex items-center gap-2.5">
            <Target className="w-5 h-5 text-[#38BDF8]" />
            <span className="text-xs font-bold font-mono text-[#38BDF8] tracking-widest uppercase">
              Mission Control Topology
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
              SWARM STATUS:{' '}
              <strong style={{ color: swarmStatusColor }}>{swarmStatusLabel}</strong>
              <span className="text-[10px] text-[#5D6489]"> ({runningTaskCount} task{runningTaskCount === 1 ? '' : 's'} running)</span>
            </span>
          </div>
        </div>

        <LiveAgentWireframe
          agents={agents}
          tasks={tasks}
          onSelectAgent={(role) => onOpenAgentDrawer(role)}
          onOpenGraphBuilder={onOpenGraphBuilder ? onOpenGraphBuilder : () => onSelectTab('graph-builder')}
        />
      </div>

      {/* Load / error state for the real workspace data below */}
      {loading && !data && (
        <div className="p-6 bg-[#0B0D1D]/90 border border-[#1C203B] rounded-2xl text-sm text-[#8E94B8] flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading real workspace state…
        </div>
      )}

      {error && (
        <div className="p-4 bg-[#2B0F13] border border-[#FF6B6B]/40 rounded-2xl text-sm text-[#FF6B6B] flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Could not load workspace overview: {error}</span>
          <button onClick={load} className="px-3 py-1.5 rounded-lg bg-[#FF6B6B]/15 hover:bg-[#FF6B6B]/25 border border-[#FF6B6B]/40 text-xs font-bold shrink-0 cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Real summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard label="Tasks" value={data.workspace.tasks.total} sub={`${data.workspace.tasks.active} active · ${data.workspace.tasks.done} done · ${data.workspace.tasks.failed} failed`} onClick={() => onSelectTab('kanban')} />
            <SummaryCard label="Graphs" value={data.workspace.graphCount} sub={`${data.workspace.graphRunCount} run${data.workspace.graphRunCount === 1 ? '' : 's'}`} onClick={() => onSelectTab('graph-builder')} />
            <SummaryCard label="Verified Receipts" value={data.workspace.receiptCount} sub="Ed25519-signed" onClick={() => onSelectTab('receipts')} />
            <SummaryCard label="Vault Artifacts" value={data.workspace.vaultArtifactCount} sub="Real files" onClick={() => onSelectTab('obsidian')} />
            <SummaryCard label="Skills" value={data.workspace.skillCount} sub="Registered" onClick={() => onSelectTab('skill-registry')} />
            <SummaryCard label="External Executions" value={data.workspace.externalExecutionCount} sub="Windmill" onClick={() => onSelectTab('graph-runs')} />
          </div>

          {/* KIL summary — real, only what's actually stored */}
          {data.workspace.kil.total > 0 && (
            <div className="p-4 bg-[#0B0D1D]/90 border border-[#1C203B] rounded-2xl flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <span className="text-[#A5A2FF] font-bold uppercase tracking-widest">Knowledge Integrity</span>
              <span className="text-[#8E94B8]">Observations: <strong className="text-white">{data.workspace.kil.total}</strong></span>
              <span className="text-[#8E94B8]">Promoted: <strong className="text-[#00D26A]">{data.workspace.kil.promoted}</strong></span>
              <span className="text-[#8E94B8]">Blocked: <strong className="text-[#FF6B6B]">{data.workspace.kil.blocked}</strong></span>
              <span className="text-[#8E94B8]">
                Promotion rate: <strong className="text-white">{data.workspace.kil.promotionRate !== null ? `${Math.round(data.workspace.kil.promotionRate * 100)}%` : 'UNKNOWN'}</strong>
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Runtime status — real evidence-graded probe, C3 */}
            <div className="lg:col-span-5 min-w-0 airbyte-card space-y-3">
              <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
                <span className="text-xs font-bold text-[#38BDF8] uppercase tracking-widest">Runtime Status</span>
                <button onClick={load} className="text-[10px] font-mono text-[#615EFF] hover:text-[#A5A2FF] flex items-center gap-1 bg-[#121428] px-2 py-0.5 rounded border border-[#232746] transition cursor-pointer">
                  <RefreshCw className="w-2.5 h-2.5" /> REFRESH
                </button>
              </div>
              <div className="space-y-1.5">
                {data.runtime.systems.map((sys) => {
                  const style = RUNTIME_STATUS_STYLE[sys.status] || RUNTIME_STATUS_STYLE.UNKNOWN;
                  const Icon = style.icon;
                  return (
                    <div key={sys.system} className="p-2.5 bg-[#05060C] border border-[#141628] rounded-xl flex items-center justify-between gap-2 text-xs" title={sys.detail}>
                      <span className="text-[#C5CBE5] truncate">{sys.system}</span>
                      <span className="flex items-center gap-1.5 shrink-0 font-bold" style={{ color: style.color }}>
                        <Icon className="w-3.5 h-3.5" />
                        {style.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent activity — real, bounded, or an honest empty state (D) */}
            <div className="lg:col-span-7 min-w-0 airbyte-card space-y-3">
              <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
                <span className="text-xs font-bold text-[#F59E0B] uppercase tracking-widest">Recent Activity</span>
              </div>
              {data.workspace.recentActivity.length === 0 ? (
                <div className="p-4 bg-[#05060C] border border-[#141628] rounded-xl text-xs text-[#6A7097] text-center">
                  No workspace activity yet. Run your first task from Kanban, or ask Jarvis to get started.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {data.workspace.recentActivity.map((evt) => (
                    <div key={`${evt.kind}-${evt.id}`} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#05060C] border border-[#141628] text-xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30">
                          {ACTIVITY_KIND_LABEL[evt.kind]}
                        </span>
                        <span className="text-[#C5CBE5] truncate">{evt.label}</span>
                      </div>
                      <span className="text-[10px] text-[#8E94B8] shrink-0">{evt.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Agent roster — real, static config, never presented as a live health signal */}
      <div className="airbyte-card space-y-3">
        <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
          <span className="text-xs font-bold text-[#EC4899] uppercase tracking-widest">Agent Roster</span>
          <span className="text-[10px] text-[#5D6489]">{agentList.length} configured — dormant packs cost nothing</span>
        </div>
        <div className="grid-metrics">
          {agentList.map(([role, agent]) => (
            <div
              key={role}
              onClick={() => onOpenAgentDrawer(role)}
              className="p-3 bg-[#05060C] hover:bg-[#0F1122] border border-[#141628] rounded-xl cursor-pointer transition flex items-center justify-between min-w-0 gap-2"
            >
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-white block truncate">{agent.name}</span>
                <span className="text-[10px] text-[#8E94B8]">{agent.title}</span>
              </div>
              <Clock className="w-3 h-3 text-[#7E8BB5] shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions — only real, wired features (C5) */}
      <div className="airbyte-card space-y-3">
        <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
          <span className="text-xs font-bold text-[#A5A2FF] uppercase tracking-widest">Quick Actions</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <QuickAction icon={Mic} label="Ask Jarvis" onClick={() => onSelectTab('jarvis')} />
          <QuickAction icon={GitBranch} label="Create Graph" onClick={onOpenGraphBuilder ? onOpenGraphBuilder : () => onSelectTab('graph-builder')} />
          <QuickAction icon={ListChecks} label="Task Board" onClick={() => onSelectTab('kanban')} />
          <QuickAction icon={BookOpen} label="Browse Vault" onClick={() => onSelectTab('obsidian')} />
          <QuickAction icon={Wrench} label="Open Skills" onClick={() => onSelectTab('skill-registry')} />
        </div>
      </div>
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: number; sub: string; onClick?: () => void }> = ({ label, value, sub, onClick }) => (
  <button onClick={onClick} className="airbyte-card space-y-1 text-left cursor-pointer hover:border-[#615EFF]/40 transition">
    <span className="text-[10px] font-mono text-[#787F9E] uppercase tracking-wider block truncate">{label}</span>
    <span className="text-2xl font-extrabold text-white font-mono tracking-tight block truncate">{value}</span>
    <span className="text-[10px] text-[#8E94B8] truncate block">{sub}</span>
  </button>
);

const QuickAction: React.FC<{ icon: React.ElementType; label: string; onClick: () => void }> = ({ icon: Icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="p-3 bg-[#05060C] hover:bg-[#0F1122] border border-[#141628] hover:border-[#615EFF]/40 rounded-xl transition flex items-center gap-2 text-xs text-[#C5CBE5] hover:text-white cursor-pointer"
  >
    <Icon className="w-4 h-4 text-[#615EFF] shrink-0" />
    <span className="truncate">{label}</span>
    <ArrowRight className="w-3 h-3 ml-auto text-[#5D6489] shrink-0" />
  </button>
);
