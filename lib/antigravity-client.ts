// ---------------------------------------------------------------------------
// Google Antigravity execution-runtime client.
//
// WHAT ANTIGRAVITY IS HERE, AND WHAT IT IS NOT
//
// Antigravity is an EXECUTION WORKER. It runs an agent loop — code
// execution, file manipulation, web search — inside a Linux sandbox hosted
// by Google, and returns what it produced. It is not a control plane, it
// does not decide what SynthOS runs, and nothing it returns is trusted as
// authoritative: its output enters SynthOS exactly like a Windmill job's
// does, through the same task -> artifact -> Aegis -> receipt spine, and is
// only ever committed if SynthOS's own verifier passes it.
//
// WHY THE MANAGED API AND NOT THE IDE
//
// Antigravity ships three surfaces: a desktop IDE, a Go CLI, and a Python
// SDK — plus the managed cloud API this file targets
// (generativelanguage.googleapis.com, the same host and the same
// GEMINI_API_KEY credential this deployment already holds for Gemini).
// Automating the IDE was explicitly rejected: a real HTTP contract exists,
// and driving a GUI would be a fragile, unobservable substitute for it.
// The Python SDK and Go CLI would both mean a second language runtime and
// a subprocess boundary for something that is one authenticated POST.
//
// Real endpoints, grounded in Google's published Gemini Agents API, not
// guessed paths:
//   POST /v1beta/interactions            — start an interaction, returns id + status
//   GET  /v1beta/interactions/{id}       — poll one interaction's real status/output
//
// CONFIGURED NEVER MEANS CONNECTED (the same non-negotiable rule
// lib/windmill-client.ts and lib/mcp-client.ts follow): every function
// below either makes a real network call and reports its real outcome, or
// returns NOT_CONFIGURED without ever touching the network. The API key is
// read from the existing server-side credential resolution only, is never
// logged, and is never included in any returned object.
// ---------------------------------------------------------------------------

import { resolveModelApiKey, resolveRuntimeCredential } from './model-credentials';
import { resolvePlatformSetting } from './platform-settings';
import { scrubSecrets as sharedScrubSecrets } from './redact';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Health probes run on GET /api/ready and the Master Admin runtime panel,
 * which are polled. They get a much tighter bound than an execution call —
 * a readiness endpoint must never hang for half a minute because one
 * optional integration is unreachable. Matches lib/windmill-client.ts's
 * 8s posture for the same reason.
 */
const HEALTH_TIMEOUT_MS = 8_000;

/** Bound what one remote interaction can make this process hold in memory. */
export const MAX_INTERACTION_RESULT_BYTES = 512 * 1024;

/** Bound the instruction we are willing to send outward. */
export const MAX_INSTRUCTION_BYTES = 64 * 1024;

export const ANTIGRAVITY_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * The managed agent id. Configurable because Google versions these by date
 * and retires them; a frozen literal is how this file goes quietly stale.
 */
export const ANTIGRAVITY_DEFAULT_AGENT = 'antigravity-preview-05-2026';

