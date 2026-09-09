// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 6: the canonical execution envelope.
//
// PLATFORM-LEVEL, not Jarvis-specific. This is the ONE dispatcher any real
// caller (Jarvis today, graphs/admin workflows/an external API later)
// hands a classified capability request to. It is the single place that:
//   - refuses a capability the registry reports NOT_CONFIGURED/UNSUPPORTED
//   - refuses an EXTERNAL_ACTION capability that has no real, wired
//     Guardian enforcement (advisory risk policy is never treated as
//     permission — Step 6 Section 7)
//   - routes a READ capability to the real existing accessor, with no
//     artifact/Aegis/receipt
//   - routes an ACTION_REQUEST capability to its one real executor
//
// Nothing here calls a model, writes a Vault file, calls Windmill/MCP/
// Hermes, or signs a receipt directly outside the real primitives this
// file imports from lib/persistence.ts, lib/vault.ts, lib/memory-index.ts,
// and lib/kil-gate.ts — the same ones lib/fabric/kernel.ts already uses.
// This is not a second execution pipeline; it is the one canonical path
// for capabilities that don't already have their own (model.gemini via
// /api/execute-agent-task, graph.execute, skill.execute, windmill.job all
// keep their own existing real entry points, untouched).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { resolveCapability } from './registry';
import { createExecutionContext } from './context';
import { runLiveRepositoryResearch } from './research';
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
  type CanonicalReceiptPayload,
  listWorkspaceTasks,
  listGraphs,
  listGraphRuns,
  listWorkspaceReceipts,
  projectKnowledgeCandidate,
  getTaskWithHistory,
  getTaskArtifacts,
  getTaskReceipts,
  verifyReceipt,
  acquireExecutionClaim,
  resolveExecutionClaim,
  type ExecutionClaimRecord,
  type ScheduleRecord,
} from '../persistence';
import { verifyTaskAtGate } from '../kil-gate';
import { indexVaultArtifact, searchWorkspaceMemory } from '../memory-index';
import { writeWorkspaceArtifact, listWorkspaceVaultEntries } from '../vault';
import * as windmillClient from '../windmill-client';
import { listWorkspaceExternalExecutions } from '../external-executions';

export type EnvelopeOutcome = 'SUCCESS' | 'READ_OK' | 'BLOCKED' | 'NOT_CONFIGURED' | 'APPROVAL_REQUIRED' | 'FAILED' | 'IN_PROGRESS' | 'CONFLICT';

export interface ExecutionEnvelopeInput {
  workspaceId: string;
  actorUserId: string;
  /** A registry key (lib/fabric/registry.ts) — the caller must have already resolved this via classifyIntent(). */
  capability: string;
  action: string;
  parameters: Record<string, unknown>;
  /** The original request text. Used only as content/query input for capabilities that need it (research query, a note's body) — never persisted beyond what that capability would honestly record. */
  rawText: string;
  /**
   * STEP 6 corrective pass (B2) — reuses the same real check-before-execute
   * idempotency pattern lib/external-executions.ts's submitExternalExecution
   * (Q1) already established for Windmill submissions, applied here via the
   * canonical task table instead of a second, Jarvis-specific ledger: when
   * supplied, a real prior task with the same derived id short-circuits to
   * ITS already-recorded outcome (real receipt/artifact from the DB) rather
   * than re-executing. Optional — a caller with no meaningful key (a plain
   * READ) simply gets normal, unguarded execution.
   */
  idempotencyKey?: string;
}

export interface ExecutionEnvelopeResult {
  outcome: EnvelopeOutcome;
  capability: string;
  reason: string;
  data?: unknown;
  taskId?: string;
  artifact?: { id: string; path: string; contentHash: string } | null;
  aegis?: { decision: string; score: number | null } | null;
  receipt?: { receiptId: string; verified: boolean } | null;
  toolsInvoked?: string[];
  /** STEP 7 — present only for capability 'schedule': the real, persisted schedule this call created (or attempted to). Never fabricated when creation was refused. */
  schedule?: ScheduleRecord;
}

