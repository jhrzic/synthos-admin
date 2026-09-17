import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-orch-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'orch.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.SYNTHOS_APPROVAL_VERIFICATION = 'true';

import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
const isolated = isolateVaultForTest('orchestration');

const REPO = path.join(TMP, 'repo');
fs.mkdirSync(path.join(REPO, 'docs'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'docs', 'orch-source.md'), '# Orchestration source\n\nReal bounded content for the orchestrator to read.\n');
process.env.SYNTHOS_REPO_ROOT = REPO;

import { ensureWorkspace } from '../lib/workspaces';
import {
  createOrchestratedTask, listOrchestratorEligibleTasks, claimTaskForOrchestration,
  getOrchestratorTask, updateTaskStatus, getTaskArtifacts, getTaskReceipts, verifyReceipt,
  createInitialTask, getDatabase, listStrandedOrchestrationTasks, acquireExecutionClaim,
  ORCHESTRATOR_ELIGIBLE_STATUSES, TASK_TERMINAL_STATUSES,
} from '../lib/persistence';
import { advanceTask, runOrchestrationTick, resumeApprovedTasks, getOrchestratorHealth, resetOrchestratorHealthForTests, deriveBrainQueryTerms } from '../lib/fabric/orchestrator';
import { resolveAutonomyLevel, mayAutonomouslyDispatch, DEFAULT_AUTONOMY_LEVEL, AUTONOMY_LEVELS } from '../lib/autonomy';
import { decideApproval, listWorkspaceApprovals, getApproval } from '../lib/approvals';
import { writeKnowledgeNote } from '../lib/knowledge-vault';
import { listRecentRuntimeEvents } from '../lib/runtime-events';

// ---------------------------------------------------------------------------
// NO-COPY/PASTE ORCHESTRATION.
//
// These drive the REAL orchestrator against a REAL database, a REAL filesystem
// and a REAL local provider double. `advanceTask` and `runOrchestrationTick`
// are called directly rather than through a timer, so the assertions are about
// the loop's decisions and not about how long a test is willing to sleep.
//
// The provider double matters for one case in particular: the UNKNOWN state.
// There is no way to reach "the provider may or may not have acted" against a
// real provider without risking the side effect the policy exists to prevent.
// ---------------------------------------------------------------------------

const WS_A = 'ws-orch-alpha';
const WS_B = 'ws-orch-bravo';

let doubleServer: http.Server;
let providerRequests = 0;
let PROVIDER: 'ok' | 'error' = 'ok';

beforeAll(async () => {
  doubleServer = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      providerRequests += 1;
      res.writeHead(PROVIDER === 'ok' ? 200 : 429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(PROVIDER === 'ok'
        ? { model: 'gpt-5.6-terra', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Bounded orchestration output.' }] }], usage: { total_tokens: 21 } }
        : { error: { message: 'You have no credits remaining.', type: 'insufficient_quota' } }));
    });
  });
  await new Promise<void>((r) => doubleServer.listen(0, '127.0.0.1', () => r()));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(doubleServer.address() as any).port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-proj-orchestration-test-key-0000000000';

  ensureWorkspace(WS_A, 'Alpha');
  ensureWorkspace(WS_B, 'Bravo');
  // One real Brain note so context retrieval has something truthful to find.
  writeKnowledgeNote({ title: 'Orchestration runtime context', kind: 'Sessions', workspaceId: WS_A, source: 'test' }, 'Bounded note for orchestration context.');
});

