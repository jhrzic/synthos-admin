import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-openai-kernel-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
isolateVaultForTest('openai-kernel');

import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import {
  getDatabase, getTaskReceipts, getTaskQualityReviews, getTaskArtifacts, verifyReceipt,
} from '../lib/persistence';
import { allowPaidExecutionForTest } from './helpers/spend';

// ---------------------------------------------------------------------------
// PUSH 1 — OpenAI executing through the EXISTING Execution Fabric.
//
// This is the acceptance test that matters most, because it is the one that
// proves nothing was duplicated: an OpenAI run traverses the exact same
// kernel, the same task spine, the same Vault writer, the same deterministic
// Aegis verifier and the same Ed25519 receipt signing that a Gemini run
// does. Nothing about that pipeline was reimplemented for a second provider;
// only the provider call itself branches.
//
// As in test/openai-provider.test.ts, the provider is a real local HTTP
// server implementing the real Responses API contract, reached by the real
// adapter through OPENAI_BASE_URL. No api.openai.com call is made and none
// is implied.
// ---------------------------------------------------------------------------

const WS_A = 'ws-openai-kernel-alpha';
const WS_B = 'ws-openai-kernel-beta';

let server: http.Server;
let behaviour: { status: number; body: unknown };
let seenModels: string[] = [];

function dbActivityEvents(taskId: string): any[] {
  return getDatabase()
    .prepare('SELECT event_type, agent_id, payload_json FROM activity_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(taskId) as any[];
}
function dbTaskRow(taskId: string): any {
  return getDatabase().prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
}

/** A substantial, well-formed output — the verifier is real and a stub string would fail it for real reasons. */
const REAL_OUTPUT = [
  '# Executive Summary & Core Signals',
  '',
  'The repository exposes a single execution kernel that every provider call passes through.',
  'Routing is decided once, by identity, before any credential is resolved.',
  '',
  '## Discovered Architecture / Code Specifications',
  '',
  'The kernel records a task, writes an artifact, runs a deterministic verifier, and only then signs a receipt.',
  'Provider adapters are narrow: they make one call and report what happened, and own nothing else.',
  '',
  '## Market & Developer Pain Points',
  '',
  'Most multi-agent systems commit whatever the last model produced, with no independent check.',
  'That is the gap this architecture closes by refusing to treat a provider response as evidence.',
  '',
  '## Actionable Next Steps for Dev & Scribe',
  '',
  'Record provider identity in the receipt so a signed record names the company that processed the prompt.',
  'Keep the verification gate mandatory for every provider, at every depth.',
].join('\n');

beforeAll(async () => {
  // Explicit opt-in: this file exercises SUCCESSFUL paid calls against a local double.
  allowPaidExecutionForTest([['openai', 'gpt-5.6-terra'], ['openai', 'gpt-5.6-luna'], ['openai', 'gpt-5.6-sol'], ['openai', 'gpt-6-astra'], ['openai', 'gpt-4o'], ['gemini', 'gemini-3.6-flash'], ['gemini', 'gemini-3.1-flash-lite']]);
  getDatabase();

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url || '').endsWith('/responses')) {
        try { seenModels.push(JSON.parse(body)?.model); } catch { /* recorded as undefined */ }
        res.writeHead(behaviour.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(behaviour.body));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seenModels = [];
  behaviour = {
    status: 200,
    body: {
      id: 'resp_kernel',
      model: 'gpt-5.6-terra-2026-08-01',
      output_text: REAL_OUTPUT,
      usage: { input_tokens: 210, output_tokens: 480, total_tokens: 690 },
    },
  };
});

