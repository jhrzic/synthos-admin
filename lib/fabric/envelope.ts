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
import { listWorkspaceExternalExecutions, guardianCheckInstruction, submitExternalExecution } from '../external-executions';
import { resolveAntigravityAgent } from '../antigravity-client';
import { scrubSecrets } from '../redact';
import { recordRuntimeEvent, type RuntimeEventStatus } from '../runtime-events';
import { runHermesLocalTask, isHermesLocalConfigured, isHermesLocalEnabled, getHermesCliPath } from '../hermes-local-runtime';

// TOOL PACK 1 — the tool manifest, and the real accessors each tool dispatches
// through. Every one of these already existed or was added as a focused
// boundary module; none of them is a second execution path.
import { findToolDefinition, type BrainWritebackPolicy } from './tool-pack';
import {
  searchBrainAndSources,
  summarizeExternalSources,
  readExternalSource,
  resolveRetrievalScope,
  ExternalSourceAccessError,
  EXTERNAL_TRUST_NOTE,
  type RetrievalScope,
} from '../brain-sources';
import {
  searchWorkspaceKnowledge,
  readWorkspaceKnowledgeNote,
  writeKnowledgeNote,
  KnowledgeAccessError,
} from '../knowledge-vault';
import { readWorkspaceFile, FileBoundaryError, allowedFileRootKeys } from '../workspace-files';
import {
  githubSearchRepositories,
  githubReadFile,
  githubInspect,
  GithubReadError,
  GithubRepositoryNotApprovedError,
  GithubBoundaryError,
  validateRepoPath,
  validateRef,
  isRepositoryApproved,
  approvedRepositories,
  type GithubInspectSubject,
} from '../github-readonly';
import { assertSafeOutboundUrl, readBoundedBody, MAX_OUTBOUND_RESPONSE_BYTES } from '../net-guard';
import { discoverLiveRepositories } from './research';
import {
  listWorkspaceSchedules,
  getSchedule,
  isScheduleInWorkspace,
  setScheduleStatus,
  resumeSchedule,
} from '../persistence';
import { createValidatedSchedule, parseSchedulePhrase, computeResumeNextRunAt } from './scheduler';

// APPROVAL FOUNDATION — the gate every EXTERNAL_ACTION passes through.
// TOOL PACK 2 — Gmail.
import {
  resolveGmailConnection,
  gmailWorkspaceReadiness,
  GmailAuthError,
} from '../gmail-connection';
import {
  gmailSearch,
  gmailReadThread,
  gmailCreateDraft,
  gmailSendMessage,
  computeMessageContentDigest,
  isValidEmailAddress,
  GmailApiError,
  GmailContentError,
  type GmailMessageSpec,
} from '../gmail-client';
import {
  claimGmailSend,
  getGmailSendAttemptByApproval,
  resolveGmailSendSent,
  resolveGmailSendFailure,
  linkGmailSendToTask,
} from '../gmail-send-ledger';

import {
  requestApproval,
  checkApprovalGate,
  consumeApproval,
  linkConsumedApprovalToTask,
  computeInputDigest,
  type ApprovalRecord,
} from '../approvals';

// SUBMITTED — an asynchronous runtime accepted the work and it is still
// running remotely. NOT terminal and NOT a success: no artifact, Aegis review
// or receipt exists yet. Those are produced later, by the one external-
// execution sweep, when the remote result is ingested. A caller must treat the
// task as waiting, never as done.
export type EnvelopeOutcome = 'SUCCESS' | 'READ_OK' | 'BLOCKED' | 'NOT_CONFIGURED' | 'APPROVAL_REQUIRED' | 'FAILED' | 'IN_PROGRESS' | 'CONFLICT' | 'SUBMITTED';

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
  /**
   * TOOL PACK 1 — an explicit trace id, joining several tool calls that belong
   * to one piece of work.
   *
   * The attempt ledger already recorded a correlationId, but DERIVED it
   * (`idempotencyKey || attempt-<digest>`). That is right for a single
   * consequential action and wrong for a tool session: an agent that searches
   * the Brain, reads two files and then writes a note performs four attempts
   * which are one unit of work, and each derived its own unrelated id, so
   * nothing joined them. Supplying it keeps the derivation as the fallback, so
   * every existing caller is unaffected.
   */
  correlationId?: string;
  /**
   * TOOL PACK 2 — set by dispatchEnvelope after the approval gate consumes an
   * approval, so an EXTERNAL_ACTION executor can bind its provider call to the
   * exact approval that authorized it (gmail.send claims its send ledger row
   * against this id).
   *
   * Underscore-prefixed because it is INTERNAL: no HTTP caller supplies it, and
   * any value a client happened to send is overwritten before dispatch — see
   * executeEnvelope. It is not a way to assert approval, it is a way to carry
   * one that was already proven.
   */
  __consumedApprovalId?: string | null;
  /**
   * The canonical task this dispatch belongs to, when the caller owns one (the
   * orchestrator does). Used by asynchronous runtimes so the result ingested
   * later completes THIS task instead of a synthetic one, and bound into the
   * runtime.antigravity approval digest so an approval for one task cannot be
   * spent on another.
   */
  taskId?: string;
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
  /**
   * TOOL PACK 1 / Section 7 — what became of this output, stated rather than
   * left to be inferred.
   *
   * 'NONE' is the answer for every read-only tool, and saying it explicitly is
   * the point: a caller holding a research.fetch result can see that the
   * content it is looking at is an OBSERVATION which was not promoted to
   * knowledge, without having to know the policy table. Observation is not
   * knowledge, and a result that did not say so invited the reader to assume
   * otherwise.
   */
  brainWriteback?: BrainWritebackPolicy;
  /** Provenance for a read-only tool: where the returned facts actually came from. */
  provenance?: Record<string, unknown>;
  /**
   * APPROVAL FOUNDATION — the approval that gated this dispatch, or the one now
   * waiting for a human.
   *
   * Present on an APPROVAL_REQUIRED outcome so a caller can show the operator
   * exactly what to go and decide, and on a SUCCESS so the evidence trail
   * records which approval was spent.
   */
  approval?: {
    approvalId: string;
    status: string;
    inputDigest: string;
    expiresAt: string | null;
    decidedBy?: string | null;
  } | null;
  /** Present on SUBMITTED: the ledger row the external-execution sweep will advance. */
  externalExecution?: {
    id: string;
    runtime: string;
    status: string;
    remoteJobId: string | null;
    created: boolean;
  } | null;
}

// EXTERNAL_ACTION capabilities Jarvis (or any envelope caller) may still
// execute despite approvalPolicy !== 'GUARDIAN_ENFORCED' — an explicit,
// narrow, named exception, not a general weakening of Section 7's rule.
// vault.write's current canonical policy (Step 2/4: POST /api/vault/notes
// writes directly, no Aegis/receipt/approval gate) already treats a
// caller's own workspace as approval-free; recorded here rather than
// silently special-cased inline in the dispatch switch below.
export const EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE = new Set<string>(['vault.write']);

/**
 * PASS 2 — the attempt ledger.
 *
 * executeEnvelope is now a thin recording wrapper around the real dispatcher.
 * Before this, the four refusal paths below (unregistered capability,
 * NOT_CONFIGURED/UNSUPPORTED, an external action without wired Guardian
 * enforcement, APPROVAL_REQUIRED) each returned a value to the caller and
 * persisted NOTHING. A Guardian-blocked execution therefore left no trace in
 * any table, which made "prove nothing ran without Guardian's consent"
 * unanswerable after the fact — the absence of a receipt is not evidence of a
 * refusal, because it is equally consistent with the attempt never happening.
 *
 * Every outcome now writes one row to the existing runtime_events ledger. No
 * second truth store: successes still own their task/artifact/Aegis/receipt
 * chain, and this row references it rather than restating it.
 *
 * What is deliberately NOT recorded: rawText and parameter VALUES. A refused
 * instruction can contain exactly the content that got it refused, and an
 * attempt ledger is the wrong place to durably store it. A SHA-256 digest of
 * the request goes in instead, which is enough to prove two attempts were the
 * same request without retaining the request.
 */
export async function executeEnvelope(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  // A caller can never assert its own approval. Whatever arrived in this field
  // is discarded here; only the approval gate may set it, and only after
  // consuming a real approval bound to these exact inputs.
  input = { ...input, __consumedApprovalId: null };
  const startedAt = Date.now();
  let result: ExecutionEnvelopeResult;
  try {
    result = await dispatchEnvelope(input);
  } catch (err: any) {
    // An exception is itself an attempt outcome and must be recorded before
    // it propagates, or a crash becomes an untraceable attempt.
    recordAttempt(input, {
      outcome: 'FAILED',
      capability: input.capability,
      reason: `Uncaught dispatch error: ${err?.message || String(err)}`,
    }, Date.now() - startedAt);
    throw err;
  }
  recordAttempt(input, result, Date.now() - startedAt);
  return result;
}

/** Maps an envelope outcome onto the ledger's status vocabulary. */
function attemptStatus(outcome: EnvelopeOutcome): RuntimeEventStatus {
  switch (outcome) {
    case 'SUCCESS':
    case 'READ_OK':
      return 'SUCCESS';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'APPROVAL_REQUIRED':
      return 'APPROVAL_REQUIRED';
    case 'NOT_CONFIGURED':
      return 'NOT_CONFIGURED';
    case 'IN_PROGRESS':
    case 'SUBMITTED':
      return 'RUNNING';
    case 'CONFLICT':
      // A claim collision: another attempt owns this work. Not a failure of
      // this request, and not a success either.
      return 'UNKNOWN';
    case 'FAILED':
    default:
      return 'FAILED';
  }
}

function recordAttempt(input: ExecutionEnvelopeInput, result: ExecutionEnvelopeResult, latencyMs: number): void {
  try {
    // Digest, never content. Stable across attempts of the same request.
    const requestDigest = crypto
      .createHash('sha256')
      .update(JSON.stringify({ capability: input.capability, action: input.action, rawText: input.rawText, parameters: input.parameters }))
      .digest('hex');

    recordRuntimeEvent({
      workspaceId: input.workspaceId,
      eventType: 'CAPABILITY_INVOCATION',
      targetType: 'capability',
      targetId: input.capability,
      status: attemptStatus(result.outcome),
      latencyMs,
      detail: {
        outcome: result.outcome,
        action: input.action,
        actorUserId: input.actorUserId,
        // The reason string is authored by this codebase, never by a
        // provider, so it carries no secret material.
        reason: result.reason?.slice(0, 500) ?? null,
        requestDigest,
        idempotencyKey: input.idempotencyKey ?? null,
        // PASS 3 — the canonical join key for one end-to-end trace.
        //
        // lib/external-executions.ts already derives external_executions
        // .correlation_id from exactly this value (`params.idempotencyKey ||
        // adhoc-…`), and a retry chains it as `<parent>::retry-N`. So using
        // the same derivation here means an attempt row and the external
        // execution it caused share a key, without inventing a second id
        // scheme or a second ledger.
        //
        // Always present, never null: a trace with a missing join key is not
        // a trace, and an attempt with no natural key still needs to be
        // distinguishable from the next one.
        // TOOL PACK 1 — an explicitly supplied trace id wins; the derivation
        // remains the fallback so existing callers are unchanged.
        correlationId: input.correlationId || input.idempotencyKey || `attempt-${requestDigest.slice(0, 12)}`,
        // References into the evidence chain, not copies of it.
        taskId: result.taskId ?? null,
        artifactId: result.artifact?.id ?? null,
        artifactHash: result.artifact?.contentHash ?? null,
        aegisDecision: result.aegis?.decision ?? null,
        receiptId: result.receipt?.receiptId ?? null,
        receiptVerified: result.receipt?.verified ?? null,
        // Whether an outward call really happened — the difference between
        // "refused before dispatch" and "the provider was contacted".
        providerCalled: Array.isArray(result.toolsInvoked) && result.toolsInvoked.length > 0,
        toolsInvoked: result.toolsInvoked ?? [],
      },
    });
  } catch {
    // Evidence recording must never be the thing that fails an execution, and
    // must never mask the real outcome. A lost row is visible as a gap in the
    // ledger; a thrown error here would be a worse failure.
  }
}