afterAll(async () => {
  await new Promise<void>((r) => doubleServer.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => { providerRequests = 0; PROVIDER = 'ok'; delete process.env.SYNTHOS_AUTONOMY_LEVEL; resetOrchestratorHealthForTests(); });

let n = 0;
const nextId = (label: string) => `task-orch-${label}-${Date.now()}-${n++}`;

function queueToolTask(workspaceId: string, capability: string, parameters: Record<string, unknown>, label = 'tool') {
  const taskId = nextId(label);
  createOrchestratedTask({
    taskId, workspaceId, title: `Orchestrated ${capability}`,
    description: `Bounded internal orchestration task for ${capability}.`,
    assignedAgent: 'scribe', assignedModel: 'gpt-5.6-terra', capability, parameters,
  });
  return taskId;
}

function queueModelTask(workspaceId: string, label = 'model') {
  const taskId = nextId(label);
  createOrchestratedTask({
    taskId, workspaceId, title: 'Orchestrated model synthesis',
    description: 'Summarise the supplied Brain context in one sentence.',
    assignedAgent: 'scribe', assignedModel: 'gpt-5.6-terra', capability: null, parameters: null,
  });
  return taskId;
}

// =========================================================================

describe('autonomy level', () => {
  it('defaults to INTERNAL_AUTOMATION', () => {
    expect(DEFAULT_AUTONOMY_LEVEL).toBe('INTERNAL_AUTOMATION');
    expect(resolveAutonomyLevel({} as NodeJS.ProcessEnv)).toBe('INTERNAL_AUTOMATION');
    expect(AUTONOMY_LEVELS).toEqual(['MANUAL', 'INTERNAL_AUTOMATION', 'APPROVAL_GATED_EXTERNAL']);
  });

  it('an unrecognised value falls back to the default, never to the most permissive', () => {
    expect(resolveAutonomyLevel({ SYNTHOS_AUTONOMY_LEVEL: 'FULL_SEND' } as any)).toBe('INTERNAL_AUTOMATION');
    expect(resolveAutonomyLevel({ SYNTHOS_AUTONOMY_LEVEL: '' } as any)).toBe('INTERNAL_AUTOMATION');
  });

  it('INTERNAL_AUTOMATION refuses unattended EXTERNAL_ACTION outright', () => {
    const v = mayAutonomouslyDispatch('EXTERNAL_ACTION', { SYNTHOS_AUTONOMY_LEVEL: 'INTERNAL_AUTOMATION' } as any);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/refuses unattended dispatch of EXTERNAL_ACTION/);
  });

  it('APPROVAL_GATED_EXTERNAL permits preparing one, and says the gate still applies', () => {
    const v = mayAutonomouslyDispatch('EXTERNAL_ACTION', { SYNTHOS_AUTONOMY_LEVEL: 'APPROVAL_GATED_EXTERNAL' } as any);
    expect(v.allowed).toBe(true);
    expect(v.reason).toMatch(/single-use human approval/);
  });

  it('MANUAL dispatches nothing at all', async () => {
    process.env.SYNTHOS_AUTONOMY_LEVEL = 'MANUAL';
    queueToolTask(WS_A, 'brain.search', { query: 'orchestration' }, 'manual');
    const tick = await runOrchestrationTick({ workspaceId: WS_A });
    expect(tick.level).toBe('MANUAL');
    expect(tick.steps).toHaveLength(0);
    expect(providerRequests).toBe(0);
  });
});

describe('task eligibility', () => {
  it('a task created by existing code paths is NOT autonomy-eligible', () => {
    const taskId = nextId('legacy');
    createInitialTask({ taskId, workspaceId: WS_A, title: 'Legacy', description: 'd', assignedAgent: 'scribe', assignedModel: 'gpt-5.6-terra' });
    const eligible = listOrchestratorEligibleTasks(WS_A, 200).map((t) => t.task_id);
    // Autonomy is opted into per task, never inherited by rows written before
    // the orchestrator existed.
    expect(eligible).not.toContain(taskId);
  });

  it('only TODO/READY are eligible; mid-flight and terminal are not', () => {
    expect([...ORCHESTRATOR_ELIGIBLE_STATUSES]).toEqual(['TODO', 'READY']);
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'x' }, 'states');
    for (const s of ['RUNNING', 'AWAITING_VERIFICATION', 'AWAITING_RECEIPT', ...TASK_TERMINAL_STATUSES, 'WAITING_FOR_APPROVAL']) {
      updateTaskStatus(taskId, s, undefined, WS_A);
      expect(listOrchestratorEligibleTasks(WS_A, 200).map((t) => t.task_id), s).not.toContain(taskId);
    }
    updateTaskStatus(taskId, 'READY', undefined, WS_A);
    expect(listOrchestratorEligibleTasks(WS_A, 200).map((t) => t.task_id)).toContain(taskId);
  });

  it('the queue is workspace-scoped', () => {
    const inB = queueToolTask(WS_B, 'brain.search', { query: 'bravo' }, 'wsb');
    expect(listOrchestratorEligibleTasks(WS_A, 200).map((t) => t.task_id)).not.toContain(inB);
    expect(listOrchestratorEligibleTasks(WS_B, 200).map((t) => t.task_id)).toContain(inB);
  });
});

