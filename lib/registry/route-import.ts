// ---------------------------------------------------------------------------
// ROUTE IMPORTERS — how a provider route's offerings reach the registry.
//
// One shared adapter interface; one importer per route source:
//
//   openrouter      OpenRouter's model-list document (AGGREGATOR)
//   nvidia          NVIDIA NIM's model-list document (AGGREGATOR)
//   local-runtime   a self-hosted OpenAI-compatible runtime's list (LOCAL)
//   signed-offline  a complete signed registry manifest (any route kind)
//
// What an import is:
//   * METADATA ONLY — a model list. Zero inference tokens. Never runs during
//     render, task creation, routing or startup, and never delays a task.
//   * Normally MANUAL: an operator supplies the document (downloaded by them,
//     or produced by a trusted pipeline). The registry is the cache.
//   * Optionally a SCHEDULED refresh, driven by the existing scheduler tick,
//     OFF by default, at a bounded cadence (MIN..MAX hours). A refresh is a
//     plain GET of the route's own metadata path on its validated endpoint.
//
// What an import can never do:
//   * qualify or enable anything — new offerings land INSTALLED/UNQUALIFIED;
//   * redefine a canonical model — an aggregator's id only PROPOSES the
//     version it serves (./identity.ts), trusted after audited approval;
//   * approve a price it has not seen before — imported prices are
//     UNREVIEWED unless identical to a price an operator already approved;
//   * put anything into a prompt.
//
// A failed import changes nothing: the last-known offerings stay, the route
// is marked STALE, and the router refuses stale routes' prices.
// ---------------------------------------------------------------------------

import { getDatabase } from '../persistence';
import { resolvePlatformSetting, setPlatformSetting } from '../platform-settings';
import { ensureRegistry } from './install';
import { getStoredProvider, importManifest, listStoredModels, recordRegistryEvent, type ImportOutcome } from './store';
import { resolveProviderEndpoint } from './endpoints';
import { isManualDiscoveryEnabled } from './discovery';
import { REGISTRY_SCHEMA_VERSION, type ModelManifest, type PricingRecord, type CapabilityRecord } from './types';

export const ROUTE_REFRESH_SETTING = 'registry.routeRefresh';
export const MIN_REFRESH_HOURS = 6;
export const MAX_REFRESH_HOURS = 24 * 7;
/** Imported prices must be re-confirmed within this window, or they go stale. */
export const IMPORTED_PRICE_TTL_HOURS = 72;
/** A free offering that is not guaranteed is volatile: its price goes stale sooner. */
export const FREE_ROUTE_TTL_HOURS = 24;

export interface ParsedRoutes {
  models: ModelManifest[];
  warnings: string[];
}

export interface RouteImporter {
  importerId: string;
  /** The provider whose offerings this importer writes. Null → the document names it (signed-offline). */
  providerId: string | null;
  description: string;
  /** Path (relative to the route's validated base URL) of its metadata list, for a scheduled refresh. */
  metadataPath: string | null;
  parse(payload: unknown, ctx: { now: string; previous: Map<string, ModelManifest> }): ParsedRoutes | { error: string };
}

// ---- shared helpers ---------------------------------------------------------

function cap(id: string, source: string): CapabilityRecord {
  return { id, supported: true, detail: null, source, verification: 'PUBLISHER_ASSERTED', effectiveDate: null };
}

function hoursFrom(nowIso: string, h: number): string {
  return new Date(Date.parse(nowIso) + h * 3_600_000).toISOString();
}

function sameRates(a: PricingRecord | undefined, b: PricingRecord): boolean {
  return !!a && a.currency === b.currency && a.unit === b.unit && a.rates.input === b.rates.input && a.rates.output === b.rates.output && a.rates.cachedInput === b.rates.cachedInput;
}

