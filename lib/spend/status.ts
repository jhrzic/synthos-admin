// ---------------------------------------------------------------------------
// SPEND VISIBILITY — what Master Admin → Spend Control shows.
//
// Every figure comes from the usage ledger. Where the provider did not report
// usage, the row counts at its ESTIMATE and is flagged ACTUAL_COST_UNKNOWN;
// the totals are split so nobody mistakes an estimate for an invoice.
// ---------------------------------------------------------------------------

import { getDatabase } from '../persistence';
import { getSpendPolicy, getModelPrice, costTierFor, PAID_PROVIDERS, type PaidProvider } from './policy';
import { previewPaidCall } from './guard';
import { listPricingSources, listCatalogPrices, priceHistory, lastPricingRefresh } from '../pricing/catalog';
import { resolveDefaultOpenAiModel, resolveReviewSeatModel, normalizeGeminiModel } from '../model-router';
import { resolveAntigravityAgent } from '../antigravity-client';
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
    pricing: pricingView(policy),
    today, month,
    // spentUsd already INCLUDES in-flight reservations (RESERVED / DISPATCHED
    // rows at their estimate), so "remaining" is remaining after reservations.
    reservations: reservationTotals(),
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


function reservationTotals() {
  ensureUsageTable();
  const row = getDatabase().prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(estimated_cost_usd), 0) AS usd FROM provider_usage WHERE status IN ('RESERVED', 'DISPATCHED')`).get() as any;
  const ambiguous = getDatabase().prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(estimated_cost_usd), 0) AS usd FROM provider_usage WHERE status IN ('TIMEOUT_AFTER_DISPATCH', 'UNKNOWN')`).get() as any;
  return { inFlightCalls: Number(row.n), inFlightReservedUsd: Number(row.usd), heldForReconciliationCalls: Number(ambiguous.n), heldForReconciliationUsd: Number(ambiguous.usd) };
}

/** A representative task used to show what each selected model would cost right now. */
const REPRESENTATIVE_INPUT_CHARS = 4_000;

function pricingView(policy: ReturnType<typeof getSpendPolicy>) {
  const sources = listPricingSources().map((s: any) => {
    const age = s.last_success_at ? (Date.now() - new Date(s.last_success_at).getTime()) / 3_600_000 : null;
    return {
      sourceId: s.source_id, sourceUrl: s.source_url, lastAttemptAt: s.last_attempt_at, lastSuccessAt: s.last_success_at,
      lastStatus: s.last_status, lastError: s.last_error, models: s.models_count,
      state: age === null ? 'NEVER_REFRESHED' : age > policy.pricing.maxAgeHours ? 'STALE' : s.last_status === 'FAILED' ? 'CURRENT_LAST_REFRESH_FAILED' : 'CURRENT',
      ageHours: age === null ? null : Math.round(age * 10) / 10,
    };
  });

  // The models the router actually selects today. Pricing never changes this
  // selection; it only decides whether the selection may spend.
  const selected: Array<{ role: string; provider: PaidProvider; model: string }> = [
    { role: 'OpenAI default', provider: 'openai', model: resolveDefaultOpenAiModel() },
    { role: 'Development review seat', provider: 'openai', model: resolveReviewSeatModel() },
    { role: 'Gemini default', provider: 'gemini', model: normalizeGeminiModel() },
    { role: 'Antigravity agent', provider: 'antigravity', model: resolveAntigravityAgent() },
    { role: 'OpenAI speech', provider: 'openai_tts', model: 'tts-1' },
  ];
  const selectedModels = selected.map((m) => {
    const price = getModelPrice(m.provider, m.model);
    const preview = previewPaidCall({
      provider: m.provider, model: m.model, callSite: 'admin.preview', idempotencyKey: `preview:${m.provider}:${m.model}`,
      inputChars: REPRESENTATIVE_INPUT_CHARS, maxOutputTokens: m.provider === 'antigravity' ? undefined : policy.task.maxOutputTokens,
      approvalId: 'preview-assumes-approval',
    });
    return {
      ...m,
      priceState: !price ? 'PRICE_UNKNOWN' : price.ageHours === null || price.ageHours > policy.pricing.maxAgeHours ? 'PRICE_STALE' : 'CURRENT',
      price: price ? { unit: price.unit, input: price.inputPerMillion, output: price.outputPerMillion, cachedInput: price.cachedInputPerMillion ?? null, long: price.long ?? null, versionKey: price.versionKey, derivedFrom: price.derivedFrom ?? null, tier: costTierFor(price, policy) } : null,
      estimatedMaxUsd: preview.estimatedCostUsd,
      eligibility: preview.permitted ? 'ELIGIBLE' : preview.code,
      blockedReason: preview.permitted ? null : preview.reason,
    };
  });

  return {
    sources,
    lastRefresh: lastPricingRefresh(),
    selectedModels,
    pricedModels: listCatalogPrices().length,
    recentChanges: priceHistory(undefined, undefined, 20).map((h: any) => ({ provider: h.provider, modelId: h.model_id, changeType: h.change_type, oldVersion: h.old_version, newVersion: h.new_version, detectedAt: h.detected_at })),
    maxAgeHours: policy.pricing.maxAgeHours,
  };
}
