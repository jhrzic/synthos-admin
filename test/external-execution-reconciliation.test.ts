import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-reconcile-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'reconcile.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { getDatabase, closeDatabase } from '../lib/persistence';
import {
  listDueExternalExecutions,
  advanceDueExternalExecutions,
  pollBackoffSeconds,
  POLL_BACKOFF_SECONDS,
  MAX_POLL_ATTEMPTS,
  EXTERNAL_SWEEP_BATCH_SIZE,
} from '../lib/external-executions';

// ---------------------------------------------------------------------------
// The gap: a remote job that finished while SynthOS was down stayed
// non-terminal forever and its result was never ingested — so no artifact
// and no receipt existed for work the provider had completed.
//
// There is exactly ONE sweep that closes it: advanceDueExternalExecutions.
// Two sweeps once shared these columns with opposite readings of
// next_poll_at NULL; these tests pin the SELECTION and BOUNDS of the one that
// remains, which is where an unattended loop goes wrong: polling terminal
// rows, polling a blocked row forever, double-ingesting, or quietly marking
// an unknown row FAILED to tidy the queue.
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
    // Due now. NULL means "stopped for good" in the one surviving sweep.
    next_poll_at: new Date(Date.now() - 1000).toISOString(),
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
    expect(listDueExternalExecutions().map((r) => r.id)).toContain(id);
  });

  it('never polls a terminal row', () => {
    for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED']) {
      insertExecution({ status });
    }
    expect(listDueExternalExecutions()).toHaveLength(0);
  });

  it('polls UNKNOWN, because unknown may still resolve', () => {
    const id = insertExecution({ status: 'UNKNOWN' });
    expect(listDueExternalExecutions().map((r) => r.id)).toContain(id);
  });

  // A row blocked on an input SynthOS was never asked for cannot progress on
  // its own, so polling it is guaranteed-useless work. Excluding it is NOT the
  // same as declaring it finished — the assertion below pins that.
  it('does not poll a row blocked on REMOTE_REQUIRES_ACTION, and leaves it UNKNOWN', async () => {
    const id = insertExecution({ status: 'UNKNOWN', error_code: 'REMOTE_REQUIRES_ACTION' });
    expect(listDueExternalExecutions()).toHaveLength(0);

    await advanceDueExternalExecutions();
    expect(readRow(id).status).toBe('UNKNOWN');
  });

  it('never polls a row with no remote job id — there is nothing to ask about', () => {
    insertExecution({ remote_job_id: null, status: 'PENDING' });
    expect(listDueExternalExecutions()).toHaveLength(0);
  });

  it('never polls a row whose polling was stopped (next_poll_at NULL)', () => {
    insertExecution({ status: 'RUNNING', next_poll_at: null });
    expect(listDueExternalExecutions()).toHaveLength(0);
  });

  it('respects next_poll_at, so a stuck job is not hammered every tick', () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const held = insertExecution({ next_poll_at: future });
    const ready = insertExecution({ next_poll_at: new Date(Date.now() - 1000).toISOString() });

    const due = listDueExternalExecutions().map((r) => r.id);
    expect(due).toContain(ready);
    expect(due).not.toContain(held);
  });

  it('does not select a row that has exhausted the attempt cap, and does not invent an outcome for it', async () => {
    const id = insertExecution({ status: 'RUNNING', poll_attempts: MAX_POLL_ATTEMPTS });
    expect(listDueExternalExecutions()).toHaveLength(0);

    await advanceDueExternalExecutions();
    const row = readRow(id);
    expect(row.status).toBe('RUNNING');
    expect(row.poll_attempts).toBe(MAX_POLL_ATTEMPTS);
  });

  it('is batched, so one tick cannot take unbounded time', () => {
    for (let i = 0; i < 25; i++) insertExecution();
    expect(listDueExternalExecutions().length).toBeLessThanOrEqual(EXTERNAL_SWEEP_BATCH_SIZE);
    expect(EXTERNAL_SWEEP_BATCH_SIZE).toBeLessThanOrEqual(10);
  });
});

describe('backoff is bounded and monotonic', () => {
  it('never decreases as attempts rise', () => {
    for (let i = 1; i < POLL_BACKOFF_SECONDS.length + 5; i++) {
      expect(pollBackoffSeconds(i)).toBeGreaterThanOrEqual(pollBackoffSeconds(i - 1));
    }
  });

  it('never exceeds the ceiling, however many attempts have happened', () => {
    const ceiling = POLL_BACKOFF_SECONDS[POLL_BACKOFF_SECONDS.length - 1];
    for (const attempts of [10, 50, 1000, Number.MAX_SAFE_INTEGER]) {
      const delay = pollBackoffSeconds(attempts);
      expect(delay).toBeLessThanOrEqual(ceiling);
      expect(Number.isFinite(delay)).toBe(true);
    }
  });
});

