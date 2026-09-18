// ---------------------------------------------------------------------------
// REGISTRY INSTALL — bundled provider plugins, applied locally.
//
// Reads manifest files shipped with this build (no network) and imports each
// one whose content differs from what is stored. Runs lazily on first registry
// use and at startup; an unchanged manifest is a no-op, so it neither rewrites
// history nor re-logs imports on every boot.
// ---------------------------------------------------------------------------

import { BUNDLED_PLUGINS } from './plugins';
import { ensureRegistryTables, importManifest, getStoredProvider, type ImportOutcome } from './store';
import { validateManifest, canonicalJson, sha256 } from './schema';
import { getDatabase } from '../persistence';
import { setProviderEndpointSource } from '../spend/network-guard';
import { listStoredProviders } from './store';
import { resolveProviderEndpoint, operatorAllowlist, isLoopbackHost } from './endpoints';
import { resolveProviderCredential } from './credentials';

let installed = false;

// The fetch boundary learns each provider's validated endpoint, its approved
// credential hosts and its credential (compared in memory, never logged).
setProviderEndpointSource(() => {
  ensureRegistryTables();
  return listStoredProviders().map((p) => {
    const body = p.manifest.provider;
    const ep = resolveProviderEndpoint(body);
    const hosts = new Set<string>(body.approvedHosts.map((h) => h.toLowerCase()));
    for (const h of operatorAllowlist()) hosts.add(h);
    if (ep.ok) {
      // host:port exactly. A loopback endpoint never approves "127.0.0.1" in
      // general — only the one port the operator configured.
      hosts.add(ep.host);
      const hn = new URL(ep.baseUrl).hostname.toLowerCase();
      if (!isLoopbackHost(hn)) hosts.add(hn);
    }
    const cred = resolveProviderCredential(body).apiKey;
    return { endpointHosts: ep.ok ? [ep.host] : [], credentialHosts: [...hosts], credentials: cred ? [cred] : [] };
  });
});

export function installBundledPlugins(): ImportOutcome[] {
  ensureRegistryTables();
  const out: ImportOutcome[] = [];
  for (const plugin of BUNDLED_PLUGINS) {
    const v = validateManifest(plugin.manifest);
    if (v.ok) {
      // Compare with the last time THIS plugin version was applied — not with
      // the provider's current manifest, which an operator's registration or a
      // signed import may have moved on. An unchanged plugin never re-applies,
      // so it cannot revert operator decisions on every boot.
      const hash = sha256(canonicalJson(v.manifest));
      const last = getDatabase().prepare("SELECT manifest_hash FROM registry_imports WHERE source = 'PLUGIN' AND provider_id = ? AND outcome = 'APPLIED' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(v.manifest.provider.providerId) as { manifest_hash: string } | undefined;
      if (last?.manifest_hash === hash && getStoredProvider(v.manifest.provider.providerId)) continue;
    }
    out.push(importManifest(plugin.manifest, { source: 'PLUGIN', actor: 'bundled-plugin' }));
  }
  return out;
}

export function ensureRegistry(): void {
  if (installed) {
    try {
      ensureRegistryTables();
      // A different (fresh) database under the same process has no plugins yet.
      const n = (getDatabase().prepare('SELECT COUNT(*) AS n FROM registry_providers').get() as { n: number }).n;
      if (n > 0) return;
    } catch { /* fall through and install */ }
  }
  installBundledPlugins();
  installed = true;
}

/** Test hook: a fresh database needs the plugins installed again. */
export function resetRegistryInstallFlag(): void {
  installed = false;
}
