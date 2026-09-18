// ---------------------------------------------------------------------------
// REGISTRY — manifest schema, validation and normalization.
//
// Every path into the registry (bundled provider plugin, signed JSON import,
// Admin registration, manual discovery) passes through validateManifest().
// There is no second schema and no lenient path.
//
// CAPABILITIES ARE NEVER INFERRED FROM NAMES. A capability exists only because
// a manifest says so. An id this build does not know is not discarded: it is
// namespaced `x.<provider>.<id>` and retained, so a provider's new feature can
// enter the registry before SynthOS has a normalized equivalent.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import {
  REGISTRY_SCHEMA_VERSION, type RegistryManifest, type ModelManifest, type CapabilityRecord, type PricingRecord,
  type ProtocolId, type ProviderManifestBody,
} from './types';

export const PROTOCOLS: readonly ProtocolId[] = ['openai.responses', 'openai.chat_completions', 'gemini.generate_content', 'gemini.interactions', 'anthropic.messages'];

/** The normalized capability vocabulary. Extensible: anything else becomes `x.<provider>.<id>`. */
export const KNOWN_CAPABILITIES = [
  'text.input', 'text.output',
  'image.input', 'image.output',
  'audio.input', 'audio.output',
  'video.input', 'video.output',
  'embeddings',
  'reasoning.controls',
  'tools.function_calling',
  'output.structured', 'output.json_schema',
  'streaming',
  'prompt_caching',
  'computer_use',
  'tools.web_search',
  'tools.code_execution',
  'batch',
  'agent.managed_loop',
] as const;

const KNOWN = new Set<string>(KNOWN_CAPABILITIES);
const EXTENSION_ID = /^x\.[a-z0-9_-]+\.[a-z0-9_.-]+$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{1,39}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CONTRACTS = new Set(['NARRATIVE', 'LITERAL', 'JSON_OBJECT']);

