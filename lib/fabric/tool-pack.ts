// ---------------------------------------------------------------------------
// TOOL PACK 1 — the canonical tool manifest.
//
// ONE list, read by everything: the capability registry (so a tool's status is
// derived, never hardcoded), the envelope (so dispatch and policy agree), the
// /api/tools route, and the Admin surface. The instruction was explicit that UI
// status must not be hardcoded separately from registry truth; the way to
// guarantee that is for there to be exactly one place a tool is described, and
// this is it.
//
// WHAT THIS FILE IS NOT
// It is not an execution path. Nothing here calls GitHub, reads a file, writes
// a note or touches the network. It describes tools and resolves whether their
// PRECONDITIONS are met. Execution stays in lib/fabric/envelope.ts, which is
// the one canonical dispatcher — this pass adds no second tool runner.
//
// ---------------------------------------------------------------------------
// EFFECT CLASSES — reusing existing vocabulary, and the one addition
// ---------------------------------------------------------------------------
// The instruction asked for READ_ONLY and INTERNAL_MUTATION, and also said to
// reuse an existing canonical name where one exists rather than introduce
// duplicate schema to match terminology. So:
//
//   READ_ONLY         maps onto the registry's existing 'READ'. Same meaning,
//                     already the canonical name, not renamed.
//
//   INTERNAL_MUTATION is genuinely new, and is added to
//                     CapabilityEffectClass rather than being faked with an
//                     existing member. Here is why that is not terminology
//                     churn:
//
// Before this pass the registry had no way to say "this changes SynthOS's own
// state and reaches nothing outside it". vault.write — writing a file into
// SynthOS's own vault — was therefore classed EXTERNAL_ACTION, which is false
// on its face, and the envelope then had to carry
// EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE, a named exemption set, purely to
// let that obviously-internal write proceed. The exemption existed because the
// classification was wrong, and each new internal-mutating tool would have had
// to be added to that exemption list — i.e. each one would have been recorded
// as "an external action we have decided to allow", which is exactly the kind
// of note that later reads as a deliberate Guardian bypass.
//
// INTERNAL_MUTATION lets the five mutating tools in this pack be described
// accurately and gated on their own terms. Note carefully what that does NOT
// mean: it is not a weaker class that skips Guardian. The envelope requires
// Guardian enforcement for INTERNAL_MUTATION exactly as it does for
// EXTERNAL_ACTION — see the dispatch guard — so this is a more precise
// classification, not a cheaper one.
//
// vault.write itself is deliberately LEFT as EXTERNAL_ACTION + exempt in this
// pass. Reclassifying it would change the behaviour of an existing, live,
// separately-tested capability, and a capability-expansion pass is the wrong
// place to do that silently. It is recorded as a follow-up, not fixed here.
// ---------------------------------------------------------------------------

import type {
  CapabilityApprovalPolicy,
  CapabilityEffectClass,
  CapabilityRiskTier,
  CapabilityWorkspaceScope,
} from './registry';
import { approvedRepositories, githubTokenPresent } from '../github-readonly';
import { allowedFileRootKeys } from '../workspace-files';
import { getVaultStatus, canWriteKnowledge } from '../vault-config';
import { gmailOAuthConfigured, listWorkspaceGmailConnections } from '../gmail-connection';

/** The vocabulary the instruction uses. READ_ONLY is an alias of the registry's 'READ'. */
export type ToolEffectClass = 'READ_ONLY' | 'INTERNAL_MUTATION' | 'EXTERNAL_ACTION';

/** The single mapping between the two vocabularies. Nothing else may define one. */
export function toCapabilityEffectClass(cls: ToolEffectClass): CapabilityEffectClass {
  switch (cls) {
    case 'READ_ONLY': return 'READ';
    case 'INTERNAL_MUTATION': return 'INTERNAL_MUTATION';
    case 'EXTERNAL_ACTION': return 'EXTERNAL_ACTION';
  }
}

/**
 * What a tool's OUTPUT may become — Section 7, "Observation ≠ Knowledge".
 *
 * This is a policy field, not a description, and it is attached to the tool
 * rather than decided at the call site so that no caller can promote a tool's
 * output beyond what the tool is allowed to produce.
 *
 *   NONE                 — read-only observation. It is returned to the caller
 *                          and recorded as activity evidence. It never becomes
 *                          an artifact and never becomes Brain knowledge.
 *   ARTIFACT             — output is committed as a durable artifact through
 *                          the canonical writer, with the usual evidence
 *                          chain. An artifact is evidence of work, NOT
 *                          approved knowledge.
 *   KNOWLEDGE_CANDIDATE  — output may be PROJECTED as a candidate for a human
 *                          to approve. Still not knowledge.
 *   AUTHORIZED_SESSION_NOTE — the single explicit exception: brain
 *                          .write_session_note, which the instruction
 *                          authorizes to write into the SynthOS/ subtree. It
 *                          is authorized internal writeback, and deliberately
 *                          not a general knowledge-promotion mechanism.
 */
