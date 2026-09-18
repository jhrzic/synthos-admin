import React, { useState, useEffect, useCallback } from 'react';
import {
  Server, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronRight,
  Box, FileCheck, ExternalLink, XCircle, CheckCircle2, Clock, RotateCw
} from 'lucide-react';
import { TaskStatusBadge, RetrievalBadge } from './verification/outcome';

// ---------------------------------------------------------------------------
// EXTERNAL EXECUTIONS — a product surface over the EXISTING external execution
// control plane (the server-side external-execution and Windmill client
// libraries, exposed at /api/external-executions*, ADR-006). It creates no
// execution mechanism of its own; every action is the server's own route.
//
// The audit found this backend real but with no UI at all. The table is
// currently empty (0 rows) because Windmill is NOT_CONFIGURED — no
// WINDMILL_BASE_URL / TOKEN / WORKSPACE. That is shown as an honest empty
// state. No execution is seeded to make the screen look populated.
// ---------------------------------------------------------------------------

interface ExternalExecution {
  id: string;
  workspace_id: string;
  runtime: string;
  task_id: string | null;
  graph_run_id: string | null;
  graph_node_id: string | null;
  skill_id: string | null;
  target_id: string | null;
  remote_path: string;
  target_kind: string;
  remote_job_id: string | null;
  status: string;
  attempt_number: number;
  correlation_id: string;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_checked_at: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  result_artifact_id: string | null;
  result_receipt_id: string | null;
  created_at: string;
  /** The ingested SynthOS task's status — the verdict, as opposed to the remote runtime's. */
  task_status?: string | null;
  artifact_retrieval?: { status: string; reason: string | null; at: string | null } | null;
}

interface ExternalExecutionsViewProps {
  activeWorkspaceId?: string;
}

const STATUS_STYLE: Record<string, string> = {
  SUCCEEDED: 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]',
  COMPLETED: 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]',
  RUNNING: 'bg-[#38BDF8]/10 border-[#38BDF8]/40 text-[#38BDF8]',
  PENDING: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  SUBMITTED: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  FAILED: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]',
  CANCELLED: 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]',
};

const when = (iso: string | null) => {
  if (!iso) return 'UNKNOWN';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'UNKNOWN' : d.toLocaleString();
};

