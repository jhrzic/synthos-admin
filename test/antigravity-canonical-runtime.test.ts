import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// runtime.antigravity AS A CANONICAL RUNTIME — CONTRACT / INTEGRATION PROOF.
//
// WHAT THIS IS: every SynthOS component is real — the orchestrator, the
// autonomy gate, the atomic claims, Guardian, the approval queue, the
// execution envelope, the external-execution ledger, the one scheduler sweep,
// ingestion, Aegis, Ed25519 receipt signing, the Vault writer and the Brain
// index. The ONLY double is Google's managed-agent HTTP endpoint, replaced by a
// local server at the adapter's network boundary (ANTIGRAVITY_BASE_URL), which
// serves the response shape observed live on 2026-09-14.
//
// WHAT THIS IS NOT: a live Antigravity run. It proves nothing about provider
// connectivity, credentials, or the remote agent's behaviour.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-ag-canonical-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'ag.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('ag-canonical');

import { ensureWorkspace } from '../lib/workspaces';
import {
  createOrchestratedTask, getOrchestratorTask, getDatabase, getTaskArtifacts, getTaskReceipts,
  getTaskQualityReviews, verifyReceipt, listStrandedOrchestrationTasks, closeDatabase,
} from '../lib/persistence';
import { runOrchestrationTick, advanceTask } from '../lib/fabric/orchestrator';
import { decideApproval, listWorkspaceApprovals } from '../lib/approvals';
import { runExternalExecutionReconciliation } from '../lib/fabric/scheduler';
import { listWorkspaceExternalExecutions, MAX_POLL_ATTEMPTS } from '../lib/external-executions';
import { resolveAntigravityBinding, antigravityApprovalDigest, executeEnvelope } from '../lib/fabric/envelope';
import { searchWorkspaceMemory } from '../lib/memory-index';

const WS = 'ws-ag-canonical';
const OUTPUT = [
  '# Contract run report',
  '',
  'The sandbox wrote the requested file notes/contract-proof.txt and read it back.',
  'The contents matched the requested value exactly, with no modification.',
  '',
  '## Steps performed',
  '',
  'A file was written to the working directory, then re-read from disk to confirm its contents.',
  'No external systems were contacted and no production state was changed.',
].join('\n');

interface Remote { status: 'queued' | 'in_progress' | 'completed' | 'failed'; text: string }
const remotes = new Map<string, Remote>();
let submissions: Array<{ id: string; body: any }> = [];
let server: http.Server;

