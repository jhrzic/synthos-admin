// ---------------------------------------------------------------------------
// SPEND GUARD — the one gate every paid provider call passes through.
//
// ORDER, all before any network call:
//   1. master switch (paid execution enabled)
//   2. provider kill switch
//   3. context and output ceilings (never silently truncated)
//   4. pricing known → maximum cost ESTIMATED (no model is called to do this)
//   5. cost tier permitted
//   6. per-task / per-run ceiling
//   7. expensive-call approval threshold
//   8. idempotency: a key that already dispatched cannot dispatch again, and an
//      ambiguous outcome (timeout after dispatch, unknown) requires an operator
//   9. concurrency: global, provider, workspace
//  10. budgets: global day/month, provider day/month, workspace day — counting
//      in-flight reservations, so concurrent calls cannot jointly overshoot
// Steps 8–10 and the reservation insert run synchronously with no await
// between them, so within the one worker process they are atomic.
//
// Refusal returns BLOCKED_BUDGET (reason code says which rule) and is recorded
// in the ledger. No network call happens.
//
// Then the call runs under a permit (lib/spend/network-guard.ts) that allows
// exactly one paid request, and the outcome is classified from what the
// network layer actually observed — not from what the adapter hoped:
//   no request sent            → PRE_DISPATCH_FAILURE (cost 0)
//   success                    → SUCCESS
//   timed out after sending    → TIMEOUT_AFTER_DISPATCH (never auto-retried)
//   connection refused         → KNOWN_FAILURE (nothing processed)
//   other network failure      → UNKNOWN (never auto-retried)
//   HTTP 4xx                   → PROVIDER_REJECTION
//   HTTP 5xx                   → UNKNOWN (may have been processed)
//   2xx but unusable           → KNOWN_FAILURE (may have been billed)
// ---------------------------------------------------------------------------

import { recordRuntimeEvent } from '../runtime-events';
import { getDatabase } from '../persistence';
import { runWithPermit, type SpendPermit } from './network-guard';
import { isRegistryGoverned, registryGate } from '../registry';
import { currentRouteContext } from '../registry/route-context';
import {
  getSpendPolicy, getModelPrice, costTierFor, tierRank, estimateTokensFromChars,
  type PaidProvider, type CostTier, type SpendPolicy, type ModelPrice,
} from './policy';
import {
  insertUsageRow, patchUsageRow, listUsageForKey, newUsageId, spentSince, inFlightCount, periodStarts,
  recordSpendAlert, AMBIGUOUS_STATUSES, type UsageStatus,
} from './ledger';

export interface PaidCallRequest {
  provider: PaidProvider;
  model: string;
  callSite: string;
  workspaceId?: string | null;
  taskId?: string | null;
  correlationId?: string | null;
  /** One logical execution. A key that already dispatched can never dispatch again. */
  idempotencyKey: string;
  /** Characters of input actually sent (prompt, context, instruction, text to speak). */
  inputChars: number;
  /** Output ceiling actually sent to the provider (tokens). Ignored for char-priced providers. */
  maxOutputTokens?: number;
  /** A consumed human approval, required above the expensive-call threshold. */
  approvalId?: string | null;
  /** Highest tier this call may use; defaults to the policy's task.maxTier. */
  maxTier?: CostTier;
  /**
   * Asynchronous runtimes (Antigravity): a successful submission leaves the row
   * DISPATCHED — the remote run is still spending — and it is settled later by
   * settleAsyncUsage(). The row keeps its concurrency slot until then.
   */
  asyncSettlement?: boolean;
}

export interface NormalizedUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
  providerRequestId?: string | null;
}

export interface PaidCallOutcome<T> {
  ok: boolean;
  value?: T;
  usage?: NormalizedUsage | null;
  /** When the adapter knows the failure was a timeout that the network layer could not see (e.g. body read). */
  failureHint?: 'TIMEOUT' | null;
  /** The provider's own report of how the response ended, e.g. "INCOMPLETE:incomplete:max_output_tokens". */
  termination?: string | null;
}

export type GuardResult<T> =
  | { permitted: true; usageId: string; status: UsageStatus; outcome: PaidCallOutcome<T>; estimatedCostUsd: number }
  | { permitted: false; usageId: string; status: 'BLOCKED'; code: string; reason: string; estimatedCostUsd: number | null };

