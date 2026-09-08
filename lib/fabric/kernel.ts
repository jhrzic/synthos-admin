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
import { GoogleGenAI } from '@google/genai';
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
import { classifyModelRequest, DEFAULT_CANDIDATE_MODELS } from '../model-router';
import { verifyTaskAtGate } from '../kil-gate';
import { indexVaultArtifact } from '../memory-index';
// STEP 2 — the canonical Vault writer (lib/vault.ts). Replaces this file's
// own former direct fs.writeFileSync + recordArtifact() pair; see the
// artifact-write section below for the full rationale.
import { writeWorkspaceArtifact } from '../vault';
import type { ExecuteAgentTaskInput, ExecutionResult, ExecutionContext } from './types';

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
      assignedModel = "gemini-3.6-flash",
      inputs = "",
      sourceUrl = "",
    } = (rawBody || {}) as ExecuteAgentTaskInput;

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

    // Check API Key
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      updateTaskStatus(taskId, "FAILED", undefined, resolvedWorkspaceId);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: "PROVIDER_FAILED",
        agentId: assignedAgent,
        payload: { reason: "BLOCKED_MISSING_CREDENTIAL", error: "GEMINI_API_KEY environment variable is not configured" },
      });
      return {
        status: 400,
        body: {
          success: false,
          status: "BLOCKED",
          reason: "BLOCKED_MISSING_CREDENTIAL",
          error: "GEMINI_API_KEY environment variable is not configured on the server",
          taskId,
        },
      };
    }

    // 2b. Provider identity gate — a non-Gemini model request must fail
    // explicitly here, before the task ever claims RUNNING, rather than
    // being silently substituted with a Gemini model.
    const modelClassification = classifyModelRequest(assignedModel);
    if (modelClassification.provider === "UNSUPPORTED") {
      updateTaskStatus(taskId, "FAILED", undefined, resolvedWorkspaceId);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: "PROVIDER_UNSUPPORTED",
        agentId: assignedAgent,
        payload: {
          reason: modelClassification.reason,
          error: modelClassification.message,
          requestedModel: modelClassification.requestedModel,
        },
      });
      return {
        status: 400,
        body: {
          success: false,
          status: "FAILED",
          reason: modelClassification.reason,
          error: modelClassification.message,
          requestedModel: modelClassification.requestedModel,
          taskId,
        },
      };
    }

    // 3. Immediately before provider call: RUNNING & EXECUTION_STARTED
    updateTaskStatus(taskId, "RUNNING", undefined, resolvedWorkspaceId);
    recordActivityEvent({
      taskId,
      expectedWorkspaceId: resolvedWorkspaceId,
      eventType: "EXECUTION_STARTED",
      agentId: assignedAgent,
      payload: { model: assignedModel, status: "RUNNING" },
    });

    let executionOutput = "";
    let modelUsed = assignedModel;
    let lastProviderError: string | null = null;
    let hadProviderError = false;
    let providerUsageMetadata: any = null;

    // Step 1: Execute tool/model logic based on role with Live Gemini Model
    const normalizedAssignedModel = modelClassification.resolvedModel;
    const candidateModels = [normalizedAssignedModel, ...DEFAULT_CANDIDATE_MODELS].filter((v, i, a) => a.indexOf(v) === i);

    // STEP 1b — the only sanctioned path for a model/tool/external-service
    // call inside the kernel. Wraps the exact existing multi-candidate
    // retry loop unchanged; ctx.invoke only observes (name, timing,
    // success/failure), it does not alter control flow, retries, or error
    // handling. Because this whole block already catches every error
    // internally (per-candidate and outer), the wrapped function itself
    // never rejects — ctx.invoke records this as a successful "model.gemini"
    // invocation whenever the code reaches the point of attempting it
    // (i.e. whenever an API key and a supported model exist), independent
    // of whether any candidate actually returned usable text. That real,
    // observed name — never a fabricated or per-role literal — is what
    // toolsInvoked is built from below.
    await ctx.invoke("model.gemini", async () => {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });

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

        // No exclude-list needed here: the provider identity gate above already
        // rejects any non-Gemini model before this point, so every candidate in
        // this queue is guaranteed Gemini-family.
        const modelsToTry = [normalizedAssignedModel, ...candidateModels].filter((v, i, a) => a.indexOf(v) === i);

        for (const m of modelsToTry) {
          try {
            const resp = await ai.models.generateContent({
              model: m,
              contents: rolePrompt,
              config: { temperature: 0.2 },
            });
            if (resp?.text && resp.text.trim().length > 0) {
              executionOutput = resp.text;
              modelUsed = m;
              if (resp.usageMetadata) {
                providerUsageMetadata = resp.usageMetadata;
              }
              break;
            }
          } catch (e: any) {
            hadProviderError = true;
            lastProviderError = e?.message || String(e);
            console.warn(`[Agent Model Router] '${m}' failover:`, lastProviderError);
          }
        }
      } catch (genErr: any) {
        hadProviderError = true;
        lastProviderError = genErr?.message || String(genErr);
        console.warn("[Agent Task GenAI Error]:", lastProviderError);
      }
    });

    // Provider fails:
    // persist PROVIDER_FAILED
    // persist task status FAILED
    // persist FAILED status history
    // return failure
    // No artifact, No fake verification, No DONE
    if (!executionOutput) {
      updateTaskStatus(taskId, "FAILED", undefined, resolvedWorkspaceId);
      recordActivityEvent({
        taskId,
        expectedWorkspaceId: resolvedWorkspaceId,
        eventType: "PROVIDER_FAILED",
        agentId: assignedAgent,
        payload: {
          error: lastProviderError || "Empty response from provider",
          hadProviderError,
        },
      });

      if (hadProviderError && lastProviderError) {
        return {
          status: 502,
          body: {
            success: false,
            status: "FAILED",
            reason: "MODEL_PROVIDER_UNAVAILABLE",
            error: lastProviderError,
            lastProviderError,
            taskId,
          },
        };
      }
      return {
        status: 502,
        body: {
          success: false,
          status: "FAILED",
          reason: "EMPTY_PROVIDER_RESPONSE",
          error: "Model provider returned an empty or unparseable response",
          taskId,
        },
      };
    }

    // Provider succeeds:
    // persist PROVIDER_COMPLETED
    recordActivityEvent({
      taskId,
      expectedWorkspaceId: resolvedWorkspaceId,
      eventType: "PROVIDER_COMPLETED",
      agentId: assignedAgent,
      payload: {
        model: modelUsed,
        outputLength: executionOutput.length,
        usage: providerUsageMetadata || null,
      },
    });

    const elapsedMs = Date.now() - startTime;
    const nowIso = new Date().toISOString();

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

    // Run real deterministic Aegis verification against ledger and persisted disk artifact
    const aegisResult = runDeterministicAegisVerification(taskId, executionOutput);

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
          checks: aegisResult.checks,
        },
        createdAt: nowIso,
      });

      // ---------------------------------------------------------------------
      // Step 4 Execution Spine: Real Cryptographic Execution Receipt Signing
      // ---------------------------------------------------------------------
      receiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const canonicalPayload: CanonicalReceiptPayload = {
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
        provider: "google-genai",
        modelUsed,
        artifactId: persistedArtifact.artifact_id,
        artifactHash: persistedArtifact.content_hash,
        aegisDecision: aegisResult.decision,
        aegisMethod: aegisResult.method,
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

    const { task: savedTask, statusHistory } = getTaskWithHistory(taskId);
    const activityEvents = getTaskActivityEvents(taskId);
    const artifactsList = getTaskArtifacts(taskId);
    const reviewsList = getTaskQualityReviews(taskId);
    const receiptsList = getTaskReceipts(taskId);

    // Real execution metrics from provider SDK metadata (or null if unavailable - no random/fabricated numbers)
    const realTokensConsumed = providerUsageMetadata?.totalTokenCount ?? providerUsageMetadata?.totalTokens ?? null;
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
