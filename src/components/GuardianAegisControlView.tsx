import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  Key, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  Sliders, 
  UserCheck, 
  Scale, 
  FileCheck,
  RefreshCw,
  Info
} from 'lucide-react';
import { synthosControl } from '../services/synthosControlService';
import { WorkspaceTenant } from '../types';

export const GuardianAegisControlView: React.FC = () => {
  const [workspace, setWorkspace] = useState<WorkspaceTenant>(synthosControl.getWorkspace());
  const [tokenBudget, setTokenBudget] = useState<number>(8192);
  const [strictAegis, setStrictAegis] = useState<boolean>(true);
  const [sandboxEnabled, setSandboxEnabled] = useState<boolean>(true);
  const [requireHumanGate, setRequireHumanGate] = useState<boolean>(false);
  const [savedNotification, setSavedNotification] = useState<string | null>(null);

  const handleSavePolicies = () => {
    synthosControl.logEvent({
      eventType: 'GUARDIAN_CHECK_PASSED',
      actorRole: 'orchestrator',
      summary: `Updated Guardian & Aegis Policy Profiles (Token Cap: ${tokenBudget}, Sandbox: ${sandboxEnabled}, Human Gate: ${requireHumanGate})`,
      payload: { tokenBudget, strictAegis, sandboxEnabled, requireHumanGate },
      isSimulated: false
    });
    setSavedNotification('Governance Policies successfully committed to Activity Ledger & Guardian Enforcer.');
    setTimeout(() => setSavedNotification(null), 4000);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2D3352] pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Guardian Policy Engine & Aegis Verification Sentinel
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30 font-mono">
                  ACTIVE ENFORCEMENT
                </span>
              </h1>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                Phase 2 Governance: Pre-execution capability evaluation, role-based boundary containment, and post-execution automated verification.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleSavePolicies}
          className="px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-bold font-mono transition flex items-center gap-2 shadow-lg shadow-[#615EFF]/25"
        >
          <Sliders className="w-4 h-4" />
          <span>Save & Enforce Policies</span>
        </button>
      </div>

      {savedNotification && (
        <div className="p-3.5 rounded-xl bg-[#00D26A]/15 border border-[#00D26A]/40 text-[#00D26A] text-xs font-mono flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedNotification}</span>
        </div>
      )}

      {/* Grid Policies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Guardian Policy Engine Card */}
        <div className="bg-[#0F111E] border border-[#2D3352] rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-[#2D3352]/70 pb-4">
            <div className="flex items-center gap-2.5">
              <Lock className="w-5 h-5 text-[#8C8AFF]" />
              <h3 className="text-sm font-bold text-white tracking-wide">Guardian Pre-Execution Policy</h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#615EFF]/15 text-[#8C8AFF] border border-[#615EFF]/30">
              GATE 01
            </span>
          </div>

          <p className="text-xs text-[#8E94B8] leading-relaxed">
            Guardian intercepts all task dispatches before execution, verifying workspace tenancy, agent role permissions, and tool safety rules.
          </p>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#141628] border border-[#2D3352]/60">
              <div>
                <span className="text-xs font-semibold text-white block">Docker Sandbox Containerization</span>
                <span className="text-[11px] text-[#8E94B8]">Isolate Dev code execution in ephemeral Docker containers</span>
              </div>
              <input
                type="checkbox"
                checked={sandboxEnabled}
                onChange={(e) => setSandboxEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#615EFF] rounded cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-[#141628] border border-[#2D3352]/60">
              <div>
                <span className="text-xs font-semibold text-white block">Human Approval Gate for P0 / Critical</span>
                <span className="text-[11px] text-[#8E94B8]">Require explicit Operator sign-off before dispatching P0 directives</span>
              </div>
              <input
                type="checkbox"
                checked={requireHumanGate}
                onChange={(e) => setRequireHumanGate(e.target.checked)}
                className="w-4 h-4 accent-[#615EFF] rounded cursor-pointer"
              />
            </div>

            <div className="p-3 rounded-xl bg-[#141628] border border-[#2D3352]/60 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-white">Max Token Budget Per Execution</span>
                <span className="text-xs font-mono font-bold text-[#8C8AFF]">{tokenBudget.toLocaleString()} tokens</span>
              </div>
              <input
                type="range"
                min={1024}
                max={32768}
                step={1024}
                value={tokenBudget}
                onChange={(e) => setTokenBudget(Number(e.target.value))}
                className="w-full accent-[#615EFF] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-[#6A719C]">
                <span>1,024 (Lean)</span>
                <span>8,192 (Standard)</span>
                <span>32,768 (Deep Synthesis)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Aegis Verification Sentinel Card */}
        <div className="bg-[#0F111E] border border-[#2D3352] rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-[#2D3352]/70 pb-4">
            <div className="flex items-center gap-2.5">
              <FileCheck className="w-5 h-5 text-[#00D26A]" />
              <h3 className="text-sm font-bold text-white tracking-wide">Aegis Post-Execution Quality Gate</h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
              GATE 02
            </span>
          </div>

          <p className="text-xs text-[#8E94B8] leading-relaxed">
            Aegis performs automated post-execution verification: schema compliance, artifact completeness, source/evidence validation, and deterministic acceptance criteria prior to task completion and receipt issuance.
          </p>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#141628] border border-[#2D3352]/60">
              <div>
                <span className="text-xs font-semibold text-white block">Strict Markdown & Wikilink Verification</span>
                <span className="text-[11px] text-[#8E94B8]">Enforce Obsidian [[wikilink]] references, structural headers, and schema formats</span>
              </div>
              <input
                type="checkbox"
                checked={strictAegis}
                onChange={(e) => setStrictAegis(e.target.checked)}
                className="w-4 h-4 accent-[#00D26A] rounded cursor-pointer"
              />
            </div>

            <div className="p-4 rounded-xl bg-[#141628] border border-[#2D3352]/60 space-y-2">
              <span className="text-xs font-semibold text-white block">Active Aegis Audit Rules</span>
              <div className="space-y-1.5 text-xs text-[#8E94B8] font-mono">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Rule 01: Schema compliance & structural header checks</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Rule 02: Artifact completeness & token volume thresholds</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Rule 03: Workspace tenancy boundary & data isolation</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Rule 04: Deterministic acceptance criteria & SHA-256 state receipts</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#141628] border border-[#2D3352]/60 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white block">Current Workspace Context</span>
                <span className="text-[11px] font-mono text-[#8C8AFF]">{workspace.name} ({workspace.tier.toUpperCase()})</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
                ROLE: {workspace.currentUserRole.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
