import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// LOCAL ROUTES ARE BOUND TO IMMUTABLE MODEL SUBSTANCE, NOT TO A MUTABLE TAG.
//
// Real bundled local-runtime plugin → a counting local double, and a real
// Ollama-layout models directory (manifest + content-addressed blobs). Every
// change to what the tag points at is refused BEFORE inference, recorded
// append-only, and invalidates the route's qualifications for good.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-substance-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'substance.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('substance');
import { writeOllamaModel, ollamaTagsBody, ollamaModelsFixtureDir } from './helpers/ollama-fixture';

import { getDatabase, verifyReceipt } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { qualifyModel, enableModel, approveLocalZeroPrice, ensureRegistry } from '../lib/registry';
import { getStoredModel } from '../lib/registry/store';
import { approveRouteMapping, routeIdentity } from '../lib/registry/identity';
import { refreshRoute } from '../lib/registry/route-import';
import { setManualDiscoveryEnabled } from '../lib/registry/discovery';
import { insertQualificationForTest, listQualifications, startQualificationRun, evaluateRun } from '../lib/registry/qualification';
import { executeQualificationCases } from '../lib/registry/qualification-exec';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureUsageTable } from '../lib/spend/ledger';
import { invalidateProviderEndpointCache } from '../lib/spend/network-guard';
import { priceVersionKey, currentPricing } from '../lib/registry/pricing';
import { routedModelCall } from '../lib/fabric/routed-call';
import { ollamaManifestPath, substanceHash, readOllamaSubstance, auditLocalWeights } from '../lib/registry/substance';

const WS = 'ws-substance';
const LOC = 'local-runtime';
const MODEL = 'qwen2.5-coder:14b';
const OTHER = 'hermes3:8b';

let posts = 0;
let tagsOverride: string | null = null;
let server: http.Server;

function answer(content: string): string {
  const up = /Reply with exactly the uppercase form of: (.+)$/m.exec(content);
  if (up) return up[1].trim().toUpperCase();
  const ex = /Reply with exactly: (.+)$/m.exec(content);
  return ex ? ex[1].trim() : 'unexpected';
}

beforeAll(async () => {
  getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Substance');
  writeOllamaModel(MODEL);
  writeOllamaModel(OTHER, { family: 'llama', parameterSize: '8.0B' });
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(tagsOverride ?? ollamaTagsBody([MODEL, OTHER])); }
      if (req.method === 'GET' && req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: MODEL }, { id: OTHER }] })); }
      posts += 1;
      const body = JSON.parse(raw || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `c-${posts}`, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: answer(String(body?.messages?.[0]?.content ?? '')) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.SYNTHOS_LOCAL_RUNTIME_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  ensureRegistry();
  const pol = saveSpendPolicy({ ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: false, localExecutionEnabled: true, modelExecutionEnabled: true }, 'test');
  if (!pol.ok) throw new Error(pol.errors.join('; '));
  setManualDiscoveryEnabled(true, 'op');
  const imp = await refreshRoute('local-runtime', 'op');
  setManualDiscoveryEnabled(false, 'op');
  if (!imp.ok) throw new Error(JSON.stringify(imp));
  for (const tag of [MODEL, OTHER]) {
    const m = getStoredModel(LOC, tag)!;
    const pa = approveLocalZeroPrice({ providerId: LOC, modelId: tag, versionKey: priceVersionKey(LOC, tag, m.manifestVersion, currentPricing(m.record).record!), actor: 'op' });
    if (!pa.ok) throw new Error(pa.error);
  }
  const map = approveRouteMapping({ providerId: LOC, modelId: MODEL, canonicalVersionId: 'qwen/qwen2.5-coder-14b-q4_k_m', family: { familyId: 'qwen2.5-coder', displayName: 'Qwen2.5-Coder', publisher: 'qwen' }, actor: 'op', substance: readOllamaSubstance(MODEL).ok ? (readOllamaSubstance(MODEL) as any).substance : null });
  if (!map.ok) throw new Error(map.error);
  expect(qualifyModel(LOC, MODEL, 'op').ok).toBe(true);
  expect(enableModel(LOC, MODEL, 'op').ok).toBe(true);
});

