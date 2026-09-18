import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// QUEUED-TASK REVIEW, RUNTIME VERSION, AND AUTHORITY INDEPENDENCE.
// Temp database; no provider of any kind.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-queue-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'queue.db');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('queue');

import { getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { reviewQueuedTasks, applyQueueAction } from '../lib/task-queue-review';
import { runtimeVersionReport } from '../lib/build-info';
import { ensureRegistry, enableModel, disableModel, qualifyModel } from '../lib/registry';
import { importManifest, getAdminRow } from '../lib/registry/store';
import { saveSpendPolicy, getSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureContinuityTables } from '../lib/continuity/controller';

const WS = 'ws-queue';
const OTHER = 'ws-queue-other';
const legacy = (id: string, status: string, extra: Partial<{ model: string; eligible: number; ws: string }> = {}) => {
  getDatabase().prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at, autonomy_eligible) VALUES (?, ?, 'Legacy', 'd', 'technical', ?, ?, '2026-09-10T19:46:44.913Z', '2026-09-10T19:46:44.913Z', ?)")
    .run(id, extra.ws ?? WS, extra.model ?? 'n/a', status, extra.eligible ?? 0);
  getDatabase().prepare("INSERT INTO task_status_history (task_id, status, created_at) VALUES (?, ?, '2026-09-10T19:46:44.913Z')").run(id, status);
};
const snapshot = () => ({
  tasks: getDatabase().prepare('SELECT * FROM tasks ORDER BY task_id').all(),
  history: getDatabase().prepare('SELECT * FROM task_status_history ORDER BY id').all(),
  activity: getDatabase().prepare('SELECT * FROM activity_events ORDER BY rowid').all(),
});

beforeAll(() => {
  getDatabase(); ensureWorkspace(WS, 'Queue'); ensureWorkspace(OTHER, 'Other'); ensureRegistry(); ensureContinuityTables();
  legacy('aeo-task-legacy-1', 'TODO');
  legacy('conv-handoff-legacy-1', 'READY');
  legacy('classed-1', 'READY', { model: '' });
  getDatabase().prepare("INSERT INTO task_continuity (task_id, workspace_id, task_class, contract_json, requirements_json, constraints_json, state, created_at, updated_at) VALUES ('classed-1', ?, 'literal_transformation', '{\"mode\":\"LITERAL\",\"literal\":\"X\"}', '{}', '{}', 'AWAITING_CONTINUATION', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')").run(WS);
});

describe('queued-task review', () => {
  it('legacy tasks are listed with every required field and cannot execute, and reviewing mutates nothing', () => {
    const before = snapshot();
    const rows = reviewQueuedTasks({ workspaceId: WS });
    expect(snapshot()).toEqual(before);
    const aeo = rows.find((r) => r.taskId === 'aeo-task-legacy-1')!;
    expect(aeo).toMatchObject({ workspaceId: WS, createdAt: '2026-09-10T19:46:44.913Z', state: 'TODO', taskClass: null, outputContract: null, assignedModel: 'n/a', pinnedRoute: null, autonomyEligible: false, qualificationValid: false, couldExecuteNow: false });
    expect(aeo.blockedBecause.join(' | ')).toMatch(/not autonomy-eligible/);
    expect(aeo.blockedBecause.join(' | ')).toMatch(/no task class recorded/);
    expect(aeo.blockedBecause.join(' | ')).toMatch(/"n\/a" is not a registered model route/);
    expect(aeo.actions.map((a) => [a.action, a.allowed])).toEqual([['CANCEL', true], ['ARCHIVE', true], ['REQUEUE', false]]);
    const classed = rows.find((r) => r.taskId === 'classed-1')!;
    expect(classed).toMatchObject({ taskClass: 'literal_transformation', outputContract: 'LITERAL', qualificationValid: false, couldExecuteNow: false });
    expect(classed.blockedBecause.join(' | ')).toMatch(/no VALID qualification for literal_transformation/);
  });

  it('actions need confirmation and a reason, are workspace-scoped, and are idempotent', () => {
    expect(applyQueueAction({ workspaceId: WS, taskId: 'aeo-task-legacy-1', action: 'CANCEL', reason: 'legacy', actor: 'op', confirm: false })).toMatchObject({ ok: false, error: expect.stringMatching(/confirmation/) });
    expect(applyQueueAction({ workspaceId: WS, taskId: 'aeo-task-legacy-1', action: 'CANCEL', reason: '', actor: 'op', confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/) });
    expect(applyQueueAction({ workspaceId: OTHER, taskId: 'aeo-task-legacy-1', action: 'CANCEL', reason: 'legacy', actor: 'op', confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/not in workspace/) });
    expect(applyQueueAction({ workspaceId: WS, taskId: 'aeo-task-legacy-1', action: 'REQUEUE', reason: 'try', actor: 'op', confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/no task class/) });
    const first = applyQueueAction({ workspaceId: WS, taskId: 'aeo-task-legacy-1', action: 'CANCEL', reason: 'legacy cleanup', actor: 'op', confirm: true });
    expect(first).toMatchObject({ ok: true, changed: true, state: 'CANCELLED' });
    const again = applyQueueAction({ workspaceId: WS, taskId: 'aeo-task-legacy-1', action: 'CANCEL', reason: 'legacy cleanup', actor: 'op', confirm: true });
    expect(again).toMatchObject({ ok: true, changed: false });
    const hist = (getDatabase().prepare("SELECT status FROM task_status_history WHERE task_id = 'aeo-task-legacy-1' ORDER BY id").all() as any[]).map((r) => r.status);
    expect(hist).toEqual(['TODO', 'CANCELLED']); // appended once, earlier row kept
    const r = applyQueueAction({ workspaceId: WS, taskId: 'classed-1', action: 'REQUEUE', reason: 'operator decided', actor: 'op', confirm: true });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(applyQueueAction({ workspaceId: WS, taskId: 'classed-1', action: 'REQUEUE', reason: 'again', actor: 'op', confirm: true })).toMatchObject({ ok: true, changed: false });
    // Requeue grants eligibility only: with no valid qualification it still cannot execute.
    expect(reviewQueuedTasks({ workspaceId: WS }).find((x) => x.taskId === 'classed-1')).toMatchObject({ autonomyEligible: true, couldExecuteNow: false });
  });
});

