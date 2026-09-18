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

import { isDraining, beginDraining, waitForNoExecutions, inFlightExecutions } from '../runtime-lifecycle';
import { settleInterruptedAtShutdown, type ShutdownSettlement } from '../continuity/orphans';
import { recordRuntimeEvent } from '../runtime-events';
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
// The durable external-execution sweep. Imported into the EXISTING tick
// rather than given a timer of its own: this file owns "the ONE real
// in-process poll loop", and a second timer would make that false. The
// sweep's own durability comes from the ledger, not from this loop — see
// lib/external-executions.ts.
import { advanceDueExternalExecutions } from '../external-executions';

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
 * The second thing the one timer does: advance external executions whose
 * remote job may have moved on, including ones that finished while SynthOS
 * was not watching.
 *
 * This is NOT a second scheduler and NOT a dispatch path. It submits nothing
 * and creates no work — it reads rows the ledger already owns, takes a poll
 * lease on each, and asks the provider what happened through the same
 * refresh/ingest pair the UI uses. There is exactly one such sweep
 * (advanceDueExternalExecutions); an earlier parallel reconciliation sweep
 * over the same columns was removed when the two lines were integrated.
 *
 * Kept as its own exported function, and deliberately isolated from
 * runDueSchedules in the tick below, because a provider outage must not stop
 * scheduled work from dispatching. They share a timer, not a fate.
 */
export async function runExternalExecutionReconciliation(nowIso: string = new Date().toISOString()): Promise<{ considered: number; advanced: number; ingested: number; errors: number }> {
  const sweep = await advanceDueExternalExecutions(nowIso);
  if (sweep.ingested > 0 || sweep.errors > 0) {
    // eslint-disable-next-line no-console
    console.log(`[reconcile] examined=${sweep.examined} advanced=${sweep.advanced} ingested=${sweep.ingested} errors=${sweep.errors}`);
  }
  return { considered: sweep.examined, advanced: sweep.advanced, ingested: sweep.ingested, errors: sweep.errors };
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// TICK MODULES ARE LOADED ONCE, AND EVERY TICK AWAITS THAT ONE LOAD.
//
// The tick reaches several modules lazily (dynamic import) because they sit
// on real import cycles back to this file (scheduler → orchestrator →
// envelope → scheduler; scheduler → registry → runtime-status → scheduler).
// Issuing a NEW import() on every tick was the defect behind
// "Cannot access 'health' before initialization": while the first import of
// the orchestrator was still loading its graph, a later tick imported it
// again; the module runner saw the cycle and handed that tick the module's
// UNFINISHED exports — a hoisted function whose module-level `const health`
// had not run yet. One shared promise per module means no tick can observe a
// module before its single evaluation completes. A load that fails stays
// failed (the rejection is kept), so every tick reports it — fail closed,
// never silently retried into a half-initialised module.
// ---------------------------------------------------------------------------
const tickModules = new Map<string, Promise<any>>();
function loadTickModule<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = tickModules.get(key) as Promise<T> | undefined;
  if (!p) { p = load(); tickModules.set(key, p); }
  return p;
}

// Every promise chain a tick starts is tracked until it settles, so a drain
// can wait for the scheduler's own background work (orchestrated tasks,
// scheduled envelopes, reconciliation) instead of exiting underneath it.
const tickWork = new Set<Promise<unknown>>();
function trackTick(p: Promise<unknown>): void {
  tickWork.add(p);
  p.finally(() => tickWork.delete(p)).catch(() => {});
}

export interface DrainReport {
  startedAt: string;
  finishedAt: string;
  timeoutMs: number;
  settledWithinTimeout: boolean;
  outstandingAtTimeout: Array<{ taskId: string; kind: string; startedAt: string }>;
  settlement: ShutdownSettlement;
}

/**
 * THE drain, called by the service's shutdown path. In order:
 *   1. DRAINING (lifecycle flag + an appended SERVICE_LIFECYCLE event) —
 *      from here the kernel starts no task, the orchestrator claims none,
 *      the spend guard sends no request and this scheduler neither ticks
 *      nor re-arms;
 *   2. stop the timer;
 *   3. wait — bounded by timeoutMs — for the tick's own work and for every
 *      execution already in flight;
 *   4. settle whatever did not finish, durably and from evidence
 *      (settleInterruptedAtShutdown): never-sent reservations released,
 *      sent-but-unanswered calls UNKNOWN (never retried), interrupted tasks
 *      resumable or RECONCILING;
 *   5. an appended DRAINED event with the report.
 * Only then may the process exit.
 */