describe('one task never executes twice', () => {
  it('the claim is atomic — only one of two racing claims wins', () => {
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'claim' }, 'claim');
    const a = claimTaskForOrchestration(taskId, WS_A);
    const b = claimTaskForOrchestration(taskId, WS_A);
    // SQLite decides, not application logic.
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(getOrchestratorTask(taskId, WS_A)!.status).toBe('RUNNING');
  });

  it('a claim cannot cross a workspace boundary', () => {
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'xws' }, 'xwsclaim');
    expect(claimTaskForOrchestration(taskId, WS_B)).toBe(false);
    expect(getOrchestratorTask(taskId, WS_A)!.status).toBe('TODO');
  });

  it('advancing an already-claimed task reports NOT_CLAIMED and runs nothing', async () => {
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'notclaimed' }, 'nc');
    const row = getOrchestratorTask(taskId, WS_A)!;
    expect(claimTaskForOrchestration(taskId, WS_A)).toBe(true);
    const step = await advanceTask(row);
    expect(step.outcome).toBe('NOT_CLAIMED');
  });

  it('a model task produces exactly one provider call, one artifact, one receipt', async () => {
    const taskId = queueModelTask(WS_A, 'single');
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('ADVANCED');
    expect(providerRequests).toBe(1);
    expect(getTaskArtifacts(taskId)).toHaveLength(1);
    const rcs = getTaskReceipts(taskId);
    expect(rcs).toHaveLength(1);
    expect(verifyReceipt(rcs[0])).toBe(true);
  });
});

describe('tool execution preserves the canonical contract', () => {
  it('a Brain tool task advances and carries a correlation id', async () => {
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'orchestration', limit: 3 }, 'brain');
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('ADVANCED');
    expect(step.correlationId).toBe(`orchestration:${taskId}`);
    expect(step.capability).toBe('brain.search');
    expect(getOrchestratorTask(taskId, WS_A)!.status).toBe('DONE');
  });

  it('a workspace-file tool task advances', async () => {
    const taskId = queueToolTask(WS_A, 'files.read', { root: 'docs', path: 'orch-source.md' }, 'files');
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('ADVANCED');
  });

  it('an artifact-writing tool task produces real evidence', async () => {
    const taskId = queueToolTask(WS_A, 'files.write_artifact', { title: 'Orchestrated artifact', content: 'Bounded orchestrated content.' }, 'artifact');
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('ADVANCED');
    expect(step.artifactId).toBeTruthy();
    expect(step.receiptId).toBeTruthy();
    expect(step.aegisDecision).toBeTruthy();
  });

  it('every orchestrated step leaves a durable runtime event', async () => {
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'evidence' }, 'evidence');
    await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    const rows = listRecentRuntimeEvents({ targetType: 'capability', limit: 500 })
      .map((e) => { try { return JSON.parse(e.detail_json || '{}'); } catch { return {}; } })
      .filter((d: any) => d.orchestration === true && d.taskId === taskId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].correlationId).toBe(`orchestration:${taskId}`);
  });

  it('an unregistered capability DEFERS rather than failing the task', async () => {
    const taskId = queueToolTask(WS_A, 'totally.invented', {}, 'unreg');
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('DEFERRED');
    // Still queued, so a later deploy that supplies the capability picks it up.
    expect(getOrchestratorTask(taskId, WS_A)!.status).toBe('TODO');
  });

  it('a task can never execute raw shell from generated text — dispatch is registry-bound', async () => {
    const taskId = queueToolTask(WS_A, 'rm -rf /', { cmd: 'rm -rf /' }, 'shell');
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    // Not a capability, so there is no executor to reach at all.
    expect(step.outcome).toBe('DEFERRED');
    expect(step.reason).toMatch(/not a registered capability/);
  });
});

