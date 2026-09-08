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

export type CapabilityEffectClass = 'READ' | 'COMPUTE' | 'EXTERNAL_ACTION' | 'CONTROL';

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
  // classifySkillExecutability's 'hermes_runtime' case is unconditional:
  // execute() has no real contract regardless of HERMES_ADAPTER_BASE_URL
  // configuration (lib/skills.ts). Connectivity (hermesRuntimeStatus) and
  // execution are two different questions — this capability answers the
  // execution question honestly: it does not exist yet, full stop.
  const hermes = findSystem(report, 'Hermes Dedicated Runtime');
  return {
    key: 'hermes.execute',
    runtime: 'hermes',
    status: 'UNSUPPORTED',
    effectClass: 'EXTERNAL_ACTION',
    riskTier: 'MEDIUM',
    approvalPolicy: 'NONE',
    workspaceScope: 'admin',
    reference: 'src/services/hermesAdapter.ts::HermesAdapter.execute (stub)',
    reason: `execute() has no real contract regardless of connectivity (ADR-001 Phase 3, deferred). Connectivity itself: ${hermes?.status ?? 'NOT_CONFIGURED'}.`,
  };
}

function scheduleCapability(): CapabilityDescriptor {
  return {
    key: 'schedule',
    runtime: 'scheduler',
    status: 'NOT_CONFIGURED',
    effectClass: 'CONTROL',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'none',
    reference: 'none',
    reason: 'No scheduler exists in this repository (no cron/timer/dispatch-loop code found). CLAUDE.md\'s description of a timer-armed dispatcher describes the upstream Builderz Labs Mission Control reference project, not code present here.',
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

function researchCapability(): CapabilityDescriptor {
  return {
    key: 'research',
    runtime: 'research',
    status: 'NOT_CONFIGURED',
    effectClass: 'READ',
    riskTier: 'NONE',
    approvalPolicy: 'NONE',
    workspaceScope: 'none',
    reference: 'none',
    reason: 'No live web/GitHub research or grounding capability exists. "perplexity"/"sonar" are recognized model identifiers with no configured execution mapping (lib/model-router.ts RECOGNIZED_UNCONFIGURED_PROVIDERS) — never silently substituted with a different provider.',
  };
}

/** MCP itself is a transport, not a capability with one status — see mcpConnectivityCapability + classifyMcpOperation below. */
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
    skillExecuteCapability(report),
    windmillJobCapability(report),
    terminalExecCapability(),
    hermesExecuteCapability(report),
    scheduleCapability(),
    browserCapability(),
    researchCapability(),
    mcpConnectivityCapability(report),
  ];
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
