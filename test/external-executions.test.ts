import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'node:http';
import crypto from 'node:crypto';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-external-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;
process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';

import { createWindmillTarget } from '../lib/windmill-targets';
import {
  submitExternalExecution, getWorkspaceExternalExecution, listWorkspaceExternalExecutions,
  refreshExternalExecutionStatus, ingestExternalExecutionResult, cancelExternalExecution,
  retryExternalExecution, listAllExternalExecutions,
} from '../lib/external-executions';
import { getTaskReceipts, getTaskQualityReviews, verifyReceipt, getTaskArtifacts, getDatabase } from '../lib/persistence';
import { listRecentRuntimeEvents } from '../lib/runtime-events';
import { VAULT_ROOT } from '../lib/vault';

// ---------------------------------------------------------------------------
// ADR-006 — end-to-end orchestration tests against a real local mock
// Windmill server (real network calls, real SQLite) and the real KIL/Aegis/
// receipt pipeline this module reuses. Proves: workspace ownership never
// trusts a remote payload, idempotent submission and result ingestion,
// SUBMITTED != RUNNING != SUCCEEDED != verified, a remote SUCCEEDED job
// never automatically becomes a verified SynthOS result, cancel is only
// ever confirmed by a real remote read, and reconciliation after "restart"
// (a fresh status read) ingests exactly once.
// ---------------------------------------------------------------------------

const WS_A = 'ws-ext-exec-alpha';
const WS_B = 'ws-ext-exec-beta';
const ACTOR = 'user-ext-exec-1';

// In-memory job state the mock server serves — mutated per test to model
// QUEUED -> RUNNING -> SUCCEEDED/FAILED/CANCELLED transitions truthfully.
const jobs = new Map<string, { state: 'queued' | 'running' | 'success' | 'failure' | 'canceled'; result?: unknown }>();

let server: http.Server;
let scriptTargetId: string;
let flowTargetId: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url || '';
      if (req.method === 'GET' && url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('v1.400.0-test');
      }
      if (req.method === 'GET' && url === '/api/users/whoami') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ username: 'test-runner' }));
      }
      const submitMatch = url.match(/^\/api\/w\/[^/]+\/jobs\/run\/(p|f)\/(.+)$/);
      if (req.method === 'POST' && submitMatch) {
        const jobId = crypto.randomUUID();
        jobs.set(jobId, { state: 'queued' });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(jobId);
      }
      const statusMatch = url.match(/^\/api\/w\/[^/]+\/jobs_u\/get\/([0-9a-f-]+)$/);
      if (req.method === 'GET' && statusMatch) {
        const job = jobs.get(statusMatch[1]);
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not found' }));
        }
        const payload =
          job.state === 'queued' ? { type: 'QueuedJob', running: false, canceled: false }
          : job.state === 'running' ? { type: 'QueuedJob', running: true, canceled: false }
          : job.state === 'canceled' ? { type: 'CompletedJob', running: false, canceled: true }
          : { type: 'CompletedJob', running: false, canceled: false, success: job.state === 'success' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(payload));
      }
      const resultMatch = url.match(/^\/api\/w\/[^/]+\/jobs_u\/get_completed_job_result\/([0-9a-f-]+)$/);
      if (req.method === 'GET' && resultMatch) {
        const job = jobs.get(resultMatch[1]);
        if (!job || job.state !== 'success') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not complete' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(job.result ?? { report: 'synthetic test output', ok: true }));
      }
      const cancelMatch = url.match(/^\/api\/w\/[^/]+\/jobs_u\/cancel\/([0-9a-f-]+)$/);
      if (req.method === 'POST' && cancelMatch) {
        const job = jobs.get(cancelMatch[1]);
        if (job) job.state = 'canceled';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ canceled: true }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.env.WINDMILL_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.WINDMILL_TOKEN = 'test-token';
  process.env.WINDMILL_WORKSPACE = 'test-ws';

  scriptTargetId = createWindmillTarget({
    workspaceId: WS_A, name: 'Test report script', remotePath: 'f/test/report',
    kind: 'script', createdByUserId: ACTOR,
  }).id;
  flowTargetId = createWindmillTarget({
    workspaceId: null, name: 'Global test flow', remotePath: 'f/test/flow',
    kind: 'flow', createdByUserId: ACTOR,
  }).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  // STEP 3 — real artifacts now land under vault/workspaces/<id>/ (the
  // canonical writer), not the old flat vault/External-Executions/ folder.
  for (const ws of [WS_A, WS_B]) {
    try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', ws), { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function setJobState(jobId: string, state: 'queued' | 'running' | 'success' | 'failure' | 'canceled', result?: unknown) {
  jobs.set(jobId, { state, result });
}

