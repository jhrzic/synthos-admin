// ---------------------------------------------------------------------------
// MODEL PRICING CATALOG — automatic, versioned, zero inference.
//
// Keeps provider/model prices current from the providers' OWN published
// pricing documents (lib/pricing/parse.ts). Nobody types a price.
//
// ZERO-INFERENCE GUARANTEE. Refresh issues plain GET requests for
// documentation pages. It never imports a generation adapter or the spend
// guard's paid path, never writes provider_usage, never emits PROVIDER_CALL.
// test/pricing-catalog.test.ts asserts all of that structurally and at runtime.
//
// FAILURE PRESERVES THE LAST-KNOWN PRICE. A refresh that cannot fetch or
// cannot parse a source keeps the stored prices for that provider and records
// the failure. A provider whose last SUCCESSFUL refresh is older than the
// policy's pricing.maxAgeHours is STALE, and the spend guard blocks it
// (PRICE_STALE) — a stale price is not trusted for a ceiling.
//
// VERSIONED. Each (provider, model) price carries a version that increments on
// every change, and every change is written to model_price_history (ADDED,
// CHANGED, REMOVED_UNPRICED). Each paid call stores the exact snapshot it was
// priced with, so a later price change never rewrites historical cost.
//
// PRICING NEVER CHANGES ROUTING. Nothing here touches lib/model-router.ts.
// A price rise is surfaced and re-evaluated by the spend guard on the next
// call — a selected model that no longer fits policy is BLOCKED, never
// silently swapped for another.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from '../persistence';
import {
  parseOpenAiPricingMarkdown, parseOpenAiLongContextThreshold, parseGeminiPricingMarkdown,
  parseAntigravityUnderlyingModel, type PriceRecord,
} from './parse';

export const PRICING_SOURCES = {
  openai: 'https://platform.openai.com/docs/pricing.md',
  openaiModelPage: (id: string) => `https://platform.openai.com/docs/models/${encodeURIComponent(id)}.md`,
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing.md.txt',
  antigravity: 'https://ai.google.dev/gemini-api/docs/antigravity-agent.md.txt',
} as const;

export type PricingSourceId = 'openai' | 'gemini' | 'antigravity';
export type PricingTrigger = 'STARTUP' | 'SCHEDULED' | 'MANUAL' | 'TEST';

/** GET a documentation page as text. Injectable so tests never touch the network. */
export type TextFetcher = (url: string) => Promise<string>;

const MAX_DOC_BYTES = 2 * 1024 * 1024;
/** Cap on per-model page fetches per refresh (long-context thresholds). */
const MAX_THRESHOLD_FETCHES = 12;

export const defaultTextFetcher: TextFetcher = async (url: string) => {
  const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'SynthOS-pricing-catalog/1.0', Accept: 'text/markdown, text/plain' } });
  if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_DOC_BYTES) throw new Error(`GET ${url} exceeded ${MAX_DOC_BYTES} bytes`);
  return text;
};

