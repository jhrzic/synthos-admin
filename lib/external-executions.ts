import crypto from 'node:crypto';
import { getDatabase } from './persistence';
import {
  createInitialTask,
  updateTaskStatus,
  recordActivityEvent,
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
// STEP 3 — the canonical Vault writer (lib/vault.ts), the same one
// lib/fabric/kernel.ts uses. Replaces this file's own former direct
// filesystem-write-plus-artifact-record pair (a real, unscoped duplicate:
// the old path was a flat vault/External-Executions/ folder with no
// workspace_id segment at all, unlike every other artifact in the vault).
import { writeWorkspaceArtifact } from './vault';
// STEP 3 — real Windmill network calls (submit/status/result/cancel) are
// wrapped in ctx.invoke("windmill.job", ...) so the invocation trace is a
// truthful, observed record rather than an implicit direct call, matching
// lib/fabric/kernel.ts's ctx.invoke("model.gemini", ...) pattern. This is
// the one existing ExecutionContext factory (lib/fabric/context.ts) — no
// second one is created here.
import { createExecutionContext } from './fabric/context';
import { recordRuntimeEvent } from './runtime-events';
import { resolveWindmillTarget, validateAgainstInputSchema, WindmillTargetRecord } from './windmill-targets';
import * as windmillClient from './windmill-client';
// PUSH 1 — Antigravity joins this ledger as a SECOND runtime, not as a
// second ledger. Every guarantee below (workspace ownership at INSERT,
// status only advancing on real evidence, SUCCESS never implying SynthOS
// verification, the retry/idempotency rules) is runtime-agnostic and now
// applies to it unchanged. The `runtime` column already existed and was
// hardcoded to 'windmill'; it now carries its real value.
import * as antigravityClient from './antigravity-client';
import { checkGuardianRules } from './kil-gate';

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

/** The execution runtimes this ledger can really dispatch to. Not a wish list. */
export const EXTERNAL_RUNTIMES = ['windmill', 'antigravity'] as const;
export type ExternalRuntime = (typeof EXTERNAL_RUNTIMES)[number];

export function isExternalRuntime(v: unknown): v is ExternalRuntime {
  return typeof v === 'string' && (EXTERNAL_RUNTIMES as readonly string[]).includes(v);
}

/** Human-facing runtime label, used in task titles and artifact headers. */
const RUNTIME_LABEL: Record<ExternalRuntime, string> = {
  windmill: 'Windmill',
  antigravity: 'Antigravity',
};

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

// Real total, independent of listWorkspaceExternalExecutions' bounded page —
// a dashboard count must never silently equal the fetch limit.
export function countWorkspaceExternalExecutions(workspaceId: string): number {
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) AS n FROM external_executions WHERE workspace_id = ?')
    .get(workspaceId) as { n: number | null } | undefined;
  return row?.n ?? 0;
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
  workspaceId: string; runtime: ExternalRuntime; taskId?: string | null; graphRunId?: string | null; graphNodeId?: string | null;
  skillId?: string | null; targetId: string | null; remotePath: string; targetKind: string; correlationId: string;
  input: Record<string, unknown>; createdByUserId: string; attemptNumber: number; parentExecutionId?: string | null;
}): ExternalExecutionRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = `${params.runtime === 'antigravity' ? 'agex' : 'wmex'}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(`
    INSERT INTO external_executions (
      id, workspace_id, runtime, task_id, graph_run_id, graph_node_id, skill_id, target_id, remote_path, target_kind,
      remote_job_id, status, attempt_number, parent_execution_id, correlation_id, input_json,
      submitted_at, started_at, completed_at, last_checked_at, error_code, error_message_safe,
      result_artifact_id, result_receipt_id, result_ingested_at, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id, params.workspaceId, params.runtime, params.taskId ?? null, params.graphRunId ?? null, params.graphNodeId ?? null,
    params.skillId ?? null, params.targetId ?? null, params.remotePath, params.targetKind,
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
// STEP 3 — the one real dispatch call site. Both a first submission
// (submitExternalExecution) and a retry's resubmission (retryExternalExecution)
// go through this single wrapper rather than each independently repeating
// the ctx.invoke('windmill.job', ...) wrap — the underlying client call is
// made from exactly one place in this file, not two.
async function dispatchWindmillJob(
  workspaceId: string,
  remotePath: string,
  kind: 'script' | 'flow',
  input: Record<string, unknown>
): Promise<windmillClient.WindmillSubmitResult> {
  const ctx = createExecutionContext({ workspaceId });
  return ctx.invoke('windmill.job', () => windmillClient.submitJob({ remotePath, kind, input }));
}

// ---------------------------------------------------------------------------
// PUSH 1 — runtime dispatch. Three small functions, one switch each, rather
// than an adapter-registry abstraction: there are two runtimes, and an
// indirection layer would hide which real client call a row went through
// without removing a single line of real work.
//
// The invocation NAME passed to ctx.invoke is the real runtime's, so the
// observed trace can never claim Windmill ran an Antigravity interaction.
// ---------------------------------------------------------------------------

/** The instruction an Antigravity interaction runs, read from the ledger's own input payload. */
export function antigravityInstructionFrom(input: Record<string, unknown>): string {
  const raw = (input || {}).instruction;
  return typeof raw === 'string' ? raw : '';
}

/**
 * GUARDIAN IS AUTHORITATIVE, INCLUDING OVER A RUNTIME THAT HAS ITS OWN
 * AUTONOMOUS AGENT LOOP.
 *
 * Antigravity executes code in a sandbox Google controls, under its own
 * planner, and SynthOS cannot supervise a step it never sees. The
 * enforceable boundary is therefore the one thing SynthOS fully controls:
 * WHAT IS SENT. The instruction is evaluated by the same, single policy
 * function that gates the terminal (lib/kil-gate.ts::checkGuardianRules) —
 * not a second Antigravity-specific policy — and anything it classifies as
 * BLOCKED or APPROVAL_REQUIRED is never dispatched.
 *
 * This is deliberately stated as what it is and not more. It is a
 * submission gate, not a sandbox supervisor: an instruction that passes may
 * still cause the remote agent to run commands SynthOS never saw. The
 * second, independent boundary is that nothing the runtime returns is
 * trusted — the result must still pass Aegis and the KIL gate before a
 * receipt exists, exactly like every other execution in this ledger.
 */
export function guardianCheckInstruction(instruction: string): { allowed: boolean; error?: string; citation?: string } {
  const check = checkGuardianRules(instruction);
  if (check.status === 'SAFE') return { allowed: true };
  return {
    allowed: false,
    error: `Guardian refused this instruction before dispatch (${check.status}, risk ${check.riskLevel}): ${check.warning || 'policy violation'}`,
    citation: check.ruleCitation,
  };
}

async function dispatchAntigravityInteraction(
  workspaceId: string,
  agent: string,
  input: Record<string, unknown>
): Promise<{ ok: boolean; remoteJobId: string | null; error?: string }> {
  const instruction = antigravityInstructionFrom(input);
  if (!instruction.trim()) {
    return { ok: false, remoteJobId: null, error: 'An "instruction" string is required to run an Antigravity interaction.' };
  }
  const guardian = guardianCheckInstruction(instruction);
  if (!guardian.allowed) {
    return { ok: false, remoteJobId: null, error: guardian.error };
  }

  const tools = Array.isArray((input || {}).tools)
    ? ((input as any).tools as unknown[]).filter((t): t is { type: string } => !!t && typeof (t as any).type === 'string')
    : undefined;
  const maxTotalTokens = typeof (input || {}).maxTotalTokens === 'number' ? (input as any).maxTotalTokens : undefined;

  const ctx = createExecutionContext({ workspaceId });
  return ctx.invoke('runtime.antigravity', () => antigravityClient.submitInteraction({ instruction, agent, tools, maxTotalTokens }));
}

async function dispatchForRuntime(
  runtime: ExternalRuntime,
  workspaceId: string,
  remotePath: string,
  targetKind: string,
  input: Record<string, unknown>
): Promise<{ ok: boolean; remoteJobId: string | null; error?: string }> {
  if (runtime === 'antigravity') {
    return dispatchAntigravityInteraction(workspaceId, remotePath, input);
  }
  return dispatchWindmillJob(workspaceId, remotePath, targetKind as 'script' | 'flow', input);
}

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
  /** Defaults to 'windmill' so every existing caller is byte-for-byte unchanged. */
  runtime?: ExternalRuntime;
  /** Required for runtime 'windmill' (a windmill_targets row). Ignored for 'antigravity', which has no local target registry. */
  targetId?: string;
  /** Required for runtime 'antigravity': the managed agent id. Defaults to the configured one. */
  agent?: string;
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
  const runtime: ExternalRuntime = params.runtime || 'windmill';

  // Q1 — idempotent on an explicit key: a real prior row for this exact key
  // in this workspace is returned as-is, never duplicated.
  if (params.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM external_executions WHERE workspace_id = ? AND correlation_id = ?')
      .get(params.workspaceId, params.idempotencyKey) as ExternalExecutionRecord | undefined;
    if (existing) return { execution: existing, created: false };
  }

  // Per-runtime pre-flight. Both branches produce the same three values —
  // the target row id (null where a runtime has no local registry), the
  // remote path, and its kind — so everything below this point is
  // runtime-agnostic and the ledger's guarantees are not re-implemented
  // twice.
  let targetId: string | null;
  let remotePath: string;
  let targetKind: string;

  if (runtime === 'antigravity') {
    if (!antigravityClient.isAntigravityConfigured()) {
      throw Object.assign(new Error('Antigravity is not configured in this deployment — no credential resolves.'), { code: 'RUNTIME_NOT_CONFIGURED' });
    }
    if (!antigravityClient.isAntigravityEnabled()) {
      throw Object.assign(new Error('ANTIGRAVITY_ENABLED is not "true" — outward Antigravity execution is switched off in this deployment.'), { code: 'RUNTIME_NOT_CONFIGURED' });
    }
    const instruction = antigravityInstructionFrom(params.input || {});
    if (!instruction.trim()) {
      throw Object.assign(new Error('An "instruction" string is required to run an Antigravity interaction.'), { code: 'INVALID_INPUT' });
    }
    if (!antigravityClient.isInstructionWithinBounds(instruction)) {
      throw Object.assign(new Error('Instruction exceeds the allowed size bound.'), { code: 'INPUT_TOO_LARGE' });
    }
    // Guardian refuses BEFORE a ledger row exists, so a policy-violating
    // instruction leaves no record implying it was ever dispatched.
    const guardian = guardianCheckInstruction(instruction);
    if (!guardian.allowed) {
      throw Object.assign(new Error(guardian.error || 'Guardian refused this instruction.'), { code: 'GUARDIAN_BLOCKED' });
    }
    targetId = null;
    remotePath = params.agent || antigravityClient.resolveAntigravityAgent();
    targetKind = 'agent';
  } else {
    const target: WindmillTargetRecord | null = resolveWindmillTarget(params.workspaceId, params.targetId as string);
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
    targetId = target.id;
    remotePath = target.remote_path;
    targetKind = target.kind;
  }

  const correlationId = params.idempotencyKey || `adhoc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let execution = insertRow({
    workspaceId: params.workspaceId, runtime,
    taskId: params.taskId, graphRunId: params.graphRunId, graphNodeId: params.graphNodeId, skillId: params.skillId,
    targetId, remotePath, targetKind,
    correlationId, input: params.input || {}, createdByUserId: params.createdByUserId, attemptNumber: 1,
  });

  const submission = await dispatchForRuntime(runtime, params.workspaceId, remotePath, targetKind, params.input || {});
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
  const runtime: ExternalRuntime = isExternalRuntime(existing.runtime) ? existing.runtime : 'windmill';
  const ctx = createExecutionContext({ workspaceId });
  const statusResult = runtime === 'antigravity'
    ? await ctx.invoke('runtime.antigravity', () => antigravityClient.getInteractionStatus(existing.remote_job_id!))
    : await ctx.invoke('windmill.job', () => windmillClient.getJobStatus(existing.remote_job_id));
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
    case 'REQUIRES_ACTION':
      // PUSH 1 (Antigravity) — the remote agent has stopped and is waiting
      // for an input SynthOS was not asked for and cannot supply. It is
      // neither running nor finished, and calling it either would be a
      // false statement: RUNNING would poll forever, SUCCEEDED/FAILED would
      // invent an outcome. UNKNOWN is the honest state this ledger already
      // has for "the remote side is not telling us something we can act on".
      nextStatus = 'UNKNOWN';
      patch.error_code = 'REMOTE_REQUIRES_ACTION';
      patch.error_message_safe = 'The remote runtime is waiting for an input SynthOS did not supply. It will not progress on its own.';
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

  // PUSH 1 — runtime-aware result read. The remote CALL differs per
  // runtime; everything after it (task spine, artifact, Aegis, receipt,
  // KIL, memory index) is identical and is not duplicated.
  const runtime: ExternalRuntime = isExternalRuntime(existing.runtime) ? existing.runtime : 'windmill';
  const runtimeLabel = RUNTIME_LABEL[runtime];
  const ctx = createExecutionContext({ workspaceId });

  let resultText: string;
  let resultTruncated = false;
  /** Real, provider-reported execution evidence. Never estimated, never invented. */
  let runtimeEvidence: Record<string, unknown> = {};

  if (runtime === 'antigravity') {
    const interaction = await ctx.invoke('runtime.antigravity', () => antigravityClient.getInteractionResult(existing.remote_job_id!));
    if (!interaction.ok) {
      throw Object.assign(new Error(sanitizeError(interaction.error)), { code: 'RESULT_FETCH_FAILED' });
    }
    if (!interaction.outputText.trim()) {
      // A completed interaction that produced no text is a real outcome and
      // must not become an artifact containing nothing. Ingesting it would
      // manufacture a verifiable-looking record of no work.
      throw Object.assign(new Error('The Antigravity interaction completed but returned no output text.'), { code: 'EMPTY_RESULT' });
    }
    resultText = interaction.outputText;
    resultTruncated = interaction.truncated;
    runtimeEvidence = {
      stepNames: interaction.stepNames,
      stepCount: interaction.stepNames.length,
      usage: interaction.usage ?? null,
      environmentId: interaction.environmentId,
    };
  } else {
    const resultCall = await ctx.invoke('windmill.job', () => windmillClient.getJobResult(existing.remote_job_id));
    if (!resultCall.ok) {
      throw Object.assign(new Error(sanitizeError(resultCall.error)), { code: 'RESULT_FETCH_FAILED' });
    }
    resultText = typeof resultCall.result === 'string' ? resultCall.result : JSON.stringify(resultCall.result, null, 2);
    resultTruncated = !!resultCall.truncated;
  }

  const taskId = existing.task_id || `${runtime === 'antigravity' ? 'agext' : 'wmext'}-${existing.id}`;
  const title = `${runtimeLabel} execution — ${existing.remote_path}`;
  const description = `External execution of ${runtimeLabel} ${existing.target_kind} "${existing.remote_path}" (remote job ${existing.remote_job_id}).`;
  const nowIso = new Date().toISOString();

  createInitialTask({ taskId, workspaceId, title, description, assignedAgent: runtime, assignedModel: `${runtime}:${existing.remote_path}`, createdAt: existing.created_at });
  recordActivityEvent({ taskId, eventType: 'TASK_CREATED', agentId: 'orchestrator', payload: { title, status: 'TODO' }, createdAt: existing.created_at });
  updateTaskStatus(taskId, 'READY');
  recordActivityEvent({ taskId, eventType: 'AGENT_ASSIGNED', agentId: runtime, payload: { agent: runtime, model: `${runtime}:${existing.remote_path}`, status: 'READY' } });
  updateTaskStatus(taskId, 'RUNNING');
  recordActivityEvent({ taskId, eventType: 'EXECUTION_STARTED', agentId: runtime, payload: { status: 'RUNNING', remoteJobId: existing.remote_job_id, correlationId: existing.correlation_id } });

  recordActivityEvent({ taskId, eventType: 'PROVIDER_COMPLETED', agentId: runtime, payload: { model: `${runtime}:${existing.remote_path}`, runtime, outputLength: resultText.length, truncated: resultTruncated, ...runtimeEvidence } });

  // STEP 3 — the canonical Vault writer (lib/vault.ts), the same one
  // lib/fabric/kernel.ts's SUCCESS path uses. This replaces a direct
  // filesystem write into a flat, non-workspace-scoped
  // vault/External-Executions/ folder (no workspace_id segment anywhere in
  // that path) with the real workspace-scoped, traversal/symlink-checked
  // write every other artifact in the vault now goes through. As in
  // kernel.ts's Step 2 change, the real relative_path is only known once
  // writeWorkspaceArtifact() generates it, so the old "**Vault Path**:
  // `...`" header line (which had to guess the path before writing) is
  // dropped rather than filled with a placeholder baked into the saved
  // document.
  // PUSH 1 — the artifact header carries real provenance for whichever
  // runtime produced it: runtime, remote job id, and the correlation id
  // that links this document back to the originating SynthOS task. That is
  // what makes the Vault copy traceable rather than just a saved blob.
  const provenanceLines = [
    `**Runtime**: ${runtimeLabel}`,
    `**Remote job**: ${existing.remote_job_id}`,
    `**Correlation**: ${existing.correlation_id}`,
    `**Workspace**: ${workspaceId}`,
    `**Timestamp**: ${nowIso}`,
  ];
  if (runtime === 'antigravity' && Array.isArray(runtimeEvidence.stepNames)) {
    const steps = runtimeEvidence.stepNames as string[];
    provenanceLines.push(`**Remote steps**: ${steps.length > 0 ? steps.join(', ') : 'none reported'}`);
  }
  const artifactContent = `# ${title}\n\n${provenanceLines.join('\n')}\n\n---\n\n\`\`\`\n${resultText}\n\`\`\`\n`;
  const persistedArtifact = writeWorkspaceArtifact({
    workspaceId,
    taskId,
    content: artifactContent,
    folder: 'External-Executions',
    extension: 'md',
    createdAt: nowIso,
  });
  recordActivityEvent({
    taskId, eventType: 'ARTIFACT_SAVED', agentId: runtime,
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
    // The remote runtime (Windmill or Antigravity) never signs anything
    // authoritative, and never holds the signing key.
    const newReceiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const canonicalPayload: CanonicalReceiptPayload = {
      receiptId: newReceiptId, taskId, reviewId: persistedReview.review_id, workspaceId,
      // PUSH 1 — attests to the runtime that ACTUALLY executed. Signing
      // 'windmill' over an Antigravity result would be a false statement in
      // a cryptographically signed record.
      assignedAgent: runtime, provider: runtime, modelUsed: existing.remote_path,
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
      recordActivityEvent({ taskId, eventType: 'TASK_COMPLETED', agentId: runtime, payload: { receiptId: newReceiptId, status: 'DONE' }, createdAt: nowIso });
      receiptId = newReceiptId;

      // KIL — isolated in its own try/catch: never affects task/receipt outcome.
      try {
        const gate = verifyTaskAtGate({
          taskId, workspaceId, title, description,
          groundingContext: [title, description, existing.remote_path, antigravityInstructionFrom(existing.input_json ? JSON.parse(existing.input_json) : {})].filter(Boolean).join('\n\n'),
          assignedAgent: runtime, output: resultText,
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
    // F4/rule 15 — a remote runtime succeeding never implies SynthOS
    // verification. This is the load-bearing rule for Antigravity too: it
    // runs its own autonomous agent loop and reports its own success, and
    // that report buys it nothing here.
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

  const runtime: ExternalRuntime = isExternalRuntime(existing.runtime) ? existing.runtime : 'windmill';
  if (runtime === 'antigravity') {
    // HONEST LIMITATION, stated rather than faked. Google's managed
    // interactions API publishes no cancel operation, so there is nothing
    // real to call. Marking the row CANCELLED locally would be the exact
    // fabrication rule O1/O2/O3 exists to prevent: the remote sandbox would
    // keep running — and keep billing — behind a UI that said it stopped.
    return {
      execution: existing,
      confirmed: false,
      error: 'Cancellation is NOT_IMPLEMENTED for the Antigravity runtime — its managed API exposes no cancel operation, and SynthOS will not mark a remote interaction cancelled that it cannot actually stop.',
    };
  }

  const previousStatus = existing.status;
  const ctx = createExecutionContext({ workspaceId });
  const result = await ctx.invoke('windmill.job', () => windmillClient.cancelJob(existing.remote_job_id));
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
  const runtime: ExternalRuntime = isExternalRuntime(prior.runtime) ? prior.runtime : 'windmill';
  const input = prior.input_json ? JSON.parse(prior.input_json) : {};

  // Per-runtime target re-resolution. A retry must re-check that the target
  // is STILL allowed and the runtime STILL enabled — a prior row is not
  // standing permission to dispatch again.
  let targetId: string | null;
  let remotePath: string;
  let targetKind: string;

  if (runtime === 'antigravity') {
    if (!antigravityClient.isAntigravityConfigured() || !antigravityClient.isAntigravityEnabled()) {
      throw Object.assign(new Error('The Antigravity runtime is no longer configured or enabled in this deployment.'), { code: 'RUNTIME_NOT_CONFIGURED' });
    }
    // Guardian is re-evaluated on every retry, never inherited from the
    // first attempt: policy can change between attempts, and a retry is a
    // new outward dispatch decision.
    const guardian = guardianCheckInstruction(antigravityInstructionFrom(input));
    if (!guardian.allowed) {
      throw Object.assign(new Error(guardian.error || 'Guardian refused this instruction.'), { code: 'GUARDIAN_BLOCKED' });
    }
    targetId = null;
    remotePath = prior.remote_path;
    targetKind = prior.target_kind;
  } else {
    if (!prior.target_id) {
      throw Object.assign(new Error('The prior attempt has no resolvable target to retry.'), { code: 'NOT_RETRYABLE' });
    }
    const target = resolveWindmillTarget(workspaceId, prior.target_id);
    if (!target) throw Object.assign(new Error('The target for this execution is no longer allowed.'), { code: 'TARGET_NOT_ALLOWED' });
    targetId = target.id;
    remotePath = target.remote_path;
    targetKind = target.kind;
  }

  const correlationId = `${prior.correlation_id}::retry-${prior.attempt_number + 1}`;
  let execution = insertRow({
    workspaceId, runtime, taskId: prior.task_id, graphRunId: prior.graph_run_id, graphNodeId: prior.graph_node_id, skillId: prior.skill_id,
    targetId, remotePath, targetKind,
    correlationId, input, createdByUserId: actorUserId, attemptNumber: prior.attempt_number + 1, parentExecutionId: prior.id,
  });

  const submission = await dispatchForRuntime(runtime, workspaceId, remotePath, targetKind, input);
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
