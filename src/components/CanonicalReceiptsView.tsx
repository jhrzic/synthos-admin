import React, { useState, useEffect, useCallback } from 'react';
import {
  FileCheck, ShieldCheck, ShieldAlert, RefreshCw, Loader2, AlertTriangle,
  ChevronDown, ChevronRight, Key, Hash, Box, Cpu, Search
} from 'lucide-react';
import { ReceiptOutcomeBadge, RetrievalBadge } from './verification/outcome';
import { AuthorityRecordPanel } from './AuthorityRecordPanel';

// ---------------------------------------------------------------------------
// CANONICAL EXECUTION RECEIPTS — the real, Ed25519-signed receipts the
// execution fabric writes (lib/persistence.ts: recordReceipt/signReceiptPayload).
//
// WHY THIS SCREEN EXISTS. The `receipts` nav slot used to render ReceiptsView,
// which shows the legacy Kanban board's LOCAL/DEMO receipts — a client-side
// rolling hash (src/services/synthosControlService.ts), no key material, not
// independently verifiable. Meanwhile the real signed receipts had no UI at
// all. The visible product therefore presented non-cryptographic receipts in
// the place a user would look for proof.
//
// Everything below comes from GET /api/execution/receipts, which reads the one
// `receipts` table and re-runs verifyReceipt() per row server-side. `verified`
// is a signature check that actually ran — never a stored flag.
//
// The canonical payload contains only ids, hashes and the Aegis decision. It
// carries no prompts, secrets or provider payloads, which is why the detail
// panel can show exactly what was signed.
// ---------------------------------------------------------------------------

interface CanonicalReceipt {
  receipt_id: string;
  task_id: string;
  review_id: string;
  algorithm: string;
  created_at: string;
  signature: string;
  public_key: string;
  verified: boolean;
  payloadError: string | null;
  artifactRetrieval?: { status: string; reason: string | null; at: string | null } | null;
  payload: {
    /** COMPLETED / INCOMPLETE / VERIFICATION_FAILED — absent on receipts signed before outcomes existed. */
    outcome?: string;
    /** Plain statement of which scopes this receipt attests. */
    verificationScope?: string;
    aegisDecision?: string;
    aegisMethod?: string;
    artifactHash?: string;
    artifactId?: string;
    assignedAgent?: string;
    modelUsed?: string;
    provider?: string;
    workspaceId?: string;
    [k: string]: unknown;
  };
}

interface CanonicalReceiptsViewProps {
  activeWorkspaceId?: string;
}

const UNKNOWN = <span className="text-[#6A7097]">UNKNOWN</span>;

