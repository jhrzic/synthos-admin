import { useState, useEffect, useCallback } from 'react';
import { HermesAdapterHealth } from '../types/hermes';

/**
 * fix(hermes): unify runtime status across admin UI.
 *
 * Before this, three places rendered a Hermes status and disagreed:
 * AirbyteHeader's top-bar pill and WorkspaceTopNav's own "Evidence-Based
 * Status Pill" each independently re-derived a label/color from
 * hermesHealth.status (two separate ternary chains, easy to drift), while
 * WorkspaceTopNav's static `configs.hermes` object additionally carried a
 * hardcoded `statusText: 'LIVE'` and its Chat sub-tab carried a hardcoded
 * `badge: 'LIVE'` — neither wired to useHermesHealth() at all, so they
 * claimed "LIVE" unconditionally regardless of whether HERMES_ADAPTER_
 * BASE_URL was even configured.
 *
 * This is the one place that decision is made now. Every Hermes status
 * display imports this instead of re-deriving its own mapping.
 */
export type HermesDisplayStatus = 'CONNECTED' | 'DEGRADED' | 'NOT CONNECTED' | 'NOT CONFIGURED';

export interface HermesDisplayStatusInfo {
  label: HermesDisplayStatus;
  color: string;
}

/**
 * Maps the real HermesAdapterHealth (from /api/hermes/health ->
 * HermesAdapter.health(), see docs/adr-001-hermes-adapter-governance.md)
 * to exactly one of the four truthful states the admin UI is allowed to
 * show. Never returns "LIVE" — that word does not describe evidence, only
 * a workspace existing.
 *
 * - auth_status === 'NOT_CONFIGURED' takes priority: this is the real,
 *   specific reason HermesAdapter.health() reports when
 *   HERMES_ADAPTER_BASE_URL is unset (see hermesAdapter.ts) — distinct
 *   from a base URL that IS configured but unreachable.
 * - status 'UP' -> CONNECTED, 'DEGRADED' -> DEGRADED.
 * - everything else (DOWN, NOT_CONNECTED, AUTH_ERROR, UNKNOWN) collapses to
 *   NOT CONNECTED — none of those are a usable connection, and none of
 *   them are "LIVE".
 */
export function deriveHermesDisplayStatus(health: HermesAdapterHealth): HermesDisplayStatusInfo {
  if (health.auth_status === 'NOT_CONFIGURED') {
    return { label: 'NOT CONFIGURED', color: '#7E8BB5' };
  }
  if (health.status === 'UP') {
    return { label: 'CONNECTED', color: '#00D26A' };
  }
  if (health.status === 'DEGRADED') {
    return { label: 'DEGRADED', color: '#F59E0B' };
  }
  return { label: 'NOT CONNECTED', color: '#EF4444' };
}

const DEFAULT_HEALTH: HermesAdapterHealth = {
  status: 'NOT_CONNECTED',
  connectivity_status: 'NOT_CONNECTED',
  auth_status: 'NOT_CONFIGURED',
  runtime_type: 'hermes',
  runtime_version: 'NOT_AVAILABLE',
  adapter_version: '1',
  runtime_instance_id: 'NOT_AVAILABLE',
  capabilities_schema_version: '1',
  process_alive: false,
  gateway_alive: null,
  timestamp: new Date().toISOString(),
};

/**
 * Hook to poll Hermes runtime health via the adapter-backed API.
 * Follows ADR-001 strict polling rule (poll interval = 15s).
 */
export function useHermesHealth(pollIntervalMs: number = 15000) {
  const [health, setHealth] = useState<HermesAdapterHealth>(DEFAULT_HEALTH);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setError(null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setHealth({
          status: 'AUTH_ERROR',
          connectivity_status: 'AUTH_ERROR',
          auth_status: 'AUTH_ERROR',
          runtime_type: 'hermes',
          runtime_version: 'NOT_AVAILABLE',
          adapter_version: '1',
          runtime_instance_id: 'NOT_AVAILABLE',
          capabilities_schema_version: '1',
          process_alive: false,
          gateway_alive: null,
          timestamp: new Date().toISOString(),
          error: errData.error || `HTTP ${res.status} error fetching health`,
        });
        setError(errData.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setHealth({
        status: 'NOT_CONNECTED',
        connectivity_status: 'NOT_CONNECTED',
        auth_status: 'NOT_CONFIGURED',
        runtime_type: 'hermes',
        runtime_version: 'NOT_AVAILABLE',
        adapter_version: '1',
        runtime_instance_id: 'NOT_AVAILABLE',
        capabilities_schema_version: '1',
        process_alive: false,
        gateway_alive: null,
        timestamp: new Date().toISOString(),
        error: err.message,
      });
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    // Strict 15-second polling interval (no slower than 15s, no high frequency spam)
    const timer = setInterval(fetchHealth, Math.max(15000, pollIntervalMs));
    return () => clearInterval(timer);
  }, [fetchHealth, pollIntervalMs]);

  return { health, isLoading, error, refresh: fetchHealth };
}
