import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Code2, Loader2, AlertTriangle, CheckCircle2, XCircle, ShieldAlert, ShieldCheck,
  Plus, Brain, Bot, FileCheck, Clock, Ban, PlayCircle, ChevronRight, Radio, KeyRound,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// DEVELOPMENT — the production surface over the existing development-loop
// backend (/api/development/*). It owns no state machine, no execution
// mechanism and no polling of providers: every value rendered here is a real
// row the server already persisted, and every action is one of the server's
// own routes.
//
// WHAT THIS SCREEN IS FOR. It replaces copying a prompt into ChatGPT, copying
// the reply into an IDE agent, and copying the result back. The task, the
// review, the approval, the execution and the evidence all live in one place,
// and the scheduler advances the execution on its own — there is deliberately
// no "refresh job" button, because needing one would mean the loop was not
// actually automatic.
//
// HONESTY RULES THIS FILE FOLLOWS.
// - No progress percentage exists, because the runtime reports none. Status
//   is the real status word, and nothing animates to imply motion that is
//   not observed.
// - The connection dot reflects the real SSE stream: it only goes live after
//   the server sends a frame, and it goes grey the moment the stream closes.
// - VERIFIED renders only when the backend says VERIFIED.
// - Cancel is rendered disabled and labelled unavailable, because the
//   Antigravity API exposes no cancel operation and marking a row cancelled
//   would leave a sandbox running behind a UI that said it stopped.
// - A field the runtime did not return is shown as absent, never as an empty
//   value dressed up as a result.
// ---------------------------------------------------------------------------

type DevState =
  | 'WAITING_FOR_REVIEW' | 'READY_FOR_EXECUTION' | 'WAITING_FOR_APPROVAL'
  | 'RUNNING' | 'VERIFIED' | 'FAILED' | 'BLOCKED';

interface DevelopmentTask {
  dev_task_id: string;
  workspace_id: string;
  task_id: string | null;
  title: string;
  instruction: string;
  state: DevState;
  state_reason: string | null;
  requires_review: number;
  requires_approval: number;
  review_provider: string | null;
  review_model: string | null;
  review_text: string | null;
  review_at: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  execution_id: string | null;
  result_artifact_id: string | null;
  result_receipt_id: string | null;
  aegis_decision: string | null;
  task_kind: 'GENERAL' | 'CODING';
  evidence_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ExternalExecution {
  id: string;
  runtime: string;
  remote_job_id: string | null;
  remote_path: string;
  status: string;
  poll_attempts: number;
  next_poll_at: string | null;
  correlation_id: string;
  submitted_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  task_id: string | null;
}

interface ReviewResult {
  outcome: 'REVIEWED' | 'NOT_CONFIGURED' | 'FAILED';
  provider: string | null;
  model: string | null;
  reviewText: string | null;
  reason: string;
  contextItems: number;
}

interface CodingEvidence {
  summary?: string;
  filesChanged?: string[];
  testsRun?: string;
  testResult?: string;
  typecheckResult?: string;
  buildResult?: string;
  commitSha?: string;
  blockers?: string[];
}

interface DevelopmentViewProps {
  activeWorkspaceId?: string;
}

/** Shared with ExternalExecutionsView's vocabulary so one status word looks the same everywhere in the Admin. */
const STATE_STYLE: Record<string, string> = {
  VERIFIED: 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]',
  SUCCEEDED: 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]',
  RUNNING: 'bg-[#38BDF8]/10 border-[#38BDF8]/40 text-[#38BDF8]',
  SUBMITTED: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  WAITING_FOR_REVIEW: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  WAITING_FOR_APPROVAL: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  READY_FOR_EXECUTION: 'bg-[#615EFF]/10 border-[#615EFF]/40 text-[#8C8AFF]',
  FAILED: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]',
  BLOCKED: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]',
  UNKNOWN: 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]',
};
const styleFor = (s?: string | null) => STATE_STYLE[s || ''] || STATE_STYLE.UNKNOWN;

