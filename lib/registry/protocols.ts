// ---------------------------------------------------------------------------
// PROTOCOL ADAPTERS — the shared adapter contract.
//
// A provider plugin is a manifest (data) that names ONE protocol. The protocol
// adapter is code, shared by every provider that speaks it: a DeepSeek-style
// provider reuses `openai.chat_completions` with its own manifest, hosts and
// credential slot, and needs no branch anywhere else — not in the router, the
// task system, the spend guard, Guardian, the ledger or receipts.
//
// Every adapter normalizes termination, usage and errors into the canonical
// shapes (ProviderTermination, NormalizedUsage, a scrubbed string). Adapters
// that can dispatch do so ONLY through the spend guard; none retries or falls
// back to another model.
// ---------------------------------------------------------------------------

import { approvedSubstance, verifyRuntimeResolves, recordSubstanceChange } from './substance';
import { geminiTermination, openAiTermination, type ProviderTermination } from '../fabric/output-contract';
import { normalizeGeminiUsage, normalizeOpenAiUsage, guardedPaidCall, type NormalizedUsage } from '../spend/guard';
import { outputCeiling, requestKey, type SpendContext } from '../spend/adapters';
import { scrubSecrets } from '../redact';
import type { ProtocolId } from './types';
import { getStoredProvider } from './store';

export const PROTOCOL_ADAPTER_VERSION = '1.0.0';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface ModelCallParams {
  providerId: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  /** Single-turn prompt. Ignored when `messages` is given. */
  contents: string;
  /**
   * Multi-turn input with ROLE SEPARATION preserved (system / user /
   * assistant are never flattened into one string — that separation is a
   * prompt-injection guard for conversation history).
   */
  messages?: ChatMessage[];
  /** Ask the provider for a JSON object response where it supports that. */
  responseFormat?: 'json';
  /** Provider-side tools. Only adapters that declare a tool may be sent it. */
  tools?: Array<'web_search'>;
  spend: SpendContext;
  timeoutMs?: number;
}

/** Characters actually sent — what the spend guard prices and the network guard re-checks. */
export function inputCharsOf(p: Pick<ModelCallParams, 'contents' | 'messages'>): number {
  return p.messages ? p.messages.reduce((n, m) => n + m.content.length, 0) : p.contents.length;
}

export interface ModelCallResult {
  output: string;
  modelUsed: string | null;
  providerUsageMetadata: any;
  hadProviderError: boolean;
  lastProviderError: string | null;
  spendBlockedCode?: string | null;
  termination?: ProviderTermination;
  latencyMs?: number | null;
  /** The provider's own payload (e.g. Gemini grounding metadata). Never placed in a prompt. */
  raw?: unknown;
}

export interface ProtocolAdapter {
  protocol: ProtocolId;
  adapterVersion: string;
  /** MODEL_CALL: dispatchable here. EXTERNAL_RUNTIME: dispatched by the external-execution ledger. NONE: normalization only in this build. */
  dispatch: 'MODEL_CALL' | 'EXTERNAL_RUNTIME' | 'NONE';
  /** The request parameters this adapter sends. Nothing else reaches the provider. */
  requestParameters: string[];
  normalizeTermination(payload: unknown, maxOutputTokens: number | null): ProviderTermination;
  normalizeUsage(payload: unknown): NormalizedUsage;
  normalizeError(httpStatus: number | null, body: string): string;
  extractText(payload: unknown): string;
  call?(p: ModelCallParams): Promise<ModelCallResult>;
  /** Provider-side tools this adapter can send. */
  tools?: Array<'web_search'>;
}

const NOT_REPORTED: ProviderTermination = { status: 'NOT_REPORTED', providerStatus: null, reason: null };

function errorFrom(label: string) {
  return (httpStatus: number | null, body: string): string => {
    let detail = String(body || '').slice(0, 300);
    try { const p = JSON.parse(body); detail = p?.error?.message || p?.message || detail; } catch { /* raw excerpt */ }
    return scrubSecrets(`${label}${httpStatus ? ` HTTP ${httpStatus}` : ''}: ${detail}`);
  };
}

