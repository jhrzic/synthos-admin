import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDatabase } from './persistence';
import {
  createInitialTask,
  updateTaskStatus,
  recordActivityEvent,
  recordArtifact,
  runDeterministicAegisVerification,
  recordQualityReview,
  recordReceipt,
  canonicalizePayload,
  signReceiptPayload,
  verifyReceiptSignature,
  projectKnowledgeCandidate,
  CanonicalReceiptPayload,
} from './persistence';
import { verifyTaskAtGate } from './kil-gate';
import { indexVaultArtifact } from './memory-index';
import { VAULT_ROOT } from './vault';
import { recordRuntimeEvent } from './runtime-events';
import { resolveWindmillTarget, validateAgainstInputSchema, WindmillTargetRecord } from './windmill-targets';
import * as windmillClient from './windmill-client';

// ---------------------------------------------------------------------------
// ADR-006 — the canonical LOCAL truth for a Windmill job (Workstream C).
//
// Windmill's own job state is never trusted as the only record of what
// happened (non-negotiable architecture rule). Every row here is
// workspace-owned at INSERT time from the authenticated, already-authorized
// caller context — never from anything a remote payload claims. Status here
// only ever advances on evidence: SUBMITTED requires a real 2xx + parsed job
// UUID from Windmill; RUNNING/SUCCEEDED/FAILED/CANCELLED require a real
// status read back from Windmill; SUCCESS never implies "SynthOS verified
// this" — that's a separate step (ingestExternalExecutionResult, F-series).
// ---------------------------------------------------------------------------

export type ExternalExecutionStatus =
  | 'PENDING' | 'SUBMITTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

const TERMINAL_STATUSES: ExternalExecutionStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

export interface ExternalExecutionRecord {
  id: string;
  workspace_id: string;
  runtime: string;
  task_id: string | null;
  graph_run_id: string | null;
  graph_node_id: string | null;
  skill_id: string | null;
  target_id: string | null;
  remote_path: string;
  target_kind: string;
  remote_job_id: string | null;
  status: ExternalExecutionStatus;
  attempt_number: number;
  parent_execution_id: string | null;
  correlation_id: string;
  input_json: string | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_checked_at: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  result_artifact_id: string | null;
  result_receipt_id: string | null;
  result_ingested_at: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

function row(id: string): ExternalExecutionRecord | null {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM external_executions WHERE id = ?').get(id) as ExternalExecutionRecord) || null;
}

/** Workspace-scoped lookup — an id from another workspace is indistinguishable from an unknown one (same non-disclosure pattern as tasks/skills). */
export function getWorkspaceExternalExecution(workspaceId: string, id: string): ExternalExecutionRecord | null {
  const record = row(id);
  return record && record.workspace_id === workspaceId ? record : null;
}

export function listWorkspaceExternalExecutions(workspaceId: string, limit = 50): ExternalExecutionRecord[] {
  const db = getDatabase();
  const bounded = Math.min(Math.max(limit, 1), 200);
  return db.prepare('SELECT * FROM external_executions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, bounded) as ExternalExecutionRecord[];
}

/** Platform-wide, unscoped — reachable ONLY from requirePlatformAdmin routes (Master Admin), same posture as listRecentAdminAuditEvents. */
export function listAllExternalExecutions(limit = 100): ExternalExecutionRecord[] {
  const db = getDatabase();
  const bounded = Math.min(Math.max(limit, 1), 300);
  return db.prepare('SELECT * FROM external_executions ORDER BY created_at DESC LIMIT ?').all(bounded) as ExternalExecutionRecord[];
}

/** 500-char, control-char-stripped — never store or surface a raw, unbounded remote error string (R5). */
function sanitizeError(message: string | undefined | null): string {
  if (!message) return 'Unknown error.';
  // eslint-disable-next-line no-control-regex
  return message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 500);
}

function insertRow(params: {
  workspaceId: string; taskId?: string | null; graphRunId?: string | null; graphNodeId?: string | null;
  skillId?: string | null; targetId: string; remotePath: string; targetKind: string; correlationId: string;
  input: Record<string, unknown>; createdByUserId: string; attemptNumber: number; parentExecutionId?: string | null;
}): ExternalExecutionRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = `wmex-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(`
    INSERT INTO external_executions (
      id, workspace_id, runtime, task_id, graph_run_id, graph_node_id, skill_id, target_id, remote_path, target_kind,
      remote_job_id, status, attempt_number, parent_execution_id, correlation_id, input_json,
      submitted_at, started_at, completed_at, last_checked_at, error_code, error_message_safe,
      result_artifact_id, result_receipt_id, result_ingested_at, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, 'windmill', ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id, params.workspaceId, params.taskId ?? null, params.graphRunId ?? null, params.graphNodeId ?? null,
    params.skillId ?? null, params.targetId, params.remotePath, params.targetKind,
    params.attemptNumber, params.parentExecutionId ?? null, params.correlationId, JSON.stringify(params.input ?? {}),
    params.createdByUserId, now, now
  );
  return row(id)!;
}