describe('1. MISSING CREDENTIAL — the failure names the provider that was actually needed', () => {
  it('an OpenAI model with no OpenAI key is BLOCKED_MISSING_CREDENTIAL naming OPENAI_API_KEY, not GEMINI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;
    const taskId = `openai-nocred-${Date.now()}`;
    const result = await executeAgentTask(
      { taskId, taskTitle: 'Provider identity check', description: 'd', assignedAgent: 'scout', assignedModel: 'gpt-5.6-terra' },
      WS_A,
      createExecutionContext({ workspaceId: WS_A })
    );

    expect(result.status).toBe(400);
    expect(result.body.reason).toBe('BLOCKED_MISSING_CREDENTIAL');
    expect(String(result.body.error)).toContain('OPENAI_API_KEY');
    // The whole point: the operator is not sent chasing the wrong variable.
    expect(String(result.body.error)).not.toContain('GEMINI_API_KEY');
    expect(dbTaskRow(taskId).status).toBe('FAILED');
  });

  it('a Gemini model with no Gemini key still names GEMINI_API_KEY, byte-for-byte as before', async () => {
    delete process.env.GEMINI_API_KEY;
    const taskId = `gemini-nocred-${Date.now()}`;
    const result = await executeAgentTask(
      { taskId, taskTitle: 'Gemini path unchanged', description: 'd', assignedAgent: 'scout', assignedModel: 'gemini-3.6-flash' },
      WS_A,
      createExecutionContext({ workspaceId: WS_A })
    );
    expect(result.body.error).toBe('GEMINI_API_KEY environment variable is not configured on the server');
  });

  it('a genuinely unsupported provider now fails as PROVIDER_UNSUPPORTED rather than being masked by a credential check', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const taskId = `unsupported-${Date.now()}`;
    const result = await executeAgentTask(
      { taskId, taskTitle: 'Unsupported provider', description: 'd', assignedModel: 'claude' },
      WS_A,
      createExecutionContext({ workspaceId: WS_A })
    );
    // Routing is registry-driven now: an id no installed provider plugin
    // declares is not registered, and nothing is dispatched.
    expect(result.body.reason).toBe('MODEL_NOT_REGISTERED');
    expect(dbActivityEvents(taskId).map((e) => e.event_type)).toContain('PROVIDER_UNSUPPORTED');
  });
});

describe('2. A REAL OPENAI RUN traverses the same fabric a Gemini run does', () => {
  const taskId = `openai-success-${Date.now()}`;

  it('completes through task -> artifact -> Aegis -> signed receipt, with no second pipeline involved', async () => {
    process.env.OPENAI_API_KEY = 'sk-kernel-test-key';
    const ctx = createExecutionContext({ workspaceId: WS_A });
    const result = await executeAgentTask(
      { taskId, taskTitle: 'OpenAI fabric execution', description: 'Analyse the execution kernel and report findings.', assignedAgent: 'scout', assignedModel: 'gpt-5.6-terra' },
      WS_A,
      ctx
    );

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);

    // The provider really ran, on the model that was asked for.
    expect(seenModels).toContain('gpt-5.6-terra');

    // Real artifact, real review, real receipt — the same three the Gemini
    // path produces, from the same code.
    expect(getTaskArtifacts(taskId).length).toBe(1);
    const reviews = getTaskQualityReviews(taskId);
    expect(reviews.length).toBe(1);

    const receipts = getTaskReceipts(taskId);
    expect(receipts.length > 0).toBe(reviews[0].decision === 'VERIFIED');
    if (receipts.length > 0) {
      expect(verifyReceipt(receipts[0])).toBe(true);
    }
  });

  it('the receipt attests to the provider that ACTUALLY executed, and to the model the PROVIDER reported', () => {
    const receipts = getTaskReceipts(taskId);
    expect(receipts.length).toBeGreaterThan(0);
    const payload = JSON.parse(receipts[0].payload_json);

    expect(payload.provider).toBe('openai');
    expect(payload.provider).not.toBe('google-genai');
    // Not 'gpt-5.6-terra' — the provider resolved it to a dated snapshot.
    expect(payload.modelUsed).toBe('gpt-5.6-terra-2026-08-01');
    expect(payload.workspaceId).toBe(WS_A);
  });

  it('the observed invocation trace names the real provider — a run on OpenAI never claims Gemini ran', () => {
    const completed = dbActivityEvents(taskId).find((e) => e.event_type === 'PROVIDER_COMPLETED');
    const payload = JSON.parse(completed.payload_json);
    expect(payload.provider).toBe('openai');
    expect(payload.model).toBe('gpt-5.6-terra-2026-08-01');
    // Real provider-reported usage, never estimated.
    expect(payload.usage).toEqual({ input_tokens: 210, output_tokens: 480, total_tokens: 690 });
  });

  // REGRESSION: the ledger recorded OpenAI's real usage while executionMetrics
  // reported metricsStatus "NOT_AVAILABLE" — because the metric read only
  // Gemini's camelCase `totalTokenCount`/`totalTokens` and OpenAI's Responses
  // API reports snake_case `total_tokens`. The number was already there and
  // the metric denied it existed.
  it('executionMetrics carries the provider-reported token total, whichever spelling the provider used', async () => {
    const usageTaskId = `openai-usage-${Date.now()}`;
    process.env.OPENAI_API_KEY = 'sk-kernel-test-key';
    const ctx = createExecutionContext({ workspaceId: WS_A });
    const result = await executeAgentTask(
      { taskId: usageTaskId, taskTitle: 'OpenAI usage mapping', description: 'Analyse the execution kernel and report findings.', assignedAgent: 'scout', assignedModel: 'gpt-5.6-terra' },
      WS_A,
      ctx
    );

    expect(result.status).toBe(200);
    const metrics = (result.body as any).executionMetrics;
    // 690 is the double's own total_tokens — reported, not estimated.
    expect(metrics.tokensConsumed).toBe(690);
    expect(metrics.metricsStatus).toBe('LIVE_PROVIDER_METADATA');
    // Cost is still not invented from a token count.
    expect(metrics.costEstimate).toBeNull();
  });

  it('the run reaches the Vault as a real artifact on disk', () => {
    const artifact = getTaskArtifacts(taskId)[0];
    expect(fs.existsSync(artifact.disk_path)).toBe(true);
    const content = fs.readFileSync(artifact.disk_path, 'utf8');
    expect(content).toContain('gpt-5.6-terra-2026-08-01');
    expect(content).toContain('Executive Summary');
    // The credential never reaches disk.
    expect(content).not.toContain('sk-kernel-test-key');
  });
});

