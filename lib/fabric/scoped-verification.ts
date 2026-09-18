// ---------------------------------------------------------------------------
// SCOPED VERIFICATION — the one post-artifact authority every execution path
// uses (kernel task, graph node, graph-run aggregate, envelope tool artifact,
// Antigravity/Windmill ingestion, AEO report, conversation summary).
//
// Before this, each path ran Aegis's INTEGRITY audit and treated its VERIFIED
// as the whole verdict, then signed a receipt, went DONE and fed the Brain.
// That is how the first live proof shipped a truncated, instruction-ignoring
// memo as "verified". The contract/scopes live in ./output-contract.ts; this
// file is the shared glue so no path re-implements them:
//
//   runScopedAegis()        integrity audit + completion + instruction
//                           compliance → one review-shaped result
//   receiptOutcomeFields()  outcome + verificationScope for a COMPLETED receipt
//   commitContentFailure()  the failure branch: AUDIT receipt stating the
//                           outcome, artifact QUARANTINED (evidence kept),
//                           terminal INCOMPLETE / VERIFICATION_FAILED, no
//                           knowledge promotion, no indexing
//
// It is not a second verifier: integrity is still
// persistence.runDeterministicAegisVerification, the content scopes are still
// output-contract.verifyContent, receipts are still signed by
// persistence.signReceiptPayload, quarantine is still memory-index's.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import {
  runDeterministicAegisVerification, recordActivityEvent, updateTaskStatus, recordReceipt,
  canonicalizePayload, signReceiptPayload, verifyReceiptSignature, type CanonicalReceiptPayload,
  createInitialTask, recordQualityReview,
} from '../persistence';
import { writeWorkspaceArtifact } from '../vault';
import { quarantineArtifact } from '../memory-index';
import { verifyContent, type OutputContract, type ProviderTermination, type ContentVerification } from './output-contract';

/**
 * Output SynthOS built itself in code (a deterministic report, a transcript,
 * a local tool result). There is no provider that could have been cut off, so
 * completion is COMPLETE by construction — and labelled as such, never as a
 * provider report.
 */
export const DETERMINISTIC_COMPLETION: ProviderTermination = { status: 'COMPLETE', providerStatus: 'DETERMINISTIC_LOCAL', reason: null };

/**
 * The external-runtime equivalent of openAiTermination / geminiTermination:
 * maps what Antigravity or Windmill reported, plus what SynthOS itself did to
 * the result, onto the one ProviderTermination the verifier reads.
 *
 * Ingestion only runs for a remote job the ledger saw reach its terminal
 * success state (Antigravity `completed`, Windmill `success: true`);
 * Antigravity `incomplete` / `failed` and Windmill `success: false` end FAILED
 * before ingestion and never reach this. What remains is SynthOS's own read
 * of the result: if it was cut at the byte ceiling, the artifact is not the
 * whole answer and completion FAILS — the same rule as a provider reaching
 * its output cap.
 */
export function externalRuntimeTermination(params: { runtime: string; ledgerStatus: string; resultTruncated: boolean }): ProviderTermination {
  const providerStatus = `${params.runtime}:${params.ledgerStatus}`;
  return params.resultTruncated
    ? { status: 'INCOMPLETE', providerStatus, reason: 'RESULT_BYTE_CEILING' }
    : { status: 'COMPLETE', providerStatus, reason: null };
}

export interface ScopedAegisResult {
  integrity: ReturnType<typeof runDeterministicAegisVerification>;
  content: ContentVerification;
  /** Review-shaped: pass straight to recordQualityReview. */
  review: {
    reviewer: string;
    method: string;
    score: number | null;
    decision: ContentVerification['decision'];
    checks: Array<{ check: string; status: 'PASS' | 'FAIL'; evidence: string }>;
    evidence: Record<string, any>;
  };
}

export function runScopedAegis(params: { taskId: string; output: string; termination: ProviderTermination; contract: OutputContract }): ScopedAegisResult {
  const integrity = runDeterministicAegisVerification(params.taskId, params.output);
  const content = verifyContent({ integrityDecision: integrity.decision, output: params.output, termination: params.termination, contract: params.contract });
  return {
    integrity,
    content,
    review: {
      reviewer: integrity.reviewer,
      method: `${integrity.method}+COMPLETION+INSTRUCTION_COMPLIANCE`,
      score: content.decision === 'VERIFIED' ? integrity.score : 0,
      decision: content.decision,
      checks: [...integrity.checks.map((c) => ({ ...c, check: `integrity:${c.check}` })), ...content.checks],
      evidence: { ...integrity.evidence, verificationScopes: content.scopes, scopeStatement: content.scopeStatement, termination: params.termination, outputContract: params.contract },
    },
  };
}

