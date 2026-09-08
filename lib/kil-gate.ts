// ---------------------------------------------------------------------------
// SYNTHOS — the KIL gate, adapted from the real, shipped
// ~/synthos/mission-control/src/lib/synthos-gate-verification.ts.
//
// toKilChecks / blockingFailures / describeBlockingFailures are ported
// unchanged (pure mapping logic, no schema dependency).
//
// verifyTaskAtGate is adapted, not a verbatim port: the source builds its
// grounding context from directive_steps/directives/comments tables that
// don't exist in this repo's schema. This repo's real equivalent of "what
// the agent was allowed to draw facts from" is the task's own title,
// description, and inputs/sourceUrl — which is exactly the fallback the
// source itself uses when no directive-step chain exists for a task.
//
// STEP 2 (SynthOS Execution Fabric) — Guardian collapse. checkGuardianRules
// (terminal pre-execution command policy: BLOCKED / APPROVAL_REQUIRED /
// SAFE) used to be a second, separate policy function defined locally in
// server.ts, with no relationship to this module's own gate even though
// both are "does this get to happen" decisions. It is moved here verbatim
// — same regexes, same status/riskLevel/warning/ruleCitation shape, same
// RULE-SEC-01/RULE-SEC-04 citations — so this file is the one canonical
// policy layer for both "is this generated content acceptable"
// (verifyTaskAtGate) and "is this command acceptable to run"
// (checkGuardianRules), rather than a second Guardian module. server.ts's
// three real call sites (POST /api/terminal/guardian-check, POST
// /api/terminal/exec, GET /api/terminal/stream) now import this instead of
// a local definition; no terminal-protection behavior changed.
// ---------------------------------------------------------------------------

import {
  verifyOutput,
  BLOCKING_CHECK_NAMES,
  type VerifierCheck,
  type VerifierResult,
} from './kil-verifier';
import type { KilCheckResults } from './kil';
import { recordKilObservation, kilAgentAttempts, type KilObservationRecord } from './persistence';

/**
 * The output ceiling a dispatched task is given, for the sane-length bound.
 * Matches the source's own GATE_MAX_OUTPUT_TOKENS constant — this repo's
 * Gemini calls don't set an explicit maxOutputTokens, so there is no local
 * value to prefer over the source's real one.
 */
export const GATE_MAX_OUTPUT_TOKENS = 4096;

/**
 * Map the verifier's checks onto the KIL input.
 *
 * Blocking checks become booleans, quality checks keep their continuous
 * score. A check the verifier did not produce is treated as failed for
 * blocking and as 0 for quality: the gate fails closed.
 */
export function toKilChecks(result: VerifierResult): KilCheckResults {
  const byName = new Map(result.checks.map((c) => [c.name, c]));
  const passed = (name: string) => byName.get(name)?.passed ?? false;
  const score = (name: string) => {
    const raw = byName.get(name)?.score;
    return typeof raw === 'number' ? Math.min(1, Math.max(0, raw)) : 0;
  };

  return {
    no_invented_urls: passed('no_invented_urls'),
    no_invented_prices: passed('no_invented_prices'),
    non_empty: passed('non_empty'),
    no_placeholder_text: passed('no_placeholder_text'),
    min_length: score('min_length'),
    max_length: score('max_length'),
    structural_completeness: score('structural_completeness'),
    citation_density: score('citation_density'),
    directive_term_coverage: score('directive_term_coverage'),
  };
}

/** The blocking checks that failed, in the verifier's own order. */
export function blockingFailures(result: VerifierResult): VerifierCheck[] {
  return result.checks.filter(
    (c) => (BLOCKING_CHECK_NAMES as readonly string[]).includes(c.name) && !c.passed,
  );
}

const BLOCKING_CHECK_WORDS: Record<string, string> = {
  non_empty: 'the output was empty',
  no_invented_urls: 'the output stated a URL not present in its source material',
  no_invented_prices: 'the output stated a price not present in its source material',
  no_placeholder_text: 'the output contained unfilled placeholder text',
};

/** One sentence naming every failed safety check and what it found. */
export function describeBlockingFailures(failures: VerifierCheck[]): string | null {
  if (failures.length === 0) return null;
  const parts = failures.map(
    (c) => `${c.name} — ${BLOCKING_CHECK_WORDS[c.name] ?? 'a safety check failed'} (${c.detail})`,
  );
  return `Blocked by the verification gate: ${parts.join('; ')}`;
}

