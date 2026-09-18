// ---------------------------------------------------------------------------
// ANTIGRAVITY CONTROL SURFACE — what a platform_admin sees and changes.
//
// Every field is a SEPARATE fact, derived from its own source, and none is
// collapsed into a single green/red badge:
//
//   implementation  a property of this build (the envelope executor exists)
//   credential      does a key resolve, and from where — never the value
//   enabled         the kill switch, and whether the environment locks it
//   approvalPolicy  what a run requires before anything is sent
//   autonomy        whether the task loop may prepare external work unattended
//   lastLiveVerified the most recent REAL run that ended VERIFIED with a
//                   receipt — from the ledger, never inferred
//   execution       what is in flight or waiting right now
//
// readiness is computed from those, and READY_FOR_LIVE_VERIFICATION is the
// most it can say before a live run has happened. LIVE_VERIFIED requires a
// real receipt-bearing execution in the ledger.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';
import { resolveAntigravityApiKey, describeAntigravityEnablement, resolveAntigravityAgent } from './antigravity-client';
import { getRuntimeCredentialStatus, getModelCredentialStatus } from './model-credentials';
import { describeAutonomyLevel, AUTONOMY_LEVELS } from './autonomy';

export type AntigravityReadiness = 'NOT_READY' | 'READY_FOR_LIVE_VERIFICATION' | 'LIVE_VERIFIED';

export function getAntigravityControlStatus() {
  const db = getDatabase();
  const key = resolveAntigravityApiKey();
  const dedicated = getRuntimeCredentialStatus('antigravity');
  const gemini = getModelCredentialStatus('gemini');
  const enablement = describeAntigravityEnablement();
  const autonomy = describeAutonomyLevel();

  const lastVerified = db.prepare(`
    SELECT id, completed_at, result_ingested_at, result_receipt_id FROM external_executions
     WHERE runtime = 'antigravity' AND result_receipt_id IS NOT NULL
     ORDER BY result_ingested_at DESC LIMIT 1
  `).get() as any;

  const inFlight = (db.prepare(`
    SELECT status, COUNT(*) AS n FROM external_executions
     WHERE runtime = 'antigravity' AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
     GROUP BY status
  `).all() as any[]).map((r) => ({ status: String(r.status), count: Number(r.n) }));

  const last = db.prepare(`
    SELECT id, status, error_code, created_at, result_receipt_id FROM external_executions
     WHERE runtime = 'antigravity' ORDER BY created_at DESC LIMIT 1
  `).get() as any;

  const pendingApprovals = Number((db.prepare(`
    SELECT COUNT(*) AS n FROM approvals WHERE capability = 'runtime.antigravity' AND status = 'PENDING'
  `).get() as any)?.n ?? 0);

  const configured = Boolean(key.apiKey);
  const missing: string[] = [];
  if (!configured) missing.push('CREDENTIAL');
  if (!enablement.enabled) missing.push('ENABLED');

  const readiness: AntigravityReadiness = lastVerified
    ? 'LIVE_VERIFIED'
    : missing.length === 0 ? 'READY_FOR_LIVE_VERIFICATION' : 'NOT_READY';

  return {
    implementation: 'IMPLEMENTED' as const,
    agent: resolveAntigravityAgent(),
    credential: {
      state: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      // Which key a run would use. The Gemini fallback proves a key RESOLVES,
      // not that it has managed-agent access; only a live run proves that.
      source: key.source,
      dedicated: { state: dedicated.state, storedRowPresent: dedicated.storedRowPresent, overriddenByEnvironment: dedicated.overriddenByEnvironment, updatedAt: dedicated.updatedAt },
      geminiFallbackAvailable: gemini.apiKeyPresent,
    },
    enabled: { value: enablement.enabled, source: enablement.source, locked: enablement.locked, updatedAt: enablement.updatedAt, updatedByUserId: enablement.updatedByUserId },
    approvalPolicy: {
      requiresHumanApproval: true,
      summary: 'Every run needs a single-use human approval bound to the workspace, task, agent, exact instruction, allowed paths and tools. Guardian is checked first and overrides approval.',
    },
    autonomy: { level: autonomy.level, levels: AUTONOMY_LEVELS, source: autonomy.source, locked: autonomy.locked, updatedAt: autonomy.updatedAt, updatedByUserId: autonomy.updatedByUserId },
    lastLiveVerified: lastVerified
      ? { executionId: lastVerified.id, at: lastVerified.result_ingested_at || lastVerified.completed_at, receiptId: lastVerified.result_receipt_id }
      : null,
    execution: {
      inFlight,
      pendingApprovals,
      last: last ? { executionId: last.id, status: last.status, errorCode: last.error_code, createdAt: last.created_at, receiptId: last.result_receipt_id } : null,
    },
    readiness,
    missing,
  };
}