export const ExternalExecutionsView: React.FC<ExternalExecutionsViewProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';

  const [executions, setExecutions] = useState<ExternalExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchExecutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/external-executions?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        setError(data?.error || `HTTP ${res.status}`);
        setExecutions([]);
      } else {
        setExecutions(data.executions || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting the external execution API.');
      setExecutions([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  /** Real runtime configuration truth, so an empty list can explain itself. */
  const fetchRuntimeStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/master-admin/windmill/status');
      if (!res.ok) { setRuntimeStatus(null); return; }
      const data = await res.json().catch(() => null);
      // Shape: { success, health: { status, reachable, authenticated, error } }.
      // Platform-admin only, so a 403 simply leaves the badge unset rather than
      // guessing a status.
      const s = data?.health?.status ?? null;
      setRuntimeStatus(typeof s === 'string' ? s : null);
    } catch {
      setRuntimeStatus(null);
    }
  }, []);

  useEffect(() => { fetchExecutions(); fetchRuntimeStatus(); }, [fetchExecutions, fetchRuntimeStatus]);

  const act = useCallback(async (id: string, action: 'refresh' | 'retry' | 'cancel') => {
    setActionBusy(`${id}:${action}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/external-executions/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) setActionError(data?.error || `HTTP ${res.status}`);
      await fetchExecutions();
    } catch (err: any) {
      setActionError(err?.message || 'Network error performing the action.');
    } finally {
      setActionBusy(null);
    }
  }, [workspaceId, fetchExecutions]);

  return (
    <div className="space-y-6 font-mono pb-12">
      <div className="bg-gradient-to-r from-[#38BDF8]/15 via-[#0B0D1B] to-[#615EFF]/15 border border-[#38BDF8]/40 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#38BDF8]/20 border border-[#38BDF8]/50 flex items-center justify-center text-[#38BDF8] shrink-0">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">External Executions</h1>
              <p className="text-xs text-[#8E94B8] mt-1 font-sans">
                Windmill external execution control plane (ADR-006) · Workspace: <span className="text-white">{workspaceId}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {runtimeStatus && (
              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                runtimeStatus === 'NOT_CONFIGURED'
                  ? 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]'
                  : 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]'
              }`}>
                RUNTIME: {runtimeStatus}
              </span>
            )}
            <button
              onClick={() => { fetchExecutions(); fetchRuntimeStatus(); }}
              disabled={loading}
              className="p-2 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-[#E8A845]/10 border border-[#E8A845]/40 rounded-xl text-xs text-[#E8A845] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1"><span className="font-bold uppercase">Action rejected: </span>{actionError}</div>
          <button onClick={() => setActionError(null)} className="text-[10px] underline cursor-pointer shrink-0">dismiss</button>
        </div>
      )}

      {loading && (
        <div className="p-8 text-center text-xs text-[#8E94B8] flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading external executions…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold uppercase">Could not load external executions</div>
            <div className="text-[#C98B8B] mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && executions.length === 0 && (
        <div className="p-10 text-center border border-[#1F2442] rounded-2xl bg-[#080A16]">
          <Server className="w-8 h-8 text-[#2D3352] mx-auto mb-3" />
          <p className="text-sm text-[#8E94B8] font-semibold">No external executions recorded in this workspace.</p>
          <p className="text-xs text-[#6A7097] mt-1 max-w-md mx-auto leading-relaxed">
            {runtimeStatus === 'NOT_CONFIGURED'
              ? 'The Windmill runtime is NOT_CONFIGURED (WINDMILL_BASE_URL / WINDMILL_TOKEN / WINDMILL_WORKSPACE are not all set), so nothing has been dispatched to it.'
              : 'An execution appears here once work is dispatched to the external runtime.'}
          </p>
        </div>
      )}

      {!loading && !error && executions.length > 0 && (
        <div className="space-y-2">
          {executions.map((e) => {
            const isOpen = expanded === e.id;
            const busy = (a: string) => actionBusy === `${e.id}:${a}`;
            const style = STATUS_STYLE[e.status] || 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]';
            return (
              <div key={e.id} className="border border-[#1F2442] rounded-xl bg-[#080A16] overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  <button onClick={() => setExpanded(isOpen ? null : e.id)} className="shrink-0 text-[#6A7097] hover:text-white cursor-pointer">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${style}`}>{e.status}</span>
                  <button onClick={() => setExpanded(isOpen ? null : e.id)} className="min-w-0 flex-1 text-left cursor-pointer">
                    <div className="text-xs text-white font-bold truncate">{e.remote_path}</div>
                    <div className="text-[10px] text-[#6A7097] truncate">
                      {e.runtime} · {e.target_kind} · attempt {e.attempt_number}
                    </div>
                  </button>
                  <span className="text-[10px] text-[#6A7097] shrink-0 hidden md:inline">{when(e.submitted_at || e.created_at)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <IconBtn title="Refresh status" busy={busy('refresh')} onClick={() => act(e.id, 'refresh')} icon={RefreshCw} tone="#38BDF8" />
                    <IconBtn title="Retry" busy={busy('retry')} onClick={() => act(e.id, 'retry')} icon={RotateCw} tone="#E8A845" />
                    <IconBtn title="Cancel" busy={busy('cancel')} onClick={() => act(e.id, 'cancel')} icon={XCircle} tone="#FF6B6B" />
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-[#1F2442] p-4 bg-[#05060C] space-y-3">
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                      <Row label="Execution ID" value={e.id} />
                      <Row label="Workspace" value={e.workspace_id} />
                      <Row label="Runtime" value={e.runtime} />
                      <Row label="Remote path" value={e.remote_path} />
                      <Row label="Remote job" value={e.remote_job_id} />
                      <Row label="Correlation" value={e.correlation_id} />
                      <Row label="Capability / skill" value={e.skill_id} />
                      <Row label="Task" value={e.task_id} />
                      <Row label="Graph run" value={e.graph_run_id} />
                      <Row label="Submitted" value={when(e.submitted_at)} />
                      <Row label="Started" value={when(e.started_at)} />
                      <Row label="Completed" value={when(e.completed_at)} />
                      <Row label="Last checked" value={when(e.last_checked_at)} />
                    </div>

                    {(e.error_code || e.error_message_safe) && (
                      <div className="p-2.5 rounded-lg bg-[#FF6B6B]/10 border border-[#FF6B6B]/30 text-[11px] text-[#FF6B6B]">
                        <div className="font-bold">{e.error_code || 'ERROR'}</div>
                        <div className="text-[#C98B8B] mt-0.5">{e.error_message_safe || 'No further detail recorded.'}</div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[#141628] text-[10px]">
                      <Ref icon={Box} label="Artifact" value={e.result_artifact_id} />
                      <Ref icon={FileCheck} label="Receipt" value={e.result_receipt_id} />
                      {e.task_id && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[#6A7097]">SynthOS verdict:</span>
                          <TaskStatusBadge status={e.task_status} />
                          {e.artifact_retrieval && <RetrievalBadge retrieval={e.artifact_retrieval} />}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const IconBtn: React.FC<{ title: string; busy: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; tone: string }> = ({ title, busy, onClick, icon: Icon, tone }) => (
  <button
    onClick={onClick}
    disabled={busy}
    title={title}
    style={{ color: tone, borderColor: `${tone}55` }}
    className="p-1.5 rounded-lg bg-[#0B0D1B] border hover:bg-[#141833] transition cursor-pointer disabled:opacity-40"
  >
    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
  </button>
);

const Row: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="flex items-start gap-2 min-w-0">
    <span className="text-[#6A7097] shrink-0">{label}:</span>
    <span className="text-white truncate">{value || 'UNKNOWN'}</span>
  </div>
);

const Ref: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string | null }> = ({ icon: Icon, label, value }) => (
  <span className={`inline-flex items-center gap-1 ${value ? 'text-[#8C8AFF]' : 'text-[#4C5274]'}`} title={value || 'none'}>
    <Icon className="w-3 h-3" /> {label}: {value || 'UNKNOWN'}
  </span>
);

export default ExternalExecutionsView;
