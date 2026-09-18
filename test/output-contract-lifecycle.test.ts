import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// REGRESSION — the first live OpenAI proof, reproduced deterministically.
//
// Live: task live-proof-1789708229286 asked "Reply with exactly: SynthOS live
// proof OK"; the Scribe persona turned it into a memo; the response used all
// 512 output tokens and stopped mid-sentence; Aegis (integrity only) said
// VERIFIED/100; a receipt was signed; the task went DONE; the artifact was
// indexed into the Brain.
//
// Here the provider is a local double that records the prompt it received and
// replies with a configurable text, Responses-API `status`, and usage. Every
// SynthOS component is real: orchestrator, kernel, OpenAI adapter, spend
// guard, network guard, ledger, Aegis, receipts, memory index.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-contract-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'contract.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'e'.repeat(64);

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('contract');

import { ensureWorkspace } from '../lib/workspaces';
import {
  getDatabase, createOrchestratedTask, getOrchestratorTask, getTaskReceipts, verifyReceipt, getTaskArtifacts, getTaskQualityReviews,
} from '../lib/persistence';
import { runOrchestrationTick } from '../lib/fabric/orchestrator';
import { saveSpendPolicy, DEFAULT_SPEND_POLICY } from '../lib/spend/policy';
import { ensureUsageTable, listUsageForKey } from '../lib/spend/ledger';
import { searchWorkspaceMemory, reindexWorkspaceMemory, getArtifactRetrievalStatus, quarantineArtifact } from '../lib/memory-index';
import { openAiTermination, geminiTermination, verifyContent, normalizeOutputContract } from '../lib/fabric/output-contract';
import { seedFixturePrices } from './helpers/spend';
import { refreshPricingCatalog } from '../lib/pricing/catalog';

const WS = 'ws-contract';
const MODEL = 'gpt-5.6-terra';
const LITERAL = 'SynthOS live proof OK';
const MEMO = [
  '# Live Cost Proof', '', '## 1. Executive Summary', '',
  'The task requires a deterministic output validation: the response must contain exactly the string `SynthOS live proof OK`.',
  '', '## 3. Interconnected Knowledge Mesh', '', '- [[Architecture/Agentic-OS]]', '- [[Aegis-Receipts/Verification]]',
  '', '## 4. Permanent Knowledge Base Takeaways', '', '1. Exact-output tasks are machine-verifiable response contracts.', '5. Response',
].join('\n');

// Provider double state
let requests: Array<{ model: string; input: string; maxOut: number }> = [];
let reply = { text: LITERAL, status: 'completed' as string | null, outputTokens: 5, incompleteReason: null as string | null };
let server: http.Server;

beforeAll(async () => {
  getDatabase();
  ensureUsageTable();
  ensureWorkspace(WS, 'Contract');
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = JSON.parse(body || '{}');
      requests.push({ model: p.model, input: String(p.input), maxOut: p.max_output_tokens });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `resp_${requests.length}`, model: p.model,
        ...(reply.status ? { status: reply.status } : {}),
        ...(reply.incompleteReason ? { incomplete_details: { reason: reply.incompleteReason } } : {}),
        output: [{ type: 'message', content: [{ type: 'output_text', text: reply.text }] }],
        usage: { input_tokens: 112, output_tokens: reply.outputTokens, total_tokens: 112 + reply.outputTokens, output_tokens_details: { reasoning_tokens: 0 } },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-contract-test-key-000000000000';
});

afterAll(async () => {
  delete process.env.OPENAI_BASE_URL; delete process.env.OPENAI_API_KEY;
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  requests = [];
  reply = { text: LITERAL, status: 'completed', outputTokens: 5, incompleteReason: null };
  getDatabase().exec('DELETE FROM provider_usage;');
  seedFixturePrices([{ provider: 'openai', modelId: MODEL, input: 2, output: 12, cachedInput: 0.2 }]);
  // The live-proof policy: bounded, OpenAI only, 512 output tokens.
  const off = { enabled: false, dailyUsd: 0, monthlyUsd: 0, maxConcurrent: 0 };
  const r = saveSpendPolicy({
    ...DEFAULT_SPEND_POLICY, paidExecutionEnabled: true,
    global: { dailyUsd: 5, monthlyUsd: 5, maxConcurrent: 1 },
    providers: { openai: { enabled: true, dailyUsd: 5, monthlyUsd: 5, maxConcurrent: 1 }, gemini: off, antigravity: off, openai_tts: off, elevenlabs: off, fish_audio: off },
    workspaceDefault: { dailyUsd: 5, maxConcurrent: 1 },
    task: { maxEstimatedUsd: 0.01, maxInputChars: 2_000, maxOutputTokens: 512, maxTier: 'STANDARD' },
  }, 'test');
  if (!r.ok) throw new Error(r.errors.join('; '));
});

