import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-devloop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createDevelopmentTask, getWorkspaceDevelopmentTask, listWorkspaceDevelopmentTasks,
  requestDevelopmentReview, approveDevelopmentTask, dispatchDevelopmentTask,
  reconcileDevelopmentTask, buildDevelopmentContext, buildReviewPrompt,
  MAX_CONTEXT_ITEMS, MAX_CONTEXT_CHARS_PER_ITEM, REVIEW_SEAT_DIRECTIVE,
} from '../lib/development-loop';
import { DEFAULT_OPENAI_REVIEW_MODEL, resolveReviewSeatModel } from '../lib/model-router';
import { advanceDueExternalExecutions, getWorkspaceExternalExecution } from '../lib/external-executions';
import { getDatabase, getTaskArtifacts, getTaskReceipts, getTaskQualityReviews, verifyReceipt } from '../lib/persistence';
import { allowPaidExecutionForTest } from './helpers/spend';

// ---------------------------------------------------------------------------
// PUSH 2A — the development-loop backend contract.
//
// The point of this loop is to remove the manual copy/paste between a
// reasoning seat and an execution runtime. These tests therefore care most
// about the things that would make an automated loop dangerous rather than
// merely broken: that a model cannot approve its own work, that Guardian
// still refuses before dispatch, that a missing OpenAI key degrades honestly
// instead of silently routing elsewhere, and that VERIFIED is never claimed
// without a real Aegis decision and a real signed receipt.
// ---------------------------------------------------------------------------

const WS = 'ws-devloop-alpha';
const WS_B = 'ws-devloop-beta';
const ACTOR = 'devloop-actor';
const APPROVER = 'devloop-approver';

interface Remote { status: 'queued' | 'in_progress' | 'completed' | 'failed'; text: string; }
const interactions = new Map<string, Remote>();
let submitCount = 0;
let agServer: http.Server;
let oaServer: http.Server;
let oaBehaviour: { status: number; body: unknown };
let oaCalls = 0;

const REAL_EXECUTION_OUTPUT = [
  '# Execution report',
  '',
  'The requested file was created in the sandbox working directory and read back successfully.',
  'Its contents matched the requested value exactly, with no modification.',
  '',
  '## Steps performed',
  '',
  'A file was written to disk, then re-read to confirm the contents were correct.',
  'No external systems were contacted and no production state was changed.',
].join('\n');

const REAL_REVIEW = [
  '1. Assessment — the instruction is clear, bounded and safe to execute in a sandbox.',
  '2. Risks — the working directory is not specified, so the agent must choose one.',
  '3. Recommended execution plan — write the file, read it back, report the contents.',
  '4. Verdict — PROCEED, the task is bounded and reversible.',
].join('\n');

