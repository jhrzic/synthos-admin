import {
  IHermesAdapter,
  HermesAdapterHealth,
  HermesAdapterCapabilities,
  HermesExecuteOptions,
  HermesExecuteResult,
  HermesEventSubscription,
  HermesRemoteHealthResponse,
  HermesConnectivityStatus,
  HermesAuthStatus,
} from '../types/hermes';

export interface HermesAdapterConfig {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

/**
 * HermesAdapter (ADR-001 — Phase 1)
 * Administrative control plane integration adapter for the Hermes runtime.
 */
export class HermesAdapter implements IHermesAdapter {
  private baseUrl?: string;
  private token?: string;
  private timeoutMs: number;

  constructor(config?: HermesAdapterConfig) {
    // Resolve configuration from arguments or runtime environment
    const envBaseUrl =
      typeof process !== 'undefined' && process.env
        ? process.env.HERMES_ADAPTER_BASE_URL
        : typeof (globalThis as any).importMeta !== 'undefined'
        ? (globalThis as any).importMeta?.env?.VITE_HERMES_ADAPTER_BASE_URL
        : undefined;

    const envToken =
      typeof process !== 'undefined' && process.env
        ? process.env.HERMES_ADAPTER_TOKEN
        : typeof (globalThis as any).importMeta !== 'undefined'
        ? (globalThis as any).importMeta?.env?.VITE_HERMES_ADAPTER_TOKEN
        : undefined;

    this.baseUrl = config?.baseUrl || envBaseUrl;
    this.token = config?.token || envToken;
    this.timeoutMs = config?.timeoutMs ?? 5000;
  }

  /**
   * Updates credentials or base URL dynamically
   */
  public configure(config: HermesAdapterConfig): void {
    if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl;
    if (config.token !== undefined) this.token = config.token;
    if (config.timeoutMs !== undefined) this.timeoutMs = config.timeoutMs;
  }

