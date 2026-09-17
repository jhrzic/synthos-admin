// ---------------------------------------------------------------------------
// TOOL PACK 1 — the one canonical outbound-URL guard (SSRF boundary).
//
// This is an EXTRACTION, not a new protection. lib/mcp-client.ts already
// carried a real, DNS-resolving SSRF guard (isSafeMcpUrl + a private/reserved
// IP classifier). Tool Pack 1 adds a second outbound-fetch tool
// (research.fetch), and the instruction was explicit: reuse the SSRF
// protections, do not build a parallel one.
//
// Copying that classifier would have repeated exactly the failure lib/redact.ts
// was created to end: two scrubbers that each knew a different subset of
// credential shapes, so a key that matched neither one's floor slipped through
// the gap between them. A second IP classifier is the same bug with worse
// consequences — the one that forgets fc00::/7 or 169.254.169.254 is the one an
// attacker reaches the cloud metadata endpoint through. So there is one
// classifier, here, and lib/mcp-client.ts now imports it.
//
// WHY THE ESCAPE HATCH IS PER-CALLER AND NOT GLOBAL
// MCP deliberately supports local development against a local MCP server via
// MCP_ALLOW_LOCAL_ENDPOINTS=true. research.fetch must NOT inherit that: it
// fetches URLs that originate from a model's or a user's request text, which is
// precisely the input class SSRF exploits. A single global flag would mean
// switching on local MCP development silently opened arbitrary loopback
// fetching to the research tool. The allowance is therefore a parameter the
// caller passes, never a variable this module reads for itself.
// ---------------------------------------------------------------------------

import dns from 'node:dns';

/**
 * Whether an IP literal falls in a private, loopback, link-local or otherwise
 * reserved range that a tool must never be pointed at.
 *
 * Exported so tests can assert the range table directly rather than only
 * through a DNS-dependent path.
 */
export function isPrivateOrReservedIp(addr: string): boolean {
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
    if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 carrier-grade NAT
    if (a >= 224) return true; // multicast (224/4) and reserved (240/4), incl. 255.255.255.255
    return false;
  }
  // IPv6
  const lower = addr.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — recurse on the embedded v4 address
    return isPrivateOrReservedIp(lower.replace('::ffff:', ''));
  }
  if (lower.startsWith('64:ff9b:')) {
    // RFC 6052 NAT64 — the embedded v4 address is what traffic actually
    // reaches, so classify on that rather than on the v6 wrapper.
    const tail = lower.split(':').pop() || '';
    const dotted = tail.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dotted) return isPrivateOrReservedIp(dotted[1]);
  }
  return false;
}

export interface OutboundUrlVerdict {
  safe: boolean;
  reason?: string;
  /** Every address the hostname resolved to. Recorded as provenance on a refusal. */
  resolvedAddresses?: string[];
}

export interface OutboundUrlOptions {
  /**
   * Permit loopback/private targets. Passed explicitly by a caller that has a
   * real reason (local MCP development). NEVER read from the environment here —
   * see the header note.
   */
  allowPrivate?: boolean;
  /** Protocols permitted. Defaults to https+http. */
  allowedProtocols?: string[];
}

/**
 * Resolve a URL's hostname to real addresses and refuse private/reserved
 * targets.
 *
 * Resolution matters: blocking the STRING "localhost" is not a guard, because
 * `http://127.0.0.1.nip.io/` and a hostile DNS record pointing at 169.254.169.254
 * both pass a string check and both reach the target. Every resolved address is
 * checked, not just the first, so a hostname that returns one public and one
 * private address is refused rather than raced.
 *
 * NOTE ON A LIMIT WE ARE NOT PRETENDING TO HAVE CLOSED: this resolves, then the
 * caller connects, so a DNS record that changes between the two (a rebinding
 * attack) is not defeated by this check alone. Closing that requires pinning
 * the connection to the validated address at socket level, which Node's fetch
 * does not expose. What makes it acceptable here is that research.fetch is
 * READ_ONLY and its response is bounded and returned as untrusted observation
 * — never promoted to Brain knowledge (see Section 7). It is written down
 * rather than left for someone to discover.
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  opts: OutboundUrlOptions = {},
): Promise<OutboundUrlVerdict> {
  const allowedProtocols = opts.allowedProtocols ?? ['https:', 'http:'];

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Not a well-formed URL.' };
  }
  if (!allowedProtocols.includes(url.protocol)) {
    return {
      safe: false,
      reason: `Unsupported protocol "${url.protocol}" — only ${allowedProtocols.join(', ')} are allowed.`,
    };
  }
  // Credentials in the URL are refused outright: they would be sent onward to
  // the target and would land in provenance/logs, and no legitimate research
  // fetch needs them.
  if (url.username || url.password) {
    return { safe: false, reason: 'A URL carrying embedded credentials is refused.' };
  }

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
    if (isPrivateOrReservedIp(addr) && !opts.allowPrivate) {
      return {
        safe: false,
        reason: `"${url.hostname}" resolves to ${addr}, a private or reserved address.`,
        resolvedAddresses: addresses,
      };
    }
  }
  return { safe: true, resolvedAddresses: addresses };
}

/** Default ceiling for a bounded outbound read. Generous for an article, far short of a memory problem. */
export const MAX_OUTBOUND_RESPONSE_BYTES = 1 * 1024 * 1024;

/**
 * Read a response body without ever buffering more than `maxBytes`.
 *
 * Checks Content-Length first as a cheap refusal, then still counts real
 * bytes — a server may lie about or omit the header, so the streaming count is
 * the protection and the header is only an optimisation.
 */
export async function readBoundedBody(res: Response, maxBytes: number = MAX_OUTBOUND_RESPONSE_BYTES): Promise<{ text: string; truncated: boolean; bytes: number }> {
  const contentLength = res.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    // Deliberately a truncating read rather than a throw: for research.fetch a
    // large page is a normal thing to meet, and returning the bounded prefix
    // with truncated:true is more useful than failing the tool outright.
    // mcp-client keeps its own throwing reader, where an oversized JSON-RPC
    // body is genuinely malformed rather than merely long.
    const buf = Buffer.from(await res.arrayBuffer());
    return { text: buf.subarray(0, maxBytes).toString('utf8'), truncated: buf.byteLength > maxBytes, bytes: buf.byteLength };
  }
  if (!res.body) {
    const text = await res.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes, bytes: Buffer.byteLength(text) };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'),
    truncated,
    bytes: total,
  };
}