// ---- OpenAI Responses ------------------------------------------------------
async function openAiResponsesCall(p: ModelCallParams): Promise<ModelCallResult> {
  const { generateViaOpenAI } = await import('../fabric/model-openai');
  // Responses API: roles travel as input items (system → "developer").
  const input = p.messages ? p.messages.map((m) => ({ role: m.role === 'system' ? 'developer' : m.role, content: m.content })) : undefined;
  return generateViaOpenAI({ apiKey: p.apiKey, contents: p.contents, input, candidateModels: [p.modelId], spend: { ...p.spend, providerId: p.providerId }, baseUrl: p.baseUrl, providerId: p.providerId, timeoutMs: p.timeoutMs });
}

// ---- Gemini generateContent -----------------------------------------------
async function geminiCall(p: ModelCallParams): Promise<ModelCallResult> {
  const { generateViaGemini } = await import('../fabric/model-gemini');
  const system = p.messages?.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = p.messages
    ? p.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    : p.contents;
  const config: Record<string, unknown> = {};
  if (system) config.systemInstruction = system;
  if (p.responseFormat === 'json') config.responseMimeType = 'application/json';
  if (p.tools?.includes('web_search')) config.tools = [{ googleSearch: {} }];
  return generateViaGemini({ apiKey: p.apiKey, contents, config, candidateModels: [p.modelId], spend: { ...p.spend, providerId: p.providerId }, baseUrl: p.baseUrl });
}

// ---- OpenAI-compatible chat completions (DeepSeek-style providers) --------
export function chatCompletionsTermination(payload: any, maxOutputTokens: number | null): ProviderTermination {
  const reason = payload?.choices?.[0]?.finish_reason;
  if (typeof reason !== 'string') return NOT_REPORTED;
  if (reason === 'stop') return { status: 'COMPLETE', providerStatus: reason, reason: null };
  if (reason === 'length') return { status: 'INCOMPLETE', providerStatus: reason, reason: maxOutputTokens ? `OUTPUT_CAP_${maxOutputTokens}` : 'OUTPUT_CAP' };
  return { status: 'INCOMPLETE', providerStatus: reason, reason };
}

export function chatCompletionsUsage(payload: any): NormalizedUsage {
  const u = payload?.usage;
  if (!u || typeof u !== 'object') return { providerRequestId: typeof payload?.id === 'string' ? payload.id : null };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    inputTokens: n(u.prompt_tokens), outputTokens: n(u.completion_tokens),
    cachedTokens: n(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens),
    reasoningTokens: n(u.completion_tokens_details?.reasoning_tokens),
    totalTokens: n(u.total_tokens), providerRequestId: typeof payload?.id === 'string' ? payload.id : null,
  };
}

