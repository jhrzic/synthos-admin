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