describe('Brain context retrieval', () => {
  it('derives short distinctive terms, not one unmatchable needle', () => {
    // The defect this pins: the first version searched
    // `title + description` as a single 200-char substring, which can never
    // appear in a note. Brain context silently returned nothing for every
    // realistic task.
    const terms = deriveBrainQueryTerms(
      'NO-COPY/PASTE PROOF A — Brain retrieval + OpenAI synthesis Using only the supplied SynthOS Brain context, state in two sentences what the always-on runtime verification note establishes.',
    );
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.length).toBeLessThanOrEqual(4);
    for (const t of terms) {
      expect(t.length).toBeGreaterThanOrEqual(4);
      // Short, so a substring search can actually match a note.
      expect(t.length).toBeLessThan(30);
    }
    // Stopwords and scaffolding words are dropped.
    for (const junk of ['the', 'only', 'using', 'two', 'task', 'proof', 'synthos', 'context']) {
      expect(terms).not.toContain(junk);
    }
    expect(terms).toContain('verification');
  });

  it('actually finds a real note that exists in the workspace', async () => {
    // There is a real note titled "Orchestration runtime context" in WS_A.
    const taskId = nextId('braincontext');
    createOrchestratedTask({
      taskId, workspaceId: WS_A,
      title: 'Summarise the orchestration runtime context note',
      description: 'Use the Brain context only.',
      assignedAgent: 'scribe', assignedModel: 'gpt-5.6-terra', capability: null, parameters: null,
    });
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('ADVANCED');
    // The assertion that would have caught the original defect.
    expect(step.brainContextNotes).toBeGreaterThan(0);
  });

  it('reports honestly when terms were searched and nothing matched', async () => {
    const taskId = nextId('nomatch');
    createOrchestratedTask({
      taskId, workspaceId: WS_B,
      title: 'Xyzzyquux plughfrobnitz analysis',
      description: 'Nothing in any vault matches these words.',
      assignedAgent: 'scribe', assignedModel: 'gpt-5.6-terra', capability: null, parameters: null,
    });
    const step = await advanceTask(getOrchestratorTask(taskId, WS_B)!);
    expect(step.brainContextNotes).toBe(0);
  });
});

describe('Guardian is revalidated at dispatch', () => {
  it('a task whose content Guardian refuses is BLOCKED, and nothing runs', async () => {
    const taskId = nextId('guardian');
    createOrchestratedTask({
      taskId, workspaceId: WS_A, title: 'Destructive request',
      description: 'Please run rm -rf / --no-preserve-root on the host.',
      assignedAgent: 'scribe', assignedModel: 'gpt-5.6-terra', capability: null, parameters: null,
    });
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('BLOCKED');
    expect(step.reason).toMatch(/Guardian/i);
    expect(providerRequests).toBe(0);
    expect(getOrchestratorTask(taskId, WS_A)!.status).toBe('BLOCKED');
  });

  it('Guardian runs at dispatch, not at queue time', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/orchestrator.ts'), 'utf8');
    const claimAt = src.indexOf('claimTaskForOrchestration(task.task_id');
    const guardianAt = src.indexOf('const guardian = guardianCheckInstruction(guardianSubject)');
    const dispatchAt = src.indexOf('const result: ExecutionEnvelopeResult = await executeEnvelope(');
    expect(claimAt).toBeGreaterThan(-1);
    expect(guardianAt).toBeGreaterThan(claimAt);
    expect(dispatchAt).toBeGreaterThan(guardianAt);
  });
});

