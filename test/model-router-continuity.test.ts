import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// CANONICAL MODEL ROUTER + EXECUTION CONTINUITY CONTROLLER.
//
// Deterministic: every provider below is SYNTHETIC and speaks the
// OpenAI-compatible chat-completions protocol to ONE local HTTP double that
// counts requests. Three routes:
//
//   synthetic-pub    DIRECT     the publisher; its ids ARE canonical versions
//   synthetic-agg    AGGREGATOR offers the publisher's model under its own id
//   synthetic-local  LOCAL      no credential, no charge
//
// Route importers are exercised against the real bundled openrouter / nvidia /
// local-runtime plugins with SYNTHETIC metadata documents — parse only, no
// network. Nothing here contacts OpenRouter, NVIDIA or any real provider.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-router-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'router.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'q'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('router');

import { getDatabase, getTaskReceipts, verifyReceipt, getTaskWithHistory } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { qualifyModel, enableModel, registryGate } from '../lib/registry';
import { importManifest, getStoredModel } from '../lib/registry/store';
import { routeIdentity, approveRouteMapping, listFamiliesAndVersions } from '../lib/registry/identity';
import { runRouteImport, refreshRoute, routeRefreshTickForScheduler, getRouteRefreshSettings, setRouteRefreshSettings, listRouteImportStatus, isRouteStale, MIN_REFRESH_HOURS, MAX_REFRESH_HOURS } from '../lib/registry/route-import';
import {
  insertQualificationForTest, listTaskClasses, startQualificationRun, recordCaseResult, evaluateRun, approveQualification, listQualifications, findQualification, getRun, evaluateCase, revokeQualification,
} from '../lib/registry/qualification';
import { executeQualificationCases } from '../lib/registry/qualification-exec';
import { routeTask, requirementsFor, getDecision, setWorkspaceRouting, listDecisions, activePolicy, listPolicies } from '../lib/registry/router';
import { recordPerformanceSample, proposeRouteStats, decideProposal, approvedRouteStats, proposePolicyWeights } from '../lib/registry/performance';
import { runWithRouteContext } from '../lib/registry/route-context';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureUsageTable, listUsageForKey } from '../lib/spend/ledger';
import { guardedPaidCall } from '../lib/spend/guard';
import { invalidateProviderEndpointCache } from '../lib/spend/network-guard';
import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import {
  getContinuity, listSegments, listCheckpoints, getCheckpoint, continuationContext, claimSideEffect, completeSideEffect, writeCheckpoint, openContinuity,
  resolveUnknownSegment, continuityView, PAUSE_STATES,
} from '../lib/continuity/controller';
import { continuityTickForScheduler, resetResumeThrottleForTests } from '../lib/continuity/resume';
import { assessCapacity } from '../lib/continuity/capacity';
import { TASK_TERMINAL_STATUSES, ORCHESTRATOR_ELIGIBLE_STATUSES } from '../lib/persistence';

const WS = 'ws-router';
const PUB = 'synthetic-pub';
const AGG = 'synthetic-agg';
const LOC = 'synthetic-local';

// ---- one provider double, three routes --------------------------------------
type Mode = 'ok' | '429' | '500' | 'truncate' | 'truncate-then-ok';
const mode: Record<string, Mode> = { pub: 'ok', agg: 'ok', loc: 'ok' };
let requests: Array<{ route: string; model: string; content: string; auth: string | undefined }> = [];
let server: http.Server; let port = 0;
const truncCount: Record<string, number> = {};

function answer(content: string): string {
  const lit = /Reply with exactly the uppercase form of: (.+)$/m.exec(content);
  if (lit) return lit[1].trim().toUpperCase();
  const ex = /Reply with exactly: (.+)$/m.exec(content);
  if (ex) return ex[1].trim();
  if (/OUTPUT CONTRACT: reply with exactly the following text/.test(content)) return content.trim().split('\n').pop()!.trim();
  return 'A complete narrative answer.';
}

beforeAll(async () => {
  getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Router');
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const route = (req.url || '').split('/')[1];
      let p: any = {}; try { p = JSON.parse(body || '{}'); } catch {}
      const content = String(p?.messages?.[0]?.content ?? '');
      requests.push({ route, model: p.model, content, auth: req.headers.authorization });
      const m = mode[route] ?? 'ok';
      if (m === '429') { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } })); }
      if (m === '500') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'upstream error' } })); }
      let text = answer(content); let finish = 'stop';
      if (m === 'truncate' || (m === 'truncate-then-ok' && (truncCount[route] = (truncCount[route] ?? 0) + 1) === 1)) { text = 'Part one of the narrative, cut'; finish = 'length'; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `r-${requests.length}`, model: p.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }], usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as any).port;
  process.env.SYNTHETIC_PUB_BASE_URL = `http://127.0.0.1:${port}/pub/v1`;
  process.env.SYNTHETIC_AGG_BASE_URL = `http://127.0.0.1:${port}/agg/v1`;
  process.env.SYNTHETIC_LOCAL_BASE_URL = `http://127.0.0.1:${port}/loc/v1`;
  process.env.SYNTHETIC_PUB_API_KEY = 'sk-synthetic-pub-000000000000000000';
  process.env.SYNTHETIC_AGG_API_KEY = 'sk-synthetic-agg-000000000000000000';
  installRoutes();
});

afterAll(async () => {
  for (const k of ['SYNTHETIC_PUB_BASE_URL', 'SYNTHETIC_AGG_BASE_URL', 'SYNTHETIC_LOCAL_BASE_URL', 'SYNTHETIC_PUB_API_KEY', 'SYNTHETIC_AGG_API_KEY']) delete process.env[k];
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  requests = [];
  mode.pub = 'ok'; mode.agg = 'ok'; mode.loc = 'ok';
  for (const k of Object.keys(truncCount)) delete truncCount[k];
  policy(true);
  invalidateProviderEndpointCache();
  resetResumeThrottleForTests();
  // Provider health is ledger state; a failure in one test must not cool a route down for the next.
  getDatabase().exec("DELETE FROM runtime_events WHERE target_type = 'provider'");
});

// ---- fixtures ------------------------------------------------------------------
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const price = (input: number, output: number) => ({
  currency: 'USD', unit: 'tokens', rates: { input, output, cachedInput: null }, reasoningTokens: 'BILLED_AS_OUTPUT', tiers: [], toolCharges: [], modalityCharges: [],
  effectiveFrom: iso(now - 86_400_000), effectiveUntil: null, source: 'synthetic fixture', verifiedAt: iso(now - 3_600_000), staleAfter: iso(now + 30 * 86_400_000), approval: 'APPROVED',
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
function manifest(providerId: string, models: any[], over: Record<string, unknown> = {}, version = 'syn-1') {
  const envBase = `${providerId.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
  return {
    schemaVersion: 'synthos.registry/v1', manifestVersion: version,
    provenance: { publisher: 'synthos-test-fixtures', generatedAt: iso(now) },
    provider: {
      providerId, displayName: providerId, protocol: 'openai.chat_completions', adapterVersion: '1.0.0',
      approvedHosts: [`api.${providerId}.example`], defaultBaseUrl: `https://api.${providerId}.example/v1`, baseUrlEnvVar: envBase,
      auth: { type: 'BEARER', credentialSlot: null, envVars: [`${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`] },
      billing: 'METERED', restrictions: { regions: [], compliance: [] },
      ...over,
    },
    models,
  };
}