export async function drainAndSettle(opts: { timeoutMs: number; actor: string; processStartedAt?: string }): Promise<DrainReport> {
  const startedAt = new Date().toISOString();
  beginDraining(opts.actor);
  try { recordRuntimeEvent({ eventType: 'SERVICE_LIFECYCLE', targetType: 'service', targetId: 'synthos-admin', status: 'RUNNING', detail: { state: 'DRAINING', actor: opts.actor, inFlight: inFlightExecutions() } }); } catch { /* evidence only */ }
  stopScheduler();
  const deadline = Date.now() + Math.max(0, opts.timeoutMs);
  const ticks = Promise.allSettled([...tickWork]);
  const execs = waitForNoExecutions(Math.max(0, opts.timeoutMs));
  const all = await Promise.race([
    Promise.all([ticks, execs]).then(([, e]) => e),
    new Promise<{ settled: boolean; outstanding: ReturnType<typeof inFlightExecutions> }>((r) => setTimeout(() => r({ settled: false, outstanding: inFlightExecutions() }), Math.max(0, deadline - Date.now()))),
  ]);
  const outstanding = inFlightExecutions();
  const settlement = settleInterruptedAtShutdown({ actor: opts.actor, processStartedAt: opts.processStartedAt });
  const report: DrainReport = { startedAt, finishedAt: new Date().toISOString(), timeoutMs: opts.timeoutMs, settledWithinTimeout: all.settled && outstanding.length === 0, outstandingAtTimeout: outstanding, settlement };
  try { recordRuntimeEvent({ eventType: 'SERVICE_LIFECYCLE', targetType: 'service', targetId: 'synthos-admin', status: report.settledWithinTimeout ? 'SUCCESS' : 'TIMEOUT', detail: { state: 'DRAINED', ...report } }); } catch { /* evidence only */ }
  return report;
}


/**
 * How often the model catalog is refreshed from provider metadata. Provider
 * line-ups move on the order of weeks, so six hours is frequent enough to
 * notice a new or retired model and infrequent enough to be nearly free.
 */

/** Pricing refresh cadence. Well inside the 72h staleness limit, so one or two failed refreshes do not block spending. */

// Set at start so the scheduler's first refresh is 12h after the startup refresh in server.ts, not a duplicate of it.


/** Epoch of the last catalog refresh attempt. 0 so the first tick runs one. */


// ---------------------------------------------------------------------------
// ALWAYS-ON RUNTIME — the scheduler's own liveness, recorded rather than
// claimed.
//
// Before this, "the scheduler is running" was unobservable from outside the
// module: `schedulerTimer` is a private, unref'd handle, so nothing — not the
// status aggregator, not an operator, not a test — could distinguish a
// process whose poll loop is genuinely ticking from one whose timer was
// never armed or has been throwing on every tick since startup.
//
// That matters specifically because the loop is unref'd and every tick
// swallows its own error: a permanently failing scheduler keeps the process
// alive and healthy-looking while dispatching nothing at all.
//
// Everything here is a record of something that actually happened. No field
// is derived from configuration, and `lastTickAt` is only ever set by a tick
// that really ran, so a stale timestamp is real evidence of a stalled loop
// instead of being indistinguishable from a fresh one.
// ---------------------------------------------------------------------------

export interface SchedulerHealth {
  /** True only while a real interval timer is armed in THIS process. */
  running: boolean;
  /** Poll interval of the armed timer, or null when not running. */
  intervalMs: number | null;
  /** When startScheduler() actually armed the timer. */
  startedAt: string | null;
  /** Ticks that have begun since this process started. */
  ticks: number;
  /** Ticks that fired while the service was DRAINING and therefore claimed nothing. */
  drainRefusedTicks: number;
  /** RUNNING or DRAINING (lib/runtime-lifecycle.ts), read live. */
  lifecycle: 'RUNNING' | 'DRAINING';
  /** When the most recent tick began — null until one has. */
  lastTickAt: string | null;
  /** Schedules dispatched by the most recent successfully completed tick. */
  lastTickProcessed: number | null;
  /** Ticks that threw. A ticking-but-always-failing loop is not healthy. */
  tickErrors: number;
  /** The most recent tick error, or null if no tick has ever failed. */
  lastTickError: { at: string; message: string } | null;
  /** When the external-execution reconciliation sweep last completed. */
  lastReconcileAt: string | null;
  /** Rows the most recent sweep considered. */
  lastReconcileConsidered: number | null;
  /** Sweeps that threw. Tracked apart from tickErrors: a provider outage is not a scheduler fault. */
  reconcileErrors: number;
  /** NO-COPY/PASTE ORCHESTRATION — tracked apart for the same reason: an orchestration failure is not a scheduler fault. */
  lastOrchestrationAt: string | null;
  lastOrchestrationAdvanced: number | null;
  orchestrationErrors: number;
  lastOrchestrationError: { at: string; message: string } | null;
  /** Model catalog sync — metadata only, no generation tokens. */
  lastCatalogRefreshAt: string | null;
  lastCatalogRefreshStale: boolean;
  lastCatalogRefreshError: { at: string; message: string } | null;
  lastReconcileError: { at: string; message: string } | null;
}

