// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 7: the canonical scheduling layer.
//
// The scheduler ONLY decides WHEN to invoke. It never calls Gemini, GitHub,
// Vault, Windmill, MCP, or Hermes directly, and never signs a receipt —
// every real occurrence is a plain call to executeEnvelope() (the same
// canonical dispatcher Jarvis/graphs/actions already use), which is what
// decides WHAT and HOW to execute, including every Guardian/approval check.
// This file is not a second execution engine; it is the thing that decides
// a due ExecutionEnvelopeInput and hands it to the one that already exists.
//
// Concurrency: reuses the exact atomic-claim mechanism proven in Step 6
// (execution_claims, via executeEnvelope's idempotencyKey) — there is no
// second idempotency system here. A scheduled occurrence's identity is
// `schedule:{scheduleId}:{dueAt}`, deterministic from the schedule id and
// the exact due instant, so two overlapping ticks (or a duplicate manual
// trigger) that both reach the SAME due occurrence collide on the SAME real
// claim row and produce exactly one real execution — proven in
// test/scheduler.test.ts.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import {
  createSchedule,
  getSchedule,
  listDueSchedules,
  setScheduleStatus,
  updateScheduleAfterOccurrence,
  recordScheduleOccurrence,
  type ScheduleRecord,
  type ScheduleStatus,
  type ScheduleRecurrenceType,
} from '../persistence';
import { resolveCapability } from './registry';
import { classifyIntent } from './intent';
import { executeEnvelope, type ExecutionEnvelopeResult, type EnvelopeOutcome, EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE } from './envelope';
// PUSH 2A — the durable external-execution sweep. Deliberately imported into
// the EXISTING tick rather than given a timer of its own: this file's header
// already claims to own "the ONE real in-process poll loop", and a second
// timer would make that false. The sweep's own durability comes from the
// ledger, not from this loop — see lib/external-executions.ts.
import { advanceDueExternalExecutions, type SweepResult } from '../external-executions';

// ---------------------------------------------------------------------------
// Time-phrase parsing. Deterministic, regex-based — no model call, so
// scheduling itself costs nothing and never guesses (R3/R4 cost discipline;
// CLAUDE.md "explain costs" applies literally here: this step is free).
//
// SCOPE, stated honestly rather than silently: only ONE_TIME ("in N
// minutes/hours", "tomorrow at H(:MM)? am/pm") and fixed-INTERVAL ("every N
// minute/hour/day(s)") recurrence are supported. Weekday/local-time
// recurrence ("every Monday") is NOT implemented — it needs real DST-aware
// timezone math this repo has no dependency for, and half-building it would
// be worse than refusing honestly. A weekday-cadence request returns an
// ambiguous/clarification result, never a silently-wrong schedule.
// ---------------------------------------------------------------------------

export interface ParsedOneTimeSchedule {
  recurrenceType: 'ONCE';
  nextRunAt: string; // ISO instant, UTC
  matchedPhrase: string;
}

export interface ParsedIntervalSchedule {
  recurrenceType: 'INTERVAL';
  intervalSeconds: number;
  nextRunAt: string; // ISO instant, UTC — the first future occurrence
  matchedPhrase: string;
}

export type ParsedSchedule = ParsedOneTimeSchedule | ParsedIntervalSchedule;

export interface AmbiguousSchedule {
  ambiguous: true;
  reason: string;
}

const WEEKDAY_PATTERN = /\bevery\s+(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)(day)?\b/i;
// STEP 8 — narrowly-scoped hedging-word tolerance ("in approximately 1
// minute", "every about 2 hours"). A non-capturing, purely optional filler
// between the keyword and the number — it never changes what's computed
// (still exactly N minutes/hours from now, never a fuzzy range), so this
// stays fully deterministic; it just tolerates one specific class of real
// phrasing the original pattern rejected outright.
const HEDGE = '(?:approximately|about|around)?\\s*';
const IN_DURATION_PATTERN = new RegExp(`\\bin\\s+${HEDGE}(\\d+)\\s+(minute|hour|day)s?\\b`, 'i');
const TOMORROW_AT_PATTERN = /\btomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const BARE_TOMORROW_PATTERN = /\btomorrow\b/i;
const EVERY_N_PATTERN = new RegExp(`\\bevery\\s+${HEDGE}(\\d+)\\s+(minute|hour|day)s?\\b`, 'i');
const EVERY_BARE_PATTERN = /\bevery\s+(minute|hour|day)\b/i;

