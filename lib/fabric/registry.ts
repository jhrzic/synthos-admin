// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 5: the canonical capability registry.
//
// PLATFORM-LEVEL INFRASTRUCTURE. This file has no concept of Jarvis, chat,
// or any single caller — it answers "what capabilities exist, and are they
// actually usable right now" for anything that asks: Jarvis (wired in Step
// 6), graph execution, the scheduler (when one exists), admin workflows, or
// an external API caller. Nothing here imports from src/ or knows what a
// "conversation" is.
//
// Every status below is derived from real evidence — reused from
// lib/runtime-status.ts (the existing, already-live-probing health
// aggregator behind /api/ready and the Master Admin Runtime tab) wherever
// that evidence already exists, plus a small number of additional
// structural checks (Guardian policy, NODE_ENV, presence of scheduler/
// browser/research code) for capabilities runtime-status.ts doesn't cover.
// This file does not run a second, competing health probe against Windmill
// or Hermes — it reads the same RuntimeStatusReport runtime-status.ts
// already produces.
//
// NEVER hardcode AVAILABLE. A capability is AVAILABLE only when the
// underlying config/runtime evidence says so; everything else is reported
// honestly as DEGRADED / NOT_CONFIGURED / UNSUPPORTED / APPROVAL_REQUIRED.
// ---------------------------------------------------------------------------

import { getRuntimeStatus, type RuntimeStatusReport, type RuntimeSystemReport } from '../runtime-status';
import { getDatabase } from '../persistence';
import { isWindmillConfigured } from '../windmill-client';
import { getVoiceCredentialStatus } from '../voice-credentials';
import { getModelCredentialStatus } from '../model-credentials';
import { isAntigravityConfigured, isAntigravityEnabled } from '../antigravity-client';
import { resolveProviderState } from '../provider-state';
import { TOOL_PACK_1, resolveToolReadiness, toCapabilityEffectClass, type ToolDefinition } from './tool-pack';

/**
 * TOOL PACK 1 added 'INTERNAL_MUTATION'.
 *
 * Before it, there was no way to say "this changes SynthOS's own state and
 * reaches nothing outside it". The consequence was visible: vault.write —
 * writing a file into SynthOS's own vault — was classed EXTERNAL_ACTION, and
 * lib/fabric/envelope.ts then needed a named exemption set
 * (EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE) purely to let that plainly
 * internal write through. The exemption existed to work around a wrong
 * classification, and every new internal-mutating tool would have had to be
 * added to it — each one recorded, misleadingly, as an external action
 * somebody decided to allow.
 *
 * INTERNAL_MUTATION is NOT a weaker class. The envelope requires real Guardian
 * enforcement for it exactly as for EXTERNAL_ACTION. It is a more precise
 * classification, not a cheaper one.
 */
export type CapabilityEffectClass = 'READ' | 'COMPUTE' | 'INTERNAL_MUTATION' | 'EXTERNAL_ACTION' | 'CONTROL';

export type CapabilityStatus =
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED'
  | 'APPROVAL_REQUIRED';

export type CapabilityRiskTier = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Deliberately distinct from workspaceScope (who may call it) — this is
 * about whether a human-approval mechanism gates the action itself.
 * GUARDIAN_ENFORCED means real, wired code enforces it today (checkGuardianRules
 * or equivalent). RECOMMENDED_NOT_ENFORCED is used honestly where the
 * side-effect class implies approval SHOULD gate it but no real enforcement
 * exists in this repo yet — never silently upgraded to GUARDIAN_ENFORCED.
 */
export type CapabilityApprovalPolicy = 'NONE' | 'GUARDIAN_ENFORCED' | 'RECOMMENDED_NOT_ENFORCED';

export type CapabilityWorkspaceScope = 'none' | 'authenticated' | 'member' | 'admin' | 'platform_admin';

export interface CapabilityDescriptor {
  key: string;
  runtime: string;
  status: CapabilityStatus;
  effectClass: CapabilityEffectClass;
  riskTier: CapabilityRiskTier;
  approvalPolicy: CapabilityApprovalPolicy;
  workspaceScope: CapabilityWorkspaceScope;
  /** Real file::function this capability actually dispatches through today — never a planned/future path. */
  reference: string;
  /** Concise, evidence-based explanation of the status above. */
  reason: string;
}

function findSystem(report: RuntimeStatusReport, system: string): RuntimeSystemReport | undefined {
  return report.systems.find((s) => s.system === system);
}

