import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// The ONE client-side source of model identity: GET /api/registry/models,
// which reads the persisted local registry. Opening a selector, rendering a
// page or creating a task never contacts a provider (the response states
// providerCallsMade: 0). No model name is hardcoded anywhere in the client.
// ---------------------------------------------------------------------------

export interface RegistryBlocker { state: string; reason: string }

export interface RegistryModel {
  providerId: string;
  providerDisplayName: string;
  modelId: string;
  displayName: string;
  aliases: string[];
  lifecycle: string;
  limits: { contextTokens: number | null; outputTokens: number | null };
  modalities: { input: string[]; output: string[] };
  capabilities: Array<{ id: string; supported: boolean; verification: string; source: string }>;
  outputContracts: string[];
  protocol: string;
  source: string;
  manifestVersion: string;
  adminState: string;
  availability: string;
  executable: boolean;
  blockers: RegistryBlocker[];
  pricing: { state: string; current: { rates: { input: number; output: number; cachedInput: number | null }; unit: string; currency: string; staleAfter: string; source: string } | null; versionKey: string | null };
  paid: boolean;
}

export interface RegistryProvider {
  providerId: string;
  displayName: string;
  protocol: string;
  adapterDispatch: string;
  manifestVersion: string;
  source: string;
  approvedHosts: string[];
  endpoint: { ok: boolean; host: string | null; overridden: boolean; reason: string | null };
  credential: { ready: boolean; source: string };
  billing: string;
  modelCount: number;
  executableCount: number;
  health: string;
}

export interface RegistryState {
  models: RegistryModel[];
  providers: RegistryProvider[];
  states: string[];
  workspacePolicy: { mode: string; allowed: string[]; denied: string[] } | null;
  manualDiscoveryEnabled: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Canonical selection key. Everything that selects a model uses exactly this. */
export const modelKey = (m: { providerId: string; modelId: string }) => `${m.providerId}/${m.modelId}`;

export function useModelRegistry(workspaceId: string | undefined, opts: { outputContract?: string; capability?: string } = {}): RegistryState {
  const [data, setData] = useState<Omit<RegistryState, 'loading' | 'error' | 'reload'>>({ models: [], providers: [], states: [], workspacePolicy: null, manualDiscoveryEnabled: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ workspaceId });
    if (opts.outputContract) q.set('outputContract', opts.outputContract);
    if (opts.capability) q.set('capability', opts.capability);
    fetch(`/api/registry/models?${q.toString()}`)
      .then(async (res) => {
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !j?.success) { setError(j?.error || `HTTP ${res.status}`); return; }
        setError(null);
        setData({ models: j.models || [], providers: j.providers || [], states: j.states || [], workspacePolicy: j.workspacePolicy || null, manualDiscoveryEnabled: !!j.manualDiscoveryEnabled });
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Network error reading the model registry.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, opts.outputContract, opts.capability, tick]);

  return { ...data, loading, error, reload };
}

/**
 * The workspace a component outside App's prop chain should read the registry
 * for: the one App last activated (same storage key App writes). Only used to
 * scope the registry view (permissions); it grants nothing.
 */
export function lastActiveWorkspaceId(): string {
  try {
    return localStorage.getItem('synthos_last_workspace_id') || 'ws-synthos-primary';
  } catch {
    return 'ws-synthos-primary';
  }
}
