import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, RefreshCw, Check, X, Clock, AlertTriangle,
  User, Fingerprint, ChevronDown, ChevronRight, Ban, CircleCheck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// APPROVAL QUEUE — the human decision surface.
//
// Every row is a real `approvals` row from GET /api/approvals. There is no
// placeholder, no example, and no client-side status: if the queue is empty it
// says so, and if it cannot be read it says UNKNOWN rather than drawing an
// empty table that reads as "nothing needs your attention".
//
// WHAT IS DELIBERATELY NOT SHOWN
// No raw provider payload and no credential. The operator sees the bounded
// `action_summary` the envelope assembled — which lib/approvals.ts scrubs
// through lib/redact.ts before storing — plus the input digest, which is how
// they can tell two similar-looking requests apart without either of them
// having to display their full contents.
//
// Guardian's verdict is shown beside the human decision rather than merged with
// it. They are two independent gates and an operator needs to see that policy
// already passed; a single combined "status" would hide which gate is
// outstanding.
// ---------------------------------------------------------------------------

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONSUMED';

interface ApprovalRow {
  approval_id: string;
  workspace_id: string;
  task_id: string | null;
  correlation_id: string;
  capability: string;
  action: string;
  effect_class: string;
  requested_by_user_id: string;
  decided_by_user_id: string | null;
  guardian_decision: string;
  guardian_citation: string | null;
  action_summary: string;
  input_digest: string;
  status: ApprovalStatus;
  decision_reason: string | null;
  created_at: string;
  decided_at: string | null;
  expires_at: string | null;
  consumed_at: string | null;
  consumed_by_task_id: string | null;
}

interface Summary { pending: number; approved: number; rejected: number; consumed: number; expired: number }

const STATUS_COLOR: Record<ApprovalStatus, string> = {
  PENDING: '#F59E0B',   // needs attention
  APPROVED: '#00D26A',
  REJECTED: '#EF4444',
  CONSUMED: '#38BDF8',  // used, terminal, not a problem
  EXPIRED: '#7E8BB5',   // inert — recedes, never glows
};

function fmt(ts: string | null): string {
  if (!ts) return '—';
  try { return new Date(ts).toISOString().replace('T', ' ').slice(0, 19); } catch { return ts; }
}

function expiresIn(expiresAt: string | null): { label: string; urgent: boolean } {
  if (!expiresAt) return { label: 'no expiry', urgent: false };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'expired', urgent: true };
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return { label: `${mins}m left`, urgent: mins < 10 };
  return { label: `${Math.floor(mins / 60)}h ${mins % 60}m left`, urgent: false };
}

