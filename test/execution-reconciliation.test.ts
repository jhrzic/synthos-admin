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
import { reconcileAmbiguousExecution, reconciliationTrail, reconciliationGuide, RECONCILIATION_FINDINGS, assessSynthosExecutionEvidence, deriveReconciliationOutcome, SYNTHOS_RECEIPT_TRUTHS, PERSISTENCE_TRUTHS, COMPLETION_TRUTHS } from '../lib/continuity/orphans';
import { signReceiptPayload } from '../lib/persistence';

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
  for (const id of ['t-valid', 't-noreq', 't-complete', 't-usage', 't-failed', 't-incon', 't-idem', 't-correct', 't-scope', 't-clarify', 'd-notrecv', 'd-unknown', 'd-notpersist', 'd-notvalid', 'd-validated', 'd-legacy']) seed(id);
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

describe('independent evidence dimensions (provider truth never implies SynthOS truth)', () => {
  const ev = (id: string, type: string, at = '2026-09-18T13:30:52.828Z') => getDatabase().prepare('INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(`act-${type}-${id}`, id, type, 'test', '{}', at);
  const completed = (id: string) => reconcileAmbiguousExecution(base(id, { finding: 'PROVIDER_CONFIRMED_COMPLETED' })) as any;
  const lastPayload = (id: string) => JSON.parse(events(id).at(-1).payload_json);

  it('provider completed + response NOT received (owning process recorded as stopped, no response on record) → INCOMPLETE / RESPONSE_NOT_RECEIVED', () => {
    ev('d-notrecv', 'RECONCILIATION_REQUIRED');
    expect(assessSynthosExecutionEvidence('d-notrecv')).toMatchObject({ synthosReceiptTruth: 'RESPONSE_NOT_RECEIVED', persistenceTruth: 'NOT_PERSISTED', completionTruth: 'NOT_VALIDATED' });
    expect(completed('d-notrecv')).toMatchObject({ ok: true, status: 'INCOMPLETE' });
    expect(lastPayload('d-notrecv')).toMatchObject({ providerTruth: 'PROVIDER_CONFIRMED_COMPLETED', synthosReceiptTruth: 'RESPONSE_NOT_RECEIVED', persistenceTruth: 'NOT_PERSISTED', completionTruth: 'NOT_VALIDATED', reasonCode: 'RESPONSE_NOT_RECEIVED', resultingStatus: 'INCOMPLETE', transition: ['DISPATCHED/UNKNOWN', 'PROVIDER_CONFIRMED_COMPLETED', 'RESPONSE_NOT_RECEIVED', 'INCOMPLETE'] });
    expect(lastPayload('d-notrecv').synthosEvidenceBasis.join(' | ')).toMatch(/owning process recorded as stopped: RECONCILIATION_REQUIRED/);
    // A same-finding clarification: appended correction naming the event, still INCOMPLETE, no status row, earlier events untouched.
    const firstId = events('d-notrecv').at(-1).event_id;
    const h0 = history('d-notrecv'); const e0 = events('d-notrecv');
    const c = reconcileAmbiguousExecution(base('d-notrecv', { finding: 'PROVIDER_CONFIRMED_COMPLETED', correctsEventId: firstId, note: `Correction to ${firstId}: provider completion confirmed; SynthOS task completion is not.` })) as any;
    expect(c).toMatchObject({ ok: true, changed: true, status: 'INCOMPLETE' });
    expect(history('d-notrecv')).toEqual(h0);
    expect(events('d-notrecv').slice(0, e0.length)).toEqual(e0);
    expect(events('d-notrecv').at(-1).event_type).toBe('EXECUTION_RECONCILIATION_CORRECTED');
    expect(lastPayload('d-notrecv')).toMatchObject({ correctsEventId: firstId, synthosReceiptTruth: 'RESPONSE_NOT_RECEIVED', reasonCode: 'RESPONSE_NOT_RECEIVED' });
    expect(counts('d-notrecv')).toEqual({ artifacts: 0, reviews: 0, receipts: 0, ledger: 0 });
  });

  it('provider completed + receipt UNKNOWN (nothing shows the owner stopped) → not DONE, and NOT claimed as not-received', () => {
    expect(assessSynthosExecutionEvidence('d-unknown').synthosReceiptTruth).toBe('UNKNOWN');
    expect(completed('d-unknown')).toMatchObject({ ok: true, status: 'INCOMPLETE' });
    expect(lastPayload('d-unknown')).toMatchObject({ synthosReceiptTruth: 'UNKNOWN', reasonCode: 'RESPONSE_RECEIPT_UNKNOWN' });
    expect(status('d-unknown')).not.toBe('DONE');
  });

  it('provider completed + response received but not persisted → not DONE (RESPONSE_NOT_PERSISTED)', () => {
    ev('d-notpersist', 'PROVIDER_COMPLETED', '2026-09-17T20:48:40.000Z');
    expect(assessSynthosExecutionEvidence('d-notpersist')).toMatchObject({ synthosReceiptTruth: 'RESPONSE_RECEIVED', persistenceTruth: 'NOT_PERSISTED' });
    expect(completed('d-notpersist')).toMatchObject({ ok: true, status: 'INCOMPLETE' });
    expect(lastPayload('d-notpersist')).toMatchObject({ synthosReceiptTruth: 'RESPONSE_RECEIVED', persistenceTruth: 'NOT_PERSISTED', reasonCode: 'RESPONSE_NOT_PERSISTED' });
    expect(status('d-notpersist')).not.toBe('DONE');
  });

  it('provider completed + received and persisted, but no validated completion evidence/receipt → not DONE (COMPLETION_NOT_VALIDATED)', () => {
    ev('d-notvalid', 'PROVIDER_COMPLETED', '2026-09-17T20:48:40.000Z');
    getDatabase().prepare("INSERT INTO artifacts (artifact_id, task_id, relative_path, disk_path, content_hash, size_bytes, created_at) VALUES ('art-d-notvalid', 'd-notvalid', 'x.md', '/tmp/x.md', 'h', 1, '2026-09-17T20:48:41.000Z')").run();
    expect(assessSynthosExecutionEvidence('d-notvalid')).toMatchObject({ synthosReceiptTruth: 'RESPONSE_RECEIVED', persistenceTruth: 'PERSISTED', completionTruth: 'NOT_VALIDATED' });
    expect(completed('d-notvalid')).toMatchObject({ ok: true, status: 'INCOMPLETE' });
    expect(lastPayload('d-notvalid')).toMatchObject({ reasonCode: 'COMPLETION_NOT_VALIDATED', resultingStatus: 'INCOMPLETE' });
    expect(status('d-notvalid')).not.toBe('DONE');
  });

  it('validated completion evidence already on record: the action refuses rather than record anything (it is not ambiguous)', () => {
    ev('d-validated', 'PROVIDER_COMPLETED', '2026-09-17T20:48:40.000Z');
    const db = getDatabase();
    db.prepare("INSERT INTO quality_reviews (review_id, task_id, reviewer, method, score, decision, checks_json, evidence_json, created_at) VALUES ('qr-dv', 'd-validated', 'aegis', 'deterministic', 100, 'VERIFIED', '[]', '{}', '2026-09-17T20:48:42.000Z')").run();
    const payload = '{"t":"d-validated"}'; const sig = signReceiptPayload(payload);
    db.prepare("INSERT INTO receipts (receipt_id, task_id, review_id, algorithm, public_key, payload_json, signature, created_at) VALUES ('rc-dv', 'd-validated', 'qr-dv', 'Ed25519', ?, ?, ?, '2026-09-17T20:48:43.000Z')").run(sig.publicKeyPem, payload, sig.signature);
    const e0 = events('d-validated');
    expect(completed('d-validated')).toMatchObject({ ok: false, error: expect.stringMatching(/validated completion evidence/) });
    expect(events('d-validated')).toEqual(e0);
    expect(status('d-validated')).toBe('RECONCILING_UNKNOWN_EXECUTION');
  });

  it('no provider finding, under any combination of SynthOS evidence, produces DONE', () => {
    for (const f of RECONCILIATION_FINDINGS) for (const r of SYNTHOS_RECEIPT_TRUTHS) for (const p of PERSISTENCE_TRUTHS) for (const c of COMPLETION_TRUTHS) {
      const o = deriveReconciliationOutcome(f, { synthosReceiptTruth: r, persistenceTruth: p, completionTruth: c, basis: [] });
      if (o.ok) { expect(o.resultingStatus, `${f}/${r}/${p}/${c}`).not.toBe('DONE'); expect(o.transition).not.toContain('DONE'); }
    }
    // and RESPONSE_NOT_RECEIVED only ever comes from the receipt dimension, never from the finding alone
    for (const r of ['RESPONSE_RECEIVED', 'UNKNOWN'] as const) {
      const o = deriveReconciliationOutcome('PROVIDER_CONFIRMED_COMPLETED', { synthosReceiptTruth: r, persistenceTruth: 'NOT_PERSISTED', completionTruth: 'NOT_VALIDATED', basis: [] }) as any;
      expect(o.reasonCode).not.toBe('RESPONSE_NOT_RECEIVED');
    }
  });

  it('events recorded before the refactor stay byte-identical and are read as stored (legacy executionTruth, no back-fill)', () => {
    const legacyPayload = JSON.stringify({ finding: 'PROVIDER_CONFIRMED_COMPLETED', resultingStatus: 'INCOMPLETE', fromStatus: 'INCOMPLETE', submissionHash: 'x', correctsEventId: 'act-orig', evidence: { note: 'n' }, providerTruth: 'PROVIDER_CONFIRMED_COMPLETED', executionTruth: 'RESPONSE_NOT_RECEIVED', reasonCode: 'RESPONSE_NOT_RECEIVED', transition: ['DISPATCHED/UNKNOWN', 'PROVIDER_CONFIRMED_COMPLETED', 'RESPONSE_NOT_RECEIVED', 'INCOMPLETE'] });
    getDatabase().prepare("INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at) VALUES ('act-legacy-7a00e33', 'd-legacy', 'EXECUTION_RECONCILIATION_CORRECTED', 'op', ?, '2026-09-18T20:45:01.718Z')").run(legacyPayload);
    const before = getDatabase().prepare("SELECT * FROM activity_events WHERE event_id = 'act-legacy-7a00e33'").get();
    reconcileAmbiguousExecution(base('d-legacy', { finding: 'EVIDENCE_INCONCLUSIVE' }));
    expect(getDatabase().prepare("SELECT * FROM activity_events WHERE event_id = 'act-legacy-7a00e33'").get()).toEqual(before);
    const legacy = reconciliationTrail('d-legacy').find((t) => t.eventId === 'act-legacy-7a00e33')!;
    expect(legacy).toMatchObject({ legacyExecutionTruth: 'RESPONSE_NOT_RECEIVED', synthosReceiptTruth: null, persistenceTruth: null, completionTruth: null });
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