// EXTERNAL_ACTION capabilities Jarvis (or any envelope caller) may still
// execute despite approvalPolicy !== 'GUARDIAN_ENFORCED' — an explicit,
// narrow, named exception, not a general weakening of Section 7's rule.
// vault.write's current canonical policy (Step 2/4: POST /api/vault/notes
// writes directly, no Aegis/receipt/approval gate) already treats a
// caller's own workspace as approval-free; recorded here rather than
// silently special-cased inline in the dispatch switch below.
export const EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE = new Set<string>(['vault.write']);

export async function executeEnvelope(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const capability = await resolveCapability(input.capability);

  if (!capability) {
    return { outcome: 'NOT_CONFIGURED', capability: input.capability, reason: `"${input.capability}" is not a registered capability.` };
  }

  // Section 9 — honest NOT_CONFIGURED/UNSUPPORTED, never fabricated success.
  if (capability.status === 'NOT_CONFIGURED' || capability.status === 'UNSUPPORTED') {
    return { outcome: 'NOT_CONFIGURED', capability: capability.key, reason: capability.reason };
  }

  // Section 7 — advisory risk policy is never treated as permission. An
  // EXTERNAL_ACTION capability without real, wired Guardian enforcement is
  // refused outright, regardless of what classifyIntent() decided.
  if (
    capability.effectClass === 'EXTERNAL_ACTION' &&
    capability.approvalPolicy !== 'GUARDIAN_ENFORCED' &&
    !EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.has(capability.key)
  ) {
    return {
      outcome: 'BLOCKED',
      capability: capability.key,
      reason: `"${capability.key}" is an external action without real, wired Guardian enforcement (approvalPolicy: ${capability.approvalPolicy}) — refusing rather than executing on advisory policy alone.`,
    };
  }

  // terminal.exec-shaped: the registry itself reports APPROVAL_REQUIRED
  // because real enforcement (checkGuardianRules) exists but is
  // per-command, not resolvable ahead of a specific command string here.
  // No natural-language pattern in lib/fabric/intent.ts maps to
  // terminal.exec in Step 6 — this branch exists so a future caller that
  // does route here still gets an honest deferral, never a bypass.
  if (capability.status === 'APPROVAL_REQUIRED') {
    return { outcome: 'APPROVAL_REQUIRED', capability: capability.key, reason: capability.reason };
  }

  switch (capability.key) {
    case 'task.read':
      return { outcome: 'READ_OK', capability: capability.key, reason: 'Real workspace-scoped task list.', data: listWorkspaceTasks(input.workspaceId, 10) };
    case 'graph.read':
      return {
        outcome: 'READ_OK',
        capability: capability.key,
        reason: 'Real workspace-scoped graph/run list.',
        data: { graphs: listGraphs(input.workspaceId), runs: listGraphRuns(input.workspaceId) },
      };
    case 'receipt.read':
      return { outcome: 'READ_OK', capability: capability.key, reason: 'Real workspace-scoped receipt list.', data: listWorkspaceReceipts(input.workspaceId, 5) };
    case 'vault.read':
      return { outcome: 'READ_OK', capability: capability.key, reason: 'Real workspace-scoped Vault listing.', data: listWorkspaceVaultEntries(input.workspaceId, 50) };
    case 'memory.search':
      return {
        outcome: 'READ_OK',
        capability: capability.key,
        reason: 'Real FTS5 memory search.',
        data: searchWorkspaceMemory(input.workspaceId, String(input.parameters.query || input.rawText), 20),
      };
    case 'windmill.read':
      return executeWindmillRead(input);
    case 'vault.write':
      return executeVaultWrite(input);
    case 'research':
      return executeResearch(input);
    case 'schedule':
      return executeSchedule(input);
    default:
      // A registered, AVAILABLE capability with no wired executor here —
      // honest, never a fabricated attempt.
      return { outcome: 'NOT_CONFIGURED', capability: capability.key, reason: `No executor is wired for capability "${capability.key}" through the envelope yet.` };
  }
}