function databaseReachable(): boolean {
  try {
    getDatabase();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Individual capability resolvers. Each is a pure function of real evidence
// (a RuntimeStatusReport already fetched once by listCapabilities()/
// resolveCapability(), or a direct, cheap structural check) — never a
// literal, never a guess from a UI label.
// ---------------------------------------------------------------------------

function modelGeminiCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const gemini = findSystem(report, 'Gemini Provider');
  const configured = !!gemini && gemini.status !== 'NOT_CONFIGURED';
  return {
    key: 'model.gemini',
    runtime: 'gemini',
    status: configured ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'COMPUTE',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/fabric/model-gemini.ts::generateViaGemini',
    reason: configured
      ? 'GEMINI_API_KEY is configured (see lib/runtime-status.ts geminiStatus() — real per-call health is proven at call time, not re-probed here).'
      : (gemini?.detail || 'GEMINI_API_KEY is not configured.'),
  };
}

/**
 * PUSH 1 — OpenAI as a real, executable capability.
 *
 * Status comes from getModelCredentialStatus('openai'), which is the exact
 * resolution lib/fabric/kernel.ts performs at execution time (environment
 * first, then the encrypted server-side row). Reading process.env directly
 * here — as the Gemini row above still does via runtime-status.ts — would
 * report NOT_CONFIGURED for a deployment whose key lives in the credential
 * store and which can in fact execute. A capability registry that
 * disagrees with the executor about what is configured is worse than no
 * registry.
 *
 * AVAILABLE here means "a credential resolves", never "the provider is up".
 * Real per-call health is proven at call time, exactly as for Gemini.
 */
function modelOpenAiCapability(): CapabilityDescriptor {
  const credential = getModelCredentialStatus('openai');

  // PROVIDER STATUS TRUTH — this used to be
  //     status: credential.apiKeyPresent ? 'AVAILABLE' : 'NOT_CONFIGURED'
  // which read AVAILABLE while every real call returned
  // `HTTP 429: You have no credits remaining`. A resolved key is a fact about
  // configuration; AVAILABLE is a claim about capability. Collapsing the two
  // made the Admin confidently wrong in the direction that costs most — an
  // operator planning work against a provider that cannot run it.
  //
  // The state now comes from lib/provider-state.ts, which reads the last REAL
  // call from the PROVIDER_CALL ledger. AVAILABLE is reported only for
  // LIVE_VERIFIED; a credential with no proven call is DEGRADED, and the
  // reason says why rather than making the operator infer it.
  const providerState = resolveProviderState({
    provider: 'openai',
    implemented: true,
    configured: credential.apiKeyPresent,
  });
  const capabilityStatus: CapabilityStatus =
    providerState.state === 'LIVE_VERIFIED' ? 'AVAILABLE'
    : providerState.state === 'NO_CREDENTIAL' ? 'NOT_CONFIGURED'
    // QUOTA_BLOCKED / PROVIDER_ERROR / CREDENTIAL_PRESENT are all "wired but
    // unproven or currently refused" — DEGRADED, never AVAILABLE.
    : 'DEGRADED';

  return {
    key: 'model.openai',
    runtime: 'openai',
    status: capabilityStatus,
    effectClass: 'COMPUTE',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/fabric/model-openai.ts::generateViaOpenAI',
    reason: `${providerState.state}: ${providerState.reason}`,
  };
}

/**
 * PUSH 1 — Antigravity as a real execution runtime.
 *
 * effectClass is EXTERNAL_ACTION, not COMPUTE, and that classification is
 * the honest one: unlike a model call, this dispatches work to a remote
 * autonomous agent that executes code and browses the web in a sandbox
 * SynthOS does not control. Treating it as ordinary compute would let it
 * past lib/fabric/envelope.ts Section 7, which is precisely the check that
 * should apply to it.
 *
 * approvalPolicy is GUARDIAN_ENFORCED because real, wired code enforces it:
 * lib/external-executions.ts runs every instruction through
 * checkGuardianRules() before dispatch, and refuses BLOCKED and
 * APPROVAL_REQUIRED outright. That is a submission gate, and the reason
 * string says so rather than implying SynthOS supervises the remote loop.
 */
function antigravityRuntimeCapability(): CapabilityDescriptor {
  const configured = isAntigravityConfigured();
  const enabled = isAntigravityEnabled();
  const status: CapabilityStatus = !configured ? 'NOT_CONFIGURED' : !enabled ? 'NOT_CONFIGURED' : 'AVAILABLE';
  return {
    key: 'runtime.antigravity',
    runtime: 'antigravity',
    status,
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'HIGH',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    workspaceScope: 'admin',
    reference: 'lib/external-executions.ts::submitExternalExecution (runtime: antigravity) -> lib/antigravity-client.ts::submitInteraction',
    reason: !configured
      ? 'No Antigravity credential resolves (neither ANTIGRAVITY_API_KEY nor a Gemini credential).'
      : !enabled
        ? 'A credential resolves, but ANTIGRAVITY_ENABLED is not "true" — outward execution is switched off in this deployment.'
        : 'A credential resolves and ANTIGRAVITY_ENABLED is "true". Every instruction is evaluated by the real checkGuardianRules() gate before dispatch; BLOCKED and APPROVAL_REQUIRED are refused. Results are never trusted: they pass Aegis and the KIL gate before any receipt exists.',
  };
}

function vaultReadCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const vault = findSystem(report, 'Vault');
  const healthy = vault?.status === 'HEALTHY';
  return {
    key: 'vault.read',
    runtime: 'vault',
    status: healthy ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/vault.ts::listWorkspaceVaultEntries / getWorkspaceVaultEntry',
    reason: healthy ? (vault?.detail || 'Vault directory exists.') : (vault?.detail || 'Vault directory does not exist.'),
  };
}

function vaultWriteCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const vault = findSystem(report, 'Vault');
  const healthy = vault?.status === 'HEALTHY';
  return {
    key: 'vault.write',
    runtime: 'vault',
    status: healthy ? 'AVAILABLE' : 'NOT_CONFIGURED',
    // Per Step 5 canonical policy: Vault.write is EXTERNAL_ACTION — it
    // durably writes a file and a DB record outside the caller's own
    // transient context, unlike a read.
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'LOW',
    // Honest: no real approval-queue mechanism gates writeWorkspaceArtifact()
    // today (confirmed by reading lib/vault.ts and every real caller —
    // kernel.ts, external-executions.ts, POST /api/vault/notes). Recording
    // this as GUARDIAN_ENFORCED would be a fabrication.
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/vault.ts::writeWorkspaceArtifact',
    reason: healthy
      ? 'Vault directory exists and the canonical writer (writeWorkspaceArtifact) is reachable; no approval gate currently wraps it.'
      : (vault?.detail || 'Vault directory does not exist.'),
  };
}

function memorySearchCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const mem = findSystem(report, 'Memory Index (FTS5)');
  const healthy = mem?.status === 'HEALTHY';
  return {
    key: 'memory.search',
    runtime: 'memory-index',
    status: healthy ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/memory-index.ts::searchWorkspaceMemory',
    reason: healthy ? (mem?.detail || 'FTS5 memory_index table is reachable.') : (mem?.detail || 'memory_index table is not reachable.'),
  };
}

function taskReadCapability(): CapabilityDescriptor {
  const reachable = databaseReachable();
  return {
    key: 'task.read',
    runtime: 'persistence',
    status: reachable ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/persistence.ts::listWorkspaceTasks / getTaskWithHistory',
    reason: reachable ? 'SQLite database is reachable.' : 'SQLite database is not reachable.',
  };
}

function graphReadCapability(): CapabilityDescriptor {
  const reachable = databaseReachable();
  return {
    key: 'graph.read',
    runtime: 'persistence',
    status: reachable ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/persistence.ts::listGraphs / listGraphRuns',
    reason: reachable ? 'SQLite database is reachable.' : 'SQLite database is not reachable.',
  };
}

function receiptReadCapability(): CapabilityDescriptor {
  const reachable = databaseReachable();
  return {
    key: 'receipt.read',
    runtime: 'persistence',
    status: reachable ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/persistence.ts::getTaskReceipts / listWorkspaceReceipts',
    reason: reachable ? 'SQLite database is reachable.' : 'SQLite database is not reachable.',
  };
}

function graphExecuteCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  // Real orchestration/control-flow, live-verified (Step 4): node
  // sequencing, halt-on-failure, PARTIAL/FAILED distinction. Its own
  // dispatch is always reachable; whether a SPECIFIC node can run depends
  // on model.gemini / windmill.job, which the caller checks separately.
  const dbOk = databaseReachable();
  return {
    key: 'graph.execute',
    runtime: 'graph',
    status: dbOk ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'CONTROL',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'server.ts::POST /api/graphs/execute',
    reason: dbOk
      ? 'Real, live-verified orchestration path (Step 4). Requires explicit confirmed:true; per-node capability (model.gemini / windmill.job) is checked independently at dispatch.'
      : 'SQLite database is not reachable.',
  };
}

function skillExecuteCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const dbOk = databaseReachable();
  return {
    key: 'skill.execute',
    runtime: 'skill',
    status: dbOk ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'CONTROL',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'admin',
    reference: 'lib/skill-execution.ts::executeSkill',
    reason: dbOk
      ? 'Real dispatcher across 5 target types (deterministic/model/mcp_tool/windmill/hermes_runtime); a specific skill\'s own executability is checked separately (classifySkillExecutability).'
      : 'SQLite database is not reachable.',
  };
}

function windmillJobCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const windmill = findSystem(report, 'Windmill (External Execution Control Plane)');
  let status: CapabilityStatus = 'NOT_CONFIGURED';
  if (windmill?.status === 'HEALTHY') status = 'AVAILABLE';
  else if (windmill?.status === 'FAILED') status = 'DEGRADED';
  return {
    key: 'windmill.job',
    runtime: 'windmill',
    status,
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'MEDIUM',
    // Real gate is auth-role (requireWorkspaceAdmin), captured in
    // workspaceScope below — no Guardian/human-approval queue currently
    // wraps submission; recording GUARDIAN_ENFORCED would be false.
    approvalPolicy: 'NONE',
    workspaceScope: 'admin',
    reference: 'lib/external-executions.ts::submitExternalExecution',
    reason: windmill?.detail || 'Windmill status unknown.',
  };
}

// STEP 6 — distinct from windmill.job: a status/health check or a listing
// of already-recorded external-execution rows is a real READ, never an
// external write. Jarvis's existing (pre-Step-6) Windmill status/list
// query is wired onto this, not windmill.job.
function windmillReadCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const windmill = findSystem(report, 'Windmill (External Execution Control Plane)');
  const status: CapabilityStatus =
    windmill?.status === 'HEALTHY' ? 'AVAILABLE' :
    windmill?.status === 'FAILED' ? 'DEGRADED' :
    'NOT_CONFIGURED';
  return {
    key: 'windmill.read',
    runtime: 'windmill',
    status,
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/windmill-client.ts::health / lib/external-executions.ts::listWorkspaceExternalExecutions',
    reason: windmill?.detail || 'Windmill status unknown.',
  };
}

