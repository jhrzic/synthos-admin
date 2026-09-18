// ---------------------------------------------------------------------------
// SPEND POLICY — the one canonical definition of what paid execution may cost.
//
// Stored in platform_settings ('spend.policy', 'spend.pricing'), edited only by
// a platform_admin from Master Admin → Spend Control, audited on every change.
// There is deliberately NO environment override: a budget must be visible and
// auditable in exactly one place.
//
// CONSERVATIVE BY CONSTRUCTION
//   - Paid execution is OFF until a platform_admin turns it on.
//   - Every limit has a small finite default. There is no "unlimited" value:
//     the validator refuses anything that is not a finite, non-negative number,
//     so a missing or malformed budget can never mean unbounded spend.
//   - A model with no configured price cannot be estimated, and a call that
//     cannot be estimated cannot be proven to fit a ceiling — so it is
//     BLOCKED. That is also what stops a newly discovered model becoming a
//     paid routing target merely because it exists.
// ---------------------------------------------------------------------------

import { resolvePlatformSetting, setPlatformSetting } from '../platform-settings';

export const PAID_PROVIDERS = ['openai', 'gemini', 'antigravity', 'openai_tts', 'elevenlabs', 'fish_audio'] as const;
export type PaidProvider = (typeof PAID_PROVIDERS)[number];

export const COST_TIERS = ['LOW_COST', 'STANDARD', 'PREMIUM'] as const;
export type CostTier = (typeof COST_TIERS)[number];

export interface ProviderLimits {
  enabled: boolean;
  dailyUsd: number;
  monthlyUsd: number;
  maxConcurrent: number;
}

export interface SpendPolicy {
  /** Master switch. OFF means no paid provider request leaves the process. */
  paidExecutionEnabled: boolean;
  global: { dailyUsd: number; monthlyUsd: number; maxConcurrent: number };
  providers: Record<PaidProvider, ProviderLimits>;
  workspaceDefault: { dailyUsd: number; maxConcurrent: number };
  workspaceOverrides: Record<string, { dailyUsd: number; maxConcurrent: number }>;
  task: {
    maxEstimatedUsd: number;
    maxInputChars: number;
    maxOutputTokens: number;
    maxTier: CostTier;
  };
  antigravity: {
    /** Reserved and enforced per run, because a managed agent's cost is not knowable before it runs. */
    perRunCeilingUsd: number;
    /** Sent to the provider as agent_config.max_total_tokens — the provider-side bound. */
    maxTotalTokens: number;
  };
  /** Above this estimate a call needs a human approval id; without one it is blocked. */
  approvalThresholdUsd: number;
  /** NO_PAID_FALLBACK: one paid request per logical call. No silent second model. */
  fallback: 'NO_PAID_FALLBACK';
  /** Output price per million tokens at or below which a model is LOW_COST / STANDARD. Above = PREMIUM. */
  tierThresholds: { lowCostMaxOutputPerMTok: number; standardMaxOutputPerMTok: number };
}

const limits = (dailyUsd: number, monthlyUsd: number, maxConcurrent = 1): ProviderLimits => ({ enabled: true, dailyUsd, monthlyUsd, maxConcurrent });

export const DEFAULT_SPEND_POLICY: SpendPolicy = {
  paidExecutionEnabled: false,
  global: { dailyUsd: 5, monthlyUsd: 50, maxConcurrent: 2 },
  providers: {
    openai: limits(2, 20),
    gemini: limits(2, 20),
    antigravity: limits(2, 20),
    openai_tts: limits(1, 5),
    elevenlabs: limits(1, 5),
    fish_audio: limits(1, 5),
  },
  workspaceDefault: { dailyUsd: 2, maxConcurrent: 1 },
  workspaceOverrides: {},
  task: { maxEstimatedUsd: 0.25, maxInputChars: 60_000, maxOutputTokens: 2_048, maxTier: 'STANDARD' },
  antigravity: { perRunCeilingUsd: 1, maxTotalTokens: 200_000 },
  approvalThresholdUsd: 0.1,
  fallback: 'NO_PAID_FALLBACK',
  tierThresholds: { lowCostMaxOutputPerMTok: 2, standardMaxOutputPerMTok: 15 },
};

// ---------------------------------------------------------------------------
// PRICING — entered by a platform_admin from the provider's own price page.
// Nothing here is guessed: an absent entry is UNKNOWN, and UNKNOWN blocks.
// ---------------------------------------------------------------------------