const schedulerHealth: SchedulerHealth = {
  running: false,
  intervalMs: null,
  startedAt: null,
  ticks: 0,
  drainRefusedTicks: 0,
  lifecycle: 'RUNNING',
  lastTickAt: null,
  lastTickProcessed: null,
  tickErrors: 0,
  lastTickError: null,
  lastReconcileAt: null,
  lastReconcileConsidered: null,
  reconcileErrors: 0,
  lastReconcileError: null,
  lastOrchestrationAt: null,
  lastOrchestrationAdvanced: null,
  orchestrationErrors: 0,
  lastOrchestrationError: null,
  lastCatalogRefreshAt: null,
  lastCatalogRefreshStale: false,
  lastCatalogRefreshError: null,
};

/** The scheduler's real, recorded liveness in this process. Never a configuration read. */
export function getSchedulerHealth(): SchedulerHealth {
  return { ...schedulerHealth, lifecycle: isDraining() ? 'DRAINING' : 'RUNNING', lastTickError: schedulerHealth.lastTickError ? { ...schedulerHealth.lastTickError } : null };
}

/** Test-only reset so one file's counters can't leak into another's assertions. */
export function resetSchedulerHealthForTests(): void {
  schedulerHealth.running = false;
  schedulerHealth.intervalMs = null;
  schedulerHealth.startedAt = null;
  schedulerHealth.ticks = 0;
  schedulerHealth.drainRefusedTicks = 0;
  schedulerHealth.lastTickAt = null;
  schedulerHealth.lastTickProcessed = null;
  schedulerHealth.tickErrors = 0;
  schedulerHealth.lastTickError = null;
  schedulerHealth.lastReconcileAt = null;
  schedulerHealth.lastReconcileConsidered = null;
  schedulerHealth.reconcileErrors = 0;
  schedulerHealth.lastReconcileError = null;
  schedulerHealth.lastOrchestrationAt = null;
  schedulerHealth.lastOrchestrationAdvanced = null;
  schedulerHealth.orchestrationErrors = 0;
  schedulerHealth.lastOrchestrationError = null;
}