function terminalExecCapability(): CapabilityDescriptor {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    key: 'terminal.exec',
    runtime: 'terminal',
    // In production the whole /api/terminal/* surface is structurally
    // unreachable (server.ts's NODE_ENV gate) — that is a real, permanent
    // "this capability does not exist here" fact, not a config gap, hence
    // UNSUPPORTED rather than NOT_CONFIGURED. Outside production it is real
    // and reachable, but every real invocation is gated by checkGuardianRules
    // — reported as the registry's own APPROVAL_REQUIRED status so a caller
    // never treats it as a bare AVAILABLE action.
    status: isProduction ? 'UNSUPPORTED' : 'APPROVAL_REQUIRED',
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'CRITICAL',
    approvalPolicy: isProduction ? 'NONE' : 'GUARDIAN_ENFORCED',
    workspaceScope: 'platform_admin',
    reference: 'server.ts::POST /api/terminal/exec (lib/kil-gate.ts::checkGuardianRules)',
    reason: isProduction
      ? 'Structurally disabled in production (NODE_ENV gate) regardless of role — see B3 in server.ts.'
      : 'Reachable for platform admins; every real command is evaluated by the real checkGuardianRules() gate (SAFE / APPROVAL_REQUIRED / BLOCKED per command).',
  };
}

function hermesExecuteCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  // SUPERSEDES the prior UNSUPPORTED verdict, and the reason it changed is
  // worth stating: the old audit was about the wrong Hermes. It judged
  // src/services/hermesAdapter.ts, which speaks a SynthOS-specific REST
  // contract (GET /synthos/health) that nothing on this machine implements —
  // so as a verdict on THAT adapter it was correct and still is.
  //
  // The Hermes actually installed here is a CLI. `hermes -z "<prompt>"` is a
  // real, bounded, one-shot task interface, and lib/hermes-local-runtime.ts
  // now dispatches through it. Execution is therefore real, and this
  // capability says so — but only when the CLI genuinely answers AND the
  // operator has switched dispatch on.
  //
  // approvalPolicy is GUARDIAN_ENFORCED because real, wired code enforces it:
  // envelope.ts's executeHermesTask runs guardianCheckInstruction() on the
  // instruction before any subprocess is spawned. Same standard as
  // runtime.antigravity — never a label without the gate behind it.
  const local = findSystem(report, 'Hermes Local Runtime (CLI)');
  const configured = !!local && local.status !== 'NOT_CONFIGURED';
  const available = !!local && local.status === 'HEALTHY';

  if (!configured) {
    return {
      key: 'hermes.execute',
      runtime: 'hermes',
      status: 'NOT_CONFIGURED',
      effectClass: 'EXTERNAL_ACTION',
      riskTier: 'MEDIUM',
      approvalPolicy: 'GUARDIAN_ENFORCED',
      workspaceScope: 'admin',
      reference: 'lib/fabric/envelope.ts::executeHermesTask -> lib/hermes-local-runtime.ts::runHermesLocalTask',
      reason: local?.detail || 'No executable Hermes CLI was found.',
    };
  }

  return {
    key: 'hermes.execute',
    runtime: 'hermes',
    // DISABLED (reachable, dispatch switched off) is reported as
    // NOT_CONFIGURED rather than AVAILABLE: a run spends real subscription
    // quota, so "the binary answers" is not authorization.
    status: available ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'MEDIUM',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    workspaceScope: 'admin',
    reference: 'lib/fabric/envelope.ts::executeHermesTask -> lib/hermes-local-runtime.ts::runHermesLocalTask',
    reason: available
      ? `Local Hermes CLI answers and dispatch is enabled. Every instruction passes checkGuardianRules() before a subprocess starts; the result goes through the canonical task -> artifact -> Aegis -> receipt -> memory-index spine. ${local?.detail || ''}`.trim()
      : (local?.detail || 'The Hermes CLI is reachable but dispatch is switched off.'),
  };
}

function scheduleCapability(): CapabilityDescriptor {
  // STEP 7 — real in-process scheduler now exists (lib/fabric/scheduler.ts:
  // a real setInterval poll loop, persisted schedules/schedule_occurrences,
  // every occurrence dispatched through this same envelope). Superseded
  // the prior NOT_CONFIGURED audit finding: the CLAUDE.md-described
  // upstream dispatcher still doesn't exist here, but this deployment now
  // has its own, real, minimal one.
  return {
    key: 'schedule',
    runtime: 'scheduler',
    status: 'AVAILABLE',
    effectClass: 'CONTROL',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/fabric/scheduler.ts',
    reason: 'Real in-process scheduler: persisted schedules, a real poll loop, every due occurrence dispatched through executeEnvelope() — the same canonical path Jarvis/graphs/actions use.',
  };
}

function browserCapability(): CapabilityDescriptor {
  return {
    key: 'browser',
    runtime: 'browser',
    status: 'NOT_CONFIGURED',
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'none',
    reference: 'none',
    reason: 'No browser/puppeteer/playwright capability exists in this repository.',
  };
}

// STEP 6 corrective pass (Part A) — a real live-research capability exists
// (lib/fabric/research.ts): live discovery via the real, public GitHub
// Search REST API (GITHUB_TOKEN is optional and only raises rate limits —
// never required), then a real Gemini call that synthesizes ONLY the
// already-retrieved GitHub facts (evidence-constrained prompt, no free
// invention). Google Search grounding was REMOVED in this corrective pass
// (it hit a real account quota during live acceptance) — there is no
// config.tools:[{googleSearch:{}}] call anywhere in this path anymore.
// GEMINI_API_KEY is still required because the synthesis step is a real
// Gemini call, not because grounding is.
function researchCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const gemini = findSystem(report, 'Gemini Provider');
  const configured = !!gemini && gemini.status !== 'NOT_CONFIGURED';
  return {
    key: 'research',
    runtime: 'research',
    status: configured ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'READ',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/fabric/research.ts::runLiveRepositoryResearch',
    reason: configured
      ? 'Live GitHub Search discovery + a Gemini synthesis call constrained to those real, retrieved facts — real, evidenced sources, never model-memory-only, never Google Search grounding.'
      : 'GEMINI_API_KEY is not configured — the synthesis step requires a real Gemini call.',
  };
}