describe('D1-D3: authorized submission, target resolution, correlation', () => {
  it('submission is rejected for a target not visible to the calling workspace (R3)', async () => {
    await expect(submitExternalExecution({
      workspaceId: WS_B, createdByUserId: ACTOR, targetId: scriptTargetId, input: {},
    })).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
  });

  it('a successful submission creates a local record owned by the caller workspace, never a caller-supplied one', async () => {
    const { execution, created } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: { company: 'Acme' },
    });
    expect(created).toBe(true);
    expect(execution.workspace_id).toBe(WS_A);
    expect(execution.status).toBe('SUBMITTED');
    expect(execution.remote_job_id).toBeTruthy();
    expect(execution.correlation_id).toBeTruthy();
  });

  it('the created row is only readable in its owning workspace (non-disclosure)', async () => {
    const { execution } = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {},
    });
    expect(getWorkspaceExternalExecution(WS_A, execution.id)).not.toBeNull();
    expect(getWorkspaceExternalExecution(WS_B, execution.id)).toBeNull();
  });
});

describe('Q1: idempotent submission', () => {
  it('a repeated submission with the same idempotencyKey returns the SAME row, never a second remote job', async () => {
    const key = 'idem-key-1';
    const first = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {}, idempotencyKey: key,
    });
    const second = await submitExternalExecution({
      workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {}, idempotencyKey: key,
    });
    expect(second.created).toBe(false);
    expect(second.execution.id).toBe(first.execution.id);
    expect(second.execution.remote_job_id).toBe(first.execution.remote_job_id);
  });
});

describe('status refresh: SUBMITTED != RUNNING != SUCCEEDED, UNKNOWN never fabricated', () => {
  it('a queued remote job stays SUBMITTED on refresh', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    const refreshed = await refreshExternalExecutionStatus(WS_A, execution.id);
    expect(refreshed.status).toBe('SUBMITTED');
  });

  it('a running remote job is reflected as RUNNING, not SUCCEEDED', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(execution.remote_job_id!, 'running');
    const refreshed = await refreshExternalExecutionStatus(WS_A, execution.id);
    expect(refreshed.status).toBe('RUNNING');
    expect(refreshed.started_at).toBeTruthy();
  });

  it('a failed remote job is reflected as FAILED with a real error code', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(execution.remote_job_id!, 'failure');
    const refreshed = await refreshExternalExecutionStatus(WS_A, execution.id);
    expect(refreshed.status).toBe('FAILED');
    expect(refreshed.error_code).toBe('REMOTE_JOB_FAILED');
  });

  it('a remote job that has vanished (unknown to Windmill) reports UNKNOWN, never a fabricated FAILED (P2)', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    jobs.delete(execution.remote_job_id!); // simulate a purged/never-existed remote job
    const refreshed = await refreshExternalExecutionStatus(WS_A, execution.id);
    expect(refreshed.status).toBe('UNKNOWN');
  });
});

