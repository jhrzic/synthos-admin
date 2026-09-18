// ---------------------------------------------------------------------------
// MODEL CATALOG DISCOVERY AND SYNC.
//
// Keeps the catalog current without a human editing a list, and without
// spending a single generation token.
//
// THE ZERO-INFERENCE GUARANTEE, AND HOW IT IS ENFORCED
// Discovery reads a provider's model-list endpoint — OpenAI's GET /v1/models,
// Gemini's GET /v1beta/models. Those are metadata endpoints: no prompt, no
// completion, no tokens billed. This module therefore:
//
//   * issues GET requests only, with no request body;
//   * never imports or calls anything in lib/fabric/model-*.ts or any other
//     generation path;
//   * records a REFRESH event, never a PROVIDER_CALL, so a catalog refresh
//     cannot be mistaken for provider verification in the ledger.
//
// test/model-discovery-truth.test.ts asserts the first two by inspecting this
// file, and asserts a refresh performs no inference by counting calls.
//
// FAILURE PRESERVES THE LAST-KNOWN CATALOG
// A refresh that cannot reach a provider does NOT empty that provider's
// models. It keeps what was last stored and marks the provider stale, with the
// reason. An empty list after a network blip would read as "this provider has
// no models", which is the same class of untruth this whole effort exists to
// remove.
//
// DISCOVERY NEVER CHANGES ROUTING
// New ids are recorded, diffed and surfaced. The routed default is owned by
// lib/model-router.ts and is not touched here — a provider shipping a new
// model must never silently redirect production traffic.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';
import { assertSafeOutboundUrl, readBoundedBody } from './net-guard';
import {
  CATALOG_PROVIDERS,
  documentedModelsForProvider,
  getCatalogProvider,
  type CatalogModel,
  type CatalogProviderId,
  type ModelSource,
} from './model-catalog';
import { resolveModelApiKey, isModelProvider } from './model-credentials';

/** Providers whose model list this build can actually fetch. */
const LIVE_DISCOVERY: Partial<Record<CatalogProviderId, {
  url: string;
  credentialProvider: 'openai' | 'gemini';
  /** Pull model ids out of the provider's own response shape. */
  extract: (body: unknown) => string[];
}>> = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    credentialProvider: 'openai',
    extract: (body) => {
      const data = (body as { data?: Array<{ id?: unknown }> } | null)?.data;
      if (!Array.isArray(data)) return [];
      return data.map((m) => String(m?.id ?? '')).filter(Boolean);
    },
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    credentialProvider: 'gemini',
    extract: (body) => {
      const models = (body as { models?: Array<{ name?: unknown }> } | null)?.models;
      if (!Array.isArray(models)) return [];
      return models
        .map((m) => String(m?.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    },
  },
};

export type RefreshTrigger = 'STARTUP' | 'SCHEDULED' | 'MANUAL';

export type ProviderRefreshOutcome =
  /** A live model-list call succeeded. */
  | 'LIVE'
  /** No credential, so documented metadata was used. Not a failure. */
  | 'DOCUMENTED_NO_CREDENTIAL'
  /** No discovery endpoint this build can call. Documented metadata used. */
  | 'DOCUMENTED_NO_ENDPOINT'
  /** A live call was attempted and failed. Last-known catalog preserved. */
  | 'FAILED_STALE';

export interface ProviderRefreshResult {
  providerId: CatalogProviderId;
  outcome: ProviderRefreshOutcome;
  source: ModelSource;
  discoveredCount: number;
  error: string | null;
  /** Ids seen for the first time in this refresh. */
  added: string[];
  /** Ids previously seen and absent now. Marked REMOVED, never deleted. */
  removed: string[];
}

export interface CatalogRefreshReport {
  refreshId: string;
  trigger: RefreshTrigger;
  startedAt: string;
  finishedAt: string;
  providers: ProviderRefreshResult[];
  /** True when at least one provider's data could not be refreshed. */
  anyStale: boolean;
  /** Asserted, and true by construction: discovery performs no generation. */
  inferenceCalls: 0;
}

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

function ensureTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_catalog_entries (
      provider_id   TEXT NOT NULL,
      model_id      TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      source        TEXT NOT NULL,
      lifecycle     TEXT NOT NULL,
      aliases_json  TEXT NOT NULL DEFAULT '[]',
      capability_json TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      removed_at    TEXT,
      PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS model_catalog_refreshes (
      refresh_id   TEXT PRIMARY KEY,
      trigger      TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT NOT NULL,
      any_stale    INTEGER NOT NULL DEFAULT 0,
      report_json  TEXT NOT NULL
    );
  `);
}

/** Stored catalog for one provider, newest state first. Never invented. */
export function storedModelsForProvider(providerId: CatalogProviderId): CatalogModel[] {
  ensureTables();
  const rows = getDatabase().prepare(`
    SELECT provider_id, model_id, display_name, source, lifecycle, aliases_json, capability_json
    FROM model_catalog_entries WHERE provider_id = ?
    ORDER BY (lifecycle = 'REMOVED'), model_id
  `).all(providerId) as Array<{
    provider_id: string; model_id: string; display_name: string;
    source: string; lifecycle: string; aliases_json: string; capability_json: string;
  }>;

  const provider = getCatalogProvider(providerId);
  const documented = documentedModelsForProvider(providerId);
  return rows.map((r) => {
    const doc = documented.find((d) => d.modelId === r.model_id);
    return {
      providerId: r.provider_id as CatalogProviderId,
      modelId: r.model_id,
      displayName: r.display_name,
      family: provider?.family ?? r.provider_id,
      capabilityTags: safeJson<string[]>(r.capability_json, []),
      modalities: doc?.modalities ?? ['text'],
      lifecycle: r.lifecycle as CatalogModel['lifecycle'],
      source: r.source as ModelSource,
      aliases: safeJson<string[]>(r.aliases_json, []),
      // The routed default is the router's business, so it is read from the
      // documented catalog rather than stored — storing it would let a stale
      // row claim a default the router does not use.
      isProviderDefault: doc?.isProviderDefault ?? false,
    };
  });
}

function safeJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/**
 * The catalog a caller should display: stored entries when a refresh has ever
 * run, documented metadata otherwise. Never empty merely because discovery
 * has not happened yet.
 */
export function effectiveModelsForProvider(providerId: CatalogProviderId): CatalogModel[] {
  const stored = storedModelsForProvider(providerId);
  return stored.length > 0 ? stored : documentedModelsForProvider(providerId);
}

export function lastRefresh(): CatalogRefreshReport | null {
  ensureTables();
  const row = getDatabase().prepare(
    'SELECT report_json FROM model_catalog_refreshes ORDER BY finished_at DESC LIMIT 1',
  ).get() as { report_json: string } | undefined;
  return row ? safeJson<CatalogRefreshReport | null>(row.report_json, null) : null;
}

// ---------------------------------------------------------------------------
// DISCOVERY
// ---------------------------------------------------------------------------

/**
 * Fetch one provider's model list. GET only, no body, metadata endpoint.
 * Returns null when no credential resolves, so the caller can fall back to
 * documented metadata rather than treating it as a failure.
 */
async function fetchLiveModelIds(providerId: CatalogProviderId): Promise<string[] | null> {
  const spec = LIVE_DISCOVERY[providerId];
  if (!spec) return null;
  if (!isModelProvider(spec.credentialProvider)) return null;
  const { apiKey } = resolveModelApiKey(spec.credentialProvider);
  if (!apiKey) return null;

  await assertSafeOutboundUrl(spec.url, { allowPrivate: false });

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (providerId === 'openai') headers.Authorization = `Bearer ${apiKey}`;
  const url = providerId === 'google' ? `${spec.url}?key=${encodeURIComponent(apiKey)}` : spec.url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    // GET, and deliberately no `body`. A model list is metadata; sending a
    // prompt here would make a catalog refresh cost money.
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!res.ok) throw new Error(`model list returned HTTP ${res.status}`);
    const body = await readBoundedBody(res);
    return spec.extract(JSON.parse(body.text));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresh the catalog for every provider, persist it, and report the diff.
 *
 * Providers this build cannot query are not skipped — their documented
 * metadata is stored, so a provider with no adapter still has a real, visible
 * model fleet. Anthropic is the case that matters: known models, zero
 * executable, and both facts stated.
 */
export async function refreshModelCatalog(trigger: RefreshTrigger): Promise<CatalogRefreshReport> {
  ensureTables();
  const startedAt = new Date().toISOString();
  const refreshId = `mcr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const results: ProviderRefreshResult[] = [];

  for (const provider of CATALOG_PROVIDERS) {
    const documented = documentedModelsForProvider(provider.providerId);
    let ids: string[] | null = null;
    let outcome: ProviderRefreshOutcome;
    let source: ModelSource = 'DOCUMENTED_CATALOG';
    let error: string | null = null;

    if (LIVE_DISCOVERY[provider.providerId]) {
      try {
        ids = await fetchLiveModelIds(provider.providerId);
        if (ids === null) {
          outcome = 'DOCUMENTED_NO_CREDENTIAL';
        } else {
          outcome = 'LIVE';
          source = 'PROVIDER_API';
        }
      } catch (err: any) {
        // Preserve the last-known catalog and say it is stale.
        error = String(err?.message ?? err).slice(0, 300);
        outcome = 'FAILED_STALE';
        ids = null;
      }
    } else {
      outcome = provider.hasDiscoveryEndpoint ? 'DOCUMENTED_NO_CREDENTIAL' : 'DOCUMENTED_NO_ENDPOINT';
    }

    // On a failed live call, keep whatever is stored and change nothing.
    if (outcome === 'FAILED_STALE') {
      const stored = storedModelsForProvider(provider.providerId);
      results.push({
        providerId: provider.providerId,
        outcome,
        source: stored[0]?.source ?? 'DOCUMENTED_CATALOG',
        discoveredCount: stored.length || documented.length,
        error,
        added: [],
        removed: [],
      });
      continue;
    }

    const incoming: CatalogModel[] = ids
      ? ids.map((id) => {
        const doc = documented.find((d) => d.modelId === id || d.aliases.includes(id));
        return {
          providerId: provider.providerId,
          modelId: id,
          displayName: doc?.displayName ?? id,
          family: provider.family,
          capabilityTags: doc?.capabilityTags ?? [],
          modalities: doc?.modalities ?? ['text'],
          lifecycle: 'DISCOVERED' as const,
          source: 'PROVIDER_API' as const,
          aliases: doc?.aliases ?? [],
          isProviderDefault: doc?.isProviderDefault ?? false,
        };
      })
      : documented;

    const { added, removed } = persistProviderCatalog(provider.providerId, incoming, source);
    results.push({
      providerId: provider.providerId,
      outcome,
      source,
      discoveredCount: incoming.length,
      error: null,
      added,
      removed,
    });
  }

  const finishedAt = new Date().toISOString();
  const report: CatalogRefreshReport = {
    refreshId,
    trigger,
    startedAt,
    finishedAt,
    providers: results,
    anyStale: results.some((r) => r.outcome === 'FAILED_STALE'),
    inferenceCalls: 0,
  };

  getDatabase().prepare(`
    INSERT INTO model_catalog_refreshes (refresh_id, trigger, started_at, finished_at, any_stale, report_json)
    VALUES (?,?,?,?,?,?)
  `).run(refreshId, trigger, startedAt, finishedAt, report.anyStale ? 1 : 0, JSON.stringify(report));

  return report;
}