/** Registers the ONE real in-process poll loop for schedules. Idempotent — calling twice does not start a second timer. */
export function startScheduler(intervalMs = 10000): void {
  if (schedulerTimer) return;
  // A draining service never re-arms: it is on its way out.
  if (isDraining()) return;
  schedulerTimer = setInterval(() => {
    // DRAINING: claim no new work. (stopScheduler also clears the timer; this
    // covers a tick already queued when the drain began.)
    if (isDraining()) { schedulerHealth.drainRefusedTicks += 1; return; }
    schedulerHealth.ticks += 1;
    schedulerHealth.lastTickAt = new Date().toISOString();
    trackTick(runDueSchedules()
      .then((result) => {
        schedulerHealth.lastTickProcessed = result.processed;
      })
      .catch((err) => {
        schedulerHealth.tickErrors += 1;
        schedulerHealth.lastTickError = { at: new Date().toISOString(), message: err?.message || String(err) };
        // eslint-disable-next-line no-console
        console.error('[scheduler] tick failed:', err);
      }));

    // NO-COPY/PASTE ORCHESTRATION — the third thing this ONE timer drives.
    //
    // Added here rather than on a timer of its own, for the reason the comment
    // below already gives about reconciliation: a second interval would be a
    // second scheduler, with its own lifecycle to start, stop, health-check
    // and get wrong. Three independent promise chains on one timer share a
    // heartbeat and nothing else — an orchestration failure must not stop
    // scheduled work from dispatching, and vice versa.
    //
    // It is also why the tick is bounded (maxTasks: 3). An unbounded queue
    // drain would hold the timer past its own interval and the next tick would
    // overlap itself, which is how a task storm starts.
    // Lazily imported, NOT a top-level import, and the reason is a real cycle:
    // scheduler -> orchestrator -> envelope -> scheduler (the envelope needs
    // createValidatedSchedule for schedule.create_internal). ESM tolerates
    // that cycle but can hand back a binding that is still undefined at module
    // evaluation time, which would fail only at the first tick. A dynamic
    // import inside the callback resolves after both modules are fully
    // initialised — the same technique lib/model-credentials.ts already uses
    // to reach the provider adapters.
    // MODEL CATALOG / PRICING — deliberately NOT driven by this timer.
    //
    // They used to be time-gated refreshes (every 6h / 12h). That is a
    // recurring outbound connection whose only purpose is to notice new
    // models or prices. The model registry (lib/registry) is populated from
    // versioned manifests instead; discovery and pricing refresh exist only as
    // manual, audited Admin operations that are OFF by default.

    // SPEND — crash recovery for the usage ledger. A synchronous paid call left
    // in flight by a process that died becomes UNKNOWN (never auto-retried),
    // freeing its concurrency slot. One UPDATE; no provider call.
    trackTick(loadTickModule('spend/ledger', () => import('../spend/ledger'))
      .then((m) => m.reconcileStaleUsage())
      .catch(() => { /* bookkeeping must never stop scheduled work */ }));

    // CONTINUITY — paused tasks whose condition cleared go back to READY (a
    // routing preview; nothing dispatched here). ROUTE REFRESH — metadata
    // only, and a no-op unless an operator switched it on (OFF by default).
    trackTick(loadTickModule('continuity/resume', () => import('../continuity/resume'))
      .then((m) => m.continuityTickForScheduler())
      .catch(() => { /* bookkeeping must never stop scheduled work */ }));
    trackTick(loadTickModule('registry/route-import', () => import('../registry/route-import'))
      .then((m) => m.routeRefreshTickForScheduler())
      .catch(() => { /* a refresh failure marks the route STALE; it never stops the tick */ }));

    // AUTHORITY RECORD — sign each moved workspace's chain head at most once a
    // day (throttled to one sweep an hour). Local database work only.
    trackTick(loadTickModule('authority-ledger', () => import('../authority-ledger'))
      .then((m) => m.authorityTickForScheduler())
      .catch(() => { /* bookkeeping must never stop scheduled work */ }));

    trackTick(loadTickModule('orchestrator', () => import('./orchestrator'))
      .then((m) => m.orchestrationTickForScheduler())
      .then((result) => {
        if (result) {
          schedulerHealth.lastOrchestrationAt = new Date().toISOString();
          schedulerHealth.lastOrchestrationAdvanced = result.steps.filter((x) => x.outcome === 'ADVANCED').length;
        }
      })
      .catch((err) => {
        schedulerHealth.orchestrationErrors += 1;
        schedulerHealth.lastOrchestrationError = { at: new Date().toISOString(), message: err?.message || String(err) };
        // eslint-disable-next-line no-console
        console.error('[orchestration] tick failed:', err);
      }));

    // Separate promise chain on purpose. A provider outage during
    // reconciliation must not be recorded as a SCHEDULER failure, and must
    // not stop scheduled work from dispatching — the two share this timer
    // and nothing else.
    trackTick(runExternalExecutionReconciliation()
      .then((result) => {
        schedulerHealth.lastReconcileAt = new Date().toISOString();
        schedulerHealth.lastReconcileConsidered = result.considered;
      })
      .catch((err) => {
        schedulerHealth.reconcileErrors += 1;
        schedulerHealth.lastReconcileError = { at: new Date().toISOString(), message: err?.message || String(err) };
        // eslint-disable-next-line no-console
        console.error('[reconcile] sweep failed:', err);
      }));
  }, intervalMs);
  schedulerTimer.unref?.();
  schedulerHealth.running = true;
  schedulerHealth.intervalMs = intervalMs;
  schedulerHealth.startedAt = new Date().toISOString();
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  // Counters are deliberately NOT cleared: after a graceful stop the last
  // observed tick is still the truthful record of what this process did.
  schedulerHealth.running = false;
  schedulerHealth.intervalMs = null;
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