describe('F1-F6/rule 15: remote SUCCEEDED != SynthOS verified — result ingestion, Aegis, receipt', () => {
  it('a genuinely successful job produces a real artifact and a VERIFIED, receipt-bearing outcome', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: { company: 'Acme' } });
    setJobState(submitted.remote_job_id!, 'success', { finding: 'Acme is a real synthetic test company.' });
    const refreshed = await refreshExternalExecutionStatus(WS_A, submitted.id);
    expect(refreshed.status).toBe('SUCCEEDED');

    const { execution, alreadyIngested, verified } = await ingestExternalExecutionResult(WS_A, submitted.id);
    expect(alreadyIngested).toBe(false);
    expect(verified).toBe(true);
    expect(execution.result_artifact_id).toBeTruthy();
    expect(execution.result_receipt_id).toBeTruthy();
    expect(execution.task_id).toBeTruthy();

    const receipts = getTaskReceipts(execution.task_id!);
    expect(receipts.length).toBe(1);
    expect(receipts[0].receipt_id).toBe(execution.result_receipt_id);
    expect(receipts[0].algorithm).toBe('Ed25519');
    expect(verifyReceipt(receipts[0])).toBe(true); // SynthOS signed it, not Windmill

    const reviews = getTaskQualityReviews(execution.task_id!);
    expect(reviews.some((r) => r.decision === 'VERIFIED')).toBe(true);
  });

  it('Q2: repeated ingestion of an already-ingested execution is a pure no-op read — no duplicate artifact/receipt', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(submitted.remote_job_id!, 'success');
    await refreshExternalExecutionStatus(WS_A, submitted.id);
    const first = await ingestExternalExecutionResult(WS_A, submitted.id);
    const second = await ingestExternalExecutionResult(WS_A, submitted.id);

    expect(second.alreadyIngested).toBe(true);
    expect(second.execution.result_artifact_id).toBe(first.execution.result_artifact_id);
    expect(second.execution.result_receipt_id).toBe(first.execution.result_receipt_id);

    const receipts = getTaskReceipts(first.execution.task_id!);
    expect(receipts.length).toBe(1); // never duplicated
  });

  it('ingestion is refused for a non-SUCCEEDED execution — never fabricates a result for a running/failed job', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    await expect(ingestExternalExecutionResult(WS_A, execution.id)).rejects.toMatchObject({ code: 'NOT_SUCCEEDED' });
  });
});

describe('O1-O3: cancellation only on real remote confirmation', () => {
  it('cancel confirms true only after Windmill actually reports the job canceled', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    const result = await cancelExternalExecution(WS_A, execution.id);
    expect(result.confirmed).toBe(true);
    expect(result.execution.status).toBe('CANCELLED');
  });

  it('cancel of an already-terminal execution is refused truthfully, never silently re-marked', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(submitted.remote_job_id!, 'success');
    await refreshExternalExecutionStatus(WS_A, submitted.id);
    const result = await cancelExternalExecution(WS_A, submitted.id);
    expect(result.confirmed).toBe(false);
  });
});

describe('N2-N4: retry creates a new attempt, never overwrites history; a failed attempt never receipts', () => {
  it('retry after a failure creates a brand-new execution linked to the prior one', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(submitted.remote_job_id!, 'failure');
    const failed = await refreshExternalExecutionStatus(WS_A, submitted.id);
    expect(failed.status).toBe('FAILED');

    const { execution: retried } = await retryExternalExecution(WS_A, ACTOR, submitted.id);
    expect(retried.id).not.toBe(submitted.id);
    expect(retried.parent_execution_id).toBe(submitted.id);
    expect(retried.attempt_number).toBe(submitted.attempt_number + 1);

    // The original failed row's history is untouched.
    const original = getWorkspaceExternalExecution(WS_A, submitted.id)!;
    expect(original.status).toBe('FAILED');
  });

  it('retry is refused for a still-in-flight execution', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    await expect(retryExternalExecution(WS_A, ACTOR, execution.id)).rejects.toMatchObject({ code: 'NOT_RETRYABLE' });
  });
});

describe('C4: workspace-scoped listing never leaks across workspaces', () => {
  it('listWorkspaceExternalExecutions(WS_B) never returns a WS_A row', async () => {
    await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    const listB = listWorkspaceExternalExecutions(WS_B, 50);
    expect(listB.every((e) => e.workspace_id === WS_B)).toBe(true);
  });

  it('a platform-global target can be submitted against from any workspace', async () => {
    const { execution } = await submitExternalExecution({ workspaceId: WS_B, createdByUserId: ACTOR, targetId: flowTargetId, input: {} });
    expect(execution.workspace_id).toBe(WS_B);
    expect(execution.target_kind).toBe('flow');
  });
});

