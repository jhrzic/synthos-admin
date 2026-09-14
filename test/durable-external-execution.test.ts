import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-durable-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  submitExternalExecution, getWorkspaceExternalExecution, listWorkspaceExternalExecutions,
  listDueExternalExecutions, advanceExternalExecution, advanceDueExternalExecutions,
  pollBackoffSeconds, POLL_BACKOFF_SECONDS, MAX_POLL_ATTEMPTS,
} from '../lib/external-executions';
import { runSchedulerTick } from '../lib/fabric/scheduler';
import { getDatabase, getTaskArtifacts, getTaskReceipts, getTaskQualityReviews } from '../lib/persistence';

// ---------------------------------------------------------------------------
// PUSH 2A — durable advancement of background Antigravity executions.
//
// This is the gap live verification exposed: interactions are submitted with
// background:true and nothing moved them forward, so a human had to poll. A
// background runtime that only finishes when someone is watching is not a
// background runtime.
//
// The whole design rests on one claim — durability comes from the LEDGER,
// not from the process doing the polling — so these tests attack that claim
// directly: they restart the "worker" by simply calling the sweep again from
// nothing but persisted state, and they run overlapping sweeps to prove a
// row cannot be polled or ingested twice.
// ---------------------------------------------------------------------------

const WS = 'ws-durable-alpha';
const ACTOR = 'durable-actor';

interface Remote { status: 'queued' | 'in_progress' | 'completed' | 'failed'; text: string; }
const interactions = new Map<string, Remote>();
let submitCount = 0;
/** Every GET the provider really received, so "polled once" is an observation, not an assumption. */
let statusReads: string[] = [];

let server: http.Server;

const REAL_OUTPUT = [
  '# Durable execution report',
  '',
  'The sandbox created the requested file and read it back successfully.',
  'The contents matched the requested value exactly, with no modification.',
  '',
  '## Steps performed',
  '',
  'A file was written to the working directory, then re-read from disk to confirm its contents.',
  'No external systems were contacted and no production state was changed.',
].join('\n');

