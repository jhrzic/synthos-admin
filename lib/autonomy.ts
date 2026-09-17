// ---------------------------------------------------------------------------
// BOUNDED AUTONOMY.
//
// One setting, three levels, no policy editor. The instruction was explicit
// about the last part, and it is the right call: a general policy editor is a
// surface where a wrong click grants authority nobody reviewed, and there is
// nothing yet that needs more than these three levels.
//
//   MANUAL                     The orchestrator picks up nothing. Every task
//                              advances only because a human asked for it.
//   INTERNAL_AUTOMATION        The default. The orchestrator may carry
//                              READ_ONLY, COMPUTE and INTERNAL_MUTATION work
//                              forward on its own. EXTERNAL_ACTION is refused
//                              at dispatch — not queued for approval, refused:
//                              an unattended loop must not be able to create
//                              approval requests that a tired operator
//                              rubber-stamps at 2am.
//   APPROVAL_GATED_EXTERNAL    The orchestrator may additionally PREPARE an
//                              external action and stop at the approval gate.
//                              It still cannot send anything without a human.
//
// WHY THE DEFAULT IS INTERNAL_AUTONOMY AND NOT THE MOST PERMISSIVE LEVEL
// Every external action SynthOS can take is irreversible by nature — mail
// arrives, a post is public. The safe default is the one where an unattended
// process cannot reach that class of action at all, and where turning it on is
// a deliberate act with a name.
//
// This is a READ-ONLY resolver over the environment. There is deliberately no
// setter and no HTTP route that changes it: autonomy level is deployment
// configuration, changed by editing the service env and restarting, which
// leaves a trace in a file an operator owns rather than in a form submission.
// ---------------------------------------------------------------------------

import type { CapabilityEffectClass } from './fabric/registry';

export type AutonomyLevel = 'MANUAL' | 'INTERNAL_AUTOMATION' | 'APPROVAL_GATED_EXTERNAL';

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ['MANUAL', 'INTERNAL_AUTOMATION', 'APPROVAL_GATED_EXTERNAL'];

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 'INTERNAL_AUTOMATION';

/**
 * The configured level.
 *
 * An unrecognised value resolves to the DEFAULT rather than to the most
 * permissive level or to a throw. A typo in a service env file must not
 * silently widen authority, and it must not take the runtime down either.
 */
export function resolveAutonomyLevel(env: NodeJS.ProcessEnv = process.env): AutonomyLevel {
  const raw = String(env.SYNTHOS_AUTONOMY_LEVEL || '').trim().toUpperCase();
  if ((AUTONOMY_LEVELS as readonly string[]).includes(raw)) return raw as AutonomyLevel;
  return DEFAULT_AUTONOMY_LEVEL;
}

export interface AutonomyVerdict {
  allowed: boolean;
  level: AutonomyLevel;
  reason: string;
}

/**
 * May the orchestrator dispatch this effect class unattended?
 *
 * Note what is NOT consulted here: whether an approval happens to exist. That
 * is deliberate. This answers "is unattended dispatch of this CLASS of work
 * permitted at all", and the approval gate in lib/fabric/envelope.ts answers
 * "is this specific action authorized". Two independent questions, both
 * required, and folding them together would let a stale approval widen the
 * autonomy level.
 */
export function mayAutonomouslyDispatch(
  effectClass: CapabilityEffectClass | 'MODEL',
  env: NodeJS.ProcessEnv = process.env,
): AutonomyVerdict {
  const level = resolveAutonomyLevel(env);

  if (level === 'MANUAL') {
    return { allowed: false, level, reason: 'Autonomy level is MANUAL — the orchestrator dispatches nothing unattended.' };
  }

  if (effectClass === 'EXTERNAL_ACTION') {
    if (level === 'APPROVAL_GATED_EXTERNAL') {
      return {
        allowed: true,
        level,
        reason: 'APPROVAL_GATED_EXTERNAL permits PREPARING an external action. The envelope still requires Guardian plus a single-use human approval before anything leaves SynthOS.',
      };
    }
    return {
      allowed: false,
      level,
      reason: `Autonomy level is ${level}, which refuses unattended dispatch of EXTERNAL_ACTION outright. Raise it to APPROVAL_GATED_EXTERNAL to let the orchestrator prepare external work and stop at the approval gate.`,
    };
  }

  // READ / COMPUTE / INTERNAL_MUTATION / CONTROL, and plain model work.
  return { allowed: true, level, reason: `Autonomy level ${level} permits unattended ${effectClass} work.` };
}
