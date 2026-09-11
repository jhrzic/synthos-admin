// ---------------------------------------------------------------------------
// AUTHORIZED EMBED ORIGINS
//
// The one place that decides which websites may embed a business's assistant.
// It is deliberately small, deliberately strict, and deliberately the only
// thing that ever reaches a Content-Security-Policy header.
//
// WHY THIS FILE EXISTS AT ALL
//
// The app sets `frame-ancestors 'none'` site-wide, which is correct: nothing
// in SynthOS Admin should ever be framed. But the customer-facing assistant is
// the exact opposite case — being framed on someone else's website IS the
// product. Relaxing that globally would hand clickjacking a door into the
// admin console, so the relaxation is scoped to one route and driven by an
// allowlist the business owner controls.
//
// THE ATTACK THIS IS SHAPED AGAINST
//
// An allowlist of origins is only as good as its comparison. Naive checks fail
// in ways that are easy to miss and total when they happen:
//
//   endsWith('example.com')      → notexample.com passes
//   startsWith('https://ex')     → https://ex.evil.com passes
//   host comparison only         → http://example.com passes an https entry
//   accepting a path or query    → the CSP value gets attacker-shaped text
//
// So an entry is parsed into a real URL, reduced to scheme + host + explicit
// port, and compared as an exact string. Nothing else is ever compared.
// ---------------------------------------------------------------------------

export interface OriginValidation {
  ok: boolean;
  /** The canonical `scheme://host[:port]` form actually stored and compared. */
  origin?: string;
  reason?: string;
}

const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

/** Hosts allowed to use plain http, because there is no other way to develop against a local site. */
function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

/**
 * Parse and canonicalize one owner-supplied origin.
 *
 * Accepts `https://example.com` or a bare `example.com` (assumed https, which
 * is the safe assumption rather than the permissive one). Refuses everything
 * that is not a plain web origin.
 */
export function normalizeOrigin(input: unknown, opts: { requireHttps?: boolean } = {}): OriginValidation {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'Empty value.' };
  if (raw === '*' || raw.includes('*')) {
    return { ok: false, reason: 'Wildcards are not accepted. List each website origin exactly.' };
  }
  if (raw.length > 255) return { ok: false, reason: 'Too long to be a website origin.' };

  // A scheme-less entry is the common case when a person types their website.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'Not a valid website address.' };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    // javascript:, data:, file:, chrome-extension: and friends all land here.
    return { ok: false, reason: `Only http and https website addresses are accepted (got "${url.protocol.replace(':', '')}").` };
  }
  if (!url.hostname) return { ok: false, reason: 'No website host in that address.' };
  if (url.username || url.password) return { ok: false, reason: 'Credentials are not allowed in a website address.' };

  const local = isLocalHost(url.hostname);

  // A single-label host is a typo, not a website. Without this, "my-website"
  // is silently stored as https://my-website and the owner is left with an
  // allowlist that looks configured and authorizes nothing they meant.
  // Localhost forms and bare IPs are the legitimate dotless/short cases.
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);
  const isBracketedIpv6 = url.hostname.startsWith('[');
  if (!local && !isIpv4 && !isBracketedIpv6 && !url.hostname.includes('.')) {
    return { ok: false, reason: 'That is not a complete website address — it needs a domain, like example.com.' };
  }
  if (url.protocol === 'http:' && !local && opts.requireHttps !== false) {
    return { ok: false, reason: 'Only https websites may embed the assistant (http is allowed for localhost during development).' };
  }

  // url.origin drops a default port and keeps a non-default one, which is
  // exactly the canonical form a browser compares frame-ancestors against.
  return { ok: true, origin: url.origin };
}

/**
 * Is this request Origin one of the authorized ones?
 *
 * Exact string equality against canonical origins — never a prefix, suffix or
 * substring test. `null` and the literal string "null" (a sandboxed iframe, a
 * `file://` page, some redirects) are never authorized; an opaque origin has
 * no identity to authorize.
 */
export function isOriginAuthorized(requestOrigin: string | undefined | null, allowed: string[]): boolean {
  if (!requestOrigin || requestOrigin === 'null') return false;
  if (allowed.length === 0) return false;
  let canonical: string;
  try {
    canonical = new URL(requestOrigin).origin;
  } catch {
    return false;
  }
  if (canonical === 'null') return false;
  return allowed.some((a) => a === canonical);
}

/**
 * The frame-ancestors value for one assistant's embed route.
 *
 * With no authorized origins this returns `'none'` — the standalone page keeps
 * working, and third-party embedding is denied. That is the safe default and
 * the one a newly created assistant starts at: publishing does not silently
 * make a business embeddable anywhere.
 */
export function frameAncestorsFor(allowed: string[]): string {
  const safe = allowed.filter((o) => normalizeOrigin(o, { requireHttps: false }).ok);
  return safe.length === 0 ? "'none'" : safe.join(' ');
}

/**
 * The CSP for the embeddable assistant page.
 *
 * Identical to the app-wide policy except for frame-ancestors, and built here
 * rather than by string-editing the global header so the two can never drift
 * into each other. `connect-src 'self'` matters: even framed on someone else's
 * site, the widget can only talk back to this server.
 */
export function assistantPageCsp(allowed: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src 'self' blob:",          // TTS audio arrives as a blob: URL
    "connect-src 'self'",
    `frame-ancestors ${frameAncestorsFor(allowed)}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
