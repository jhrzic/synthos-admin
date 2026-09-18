import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// PRE-LIVE OPENAI PROOF — the exact live-proof policy, the real canonical path.
//
// Orchestrator → kernel → OpenAI adapter → spend guard → network guard →
// provider double → usage capture → ledger → Aegis → signed receipt. Every
// SynthOS component is real. The provider is a local double that records every
// request it receives (count, model, max_output_tokens), so each claim below is
// an observation. The price fixture mirrors the shape of the live catalog entry
// for gpt-5.6-terra; it is a fixture, not a provider claim.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-prelive-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'prelive.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'd'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('prelive');

import { ensureWorkspace } from '../lib/workspaces';
import { getDatabase, createOrchestratedTask, getOrchestratorTask, updateTaskStatus, getTaskReceipts, verifyReceipt } from '../lib/persistence';
import { executeAgentTask } from '../lib/fabric/kernel';
import { createExecutionContext } from '../lib/fabric/context';
import { runOrchestrationTick } from '../lib/fabric/orchestrator';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY, getSpendPolicy, validateSpendPolicy } from '../lib/spend/policy';
import { ensureUsageTable, listUsageForKey, spentSince, periodStarts } from '../lib/spend/ledger';
import { previewPaidCall, guardedPaidCall } from '../lib/spend/guard';
import { verifyPricedRequest } from '../lib/spend/network-guard';
import { seedFixturePrices } from './helpers/spend';
import { refreshPricingCatalog } from '../lib/pricing/catalog';

const WS = 'ws-prelive';
const MODEL = 'gpt-5.6-terra';

/** The live-proof policy, exactly as it will be applied (with paidExecutionEnabled flipped on for the fixture run). */
export function liveProofPolicy(paidExecutionEnabled: boolean) {
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  return {
    ...DEFAULT_SPEND_POLICY,
    paidExecutionEnabled,
    global: { dailyUsd: 0.05, monthlyUsd: 0.05, maxConcurrent: 1 },
    providers: {
      openai: { enabled: true, dailyUsd: 0.05, monthlyUsd: 0.05, maxConcurrent: 1 },
      gemini: off, antigravity: off, openai_tts: off, elevenlabs: off, fish_audio: off,
    },
    workspaceDefault: { dailyUsd: 0.05, maxConcurrent: 1 },
    workspaceOverrides: {},
    task: { maxEstimatedUsd: 0.01, maxInputChars: 2_000, maxOutputTokens: 512, maxTier: 'STANDARD' as const },
    approvalThresholdUsd: 0.1,
    fallback: 'NO_PAID_FALLBACK' as const,
  };
}

interface Seen { model: string; maxOut: number | null; inputChars: number }
let seen: Seen[] = [];
let mode: 'ok' | 'ok_cached' | 'timeout' | '500' | '429' | '401' | '404' | 'slow' = 'ok';
let server: http.Server;

beforeAll(async () => {
  getDatabase();
  ensureUsageTable();
  ensureWorkspace(WS, 'Pre-live proof');
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = JSON.parse(body || '{}');
      seen.push({ model: p.model, maxOut: p.max_output_tokens ?? null, inputChars: String(p.input ?? '').length });
      const json = (s: number, x: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); };
      if (mode === 'timeout') return;
      if (mode === '500') return json(500, { error: { message: 'server error' } });
      if (mode === '429') return json(429, { error: { message: 'Rate limit reached' } });
      if (mode === '401') return json(401, { error: { message: 'Incorrect API key provided' } });
      if (mode === '404') return json(404, { error: { message: `The model ${p.model} does not exist` } });
      const reply = () => json(200, {
        id: `resp-${seen.length}`, model: p.model,
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'SynthOS live proof OK. The bounded model call completed and returned this short confirmation text for verification.' }] }],
        usage: mode === 'ok_cached'
          ? { input_tokens: 150, output_tokens: 40, total_tokens: 190, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 20 } }
          : { input_tokens: 150, output_tokens: 40, total_tokens: 190, output_tokens_details: { reasoning_tokens: 20 } },
      });
      if (mode === 'slow') return setTimeout(reply, 400);
      reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-prelive-test-key-00000000000000';
});