afterAll(async () => {
  delete process.env.SYNTHOS_LOCAL_RUNTIME_BASE_URL;
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => { tagsOverride = null; invalidateProviderEndpointCache(); getDatabase().exec("DELETE FROM runtime_events WHERE target_type = 'provider'"); });

let seq = 0;
const dispatch = () => routedModelCall({ callSite: 'admin.provider_test', workspaceId: WS, model: `${LOC}/${MODEL}`, prompt: 'Reply with exactly: OK', idempotencyKey: `sub-${Date.now()}-${seq++}` });
const qualifyNow = () => insertQualificationForTest({ providerId: LOC, modelId: MODEL, taskClass: 'literal_transformation' });
const qualState = (id: string) => listQualifications({ providerId: LOC, modelId: MODEL }).find((q) => q.qualificationId === id)!;
const events = () => (getDatabase().prepare("SELECT detail_json FROM registry_events WHERE event_type = 'MODEL_SUBSTANCE_CHANGED' ORDER BY rowid").all() as any[]).map((r) => JSON.parse(r.detail_json));
const restore = () => writeOllamaModel(MODEL);
const approvedHash = () => routeIdentity(LOC, MODEL).substanceHash;

async function expectRefusedBeforeInference(qid: string, fieldPattern: RegExp) {
  const before = posts; const evBefore = events().length;
  const r = await dispatch();
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).toMatch(/MODEL_SUBSTANCE_CHANGED/);
  expect(posts).toBe(before); // zero inference requests
  const q = qualState(qid);
  expect(q.state).toBe('INVALIDATED');
  expect(q.stateReasons.join(' ')).toMatch(fieldPattern);
  expect(events().length).toBeGreaterThan(evBefore);
  expect(JSON.stringify(events().slice(evBefore))).toMatch(fieldPattern);
}

