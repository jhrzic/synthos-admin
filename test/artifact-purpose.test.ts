import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// ARTIFACT PURPOSE AND RETRIEVAL POLICY.
//
// Verification is not knowledge and not retrieval: acceptance, qualification
// and test artifacts stay preserved and hash-verifiable, but only an explicit,
// authorized evidence search finds them. Classification is append-only.
// Real kernel + one counting local fake provider; nothing external.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-purpose-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'purpose.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('purpose');

import { getDatabase, verifyReceipt } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { qualifyModel, enableModel } from '../lib/registry';
import { importManifest } from '../lib/registry/store';
import { insertQualificationForTest, listQualifications } from '../lib/registry/qualification';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureUsageTable } from '../lib/spend/ledger';
import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import {
  searchWorkspaceMemory, listWorkspaceMemory, reindexWorkspaceMemory, searchEvidenceArtifacts, classifyArtifactPurpose,
  currentArtifactPurpose, artifactPurposeHistory, quarantineArtifact,
} from '../lib/memory-index';

const WS = 'ws-purpose';
const PUB = 'purpose-pub';
let requests = 0;
let server: http.Server;

beforeAll(async () => {
  getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Purpose');
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests += 1;
      const content = String(JSON.parse(raw || '{}')?.messages?.[0]?.content ?? '');
      const literal = content.trim().split('\n').pop()!.trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `p-${requests}`, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: literal }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.PURPOSE_PUB_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.PURPOSE_PUB_API_KEY = 'sk-purpose-pub-000000000000000000000';
  const now = Date.now(); const iso = (ms: number) => new Date(ms).toISOString();
  const r = importManifest({
    schemaVersion: 'synthos.registry/v1', manifestVersion: 'purpose-1', provenance: { publisher: 'synthos-test-fixtures', generatedAt: iso(now) },
    provider: { providerId: PUB, displayName: PUB, protocol: 'openai.chat_completions', adapterVersion: '1.0.0', approvedHosts: ['api.purpose-pub.example'], defaultBaseUrl: 'https://api.purpose-pub.example/v1', baseUrlEnvVar: 'PURPOSE_PUB_BASE_URL', auth: { type: 'BEARER', credentialSlot: null, envVars: ['PURPOSE_PUB_API_KEY'] }, billing: 'METERED', restrictions: { regions: [], compliance: [] } },
    models: [{ modelId: 'm', aliases: [], displayName: 'm', lifecycle: 'ACTIVE', releaseDate: null, deprecationDate: null, shutdownDate: null, limits: { contextTokens: 128000, outputTokens: 4096 }, modalities: { input: ['text'], output: ['text'] },
      capabilities: [{ id: 'text.input', supported: true, source: 'f', verification: 'PUBLISHER_ASSERTED', effectiveDate: null }, { id: 'text.output', supported: true, source: 'f', verification: 'PUBLISHER_ASSERTED', effectiveDate: null }],
      supportedParameters: ['max_tokens'], outputContracts: ['NARRATIVE', 'LITERAL', 'JSON_OBJECT'],
      pricing: [{ currency: 'USD', unit: 'tokens', rates: { input: 1, output: 2, cachedInput: 0.5 }, reasoningTokens: 'BILLED_AS_OUTPUT', tiers: [], toolCharges: [], modalityCharges: [], effectiveFrom: iso(now - 86_400_000), effectiveUntil: null, source: 'f', verifiedAt: iso(now), staleAfter: iso(now + 30 * 86_400_000), approval: 'APPROVED' }],
      adapterCompatibility: { protocol: 'openai.chat_completions', minAdapterVersion: '1.0.0' }, restrictions: { regions: [], compliance: [] } }],
  }, { source: 'PLUGIN', actor: 'test' });
  if (!r.ok) throw new Error(r.errors.join('; '));
  expect(qualifyModel(PUB, 'm', 'test').ok).toBe(true);
  expect(enableModel(PUB, 'm', 'test').ok).toBe(true);
  listQualifications();
  insertQualificationForTest({ providerId: PUB, modelId: 'm', taskClass: 'literal_transformation' });
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  const pol = saveSpendPolicy({ ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: true, global: { dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 }, providers: { ...Object.fromEntries(Object.keys(DEFAULT_SPEND_POLICY.providers).map((p) => [p, off])), [PUB]: { enabled: true, dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 } }, workspaceDefault: { dailyUsd: 10, maxConcurrent: 5 }, task: { maxEstimatedUsd: 1, maxInputChars: 200_000, maxOutputTokens: 1000, maxTier: 'PREMIUM' }, approvalThresholdUsd: 1 }, 'test');
  if (!pol.ok) throw new Error(pol.errors.join('; '));
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); delete process.env.PURPOSE_PUB_BASE_URL; delete process.env.PURPOSE_PUB_API_KEY; });