let seq = 0;
function task(parameters?: Record<string, unknown>): string {
  const taskId = `contract-${Date.now()}-${seq++}`;
  createOrchestratedTask({
    taskId, workspaceId: WS, title: 'Live cost proof', description: `Reply with exactly: ${LITERAL}`,
    assignedAgent: 'scribe', assignedModel: MODEL, ...(parameters ? { parameters } : {}),
  });
  return taskId;
}
const tick = () => runOrchestrationTick({ workspaceId: WS, maxTasks: 5 });
const status = (id: string) => getOrchestratorTask(id, WS)!.status;
const events = (id: string) => (getDatabase().prepare('SELECT event_type FROM activity_events WHERE task_id = ? ORDER BY rowid').all(id) as any[]).map((e) => e.event_type);
const history = (id: string) => (getDatabase().prepare('SELECT status FROM task_status_history WHERE task_id = ? ORDER BY rowid').all(id) as any[]).map((e) => e.status);

// ============================================================================
describe('THE LIVE PROOF, REPRODUCED — persona + output cap + integrity-only Aegis', () => {
  it('NARRATIVE task that hits the output cap ends INCOMPLETE, never DONE; evidence kept; artifact quarantined', async () => {
    reply = { text: MEMO, status: 'incomplete', outputTokens: 512, incompleteReason: 'max_output_tokens' };
    const id = task();
    const step = (await tick()).steps.find((s) => s.taskId === id)!;

    expect(step.outcome).toBe('FAILED');
    expect(status(id)).toBe('INCOMPLETE');
    expect(history(id)).not.toContain('DONE');
    expect(history(id).slice(-2)).toEqual(['AWAITING_VERIFICATION', 'INCOMPLETE']);

    // The persona still shaped this prompt — that is what NARRATIVE means.
    expect(requests[0].input).toMatch(/Scribe Knowledge Architect/);

    const [review] = getTaskQualityReviews(id);
    expect(review.decision).toBe('INCOMPLETE');
    const ev = JSON.parse(review.evidence_json);
    expect(ev.verificationScopes).toMatchObject({ integrity: 'PASS', completion: 'FAIL', instructionCompliance: 'NOT_APPLICABLE' });
    expect(ev.termination).toMatchObject({ status: 'INCOMPLETE', providerStatus: 'incomplete', reason: 'max_output_tokens' });

    // An integrity/audit receipt exists and verifies — and says INCOMPLETE.
    const receipts = getTaskReceipts(id);
    expect(receipts).toHaveLength(1);
    expect(verifyReceipt(receipts[0])).toBe(true);
    const payload = JSON.parse(receipts[0].payload_json);
    expect(payload.outcome).toBe('INCOMPLETE');
    expect(payload.aegisDecision).toBe('INCOMPLETE');
    expect(payload.verificationScope).toMatch(/integrity=PASS; completion=FAIL/);

    // Evidence preserved, retrieval blocked.
    const [art] = getTaskArtifacts(id);
    expect(fs.existsSync(art.disk_path)).toBe(true);
    expect(getArtifactRetrievalStatus(art.artifact_id)!.status).toBe('QUARANTINED');
    expect(searchWorkspaceMemory(WS, 'Exact-output tasks machine-verifiable response contracts', 20).map((r) => r.artifact_id)).not.toContain(art.artifact_id);
    reindexWorkspaceMemory(WS);
    expect(searchWorkspaceMemory(WS, 'Exact-output tasks machine-verifiable response contracts', 20).map((r) => r.artifact_id)).not.toContain(art.artifact_id);
    expect((getDatabase().prepare('SELECT COUNT(*) n FROM knowledge_candidates WHERE task_id = ?').get(id) as any).n).toBe(0);

    for (const e of ['PROVIDER_COMPLETED', 'ARTIFACT_SAVED', 'AEGIS_INCOMPLETE', 'AUDIT_RECEIPT_CREATED', 'ARTIFACT_QUARANTINED']) expect(events(id)).toContain(e);
    expect(events(id)).not.toContain('TASK_COMPLETED');

    // The billed call is recorded as billed — with the provider's own termination.
    const [row] = listUsageForKey(`orchestration:${id}`);
    expect(row.status).toBe('SUCCESS');
    expect(row.provider_termination).toMatch(/^INCOMPLETE:incomplete:max_output_tokens/);
  });

  it('a "completed" status that nevertheless used every output token is still INCOMPLETE', async () => {
    reply = { text: MEMO, status: 'completed', outputTokens: 512, incompleteReason: null };
    const id = task();
    await tick();
    expect(status(id)).toBe('INCOMPLETE');
    expect(JSON.parse(getTaskQualityReviews(id)[0].evidence_json).termination.reason).toBe('OUTPUT_CAP_REACHED');
  });

  it('no retry, no fallback, no duplicate call after an INCOMPLETE outcome', async () => {
    reply = { text: MEMO, status: 'incomplete', outputTokens: 512, incompleteReason: 'max_output_tokens' };
    const id = task();
    await tick(); await tick(); await tick();
    // CONTINUITY: a truncated NARRATIVE continues in at most `maxContinuations`
    // further segments (task-class data; 2 for this class). Each is its own
    // segment with its own ledger key — a continuation, not a retry — on the
    // SAME model (no fallback). Once INCOMPLETE, nothing is ever called again.
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.model)).toEqual([MODEL, MODEL, MODEL]);
    expect(listUsageForKey(`orchestration:${id}`)).toHaveLength(1);
    expect(listUsageForKey(`orchestration:${id}:s2`)).toHaveLength(1);
    expect(listUsageForKey(`orchestration:${id}:s3`)).toHaveLength(1);
    expect(status(id)).toBe('INCOMPLETE');
    // The continuations carried the signed checkpoint's context, not the persona again.
    expect(requests[1].input).toMatch(/You are continuing a task/);
    expect(requests[1].input).not.toMatch(/Scribe Knowledge Architect/);
  });
});

