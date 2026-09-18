import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// OPERATOR RECONCILIATION OF AN AMBIGUOUS EXECUTION. Temp database; no
// provider of any kind (fetch throws for the whole file).
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-recon-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'recon.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('recon');

import { getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { reconcileAmbiguousExecution, reconciliationTrail, reconciliationGuide, RECONCILIATION_FINDINGS } from '../lib/continuity/orphans';

let fetchCalls = 0;
const WS = 'ws-recon';
const OTHER = 'ws-recon-other';
const START = '2026-09-17T20:48:27.969Z';

const seed = (id: string, ws = WS) => {
  const db = getDatabase();
  db.prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES (?, ?, 'Restart proof', 'Summarise the note in two sentences.', 'scribe', 'gpt-test-model', 'RECONCILING_UNKNOWN_EXECUTION', '2026-09-17T20:48:20.017Z', '2026-09-18T13:30:52.828Z')").run(id, ws);
  for (const [st, at] of [['TODO', '2026-09-17T20:48:20.017Z'], ['RUNNING', START], ['RECONCILING_UNKNOWN_EXECUTION', '2026-09-18T13:30:52.828Z']]) db.prepare('INSERT INTO task_status_history (task_id, status, created_at) VALUES (?, ?, ?)').run(id, st, at);
  db.prepare("INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at) VALUES (?, ?, 'EXECUTION_STARTED', 'scribe', '{}', ?)").run(`act-start-${id}`, id, START);
};
const counts = (id: string) => {
  const db = getDatabase(); const n = (sql: string) => (db.prepare(sql).get(id) as any).n;
  return { artifacts: n('SELECT COUNT(*) n FROM artifacts WHERE task_id = ?'), reviews: n('SELECT COUNT(*) n FROM quality_reviews WHERE task_id = ?'), receipts: n('SELECT COUNT(*) n FROM receipts WHERE task_id = ?'), ledger: (() => { try { return n('SELECT COUNT(*) n FROM provider_usage WHERE task_id = ?'); } catch { return 0; } })() };
};
const history = (id: string) => getDatabase().prepare('SELECT id, status, created_at FROM task_status_history WHERE task_id = ? ORDER BY id').all(id) as any[];
const events = (id: string) => getDatabase().prepare('SELECT event_id, event_type, payload_json, created_at FROM activity_events WHERE task_id = ? ORDER BY rowid').all(id) as any[];
const status = (id: string) => (getDatabase().prepare('SELECT status FROM tasks WHERE task_id = ?').get(id) as any).status;
const audits = (id: string) => getDatabase().prepare("SELECT * FROM admin_audit_events WHERE target_id = ? AND event_type = 'EXECUTION_RECONCILED' ORDER BY created_at").all(id) as any[];

const base = (taskId: string, extra: Record<string, unknown> = {}) => ({
  workspaceId: WS, taskId, actor: 'user-op', finding: 'PROVIDER_CONFIRMED_NO_REQUEST',
  evidenceSource: 'Provider dashboard → Logs → Responses', windowStart: START, windowEnd: '2026-09-17T20:50:00.000Z',
  provider: 'openai', model: 'gpt-test-model', dashboardFinding: 'No response or request in the window for this model.', note: 'Checked the full window; nothing recorded.',
  ...extra,
}) as any;

beforeAll(() => {
  (globalThis as any).fetch = () => { fetchCalls += 1; throw new Error('network forbidden'); };
  getDatabase(); ensureWorkspace(WS, 'Recon'); ensureWorkspace(OTHER, 'Other');
  for (const id of ['t-valid', 't-noreq', 't-complete', 't-usage', 't-failed', 't-incon', 't-idem', 't-correct', 't-scope']) seed(id);
  getDatabase().prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES ('t-done', ?, 'done', 'd', 'scribe', 'gpt-test-model', 'DONE', '2026-09-17T00:00:00Z', '2026-09-17T00:00:00Z')").run(WS);
  // A sibling started a few minutes later on the same model: must be listed for exclusion.
  getDatabase().prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES ('t-sibling', ?, 's', 'd', 'scribe', 'gpt-test-model', 'CANCELLED', '2026-09-17T20:53:37Z', '2026-09-17T20:53:37Z')").run(WS);
  getDatabase().prepare("INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at) VALUES ('act-sib', 't-sibling', 'EXECUTION_STARTED', 'scribe', '{}', '2026-09-17T20:53:37.097Z')").run();
});

describe('validation and scope', () => {
  it('lists exactly the five findings', () => {
    expect([...RECONCILIATION_FINDINGS]).toEqual(['PROVIDER_CONFIRMED_COMPLETED', 'PROVIDER_CONFIRMED_FAILED', 'PROVIDER_CONFIRMED_NO_REQUEST', 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE', 'EVIDENCE_INCONCLUSIVE']);
  });

  it('refuses a task in another workspace, a non-reconciling task, and an unknown finding', () => {
    expect(reconcileAmbiguousExecution(base('t-scope', { workspaceId: OTHER }))).toMatchObject({ ok: false, error: expect.stringMatching(/not in workspace/) });
    expect(reconcileAmbiguousExecution(base('t-done'))).toMatchObject({ ok: false, error: expect.stringMatching(/only a task in RECONCILING_UNKNOWN_EXECUTION/) });
    expect(reconcileAmbiguousExecution(base('t-valid', { finding: 'SUCCESS' }))).toMatchObject({ ok: false, error: expect.stringMatching(/finding must be one of/) });
  });

  it('requires every evidence field, a UTC window that includes the dispatch, and the dispatched model', () => {
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ evidenceSource: '' }, /evidence source/],
      [{ windowStart: '2026-09-17 20:48' }, /UTC window/],
      [{ windowEnd: '2026-09-17T20:48:00.000+01:00' }, /UTC window/],
      [{ windowEnd: '2026-09-17T20:40:00Z' }, /after its start/],
      [{ windowStart: '2026-09-17T20:49:00Z' }, /must include the dispatch time/],
      [{ provider: '' }, /provider and model/],
      [{ model: 'another-model' }, /this task dispatched to "gpt-test-model"/],
      [{ dashboardFinding: 'none' }, /dashboard finding/],
      [{ note: '' }, /explanatory note/],
      [{ providerResponseId: 'resp_abc123' }, /cannot accompany PROVIDER_CONFIRMED_NO_REQUEST/],
      [{ usage: { inputTokens: 10 } }, /usage figures cannot accompany/],
      [{ finding: 'PROVIDER_CONFIRMED_COMPLETED', usage: { inputTokens: -1 } }, /non-negative/],
      [{ finding: 'PROVIDER_CONFIRMED_COMPLETED', usage: { outputTokens: 1.5 } }, /non-negative/],
      [{ finding: 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE', providerResponseId: 'resp_abc123' }, /cannot accompany/],
    ];
    const before = { h: history('t-valid'), e: events('t-valid') };
    for (const [extra, err] of bad) expect(reconcileAmbiguousExecution(base('t-valid', extra))).toMatchObject({ ok: false, error: expect.stringMatching(err) });
    expect({ h: history('t-valid'), e: events('t-valid') }).toEqual(before);
    expect(audits('t-valid')).toHaveLength(0);
  });
});

describe('findings', () => {
  it('NO_REQUEST → CANCELLED, appended: earlier status rows and events untouched, audit recorded', () => {
    const h0 = history('t-noreq'); const e0 = events('t-noreq');
    const r = reconcileAmbiguousExecution(base('t-noreq'));
    expect(r).toMatchObject({ ok: true, changed: true, status: 'CANCELLED' });
    expect(history('t-noreq').slice(0, h0.length)).toEqual(h0);
    expect(history('t-noreq').at(-1).status).toBe('CANCELLED');
    expect(events('t-noreq').slice(0, e0.length)).toEqual(e0);
    const ev = events('t-noreq').at(-1);
    expect(ev.event_type).toBe('EXECUTION_RECONCILED');
    const p = JSON.parse(ev.payload_json);
    expect(p).toMatchObject({ finding: 'PROVIDER_CONFIRMED_NO_REQUEST', resultingStatus: 'CANCELLED', fromStatus: 'RECONCILING_UNKNOWN_EXECUTION', retried: false, provenance: expect.stringMatching(/^OPERATOR_REPORTED/) });
    expect(p.evidence).toMatchObject({ evidenceSource: 'Provider dashboard → Logs → Responses', windowStart: START, providerResponseId: null, operatorReportedUsage: null });
    expect(audits('t-noreq')).toHaveLength(1);
    expect(JSON.parse(audits('t-noreq')[0].detail_json)).toMatchObject({ workspaceId: WS, finding: 'PROVIDER_CONFIRMED_NO_REQUEST', resultingStatus: 'CANCELLED', activityEventId: ev.event_id });
  });

  it('COMPLETED with a real response id and usage → INCOMPLETE, never DONE; no artifact, review, receipt or ledger row is created', () => {
    const r = reconcileAmbiguousExecution(base('t-complete', { finding: 'PROVIDER_CONFIRMED_COMPLETED', providerResponseId: 'resp_0123abcd', usage: { inputTokens: 140, outputTokens: 900, costUsd: 0.0123 }, dashboardFinding: 'Logs show a completed response at 20:48:41Z for this instruction.' }));
    expect(r).toMatchObject({ ok: true, status: 'INCOMPLETE' });
    expect(status('t-complete')).toBe('INCOMPLETE');
    expect(counts('t-complete')).toEqual({ artifacts: 0, reviews: 0, receipts: 0, ledger: 0 });
    const p = JSON.parse(events('t-complete').at(-1).payload_json);
    expect(p.evidence).toMatchObject({ providerResponseId: 'resp_0123abcd', operatorReportedUsage: { inputTokens: 140, outputTokens: 900, costUsd: 0.0123 } });
    expect(p.fabricated).toEqual({ output: false, tokens: false, responseId: false, artifact: false, review: false, receipt: false, ledgerRow: false });
  });

  it('USAGE_FOUND_RESPONSE_UNAVAILABLE → INCOMPLETE; FAILED → FAILED; neither creates evidence of success', () => {
    expect(reconcileAmbiguousExecution(base('t-usage', { finding: 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE', usage: { inputTokens: 140 } }))).toMatchObject({ ok: true, status: 'INCOMPLETE' });
    expect(reconcileAmbiguousExecution(base('t-failed', { finding: 'PROVIDER_CONFIRMED_FAILED' }))).toMatchObject({ ok: true, status: 'FAILED' });
    for (const id of ['t-usage', 't-failed']) expect(counts(id)).toEqual({ artifacts: 0, reviews: 0, receipts: 0, ledger: 0 });
  });

  it('INCONCLUSIVE records evidence and keeps the task UNKNOWN; a later decisive finding is not a correction', () => {
    const h0 = history('t-incon');
    expect(reconcileAmbiguousExecution(base('t-incon', { finding: 'EVIDENCE_INCONCLUSIVE', dashboardFinding: 'Logs retention does not reach that date.' }))).toMatchObject({ ok: true, changed: true, status: 'RECONCILING_UNKNOWN_EXECUTION' });
    expect(history('t-incon')).toEqual(h0);
    expect(status('t-incon')).toBe('RECONCILING_UNKNOWN_EXECUTION');
    expect(events('t-incon').at(-1).event_type).toBe('EXECUTION_RECONCILIATION_EVIDENCE');
    expect(reconcileAmbiguousExecution(base('t-incon', { finding: 'PROVIDER_CONFIRMED_NO_REQUEST' }))).toMatchObject({ ok: true, status: 'CANCELLED' });
    expect(reconciliationTrail('t-incon').map((x) => x.finding)).toEqual(['EVIDENCE_INCONCLUSIVE', 'PROVIDER_CONFIRMED_NO_REQUEST']);
  });
});

describe('idempotency and corrections', () => {
  it('the same submission twice changes nothing the second time', () => {
    const first = reconcileAmbiguousExecution(base('t-idem'));
    const snap = { h: history('t-idem'), e: events('t-idem'), a: audits('t-idem') };
    const again = reconcileAmbiguousExecution(base('t-idem'));
    expect(again).toMatchObject({ ok: true, changed: false, eventId: (first as any).eventId });
    expect({ h: history('t-idem'), e: events('t-idem'), a: audits('t-idem') }).toEqual(snap);
  });

  it('conflicting later evidence must be a correction naming the latest event; it is appended, never an edit', () => {
    const first = reconcileAmbiguousExecution(base('t-correct')) as any;
    const conflicting = base('t-correct', { finding: 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE', dashboardFinding: 'Usage page later showed one request at 20:48.' });
    expect(reconcileAmbiguousExecution(conflicting)).toMatchObject({ ok: false, error: expect.stringMatching(/must be submitted as a correction naming/) });
    expect(reconcileAmbiguousExecution({ ...conflicting, correctsEventId: 'act-wrong' })).toMatchObject({ ok: false, error: expect.stringMatching(/must name the latest reconciliation event/) });
    const e0 = events('t-correct');
    const c = reconcileAmbiguousExecution({ ...conflicting, correctsEventId: first.eventId });
    expect(c).toMatchObject({ ok: true, changed: true, status: 'INCOMPLETE' });
    expect(events('t-correct').slice(0, e0.length)).toEqual(e0);
    const trail = reconciliationTrail('t-correct');
    expect(trail.map((x) => [x.eventType, x.finding, x.correctsEventId])).toEqual([
      ['EXECUTION_RECONCILED', 'PROVIDER_CONFIRMED_NO_REQUEST', null],
      ['EXECUTION_RECONCILIATION_CORRECTED', 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE', first.eventId],
    ]);
    expect(history('t-correct').map((h) => h.status).slice(-2)).toEqual(['CANCELLED', 'INCOMPLETE']);
    expect(reconcileAmbiguousExecution(base('t-valid', { correctsEventId: 'x' }))).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to correct/) });
  });
});

describe('guide and endpoint', () => {
  it('derives the window, model, instruction and sibling exclusions from records only', () => {
    const g = reconciliationGuide('t-valid')!;
    expect(g).toMatchObject({ status: 'RECONCILING_UNKNOWN_EXECUTION', executionStartedAt: START, suggestedWindow: { start: START, end: '2026-09-17T20:50:00.000Z' }, model: 'gpt-test-model', instruction: 'Summarise the note in two sentences.', knownIdentifiers: { providerRequestIds: [], responseIds: [] } });
    expect(g.exclude.map((x) => [x.taskId, x.startedAt])).toContainEqual(['t-sibling', '2026-09-17T20:53:37.097Z']);
  });

  it('the POST route needs workspace-admin, an explicit confirmation and the task in that workspace; the GET needs membership', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(server).toContain('app.post("/api/tasks/:taskId/execution-reconciliation", requireWorkspaceAdmin(fromBody),');
    expect(server).toContain('app.get("/api/tasks/:taskId/execution-reconciliation", requireWorkspaceMember(fromQuery),');
    const post = server.slice(server.indexOf('app.post("/api/tasks/:taskId/execution-reconciliation"'), server.indexOf('app.get("/api/activity-ledger"'));
    expect(post).toMatch(/taskInWorkspace\(taskId, workspaceId\)/);
    expect(post).toMatch(/req\.body\?\.confirm !== true/);
    expect(post).not.toMatch(/fetch\(|routedModelCall|executeTask|dispatch/);
    expect(server).toContain('app.get("/api/activity-ledger", requireWorkspaceMember(fromQuery),');
  });

  it('made no network request', () => { expect(fetchCalls).toBe(0); });
});