function isIso(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}
function isoOrNull(v: unknown): v is string | null {
  return v === null || v === undefined || isIso(v);
}
function nonNeg(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function strArr(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Stable JSON: object keys sorted recursively. What hashes and signatures are computed over. */
export function canonicalJson(value: unknown): string {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** The bytes a manifest signature covers: the manifest minus its signature. */
export function signedPayload(m: RegistryManifest): string {
  const { signature: _s, ...rest } = m;
  return canonicalJson(rest);
}

export function verifyManifestSignature(m: RegistryManifest, publicKeyPem: string): boolean {
  if (!m.signature || m.signature.algorithm !== 'ed25519') return false;
  try {
    return crypto.verify(null, Buffer.from(signedPayload(m)), crypto.createPublicKey(publicKeyPem), Buffer.from(m.signature.value, 'base64'));
  } catch {
    return false;
  }
}

/** Sign a manifest (tooling and tests). The private key never enters the registry. */
export function signManifest(m: RegistryManifest, privateKeyPem: string, keyId: string): RegistryManifest {
  const value = crypto.sign(null, Buffer.from(signedPayload(m)), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return { ...m, signature: { algorithm: 'ed25519', keyId, value } };
}

/**
 * Normalize one capability id. Known ids pass; namespaced extensions pass;
 * anything else is namespaced under the provider rather than dropped.
 */
export function normalizeCapabilityId(providerId: string, raw: string): string {
  const id = raw.trim();
  if (KNOWN.has(id) || EXTENSION_ID.test(id)) return id;
  const slug = id.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '') || 'unnamed';
  return `x.${providerId}.${slug}`;
}

export function isKnownCapability(id: string): boolean {
  return KNOWN.has(id);
}

export type ValidationResult = { ok: true; manifest: RegistryManifest; warnings: string[] } | { ok: false; errors: string[] };

function validateRates(path: string, r: any, errors: string[]): void {
  if (!r || typeof r !== 'object') { errors.push(`${path} is required`); return; }
  if (!nonNeg(r.input)) errors.push(`${path}.input must be a finite number ≥ 0`);
  if (!nonNeg(r.output)) errors.push(`${path}.output must be a finite number ≥ 0`);
  if (!(r.cachedInput === null || nonNeg(r.cachedInput))) errors.push(`${path}.cachedInput must be a number ≥ 0 or null`);
}

function validatePricing(path: string, p: any, errors: string[]): void {
  if (!p || typeof p !== 'object') { errors.push(`${path} must be an object`); return; }
  if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) errors.push(`${path}.currency must be an ISO 4217 code`);
  if (p.unit !== 'tokens' && p.unit !== 'chars') errors.push(`${path}.unit must be "tokens" or "chars"`);
  validateRates(`${path}.rates`, p.rates, errors);
  if (!['BILLED_AS_OUTPUT', 'NOT_BILLED', 'NOT_APPLICABLE', 'UNKNOWN'].includes(p.reasoningTokens)) errors.push(`${path}.reasoningTokens is invalid`);
  if (!Array.isArray(p.tiers)) errors.push(`${path}.tiers must be an array`);
  else p.tiers.forEach((t: any, i: number) => {
    if (!nonNeg(t?.thresholdTokens) || !Number.isInteger(t.thresholdTokens)) errors.push(`${path}.tiers[${i}].thresholdTokens must be a whole number`);
    validateRates(`${path}.tiers[${i}].rates`, t?.rates, errors);
  });
  for (const k of ['toolCharges', 'modalityCharges']) {
    if (!Array.isArray(p[k])) errors.push(`${path}.${k} must be an array`);
    else p[k].forEach((c: any, i: number) => {
      if (typeof (c?.tool ?? c?.modality) !== 'string' || typeof c?.unit !== 'string' || !nonNeg(c?.usd)) errors.push(`${path}.${k}[${i}] is invalid`);
    });
  }
  if (!isIso(p.effectiveFrom)) errors.push(`${path}.effectiveFrom must be an ISO date`);
  if (!isoOrNull(p.effectiveUntil)) errors.push(`${path}.effectiveUntil must be an ISO date or null`);
  if (typeof p.source !== 'string' || !p.source.trim()) errors.push(`${path}.source is required`);
  if (!isIso(p.verifiedAt)) errors.push(`${path}.verifiedAt must be an ISO date`);
  if (!isIso(p.staleAfter)) errors.push(`${path}.staleAfter must be an ISO date`);
  if (isIso(p.verifiedAt) && isIso(p.staleAfter) && Date.parse(p.staleAfter) <= Date.parse(p.verifiedAt)) errors.push(`${path}.staleAfter must be after verifiedAt`);
  if (p.approval !== 'APPROVED' && p.approval !== 'UNREVIEWED') errors.push(`${path}.approval must be APPROVED or UNREVIEWED`);
}

function validateProvider(p: any, errors: string[]): void {
  if (!p || typeof p !== 'object') { errors.push('provider is required'); return; }
  if (typeof p.providerId !== 'string' || !PROVIDER_ID.test(p.providerId)) errors.push('provider.providerId must match /^[a-z][a-z0-9_-]{1,39}$/');
  if (typeof p.displayName !== 'string' || !p.displayName.trim()) errors.push('provider.displayName is required');
  if (!PROTOCOLS.includes(p.protocol)) errors.push(`provider.protocol must be one of ${PROTOCOLS.join(', ')}`);
  if (typeof p.adapterVersion !== 'string' || !SEMVER.test(p.adapterVersion)) errors.push('provider.adapterVersion must be semver');
  if (!strArr(p.approvedHosts) || p.approvedHosts.length === 0 || !p.approvedHosts.every((h: string) => HOST.test(h))) errors.push('provider.approvedHosts must be a non-empty list of lowercase hostnames');
  let base: URL | null = null;
  try { base = new URL(p.defaultBaseUrl); } catch { errors.push('provider.defaultBaseUrl must be a URL'); }
  if (base) {
    if (base.protocol !== 'https:') errors.push('provider.defaultBaseUrl must be https');
    if (strArr(p.approvedHosts) && !p.approvedHosts.includes(base.hostname)) errors.push('provider.defaultBaseUrl host must be one of approvedHosts');
    if (base.username || base.password) errors.push('provider.defaultBaseUrl must not carry credentials');
  }
  if (!(p.baseUrlEnvVar === null || (typeof p.baseUrlEnvVar === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(p.baseUrlEnvVar)))) errors.push('provider.baseUrlEnvVar must be an env var name or null');
  if (!p.auth || !['BEARER', 'API_KEY_HEADER', 'NONE'].includes(p.auth.type)) errors.push('provider.auth.type is invalid');
  else {
    if (!(p.auth.credentialSlot === null || (typeof p.auth.credentialSlot === 'string' && PROVIDER_ID.test(p.auth.credentialSlot)))) errors.push('provider.auth.credentialSlot is invalid');
    if (!strArr(p.auth.envVars) || !p.auth.envVars.every((v: string) => /^[A-Z][A-Z0-9_]{2,63}$/.test(v))) errors.push('provider.auth.envVars must be env var names');
    if (p.auth.type !== 'NONE' && (!strArr(p.auth.envVars) || p.auth.envVars.length === 0) && !p.auth.credentialSlot) errors.push('provider.auth needs envVars or a credentialSlot');
  }
  if (!['METERED', 'MANAGED_AGENT', 'FREE_LOCAL'].includes(p.billing)) errors.push('provider.billing is invalid');
  if (!p.restrictions || !strArr(p.restrictions.regions) || !strArr(p.restrictions.compliance)) errors.push('provider.restrictions must have regions[] and compliance[]');
}

function validateModel(providerId: string, protocol: string, m: any, i: number, errors: string[]): void {
  const path = `models[${i}]`;
  if (!m || typeof m !== 'object') { errors.push(`${path} must be an object`); return; }
  if (typeof m.modelId !== 'string' || !ID.test(m.modelId)) errors.push(`${path}.modelId is invalid`);
  if (!strArr(m.aliases) || !m.aliases.every((a: string) => ID.test(a))) errors.push(`${path}.aliases must be a list of ids`);
  if (typeof m.displayName !== 'string' || !m.displayName.trim()) errors.push(`${path}.displayName is required`);
  if (!['ACTIVE', 'PREVIEW', 'DEPRECATED', 'REMOVED'].includes(m.lifecycle)) errors.push(`${path}.lifecycle is invalid`);
  for (const k of ['releaseDate', 'deprecationDate', 'shutdownDate']) if (!isoOrNull(m[k])) errors.push(`${path}.${k} must be an ISO date or null`);
  if (!m.limits || !(m.limits.contextTokens === null || nonNeg(m.limits.contextTokens)) || !(m.limits.outputTokens === null || nonNeg(m.limits.outputTokens))) errors.push(`${path}.limits must have contextTokens/outputTokens (number or null)`);
  if (!m.modalities || !strArr(m.modalities.input) || !strArr(m.modalities.output)) errors.push(`${path}.modalities must have input[] and output[]`);
  if (!Array.isArray(m.capabilities)) errors.push(`${path}.capabilities must be an array`);
  else m.capabilities.forEach((c: any, j: number) => {
    if (typeof c?.id !== 'string' || !c.id.trim()) errors.push(`${path}.capabilities[${j}].id is required`);
    if (typeof c?.supported !== 'boolean') errors.push(`${path}.capabilities[${j}].supported must be boolean`);
    if (typeof c?.source !== 'string' || !c.source.trim()) errors.push(`${path}.capabilities[${j}].source is required`);
    if (!['DOCUMENTED', 'PUBLISHER_ASSERTED', 'ADMIN_ASSERTED', 'VERIFIED', 'UNVERIFIED'].includes(c?.verification)) errors.push(`${path}.capabilities[${j}].verification is invalid`);
    if (!isoOrNull(c?.effectiveDate)) errors.push(`${path}.capabilities[${j}].effectiveDate must be an ISO date or null`);
  });
  if (!strArr(m.supportedParameters)) errors.push(`${path}.supportedParameters must be a list`);
  if (!strArr(m.outputContracts) || !m.outputContracts.every((c: string) => CONTRACTS.has(c))) errors.push(`${path}.outputContracts must list NARRATIVE / LITERAL / JSON_OBJECT`);
  if (!Array.isArray(m.pricing)) errors.push(`${path}.pricing must be an array (may be empty — the model then cannot run paid)`);
  else m.pricing.forEach((p: any, j: number) => validatePricing(`${path}.pricing[${j}]`, p, errors));
  if (!m.adapterCompatibility || !PROTOCOLS.includes(m.adapterCompatibility.protocol) || typeof m.adapterCompatibility.minAdapterVersion !== 'string' || !SEMVER.test(m.adapterCompatibility.minAdapterVersion)) {
    errors.push(`${path}.adapterCompatibility must name a protocol and a semver minAdapterVersion`);
  } else if (m.adapterCompatibility.protocol !== protocol) {
    errors.push(`${path}.adapterCompatibility.protocol (${m.adapterCompatibility.protocol}) differs from the provider protocol (${protocol})`);
  }
  if (!m.restrictions || !strArr(m.restrictions.regions) || !strArr(m.restrictions.compliance)) errors.push(`${path}.restrictions must have regions[] and compliance[]`);
  if (m.extensions !== undefined && (typeof m.extensions !== 'object' || m.extensions === null || Array.isArray(m.extensions))) errors.push(`${path}.extensions must be an object`);
  void providerId;
}

/**
 * Validate and normalize a manifest. Returns a NEW object; the input is not
 * mutated. Validation is total: one bad model rejects the whole manifest, so a
 * partially-applied import cannot happen.
 */
export function validateManifest(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const m = raw as any;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['manifest must be a JSON object'] };
  if (m.schemaVersion !== REGISTRY_SCHEMA_VERSION) errors.push(`schemaVersion must be "${REGISTRY_SCHEMA_VERSION}"`);
  if (typeof m.manifestVersion !== 'string' || !m.manifestVersion.trim() || m.manifestVersion.length > 64) errors.push('manifestVersion is required');
  if (!m.provenance || typeof m.provenance.publisher !== 'string' || !m.provenance.publisher.trim() || !isIso(m.provenance.generatedAt)) errors.push('provenance.publisher and provenance.generatedAt are required');
  validateProvider(m.provider, errors);
  if (!Array.isArray(m.models)) errors.push('models must be an array');
  if (errors.length) return { ok: false, errors };

  const providerId: string = m.provider.providerId;
  m.models.forEach((model: any, i: number) => validateModel(providerId, m.provider.protocol, model, i, errors));

  // Identity collisions inside one manifest.
  const ids = new Set<string>();
  for (const model of m.models) {
    for (const id of [model.modelId, ...(model.aliases || [])]) {
      if (ids.has(id)) errors.push(`"${id}" is used more than once as a model id or alias`);
      ids.add(id);
    }
  }
  if (m.signature !== undefined && (m.signature?.algorithm !== 'ed25519' || typeof m.signature?.keyId !== 'string' || typeof m.signature?.value !== 'string')) {
    errors.push('signature must be { algorithm: "ed25519", keyId, value }');
  }
  if (errors.length) return { ok: false, errors };

  const models: ModelManifest[] = m.models.map((model: any) => {
    const caps: CapabilityRecord[] = [];
    const seen = new Set<string>();
    for (const c of model.capabilities) {
      const id = normalizeCapabilityId(providerId, c.id);
      if (id !== c.id) warnings.push(`${model.modelId}: capability "${c.id}" is not a normalized id; retained as "${id}"`);
      if (seen.has(id)) continue;
      seen.add(id);
      caps.push({ id, supported: c.supported, detail: c.detail ?? null, source: c.source, verification: c.verification, effectiveDate: c.effectiveDate ?? null });
    }
    const pricing: PricingRecord[] = model.pricing.map((p: any) => ({
      currency: p.currency, unit: p.unit,
      rates: { input: p.rates.input, output: p.rates.output, cachedInput: p.rates.cachedInput ?? null },
      reasoningTokens: p.reasoningTokens,
      tiers: p.tiers.map((t: any) => ({ thresholdTokens: t.thresholdTokens, rates: { input: t.rates.input, output: t.rates.output, cachedInput: t.rates.cachedInput ?? null } })),
      toolCharges: p.toolCharges, modalityCharges: p.modalityCharges,
      effectiveFrom: p.effectiveFrom, effectiveUntil: p.effectiveUntil ?? null,
      source: p.source, verifiedAt: p.verifiedAt, staleAfter: p.staleAfter, approval: p.approval,
    }));
    return {
      modelId: model.modelId, aliases: [...model.aliases], displayName: model.displayName, lifecycle: model.lifecycle,
      releaseDate: model.releaseDate ?? null, deprecationDate: model.deprecationDate ?? null, shutdownDate: model.shutdownDate ?? null,
      limits: { contextTokens: model.limits.contextTokens ?? null, outputTokens: model.limits.outputTokens ?? null },
      modalities: { input: [...model.modalities.input], output: [...model.modalities.output] },
      capabilities: caps,
      supportedParameters: [...model.supportedParameters],
      outputContracts: [...model.outputContracts],
      pricing,
      adapterCompatibility: { protocol: model.adapterCompatibility.protocol, minAdapterVersion: model.adapterCompatibility.minAdapterVersion },
      restrictions: { regions: [...model.restrictions.regions], compliance: [...model.restrictions.compliance] },
      ...(model.extensions ? { extensions: model.extensions } : {}),
    } satisfies ModelManifest;
  });

  const provider: ProviderManifestBody = {
    providerId, displayName: m.provider.displayName, protocol: m.provider.protocol, adapterVersion: m.provider.adapterVersion,
    approvedHosts: [...m.provider.approvedHosts], defaultBaseUrl: m.provider.defaultBaseUrl.replace(/\/+$/, ''),
    baseUrlEnvVar: m.provider.baseUrlEnvVar ?? null,
    auth: { type: m.provider.auth.type, credentialSlot: m.provider.auth.credentialSlot ?? null, envVars: [...m.provider.auth.envVars] },
    billing: m.provider.billing,
    restrictions: { regions: [...m.provider.restrictions.regions], compliance: [...m.provider.restrictions.compliance] },
  };
  return {
    ok: true,
    warnings,
    manifest: {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      manifestVersion: m.manifestVersion,
      provenance: { publisher: m.provenance.publisher, generatedAt: m.provenance.generatedAt, ...(m.provenance.notes ? { notes: String(m.provenance.notes) } : {}) },
      provider,
      models,
      ...(m.signature ? { signature: { algorithm: 'ed25519' as const, keyId: m.signature.keyId, value: m.signature.value } } : {}),
    },
  };
}

/** Hash of the parts of a model record an operator qualifies (everything, pricing included). */
export function modelRecordHash(providerId: string, model: ModelManifest): string {
  return sha256(canonicalJson({ providerId, model }));
}

/** Hash of the price-bearing part only — used in the price snapshot version key. */
export function pricingHash(p: PricingRecord): string {
  return sha256(canonicalJson(p));
}

/** Compare dotted semver strings. */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return true;
}