/** MCP itself is a transport, not a capability with one status — see mcpConnectivityCapability + classifyMcpOperation below. */
/**
 * AEO/GEO/SEO audit. Always AVAILABLE because it needs no credential: every
 * observation comes from a live HTTP crawl of a public site (lib/aeo/crawler).
 * The AI-visibility (GEO) dimension inside it degrades to UNKNOWN on its own
 * when no search/AI provider is configured — the capability itself still runs
 * and still produces evidence, which is why it is not gated NOT_CONFIGURED.
 *
 * READ effect class: it fetches public pages and writes only into the caller's
 * own workspace Vault through the canonical artifact path.
 */
function aeoAuditCapability(): CapabilityDescriptor {
  return {
    key: 'aeo.audit',
    runtime: 'aeo',
    status: 'AVAILABLE',
    effectClass: 'READ',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/aeo/crawler.ts::crawlSite + lib/aeo/analyzer.ts::analyze',
    reason: 'Deterministic live HTTP crawl of a public domain; no external credential required. AI-visibility findings are only emitted when a provider was genuinely queried.',
  };
}

/**
 * Graph-composition capabilities.
 *
 * These are real, executable capabilities with real executors in the graph
 * runtime — they turn a completed audit into prioritised opportunities, into
 * SynthOS tasks, and into a recurring recheck. They were previously wired into
 * the execute loop without being registered, which made them invisible to the
 * Graph Builder's capability picker and absent from the registry that is meant
 * to be the honest inventory of what the system can do.
 *
 * Each is READ/LOW except create_mission and schedule_recheck, which write
 * into the caller's own workspace through the canonical task/scheduler paths.
 */
function opportunityReviewCapability(): CapabilityDescriptor {
  return {
    key: 'opportunity.review', runtime: 'aeo', status: 'AVAILABLE',
    effectClass: 'READ', riskTier: 'LOW', approvalPolicy: 'NONE', workspaceScope: 'member',
    reference: 'server.ts::/api/graphs/execute capability node "opportunity.review"',
    reason: 'Prioritises opportunities from a completed upstream audit. Deterministic; preserves UNKNOWN rather than scoring it.',
  };
}

function createMissionCapability(): CapabilityDescriptor {
  return {
    key: 'create_mission', runtime: 'aeo', status: 'AVAILABLE',
    effectClass: 'READ', riskTier: 'LOW', approvalPolicy: 'NONE', workspaceScope: 'member',
    reference: 'lib/aeo/service.ts::createAuditMissionTasks',
    reason: 'Creates real SynthOS tasks in the caller\'s own workspace from prioritised audit findings.',
  };
}

function scheduleRecheckCapability(): CapabilityDescriptor {
  return {
    key: 'schedule_recheck', runtime: 'aeo', status: 'AVAILABLE',
    effectClass: 'READ', riskTier: 'LOW', approvalPolicy: 'NONE', workspaceScope: 'member',
    reference: 'lib/fabric/scheduler.ts::createValidatedSchedule (capability aeo.audit)',
    reason: 'Creates a recurring re-audit through the canonical SynthOS scheduler. No second scheduler.',
  };
}

// ---------------------------------------------------------------------------
// CONVERSATION AI — the platform capability behind the Business Conversation
// AI product.
//
// Deliberately NOT named after any runtime. Hermes, a hosted model, or a local
// model can each satisfy conversation.respond; none of them IS the capability.
// Naming it after a vendor would bake a swappable implementation detail into
// the contract every caller depends on.
//
// The honest status story, which is the whole point of this registry:
//   conversation.respond is AVAILABLE but DEGRADED-in-substance — it answers
//   from the workspace's own indexed material by extraction, with no model
//   configured. It is reported DEGRADED rather than AVAILABLE so nobody reads
//   the registry and concludes generative phrasing is live.
// ---------------------------------------------------------------------------

/**
 * PRESENT/MISSING only — a credential value is never read out of here.
 *
 * Checks the same resolution the conversation engine uses (environment, then
 * the encrypted server-side store), so the registry cannot report a provider
 * the engine would refuse, or vice versa.
 */
export function conversationModelConfigured(): boolean {
  return getModelCredentialStatus('gemini').apiKeyPresent;
}

function conversationRespondCapability(): CapabilityDescriptor {
  const modelled = conversationModelConfigured();
  return {
    key: 'conversation.respond',
    runtime: 'conversation',
    status: modelled ? 'AVAILABLE' : 'DEGRADED',
    effectClass: 'READ',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/conversation/engine.ts::answerQuestion',
    reason: modelled
      ? 'An approved model is configured; replies are phrased by the model over retrieved workspace-authorised context only.'
      : 'No approved model is configured, so replies are GROUNDED_EXTRACTIVE — real passages from the workspace\'s own indexed material — or an explicit NO_KNOWLEDGE refusal. It never generates an unsourced business fact.',
  };
}