beforeAll(async () => {
  getDatabase();
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (s: number, p: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(p)); };
      const url = req.url || '';

      if (req.method === 'POST' && url.endsWith('/interactions')) {
        const id = `int-${++submitCount}`;
        interactions.set(id, { status: 'queued', text: '' });
        return json(200, { id, status: 'queued' });
      }
      const m = url.match(/\/interactions\/([^/?]+)$/);
      if (req.method === 'GET' && m) {
        const id = decodeURIComponent(m[1]);
        statusReads.push(id);
        const r = interactions.get(id);
        if (!r) return json(404, { error: { message: 'not found' } });
        return json(200, {
          id,
          status: r.status,
          steps: r.text ? [{ type: 'model_output', content: [{ type: 'text', text: r.text }] }] : [],
          usage: { total_tokens: 1234 },
          environment_id: 'env-1',
        });
      }
      json(404, { error: { message: 'not found' } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  process.env.ANTIGRAVITY_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTIGRAVITY_API_KEY = 'durable-test-key';
  process.env.ANTIGRAVITY_ENABLED = 'true';
});

afterAll(async () => {
  delete process.env.ANTIGRAVITY_BASE_URL;
  delete process.env.ANTIGRAVITY_API_KEY;
  delete process.env.ANTIGRAVITY_ENABLED;
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => { statusReads = []; });

/** Force a row due now, exactly as elapsed wall-clock time would. */
function makeDue(id: string) {
  getDatabase().prepare('UPDATE external_executions SET next_poll_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), id);
}

async function submit(key: string) {
  const { execution } = await submitExternalExecution({
    workspaceId: WS, createdByUserId: ACTOR, runtime: 'antigravity',
    input: { instruction: 'create a file, read it back and report the contents' },
    idempotencyKey: key,
  });
  return execution;
}

describe('1. A submitted execution is armed for durable advancement', () => {
  it('a real submission is immediately due, with zero polls so far', async () => {
    const ex = await submit(`arm-${Date.now()}`);
    expect(ex.status).toBe('SUBMITTED');
    expect(ex.remote_job_id).toBeTruthy();
    expect(ex.next_poll_at).toBeTruthy();
    expect(ex.poll_attempts).toBe(0);
    expect(listDueExternalExecutions().map((e) => e.id)).toContain(ex.id);
  });

  it('a submission the remote REJECTED is never swept — there is nothing to advance', async () => {
    const db = getDatabase();
    const ex = await submit(`reject-${Date.now()}`);
    // Model a failed submission on the existing row: no remote job, terminal.
    db.prepare("UPDATE external_executions SET status='FAILED', remote_job_id=NULL, next_poll_at=NULL WHERE id=?").run(ex.id);
    expect(listDueExternalExecutions().map((e) => e.id)).not.toContain(ex.id);
  });
});

describe('2. The sweep advances a background job to completion with NO human polling', () => {
  it('runs the full spine automatically: poll -> terminal -> ingest -> artifact -> Aegis -> receipt', async () => {
    const ex = await submit(`auto-${Date.now()}`);
    const remoteId = ex.remote_job_id!;

    // Still running: the sweep polls, learns nothing terminal, and schedules a retry.
    interactions.get(remoteId)!.status = 'in_progress';
    makeDue(ex.id);
    let sweep = await advanceDueExternalExecutions();
    expect(sweep.advanced).toBeGreaterThanOrEqual(1);
    let cur = getWorkspaceExternalExecution(WS, ex.id)!;
    expect(cur.status).toBe('RUNNING');
    expect(cur.result_ingested_at).toBeNull();
    expect(cur.next_poll_at).toBeTruthy();

    // Remote finishes. The NEXT sweep must complete everything on its own.
    interactions.get(remoteId)!.status = 'completed';
    interactions.get(remoteId)!.text = REAL_OUTPUT;
    makeDue(ex.id);
    sweep = await advanceDueExternalExecutions();
    expect(sweep.ingested).toBe(1);

    cur = getWorkspaceExternalExecution(WS, ex.id)!;
    expect(cur.status).toBe('SUCCEEDED');
    expect(cur.result_ingested_at).toBeTruthy();
    expect(cur.task_id).toBeTruthy();
    // Terminal rows stop being polled. Forever.
    expect(cur.next_poll_at).toBeNull();
    expect(listDueExternalExecutions().map((e) => e.id)).not.toContain(ex.id);

    const taskId = cur.task_id!;
    expect(getTaskArtifacts(taskId).length).toBe(1);
    const reviews = getTaskQualityReviews(taskId);
    expect(reviews.length).toBe(1);
    expect(getTaskReceipts(taskId).length > 0).toBe(reviews[0].decision === 'VERIFIED');
  });

  it('the scheduler tick drives it — one loop does schedules AND the sweep, not two timers', async () => {
    const ex = await submit(`tick-${Date.now()}`);
    const remoteId = ex.remote_job_id!;
    interactions.get(remoteId)!.status = 'completed';
    interactions.get(remoteId)!.text = REAL_OUTPUT;
    makeDue(ex.id);

    const result = await runSchedulerTick();
    expect(result.sweep.ingested).toBe(1);
    expect(getWorkspaceExternalExecution(WS, ex.id)!.status).toBe('SUCCEEDED');
  });
});

describe('3. RESTART RECOVERY — a non-terminal execution resumes from persisted state alone', () => {
  it('a job left RUNNING across a "restart" is picked up and completed, with no in-memory state', async () => {
    const ex = await submit(`restart-${Date.now()}`);
    const remoteId = ex.remote_job_id!;

    interactions.get(remoteId)!.status = 'in_progress';
    makeDue(ex.id);
    await advanceDueExternalExecutions();
    expect(getWorkspaceExternalExecution(WS, ex.id)!.status).toBe('RUNNING');

    // THE RESTART. Nothing is carried over: the only thing that survives a
    // process death is the ledger, so the next sweep is given nothing else.
    // It must rebuild its entire work queue from a single SELECT.
    interactions.get(remoteId)!.status = 'completed';
    interactions.get(remoteId)!.text = REAL_OUTPUT;
    makeDue(ex.id);

    const due = listDueExternalExecutions();
    expect(due.map((e) => e.id)).toContain(ex.id);

    const sweep = await advanceDueExternalExecutions();
    expect(sweep.ingested).toBe(1);

    const cur = getWorkspaceExternalExecution(WS, ex.id)!;
    expect(cur.status).toBe('SUCCEEDED');
    expect(cur.result_ingested_at).toBeTruthy();
    expect(getTaskArtifacts(cur.task_id!).length).toBe(1);
  });

  it('a row that finished while SynthOS was down is ingested on the first sweep after it returns', async () => {
    const ex = await submit(`offline-${Date.now()}`);
    // The remote completed with nobody watching — no poll ever observed RUNNING.
    interactions.get(ex.remote_job_id!)!.status = 'completed';
    interactions.get(ex.remote_job_id!)!.text = REAL_OUTPUT;
    makeDue(ex.id);

    const sweep = await advanceDueExternalExecutions();
    expect(sweep.ingested).toBe(1);
    expect(getWorkspaceExternalExecution(WS, ex.id)!.status).toBe('SUCCEEDED');
  });
});

describe('4. IDEMPOTENCY — repeated and concurrent sweeps cannot double anything', () => {
  it('two overlapping sweeps produce exactly ONE poll, ONE artifact and ONE receipt', async () => {
    const ex = await submit(`concurrent-${Date.now()}`);
    const remoteId = ex.remote_job_id!;
    interactions.get(remoteId)!.status = 'completed';
    interactions.get(remoteId)!.text = REAL_OUTPUT;
    makeDue(ex.id);
    statusReads = [];

    const [a, b] = await Promise.all([advanceDueExternalExecutions(), advanceDueExternalExecutions()]);
    expect(a.ingested + b.ingested).toBe(1);

    // THE LEASE PROOF. poll_attempts is incremented by the compare-and-swap
    // that claims a row, so it counts successful CLAIMS. Two concurrent
    // sweeps over the same due row must yield exactly one.
    expect(getWorkspaceExternalExecution(WS, ex.id)!.poll_attempts).toBe(1);

    // And the provider saw the reads of exactly ONE advancement. That is two
    // GETs, not one: a completing execution is read once for status and once
    // for the result. Both hit the same Antigravity endpoint — the two-phase
    // shape is inherited from Windmill, where status and result genuinely are
    // different endpoints. Asserted as 2 rather than quietly relaxed, so a
    // real duplicate poll (4) still fails this test.
    expect(statusReads.filter((id) => id === remoteId).length).toBe(2);

    const cur = getWorkspaceExternalExecution(WS, ex.id)!;
    expect(getTaskArtifacts(cur.task_id!).length).toBe(1);
    expect(getTaskReceipts(cur.task_id!).length).toBeLessThanOrEqual(1);
  });

  it('advancing an already-terminal, already-ingested row is a no-op that touches nothing', async () => {
    const ex = await submit(`noop-${Date.now()}`);
    interactions.get(ex.remote_job_id!)!.status = 'completed';
    interactions.get(ex.remote_job_id!)!.text = REAL_OUTPUT;
    makeDue(ex.id);
    await advanceDueExternalExecutions();

    const settled = getWorkspaceExternalExecution(WS, ex.id)!;
    const artifactsBefore = getTaskArtifacts(settled.task_id!).length;
    const ingestedAtBefore = settled.result_ingested_at;

    makeDue(ex.id); // force it due again, as a buggy caller might
    const again = await advanceExternalExecution(WS, ex.id);
    expect(again.ingested).toBe(false);
    expect(getTaskArtifacts(settled.task_id!).length).toBe(artifactsBefore);
    expect(getWorkspaceExternalExecution(WS, ex.id)!.result_ingested_at).toBe(ingestedAtBefore);
  });

  it('a second sweep never re-submits to the provider — advancement polls, it never dispatches', async () => {
    const before = submitCount;
    const ex = await submit(`nodispatch-${Date.now()}`);
    const afterSubmit = submitCount;
    expect(afterSubmit).toBe(before + 1);

    interactions.get(ex.remote_job_id!)!.status = 'in_progress';
    makeDue(ex.id);
    await advanceDueExternalExecutions();
    makeDue(ex.id);
    await advanceDueExternalExecutions();
    expect(submitCount).toBe(afterSubmit);
  });
});

describe('5. BOUNDED BACKOFF and an HONEST deadline', () => {
  it('backoff grows and is capped — a long job is never polled aggressively', () => {
    expect(pollBackoffSeconds(0)).toBe(POLL_BACKOFF_SECONDS[0]);
    for (let i = 1; i < POLL_BACKOFF_SECONDS.length; i++) {
      expect(pollBackoffSeconds(i)).toBeGreaterThanOrEqual(pollBackoffSeconds(i - 1));
    }
    const cap = POLL_BACKOFF_SECONDS[POLL_BACKOFF_SECONDS.length - 1];
    expect(pollBackoffSeconds(999)).toBe(cap);
    expect(cap).toBeLessThanOrEqual(60);
  });

  it('the interval genuinely widens between real polls, rather than staying flat', async () => {
    const ex = await submit(`backoff-${Date.now()}`);
    interactions.get(ex.remote_job_id!)!.status = 'in_progress';

    const gaps: number[] = [];
    for (let i = 0; i < 3; i++) {
      makeDue(ex.id);
      const at = new Date().toISOString();
      await advanceExternalExecution(WS, ex.id, at);
      const cur = getWorkspaceExternalExecution(WS, ex.id)!;
      gaps.push((new Date(cur.next_poll_at!).getTime() - new Date(at).getTime()) / 1000);
    }
    expect(gaps[1]).toBeGreaterThanOrEqual(gaps[0]);
    expect(gaps[2]).toBeGreaterThanOrEqual(gaps[1]);
  });

  it('at the deadline polling STOPS and the state is UNKNOWN — never a fabricated FAILED', async () => {
    const ex = await submit(`deadline-${Date.now()}`);
    interactions.get(ex.remote_job_id!)!.status = 'in_progress';

    getDatabase().prepare('UPDATE external_executions SET poll_attempts = ? WHERE id = ?')
      .run(MAX_POLL_ATTEMPTS, ex.id);
    makeDue(ex.id);
    await advanceExternalExecution(WS, ex.id);

    const cur = getWorkspaceExternalExecution(WS, ex.id)!;
    expect(cur.status).toBe('UNKNOWN');
    expect(cur.error_code).toBe('POLL_DEADLINE_EXCEEDED');
    // The distinction that matters: we stopped asking, we did not observe failure.
    expect(cur.status).not.toBe('FAILED');
    expect(cur.error_message_safe).toContain('not observed to fail');
    expect(cur.next_poll_at).toBeNull();
    expect(listDueExternalExecutions().map((e) => e.id)).not.toContain(ex.id);
  });

  it('a completed remote that returns no text stops polling instead of retrying forever', async () => {
    const ex = await submit(`empty-${Date.now()}`);
    interactions.get(ex.remote_job_id!)!.status = 'completed';
    interactions.get(ex.remote_job_id!)!.text = '';
    makeDue(ex.id);

    await advanceDueExternalExecutions();
    const cur = getWorkspaceExternalExecution(WS, ex.id)!;
    expect(cur.error_code).toBe('EMPTY_RESULT');
    expect(cur.next_poll_at).toBeNull();
  });
});

describe('6. WORKSPACE SCOPE holds for the sweep', () => {
  it('the sweep advances each row under its OWN workspace, and cross-workspace access still fails', async () => {
    const ex = await submit(`scope-${Date.now()}`);
    interactions.get(ex.remote_job_id!)!.status = 'completed';
    interactions.get(ex.remote_job_id!)!.text = REAL_OUTPUT;
    makeDue(ex.id);
    await advanceDueExternalExecutions();

    const cur = getWorkspaceExternalExecution(WS, ex.id)!;
    expect(cur.workspace_id).toBe(WS);
    expect(getWorkspaceExternalExecution('ws-durable-beta', ex.id)).toBeNull();
    await expect(advanceExternalExecution('ws-durable-beta', ex.id)).rejects.toThrow(/not found/i);
    expect(listWorkspaceExternalExecutions('ws-durable-beta', 200).length).toBe(0);
  });

  it('no credential appears in any swept row', () => {
    const rows = listWorkspaceExternalExecutions(WS, 200);
    expect(JSON.stringify(rows)).not.toContain('durable-test-key');
  });
});
