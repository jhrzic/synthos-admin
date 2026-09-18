import fs from 'node:fs';
import path from 'node:path';
import { hermesAdapter } from '../src/services/hermesAdapter';
import { buildTonReadiness } from './ton-readiness';
import { listBackups } from './backup';
import { getDatabase, getDatabasePath, getSigningPublicKey, signReceiptPayload, verifyReceiptSignature, canonicalizePayload } from './persistence';
import { listRecentRuntimeEvents } from './runtime-events';
import { health as windmillHealth, isWindmillConfigured } from './windmill-client';
import { getModelCredentialStatus, SUPPORTED_MODEL_PROVIDERS } from './model-credentials';
import { getSchedulerHealth } from './fabric/scheduler';
import { checkGuardianRules } from './kil-gate';
import { VAULT_ROOT } from './vault';
import { listQualifications } from './registry/qualification';
import { listModelViews } from './registry';
import { hermesLocalHealth, isHermesLocalConfigured, isHermesLocalEnabled } from './hermes-local-runtime';
import { resolveProviderState, type ProviderState, type ProviderStateReport } from './provider-state';
import { health as antigravityHealth, isAntigravityConfigured, isAntigravityEnabled } from './antigravity-client';

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
  /**
   * The canonical provider state (lib/provider-state.ts), for rows that
   * represent a provider or an external runtime.
   *
   * ADDITIVE ON PURPOSE. Three components consume this array today —
   * AirbyteHeader, OverviewOfficeView and MasterAdminView — and they read
   * `system`, `status`, `evidenceSource`, `lastCheck` and `detail`. Replacing
   * the outer vocabulary would have broken all three to make the schema
   * tidier, so the old fields keep their exact meaning and the precise state
   * arrives alongside them. A consumer that wants the truthful distinction
   * between "a key exists" and "a call succeeded" reads `provider.state`;
   * one that just paints a badge keeps working untouched.
   */
  provider?: ProviderStateReport;
}

/**
 * Map a canonical provider state onto the older outer vocabulary.
 *
 * The outer field is lossy by construction — it has one bucket for several
 * distinct provider states — which is exactly why `provider` exists beside
 * it. The mapping is chosen so the outer badge is never MORE optimistic than
 * the real state:
 *
 *   LIVE_VERIFIED       -> HEALTHY    a real call succeeded
 *   QUOTA_BLOCKED       -> DEGRADED   authenticated, refused on billing
 *   PROVIDER_ERROR      -> FAILED     tried, failed for another reason
 *   BROKEN_UPSTREAM     -> FAILED     tried, upstream is broken
 *   CREDENTIAL_PRESENT  -> UNKNOWN    configured, never proven
 *   NO_CREDENTIAL       -> NOT_CONFIGURED
 *   NOT_CONFIGURED      -> NOT_CONFIGURED
 *   DISABLED            -> NOT_CONFIGURED
 *
 * HEALTHY is reachable only from LIVE_VERIFIED, so no row can show green on
 * the strength of a credential.
 */
/**
 * Categories of a failed call that say nothing about the credential: the
 * request did not complete (timeout, network) or was throttled. The provider
 * is DEGRADED — it failed its last real call — but not FAILED, which is
 * reserved for failures that implicate the credential or the model access
 * (AUTHENTICATION, MODEL_NOT_FOUND) or that could not be classified.
 *
 * Found live: one 60s TIMEOUT after three successful calls on the same stored
 * key rendered "OpenAI Provider FAILED", which read as a rejected credential.
 */
export const TRANSIENT_PROVIDER_ERROR_CATEGORIES = new Set(['TIMEOUT', 'NETWORK', 'RATE_LIMIT']);

