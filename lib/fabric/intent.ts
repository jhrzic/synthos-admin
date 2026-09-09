// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 5: the canonical intent classifier.
//
// PLATFORM-LEVEL INFRASTRUCTURE, same posture as lib/fabric/registry.ts.
// This file does NOT wire into Jarvis, does not execute anything, and does
// not live under src/ — it is a pure text-in, classification-out function
// any real caller (Jarvis in Step 6, graphs, admin workflows, an external
// API) can consult. Step 5 is classification and registry only; no
// business-action logic is added here.
//
// This directly targets a known bug in /api/jarvis/command's routing
// (server.ts, `lower.includes("task")` etc.): a prompt like "research the
// latest AI task-automation repos" contains the substring "task" and would
// misroute to a task-list query under naive substring matching. This
// classifier is NOT wired to replace that route yet (Step 6) — it exists so
// Step 6 has something real to switch to.
// ---------------------------------------------------------------------------

import { resolveCapability, type CapabilityStatus } from './registry';

export type IntentType =
  | 'CONVERSATIONAL_QUERY'
  | 'ACTION_REQUEST'
  | 'APPROVAL_REQUIRED_ACTION'
  | 'BLOCKED_ACTION';

export type IntentRiskTier = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type IntentConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface IntentClassification {
  intentType: IntentType;
  /** A registry key (lib/fabric/registry.ts), or null when no real capability corresponds to the request. */
  capability: string | null;
  /** A short, normalized action label — e.g. "task.read", "vault.write", "publish", "schedule". Never the raw prompt. */
  action: string;
  /** Structured, honestly-extracted parameters only — never fabricated structure the text doesn't support. */
  parameters: Record<string, unknown>;
  riskTier: IntentRiskTier;
  reason: string;
  requiresLiveData: boolean;
  confidence: IntentConfidence;
}

// ---------------------------------------------------------------------------
// Pattern library. Every pattern here is deliberately narrow and commented
// with what it is trying to distinguish — the point of this file is
// precision, not recall; a missed classification defaults to the safer
// CONVERSATIONAL_QUERY/LOW-confidence path, never a fabricated action.
// ---------------------------------------------------------------------------

// "latest", "current", "today" etc. — rule 2: these require a live-capable
// capability; a plain model response would be silently using stale training
// data and presenting it as current.
const LIVE_DATA_PATTERN = /\b(latest|current(ly)?|up[- ]to[- ]date|today|this (week|month)|recent(ly)?|trending|breaking|right now|as of (today|now|this))\b/i;

// Real, explicit imperative verbs that name an action a capability actually
// performs — never a bare substring like "task" (that is exactly the
// collision this classifier exists to avoid).
const RESEARCH_VERB_PATTERN = /\b(research|investigate|find (out|me)?|look up|search for|dig into)\b/i;

const VAULT_WRITE_PATTERN = /\b(save|write|store|add|put)\b[^.!?]{0,30}\b(this|it|that|note)\b[^.!?]{0,30}\b(to|in|into)\b[^.!?]{0,15}\bvault\b|\bvault\b[^.!?]{0,20}\b(save|write|store)\b/i;

const PUBLISH_PATTERN = /\b(publish|broadcast|post (this|it) (live|publicly)|go live|send to (all|everyone|the list|subscribers))\b/i;

const SCHEDULE_PATTERN = /\b(schedule|set up a recurring|remind me|run (this|it) (every|daily|weekly|tomorrow|on)|automate this)\b/i;

// STEP 7 — a bare temporal-scheduling phrase (no "schedule"/"run it" prefix
// required) is itself the signal that this is a scheduling request, not an
// immediate one: "research X tomorrow at 9am" and "run the X research once
// in 1 minute" both name a real action verb (research/run) AND a real
// future time — the WHEN must win the classification here, or the WHAT
// (research) would hijack it and the request would execute immediately
// instead of being scheduled. lib/fabric/scheduler.ts re-derives the WHAT
// from the remaining text after stripping this matched phrase, so this
// pattern only needs to detect "some real future time is named," not parse
// it — that parsing (and the honest ambiguous/ "no time attached" refusal)
// lives in scheduler.ts's parseSchedulePhrase, not duplicated here.
// STEP 8 — tolerates the same narrow hedging words ("approximately"/
// "about"/"around") lib/fabric/scheduler.ts's own parser now accepts, so a
// phrase like "in approximately 1 minute" is recognized as schedule-shaped
// here BEFORE it ever reaches that parser — otherwise the parser's own
// widened vocabulary would never be reached at all.
const SCHEDULE_TIME_PHRASE_PATTERN = /\b(tomorrow|tonight)\b|\bin\s+(?:approximately|about|around)?\s*\d+\s+(minute|hour|day)s?\b|\bevery\s+(?:approximately|about|around)?\s*\d*\s*(minute|hour|day)s?\b/i;