export type BrainWritebackPolicy = 'NONE' | 'ARTIFACT' | 'KNOWLEDGE_CANDIDATE' | 'AUTHORIZED_SESSION_NOTE';

export type ToolCategory = 'brain' | 'github' | 'files' | 'scheduler' | 'research' | 'gmail';

export interface ToolDefinition {
  /** The capability id. Also the registry key — one identifier, not two. */
  capability: string;
  displayName: string;
  category: ToolCategory;
  effectClass: ToolEffectClass;
  brainWriteback: BrainWritebackPolicy;
  riskTier: CapabilityRiskTier;
  workspaceScope: CapabilityWorkspaceScope;
  approvalPolicy: CapabilityApprovalPolicy;
  /** True when Guardian actually inspects this tool's input before dispatch. */
  guardianEnforced: boolean;
  runtime: string;
  /** The real file::function this dispatches through. Never a planned path. */
  reference: string;
  /** One line on what it does. Shown in the Admin surface. */
  summary: string;
}

// ---------------------------------------------------------------------------
// THE MANIFEST
//
// Fourteen tools. No EXTERNAL_ACTION tool is added by this pack — every entry
// below is READ_ONLY or INTERNAL_MUTATION, as instructed.
// ---------------------------------------------------------------------------

export const TOOL_PACK_1: readonly ToolDefinition[] = Object.freeze([
  // --- A. Brain / Obsidian ------------------------------------------------
  {
    capability: 'brain.search',
    displayName: 'Brain — Search Knowledge',
    category: 'brain',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'NONE',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'obsidian-vault',
    reference: 'lib/knowledge-vault.ts::searchWorkspaceKnowledge',
    summary: 'Search this workspace’s canonical knowledge notes. Workspace-scoped by frontmatter attribution; results carry provenance.',
  },
  {
    capability: 'brain.read',
    displayName: 'Brain — Read Note',
    category: 'brain',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'NONE',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'obsidian-vault',
    reference: 'lib/knowledge-vault.ts::readWorkspaceKnowledgeNote',
    summary: 'Read one approved knowledge note. Confined to the SynthOS/ subtree and to the caller’s own workspace.',
  },
  {
    capability: 'brain.read_source',
    displayName: 'Brain — Read External Source',
    category: 'brain',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'obsidian-vault',
    reference: 'lib/brain-sources.ts::readExternalSource',
    summary: 'Read one note from the vault OUTSIDE the SynthOS/ subtree. Read-only source material, labelled EXTERNAL_SOURCE / UNADMITTED \u2014 never admitted knowledge.',
  },
  {
    capability: 'brain.write_session_note',
    displayName: 'Brain — Write Session Note',
    category: 'brain',
    effectClass: 'INTERNAL_MUTATION',
    brainWriteback: 'AUTHORIZED_SESSION_NOTE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    guardianEnforced: true,
    runtime: 'obsidian-vault',
    reference: 'lib/knowledge-vault.ts::writeKnowledgeNote',
    summary: 'Write one bounded, provenance-stamped session note into the SynthOS/Sessions subtree. Never overwrites; never writes outside SynthOS/.',
  },

  // --- B. GitHub, read-only ----------------------------------------------
  {
    capability: 'github.search',
    displayName: 'GitHub — Search Repositories',
    category: 'github',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'github-api',
    reference: 'lib/github-readonly.ts::githubSearchRepositories',
    summary: 'Search GitHub’s public repository index. Bounded result count; every result carries its source endpoint.',
  },
  {
    capability: 'github.read_file',
    displayName: 'GitHub — Read File',
    category: 'github',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'github-api',
    reference: 'lib/github-readonly.ts::githubReadFile',
    summary: 'Read one file from an approved repository. Requires GITHUB_APPROVED_REPOS; bounded to 512KB.',
  },
  {
    capability: 'github.inspect',
    displayName: 'GitHub — Inspect Metadata',
    category: 'github',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'github-api',
    reference: 'lib/github-readonly.ts::githubInspect',
    summary: 'Inspect commit, issue, pull-request, branch or repository metadata from an approved repository. Returns a reviewed projection, not raw upstream JSON.',
  },

  // --- C. Workspace files -------------------------------------------------
  {
    capability: 'files.read',
    displayName: 'Files — Read Workspace File',
    category: 'files',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'local-filesystem',
    reference: 'lib/workspace-files.ts::readWorkspaceFile',
    summary: 'Read a file from one of a fixed set of allowed roots. Root key plus relative path only — no absolute path, no traversal, no symlink follow.',
  },
  {
    capability: 'files.write_artifact',
    displayName: 'Files — Write Artifact',
    category: 'files',
    effectClass: 'INTERNAL_MUTATION',
    brainWriteback: 'ARTIFACT',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    guardianEnforced: true,
    runtime: 'local-filesystem',
    reference: 'lib/fabric/envelope.ts::commitEvidencedArtifact',
    summary: 'Write an artifact through the canonical evidenced writer — task, artifact, Aegis verification and signed receipt. Filename is server-generated.',
  },

  // --- D. Scheduler -------------------------------------------------------
  {
    capability: 'schedule.list',
    displayName: 'Scheduler — List Schedules',
    category: 'scheduler',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'NONE',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'synthos-scheduler',
    reference: 'lib/persistence.ts::listWorkspaceSchedules',
    summary: 'List this workspace’s schedules with their real status and next run time.',
  },
  {
    capability: 'schedule.create_internal',
    displayName: 'Scheduler — Create Internal Schedule',
    category: 'scheduler',
    effectClass: 'INTERNAL_MUTATION',
    brainWriteback: 'NONE',
    riskTier: 'MEDIUM',
    workspaceScope: 'member',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    guardianEnforced: true,
    runtime: 'synthos-scheduler',
    reference: 'lib/fabric/scheduler.ts::createValidatedSchedule',
    summary: 'Schedule a capability that Guardian policy already permits. Cannot schedule anything the caller could not invoke directly.',
  },
  {
    capability: 'schedule.pause',
    displayName: 'Scheduler — Pause Schedule',
    category: 'scheduler',
    effectClass: 'INTERNAL_MUTATION',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    guardianEnforced: true,
    runtime: 'synthos-scheduler',
    reference: 'lib/persistence.ts::setScheduleStatus',
    summary: 'Pause one of this workspace’s schedules. Stops future occurrences; does not delete history.',
  },
  {
    capability: 'schedule.resume',
    displayName: 'Scheduler — Resume Schedule',
    category: 'scheduler',
    effectClass: 'INTERNAL_MUTATION',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    guardianEnforced: true,
    runtime: 'synthos-scheduler',
    reference: 'lib/fabric/scheduler.ts::computeResumeNextRunAt',
    summary: 'Resume a paused schedule, recomputing its next run from now rather than replaying missed occurrences.',
  },

  // --- E. Research --------------------------------------------------------
  {
    capability: 'research.search',
    displayName: 'Research — Search',
    category: 'research',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'github-api',
    reference: 'lib/fabric/research.ts::discoverLiveRepositories',
    summary: 'Discover real sources for a query. Returns retrieved facts with source URLs and NO model synthesis — observation only.',
  },
  // --- TOOL PACK 2: Gmail -------------------------------------------------
  //
  // THE FIRST REAL EXTERNAL_ACTION in SynthOS, and the effect classes below are
  // the whole safety story of this pack:
  //
  //   search / read_thread  READ_ONLY        — nothing changes, nothing leaves
  //   create_draft          INTERNAL_MUTATION — a draft is visible only to the
  //                                             account owner; it delivers
  //                                             nothing, so it is internal
  //   send                  EXTERNAL_ACTION   — irreversible, reaches a person,
  //                                             requires a human approval bound
  //                                             to the exact message
  //
  // Draft and send are deliberately separate capabilities rather than one
  // capability with a `send: true` flag. A flag would mean the difference
  // between "wrote something" and "mailed a customer" was a boolean in a
  // parameters object, decided by whatever constructed the call.
  {
    capability: 'gmail.search',
    displayName: 'Gmail — Search',
    category: 'gmail',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'MEDIUM',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'gmail-api',
    reference: 'lib/gmail-client.ts::gmailSearch',
    summary: 'Search the workspace\u2019s connected mailbox. Bounded results, metadata only \u2014 no message bodies, no mark-as-read, no Brain promotion.',
  },
  {
    capability: 'gmail.read_thread',
    displayName: 'Gmail — Read Thread',
    category: 'gmail',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'MEDIUM',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'gmail-api',
    reference: 'lib/gmail-client.ts::gmailReadThread',
    summary: 'Read one bounded thread. Message bodies are capped; the token carries no gmail.modify scope, so reading cannot mark anything read.',
  },
  {
    capability: 'gmail.create_draft',
    displayName: 'Gmail — Create Draft',
    category: 'gmail',
    effectClass: 'INTERNAL_MUTATION',
    brainWriteback: 'ARTIFACT',
    riskTier: 'LOW',
    workspaceScope: 'member',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    guardianEnforced: true,
    runtime: 'gmail-api',
    reference: 'lib/gmail-client.ts::gmailCreateDraft',
    summary: 'Create a Gmail draft. Delivers nothing \u2014 visible only to the account owner. Records the content digest a later send approval must match.',
  },
  {
    capability: 'gmail.send',
    displayName: 'Gmail — Send',
    category: 'gmail',
    effectClass: 'EXTERNAL_ACTION',
    brainWriteback: 'ARTIFACT',
    riskTier: 'HIGH',
    workspaceScope: 'member',
    approvalPolicy: 'GUARDIAN_ENFORCED',
    guardianEnforced: true,
    runtime: 'gmail-api',
    reference: 'lib/gmail-client.ts::gmailSendMessage',
    summary: 'Send exactly one approved message. Requires Guardian plus a single-use human approval bound to sender, every recipient, subject, body and thread. No bulk send.',
  },

  {
    capability: 'research.fetch',
    displayName: 'Research — Fetch URL',
    category: 'research',
    effectClass: 'READ_ONLY',
    brainWriteback: 'NONE',
    riskTier: 'MEDIUM',
    workspaceScope: 'member',
    approvalPolicy: 'NONE',
    guardianEnforced: false,
    runtime: 'http',
    reference: 'lib/net-guard.ts::assertSafeOutboundUrl',
    summary: 'Fetch one public URL, bounded and read-only. DNS-resolved SSRF guard refuses loopback, private, link-local and metadata targets.',
  },
]);

