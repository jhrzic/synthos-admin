import React, { useCallback, useEffect, useState } from 'react';
import { Download, Link2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Stamp } from 'lucide-react';

// ---------------------------------------------------------------------------
// AUTHORITY RECORD — who authorized what the agents did, and what came of it.
//
// Reads GET /api/authority/summary (lib/authority-ledger.ts summarizeAuthority),
// which re-audits the hash chain on every load. Nothing here is a stored flag:
// "Intact" means the chain and every receipt/result digest were just re-checked.
// The export is verified offline with tools/verify-authority-record.mjs.
// ---------------------------------------------------------------------------

interface Summary {
  actions: number;
  withApproval: number;
  selfApproved: number;
  noApprovalOnRecord: number;
  outcomes: Record<string, number>;
  lastCheckpoint: { seq: number; signedAt: string } | null;
  headSeq: number;
  integrity: { ok: boolean; entries: number; problems: string[] };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export const AuthorityRecordPanel: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/authority/summary?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setS(data.summary);
    } catch (e: any) {
      setError(e?.message || 'Could not load the authority record.');
      setS(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkpoint = async () => {
    setSigning(true);
    setNote(null);
    try {
      const res = await fetch('/api/authority/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json().catch(() => null);
      setNote(res.ok && data?.success ? `Signed checkpoint at entry ${data.checkpoint.seq}.` : data?.error || `HTTP ${res.status}`);
      void load();
    } finally {
      setSigning(false);
    }
  };

  const outcomes = s ? Object.entries(s.outcomes).sort((a, b) => b[1] - a[1]) : [];
  const unpinned = s && s.lastCheckpoint ? s.headSeq - s.lastCheckpoint.seq : s?.headSeq ?? 0;

  return (
    <section className="bg-[#0B0D1B] border border-[#1F2442] rounded-2xl p-6 space-y-4" aria-label="Authority record">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#38BDF8]/15 border border-[#38BDF8]/40 flex items-center justify-center text-[#38BDF8]">
            <Link2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white font-['Space_Grotesk']">Authority record</h2>
            <p className="text-xs text-[#8E94B8] font-sans">Every action, who approved it, and what came of it — chained so nothing can be removed or edited unnoticed.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/authority/record?workspaceId=${encodeURIComponent(workspaceId)}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#05060C] border border-[#1F2442] text-xs text-[#C9CDE8] hover:text-white"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </a>
          <button
            onClick={checkpoint}
            disabled={signing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#05060C] border border-[#1F2442] text-xs text-[#C9CDE8] hover:text-white disabled:opacity-50 cursor-pointer"
          >
            {signing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stamp className="w-3.5 h-3.5" />} Sign checkpoint
          </button>
          <button onClick={() => void load()} disabled={loading} className="p-2 rounded-lg bg-[#05060C] border border-[#1F2442] text-[#8E94B8] hover:text-white disabled:opacity-50 cursor-pointer" title="Re-check">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-[#FF6B6B] font-sans">{error}</p>}

      {s && (
        <>
          <div className={`flex items-start gap-2 p-3 rounded-xl border text-xs font-sans ${s.integrity.ok ? 'border-[#00D26A]/40 bg-[#00D26A]/10 text-[#9FF0C6]' : 'border-[#FF6B6B]/50 bg-[#FF6B6B]/10 text-[#FFB3B3]'}`}>
            {s.integrity.ok ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
            <div>
              <strong>{s.integrity.ok ? 'Intact' : 'Problems found'}</strong> — {s.integrity.entries} entries re-checked just now.
              {!s.integrity.ok && (
                <ul className="list-disc pl-4 mt-1">
                  {s.integrity.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Actions on record', value: String(s.actions) },
              { label: 'With human approval', value: `${s.withApproval} · ${pct(s.withApproval, s.actions)}` },
              { label: 'Self-approved', value: String(s.selfApproved) },
              { label: 'No approval on record', value: String(s.noApprovalOnRecord) },
            ].map((c) => (
              <div key={c.label} className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
                <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">{c.label}</span>
                <span className="text-xl font-extrabold text-white mt-0.5 block">{c.value}</span>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-3 text-xs font-sans">
            <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
              <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block mb-1">Results recorded</span>
              {outcomes.length === 0 ? (
                <span className="text-[#8E94B8]">None yet. Results (visit booked, sale closed, reply received) are attached to actions as they happen.</span>
              ) : (
                <ul className="space-y-0.5">
                  {outcomes.map(([k, n]) => (
                    <li key={k} className="flex justify-between text-[#C9CDE8]"><span>{k.replace(/_/g, ' ')}</span><span className="font-mono text-white">{n}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
              <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block mb-1">Last signed checkpoint</span>
              {s.lastCheckpoint ? (
                <span className="text-[#C9CDE8]">
                  Entry {s.lastCheckpoint.seq} · {new Date(s.lastCheckpoint.signedAt).toLocaleString()}
                  {unpinned > 0 ? ` · ${unpinned} newer entr${unpinned === 1 ? 'y' : 'ies'} not yet pinned` : ' · up to date'}
                </span>
              ) : (
                <span className="text-[#8E94B8]">None yet. Checkpoints are signed daily; give them to the customer to pin the record.</span>
              )}
            </div>
          </div>
          {note && <p className="text-xs text-[#8E94B8] font-sans">{note}</p>}
          <p className="text-[11px] text-[#6A7097] font-sans">
            Verify an export without trusting this server: <code className="text-[#C9CDE8]">node tools/verify-authority-record.mjs record.json --key synthos-public.pem</code>
          </p>
        </>
      )}
    </section>
  );
};
