import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// AUTOMATIC PRICING CATALOG + FINAL COST-SAFETY PROOF — deterministic fixtures.
//
// Documents below are HAND-WRITTEN FIXTURES in the providers' published
// formats. Their numbers are invented for the test and are not provider
// prices. The pricing refresh runs through an injected fetcher, so nothing
// here reaches the network; the paid-call proofs use a counting local double.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-pricing-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'pricing.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { getDatabase } from '../lib/persistence';
import {
  parseOpenAiPricingMarkdown, parseOpenAiLongContextThreshold, parseGeminiPricingMarkdown, parseGeminiCell,
  parseAntigravityUnderlyingModel, ratesAt,
} from '../lib/pricing/parse';
import { refreshPricingCatalog, getCatalogPrice, priceHistory, listPricingSources, PRICING_SOURCES, type TextFetcher } from '../lib/pricing/catalog';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY, getModelPrice } from '../lib/spend/policy';
import { estimateMaxCostUsd, ANTIGRAVITY_OVERSHOOT_MARGIN } from '../lib/spend/guard';
import { ensureUsageTable, listUsageForKey, spentSince, periodStarts } from '../lib/spend/ledger';
import { generateViaOpenAI } from '../lib/fabric/model-openai';
import { resolveDefaultOpenAiModel } from '../lib/model-router';
import { getSpendStatus } from '../lib/spend/status';

// ---------------------------------------------------------------- fixtures
const openaiDoc = (terraIn = '$2.00', terraOut = '$8.00', extraRow = true) => `# Pricing

### Standard pricing data

| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fx-terra | ${terraIn} | $0.20 | $2.50 | ${terraOut} | $4.00 | $0.40 | $5.00 | $12.00 |
| fx-mini (<128K context length) | $0.50 | $0.05 | - | $1.00 | $1.00 | $0.10 | - | $2.00 |
| fx-flat | $1.00 | - | - | $3.00 | - | - | - | - |
${extraRow ? '| fx-legacy | $9.00 | - | - | $9.00 | - | - | - | - |\n' : ''}| fx-unpriced | - | - | - | - | - | - | - | - |

### Batch pricing data

| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fx-terra | $0.01 | $0.01 | - | $0.01 | - | - | - | - |

### Grouped Pricing Table data

| Model | Modality | Input | Cached input | Output / cost |
| --- | --- | --- | --- | --- |
| fx-tts | Text | $7.00 / 1M characters | - | - |
`;
const terraPage = '- 1,000,000 context window\n## Pricing\n- Prompts with >200K input tokens are priced at 2x input and 1.5x output for the full request.\n';
const geminiDoc = `## Pricing

## Gemini 9.9 Flash

*[\`fx-flash\`](https://example.invalid)*

### Standard

|   | Free Tier | Paid Tier, per 1M tokens in USD |
|---|---|---|
| Input price | Free of charge | $0.50 through December 31, 2026. $1.00 starting January 1, 2027. |
| Output price (including thinking tokens) | Free of charge | $2.00 through December 31, 2026. $4.00 starting January 1, 2027. |
| Context caching price | Free of charge | $0.05 through December 31, 2026. $0.10 starting January 1, 2027. $0.50 / 1,000,000 tokens per hour (storage price) |

### Batch

|   | Free Tier | Paid Tier, per 1M tokens in USD |
|---|---|---|
| Input price | Not available | $0.01 |
| Output price (including thinking tokens) | Not available | $0.01 |

## Fixture Pro

*[\`fx-pro\`](https://example.invalid)*

### Standard

|   | Free Tier | Paid Tier, per 1M tokens in USD |
|---|---|---|
| Input price | Not available | $2.00, prompts \\<= 200k tokens $4.00, prompts \\> 200k tokens |
| Output price (including thinking tokens) | Not available | $12.00, prompts \\<= 200k tokens $18.00, prompts \\> 200k |

## Fixture Live

*[\`fx-live\`](https://example.invalid)*

### Standard

|   | Free Tier | Paid Tier, per 1M tokens in USD |
|---|---|---|
| Input price | Free of charge | $0.75 (text) $3.00 or $0.005/min (audio) |
| Output price (including thinking tokens) | Free of charge | $4.50 (text) $12.00 or $0.018/min (audio) |

## Fixture Image

*[\`fx-image\`](https://example.invalid)*

### Standard

|   | Free Tier | Paid Tier, per 1M tokens in USD |
|---|---|---|
| Input price | Not available | priced per image, see below |
| Output price | Not available | $0.039 per image |
`;
const agDoc = 'It is built with Gemini 9.9 Flash and uses the same harness as the IDE.';

