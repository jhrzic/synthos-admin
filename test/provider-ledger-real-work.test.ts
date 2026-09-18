import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-provledger-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'pl.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
isolateVaultForTest('provider-ledger');

import { ensureWorkspace } from '../lib/workspaces';
import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import { resolveProviderState } from '../lib/provider-state';
import { listRecentRuntimeEvents } from '../lib/runtime-events';
import { getDatabase } from '../lib/persistence';
import { allowPaidExecutionForTest } from './helpers/spend';

// ---------------------------------------------------------------------------
// PROVIDER LEDGER TRUTH — regression tests for a real gap.
//
// THE DEFECT, found while proving OpenAI live and not by inspection:
// lib/fabric/kernel.ts recorded PROVIDER_COMPLETED into a task's activity
// evidence but never wrote a PROVIDER_CALL row. lib/provider-state.ts derives
// provider truth from PROVIDER_CALL, so it only ever learned about the
// verification probe in lib/model-credentials.ts.
//
// Real work therefore did not advance lastVerifiedAt. Not a false claim — an
// omission that decayed toward under-reporting, which is its own kind of
// dishonesty: an operator watching a provider they had been using all week
// would see a verification date going stale and conclude it had stopped
// working.
//
// These tests run the REAL kernel against a REAL local provider double, so
// they exercise the actual call site rather than asserting on source text.
// ---------------------------------------------------------------------------

const WS = 'ws-provider-ledger';

let doubleServer: http.Server;
let BEHAVIOUR: 'ok' | 'error' | 'empty' = 'ok';
let requestsReceived = 0;

beforeAll(async () => {
  // Explicit opt-in: this file exercises SUCCESSFUL paid calls against a local double.
  allowPaidExecutionForTest([['openai', 'gpt-5.6-terra'], ['openai', 'gpt-5.6-luna'], ['openai', 'gpt-5.6-sol'], ['openai', 'gpt-6-astra'], ['openai', 'gpt-4o'], ['gemini', 'gemini-3.6-flash'], ['gemini', 'gemini-3.1-flash-lite']]);
  doubleServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requestsReceived += 1;
      const send = (code: number, payload: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (BEHAVIOUR === 'error') {
        return send(429, { error: { message: 'You have no credits remaining.', type: 'insufficient_quota' } });
      }
      if (BEHAVIOUR === 'empty') {
        return send(200, { model: 'gpt-5.6-terra', output: [], usage: { total_tokens: 0 } });
      }
      return send(200, {
        model: 'gpt-5.6-terra',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Bounded verification output from the provider double.' }] }],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      });
    });
  });
  await new Promise<void>((r) => doubleServer.listen(0, '127.0.0.1', () => r()));
  const port = (doubleServer.address() as any).port;
  // Same override convention the OpenAI adapter already supports for tests.
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-proj-provider-ledger-test-key-000000000000';

  ensureWorkspace(WS, 'Provider Ledger');
});