describe('LITERAL CONTRACT — the contract, not the persona, shapes the output', () => {
  it('the prompt carries the literal and NO persona brief; an exact reply is DONE with a COMPLETED receipt and stays retrievable', async () => {
    reply = { text: LITERAL, status: 'completed', outputTokens: 6, incompleteReason: null };
    const id = task({ outputContract: { mode: 'LITERAL', literal: LITERAL } });
    await tick();

    expect(requests[0].input).toContain(LITERAL);
    expect(requests[0].input).not.toMatch(/Scribe|Obsidian|wikilink|Knowledge Mesh/);
    expect(status(id)).toBe('DONE');
    const review = getTaskQualityReviews(id)[0];
    expect(review.decision).toBe('VERIFIED');
    expect(JSON.parse(review.evidence_json).verificationScopes).toMatchObject({ integrity: 'PASS', completion: 'PASS', instructionCompliance: 'PASS', required: ['INTEGRITY', 'COMPLETION', 'INSTRUCTION_COMPLIANCE'] });
    const payload = JSON.parse(getTaskReceipts(id)[0].payload_json);
    expect(payload.outcome).toBe('COMPLETED');
    expect(payload.verificationScope).toMatch(/instructionCompliance=PASS/);
    expect(getArtifactRetrievalStatus(getTaskArtifacts(id)[0].artifact_id)!.status).toBe('ACTIVE');
  });

  it('surrounding whitespace is tolerated; anything else is not', async () => {
    reply = { text: `\n  ${LITERAL}\n`, status: 'completed', outputTokens: 6, incompleteReason: null };
    const ok = task({ outputContract: { mode: 'LITERAL', literal: LITERAL } });
    await tick();
    expect(status(ok)).toBe('DONE');
  });

  it('a wrong reply fails INSTRUCTION_COMPLIANCE → VERIFICATION_FAILED, audit receipt says so, artifact quarantined', async () => {
    reply = { text: `Sure! ${LITERAL}.`, status: 'completed', outputTokens: 9, incompleteReason: null };
    const id = task({ outputContract: { mode: 'LITERAL', literal: LITERAL } });
    await tick();
    expect(status(id)).toBe('VERIFICATION_FAILED');
    const scopes = JSON.parse(getTaskQualityReviews(id)[0].evidence_json).verificationScopes;
    expect(scopes).toMatchObject({ integrity: 'PASS', completion: 'PASS', instructionCompliance: 'FAIL' });
    const receipts = getTaskReceipts(id);
    expect(verifyReceipt(receipts[0])).toBe(true);
    expect(JSON.parse(receipts[0].payload_json).outcome).toBe('VERIFICATION_FAILED');
    expect(getArtifactRetrievalStatus(getTaskArtifacts(id)[0].artifact_id)!.status).toBe('QUARANTINED');
    expect(events(id)).toContain('AEGIS_INSTRUCTION_FAILED');
  });

  it('a contract whose correctness depends on completion refuses an unreported termination', async () => {
    reply = { text: LITERAL, status: null, outputTokens: 6, incompleteReason: null };
    const id = task({ outputContract: { mode: 'LITERAL', literal: LITERAL } });
    await tick();
    expect(status(id)).toBe('INCOMPLETE');
  });

  it('an invalid contract is refused before any provider call', async () => {
    const id = task({ outputContract: { mode: 'LITERAL' } });
    const bad = task({ outputContract: 'LITERAL' as any });
    await tick();
    expect(requests).toHaveLength(0);
    expect(status(id)).toBe('FAILED');
    expect(status(bad)).toBe('FAILED');
  });
});

