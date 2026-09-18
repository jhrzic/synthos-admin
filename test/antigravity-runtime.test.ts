import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-antigravity-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  submitExternalExecution as rawSubmitExternalExecution, getWorkspaceExternalExecution, listWorkspaceExternalExecutions,
  refreshExternalExecutionStatus, ingestExternalExecutionResult, cancelExternalExecution,
  retryExternalExecution, guardianCheckInstruction, isExternalRuntime, EXTERNAL_RUNTIMES,
} from '../lib/external-executions';
import * as antigravity from '../lib/antigravity-client';
import { getTaskReceipts, getTaskQualityReviews, verifyReceipt, getTaskArtifacts, getDatabase } from '../lib/persistence';
import { listCapabilities } from '../lib/fabric/registry';
import { getRuntimeStatus } from '../lib/runtime-status';
import { allowPaidExecutionForTest, consumedAntigravityApproval } from './helpers/spend';

// Every Antigravity submission needs a CONSUMED human approval bound to its
// key. These tests drive the ledger directly, so each call gets a real one
// through the real approval lifecycle — nothing is forged or bypassed.
let agKeySeq = 0;
const submitExternalExecution = (p: Parameters<typeof rawSubmitExternalExecution>[0]) => {
  const key = p.idempotencyKey ?? `test-ag-${Date.now()}-${agKeySeq++}`;
  return rawSubmitExternalExecution({ ...p, idempotencyKey: key, approvalId: consumedAntigravityApproval(p.workspaceId, key) });
};

// ---------------------------------------------------------------------------
// PUSH 1 — Antigravity as a real SynthOS execution runtime.
//
// METHOD, and its honest limit. There is no Google credential in this
// environment, so nothing here calls generativelanguage.googleapis.com. A
// real local HTTP server implements the actual managed-agent contract
// (POST /interactions, GET /interactions/{id}) and the REAL client is
// pointed at it through ANTIGRAVITY_BASE_URL — the same technique
// test/external-executions.test.ts already uses for Windmill, and the same
// real client code path production uses.
//
// What that proves: a task envelope really reaches the runtime with its
// identity intact, Guardian really refuses before dispatch, a real remote
// result really traverses task -> artifact -> Aegis -> receipt -> Vault,
// workspace isolation really holds, and the runtime's own claim of success
// really buys it nothing. What it does NOT prove: that Google's production
// endpoint accepts these requests. That needs a real credential, and is
// reported as unproven rather than implied.
// ---------------------------------------------------------------------------

const WS_A = 'ws-antigravity-alpha';
const WS_B = 'ws-antigravity-beta';
const ACTOR = 'user-antigravity-1';

type RemoteStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'requires_action';

interface RemoteInteraction {
  status: RemoteStatus;
  outputText: string;
  steps: { type: string; name?: string; arguments?: unknown }[];
  usage: unknown;
  environmentId: string;
}

const interactions = new Map<string, RemoteInteraction>();
/** What the stub actually received, so the test can assert the envelope really crossed the wire. */
let lastSubmit: { apiKeyHeader?: string; agent?: string; input?: string; background?: boolean; tools?: unknown } | undefined;
let submitCounter = 0;
/** Set to make the remote reject a submission, proving a failed submit is never recorded as SUBMITTED. */
let rejectSubmitWith: { status: number; message: string } | null = null;

let server: http.Server;