let seq = 0;
async function run(literal: string, artifactPurpose?: string) {
  const taskId = `purpose-${Date.now()}-${seq++}`;
  const r = await executeAgentTask({ taskId, taskTitle: `Purpose ${literal}`, description: `Reply with exactly: ${literal}`, assignedAgent: 'scribe', assignedModel: `${PUB}/m`, taskClass: 'literal_transformation', outputContract: { mode: 'LITERAL', literal }, spendIdempotencyKey: `purpose:${taskId}`, ...(artifactPurpose ? { artifactPurpose } : {}) } as any, WS, createExecutionContext({ workspaceId: WS }));
  const artifactId = (getDatabase().prepare('SELECT artifact_id FROM artifacts WHERE task_id = ?').get(taskId) as any)?.artifact_id;
  return { taskId, r, artifactId };
}
const snapshot = (artifactId: string, taskId: string) => ({
  artifact: getDatabase().prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifactId),
  review: getDatabase().prepare('SELECT * FROM quality_reviews WHERE task_id = ?').all(taskId),
  receipts: getDatabase().prepare('SELECT * FROM receipts WHERE task_id = ?').all(taskId),
  ledger: getDatabase().prepare('SELECT * FROM provider_usage WHERE task_id = ?').all(taskId),
});
const inOrdinary = (artifactId: string, term: string) => searchWorkspaceMemory(WS, term).some((x) => x.artifact_id === artifactId) || listWorkspaceMemory(WS, 200).some((x) => x.artifact_id === artifactId);

