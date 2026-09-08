// ---------------------------------------------------------------------------
// Provider identity classification.
//
// A caller may name any model string. This decides, once, whether that
// string is a Gemini identifier this server can actually execute — or
// something else. A non-Gemini identifier must NEVER be silently substituted
// with a Gemini model; every real generateContent() call site gates on this
// classification first and fails explicitly instead.
//
// Pure, side-effect-free by design (no imports from server.ts) so it can be
// imported directly in tests without triggering server.ts's self-executing
// startServer() call.
// ---------------------------------------------------------------------------

export function normalizeGeminiModel(model?: string): string {
  if (!model) return "gemini-3.1-flash-lite";
  const m = String(model).trim();
  if (m === "gemini-3.1-flash-lite" || m === "models/gemini-3.1-flash-lite") {
    return "gemini-3.1-flash-lite";
  }
  if (m === "gemini-3.7-flash" || m === "models/gemini-3.7-flash") {
    return "gemini-3.7-flash";
  }
  if (m === "gemini-3.1-pro-preview" || m === "models/gemini-3.1-pro-preview") {
    return "gemini-3.1-pro-preview";
  }
  // Default to confirmed live model for generic 'gemini' alias
  if (m.toLowerCase() === "gemini" || m.toLowerCase() === "google" || m.toLowerCase() === "gemini-flash") {
    return "gemini-3.1-flash-lite";
  }
  return m;
}

export type ModelRouteClassification =
  | { provider: "GEMINI"; resolvedModel: string; requestedModel: string }
  | { provider: "UNSUPPORTED"; requestedModel: string; reason: "MODEL_MAPPING_NOT_FOUND" | "UNSUPPORTED_PROVIDER"; message: string };

// Non-Gemini provider names this system recognizes by identity but has no
// configured, evidenced execution mapping for today (no credential and/or no
// verified model-id mapping wired to real generation). Recognized so the
// failure can name the provider precisely instead of a generic catch-all.
const RECOGNIZED_UNCONFIGURED_PROVIDERS = new Set([
  "claude", "anthropic",
  "deepseek",
  "hermes",
  "perplexity", "sonar",
  "chatgpt", "openai", "gpt", "gpt-4", "gpt-4o", "gpt-5", "o3",
]);

export function classifyModelRequest(model?: string): ModelRouteClassification {
  const requestedModel = (model && String(model).trim().length > 0) ? String(model).trim() : "gemini-3.1-flash-lite";
  const stripped = requestedModel.toLowerCase().startsWith("models/")
    ? requestedModel.toLowerCase().slice("models/".length)
    : requestedModel.toLowerCase();

  const resolved = normalizeGeminiModel(requestedModel);

  if (resolved.toLowerCase().startsWith("gemini")) {
    return { provider: "GEMINI", resolvedModel: resolved, requestedModel };
  }

  if (RECOGNIZED_UNCONFIGURED_PROVIDERS.has(stripped)) {
    return {
      provider: "UNSUPPORTED",
      requestedModel,
      reason: "MODEL_MAPPING_NOT_FOUND",
      message: `Model "${requestedModel}" names a recognized provider, but no configured execution mapping (credential and/or model ID) exists for it in this deployment. It was not routed to any provider.`,
    };
  }

  return {
    provider: "UNSUPPORTED",
    requestedModel,
    reason: "UNSUPPORTED_PROVIDER",
    message: `Model "${requestedModel}" is not a recognized provider identifier.`,
  };
}

// ---------------------------------------------------------------------------
// Failover — Pass X follow-up (Jarvis routing stabilization).
//
// Both real generateContent() call sites in this app (/api/generate and
// /api/jarvis/command) hit exactly one real provider today: Gemini.
// classifyModelRequest() above already refuses to silently substitute a
// different provider, and RECOGNIZED_UNCONFIGURED_PROVIDERS documents that
// Claude/DeepSeek/Hermes/OpenAI have no configured execution mapping in this
// deployment — so "fallback" here can only ever mean a different Gemini
// *model*, never a different Gemini *provider*. This module does not invent
// a cross-provider fallback chain; it retries and falls back only across
// models the caller explicitly supplies (normally [requested model, ...
// DEFAULT_CANDIDATE_MODELS]).
//
// Kept side-effect-free and SDK-free by design (same reason as the rest of
// this file — importable in tests without triggering server.ts's
// self-executing startServer()): the actual GoogleGenAI call is injected as
// `callModel`, so every code path here is testable with a fake that throws
// specific errors on command, no real network and no real Gemini uptime
// required.
// ---------------------------------------------------------------------------

