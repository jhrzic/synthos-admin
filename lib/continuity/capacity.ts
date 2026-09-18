// ---------------------------------------------------------------------------
// CAPACITY — how much room a route/deployment has, measured before acting.
//
// Every dimension is read from an existing authority, never guessed:
//   context / output      the model record's limits
//   rate / tokens / day   the deployment's declared limits vs the usage ledger
//   concurrency           the spend policy vs in-flight ledger rows
//   budgets               the spend policy vs spend recorded in the ledger
//   health                the provider-state ledger
//
// A dimension is WARN at the policy's warnAt fraction, ACT at actAt (the
// continuity controller checkpoints BEFORE exhaustion), EXHAUSTED when the
// next unit of work cannot fit. Unknown limits are reported UNKNOWN, not OK.
// ---------------------------------------------------------------------------

import { getDatabase } from '../persistence';
import { getSpendPolicy } from '../spend/policy';
import { spentSince, inFlightCount, periodStarts } from '../spend/ledger';

export type CapacityState = 'OK' | 'WARN' | 'ACT' | 'EXHAUSTED' | 'UNKNOWN';

export interface CapacityDimension {
  dimension: string;
  used: number | null;
  need: number | null;
  limit: number | null;
  /** Remaining fraction after this unit of work, 0..1; null when unknown. */
  headroom: number | null;
  state: CapacityState;
  detail: string;
}

export interface CapacityReport {
  providerId: string;
  modelId: string;
  deploymentId: string;
  dimensions: CapacityDimension[];
  /** Lowest known headroom (0..1). */
  headroom: number;
  exhausted: CapacityDimension[];
  acting: CapacityDimension[];
  measuredAt: string;
}

export interface CapacityInput {
  providerId: string;
  modelId: string;
  deploymentId: string;
  workspaceId?: string | null;
  estimatedInputTokens: number;
  expectedOutputTokens: number;
  estimatedCostUsd: number;
  limits: { contextTokens: number | null; outputTokens: number | null };
  rateLimits?: { requestsPerMinute: number | null; tokensPerMinute: number | null; tokensPerDay: number | null };
  billing: string;
  thresholds?: { warnAt: number; actAt: number };
}

function dim(dimension: string, used: number | null, need: number | null, limit: number | null, t: { warnAt: number; actAt: number }, detail: string): CapacityDimension {
  if (limit === null || limit === undefined || used === null) return { dimension, used, need, limit: limit ?? null, headroom: null, state: 'UNKNOWN', detail: `${detail}: limit not declared` };
  if (limit <= 0) return { dimension, used, need, limit, headroom: 0, state: 'EXHAUSTED', detail: `${detail}: limit is 0` };
  const after = used + (need ?? 0);
  const headroom = Math.max(0, 1 - after / limit);
  const frac = after / limit;
  const state: CapacityState = after > limit ? 'EXHAUSTED' : frac >= t.actAt ? 'ACT' : frac >= t.warnAt ? 'WARN' : 'OK';
  return { dimension, used, need, limit, headroom, state, detail };
}

