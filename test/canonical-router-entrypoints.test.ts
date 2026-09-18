import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// CANONICAL ROUTER CLOSURE INVARIANTS.
//
//   * every execution entry point reaches the canonical router, and an
//     unqualified route receives ZERO requests;
//   * qualification is task-specific; price is optimised only among
//     qualified routes; free-but-unqualified routes are rejected;
//   * a governed local $0 route runs while paid execution is OFF — with a
//     ledger row, routing decision, Aegis review and signed receipt — and
//     nothing positive-cost does;
//   * a progressing narrative continues past 2 and past 8 segments; a
//     cycling one pauses for replanning, and nothing written is discarded.
//
// Every provider is SYNTHETIC and speaks the OpenAI-compatible chat protocol
// to ONE local HTTP double that counts requests. No real provider is contacted.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-entry-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'entry.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'e'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('entrypoints');
import { writeOllamaModel, ollamaTagsBody } from './helpers/ollama-fixture';

import { getDatabase, getTaskReceipts, verifyReceipt, getTaskWithHistory } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { qualifyModel, enableModel } from '../lib/registry';
import { importManifest } from '../lib/registry/store';
import { approveRouteMapping } from '../lib/registry/identity';
import { insertQualificationForTest, resolveTaskClass, listQualifications } from '../lib/registry/qualification';
import { routeTask, requirementsFor, setWorkspaceRouting } from '../lib/registry/router';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureUsageTable, listUsageForKey } from '../lib/spend/ledger';
import { invalidateProviderEndpointCache } from '../lib/spend/network-guard';
import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import { routedModelCall, previewRoutedCall } from '../lib/fabric/routed-call';
import { getContinuity, listSegments, listCheckpoints } from '../lib/continuity/controller';
import { continuityTickForScheduler, resetResumeThrottleForTests, resumeByOperator } from '../lib/continuity/resume';
import { generateGroundedReply } from '../lib/conversation/llm';
import { askGrounded } from '../lib/aeo/geo-probe';

const WS = 'ws-entry';
const PUB = 'entry-pub';
const AGG = 'entry-agg';
const LOC = 'entry-local';

// ---- one provider double ------------------------------------------------------
type Mode = 'ok' | 'progress' | 'cycle';
const mode: Record<string, Mode> = { pub: 'ok', agg: 'ok', loc: 'ok' };
let progressStopAt = 10;
let requests: Array<{ route: string; model: string; content: string }> = [];
let server: http.Server;

function progressText(n: number): string {
  // Unique words per segment: no shingle can repeat an earlier one.
  return `Section ${n} ` + Array.from({ length: 14 }, (_, i) => `topic${n}w${i}`).join(' ') + ' ';
}

