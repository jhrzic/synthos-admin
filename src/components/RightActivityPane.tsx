import React, { useState, useEffect } from 'react';
import { 
  Activity, X, ChevronRight, Terminal, ShieldCheck, 
  CheckCircle2, AlertTriangle, FileText, Cpu, Clock, 
  ExternalLink, Layers, ArrowUpRight
} from 'lucide-react';
import { SynthOSRun } from '../types';

interface RightActivityPaneProps {
  isOpen: boolean;
  onClose?: () => void;
  onToggle?: () => void;
  activeRun?: SynthOSRun | null;
  onOpenRunDetail?: (run: SynthOSRun) => void;
  onOpenRunModal?: (run: SynthOSRun) => void;
  onSelectTab?: (tab: any) => void;
}

export const RightActivityPane: React.FC<RightActivityPaneProps> = ({
  isOpen,
  onClose,
  activeRun,
  onOpenRunDetail
}) => {
  const [activeTab, setActiveTab] = useState<'events' | 'tools' | 'artifacts' | 'verification'>('events');

  if (!isOpen) return null;

  const mockEvents = activeRun?.activityHistory || [
    { timestamp: '11:28:42', event: 'Hermes Command Dispatched', actor: 'Orchestrator', level: 'info' as const },
    { timestamp: '11:28:44', event: 'Guardian Safety Gate Verified', actor: 'Guardian', level: 'success' as const },
    { timestamp: '11:28:45', event: 'Mounted Tool [mcp_search_web]', actor: 'Scout Agent', level: 'info' as const },
    { timestamp: '11:28:48', event: 'Graph DAG Compiled (3 Nodes)', actor: 'Dev Agent', level: 'success' as const },
    { timestamp: '11:28:50', event: 'Aegis Audit Hash Generated', actor: 'Aegis', level: 'success' as const }
  ];

  return (
    <aside className="fixed md:sticky md:top-[73px] right-0 h-screen md:h-[calc(100vh-73px)] z-30 w-80 bg-[#070811] border-l border-[#151728] flex flex-col justify-between font-mono shrink-0 shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Pane Header */}
      <div className="p-3.5 border-b border-[#151728] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#00D26A] animate-pulse" />
          <span className="text-xs font-bold text-white font-['Space_Grotesk']">GLANCE ACTIVITY</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#00D26A]/20 text-[#00D26A] font-bold">LIVE</span>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-lg bg-[#121424] text-[#8E94B8] hover:text-white transition cursor-pointer"
          title="Collapse Activity Pane"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Internal Tabs */}
      <div className="grid grid-cols-4 p-1 bg-[#0B0D1B] border-b border-[#151728] text-[10px]">
        {(['events', 'tools', 'artifacts', 'verification'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-1.5 font-bold uppercase rounded-md transition text-center cursor-pointer ${
              activeTab === tab
                ? 'bg-[#615EFF] text-white shadow-xs'
                : 'text-[#8E94B8] hover:text-white'
            }`}
          >
            {tab.slice(0, 5)}
          </button>
        ))}
      </div>

      {/* Main Stream Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs scrollbar-thin">
        {/* Active Run Banner if present */}
        {activeRun && (
          <div className="bg-[#0F1226] border border-[#615EFF]/40 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#8C8AFF] font-bold">ACTIVE RUN</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[#00D26A]/20 text-[#00D26A] font-bold">
                {activeRun.status}
              </span>
            </div>
            <p className="text-xs text-white font-semibold line-clamp-2">{activeRun.objective}</p>
            {onOpenRunDetail && (
              <button
                onClick={() => onOpenRunDetail(activeRun)}
                className="w-full py-1.5 bg-[#615EFF]/20 border border-[#615EFF]/50 hover:bg-[#615EFF] text-white text-[10px] font-bold rounded-lg transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>INSPECT RUN DETAILS</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {activeTab === 'events' && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold text-[#8E94B8] uppercase tracking-wider px-1">
              Real-Time Execution Log
            </div>
            {mockEvents.map((evt, idx) => (
              <div 
                key={idx} 
                className="bg-[#0B0D1B] border border-[#1A1E36] rounded-xl p-2.5 space-y-1 hover:border-[#272B48] transition"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[#38BDF8] font-bold">{evt.actor}</span>
                  <span className="text-[#8E94B8]">{evt.timestamp}</span>
                </div>
                <p className="text-xs text-[#C5C9E0] font-sans">{evt.event}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold text-[#8E94B8] uppercase tracking-wider px-1">
              Mounted Tools & MCP
            </div>
            {['mcp_search_web', 'hermes_board_db', 'obsidian_vault_sync', 'guardian_aegis_gate'].map((tool, idx) => (
              <div key={idx} className="bg-[#0B0D1B] border border-[#1A1E36] p-2.5 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span className="text-white font-semibold">{tool}</span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#00D26A]/20 text-[#00D26A] font-bold">READY</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold text-[#8E94B8] uppercase tracking-wider px-1">
              Generated Artifacts
            </div>
            {[
              { name: '[[Startup-Theses/Agentic-Browser-OS]]', type: 'Obsidian Note' },
              { name: 'Graph-DAG-Compilation-Receipt.json', type: 'JSON Proof' },
              { name: 'Aegis-Audit-Ledger.hash', type: 'SHA-256 Hash' }
            ].map((art, idx) => (
              <div key={idx} className="bg-[#0B0D1B] border border-[#1A1E36] p-2.5 rounded-xl space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-[#EC4899]" />
                  <span className="text-xs text-white font-semibold truncate">{art.name}</span>
                </div>
                <span className="text-[9px] text-[#8E94B8]">{art.type}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'verification' && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold text-[#8E94B8] uppercase tracking-wider px-1">
              Security & Verification
            </div>
            <div className="bg-[#0B0D1B] border border-[#00D26A]/30 p-3 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-[#00D26A] font-bold text-xs">
                <ShieldCheck className="w-4 h-4" />
                <span>GUARDIAN POLICY: PASS</span>
              </div>
              <p className="text-[11px] text-[#8E94B8] font-sans">
                No unauthorized tool calls detected. Autonomous execution budget within limits ($0.04 USD).
              </p>
            </div>

            <div className="bg-[#0B0D1B] border border-[#38BDF8]/30 p-3 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-[#38BDF8] font-bold text-xs">
                <CheckCircle2 className="w-4 h-4" />
                <span>AEGIS RECEIPT: VERIFIED</span>
              </div>
              <p className="text-[10px] text-[#8E94B8] font-mono break-all">
                0x8f23...a4e1 (Cryptographically Signed)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[#151728] text-[10px] text-[#8E94B8] flex items-center justify-between shrink-0">
        <span>GLANCE TELEMETRY</span>
        <span className="text-[#00D26A]">STREAM ACTIVE</span>
      </div>
    </aside>
  );
};
