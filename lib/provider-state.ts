// ---------------------------------------------------------------------------
// ONE canonical provider/runtime state model.
//
// The bug this exists to kill: lib/fabric/registry.ts decided model.openai's
// status with
//
//     status: credential.apiKeyPresent ? 'AVAILABLE' : 'NOT_CONFIGURED'
//
// so the Admin read AVAILABLE while every real call came back
// `HTTP 429: You have no credits remaining`. A key being present is a
// statement about configuration; AVAILABLE is a statement about capability.
// Conflating them makes the panel confidently wrong in the one direction that
// matters — an operator plans work against a provider that cannot run it.
//
// The model separates four independent questions that were collapsed into one:
//
//   1. Does an implementation exist?      (code, not configuration)
//   2. Does a credential resolve?         (lib/model-credentials.ts)
//   3. Is it switched on?                 (explicit enablement flags)
//   4. What did the last REAL call do?    (the runtime_events ledger)
//
// No new truth store. Evidence for (4) comes from PROVIDER_CALL rows in
// runtime_events — an event type that was already declared and that nothing
// ever emitted, which is precisely why "last verified" had no source.
// ---------------------------------------------------------------------------

import { recordRuntimeEvent, listRecentRuntimeEvents } from './runtime-events';
import { scrubSecrets } from './redact';

/**
 * The canonical states. Deliberately excludes AVAILABLE and LIVE: neither can
 * be asserted without a real call having succeeded, and LIVE_VERIFIED is the
 * state that says so.
 */
export type ProviderState =
  /** No credential resolves from environment or the encrypted store. */
  | 'NO_CREDENTIAL'
  /** A credential resolves. Says nothing about whether it works. */
  | 'CREDENTIAL_PRESENT'
  /** A real call succeeded. The only state that may be read as "usable". */
  | 'LIVE_VERIFIED'
  /** The provider authenticated us and refused on quota/billing. */
  | 'QUOTA_BLOCKED'
  /** A real call failed for a reason that is not quota. */
  | 'PROVIDER_ERROR'
  /** Implementation exists; required configuration beyond a credential is absent. */
  | 'NOT_CONFIGURED'
  /** Implemented and perhaps credentialed, but switched off by an explicit flag. */
  | 'DISABLED'
  /** Implemented and reachable, but the upstream tool is itself broken. */
  | 'BROKEN_UPSTREAM';

/** Error categories, so a UI can distinguish causes without parsing prose. */
export type ProviderErrorCategory =
  | 'QUOTA_OR_BILLING'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'MODEL_NOT_FOUND'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'EMPTY_RESPONSE'
  | 'UNKNOWN';

export interface ProviderStateReport {
  provider: string;
  state: ProviderState;
  /** Whether an implementation exists AT ALL — a property of the code. */
  implemented: boolean;
  /** Whether a credential resolves right now. */
  configured: boolean;
  /** Whether an explicit enablement flag permits dispatch. */
  enabled: boolean;
  /** ISO instant of the last real call, or null if none has ever been made. */
  lastAttemptAt: string | null;
  /** ISO instant of the last SUCCESSFUL real call. */
  lastVerifiedAt: string | null;
  lastErrorCategory: ProviderErrorCategory | null;
  /** Scrubbed, bounded. Never a raw provider body. */
  lastErrorMessage: string | null;
  /** The model the provider reported on the last success. */
  lastModelUsed: string | null;
  /** Plain-language justification for the state above. */
  reason: string;
}

/**
 * Classify a provider error string into a category.
 *
 * Quota is checked before rate limiting on purpose: OpenAI returns HTTP 429
 * for both "you have no credits" and "you are going too fast", and those need
 * opposite responses — one needs money, the other needs patience. Treating a
 * billing wall as a transient rate limit would make a permanently dead
 * provider look like it was about to recover.
 */