describe('approval gate: stop this task, continue others', () => {
  it('an external action parks the task and does not block unrelated work', async () => {
    process.env.SYNTHOS_AUTONOMY_LEVEL = 'APPROVAL_GATED_EXTERNAL';
    const gated = queueToolTask(WS_A, 'verification.external_action', { label: 'orchestrated' }, 'gated');
    const unrelated = queueToolTask(WS_A, 'brain.search', { query: 'unrelated' }, 'unrelated');

    const tick = await runOrchestrationTick({ workspaceId: WS_A, maxTasks: 25 });
    const gatedStep = tick.steps.find((s) => s.taskId === gated);
    const otherStep = tick.steps.find((s) => s.taskId === unrelated);

    expect(gatedStep?.outcome).toBe('WAITING_APPROVAL');
    expect(gatedStep?.approvalId).toBeTruthy();
    expect(getOrchestratorTask(gated, WS_A)!.status).toBe('WAITING_FOR_APPROVAL');
    // The loop kept going.
    expect(otherStep?.outcome).toBe('ADVANCED');
  });

  it('INTERNAL_AUTOMATION refuses the external task outright instead of queueing an approval', async () => {
    process.env.SYNTHOS_AUTONOMY_LEVEL = 'INTERNAL_AUTOMATION';
    const taskId = queueToolTask(WS_A, 'verification.external_action', { label: 'refused' }, 'refused');
    const before = listWorkspaceApprovals(WS_A, { limit: 500 }).length;
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('DEFERRED');
    // No approval was raised — an unattended loop must not manufacture
    // decisions for a human to rubber-stamp.
    expect(listWorkspaceApprovals(WS_A, { limit: 500 }).length).toBe(before);
  });

  it('after a real human approval the task resumes automatically and completes', async () => {
    process.env.SYNTHOS_AUTONOMY_LEVEL = 'APPROVAL_GATED_EXTERNAL';
    const taskId = queueToolTask(WS_A, 'verification.external_action', { label: 'resume' }, 'resume');

    const first = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(first.outcome).toBe('WAITING_APPROVAL');

    // A real human decision through the canonical path.
    const approvalId = first.approvalId!;
    expect(decideApproval({ approvalId, workspaceId: WS_A, decidedByUserId: 'human-admin', decision: 'APPROVED' }).ok).toBe(true);

    // NO manual trigger beyond the approval itself: the next tick resumes it.
    const tick = await runOrchestrationTick({ workspaceId: WS_A, maxTasks: 25 });
    expect(tick.resumed.some((r) => r.taskId === taskId && r.to === 'READY')).toBe(true);
    const step = tick.steps.find((s) => s.taskId === taskId);
    expect(step?.outcome).toBe('ADVANCED');
    expect(getApproval(approvalId)!.status).toBe('CONSUMED');
    expect(getOrchestratorTask(taskId, WS_A)!.status).toBe('DONE');
  });

  it('a REJECTED approval makes the task terminal — "no" is not "not yet"', async () => {
    process.env.SYNTHOS_AUTONOMY_LEVEL = 'APPROVAL_GATED_EXTERNAL';
    const taskId = queueToolTask(WS_A, 'verification.external_action', { label: 'rejected' }, 'rej');
    const first = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    decideApproval({ approvalId: first.approvalId!, workspaceId: WS_A, decidedByUserId: 'human-admin', decision: 'REJECTED', reason: 'not now' });

    resumeApprovedTasks(WS_A);
    expect(getOrchestratorTask(taskId, WS_A)!.status).toBe('REJECTED');
    // And it is not eligible again.
    expect(listOrchestratorEligibleTasks(WS_A, 200).map((t) => t.task_id)).not.toContain(taskId);
  });
});

