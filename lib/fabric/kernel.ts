// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 1b kernel.
//
// This is the extraction of POST /api/execute-agent-task's logic out of
// server.ts. It is not a rewrite: every branch, every persistence call,
// every status/event ordering, and every response field below is the exact
// same logic that lived inline in the route (server.ts, up to commit
// 03c0a82 / Phase 0b), moved here unchanged except for two things:
//
// 1. req/res are gone. executeAgentTask() takes the parsed request body,
//    the already-resolved canonical workspaceId (computed by the ingress
//    adapter from real Express auth state — see server.ts), and an
//    ExecutionContext; it returns {status, body} instead of calling
//    res.status().json(). The route in server.ts is now a thin adapter that
//    does exactly that mapping.
// 2. The real Gemini call is now made through ctx.invoke("model.gemini",
//    ...) instead of being called directly. This route never called the
//    shared generateWithFailover() helper (that is /api/generate and
//    /api/jarvis/command's helper, not this route's) — it has always had
//    its own inline multi-candidate retry loop. ctx.invoke() wraps that
//    exact existing loop unchanged; it does not switch to a different
//    retry mechanism.
//
// toolsInvoked (the response's `toolCalls` field) is now derived from
// ctx.getInvocations() — real, observed invocation names — never a
// hardcoded or per-role literal array (Phase 0 / F1 already removed those;
// this step replaces the resulting fixed `[]` with the real mechanism F1's
// own comment said was still missing: "There is no real per-tool invocation
// mechanism... until one exists, this must never claim a tool ran." One now
// exists, scoped to exactly this one real call site.
//
// The Phase 0b fixes (cross-workspace task-id hijack rejection, and the
// receipt using the one canonical resolvedWorkspaceId rather than an
// independent body re-read) are preserved exactly, including their exact
// response shapes — this file's WORKSPACE_MISMATCH branch and canonicalPayload
// construction are unchanged from server.ts's Phase 0b version other than
// the res.status/json -> {status, body} mapping.
//
// PRESERVE EXISTING REAL OWNERSHIP: every persistence/verification/signing
// call below is the same real function this route already called —
// createInitialTask, updateTaskStatus, recordActivityEvent, recordArtifact,
// runDeterministicAegisVerification, recordQualityReview, canonicalizePayload,
// signReceiptPayload, verifyReceiptSignature, recordReceipt, verifyTaskAtGate,
// projectKnowledgeCandidate, indexVaultArtifact, classifyModelRequest,
// getTaskWorkspaceId. None of these were reimplemented, wrapped in a new
// abstraction, or replaced because an architecture document names a
// different-sounding concept for them.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { normalizeOutputContract, buildContractPrompt, type OutputContract, type ProviderTermination } from './output-contract';
import { runScopedAegis, receiptOutcomeFields, commitContentFailure, isContentFailure } from './scoped-verification';
import {
  createInitialTask,
  updateTaskStatus,
  recordActivityEvent,
  recordQualityReview,
  getTaskQualityReviews,
  runDeterministicAegisVerification,
  recordReceipt,
  getTaskReceipts,
  canonicalizePayload,
  signReceiptPayload,
  verifyReceiptSignature,
  verifyReceipt,
  type CanonicalReceiptPayload,
  getTaskWithHistory,
  getTaskActivityEvents,
  getTaskArtifacts,
  getTaskWorkspaceId,
  read_package_metadata,
  projectKnowledgeCandidate,
} from '../persistence';
import { listUsageForKey } from '../spend/ledger';
import { runModelSegments } from '../continuity/segment-runner';
import { continuityView, finish as finishContinuity, closeSegment } from '../continuity/controller';
import { recordPerformanceSample } from '../registry/performance';
import { verifyTaskAtGate } from '../kil-gate';
import { indexVaultArtifact, getArtifactRetrievalStatus } from '../memory-index';
// STEP 2 — the canonical Vault writer (lib/vault.ts). Replaces this file's
// own former direct fs.writeFileSync + recordArtifact() pair; see the
// artifact-write section below for the full rationale.
import { writeWorkspaceArtifact } from '../vault';
// STEP 4 — the real Gemini call mechanics (candidate-model retry loop) now
// live in lib/fabric/model-gemini.ts, shared with graph execution's native
// COMPUTE nodes (server.ts POST /api/graphs/execute). buildAgentRolePrompt
// below is exported so the graph route can build the exact same persona
// prompt for a node as this route would — required for graph node output
// to remain equivalent to before, not because graph execution needs an
// agent-persona concept of its own.
// PUSH 1 — the OpenAI counterpart of model-gemini.ts, same shape, same
// never-throws contract. Imported alongside it rather than behind a new
// abstraction: two providers do not justify a plugin layer, and the one
// switch below is easier to read than an indirection would be.
import type { ExecuteAgentTaskInput, ExecutionResult, ExecutionContext } from './types';