function installRoutes(): void {
  const a = importManifest(manifest(PUB, [
    model('pub-large', { family: { familyId: 'pub-family', displayName: 'Pub family', publisher: PUB }, canonicalVersionId: `${PUB}/pub-large` }),
    model('pub-small', { limits: { contextTokens: 8000, outputTokens: 256 }, pricing: [price(0.5, 1)] }),
  ]), { source: 'PLUGIN', actor: 'test' });
  expect(a.ok).toBe(true);
  const b = importManifest(manifest(AGG, [
    model(`${PUB}/pub-large`, { canonicalVersionId: `${PUB}/pub-large`, pricing: [price(2, 4)] }),
  ], { routeKind: 'AGGREGATOR' }), { source: 'PLUGIN', actor: 'test' });
  expect(b.ok).toBe(true);
  const c = importManifest(manifest(LOC, [model('loc-1', { pricing: [price(0, 0)] })], {
    routeKind: 'LOCAL', auth: { type: 'NONE', credentialSlot: null, envVars: [] }, billing: 'FREE_LOCAL', privacyClass: 'LOCAL_ONLY',
    approvedHosts: ['localhost'], defaultBaseUrl: 'http://localhost:9/v1',
  }), { source: 'PLUGIN', actor: 'test' });
  expect(c.ok, c.errors.join('; ')).toBe(true);
  for (const [p, m] of [[PUB, 'pub-large'], [PUB, 'pub-small'], [AGG, `${PUB}/pub-large`], [LOC, 'loc-1']]) {
    expect(qualifyModel(p, m, 'test').ok).toBe(true);
    expect(enableModel(p, m, 'test').ok).toBe(true);
  }
  // A local runtime's model has no publisher of its own here: an operator maps it.
  expect(approveRouteMapping({ providerId: LOC, modelId: 'loc-1', canonicalVersionId: 'synthetic-open/loc-1', family: { familyId: 'open-family', displayName: 'Open family', publisher: 'synthetic-open' }, actor: 'operator' }).ok).toBe(true);
}

