// ---------------------------------------------------------------------------
// NO-COPY/PASTE ORCHESTRATION.
//
// THE PROBLEM THIS ENDS
// Every proof so far has been real, but each STEP was started by a human
// moving a request between runtimes by hand. This carries queued work forward
// on its own, and interrupts only at an approval gate or a genuine error.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS NOT
// ---------------------------------------------------------------------------
// Not a second orchestrator, not a second queue, not a second scheduler.
//   - The QUEUE is the canonical `tasks` table (three additive columns).
//   - The TIMER is the existing scheduler tick in lib/fabric/scheduler.ts;
//     this adds one more thing that tick calls, exactly as external-execution
//     reconciliation already is.
//   - DISPATCH is lib/fabric/envelope.ts for tools and lib/fabric/kernel.ts
//     for model work — the same two entry points every other caller uses.
//   - PROVIDER SELECTION stays with lib/model-router.ts. This file never
//     names a provider.
//   - APPROVAL is lib/approvals.ts, unchanged and uncopied.
//
// This file contributes exactly two things that did not exist: the decision
// about WHICH task is next, and the atomic claim that stops one task running
// twice. Everything else it delegates.
//
// ---------------------------------------------------------------------------
// THE ORDER OF THE GATES, and why each is where it is
// ---------------------------------------------------------------------------
//   1. Autonomy level      — may unattended work of this CLASS happen at all?
//                            Cheapest check, and the one an operator controls,
//                            so it comes first.
//   2. Atomic claim        — do I own this task? Before any work, so a race
//                            cannot produce two executions.
//   3. Registry resolve    — does this capability exist and is it configured?
//   4. Guardian            — revalidated at dispatch, never trusted from when
//                            the task was queued. A task may have sat in the
//                            queue for hours; policy may have changed, and the
//                            inputs certainly were not re-read by a human.
//   5. Envelope / kernel   — which apply the approval gate, evidence, Aegis,
//                            receipts and Brain writeback themselves.
//
// A task that fails gate 1 or 3 is RELEASED back to READY rather than failed:
// nothing happened, and a configuration problem fixed later should let the
// work proceed without a human re-queueing it. A task refused by Guardian is
// BLOCKED, because that is a decision rather than a delay.
// ---------------------------------------------------------------------------

import {
  listOrchestratorEligibleTasks,
  claimTaskForOrchestration,
  releaseTaskClaim,
  getOrchestratorTask,
  listStrandedOrchestrationTasks,
  listTasksAwaitingApproval,
  acquireExecutionClaim,
  resolveExecutionClaim,
  releaseExecutionClaim,
  updateTaskStatus,
  recordActivityEvent,
  type OrchestratorTaskRow,
} from '../persistence';
import { listWorkspaces } from '../workspaces';
import { executeEnvelope, type ExecutionEnvelopeResult } from './envelope';
import { executeAgentTask } from './kernel';
import { createExecutionContext } from './context';
import { resolveCapability } from './registry';
import { guardianCheckInstruction } from '../external-executions';
import { mayAutonomouslyDispatch, resolveAutonomyLevel, type AutonomyLevel } from '../autonomy';
import { recordRuntimeEvent } from '../runtime-events';
import { searchWorkspaceKnowledge } from '../knowledge-vault';
import { listApprovalsForCorrelation } from '../approvals';
import { scrubSecrets } from '../redact';

export type OrchestrationOutcome =
  | 'ADVANCED'            // the task ran and reached a terminal state
  | 'WAITING_APPROVAL'    // stopped at the human gate; other tasks continue
  | 'SUBMITTED'           // handed to an asynchronous runtime; the external-execution sweep completes it
  | 'DEFERRED'            // nothing happened; released for a later tick
  | 'BLOCKED'             // Guardian or policy refused; terminal
  | 'FAILED'              // real execution failure; terminal
  | 'UNKNOWN'             // ambiguous external state; requires an operator
  | 'NOT_CLAIMED';        // another worker owns it

export interface OrchestrationStep {
  taskId: string;
  workspaceId: string;
  capability: string | null;
  outcome: OrchestrationOutcome;
  reason: string;
  correlationId: string;
  /** Present when execution really happened. */
  providerOrTool?: string | null;
  artifactId?: string | null;
  receiptId?: string | null;
  aegisDecision?: string | null;
  approvalId?: string | null;
  finalStatus?: string | null;
  /** Present on SUBMITTED: the external-execution row the sweep will advance. */
  externalExecutionId?: string | null;
  brainContextNotes?: number;
}