describe('artifact purpose and retrieval', () => {
  it('ordinary work (no purpose given) is PRODUCTION_WORK and searchable, exactly as before', async () => {
    const { r, artifactId } = await run('ORDINARYWORKALPHA');
    expect(r.body).toMatchObject({ status: 'DONE' });
    expect(currentArtifactPurpose(artifactId)).toMatchObject({ purpose: 'PRODUCTION_WORK', retrievalPolicy: 'ORDINARY', source: 'DEFAULT' });
    expect(inOrdinary(artifactId, 'ORDINARYWORKALPHA')).toBe(true);
  });

  it('an acceptance task\'s artifact is ACCEPTANCE_EVIDENCE from creation: never in ordinary retrieval, still verified, receipted and hash-verifiable', async () => {
    const { r, taskId, artifactId } = await run('ACCEPTANCEEVIDENCEBETA', 'ACCEPTANCE_EVIDENCE');
    expect(r.body).toMatchObject({ status: 'DONE' });
    expect(currentArtifactPurpose(artifactId)).toMatchObject({ purpose: 'ACCEPTANCE_EVIDENCE', retrievalPolicy: 'AUDIT_ONLY', source: 'EVENT' });
    expect(inOrdinary(artifactId, 'ACCEPTANCEEVIDENCEBETA')).toBe(false);
    const receipt = getDatabase().prepare('SELECT * FROM receipts WHERE task_id = ?').get(taskId) as any;
    expect(verifyReceipt(receipt)).toBe(true);
    const found = searchEvidenceArtifacts(WS, 'ACCEPTANCEEVIDENCEBETA');
    expect(found).toEqual([expect.objectContaining({ artifactId, purpose: 'ACCEPTANCE_EVIDENCE', retrievalPolicy: 'AUDIT_ONLY', hashVerifies: true, retrievalStatus: 'ACTIVE' })]);
  });

  it('classifying existing work as evidence appends an event and removes it from ordinary retrieval — artifact, review, receipt and ledger rows are unchanged', async () => {
    const { taskId, artifactId } = await run('RECLASSIFYGAMMA');
    expect(inOrdinary(artifactId, 'RECLASSIFYGAMMA')).toBe(true);
    const before = snapshot(artifactId, taskId);
    const eventsBefore = (getDatabase().prepare('SELECT event_id, event_type, payload_json FROM activity_events WHERE task_id = ? ORDER BY rowid').all(taskId) as any[]);
    const c = classifyArtifactPurpose({ workspaceId: WS, artifactId, purpose: 'ACCEPTANCE_EVIDENCE', reason: 'production acceptance evidence', actor: 'op' });
    expect(c).toMatchObject({ ok: true, changed: true });
    expect(inOrdinary(artifactId, 'RECLASSIFYGAMMA')).toBe(false);
    expect(snapshot(artifactId, taskId)).toEqual(before);
    const eventsAfter = (getDatabase().prepare('SELECT event_id, event_type, payload_json FROM activity_events WHERE task_id = ? ORDER BY rowid').all(taskId) as any[]);
    expect(eventsAfter.slice(0, eventsBefore.length)).toEqual(eventsBefore); // earlier events untouched
    expect(eventsAfter.slice(eventsBefore.length).map((e) => e.event_type)).toEqual(['ARTIFACT_PURPOSE_CLASSIFIED']);
    // Idempotent.
    expect(classifyArtifactPurpose({ workspaceId: WS, artifactId, purpose: 'ACCEPTANCE_EVIDENCE', reason: 'again', actor: 'op' })).toMatchObject({ ok: true, changed: false });
    expect(artifactPurposeHistory(artifactId)).toHaveLength(1);
  });

  it('an index rebuild reproduces the policy: evidence is not restored, production work is', async () => {
    const prod = await run('REBUILDPRODDELTA');
    const ev = await run('REBUILDEVIDENCEDELTA', 'QUALIFICATION_EVIDENCE');
    getDatabase().exec(`DELETE FROM memory_index WHERE workspace_id = '${WS}'`);
    reindexWorkspaceMemory(WS);
    expect(inOrdinary(prod.artifactId, 'REBUILDPRODDELTA')).toBe(true);
    expect(inOrdinary(ev.artifactId, 'REBUILDEVIDENCEDELTA')).toBe(false);
  });

  it('re-classifying back to PRODUCTION_WORK is a new event (history kept) and re-admits it; a quarantined artifact is never re-admitted', async () => {
    const { artifactId } = await run('READMITEPSILON', 'TEST_FIXTURE');
    expect(inOrdinary(artifactId, 'READMITEPSILON')).toBe(false);
    expect(classifyArtifactPurpose({ workspaceId: WS, artifactId, purpose: 'PRODUCTION_WORK', reason: 'operator: this is real work', actor: 'op' }).ok).toBe(true);
    expect(inOrdinary(artifactId, 'READMITEPSILON')).toBe(true);
    expect(artifactPurposeHistory(artifactId).map((h) => h.purpose)).toEqual(['TEST_FIXTURE', 'PRODUCTION_WORK']);
    quarantineArtifact({ workspaceId: WS, artifactId, reason: 'test quarantine', actor: 'op' });
    reindexWorkspaceMemory(WS);
    expect(inOrdinary(artifactId, 'READMITEPSILON')).toBe(false);
    expect(searchEvidenceArtifacts(WS, 'READMITEPSILON').length).toBe(0);
    expect(searchEvidenceArtifacts(WS, 'READMITEPSILON', { includeQuarantined: true })).toEqual([expect.objectContaining({ artifactId, retrievalStatus: 'QUARANTINED' })]);
  });

  it('an invalid purpose is refused before anything runs', async () => {
    const before = requests;
    const taskId = `purpose-bad-${Date.now()}`;
    const r = await executeAgentTask({ taskId, taskTitle: 't', description: 'x', assignedModel: `${PUB}/m`, taskClass: 'literal_transformation', outputContract: { mode: 'LITERAL', literal: 'X' }, artifactPurpose: 'KNOWLEDGE' } as any, WS, createExecutionContext({ workspaceId: WS }));
    expect(r).toMatchObject({ status: 400, body: { reason: 'INVALID_ARTIFACT_PURPOSE' } });
    expect(requests).toBe(before);
    expect(getDatabase().prepare('SELECT 1 FROM tasks WHERE task_id = ?').get(taskId)).toBeUndefined();
  });

  it('purpose never promotes knowledge: no knowledge candidate is created by classification', () => {
    const n = (getDatabase().prepare("SELECT COUNT(*) AS n FROM knowledge_candidates").get() as any)?.n ?? 0;
    expect(n).toBe(0);
  });

  it('every request went to the local fake', () => { expect(process.env.PURPOSE_PUB_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/); });
});
