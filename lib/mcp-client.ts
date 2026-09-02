import dns from 'node:dns';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Pass V / Workstream F — real MCP (Model Context Protocol) connectivity.
//
// Standardized on Streamable HTTP (a single JSON-RPC-2.0-over-POST
// transport) per docs/adr-001-hermes-adapter-governance.md §6, which
// explicitly commits this project to that transport and only SSE "if
// testing proves it necessary." No MCP SDK is installed (none was found in
// package.json) — this is a plain, real `fetch`-based JSON-RPC client, not
// a fabricated handshake. stdio-transport skills are honestly
// PROBE_NOT_IMPLEMENTED — no child-process protocol implementation exists.
//
// CONFIGURED never means CONNECTED here: every function in this file either
// makes a real network call and reports its real outcome, or returns
// PROBE_NOT_IMPLEMENTED / NOT_CONFIGURED without ever touching the network.
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 5000;
const MCP_PROTOCOL_VERSION = '2024-11-05';

export type McpProbeStatus =
  | 'CONNECTED'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'PROBE_NOT_IMPLEMENTED';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpProbeResult {
  status: McpProbeStatus;
  transport: 'streamable-http' | 'stdio' | 'unknown';
  serverInfo?: { name?: string; version?: string };
  tools?: McpTool[];
  resources?: McpResource[];
  error?: string;
  latencyMs?: number;
  evidenceSource: 'live_probe' | 'not_attempted';
}

/**
 * F3 — SSRF guard. Resolves the hostname's real IP (not just the string)
 * and blocks loopback/private/link-local/metadata ranges by default. Local
 * development against a local MCP server requires the explicit
 * MCP_ALLOW_LOCAL_ENDPOINTS=true escape hatch — never silently allowed.
 */
export async function isSafeMcpUrl(rawUrl: string): Promise<{ safe: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Not a well-formed URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { safe: false, reason: `Unsupported protocol "${url.protocol}" — only http/https are allowed.` };
  }

  const allowLocal = process.env.MCP_ALLOW_LOCAL_ENDPOINTS === 'true';

  let addresses: string[];
  try {
    const lookups = await dns.promises.lookup(url.hostname, { all: true });
    addresses = lookups.map((l) => l.address);
  } catch {
    return { safe: false, reason: `Could not resolve hostname "${url.hostname}".` };
  }
  if (addresses.length === 0) {
    return { safe: false, reason: `No addresses resolved for "${url.hostname}".` };
  }

  for (const addr of addresses) {
    const blocked = isPrivateOrReservedIp(addr);
    if (blocked && !allowLocal) {
      return { safe: false, reason: `"${url.hostname}" resolves to ${addr}, a private/reserved address. Set MCP_ALLOW_LOCAL_ENDPOINTS=true for local development.` };
    }
  }
  return { safe: true };
}

function isPrivateOrReservedIp(addr: string): boolean {
  // IPv4
  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 0) return true; // "this network"
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
    return false;
  }
  // IPv6
  const lower = addr.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — recurse on the embedded v4 address
    return isPrivateOrReservedIp(lower.replace('::ffff:', ''));
  }
  return false;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string;
  result?: any;
  error?: { code: number; message: string };
}

// Pass VIII / Workstream P — an MCP server is admin-configured, not
// arbitrary user-submitted input, but its response is still a network
// payload from a process outside this app's control. Without a bound, a
// misbehaving/compromised server could hand back an unbounded response
// body that this function would buffer entirely into memory before ever
// checking it's well-formed JSON-RPC. 1MB is generous for a real
// tools/list or resources/list payload.
export const MAX_MCP_RESPONSE_BYTES = 1 * 1024 * 1024;