function patchRow(id: string, patch: Record<string, unknown>): ExternalExecutionRecord {
  const db = getDatabase();
  const keys = Object.keys(patch);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE external_executions SET ${sets}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => (patch as any)[k]), new Date().toISOString(), id);
  return row(id)!;
}

/** M2 — only emits a runtime event when status genuinely changed; polling the same terminal state repeatedly must never spam the ledger. */
function recordTransition(execution: ExternalExecutionRecord, previousStatus: string | null, eventStatus: 'SUBMITTED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED') {
  if (previousStatus === execution.status) return;
  recordRuntimeEvent({
    workspaceId: execution.workspace_id,
    eventType: 'EXTERNAL_EXECUTION',
    targetType: 'external_execution',
    targetId: execution.id,
    status: eventStatus,
    detail: { runtime: execution.runtime, remoteJobId: execution.remote_job_id, remotePath: execution.remote_path, status: execution.status },
  });
}

export interface SubmitExternalExecutionParams {
  workspaceId: string;
  createdByUserId: string;
  targetId: string;
  input: Record<string, unknown>;
  taskId?: string;
  graphRunId?: string;
  graphNodeId?: string;
  skillId?: string;
  /** Q1 idempotency key. Omit for a call that should always create a new row (e.g. a UI "run once" click with no natural key). */
  idempotencyKey?: string;
}

export interface SubmitExternalExecutionResult {
  execution: ExternalExecutionRecord;
  created: boolean;
  error?: string;
}

/**
 * D1/D2/D3 — the one real, authorized submission path. Every caller must
 * already be authenticated and workspace-authorized before this runs (the
 * API route enforces that); this function additionally re-validates the
 * target is actually visible/enabled for the caller's workspace (K1/K4) —
 * never trusts a targetId as sufficient proof on its own.
 */