/** A price the operator already approved stays approved if, and only if, it is unchanged. */
function importedPricing(rates: { input: number; output: number; cachedInput: number | null }, source: string, free: boolean, now: string, previous?: ModelManifest): PricingRecord {
  const rec: PricingRecord = {
    currency: 'USD', unit: 'tokens', rates, reasoningTokens: 'BILLED_AS_OUTPUT', tiers: [], toolCharges: [], modalityCharges: [],
    effectiveFrom: now, effectiveUntil: null, source, verifiedAt: now,
    staleAfter: hoursFrom(now, free ? FREE_ROUTE_TTL_HOURS : IMPORTED_PRICE_TTL_HOURS), approval: 'UNREVIEWED',
  };
  const prev = previous?.pricing.find((p) => p.approval === 'APPROVED');
  if (prev && sameRates(prev, rec)) return { ...rec, approval: 'APPROVED', effectiveFrom: prev.effectiveFrom };
  return rec;
}

function perMillion(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1e6) / 1e6;
}

const PUBLISHER = /^[a-z][a-z0-9_-]{1,39}$/;
const VERSION_PART = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** An aggregator id of the form publisher/version PROPOSES that canonical version. Variant suffixes (":free") are not part of it. */
function proposedCanonical(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const [pub, ...rest] = raw.split('/');
  const ver = rest.join('/').split(':')[0];
  return PUBLISHER.test(pub) && VERSION_PART.test(ver) && !ver.includes('/') ? `${pub}/${ver}` : null;
}

function baseModel(modelId: string, displayName: string): Omit<ModelManifest, 'pricing' | 'capabilities' | 'outputContracts'> {
  return {
    modelId, aliases: [], displayName, lifecycle: 'ACTIVE', releaseDate: null, deprecationDate: null, shutdownDate: null,
    limits: { contextTokens: null, outputTokens: null }, modalities: { input: ['text'], output: ['text'] },
    supportedParameters: [], adapterCompatibility: { protocol: 'openai.chat_completions', minAdapterVersion: '1.0.0' },
    restrictions: { regions: [], compliance: [] },
  };
}

// ---- OpenRouter -------------------------------------------------------------

const openrouter: RouteImporter = {
  importerId: 'openrouter',
  providerId: 'openrouter',
  description: 'OpenRouter model list (GET /models). Aggregator offerings; each proposes the canonical version it serves.',
  metadataPath: '/models',
  parse(payload, { now, previous }) {
    const list = (payload as any)?.data;
    if (!Array.isArray(list)) return { error: 'Expected an OpenRouter model list: { "data": [ ... ] }.' };
    const warnings: string[] = [];
    const models: ModelManifest[] = [];
    for (const r of list) {
      const id = typeof r?.id === 'string' ? r.id : null;
      if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(id)) { warnings.push(`skipped an entry with an invalid id (${String(r?.id).slice(0, 60)})`); continue; }
      const input = perMillion(r?.pricing?.prompt);
      const output = perMillion(r?.pricing?.completion);
      if (input === null || output === null) { warnings.push(`${id}: no usable price; skipped (a route without a price cannot be bounded)`); continue; }
      const free = input === 0 && output === 0;
      const params: string[] = Array.isArray(r?.supported_parameters) ? r.supported_parameters.filter((p: unknown) => typeof p === 'string') : [];
      const inMod: string[] = Array.isArray(r?.architecture?.input_modalities) ? r.architecture.input_modalities : ['text'];
      const outMod: string[] = Array.isArray(r?.architecture?.output_modalities) ? r.architecture.output_modalities : ['text'];
      const src = 'route-import:openrouter';
      const caps: CapabilityRecord[] = [cap('text.input', src), cap('text.output', src)];
      if (inMod.includes('image')) caps.push(cap('image.input', src));
      if (inMod.includes('audio')) caps.push(cap('audio.input', src));
      if (params.includes('tools')) caps.push(cap('tools.function_calling', src));
      const structured = params.includes('response_format') || params.includes('structured_outputs');
      if (structured) caps.push(cap('output.structured', src));
      if (params.includes('reasoning')) caps.push(cap('reasoning.controls', src));
      const canonical = proposedCanonical(typeof r?.canonical_slug === 'string' ? r.canonical_slug : id);
      const m: ModelManifest = {
        ...baseModel(id, typeof r?.name === 'string' && r.name.trim() ? r.name.slice(0, 120) : id),
        limits: {
          contextTokens: Number.isFinite(r?.top_provider?.context_length) ? r.top_provider.context_length : Number.isFinite(r?.context_length) ? r.context_length : null,
          outputTokens: Number.isFinite(r?.top_provider?.max_completion_tokens) ? r.top_provider.max_completion_tokens : null,
        },
        modalities: { input: inMod.filter((x) => typeof x === 'string'), output: outMod.filter((x) => typeof x === 'string') },
        capabilities: caps,
        supportedParameters: params.slice(0, 40),
        outputContracts: structured ? ['NARRATIVE', 'LITERAL', 'JSON_OBJECT'] : ['NARRATIVE', 'LITERAL'],
        pricing: [importedPricing({ input, output, cachedInput: perMillion(r?.pricing?.input_cache_read) }, src, free, now, previous.get(id))],
        ...(canonical ? { canonicalVersionId: canonical } : {}),
        freeTier: { free, guaranteed: false },
      };
      models.push(m);
    }
    return { models, warnings };
  },
};