let ensured = false;
export function ensurePricingTables(): void {
  const db = getDatabase();
  if (ensured) {
    try { db.prepare('SELECT 1 FROM model_prices LIMIT 1').get(); return; } catch { ensured = false; }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_prices (
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      version INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, model_id)
    );
    CREATE TABLE IF NOT EXISTS model_price_history (
      change_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      old_json TEXT,
      new_json TEXT,
      old_version INTEGER,
      new_version INTEGER,
      refresh_id TEXT NOT NULL,
      detected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_history_model ON model_price_history(provider, model_id, detected_at);
    CREATE TABLE IF NOT EXISTS pricing_sources (
      source_id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_status TEXT,
      last_error TEXT,
      last_trigger TEXT,
      models_count INTEGER,
      content_hash TEXT
    );
  `);
  ensured = true;
}

function hash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Canonical JSON of the PRICE-BEARING fields only, so a cosmetic change is not a price change. */
function priceKey(r: PriceRecord): string {
  return JSON.stringify({ unit: r.unit, currency: r.currency, windows: r.windows, longContext: r.longContext, derivedFrom: r.derivedFrom });
}

export interface SourceRefreshResult {
  sourceId: PricingSourceId;
  status: 'OK' | 'FAILED';
  models: number;
  added: number;
  changed: number;
  removed: number;
  error?: string;
}

/**
 * Store one provider's freshly parsed price list, diffing against what is
 * stored. Exported so a deterministic fixture can seed the catalog through the
 * same path a real refresh uses.
 */
export function applyPriceRecords(sourceId: PricingSourceId, sourceUrl: string, records: PriceRecord[], refreshId: string, trigger: PricingTrigger, contentHash: string): SourceRefreshResult {
  ensurePricingTables();
  const db = getDatabase();
  const now = new Date().toISOString();
  const providers = [...new Set(records.map((r) => r.provider))];
  const existing = db.prepare('SELECT * FROM model_prices WHERE source_id = ?').all(sourceId) as any[];
  const byKey = new Map(existing.map((e) => [`${e.provider}|${e.model_id}`, e]));
  const seen = new Set<string>();
  let added = 0; let changed = 0; let removed = 0;
  const history = db.prepare(`INSERT INTO model_price_history (change_id, provider, model_id, change_type, old_json, new_json, old_version, new_version, refresh_id, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const newId = () => `pch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of records) {
      const k = `${r.provider}|${r.modelId}`;
      if (seen.has(k)) continue; // first occurrence wins (the provider's primary table)
      seen.add(k);
      const json = JSON.stringify(r);
      const h = hash(priceKey(r));
      const prev = byKey.get(k);
      if (!prev) {
        db.prepare(`INSERT INTO model_prices (provider, model_id, record_json, content_hash, version, source_id, source_url, first_seen_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`)
          .run(r.provider, r.modelId, json, h, sourceId, sourceUrl, now, now);
        history.run(newId(), r.provider, r.modelId, 'ADDED', null, json, null, 1, refreshId, now);
        added += 1;
      } else if (prev.content_hash !== h) {
        const v = Number(prev.version) + 1;
        db.prepare(`UPDATE model_prices SET record_json = ?, content_hash = ?, version = ?, source_url = ?, updated_at = ? WHERE provider = ? AND model_id = ?`)
          .run(json, h, v, sourceUrl, now, r.provider, r.modelId);
        history.run(newId(), r.provider, r.modelId, 'CHANGED', prev.record_json, json, prev.version, v, refreshId, now);
        changed += 1;
      }
    }
    // A model the source no longer prices becomes UNPRICED — and therefore blocked.
    for (const e of existing) {
      if (seen.has(`${e.provider}|${e.model_id}`)) continue;
      db.prepare('DELETE FROM model_prices WHERE provider = ? AND model_id = ?').run(e.provider, e.model_id);
      history.run(newId(), e.provider, e.model_id, 'REMOVED_UNPRICED', e.record_json, null, e.version, null, refreshId, now);
      removed += 1;
    }
    db.prepare(`INSERT INTO pricing_sources (source_id, source_url, last_attempt_at, last_success_at, last_status, last_error, last_trigger, models_count, content_hash)
                VALUES (?, ?, ?, ?, 'OK', NULL, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET source_url = excluded.source_url, last_attempt_at = excluded.last_attempt_at,
                  last_success_at = excluded.last_success_at, last_status = 'OK', last_error = NULL, last_trigger = excluded.last_trigger,
                  models_count = excluded.models_count, content_hash = excluded.content_hash`)
      .run(sourceId, sourceUrl, now, now, trigger, seen.size, contentHash);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* nothing to roll back */ }
    throw err;
  }
  void providers;
  return { sourceId, status: 'OK', models: seen.size, added, changed, removed };
}

function recordFailure(sourceId: PricingSourceId, sourceUrl: string, error: string, trigger: PricingTrigger): SourceRefreshResult {
  ensurePricingTables();
  const now = new Date().toISOString();
  getDatabase().prepare(`INSERT INTO pricing_sources (source_id, source_url, last_attempt_at, last_success_at, last_status, last_error, last_trigger, models_count, content_hash)
                         VALUES (?, ?, ?, NULL, 'FAILED', ?, ?, NULL, NULL)
                         ON CONFLICT(source_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_status = 'FAILED', last_error = excluded.last_error, last_trigger = excluded.last_trigger`)
    .run(sourceId, sourceUrl, now, error.slice(0, 300), trigger);
  return { sourceId, status: 'FAILED', models: 0, added: 0, changed: 0, removed: 0, error };
}

export interface PricingRefreshReport {
  refreshId: string;
  trigger: PricingTrigger;
  startedAt: string;
  finishedAt: string;
  sources: SourceRefreshResult[];
}

let lastReport: PricingRefreshReport | null = null;
export function lastPricingRefresh(): PricingRefreshReport | null {
  return lastReport;
}

/**
 * Refresh every pricing source. Each source is independent: one failing keeps
 * its last-known prices and does not stop the others.
 */
export async function refreshPricingCatalog(trigger: PricingTrigger, opts: { fetchText?: TextFetcher; antigravityAgentId?: string } = {}): Promise<PricingRefreshReport> {
  const fetchText = opts.fetchText ?? defaultTextFetcher;
  const refreshId = `prf-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const startedAt = new Date().toISOString();
  const sources: SourceRefreshResult[] = [];
  let geminiRecords: PriceRecord[] = [];
  let geminiSections: Record<string, string[]> = {};

  // --- OpenAI (text models + per-character speech) -------------------------
  try {
    const md = await fetchText(PRICING_SOURCES.openai);
    if (!md.includes('### Standard pricing data')) throw new Error('The OpenAI pricing document no longer has the expected "Standard pricing data" table; prices were not updated.');
    const parsed = parseOpenAiPricingMarkdown(md, PRICING_SOURCES.openai);
    if (parsed.records.filter((r) => r.provider === 'openai').length < 3) throw new Error('Fewer than 3 OpenAI models could be priced from the document; prices were not updated.');
    // Long-context thresholds come from each model's own page. Where one
    // cannot be read, the threshold stays null and estimates use the higher
    // long-context rate.
    for (const id of parsed.needsThreshold.slice(0, MAX_THRESHOLD_FETCHES)) {
      try {
        const t = parseOpenAiLongContextThreshold(await fetchText(PRICING_SOURCES.openaiModelPage(id)));
        const rec = parsed.records.find((r) => r.provider === 'openai' && r.modelId === id);
        if (rec?.longContext && t !== null) rec.longContext.thresholdTokens = t;
      } catch { /* threshold stays unknown → conservative estimate */ }
    }
    sources.push(applyPriceRecords('openai', PRICING_SOURCES.openai, parsed.records, refreshId, trigger, hash(md)));
  } catch (err: any) {
    sources.push(recordFailure('openai', PRICING_SOURCES.openai, String(err?.message || err), trigger));
  }

  // --- Google Gemini --------------------------------------------------------
  try {
    const md = await fetchText(PRICING_SOURCES.gemini);
    const parsed = parseGeminiPricingMarkdown(md, PRICING_SOURCES.gemini);
    if (parsed.records.length < 3) throw new Error('Fewer than 3 Gemini models could be priced from the document; prices were not updated.');
    geminiRecords = parsed.records;
    geminiSections = parsed.sectionsByName;
    sources.push(applyPriceRecords('gemini', PRICING_SOURCES.gemini, parsed.records, refreshId, trigger, hash(md)));
  } catch (err: any) {
    sources.push(recordFailure('gemini', PRICING_SOURCES.gemini, String(err?.message || err), trigger));
  }

  // --- Antigravity: derived from the Gemini model the agent is built on ------
  try {
    if (geminiRecords.length === 0) throw new Error('Gemini prices were not refreshed, so the Antigravity price cannot be derived this time.');
    const md = await fetchText(PRICING_SOURCES.antigravity);
    const name = parseAntigravityUnderlyingModel(md);
    if (!name) throw new Error('Could not read which Gemini model the Antigravity agent is built on.');
    const ids = geminiSections[name];
    const base = ids ? geminiRecords.find((r) => r.modelId === ids[0]) : undefined;
    if (!base) throw new Error(`"${name}" has no priced entry in the Gemini pricing document.`);
    const agentId = opts.antigravityAgentId ?? (await import('../antigravity-client')).resolveAntigravityAgent();
    const record: PriceRecord = {
      ...base, provider: 'antigravity', modelId: agentId, derivedFrom: `gemini:${base.modelId}`, sourceUrl: PRICING_SOURCES.antigravity,
      notes: [
        `Inference is billed at ${name} list rates, including intermediate tokens generated during the agent loop.`,
        'max_total_tokens is best-effort: the provider says actual usage may slightly exceed it.',
        'Cached tokens do not count toward max_total_tokens and are billed separately.',
        'Tool fees (e.g. Search grounding) are billed separately and are not included in this estimate.',
        'Sandbox compute is not billed during the preview.',
      ],
    };
    sources.push(applyPriceRecords('antigravity', PRICING_SOURCES.antigravity, [record], refreshId, trigger, hash(md)));
  } catch (err: any) {
    sources.push(recordFailure('antigravity', PRICING_SOURCES.antigravity, String(err?.message || err), trigger));
  }

  lastReport = { refreshId, trigger, startedAt, finishedAt: new Date().toISOString(), sources };
  return lastReport;
}

// ---------------------------------------------------------------------------
// LOOKUP
// ---------------------------------------------------------------------------

export interface PriceLookup {
  record: PriceRecord;
  version: number;
  versionKey: string;
  sourceId: PricingSourceId;
  lastSuccessAt: string | null;
  ageHours: number | null;
}

export function getCatalogPrice(provider: string, modelId: string): PriceLookup | null {
  ensurePricingTables();
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM model_prices WHERE provider = ? AND model_id = ?').get(provider, modelId) as any;
  if (!row) return null;
  const src = db.prepare('SELECT last_success_at FROM pricing_sources WHERE source_id = ?').get(row.source_id) as any;
  const lastSuccessAt = src?.last_success_at ?? null;
  return {
    record: JSON.parse(row.record_json),
    version: Number(row.version),
    versionKey: `${provider}:${modelId}#v${row.version}:${String(row.content_hash).slice(0, 12)}`,
    sourceId: row.source_id,
    lastSuccessAt,
    ageHours: lastSuccessAt ? (Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000 : null,
  };
}

export function listCatalogPrices(): Array<{ provider: string; modelId: string; version: number; updatedAt: string; record: PriceRecord }> {
  ensurePricingTables();
  return (getDatabase().prepare('SELECT * FROM model_prices ORDER BY provider, model_id').all() as any[])
    .map((r) => ({ provider: r.provider, modelId: r.model_id, version: Number(r.version), updatedAt: r.updated_at, record: JSON.parse(r.record_json) }));
}

export function listPricingSources(): any[] {
  ensurePricingTables();
  return getDatabase().prepare('SELECT * FROM pricing_sources ORDER BY source_id').all() as any[];
}

/** When did this model's price change? */
export function priceHistory(provider?: string, modelId?: string, limit = 50): any[] {
  ensurePricingTables();
  if (provider && modelId) {
    return getDatabase().prepare('SELECT * FROM model_price_history WHERE provider = ? AND model_id = ? ORDER BY detected_at DESC LIMIT ?').all(provider, modelId, limit) as any[];
  }
  return getDatabase().prepare('SELECT * FROM model_price_history ORDER BY detected_at DESC LIMIT ?').all(limit) as any[];
}
