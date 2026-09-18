import React, { useCallback, useEffect, useState } from 'react';
import { Rocket, KeyRound, Power, ShieldCheck, Gauge, Activity, Loader2, AlertTriangle, Lock } from 'lucide-react';

// ---------------------------------------------------------------------------
// Master Admin → Antigravity & Autonomy.
//
// Seven separate facts, rendered separately on purpose — no single green/red
// badge. Every value comes from GET /api/master-admin/antigravity; every
// control is a platform_admin route that is audited server-side. Nothing here
// calls Antigravity. READY_FOR_LIVE_VERIFICATION is the most this screen can
// say until a real run has produced a receipt.
// ---------------------------------------------------------------------------

interface ControlStatus {
  implementation: string;
  agent: string;
  credential: {
    state: 'CONFIGURED' | 'NOT_CONFIGURED';
    source: 'antigravity_env' | 'antigravity_store' | 'gemini_credential' | 'none';
    dedicated: { state: string; storedRowPresent: boolean; overriddenByEnvironment: boolean; updatedAt: string | null };
    geminiFallbackAvailable: boolean;
  };
  enabled: { value: boolean; source: string; locked: boolean; updatedAt: string | null };
  approvalPolicy: { requiresHumanApproval: boolean; summary: string };
  autonomy: { level: string; levels: string[]; source: string; locked: boolean; updatedAt: string | null };
  lastLiveVerified: { executionId: string; at: string; receiptId: string } | null;
  execution: {
    inFlight: Array<{ status: string; count: number }>;
    pendingApprovals: number;
    last: { executionId: string; status: string; errorCode: string | null; createdAt: string; receiptId: string | null } | null;
  };
  readiness: 'NOT_READY' | 'READY_FOR_LIVE_VERIFICATION' | 'LIVE_VERIFIED';
  missing: string[];
}

const SOURCE_LABEL: Record<string, string> = {
  antigravity_env: 'dedicated key (deployment environment)',
  antigravity_store: 'dedicated key (encrypted store)',
  gemini_credential: 'Gemini credential (fallback — same Google key type)',
  none: 'none',
  environment: 'deployment environment (locked)',
  platform_setting: 'set in this Admin',
  default: 'default',
};

const AUTONOMY_HELP: Record<string, string> = {
  MANUAL: 'The orchestrator dispatches nothing unattended.',
  INTERNAL_AUTOMATION: 'Internal work runs unattended; external actions (including Antigravity) are never prepared.',
  APPROVAL_GATED_EXTERNAL: 'External actions are prepared unattended and stop at the approval queue. Nothing leaves SynthOS without a human.',
};

function Row({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#05060C] border border-[#1A1E36] rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[#8E94B8]">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      {children}
    </div>
  );
}

function Value({ tone, children }: { tone: 'good' | 'warn' | 'inert'; children: React.ReactNode }) {
  const cls = tone === 'good' ? 'text-[#5FE3A1]' : tone === 'warn' ? 'text-[#E8A845]' : 'text-[#7E8BB5]';
  return <span className={`font-mono text-xs font-bold ${cls}`}>{children}</span>;
}