function conversationQualifyCapability(): CapabilityDescriptor {
  return {
    key: 'conversation.qualify',
    runtime: 'conversation',
    status: 'AVAILABLE',
    effectClass: 'READ',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/conversation/service.ts::nextQualificationQuestion',
    reason: 'Deterministic slot-filling against the business\'s own declared qualification goals. Records only what the customer actually stated; produces no inferred score or grade about a real person.',
  };
}

function conversationHandoffCapability(): CapabilityDescriptor {
  return {
    key: 'conversation.handoff',
    runtime: 'conversation',
    status: 'AVAILABLE',
    // It creates real work for a real person in the caller's own workspace.
    effectClass: 'READ',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/conversation/service.ts::createConversationTask',
    reason: 'Creates a real task assigned to a human. It does not contact anyone — no outbound message is sent by this capability under any configuration.',
  };
}

function conversationSummarizeCapability(): CapabilityDescriptor {
  return {
    key: 'conversation.summarize',
    runtime: 'conversation',
    status: 'AVAILABLE',
    effectClass: 'READ',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/conversation/service.ts::summarizeConversation',
    reason: 'Deterministic summary written to the workspace Vault on the canonical spine and signed. No model paraphrase, so it cannot report an outcome the conversation did not have.',
  };
}

/**
 * Booking is the capability this product does NOT have, and saying so in the
 * registry is load-bearing: it is what stops a future caller assuming a
 * scheduling path exists because "the assistant handles appointments".
 */
function conversationBookingCapability(): CapabilityDescriptor {
  return {
    key: 'conversation.booking',
    runtime: 'conversation',
    status: 'NOT_CONFIGURED',
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'MEDIUM',
    approvalPolicy: 'RECOMMENDED_NOT_ENFORCED',
    workspaceScope: 'member',
    reference: 'NOT_IMPLEMENTED',
    reason: 'No calendar or scheduling provider is connected. Scheduling requests produce a FOLLOW_UP_REQUEST task for a human; the product never reports an appointment as booked.',
  };
}

/**
 * Telephony and SMS require an MVNO/carrier line that does not exist on this
 * install. Registered as NOT_CONFIGURED rather than omitted, so the gap is a
 * stated fact instead of a silence.
 */
function conversationTelephonyCapability(): CapabilityDescriptor {
  return {
    key: 'conversation.telephony',
    runtime: 'conversation',
    status: 'NOT_CONFIGURED',
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'HIGH',
    approvalPolicy: 'RECOMMENDED_NOT_ENFORCED',
    workspaceScope: 'member',
    reference: 'docs/products/business-conversation-ai/CAPABILITY-MAP.md',
    reason: 'No voice/SMS carrier line is provisioned. The channel contract is defined; no number, no trunk and no message provider are connected, so no call or SMS can be placed or received.',
  };
}

/**
 * Voice input. Browser-native speech recognition, so it is genuinely available
 * without any credential — and genuinely absent in browsers that lack it.
 * Reported AVAILABLE because the server-side contract holds everywhere; the
 * per-visitor capability check happens in the page and is surfaced there.
 *
 * No audio reaches this server: recognition happens in the visitor's browser
 * and only the resulting text is submitted.
 */
function conversationVoiceInputCapability(): CapabilityDescriptor {
  return {
    key: 'conversation.voice_input',
    runtime: 'browser',
    status: 'AVAILABLE',
    effectClass: 'READ',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'none',
    reference: 'lib/conversation/public-page.ts (Web Speech API) + src/hooks/useSpeechRecognition.ts',
    reason: 'Speech recognition runs in the visitor\'s own browser; no audio is uploaded, recorded or stored by this server. Unsupported browsers show voice input as unavailable rather than degrading silently.',
  };
}

/**
 * Voice output. Reuses the one working Fish Audio path — there is no second
 * TTS integration, and the public route synthesizes a STORED assistant message
 * by id rather than caller-supplied text, so it cannot be used as a free
 * text-to-speech API funded by the business's credit.
 */
function conversationVoiceOutputCapability(): CapabilityDescriptor {
  // PRESENT/MISSING only — the credential value is never read out here.
  const configured = Boolean(
    (process.env.FISH_AUDIO_API_KEY || '').trim() || getVoiceCredentialStatus('fish_audio').apiKeyPresent
  );
  return {
    key: 'conversation.voice_output',
    runtime: 'fish_audio',
    status: configured ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'COMPUTE',
    riskTier: 'LOW',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/voice-credentials.ts::synthesizeFishAudio',
    reason: configured
      ? 'A Fish Audio credential is present. Spoken replies are generated from the reply the assistant already sent; a synthesis failure never invalidates the written answer.'
      : 'No Fish Audio credential is configured, so spoken replies are unavailable. Text conversation is unaffected.',
  };
}

/**
 * Embedding on a customer's own website.
 *
 * AVAILABLE as a mechanism; whether any given business is actually embeddable
 * depends on its own authorized-origins list, which is per-workspace data and
 * not a platform capability. An empty list means the standalone page works and
 * nobody may frame it.
 */
function conversationEmbedCapability(): CapabilityDescriptor {
  return {
    key: 'conversation.embed',
    runtime: 'conversation',
    status: 'AVAILABLE',
    effectClass: 'READ',
    riskTier: 'MEDIUM',
    approvalPolicy: 'NONE',
    workspaceScope: 'member',
    reference: 'lib/conversation/origins.ts::assistantPageCsp',
    reason: 'Third-party embedding is permitted only for origins the business itself authorized, enforced by a per-route frame-ancestors policy. The app-wide frame-ancestors \'none\' is unchanged everywhere else.',
  };
}