afterAll(async () => {
  await new Promise<void>((r) => doubleServer.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => { BEHAVIOUR = 'ok'; requestsReceived = 0; });

function providerCallRows(provider: string) {
  return listRecentRuntimeEvents({ targetType: 'provider', limit: 500 })
    .filter((e) => e.event_type === 'PROVIDER_CALL' && e.target_id === provider);
}

async function runKernelTask(taskId: string, model = 'gpt-5.6-terra') {
  const ctx = createExecutionContext({ workspaceId: WS });
  return executeAgentTask({
    taskId,
    taskTitle: `Provider ledger regression ${taskId}`,
    description: 'Bounded internal verification run against a local provider double.',
    assignedAgent: 'scribe',
    assignedModel: model,
    inputs: 'Reply briefly.',
  }, WS, ctx);
}

describe('real work advances provider truth', () => {
  it('a successful kernel run writes exactly ONE PROVIDER_CALL row', async () => {
    const before = providerCallRows('openai').length;
    const res = await runKernelTask(`task-pl-ok-${Date.now()}`);
    expect(res.status).toBe(200);

    const rows = providerCallRows('openai');
    // Exactly one per real call — not one per candidate model, not one per
    // retry, and not zero.
    expect(rows.length).toBe(before + 1);
    expect(rows[0].status).toBe('SUCCESS');
    const d = JSON.parse(rows[0].detail_json || '{}');
    expect(d.modelUsed).toBe('gpt-5.6-terra');
    expect(d.ok).toBe(true);
    expect(typeof rows[0].latency_ms === 'number' || rows[0].latency_ms === null).toBe(true);
    // And only one HTTP request actually left the process.
    expect(requestsReceived).toBe(1);
  });

  it('lastVerifiedAt advances because of the WORK, with no verification probe involved', async () => {
    const stateBefore = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    const beforeVerified = stateBefore.lastVerifiedAt;

    await new Promise((r) => setTimeout(r, 5));
    await runKernelTask(`task-pl-advance-${Date.now()}`);

    const after = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(after.state).toBe('LIVE_VERIFIED');
    expect(after.lastVerifiedAt).toBeTruthy();
    if (beforeVerified) {
      expect(new Date(after.lastVerifiedAt!).getTime()).toBeGreaterThan(new Date(beforeVerified).getTime());
    }
    expect(after.lastModelUsed).toBe('gpt-5.6-terra');

    // The proof that this came from work: the newest row's detail carries the
    // kernel's workspace, which the credential probe never sets.
    const newest = providerCallRows('openai')[0];
    expect(newest.workspace_id).toBe(WS);
  });

  it('a provider failure records the failure CATEGORY, not just a failure', async () => {
    BEHAVIOUR = 'error';
    const res = await runKernelTask(`task-pl-quota-${Date.now()}`);
    // A quota/rate refusal is a CAPACITY condition: the task is not failed and
    // not faked — with no other qualified route it waits (202, paused), with
    // no artifact and no fabricated success.
    expect(res.status).toBe(202);
    expect((res.body as any).status).toMatch(/^PAUSED_AWAITING_/);
    expect((res.body as any).artifact).toBeUndefined();

    const rows = providerCallRows('openai');
    expect(rows[0].status).toBe('FAILED');
    const d = JSON.parse(rows[0].detail_json || '{}');
    // Quota is classified before rate-limit because OpenAI returns 429 for
    // both and they need opposite responses.
    expect(d.errorCategory).toBe('QUOTA_OR_BILLING');

    const state = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(state.state).toBe('QUOTA_BLOCKED');
    expect(state.lastErrorCategory).toBe('QUOTA_OR_BILLING');
  });

  it('an empty-but-successful provider response is recorded as a failure, not a success', async () => {
    BEHAVIOUR = 'empty';
    await runKernelTask(`task-pl-empty-${Date.now()}`);
    const rows = providerCallRows('openai');
    expect(rows[0].status).toBe('FAILED');
    // "The provider answered 200 and said nothing" is not verification.
    const state = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(state.state).not.toBe('LIVE_VERIFIED');
  });

  it('recovers to LIVE_VERIFIED when real work succeeds again', async () => {
    BEHAVIOUR = 'error';
    await runKernelTask(`task-pl-fail2-${Date.now()}`);
    expect(resolveProviderState({ provider: 'openai', implemented: true, configured: true }).state).toBe('QUOTA_BLOCKED');

    BEHAVIOUR = 'ok';
    await runKernelTask(`task-pl-recover-${Date.now()}`);
    const state = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    // The CURRENT answer is what an operator needs, so the latest real call wins.
    expect(state.state).toBe('LIVE_VERIFIED');
  });

  it('no duplicate provider event for a single call, across several runs', async () => {
    const before = providerCallRows('openai').length;
    for (let i = 0; i < 3; i += 1) {
      await runKernelTask(`task-pl-count-${Date.now()}-${i}`);
    }
    expect(providerCallRows('openai').length).toBe(before + 3);
    expect(requestsReceived).toBe(3);
  });

  it('the task-level evidence still exists alongside the provider ledger', async () => {
    const taskId = `task-pl-both-${Date.now()}`;
    await runKernelTask(taskId);
    const db = getDatabase();
    const completed: any = db.prepare(
      "SELECT COUNT(*) AS n FROM activity_events WHERE task_id = ? AND event_type = 'PROVIDER_COMPLETED'",
    ).get(taskId);
    // The fix ADDS a provider row; it does not replace task evidence.
    expect(completed.n).toBe(1);
    expect(providerCallRows('openai').length).toBeGreaterThan(0);
  });
});

describe('both providers use the same mechanism', () => {
  it('the kernel has exactly one recordProviderAttempt site, shared by both providers', () => {
    // The kernel's provider step lives in the segment runner; the kernel itself records none.
    const kernel = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/kernel.ts'), 'utf8');
    expect(kernel.match(/recordProviderAttempt\(\{/g) || []).toHaveLength(0);
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/continuity/segment-runner.ts'), 'utf8');
    const sites = src.match(/recordProviderAttempt\(\{/g) || [];
    // One site. Two would mean two spellings of the same truth, which is the
    // shape of the original bug.
    expect(sites.length).toBe(1);
    // And it derives the provider id from the router-selected route rather than hardcoding one.
    expect(src).toMatch(/recordProviderAttempt\(\{ provider: sel\.providerId,/);
    expect(src).toContain('const sel = decision.selected;');
  });

  it('the provider id matches what the credential probe writes, so one ledger serves both', () => {
    const credSrc = fs.readFileSync(path.join(process.cwd(), 'lib/model-credentials.ts'), 'utf8');
    // The probe runs through the canonical routed call, restricted to its own
    // provider; routed-call records the attempt under the registry provider id
    // (lowercase, the same id the segment runner writes).
    expect(credSrc).toMatch(/routedModelCall\(\{[\s\S]{0,240}permittedProviders: \[provider\]/);
    const routed = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/routed-call.ts'), 'utf8');
    expect(routed).toMatch(/recordProviderAttempt\(\{ provider: sel\.providerId,/);
    const rows = providerCallRows('openai');
    expect(rows.length).toBeGreaterThan(0);
    // Nothing writes 'OPENAI' uppercase into the ledger.
    expect(providerCallRows('OPENAI').length).toBe(0);
  });
});
