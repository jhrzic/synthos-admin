import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Clock, CheckCircle2, AlertCircle, Layers, RefreshCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// ACTIVITY LEDGER — the server's append-only activity record for the active
// workspace (GET /api/activity-ledger; read-only, no provider call). It used
// to render a browser-local list seeded with an invented first event; that
// data source is gone, the surface is kept. A load failure is shown as an
// error, never as an empty ledger.
// ---------------------------------------------------------------------------

export interface LedgerRow {
  eventId: string;
  taskId: string;
  taskTitle: string | null;
  eventType: string;
  actor: string;
  model: string | null;
  payload: any;
  createdAt: string;
}

/** A one-line, truthful summary of an event's recorded payload. */
export function summarizeLedgerEvent(e: LedgerRow): string {
  const p = e.payload || {};
  if (e.eventType.startsWith('EXECUTION_RECONCILI')) {
    const ev = p.evidence || {};
    return `Operator finding ${p.finding} → ${p.resultingStatus}${p.correctsEventId ? ` (corrects ${p.correctsEventId})` : ''}. Evidence: ${ev.evidenceSource ?? 'UNKNOWN'}, window ${ev.windowStart ?? '?'} → ${ev.windowEnd ?? '?'}, ${ev.provider ?? '?'}/${ev.model ?? '?'}: ${ev.dashboardFinding ?? ''}`;
  }
  if (typeof p.reason === 'string') return p.reason;
  if (typeof p.title === 'string') return p.title;
  if (typeof p.error === 'string') return p.error;
  const keys = Object.keys(p).slice(0, 4);
  return keys.length ? keys.map((k) => `${k}: ${typeof p[k] === 'object' ? JSON.stringify(p[k]).slice(0, 60) : String(p[k]).slice(0, 60)}`).join(' · ') : '—';
}

export const ActivityLedgerView: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const [events, setEvents] = useState<LedgerRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setError(null);
    fetch(`/api/activity-ledger?workspaceId=${encodeURIComponent(workspaceId)}&limit=300`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.success) { setError(j?.error || `HTTP ${r.status}`); setEvents(null); return; }
        setEvents(j.events); setTotal(j.total);
      })
      .catch((e) => { setError(String(e?.message || e)); setEvents(null); });
  }, [workspaceId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="activity-ledger">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2D3352] pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                SynthOS Activity &amp; Governance Ledger
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#7E8BB5]/15 text-[#C9CCE6] border border-[#7E8BB5]/30 font-mono">
                  SERVER RECORD · APPEND-ONLY
                </span>
              </h1>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                Every recorded task event in this workspace: dispatches, provider outcomes, Aegis reviews, receipts, pauses and operator reconciliations. Signed evidence lives on the receipts themselves.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-[#0F111E] border border-[#2D3352] text-xs font-mono text-[#8E94B8] flex items-center gap-2" data-testid="activity-ledger-count">
            <span>{events ? `${events.length} shown of ${total ?? '?'} events` : error ? 'UNKNOWN' : 'Loading…'}</span>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg border border-[#2D3352] text-[#8E94B8]" aria-label="Refresh ledger"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Events Table / Feed */}
      <div className="bg-[#0F111E] border border-[#2D3352] rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 bg-[#141628] border-b border-[#2D3352] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#8E94B8] uppercase tracking-wider">Event Sequence</span>
          <span className="text-[11px] font-mono text-[#8E94B8]">Workspace: {workspaceId}</span>
        </div>

        <div className="divide-y divide-[#2D3352]/60">
          {error ? (
            <div className="p-12 text-center text-[#FF6B6B]" data-testid="activity-ledger-error">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
              <p className="text-sm">The ledger could not be loaded: {error}. This is not an empty ledger.</p>
            </div>
          ) : !events ? (
            <div className="p-12 text-center text-[#8E94B8]"><p className="text-sm">Loading the activity record…</p></div>
          ) : events.length === 0 ? (
            <div className="p-12 text-center text-[#8E94B8]" data-testid="activity-ledger-empty">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40 text-[#615EFF]" />
              <p className="text-sm">No activity events recorded yet in this workspace.</p>
            </div>
          ) : (
            events.map((evt) => {
              const isPassed = evt.eventType.includes('PASSED') || evt.eventType.includes('SUCCESS') || evt.eventType.includes('VERIFIED') || evt.eventType.includes('ISSUED');
              const isRejected = evt.eventType.includes('REJECTED') || evt.eventType.includes('FAILED');
              // INCOMPLETE is its own state: unfinished output, evidence kept — not a pass, not an error.
              // Paused / reconciling / switching are waiting states — attention, not failure.
              const isIncomplete = evt.eventType.includes('INCOMPLETE') || evt.eventType.includes('PAUSED') || evt.eventType.includes('RECONCILIATION') || evt.eventType.includes('ROUTE_SWITCH') || evt.eventType.includes('CHECKPOINT');

              return (
                <div key={evt.eventId} data-testid="activity-ledger-event" className="p-4 hover:bg-[#141628]/60 transition flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className={`mt-0.5 p-1.5 rounded-lg ${
                      isIncomplete ? 'bg-[#E8A845]/15 text-[#E8A845] border border-[#E8A845]/30' :
                      isPassed ? 'bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30' :
                      isRejected ? 'bg-[#FF4D4D]/15 text-[#FF4D4D] border border-[#FF4D4D]/30' :
                      'bg-[#615EFF]/15 text-[#8C8AFF] border border-[#615EFF]/30'
                    }`}>
                      {isIncomplete ? <AlertCircle className="w-4 h-4" /> : isPassed ? <CheckCircle2 className="w-4 h-4" /> : isRejected ? <AlertCircle className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-white tracking-wide">
                          {evt.eventType}
                        </span>
                        <span className="text-[11px] text-[#6B7280] font-mono">
                          {evt.createdAt}
                        </span>
                      </div>
                      <p className="text-xs text-[#9AA2C6] mt-1 leading-relaxed">
                        {summarizeLedgerEvent(evt)}
                      </p>
                      <p className="text-[10px] text-[#6B7280] mt-0.5 font-mono">task {evt.taskId}{evt.taskTitle ? ` — ${evt.taskTitle}` : ''}</p>
                      <button className="text-[10px] text-[#8C8AFF] mt-1" onClick={() => setOpen({ ...open, [evt.eventId]: !open[evt.eventId] })}>{open[evt.eventId] ? 'Hide' : 'Show'} recorded payload</button>
                      {open[evt.eventId] && <pre className="text-[10px] text-[#8E94B8] mt-1 whitespace-pre-wrap break-all max-w-3xl">{JSON.stringify(evt.payload, null, 2)}</pre>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1C1F37] border border-[#2D3352] text-[#8C8AFF]">
                      Actor: {evt.actor}
                    </span>
                    {evt.model && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1C1F37] border border-[#2D3352] text-[#8E94B8]">
                        {evt.model}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