describe('JSON_OBJECT CONTRACT', () => {
  it('malformed JSON fails; a missing key fails; a valid object passes', async () => {
    const contract = { mode: 'JSON_OBJECT', requiredKeys: ['verdict', 'confidence'] };
    reply = { text: '```json\n{"verdict":"ok","confidence":1}\n```', status: 'completed', outputTokens: 20, incompleteReason: null };
    const fenced = task({ outputContract: contract }); await tick();
    reply = { text: '{"verdict":"ok"}', status: 'completed', outputTokens: 8, incompleteReason: null };
    const missing = task({ outputContract: contract }); await tick();
    reply = { text: '{"verdict":"ok","confidence":0.9}', status: 'completed', outputTokens: 12, incompleteReason: null };
    const good = task({ outputContract: contract }); await tick();
    expect(status(fenced)).toBe('VERIFICATION_FAILED');
    expect(status(missing)).toBe('VERIFICATION_FAILED');
    expect(status(good)).toBe('DONE');
  });
});

describe('TERMINATION PARSING — provider-reported, never inferred from text', () => {
  it('OpenAI Responses status / incomplete_details / output cap', () => {
    expect(openAiTermination({ status: 'completed', usage: { output_tokens: 10 } }, 512).status).toBe('COMPLETE');
    expect(openAiTermination({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 512)).toMatchObject({ status: 'INCOMPLETE', reason: 'max_output_tokens' });
    expect(openAiTermination({ status: 'completed', usage: { output_tokens: 512 } }, 512)).toMatchObject({ status: 'INCOMPLETE', reason: 'OUTPUT_CAP_REACHED' });
    expect(openAiTermination({}, 512).status).toBe('NOT_REPORTED');
  });
  it('Gemini finishReason', () => {
    expect(geminiTermination({ candidates: [{ finishReason: 'STOP' }] }, 512).status).toBe('COMPLETE');
    expect(geminiTermination({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 512)).toMatchObject({ status: 'INCOMPLETE', reason: 'max_output_tokens' });
    expect(geminiTermination({ candidates: [{ finishReason: 'SAFETY' }] }, 512).status).toBe('INCOMPLETE');
    expect(geminiTermination({}, 512).status).toBe('NOT_REPORTED');
  });
  it('integrity passing never, by itself, makes content VERIFIED', () => {
    const v = verifyContent({ integrityDecision: 'VERIFIED', output: MEMO, termination: { status: 'INCOMPLETE', providerStatus: 'incomplete', reason: 'max_output_tokens' }, contract: { mode: 'NARRATIVE' } });
    expect(v.decision).toBe('INCOMPLETE');
    expect(v.taskStatus).not.toBe('DONE');
    expect(normalizeOutputContract({ mode: 'NOPE' }).ok).toBe(false);
  });
});

describe('QUARANTINE — evidence kept, retrieval removed, idempotent', () => {
  it('quarantining an indexed artifact removes it from search and survives reindex; its events and receipts remain', async () => {
    reply = { text: LITERAL, status: 'completed', outputTokens: 6, incompleteReason: null };
    const id = task({ outputContract: { mode: 'LITERAL', literal: LITERAL } });
    await tick();
    const [art] = getTaskArtifacts(id);
    expect(searchWorkspaceMemory(WS, 'SynthOS live proof', 20).map((r) => r.artifact_id)).toContain(art.artifact_id);
    expect(quarantineArtifact({ workspaceId: WS, artifactId: art.artifact_id, reason: 'test', actor: 'operator' })).toEqual({ quarantined: true, alreadyQuarantined: false });
    expect(quarantineArtifact({ workspaceId: WS, artifactId: art.artifact_id, reason: 'test', actor: 'operator' })).toEqual({ quarantined: false, alreadyQuarantined: true });
    reindexWorkspaceMemory(WS);
    expect(searchWorkspaceMemory(WS, 'SynthOS live proof', 20).map((r) => r.artifact_id)).not.toContain(art.artifact_id);
    expect(getTaskReceipts(id)).toHaveLength(1);
    expect(status(id)).toBe('DONE'); // history is not rewritten by a quarantine
  });
});

describe('NO EXTERNAL OR PAID CALLS', () => {
  it('every request in this file went to the local double; the real pricing hosts are unreachable', async () => {
    delete process.env.SYNTHOS_LIVE_METADATA_TESTS;
    const report = await refreshPricingCatalog('TEST');
    expect(report.sources.every((s) => s.status === 'FAILED')).toBe(true);
  });
});
