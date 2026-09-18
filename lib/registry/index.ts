// ---------------------------------------------------------------------------
// PROVIDER & MODEL REGISTRY — the one local authority.
//
//   what exists        registry_models (from manifests only)
//   what it can do     manifest capabilities (never inferred from names)
//   what it costs      manifest pricing (./pricing.ts)
//   whether it may run evaluateModel() below
//
// Reading the registry is free: no provider call, no inference, no network.
// Nothing here is placed in a prompt; only the selected provider/model id and
// the adapter's own request parameters reach a provider.
//
// A model appearing in a manifest does NOT make it executable. It becomes
// AVAILABLE only when ALL of these hold, and every one that fails is listed:
//
//   adapter installed and compatible   → else UNSUPPORTED_BY_ADAPTER
//   metadata complete                  → else METADATA_REQUIRED
//   pricing present, single, approved  → else PRICING_REQUIRED
//   pricing not stale                  → else PRICE_STALE
//   explicitly qualified (this record) → else UNQUALIFIED
//   explicitly enabled                 → else QUALIFIED / DISABLED
//   endpoint valid, credential ready   → else NOT_CONFIGURED
//   spend policy permits the provider  → else POLICY_BLOCKED
//   the workspace permits the model    → else POLICY_BLOCKED
//   the task's contract/capabilities   → else POLICY_BLOCKED
// ---------------------------------------------------------------------------

import { ensureRegistry } from './install';
import {
  listStoredProviders, listStoredModels, getStoredModel, getStoredProvider, getAdminRow, writeAdminRow,
  resolveModelIdentity, getWorkspacePolicy, recordRegistryEvent, importManifest, type StoredModel, type StoredProvider,
} from './store';
import { getProtocolAdapter, type ProtocolAdapter } from './protocols';
import { currentPricing, priceVersionKey } from './pricing';
import { resolveProviderEndpoint } from './endpoints';
import { credentialReadiness, resolveProviderCredential } from './credentials';
import { semverGte, validateManifest } from './schema';
import { getSpendPolicy } from '../spend/policy';
import { resolveProviderState } from '../provider-state';
import type {
  AvailabilityState, Blocker, ExecutionContextConstraints, ModelView, AdminState, ModelManifest, ProviderManifestBody, PricingRecord,
} from './types';

export { ensureRegistry } from './install';

function adminStateOf(model: StoredModel): AdminState {
  const a = getAdminRow(model.providerId, model.modelId);
  if (a.disabledReason && !a.enabled) return 'DISABLED';
  if (a.enabled && a.qualifiedHash === model.recordHash) return 'ENABLED';
  if (a.qualifiedHash === model.recordHash) return 'QUALIFIED';
  return 'INSTALLED';
}

function metadataGaps(m: ModelManifest): string[] {
  const gaps: string[] = [];
  if (m.modalities.input.length === 0 || m.modalities.output.length === 0) gaps.push('input/output modalities are not declared');
  if (!m.capabilities.some((c) => c.supported)) gaps.push('no supported capability is declared');
  if (m.outputContracts.length === 0) gaps.push('no supported output contract is declared');
  return gaps;
}

