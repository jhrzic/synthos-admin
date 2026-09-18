// ---------------------------------------------------------------------------
// PAID-ENDPOINT NETWORK GUARD — the hard boundary under the spend guard.
//
// Budgets are only as strong as the one call site someone forgets to wrap. So
// enforcement is not left to call sites: this installs one process-wide fetch
// interceptor in front of every paid provider host. A request that can incur
// inference charges (any non-GET to a paid host, except the free token-count
// endpoint) is refused BEFORE any bytes leave the process unless it runs
// inside a permit issued by lib/spend/guard.ts — which only issues one after
// every policy check has passed and budget has been reserved.
//
// A permit allows exactly ONE paid request by default. A candidate-model
// failover loop, an SDK's internal retry, or a "try again with a different
// model" — each would be a second paid request under the same logical call,
// and each is refused here. That is what makes NO_PAID_FALLBACK structural
// rather than a promise every adapter has to keep.
//
// Metadata reads (GET /models, Antigravity status polls) are not inference and
// pass through untouched.
//
// UNDER TEST: real paid provider hosts are unreachable — every method, with or
// without a permit — unless SYNTHOS_LIVE_PROVIDER_TESTS=true AND a positive
// SYNTHOS_LIVE_TEST_BUDGET_USD are both set. Test doubles on loopback are
// governed by the same permit rules as real providers, so tests exercise the
// real enforcement.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks';

/** Hosts that bill for requests. A configured base-URL override is added at request time. */
export const REAL_PAID_HOSTS = [
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'api.anthropic.com',
  'api.deepseek.com',
  'openrouter.ai',
  'api.fish.audio',
  'api.elevenlabs.io',
];

/**
 * Provider CONTROL-PLANE hosts: documentation and pricing pages the catalog
 * reads. Free, but still external provider network — unreachable under test
 * unless SYNTHOS_LIVE_METADATA_TESTS=true.
 */
export const PROVIDER_METADATA_HOSTS = ['platform.openai.com', 'developers.openai.com', 'openai.com', 'ai.google.dev'];

/**
 * What the spend guard PRICED. The outgoing request must match it: the same
 * model, an output ceiling no higher, and no more input than was estimated.
 * A request that differs — or whose body cannot be read to check — is refused
 * before it leaves the process, so nothing can be changed after reservation.
 */
export interface PricedRequest {
  model: string;
  /** Tokens for inference; for Antigravity this is max_total_tokens. null = not applicable (speech). */
  maxOutputTokens: number | null;
  maxInputChars: number;
}

export interface SpendPermit {
  usageId: string;
  provider: string;
  priced?: PricedRequest;
  maxDispatches: number;
  dispatched: number;
  lastStatus: number | null;
  lastErrorKind: 'TIMEOUT' | 'CONNECTION_REFUSED' | 'NETWORK' | null;
  onDispatch: () => void;
}

export class PaidEndpointBlockedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PaidEndpointBlockedError';
    this.code = code;
  }
}

const storage = new AsyncLocalStorage<SpendPermit>();

export function runWithPermit<T>(permit: SpendPermit, fn: () => Promise<T>): Promise<T> {
  return storage.run(permit, fn);
}

export function currentPermit(): SpendPermit | undefined {
  return storage.getStore();
}

export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST === 'true' || env.NODE_ENV === 'test';
}

/** Free provider metadata/docs GETs under test. Separate from, and never implying, paid inference. */
export function liveMetadataTestsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SYNTHOS_LIVE_METADATA_TESTS === 'true';
}

export function isProviderMetadataHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return PROVIDER_METADATA_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
}

export function liveProviderTestsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const budget = Number(env.SYNTHOS_LIVE_TEST_BUDGET_USD);
  return env.SYNTHOS_LIVE_PROVIDER_TESTS === 'true' && Number.isFinite(budget) && budget > 0;
}

function hostOf(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  try { return new URL(raw).host.toLowerCase(); } catch { return null; }
}

// ---------------------------------------------------------------------------
// PROVIDER ENDPOINT SOURCE — supplied by the model registry (lib/registry).
//
// The registry is the one authority for where each provider's requests and
// credentials may go. It registers itself here (instead of this module
// importing it) so the fetch boundary has no import cycle with the spend
// guard. Until it registers, only the canonical paid hosts are known.
// ---------------------------------------------------------------------------
export interface ProviderEndpointInfo {
  /** Hosts (with port) this provider's requests are resolved to right now — validated. */
  endpointHosts: string[];
  /** Every host a credential for this provider may be sent to. */
  credentialHosts: string[];
  /** The resolved credential values. Compared in memory only; never logged. */
  credentials: string[];
}
let endpointSource: (() => ProviderEndpointInfo[]) | null = null;
let endpointCache: { at: number; value: ProviderEndpointInfo[] } | null = null;

