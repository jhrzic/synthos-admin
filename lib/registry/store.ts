// ---------------------------------------------------------------------------
// REGISTRY STORE — the persisted local registry.
//
// Reads never touch the network. Writes happen only through importManifest()
// (plugin install, signed import, Admin registration — all validated by
// ./schema.ts) and through explicit operator actions (qualify / enable /
// disable / workspace policy). Nothing here is ever deleted: a model dropped
// from a newer manifest is marked removed, every version of every model record
// is kept in registry_model_versions, and historical tasks, ledger rows and
// receipts carry their own copies of provider, model and price, so a later
// manifest change cannot rewrite history.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from '../persistence';
import {
  validateManifest, verifyManifestSignature, canonicalJson, sha256, modelRecordHash,
} from './schema';
import { isTestEnvironment } from './endpoints';
import { applyIdentity, ensureIdentityTables } from './identity';
import type { RegistryManifest, ModelManifest, ManifestSource, ProviderManifestBody } from './types';

let ensured = false;
export function ensureRegistryTables(): void {
  const db = getDatabase();
  if (ensured) {
    try { db.prepare('SELECT 1 FROM registry_providers LIMIT 1').get(); return; } catch { ensured = false; }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_providers (
      provider_id TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      manifest_version TEXT NOT NULL,
      protocol TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      source TEXT NOT NULL,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registry_models (
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      manifest_version TEXT NOT NULL,
      source TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      removed_at TEXT,
      PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS registry_model_versions (
      version_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      manifest_version TEXT NOT NULL,
      import_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_registry_versions_model ON registry_model_versions(provider_id, model_id, created_at);
    CREATE TABLE IF NOT EXISTS registry_aliases (
      provider_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      model_id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider_id, alias)
    );
    CREATE TABLE IF NOT EXISTS registry_admin_state (
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      qualified_hash TEXT,
      qualified_by TEXT,
      qualified_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      enabled_by TEXT,
      enabled_at TEXT,
      disabled_reason TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS registry_imports (
      import_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      provider_id TEXT,
      manifest_hash TEXT,
      manifest_version TEXT,
      signature_status TEXT NOT NULL,
      actor TEXT,
      outcome TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registry_trusted_keys (
      key_id TEXT PRIMARY KEY,
      public_key_pem TEXT NOT NULL,
      label TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registry_workspace_policy (
      workspace_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      allowed_json TEXT NOT NULL,
      denied_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registry_discovery_candidates (
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      discovered_at TEXT NOT NULL,
      PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS registry_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      actor TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  ensured = true;
}

const newId = (p: string) => `${p}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

export function recordRegistryEvent(eventType: string, detail: { providerId?: string | null; modelId?: string | null; actor?: string | null; [k: string]: unknown }): void {
  ensureRegistryTables();
  const { providerId = null, modelId = null, actor = null, ...rest } = detail;
  getDatabase().prepare('INSERT INTO registry_events (event_id, event_type, provider_id, model_id, actor, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('rev'), eventType, providerId, modelId, actor, JSON.stringify(rest), new Date().toISOString());
}

/** Synthetic fixtures are for tests. They are refused outside a test process. */
export function isSyntheticManifest(m: Pick<RegistryManifest, 'provenance' | 'provider'>): boolean {
  return m.provenance.publisher === 'synthos-test-fixtures' || m.provider.providerId.startsWith('synthetic');
}

export interface ImportOutcome {
  ok: boolean;
  importId: string;
  providerId: string | null;
  errors: string[];
  warnings: string[];
  added: string[];
  changed: string[];
  unchanged: string[];
  removed: string[];
  signatureStatus: 'VERIFIED' | 'NOT_REQUIRED' | 'MISSING' | 'UNTRUSTED_KEY' | 'INVALID';
  /** Identity claims that disagreed with the registry — failed closed, review required. */
  identityConflicts?: string[];
  /** Route→version proposals awaiting an operator's approval. */
  identityPending?: string[];
}

function logImport(o: ImportOutcome, source: ManifestSource, actor: string | null, manifestHash: string | null, manifestVersion: string | null): void {
  ensureRegistryTables();
  getDatabase().prepare(`INSERT INTO registry_imports (import_id, source, provider_id, manifest_hash, manifest_version, signature_status, actor, outcome, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.importId, source, o.providerId, manifestHash, manifestVersion, o.signatureStatus, actor, o.ok ? 'APPLIED' : 'REFUSED',
      JSON.stringify({ errors: o.errors, warnings: o.warnings, added: o.added, changed: o.changed, removed: o.removed }), new Date().toISOString());
}

/**
 * The one write path for manifests.
 *
 *   PLUGIN         a bundled provider plugin (reviewed in this repository)
 *   SIGNED_IMPORT  a JSON manifest; REQUIRES a valid Ed25519 signature from a
 *                  key an operator added to registry_trusted_keys
 *   ADMIN          an operator's registration, same schema, actor recorded
 *
 * Importing never qualifies, enables or prices-in anything: a new model lands
 * UNQUALIFIED and cannot execute until an operator says otherwise.
 */
export function importManifest(raw: unknown, opts: { source: Exclude<ManifestSource, 'DISCOVERY'>; actor?: string | null }): ImportOutcome {
  ensureIdentityTables();
  ensureRegistryTables();
  const importId = newId('rim');
  const base: ImportOutcome = { ok: false, importId, providerId: null, errors: [], warnings: [], added: [], changed: [], unchanged: [], removed: [], signatureStatus: 'NOT_REQUIRED' };
  const v = validateManifest(raw);
  if (!v.ok) {
    const o = { ...base, errors: v.errors };
    logImport(o, opts.source, opts.actor ?? null, null, null);
    return o;
  }
  const m = v.manifest;
  const manifestHash = sha256(canonicalJson(m));
  base.providerId = m.provider.providerId;
  base.warnings = v.warnings;

  if (isSyntheticManifest(m) && !isTestEnvironment()) {
    const o = { ...base, errors: ['Synthetic test manifests cannot be imported into a non-test registry.'] };
    logImport(o, opts.source, opts.actor ?? null, manifestHash, m.manifestVersion);
    return o;
  }

  if (opts.source === 'SIGNED_IMPORT') {
    if (!m.signature) {
      const o = { ...base, signatureStatus: 'MISSING' as const, errors: ['A JSON manifest import must be signed (Ed25519) by a trusted key.'] };
      logImport(o, opts.source, opts.actor ?? null, manifestHash, m.manifestVersion);
      return o;
    }
    const key = getDatabase().prepare('SELECT public_key_pem FROM registry_trusted_keys WHERE key_id = ?').get(m.signature.keyId) as { public_key_pem: string } | undefined;
    if (!key) {
      const o = { ...base, signatureStatus: 'UNTRUSTED_KEY' as const, errors: [`Signing key "${m.signature.keyId}" is not trusted by this registry.`] };
      logImport(o, opts.source, opts.actor ?? null, manifestHash, m.manifestVersion);
      return o;
    }
    // Verified over exactly what the publisher signed — the manifest as
    // received, not the normalized form (normalization may namespace
    // capabilities or fill defaults, which would change the signed bytes).
    if (!verifyManifestSignature(raw as RegistryManifest, key.public_key_pem)) {
      const o = { ...base, signatureStatus: 'INVALID' as const, errors: ['The manifest signature does not verify; the manifest was altered or signed by a different key.'] };
      logImport(o, opts.source, opts.actor ?? null, manifestHash, m.manifestVersion);
      return o;
    }
    base.signatureStatus = 'VERIFIED';
  }
  if (opts.source === 'ADMIN' && !opts.actor) {
    const o = { ...base, errors: ['An Admin registration must record the operator.'] };
    logImport(o, opts.source, null, manifestHash, m.manifestVersion);
    return o;
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  const providerId = m.provider.providerId;
  // Aliases may not collide with another provider's... no: they are provider-scoped. But
  // they may not shadow a canonical id of this provider's other models (checked in schema).
  db.exec('BEGIN IMMEDIATE');
  try {
    const existingProvider = db.prepare('SELECT provider_id FROM registry_providers WHERE provider_id = ?').get(providerId);
    const providerJson = JSON.stringify({ ...m, models: undefined });
    if (existingProvider) {
      db.prepare(`UPDATE registry_providers SET manifest_json = ?, manifest_hash = ?, manifest_version = ?, protocol = ?, adapter_version = ?, source = ?, updated_at = ? WHERE provider_id = ?`)
        .run(providerJson, manifestHash, m.manifestVersion, m.provider.protocol, m.provider.adapterVersion, opts.source, now, providerId);
    } else {
      db.prepare(`INSERT INTO registry_providers (provider_id, manifest_json, manifest_hash, manifest_version, protocol, adapter_version, source, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(providerId, providerJson, manifestHash, m.manifestVersion, m.provider.protocol, m.provider.adapterVersion, opts.source, now, now);
    }

    const current = db.prepare('SELECT model_id, record_hash, removed_at, source FROM registry_models WHERE provider_id = ?').all(providerId) as Array<{ model_id: string; record_hash: string; removed_at: string | null; source: string }>;
    const byId = new Map(current.map((r) => [r.model_id, r]));
    const version = db.prepare(`INSERT INTO registry_model_versions (version_id, provider_id, model_id, record_json, record_hash, manifest_version, import_id, change_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const stamped = (model: ModelManifest): ModelManifest => ({
      ...model,
      capabilities: model.capabilities.map((c) => ({ ...c, provenance: opts.source, manifestVersion: m.manifestVersion, adapterVersion: m.provider.adapterVersion, lastUpdated: now })),
    });

    for (const model of m.models) {
      const recordHash = modelRecordHash(providerId, model);
      const json = JSON.stringify(stamped(model));
      const prev = byId.get(model.modelId);
      if (!prev) {
        db.prepare(`INSERT INTO registry_models (provider_id, model_id, record_json, record_hash, manifest_version, source, first_seen_at, updated_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
          .run(providerId, model.modelId, json, recordHash, m.manifestVersion, opts.source, now, now);
        version.run(newId('rmv'), providerId, model.modelId, json, recordHash, m.manifestVersion, importId, 'ADDED', now);
        base.added.push(model.modelId);
      } else if (prev.record_hash !== recordHash || prev.removed_at) {
        db.prepare(`UPDATE registry_models SET record_json = ?, record_hash = ?, manifest_version = ?, source = ?, updated_at = ?, removed_at = NULL WHERE provider_id = ? AND model_id = ?`)
          .run(json, recordHash, m.manifestVersion, opts.source, now, providerId, model.modelId);
        version.run(newId('rmv'), providerId, model.modelId, json, recordHash, m.manifestVersion, importId, prev.removed_at ? 'RESTORED' : 'CHANGED', now);
        base.changed.push(model.modelId);
      } else {
        base.unchanged.push(model.modelId);
      }
    }
    // Models this source no longer lists are marked removed — never deleted.
    // A source only removes what it added: a plugin update cannot silently
    // retire a model an operator registered or a signed import brought in.
    const listed = new Set(m.models.map((x) => x.modelId));
    for (const r of current) {
      if (listed.has(r.model_id) || r.removed_at || r.source !== opts.source) continue;
      db.prepare('UPDATE registry_models SET removed_at = ?, updated_at = ? WHERE provider_id = ? AND model_id = ?').run(now, now, providerId, r.model_id);
      const row = db.prepare('SELECT record_json, record_hash FROM registry_models WHERE provider_id = ? AND model_id = ?').get(providerId, r.model_id) as any;
      version.run(newId('rmv'), providerId, r.model_id, row.record_json, row.record_hash, m.manifestVersion, importId, 'REMOVED', now);
      base.removed.push(r.model_id);
    }
    // Aliases: the current mapping is replaced; history lives in the versions table.
    // Aliases of the models this manifest lists are replaced; others keep theirs.
    const delAlias = db.prepare('DELETE FROM registry_aliases WHERE provider_id = ? AND model_id = ?');
    for (const model of m.models) delAlias.run(providerId, model.modelId);
    for (const id of base.removed) delAlias.run(providerId, id);
    const ins = db.prepare('INSERT INTO registry_aliases (provider_id, alias, model_id, import_id, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const model of m.models) for (const alias of model.aliases) ins.run(providerId, alias, model.modelId, importId, now);
    // Identity (family / canonical version / route mapping / deployments), in
    // the same transaction: route and identity land together or not at all.
    const identity = applyIdentity(db, m.provider, m.models, now);
    base.identityConflicts = identity.conflicts;
    base.identityPending = identity.pending;
    db.exec('COMMIT');
  } catch (err: any) {
    try { db.exec('ROLLBACK'); } catch { /* nothing to roll back */ }
    const o = { ...base, errors: [`Import failed and was rolled back: ${err?.message || err}`] };
    logImport(o, opts.source, opts.actor ?? null, manifestHash, m.manifestVersion);
    return o;
  }
  const o = { ...base, ok: true };
  logImport(o, opts.source, opts.actor ?? null, manifestHash, m.manifestVersion);
  recordRegistryEvent('MANIFEST_IMPORTED', { providerId, actor: opts.actor ?? null, source: opts.source, importId, added: o.added, changed: o.changed, removed: o.removed });
  return o;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface StoredProvider { providerId: string; manifest: Omit<RegistryManifest, 'models'>; manifestHash: string; manifestVersion: string; source: ManifestSource; installedAt: string; updatedAt: string }
export interface StoredModel { providerId: string; modelId: string; record: ModelManifest; recordHash: string; manifestVersion: string; source: ManifestSource; firstSeenAt: string; updatedAt: string; removedAt: string | null }

export function listStoredProviders(): StoredProvider[] {
  ensureRegistryTables();
  return (getDatabase().prepare('SELECT * FROM registry_providers ORDER BY provider_id').all() as any[]).map((r) => ({
    providerId: r.provider_id, manifest: JSON.parse(r.manifest_json), manifestHash: r.manifest_hash, manifestVersion: r.manifest_version,
    source: r.source, installedAt: r.installed_at, updatedAt: r.updated_at,
  }));
}

export function getStoredProvider(providerId: string): StoredProvider | null {
  return listStoredProviders().find((p) => p.providerId === providerId) ?? null;
}

export function getProviderBody(providerId: string): ProviderManifestBody | null {
  return getStoredProvider(providerId)?.manifest.provider ?? null;
}

function toStoredModel(r: any): StoredModel {
  return {
    providerId: r.provider_id, modelId: r.model_id, record: JSON.parse(r.record_json), recordHash: r.record_hash,
    manifestVersion: r.manifest_version, source: r.source, firstSeenAt: r.first_seen_at, updatedAt: r.updated_at, removedAt: r.removed_at ?? null,
  };
}

export function listStoredModels(providerId?: string): StoredModel[] {
  ensureRegistryTables();
  const rows = providerId
    ? getDatabase().prepare('SELECT * FROM registry_models WHERE provider_id = ? ORDER BY model_id').all(providerId)
    : getDatabase().prepare('SELECT * FROM registry_models ORDER BY provider_id, model_id').all();
  return (rows as any[]).map(toStoredModel);
}

export function getStoredModel(providerId: string, modelId: string): StoredModel | null {
  ensureRegistryTables();
  const r = getDatabase().prepare('SELECT * FROM registry_models WHERE provider_id = ? AND model_id = ?').get(providerId, modelId);
  return r ? toStoredModel(r) : null;
}

export function modelHistory(providerId: string, modelId: string): Array<{ versionId: string; changeType: string; recordHash: string; manifestVersion: string; importId: string; createdAt: string }> {
  ensureRegistryTables();
  return (getDatabase().prepare('SELECT * FROM registry_model_versions WHERE provider_id = ? AND model_id = ? ORDER BY created_at, rowid').all(providerId, modelId) as any[])
    .map((r) => ({ versionId: r.version_id, changeType: r.change_type, recordHash: r.record_hash, manifestVersion: r.manifest_version, importId: r.import_id, createdAt: r.created_at }));
}

/**
 * Resolve a requested id to a canonical (provider, model). Accepts
 * `provider/model`, a canonical id, or an alias. A bare id that more than one
 * provider claims is AMBIGUOUS and never guessed.
 */
export type IdentityResolution =
  | { ok: true; providerId: string; modelId: string; requested: string; viaAlias: boolean }
  | { ok: false; code: 'NOT_REGISTERED' | 'AMBIGUOUS'; requested: string; candidates: Array<{ providerId: string; modelId: string }> };

export function resolveModelIdentity(requested: string): IdentityResolution {
  ensureRegistryTables();
  const db = getDatabase();
  const req = String(requested || '').trim();
  const slash = req.indexOf('/');
  if (slash > 0) {
    const providerId = req.slice(0, slash);
    const id = req.slice(slash + 1);
    if (getStoredProvider(providerId)) {
      if (getStoredModel(providerId, id)) return { ok: true, providerId, modelId: id, requested: req, viaAlias: false };
      const a = db.prepare('SELECT model_id FROM registry_aliases WHERE provider_id = ? AND alias = ?').get(providerId, id) as any;
      if (a) return { ok: true, providerId, modelId: a.model_id, requested: req, viaAlias: true };
      return { ok: false, code: 'NOT_REGISTERED', requested: req, candidates: [] };
    }
  }
  const stripped = req.replace(/^models\//, '');
  const direct = db.prepare('SELECT provider_id, model_id FROM registry_models WHERE model_id = ?').all(stripped) as any[];
  const aliased = db.prepare('SELECT provider_id, model_id FROM registry_aliases WHERE alias = ?').all(stripped) as any[];
  const seen = new Map<string, { providerId: string; modelId: string; viaAlias: boolean }>();
  for (const r of direct) seen.set(`${r.provider_id}/${r.model_id}`, { providerId: r.provider_id, modelId: r.model_id, viaAlias: false });
  for (const r of aliased) if (!seen.has(`${r.provider_id}/${r.model_id}`)) seen.set(`${r.provider_id}/${r.model_id}`, { providerId: r.provider_id, modelId: r.model_id, viaAlias: true });
  const all = [...seen.values()];
  if (all.length === 1) return { ok: true, providerId: all[0].providerId, modelId: all[0].modelId, requested: req, viaAlias: all[0].viaAlias };
  if (all.length === 0) return { ok: false, code: 'NOT_REGISTERED', requested: req, candidates: [] };
  return { ok: false, code: 'AMBIGUOUS', requested: req, candidates: all.map(({ providerId, modelId }) => ({ providerId, modelId })) };
}

// ---------------------------------------------------------------------------
// Operator state
// ---------------------------------------------------------------------------

export interface AdminRow { qualifiedHash: string | null; qualifiedBy: string | null; qualifiedAt: string | null; enabled: boolean; enabledBy: string | null; enabledAt: string | null; disabledReason: string | null }

export function getAdminRow(providerId: string, modelId: string): AdminRow {
  ensureRegistryTables();
  const r = getDatabase().prepare('SELECT * FROM registry_admin_state WHERE provider_id = ? AND model_id = ?').get(providerId, modelId) as any;
  if (!r) return { qualifiedHash: null, qualifiedBy: null, qualifiedAt: null, enabled: false, enabledBy: null, enabledAt: null, disabledReason: null };
  return { qualifiedHash: r.qualified_hash, qualifiedBy: r.qualified_by, qualifiedAt: r.qualified_at, enabled: !!r.enabled, enabledBy: r.enabled_by, enabledAt: r.enabled_at, disabledReason: r.disabled_reason };
}

export function writeAdminRow(providerId: string, modelId: string, patch: Partial<AdminRow>): void {
  ensureRegistryTables();
  const cur = getAdminRow(providerId, modelId);
  const next = { ...cur, ...patch };
  getDatabase().prepare(`INSERT INTO registry_admin_state (provider_id, model_id, qualified_hash, qualified_by, qualified_at, enabled, enabled_by, enabled_at, disabled_reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, model_id) DO UPDATE SET qualified_hash = excluded.qualified_hash, qualified_by = excluded.qualified_by, qualified_at = excluded.qualified_at,
      enabled = excluded.enabled, enabled_by = excluded.enabled_by, enabled_at = excluded.enabled_at, disabled_reason = excluded.disabled_reason, updated_at = excluded.updated_at`)
    .run(providerId, modelId, next.qualifiedHash, next.qualifiedBy, next.qualifiedAt, next.enabled ? 1 : 0, next.enabledBy, next.enabledAt, next.disabledReason, new Date().toISOString());
}

export function addTrustedKey(keyId: string, publicKeyPem: string, label: string, actor: string): void {
  ensureRegistryTables();
  crypto.createPublicKey(publicKeyPem); // throws on a malformed key
  getDatabase().prepare('INSERT OR REPLACE INTO registry_trusted_keys (key_id, public_key_pem, label, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
    .run(keyId, publicKeyPem, label, actor, new Date().toISOString());
  recordRegistryEvent('TRUSTED_KEY_ADDED', { actor, keyId, label });
}

export function listTrustedKeys(): Array<{ keyId: string; label: string; addedBy: string; addedAt: string }> {
  ensureRegistryTables();
  return (getDatabase().prepare('SELECT key_id, label, added_by, added_at FROM registry_trusted_keys ORDER BY key_id').all() as any[])
    .map((r) => ({ keyId: r.key_id, label: r.label, addedBy: r.added_by, addedAt: r.added_at }));
}

export function listImports(limit = 50): any[] {
  ensureRegistryTables();
  return (getDatabase().prepare('SELECT * FROM registry_imports ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as any[])
    .map((r) => ({ ...r, detail: r.detail_json ? JSON.parse(r.detail_json) : null, detail_json: undefined }));
}

// ---------------------------------------------------------------------------
// Workspace policy
// ---------------------------------------------------------------------------

export interface WorkspaceModelPolicy { workspaceId: string; mode: 'INHERIT' | 'ALLOWLIST'; allowed: string[]; denied: string[]; updatedBy: string | null; updatedAt: string | null }

export function getWorkspacePolicy(workspaceId: string): WorkspaceModelPolicy {
  ensureRegistryTables();
  const r = getDatabase().prepare('SELECT * FROM registry_workspace_policy WHERE workspace_id = ?').get(workspaceId) as any;
  if (!r) return { workspaceId, mode: 'INHERIT', allowed: [], denied: [], updatedBy: null, updatedAt: null };
  return { workspaceId, mode: r.mode, allowed: JSON.parse(r.allowed_json), denied: JSON.parse(r.denied_json), updatedBy: r.updated_by, updatedAt: r.updated_at };
}

export function setWorkspacePolicy(p: { workspaceId: string; mode: 'INHERIT' | 'ALLOWLIST'; allowed: string[]; denied: string[] }, actor: string): WorkspaceModelPolicy {
  ensureRegistryTables();
  const clean = (xs: string[]) => [...new Set((xs || []).map((x) => String(x).trim()).filter((x) => /^[a-z][a-z0-9_-]*\/[A-Za-z0-9._:\/-]+$/.test(x)))];
  const now = new Date().toISOString();
  getDatabase().prepare(`INSERT INTO registry_workspace_policy (workspace_id, mode, allowed_json, denied_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET mode = excluded.mode, allowed_json = excluded.allowed_json, denied_json = excluded.denied_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(p.workspaceId, p.mode === 'ALLOWLIST' ? 'ALLOWLIST' : 'INHERIT', JSON.stringify(clean(p.allowed)), JSON.stringify(clean(p.denied)), actor, now);
  recordRegistryEvent('WORKSPACE_POLICY_SET', { actor, workspaceId: p.workspaceId, mode: p.mode });
  return getWorkspacePolicy(p.workspaceId);
}