function policy(paid: boolean, over: Record<string, unknown> = {}) {
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  const on = { enabled: true, dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 };
  const r = saveSpendPolicy({
    ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: paid,
    global: { dailyUsd: 10, monthlyUsd: 10, maxConcurrent: 5 },
    providers: { ...Object.fromEntries(Object.keys(DEFAULT_SPEND_POLICY.providers).map((p) => [p, off])), [PUB]: on, [AGG]: on, [LOC]: on },
    workspaceDefault: { dailyUsd: 10, maxConcurrent: 5 },
    task: { maxEstimatedUsd: 1, maxInputChars: 200_000, maxOutputTokens: 1000, maxTier: 'PREMIUM' },
    approvalThresholdUsd: 1,
    ...over,
  }, 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
}

const qualify = (providerId: string, modelId: string, taskClass: string, quality = 0.99, reliability = 0.99) => insertQualificationForTest({ providerId, modelId, taskClass, quality, reliability });
const clearQualifications = () => getDatabase().exec('DELETE FROM registry_qualifications');
const req = (taskClass = 'content_generation', over: Partial<Parameters<typeof requirementsFor>[0]> = {}) => {
  const r = requirementsFor({ taskClass, inputChars: 400, ...over });
  if ('error' in r) throw new Error(r.error);
  return r;
};
let seq = 0;
async function runTask(extra: Record<string, unknown> = {}) {
  const taskId = `rt-${Date.now()}-${seq++}`;
  const r = await executeAgentTask({ taskId, taskTitle: 'Router task', description: 'Write two sentences about the store.', assignedAgent: 'scribe', assignedModel: '', spendIdempotencyKey: `rk-${taskId}`, ...extra } as any, WS, createExecutionContext({ workspaceId: WS }));
  return { taskId, result: r as { status: number; body: any } };
}

// ============================================================================
describe('model identity: family → canonical version → route → deployment', () => {
  it('the publisher route defines the version; the aggregator only PROPOSES it, and is unresolved until an audited approval', () => {
    expect(routeIdentity(PUB, 'pub-large')).toMatchObject({ status: 'AUTHORITATIVE', canonicalVersionId: `${PUB}/pub-large`, familyId: 'pub-family', resolved: true });
    expect(routeIdentity(PUB, 'pub-small')).toMatchObject({ status: 'IMPLICIT_PUBLISHER', canonicalVersionId: `${PUB}/pub-small`, resolved: true });
    const agg = routeIdentity(AGG, `${PUB}/pub-large`);
    expect(agg).toMatchObject({ status: 'PENDING_REVIEW', canonicalVersionId: null, proposedVersionId: `${PUB}/pub-large`, resolved: false });
    // An aggregator id is never a new model: there is ONE canonical version.
    const fam = listFamiliesAndVersions().find((f) => f.familyId === 'pub-family')!;
    expect(fam.versions.map((v) => v.canonicalVersionId)).toEqual([`${PUB}/pub-large`]);
    expect(getDatabase().prepare("SELECT COUNT(*) n FROM registry_versions WHERE canonical_version_id LIKE ?").get(`%${AGG}%`)).toMatchObject({ n: 0 });
  });

  it('an unresolved mapping never executes — the spend guard refuses it with the reason', () => {
    qualify(AGG, `${PUB}/pub-large`, 'content_generation');
    const g = registryGate(AGG, `${PUB}/pub-large`, { workspaceId: WS, callSite: 'kernel.model_task', route: { taskClass: 'content_generation' } });
    expect(g).toMatchObject({ ok: false, code: 'ROUTE_MAPPING_UNRESOLVED' });
  });

  it('approval maps the aggregator offering onto the canonical version; both routes now resolve to it', () => {
    const r = approveRouteMapping({ providerId: AGG, modelId: `${PUB}/pub-large`, canonicalVersionId: `${PUB}/pub-large`, actor: 'operator' });
    expect(r.ok).toBe(true);
    expect(routeIdentity(AGG, `${PUB}/pub-large`)).toMatchObject({ status: 'APPROVED', canonicalVersionId: `${PUB}/pub-large`, familyId: 'pub-family', resolved: true });
    const events = getDatabase().prepare("SELECT COUNT(*) n FROM registry_events WHERE event_type = 'ROUTE_IMPORT' OR event_type = 'MANIFEST_IMPORTED'").get() as any;
    expect(events.n).toBeGreaterThan(0);
  });

  it('a later import that claims a DIFFERENT version for an approved offering fails closed as CONFLICT', () => {
    const r = importManifest(manifest(AGG, [model(`${PUB}/pub-large`, { canonicalVersionId: `${PUB}/pub-small`, pricing: [price(2, 4)] })], { routeKind: 'AGGREGATOR' }, 'syn-2'), { source: 'PLUGIN', actor: 'test' });
    expect(r.ok).toBe(true);
    expect(r.identityConflicts!.join(' ')).toMatch(/approved mapping is synthetic-pub\/pub-large/);
    expect(routeIdentity(AGG, `${PUB}/pub-large`)).toMatchObject({ status: 'CONFLICT', resolved: false });
    // Restore the approved state for the rest of the file.
    importManifest(manifest(AGG, [model(`${PUB}/pub-large`, { canonicalVersionId: `${PUB}/pub-large`, pricing: [price(2, 4)] })], { routeKind: 'AGGREGATOR' }, 'syn-3'), { source: 'PLUGIN', actor: 'test' });
    expect(approveRouteMapping({ providerId: AGG, modelId: `${PUB}/pub-large`, canonicalVersionId: `${PUB}/pub-large`, actor: 'operator' }).ok).toBe(true);
    expect(routeIdentity(AGG, `${PUB}/pub-large`).resolved).toBe(true);
  });

  it('deployments: a provider without declared deployments has one default deployment carrying the privacy boundary', () => {
    const d = getDatabase().prepare('SELECT spec_json FROM registry_deployments WHERE provider_id = ?').get(LOC) as any;
    expect(JSON.parse(d.spec_json)).toMatchObject({ deploymentId: 'default', privacyClass: 'LOCAL_ONLY', status: 'ACTIVE' });
  });
});

// ============================================================================
describe('route importers — metadata only, manual, never qualify, never override identity', () => {
  const orDoc = (promptPrice = '0.000001') => ({ data: [
    { id: 'acme/acme-1', canonical_slug: 'acme/acme-1', name: 'Acme 1', context_length: 64000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: promptPrice, completion: '0.000002' }, top_provider: { context_length: 64000, max_completion_tokens: 8000 }, supported_parameters: ['tools', 'response_format', 'max_tokens'] },
    { id: 'acme/acme-1:free', canonical_slug: 'acme/acme-1', name: 'Acme 1 (free)', context_length: 32000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
    { id: 'bad id with spaces', pricing: { prompt: '0', completion: '0' } },
    { id: 'acme/unpriced' },
  ] });

  it('OpenRouter: offerings land INSTALLED/UNQUALIFIED, propose a canonical version, free ones are volatile — zero network requests', () => {
    const before = requests.length;
    const r = runRouteImport({ importerId: 'openrouter', payload: orDoc(), actor: 'operator' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome.added.sort()).toEqual(['acme/acme-1', 'acme/acme-1:free']);
    expect(r.warnings.join(' ')).toMatch(/invalid id/);
    expect(r.warnings.join(' ')).toMatch(/acme\/unpriced: no usable price/);
    expect(r.outcome.identityPending!.sort()).toEqual(['openrouter/acme/acme-1 → acme/acme-1', 'openrouter/acme/acme-1:free → acme/acme-1']);
    const m = getStoredModel('openrouter', 'acme/acme-1:free')!;
    expect(m.record.freeTier).toEqual({ free: true, guaranteed: false });
    expect(Date.parse(m.record.pricing[0].staleAfter) - Date.parse(m.record.pricing[0].verifiedAt)).toBe(24 * 3_600_000);
    expect(getStoredModel('openrouter', 'acme/acme-1')!.record.pricing[0]).toMatchObject({ approval: 'UNREVIEWED', rates: { input: 1, output: 2 } });
    expect(getStoredModel('openrouter', 'acme/acme-1')!.record.outputContracts).toContain('JSON_OBJECT');
    // Never qualified or enabled by an import; identity unresolved.
    const adm = getDatabase().prepare('SELECT COUNT(*) n FROM registry_admin_state WHERE provider_id = ?').get('openrouter') as any;
    expect(adm.n).toBe(0);
    expect(routeIdentity('openrouter', 'acme/acme-1')).toMatchObject({ status: 'PENDING_REVIEW', resolved: false });
    expect(requests.length).toBe(before);
    expect(listRouteImportStatus().find((s) => s.importerId === 'openrouter')).toMatchObject({ state: 'CURRENT', offerings: 2, trigger: 'MANUAL' });
  });

  it('an unchanged, operator-approved price stays approved on re-import; a changed price becomes UNREVIEWED', () => {
    // Operator approves the current price (as an admin registration would).
    const m = getStoredModel('openrouter', 'acme/acme-1')!;
    getDatabase().prepare('UPDATE registry_models SET record_json = ? WHERE provider_id = ? AND model_id = ?').run(JSON.stringify({ ...m.record, pricing: [{ ...m.record.pricing[0], approval: 'APPROVED' }] }), 'openrouter', 'acme/acme-1');
    runRouteImport({ importerId: 'openrouter', payload: orDoc(), actor: 'operator' });
    expect(getStoredModel('openrouter', 'acme/acme-1')!.record.pricing[0].approval).toBe('APPROVED');
    runRouteImport({ importerId: 'openrouter', payload: orDoc('0.000003'), actor: 'operator' });
    expect(getStoredModel('openrouter', 'acme/acme-1')!.record.pricing[0]).toMatchObject({ approval: 'UNREVIEWED', rates: { input: 3 } });
  });

  it('a failed import changes nothing and marks the route STALE; the router refuses stale route prices', () => {
    const r = runRouteImport({ importerId: 'openrouter', payload: { nope: true }, actor: 'operator' });
    expect(r.ok).toBe(false);
    expect(getStoredModel('openrouter', 'acme/acme-1')).not.toBeNull();
    expect(isRouteStale('openrouter')).toBe(true);
    const d = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { mode: 'AGGREGATORS_ALLOWED' } });
    expect(d.candidates.find((c) => c.providerId === 'openrouter' && c.modelId === 'acme/acme-1')!.disqualified.map((x) => x.code)).toContain('ROUTE_DATA_STALE');
    runRouteImport({ importerId: 'openrouter', payload: orDoc('0.000003'), actor: 'operator' });
    expect(isRouteStale('openrouter')).toBe(false);
  });

  it('NVIDIA and the local runtime import through the same interface; an unpriced NVIDIA offering stays PRICING_REQUIRED', () => {
    const nv = runRouteImport({ importerId: 'nvidia', payload: { data: [{ id: 'acme/acme-1', max_model_len: 32000 }, { id: 'acme/acme-2', pricing: { input_per_token: 0.000001, output_per_token: 0.000002 } }] }, actor: 'operator' });
    expect(nv.ok).toBe(true);
    expect(getStoredModel('nvidia', 'acme/acme-1')!.record.pricing).toEqual([]);
    expect(routeIdentity('nvidia', 'acme/acme-1')).toMatchObject({ status: 'PENDING_REVIEW', proposedVersionId: 'acme/acme-1' });
    const lo = runRouteImport({ importerId: 'local-runtime', payload: { models: [{ name: 'qwen-local:14b' }] }, actor: 'operator' });
    expect(lo.ok).toBe(true);
    expect(getStoredModel('local-runtime', 'qwen-local:14b')!.record.freeTier).toEqual({ free: true, guaranteed: true });
    expect(routeIdentity('local-runtime', 'qwen-local:14b')).toMatchObject({ status: 'UNMAPPED', resolved: false });
  });

  it('signed-offline imports demand a valid signature from a trusted key', () => {
    const r = runRouteImport({ importerId: 'signed-offline', payload: manifest('synthetic-offline', []), actor: 'operator' });
    expect(r).toMatchObject({ ok: false, code: 'IMPORT_REFUSED' });
    expect((r as any).error).toMatch(/must be signed/);
  });

  it('scheduled refresh is OFF by default, bounded when on, and a failed refresh keeps last-known offerings as STALE', async () => {
    expect(getRouteRefreshSettings()).toEqual({ enabled: false, cadenceHours: 24, importers: [] });
    expect(await routeRefreshTickForScheduler(async () => { throw new Error('must not be called'); })).toBeNull();
    expect(setRouteRefreshSettings({ cadenceHours: MIN_REFRESH_HOURS - 1 }, 'op')).toMatchObject({ ok: false });
    expect(setRouteRefreshSettings({ cadenceHours: MAX_REFRESH_HOURS + 1 }, 'op')).toMatchObject({ ok: false });
    expect(setRouteRefreshSettings({ importers: ['signed-offline'] }, 'op')).toMatchObject({ ok: false });
    expect(setRouteRefreshSettings({ enabled: true, cadenceHours: 12, importers: ['openrouter'] }, 'op').ok).toBe(true);
    let fetched: string[] = [];
    // First tick: the injected fetcher FAILS (a real refresh would GET the route's /models).
    getDatabase().prepare("UPDATE registry_route_import_status SET last_attempt_at = ? WHERE importer_id = 'openrouter'").run(iso(Date.now() - 13 * 3_600_000));
    const t1 = await routeRefreshTickForScheduler(async (url) => { fetched.push(url); throw new Error('connection refused'); });
    expect(t1).toEqual({ ran: ['openrouter'] });
    expect(fetched).toEqual(['https://openrouter.ai/api/v1/models']);
    expect(isRouteStale('openrouter')).toBe(true);
    expect(getStoredModel('openrouter', 'acme/acme-1')!.removedAt).toBeNull();
    // Within the cadence nothing runs again.
    fetched = [];
    expect(await routeRefreshTickForScheduler(async (url) => { fetched.push(url); throw new Error('x'); })).toEqual({ ran: [] });
    expect(fetched).toEqual([]);
    // A later successful refresh restores CURRENT.
    getDatabase().prepare("UPDATE registry_route_import_status SET last_attempt_at = ? WHERE importer_id = 'openrouter'").run(iso(Date.now() - 13 * 3_600_000));
    const ok = await refreshRoute('openrouter', 'op', async () => ({ ok: true, status: 200, text: async () => JSON.stringify(orDoc('0.000003')) }));
    expect(ok.ok).toBe(true);
    expect(isRouteStale('openrouter')).toBe(false);
    setRouteRefreshSettings({ enabled: false, importers: [] }, 'op');
  });
});