/**
 * The provider identity written into a signed receipt. Deliberately the
 * vendor's own name rather than the router's internal enum: a receipt is
 * read by people outside this codebase, and "google-genai" is the exact
 * string every receipt signed before PUSH 1 already carries — changing it
 * would break comparability with the existing signed history.
 */
const LEGACY_RECEIPT_IDENTITY: Record<string, string> = {
  gemini: "google-genai",
};

/**
 * The provider string signed into receipts. Registry provider ids are used
 * as-is; Gemini keeps "google-genai" so receipts stay comparable with every
 * receipt signed before the registry existed. A new provider needs no entry.
 */
export function receiptProviderIdentity(providerId: string): string {
  return LEGACY_RECEIPT_IDENTITY[providerId] ?? providerId;
}

export interface AgentRolePromptParams {
  assignedAgent: string;
  taskTitle: string;
  description: string;
  sourceUrl?: string;
  inputs?: string;
}

/**
 * The exact persona-prompt-building logic this route has always run inline
 * inside its ctx.invoke("model.gemini", ...) callback, extracted verbatim
 * (Step 4) so graph execution's native nodes can build the identical prompt
 * without duplicating it. Pure — no side effects other than the real,
 * evidenced read_package_metadata() disk read for the package-version
 * special case, which was already part of this logic before extraction.
 */
export function buildAgentRolePrompt(params: AgentRolePromptParams): string {
  const { assignedAgent, taskTitle, description, sourceUrl = "", inputs = "" } = params;
  let rolePrompt = "";
  if (assignedAgent === "scout") {
    rolePrompt = `You are the Hermes Scout Research Agent. Execute this task with real-world technical precision:
TASK: "${taskTitle}"
DESCRIPTION: "${description}"
CONTEXT / SOURCE: "${sourceUrl || inputs}"

Produce structured intelligence findings in clean Markdown format:
1. Executive Summary & Core Signals
2. Discovered Architecture / Code Specifications
3. Market & Developer Pain Points
4. Actionable Next Steps for Dev & Scribe`;
  } else if (assignedAgent === "dev") {
    rolePrompt = `You are the Hermes Dev Systems Engineering Agent. Execute this engineering directive:
TASK: "${taskTitle}"
DESCRIPTION: "${description}"
INPUTS / REPO CONTEXT: "${inputs || sourceUrl}"

Produce a production-grade Technical Implementation Blueprint & Verification Spec in Markdown:
1. Architecture & Component Blueprint
2. Concrete Code Implementation / Schema Definition
3. Execution Latency & Performance Profile (<50ms target)
4. Automated Test Harness & Verification Criteria`;
  } else if (assignedAgent === "reach") {
    rolePrompt = `You are the Hermes Reach Growth & Distribution Agent. Execute this GTM directive:
TASK: "${taskTitle}"
DESCRIPTION: "${description}"

Produce a high-leverage Distribution & Go-To-Market Plan in Markdown:
1. ICP Definition & Value Proposition
2. Generative Engine Optimization (GEO) & AEO Citation Strategy
3. Viral Demo & Launch Mechanism
4. Growth Metric Targets & Retention Loops`;
  } else if (assignedAgent === "analytics") {
    rolePrompt = `You are the Hermes Analytics & Token Optimization Agent. Execute this analysis:
TASK: "${taskTitle}"
DESCRIPTION: "${description}"

Produce an analytical telemetry and unit economics breakdown in Markdown:
1. Unit Economics & Token Optimization Analysis
2. Latency & Resource Utilization Breakdown
3. Total Addressable Market (TAM) & Competitive Positioning
4. Strategic Recommendations`;
  } else if (assignedAgent === "scribe") {
    rolePrompt = `You are the Hermes Scribe Knowledge Architect. Synthesize this task into an Obsidian Vault Memo:
TASK: "${taskTitle}"
DESCRIPTION: "${description}"

Produce a comprehensive Obsidian Knowledge Graph Document with at least 5 [[wikilinks]]:
1. Executive Summary
2. Core Thesis & Technical Specifications
3. Interconnected Knowledge Mesh ([[Architecture/Agentic-OS]], [[Aegis-Receipts/Verification]], etc.)
4. Permanent Knowledge Base Takeaways`;
  } else {
    rolePrompt = `You are the Hermes Orchestrator Master Agent. Conduct an executive audit and sign-off:
TASK: "${taskTitle}"
DESCRIPTION: "${description}"

Produce an Orchestrator Executive Sign-Off in Markdown:
1. Swarm Objective & Execution Audit
2. Compliance with Permanent Operating Rules
3. Guardian Aegis Verification Summary
4. State Machine & Board.db State Transition`;
  }

  // Domain-specific grounding for package metadata & version reading tasks
  const isPackageVersionRequest = /package(\.json)?\s*(version|metadata|name)?|version\s+and\s+save/i.test(
    `${taskTitle} ${description}`
  );
  if (isPackageVersionRequest) {
    const packageMetadataResult = read_package_metadata();
    rolePrompt = `You are the SynthOS Runtime Worker Agent.
TASK: "${taskTitle}"
DESCRIPTION: "${description}"

AUTHORITATIVE REAL REPOSITORY EVIDENCE (READ DIRECTLY FROM DISK VIA read_package_metadata):
=== AUTHORITATIVE TOOL EXECUTION RESULT: read_package_metadata ===
source: ${packageMetadataResult.relativePath}
packageName: ${packageMetadataResult.packageName}
packageVersion: ${packageMetadataResult.packageVersion}
sourceHash: ${packageMetadataResult.sourceHash}
absolutePath: ${packageMetadataResult.absolutePath}
==================================================================

CRITICAL EXECUTION CONSTRAINTS:
1. You MUST use and report ONLY the real repository evidence provided above.
2. You are STRICTLY FORBIDDEN from inventing or claiming:
   - Package registries or external API lookups (e.g. PackageRegistry.query)
   - board.db checks or database records
   - Fake cryptographic signatures, keys, or signature language
   - Certificates or root-of-trust claims
   - Network protocols or TLS 1.3 claims
   - Hallucinated version values (you MUST report version: "${packageMetadataResult.packageVersion}")
   - Hallucinated dates or timestamps
   - Audit systems or fictional test suites
   - Any tool executions not present in the evidence above

3. You MUST include this EXACT machine-readable EVIDENCE section in your output:

## EVIDENCE
source: package.json
packageName: ${packageMetadataResult.packageName}
packageVersion: ${packageMetadataResult.packageVersion}
sourceHash: ${packageMetadataResult.sourceHash}

4. Provide a clear, factual, and concise description of the package metadata read from package.json without any fabricated claims.`;
  }

  return rolePrompt;
}

