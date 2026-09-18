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
import fs from 'node:fs';
import { getDatabase, recordActivityEvent } from './persistence';
import { recordRuntimeEvent, type RuntimeEventStatus } from './runtime-events';
import { searchWorkspaceMemory, type MemorySearchResult } from './memory-index';
import { classifyModelRequest, resolveReviewSeatModel, explainUnroutableModel } from './model-router';
import { resolveModelApiKey } from './model-credentials';
import { generateViaOpenAI } from './fabric/model-openai';
import {
  getWorkspaceExternalExecution, guardianCheckInstruction,
  type ExternalExecutionRecord,
} from './external-executions';
import {
  executeEnvelope, resolveAntigravityBinding, antigravityApprovalDigest,
  type ExecutionEnvelopeInput,
} from './fabric/envelope';
import { requestApproval, decideApproval } from './approvals';
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

/**
 * A CODING task asks the runtime for structured engineering evidence; a
 * GENERAL one does not. This is a change to the INSTRUCTION contract only —
 * no runtime, adapter or execution architecture differs between them.
 */
export type DevelopmentTaskKind = 'GENERAL' | 'CODING';

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
  task_kind: DevelopmentTaskKind;
  /** Structured engineering evidence, ONLY when the runtime really returned it. JSON string, or null. */
  evidence_json: string | null;
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

/**
 * PUSH 2B — the observable event for one state change.
 *
 * Emitted into the EXISTING workspace-scoped runtime_events ledger rather
 * than a new event system, which is what lets a live Development surface
 * show real progress instead of an animation. The exact loop state travels
 * in `detail`; `status` is the closest existing runtime word, and BLOCKED is
 * kept distinct from FAILED on purpose — a Guardian refusal attempted
 * nothing.
 *
 * Non-blocking: telemetry must never change a task's real outcome.
 */
const RUNTIME_STATUS_FOR_STATE: Record<DevelopmentTaskState, RuntimeEventStatus> = {
  WAITING_FOR_REVIEW: 'SUBMITTED',
  READY_FOR_EXECUTION: 'SUBMITTED',
  WAITING_FOR_APPROVAL: 'SUBMITTED',
  RUNNING: 'RUNNING',
  VERIFIED: 'SUCCESS',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
};

export function emitDevelopmentTaskEvent(task: DevelopmentTaskRecord): void {
  try {
    recordRuntimeEvent({
      workspaceId: task.workspace_id,
      eventType: 'DEVELOPMENT_TASK',
      targetType: 'development_task',
      targetId: task.dev_task_id,
      status: RUNTIME_STATUS_FOR_STATE[task.state],
      detail: {
        state: task.state,
        stateReason: task.state_reason,
        title: task.title,
        reviewProvider: task.review_provider,
        reviewModel: task.review_model,
        approvedBy: task.approved_by_user_id,
        executionId: task.execution_id,
        taskId: task.task_id,
        aegisDecision: task.aegis_decision,
        receiptId: task.result_receipt_id,
      },
    });
  } catch { /* non-blocking by design */ }
}