// ---- NVIDIA NIM -------------------------------------------------------------

const nvidia: RouteImporter = {
  importerId: 'nvidia',
  providerId: 'nvidia',
  description: 'NVIDIA NIM model list (GET /models, OpenAI-compatible). Prices are not in the list: supply them in the document ("pricing" per entry) or the offering stays PRICING_REQUIRED.',
  metadataPath: '/models',
  parse(payload, { now, previous }) {
    const list = (payload as any)?.data;
    if (!Array.isArray(list)) return { error: 'Expected an OpenAI-compatible model list: { "data": [ { "id": ... } ] }.' };
    const warnings: string[] = [];
    const models: ModelManifest[] = [];
    for (const r of list) {
      const id = typeof r?.id === 'string' ? r.id : null;
      if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(id)) { warnings.push(`skipped an entry with an invalid id`); continue; }
      const src = 'route-import:nvidia';
      const input = perMillion(r?.pricing?.input_per_token);
      const output = perMillion(r?.pricing?.output_per_token);
      const pricing = input !== null && output !== null ? [importedPricing({ input, output, cachedInput: null }, src, input === 0 && output === 0, now, previous.get(id))] : [];
      if (!pricing.length) warnings.push(`${id}: the list carries no price; it stays PRICING_REQUIRED until a priced document is imported`);
      const canonical = proposedCanonical(id);
      models.push({
        ...baseModel(id, id),
        limits: { contextTokens: Number.isFinite(r?.max_model_len) ? r.max_model_len : null, outputTokens: null },
        capabilities: [cap('text.input', src), cap('text.output', src)],
        outputContracts: ['NARRATIVE', 'LITERAL'],
        pricing,
        ...(canonical ? { canonicalVersionId: canonical } : {}),
        freeTier: { free: !!pricing.length && pricing[0].rates.input === 0 && pricing[0].rates.output === 0, guaranteed: false },
      });
    }
    return { models, warnings };
  },
};

// ---- Local runtime ------------------------------------------------------------