export async function submitExternalExecution(params: SubmitExternalExecutionParams): Promise<SubmitExternalExecutionResult> {
  const db = getDatabase();

  // Q1 — idempotent on an explicit key: a real prior row for this exact key
  // in this workspace is returned as-is, never duplicated.
  if (params.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM external_executions WHERE workspace_id = ? AND correlation_id = ?')
      .get(params.workspaceId, params.idempotencyKey) as ExternalExecutionRecord | undefined;
    if (existing) return { execution: existing, created: false };
  }

  const target: WindmillTargetRecord | null = resolveWindmillTarget(params.workspaceId, params.targetId);
  if (!target) {
    throw Object.assign(new Error('The requested Windmill target does not exist, is disabled, or is not visible to this workspace.'), { code: 'TARGET_NOT_ALLOWED' });
  }

  const schemaCheck = validateAgainstInputSchema(target, params.input || {});
  if (!schemaCheck.valid) {
    throw Object.assign(new Error(schemaCheck.error || 'Input failed target schema validation.'), { code: 'INVALID_INPUT' });
  }
  if (!windmillClient.isJobInputWithinBounds(params.input)) {
    throw Object.assign(new Error('Job input exceeds the allowed size bound.'), { code: 'INPUT_TOO_LARGE' });
  }

  const correlationId = params.idempotencyKey || `adhoc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let execution = insertRow({
    workspaceId: params.workspaceId,
    taskId: params.taskId, graphRunId: params.graphRunId, graphNodeId: params.graphNodeId, skillId: params.skillId,
    targetId: target.id, remotePath: target.remote_path, targetKind: target.kind,
    correlationId, input: params.input || {}, createdByUserId: params.createdByUserId, attemptNumber: 1,
  });

  const submission = await windmillClient.submitJob({ remotePath: target.remote_path, kind: target.kind, input: params.input || {} });
  if (!submission.ok) {
    execution = patchRow(execution.id, { status: 'FAILED', error_code: 'SUBMISSION_FAILED', error_message_safe: sanitizeError(submission.error) });
    recordTransition(execution, 'PENDING', 'FAILED');
    return { execution, created: true, error: submission.error };
  }

  const now = new Date().toISOString();
  execution = patchRow(execution.id, { status: 'SUBMITTED', remote_job_id: submission.remoteJobId, submitted_at: now });
  recordTransition(execution, 'PENDING', 'SUBMITTED');
  return { execution, created: true };
}

/** E1 — on-demand only. Never called from a timer; every call site is a real user action (UI refresh click, an execute-route's own bounded wait, a status-list read). */
export async function refreshExternalExecutionStatus(workspaceId: string, id: string): Promise<ExternalExecutionRecord> {
  const existing = getWorkspaceExternalExecution(workspaceId, id);
  if (!existing) throw Object.assign(new Error('External execution not found.'), { code: 'NOT_FOUND' });
  if (!existing.remote_job_id || TERMINAL_STATUSES.includes(existing.status)) {
    return patchRow(existing.id, { last_checked_at: new Date().toISOString() });
  }

  const previousStatus = existing.status;
  const statusResult = await windmillClient.getJobStatus(existing.remote_job_id);
  const now = new Date().toISOString();

  if (!statusResult.ok) {
    // P2 — a failed/unreachable status read is UNKNOWN, never fabricated FAILED.
    const updated = patchRow(existing.id, { status: 'UNKNOWN', last_checked_at: now, error_message_safe: sanitizeError(statusResult.error) });
    recordTransition(updated, previousStatus, 'FAILED');
    return updated;
  }

  let nextStatus: ExternalExecutionStatus = existing.status;
  const patch: Record<string, unknown> = { last_checked_at: now };
  switch (statusResult.state) {
    case 'QUEUED':
      nextStatus = 'SUBMITTED';
      break;
    case 'RUNNING':
      nextStatus = 'RUNNING';
      if (!existing.started_at) patch.started_at = now;
      break;
    case 'SUCCESS':
      nextStatus = 'SUCCEEDED';
      patch.completed_at = now;
      break;
    case 'FAILURE':
      nextStatus = 'FAILED';
      patch.completed_at = now;
      patch.error_code = 'REMOTE_JOB_FAILED';
      break;
    case 'CANCELLED':
      nextStatus = 'CANCELLED';
      patch.completed_at = now;
      break;
    default:
      nextStatus = 'UNKNOWN';
  }
  patch.status = nextStatus;
  const updated = patchRow(existing.id, patch);
  const eventStatus = nextStatus === 'SUCCEEDED' ? 'SUCCESS' : nextStatus === 'RUNNING' ? 'RUNNING' : nextStatus === 'CANCELLED' ? 'CANCELLED' : nextStatus === 'FAILED' ? 'FAILED' : 'SUBMITTED';
  recordTransition(updated, previousStatus, eventStatus as any);
  return updated;
}

export interface IngestResult {
  execution: ExternalExecutionRecord;
  alreadyIngested: boolean;
  verified: boolean;
}

/**
 * F1-F6 — converts a genuinely SUCCEEDED remote job into a real SynthOS
 * task/artifact, runs the existing deterministic Aegis verifier against it
 * (the same one /api/execute-agent-task uses — not a second, parallel
 * verifier), and only on VERIFIED issues a real signed receipt, then feeds
 * KIL and the memory index exactly as that route does. Idempotent: a second
 * call against an already-ingested row is a no-op read (Q2).
 */
export async function ingestExternalExecutionResult(workspaceId: string, id: string): Promise<IngestResult> {
  const existing = getWorkspaceExternalExecution(workspaceId, id);
  if (!existing) throw Object.assign(new Error('External execution not found.'), { code: 'NOT_FOUND' });
  if (existing.result_ingested_at) {
    return { execution: existing, alreadyIngested: true, verified: !!existing.result_receipt_id };
  }
  if (existing.status !== 'SUCCEEDED' || !existing.remote_job_id) {
    throw Object.assign(new Error(`Cannot ingest a result for status "${existing.status}" — only a confirmed SUCCEEDED remote job may be ingested.`), { code: 'NOT_SUCCEEDED' });
  }

  const resultCall = await windmillClient.getJobResult(existing.remote_job_id);
  if (!resultCall.ok) {
    throw Object.assign(new Error(sanitizeError(resultCall.error)), { code: 'RESULT_FETCH_FAILED' });
  }

  const taskId = existing.task_id || `wmext-${existing.id}`;
  const title = `Windmill execution — ${existing.remote_path}`;
  const description = `External execution of Windmill ${existing.target_kind} "${existing.remote_path}" (remote job ${existing.remote_job_id}).`;
  const nowIso = new Date().toISOString();

  createInitialTask({ taskId, workspaceId, title, description, assignedAgent: 'windmill', assignedModel: `windmill:${existing.remote_path}`, createdAt: existing.created_at });
  recordActivityEvent({ taskId, eventType: 'TASK_CREATED', agentId: 'orchestrator', payload: { title, status: 'TODO' }, createdAt: existing.created_at });
  updateTaskStatus(taskId, 'READY');
  recordActivityEvent({ taskId, eventType: 'AGENT_ASSIGNED', agentId: 'windmill', payload: { agent: 'windmill', model: `windmill:${existing.remote_path}`, status: 'READY' } });
  updateTaskStatus(taskId, 'RUNNING');
  recordActivityEvent({ taskId, eventType: 'EXECUTION_STARTED', agentId: 'windmill', payload: { status: 'RUNNING', remoteJobId: existing.remote_job_id } });

  const resultText = typeof resultCall.result === 'string' ? resultCall.result : JSON.stringify(resultCall.result, null, 2);
  recordActivityEvent({ taskId, eventType: 'PROVIDER_COMPLETED', agentId: 'windmill', payload: { model: `windmill:${existing.remote_path}`, outputLength: resultText.length, truncated: !!resultCall.truncated } });

  const sanitizedPath = existing.remote_path.replace(/[^a-zA-Z0-9_-]/g, '-');
  const vaultRelPath = `External-Executions/${sanitizedPath}-${existing.id}.md`;
  const vaultDiskDir = path.join(VAULT_ROOT, 'External-Executions');
  if (!fs.existsSync(vaultDiskDir)) fs.mkdirSync(vaultDiskDir, { recursive: true });
  const vaultDiskPath = path.join(vaultDiskDir, `${sanitizedPath}-${existing.id}.md`);
  const artifactContent = `# ${title}\n\n**Runtime**: Windmill\n**Remote job**: ${existing.remote_job_id}\n**Timestamp**: ${nowIso}\n**Vault Path**: \`${vaultRelPath}\`\n\n---\n\n\`\`\`\n${resultText}\n\`\`\`\n`;
  fs.writeFileSync(vaultDiskPath, artifactContent, 'utf8');

  const artifactId = `art-${Date.now()}`;
  const persistedArtifact = recordArtifact({ artifactId, taskId, relativePath: vaultRelPath, diskPath: vaultDiskPath, content: artifactContent, createdAt: nowIso });
  recordActivityEvent({
    taskId, eventType: 'ARTIFACT_SAVED', agentId: 'windmill',
    payload: { artifactId: persistedArtifact.artifact_id, relativePath: persistedArtifact.relative_path, diskPath: persistedArtifact.disk_path, contentHash: persistedArtifact.content_hash, sizeBytes: persistedArtifact.size_bytes },
    createdAt: nowIso,
  });

  updateTaskStatus(taskId, 'AWAITING_VERIFICATION');
  const aegisResult = runDeterministicAegisVerification(taskId, resultText);
  const persistedReview = recordQualityReview({
    taskId, reviewer: aegisResult.reviewer, method: aegisResult.method, score: aegisResult.score,
    decision: aegisResult.decision, checks: aegisResult.checks, evidence: aegisResult.evidence, createdAt: nowIso,
  });

  let receiptId: string | null = null;
  if (aegisResult.decision === 'VERIFIED') {
    updateTaskStatus(taskId, 'AWAITING_RECEIPT');
    recordActivityEvent({ taskId, eventType: 'AEGIS_REVIEWED', agentId: 'aegis', payload: { reviewId: persistedReview.review_id, decision: 'VERIFIED', score: aegisResult.score, checks: aegisResult.checks }, createdAt: nowIso });

    // F5 — SynthOS signs its own receipt with the existing Ed25519 path.
    // The remote runtime (Windmill) never signs anything authoritative.
    const newReceiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const canonicalPayload: CanonicalReceiptPayload = {
      receiptId: newReceiptId, taskId, reviewId: persistedReview.review_id, workspaceId,
      assignedAgent: 'windmill', provider: 'windmill', modelUsed: existing.remote_path,
      artifactId: persistedArtifact.artifact_id, artifactHash: persistedArtifact.content_hash,
      aegisDecision: aegisResult.decision, aegisMethod: aegisResult.method, createdAt: nowIso,
    };
    const canonicalPayloadStr = canonicalizePayload(canonicalPayload);
    const { signature, publicKeyPem, algorithm, fingerprint } = signReceiptPayload(canonicalPayloadStr);
    const verificationPassed = verifyReceiptSignature(canonicalPayloadStr, signature, publicKeyPem);

    if (verificationPassed) {
      recordReceipt({ receiptId: newReceiptId, taskId, reviewId: persistedReview.review_id, algorithm, publicKey: publicKeyPem, payloadJson: canonicalPayloadStr, signature, createdAt: nowIso });
      recordActivityEvent({ taskId, eventType: 'RECEIPT_CREATED', agentId: 'guardian', payload: { receiptId: newReceiptId, algorithm, fingerprint, signature, verified: true }, createdAt: nowIso });
      updateTaskStatus(taskId, 'DONE');
      recordActivityEvent({ taskId, eventType: 'TASK_COMPLETED', agentId: 'windmill', payload: { receiptId: newReceiptId, status: 'DONE' }, createdAt: nowIso });
      receiptId = newReceiptId;

      // KIL — isolated in its own try/catch: never affects task/receipt outcome.
      try {
        const gate = verifyTaskAtGate({
          taskId, workspaceId, title, description,
          groundingContext: [title, description, existing.remote_path].filter(Boolean).join('\n\n'),
          assignedAgent: 'windmill', output: resultText,
        });
        if (gate.observation.promoted) {
          try {
            projectKnowledgeCandidate({ workspaceId, taskId, kilObservationId: gate.observation.observation_id, receiptId: newReceiptId, vaultPath: persistedArtifact.relative_path, label: title });
          } catch { /* non-blocking */ }
        }
      } catch { /* non-blocking */ }

      try {
        indexVaultArtifact(workspaceId, persistedArtifact.artifact_id);
      } catch { /* non-blocking */ }
    } else {
      updateTaskStatus(taskId, 'FAILED');
      recordActivityEvent({ taskId, eventType: 'RECEIPT_VERIFICATION_FAILED', agentId: 'guardian', payload: { reviewId: persistedReview.review_id }, createdAt: nowIso });
    }
  } else {
    // F4/rule 15 — Windmill succeeding never implies SynthOS verification.
    // No receipt, task explicitly FAILED, exactly like a failed Aegis
    // decision on the native /api/execute-agent-task path (N4).
    updateTaskStatus(taskId, 'FAILED');
    recordActivityEvent({ taskId, eventType: 'AEGIS_REVIEWED', agentId: 'aegis', payload: { reviewId: persistedReview.review_id, decision: aegisResult.decision, score: aegisResult.score }, createdAt: nowIso });
  }

  const updated = patchRow(existing.id, {
    task_id: taskId,
    result_artifact_id: persistedArtifact.artifact_id,
    result_receipt_id: receiptId,
    result_ingested_at: nowIso,
  });

  return { execution: updated, alreadyIngested: false, verified: !!receiptId };
}