  /**
   * Checks runtime health via GET /synthos/health
   * Follows strict ADR-001 mapping rules with 5s timeout.
   */
  public async health(): Promise<HermesAdapterHealth> {
    const timestamp = new Date().toISOString();
    const hasToken = Boolean(this.token && this.token.trim().length > 0);

    // If base URL is not configured, treat immediately as NOT_CONNECTED
    if (!this.baseUrl || this.baseUrl.trim().length === 0) {
      return {
        status: 'NOT_CONNECTED',
        connectivity_status: 'NOT_CONNECTED',
        auth_status: hasToken ? 'AUTHENTICATED' : 'NOT_CONFIGURED',
        runtime_type: 'hermes',
        runtime_version: 'NOT_AVAILABLE',
        adapter_version: '1',
        runtime_instance_id: 'NOT_AVAILABLE',
        capabilities_schema_version: '1',
        process_alive: false,
        gateway_alive: null,
        timestamp,
        error: 'HERMES_ADAPTER_BASE_URL is not configured in environment',
      };
    }

    const cleanBaseUrl = this.baseUrl.replace(/\/+$/, '');
    const healthUrl = `${cleanBaseUrl}/synthos/health`;
    const startTime = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token.trim()}`;
      }

      const response = await fetch(healthUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);
      const responseTimeMs = Date.now() - startTime;

      // Handle 401 / 403 Authentication Errors
      if (response.status === 401 || response.status === 403) {
        return {
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
          responseTimeMs,
          error: `HTTP ${response.status} Unauthorized / Forbidden — Invalid or missing HERMES_ADAPTER_TOKEN`,
        };
      }

      // Any HTTP status other than 200 (e.g. 500, 502, 404) MUST NOT produce UP, DEGRADED, or DOWN
      if (response.status !== 200) {
        return {
          status: 'UNKNOWN',
          connectivity_status: 'UNKNOWN',
          auth_status: 'UNKNOWN',
          runtime_type: 'hermes',
          runtime_version: 'NOT_AVAILABLE',
          adapter_version: '1',
          runtime_instance_id: 'NOT_AVAILABLE',
          capabilities_schema_version: '1',
          process_alive: false,
          gateway_alive: null,
          timestamp: new Date().toISOString(),
          responseTimeMs,
          error: `HTTP ${response.status} ${response.statusText || 'Error'} from upstream health endpoint`,
        };
      }

      let rawText = '';
      try {
        rawText = await response.text();
      } catch (err: any) {
        return {
          status: 'UNKNOWN',
          connectivity_status: 'UNKNOWN',
          auth_status: 'UNKNOWN',
          runtime_type: 'hermes',
          runtime_version: 'NOT_AVAILABLE',
          adapter_version: '1',
          runtime_instance_id: 'NOT_AVAILABLE',
          capabilities_schema_version: '1',
          process_alive: false,
          gateway_alive: null,
          timestamp: new Date().toISOString(),
          responseTimeMs,
          error: `Failed to read response body: ${err.message}`,
        };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawText);
      } catch (jsonErr: any) {
        // Non-JSON response -> UNKNOWN
        return {
          status: 'UNKNOWN',
          connectivity_status: 'UNKNOWN',
          auth_status: 'UNKNOWN',
          runtime_type: 'hermes',
          runtime_version: 'NOT_AVAILABLE',
          adapter_version: '1',
          runtime_instance_id: 'NOT_AVAILABLE',
          capabilities_schema_version: '1',
          process_alive: false,
          gateway_alive: null,
          timestamp: new Date().toISOString(),
          responseTimeMs,
          error: `Malformed non-JSON payload from upstream health endpoint (HTTP ${response.status}): ${rawText.slice(0, 100)}`,
        };
      }

      // Strict validation of all mandatory health contract fields
      const isStatusValid = parsed?.status === 'UP' || parsed?.status === 'DEGRADED' || parsed?.status === 'DOWN';
      const isRuntimeTypeValid = parsed?.runtime_type === 'hermes';
      const isRuntimeVersionValid = typeof parsed?.runtime_version === 'string' && parsed.runtime_version.trim().length > 0;
      const isRuntimeInstanceIdValid = typeof parsed?.runtime_instance_id === 'string' && parsed.runtime_instance_id.trim().length > 0;
      const isAdapterSchemaValid = parsed?.adapter_schema_version === '1';
      const isProcessAliveValid = typeof parsed?.process_alive === 'boolean';
      const isGatewayAliveValid = typeof parsed?.gateway_alive === 'boolean' || parsed?.gateway_alive === null;
      const isTimestampValid = typeof parsed?.timestamp === 'string' && !isNaN(Date.parse(parsed.timestamp));

      const isContractValid =
        typeof parsed === 'object' &&
        parsed !== null &&
        isStatusValid &&
        isRuntimeTypeValid &&
        isRuntimeVersionValid &&
        isRuntimeInstanceIdValid &&
        isAdapterSchemaValid &&
        isProcessAliveValid &&
        isGatewayAliveValid &&
        isTimestampValid;

      if (!isContractValid) {
        return {
          status: 'UNKNOWN',
          connectivity_status: 'UNKNOWN',
          auth_status: 'AUTHENTICATED',
          runtime_type: 'hermes',
          runtime_version: 'NOT_AVAILABLE',
          adapter_version: '1',
          runtime_instance_id: 'NOT_AVAILABLE',
          capabilities_schema_version: '1',
          process_alive: false,
          gateway_alive: null,
          timestamp: new Date().toISOString(),
          responseTimeMs,
          error: 'Malformed or incomplete health contract schema from upstream runtime (missing/invalid required fields)',
        };
      }

      // Authoritative valid contract response: use supplied process_alive directly (never infer)
      return {
        status: parsed.status,
        connectivity_status: parsed.status,
        auth_status: 'AUTHENTICATED',
        runtime_type: 'hermes',
        runtime_version: parsed.runtime_version,
        adapter_version: parsed.adapter_schema_version,
        runtime_instance_id: parsed.runtime_instance_id,
        capabilities_schema_version: parsed.adapter_schema_version,
        process_alive: parsed.process_alive,
        gateway_alive: parsed.gateway_alive,
        timestamp: parsed.timestamp,
        responseTimeMs,
        details: parsed,
      };
    } catch (fetchError: any) {
      clearTimeout(timer);
      const responseTimeMs = Date.now() - startTime;

      // Timeout or Network Failure -> NOT_CONNECTED
      return {
        status: 'NOT_CONNECTED',
        connectivity_status: 'NOT_CONNECTED',
        auth_status: hasToken ? 'AUTHENTICATED' : 'NOT_CONFIGURED',
        runtime_type: 'hermes',
        runtime_version: 'NOT_AVAILABLE',
        adapter_version: '1',
        runtime_instance_id: 'NOT_AVAILABLE',
        capabilities_schema_version: '1',
        process_alive: false,
        gateway_alive: null,
        timestamp: new Date().toISOString(),
        responseTimeMs,
        error: fetchError.name === 'AbortError'
          ? `Connection timed out after ${this.timeoutMs}ms`
          : `Network connection failed: ${fetchError.message}`,
      };
    }
  }

  /**
   * Returns authoritative capabilities confirmed by current adapter wiring.
   */
  public async capabilities(): Promise<HermesAdapterCapabilities> {
    return {
      adapter_schema_version: '1',
      runtime_type: 'hermes',
      capabilities: {
        health_check: {
          supported: true,
          confirmed_by: 'adapter_wiring_v1',
          status: 'CONFIRMED',
          description: 'Hermes runtime health check protocol (GET /synthos/health) with 5s timeout',
        },
        capabilities_discovery: {
          supported: true,
          confirmed_by: 'adapter_wiring_v1',
          status: 'CONFIRMED',
          description: 'Authoritative schema v1 capability introspection',
        },
        execute: {
          supported: false,
          confirmed_by: 'adr_001_phase_1_spec',
          status: 'NOT_IMPLEMENTED_PHASE_1',
          description: 'Task execution protocol deferred to ADR-001 Phase 2',
        },
        events: {
          supported: false,
          confirmed_by: 'adr_001_phase_1_spec',
          status: 'NOT_IMPLEMENTED_PHASE_1',
          description: 'Event streaming and SSE hooks deferred to ADR-001 Phase 2',
        },
      },
      confirmed_at: new Date().toISOString(),
      adapter_phase: 1,
    };
  }

  /**
   * Mandatory primitive stub for Phase 1 interface compliance.
   * Execution behavior deferred to Phase 2.
   */
  public async execute(_options: HermesExecuteOptions): Promise<HermesExecuteResult> {
    return {
      success: false,
      status: 'NOT_IMPLEMENTED',
      error: 'Hermes execute() is not implemented in ADR-001 Phase 1',
    };
  }

  /**
   * Mandatory primitive stub for Phase 1 interface compliance.
   * Event stream behavior deferred to Phase 2.
   */
  public events(eventType: string, _handler: (event: any) => void): HermesEventSubscription {
    return {
      id: `hermes-sub-${Date.now()}`,
      eventType,
      unsubscribe: () => {
        // No-op for Phase 1
      },
    };
  }
}

// Export singleton instance for system-wide consumption
export const hermesAdapter = new HermesAdapter();
