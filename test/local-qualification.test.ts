import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// LOCAL ROUTE QUALIFICATION — the canonical path, end to end, against the
// REAL bundled local-runtime plugin pointed at a local HTTP double that
// counts requests (an OpenAI-compatible runtime, like Ollama). Proves:
//
//   * metadata import is a one-off pull gated by manual discovery, sends no
//     credential, follows no redirect, and qualifies/enables nothing;
//   * the imported $0 price is UNREVIEWED and blocks execution until an
//     operator approves exactly that record; only $0 LOCAL records qualify;
//   * a local route can never claim a publisher route's version;
//   * each case: routing decision (Guardian verdict, run id) → spend guard
//     ($0 ledger row naming decision and run) → adapter → Aegis review →
//     signed receipt; no retry, no fallback, no duplicate;
//   * a PASSED run is evidence, not permission: production routing still
//     refuses the route until an operator approves the qualification;
//   * a failing case is recorded as failed (receipt says so) and not retried;
//   * an UNKNOWN outcome stops the run with no further request;
//   * paid execution OFF throughout; local execution is what gates the route.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-localq-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'localq.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'l'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('local-qualification');

import { getDatabase, verifyReceipt } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { qualifyModel, evaluateModel, approveLocalZeroPrice, ensureRegistry } from '../lib/registry';
import { getStoredModel } from '../lib/registry/store';
import { approveRouteMapping, routeIdentity } from '../lib/registry/identity';
import { refreshRoute, listRouteImportStatus, getRouteRefreshSettings } from '../lib/registry/route-import';
import { setManualDiscoveryEnabled, isManualDiscoveryEnabled } from '../lib/registry/discovery';
import { startQualificationRun, evaluateRun, getRun, listQualifications } from '../lib/registry/qualification';
import { executeQualificationCases } from '../lib/registry/qualification-exec';
import { routeTask, requirementsFor, getDecision } from '../lib/registry/router';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY, getSpendPolicy } from '../lib/spend/policy';
import { ensureUsageTable } from '../lib/spend/ledger';
import { invalidateProviderEndpointCache } from '../lib/spend/network-guard';
import { priceVersionKey, currentPricing } from '../lib/registry/pricing';
import { validateEndpointUrl } from '../lib/registry/endpoints';
import { routedModelCall } from '../lib/fabric/routed-call';

const WS = 'ws-localq';
const LOC = 'local-runtime';
const MODEL = 'qwen2.5-coder:14b';

type Mode = 'echo' | 'wrong-on-2' | 'hang';
let mode: Mode = 'echo';
let requests: Array<{ method: string; url: string; auth: string | undefined; body: any }> = [];
let server: http.Server;
let base = '';

function answer(content: string): string {
  const up = /Reply with exactly the uppercase form of: (.+)$/m.exec(content);
  if (up) return up[1].trim().toUpperCase();
  const ex = /Reply with exactly: (.+)$/m.exec(content);
  return ex ? ex[1].trim() : 'unexpected';
}

beforeAll(async () => {
  getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Local qualification');
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
      requests.push({ method: req.method || '', url: req.url || '', auth: req.headers.authorization, body });
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'library' }, { id: 'hermes3:8b', object: 'model', owned_by: 'library' }] }));
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        if (mode === 'hang') return; // never answers: the client times out after dispatch
        const n = requests.filter((r) => r.method === 'POST').length;
        const content = String(body?.messages?.[0]?.content ?? '');
        const text = mode === 'wrong-on-2' && n === 2 ? 'Sure! ROUTE READY' : answer(content);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: `chatcmpl-${n}`, model: MODEL, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }));
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.SYNTHOS_LOCAL_RUNTIME_BASE_URL = base;
  ensureRegistry();
});

afterAll(async () => {
  delete process.env.SYNTHOS_LOCAL_RUNTIME_BASE_URL;
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  requests = [];
  mode = 'echo';
  invalidateProviderEndpointCache();
  getDatabase().exec("DELETE FROM runtime_events WHERE target_type = 'provider'");
});