async function executeWindmillRead(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const lower = input.rawText.toLowerCase();
  const wantsHealth = /\b(status|connect(ed|ivity)?|health)\b/.test(lower);
  if (wantsHealth) {
    const health = await windmillClient.health();
    return { outcome: 'READ_OK', capability: 'windmill.read', reason: 'Real, on-demand Windmill health probe.', data: health };
  }
  const executions = listWorkspaceExternalExecutions(input.workspaceId, 10);
  return { outcome: 'READ_OK', capability: 'windmill.read', reason: 'Real workspace-scoped external-execution list.', data: executions };
}

/** Canonical policy already approved for vault.write (Step 2/4): direct write, no Aegis/receipt, no extra approval. */
// STEP 6 corrective pass (B2) — reuses the real task table as the
// idempotency ledger (same pattern lib/external-executions.ts's
// submitExternalExecution Q1 check already established: look up a real
// existing record before doing any real work, short-circuit to its
// already-recorded outcome). No second, Jarvis-specific idempotency
// system is created.
export function deriveIdempotentTaskId(prefix: string, idempotencyKey?: string): string {
  if (idempotencyKey && idempotencyKey.trim()) {
    const safe = idempotencyKey.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    return `jarvis-${prefix}-${safe}`;
  }
  return `jarvis-${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * PRE-CONCURRENCY-FIX gate, preserved as-is and still directly unit-tested
 * (test/jarvis-duplicate-submission.test.ts). It only ever READS task
 * state and is no longer the primary duplicate gate for research/
 * vault.write — see the STEP 6 concurrent-idempotency corrective pass
 * below (withAtomicClaim). Kept because it is real, correct, tested
 * behavior for a caller that already has a task row and wants to check its
 * terminal status; it is simply insufficient on its own against true
 * concurrency, since no row exists yet for the very first of several
 * simultaneous callers to inspect.
 */
export function checkIdempotentTask(taskId: string, capability: string, idempotencyKey?: string): ExecutionEnvelopeResult | null {
  if (!idempotencyKey) return null;
  const existing = getTaskWithHistory(taskId);
  if (!existing.task) return null;

  if (existing.task.status === 'DONE') {
    return replayFromTask(taskId, capability);
  }
  if (existing.task.status === 'FAILED') {
    return {
      outcome: 'FAILED',
      capability,
      reason: 'This request already failed previously — duplicate submission ignored, not retried automatically.',
      taskId,
    };
  }
  // Any other in-progress-looking status: refuse rather than race a
  // concurrent execution under the same key.
  return {
    outcome: 'BLOCKED',
    capability,
    reason: 'A request with this same idempotency key is already being processed.',
    taskId,
  };
}

/**
 * Builds the SUCCESS replay result from whatever real artifact/receipt
 * already exist for taskId — independent of whether a `tasks` row exists
 * (vault.write never creates one; research does). Never touches a
 * provider/tool; this is a pure read of already-recorded evidence.
 */
function replayFromTask(taskId: string, capability: string): ExecutionEnvelopeResult {
  const artifacts = getTaskArtifacts(taskId);
  const receipts = getTaskReceipts(taskId);
  const artifact = artifacts[artifacts.length - 1];
  const receipt = receipts[receipts.length - 1];
  return {
    outcome: 'SUCCESS',
    capability,
    reason: 'Already completed for this request — duplicate submission ignored, not re-executed.',
    taskId,
    artifact: artifact ? { id: artifact.artifact_id, path: artifact.relative_path, contentHash: artifact.content_hash } : null,
    receipt: receipt ? { receiptId: receipt.receipt_id, verified: verifyReceipt(receipt) } : null,
  };
}

/** Deterministic hash of the request identity a duplicate idempotency key must match to be treated as a replay rather than a conflict. */
export function hashRequestPayload(capability: string, rawText: string, parameters: Record<string, unknown>): string {
  const canonical = canonicalizePayload({ capability, rawText, parameters: JSON.stringify(parameters ?? {}) });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * STEP 6 concurrent-idempotency corrective pass — the actual fix.
 *
 * EXACT RACE this closes: executeResearch/executeVaultWrite used to call
 * checkIdempotentTask() (a pure read of the `tasks` table) BEFORE any real
 * work, then only write a durable task row at the very end, inside
 * commitEvidencedArtifact -> createInitialTask, AFTER the real GitHub
 * Search + Gemini calls had already completed. Every concurrent caller
 * that arrived before that final write read "no task yet" and proceeded —
 * proven live: three simultaneous requests with the same idempotency key
 * produced three real github.search calls, three real model.gemini calls,
 * three artifacts, three receipts, all sharing one derived taskId.
 *
 * The fix moves the durable claim to the very top, as a real INSERT into
 * execution_claims guarded by a UNIQUE(workspace_id, actor_user_id,
 * capability, idempotency_key) constraint (see acquireExecutionClaim in
 * lib/persistence.ts) — attempted before `run` (the real work) is ever
 * invoked. There is no read-then-write gap: the INSERT either succeeds
 * (this call owns execution) or fails on the UNIQUE constraint (another
 * call already owns or has finished it), and SQLite's own constraint
 * enforcement decides which, not application logic.
 *
 * In-flight duplicate behavior (chosen: option B from the spec, a
 * structured result, not a bounded wait/poll): a concurrent duplicate
 * that loses the race gets IN_PROGRESS immediately. A bounded-wait/poll
 * loop was considered and rejected — it adds a real timeout policy this
 * deployment doesn't need (the client already disables its own submit
 * button while in flight; this is the second, independent line of
 * defense for a voice+button race, a second tab, or a retried network
 * request, not the primary UX path), and "do not wait indefinitely" plus
 * "do not fabricate a successful result before A finishes" already rule
 * out the alternative's two ways of going wrong.
 */
async function withAtomicClaim(
  input: ExecutionEnvelopeInput,
  capability: string,
  taskId: string,
  run: () => Promise<ExecutionEnvelopeResult>,
): Promise<ExecutionEnvelopeResult> {
  if (!input.idempotencyKey) {
    // No meaningful key supplied — unguarded execution, same as every
    // capability that never opts into idempotency at all.
    return run();
  }

  const payloadHash = hashRequestPayload(capability, input.rawText, input.parameters);
  const acquisition = acquireExecutionClaim({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    capability,
    idempotencyKey: input.idempotencyKey,
    payloadHash,
    taskId,
  });

  if (acquisition.outcome === 'EXISTS') {
    const claim: ExecutionClaimRecord = acquisition.claim;
    if (claim.payload_hash !== payloadHash) {
      // Same idempotency key, different request — never treated as an
      // accidental duplicate, and never executed either.
      return {
        outcome: 'CONFLICT',
        capability,
        reason: 'This idempotency key was already used for a different request — refusing rather than executing it as an accidental duplicate.',
        taskId: claim.task_id,
      };
    }
    if (claim.status === 'CLAIMED') {
      return {
        outcome: 'IN_PROGRESS',
        capability,
        reason: 'A request with this same idempotency key is already executing — not re-executed.',
        taskId: claim.task_id,
      };
    }
    if (claim.status === 'FAILED') {
      // Preserves the existing approved failure semantics: a failed
      // consequential request is never silently retried.
      return {
        outcome: 'FAILED',
        capability,
        reason: 'This request already failed previously — duplicate submission ignored, not retried automatically.',
        taskId: claim.task_id,
      };
    }
    // DONE — replay the real, already-recorded evidence. No provider/tool
    // call, no new artifact, no new Aegis review, no new receipt.
    return replayFromTask(claim.task_id, capability);
  }

  // ACQUIRED — this call owns execution. try/finally guarantees the claim
  // always reaches a terminal state (DONE or FAILED) even on an
  // unanticipated exception, so it is never left CLAIMED while this
  // process is still alive (see the startup reconciliation in
  // lib/persistence.ts for the only remaining case: a hard process crash).
  try {
    const result = await run();
    resolveExecutionClaim(acquisition.claim.claim_id, result.outcome === 'FAILED' ? 'FAILED' : 'DONE');
    return result;
  } catch (err) {
    resolveExecutionClaim(acquisition.claim.claim_id, 'FAILED');
    throw err;
  }
}

async function executeVaultWrite(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const taskId = deriveIdempotentTaskId('vault', input.idempotencyKey);
  return withAtomicClaim(input, 'vault.write', taskId, async () => {
    const content = `# Jarvis Note\n\n${input.rawText}\n`;
    const artifact = writeWorkspaceArtifact({ workspaceId: input.workspaceId, taskId, content, folder: 'Jarvis-Notes', extension: 'md' });
    try {
      indexVaultArtifact(input.workspaceId, artifact.artifact_id);
    } catch {
      /* non-blocking */
    }
    return {
      outcome: 'SUCCESS',
      capability: 'vault.write',
      reason: 'Saved to the Vault.',
      taskId,
      artifact: { id: artifact.artifact_id, path: artifact.relative_path, contentHash: artifact.content_hash },
    };
  });
}