/** Fields a COMPLETED receipt carries so it states exactly what it attests to. */
export function receiptOutcomeFields(content: ContentVerification): Pick<CanonicalReceiptPayload, 'outcome' | 'verificationScope'> {
  return { outcome: 'COMPLETED', verificationScope: content.scopeStatement };
}

/** True when a content failure (integrity passed) must take the failure branch. */
export function isContentFailure(content: ContentVerification): boolean {
  return content.taskStatus === 'INCOMPLETE' || content.taskStatus === 'VERIFICATION_FAILED';
}

/**
 * The failure branch, identical for every path. The artifact is real and
 * intact, so it gets an integrity/AUDIT receipt — whose signed payload states
 * the outcome, so it can never be read as a completed task. The artifact is
 * quarantined (file, hash, rows, receipts and events kept; excluded from
 * searchable memory). The task ends in the terminal failure state. No
 * knowledge promotion, no indexing.
 */
export function commitContentFailure(params: {
  taskId: string;
  workspaceId: string;
  reviewId: string;
  scoped: ScopedAegisResult;
  artifact: { artifact_id: string; content_hash: string };
  identity: { assignedAgent: string; provider: string; modelUsed: string };
  nowIso: string;
}): { receiptId: string | null; status: 'INCOMPLETE' | 'VERIFICATION_FAILED' } {
  const { taskId, workspaceId, scoped, nowIso } = params;
  const outcome = scoped.content.taskStatus as 'INCOMPLETE' | 'VERIFICATION_FAILED';

  recordActivityEvent({
    taskId, expectedWorkspaceId: workspaceId, agentId: 'aegis',
    eventType: outcome === 'INCOMPLETE' ? 'AEGIS_INCOMPLETE' : 'AEGIS_INSTRUCTION_FAILED',
    payload: { reviewId: params.reviewId, decision: scoped.review.decision, verificationScopes: scoped.content.scopes, checks: scoped.review.checks },
    createdAt: nowIso,
  });

  let receiptId: string | null = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const payload: CanonicalReceiptPayload = {
    receiptId, taskId, reviewId: params.reviewId, workspaceId,
    assignedAgent: params.identity.assignedAgent, provider: params.identity.provider, modelUsed: params.identity.modelUsed,
    artifactId: params.artifact.artifact_id, artifactHash: params.artifact.content_hash,
    aegisDecision: scoped.review.decision, aegisMethod: scoped.review.method,
    outcome, verificationScope: scoped.content.scopeStatement, createdAt: nowIso,
  };
  const str = canonicalizePayload(payload);
  const signed = signReceiptPayload(str);
  if (verifyReceiptSignature(str, signed.signature, signed.publicKeyPem)) {
    recordReceipt({ receiptId, taskId, reviewId: params.reviewId, algorithm: signed.algorithm, publicKey: signed.publicKeyPem, payloadJson: str, signature: signed.signature, createdAt: nowIso });
    recordActivityEvent({
      taskId, expectedWorkspaceId: workspaceId, eventType: 'AUDIT_RECEIPT_CREATED', agentId: 'guardian',
      payload: { receiptId, algorithm: signed.algorithm, fingerprint: signed.fingerprint, outcome, verified: true },
      createdAt: nowIso,
    });
  } else {
    receiptId = null;
  }

  try {
    quarantineArtifact({ workspaceId, artifactId: params.artifact.artifact_id, actor: 'aegis', reason: `Aegis ${outcome}: ${scoped.content.scopeStatement}` });
  } catch (err: any) {
    console.warn('[Memory Index] Quarantine failed:', err?.message || err);
  }

  updateTaskStatus(taskId, outcome, undefined, workspaceId);
  return { receiptId, status: outcome };
}