// ============================================================================
describe('task-specific qualification', () => {
  it('deterministic checks: exact, JSON keys, contains, regex — no model grades another', () => {
    expect(evaluateCase({ type: 'EXACT', expected: 'A' }, ' A ').pass).toBe(true);
    expect(evaluateCase({ type: 'EXACT', expected: 'A' }, 'A.').pass).toBe(false);
    expect(evaluateCase({ type: 'JSON_KEYS', requiredKeys: ['a'], expectedValues: { a: 1 } }, '{"a":1}').pass).toBe(true);
    expect(evaluateCase({ type: 'JSON_KEYS', requiredKeys: ['a'] }, 'not json').pass).toBe(false);
    expect(evaluateCase({ type: 'CONTAINS_ALL', terms: ['9', '18'], maxChars: 10 }, 'open 9 to 18 daily ok').pass).toBe(false);
    expect(evaluateCase({ type: 'REGEX', pattern: '^1\\.', flags: 'm' }, '1. step').pass).toBe(true);
  });

  it('a run executes each case through the spend guard; with paid execution OFF nothing is recorded or sent', async () => {
    policy(false);
    const s = startQualificationRun({ providerId: PUB, modelId: 'pub-large', taskClass: 'literal_transformation', actor: 'operator' });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const r = await executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recorded).toBe(0);
    expect(r.refused.length).toBe(6);
    expect(r.refused[0].reason).toMatch(/PAID_EXECUTION_DISABLED/);
    expect(requests).toHaveLength(0);
    expect(evaluateRun(s.runId)).toMatchObject({ ok: false });
  });

  it('run → deterministic evaluation → approval with canary ledger evidence → VALID; binding changes invalidate it, naming what changed', async () => {
    const s = startQualificationRun({ providerId: PUB, modelId: 'pub-large', taskClass: 'literal_transformation', actor: 'operator' });
    if (!s.ok) throw new Error(s.error);
    const ex = await executeQualificationCases({ runId: s.runId, workspaceId: WS, source: 'CANARY', actor: 'operator' });
    expect(ex).toMatchObject({ ok: true, recorded: 6, refused: [] });
    expect(requests.every((q) => q.route === 'pub' && q.model === 'pub-large')).toBe(true);
    const ev = evaluateRun(s.runId);
    expect(ev).toMatchObject({ ok: true, status: 'PASSED', quality: 1, reliability: 1 });
    const ap = approveQualification({ runId: s.runId, actor: 'operator' });
    expect(ap.ok).toBe(true);
    if (!ap.ok) return;
    const q = listQualifications({ providerId: PUB, modelId: 'pub-large', taskClass: 'literal_transformation' }).find((x) => x.qualificationId === ap.qualificationId)!;
    expect(q).toMatchObject({ state: 'VALID', canonicalVersionId: `${PUB}/pub-large`, deploymentId: 'default', suite: 'suite.literal@1.0.0', approvedBy: 'operator' });
    expect(q.evidence.usageIds!.length).toBe(6);
    expect(q.scope).toMatchObject({ outputContract: 'LITERAL', privacyClass: 'STANDARD' });

    // The route's endpoint changes → INVALIDATED (the resolved endpoint).
    const prev = process.env.SYNTHETIC_PUB_BASE_URL;
    process.env.SYNTHETIC_PUB_BASE_URL = `http://127.0.0.1:${port}/pub2/v1`;
    const inv = listQualifications({ providerId: PUB, modelId: 'pub-large', taskClass: 'literal_transformation' }).find((x) => x.qualificationId === ap.qualificationId)!;
    expect(inv.state).toBe('INVALIDATED');
    expect(inv.stateReasons.join(' ')).toMatch(/resolved endpoint changed/);
    process.env.SYNTHETIC_PUB_BASE_URL = prev;
    expect(listQualifications({ providerId: PUB, modelId: 'pub-large', taskClass: 'literal_transformation' }).find((x) => x.qualificationId === ap.qualificationId)!.state).toBe('VALID');
    expect(revokeQualification(ap.qualificationId, 'operator', 'test done')).toBe(true);
  });

  it('approval refuses a run without canary evidence backed by a SUCCESS ledger row', () => {
    const s = startQualificationRun({ providerId: PUB, modelId: 'pub-large', taskClass: 'literal_transformation', actor: 'operator' });
    if (!s.ok) throw new Error(s.error);
    for (let rep = 1; rep <= 2; rep++) for (const c of s.suite.cases) {
      getDatabase(); // results recorded as SANDBOX, without ledger rows
      const out = c.check.type === 'EXACT' ? c.check.expected : '';
      recordCaseResult(s.runId, { caseId: c.caseId, repetition: rep, output: out, termination: 'COMPLETE', usageId: null, receiptId: null, source: 'SANDBOX' });
    }
    expect(evaluateRun(s.runId)).toMatchObject({ ok: true, status: 'PASSED' });
    expect(approveQualification({ runId: s.runId, actor: 'operator' })).toMatchObject({ ok: false, error: expect.stringMatching(/no canary evidence/) });
  });

  it('direct and aggregator routes are qualified SEPARATELY; nothing executes unqualified for its task class', async () => {
    clearQualifications();
    qualify(PUB, 'pub-large', 'content_generation');
    expect(findQualification(PUB, 'pub-large', { taskClass: 'content_generation' }).ok).toBe(true);
    expect(findQualification(AGG, `${PUB}/pub-large`, { taskClass: 'content_generation' }).ok).toBe(false);
    expect(findQualification(PUB, 'pub-large', { taskClass: 'summarization' }).ok).toBe(false);
    // The spend guard enforces it on a direct call too.
    const r = await runWithRouteContext({ taskClass: 'summarization' }, () => guardedPaidCall({ provider: PUB, model: 'pub-large', callSite: 'x.unmapped', workspaceId: WS, idempotencyKey: `uq-${Date.now()}`, inputChars: 10, maxOutputTokens: 10 }, async () => ({ ok: true })));
    expect(r).toMatchObject({ permitted: false, code: 'MODEL_NOT_QUALIFIED_FOR_TASK' });
    const u = await guardedPaidCall({ provider: PUB, model: 'pub-large', callSite: 'x.unmapped', workspaceId: WS, idempotencyKey: `uc-${Date.now()}`, inputChars: 10, maxOutputTokens: 10 }, async () => ({ ok: true }));
    expect(u).toMatchObject({ permitted: false, code: 'TASK_CLASS_UNKNOWN' });
    expect(requests).toHaveLength(0);
  });

  it('a qualification expires, and a price change invalidates it', () => {
    clearQualifications();
    const id = qualify(PUB, 'pub-small', 'content_generation');
    getDatabase().prepare('UPDATE registry_qualifications SET expires_at = ? WHERE qualification_id = ?').run(iso(Date.now() - 1000), id);
    expect(listQualifications({ providerId: PUB, modelId: 'pub-small' })[0]).toMatchObject({ state: 'EXPIRED' });
    clearQualifications();
    qualify(PUB, 'pub-small', 'content_generation');
    importManifest(manifest(PUB, [
      model('pub-large', { family: { familyId: 'pub-family', displayName: 'Pub family', publisher: PUB }, canonicalVersionId: `${PUB}/pub-large` }),
      model('pub-small', { limits: { contextTokens: 8000, outputTokens: 256 }, pricing: [price(0.6, 1)] }),
    ], {}, 'syn-2'), { source: 'PLUGIN', actor: 'test' });
    const q = listQualifications({ providerId: PUB, modelId: 'pub-small' })[0];
    expect(q.state).toBe('INVALIDATED');
    expect(q.stateReasons.join(' ')).toMatch(/pricing rates/);
    // restore
    importManifest(manifest(PUB, [
      model('pub-large', { family: { familyId: 'pub-family', displayName: 'Pub family', publisher: PUB }, canonicalVersionId: `${PUB}/pub-large` }),
      model('pub-small', { limits: { contextTokens: 8000, outputTokens: 256 }, pricing: [price(0.5, 1)] }),
    ], {}, 'syn-3'), { source: 'PLUGIN', actor: 'test' });
    expect(qualifyModel(PUB, 'pub-small', 'test').ok).toBe(true);
    expect(enableModel(PUB, 'pub-small', 'test').ok).toBe(true);
    clearQualifications();
  });

  it('task classes are registry data, including the twelve named classes', () => {
    const ids = listTaskClasses().map((c) => c.taskClassId);
    for (const id of ['literal_transformation', 'json_extraction', 'summarization', 'research_synthesis', 'planning', 'coding', 'code_review', 'tool_use', 'long_context_reasoning', 'image_understanding', 'speech', 'agent_orchestration']) expect(ids).toContain(id);
    expect(fs.readFileSync(path.join(process.cwd(), 'lib/registry/data/task-classes.json'), 'utf8')).toContain('"taskClassId": "planning"');
  });
});

