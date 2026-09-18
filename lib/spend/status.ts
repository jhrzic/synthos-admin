// ---------------------------------------------------------------------------
// SPEND VISIBILITY — what Master Admin → Spend Control shows.
//
// Every figure comes from the usage ledger. Where the provider did not report
// usage, the row counts at its ESTIMATE and is flagged ACTUAL_COST_UNKNOWN;
// the totals are split so nobody mistakes an estimate for an invoice.
// ---------------------------------------------------------------------------

import { getDatabase } from '../persistence';
import { getSpendPolicy, getPricingTable, costTierFor, PAID_PROVIDERS } from './policy';
import { ensureUsageTable, periodStarts, spentSince, inFlightCount, listSpendAlerts, COST_BEARING_STATUSES } from './ledger';
import { unguardedAttemptCount } from './network-guard';

function totals(since: string) {
  ensureUsageTable();
  const placeholders = COST_BEARING_STATUSES.map(() => '?').join(', ');
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS calls,
           COALESCE(SUM(CASE WHEN actual_cost_usd IS NOT NULL THEN actual_cost_usd ELSE 0 END), 0) AS actual_usd,
           COALESCE(SUM(CASE WHEN actual_cost_usd IS NULL THEN COALESCE(estimated_cost_usd, 0) ELSE 0 END), 0) AS estimated_only_usd,
           COALESCE(SUM(estimated_cost_usd), 0) AS estimated_usd,
           SUM(CASE WHEN actual_cost_state = 'ACTUAL_COST_UNKNOWN' OR (actual_cost_usd IS NULL AND status IN ('DISPATCHED','TIMEOUT_AFTER_DISPATCH','UNKNOWN')) THEN 1 ELSE 0 END) AS unknown_actual_calls,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM provider_usage WHERE created_at >= ? AND status IN (${placeholders})
  `).get(since, ...COST_BEARING_STATUSES) as any;
  const blocked = Number((getDatabase().prepare(`SELECT COUNT(*) AS n FROM provider_usage WHERE created_at >= ? AND status = 'BLOCKED'`).get(since) as any)?.n ?? 0);
  return {
    calls: Number(row.calls),
    spentUsd: Number(row.actual_usd) + Number(row.estimated_only_usd),
    actualKnownUsd: Number(row.actual_usd),
    estimateOnlyUsd: Number(row.estimated_only_usd),
    estimatedMaxUsd: Number(row.estimated_usd),
    callsWithUnknownActualCost: Number(row.unknown_actual_calls ?? 0),
    inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), totalTokens: Number(row.total_tokens),
    blockedCalls: blocked,
  };
}

function breakdown(since: string, column: 'provider' | 'model') {
  ensureUsageTable();
  const placeholders = COST_BEARING_STATUSES.map(() => '?').join(', ');
  return (getDatabase().prepare(`
    SELECT provider, ${column === 'model' ? 'model,' : ''} COUNT(*) AS calls,
           COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) AS spent,
           COALESCE(SUM(actual_cost_usd), 0) AS actual,
           SUM(CASE WHEN actual_cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_actual,
           COALESCE(SUM(total_tokens), 0) AS tokens
      FROM provider_usage WHERE created_at >= ? AND status IN (${placeholders})
     GROUP BY provider${column === 'model' ? ', model' : ''} ORDER BY spent DESC
  `).all(since, ...COST_BEARING_STATUSES) as any[]).map((r) => ({
    provider: r.provider, model: r.model ?? undefined, calls: Number(r.calls), spentUsd: Number(r.spent),
    actualKnownUsd: Number(r.actual), callsWithUnknownActualCost: Number(r.unknown_actual), totalTokens: Number(r.tokens),
  }));
}

export function getSpendStatus() {
  const policy = getSpendPolicy();
  const pricing = getPricingTable();
  const { dayStart, monthStart } = periodStarts();
  const today = totals(dayStart);
  const month = totals(monthStart);

  const providers = PAID_PROVIDERS.map((p) => {
    const l = policy.providers[p];
    const d = spentSince(dayStart, { provider: p });
    const m = spentSince(monthStart, { provider: p });
    return {
      provider: p, enabled: l.enabled, dailyUsd: l.dailyUsd, monthlyUsd: l.monthlyUsd, maxConcurrent: l.maxConcurrent,
      spentTodayUsd: d, spentMonthUsd: m,
      remainingTodayUsd: Math.max(0, l.dailyUsd - d), remainingMonthUsd: Math.max(0, l.monthlyUsd - m),
      inFlight: inFlightCount({ provider: p }),
    };
  });

  ensureUsageTable();
  const needsReconciliation = getDatabase().prepare(`
    SELECT usage_id, provider, model, call_site, workspace_id, task_id, idempotency_key, status, estimated_cost_usd, created_at, dispatched_at, reason
      FROM provider_usage WHERE status IN ('TIMEOUT_AFTER_DISPATCH', 'UNKNOWN') ORDER BY created_at DESC LIMIT 50
  `).all();
  const recentBlocks = getDatabase().prepare(`
    SELECT usage_id, provider, model, call_site, reason_code, reason, created_at
      FROM provider_usage WHERE status = 'BLOCKED' ORDER BY created_at DESC LIMIT 20
  `).all();

  return {
    policy,
    pricing: Object.entries(pricing).map(([key, price]) => ({ key, ...price, tier: costTierFor(price, policy) })),
    today, month,
    remaining: {
      globalTodayUsd: Math.max(0, policy.global.dailyUsd - today.spentUsd),
      globalMonthUsd: Math.max(0, policy.global.monthlyUsd - month.spentUsd),
    },
    providers,
    byModelToday: breakdown(dayStart, 'model'),
    byProviderMonth: breakdown(monthStart, 'provider'),
    inFlight: inFlightCount(),
    needsReconciliation,
    recentBlocks,
    alerts: listSpendAlerts(20),
    unguardedPaidRequestsRefusedSinceStart: unguardedAttemptCount(),
  };
}
