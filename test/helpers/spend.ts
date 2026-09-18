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
import { saveSpendPolicy, DEFAULT_SPEND_POLICY, PAID_PROVIDERS } from '../../lib/spend/policy';
import { applyPriceRecords, type PricingSourceId } from '../../lib/pricing/catalog';
import type { PriceRecord } from '../../lib/pricing/parse';

/**
 * Seed the pricing catalog through the SAME write path a real refresh uses,
 * with obviously-fixture prices. The source is marked refreshed now, so the
 * prices are current. Never real provider numbers.
 */
export function seedFixturePrices(entries: Array<{ provider: PriceRecord['provider']; modelId: string; input?: number; output?: number; cachedInput?: number | null; unit?: 'tokens' | 'chars'; longContext?: PriceRecord['longContext'] }>): void {
  const bySource = new Map<PricingSourceId, PriceRecord[]>();
  for (const e of entries) {
    const source: PricingSourceId = e.provider === 'gemini' ? 'gemini' : e.provider === 'antigravity' ? 'antigravity' : 'openai';
    const rec: PriceRecord = {
      provider: e.provider, modelId: e.modelId, unit: e.unit ?? (e.provider === 'openai_tts' ? 'chars' : 'tokens'), currency: 'USD',
      windows: [{ from: null, until: null, rates: { input: e.input ?? 1, output: e.output ?? 2, cachedInput: e.cachedInput ?? null } }],
      longContext: e.longContext ?? null, derivedFrom: e.provider === 'antigravity' ? 'gemini:fixture' : null,
      sourceUrl: 'test-fixture', notes: ['TEST FIXTURE — not a provider price'],
    };
    bySource.set(source, [...(bySource.get(source) || []), rec]);
  }
  for (const [source, records] of bySource) applyPriceRecords(source, 'test-fixture', records, `fixture-${Date.now()}`, 'TEST', 'fixture');
}

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
  seedFixturePrices([
    ...models.map(([provider, model]) => ({ provider: provider as PriceRecord['provider'], modelId: model })),
    // Antigravity needs a price too (no ceiling-only fallback any more).
    { provider: 'antigravity' as const, modelId: 'antigravity-preview-05-2026' },
  ]);
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