export function setProviderEndpointSource(fn: () => ProviderEndpointInfo[]): void {
  endpointSource = fn;
  endpointCache = null;
}

function providerEndpoints(): ProviderEndpointInfo[] {
  if (!endpointSource) return [];
  if (endpointCache && Date.now() - endpointCache.at < 2_000) return endpointCache.value;
  let value: ProviderEndpointInfo[] = [];
  try { value = endpointSource(); } catch { value = []; }
  endpointCache = { at: Date.now(), value };
  return value;
}

/** Test hook: drop the cached endpoint view after changing env or credentials. */
export function invalidateProviderEndpointCache(): void {
  endpointCache = null;
}

/** Real paid hosts plus every registry-validated provider endpoint (proxy, gateway or test double). */
export function paidHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const set = new Set(REAL_PAID_HOSTS);
  for (const p of providerEndpoints()) for (const h of p.endpointHosts) set.add(h);
  // An override the registry REJECTED is still a paid host: a request aimed at
  // it must be refused by this boundary, never treated as free traffic.
  for (const v of [env.OPENAI_BASE_URL, env.ANTIGRAVITY_BASE_URL, env.GEMINI_BASE_URL]) {
    const h = hostOf(v);
    if (h) set.add(h);
  }
  return set;
}

const CREDENTIAL_HEADERS = ['authorization', 'x-goog-api-key', 'x-api-key', 'api-key'];

function headerValues(input: any, init: any): string[] {
  const out: string[] = [];
  const read = (h: any) => {
    if (!h) return;
    if (typeof h.forEach === 'function' && typeof h.get === 'function') {
      h.forEach((v: string, k: string) => { if (CREDENTIAL_HEADERS.includes(k.toLowerCase())) out.push(String(v)); });
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) if (CREDENTIAL_HEADERS.includes(String(k).toLowerCase())) out.push(String(v));
    } else if (typeof h === 'object') {
      for (const [k, v] of Object.entries(h)) if (CREDENTIAL_HEADERS.includes(k.toLowerCase())) out.push(String(v));
    }
  };
  read(input && typeof input === 'object' && 'headers' in input ? input.headers : null);
  read(init?.headers);
  return out;
}

/**
 * CREDENTIAL PROTECTION. If a request carries a provider credential (header or
 * `key=` query) to a host that provider is not approved for, it is refused
 * here, before it leaves the process. Returns the refusal reason or null.
 */
export function credentialDestinationViolation(url: URL, input: any, init: any): string | null {
  const endpoints = providerEndpoints();
  if (endpoints.length === 0) return null;
  const sent = [...headerValues(input, init).map((v) => v.replace(/^Bearer\s+/i, '').trim()), ...(url.searchParams.get('key') ? [url.searchParams.get('key')!] : [])].filter((v) => v.length >= 8);
  if (sent.length === 0) return null;
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  // One credential can belong to several providers (Antigravity falls back to
  // the Gemini key). It may go to a host if ANY provider holding it approves it.
  const holders = endpoints.filter((p) => p.credentials.some((c) => c && sent.includes(c)));
  if (holders.length === 0) return null;
  // Loopback is matched on host:port only; other hosts on their hostname too.
  const loopback = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || /^127\./.test(hostname);
  if (holders.some((p) => p.credentialHosts.includes(host) || (!loopback && p.credentialHosts.includes(hostname)))) return null;
  return `a provider credential was about to be sent to ${host}, which is not an approved host for any provider holding it`;
}

export function isRealPaidHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return REAL_PAID_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
}

/** Whether a request can incur inference charges. Fails closed: any non-GET to a paid host is paid. */
export function isPaidRequest(url: URL, method: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const hosts = paidHosts(env);
  const host = url.host.toLowerCase();
  if (!hosts.has(host) && !isRealPaidHost(url.hostname)) return false;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (/:countTokens$/.test(url.pathname)) return false; // free token counting
  return true;
}

function classifyFetchError(err: any): SpendPermit['lastErrorKind'] {
  const name = String(err?.name || '');
  const code = String(err?.cause?.code || err?.code || '');
  if (name === 'AbortError' || name === 'TimeoutError') return 'TIMEOUT';
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(code)) return 'CONNECTION_REFUSED';
  return 'NETWORK';
}

