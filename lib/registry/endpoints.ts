// ---------------------------------------------------------------------------
// PROVIDER ENDPOINTS — the one configuration authority for where a provider
// request (and its credential) may be sent.
//
// Every provider adapter resolves its base URL here, BEFORE a credential is
// read or a request body is built. A custom base URL (OPENAI_BASE_URL,
// GEMINI_BASE_URL, ANTIGRAVITY_BASE_URL, or any manifest's baseUrlEnvVar) is
// accepted only when:
//
//   * it parses as a URL with no embedded credentials;
//   * it is https, OR it is a loopback host AND loopback is authorized
//     (test mode, or an explicit non-production development switch);
//   * its host is one of the provider manifest's approvedHosts, OR is listed
//     in SYNTHOS_PROVIDER_HOST_ALLOWLIST (an operator's gateway), OR is an
//     authorized loopback host.
//
// Anything else FAILS CLOSED: the provider reports NOT_CONFIGURED with the
// reason. There is no silent fall back to the default host — an operator who
// set an override meant that host, and quietly using another would send their
// credential somewhere they did not choose.
// ---------------------------------------------------------------------------

import type { ProviderManifestBody } from './types';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return LOOPBACK.has(h) || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export function isTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST === 'true' || env.NODE_ENV === 'test' || env.MISSION_CONTROL_TEST_MODE === 'true';
}

/**
 * Loopback provider endpoints (test doubles, a local gateway) are permitted
 * under test, or in development when explicitly switched on. Never when
 * NODE_ENV=production.
 */
export function loopbackProvidersAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (isTestEnvironment(env)) return true;
  const flag = env === process.env ? process.env.SYNTHOS_ALLOW_LOOPBACK_PROVIDERS : env.SYNTHOS_ALLOW_LOOPBACK_PROVIDERS;
  return flag === 'true';
}

/** Operator-declared extra hosts (a corporate gateway). Comma-separated hostnames. */
export function operatorAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env === process.env ? process.env.SYNTHOS_PROVIDER_HOST_ALLOWLIST : env.SYNTHOS_PROVIDER_HOST_ALLOWLIST;
  return String(raw || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

export type EndpointResolution =
  | { ok: true; baseUrl: string; host: string; overridden: boolean }
  | { ok: false; reason: string; envVar: string | null };

export function validateEndpointUrl(raw: string, provider: Pick<ProviderManifestBody, 'approvedHosts' | 'providerId'>, env: NodeJS.ProcessEnv = process.env): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: `"${raw}" is not a valid URL` }; }
  if (url.username || url.password) return { ok: false, reason: 'the URL embeds credentials' };
  if (url.search || url.hash) return { ok: false, reason: 'a base URL must not carry a query string or fragment' };
  const host = url.hostname.toLowerCase();
  if (isLoopbackHost(host)) {
    if (!loopbackProvidersAllowed(env)) return { ok: false, reason: `loopback host ${host} is only permitted under test or with SYNTHOS_ALLOW_LOOPBACK_PROVIDERS=true outside production` };
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'only http(s) is supported' };
    return { ok: true, url };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: `a non-loopback provider endpoint must use https (got ${url.protocol})` };
  const approved = provider.approvedHosts.map((h) => h.toLowerCase());
  if (!approved.includes(host) && !operatorAllowlist(env).includes(host)) {
    return { ok: false, reason: `host ${host} is not an approved host for ${provider.providerId} (${approved.join(', ')}) and is not in SYNTHOS_PROVIDER_HOST_ALLOWLIST` };
  }
  return { ok: true, url };
}

/** Resolve where this provider's requests go. Fails closed on an invalid override. */
export function resolveProviderEndpoint(provider: ProviderManifestBody, env: NodeJS.ProcessEnv = process.env): EndpointResolution {
  const envVar = provider.baseUrlEnvVar;
  const override = envVar ? String(env[envVar] || '').trim() : '';
  const raw = override || provider.defaultBaseUrl;
  const v = validateEndpointUrl(raw, provider, env);
  if (!v.ok) {
    return { ok: false, envVar, reason: override ? `${envVar} rejected: ${v.reason}. Requests to ${provider.providerId} are refused until it is corrected or unset.` : `default base URL rejected: ${v.reason}` };
  }
  return { ok: true, baseUrl: raw.replace(/\/+$/, ''), host: v.url.host.toLowerCase(), overridden: !!override };
}