beforeAll(async () => {
  // Explicit opt-in: paid execution against a local double (Antigravity is bounded by its per-run ceiling).
  allowPaidExecutionForTest([]);
  getDatabase();

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url || '';
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // Every real endpoint requires the key header. A request without it is
      // rejected exactly as Google's would be, so "authenticated" is a real
      // observation in this file rather than an assumption.
      if (!req.headers['x-goog-api-key']) {
        return json(401, { error: { message: 'API key not valid.' } });
      }

      if (req.method === 'POST' && url.endsWith('/interactions')) {
        let parsed: any = {};
        try { parsed = JSON.parse(body); } catch { /* recorded as empty */ }
        lastSubmit = {
          apiKeyHeader: req.headers['x-goog-api-key'] as string,
          agent: parsed?.agent,
          input: parsed?.input,
          background: parsed?.background,
          tools: parsed?.tools,
        };
        if (rejectSubmitWith) {
          return json(rejectSubmitWith.status, { error: { message: rejectSubmitWith.message } });
        }
        const id = `interaction-${++submitCounter}`;
        interactions.set(id, {
          status: 'queued',
          outputText: '',
          steps: [],
          usage: null,
          environmentId: `env-${submitCounter}`,
        });
        return json(200, { id, status: 'queued' });
      }

      const getMatch = url.match(/\/interactions\/([^/?]+)$/);
      if (req.method === 'GET' && getMatch) {
        const id = decodeURIComponent(getMatch[1]);
        const record = interactions.get(id);
        if (!record) return json(404, { error: { message: 'Interaction not found.' } });
        // LIVE CONTRACT (verified 2026-09-14 against the real endpoint):
        // a completed interaction carries NO `output_text` key. The final
        // text lives in a `model_output` step under content[].text. This
        // stub serves that real shape, not the documented one, so the test
        // exercises the path production actually takes.
        const steps = record.outputText
          ? [...record.steps, { type: 'model_output', content: [{ type: 'text', text: record.outputText }] }]
          : record.steps;
        return json(200, {
          id,
          status: record.status,
          steps,
          usage: record.usage,
          environment_id: record.environmentId,
        });
      }

      json(404, { error: { message: 'not found' } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  process.env.ANTIGRAVITY_BASE_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.ANTIGRAVITY_BASE_URL;
  delete process.env.ANTIGRAVITY_API_KEY;
  delete process.env.ANTIGRAVITY_ENABLED;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  rejectSubmitWith = null;
  lastSubmit = undefined;
});

function enableRuntime() {
  process.env.ANTIGRAVITY_API_KEY = 'test-antigravity-key';
  process.env.ANTIGRAVITY_ENABLED = 'true';
}
function disableRuntime() {
  delete process.env.ANTIGRAVITY_API_KEY;
  delete process.env.ANTIGRAVITY_ENABLED;
}

/** Drive one interaction to completion with a real remote result. */
function completeInteraction(id: string, outputText: string) {
  const record = interactions.get(id)!;
  record.status = 'completed';
  record.outputText = outputText;
  record.steps = [
    { type: 'tool_call', name: 'code_execution', arguments: { code: 'SECRET_ARGUMENT_PAYLOAD' } },
    { type: 'tool_call', name: 'google_search', arguments: { q: 'x' } },
  ];
  record.usage = { input_tokens: 120, output_tokens: 340, total_tokens: 460 };
}

describe('1. TRUTHFUL STATUS — an unconfigured or disabled runtime says so, and refuses', () => {
  it('with no credential, the runtime reports NOT_CONFIGURED and never attempts a network call', async () => {
    disableRuntime();
    expect(antigravity.isAntigravityConfigured()).toBe(false);
    const health = await antigravity.health();
    expect(health.status).toBe('NOT_CONFIGURED');
    expect(health.reachable).toBe(false);
    expect(health.authenticated).toBe(false);
    // Never attempted: no latency was measured because no call was made.
    expect(health.latencyMs).toBeNull();
  });

  it('a credential WITHOUT the explicit enable flag is DISABLED — holding a Google key never silently grants autonomous remote execution', async () => {
    disableRuntime();
    process.env.ANTIGRAVITY_API_KEY = 'test-antigravity-key';
    try {
      expect(antigravity.isAntigravityConfigured()).toBe(true);
      expect(antigravity.isAntigravityEnabled()).toBe(false);
      const health = await antigravity.health();
      expect(health.status).toBe('DISABLED');
      expect(health.error).toContain('Antigravity is not enabled');
    } finally {
      disableRuntime();
    }
  });

  it('submission is refused while disabled, and leaves NO ledger row implying it was ever dispatched', async () => {
    disableRuntime();
    process.env.ANTIGRAVITY_API_KEY = 'test-antigravity-key';
    const before = listWorkspaceExternalExecutions(WS_A, 200).length;
    try {
      await expect(submitExternalExecution({
        workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
        input: { instruction: 'summarise the repository' },
      })).rejects.toThrow(/Antigravity is not enabled/);
    } finally {
      disableRuntime();
    }
    expect(listWorkspaceExternalExecutions(WS_A, 200).length).toBe(before);
  });

  it('the capability registry reports runtime.antigravity truthfully in each state, and always as an EXTERNAL_ACTION under Guardian', async () => {
    disableRuntime();
    let cap = (await listCapabilities()).find((c) => c.key === 'runtime.antigravity');
    expect(cap).toBeTruthy();
    expect(cap!.status).toBe('NOT_CONFIGURED');
    // These never vary with configuration — they are what the capability IS.
    expect(cap!.effectClass).toBe('EXTERNAL_ACTION');
    expect(cap!.riskTier).toBe('HIGH');
    expect(cap!.approvalPolicy).toBe('GUARDIAN_ENFORCED');
    expect(cap!.workspaceScope).toBe('admin');

    enableRuntime();
    try {
      cap = (await listCapabilities()).find((c) => c.key === 'runtime.antigravity');
      expect(cap!.status).toBe('AVAILABLE');
      expect(cap!.reason).toContain('checkGuardianRules');
      expect(cap!.effectClass).toBe('EXTERNAL_ACTION');
    } finally {
      disableRuntime();
    }
  });

  it('the runtime status table carries a live-probed Antigravity row once enabled', async () => {
    enableRuntime();
    try {
      const report = await getRuntimeStatus();
      const row = report.systems.find((s) => s.system === 'Antigravity Runtime');
      expect(row).toBeTruthy();
      expect(row!.evidenceSource).toBe('live_probe');
      // The stub answers 404 for an unknown id, which proves reachable +
      // authenticated without starting a billable sandbox run.
      expect(row!.status).toBe('HEALTHY');
      expect(row!.lastCheck).toBeTruthy();
    } finally {
      disableRuntime();
    }
  });

  // LIVE CONTRACT CORRECTION (2026-09-14). The first live run against
  // generativelanguage.googleapis.com returned a `completed` interaction
  // whose top-level keys were agent, agent_config, environment,
  // environment_id, id, object, status, steps, tools, usage — no
  // `output_text` at all, despite the published docs describing it. Reading
  // only `output_text` made every successful live run look like it returned
  // nothing. These assertions pin the real shape so the fix cannot regress.
  it('extracts the final text from a model_output step, which is where the LIVE API actually puts it', () => {
    const livePayload = {
      status: 'completed',
      steps: [
        { type: 'function_call', name: 'write_file', arguments: { content: 'SECRET_FILE_BODY' } },
        { type: 'function_result', name: 'write_file', result: [{ type: 'text', text: '{"success":true}' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'The file contains: SynthOS Antigravity live verification' }] },
      ],
    };
    expect(antigravity.extractAntigravityText(livePayload)).toBe('The file contains: SynthOS Antigravity live verification');
  });

  it('prefers output_text when a payload does carry it, so a reinstated field keeps working', () => {
    expect(antigravity.extractAntigravityText({
      output_text: 'documented shape',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'steps shape' }] }],
    })).toBe('documented shape');
  });

  it('never treats a function_result as the agent output — that is raw tool payload, not an answer', () => {
    const onlyToolOutput = {
      status: 'completed',
      steps: [{ type: 'function_result', name: 'read_file', result: [{ type: 'text', text: 'raw file body that is not an answer' }] }],
    };
    expect(antigravity.extractAntigravityText(onlyToolOutput)).toBe('');
  });

  it('the ledger accepts exactly the runtimes it can really dispatch to', () => {
    expect(EXTERNAL_RUNTIMES).toEqual(['windmill', 'antigravity']);
    expect(isExternalRuntime('antigravity')).toBe(true);
    expect(isExternalRuntime('claude-code')).toBe(false);
  });
});