export type ErrorRetryClassification = "RETRYABLE" | "NON_RETRYABLE";

export interface ProviderErrorClassification {
  classification: ErrorRetryClassification;
  httpStatus: number | null;
  reason: string;
}

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);

// Non-retryable checked first (below) so an ambiguous message like
// "unavailable due to invalid credentials" cannot fall through as
// retryable — see classifyProviderError's ordering.
const NON_RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /invalid[^a-z]{0,20}api[^a-z]{0,5}key/i,
  /api[^a-z]{0,5}key[^a-z]{0,20}invalid/i,
  /\bunauthorized\b/i,
  /permission[^a-z]{0,5}denied/i,
  /\bforbidden\b/i,
  /invalid[^a-z]{0,5}argument/i,
  /\bmalformed\b/i,
  /\bSAFETY\b/,
  /\bBLOCKED\b/,
  /PROHIBITED_CONTENT/i,
  /INVALID_ARGUMENT/,
];

const RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /\bUNAVAILABLE\b/,
  /\bRESOURCE_EXHAUSTED\b/,
  /\boverloaded\b/i,
  /high demand/i,
  /rate[^a-z]{0,5}limit/i,
  /temporarily unavailable/i,
  /\btimed?[^a-z]{0,5}out\b/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /socket hang up/i,
  /network error/i,
  /fetch failed/i,
];

function extractHttpStatus(err: unknown): number | null {
  const e = err as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    e?.status,
    e?.code,
    e?.httpStatus,
    e?.statusCode,
    (e?.response as Record<string, unknown> | undefined)?.status,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && c >= 100 && c < 600) return c;
    if (typeof c === "string" && /^\d{3}$/.test(c)) return Number(c);
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const jsonCodeMatch = message.match(/"code"\s*:\s*(\d{3})/);
  if (jsonCodeMatch) return Number(jsonCodeMatch[1]);
  const bareMatch = message.match(/\b(429|500|502|503|504|400|401|403|404|422)\b/);
  if (bareMatch) return Number(bareMatch[1]);
  return null;
}

// Real Gemini API errors observed in this deployment arrive as an Error
// whose `.message` is the raw REST error body, e.g.
// `{"error":{"code":503,"message":"...high demand...","status":"UNAVAILABLE"}}`.
// This classifies by real HTTP status when one is present, then by known
// retryable/non-retryable message patterns, and only defaults an unmatched
// shape to a single bounded retry (never to unlimited retries, and never to
// silently treating an unrecognized failure as success).
export function classifyProviderError(err: unknown): ProviderErrorClassification {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err ?? {});
  const httpStatus = extractHttpStatus(err);

  if (httpStatus !== null) {
    if (RETRYABLE_HTTP_STATUSES.has(httpStatus)) {
      return { classification: "RETRYABLE", httpStatus, reason: `HTTP ${httpStatus}` };
    }
    if (NON_RETRYABLE_HTTP_STATUSES.has(httpStatus)) {
      return { classification: "NON_RETRYABLE", httpStatus, reason: `HTTP ${httpStatus}` };
    }
  }

  for (const pattern of NON_RETRYABLE_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return { classification: "NON_RETRYABLE", httpStatus, reason: `Non-retryable pattern matched (${pattern.source})` };
    }
  }

  for (const pattern of RETRYABLE_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return { classification: "RETRYABLE", httpStatus, reason: `Retryable pattern matched (${pattern.source})` };
    }
  }

  return { classification: "RETRYABLE", httpStatus, reason: "Unrecognized error shape — defaulting to one bounded retry" };
}

// ---------------------------------------------------------------------------
// Minimal in-memory circuit breaker, per model, process-lifetime. Not a new
// architectural layer — a small guard so a known-down model isn't hammered
// on every incoming request while it's failing. Opens after
// CIRCUIT_FAILURE_THRESHOLD consecutive failures, auto-recovers after
// CIRCUIT_COOLDOWN_MS (half-open: the next request is allowed to try again;
// success resets the count, failure re-opens the cooldown window).
// ---------------------------------------------------------------------------

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

interface CircuitBreakerState {
  consecutiveFailures: number;
  openUntil: number | null;
}