export class SpendBlockedError extends Error {
  code: string;
  constructor(code: string, reason: string) {
    super(`BLOCKED_BUDGET (${code}): ${reason}`);
    this.name = 'SpendBlockedError';
    this.code = code;
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Provider overshoot allowance for managed-agent runs. Google documents
 * max_total_tokens as best-effort ("actual usage may slightly exceed it"), so
 * the reservation assumes up to 20% over.
 */
export const ANTIGRAVITY_OVERSHOOT_MARGIN = 1.2;
/** Below this many tokens an Antigravity run cannot do useful work; refused rather than sent. */
export const ANTIGRAVITY_MIN_TOKENS = 1_000;

/** The price snapshot a call is reserved with, stored on its usage row. */
export interface PriceSnapshot {
  versionKey: string;
  unit: 'tokens' | 'chars';
  input: number;
  output: number;
  cachedInput: number | null;
  long: { thresholdTokens: number | null; input: number; output: number; cachedInput: number | null } | null;
  derivedFrom: string | null;
}

export function snapshotOf(price: ModelPrice): PriceSnapshot {
  return {
    versionKey: price.versionKey, unit: price.unit,
    input: price.inputPerMillion, output: price.outputPerMillion, cachedInput: price.cachedInputPerMillion ?? null,
    long: price.long ? { thresholdTokens: price.long.thresholdTokens, input: price.long.inputPerMillion, output: price.long.outputPerMillion, cachedInput: price.long.cachedInputPerMillion ?? null } : null,
    derivedFrom: price.derivedFrom ?? null,
  };
}

/**
 * Maximum cost of this call, before dispatch, from the catalog price. null =
 * cannot be estimated. For Antigravity it also returns the token cap to send,
 * chosen so that even a 20% overshoot stays within the per-run ceiling.
 */
export function estimateMaxCostUsd(req: PaidCallRequest, price: ModelPrice | null, policy: SpendPolicy): { usd: number | null; inputTokens: number | null; maxTotalTokens?: number; code?: string } {
  if (!price) return { usd: null, inputTokens: null };
  if (req.provider === 'antigravity') {
    if (price.unit !== 'tokens') return { usd: null, inputTokens: null };
    const rates = [price.inputPerMillion, price.outputPerMillion, price.long?.inputPerMillion ?? 0, price.long?.outputPerMillion ?? 0];
    const maxRate = Math.max(...rates);
    if (!(maxRate > 0)) return { usd: null, inputTokens: null };
    const affordable = Math.floor((policy.antigravity.perRunCeilingUsd * 1e6) / (maxRate * ANTIGRAVITY_OVERSHOOT_MARGIN));
    const cap = Math.min(policy.antigravity.maxTotalTokens, affordable);
    if (cap < ANTIGRAVITY_MIN_TOKENS) return { usd: null, inputTokens: null, code: 'CEILING_TOO_LOW' };
    return { usd: round6((cap * maxRate * ANTIGRAVITY_OVERSHOOT_MARGIN) / 1e6), inputTokens: estimateTokensFromChars(req.inputChars), maxTotalTokens: cap };
  }
  if (price.unit === 'chars') return { usd: round6((req.inputChars * price.inputPerMillion) / 1e6), inputTokens: null };
  const inputTokens = estimateTokensFromChars(req.inputChars);
  const out = req.maxOutputTokens ?? policy.task.maxOutputTokens;
  // Long-context rates whenever the threshold is unknown or could be crossed.
  const useLong = !!price.long && (price.long.thresholdTokens === null || inputTokens > price.long.thresholdTokens);
  const inRate = useLong ? price.long!.inputPerMillion : price.inputPerMillion;
  const outRate = useLong ? price.long!.outputPerMillion : price.outputPerMillion;
  return { usd: round6((inputTokens * inRate + out * outRate) / 1e6), inputTokens };
}

/**
 * Actual cost from provider-reported tokens and the snapshot the call was
 * reserved with — never from today's price, so a later price change does not
 * rewrite history. null when it cannot be computed reliably.
 */
export function actualCostUsd(provider: string, snap: PriceSnapshot | null, u: NormalizedUsage | null | undefined): number | null {
  if (!snap || !u || snap.unit !== 'tokens') return null;
  const input = u.inputTokens; const output = u.outputTokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  let rates = { input: snap.input, output: snap.output, cachedInput: snap.cachedInput };
  if (snap.long) {
    if (snap.long.thresholdTokens === null) return null; // which rate applied is not knowable
    if (input > snap.long.thresholdTokens) rates = { input: snap.long.input, output: snap.long.output, cachedInput: snap.long.cachedInput };
  }
  const cached = typeof u.cachedTokens === 'number' ? u.cachedTokens : 0;
  if (cached > 0 && rates.cachedInput === null) return null; // would be a guess
  // Managed-agent runs also bill tool fees the usage block does not break out.
  if (provider === 'antigravity') return null;
  return round6(((input - cached) * rates.input + cached * (rates.cachedInput ?? rates.input) + output * rates.output) / 1e6);
}

let dryRunDepth = 0;

/** The routing decision this call runs under, for the ledger row. */
function routeEvidence(): Record<string, string | null> {
  const r = currentRouteContext();
  if (!r) return {};
  return {
    task_class: r.taskClass ?? null, canonical_version_id: r.canonicalVersionId ?? null, deployment_id: r.deploymentId ?? null,
    routing_decision_id: r.routingDecisionId ?? null, segment_id: r.segmentId ?? null,
  };
}

function block(req: PaidCallRequest, attempt: number, code: string, reason: string, extra: Record<string, unknown> = {}): { permitted: false; usageId: string; status: 'BLOCKED'; code: string; reason: string; estimatedCostUsd: number | null } {
  const usageId = newUsageId();
  if (dryRunDepth > 0) return { permitted: false, usageId, status: 'BLOCKED', code, reason, estimatedCostUsd: (extra.estimatedCostUsd as number) ?? null };
  try {
    insertUsageRow({
      usage_id: usageId, provider: req.provider, model: req.model, call_site: req.callSite,
      workspace_id: req.workspaceId ?? null, task_id: req.taskId ?? null, correlation_id: req.correlationId ?? null,
      idempotency_key: req.idempotencyKey, attempt, status: 'BLOCKED', reason_code: code, reason,
      input_chars: req.inputChars, max_output_tokens: req.maxOutputTokens ?? null, approval_id: req.approvalId ?? null,
      created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      estimated_cost_usd: (extra.estimatedCostUsd as number) ?? null, cost_tier: (extra.tier as string) ?? null,
      ...routeEvidence(),
    });
  } catch { /* the refusal stands even if it cannot be recorded */ }
  return { permitted: false, usageId, status: 'BLOCKED', code, reason, estimatedCostUsd: (extra.estimatedCostUsd as number) ?? null };
}

/** Pre-dispatch checks and reservation. Returns a refusal, or the reserved row id and estimate. */
export function authorizePaidCall(req: PaidCallRequest): { permitted: false; usageId: string; status: 'BLOCKED'; code: string; reason: string; estimatedCostUsd: number | null } | { permitted: true; usageId: string; estimatedCostUsd: number; tier: string; attempt: number; maxTotalTokens?: number } {
  const policy = getSpendPolicy();
  const prior = listUsageForKey(req.idempotencyKey);
  const attempt = prior.length ? Math.max(...prior.map((r) => r.attempt)) + 1 : 1;

  if (!req.idempotencyKey || !req.idempotencyKey.trim()) return block(req, attempt, 'NO_IDEMPOTENCY_KEY', 'A paid call must carry an idempotency key.');
  if (!policy.paidExecutionEnabled) return block(req, attempt, 'PAID_EXECUTION_DISABLED', 'Paid execution is switched off (Master Admin → Spend Control).');
  const provLimits = policy.providers[req.provider];
  if (!provLimits || !provLimits.enabled) return block(req, attempt, 'PROVIDER_DISABLED', `Paid calls to ${req.provider} are switched off.`);

  // --- MODEL REGISTRY ---------------------------------------------------------
  // A provider governed by the registry may only be called for a canonical,
  // qualified, enabled, priced, configured model this workspace permits.
  // Appearing in a manifest is not permission.
  if (isRegistryGoverned(req.provider)) {
    const gate = registryGate(req.provider, req.model, { workspaceId: req.workspaceId ?? null, callSite: req.callSite, route: currentRouteContext() ?? null });
    if (!gate.ok) return block(req, attempt, gate.code, gate.reason);
  }

  if (req.inputChars > policy.task.maxInputChars) {
    return block(req, attempt, 'CONTEXT_TOO_LARGE', `Input is ${req.inputChars} characters; the limit is ${policy.task.maxInputChars}. Nothing was truncated or sent.`);
  }
  if (req.provider !== 'antigravity' && typeof req.maxOutputTokens === 'number' && req.maxOutputTokens > policy.task.maxOutputTokens) {
    return block(req, attempt, 'OUTPUT_CEILING_EXCEEDED', `Requested ${req.maxOutputTokens} output tokens; the limit is ${policy.task.maxOutputTokens}.`);
  }

  const price = getModelPrice(req.provider, req.model);
  if (!price) {
    return block(req, attempt, 'PRICE_UNKNOWN', `The pricing catalog has no current price for ${req.provider}:${req.model}, so its cost cannot be bounded. PRICE UNKNOWN — EXECUTION BLOCKED.`);
  }
  if (price.staleAfter) {
    if (Date.now() > Date.parse(price.staleAfter)) {
      return block(req, attempt, 'PRICE_STALE', `The registry price for ${req.provider}:${req.model} went stale at ${price.staleAfter}. Import an updated manifest and re-qualify the model.`);
    }
  } else if (price.ageHours === null || price.ageHours > policy.pricing.maxAgeHours) {
    return block(req, attempt, 'PRICE_STALE', `The price for ${req.provider}:${req.model} was last confirmed ${price.ageHours === null ? 'never' : `${Math.round(price.ageHours)}h ago`}; prices older than ${policy.pricing.maxAgeHours}h are not trusted for a ceiling. Refresh pricing in Master Admin → Spend Control.`);
  }
  const tier = costTierFor(price, policy);
  const est = estimateMaxCostUsd(req, price, policy);
  if (est.usd === null) {
    return est.code === 'CEILING_TOO_LOW'
      ? block(req, attempt, 'CEILING_TOO_LOW', `At ${req.model}'s price the per-run ceiling of $${policy.antigravity.perRunCeilingUsd} allows fewer than ${ANTIGRAVITY_MIN_TOKENS} tokens.`)
      : block(req, attempt, 'PRICE_UNKNOWN', `${req.provider}:${req.model} has no usable price for this kind of call. PRICE UNKNOWN — EXECUTION BLOCKED.`);
  }
  const maxTier = req.maxTier ?? policy.task.maxTier;
  if (tier === 'UNKNOWN' || tierRank(tier as CostTier) > tierRank(maxTier)) {
    return block(req, attempt, 'TIER_NOT_ALLOWED', `${req.provider}:${req.model} is ${tier}; this call allows at most ${maxTier}.`, { estimatedCostUsd: est.usd, tier });
  }
  const ceiling = req.provider === 'antigravity' ? policy.antigravity.perRunCeilingUsd : policy.task.maxEstimatedUsd;
  if (est.usd > ceiling) {
    return block(req, attempt, 'TASK_CEILING_EXCEEDED', `Estimated maximum $${est.usd.toFixed(4)} exceeds the per-${req.provider === 'antigravity' ? 'run' : 'task'} ceiling of $${ceiling.toFixed(4)}.`, { estimatedCostUsd: est.usd, tier });
  }
  if (est.usd > policy.approvalThresholdUsd && !req.approvalId) {
    return block(req, attempt, 'APPROVAL_REQUIRED_EXPENSIVE', `Estimated maximum $${est.usd.toFixed(4)} is above the $${policy.approvalThresholdUsd.toFixed(4)} approval threshold and no human approval accompanies it.`, { estimatedCostUsd: est.usd, tier });
  }

  // Everything from here to the reservation insert is ONE atomic unit: under
  // BEGIN IMMEDIATE no other writer — another process included — can reserve
  // budget between this check and this insert.
  const txn = dryRunDepth === 0;
  if (txn) getDatabase().exec('BEGIN IMMEDIATE');
  try {
  // --- NO_PAID_FALLBACK -----------------------------------------------------
  // One logical execution uses one model. A later attempt under the same key
  // on a different model is a fallback, and is refused whatever the reason.
  const otherModel = prior.find((r) => r.model !== req.model && r.status !== 'BLOCKED');
  if (otherModel) {
    return block(req, attempt, 'FALLBACK_REFUSED', `This execution already used ${otherModel.provider}:${otherModel.model}; switching to ${req.model} would be a paid fallback, which policy forbids.`, { estimatedCostUsd: est.usd, tier });
  }

  // --- idempotency --------------------------------------------------------
  const live = prior.filter((r) => r.status !== 'BLOCKED' && r.status !== 'PRE_DISPATCH_FAILURE' && r.status !== 'PROVIDER_REJECTION' && r.status !== 'OPERATOR_CLEARED');
  const ambiguous = live.find((r) => (AMBIGUOUS_STATUSES as string[]).includes(r.status));
  if (ambiguous) {
    return block(req, attempt, 'RECONCILIATION_REQUIRED', `A previous attempt (${ambiguous.usage_id}) ended ${ambiguous.status}: it may have been processed and billed. It is never retried automatically — an operator must review it (Master Admin → Spend Control).`, { estimatedCostUsd: est.usd, tier });
  }
  const inflight = live.find((r) => r.status === 'RESERVED' || r.status === 'DISPATCHED');
  if (inflight) return block(req, attempt, 'DUPLICATE_IN_FLIGHT', `This execution is already in flight (${inflight.usage_id}); a second paid call was refused.`, { estimatedCostUsd: est.usd, tier });
  const done = live.find((r) => r.status === 'SUCCESS' || r.status === 'KNOWN_FAILURE');
  if (done) return block(req, attempt, 'DUPLICATE_ALREADY_EXECUTED', `This execution already ran (${done.usage_id}, ${done.status}); it is not paid for twice.`, { estimatedCostUsd: est.usd, tier });

  // --- concurrency ----------------------------------------------------------
  if (inFlightCount() >= policy.global.maxConcurrent) return block(req, attempt, 'CONCURRENCY_GLOBAL', `The global limit of ${policy.global.maxConcurrent} concurrent paid calls is in use. The work waits; it does not fan out.`, { estimatedCostUsd: est.usd, tier });
  if (inFlightCount({ provider: req.provider }) >= provLimits.maxConcurrent) return block(req, attempt, 'CONCURRENCY_PROVIDER', `The ${req.provider} limit of ${provLimits.maxConcurrent} concurrent calls is in use.`, { estimatedCostUsd: est.usd, tier });
  const wsLimits = req.workspaceId ? (policy.workspaceOverrides[req.workspaceId] ?? policy.workspaceDefault) : null;
  if (wsLimits && inFlightCount({ workspaceId: req.workspaceId! }) >= wsLimits.maxConcurrent) return block(req, attempt, 'CONCURRENCY_WORKSPACE', `This workspace's limit of ${wsLimits.maxConcurrent} concurrent paid calls is in use.`, { estimatedCostUsd: est.usd, tier });

  // --- budgets (in-flight reservations included) ----------------------------
  const { dayStart, monthStart } = periodStarts();
  const checks: Array<[string, number, number]> = [
    ['GLOBAL_DAILY', spentSince(dayStart), policy.global.dailyUsd],
    ['GLOBAL_MONTHLY', spentSince(monthStart), policy.global.monthlyUsd],
    ['PROVIDER_DAILY', spentSince(dayStart, { provider: req.provider }), provLimits.dailyUsd],
    ['PROVIDER_MONTHLY', spentSince(monthStart, { provider: req.provider }), provLimits.monthlyUsd],
  ];
  if (wsLimits) checks.push(['WORKSPACE_DAILY', spentSince(dayStart, { workspaceId: req.workspaceId! }), wsLimits.dailyUsd]);
  for (const [name, spent, limit] of checks) {
    if (spent + est.usd > limit) {
      return block(req, attempt, `BUDGET_${name}`, `${name.replace('_', ' ').toLowerCase()} budget: $${spent.toFixed(4)} used of $${limit.toFixed(4)}; this call could cost up to $${est.usd.toFixed(4)}.`, { estimatedCostUsd: est.usd, tier });
    }
  }

  const usageId = newUsageId();
  if (dryRunDepth > 0) return { permitted: true, usageId, estimatedCostUsd: est.usd, tier, attempt, maxTotalTokens: est.maxTotalTokens };
  insertUsageRow({
    usage_id: usageId, provider: req.provider, model: req.model, call_site: req.callSite,
    workspace_id: req.workspaceId ?? null, task_id: req.taskId ?? null, correlation_id: req.correlationId ?? null,
    idempotency_key: req.idempotencyKey, attempt, status: 'RESERVED',
    input_chars: req.inputChars, estimated_input_tokens: est.inputTokens,
    max_output_tokens: req.provider === 'antigravity' ? policy.antigravity.maxTotalTokens : (req.maxOutputTokens ?? policy.task.maxOutputTokens),
    estimated_cost_usd: est.usd, cost_tier: tier, approval_id: req.approvalId ?? null,
    price_version: price.versionKey, price_snapshot_json: JSON.stringify(snapshotOf(price)),
    created_at: new Date().toISOString(),
    ...routeEvidence(),
  });
  if (txn) getDatabase().exec('COMMIT');
  return { permitted: true, usageId, estimatedCostUsd: est.usd, tier, attempt, maxTotalTokens: est.maxTotalTokens };
  } catch (err) {
    if (txn) { try { getDatabase().exec('ROLLBACK'); } catch { /* not in a transaction */ } }
    throw err;
  } finally {
    // A refusal returned from inside the block leaves the transaction open; close it.
    if (txn) { try { getDatabase().exec('COMMIT'); } catch { /* already committed or rolled back */ } }
  }
}

/**
 * The same decision authorizePaidCall would make, without recording or
 * reserving anything. Used to refuse BEFORE a single-use human approval is
 * spent, and to show the estimated maximum cost at approval time.
 */
export function previewPaidCall(req: PaidCallRequest) {
  dryRunDepth += 1;
  try { return authorizePaidCall(req); } finally { dryRunDepth -= 1; }
}

/** Refusals that mean "not now" — the work should wait, not fail. */
export const SPEND_WAIT_CODES = new Set([
  'PAID_EXECUTION_DISABLED', 'PROVIDER_DISABLED', 'PRICING_UNKNOWN',
  'CONCURRENCY_GLOBAL', 'CONCURRENCY_PROVIDER', 'CONCURRENCY_WORKSPACE',
  'BUDGET_GLOBAL_DAILY', 'BUDGET_GLOBAL_MONTHLY', 'BUDGET_PROVIDER_DAILY', 'BUDGET_PROVIDER_MONTHLY', 'BUDGET_WORKSPACE_DAILY',
]);

function classify(permit: SpendPermit, outcome: PaidCallOutcome<unknown> | null, threw: boolean): UsageStatus {
  if (permit.dispatched === 0) return 'PRE_DISPATCH_FAILURE';
  if (outcome?.ok && !threw) return 'SUCCESS';
  if (permit.lastErrorKind === 'TIMEOUT' || outcome?.failureHint === 'TIMEOUT') return 'TIMEOUT_AFTER_DISPATCH';
  if (permit.lastErrorKind === 'CONNECTION_REFUSED') return 'KNOWN_FAILURE';
  if (permit.lastErrorKind === 'NETWORK') return 'UNKNOWN';
  if (permit.lastStatus !== null && permit.lastStatus >= 400 && permit.lastStatus < 500) return 'PROVIDER_REJECTION';
  if (permit.lastStatus !== null && permit.lastStatus >= 500) return 'UNKNOWN';
  if (permit.lastStatus !== null) return 'KNOWN_FAILURE';
  return 'UNKNOWN';
}

/**
 * Run one paid call through the guard. `fn` must make at most one paid
 * request; the network layer refuses a second.
 */
/** What the guard grants a call: for Antigravity, the token cap to send. */
export interface PaidCallGrant {
  maxTotalTokens?: number;
}

export async function guardedPaidCall<T>(req: PaidCallRequest, fn: (grant: PaidCallGrant) => Promise<PaidCallOutcome<T>>): Promise<GuardResult<T>> {
  const auth = authorizePaidCall(req);
  if (!auth.permitted) {
    recordGuardEvent(req, 'BLOCKED', auth.code, auth.reason);
    return auth;
  }

  const policyNow = getSpendPolicy();
  const permit: SpendPermit = {
    usageId: auth.usageId,
    provider: req.provider,
    // Bind the network request to exactly what was priced (network-guard verifies the body).
    priced: {
      model: req.model,
      maxOutputTokens: req.provider === 'antigravity'
        ? (auth.maxTotalTokens ?? null)
        : (req.provider === 'openai' || req.provider === 'gemini') ? (req.maxOutputTokens ?? policyNow.task.maxOutputTokens) : null,
      maxInputChars: req.inputChars,
    },
    maxDispatches: 1,
    dispatched: 0,
    lastStatus: null,
    lastErrorKind: null,
    onDispatch: () => patchUsageRow(auth.usageId, { status: 'DISPATCHED', dispatched_at: new Date().toISOString() }),
  };

  let outcome: PaidCallOutcome<T> | null = null;
  let threw: unknown = null;
  try {
    outcome = await runWithPermit(permit, () => fn({ maxTotalTokens: auth.maxTotalTokens }));
  } catch (err) {
    threw = err;
  }

  const status = classify(permit, outcome, !!threw);
  const reserved = getDatabase().prepare('SELECT price_snapshot_json FROM provider_usage WHERE usage_id = ?').get(auth.usageId) as any;
  const snap: PriceSnapshot | null = reserved?.price_snapshot_json ? JSON.parse(reserved.price_snapshot_json) : null;
  const u = outcome?.usage ?? null;
  const actual = status === 'SUCCESS' || status === 'KNOWN_FAILURE' ? actualCostUsd(req.provider, snap, u) : null;
  const leaveInFlight = req.asyncSettlement && status === 'SUCCESS';

  patchUsageRow(auth.usageId, {
    status: leaveInFlight ? 'DISPATCHED' : status,
    reason_code: threw ? String((threw as any)?.code || (threw as any)?.name || 'ERROR') : null,
    reason: threw ? String((threw as any)?.message || threw).slice(0, 300) : null,
    provider_request_id: u?.providerRequestId ?? null,
    input_tokens: u?.inputTokens ?? null,
    output_tokens: u?.outputTokens ?? null,
    cached_tokens: u?.cachedTokens ?? null,
    reasoning_tokens: u?.reasoningTokens ?? null,
    total_tokens: u?.totalTokens ?? null,
    provider_termination: outcome?.termination ?? null,
    actual_cost_usd: status === 'PRE_DISPATCH_FAILURE' || status === 'PROVIDER_REJECTION' ? 0 : actual,
    actual_cost_state: status === 'PRE_DISPATCH_FAILURE' || status === 'PROVIDER_REJECTION' ? 'KNOWN' : actual === null ? 'ACTUAL_COST_UNKNOWN' : 'KNOWN',
    completed_at: leaveInFlight ? null : new Date().toISOString(),
  });

  if (status !== 'SUCCESS') recordGuardEvent(req, status, null, threw ? String((threw as any)?.message || '').slice(0, 200) : null);
  evaluateSpendAlerts(req.provider);
  if (threw) throw threw;
  return { permitted: true, usageId: auth.usageId, status: leaveInFlight ? 'DISPATCHED' : status, outcome: outcome!, estimatedCostUsd: auth.estimatedCostUsd };
}

/** Settle an asynchronous run (Antigravity) when the remote job reaches an outcome. */
export function settleAsyncUsage(providerRequestId: string, status: 'SUCCESS' | 'KNOWN_FAILURE' | 'UNKNOWN', usage?: NormalizedUsage | null): void {
  try {
    const row = getDatabase().prepare(`SELECT * FROM provider_usage WHERE provider_request_id = ? AND status = 'DISPATCHED'`).get(providerRequestId) as any;
    if (!row) return;
    const snap: PriceSnapshot | null = row.price_snapshot_json ? JSON.parse(row.price_snapshot_json) : null;
    const actual = actualCostUsd(row.provider, snap, usage);
    patchUsageRow(row.usage_id, {
      status,
      input_tokens: usage?.inputTokens ?? row.input_tokens,
      output_tokens: usage?.outputTokens ?? row.output_tokens,
      total_tokens: usage?.totalTokens ?? row.total_tokens,
      actual_cost_usd: actual,
      actual_cost_state: actual === null ? 'ACTUAL_COST_UNKNOWN' : 'KNOWN',
      completed_at: new Date().toISOString(),
    });
    evaluateSpendAlerts(row.provider);
  } catch { /* settlement is best-effort; the row stays DISPATCHED and keeps counting */ }
}

/** Operator decision on an ambiguous row. Its cost still counts; a new attempt becomes possible. */
export function clearAmbiguousUsage(usageId: string, note: string): boolean {
  const res = getDatabase().prepare(`UPDATE provider_usage SET status = 'OPERATOR_CLEARED', reason = ? WHERE usage_id = ? AND status IN ('TIMEOUT_AFTER_DISPATCH', 'UNKNOWN')`)
    .run(String(note || 'Reviewed by an operator.').slice(0, 300), usageId) as any;
  return Number(res?.changes ?? 0) === 1;
}

function recordGuardEvent(req: PaidCallRequest, status: string, code: string | null, reason: string | null): void {
  try {
    recordRuntimeEvent({
      workspaceId: req.workspaceId ?? null,
      eventType: 'SPEND_GUARD',
      targetType: 'provider',
      targetId: req.provider,
      status: status === 'BLOCKED' ? 'BLOCKED' : status === 'SUCCESS' ? 'SUCCESS' : status === 'PROVIDER_REJECTION' || status === 'KNOWN_FAILURE' ? 'FAILED' : 'UNKNOWN',
      detail: { outcome: status, code, reason, model: req.model, callSite: req.callSite, idempotencyKey: req.idempotencyKey },
    } );
  } catch { /* evidence must not change the decision */ }
}

export const ALERT_THRESHOLDS = [50, 75, 90, 100];

/** Threshold alerts. Pure arithmetic over the ledger — never a paid call. */
export function evaluateSpendAlerts(provider?: string): void {
  try {
    const policy = getSpendPolicy();
    const { dayStart, monthStart, dayKey, monthKey } = periodStarts();
    const scopes: Array<[string, string, number, number]> = [
      ['global:daily', dayKey, spentSince(dayStart), policy.global.dailyUsd],
      ['global:monthly', monthKey, spentSince(monthStart), policy.global.monthlyUsd],
    ];
    if (provider && (policy.providers as any)[provider]) {
      const l = (policy.providers as any)[provider];
      scopes.push([`provider:${provider}:daily`, dayKey, spentSince(dayStart, { provider }), l.dailyUsd]);
      scopes.push([`provider:${provider}:monthly`, monthKey, spentSince(monthStart, { provider }), l.monthlyUsd]);
    }
    for (const [scope, period, spent, limit] of scopes) {
      if (!(limit > 0)) continue;
      const pct = (spent / limit) * 100;
      for (const t of ALERT_THRESHOLDS) {
        if (pct >= t && recordSpendAlert(scope, period, t, spent, limit)) {
          recordRuntimeEvent({
            workspaceId: null, eventType: 'SPEND_ALERT', targetType: 'provider', targetId: scope,
            status: t >= 100 ? 'BLOCKED' : 'UNKNOWN',
            detail: { scope, period, threshold: t, spentUsd: round6(spent), limitUsd: limit, message: t >= 100 ? `${scope} budget reached — new paid execution in this scope is blocked.` : `${scope} budget at ${t}%.` },
          });
        }
      }
    }
  } catch { /* alerts are advisory; enforcement is in authorizePaidCall */ }
}

/** Helpers for adapters. */
export function normalizeOpenAiUsage(usage: any, requestId?: string | null): NormalizedUsage | null {
  if (!usage || typeof usage !== 'object') return requestId ? { providerRequestId: requestId } : null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    inputTokens: n(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: n(usage.output_tokens ?? usage.completion_tokens),
    cachedTokens: n(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens),
    reasoningTokens: n(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens),
    totalTokens: n(usage.total_tokens),
    providerRequestId: requestId ?? null,
  };
}

export function normalizeGeminiUsage(meta: any, requestId?: string | null): NormalizedUsage | null {
  if (!meta || typeof meta !== 'object') return requestId ? { providerRequestId: requestId } : null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const candidates = n(meta.candidatesTokenCount);
  const thoughts = n(meta.thoughtsTokenCount);
  return {
    inputTokens: n(meta.promptTokenCount),
    // Gemini bills thinking tokens as output; candidatesTokenCount excludes them.
    outputTokens: candidates === null ? null : candidates + (thoughts ?? 0),
    cachedTokens: n(meta.cachedContentTokenCount),
    reasoningTokens: thoughts,
    totalTokens: n(meta.totalTokenCount),
    providerRequestId: requestId ?? null,
  };
}

export function contentChars(contents: unknown): number {
  if (typeof contents === 'string') return contents.length;
  try { return JSON.stringify(contents ?? '').length; } catch { return 0; }
}