// Destructive verb + a high-stakes target — mirrors the same BLOCKED-vs-
// APPROVAL_REQUIRED distinction lib/kil-gate.ts's checkGuardianRules already
// applies to shell commands, applied here to natural-language intent
// instead of a command string.
const DESTRUCTIVE_VERB_PATTERN = /\b(delete|drop|wipe|destroy|purge|erase|remove all|nuke)\b/i;
const HIGH_STAKES_TARGET_PATTERN = /\b(production|prod|live (database|data|system)|everything|all (data|records|users|customers)|the database)\b/i;

// Internal-state read patterns — rule 4: viewing/listing existing SynthOS
// state is READ, never an external action. Anchored on a read verb NEAR the
// noun so "task-automation" (a compound modifier, not "my tasks") never
// matches — this is the literal fix for the keyword-collision bug.
const TASK_READ_PATTERN = /\b(my|show( me)?|list|view|see|get|what are my|check)\b[^.!?]{0,20}\btasks?\b|\btasks?\b[^.!?]{0,20}\b(status|board|list)\b/i;
const GRAPH_READ_PATTERN = /\b(my|show( me)?|list|view|see|get|what are my|check)\b[^.!?]{0,20}\b(graphs?|graph runs?|pipelines?)\b/i;
const RECEIPT_READ_PATTERN = /\b(my|show( me)?|list|view|see|get|what are my|recent|check)\b[^.!?]{0,20}\b(receipts?|signatures?)\b/i;
const MEMORY_SEARCH_PATTERN = /\b(search|find|look (up|for))\b[^.!?]{0,25}\b(memory|notes?|vault)\b/i;
const VAULT_READ_PATTERN = /\b(my|show( me)?|list|view|see|what'?s in|check)\b[^.!?]{0,20}\bvault\b/i;

// STEP 6 — Windmill status/list is a real READ (lib/fabric/registry.ts
// windmill.read), distinct from windmill.job's real external submission,
// which no natural-language pattern here ever maps to (Jarvis never
// triggers a real Windmill job from a chat message).
const WINDMILL_READ_PATTERN = /\bwindmill\b|\bexternal (job|execution)s?\b/i;

// STEP 6 — "Hermes do X" is an explicit request to execute something via
// the dedicated Hermes runtime, which is honestly UNSUPPORTED (a stub —
// see lib/fabric/registry.ts hermes.execute). This must reach that
// capability and refuse honestly, never fall through to plain conversation.
const HERMES_ACTION_PATTERN = /\bhermes\b[^.!?]{0,30}\b(do|run|execute|start|trigger|use|handle)\b|\b(do|run|execute|start|trigger|use|handle)\b[^.!?]{0,20}\bhermes\b/i;

// A bare question about a stable concept, no live-data words, no action
// verb — "what is a transformer?" shaped.
const DEFINITIONAL_QUESTION_PATTERN = /^(what|who|why|how|when|where)\b.{0,10}\b(is|are|was|were|does|do)\b/i;

function extractParameters(text: string): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  const scheduleMatch = text.match(/\b(tomorrow|today|tonight|every (day|week|month|hour)|daily|weekly|monthly|on \w+day|at \d{1,2}(:\d{2})?\s*(am|pm)?)\b/i);
  if (scheduleMatch) parameters.when = scheduleMatch[0];
  const queryMatch = text.match(MEMORY_SEARCH_PATTERN);
  if (queryMatch) parameters.query = text.trim();
  return parameters;
}

interface BaseClassification {
  intentType: IntentType;
  capability: string | null;
  action: string;
  riskTier: IntentRiskTier;
  reason: string;
  confidence: IntentConfidence;
}

/**
 * Step 1 of classification: what does the TEXT itself say, independent of
 * whether a live capability exists? Capability availability is layered in
 * afterward (classifyIntent) so the two concerns — "what is being asked"
 * and "can we honestly do it" — stay separate and auditable.
 */