describe('M1/M2: runtime event transitions are recorded, and repeated identical status never spams the ledger', () => {
  it('submission and a terminal status transition each record a real, distinct runtime event', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(submitted.remote_job_id!, 'failure');
    await refreshExternalExecutionStatus(WS_A, submitted.id);

    const events = listRecentRuntimeEvents({ workspaceId: WS_A, targetType: 'external_execution', limit: 200 })
      .filter((e) => e.target_id === submitted.id);
    expect(events.some((e) => e.status === 'SUBMITTED')).toBe(true);
    expect(events.some((e) => e.status === 'FAILED')).toBe(true);
  });

  it('polling an unchanged terminal status again does not record a second identical transition event (M2)', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(submitted.remote_job_id!, 'failure');
    await refreshExternalExecutionStatus(WS_A, submitted.id);
    const before = listRecentRuntimeEvents({ workspaceId: WS_A, targetType: 'external_execution', limit: 500 })
      .filter((e) => e.target_id === submitted.id).length;

    await refreshExternalExecutionStatus(WS_A, submitted.id); // status is already FAILED — no real transition
    const after = listRecentRuntimeEvents({ workspaceId: WS_A, targetType: 'external_execution', limit: 500 })
      .filter((e) => e.target_id === submitted.id).length;
    expect(after).toBe(before);
  });
});