function chatText(payload: any): string {
  const c = payload?.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

function idempotencyHeader(providerId: string): string | null {
  try { return getStoredProvider(providerId)?.manifest.provider.idempotency?.header ?? null; } catch { return null; }
}

async function chatCompletionsCall(p: ModelCallParams): Promise<ModelCallResult> {
  const maxOutputTokens = outputCeiling(p.spend);
  const timeoutMs = p.timeoutMs ?? 60_000;
  const out: ModelCallResult = { output: '', modelUsed: null, providerUsageMetadata: null, hadProviderError: false, lastProviderError: null, termination: NOT_REPORTED, latencyMs: null };
  // LOCAL routes: before anything is sent, the running runtime must resolve
  // the tag to the approved manifest digest (metadata GET; no inference).
  const localSub = (() => { try { return (getStoredProvider(p.providerId)?.manifest.provider.routeKind ?? 'DIRECT') === 'LOCAL' ? approvedSubstance(p.providerId, p.modelId) : null; } catch { return null; } })();
  if (localSub) {
    const live = await verifyRuntimeResolves(p.baseUrl, localSub.substance);
    if (!live.ok) {
      // A different digest is a changed model (recorded; qualifications invalidated).
      // An unreachable runtime is not: the call is refused, nothing is invalidated.
      if (live.kind === 'MISMATCH') recordSubstanceChange(p.providerId, p.modelId, localSub.hash, `runtime:${live.reason.slice(0, 80)}`, [`runtime: ${live.reason}`], null);
      const code = live.kind === 'MISMATCH' ? 'MODEL_SUBSTANCE_CHANGED' : 'LOCAL_RUNTIME_UNVERIFIED';
      out.hadProviderError = true;
      out.spendBlockedCode = code;
      out.lastProviderError = `BLOCKED_BUDGET (${code}): the running local runtime could not be confirmed to serve the approved ${p.modelId} (${live.reason}); nothing was sent.`;
      return out;
    }
  }
  const r = await guardedPaidCall({
    provider: p.providerId, model: p.modelId, callSite: p.spend.callSite,
    workspaceId: p.spend.workspaceId ?? null, taskId: p.spend.taskId ?? null, correlationId: p.spend.correlationId ?? null,
    idempotencyKey: p.spend.idempotencyKey || requestKey(p.spend.callSite),
    inputChars: inputCharsOf(p), maxOutputTokens, approvalId: p.spend.approvalId ?? null,
  }, async () => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          // A credential-free route (a local runtime) sends no Authorization header at all.
          ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
          'Content-Type': 'application/json',
          // Provider-supported idempotency (manifest-declared): the SAME key the
          // spend ledger holds, so an ambiguous outcome can be looked up rather than re-sent.
          ...(idempotencyHeader(p.providerId) ? { [idempotencyHeader(p.providerId)!]: p.spend.idempotencyKey || '' } : {}),
        },
        body: JSON.stringify({
          model: p.modelId,
          messages: p.messages ? p.messages.map((m) => ({ role: m.role, content: m.content })) : [{ role: 'user', content: p.contents }],
          max_tokens: maxOutputTokens,
          ...(p.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      const text = (await res.text()).slice(0, 2 * 1024 * 1024);
      out.latencyMs = Date.now() - started;
      if (!res.ok) { out.lastProviderError = errorFrom(p.providerId)(res.status, text); return { ok: false }; }
      let payload: any;
      try { payload = JSON.parse(text); } catch { out.lastProviderError = `${p.providerId} returned a response that was not valid JSON.`; return { ok: false }; }
      out.providerUsageMetadata = payload?.usage ?? null;
      out.termination = chatCompletionsTermination(payload, maxOutputTokens);
      const usage = chatCompletionsUsage(payload);
      const t = chatText(payload);
      if (t.trim()) {
        out.output = t;
        out.modelUsed = typeof payload?.model === 'string' && payload.model.trim() ? payload.model : p.modelId;
        return { ok: true, usage, termination: `${out.termination!.status}:${out.termination!.providerStatus ?? ''}` };
      }
      out.lastProviderError = `${p.providerId} model "${p.modelId}" returned no text.`;
      return { ok: false, usage };
    } catch (e: any) {
      out.latencyMs = Date.now() - started;
      out.lastProviderError = e?.name === 'AbortError' ? `${p.providerId} request timed out after ${timeoutMs}ms.` : scrubSecrets(e?.message || String(e));
      return { ok: false, failureHint: e?.name === 'AbortError' ? 'TIMEOUT' : null };
    } finally {
      clearTimeout(timer);
    }
  });
  if (!r.permitted) {
    out.hadProviderError = true;
    out.lastProviderError = `BLOCKED_BUDGET (${r.code}): ${r.reason}`;
    out.spendBlockedCode = r.code;
    return out;
  }
  out.hadProviderError = !out.output;
  return out;
}

// ---- Anthropic Messages — normalization only in this build -----------------
export function anthropicTermination(payload: any, maxOutputTokens: number | null): ProviderTermination {
  const reason = payload?.stop_reason;
  if (typeof reason !== 'string') return NOT_REPORTED;
  if (reason === 'end_turn' || reason === 'stop_sequence') return { status: 'COMPLETE', providerStatus: reason, reason: null };
  if (reason === 'max_tokens') return { status: 'INCOMPLETE', providerStatus: reason, reason: maxOutputTokens ? `OUTPUT_CAP_${maxOutputTokens}` : 'OUTPUT_CAP' };
  return { status: 'INCOMPLETE', providerStatus: reason, reason };
}

export function anthropicUsage(payload: any): NormalizedUsage {
  const u = payload?.usage;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const input = n(u?.input_tokens); const output = n(u?.output_tokens);
  return {
    inputTokens: input, outputTokens: output, cachedTokens: n(u?.cache_read_input_tokens), reasoningTokens: null,
    totalTokens: input !== null && output !== null ? input + output : null, providerRequestId: typeof payload?.id === 'string' ? payload.id : null,
  };
}

function anthropicText(payload: any): string {
  return (Array.isArray(payload?.content) ? payload.content : []).filter((c: any) => c?.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('');
}

// ---- Gemini interactions (managed agent; dispatched by the external-execution ledger) ----
function interactionsTermination(payload: any): ProviderTermination {
  const s = payload?.status;
  if (s === 'completed') return { status: 'COMPLETE', providerStatus: s, reason: null };
  if (typeof s === 'string') return { status: 'INCOMPLETE', providerStatus: s, reason: s };
  return NOT_REPORTED;
}

function openAiText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) for (const c of Array.isArray(item?.content) ? item.content : []) if (typeof c?.text === 'string') parts.push(c.text);
  return parts.join('');
}

