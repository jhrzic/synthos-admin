import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// SPEND GUARD — failure injection with explicit provider-call counts.
//
// The provider is a local HTTP double at OPENAI_BASE_URL. It counts every
// request it actually receives, so "no paid call happened" is an observation,
// not an assumption. The adapter under test is the real one
// (lib/fabric/model-openai.ts) and the guard is the real one.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-spend-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'spend.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { getDatabase, createOrchestratedTask, getOrchestratorTask } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { generateViaOpenAI } from '../lib/fabric/model-openai';
import { guardedPaidCall, clearAmbiguousUsage, previewPaidCall } from '../lib/spend/guard';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY, getSpendPolicy } from '../lib/spend/policy';
import { seedFixturePrices } from './helpers/spend';
import { listUsageForKey, reconcileStaleUsage, insertUsageRow, listSpendAlerts, ensureUsageTable } from '../lib/spend/ledger';
import { PaidEndpointBlockedError, isPaidRequest, liveProviderTestsAllowed } from '../lib/spend/network-guard';
import { submitExternalExecution } from '../lib/external-executions';
import { advanceTask } from '../lib/fabric/orchestrator';
import { getSpendStatus } from '../lib/spend/status';

type Mode = 'ok' | 'ok_cached' | 'timeout' | 'disconnect' | '429' | '401' | '404' | 'slow' | '500';
let mode: Mode = 'ok';
let calls = 0;
let server: http.Server;
let base = '';

beforeAll(async () => {
  getDatabase();
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls += 1;
      const json = (s: number, p: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(p)); };
      const parsed = JSON.parse(body || '{}');
      if (mode === 'timeout') return; // never answers
      if (mode === 'disconnect') { req.socket.destroy(); return; }
      if (mode === '429') return json(429, { error: { message: 'Rate limit reached for requests' } });
      if (mode === '401') return json(401, { error: { message: 'Incorrect API key provided' } });
      if (mode === '404') return json(404, { error: { message: `The model ${parsed.model} does not exist` } });
      if (mode === '500') return json(500, { error: { message: 'server error' } });
      const reply = () => json(200, {
        id: `resp-${calls}`, model: parsed.model,
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'bounded reply' }] }],
        usage: mode === 'ok_cached'
          ? { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 50 } }
          : { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, output_tokens_details: { reasoning_tokens: 50 } },
      });
      if (mode === 'slow') return setTimeout(reply, 400);
      return reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.OPENAI_BASE_URL = `${base}/v1`;
  process.env.OPENAI_API_KEY = 'sk-spend-guard-test-key-000000000000';
  ensureWorkspace('ws-spend-a', 'Spend A');
});

