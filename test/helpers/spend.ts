// ---------------------------------------------------------------------------
// Explicit, per-file opt-in for tests that EXPECT a paid call to succeed
// against a local test double.
//
// Production defaults are conservative (paid execution OFF, no prices), so a
// test that exercises a successful model call must say so, in its own isolated
// database, with named models and finite budgets. There is no global switch
// and no environment backdoor: the spend guard runs exactly as in production.
// Real provider hosts stay unreachable under test regardless (network guard).
// ---------------------------------------------------------------------------
import { saveSpendPolicy, savePricingTable, DEFAULT_SPEND_POLICY, PAID_PROVIDERS } from '../../lib/spend/policy';

export function allowPaidExecutionForTest(models: Array<[string, string]>, overrides: Record<string, unknown> = {}) {
  const providers: any = {};
  for (const p of PAID_PROVIDERS) providers[p] = { enabled: true, dailyUsd: 1000, monthlyUsd: 10000, maxConcurrent: 50 };
  const policy = saveSpendPolicy({
    ...DEFAULT_SPEND_POLICY,
    paidExecutionEnabled: true,
    global: { dailyUsd: 1000, monthlyUsd: 10000, maxConcurrent: 50 },
    providers,
    workspaceDefault: { dailyUsd: 1000, maxConcurrent: 50 },
    task: { maxEstimatedUsd: 100, maxInputChars: 2_000_000, maxOutputTokens: 8192, maxTier: 'PREMIUM' },
    antigravity: { perRunCeilingUsd: 5, maxTotalTokens: 200_000 },
    approvalThresholdUsd: 100,
    ...overrides,
  }, 'test');
  if (!policy.ok) throw new Error(`test spend policy invalid: ${policy.errors.join('; ')}`);
  const table: Record<string, unknown> = {};
  for (const [provider, model] of models) {
    table[`${provider}:${model}`] = { unit: provider === 'openai_tts' || provider === 'elevenlabs' || provider === 'fish_audio' ? 'chars' : 'tokens', inputPerMillion: 1, outputPerMillion: 2 };
  }
  const priced = savePricingTable(table, 'test');
  if (!priced.ok) throw new Error(`test pricing invalid: ${priced.errors.join('; ')}`);
}

import { requestApproval, decideApproval, consumeApproval } from '../../lib/approvals';

/**
 * A REAL consumed approval for runtime.antigravity, bound to `correlationId` —
 * what the execution envelope produces after a human approves. For tests that
 * drive the external-execution ledger directly. Goes through the real approval
 * lifecycle (request → decide → consume); nothing is forged.
 */
export function consumedAntigravityApproval(workspaceId: string, correlationId: string): string {
  const a = requestApproval({
    workspaceId, taskId: null, correlationId, capability: 'runtime.antigravity', action: 'execute',
    effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'test-requester', guardianDecision: 'SAFE',
    actionSummary: 'test run', inputDigest: `test-digest-${correlationId}`,
  });
  const d = decideApproval({ approvalId: a.approval_id, workspaceId, decidedByUserId: 'test-approver', decision: 'APPROVED' });
  if (!d.ok) throw new Error(d.reason);
  if (!consumeApproval(a.approval_id, null)) throw new Error('could not consume test approval');
  return a.approval_id;
}
