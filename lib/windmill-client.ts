import { isSafeMcpUrl } from './mcp-client';

// ---------------------------------------------------------------------------
// Windmill external execution control-plane client.
//
// Real REST calls only — grounded against Windmill's public API docs and
// OpenAPI spec (windmill.dev/docs/core_concepts/webhooks and
// github.com/windmill-labs/windmill backend/windmill-api/openapi.yaml),
// not guessed paths:
//   GET  /api/version                                        — plain-text git version, unauthenticated
//   GET  /api/users/whoami                                    — authenticated identity (Bearer token)
//   POST /api/w/{workspace}/jobs/run/p/{script_path}          — submit a script by path, returns job UUID
//   POST /api/w/{workspace}/jobs/run/f/{flow_path}            — submit a flow by path, returns job UUID
//   GET  /api/w/{workspace}/jobs_u/get/{id}                   — job status (queued/running/completed)
//   GET  /api/w/{workspace}/jobs_u/get_completed_job_result/{id} — completed job's result payload
//   POST /api/w/{workspace}/jobs_u/cancel/{id}                — cancel a queued/running job
//
// CONFIGURED never means CONNECTED here (non-negotiable rule 10/11): every
// function either makes a real network call and reports its real outcome,
// or returns NOT_CONFIGURED without ever touching the network. The bearer
// token is read from process.env only, is never logged, and is never
// included in any returned object — see B4/R1.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_JOB_INPUT_BYTES = 64 * 1024; // R4 — bound outbound job payload size
const MAX_JOB_RESULT_BYTES = 512 * 1024; // R4 — bound inbound result size we'll store

export type WindmillConnectionStatus = 'NOT_CONFIGURED' | 'CONNECTED' | 'FAILED' | 'INVALID_RESPONSE';

export interface WindmillHealthResult {
  status: WindmillConnectionStatus;
  reachable: boolean;
  authenticated: boolean;
  version: string | null;
  identity: string | null;
  latencyMs: number | null;
  error?: string;
  checkedAt: string;
}

export interface WindmillClientConfig {
  baseUrl?: string;
  token?: string;
  workspace?: string;
  timeoutMs?: number;
}