beforeAll(async () => {
  getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Entry');
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // The local runtime's model list (metadata only; the substance runtime check). Not an inference request.
      if (req.method === 'GET' && req.url === '/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(ollamaTagsBody(['loc-1'])); }
      const route = (req.url || '').split('/')[1];
      let p: any = {}; try { p = JSON.parse(body || '{}'); } catch {}
      const content = (p?.messages ?? []).map((m: any) => String(m?.content ?? '')).join('\n');
      requests.push({ route, model: p.model, content });
      const n = requests.filter((r) => r.route === route).length;
      let text = 'A complete answer.'; let finish = 'stop';
      if (mode[route] === 'progress') { text = progressText(n); finish = n >= progressStopAt ? 'stop' : 'length'; }
      if (mode[route] === 'cycle') { text = 'The store opens at nine and the delivery area covers the whole town and its suburbs.'; finish = 'length'; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `e-${requests.length}`, model: p.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  process.env.ENTRY_PUB_BASE_URL = `http://127.0.0.1:${port}/pub/v1`;
  process.env.ENTRY_AGG_BASE_URL = `http://127.0.0.1:${port}/agg/v1`;
  process.env.ENTRY_LOCAL_BASE_URL = `http://127.0.0.1:${port}/loc/v1`;
  process.env.ENTRY_PUB_API_KEY = 'sk-entry-pub-0000000000000000000000';
  process.env.ENTRY_AGG_API_KEY = 'sk-entry-agg-0000000000000000000000';
  installRoutes();
});

afterAll(async () => {
  for (const k of ['ENTRY_PUB_BASE_URL', 'ENTRY_AGG_BASE_URL', 'ENTRY_LOCAL_BASE_URL', 'ENTRY_PUB_API_KEY', 'ENTRY_AGG_API_KEY']) delete process.env[k];
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  requests = [];
  mode.pub = 'ok'; mode.agg = 'ok'; mode.loc = 'ok';
  progressStopAt = 10;
  policy({ paid: true, local: true });
  clearQualifications();
  setWorkspaceRouting(WS, {}, 'test');
  invalidateProviderEndpointCache();
  resetResumeThrottleForTests();
  getDatabase().exec("DELETE FROM runtime_events WHERE target_type = 'provider'");
});

// ---- fixtures ------------------------------------------------------------------
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const price = (input: number, output: number, approval = 'APPROVED') => ({
  currency: 'USD', unit: 'tokens', rates: { input, output, cachedInput: null }, reasoningTokens: 'BILLED_AS_OUTPUT', tiers: [], toolCharges: [], modalityCharges: [],
  effectiveFrom: iso(now - 86_400_000), effectiveUntil: null, source: 'synthetic fixture', verifiedAt: iso(now - 3_600_000), staleAfter: iso(now + 30 * 86_400_000), approval,
});
const model = (modelId: string, over: Record<string, unknown> = {}) => ({
  modelId, aliases: [], displayName: modelId, lifecycle: 'ACTIVE', releaseDate: null, deprecationDate: null, shutdownDate: null,
  limits: { contextTokens: 128000, outputTokens: 4096 }, modalities: { input: ['text'], output: ['text'] },
  capabilities: [
    { id: 'text.input', supported: true, source: 'fixture', verification: 'PUBLISHER_ASSERTED', effectiveDate: null },
    { id: 'text.output', supported: true, source: 'fixture', verification: 'PUBLISHER_ASSERTED', effectiveDate: null },
  ],
  supportedParameters: ['max_tokens'], outputContracts: ['NARRATIVE', 'LITERAL', 'JSON_OBJECT'], pricing: [price(2, 4)],
  adapterCompatibility: { protocol: 'openai.chat_completions', minAdapterVersion: '1.0.0' }, restrictions: { regions: [], compliance: [] },
  ...over,
});
function manifest(providerId: string, models: any[], over: Record<string, unknown> = {}) {
  const env = providerId.toUpperCase().replace(/-/g, '_');
  return {
    schemaVersion: 'synthos.registry/v1', manifestVersion: 'entry-1',
    provenance: { publisher: 'synthos-test-fixtures', generatedAt: iso(now) },
    provider: {
      providerId, displayName: providerId, protocol: 'openai.chat_completions', adapterVersion: '1.0.0',
      approvedHosts: [`api.${providerId}.example`], defaultBaseUrl: `https://api.${providerId}.example/v1`, baseUrlEnvVar: `${env}_BASE_URL`,
      auth: { type: 'BEARER', credentialSlot: null, envVars: [`${env}_API_KEY`] },
      billing: 'METERED', restrictions: { regions: [], compliance: [] },
      ...over,
    },
    models,
  };
}

function installRoutes(): void {
  const a = importManifest(manifest(PUB, [
    model('pub-large', { family: { familyId: 'entry-family', displayName: 'Entry family', publisher: PUB }, canonicalVersionId: `${PUB}/pub-large`, pricing: [price(5, 10)] }),
    model('pub-cheap', { pricing: [price(0.1, 0.2)] }),
  ]), { source: 'PLUGIN', actor: 'test' });
  expect(a.ok, a.errors?.join('; ')).toBe(true);
  // An aggregator offering priced at $0 — FREE, but not LOCAL.
  const b = importManifest(manifest(AGG, [
    model(`${PUB}/pub-large`, { canonicalVersionId: `${PUB}/pub-large`, pricing: [price(0, 0)] }),
  ], { routeKind: 'AGGREGATOR' }), { source: 'PLUGIN', actor: 'test' });
  expect(b.ok, b.errors?.join('; ')).toBe(true);
  const c = importManifest(manifest(LOC, [
    model('loc-1', { pricing: [price(0, 0)] }),
    // A local model whose price record nobody has approved: unknown pricing is never free.
    model('loc-unpriced', { pricing: [price(0, 0, 'UNREVIEWED')] }),
  ], {
    routeKind: 'LOCAL', auth: { type: 'NONE', credentialSlot: null, envVars: [] }, billing: 'FREE_LOCAL', privacyClass: 'LOCAL_ONLY',
    approvedHosts: ['127.0.0.1'], defaultBaseUrl: 'http://127.0.0.1:9/v1',
  }), { source: 'PLUGIN', actor: 'test' });
  expect(c.ok, c.errors?.join('; ')).toBe(true);
  for (const [p, m] of [[PUB, 'pub-large'], [PUB, 'pub-cheap'], [AGG, `${PUB}/pub-large`], [LOC, 'loc-1'], [LOC, 'loc-unpriced']]) {
    qualifyModel(p, m, 'test');
    enableModel(p, m, 'test');
  }
  expect(approveRouteMapping({ providerId: AGG, modelId: `${PUB}/pub-large`, canonicalVersionId: `${PUB}/pub-large`, actor: 'operator' } as any).ok).toBe(true);
  expect(approveRouteMapping({ providerId: LOC, modelId: 'loc-1', canonicalVersionId: 'entry-open/loc-1', family: { familyId: 'entry-open', displayName: 'Open', publisher: 'entry-open' }, actor: 'operator', substance: writeOllamaModel('loc-1') }).ok).toBe(true);
}

function policy(p: { paid: boolean; local: boolean; model?: boolean }) {
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  const on = { enabled: true, dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 };
  const r = saveSpendPolicy({
    ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: p.paid, localExecutionEnabled: p.local, modelExecutionEnabled: p.model ?? true,
    global: { dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 },
    providers: { ...Object.fromEntries(Object.keys(DEFAULT_SPEND_POLICY.providers).map((x) => [x, off])), [PUB]: on, [AGG]: on, [LOC]: on },
    workspaceDefault: { dailyUsd: 10, maxConcurrent: 5 },
    task: { maxEstimatedUsd: 1, maxInputChars: 200_000, maxOutputTokens: 1000, maxTier: 'PREMIUM' },
    approvalThresholdUsd: 1,
  }, 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
}

const qualify = (providerId: string, modelId: string, taskClass: string, quality = 0.95, reliability = 0.95) => insertQualificationForTest({ providerId, modelId, taskClass, quality, reliability });
const clearQualifications = () => { listQualifications(); getDatabase().exec('DELETE FROM registry_qualifications'); };
let seq = 0;
const key = (s: string) => `entry-${s}-${Date.now()}-${seq++}`;

async function runTask(extra: Record<string, unknown> = {}) {
  const taskId = `et-${Date.now()}-${seq++}`;
  const r = await executeAgentTask({ taskId, taskTitle: 'Entry task', description: 'Write a long description of the store.', assignedAgent: 'scribe', assignedModel: '', spendIdempotencyKey: `ek-${taskId}`, ...extra } as any, WS, createExecutionContext({ workspaceId: WS }));
  return { taskId, result: r as { status: number; body: any } };
}

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// ============================================================================
// 1. EVERY ENTRY POINT REACHES THE CANONICAL ROUTER
// ============================================================================

// Each execution-capable entry point, where it lives, and the call site it
// routes under. The call site selects the task class (registry data).
const ENTRY_POINTS: Array<{ callSite: string; file: string }> = [
  { callSite: 'api.generate', file: 'server.ts' },
  { callSite: 'jarvis.command', file: 'server.ts' },
  { callSite: 'youtube.audit', file: 'server.ts' },
  { callSite: 'youtube.ingest', file: 'server.ts' },
  { callSite: 'orchestrator.decompose', file: 'server.ts' },
  { callSite: 'graph.node', file: 'server.ts' },
  { callSite: 'admin.provider_test', file: 'server.ts' },
  { callSite: 'admin.e2e_test', file: 'server.ts' },
  { callSite: 'concierge.reply', file: 'lib/conversation/llm.ts' },
  { callSite: 'skill.model', file: 'lib/skill-execution.ts' },
  { callSite: 'development.review', file: 'lib/development-loop.ts' },
  { callSite: 'research.synthesis', file: 'lib/fabric/research.ts' },
  { callSite: 'credential.verify.openai', file: 'lib/model-credentials.ts' },
  { callSite: 'aeo.geo_probe', file: 'lib/aeo/geo-probe.ts' },
  { callSite: 'aeo.public_check', file: 'lib/aeo/public-check.ts' },
];

describe('every execution entry point reaches the canonical router', () => {
  it('each entry point dispatches only through routedModelCall / previewRoutedCall, and its call site maps to a registered task class', () => {
    for (const e of ENTRY_POINTS) {
      const src = read(e.file);
      const site = e.callSite.startsWith('credential.verify.') ? 'credential.verify.${provider}' : e.callSite;
      expect(src.includes(site), `${e.callSite} is named in ${e.file}`).toBe(true);
      expect(/routedModelCall\(|previewRoutedCall\(|askGrounded\(/.test(src), `${e.file} uses the routed call`).toBe(true);
      if (e.callSite !== 'graph.node') expect(resolveTaskClass({ callSite: e.callSite }), `${e.callSite} has a task class`).toBeTruthy();
    }
    // Kernel tasks and Antigravity go through the router too.
    expect(read('lib/continuity/segment-runner.ts')).toMatch(/routeTask\(/);
    expect(read('lib/external-executions.ts')).toMatch(/routeTask\(/);
  });

  it('no direct provider dispatch exists outside the fabric adapters (TTS is the one documented non-model exception)', () => {
    const files = ['server.ts', ...walk('lib'), ...walk('src')];
    const DISPATCH = /new GoogleGenAI|\.models\.generateContent\(|generateViaOpenAI\(|generateViaGemini\(|guardedGeminiGenerate\(/;
    const ALLOWED = new Set(['lib/fabric/model-gemini.ts', 'lib/fabric/model-openai.ts', 'lib/registry/protocols.ts', 'lib/spend/adapters.ts']);
    const offenders = files.filter((f) => !ALLOWED.has(f) && DISPATCH.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
    // The legacy name-prefix router is gone.
    expect(fs.existsSync(path.join(process.cwd(), 'lib/model-router.ts'))).toBe(false);
    expect(files.filter((f) => /from ['"].*model-router['"]/.test(read(f)))).toEqual([]);
  });

  it('production never sets the conversation dispatch seam', () => {
    // The seam is only ever passed THROUGH (params.callModel) — nothing in
    // production code supplies an implementation for it.
    expect(read('server.ts')).not.toMatch(/callModel\s*:/);
    for (const f of walk('lib')) {
      for (const m of stripComments(read(f)).matchAll(/callModel\s*:\s*([^,}\n]+)/g)) {
        expect(m[1].trim(), f).toMatch(/^(params\.callModel( as any)?|\(model: string)/);
      }
    }
  });

  it('with no qualification, every call site is refused NO_QUALIFIED_ROUTE and the provider receives ZERO requests', async () => {
    for (const e of ENTRY_POINTS) {
      const r = await routedModelCall({ callSite: e.callSite, workspaceId: WS, prompt: 'hello', idempotencyKey: key(e.callSite), outputContract: e.callSite === 'graph.node' ? 'NARRATIVE' : undefined });
      expect(r.ok, e.callSite).toBe(false);
      if (!r.ok) expect(r.code, e.callSite).toBe('NO_QUALIFIED_ROUTE');
      expect(previewRoutedCall({ callSite: e.callSite, workspaceId: WS }).ok).toBe(false);
    }
    expect(requests).toHaveLength(0);
  });

  it('the real lib entry points refuse with zero requests too (conversation, AEO)', async () => {
    const reply = await generateGroundedReply({ prompt: { system: 's', user: 'u' } as any, evidence: [], spend: { workspaceId: WS, idempotencyKey: key('conv') } });
    expect(reply.ok).toBe(false);
    await expect(askGrounded('who sells mattresses', { callSite: 'aeo.geo_probe', workspaceId: WS, maxOutputTokens: 200 })).rejects.toThrow();
    const { taskId, result } = await runTask();
    expect(result.body.status).not.toBe('DONE');
    expect(getContinuity(taskId)?.state ?? result.body.status).toMatch(/PAUSED|NOT_CONFIGURED|NO_QUALIFIED/);
    expect(requests).toHaveLength(0);
  });

  it('once a route is qualified for the call site\'s task class, the call runs on it — one request, one ledger row naming the decision', async () => {
    const tc = resolveTaskClass({ callSite: 'api.generate' })!.taskClassId;
    qualify(PUB, 'pub-large', tc);
    const k = key('gen');
    const r = await routedModelCall({ callSite: 'api.generate', workspaceId: WS, messages: [{ role: 'user', content: 'hello' }], idempotencyKey: k });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.providerId).toBe(PUB);
    expect(requests).toHaveLength(1);
    const rows = listUsageForKey(k);
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).routing_decision_id).toBe(r.decision.decisionId);
  });
});

// ============================================================================
// 2. QUALIFICATION FIRST, PRICE SECOND
// ============================================================================
describe('qualification is task-specific and comes before price', () => {
  const req = (taskClass: string) => { const r = requirementsFor({ taskClass, inputChars: 400 }); if ('error' in r) throw new Error(r.error); return r; };

  it('a route qualified for content generation is not routable for code review', () => {
    qualify(PUB, 'pub-large', 'content_generation');
    expect(routeTask({ workspaceId: WS, requirements: req('content_generation'), persist: false }).selected?.modelId).toBe('pub-large');
    const review = routeTask({ workspaceId: WS, requirements: req('code_review'), persist: false });
    expect(review.selected).toBeNull();
    expect(review.candidates.find((c) => c.modelId === 'pub-large')!.disqualified.map((d) => d.code)).toContain('NOT_QUALIFIED');
  });

  it('the cheapest route is never chosen while it is unqualified — cost ranks only qualified routes', () => {
    qualify(PUB, 'pub-large', 'content_generation');
    const d = routeTask({ workspaceId: WS, requirements: req('content_generation'), constraints: { mode: 'LOWEST_COST_QUALIFIED' }, persist: false });
    expect(d.selected?.modelId).toBe('pub-large');
    expect(d.candidates.find((c) => c.modelId === 'pub-cheap')!.disqualified.map((x) => x.code)).toContain('NOT_QUALIFIED');
    // Qualify the cheap one: now, and only now, price decides.
    qualify(PUB, 'pub-cheap', 'content_generation');
    expect(routeTask({ workspaceId: WS, requirements: req('content_generation'), constraints: { mode: 'LOWEST_COST_QUALIFIED' }, persist: false }).selected?.modelId).toBe('pub-cheap');
  });

  it('a free route that is not qualified is rejected, even in FREE_WHEN_QUALIFIED mode', () => {
    qualify(PUB, 'pub-large', 'content_generation');
    const d = routeTask({ workspaceId: WS, requirements: req('content_generation'), constraints: { mode: 'FREE_WHEN_QUALIFIED', permittedAggregators: [AGG] }, persist: false });
    expect(d.selected?.providerId).toBe(PUB);
    for (const c of d.candidates.filter((x) => x.providerId === LOC || x.providerId === AGG)) expect(c.disqualified.map((x) => x.code)).toContain('NOT_QUALIFIED');
  });
});

// ============================================================================
// 3. LOCAL $0 VERSUS PAID — one policy authority, three permissions
// ============================================================================
describe('free/local versus paid', () => {
  it('paid OFF + local ON: an approved $0 LOCAL route runs, fully governed — ledger row, decision, Aegis review, signed receipt', async () => {
    policy({ paid: false, local: true });
    qualify(LOC, 'loc-1', 'content_generation');
    const { taskId, result } = await runTask();
    expect(result.body.status).toBe('DONE');
    expect(requests.map((r) => r.route)).toEqual(['loc']);
    const rows = getDatabase().prepare('SELECT * FROM provider_usage WHERE task_id = ?').all(taskId) as any[];
    const row = rows.find((x: any) => x.provider === LOC) as any;
    expect(row, 'a $0 local call still writes a ledger row').toBeTruthy();
    expect(Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0)).toBe(0);
    expect(row.routing_decision_id).toBeTruthy();
    const reviews = (getDatabase().prepare('SELECT COUNT(*) AS n FROM quality_reviews WHERE task_id = ?').get(taskId) as any).n;
    expect(reviews, 'Aegis reviewed the $0 output').toBeGreaterThan(0);
    const receipts = getTaskReceipts(taskId);
    expect(receipts.length).toBeGreaterThan(0);
    expect(verifyReceipt(receipts[0])).toBe(true);
  });

  it('paid OFF blocks every positive-cost call with zero requests', async () => {
    policy({ paid: false, local: true });
    qualify(PUB, 'pub-large', 'conversation');
    const r = await routedModelCall({ callSite: 'api.generate', workspaceId: WS, prompt: 'hi', idempotencyKey: key('paidoff') });
    expect(r.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('a $0 AGGREGATOR offering is not local: paid OFF still blocks it', async () => {
    policy({ paid: false, local: true });
    qualify(AGG, `${PUB}/pub-large`, 'conversation');
    const r = await routedModelCall({ callSite: 'api.generate', workspaceId: WS, prompt: 'hi', idempotencyKey: key('agg'), routing: { permittedAggregators: [AGG] } });
    expect(r.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('unknown (unapproved) pricing is never treated as free', async () => {
    policy({ paid: false, local: true });
    qualify(LOC, 'loc-unpriced', 'conversation');
    const r = await routedModelCall({ callSite: 'api.generate', workspaceId: WS, prompt: 'hi', idempotencyKey: key('unpriced'), model: `${LOC}/loc-unpriced` });
    expect(r.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('local OFF refuses the local route; model execution OFF refuses everything; workspace policy can prohibit local', async () => {
    qualify(LOC, 'loc-1', 'conversation');
    policy({ paid: false, local: false });
    expect((await routedModelCall({ callSite: 'api.generate', workspaceId: WS, prompt: 'hi', idempotencyKey: key('locoff') })).ok).toBe(false);
    policy({ paid: true, local: true, model: false });
    expect((await routedModelCall({ callSite: 'api.generate', workspaceId: WS, prompt: 'hi', idempotencyKey: key('modeloff') })).ok).toBe(false);
    policy({ paid: false, local: true });
    setWorkspaceRouting(WS, { prohibited: [LOC] }, 'test');
    expect((await routedModelCall({ callSite: 'api.generate', workspaceId: WS, prompt: 'hi', idempotencyKey: key('prohibited') })).ok).toBe(false);
    expect(requests).toHaveLength(0);
    // Sanity: with nothing prohibited the same local route does run.
    setWorkspaceRouting(WS, {}, 'test');
    expect((await routedModelCall({ callSite: 'api.generate', workspaceId: WS, prompt: 'hi', idempotencyKey: key('localok') })).ok).toBe(true);
    expect(requests.map((r) => r.route)).toEqual(['loc']);
  });
});

// ============================================================================
// 4. PROGRESS-AWARE CONTINUATION — no arbitrary segment count
// ============================================================================
describe('progress-aware continuation', () => {
  beforeEach(() => {
    qualify(PUB, 'pub-large', 'content_generation');
    setWorkspaceRouting(WS, { prohibited: [AGG, LOC] }, 'test');
  });

  it('a narrative that keeps making progress continues past 2 AND past 8 segments, checkpoints every continuation, and pays once per segment', async () => {
    mode.pub = 'progress';
    progressStopAt = 11;
    const { taskId, result } = await runTask();
    expect(result.body.status).toBe('DONE');
    const segs = listSegments(taskId);
    expect(segs).toHaveLength(11);
    expect(segs.slice(0, 10).every((s) => s.status === 'INCOMPLETE')).toBe(true);
    expect(segs[10].status).toBe('COMPLETED');
    // One provider request per segment — no duplicate call.
    expect(requests).toHaveLength(11);
    // A signed checkpoint before every continuation; the receipt names the whole chain.
    const cks = listCheckpoints(taskId);
    expect(cks.length).toBeGreaterThanOrEqual(10);
    expect(cks.every((c) => c.verified)).toBe(true);
    const payload = JSON.parse(getTaskReceipts(taskId)[0].payload_json);
    expect(payload.segmentIds).toEqual(segs.map((s) => s.segmentId));
    // Nothing written was lost.
    for (let n = 1; n <= 11; n++) expect(String(result.body.outputs)).toContain(`Section ${n} `);
  });

  it('a cycling narrative pauses PAUSED_AWAITING_REPLAN — work kept, not auto-resumed, resumable by an operator via the existing scheduler path', async () => {
    mode.pub = 'cycle';
    const { taskId, result } = await runTask();
    expect(result.body.status).toBe('PAUSED_AWAITING_REPLAN');
    const segs = listSegments(taskId);
    expect(segs.map((s) => s.status)).toEqual(['INCOMPLETE', 'NO_PROGRESS', 'NO_PROGRESS']);
    expect(requests).toHaveLength(3);
    expect(getTaskWithHistory(taskId).task!.status).toBe('PAUSED_AWAITING_REPLAN');
    // The scheduler sweep never resumes a stalled task on its own (it would pay to cycle again).
    resetResumeThrottleForTests();
    expect(continuityTickForScheduler().resumed).not.toContain(taskId);
    expect(requests).toHaveLength(3);
    // An operator may resume it; that resets the no-progress count and dispatches nothing itself.
    const r = resumeByOperator(taskId, 'operator');
    expect(r.ok, r.reason).toBe(true);
    expect(getTaskWithHistory(taskId).task!.status).toBe('READY');
    expect(requests).toHaveLength(3);
  });
});

// ============================================================================
describe('no live provider contact from this file', () => {
  it('every request went to the local double', () => {
    // The double is the only server; the registry routes hold loopback base URLs only.
    for (const k of ['ENTRY_PUB_BASE_URL', 'ENTRY_AGG_BASE_URL', 'ENTRY_LOCAL_BASE_URL']) expect(process.env[k]).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});

// ---- helpers --------------------------------------------------------------------
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(rel)); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