// ============================================================================
describe('canonical router — hard filters, explicit versioned scoring, modes, evidence', () => {
  beforeEach(() => {
    clearQualifications();
    qualify(PUB, 'pub-large', 'content_generation', 0.95, 0.97);
    qualify(PUB, 'pub-small', 'content_generation', 0.8, 0.9);
    qualify(AGG, `${PUB}/pub-large`, 'content_generation', 0.95, 0.97);
    qualify(LOC, 'loc-1', 'content_generation', 0.8, 0.9);
    setWorkspaceRouting(WS, {}, 'test');
  });

  it('default mode: best qualified DIRECT/LOCAL route; aggregators are not permitted unless allowed', () => {
    const d = routeTask({ workspaceId: WS, requirements: req(), persist: false });
    expect(d.outcome).toBe('SELECTED');
    expect(d.selected).toMatchObject({ providerId: PUB, modelId: 'pub-large', canonicalVersionId: `${PUB}/pub-large`, routeKind: 'DIRECT', deploymentId: 'default' });
    expect(d.candidates.find((c) => c.providerId === AGG)!.disqualified.map((x) => x.code)).toContain('ROUTE_KIND_NOT_PERMITTED');
    expect(d.explanation).toMatch(/Selected synthetic-pub\/pub-large directly from its publisher/);
    expect(d.policy).toEqual({ policyId: 'router.default', version: '1.0.0' });
    const best = d.candidates.find((c) => c.routeKey === `${PUB}/pub-large@default`)!;
    expect(best.scoreBreakdown!.find((x) => x.weight === 'quality')).toMatchObject({ w: 0.3, value: 0.95 });
  });

  it('LOWEST_COST_QUALIFIED weights cost; AGGREGATORS_ALLOWED admits the aggregator; FREE_WHEN_QUALIFIED prefers the free local route', () => {
    const cheap = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { mode: 'LOWEST_COST_QUALIFIED', prohibited: [LOC] } });
    expect(cheap.selected!.modelId).toBe('pub-small');
    expect(cheap.selected!.estimatedCostUsd).toBe(Math.min(...cheap.candidates.filter((c) => !c.disqualified.length).map((c) => c.estimatedCostUsd ?? Infinity)));
    expect(cheap.candidates.find((c) => c.modelId === 'pub-small')!.features!.cost).toBe(1);
    const agg = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { mode: 'AGGREGATORS_ALLOWED', prohibited: [PUB, LOC] } });
    expect(agg.selected).toMatchObject({ providerId: AGG, canonicalVersionId: `${PUB}/pub-large`, routeKind: 'AGGREGATOR' });
    const free = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { mode: 'FREE_WHEN_QUALIFIED' } });
    expect(free.selected).toMatchObject({ providerId: LOC, routeKind: 'LOCAL' });
  });

  it('LOCAL_ONLY, DIRECT_PROVIDER_ONLY, PRIVACY_FIRST and residency are hard filters', () => {
    expect(routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { mode: 'LOCAL_ONLY' } }).selected!.providerId).toBe(LOC);
    const direct = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { mode: 'DIRECT_PROVIDER_ONLY' } });
    expect(direct.selected!.routeKind).toBe('DIRECT');
    expect(direct.candidates.find((c) => c.providerId === LOC)!.disqualified.map((x) => x.code)).toContain('ROUTE_KIND_NOT_PERMITTED');
    const priv = routeTask({ workspaceId: WS, requirements: req('content_generation', { privacyClass: 'ZERO_RETENTION' }), persist: false });
    expect(priv.selected!.providerId).toBe(LOC);
    expect(priv.candidates.find((c) => c.providerId === PUB && c.modelId === 'pub-large')!.disqualified.map((x) => x.code)).toContain('PRIVACY');
    const res = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { regions: ['eu-west'] } });
    expect(res.outcome).toBe('NO_ELIGIBLE_ROUTE');
    expect(res.candidates.every((c) => c.disqualified.some((x) => x.code === 'RESIDENCY'))).toBe(true);
  });

  it('pinning: PINNED_MODEL_VERSION picks among routes of that version; PINNED_ROUTE never substitutes', () => {
    const v = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { pinnedVersion: `${PUB}/pub-large`, permittedAggregators: [AGG] } });
    expect(v.mode).toBe('PINNED_MODEL_VERSION');
    expect(v.selected!.canonicalVersionId).toBe(`${PUB}/pub-large`);
    expect(v.candidates.filter((c) => !c.disqualified.length).map((c) => c.providerId).sort()).toEqual([AGG, PUB]);
    const r = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { pinnedRoute: { providerId: PUB, modelId: 'pub-small' }, prohibited: [`${PUB}/pub-small`] } });
    expect(r.outcome).toBe('NO_ELIGIBLE_ROUTE');
    expect(r.selected).toBeNull();
    expect(r.explanation).toMatch(/The pinned route synthetic-pub\/pub-small cannot run[\s\S]*PROHIBITED[\s\S]*no other model was substituted/);
  });

  it('context, output and contract capacity: a LITERAL answer that cannot fit one response is never routed to a small-output model', () => {
    const lit = requirementsFor({ taskClass: 'content_generation', outputContract: 'LITERAL', inputChars: 400, expectedOutputTokens: 1000 });
    if ('error' in lit) throw new Error(lit.error);
    const d = routeTask({ workspaceId: WS, requirements: lit, persist: false, constraints: { prohibited: [LOC] } });
    expect(d.candidates.find((c) => c.modelId === 'pub-small')!.disqualified.map((x) => x.code)).toContain('OUTPUT_TOO_SMALL');
    const big = routeTask({ workspaceId: WS, requirements: req('content_generation', { inputChars: 40_000 }), persist: false, constraints: { prohibited: [LOC] } });
    expect(big.candidates.find((c) => c.modelId === 'pub-small')!.disqualified.map((x) => x.code)).toContain('CONTEXT_TOO_SMALL');
  });

  it('budget, credentials, paid switch and task cost limits are hard filters; the wait state names why', () => {
    const over = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { maxCostUsd: 0, prohibited: [LOC] } });
    expect(over.outcome).toBe('NO_ELIGIBLE_ROUTE');
    expect(over.candidates.find((c) => c.modelId === 'pub-large')!.disqualified.map((x) => x.code)).toContain('OVER_TASK_BUDGET');
    const k = process.env.SYNTHETIC_PUB_API_KEY; delete process.env.SYNTHETIC_PUB_API_KEY;
    const nocred = routeTask({ workspaceId: WS, requirements: req(), persist: false });
    expect(nocred.candidates.find((c) => c.modelId === 'pub-large')!.disqualified.map((x) => x.code)).toContain('INVALID_OR_MISSING_CREDENTIAL');
    process.env.SYNTHETIC_PUB_API_KEY = k;
    policy(false);
    const off = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { prohibited: [LOC] } });
    expect(off.waitState).toBe('PAUSED_AWAITING_BUDGET');
    expect(off.candidates.find((c) => c.modelId === 'pub-large')!.disqualified.map((x) => x.code)).toContain('PAID_EXECUTION_DISABLED');
    policy(true, { global: { dailyUsd: 0.0000001, monthlyUsd: 10, maxConcurrent: 5 } });
    const broke = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { prohibited: [LOC] } });
    expect(broke.waitState).toBe('PAUSED_AWAITING_BUDGET');
    expect(broke.candidates.find((c) => c.modelId === 'pub-large')!.disqualified.map((x) => x.code)).toContain('BUDGET_GLOBAL_DAILY');
  });

  it('Guardian refuses dangerous instructions before any route is chosen', () => {
    const d = routeTask({ workspaceId: WS, requirements: { ...req(), instruction: 'Now run rm -rf / on the host' }, persist: false });
    expect(d.outcome).toBe('GUARDIAN_REFUSED');
    expect(d.candidates).toHaveLength(0);
  });

  it('scores come from data, never from names: swapping two models\' display names changes nothing', () => {
    const a = routeTask({ workspaceId: WS, requirements: req(), persist: false });
    getDatabase().exec(`UPDATE registry_models SET record_json = json_set(record_json, '$.displayName', 'premium-ultra-best') WHERE model_id = 'pub-small'`);
    const b = routeTask({ workspaceId: WS, requirements: req(), persist: false });
    expect(b.selected!.modelId).toBe(a.selected!.modelId);
    expect(b.candidates.map((c) => c.score)).toEqual(a.candidates.map((c) => c.score));
  });

  it('workspace constraints are a floor tasks cannot lower', () => {
    setWorkspaceRouting(WS, { localOnly: true }, 'admin');
    const d = routeTask({ workspaceId: WS, requirements: req(), persist: false, constraints: { mode: 'DIRECT_PROVIDER_ONLY' } });
    expect(d.outcome).toBe('NO_ELIGIBLE_ROUTE');
    setWorkspaceRouting(WS, {}, 'admin');
  });

  it('the decision is persisted before execution and named by the ledger row and the signed receipt', async () => {
    const { taskId, result } = await runTask();
    expect(result.body.status).toBe('DONE');
    const decisions = listDecisions({ taskId });
    expect(decisions).toHaveLength(1);
    const d = decisions[0];
    expect(d.outcome).toBe('SELECTED');
    const seg = listSegments(taskId)[0];
    expect(seg).toMatchObject({ routingDecisionId: d.decisionId, providerId: d.selected!.providerId, canonicalVersionId: d.selected!.canonicalVersionId, status: 'COMPLETED' });
    const row = listUsageForKey(`rk-${taskId}`)[0];
    expect(row).toMatchObject({ routing_decision_id: d.decisionId, segment_id: seg.segmentId, canonical_version_id: d.selected!.canonicalVersionId, deployment_id: 'default', task_class: 'content_generation', status: 'SUCCESS' });
    expect(Date.parse(d.createdAt)).toBeLessThanOrEqual(Date.parse(row.created_at));
    const rc = getTaskReceipts(taskId)[0];
    expect(verifyReceipt(rc)).toBe(true);
    expect(JSON.parse(rc.payload_json)).toMatchObject({ routingDecisionId: d.decisionId, canonicalVersionId: d.selected!.canonicalVersionId, deploymentId: 'default', taskClass: 'content_generation', segmentIds: [seg.segmentId], segmentCount: 1, priceVersion: row.price_version });
    expect(result.body.routing.explanation).toBe(d.explanation);
  });
});

