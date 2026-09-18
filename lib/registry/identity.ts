// ---------------------------------------------------------------------------
// MODEL IDENTITY — family → canonical version → provider route → deployment.
//
//   ModelFamily       a publisher's line of models (display grouping only)
//   ModelVersion      an immutable, publisher-issued version id
//                     (`publisher/version`). Execution evidence names this.
//   ProviderRoute     a provider manifest (DIRECT, AGGREGATOR, LOCAL,
//                     ENTERPRISE) offering a model under its OWN native id
//   Deployment        the concrete endpoint/region/account/limits/policy
//                     boundary a route executes through
//
// An aggregator's model id is never a new model. It is a route offering that
// may PROPOSE the canonical version it serves; the proposal is trusted only
// after an audited approval. Only a DIRECT route whose provider IS the
// family's publisher defines versions authoritatively. Any disagreement —
// a publisher redefining a version's family, an aggregator changing an
// approved mapping — fails closed as CONFLICT and needs review.
// ---------------------------------------------------------------------------

import { validateSubstance, readOllamaSubstance, substanceDiff, substanceHash, ensureSubstanceColumns, type LocalSubstance } from './substance';
import { getDatabase } from '../persistence';
import { canonicalJson, sha256 } from './schema';
import type { DeploymentSpec, ModelManifest, ProviderManifestBody, RouteKind, PrivacyClass } from './types';