describe('next-task advancement', () => {
  it('three independent tasks all reach terminal states in one bounded run', async () => {
    const a = queueModelTask(WS_A, 'chain-a');
    const b = queueToolTask(WS_A, 'files.read', { root: 'docs', path: 'orch-source.md' }, 'chain-b');
    const c = queueToolTask(WS_A, 'brain.search', { query: 'orchestration' }, 'chain-c');

    // maxTasks bounds a tick, so drain across ticks — which is the real
    // behaviour, not a test convenience.
    for (let i = 0; i < 5; i += 1) await runOrchestrationTick({ workspaceId: WS_A, maxTasks: 3 });

    for (const [label, id] of [['A', a], ['B', b], ['C', c]] as const) {
      expect([...TASK_TERMINAL_STATUSES], label).toContain(getOrchestratorTask(id, WS_A)!.status as any);
    }
  });

  it('a tick is bounded so a long queue cannot hold the timer', async () => {
    for (let i = 0; i < 6; i += 1) queueToolTask(WS_A, 'brain.search', { query: `bounded-${i}` }, `bounded-${i}`);
    const tick = await runOrchestrationTick({ workspaceId: WS_A, maxTasks: 2 });
    expect(tick.steps.length).toBeLessThanOrEqual(2);
  });

  it('a failed task does not stop the loop', async () => {
    PROVIDER = 'error';
    const failing = queueModelTask(WS_A, 'failing');
    PROVIDER = 'error';
    const step = await advanceTask(getOrchestratorTask(failing, WS_A)!);
    expect(step.outcome).toBe('FAILED');
    expect(getOrchestratorTask(failing, WS_A)!.status).toBe('FAILED');

    PROVIDER = 'ok';
    const next = queueToolTask(WS_A, 'brain.search', { query: 'after-failure' }, 'afterfail');
    const okStep = await advanceTask(getOrchestratorTask(next, WS_A)!);
    expect(okStep.outcome).toBe('ADVANCED');
  });

  it('task dependency semantics do not exist, so only independent tasks are processed', () => {
    // Stated as a test so the limitation is recorded rather than assumed. The
    // tasks table has no depends_on column; inventing one here would have been
    // inventing product.
    const cols = (getDatabase().prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain('depends_on');
    expect(cols).not.toContain('dependencies');
    expect(cols).toContain('capability');
    expect(cols).toContain('autonomy_eligible');
  });
});

describe('crash / restart recovery', () => {
  it('a claimed-but-unfinished task is surfaced as stranded and NOT re-run', async () => {
    const taskId = queueToolTask(WS_A, 'files.write_artifact', { title: 'Stranded', content: 'x' }, 'stranded');
    // Simulate a process that claimed the task and died.
    expect(claimTaskForOrchestration(taskId, WS_A)).toBe(true);
    getDatabase().prepare('UPDATE tasks SET updated_at = ? WHERE task_id = ?')
      .run(new Date(Date.now() - 30 * 60_000).toISOString(), taskId);

    const stranded = listStrandedOrchestrationTasks(WS_A, new Date(Date.now() - 10 * 60_000).toISOString());
    expect(stranded.map((s) => s.task_id)).toContain(taskId);

    const before = getTaskArtifacts(taskId).length;
    const tick = await runOrchestrationTick({ workspaceId: WS_A, maxTasks: 25 });
    expect(tick.stranded).toContain(taskId);
    // Surfaced, never re-executed: re-running is exactly how a duplicate
    // artifact and a duplicate provider bill appear.
    expect(tick.steps.map((s) => s.taskId)).not.toContain(taskId);
    expect(getTaskArtifacts(taskId).length).toBe(before);
  });

  it('the correlation id is derived from the task, so a resumed run rejoins the same trace', async () => {
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'stable' }, 'stable');
    const row = getOrchestratorTask(taskId, WS_A)!;
    const step1 = await advanceTask(row);
    // Deterministic: not a timestamp, not a random id.
    expect(step1.correlationId).toBe(`orchestration:${taskId}`);
  });

  it('re-advancing a completed task does not duplicate its artifact or receipt', async () => {
    const taskId = queueToolTask(WS_A, 'files.write_artifact', { title: 'No dup', content: 'once only' }, 'nodup');
    const first = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(first.outcome).toBe('ADVANCED');
    const artifacts = getTaskArtifacts(taskId).length;
    const receipts = getTaskReceipts(taskId).length;

    // Force it back to READY as a crashed-and-resumed task would be, then run
    // again. The stable idempotency key makes the envelope replay rather than
    // re-execute.
    updateTaskStatus(taskId, 'READY', undefined, WS_A);
    const second = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(['ADVANCED', 'DEFERRED', 'FAILED']).toContain(second.outcome);
    expect(getTaskArtifacts(taskId).length).toBe(artifacts);
    expect(getTaskReceipts(taskId).length).toBe(receipts);
  });
});

