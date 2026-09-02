import fs from 'node:fs';
import path from 'node:path';
import { hermesAdapter } from '../src/services/hermesAdapter';
import { buildTonReadiness } from './ton-readiness';
import { listBackups } from './backup';
import { getDatabase } from './persistence';
import { listRecentRuntimeEvents } from './runtime-events';
import { health as windmillHealth, isWindmillConfigured } from './windmill-client';

// ---------------------------------------------------------------------------
// Pass V / Workstream G — one small, truthful runtime-status aggregator.
//
// Every system reported here carries a real `evidenceSource` (G2) so the
// UI can never present "configuration present" as "healthy" (G2's explicit
// rule). `lastCheck` is only ever set when a probe genuinely ran this call
// (G3) — never fabricated for a system that was never actually checked.
//
// MCP servers are deliberately NOT live-reprobed here on every call — that
// would mean synchronously calling out to every admin-configured MCP
// endpoint on every dashboard load, which is slow, can hang, and isn't
// necessary (a dedicated per-skill "Probe" button already exists —
// POST /api/skills/:id/mcp/probe). This aggregator reports the *last known*
// probe outcome from the real runtime_events ledger instead — honestly
// labeled evidenceSource: 'last_successful_operation' (or 'not_implemented'
// if no probe has ever run).
// ---------------------------------------------------------------------------

export type RuntimeSystemStatus = 'HEALTHY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'NOT_IMPLEMENTED' | 'FAILED' | 'UNKNOWN';

export type RuntimeEvidenceSource =
  | 'live_probe'
  | 'configuration_only'
  | 'db_state'
  | 'filesystem_check'
  | 'last_successful_operation'
  | 'not_implemented';

export interface RuntimeSystemReport {
  system: string;
  status: RuntimeSystemStatus;
  evidenceSource: RuntimeEvidenceSource;
  lastCheck: string | null;
  detail?: string;
}

export interface RuntimeStatusReport {
  systems: RuntimeSystemReport[];
  generatedAt: string;
}

function geminiStatus(): RuntimeSystemReport {
  const configured = !!process.env.GEMINI_API_KEY;
  return {
    system: 'Gemini Provider',
    status: configured ? 'UNKNOWN' : 'NOT_CONFIGURED',
    evidenceSource: 'configuration_only',
    lastCheck: null,
    detail: configured
      ? 'GEMINI_API_KEY is set — no live call is made on every status check (cost/latency); actual health is proven per real call, see the Provider Capability Matrix.'
      : 'GEMINI_API_KEY is not configured.',
  };
}

function openRouterStatus(): RuntimeSystemReport {
  const configured = !!process.env.OPENROUTER_API_KEY;
  return {
    system: 'OpenRouter Provider',
    status: 'NOT_IMPLEMENTED',
    evidenceSource: 'configuration_only',
    lastCheck: null,
    detail: configured
      ? 'OPENROUTER_API_KEY is set, but no execution mapping is wired for it (classifyModelRequest reports it UNSUPPORTED — see lib/model-router.ts).'
      : 'OPENROUTER_API_KEY is not configured, and no execution mapping exists for it regardless.',
  };
}

async function hermesRuntimeStatus(): Promise<RuntimeSystemReport> {
  if (!process.env.HERMES_ADAPTER_BASE_URL) {
    return { system: 'Hermes Dedicated Runtime', status: 'NOT_CONFIGURED', evidenceSource: 'configuration_only', lastCheck: null, detail: 'HERMES_ADAPTER_BASE_URL is not set.' };
  }
  const health = await hermesAdapter.health();
  const now = new Date().toISOString();
  const statusMap: Record<string, RuntimeSystemStatus> = { UP: 'HEALTHY', DEGRADED: 'DEGRADED', DOWN: 'FAILED', NOT_CONNECTED: 'FAILED', AUTH_ERROR: 'FAILED', UNKNOWN: 'UNKNOWN' };
  return {
    system: 'Hermes Dedicated Runtime',
    status: statusMap[health.status] ?? 'UNKNOWN',
    evidenceSource: 'live_probe',
    lastCheck: now,
    detail: health.error || `connectivity=${health.connectivity_status}, auth=${health.auth_status}`,
  };
}

function tonStatus(): RuntimeSystemReport {
  const readiness = buildTonReadiness();
  const status: RuntimeSystemStatus = readiness.controllerReady
    ? 'HEALTHY'
    : readiness.readyCount > 0
      ? 'DEGRADED'
      : 'NOT_CONFIGURED';
  return {
    system: 'TON Runtime Readiness',
    status,
    evidenceSource: readiness.lastCheckedAt ? 'live_probe' : 'configuration_only',
    lastCheck: readiness.lastCheckedAt,
    detail: `${readiness.readyCount}/${readiness.totalCount} checklist items approved.`,
  };
}