describe('master-admin cross-workspace view (listAllExternalExecutions)', () => {
  it('returns rows across multiple workspaces, for the platform-admin-only surface', async () => {
    const all = listAllExternalExecutions(500);
    const workspaces = new Set(all.map((e) => e.workspace_id));
    expect(workspaces.has(WS_A)).toBe(true);
    expect(workspaces.has(WS_B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// STEP 3 — external-executions.ts migrated onto the canonical fabric.
// Everything above this line is the pre-existing ADR-006 suite, unmodified
// and still green. Everything below proves the new, additional behavior:
// real Windmill network calls now flow through the one canonical
// ExecutionContext, and the SUCCESS artifact write now goes through the one
// canonical Vault writer instead of a second, unscoped fs.writeFileSync.
// ---------------------------------------------------------------------------

const EXTERNAL_EXECUTIONS_SOURCE = fs.readFileSync(path.resolve(process.cwd(), 'lib/external-executions.ts'), 'utf-8');

describe('STEP 3 static proof: real Windmill calls are wrapped in the canonical ExecutionContext, not called bare', () => {
  it('imports the one existing ExecutionContext factory — no second one is defined here', () => {
    expect(EXTERNAL_EXECUTIONS_SOURCE).toContain("import { createExecutionContext } from './fabric/context';");
    expect(EXTERNAL_EXECUTIONS_SOURCE).not.toMatch(/function\s+createExecutionContext/);
  });

  it('every real Windmill client call (submitJob/getJobStatus/getJobResult/cancelJob) appears exactly once, and only inside ctx.invoke(\'windmill.job\', ...)', () => {
    for (const fn of ['submitJob', 'getJobStatus', 'getJobResult', 'cancelJob']) {
      const needle = `windmillClient.${fn}(`;
      const occurrences = EXTERNAL_EXECUTIONS_SOURCE.split(needle).length - 1;
      expect(occurrences, `expected exactly one call to windmillClient.${fn}(`).toBe(1);

      const idx = EXTERNAL_EXECUTIONS_SOURCE.indexOf(needle);
      const preceding = EXTERNAL_EXECUTIONS_SOURCE.slice(Math.max(0, idx - 80), idx);
      expect(preceding, `windmillClient.${fn}( must be reached through ctx.invoke('windmill.job', ...)`).toContain("ctx.invoke('windmill.job'");
    }
  });
});

describe('STEP 3 static proof: the canonical Vault writer replaced the direct filesystem write — no second artifact writer', () => {
  it('writeWorkspaceArtifact() is imported from the one canonical owner (lib/vault.ts) and used for the SUCCESS artifact', () => {
    expect(EXTERNAL_EXECUTIONS_SOURCE).toContain("import { writeWorkspaceArtifact } from './vault';");
    expect(EXTERNAL_EXECUTIONS_SOURCE).toMatch(/const persistedArtifact = writeWorkspaceArtifact\(\{/);
  });

  it('no direct fs.writeFileSync/fs.mkdirSync remains in this file — the old flat, non-workspace-scoped vault write is gone', () => {
    expect(EXTERNAL_EXECUTIONS_SOURCE).not.toContain('fs.writeFileSync');
    expect(EXTERNAL_EXECUTIONS_SOURCE).not.toContain('fs.mkdirSync');
    expect(EXTERNAL_EXECUTIONS_SOURCE).not.toContain("import fs from 'node:fs'");
    expect(EXTERNAL_EXECUTIONS_SOURCE).not.toContain("import path from 'node:path'");
  });

  it('recordArtifact() is no longer called directly from this file (the canonical writer is the only path to it)', () => {
    expect(EXTERNAL_EXECUTIONS_SOURCE).not.toMatch(/\brecordArtifact\(/);
  });
});

describe('STEP 3 live proof: a real successful ingestion writes through the canonical, workspace-scoped Vault path', () => {
  it('the persisted artifact lives under vault/workspaces/<workspaceId>/External-Executions/, not the old flat vault/External-Executions/ path', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: { probe: 'step3' } });
    setJobState(submitted.remote_job_id!, 'success', { finding: 'step 3 canonical writer proof' });
    await refreshExternalExecutionStatus(WS_A, submitted.id);
    const { execution } = await ingestExternalExecutionResult(WS_A, submitted.id);

    const artifacts = getTaskArtifacts(execution.task_id!);
    expect(artifacts.length).toBe(1);
    const artifact = artifacts[0];
    const expectedDir = path.join(VAULT_ROOT, 'workspaces', WS_A, 'External-Executions') + path.sep;
    expect(artifact.disk_path.startsWith(expectedDir)).toBe(true);
    expect(artifact.relative_path.startsWith(`workspaces/${WS_A}/External-Executions/`)).toBe(true);
    expect(fs.existsSync(artifact.disk_path)).toBe(true);
    expect(fs.readFileSync(artifact.disk_path, 'utf8')).toContain('step 3 canonical writer proof');

    // Real memory indexing (same canonical indexer kernel.ts's SUCCESS path uses).
    const db = getDatabase();
    const memRow = db.prepare('SELECT * FROM memory_index WHERE artifact_id = ?').get(artifact.artifact_id);
    expect(memRow).toBeDefined();
  });
});

describe('STEP 3 receipt contract (Rule 12 superseded — see project notes): FAILED/BLOCKED/NOT_CONFIGURED stay receiptless, SUCCESS is unaffected', () => {
  it('a submission that fails because Windmill is NOT_CONFIGURED ends FAILED, receiptless, with only a runtime_event as evidence', async () => {
    const savedBaseUrl = process.env.WINDMILL_BASE_URL;
    const savedToken = process.env.WINDMILL_TOKEN;
    const savedWorkspace = process.env.WINDMILL_WORKSPACE;
    delete process.env.WINDMILL_BASE_URL;
    delete process.env.WINDMILL_TOKEN;
    delete process.env.WINDMILL_WORKSPACE;
    try {
      const { execution } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
      expect(execution.status).toBe('FAILED');
      expect(execution.error_code).toBe('SUBMISSION_FAILED');
      expect(execution.result_receipt_id).toBeFalsy();
      expect(execution.result_artifact_id).toBeFalsy();
      expect(execution.task_id).toBeFalsy(); // no task/Aegis pipeline ever ran for an unsubmitted job

      const events = listRecentRuntimeEvents({ workspaceId: WS_A, targetType: 'external_execution', limit: 200 })
        .filter((e) => e.target_id === execution.id);
      expect(events.some((e) => e.status === 'FAILED')).toBe(true);
    } finally {
      if (savedBaseUrl !== undefined) process.env.WINDMILL_BASE_URL = savedBaseUrl;
      if (savedToken !== undefined) process.env.WINDMILL_TOKEN = savedToken;
      if (savedWorkspace !== undefined) process.env.WINDMILL_WORKSPACE = savedWorkspace;
    }
  });

  it('a genuinely successful ingestion still produces exactly one signed, verifiable receipt (SUCCESS path is unchanged by the FAILED-receipt decision)', async () => {
    const { execution: submitted } = await submitExternalExecution({ workspaceId: WS_A, createdByUserId: ACTOR, targetId: scriptTargetId, input: {} });
    setJobState(submitted.remote_job_id!, 'success');
    await refreshExternalExecutionStatus(WS_A, submitted.id);
    const { execution, verified } = await ingestExternalExecutionResult(WS_A, submitted.id);
    expect(verified).toBe(true);
    const receipts = getTaskReceipts(execution.task_id!);
    expect(receipts.length).toBe(1);
    expect(verifyReceipt(receipts[0])).toBe(true);
  });
});
