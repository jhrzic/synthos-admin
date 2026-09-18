import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// FULL OFFLINE SUBSTANCE AUDIT — a real Ollama-layout fixture directory and a
// temp database. No network, no inference: fetch is replaced by a throwing
// sentinel for the whole file.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-subaudit-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'subaudit.db');

import { writeOllamaModel, ollamaModelsFixtureDir } from './helpers/ollama-fixture';
import { getDatabase } from '../lib/persistence';
import { ensureRegistry } from '../lib/registry';
import { ensureIdentityTables } from '../lib/registry/identity';
import { ensureQualificationTables } from '../lib/registry/qualification';
import { auditLocalRouteSubstance, ensureSubstanceColumns, substanceHash, ollamaManifestPath, type LocalSubstance } from '../lib/registry/substance';

const P = 'local-runtime';
let fetchCalls = 0;
const bind = (modelId: string, s: LocalSubstance) => {
  getDatabase().prepare("INSERT OR REPLACE INTO registry_route_mappings (provider_id, model_id, canonical_version_id, status, updated_at, substance_json, substance_hash) VALUES (?, ?, 'fixture/v', 'APPROVED', '2026-09-18T00:00:00Z', ?, ?)")
    .run(P, modelId, JSON.stringify(s), substanceHash(s));
};
const qualify = (id: string, modelId: string) => getDatabase().prepare(`INSERT INTO registry_qualifications (qualification_id, provider_id, model_id, deployment_id, canonical_version_id, task_class, scope_json, quality, reliability, min_quality, min_reliability, suite_id, suite_version, run_id, evidence_json, binding_json, binding_hash, status, approved_by, qualified_at, expires_at)
  VALUES (?, ?, ?, 'default', 'fixture/v', 'literal_transformation', '{}', 1, 1, 1, 1, 's', '1', 'r', '{}', '{}', 'h', 'QUALIFIED', 'op', '2026-09-18T00:00:00Z', '2027-01-01T00:00:00Z')`).run(id, P, modelId);
const qStatus = (id: string) => (getDatabase().prepare('SELECT status, revoked_reason FROM registry_qualifications WHERE qualification_id = ?').get(id) as any);
const events = (modelId: string) => getDatabase().prepare("SELECT event_type, actor, detail_json FROM registry_events WHERE model_id = ? ORDER BY rowid").all(modelId) as any[];

beforeAll(() => {
  (globalThis as any).fetch = () => { fetchCalls += 1; throw new Error('network is forbidden in this test'); };
  ollamaModelsFixtureDir();
  getDatabase(); ensureRegistry(); ensureIdentityTables(); ensureQualificationTables(); ensureSubstanceColumns();
});

describe('auditLocalRouteSubstance', () => {
  it('matching substance: full re-hash of manifest, config and weights, one audit event, qualification untouched', () => {
    const s = writeOllamaModel('good:1b');
    bind('good:1b', s); qualify('q-good', 'good:1b');
    const qBefore = getDatabase().prepare("SELECT * FROM registry_qualifications WHERE qualification_id = 'q-good'").get();
    const a = auditLocalRouteSubstance(P, 'good:1b', 'auditor');
    expect(a.ok).toBe(true);
    expect(a.mismatches).toEqual([]);
    expect(a.computedHash).toBe(substanceHash(s));
    expect(a.files.map((f) => f.role)).toEqual(['manifest', 'config', 'weights']);
    expect(a.files.find((f) => f.role === 'weights')).toMatchObject({ sha256: s.weightsDigest, bytes: s.weightsBytes, relPath: path.join('blobs', s.weightsDigest.replace(':', '-')) });
    expect(a.files.find((f) => f.role === 'manifest')!.sha256).toBe(s.manifestDigest);
    expect(a.chain).toEqual({ manifestNamesConfig: s.configDigest, manifestNamesWeights: s.weightsDigest, configContentMatches: true, weightsContentMatches: true, weightsSizeMatchesManifest: true });
    expect(events('good:1b').map((e) => e.event_type)).toEqual(['LOCAL_SUBSTANCE_AUDITED']);
    expect(JSON.parse(events('good:1b')[0].detail_json)).toMatchObject({ ok: true, networkRequests: 0, inference: false });
    expect(getDatabase().prepare("SELECT * FROM registry_qualifications WHERE qualification_id = 'q-good'").get()).toEqual(qBefore);
    // Re-running appends another audit record (append-only), never edits one.
    auditLocalRouteSubstance(P, 'good:1b', 'auditor');
    expect(events('good:1b').map((e) => e.event_type)).toEqual(['LOCAL_SUBSTANCE_AUDITED', 'LOCAL_SUBSTANCE_AUDITED']);
  });

  it('weights corrupted in place (same size, same address): detected only by the full hash; route blocked', () => {
    const s = writeOllamaModel('rot:1b', { weights: 'AAAAAAAAAAAAAAAA' });
    bind('rot:1b', s); qualify('q-rot', 'rot:1b');
    fs.writeFileSync(path.join(ollamaModelsFixtureDir(), 'blobs', s.weightsDigest.replace(':', '-')), 'AAAAAAAAAAAAAAAB');
    const a = auditLocalRouteSubstance(P, 'rot:1b', 'auditor');
    expect(a.ok).toBe(false);
    expect(a.chain.weightsContentMatches).toBe(false);
    expect(a.mismatches.join(' | ')).toMatch(/weights blob content hashes to sha256:[0-9a-f]{64}, not its address/);
    expect(events('rot:1b').map((e) => e.event_type)).toEqual(['LOCAL_SUBSTANCE_AUDITED', 'MODEL_SUBSTANCE_CHANGED']);
    expect(qStatus('q-rot')).toMatchObject({ status: 'INVALIDATED', revoked_reason: expect.stringMatching(/^MODEL_SUBSTANCE_CHANGED/) });
  });

  it('the tag re-pointed at other weights: manifest and substance hash differ; route blocked', () => {
    const s = writeOllamaModel('moved:1b');
    bind('moved:1b', s); qualify('q-moved', 'moved:1b');
    writeOllamaModel('moved:1b', { weights: 'different weights' });
    const a = auditLocalRouteSubstance(P, 'moved:1b', 'auditor');
    expect(a.ok).toBe(false);
    expect(a.computedHash).not.toBe(substanceHash(s));
    expect(a.mismatches.join(' | ')).toMatch(/manifestDigest: approved/);
    expect(qStatus('q-moved').status).toBe('INVALIDATED');
  });

  it('a missing manifest or an unbound route fails closed, with an audit record', () => {
    const s = writeOllamaModel('gone:1b');
    bind('gone:1b', s);
    fs.rmSync(ollamaManifestPath('gone:1b', ollamaModelsFixtureDir())!);
    expect(auditLocalRouteSubstance(P, 'gone:1b', 'auditor')).toMatchObject({ ok: false, mismatches: [expect.stringMatching(/no manifest/)] });
    expect(auditLocalRouteSubstance(P, 'never-bound:1b', 'auditor')).toMatchObject({ ok: false, approvedHash: null, mismatches: [expect.stringMatching(/no approved substance record/)] });
    expect(events('never-bound:1b').map((e) => e.event_type)).toEqual(['LOCAL_SUBSTANCE_AUDITED']);
  });

  it('made no network request', () => { expect(fetchCalls).toBe(0); });
});
