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
import { ensureRegistry, isRegistryGoverned, registerModelViaAdmin, qualifyModel, enableModel } from '../../lib/registry';
import { getProviderBody } from '../../lib/registry/store';

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
  // Registry-governed providers are priced ONLY from the model registry, and a
  // model must be qualified and enabled there before it can run. Register each
  // fixture model through the same Admin path an operator uses, in this test's
  // own database, with the fixture price — then qualify and enable it.
  for (const e of entries) registerFixtureModel(e.provider, e.modelId, { input: e.input ?? 1, output: e.output ?? 2, cachedInput: e.cachedInput ?? null }, e.longContext ?? null, e.unit ?? 'tokens');
}

export function registerFixtureModel(provider: string, modelId: string, rates: { input: number; output: number; cachedInput: number | null }, longContext: PriceRecord['longContext'] = null, unit: 'tokens' | 'chars' = 'tokens'): void {
  ensureRegistry();
  if (!isRegistryGoverned(provider)) return;
  const now = new Date();
  const tiers = longContext && longContext.thresholdTokens
    ? longContext.windows.slice(0, 1).map((w) => ({ thresholdTokens: longContext.thresholdTokens!, rates: { input: w.rates.input, output: w.rates.output, cachedInput: w.rates.cachedInput ?? null } }))
    : [];
  const body = getProviderBody(provider)!;
  const r = registerModelViaAdmin(provider, {
    modelId, aliases: [], displayName: `${modelId} (test fixture)`, lifecycle: 'ACTIVE',
    releaseDate: null, deprecationDate: null, shutdownDate: null,
    limits: { contextTokens: null, outputTokens: null }, modalities: { input: ['text'], output: ['text'] },
    capabilities: [
      { id: 'text.input', supported: true, source: 'test fixture', verification: 'ADMIN_ASSERTED', effectiveDate: null },
      { id: 'text.output', supported: true, source: 'test fixture', verification: 'ADMIN_ASSERTED', effectiveDate: null },
    ],
    supportedParameters: [], outputContracts: ['NARRATIVE', 'LITERAL', 'JSON_OBJECT'],
    pricing: [{
      currency: 'USD', unit, rates, reasoningTokens: 'BILLED_AS_OUTPUT', tiers, toolCharges: [], modalityCharges: [],
      effectiveFrom: new Date(now.getTime() - 86_400_000).toISOString(), effectiveUntil: null, source: 'test-fixture',
      verifiedAt: now.toISOString(), staleAfter: new Date(now.getTime() + 30 * 86_400_000).toISOString(), approval: 'APPROVED',
    }],
    adapterCompatibility: { protocol: body.protocol, minAdapterVersion: '1.0.0' }, restrictions: { regions: [], compliance: [] },
  }, 'test-fixture');
  if (!r.ok) throw new Error(`fixture registration failed: ${(r as any).errors?.join('; ')}`);
  const q = qualifyModel(provider, modelId, 'test-fixture');
  if (!q.ok) throw new Error(`fixture qualification failed: ${q.error}`);
  const en = enableModel(provider, modelId, 'test-fixture');
  if (!en.ok) throw new Error(`fixture enable failed: ${en.error}`);
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
