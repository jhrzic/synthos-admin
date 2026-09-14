// ---------------------------------------------------------------------------
// SynthOS Development Loop — the backend contract that removes the manual
// copy/paste between a reasoning seat and an execution runtime.
//
// THE FLOW THIS SERVES
//
//   development task
//     -> scoped Brain/project context
//     -> OpenAI review/plan
//     -> Guardian
//     -> Antigravity execution
//     -> durable advancement to completion
//     -> Aegis + KIL gate
//     -> receipt
//     -> activity/knowledge writeback
//     -> ready for the next task
//
// WHAT THIS FILE IS NOT. It is not a second execution engine, a second task
// ledger, a second scheduler or a second Brain. Every step below delegates:
// context comes from searchWorkspaceMemory (the existing FTS5 index),
// review from the existing model router + OpenAI adapter, execution from
// submitExternalExecution (the existing ledger), advancement from the
// existing scheduler sweep, and verification/receipts from the existing
// ingestion spine. This file only sequences them and records where a task
// has got to.
//
// WHY A development_tasks TABLE RATHER THAN tasks.status
//
// The canonical execution vocabulary — TODO, READY, RUNNING,
// AWAITING_VERIFICATION, AWAITING_RECEIPT, DONE, FAILED — describes ONE
// execution's lifecycle. It genuinely cannot express WAITING_FOR_REVIEW or
// WAITING_FOR_APPROVAL, because both occur before any execution exists.
// Overloading tasks.status with them would corrupt a vocabulary that the
// Kanban board, receipts and every other surface already read. So the loop
// state lives in its own small extension row that POINTS AT the canonical
// task, exactly as external_executions does — the task still owns the
// artifacts, the Aegis review and the receipt.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase, recordActivityEvent } from './persistence';
import { searchWorkspaceMemory, type MemorySearchResult } from './memory-index';
import { classifyModelRequest, resolveDefaultOpenAiModel, explainUnroutableModel } from './model-router';
import { resolveModelApiKey } from './model-credentials';
import { generateViaOpenAI } from './fabric/model-openai';
import {
  submitExternalExecution, getWorkspaceExternalExecution, guardianCheckInstruction,
  type ExternalExecutionRecord,
} from './external-executions';
import { createExecutionContext } from './fabric/context';

/**
 * The loop's own vocabulary. Deliberately distinct from, and never an alias
 * of, the canonical task status — see the header. Every value here names a
 * state a development task can really be in.
 */
export type DevelopmentTaskState =
  | 'WAITING_FOR_REVIEW'
  | 'READY_FOR_EXECUTION'
  | 'WAITING_FOR_APPROVAL'
  | 'RUNNING'
  | 'VERIFIED'
  | 'FAILED'
  | 'BLOCKED';

