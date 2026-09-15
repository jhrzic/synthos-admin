import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-reconcile-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'reconcile.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { getDatabase } from '../lib/persistence';
import {
  listReconcilableExternalExecutions,
  reconcileExternalExecutions,
  computeReconcileBackoffMs,
  RECONCILE_MAX_POLL_ATTEMPTS,
  RECONCILE_BASE_BACKOFF_MS,
  RECONCILE_MAX_BACKOFF_MS,
} from '../lib/external-executions';

// ---------------------------------------------------------------------------
// The gap: refreshAndIngestIfComplete()'s own docstring named "an orphan
// reconciliation sweep after a SynthOS restart" as one of its callers, and
// nothing ever called it on a timer. A remote job that finished while SynthOS
// was down stayed non-terminal forever and its result was never ingested — so
// no artifact and no receipt existed for work the provider had completed.
//
// These tests are about the sweep's SELECTION and BOUNDS, which is where a
// reconciliation loop goes wrong: polling terminal rows, polling a blocked row
// forever, double-ingesting, or quietly marking an unknown row FAILED to tidy
// the queue.
// ---------------------------------------------------------------------------

let seq = 0;
function insertExecution(fields: Partial<Record<string, unknown>> = {}): string {
  const db = getDatabase();
  const id = `exec-test-${Date.now()}-${seq++}`;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id,
    workspace_id: 'ws-reconcile-test',
    runtime: 'windmill',
    task_id: null,
    graph_run_id: null,
    graph_node_id: null,
    skill_id: null,
    target_id: 'f/test/script',
    remote_path: 'f/test/script',
    target_kind: 'script',
    remote_job_id: 'remote-job-1',
    status: 'RUNNING',
    attempt_number: 1,
    parent_execution_id: null,
    correlation_id: `corr-${id}`,
    input_json: '{}',
    submitted_at: now,
    started_at: now,
    completed_at: null,
    last_checked_at: null,
    error_code: null,
    error_message_safe: null,
    result_artifact_id: null,
    result_receipt_id: null,
    result_ingested_at: null,
    created_by_user_id: 'test',
    created_at: now,
    updated_at: now,
    next_poll_at: null,
    poll_attempts: 0,
    ...fields,
  };
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO external_executions (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
  ).run(...keys.map((k) => row[k]));
  return id;
}

function readRow(id: string): any {
  return getDatabase().prepare('SELECT * FROM external_executions WHERE id = ?').get(id);
}

beforeEach(() => {
  getDatabase().prepare('DELETE FROM external_executions').run();
});

describe('what the sweep will and will not poll', () => {
  it('picks up a non-terminal row with a remote job — the orphan case this exists for', () => {
    const id = insertExecution({ status: 'RUNNING' });
    const due = listReconcilableExternalExecutions();
    expect(due.map((r) => r.id)).toContain(id);
  });

  it('never polls a terminal row', () => {
    for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED']) {
      insertExecution({ status });
    }
    expect(listReconcilableExternalExecutions()).toHaveLength(0);
  });

  it('polls UNKNOWN, because unknown may still resolve', () => {
    const id = insertExecution({ status: 'UNKNOWN' });
    expect(listReconcilableExternalExecutions().map((r) => r.id)).toContain(id);
  });

  // A row blocked on an input SynthOS was never asked for cannot progress on
  // its own, so polling it is guaranteed-useless work. Excluding it is NOT the
  // same as declaring it finished — the assertion below pins that.
  it('does not poll a row blocked on REMOTE_REQUIRES_ACTION, and leaves it UNKNOWN', async () => {
    const id = insertExecution({ status: 'UNKNOWN', error_code: 'REMOTE_REQUIRES_ACTION' });
    expect(listReconcilableExternalExecutions()).toHaveLength(0);

    await reconcileExternalExecutions();
    // Still UNKNOWN. Not tidied into FAILED.
    expect(readRow(id).status).toBe('UNKNOWN');
  });

  it('never polls a row with no remote job id — there is nothing to ask about', () => {
    insertExecution({ remote_job_id: null, status: 'PENDING' });
    expect(listReconcilableExternalExecutions()).toHaveLength(0);
  });

  it('respects next_poll_at, so a stuck job is not hammered every tick', () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const held = insertExecution({ next_poll_at: future });
    const ready = insertExecution({ next_poll_at: new Date(Date.now() - 1000).toISOString() });

    const due = listReconcilableExternalExecutions().map((r) => r.id);
    expect(due).toContain(ready);
    expect(due).not.toContain(held);
  });

  it('stops polling a row that has exhausted the attempt cap, without changing its status', async () => {
    const id = insertExecution({ status: 'RUNNING', poll_attempts: RECONCILE_MAX_POLL_ATTEMPTS });
    expect(listReconcilableExternalExecutions()).toHaveLength(0);

    await reconcileExternalExecutions();
    const row = readRow(id);
    // The provider's state is genuinely unknown to us; RUNNING is what was
    // last observed and inventing a terminal state would be a lie.
    expect(row.status).toBe('RUNNING');
    expect(row.poll_attempts).toBe(RECONCILE_MAX_POLL_ATTEMPTS);
  });

  it('is batched, so one tick cannot take unbounded time', () => {
    for (let i = 0; i < 25; i++) insertExecution();
    expect(listReconcilableExternalExecutions().length).toBeLessThanOrEqual(10);
  });
});