export interface ModelPrice {
  /** 'tokens' for model inference and managed agents; 'chars' for speech synthesis. */
  unit: 'tokens' | 'chars';
  inputPerMillion: number;
  outputPerMillion: number;
  /** Optional. When a provider reports cached input and this is absent, actual cost is UNKNOWN rather than guessed. */
  cachedInputPerMillion?: number;
}

/** Keyed `${provider}:${model}`. */
export type PricingTable = Record<string, ModelPrice>;

export function pricingKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Validate a full policy. Returns the list of problems; empty means valid.
 * Every numeric field must be a finite non-negative number — there is no
 * sentinel for "unlimited".
 */
export function validateSpendPolicy(p: any): string[] {
  const errors: string[] = [];
  const num = (path: string, v: unknown) => { if (!finite(v)) errors.push(`${path} must be a finite number ≥ 0`); };
  const int = (path: string, v: unknown, min = 0) => { if (!finite(v) || !Number.isInteger(v) || (v as number) < min) errors.push(`${path} must be a whole number ≥ ${min}`); };
  if (!p || typeof p !== 'object') return ['policy must be an object'];
  if (typeof p.paidExecutionEnabled !== 'boolean') errors.push('paidExecutionEnabled must be true or false');
  num('global.dailyUsd', p.global?.dailyUsd); num('global.monthlyUsd', p.global?.monthlyUsd); int('global.maxConcurrent', p.global?.maxConcurrent);
  for (const prov of PAID_PROVIDERS) {
    const l = p.providers?.[prov];
    if (!l) { errors.push(`providers.${prov} is required`); continue; }
    if (typeof l.enabled !== 'boolean') errors.push(`providers.${prov}.enabled must be true or false`);
    num(`providers.${prov}.dailyUsd`, l.dailyUsd); num(`providers.${prov}.monthlyUsd`, l.monthlyUsd); int(`providers.${prov}.maxConcurrent`, l.maxConcurrent);
  }
  num('workspaceDefault.dailyUsd', p.workspaceDefault?.dailyUsd); int('workspaceDefault.maxConcurrent', p.workspaceDefault?.maxConcurrent);
  for (const [ws, o] of Object.entries(p.workspaceOverrides || {})) {
    num(`workspaceOverrides.${ws}.dailyUsd`, (o as any)?.dailyUsd); int(`workspaceOverrides.${ws}.maxConcurrent`, (o as any)?.maxConcurrent);
  }
  num('task.maxEstimatedUsd', p.task?.maxEstimatedUsd); int('task.maxInputChars', p.task?.maxInputChars, 1); int('task.maxOutputTokens', p.task?.maxOutputTokens, 1);
  if (!COST_TIERS.includes(p.task?.maxTier)) errors.push(`task.maxTier must be one of ${COST_TIERS.join(', ')}`);
  num('antigravity.perRunCeilingUsd', p.antigravity?.perRunCeilingUsd); int('antigravity.maxTotalTokens', p.antigravity?.maxTotalTokens, 1);
  num('approvalThresholdUsd', p.approvalThresholdUsd);
  if (p.fallback !== 'NO_PAID_FALLBACK') errors.push('fallback must be NO_PAID_FALLBACK (no paid fallback policy is implemented)');
  num('tierThresholds.lowCostMaxOutputPerMTok', p.tierThresholds?.lowCostMaxOutputPerMTok);
  num('tierThresholds.standardMaxOutputPerMTok', p.tierThresholds?.standardMaxOutputPerMTok);
  return errors;
}