describe('substance binding', () => {
  it('the approved mapping stores the digests; unchanged digests permit a qualified local dispatch that names the verified substance', async () => {
    const id = routeIdentity(LOC, MODEL);
    expect(id.substanceHash).toBe(substanceHash((readOllamaSubstance(MODEL) as any).substance));
    const qid = qualifyNow();
    const r = await dispatch();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.decision.selected).toMatchObject({ providerId: LOC, modelId: MODEL, substanceHash: id.substanceHash });
    expect(posts).toBe(1);
    expect(qualState(qid).state).toBe('VALID');
  });

  it('a changed manifest blocks before inference', async () => {
    const qid = qualifyNow();
    const mp = ollamaManifestPath(MODEL, ollamaModelsFixtureDir())!;
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    fs.writeFileSync(mp, JSON.stringify({ ...m, annotations: { edited: true } }));
    await expectRefusedBeforeInference(qid, /manifestDigest/);
    restore();
  });

  it('a changed config blob blocks before inference', async () => {
    const qid = qualifyNow();
    const s = (readOllamaSubstance(MODEL) as any).substance;
    fs.writeFileSync(path.join(ollamaModelsFixtureDir(), 'blobs', s.configDigest.replace(':', '-')), JSON.stringify({ model_format: 'gguf', model_family: 'qwen2', model_type: '14.8B', file_type: 'Q4_K_M', tampered: 1 }));
    await expectRefusedBeforeInference(qid, /config blob content does not match its address/);
    restore();
  });

  it('changed weights block before inference', async () => {
    const qid = qualifyNow();
    writeOllamaModel(MODEL, { weights: 'different weights behind the same tag' });
    await expectRefusedBeforeInference(qid, /weightsDigest/);
    restore();
  });

  it('a changed quantization invalidates the qualification', async () => {
    const qid = qualifyNow();
    writeOllamaModel(MODEL, { quantization: 'Q8_0' });
    await expectRefusedBeforeInference(qid, /quantization: approved Q4_K_M, found Q8_0/);
    restore();
    // Reverting the files does NOT revive it.
    expect(qualState(qid).state).toBe('INVALIDATED');
  });

  it('the mutable tag label cannot bypass the check: repointing the tag at other weights is refused, and a record naming another tag is refused', async () => {
    const qid = qualifyNow();
    const dir = ollamaModelsFixtureDir();
    fs.copyFileSync(ollamaManifestPath(OTHER, dir)!, ollamaManifestPath(MODEL, dir)!); // same label, other model
    await expectRefusedBeforeInference(qid, /manifestDigest|weightsDigest/);
    restore();
    const other = (readOllamaSubstance(OTHER) as any).substance;
    expect(approveRouteMapping({ providerId: LOC, modelId: MODEL, canonicalVersionId: 'qwen/qwen2.5-coder-14b-q4_k_m', actor: 'op', substance: other })).toMatchObject({ ok: false, error: expect.stringMatching(/names hermes3:8b/) });
    expect(approveRouteMapping({ providerId: LOC, modelId: MODEL, canonicalVersionId: 'qwen/qwen2.5-coder-14b-q4_k_m', actor: 'op', substance: { ...other, tag: MODEL } })).toMatchObject({ ok: false, error: expect.stringMatching(/does not match the local model now/) });
    // An unmapped tag (no substance record) never executes.
    const r = await routedModelCall({ callSite: 'admin.provider_test', workspaceId: WS, model: `${LOC}/${OTHER}`, prompt: 'Reply with exactly: OK', idempotencyKey: `sub-other-${Date.now()}` });
    expect(r.ok).toBe(false);
  });

  it('a runtime serving a different digest for the tag is refused before any inference request', async () => {
    const qid = qualifyNow();
    tagsOverride = JSON.stringify({ models: [{ name: MODEL, model: MODEL, digest: 'f'.repeat(64) }] });
    const before = posts;
    const r = await dispatch();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/MODEL_SUBSTANCE_CHANGED/);
    expect(posts).toBe(before);
    expect(qualState(qid).state).toBe('INVALIDATED');
  });

  it('an unreachable or silent runtime refuses the call (nothing sent) but does NOT invalidate the qualification', async () => {
    const qid = qualifyNow();
    tagsOverride = JSON.stringify({ models: [] });
    const before = posts;
    const r = await dispatch();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/LOCAL_RUNTIME_UNVERIFIED/);
    expect(posts).toBe(before);
    expect(qualState(qid).state).toBe('VALID');
    tagsOverride = null;
    expect((await dispatch()).ok).toBe(true);
  });

  it('historical receipts keep their original digests; a reapproval is a new mapping event and a new qualification, never an edit of the old one', async () => {
    const originalHash = approvedHash()!;
    const run = startQualificationRun({ providerId: LOC, modelId: MODEL, taskClass: 'literal_transformation', actor: 'op' });
    if (!run.ok) throw new Error(run.error);
    const ex = await executeQualificationCases({ runId: run.runId, workspaceId: WS, source: 'CANARY', actor: 'op' });
    if (!ex.ok) throw new Error(ex.error);
    expect(ex.cases).toHaveLength(6);
    expect(ex.cases.every((c) => c.pass && c.substanceHash === originalHash)).toBe(true);
    expect(evaluateRun(run.runId)).toMatchObject({ ok: true, status: 'PASSED' });
    const receipts = ex.cases.map((c) => getDatabase().prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(c.receiptId) as any);
    const oldQ = qualifyNow();

    // The model is replaced behind the tag, then reviewed and remapped.
    const newSub = writeOllamaModel(MODEL, { weights: 'v2 weights' });
    expect((await dispatch()).ok).toBe(false);
    const remap = approveRouteMapping({ providerId: LOC, modelId: MODEL, canonicalVersionId: 'qwen/qwen2.5-coder-14b-q4_k_m-v2', family: { familyId: 'qwen2.5-coder', displayName: 'Qwen2.5-Coder', publisher: 'qwen' }, actor: 'op', substance: newSub });
    expect(remap.ok).toBe(true);
    expect(approvedHash()).not.toBe(originalHash);
    const mapEvents = (getDatabase().prepare("SELECT detail_json FROM registry_events WHERE event_type = 'ROUTE_MAPPING_APPROVED' AND model_id = ? ORDER BY rowid").all(MODEL) as any[]).map((r) => JSON.parse(r.detail_json).substanceHash);
    expect(mapEvents).toContain(originalHash);
    expect(mapEvents[mapEvents.length - 1]).toBe(approvedHash());
    expect(qualState(oldQ).state).toBe('INVALIDATED');
    const newQ = qualifyNow();
    expect(newQ).not.toBe(oldQ);
    expect(qualState(newQ).state).toBe('VALID');
    expect(qualState(oldQ).state).toBe('INVALIDATED');

    // The earlier receipts still name the ORIGINAL substance and still verify.
    for (const r of receipts) {
      const now = getDatabase().prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(r.receipt_id) as any;
      expect(now.payload_json).toBe(r.payload_json);
      expect(JSON.parse(now.payload_json).substanceHash).toBe(originalHash);
      expect(verifyReceipt(now)).toBe(true);
    }
  });

  it('the offline weights audit re-hashes the blob and agrees with its content address', () => {
    const s = (readOllamaSubstance(MODEL) as any).substance;
    expect(auditLocalWeights(s)).toMatchObject({ ok: true, computed: s.weightsDigest });
  });
});