export function resolveAntigravityBaseUrl(): string {
  const configured = (process.env.ANTIGRAVITY_BASE_URL || '').trim();
  return (configured || ANTIGRAVITY_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function resolveAntigravityAgent(): string {
  const configured = (process.env.ANTIGRAVITY_AGENT || '').trim();
  return configured || ANTIGRAVITY_DEFAULT_AGENT;
}

/**
 * Antigravity authenticates with the same Google credential this deployment
 * already holds for Gemini, resolved through the same server-side store —
 * not a second key, and not a second credential mechanism.
 * ANTIGRAVITY_API_KEY exists only for a deployment that wants to bill or
 * scope agent execution separately from ordinary generation.
 */
export type AntigravityKeySource = 'antigravity_env' | 'antigravity_store' | 'gemini_credential' | 'none';

/**
 * Order: a dedicated Antigravity key (environment, then the encrypted store an
 * operator fills from the Admin), then the Gemini credential. The Gemini
 * fallback is real, not cosmetic: this adapter authenticates to the same
 * Google endpoint with the same key type. It proves only that a key resolves —
 * not that the key has access to the managed-agent API. Only a live run
 * proves that.
 */
export function resolveAntigravityApiKey(): { apiKey: string; source: AntigravityKeySource } {
  const dedicated = resolveRuntimeCredential('antigravity');
  if (dedicated.apiKey) return { apiKey: dedicated.apiKey, source: dedicated.source === 'environment' ? 'antigravity_env' : 'antigravity_store' };
  const { apiKey } = resolveModelApiKey('gemini');
  if (apiKey) return { apiKey, source: 'gemini_credential' };
  return { apiKey: '', source: 'none' };
}

/** True only when a credential this runtime could actually authenticate with exists. Configured != connected. */
export function isAntigravityConfigured(): boolean {
  return Boolean(resolveAntigravityApiKey().apiKey);
}

/** True only when the operator has explicitly enabled outward Antigravity execution. */
/**
 * Enablement: the ANTIGRAVITY_ENABLED environment variable when set (locked),
 * otherwise the platform setting a platform_admin controls from the Admin,
 * otherwise OFF. Read on every call, so a change applies without a restart.
 */
export function describeAntigravityEnablement() {
  const r = resolvePlatformSetting('antigravity.enabled', 'false');
  return { ...r, enabled: r.value.trim().toLowerCase() === 'true' };
}

export function isAntigravityEnabled(): boolean {
  return describeAntigravityEnablement().enabled;
}

export type AntigravityConnectionStatus = 'NOT_CONFIGURED' | 'DISABLED' | 'CONNECTED' | 'FAILED' | 'INVALID_RESPONSE';

export interface AntigravityHealthResult {
  status: AntigravityConnectionStatus;
  reachable: boolean;
  authenticated: boolean;
  agent: string | null;
  latencyMs: number | null;
  error?: string;
  checkedAt: string;
}

/** An error from a provider can echo a key back in a URL or header dump. */
// Delegates to the one shared scrubber (lib/redact.ts). This used to know
// only `AIza` keys, so an OpenAI `sk-` key in an Antigravity error relied on
// the generic rule alone. Re-exported under the same name.
export function scrubSecrets(raw: string): string {
  return sharedScrubSecrets(raw);
}

function sanitize(message: string | undefined | null): string {
  if (!message) return 'Unknown error.';
  // eslint-disable-next-line no-control-regex
  return scrubSecrets(message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''));
}

async function readBounded(res: Response, maxBytes = MAX_INTERACTION_RESULT_BYTES): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(Buffer.from(value).subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      break;
    }
    chunks.push(Buffer.from(value));
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

interface RawCall {
  ok: boolean;
  httpStatus: number | null;
  payload: any;
  truncated: boolean;
  error?: string;
  latencyMs: number;
}

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<RawCall> {
  const { apiKey } = resolveAntigravityApiKey();
  const startedAt = Date.now();
  if (!apiKey) {
    return { ok: false, httpStatus: null, payload: null, truncated: false, error: 'No Antigravity credential is configured.', latencyMs: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${resolveAntigravityBaseUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, ...(init.headers || {}) },
      signal: controller.signal,
    });
    const { text, truncated } = await readBounded(res);
    const latencyMs = Date.now() - startedAt;

    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }

    if (!res.ok) {
      const detail = payload?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
      return { ok: false, httpStatus: res.status, payload, truncated, error: sanitize(detail), latencyMs };
    }
    if (payload === null) {
      return { ok: false, httpStatus: res.status, payload: null, truncated, error: 'Antigravity returned a response that was not valid JSON.', latencyMs };
    }
    return { ok: true, httpStatus: res.status, payload, truncated, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - startedAt;
    const message = err?.name === 'AbortError' ? `Antigravity request timed out after ${timeoutMs}ms.` : sanitize(err?.message || String(err));
    return { ok: false, httpStatus: null, payload: null, truncated: false, error: message, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real connectivity probe.
 *
 * There is no unauthenticated version/ping endpoint on this API, and this
 * deliberately does NOT start a real agent interaction to prove reachability
 * — that would be a billable sandbox run triggered by a status check, which
 * is exactly the kind of cost a health probe must never incur. It issues a
 * GET against a deliberately non-existent interaction id: a 404 or 400
 * proves the host is reachable AND the credential was accepted, while a 401
 * or 403 proves it was not. That distinction is the whole point of the
 * probe, and it costs nothing.
 */
export async function health(timeoutMs = HEALTH_TIMEOUT_MS): Promise<AntigravityHealthResult> {
  const checkedAt = new Date().toISOString();
  if (!isAntigravityConfigured()) {
    return { status: 'NOT_CONFIGURED', reachable: false, authenticated: false, agent: null, latencyMs: null, checkedAt, error: 'No Antigravity credential is configured (ANTIGRAVITY_API_KEY or a Gemini credential).' };
  }
  if (!isAntigravityEnabled()) {
    return { status: 'DISABLED', reachable: false, authenticated: false, agent: null, latencyMs: null, checkedAt, error: 'Antigravity is not enabled — outward Antigravity execution is switched off (Master Admin → Antigravity).' };
  }

  const probe = await call('/interactions/synthos-connectivity-probe-nonexistent', { method: 'GET' }, timeoutMs);

  if (probe.httpStatus === 401 || probe.httpStatus === 403) {
    return { status: 'FAILED', reachable: true, authenticated: false, agent: resolveAntigravityAgent(), latencyMs: probe.latencyMs, checkedAt, error: probe.error };
  }
  if (probe.httpStatus === 404 || probe.httpStatus === 400 || probe.ok) {
    return { status: 'CONNECTED', reachable: true, authenticated: true, agent: resolveAntigravityAgent(), latencyMs: probe.latencyMs, checkedAt };
  }
  if (probe.httpStatus !== null) {
    return { status: 'INVALID_RESPONSE', reachable: true, authenticated: false, agent: resolveAntigravityAgent(), latencyMs: probe.latencyMs, checkedAt, error: probe.error };
  }
  return { status: 'FAILED', reachable: false, authenticated: false, agent: resolveAntigravityAgent(), latencyMs: probe.latencyMs, checkedAt, error: probe.error };
}

export interface AntigravitySubmitResult {
  ok: boolean;
  remoteJobId: string | null;
  error?: string;
}

export function isInstructionWithinBounds(instruction: string): boolean {
  return Buffer.byteLength(String(instruction ?? ''), 'utf8') <= MAX_INSTRUCTION_BYTES;
}

/**
 * Start one real Antigravity interaction in background mode, returning the
 * remote id immediately. Background is deliberate: an agent loop that
 * compiles, tests and searches can run for minutes, and holding an inbound
 * HTTP request open for that is how a submission becomes an outage. The
 * caller polls through the same external-execution ledger every Windmill
 * job already uses.
 */
export async function submitInteraction(params: {
  instruction: string;
  agent?: string;
  /** Only tool types the operator has approved for this runtime. */
  tools?: { type: string }[];
  maxTotalTokens?: number;
  timeoutMs?: number;
}): Promise<AntigravitySubmitResult> {
  if (!isAntigravityConfigured()) return { ok: false, remoteJobId: null, error: 'No Antigravity credential is configured.' };
  if (!isAntigravityEnabled()) return { ok: false, remoteJobId: null, error: 'Antigravity is not enabled — outward Antigravity execution is switched off (Master Admin → Antigravity).' };
  if (!isInstructionWithinBounds(params.instruction)) {
    return { ok: false, remoteJobId: null, error: `Instruction exceeds the ${MAX_INSTRUCTION_BYTES}-byte bound.` };
  }

  const body: Record<string, unknown> = {
    agent: params.agent || resolveAntigravityAgent(),
    input: params.instruction,
    environment: 'remote',
    background: true,
  };
  if (params.tools && params.tools.length > 0) body.tools = params.tools;
  const agentConfig: Record<string, unknown> = { type: 'antigravity' };
  if (typeof params.maxTotalTokens === 'number') agentConfig.max_total_tokens = params.maxTotalTokens;
  body.agent_config = agentConfig;

  const res = await call('/interactions', { method: 'POST', body: JSON.stringify(body) }, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!res.ok) return { ok: false, remoteJobId: null, error: res.error };

  const id = typeof res.payload?.id === 'string' ? res.payload.id : null;
  if (!id) {
    // A 2xx with no usable id is NOT a submission. Never record one.
    return { ok: false, remoteJobId: null, error: 'Antigravity accepted the request but returned no interaction id.' };
  }
  return { ok: true, remoteJobId: id };
}

export type AntigravityRemoteState = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'REQUIRES_ACTION' | 'UNKNOWN';

export interface AntigravityStatusResult {
  ok: boolean;
  state: AntigravityRemoteState;
  rawStatus: string | null;
  error?: string;
}

/**
 * Map Antigravity's own vocabulary onto the state machine the external
 * execution ledger already speaks. An unrecognized status is UNKNOWN, never
 * optimistically read as success.
 *
 * `requires_action` is deliberately its OWN state rather than being folded
 * into RUNNING: it means the remote agent has stopped and is waiting for an
 * input SynthOS has not been asked for. Calling that "running" would leave
 * a row polling forever against something that will never move on its own.
 */
export function mapRemoteStatus(raw: unknown): AntigravityRemoteState {
  switch (String(raw || '').toLowerCase()) {
    case 'queued': return 'QUEUED';
    case 'in_progress': return 'RUNNING';
    case 'completed': return 'SUCCESS';
    case 'failed': return 'FAILURE';
    case 'incomplete': return 'FAILURE';
    case 'requires_action': return 'REQUIRES_ACTION';
    default: return 'UNKNOWN';
  }
}

export async function getInteractionStatus(remoteJobId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AntigravityStatusResult> {
  if (!isAntigravityConfigured()) return { ok: false, state: 'UNKNOWN', rawStatus: null, error: 'No Antigravity credential is configured.' };
  const res = await call(`/interactions/${encodeURIComponent(remoteJobId)}`, { method: 'GET' }, timeoutMs);
  if (!res.ok) return { ok: false, state: 'UNKNOWN', rawStatus: null, error: res.error };
  const rawStatus = typeof res.payload?.status === 'string' ? res.payload.status : null;
  return { ok: true, state: mapRemoteStatus(rawStatus), rawStatus };
}

export interface AntigravityResultPayload {
  ok: boolean;
  /** The agent's final text output. */
  outputText: string;
  /** Real reasoning/tool steps the remote agent reported, names only — never raw tool arguments. */
  stepNames: string[];
  /** Whatever the provider genuinely reported about token consumption. Never estimated. */
  usage: any;
  /** The sandbox reference, kept so a follow-up interaction can reuse the same environment. */
  environmentId: string | null;
  truncated: boolean;
  error?: string;
}

/**
 * Pull the agent's final text out of an interaction payload.
 *
 * LIVE CONTRACT CORRECTION (2026-09-14). Google's published documentation
 * describes `output_text` as the interaction's final agent output, and this
 * client was built against that. A real `completed` interaction against
 * generativelanguage.googleapis.com/v1beta carries NO `output_text` key at
 * all — the top-level keys are agent, agent_config, environment,
 * environment_id, id, object, status, steps, tools, usage. The final text is
 * inside `steps[]` where `type === 'model_output'`, under `content[].text`.
 *
 * `output_text` is still read first rather than removed: it costs nothing,
 * and if the field is reinstated or appears on another interaction shape,
 * this keeps working. The steps walk is the fallback that actually fires
 * today. Same preference order, and the same reason, as
 * lib/fabric/model-openai.ts::extractOpenAiText.
 *
 * Only `model_output` steps are read. `function_result` steps also carry
 * text — for this verification run, the literal contents of the file the
 * agent read back — but that is raw tool payload, not the agent's answer,
 * and it is deliberately not treated as output.
 */
export function extractAntigravityText(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  const parts: string[] = [];
  for (const step of Array.isArray(payload.steps) ? payload.steps : []) {
    if (step?.type !== 'model_output') continue;
    for (const content of Array.isArray(step?.content) ? step.content : []) {
      if (typeof content?.text === 'string' && content.text.trim()) parts.push(content.text);
    }
  }
  return parts.join('\n\n').trim();
}

/**
 * Read one completed interaction's real result.
 *
 * `stepNames` deliberately carries tool NAMES only. The step objects also
 * carry `arguments`, which for a coding agent routinely contain file
 * contents and command lines; persisting those into an artifact would put
 * unreviewed remote payload data into the Vault. The same reasoning
 * lib/fabric/context.ts applies to its invocation trace. The live run
 * confirmed this matters: the `write_file` step's arguments held the entire
 * file body.
 */
export async function getInteractionResult(remoteJobId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AntigravityResultPayload> {
  const empty = { outputText: '', stepNames: [] as string[], usage: null, environmentId: null, truncated: false };
  if (!isAntigravityConfigured()) return { ok: false, ...empty, error: 'No Antigravity credential is configured.' };

  const res = await call(`/interactions/${encodeURIComponent(remoteJobId)}`, { method: 'GET' }, timeoutMs);
  if (!res.ok) return { ok: false, ...empty, error: res.error };

  const payload = res.payload;
  const stepNames: string[] = [];
  for (const step of Array.isArray(payload?.steps) ? payload.steps : []) {
    const name = typeof step?.name === 'string' ? step.name : typeof step?.type === 'string' ? step.type : null;
    if (name) stepNames.push(name);
  }

  return {
    ok: true,
    outputText: extractAntigravityText(payload),
    stepNames,
    usage: payload?.usage ?? null,
    environmentId: typeof payload?.environment_id === 'string' ? payload.environment_id : null,
    truncated: res.truncated,
  };
}