export interface OrchestrationTickResult {
  level: AutonomyLevel;
  considered: number;
  steps: OrchestrationStep[];
  /** Claimed-but-unfinished tasks, surfaced for reconciliation and never re-run. */
  stranded: string[];
  /** Tasks moved out of WAITING_FOR_APPROVAL because a human decided. */
  resumed: Array<{ taskId: string; to: string; approvalId: string }>;
}

/** Health, exposed for the Admin surface and /api/ready. Process-local, like the scheduler's. */
const health = {
  running: false,
  ticks: 0,
  lastTickAt: null as string | null,
  lastTickAdvanced: 0,
  tickErrors: 0,
  lastError: null as { at: string; message: string } | null,
  lastStep: null as OrchestrationStep | null,
};

export function getOrchestratorHealth() {
  return { ...health, level: resolveAutonomyLevel() };
}

export function resetOrchestratorHealthForTests(): void {
  health.running = false;
  health.ticks = 0;
  health.lastTickAt = null;
  health.lastTickAdvanced = 0;
  health.tickErrors = 0;
  health.lastError = null;
  health.lastStep = null;
}

function correlationFor(task: OrchestratorTaskRow): string {
  // Derived from the task id, deterministically. So a restart mid-task rejoins
  // the SAME trace rather than starting a new one, and the idempotency key the
  // envelope sees is stable across process death — which is what makes
  // "no duplicate artifact after a restart" true rather than hoped for.
  return `orchestration:${task.task_id}`;
}

function recordOrchestrationEvent(step: OrchestrationStep): void {
  try {
    recordRuntimeEvent({
      workspaceId: step.workspaceId,
      eventType: 'CAPABILITY_INVOCATION',
      targetType: 'capability',
      targetId: step.capability || 'model.task',
      // Mapped onto the EXISTING RuntimeEventStatus vocabulary rather than a
      // new one. APPROVAL_REQUIRED and UNKNOWN already exist there precisely
      // because they must never be collapsed into FAILED — a deferral is not a
      // denial, and "we could not determine the outcome" is not an assertion
      // that it failed.
      status: step.outcome === 'ADVANCED' ? 'SUCCESS'
        : step.outcome === 'FAILED' ? 'FAILED'
        : step.outcome === 'WAITING_APPROVAL' ? 'APPROVAL_REQUIRED'
        : step.outcome === 'UNKNOWN' ? 'UNKNOWN'
        : step.outcome === 'DEFERRED' ? 'NOT_CONFIGURED'
        : step.outcome === 'NOT_CLAIMED' ? 'CANCELLED'
        : 'BLOCKED',
      detail: {
        orchestration: true,
        taskId: step.taskId,
        outcome: step.outcome,
        correlationId: step.correlationId,
        reason: scrubSecrets(step.reason, 400),
        providerOrTool: step.providerOrTool ?? null,
        artifactId: step.artifactId ?? null,
        receiptId: step.receiptId ?? null,
        aegisDecision: step.aegisDecision ?? null,
        approvalId: step.approvalId ?? null,
        finalStatus: step.finalStatus ?? null,
      },
    });
  } catch {
    /* evidence must never be the thing that stops the loop */
  }
}

/**
 * Words that carry no retrieval signal. Task titles are full of them.
 */
const BRAIN_QUERY_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at',
  'is', 'are', 'was', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its', 'as',
  'do', 'does', 'not', 'add', 'only', 'using', 'use', 'state', 'what', 'which', 'then',
  'task', 'proof', 'run', 'note', 'notes', 'context', 'synthos', 'please', 'two', 'one',
  'sentences', 'sentence', 'summarise', 'summarize', 'read', 'write', 'internal', 'bounded',
]);

