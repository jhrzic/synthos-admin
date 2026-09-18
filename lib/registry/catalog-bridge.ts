// ---------------------------------------------------------------------------
// PRICING CATALOG → REGISTRY — an explicit operator step, never automatic.
//
// lib/pricing/catalog.ts can read official pricing documentation, but only
// when an operator runs it manually (it is no longer run at startup or on a
// schedule). What it reads is reference data. It prices nothing until an
// operator applies it here, which writes the new pricing into the registry
// through the same validated Admin import. Every model whose price changed is
// thereby UN-qualified: a new price is a new record, and it runs only after an
// operator qualifies it again.
// ---------------------------------------------------------------------------

import { listCatalogPrices, listPricingSources } from '../pricing/catalog';
import type { PriceRecord } from '../pricing/parse';
import { ensureRegistry } from './install';
import { getStoredProvider, listStoredModels, importManifest, type ImportOutcome } from './store';
import type { ModelManifest, PricingRecord } from './types';

export const DEFAULT_PRICE_STALE_DAYS = 60;

export function pricingFromCatalogRecord(rec: PriceRecord, verifiedAt: string, staleDays = DEFAULT_PRICE_STALE_DAYS): PricingRecord[] {
  const staleAfter = new Date(Date.parse(verifiedAt) + staleDays * 86_400_000).toISOString();
  return rec.windows.map((w) => {
    let rates = { input: w.rates.input, output: w.rates.output, cachedInput: w.rates.cachedInput ?? null };
    const tiers: PricingRecord['tiers'] = [];
    const lw = rec.longContext ? (rec.longContext.windows.find((x) => (x.from ?? null) === (w.from ?? null)) ?? rec.longContext.windows[0]) : null;
    if (lw && rec.longContext) {
      const long = { input: lw.rates.input, output: lw.rates.output, cachedInput: lw.rates.cachedInput ?? null };
      if (rec.longContext.thresholdTokens) tiers.push({ thresholdTokens: rec.longContext.thresholdTokens, rates: long });
      // Threshold not published: price every request at the higher rate. Over-estimating is the safe direction.
      else rates = { input: Math.max(rates.input, long.input), output: Math.max(rates.output, long.output), cachedInput: rates.cachedInput === null || long.cachedInput === null ? null : Math.max(rates.cachedInput, long.cachedInput) };
    }
    return {
      currency: rec.currency, unit: rec.unit, rates, reasoningTokens: 'BILLED_AS_OUTPUT', tiers, toolCharges: [], modalityCharges: [],
      effectiveFrom: w.from ? new Date(`${w.from}T00:00:00Z`).toISOString() : verifiedAt,
      effectiveUntil: w.until ? new Date(`${w.until}T23:59:59Z`).toISOString() : null,
      source: rec.sourceUrl, verifiedAt, staleAfter, approval: 'APPROVED',
    } satisfies PricingRecord;
  });
}

/**
 * Apply the manually refreshed catalog's prices for one provider to the
 * registry. Existing models keep their metadata and take the new pricing; ids
 * the registry does not have are added with EMPTY metadata (METADATA_REQUIRED)
 * — a price list says what something costs, not what it can do.
 */
export function applyCatalogPricesToRegistry(providerId: string, actor: string, opts: { staleDays?: number } = {}): ImportOutcome | { ok: false; errors: string[] } {
  ensureRegistry();
  const provider = getStoredProvider(providerId);
  if (!provider) return { ok: false, errors: [`provider ${providerId} is not installed`] };
  const source = listPricingSources().find((s: any) => s.source_id === providerId);
  if (!source?.last_success_at) return { ok: false, errors: [`no successful manual pricing refresh exists for ${providerId}`] };
  const verifiedAt = new Date(source.last_success_at).toISOString();
  const prices = new Map(listCatalogPrices().filter((p) => p.provider === providerId).map((p) => [p.modelId, p.record]));
  const existing = listStoredModels(providerId).filter((m) => !m.removedAt);
  const protocol = provider.manifest.provider.protocol;
  const strip = (m: ModelManifest): ModelManifest => ({ ...m, capabilities: m.capabilities.map(({ provenance: _p, manifestVersion: _m, adapterVersion: _a, lastUpdated: _l, ...c }) => c) });
  const models: ModelManifest[] = existing.map((m) => {
    const rec = prices.get(m.modelId);
    return rec ? { ...strip(m.record), pricing: pricingFromCatalogRecord(rec, verifiedAt, opts.staleDays) } : strip(m.record);
  });
  for (const [modelId, rec] of prices) {
    if (existing.some((m) => m.modelId === modelId)) continue;
    models.push({
      modelId, aliases: [], displayName: modelId, lifecycle: 'ACTIVE', releaseDate: null, deprecationDate: null, shutdownDate: null,
      limits: { contextTokens: null, outputTokens: null }, modalities: { input: [], output: [] }, capabilities: [],
      supportedParameters: [], outputContracts: [], pricing: pricingFromCatalogRecord(rec, verifiedAt, opts.staleDays),
      adapterCompatibility: { protocol, minAdapterVersion: '1.0.0' }, restrictions: { regions: [], compliance: [] },
    });
  }
  const manifest = {
    ...provider.manifest,
    manifestVersion: `${provider.manifest.manifestVersion.split('+')[0].slice(0, 40)}+prices.${Date.now()}`,
    provenance: { publisher: `admin:${actor}`, generatedAt: new Date().toISOString(), notes: `Prices applied from the manual pricing refresh of ${verifiedAt}` },
    signature: undefined,
    models,
  };
  return importManifest(manifest, { source: 'ADMIN', actor });
}
