import React from 'react';
import { ExecutionReceipt } from '../types';
import { FileCheck, Shield, Award, CheckCircle2, AlertTriangle, Key, Clock, ExternalLink } from 'lucide-react';

interface ReceiptsViewProps {
  receipts: ExecutionReceipt[];
}

export const ReceiptsView: React.FC<ReceiptsViewProps> = ({ receipts }) => {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2D3352] pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#00D26A]/15 border border-[#00D26A]/30 text-[#00D26A]">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Deterministic Execution Receipts
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#615EFF]/15 text-[#8C8AFF] border border-[#615EFF]/30 font-mono">
                  PROVENANCE PROOFS
                </span>
              </h1>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                Cryptographically signed receipts proving Guardian authority, Aegis quality scoring, latency metrics, and vault artifact lineage.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-[#0F111E] border border-[#2D3352] text-xs font-mono text-[#8E94B8]">
            Total Signed Receipts: <span className="text-white font-bold">{receipts.length}</span>
          </div>
        </div>
      </div>

      {/* Receipts Grid */}
      {receipts.length === 0 ? (
        <div className="bg-[#0F111E] border border-[#2D3352] rounded-2xl p-12 text-center text-[#8E94B8]">
          <FileCheck className="w-10 h-10 mx-auto mb-3 opacity-30 text-[#00D26A]" />
          <h3 className="text-sm font-semibold text-white">No Receipts Generated Yet</h3>
          <p className="text-xs text-[#8E94B8] max-w-md mx-auto mt-1">
            Execute a task from the Kanban Board or Master Operations command center to trigger the Guardian policy engine, Aegis verification, and automatic receipt signing.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {receipts.map((rcpt) => (
            <div key={rcpt.id} className="bg-[#0F111E] border border-[#2D3352] rounded-2xl p-5 shadow-lg space-y-4 hover:border-[#615EFF]/50 transition">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-xs font-mono font-bold text-white tracking-tight">{rcpt.id}</span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  rcpt.isSimulated ? 'bg-[#EAB308]/15 text-[#EAB308] border border-[#EAB308]/30' : 'bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30'
                }`}>
                  {rcpt.isSimulated ? 'SIMULATED RECEIPT' : 'VERIFIED PROOF'}
                </span>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-white">{rcpt.taskTitle}</h4>
                <div className="flex items-center gap-2 text-xs text-[#8E94B8] mt-1 font-mono">
                  <span>Role: <strong className="text-[#8C8AFF]">{rcpt.assignedRole}</strong></span>
                  <span>•</span>
                  <span>Model: <strong className="text-white">{rcpt.modelUsed}</strong></span>
                </div>
              </div>

              <div className="bg-[#141628] rounded-xl p-3 border border-[#2D3352]/70 space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-[#8E94B8]">Guardian Policy Gate:</span>
                  <span className="text-[#00D26A] font-bold">PASSED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8E94B8]">Aegis Quality Score:</span>
                  <span className="text-[#8C8AFF] font-bold">{(rcpt.aegisVerificationScore * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8E94B8]">Execution Latency:</span>
                  <span className="text-white">{rcpt.latencyMs}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8E94B8]">Cryptographic Hash:</span>
                  <span className="text-[#EAB308] truncate max-w-[180px]">{rcpt.signatureHash}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#6B7280]">
                <span>Issued: {new Date(rcpt.issuedAt).toLocaleTimeString()}</span>
                {rcpt.vaultArtifactId && (
                  <span className="text-[#8C8AFF] flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> Artifact: {rcpt.vaultArtifactId}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