afterAll(async () => {
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

const PERMISSIVE = {
  paidExecutionEnabled: true,
  global: { dailyUsd: 100, monthlyUsd: 1000, maxConcurrent: 5 },
  workspaceDefault: { dailyUsd: 100, maxConcurrent: 5 },
  task: { maxEstimatedUsd: 10, maxInputChars: 60_000, maxOutputTokens: 1024, maxTier: 'STANDARD' },
  approvalThresholdUsd: 10,
};

function policy(overrides: any = {}) {
  const providers: any = {};
  for (const p of Object.keys(DEFAULT_SPEND_POLICY.providers)) providers[p] = { enabled: true, dailyUsd: 100, monthlyUsd: 1000, maxConcurrent: 5 };
  const r = saveSpendPolicy({ ...DEFAULT_SPEND_POLICY, ...PERMISSIVE, providers, ...overrides }, 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
}

let keySeq = 0;
const key = () => `spend-test-${Date.now()}-${keySeq++}`;
const call = (k = key(), model = 'gpt-test-standard', contents = 'hello', timeoutMs = 2000) =>
  generateViaOpenAI({ apiKey: process.env.OPENAI_API_KEY!, contents, candidateModels: [model], timeoutMs, spend: { callSite: 'test.spend', workspaceId: 'ws-spend-a', idempotencyKey: k } });
const statusOf = (k: string) => listUsageForKey(k).map((r) => r.status);

beforeEach(() => {
  mode = 'ok';
  calls = 0;
  ensureUsageTable();
  getDatabase().exec('DELETE FROM provider_usage; DELETE FROM spend_alerts;');
  try { getDatabase().exec('DELETE FROM platform_settings'); } catch { /* created on first write */ }
  seedFixturePrices([
    { provider: 'openai', modelId: 'gpt-test-standard', input: 1, output: 4 },
    { provider: 'openai', modelId: 'gpt-test-other', input: 1, output: 4 },
    { provider: 'openai', modelId: 'gpt-test-premium', input: 10, output: 60 },
  ]);
});

describe('DEFAULTS — nothing is spendable until a platform admin says so', () => {
  it('paid execution is OFF by default: BLOCKED_BUDGET, zero provider calls', async () => {
    expect(getSpendPolicy().paidExecutionEnabled).toBe(false);
    const r = await call();
    expect(r.lastProviderError).toMatch(/^BLOCKED_BUDGET \(PAID_EXECUTION_DISABLED\)/);
    expect(calls).toBe(0);
  });

  it('every default limit is finite — there is no "unlimited"', () => {
    const d = DEFAULT_SPEND_POLICY;
    for (const v of [d.global.dailyUsd, d.global.monthlyUsd, d.task.maxEstimatedUsd, d.antigravity.perRunCeilingUsd, ...Object.values(d.providers).map((p) => p.dailyUsd)]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(saveSpendPolicy({ global: { dailyUsd: Infinity, monthlyUsd: 1, maxConcurrent: 1 } }, 't').ok).toBe(false);
    expect(saveSpendPolicy({ global: { dailyUsd: -1, monthlyUsd: 1, maxConcurrent: 1 } }, 't').ok).toBe(false);
  });

  it('a model the registry does not know is BLOCKED (MODEL_NOT_REGISTERED) — new models are not spendable by default', async () => {
    policy();
    const r = await call(key(), 'gpt-brand-new-model');
    expect(r.lastProviderError).toMatch(/MODEL_NOT_REGISTERED/);
    expect(calls).toBe(0);
  });
});

describe('THE NETWORK BOUNDARY', () => {
  it('a paid request outside the guard is refused before leaving the process', async () => {
    policy();
    await expect(fetch(`${base}/v1/responses`, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(PaidEndpointBlockedError);
    expect(calls).toBe(0);
  });

  it('metadata reads are not inference and pass through', async () => {
    expect(isPaidRequest(new URL('https://api.openai.com/v1/models'), 'GET')).toBe(false);
    expect(isPaidRequest(new URL('https://api.openai.com/v1/responses'), 'POST')).toBe(true);
    expect(isPaidRequest(new URL('https://generativelanguage.googleapis.com/v1beta/models/x:countTokens'), 'POST')).toBe(false);
    expect(isPaidRequest(new URL('https://generativelanguage.googleapis.com/v1beta/interactions'), 'POST')).toBe(true);
  });

  it('one permit = one paid request: a retry/fallback inside the same call is refused', async () => {
    policy();
    let second: unknown = null;
    await guardedPaidCall({ provider: 'openai', model: 'gpt-test-standard', callSite: 'test.permit', idempotencyKey: key(), inputChars: 5, maxOutputTokens: 16 }, async () => {
      // Both bodies match what was priced, so the ONLY reason the second is refused is that it is a second request.
      const body = JSON.stringify({ model: 'gpt-test-standard', input: 'hello', max_output_tokens: 16 });
      await fetch(`${base}/v1/responses`, { method: 'POST', body });
      try { await fetch(`${base}/v1/responses`, { method: 'POST', body }); } catch (e) { second = e; }
      return { ok: true };
    });
    expect((second as any)?.code).toBe('SECOND_PAID_REQUEST_REFUSED');
    expect(calls).toBe(1);
  });
});

describe('TEST SUITE IS FREE', () => {
  // Asserted WITHOUT disabling the guard: a refused request never leaves the
  // process, so this test makes no external request whatever its outcome.
  it('provider hosts are unreachable under test: metadata GETs and paid POSTs, docs pages included', async () => {
    for (const k of ['SYNTHOS_LIVE_PROVIDER_TESTS', 'SYNTHOS_LIVE_TEST_BUDGET_USD', 'SYNTHOS_LIVE_METADATA_TESTS']) delete process.env[k];
    for (const url of ['https://api.openai.com/v1/models', 'https://generativelanguage.googleapis.com/v1beta/models', 'https://platform.openai.com/docs/pricing.md', 'https://ai.google.dev/gemini-api/docs/pricing.md.txt']) {
      await expect(fetch(url)).rejects.toMatchObject({ code: 'TEST_MODE_PROVIDER_METADATA_BLOCKED' });
    }
    await expect(fetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'TEST_MODE_REAL_PROVIDER_BLOCKED' });
  });

  it('the metadata flag never opens paid inference', async () => {
    process.env.SYNTHOS_LIVE_METADATA_TESTS = 'true';
    try {
      await expect(fetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'TEST_MODE_REAL_PROVIDER_BLOCKED' });
    } finally { delete process.env.SYNTHOS_LIVE_METADATA_TESTS; }
  });

  it('the live-provider flag alone is not enough — a live-test budget is also required', () => {
    expect(liveProviderTestsAllowed({ SYNTHOS_LIVE_PROVIDER_TESTS: 'true' } as any)).toBe(false);
    expect(liveProviderTestsAllowed({ SYNTHOS_LIVE_PROVIDER_TESTS: 'true', SYNTHOS_LIVE_TEST_BUDGET_USD: '0' } as any)).toBe(false);
    expect(liveProviderTestsAllowed({ SYNTHOS_LIVE_PROVIDER_TESTS: 'true', SYNTHOS_LIVE_TEST_BUDGET_USD: '0.50' } as any)).toBe(true);
  });
});

describe('FAILURE INJECTION — outcomes, retries and call counts', () => {
  it('provider TIMEOUT → TIMEOUT_AFTER_DISPATCH; the same execution is never retried automatically', async () => {
    policy(); mode = 'timeout';
    const k = key();
    const r = await call(k, 'gpt-test-standard', 'hello', 300);
    expect(r.output).toBe('');
    expect(statusOf(k)).toEqual(['TIMEOUT_AFTER_DISPATCH']);
    mode = 'ok';
    const again = await call(k);
    expect(again.lastProviderError).toMatch(/RECONCILIATION_REQUIRED/);
    expect(calls).toBe(1);
  });

  it('after an operator clears the ambiguous row, one new attempt is allowed — and its cost still counts', async () => {
    policy(); mode = 'timeout';
    const k = key();
    await call(k, 'gpt-test-standard', 'hello', 300);
    const row = listUsageForKey(k)[0];
    expect(clearAmbiguousUsage(row.usage_id, 'checked the provider dashboard: not processed')).toBe(true);
    mode = 'ok';
    const r = await call(k);
    expect(r.output).toBe('bounded reply');
    expect(statusOf(k)).toEqual(['OPERATOR_CLEARED', 'SUCCESS']);
    expect(calls).toBe(2);
  });

  it('network disconnect after sending → UNKNOWN, never retried automatically', async () => {
    policy(); mode = 'disconnect';
    const k = key();
    await call(k);
    expect(statusOf(k)).toEqual(['UNKNOWN']);
    mode = 'ok';
    expect((await call(k)).lastProviderError).toMatch(/RECONCILIATION_REQUIRED/);
    expect(calls).toBe(1);
  });

  it('HTTP 5xx → UNKNOWN (may have been processed), never retried automatically', async () => {
    policy(); mode = '500';
    const k = key();
    await call(k);
    expect(statusOf(k)).toEqual(['UNKNOWN']);
    expect(calls).toBe(1);
  });

  it('429 → PROVIDER_REJECTION at zero cost; nothing retries it on its own', async () => {
    policy(); mode = '429';
    const k = key();
    await call(k);
    const [row] = listUsageForKey(k);
    expect(row.status).toBe('PROVIDER_REJECTION');
    expect(row.actual_cost_usd).toBe(0);
    expect(calls).toBe(1);
  });

  it('authentication failure → PROVIDER_REJECTION, one call', async () => {
    policy(); mode = '401';
    const k = key();
    const r = await call(k);
    expect(r.lastProviderError).toMatch(/401/);
    expect(statusOf(k)).toEqual(['PROVIDER_REJECTION']);
    expect(calls).toBe(1);
  });

  it('invalid model → PROVIDER_REJECTION, and switching model under the same execution is a refused fallback', async () => {
    policy(); mode = '404';
    const k = key();
    await call(k, 'gpt-test-standard');
    mode = 'ok';
    const fallback = await call(k, 'gpt-test-other');
    expect(fallback.lastProviderError).toMatch(/FALLBACK_REFUSED/);
    expect(calls).toBe(1);
  });

  it('over budget → BLOCKED before any call', async () => {
    policy({ global: { dailyUsd: 0.000001, monthlyUsd: 1000, maxConcurrent: 5 } });
    const r = await call();
    expect(r.lastProviderError).toMatch(/BUDGET_GLOBAL_DAILY/);
    expect(calls).toBe(0);
  });

  it('oversized context → BLOCKED, never silently truncated', async () => {
    policy({ task: { ...PERMISSIVE.task, maxInputChars: 100 } });
    const r = await call(key(), 'gpt-test-standard', 'x'.repeat(101));
    expect(r.lastProviderError).toMatch(/CONTEXT_TOO_LARGE/);
    expect(calls).toBe(0);
  });

  it('concurrency exhausted → the second call waits (BLOCKED), it does not fan out', async () => {
    policy({ global: { dailyUsd: 100, monthlyUsd: 1000, maxConcurrent: 1 } });
    mode = 'slow';
    const [a, b] = await Promise.all([call(), (async () => { await new Promise((r) => setTimeout(r, 50)); return call(); })()]);
    expect(a.output).toBe('bounded reply');
    expect(b.lastProviderError).toMatch(/CONCURRENCY_GLOBAL/);
    expect(calls).toBe(1);
  });

  it('a duplicate of a completed execution is refused; a concurrent duplicate is refused', async () => {
    policy();
    const k = key();
    await call(k);
    expect((await call(k)).lastProviderError).toMatch(/DUPLICATE_ALREADY_EXECUTED/);
    mode = 'slow';
    const k2 = key();
    const [x, y] = await Promise.all([call(k2), (async () => { await new Promise((r) => setTimeout(r, 50)); return call(k2); })()]);
    expect(x.output).toBe('bounded reply');
    expect(y.lastProviderError).toMatch(/DUPLICATE_IN_FLIGHT/);
    expect(calls).toBe(2);
  });

  it('service restart: a call left in flight becomes UNKNOWN and is not retried', async () => {
    policy();
    const k = key();
    insertUsageRow({
      usage_id: 'use-crashed', provider: 'openai', model: 'gpt-test-standard', call_site: 'test', idempotency_key: k, attempt: 1,
      status: 'DISPATCHED', estimated_cost_usd: 0.01, created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    expect(reconcileStaleUsage()).toBeGreaterThan(0);
    expect(statusOf(k)).toEqual(['UNKNOWN']);
    expect((await call(k)).lastProviderError).toMatch(/RECONCILIATION_REQUIRED/);
    expect(calls).toBe(0);
  });

  it('kill switch: disabling a provider blocks the very next call', async () => {
    policy();
    await call();
    const r = saveSpendPolicy({ providers: { ...getSpendPolicy().providers, openai: { ...getSpendPolicy().providers.openai, enabled: false } } }, 'admin');
    expect(r.ok).toBe(true);
    expect((await call()).lastProviderError).toMatch(/PROVIDER_DISABLED/);
    expect(calls).toBe(1);
  });

  it('a PREMIUM model is refused when the task allows at most STANDARD', async () => {
    policy();
    expect((await call(key(), 'gpt-test-premium')).lastProviderError).toMatch(/TIER_NOT_ALLOWED/);
    expect(calls).toBe(0);
  });

  it('above the expensive-call threshold a call without a human approval is refused', async () => {
    policy({ approvalThresholdUsd: 0.000001 });
    expect((await call()).lastProviderError).toMatch(/APPROVAL_REQUIRED_EXPENSIVE/);
    expect(calls).toBe(0);
  });

  it('a preview decides without recording or reserving anything', () => {
    policy();
    const before = (getDatabase().prepare('SELECT COUNT(*) n FROM provider_usage').get() as any).n;
    const p = previewPaidCall({ provider: 'openai', model: 'gpt-test-standard', callSite: 'test.preview', idempotencyKey: key(), inputChars: 10, maxOutputTokens: 16 });
    expect(p.permitted).toBe(true);
    expect((getDatabase().prepare('SELECT COUNT(*) n FROM provider_usage').get() as any).n).toBe(before);
  });
});

describe('USAGE LEDGER — real usage, estimate and actual kept apart', () => {
  it('records provider-reported tokens, the response id, and an actual cost computed from them', async () => {
    policy();
    const k = key();
    await call(k);
    const [row] = listUsageForKey(k);
    expect(row).toMatchObject({ status: 'SUCCESS', input_tokens: 1000, output_tokens: 200, reasoning_tokens: 50, total_tokens: 1200, provider_request_id: 'resp-1', actual_cost_state: 'KNOWN' });
    expect(row.actual_cost_usd).toBeCloseTo((1000 * 1 + 200 * 4) / 1e6, 9);
    expect(row.estimated_cost_usd).toBeGreaterThan(0);
    expect(row.estimated_cost_usd).not.toBe(row.actual_cost_usd);
  });

  it('cached tokens without a cached price → ACTUAL_COST_UNKNOWN, tokens still recorded', async () => {
    policy(); mode = 'ok_cached';
    const k = key();
    await call(k);
    const [row] = listUsageForKey(k);
    expect(row.cached_tokens).toBe(400);
    expect(row.actual_cost_usd).toBeNull();
    expect(row.actual_cost_state).toBe('ACTUAL_COST_UNKNOWN');
  });

  it('spend visibility splits actual from estimate-only', async () => {
    policy();
    await call();
    mode = 'ok_cached';
    await call();
    const s = getSpendStatus();
    expect(s.today.calls).toBe(2);
    expect(s.today.actualKnownUsd).toBeGreaterThan(0);
    expect(s.today.estimateOnlyUsd).toBeGreaterThan(0);
    expect(s.today.callsWithUnknownActualCost).toBe(1);
  });
});

describe('BUDGET ALERTS — 50/75/90/100, no paid inference to produce them', () => {
  it('crossing thresholds records each alert once; at 100% new calls are blocked', async () => {
    // Each call costs 0.0018 (1000 in @ $1/M + 200 out @ $4/M); the day allows 0.0036.
    policy({ global: { dailyUsd: 0.0036, monthlyUsd: 1000, maxConcurrent: 5 }, task: { ...PERMISSIVE.task, maxOutputTokens: 10 } });
    await call(); await call();
    const thresholds = listSpendAlerts(50).filter((a) => a.scope === 'global:daily').map((a) => a.threshold).sort((x, y) => x - y);
    expect(thresholds).toEqual([50, 75, 90, 100]);
    const n = calls;
    expect((await call()).lastProviderError).toMatch(/BUDGET_GLOBAL_DAILY/);
    expect(calls).toBe(n);
  });
});

describe('ORCHESTRATION — a budget refusal makes work wait, it does not fail or spend', () => {
  it('an orchestrated model task under a closed switch waits (PAUSED_AWAITING_BUDGET) with zero provider calls', async () => {
    createOrchestratedTask({ taskId: 'spend-orch-1', workspaceId: 'ws-spend-a', title: 'bounded', description: 'say hi', assignedAgent: 'scribe', assignedModel: 'gpt-test-standard' });
    const step = await advanceTask(getOrchestratorTask('spend-orch-1', 'ws-spend-a')!);
    expect(step.outcome).toBe('DEFERRED');
    // Not READY (a later tick would just refuse again) and never FAILED: the
    // scheduler's continuity sweep returns it to READY when the switch opens.
    expect(getOrchestratorTask('spend-orch-1', 'ws-spend-a')!.status).toBe('PAUSED_AWAITING_BUDGET');
    expect(calls).toBe(0);
  });
});

describe('ANTIGRAVITY — no route into the ledger submits without a consumed human approval', () => {
  it('a raw submission is refused with APPROVAL_REQUIRED before any network call', async () => {
    process.env.ANTIGRAVITY_API_KEY = 'ag-test-key-0000000000000000';
    process.env.ANTIGRAVITY_ENABLED = 'true';
    process.env.ANTIGRAVITY_BASE_URL = base;
    try {
      await expect(submitExternalExecution({
        workspaceId: 'ws-spend-a', createdByUserId: 'x', runtime: 'antigravity',
        input: { instruction: 'write a file' }, idempotencyKey: key(),
      })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
      await expect(submitExternalExecution({
        workspaceId: 'ws-spend-a', createdByUserId: 'x', runtime: 'antigravity',
        input: { instruction: 'write a file' }, idempotencyKey: key(), approvalId: 'apr-forged',
      })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
      expect(calls).toBe(0);
    } finally {
      delete process.env.ANTIGRAVITY_API_KEY; delete process.env.ANTIGRAVITY_ENABLED; delete process.env.ANTIGRAVITY_BASE_URL;
    }
  });
});