function sumTextFields(v: unknown, depth = 0): number {
  if (depth > 12 || v === null || v === undefined) return 0;
  if (Array.isArray(v)) return v.reduce((n, x) => n + sumTextFields(x, depth + 1), 0);
  if (typeof v === 'object') {
    let n = 0;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      n += k === 'text' && typeof x === 'string' ? x.length : sumTextFields(x, depth + 1);
    }
    return n;
  }
  return 0;
}

/**
 * Check a paid request against what was priced. Returns null when it matches,
 * otherwise the reason it does not. Unknown request shapes FAIL CLOSED.
 */
export function verifyPricedRequest(url: URL, bodyText: string | null, priced: PricedRequest, headers?: Record<string, string>): string | null {
  if (bodyText === null) return 'the request body could not be read to verify it against the reservation';
  let body: any;
  try { body = JSON.parse(bodyText); } catch { return 'the request body is not JSON, so it cannot be verified'; }
  const p = url.pathname;
  const tooLong = (n: number) => n > priced.maxInputChars ? `input is ${n} characters; ${priced.maxInputChars} were priced` : null;

  if (/\/responses$/.test(p)) {
    if (body.model !== priced.model) return `model "${body.model}" differs from the priced "${priced.model}"`;
    if (typeof body.max_output_tokens !== 'number') return 'no max_output_tokens was sent';
    if (priced.maxOutputTokens !== null && body.max_output_tokens > priced.maxOutputTokens) return `max_output_tokens ${body.max_output_tokens} exceeds the priced ${priced.maxOutputTokens}`;
    return tooLong(typeof body.input === 'string' ? body.input.length : JSON.stringify(body.input ?? '').length);
  }
  if (/\/chat\/completions$/.test(p)) {
    // OpenAI-compatible chat completions (any provider speaking that protocol).
    if (body.model !== priced.model) return `model "${body.model}" differs from the priced "${priced.model}"`;
    const out = body.max_tokens ?? body.max_completion_tokens;
    if (typeof out !== 'number') return 'no max_tokens was sent';
    if (priced.maxOutputTokens !== null && out > priced.maxOutputTokens) return `max_tokens ${out} exceeds the priced ${priced.maxOutputTokens}`;
    return tooLong(sumTextFields({ messages: (body.messages || []).map((m: any) => ({ text: typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '') })) }));
  }
  if (/\/audio\/speech$/.test(p)) {
    if (body.model !== priced.model) return `model "${body.model}" differs from the priced "${priced.model}"`;
    return tooLong(String(body.input ?? '').length);
  }
  const gm = /\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(p);
  if (gm) {
    if (decodeURIComponent(gm[1]) !== priced.model) return `model "${gm[1]}" differs from the priced "${priced.model}"`;
    const out = body.generationConfig?.maxOutputTokens;
    if (typeof out !== 'number') return 'no maxOutputTokens was sent';
    if (priced.maxOutputTokens !== null && out > priced.maxOutputTokens) return `maxOutputTokens ${out} exceeds the priced ${priced.maxOutputTokens}`;
    return tooLong(sumTextFields({ contents: body.contents, systemInstruction: body.systemInstruction }));
  }
  if (/\/interactions$/.test(p)) {
    if (body.agent !== priced.model) return `agent "${body.agent}" differs from the priced "${priced.model}"`;
    const cap = body.agent_config?.max_total_tokens;
    if (typeof cap !== 'number') return 'no agent_config.max_total_tokens was sent';
    if (priced.maxOutputTokens !== null && cap > priced.maxOutputTokens) return `max_total_tokens ${cap} exceeds the priced ${priced.maxOutputTokens}`;
    return tooLong(String(body.input ?? '').length);
  }
  if (/\/text-to-speech\//.test(p)) {
    if (body.model_id !== priced.model) return `model "${body.model_id}" differs from the priced "${priced.model}"`;
    return tooLong(String(body.text ?? '').length);
  }
  if (/\/v1\/tts$/.test(p)) {
    const hdrModel = headers?.model ?? headers?.Model;
    if (hdrModel !== undefined && hdrModel !== priced.model) return `model "${hdrModel}" differs from the priced "${priced.model}"`;
    return tooLong(String(body.text ?? '').length);
  }
  return `the request shape at ${p} is not one the spend guard can verify`;
}

