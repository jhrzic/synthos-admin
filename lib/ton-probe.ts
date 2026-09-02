// ---------------------------------------------------------------------------
// SYNTHOS — TON live probing, ported unchanged from the real, shipped
// implementation at ~/synthos/mission-control/src/lib/ton-probe.ts.
//
// Every outbound call is host-allowlisted (SSRF protection: only the exact
// getsynthos.com / toncenter.com hostnames, HTTPS only) and time-bounded
// (3.5s AbortController). A probe result of `undefined` means "not
// configured, not attempted" — it is never coerced into success.
// ---------------------------------------------------------------------------

import { applyTonProbe, type TonReadiness } from './ton-readiness';

const MANIFEST_HOSTS = new Set(['getsynthos.com', 'www.getsynthos.com']);
const TON_CENTER_HOSTS = new Set(['toncenter.com', 'testnet.toncenter.com']);

function allowedUrl(value: string, hosts: Set<string>, allowCustom = false): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (!allowCustom && !hosts.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(fetcher: typeof fetch, url: URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    return await fetcher(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeManifest(readiness: TonReadiness, fetcher: typeof fetch): Promise<boolean | undefined> {
  if (!readiness.manifest.configured) return undefined;
  const url = allowedUrl(readiness.manifest.url, MANIFEST_HOSTS);
  if (!url) return false;
  try {
    const response = await fetchWithTimeout(fetcher, url);
    if (!response.ok) return false;
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 1_000_000) return false;
    const manifest = await response.json() as Record<string, unknown>;
    const appUrl = allowedUrl(String(manifest.url || ''), MANIFEST_HOSTS);
    const iconUrl = allowedUrl(String(manifest.iconUrl || ''), MANIFEST_HOSTS);
    return Boolean(appUrl && iconUrl && String(manifest.name || '').trim());
  } catch {
    return false;
  }
}

async function probeRpc(readiness: TonReadiness, fetcher: typeof fetch, apiKey: string, allowCustom: boolean): Promise<boolean | undefined> {
  if (!readiness.rpc.apiKeyConfigured) return undefined;
  const base = allowedUrl(readiness.rpc.endpoint, TON_CENTER_HOSTS, allowCustom);
  if (!base) return false;
  const url = new URL(`${base.toString().replace(/\/$/, '')}/masterchainInfo`);
  try {
    const response = await fetchWithTimeout(fetcher, url, { headers: { 'X-API-Key': apiKey } });
    return response.ok;
  } catch {
    return false;
  }
}

async function probeEscrow(readiness: TonReadiness, fetcher: typeof fetch, apiKey: string, allowCustom: boolean): Promise<boolean | undefined> {
  if (!readiness.escrow.configured || !readiness.rpc.apiKeyConfigured || !readiness.escrow.address) return undefined;
  const base = allowedUrl(readiness.rpc.endpoint, TON_CENTER_HOSTS, allowCustom);
  if (!base) return false;
  const url = new URL(`${base.toString().replace(/\/$/, '')}/accountStates`);
  url.searchParams.set('address', readiness.escrow.address);
  url.searchParams.set('include_boc', 'false');
  try {
    const response = await fetchWithTimeout(fetcher, url, { headers: { 'X-API-Key': apiKey } });
    if (!response.ok) return false;
    const body = await response.json() as { accounts?: Array<{ status?: string }> };
    return body.accounts?.[0]?.status === 'active';
  } catch {
    return false;
  }
}

export async function probeTonReadiness(
  readiness: TonReadiness,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<TonReadiness> {
  const apiKey = String(env.TONCENTER_API_KEY || '').trim();
  const allowCustom = env.TON_ALLOW_CUSTOM_RPC === '1';
  const [manifest, rpc, escrowActive] = await Promise.all([
    probeManifest(readiness, fetcher),
    probeRpc(readiness, fetcher, apiKey, allowCustom),
    probeEscrow(readiness, fetcher, apiKey, allowCustom),
  ]);

  if (manifest === undefined && rpc === undefined && escrowActive === undefined) return readiness;
  return applyTonProbe(readiness, { manifest, rpc, escrowActive });
}

// Exported for tests only — not part of the source module's public surface,
// but SSRF-rejection behavior needs direct coverage.
export const __test = { allowedUrl, MANIFEST_HOSTS, TON_CENTER_HOSTS };
