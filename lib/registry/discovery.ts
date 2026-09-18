// ---------------------------------------------------------------------------
// MANUAL DISCOVERY — optional, explicit, audited, OFF by default.
//
// The normal system uses the local registry only. Two operations may reach
// outward, and only when an operator has switched manual discovery on AND
// initiates them:
//
//   runManualDiscovery        GET each provider's model-list endpoint
//                             (metadata only; never a generation request).
//                             New ids are recorded as UNQUALIFIED candidates
//                             in registry_discovery_candidates — they are not
//                             models, cannot be selected and cannot execute.
//   runManualPricingRefresh   GET the providers' pricing documentation into
//                             the reference catalog. It prices nothing until
//                             an operator applies it (./catalog-bridge.ts).
//
// Neither enables paid execution. A failure changes nothing in the registry.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { resolvePlatformSetting, setPlatformSetting } from '../platform-settings';
import { getDatabase } from '../persistence';
import { ensureRegistry } from './install';
import { ensureRegistryTables, recordRegistryEvent, resolveModelIdentity } from './store';

const SETTING = 'registry.manualDiscovery';

export function isManualDiscoveryEnabled(): boolean {
  return resolvePlatformSetting(SETTING, 'false').value === 'true';
}

export function setManualDiscoveryEnabled(enabled: boolean, actor: string): void {
  setPlatformSetting(SETTING, enabled ? 'true' : 'false', actor);
  recordRegistryEvent('MANUAL_DISCOVERY_SWITCHED', { actor, enabled });
}

type Refusal = { ok: false; code: 'MANUAL_DISCOVERY_DISABLED' | 'DISCOVERY_FAILED'; error: string };

export async function runManualDiscovery(actor: string): Promise<{ ok: true; report: unknown; candidates: Array<{ providerId: string; modelId: string }> } | Refusal> {
  ensureRegistry();
  if (!isManualDiscoveryEnabled()) {
    recordRegistryEvent('MANUAL_DISCOVERY_REFUSED', { actor, reason: 'disabled' });
    return { ok: false, code: 'MANUAL_DISCOVERY_DISABLED', error: 'Manual provider discovery is switched off. The registry is maintained from manifests; enable manual discovery in Admin to run it once.' };
  }
  const runId = `disc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  recordRegistryEvent('MANUAL_DISCOVERY_STARTED', { actor, runId });
  try {
    const { refreshModelCatalog, effectiveModelsForProvider } = await import('../model-discovery');
    const { CATALOG_PROVIDERS } = await import('../model-catalog');
    const report = await refreshModelCatalog('MANUAL');
    ensureRegistryTables();
    const now = new Date().toISOString();
    const candidates: Array<{ providerId: string; modelId: string }> = [];
    const ins = getDatabase().prepare('INSERT OR IGNORE INTO registry_discovery_candidates (provider_id, model_id, run_id, discovered_at) VALUES (?, ?, ?, ?)');
    const map: Record<string, string> = { google: 'gemini' };
    for (const p of CATALOG_PROVIDERS) {
      const providerId = map[p.providerId] ?? p.providerId;
      for (const m of effectiveModelsForProvider(p.providerId)) {
        if (m.source !== 'PROVIDER_API') continue;
        if (resolveModelIdentity(`${providerId}/${m.modelId}`).ok) continue;
        ins.run(providerId, m.modelId, runId, now);
        candidates.push({ providerId, modelId: m.modelId });
      }
    }
    recordRegistryEvent('MANUAL_DISCOVERY_FINISHED', { actor, runId, candidates: candidates.length });
    return { ok: true, report, candidates };
  } catch (err: any) {
    recordRegistryEvent('MANUAL_DISCOVERY_FAILED', { actor, runId, error: String(err?.message || err).slice(0, 300) });
    return { ok: false, code: 'DISCOVERY_FAILED', error: `Discovery failed; the registry is unchanged. ${String(err?.message || err).slice(0, 200)}` };
  }
}

export async function runManualPricingRefresh(actor: string): Promise<{ ok: true; report: import('../pricing/catalog').PricingRefreshReport } | Refusal> {
  ensureRegistry();
  if (!isManualDiscoveryEnabled()) {
    recordRegistryEvent('MANUAL_PRICING_REFRESH_REFUSED', { actor, reason: 'disabled' });
    return { ok: false, code: 'MANUAL_DISCOVERY_DISABLED', error: 'Manual pricing refresh is switched off. Registry prices come from manifests; enable manual discovery in Admin to run it once.' };
  }
  try {
    const { refreshPricingCatalog } = await import('../pricing/catalog');
    const report = await refreshPricingCatalog('MANUAL');
    recordRegistryEvent('MANUAL_PRICING_REFRESH', { actor, refreshId: report.refreshId, sources: report.sources.map((s) => `${s.sourceId}:${s.status}`) });
    return { ok: true, report };
  } catch (err: any) {
    return { ok: false, code: 'DISCOVERY_FAILED', error: `Pricing refresh failed; nothing changed. ${String(err?.message || err).slice(0, 200)}` };
  }
}

export function listDiscoveryCandidates(): Array<{ providerId: string; modelId: string; runId: string; discoveredAt: string }> {
  ensureRegistryTables();
  return (getDatabase().prepare('SELECT * FROM registry_discovery_candidates ORDER BY discovered_at DESC').all() as any[])
    .map((r) => ({ providerId: r.provider_id, modelId: r.model_id, runId: r.run_id, discoveredAt: r.discovered_at }));
}
