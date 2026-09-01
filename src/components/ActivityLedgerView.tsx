import React from 'react';
import { ActivityLedgerEvent } from '../types';
import { Shield, Clock, CheckCircle2, AlertCircle, FileText, Lock, ArrowRight, Cpu, Layers } from 'lucide-react';

interface ActivityLedgerViewProps {
  events: ActivityLedgerEvent[];
  onSelectEvent?: (event: ActivityLedgerEvent) => void;
}

export const ActivityLedgerView: React.FC<ActivityLedgerViewProps> = ({ events }) => {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2D3352] pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                SynthOS Activity & Governance Ledger
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30 font-mono">
                  IMMUTABLE STREAM
                </span>
              </h1>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                Cryptographically audited event ledger recording task dispatches, Guardian policy gates, and Aegis verification receipts.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-[#0F111E] border border-[#2D3352] text-xs font-mono text-[#8E94B8] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00D26A] animate-pulse" />
            <span>{events.length} Events Recorded</span>
          </div>
        </div>
      </div>

      {/* Events Table / Feed */}
      <div className="bg-[#0F111E] border border-[#2D3352] rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 bg-[#141628] border-b border-[#2D3352] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#8E94B8] uppercase tracking-wider">Event Sequence</span>
          <span className="text-[11px] font-mono text-[#8E94B8]">Tenant: ws-synthos-primary</span>
        </div>

        <div className="divide-y divide-[#2D3352]/60">
          {events.length === 0 ? (
            <div className="p-12 text-center text-[#8E94B8]">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40 text-[#615EFF]" />
              <p className="text-sm">No activity events recorded yet in this workspace.</p>
            </div>
          ) : (
            events.map((evt) => {
              const isPassed = evt.eventType.includes('PASSED') || evt.eventType.includes('SUCCESS') || evt.eventType.includes('VERIFIED') || evt.eventType.includes('ISSUED');
              const isRejected = evt.eventType.includes('REJECTED') || evt.eventType.includes('FAILED');

              return (
                <div key={evt.id} className="p-4 hover:bg-[#141628]/60 transition flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className={`mt-0.5 p-1.5 rounded-lg ${
                      isPassed ? 'bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30' :
                      isRejected ? 'bg-[#FF4D4D]/15 text-[#FF4D4D] border border-[#FF4D4D]/30' :
                      'bg-[#615EFF]/15 text-[#8C8AFF] border border-[#615EFF]/30'
                    }`}>
                      {isPassed ? <CheckCircle2 className="w-4 h-4" /> : isRejected ? <AlertCircle className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-white tracking-wide">
                          {evt.eventType}
                        </span>
                        {evt.isSimulated && (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#EAB308]/15 text-[#EAB308] border border-[#EAB308]/30">
                            SIMULATED
                          </span>
                        )}
                        <span className="text-[11px] text-[#6B7280]">
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-[#9AA2C6] mt-1 leading-relaxed">
                        {evt.summary}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1C1F37] border border-[#2D3352] text-[#8C8AFF]">
                      Role: {evt.actorRole}
                    </span>
                    {evt.actorModel && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1C1F37] border border-[#2D3352] text-[#8E94B8]">
                        {evt.actorModel}
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