// ============================================================================
describe('execution continuity — checkpoints, qualified switching, pauses, no silent fallback', () => {
  beforeEach(() => {
    clearQualifications();
    qualify(PUB, 'pub-large', 'content_generation', 0.95, 0.97);
    qualify(AGG, `${PUB}/pub-large`, 'content_generation', 0.95, 0.97);
    qualify(PUB, 'pub-small', 'content_generation', 0.7, 0.8);
    qualify(PUB, 'pub-large', 'literal_transformation', 0.99, 0.99);
    // The publisher route is preferred (the aggregator is cheaper and would otherwise win first).
    setWorkspaceRouting(WS, { permittedAggregators: [AGG], prohibited: [LOC], preferred: [PUB] }, 'test');
  });

  it('capacity exhaustion on one route: signed checkpoint, qualified same-or-stronger switch, one chain, DONE — and no bounce back', async () => {
    mode.pub = '429';
    const { taskId, result } = await runTask();
    expect(result.body.status).toBe('DONE');
    // Route A was tried once and rejected (429); route B (same canonical version) completed.
    expect(requests.map((r) => r.route)).toEqual(['pub', 'agg']);
    const segs = listSegments(taskId);
    expect(segs.map((s) => [s.providerId, s.status])).toEqual([[PUB, 'FAILED'], [AGG, 'COMPLETED']]);
    expect(segs[1].checkpointRef).toBeTruthy();
    expect(segs.every((s) => s.canonicalVersionId === `${PUB}/pub-large`)).toBe(true);
    // The weaker pub-small route was NOT eligible as a replacement.
    const second = listDecisions({ taskId }).find((d) => d.selected?.providerId === AGG)!;
    const small = second.candidates.find((c) => c.modelId === 'pub-small')!;
    expect(small.disqualified.map((x) => x.code)).toContain('NOT_QUALIFIED');
    expect(small.disqualified.map((x) => x.reason).join(' ')).toMatch(/qualified quality 0.7 < required 0.95/);
    expect(second.candidates.find((c) => c.routeKey === `${PUB}/pub-large@default`)!.disqualified.map((x) => x.code)).toContain('ROUTE_EXCLUDED');
    // Checkpoint: signed, verified, lists the paid call as a performed side effect that must not repeat.
    const ck = listCheckpoints(taskId)[0];
    expect(ck.verified).toBe(true);
    expect(ck.payload.reason).toBe('ROUTE_CAPACITY');
    expect(ck.payload.prohibitedRepeats).toEqual([]);
    // Receipt carries the whole segment chain; activity shows the switch.
    const payload = JSON.parse(getTaskReceipts(taskId)[0].payload_json);
    expect(payload.segmentIds).toEqual(segs.map((s) => s.segmentId));
    const ev = (getDatabase().prepare('SELECT event_type FROM activity_events WHERE task_id = ? ORDER BY rowid').all(taskId) as any[]).map((e) => e.event_type);
    for (const e of ['ROUTING_DECIDED', 'SEGMENT_STARTED', 'SEGMENT_COMPLETED', 'CHECKPOINT_CREATED', 'ROUTE_SWITCH_PROPOSED', 'ROUTE_SWITCHED', 'RECEIPT_CREATED']) expect(ev).toContain(e);
    expect(getContinuity(taskId)!.state).toBe('DONE');
  });

  it('with no qualified replacement the task PAUSES (never a weaker model, never FAILED), and the scheduler resumes it when capacity returns', async () => {
    setWorkspaceRouting(WS, { prohibited: [LOC], preferred: [PUB] }, 'test'); // aggregators not permitted
    mode.pub = '429';
    const { taskId, result } = await runTask();
    expect(result.status).toBe(202);
    expect(result.body.status).toBe('PAUSED_AWAITING_CAPACITY');
    expect(requests.map((r) => r.model)).toEqual(['pub-large']);
    expect(getTaskWithHistory(taskId).task!.status).toBe('PAUSED_AWAITING_CAPACITY');
    expect(TASK_TERMINAL_STATUSES as readonly string[]).not.toContain('PAUSED_AWAITING_CAPACITY');
    expect(ORCHESTRATOR_ELIGIBLE_STATUSES as readonly string[]).not.toContain('PAUSED_AWAITING_CAPACITY');
    // While the route is cooling down, the sweep keeps it paused.
    expect(continuityTickForScheduler().resumed).not.toContain(taskId);
    // Cool-down passes; the sweep moves it back to READY (it dispatches nothing itself).
    const c = getContinuity(taskId)!;
    const ex = Object.fromEntries(Object.entries(c.excludedRoutes).map(([k, v]) => [k, { ...v, since: iso(Date.now() - 60 * 60_000) }]));
    getDatabase().prepare('UPDATE task_continuity SET excluded_routes_json = ? WHERE task_id = ?').run(JSON.stringify(ex), taskId);
    getDatabase().exec("DELETE FROM runtime_events WHERE target_type = 'provider'");
    resetResumeThrottleForTests();
    const before = requests.length;
    expect(continuityTickForScheduler().resumed).toContain(taskId);
    expect(requests.length).toBe(before);
    expect(getTaskWithHistory(taskId).task!.status).toBe('READY');
  });

  it('NARRATIVE output pressure: the next segment continues from a signed checkpoint and the verified assembly is DONE', async () => {
    mode.pub = 'truncate-then-ok';
    const { taskId, result } = await runTask({ routing: { prohibited: [AGG, LOC] } });
    expect(result.body.status).toBe('DONE');
    const segs = listSegments(taskId);
    expect(segs.map((s) => s.status)).toEqual(['INCOMPLETE', 'COMPLETED']);
    expect(requests[1].content).toMatch(/You are continuing a task/);
    expect(requests[1].content).toMatch(/Part one of the narrative, cut/);
    expect(result.body.outputs).toBe('Part one of the narrative, cutA complete narrative answer.');
    expect(listCheckpoints(taskId)[0].payload.reason).toBe('OUTPUT_CAPACITY');
  });

  it('LITERAL output pressure: never split — the truncated answer is INCOMPLETE, one call, no continuation', async () => {
    mode.pub = 'truncate';
    const { taskId, result } = await runTask({ outputContract: { mode: 'LITERAL', literal: 'ROUTER OK' }, routing: { prohibited: [AGG, LOC] } });
    expect(result.body.status).toBe('INCOMPLETE');
    expect(requests).toHaveLength(1);
    expect(listSegments(taskId).map((s) => s.status)).toEqual(['INCOMPLETE']);
  });

  it('paid execution OFF: the task waits PAUSED_AWAITING_BUDGET with zero requests, and resumes when the switch opens', async () => {
    policy(false);
    const { taskId, result } = await runTask();
    expect(result.body.status).toBe('PAUSED_AWAITING_BUDGET');
    expect(requests).toHaveLength(0);
    resetResumeThrottleForTests();
    expect(continuityTickForScheduler().resumed).not.toContain(taskId);
    policy(true);
    resetResumeThrottleForTests();
    expect(continuityTickForScheduler().resumed).toContain(taskId);
    expect(getTaskWithHistory(taskId).task!.status).toBe('READY');
  });
});