export function classifyProviderErrorCategory(message: string | null | undefined): ProviderErrorCategory {
  const m = String(message || '').toLowerCase();
  if (!m) return 'UNKNOWN';
  if (/no credits|insufficient[_ ]quota|billing|exceeded your current quota|payment/.test(m)) return 'QUOTA_OR_BILLING';
  if (/401|unauthor|invalid[_ ]api[_ ]key|incorrect api key|forbidden|403/.test(m)) return 'AUTHENTICATION';
  if (/rate limit|too many requests|429/.test(m)) return 'RATE_LIMIT';
  if (/model[_ ]not[_ ]found|does not exist|unknown model|404/.test(m)) return 'MODEL_NOT_FOUND';
  if (/timeout|timed out|abort/.test(m)) return 'TIMEOUT';
  if (/enotfound|econnrefused|econnreset|network|fetch failed|dns/.test(m)) return 'NETWORK';
  if (/returned nothing|no text|empty/.test(m)) return 'EMPTY_RESPONSE';
  return 'UNKNOWN';
}

interface ProviderCallDetail {
  ok: boolean;
  modelUsed?: string | null;
  errorCategory?: ProviderErrorCategory;
  errorMessage?: string | null;
  latencyMs?: number | null;
}

/**
 * Record the outcome of a REAL provider call.
 *
 * Reuses the PROVIDER_CALL event type that was already declared in
 * lib/runtime-events.ts and never emitted. Never throws: evidence recording
 * must not be the thing that fails a provider call, and must never mask its
 * real outcome.
 */
export function recordProviderAttempt(params: {
  provider: string;
  ok: boolean;
  modelUsed?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  workspaceId?: string | null;
}): void {
  try {
    const category = params.ok ? null : classifyProviderErrorCategory(params.errorMessage);
    const detail: ProviderCallDetail = {
      ok: params.ok,
      modelUsed: params.modelUsed ?? null,
      errorCategory: category ?? undefined,
      // Scrubbed before storage: a provider error body can echo the key back
      // in a URL or a header dump.
      errorMessage: params.errorMessage ? scrubSecrets(params.errorMessage, 300) : null,
      latencyMs: params.latencyMs ?? null,
    };
    recordRuntimeEvent({
      workspaceId: params.workspaceId ?? null,
      eventType: 'PROVIDER_CALL',
      targetType: 'provider',
      targetId: params.provider,
      status: params.ok ? 'SUCCESS' : 'FAILED',
      latencyMs: params.latencyMs ?? null,
      detail: detail as unknown as Record<string, unknown>,
    });
  } catch {
    /* a lost row is a visible gap; a throw here would be a worse failure */
  }
}

interface LastCall {
  at: string;
  ok: boolean;
  modelUsed: string | null;
  errorCategory: ProviderErrorCategory | null;
  errorMessage: string | null;
}

/** The most recent real call for a provider, and the most recent success. */
function readLastCalls(provider: string): { last: LastCall | null; lastSuccess: LastCall | null } {
  try {
    const events = listRecentRuntimeEvents({ targetType: 'provider', limit: 200 })
      .filter((e) => e.event_type === 'PROVIDER_CALL' && e.target_id === provider);
    const parse = (e: (typeof events)[number]): LastCall => {
      let d: ProviderCallDetail = { ok: e.status === 'SUCCESS' };
      try { d = { ...d, ...(JSON.parse(e.detail_json || '{}') as ProviderCallDetail) }; } catch { /* keep the status-derived default */ }
      return {
        at: e.created_at,
        ok: e.status === 'SUCCESS',
        modelUsed: d.modelUsed ?? null,
        errorCategory: d.errorCategory ?? (e.status === 'SUCCESS' ? null : classifyProviderErrorCategory(d.errorMessage)),
        errorMessage: d.errorMessage ?? null,
      };
    };
    // listRecentRuntimeEvents returns newest first.
    const parsed = events.map(parse);
    return { last: parsed[0] ?? null, lastSuccess: parsed.find((p) => p.ok) ?? null };
  } catch {
    return { last: null, lastSuccess: null };
  }
}

export interface ResolveProviderStateInput {
  provider: string;
  /** Does an implementation exist in this repo? A property of the CODE. */
  implemented: boolean;
  /** Does a credential resolve right now? */
  configured: boolean;
  /** Does an explicit flag permit dispatch? Default true for providers with no flag. */
  enabled?: boolean;
  /**
   * The upstream tool is itself broken, independent of SynthOS. Set only with
   * a reproducible failure on record — see the Hermes case.
   */
  brokenUpstream?: boolean;
  /** Configuration beyond a credential that is required and absent (e.g. a base URL). */
  missingConfiguration?: string | null;
}