function resolveConfig(config?: WindmillClientConfig) {
  return {
    baseUrl: (config?.baseUrl ?? process.env.WINDMILL_BASE_URL ?? '').trim(),
    token: (config?.token ?? process.env.WINDMILL_TOKEN ?? '').trim(),
    workspace: (config?.workspace ?? process.env.WINDMILL_WORKSPACE ?? '').trim(),
    timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** True only when every piece of configuration required to attempt a real call is present. Configured != connected. */
export function isWindmillConfigured(config?: WindmillClientConfig): boolean {
  const { baseUrl, token, workspace } = resolveConfig(config);
  return !!baseUrl && !!token && !!workspace;
}

function cleanBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response | null; latencyMs: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    return { res, latencyMs: Date.now() - startedAt };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return { res: null, latencyMs: Date.now() - startedAt, error: isTimeout ? `Request timed out after ${timeoutMs}ms.` : `Network error: ${err?.message || String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real, two-step health check (B1/B3/B4). Never fabricates CONNECTED:
 * step 1 proves the base URL is reachable (unauthenticated GET /api/version);
 * step 2 proves the token actually authenticates (GET /api/users/whoami).
 * Both must succeed for CONNECTED — a reachable-but-unauthenticated server
 * is reported FAILED with an honest reason, never silently upgraded.
 */
export async function health(config?: WindmillClientConfig): Promise<WindmillHealthResult> {
  const { baseUrl, token, timeoutMs } = resolveConfig(config);
  const checkedAt = new Date().toISOString();

  if (!baseUrl || !token) {
    return {
      status: 'NOT_CONFIGURED', reachable: false, authenticated: false, version: null, identity: null, latencyMs: null,
      error: !baseUrl ? 'WINDMILL_BASE_URL is not configured.' : 'WINDMILL_TOKEN is not configured.',
      checkedAt,
    };
  }

  const safety = await isSafeMcpUrl(baseUrl);
  if (!safety.safe) {
    return { status: 'FAILED', reachable: false, authenticated: false, version: null, identity: null, latencyMs: null, error: safety.reason, checkedAt };
  }

  const base = cleanBase(baseUrl);
  const versionCall = await timedFetch(`${base}/api/version`, { method: 'GET', headers: { Accept: 'text/plain, application/json' } }, timeoutMs);
  if (!versionCall.res) {
    return { status: 'FAILED', reachable: false, authenticated: false, version: null, identity: null, latencyMs: versionCall.latencyMs, error: versionCall.error, checkedAt };
  }
  if (!versionCall.res.ok) {
    return { status: 'FAILED', reachable: false, authenticated: false, version: null, identity: null, latencyMs: versionCall.latencyMs, error: `GET /api/version returned HTTP ${versionCall.res.status}.`, checkedAt };
  }
  let version: string | null = null;
  try {
    version = (await versionCall.res.text()).trim().slice(0, 100) || null;
  } catch {
    version = null;
  }

  const whoamiCall = await timedFetch(`${base}/api/users/whoami`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }, timeoutMs);
  if (!whoamiCall.res) {
    return { status: 'FAILED', reachable: true, authenticated: false, version, identity: null, latencyMs: whoamiCall.latencyMs, error: whoamiCall.error, checkedAt };
  }
  if (whoamiCall.res.status === 401 || whoamiCall.res.status === 403) {
    return { status: 'FAILED', reachable: true, authenticated: false, version, identity: null, latencyMs: whoamiCall.latencyMs, error: `WINDMILL_TOKEN was rejected (HTTP ${whoamiCall.res.status}).`, checkedAt };
  }
  if (!whoamiCall.res.ok) {
    return { status: 'FAILED', reachable: true, authenticated: false, version, identity: null, latencyMs: whoamiCall.latencyMs, error: `GET /api/users/whoami returned HTTP ${whoamiCall.res.status}.`, checkedAt };
  }

  let identity: string | null = null;
  try {
    const body = await whoamiCall.res.json();
    const candidate = body?.username ?? body?.email;
    if (typeof candidate !== 'string' || !candidate.trim()) {
      return { status: 'INVALID_RESPONSE', reachable: true, authenticated: false, version, identity: null, latencyMs: whoamiCall.latencyMs, error: 'GET /api/users/whoami did not return a recognizable username/email field.', checkedAt };
    }
    identity = candidate;
  } catch (err: any) {
    return { status: 'INVALID_RESPONSE', reachable: true, authenticated: false, version, identity: null, latencyMs: whoamiCall.latencyMs, error: `Malformed JSON from /api/users/whoami: ${err?.message || err}`, checkedAt };
  }

  return { status: 'CONNECTED', reachable: true, authenticated: true, version, identity, latencyMs: whoamiCall.latencyMs, checkedAt };
}

export interface WindmillSubmitResult {
  ok: boolean;
  remoteJobId: string | null;
  error?: string;
  latencyMs: number;
}

/** R4 — refuses to submit a job whose serialized input exceeds MAX_JOB_INPUT_BYTES. */
export function isJobInputWithinBounds(input: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(input ?? {}), 'utf8') <= MAX_JOB_INPUT_BYTES;
  } catch {
    return false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractJobId(raw: string): string | null {
  const trimmed = raw.trim();
  // Windmill's run/p and run/f endpoints return the job UUID either as a
  // bare plain-text string or as a JSON-quoted string, depending on the
  // request's Accept header — handle both, never trust either blindly.
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return UUID_RE.test(unquoted) ? unquoted : null;
}

/**
 * Submits a script or flow by its registry-resolved remote path (K1 — never
 * an arbitrary caller-supplied path; callers must resolve through the
 * windmill_targets registry before calling this). Path is embedded via
 * encodeURIComponent per segment, never string-concatenated raw (R3).
 */
export async function submitJob(
  params: { remotePath: string; kind: 'script' | 'flow'; input: Record<string, unknown> },
  config?: WindmillClientConfig
): Promise<WindmillSubmitResult> {
  const { baseUrl, token, workspace, timeoutMs } = resolveConfig(config);
  if (!baseUrl || !token || !workspace) {
    return { ok: false, remoteJobId: null, error: 'Windmill is not configured (base URL, token, and workspace are all required).', latencyMs: 0 };
  }
  if (!isJobInputWithinBounds(params.input)) {
    return { ok: false, remoteJobId: null, error: `Job input exceeds the ${MAX_JOB_INPUT_BYTES}-byte bound.`, latencyMs: 0 };
  }
  const safety = await isSafeMcpUrl(baseUrl);
  if (!safety.safe) {
    return { ok: false, remoteJobId: null, error: safety.reason, latencyMs: 0 };
  }

  const kindSegment = params.kind === 'flow' ? 'f' : 'p';
  const pathSegments = params.remotePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const url = `${cleanBase(baseUrl)}/api/w/${encodeURIComponent(workspace)}/jobs/run/${kindSegment}/${pathSegments}`;

  const call = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params.input ?? {}),
  }, timeoutMs);

  if (!call.res) return { ok: false, remoteJobId: null, error: call.error, latencyMs: call.latencyMs };
  if (!call.res.ok) return { ok: false, remoteJobId: null, error: `Job submission returned HTTP ${call.res.status}.`, latencyMs: call.latencyMs };

  const raw = await call.res.text();
  const jobId = extractJobId(raw);
  if (!jobId) return { ok: false, remoteJobId: null, error: 'Windmill did not return a recognizable job UUID.', latencyMs: call.latencyMs };
  return { ok: true, remoteJobId: jobId, latencyMs: call.latencyMs };
}

export type WindmillRemoteJobState = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'CANCELLED' | 'UNKNOWN';

export interface WindmillJobStatusResult {
  ok: boolean;
  state: WindmillRemoteJobState;
  raw?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
}

export async function getJobStatus(remoteJobId: string, config?: WindmillClientConfig): Promise<WindmillJobStatusResult> {
  const { baseUrl, token, workspace, timeoutMs } = resolveConfig(config);
  if (!baseUrl || !token || !workspace) {
    return { ok: false, state: 'UNKNOWN', error: 'Windmill is not configured.', latencyMs: 0 };
  }
  if (!UUID_RE.test(remoteJobId)) {
    return { ok: false, state: 'UNKNOWN', error: 'remoteJobId is not a well-formed UUID.', latencyMs: 0 };
  }
  const url = `${cleanBase(baseUrl)}/api/w/${encodeURIComponent(workspace)}/jobs_u/get/${encodeURIComponent(remoteJobId)}`;
  const call = await timedFetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }, timeoutMs);

  if (!call.res) return { ok: false, state: 'UNKNOWN', error: call.error, latencyMs: call.latencyMs };
  if (call.res.status === 404) return { ok: false, state: 'UNKNOWN', error: 'Remote job not found (404) — may have been purged or never existed.', latencyMs: call.latencyMs };
  if (!call.res.ok) return { ok: false, state: 'UNKNOWN', error: `Job status returned HTTP ${call.res.status}.`, latencyMs: call.latencyMs };

  let body: any;
  try {
    body = await call.res.json();
  } catch (err: any) {
    return { ok: false, state: 'UNKNOWN', error: `Malformed JSON job status response: ${err?.message || err}`, latencyMs: call.latencyMs };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, state: 'UNKNOWN', error: 'Job status response was not a JSON object.', latencyMs: call.latencyMs };
  }

  let state: WindmillRemoteJobState = 'UNKNOWN';
  if (body.canceled === true) state = 'CANCELLED';
  else if (body.running === true) state = 'RUNNING';
  else if (body.type === 'CompletedJob' || body.success !== undefined) state = body.success === true ? 'SUCCESS' : body.success === false ? 'FAILURE' : 'UNKNOWN';
  else if (body.type === 'QueuedJob' || body.running === false) state = 'QUEUED';

  return { ok: true, state, raw: body, latencyMs: call.latencyMs };
}

export interface WindmillJobResultResult {
  ok: boolean;
  result?: unknown;
  truncated?: boolean;
  error?: string;
  latencyMs: number;
}

export async function getJobResult(remoteJobId: string, config?: WindmillClientConfig): Promise<WindmillJobResultResult> {
  const { baseUrl, token, workspace, timeoutMs } = resolveConfig(config);
  if (!baseUrl || !token || !workspace) {
    return { ok: false, error: 'Windmill is not configured.', latencyMs: 0 };
  }
  if (!UUID_RE.test(remoteJobId)) {
    return { ok: false, error: 'remoteJobId is not a well-formed UUID.', latencyMs: 0 };
  }
  const url = `${cleanBase(baseUrl)}/api/w/${encodeURIComponent(workspace)}/jobs_u/get_completed_job_result/${encodeURIComponent(remoteJobId)}`;
  const call = await timedFetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }, timeoutMs);

  if (!call.res) return { ok: false, error: call.error, latencyMs: call.latencyMs };
  if (call.res.status === 404) return { ok: false, error: 'Remote job result not found — job may not be complete yet.', latencyMs: call.latencyMs };
  if (!call.res.ok) return { ok: false, error: `Job result returned HTTP ${call.res.status}.`, latencyMs: call.latencyMs };

  const raw = await call.res.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_JOB_RESULT_BYTES) {
    return { ok: true, result: raw.slice(0, MAX_JOB_RESULT_BYTES), truncated: true, latencyMs: call.latencyMs };
  }
  try {
    return { ok: true, result: JSON.parse(raw), latencyMs: call.latencyMs };
  } catch {
    // A script can legitimately return a bare string/number — not every
    // completed-job-result body is JSON-parseable as an object.
    return { ok: true, result: raw, latencyMs: call.latencyMs };
  }
}

export interface WindmillCancelResult {
  ok: boolean;
  confirmed: boolean;
  error?: string;
  latencyMs: number;
}

export async function cancelJob(remoteJobId: string, config?: WindmillClientConfig): Promise<WindmillCancelResult> {
  const { baseUrl, token, workspace, timeoutMs } = resolveConfig(config);
  if (!baseUrl || !token || !workspace) {
    return { ok: false, confirmed: false, error: 'Windmill is not configured.', latencyMs: 0 };
  }
  if (!UUID_RE.test(remoteJobId)) {
    return { ok: false, confirmed: false, error: 'remoteJobId is not a well-formed UUID.', latencyMs: 0 };
  }
  const url = `${cleanBase(baseUrl)}/api/w/${encodeURIComponent(workspace)}/jobs_u/cancel/${encodeURIComponent(remoteJobId)}`;
  const call = await timedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ reason: 'Cancelled from SynthOS.' }) }, timeoutMs);

  if (!call.res) return { ok: false, confirmed: false, error: call.error, latencyMs: call.latencyMs };
  if (!call.res.ok) return { ok: false, confirmed: false, error: `Cancel request returned HTTP ${call.res.status}.`, latencyMs: call.latencyMs };

  // O2 — the cancel POST returning 2xx only proves the request was
  // accepted, not that the job actually stopped. Confirmation requires a
  // real follow-up status read showing canceled === true.
  const status = await getJobStatus(remoteJobId, config);
  const confirmed = status.ok && status.state === 'CANCELLED';
  return { ok: true, confirmed, latencyMs: call.latencyMs };
}
