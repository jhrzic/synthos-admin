import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock, RefreshCw, Loader2, AlertTriangle, Play, Pause, Ban, Zap,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, ShieldAlert, Box, FileCheck
} from 'lucide-react';

// ---------------------------------------------------------------------------
// SCHEDULER — a product surface over the EXISTING canonical scheduler
// (lib/fabric/scheduler.ts + /api/schedules*). There is no second scheduling
// engine here: every button below calls the same route the poll loop and the
// test suite already exercise.
//
// Why this screen exists: the scheduler shipped with 7 routes, real occurrence
// records and substantial test coverage, but no UI at all — real schedules were
// running that nobody could see, pause or inspect.
//
// Step 7 semantics are preserved BY NOT REIMPLEMENTING THEM:
//  - "Run now" posts to /run-now, which fires the identical single-occurrence
//    path the poll loop uses (no missed-run burst, same idempotency key).
//  - pause/resume/cancel are the server's own state machine; this UI only
//    disables buttons the server would reject anyway, and surfaces the real
//    error when it does reject.
//  - Capability recheck and approval restrictions live server-side and are
//    reported through status/status_reason — never re-decided here.
//
// Every field is real backend state. Nothing is computed to look complete.
// ---------------------------------------------------------------------------

type ScheduleStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'NOT_CONFIGURED' | 'CANCELLED';

interface ScheduleRecord {
  schedule_id: string;
  workspace_id: string;
  capability: string;
  action: string;
  raw_text: string;
  recurrence_type: 'ONCE' | 'INTERVAL';
  interval_seconds: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  status: ScheduleStatus;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface OccurrenceRecord {
  occurrence_id: string;
  schedule_id: string;
  due_at: string;
  status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'NOT_CONFIGURED';
  outcome: string;
  reason: string | null;
  task_id: string | null;
  artifact_id: string | null;
  receipt_id: string | null;
  created_at: string;
}

interface SchedulerViewProps {
  activeWorkspaceId?: string;
}

const STATUS_STYLE: Record<ScheduleStatus, string> = {
  ACTIVE: 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]',
  PAUSED: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  COMPLETED: 'bg-[#38BDF8]/10 border-[#38BDF8]/40 text-[#38BDF8]',
  FAILED: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]',
  BLOCKED: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]',
  NOT_CONFIGURED: 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]',
  CANCELLED: 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]',
};

const OCCURRENCE_ICON: Record<OccurrenceRecord['status'], React.ComponentType<{ className?: string }>> = {
  SUCCEEDED: CheckCircle2,
  FAILED: XCircle,
  BLOCKED: ShieldAlert,
  NOT_CONFIGURED: AlertTriangle,
};