export function providerStateToRuntimeStatus(state: ProviderState, lastErrorCategory?: string | null): RuntimeSystemStatus {
  switch (state) {
    case 'LIVE_VERIFIED': return 'HEALTHY';
    case 'QUOTA_BLOCKED': return 'DEGRADED';
    case 'PROVIDER_ERROR':
      return lastErrorCategory && TRANSIENT_PROVIDER_ERROR_CATEGORIES.has(lastErrorCategory) ? 'DEGRADED' : 'FAILED';
    case 'BROKEN_UPSTREAM': return 'FAILED';
    case 'CREDENTIAL_PRESENT': return 'UNKNOWN';
    case 'NO_CREDENTIAL':
    case 'NOT_CONFIGURED':
    case 'DISABLED': return 'NOT_CONFIGURED';
    default: return 'UNKNOWN';
  }
}

/** Evidence source implied by a provider state — a real call, or configuration only. */
function providerEvidenceSource(report: ProviderStateReport): RuntimeEvidenceSource {
  return report.lastAttemptAt ? 'live_probe' : 'configuration_only';
}

export interface RuntimeStatusReport {
  systems: RuntimeSystemReport[];
  generatedAt: string;
}

function geminiStatus(): RuntimeSystemReport {
  // Derived from the same mechanism as OpenAI rather than a bare
  // process.env presence check, so the two providers cannot disagree about
  // what "configured" means.
  const credential = getModelCredentialStatus('gemini');
  const state = resolveProviderState({ provider: 'gemini', implemented: true, configured: credential.apiKeyPresent });
  return {
    system: 'Gemini Provider',
    status: providerStateToRuntimeStatus(state.state, state.lastErrorCategory),
    evidenceSource: providerEvidenceSource(state),
    lastCheck: state.lastAttemptAt,
    detail: `${state.state} — ${state.reason}`,
    provider: state,
  };
}

/**
 * PUSH 1 — OpenAI is now an executable provider, so it gets a real row in
 * the same table Gemini/Hermes/Windmill already appear in. No new UI: the
 * Master Admin "Runtime & Infrastructure Status" panel renders whatever
 * getRuntimeStatus() returns.
 *
 * Reported through the credential store rather than a bare process.env
 * read, so this row agrees with what the executor can actually do. Status
 * is UNKNOWN when a credential is present — configured is not connected,
 * and no live billable call is made on a status check.
 */
function openAiStatus(): RuntimeSystemReport {
  // Was: status UNKNOWN whenever a credential was present, with a detail
  // string explaining that configured is not connected. True but lossy — it
  // could not distinguish "never called" from "called and refused on
  // billing", which are different operator actions. That distinction now
  // comes from the PROVIDER_CALL ledger.
  const credential = getModelCredentialStatus('openai');
  const state = resolveProviderState({ provider: 'openai', implemented: true, configured: credential.apiKeyPresent });
  return {
    system: 'OpenAI Provider',
    status: providerStateToRuntimeStatus(state.state, state.lastErrorCategory),
    evidenceSource: providerEvidenceSource(state),
    lastCheck: state.lastAttemptAt,
    detail: `${state.state} — ${state.reason}`,
    provider: state,
  };
}

