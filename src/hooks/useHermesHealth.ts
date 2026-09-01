import { useState, useEffect, useCallback } from 'react';
import { HermesAdapterHealth } from '../types/hermes';

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
