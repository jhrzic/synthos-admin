/**
 * Hermes SQLite Database Service & Telemetry Engine
 * Provides read-only querying of state.db and agent-logs.db
 * Supports browser-safe in-memory querying + Node.js better-sqlite3 execution
 */

export interface HermesDbState {
  version: string;
  connected: boolean;
  stateDbPath: string;
  logsDbPath: string;
  tableCounts: {
    agents: number;
    tasks: number;
    logs: number;
    synapses: number;
  };
}

export interface AgentDbRecord {
  id: string;
  role: string;
  name: string;
  status: 'idle' | 'active' | 'evaluating' | 'routing';
  model: string;
  current_task?: string;
  tokens_used: number;
  last_active: string;
}

export interface AgentLogRecord {
  id: string;
  agent_id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, any>;
}

// Client-safe helper to query Hermes admin status.
// NOTE: /api/hermes/db-state is NOT_IMPLEMENTED (see server.ts) — ADR-001 routes
// all Hermes state through hermesAdapter, which has no local database query
// surface. This helper reports that truthfully rather than fabricating a
// "connected" state or invented table counts on failure.
export async function queryHermesState(): Promise<HermesDbState> {
  try {
    const res = await fetch('/api/hermes/db-state');
    if (res.ok) {
      const data = await res.json();
      return {
        version: data.version || 'NOT_AVAILABLE',
        connected: Boolean(data.connected),
        stateDbPath: data.stateDbPath || 'NOT_AVAILABLE',
        logsDbPath: data.logsDbPath || 'NOT_AVAILABLE',
        tableCounts: data.tableCounts || { agents: 0, tasks: 0, logs: 0, synapses: 0 },
      };
    }
  } catch (err) {
    console.warn('[Hermes DB] State API query failed:', err);
  }

  // Truthful fallback — no real data available, not a fabricated "connected" state
  return {
    version: 'NOT_AVAILABLE',
    connected: false,
    stateDbPath: 'NOT_AVAILABLE',
    logsDbPath: 'NOT_AVAILABLE',
    tableCounts: {
      agents: 0,
      tasks: 0,
      logs: 0,
      synapses: 0,
    },
  };
}

export async function fetchHermesLogs(agentId?: string): Promise<AgentLogRecord[]> {
  try {
    const url = agentId ? `/api/hermes/logs?agentId=${encodeURIComponent(agentId)}` : '/api/hermes/logs';
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : (data.logs || []);
    }
  } catch (err) {
    console.warn('[Hermes DB] Logs query failed:', err);
  }
  return [];
}