/**
 * Derive short, distinctive search terms from a task's text.
 *
 * WHY THIS EXISTS, and it is a defect I shipped and then caught in the live
 * run: the first version passed `title + description` as ONE 200-character
 * needle. lib/knowledge-vault.ts's search is a SUBSTRING match, so a needle
 * that long can never appear in a note title or body — Brain retrieval
 * returned nothing for every realistic task while reporting no error. The loop
 * looked like it worked and the model got `(no matching notes)` every time,
 * which is the worst kind of failure: silent, and indistinguishable from an
 * empty Brain.
 *
 * Longest-first is a deliberate proxy for distinctiveness. Proper scoring
 * would need term frequencies this module has no business computing; length
 * correlates well enough with specificity in practice ("verification" beats
 * "add"), and the alternative — inventing an IDF here — would be building a
 * second retrieval engine beside the one that exists.
 */
export function deriveBrainQueryTerms(text: string, max = 4): string[] {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 4 && !BRAIN_QUERY_STOPWORDS.has(w));
  const unique = Array.from(new Set(words));
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, max);
}

/**
 * Retrieve Brain context for a task.
 *
 * Bounded, workspace-scoped, and READ-ONLY — it calls the same accessor
 * brain.search uses, so the orchestrator cannot see knowledge a caller could
 * not. Returns a compact block, never whole notes: this text goes into a model
 * prompt, and a full vault dump there is both expensive and a way to put
 * unrelated private material in front of a provider.
 *
 * Searches a few distinctive terms and merges, rather than one long needle —
 * see deriveBrainQueryTerms for why.
 */
function retrieveBrainContext(
  workspaceId: string,
  task: OrchestratorTaskRow,
): { block: string; count: number; terms: string[] } {
  const terms = deriveBrainQueryTerms([task.title, task.description].filter(Boolean).join(' '));
  if (terms.length === 0) return { block: '(no distinctive search terms derivable from the task)', count: 0, terms };

  const seen = new Set<string>();
  const merged: Array<{ title: string; kind: string; snippet: string | null; matchedTerm: string }> = [];
  for (const term of terms) {
    if (merged.length >= 3) break;
    let hits: ReturnType<typeof searchWorkspaceKnowledge> = [];
    try {
      hits = searchWorkspaceKnowledge(workspaceId, term, process.env, 3);
    } catch {
      return { block: '(Brain unavailable for this tick)', count: 0, terms };
    }
    for (const h of hits) {
      if (merged.length >= 3) break;
      if (seen.has(h.vaultRelativePath)) continue;
      seen.add(h.vaultRelativePath);
      merged.push({ title: h.title, kind: h.kind, snippet: h.snippet ?? null, matchedTerm: term });
    }
  }

  if (merged.length === 0) {
    // Honest: the terms were searched and nothing matched. Distinct from
    // "no terms" and from "Brain unavailable".
    return { block: `(no notes in this workspace match: ${terms.join(', ')})`, count: 0, terms };
  }
  return {
    count: merged.length,
    terms,
    block: merged
      .map((m, i) => `${i + 1}. ${m.title} [${m.kind}] (matched "${m.matchedTerm}") — ${String(m.snippet ?? '').slice(0, 200)}`)
      .join('\n'),
  };
}

/**
 * Advance ONE task. Exported so tests drive it directly with no timer.
 */
