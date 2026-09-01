import React, { useState } from 'react';
import { 
  Terminal, X, CheckCircle2, AlertTriangle, ShieldCheck, 
  Cpu, Clock, Layers, FileText, ArrowRight, Activity, 
  Database, Zap, DollarSign, Key, ExternalLink, Bot
} from 'lucide-react';
import { SynthOSRun } from '../types';

interface RunDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  run: SynthOSRun | null;
}

export const RunDetailModal: React.FC<RunDetailModalProps> = ({ isOpen, onClose, run }) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'graph' | 'artifacts' | 'verification' | 'cost'>('timeline');

  if (!isOpen || !run) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div 
        className="w-full max-w-4xl bg-[#0B0D1B] border border-[#272B48] rounded-2xl shadow-2xl h-[90vh] flex flex-col justify-between font-mono overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-[#0F1226] border-b border-[#1D2139] flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#615EFF]/20 text-[#8C8AFF] border border-[#615EFF]/40 font-mono">
                CANONICAL RUN OBJECT #{run.id.slice(0, 8)}
              </span>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded ${
                run.status === 'COMPLETE' ? 'bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/40' :
                run.status === 'RUNNING' ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40 animate-pulse' :
                'bg-[#FF5E8E]/20 text-[#FF5E8E] border border-[#FF5E8E]/40'
              }`}>
                {run.status}
              </span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight font-['Space_Grotesk']">
              {run.objective}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="text-[#8E94B8]">Workspace: <span className="text-white font-bold">{run.workspace}</span></div>
              <div className="text-[#8E94B8]">Started: <span className="text-white">{run.startTime}</span></div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-xl bg-[#14182E] text-[#8E94B8] hover:text-white hover:bg-[#1E2342] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Selected Agents & Models Bar */}
        <div className="px-5 py-3 bg-[#070811] border-b border-[#1A1E36] grid grid-cols-1 md:grid-cols-3 gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#EC4899]" />
            <span className="text-[#8E94B8]">Agents:</span>
            <span className="text-white font-semibold truncate">{run.selectedAgents.join(', ') || 'Hermes Orchestrator'}</span>
          </div>

          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#00D26A]" />
            <span className="text-[#8E94B8]">Models:</span>
            <span className="text-white font-semibold truncate">{run.selectedModels.join(', ') || 'Gemini 2.5 / DeepSeek R1'}</span>
          </div>

          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[#F59E0B]" />
            <span className="text-[#8E94B8]">Est. Cost:</span>
            <span className="text-[#00D26A] font-bold">${run.costTokens.costUSD.toFixed(4)} USD</span>
          </div>
        </div>

        {/* Modal Tabs */}
        <div className="flex border-b border-[#1A1E36] bg-[#0B0D1B] text-xs shrink-0">
          {[
            { id: 'timeline', label: 'EXECUTION TIMELINE' },
            { id: 'graph', label: 'GRAPH / PLAN' },
            { id: 'artifacts', label: 'ARTIFACTS' },
            { id: 'verification', label: 'GUARDIAN & AEGIS' },
            { id: 'cost', label: 'COST & TELEMETRY' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-5 py-3 font-bold border-b-2 transition cursor-pointer ${
                activeTab === tab.id
                  ? 'border-[#615EFF] text-white bg-[#12152E]'
                  : 'border-transparent text-[#8E94B8] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">
                Canonical Execution Timeline ({run.stages.length} Stages)
              </div>

              <div className="space-y-3 relative before:absolute before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-[#1A1E36]">
                {run.stages.map((stage, idx) => (
                  <div key={idx} className="flex items-start gap-4 relative z-10">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${
                      stage.status === 'PASS' ? 'bg-[#00D26A]/20 border-[#00D26A] text-[#00D26A]' :
                      stage.status === 'RUNNING' ? 'bg-[#38BDF8]/20 border-[#38BDF8] text-[#38BDF8] animate-pulse' :
                      stage.status === 'SIMULATED' ? 'bg-[#F59E0B]/20 border-[#F59E0B] text-[#F59E0B]' :
                      'bg-[#14182E] border-[#272B48] text-[#8E94B8]'
                    }`}>
                      {idx + 1}
                    </div>

                    <div className="flex-1 bg-[#0F1226] border border-[#1A1E36] p-3.5 rounded-xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{stage.name}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          stage.status === 'PASS' ? 'bg-[#00D26A]/20 text-[#00D26A]' :
                          stage.status === 'RUNNING' ? 'bg-[#38BDF8]/20 text-[#38BDF8]' :
                          stage.status === 'SIMULATED' ? 'bg-[#F59E0B]/20 text-[#F59E0B]' :
                          'bg-[#8E94B8]/20 text-[#8E94B8]'
                        }`}>
                          {stage.status}
                        </span>
                      </div>
                      <p className="text-xs text-[#A3A8CC] font-sans">{stage.detail || 'Stage executed successfully with full telemetry capture.'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'graph' && (
            <div className="space-y-4">
              <div className="bg-[#0F1226] border border-[#1A1E36] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Compiled Graph DAG: {run.graphName || 'Default Hermes Workflow'}</span>
                  <span className="text-xs text-[#38BDF8]">ID: {run.graphId || 'dag-hermes-01'}</span>
                </div>
                <div className="p-4 bg-[#070811] rounded-lg border border-[#151728] text-xs font-mono text-[#00D26A] space-y-1">
                  <div>[TRIGGER] Natural Language Input → [SCOUT] Web Scraper</div>
                  <div>[SCOUT] Web Scraper → [DEV] Synthesizer</div>
                  <div>[DEV] Synthesizer → [AEGIS] Verification Receipt</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'artifacts' && (
            <div className="space-y-3">
              <div className="text-xs font-bold text-[#8E94B8] uppercase tracking-wider">
                Generated Artifacts ({run.artifacts.length})
              </div>
              {run.artifacts.map((art, idx) => (
                <div key={idx} className="bg-[#0F1226] border border-[#1A1E36] p-4 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-[#EC4899]" />
                    <div>
                      <div className="text-xs font-bold text-white">{art.name}</div>
                      <div className="text-[10px] text-[#8E94B8]">{art.type}</div>
                    </div>
                  </div>
                  <span className="text-xs text-[#00D26A] font-bold">SAVED TO VAULT</span>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'verification' && (
            <div className="space-y-4">
              <div className="bg-[#0F1226] border border-[#00D26A]/40 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-[#00D26A] font-bold text-xs">
                  <ShieldCheck className="w-4 h-4" />
                  <span>GUARDIAN POLICY: {run.guardianResult.status}</span>
                </div>
                <p className="text-xs text-[#C5C9E0] font-sans">Policy: {run.guardianResult.policy}</p>
                <div className="text-xs text-[#8E94B8]">
                  Checks passed: {run.guardianResult.checks.join(', ')}
                </div>
              </div>

              <div className="bg-[#0F1226] border border-[#38BDF8]/40 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#38BDF8] font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>AEGIS AUDIT RECEIPT</span>
                  </div>
                  <span className="text-[10px] text-[#8E94B8]">{run.receipt.timestamp}</span>
                </div>
                <p className="text-xs font-mono text-white break-all bg-[#070811] p-3 rounded-lg border border-[#151728]">
                  Hash: {run.aegisResult.hash}<br/>
                  Receipt ID: {run.receipt.receiptId}<br/>
                  Signature: {run.receipt.signature}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'cost' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36] space-y-1">
                <span className="text-[10px] text-[#8E94B8]">TOTAL COST</span>
                <div className="text-xl font-bold text-[#00D26A]">${run.costTokens.costUSD.toFixed(4)} USD</div>
              </div>

              <div className="bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36] space-y-1">
                <span className="text-[10px] text-[#8E94B8]">PROMPT TOKENS</span>
                <div className="text-xl font-bold text-white">{run.costTokens.promptTokens.toLocaleString()}</div>
              </div>

              <div className="bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36] space-y-1">
                <span className="text-[10px] text-[#8E94B8]">COMPLETION TOKENS</span>
                <div className="text-xl font-bold text-white">{run.costTokens.completionTokens.toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#0F1226] border-t border-[#1D2139] flex justify-between items-center shrink-0">
          <span className="text-xs text-[#8E94B8]">SYNTHOS CANONICAL RUN ENGINE</span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#615EFF] text-white text-xs font-bold hover:bg-[#504ACC] transition cursor-pointer"
          >
            Close Run Details
          </button>
        </div>
      </div>
    </div>
  );
};
