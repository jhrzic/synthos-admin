import React from 'react';

// ---------------------------------------------------------------------------
// VERIFICATION OUTCOME — the one set of labels every existing view uses to
// show what scoped Aegis actually decided (lib/fabric/scoped-verification.ts).
//
// Rules this module encodes, so no view re-derives them:
//   * INCOMPLETE and VERIFICATION_FAILED are their own states, never folded
//     into FAILED and never shown as success.
//   * A receipt's outcome is read from its signed payload. A receipt signed
//     before outcomes existed says so ("NOT STATED") — it is never assumed
//     to be COMPLETED.
//   * Integrity-only success is not semantic success: each scope is shown
//     separately, and NOT_REPORTED is shown as unverified, not as PASS.
//   * Missing data renders as UNKNOWN in the inert (steel) colour.
// ---------------------------------------------------------------------------

export type Tone = 'success' | 'warning' | 'error' | 'gate' | 'inert';

export const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-[#00D26A]/10 border-[#00D26A]/40 text-[#00D26A]',
  warning: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  error: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]',
  gate: 'bg-[#9B8CFF]/10 border-[#9B8CFF]/40 text-[#9B8CFF]',
  inert: 'bg-[#7E8BB5]/10 border-[#7E8BB5]/30 text-[#7E8BB5]',
};

/** Task / node status → human label + tone. Unknown statuses pass through as inert. */
export function taskStatusLabel(status: string | null | undefined): { label: string; tone: Tone; description: string } {
  switch (status) {
    case 'DONE': return { label: 'DONE', tone: 'success', description: 'Verified in every required scope and receipted.' };
    case 'INCOMPLETE': return { label: 'INCOMPLETE', tone: 'warning', description: 'The output did not finish (e.g. it hit the output cap). Evidence kept; excluded from memory.' };
    case 'VERIFICATION_FAILED': return { label: 'VERIFICATION FAILED', tone: 'error', description: 'The output finished but did not follow its output contract. Evidence kept; excluded from memory.' };
    case 'FAILED': return { label: 'FAILED', tone: 'error', description: 'The task failed.' };
    case 'AWAITING_VERIFICATION': return { label: 'AWAITING VERIFICATION', tone: 'gate', description: 'Held at the verification gate.' };
    case 'AWAITING_RECEIPT': return { label: 'AWAITING RECEIPT', tone: 'gate', description: 'Verified; receipt not yet signed.' };
    // CONTINUITY — paused is not failed. Each names what it waits for.
    case 'PAUSED_AWAITING_BUDGET': return { label: 'PAUSED — AWAITING BUDGET', tone: 'warning', description: 'Not failed. Paid execution is off or a budget is spent; it resumes automatically when budget allows.' };
    case 'PAUSED_AWAITING_CAPACITY': return { label: 'PAUSED — AWAITING CAPACITY', tone: 'warning', description: 'Not failed. The qualified routes are at their rate, quota or concurrency limit; it resumes automatically when one has room.' };
    case 'PAUSED_AWAITING_QUALIFIED_CAPACITY': return { label: 'PAUSED — NO QUALIFIED ROUTE', tone: 'warning', description: 'Not failed. No route is qualified for this task class (or the pinned one cannot run). Nothing weaker was substituted.' };
    case 'PAUSED_AWAITING_APPROVAL': return { label: 'PAUSED — AWAITING APPROVAL', tone: 'warning', description: 'Not failed. A human approval is required before it continues.' };
    case 'RECONCILING_UNKNOWN_EXECUTION': return { label: 'RECONCILING — OUTCOME UNKNOWN', tone: 'warning', description: 'A provider call may have been processed. It is never retried automatically; an operator must reconcile it.' };
    case 'AWAITING_CONTINUATION': return { label: 'AWAITING CONTINUATION', tone: 'inert', description: 'A segment finished; the next segment continues from a signed checkpoint.' };
    case 'ROUTE_SWITCHING': return { label: 'SWITCHING ROUTE', tone: 'inert', description: 'Moving to a qualified same-or-stronger route after a checkpoint.' };
    case 'RESUMING': return { label: 'RESUMING', tone: 'inert', description: 'A qualified route is available again; resuming through the normal path.' };
    case 'CHECKPOINTING': return { label: 'CHECKPOINTING', tone: 'inert', description: 'Writing a signed checkpoint.' };
    case null: case undefined: case '': return { label: 'UNKNOWN', tone: 'inert', description: 'No status recorded.' };
    default: return { label: status.replace(/_/g, ' '), tone: 'inert', description: status };
  }
}

/** Non-terminal continuity states: paused or reconciling, never failed. */
export const CONTINUITY_PAUSE_STATES = ['PAUSED_AWAITING_BUDGET', 'PAUSED_AWAITING_CAPACITY', 'PAUSED_AWAITING_QUALIFIED_CAPACITY', 'PAUSED_AWAITING_APPROVAL', 'RECONCILING_UNKNOWN_EXECUTION'] as const;
export const isPausedStatus = (s: string | null | undefined): boolean => !!s && (CONTINUITY_PAUSE_STATES as readonly string[]).includes(s);

