// ---------------------------------------------------------------------------
// LOCAL MODEL SUBSTANCE — a local route is bound to immutable content, not to
// a mutable tag.
//
// An Ollama tag ("qwen2.5-coder:14b") is a mutable label: `ollama pull` can
// put different weights behind the same name. A qualification earned by one
// set of weights must never carry over to another. So every LOCAL route's
// approved mapping stores a SUBSTANCE RECORD, and every routing decision and
// every dispatch re-verifies it — without inference.
//
// TRUST BOUNDARY (what is verified on every call, and what is not):
//   1. manifest   — the tag's manifest FILE is re-hashed (SHA-256) and must
//                   equal the approved manifest digest. The manifest lists the
//                   config and weights digests, so this alone binds them.
//   2. config     — the manifest must name the approved config digest; the
//                   config BLOB (a few hundred bytes) is re-hashed and must
//                   equal its own content address; its format / family /
//                   parameter size / quantization must equal the approved ones.
//   3. weights    — the manifest must name the approved weights digest, and
//                   the blob stored under that content address must exist
//                   with the declared size. The multi-GB weights file is NOT
//                   re-hashed per call: Ollama stores blobs content-addressed
//                   (the file name IS its SHA-256, checked by Ollama at pull).
//                   A full re-hash is a separate offline audit
//                   (auditLocalWeights), run deliberately.
//   4. runtime    — before a local request is sent, the running Ollama is
//                   asked (GET /api/tags, metadata only) which manifest digest
//                   it resolves the tag to; it must be the approved one. This
//                   closes "Ollama is serving from another models directory".
//
// Any mismatch: MODEL_SUBSTANCE_CHANGED — refused before dispatch, zero
// inference, an append-only registry event naming each changed field, and
// every qualification of the route persisted INVALIDATED with that reason. A
// reverted file does not revive them: re-qualification is a new record.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase } from '../persistence';
import { canonicalJson } from './schema';