describe('the durable claim survives the kernel resetting task status', () => {
  it('a model task keeps its claim even though the kernel upserts status back to TODO', async () => {
    // THE DEFECT THIS PINS, found by the live restart proof:
    // lib/fabric/kernel.ts calls createInitialTask(), which UPSERTS the task
    // row to status 'TODO'. The orchestrator's status-based claim was
    // therefore undone by its own executor, and the observed history read
    //     TODO -> RUNNING -> TODO -> READY -> RUNNING
    // leaving a window where a second tick could claim a task already running.
    const taskId = queueModelTask(WS_A, 'durable');
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('ADVANCED');

    // The execution_claims row exists and is terminal — the kernel cannot
    // touch that table, so the claim held for the whole execution.
    const claim: any = getDatabase()
      .prepare('SELECT status, task_id FROM execution_claims WHERE idempotency_key = ?')
      .get(`orchestration-task:${taskId}`);
    expect(claim).toBeTruthy();
    expect(claim.task_id).toBe(taskId);
    expect(claim.status).toBe('DONE');
  });

  it('a second tick cannot claim a task whose execution claim is still open', async () => {
    const taskId = queueModelTask(WS_A, 'openclaim');
    // Simulate an in-flight execution: an open claim with no terminal status.
    const acq = acquireExecutionClaim({
      workspaceId: WS_A, actorUserId: 'orchestrator', capability: 'model.task',
      idempotencyKey: `orchestration-task:${taskId}`, payloadHash: `orchestration-task:${taskId}`, taskId,
    });
    expect(acq.outcome).toBe('ACQUIRED');

    const before = providerRequests;
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('NOT_CLAIMED');
    expect(step.reason).toMatch(/already open/i);
    // Nothing reached the provider — this is the duplicate-paid-call case.
    expect(providerRequests).toBe(before);
    expect(getTaskArtifacts(taskId)).toHaveLength(0);
  });

  it('a task whose previous claim FAILED is not retried silently', async () => {
    const taskId = queueModelTask(WS_A, 'failedclaim');
    const acq = acquireExecutionClaim({
      workspaceId: WS_A, actorUserId: 'orchestrator', capability: 'model.task',
      idempotencyKey: `orchestration-task:${taskId}`, payloadHash: `orchestration-task:${taskId}`, taskId,
    });
    expect(acq.outcome).toBe('ACQUIRED');
    const { resolveExecutionClaim } = await import('../lib/persistence');
    resolveExecutionClaim((acq as any).claim.claim_id, 'FAILED');

    const before = providerRequests;
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('FAILED');
    expect(step.reason).toMatch(/not retried automatically/i);
    expect(providerRequests).toBe(before);
  });

  it('a paused task RELEASES its claim so the resumed attempt really executes', async () => {
    // The bug this pins: settling a WAITING_APPROVAL claim as DONE made the
    // resumed attempt report ADVANCED without executing and without consuming
    // the approval — a convincing success that did nothing.
    process.env.SYNTHOS_AUTONOMY_LEVEL = 'APPROVAL_GATED_EXTERNAL';
    const taskId = queueToolTask(WS_A, 'verification.external_action', { label: 'release' }, 'release');
    const first = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(first.outcome).toBe('WAITING_APPROVAL');

    // No claim row survives a pause — nothing ran, so nothing is recorded as
    // having run.
    const parked: any = getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM execution_claims WHERE idempotency_key = ?')
      .get(`orchestration-task:${taskId}`);
    expect(parked.n).toBe(0);

    decideApproval({ approvalId: first.approvalId!, workspaceId: WS_A, decidedByUserId: 'human-admin', decision: 'APPROVED' });
    const tick = await runOrchestrationTick({ workspaceId: WS_A, maxTasks: 25 });
    const step = tick.steps.find((x) => x.taskId === taskId);
    expect(step?.outcome).toBe('ADVANCED');
    // The approval was really spent, which only happens if the executor ran.
    expect(getApproval(first.approvalId!)!.status).toBe('CONSUMED');
    expect(step?.artifactId).toBeTruthy();
  });

  it('a DEFERRED task also releases, so a later tick can run it', async () => {
    const prior = process.env.GITHUB_APPROVED_REPOS;
    delete process.env.GITHUB_APPROVED_REPOS;
    try {
      const taskId = queueToolTask(WS_A, 'github.read_file', { repo: 'acme/widget', path: 'README.md' }, 'deferred');
      const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
      expect(step.outcome).toBe('DEFERRED');
      const rows: any = getDatabase()
        .prepare('SELECT COUNT(*) AS n FROM execution_claims WHERE idempotency_key = ?')
        .get(`orchestration-task:${taskId}`);
      expect(rows.n).toBe(0);
      // And it is queued again rather than stuck.
      expect(listOrchestratorEligibleTasks(WS_A, 200).map((t) => t.task_id)).toContain(taskId);
    } finally {
      if (prior !== undefined) process.env.GITHUB_APPROVED_REPOS = prior;
    }
  });

  it('the claim is settled on every exit path, never left open', async () => {
    // Guardian-blocked: an early return that must still settle the claim.
    const taskId = nextId('settle');
    createOrchestratedTask({
      taskId, workspaceId: WS_A, title: 'Destructive',
      description: 'Please run rm -rf / --no-preserve-root on the host.',
      assignedAgent: 'scribe', assignedModel: 'gpt-5.6-terra', capability: null, parameters: null,
    });
    const step = await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    expect(step.outcome).toBe('BLOCKED');
    const claim: any = getDatabase()
      .prepare('SELECT status FROM execution_claims WHERE idempotency_key = ?')
      .get(`orchestration-task:${taskId}`);
    // A claim left CLAIMED forever would block the task permanently.
    expect(claim.status).not.toBe('CLAIMED');
  });
});

