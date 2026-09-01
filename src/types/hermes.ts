export type HermesConnectivityStatus = 
  | 'UP' 
  | 'DEGRADED' 
  | 'DOWN' 
  | 'NOT_CONNECTED' 
  | 'AUTH_ERROR' 
  | 'UNKNOWN';

export type HermesAuthStatus = 
  | 'AUTHENTICATED' 
  | 'AUTH_ERROR' 
  | 'NOT_CONFIGURED' 
  | 'UNAUTHENTICATED'
  | 'UNKNOWN';

/**
 * Shared remote health endpoint contract (GET /synthos/health)
 */
export interface HermesRemoteHealthResponse {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  runtime_type: 'hermes';
  runtime_version: string;
  runtime_instance_id: string;
  adapter_schema_version: string;
  process_alive: boolean;
  gateway_alive: boolean | null;
  timestamp: string;
}

/**
 * Standardized health state exposed by HermesAdapter.health()
 */
export interface HermesAdapterHealth {
  status: HermesConnectivityStatus;
  runtime_type: string;
  runtime_version: string;
  adapter_version: string;
  runtime_instance_id: string;
  capabilities_schema_version: string;
  connectivity_status: HermesConnectivityStatus;
  auth_status: HermesAuthStatus;
  process_alive: boolean | null;
  gateway_alive: boolean | null;
  timestamp: string;
  responseTimeMs?: number;
  error?: string;
  details?: Record<string, any>;
}

export interface HermesCapabilityItem {
  supported: boolean;
  confirmed_by: 'adapter_wiring_v1' | 'remote_runtime' | 'authoritative_data' | 'adr_001_phase_1_spec';
  status: 'CONFIRMED' | 'UNSUPPORTED' | 'NOT_IMPLEMENTED_PHASE_1' | 'UNVERIFIED';
  description?: string;
}

export interface HermesAdapterCapabilities {
  adapter_schema_version: string;
  runtime_type: 'hermes';
  capabilities: {
    health_check: HermesCapabilityItem;
    capabilities_discovery: HermesCapabilityItem;
    execute: HermesCapabilityItem;
    events: HermesCapabilityItem;
    [key: string]: HermesCapabilityItem;
  };
  confirmed_at: string;
  adapter_phase: 1;
}

export interface HermesExecuteOptions {
  taskId?: string;
  command?: string;
  payload?: Record<string, any>;
  timeoutMs?: number;
}

export interface HermesExecuteResult {
  success: boolean;
  status: 'COMPLETED' | 'FAILED' | 'REJECTED' | 'NOT_IMPLEMENTED';
  output?: string;
  error?: string;
  receiptId?: string;
}

export interface HermesEventSubscription {
  id: string;
  eventType: string;
  unsubscribe: () => void;
}

/**
 * Mandatory Hermes Adapter Interface (ADR-001 Phase 1)
 */
export interface IHermesAdapter {
  health(): Promise<HermesAdapterHealth>;
  capabilities(): Promise<HermesAdapterCapabilities>;
  execute(options: HermesExecuteOptions): Promise<HermesExecuteResult>;
  events(eventType: string, handler: (event: any) => void): HermesEventSubscription;
}
