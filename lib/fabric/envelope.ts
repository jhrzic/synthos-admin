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
} from '../persistence';
import { verifyTaskAtGate } from '../kil-gate';
import { indexVaultArtifact, searchWorkspaceMemory } from '../memory-index';
import { writeWorkspaceArtifact, listWorkspaceVaultEntries } from '../vault';
import * as windmillClient from '../windmill-client';
import { listWorkspaceExternalExecutions } from '../external-executions';

export type EnvelopeOutcome = 'SUCCESS' | 'READ_OK' | 'BLOCKED' | 'NOT_CONFIGURED' | 'APPROVAL_REQUIRED' | 'FAILED';

export interface ExecutionEnvelopeInput {
  workspaceId: string;
  actorUserId: string;
  /** A registry key (lib/fabric/registry.ts) — the caller must have already resolved this via classifyIntent(). */
  capability: string;
  action: string;
  parameters: Record<string, unknown>;
  /** The original request text. Used only as content/query input for capabilities that need it (research query, a note's body) — never persisted beyond what that capability would honestly record. */
  rawText: string;
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
}

// EXTERNAL_ACTION capabilities Jarvis (or any envelope caller) may still
// execute despite approvalPolicy !== 'GUARDIAN_ENFORCED' — an explicit,
// narrow, named exception, not a general weakening of Section 7's rule.
// vault.write's current canonical policy (Step 2/4: POST /api/vault/notes
// writes directly, no Aegis/receipt/approval gate) already treats a
// caller's own workspace as approval-free; recorded here rather than
// silently special-cased inline in the dispatch switch below.
const EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE = new Set<string>(['vault.write']);

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
async function executeVaultWrite(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const taskId = `jarvis-vault-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
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
    artifact: { id: artifact.artifact_id, path: artifact.relative_path, contentHash: artifact.content_hash },
  };
}

async function executeResearch(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    // Discovery itself (GitHub Search) needs no Gemini key — this gate
    // exists because synthesis (A3) is a required step of this capability
    // whenever it runs, not an optional enhancement.
    return { outcome: 'NOT_CONFIGURED', capability: 'research', reason: 'GEMINI_API_KEY is not configured — the synthesis step requires a real Gemini call.' };
  }

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
    workspaceId: input.workspaceId,
    title: `Research — ${result.query.slice(0, 80)}`,
    description: `Live research: ${result.query}`,
    assignedAgent: 'research',
    content: result.reportMarkdown,
    folder: 'Research',
    toolsInvoked: ctx.getInvocations().map((r) => r.name),
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
  workspaceId: string;
  title: string;
  description: string;
  assignedAgent: string;
  content: string;
  folder: string;
  toolsInvoked: string[];
}): Promise<ExecutionEnvelopeResult> {
  const taskId = `jarvis-${params.assignedAgent}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
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