// ============================================================================
describe('unknown outcomes and side effects — never blindly retried', () => {
  beforeEach(() => {
    clearQualifications();
    qualify(PUB, 'pub-large', 'content_generation');
    qualify(AGG, `${PUB}/pub-large`, 'content_generation');
    setWorkspaceRouting(WS, { permittedAggregators: [AGG], prohibited: [LOC], preferred: [PUB] }, 'test');
  });

  it('a 5xx after dispatch → RECONCILING_UNKNOWN_EXECUTION; no retry, no switch, re-running is refused until reconciled', async () => {
    mode.pub = '500';
    const { taskId, result } = await runTask();
    expect(result.body.status).toBe('RECONCILING_UNKNOWN_EXECUTION');
    expect(requests.map((r) => r.route)).toEqual(['pub']); // the aggregator was NOT tried
    const seg = listSegments(taskId)[0];
    expect(seg.status).toBe('UNKNOWN');
    expect(listUsageForKey(`rk-${taskId}`)[0].status).toBe('UNKNOWN');
    // A second run of the same task (a requeue, a bug) is refused before any call.
    const again = await executeAgentTask({ taskId, taskTitle: 'Router task', description: 'Write two sentences about the store.', assignedAgent: 'scribe', assignedModel: '', spendIdempotencyKey: `rk-${taskId}` } as any, WS, createExecutionContext({ workspaceId: WS }));
    expect((again.body as any).status).toBe('RECONCILING_UNKNOWN_EXECUTION');
    expect(requests).toHaveLength(1);
    // The sweep never resumes an ambiguous task.
    resetResumeThrottleForTests();
    expect(continuityTickForScheduler().resumed).not.toContain(taskId);
    // Resolution needs evidence; NOT_ACCEPTED is the proof that lets it continue.
    expect(resolveUnknownSegment({ taskId, segmentId: seg.segmentId, resolution: 'NOT_ACCEPTED', actor: 'op', evidence: '' })).toMatchObject({ ok: false });
    expect(resolveUnknownSegment({ taskId, segmentId: seg.segmentId, resolution: 'NOT_ACCEPTED', actor: 'op', evidence: 'provider dashboard shows no request r-1' })).toMatchObject({ ok: true, state: 'READY' });
    expect(listUsageForKey(`rk-${taskId}`)[0].status).toBe('OPERATOR_CLEARED');
    mode.pub = 'ok';
    const done = await executeAgentTask({ taskId, taskTitle: 'Router task', description: 'Write two sentences about the store.', assignedAgent: 'scribe', assignedModel: '', spendIdempotencyKey: `rk-${taskId}` } as any, WS, createExecutionContext({ workspaceId: WS }));
    expect((done.body as any).status).toBe('DONE');
    // The reconciled route is excluded for its cool-down: the continuation ran on the other qualified route.
    expect(requests.map((r) => r.route)).toEqual(['pub', 'agg']);
    expect(listSegments(taskId).map((s) => s.status)).toEqual(['NOT_ACCEPTED', 'COMPLETED']);
  });

  it('side effects carry durable idempotency keys; a performed one can never be repeated and is listed in the checkpoint', () => {
    const taskId = `se-${Date.now()}`;
    openContinuity({ taskId, workspaceId: WS, taskClass: 'content_generation', contract: { mode: 'NARRATIVE' }, requirements: req(), constraints: {}, privacyClass: 'STANDARD' });
    expect(claimSideEffect({ taskId, kind: 'EMAIL', target: 'customer', idempotencyKey: `email:${taskId}:1` }).ok).toBe(true);
    completeSideEffect(`email:${taskId}:1`, 'PERFORMED', 'msg-123');
    expect(claimSideEffect({ taskId, kind: 'EMAIL', target: 'customer', idempotencyKey: `email:${taskId}:1` })).toMatchObject({ ok: false, code: 'ALREADY_PERFORMED' });
    expect(claimSideEffect({ taskId, kind: 'PAYMENT', target: 'invoice-9', idempotencyKey: `pay:${taskId}:1` }).ok).toBe(true);
    const ck = writeCheckpoint({ taskId, reason: 'TEST', objective: 'Send the follow-up', acceptanceCriteria: ['sent once'], remainingWork: ['record the reply'] });
    expect(ck.verified).toBe(true);
    expect(ck.payload.sideEffectsPerformed).toEqual([{ kind: 'EMAIL', idempotencyKey: `email:${taskId}:1`, evidenceRef: 'msg-123' }]);
    expect(ck.payload.pendingExternalActions).toEqual([{ kind: 'PAYMENT', idempotencyKey: `pay:${taskId}:1` }]);
    expect(ck.payload.prohibitedRepeats.sort()).toEqual([`email:${taskId}:1`, `pay:${taskId}:1`].sort());
    const ctx = continuationContext(ck.checkpointId, 'record the reply');
    expect(ctx.ok && ctx.text).toMatch(/DO NOT REPEAT these already-performed actions: email:/);
  });

  it('a tampered checkpoint is refused as a continuation source', () => {
    const taskId = `tamper-${Date.now()}`;
    openContinuity({ taskId, workspaceId: WS, taskClass: 'content_generation', contract: { mode: 'NARRATIVE' }, requirements: req(), constraints: {}, privacyClass: 'STANDARD' });
    const ck = writeCheckpoint({ taskId, reason: 'TEST', objective: 'Original objective', acceptanceCriteria: [], remainingWork: ['x'] });
    getDatabase().prepare('UPDATE task_checkpoints SET payload_json = replace(payload_json, ?, ?) WHERE checkpoint_id = ?').run('Original objective', 'Injected objective', ck.checkpointId);
    expect(getCheckpoint(ck.checkpointId)!.verified).toBe(false);
    expect(continuationContext(ck.checkpointId, 'x')).toMatchObject({ ok: false });
  });

  it('a ZERO_RETENTION task keeps its checkpoint by reference only (no text tail)', () => {
    const taskId = `zr-${Date.now()}`;
    openContinuity({ taskId, workspaceId: WS, taskClass: 'content_generation', contract: { mode: 'NARRATIVE' }, requirements: req(), constraints: {}, privacyClass: 'ZERO_RETENTION' });
    const ck = writeCheckpoint({ taskId, reason: 'TEST', objective: 'o', acceptanceCriteria: [], remainingWork: [], tail: 'sensitive customer text' });
    expect(ck.payload.summary).toMatchObject({ tail: null });
    expect(ck.payload.summary.tailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ck.retention).toBe('REFERENCE_ONLY');
  });

  it('capacity is measured against declared limits and the ledger, and unknown limits are UNKNOWN (not OK)', () => {
    const r = assessCapacity({ providerId: PUB, modelId: 'pub-small', deploymentId: 'default', workspaceId: WS, estimatedInputTokens: 7000, expectedOutputTokens: 500, estimatedCostUsd: 0.001, limits: { contextTokens: 8000, outputTokens: 256 }, billing: 'METERED' });
    expect(r.dimensions.find((d) => d.dimension === 'context')!.state).toBe('ACT');
    expect(r.dimensions.find((d) => d.dimension === 'output')!.state).toBe('EXHAUSTED');
    expect(r.dimensions.find((d) => d.dimension === 'rate.requests_per_minute')!.state).toBe('UNKNOWN');
  });

  it('every continuity state is non-terminal and not auto-eligible', () => {
    for (const s of [...PAUSE_STATES, 'RECONCILING_UNKNOWN_EXECUTION', 'CHECKPOINTING', 'ROUTE_SWITCHING', 'AWAITING_CONTINUATION', 'RESUMING']) {
      expect(TASK_TERMINAL_STATUSES as readonly string[]).not.toContain(s);
      expect(ORCHESTRATOR_ELIGIBLE_STATUSES as readonly string[]).not.toContain(s);
    }
  });
});