describe('3. INVOCATION IDENTITY and WORKSPACE SCOPE', () => {
  it('ctx.getInvocations() records model.openai for an OpenAI run', async () => {
    process.env.OPENAI_API_KEY = 'sk-kernel-test-key';
    const ctx = createExecutionContext({ workspaceId: WS_A });
    const taskId = `openai-invocation-${Date.now()}`;
    const result = await executeAgentTask(
      { taskId, taskTitle: 'Invocation identity', description: 'Analyse the execution kernel and report findings.', assignedAgent: 'scout', assignedModel: 'gpt-5.6-terra' },
      WS_A,
      ctx
    );

    const names = ctx.getInvocations().map((i) => i.name);
    expect(names).toContain('model.openai');
    expect(names).not.toContain('model.gemini');
    expect(result.body.toolCalls).toContain('model.openai');
  });

  it('a provider failure fails the task honestly — no artifact, no review, no receipt', async () => {
    process.env.OPENAI_API_KEY = 'sk-kernel-test-key';
    behaviour = { status: 401, body: { error: { message: 'Incorrect API key provided.' } } };

    const taskId = `openai-invalid-${Date.now()}`;
    const result = await executeAgentTask(
      { taskId, taskTitle: 'Invalid credential run', description: 'd', assignedAgent: 'scout', assignedModel: 'gpt-5.6-terra' },
      WS_A,
      createExecutionContext({ workspaceId: WS_A })
    );

    expect(result.status).toBe(502);
    expect(result.body.reason).toBe('MODEL_PROVIDER_UNAVAILABLE');
    expect(String(result.body.error)).toContain('401');
    expect(dbTaskRow(taskId).status).toBe('FAILED');
    expect(getTaskArtifacts(taskId)).toEqual([]);
    expect(getTaskQualityReviews(taskId)).toEqual([]);
    expect(getTaskReceipts(taskId)).toEqual([]);
  });

  it('every row an OpenAI run writes is scoped to the workspace it was executed for, and to no other', async () => {
    process.env.OPENAI_API_KEY = 'sk-kernel-test-key';
    const taskId = `openai-isolation-${Date.now()}`;
    await executeAgentTask(
      { taskId, taskTitle: 'Workspace isolation', description: 'Analyse the execution kernel and report findings.', assignedAgent: 'scout', assignedModel: 'gpt-5.6-terra' },
      WS_A,
      createExecutionContext({ workspaceId: WS_A })
    );

    expect(dbTaskRow(taskId).workspace_id).toBe(WS_A);
    const receipts = getTaskReceipts(taskId);
    if (receipts.length > 0) {
      expect(JSON.parse(receipts[0].payload_json).workspaceId).toBe(WS_A);
    }
    const inB = getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM tasks WHERE task_id = ? AND workspace_id = ?')
      .get(taskId, WS_B) as { n: number };
    expect(inB.n).toBe(0);
  });
});