export function findToolDefinition(capability: string): ToolDefinition | undefined {
  return TOOL_PACK_1.find((t) => t.capability === capability);
}

export function isToolPackCapability(capability: string): boolean {
  return TOOL_PACK_1.some((t) => t.capability === capability);
}

/** Every tool that mutates anything. Used by tests to assert the split is exhaustive. */
export function mutatingToolCapabilities(): string[] {
  return TOOL_PACK_1.filter((t) => t.effectClass !== 'READ_ONLY').map((t) => t.capability);
}

export function readOnlyToolCapabilities(): string[] {
  return TOOL_PACK_1.filter((t) => t.effectClass === 'READ_ONLY').map((t) => t.capability);
}

// ---------------------------------------------------------------------------
// PRECONDITION RESOLUTION
//
// A tool's status is DERIVED here from real evidence, never asserted. The
// registry calls this; the Admin surface renders what the registry returns. So
// there is exactly one answer to "is this tool usable", and the UI cannot
// disagree with the executor.
// ---------------------------------------------------------------------------

export interface ToolReadiness {
  /** Preconditions are met and the executor can run. */
  configured: boolean;
  /** Nothing has switched it off. */
  enabled: boolean;
  /** Truthful explanation, whichever way the answer went. */
  reason: string;
  /** Present when configuration beyond a credential is missing. */
  missingConfiguration: string | null;
}

