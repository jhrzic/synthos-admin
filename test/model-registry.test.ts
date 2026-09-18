import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// PROVIDER & MODEL REGISTRY — installation ≠ permission, zero-cost catalog,
// plugin-driven providers, identity propagation, endpoint security, explicit
// evaluation.
//
// Every provider and model below is SYNTHETIC. The one that executes speaks
// the OpenAI-compatible chat-completions protocol (a DeepSeek-style provider)
// and is added purely by a signed manifest: its id appears nowhere in lib/,
// server.ts or src/. Its "endpoint" is a local HTTP double that counts every
// request. Nothing here contacts a real provider.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-registry-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'registry.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'r'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('registry');

import { getDatabase, getTaskReceipts, verifyReceipt, getTaskWithHistory, getTaskQualityReviews } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import {
  listModelViews, listProviderViews, evaluateModel, resolveRoute, qualifyModel, enableModel, disableModel, registerModelViaAdmin,
} from '../lib/registry';
import {
  importManifest, addTrustedKey, modelHistory, resolveModelIdentity, setWorkspacePolicy, getStoredModel,
} from '../lib/registry/store';
import { validateManifest, signManifest, normalizeCapabilityId } from '../lib/registry/schema';
import { validateEndpointUrl, resolveProviderEndpoint, loopbackProvidersAllowed } from '../lib/registry/endpoints';
import { PROTOCOL_ADAPTERS } from '../lib/registry/protocols';
import { BUNDLED_PLUGINS } from '../lib/registry/plugins';
import { runManualDiscovery, runManualPricingRefresh, isManualDiscoveryEnabled } from '../lib/registry/discovery';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureUsageTable, listUsageForKey } from '../lib/spend/ledger';
import { guardedPaidCall } from '../lib/spend/guard';
import { invalidateProviderEndpointCache, PaidEndpointBlockedError } from '../lib/spend/network-guard';
import { insertQualificationForTest, listTaskClasses } from '../lib/registry/qualification';
import { getDecision } from '../lib/registry/router';
import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import { previewEvaluation, runEvaluation } from '../lib/fabric/evaluation';
import { generateViaOpenAI } from '../lib/fabric/model-openai';

const WS = 'ws-registry';
const PROVIDER = 'synthetic-chat';
const KEY = 'sk-synthetic-chat-test-000000000000';
const repo = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

// ---- provider double ------------------------------------------------------
let requests: Array<{ path: string; body: any; auth: string | undefined }> = [];
let reply: { content: string; finish: string | null } = { content: 'A complete narrative answer.', finish: 'stop' };
let provider: http.Server; let providerPort = 0;
let redirectTarget: http.Server; let redirectHits = 0; let redirectPort = 0;

// ---- signing --------------------------------------------------------------
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const price = (over: Record<string, unknown> = {}) => ({
  currency: 'USD', unit: 'tokens', rates: { input: 1, output: 2, cachedInput: null }, reasoningTokens: 'BILLED_AS_OUTPUT', tiers: [],
  toolCharges: [], modalityCharges: [], effectiveFrom: iso(now - 86_400_000), effectiveUntil: null, source: 'synthetic fixture',
  verifiedAt: iso(now - 3_600_000), staleAfter: iso(now + 30 * 86_400_000), approval: 'APPROVED', ...over,
});
const synModel = (modelId: string, over: Record<string, unknown> = {}) => ({
  modelId, aliases: [], displayName: `${modelId} (synthetic)`, lifecycle: 'ACTIVE', releaseDate: null, deprecationDate: null, shutdownDate: null,
  limits: { contextTokens: 128000, outputTokens: 4096 }, modalities: { input: ['text'], output: ['text'] },
  capabilities: [
    { id: 'text.input', supported: true, source: 'fixture', verification: 'PUBLISHER_ASSERTED', effectiveDate: null },
    { id: 'text.output', supported: true, source: 'fixture', verification: 'PUBLISHER_ASSERTED', effectiveDate: null },
    { id: 'thought_trace', supported: true, source: 'fixture', verification: 'PUBLISHER_ASSERTED', effectiveDate: null, detail: { maxDepth: 3 } },
  ],
  supportedParameters: ['max_tokens'], outputContracts: ['NARRATIVE', 'LITERAL', 'JSON_OBJECT'], pricing: [price()],
  adapterCompatibility: { protocol: 'openai.chat_completions', minAdapterVersion: '1.0.0' }, restrictions: { regions: [], compliance: [] },
  ...over,
});
function manifest(models: any[], version = 'syn-1', providerOver: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'synthos.registry/v1', manifestVersion: version,
    provenance: { publisher: 'synthos-test-fixtures', generatedAt: iso(now) },
    provider: {
      providerId: PROVIDER, displayName: 'Synthetic Chat', protocol: 'openai.chat_completions', adapterVersion: '1.0.0',
      approvedHosts: ['api.synthetic-chat.example'], defaultBaseUrl: 'https://api.synthetic-chat.example/v1', baseUrlEnvVar: 'SYNTHETIC_CHAT_BASE_URL',
      auth: { type: 'BEARER', credentialSlot: null, envVars: ['SYNTHETIC_CHAT_API_KEY'] }, billing: 'METERED', restrictions: { regions: [], compliance: [] },
      ...providerOver,
    },
    models,
  };
}
const signed = (m: any) => signManifest(m as any, PRIV, 'fixture-key');

