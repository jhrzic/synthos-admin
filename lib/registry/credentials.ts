// ---------------------------------------------------------------------------
// REGISTRY — credential readiness, by credential SLOT (never by provider name).
//
// A provider manifest names a credential slot and/or env vars. Slots with an
// encrypted server store (the model-credentials slots, the Antigravity runtime
// slot) resolve through their existing authority; anything else resolves from
// the manifest's env vars. The key value is returned only to the dispatch
// path; readiness reports carry presence and source, never the value.
// ---------------------------------------------------------------------------

import { resolveModelApiKey, isModelProvider } from '../model-credentials';
import { resolveAntigravityApiKey } from '../antigravity-client';
import type { ProviderManifestBody } from './types';

export type CredentialSource = 'environment' | 'server_store' | 'none' | 'not_required';

const SLOT_RESOLVERS: Record<string, () => { apiKey: string; source: CredentialSource }> = {
  antigravity: () => {
    const r = resolveAntigravityApiKey();
    return { apiKey: r.apiKey, source: r.apiKey ? (String(r.source).endsWith('_env') ? 'environment' : 'server_store') : 'none' };
  },
};

export function resolveProviderCredential(provider: Pick<ProviderManifestBody, 'auth'>): { apiKey: string; source: CredentialSource } {
  if (provider.auth.type === 'NONE') return { apiKey: '', source: 'not_required' };
  for (const v of provider.auth.envVars) {
    const k = String(process.env[v] || '').trim();
    if (k) return { apiKey: k, source: 'environment' };
  }
  const slot = provider.auth.credentialSlot;
  if (slot && isModelProvider(slot)) {
    const r = resolveModelApiKey(slot);
    return { apiKey: r.apiKey, source: r.apiKey ? (r.source === 'environment' ? 'environment' : 'server_store') : 'none' };
  }
  if (slot && SLOT_RESOLVERS[slot]) return SLOT_RESOLVERS[slot]();
  return { apiKey: '', source: 'none' };
}

/** Presence and provenance only. */
export function credentialReadiness(provider: Pick<ProviderManifestBody, 'auth'>): { ready: boolean; source: CredentialSource } {
  const r = resolveProviderCredential(provider);
  return { ready: r.source === 'not_required' || !!r.apiKey, source: r.source };
}