export function resolveToolReadiness(
  capability: string,
  env: NodeJS.ProcessEnv = process.env,
): ToolReadiness {
  switch (capability) {
    // --- Brain: needs a reachable vault -----------------------------------
    case 'brain.search':
    case 'brain.read':
    case 'brain.read_source': {
      const status = getVaultStatus(env);
      const ok = !!status.root && status.mode !== 'UNAVAILABLE';
      return {
        configured: ok,
        enabled: true,
        reason: ok
          ? `Vault reachable at ${status.root} (mode ${status.mode}); reads are workspace-scoped by note frontmatter.`
          : `No readable vault: ${status.detail}`,
        missingConfiguration: ok ? null : 'a reachable vault root (SYNTHOS_VAULT_PATH)',
      };
    }
    case 'brain.write_session_note': {
      const status = getVaultStatus(env);
      const writable = canWriteKnowledge(status);
      return {
        configured: writable,
        enabled: true,
        reason: writable
          ? `Vault at ${status.root} is writable; notes are confined to the SynthOS/ subtree.`
          : `Vault is not writable: ${status.detail}`,
        missingConfiguration: writable ? null : 'a writable vault root',
      };
    }

    // --- GitHub -----------------------------------------------------------
    // github.search reads the public index and needs no credential and no
    // allowlist: a token only raises the rate limit. Reporting it
    // NOT_CONFIGURED without one would be false — it genuinely works.
    case 'github.search': {
      const token = githubTokenPresent();
      return {
        configured: true,
        enabled: true,
        reason: token
          ? 'GitHub repository search is available, authenticated (GITHUB_TOKEN present, higher rate limit).'
          : 'GitHub repository search is available unauthenticated. Set GITHUB_TOKEN to raise the rate limit.',
        missingConfiguration: null,
      };
    }
    // The repo-scoped reads DO need the boundary configured. An empty
    // allowlist means no repository is approved, and the honest report is
    // NOT_CONFIGURED rather than a tool that fails on every call.
    case 'github.read_file':
    case 'github.inspect': {
      const approved = approvedRepositories(env);
      const ok = approved.length > 0;
      return {
        configured: ok,
        enabled: true,
        reason: ok
          ? `${approved.length} approved repository pattern(s): ${approved.join(', ')}.`
          : 'No repositories are approved for reading. Set GITHUB_APPROVED_REPOS to an explicit comma-separated list (owner/name, or owner/* for one owner).',
        missingConfiguration: ok ? null : 'GITHUB_APPROVED_REPOS',
      };
    }

    // --- Files ------------------------------------------------------------
    case 'files.read': {
      const keys = allowedFileRootKeys(env);
      return {
        configured: keys.length > 0,
        enabled: true,
        reason: `Allowed roots: ${keys.join(', ')}. Absolute paths, traversal and symlinks are refused.`,
        missingConfiguration: keys.length > 0 ? null : 'at least one allowed file root',
      };
    }
    case 'files.write_artifact':
      return {
        configured: true,
        enabled: true,
        reason: 'Writes through the canonical evidenced artifact path (task → artifact → Aegis → receipt). Filenames are server-generated.',
        missingConfiguration: null,
      };

    // --- Scheduler --------------------------------------------------------
    case 'schedule.list':
    case 'schedule.create_internal':
    case 'schedule.pause':
    case 'schedule.resume':
      return {
        configured: true,
        enabled: true,
        reason: 'Uses the existing SynthOS scheduler and its existing policy gate; cannot widen what a capability is permitted to do.',
        missingConfiguration: null,
      };

    // --- Research ---------------------------------------------------------
    // research.search reuses GitHub discovery WITHOUT the synthesis step, so
    // unlike the older `research` capability it needs no model credential.
    // That is the point of splitting it out: retrieval and synthesis are
    // different things with different dependencies, and conflating them made
    // pure retrieval unavailable whenever a model key was missing.
    case 'research.search':
      return {
        configured: true,
        enabled: true,
        reason: 'Live source discovery via the GitHub Search API. No model credential required — this returns retrieved facts only, never synthesis.',
        missingConfiguration: null,
      };
    case 'research.fetch':
      return {
        configured: true,
        enabled: true,
        reason: 'Bounded, read-only public fetch behind the DNS-resolving SSRF guard in lib/net-guard.ts.',
        missingConfiguration: null,
      };

    // --- Gmail ------------------------------------------------------------
    // Readiness is deliberately NOT workspace-aware here, because this
    // function answers "is the tool installable at all" for the platform-level
    // registry, which has no workspace in scope. The per-workspace question
    // ("is THIS workspace's mailbox connected") is answered at dispatch by
    // resolveGmailConnection, which reports NOT_CONFIGURED with the exact
    // missing step. Reporting the platform state here and the workspace state
    // at dispatch keeps one truth per question instead of a registry row that
    // silently means something different per caller.
    case 'gmail.search':
    case 'gmail.read_thread':
    case 'gmail.create_draft':
    case 'gmail.send': {
      if (!gmailOAuthConfigured()) {
        return {
          configured: false,
          enabled: true,
          reason: 'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, then connect a Gmail account to a workspace.',
          missingConfiguration: 'GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET',
        };
      }
      return {
        configured: true,
        enabled: true,
        reason: capability === 'gmail.send'
          ? 'Google OAuth is configured. Every send additionally requires a connected account in the calling workspace, Guardian approval, and a single-use human approval bound to the exact message.'
          : 'Google OAuth is configured. Requires a connected Gmail account in the calling workspace, checked at dispatch.',
        missingConfiguration: null,
      };
    }

    default:
      return {
        configured: false,
        enabled: false,
        reason: `"${capability}" is not a Tool Pack 1 capability.`,
        missingConfiguration: null,
      };
  }
}