const localRuntime: RouteImporter = {
  importerId: 'local-runtime',
  providerId: 'local-runtime',
  description: 'A self-hosted OpenAI-compatible runtime\'s model list (GET /models). Free, local, no credential. Offerings map to a canonical version only by operator approval.',
  metadataPath: '/models',
  parse(payload, { now, previous }) {
    const list = (payload as any)?.data ?? (payload as any)?.models;
    if (!Array.isArray(list)) return { error: 'Expected { "data": [ { "id": ... } ] } (or { "models": [ { "name": ... } ] }).' };
    const warnings: string[] = [];
    const models: ModelManifest[] = [];
    for (const r of list) {
      const id = typeof r?.id === 'string' ? r.id : typeof r?.name === 'string' ? r.name : null;
      if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(id)) { warnings.push('skipped an entry with an invalid id'); continue; }
      const src = 'route-import:local-runtime';
      models.push({
        ...baseModel(id, id),
        capabilities: [cap('text.input', src), cap('text.output', src)],
        outputContracts: ['NARRATIVE', 'LITERAL'],
        // A $0 record the OPERATOR must approve: unknown pricing is never
        // treated as free, so an unreviewed local model cannot run.
        pricing: [importedPricing({ input: 0, output: 0, cachedInput: null }, src, false, now, previous.get(id))].map((r) => ({ ...r, staleAfter: hoursFrom(now, 24 * 365), reasoningTokens: 'NOT_BILLED' as const })),
        freeTier: { free: true, guaranteed: true },
      });
    }
    return { models, warnings };
  },
};

// ---- Signed offline manifest ------------------------------------------------

const signedOffline: RouteImporter = {
  importerId: 'signed-offline',
  providerId: null,
  description: 'A complete registry manifest for any route kind, signed (Ed25519) by a trusted key. Verified exactly like a signed import.',
  metadataPath: null,
  parse() { return { error: 'signed-offline documents are imported whole; see runRouteImport' }; },
};

export const ROUTE_IMPORTERS: readonly RouteImporter[] = Object.freeze([openrouter, nvidia, localRuntime, signedOffline]);

export function getRouteImporter(id: string): RouteImporter | null {
  return ROUTE_IMPORTERS.find((i) => i.importerId === id) ?? null;
}

// ---- status -------------------------------------------------------------------

function ensureStatusTable(): void {
  getDatabase().exec(`CREATE TABLE IF NOT EXISTS registry_route_import_status (
    importer_id TEXT PRIMARY KEY,
    provider_id TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_import_id TEXT,
    last_error TEXT,
    state TEXT NOT NULL,
    offerings INTEGER NOT NULL DEFAULT 0,
    trigger TEXT
  )`);
}

export interface RouteImportStatus {
  importerId: string;
  providerId: string | null;
  description: string;
  state: 'NEVER_IMPORTED' | 'CURRENT' | 'STALE';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  offerings: number;
  trigger: string | null;
}

export function listRouteImportStatus(): RouteImportStatus[] {
  ensureStatusTable();
  const rows = new Map((getDatabase().prepare('SELECT * FROM registry_route_import_status').all() as any[]).map((r) => [r.importer_id, r]));
  return ROUTE_IMPORTERS.map((i) => {
    const r = rows.get(i.importerId);
    return {
      importerId: i.importerId, providerId: i.providerId, description: i.description,
      state: (r?.state ?? 'NEVER_IMPORTED') as RouteImportStatus['state'],
      lastAttemptAt: r?.last_attempt_at ?? null, lastSuccessAt: r?.last_success_at ?? null, lastError: r?.last_error ?? null,
      offerings: r?.offerings ?? 0, trigger: r?.trigger ?? null,
    };
  });
}

/** Is this provider's route data stale (its last import attempt failed)? The router refuses stale routes. */
export function isRouteStale(providerId: string): boolean {
  ensureStatusTable();
  const r = getDatabase().prepare("SELECT state FROM registry_route_import_status WHERE provider_id = ? AND state = 'STALE' LIMIT 1").get(providerId);
  return !!r;
}

