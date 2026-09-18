// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — the one real OpenAI call mechanics.
//
// Deliberately the EXACT counterpart of lib/fabric/model-gemini.ts: same
// parameter shape, same result shape, same never-throws contract, same
// narrowness. It makes the real provider call against an already-built
// prompt and reports what happened. It knows nothing about tasks,
// artifacts, Aegis, receipts, agent personas, graphs or Jarvis — its
// caller (lib/fabric/kernel.ts) owns all of that, and owns it identically
// for both providers.
//
// WHY A PLAIN fetch AND NOT THE OPENAI SDK
//
// This repo has no OpenAI SDK dependency, and server.ts's existing OpenAI
// TTS call (POST /api/voice/speak, provider=openai) is already a plain
// fetch against api.openai.com. Adding a dependency to make one HTTP POST
// would be a second way to do something this codebase already does one
// way. Same reasoning lib/windmill-client.ts and lib/mcp-client.ts applied.
//
// WHICH API
//
// POST /v1/responses — OpenAI's current production generation endpoint.
// The Assistants API was sunset 2026-08-26 and Chat Completions is the
// superseded path; Responses is what a new integration is supposed to
// target.
//
// CREDENTIAL HANDLING
//
// The key arrives as a parameter, resolved server-side by the caller. It is
// never read from process.env here, never logged, never returned, and never
// placed in any object this module produces. Provider error strings are
// scrubbed of key-shaped tokens before they leave — the same defense
// lib/model-credentials.ts's verifyModelCredential already applies, because
// a provider error can echo a key back in a header or URL dump.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;

/** Bound what a provider can make this process hold in memory from one response. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

import { scrubSecrets as sharedScrubSecrets } from '../redact';
import { guardedPaidCall, normalizeOpenAiUsage } from '../spend/guard';
import { outputCeiling, requestKey, type SpendContext } from '../spend/adapters';
import { openAiTermination, type ProviderTermination } from './output-contract';
import { resolveRegistryEndpoint } from '../registry/endpoint-resolver';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Where OpenAI requests go — resolved by the ONE endpoint authority
 * (lib/registry/endpoints.ts) against the OpenAI provider manifest. An
 * override (OPENAI_BASE_URL) to an unapproved host throws: it fails closed
 * rather than silently using the default and sending the key elsewhere.
 */
export function resolveOpenAiBaseUrl(): string {
  const r = resolveRegistryEndpoint('openai');
  if (!r.ok) throw new Error(r.reason);
  return r.baseUrl;
}

export interface GenerateViaOpenAiParams {
  /** Role-separated input items (Responses API). When set, `contents` is not sent. */
  input?: Array<{ role: string; content: string }>;
  apiKey: string;
  contents: string;
  candidateModels: string[];
  /** Bounds one provider call. Never unbounded — a hung provider must not hold an HTTP request open forever. */
  timeoutMs?: number;
  /**
   * SPEND GUARD — required. Every OpenAI generation is a paid call and runs
   * through lib/spend/guard.ts: budgets, ceilings, idempotency and the
   * one-request permit. There is no unguarded variant.
   */
  spend: SpendContext;
  /** Registry-resolved base URL. Absent → resolved for the `openai` provider. */
  baseUrl?: string;
  /** Registry provider id (a provider reusing this protocol). Defaults to `openai`. */
  providerId?: string;
}

/**
 * Deliberately field-for-field comparable to GenerateViaGeminiResult, so
 * kernel.ts can treat the two providers as one shape. `providerUsageMetadata`
 * holds whatever the provider really reported (OpenAI's `usage` object) —
 * never a computed or estimated token count.
 */
export interface GenerateViaOpenAiResult {
  output: string;
  modelUsed: string | null;
  providerUsageMetadata: any;
  hadProviderError: boolean;
  lastProviderError: string | null;
  /** Real wall-clock duration of the successful call, or of the last attempt when all failed. */
  latencyMs: number | null;
  /** How the provider says the response ended (Responses API status / incomplete_details). */
  termination?: ProviderTermination;
  /** The spend-guard outcome. `blocked` means nothing was sent. */
  spendGuard?: { usageId: string; status: string; blocked: boolean; code?: string; estimatedCostUsd: number | null };
}

/** A provider error can echo the key back. Never let a key-shaped token reach a log or a response. */
// Delegates to the one shared scrubber (lib/redact.ts). This used to be its
// own implementation knowing only `sk-` keys plus a 40-character generic
// floor, which let a ~39-character Google key through untouched. Re-exported
// under the same name so every existing caller is unchanged.
export function scrubSecrets(raw: string): string {
  return sharedScrubSecrets(raw);
}

async function readBounded(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_RESPONSE_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8').slice(0, MAX_RESPONSE_BYTES);
}

/**
 * Pull the assistant text out of a Responses API payload.
 *
 * `output_text` is the documented convenience field; the `output[]` walk is
 * the fallback for a response shape that carries content parts instead.
 * Returns '' when there genuinely is no text — an empty string is reported
 * honestly as "no output", never padded with a placeholder.
 */
export function extractOpenAiText(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  const parts: string[] = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string') parts.push(content.text);
      else if (typeof content?.text?.value === 'string') parts.push(content.text.value);
    }
  }
  return parts.join('').trim();
}

/**
 * Real OpenAI generation across a candidate-model list, first usable text
 * wins. Never throws: every per-candidate and outer error is caught and
 * reported through hadProviderError/lastProviderError, exactly like
 * generateViaGemini — so the kernel's single error-handling path works
 * unchanged for both providers.
 *
 * NOTE ON PARAMETERS: no `temperature` or `top_p` is sent. GPT-6 Astra
 * rejects custom values for both, and a sampling parameter this product has
 * no opinion about is not worth a 400 from the frontier model.
 */