export interface CancelResult {
  execution: ExternalExecutionRecord;
  confirmed: boolean;
  error?: string;
}

/** O1/O2/O3 — only ever marks CANCELLED on real remote confirmation; a failed or unconfirmed cancel leaves status untouched, never SUCCESS. */
export async function cancelExternalExecution(workspaceId: string, id: string): Promise<CancelResult> {
  const existing = getWorkspaceExternalExecution(workspaceId, id);
  if (!existing) throw Object.assign(new Error('External execution not found.'), { code: 'NOT_FOUND' });
  if (TERMINAL_STATUSES.includes(existing.status) || !existing.remote_job_id) {
    return { execution: existing, confirmed: false, error: `Cannot cancel an execution in terminal or unsubmitted status "${existing.status}".` };
  }

  const previousStatus = existing.status;
  const result = await windmillClient.cancelJob(existing.remote_job_id);
  if (!result.ok) {
    return { execution: existing, confirmed: false, error: sanitizeError(result.error) };
  }
  if (!result.confirmed) {
    // Cancel request accepted but not yet confirmed stopped — remain in
    // whatever status is real, never claim CANCELLED speculatively.
    const refreshed = await refreshExternalExecutionStatus(workspaceId, id);
    return { execution: refreshed, confirmed: refreshed.status === 'CANCELLED' };
  }

  const now = new Date().toISOString();
  const updated = patchRow(existing.id, { status: 'CANCELLED', completed_at: now, last_checked_at: now });
  recordTransition(updated, previousStatus, 'CANCELLED');
  return { execution: updated, confirmed: true };
}