export interface DevelopmentTaskRecord {
  dev_task_id: string;
  workspace_id: string;
  task_id: string | null;
  title: string;
  instruction: string;
  state: DevelopmentTaskState;
  state_reason: string | null;
  requires_review: number;
  requires_approval: number;
  review_provider: string | null;
  review_model: string | null;
  review_text: string | null;
  review_at: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  execution_id: string | null;
  result_artifact_id: string | null;
  result_receipt_id: string | null;
  aegis_decision: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

function row(devTaskId: string): DevelopmentTaskRecord | null {
  return (getDatabase().prepare('SELECT * FROM development_tasks WHERE dev_task_id = ?').get(devTaskId) as DevelopmentTaskRecord) || null;
}

/** Workspace-scoped lookup — an id from another workspace is indistinguishable from an unknown one, the same non-disclosure posture as tasks and executions. */
export function getWorkspaceDevelopmentTask(workspaceId: string, devTaskId: string): DevelopmentTaskRecord | null {
  const record = row(devTaskId);
  return record && record.workspace_id === workspaceId ? record : null;
}

export function listWorkspaceDevelopmentTasks(workspaceId: string, limit = 50): DevelopmentTaskRecord[] {
  const bounded = Math.min(Math.max(limit, 1), 200);
  return getDatabase()
    .prepare('SELECT * FROM development_tasks WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, bounded) as DevelopmentTaskRecord[];
}

function patch(devTaskId: string, fields: Record<string, unknown>): DevelopmentTaskRecord {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDatabase()
    .prepare(`UPDATE development_tasks SET ${sets}, updated_at = ? WHERE dev_task_id = ?`)
    .run(...keys.map((k) => fields[k] as never), new Date().toISOString(), devTaskId);
  return row(devTaskId)!;
}

/**
 * The initial state is decided by the task's own requirements, never
 * defaulted optimistically: a task that needs review starts waiting for it.
 */
export function createDevelopmentTask(params: {
  workspaceId: string;
  createdByUserId: string;
  title: string;
  instruction: string;
  requiresReview?: boolean;
  requiresApproval?: boolean;
}): DevelopmentTaskRecord {
  const title = String(params.title || '').trim();
  const instruction = String(params.instruction || '').trim();
  if (!title) throw Object.assign(new Error('A title is required.'), { code: 'INVALID_INPUT' });
  if (!instruction) throw Object.assign(new Error('An instruction is required.'), { code: 'INVALID_INPUT' });

  const requiresReview = params.requiresReview !== false;
  const requiresApproval = params.requiresApproval !== false;
  const now = new Date().toISOString();
  const devTaskId = `dev-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const state: DevelopmentTaskState = requiresReview
    ? 'WAITING_FOR_REVIEW'
    : requiresApproval
      ? 'WAITING_FOR_APPROVAL'
      : 'READY_FOR_EXECUTION';

  getDatabase().prepare(`
    INSERT INTO development_tasks (
      dev_task_id, workspace_id, task_id, title, instruction, state, state_reason,
      requires_review, requires_approval, review_provider, review_model, review_text, review_at,
      approved_by_user_id, approved_at, execution_id, result_artifact_id, result_receipt_id,
      aegis_decision, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(devTaskId, params.workspaceId, title, instruction, state, requiresReview ? 1 : 0, requiresApproval ? 1 : 0, params.createdByUserId, now, now);

  return row(devTaskId)!;
}

// ---------------------------------------------------------------------------
// BRAIN CONTEXT — scoped, never a Vault dump.
// ---------------------------------------------------------------------------

export interface DevelopmentContextItem {
  artifactId: string;
  title: string;
  path: string;
  excerpt: string;
}

export interface DevelopmentContext {
  items: DevelopmentContextItem[];
  /** Real reason the context is what it is — including when it is empty. */
  reason: string;
}

/** Bounds, stated as constants so the prompt size is a decision rather than an accident. */
export const MAX_CONTEXT_ITEMS = 6;
export const MAX_CONTEXT_CHARS_PER_ITEM = 900;

/**
 * Retrieve only what is relevant to THIS task, from the existing workspace
 * memory index. Deliberately bounded on both axes: handing a reasoning model
 * the whole Vault costs real money, buries the relevant passage, and leaks
 * unrelated workspace content into a provider request.
 *
 * An empty result is reported honestly rather than back-filled with
 * something less relevant.
 */
export function buildDevelopmentContext(workspaceId: string, query: string): DevelopmentContext {
  let hits: MemorySearchResult[] = [];
  try {
    hits = searchWorkspaceMemory(workspaceId, query, MAX_CONTEXT_ITEMS);
  } catch {
    return { items: [], reason: 'The workspace memory index is not reachable; no project context was attached.' };
  }

  if (hits.length === 0) {
    return { items: [], reason: 'No indexed project knowledge matched this task. The review proceeds on the instruction alone.' };
  }

  const items = hits.map((h) => ({
    artifactId: h.artifact_id,
    title: h.title,
    path: h.source_path,
    excerpt: String(h.snippet || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTEXT_CHARS_PER_ITEM),
  }));
  return { items, reason: `${items.length} scoped project knowledge item(s) from this workspace's memory index.` };
}

// ---------------------------------------------------------------------------
// OPENAI REVIEW SEAT
// ---------------------------------------------------------------------------

export type ReviewOutcome = 'REVIEWED' | 'NOT_CONFIGURED' | 'FAILED';

export interface DevelopmentReviewResult {
  outcome: ReviewOutcome;
  provider: string | null;
  model: string | null;
  reviewText: string | null;
  reason: string;
  contextItems: number;
}

export function buildReviewPrompt(task: DevelopmentTaskRecord, context: DevelopmentContext): string {
  const contextBlock = context.items.length === 0
    ? '(no indexed project knowledge matched this task)'
    : context.items.map((c, i) => `[${i + 1}] ${c.title} (${c.path})\n${c.excerpt}`).join('\n\n');

  return [
    'You are the review seat in an automated software development loop.',
    'You are reviewing a task that is about to be executed by an autonomous coding agent in a sandbox.',
    '',
    `TASK: ${task.title}`,
    `INSTRUCTION TO BE EXECUTED:\n${task.instruction}`,
    '',
    'SCOPED PROJECT CONTEXT (the only project knowledge you have been given):',
    contextBlock,
    '',
    'Produce a concise review in Markdown with exactly these sections:',
    '1. Assessment — is this instruction clear, bounded and safe to execute?',
    '2. Risks — what could go wrong, including anything the instruction leaves ambiguous.',
    '3. Recommended execution plan — the concrete steps the agent should take.',
    '4. Verdict — one line, either PROCEED or DO NOT PROCEED, with the reason.',
    '',
    'Do not invent project facts that are not in the context above. If the context is insufficient, say so explicitly in Risks.',
  ].join('\n');
}

/**
 * Run the review through the EXISTING provider system: the same router that
 * decides provider identity, the same credential resolution, and the same
 * adapter the Execution Fabric uses. No private provider ladder.
 *
 * With no credential this returns NOT_CONFIGURED and the task keeps its
 * state — it is never silently routed to Gemini, and it is never marked
 * reviewed.
 */
export async function requestDevelopmentReview(
  workspaceId: string,
  devTaskId: string,
  preferredModel?: string
): Promise<DevelopmentReviewResult> {
  const task = getWorkspaceDevelopmentTask(workspaceId, devTaskId);
  if (!task) throw Object.assign(new Error('Development task not found.'), { code: 'NOT_FOUND' });

  const classified = classifyModelRequest(preferredModel || resolveDefaultOpenAiModel());
  if (classified.provider !== 'OPENAI') {
    return {
      outcome: 'NOT_CONFIGURED', provider: null, model: null, reviewText: null, contextItems: 0,
      reason: explainUnroutableModel(classified, 'the development-loop review seat'),
    };
  }

  const { apiKey } = resolveModelApiKey('openai');
  if (!apiKey) {
    return {
      outcome: 'NOT_CONFIGURED', provider: 'openai', model: classified.resolvedModel, reviewText: null, contextItems: 0,
      reason: 'No OpenAI credential is configured — neither OPENAI_API_KEY nor an encrypted server-side credential row is present. The task keeps its current state; no other provider was substituted.',
    };
  }

  const context = buildDevelopmentContext(workspaceId, `${task.title} ${task.instruction}`);
  const ctx = createExecutionContext({ workspaceId });
  const generated = await ctx.invoke('model.openai', () => generateViaOpenAI({
    apiKey,
    contents: buildReviewPrompt(task, context),
    candidateModels: [classified.resolvedModel],
  }));

  if (!generated.output.trim()) {
    return {
      outcome: 'FAILED', provider: 'openai', model: classified.resolvedModel, reviewText: null, contextItems: context.items.length,
      reason: generated.lastProviderError || 'The review provider returned no output.',
    };
  }

  const now = new Date().toISOString();
  const modelUsed = generated.modelUsed || classified.resolvedModel;
  patch(devTaskId, {
    review_provider: 'openai',
    review_model: modelUsed,
    review_text: generated.output,
    review_at: now,
    state: task.requires_approval ? 'WAITING_FOR_APPROVAL' : 'READY_FOR_EXECUTION',
    state_reason: `Reviewed by openai/${modelUsed}.`,
  });

  return {
    outcome: 'REVIEWED', provider: 'openai', model: modelUsed, reviewText: generated.output,
    contextItems: context.items.length,
    reason: `Reviewed against ${context.items.length} scoped context item(s). ${context.reason}`,
  };
}

/** Human approval. The one gate a model may never grant itself. */
export function approveDevelopmentTask(workspaceId: string, devTaskId: string, approverUserId: string): DevelopmentTaskRecord {
  const task = getWorkspaceDevelopmentTask(workspaceId, devTaskId);
  if (!task) throw Object.assign(new Error('Development task not found.'), { code: 'NOT_FOUND' });
  if (task.state !== 'WAITING_FOR_APPROVAL') {
    throw Object.assign(new Error(`Only a task waiting for approval can be approved; this one is ${task.state}.`), { code: 'INVALID_STATE' });
  }
  return patch(devTaskId, {
    approved_by_user_id: approverUserId,
    approved_at: new Date().toISOString(),
    state: 'READY_FOR_EXECUTION',
    state_reason: 'Approved by an operator.',
  });
}

// ---------------------------------------------------------------------------
// EXECUTION
// ---------------------------------------------------------------------------

export interface DevelopmentDispatchResult {
  task: DevelopmentTaskRecord;
  execution: ExternalExecutionRecord | null;
  reason: string;
}

/**
 * Hand an approved task to the execution runtime.
 *
 * Guardian is NOT re-implemented here: submitExternalExecution already runs
 * checkGuardianRules before any dispatch and refuses BLOCKED and
 * APPROVAL_REQUIRED. The explicit call below is a pre-flight so the task can
 * be recorded BLOCKED with a truthful reason instead of only throwing, and
 * it is the same single policy function — not a second one.
 */
export async function dispatchDevelopmentTask(
  workspaceId: string,
  devTaskId: string,
  actorUserId: string
): Promise<DevelopmentDispatchResult> {
  const task = getWorkspaceDevelopmentTask(workspaceId, devTaskId);
  if (!task) throw Object.assign(new Error('Development task not found.'), { code: 'NOT_FOUND' });
  if (task.state !== 'READY_FOR_EXECUTION') {
    throw Object.assign(new Error(`Only a task ready for execution can be dispatched; this one is ${task.state}.`), { code: 'INVALID_STATE' });
  }

  const guardian = guardianCheckInstruction(task.instruction);
  if (!guardian.allowed) {
    const blocked = patch(devTaskId, { state: 'BLOCKED', state_reason: guardian.error || 'Guardian refused this instruction.' });
    return { task: blocked, execution: null, reason: guardian.error || 'Guardian refused this instruction.' };
  }

  try {
    const { execution } = await submitExternalExecution({
      workspaceId,
      createdByUserId: actorUserId,
      runtime: 'antigravity',
      input: { instruction: task.instruction },
      idempotencyKey: `devtask:${devTaskId}`,
    });

    if (execution.status === 'FAILED') {
      const failed = patch(devTaskId, {
        execution_id: execution.id, state: 'FAILED',
        state_reason: execution.error_message_safe || 'Submission to the execution runtime failed.',
      });
      return { task: failed, execution, reason: failed.state_reason! };
    }

    const running = patch(devTaskId, {
      execution_id: execution.id, state: 'RUNNING',
      state_reason: `Dispatched to ${execution.runtime} (remote job ${execution.remote_job_id}). The scheduler advances it to completion.`,
    });
    return { task: running, execution, reason: running.state_reason! };
  } catch (err: any) {
    const isPolicy = err?.code === 'GUARDIAN_BLOCKED' || err?.code === 'RUNTIME_NOT_CONFIGURED';
    const blocked = patch(devTaskId, {
      state: 'BLOCKED',
      state_reason: String(err?.message || 'Dispatch failed.').slice(0, 500),
    });
    return { task: blocked, execution: null, reason: isPolicy ? blocked.state_reason! : `Dispatch failed: ${blocked.state_reason}` };
  }
}

// ---------------------------------------------------------------------------
// RECONCILIATION — the loop's only view of "has the execution finished".
// ---------------------------------------------------------------------------

/**
 * Bring a RUNNING task's state into line with its execution's REAL, already
 * persisted outcome.
 *
 * This never polls a provider and never ingests: the scheduler sweep owns
 * both. It only reads what the ledger already says, which is why calling it
 * repeatedly is safe and why it needs no lease of its own.
 *
 * Writeback happens exactly once, guarded on the task not already being in a
 * terminal loop state — so no duplicate activity event and no duplicate
 * knowledge candidate.
 */
export function reconcileDevelopmentTask(workspaceId: string, devTaskId: string): DevelopmentTaskRecord {
  const task = getWorkspaceDevelopmentTask(workspaceId, devTaskId);
  if (!task) throw Object.assign(new Error('Development task not found.'), { code: 'NOT_FOUND' });
  if (task.state !== 'RUNNING' || !task.execution_id) return task;

  const execution = getWorkspaceExternalExecution(workspaceId, task.execution_id);
  if (!execution) return task;

  if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(execution.status)) return task;

  if (execution.status !== 'SUCCEEDED') {
    return patch(devTaskId, {
      task_id: execution.task_id,
      state: 'FAILED',
      state_reason: execution.error_message_safe || `The execution ended ${execution.status}.`,
    });
  }

  if (!execution.result_ingested_at) {
    // Really succeeded remotely, but SynthOS has not yet turned it into
    // evidence. Still RUNNING as far as this loop is concerned — claiming
    // VERIFIED here would assert a verification that has not happened.
    return task;
  }

  const db = getDatabase();
  const review = execution.task_id
    ? (db.prepare('SELECT decision FROM quality_reviews WHERE task_id = ? ORDER BY rowid DESC LIMIT 1').get(execution.task_id) as { decision: string } | undefined)
    : undefined;

  const verified = Boolean(execution.result_receipt_id) && review?.decision === 'VERIFIED';
  const updated = patch(devTaskId, {
    task_id: execution.task_id,
    result_artifact_id: execution.result_artifact_id,
    result_receipt_id: execution.result_receipt_id,
    aegis_decision: review?.decision ?? null,
    state: verified ? 'VERIFIED' : 'FAILED',
    state_reason: verified
      ? 'Execution completed, Aegis verified the result, and a signed receipt was issued.'
      : `Execution completed but was not verified (Aegis: ${review?.decision ?? 'no review recorded'}). No receipt was issued.`,
  });

  writeBackDevelopmentCycle(updated, execution);
  return updated;
}

/**
 * The writeback for one completed cycle.
 *
 * WHAT THIS WRITES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It records the DECISION TRAIL — what was asked, who reviewed it, on which
 * model, who approved it, which runtime executed it, and how it was verified.
 * That is the part of a development cycle nothing else captures.
 *
 * It does NOT write the execution output to the Vault, and it does NOT
 * project a knowledge candidate. The ingestion spine already did both:
 * ingestExternalExecutionResult writes the artifact, indexes it into
 * memory_index, runs the KIL gate and — when that gate promotes the
 * observation — calls projectKnowledgeCandidate itself. Doing either here
 * would duplicate the text in the Vault and double-count it in the index.
 *
 * This was written the wrong way first and is recorded so it is not
 * re-introduced: an earlier draft called projectKnowledgeCandidate with null
 * kilObservationId/vaultPath. That function requires a real verified KIL
 * observation and a valid workspace-relative path, so every call would have
 * thrown into the catch below and written nothing — a permanently dead path
 * that looked like knowledge writeback in the code and produced none.
 *
 * Non-blocking by design: a telemetry failure must never change the
 * verified/failed outcome of real, receipted work.
 */
function writeBackDevelopmentCycle(task: DevelopmentTaskRecord, execution: ExternalExecutionRecord): void {
  if (!execution.task_id) return;

  try {
    recordActivityEvent({
      taskId: execution.task_id,
      expectedWorkspaceId: task.workspace_id,
      eventType: 'DEVELOPMENT_CYCLE_COMPLETED',
      agentId: 'development-loop',
      payload: {
        devTaskId: task.dev_task_id,
        title: task.title,
        state: task.state,
        reviewProvider: task.review_provider,
        reviewModel: task.review_model,
        reviewed: Boolean(task.review_at),
        approvedBy: task.approved_by_user_id,
        runtime: execution.runtime,
        remoteJobId: execution.remote_job_id,
        correlationId: execution.correlation_id,
        aegisDecision: task.aegis_decision,
        receiptId: task.result_receipt_id,
        artifactId: task.result_artifact_id,
      },
    });
  } catch { /* non-blocking by design */ }
}