export interface GateTask {
  taskId: string;
  workspaceId: string;
  title: string;
  description: string;
  /** What the output was allowed to draw facts from: title/description/inputs/sourceUrl. */
  groundingContext: string;
  assignedAgent: string;
  /** What the agent produced. This is the thing being verified. */
  output: string;
}

export interface GateVerification {
  result: VerifierResult;
  observation: KilObservationRecord;
  blocking: VerifierCheck[];
  /** Plain sentence naming the failed check. Null when nothing blocked. */
  blockedReason: string | null;
}

/**
 * Verify one task's output at the gate and record the observation.
 *
 * This never blocks or alters the task's own status — it is purely an
 * additional, isolated record of what the KIL gate decided. A low E(K) is
 * recorded and left alone, exactly as in the source: "the caller fails the
 * task when blockedReason is set, and does nothing about the score
 * otherwise." Callers in this repo choose whether to act on blockedReason;
 * this function only ever records.
 */
export function verifyTaskAtGate(task: GateTask): GateVerification {
  const result = verifyOutput({
    content: task.output ?? '',
    agentName: task.assignedAgent,
    groundingContext: task.groundingContext,
    maxTokens: GATE_MAX_OUTPUT_TOKENS,
    // The task's own title and description are the requirement it was given.
    requirementText: [task.title, task.description ?? ''].join('\n').trim(),
  });

  const checks = toKilChecks(result);
  const attempts = kilAgentAttempts(task.workspaceId, task.assignedAgent);

  const observation = recordKilObservation({
    workspaceId: task.workspaceId,
    taskId: task.taskId,
    agentId: task.assignedAgent,
    checks,
    attempts,
  });

  const blocking = blockingFailures(result);
  return {
    result,
    observation,
    blocking,
    blockedReason: describeBlockingFailures(blocking),
  };
}

// ---------------------------------------------------------------------------
// Terminal command policy (moved verbatim from server.ts's former local
// checkGuardianRules — STEP 2 Guardian collapse, see the module comment
// above). Pure, synchronous, no persistence dependency: given a command
// string, decide SAFE / APPROVAL_REQUIRED / BLOCKED. Callers (the three
// /api/terminal/* routes in server.ts) are responsible for acting on the
// result — this function only classifies.
// ---------------------------------------------------------------------------

export interface GuardianCommandCheck {
  status: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "FATAL";
  warning?: string;
  ruleCitation?: string;
}

export function checkGuardianRules(cmd: string): GuardianCommandCheck {
  const trimmed = cmd.trim();
  // Forbidden / fatal blocked
  if (
    trimmed.includes(":(){ :|:& };:") ||
    /rm\s+-rf\s+(\/|\/\*|~|\$HOME|\.\.)(\s|$)/.test(trimmed) ||
    /mkfs\b/.test(trimmed) ||
    /dd\s+if=.*of=\/dev\//.test(trimmed) ||
    /chmod\s+-R\s+777\s+\//.test(trimmed)
  ) {
    return {
      status: "BLOCKED",
      riskLevel: "FATAL",
      warning: "Catastrophic filesystem destruction or fork bomb detected. Execution strictly denied by Guardian Aegis Sentinel.",
      ruleCitation: "RULE-SEC-01: Permanent Root Protection"
    };
  }

  // Approval required for privileged/destructive operations
  if (
    /sudo\b/.test(trimmed) ||
    /rm\s+-rf\b/.test(trimmed) ||
    /kill\s+-9\b/.test(trimmed) ||
    /git\s+reset\s+--hard\b/.test(trimmed) ||
    /git\s+clean\s+-fdx?\b/.test(trimmed) ||
    /curl\s+.*\|\s*(ba)?sh\b/.test(trimmed) ||
    /wget\s+.*\|\s*(ba)?sh\b/.test(trimmed) ||
    />\s*\/dev\/sd/.test(trimmed) ||
    /chmod\s+(\+x|[0-7]{3,4})\s+(\/|etc|bin|usr)/.test(trimmed) ||
    /npm\s+publish\b/.test(trimmed) ||
    /npx\s+.*--yes\b/.test(trimmed) ||
    /drop\s+database\b/i.test(trimmed)
  ) {
    return {
      status: "APPROVAL_REQUIRED",
      riskLevel: "CRITICAL",
      warning: "Privileged, destructive, or external execution pipeline detected. Explicit human authorization required before execution.",
      ruleCitation: "RULE-SEC-04: Privileged Operation Gate"
    };
  }

  return {
    status: "SAFE",
    riskLevel: "LOW"
  };
}