function openRouterStatus(): RuntimeSystemReport {
  // OpenRouter is an AGGREGATOR route in the model registry, dispatched by the
  // shared chat-completions adapter. What it can run is what an operator
  // imported, mapped to a canonical version and qualified.
  const configured = !!process.env.OPENROUTER_API_KEY;
  let offerings = 0; let qualified = 0;
  try {
    offerings = listModelViews().filter((m) => m.providerId === 'openrouter' && m.lifecycle !== 'REMOVED').length;
    qualified = new Set(listQualifications({ providerId: 'openrouter' }).filter((q) => q.state === 'VALID').map((q) => q.modelId)).size;
  } catch { /* registry not initialised */ }
  return {
    system: 'OpenRouter Provider',
    status: 'NOT_CONFIGURED',
    evidenceSource: 'configuration_only',
    lastCheck: null,
    detail: `Aggregator route (shared chat-completions adapter). ${offerings} imported offering(s), ${qualified} qualified. Credential ${configured ? 'present' : 'not set (OPENROUTER_API_KEY)'}. It runs nothing until an offering is imported, mapped and qualified.`,
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

// listBackups() walks the backups/ directory and inspects each archive. On
// this install that measured 1,985ms — and getRuntimeStatus() is called by
// lib/fabric/registry.ts's listCapabilities(), which executeEnvelope() calls
// on EVERY dispatch. So a two-second filesystem scan sat on the hot path of
// every Jarvis command, scheduled occurrence and graph node.
//
// This is pre-existing rather than new, but it is what made the suite
// fragile enough that adding a Hermes subprocess probe tipped concurrency
// tests past their 20s ceiling. Backups do not change between two dispatches
// a second apart, so a short TTL costs no truthfulness and removes the cost.
const BACKUP_STATUS_TTL_MS = 30_000;
let cachedBackupStatus: { at: number; value: RuntimeSystemReport } | null = null;

/** Test-only: drops the cached backup probe. */
export function resetBackupStatusCacheForTests(): void {
  cachedBackupStatus = null;
}

function backupStatus(): RuntimeSystemReport {
  if (cachedBackupStatus && Date.now() - cachedBackupStatus.at < BACKUP_STATUS_TTL_MS) {
    return cachedBackupStatus.value;
  }
  const report = computeBackupStatus();
  cachedBackupStatus = { at: Date.now(), value: report };
  return report;
}

function computeBackupStatus(): RuntimeSystemReport {
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
  const vaultPath = VAULT_ROOT;
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
    // ALWAYS-ON RUNTIME — corrected label. This row previously read
    // NOT_IMPLEMENTED, which is false about this repo: MCP probing IS
    // implemented (lib/mcp-client.ts probeMcpServer, reachable via POST
    // /api/skills/:id/mcp/probe, with a real SSRF guard). What is absent is
    // a probe *result*, which is a different fact.
    //
    // NOT_IMPLEMENTED is reserved for "no implementation exists"; reporting
    // it here trains an operator to read an unconfigured integration as a
    // missing feature, and hides the one case that genuinely needs
    // attention — an MCP server that is configured but has never answered.
    return {
      system: 'MCP Connectivity',
      status: 'NOT_CONFIGURED',
      evidenceSource: 'configuration_only',
      lastCheck: null,
      detail: 'MCP probing is implemented (lib/mcp-client.ts, POST /api/skills/:id/mcp/probe). No MCP server has been probed in this deployment, so there is no health evidence to report — unconfigured, not unimplemented.',
    };
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

/**
 * PUSH 1 — Antigravity's row. This one DOES make a live probe, because
 * unlike a model provider it has a zero-cost reachability check (a GET for
 * a non-existent interaction id distinguishes reachable+authenticated from
 * rejected without starting a billable sandbox run). Where a real probe is
 * free, configuration presence is not good enough evidence.
 */
async function antigravityStatus(): Promise<RuntimeSystemReport> {
  // Both branches used to report the same NOT_CONFIGURED. They are different
  // facts and need different operator actions: one needs a credential, the
  // other needs a flag flipped. The canonical state separates them
  // (NO_CREDENTIAL vs DISABLED) while the outer status stays compatible.
  if (!isAntigravityConfigured() || !isAntigravityEnabled()) {
    const state = resolveProviderState({
      provider: 'antigravity',
      implemented: true,
      configured: isAntigravityConfigured(),
      enabled: isAntigravityEnabled(),
    });
    return {
      system: 'Antigravity Runtime',
      status: providerStateToRuntimeStatus(state.state, state.lastErrorCategory),
      evidenceSource: 'configuration_only',
      lastCheck: null,
      detail: `${state.state} — ${state.reason}`,
      provider: state,
    };
  }
  const probe = await antigravityHealth();
  const statusMap: Record<string, RuntimeSystemStatus> = {
    CONNECTED: 'HEALTHY', FAILED: 'FAILED', INVALID_RESPONSE: 'DEGRADED',
    NOT_CONFIGURED: 'NOT_CONFIGURED', DISABLED: 'NOT_CONFIGURED',
  };
  return {
    system: 'Antigravity Runtime',
    status: statusMap[probe.status] ?? 'UNKNOWN',
    evidenceSource: 'live_probe',
    lastCheck: probe.checkedAt,
    detail: probe.error || `reachable=${probe.reachable}, authenticated=${probe.authenticated}, agent=${probe.agent}`,
  };
}

// ---------------------------------------------------------------------------
// ALWAYS-ON RUNTIME — the four core subsystems that had no row here at all.
//
// Scheduler, database, Guardian and Aegis are all *in-process* subsystems of
// this one server process, not separate services, so the honest thing to
// report is whether each one is actually functioning inside this process —
// never whether a separate daemon is up, because there isn't one.
//
// Each probe below is deterministic and free: no model call, no network
// call, no write. That is what makes it safe to run on every status read.
// ---------------------------------------------------------------------------

/**
 * The in-process poll loop. HEALTHY requires an armed timer that has
 * genuinely ticked; an armed timer that has never completed a tick is
 * DEGRADED, not HEALTHY, because the interval is unref'd and every tick
 * swallows its own error — so "the process is alive" is not evidence that
 * scheduled work is being dispatched.
 */
function schedulerStatus(): RuntimeSystemReport {
  const health = getSchedulerHealth();
  const now = new Date().toISOString();

  if (!health.running) {
    return {
      system: 'Scheduler (in-process poll loop)',
      status: 'FAILED',
      evidenceSource: 'live_probe',
      lastCheck: now,
      detail: health.startedAt
        ? `Timer is not armed in this process (it was armed at ${health.startedAt} and has since been stopped). No scheduled work can dispatch.`
        : 'Timer has never been armed in this process. No scheduled work can dispatch. startScheduler() runs once per server start — this state means the server process is not the one holding the loop.',
    };
  }

  // A tick that threw is the failure mode that otherwise looks healthy.
  const lastTickFailed = health.lastTickError !== null && health.tickErrors > 0 && health.lastTickProcessed === null;
  if (lastTickFailed) {
    return {
      system: 'Scheduler (in-process poll loop)',
      status: 'DEGRADED',
      evidenceSource: 'live_probe',
      lastCheck: now,
      detail: `Timer armed every ${health.intervalMs}ms since ${health.startedAt}, ${health.ticks} tick(s), but ${health.tickErrors} failed and none has completed. Last error at ${health.lastTickError!.at}: ${health.lastTickError!.message}`,
    };
  }

  if (health.ticks === 0 || health.lastTickAt === null) {
    return {
      system: 'Scheduler (in-process poll loop)',
      status: 'DEGRADED',
      evidenceSource: 'live_probe',
      lastCheck: now,
      detail: `Timer armed every ${health.intervalMs}ms at ${health.startedAt}, but it has not ticked yet. Armed is not ticking.`,
    };
  }

  // "It ticked once" is not "it is ticking". Without a staleness bound this
  // row would report HEALTHY forever on the strength of a single tick at
  // startup, which is the exact claim an always-on runtime must not be
  // allowed to make. The bound is three missed intervals (floor 30s) so a
  // busy machine or a slow tick does not read as a stall.
  const stallAfterMs = Math.max((health.intervalMs ?? 10000) * 3, 30000);
  const msSinceLastTick = Date.now() - new Date(health.lastTickAt).getTime();
  if (msSinceLastTick > stallAfterMs) {
    return {
      system: 'Scheduler (in-process poll loop)',
      status: 'DEGRADED',
      evidenceSource: 'live_probe',
      lastCheck: health.lastTickAt,
      detail: `STALLED: timer is armed every ${health.intervalMs}ms, but the last tick was ${Math.round(msSinceLastTick / 1000)}s ago (${health.lastTickAt}) — more than the ${Math.round(stallAfterMs / 1000)}s stall bound. ${health.ticks} tick(s) total. The process is alive and is not dispatching scheduled work.`,
    };
  }

  const errorNote = health.tickErrors > 0
    ? ` ${health.tickErrors} tick(s) have failed; last error at ${health.lastTickError?.at}: ${health.lastTickError?.message}`
    : '';
  // The reconciliation sweep shares this timer but not its fate, so it is
  // reported alongside rather than folded into the tick counters: a provider
  // outage during reconciliation is not a scheduler fault.
  const reconcileNote = health.lastReconcileAt
    ? ` Reconciliation swept ${health.lastReconcileConsidered ?? 0} external execution(s) at ${health.lastReconcileAt}${health.reconcileErrors > 0 ? `, ${health.reconcileErrors} sweep(s) failed (last: ${health.lastReconcileError?.message})` : ''}.`
    : ' Reconciliation has not completed a sweep yet.';
  return {
    system: 'Scheduler (in-process poll loop)',
    status: health.tickErrors > 0 ? 'DEGRADED' : 'HEALTHY',
    evidenceSource: 'live_probe',
    lastCheck: health.lastTickAt,
    detail: `Ticking every ${health.intervalMs}ms since ${health.startedAt}. ${health.ticks} tick(s), last at ${health.lastTickAt} (${Math.round(msSinceLastTick / 1000)}s ago), ${health.lastTickProcessed ?? 0} schedule(s) dispatched on that tick.${errorNote}${reconcileNote}`,
  };
}

/**
 * The Brain's durable store. Reported as read AND write availability,
 * because a read-only database is the failure that silently turns every
 * writeback into an error at dispatch time rather than at startup.
 *
 * Deliberately does NOT write a row to prove writability — a status read
 * must not mutate state. `fs.accessSync(W_OK)` on the real database file
 * plus the real journal mode is honest, cheap evidence.
 */
// Integrity checking is CACHED, for two reasons found the hard way.
//
// 1. `PRAGMA quick_check` is a scan. GET /api/ready is unauthenticated, so
//    running it per request means an anonymous caller can make the server
//    scan the whole database as fast as it can ask.
// 2. Run from a long-lived connection while another process held the WAL, it
//    came back non-'ok' and the row flashed DEGRADED on a database that was
//    perfectly healthy — observed live. A status panel that cries wolf during
//    normal concurrent access is worse than one that says less.
//
// So availability (the question an operator actually asks) is answered by a
// cheap read plus a real writability check on every call, and integrity is
// re-checked at most this often.
const INTEGRITY_CHECK_INTERVAL_MS = 5 * 60_000;
let cachedIntegrity: { result: string; at: number } | null = null;

/** Test-only, so one test's cached verdict cannot leak into another's. */
export function resetIntegrityCacheForTests(): void {
  cachedIntegrity = null;
}

type IntegrityVerdict = { result: string; checkedAt: string | null; fresh: boolean };

function checkIntegrity(db: ReturnType<typeof getDatabase>, now: number): IntegrityVerdict {
  if (cachedIntegrity && now - cachedIntegrity.at < INTEGRITY_CHECK_INTERVAL_MS) {
    return { result: cachedIntegrity.result, checkedAt: new Date(cachedIntegrity.at).toISOString(), fresh: false };
  }
  try {
    const row = db.prepare('PRAGMA quick_check(1)').get() as Record<string, unknown> | undefined;
    const value = row ? String(Object.values(row)[0] ?? '') : '';
    // An empty or missing answer is INCONCLUSIVE, not a corruption verdict.
    const result = value.trim() ? value.trim() : 'inconclusive';
    cachedIntegrity = { result, at: now };
    return { result, checkedAt: new Date(now).toISOString(), fresh: true };
  } catch (err: any) {
    // Busy/locked is contention, not corruption. Never cached, so the next
    // call retries rather than holding a scary verdict for five minutes.
    return { result: `inconclusive (${err?.message || 'check could not run'})`, checkedAt: null, fresh: true };
  }
}

/**
 * The Brain's durable store. Reported as read AND write availability,
 * because a read-only database is the failure that silently turns every
 * writeback into an error at dispatch time rather than at startup.
 *
 * Deliberately does NOT write a row to prove writability — a status read
 * must not mutate state. A real read query plus `fs.accessSync(W_OK)` on the
 * real database file is honest, cheap evidence.
 *
 * Only a DEFINITE non-ok integrity verdict degrades this row. An inconclusive
 * one is reported as inconclusive and left at HEALTHY, because "I could not
 * check right now" and "your data is corrupt" are not the same sentence.
 */
function databaseStatus(): RuntimeSystemReport {
  const now = new Date().toISOString();
  const dbPath = getDatabasePath();
  try {
    const db = getDatabase();

    // Cheap, non-scanning proof that reads work on this connection.
    const readProbe = db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    if (readProbe?.ok !== 1) {
      return {
        system: 'Brain Store (SQLite)',
        status: 'FAILED',
        evidenceSource: 'db_state',
        lastCheck: now,
        detail: `${dbPath} accepted a connection but did not answer a trivial read.`,
      };
    }

    const journalMode = (db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined)?.journal_mode ?? 'unknown';
    const sizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

    let writable = true;
    let writeDetail = 'writable';
    try {
      fs.accessSync(dbPath, fs.constants.W_OK);
    } catch {
      writable = false;
      writeDetail = 'NOT writable — reads work, every Brain writeback will fail';
    }

    const integrity = checkIntegrity(db, Date.now());
    const integrityIsDefiniteFailure = integrity.result !== 'ok' && !integrity.result.startsWith('inconclusive');
    const integrityNote = integrity.result === 'ok'
      ? `quick_check=ok (${integrity.fresh ? 'just now' : `cached ${integrity.checkedAt}`})`
      : `quick_check=${integrity.result}`;

    return {
      system: 'Brain Store (SQLite)',
      status: writable && !integrityIsDefiniteFailure ? 'HEALTHY' : 'DEGRADED',
      evidenceSource: 'db_state',
      lastCheck: now,
      detail: `${dbPath} — ${(sizeBytes / 1024).toFixed(0)}KB, journal_mode=${journalMode}, ${integrityNote}, ${writeDetail}.`,
    };
  } catch (err: any) {
    return {
      system: 'Brain Store (SQLite)',
      status: 'FAILED',
      evidenceSource: 'db_state',
      lastCheck: now,
      detail: `${dbPath} could not be opened or queried: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Guardian enforcement, proven by running it rather than by asserting it
 * exists. Two fixtures go through the real policy on every status read: a
 * catastrophic command that must come back BLOCKED, and an inert one that
 * must come back SAFE.
 *
 * The second fixture is the one that matters. A policy that blocked
 * everything would pass a block-only check while making the system useless,
 * so "enforcing" has to mean discriminating, not just refusing.
 */
function guardianStatus(): RuntimeSystemReport {
  const now = new Date().toISOString();
  try {
    const mustBlock = checkGuardianRules('rm -rf / --no-preserve-root');
    const mustApprove = checkGuardianRules('sudo systemctl restart nginx');
    const mustPass = checkGuardianRules('echo hello');

    const failures: string[] = [];
    if (mustBlock.status !== 'BLOCKED') failures.push(`a catastrophic command was not BLOCKED (got ${mustBlock.status})`);
    if (mustApprove.status !== 'APPROVAL_REQUIRED') failures.push(`a privileged command did not require approval (got ${mustApprove.status})`);
    if (mustPass.status !== 'SAFE') failures.push(`an inert command was not SAFE (got ${mustPass.status}) — the policy is not discriminating`);

    if (failures.length > 0) {
      return {
        system: 'Guardian (command + gate policy)',
        status: 'FAILED',
        evidenceSource: 'live_probe',
        lastCheck: now,
        detail: `Guardian policy self-check FAILED: ${failures.join('; ')}.`,
      };
    }
    return {
      system: 'Guardian (command + gate policy)',
      status: 'HEALTHY',
      evidenceSource: 'live_probe',
      lastCheck: now,
      detail: `Enforcing in-process. Self-check passed: destructive command BLOCKED (${mustBlock.ruleCitation}), privileged command APPROVAL_REQUIRED, inert command SAFE.`,
    };
  } catch (err: any) {
    return {
      system: 'Guardian (command + gate policy)',
      status: 'FAILED',
      evidenceSource: 'live_probe',
      lastCheck: now,
      detail: `Guardian policy threw during self-check: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Aegis receipts. The question an operator actually needs answered is not
 * "does a keypair file exist" but "can this process still issue a receipt
 * that verifies" — so this signs a throwaway payload with the real durable
 * key and verifies it back. Nothing is written to the receipt store.
 *
 * The key fingerprint is included because a changed fingerprint means every
 * previously issued receipt has become unverifiable, which is a silent,
 * unrecoverable failure if nobody is watching for it.
 */
function aegisStatus(): RuntimeSystemReport {
  const now = new Date().toISOString();
  try {
    const { fingerprint, algorithm } = getSigningPublicKey();
    const canonical = canonicalizePayload({ probe: 'runtime-status', at: now });
    const signed = signReceiptPayload(canonical);
    const verified = verifyReceiptSignature(canonical, signed.signature, signed.publicKeyPem);

    if (!verified) {
      return {
        system: 'Aegis (receipt signing + verification)',
        status: 'FAILED',
        evidenceSource: 'live_probe',
        lastCheck: now,
        detail: `Signed a probe payload with key ${fingerprint} and the signature did NOT verify. No receipt issued from this process can be trusted.`,
      };
    }

    let storedReceipts: number | null = null;
    try {
      const db = getDatabase();
      storedReceipts = (db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number }).n;
    } catch {
      storedReceipts = null;
    }

    return {
      system: 'Aegis (receipt signing + verification)',
      status: storedReceipts === null ? 'DEGRADED' : 'HEALTHY',
      evidenceSource: 'live_probe',
      lastCheck: now,
      detail: storedReceipts === null
        ? `${algorithm} sign+verify round-trip passed with key ${fingerprint}, but the receipts table could not be read — signing works, storage does not.`
        : `${algorithm} sign+verify round-trip passed with key ${fingerprint}. ${storedReceipts} receipt(s) stored.`,
    };
  } catch (err: any) {
    return {
      system: 'Aegis (receipt signing + verification)',
      status: 'FAILED',
      evidenceSource: 'live_probe',
      lastCheck: now,
      detail: `Receipt signing is unavailable: ${err?.message || String(err)}`,
    };
  }
}

/**
 * The CANONICAL model router (lib/registry/router.ts). It can only select a
 * route that holds a VALID task qualification, so its readiness is the count
 * of qualified routes — not whether some credential exists. Never HEALTHY on
 * configuration alone, and no billable call is made to find out.
 */
function modelRouterStatus(): RuntimeSystemReport {
  let valid: Array<{ providerId: string; modelId: string; taskClass: string }> = [];
  try {
    valid = listQualifications().filter((q) => q.state === 'VALID');
  } catch { /* registry not initialised: treated as none */ }
  const routes = new Set(valid.map((q) => `${q.providerId}/${q.modelId}`));
  if (routes.size === 0) {
    return {
      system: 'Model Router',
      status: 'NOT_CONFIGURED',
      evidenceSource: 'configuration_only',
      lastCheck: null,
      detail: 'The canonical router is running, but no route is qualified for any task class, so every model-backed task waits (paused, not failed) until an operator qualifies one.',
    };
  }
  return {
    system: 'Model Router',
    status: 'UNKNOWN',
    evidenceSource: 'configuration_only',
    lastCheck: null,
    detail: `${routes.size} qualified route(s) across ${new Set(valid.map((q) => q.taskClass)).size} task class(es). Qualified is not proven live — see the individual provider rows.`,
  };
}

/**
 * Hermes as it actually exists on this machine, which is a CLI rather than an
 * HTTP service.
 *
 * This row is deliberately separate from 'Hermes Dedicated Runtime' above,
 * and both are kept, because they answer different questions and collapsing
 * them would lose information:
 *
 *   Hermes Dedicated Runtime  — is the ADR-001 REST contract
 *                               (GET {base}/synthos/health) reachable?
 *                               Nothing here implements it, so: NOT_CONFIGURED.
 *   Hermes Local Runtime      — does the installed `hermes` CLI answer, and is
 *                               SynthOS allowed to dispatch to it?
 *
 * The probe runs `hermes --version`, which makes no model call and so costs
 * nothing. DISABLED is reported as NOT_CONFIGURED because a dispatch spends
 * real ChatGPT/Codex subscription quota — a reachable binary is not consent.
 */
async function hermesLocalRuntimeStatus(): Promise<RuntimeSystemReport> {
  const probe = await hermesLocalHealth();
  const detailBase = probe.cliPath ? `${probe.cliPath}${probe.version ? ` (${probe.version})` : ''}` : 'no CLI resolved';

  if (probe.status === 'CONNECTED') {
    return {
      system: 'Hermes Local Runtime (CLI)',
      status: 'HEALTHY',
      evidenceSource: 'live_probe',
      lastCheck: probe.checkedAt,
      detail: `${detailBase} — answers, and HERMES_LOCAL_ENABLED=true, so hermes.execute may dispatch. A run spends ChatGPT/Codex subscription quota, not SynthOS provider credit.`,
    };
  }

  if (probe.status === 'DISABLED') {
    // BROKEN_UPSTREAM, not NOT_CONFIGURED. The CLI is installed and answers
    // `--version`, so nothing here is unconfigured — but its one-shot task
    // path is broken in the tool itself:
    //
    //   hermes -z "<prompt>"
    //   -> AttributeError: 'list' object has no attribute 'items'
    //
    // Reproduced with a clean environment and with --ignore-user-config, so
    // it is neither SynthOS nor this machine's config, and the SynthOS
    // adapter dispatched correctly and reported the real error. Calling it
    // NOT_CONFIGURED would send an operator to look for a missing setting
    // that does not exist.
    const state = resolveProviderState({
      provider: 'hermes-local',
      implemented: true,
      configured: isHermesLocalConfigured(),
      enabled: isHermesLocalEnabled(),
      brokenUpstream: true,
    });
    return {
      system: 'Hermes Local Runtime (CLI)',
      status: providerStateToRuntimeStatus(state.state, state.lastErrorCategory),
      evidenceSource: 'live_probe',
      lastCheck: probe.checkedAt,
      detail: `${state.state} — ${detailBase} answers --version, but \`hermes -z\` fails upstream: AttributeError: 'list' object has no attribute 'items' (reproduces with a clean env and --ignore-user-config). The SynthOS adapter is valid. Dispatch is also switched off (HERMES_LOCAL_ENABLED is not "true").`,
      provider: state,
    };
  }

  if (probe.status === 'NOT_CONFIGURED') {
    return {
      system: 'Hermes Local Runtime (CLI)',
      status: 'NOT_CONFIGURED',
      evidenceSource: 'filesystem_check',
      lastCheck: probe.checkedAt,
      detail: probe.error || 'No executable Hermes CLI was found.',
    };
  }

  return {
    system: 'Hermes Local Runtime (CLI)',
    status: 'FAILED',
    evidenceSource: 'live_probe',
    lastCheck: probe.checkedAt,
    detail: probe.error || `${detailBase} — the CLI did not answer correctly.`,
  };
}

export async function getRuntimeStatus(): Promise<RuntimeStatusReport> {
  const systems: RuntimeSystemReport[] = [
    // Core in-process subsystems first: these are what "the runtime is up"
    // actually means, and they must not be buried under optional integrations.
    schedulerStatus(),
    databaseStatus(),
    guardianStatus(),
    aegisStatus(),
    modelRouterStatus(),
    geminiStatus(),
    openAiStatus(),
    openRouterStatus(),
    await hermesRuntimeStatus(),
    await hermesLocalRuntimeStatus(),
    mcpStatus(),
    tonStatus(),
    backupStatus(),
    vaultStatus(),
    memoryIndexStatus(),
    await windmillStatus(),
    await antigravityStatus(),
  ];
  return { systems, generatedAt: new Date().toISOString() };
}