export function AntigravityControlPanel() {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/master-admin/antigravity');
      if (res.status === 403) throw new Error('Platform administrator role required.');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to read Antigravity status.');
      setStatus(json.status);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to read Antigravity status.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (url: string, body: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (json?.status) setStatus(json.status);
      if (!res.ok || !json?.success) setError(String(json?.error || `Request failed (HTTP ${res.status}).`));
    } catch (e: any) {
      setError(e?.message || 'Request failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return (
      <div className="p-6 text-xs text-[#8E94B8] font-mono">
        {error ? <span className="text-[#FF6B6B]">{error}</span> : <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading Antigravity status…</span>}
      </div>
    );
  }

  const readinessTone = status.readiness === 'LIVE_VERIFIED' ? 'good' : status.readiness === 'READY_FOR_LIVE_VERIFICATION' ? 'warn' : 'inert';

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <div className="flex-1">{error}</div>
        </div>
      )}

      <Row icon={Rocket} label="Readiness">
        <Value tone={readinessTone}>{status.readiness.replace(/_/g, ' ')}</Value>
        <p className="text-[11px] text-[#6A7097]">
          {status.readiness === 'LIVE_VERIFIED'
            ? 'A real run completed, passed Aegis and produced a signed receipt.'
            : status.readiness === 'READY_FOR_LIVE_VERIFICATION'
              ? 'Configured and enabled. No live run has happened yet, so provider access is unproven. The first paid run needs your explicit approval.'
              : `Missing: ${status.missing.join(', ').toLowerCase() || 'nothing'}.`}
        </p>
      </Row>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Row icon={Activity} label="Implementation">
          <Value tone="good">{status.implementation}</Value>
          <p className="text-[11px] text-[#6A7097]">Canonical envelope executor. Agent: <span className="font-mono">{status.agent}</span></p>
        </Row>

        <Row icon={KeyRound} label="Credential">
          <Value tone={status.credential.state === 'CONFIGURED' ? 'good' : 'inert'}>{status.credential.state.replace(/_/g, ' ')}</Value>
          <p className="text-[11px] text-[#6A7097]">In use: {SOURCE_LABEL[status.credential.source] || status.credential.source}</p>
          {status.credential.source === 'gemini_credential' && (
            <p className="text-[11px] text-[#E8A845]">A Gemini key resolves, but that does not prove it can reach the managed-agent API. Only a live run proves that.</p>
          )}
          {status.credential.dedicated.overriddenByEnvironment && (
            <p className="text-[11px] text-[#E8A845]">A stored key exists, but ANTIGRAVITY_API_KEY in the deployment environment takes precedence.</p>
          )}
          <div className="flex gap-2 flex-wrap pt-1">
            <input
              type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={status.credential.dedicated.storedRowPresent ? 'Replace dedicated Antigravity key…' : 'Dedicated Antigravity key (optional)…'}
              className="flex-1 min-w-[180px] bg-[#090A16] border border-[#1E223D] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#4C5274] focus:outline-none focus:border-[#615EFF]"
            />
            <button
              disabled={!keyDraft.trim() || busy === 'key'}
              onClick={async () => { await post('/api/master-admin/antigravity/credential', { action: 'save', apiKey: keyDraft }, 'key'); setKeyDraft(''); }}
              className="text-[10px] font-mono font-bold px-2.5 py-1.5 rounded-md bg-[#615EFF] hover:bg-[#524EFA] disabled:opacity-40 text-white"
            >Save</button>
            {status.credential.dedicated.storedRowPresent && (
              <button
                disabled={busy === 'key'}
                onClick={() => post('/api/master-admin/antigravity/credential', { action: 'delete' }, 'key')}
                className="text-[10px] font-mono font-bold px-2.5 py-1.5 rounded-md border border-[#2A2F52] text-[#8E94B8] hover:text-white"
              >Remove</button>
            )}
          </div>
          <p className="text-[10px] text-[#585E82]">Stored encrypted on the server and never shown again. Without a dedicated key the Gemini credential (Providers &amp; Models) is used.</p>
        </Row>

        <Row icon={Power} label="Enabled">
          <Value tone={status.enabled.value ? 'good' : 'inert'}>{status.enabled.value ? 'YES' : 'NO'}</Value>
          <p className="text-[11px] text-[#6A7097]">Source: {SOURCE_LABEL[status.enabled.source] || status.enabled.source}</p>
          {status.enabled.locked ? (
            <p className="text-[11px] text-[#E8A845] flex items-center gap-1"><Lock className="w-3 h-3" /> Set by the deployment environment; cannot be changed here.</p>
          ) : (
            <button
              disabled={busy === 'enabled'}
              onClick={() => post('/api/master-admin/antigravity/enabled', { enabled: !status.enabled.value }, 'enabled')}
              className="text-[10px] font-mono font-bold px-2.5 py-1.5 rounded-md border border-[#2A2F52] text-white hover:border-[#615EFF]"
            >{status.enabled.value ? 'Disable Antigravity' : 'Enable Antigravity'}</button>
          )}
          <p className="text-[10px] text-[#585E82]">Takes effect on the next action. No restart. Enabling does not run anything: every run still needs its own approval.</p>
        </Row>

        <Row icon={ShieldCheck} label="Approval policy">
          <Value tone="good">HUMAN APPROVAL REQUIRED</Value>
          <p className="text-[11px] text-[#6A7097]">{status.approvalPolicy.summary}</p>
        </Row>

        <Row icon={Gauge} label="Autonomy level">
          <Value tone="inert">{status.autonomy.level.replace(/_/g, ' ')}</Value>
          <p className="text-[11px] text-[#6A7097]">Source: {SOURCE_LABEL[status.autonomy.source] || status.autonomy.source}</p>
          {status.autonomy.locked ? (
            <p className="text-[11px] text-[#E8A845] flex items-center gap-1"><Lock className="w-3 h-3" /> Set by the deployment environment; cannot be changed here.</p>
          ) : (
            <div className="space-y-1.5 pt-1">
              {status.autonomy.levels.map((lvl) => (
                <label key={lvl} className="flex items-start gap-2 text-[11px] text-[#C9CCE3] cursor-pointer">
                  <input
                    type="radio" name="autonomy-level" checked={status.autonomy.level === lvl} disabled={busy === 'autonomy'}
                    onChange={() => post('/api/master-admin/autonomy', { level: lvl }, 'autonomy')}
                    className="mt-0.5"
                  />
                  <span><span className="font-mono">{lvl.replace(/_/g, ' ')}</span> — <span className="text-[#6A7097]">{AUTONOMY_HELP[lvl]}</span></span>
                </label>
              ))}
            </div>
          )}
        </Row>

        <Row icon={Activity} label="Last live verified">
          {status.lastLiveVerified ? (
            <>
              <Value tone="good">{status.lastLiveVerified.at}</Value>
              <p className="text-[11px] text-[#6A7097] font-mono">receipt {status.lastLiveVerified.receiptId}</p>
            </>
          ) : (
            <Value tone="inert">NEVER — no live run has produced a receipt</Value>
          )}
        </Row>

        <Row icon={Activity} label="Current execution state">
          <p className="text-[11px] text-[#C9CCE3] font-mono">
            In flight: {status.execution.inFlight.length ? status.execution.inFlight.map((f) => `${f.status} ×${f.count}`).join(', ') : 'none'}
          </p>
          <p className="text-[11px] text-[#C9CCE3] font-mono">Waiting for approval: {status.execution.pendingApprovals}</p>
          <p className="text-[11px] text-[#6A7097] font-mono">
            Last run: {status.execution.last ? `${status.execution.last.status}${status.execution.last.errorCode ? ` (${status.execution.last.errorCode})` : ''} at ${status.execution.last.createdAt}` : 'none'}
          </p>
        </Row>
      </div>
    </div>
  );
}

export default AntigravityControlPanel;
