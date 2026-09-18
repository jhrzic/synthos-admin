import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ---------------------------------------------------------------------------
// CANONICAL SCOPED VERIFICATION — every artifact-producing path other than the
// direct task (covered by test/output-contract-lifecycle.test.ts) and graph
// nodes (test/graph-output-contracts.test.ts, which needs a spawned server).
//
// Real components throughout: external-execution ledger + Windmill client
// against a local HTTP double, the execution envelope + Hermes runner against
// a local shell-script CLI, Aegis, Ed25519 receipts, the memory index. No
// provider is contacted; the doubles count every request they receive.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-canon-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'canon.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('canonical');

import { ensureWorkspace } from '../lib/workspaces';
import { getDatabase, getTaskReceipts, verifyReceipt, getTaskArtifacts, getTaskWithHistory, getTaskQualityReviews } from '../lib/persistence';
import { createWindmillTarget } from '../lib/windmill-targets';
import { submitExternalExecution, refreshExternalExecutionStatus, ingestExternalExecutionResult } from '../lib/external-executions';
import { executeEnvelope, type ExecutionEnvelopeInput } from '../lib/fabric/envelope';
import { decideApproval } from '../lib/approvals';
import { searchWorkspaceMemory, reindexWorkspaceMemory, getArtifactRetrievalStatus } from '../lib/memory-index';
import { verifyContent, type OutputContract } from '../lib/fabric/output-contract';
import { runScopedAegis, externalRuntimeTermination, DETERMINISTIC_COMPLETION } from '../lib/fabric/scoped-verification';
import { isAntigravityEnabled } from '../lib/antigravity-client';
import { getSpendPolicy } from '../lib/spend/policy';
import {
  TaskStatusBadge, ReceiptOutcomeBadge, ScopeChips, RetrievalBadge, VerificationOutcomePanel,
  taskStatusLabel, receiptOutcomeLabel, scopeLabel, contractLabel,
} from '../src/components/verification/outcome';

const WS = 'ws-canonical-scoped';
const ACTOR = 'user-canonical-1';
const repo = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

// ---- Windmill double -------------------------------------------------------
const jobs = new Map<string, unknown>();
let windmillRequests = 0;
let nextResult: unknown = 'OK';
let server: http.Server;
let targetId: string;