const UNIT_SECONDS: Record<string, number> = { minute: 60, hour: 3600, day: 86400 };

/**
 * Timezone policy (audited: no workspace/user timezone data exists anywhere
 * in this repo — checked schemas for `workspaces`, `users`; grepped for
 * "timezone"/"timeZone" repo-wide, zero hits). Default/fallback: UTC.
 * next_run_at is always a canonical UTC instant; INTERVAL recurrence is a
 * pure duration, so DST never applies to it. ONE_TIME "tomorrow at H" is
 * resolved as H:00 UTC on tomorrow's UTC date — stated explicitly in the
 * confirmation text so nothing is silently wrong (never claim a local time
 * this deployment cannot actually know).
 */
export function parseSchedulePhrase(rawText: string, nowIso: string): ParsedSchedule | AmbiguousSchedule {
  const text = rawText || '';
  const now = new Date(nowIso);

  if (WEEKDAY_PATTERN.test(text)) {
    return {
      ambiguous: true,
      reason: 'Weekday/local-time recurring schedules (e.g. "every Monday") are not supported yet — only one-time ("in 10 minutes", "tomorrow at 9am") and fixed-interval ("every 2 hours") recurring schedules are. Please rephrase using one of those forms.',
    };
  }

  const inMatch = text.match(IN_DURATION_PATTERN);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2].toLowerCase();
    const seconds = n * UNIT_SECONDS[unit];
    return { recurrenceType: 'ONCE', nextRunAt: new Date(now.getTime() + seconds * 1000).toISOString(), matchedPhrase: inMatch[0] };
  }

  const tomorrowAtMatch = text.match(TOMORROW_AT_PATTERN);
  if (tomorrowAtMatch) {
    let hour = parseInt(tomorrowAtMatch[1], 10);
    const minute = tomorrowAtMatch[2] ? parseInt(tomorrowAtMatch[2], 10) : 0;
    const meridiem = tomorrowAtMatch[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) {
      return { ambiguous: true, reason: `"${tomorrowAtMatch[0]}" is not a valid time — refusing rather than guessing.` };
    }
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, hour, minute, 0, 0));
    return { recurrenceType: 'ONCE', nextRunAt: tomorrow.toISOString(), matchedPhrase: tomorrowAtMatch[0] };
  }

  if (BARE_TOMORROW_PATTERN.test(text)) {
    // "tomorrow" with no time is genuinely ambiguous — what time tomorrow?
    // Refuse rather than invent a default hour.
    return { ambiguous: true, reason: '"tomorrow" has no time attached — please specify a time (e.g. "tomorrow at 9am").' };
  }

  const everyNMatch = text.match(EVERY_N_PATTERN);
  if (everyNMatch) {
    const n = parseInt(everyNMatch[1], 10);
    const unit = everyNMatch[2].toLowerCase();
    if (n <= 0) return { ambiguous: true, reason: `"${everyNMatch[0]}" is not a valid recurring interval.` };
    const intervalSeconds = n * UNIT_SECONDS[unit];
    return { recurrenceType: 'INTERVAL', intervalSeconds, nextRunAt: new Date(now.getTime() + intervalSeconds * 1000).toISOString(), matchedPhrase: everyNMatch[0] };
  }

  const everyBareMatch = text.match(EVERY_BARE_PATTERN);
  if (everyBareMatch) {
    const unit = everyBareMatch[1].toLowerCase();
    const intervalSeconds = UNIT_SECONDS[unit];
    return { recurrenceType: 'INTERVAL', intervalSeconds, nextRunAt: new Date(now.getTime() + intervalSeconds * 1000).toISOString(), matchedPhrase: everyBareMatch[0] };
  }

  return { ambiguous: true, reason: 'No recognizable time phrase found — please say when (e.g. "in 10 minutes", "tomorrow at 9am", "every 2 hours").' };
}

/**
 * Catch-up policy for INTERVAL schedules (restart/resume). Chosen: skip
 * missed occurrences and fast-forward to the next FUTURE instant — never
 * fire once per missed interval. If `fromIso` is already in the future,
 * returns it unchanged (nothing to catch up).
 */