let installed = false;
let unguardedAttemptsBlocked = 0;

export function unguardedAttemptCount(): number {
  return unguardedAttemptsBlocked;
}

export function installPaidEndpointGuard(): void {
  if (installed || typeof globalThis.fetch !== 'function') return;
  const original = globalThis.fetch.bind(globalThis);

  const guarded = async (input: any, init?: any): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url);
    } catch {
      return original(input, init);
    }
    const method = String(init?.method || (typeof input === 'object' && input && 'method' in input ? (input as any).method : 'GET') || 'GET');

    // UNDER TEST, NO EXTERNAL PROVIDER NETWORK BY DEFAULT.
    //   paid inference on a real host  → SYNTHOS_LIVE_PROVIDER_TESTS + budget
    //   free metadata on a provider host (GET /models, pricing docs)
    //                                  → SYNTHOS_LIVE_METADATA_TESTS
    // The two flags are independent: neither implies the other.
    if (isTestMode() && (isRealPaidHost(url.hostname) || isProviderMetadataHost(url.hostname))) {
      const paid = isRealPaidHost(url.hostname) && isPaidRequest(url, method);
      if (paid && !liveProviderTestsAllowed()) {
        throw new PaidEndpointBlockedError(
          'TEST_MODE_REAL_PROVIDER_BLOCKED',
          `Real provider endpoint ${url.host} is unreachable under test. Set SYNTHOS_LIVE_PROVIDER_TESTS=true and SYNTHOS_LIVE_TEST_BUDGET_USD to run live paid-provider tests.`,
        );
      }
      if (!paid && !liveMetadataTestsAllowed()) {
        throw new PaidEndpointBlockedError(
          'TEST_MODE_PROVIDER_METADATA_BLOCKED',
          `Provider host ${url.host} is unreachable under test. Set SYNTHOS_LIVE_METADATA_TESTS=true to run live metadata tests (free GETs only).`,
        );
      }
    }

    // Credentials never go to an unapproved host — checked for EVERY request,
    // paid or not, before anything leaves the process.
    const violation = credentialDestinationViolation(url, input, init);
    if (violation) throw new PaidEndpointBlockedError('CREDENTIAL_HOST_NOT_APPROVED', `Refused before sending: ${violation}.`);

    // A redirect from a provider endpoint could carry its credential to
    // another host; provider requests never follow redirects.
    if (paidHosts().has(url.host.toLowerCase()) || isRealPaidHost(url.hostname)) {
      if (input instanceof Request) input = new Request(input, { redirect: 'error' });
      init = { ...(init || {}), redirect: 'error' };
    }

    if (!isPaidRequest(url, method)) return original(input, init);

    const permit = storage.getStore();
    if (!permit) {
      unguardedAttemptsBlocked += 1;
      throw new PaidEndpointBlockedError(
        'UNGUARDED_PAID_REQUEST',
        `A paid request to ${url.host} was attempted outside the spend guard and was refused before leaving the process.`,
      );
    }
    if (permit.dispatched >= permit.maxDispatches) {
      throw new PaidEndpointBlockedError(
        'SECOND_PAID_REQUEST_REFUSED',
        `This call already sent its one permitted paid request; a second (retry or fallback) was refused. Policy is NO_PAID_FALLBACK.`,
      );
    }

    if (permit.priced) {
      const bodyText = typeof init?.body === 'string' ? init.body : null;
      const headers = init?.headers && typeof init.headers === 'object' && !(typeof (init.headers as any).get === 'function') ? (init.headers as Record<string, string>) : undefined;
      const mismatch = verifyPricedRequest(url, bodyText, permit.priced, headers);
      if (mismatch) {
        throw new PaidEndpointBlockedError('REQUEST_DIFFERS_FROM_RESERVATION', `Refused before sending: ${mismatch}. A different request needs its own reservation.`);
      }
    }

    permit.dispatched += 1;
    try { permit.onDispatch(); } catch { /* ledger bookkeeping must not change the request */ }
    try {
      const res = await original(input, init);
      permit.lastStatus = res.status;
      return res;
    } catch (err) {
      permit.lastErrorKind = classifyFetchError(err);
      throw err;
    }
  };

  globalThis.fetch = guarded as typeof fetch;
  installed = true;
}

// Installed on import: every module that can reach a paid provider imports the
// guard (directly or through lib/spend/guard.ts), and server.ts and the test
// setup import it first.
installPaidEndpointGuard();