/** N2/N3 — a retry never overwrites history; it's a brand-new row, linked via parent_execution_id, with attempt_number incremented. */
export async function retryExternalExecution(workspaceId: string, actorUserId: string, priorId: string): Promise<SubmitExternalExecutionResult> {
  const prior = getWorkspaceExternalExecution(workspaceId, priorId);
  if (!prior) throw Object.assign(new Error('External execution not found.'), { code: 'NOT_FOUND' });
  if (!TERMINAL_STATUSES.includes(prior.status) || prior.status === 'SUCCEEDED') {
    throw Object.assign(new Error(`Cannot retry an execution in status "${prior.status}" — only a failed or cancelled attempt may be retried.`), { code: 'NOT_RETRYABLE' });
  }
  if (!prior.target_id) {
    throw Object.assign(new Error('The prior attempt has no resolvable target to retry.'), { code: 'NOT_RETRYABLE' });
  }

  const input = prior.input_json ? JSON.parse(prior.input_json) : {};
  const target = resolveWindmillTarget(workspaceId, prior.target_id);
  if (!target) throw Object.assign(new Error('The target for this execution is no longer allowed.'), { code: 'TARGET_NOT_ALLOWED' });

  const correlationId = `${prior.correlation_id}::retry-${prior.attempt_number + 1}`;
  let execution = insertRow({
    workspaceId, taskId: prior.task_id, graphRunId: prior.graph_run_id, graphNodeId: prior.graph_node_id, skillId: prior.skill_id,
    targetId: target.id, remotePath: target.remote_path, targetKind: target.kind,
    correlationId, input, createdByUserId: actorUserId, attemptNumber: prior.attempt_number + 1, parentExecutionId: prior.id,
  });

  const submission = await windmillClient.submitJob({ remotePath: target.remote_path, kind: target.kind, input });
  if (!submission.ok) {
    execution = patchRow(execution.id, { status: 'FAILED', error_code: 'SUBMISSION_FAILED', error_message_safe: sanitizeError(submission.error) });
    recordTransition(execution, 'PENDING', 'FAILED');
    return { execution, created: true, error: submission.error };
  }
  const now = new Date().toISOString();
  execution = patchRow(execution.id, { status: 'SUBMITTED', remote_job_id: submission.remoteJobId, submitted_at: now });
  recordTransition(execution, 'PENDING', 'SUBMITTED');
  return { execution, created: true };
}