describe('runtime version report', () => {
  it('reports UNKNOWN for anything not stamped, never a guess; the database schema has a live fingerprint', () => {
    const saved = { ...process.env };
    for (const k of ['SYNTHOS_BUILD_SHA', 'SYNTHOS_BUILD_TIME', 'SYNTHOS_BUILD_REF', 'SYNTHOS_BUILD_TREE', 'SYNTHOS_BUILD_SOURCE']) delete process.env[k];
    try {
      const v = runtimeVersionReport(getDatabase());
      expect(v).toMatchObject({ commit: 'UNKNOWN', buildTime: 'UNKNOWN', ref: 'UNKNOWN', tree: 'UNKNOWN', source: 'UNKNOWN', node: process.version, registrySchema: 'synthos.registry/v1', databaseSchema: { version: 'UNKNOWN' } });
      expect(v.databaseSchema.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(runtimeVersionReport(null).databaseSchema.fingerprint).toBe('UNKNOWN');
      process.env.SYNTHOS_BUILD_SHA = 'a'.repeat(40); process.env.SYNTHOS_BUILD_TREE = 'CLEAN';
      expect(runtimeVersionReport(getDatabase()).commit).toBe('a'.repeat(40));
    } finally { process.env = saved; }
  });

  it('the diagnostics authority and the UI read the same report; git is never run per request', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(server).toContain('runtimeVersion: runtimeVersionReport(getDatabase()),');
    expect(server).toContain('version: readBuildInfo(),');
    const lib = fs.readFileSync(path.join(process.cwd(), 'lib/build-info.ts'), 'utf8');
    expect(lib).not.toMatch(/child_process|execSync|spawn/);
  });
});

describe('qualification, model enablement and execution permission are independent', () => {
  it('enabling a model changes no execution switch; switching local execution changes no model', () => {
    const now = Date.now(); const iso = (ms: number) => new Date(ms).toISOString();
    const r = importManifest({ schemaVersion: 'synthos.registry/v1', manifestVersion: 'q-1', provenance: { publisher: 'synthos-test-fixtures', generatedAt: iso(now) },
      provider: { providerId: 'queue-pub', displayName: 'q', protocol: 'openai.chat_completions', adapterVersion: '1.0.0', approvedHosts: ['api.queue-pub.example'], defaultBaseUrl: 'https://api.queue-pub.example/v1', baseUrlEnvVar: 'QUEUE_PUB_BASE_URL', auth: { type: 'BEARER', credentialSlot: null, envVars: ['QUEUE_PUB_API_KEY'] }, billing: 'METERED', restrictions: { regions: [], compliance: [] } },
      models: [{ modelId: 'm', aliases: [], displayName: 'm', lifecycle: 'ACTIVE', releaseDate: null, deprecationDate: null, shutdownDate: null, limits: { contextTokens: 1000, outputTokens: 100 }, modalities: { input: ['text'], output: ['text'] }, capabilities: [{ id: 'text.output', supported: true, source: 'f', verification: 'PUBLISHER_ASSERTED', effectiveDate: null }], supportedParameters: [], outputContracts: ['LITERAL'],
        pricing: [{ currency: 'USD', unit: 'tokens', rates: { input: 1, output: 1, cachedInput: 1 }, reasoningTokens: 'BILLED_AS_OUTPUT', tiers: [], toolCharges: [], modalityCharges: [], effectiveFrom: iso(now - 1000), effectiveUntil: null, source: 'f', verifiedAt: iso(now), staleAfter: iso(now + 86_400_000), approval: 'APPROVED' }],
        adapterCompatibility: { protocol: 'openai.chat_completions', minAdapterVersion: '1.0.0' }, restrictions: { regions: [], compliance: [] } }] }, { source: 'PLUGIN', actor: 'test' });
    expect(r.ok).toBe(true);
    saveSpendPolicy({ ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: false, localExecutionEnabled: false }, 'test');
    expect(qualifyModel('queue-pub', 'm', 'op').ok).toBe(true);
    const before = getSpendPolicy();
    expect(enableModel('queue-pub', 'm', 'op').ok).toBe(true);
    expect(getSpendPolicy()).toEqual(before);
    expect(saveSpendPolicy({ ...getSpendPolicy(), localExecutionEnabled: true }, 'op').ok).toBe(true);
    expect(getAdminRow('queue-pub', 'm').enabled).toBe(true);
    expect(disableModel('queue-pub', 'm', 'op', 'test').ok).toBe(true);
    expect(getSpendPolicy().localExecutionEnabled).toBe(true);
    expect(getSpendPolicy().paidExecutionEnabled).toBe(false);
    saveSpendPolicy({ ...getSpendPolicy(), localExecutionEnabled: false }, 'op');
  });
});