export function computeNextIntervalRun(fromIso: string, intervalSeconds: number, nowIso: string): string {
  const from = new Date(fromIso).getTime();
  const now = new Date(nowIso).getTime();
  const intervalMs = intervalSeconds * 1000;
  if (now < from) return fromIso;
  const elapsed = now - from;
  const missedIntervals = Math.floor(elapsed / intervalMs) + 1;
  return new Date(from + missedIntervals * intervalMs).toISOString();
}

export function deriveScheduleOccurrenceIdempotencyKey(scheduleId: string, dueAtIso: string): string {
  return `schedule:${scheduleId}:${dueAtIso}`;
}

function occurrenceStatusFromOutcome(outcome: EnvelopeOutcome): 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'NOT_CONFIGURED' {
  if (outcome === 'SUCCESS' || outcome === 'READ_OK') return 'SUCCEEDED';
  if (outcome === 'FAILED') return 'FAILED';
  if (outcome === 'NOT_CONFIGURED') return 'NOT_CONFIGURED';
  // BLOCKED, APPROVAL_REQUIRED, CONFLICT — all "this occurrence did not run", none fabricated as success.
  return 'BLOCKED';
}

/**
 * The one real "make this schedule real" step, shared by the REST create
 * route and Jarvis's NL schedule path. Deterministic capability/Guardian
 * gating happens ONCE, here, at creation time for structural conditions
 * (unregistered capability, EXTERNAL_ACTION without Guardian enforcement)
 * that will never resolve themselves — a transient condition (NOT_CONFIGURED
 * because a key/adapter is missing right now) is deliberately NOT
 * terminal here: the schedule is created ACTIVE and the real, current
 * capability status is re-checked honestly on every real occurrence
 * (Section 7's rule runs identically inside executeEnvelope regardless of
 * caller), so a capability that becomes available later just starts
 * succeeding on its own next tick — no manual re-activation needed.
 */