export function validatePricing(t: any): string[] {
  const errors: string[] = [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return ['pricing must be an object keyed "provider:model"'];
  for (const [key, v] of Object.entries(t)) {
    const [prov, ...rest] = key.split(':');
    if (!(PAID_PROVIDERS as readonly string[]).includes(prov) || rest.join(':').trim() === '') errors.push(`"${key}" must be "provider:model" with a known provider`);
    const m = v as any;
    if (m?.unit !== 'tokens' && m?.unit !== 'chars') errors.push(`${key}.unit must be tokens or chars`);
    if (!finite(m?.inputPerMillion)) errors.push(`${key}.inputPerMillion must be a finite number ≥ 0`);
    if (!finite(m?.outputPerMillion)) errors.push(`${key}.outputPerMillion must be a finite number ≥ 0`);
    if (m?.cachedInputPerMillion !== undefined && !finite(m.cachedInputPerMillion)) errors.push(`${key}.cachedInputPerMillion must be a finite number ≥ 0`);
  }
  return errors;
}

/**
 * The effective policy. A stored policy that fails validation is IGNORED in
 * favour of the conservative default — a corrupted row must never widen
 * authority. The stored value is merged over defaults so a newly added field
 * is always present and bounded.
 */
export function getSpendPolicy(): SpendPolicy & { source: 'default' | 'platform_setting'; invalidStored: boolean } {
  const r = resolvePlatformSetting('spend.policy', '');
  if (!r.value) return { ...DEFAULT_SPEND_POLICY, source: 'default', invalidStored: false };
  try {
    const parsed = JSON.parse(r.value);
    const merged = mergePolicy(parsed);
    if (validateSpendPolicy(merged).length > 0) return { ...DEFAULT_SPEND_POLICY, source: 'default', invalidStored: true };
    return { ...merged, source: 'platform_setting', invalidStored: false };
  } catch {
    return { ...DEFAULT_SPEND_POLICY, source: 'default', invalidStored: true };
  }
}

export function mergePolicy(partial: any): SpendPolicy {
  const d = DEFAULT_SPEND_POLICY;
  const providers = {} as Record<PaidProvider, ProviderLimits>;
  for (const prov of PAID_PROVIDERS) providers[prov] = { ...d.providers[prov], ...(partial?.providers?.[prov] || {}) };
  return {
    paidExecutionEnabled: partial?.paidExecutionEnabled ?? d.paidExecutionEnabled,
    global: { ...d.global, ...(partial?.global || {}) },
    providers,
    workspaceDefault: { ...d.workspaceDefault, ...(partial?.workspaceDefault || {}) },
    workspaceOverrides: { ...(partial?.workspaceOverrides || {}) },
    task: { ...d.task, ...(partial?.task || {}) },
    antigravity: { ...d.antigravity, ...(partial?.antigravity || {}) },
    approvalThresholdUsd: partial?.approvalThresholdUsd ?? d.approvalThresholdUsd,
    fallback: partial?.fallback ?? d.fallback,
    tierThresholds: { ...d.tierThresholds, ...(partial?.tierThresholds || {}) },
  };
}

export function saveSpendPolicy(partial: any, actorUserId: string): { ok: true; policy: SpendPolicy } | { ok: false; errors: string[] } {
  const current = getSpendPolicy();
  const { source: _s, invalidStored: _i, ...base } = current;
  const merged = mergePolicy({ ...base, ...partial, providers: { ...base.providers, ...(partial?.providers || {}) } });
  const errors = validateSpendPolicy(merged);
  if (errors.length) return { ok: false, errors };
  setPlatformSetting('spend.policy', JSON.stringify(merged), actorUserId);
  return { ok: true, policy: merged };
}

export function getPricingTable(): PricingTable {
  const r = resolvePlatformSetting('spend.pricing', '');
  if (!r.value) return {};
  try {
    const parsed = JSON.parse(r.value);
    return validatePricing(parsed).length ? {} : parsed;
  } catch {
    return {};
  }
}

export function savePricingTable(table: any, actorUserId: string): { ok: true } | { ok: false; errors: string[] } {
  const errors = validatePricing(table);
  if (errors.length) return { ok: false, errors };
  setPlatformSetting('spend.pricing', JSON.stringify(table), actorUserId);
  return { ok: true };
}

export function getModelPrice(provider: string, model: string): ModelPrice | null {
  return getPricingTable()[pricingKey(provider, model)] ?? null;
}

export function costTierFor(price: ModelPrice | null, policy: SpendPolicy = getSpendPolicy()): CostTier | 'UNKNOWN' {
  if (!price || price.unit !== 'tokens') return price ? 'STANDARD' : 'UNKNOWN';
  if (price.outputPerMillion <= policy.tierThresholds.lowCostMaxOutputPerMTok) return 'LOW_COST';
  if (price.outputPerMillion <= policy.tierThresholds.standardMaxOutputPerMTok) return 'STANDARD';
  return 'PREMIUM';
}

export function tierRank(t: CostTier): number {
  return COST_TIERS.indexOf(t);
}

/**
 * Conservative token estimate without a tokenizer and without calling a model:
 * one token per three characters. Real tokenizers average closer to four, so
 * this over-estimates — the safe direction for a ceiling. Always labelled
 * ESTIMATED; never recorded as actual.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 3);
}