/**
 * Write one provider's catalog and return the diff.
 *
 * A model that disappears is marked REMOVED rather than deleted, so a
 * provider retiring a snapshot leaves a record instead of a silent gap.
 */
function persistProviderCatalog(
  providerId: CatalogProviderId,
  incoming: CatalogModel[],
  source: ModelSource,
): { added: string[]; removed: string[] } {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = db.prepare(
    'SELECT model_id, lifecycle FROM model_catalog_entries WHERE provider_id = ?',
  ).all(providerId) as Array<{ model_id: string; lifecycle: string }>;
  const existingIds = new Set(existing.map((r) => r.model_id));
  const incomingIds = new Set(incoming.map((m) => m.modelId));

  const added = incoming.map((m) => m.modelId).filter((id) => !existingIds.has(id));
  const removed = existing
    .filter((r) => r.lifecycle !== 'REMOVED' && !incomingIds.has(r.model_id))
    .map((r) => r.model_id);

  const upsert = db.prepare(`
    INSERT INTO model_catalog_entries
      (provider_id, model_id, display_name, source, lifecycle, aliases_json, capability_json, first_seen_at, last_seen_at, removed_at)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)
    ON CONFLICT(provider_id, model_id) DO UPDATE SET
      display_name = excluded.display_name,
      source = excluded.source,
      lifecycle = excluded.lifecycle,
      aliases_json = excluded.aliases_json,
      capability_json = excluded.capability_json,
      last_seen_at = excluded.last_seen_at,
      removed_at = NULL
  `);
  for (const m of incoming) {
    upsert.run(
      providerId, m.modelId, m.displayName, source, m.lifecycle,
      JSON.stringify(m.aliases), JSON.stringify(m.capabilityTags), now, now,
    );
  }

  const markRemoved = db.prepare(
    "UPDATE model_catalog_entries SET lifecycle = 'REMOVED', removed_at = ? WHERE provider_id = ? AND model_id = ?",
  );
  for (const id of removed) markRemoved.run(now, providerId, id);

  return { added, removed };
}