async function executeResearch(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const taskId = deriveIdempotentTaskId('research', input.idempotencyKey);

  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    // A static deployment condition, not an execution race — checked
    // before the atomic claim so a transient "not configured" state can
    // never permanently consume a claim under a key the caller might
    // legitimately retry once the deployment is configured.
    return { outcome: 'NOT_CONFIGURED', capability: 'research', reason: 'GEMINI_API_KEY is not configured — the synthesis step requires a real Gemini call.' };
  }

  return withAtomicClaim(input, 'research', taskId, async () => {
    const ctx = createExecutionContext({ workspaceId: input.workspaceId });
    let result;
    try {
      result = await runLiveRepositoryResearch({ apiKey, query: input.rawText }, ctx);
    } catch (err: any) {
      // A5 — a GitHub rate-limit exhaustion (or any other real failure,
      // including a failed synthesis call) is reported as a structured,
      // honest failure. No retry, no sleep, no fallback to stale data.
      const reason = err?.name === 'GithubRateLimitError'
        ? `GitHub API rate limit reached: ${err.message}`
        : `Live research failed: ${err?.message || String(err)}`;
      return {
        outcome: 'FAILED',
        capability: 'research',
        reason,
        toolsInvoked: ctx.getInvocations().map((r) => r.name),
      };
    }

    if (result.repos.length === 0) {
      // No real live evidence came back — refuse rather than let this look
      // like a satisfied research request.
      return {
        outcome: 'FAILED',
        capability: 'research',
        reason: 'GitHub Search returned no resolvable repositories for this query.',
        toolsInvoked: ctx.getInvocations().map((r) => r.name),
      };
    }

    return commitEvidencedArtifact({
      taskId,
      workspaceId: input.workspaceId,
      title: `Research — ${result.query.slice(0, 80)}`,
      description: `Live research: ${result.query}`,
      assignedAgent: 'research',
      content: result.reportMarkdown,
      folder: 'Research',
      toolsInvoked: ctx.getInvocations().map((r) => r.name),
    });
  });
}