export async function executeAgentTask(
  rawBody: ExecuteAgentTaskInput | null | undefined,
  resolvedWorkspaceId: string,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  try {
    const {
      taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      taskTitle = "",
      description = "",
      assignedAgent = "scout",
      // No default model. A task runs on the model it names, or not at all —
      // choosing one silently would be a fallback nobody selected.
      assignedModel = "",
      inputs = "",
      sourceUrl = "",
      spendIdempotencyKey,
      outputContract: rawOutputContract,
    } = (rawBody || {}) as ExecuteAgentTaskInput;

    // THE TASK CONTRACT decides the output's shape, never the persona. An
    // invalid contract is refused before any provider call (no spend).
    const contractCheck = normalizeOutputContract(rawOutputContract);
    if (!contractCheck.ok) {
      return { status: 400, body: { success: false, status: "FAILED", reason: "INVALID_OUTPUT_CONTRACT", error: contractCheck.error, taskId } };
    }
    const outputContract: OutputContract = contractCheck.contract;

    console.log(`[Agent Execution] Starting execution for Task "${taskTitle}" (${taskId}) via ${assignedAgent} / ${assignedModel}...`);
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // PHASE 0b — cross-workspace task hijack fix (characterized live in
    // e2f0697, LIVE 5; fixed in 03c0a82). resolvedWorkspaceId is the single
    // canonical scope for this whole execution, supplied by the ingress
    // adapter from real authenticated/verified state. If this taskId
    // already exists, its real workspace_id must match before any write —
    // on mismatch, reject before createInitialTask ever runs: zero writes.
    const existingTaskWorkspaceId = getTaskWorkspaceId(taskId);
    if (existingTaskWorkspaceId !== null && existingTaskWorkspaceId !== resolvedWorkspaceId) {
      return {
        status: 403,
        body: {
          success: false,
          status: "BLOCKED",
          reason: "WORKSPACE_MISMATCH",
          error: `Task ${taskId} belongs to a different workspace and cannot be reused here.`,
          taskId,
        },
      };
    }

    // 1. Persist task as TODO & record TASK_CREATED
    createInitialTask({
      taskId,
      workspaceId: resolvedWorkspaceId,
      title: taskTitle,
      description,
      assignedAgent,
      assignedModel,
      createdAt: startTimeIso,
    });
    recordActivityEvent({
      taskId,
      expectedWorkspaceId: resolvedWorkspaceId,
      eventType: "TASK_CREATED",
      agentId: "orchestrator",
      payload: { title: taskTitle, status: "TODO" },
      createdAt: startTimeIso,
    });

    // 2. Persist READY status & record AGENT_ASSIGNED
    updateTaskStatus(taskId, "READY", undefined, resolvedWorkspaceId);
    recordActivityEvent({
      taskId,
      expectedWorkspaceId: resolvedWorkspaceId,
      eventType: "AGENT_ASSIGNED",
      agentId: assignedAgent,
      payload: { agent: assignedAgent, model: assignedModel, status: "READY" },
    });

    // ROUTING + CONTINUITY — the canonical router selects a QUALIFIED route
    // for this task class (a named model is a pinned route: validated, never
    // substituted), the decision is persisted before anything is sent, and
    // the continuity controller runs the work as segments. Capacity, budget
    // and ambiguous outcomes pause or reconcile the task — they never become
    // a generic FAILED, and nothing switches to an unqualified or weaker
    // route. See lib/continuity/segment-runner.ts.
    const rolePrompt = outputContract.mode === 'NARRATIVE'
      ? buildAgentRolePrompt({ assignedAgent, taskTitle, description, sourceUrl, inputs })
      : buildContractPrompt(outputContract, taskTitle, description);
    const run = await runModelSegments({
      taskId, workspaceId: resolvedWorkspaceId, assignedAgent, assignedModel, taskTitle, description,
      firstPrompt: rolePrompt, outputContract, taskClass: (rawBody as any)?.taskClass ?? null,
      routing: (rawBody as any)?.routing ?? null, privacyClass: (rawBody as any)?.privacyClass ?? null,
      spendIdempotencyKey, invoke: (name, fn) => ctx.invoke(name, fn),
      // The task claims RUNNING only after identity, contract and credential
      // checks pass — a refusal goes READY → FAILED, never through RUNNING.
      onRunning: () => {
        updateTaskStatus(taskId, "RUNNING", undefined, resolvedWorkspaceId);
        recordActivityEvent({
          taskId,
          expectedWorkspaceId: resolvedWorkspaceId,
          eventType: "EXECUTION_STARTED",
          agentId: assignedAgent,
          payload: { model: assignedModel || '(router-selected)', status: "RUNNING" },
        });
      },
    });

    if (run.kind === 'REFUSED') {
      updateTaskStatus(taskId, run.code === 'GUARDIAN_REFUSED' ? "BLOCKED" : "FAILED", undefined, resolvedWorkspaceId);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: run.eventType,
        agentId: assignedAgent,
        payload: { reason: run.code, error: run.error, ...(run.requestedModel !== undefined ? { requestedModel: run.requestedModel } : {}) },
      });
      return {
        status: run.httpStatus,
        body: { success: false, status: run.blocked ? "BLOCKED" : "FAILED", reason: run.code, error: run.error, ...(run.requestedModel !== undefined ? { requestedModel: run.requestedModel } : {}), taskId },
      };
    }
    if (run.kind === 'PAUSED' || run.kind === 'RECONCILING') {
      // Non-terminal: the scheduler's continuity sweep (or an operator)
      // resumes it. Nothing is lost; the checkpoint says where it stopped.
      const state = run.kind === 'PAUSED' ? run.state : 'RECONCILING_UNKNOWN_EXECUTION';
      return {
        status: 202,
        body: {
          success: false, status: state, reason: state, error: run.reason, taskId,
          routingDecision: run.kind === 'PAUSED' && run.decision ? { decisionId: run.decision.decisionId, outcome: run.decision.outcome, waitState: run.decision.waitState, explanation: run.decision.explanation } : null,
          continuity: continuityView(taskId),
        },
      };
    }
    if (run.kind === 'PROVIDER_FAILED') {
      // Provider fails: PROVIDER_FAILED, task FAILED, no artifact, no fake
      // verification, no DONE. (Capacity and ambiguous failures never reach
      // here — they pause or reconcile above.)
      updateTaskStatus(taskId, "FAILED", undefined, resolvedWorkspaceId);
      finishContinuity(taskId, 'FAILED', run.error);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: "PROVIDER_FAILED",
        agentId: assignedAgent,
        payload: { error: run.lastProviderError || "Empty response from provider", hadProviderError: run.hadProviderError },
      });
      return run.code === 'MODEL_PROVIDER_UNAVAILABLE'
        ? { status: 502, body: { success: false, status: "FAILED", reason: "MODEL_PROVIDER_UNAVAILABLE", error: run.error, lastProviderError: run.lastProviderError, taskId } }
        : { status: 502, body: { success: false, status: "FAILED", reason: "EMPTY_PROVIDER_RESPONSE", error: "Model provider returned an empty or unparseable response", taskId } };
    }

    const provider = run.providerId;
    const canonicalModelId = run.modelId;
    const executionOutput = run.output;
    const modelUsed = run.modelUsed || canonicalModelId;
    const providerUsageMetadata = run.usageMetadata;
    const providerTermination: ProviderTermination = run.termination;

    // Provider succeeds:
    // persist PROVIDER_COMPLETED
    recordActivityEvent({
      taskId,
      expectedWorkspaceId: resolvedWorkspaceId,
      eventType: "PROVIDER_COMPLETED",
      agentId: assignedAgent,
      payload: {
        model: modelUsed,
        // PUSH 1 — the activity ledger records WHICH provider ran, not just
        // which model string came back. Two providers can return similar
        // looking ids; the knowledge layer downstream must not have to guess.
        provider: receiptProviderIdentity(provider),
        outputLength: executionOutput.length,
        usage: providerUsageMetadata || null,
        // How the PROVIDER says the response ended — the fact that decides
        // whether this output is complete, captured as reported.
        termination: providerTermination,
        outputContract: outputContract.mode,
      },
    });

    const elapsedMs = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    // The ledger row this execution reserved and dispatched under — its price
    // snapshot is immutable, so the receipt names it rather than re-pricing.
    const lastKey = run.successUsageKeys[run.successUsageKeys.length - 1];
    const usageRow = lastKey ? listUsageForKey(lastKey).filter((r) => r.status === 'SUCCESS').pop() ?? null : null;
    const registryEvidence = {
      registryProviderId: provider,
      canonicalModelId,
      priceVersion: usageRow?.price_version ?? null,
      usageId: usageRow?.usage_id ?? null,
    };
    // ROUTING EVIDENCE — signed into the receipt beside the registry identity.
    const routingEvidence = {
      canonicalVersionId: run.decision.selected?.canonicalVersionId ?? null,
      routeProviderId: provider,
      deploymentId: run.decision.selected?.deploymentId ?? null,
      routingDecisionId: run.decision.decisionId,
      qualificationId: run.qualificationId,
      taskClass: run.taskClass,
      segmentIds: run.segments.map((x) => x.segmentId),
      segmentCount: run.segments.length,
    };

    // STEP 2 — the artifact write and its DB record both now go through
    // writeWorkspaceArtifact() (lib/vault.ts), the one canonical Vault
    // writer. Before this, the route both wrote the file itself
    // (fs.writeFileSync) AND called recordArtifact(), which performs its own
    // internal fs.writeFileSync to the same path — a real, harmless but
    // duplicate write. Now there is exactly one write path. Storage
    // identity is workspace-scoped and server-generated
    // (vault/workspaces/<id>/Startup-Theses/<artifactId>.md) instead of the
    // old flat vault/Startup-Theses/${sanitizedTitle}.md — which let two
    // tasks anywhere sharing a sanitized title silently overwrite each
    // other's file (characterized in test/fabric-characterization.test.ts,
    // DEFERRED item B — now fixed, not merely documented). The real
    // relative_path is only known once writeWorkspaceArtifact() generates
    // it, so the old "**Vault Path**: `...`" header line (which had to
    // guess the path before writing) is dropped rather than filled with a
    // placeholder that would be baked, wrong, into the saved document
    // itself — the real path is already on the persisted artifact record
    // and in the API response, which is where a caller should read it from.
    const artifactContent = `# ${taskTitle}\n\n**Executed by**: ${assignedAgent.toUpperCase()} (${modelUsed})\n**Timestamp**: ${nowIso}\n\n---\n\n${executionOutput}\n`;

    const persistedArtifact = writeWorkspaceArtifact({
      workspaceId: resolvedWorkspaceId,
      taskId,
      content: artifactContent,
      folder: 'Startup-Theses',
      extension: 'md',
      createdAt: nowIso,
    });

    recordActivityEvent({
      taskId,
      expectedWorkspaceId: resolvedWorkspaceId,
      eventType: "ARTIFACT_SAVED",
      agentId: assignedAgent,
      payload: {
        artifactId: persistedArtifact.artifact_id,
        relativePath: persistedArtifact.relative_path,
        diskPath: persistedArtifact.disk_path,
        contentHash: persistedArtifact.content_hash,
        sizeBytes: persistedArtifact.size_bytes,
      },
      createdAt: nowIso,
    });

    // Temporary state: AWAITING_VERIFICATION before Aegis inspection
    updateTaskStatus(taskId, "AWAITING_VERIFICATION", undefined, resolvedWorkspaceId);

    // AEGIS, three scopes. The deterministic audit is the INTEGRITY scope
    // (artifact exists, hash matches, ledger sequence) and proves nothing
    // about whether the answer is right. COMPLETION (did the provider finish)
    // and INSTRUCTION_COMPLIANCE (does the output satisfy the task contract)
    // are evaluated beside it. The recorded decision is VERIFIED only when
    // every scope the contract requires passed, and the review states the
    // scopes explicitly.
    const scoped = runScopedAegis({ taskId, output: executionOutput, termination: providerTermination, contract: outputContract });
    const content = scoped.content;
    const aegisResult = scoped.review;

    // Persist quality review to SQLite quality_reviews table
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

    let receiptId: string | undefined;

    // Handle Aegis verification decision according to specification
    if (aegisResult.decision === "VERIFIED") {
      // Transition to AWAITING_RECEIPT
      updateTaskStatus(taskId, "AWAITING_RECEIPT", undefined, resolvedWorkspaceId);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: "AEGIS_REVIEWED",
        agentId: "aegis",
        payload: {
          reviewId: persistedReview.review_id,
          decision: "VERIFIED",
          score: aegisResult.score,
          verificationScopes: content.scopes,
          checks: aegisResult.checks,
        },
        createdAt: nowIso,
      });

      // ---------------------------------------------------------------------
      // Step 4 Execution Spine: Real Cryptographic Execution Receipt Signing
      // ---------------------------------------------------------------------
      receiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const canonicalPayload: CanonicalReceiptPayload & typeof routingEvidence = {
        receiptId,
        taskId,
        reviewId: persistedReview.review_id,
        // PHASE 0b — this used to independently re-read the request body's
        // workspaceId field with its own separate fallback default, which
        // could disagree with the workspace the task/artifact/review were
        // actually recorded under. The receipt attests to the same
        // resolvedWorkspaceId everything else in this execution used —
        // never a second, independent guess at it.
        workspaceId: resolvedWorkspaceId,
        assignedAgent,
        // PUSH 1 — the receipt attests to the provider that ACTUALLY
        // executed, resolved from the same classification the dispatch
        // used. This was the literal "google-genai" when Gemini was the
        // only executable provider; leaving it literal once a second
        // provider exists would have signed a false statement about which
        // company processed the customer's prompt.
        provider: receiptProviderIdentity(provider),
        modelUsed,
        ...registryEvidence,
        ...routingEvidence,
        artifactId: persistedArtifact.artifact_id,
        artifactHash: persistedArtifact.content_hash,
        aegisDecision: aegisResult.decision,
        aegisMethod: aegisResult.method,
        ...receiptOutcomeFields(content),
        createdAt: nowIso,
      };

      const canonicalPayloadStr = canonicalizePayload(canonicalPayload);
      const { signature, publicKeyPem, algorithm, fingerprint } = signReceiptPayload(canonicalPayloadStr);

      // Immediate cryptographic signature verification
      const receiptVerificationPassed = verifyReceiptSignature(canonicalPayloadStr, signature, publicKeyPem);

      if (receiptVerificationPassed) {
        // Persist receipt in SQLite
        recordReceipt({
          receiptId,
          taskId,
          reviewId: persistedReview.review_id,
          algorithm,
          publicKey: publicKeyPem,
          payloadJson: canonicalPayloadStr,
          signature,
          createdAt: nowIso,
        });

        // Persist RECEIPT_CREATED activity event
        recordActivityEvent({
          taskId,
          expectedWorkspaceId: resolvedWorkspaceId,
          eventType: "RECEIPT_CREATED",
          agentId: "guardian",
          payload: {
            receiptId,
            algorithm,
            fingerprint,
            signature,
            verified: true,
          },
          createdAt: nowIso,
        });

        // Transition task status to DONE
        updateTaskStatus(taskId, "DONE", undefined, resolvedWorkspaceId);

        // Persist TASK_COMPLETED activity event
        recordActivityEvent({
          taskId,
          expectedWorkspaceId: resolvedWorkspaceId,
          eventType: "TASK_COMPLETED",
          agentId: assignedAgent,
          payload: {
            receiptId,
            status: "DONE",
            elapsedMs,
          },
          createdAt: nowIso,
        });

        // ---------------------------------------------------------------
        // Knowledge Intelligence Layer (KIL) — deterministic content-quality
        // gate, independent of Aegis's execution-integrity gate above.
        // Isolated in its own try/catch: a KIL failure must never affect
        // the task's own status, the receipt, or this response — matches
        // the source implementation's own rule that a low score is
        // recorded and left alone, never enforced as a blocker here.
        // ---------------------------------------------------------------
        try {
          const gate = verifyTaskAtGate({
            taskId,
            workspaceId: resolvedWorkspaceId,
            title: taskTitle,
            description,
            groundingContext: [taskTitle, description, sourceUrl, inputs].filter(Boolean).join('\n\n'),
            assignedAgent,
            output: executionOutput,
          });

          if (gate.observation.promoted) {
            try {
              projectKnowledgeCandidate({
                workspaceId: resolvedWorkspaceId,
                taskId,
                kilObservationId: gate.observation.observation_id,
                receiptId,
                vaultPath: persistedArtifact.relative_path,
                label: taskTitle,
              });
            } catch (projectErr: any) {
              console.warn("[KIL] Knowledge candidate projection skipped:", projectErr?.message || projectErr);
            }
          }
        } catch (kilErr: any) {
          console.warn("[KIL] Gate verification skipped:", kilErr?.message || kilErr);
        }

        // ---------------------------------------------------------------
        // Local memory index — the artifact just written is real and
        // Aegis-verified with a signed receipt (we're inside the
        // receiptVerificationPassed branch), which is the "verified
        // receipt/artifact relationship" the index prefers to index from.
        // Isolated in its own try/catch: an indexing failure must never
        // affect task completion, the receipt, or this response.
        // ---------------------------------------------------------------
        try {
          indexVaultArtifact(resolvedWorkspaceId, persistedArtifact.artifact_id);
        } catch (indexErr: any) {
          console.warn("[Memory Index] Indexing skipped:", indexErr?.message || indexErr);
        }
      } else {
        // Signature verification failed
        updateTaskStatus(taskId, "FAILED", undefined, resolvedWorkspaceId);
        recordActivityEvent({
          taskId,
          expectedWorkspaceId: resolvedWorkspaceId,
          eventType: "RECEIPT_VERIFICATION_FAILED",
          agentId: "guardian",
          payload: {
            receiptId,
            algorithm,
            error: "Cryptographic signature verification failed on generated receipt",
          },
          createdAt: nowIso,
        });
      }
    } else if (isContentFailure(content)) {
      // Integrity passed, content did not: the shared failure branch (audit
      // receipt stating the outcome, quarantine, terminal status).
      receiptId = commitContentFailure({
        taskId, workspaceId: resolvedWorkspaceId, reviewId: persistedReview.review_id, scoped,
        artifact: persistedArtifact,
        identity: { assignedAgent, provider: receiptProviderIdentity(provider), modelUsed },
        registry: registryEvidence,
        nowIso,
      }).receiptId ?? undefined;
    } else if (aegisResult.decision === "FAILED") {
      updateTaskStatus(taskId, "FAILED", undefined, resolvedWorkspaceId);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: "AEGIS_FAILED",
        agentId: "aegis",
        payload: {
          reviewId: persistedReview.review_id,
          decision: "FAILED",
          checks: aegisResult.checks,
        },
        createdAt: nowIso,
      });
    } else {
      // INCONCLUSIVE
      updateTaskStatus(taskId, "AWAITING_VERIFICATION", undefined, resolvedWorkspaceId);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: "AEGIS_INCONCLUSIVE",
        agentId: "aegis",
        payload: {
          reviewId: persistedReview.review_id,
          decision: "INCONCLUSIVE",
          checks: aegisResult.checks,
        },
        createdAt: nowIso,
      });
    }

    // CONTINUITY CHAIN — every segment names the Aegis review and receipt
    // that judged the assembled output; the routing evidence is recorded for
    // later (approved) routing statistics.
    for (const sg of run.segments) closeSegment(sg.segmentId, { aegisReviewId: persistedReview.review_id, aegisDecision: aegisResult.decision, receiptId: receiptId ?? null });
    {
      const finalStatus = getTaskWithHistory(taskId).task?.status;
      finishContinuity(taskId, finalStatus === 'DONE' ? 'DONE' : finalStatus === 'INCOMPLETE' ? 'INCOMPLETE' : 'FAILED', `Aegis ${aegisResult.decision}`);
      if (content.scopes.integrity === 'PASS' || content.scopes.integrity === 'FAIL') {
        recordPerformanceSample({
          taskId, workspaceId: resolvedWorkspaceId, taskClass: run.taskClass, canonicalVersionId: routingEvidence.canonicalVersionId,
          providerId: provider, modelId: canonicalModelId, deploymentId: routingEvidence.deploymentId, routingDecisionId: run.decision.decisionId,
          completed: content.scopes.completion === 'PASS', instructionCompliance: content.scopes.instructionCompliance === 'PASS' ? true : content.scopes.instructionCompliance === 'FAIL' ? false : null,
          integrity: content.scopes.integrity === 'PASS', verified: aegisResult.decision === 'VERIFIED', latencyMs: run.latencyMs,
          costUsd: usageRow?.actual_cost_usd ?? null, continuations: Math.max(0, run.segments.filter((x) => x.status !== 'BLOCKED').length - 1),
          retries: run.segments.filter((x) => x.status === 'FAILED').length,
        });
      }
    }

    const { task: savedTask, statusHistory } = getTaskWithHistory(taskId);
    const activityEvents = getTaskActivityEvents(taskId);
    const artifactsList = getTaskArtifacts(taskId);
    const reviewsList = getTaskQualityReviews(taskId);
    const receiptsList = getTaskReceipts(taskId);

    // Real execution metrics from provider SDK metadata (or null if unavailable - no random/fabricated numbers)
    //
    // PROVIDER FIELD NAMES DIFFER, and reading only one provider's spelling
    // silently discarded the other's. Gemini reports camelCase
    // (`usageMetadata.totalTokenCount`); OpenAI's Responses API reports
    // snake_case (`usage.total_tokens`). Before this, an OpenAI run recorded
    // its real usage in the PROVIDER_COMPLETED ledger event and then reported
    // metricsStatus: "NOT_AVAILABLE" anyway — the number was right there and
    // the metric claimed it did not exist.
    //
    // Still no fallback arithmetic: if a provider reports only input/output
    // counts, they are summed, which is addition rather than estimation. If
    // nothing is reported, this stays null and metricsStatus says so.
    const usageTotals = providerUsageMetadata as Record<string, unknown> | null;
    const numericUsage = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const reportedTotal =
      numericUsage(usageTotals?.totalTokenCount) ??
      numericUsage(usageTotals?.totalTokens) ??
      numericUsage(usageTotals?.total_tokens);
    const reportedInput = numericUsage(usageTotals?.input_tokens) ?? numericUsage(usageTotals?.promptTokenCount);
    const reportedOutput = numericUsage(usageTotals?.output_tokens) ?? numericUsage(usageTotals?.candidatesTokenCount);
    const realTokensConsumed =
      reportedTotal ??
      (reportedInput !== null && reportedOutput !== null ? reportedInput + reportedOutput : null);
    const executionMetrics = {
      latencyMs: elapsedMs,
      tokensConsumed: realTokensConsumed,
      costEstimate: null,
      metricsStatus: realTokensConsumed !== null ? "LIVE_PROVIDER_METADATA" : "NOT_AVAILABLE",
    };

    return {
      status: 200,
      body: {
        success: aegisResult.decision === "VERIFIED" && savedTask?.status === "DONE",
        taskId,
        status: savedTask?.status || "AWAITING_RECEIPT",
        outputs: executionOutput,
        claimedBy: `${assignedAgent.charAt(0).toUpperCase() + assignedAgent.slice(1)} Agent (${modelUsed})`,
        claimedAt: startTimeIso,
        latestAction: `Provider finished in ${elapsedMs}ms. Artifact hashed (${persistedArtifact.content_hash}). Aegis decision: ${persistedReview.decision}. Receipts: ${receiptsList.length}. Status: ${savedTask?.status}.`,
        modelUsed,
        // STEP 1b — real, observed ctx.invoke() names only. Was a fixed []
        // (Phase 0 / F1) because nothing populated it honestly; now it is
        // exactly what was actually invoked during this execution — here,
        // "model.gemini" whenever the code reached the point of attempting
        // the real Gemini call above, and nothing else.
        toolCalls: ctx.getInvocations().map((r) => r.name),
        artifact: {
          id: persistedArtifact.artifact_id,
          title: taskTitle,
          folder: "Startup-Theses",
          filePath: persistedArtifact.relative_path,
          diskPath: persistedArtifact.disk_path,
          contentHash: persistedArtifact.content_hash,
          sizeBytes: persistedArtifact.size_bytes,
          content: artifactContent,
          createdAt: nowIso,
          // ACTIVE, or QUARANTINED with the reason — read back, not assumed.
          retrieval: getArtifactRetrievalStatus(persistedArtifact.artifact_id),
        },
        review: {
          reviewId: persistedReview.review_id,
          reviewer: persistedReview.reviewer,
          method: persistedReview.method,
          decision: persistedReview.decision,
          score: persistedReview.score,
          checks: aegisResult.checks,
          evidence: aegisResult.evidence,
          createdAt: persistedReview.created_at,
        },
        receipt: receiptsList[0] ? {
          receiptId: receiptsList[0].receipt_id,
          algorithm: receiptsList[0].algorithm,
          publicKey: receiptsList[0].public_key,
          signature: receiptsList[0].signature,
          payload: JSON.parse(receiptsList[0].payload_json),
          verified: verifyReceipt(receiptsList[0]),
          createdAt: receiptsList[0].created_at,
        } : null,
        task: savedTask,
        statusHistory,
        activityEvents,
        artifacts: artifactsList,
        reviews: reviewsList,
        receipts: receiptsList.map((r) => ({
          ...r,
          payload: JSON.parse(r.payload_json),
          verified: verifyReceipt(r),
        })),
        executionMetrics,
        routing: { ...routingEvidence, explanation: run.decision.explanation, mode: run.decision.mode, policy: run.decision.policy },
        continuity: continuityView(taskId),
      },
    };
  } catch (err: any) {
    console.error("[Agent Execution Error]:", err);

    const errorMessage = err?.message || String(err) || "Task execution pipeline failure";
    const errorTaskId = (rawBody as any)?.taskId;

    // Attempt to persist internal execution failure if taskId exists
    if (errorTaskId) {
      try {
        const { task } = getTaskWithHistory(errorTaskId);
        // Only update if not already in a terminal failed state
        if (task && task.status !== "FAILED") {
          updateTaskStatus(errorTaskId, "FAILED");
          recordActivityEvent({
            taskId: errorTaskId,
            eventType: "EXECUTION_FAILED",
            agentId: (rawBody as any)?.assignedAgent || "orchestrator",
            payload: {
              error: errorMessage,
              stage: "INTERNAL_PIPELINE_ERROR",
            },
          });
        }
      } catch (persistErr: any) {
        console.error("[Failed to persist execution error state]:", persistErr);
      }
    }

    return {
      status: 500,
      body: {
        success: false,
        status: "FAILED",
        reason: "INTERNAL_EXECUTION_FAILURE",
        error: errorMessage,
        taskId: errorTaskId,
      },
    };
  }
}