let ensured = false;
export function ensureIdentityTables(): void {
  const db = getDatabase();
  if (ensured) {
    try { db.prepare('SELECT 1 FROM registry_versions LIMIT 1').get(); return; } catch { ensured = false; }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_families (
      family_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      publisher TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registry_versions (
      canonical_version_id TEXT PRIMARY KEY,
      family_id TEXT,
      publisher TEXT NOT NULL,
      display_name TEXT NOT NULL,
      release_date TEXT,
      lifecycle TEXT NOT NULL,
      defined_by TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registry_route_mappings (
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      canonical_version_id TEXT,
      proposed_version_id TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      approved_by TEXT,
      approved_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS registry_deployments (
      provider_id TEXT NOT NULL,
      deployment_id TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      spec_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider_id, deployment_id)
    );
  `);
  ensureSubstanceColumns();
  ensured = true;
}

/** Mapping states. RESOLVED states may route; the rest may not. */
export type MappingStatus = 'AUTHORITATIVE' | 'APPROVED' | 'IMPLICIT_PUBLISHER' | 'PENDING_REVIEW' | 'CONFLICT' | 'UNMAPPED' | 'REJECTED';
export const RESOLVED_MAPPINGS: MappingStatus[] = ['AUTHORITATIVE', 'APPROVED', 'IMPLICIT_PUBLISHER'];

export function routeKindOf(body: Pick<ProviderManifestBody, 'routeKind'>): RouteKind {
  return body.routeKind ?? 'DIRECT';
}

/** The provider's deployments, or its single default deployment. */
export function deploymentsOf(body: ProviderManifestBody): DeploymentSpec[] {
  if (body.deployments && body.deployments.length) return body.deployments;
  const kind = routeKindOf(body);
  return [{
    deploymentId: 'default', region: null, baseUrlEnvVar: null, credentialSlot: null, envVars: [],
    rateLimits: { requestsPerMinute: null, tokensPerMinute: null, tokensPerDay: null },
    privacyClass: body.privacyClass ?? (kind === 'LOCAL' ? 'LOCAL_ONLY' : 'STANDARD'), dataRetention: null, status: 'ACTIVE',
  }];
}

export function deploymentHash(spec: DeploymentSpec): string {
  return sha256(canonicalJson(spec));
}

/** A deployment's own endpoint/credential view of the provider body. */
export function providerBodyForDeployment(body: ProviderManifestBody, d: DeploymentSpec): ProviderManifestBody {
  return {
    ...body,
    baseUrlEnvVar: d.baseUrlEnvVar ?? body.baseUrlEnvVar,
    auth: { ...body.auth, credentialSlot: d.credentialSlot ?? body.auth.credentialSlot, envVars: d.envVars.length ? d.envVars : body.auth.envVars },
  };
}

type Db = ReturnType<typeof getDatabase>;

/**
 * Apply one manifest's identity claims. Runs inside the import transaction,
 * so identity and route records land together or not at all.
 */
export function applyIdentity(db: Db, body: ProviderManifestBody, models: ModelManifest[], now: string): { conflicts: string[]; pending: string[] } {
  ensureIdentityTables();
  const kind = routeKindOf(body);
  const conflicts: string[] = [];
  const pending: string[] = [];

  for (const d of deploymentsOf(body)) {
    db.prepare(`INSERT INTO registry_deployments (provider_id, deployment_id, spec_json, spec_hash, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, deployment_id) DO UPDATE SET spec_json = excluded.spec_json, spec_hash = excluded.spec_hash, updated_at = excluded.updated_at`)
      .run(body.providerId, d.deploymentId, JSON.stringify(d), deploymentHash(d), now);
  }

  const upsertMapping = (modelId: string, status: MappingStatus, canonical: string | null, proposed: string | null, reason: string | null) => {
    db.prepare(`INSERT INTO registry_route_mappings (provider_id, model_id, canonical_version_id, proposed_version_id, status, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, model_id) DO UPDATE SET canonical_version_id = excluded.canonical_version_id, proposed_version_id = excluded.proposed_version_id,
        status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at`)
      .run(body.providerId, modelId, canonical, proposed, status, reason, now);
  };

  for (const m of models) {
    const existing = db.prepare('SELECT * FROM registry_route_mappings WHERE provider_id = ? AND model_id = ?').get(body.providerId, m.modelId) as any;
    const declared = m.canonicalVersionId ?? null;
    if (!declared) {
      if (existing && (existing.status === 'APPROVED' || existing.status === 'CONFLICT')) continue; // an approval is not undone by a manifest that says nothing
      if (kind === 'DIRECT') {
        // The publisher's own id on the publisher's own route IS the version.
        // Recorded (family unknown) so other routes can be mapped onto it.
        const implicitId = `${body.providerId}/${m.modelId}`;
        db.prepare(`INSERT INTO registry_versions (canonical_version_id, family_id, publisher, display_name, release_date, lifecycle, defined_by, first_seen_at, updated_at)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(canonical_version_id) DO UPDATE SET display_name = excluded.display_name, lifecycle = excluded.lifecycle, updated_at = excluded.updated_at`)
          .run(implicitId, body.providerId, m.displayName, m.releaseDate, m.lifecycle, `route:${body.providerId}:implicit`, now, now);
        upsertMapping(m.modelId, 'IMPLICIT_PUBLISHER', implicitId, null, 'publisher-issued id on the publisher\'s own route');
      }
      else upsertMapping(m.modelId, 'UNMAPPED', null, null, 'this route did not state which canonical version it serves');
      continue;
    }
    const version = db.prepare('SELECT * FROM registry_versions WHERE canonical_version_id = ?').get(declared) as any;
    const publisher = m.family?.publisher ?? declared.split('/')[0];
    const familyId = m.family?.familyId ?? null;
    const authoritative = kind === 'DIRECT' && publisher === body.providerId;
    if (authoritative) {
      if (version && ((familyId && version.family_id && version.family_id !== familyId) || version.publisher !== publisher)) {
        const reason = `the manifest assigns ${declared} to family ${familyId}, but the registry records ${version.family_id}; review required`;
        upsertMapping(m.modelId, 'CONFLICT', null, declared, reason);
        conflicts.push(`${body.providerId}/${m.modelId}: ${reason}`);
        continue;
      }
      if (m.family) db.prepare(`INSERT INTO registry_families (family_id, display_name, publisher, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(family_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
        .run(m.family.familyId, m.family.displayName, m.family.publisher, now, now);
      db.prepare(`INSERT INTO registry_versions (canonical_version_id, family_id, publisher, display_name, release_date, lifecycle, defined_by, first_seen_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_version_id) DO UPDATE SET family_id = COALESCE(excluded.family_id, registry_versions.family_id), display_name = excluded.display_name, release_date = excluded.release_date, lifecycle = excluded.lifecycle, updated_at = excluded.updated_at`)
        .run(declared, familyId, publisher, m.displayName, m.releaseDate, m.lifecycle, `route:${body.providerId}`, now, now);
      upsertMapping(m.modelId, 'AUTHORITATIVE', declared, null, 'publisher route');
      continue;
    }
    // Non-publisher route: a proposal, never a definition.
    if (existing?.status === 'APPROVED') {
      if (existing.canonical_version_id === declared) continue;
      const reason = `route now claims ${declared}, but its approved mapping is ${existing.canonical_version_id}; review required`;
      upsertMapping(m.modelId, 'CONFLICT', null, declared, reason);
      conflicts.push(`${body.providerId}/${m.modelId}: ${reason}`);
      continue;
    }
    upsertMapping(m.modelId, 'PENDING_REVIEW', null, declared, version ? 'awaiting an operator to confirm this route serves that version' : 'the proposed version is not yet defined by its publisher; an operator must confirm it');
    pending.push(`${body.providerId}/${m.modelId} → ${declared}`);
  }
  return { conflicts, pending };
}

export interface RouteIdentity {
  providerId: string;
  modelId: string;
  status: MappingStatus;
  canonicalVersionId: string | null;
  proposedVersionId: string | null;
  familyId: string | null;
  familyDisplayName: string | null;
  publisher: string | null;
  reason: string | null;
  resolved: boolean;
  /** LOCAL routes: hash of the approved substance record (./substance.ts); null otherwise. */
  substanceHash?: string | null;
}

export function routeIdentity(providerId: string, modelId: string): RouteIdentity {
  ensureIdentityTables();
  const db = getDatabase();
  const m = db.prepare('SELECT * FROM registry_route_mappings WHERE provider_id = ? AND model_id = ?').get(providerId, modelId) as any;
  if (!m) return { providerId, modelId, status: 'UNMAPPED', canonicalVersionId: null, proposedVersionId: null, familyId: null, familyDisplayName: null, publisher: null, reason: 'no identity record', resolved: false };
  const v = m.canonical_version_id ? db.prepare('SELECT * FROM registry_versions WHERE canonical_version_id = ?').get(m.canonical_version_id) as any : null;
  const f = v?.family_id ? db.prepare('SELECT * FROM registry_families WHERE family_id = ?').get(v.family_id) as any : null;
  return {
    providerId, modelId, status: m.status, canonicalVersionId: m.canonical_version_id ?? null, proposedVersionId: m.proposed_version_id ?? null,
    familyId: v?.family_id ?? null, familyDisplayName: f?.display_name ?? null, publisher: v?.publisher ?? (m.status === 'IMPLICIT_PUBLISHER' ? providerId : null),
    reason: m.reason ?? null, resolved: RESOLVED_MAPPINGS.includes(m.status),
    substanceHash: m.substance_hash ?? null,
  };
}

/**
 * Operator approval that a route offering serves a canonical version. Audited
 * by the caller. Defines the version when its publisher has not (yet),
 * recording the operator as the definer.
 */
export function approveRouteMapping(p: { providerId: string; modelId: string; canonicalVersionId: string; family?: { familyId: string; displayName: string; publisher: string } | null; actor: string; evidence?: Record<string, string> | null; substance?: LocalSubstance | null }): { ok: true; substanceHash: string | null } | { ok: false; error: string } {
  ensureIdentityTables();
  const db = getDatabase();
  const now = new Date().toISOString();
  if (!/^[a-z][a-z0-9_-]{1,39}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.canonicalVersionId)) return { ok: false, error: 'canonicalVersionId must look like publisher/version' };
  const route = db.prepare('SELECT 1 FROM registry_models WHERE provider_id = ? AND model_id = ?').get(p.providerId, p.modelId);
  if (!route) return { ok: false, error: `${p.providerId}/${p.modelId} is not a registered route offering` };
  const v = db.prepare('SELECT * FROM registry_versions WHERE canonical_version_id = ?').get(p.canonicalVersionId) as any;
  // A LOCAL runtime serves weights on this machine. It may define a new
  // version or map onto one an operator defined — never onto a version a
  // publisher's own route defined, which would claim the local model IS that
  // publisher's hosted model.
  const prov = db.prepare('SELECT manifest_json FROM registry_providers WHERE provider_id = ?').get(p.providerId) as { manifest_json: string } | undefined;
  const kind = prov ? routeKindOf(JSON.parse(prov.manifest_json).provider ?? {}) : 'DIRECT';
  if (v && kind === 'LOCAL' && String(v.defined_by || '').startsWith('route:')) {
    return { ok: false, error: `${p.canonicalVersionId} is defined by the publisher route ${String(v.defined_by).slice(6)}; a local route cannot claim to be it` };
  }
  // A LOCAL route binds to immutable substance (./substance.ts): the record
  // must be supplied, name this route's own tag, and match what is on disk now.
  let substance: LocalSubstance | null = null;
  if (kind === 'LOCAL') {
    if (!p.substance) return { ok: false, error: 'a local route mapping must bind a substance record (manifest, config and weights digests)' };
    const val = validateSubstance(p.substance);
    if (!val.ok) return { ok: false, error: val.error };
    if (val.substance.tag !== p.modelId) return { ok: false, error: `the substance record names ${val.substance.tag}; this route is ${p.modelId}` };
    const now = readOllamaSubstance(val.substance.tag);
    if (!now.ok) return { ok: false, error: `the local model cannot be verified: ${now.reason}` };
    const diff = substanceDiff(val.substance, now.substance);
    if (diff.length) return { ok: false, error: `the supplied substance does not match the local model now: ${diff.join('; ')}` };
    substance = val.substance;
  } else if (p.substance) {
    return { ok: false, error: 'a substance record binds LOCAL routes only' };
  }
  if (!v) {
    if (!p.family) return { ok: false, error: 'the version is not defined yet; supply its family to define it' };
    if (!p.canonicalVersionId.startsWith(`${p.family.publisher}/`)) return { ok: false, error: 'the version id must be namespaced by the family publisher' };
    db.prepare(`INSERT OR IGNORE INTO registry_families (family_id, display_name, publisher, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(p.family.familyId, p.family.displayName, p.family.publisher, now, now);
    db.prepare(`INSERT INTO registry_versions (canonical_version_id, family_id, publisher, display_name, release_date, lifecycle, defined_by, first_seen_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'ACTIVE', ?, ?, ?)`)
      .run(p.canonicalVersionId, p.family.familyId, p.family.publisher, p.canonicalVersionId.split('/')[1], `admin:${p.actor}`, now, now);
  }
  db.prepare(`INSERT INTO registry_route_mappings (provider_id, model_id, canonical_version_id, proposed_version_id, status, reason, approved_by, approved_at, updated_at)
    VALUES (?, ?, ?, NULL, 'APPROVED', 'operator-approved mapping', ?, ?, ?)
    ON CONFLICT(provider_id, model_id) DO UPDATE SET canonical_version_id = excluded.canonical_version_id, proposed_version_id = NULL, status = 'APPROVED',
      reason = excluded.reason, approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = excluded.updated_at`)
    .run(p.providerId, p.modelId, p.canonicalVersionId, p.actor, now, now);
  ensureSubstanceColumns();
  const sHash = substance ? substanceHash(substance) : null;
  db.prepare('UPDATE registry_route_mappings SET substance_json = ?, substance_hash = ? WHERE provider_id = ? AND model_id = ?').run(substance ? JSON.stringify(substance) : null, sHash, p.providerId, p.modelId);
  // The audited record of who mapped what, on what evidence. Append-only: a
  // re-approval is a new event; the previous one (and its substance) stays.
  db.prepare(`INSERT INTO registry_events (event_id, event_type, provider_id, model_id, actor, detail_json, created_at) VALUES (?, 'ROUTE_MAPPING_APPROVED', ?, ?, ?, ?, ?)`)
    .run(`rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, p.providerId, p.modelId, p.actor, JSON.stringify({ canonicalVersionId: p.canonicalVersionId, family: p.family ?? null, evidence: p.evidence ?? null, substance, substanceHash: sHash }), now);
  return { ok: true, substanceHash: sHash };
}

export function listFamiliesAndVersions(): Array<{ familyId: string; displayName: string; publisher: string; versions: Array<{ canonicalVersionId: string; displayName: string; lifecycle: string; releaseDate: string | null; definedBy: string }> }> {
  ensureIdentityTables();
  const db = getDatabase();
  const fams = db.prepare('SELECT * FROM registry_families ORDER BY family_id').all() as any[];
  return fams.map((f) => ({
    familyId: f.family_id, displayName: f.display_name, publisher: f.publisher,
    versions: (db.prepare('SELECT * FROM registry_versions WHERE family_id = ? ORDER BY canonical_version_id').all(f.family_id) as any[])
      .map((v) => ({ canonicalVersionId: v.canonical_version_id, displayName: v.display_name, lifecycle: v.lifecycle, releaseDate: v.release_date ?? null, definedBy: v.defined_by })),
  }));
}

export function storedDeployment(providerId: string, deploymentId: string): (DeploymentSpec & { specHash: string }) | null {
  ensureIdentityTables();
  const r = getDatabase().prepare('SELECT spec_json, spec_hash FROM registry_deployments WHERE provider_id = ? AND deployment_id = ?').get(providerId, deploymentId) as any;
  return r ? { ...JSON.parse(r.spec_json), specHash: r.spec_hash } : null;
}

export function privacyRank(p: PrivacyClass | string | null | undefined): number {
  return ['STANDARD', 'NO_TRAINING', 'ZERO_RETENTION', 'LOCAL_ONLY'].indexOf(String(p ?? 'STANDARD'));
}