function providerHealth(provider: ProviderManifestBody, configured: boolean, implemented: boolean): 'OK' | 'DEGRADED' | 'UNKNOWN' {
  try {
    const s = resolveProviderState({ provider: provider.providerId, implemented, configured }).state;
    if (s === 'PROVIDER_ERROR' || s === 'QUOTA_BLOCKED' || s === 'BROKEN_UPSTREAM') return 'DEGRADED';
    return s === 'LIVE_VERIFIED' ? 'OK' : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/** Evaluate one stored model in context. Pure read; no network. */
export function viewOf(model: StoredModel, provider: StoredProvider, ctx: ExecutionContextConstraints = {}): ModelView {
  const body = provider.manifest.provider;
  const rec = model.record;
  const blockers: Blocker[] = [];
  const warn: Blocker[] = [];
  const now = Date.now();

  // 1. Existence / lifecycle
  if (model.removedAt || rec.lifecycle === 'REMOVED') blockers.push({ state: 'REMOVED', reason: model.removedAt ? `no longer listed by ${body.providerId} (since ${model.removedAt})` : 'the manifest marks it REMOVED' });
  else if (rec.shutdownDate && Date.parse(rec.shutdownDate) <= now) blockers.push({ state: 'REMOVED', reason: `shut down on ${rec.shutdownDate}` });

  // 2. Adapter
  const adapter = getProtocolAdapter(body.protocol);
  if (!adapter || adapter.dispatch === 'NONE') blockers.push({ state: 'UNSUPPORTED_BY_ADAPTER', reason: `this build has no dispatch adapter for the ${body.protocol} protocol` });
  else if (!semverGte(adapter.adapterVersion, rec.adapterCompatibility.minAdapterVersion)) blockers.push({ state: 'UNSUPPORTED_BY_ADAPTER', reason: `needs adapter ${rec.adapterCompatibility.minAdapterVersion}; this build has ${adapter.adapterVersion}` });

  // 3. Metadata
  const gaps = metadataGaps(rec);
  if (gaps.length) blockers.push({ state: 'METADATA_REQUIRED', reason: gaps.join('; ') });

  // 4-5. Pricing (a FREE_LOCAL provider needs none)
  const pricing = currentPricing(rec);
  const paid = body.billing !== 'FREE_LOCAL';
  if (paid) {
    if (pricing.state === 'MISSING' || pricing.state === 'CONFLICTING' || pricing.state === 'NOT_APPROVED') blockers.push({ state: 'PRICING_REQUIRED', reason: pricing.reason });
    else if (pricing.state === 'STALE') blockers.push({ state: 'PRICE_STALE', reason: pricing.reason });
  }

  // 6-7. Operator decisions
  const admin = getAdminRow(model.providerId, model.modelId);
  const adminState = adminStateOf(model);
  if (admin.qualifiedHash !== model.recordHash) {
    blockers.push({ state: 'UNQUALIFIED', reason: admin.qualifiedHash ? 'the model record changed since it was qualified; it must be re-qualified' : 'not yet qualified by an operator' });
  } else if (adminState === 'DISABLED') {
    blockers.push({ state: 'DISABLED', reason: admin.disabledReason || 'disabled by an operator' });
  } else if (adminState !== 'ENABLED') {
    blockers.push({ state: 'QUALIFIED', reason: 'qualified but not enabled' });
  }

  // 8. Configuration
  const endpoint = resolveProviderEndpoint(body);
  if (!endpoint.ok) blockers.push({ state: 'NOT_CONFIGURED', reason: endpoint.reason });
  const cred = credentialReadiness(body);
  if (!cred.ready && !ctx.credentialHeld) blockers.push({ state: 'NOT_CONFIGURED', reason: `no credential (${[...body.auth.envVars, ...(body.auth.credentialSlot ? [`stored ${body.auth.credentialSlot} credential`] : [])].join(' / ')})` });

  // 9. Spend policy
  if (paid) {
    const policy = getSpendPolicy();
    if (!policy.paidExecutionEnabled) blockers.push({ state: 'POLICY_BLOCKED', reason: 'paid execution is switched off' });
    const limits = (policy.providers as Record<string, { enabled: boolean } | undefined>)[body.providerId];
    if (!limits || !limits.enabled) blockers.push({ state: 'POLICY_BLOCKED', reason: `the spend policy does not enable ${body.providerId}` });
  }

  // 10. Workspace
  if (ctx.workspaceId) {
    const wp = getWorkspacePolicy(ctx.workspaceId);
    const key = `${model.providerId}/${model.modelId}`;
    if (wp.denied.includes(key)) blockers.push({ state: 'POLICY_BLOCKED', reason: `workspace ${ctx.workspaceId} denies ${key}` });
    else if (wp.mode === 'ALLOWLIST' && !wp.allowed.includes(key)) blockers.push({ state: 'POLICY_BLOCKED', reason: `workspace ${ctx.workspaceId} does not allow ${key}` });
  }

  // 11. Task
  if (ctx.outputContract && !rec.outputContracts.includes(ctx.outputContract)) blockers.push({ state: 'POLICY_BLOCKED', reason: `the task needs the ${ctx.outputContract} output contract, which this model does not declare` });
  for (const need of ctx.requiredCapabilities || []) {
    if (!rec.capabilities.some((c) => c.id === need && c.supported)) blockers.push({ state: 'POLICY_BLOCKED', reason: `the task needs capability ${need}` });
  }

  // Warnings: do not block, always shown.
  if (rec.lifecycle === 'DEPRECATED' || (rec.deprecationDate && Date.parse(rec.deprecationDate) <= now)) warn.push({ state: 'DEPRECATED', reason: rec.shutdownDate ? `deprecated; shuts down ${rec.shutdownDate}` : 'deprecated by the provider' });
  if (providerHealth(body, cred.ready, !!adapter && adapter.dispatch !== 'NONE') === 'DEGRADED') warn.push({ state: 'DEGRADED', reason: `the last real ${body.providerId} call failed` });

  const executable = blockers.length === 0;
  const availability: AvailabilityState = executable ? (warn[0]?.state ?? 'AVAILABLE') : blockers[0].state;
  return {
    providerId: model.providerId, providerDisplayName: body.displayName, modelId: model.modelId, displayName: rec.displayName,
    aliases: rec.aliases, lifecycle: rec.lifecycle, releaseDate: rec.releaseDate, deprecationDate: rec.deprecationDate, shutdownDate: rec.shutdownDate,
    limits: rec.limits, modalities: rec.modalities, capabilities: rec.capabilities, outputContracts: rec.outputContracts,
    protocol: body.protocol, source: model.source, manifestVersion: model.manifestVersion, recordHash: model.recordHash,
    adminState, availability, executable, blockers: [...blockers, ...warn],
    pricing: {
      state: pricing.state,
      current: pricing.record,
      versionKey: pricing.record ? priceVersionKey(model.providerId, model.modelId, model.manifestVersion, pricing.record) : null,
    },
    paid,
  };
}

export function listModelViews(ctx: ExecutionContextConstraints = {}): ModelView[] {
  ensureRegistry();
  const providers = new Map(listStoredProviders().map((p) => [p.providerId, p]));
  return listStoredModels().flatMap((m) => {
    const p = providers.get(m.providerId);
    return p ? [viewOf(m, p, ctx)] : [];
  });
}

export function evaluateModel(providerId: string, modelId: string, ctx: ExecutionContextConstraints = {}): ModelView | null {
  ensureRegistry();
  const m = getStoredModel(providerId, modelId);
  const p = getStoredProvider(providerId);
  return m && p ? viewOf(m, p, ctx) : null;
}

export interface ProviderView {
  providerId: string;
  displayName: string;
  protocol: string;
  adapterVersion: string;
  adapterDispatch: ProtocolAdapter['dispatch'] | 'MISSING';
  manifestVersion: string;
  source: string;
  installedAt: string;
  approvedHosts: string[];
  endpoint: { ok: boolean; host: string | null; overridden: boolean; reason: string | null };
  credential: { ready: boolean; source: string };
  billing: string;
  modelCount: number;
  executableCount: number;
  health: 'OK' | 'DEGRADED' | 'UNKNOWN';
}

export function listProviderViews(): ProviderView[] {
  ensureRegistry();
  const views = listModelViews();
  return listStoredProviders().map((p) => {
    const body = p.manifest.provider;
    const adapter = getProtocolAdapter(body.protocol);
    const ep = resolveProviderEndpoint(body);
    const cred = credentialReadiness(body);
    const mine = views.filter((v) => v.providerId === p.providerId);
    return {
      providerId: p.providerId, displayName: body.displayName, protocol: body.protocol, adapterVersion: body.adapterVersion,
      adapterDispatch: adapter ? adapter.dispatch : 'MISSING', manifestVersion: p.manifestVersion, source: p.source, installedAt: p.installedAt,
      approvedHosts: body.approvedHosts,
      endpoint: ep.ok ? { ok: true, host: ep.host, overridden: ep.overridden, reason: null } : { ok: false, host: null, overridden: true, reason: ep.reason },
      credential: cred, billing: body.billing,
      modelCount: mine.length, executableCount: mine.filter((v) => v.executable).length,
      health: providerHealth(body, cred.ready, !!adapter && adapter.dispatch !== 'NONE'),
    };
  });
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type ExecutionTarget =
  | {
      ok: true;
      providerId: string;
      modelId: string;
      requested: string;
      viaAlias: boolean;
      protocol: string;
      adapter: ProtocolAdapter;
      baseUrl: string;
      view: ModelView;
    }
  | { ok: false; code: 'MODEL_NOT_REGISTERED' | 'MODEL_AMBIGUOUS' | 'MODEL_NOT_EXECUTABLE'; state: AvailabilityState | 'NOT_REGISTERED' | 'AMBIGUOUS'; reason: string; requested: string; view?: ModelView };

/**
 * Resolve a requested model to one canonical (provider, model) that may run
 * now in this context. Never substitutes another model: an id that is not
 * registered, ambiguous, or not executable is refused with the reason.
 */
export function resolveExecutionTarget(requested: string, ctx: ExecutionContextConstraints = {}): ExecutionTarget {
  ensureRegistry();
  const id = resolveModelIdentity(requested);
  if (!id.ok) {
    return id.code === 'AMBIGUOUS'
      ? { ok: false, code: 'MODEL_AMBIGUOUS', state: 'AMBIGUOUS', requested, reason: `"${requested}" is registered by more than one provider (${id.candidates.map((c) => `${c.providerId}/${c.modelId}`).join(', ')}); select it as provider/model.` }
      : { ok: false, code: 'MODEL_NOT_REGISTERED', state: 'NOT_REGISTERED', requested, reason: `"${requested}" is not in the model registry. Install it through a provider plugin, a signed manifest import or Admin registration.` };
  }
  const view = evaluateModel(id.providerId, id.modelId, ctx)!;
  if (!view.executable) {
    return { ok: false, code: 'MODEL_NOT_EXECUTABLE', state: view.availability, requested, view, reason: `${id.providerId}/${id.modelId} is ${view.availability}: ${view.blockers.filter((b) => b.state !== 'DEPRECATED' && b.state !== 'DEGRADED').map((b) => b.reason).join('; ')}` };
  }
  const body = getStoredProvider(id.providerId)!.manifest.provider;
  const ep = resolveProviderEndpoint(body);
  const adapter = getProtocolAdapter(body.protocol)!;
  if (!ep.ok) return { ok: false, code: 'MODEL_NOT_EXECUTABLE', state: 'NOT_CONFIGURED', requested, view, reason: ep.reason };
  return { ok: true, providerId: id.providerId, modelId: id.modelId, requested, viaAlias: id.viaAlias, protocol: body.protocol, adapter, baseUrl: ep.baseUrl, view };
}

/** The credential for a resolved target. Only the dispatch path calls this. */
export function credentialForTarget(providerId: string): string {
  const body = getStoredProvider(providerId)?.manifest.provider;
  return body ? resolveProviderCredential(body).apiKey : '';
}

/** Is this provider governed by the registry (i.e. a plugin is installed for it)? */
export function isRegistryGoverned(providerId: string): boolean {
  ensureRegistry();
  return !!getStoredProvider(providerId);
}

/**
 * The spend guard's registry gate. Refuses unless the exact canonical model is
 * executable in this workspace. Aliases are refused here on purpose: identity
 * must be resolved once, before the guard, and propagate unchanged.
 */
export function registryGate(providerId: string, modelId: string, ctx: ExecutionContextConstraints): { ok: true } | { ok: false; code: string; reason: string } {
  ensureRegistry();
  if (!getStoredModel(providerId, modelId)) {
    return { ok: false, code: 'MODEL_NOT_REGISTERED', reason: `${providerId}/${modelId} is not a canonical model in the registry; nothing was sent.` };
  }
  const v = evaluateModel(providerId, modelId, { ...ctx, credentialHeld: true })!;
  if (!v.executable) {
    const real = v.blockers.filter((b) => b.state !== 'DEPRECATED' && b.state !== 'DEGRADED');
    return { ok: false, code: `MODEL_${real[0].state}`, reason: `${providerId}/${modelId} is ${real[0].state}: ${real.map((b) => b.reason).join('; ')}` };
  }
  return { ok: true };
}

/** The price record in force for a registry model, with its version key. */
export function registryPrice(providerId: string, modelId: string, atIso?: string): { record: PricingRecord; versionKey: string; state: string } | null {
  ensureRegistry();
  const m = getStoredModel(providerId, modelId);
  if (!m) return null;
  const p = currentPricing(m.record, atIso);
  if (!p.record) return null;
  return { record: p.record, versionKey: priceVersionKey(providerId, modelId, m.manifestVersion, p.record), state: p.state };
}

// ---------------------------------------------------------------------------
// Operator actions — explicit, audited, never automatic
// ---------------------------------------------------------------------------

export type AdminActionResult = { ok: true; view: ModelView } | { ok: false; error: string; view?: ModelView };

const QUALIFY_BLOCKING: AvailabilityState[] = ['REMOVED', 'UNSUPPORTED_BY_ADAPTER', 'METADATA_REQUIRED', 'PRICING_REQUIRED', 'PRICE_STALE'];

/** Qualify the model's CURRENT record (metadata + pricing). Any later change un-qualifies it. */
export function qualifyModel(providerId: string, modelId: string, actor: string): AdminActionResult {
  const m = getStoredModel(providerId, modelId);
  const view = evaluateModel(providerId, modelId);
  if (!m || !view) return { ok: false, error: `${providerId}/${modelId} is not registered` };
  const hard = view.blockers.filter((b) => QUALIFY_BLOCKING.includes(b.state));
  if (hard.length) return { ok: false, error: `cannot qualify: ${hard.map((b) => `${b.state} (${b.reason})`).join('; ')}`, view };
  writeAdminRow(providerId, modelId, { qualifiedHash: m.recordHash, qualifiedBy: actor, qualifiedAt: new Date().toISOString() });
  recordRegistryEvent('MODEL_QUALIFIED', { providerId, modelId, actor, recordHash: m.recordHash, priceVersion: view.pricing.versionKey });
  return { ok: true, view: evaluateModel(providerId, modelId)! };
}

export function enableModel(providerId: string, modelId: string, actor: string): AdminActionResult {
  const m = getStoredModel(providerId, modelId);
  if (!m) return { ok: false, error: `${providerId}/${modelId} is not registered` };
  const a = getAdminRow(providerId, modelId);
  if (a.qualifiedHash !== m.recordHash) return { ok: false, error: 'only a model qualified on its current record can be enabled', view: evaluateModel(providerId, modelId)! };
  writeAdminRow(providerId, modelId, { enabled: true, enabledBy: actor, enabledAt: new Date().toISOString(), disabledReason: null });
  recordRegistryEvent('MODEL_ENABLED', { providerId, modelId, actor });
  return { ok: true, view: evaluateModel(providerId, modelId)! };
}

export function disableModel(providerId: string, modelId: string, actor: string, reason: string): AdminActionResult {
  if (!getStoredModel(providerId, modelId)) return { ok: false, error: `${providerId}/${modelId} is not registered` };
  writeAdminRow(providerId, modelId, { enabled: false, disabledReason: reason || 'disabled by an operator' });
  recordRegistryEvent('MODEL_DISABLED', { providerId, modelId, actor, reason });
  return { ok: true, view: evaluateModel(providerId, modelId)! };
}

/**
 * Admin registration: add or replace ONE model under an installed provider,
 * through the same validated schema and import path as everything else.
 */
export function registerModelViaAdmin(providerId: string, model: unknown, actor: string) {
  ensureRegistry();
  const p = getStoredProvider(providerId);
  if (!p) return { ok: false as const, errors: [`provider ${providerId} is not installed`] };
  const current = listStoredModels(providerId).filter((m) => !m.removedAt).map((m) => stripStamps(m.record));
  const incoming = model as { modelId?: string };
  const models = [...current.filter((m) => m.modelId !== incoming?.modelId), model];
  const manifest = {
    ...p.manifest,
    manifestVersion: `${p.manifest.manifestVersion.split('+admin.')[0].slice(0, 40)}+admin.${Date.now()}`,
    provenance: { publisher: `admin:${actor}`, generatedAt: new Date().toISOString(), notes: `Admin registration of ${incoming?.modelId ?? 'a model'}` },
    signature: undefined,
    models,
  };
  const v = validateManifest(manifest);
  if (!v.ok) return { ok: false as const, errors: v.errors };
  return importManifest(manifest, { source: 'ADMIN', actor });
}

function stripStamps(m: ModelManifest): ModelManifest {
  return { ...m, capabilities: m.capabilities.map(({ provenance: _p, manifestVersion: _m, adapterVersion: _a, lastUpdated: _l, ...c }) => c) };
}

// ---------------------------------------------------------------------------
// Routing — identity, protocol and endpoint only.
//
// The dispatch path resolves WHERE a request would go here. WHETHER it may go
// is decided once, by the spend guard's registryGate(), which records a ledger
// row for every refusal. Routing refuses only what could never be dispatched:
// an unknown or ambiguous id, a protocol this build cannot speak, or an
// endpoint that failed validation (before any credential is transmitted).
// ---------------------------------------------------------------------------

export type Route =
  | { ok: true; providerId: string; modelId: string; requested: string; viaAlias: boolean; protocol: string; adapter: ProtocolAdapter; baseUrl: string }
  | { ok: false; code: 'MODEL_NOT_REGISTERED' | 'MODEL_AMBIGUOUS' | 'UNSUPPORTED_BY_ADAPTER' | 'ENDPOINT_NOT_APPROVED'; requested: string; reason: string };

export function resolveRoute(requested: string): Route {
  ensureRegistry();
  const id = resolveModelIdentity(requested);
  if (!id.ok) {
    return id.code === 'AMBIGUOUS'
      ? { ok: false, code: 'MODEL_AMBIGUOUS', requested, reason: `"${requested}" is registered by more than one provider (${id.candidates.map((c) => `${c.providerId}/${c.modelId}`).join(', ')}); select it as provider/model.` }
      : { ok: false, code: 'MODEL_NOT_REGISTERED', requested, reason: `Model "${requested}" is not in the model registry, so it was not routed to any provider. Install it through a provider plugin, a signed manifest import or Admin registration.` };
  }
  const body = getStoredProvider(id.providerId)!.manifest.provider;
  const adapter = getProtocolAdapter(body.protocol);
  if (!adapter || adapter.dispatch !== 'MODEL_CALL' || !adapter.call) {
    return { ok: false, code: 'UNSUPPORTED_BY_ADAPTER', requested, reason: `${id.providerId}/${id.modelId} uses the ${body.protocol} protocol, which this build cannot dispatch as a model call. It was not routed to any provider.` };
  }
  const ep = resolveProviderEndpoint(body);
  if (!ep.ok) return { ok: false, code: 'ENDPOINT_NOT_APPROVED', requested, reason: ep.reason };
  return { ok: true, providerId: id.providerId, modelId: id.modelId, requested, viaAlias: id.viaAlias, protocol: body.protocol, adapter, baseUrl: ep.baseUrl };
}

/** Env vars / slot that would satisfy this provider's credential — for messages only. */
export function credentialHint(providerId: string): string {
  const body = getStoredProvider(providerId)?.manifest.provider;
  if (!body) return 'a credential';
  return [...body.auth.envVars, ...(body.auth.credentialSlot ? [`the stored ${body.auth.credentialSlot} credential`] : [])].join(' or ');
}

export function primaryCredentialEnvVar(providerId: string): string | null {
  return getStoredProvider(providerId)?.manifest.provider.auth.envVars[0] ?? null;
}