export const CanonicalReceiptsView: React.FC<CanonicalReceiptsViewProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';

  const [receipts, setReceipts] = useState<CanonicalReceipt[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/execution/receipts?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        setError(data?.error || `HTTP ${res.status}`);
        setReceipts([]);
        setTotal(null);
      } else {
        setReceipts(data.receipts || []);
        setTotal(typeof data.totalInWorkspace === 'number' ? data.totalInWorkspace : null);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting the receipts API.');
      setReceipts([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  const visible = receipts.filter((r) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      r.receipt_id.toLowerCase().includes(q) ||
      r.task_id.toLowerCase().includes(q) ||
      String(r.payload.artifactId || '').toLowerCase().includes(q) ||
      String(r.payload.assignedAgent || '').toLowerCase().includes(q)
    );
  });

  const verifiedCount = receipts.filter((r) => r.verified).length;
  const failedCount = receipts.length - verifiedCount;

  return (
    <div className="space-y-6 font-mono pb-12">
      <AuthorityRecordPanel workspaceId={workspaceId} />
      <div className="bg-gradient-to-r from-[#00D26A]/15 via-[#0B0D1B] to-[#38BDF8]/15 border border-[#00D26A]/40 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#00D26A]/20 border border-[#00D26A]/50 flex items-center justify-center text-[#00D26A] shrink-0">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">Execution Receipts</h1>
              <p className="text-xs text-[#8E94B8] mt-1 font-sans">
                Ed25519-signed receipts from the execution fabric · Workspace: <span className="text-white">{workspaceId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={fetchReceipts}
            disabled={loading}
            className="p-2 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50"
            title="Refresh receipts"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 border-t border-[#00D26A]/20 pt-4">
          <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
            <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">Receipts In Workspace</span>
            <span className="text-xl font-extrabold text-white mt-0.5 block">
              {loading ? '…' : error ? 'UNKNOWN' : (total ?? receipts.length)}
            </span>
          </div>
          <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
            <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">Signature Verified</span>
            <span className="text-xl font-extrabold text-[#00D26A] mt-0.5 block">{loading || error ? '—' : verifiedCount}</span>
            <span className="text-[10px] text-[#7B82A8] block mt-0.5">Re-checked on this request</span>
          </div>
          <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
            <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">Signature Failed</span>
            <span className={`text-xl font-extrabold mt-0.5 block ${failedCount > 0 ? 'text-[#FF6B6B]' : 'text-[#7B82A8]'}`}>
              {loading || error ? '—' : failedCount}
            </span>
          </div>
          <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
            <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">Algorithm</span>
            <span className="text-base font-extrabold text-[#38BDF8] mt-0.5 block inline-flex items-center gap-1.5" data-testid="receipts-algorithm">
              <Key className="w-3.5 h-3.5" /> {receipts[0]?.algorithm || 'UNKNOWN'}
            </span>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#4C5274]" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by receipt id, task id, artifact or agent…"
          className="w-full bg-[#090A16] border border-[#1E223D] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-[#4C5274] focus:outline-none focus:border-[#00D26A]"
        />
      </div>

      {loading && (
        <div className="p-8 text-center text-xs text-[#8E94B8] flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading canonical receipts…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold uppercase">Could not load receipts</div>
            <div className="text-[#C98B8B] mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="p-10 text-center border border-[#1F2442] rounded-2xl bg-[#080A16]">
          <FileCheck className="w-8 h-8 text-[#2D3352] mx-auto mb-3" />
          <p className="text-sm text-[#8E94B8] font-semibold">
            {receipts.length === 0 ? 'No execution receipts in this workspace yet.' : 'No receipts match this filter.'}
          </p>
          <p className="text-xs text-[#6A7097] mt-1">
            {receipts.length === 0
              ? 'A receipt is written when the execution fabric completes and verifies a task.'
              : 'Clear the filter to see all receipts.'}
          </p>
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((r) => {
            const isOpen = expanded === r.receipt_id;
            const decision = r.payload.aegisDecision;
            return (
              <div key={r.receipt_id} className="border border-[#1F2442] rounded-xl bg-[#080A16] overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : r.receipt_id)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-[#0E1120] transition cursor-pointer text-left"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-[#6A7097] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#6A7097] shrink-0" />}

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 inline-flex items-center gap-1 ${
                      r.verified
                        ? 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]'
                        : 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]'
                    }`}
                  >
                    {r.verified ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                    {r.verified ? 'SIGNATURE VERIFIED' : 'SIGNATURE FAILED'}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white font-bold truncate">{r.receipt_id}</div>
                    <div className="text-[10px] text-[#6A7097] truncate">task {r.task_id}</div>
                  </div>

                  {/* A valid signature proves the record is authentic, not that the task succeeded — the outcome says that. */}
                  <ReceiptOutcomeBadge outcome={r.payload.outcome} />
                  {r.artifactRetrieval?.status === 'QUARANTINED' && <RetrievalBadge retrieval={r.artifactRetrieval} />}

                  {decision && (
                    <span className={`text-[10px] font-bold shrink-0 hidden sm:inline ${decision === 'VERIFIED' ? 'text-[#00D26A]' : 'text-[#E8A845]'}`}>
                      AEGIS: {decision}
                    </span>
                  )}
                  <span className="text-[10px] text-[#6A7097] shrink-0 hidden md:inline">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-[#1F2442] p-4 space-y-3 bg-[#05060C]">
                    {r.payloadError && (
                      <div className="text-[11px] text-[#FF6B6B] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> {r.payloadError}
                      </div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
                      <Field label="Workspace" icon={Box} value={r.payload.workspaceId} />
                      <Field label="Task" icon={Box} value={r.task_id} />
                      <Field label="Review ID" icon={FileCheck} value={r.review_id} />
                      <Field label="Assigned Agent" icon={Cpu} value={r.payload.assignedAgent} />
                      <Field label="Model / Tools Used" icon={Cpu} value={r.payload.modelUsed} />
                      <Field label="Provider" icon={Cpu} value={r.payload.provider} />
                      <Field label="Aegis Decision" icon={ShieldCheck} value={r.payload.aegisDecision} />
                      <Field label="Aegis Method" icon={ShieldCheck} value={r.payload.aegisMethod} />
                      <Field label="Artifact ID" icon={Box} value={r.payload.artifactId} />
                      <Field label="Outcome" icon={FileCheck} value={r.payload.outcome || 'NOT STATED (integrity-only receipt)'} />
                      <Field label="Created" icon={FileCheck} value={new Date(r.created_at).toISOString()} />
                    </div>

                    <div className="space-y-1 pt-2 border-t border-[#141628] text-[11px]">
                      <div className="text-[10px] text-[#6A7097] uppercase tracking-wider">Verification scope</div>
                      <div className="text-white">{r.payload.verificationScope ? String(r.payload.verificationScope) : UNKNOWN}</div>
                      <div className="pt-1 flex items-center gap-2">
                        <span className="text-[10px] text-[#6A7097] uppercase tracking-wider">Artifact memory</span>
                        <RetrievalBadge retrieval={r.artifactRetrieval} />
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-[#141628]">
                      <Mono label="Artifact Hash" icon={Hash} value={r.payload.artifactHash} />
                      <Mono label={`Signature (${r.algorithm || 'UNKNOWN'})`} icon={Key} value={r.signature} />
                      <Mono label="Signing Public Key" icon={Key} value={r.public_key} />
                    </div>

                    <p className="text-[10px] text-[#6A7097] pt-1">
                      Verification is re-run server-side on every load against the stored public key — this is not a cached flag.
                    </p>
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

const Field: React.FC<{ label: string; icon: React.ComponentType<{ className?: string }>; value?: unknown }> = ({ label, icon: Icon, value }) => (
  <div className="flex items-start gap-2 min-w-0">
    <Icon className="w-3 h-3 text-[#4C5274] mt-0.5 shrink-0" />
    <span className="text-[#6A7097] shrink-0">{label}:</span>
    <span className="text-white truncate">{value ? String(value) : UNKNOWN}</span>
  </div>
);

const Mono: React.FC<{ label: string; icon: React.ComponentType<{ className?: string }>; value?: unknown }> = ({ label, icon: Icon, value }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-1.5 text-[10px] text-[#6A7097] uppercase tracking-wider">
      <Icon className="w-3 h-3" /> {label}
    </div>
    <div className="text-[10px] text-[#8C8AFF] break-all mt-0.5">{value ? String(value) : 'UNKNOWN'}</div>
  </div>
);

export default CanonicalReceiptsView;