/**
 * E1/P3 — the on-demand refresh path (a UI "refresh" click, an orphan
 * reconciliation sweep after a SynthOS restart). If the real remote status
 * comes back SUCCEEDED and this row has never been ingested, ingestion runs
 * inline so a caller that was offline while the job finished can pick up
 * the result the first time it asks — never a second time (Q2/P3
 * idempotence: ingestExternalExecutionResult itself is the idempotency
 * boundary, checked via result_ingested_at).
 */
export async function refreshAndIngestIfComplete(workspaceId: string, id: string): Promise<ExternalExecutionRecord> {
  const refreshed = await refreshExternalExecutionStatus(workspaceId, id);
  if (refreshed.status === 'SUCCEEDED' && !refreshed.result_ingested_at) {
    const { execution } = await ingestExternalExecutionResult(workspaceId, id);
    return execution;
  }
  return refreshed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * E2 — bounded synchronous wait, for call sites (skill execution, graph
 * node execution) that need a result within one HTTP request. Fixed
 * attempt cap and interval — never an unbounded loop, never a background
 * timer. On a genuine SUCCEEDED outcome it also runs ingestion inline so
 * the caller gets a fully resolved (verified-or-not) record back.
 */
export async function submitAndAwaitExternalExecution(
  params: SubmitExternalExecutionParams,
  opts: { timeoutMs?: number; intervalMs?: number; maxAttempts?: number } = {}
): Promise<ExternalExecutionRecord> {
  const timeoutMs = Math.min(opts.timeoutMs ?? 20000, 60000);
  const intervalMs = Math.max(opts.intervalMs ?? 1500, 250);
  const maxAttempts = Math.min(opts.maxAttempts ?? 20, 40);

  const { execution: submitted } = await submitExternalExecution(params);
  if (submitted.status === 'FAILED') return submitted;

  const deadline = Date.now() + timeoutMs;
  let current = submitted;
  let attempts = 0;
  while (Date.now() < deadline && attempts < maxAttempts && !TERMINAL_STATUSES.includes(current.status)) {
    await sleep(intervalMs);
    current = await refreshExternalExecutionStatus(params.workspaceId, current.id);
    attempts += 1;
  }

  if (current.status === 'SUCCEEDED' && !current.result_ingested_at) {
    const { execution } = await ingestExternalExecutionResult(params.workspaceId, current.id);
    return execution;
  }
  return current;
}