describe('2. GUARDIAN REMAINS AUTHORITATIVE over a runtime with its own autonomous agent loop', () => {
  beforeEach(() => enableRuntime());
  afterAll(() => disableRuntime());

  it('a catastrophic instruction is BLOCKED by the same single policy function that gates the terminal', () => {
    const verdict = guardianCheckInstruction('rm -rf / and then report back');
    expect(verdict.allowed).toBe(false);
    expect(verdict.citation).toBe('RULE-SEC-01: Permanent Root Protection');
  });

  it('a privileged instruction requiring approval is refused too — APPROVAL_REQUIRED is not permission', () => {
    const verdict = guardianCheckInstruction('sudo npm publish the package');
    expect(verdict.allowed).toBe(false);
    expect(verdict.error).toContain('APPROVAL_REQUIRED');
  });

  it('an ordinary engineering instruction passes', () => {
    expect(guardianCheckInstruction('run the unit tests and summarise failures').allowed).toBe(true);
  });

  it('a blocked instruction is never dispatched: no ledger row, and the remote runtime is never contacted at all', async () => {
    const before = listWorkspaceExternalExecutions(WS_A, 200).length;
    lastSubmit = undefined;

    await expect(submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'rm -rf / then continue' },
    })).rejects.toThrow(/Guardian refused/);

    expect(listWorkspaceExternalExecutions(WS_A, 200).length).toBe(before);
    // The decisive assertion: the remote runtime never saw it.
    expect(lastSubmit).toBeUndefined();
  });

  // Stronger than re-checking Guardian: a retry of a paid remote run is refused
  // outright — it is a new paid run and needs a new human approval.
  it('a retry is refused outright: a new paid run needs a new human approval', async () => {
    // A genuinely failed attempt, submitted while the instruction was benign
    // — Guardian allowed it, which is why a row exists at all.
    rejectSubmitWith = { status: 500, message: 'transient remote failure' };
    const { execution } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'run the unit tests and summarise failures' },
      idempotencyKey: `guardian-retry-${Date.now()}`,
    });
    expect(execution.status).toBe('FAILED');
    rejectSubmitWith = null;

    // Now the stored instruction is one Guardian refuses. This models the
    // real risk the re-check exists for: what a row is allowed to dispatch
    // is decided by policy AT DISPATCH TIME, not by the fact that some
    // earlier attempt was once permitted. A retry that trusted the prior
    // row would sail straight past this.
    getDatabase()
      .prepare('UPDATE external_executions SET input_json = ? WHERE id = ?')
      .run(JSON.stringify({ instruction: 'sudo rm -rf /var and report' }), execution.id);

    await expect(retryExternalExecution(WS_A, ACTOR, execution.id)).rejects.toThrow(/new human approval/);

    // And the refusal creates no new attempt row.
    const attempts = listWorkspaceExternalExecutions(WS_A, 200).filter((e) => e.parent_execution_id === execution.id);
    expect(attempts.length).toBe(0);
  });
});

