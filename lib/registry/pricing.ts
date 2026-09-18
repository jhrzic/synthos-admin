// ---------------------------------------------------------------------------
// REGISTRY PRICING — the price the spend guard reserves against.
//
// Resolves the ONE pricing record in force now for a registry model. Missing,
// overlapping (conflicting) or publisher-unreviewed pricing yields no price,
// and the guard then blocks. The version key names the manifest version and
// the hash of the exact pricing record, and is stored with the immutable price
// snapshot on every ledger row, so a later manifest can never change what a
// past execution was estimated or charged at.
// ---------------------------------------------------------------------------

import type { ModelManifest, PricingRecord } from './types';
import { pricingHash } from './schema';

export type PricingState = 'CURRENT' | 'STALE' | 'MISSING' | 'CONFLICTING' | 'NOT_APPROVED';

export function currentPricing(model: ModelManifest, atIso: string = new Date().toISOString()): { state: PricingState; record: PricingRecord | null; reason: string } {
  const at = Date.parse(atIso);
  const covering = model.pricing.filter((p) => Date.parse(p.effectiveFrom) <= at && (p.effectiveUntil === null || at <= Date.parse(p.effectiveUntil)));
  if (covering.length === 0) return { state: 'MISSING', record: null, reason: model.pricing.length ? 'no pricing record is in effect now' : 'the manifest carries no pricing' };
  if (covering.length > 1) return { state: 'CONFLICTING', record: null, reason: `${covering.length} pricing records overlap now; the price is ambiguous` };
  const rec = covering[0];
  if (rec.approval !== 'APPROVED') return { state: 'NOT_APPROVED', record: rec, reason: `pricing from "${rec.source}" is marked UNREVIEWED by its publisher` };
  const reasoning = model.capabilities.some((c) => c.id === 'reasoning.controls' && c.supported);
  if (reasoning && rec.reasoningTokens === 'UNKNOWN') return { state: 'NOT_APPROVED', record: rec, reason: 'reasoning-token billing is UNKNOWN for a reasoning model' };
  if (Date.parse(rec.staleAfter) < at) return { state: 'STALE', record: rec, reason: `pricing was last verified ${rec.verifiedAt} and went stale at ${rec.staleAfter}` };
  return { state: 'CURRENT', record: rec, reason: '' };
}

export function priceVersionKey(providerId: string, modelId: string, manifestVersion: string, rec: PricingRecord): string {
  return `registry:${providerId}:${modelId}#${manifestVersion}:${pricingHash(rec).slice(0, 12)}`;
}