export function assessCapacity(input: CapacityInput): CapacityReport {
  const t = input.thresholds ?? { warnAt: 0.8, actAt: 0.9 };
  const db = getDatabase();
  const dims: CapacityDimension[] = [];
  const now = new Date();

  dims.push(dim('context', 0, input.estimatedInputTokens + input.expectedOutputTokens, input.limits.contextTokens, t, 'input + expected output against the context window'));
  dims.push(dim('output', 0, input.expectedOutputTokens, input.limits.outputTokens, t, 'expected output against the maximum output'));

  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const rl = input.rateLimits;
  let reqMinute = 0; let tokMinute = 0; let tokDay = 0;
  try {
    const depClause = input.deploymentId === 'default' ? '(deployment_id IS NULL OR deployment_id = ?)' : 'deployment_id = ?';
    const r1 = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(total_tokens, estimated_input_tokens, 0)), 0) AS t FROM provider_usage WHERE provider = ? AND ${depClause} AND created_at >= ? AND status != 'BLOCKED'`).get(input.providerId, input.deploymentId, minuteAgo) as any;
    reqMinute = r1?.n ?? 0; tokMinute = r1?.t ?? 0;
    const r2 = db.prepare(`SELECT COALESCE(SUM(COALESCE(total_tokens, estimated_input_tokens, 0)), 0) AS t FROM provider_usage WHERE provider = ? AND ${depClause} AND created_at >= ? AND status != 'BLOCKED'`).get(input.providerId, input.deploymentId, periodStarts(now).dayStart) as any;
    tokDay = r2?.t ?? 0;
  } catch { /* ledger not created yet: nothing used */ }
  const need = input.estimatedInputTokens + input.expectedOutputTokens;
  dims.push(dim('rate.requests_per_minute', reqMinute, 1, rl?.requestsPerMinute ?? null, t, 'requests in the last minute on this deployment'));
  dims.push(dim('rate.tokens_per_minute', tokMinute, need, rl?.tokensPerMinute ?? null, t, 'tokens in the last minute on this deployment'));
  dims.push(dim('quota.tokens_per_day', tokDay, need, rl?.tokensPerDay ?? null, t, 'tokens today on this deployment'));

  const policy = getSpendPolicy();
  const prov = (policy.providers as Record<string, { enabled: boolean; dailyUsd: number; monthlyUsd: number; maxConcurrent: number } | undefined>)[input.providerId];
  if (input.billing !== 'FREE_LOCAL') {
    const { dayStart, monthStart } = periodStarts(now);
    dims.push(dim('concurrency.provider', inFlightCount({ provider: input.providerId }), 1, prov?.maxConcurrent ?? null, t, 'in-flight calls to this provider'));
    dims.push(dim('concurrency.global', inFlightCount(), 1, policy.global.maxConcurrent, t, 'in-flight paid calls'));
    dims.push(dim('budget.global_daily', spentSince(dayStart), input.estimatedCostUsd, policy.global.dailyUsd, t, 'global daily budget (USD)'));
    dims.push(dim('budget.global_monthly', spentSince(monthStart), input.estimatedCostUsd, policy.global.monthlyUsd, t, 'global monthly budget (USD)'));
    dims.push(dim('budget.provider_daily', spentSince(dayStart, { provider: input.providerId }), input.estimatedCostUsd, prov?.dailyUsd ?? null, t, 'provider daily budget (USD)'));
    dims.push(dim('budget.provider_monthly', spentSince(monthStart, { provider: input.providerId }), input.estimatedCostUsd, prov?.monthlyUsd ?? null, t, 'provider monthly budget (USD)'));
    if (input.workspaceId) {
      const ws = policy.workspaceOverrides[input.workspaceId] ?? policy.workspaceDefault;
      dims.push(dim('budget.workspace_daily', spentSince(dayStart, { workspaceId: input.workspaceId }), input.estimatedCostUsd, ws.dailyUsd, t, 'workspace daily budget (USD)'));
      dims.push(dim('concurrency.workspace', inFlightCount({ workspaceId: input.workspaceId }), 1, ws.maxConcurrent, t, 'in-flight calls in this workspace'));
    }
  }

  const known = dims.filter((d) => d.headroom !== null);
  return {
    providerId: input.providerId, modelId: input.modelId, deploymentId: input.deploymentId, dimensions: dims,
    headroom: known.length ? Math.min(...known.map((d) => d.headroom!)) : 0,
    exhausted: dims.filter((d) => d.state === 'EXHAUSTED'),
    acting: dims.filter((d) => d.state === 'ACT'),
    measuredAt: now.toISOString(),
  };
}

/** Which pause state an exhausted dimension calls for. */
export function pauseStateFor(exhausted: CapacityDimension[]): 'PAUSED_AWAITING_BUDGET' | 'PAUSED_AWAITING_CAPACITY' {
  return exhausted.some((d) => d.dimension.startsWith('budget.')) ? 'PAUSED_AWAITING_BUDGET' : 'PAUSED_AWAITING_CAPACITY';
}