describe('3. A REAL EXECUTION carries the SynthOS envelope and returns through the existing evidence spine', () => {
  let executionId: string;
  const idempotencyKey = `antigravity-e2e-${Date.now()}`;

  beforeAll(() => enableRuntime());
  afterAll(() => disableRuntime());

  it('submission reaches the real runtime with identity preserved, and is recorded only on real evidence of acceptance', async () => {
    const { execution, created } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      agent: 'antigravity-preview-05-2026',
      input: { instruction: 'analyse the module and report findings', tools: [{ type: 'code_execution' }] },
      idempotencyKey,
    });
    executionId = execution.id;

    expect(created).toBe(true);
    expect(execution.runtime).toBe('antigravity');
    expect(execution.status).toBe('SUBMITTED');
    // Status advanced only because the remote returned a real id.
    expect(execution.remote_job_id).toBe('interaction-1');

    // The envelope really crossed the wire.
    expect(lastSubmit?.apiKeyHeader).toBe('test-antigravity-key');
    expect(lastSubmit?.agent).toBe('antigravity-preview-05-2026');
    expect(lastSubmit?.input).toBe('analyse the module and report findings');
    expect(lastSubmit?.background).toBe(true);
    expect(lastSubmit?.tools).toEqual([{ type: 'code_execution' }]);

    // SynthOS-side identity is preserved on the row itself.
    expect(execution.workspace_id).toBe(WS_A);
    expect(execution.created_by_user_id).toBe(ACTOR);
    expect(execution.correlation_id).toBe(idempotencyKey);
    expect(execution.attempt_number).toBe(1);
  });

  it('the submission is idempotent — the same key never produces a second remote interaction', async () => {
    const again = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'analyse the module and report findings' },
      idempotencyKey,
    });
    expect(again.created).toBe(false);
    expect(again.execution.id).toBe(executionId);
    expect(submitCounter).toBe(1);
  });

  it('status advances only on a real remote read, and a still-running job is never ingested', async () => {
    interactions.get('interaction-1')!.status = 'in_progress';
    const running = await refreshExternalExecutionStatus(WS_A, executionId);
    expect(running.status).toBe('RUNNING');
    expect(running.result_ingested_at).toBeNull();

    await expect(ingestExternalExecutionResult(WS_A, executionId)).rejects.toThrow(/only a confirmed SUCCEEDED/);
  });

  it('a completed interaction produces a real task, artifact, Aegis review and signed receipt — verified by real signature check', async () => {
    completeInteraction('interaction-1', [
      '# Findings',
      '',
      'The module exposes three public functions and has no error handling on the parse path.',
      'Recommended change: wrap the parse call and surface a typed failure.',
      '',
      'Sources reviewed: the repository working tree only.',
    ].join('\n'));

    const succeeded = await refreshExternalExecutionStatus(WS_A, executionId);
    expect(succeeded.status).toBe('SUCCEEDED');

    const { execution, alreadyIngested } = await ingestExternalExecutionResult(WS_A, executionId);
    expect(alreadyIngested).toBe(false);
    expect(execution.result_artifact_id).toBeTruthy();

    const taskId = execution.task_id!;
    expect(taskId).toBeTruthy();

    // Artifact really written, workspace-scoped.
    const artifacts = getTaskArtifacts(taskId);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].content_hash).toBeTruthy();

    // Aegis really ran — the same deterministic verifier every other path uses.
    const reviews = getTaskQualityReviews(taskId);
    expect(reviews.length).toBe(1);
    expect(reviews[0].reviewer).toBeTruthy();

    // The Aegis decision drives everything below, and the two branches are
    // NOT interchangeable: a receipt is only legitimate when the verifier
    // actually passed the work. Asserting the decision explicitly stops
    // this test from silently becoming vacuous if Aegis ever starts
    // rejecting — which would otherwise skip every receipt assertion while
    // still reporting green.
    const receipts = getTaskReceipts(taskId);
    const aegisPassed = reviews[0].decision === 'VERIFIED';
    expect(receipts.length > 0).toBe(aegisPassed);

    if (aegisPassed) {
      expect(verifyReceipt(receipts[0])).toBe(true);
      const payload = JSON.parse(receipts[0].payload_json);
      // The receipt attests to the runtime that ACTUALLY executed.
      expect(payload.provider).toBe('antigravity');
      expect(payload.assignedAgent).toBe('antigravity');
      expect(payload.workspaceId).toBe(WS_A);
    } else {
      // No receipt means Aegis refused — and then the task must be FAILED,
      // never DONE. A remote success is never a SynthOS verification.
      expect(execution.result_receipt_id).toBeNull();
    }
  });

  it('the artifact carries real provenance — runtime, remote job, correlation id and workspace', async () => {
    const execution = getWorkspaceExternalExecution(WS_A, executionId)!;
    const artifact = getTaskArtifacts(execution.task_id!)[0];
    const fs = await import('node:fs');
    const content = fs.readFileSync(artifact.disk_path, 'utf8');

    expect(content).toContain('**Runtime**: Antigravity');
    expect(content).toContain('**Remote job**: interaction-1');
    expect(content).toContain(`**Correlation**: ${idempotencyKey}`);
    expect(content).toContain(`**Workspace**: ${WS_A}`);
    // Real remote step names are recorded as evidence of what the agent did.
    expect(content).toContain('code_execution');
    expect(content).toContain('google_search');
    // But raw tool ARGUMENTS never enter the Vault.
    expect(content).not.toContain('SECRET_ARGUMENT_PAYLOAD');
  });

  it('ingestion is idempotent — a second call re-reads, never re-writes', async () => {
    const second = await ingestExternalExecutionResult(WS_A, executionId);
    expect(second.alreadyIngested).toBe(true);
    const execution = getWorkspaceExternalExecution(WS_A, executionId)!;
    expect(getTaskArtifacts(execution.task_id!).length).toBe(1);
  });
});