function geminiText(payload: any): string {
  if (typeof payload?.text === 'string') return payload.text;
  return (payload?.candidates?.[0]?.content?.parts || []).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

export const PROTOCOL_ADAPTERS: Record<ProtocolId, ProtocolAdapter> = {
  'openai.responses': {
    protocol: 'openai.responses', adapterVersion: PROTOCOL_ADAPTER_VERSION, dispatch: 'MODEL_CALL',
    requestParameters: ['model', 'input', 'max_output_tokens'],
    normalizeTermination: (p, m) => openAiTermination(p, m),
    normalizeUsage: (p: any) => normalizeOpenAiUsage(p?.usage, typeof p?.id === 'string' ? p.id : null) ?? {},
    normalizeError: errorFrom('OpenAI-protocol'),
    extractText: openAiText,
    call: openAiResponsesCall,
  },
  'gemini.generate_content': {
    protocol: 'gemini.generate_content', adapterVersion: PROTOCOL_ADAPTER_VERSION, dispatch: 'MODEL_CALL',
    requestParameters: ['model', 'contents', 'generationConfig.maxOutputTokens', 'generationConfig.temperature'],
    normalizeTermination: (p, m) => geminiTermination(p, m),
    normalizeUsage: (p: any) => normalizeGeminiUsage(p?.usageMetadata, p?.responseId ?? null) ?? {},
    normalizeError: errorFrom('Gemini-protocol'),
    extractText: geminiText,
    call: geminiCall,
    tools: ['web_search'],
  },
  'openai.chat_completions': {
    protocol: 'openai.chat_completions', adapterVersion: PROTOCOL_ADAPTER_VERSION, dispatch: 'MODEL_CALL',
    requestParameters: ['model', 'messages', 'max_tokens'],
    normalizeTermination: chatCompletionsTermination,
    normalizeUsage: chatCompletionsUsage,
    normalizeError: errorFrom('Chat-completions-protocol'),
    extractText: chatText,
    call: chatCompletionsCall,
  },
  'anthropic.messages': {
    protocol: 'anthropic.messages', adapterVersion: PROTOCOL_ADAPTER_VERSION, dispatch: 'NONE',
    requestParameters: ['model', 'messages', 'max_tokens'],
    normalizeTermination: anthropicTermination,
    normalizeUsage: anthropicUsage,
    normalizeError: errorFrom('Anthropic-protocol'),
    extractText: anthropicText,
  },
  'gemini.interactions': {
    protocol: 'gemini.interactions', adapterVersion: PROTOCOL_ADAPTER_VERSION, dispatch: 'EXTERNAL_RUNTIME',
    requestParameters: ['agent', 'input', 'agent_config.max_total_tokens'],
    normalizeTermination: (p) => interactionsTermination(p),
    normalizeUsage: (p: any) => normalizeGeminiUsage(p?.usage, p?.id ?? null) ?? {},
    normalizeError: errorFrom('Interactions-protocol'),
    extractText: (p: any) => (typeof p?.output_text === 'string' ? p.output_text : ''),
  },
};

export function getProtocolAdapter(protocol: string): ProtocolAdapter | null {
  return (PROTOCOL_ADAPTERS as Record<string, ProtocolAdapter>)[protocol] ?? null;
}