/** A signed receipt payload's outcome. Absent = a receipt from before outcomes were signed. */
export function receiptOutcomeLabel(outcome: unknown): { label: string; tone: Tone; description: string } {
  switch (outcome) {
    case 'COMPLETED': return { label: 'COMPLETED', tone: 'success', description: 'The receipt attests a completed, verified task.' };
    case 'INCOMPLETE': return { label: 'INCOMPLETE', tone: 'warning', description: 'Audit receipt: the artifact is intact but the task did not finish. Not a completion.' };
    case 'VERIFICATION_FAILED': return { label: 'VERIFICATION FAILED', tone: 'error', description: 'Audit receipt: the artifact is intact but broke its output contract. Not a completion.' };
    default: return { label: 'OUTCOME NOT STATED', tone: 'inert', description: 'Signed before receipts stated an outcome; it attests integrity only.' };
  }
}

/** One verification scope result → label + tone. NOT_REPORTED is unverified, never PASS. */
export function scopeLabel(result: unknown): { label: string; tone: Tone } {
  switch (result) {
    case 'PASS': return { label: 'PASS', tone: 'success' };
    case 'FAIL': return { label: 'FAIL', tone: 'error' };
    case 'NOT_REPORTED': return { label: 'NOT REPORTED', tone: 'warning' };
    case 'NOT_APPLICABLE': return { label: 'N/A', tone: 'inert' };
    case 'AUDITED_ON_AGGREGATE': return { label: 'ON AGGREGATE', tone: 'inert' };
    default: return { label: 'UNKNOWN', tone: 'inert' };
  }
}

/** An output contract → short label. Missing = the documented NARRATIVE default is NOT assumed for display. */
export function contractLabel(contract: any): string {
  if (!contract || typeof contract !== 'object' || !contract.mode) return 'UNKNOWN';
  if (contract.mode === 'LITERAL') return 'LITERAL';
  if (contract.mode === 'JSON_OBJECT') return Array.isArray(contract.requiredKeys) && contract.requiredKeys.length ? `JSON_OBJECT (${contract.requiredKeys.join(', ')})` : 'JSON_OBJECT';
  return String(contract.mode);
}

export const Badge: React.FC<{ tone: Tone; title?: string; children: React.ReactNode }> = ({ tone, title, children }) => (
  <span title={title} className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 inline-flex items-center gap-1 font-mono ${TONE_CLASS[tone]}`}>
    {children}
  </span>
);

export const TaskStatusBadge: React.FC<{ status: string | null | undefined }> = ({ status }) => {
  const s = taskStatusLabel(status);
  return <Badge tone={s.tone} title={s.description}>{s.label}</Badge>;
};

export const ReceiptOutcomeBadge: React.FC<{ outcome: unknown }> = ({ outcome }) => {
  const o = receiptOutcomeLabel(outcome);
  return <Badge tone={o.tone} title={o.description}>OUTCOME: {o.label}</Badge>;
};

/** The three scopes, each separately. `scopes` is VerificationScopes-shaped. */
export const ScopeChips: React.FC<{ scopes: any }> = ({ scopes }) => {
  if (!scopes || typeof scopes !== 'object') return <Badge tone="inert">SCOPES: UNKNOWN</Badge>;
  const rows: Array<[string, unknown]> = [['INTEGRITY', scopes.integrity], ['COMPLETION', scopes.completion], ['INSTRUCTION', scopes.instructionCompliance]];
  return (
    <span className="inline-flex flex-wrap gap-1">
      {rows.map(([name, v]) => {
        const s = scopeLabel(v);
        return <Badge key={name} tone={s.tone}>{name}: {s.label}</Badge>;
      })}
    </span>
  );
};

/** Artifact retrieval state. `retrieval` is { status, reason, at } from the API. */
export const RetrievalBadge: React.FC<{ retrieval: { status?: string; reason?: string | null; at?: string | null } | null | undefined }> = ({ retrieval }) => {
  if (!retrieval || !retrieval.status) return <Badge tone="inert">MEMORY: UNKNOWN</Badge>;
  if (retrieval.status === 'QUARANTINED') {
    return <Badge tone="error" title={retrieval.reason || undefined}>QUARANTINED{retrieval.reason ? ` — ${retrieval.reason}` : ''}</Badge>;
  }
  if (retrieval.status === 'ACTIVE') return <Badge tone="success">MEMORY: ACTIVE</Badge>;
  return <Badge tone="inert">MEMORY: {retrieval.status}</Badge>;
};

/**
 * The full outcome for one task: status, the three scopes, the contract, the
 * receipt outcome and memory state. Used inside existing task / artifact
 * detail panels — it is a section, not a screen.
 */
export const VerificationOutcomePanel: React.FC<{
  outcome: {
    taskStatus?: string | null;
    scopes?: any;
    scopeStatement?: string | null;
    outputContract?: any;
    receiptOutcome?: unknown;
    receiptId?: string | null;
    retrieval?: { status?: string; reason?: string | null; at?: string | null } | null;
  } | null | undefined;
}> = ({ outcome }) => {
  if (!outcome) return null;
  return (
    <div className="space-y-2 p-3 bg-[#05060C] border border-[#1C2038] rounded-xl text-[11px]" data-testid="verification-outcome">
      <div className="flex flex-wrap items-center gap-1.5">
        <TaskStatusBadge status={outcome.taskStatus} />
        <Badge tone="inert">CONTRACT: {contractLabel(outcome.outputContract)}</Badge>
        {outcome.receiptId ? <ReceiptOutcomeBadge outcome={outcome.receiptOutcome} /> : <Badge tone="inert">NO RECEIPT</Badge>}
        <RetrievalBadge retrieval={outcome.retrieval} />
      </div>
      <ScopeChips scopes={outcome.scopes} />
      <div className="text-[#8E94B8]">{outcome.scopeStatement || 'Verification scope: UNKNOWN'}</div>
    </div>
  );
};
