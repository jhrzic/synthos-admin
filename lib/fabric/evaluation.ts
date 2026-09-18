// ---------------------------------------------------------------------------
// EXPLICIT MODEL EVALUATION — a separately initiated execution, never a side
// effect of a task finishing.
//
// This replaces the legacy "Aegis Judge": a second, hidden model call that
// the task board fired after every successful task, outside the task's
// identity, with no Aegis review, no receipt, and a verdict that silently
// moved the original task's card. Deterministic contract verification remains
// the success gate. Model-based evaluation is kept as a capability, but only
// like this:
//
//   preview (no side effects)   → identity, registry availability, Guardian
//                                  decision, spend-guard dry-run estimate and
//                                  price version. No task, no ledger row.
//   run (explicitly confirmed)  → its OWN child task id, Guardian checked
//                                  independently, dispatched through the
//                                  canonical kernel: spend guard (budget
//                                  reservation, immutable price snapshot,
//                                  approval threshold), ledger row, scoped
//                                  Aegis on a JSON_OBJECT contract, receipt.
//
// It reads the parent's artifact and never writes to the parent: status,
// artifact, review and receipts of the evaluated task are left untouched.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import fs from 'node:fs';
import { getTaskWithHistory, getTaskArtifacts, recordActivityEvent } from '../persistence';
import { guardianCheckInstruction } from '../external-executions';
import { resolveRoute, evaluateModel } from '../registry';
import { previewPaidCall } from '../spend/guard';
import { getSpendPolicy, getModelPrice } from '../spend/policy';
import { executeAgentTask } from './kernel';
import type { ExecutionContext } from './types';
import type { OutputContract } from './output-contract';

export const EVALUATION_CONTRACT: OutputContract = { mode: 'JSON_OBJECT', requiredKeys: ['verdict', 'rationale'] };
const MAX_ARTIFACT_CHARS = 20_000;

type Refusal = { ok: false; status: number; code: string; error: string };

function evaluationInstruction(parentTitle: string, artifact: string): string {
  return [
    `Evaluate the deliverable produced for the task "${parentTitle}".`,
    'Return verdict as one of "APPROVE", "REVISE" or "BLOCK", and rationale as a short explanation grounded only in the deliverable below.',
    '',
    'DELIVERABLE:',
    artifact,
  ].join('\n');
}

function loadParent(parentTaskId: string, workspaceId: string): { ok: true; title: string; status: string; artifactId: string; artifactHash: string; content: string } | Refusal {
  const { task } = getTaskWithHistory(parentTaskId);
  if (!task || task.workspace_id !== workspaceId) return { ok: false, status: 404, code: 'TASK_NOT_FOUND', error: 'The task to evaluate was not found in this workspace.' };
  const artifact = getTaskArtifacts(parentTaskId).slice(-1)[0];
  if (!artifact) return { ok: false, status: 409, code: 'NO_ARTIFACT', error: 'The task has no artifact to evaluate.' };
  let content = '';
  try { content = fs.readFileSync(artifact.disk_path, 'utf8'); } catch { return { ok: false, status: 409, code: 'ARTIFACT_UNREADABLE', error: 'The task artifact could not be read.' }; }
  const hash = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  if (hash !== artifact.content_hash) return { ok: false, status: 409, code: 'ARTIFACT_INTEGRITY_FAILED', error: 'The task artifact no longer matches its recorded hash; it will not be evaluated.' };
  return { ok: true, title: task.title, status: task.status, artifactId: artifact.artifact_id, artifactHash: artifact.content_hash, content: content.slice(0, MAX_ARTIFACT_CHARS) };
}

export interface EvaluationPreview {
  ok: true;
  parentTaskId: string;
  parentStatus: string;
  artifactId: string;
  model: { requested: string; providerId: string; modelId: string };
  availability: { state: string; executable: boolean; blockers: Array<{ state: string; reason: string }> };
  guardian: { allowed: boolean; error: string | null };
  estimate: { permitted: boolean; code: string | null; reason: string | null; estimatedMaxUsd: number | null; priceVersion: string | null; approvalRequired: boolean };
  outputContract: OutputContract;
  sideEffects: 'NONE';
}

