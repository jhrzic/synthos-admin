// ---------------------------------------------------------------------------
// THE PUBLIC BASE URL
//
// One place decides what this server's externally-reachable address is. Every
// URL a business copies out of the product — the assistant link, the embed
// snippet — is built from it.
//
// THE PRODUCTION BUG THIS EXISTS TO PREVENT
//
// The embed snippet used to be built from `req.protocol` + the Host header.
// Behind a TLS-terminating reverse proxy (this project deploys behind Caddy,
// see docs/deploy/Caddyfile.example) the app receives plain HTTP, so
// `req.protocol` is "http" unless TRUST_PROXY_HOPS is set. The business would
// then be handed:
//
//     <script src="http://admin.example.com/a/embed.js" ...>
//
// and paste it onto their HTTPS website, where the browser blocks it as mixed
// content — silently. No error the business can act on, no assistant, and
// nothing in the product admitting anything is wrong.
//
// So: an explicit PUBLIC_BASE_URL wins over any inference, inference is
// proxy-aware, and when the result is not https in production the product says
// so out loud rather than handing over a snippet that cannot work.
// ---------------------------------------------------------------------------

export interface PublicBaseUrl {
  /** Origin only, no trailing slash: https://admin.example.com */
  origin: string;
  source: 'PUBLIC_BASE_URL' | 'forwarded_proto' | 'request';
  /** https, or http on a local development host. */
  secure: boolean;
  /**
   * Set when the derived URL will not work for a real customer. Surfaced to the
   * owner; never silently swallowed.
   */
  warning: string | null;
}

interface MinimalRequest {
  protocol?: string;
  headers?: Record<string, unknown>;
  get?: (name: string) => string | undefined;
}

function header(req: MinimalRequest, name: string): string {
  const viaGet = req.get?.(name);
  if (typeof viaGet === 'string' && viaGet) return viaGet;
  const raw = req.headers?.[name.toLowerCase()];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return '';
}

function isLocalHost(host: string): boolean {
  const h = host.split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
}

export function resolvePublicBaseUrl(req: MinimalRequest, opts: { isProduction?: boolean } = {}): PublicBaseUrl {
  const isProduction = opts.isProduction ?? process.env.NODE_ENV === 'production';

  // 1. An operator who states it explicitly is always right. This is the only
  //    form that survives any proxy arrangement, including several hops.
  const configured = (process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        const secure = url.protocol === 'https:' || isLocalHost(url.host);
        return {
          origin: url.origin,
          source: 'PUBLIC_BASE_URL',
          secure,
          warning: secure ? null
            : 'PUBLIC_BASE_URL is set to a plain http address. Browsers block an http widget on an https website, so the embed code will not work.',
        };
      }
    } catch { /* fall through to inference, and warn below */ }
    return {
      origin: '', source: 'PUBLIC_BASE_URL', secure: false,
      warning: `PUBLIC_BASE_URL is set but is not a valid http(s) address, so no usable public link can be produced.`,
    };
  }

  // 2. Infer. X-Forwarded-Proto is what a TLS-terminating proxy sets, and is
  //    the only reason this app ever sees "http" while the world sees "https".
  const host = header(req, 'host');
  const forwardedProto = header(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const proto = forwardedProto || req.protocol || 'http';
  const local = isLocalHost(host);
  const secure = proto === 'https' || local;

  let warning: string | null = null;
  if (!host) {
    warning = 'No Host header on this request, so the public address could not be determined. Set PUBLIC_BASE_URL.';
  } else if (isProduction && !secure) {
    warning = forwardedProto
      ? `This server sees "${forwardedProto}" as the public protocol. Browsers block an http widget on an https website — set PUBLIC_BASE_URL to your real https address.`
      : 'This server cannot tell that it is served over https. Behind a reverse proxy, start it with TRUST_PROXY_HOPS=1, or set PUBLIC_BASE_URL to your real https address — otherwise the embed code will be blocked as mixed content.';
  }

  return {
    origin: host ? `${proto}://${host}` : '',
    source: forwardedProto ? 'forwarded_proto' : 'request',
    secure,
    warning,
  };
}