describe('the sweep is safe to run unattended', () => {
  // Without this, a row whose provider call always throws would be retried on
  // every single tick forever.
  it('advances the attempt count and holds the row off even when the refresh itself fails', async () => {
    // remote_job_id is set but no provider is configured, so the refresh
    // attempt cannot succeed — the realistic failure shape.
    const id = insertExecution({ status: 'RUNNING' });
    expect(readRow(id).poll_attempts).toBe(0);

    await advanceDueExternalExecutions();

    const after = readRow(id);
    expect(after.poll_attempts).toBe(1);
    expect(new Date(after.next_poll_at).getTime()).toBeGreaterThan(Date.now());
    expect(listDueExternalExecutions().map((r) => r.id)).not.toContain(id);
  });

  // The gap the integration found: a provider that ALWAYS throws never reached
  // the deadline check, so the row was re-leased forever. The last attempt now
  // ends it honestly — UNKNOWN, never FAILED.
  it('a row whose provider always throws stops at the cap as UNKNOWN / POLL_DEADLINE_EXCEEDED', async () => {
    const id = insertExecution({ status: 'RUNNING', poll_attempts: MAX_POLL_ATTEMPTS - 1 });
    await advanceDueExternalExecutions();

    const row = readRow(id);
    expect(row.poll_attempts).toBe(MAX_POLL_ATTEMPTS);
    expect(row.status).toBe('UNKNOWN');
    expect(row.error_code).toBe('POLL_DEADLINE_EXCEEDED');
    expect(row.next_poll_at).toBeNull();
  });

  it('a failing row does not abort the sweep for the rest of the batch', async () => {
    const ids = [insertExecution(), insertExecution(), insertExecution()];
    const sweep = await advanceDueExternalExecutions();

    expect(sweep.examined).toBe(3);
    for (const id of ids) {
      expect(readRow(id).poll_attempts).toBe(1);
    }
    expect(sweep.advanced + sweep.errors).toBe(3);
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

    expect(listDueExternalExecutions()).toHaveLength(0);
    await advanceDueExternalExecutions();

    const row = readRow(id);
    expect(row.result_artifact_id).toBe('art-existing');
    expect(row.result_receipt_id).toBe('rcpt-existing');
  });

  it('sweep state lives in columns, so a restart resumes where it stopped', async () => {
    const id = insertExecution();
    await advanceDueExternalExecutions();

    const row = readRow(id);
    expect(row.poll_attempts).toBe(1);
    expect(typeof row.next_poll_at).toBe('string');

    const later = new Date(new Date(row.next_poll_at).getTime() + 1000).toISOString();
    expect(listDueExternalExecutions(later).map((r) => r.id)).toContain(id);
  });

  it('an empty ledger is a no-op sweep, not an error', async () => {
    const sweep = await advanceDueExternalExecutions();
    expect(sweep).toMatchObject({ examined: 0, advanced: 0, ingested: 0, errors: 0 });
  });
});

describe('legacy rows from the removed second sweep are not stranded', () => {
  // The removed sweep read next_poll_at NULL as "due now"; the surviving one
  // reads it as "stopped". An in-flight row written under the old meaning is
  // made due once, on open. A deliberately stopped row is never restarted.
  it('on reopen, an in-flight NULL row becomes due; stopped rows stay stopped', () => {
    const legacy = insertExecution({ status: 'RUNNING', next_poll_at: null });
    const blocked = insertExecution({ status: 'UNKNOWN', error_code: 'REMOTE_REQUIRES_ACTION', next_poll_at: null });
    const deadline = insertExecution({ status: 'UNKNOWN', error_code: 'POLL_DEADLINE_EXCEEDED', next_poll_at: null });
    const done = insertExecution({ status: 'SUCCEEDED', next_poll_at: null });

    closeDatabase();
    getDatabase();

    expect(readRow(legacy).next_poll_at).not.toBeNull();
    expect(listDueExternalExecutions().map((r) => r.id)).toContain(legacy);
    for (const id of [blocked, deadline, done]) {
      expect(readRow(id).next_poll_at).toBeNull();
    }
  });
});