describe('4. WORKSPACE ISOLATION holds for this runtime exactly as for every other', () => {
  beforeAll(() => enableRuntime());
  afterAll(() => disableRuntime());

  it('an execution created in one workspace is invisible and unreachable from another', async () => {
    const { execution } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'isolation probe' },
      idempotencyKey: `isolation-${Date.now()}`,
    });

    // Indistinguishable from an unknown id when asked from the wrong workspace.
    expect(getWorkspaceExternalExecution(WS_B, execution.id)).toBeNull();
    expect(listWorkspaceExternalExecutions(WS_B, 200).map((e) => e.id)).not.toContain(execution.id);
    expect(listWorkspaceExternalExecutions(WS_A, 200).map((e) => e.id)).toContain(execution.id);

    // And no cross-workspace operation is possible on it.
    await expect(refreshExternalExecutionStatus(WS_B, execution.id)).rejects.toThrow(/not found/i);
    await expect(ingestExternalExecutionResult(WS_B, execution.id)).rejects.toThrow(/not found/i);
  });
});

describe('5. HONEST LIMITS — nothing is faked where the runtime genuinely cannot do it', () => {
  beforeAll(() => enableRuntime());
  afterAll(() => disableRuntime());

  it('a rejected submission is recorded FAILED with the real remote error, never SUBMITTED', async () => {
    rejectSubmitWith = { status: 429, message: 'Resource exhausted.' };
    const { execution } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'a request the remote will reject' },
      idempotencyKey: `rejected-${Date.now()}`,
    });
    expect(execution.status).toBe('FAILED');
    expect(execution.error_code).toBe('SUBMISSION_FAILED');
    expect(execution.error_message_safe).toContain('Resource exhausted.');
    expect(execution.remote_job_id).toBeNull();
    rejectSubmitWith = null;
  });

  it('cancel reports NOT_IMPLEMENTED rather than marking a still-running remote interaction cancelled', async () => {
    const { execution } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'a long running analysis' },
      idempotencyKey: `cancel-${Date.now()}`,
    });
    const result = await cancelExternalExecution(WS_A, execution.id);
    expect(result.confirmed).toBe(false);
    expect(result.error).toContain('NOT_IMPLEMENTED');
    // Crucially, the status is untouched — no false "stopped".
    expect(result.execution.status).toBe('SUBMITTED');
  });

  it('a remote interaction waiting for input becomes UNKNOWN with a real reason, never a fabricated outcome', async () => {
    const { execution } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'an analysis that will pause' },
      idempotencyKey: `requires-action-${Date.now()}`,
    });
    interactions.get(execution.remote_job_id!)!.status = 'requires_action';

    const refreshed = await refreshExternalExecutionStatus(WS_A, execution.id);
    expect(refreshed.status).toBe('UNKNOWN');
    expect(refreshed.error_code).toBe('REMOTE_REQUIRES_ACTION');
    expect(refreshed.status).not.toBe('SUCCEEDED');
    expect(refreshed.status).not.toBe('RUNNING');
  });

  it('a completed interaction with no output text is refused rather than ingested as an empty artifact', async () => {
    const { execution } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: { instruction: 'an analysis that returns nothing' },
      idempotencyKey: `empty-${Date.now()}`,
    });
    const record = interactions.get(execution.remote_job_id!)!;
    record.status = 'completed';
    record.outputText = '';

    await refreshExternalExecutionStatus(WS_A, execution.id);
    await expect(ingestExternalExecutionResult(WS_A, execution.id)).rejects.toThrow(/no output text/);
  });

  it('an instruction is required — an empty one is refused before anything is recorded or dispatched', async () => {
    await expect(submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, runtime: 'antigravity',
      input: {},
    })).rejects.toThrow(/instruction/i);
  });

  it('no credential value ever appears in a ledger row or a health result', async () => {
    const health = await antigravity.health();
    expect(JSON.stringify(health)).not.toContain('test-antigravity-key');
    const rows = listWorkspaceExternalExecutions(WS_A, 200);
    expect(JSON.stringify(rows)).not.toContain('test-antigravity-key');
  });
});