function policy(paid: boolean) {
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  const r = saveSpendPolicy({
    ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: paid,
    global: { dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 },
    providers: { ...Object.fromEntries(Object.keys(DEFAULT_SPEND_POLICY.providers).map((p) => [p, off])), [PROVIDER]: { enabled: true, dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 } },
    workspaceDefault: { dailyUsd: 10, maxConcurrent: 5 },
    task: { maxEstimatedUsd: 1, maxInputChars: 200_000, maxOutputTokens: 1000, maxTier: 'PREMIUM' },
    approvalThresholdUsd: 1,
  }, 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
}

// Task-class qualification: these tests exercise the registry rails, so a
// model an operator admitted here is also qualified for every task class.
const qualifyForTasks = (modelId: string) => { for (const tc of listTaskClasses()) insertQualificationForTest({ providerId: PROVIDER, modelId, taskClass: tc.taskClassId }); };
const ledger = () => (getDatabase().prepare('SELECT COUNT(*) AS n FROM provider_usage').get() as any).n as number;
let seq = 0;
async function runTask(model: string, extra: Record<string, unknown> = {}) {
  const taskId = `reg-task-${Date.now()}-${seq++}`;
  const key = `reg-key-${taskId}`;
  const r = await executeAgentTask({ taskId, taskTitle: 'Registry task', description: 'Describe the result.', assignedAgent: 'scribe', assignedModel: model, spendIdempotencyKey: key, ...extra } as any, WS, createExecutionContext({ workspaceId: WS }));
  return { taskId, key, result: r };
}

beforeAll(async () => {
  getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Registry');
  provider = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed: any = null; try { parsed = JSON.parse(body || '{}'); } catch {}
      requests.push({ path: req.url || '', body: parsed, auth: req.headers.authorization });
      if ((req.url || '').startsWith('/redirect')) { res.writeHead(302, { Location: `http://127.0.0.1:${redirectPort}/v1/chat/completions` }); return res.end(); }
      const wantsJson = JSON.stringify(parsed?.messages || '').includes('verdict');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chat-${requests.length}`, model: parsed?.model,
        choices: [{ index: 0, message: { role: 'assistant', content: wantsJson ? '{"verdict":"APPROVE","rationale":"grounded"}' : reply.content }, ...(reply.finish ? { finish_reason: reply.finish } : {}) }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }));
    });
  });
  await new Promise<void>((r) => provider.listen(0, '127.0.0.1', () => r()));
  providerPort = (provider.address() as any).port;
  redirectTarget = http.createServer((req, res) => { redirectHits += 1; res.writeHead(200); res.end('{}'); });
  await new Promise<void>((r) => redirectTarget.listen(0, '127.0.0.1', () => r()));
  redirectPort = (redirectTarget.address() as any).port;
  process.env.SYNTHETIC_CHAT_BASE_URL = `http://127.0.0.1:${providerPort}/v1`;
  process.env.SYNTHETIC_CHAT_API_KEY = KEY;
  addTrustedKey('fixture-key', PUB, 'synthetic fixture publisher', 'test');
});

afterAll(async () => {
  delete process.env.SYNTHETIC_CHAT_BASE_URL; delete process.env.SYNTHETIC_CHAT_API_KEY;
  await new Promise<void>((r) => provider.close(() => r()));
  await new Promise<void>((r) => redirectTarget.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => { requests = []; reply = { content: 'A complete narrative answer.', finish: 'stop' }; invalidateProviderEndpointCache(); });

// ============================================================================
describe('manifests are data: validated, versioned, provenance-stamped', () => {
  it('every bundled provider plugin manifest validates, and none is synthetic', () => {
    for (const p of BUNDLED_PLUGINS) {
      const v = validateManifest(p.manifest);
      expect(v.ok, `${p.providerId}: ${(v as any).errors?.join('; ')}`).toBe(true);
      const text = JSON.stringify(p.manifest);
      expect(text).not.toMatch(/synthetic|synthos-test-fixtures/i);
    }
  });

  it('an unknown provider capability is retained under a namespace, with provenance, not discarded', () => {
    expect(normalizeCapabilityId(PROVIDER, 'thought_trace')).toBe('x.synthetic-chat.thought_trace');
    const r = importManifest(signed(manifest([synModel('syn-chat-0')])), { source: 'SIGNED_IMPORT', actor: 'test' });
    expect(r.ok, `${r.signatureStatus}: ${r.errors.join('; ')}`).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/thought_trace/);
    const cap = getStoredModel(PROVIDER, 'syn-chat-0')!.record.capabilities.find((c) => c.id === 'x.synthetic-chat.thought_trace')!;
    expect(cap).toMatchObject({ supported: true, detail: { maxDepth: 3 }, provenance: 'SIGNED_IMPORT', manifestVersion: 'syn-1', adapterVersion: '1.0.0', verification: 'PUBLISHER_ASSERTED' });
    expect(cap.lastUpdated).toBeTruthy();
  });

  it('one invalid model rejects the whole manifest — nothing partial is applied', () => {
    const bad = manifest([synModel('syn-ok'), synModel('syn-bad', { pricing: [price({ rates: { input: -1, output: 2, cachedInput: null } })] })], 'syn-bad');
    const r = importManifest(signed(bad), { source: 'SIGNED_IMPORT', actor: 'test' });
    expect(r.ok).toBe(false);
    expect(getStoredModel(PROVIDER, 'syn-ok')).toBeNull();
  });

  it('a JSON import must carry a valid signature from a trusted key', () => {
    const m = manifest([synModel('syn-unsigned')], 'syn-u');
    expect(importManifest(m, { source: 'SIGNED_IMPORT', actor: 'test' })).toMatchObject({ ok: false, signatureStatus: 'MISSING' });
    const tampered = signed(m); (tampered as any).models[0].displayName = 'changed after signing';
    expect(importManifest(tampered, { source: 'SIGNED_IMPORT', actor: 'test' })).toMatchObject({ ok: false, signatureStatus: 'INVALID' });
    const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(importManifest(signManifest(m as any, other, 'unknown-key'), { source: 'SIGNED_IMPORT', actor: 'test' })).toMatchObject({ ok: false, signatureStatus: 'UNTRUSTED_KEY' });
  });

  it('synthetic manifests are refused outside a test process — they never reach a production registry', () => {
    const saved = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };
    process.env.VITEST = 'false'; process.env.NODE_ENV = 'production';
    try {
      const r = importManifest(signed(manifest([synModel('syn-prod')], 'syn-prod')), { source: 'SIGNED_IMPORT', actor: 'test' });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/Synthetic test manifests/);
    } finally {
      process.env.VITEST = saved.VITEST; process.env.NODE_ENV = saved.NODE_ENV;
    }
  });
});