export interface LocalSubstance {
  runtime: 'ollama';
  /** The tag the route serves — the route's own model id. */
  tag: string;
  /** sha256:<hex> of the manifest file bytes. */
  manifestDigest: string;
  configDigest: string;
  weightsDigest: string;
  weightsBytes: number;
  format: string | null;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export const SUBSTANCE_FIELDS: Array<keyof LocalSubstance> = ['runtime', 'tag', 'manifestDigest', 'configDigest', 'weightsDigest', 'weightsBytes', 'format', 'family', 'parameterSize', 'quantization'];

const sha256Hex = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function substanceHash(s: LocalSubstance): string {
  return sha256Hex(canonicalJson(Object.fromEntries(SUBSTANCE_FIELDS.map((k) => [k, s[k] ?? null]))));
}

export function validateSubstance(s: unknown): { ok: true; substance: LocalSubstance } | { ok: false; error: string } {
  const v = s as LocalSubstance;
  if (!v || v.runtime !== 'ollama') return { ok: false, error: 'substance.runtime must be "ollama"' };
  if (typeof v.tag !== 'string' || !v.tag) return { ok: false, error: 'substance.tag is required' };
  for (const k of ['manifestDigest', 'configDigest', 'weightsDigest'] as const) if (!DIGEST_RE.test(String(v[k]))) return { ok: false, error: `substance.${k} must be sha256:<64 hex>` };
  if (!Number.isInteger(v.weightsBytes) || v.weightsBytes <= 0) return { ok: false, error: 'substance.weightsBytes must be a positive integer' };
  return { ok: true, substance: Object.fromEntries(SUBSTANCE_FIELDS.map((k) => [k, (v as any)[k] ?? null])) as unknown as LocalSubstance };
}

export function ollamaModelsDir(): string {
  return process.env.SYNTHOS_OLLAMA_MODELS_DIR || path.join(os.homedir(), '.ollama', 'models');
}

/** "qwen2.5-coder:14b" → manifests/registry.ollama.ai/library/qwen2.5-coder/14b */
export function ollamaManifestPath(tag: string, dir = ollamaModelsDir()): string | null {
  const i = tag.lastIndexOf(':');
  const name = i > 0 && !tag.slice(i + 1).includes('/') ? tag.slice(0, i) : tag;
  const version = i > 0 && !tag.slice(i + 1).includes('/') ? tag.slice(i + 1) : 'latest';
  const parts = name.split('/').filter(Boolean);
  if (!parts.length || [...parts, version].some((p) => p === '..' || p === '.' || !/^[A-Za-z0-9._-]+$/.test(p))) return null;
  const segs = parts.length === 1 ? ['registry.ollama.ai', 'library', parts[0]] : parts.length === 2 ? ['registry.ollama.ai', ...parts] : parts;
  return path.join(dir, 'manifests', ...segs, version);
}

const blobPath = (digest: string, dir: string) => path.join(dir, 'blobs', digest.replace(':', '-'));

/** Read the tag's current substance from disk. No inference, no network. */
export function readOllamaSubstance(tag: string, dir = ollamaModelsDir()): { ok: true; substance: LocalSubstance } | { ok: false; reason: string } {
  const mp = ollamaManifestPath(tag, dir);
  if (!mp) return { ok: false, reason: `"${tag}" is not a valid Ollama tag` };
  let raw: Buffer;
  try { raw = fs.readFileSync(mp); } catch { return { ok: false, reason: `no manifest for ${tag} in the local models directory` }; }
  let m: any;
  try { m = JSON.parse(raw.toString('utf8')); } catch { return { ok: false, reason: `the manifest for ${tag} is not valid JSON` }; }
  const configDigest = String(m?.config?.digest ?? '');
  const model = (m?.layers ?? []).find((l: any) => /\.model$/.test(String(l?.mediaType ?? '')));
  if (!DIGEST_RE.test(configDigest) || !model || !DIGEST_RE.test(String(model.digest))) return { ok: false, reason: `the manifest for ${tag} does not name a config and a model layer` };
  let cfgRaw: Buffer;
  try { cfgRaw = fs.readFileSync(blobPath(configDigest, dir)); } catch { return { ok: false, reason: `config blob ${configDigest} is missing` }; }
  if (`sha256:${sha256Hex(cfgRaw)}` !== configDigest) return { ok: false, reason: `config blob content does not match its address ${configDigest}` };
  let cfg: any = {};
  try { cfg = JSON.parse(cfgRaw.toString('utf8')); } catch { return { ok: false, reason: 'the config blob is not valid JSON' }; }
  let size = -1;
  try { size = fs.statSync(blobPath(model.digest, dir)).size; } catch { return { ok: false, reason: `weights blob ${model.digest} is missing` }; }
  if (Number.isInteger(model.size) && size !== model.size) return { ok: false, reason: `weights blob ${model.digest} is ${size} bytes; the manifest declares ${model.size}` };
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  return {
    ok: true,
    substance: {
      runtime: 'ollama', tag, manifestDigest: `sha256:${sha256Hex(raw)}`, configDigest, weightsDigest: String(model.digest), weightsBytes: size,
      format: str(cfg.model_format), family: str(cfg.model_family), parameterSize: str(cfg.model_type), quantization: str(cfg.file_type),
    },
  };
}

export function substanceDiff(approved: LocalSubstance, observed: LocalSubstance): string[] {
  return SUBSTANCE_FIELDS.filter((k) => (approved[k] ?? null) !== (observed[k] ?? null)).map((k) => `${k}: approved ${approved[k] ?? 'null'}, found ${observed[k] ?? 'null'}`);
}

// ---- the approved record (stored on the route mapping) ------------------------

export function ensureSubstanceColumns(): void {
  const db = getDatabase();
  const cols = new Set((db.prepare('PRAGMA table_info(registry_route_mappings)').all() as Array<{ name: string }>).map((c) => c.name));
  if (!cols.size) return;
  if (!cols.has('substance_json')) db.exec('ALTER TABLE registry_route_mappings ADD COLUMN substance_json TEXT');
  if (!cols.has('substance_hash')) db.exec('ALTER TABLE registry_route_mappings ADD COLUMN substance_hash TEXT');
}

export function approvedSubstance(providerId: string, modelId: string): { substance: LocalSubstance; hash: string } | null {
  ensureSubstanceColumns();
  const r = getDatabase().prepare('SELECT substance_json, substance_hash FROM registry_route_mappings WHERE provider_id = ? AND model_id = ?').get(providerId, modelId) as any;
  if (!r?.substance_json) return null;
  return { substance: JSON.parse(r.substance_json), hash: r.substance_hash };
}

// ---- verification ------------------------------------------------------------------

export type SubstanceCheck =
  | { required: false }
  | { required: true; ok: true; hash: string; substance: LocalSubstance; verifiedAt: string }
  | { required: true; ok: false; code: 'MODEL_SUBSTANCE_UNBOUND' | 'MODEL_SUBSTANCE_CHANGED'; reason: string; changed: string[]; approvedHash: string | null; observedHash: string | null };

/**
 * Verify a route's current local substance against its approved record.
 * `isLocal` is decided by the caller from the route's manifest (LOCAL kind).
 * On a change, records the event and invalidates the route's qualifications
 * (once per observed substance). Pure reads otherwise.
 */
export function verifyRouteSubstance(providerId: string, modelId: string, isLocal: boolean, observedOverride?: LocalSubstance | null): SubstanceCheck {
  if (!isLocal) return { required: false };
  const approved = approvedSubstance(providerId, modelId);
  if (!approved) return { required: true, ok: false, code: 'MODEL_SUBSTANCE_UNBOUND', reason: `${providerId}/${modelId} is a local route with no approved substance record (manifest/config/weights digests); it cannot execute until its mapping binds one`, changed: [], approvedHash: null, observedHash: null };
  const read = observedOverride ? { ok: true as const, substance: observedOverride } : readOllamaSubstance(approved.substance.tag);
  if (!read.ok) return fail(providerId, modelId, approved, null, [`unreadable: ${read.reason}`]);
  const changed = [...(approved.substance.tag !== modelId ? [`tag: the approved record names ${approved.substance.tag}, the route is ${modelId}`] : []), ...substanceDiff(approved.substance, read.substance)];
  if (changed.length) return fail(providerId, modelId, approved, read.substance, changed);
  return { required: true, ok: true, hash: approved.hash, substance: approved.substance, verifiedAt: new Date().toISOString() };
}

function fail(providerId: string, modelId: string, approved: { substance: LocalSubstance; hash: string }, observed: LocalSubstance | null, changed: string[]): SubstanceCheck {
  const observedHash = observed ? substanceHash(observed) : `unreadable:${sha256Hex(changed.join('|')).slice(0, 16)}`;
  const reason = `the local model behind ${providerId}/${modelId} is not the approved substance (${changed.join('; ')})`;
  recordSubstanceChange(providerId, modelId, approved.hash, observedHash, changed, observed);
  return { required: true, ok: false, code: 'MODEL_SUBSTANCE_CHANGED', reason, changed, approvedHash: approved.hash, observedHash };
}

/** Append-only: one event per (route, approved, observed) substance; qualifications persisted INVALIDATED. */
export function recordSubstanceChange(providerId: string, modelId: string, approvedHash: string, observedHash: string, changed: string[], observed: LocalSubstance | null): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const seen = db.prepare("SELECT 1 FROM registry_events WHERE event_type = 'MODEL_SUBSTANCE_CHANGED' AND provider_id = ? AND model_id = ? AND detail_json LIKE ? LIMIT 1")
    .get(providerId, modelId, `%"observedHash":"${observedHash}"%`);
  if (!seen) {
    db.prepare("INSERT INTO registry_events (event_id, event_type, provider_id, model_id, actor, detail_json, created_at) VALUES (?, 'MODEL_SUBSTANCE_CHANGED', ?, ?, 'substance-verifier', ?, ?)")
      .run(`rev-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, providerId, modelId, JSON.stringify({ approvedHash, observedHash, changed, observed }), now);
  }
  try {
    db.prepare("UPDATE registry_qualifications SET status = 'INVALIDATED', revoked_reason = ?, revoked_by = 'substance-verifier', revoked_at = ? WHERE provider_id = ? AND model_id = ? AND status = 'QUALIFIED'")
      .run(`MODEL_SUBSTANCE_CHANGED: ${changed.join('; ')}`.slice(0, 1000), now, providerId, modelId);
  } catch { /* qualification tables not created yet: nothing to invalidate */ }
}

/**
 * RUNTIME check, just before a local request is sent: the running Ollama must
 * resolve the tag to the approved manifest digest. Metadata only (GET).
 */
export async function verifyRuntimeResolves(baseUrl: string, approved: LocalSubstance, fetcher: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; kind: 'MISMATCH' | 'UNAVAILABLE'; reason: string }> {
  let origin: string;
  try { origin = new URL(baseUrl).origin; } catch { return { ok: false, kind: 'UNAVAILABLE', reason: `invalid base URL ${baseUrl}` }; }
  try {
    const res = await fetcher(`${origin}/api/tags`, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, kind: 'UNAVAILABLE', reason: `the runtime answered HTTP ${res.status} to /api/tags` };
    const j: any = await res.json();
    const entry = (j?.models ?? []).find((m: any) => m?.name === approved.tag || m?.model === approved.tag);
    if (!entry) return { ok: false, kind: 'UNAVAILABLE', reason: `the runtime does not list ${approved.tag}` };
    const d = String(entry.digest ?? '');
    const served = d.startsWith('sha256:') ? d : `sha256:${d}`;
    return served === approved.manifestDigest ? { ok: true } : { ok: false, kind: 'MISMATCH', reason: `manifestDigest: approved ${approved.manifestDigest}, the runtime serves ${served}` };
  } catch (e: any) {
    return { ok: false, kind: 'UNAVAILABLE', reason: `the runtime's model list could not be read (${String(e?.message || e).slice(0, 120)})` };
  }
}

/** Offline audit: re-hash the full weights blob. Slow on purpose; never on the request path. */
export function auditLocalWeights(approved: LocalSubstance, dir = ollamaModelsDir()): { ok: boolean; computed: string } {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(blobPath(approved.weightsDigest, dir), 'r');
  try {
    const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  const computed = `sha256:${h.digest('hex')}`;
  return { ok: computed === approved.weightsDigest, computed };
}