function formatInterval(seconds: number | null): string {
  if (!seconds || seconds <= 0) return 'UNKNOWN';
  if (seconds % 86400 === 0) return `every ${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `every ${seconds / 60}m`;
  return `every ${seconds}s`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'UNKNOWN';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'UNKNOWN';
  return d.toLocaleString();
}

export const SchedulerView: React.FC<SchedulerViewProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';

  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<Record<string, OccurrenceRecord[]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedules?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        setError(data?.error || `HTTP ${res.status}`);
        setSchedules([]);
      } else {
        setSchedules(data.schedules || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting the scheduler API.');
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const loadOccurrences = useCallback(async (scheduleId: string) => {
    setDetailLoading(scheduleId);
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success !== false) {
        setOccurrences((prev) => ({ ...prev, [scheduleId]: data.occurrences || [] }));
      }
    } catch {
      // Detail failure leaves the row expanded with an honest empty history.
    } finally {
      setDetailLoading(null);
    }
  }, [workspaceId]);

  const toggle = (scheduleId: string) => {
    if (expanded === scheduleId) { setExpanded(null); return; }
    setExpanded(scheduleId);
    if (!occurrences[scheduleId]) void loadOccurrences(scheduleId);
  };

  /** Every action is the server's own route. The server owns the state machine; a rejection is surfaced verbatim. */
  const act = useCallback(async (scheduleId: string, action: 'pause' | 'resume' | 'run-now' | 'cancel') => {
    setActionBusy(`${scheduleId}:${action}`);
    setActionError(null);
    try {
      const res = action === 'cancel'
        ? await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'DELETE' })
        : await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId }),
          });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        setActionError(data?.error || `HTTP ${res.status}`);
      } else if (data?.occurrences) {
        setOccurrences((prev) => ({ ...prev, [scheduleId]: data.occurrences }));
      }
      await fetchSchedules();
      if (expanded === scheduleId && action !== 'cancel') await loadOccurrences(scheduleId);
    } catch (err: any) {
      setActionError(err?.message || 'Network error performing the action.');
    } finally {
      setActionBusy(null);
    }
  }, [workspaceId, fetchSchedules, loadOccurrences, expanded]);

  const counts = schedules.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6 font-mono pb-12">
      <div className="bg-gradient-to-r from-[#EC4899]/15 via-[#0B0D1B] to-[#615EFF]/15 border border-[#EC4899]/40 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#EC4899]/20 border border-[#EC4899]/50 flex items-center justify-center text-[#EC4899] shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">Scheduler</h1>
              <p className="text-xs text-[#8E94B8] mt-1 font-sans">
                Canonical execution-fabric schedules · Workspace: <span className="text-white">{workspaceId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={fetchSchedules}
            disabled={loading}
            className="p-2 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50"
            title="Refresh schedules"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 border-t border-[#EC4899]/20 pt-4">
          {(['ACTIVE', 'PAUSED', 'FAILED', 'COMPLETED'] as ScheduleStatus[]).map((st) => (
            <div key={st} className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
              <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">{st}</span>
              <span className="text-xl font-extrabold text-white mt-0.5 block">
                {loading ? '…' : error ? 'UNKNOWN' : (counts[st] || 0)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-[#E8A845]/10 border border-[#E8A845]/40 rounded-xl text-xs text-[#E8A845] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-bold uppercase">Scheduler rejected the action: </span>{actionError}
          </div>
          <button onClick={() => setActionError(null)} className="text-[10px] underline cursor-pointer shrink-0">dismiss</button>
        </div>
      )}

      {loading && (
        <div className="p-8 text-center text-xs text-[#8E94B8] flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading schedules…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold uppercase">Could not load schedules</div>
            <div className="text-[#C98B8B] mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && schedules.length === 0 && (
        <div className="p-10 text-center border border-[#1F2442] rounded-2xl bg-[#080A16]">
          <Clock className="w-8 h-8 text-[#2D3352] mx-auto mb-3" />
          <p className="text-sm text-[#8E94B8] font-semibold">No schedules in this workspace.</p>
          <p className="text-xs text-[#6A7097] mt-1">
            Schedules are created through Jarvis (for example: “research AI agent repos every 2 hours”).
          </p>
        </div>
      )}

      {!loading && !error && schedules.length > 0 && (
        <div className="space-y-2">
          {schedules.map((s) => {
            const isOpen = expanded === s.schedule_id;
            const history = occurrences[s.schedule_id];
            const busy = (a: string) => actionBusy === `${s.schedule_id}:${a}`;
            return (
              <div key={s.schedule_id} className="border border-[#1F2442] rounded-xl bg-[#080A16] overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  <button onClick={() => toggle(s.schedule_id)} className="shrink-0 text-[#6A7097] hover:text-white cursor-pointer" title="Occurrence history">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${STATUS_STYLE[s.status]}`}>
                    {s.status}
                  </span>

                  <button onClick={() => toggle(s.schedule_id)} className="min-w-0 flex-1 text-left cursor-pointer">
                    <div className="text-xs text-white font-bold truncate">{s.raw_text || s.action || s.capability}</div>
                    <div className="text-[10px] text-[#6A7097] truncate">
                      {s.capability}
                      {s.action && s.action !== s.capability ? ` · ${s.action}` : ''}
                      {' · '}
                      {s.recurrence_type === 'INTERVAL' ? formatInterval(s.interval_seconds) : 'once'}
                    </div>
                  </button>

                  <div className="hidden lg:block text-[10px] text-right shrink-0">
                    <div className="text-[#6A7097]">next <span className="text-white">{formatWhen(s.next_run_at)}</span></div>
                    <div className="text-[#6A7097]">last <span className="text-white">{formatWhen(s.last_run_at)}</span></div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {s.status === 'ACTIVE' && (
                      <>
                        <IconBtn title="Run now" busy={busy('run-now')} onClick={() => act(s.schedule_id, 'run-now')} icon={Zap} tone="#38BDF8" />
                        <IconBtn title="Pause" busy={busy('pause')} onClick={() => act(s.schedule_id, 'pause')} icon={Pause} tone="#E8A845" />
                      </>
                    )}
                    {s.status === 'PAUSED' && (
                      <IconBtn title="Resume" busy={busy('resume')} onClick={() => act(s.schedule_id, 'resume')} icon={Play} tone="#00D26A" />
                    )}
                    {s.status !== 'CANCELLED' && s.status !== 'COMPLETED' && (
                      <IconBtn title="Cancel" busy={busy('cancel')} onClick={() => act(s.schedule_id, 'cancel')} icon={Ban} tone="#FF6B6B" />
                    )}
                  </div>
                </div>

                {s.status_reason && (
                  <div className="px-3 pb-2 text-[10px] text-[#E8A845] flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {s.status_reason}
                  </div>
                )}

                {isOpen && (
                  <div className="border-t border-[#1F2442] p-4 bg-[#05060C] space-y-3">
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                      <Row label="Schedule ID" value={s.schedule_id} />
                      <Row label="Workspace" value={s.workspace_id} />
                      <Row label="Capability" value={s.capability} />
                      <Row label="Action" value={s.action} />
                      <Row label="Recurrence" value={s.recurrence_type === 'INTERVAL' ? formatInterval(s.interval_seconds) : 'ONCE'} />
                      <Row label="Created" value={formatWhen(s.created_at)} />
                    </div>

                    <div className="pt-2 border-t border-[#141628]">
                      <div className="text-[10px] text-[#6A7097] uppercase tracking-wider mb-2">Occurrence History</div>
                      {detailLoading === s.schedule_id && (
                        <div className="text-[11px] text-[#8E94B8] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> loading…</div>
                      )}
                      {detailLoading !== s.schedule_id && (!history || history.length === 0) && (
                        <div className="text-[11px] text-[#6A7097]">No occurrences recorded yet.</div>
                      )}
                      {history && history.length > 0 && (
                        <div className="space-y-1.5">
                          {history.map((o) => {
                            const Icon = OCCURRENCE_ICON[o.status] || AlertTriangle;
                            const tone = o.status === 'SUCCEEDED' ? 'text-[#00D26A]' : o.status === 'FAILED' ? 'text-[#FF6B6B]' : 'text-[#E8A845]';
                            return (
                              <div key={o.occurrence_id} className="flex flex-wrap items-center gap-2 text-[10px] p-2 rounded-lg bg-[#080A16] border border-[#141628]">
                                <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
                                <span className={`font-bold ${tone}`}>{o.status}</span>
                                <span className="text-[#6A7097]">due {formatWhen(o.due_at)}</span>
                                <span className="text-[#8E94B8] truncate flex-1 min-w-0">{o.outcome}{o.reason ? ` — ${o.reason}` : ''}</span>
                                {o.task_id && <Link icon={Box} label="task" value={o.task_id} />}
                                {o.artifact_id && <Link icon={Box} label="artifact" value={o.artifact_id} />}
                                {o.receipt_id && <Link icon={FileCheck} label="receipt" value={o.receipt_id} />}
                              </div>
                            );
                          })}
                        </div>
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

const IconBtn: React.FC<{
  title: string; busy: boolean; onClick: () => void;
  icon: React.ComponentType<{ className?: string }>; tone: string;
}> = ({ title, busy, onClick, icon: Icon, tone }) => (
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

const Link: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <span className="inline-flex items-center gap-1 text-[#8C8AFF] shrink-0" title={value}>
    <Icon className="w-3 h-3" /> {label}
  </span>
);

export default SchedulerView;