/**
 * GRAPH NODE — the evidence a failed native node leaves behind.
 *
 * A passing native (COMPUTE) node deliberately gets no task of its own: its
 * output is attested once, in the graph run's aggregate artifact and receipt.
 * A node whose output fails its contract never reaches that aggregate — the
 * graph halts — so without this its bad output would exist only as a trace
 * string. Instead it goes through the same lifecycle as every other artifact:
 * task, Vault artifact, scoped Aegis review and, for a content failure, the
 * shared failure branch (audit receipt stating the outcome, quarantine,
 * terminal INCOMPLETE / VERIFICATION_FAILED). Integrity is re-run for real
 * here, so the node's recorded integrity scope is an actual audit result.
 */
export function commitFailedNodeEvidence(params: {
  taskId: string;
  workspaceId: string;
  title: string;
  description: string;
  assignedAgent: string;
  modelUsed: string;
  output: string;
  termination: ProviderTermination;
  contract: OutputContract;
  graphRunId: string;
  graphNodeId: string;
}): { taskId: string; status: string; scoped: ScopedAegisResult; reviewId: string; artifact: { id: string; filePath: string; contentHash: string }; receiptId: string | null } {
  const { taskId, workspaceId } = params;
  const nowIso = new Date().toISOString();
  createInitialTask({ taskId, workspaceId, title: params.title, description: params.description, assignedAgent: params.assignedAgent, assignedModel: params.modelUsed, createdAt: nowIso });
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'TASK_CREATED', agentId: 'graph-runtime', payload: { title: params.title, status: 'TODO', graphRunId: params.graphRunId, graphNodeId: params.graphNodeId }, createdAt: nowIso });
  updateTaskStatus(taskId, 'READY', undefined, workspaceId);
  updateTaskStatus(taskId, 'RUNNING', undefined, workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'EXECUTION_STARTED', agentId: params.assignedAgent, payload: { status: 'RUNNING', graphRunId: params.graphRunId, graphNodeId: params.graphNodeId } });
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'PROVIDER_COMPLETED', agentId: params.assignedAgent, payload: { model: params.modelUsed, outputLength: params.output.length, termination: params.termination, outputContract: params.contract }, createdAt: nowIso });

  const artifact = writeWorkspaceArtifact({ workspaceId, taskId, content: params.output, folder: 'Graph-Runs', extension: 'md', createdAt: nowIso });
  recordActivityEvent({
    taskId, expectedWorkspaceId: workspaceId, eventType: 'ARTIFACT_SAVED', agentId: params.assignedAgent,
    payload: { artifactId: artifact.artifact_id, relativePath: artifact.relative_path, diskPath: artifact.disk_path, contentHash: artifact.content_hash, sizeBytes: artifact.size_bytes },
    createdAt: nowIso,
  });

  updateTaskStatus(taskId, 'AWAITING_VERIFICATION', undefined, workspaceId);
  const scoped = runScopedAegis({ taskId, output: params.output, termination: params.termination, contract: params.contract });
  const review = recordQualityReview({ taskId, reviewer: scoped.review.reviewer, method: scoped.review.method, score: scoped.review.score, decision: scoped.review.decision, checks: scoped.review.checks, evidence: scoped.review.evidence, createdAt: nowIso });

  let receiptId: string | null = null;
  let status: string;
  if (isContentFailure(scoped.content)) {
    const failure = commitContentFailure({
      taskId, workspaceId, reviewId: review.review_id, scoped, artifact,
      identity: { assignedAgent: params.assignedAgent, provider: 'synthos-graph-runtime', modelUsed: params.modelUsed }, nowIso,
    });
    receiptId = failure.receiptId;
    status = failure.status;
  } else {
    // Integrity itself failed (or was inconclusive): FAILED, no receipt,
    // and the artifact is quarantined so it cannot surface in retrieval.
    status = 'FAILED';
    updateTaskStatus(taskId, 'FAILED', undefined, workspaceId);
    recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'AEGIS_REVIEWED', agentId: 'aegis', payload: { reviewId: review.review_id, decision: scoped.review.decision, verificationScopes: scoped.content.scopes }, createdAt: nowIso });
    try {
      quarantineArtifact({ workspaceId, artifactId: artifact.artifact_id, actor: 'aegis', reason: `Aegis ${scoped.review.decision}: ${scoped.content.scopeStatement}` });
    } catch (err: any) {
      console.warn('[Memory Index] Quarantine failed:', err?.message || err);
    }
  }
  return { taskId, status, scoped, reviewId: review.review_id, artifact: { id: artifact.artifact_id, filePath: artifact.relative_path, contentHash: artifact.content_hash }, receiptId };
}