afterAll(async () => {
  delete process.env.OPENAI_BASE_URL; delete process.env.OPENAI_API_KEY;
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  seen = []; mode = 'ok';
  getDatabase().exec('DELETE FROM provider_usage; DELETE FROM spend_alerts;');
  seedFixturePrices([{ provider: 'openai', modelId: MODEL, input: 2, output: 12, cachedInput: 0.2, longContext: { thresholdTokens: 272_000, windows: [{ from: null, until: null, rates: { input: 4, output: 18, cachedInput: 0.4 } }] } }]);
  const r = saveSpendPolicy(liveProofPolicy(true), 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
});

let seq = 0;
const direct = (key?: string) => executeAgentTask({
  taskId: `prelive-${Date.now()}-${seq++}`, taskTitle: 'Live cost proof', description: 'Reply with exactly: SynthOS live proof OK',
  assignedAgent: 'scribe', assignedModel: MODEL, inputs: '', ...(key ? { spendIdempotencyKey: key } : {}),
}, WS, createExecutionContext({ workspaceId: WS }));

function orchestrated(): string {
  const taskId = `prelive-orch-${Date.now()}-${seq++}`;
  createOrchestratedTask({ taskId, workspaceId: WS, title: 'Live cost proof', description: 'Reply with exactly: SynthOS live proof OK', assignedAgent: 'scribe', assignedModel: MODEL });
  return taskId;
}
const tick = () => runOrchestrationTick({ workspaceId: WS, maxTasks: 5 });

// ============================================================================
describe('THE PROOF CONFIGURATION', () => {
  it('is a valid policy, and the real canonical request fits every cap with room', () => {
    expect(validateSpendPolicy(liveProofPolicy(false))).toEqual([]);
    const p = previewPaidCall({ provider: 'openai', model: MODEL, callSite: 'kernel.model_task', workspaceId: WS, idempotencyKey: 'preview', inputChars: 470, maxOutputTokens: 512 });
    expect(p.permitted).toBe(true);
    // 157 est. input tokens × $2/M + 512 output × $12/M
    expect(p.estimatedCostUsd).toBeCloseTo((157 * 2 + 512 * 12) / 1e6, 9);
    expect(p.estimatedCostUsd!).toBeLessThanOrEqual(0.01);
  });

  it('every non-OpenAI paid provider is switched off in the proof policy', async () => {
    const pol = getSpendPolicy();
    for (const k of ['gemini', 'antigravity', 'openai_tts', 'elevenlabs', 'fish_audio'] as const) expect(pol.providers[k].enabled).toBe(false);
  });
});

describe('THE CANONICAL PATH — one bounded call, usage reconciled, receipt signed', () => {
  it('orchestrated task → kernel → adapter → guard → provider → ledger → Aegis → receipt', async () => {
    const taskId = orchestrated();
    const r = await tick();
    expect(r.steps.find((s) => s.taskId === taskId)!.outcome).toBe('ADVANCED');
    expect(seen).toHaveLength(1);
    // The request that left the process is exactly what was priced.
    expect(seen[0]).toMatchObject({ model: MODEL, maxOut: 512 });
    expect(seen[0].inputChars).toBeLessThanOrEqual(2_000);
    const [row] = listUsageForKey(`orchestration:${taskId}`);
    expect(row).toMatchObject({ status: 'SUCCESS', provider: 'openai', model: MODEL, input_tokens: 150, output_tokens: 40, reasoning_tokens: 20, total_tokens: 190, actual_cost_state: 'KNOWN' });
    expect(row.actual_cost_usd).toBeCloseTo((150 * 2 + 40 * 12) / 1e6, 9);
    expect(row.estimated_cost_usd!).toBeLessThanOrEqual(0.01);
    expect(row.price_version).toMatch(/^registry:openai:gpt-5\.6-terra#/);
    expect(getOrchestratorTask(taskId, WS)!.status).toBe('DONE');
    const receipts = getTaskReceipts(taskId);
    expect(receipts).toHaveLength(1);
    expect(verifyReceipt(receipts[0])).toBe(true);
  });
});

describe('FAILURE BEHAVIOUR under the proof policy — provider calls counted', () => {
  it('duplicate / overlapping scheduler ticks → one call', async () => {
    orchestrated();
    await Promise.all([tick(), tick(), tick()]);
    expect(seen).toHaveLength(1);
  });

  for (const [m, status] of [['timeout', 'TIMEOUT_AFTER_DISPATCH'], ['500', 'UNKNOWN']] as const) {
    it(`${m} → ${status}; re-queueing the task never produces a second call`, async () => {
      mode = m;
      const taskId = orchestrated();
      // The kernel's own 60s timeout would slow the suite; a direct adapter-level
      // timeout is covered in spend-guard.test.ts. Here the double answers 500 /
      // hangs, and we bound the wait.
      if (m === 'timeout') {
        const k = `orchestration:${taskId}`;
        const { generateViaOpenAI } = await import('../lib/fabric/model-openai');
        await generateViaOpenAI({ apiKey: 'sk-x-000000000000000000', contents: 'x'.repeat(470), candidateModels: [MODEL], timeoutMs: 200, spend: { callSite: 'kernel.model_task', workspaceId: WS, idempotencyKey: k } });
      } else {
        await tick();
      }
      expect(listUsageForKey(`orchestration:${taskId}`)[0].status).toBe(status);
      mode = 'ok';
      updateTaskStatus(taskId, 'READY', undefined, WS); // an operator (or a bug) re-queues it
      getDatabase().prepare("DELETE FROM execution_claims WHERE idempotency_key = ?").run(`orchestration-task:${taskId}`);
      await tick();
      expect(seen).toHaveLength(1);
      // Refused before any second call: by the spend guard's per-key check
      // (the timeout case, where the ledger row came first) or by the
      // continuity controller's unreconciled-segment check — either way the
      // task is left RECONCILING_UNKNOWN_EXECUTION for an operator.
      if (m === 'timeout') expect(listUsageForKey(`orchestration:${taskId}`).map((r) => r.reason_code)).toContain('RECONCILIATION_REQUIRED');
      expect(getOrchestratorTask(taskId, WS)!.status).toBe('RECONCILING_UNKNOWN_EXECUTION');
    });
  }

  // A rate limit is a CAPACITY condition: the pinned route is rejected, it is
  // not retried, nothing is substituted, and the task waits (the scheduler's
  // continuity sweep resumes it after the route's cool-down). An auth failure
  // is a real rejection: the task fails. Neither is ever retried on its own.
  for (const [m, label, final] of [['429', 'rate limit', 'PAUSED_AWAITING_CAPACITY'], ['401', 'auth failure', 'FAILED']] as const) {
    it(`${label} → rejected once; the task ends ${final} and is never retried on its own`, async () => {
      mode = m;
      const taskId = orchestrated();
      await tick(); await tick(); await tick();
      expect(seen).toHaveLength(1);
      expect(listUsageForKey(`orchestration:${taskId}`)[0]).toMatchObject({ status: 'PROVIDER_REJECTION', actual_cost_usd: 0 });
      expect(getOrchestratorTask(taskId, WS)!.status).toBe(final);
    });
  }

  it('model error → no fallback: exactly one model is ever requested', async () => {
    mode = '404';
    await direct();
    expect(seen.map((s) => s.model)).toEqual([MODEL]);
  });

  it('a second concurrent request is refused while one is in flight (concurrency 1)', async () => {
    mode = 'slow';
    const [a, b] = await Promise.all([direct(), (async () => { await new Promise((r) => setTimeout(r, 50)); return direct(); })()]);
    expect(seen).toHaveLength(1);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect(JSON.stringify(b.body)).toMatch(/CONCURRENCY_GLOBAL/);
  });

  it('with actual = estimate, exactly the calls that fit $0.05 run, and the next is BLOCKED', async () => {
    // Worst case: each call reserves ~$0.006458 and costs that much.
    const est = (157 * 2 + 512 * 12) / 1e6;
    const fit = Math.floor(0.05 / est);
    // Pre-fill the ledger with settled worst-case calls rather than make the double lie about usage.
    const ins = getDatabase().prepare(`INSERT INTO provider_usage (usage_id, provider, model, call_site, idempotency_key, attempt, status, estimated_cost_usd, actual_cost_usd, actual_cost_state, created_at) VALUES (?, 'openai', ?, 'fill', ?, 1, 'SUCCESS', ?, ?, 'KNOWN', ?)`);
    for (let i = 0; i < fit; i++) ins.run(`fill-${i}`, MODEL, `fill-${i}`, est, est, new Date().toISOString());
    const r = await direct();
    expect(JSON.stringify(r.body)).toMatch(/BUDGET_(GLOBAL|PROVIDER|WORKSPACE)_DAILY/);
    expect(seen).toHaveLength(0);
  });
});

describe('THE REQUEST CANNOT DRIFT FROM ITS RESERVATION', () => {
  const priced = { model: MODEL, maxOutputTokens: 512, maxInputChars: 470 };
  const url = new URL('https://api.openai.com/v1/responses');
  it('a matching request passes', () => {
    expect(verifyPricedRequest(url, JSON.stringify({ model: MODEL, input: 'x'.repeat(470), max_output_tokens: 512 }), priced)).toBeNull();
  });
  it('INTEGRATED: a guarded call priced for one model that sends another is refused before it leaves the process', async () => {
    let err: any = null;
    await guardedPaidCall({ provider: 'openai', model: MODEL, callSite: 'test.drift', idempotencyKey: `drift-${Date.now()}`, inputChars: 10, maxOutputTokens: 64 }, async () => {
      try {
        await fetch(`${process.env.OPENAI_BASE_URL}/responses`, { method: 'POST', body: JSON.stringify({ model: 'gpt-6-astra', input: 'x', max_output_tokens: 64 }) });
      } catch (e) { err = e; }
      return { ok: false };
    });
    expect(err?.code).toBe('REQUEST_DIFFERS_FROM_RESERVATION');
    expect(seen).toHaveLength(0);
  });

  it('a different model, a higher output ceiling, a missing ceiling, more input, or an unreadable body are all refused', () => {
    expect(verifyPricedRequest(url, JSON.stringify({ model: 'gpt-6-astra', input: 'x', max_output_tokens: 512 }), priced)).toMatch(/model/);
    expect(verifyPricedRequest(url, JSON.stringify({ model: MODEL, input: 'x', max_output_tokens: 513 }), priced)).toMatch(/max_output_tokens/);
    expect(verifyPricedRequest(url, JSON.stringify({ model: MODEL, input: 'x' }), priced)).toMatch(/no max_output_tokens/);
    expect(verifyPricedRequest(url, JSON.stringify({ model: MODEL, input: 'x'.repeat(471), max_output_tokens: 512 }), priced)).toMatch(/471 characters/);
    expect(verifyPricedRequest(url, null, priced)).toMatch(/could not be read/);
    expect(verifyPricedRequest(new URL('https://api.openai.com/v1/something-new'), '{}', priced)).toMatch(/not one the spend guard can verify/);
  });
});

describe('RECONCILIATION — provider usage, immutable snapshot, cached-input rate', () => {
  it('cached tokens are billed at the cached-input rate from the snapshot', async () => {
    mode = 'ok_cached';
    const k = `cached-${Date.now()}`;
    await direct(k);
    const [row] = listUsageForKey(k);
    expect(row.cached_tokens).toBe(100);
    // (150 − 100) × $2 + 100 × $0.20 + 40 × $12, per million
    expect(row.actual_cost_usd).toBeCloseTo((50 * 2 + 100 * 0.2 + 40 * 12) / 1e6, 9);
  });

  it('a later price change does not touch a settled execution', async () => {
    const k = `snap-${Date.now()}`;
    await direct(k);
    const before = listUsageForKey(k)[0];
    seedFixturePrices([{ provider: 'openai', modelId: MODEL, input: 20, output: 120, cachedInput: 2 }]);
    const after = listUsageForKey(k)[0];
    expect(after.actual_cost_usd).toBe(before.actual_cost_usd);
    expect(JSON.parse(after.price_snapshot_json!)).toMatchObject({ input: 2, output: 12, cachedInput: 0.2 });
  });
});

describe('NO PAID CALLS FROM THIS FILE', () => {
  it('the only provider ever contacted is the local double; pricing refresh here is blocked from the real hosts', async () => {
    delete process.env.SYNTHOS_LIVE_METADATA_TESTS;
    const report = await refreshPricingCatalog('TEST');
    expect(report.sources.every((s) => s.status === 'FAILED')).toBe(true);
  });
});