export const ApprovalQueueView: React.FC<{ activeWorkspaceId?: string }> = ({ activeWorkspaceId }) => {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const ws = activeWorkspaceId || '';

  const load = useCallback(async () => {
    if (!ws) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/approvals?workspaceId=${encodeURIComponent(ws)}`);
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
      setRows(Array.isArray(body.approvals) ? body.approvals : []);
      setSummary(body.summary ?? null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
      setRows(null);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [ws]);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    setDeciding(approvalId);
    setNotice(null);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: ws, decision, reason: reasons[approvalId] || undefined }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
      setNotice(`${approvalId} → ${decision}`);
      await load();
    } catch (err: any) {
      // A failed decision is surfaced, never swallowed — the operator must not
      // be left believing they approved something that did not record.
      setNotice(`Could not decide ${approvalId}: ${err?.message || String(err)}`);
    } finally {
      setDeciding(null);
    }
  }, [ws, reasons, load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    return filter === 'PENDING' ? rows.filter((r) => r.status === 'PENDING') : rows;
  }, [rows, filter]);

  const countLabel = rows === null ? 'UNKNOWN' : String(summary?.pending ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-[#F3F4F9] flex items-center gap-2">
            <ShieldCheck size={18} style={{ color: '#F59E0B' }} />
            Approval Queue ({countLabel} pending)
          </h2>
          <p className="text-[11px] text-[#9C97B4] mt-1 max-w-3xl font-mono">
            External actions stop here. Guardian policy has already passed for anything listed —
            what remains is your decision. Approvals are single-use and bound to the exact inputs shown.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-[11px] border border-white/[.085] bg-white/[.035] hover:bg-white/[.055] text-[10px] font-mono uppercase tracking-wider text-[#F3F4F9] disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {([
            ['Pending', summary.pending, STATUS_COLOR.PENDING],
            ['Approved', summary.approved, STATUS_COLOR.APPROVED],
            ['Rejected', summary.rejected, STATUS_COLOR.REJECTED],
            ['Consumed', summary.consumed, STATUS_COLOR.CONSUMED],
            ['Expired', summary.expired, STATUS_COLOR.EXPIRED],
          ] as const).map(([label, value, color]) => (
            <div key={label} className="rounded-[11px] border border-white/[.085] bg-white/[.035] px-3 py-2">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#9C97B4]">{label}</div>
              <div className="text-xl font-semibold mt-0.5" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        {(['PENDING', 'ALL'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1.5 rounded-[11px] border text-[9px] font-mono uppercase tracking-wider ${
              filter === f ? 'border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#F3F4F9]' : 'border-white/[.085] bg-white/[.035] text-[#9C97B4] hover:bg-white/[.055]'
            }`}
          >
            {f === 'PENDING' ? 'AWAITING DECISION' : 'ALL RECORDS'}
          </button>
        ))}
      </div>

      {notice && (
        <div className="rounded-[11px] border border-white/[.085] bg-white/[.03] px-3 py-2 text-[11px] font-mono text-[#F3F4F9]">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-[11px] border border-[#EF4444]/30 bg-[#EF4444]/[.08] px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-[#EF4444] mt-0.5 shrink-0" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#EF4444]">Queue unreadable — UNKNOWN</div>
            <div className="text-[11px] text-[#9C97B4] mt-0.5 font-mono">{error}</div>
          </div>
        </div>
      )}

      {loading && rows === null && !error && (
        <div className="text-[11px] font-mono text-[#665F85] px-1">Reading the approval queue…</div>
      )}

      {rows !== null && visible.length === 0 && (
        <div className="rounded-[14px] border border-white/[.085] bg-white/[.02] px-4 py-8 text-center">
          <CircleCheck size={22} className="mx-auto mb-2 text-[#00D26A]" />
          <div className="text-[12px] text-[#F3F4F9]">
            {filter === 'PENDING' ? 'Nothing is waiting for your decision.' : 'No approval records in this workspace.'}
          </div>
          <div className="text-[10px] font-mono text-[#665F85] mt-1">
            An external action will appear here the moment one is requested.
          </div>
        </div>
      )}

      <div className="space-y-2">
        {visible.map((r) => {
          const exp = expiresIn(r.expires_at);
          const isOpen = expanded === r.approval_id;
          const busy = deciding === r.approval_id;
          return (
            <div key={r.approval_id} className="rounded-[14px] border border-white/[.085] bg-white/[.035] overflow-hidden">
              <div className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="px-2 py-0.5 rounded-[20px] text-[9px] font-mono uppercase tracking-wider"
                        style={{ color: STATUS_COLOR[r.status], backgroundColor: `${STATUS_COLOR[r.status]}1A` }}
                      >
                        {r.status}
                      </span>
                      <span className="px-2 py-0.5 rounded-[20px] text-[9px] font-mono uppercase tracking-wider text-[#EF4444] bg-[#EF4444]/10">
                        {r.effect_class}
                      </span>
                      <span className="text-[11px] font-mono text-[#615EFF]">{r.capability}</span>
                      <span className="text-[10px] font-mono text-[#665F85]">· {r.action}</span>
                    </div>

                    <div className="mt-2 flex items-center gap-3 flex-wrap text-[10px] font-mono text-[#9C97B4]">
                      <span className="inline-flex items-center gap-1">
                        {r.guardian_decision === 'SAFE'
                          ? <><ShieldCheck size={11} className="text-[#00D26A]" /> Guardian: SAFE</>
                          : <><ShieldAlert size={11} className="text-[#F59E0B]" /> Guardian: {r.guardian_decision}</>}
                      </span>
                      <span className="inline-flex items-center gap-1"><User size={11} /> requested by {r.requested_by_user_id}</span>
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {fmt(r.created_at)}</span>
                      {r.status === 'PENDING' && (
                        <span className="inline-flex items-center gap-1" style={{ color: exp.urgent ? '#EF4444' : '#9C97B4' }}>
                          <Clock size={11} /> {exp.label}
                        </span>
                      )}
                      {r.decided_by_user_id && (
                        <span className="inline-flex items-center gap-1">
                          decided by {r.decided_by_user_id} at {fmt(r.decided_at)}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => setExpanded(isOpen ? null : r.approval_id)}
                      className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#9C97B4] hover:text-[#F3F4F9]"
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Details
                    </button>
                  </div>

                  {r.status === 'PENDING' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => void decide(r.approval_id, 'APPROVED')}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[11px] border border-[#00D26A]/40 bg-[#00D26A]/[.12] hover:bg-[#00D26A]/20 text-[10px] font-mono uppercase tracking-wider text-[#00D26A] disabled:opacity-40"
                      >
                        <Check size={12} /> Approve
                      </button>
                      <button
                        onClick={() => void decide(r.approval_id, 'REJECTED')}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[11px] border border-[#EF4444]/40 bg-[#EF4444]/[.12] hover:bg-[#EF4444]/20 text-[10px] font-mono uppercase tracking-wider text-[#EF4444] disabled:opacity-40"
                      >
                        <X size={12} /> Reject
                      </button>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-white/[.055] space-y-3">
                    <div>
                      <div className="text-[9px] font-mono uppercase tracking-wider text-[#9C97B4] mb-1">
                        Bounded action summary (secret-scrubbed; never a raw provider payload)
                      </div>
                      <pre className="text-[10px] font-mono text-[#F1EFF9] bg-black/25 rounded-[11px] p-2.5 overflow-x-auto whitespace-pre-wrap break-words max-h-64">
{r.action_summary}
                      </pre>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                      <div className="rounded-[11px] border border-white/[.085] px-2.5 py-2">
                        <div className="text-[9px] uppercase tracking-wider text-[#9C97B4] flex items-center gap-1">
                          <Fingerprint size={10} /> Input digest (the binding)
                        </div>
                        <div className="text-[#F3F4F9] mt-1 break-all">{r.input_digest}</div>
                        <div className="text-[#665F85] mt-1 leading-relaxed">
                          This approval authorizes only inputs hashing to this value. Change the action and it no longer applies.
                        </div>
                      </div>
                      <div className="rounded-[11px] border border-white/[.085] px-2.5 py-2">
                        <div className="text-[9px] uppercase tracking-wider text-[#9C97B4]">Evidence links</div>
                        <div className="text-[#F3F4F9] mt-1 break-all">correlation: {r.correlation_id}</div>
                        <div className="text-[#F3F4F9] break-all">task: {r.task_id || '—'}</div>
                        <div className="text-[#F3F4F9] break-all">consumed by: {r.consumed_by_task_id || '—'}</div>
                        {r.guardian_citation && <div className="text-[#9C97B4] mt-1">policy: {r.guardian_citation}</div>}
                      </div>
                    </div>

                    {r.decision_reason && (
                      <div className="text-[10px] font-mono text-[#9C97B4]">
                        Decision reason: <span className="text-[#F3F4F9]">{r.decision_reason}</span>
                      </div>
                    )}

                    {r.status === 'PENDING' && (
                      <div>
                        <div className="text-[9px] font-mono uppercase tracking-wider text-[#9C97B4] mb-1">
                          Optional reason (recorded with your decision)
                        </div>
                        <input
                          value={reasons[r.approval_id] || ''}
                          onChange={(e) => setReasons((p) => ({ ...p, [r.approval_id]: e.target.value }))}
                          placeholder="Why you approved or rejected…"
                          className="w-full px-2.5 py-1.5 rounded-[11px] border border-white/[.085] bg-white/[.035] text-[11px] text-[#F3F4F9] placeholder:text-[#665F85] font-mono focus:outline-none focus:border-[#F59E0B]/50"
                        />
                      </div>
                    )}

                    {r.status === 'CONSUMED' && (
                      <div className="text-[10px] font-mono text-[#38BDF8] inline-flex items-center gap-1">
                        <Ban size={11} /> Single-use: spent at {fmt(r.consumed_at)} and cannot authorize another dispatch.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