beforeAll(async () => {
  getDatabase();
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (s: number, p: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(p)); };
      const url = req.url || '';
      if (req.method === 'POST' && url.endsWith('/interactions')) {
        const id = `int-contract-${submissions.length + 1}`;
        submissions.push({ id, body: JSON.parse(body || '{}') });
        remotes.set(id, { status: 'queued', text: '' });
        return json(200, { id, status: 'queued' });
      }
      const m = url.match(/\/interactions\/([^/?]+)$/);
      if (req.method === 'GET' && m) {
        const r = remotes.get(decodeURIComponent(m[1]));
        if (!r) return json(404, { error: { message: 'not found' } });
        // The REAL completed shape: no output_text; the answer is a model_output step.
        return json(200, {
          id: m[1], status: r.status,
          steps: r.text ? [
            { type: 'function_call', name: 'write_file' },
            { type: 'function_result', content: [{ type: 'text', text: 'raw tool payload, not the answer' }] },
            { type: 'function_call', name: 'read_file' },
            { type: 'model_output', content: [{ type: 'text', text: r.text }] },
          ] : [],
          usage: { total_tokens: 2048 },
          environment_id: 'env-contract',
        });
      }
      json(404, { error: { message: 'not found' } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.ANTIGRAVITY_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.ANTIGRAVITY_API_KEY = 'contract-test-key-not-a-real-credential';
  process.env.ANTIGRAVITY_ENABLED = 'true';
  process.env.SYNTHOS_AUTONOMY_LEVEL = 'APPROVAL_GATED_EXTERNAL';
  ensureWorkspace(WS, 'Antigravity contract');
});

afterAll(async () => {
  for (const k of ['ANTIGRAVITY_BASE_URL', 'ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_ENABLED', 'SYNTHOS_AUTONOMY_LEVEL']) delete process.env[k];
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  process.env.ANTIGRAVITY_ENABLED = 'true';
  process.env.SYNTHOS_AUTONOMY_LEVEL = 'APPROVAL_GATED_EXTERNAL';
});

let seq = 0;
function agTask(params: Record<string, unknown> = {}, title = 'Write and read back a proof file') {
  const taskId = `ag-task-${Date.now()}-${seq++}`;
  createOrchestratedTask({
    taskId, workspaceId: WS, title,
    description: 'Create notes/contract-proof.txt containing the word verified, read it back, and report the contents.',
    assignedAgent: 'antigravity', assignedModel: 'antigravity',
    capability: 'runtime.antigravity',
    parameters: {
      instruction: 'Create notes/contract-proof.txt containing the word verified, read it back, and report the contents.',
      allowedPaths: ['notes/'],
      ...params,
    },
  });
  return taskId;
}

const tick = () => runOrchestrationTick({ workspaceId: WS, maxTasks: 5 });
const status = (taskId: string) => getOrchestratorTask(taskId, WS)!.status;
const pendingFor = (taskId: string) => listWorkspaceApprovals(WS).filter((a: any) => a.correlation_id === `orchestration:${taskId}`);
const execFor = (taskId: string) => listWorkspaceExternalExecutions(WS, 200).find((e) => e.task_id === taskId);
function makeDue(id: string) {
  getDatabase().prepare('UPDATE external_executions SET next_poll_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
}
const claimFor = (taskId: string) => getDatabase()
  .prepare("SELECT status FROM execution_claims WHERE idempotency_key = ? AND actor_user_id = 'orchestrator'")
  .get(`orchestration-task:${taskId}`) as { status: string } | undefined;

async function approve(taskId: string) {
  const pending = pendingFor(taskId).filter((a: any) => a.status === 'PENDING');
  expect(pending.length).toBe(1);
  const d = decideApproval({ approvalId: pending[0].approval_id, workspaceId: WS, decidedByUserId: 'john', decision: 'APPROVED' });
  expect(d.ok).toBe(true);
  return pending[0];
}

describe('CONTRACT PROOF — Task → Brain → Guardian → WAITING_FOR_APPROVAL → approve → envelope → SUBMITTED → sweep → ingest → Aegis → receipt → DONE', () => {
  it('runs end to end with exactly one human action and no copy/paste', async () => {
    const taskId = agTask();
    const before = submissions.length;

    // 1. Unattended: planned, Guardian-checked, stopped at the human gate.
    const first = await tick();
    const step1 = first.steps.find((s) => s.taskId === taskId)!;
    expect(step1.outcome).toBe('WAITING_APPROVAL');
    expect(status(taskId)).toBe('WAITING_FOR_APPROVAL');
    expect(submissions.length).toBe(before); // nothing paid happened

    // The queue shows the human what they are paying for.
    const approval = pendingFor(taskId)[0] as any;
    expect(approval.capability).toBe('runtime.antigravity');
    expect(approval.action_summary).toContain('PAID REMOTE EXECUTION');
    expect(approval.action_summary).toContain('notes/');

    // 2. THE ONE HUMAN ACTION.
    await approve(taskId);

    // 3. The next tick resumes on its own and submits — no Run button.
    const second = await tick();
    expect(second.resumed.map((r) => r.taskId)).toContain(taskId);
    const step2 = second.steps.find((s) => s.taskId === taskId)!;
    expect(step2.outcome).toBe('SUBMITTED');
    expect(status(taskId)).toBe('RUNNING');
    expect(submissions.length).toBe(before + 1);
    // What was sent is the bounded instruction, scope included.
    expect(submissions[submissions.length - 1].body.input).toContain('SCOPE (approved by a human');
    expect(submissions[submissions.length - 1].body.input).toContain('- notes/');

    const exec = execFor(taskId)!;
    expect(exec.runtime).toBe('antigravity');
    expect(exec.status).toBe('SUBMITTED');
    expect(claimFor(taskId)!.status).toBe('CLAIMED'); // held while in flight
    expect(pendingFor(taskId)[0].status).toBe('CONSUMED'); // single-use

    // Not stranded while the sweep is still polling it.
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(listStrandedOrchestrationTasks(WS, future).map((t) => t.task_id)).not.toContain(taskId);

    // 4. Still running remotely: the sweep polls, nothing completes.
    makeDue(exec.id);
    await runExternalExecutionReconciliation();
    expect(status(taskId)).toBe('RUNNING');

    // 5. Simulated provider completion AT THE ADAPTER BOUNDARY.
    remotes.get(exec.remote_job_id!)!.status = 'completed';
    remotes.get(exec.remote_job_id!)!.text = OUTPUT;
    makeDue(exec.id);
    const sweep = await runExternalExecutionReconciliation();
    expect(sweep.ingested).toBe(1);

    // 6. The SAME canonical task is DONE, with real evidence.
    expect(status(taskId)).toBe('DONE');
    const task = getOrchestratorTask(taskId, WS)!;
    expect(task.title).toBe('Write and read back a proof file'); // not overwritten by ingestion
    const receipts = getTaskReceipts(taskId);
    expect(receipts.length).toBe(1);
    expect(verifyReceipt(receipts[0])).toBe(true);
    expect(JSON.parse(receipts[0].payload_json).provider).toBe('antigravity');
    expect(getTaskArtifacts(taskId).length).toBe(1);
    expect(getTaskQualityReviews(taskId)[0].decision).toBe('VERIFIED');
    expect(claimFor(taskId)!.status).toBe('DONE');

    // model_output is the answer; the raw function_result is not.
    const artifactText = fs.readFileSync(getTaskArtifacts(taskId)[0].disk_path, 'utf8');
    expect(artifactText).toContain('read it back');
    expect(artifactText).not.toContain('raw tool payload');

    // Brain writeback: the verified artifact is retrievable.
    expect(searchWorkspaceMemory(WS, 'contract proof sandbox', 10).length).toBeGreaterThan(0);

    // Activity trail joins the whole chain on the task.
    const events = (getDatabase().prepare('SELECT event_type FROM activity_events WHERE task_id = ? ORDER BY rowid').all(taskId) as any[]).map((e) => e.event_type);
    for (const e of ['APPROVAL_GRANTED', 'EXTERNAL_EXECUTION_SUBMITTED', 'AEGIS_REVIEWED', 'RECEIPT_CREATED', 'TASK_COMPLETED']) {
      expect(events, e).toContain(e);
    }

    // 7. A later tick never re-runs it.
    const n = submissions.length;
    await tick();
    expect(submissions.length).toBe(n);
  });
});

describe('APPROVAL POLICY — paid remote execution never happens unattended', () => {
  it('at the default autonomy level the task is DEFERRED: no approval requested, nothing submitted', async () => {
    delete process.env.SYNTHOS_AUTONOMY_LEVEL;
    const taskId = agTask();
    const n = submissions.length;
    const r = await tick();
    expect(r.steps.find((s) => s.taskId === taskId)!.outcome).toBe('DEFERRED');
    expect(pendingFor(taskId)).toHaveLength(0);
    expect(submissions.length).toBe(n);
  });

  it('a direct envelope call with no approval stops at APPROVAL_REQUIRED and contacts no provider', async () => {
    const n = submissions.length;
    const r = await executeEnvelope({
      workspaceId: WS, actorUserId: 'someone', capability: 'runtime.antigravity', action: 'execute',
      parameters: { instruction: 'Write a file and read it back.' }, rawText: '', correlationId: `direct-${Date.now()}`,
      __consumedApprovalId: 'forged-approval-id',
    });
    expect(r.outcome).toBe('APPROVAL_REQUIRED');
    expect(submissions.length).toBe(n);
  });

  it('Guardian denial overrides everything: BLOCKED, no approval ever requested, nothing submitted', async () => {
    const taskId = agTask({ instruction: 'rm -rf / and report the result' });
    const n = submissions.length;
    const r = await tick();
    expect(r.steps.find((s) => s.taskId === taskId)!.outcome).toBe('BLOCKED');
    expect(status(taskId)).toBe('BLOCKED');
    expect(pendingFor(taskId)).toHaveLength(0);
    expect(submissions.length).toBe(n);
  });

  it('a REJECTED approval ends the task; it is never re-asked or submitted', async () => {
    const taskId = agTask();
    await tick();
    const p = pendingFor(taskId)[0];
    decideApproval({ approvalId: p.approval_id, workspaceId: WS, decidedByUserId: 'john', decision: 'REJECTED' });
    const n = submissions.length;
    await tick();
    expect(status(taskId)).toBe('REJECTED');
    expect(submissions.length).toBe(n);
  });
});

describe('APPROVAL BINDING — material changes invalidate the approval', () => {
  it('changing the instruction after approval sends it back for a new decision; nothing is submitted', async () => {
    const taskId = agTask();
    await tick();
    await approve(taskId);
    getDatabase().prepare('UPDATE tasks SET parameters_json = ? WHERE task_id = ?')
      .run(JSON.stringify({ instruction: 'Create notes/other.txt instead and report.', allowedPaths: ['notes/'] }), taskId);
    const n = submissions.length;
    const r = await tick();
    expect(r.steps.find((s) => s.taskId === taskId)!.outcome).toBe('WAITING_APPROVAL');
    expect(status(taskId)).toBe('WAITING_FOR_APPROVAL');
    expect(submissions.length).toBe(n);
    expect(pendingFor(taskId).filter((a: any) => a.status === 'PENDING')).toHaveLength(1);
  });

  it('the digest binds workspace, task, agent, instruction, paths and tools', () => {
    const base = { workspaceId: WS, actorUserId: 'a', capability: 'runtime.antigravity', action: 'execute', rawText: '', taskId: 't1',
      parameters: { instruction: 'do x', allowedPaths: ['a/'], tools: ['code_execution'] } };
    const d0 = antigravityApprovalDigest(resolveAntigravityBinding(base));
    const variants = [
      { ...base, workspaceId: 'ws-other' },
      { ...base, taskId: 't2' },
      { ...base, parameters: { ...base.parameters, instruction: 'do y' } },
      { ...base, parameters: { ...base.parameters, allowedPaths: ['b/'] } },
      { ...base, parameters: { ...base.parameters, tools: ['google_search'] } },
    ];
    for (const v of variants) expect(antigravityApprovalDigest(resolveAntigravityBinding(v))).not.toBe(d0);
    process.env.ANTIGRAVITY_AGENT = 'antigravity-some-other-agent';
    try { expect(antigravityApprovalDigest(resolveAntigravityBinding(base))).not.toBe(d0); } finally { delete process.env.ANTIGRAVITY_AGENT; }
    // Ordering of paths/tools is not material.
    const reordered = { ...base, parameters: { ...base.parameters, allowedPaths: ['a/', 'a/'] } };
    expect(antigravityApprovalDigest(resolveAntigravityBinding(reordered))).toBe(d0);
  });
});

describe('DUPLICATE SUBMISSION and RESTART', () => {
  it('two overlapping ticks after approval submit exactly once', async () => {
    const taskId = agTask();
    await tick();
    await approve(taskId);
    const n = submissions.length;
    await Promise.all([tick(), tick()]);
    expect(submissions.length).toBe(n + 1);
    expect(listWorkspaceExternalExecutions(WS, 200).filter((e) => e.task_id === taskId)).toHaveLength(1);
  });

  it('re-advancing a submitted task is refused by its open claim; nothing is resubmitted', async () => {
    const taskId = agTask();
    await tick(); await approve(taskId); await tick();
    expect(status(taskId)).toBe('RUNNING');
    const n = submissions.length;
    getDatabase().prepare("UPDATE tasks SET status = 'READY' WHERE task_id = ?").run(taskId); // simulate a bad actor re-queueing it
    const step = await advanceTask(getOrchestratorTask(taskId, WS)!);
    expect(['NOT_CLAIMED']).toContain(step.outcome);
    expect(submissions.length).toBe(n);
  });

  it('a restart mid-flight resumes from the ledger alone and completes the task', async () => {
    const taskId = agTask();
    await tick(); await approve(taskId); await tick();
    const exec = execFor(taskId)!;

    closeDatabase(); // "restart": no in-memory state survives
    getDatabase();

    remotes.get(exec.remote_job_id!)!.status = 'completed';
    remotes.get(exec.remote_job_id!)!.text = OUTPUT;
    makeDue(exec.id);
    await runExternalExecutionReconciliation();
    expect(status(taskId)).toBe('DONE');
    expect(getTaskReceipts(taskId)).toHaveLength(1);
  });
});

describe('HONEST TERMINAL STATES for the canonical task', () => {
  it('a remote failure makes the task FAILED — no artifact, no receipt', async () => {
    const taskId = agTask();
    await tick(); await approve(taskId); await tick();
    const exec = execFor(taskId)!;
    remotes.get(exec.remote_job_id!)!.status = 'failed';
    makeDue(exec.id);
    await runExternalExecutionReconciliation();
    expect(status(taskId)).toBe('FAILED');
    expect(getTaskReceipts(taskId)).toHaveLength(0);
    expect(claimFor(taskId)!.status).toBe('FAILED');
  });

  it('a poll deadline makes the task BLOCKED for an operator, never FAILED or DONE', async () => {
    const taskId = agTask();
    await tick(); await approve(taskId); await tick();
    const exec = execFor(taskId)!;
    getDatabase().prepare('UPDATE external_executions SET poll_attempts = ? WHERE id = ?').run(MAX_POLL_ATTEMPTS - 1, exec.id);
    makeDue(exec.id);
    await runExternalExecutionReconciliation();
    expect(status(taskId)).toBe('BLOCKED');
    expect(claimFor(taskId)!.status).toBe('FAILED');
  });

  it('when Antigravity is not enabled the task is DEFERRED before any approval is requested', async () => {
    delete process.env.ANTIGRAVITY_ENABLED;
    const taskId = agTask();
    const r = await tick();
    expect(r.steps.find((s) => s.taskId === taskId)!.outcome).toBe('DEFERRED');
    expect(pendingFor(taskId)).toHaveLength(0);
  });
});

describe('EXACTLY ONE POLLING OWNER', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

  it('only the external-execution ledger talks to the Antigravity status/result API', () => {
    const libFiles = fs.readdirSync(path.join(process.cwd(), 'lib'), { recursive: true } as any)
      .map(String).filter((f) => f.endsWith('.ts')).map((f) => `lib/${f}`);
    const callers = libFiles.filter((f) => /getInteractionStatus\(|getInteractionResult\(/.test(read(f)) && f !== 'lib/antigravity-client.ts');
    expect(callers).toEqual(['lib/external-executions.ts']);
  });

  it('the orchestrator, the envelope and the Development loop never poll or advance', () => {
    for (const f of ['lib/fabric/orchestrator.ts', 'lib/fabric/envelope.ts', 'lib/development-loop.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/advanceDueExternalExecutions\(|advanceExternalExecution\(|refreshExternalExecutionStatus\(|refreshAndIngestIfComplete\(/);
    }
  });

  it('the scheduler is the one caller of the sweep, and the only lib timer', () => {
    const libFiles = fs.readdirSync(path.join(process.cwd(), 'lib'), { recursive: true } as any)
      .map(String).filter((f) => f.endsWith('.ts')).map((f) => `lib/${f}`);
    const sweepCallers = libFiles.filter((f) => /advanceDueExternalExecutions\(/.test(read(f)) && f !== 'lib/external-executions.ts');
    expect(sweepCallers).toEqual(['lib/fabric/scheduler.ts']);
    const timers = libFiles.filter((f) => /setInterval\(/.test(read(f)));
    expect(timers).toEqual(['lib/fabric/scheduler.ts']);
  });

  it('the Development loop submits through the envelope, not the ledger directly', () => {
    const src = read('lib/development-loop.ts');
    expect(src).toContain('executeEnvelope(');
    expect(src).not.toMatch(/submitExternalExecution\(/);
  });
});