/**
 * The one real task/artifact/Aegis/receipt lifecycle shared by every
 * envelope capability that needs it (today: research only). Mirrors
 * lib/fabric/kernel.ts's SUCCESS path exactly — same primitives, same
 * order, same status sequence — because that sequence is what
 * runDeterministicAegisVerification()'s own checks require (task exists,
 * PROVIDER_COMPLETED/ARTIFACT_SAVED events, TODO->READY->RUNNING->
 * AWAITING_VERIFICATION history). Not a second kernel: it reuses the exact
 * same persistence/Aegis/receipt/KIL/memory-index functions kernel.ts and
 * server.ts's graph-run aggregate path already call.
 */
async function commitEvidencedArtifact(params: {
  taskId: string;
  workspaceId: string;
  title: string;
  description: string;
  assignedAgent: string;
  content: string;
  folder: string;
  toolsInvoked: string[];
}): Promise<ExecutionEnvelopeResult> {
  const taskId = params.taskId;
  const nowIso = new Date().toISOString();

  createInitialTask({
    taskId,
    workspaceId: params.workspaceId,
    title: params.title,
    description: params.description,
    assignedAgent: params.assignedAgent,
    assignedModel: 'multi',
    createdAt: nowIso,
  });
  recordActivityEvent({ taskId, expectedWorkspaceId: params.workspaceId, eventType: 'TASK_CREATED', agentId: 'orchestrator', payload: { title: params.title, status: 'TODO' }, createdAt: nowIso });
  updateTaskStatus(taskId, 'READY', undefined, params.workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: params.workspaceId, eventType: 'AGENT_ASSIGNED', agentId: params.assignedAgent, payload: { agent: params.assignedAgent, model: 'multi', status: 'READY' } });
  updateTaskStatus(taskId, 'RUNNING', undefined, params.workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: params.workspaceId, eventType: 'EXECUTION_STARTED', agentId: params.assignedAgent, payload: { status: 'RUNNING' } });
  recordActivityEvent({ taskId, expectedWorkspaceId: params.workspaceId, eventType: 'PROVIDER_COMPLETED', agentId: params.assignedAgent, payload: { model: 'multi', outputLength: params.content.length } });

  const persistedArtifact = writeWorkspaceArtifact({ workspaceId: params.workspaceId, taskId, content: params.content, folder: params.folder, extension: 'md', createdAt: nowIso });
  recordActivityEvent({
    taskId,
    expectedWorkspaceId: params.workspaceId,
    eventType: 'ARTIFACT_SAVED',
    agentId: params.assignedAgent,
    payload: {
      artifactId: persistedArtifact.artifact_id,
      relativePath: persistedArtifact.relative_path,
      diskPath: persistedArtifact.disk_path,
      contentHash: persistedArtifact.content_hash,
      sizeBytes: persistedArtifact.size_bytes,
    },
    createdAt: nowIso,
  });

  updateTaskStatus(taskId, 'AWAITING_VERIFICATION', undefined, params.workspaceId);
  const aegisResult = runDeterministicAegisVerification(taskId, params.content);
  const persistedReview = recordQualityReview({
    taskId,
    reviewer: aegisResult.reviewer,
    method: aegisResult.method,
    score: aegisResult.score,
    decision: aegisResult.decision,
    checks: aegisResult.checks,
    evidence: aegisResult.evidence,
    createdAt: nowIso,
  });

  if (aegisResult.decision !== 'VERIFIED') {
    updateTaskStatus(taskId, 'FAILED', undefined, params.workspaceId);
    recordActivityEvent({
      taskId,
      expectedWorkspaceId: params.workspaceId,
      eventType: 'AEGIS_REVIEWED',
      agentId: 'aegis',
      payload: { reviewId: persistedReview.review_id, decision: aegisResult.decision, score: aegisResult.score },
      createdAt: nowIso,
    });
    return {
      outcome: 'FAILED',
      capability: params.assignedAgent,
      reason: `Aegis did not verify the result (${aegisResult.decision}).`,
      taskId,
      artifact: { id: persistedArtifact.artifact_id, path: persistedArtifact.relative_path, contentHash: persistedArtifact.content_hash },
      aegis: { decision: aegisResult.decision, score: aegisResult.score },
      toolsInvoked: params.toolsInvoked,
    };
  }

  updateTaskStatus(taskId, 'AWAITING_RECEIPT', undefined, params.workspaceId);
  recordActivityEvent({
    taskId,
    expectedWorkspaceId: params.workspaceId,
    eventType: 'AEGIS_REVIEWED',
    agentId: 'aegis',
    payload: { reviewId: persistedReview.review_id, decision: 'VERIFIED', score: aegisResult.score, checks: aegisResult.checks },
    createdAt: nowIso,
  });

  const receiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const canonicalPayload: CanonicalReceiptPayload = {
    receiptId,
    taskId,
    reviewId: persistedReview.review_id,
    workspaceId: params.workspaceId,
    assignedAgent: params.assignedAgent,
    provider: 'synthos-jarvis-envelope',
    modelUsed: params.toolsInvoked.join(',') || 'none',
    artifactId: persistedArtifact.artifact_id,
    artifactHash: persistedArtifact.content_hash,
    aegisDecision: aegisResult.decision,
    aegisMethod: aegisResult.method,
    createdAt: nowIso,
  };
  const canonicalPayloadStr = canonicalizePayload(canonicalPayload);
  const { signature, publicKeyPem, algorithm, fingerprint } = signReceiptPayload(canonicalPayloadStr);
  const verified = verifyReceiptSignature(canonicalPayloadStr, signature, publicKeyPem);

  if (!verified) {
    updateTaskStatus(taskId, 'FAILED', undefined, params.workspaceId);
    recordActivityEvent({
      taskId,
      expectedWorkspaceId: params.workspaceId,
      eventType: 'RECEIPT_VERIFICATION_FAILED',
      agentId: 'guardian',
      payload: { reviewId: persistedReview.review_id },
      createdAt: nowIso,
    });
    return {
      outcome: 'FAILED',
      capability: params.assignedAgent,
      reason: 'Receipt signature verification failed.',
      taskId,
      artifact: { id: persistedArtifact.artifact_id, path: persistedArtifact.relative_path, contentHash: persistedArtifact.content_hash },
      aegis: { decision: aegisResult.decision, score: aegisResult.score },
      toolsInvoked: params.toolsInvoked,
    };
  }

  recordReceipt({ receiptId, taskId, reviewId: persistedReview.review_id, algorithm, publicKey: publicKeyPem, payloadJson: canonicalPayloadStr, signature, createdAt: nowIso });
  recordActivityEvent({
    taskId,
    expectedWorkspaceId: params.workspaceId,
    eventType: 'RECEIPT_CREATED',
    agentId: 'guardian',
    payload: { receiptId, algorithm, fingerprint, signature, verified: true },
    createdAt: nowIso,
  });
  updateTaskStatus(taskId, 'DONE', undefined, params.workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: params.workspaceId, eventType: 'TASK_COMPLETED', agentId: params.assignedAgent, payload: { receiptId, status: 'DONE' }, createdAt: nowIso });

  // KIL — isolated in its own try/catch: never affects task/receipt outcome, same posture as kernel.ts.
  try {
    const gate = verifyTaskAtGate({
      taskId,
      workspaceId: params.workspaceId,
      title: params.title,
      description: params.description,
      groundingContext: params.content.slice(0, 4000),
      assignedAgent: params.assignedAgent,
      output: params.content,
    });
    if (gate.observation.promoted) {
      try {
        projectKnowledgeCandidate({
          workspaceId: params.workspaceId,
          taskId,
          kilObservationId: gate.observation.observation_id,
          receiptId,
          vaultPath: persistedArtifact.relative_path,
          label: params.title,
        });
      } catch {
        /* non-blocking */
      }
    }
  } catch {
    /* non-blocking */
  }
  try {
    indexVaultArtifact(params.workspaceId, persistedArtifact.artifact_id);
  } catch {
    /* non-blocking */
  }

  return {
    outcome: 'SUCCESS',
    capability: params.assignedAgent,
    reason: 'Verified and receipted.',
    taskId,
    artifact: { id: persistedArtifact.artifact_id, path: persistedArtifact.relative_path, contentHash: persistedArtifact.content_hash },
    aegis: { decision: aegisResult.decision, score: aegisResult.score },
    receipt: { receiptId, verified: true },
    toolsInvoked: params.toolsInvoked,
  };
}

/**
 * STEP 7 — creates a real, persisted schedule from natural language. This
 * is the ONLY place envelope.ts imports lib/fabric/scheduler.ts, and it
 * does so lazily (dynamic import, resolved at call time, not module-load
 * time) specifically to avoid a static circular import: scheduler.ts
 * itself imports executeEnvelope from this file to actually FIRE a due
 * occurrence. The cycle is real in the dependency graph but never a
 * load-order problem, because by the time this function is ever called,
 * both modules have already fully loaded.
 *
 * Deliberately does NOT call a provider, write a Vault artifact, or sign a
 * receipt — creating a schedule is a CONTROL action; the real work happens
 * later, through this exact same executeEnvelope() dispatcher, when
 * lib/fabric/scheduler.ts's tick loop calls it again for the due occurrence.
 */
async function executeSchedule(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const { executeScheduleFromNaturalLanguage } = await import('./scheduler');
  return executeScheduleFromNaturalLanguage({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    rawText: input.rawText,
  });
}