function classifyBase(text: string): BaseClassification {
  // Rule: destructive verb + high-stakes target is BLOCKED regardless of
  // anything else — checked first, highest priority.
  if (DESTRUCTIVE_VERB_PATTERN.test(text) && HIGH_STAKES_TARGET_PATTERN.test(text)) {
    return {
      intentType: 'BLOCKED_ACTION',
      capability: null,
      action: 'destructive_action',
      riskTier: 'CRITICAL',
      reason: 'Destructive verb combined with a high-stakes target (production/all data) — blocked outright, same posture as lib/kil-gate.ts checkGuardianRules() applies to an equivalent shell command.',
      confidence: 'HIGH',
    };
  }

  // Publish / broadcast — consequential external action, approval-shaped
  // regardless of whether a concrete capability is wired for it yet.
  if (PUBLISH_PATTERN.test(text)) {
    return {
      intentType: 'APPROVAL_REQUIRED_ACTION',
      capability: null,
      action: 'publish',
      riskTier: 'HIGH',
      reason: 'Publish/broadcast-shaped request — consequential external action; no real "publish" capability is registered in this deployment today, so this maps to no capability key rather than fabricating one.',
      confidence: 'MEDIUM',
    };
  }

  // STEP 7 — checked BEFORE any action-verb pattern (research, vault.write,
  // etc.): a real future-time phrase means this is a request to schedule
  // the action, not perform it now. "research X tomorrow at 9am" contains
  // both a research verb AND a real future time — the WHEN must win, or
  // RESEARCH_VERB_PATTERN below would hijack it into an immediate research
  // call and "tomorrow at 9am" would become inert trailing text. Ordered
  // ahead of RESEARCH_VERB_PATTERN specifically for this reason; it stays
  // BEHIND the destructive/publish checks above, which already return
  // their own correct BLOCKED/APPROVAL_REQUIRED result independent of
  // timing ("publish this every Monday" is approval-shaped regardless of
  // "every Monday" — Section 7's rule, not this classifier, decides that).
  if (SCHEDULE_PATTERN.test(text) || SCHEDULE_TIME_PHRASE_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'schedule',
      action: 'schedule',
      riskTier: 'LOW',
      reason: 'Scheduling imperative or a real future-time phrase — classified as an action request against the "schedule" capability; lib/fabric/scheduler.ts resolves the underlying WHAT from the remaining text.',
      confidence: 'HIGH',
    };
  }

  // Explicit "research X" / "investigate X" imperative — an action verb,
  // so ACTION_REQUEST regardless of whether the research capability
  // currently exists (rule 1: imperative wording is evidence of
  // ACTION_REQUEST). This is also the literal fix for the "research the
  // latest AI task-automation repos" collision: the action verb is
  // detected BEFORE any task/graph/receipt READ pattern is even checked.
  if (RESEARCH_VERB_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'research',
      action: 'research',
      riskTier: 'LOW',
      reason: 'Explicit research/investigate imperative — classified as an action request against the "research" capability.',
      confidence: 'HIGH',
    };
  }

  if (VAULT_WRITE_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'vault.write',
      action: 'vault.write',
      riskTier: 'LOW',
      reason: 'Explicit save/store-to-Vault imperative — classified as an action request against the "vault.write" capability.',
      confidence: 'HIGH',
    };
  }

  if (VAULT_READ_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'vault.read',
      action: 'vault.read',
      riskTier: 'NONE',
      reason: 'Read/list pattern anchored on "vault" — internal-state read.',
      confidence: 'MEDIUM',
    };
  }

  if (TASK_READ_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'task.read',
      action: 'task.read',
      riskTier: 'NONE',
      reason: 'Read/list pattern anchored directly on "task(s)" — internal-state read, not an external action (rule 4).',
      confidence: 'HIGH',
    };
  }

  if (GRAPH_READ_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'graph.read',
      action: 'graph.read',
      riskTier: 'NONE',
      reason: 'Read/list pattern anchored directly on "graph(s)"/"pipeline(s)" — internal-state read.',
      confidence: 'HIGH',
    };
  }

  if (RECEIPT_READ_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'receipt.read',
      action: 'receipt.read',
      riskTier: 'NONE',
      reason: 'Read/list pattern anchored directly on "receipt(s)" — internal-state read.',
      confidence: 'HIGH',
    };
  }

  if (MEMORY_SEARCH_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'memory.search',
      action: 'memory.search',
      riskTier: 'NONE',
      reason: 'Search-the-vault/memory pattern — internal-state read.',
      confidence: 'MEDIUM',
    };
  }

  if (WINDMILL_READ_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'windmill.read',
      action: 'windmill.read',
      riskTier: 'NONE',
      reason: 'Windmill status/execution mention — real READ, never a job submission from natural language.',
      confidence: 'HIGH',
    };
  }

  if (HERMES_ACTION_PATTERN.test(text)) {
    return {
      intentType: 'ACTION_REQUEST',
      capability: 'hermes.execute',
      action: 'hermes.execute',
      riskTier: 'MEDIUM',
      reason: 'Explicit request to execute something via the Hermes runtime.',
      confidence: 'HIGH',
    };
  }

  if (DEFINITIONAL_QUESTION_PATTERN.test(text) && !LIVE_DATA_PATTERN.test(text)) {
    return {
      intentType: 'CONVERSATIONAL_QUERY',
      capability: null,
      action: 'conversation',
      riskTier: 'NONE',
      reason: 'Definitional question about a stable concept, no live-data signal, no action verb.',
      confidence: 'HIGH',
    };
  }

  if (LIVE_DATA_PATTERN.test(text)) {
    // A question shape ("what are the latest...") with no explicit action
    // verb — still worth naming for the layer above, which decides whether
    // this must be blocked (rule 3) given no live capability exists.
    return {
      intentType: 'CONVERSATIONAL_QUERY',
      capability: 'research',
      action: 'research',
      riskTier: 'LOW',
      reason: 'Live-data word present ("latest"/"current"/"today"/etc.) with no explicit action verb — question-shaped, but names a real-world-current subject a plain model answer cannot honestly satisfy.',
      confidence: 'MEDIUM',
    };
  }

  // Default: no recognized pattern. Never fabricate an action — fall back
  // to the safest classification with LOW confidence.
  return {
    intentType: 'CONVERSATIONAL_QUERY',
    capability: null,
    action: 'conversation',
    riskTier: 'NONE',
    reason: 'No recognized action, read, or live-data pattern matched — defaulting to conversational, low confidence.',
    confidence: 'LOW',
  };
}