function patch(devTaskId: string, fields: Record<string, unknown>): DevelopmentTaskRecord {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDatabase()
    .prepare(`UPDATE development_tasks SET ${sets}, updated_at = ? WHERE dev_task_id = ?`)
    .run(...keys.map((k) => fields[k] as never), new Date().toISOString(), devTaskId);
  const updated = row(devTaskId)!;
  // Emit only when the STATE really moved. A field-only update (recording a
  // review body, linking an artifact) is not a state change, and emitting for
  // it would fill a live feed with events that say nothing happened.
  if (Object.prototype.hasOwnProperty.call(fields, 'state')) emitDevelopmentTaskEvent(updated);
  return updated;
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
  kind?: DevelopmentTaskKind;
}): DevelopmentTaskRecord {
  const title = String(params.title || '').trim();
  const instruction = String(params.instruction || '').trim();
  if (!title) throw Object.assign(new Error('A title is required.'), { code: 'INVALID_INPUT' });
  if (!instruction) throw Object.assign(new Error('An instruction is required.'), { code: 'INVALID_INPUT' });

  const requiresReview = params.requiresReview !== false;
  // ALWAYS required. Every development task dispatches to runtime.antigravity,
  // a paid remote agent, and the current policy is that no paid remote
  // execution happens without a human decision. An explicit
  // `requiresApproval: false` is therefore ignored rather than honoured — the
  // envelope would refuse the unapproved dispatch anyway, and a task that
  // looked "ready" but could never run would be a lie in the queue.
  const requiresApproval = true;
  const kind: DevelopmentTaskKind = params.kind === 'CODING' ? 'CODING' : 'GENERAL';
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
      aegis_decision, task_kind, evidence_json, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, ?)
  `).run(devTaskId, params.workspaceId, title, instruction, state, requiresReview ? 1 : 0, requiresApproval ? 1 : 0, kind, params.createdByUserId, now, now);

  const created = row(devTaskId)!;
  emitDevelopmentTaskEvent(created);
  return created;
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

/**
 * The Development Review Seat's standing directive.
 *
 * WHY THIS IS NOT A GENERIC PROMPT. A reviewer that only asks "is this
 * instruction clear?" will approve the two things that have actually cost
 * this project time: work that duplicates something already built, and work
 * that quietly contradicts a decision already made. So the seat is given a
 * role and a specific set of things to look for, and is told what NOT to do —
 * a reviewer with licence to redesign will redesign, every time.
 *
 * CONTINUITY IS NOT HARD-CODED HERE. This directive carries no project
 * history and no conversation. Everything the seat knows about SynthOS
 * arrives as scoped Brain context retrieved per task, which is what lets the
 * seat improve as the Vault grows rather than as this string grows.
 */
export const REVIEW_SEAT_DIRECTIVE = [
  'You are the SynthOS Development Review Seat.',
  '',
  'You review a development task BEFORE an autonomous coding agent executes it in a sandbox.',
  'You do not execute anything yourself, and your verdict does not authorise execution — a human approval gate and Guardian both still stand between you and the runtime.',
  '',
  'YOUR RESPONSIBILITIES, in priority order:',
  '1. Reuse — does SynthOS already have a component, route, table or library that does this? Name it if so. Building a second one is the most expensive mistake available here.',
  '2. Duplicate architecture — would this create a second execution engine, task ledger, scheduler, memory/Brain, credential store or admin surface? Say so plainly.',
  '3. Contradiction — does this conflict with an architectural decision visible in the supplied context? Quote the conflicting part.',
  '4. Guardian and security — does the instruction imply destructive, privileged or outward-facing action? Does it risk exposing a credential, or writing unreviewed remote payload into the Vault?',
  '5. Readiness — is the instruction specific enough to execute without guessing? If not, state exactly what must change.',
  '',
  'WHAT YOU MUST NOT DO:',
  '- Do not redesign the existing architecture because you would have built it differently. Preserve it, and raise a concern instead.',
  '- Do not invent project facts. If the supplied context does not cover something, say the context is insufficient and name what is missing.',
  '- Do not pad the review. A short review that names one real problem is worth more than a thorough one that names none.',
].join('\n');

export function buildReviewPrompt(task: DevelopmentTaskRecord, context: DevelopmentContext): string {
  const contextBlock = context.items.length === 0
    ? '(no indexed project knowledge matched this task — say so in Risks rather than assuming)'
    : context.items.map((c, i) => `[${i + 1}] ${c.title} (${c.path})\n${c.excerpt}`).join('\n\n');

  return [
    REVIEW_SEAT_DIRECTIVE,
    '',
    '---',
    `TASK: ${task.title}`,
    `TASK KIND: ${task.task_kind}`,
    `INSTRUCTION TO BE EXECUTED:\n${task.instruction}`,
    '',
    'SCOPED SYNTHOS CONTEXT (retrieved from this workspace\'s Brain — the only project knowledge you have been given):',
    contextBlock,
    '',
    'Produce a concise review in Markdown with exactly these sections:',
    '1. Assessment — is this instruction clear, bounded and safe to execute?',
    '2. Reuse and duplication — what already exists that this should use instead of rebuilding.',
    '3. Risks — including contradictions with the context, and Guardian/security implications.',
    '4. Recommended execution plan — the concrete steps the agent should take.',
    '5. Verdict — one line, either PROCEED or DO NOT PROCEED, with the reason. If DO NOT PROCEED, state exactly what must change first.',
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

  const classified = classifyModelRequest(preferredModel || resolveReviewSeatModel());
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

/**
 * The exact envelope request a development task dispatches with. Built in ONE
 * place so the approval recorded at approve time and the approval the envelope
 * checks at dispatch are computed from identical inputs — if they could differ,
 * a human approval would silently fail to authorize the run.
 */
export function developmentEnvelopeInput(task: DevelopmentTaskRecord, actorUserId: string): ExecutionEnvelopeInput {
  return {
    workspaceId: task.workspace_id,
    actorUserId,
    capability: 'runtime.antigravity',
    action: 'execute',
    parameters: { instruction: buildExecutionInstruction(task) },
    rawText: '',
    // Also the ledger idempotency key: unchanged from before the Development
    // loop moved onto the envelope, so existing rows keep deduplicating.
    correlationId: `devtask:${task.dev_task_id}`,
  };
}

/**
 * Human approval. The one gate a model may never grant itself.
 *
 * Recorded TWICE ON PURPOSE, as one decision: on the development task (the
 * loop's own vocabulary) and as a canonical approval in lib/approvals.ts,
 * bound to the same runtime.antigravity digest the envelope checks. That is
 * what lets dispatch go through the canonical envelope — Guardian, approval
 * gate, single-use consumption, the one external-execution ledger — instead of
 * a Development-only submission path.
 */
export function approveDevelopmentTask(workspaceId: string, devTaskId: string, approverUserId: string): DevelopmentTaskRecord {
  const task = getWorkspaceDevelopmentTask(workspaceId, devTaskId);
  if (!task) throw Object.assign(new Error('Development task not found.'), { code: 'NOT_FOUND' });
  if (task.state !== 'WAITING_FOR_APPROVAL') {
    throw Object.assign(new Error(`Only a task waiting for approval can be approved; this one is ${task.state}.`), { code: 'INVALID_STATE' });
  }

  const envelopeInput = developmentEnvelopeInput(task, approverUserId);
  const binding = resolveAntigravityBinding(envelopeInput);
  const pending = requestApproval({
    workspaceId,
    taskId: null,
    correlationId: envelopeInput.correlationId!,
    capability: 'runtime.antigravity',
    action: 'execute',
    effectClass: 'EXTERNAL_ACTION',
    requestedByUserId: task.created_by_user_id,
    guardianDecision: 'SAFE',
    actionSummary: `Development task ${task.dev_task_id}: ${task.title}`,
    inputDigest: antigravityApprovalDigest(binding),
  });
  const decided = decideApproval({ approvalId: pending.approval_id, workspaceId, decidedByUserId: approverUserId, decision: 'APPROVED', reason: 'Approved in the Development workspace.' });
  if (!decided.ok) {
    throw Object.assign(new Error(`Could not record the canonical approval: ${decided.reason}`), { code: 'INVALID_STATE' });
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

// ---------------------------------------------------------------------------
// PUSH 2C — THE CODING EVIDENCE CONTRACT.
//
// A development task needs engineering evidence, and the runtime returns
// prose. Push 2B recorded this honestly as a gap: inventing a diff parser
// for text that may contain no diff would be fabrication.
//
// The fix is to ASK. This extends the INSTRUCTION contract only — no runtime,
// adapter, ledger or execution architecture changes. A coding task appends a
// request for one fenced JSON block with named fields; if the agent returns
// it, we record exactly what it said. If it does not, evidence stays null and
// the surface shows nothing. No field is ever defaulted, inferred from prose,
// or filled with a placeholder.
//
// Raw command and file payloads are deliberately NOT requested: filesChanged
// carries paths, not diffs, so unreviewed remote file content does not flow
// into telemetry or the Vault through this door.
// ---------------------------------------------------------------------------

export interface CodingEvidence {
  summary?: string;
  filesChanged?: string[];
  testsRun?: string;
  testResult?: string;
  typecheckResult?: string;
  buildResult?: string;
  commitSha?: string;
  blockers?: string[];
}

export const CODING_EVIDENCE_INSTRUCTION = [
  '',
  '---',
  'When you have finished, append a single fenced code block tagged `json` containing ONLY this object:',
  '{',
  '  "synthos_evidence": {',
  '    "summary": "one or two sentences on what you actually changed",',
  '    "filesChanged": ["path/one.ts", "path/two.ts"],',
  '    "testsRun": "the exact test command you ran, or null if you ran none",',
  '    "testResult": "PASS | FAIL | NOT_RUN, with counts if you have them",',
  '    "typecheckResult": "PASS | FAIL | NOT_RUN",',
  '    "buildResult": "PASS | FAIL | NOT_RUN",',
  '    "commitSha": "the SHA if you created a commit, otherwise null",',
  '    "blockers": ["anything that stopped you, or an empty array"]',
  '  }',
  '}',
  'Report only what you really did. Use NOT_RUN rather than guessing, and null rather than inventing a value.',
  'Do not include file contents, diffs or raw command output in this block — paths only.',
].join('\n');

/**
 * The text actually sent to the runtime. A GENERAL task is sent verbatim;
 * only a CODING task carries the evidence request.
 */
export function buildExecutionInstruction(task: DevelopmentTaskRecord): string {
  return task.task_kind === 'CODING' ? `${task.instruction}\n${CODING_EVIDENCE_INSTRUCTION}` : task.instruction;
}

/**
 * Pull the evidence block out of a real runtime output.
 *
 * Returns null whenever the agent did not produce one — which is the common
 * case and must stay visible as "no evidence returned" rather than an object
 * of empty strings. Only known fields are kept, and only when they carry a
 * real value, so a surface can never render a field the runtime never sent.
 */
export function parseCodingEvidence(output: string): CodingEvidence | null {
  const text = String(output || '');
  // Every fenced block is considered, because an agent may emit several and
  // the evidence one is rarely first.
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
  candidates.push(text);

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    let parsed: any;
    try { parsed = JSON.parse(candidate.slice(start, end + 1)); } catch { continue; }
    const block = parsed?.synthos_evidence;
    if (!block || typeof block !== 'object') continue;

    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const list = (v: unknown) => {
      if (!Array.isArray(v)) return undefined;
      const items = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
      return items.length ? items : undefined;
    };

    const evidence: CodingEvidence = {
      summary: str(block.summary),
      filesChanged: list(block.filesChanged),
      testsRun: str(block.testsRun),
      testResult: str(block.testResult),
      typecheckResult: str(block.typecheckResult),
      buildResult: str(block.buildResult),
      commitSha: str(block.commitSha),
      blockers: list(block.blockers),
    };
    for (const k of Object.keys(evidence) as (keyof CodingEvidence)[]) {
      if (evidence[k] === undefined) delete evidence[k];
    }
    return Object.keys(evidence).length > 0 ? evidence : null;
  }
  return null;
}

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
    // THE CANONICAL PATH. The envelope re-checks the registry (configured and
    // enabled), runs Guardian on the full bounded instruction, consumes the
    // canonical approval recorded at approve time, and submits through the one
    // external-execution ledger. The Development loop no longer submits on its
    // own.
    const result = await executeEnvelope(developmentEnvelopeInput(task, actorUserId));

    if (result.outcome === 'APPROVAL_REQUIRED') {
      // The approval did not match: the instruction, agent or scope changed
      // since approval, or it lapsed. Back to the human, never around them.
      const waiting = patch(devTaskId, { state: 'WAITING_FOR_APPROVAL', state_reason: result.reason });
      return { task: waiting, execution: null, reason: result.reason };
    }

    const execution = result.externalExecution
      ? getWorkspaceExternalExecution(workspaceId, result.externalExecution.id)
      : null;

    if (!execution) {
      const blocked = patch(devTaskId, { state: 'BLOCKED', state_reason: String(result.reason || 'Dispatch refused.').slice(0, 500) });
      return { task: blocked, execution: null, reason: blocked.state_reason! };
    }

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
    // Null whenever the runtime returned no evidence block, which is the
    // common case. A surface must be able to say "none returned" rather than
    // render an object of empty fields.
    evidence_json: readCodingEvidence(task, execution.result_artifact_id),
    state: verified ? 'VERIFIED' : 'FAILED',
    state_reason: verified
      ? 'Execution completed, Aegis verified the result, and a signed receipt was issued.'
      : `Execution completed but was not verified (Aegis: ${review?.decision ?? 'no review recorded'}). No receipt was issued.`,
  });

  writeBackDevelopmentCycle(updated, execution);
  return updated;
}

/**
 * Read the runtime's structured evidence back out of the artifact it already
 * wrote.
 *
 * Deliberately sourced from the persisted artifact rather than held in
 * memory: the artifact is the record, it survives a restart, and reading it
 * here means reconciliation produces the same answer whenever it runs.
 *
 * Every failure mode returns null rather than throwing — a task's real
 * verified outcome must never depend on whether an optional evidence block
 * could be parsed.
 */
function readCodingEvidence(task: DevelopmentTaskRecord, artifactId: string | null): string | null {
  if (task.task_kind !== 'CODING' || !artifactId) return null;
  try {
    const artifact = getDatabase()
      .prepare('SELECT disk_path FROM artifacts WHERE artifact_id = ?')
      .get(artifactId) as { disk_path: string } | undefined;
    if (!artifact?.disk_path || !fs.existsSync(artifact.disk_path)) return null;
    const evidence = parseCodingEvidence(fs.readFileSync(artifact.disk_path, 'utf8'));
    return evidence ? JSON.stringify(evidence) : null;
  } catch {
    return null;
  }
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