async function dispatchEnvelope(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  // Set when an external action's approval was spent by the gate below, so the
  // task the executor creates can be linked back to the approval that
  // authorized it.
  let consumedApprovalId: string | null = null;
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

  // TOOL PACK 1 — INTERNAL_MUTATION is held to the SAME standard.
  //
  // This is the guard that stops the new effect class being a way around
  // Section 7's rule. An internal mutation reaches nothing outside SynthOS,
  // but it still changes durable state the operator relies on — a vault note,
  // an artifact, a schedule that will fire unattended — so "it is only
  // internal" is not a reason to dispatch on advisory policy.
  //
  // Note there is deliberately NO exemption set here. EXTERNAL_ACTION has one
  // (vault.write), inherited from before this class existed. Adding an
  // equivalent for internal mutations would recreate exactly the hole that
  // exemption represents, so every INTERNAL_MUTATION capability must declare
  // GUARDIAN_ENFORCED and mean it.
  if (
    capability.effectClass === 'INTERNAL_MUTATION' &&
    capability.approvalPolicy !== 'GUARDIAN_ENFORCED'
  ) {
    return {
      outcome: 'BLOCKED',
      capability: capability.key,
      reason: `"${capability.key}" mutates durable SynthOS state but does not declare real Guardian enforcement (approvalPolicy: ${capability.approvalPolicy}) — refusing rather than executing on advisory policy alone.`,
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

  // ORDERING NOTE, added when this regressed terminal.exec.
  //
  // The registry's own APPROVAL_REQUIRED status is checked ABOVE the human
  // approval gate below, and the order is not arbitrary. They are two different
  // kinds of "needs approval":
  //
  //   registry APPROVAL_REQUIRED — real enforcement exists but is PER-COMMAND
  //     and cannot be resolved ahead of a specific command string here. Nobody
  //     can satisfy it from an approval queue, because the thing to be approved
  //     is not known at this point. terminal.exec is the live example.
  //
  //   the human gate                — the action IS fully specified, policy
  //     permits it, and what is missing is a person's decision. That is what
  //     the queue is for.
  //
  // Putting the gate first turned terminal.exec from an honest
  // APPROVAL_REQUIRED deferral into a BLOCKED, which test/execution-envelope
  // caught. The gate therefore runs only for capabilities that are otherwise
  // dispatchable.

  // =====================================================================
  // APPROVAL FOUNDATION — the human gate for EXTERNAL_ACTION.
  //
  // Order matters and is the whole design. Guardian has ALREADY been consulted
  // above: an EXTERNAL_ACTION without wired Guardian enforcement was refused
  // before reaching here, and an APPROVAL_REQUIRED registry status is refused
  // just below. So by the time this gate runs, policy permits the action and
  // the only remaining question is whether a human authorized it.
  //
  // That sequencing is what makes "human approval does not override Guardian"
  // structurally true rather than a promise: there is no code path in which a
  // human decision is consulted before, or instead of, the policy check. A
  // Guardian denial returns earlier and never reaches an approval lookup.
  //
  // vault.write keeps its pre-existing exemption. It is an internal write
  // mis-classified as EXTERNAL_ACTION before INTERNAL_MUTATION existed (see
  // lib/fabric/registry.ts), and putting a human approval in front of "save a
  // note to my own vault" would train the operator to click through approvals
  // — which is how an approval queue stops being read.
  // =====================================================================
  if (
    capability.effectClass === 'EXTERNAL_ACTION' &&
    !EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.has(capability.key)
  ) {
    const gate = await enforceHumanApproval(input, capability.key, capability.effectClass);
    if (gate.refusal) return gate.refusal;
    consumedApprovalId = gate.consumedApprovalId;
    // Hand the proven approval to the executor. Set here and nowhere else.
    input = { ...input, __consumedApprovalId: consumedApprovalId };
  }

  const dispatched = await dispatchToExecutor(capability, input);

  // Close the approval -> task link now that the executor has produced a task.
  if (consumedApprovalId && dispatched.taskId) {
    linkConsumedApprovalToTask(consumedApprovalId, dispatched.taskId);
    dispatched.approval = {
      approvalId: consumedApprovalId,
      status: 'CONSUMED',
      inputDigest: computeInputDigest({
        workspaceId: input.workspaceId,
        capability: capability.key,
        action: input.action,
        parameters: input.parameters || {},
        rawText: input.rawText,
      }),
      expiresAt: null,
    };
  }
  return dispatched;
}

/**
 * The executor switch, split out so dispatchEnvelope can post-process a result
 * (linking a consumed approval to the task it authorized) without threading a
 * mutable variable through every branch.
 */
async function dispatchToExecutor(
  capability: NonNullable<Awaited<ReturnType<typeof resolveCapability>>>,
  input: ExecutionEnvelopeInput,
): Promise<ExecutionEnvelopeResult> {
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
    case 'aeo.audit':
      return executeAeoAudit(input);
    case 'hermes.execute':
      return executeHermesTask(input);

    // --- TOOL PACK 1 ----------------------------------------------------
    case 'brain.search':
      return executeBrainSearch(input);
    case 'brain.read':
      return executeBrainRead(input);
    case 'brain.read_source':
      return executeBrainReadSource(input);
    case 'brain.write_session_note':
      return executeBrainWriteSessionNote(input);
    case 'github.search':
      return executeGithubSearch(input);
    case 'github.read_file':
      return executeGithubReadFile(input);
    case 'github.inspect':
      return executeGithubInspect(input);
    case 'files.read':
      return executeFilesRead(input);
    case 'files.write_artifact':
      return executeFilesWriteArtifact(input);
    case 'schedule.list':
      return executeScheduleList(input);
    case 'schedule.create_internal':
      return executeScheduleCreateInternal(input);
    case 'schedule.pause':
      return executeSchedulePause(input);
    case 'schedule.resume':
      return executeScheduleResume(input);
    case 'research.search':
      return executeResearchSearch(input);
    case 'research.fetch':
      return executeResearchFetch(input);

    // APPROVAL FOUNDATION — lifecycle proof only, no network.
    case 'verification.external_action':
      return executeApprovalVerification(input);

    // --- TOOL PACK 2: Gmail ---------------------------------------------
    case 'gmail.search':
      return executeGmailSearch(input);
    case 'gmail.read_thread':
      return executeGmailReadThread(input);
    case 'gmail.create_draft':
      return executeGmailCreateDraft(input);
    case 'gmail.send':
      return executeGmailSend(input);

    // --- Asynchronous managed-agent runtime -----------------------------
    case 'runtime.antigravity':
      return executeAntigravityRuntime(input);

    default:
      // A registered, AVAILABLE capability with no wired executor here —
      // honest, never a fabricated attempt.
      return { outcome: 'NOT_CONFIGURED', capability: capability.key, reason: `No executor is wired for capability "${capability.key}" through the envelope yet.` };
  }
}

/**
 * SEO/AEO/GEO audit. Delegates to the one audit service (lib/aeo/service.ts) —
 * the same code the HTTP route and graph nodes call, so a scheduled recheck
 * produces byte-identical evidence to a manual run.
 *
 * The service walks the canonical persistence spine itself (task -> artifact ->
 * Aegis -> receipt), so this executor does NOT call commitEvidencedArtifact;
 * doing both would write the work twice. It maps the service's result onto the
 * envelope contract instead.
 *
 * Wiring this closed a real gap: `aeo.audit` was registered as a schedulable
 * capability in the previous pass with no executor behind it, so the recurring
 * recheck would have failed the moment it fired.
 */
async function executeAeoAudit(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const taskId = deriveIdempotentTaskId('aeo.audit', input.idempotencyKey);
  const params = (input.parameters || {}) as Record<string, unknown>;
  const domain = typeof params.domain === 'string' && params.domain.trim()
    ? params.domain.trim()
    : (input.rawText || '').trim();

  if (!domain) {
    return { outcome: 'FAILED', capability: 'aeo.audit', reason: 'No domain supplied for the audit.' };
  }

  return withAtomicClaim(input, 'aeo.audit', taskId, async () => {
    const { runAeoAudit } = await import('../aeo/service');
    const r = await runAeoAudit({
      workspaceId: input.workspaceId,
      domain,
      businessName: typeof params.businessName === 'string' ? params.businessName : undefined,
      location: typeof params.location === 'string' ? params.location : undefined,
      maxPages: typeof params.maxPages === 'number' ? params.maxPages : undefined,
    });

    if (r.outcome === 'FAILED') {
      return { outcome: 'FAILED', capability: 'aeo.audit', reason: `${r.reason}: ${r.error}` };
    }

    const geo = r.analysis.scores.geo.score;
    return {
      outcome: 'SUCCESS',
      capability: 'aeo.audit',
      reason: `Audited ${r.analysis.origin}: ${r.analysis.crawl.pagesAnalyzed} page(s), SEO ${r.analysis.scores.seo.score ?? 'UNKNOWN'}, AEO ${r.analysis.scores.aeo.score ?? 'UNKNOWN'}, GEO ${geo ?? 'UNKNOWN'}.`,
      taskId: r.taskId,
      artifact: r.artifact,
      aegis: { decision: r.aegis.decision, score: r.aegis.score },
      receipt: r.receiptId ? { receiptId: r.receiptId, verified: true } : null,
      toolsInvoked: ['http.crawl'],
      data: {
        origin: r.analysis.origin,
        scores: r.analysis.scores,
        checks: r.analysis.checks.length,
        unknowns: r.analysis.unknowns,
      },
    };
  });
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
 * Hermes, dispatched through the real CLI on this machine.
 *
 * Everything the brief requires preserved is preserved by NOT doing it here:
 *
 *   Guardian gating  — guardianCheckInstruction() below, the same gate
 *                      runtime.antigravity uses, run BEFORE the subprocess
 *                      starts. That is what makes the registry's
 *                      approvalPolicy: 'GUARDIAN_ENFORCED' a true statement
 *                      rather than a label.
 *   Activity ledger  — commitEvidencedArtifact() writes the full
 *                      TASK_CREATED -> ... -> TASK_COMPLETED event chain.
 *   Aegis + receipt  — same function: deterministic verification, then an
 *                      Ed25519-signed receipt that is verified before it is
 *                      stored.
 *   Brain writeback  — same function: the artifact is written to the Vault
 *                      and indexed into the FTS5 memory index.
 *
 * So this executor only does the part that is genuinely new: gate, run,
 * and hand a real result to the spine that already exists.
 */
async function executeHermesTask(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const params = (input.parameters || {}) as Record<string, unknown>;
  const prompt = typeof params.prompt === 'string' && params.prompt.trim()
    ? params.prompt.trim()
    : (input.rawText || '').trim();

  if (!prompt) {
    return { outcome: 'FAILED', capability: 'hermes.execute', reason: 'No prompt supplied for the Hermes task.' };
  }

  // Guardian first, before anything is spawned and before a claim is taken:
  // a refused instruction must not consume an idempotency key the caller
  // could legitimately retry with a different, allowed instruction.
  const guardian = guardianCheckInstruction(prompt);
  if (!guardian.allowed) {
    return {
      outcome: 'BLOCKED',
      capability: 'hermes.execute',
      reason: guardian.error || 'Guardian refused this instruction before dispatch.',
    };
  }

  // Static deployment conditions are checked before the claim, for the same
  // reason executeResearch checks its key first.
  if (!isHermesLocalConfigured()) {
    return {
      outcome: 'NOT_CONFIGURED',
      capability: 'hermes.execute',
      reason: `No executable Hermes CLI at ${getHermesCliPath()}. Set HERMES_CLI_PATH if it lives elsewhere.`,
    };
  }
  if (!isHermesLocalEnabled()) {
    return {
      outcome: 'NOT_CONFIGURED',
      capability: 'hermes.execute',
      reason: 'HERMES_LOCAL_ENABLED is not "true". The Hermes CLI is installed and answers, but dispatch is switched off because a run spends real ChatGPT/Codex subscription quota.',
    };
  }

  const taskId = deriveIdempotentTaskId('hermes', input.idempotencyKey);

  return withAtomicClaim(input, 'hermes.execute', taskId, async () => {
    const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined;
    const run = await runHermesLocalTask({ prompt, timeoutMs });

    if (run.status !== 'SUCCESS') {
      return {
        outcome: run.status === 'TIMEOUT' ? 'FAILED' : 'FAILED',
        capability: 'hermes.execute',
        reason: `Hermes task ${run.status}: ${run.error || 'no further detail'}`,
        toolsInvoked: ['hermes.cli'],
      };
    }

    const truncationNote = run.truncated
      ? '\n\n> Output was truncated at the configured ceiling; this note is part of the artifact so the truncation cannot be mistaken for the whole answer.\n'
      : '';
    const content = [
      `# Hermes task`,
      '',
      `- Dispatched by: SynthOS execution envelope (capability \`hermes.execute\`)`,
      `- Runtime: local Hermes CLI (\`hermes -z\`)`,
      `- Duration: ${run.durationMs}ms`,
      `- Exit code: ${run.exitCode}`,
      `- Output truncated: ${run.truncated ? 'YES' : 'no'}`,
      '',
      '## Instruction',
      '',
      prompt,
      '',
      '## Result',
      '',
      run.output,
      truncationNote,
    ].join('\n');

    return commitEvidencedArtifact({
      taskId,
      workspaceId: input.workspaceId,
      title: `Hermes — ${prompt.slice(0, 70)}`,
      description: `Bounded Hermes CLI task: ${prompt.slice(0, 200)}`,
      assignedAgent: 'hermes',
      content,
      folder: 'Hermes-Tasks',
      toolsInvoked: ['hermes.cli'],
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

// ===========================================================================
// TOOL PACK 1 — executors.
//
// Each one is thin on purpose. The boundary logic (path containment, the
// repository allowlist, SSRF resolution, workspace scoping) lives in its own
// module and is tested there; these functions map the envelope contract onto
// it and produce an honest outcome. Nothing below opens a socket, joins a path
// or writes a file itself — that is deliberate, because a boundary that is
// enforced in one place can be proven, and a boundary re-implemented per
// call site cannot.
//
// A NOTE ON WHAT READ-ONLY TOOLS DELIBERATELY DO NOT DO (Section 9)
// No read-only executor below calls commitEvidencedArtifact, so none creates
// a task, an artifact, an Aegis review or a signed receipt. Every one of them
// still produces durable attempt evidence, because executeEnvelope's
// recordAttempt wrapper runs for every dispatch including refusals. That split
// is the instruction's: read-only operations must not manufacture signed
// receipts, but every invocation must leave evidence. A receipt attests that
// work was verified; minting one for "I read a file" would devalue the
// receipts that attest something real.
// ===========================================================================

/** The manifest's declared writeback policy. Never decided at the call site. */
function writebackFor(capability: string): BrainWritebackPolicy {
  return findToolDefinition(capability)?.brainWriteback ?? 'NONE';
}

function toolParam(input: ExecutionEnvelopeInput, name: string): string {
  const v = (input.parameters || {})[name];
  return typeof v === 'string' ? v.trim() : '';
}

function toolNumber(input: ExecutionEnvelopeInput, name: string, fallback: number, max: number): number {
  const v = (input.parameters || {})[name];
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// --- A. Brain --------------------------------------------------------------

async function executeBrainSearch(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const query = toolParam(input, 'query') || (input.rawText || '').trim();
  if (!query) {
    return { outcome: 'FAILED', capability: 'brain.search', reason: 'A search query is required.' };
  }
  const limit = toolNumber(input, 'limit', 20, 100);

  // ---------------------------------------------------------------------
  // SCOPE, and why the default is what it is.
  //
  // BRAIN_ONLY is the default so this capability's existing behaviour is
  // unchanged for every caller that does not ask for more. A search that
  // silently started returning 154 of the operator's own notes would have
  // been the one-line "just widen it" change this whole boundary exists to
  // avoid — retrieval is not admission, and changing what a tool returns by
  // default is how the two quietly become one.
  //
  // A caller opts in with scope: 'ALL' or 'EXTERNAL_ONLY'. Either way every
  // result carries its classification, admission status and a trust note, so
  // external material can never arrive looking like admitted knowledge.
  // ---------------------------------------------------------------------
  const requestedScope = toolParam(input, 'scope').toUpperCase();
  const scope: RetrievalScope =
    requestedScope === 'ALL' || requestedScope === 'EXTERNAL_ONLY' || requestedScope === 'BRAIN_ONLY'
      ? (requestedScope as RetrievalScope)
      : 'BRAIN_ONLY';

  const found = searchBrainAndSources({ workspaceId: input.workspaceId, query, scope, limit });

  // The legacy `matches` shape is preserved for callers that read it, so this
  // is additive rather than a breaking change to the tool's contract.
  const canonicalMatches = scope === 'EXTERNAL_ONLY'
    ? []
    : searchWorkspaceKnowledge(input.workspaceId, query, process.env, limit);

  return {
    outcome: 'READ_OK',
    capability: 'brain.search',
    reason: found.results.length > 0
      ? `${found.canonicalCount} canonical knowledge note(s) and ${found.externalCount} external source(s) match "${query}" (scope ${scope}).`
      : `Nothing matches "${query}" in scope ${scope}.`,
    data: {
      query,
      limit,
      scope,
      matchCount: canonicalMatches.length,
      matches: canonicalMatches,
      // The classified view. Each item states what it is and how much weight
      // it may carry.
      classified: found.results,
      counts: { canonical: found.canonicalCount, external: found.externalCount },
    },
    brainWriteback: writebackFor('brain.search'),
    provenance: {
      source: 'synthos-knowledge-vault',
      workspaceScoped: true,
      scopedTo: input.workspaceId,
      retrievalScope: scope,
      // External material is never admitted by being retrieved.
      externalAdmission: 'UNADMITTED',
    },
  };
}

async function executeBrainRead(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const notePath = toolParam(input, 'path') || toolParam(input, 'vaultRelativePath');
  if (!notePath) {
    return { outcome: 'FAILED', capability: 'brain.read', reason: 'A vault-relative note path is required (parameter "path").' };
  }
  try {
    const note = readWorkspaceKnowledgeNote(input.workspaceId, notePath, process.env);
    return {
      outcome: 'READ_OK',
      capability: 'brain.read',
      reason: `Read "${note.vaultRelativePath}" (${note.sizeBytes} bytes${note.truncated ? ', truncated' : ''}).`,
      data: note,
      brainWriteback: writebackFor('brain.read'),
      provenance: {
        source: 'synthos-knowledge-vault',
        vaultRelativePath: note.vaultRelativePath,
        noteWorkspaceId: note.workspaceId,
        noteSource: note.source,
        generatedBy: note.generatedBy,
        artifacts: note.artifacts,
        receipts: note.receipts,
      },
    };
  } catch (err: any) {
    if (err instanceof KnowledgeAccessError) {
      // BLOCKED, not FAILED, for a scope refusal: the distinction matters in
      // the attempt ledger, where "the boundary held" and "the tool broke"
      // must not look the same when someone audits refusals later.
      const blocked = err.code === 'OUT_OF_SCOPE' || err.code === 'BAD_PATH';
      return { outcome: blocked ? 'BLOCKED' : 'FAILED', capability: 'brain.read', reason: err.message };
    }
    return { outcome: 'FAILED', capability: 'brain.read', reason: err?.message || String(err) };
  }
}

/** Ceiling on a session note. Generous for a real summary, far short of dumping a transcript into the vault. */
const SESSION_NOTE_MAX_CHARS = 20_000;

async function executeBrainWriteSessionNote(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const title = toolParam(input, 'title');
  const body = toolParam(input, 'body') || (input.rawText || '').trim();
  if (!title) return { outcome: 'FAILED', capability: 'brain.write_session_note', reason: 'A note title is required.' };
  if (!body) return { outcome: 'FAILED', capability: 'brain.write_session_note', reason: 'A note body is required.' };

  // Guardian inspects the content before anything is written. The manifest
  // declares this capability GUARDIAN_ENFORCED, and this call is what makes
  // that declaration true rather than aspirational.
  const guardian = guardianCheckInstruction(`${title}\n\n${body}`);
  if (!guardian.allowed) {
    return { outcome: 'BLOCKED', capability: 'brain.write_session_note', reason: guardian.error || 'Guardian refused this note.' };
  }

  const bounded = body.length > SESSION_NOTE_MAX_CHARS
    ? `${body.slice(0, SESSION_NOTE_MAX_CHARS)}\n\n> Truncated at ${SESSION_NOTE_MAX_CHARS} characters by brain.write_session_note.`
    : body;

  const taskId = deriveIdempotentTaskId('brain-note', input.idempotencyKey);
  return withAtomicClaim(input, 'brain.write_session_note', taskId, async () => {
    // writeKnowledgeNote confines the write to <vault>/SynthOS/<kind>/ and
    // generates a collision-suffixed filename, so it cannot overwrite an
    // unrelated note. Neither property is re-implemented here.
    const result = writeKnowledgeNote(
      {
        title,
        kind: 'Sessions',
        workspaceId: input.workspaceId,
        source: toolParam(input, 'source') || 'tool:brain.write_session_note',
        sessionId: input.correlationId || input.idempotencyKey || null,
        runtime: 'synthos-admin',
        topics: Array.isArray((input.parameters || {}).topics)
          ? ((input.parameters as any).topics as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8)
          : [],
        tags: ['tool-pack-1'],
      },
      bounded,
    );

    if (!result.written) {
      return { outcome: 'FAILED', capability: 'brain.write_session_note', reason: result.reason || 'The note was not written.', taskId };
    }
    return {
      outcome: 'SUCCESS',
      capability: 'brain.write_session_note',
      reason: `Wrote "${result.vaultRelativePath}" into the approved SynthOS/ subtree.`,
      taskId,
      data: {
        fileName: result.fileName,
        vaultRelativePath: result.vaultRelativePath,
        bytes: Buffer.byteLength(bounded, 'utf8'),
        truncated: body.length > SESSION_NOTE_MAX_CHARS,
      },
      // AUTHORIZED_SESSION_NOTE, not KNOWLEDGE_CANDIDATE: this is the one
      // explicitly sanctioned internal writeback, and it is deliberately not
      // a general mechanism for promoting tool output into knowledge.
      brainWriteback: writebackFor('brain.write_session_note'),
      provenance: { workspaceId: input.workspaceId, subtree: 'SynthOS/Sessions', guardian: 'SAFE' },
    };
  });
}

// --- B. GitHub, read-only --------------------------------------------------

function githubFailure(capability: string, err: any): ExecutionEnvelopeResult {
  if (err instanceof GithubRepositoryNotApprovedError || err instanceof GithubBoundaryError) {
    // A boundary holding is BLOCKED, not FAILED — same classification
    // files.read uses, so the ledger reads consistently whichever tool a
    // traversal attempt came through.
    return { outcome: 'BLOCKED', capability, reason: err.message };
  }
  if (err instanceof GithubReadError) {
    return { outcome: 'FAILED', capability, reason: err.message };
  }
  return { outcome: 'FAILED', capability, reason: err?.message || String(err) };
}

/**
 * The repository allowlist, checked BEFORE ctx.invoke().
 *
 * githubReadFile/githubInspect enforce it themselves too, so this is not the
 * only line of defence — but where it is checked changes what the evidence
 * says. Inside ctx.invoke(), a refusal still records an invocation, and
 * recordAttempt derives `providerCalled` from whether any invocation was
 * recorded. So checking the allowlist inside the wrapper made a boundary
 * refusal indistinguishable in the ledger from a real, failed call to GitHub.
 *
 * That distinction is the whole point of the field: "refused before dispatch"
 * and "the provider was contacted" are different facts, and an audit asking
 * "did SynthOS ever reach out to an unapproved repository" has to be able to
 * get a straight answer. Hence the check moves out here, where a refusal
 * genuinely invokes nothing.
 */
function repositoryBoundaryRefusal(
  capability: string,
  repo: string,
  inputs: { path?: string | null; ref?: string | null } = {},
): ExecutionEnvelopeResult | null {
  if (!isRepositoryApproved(repo)) {
    const approved = approvedRepositories();
    return {
      outcome: 'BLOCKED',
      capability,
      reason: approved.length === 0
        ? `No GitHub repositories are approved for reading. Set GITHUB_APPROVED_REPOS to an explicit comma-separated list (owner/name, or owner/* for a whole owner) before using repository-scoped GitHub tools.`
        : `"${repo}" is not in the approved repository list (${approved.join(', ')}).`,
      toolsInvoked: [],
    };
  }
  // Input shape, checked here for the same evidence reason as the allowlist: a
  // traversal attempt that never leaves the process must not appear in the
  // ledger as a real call to GitHub.
  try {
    if (inputs.path !== undefined && inputs.path !== null) validateRepoPath(inputs.path);
    if (inputs.ref !== undefined) validateRef(inputs.ref);
  } catch (err: any) {
    if (err instanceof GithubBoundaryError) {
      return { outcome: 'BLOCKED', capability, reason: err.message, toolsInvoked: [] };
    }
    throw err;
  }
  return null;
}

async function executeGithubSearch(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const query = toolParam(input, 'query') || (input.rawText || '').trim();
  if (!query) return { outcome: 'FAILED', capability: 'github.search', reason: 'A search query is required.' };
  const limit = toolNumber(input, 'limit', 10, 25);

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  try {
    const outcome = await ctx.invoke('github.search', () => githubSearchRepositories(query, limit));
    return {
      outcome: 'READ_OK',
      capability: 'github.search',
      reason: `${outcome.repositories.length} repository result(s) returned${outcome.totalCount !== null ? ` of ${outcome.totalCount} matching` : ''}.`,
      data: outcome,
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
      brainWriteback: writebackFor('github.search'),
      provenance: { sourceEndpoint: outcome.sourceEndpoint, retrievedAt: outcome.retrievedAt, readOnly: true },
    };
  } catch (err: any) {
    return { ...githubFailure('github.search', err), toolsInvoked: ctx.getInvocations().map((i) => i.name) };
  }
}

async function executeGithubReadFile(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const repo = toolParam(input, 'repo');
  const filePath = toolParam(input, 'path');
  if (!repo) return { outcome: 'FAILED', capability: 'github.read_file', reason: 'A repository (owner/name) is required.' };
  if (!filePath) return { outcome: 'FAILED', capability: 'github.read_file', reason: 'A repository-relative file path is required.' };

  const refusal = repositoryBoundaryRefusal('github.read_file', repo, { path: filePath, ref: toolParam(input, 'ref') || null });
  if (refusal) return refusal;

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  try {
    const file = await ctx.invoke('github.read_file', () =>
      githubReadFile({ repo, path: filePath, ref: toolParam(input, 'ref') || null }),
    );
    return {
      outcome: 'READ_OK',
      capability: 'github.read_file',
      reason: file.content === null
        ? `"${file.path}" in ${file.repo} is binary; metadata returned without content.`
        : `Read "${file.path}" from ${file.repo} (${file.sizeBytes} bytes${file.truncated ? ', truncated' : ''}).`,
      data: file,
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
      brainWriteback: writebackFor('github.read_file'),
      provenance: { sourceEndpoint: file.sourceEndpoint, repo: file.repo, sha: file.sha, ref: file.ref, retrievedAt: file.retrievedAt, readOnly: true },
    };
  } catch (err: any) {
    return { ...githubFailure('github.read_file', err), toolsInvoked: ctx.getInvocations().map((i) => i.name) };
  }
}

const INSPECT_SUBJECTS: GithubInspectSubject[] = ['commit', 'issue', 'pull', 'branch', 'repo'];

async function executeGithubInspect(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const repo = toolParam(input, 'repo');
  const subject = toolParam(input, 'subject').toLowerCase() as GithubInspectSubject;
  if (!repo) return { outcome: 'FAILED', capability: 'github.inspect', reason: 'A repository (owner/name) is required.' };
  if (!INSPECT_SUBJECTS.includes(subject)) {
    return { outcome: 'FAILED', capability: 'github.inspect', reason: `"subject" must be one of: ${INSPECT_SUBJECTS.join(', ')}.` };
  }

  const refusal = repositoryBoundaryRefusal('github.inspect', repo, { ref: toolParam(input, 'ref') || null });
  if (refusal) return refusal;

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  try {
    const result = await ctx.invoke('github.inspect', () =>
      githubInspect({ repo, subject, ref: toolParam(input, 'ref') || null }),
    );
    return {
      outcome: 'READ_OK',
      capability: 'github.inspect',
      reason: `Inspected ${subject}${result.ref ? ` "${result.ref}"` : ''} in ${result.repo}.`,
      data: result,
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
      brainWriteback: writebackFor('github.inspect'),
      provenance: { sourceEndpoint: result.sourceEndpoint, repo: result.repo, subject, retrievedAt: result.retrievedAt, readOnly: true },
    };
  } catch (err: any) {
    return { ...githubFailure('github.inspect', err), toolsInvoked: ctx.getInvocations().map((i) => i.name) };
  }
}

// --- C. Workspace files ----------------------------------------------------

async function executeFilesRead(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const rootKey = toolParam(input, 'root') || toolParam(input, 'rootKey');
  const relativePath = toolParam(input, 'path');
  if (!rootKey) {
    return {
      outcome: 'FAILED',
      capability: 'files.read',
      reason: `A root key is required. Allowed roots: ${allowedFileRootKeys().join(', ')}.`,
    };
  }
  if (!relativePath) return { outcome: 'FAILED', capability: 'files.read', reason: 'A path relative to the chosen root is required.' };

  try {
    const file = readWorkspaceFile(rootKey, relativePath);
    return {
      outcome: 'READ_OK',
      capability: 'files.read',
      reason: `Read "${file.provenance}" (${file.sizeBytes} bytes${file.truncated ? ', truncated' : ''}).`,
      data: file,
      brainWriteback: writebackFor('files.read'),
      // Root-relative provenance only. The absolute host path is deliberately
      // not returned: it leaks the machine's directory layout and the
      // operator's username into model context and evidence rows.
      provenance: { source: file.provenance, modifiedAt: file.modifiedAt, readOnly: true },
    };
  } catch (err: any) {
    if (err instanceof FileBoundaryError) {
      // A boundary refusal is BLOCKED. Only a genuinely absent file is FAILED.
      const blocked = err.code === 'UNKNOWN_ROOT' || err.code === 'BAD_PATH' || err.code === 'SENSITIVE' || err.code === 'ESCAPE';
      return { outcome: blocked ? 'BLOCKED' : 'FAILED', capability: 'files.read', reason: err.message };
    }
    return { outcome: 'FAILED', capability: 'files.read', reason: err?.message || String(err) };
  }
}

async function executeFilesWriteArtifact(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const title = toolParam(input, 'title');
  const content = toolParam(input, 'content') || (input.rawText || '').trim();
  if (!title) return { outcome: 'FAILED', capability: 'files.write_artifact', reason: 'An artifact title is required.' };
  if (!content) return { outcome: 'FAILED', capability: 'files.write_artifact', reason: 'Artifact content is required.' };

  const guardian = guardianCheckInstruction(`${title}\n\n${content}`);
  if (!guardian.allowed) {
    return { outcome: 'BLOCKED', capability: 'files.write_artifact', reason: guardian.error || 'Guardian refused this artifact.' };
  }

  const taskId = deriveIdempotentTaskId('files-artifact', input.idempotencyKey);
  return withAtomicClaim(input, 'files.write_artifact', taskId, async () => {
    // The canonical evidenced path: task -> artifact -> Aegis -> receipt ->
    // KIL -> memory index. Not a direct writeWorkspaceArtifact call, because
    // this is a mutating tool and the whole point is that its output carries
    // the same evidence as any other committed work.
    //
    // `folder` is NOT taken from the caller. writeWorkspaceArtifact validates
    // it as a single safe path segment, so a caller-supplied value would be
    // refused rather than dangerous — but a fixed folder keeps tool output
    // identifiable as tool output.
    const result = await commitEvidencedArtifact({
      taskId,
      workspaceId: input.workspaceId,
      title,
      description: `files.write_artifact — ${title}`,
      assignedAgent: 'tool:files.write_artifact',
      content: content.startsWith('#') ? content : `# ${title}\n\n${content}`,
      folder: 'Tool-Artifacts',
      toolsInvoked: ['files.write_artifact'],
    });
    return { ...result, brainWriteback: writebackFor('files.write_artifact') };
  });
}

// --- D. Scheduler ----------------------------------------------------------

async function executeScheduleList(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const limit = toolNumber(input, 'limit', 50, 200);
  const schedules = listWorkspaceSchedules(input.workspaceId, limit);
  return {
    outcome: 'READ_OK',
    capability: 'schedule.list',
    reason: `${schedules.length} schedule(s) in this workspace.`,
    data: { count: schedules.length, schedules },
    brainWriteback: writebackFor('schedule.list'),
    provenance: { source: 'synthos-scheduler', workspaceScoped: true },
  };
}

async function executeScheduleCreateInternal(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const targetCapability = toolParam(input, 'capability');
  const whenPhrase = toolParam(input, 'when') || (input.rawText || '').trim();
  if (!targetCapability) {
    return { outcome: 'FAILED', capability: 'schedule.create_internal', reason: 'The capability to schedule is required (parameter "capability").' };
  }
  if (!whenPhrase) {
    return { outcome: 'FAILED', capability: 'schedule.create_internal', reason: 'A schedule phrase is required (parameter "when", e.g. "every 6 hours").' };
  }

  // ---------------------------------------------------------------------
  // THE RULE THAT MATTERS: scheduling cannot widen permission.
  //
  // The target capability is resolved and checked HERE, before a schedule
  // exists, against the same conditions executeEnvelope applies to a direct
  // call. Without this, "schedule X hourly" would be a way to obtain X
  // without ever being allowed to invoke X — the schedule would fire later,
  // under the scheduler's own execution, and the caller's lack of permission
  // would never be consulted again.
  //
  // createValidatedSchedule ALSO applies its own gate (it refuses an
  // unguarded EXTERNAL_ACTION). Both checks are kept: that one is about what
  // may ever be scheduled, this one is about what THIS CALLER may schedule.
  // ---------------------------------------------------------------------
  const target = await resolveCapability(targetCapability);
  if (!target) {
    return { outcome: 'FAILED', capability: 'schedule.create_internal', reason: `"${targetCapability}" is not a registered capability.` };
  }
  if (target.effectClass === 'EXTERNAL_ACTION' && target.approvalPolicy !== 'GUARDIAN_ENFORCED' && !EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.has(target.key)) {
    return {
      outcome: 'BLOCKED',
      capability: 'schedule.create_internal',
      reason: `Refusing to schedule "${target.key}": it is an external action without real, wired Guardian enforcement, so it may not be scheduled any more than it may be invoked directly.`,
    };
  }
  if (target.effectClass === 'INTERNAL_MUTATION' && target.approvalPolicy !== 'GUARDIAN_ENFORCED') {
    return {
      outcome: 'BLOCKED',
      capability: 'schedule.create_internal',
      reason: `Refusing to schedule "${target.key}": it mutates durable state without real Guardian enforcement.`,
    };
  }
  if (target.status === 'APPROVAL_REQUIRED') {
    return {
      outcome: 'BLOCKED',
      capability: 'schedule.create_internal',
      reason: `Refusing to schedule "${target.key}": it requires per-invocation approval, which an unattended schedule cannot obtain.`,
    };
  }

  const parsed = parseSchedulePhrase(whenPhrase, new Date().toISOString());
  if ('ambiguous' in parsed && parsed.ambiguous) {
    return { outcome: 'FAILED', capability: 'schedule.create_internal', reason: parsed.reason || `Could not read a schedule out of "${whenPhrase}".` };
  }

  const schedule = await createValidatedSchedule({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    capability: target.key,
    action: toolParam(input, 'action') || 'execute',
    parameters: ((input.parameters || {}).targetParameters as Record<string, unknown>) || {},
    rawText: whenPhrase,
    parsed: parsed as any,
  });

  return {
    outcome: schedule.status === 'BLOCKED' ? 'BLOCKED' : 'SUCCESS',
    capability: 'schedule.create_internal',
    reason: schedule.status === 'BLOCKED'
      ? (schedule.status_reason || 'The scheduler refused this schedule.')
      : `Scheduled "${target.key}" (${schedule.recurrence_type}), next run ${schedule.next_run_at ?? 'unset'}.`,
    schedule,
    data: { scheduleId: schedule.schedule_id, capability: target.key, status: schedule.status, nextRunAt: schedule.next_run_at },
    brainWriteback: writebackFor('schedule.create_internal'),
  };
}

/**
 * Shared ownership check for the two status-transition tools.
 *
 * Returns the schedule only when it really belongs to the caller's workspace.
 * A schedule id from another workspace is reported as if it does not exist —
 * confirming it exists would tell a caller something about another
 * workspace's contents, which is the leak the check is there to prevent.
 */
type OwnedScheduleLookup =
  | { ok: true; schedule: ScheduleRecord; result?: undefined }
  | { ok: false; schedule?: undefined; result: ExecutionEnvelopeResult };

function ownedSchedule(input: ExecutionEnvelopeInput, capability: string): OwnedScheduleLookup {
  const scheduleId = toolParam(input, 'scheduleId') || toolParam(input, 'id');
  if (!scheduleId) {
    return { ok: false, result: { outcome: 'FAILED', capability, reason: 'A scheduleId is required.' } };
  }
  if (!isScheduleInWorkspace(scheduleId, input.workspaceId)) {
    return { ok: false, result: { outcome: 'BLOCKED', capability, reason: `No schedule "${scheduleId}" exists in this workspace.` } };
  }
  const schedule = getSchedule(scheduleId);
  if (!schedule) {
    return { ok: false, result: { outcome: 'FAILED', capability, reason: `No schedule "${scheduleId}" exists in this workspace.` } };
  }
  return { ok: true, schedule };
}

async function executeSchedulePause(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const owned = ownedSchedule(input, 'schedule.pause');
  if (!owned.ok) return owned.result;
  const schedule: ScheduleRecord = owned.schedule;

  if (schedule.status !== 'ACTIVE') {
    return { outcome: 'FAILED', capability: 'schedule.pause', reason: `Cannot pause a schedule in status ${schedule.status} — only ACTIVE schedules can be paused.` };
  }
  setScheduleStatus(schedule.schedule_id, 'PAUSED', 'Paused via schedule.pause.');
  return {
    outcome: 'SUCCESS',
    capability: 'schedule.pause',
    reason: `Paused schedule "${schedule.schedule_id}" (${schedule.capability}).`,
    schedule: getSchedule(schedule.schedule_id) ?? schedule,
    brainWriteback: writebackFor('schedule.pause'),
  };
}

async function executeScheduleResume(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const owned = ownedSchedule(input, 'schedule.resume');
  if (!owned.ok) return owned.result;
  const schedule: ScheduleRecord = owned.schedule;

  if (schedule.status !== 'PAUSED') {
    return { outcome: 'FAILED', capability: 'schedule.resume', reason: `Cannot resume a schedule in status ${schedule.status} — only PAUSED schedules can be resumed.` };
  }
  // Next run is recomputed from now rather than replaying every occurrence
  // missed while paused — the existing route's behaviour, and the same
  // function, so both doors agree.
  const nextRunAt = computeResumeNextRunAt(schedule, new Date().toISOString());
  resumeSchedule(schedule.schedule_id, nextRunAt);
  return {
    outcome: 'SUCCESS',
    capability: 'schedule.resume',
    reason: `Resumed schedule "${schedule.schedule_id}"; next run ${nextRunAt ?? 'unset'}.`,
    schedule: getSchedule(schedule.schedule_id) ?? schedule,
    brainWriteback: writebackFor('schedule.resume'),
  };
}

// --- E. Research -----------------------------------------------------------

async function executeResearchSearch(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const query = toolParam(input, 'query') || (input.rawText || '').trim();
  if (!query) return { outcome: 'FAILED', capability: 'research.search', reason: 'A research query is required.' };
  const limit = toolNumber(input, 'limit', 5, 25);

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  try {
    // discoverLiveRepositories is the RETRIEVAL half of lib/fabric/research.ts,
    // reused directly. The existing `research` capability wraps it together
    // with a Gemini synthesis step and fails if that step fails, which made
    // pure retrieval unavailable without a model credential. Splitting them is
    // what lets this tool be READ_ONLY and honest: what comes back is what was
    // retrieved, with no generated prose mixed in.
    const discovery = await discoverLiveRepositories(query, ctx, limit);
    return {
      outcome: 'READ_OK',
      capability: 'research.search',
      reason: discovery.repos.length > 0
        ? `${discovery.repos.length} live source(s) retrieved for "${query}".`
        : `No live sources were found for "${query}".`,
      data: {
        query,
        searchQueriesUsed: discovery.searchQueriesUsed,
        sources: discovery.sources,
        results: discovery.repos,
        // Section 7, said in the payload and not only in a doc: these are
        // retrieved facts. No model has interpreted them.
        retrievedFacts: true,
        synthesis: null,
        synthesisNote: 'research.search returns retrieved facts only. Synthesis is a separate, model-dependent step and was not performed.',
      },
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
      brainWriteback: writebackFor('research.search'),
      provenance: { sources: discovery.sources, searchQueriesUsed: discovery.searchQueriesUsed, readOnly: true },
    };
  } catch (err: any) {
    return { outcome: 'FAILED', capability: 'research.search', reason: err?.message || String(err), toolsInvoked: ctx.getInvocations().map((i) => i.name) };
  }
}

const RESEARCH_FETCH_TIMEOUT_MS = 10_000;

async function executeResearchFetch(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const rawUrl = toolParam(input, 'url');
  if (!rawUrl) return { outcome: 'FAILED', capability: 'research.fetch', reason: 'A URL is required.' };

  // The SSRF boundary, before any socket is opened. Deliberately does NOT
  // pass allowPrivate: research.fetch fetches URLs that originate in request
  // text, which is exactly the input class SSRF exploits, so it never gets
  // the local-development allowance that MCP has.
  const verdict = await assertSafeOutboundUrl(rawUrl);
  if (!verdict.safe) {
    return {
      outcome: 'BLOCKED',
      capability: 'research.fetch',
      reason: `Refused to fetch "${rawUrl}": ${verdict.reason}`,
      provenance: { url: rawUrl, resolvedAddresses: verdict.resolvedAddresses ?? null, blockedBy: 'lib/net-guard.ts::assertSafeOutboundUrl' },
    };
  }

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEARCH_FETCH_TIMEOUT_MS);
  try {
    const result = await ctx.invoke('research.fetch', async () => {
      const res = await fetch(rawUrl, {
        method: 'GET',
        // Never follow redirects automatically: a public URL that 302s to
        // 169.254.169.254 would otherwise walk straight past the guard above,
        // because the guard validated the ORIGINAL hostname. The redirect
        // target is reported so a caller can choose to re-request it and have
        // it validated on its own merits.
        redirect: 'manual',
        headers: { 'User-Agent': 'synthos-research-fetch', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8' },
        signal: controller.signal,
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        return { redirected: true as const, status: res.status, location, contentType: null, text: '', truncated: false, bytes: 0 };
      }
      const body = await readBoundedBody(res, MAX_OUTBOUND_RESPONSE_BYTES);
      return {
        redirected: false as const,
        status: res.status,
        location: null,
        contentType: res.headers.get('content-type'),
        ...body,
      };
    });

    if (result.redirected) {
      return {
        outcome: 'BLOCKED',
        capability: 'research.fetch',
        reason: `"${rawUrl}" redirected (HTTP ${result.status}) to "${result.location}". Redirects are not followed automatically — the target must be fetched explicitly so the SSRF guard validates it on its own merits.`,
        data: { url: rawUrl, status: result.status, redirectTo: result.location },
        toolsInvoked: ctx.getInvocations().map((i) => i.name),
        provenance: { url: rawUrl, resolvedAddresses: verdict.resolvedAddresses ?? null, redirectNotFollowed: result.location },
      };
    }

    return {
      outcome: 'READ_OK',
      capability: 'research.fetch',
      reason: `Fetched "${rawUrl}" (HTTP ${result.status}, ${result.bytes} bytes${result.truncated ? ', truncated' : ''}).`,
      data: {
        url: rawUrl,
        status: result.status,
        contentType: result.contentType,
        bytes: result.bytes,
        truncated: result.truncated,
        content: result.text,
        // Untrusted, and labelled as such in the payload itself. Content
        // fetched from the open web is an observation from a source SynthOS
        // does not control; it is never knowledge and never an instruction.
        contentTrust: 'UNTRUSTED_EXTERNAL',
        retrievedFacts: true,
        synthesis: null,
      },
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
      brainWriteback: writebackFor('research.fetch'),
      provenance: { url: rawUrl, resolvedAddresses: verdict.resolvedAddresses ?? null, retrievedAt: new Date().toISOString(), readOnly: true },
    };
  } catch (err: any) {
    const reason = err?.name === 'AbortError'
      ? `Fetching "${rawUrl}" timed out after ${RESEARCH_FETCH_TIMEOUT_MS}ms.`
      : (err?.message || String(err));
    return { outcome: 'FAILED', capability: 'research.fetch', reason, toolsInvoked: ctx.getInvocations().map((i) => i.name) };
  } finally {
    clearTimeout(timer);
  }
}

// ===========================================================================
// APPROVAL FOUNDATION — enforcement, and how an approval becomes spendable.
// ===========================================================================

/**
 * The correlation identity an approval binds to.
 *
 * Deliberately the SAME derivation recordAttempt uses, so an approval, the
 * attempt row and any external execution it causes all share one key. A
 * separate id scheme here would mean the approval for a send could not be
 * joined to the evidence that the send happened — which is the one join an
 * audit of an outbound message actually needs.
 */
function approvalCorrelationId(input: ExecutionEnvelopeInput): string {
  if (input.correlationId) return input.correlationId;
  if (input.idempotencyKey) return input.idempotencyKey;
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ capability: input.capability, action: input.action, rawText: input.rawText, parameters: input.parameters }))
    .digest('hex');
  return `attempt-${digest.slice(0, 12)}`;
}

/**
 * A bounded, human-readable description of what is about to happen.
 *
 * This is what the operator reads in the queue before clicking Approve, so it
 * is assembled from the action's real inputs rather than a generic label — "an
 * external action was requested" is not a decision anyone can make. It is
 * scrubbed by requestApproval() before storage, and truncated per field here so
 * one enormous parameter cannot push the rest off the screen.
 */
function summarizeActionForApproval(input: ExecutionEnvelopeInput): string {
  const params = (input.parameters || {}) as Record<string, unknown>;
  const lines: string[] = [`Capability: ${input.capability}`, `Action: ${input.action}`];
  for (const [key, value] of Object.entries(params).slice(0, 12)) {
    let rendered: string;
    if (value === null || value === undefined) rendered = String(value);
    else if (typeof value === 'string') rendered = value.length > 300 ? `${value.slice(0, 300)}… (${value.length} chars)` : value;
    else if (typeof value === 'object') {
      const json = JSON.stringify(value);
      rendered = json.length > 300 ? `${json.slice(0, 300)}… (${json.length} chars)` : json;
    } else rendered = String(value);
    lines.push(`${key}: ${rendered}`);
  }
  if (input.rawText && input.rawText.trim()) {
    const t = input.rawText.trim();
    lines.push(`Request text: ${t.length > 300 ? `${t.slice(0, 300)}…` : t}`);
  }
  return lines.join('\n');
}

/**
 * Enforce the human gate. Returns a refusal result, or null to allow dispatch.
 *
 * On the allowed path the approval is CONSUMED here, before the executor runs.
 * Consuming first is the correct order for an irreversible action: if the
 * process dies mid-send, a spent approval means the retry stops and asks a
 * human rather than sending again. Consuming afterwards would leave the
 * approval spendable during exactly the window where nobody knows whether the
 * side effect already happened — which is the duplicate-send bug C8 is about.
 */
type ApprovalGateOutcome =
  | { refusal: ExecutionEnvelopeResult; consumedApprovalId?: undefined }
  | { refusal?: undefined; consumedApprovalId: string };

async function enforceHumanApproval(
  input: ExecutionEnvelopeInput,
  capabilityKey: string,
  effectClass: string,
): Promise<ApprovalGateOutcome> {
  const correlationId = approvalCorrelationId(input);

  // ---------------------------------------------------------------------
  // WHAT THE APPROVAL BINDS TO.
  //
  // For most capabilities the raw parameters are the whole material content,
  // so the generic digest is right. gmail.send is not one of them, and the
  // difference matters enough to justify the special case:
  //
  // The SENDING ACCOUNT is not a parameter. It is resolved from the calling
  // workspace's connections. A digest over parameters alone would therefore
  // bind the recipients, subject and body but NOT the identity the mail goes
  // out as — so an approval granted while one account was connected could be
  // spent after the account was swapped, and the message would leave as
  // somebody else. Section 4 asks for exactly this to be impossible.
  //
  // So for gmail.send the digest is computed over the fully RESOLVED message
  // spec — from, to, cc, bcc, subject, body, thread, in-reply-to — which is
  // also precisely what computeMessageContentDigest hashes in the send ledger.
  // One definition of "the same message", used by the approval and by the
  // duplicate-send guard, so the two can never disagree about it.
  // ---------------------------------------------------------------------
  let inputDigest: string;
  let summaryOverride: string | null = null;

  if (capabilityKey === 'runtime.antigravity') {
    // A PAID REMOTE AGENT. The approval binds everything that decides what the
    // remote agent will be asked to do and with what: the task, the runtime,
    // the managed agent id, the exact bounded instruction (by digest), the
    // allowed paths and the tool types. Any material change is a new digest,
    // so an approval for the old task cannot be spent on the new one.
    const binding = resolveAntigravityBinding(input);
    if (!binding.instruction.trim()) {
      return { refusal: { outcome: 'FAILED', capability: capabilityKey, reason: 'An instruction is required for runtime.antigravity (parameters.instruction, or the task text).', approval: null } };
    }
    // Guardian sees the FULL bounded instruction, not the truncated summary,
    // before any approval is even requested.
    const full = guardianCheckInstruction(binding.boundedInstruction);
    if (!full.allowed) {
      return { refusal: { outcome: 'BLOCKED', capability: capabilityKey, reason: full.error || 'Guardian refused this instruction.', approval: null } };
    }
    inputDigest = antigravityApprovalDigest(binding);
    summaryOverride = summarizeAntigravityForApproval(binding);
  } else if (capabilityKey === 'gmail.send') {
    const conn = resolveGmailConnection(input.workspaceId, toolParam(input, 'account') || null);
    if (!conn.ok) {
      return {
        refusal: {
          outcome: 'NOT_CONFIGURED',
          capability: capabilityKey,
          reason: conn.reason,
          approval: null,
        },
      };
    }
    const built = buildSpecOrRefusal(input, capabilityKey, conn.connection.accountEmail);
    if (!built.ok) return { refusal: built.result };
    // The message digest IS the approval binding.
    inputDigest = computeMessageContentDigest(built.spec);
    summaryOverride = summarizeGmailSend(built.spec, conn.connection.accountEmail);
  } else {
    inputDigest = computeInputDigest({
      workspaceId: input.workspaceId,
      capability: capabilityKey,
      action: input.action,
      parameters: input.parameters || {},
      rawText: input.rawText,
    });
  }

  // Guardian is consulted on the ACTION CONTENT too, not only on the
  // capability's registry policy — a permitted capability can still be asked to
  // do a forbidden thing, and the approval record stores this verdict so the
  // human sees what policy already said.
  const actionSummary = summaryOverride ?? summarizeActionForApproval(input);
  const guardian = guardianCheckInstruction(`${capabilityKey} ${input.action}\n${actionSummary}`);
  if (!guardian.allowed) {
    // A Guardian denial is terminal here and never reaches an approval lookup.
    // No approval is even requested: offering a human the chance to approve
    // something policy forbids is how a policy engine gets overridden.
    return {
      refusal: {
        outcome: 'BLOCKED',
        capability: capabilityKey,
        reason: guardian.error || 'Guardian refused this action.',
        approval: null,
      },
    };
  }

  const gate = checkApprovalGate({
    workspaceId: input.workspaceId,
    capability: capabilityKey,
    action: input.action,
    inputDigest,
    correlationId,
  });

  if (gate.allowed) {
    const spent = consumeApproval(gate.approval.approval_id, input.parameters?.taskId as string | null ?? null);
    if (!spent) {
      // Lost the race to another dispatch holding the same approval. Refused
      // rather than sent — the other caller owns this action.
      return {
        refusal: {
          outcome: 'BLOCKED',
          capability: capabilityKey,
          reason: `The approval authorizing this action was consumed by another dispatch — refusing rather than performing the external action twice.`,
          approval: {
            approvalId: gate.approval.approval_id,
            status: 'CONSUMED',
            inputDigest,
            expiresAt: gate.approval.expires_at,
            decidedBy: gate.approval.decided_by_user_id,
          },
        },
      };
    }
    // Allowed. The consumed approval's id travels back so the dispatcher can
    // link it to the task the executor is about to create.
    return { consumedApprovalId: gate.approval.approval_id };
  }

  // Not allowed. A terminal decision about THESE inputs is reported as-is; an
  // absence of any decision about these inputs creates a new request.
  //
  // STALE_INPUTS is deliberately NOT terminal, and an earlier version of this
  // code got that wrong. It blocked the changed action and requested nothing,
  // which left the operator with an action that could never be approved: the
  // approval queue held a decision about the OLD inputs and no mechanism
  // existed to ask about the new ones. The action was permanently stuck.
  //
  // The correct behaviour, and what C3 asks for, is that changed inputs send
  // the action BACK to WAITING_FOR_APPROVAL — a fresh request, bound to the new
  // digest, with the reason saying plainly that the inputs changed. The safety
  // property is already guaranteed by the digest binding: the old approval
  // cannot authorize the new action because the lookup is BY digest, so it is
  // never found. Blocking as well as rebinding bought no safety and cost the
  // operator a dead end.
  //
  // WHICH STATES ARE TERMINAL, and why each is where it is:
  //
  //   REJECTED — a human said no. Terminal. Automatically re-asking would turn
  //              "no" into "not yet", and an agent that re-requests until it
  //              gets a yes has defeated the queue.
  //   EXPIRED  — permission LAPSED; nobody refused. Not terminal: the honest
  //              response to lapsed permission is to ask again, exactly as for
  //              changed inputs. Treating it as terminal dead-ended the action
  //              the same way the STALE_INPUTS bug did.
  //   CONSUMED — already spent. Terminal for this correlation, because the
  //              side effect may already have happened and re-asking could
  //              produce a second one. A genuinely new action needs a new
  //              correlation, which is a deliberate decision rather than a
  //              retry. checkApprovalGate reports this as EXPIRED-with-a-
  //              consumed-record, so it is matched on the record's own status
  //              rather than on the state name.
  const consumedRecord = gate.approval?.status === 'CONSUMED';
  if (gate.state === 'REJECTED' || consumedRecord) {
    // For a send, the approval being spent is not the most useful thing to
    // tell the operator — WHAT HAPPENED to the send is. A consumed approval
    // whose ledger row is UNKNOWN means a message may already be in somebody's
    // inbox, and "this approval was already used" would leave them to discover
    // that themselves. So the ledger state is surfaced here.
    let enriched: string | null = null;
    if (consumedRecord && capabilityKey === 'gmail.send' && gate.approval) {
      const attempt = getGmailSendAttemptByApproval(gate.approval.approval_id);
      if (attempt?.status === 'UNKNOWN') {
        enriched =
          `The previous send for this approval reached Gmail at ${attempt.dispatched_at} and its outcome is UNKNOWN — ` +
          `the message MAY already have been delivered. SynthOS will not retry. Check the sending account's Sent folder; ` +
          `if nothing was sent, request a new approval.`;
      } else if (attempt?.status === 'SENT') {
        enriched = `This message was already sent (Gmail message id ${attempt.provider_message_id}) at ${attempt.resolved_at}. Not sending again.`;
      } else if (attempt?.status === 'FAILED') {
        enriched = `The previous send for this approval failed (${attempt.error_category}) at ${attempt.resolved_at}. A new approval is required before trying again.`;
      }
    }
    if (enriched) {
      return {
        refusal: {
          outcome: 'BLOCKED',
          capability: capabilityKey,
          reason: enriched,
          approval: gate.approval
            ? {
                approvalId: gate.approval.approval_id,
                status: gate.approval.status,
                inputDigest,
                expiresAt: gate.approval.expires_at,
                decidedBy: gate.approval.decided_by_user_id,
              }
            : null,
        },
      };
    }
    return {
      refusal: {
      outcome: 'BLOCKED',
      capability: capabilityKey,
      reason: gate.reason,
      approval: gate.approval
        ? {
            approvalId: gate.approval.approval_id,
            status: gate.approval.status,
            inputDigest,
            expiresAt: gate.approval.expires_at,
            decidedBy: gate.approval.decided_by_user_id,
          }
        : null,
    },
    };
  }

  // WAITING_FOR_APPROVAL (or STALE_INPUTS, which becomes a fresh wait).
  //
  // Reuse an existing pending request rather than creating a duplicate every
  // time the caller retries — but ONLY when it is bound to these inputs. On the
  // stale path gate.approval is the OLD approval, which must not be presented
  // as this action's pending decision, so it is discarded here.
  const inputsChanged = gate.state === 'STALE_INPUTS';
  const lapsed = gate.state === 'EXPIRED';
  let pending: ApprovalRecord | undefined = inputsChanged || lapsed ? undefined : gate.approval;
  if (!pending) {
    pending = requestApproval({
      workspaceId: input.workspaceId,
      taskId: null,
      correlationId,
      capability: capabilityKey,
      action: input.action,
      effectClass,
      requestedByUserId: input.actorUserId,
      guardianDecision: 'SAFE',
      guardianCitation: guardian.citation ?? null,
      actionSummary,
      inputDigest,
    });
  }

  return {
    refusal: {
    outcome: 'APPROVAL_REQUIRED',
    capability: capabilityKey,
    reason: lapsed
      ? `The approval for "${capabilityKey}" lapsed before it was used — ${gate.reason} ` +
        `A new approval "${pending.approval_id}" is waiting in this workspace's approval queue. No provider was contacted.`
      : inputsChanged
      ? `The inputs to "${capabilityKey}" changed after approval was sought, so any earlier decision no longer applies — ` +
        `${gate.reason} A new approval "${pending.approval_id}" is waiting in this workspace's approval queue. No provider was contacted.`
      : `"${capabilityKey}" is an external action and requires a human decision before it can run. ` +
        `Approval "${pending.approval_id}" is waiting in this workspace's approval queue. No provider was contacted.`,
    approval: {
      approvalId: pending.approval_id,
      status: pending.status,
      inputDigest,
      expiresAt: pending.expires_at,
      decidedBy: pending.decided_by_user_id,
    },
    // Nothing was invoked: the refusal happened before any executor ran.
    toolsInvoked: [],
    },
  };
}

/**
 * The bounded contract double behind verification.external_action.
 *
 * Reaching this function means the whole gate already passed: Guardian
 * permitted the action, a human approved it, and that approval was consumed.
 * So what it proves is the LIFECYCLE, and it is careful to prove nothing more —
 * it makes no network call, and the artifact it writes says so in its own text
 * so that a reader finding it later cannot mistake it for a real send.
 */
async function executeApprovalVerification(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const taskId = deriveIdempotentTaskId('approval-verify', input.idempotencyKey);
  const label = toolParam(input, 'label') || 'unlabelled';

  return withAtomicClaim(input, 'verification.external_action', taskId, async () => {
    const content = [
      '# APPROVAL WORKFLOW VERIFICATION — NOT A REAL PROVIDER EXECUTION',
      '',
      'This artifact was produced by `verification.external_action`, a synthetic',
      'capability that exists only to prove the human-approval lifecycle end to end.',
      '',
      '**No external provider was contacted. No message was sent. No socket was opened.**',
      '',
      `- label: ${label}`,
      `- workspace: ${input.workspaceId}`,
      `- requested by: ${input.actorUserId}`,
      `- correlation id: ${approvalCorrelationId(input)}`,
      `- executed at: ${new Date().toISOString()}`,
      '',
      'What reaching this text proves, in order:',
      '',
      '1. Guardian permitted the action.',
      '2. A human approval bound to these exact inputs existed.',
      '3. That approval was consumed, so it cannot authorize a second dispatch.',
      '4. The bounded contract double ran and produced evidence.',
      '',
      'Safe to delete.',
    ].join('\n');

    const result = await commitEvidencedArtifact({
      taskId,
      workspaceId: input.workspaceId,
      title: `Approval workflow verification — ${label}`,
      description: 'verification.external_action — approval lifecycle proof, no provider contacted',
      assignedAgent: 'tool:verification.external_action',
      content,
      folder: 'Approval-Verification',
      // Named so the invocation trace shows a contract double, never a provider.
      toolsInvoked: ['verification.contract_double'],
    });
    return { ...result, brainWriteback: 'ARTIFACT' as BrainWritebackPolicy };
  });
}

// ===========================================================================
// TOOL PACK 2 — Gmail executors.
//
// All four go through this one envelope. There is no Gmail-specific execution
// path, no separate messaging framework, and no second approval mechanism:
// gmail.send is EXTERNAL_ACTION, so it passes through enforceHumanApproval
// exactly as verification.external_action does, and the approval it needs is an
// ordinary row in the same `approvals` table that appears in the same queue.
// ===========================================================================

/** Resolve the workspace's mailbox, or an honest refusal naming the missing step. */
type GmailConnLookup =
  | { ok: true; connectionId: string; account: string; result?: undefined }
  | { ok: false; connectionId?: undefined; account?: undefined; result: ExecutionEnvelopeResult };

function gmailConnectionOrRefusal(input: ExecutionEnvelopeInput, capability: string): GmailConnLookup {
  const requestedAccount = toolParam(input, 'account') || null;
  const resolved = resolveGmailConnection(input.workspaceId, requestedAccount);
  if (resolved.ok) {
    return { ok: true, connectionId: resolved.connection.connectionId, account: resolved.connection.accountEmail };
  }

  const readiness = gmailWorkspaceReadiness(input.workspaceId);
  return {
    ok: false,
    result: {
      outcome: 'NOT_CONFIGURED',
      capability,
      // AMBIGUOUS is a FAILED, not a NOT_CONFIGURED: two accounts are connected
      // and the caller must name one. Reporting that as "not configured" would
      // send an operator to connect a third.
      reason: resolved.code === 'AMBIGUOUS' ? resolved.reason : `${resolved.reason} ${readiness.reason}`,
      ...(resolved.code === 'AMBIGUOUS' ? { outcome: 'FAILED' as EnvelopeOutcome } : {}),
    },
  };
}

function gmailFailure(capability: string, err: any, ctx?: { getInvocations(): Array<{ name: string }> }): ExecutionEnvelopeResult {
  const toolsInvoked = ctx ? ctx.getInvocations().map((i) => i.name) : [];
  if (err instanceof GmailContentError) {
    // A malformed address or an injected header is a boundary refusal.
    return { outcome: 'BLOCKED', capability, reason: err.message, toolsInvoked };
  }
  if (err instanceof GmailAuthError) {
    return {
      outcome: 'NOT_CONFIGURED',
      capability,
      reason: err.needsReauth ? `${err.message} The account must be reconnected.` : err.message,
      toolsInvoked,
    };
  }
  if (err instanceof GmailApiError) {
    return {
      outcome: err.category === 'AUTHENTICATION' || err.category === 'PERMISSION' ? 'NOT_CONFIGURED' : 'FAILED',
      capability,
      reason: `${err.category}: ${err.message}`,
      toolsInvoked,
    };
  }
  return { outcome: 'FAILED', capability, reason: err?.message || String(err), toolsInvoked };
}

// --- READ_ONLY -------------------------------------------------------------

async function executeGmailSearch(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const conn = gmailConnectionOrRefusal(input, 'gmail.search');
  if (!conn.ok) return conn.result;

  const query = toolParam(input, 'query') || (input.rawText || '').trim();
  if (!query) return { outcome: 'FAILED', capability: 'gmail.search', reason: 'A search query is required.' };

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  try {
    const outcome = await ctx.invoke('gmail.search', () =>
      gmailSearch({
        connectionId: conn.connectionId,
        workspaceId: input.workspaceId,
        account: conn.account,
        query,
        limit: toolNumber(input, 'limit', 10, 25),
      }),
    );
    return {
      outcome: 'READ_OK',
      capability: 'gmail.search',
      reason: `${outcome.resultCount} message(s) matched in ${conn.account}${outcome.estimatedTotal !== null ? ` (Gmail estimates ${outcome.estimatedTotal} total)` : ''}.`,
      data: outcome,
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
      // Mail read is an OBSERVATION. It never becomes knowledge on its own.
      brainWriteback: writebackFor('gmail.search'),
      provenance: {
        source: 'gmail-api',
        account: conn.account,
        sourceEndpoint: outcome.sourceEndpoint,
        retrievedAt: outcome.retrievedAt,
        readOnly: true,
        contentTrust: 'UNTRUSTED_EXTERNAL',
      },
    };
  } catch (err: any) {
    return gmailFailure('gmail.search', err, ctx);
  }
}

async function executeGmailReadThread(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const conn = gmailConnectionOrRefusal(input, 'gmail.read_thread');
  if (!conn.ok) return conn.result;

  const threadId = toolParam(input, 'threadId') || toolParam(input, 'thread_id');
  if (!threadId) return { outcome: 'FAILED', capability: 'gmail.read_thread', reason: 'A threadId is required.' };

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  try {
    const outcome = await ctx.invoke('gmail.read_thread', () =>
      gmailReadThread({
        connectionId: conn.connectionId,
        workspaceId: input.workspaceId,
        account: conn.account,
        threadId,
        maxMessages: toolNumber(input, 'maxMessages', 20, 50),
      }),
    );
    return {
      outcome: 'READ_OK',
      capability: 'gmail.read_thread',
      reason: `Read ${outcome.messages.length} of ${outcome.messageCount} message(s) in thread ${outcome.threadId}.`,
      data: outcome,
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
      brainWriteback: writebackFor('gmail.read_thread'),
      provenance: {
        source: 'gmail-api',
        account: conn.account,
        threadId: outcome.threadId,
        sourceEndpoint: outcome.sourceEndpoint,
        retrievedAt: outcome.retrievedAt,
        readOnly: true,
        // Message bodies are written by whoever emailed this mailbox. They are
        // data, never instructions, and never promoted to Brain knowledge.
        contentTrust: 'UNTRUSTED_EXTERNAL',
      },
    };
  } catch (err: any) {
    return gmailFailure('gmail.read_thread', err, ctx);
  }
}

// --- Message spec assembly, shared by draft and send ----------------------

function addressList(input: ExecutionEnvelopeInput, key: string): string[] {
  const v = (input.parameters || {})[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

type GmailSpecBuild =
  | { ok: true; spec: GmailMessageSpec; result?: undefined }
  | { ok: false; spec?: undefined; result: ExecutionEnvelopeResult };

function buildSpecOrRefusal(
  input: ExecutionEnvelopeInput,
  capability: string,
  senderAccount: string,
): GmailSpecBuild {
  const to = addressList(input, 'to');
  const cc = addressList(input, 'cc');
  const bcc = addressList(input, 'bcc');
  const subject = toolParam(input, 'subject');
  const body = toolParam(input, 'body') || (input.rawText || '').trim();

  const bad = (reason: string) => ({ ok: false as const, result: { outcome: 'BLOCKED' as EnvelopeOutcome, capability, reason } });

  if (to.length === 0) return bad('At least one "to" recipient is required.');
  for (const addr of [...to, ...cc, ...bcc]) {
    if (!isValidEmailAddress(addr)) return bad(`"${addr}" is not a valid email address, or contains characters that are refused as a header-injection risk.`);
  }
  if (!subject) return bad('A subject is required.');
  if (!body) return bad('A message body is required.');

  // NO BULK SEND. The cap is on total addressees, not on `to` alone, so it
  // cannot be sidestepped by moving recipients into cc or bcc. Tool Pack 2
  // sends one message to a small, human-reviewable set of people; anything
  // larger is a broadcast and belongs to a capability nobody has approved
  // building yet.
  const MAX_RECIPIENTS = 5;
  const total = to.length + cc.length + bcc.length;
  if (total > MAX_RECIPIENTS) {
    return bad(`${total} recipients requested (to+cc+bcc). Tool Pack 2 permits at most ${MAX_RECIPIENTS} per message — bulk and mass outbound messaging are not implemented.`);
  }

  // A sender named in the parameters must MATCH the resolved connection. It is
  // never used to select one: the connection is resolved from the workspace and
  // the account parameter first, and this is a consistency check so a "from"
  // that disagrees is refused rather than silently ignored.
  const declaredFrom = toolParam(input, 'from');
  if (declaredFrom && declaredFrom.toLowerCase() !== senderAccount.toLowerCase()) {
    return bad(`The "from" address "${declaredFrom}" does not match the connected sending account "${senderAccount}". A sender is never substituted.`);
  }

  const threadId = toolParam(input, 'threadId') || null;
  const inReplyTo = toolParam(input, 'inReplyToMessageId') || null;
  // A reply must name BOTH the thread and the message it answers. Binding on
  // the visible subject alone is how a reply lands in the wrong conversation:
  // subjects repeat, and "Re: Contract" is not an identity.
  if (inReplyTo && !threadId) return bad('A reply must supply "threadId" as well as "inReplyToMessageId" — subject text is not a thread identity.');

  return {
    ok: true,
    spec: { from: senderAccount, to, cc, bcc, subject, body, threadId, inReplyToMessageId: inReplyTo },
  };
}

/**
 * The human-readable summary the approval queue shows.
 *
 * Every field the instruction asks for, and nothing that could carry a secret:
 * recipients, subject, a bounded body preview, the sending identity, and the
 * attachment position. No OAuth material, no raw provider payload. It is
 * scrubbed again by requestApproval before storage.
 */
function summarizeGmailSend(spec: GmailMessageSpec, account: string): string {
  const preview = spec.body.length > 1200 ? `${spec.body.slice(0, 1200)}\n… (${spec.body.length} characters total)` : spec.body;
  const lines = [
    `SEND EMAIL — this will leave SynthOS and reach a person.`,
    ``,
    `From (connected account): ${account}`,
    `To: ${spec.to.join(', ')}`,
  ];
  if (spec.cc?.length) lines.push(`Cc: ${spec.cc.join(', ')}`);
  if (spec.bcc?.length) lines.push(`Bcc: ${spec.bcc.join(', ')}`);
  lines.push(`Subject: ${spec.subject}`);
  if (spec.threadId) lines.push(`Reply in thread: ${spec.threadId}${spec.inReplyToMessageId ? ` (answering message ${spec.inReplyToMessageId})` : ''}`);
  lines.push(`Attachments: none (not implemented in Tool Pack 2)`);
  lines.push(``, `--- body ---`, preview);
  return lines.join('\n');
}

// --- INTERNAL_MUTATION: draft is not send ---------------------------------

async function executeGmailCreateDraft(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const conn = gmailConnectionOrRefusal(input, 'gmail.create_draft');
  if (!conn.ok) return conn.result;

  const built = buildSpecOrRefusal(input, 'gmail.create_draft', conn.account);
  if (!built.ok) return built.result;

  const guardian = guardianCheckInstruction(summarizeGmailSend(built.spec, conn.account));
  if (!guardian.allowed) {
    return { outcome: 'BLOCKED', capability: 'gmail.create_draft', reason: guardian.error || 'Guardian refused this draft.' };
  }

  const taskId = deriveIdempotentTaskId('gmail-draft', input.idempotencyKey);
  return withAtomicClaim(input, 'gmail.create_draft', taskId, async () => {
    const ctx = createExecutionContext({ workspaceId: input.workspaceId });
    try {
      const draft = await ctx.invoke('gmail.create_draft', () =>
        gmailCreateDraft({
          connectionId: conn.connectionId,
          workspaceId: input.workspaceId,
          account: conn.account,
          spec: built.spec,
        }),
      );

      // The draft is committed as an evidenced artifact. The artifact records
      // the content digest, which is what a later send approval must match —
      // so "review the draft, then approve the send" is verifiable rather than
      // a matter of trusting that the text did not change in between.
      const content = [
        `# Gmail draft — ${built.spec.subject}`,
        ``,
        `**This is a DRAFT. Nothing was sent.**`,
        ``,
        `- account: ${conn.account}`,
        `- draft id: ${draft.draftId}`,
        `- content digest: ${draft.contentDigest}`,
        `- to: ${built.spec.to.join(', ')}`,
        built.spec.cc?.length ? `- cc: ${built.spec.cc.join(', ')}` : '',
        built.spec.bcc?.length ? `- bcc: ${built.spec.bcc.join(', ')}` : '',
        built.spec.threadId ? `- thread: ${built.spec.threadId}` : '',
        ``,
        `## Subject`,
        ``,
        built.spec.subject,
        ``,
        `## Body`,
        ``,
        built.spec.body,
      ].filter(Boolean).join('\n');

      const committed = await commitEvidencedArtifact({
        taskId,
        workspaceId: input.workspaceId,
        title: `Gmail draft — ${built.spec.subject}`,
        description: `gmail.create_draft — draft ${draft.draftId} for ${conn.account}`,
        assignedAgent: 'tool:gmail.create_draft',
        content,
        folder: 'Gmail-Drafts',
        toolsInvoked: ctx.getInvocations().map((i) => i.name),
      });

      return {
        ...committed,
        reason: `Draft ${draft.draftId} created in ${conn.account}. NOTHING WAS SENT — sending requires a separate approved gmail.send.`,
        data: {
          draftId: draft.draftId,
          messageId: draft.messageId,
          threadId: draft.threadId,
          account: conn.account,
          contentDigest: draft.contentDigest,
          sent: false,
        },
        brainWriteback: writebackFor('gmail.create_draft'),
        provenance: { source: 'gmail-api', account: conn.account, draftId: draft.draftId, sourceEndpoint: draft.sourceEndpoint, sent: false },
      };
    } catch (err: any) {
      return gmailFailure('gmail.create_draft', err, ctx);
    }
  });
}

// --- EXTERNAL_ACTION: the send --------------------------------------------

/**
 * Send exactly one approved message.
 *
 * By the time this function runs, dispatchEnvelope has already established:
 *   1. the capability is registered and configured;
 *   2. Guardian permitted the action;
 *   3. a human approval bound to this exact input digest existed;
 *   4. that approval has been CONSUMED and cannot authorize anything else.
 *
 * What remains is this function's own responsibility: claim the send locally
 * before touching the provider, so the SIDE EFFECT is protected as well as the
 * authority, and classify the outcome honestly — including the one outcome that
 * must never be retried.
 */
async function executeGmailSend(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const conn = gmailConnectionOrRefusal(input, 'gmail.send');
  if (!conn.ok) return conn.result;

  const built = buildSpecOrRefusal(input, 'gmail.send', conn.account);
  if (!built.ok) return built.result;

  const approvalId = input.__consumedApprovalId;
  if (!approvalId) {
    // Defence in depth. The gate in dispatchEnvelope already refuses an
    // unapproved external action, so reaching here without an approval id would
    // mean the gate was bypassed — and the right response to that is to refuse,
    // loudly, rather than to send.
    return {
      outcome: 'BLOCKED',
      capability: 'gmail.send',
      reason: 'No consumed approval accompanies this send. Refusing — a send is never performed without a human approval that has been spent for it.',
      toolsInvoked: [],
    };
  }

  const contentDigest = computeMessageContentDigest(built.spec);
  const correlationId = approvalCorrelationId(input);

  // CLAIM BEFORE DISPATCH. Gmail has no idempotency key, so this row is the
  // only thing that can tell a second attempt that the first one happened.
  const claim = claimGmailSend({
    workspaceId: input.workspaceId,
    approvalId,
    connectionId: conn.connectionId,
    correlationId,
    contentDigest,
  });

  if (!claim.ok) {
    return {
      // ALREADY_SENT is not a failure — the requested outcome exists. It is
      // reported as CONFLICT so a caller can tell "already done" from "broken".
      outcome: claim.code === 'ALREADY_SENT' ? 'CONFLICT' : 'BLOCKED',
      capability: 'gmail.send',
      reason: claim.reason,
      data: {
        account: conn.account,
        sent: claim.existing.status === 'SENT',
        providerMessageId: claim.existing.provider_message_id,
        previousAttemptStatus: claim.existing.status,
      },
      toolsInvoked: [],
      provenance: { source: 'gmail-api', duplicateProtection: 'gmail_send_attempts', previousAttempt: claim.existing.attempt_id },
    };
  }

  const taskId = deriveIdempotentTaskId('gmail-send', input.idempotencyKey);
  linkGmailSendToTask(claim.claim.attemptId, taskId);

  const ctx = createExecutionContext({ workspaceId: input.workspaceId });
  try {
    const sent = await ctx.invoke('gmail.send', () =>
      gmailSendMessage({
        connectionId: conn.connectionId,
        workspaceId: input.workspaceId,
        account: conn.account,
        spec: built.spec,
        sendClaim: claim.claim,
      }),
    );

    resolveGmailSendSent(claim.claim.attemptId, sent.messageId, sent.threadId);

    // Evidence. The receipt carries SAFE metadata only — identifiers and
    // digests, never the body and never the recipient addresses in the clear.
    const recipientDigest = crypto
      .createHash('sha256')
      .update(JSON.stringify({ to: built.spec.to, cc: built.spec.cc ?? [], bcc: built.spec.bcc ?? [] }))
      .digest('hex');

    const content = [
      `# Gmail message sent`,
      ``,
      `A real email left SynthOS and was accepted by Gmail.`,
      ``,
      `- provider message id: ${sent.messageId}`,
      `- provider thread id: ${sent.threadId ?? '(none)'}`,
      `- sending account: ${conn.account}`,
      `- recipient digest: ${recipientDigest}`,
      `- recipient count: ${built.spec.to.length + (built.spec.cc?.length ?? 0) + (built.spec.bcc?.length ?? 0)}`,
      `- subject: ${built.spec.subject}`,
      `- content digest: ${sent.contentDigest}`,
      `- approval id: ${approvalId}`,
      `- correlation id: ${correlationId}`,
      `- sent at: ${sent.sentAt}`,
      ``,
      `The message body is deliberately NOT reproduced here. The content digest`,
      `above proves which text was approved and sent; copying private`,
      `correspondence into the evidence spine would put it somewhere it was`,
      `never meant to be.`,
    ].join('\n');

    const committed = await commitEvidencedArtifact({
      taskId,
      workspaceId: input.workspaceId,
      title: `Gmail sent — ${built.spec.subject}`,
      description: `gmail.send — message ${sent.messageId} from ${conn.account}`,
      assignedAgent: 'tool:gmail.send',
      content,
      folder: 'Gmail-Sent',
      toolsInvoked: ctx.getInvocations().map((i) => i.name),
    });

    return {
      ...committed,
      reason: `Sent. Gmail message id ${sent.messageId}${sent.threadId ? `, thread ${sent.threadId}` : ''}, from ${conn.account}.`,
      data: {
        sent: true,
        providerMessageId: sent.messageId,
        providerThreadId: sent.threadId,
        account: conn.account,
        recipientCount: built.spec.to.length + (built.spec.cc?.length ?? 0) + (built.spec.bcc?.length ?? 0),
        contentDigest: sent.contentDigest,
        sentAt: sent.sentAt,
      },
      brainWriteback: writebackFor('gmail.send'),
      provenance: {
        source: 'gmail-api',
        account: conn.account,
        providerMessageId: sent.messageId,
        approvalId,
        sourceEndpoint: sent.sourceEndpoint,
        recipientDigest,
      },
    };
  } catch (err: any) {
    const ambiguous = err instanceof GmailApiError && err.ambiguous;
    const category = err instanceof GmailApiError ? err.category : 'PROVIDER_ERROR';
    resolveGmailSendFailure(claim.claim.attemptId, category, err?.message || String(err), ambiguous);

    if (ambiguous) {
      // THE MOST IMPORTANT BRANCH IN THIS FILE.
      //
      // Gmail may or may not have delivered the message. Reporting FAILED would
      // invite a retry and a possible duplicate; reporting SUCCESS would be a
      // fabrication. So it is its own outcome, the ledger row stays UNKNOWN,
      // and the approval is already consumed — which together mean no
      // automatic path leads to a second attempt. A human checks the mailbox.
      return {
        outcome: 'FAILED',
        capability: 'gmail.send',
        reason:
          `UNKNOWN: ${err.message} SynthOS cannot tell whether this message was delivered, so it will NOT retry. ` +
          `Check ${conn.account}'s Sent folder; if nothing was sent, request a new approval.`,
        data: {
          sent: 'UNKNOWN',
          account: conn.account,
          attemptId: claim.claim.attemptId,
          contentDigest,
          retrySafe: false,
        },
        toolsInvoked: ctx.getInvocations().map((i) => i.name),
        provenance: { source: 'gmail-api', sendState: 'UNKNOWN', automaticRetry: 'REFUSED', attemptId: claim.claim.attemptId },
      };
    }

    const failure = gmailFailure('gmail.send', err, ctx);
    return {
      ...failure,
      data: { sent: false, account: conn.account, attemptId: claim.claim.attemptId, errorCategory: category },
      provenance: { source: 'gmail-api', sendState: 'FAILED', errorCategory: category, attemptId: claim.claim.attemptId },
    };
  }
}

/**
 * Read one EXTERNAL vault source.
 *
 * A separate capability from brain.read on purpose. brain.read enforces
 * workspace attribution from a note's own frontmatter, which external notes do
 * not have and should not be expected to — they predate SynthOS and belong to
 * the operator. Overloading one capability to mean both "read admitted
 * knowledge, workspace-scoped" and "read unadmitted source material,
 * vault-scoped" would have made its contract impossible to state in a sentence.
 *
 * The result is labelled UNADMITTED and carries the external trust note, so a
 * model receiving it is told, in the payload, that it is source material and
 * not knowledge.
 */
async function executeBrainReadSource(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const sourcePath = toolParam(input, 'path') || toolParam(input, 'vaultRelativePath');
  if (!sourcePath) {
    return { outcome: 'FAILED', capability: 'brain.read_source', reason: 'A vault-relative source path is required (parameter "path").' };
  }
  try {
    const record = readExternalSource(sourcePath);
    return {
      outcome: 'READ_OK',
      capability: 'brain.read_source',
      reason: `Read external source "${record.vaultRelativePath}" (${record.sizeBytes} bytes${record.bodyTruncated ? ', truncated' : ''}). NOT admitted knowledge.`,
      data: {
        ...record,
        // Stated in the payload, not just in a doc comment.
        trustNote: EXTERNAL_TRUST_NOTE,
      },
      brainWriteback: writebackFor('brain.read_source'),
      provenance: {
        source: 'external-vault',
        vaultRelativePath: record.vaultRelativePath,
        contentHash: record.contentHash,
        classification: 'EXTERNAL_SOURCE',
        admission: 'UNADMITTED',
        contentTrust: 'UNTRUSTED_EXTERNAL',
        readOnly: true,
      },
    };
  } catch (err: any) {
    if (err instanceof ExternalSourceAccessError) {
      const blocked = err.code === 'BAD_PATH' || err.code === 'IN_MANAGED_SUBTREE';
      return { outcome: blocked ? 'BLOCKED' : 'FAILED', capability: 'brain.read_source', reason: err.message };
    }
    return { outcome: 'FAILED', capability: 'brain.read_source', reason: err?.message || String(err) };
  }
}


// ---------------------------------------------------------------------------
// runtime.antigravity — the managed Antigravity agent as a canonical runtime.
//
// This executor adds NO execution machinery of its own. It submits through
// the one external-execution ledger (lib/external-executions.ts), which runs
// Guardian again on the exact instruction, refuses when the runtime is not
// configured or ANTIGRAVITY_ENABLED is not "true", and arms the row for the
// ONE scheduler sweep. That sweep polls, ingests, runs Aegis, signs the
// receipt, indexes the artifact into the Brain and completes the linked task.
//
// It returns SUBMITTED and never waits: a remote agent can run for minutes,
// and holding a request (or a scheduler tick) open for that is how a
// submission becomes an outage.
//
// It is only reachable after the human gate in dispatchEnvelope has consumed
// an approval bound to resolveAntigravityBinding() — this is a paid remote
// execution and there is deliberately no unattended path to it.
// ---------------------------------------------------------------------------

export interface AntigravityBinding {
  workspaceId: string;
  capability: 'runtime.antigravity';
  runtime: 'antigravity';
  agent: string;
  taskId: string | null;
  /** The instruction as supplied. */
  instruction: string;
  /** What is actually sent: the instruction plus its declared scope. */
  boundedInstruction: string;
  instructionDigest: string;
  allowedPaths: string[];
  tools: string[];
  maxTotalTokens: number | null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .map((x) => (typeof x === 'string' ? x : (x && typeof (x as any).type === 'string' ? (x as any).type : '')))
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
  return Array.from(new Set(out)).sort();
}

/**
 * Everything the approval for a runtime.antigravity dispatch binds to, derived
 * the same way by the gate and by the executor so they can never disagree.
 */
export function resolveAntigravityBinding(input: ExecutionEnvelopeInput): AntigravityBinding {
  const params = (input.parameters || {}) as Record<string, unknown>;
  const instruction = typeof params.instruction === 'string' && params.instruction.trim()
    ? params.instruction
    : String(input.rawText || '');
  const allowedPaths = stringList(params.allowedPaths);
  const tools = stringList(params.tools);
  const maxTotalTokens = typeof params.maxTotalTokens === 'number' && Number.isFinite(params.maxTotalTokens)
    ? Math.floor(params.maxTotalTokens)
    : null;

  // The scope is stated IN the instruction because that is the only channel
  // the managed agent API offers. It binds the approval and tells the agent;
  // it is not a sandbox SynthOS enforces, and nothing here claims it is.
  const scopeLines: string[] = [];
  if (allowedPaths.length > 0) {
    scopeLines.push('', 'SCOPE (approved by a human; do not act outside it):', ...allowedPaths.map((p) => `- ${p}`));
  }
  const boundedInstruction = `${instruction}${scopeLines.length ? `\n${scopeLines.join('\n')}` : ''}`;

  return {
    workspaceId: input.workspaceId,
    capability: 'runtime.antigravity',
    runtime: 'antigravity',
    agent: resolveAntigravityAgent(),
    taskId: input.taskId ?? null,
    instruction,
    boundedInstruction,
    instructionDigest: crypto.createHash('sha256').update(boundedInstruction).digest('hex'),
    allowedPaths,
    tools,
    maxTotalTokens,
  };
}

/** The approval digest for a runtime.antigravity dispatch. Built on the canonical computeInputDigest. */
export function antigravityApprovalDigest(binding: AntigravityBinding): string {
  return computeInputDigest({
    workspaceId: binding.workspaceId,
    capability: binding.capability,
    action: 'execute',
    parameters: {
      runtime: binding.runtime,
      agent: binding.agent,
      taskId: binding.taskId,
      instructionDigest: binding.instructionDigest,
      allowedPaths: binding.allowedPaths,
      tools: binding.tools,
      maxTotalTokens: binding.maxTotalTokens,
    },
    rawText: '',
  });
}

function summarizeAntigravityForApproval(b: AntigravityBinding): string {
  const text = b.boundedInstruction.trim();
  return [
    'PAID REMOTE EXECUTION — Antigravity managed agent',
    `Agent: ${b.agent}`,
    `Task: ${b.taskId ?? '(no canonical task)'}`,
    `Allowed paths: ${b.allowedPaths.length ? b.allowedPaths.join(', ') : '(none declared)'}`,
    `Tools: ${b.tools.length ? b.tools.join(', ') : '(agent defaults)'}`,
    `Token cap: ${b.maxTotalTokens ?? '(provider default)'}`,
    `Instruction digest: sha256:${b.instructionDigest.slice(0, 16)}…`,
    `Instruction: ${text.length > 600 ? `${text.slice(0, 600)}… (${text.length} chars)` : text}`,
  ].join('\n');
}

async function executeAntigravityRuntime(input: ExecutionEnvelopeInput): Promise<ExecutionEnvelopeResult> {
  const capability = 'runtime.antigravity';

  // Defence in depth. dispatchEnvelope only reaches here after the human gate
  // consumed an approval; a caller cannot set this field (executeEnvelope
  // clears it). If it is absent something is wired wrong, and a paid remote
  // call is the wrong way to find out.
  if (!input.__consumedApprovalId) {
    return { outcome: 'BLOCKED', capability, reason: 'runtime.antigravity requires a consumed human approval; none was carried to the executor.' };
  }

  const binding = resolveAntigravityBinding(input);
  const correlationId = approvalCorrelationId(input);

  try {
    const { execution, created } = await submitExternalExecution({
      workspaceId: input.workspaceId,
      createdByUserId: input.actorUserId,
      runtime: 'antigravity',
      agent: binding.agent,
      input: {
        instruction: binding.boundedInstruction,
        ...(binding.tools.length ? { tools: binding.tools.map((type) => ({ type })) } : {}),
        ...(binding.maxTotalTokens !== null ? { maxTotalTokens: binding.maxTotalTokens } : {}),
      },
      taskId: binding.taskId ?? undefined,
      // The ledger's own idempotency: a replay of this correlation returns the
      // existing row and never submits a second remote interaction.
      idempotencyKey: correlationId,
    });

    const externalExecution = {
      id: execution.id,
      runtime: execution.runtime,
      status: execution.status,
      remoteJobId: execution.remote_job_id,
      created,
    };

    if (execution.status === 'FAILED') {
      return {
        outcome: 'FAILED',
        capability,
        reason: `Antigravity submission failed: ${execution.error_message_safe || 'no reason reported'}.`,
        taskId: binding.taskId ?? undefined,
        externalExecution,
        toolsInvoked: ['runtime.antigravity'],
      };
    }

    return {
      outcome: 'SUBMITTED',
      capability,
      reason: created
        ? `Submitted to Antigravity (remote job ${execution.remote_job_id}). The scheduler sweep advances it; artifact, Aegis and receipt follow on completion.`
        : `Already submitted under this correlation (execution ${execution.id}); not submitted again.`,
      taskId: binding.taskId ?? undefined,
      externalExecution,
      toolsInvoked: created ? ['runtime.antigravity'] : [],
    };
  } catch (err: any) {
    const code = String(err?.code || '');
    const reason = scrubSecrets(String(err?.message || 'Antigravity submission failed.'), 300);
    if (code === 'GUARDIAN_BLOCKED') return { outcome: 'BLOCKED', capability, reason, toolsInvoked: [] };
    if (code === 'RUNTIME_NOT_CONFIGURED') return { outcome: 'NOT_CONFIGURED', capability, reason, toolsInvoked: [] };
    return { outcome: 'FAILED', capability, reason, toolsInvoked: [] };
  }
}