export function previewEvaluation(p: { parentTaskId: string; workspaceId: string; model: string }): EvaluationPreview | Refusal {
  const parent = loadParent(p.parentTaskId, p.workspaceId);
  if (!parent.ok) return parent;
  const route = resolveRoute(p.model);
  if (!route.ok) return { ok: false, status: 400, code: route.code, error: route.reason };
  const view = evaluateModel(route.providerId, route.modelId, { workspaceId: p.workspaceId, outputContract: 'JSON_OBJECT' })!;
  const instruction = evaluationInstruction(parent.title, parent.content);
  const guardian = guardianCheckInstruction(instruction);
  const policy = getSpendPolicy();
  // A dry run of the SAME authorization the real call will face. It reserves
  // nothing and writes no ledger row.
  const dry = previewPaidCall({
    provider: route.providerId, model: route.modelId, callSite: 'evaluation.preview', workspaceId: p.workspaceId,
    idempotencyKey: `evaluation-preview:${p.parentTaskId}:${crypto.randomUUID()}`, inputChars: instruction.length + 600,
    maxOutputTokens: policy.task.maxOutputTokens,
  });
  const price = getModelPrice(route.providerId, route.modelId);
  return {
    ok: true,
    parentTaskId: p.parentTaskId, parentStatus: parent.status, artifactId: parent.artifactId,
    model: { requested: p.model, providerId: route.providerId, modelId: route.modelId },
    availability: { state: view.availability, executable: view.executable, blockers: view.blockers },
    guardian: { allowed: guardian.allowed, error: guardian.allowed ? null : guardian.error ?? 'refused' },
    estimate: {
      permitted: dry.permitted, code: dry.permitted ? null : dry.code, reason: dry.permitted ? null : dry.reason,
      estimatedMaxUsd: dry.estimatedCostUsd ?? null, priceVersion: price?.versionKey ?? null,
      approvalRequired: !dry.permitted && dry.code === 'APPROVAL_REQUIRED_EXPENSIVE',
    },
    outputContract: EVALUATION_CONTRACT,
    sideEffects: 'NONE',
  };
}

export async function runEvaluation(p: { parentTaskId: string; workspaceId: string; model: string; actorUserId: string; ctx: ExecutionContext }): Promise<{ ok: true; evaluationTaskId: string; status: number; body: any } | Refusal> {
  const parent = loadParent(p.parentTaskId, p.workspaceId);
  if (!parent.ok) return parent;
  const route = resolveRoute(p.model);
  if (!route.ok) return { ok: false, status: 400, code: route.code, error: route.reason };
  const instruction = evaluationInstruction(parent.title, parent.content);
  // Guardian, independently of the evaluated task's own history.
  const guardian = guardianCheckInstruction(instruction);
  if (!guardian.allowed) return { ok: false, status: 403, code: 'GUARDIAN_BLOCKED', error: guardian.error || 'Guardian refused the evaluation instruction.' };

  const evaluationTaskId = `eval-${p.parentTaskId}-${crypto.randomBytes(4).toString('hex')}`;
  recordActivityEvent({
    taskId: p.parentTaskId, expectedWorkspaceId: p.workspaceId, eventType: 'EVALUATION_REQUESTED', agentId: 'operator',
    payload: { evaluationTaskId, requestedBy: p.actorUserId, providerId: route.providerId, modelId: route.modelId, artifactId: parent.artifactId, artifactHash: parent.artifactHash },
  });
  const result = await executeAgentTask({
    taskId: evaluationTaskId,
    taskTitle: `Evaluation of ${p.parentTaskId}`,
    description: instruction,
    assignedAgent: 'evaluator',
    assignedModel: `${route.providerId}/${route.modelId}`,
    outputContract: EVALUATION_CONTRACT,
    spendIdempotencyKey: `evaluation:${evaluationTaskId}`,
  }, p.workspaceId, p.ctx);
  try {
    recordActivityEvent({
      taskId: evaluationTaskId, expectedWorkspaceId: p.workspaceId, eventType: 'EVALUATION_OF', agentId: 'operator',
      payload: { parentTaskId: p.parentTaskId, artifactId: parent.artifactId, artifactHash: parent.artifactHash, requestedBy: p.actorUserId },
    });
  } catch { /* the kernel refused before creating the task; its response says why */ }
  return { ok: true, evaluationTaskId, status: result.status, body: result.body };
}