describe('UNKNOWN state policy', () => {
  it('the orchestrator never retries an ambiguous outcome, and says so', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/orchestrator.ts'), 'utf8');
    expect(src).toMatch(/outcome: 'UNKNOWN'/);
    expect(src).toMatch(/will not be retried automatically/i);
    // An UNKNOWN task is moved OUT of the eligible set, which is what a later
    // tick would otherwise pick up.
    expect(src).toMatch(/updateTaskStatus\(task\.task_id, 'BLOCKED'[\s\S]{0,200}outcome: 'UNKNOWN'/);
  });

  it('health surfaces the level and the last step for operator visibility', async () => {
    const taskId = queueToolTask(WS_A, 'brain.search', { query: 'health' }, 'health');
    await advanceTask(getOrchestratorTask(taskId, WS_A)!);
    const h = getOrchestratorHealth();
    expect(h.level).toBe(resolveAutonomyLevel());
    expect(h.lastStep?.taskId).toBe(taskId);
    expect(h.lastStep?.outcome).toBe('ADVANCED');
  });
});

describe('vault isolation holds for orchestration', () => {
  it('the orchestrator writes into the isolated test vault, never a real one', () => {
    expect(process.env.SYNTHOS_VAULT_PATH).toBe(isolated.root);
    expect(isolated.root.startsWith(os.tmpdir()) || isolated.root.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
    expect(isolated.root).not.toContain(path.join('synthos', 'vault'));
  });
});