function mcpConnectivityCapability(report: RuntimeStatusReport): CapabilityDescriptor {
  const mcp = findSystem(report, 'MCP Connectivity');
  const status: CapabilityStatus =
    mcp?.status === 'HEALTHY' ? 'AVAILABLE' :
    mcp?.status === 'FAILED' ? 'DEGRADED' :
    'NOT_CONFIGURED';
  return {
    key: 'mcp.tool',
    runtime: 'mcp',
    status,
    // Deliberately generic — the real per-operation effect class is
    // resolved by classifyMcpOperation() below, never assumed from the
    // transport alone (canonical MCP policy, Step 5).
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'admin',
    reference: 'lib/mcp-client.ts::probeMcpServer / lib/skill-execution.ts::runMcpToolAction',
    reason: `${mcp?.detail || 'No MCP probe has been run yet.'} MCP transport connectivity only — see classifyMcpOperation() for the real per-operation risk/effect class.`,
  };
}

async function buildAllCapabilities(report: RuntimeStatusReport): Promise<CapabilityDescriptor[]> {
  return [
    modelGeminiCapability(report),
    vaultReadCapability(report),
    vaultWriteCapability(report),
    memorySearchCapability(report),
    taskReadCapability(),
    graphReadCapability(),
    receiptReadCapability(),
    graphExecuteCapability(report),
    modelOpenAiCapability(),
    antigravityRuntimeCapability(),
    skillExecuteCapability(report),
    windmillJobCapability(report),
    windmillReadCapability(report),
    terminalExecCapability(),
    hermesExecuteCapability(report),
    scheduleCapability(),
    browserCapability(),
    researchCapability(report),
    aeoAuditCapability(),
    opportunityReviewCapability(),
    createMissionCapability(),
    scheduleRecheckCapability(),
    conversationRespondCapability(),
    conversationQualifyCapability(),
    conversationHandoffCapability(),
    conversationSummarizeCapability(),
    conversationBookingCapability(),
    conversationTelephonyCapability(),
    conversationVoiceInputCapability(),
    conversationVoiceOutputCapability(),
    conversationEmbedCapability(),
    mcpConnectivityCapability(report),
    // TOOL PACK 1 — derived rows, one manifest (lib/fabric/tool-pack.ts).
    ...toolPackCapabilities(),
    // APPROVAL FOUNDATION — synthetic external action for lifecycle proof only.
    approvalVerificationCapability(),
  ];
}


// ---------------------------------------------------------------------------
// TOOL PACK 1 — capability rows, DERIVED from the one manifest.
//
// Each row's status comes from resolveToolReadiness(), which reads real
// evidence (is the vault reachable, is the repo allowlist populated, …). None
// of it is hardcoded, and the Admin surface renders exactly these rows rather
// than keeping a parallel notion of tool status — the instruction's "do not
// hardcode UI status separately from registry truth", enforced by there being
// only one source to read.
//
// The status mapping is deliberately narrow:
//   configured && enabled        -> AVAILABLE
//   !configured                  -> NOT_CONFIGURED
//   configured && !enabled       -> UNSUPPORTED (switched off in code)
//
// AVAILABLE here means "preconditions are met and the executor will really
// run", which for a local filesystem or vault read is a complete statement.
// It is NOT the provider-style claim that a remote service is up — the GitHub
// and research tools depend on a third party, and their real per-call health
// is proven at call time and recorded in the attempt ledger, exactly as the
// model providers are. lib/provider-state.ts stays the authority for
// "did a real call to an outside service succeed"; this is the authority for
// "may this tool be dispatched at all".
// ---------------------------------------------------------------------------

function toolCapability(tool: ToolDefinition): CapabilityDescriptor {
  const readiness = resolveToolReadiness(tool.capability);
  const status: CapabilityStatus = !readiness.configured
    ? 'NOT_CONFIGURED'
    : readiness.enabled ? 'AVAILABLE' : 'UNSUPPORTED';

  return {
    key: tool.capability,
    runtime: tool.runtime,
    status,
    effectClass: toCapabilityEffectClass(tool.effectClass),
    riskTier: tool.riskTier,
    approvalPolicy: tool.approvalPolicy,
    workspaceScope: tool.workspaceScope,
    reference: tool.reference,
    reason: readiness.reason,
  };
}