beforeAll(async () => {
  getDatabase();
  ensureWorkspace(WS, 'Canonical scoped verification');
  server = http.createServer((req, res) => {
    windmillRequests++;
    const url = req.url || '';
    req.on('data', () => {});
    req.on('end', () => {
      const submit = url.match(/^\/api\/w\/[^/]+\/jobs\/run\/(p|f)\/(.+)$/);
      if (req.method === 'POST' && submit) {
        const id = crypto.randomUUID();
        jobs.set(id, nextResult);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(id);
      }
      const status = url.match(/\/jobs_u\/get\/([0-9a-f-]+)$/);
      if (req.method === 'GET' && status) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ type: 'CompletedJob', running: false, canceled: false, success: true }));
      }
      const result = url.match(/\/jobs_u\/get_completed_job_result\/([0-9a-f-]+)$/);
      if (req.method === 'GET' && result) {
        const v = jobs.get(result[1]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(typeof v === 'string' && v.startsWith('RAW:') ? v.slice(4) : JSON.stringify(v));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.WINDMILL_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.WINDMILL_TOKEN = 'canon-token';
  process.env.WINDMILL_WORKSPACE = 'canon-ws';
  targetId = createWindmillTarget({ workspaceId: WS, name: 'Canonical target', remotePath: 'f/canon/echo', kind: 'script', createdByUserId: ACTOR }).id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.HERMES_CLI_PATH; delete process.env.HERMES_LOCAL_ENABLED;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

const receiptPayloads = (taskId: string) => getTaskReceipts(taskId).map((r) => ({ ...JSON.parse(r.payload_json), verified: verifyReceipt(r) }));
const inMemory = (artifactId: string, q: string) => searchWorkspaceMemory(WS, q, 50).map((r) => r.artifact_id).includes(artifactId);

async function runWindmill(result: unknown, outputContract?: OutputContract) {
  nextResult = result;
  const { execution } = await submitExternalExecution({
    workspaceId: WS, createdByUserId: ACTOR, targetId,
    input: { prompt: 'echo', ...(outputContract ? { outputContract } : {}) },
  });
  await refreshExternalExecutionStatus(WS, execution.id);
  const ingest = await ingestExternalExecutionResult(WS, execution.id);
  const taskId = ingest.execution.task_id!;
  return { ingest, taskId, task: getTaskWithHistory(taskId).task!, artifact: getTaskArtifacts(taskId)[0] };
}

// ============================================================================
describe('shared authority — one verifier, contract-aware missing termination', () => {
  const NOT_REPORTED = { status: 'NOT_REPORTED' as const, providerStatus: null, reason: null };

  it('missing termination: NARRATIVE tolerates it; LITERAL and JSON_OBJECT are INCOMPLETE', () => {
    const narrative = verifyContent({ integrityDecision: 'VERIFIED', output: 'A report.', termination: NOT_REPORTED, contract: { mode: 'NARRATIVE' } });
    const literal = verifyContent({ integrityDecision: 'VERIFIED', output: 'OK', termination: NOT_REPORTED, contract: { mode: 'LITERAL', literal: 'OK' } });
    const json = verifyContent({ integrityDecision: 'VERIFIED', output: '{"a":1}', termination: NOT_REPORTED, contract: { mode: 'JSON_OBJECT', requiredKeys: ['a'] } });
    expect([narrative.taskStatus, narrative.scopes.completion]).toEqual(['DONE', 'NOT_REPORTED']);
    expect([literal.taskStatus, literal.decision]).toEqual(['INCOMPLETE', 'INCOMPLETE']);
    expect([json.taskStatus, json.decision]).toEqual(['INCOMPLETE', 'INCOMPLETE']);
    // The scope statement never claims completion it did not see.
    expect(narrative.scopeStatement).toMatch(/NOT_REPORTED|not report|unverified/i);
  });

  it('external runtime termination: a result cut at the byte ceiling is INCOMPLETE, never COMPLETE', () => {
    expect(externalRuntimeTermination({ runtime: 'windmill', ledgerStatus: 'SUCCEEDED', resultTruncated: true }))
      .toEqual({ status: 'INCOMPLETE', providerStatus: 'windmill:SUCCEEDED', reason: 'RESULT_BYTE_CEILING' });
    expect(externalRuntimeTermination({ runtime: 'antigravity', ledgerStatus: 'SUCCEEDED', resultTruncated: false }).status).toBe('COMPLETE');
    expect(DETERMINISTIC_COMPLETION).toEqual({ status: 'COMPLETE', providerStatus: 'DETERMINISTIC_LOCAL', reason: null });
  });

  it('runScopedAegis runs the integrity audit AND the content scopes — integrity-only VERIFIED is not the verdict', () => {
    const src = repo('lib/fabric/scoped-verification.ts');
    expect(src).toContain('runDeterministicAegisVerification(params.taskId, params.output)');
    expect(src).toContain('verifyContent({ integrityDecision: integrity.decision');
    // Score is zeroed for anything that is not a full VERIFIED, so an
    // integrity-only pass can never show as a 100.
    expect(src).toContain("score: content.decision === 'VERIFIED' ? integrity.score : 0");
  });
});

// ============================================================================
describe('Windmill ingestion — cannot bypass scoped verification', () => {
  it('exact LITERAL result: DONE, COMPLETED receipt with scope, result_receipt_id set, indexed', async () => {
    const { ingest, taskId, task, artifact } = await runWindmill('CANON-OK', { mode: 'LITERAL', literal: 'CANON-OK' });
    expect(task.status).toBe('DONE');
    expect(ingest.verified).toBe(true);
    expect(ingest.execution.result_receipt_id).toBeTruthy();
    const [p] = receiptPayloads(taskId);
    expect(p).toMatchObject({ outcome: 'COMPLETED', verified: true, aegisDecision: 'VERIFIED' });
    expect(p.verificationScope).toMatch(/INSTRUCTION/i);
    expect(getArtifactRetrievalStatus(artifact.artifact_id)!.status).toBe('ACTIVE');
  });

  it('wrong LITERAL result: VERIFICATION_FAILED, audit receipt on the task only, no result_receipt_id, quarantined', async () => {
    const { ingest, taskId, task, artifact } = await runWindmill('something else entirely zqxv', { mode: 'LITERAL', literal: 'CANON-OK' });
    expect(task.status).toBe('VERIFICATION_FAILED');
    // The column every consumer reads as "SynthOS verified" stays empty.
    expect(ingest.execution.result_receipt_id).toBeNull();
    expect(ingest.verified).toBe(false);
    const [p] = receiptPayloads(taskId);
    expect(p).toMatchObject({ outcome: 'VERIFICATION_FAILED', verified: true });
    expect(p.verificationScope).toBeTruthy();
    expect(getArtifactRetrievalStatus(artifact.artifact_id)).toMatchObject({ status: 'QUARANTINED' });
    expect(inMemory(artifact.artifact_id, 'zqxv')).toBe(false);
    reindexWorkspaceMemory(WS);
    expect(inMemory(artifact.artifact_id, 'zqxv')).toBe(false);
    // Review carries every scope.
    const review = getTaskQualityReviews(taskId)[0];
    expect(JSON.parse(review.evidence_json || '{}').verificationScopes).toMatchObject({ integrity: 'PASS', completion: 'PASS', instructionCompliance: 'FAIL' });
  });

  it('truncated result (past the 512 KiB ceiling), NARRATIVE: INCOMPLETE and quarantined, never DONE', async () => {
    const big = 'RAW:' + 'truncwxy '.repeat(70_000); // ~630 KB, non-JSON → stored raw and cut
    const { ingest, taskId, task, artifact } = await runWindmill(big);
    expect(task.status).toBe('INCOMPLETE');
    expect(ingest.execution.result_receipt_id).toBeNull();
    expect(receiptPayloads(taskId)[0]).toMatchObject({ outcome: 'INCOMPLETE' });
    expect(getArtifactRetrievalStatus(artifact.artifact_id)!.status).toBe('QUARANTINED');
    reindexWorkspaceMemory(WS);
    expect(inMemory(artifact.artifact_id, 'truncwxy')).toBe(false);
  });

  it('an invalid output contract is refused at submit — nothing reaches the runtime', async () => {
    const before = windmillRequests;
    await expect(submitExternalExecution({
      workspaceId: WS, createdByUserId: ACTOR, targetId,
      input: { prompt: 'x', outputContract: { mode: 'LITERAL' } },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(windmillRequests).toBe(before);
  });
});

// ============================================================================
describe('Antigravity ingestion — same path, and the runtime is OFF', () => {
  it('Antigravity is disabled and paid execution is off in this environment', () => {
    expect(isAntigravityEnabled()).toBe(false);
    expect(getSpendPolicy().paidExecutionEnabled).toBe(false);
  });

  it('there is exactly one ingestion verdict for both runtimes: scoped Aegis, no runtime-specific shortcut', () => {
    const src = repo('lib/external-executions.ts');
    const ingest = src.slice(src.indexOf('export async function ingestExternalExecutionResult'), src.indexOf('export function pollBackoffSeconds'));
    expect(ingest.match(/runScopedAegis\(/g)).toHaveLength(1);
    expect(ingest).not.toContain('runDeterministicAegisVerification(');
    expect(ingest).toContain('externalRuntimeTermination({ runtime, ledgerStatus: existing.status, resultTruncated })');
    // Indexing only inside the VERIFIED + signed-receipt branch.
    expect(ingest.indexOf('indexVaultArtifact(')).toBeGreaterThan(ingest.indexOf("updateTaskStatus(taskId, 'DONE')"));
    // The failure receipt never becomes result_receipt_id.
    expect(ingest).not.toMatch(/receiptId = commitContentFailure/);
  });
});

// ============================================================================
describe('ExecutionEnvelope tool artifacts — Hermes', () => {
  const cli = (name: string, body: string) => {
    const p = path.join(TMP, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return p;
  };

  // The real human gate: first call asks, an operator approves, second call runs.
  async function approvedHermes(prompt: string) {
    const input: ExecutionEnvelopeInput = { workspaceId: WS, actorUserId: ACTOR, capability: 'hermes.execute', action: 'hermes.execute', parameters: { prompt }, rawText: prompt, correlationId: `canon-${prompt}-${crypto.randomUUID()}` };
    const first = await executeEnvelope(input);
    expect(first.outcome).toBe('APPROVAL_REQUIRED');
    const d = decideApproval({ approvalId: first.approval!.approvalId, workspaceId: WS, decidedByUserId: 'canon-approver', decision: 'APPROVED' });
    expect(d.ok).toBe(true);
    return executeEnvelope(input);
  }

  it('complete Hermes output: DONE, COMPLETED receipt stating scope, indexed', async () => {
    process.env.HERMES_LOCAL_ENABLED = 'true';
    process.env.HERMES_CLI_PATH = cli('hermes-ok', 'echo "hermes finished answer plokq"');
    const r = await approvedHermes('summarise');
    expect(r.outcome).toBe('SUCCESS');
    expect(getTaskWithHistory(r.taskId!).task!.status).toBe('DONE');
    expect(receiptPayloads(r.taskId!)[0]).toMatchObject({ outcome: 'COMPLETED', verified: true });
    expect(inMemory(r.artifact!.id, 'plokq')).toBe(true);
  });

  it('truncated Hermes output: INCOMPLETE, audit receipt, artifact quarantined, not in memory after rebuild', async () => {
    process.env.HERMES_LOCAL_ENABLED = 'true';
    process.env.HERMES_CLI_PATH = cli('hermes-flood', `awk 'BEGIN{for(i=0;i<40000;i++)printf "floodzz   "}'`);
    const r = await approvedHermes('flood');
    expect(r.outcome).toBe('FAILED');
    expect(r.reason).toMatch(/^Aegis INCOMPLETE/);
    expect(getTaskWithHistory(r.taskId!).task!.status).toBe('INCOMPLETE');
    expect(receiptPayloads(r.taskId!)[0]).toMatchObject({ outcome: 'INCOMPLETE', verified: true });
    expect(getArtifactRetrievalStatus(r.artifact!.id)!.status).toBe('QUARANTINED');
    reindexWorkspaceMemory(WS);
    expect(inMemory(r.artifact!.id, 'floodzz')).toBe(false);
    // No knowledge candidate was projected from it.
    const kc = getDatabase().prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='knowledge_candidates'").get() as any;
    if (kc.n) expect((getDatabase().prepare('SELECT COUNT(*) AS n FROM knowledge_candidates WHERE task_id = ?').get(r.taskId) as any).n).toBe(0);
  });

  it('every envelope artifact goes through scoped Aegis; research carries its real synthesis termination', () => {
    const src = repo('lib/fabric/envelope.ts');
    const commit = src.slice(src.indexOf('async function commitEvidencedArtifact'), src.indexOf('async function executeSchedule'));
    expect(commit).toContain('runScopedAegis({');
    expect(commit).not.toContain('runDeterministicAegisVerification(');
    expect(commit).toContain('...receiptOutcomeFields(scoped.content)');
    expect(commit.indexOf('isContentFailure(scoped.content)')).toBeLessThan(commit.indexOf('verifyTaskAtGate('));
    expect(src).toContain("termination: result.termination ?? { status: 'NOT_REPORTED', providerStatus: null, reason: null }");
  });
});

// ============================================================================
describe('other artifact paths — AEO report, conversation summary, graph aggregate', () => {
  it('AEO and conversation summaries index only AFTER a verified, signed receipt (was: before Aegis ran)', () => {
    for (const f of ['lib/aeo/service.ts', 'lib/conversation/service.ts']) {
      const src = repo(f);
      expect(src, f).toContain('runScopedAegis({');
      expect(src, f).not.toContain('runDeterministicAegisVerification(');
      expect(src, f).toContain('...receiptOutcomeFields(scoped.content)');
      const idx = src.indexOf('indexVaultArtifact(workspaceId, artifact.artifact_id)');
      expect(idx, f).toBeGreaterThan(src.indexOf('recordReceipt('));
    }
  });

  it('the graph aggregate states outcome + scope and a refused aggregate is a FAILED run, not COMPLETED', () => {
    const src = repo('server.ts');
    const route = src.slice(src.indexOf('app.post("/api/graphs/execute"'), src.indexOf('app.get("/api/execution/tasks/:taskId"'));
    expect(route).not.toContain('runDeterministicAegisVerification(');
    expect(route).toContain('...receiptOutcomeFields(scopedAggregate.content)');
    expect(route).toContain('const finalStatus = aggregateVerified ? "COMPLETED" : "FAILED"');
  });
});

// ============================================================================
describe('receipt outcome and scope — a signature is not a success', () => {
  it('COMPLETED and failure receipts both verify, and differ only in what they attest', async () => {
    const ok = await runWindmill('R-OK', { mode: 'LITERAL', literal: 'R-OK' });
    const bad = await runWindmill('R-NO', { mode: 'LITERAL', literal: 'R-OK' });
    const a = receiptPayloads(ok.taskId)[0];
    const b = receiptPayloads(bad.taskId)[0];
    expect(a.verified && b.verified).toBe(true);
    expect(a.outcome).toBe('COMPLETED');
    expect(b.outcome).toBe('VERIFICATION_FAILED');
    expect(typeof a.verificationScope).toBe('string');
    expect(typeof b.verificationScope).toBe('string');
    expect(a.verificationScope).not.toEqual(b.verificationScope);
  });
});

// ============================================================================
describe('UI — status and label rendering', () => {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);

  it('INCOMPLETE and VERIFICATION_FAILED render as their own states, never as DONE or plain FAILED', () => {
    expect(html(React.createElement(TaskStatusBadge, { status: 'INCOMPLETE' }))).toContain('INCOMPLETE');
    expect(html(React.createElement(TaskStatusBadge, { status: 'VERIFICATION_FAILED' }))).toContain('VERIFICATION FAILED');
    expect(taskStatusLabel('INCOMPLETE').tone).toBe('warning');
    expect(taskStatusLabel('VERIFICATION_FAILED').tone).toBe('error');
    expect(taskStatusLabel(undefined).label).toBe('UNKNOWN');
  });

  it('a receipt without an outcome says NOT STATED — it is never shown as COMPLETED', () => {
    expect(receiptOutcomeLabel(undefined).label).toBe('OUTCOME NOT STATED');
    expect(html(React.createElement(ReceiptOutcomeBadge, { outcome: undefined }))).not.toContain('COMPLETED');
    expect(html(React.createElement(ReceiptOutcomeBadge, { outcome: 'INCOMPLETE' }))).toContain('OUTCOME: INCOMPLETE');
  });

  it('each scope renders separately; NOT_REPORTED is not PASS', () => {
    const out = html(React.createElement(ScopeChips, { scopes: { integrity: 'PASS', completion: 'NOT_REPORTED', instructionCompliance: 'FAIL' } }));
    expect(out).toContain('INTEGRITY: PASS');
    expect(out).toContain('COMPLETION: NOT REPORTED');
    expect(out).toContain('INSTRUCTION: FAIL');
    expect(scopeLabel('NOT_REPORTED').label).not.toBe('PASS');
  });

  it('quarantine state and reason, contract and receipt outcome render in the outcome panel', () => {
    const out = html(React.createElement(VerificationOutcomePanel, { outcome: {
      taskStatus: 'VERIFICATION_FAILED', scopes: { integrity: 'PASS', completion: 'PASS', instructionCompliance: 'FAIL' },
      scopeStatement: 'Integrity and completion verified; instruction compliance FAILED.',
      outputContract: { mode: 'LITERAL', literal: 'X' }, receiptOutcome: 'VERIFICATION_FAILED', receiptId: 'rcpt-1',
      retrieval: { status: 'QUARANTINED', reason: 'Aegis VERIFICATION_FAILED: wrong literal', at: null },
    } }));
    expect(out).toContain('VERIFICATION FAILED');
    expect(out).toContain('CONTRACT: LITERAL');
    expect(out).toContain('OUTCOME: VERIFICATION FAILED');
    expect(out).toContain('QUARANTINED — Aegis VERIFICATION_FAILED: wrong literal');
    expect(html(React.createElement(RetrievalBadge, { retrieval: null }))).toContain('MEMORY: UNKNOWN');
    expect(contractLabel(undefined)).toBe('UNKNOWN');
    expect(contractLabel({ mode: 'JSON_OBJECT', requiredKeys: ['a', 'b'] })).toBe('JSON_OBJECT (a, b)');
  });

  it('the existing views use the shared labels (task board, receipts, graph runs, vault, external executions)', () => {
    for (const f of ['KanbanView', 'CanonicalReceiptsView', 'GraphRunsView', 'ObsidianView', 'ExternalExecutionsView']) {
      expect(repo(`src/components/${f}.tsx`), f).toContain("from './verification/outcome'");
    }
  });
});

// ============================================================================
describe('no retry, fallback or duplicate call', () => {
  it('the task board never re-runs a task the canonical fabric already decided', () => {
    const app = repo('src/App.tsx');
    const block = app.slice(app.indexOf('const verificationOutcome = execData'), app.indexOf('if (execRes.ok && execData)'));
    expect(block).toContain('if (verificationOutcome && !execData.success)');
    expect(block).toContain('return;');
    expect(block).not.toContain('handleSendQuery(');
  });

  it('one ingest = one Windmill result read; ingesting again is a no-op read with no new request', async () => {
    const { ingest } = await runWindmill('ONCE', { mode: 'LITERAL', literal: 'ONCE' });
    const before = windmillRequests;
    const again = await ingestExternalExecutionResult(WS, ingest.execution.id);
    expect(again.alreadyIngested).toBe(true);
    expect(windmillRequests).toBe(before);
  });

  it('scoped Aegis itself is pure: it makes no network request', () => {
    const src = repo('lib/fabric/scoped-verification.ts');
    expect(src).not.toMatch(/\bfetch\(|https?:\/\//);
    const r = runScopedAegis({ taskId: 'no-such-task', output: 'x', termination: DETERMINISTIC_COMPLETION, contract: { mode: 'NARRATIVE' } });
    expect(r.content.decision).not.toBe('VERIFIED'); // no task → integrity cannot pass
  });
});