function writeStatus(importerId: string, providerId: string | null, patch: { ok: boolean; importId?: string | null; error?: string | null; offerings?: number; trigger: string }): void {
  ensureStatusTable();
  const now = new Date().toISOString();
  const prev = getDatabase().prepare('SELECT * FROM registry_route_import_status WHERE importer_id = ?').get(importerId) as any;
  getDatabase().prepare(`INSERT INTO registry_route_import_status (importer_id, provider_id, last_attempt_at, last_success_at, last_import_id, last_error, state, offerings, trigger)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(importer_id) DO UPDATE SET provider_id = excluded.provider_id, last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at,
      last_import_id = excluded.last_import_id, last_error = excluded.last_error, state = excluded.state, offerings = excluded.offerings, trigger = excluded.trigger`)
    .run(importerId, providerId, now,
      patch.ok ? now : prev?.last_success_at ?? null,
      patch.ok ? patch.importId ?? null : prev?.last_import_id ?? null,
      patch.ok ? null : (patch.error ?? 'import failed').slice(0, 500),
      // A failure never erases last-known offerings; it marks them STALE.
      patch.ok ? 'CURRENT' : prev?.last_success_at ? 'STALE' : 'NEVER_IMPORTED',
      patch.ok ? patch.offerings ?? 0 : prev?.offerings ?? 0,
      patch.trigger);
}

// ---- running an import ----------------------------------------------------------

export type RouteImportResult =
  | { ok: true; importerId: string; outcome: ImportOutcome; warnings: string[] }
  | { ok: false; importerId: string; code: 'UNKNOWN_IMPORTER' | 'PROVIDER_NOT_INSTALLED' | 'PARSE_FAILED' | 'IMPORT_REFUSED' | 'FETCH_FAILED' | 'REFRESH_DISABLED'; error: string; outcome?: ImportOutcome };

/**
 * Import a route document an operator supplied. Metadata only; no network.
 * `trigger` is recorded (MANUAL, SCHEDULED).
 */
export function runRouteImport(p: { importerId: string; payload: unknown; actor: string; trigger?: 'MANUAL' | 'SCHEDULED' }): RouteImportResult {
  ensureRegistry();
  const trigger = p.trigger ?? 'MANUAL';
  const importer = getRouteImporter(p.importerId);
  if (!importer) return { ok: false, importerId: p.importerId, code: 'UNKNOWN_IMPORTER', error: `No route importer "${p.importerId}". Known: ${ROUTE_IMPORTERS.map((i) => i.importerId).join(', ')}.` };

  if (importer.providerId === null) {
    // Whole signed manifest: the signed-import path verifies it.
    const outcome = importManifest(p.payload, { source: 'SIGNED_IMPORT', actor: p.actor });
    writeStatus(importer.importerId, outcome.providerId, { ok: outcome.ok, importId: outcome.importId, error: outcome.errors.join('; '), offerings: (outcome.added.length + outcome.changed.length + outcome.unchanged.length), trigger });
    recordRegistryEvent('ROUTE_IMPORT', { actor: p.actor, importerId: importer.importerId, providerId: outcome.providerId, ok: outcome.ok, trigger });
    return outcome.ok ? { ok: true, importerId: importer.importerId, outcome, warnings: outcome.warnings } : { ok: false, importerId: importer.importerId, code: 'IMPORT_REFUSED', error: outcome.errors.join('; '), outcome };
  }

  const provider = getStoredProvider(importer.providerId);
  if (!provider) {
    writeStatus(importer.importerId, importer.providerId, { ok: false, error: 'provider plugin not installed', trigger });
    return { ok: false, importerId: importer.importerId, code: 'PROVIDER_NOT_INSTALLED', error: `The ${importer.providerId} provider plugin is not installed.` };
  }
  const now = new Date().toISOString();
  const previous = new Map(listStoredModels(importer.providerId).filter((m) => m.source === 'ROUTE_IMPORT').map((m) => [m.modelId, m.record]));
  const parsed = importer.parse(p.payload, { now, previous });
  if ('error' in parsed) {
    writeStatus(importer.importerId, importer.providerId, { ok: false, error: parsed.error, trigger });
    recordRegistryEvent('ROUTE_IMPORT_FAILED', { actor: p.actor, importerId: importer.importerId, error: parsed.error, trigger });
    return { ok: false, importerId: importer.importerId, code: 'PARSE_FAILED', error: parsed.error };
  }
  const baseVersion = provider.manifest.manifestVersion.split('+')[0].slice(0, 40);
  const manifest = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    manifestVersion: `${baseVersion}+route.${Date.parse(now)}`,
    provenance: { publisher: `route-import:${importer.importerId}`, generatedAt: now, notes: `Route import (${trigger}) by ${p.actor}. Offerings only; nothing qualified or enabled.` },
    provider: provider.manifest.provider,
    models: parsed.models,
  };
  const outcome = importManifest(manifest, { source: 'ROUTE_IMPORT', actor: p.actor });
  writeStatus(importer.importerId, importer.providerId, { ok: outcome.ok, importId: outcome.importId, error: outcome.errors.join('; '), offerings: parsed.models.length, trigger });
  recordRegistryEvent(outcome.ok ? 'ROUTE_IMPORT' : 'ROUTE_IMPORT_FAILED', { actor: p.actor, importerId: importer.importerId, providerId: importer.providerId, added: outcome.added.length, changed: outcome.changed.length, removed: outcome.removed.length, pending: outcome.identityPending?.length ?? 0, conflicts: outcome.identityConflicts?.length ?? 0, trigger });
  return outcome.ok
    ? { ok: true, importerId: importer.importerId, outcome, warnings: [...parsed.warnings, ...outcome.warnings] }
    : { ok: false, importerId: importer.importerId, code: 'IMPORT_REFUSED', error: outcome.errors.join('; '), outcome };
}