// ============================================================================
describe('routing-performance evidence — learned from verified runs, applied only by approval', () => {
  it('samples are recorded per verified execution; nothing changes the router until an approved proposal', async () => {
    clearQualifications();
    qualify(PUB, 'pub-large', 'content_generation');
    setWorkspaceRouting(WS, { prohibited: [LOC] }, 'test');
    await runTask();
    const n = (getDatabase().prepare("SELECT COUNT(*) n FROM routing_performance_samples WHERE provider_id = ? AND verified = 1").get(PUB) as any).n;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(approvedRouteStats(PUB, 'pub-large', 'content_generation')).toBeNull();
    for (let i = 0; i < 4; i++) recordPerformanceSample({ taskClass: 'content_generation', providerId: PUB, modelId: 'pub-large', completed: true, instructionCompliance: true, integrity: true, verified: true, latencyMs: i === 3 ? 90_000 : 1000, costUsd: 0.001 });
    const tooFew = proposeRouteStats({ actor: 'op', minSamples: 1000, trimFraction: 0.1 });
    expect(tooFew.proposalId).toBeNull();
    const p = proposeRouteStats({ actor: 'op', minSamples: 3, trimFraction: 0.1 });
    expect(p.proposalId).toBeTruthy();
    expect(approvedRouteStats(PUB, 'pub-large', 'content_generation')).toBeNull(); // proposing changes nothing
    expect(decideProposal({ proposalId: p.proposalId!, actor: 'op', approve: true }).ok).toBe(true);
    const st = approvedRouteStats(PUB, 'pub-large', 'content_generation')!;
    expect(st.medianLatencyMs).toBeLessThan(90_000); // the outlier does not dominate
    const d = routeTask({ workspaceId: WS, requirements: req(), persist: false });
    expect(d.candidates.find((c) => c.routeKey === `${PUB}/pub-large@default`)!.features!.completion).toBe(1);
  });

  it('a weight change is a PROPOSAL; approval creates a new, active policy version (the old one is kept)', () => {
    const base = activePolicy();
    const pr = proposePolicyWeights({ actor: 'op', basePolicyId: base.policyId, baseVersion: base.version, newVersion: '1.1.0', weights: { cost: 0.2, quality: 0.2 }, rationale: 'test' });
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;
    expect(activePolicy().version).toBe('1.0.0');
    expect(decideProposal({ proposalId: pr.proposalId, actor: 'op', approve: true }).ok).toBe(true);
    expect(activePolicy()).toMatchObject({ version: '1.1.0', weights: { cost: 0.2, quality: 0.2 } });
    expect(listPolicies().map((p) => `${p.version}:${p.status}`).sort()).toEqual(['1.0.0:SUPERSEDED', '1.1.0:ACTIVE']);
  });
});

// ============================================================================
describe('no live provider contact from this file', () => {
  it('every request went to the local double', () => {
    expect(requests.every((r) => ['pub', 'agg', 'loc'].includes(r.route))).toBe(true);
    const hosts = (getDatabase().prepare('SELECT DISTINCT provider FROM provider_usage').all() as any[]).map((r) => r.provider);
    for (const h of hosts) expect([PUB, AGG, LOC]).toContain(h);
  });

  it('continuityView is stable for a task with no continuity', () => {
    expect(continuityView('no-such-task')).toEqual({ continuity: null, segments: [], checkpoints: [], sideEffects: [] });
  });

  it('decisions for a hypothetical preview are not persisted', () => {
    const before = listDecisions({ limit: 200 }).length;
    routeTask({ workspaceId: WS, requirements: req(), persist: false });
    expect(listDecisions({ limit: 200 }).length).toBe(before);
    expect(getDecision('missing')).toBeNull();
    expect(getRun('missing')).toBeNull();
  });
});