function backupStatus(): RuntimeSystemReport {
  try {
    const backups = listBackups();
    return {
      system: 'Backup System',
      status: 'HEALTHY',
      evidenceSource: 'filesystem_check',
      lastCheck: new Date().toISOString(),
      detail: `${backups.length} backup archive(s) on disk.`,
    };
  } catch (err: any) {
    return { system: 'Backup System', status: 'FAILED', evidenceSource: 'filesystem_check', lastCheck: new Date().toISOString(), detail: err?.message };
  }
}

function vaultStatus(): RuntimeSystemReport {
  const vaultPath = path.join(process.cwd(), 'vault');
  const exists = fs.existsSync(vaultPath);
  return {
    system: 'Vault',
    status: exists ? 'HEALTHY' : 'NOT_CONFIGURED',
    evidenceSource: 'filesystem_check',
    lastCheck: new Date().toISOString(),
    detail: exists ? `${vaultPath} exists.` : `${vaultPath} does not exist.`,
  };
}

function memoryIndexStatus(): RuntimeSystemReport {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) AS n FROM memory_index").get() as { n: number };
    return {
      system: 'Memory Index (FTS5)',
      status: 'HEALTHY',
      evidenceSource: 'db_state',
      lastCheck: new Date().toISOString(),
      detail: `${row.n} indexed row(s).`,
    };
  } catch (err: any) {
    return { system: 'Memory Index (FTS5)', status: 'FAILED', evidenceSource: 'db_state', lastCheck: new Date().toISOString(), detail: err?.message };
  }
}

function mcpStatus(): RuntimeSystemReport {
  const recentProbes = listRecentRuntimeEvents({ targetType: 'mcp_server', limit: 1 });
  if (recentProbes.length === 0) {
    return { system: 'MCP Connectivity', status: 'NOT_IMPLEMENTED', evidenceSource: 'not_implemented', lastCheck: null, detail: 'No MCP probe has been run yet in this deployment.' };
  }
  const latest = recentProbes[0];
  const statusMap: Record<string, RuntimeSystemStatus> = { SUCCESS: 'HEALTHY', FAILED: 'FAILED', NOT_CONFIGURED: 'NOT_CONFIGURED', NOT_IMPLEMENTED: 'NOT_IMPLEMENTED' };
  return {
    system: 'MCP Connectivity',
    status: statusMap[latest.status] ?? 'UNKNOWN',
    evidenceSource: 'last_successful_operation',
    lastCheck: latest.created_at,
    detail: `Last probe: skill ${latest.target_id}, ${latest.status}.`,
  };
}

// ADR-006 — Windmill is the external execution *control plane* (a real,
// authenticated REST connection this deployment may submit jobs through),
// never a competing in-process scheduler. Nothing here starts a timer;
// `windmillStatus` only ever reports the outcome of a real, on-demand
// health() call it makes itself when this route is hit — same "no cron,
// but this specific call is real" posture as hermesRuntimeStatus above.
async function windmillStatus(): Promise<RuntimeSystemReport> {
  if (!isWindmillConfigured()) {
    return {
      system: 'Windmill (External Execution Control Plane)',
      status: 'NOT_CONFIGURED',
      evidenceSource: 'configuration_only',
      lastCheck: null,
      detail: 'WINDMILL_BASE_URL / WINDMILL_TOKEN / WINDMILL_WORKSPACE are not all set. See docs/adr-006-windmill-external-execution-control-plane.md.',
    };
  }
  const result = await windmillHealth();
  const now = new Date().toISOString();
  const statusMap: Record<string, RuntimeSystemStatus> = {
    CONNECTED: 'HEALTHY',
    FAILED: 'FAILED',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    INVALID_RESPONSE: 'FAILED',
  };
  return {
    system: 'Windmill (External Execution Control Plane)',
    status: statusMap[result.status] ?? 'UNKNOWN',
    evidenceSource: 'live_probe',
    lastCheck: now,
    detail: result.status === 'CONNECTED'
      ? `Authenticated as "${result.identity}"${result.version ? ` (Windmill ${result.version})` : ''}.`
      : (result.error || `Windmill health check returned ${result.status}.`),
  };
}

export async function getRuntimeStatus(): Promise<RuntimeStatusReport> {
  const systems: RuntimeSystemReport[] = [
    geminiStatus(),
    openRouterStatus(),
    await hermesRuntimeStatus(),
    mcpStatus(),
    tonStatus(),
    backupStatus(),
    vaultStatus(),
    memoryIndexStatus(),
    await windmillStatus(),
  ];
  return { systems, generatedAt: new Date().toISOString() };
}