/**
 * The one canonical classifier. Async because rule 3 (live data with no
 * live capability => fail honestly) requires a real registry lookup, not a
 * guess — this function will consult lib/fabric/registry.ts's real,
 * evidence-based capability status, never assume availability.
 */
export async function classifyIntent(rawText: string): Promise<IntentClassification> {
  const text = (rawText || '').trim();
  if (!text) {
    return {
      intentType: 'CONVERSATIONAL_QUERY',
      capability: null,
      action: 'conversation',
      parameters: {},
      riskTier: 'NONE',
      reason: 'Empty input.',
      requiresLiveData: false,
      confidence: 'LOW',
    };
  }

  const base = classifyBase(text);
  const requiresLiveData = LIVE_DATA_PATTERN.test(text);
  const parameters = extractParameters(text);

  let intentType = base.intentType;
  let reason = base.reason;
  let riskTier = base.riskTier;

  // Rule 3 — if live data is required and the request has NO explicit
  // action verb (it only reached CONVERSATIONAL_QUERY via the live-data
  // fallback above), it must not silently fall through to a plain
  // conversational answer using stale model knowledge presented as
  // current. An explicit ACTION_REQUEST (e.g. "research the latest...")
  // is left alone here — the user asked for a real action; it is the
  // executor's job (Step 6+) to refuse it against a NOT_CONFIGURED
  // capability, not this classifier's job to pre-empt that.
  if (requiresLiveData && intentType === 'CONVERSATIONAL_QUERY' && base.capability) {
    const capability = await resolveCapability(base.capability);
    const liveStatuses: CapabilityStatus[] = ['AVAILABLE', 'DEGRADED'];
    if (!capability || !liveStatuses.includes(capability.status)) {
      intentType = 'BLOCKED_ACTION';
      riskTier = 'LOW';
      reason = `Live data required ("latest"/"current"/etc.) but capability "${base.capability}" is ${capability?.status ?? 'not registered'} — refusing rather than answering from static model knowledge and presenting it as current (rule 3).`;
    }
  }

  return {
    intentType,
    capability: base.capability,
    action: base.action,
    parameters,
    riskTier,
    reason,
    requiresLiveData,
    confidence: base.confidence,
  };
}