const when = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const Panel: React.FC<{ title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({ title, icon, right, children }) => (
  <div className="border border-[#1F2442] rounded-xl bg-[#080A16] overflow-hidden">
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#161A30]">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <h3 className="text-xs font-bold text-white uppercase tracking-wide truncate">{title}</h3>
      </div>
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; value?: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-start gap-3 py-1">
    <span className="text-[10px] uppercase text-[#6A7097] w-36 shrink-0 pt-0.5">{label}</span>
    <span className={`text-xs text-[#C6CBE6] min-w-0 break-words ${mono ? 'font-mono' : ''}`}>
      {value === undefined || value === null || value === '' ? <span className="text-[#4B5070]">not reported</span> : value}
    </span>
  </div>
);

export const DevelopmentView: React.FC<DevelopmentViewProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || '';
  const [tasks, setTasks] = useState<DevelopmentTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExternalExecution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', instruction: '', kind: 'CODING' as 'CODING' | 'GENERAL', requiresReview: true, requiresApproval: true });
  const [streamLive, setStreamLive] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  const selected = tasks.find((t) => t.dev_task_id === selectedId) || null;

  const fetchTasks = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/development/tasks?workspaceId=${encodeURIComponent(workspaceId)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load development tasks');
      setTasks(json.tasks || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load development tasks');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const fetchExecution = useCallback(async (executionId: string | null) => {
    if (!executionId || !workspaceId) { setExecution(null); return; }
    try {
      const res = await fetch(`/api/external-executions/${encodeURIComponent(executionId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
      const json = await res.json();
      setExecution(json.success ? json.execution : null);
    } catch {
      setExecution(null);
    }
  }, [workspaceId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { setReview(null); fetchExecution(selected?.execution_id || null); }, [selected?.dev_task_id, selected?.execution_id, fetchExecution]);

  // Real-time. The existing SSE feed over the runtime-event ledger — the
  // server pushes only events it genuinely recorded, so there is nothing to
  // simulate here. Every frame simply triggers a re-read of real state.
  const streamRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    const es = new EventSource(`/api/development/events?workspaceId=${encodeURIComponent(workspaceId)}`);
    streamRef.current = es;
    const markLive = () => setStreamLive(true);
    es.addEventListener('ready', markLive);
    es.addEventListener('heartbeat', markLive);
    es.addEventListener('runtime', (ev) => {
      setStreamLive(true);
      try { setLastEventAt(JSON.parse((ev as MessageEvent).data)?.created_at || null); } catch { /* frame shape is the server's */ }
      fetchTasks();
    });
    es.onerror = () => setStreamLive(false);
    return () => { es.close(); streamRef.current = null; setStreamLive(false); };
  }, [workspaceId, fetchTasks]);

  // Refresh the selected execution whenever its task row moved.
  useEffect(() => { if (selected?.execution_id) fetchExecution(selected.execution_id); }, [selected?.state, selected?.execution_id, fetchExecution]);

  const post = useCallback(async (url: string, body: Record<string, unknown>, label: string) => {
    setBusy(label); setActionError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, ...body }) });
      const json = await res.json();
      if (!res.ok && !json?.task) throw new Error(json?.error || `${label} failed`);
      await fetchTasks();
      return json;
    } catch (e: any) {
      setActionError(e?.message || `${label} failed`);
      return null;
    } finally {
      setBusy(null);
    }
  }, [workspaceId, fetchTasks]);

  const evidence: CodingEvidence | null = (() => {
    if (!selected?.evidence_json) return null;
    try { return JSON.parse(selected.evidence_json); } catch { return null; }
  })();

  const verifiedTasks = tasks.filter((t) => t.state === 'VERIFIED').length;
  const actionable = tasks.filter((t) => t.state === 'WAITING_FOR_REVIEW' || t.state === 'WAITING_FOR_APPROVAL' || t.state === 'READY_FOR_EXECUTION');

  if (!workspaceId) {
    return (
      <div className="p-10 text-center border border-[#1F2442] rounded-2xl bg-[#080A16]">
        <Code2 className="w-8 h-8 text-[#2D3352] mx-auto mb-3" />
        <p className="text-sm text-[#8E94B8] font-semibold">No active workspace.</p>
        <p className="text-xs text-[#6A7097] mt-1">Development tasks are workspace-scoped. Select a workspace to continue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="border border-[#1F2442] rounded-2xl bg-[#080A16] p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Code2 className="w-5 h-5 text-[#615EFF]" /> Development
            </h2>
            <p className="text-xs text-[#6A7097] mt-1">
              Task → review → approval → Antigravity → Aegis → receipt. The scheduler advances execution; there is no manual poll.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold border bg-[#0B0D1B] border-[#1F2442] text-[#8E94B8] font-mono">
              {workspaceId}
            </span>
            {/* Real connection state. Live only once the server has actually
                sent a frame; grey the instant the stream drops. */}
            <span
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 ${
                streamLive ? 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]' : 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]'
              }`}
              title={streamLive ? `Live event stream connected. Last event: ${when(lastEventAt)}` : 'Event stream not connected.'}
            >
              <Radio className="w-3 h-3" /> {streamLive ? 'LIVE' : 'DISCONNECTED'}
            </span>
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold border bg-[#0B0D1B] border-[#1F2442] text-[#8E94B8]">
              {tasks.length} TASKS · {verifiedTasks} VERIFIED
            </span>
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

      {error && (
        <div className="p-4 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div><div className="font-bold uppercase">Could not load development tasks</div><div className="text-[#C98B8B] mt-0.5">{error}</div></div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT — SPRINT / TASK QUEUE */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white uppercase tracking-wide">Sprint / Task Queue</h3>
            <button
              onClick={() => setCreating((v) => !v)}
              className="px-2.5 py-1.5 rounded-lg bg-[#615EFF] hover:bg-[#524EFA] text-[10px] font-bold text-white flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3 h-3" /> New Task
            </button>
          </div>

          {creating && (
            <div className="border border-[#1F2442] rounded-xl bg-[#080A16] p-3 space-y-2">
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Task title"
                className="w-full bg-[#05060A] border border-[#1F2442] rounded-lg px-2.5 py-2 text-xs text-white placeholder-[#4B5070] outline-none focus:border-[#615EFF]"
              />
              <textarea
                value={draft.instruction}
                onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
                placeholder="Instruction the runtime will execute"
                rows={4}
                className="w-full bg-[#05060A] border border-[#1F2442] rounded-lg px-2.5 py-2 text-xs text-white placeholder-[#4B5070] outline-none focus:border-[#615EFF] resize-y"
              />
              <div className="flex items-center gap-3 flex-wrap text-[10px] text-[#8E94B8]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={draft.kind === 'CODING'} onChange={(e) => setDraft({ ...draft, kind: e.target.checked ? 'CODING' : 'GENERAL' })} />
                  Coding task (asks the runtime for structured evidence)
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={draft.requiresReview} onChange={(e) => setDraft({ ...draft, requiresReview: e.target.checked })} /> Requires review
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={draft.requiresApproval} onChange={(e) => setDraft({ ...draft, requiresApproval: e.target.checked })} /> Requires approval
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={!draft.title.trim() || !draft.instruction.trim() || busy === 'create'}
                  onClick={async () => {
                    const json = await post('/api/development/tasks', draft, 'create');
                    if (json?.task) { setSelectedId(json.task.dev_task_id); setCreating(false); setDraft({ ...draft, title: '', instruction: '' }); }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#00D26A] hover:bg-[#00B85C] disabled:opacity-40 text-[10px] font-bold text-black cursor-pointer"
                >
                  {busy === 'create' ? 'Creating…' : 'Create Task'}
                </button>
                <button onClick={() => setCreating(false)} className="px-3 py-1.5 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[10px] font-bold text-[#8E94B8] cursor-pointer">Cancel</button>
              </div>
            </div>
          )}

          {loading && tasks.length === 0 && (
            <div className="p-6 text-center text-xs text-[#8E94B8] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading development tasks…
            </div>
          )}

          {!loading && tasks.length === 0 && !error && (
            <div className="p-8 text-center border border-[#1F2442] rounded-xl bg-[#080A16]">
              <Code2 className="w-7 h-7 text-[#2D3352] mx-auto mb-2" />
              <p className="text-xs text-[#8E94B8] font-semibold">No development tasks in this workspace.</p>
              <p className="text-[11px] text-[#6A7097] mt-1">Create one to start a review → approve → execute cycle.</p>
            </div>
          )}

          <div className="space-y-2">
            {tasks.map((t) => (
              <button
                key={t.dev_task_id}
                onClick={() => setSelectedId(t.dev_task_id)}
                className={`w-full text-left border rounded-xl bg-[#080A16] p-3 cursor-pointer transition ${
                  selectedId === t.dev_task_id ? 'border-[#615EFF]' : 'border-[#1F2442] hover:border-[#2D3352]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold text-white truncate">{t.title}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border shrink-0 ${styleFor(t.state)}`}>{t.state}</span>
                </div>
                {t.state_reason && <p className="text-[10px] text-[#6A7097] mt-1 line-clamp-2">{t.state_reason}</p>}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0B0D1B] border border-[#1F2442] text-[#6A7097]">{t.task_kind}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${t.review_at ? 'bg-[#00D26A]/10 border-[#00D26A]/30 text-[#00D26A]' : 'bg-[#0B0D1B] border-[#1F2442] text-[#6A7097]'}`}>
                    {t.review_at ? 'REVIEWED' : t.requires_review ? 'REVIEW REQ' : 'NO REVIEW'}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${t.approved_at ? 'bg-[#00D26A]/10 border-[#00D26A]/30 text-[#00D26A]' : 'bg-[#0B0D1B] border-[#1F2442] text-[#6A7097]'}`}>
                    {t.approved_at ? 'APPROVED' : t.requires_approval ? 'APPROVAL REQ' : 'NO APPROVAL'}
                  </span>
                  {t.execution_id && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0B0D1B] border border-[#1F2442] text-[#6A7097]">EXEC</span>}
                  {t.result_receipt_id && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#38BDF8]/10 border border-[#38BDF8]/30 text-[#38BDF8]">RECEIPT</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT — DETAIL */}
        <div className="lg:col-span-2 space-y-4">
          {!selected && (
            <div className="p-10 text-center border border-[#1F2442] rounded-2xl bg-[#080A16]">
              <ChevronRight className="w-7 h-7 text-[#2D3352] mx-auto mb-2" />
              <p className="text-xs text-[#8E94B8]">Select a task to see its review, execution and evidence.</p>
            </div>
          )}

          {selected && (
            <>
              {/* CHATGPT / OPENAI REVIEW */}
              <Panel
                title="ChatGPT Review (OpenAI)"
                icon={<Brain className="w-4 h-4 text-[#8C8AFF]" />}
                right={
                  <>
                    {review && <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${review.outcome === 'REVIEWED' ? STATE_STYLE.VERIFIED : review.outcome === 'FAILED' ? STATE_STYLE.FAILED : STATE_STYLE.UNKNOWN}`}>{review.outcome}</span>}
                    <button
                      disabled={busy === 'review'}
                      onClick={async () => {
                        const json = await post(`/api/development/tasks/${selected.dev_task_id}/review`, {}, 'review');
                        if (json?.review) setReview(json.review);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#615EFF] hover:bg-[#524EFA] disabled:opacity-40 text-[10px] font-bold text-white cursor-pointer"
                    >
                      {busy === 'review' ? 'Requesting…' : 'Request Review'}
                    </button>
                  </>
                }
              >
                {review?.outcome === 'NOT_CONFIGURED' && (
                  <div className="p-3 mb-3 rounded-lg bg-[#7E8BB5]/10 border border-[#7E8BB5]/40 text-[11px] text-[#A8AECB] flex items-start gap-2">
                    <KeyRound className="w-4 h-4 mt-0.5 shrink-0 text-[#7E8BB5]" />
                    <div>
                      <div className="font-bold text-[#C6CBE6] uppercase text-[10px]">OpenAI NOT_CONFIGURED</div>
                      <div className="mt-0.5">{review.reason}</div>
                      <div className="mt-1 text-[#6A7097]">Configure it in Settings → Model Providers. No other provider is substituted.</div>
                    </div>
                  </div>
                )}
                {review?.outcome === 'FAILED' && (
                  <div className="p-3 mb-3 rounded-lg bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 text-[11px] text-[#FF6B6B]">{review.reason}</div>
                )}
                <Field label="Provider" value={selected.review_provider} />
                <Field label="Model" value={selected.review_model} mono />
                <Field label="Reviewed at" value={selected.review_at ? when(selected.review_at) : undefined} />
                <Field label="Brain context items" value={review ? `${review.contextItems} scoped item(s)` : undefined} />
                {selected.review_text ? (
                  <pre className="mt-3 p-3 rounded-lg bg-[#05060A] border border-[#161A30] text-[11px] text-[#C6CBE6] whitespace-pre-wrap max-h-72 overflow-auto">{selected.review_text}</pre>
                ) : (
                  <p className="mt-3 text-[11px] text-[#4B5070]">No review has been recorded for this task.</p>
                )}
              </Panel>

              {/* GUARDIAN */}
              <Panel
                title="Guardian"
                icon={<ShieldAlert className="w-4 h-4 text-[#E8A845]" />}
                right={
                  selected.state === 'WAITING_FOR_APPROVAL' ? (
                    <button
                      disabled={busy === 'approve'}
                      onClick={() => post(`/api/development/tasks/${selected.dev_task_id}/approve`, {}, 'approve')}
                      className="px-2.5 py-1 rounded-lg bg-[#00D26A] hover:bg-[#00B85C] disabled:opacity-40 text-[10px] font-bold text-black cursor-pointer"
                    >
                      {busy === 'approve' ? 'Approving…' : 'Approve'}
                    </button>
                  ) : selected.state === 'READY_FOR_EXECUTION' ? (
                    <button
                      disabled={busy === 'dispatch'}
                      onClick={() => post(`/api/development/tasks/${selected.dev_task_id}/dispatch`, {}, 'dispatch')}
                      className="px-2.5 py-1 rounded-lg bg-[#615EFF] hover:bg-[#524EFA] disabled:opacity-40 text-[10px] font-bold text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <PlayCircle className="w-3 h-3" /> {busy === 'dispatch' ? 'Dispatching…' : 'Dispatch to Antigravity'}
                    </button>
                  ) : null
                }
              >
                <Field label="Review required" value={selected.requires_review ? 'YES' : 'NO'} />
                <Field label="Approval required" value={selected.requires_approval ? 'YES' : 'NO'} />
                <Field label="Approved by" value={selected.approved_by_user_id} mono />
                <Field label="Approved at" value={selected.approved_at ? when(selected.approved_at) : undefined} />
                {selected.state === 'BLOCKED' && (
                  <div className="mt-3 p-3 rounded-lg bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 text-[11px] text-[#FF6B6B] flex items-start gap-2">
                    <Ban className="w-4 h-4 mt-0.5 shrink-0" />
                    <div><div className="font-bold uppercase text-[10px]">Blocked by Guardian</div><div className="mt-0.5">{selected.state_reason}</div></div>
                  </div>
                )}
              </Panel>

              {/* ANTIGRAVITY EXECUTION */}
              <Panel
                title="Antigravity Execution"
                icon={<Bot className="w-4 h-4 text-[#38BDF8]" />}
                right={
                  <>
                    {execution && <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${styleFor(execution.status)}`}>{execution.status}</span>}
                    {/* Rendered disabled on purpose: the provider exposes no
                        cancel operation, and a working-looking button would
                        promise something SynthOS cannot do. */}
                    <button disabled title="The Antigravity API exposes no cancel operation." className="px-2.5 py-1 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[10px] font-bold text-[#4B5070] cursor-not-allowed">
                      Cancel — unavailable
                    </button>
                  </>
                }
              >
                {!execution && <p className="text-[11px] text-[#4B5070]">This task has not been dispatched to a runtime yet.</p>}
                {execution && (
                  <>
                    <Field label="Runtime" value={execution.runtime} />
                    <Field label="Agent" value={execution.remote_path} mono />
                    <Field label="Interaction ID" value={execution.remote_job_id} mono />
                    <Field label="Correlation" value={execution.correlation_id} mono />
                    <Field label="Poll attempts" value={String(execution.poll_attempts)} />
                    <Field
                      label="Next poll"
                      value={execution.next_poll_at ? when(execution.next_poll_at) : (
                        <span className="text-[#6A7097]">polling stopped (terminal)</span>
                      )}
                    />
                    <Field label="Submitted" value={execution.submitted_at ? when(execution.submitted_at) : undefined} />
                    <Field label="Completed" value={execution.completed_at ? when(execution.completed_at) : undefined} />
                    {execution.error_message_safe && (
                      <div className="mt-3 p-3 rounded-lg bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 text-[11px] text-[#FF6B6B]">
                        <span className="font-bold">{execution.error_code}: </span>{execution.error_message_safe}
                      </div>
                    )}
                    {execution.status === 'RUNNING' && (
                      <p className="mt-3 text-[11px] text-[#6A7097] flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> The scheduler is advancing this automatically. No manual refresh is required.
                      </p>
                    )}
                  </>
                )}

                {selected.task_kind === 'CODING' && (
                  <div className="mt-4 pt-3 border-t border-[#161A30]">
                    <h4 className="text-[10px] font-bold text-[#8E94B8] uppercase mb-2">Engineering evidence</h4>
                    {!evidence && (
                      <p className="text-[11px] text-[#4B5070]">
                        The runtime did not return a structured evidence block for this task. Nothing is inferred from the output.
                      </p>
                    )}
                    {evidence && (
                      <>
                        <Field label="Summary" value={evidence.summary} />
                        <Field label="Files changed" value={evidence.filesChanged?.length ? evidence.filesChanged.join(', ') : undefined} mono />
                        <Field label="Tests run" value={evidence.testsRun} mono />
                        <Field label="Test result" value={evidence.testResult} />
                        <Field label="Typecheck" value={evidence.typecheckResult} />
                        <Field label="Build" value={evidence.buildResult} />
                        <Field label="Commit SHA" value={evidence.commitSha} mono />
                        <Field label="Blockers" value={evidence.blockers?.length ? evidence.blockers.join('; ') : undefined} />
                      </>
                    )}
                  </div>
                )}
              </Panel>

              {/* AEGIS / EVIDENCE + BRAIN WRITEBACK */}
              <Panel
                title="Aegis · Receipt · Brain"
                icon={<ShieldCheck className="w-4 h-4 text-[#00D26A]" />}
                right={selected.aegis_decision ? <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${styleFor(selected.aegis_decision === 'VERIFIED' ? 'VERIFIED' : 'FAILED')}`}>{selected.aegis_decision}</span> : null}
              >
                <Field label="Aegis decision" value={selected.aegis_decision} />
                <Field label="Receipt ID" value={selected.result_receipt_id} mono />
                <Field label="Artifact ID" value={selected.result_artifact_id} mono />
                <Field label="Canonical task" value={selected.task_id} mono />
                <div className="mt-3 pt-3 border-t border-[#161A30] space-y-1.5">
                  {/* Derived strictly from persisted evidence. A receipt id
                      exists only when the server signed one; an artifact id
                      only when one was written. Nothing here says "Brain
                      updated" on its own authority. */}
                  <div className="flex items-center gap-2 text-[11px]">
                    {selected.result_artifact_id
                      ? <><CheckCircle2 className="w-3.5 h-3.5 text-[#00D26A]" /><span className="text-[#C6CBE6]">Artifact written and indexed</span></>
                      : <><XCircle className="w-3.5 h-3.5 text-[#4B5070]" /><span className="text-[#4B5070]">No artifact recorded</span></>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    {selected.result_receipt_id
                      ? <><FileCheck className="w-3.5 h-3.5 text-[#38BDF8]" /><span className="text-[#C6CBE6]">Signed receipt issued</span></>
                      : <><XCircle className="w-3.5 h-3.5 text-[#4B5070]" /><span className="text-[#4B5070]">No receipt issued</span></>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    {selected.state === 'VERIFIED'
                      ? <><CheckCircle2 className="w-3.5 h-3.5 text-[#00D26A]" /><span className="text-[#C6CBE6]">DEVELOPMENT_CYCLE_COMPLETED recorded to activity</span></>
                      : <><XCircle className="w-3.5 h-3.5 text-[#4B5070]" /><span className="text-[#4B5070]">Cycle not yet completed</span></>}
                  </div>
                </div>
              </Panel>

              {/* NEXT TASK */}
              <div className="border border-[#1F2442] rounded-xl bg-[#080A16] p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">Next Task</h3>
                    <p className="text-[11px] text-[#6A7097] mt-0.5">
                      {selected.state === 'VERIFIED'
                        ? 'This cycle is verified. Choose the next task to continue — continuation stays a human decision.'
                        : 'Available once the selected task reaches VERIFIED.'}
                    </p>
                  </div>
                  <select
                    disabled={selected.state !== 'VERIFIED' || actionable.length === 0}
                    value=""
                    onChange={(e) => { if (e.target.value) setSelectedId(e.target.value); }}
                    className="bg-[#05060A] border border-[#1F2442] rounded-lg px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <option value="">{actionable.length === 0 ? 'No tasks awaiting action' : 'Select next task…'}</option>
                    {actionable.map((t) => <option key={t.dev_task_id} value={t.dev_task_id}>{t.title} — {t.state}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DevelopmentView;
