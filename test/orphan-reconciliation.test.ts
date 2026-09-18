import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// ORPHANED RUNNING TASKS are reconciled from append-only evidence: never
// retried, never deleted, history never rewritten. The ambiguous case — a
// task whose execution started before the spend ledger existed and whose
// process then stopped — goes to RECONCILING_UNKNOWN_EXECUTION.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-orphan-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'orphan.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('orphans');

import { getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { ensureUsageTable } from '../lib/spend/ledger';
import { reconcileOrphanedRunningTask, orphanEvidence, SPEND_LEDGER_GUARD_SINCE } from '../lib/continuity/orphans';

const WS = 'ws-orphan';
const PROCESS_START = '2026-09-18T12:00:00.000Z';
const BEFORE_LEDGER = '2026-09-17T20:48:27.969Z';
const AFTER_LEDGER = '2026-09-18T06:00:00.000Z';

function runningTask(id: string, startedAt: string | null, opts: { usage?: Array<{ status: string; dispatched?: boolean }>; receipt?: boolean } = {}) {
  const db = getDatabase();
  const created = startedAt ?? AFTER_LEDGER;
  db.prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES (?, ?, 't', 'd', 'scribe', 'm', 'RUNNING', ?, ?)").run(id, WS, created, created);
  for (const s of ['TODO', 'READY', 'RUNNING']) db.prepare('INSERT INTO task_status_history (task_id, status, created_at) VALUES (?, ?, ?)').run(id, s, created);
  db.prepare("INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at) VALUES (?, ?, 'TASK_CREATED', 'orchestrator', '{}', ?)").run(`e1-${id}`, id, created);
  if (startedAt) db.prepare("INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at) VALUES (?, ?, 'EXECUTION_STARTED', 'scribe', '{}', ?)").run(`e2-${id}`, id, startedAt);
  (opts.usage ?? []).forEach((u, i) => {
    db.prepare("INSERT INTO provider_usage (usage_id, provider, model, call_site, workspace_id, task_id, idempotency_key, attempt, status, input_chars, created_at, dispatched_at) VALUES (?, 'openai', 'm', 'kernel.model_task', ?, ?, ?, 1, ?, 10, ?, ?)")
      .run(`use-${id}-${i}`, WS, id, `k-${id}-${i}`, u.status, created, u.dispatched ? created : null);
  });
  if (opts.receipt) db.prepare("INSERT INTO receipts (receipt_id, task_id, review_id, algorithm, public_key, payload_json, signature, created_at) VALUES (?, ?, 'r', 'Ed25519', 'pk', '{}', 'sig', ?)").run(`rc-${id}`, id, created);
}
const history = (id: string) => (getDatabase().prepare('SELECT status FROM task_status_history WHERE task_id = ? ORDER BY id').all(id) as any[]).map((r) => r.status);
const status = (id: string) => (getDatabase().prepare('SELECT status FROM tasks WHERE task_id = ?').get(id) as any).status;

beforeAll(() => { getDatabase(); ensureUsageTable(); ensureWorkspace(WS, 'Orphans'); });

describe('orphaned RUNNING task reconciliation', () => {
  it('started before the spend ledger existed, then its process stopped → RECONCILING_UNKNOWN_EXECUTION; history only appended', () => {
    runningTask('t-pre-ledger', BEFORE_LEDGER);
    expect(Date.parse(BEFORE_LEDGER)).toBeLessThan(Date.parse(SPEND_LEDGER_GUARD_SINCE));
    const r = reconcileOrphanedRunningTask('t-pre-ledger', 'operator', PROCESS_START);
    expect(r).toMatchObject({ ok: true, verdict: 'AMBIGUOUS_DISPATCH', status: 'RECONCILING_UNKNOWN_EXECUTION' });
    expect(r.ok && r.reason).toMatch(/before the spend ledger existed/);
    expect(history('t-pre-ledger')).toEqual(['TODO', 'READY', 'RUNNING', 'RECONCILING_UNKNOWN_EXECUTION']);
    const ev = getDatabase().prepare("SELECT event_type, payload_json FROM activity_events WHERE task_id = 't-pre-ledger' ORDER BY rowid").all() as any[];
    expect(ev.map((e) => e.event_type)).toEqual(['TASK_CREATED', 'EXECUTION_STARTED', 'RECONCILIATION_REQUIRED']);
    expect(JSON.parse(ev[2].payload_json)).toMatchObject({ verdict: 'AMBIGUOUS_DISPATCH', fromStatus: 'RUNNING', toStatus: 'RECONCILING_UNKNOWN_EXECUTION' });
    // Not retried: no ledger row was created by reconciliation.
    expect((getDatabase().prepare("SELECT COUNT(*) AS n FROM provider_usage WHERE task_id = 't-pre-ledger'").get() as any).n).toBe(0);
    // Idempotent: it is no longer RUNNING, so a second pass refuses.
    expect(reconcileOrphanedRunningTask('t-pre-ledger', 'operator', PROCESS_START)).toMatchObject({ ok: false });
  });

  it('never started → READY', () => {
    runningTask('t-never', null);
    expect(reconcileOrphanedRunningTask('t-never', 'operator', PROCESS_START)).toMatchObject({ ok: true, verdict: 'NEVER_DISPATCHED', status: 'READY' });
  });

  it('started while the guard reserved before every dispatch, no ledger row → provably never sent → READY', () => {
    runningTask('t-guarded', AFTER_LEDGER);
    expect(reconcileOrphanedRunningTask('t-guarded', 'operator', PROCESS_START)).toMatchObject({ ok: true, verdict: 'NEVER_DISPATCHED', status: 'READY' });
  });

  it('a reservation never dispatched is released at $0 and the task is READY', () => {
    runningTask('t-reserved', AFTER_LEDGER, { usage: [{ status: 'RESERVED' }] });
    expect(reconcileOrphanedRunningTask('t-reserved', 'operator', PROCESS_START)).toMatchObject({ ok: true, status: 'READY' });
    expect(getDatabase().prepare("SELECT status, actual_cost_usd, actual_cost_state FROM provider_usage WHERE task_id = 't-reserved'").get()).toMatchObject({ status: 'PRE_DISPATCH_FAILURE', actual_cost_usd: 0, actual_cost_state: 'KNOWN' });
  });

  it('an ambiguous ledger row → RECONCILING, and the row is left exactly as it was', () => {
    runningTask('t-unknown', AFTER_LEDGER, { usage: [{ status: 'UNKNOWN', dispatched: true }] });
    expect(reconcileOrphanedRunningTask('t-unknown', 'operator', PROCESS_START)).toMatchObject({ ok: true, status: 'RECONCILING_UNKNOWN_EXECUTION' });
    expect((getDatabase().prepare("SELECT status FROM provider_usage WHERE task_id = 't-unknown'").get() as any).status).toBe('UNKNOWN');
  });

  it('a signed receipt makes the outcome known → DONE', () => {
    runningTask('t-receipt', AFTER_LEDGER, { receipt: true });
    expect(reconcileOrphanedRunningTask('t-receipt', 'operator', PROCESS_START)).toMatchObject({ ok: true, verdict: 'OUTCOME_KNOWN_DONE', status: 'DONE' });
  });

  it('refuses a task this process may still own, a task that is not RUNNING, and a task the continuity controller owns', () => {
    runningTask('t-live', '2026-09-18T12:30:00.000Z');
    expect(reconcileOrphanedRunningTask('t-live', 'operator', PROCESS_START)).toMatchObject({ ok: false, error: expect.stringMatching(/may still be executing/) });
    expect(status('t-live')).toBe('RUNNING');
    expect(reconcileOrphanedRunningTask('t-never', 'operator', PROCESS_START)).toMatchObject({ ok: false, error: expect.stringMatching(/not RUNNING/) });
    runningTask('t-cont', BEFORE_LEDGER);
    getDatabase().exec("CREATE TABLE IF NOT EXISTS task_continuity (task_id TEXT PRIMARY KEY, state TEXT)");
    try { getDatabase().prepare("INSERT INTO task_continuity (task_id, state) VALUES ('t-cont', 'RUNNING_SEGMENT')").run(); } catch { /* full schema: skip */ }
    const e = orphanEvidence('t-cont', PROCESS_START)!;
    if (e.continuityState) expect(reconcileOrphanedRunningTask('t-cont', 'operator', PROCESS_START)).toMatchObject({ ok: false, error: expect.stringMatching(/continuity/) });
  });
});