const circuitBreakerState = new Map<string, CircuitBreakerState>();

/** Test-only: clears all in-memory circuit-breaker state between test cases. */
export function resetFailoverCircuitBreakers(): void {
  circuitBreakerState.clear();
}

function isCircuitOpen(model: string, now: number): boolean {
  const state = circuitBreakerState.get(model);
  if (!state || state.openUntil === null) return false;
  return now < state.openUntil;
}

function recordCircuitFailure(model: string, now: number): void {
  const state = circuitBreakerState.get(model) ?? { consecutiveFailures: 0, openUntil: null };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = now + CIRCUIT_COOLDOWN_MS;
  }
  circuitBreakerState.set(model, state);
}

function recordCircuitSuccess(model: string): void {
  circuitBreakerState.set(model, { consecutiveFailures: 0, openUntil: null });
}

export interface FailoverAttemptLog {
  model: string;
  attempt: number;
  outcome: "SUCCESS" | "RETRYABLE_FAILURE" | "NON_RETRYABLE_FAILURE" | "CIRCUIT_OPEN_SKIPPED";
  errorMessage?: string;
}

export interface FailoverResult {
  success: boolean;
  text?: string;
  requestedModel: string;
  modelUsed: string | null;
  fallbackUsed: boolean;
  attempts: FailoverAttemptLog[];
  finalError?: string;
}

export interface FailoverOptions {
  /** Extra retries on the SAME model after a retryable failure, before moving to the next candidate. Default 1 (= 2 total attempts per model). */
  maxRetriesPerModel?: number;
  /** Base backoff delay in ms; doubles per retry (bounded by maxRetriesPerModel). Default 200. */
  baseDelayMs?: number;
  /** Injectable clock, for deterministic circuit-breaker tests. Default Date.now. */
  now?: () => number;
  /** Injectable sleep, so tests don't actually wait out real backoff delays. Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Bounded retry + model-level failover, no cross-provider fallback (none is
 * configured in this deployment — see module header). Never loops
 * indefinitely: total real calls <= candidateModels.length * (maxRetriesPerModel + 1).
 * Never fabricates a success — returns success:false with the real last
 * error when every candidate is exhausted.
 */
export async function generateWithFailover(
  candidateModels: string[],
  callModel: (model: string) => Promise<string>,
  opts: FailoverOptions = {}
): Promise<FailoverResult> {
  const dedupedCandidates = candidateModels.filter((m, i, a) => !!m && a.indexOf(m) === i);
  const requestedModel = dedupedCandidates[0] ?? "";
  const maxRetriesPerModel = opts.maxRetriesPerModel ?? 1;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attempts: FailoverAttemptLog[] = [];
  let finalError: string | undefined;

  for (const model of dedupedCandidates) {
    if (isCircuitOpen(model, now())) {
      attempts.push({ model, attempt: 0, outcome: "CIRCUIT_OPEN_SKIPPED", errorMessage: "Circuit open after repeated recent failures; skipped without a real call." });
      continue;
    }

    const totalAttemptsForModel = maxRetriesPerModel + 1;
    for (let attemptNum = 1; attemptNum <= totalAttemptsForModel; attemptNum++) {
      try {
        const text = await callModel(model);
        recordCircuitSuccess(model);
        attempts.push({ model, attempt: attemptNum, outcome: "SUCCESS" });
        return {
          success: true,
          text,
          requestedModel,
          modelUsed: model,
          fallbackUsed: model !== requestedModel,
          attempts,
        };
      } catch (err) {
        const { classification, reason } = classifyProviderError(err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        finalError = errorMessage;
        recordCircuitFailure(model, now());

        if (classification === "NON_RETRYABLE") {
          attempts.push({ model, attempt: attemptNum, outcome: "NON_RETRYABLE_FAILURE", errorMessage: `${reason}: ${errorMessage}` });
          break; // do not retry a non-retryable failure — move to the next candidate model
        }

        attempts.push({ model, attempt: attemptNum, outcome: "RETRYABLE_FAILURE", errorMessage });

        if (attemptNum < totalAttemptsForModel) {
          await sleep(baseDelayMs * Math.pow(2, attemptNum - 1));
        }
      }
    }
  }

  return {
    success: false,
    requestedModel,
    modelUsed: null,
    fallbackUsed: false,
    attempts,
    finalError: finalError ?? "No candidate models were available to try.",
  };
}