// ============================================================================
describe('zero-cost catalog: no inference, no external call, no ledger row', () => {
  it('importing, listing, evaluating and routing make zero network requests and write nothing to the ledger', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = ledger();
    importManifest(signed(manifest([synModel('syn-chat-1', { aliases: ['syn-chat-latest'] }), synModel('syn-chat-2')], 'syn-2')), { source: 'SIGNED_IMPORT', actor: 'test' });
    const views = listModelViews({ workspaceId: WS });
    listProviderViews();
    evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS });
    resolveRoute('synthetic-chat/syn-chat-latest');
    expect(views.some((v) => v.providerId === PROVIDER && v.modelId === 'syn-chat-1')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ledger()).toBe(before);
    expect(requests).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it('manual discovery and manual pricing refresh are OFF by default and refuse without touching anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(isManualDiscoveryEnabled()).toBe(false);
    expect(await runManualDiscovery('test')).toMatchObject({ ok: false, code: 'MANUAL_DISCOVERY_DISABLED' });
    expect(await runManualPricingRefresh('test')).toMatchObject({ ok: false, code: 'MANUAL_DISCOVERY_DISABLED' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('nothing refreshes the catalog at startup or on a timer', () => {
    const scheduler = repo('lib/fabric/scheduler.ts');
    expect(scheduler).not.toMatch(/refreshModelCatalog\(|refreshPricingCatalog\(/);
    const server = repo('server.ts');
    expect(server).not.toMatch(/refreshModelCatalog\(|refreshPricingCatalog\(/);
    expect(server).toContain('installBundledPlugins()');
  });

  it('the registry never places catalog data in a prompt: only the selected id and adapter parameters are sent', () => {
    for (const a of Object.values(PROTOCOL_ADAPTERS)) expect(a.requestParameters.length).toBeGreaterThan(0);
    for (const f of ['lib/fabric/kernel.ts', 'lib/fabric/scoped-verification.ts', 'lib/fabric/output-contract.ts']) {
      expect(repo(f), f).not.toMatch(/listModelViews\(|listStoredModels\(|listProviderViews\(/);
    }
  });
});

// ============================================================================
describe('installation is not permission', () => {
  it('a newly imported model is INSTALLED / UNQUALIFIED and cannot execute — the guard refuses with a ledger row, nothing is sent', async () => {
    policy(true);
    const v = evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!;
    expect(v.adminState).toBe('INSTALLED');
    expect(v.availability).toBe('UNQUALIFIED');
    expect(v.executable).toBe(false);
    // The router refuses it first (recorded decision; the task waits for a
    // qualified route — nothing is substituted)…
    const { key, result } = await runTask('synthetic-chat/syn-chat-1');
    expect(result.body.success).toBe(false);
    expect(result.body.status).toBe('PAUSED_AWAITING_QUALIFIED_CAPACITY');
    const decision = getDecision((result.body as any).routingDecision.decisionId)!;
    expect(decision.selected).toBeNull();
    expect(decision.candidates.find((c) => c.modelId === 'syn-chat-1')!.disqualified.map((d) => d.code)).toEqual(expect.arrayContaining(['NOT_QUALIFIED', 'MODEL_NOT_ADMITTED']));
    expect(listUsageForKey(key)).toHaveLength(0);
    // …and the spend guard still refuses it on its own, with a ledger row.
    const direct = await guardedPaidCall({ provider: PROVIDER, model: 'syn-chat-1', callSite: 'kernel.model_task', idempotencyKey: `${key}:direct`, inputChars: 10, maxOutputTokens: 10 }, async () => ({ ok: true }));
    expect(direct.permitted).toBe(false);
    expect(listUsageForKey(`${key}:direct`)[0]).toMatchObject({ status: 'BLOCKED', reason_code: 'MODEL_UNQUALIFIED' });
    expect(requests).toHaveLength(0);
  });

  it('qualification and enablement are separate, explicit, and required', () => {
    expect(enableModel(PROVIDER, 'syn-chat-1', 'test').ok).toBe(false); // not qualified yet
    expect(qualifyModel(PROVIDER, 'syn-chat-1', 'test').ok).toBe(true);
    expect(evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!.availability).toBe('QUALIFIED');
    expect(enableModel(PROVIDER, 'syn-chat-1', 'test').ok).toBe(true);
    expect(evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!).toMatchObject({ adminState: 'ENABLED', availability: 'AVAILABLE', executable: true });
    qualifyForTasks('syn-chat-1');
  });

  it('paid execution OFF makes an enabled model POLICY_BLOCKED; a missing credential makes it NOT_CONFIGURED', () => {
    policy(false);
    expect(evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!.availability).toBe('POLICY_BLOCKED');
    policy(true);
    delete process.env.SYNTHETIC_CHAT_API_KEY;
    expect(evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!.availability).toBe('NOT_CONFIGURED');
    process.env.SYNTHETIC_CHAT_API_KEY = KEY;
  });

  it('missing, conflicting, unreviewed and stale pricing each block — qualification refuses them too', async () => {
    const r = registerModelViaAdmin(PROVIDER, synModel('syn-noprice', { pricing: [] }), 'test');
    expect(r.ok).toBe(true);
    expect(evaluateModel(PROVIDER, 'syn-noprice')!.availability).toBe('PRICING_REQUIRED');
    expect(qualifyModel(PROVIDER, 'syn-noprice', 'test').ok).toBe(false);
    registerModelViaAdmin(PROVIDER, synModel('syn-conflict', { pricing: [price(), price({ rates: { input: 3, output: 4, cachedInput: null } })] }), 'test');
    expect(evaluateModel(PROVIDER, 'syn-conflict')!.blockers[0].reason).toMatch(/overlap/);
    registerModelViaAdmin(PROVIDER, synModel('syn-unreviewed', { pricing: [price({ approval: 'UNREVIEWED' })] }), 'test');
    expect(evaluateModel(PROVIDER, 'syn-unreviewed')!.availability).toBe('PRICING_REQUIRED');
    // Stale: fully enabled, then time passes its staleAfter.
    policy(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(now + 31 * 86_400_000);
      expect(evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!.availability).toBe('PRICE_STALE');
      const g = await guardedPaidCall({ provider: PROVIDER, model: 'syn-chat-1', callSite: 't', idempotencyKey: `stale-${seq++}`, inputChars: 10, maxOutputTokens: 10 }, async () => ({ ok: true }));
      expect(g).toMatchObject({ permitted: false, code: 'MODEL_PRICE_STALE' });
    } finally {
      vi.useRealTimers();
    }
    expect(requests).toHaveLength(0);
  });

  it('a manifest change to a qualified model un-qualifies it until an operator qualifies the new record', () => {
    registerModelViaAdmin(PROVIDER, synModel('syn-rq'), 'test');
    qualifyModel(PROVIDER, 'syn-rq', 'test'); enableModel(PROVIDER, 'syn-rq', 'test'); qualifyForTasks('syn-rq');
    expect(evaluateModel(PROVIDER, 'syn-rq', { workspaceId: WS })!.executable).toBe(true);
    registerModelViaAdmin(PROVIDER, synModel('syn-rq', { pricing: [price({ rates: { input: 9, output: 9, cachedInput: null } })] }), 'test');
    const v = evaluateModel(PROVIDER, 'syn-rq', { workspaceId: WS })!;
    expect(v.availability).toBe('UNQUALIFIED');
    expect(v.blockers[0].reason).toMatch(/changed since it was qualified/);
    expect(disableModel(PROVIDER, 'syn-rq', 'test', 'retired').ok).toBe(true);
  });

  it('workspace policy applies: an ALLOWLIST without the model, or a deny, blocks it in the guard', async () => {
    setWorkspacePolicy({ workspaceId: WS, mode: 'ALLOWLIST', allowed: ['synthetic-chat/syn-chat-2'], denied: [] }, 'test');
    expect(evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!.availability).toBe('POLICY_BLOCKED');
    const { key, result } = await runTask('synthetic-chat/syn-chat-1');
    expect(result.body.status).toBe('PAUSED_AWAITING_QUALIFIED_CAPACITY');
    expect(getDecision((result.body as any).routingDecision.decisionId)!.candidates.find((c) => c.modelId === 'syn-chat-1')!.disqualified.map((d) => d.code)).toContain('WORKSPACE_PROHIBITED');
    const direct = await guardedPaidCall({ provider: PROVIDER, model: 'syn-chat-1', callSite: 'kernel.model_task', workspaceId: WS, idempotencyKey: `${key}:direct`, inputChars: 10, maxOutputTokens: 10 }, async () => ({ ok: true }));
    expect(direct.permitted).toBe(false);
    expect(listUsageForKey(`${key}:direct`)[0]).toMatchObject({ status: 'BLOCKED', reason_code: 'MODEL_POLICY_BLOCKED' });
    setWorkspacePolicy({ workspaceId: WS, mode: 'INHERIT', allowed: [], denied: ['synthetic-chat/syn-chat-1'] }, 'test');
    expect(evaluateModel(PROVIDER, 'syn-chat-1', { workspaceId: WS })!.availability).toBe('POLICY_BLOCKED');
    setWorkspacePolicy({ workspaceId: WS, mode: 'INHERIT', allowed: [], denied: [] }, 'test');
    expect(requests).toHaveLength(0);
  });

  it('task restrictions apply: a task contract the model does not declare is refused before any credential or request', async () => {
    registerModelViaAdmin(PROVIDER, synModel('syn-narrative-only', { outputContracts: ['NARRATIVE'] }), 'test');
    qualifyModel(PROVIDER, 'syn-narrative-only', 'test'); enableModel(PROVIDER, 'syn-narrative-only', 'test'); qualifyForTasks('syn-narrative-only');
    const { result } = await runTask('synthetic-chat/syn-narrative-only', { outputContract: { mode: 'JSON_OBJECT' } });
    expect(result.body.reason).toBe('MODEL_TASK_INCOMPATIBLE');
    expect(requests).toHaveLength(0);
  });
});

// ============================================================================
describe('a provider added by plugin manifest only: identity propagates unchanged, one call, no fallback', () => {
  let first: { taskId: string; key: string; result: any };

  it('the synthetic provider id appears nowhere in the application code', () => {
    for (const dir of ['lib', 'src']) {
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
      for (const f of walk(path.join(process.cwd(), dir)).filter((f) => /\.(ts|tsx|json)$/.test(f))) expect(fs.readFileSync(f, 'utf8'), f).not.toContain(PROVIDER);
    }
    expect(repo('server.ts')).not.toContain(PROVIDER);
  });

  it('selected via ALIAS, executed as the canonical id: task → guard → provider → ledger → Aegis → receipt', async () => {
    policy(true);
    first = await runTask('synthetic-chat/syn-chat-latest');
    expect(first.result.body.success).toBe(true);
    expect(first.result.body.status).toBe('DONE');
    // Provider: exactly one request, for the canonical model, with nothing else in it.
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/v1/chat/completions');
    expect(requests[0].auth).toBe(`Bearer ${KEY}`);
    expect(Object.keys(requests[0].body).sort()).toEqual(['max_tokens', 'messages', 'model']);
    expect(requests[0].body.model).toBe('syn-chat-1');
    expect(JSON.stringify(requests[0].body)).not.toMatch(/syn-chat-2|syn-noprice|x\.synthetic-chat/);
    // Ledger: one SUCCESS row, canonical identity, immutable price snapshot.
    const rows = listUsageForKey(first.key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: PROVIDER, model: 'syn-chat-1', status: 'SUCCESS' });
    expect(rows[0].price_version).toMatch(/^registry:synthetic-chat:syn-chat-1#syn-2:/);
    expect(JSON.parse(rows[0].price_snapshot_json!)).toMatchObject({ input: 1, output: 2 });
    // Aegis review and receipt name the same identity and the same price.
    expect(getTaskQualityReviews(first.taskId)[0].decision).toBe('VERIFIED');
    const rc = getTaskReceipts(first.taskId)[0];
    expect(verifyReceipt(rc)).toBe(true);
    expect(JSON.parse(rc.payload_json)).toMatchObject({
      provider: PROVIDER, registryProviderId: PROVIDER, canonicalModelId: 'syn-chat-1',
      priceVersion: rows[0].price_version, usageId: rows[0].usage_id, outcome: 'COMPLETED',
    });
  });

  it('reaching DONE causes no second call; the same execution cannot be paid for twice', async () => {
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toHaveLength(0); // beforeEach reset: nothing arrived after DONE
    const again = await guardedPaidCall({ provider: PROVIDER, model: 'syn-chat-1', callSite: 'research.synthesis', idempotencyKey: first.key, inputChars: 10, maxOutputTokens: 10 }, async () => ({ ok: true }));
    expect(again).toMatchObject({ permitted: false, code: 'DUPLICATE_ALREADY_EXECUTED' });
    const fallback = await guardedPaidCall({ provider: PROVIDER, model: 'syn-chat-2', callSite: 't', idempotencyKey: first.key, inputChars: 10, maxOutputTokens: 10 }, async () => ({ ok: true }));
    expect(fallback.permitted).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('an alias re-pointed, and the model removed, by a newer manifest never rewrite history', () => {
    const rowBefore = listUsageForKey(first.key)[0];
    const receiptBefore = getTaskReceipts(first.taskId)[0];
    const r = importManifest(signed(manifest([synModel('syn-chat-2', { aliases: ['syn-chat-latest'] })], 'syn-3')), { source: 'SIGNED_IMPORT', actor: 'test' });
    expect(r.ok).toBe(true);
    expect(r.removed).toContain('syn-chat-1');
    // The alias now resolves elsewhere…
    expect(resolveModelIdentity('synthetic-chat/syn-chat-latest')).toMatchObject({ ok: true, modelId: 'syn-chat-2' });
    // …the removed model is REMOVED, with its full history kept…
    expect(evaluateModel(PROVIDER, 'syn-chat-1')!.availability).toBe('REMOVED');
    expect(modelHistory(PROVIDER, 'syn-chat-1').map((h) => h.changeType)).toEqual(['ADDED', 'REMOVED']);
    // …and the historical ledger row, receipt and task are byte-for-byte unchanged.
    expect(listUsageForKey(first.key)[0]).toEqual(rowBefore);
    const receiptAfter = getTaskReceipts(first.taskId)[0];
    expect(receiptAfter.payload_json).toBe(receiptBefore.payload_json);
    expect(verifyReceipt(receiptAfter)).toBe(true);
    expect(getTaskWithHistory(first.taskId).task!.status).toBe('DONE');
  });
});

// ============================================================================
describe('adapter contract fixtures', () => {
  const fixtures: Array<{ name: string; protocol: keyof typeof PROTOCOL_ADAPTERS; done: any; cut: any; usage: any; text: string }> = [
    { name: 'OpenAI-style (responses)', protocol: 'openai.responses', done: { status: 'completed', output_text: 'hi' }, cut: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, usage: { id: 'r1', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } }, text: 'hi' },
    { name: 'Anthropic-style (messages)', protocol: 'anthropic.messages', done: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] }, cut: { stop_reason: 'max_tokens' }, usage: { id: 'm1', usage: { input_tokens: 3, output_tokens: 4 } }, text: 'hi' },
    { name: 'Gemini-style (generateContent)', protocol: 'gemini.generate_content', done: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hi' }] } }] }, cut: { candidates: [{ finishReason: 'MAX_TOKENS' }] }, usage: { responseId: 'g1', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 } }, text: 'hi' },
    { name: 'OpenAI-compatible (DeepSeek-style chat)', protocol: 'openai.chat_completions', done: { choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }, cut: { choices: [{ finish_reason: 'length' }] }, usage: { id: 'c1', usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }, text: 'hi' },
  ];
  for (const f of fixtures) {
    it(`${f.name}: termination, usage, text and error normalization`, () => {
      const a = PROTOCOL_ADAPTERS[f.protocol];
      expect(a.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(a.normalizeTermination(f.done, 100).status).toBe('COMPLETE');
      expect(a.normalizeTermination(f.cut, 100).status).toBe('INCOMPLETE');
      expect(a.normalizeTermination({}, 100).status).toBe('NOT_REPORTED');
      expect(a.normalizeUsage(f.usage).inputTokens).toBe(3);
      expect(a.normalizeUsage(f.usage).outputTokens).toBe(4);
      expect(a.extractText(f.done)).toBe(f.text);
      expect(a.normalizeError(401, JSON.stringify({ error: { message: `bad key ${KEY}` } }))).not.toContain(KEY);
    });
  }

  it('a locally imported versioned manifest drives a provider with no plugin file (the synthetic provider above)', () => {
    const view = listProviderViews().find((p) => p.providerId === PROVIDER)!;
    expect(view).toMatchObject({ protocol: 'openai.chat_completions', adapterDispatch: 'MODEL_CALL', source: 'SIGNED_IMPORT' });
    expect(BUNDLED_PLUGINS.some((p) => p.providerId === PROVIDER)).toBe(false);
  });

  it('a protocol this build cannot dispatch leaves its models UNSUPPORTED_BY_ADAPTER', () => {
    const anthropic = listModelViews().filter((v) => v.protocol === 'anthropic.messages');
    expect(anthropic.length).toBeGreaterThan(0);
    for (const v of anthropic) expect(v.availability === 'UNSUPPORTED_BY_ADAPTER' || v.availability === 'REMOVED').toBe(true);
  });
});

// ============================================================================
describe('provider endpoint security', () => {
  const body = { providerId: 'x', approvedHosts: ['api.approved.example'] };

  it('validation: https + approved host, loopback only under test/dev, malicious hosts and embedded credentials refused', () => {
    expect(validateEndpointUrl('https://api.approved.example/v1', body).ok).toBe(true);
    expect(validateEndpointUrl('https://evil.example/v1', body).ok).toBe(false);
    expect(validateEndpointUrl('http://api.approved.example/v1', body).ok).toBe(false);
    expect(validateEndpointUrl('https://user:pw@api.approved.example/v1', body).ok).toBe(false);
    expect(validateEndpointUrl('https://api.approved.example.evil.example/v1', body).ok).toBe(false);
    expect(validateEndpointUrl('http://127.0.0.1:9/v1', body).ok).toBe(true); // under test
    expect(validateEndpointUrl('http://127.0.0.1:9/v1', body, { NODE_ENV: 'production' } as any).ok).toBe(false);
    expect(loopbackProvidersAllowed({ NODE_ENV: 'development' } as any)).toBe(false);
    expect(validateEndpointUrl('https://gateway.corp.example/v1', body, { SYNTHOS_PROVIDER_HOST_ALLOWLIST: 'gateway.corp.example' } as any).ok).toBe(true);
  });

  it('production defaults: with no override every bundled provider resolves to its canonical https host', () => {
    for (const p of BUNDLED_PLUGINS) {
      const m = validateManifest(p.manifest);
      if (!m.ok) throw new Error('invalid');
      const r = resolveProviderEndpoint(m.manifest.provider, { NODE_ENV: 'production' } as any);
      expect(r.ok, p.providerId).toBe(true);
      expect(r.ok && m.manifest.provider.approvedHosts.includes(new URL(r.baseUrl).hostname)).toBe(true);
      // https everywhere, except a credential-free LOCAL route on loopback.
      const local = m.manifest.provider.routeKind === 'LOCAL' && m.manifest.provider.auth.type === 'NONE';
      expect(r.ok && (r.baseUrl.startsWith('https://') || (local && new URL(r.baseUrl).hostname === 'localhost')), p.providerId).toBe(true);
    }
  });

  it('a malicious override fails closed: the adapter refuses before any credential or body leaves', async () => {
    const saved = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'https://evil.example/v1';
    invalidateProviderEndpointCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const r = await generateViaOpenAI({ apiKey: 'sk-should-never-leave-000000000', contents: 'x', candidateModels: ['gpt-4o'], spend: { callSite: 't', idempotencyKey: `evil-${seq++}` } });
      expect(r.lastProviderError).toMatch(/ENDPOINT_NOT_APPROVED/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      if (saved === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = saved;
      invalidateProviderEndpointCache();
    }
  });

  it('credential protection: a provider credential bound for an unapproved host is refused at the fetch boundary', async () => {
    await expect(fetch(`http://127.0.0.1:${redirectPort}/steal`, { headers: { Authorization: `Bearer ${KEY}` } })).rejects.toBeInstanceOf(PaidEndpointBlockedError);
    await expect(fetch(`http://127.0.0.1:${redirectPort}/steal?key=${KEY}`)).rejects.toBeInstanceOf(PaidEndpointBlockedError);
    expect(redirectHits).toBe(0);
  });

  it('redirect escape: a provider endpoint that redirects cannot carry the request (or credential) to another host', async () => {
    registerModelViaAdmin(PROVIDER, synModel('syn-redirect'), 'test');
    qualifyModel(PROVIDER, 'syn-redirect', 'test'); enableModel(PROVIDER, 'syn-redirect', 'test'); qualifyForTasks('syn-redirect');
    policy(true);
    redirectHits = 0;
    process.env.SYNTHETIC_CHAT_BASE_URL = `http://127.0.0.1:${providerPort}/redirect`;
    invalidateProviderEndpointCache();
    try {
      const { result } = await runTask('synthetic-chat/syn-redirect');
      expect(result.body.success).toBe(false);
      expect(requests).toHaveLength(1); // the provider endpoint only
      expect(redirectHits).toBe(0);     // the redirect target never received it
    } finally {
      process.env.SYNTHETIC_CHAT_BASE_URL = `http://127.0.0.1:${providerPort}/v1`;
      invalidateProviderEndpointCache();
    }
  });
});

// ============================================================================
describe('explicit model evaluation — never automatic, never able to bypass the rails', () => {
  let parent: { taskId: string };

  beforeAll(async () => {
    registerModelViaAdmin(PROVIDER, synModel('syn-judge'), 'test');
    qualifyModel(PROVIDER, 'syn-judge', 'test'); enableModel(PROVIDER, 'syn-judge', 'test'); qualifyForTasks('syn-judge');
    policy(true);
    const r = await runTask('synthetic-chat/syn-judge');
    expect(r.result.body.status).toBe('DONE');
    parent = { taskId: r.taskId };
  });

  it('preview has no side effects: no task, no ledger row, no provider request', () => {
    const before = ledger();
    const tasksBefore = (getDatabase().prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n;
    const p = previewEvaluation({ parentTaskId: parent.taskId, workspaceId: WS, model: 'synthetic-chat/syn-judge' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p).toMatchObject({ sideEffects: 'NONE', guardian: { allowed: true }, availability: { executable: true } });
    expect(p.estimate.permitted).toBe(true);
    expect(p.estimate.priceVersion).toMatch(/^registry:synthetic-chat:syn-judge#/);
    expect(ledger()).toBe(before);
    expect((getDatabase().prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n).toBe(tasksBefore);
    expect(requests).toHaveLength(0);
  });

  it('with paid execution OFF the explicit run waits (PAUSED_AWAITING_BUDGET) before dispatch — no request, parent untouched', async () => {
    policy(false);
    const parentBefore = getTaskWithHistory(parent.taskId).task!;
    const receiptsBefore = getTaskReceipts(parent.taskId).length;
    const r = await runEvaluation({ parentTaskId: parent.taskId, workspaceId: WS, model: 'synthetic-chat/syn-judge', actorUserId: 'u1', ctx: createExecutionContext({ workspaceId: WS }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.success).toBe(false);
    // The router sees paid execution is off and the task waits; nothing reaches the guard or the provider.
    expect(r.body.status).toBe('PAUSED_AWAITING_BUDGET');
    const d = getDecision(r.body.routingDecision.decisionId)!;
    expect(d.candidates.find((c) => c.modelId === 'syn-judge')!.disqualified.map((x) => x.code)).toContain('PAID_EXECUTION_DISABLED');
    expect(listUsageForKey(`evaluation:${r.evaluationTaskId}`)).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect(getTaskWithHistory(parent.taskId).task!.status).toBe(parentBefore.status);
    expect(getTaskReceipts(parent.taskId)).toHaveLength(receiptsBefore);
  });

  it('when run, it is its own task: one request, its own ledger row, Aegis review and receipt; the parent is unchanged', async () => {
    policy(true);
    const receiptsBefore = getTaskReceipts(parent.taskId).map((x) => x.receipt_id);
    const r = await runEvaluation({ parentTaskId: parent.taskId, workspaceId: WS, model: 'synthetic-chat/syn-judge', actorUserId: 'u1', ctx: createExecutionContext({ workspaceId: WS }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evaluationTaskId).not.toBe(parent.taskId);
    expect(r.body.status).toBe('DONE');
    expect(requests).toHaveLength(1);
    expect(listUsageForKey(`evaluation:${r.evaluationTaskId}`)).toHaveLength(1);
    expect(getTaskQualityReviews(r.evaluationTaskId)[0].decision).toBe('VERIFIED');
    expect(JSON.parse(getTaskReceipts(r.evaluationTaskId)[0].payload_json)).toMatchObject({ outcome: 'COMPLETED', canonicalModelId: 'syn-judge' });
    expect(getTaskWithHistory(parent.taskId).task!.status).toBe('DONE');
    expect(getTaskReceipts(parent.taskId).map((x) => x.receipt_id)).toEqual(receiptsBefore);
  });

  it('Guardian is checked independently: an evaluation of dangerous content is refused before any task or request', async () => {
    reply = { content: 'Run sudo rm -rf / to finish.', finish: 'stop' };
    const bad = await runTask('synthetic-chat/syn-judge');
    requests = [];
    const before = ledger();
    const p = previewEvaluation({ parentTaskId: bad.taskId, workspaceId: WS, model: 'synthetic-chat/syn-judge' });
    expect(p.ok && p.guardian.allowed).toBe(false);
    const r = await runEvaluation({ parentTaskId: bad.taskId, workspaceId: WS, model: 'synthetic-chat/syn-judge', actorUserId: 'u1', ctx: createExecutionContext({ workspaceId: WS }) });
    expect(r).toMatchObject({ ok: false, code: 'GUARDIAN_BLOCKED' });
    expect(ledger()).toBe(before);
    expect(requests).toHaveLength(0);
  });
});