// ---- optional scheduled refresh (OFF by default) --------------------------------

export interface RouteRefreshSettings {
  enabled: boolean;
  cadenceHours: number;
  importers: string[];
}

export const DEFAULT_ROUTE_REFRESH: RouteRefreshSettings = { enabled: false, cadenceHours: 24, importers: [] };

export function getRouteRefreshSettings(): RouteRefreshSettings {
  try {
    const raw = resolvePlatformSetting(ROUTE_REFRESH_SETTING, JSON.stringify(DEFAULT_ROUTE_REFRESH)).value;
    const v = JSON.parse(raw);
    return {
      enabled: v?.enabled === true,
      cadenceHours: Math.min(MAX_REFRESH_HOURS, Math.max(MIN_REFRESH_HOURS, Number(v?.cadenceHours) || DEFAULT_ROUTE_REFRESH.cadenceHours)),
      importers: Array.isArray(v?.importers) ? v.importers.filter((x: unknown) => typeof x === 'string' && getRouteImporter(x)?.metadataPath) : [],
    };
  } catch {
    return DEFAULT_ROUTE_REFRESH;
  }
}

export function setRouteRefreshSettings(s: Partial<RouteRefreshSettings>, actor: string): { ok: true; settings: RouteRefreshSettings } | { ok: false; error: string } {
  const cur = getRouteRefreshSettings();
  const cadence = s.cadenceHours ?? cur.cadenceHours;
  if (!Number.isFinite(cadence) || cadence < MIN_REFRESH_HOURS || cadence > MAX_REFRESH_HOURS) return { ok: false, error: `cadenceHours must be between ${MIN_REFRESH_HOURS} and ${MAX_REFRESH_HOURS}` };
  const importers = s.importers ?? cur.importers;
  for (const i of importers) if (!getRouteImporter(i)?.metadataPath) return { ok: false, error: `importer "${i}" has no metadata path to refresh from` };
  const next: RouteRefreshSettings = { enabled: s.enabled ?? cur.enabled, cadenceHours: cadence, importers };
  setPlatformSetting(ROUTE_REFRESH_SETTING, JSON.stringify(next), actor);
  recordRegistryEvent('ROUTE_REFRESH_SETTINGS', { actor, ...next });
  return { ok: true, settings: next };
}

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * One refresh of one importer: a GET of the route's metadata path on its
 * validated endpoint. No credential is sent (model lists are public metadata);
 * a route whose list needs one must be imported manually.
 */