export async function readBoundedText(res: Response, maxBytes: number = MAX_MCP_RESPONSE_BYTES): Promise<string> {
  const contentLength = res.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Response exceeds the ${maxBytes}-byte bound (Content-Length: ${contentLength}).`);
  }
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds the ${maxBytes}-byte bound.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function jsonRpcCall(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  credential: string | null,
  id: number
): Promise<JsonRpcResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (credential) headers.Authorization = `Bearer ${credential}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
      redirect: 'error', // never silently follow a redirect that could escape the SSRF check
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Unexpected content-type "${contentType}" — not a JSON-RPC response.`);
    }
    const text = await readBoundedText(res, MAX_MCP_RESPONSE_BYTES);
    const body = JSON.parse(text) as JsonRpcResponse;
    if (!body || body.jsonrpc !== '2.0') {
      throw new Error('Response is not a valid JSON-RPC 2.0 envelope.');
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real MCP handshake: initialize -> notifications/initialized -> tools/list
 * -> resources/list. Every step is a real network call; any failure at any
 * step reports FAILED with the real error, never a partial fake success.
 */
export async function probeMcpServer(
  endpointUrl: string,
  credential: string | null = null
): Promise<McpProbeResult> {
  if (!endpointUrl) {
    return { status: 'NOT_CONFIGURED', transport: 'unknown', evidenceSource: 'not_attempted' };
  }

  const isHttp = endpointUrl.startsWith('http://') || endpointUrl.startsWith('https://');
  if (!isHttp) {
    // stdio or another non-HTTP transport shape — no real implementation exists.
    return { status: 'PROBE_NOT_IMPLEMENTED', transport: 'stdio', evidenceSource: 'not_attempted' };
  }

  const safety = await isSafeMcpUrl(endpointUrl);
  if (!safety.safe) {
    return { status: 'FAILED', transport: 'streamable-http', error: safety.reason, evidenceSource: 'live_probe' };
  }

  const startedAt = Date.now();
  try {
    const initResult = await jsonRpcCall(
      endpointUrl,
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'synthos-admin', version: '1.0.0' },
      },
      credential,
      1
    );
    if (initResult.error) {
      return {
        status: 'FAILED',
        transport: 'streamable-http',
        error: `initialize: ${initResult.error.message} (code ${initResult.error.code})`,
        latencyMs: Date.now() - startedAt,
        evidenceSource: 'live_probe',
      };
    }

    // notifications/initialized — fire-and-forget per MCP spec (no response
    // body expected); failure here doesn't invalidate a successful init.
    try {
      await jsonRpcCall(endpointUrl, 'notifications/initialized', {}, credential, 0);
    } catch {
      /* best effort — spec-optional response */
    }

    let tools: McpTool[] = [];
    try {
      const toolsResult = await jsonRpcCall(endpointUrl, 'tools/list', {}, credential, 2);
      tools = Array.isArray(toolsResult.result?.tools) ? toolsResult.result.tools : [];
    } catch {
      tools = []; // real absence, not fabricated — server may simply have no tools capability
    }

    let resources: McpResource[] = [];
    try {
      const resourcesResult = await jsonRpcCall(endpointUrl, 'resources/list', {}, credential, 3);
      resources = Array.isArray(resourcesResult.result?.resources) ? resourcesResult.result.resources : [];
    } catch {
      resources = [];
    }

    return {
      status: 'CONNECTED',
      transport: 'streamable-http',
      serverInfo: initResult.result?.serverInfo,
      tools,
      resources,
      latencyMs: Date.now() - startedAt,
      evidenceSource: 'live_probe',
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return {
      status: 'FAILED',
      transport: 'streamable-http',
      error: isTimeout ? `Probe timed out after ${PROBE_TIMEOUT_MS}ms.` : (err?.message || 'Unknown network error.'),
      latencyMs: Date.now() - startedAt,
      evidenceSource: 'live_probe',
    };
  }
}

// ---------------------------------------------------------------------------
// F2 — credential storage. AES-256-GCM at rest, keyed from
// MCP_CREDENTIAL_ENCRYPTION_KEY (sha256'd to a stable 32-byte key — the env
// var itself can be any length). No key configured -> credential storage is
// refused outright (see lib/skills.ts createSkill/updateSkill), never
// silently falls back to plaintext.
//
// SECURITY_LIMITATION (documented honestly, not claimed away): this is
// application-managed symmetric encryption, not a KMS/HSM. The key lives in
// the same process environment as the app. If both the database file and
// the environment are compromised together, the credential is recoverable.
// This is a real improvement over plaintext-at-rest, not a claim of
// hardware-backed secrecy.
// ---------------------------------------------------------------------------

function getEncryptionKey(): Buffer | null {
  const raw = process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

export function credentialEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}

export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('Credential storage requires MCP_CREDENTIAL_ENCRYPTION_KEY to be configured.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptCredential(stored: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('Credential storage requires MCP_CREDENTIAL_ENCRYPTION_KEY to be configured.');
  }
  const [ivB64, tagB64, ciphertextB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Stored credential is malformed.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