describe('backoff is bounded and monotonic', () => {
  it('starts at the base interval and doubles', () => {
    expect(computeReconcileBackoffMs(0)).toBe(RECONCILE_BASE_BACKOFF_MS);
    expect(computeReconcileBackoffMs(1)).toBe(RECONCILE_BASE_BACKOFF_MS * 2);
    expect(computeReconcileBackoffMs(2)).toBe(RECONCILE_BASE_BACKOFF_MS * 4);
  });

  it('never exceeds the ceiling, however many attempts have happened', () => {
    for (const attempts of [10, 50, 1000, Number.MAX_SAFE_INTEGER]) {
      const delay = computeReconcileBackoffMs(attempts);
      expect(delay).toBeLessThanOrEqual(RECONCILE_MAX_BACKOFF_MS);
      expect(Number.isFinite(delay)).toBe(true);
    }
  });
});

describe('the sweep is safe to run unattended', () => {
  // Without this, a row whose provider call always throws would be retried on
  // every single tick forever.
  it('advances backoff even when the refresh itself fails', async () => {
    // remote_job_id is set but no provider is configured, so the refresh
    // attempt cannot succeed — the realistic failure shape.
    const id = insertExecution({ status: 'RUNNING' });
    const before = readRow(id);
    expect(before.poll_attempts).toBe(0);
    expect(before.next_poll_at).toBeNull();

    await reconcileExternalExecutions();

    const after = readRow(id);
    expect(after.poll_attempts).toBe(1);
    expect(after.next_poll_at).not.toBeNull();
    // And it is now held off, so the next tick will skip it.
    expect(listReconcilableExternalExecutions().map((r) => r.id)).not.toContain(id);
  });

  it('a failing row does not abort the sweep for the rest of the batch', async () => {
    const ids = [insertExecution(), insertExecution(), insertExecution()];
    const sweep = await reconcileExternalExecutions();

    expect(sweep.considered).toBe(3);
    // Every row was attempted — errors are counted, not thrown.
    for (const id of ids) {
      expect(readRow(id).poll_attempts).toBe(1);
    }
    expect(sweep.reconciled + sweep.errors).toBe(3);
  });

  // The idempotency boundary is result_ingested_at, inside
  // ingestExternalExecutionResult. An already-ingested row must never be
  // re-ingested into a second artifact and a second receipt.
  it('an already-ingested row is not swept again, so no duplicate artifact or receipt is possible', async () => {
    const id = insertExecution({
      status: 'SUCCEEDED',
      result_ingested_at: new Date().toISOString(),
      result_artifact_id: 'art-existing',
      result_receipt_id: 'rcpt-existing',
    });

    expect(listReconcilableExternalExecutions()).toHaveLength(0);
    await reconcileExternalExecutions();

    const row = readRow(id);
    expect(row.result_artifact_id).toBe('art-existing');
    expect(row.result_receipt_id).toBe('rcpt-existing');
  });

  it('reconciliation state lives in columns, so a restart resumes where it stopped', async () => {
    const id = insertExecution();
    await reconcileExternalExecutions();

    // Everything the next process needs is persisted — there is no in-memory
    // queue to lose across a restart.
    const row = readRow(id);
    expect(row.poll_attempts).toBe(1);
    expect(typeof row.next_poll_at).toBe('string');

    // Simulate the backoff elapsing after a restart: the row becomes eligible
    // again purely from persisted state.
    const later = new Date(new Date(row.next_poll_at).getTime() + 1000).toISOString();
    expect(listReconcilableExternalExecutions(later).map((r) => r.id)).toContain(id);
  });

  it('an empty ledger is a no-op sweep, not an error', async () => {
    const sweep = await reconcileExternalExecutions();
    expect(sweep).toMatchObject({ considered: 0, reconciled: 0, ingested: 0, errors: 0 });
  });
});