/**
 * Derive a provider's state from real evidence.
 *
 * Precedence, and the order is the point:
 *
 *   BROKEN_UPSTREAM  — a reproducible upstream defect outranks everything,
 *                      because a credential cannot fix it.
 *   NOT_IMPLEMENTED is NOT a state here. A provider with no implementation
 *                      should not have a row at all; reporting configuration
 *                      states for absent code is what produced the MCP
 *                      mislabel this model exists to prevent.
 *   DISABLED         — explicitly switched off. Outranks credential state:
 *                      "off" is the operative fact, not "has a key".
 *   NO_CREDENTIAL    — nothing can be attempted.
 *   NOT_CONFIGURED   — credential present but other required config absent.
 *   QUOTA_BLOCKED /
 *   PROVIDER_ERROR   — the last real call failed. Beats an older success,
 *                      because the current answer is what an operator needs.
 *   LIVE_VERIFIED    — the last real call succeeded.
 *   CREDENTIAL_PRESENT — configured, never attempted. The honest default.
 */
export function resolveProviderState(input: ResolveProviderStateInput): ProviderStateReport {
  const { last, lastSuccess } = readLastCalls(input.provider);
  const enabled = input.enabled ?? true;

  const base = {
    provider: input.provider,
    implemented: input.implemented,
    configured: input.configured,
    enabled,
    lastAttemptAt: last?.at ?? null,
    lastVerifiedAt: lastSuccess?.at ?? null,
    lastErrorCategory: last && !last.ok ? last.errorCategory : null,
    lastErrorMessage: last && !last.ok ? last.errorMessage : null,
    lastModelUsed: lastSuccess?.modelUsed ?? null,
  };

  if (input.brokenUpstream) {
    return { ...base, state: 'BROKEN_UPSTREAM', reason: 'The upstream tool fails independently of SynthOS; a credential cannot fix it.' };
  }
  if (!enabled) {
    // Names BOTH gates when both are shut. DISABLED alone would send an
    // operator to flip a flag and find it still does not work, because a
    // credential was missing too — two round trips where one would do.
    return {
      ...base,
      state: 'DISABLED',
      reason: input.configured
        ? 'Switched off by an explicit enablement flag. A credential resolves, so enabling it is the only remaining step.'
        : 'Switched off by an explicit enablement flag, AND no credential resolves. Both are required before dispatch is possible.',
    };
  }
  if (!input.configured) {
    return { ...base, state: 'NO_CREDENTIAL', reason: 'No credential resolves from the environment or the encrypted server-side store.' };
  }
  if (input.missingConfiguration) {
    return { ...base, state: 'NOT_CONFIGURED', reason: `A credential resolves, but required configuration is absent: ${input.missingConfiguration}.` };
  }
  if (last && !last.ok) {
    const quota = last.errorCategory === 'QUOTA_OR_BILLING';
    return {
      ...base,
      state: quota ? 'QUOTA_BLOCKED' : 'PROVIDER_ERROR',
      reason: quota
        ? `The provider authenticated this credential and refused on quota or billing at ${last.at}. Not a configuration fault.`
        : `The last real call failed at ${last.at} (${last.errorCategory}).`,
    };
  }
  if (lastSuccess) {
    return { ...base, state: 'LIVE_VERIFIED', reason: `A real call succeeded at ${lastSuccess.at}${lastSuccess.modelUsed ? ` on ${lastSuccess.modelUsed}` : ''}.` };
  }
  return {
    ...base,
    state: 'CREDENTIAL_PRESENT',
    reason: 'A credential resolves and nothing is switched off, but no real call has been made — so usability is unproven. Configured is not verified.',
  };
}

/** Whether a state may be presented as usable. Only one qualifies. */
export function isProviderUsable(state: ProviderState): boolean {
  return state === 'LIVE_VERIFIED';
}