export async function generateViaOpenAI(params: GenerateViaOpenAiParams): Promise<GenerateViaOpenAiResult> {
  const { apiKey, contents } = params;
  const inputBody: unknown = params.input ?? contents;
  const inputChars = params.input ? JSON.stringify(params.input).length : contents.length;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const providerId = params.providerId || 'openai';
  let baseUrl: string;
  try {
    baseUrl = params.baseUrl || resolveOpenAiBaseUrl();
  } catch (e: any) {
    // Endpoint refused before any credential or body left the process.
    return { output: '', modelUsed: null, providerUsageMetadata: null, hadProviderError: true, lastProviderError: `ENDPOINT_NOT_APPROVED: ${e?.message || e}`, latencyMs: null };
  }
  // NO_PAID_FALLBACK: exactly one model per logical call. A candidate list is
  // accepted for signature compatibility, but only its first entry is tried —
  // silently moving to another (possibly more expensive) model is refused.
  const m = params.candidateModels[0];
  const maxOutputTokens = outputCeiling(params.spend);

  let output = '';
  let modelUsed: string | null = null;
  let providerUsageMetadata: any = null;
  let hadProviderError = false;
  let lastProviderError: string | null = null;
  let latencyMs: number | null = null;
  let termination: ProviderTermination = { status: 'NOT_REPORTED', providerStatus: null, reason: null };

  if (!m) {
    return { output, modelUsed, providerUsageMetadata, hadProviderError: true, lastProviderError: 'No model was selected for this OpenAI call.', latencyMs };
  }

  let guard: GenerateViaOpenAiResult['spendGuard'];
  try {
    const r = await guardedPaidCall({
      provider: providerId, model: m, callSite: params.spend.callSite,
      workspaceId: params.spend.workspaceId ?? null, taskId: params.spend.taskId ?? null, correlationId: params.spend.correlationId ?? null,
      idempotencyKey: params.spend.idempotencyKey || requestKey(params.spend.callSite),
      inputChars, maxOutputTokens, approvalId: params.spend.approvalId ?? null,
    }, async () => {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/responses`, {
          method: 'POST',
          // A redirect could carry the Authorization header to another host.
          redirect: 'error',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          // max_output_tokens is sent, so the output bound is enforced by the
          // provider rather than assumed by us.
          body: JSON.stringify({ model: m, input: inputBody, max_output_tokens: maxOutputTokens }),
          signal: controller.signal,
        });

        const bodyText = await readBounded(res);
        latencyMs = Date.now() - startedAt;

        if (!res.ok) {
          let detail = bodyText.slice(0, 300);
          try {
            const parsed = JSON.parse(bodyText);
            detail = parsed?.error?.message || detail;
          } catch { /* non-JSON error body — use the raw excerpt */ }
          lastProviderError = scrubSecrets(`OpenAI HTTP ${res.status}: ${detail}`);
          return { ok: false };
        }

        let payload: any;
        try {
          payload = JSON.parse(bodyText);
        } catch {
          lastProviderError = 'OpenAI returned a response that was not valid JSON.';
          return { ok: false };
        }

        if (payload?.usage) providerUsageMetadata = payload.usage;
        termination = openAiTermination(payload, maxOutputTokens);
        const usage = normalizeOpenAiUsage(payload?.usage, typeof payload?.id === 'string' ? payload.id : null);
        const text = extractOpenAiText(payload);
        if (text && text.trim().length > 0) {
          output = text;
          // The model the PROVIDER says it ran, not the one we asked for.
          // These differ whenever an alias resolves to a dated snapshot, and
          // the receipt must attest to what actually executed.
          modelUsed = typeof payload?.model === 'string' && payload.model.trim() ? payload.model : m;
          return { ok: true, usage, termination: `${termination.status}${termination.providerStatus ? `:${termination.providerStatus}` : ''}${termination.reason ? `:${termination.reason}` : ''}` };
        }
        // A 200 with no text is a real outcome, not a silent success.
        lastProviderError = `OpenAI model "${m}" returned a successful response containing no text.`;
        return { ok: false, usage };
      } catch (e: any) {
        latencyMs = Date.now() - startedAt;
        const timedOut = e?.name === 'AbortError';
        lastProviderError = timedOut
          ? `OpenAI request to "${m}" timed out after ${timeoutMs}ms.`
          : scrubSecrets(e?.message || String(e));
        return { ok: false, failureHint: timedOut ? 'TIMEOUT' : null };
      } finally {
        clearTimeout(timer);
      }
    });

    if (!r.permitted) {
      lastProviderError = `BLOCKED_BUDGET (${r.code}): ${r.reason}`;
      guard = { usageId: r.usageId, status: 'BLOCKED', blocked: true, code: r.code, estimatedCostUsd: r.estimatedCostUsd };
    } else {
      guard = { usageId: r.usageId, status: r.status, blocked: false, estimatedCostUsd: r.estimatedCostUsd };
    }
  } catch (outerErr: any) {
    lastProviderError = scrubSecrets(outerErr?.message || String(outerErr));
  }

  hadProviderError = !output;
  if (hadProviderError && lastProviderError) console.warn('[OpenAI]', lastProviderError);
  return { output, modelUsed, providerUsageMetadata, hadProviderError, lastProviderError, latencyMs, termination, spendGuard: guard };
}