function policy(p: { paid: boolean; local: boolean }) {
  const r = saveSpendPolicy({ ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: p.paid, localExecutionEnabled: p.local, modelExecutionEnabled: true }, 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
}
const chatRequests = () => requests.filter((r) => r.method === 'POST');
const priceKey = () => { const m = getStoredModel(LOC, MODEL)!; return priceVersionKey(LOC, MODEL, m.manifestVersion, currentPricing(m.record).record!); };

describe('the local runtime endpoint is exactly the approved loopback host', () => {
  it('the bundled plugin names 127.0.0.1:11434 and a credential-free local route may not use any other loopback host', () => {
    const body = { providerId: LOC, approvedHosts: ['127.0.0.1'], routeKind: 'LOCAL' as const, auth: { type: 'NONE' as const, credentialSlot: null, envVars: [] } };
    expect(validateEndpointUrl('http://127.0.0.1:11434/v1', body, { NODE_ENV: 'production' } as any).ok).toBe(true);
    expect(validateEndpointUrl('http://localhost:3000/v1', body, { NODE_ENV: 'production' } as any)).toMatchObject({ ok: false });
    expect(validateEndpointUrl('http://127.0.0.2:11434/v1', body, { NODE_ENV: 'production' } as any)).toMatchObject({ ok: false });
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib/registry/plugins/manifests/local-runtime.json'), 'utf8'));
    expect(manifest.provider).toMatchObject({ approvedHosts: ['127.0.0.1'], defaultBaseUrl: 'http://127.0.0.1:11434/v1', auth: { type: 'NONE' }, billing: 'FREE_LOCAL', routeKind: 'LOCAL' });
  });
});

describe('metadata import, identity and price — nothing runs until each is approved', () => {
  it('a one-off pull is refused while manual discovery is OFF (zero requests), and scheduled refresh stays OFF', async () => {
    policy({ paid: false, local: false });
    expect(isManualDiscoveryEnabled()).toBe(false);
    expect(await refreshRoute('local-runtime', 'operator')).toMatchObject({ ok: false, code: 'REFRESH_DISABLED' });
    expect(requests).toHaveLength(0);
    expect(getRouteRefreshSettings().enabled).toBe(false);
  });

  it('with manual discovery ON: one GET of the approved loopback /models, no credential; offerings land unqualified; discovery goes OFF again', async () => {
    setManualDiscoveryEnabled(true, 'operator');
    const r = await refreshRoute('local-runtime', 'operator');
    setManualDiscoveryEnabled(false, 'operator');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(requests).toEqual([{ method: 'GET', url: '/v1/models', auth: undefined, body: null }]);
    expect(isManualDiscoveryEnabled()).toBe(false);
    expect(listRouteImportStatus().find((s) => s.importerId === 'local-runtime')).toMatchObject({ state: 'CURRENT', offerings: 2 });
    const view = evaluateModel(LOC, MODEL)!;
    expect(view.executable).toBe(false);
    expect(view.blockers.map((b) => b.state)).toEqual(expect.arrayContaining(['PRICING_REQUIRED', 'UNQUALIFIED']));
    expect(currentPricing(getStoredModel(LOC, MODEL)!.record)).toMatchObject({ state: 'NOT_APPROVED', record: { approval: 'UNREVIEWED', rates: { input: 0, output: 0 } } });
    expect(routeIdentity(LOC, MODEL).resolved).toBe(false);
  });

  it('unknown pricing is never free: with local ON the unreviewed route still receives zero requests', async () => {
    policy({ paid: false, local: true });
    const call = await routedModelCall({ callSite: 'admin.provider_test', workspaceId: WS, model: `${LOC}/${MODEL}`, prompt: 'Reply with exactly: X', idempotencyKey: `unpriced-${Date.now()}` });
    expect(call.ok).toBe(false);
    expect(chatRequests()).toHaveLength(0);
    policy({ paid: false, local: false });
  });

  it('price approval takes exactly the reviewed $0 record, and nothing that is not a credential-free local route', () => {
    expect(approveLocalZeroPrice({ providerId: LOC, modelId: MODEL, versionKey: 'registry:wrong', actor: 'operator' })).toMatchObject({ ok: false, error: expect.stringMatching(/review it again/) });
    expect(approveLocalZeroPrice({ providerId: 'openai', modelId: 'gpt-5.6-terra', versionKey: 'x', actor: 'operator' })).toMatchObject({ ok: false });
    const r = approveLocalZeroPrice({ providerId: LOC, modelId: MODEL, versionKey: priceKey(), actor: 'operator' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(currentPricing(getStoredModel(LOC, MODEL)!.record)).toMatchObject({ state: 'CURRENT', record: { approval: 'APPROVED', source: 'route-import:local-runtime' } });
    expect(approveLocalZeroPrice({ providerId: LOC, modelId: MODEL, versionKey: priceKey(), actor: 'operator' })).toMatchObject({ ok: false, error: expect.stringMatching(/already approved/) });
  });

  it('a local route cannot claim a publisher route\'s version; an operator-defined open-weight version is accepted', () => {
    ensureRegistry();
    const publisherVersion = (getDatabase().prepare("SELECT canonical_version_id FROM registry_versions WHERE defined_by LIKE 'route:%' LIMIT 1").get() as any)?.canonical_version_id;
    if (publisherVersion) expect(approveRouteMapping({ providerId: LOC, modelId: MODEL, canonicalVersionId: publisherVersion, actor: 'operator' })).toMatchObject({ ok: false, error: expect.stringMatching(/cannot claim/) });
    expect(approveRouteMapping({ providerId: LOC, modelId: MODEL, canonicalVersionId: 'qwen/qwen2.5-coder-14b', family: { familyId: 'qwen2.5-coder', displayName: 'Qwen2.5-Coder', publisher: 'qwen' }, actor: 'operator', evidence: { ollamaManifestDigest: 'sha256:test' } }).ok).toBe(true);
    expect(routeIdentity(LOC, MODEL)).toMatchObject({ resolved: true, canonicalVersionId: 'qwen/qwen2.5-coder-14b' });
    // Admitted (record + price reviewed), NOT enabled for production.
    expect(qualifyModel(LOC, MODEL, 'operator').ok).toBe(true);
    expect(evaluateModel(LOC, MODEL)!.blockers.map((b) => b.state)).toContain('QUALIFIED');
  });
});

describe('the qualification run — canonical path, $0, evidence only', () => {
  it('local OFF: every case is refused by the router, zero requests, nothing on the ledger', async () => {
    policy({ paid: false, local: false });
    const s = startQualificationRun({ providerId: LOC, modelId: MODEL, taskClass: 'literal_transformation', actor: 'operator' });
    if (!s.ok) throw new Error(s.error);
    const ex = await executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' });
    expect(ex.ok && ex.recorded).toBe(0);
    expect(ex.ok && ex.refused.length).toBe(6);
    expect(ex.ok && ex.refused[0].reason).toMatch(/LOCAL_EXECUTION_DISABLED/);
    expect(chatRequests()).toHaveLength(0);
    expect((getDatabase().prepare("SELECT COUNT(*) AS n FROM provider_usage WHERE correlation_id = ?").get(s.runId) as any).n).toBe(0);
  });

  it('paid OFF + local ON: six cases, each routed, guarded, $0-ledgered, reviewed and receipted — PASSED, and still NOT a production qualification', async () => {
    policy({ paid: false, local: true });
    const s = startQualificationRun({ providerId: LOC, modelId: MODEL, taskClass: 'literal_transformation', actor: 'operator' });
    if (!s.ok) throw new Error(s.error);
    const ex = await executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' });
    if (!ex.ok) throw new Error(ex.error);
    expect(ex.refused).toEqual([]);
    expect(ex.stoppedOnUnknown).toBeNull();
    expect(ex.recorded).toBe(6);
    // Exactly six chat requests, no credential, one per case, never repeated.
    expect(chatRequests()).toHaveLength(6);
    expect(chatRequests().every((r) => r.auth === undefined && r.body.model === MODEL)).toBe(true);
    const db = getDatabase();
    for (const c of ex.cases) {
      expect(c.pass, `${c.caseId}#${c.repetition}: ${c.output}`).toBe(true);
      const d = getDecision(c.decisionId!)!;
      expect(d).toMatchObject({ outcome: 'SELECTED', mode: 'PINNED_ROUTE', qualificationRunId: s.runId, guardian: { status: 'SAFE' } });
      expect(d.selected).toMatchObject({ providerId: LOC, modelId: MODEL, routeKind: 'LOCAL' });
      const row = db.prepare('SELECT * FROM provider_usage WHERE usage_id = ?').get(c.usageId) as any;
      expect(row).toMatchObject({ provider: LOC, model: MODEL, status: 'SUCCESS', routing_decision_id: c.decisionId, correlation_id: s.runId, call_site: 'registry.qualification' });
      expect(Number(row.estimated_cost_usd)).toBe(0);
      expect(Number(row.actual_cost_usd)).toBe(0);
      const review = db.prepare('SELECT * FROM quality_reviews WHERE review_id = ?').get(c.reviewId) as any;
      expect(review).toMatchObject({ decision: 'VERIFIED', reviewer: 'Guardian-Aegis-Qualification-v1' });
      const receipt = db.prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(c.receiptId) as any;
      expect(verifyReceipt(receipt)).toBe(true);
      expect(JSON.parse(receipt.payload_json)).toMatchObject({ outcome: 'COMPLETED', qualificationRunId: s.runId, routingDecisionId: c.decisionId, usageId: c.usageId, aegisDecision: 'VERIFIED' });
    }
    // No artifact, no memory: evidence is not knowledge.
    expect((db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE task_id LIKE 'qcase:%'").get() as any).n).toBe(0);
    expect(evaluateRun(s.runId)).toMatchObject({ ok: true, status: 'PASSED', quality: 1, reliability: 1 });
    // Evaluation passed ≠ route authorized.
    expect(listQualifications({ providerId: LOC, modelId: MODEL }).filter((q) => q.state === 'VALID')).toHaveLength(0);
    const r = requirementsFor({ taskClass: 'literal_transformation', inputChars: 30 });
    if ('error' in r) throw new Error(r.error);
    const prod = routeTask({ workspaceId: WS, requirements: r, constraints: { pinnedRoute: { providerId: LOC, modelId: MODEL } }, persist: false });
    expect(prod.selected).toBeNull();
    expect(prod.candidates.find((c) => c.providerId === LOC && c.modelId === MODEL)!.disqualified.map((x) => x.code)).toEqual(expect.arrayContaining(['NOT_QUALIFIED', 'MODEL_NOT_ENABLED']));
    // Re-executing the run is refused (it is no longer OPEN) and sends nothing.
    const before = chatRequests().length;
    expect(await executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' })).toMatchObject({ ok: false });
    expect(chatRequests()).toHaveLength(before);
    expect(getSpendPolicy().paidExecutionEnabled).toBe(false);
  });

  it('a wrong answer fails its case (receipt says VERIFICATION_FAILED), is not retried, and the run FAILS', async () => {
    policy({ paid: false, local: true });
    mode = 'wrong-on-2';
    const s = startQualificationRun({ providerId: LOC, modelId: MODEL, taskClass: 'literal_transformation', actor: 'operator' });
    if (!s.ok) throw new Error(s.error);
    const ex = await executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' });
    if (!ex.ok) throw new Error(ex.error);
    expect(chatRequests()).toHaveLength(6);
    const bad = ex.cases.filter((c) => !c.pass);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ caseId: 'lit-2', repetition: 1, output: 'Sure! ROUTE READY', aegisDecision: 'FAILED' });
    const receipt = getDatabase().prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(bad[0].receiptId) as any;
    expect(JSON.parse(receipt.payload_json).outcome).toBe('VERIFICATION_FAILED');
    expect(evaluateRun(s.runId)).toMatchObject({ ok: true, status: 'FAILED' });
    expect(getRun(s.runId).status).toBe('FAILED');
  });

  it('an outcome that may have been processed (timeout after dispatch) stops the run: no further case is sent, nothing is retried', async () => {
    policy({ paid: false, local: true });
    mode = 'hang';
    const s = startQualificationRun({ providerId: LOC, modelId: MODEL, taskClass: 'literal_transformation', actor: 'operator' });
    if (!s.ok) throw new Error(s.error);
    const pending = executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' });
    // Wait until the first case is on the wire, then drop the connection mid-request.
    for (let t = 0; t < 100 && chatRequests().length === 0; t++) await new Promise((r) => setTimeout(r, 20));
    expect(chatRequests()).toHaveLength(1);
    server.closeAllConnections?.();
    const ex = await pending;
    if (!ex.ok) throw new Error(ex.error);
    // The run stopped on the ambiguous outcome: nothing recorded, nothing else sent.
    expect(ex.stoppedOnUnknown).toMatchObject({ caseId: 'lit-1', repetition: 1 });
    expect(ex.cases).toHaveLength(0);
    expect(chatRequests()).toHaveLength(1);
    const rows = getDatabase().prepare('SELECT usage_id, status FROM provider_usage WHERE correlation_id = ?').all(s.runId) as any[];
    expect(rows).toHaveLength(1);
    expect(['UNKNOWN', 'TIMEOUT_AFTER_DISPATCH']).toContain(rows[0].status);
    expect(ex.stoppedOnUnknown!.usageId).toBe(rows[0].usage_id);
    // Executing again never re-sends the ambiguous case (its ledger key exists).
    mode = 'echo';
    const again = await executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' });
    if (!again.ok) throw new Error(again.error);
    expect(again.refused.find((r) => r.caseId === 'lit-1' && r.repetition === 1)?.reason).toMatch(/ALREADY_DISPATCHED/);
    policy({ paid: false, local: false });
  });
});