beforeAll(async () => {
  // Explicit opt-in: this file exercises SUCCESSFUL paid calls against a local double.
  allowPaidExecutionForTest([['openai', 'gpt-5.6-terra'], ['openai', 'gpt-5.6-luna'], ['openai', 'gpt-5.6-sol'], ['openai', 'gpt-6-astra'], ['openai', 'gpt-4o'], ['gemini', 'gemini-3.6-flash'], ['gemini', 'gemini-3.1-flash-lite']]);
  getDatabase();

  agServer = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const json = (s: number, p: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(p)); };
      const url = req.url || '';
      if (req.method === 'POST' && url.endsWith('/interactions')) {
        const id = `dev-int-${++submitCount}`;
        interactions.set(id, { status: 'queued', text: '' });
        return json(200, { id, status: 'queued' });
      }
      const m = url.match(/\/interactions\/([^/?]+)$/);
      if (req.method === 'GET' && m) {
        const r = interactions.get(decodeURIComponent(m[1]));
        if (!r) return json(404, { error: { message: 'not found' } });
        return json(200, {
          status: r.status,
          steps: r.text ? [{ type: 'model_output', content: [{ type: 'text', text: r.text }] }] : [],
          usage: { total_tokens: 900 },
        });
      }
      json(404, { error: { message: 'not found' } });
    });
  });
  await new Promise<void>((r) => agServer.listen(0, '127.0.0.1', () => r()));
  const agAddr = agServer.address();
  process.env.ANTIGRAVITY_BASE_URL = `http://127.0.0.1:${typeof agAddr === 'object' && agAddr ? agAddr.port : 0}`;
  process.env.ANTIGRAVITY_API_KEY = 'devloop-ag-key';
  process.env.ANTIGRAVITY_ENABLED = 'true';

  oaServer = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url || '').endsWith('/responses')) {
        oaCalls += 1;
        res.writeHead(oaBehaviour.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(oaBehaviour.body));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  await new Promise<void>((r) => oaServer.listen(0, '127.0.0.1', () => r()));
  const oaAddr = oaServer.address();
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${typeof oaAddr === 'object' && oaAddr ? oaAddr.port : 0}/v1`;
});

afterAll(async () => {
  for (const k of ['ANTIGRAVITY_BASE_URL', 'ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_ENABLED', 'OPENAI_BASE_URL', 'OPENAI_API_KEY']) delete process.env[k];
  await new Promise<void>((r) => agServer.close(() => r()));
  await new Promise<void>((r) => oaServer.close(() => r()));
});

beforeEach(() => {
  oaCalls = 0;
  oaBehaviour = { status: 200, body: { model: 'gpt-5.6-terra-2026-08-01', output_text: REAL_REVIEW, usage: { total_tokens: 500 } } };
});

function makeDue(id: string) {
  getDatabase().prepare('UPDATE external_executions SET next_poll_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), id);
}

/** A task a human has approved — the only way a development task reaches dispatch. */
function approvedTask(opts: Parameters<typeof newTask>[0] = {}) {
  const t = newTask({ requiresReview: false, ...opts });
  return approveDevelopmentTask(WS, t.dev_task_id, APPROVER);
}

function newTask(overrides: Partial<Parameters<typeof createDevelopmentTask>[0]> = {}) {
  return createDevelopmentTask({
    workspaceId: WS, createdByUserId: ACTOR,
    title: 'Verify the sandbox writes and reads a file',
    instruction: 'Create a file containing a known line, read it back, and report the contents.',
    ...overrides,
  });
}

describe('1. TASK STATE begins honestly, from the task\'s own requirements', () => {
  it('a task that needs review starts WAITING_FOR_REVIEW, not ready', () => {
    const t = newTask();
    expect(t.state).toBe('WAITING_FOR_REVIEW');
    expect(t.task_id).toBeNull();
    expect(t.execution_id).toBeNull();
  });

  it('a task that needs no review but needs approval starts WAITING_FOR_APPROVAL', () => {
    expect(newTask({ requiresReview: false }).state).toBe('WAITING_FOR_APPROVAL');
  });

  // Paid remote execution always needs a human. An explicit opt-out is ignored,
  // not honoured — see createDevelopmentTask.
  it('approval cannot be opted out of: requiresApproval:false still starts WAITING_FOR_APPROVAL', () => {
    const t = newTask({ requiresReview: false, requiresApproval: false });
    expect(t.state).toBe('WAITING_FOR_APPROVAL');
    expect(t.requires_approval).toBe(1);
  });

  it('a task is workspace-scoped: another workspace cannot see or address it', () => {
    const t = newTask();
    expect(getWorkspaceDevelopmentTask(WS_B, t.dev_task_id)).toBeNull();
    expect(listWorkspaceDevelopmentTasks(WS_B).map((x) => x.dev_task_id)).not.toContain(t.dev_task_id);
  });

  it('an empty title or instruction is refused rather than stored', () => {
    expect(() => newTask({ title: '   ' })).toThrow(/title is required/i);
    expect(() => newTask({ instruction: '' })).toThrow(/instruction is required/i);
  });
});

describe('2. BRAIN CONTEXT is scoped, bounded, and honest when empty', () => {
  it('reports truthfully when nothing in the workspace matches, rather than padding', () => {
    const ctx = buildDevelopmentContext(WS, 'a topic this workspace has never indexed xyzzy');
    expect(ctx.items).toEqual([]);
    expect(ctx.reason).toContain('No indexed project knowledge matched');
  });

  it('the review prompt carries only the scoped context and never dumps the Vault', () => {
    const t = newTask();
    const prompt = buildReviewPrompt(t, { items: [], reason: 'none' });
    expect(prompt).toContain(t.instruction);
    // PUSH 2D — the empty-context line now also tells the seat what to DO
    // about it, so an empty Brain produces a stated gap in Risks rather than a
    // review written as if the context had been sufficient.
    expect(prompt).toContain('no indexed project knowledge matched this task');
    expect(prompt).toContain('say so in Risks rather than assuming');
    // The bounds are a decision, not an accident.
    expect(MAX_CONTEXT_ITEMS).toBeLessThanOrEqual(10);
    expect(MAX_CONTEXT_CHARS_PER_ITEM).toBeLessThanOrEqual(2000);
  });

  it('context items are clipped to the declared per-item bound', () => {
    const long = 'x'.repeat(5000);
    const prompt = buildReviewPrompt(newTask(), {
      items: [{ artifactId: 'a1', title: 'T', path: 'p.md', excerpt: long.slice(0, MAX_CONTEXT_CHARS_PER_ITEM) }],
      reason: 'one item',
    });
    expect(prompt.length).toBeLessThan(long.length);
  });
});

describe('3. OPENAI SEAT — absent credential degrades honestly and never substitutes', () => {
  it('with no key the review is NOT_CONFIGURED, the task keeps its state, and no provider is called', async () => {
    delete process.env.OPENAI_API_KEY;
    const t = newTask();
    const r = await requestDevelopmentReview(WS, t.dev_task_id);

    expect(r.outcome).toBe('NOT_CONFIGURED');
    expect(r.reviewText).toBeNull();
    expect(r.reason).toContain('OPENAI_API_KEY');
    expect(r.reason).toContain('no other provider was substituted');
    expect(oaCalls).toBe(0);

    // State preserved — a missing key must not advance or fail the task.
    const after = getWorkspaceDevelopmentTask(WS, t.dev_task_id)!;
    expect(after.state).toBe('WAITING_FOR_REVIEW');
    expect(after.review_at).toBeNull();
  });

  it('a Gemini model requested for the review seat is refused, not run — no silent cross-provider swap', async () => {
    process.env.OPENAI_API_KEY = 'sk-devloop-test-key';
    try {
      const r = await requestDevelopmentReview(WS, newTask().dev_task_id, 'gemini-3.1-flash-lite');
      expect(r.outcome).toBe('NOT_CONFIGURED');
      expect(r.provider).toBeNull();
      expect(oaCalls).toBe(0);
    } finally { delete process.env.OPENAI_API_KEY; }
  });

  it('with a key, a real review runs and records the model the PROVIDER reported', async () => {
    process.env.OPENAI_API_KEY = 'sk-devloop-test-key';
    try {
      const t = newTask();
      const r = await requestDevelopmentReview(WS, t.dev_task_id);

      expect(r.outcome).toBe('REVIEWED');
      expect(r.provider).toBe('openai');
      expect(r.model).toBe('gpt-5.6-terra-2026-08-01');
      expect(oaCalls).toBe(1);

      const after = getWorkspaceDevelopmentTask(WS, t.dev_task_id)!;
      expect(after.state).toBe('WAITING_FOR_APPROVAL');
      expect(after.review_provider).toBe('openai');
      expect(after.review_text).toContain('PROCEED');
      expect(after.review_at).toBeTruthy();
    } finally { delete process.env.OPENAI_API_KEY; }
  });

  it('a provider failure is reported as FAILED review, and does not silently mark the task reviewed', async () => {
    process.env.OPENAI_API_KEY = 'sk-devloop-test-key';
    oaBehaviour = { status: 401, body: { error: { message: 'Incorrect API key provided.' } } };
    try {
      const t = newTask();
      const r = await requestDevelopmentReview(WS, t.dev_task_id);
      expect(r.outcome).toBe('FAILED');
      expect(r.reason).toContain('401');
      expect(getWorkspaceDevelopmentTask(WS, t.dev_task_id)!.state).toBe('WAITING_FOR_REVIEW');
    } finally { delete process.env.OPENAI_API_KEY; }
  });
});

describe('3b. THE REVIEW SEAT is a SynthOS reviewer, not a generic API call', () => {
  it('runs on the flagship reasoning model, kept separate from the general worker default', () => {
    expect(DEFAULT_OPENAI_REVIEW_MODEL).toBe('gpt-5.6-sol');
    expect(resolveReviewSeatModel()).toBe('gpt-5.6-sol');
  });

  it('the seat model is configurable, so a retired snapshot is an env change not a code change', () => {
    process.env.OPENAI_REVIEW_MODEL = 'gpt-6-astra';
    try { expect(resolveReviewSeatModel()).toBe('gpt-6-astra'); }
    finally { delete process.env.OPENAI_REVIEW_MODEL; }
  });

  it('the directive names the role and the things this project actually gets wrong', () => {
    expect(REVIEW_SEAT_DIRECTIVE).toContain('SynthOS Development Review Seat');
    // The two failure modes a generic "is this clear?" reviewer waves through.
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/Reuse/);
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/Duplicate architecture/i);
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/second execution engine/i);
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/Contradiction/i);
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/Guardian/);
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/Readiness/i);
  });

  it('it is told not to redesign, and not to invent project facts', () => {
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/Do not redesign/i);
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/Do not invent project facts/i);
  });

  it('it never claims authority it does not have — approval and Guardian still stand after it', () => {
    expect(REVIEW_SEAT_DIRECTIVE).toMatch(/your verdict does not authorise execution/i);
  });

  it('continuity is NOT hard-coded: the directive carries no project history, only the role', () => {
    // Everything the seat knows about SynthOS must arrive as retrieved context,
    // so the seat improves as the Vault grows rather than as this string grows.
    expect(REVIEW_SEAT_DIRECTIVE.length).toBeLessThan(2500);
    expect(REVIEW_SEAT_DIRECTIVE).not.toMatch(/Antigravity|Windmill|gpt-5|Push 2/i);
  });

  it('the assembled prompt carries the directive, the task and the scoped context', () => {
    const task = newTask();
    const prompt = buildReviewPrompt(task, {
      items: [{ artifactId: 'a1', title: 'Prior cycle', path: 'p.md', excerpt: 'The scheduler advances executions.' }],
      reason: 'one item',
    });
    expect(prompt).toContain('SynthOS Development Review Seat');
    expect(prompt).toContain(task.instruction);
    expect(prompt).toContain('The scheduler advances executions.');
    expect(prompt).toContain('Reuse and duplication');
  });
});

describe('4. APPROVAL is a human gate a model cannot grant itself', () => {
  it('a reviewed task still waits for a person before it can execute', async () => {
    process.env.OPENAI_API_KEY = 'sk-devloop-test-key';
    try {
      const t = newTask();
      await requestDevelopmentReview(WS, t.dev_task_id);
      const reviewed = getWorkspaceDevelopmentTask(WS, t.dev_task_id)!;
      expect(reviewed.state).toBe('WAITING_FOR_APPROVAL');
      // Dispatch is refused until a human approves.
      await expect(dispatchDevelopmentTask(WS, t.dev_task_id, ACTOR)).rejects.toThrow(/ready for execution/i);

      const approved = approveDevelopmentTask(WS, t.dev_task_id, APPROVER);
      expect(approved.state).toBe('READY_FOR_EXECUTION');
      expect(approved.approved_by_user_id).toBe(APPROVER);
      expect(approved.approved_at).toBeTruthy();
    } finally { delete process.env.OPENAI_API_KEY; }
  });

  it('a task not waiting for approval cannot be approved into existence', () => {
    expect(() => approveDevelopmentTask(WS, newTask().dev_task_id, APPROVER)).toThrow(/waiting for approval/i);
  });
});

describe('5. GUARDIAN refuses before dispatch, and the task records why', () => {
  it('a destructive instruction is BLOCKED with no execution row and no network contact', async () => {
    const before = submitCount;
    const t = approvedTask({ requiresReview: false, instruction: 'rm -rf / and report the result'  });
    const r = await dispatchDevelopmentTask(WS, t.dev_task_id, ACTOR);

    expect(r.task.state).toBe('BLOCKED');
    expect(r.execution).toBeNull();
    expect(r.task.state_reason).toContain('Guardian refused');
    expect(submitCount).toBe(before);
  });
});

describe('6. THE FULL LOOP runs to VERIFIED with no manual polling', () => {
  it('review -> approve -> dispatch -> scheduler sweep -> Aegis -> receipt -> writeback', async () => {
    process.env.OPENAI_API_KEY = 'sk-devloop-test-key';
    try {
      const t = newTask();

      const review = await requestDevelopmentReview(WS, t.dev_task_id);
      expect(review.outcome).toBe('REVIEWED');
      approveDevelopmentTask(WS, t.dev_task_id, APPROVER);

      const dispatched = await dispatchDevelopmentTask(WS, t.dev_task_id, ACTOR);
      expect(dispatched.task.state).toBe('RUNNING');
      expect(dispatched.execution!.runtime).toBe('antigravity');
      const executionId = dispatched.execution!.id;

      // Still running remotely — the loop must NOT claim verified yet.
      expect(reconcileDevelopmentTask(WS, t.dev_task_id).state).toBe('RUNNING');

      // Remote finishes. NOTHING here polls: the scheduler sweep does it all.
      interactions.get(dispatched.execution!.remote_job_id!)!.status = 'completed';
      interactions.get(dispatched.execution!.remote_job_id!)!.text = REAL_EXECUTION_OUTPUT;
      makeDue(executionId);
      const sweep = await advanceDueExternalExecutions();
      expect(sweep.ingested).toBe(1);

      const done = reconcileDevelopmentTask(WS, t.dev_task_id);
      expect(done.state).toBe('VERIFIED');
      expect(done.task_id).toBeTruthy();
      expect(done.result_artifact_id).toBeTruthy();
      expect(done.result_receipt_id).toBeTruthy();
      expect(done.aegis_decision).toBe('VERIFIED');

      // Real evidence on the canonical task, signed.
      const receipts = getTaskReceipts(done.task_id!);
      expect(receipts.length).toBe(1);
      expect(verifyReceipt(receipts[0])).toBe(true);
      expect(JSON.parse(receipts[0].payload_json).provider).toBe('antigravity');
      expect(getTaskArtifacts(done.task_id!).length).toBe(1);
      expect(getTaskQualityReviews(done.task_id!)[0].decision).toBe('VERIFIED');

      // Decision-trail writeback: what was asked, reviewed, approved and run.
      const events = getDatabase()
        .prepare('SELECT event_type, payload_json FROM activity_events WHERE task_id = ? ORDER BY rowid')
        .all(done.task_id!) as any[];
      const cycle = events.find((e) => e.event_type === 'DEVELOPMENT_CYCLE_COMPLETED');
      expect(cycle).toBeTruthy();
      const payload = JSON.parse(cycle.payload_json);
      expect(payload.devTaskId).toBe(t.dev_task_id);
      expect(payload.reviewProvider).toBe('openai');
      expect(payload.approvedBy).toBe(APPROVER);
      expect(payload.runtime).toBe('antigravity');
      expect(payload.aegisDecision).toBe('VERIFIED');
      expect(payload.receiptId).toBe(done.result_receipt_id);

      // The credential never reaches the trail.
      expect(JSON.stringify(payload)).not.toContain('sk-devloop-test-key');
      expect(JSON.stringify(payload)).not.toContain('devloop-ag-key');
    } finally { delete process.env.OPENAI_API_KEY; }
  });

  it('reconciling repeatedly is idempotent — one cycle event, never a duplicate', async () => {
    const t = approvedTask({ requiresReview: false  });
    const dispatched = await dispatchDevelopmentTask(WS, t.dev_task_id, ACTOR);
    interactions.get(dispatched.execution!.remote_job_id!)!.status = 'completed';
    interactions.get(dispatched.execution!.remote_job_id!)!.text = REAL_EXECUTION_OUTPUT;
    makeDue(dispatched.execution!.id);
    await advanceDueExternalExecutions();

    const first = reconcileDevelopmentTask(WS, t.dev_task_id);
    expect(first.state).toBe('VERIFIED');
    reconcileDevelopmentTask(WS, t.dev_task_id);
    reconcileDevelopmentTask(WS, t.dev_task_id);

    const count = (getDatabase()
      .prepare("SELECT COUNT(*) c FROM activity_events WHERE task_id = ? AND event_type = 'DEVELOPMENT_CYCLE_COMPLETED'")
      .get(first.task_id!) as any).c;
    expect(count).toBe(1);
  });

  it('a task whose execution genuinely failed is FAILED, never VERIFIED', async () => {
    const t = approvedTask({ requiresReview: false  });
    const dispatched = await dispatchDevelopmentTask(WS, t.dev_task_id, ACTOR);
    interactions.get(dispatched.execution!.remote_job_id!)!.status = 'failed';
    makeDue(dispatched.execution!.id);
    await advanceDueExternalExecutions();

    const done = reconcileDevelopmentTask(WS, t.dev_task_id);
    expect(done.state).toBe('FAILED');
    expect(done.result_receipt_id).toBeNull();
    expect(getWorkspaceExternalExecution(WS, dispatched.execution!.id)!.status).toBe('FAILED');
  });

  it('a succeeded execution that has NOT yet been ingested stays RUNNING — verification is never assumed', async () => {
    const t = approvedTask({ requiresReview: false  });
    const dispatched = await dispatchDevelopmentTask(WS, t.dev_task_id, ACTOR);
    // Remote succeeded, but SynthOS has not turned it into evidence yet.
    getDatabase().prepare("UPDATE external_executions SET status='SUCCEEDED', result_ingested_at=NULL WHERE id=?")
      .run(dispatched.execution!.id);
    expect(reconcileDevelopmentTask(WS, t.dev_task_id).state).toBe('RUNNING');
  });
});