export async function createValidatedSchedule(params: {
  workspaceId: string;
  actorUserId: string;
  capability: string;
  action: string;
  parameters: Record<string, unknown>;
  rawText: string;
  parsed: ParsedSchedule;
}): Promise<ScheduleRecord> {
  const scheduleId = `sched-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const cap = await resolveCapability(params.capability);

  let status: ScheduleStatus = 'ACTIVE';
  let statusReason: string | null = null;
  let nextRunAt: string | null = params.parsed.nextRunAt;

  // Precedence deliberately mirrors executeEnvelope()'s own check order:
  // NOT_CONFIGURED/UNSUPPORTED (and "not registered at all") are treated as
  // POSSIBLY TRANSIENT — the schedule is still created ACTIVE, and each
  // real occurrence honestly re-checks and reports the current status
  // (Section 7 rule G — "run Hermes check every hour" must keep ticking
  // and simply reporting NOT_CONFIGURED until Hermes exists, never
  // permanently BLOCKED for a condition that might resolve on its own).
  // Only a capability that EXISTS, IS reachable, and is STRUCTURALLY an
  // EXTERNAL_ACTION without Guardian enforcement is refused eagerly here —
  // that condition needs a code change to ever become true, so eagerly
  // blocking it (rather than ticking forever for nothing) is the honest
  // choice, and it is the exact same rule executeEnvelope enforces for a
  // direct (non-scheduled) call — scheduling must never be a way around it.
  if (
    cap &&
    cap.status !== 'NOT_CONFIGURED' &&
    cap.status !== 'UNSUPPORTED' &&
    cap.effectClass === 'EXTERNAL_ACTION' &&
    cap.approvalPolicy !== 'GUARDIAN_ENFORCED' &&
    !EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.has(cap.key) // STEP 8 — imports the real set from envelope.ts; no longer a hand-synced duplicate
  ) {
    status = 'BLOCKED';
    statusReason = `"${cap.key}" is an external action without real, wired Guardian enforcement (approvalPolicy: ${cap.approvalPolicy}) — refusing to schedule it rather than executing on advisory policy alone, same rule the envelope enforces for direct calls.`;
    nextRunAt = null;
  }

  return createSchedule({
    scheduleId,
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    capability: params.capability,
    action: params.action,
    parameters: params.parameters,
    rawText: params.rawText,
    recurrenceType: params.parsed.recurrenceType,
    intervalSeconds: params.parsed.recurrenceType === 'INTERVAL' ? params.parsed.intervalSeconds : null,
    nextRunAt,
    status,
    statusReason,
  });
}

/**
 * Parses the WHEN out of Jarvis's raw text, re-classifies whatever text
 * remains to find the WHAT (reusing classifyIntent — no second classifier),
 * and creates the schedule. Returns an envelope-shaped result so server.ts's
 * existing ACTION_REQUEST branch needs no special-casing.
 */
export async function executeScheduleFromNaturalLanguage(input: {
  workspaceId: string;
  actorUserId: string;
  rawText: string;
}): Promise<ExecutionEnvelopeResult & { schedule?: ScheduleRecord }> {
  const nowIso = new Date().toISOString();
  const parsed = parseSchedulePhrase(input.rawText, nowIso);

  if ('ambiguous' in parsed) {
    return { outcome: 'BLOCKED', capability: 'schedule', reason: parsed.reason };
  }

  // Strip the matched time phrase so the WHAT is classified from the
  // remaining text, not re-triggering the schedule pattern itself.
  const remainingText = input.rawText.replace(parsed.matchedPhrase, '').replace(/\s{2,}/g, ' ').trim();
  const whatClassification = await classifyIntent(remainingText || input.rawText);

  // "publish this every Monday"-shaped: a real consequential external
  // action classifyIntent already flags as approval-shaped, independent of
  // timing. Checked BEFORE the generic no-capability refusal below (this
  // is more specific and accurate than "could not determine what to
  // schedule" — PUBLISH_PATTERN maps to capability: null on purpose).
  if (whatClassification.intentType === 'APPROVAL_REQUIRED_ACTION') {
    return { outcome: 'APPROVAL_REQUIRED', capability: 'schedule', reason: whatClassification.reason };
  }

  // Destructive / no real action named at all — refuse outright, never
  // create a schedule row for something with no real capability to store.
  if (whatClassification.intentType === 'BLOCKED_ACTION' || !whatClassification.capability) {
    return {
      outcome: 'BLOCKED',
      capability: 'schedule',
      reason: whatClassification.capability
        ? whatClassification.reason
        : `Could not determine what to schedule from "${remainingText || input.rawText}" — please name a real action (e.g. "research ...", "save ... to the Vault").`,
    };
  }

  const schedule = await createValidatedSchedule({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    capability: whatClassification.capability,
    action: whatClassification.action,
    parameters: whatClassification.parameters,
    rawText: remainingText || input.rawText,
    parsed,
  });

  return {
    outcome: schedule.status === 'ACTIVE' ? 'SUCCESS' : 'BLOCKED',
    capability: 'schedule',
    reason: schedule.status === 'ACTIVE'
      ? `Scheduled "${schedule.capability}" — ${schedule.recurrence_type === 'ONCE' ? `runs once at ${schedule.next_run_at} (UTC)` : `runs every ${schedule.interval_seconds}s, first at ${schedule.next_run_at} (UTC)`}.`
      : (schedule.status_reason || 'Schedule created but will not run.'),
    schedule,
  };
}

/**
 * Fires exactly one due occurrence through the canonical fabric. Never
 * calls a provider/tool itself — executeEnvelope() does, and only if this
 * call actually wins the atomic claim (see the module header). An
 * IN_PROGRESS result means another tick already owns this occurrence;
 * this call does nothing further (no occurrence row, no schedule update)
 * so exactly one caller ever advances schedule state per occurrence.
 */
export async function fireScheduleOccurrence(schedule: ScheduleRecord, dueAtIso: string): Promise<void> {
  const idempotencyKey = deriveScheduleOccurrenceIdempotencyKey(schedule.schedule_id, dueAtIso);
  const result = await executeEnvelope({
    workspaceId: schedule.workspace_id,
    actorUserId: schedule.actor_user_id,
    capability: schedule.capability,
    action: schedule.action,
    parameters: JSON.parse(schedule.parameters_json || '{}'),
    rawText: schedule.raw_text,
    idempotencyKey,
  });

  if (result.outcome === 'IN_PROGRESS') return;

  const nowIso = new Date().toISOString();
  const occurrenceStatus = occurrenceStatusFromOutcome(result.outcome);

  recordScheduleOccurrence({
    scheduleId: schedule.schedule_id,
    workspaceId: schedule.workspace_id,
    dueAt: dueAtIso,
    idempotencyKey,
    status: occurrenceStatus,
    outcome: result.outcome,
    reason: result.reason,
    taskId: result.taskId ?? null,
    artifactId: result.artifact?.id ?? null,
    receiptId: result.receipt?.receiptId ?? null,
  });

  if (schedule.recurrence_type === 'ONCE') {
    const terminal: ScheduleStatus =
      occurrenceStatus === 'SUCCEEDED' ? 'COMPLETED' :
      occurrenceStatus === 'FAILED' ? 'FAILED' :
      occurrenceStatus === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'BLOCKED';
    updateScheduleAfterOccurrence(schedule.schedule_id, { status: terminal, statusReason: result.reason, nextRunAt: null, lastRunAt: nowIso });
    return;
  }

  // INTERVAL — stays ACTIVE regardless of this occurrence's outcome. A
  // NOT_CONFIGURED/BLOCKED/FAILED occurrence is not a retry loop: it is
  // simply this occurrence's honest result, and the schedule advances to
  // its next REGULAR due time exactly as it would after a success.
  const nextRunAt = computeNextIntervalRun(dueAtIso, schedule.interval_seconds!, nowIso);
  updateScheduleAfterOccurrence(schedule.schedule_id, { status: 'ACTIVE', statusReason: result.reason, nextRunAt, lastRunAt: nowIso });
}

/** The tick body. Exported so tests call it directly — no real timer needed to prove correctness. */
export async function runDueSchedules(nowIso: string = new Date().toISOString()): Promise<{ processed: number }> {
  const due = listDueSchedules(nowIso);
  for (const schedule of due) {
    await fireScheduleOccurrence(schedule, schedule.next_run_at!);
  }
  return { processed: due.length };
}

/**
 * PUSH 2A — one full tick: due schedules, then due external executions.
 *
 * Two independent units of work on ONE loop. Kept as separate exported
 * functions so each is testable alone, and so a failure in one can never
 * silently stop the other (the sweep is isolated below).
 */
export async function runSchedulerTick(nowIso: string = new Date().toISOString()): Promise<{ processed: number; sweep: SweepResult }> {
  const processed = await runDueSchedules(nowIso);
  let sweep: SweepResult = { examined: 0, advanced: 0, ingested: 0, errors: 0 };
  try {
    sweep = await advanceDueExternalExecutions(nowIso);
  } catch (err) {
    // A sweep failure must never take schedules down with it.
    // eslint-disable-next-line no-console
    console.error('[scheduler] external-execution sweep failed:', err instanceof Error ? err.message : String(err));
    sweep = { examined: 0, advanced: 0, ingested: 0, errors: 1 };
  }
  return { processed: processed.processed, sweep };
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** Registers the ONE real in-process poll loop for schedules. Idempotent — calling twice does not start a second timer. */
export function startScheduler(intervalMs = 10000): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    runSchedulerTick().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[scheduler] tick failed:', err);
    });
  }, intervalMs);
  schedulerTimer.unref?.();
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

/** Resume policy: identical to restart catch-up (one policy, not two — see module header). Recomputes next_run_at from "now" rather than trusting a possibly-stale value computed before the pause. */
export function computeResumeNextRunAt(schedule: ScheduleRecord, nowIso: string): string | null {
  if (schedule.recurrence_type === 'ONCE') {
    // A missed one-time schedule still runs once on resume — there is only
    // ever one occurrence to catch up on, so "skip" would mean it silently
    // never runs, which this deployment's honesty rules do not allow.
    if (!schedule.next_run_at) return null;
    return new Date(schedule.next_run_at) < new Date(nowIso) ? nowIso : schedule.next_run_at;
  }
  if (!schedule.next_run_at || !schedule.interval_seconds) return schedule.next_run_at;
  return computeNextIntervalRun(schedule.next_run_at, schedule.interval_seconds, nowIso);
}