function fetcher(docs: Record<string, string | Error>): { fetchText: TextFetcher; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchText: async (url: string) => {
      calls.push(url);
      const d = docs[url];
      if (d instanceof Error) throw d;
      if (d === undefined) throw new Error(`no fixture for ${url}`);
      return d;
    },
  };
}
const standardDocs = (openai = openaiDoc()) => ({
  [PRICING_SOURCES.openai]: openai,
  [PRICING_SOURCES.openaiModelPage('fx-terra')]: terraPage,
  [PRICING_SOURCES.gemini]: geminiDoc,
  [PRICING_SOURCES.antigravity]: agDoc,
});

// ---------------------------------------------------------------- fake provider
let calls = 0;
let mode: 'ok' | 'timeout' | '401' | 'slow' = 'ok';
let server: http.Server;

beforeAll(async () => {
  getDatabase();
  ensureUsageTable();
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls += 1;
      const p = JSON.parse(body || '{}');
      if (mode === 'timeout') return;
      if (mode === '401') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); }
      const reply = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: `resp-${calls}`, model: p.model, output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } })); };
      if (mode === 'slow') return setTimeout(reply, 300);
      reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-pricing-test-key-00000000000000';
});

afterAll(async () => {
  delete process.env.OPENAI_BASE_URL; delete process.env.OPENAI_API_KEY;
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

function openPolicy(overrides: any = {}) {
  const providers: any = {};
  for (const p of Object.keys(DEFAULT_SPEND_POLICY.providers)) providers[p] = { enabled: true, dailyUsd: 100, monthlyUsd: 1000, maxConcurrent: 50 };
  const r = saveSpendPolicy({
    ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: true, providers,
    global: { dailyUsd: 100, monthlyUsd: 1000, maxConcurrent: 50 },
    workspaceDefault: { dailyUsd: 100, maxConcurrent: 50 },
    task: { maxEstimatedUsd: 10, maxInputChars: 60_000, maxOutputTokens: 1000, maxTier: 'PREMIUM' },
    approvalThresholdUsd: 10,
    ...overrides,
  }, 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
}

let seq = 0;
const call = (model = 'fx-flat', k = `pc-${Date.now()}-${seq++}`, timeoutMs = 2000) =>
  generateViaOpenAI({ apiKey: process.env.OPENAI_API_KEY!, contents: 'x'.repeat(300), candidateModels: [model], timeoutMs, spend: { callSite: 'test.pricing', idempotencyKey: k } });

beforeEach(async () => {
  calls = 0; mode = 'ok';
  getDatabase().exec('DELETE FROM provider_usage; DELETE FROM spend_alerts;');
  try { getDatabase().exec('DELETE FROM platform_settings'); } catch { /* lazily created */ }
  try { getDatabase().exec('DELETE FROM model_prices; DELETE FROM model_price_history; DELETE FROM pricing_sources;'); } catch { /* lazily created */ }
  await refreshPricingCatalog('TEST', { ...fetcher(standardDocs()), antigravityAgentId: 'fx-agent' });
});

// ======================================================================
describe('PARSERS — official document formats, strict', () => {
  it('OpenAI: short/long rates, cached price, the (<NK) threshold, per-character speech; unpriced rows skipped', () => {
    const { records, needsThreshold } = parseOpenAiPricingMarkdown(openaiDoc(), 'u');
    const by = (id: string) => records.find((r) => r.modelId === id)!;
    expect(by('fx-terra').windows[0].rates).toEqual({ input: 2, output: 8, cachedInput: 0.2 });
    expect(by('fx-terra').longContext).toMatchObject({ thresholdTokens: null });
    expect(needsThreshold).toContain('fx-terra');
    expect(by('fx-mini').longContext!.thresholdTokens).toBe(128_000);
    expect(by('fx-flat').longContext).toBeNull();
    expect(records.find((r) => r.modelId === 'fx-unpriced')).toBeUndefined();
    expect(by('fx-tts')).toMatchObject({ provider: 'openai_tts', unit: 'chars' });
    // Only the Standard table is read — the Batch price never leaks in.
    expect(records.filter((r) => r.modelId === 'fx-terra')).toHaveLength(1);
    expect(parseOpenAiLongContextThreshold(terraPage)).toBe(200_000);
  });

  it('Gemini: date windows, prompt-size tiers, the text component of a multi-modal input, max of a multi-modal output', () => {
    const { records } = parseGeminiPricingMarkdown(geminiDoc, 'u');
    const flash = records.find((r) => r.modelId === 'fx-flash')!;
    expect(ratesAt(flash.windows, '2026-09-18T00:00:00Z')).toEqual({ input: 0.5, output: 2, cachedInput: 0.05 });
    expect(ratesAt(flash.windows, '2027-03-01T00:00:00Z')).toEqual({ input: 1, output: 4, cachedInput: 0.1 });
    const pro = records.find((r) => r.modelId === 'fx-pro')!;
    expect(pro.longContext).toMatchObject({ thresholdTokens: 200_000 });
    const live = records.find((r) => r.modelId === 'fx-live')!;
    expect(live.windows[0].rates.input).toBe(0.75);   // text input
    expect(live.windows[0].rates.output).toBe(12);    // highest output — never assume the cheap case
  });

  it('a cell the parser does not understand yields NO price — never a guess', () => {
    const { records } = parseGeminiPricingMarkdown(geminiDoc, 'u');
    expect(records.find((r) => r.modelId === 'fx-image')).toBeUndefined();
    expect(parseGeminiCell('priced per image, see below')).toBeNull();
    expect(parseGeminiCell('$0.039 per image')).toBeNull();
    expect(parseGeminiCell('$99999.00')).toBeNull(); // out of sanity bounds
  });

  it('Antigravity: which Gemini model the agent is built on', () => {
    expect(parseAntigravityUnderlyingModel(agDoc)).toBe('Gemini 9.9 Flash');
  });
});

// ======================================================================
describe('REFRESH — automatic, versioned, zero inference', () => {
  it('populates the catalog from the documents; the long-context threshold comes from the model page', () => {
    expect(getCatalogPrice('openai', 'fx-terra')!.record.longContext!.thresholdTokens).toBe(200_000);
    expect(getCatalogPrice('gemini', 'fx-flash')).not.toBeNull();
    const ag = getCatalogPrice('antigravity', 'fx-agent')!;
    expect(ag.record.derivedFrom).toBe('gemini:fx-flash');
    expect(ag.record.notes.join(' ')).toMatch(/best-effort/);
    expect(listPricingSources().every((s: any) => s.last_status === 'OK')).toBe(true);
  });

  it('a price change bumps the version and is recorded; a removed model becomes UNPRICED', async () => {
    await refreshPricingCatalog('TEST', { ...fetcher(standardDocs(openaiDoc('$3.00', '$9.00', false))), antigravityAgentId: 'fx-agent' });
    expect(getCatalogPrice('openai', 'fx-terra')!.version).toBe(2);
    const changes = priceHistory('openai', 'fx-terra');
    expect(changes.map((c: any) => c.change_type)).toEqual(['CHANGED', 'ADDED']);
    expect(JSON.parse(changes[0].old_json).windows[0].rates.input).toBe(2);
    expect(JSON.parse(changes[0].new_json).windows[0].rates.input).toBe(3);
    expect(getCatalogPrice('openai', 'fx-legacy')).toBeNull();
    expect(priceHistory('openai', 'fx-legacy')[0].change_type).toBe('REMOVED_UNPRICED');
  });

  it('an identical refresh records no changes', async () => {
    const before = priceHistory().length;
    await refreshPricingCatalog('TEST', { ...fetcher(standardDocs()), antigravityAgentId: 'fx-agent' });
    expect(priceHistory().length).toBe(before);
  });

  it('a failed fetch or an unrecognisable document keeps last-known prices and records the failure', async () => {
    await refreshPricingCatalog('TEST', { ...fetcher({ ...standardDocs(), [PRICING_SOURCES.openai]: new Error('HTTP 503') }), antigravityAgentId: 'fx-agent' });
    await refreshPricingCatalog('TEST', { ...fetcher({ ...standardDocs(), [PRICING_SOURCES.gemini]: '# The page was redesigned' }), antigravityAgentId: 'fx-agent' });
    expect(getCatalogPrice('openai', 'fx-terra')).not.toBeNull();
    expect(getCatalogPrice('gemini', 'fx-flash')).not.toBeNull();
    const src = Object.fromEntries(listPricingSources().map((s: any) => [s.source_id, s]));
    expect(src.gemini.last_status).toBe('FAILED');
    expect(src.gemini.last_success_at).not.toBeNull(); // last-known success preserved
  });

  it('refresh makes zero inference calls and writes nothing to the usage ledger', async () => {
    const before = (getDatabase().prepare('SELECT COUNT(*) n FROM provider_usage').get() as any).n;
    const events = (getDatabase().prepare("SELECT COUNT(*) n FROM runtime_events WHERE event_type IN ('PROVIDER_CALL','SPEND_GUARD')").get() as any).n;
    const f = fetcher(standardDocs());
    await refreshPricingCatalog('TEST', { ...f, antigravityAgentId: 'fx-agent' });
    expect(calls).toBe(0);
    expect(f.calls.every((u) => /\/docs\//.test(u))).toBe(true);
    expect((getDatabase().prepare('SELECT COUNT(*) n FROM provider_usage').get() as any).n).toBe(before);
    expect((getDatabase().prepare("SELECT COUNT(*) n FROM runtime_events WHERE event_type IN ('PROVIDER_CALL','SPEND_GUARD')").get() as any).n).toBe(events);
  });

  it('structurally, the pricing code cannot reach a generation path', () => {
    for (const f of ['lib/pricing/catalog.ts', 'lib/pricing/parse.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src, f).not.toMatch(/from ['"][./]*fabric\/model-|from ['"][./]*spend\/guard|@google\/genai|generateContent|\/responses|guardedPaidCall|submitInteraction/);
      expect(src, f).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/);
    }
  });

  it('under test, the default fetcher cannot reach the real documentation hosts', async () => {
    delete process.env.SYNTHOS_LIVE_METADATA_TESTS;
    const report = await refreshPricingCatalog('TEST');
    for (const s of report.sources) expect(s.status).toBe('FAILED');
    expect(report.sources.map((s) => s.error).join(' ')).toMatch(/TEST_MODE_PROVIDER_METADATA_BLOCKED|unreachable under test/);
    expect(getCatalogPrice('openai', 'fx-terra')).not.toBeNull(); // last-known preserved
  });
});

// ======================================================================
describe('SPEND GUARD ON CATALOG PRICES', () => {
  it('an unpriced model is blocked: PRICE UNKNOWN — EXECUTION BLOCKED', async () => {
    openPolicy();
    const r = await call('fx-unpriced');
    expect(r.lastProviderError).toMatch(/PRICE_UNKNOWN/);
    expect(r.lastProviderError).toMatch(/PRICE UNKNOWN — EXECUTION BLOCKED/);
    expect(calls).toBe(0);
  });

  it('a stale price is blocked (PRICE_STALE), even though last-known prices are kept', async () => {
    openPolicy();
    getDatabase().prepare("UPDATE pricing_sources SET last_success_at = ? WHERE source_id = 'openai'").run(new Date(Date.now() - 100 * 3_600_000).toISOString());
    const r = await call('fx-flat');
    expect(r.lastProviderError).toMatch(/PRICE_STALE/);
    expect(calls).toBe(0);
  });

  it('a price increase above policy blocks the SELECTED model — it is not swapped for another', async () => {
    openPolicy({ task: { maxEstimatedUsd: 0.01, maxInputChars: 60_000, maxOutputTokens: 1000, maxTier: 'PREMIUM' } });
    const selectedBefore = resolveDefaultOpenAiModel();
    expect((await call('fx-flat')).output).toBe('ok');                     // $0.0031 max — fits
    await refreshPricingCatalog('TEST', { ...fetcher(standardDocs(openaiDoc().replace('| fx-flat | $1.00 | - | - | $3.00 |', '| fx-flat | $1.00 | - | - | $30.00 |'))), antigravityAgentId: 'fx-agent' });
    const r = await call('fx-flat');                                          // now $0.0301 max — does not
    expect(r.lastProviderError).toMatch(/TASK_CEILING_EXCEEDED/);
    expect(resolveDefaultOpenAiModel()).toBe(selectedBefore);
    expect(calls).toBe(1);
  });

  it('long-context rates are used for the estimate when the threshold could be crossed', () => {
    const price = getModelPrice('openai', 'fx-terra')!;
    const small = estimateMaxCostUsd({ provider: 'openai', model: 'fx-terra', callSite: 't', idempotencyKey: 'k', inputChars: 3_000, maxOutputTokens: 100 }, price, { ...DEFAULT_SPEND_POLICY });
    const huge = estimateMaxCostUsd({ provider: 'openai', model: 'fx-terra', callSite: 't', idempotencyKey: 'k', inputChars: 900_000, maxOutputTokens: 100 }, price, { ...DEFAULT_SPEND_POLICY });
    expect(small.usd).toBeCloseTo((1000 * 2 + 100 * 8) / 1e6, 9);
    expect(huge.usd).toBeCloseTo((300_000 * 4 + 100 * 12) / 1e6, 9);
  });

  it('Antigravity: the token cap sent is sized so a 20% overshoot stays inside the per-run ceiling', () => {
    const price = getModelPrice('antigravity', 'fx-agent')!;
    const policy = { ...DEFAULT_SPEND_POLICY, antigravity: { perRunCeilingUsd: 0.1, maxTotalTokens: 200_000 } };
    const est = estimateMaxCostUsd({ provider: 'antigravity', model: 'fx-agent', callSite: 't', idempotencyKey: 'k', inputChars: 100 }, price, policy);
    const maxRate = Math.max(price.inputPerMillion, price.outputPerMillion);
    expect(est.maxTotalTokens!).toBeLessThan(200_000);
    expect((est.maxTotalTokens! * maxRate * ANTIGRAVITY_OVERSHOOT_MARGIN) / 1e6).toBeLessThanOrEqual(0.1);
    expect(est.usd!).toBeLessThanOrEqual(0.1);
  });
});

// ======================================================================
describe('BUDGET RESERVATION — atomic, and never released on an ambiguous outcome', () => {
  // fx-flat: $1/M in, $3/M out. 300 chars → 100 est. input tokens; 1000 output tokens.
  const EST = (100 * 1 + 1000 * 3) / 1e6; // 0.0031

  it('SIMULTANEOUS tasks that each fit but together exceed the budget: only the permitted subset reaches the provider', async () => {
    openPolicy({ global: { dailyUsd: EST * 2.5, monthlyUsd: 1000, maxConcurrent: 50 } });
    mode = 'slow';
    const results = await Promise.all(Array.from({ length: 6 }, () => call('fx-flat')));
    const ran = results.filter((r) => r.output === 'ok').length;
    const blocked = results.filter((r) => /BUDGET_GLOBAL_DAILY/.test(r.lastProviderError || '')).length;
    expect(ran).toBe(2);
    expect(blocked).toBe(4);
    expect(calls).toBe(2);
    expect(spentSince(periodStarts().dayStart)).toBeLessThanOrEqual(EST * 2.5);
  });

  it('a timeout HOLDS its reservation: the same budget cannot be spent twice', async () => {
    openPolicy({ global: { dailyUsd: EST * 1.5, monthlyUsd: 1000, maxConcurrent: 50 } });
    mode = 'timeout';
    const k = `hold-${Date.now()}`;
    await call('fx-flat', k, 200);
    expect(listUsageForKey(k)[0].status).toBe('TIMEOUT_AFTER_DISPATCH');
    mode = 'ok';
    const r = await call('fx-flat');
    expect(r.lastProviderError).toMatch(/BUDGET_GLOBAL_DAILY/);
    expect(calls).toBe(1);
    expect(getSpendStatus().reservations.heldForReconciliationCalls).toBe(1);
  });

  it('success reconciles the reservation down to actual usage, freeing the difference', async () => {
    openPolicy();
    const k = `ok-${Date.now()}`;
    await call('fx-flat', k);
    const [row] = listUsageForKey(k);
    expect(row.estimated_cost_usd).toBeCloseTo(EST, 9);
    expect(row.actual_cost_usd).toBeCloseTo((100 * 1 + 10 * 3) / 1e6, 9);
    expect(spentSince(periodStarts().dayStart)).toBeCloseTo(row.actual_cost_usd!, 9);
  });

  it('a definite failure releases its reservation', async () => {
    openPolicy();
    mode = '401';
    const k = `rej-${Date.now()}`;
    await call('fx-flat', k);
    expect(listUsageForKey(k)[0]).toMatchObject({ status: 'PROVIDER_REJECTION', actual_cost_usd: 0 });
    expect(spentSince(periodStarts().dayStart)).toBe(0);
  });

  it('the price snapshot is kept, so a later price change never rewrites historical cost', async () => {
    openPolicy();
    const k = `snap-${Date.now()}`;
    await call('fx-flat', k);
    const before = listUsageForKey(k)[0];
    await refreshPricingCatalog('TEST', { ...fetcher(standardDocs(openaiDoc().replace('| fx-flat | $1.00 | - | - | $3.00 |', '| fx-flat | $5.00 | - | - | $15.00 |'))), antigravityAgentId: 'fx-agent' });
    const after = listUsageForKey(k)[0];
    expect(after.actual_cost_usd).toBe(before.actual_cost_usd);
    expect(JSON.parse(after.price_snapshot_json!)).toMatchObject({ input: 1, output: 3 });
    expect(after.price_version).toMatch(/^openai:fx-flat#v1:/);
    expect(getCatalogPrice('openai', 'fx-flat')!.version).toBe(2);
  });

  it('no silent fallback: the same execution may not switch to another model', async () => {
    openPolicy();
    mode = '401';
    const k = `fb-${Date.now()}`;
    await call('fx-flat', k);
    mode = 'ok';
    expect((await call('fx-terra', k)).lastProviderError).toMatch(/FALLBACK_REFUSED/);
    expect(calls).toBe(1);
  });
});

describe('ADMIN VISIBILITY', () => {
  it('shows each source\'s freshness and every selected model\'s price state and eligibility', () => {
    const s = getSpendStatus();
    expect(s.pricing.sources.map((x: any) => x.sourceId).sort()).toEqual(['antigravity', 'gemini', 'openai']);
    const openaiDefault = s.pricing.selectedModels.find((m: any) => m.role === 'OpenAI default')!;
    // The routed default is a real model id, which these fixtures do not price.
    expect(openaiDefault.priceState).toBe('PRICE_UNKNOWN');
    expect(openaiDefault.eligibility).toMatch(/PAID_EXECUTION_DISABLED|PRICE_UNKNOWN/);
  });
});