export async function refreshRoute(importerId: string, actor: string, fetcher: Fetcher = fetch as unknown as Fetcher, trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL'): Promise<RouteImportResult> {
  ensureRegistry();
  // Reaching out is always an explicit switch: a one-off (MANUAL) pull needs
  // manual discovery ON; a SCHEDULED pull needs scheduled refresh ON. Neither
  // switch implies the other.
  if (trigger === 'MANUAL' && !isManualDiscoveryEnabled()) {
    recordRegistryEvent('ROUTE_REFRESH_REFUSED', { actor, importerId, reason: 'manual discovery is off', trigger });
    return { ok: false, importerId, code: 'REFRESH_DISABLED', error: 'Manual discovery is switched off. Switch it on for a one-off metadata pull, then off again; or import the route document by hand.' };
  }
  if (trigger === 'SCHEDULED' && !getRouteRefreshSettings().enabled) {
    return { ok: false, importerId, code: 'REFRESH_DISABLED', error: 'Scheduled route refresh is switched off.' };
  }
  const importer = getRouteImporter(importerId);
  if (!importer || !importer.providerId || !importer.metadataPath) return { ok: false, importerId, code: 'UNKNOWN_IMPORTER', error: `"${importerId}" cannot be refreshed from a URL.` };
  const provider = getStoredProvider(importer.providerId);
  if (!provider) return { ok: false, importerId, code: 'PROVIDER_NOT_INSTALLED', error: `The ${importer.providerId} provider plugin is not installed.` };
  const ep = resolveProviderEndpoint(provider.manifest.provider);
  if (!ep.ok) {
    writeStatus(importerId, importer.providerId, { ok: false, error: ep.reason, trigger });
    return { ok: false, importerId, code: 'FETCH_FAILED', error: ep.reason };
  }
  let payload: unknown;
  try {
    const res = await fetcher(`${ep.baseUrl}${importer.metadataPath}`, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } });
    const text = (await res.text()).slice(0, 8 * 1024 * 1024);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = JSON.parse(text);
  } catch (err: any) {
    const error = `refresh failed; last-known offerings kept and marked STALE: ${String(err?.message || err).slice(0, 200)}`;
    writeStatus(importerId, importer.providerId, { ok: false, error, trigger });
    recordRegistryEvent('ROUTE_IMPORT_FAILED', { actor, importerId, error, trigger });
    return { ok: false, importerId, code: 'FETCH_FAILED', error };
  }
  return runRouteImport({ importerId, payload, actor, trigger });
}

let refreshInFlight = false;

/**
 * Called from the existing scheduler tick. Does nothing unless an operator
 * switched scheduled refresh on; then refreshes each configured importer at
 * most once per cadence. Never runs a model, never blocks the tick.
 */
export async function routeRefreshTickForScheduler(fetcher?: Fetcher): Promise<{ ran: string[] } | null> {
  const s = getRouteRefreshSettings();
  if (!s.enabled || !s.importers.length || refreshInFlight) return null;
  refreshInFlight = true;
  try {
    const due = listRouteImportStatus().filter((st) => s.importers.includes(st.importerId) && (!st.lastAttemptAt || Date.now() - Date.parse(st.lastAttemptAt) >= s.cadenceHours * 3_600_000));
    const ran: string[] = [];
    for (const st of due) {
      await refreshRoute(st.importerId, 'scheduler', fetcher, 'SCHEDULED');
      ran.push(st.importerId);
    }
    return { ran };
  } finally {
    refreshInFlight = false;
  }
}