export async function advanceTask(task: OrchestratorTaskRow): Promise<OrchestrationStep> {
  const workspaceId = String(task.workspace_id || '');
  const correlationId = correlationFor(task);
  const base = { taskId: task.task_id, workspaceId, capability: task.capability, correlationId };

  // Declared before the claim so every exit path can settle it.
  let settle: ((outcome: OrchestrationOutcome) => void) | null = null;

  const finish = (step: OrchestrationStep): OrchestrationStep => {
    // Settled here rather than at each return, so no exit path can forget it.
    //
    // THREE outcomes, not two, and conflating them was a real bug:
    //
    //   DONE      the work COMPLETED. A later attempt short-circuits on this,
    //             which is correct.
    //   FAILED    it definitively failed or was refused. Terminal; not retried.
    //   RELEASED  NOTHING HAPPENED. A task parked at an approval gate, or
    //             deferred because a capability was briefly unconfigured, did
    //             no work — so its claim is deleted rather than resolved. An
    //             earlier version settled these as DONE, and the consequence
    //             was that a task resumed after a human approval reported
    //             ADVANCED without ever executing and without consuming the
    //             approval. Caught by the resume test.
    if (settle) {
      settle(step.outcome);
      settle = null;
    }
    recordOrchestrationEvent(step);
    health.lastStep = step;
    return step;
  };

  // --- GATE 1: autonomy level ---------------------------------------------
  // Resolved from the capability when there is one, so the level is applied to
  // the real effect class rather than to a guess.
  let effectClass: 'MODEL' | 'READ' | 'COMPUTE' | 'INTERNAL_MUTATION' | 'EXTERNAL_ACTION' | 'CONTROL' = 'MODEL';
  if (task.capability) {
    const cap = await resolveCapability(task.capability);
    if (!cap) {
      // Unregistered capability. DEFERRED, not FAILED: a task naming a
      // capability this build does not have is a configuration mismatch, and a
      // later deploy may supply it.
      return finish({ ...base, outcome: 'DEFERRED', reason: `"${task.capability}" is not a registered capability; leaving the task queued.` });
    }
    effectClass = cap.effectClass;
  }

  const autonomy = mayAutonomouslyDispatch(effectClass);
  if (!autonomy.allowed) {
    return finish({ ...base, outcome: 'DEFERRED', reason: autonomy.reason });
  }

  // --- GATE 2: atomic claim -----------------------------------------------
  //
  // TWO claims, and the second one is not redundant — it is the one that
  // actually holds. The restart proof is what exposed why:
  //
  // The status transition (TODO/READY -> RUNNING) is what removes the task
  // from the eligible set, and it is atomic. But lib/fabric/kernel.ts calls
  // createInitialTask() at the start of every model execution, and that
  // function UPSERTS the row back to status 'TODO'. So for a model task the
  // orchestrator's status claim was being undone by the executor itself
  // moments later, and the observed history read
  //
  //     TODO -> RUNNING -> TODO -> READY -> RUNNING
  //
  // leaving a real window in which a second tick could claim a task that was
  // already executing. Nothing duplicated in the observed run only because
  // the crashed attempt had not yet reached the provider; with the crash a few
  // seconds later it would have been a duplicate paid call and a duplicate
  // artifact.
  //
  // execution_claims is immune to that, because it is a separate table with a
  // UNIQUE constraint and the kernel does not touch it. It is also the same
  // mechanism the envelope already uses for tool idempotency — so tool tasks
  // were never exposed, and this makes model tasks equally safe rather than
  // inventing a third approach.
  if (!claimTaskForOrchestration(task.task_id, workspaceId)) {
    return finish({ ...base, outcome: 'NOT_CLAIMED', reason: 'Another worker claimed this task first; not executed here.' });
  }

  // DISTINCT KEY NAMESPACE, and this collision is worth recording because it
  // broke three tests the moment the durable claim was added.
  //
  // execution_claims is UNIQUE on (workspace_id, actor_user_id, capability,
  // idempotency_key). The envelope's own withAtomicClaim already takes a claim
  // on exactly that tuple for a tool dispatch, using the correlation id as the
  // key. Claiming the same tuple here therefore collided with the executor
  // this function was about to call: the envelope saw an existing CLAIMED row,
  // correctly returned IN_PROGRESS, and the task failed — the orchestrator had
  // locked itself out.
  //
  // The two claims answer different questions and so get different keys:
  //   orchestration-task:<id>  is this TASK being carried forward by a worker?
  //   <correlation id>         has this capability+payload already executed?
  // Both are needed. The first survives the kernel resetting task status; the
  // second is what makes a replay return prior evidence instead of re-running.
  const durableClaim = acquireExecutionClaim({
    workspaceId,
    actorUserId: 'orchestrator',
    capability: task.capability || 'model.task',
    idempotencyKey: `orchestration-task:${task.task_id}`,
    payloadHash: `orchestration-task:${task.task_id}`,
    taskId: task.task_id,
  });

  if (durableClaim.outcome === 'EXISTS') {
    const existing = durableClaim.claim;
    if (existing.status === 'CLAIMED') {
      // Another execution owns this task right now, or owned it when the
      // process died. Either way this tick must not run it: re-running a
      // claim that may already have reached a provider is the duplicate-bill
      // case. Left for reconciliation.
      return finish({
        ...base, outcome: 'NOT_CLAIMED',
        reason: `An execution claim for this task is already open (claim ${existing.claim_id}, since ${existing.created_at}). Not re-executed — if a previous attempt died mid-flight this needs reconciliation, not a retry.`,
      });
    }
    if (existing.status === 'DONE') {
      updateTaskStatus(task.task_id, 'DONE', undefined, workspaceId);
      return finish({ ...base, outcome: 'ADVANCED', reason: 'Already completed under an existing execution claim; not re-executed.', finalStatus: 'DONE' });
    }
    // FAILED — a previous attempt definitively failed. Not retried silently.
    updateTaskStatus(task.task_id, 'FAILED', undefined, workspaceId);
    return finish({ ...base, outcome: 'FAILED', reason: 'A previous execution of this task failed; not retried automatically.', finalStatus: 'FAILED' });
  }

  const claimId = durableClaim.claim.claim_id;
  /** Always reached: a claim left CLAIMED forever would block the task permanently. */
  settle = (outcome: OrchestrationOutcome) => {
    try {
      if (outcome === 'SUBMITTED') {
        // Work is in flight remotely. The claim stays CLAIMED on purpose: it is
        // what stops any later tick re-running a task that may already have
        // cost money. The external-execution sweep settles it when the remote
        // job reaches an outcome (lib/external-executions.ts,
        // syncOrchestratedTaskForExecution).
        return;
      } else if (outcome === 'ADVANCED') {
        resolveExecutionClaim(claimId, 'DONE');
      } else if (outcome === 'WAITING_APPROVAL' || outcome === 'DEFERRED') {
        // Nothing ran. Release so a later attempt can claim cleanly.
        releaseExecutionClaim(claimId);
      } else {
        resolveExecutionClaim(claimId, 'FAILED');
      }
    } catch { /* a stuck claim is visible; a throw here is worse */ }
  };

  // --- GATE 3: configuration ----------------------------------------------
  if (task.capability) {
    const cap = await resolveCapability(task.capability);
    if (!cap || cap.status === 'NOT_CONFIGURED' || cap.status === 'UNSUPPORTED') {
      releaseTaskClaim(task.task_id, workspaceId, 'READY', cap?.reason || 'capability unavailable');
      return finish({ ...base, outcome: 'DEFERRED', reason: `"${task.capability}" is ${cap?.status ?? 'unregistered'}: ${cap?.reason ?? 'no executor'}. Task returned to READY.` });
    }
  }

  // --- Brain context ------------------------------------------------------
  const brain = retrieveBrainContext(workspaceId, task);

  // --- GATE 4: Guardian, revalidated AT DISPATCH --------------------------
  // Not trusted from queue time. A task may have waited hours; nobody re-read
  // its inputs, and policy may have changed underneath it.
  const guardianSubject = [
    task.capability ? `capability: ${task.capability}` : `model task: ${task.assigned_model}`,
    `title: ${task.title ?? ''}`,
    `description: ${task.description ?? ''}`,
    task.parameters_json ? `parameters: ${task.parameters_json.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');

  const guardian = guardianCheckInstruction(guardianSubject);
  if (!guardian.allowed) {
    updateTaskStatus(task.task_id, 'BLOCKED', undefined, workspaceId);
    try {
      recordActivityEvent({
        taskId: task.task_id, expectedWorkspaceId: workspaceId, eventType: 'GUARDIAN_BLOCKED',
        agentId: 'guardian', payload: { reason: guardian.error, citation: guardian.citation ?? null },
      });
    } catch { /* evidence must not mask the block */ }
    return finish({ ...base, outcome: 'BLOCKED', reason: guardian.error || 'Guardian refused this task at dispatch.', finalStatus: 'BLOCKED' });
  }

  // --- GATE 5: dispatch through the canonical path ------------------------
  try {
    if (task.capability) {
      let parameters: Record<string, unknown> = {};
      try { parameters = task.parameters_json ? JSON.parse(task.parameters_json) : {}; } catch { parameters = {}; }

      const result: ExecutionEnvelopeResult = await executeEnvelope({
        workspaceId,
        actorUserId: 'orchestrator',
        capability: task.capability,
        action: 'execute',
        parameters,
        rawText: [task.title, task.description].filter(Boolean).join('\n'),
        correlationId,
        taskId: task.task_id,
        // Stable across restarts, so a resumed task replays rather than
        // re-executes.
        idempotencyKey: correlationId,
      });

      if (result.outcome === 'APPROVAL_REQUIRED') {
        // The task stops HERE. Other tasks continue — see runOrchestrationTick.
        updateTaskStatus(task.task_id, 'WAITING_FOR_APPROVAL', undefined, workspaceId);
        return finish({
          ...base, outcome: 'WAITING_APPROVAL', reason: result.reason,
          approvalId: result.approval?.approvalId ?? null, finalStatus: 'WAITING_FOR_APPROVAL',
          brainContextNotes: brain.count,
        });
      }

      if (result.outcome === 'SUBMITTED') {
        // Asynchronous runtime (runtime.antigravity). Nothing is complete yet:
        // no artifact, no Aegis, no receipt. The task stays RUNNING and the
        // ONE external-execution sweep carries it to DONE or FAILED. This
        // loop does not wait for it and does not poll it.
        try {
          recordActivityEvent({
            taskId: task.task_id, expectedWorkspaceId: workspaceId, eventType: 'EXTERNAL_EXECUTION_SUBMITTED',
            agentId: 'orchestrator',
            payload: {
              capability: task.capability,
              executionId: result.externalExecution?.id ?? null,
              remoteJobId: result.externalExecution?.remoteJobId ?? null,
              approvalId: result.approval?.approvalId ?? null,
            },
          });
        } catch { /* evidence must not mask the submission */ }
        return finish({
          ...base, outcome: 'SUBMITTED', reason: result.reason,
          providerOrTool: task.capability,
          approvalId: result.approval?.approvalId ?? null,
          externalExecutionId: result.externalExecution?.id ?? null,
          finalStatus: 'RUNNING', brainContextNotes: brain.count,
        });
      }

      if (result.outcome === 'SUCCESS' || result.outcome === 'READ_OK') {
        updateTaskStatus(task.task_id, 'DONE', undefined, workspaceId);
        return finish({
          ...base, outcome: 'ADVANCED', reason: result.reason,
          providerOrTool: task.capability,
          artifactId: result.artifact?.id ?? null,
          receiptId: result.receipt?.receiptId ?? null,
          aegisDecision: result.aegis?.decision ?? null,
          finalStatus: 'DONE', brainContextNotes: brain.count,
        });
      }

      // IN_PROGRESS / CONFLICT come from the envelope's own idempotency claim,
      // not from this loop. Neither is a failure and neither should be
      // retried here: IN_PROGRESS means another caller owns this exact
      // payload right now, CONFLICT means the same key was used for different
      // inputs. Both are left for a later tick or an operator.
      if (result.outcome === 'IN_PROGRESS') {
        releaseTaskClaim(task.task_id, workspaceId, 'READY', result.reason);
        return finish({ ...base, outcome: 'DEFERRED', reason: result.reason, finalStatus: 'READY' });
      }
      if (result.outcome === 'CONFLICT') {
        updateTaskStatus(task.task_id, 'BLOCKED', undefined, workspaceId);
        return finish({ ...base, outcome: 'BLOCKED', reason: result.reason, finalStatus: 'BLOCKED' });
      }

      if (result.outcome === 'BLOCKED' || result.outcome === 'NOT_CONFIGURED') {
        const terminal = result.outcome === 'BLOCKED';
        if (terminal) updateTaskStatus(task.task_id, 'BLOCKED', undefined, workspaceId);
        else releaseTaskClaim(task.task_id, workspaceId, 'READY', result.reason);
        return finish({ ...base, outcome: terminal ? 'BLOCKED' : 'DEFERRED', reason: result.reason, finalStatus: terminal ? 'BLOCKED' : 'READY' });
      }

      // UNKNOWN / ambiguous — the one state that must not be retried.
      //
      // An external execution whose outcome cannot be determined may already
      // have had its effect. The task is left needing an operator, NOT
      // returned to the eligible set, because the eligible set is what a later
      // tick would pick up and run again.
      if (result.outcome === 'FAILED' && /UNKNOWN/i.test(result.reason)) {
        updateTaskStatus(task.task_id, 'BLOCKED', undefined, workspaceId);
        return finish({
          ...base, outcome: 'UNKNOWN',
          reason: `${result.reason} Task left BLOCKED for operator reconciliation; it will not be retried automatically.`,
          finalStatus: 'BLOCKED',
        });
      }

      updateTaskStatus(task.task_id, 'FAILED', undefined, workspaceId);
      return finish({ ...base, outcome: 'FAILED', reason: result.reason, finalStatus: 'FAILED' });
    }

    // --- MODEL TASK: the kernel owns the whole evidence chain -------------
    // Provider selection stays with the router; this file names no provider.
    const ctx = createExecutionContext({ workspaceId });
    const contextualInputs = [
      'SynthOS Brain context for this task (use only what is relevant):',
      brain.block,
      '',
      'Task inputs:',
      task.description ?? '',
    ].join('\n');

    const kernelResult = await executeAgentTask({
      taskId: task.task_id,
      taskTitle: task.title ?? task.task_id,
      description: task.description ?? '',
      assignedAgent: task.assigned_agent ?? 'scribe',
      assignedModel: task.assigned_model ?? 'gpt-5.6-terra',
      inputs: contextualInputs,
    }, workspaceId, ctx);

    const body: any = kernelResult.body || {};
    const invoked = ctx.getInvocations().map((i) => i.name);
    if (kernelResult.status === 200) {
      return finish({
        ...base, outcome: 'ADVANCED',
        reason: `Model task completed on ${body.modelUsed ?? 'the router-selected model'}.`,
        providerOrTool: invoked[0] ?? body.modelUsed ?? null,
        artifactId: body?.artifact?.id ?? body?.artifactId ?? null,
        receiptId: body?.receipt?.receiptId ?? body?.receiptId ?? null,
        aegisDecision: body?.aegis?.decision ?? body?.aegisDecision ?? null,
        finalStatus: body?.status ?? 'DONE',
        brainContextNotes: brain.count,
      });
    }
    // The kernel already wrote FAILED and its own PROVIDER_FAILED evidence.
    return finish({
      ...base, outcome: 'FAILED',
      reason: body?.error || `Model task failed with HTTP ${kernelResult.status}.`,
      providerOrTool: invoked[0] ?? null, finalStatus: 'FAILED',
    });
  } catch (err: any) {
    // An unexpected throw leaves the task FAILED rather than RUNNING, so it
    // does not masquerade as in-flight work forever.
    updateTaskStatus(task.task_id, 'FAILED', undefined, workspaceId);
    return finish({ ...base, outcome: 'FAILED', reason: scrubSecrets(err?.message || String(err), 300), finalStatus: 'FAILED' });
  }
}

/**
 * Return approved tasks to the eligible set — §4, "no manual trigger beyond
 * the human approval itself".
 *
 * A task parked at WAITING_FOR_APPROVAL is deliberately NOT in
 * ORCHESTRATOR_ELIGIBLE_STATUSES, so nothing picks it up while it waits. This
 * sweep is what notices that a human has since decided, and moves the task
 * back to READY so the very next tick carries it forward.
 *
 * WHAT IT DOES NOT DO, and this is the important part: it does not dispatch,
 * and it does not treat the approval as permission to skip anything. The task
 * re-enters the normal path and passes every gate again — including Guardian,
 * revalidated at dispatch, and the envelope's own approval check, which is
 * what actually consumes the approval. So a human decision resumes the work
 * without ever becoming a bypass.
 *
 * A REJECTED approval moves the task to REJECTED, terminal. An unattended loop
 * that re-queued a rejection would be turning "no" into "not yet".
 */
export function resumeApprovedTasks(workspaceId: string): Array<{ taskId: string; to: string; approvalId: string }> {
  const resumed: Array<{ taskId: string; to: string; approvalId: string }> = [];

  for (const task of listTasksAwaitingApproval(workspaceId)) {
    const correlationId = correlationFor(task);
    let approvals: ReturnType<typeof listApprovalsForCorrelation> = [];
    try {
      approvals = listApprovalsForCorrelation(workspaceId, correlationId);
    } catch {
      continue;
    }
    if (approvals.length === 0) continue;

    // Newest decision wins; the list is oldest-first.
    const latest = approvals[approvals.length - 1];

    if (latest.status === 'APPROVED') {
      updateTaskStatus(task.task_id, 'READY', undefined, workspaceId);
      try {
        recordActivityEvent({
          taskId: task.task_id, expectedWorkspaceId: workspaceId, eventType: 'APPROVAL_GRANTED',
          agentId: 'orchestrator',
          payload: { approvalId: latest.approval_id, decidedBy: latest.decided_by_user_id, resumedTo: 'READY' },
        });
      } catch { /* evidence must not block the resume */ }
      resumed.push({ taskId: task.task_id, to: 'READY', approvalId: latest.approval_id });
      continue;
    }

    if (latest.status === 'REJECTED' || latest.status === 'EXPIRED') {
      // REJECTED is a decision. EXPIRED means the window closed without one;
      // either way an unattended loop must not keep the task alive in a state
      // that looks like it is about to run.
      const to = latest.status === 'REJECTED' ? 'REJECTED' : 'BLOCKED';
      updateTaskStatus(task.task_id, to, undefined, workspaceId);
      try {
        recordActivityEvent({
          taskId: task.task_id, expectedWorkspaceId: workspaceId, eventType: 'APPROVAL_DENIED',
          agentId: 'orchestrator',
          payload: { approvalId: latest.approval_id, approvalStatus: latest.status, taskStatus: to, reason: latest.decision_reason },
        });
      } catch { /* same */ }
      resumed.push({ taskId: task.task_id, to, approvalId: latest.approval_id });
    }
    // PENDING / CONSUMED: leave it exactly where it is.
  }

  return resumed;
}

/**
 * One orchestration tick: advance eligible tasks across every workspace.
 *
 * `maxTasks` bounds the tick. Without it a long queue would hold the timer for
 * an unbounded time and the next tick would overlap itself — which is how a
 * task storm starts. Work not reached this tick is reached on the next one.
 *
 * A task that stops at an approval gate does NOT stop the tick: the loop
 * continues to unrelated eligible tasks, which is the behaviour section 4
 * asks for.
 */
export async function runOrchestrationTick(opts: { maxTasks?: number; workspaceId?: string } = {}): Promise<OrchestrationTickResult> {
  const level = resolveAutonomyLevel();
  const maxTasks = Math.max(1, Math.min(opts.maxTasks ?? 3, 25));
  const steps: OrchestrationStep[] = [];
  const stranded: string[] = [];
  const resumed: Array<{ taskId: string; to: string; approvalId: string }> = [];

  if (level === 'MANUAL') {
    return { level, considered: 0, steps, stranded, resumed };
  }

  const workspaceIds = opts.workspaceId
    ? [opts.workspaceId]
    : (listWorkspaces() || []).map((w: any) => w.workspace_id).filter(Boolean);

  let considered = 0;
  for (const workspaceId of workspaceIds) {
    if (steps.length >= maxTasks) break;

    // Notice human decisions FIRST, so a task approved since the last tick is
    // carried forward in this one rather than waiting for another interval.
    for (const r of resumeApprovedTasks(workspaceId)) {
      resumed.push(r);
    }

    // Surface stranded work, never re-run it.
    const strandedCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    for (const s of listStrandedOrchestrationTasks(workspaceId, strandedCutoff)) {
      stranded.push(s.task_id);
    }

    const eligible = listOrchestratorEligibleTasks(workspaceId, maxTasks * 2);
    for (const task of eligible) {
      if (steps.length >= maxTasks) break;
      considered += 1;
      // Re-read immediately before advancing: the row may have changed since
      // the list query, and the claim is what actually decides ownership.
      const fresh = getOrchestratorTask(task.task_id, workspaceId);
      if (!fresh) continue;
      steps.push(await advanceTask(fresh));
    }
  }

  health.lastTickAdvanced = steps.filter((s) => s.outcome === 'ADVANCED').length;
  return { level, considered, steps, stranded, resumed };
}

/**
 * The tick body the scheduler calls. Records health, never throws.
 *
 * Deliberately shaped like runExternalExecutionReconciliation so the scheduler
 * treats all three the same way and one failing does not stop the others.
 */
export async function orchestrationTickForScheduler(): Promise<OrchestrationTickResult | null> {
  health.ticks += 1;
  health.lastTickAt = new Date().toISOString();
  health.running = true;
  try {
    return await runOrchestrationTick({ maxTasks: 3 });
  } catch (err: any) {
    health.tickErrors += 1;
    health.lastError = { at: new Date().toISOString(), message: scrubSecrets(err?.message || String(err), 300) };
    return null;
  }
}