// ---------------------------------------------------------------------------
// APPROVAL FOUNDATION — a synthetic EXTERNAL_ACTION, for proving the lifecycle
// without sending anything.
//
// The approval gate has to be demonstrated end to end before Gmail exists, and
// demonstrating it with Gmail would mean sending a real email to prove that
// sending is gated. So this capability is a real registered EXTERNAL_ACTION
// that passes through the identical gate, and whose "external call" is a
// bounded local contract double that opens no socket.
//
// WHY THIS IS NOT A BACK DOOR:
//  - It is EXTERNAL_ACTION with GUARDIAN_ENFORCED, so it gets the full gate:
//    Guardian, then human approval, then single-use consumption.
//  - Its executor cannot reach the network. It writes one bounded file into the
//    workspace artifact path through the canonical writer and returns. There is
//    no URL, no recipient, no credential.
//  - It is only ever AVAILABLE when SYNTHOS_APPROVAL_VERIFICATION=true, so it
//    does not sit in a production registry offering itself to callers.
//
// It is named "verification." rather than given a plausible product name so
// nobody mistakes it for a shipped feature.
// ---------------------------------------------------------------------------
function approvalVerificationCapability(): CapabilityDescriptor {
  const enabled = process.env.SYNTHOS_APPROVAL_VERIFICATION === 'true';
  return {
    key: 'verification.external_action',
    runtime: 'contract-double',
    status: enabled ? 'AVAILABLE' : 'NOT_CONFIGURED',
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'LOW',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    workspaceScope: 'member',
    reference: 'lib/fabric/envelope.ts::executeApprovalVerification',
    reason: enabled
      ? 'Approval-workflow verification only. Passes the full EXTERNAL_ACTION gate (Guardian, then human approval, then single-use consumption) and executes a bounded LOCAL contract double \u2014 it opens no socket and contacts no provider.'
      : 'Approval-workflow verification capability, switched off. Set SYNTHOS_APPROVAL_VERIFICATION=true to enable it for a lifecycle proof; it performs no external action in any case.',
  };
}

/** The Tool Pack 1 rows. Exported so the /api/tools route and tests read the same list. */
export function toolPackCapabilities(): CapabilityDescriptor[] {
  return TOOL_PACK_1.map(toolCapability);
}

/** Real, evidence-based capability list — platform-level, no Jarvis/graph/scheduler-specific filtering. */
export async function listCapabilities(): Promise<CapabilityDescriptor[]> {
  const report = await getRuntimeStatus();
  return buildAllCapabilities(report);
}

/** Resolves one capability by key, or null if the key is not registered at all (never fabricates an entry). */
export async function resolveCapability(key: string): Promise<CapabilityDescriptor | null> {
  const capabilities = await listCapabilities();
  return capabilities.find((c) => c.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// CANONICAL POLICY — MCP is a transport/runtime mechanism, not a risk
// class. The same JSON-RPC "tools/call" wraps a read-only search and a
// destructive delete; only the operation's own name/verb tells you which.
// This classifier is the one place that decision is made — callers (skill
// execution today, Jarvis/graphs in later steps) must consult it rather
// than assuming a transport-level default.
// ---------------------------------------------------------------------------

export interface McpOperationClassification {
  operation: string;
  matched: boolean;
  effectClass: CapabilityEffectClass | null;
  riskTier: CapabilityRiskTier;
  approvalPolicy: CapabilityApprovalPolicy;
  reason: string;
}

const MCP_READ_VERBS = new Set(['search', 'list', 'get', 'read', 'fetch', 'query', 'describe', 'view', 'find', 'lookup', 'show']);
const MCP_COMPUTE_VERBS = new Set(['translate', 'summarize', 'summarise', 'generate', 'transform', 'embed', 'classify', 'analyze', 'analyse', 'compute', 'score']);
const MCP_EXTERNAL_ACTION_VERBS = new Set(['create', 'update', 'send', 'publish', 'delete', 'remove', 'write', 'upload', 'post', 'put', 'patch', 'execute', 'run', 'deploy', 'invite', 'share', 'notify', 'archive', 'merge', 'close']);

function tokenizeOperationName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/**
 * Classifies a named MCP operation by what it actually does, not by the
 * fact that it arrived over MCP. Checked EXTERNAL_ACTION first (fail
 * toward the more consequential class on ambiguity), then COMPUTE, then
 * READ. An operation matching none of the known verbs fails closed:
 * matched:false, effectClass:null, riskTier:HIGH — a caller must never
 * treat an unrecognized operation as automatically AVAILABLE/safe.
 */
export function classifyMcpOperation(operationName: string): McpOperationClassification {
  const raw = (operationName || '').trim();
  const tokens = tokenizeOperationName(raw);

  if (tokens.some((t) => MCP_EXTERNAL_ACTION_VERBS.has(t))) {
    return {
      operation: raw,
      matched: true,
      effectClass: 'EXTERNAL_ACTION',
      riskTier: 'HIGH',
      approvalPolicy: 'RECOMMENDED_NOT_ENFORCED',
      reason: `Operation name contains an external-write verb — classified EXTERNAL_ACTION regardless of MCP transport. No real Guardian enforcement currently wraps MCP tool calls (lib/skill-execution.ts runMcpToolAction) — approval is recommended by this policy, not enforced in code today.`,
    };
  }
  if (tokens.some((t) => MCP_COMPUTE_VERBS.has(t))) {
    return {
      operation: raw,
      matched: true,
      effectClass: 'COMPUTE',
      riskTier: 'LOW',
      approvalPolicy: 'NONE',
      reason: 'Operation name contains a transform/compute verb — classified COMPUTE.',
    };
  }
  if (tokens.some((t) => MCP_READ_VERBS.has(t))) {
    return {
      operation: raw,
      matched: true,
      effectClass: 'READ',
      riskTier: 'NONE',
      approvalPolicy: 'NONE',
      reason: 'Operation name contains a read/list/get verb — classified READ.',
    };
  }
  return {
    operation: raw,
    matched: false,
    effectClass: null,
    riskTier: 'HIGH',
    approvalPolicy: 'RECOMMENDED_NOT_ENFORCED',
    reason: `Operation name "${raw}" does not match any known read/compute/write verb — fails closed. Never automatically AVAILABLE; a caller must not assume READ-level safety for an unrecognized operation.`,
  };
}
