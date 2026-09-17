import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';

// ---------------------------------------------------------------------------
// STEP 7 — the canonical scheduling layer. The scheduler only decides WHEN;
// executeEnvelope() decides WHAT/HOW — every test below proves that boundary
// holds, not just that a timer fires. Zero-cost capabilities (vault.write)
// exercise the mechanism exhaustively; research (paid) is proven live
// against the real :3000 server separately, matching this repo's own
// established convention of never invoking a real paid provider in the
// automated suite (see test/execution-envelope.test.ts deleting
// GEMINI_API_KEY, and Step 6's jarvis-duplicate-submission.test.ts using
// vault.write for the same reason).
// ---------------------------------------------------------------------------

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
isolateVaultForTest('scheduler');
delete process.env.GEMINI_API_KEY;
delete process.env.WINDMILL_BASE_URL;

import {
  parseSchedulePhrase,
  computeNextIntervalRun,
  computeResumeNextRunAt,
  createValidatedSchedule,
  fireScheduleOccurrence,
  runDueSchedules,
  deriveScheduleOccurrenceIdempotencyKey,
  executeScheduleFromNaturalLanguage,
} from '../lib/fabric/scheduler';
import { executeEnvelope } from '../lib/fabric/envelope';
import {
  getSchedule,
  listWorkspaceSchedules,
  isScheduleInWorkspace,
  setScheduleStatus,
  getScheduleOccurrences,
  getDatabase,
  getTaskArtifacts,
} from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { VAULT_ROOT } from '../lib/vault';

const WS = `ws-scheduler-test-${Date.now()}`;
const WS2 = `ws-scheduler-test-other-${Date.now()}`;

beforeAll(() => {
  getDatabase();
  ensureWorkspace(WS, 'Scheduler Test Workspace');
  ensureWorkspace(WS2, 'Scheduler Test Workspace Two');
});

afterAll(() => {
  try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', WS), { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', WS2), { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------------------------------------------------------------------------
// Group A — pure functions. No DB, no timers, fully deterministic.
// ---------------------------------------------------------------------------

describe('parseSchedulePhrase: deterministic, regex-based — never a model call, never invents a time', () => {
  const NOW = '2026-09-08T12:00:00.000Z';

  it('"in 10 minutes" -> ONE_TIME, exactly 10 minutes ahead', () => {
    const result = parseSchedulePhrase('do the thing in 10 minutes', NOW);
    expect('ambiguous' in result).toBe(false);
    if ('ambiguous' in result) return;
    expect(result.recurrenceType).toBe('ONCE');
    expect(result.nextRunAt).toBe('2026-09-08T12:10:00.000Z');
  });

  it('"in 2 hours" -> ONE_TIME, exactly 2 hours ahead', () => {
    const result = parseSchedulePhrase('research this in 2 hours', NOW);
    if ('ambiguous' in result) throw new Error('expected a parsed schedule');
    expect(result.recurrenceType).toBe('ONCE');
    expect(result.nextRunAt).toBe('2026-09-08T14:00:00.000Z');
  });

  it('STEP 8: "in approximately 1 minute" -> ONE_TIME, exactly 1 minute ahead — hedging word is tolerated, never changes what is computed (deterministic, not a fuzzy range)', () => {
    const result = parseSchedulePhrase('research the latest AI agent repos once in approximately 1 minute', NOW);
    if ('ambiguous' in result) throw new Error('expected a parsed schedule');
    expect(result.recurrenceType).toBe('ONCE');
    expect(result.nextRunAt).toBe('2026-09-08T12:01:00.000Z');
  });

  it('STEP 8: "in about 10 minutes" and "in around 10 minutes" parse identically to "in 10 minutes"', () => {
    const bare = parseSchedulePhrase('do it in 10 minutes', NOW);
    const about = parseSchedulePhrase('do it in about 10 minutes', NOW);
    const around = parseSchedulePhrase('do it in around 10 minutes', NOW);
    if ('ambiguous' in bare || 'ambiguous' in about || 'ambiguous' in around) throw new Error('expected all three to parse');
    expect(about.nextRunAt).toBe(bare.nextRunAt);
    expect(around.nextRunAt).toBe(bare.nextRunAt);
  });

  it('STEP 8: "every approximately 2 hours" -> INTERVAL, identical to "every 2 hours"', () => {
    const bare = parseSchedulePhrase('run the check every 2 hours', NOW);
    const hedged = parseSchedulePhrase('run the check every approximately 2 hours', NOW);
    if ('ambiguous' in bare || 'ambiguous' in hedged) throw new Error('expected both to parse');
    if (bare.recurrenceType !== 'INTERVAL' || hedged.recurrenceType !== 'INTERVAL') throw new Error('expected INTERVAL');
    expect(hedged.intervalSeconds).toBe(bare.intervalSeconds);
    expect(hedged.nextRunAt).toBe(bare.nextRunAt);
  });

  it('"tomorrow at 9am" -> ONE_TIME at 09:00 UTC the next day (UTC default policy, since no workspace/user timezone exists anywhere in this repo)', () => {
    const result = parseSchedulePhrase('research the latest AI agent repos tomorrow at 9am', NOW);
    if ('ambiguous' in result) throw new Error('expected a parsed schedule');
    expect(result.recurrenceType).toBe('ONCE');
    expect(result.nextRunAt).toBe('2026-09-09T09:00:00.000Z');
  });

  it('"tomorrow at 9:30pm" -> correctly converts 12-hour PM to 21:30 UTC', () => {
    const result = parseSchedulePhrase('do it tomorrow at 9:30pm', NOW);
    if ('ambiguous' in result) throw new Error('expected a parsed schedule');
    expect(result.nextRunAt).toBe('2026-09-09T21:30:00.000Z');
  });

  it('bare "tomorrow" with no time attached is ambiguous — refuses rather than guessing an hour', () => {
    const result = parseSchedulePhrase('schedule this tomorrow', NOW);
    expect('ambiguous' in result).toBe(true);
    if (!('ambiguous' in result)) return;
    expect(result.reason).toMatch(/no time attached/i);
  });

  it('"every 2 hours" -> INTERVAL, 7200 seconds, first occurrence 2 hours out', () => {
    const result = parseSchedulePhrase('run the check every 2 hours', NOW);
    if ('ambiguous' in result) throw new Error('expected a parsed schedule');
    expect(result.recurrenceType).toBe('INTERVAL');
    if (result.recurrenceType !== 'INTERVAL') return;
    expect(result.intervalSeconds).toBe(7200);
    expect(result.nextRunAt).toBe('2026-09-08T14:00:00.000Z');
  });

  it('"every hour" (no explicit N) -> INTERVAL, 3600 seconds', () => {
    const result = parseSchedulePhrase('run Hermes check every hour', NOW);
    if ('ambiguous' in result) throw new Error('expected a parsed schedule');
    expect(result.recurrenceType).toBe('INTERVAL');
    if (result.recurrenceType !== 'INTERVAL') return;
    expect(result.intervalSeconds).toBe(3600);
  });

  it('"every Monday" (weekday/local-time recurrence) is honestly unsupported — ambiguous, never silently mis-scheduled', () => {
    const result = parseSchedulePhrase('publish this every Monday', NOW);
    expect('ambiguous' in result).toBe(true);
    if (!('ambiguous' in result)) return;
    expect(result.reason).toMatch(/not supported yet/i);
  });

  it('no recognizable time phrase at all -> ambiguous', () => {
    const result = parseSchedulePhrase('research the latest AI agent repos', NOW);
    expect('ambiguous' in result).toBe(true);
  });
});

describe('computeNextIntervalRun: the restart/resume catch-up policy (skip missed occurrences, fast-forward to the next FUTURE instant — never fire once per missed interval)', () => {
  it('not yet due (from is in the future relative to now) -> unchanged', () => {
    const result = computeNextIntervalRun('2026-09-08T13:00:00.000Z', 3600, '2026-09-08T12:00:00.000Z');
    expect(result).toBe('2026-09-08T13:00:00.000Z');
  });

  it('due exactly now -> advances by exactly one interval (never returns a non-future instant)', () => {
    const result = computeNextIntervalRun('2026-09-08T12:00:00.000Z', 3600, '2026-09-08T12:00:00.000Z');
    expect(result).toBe('2026-09-08T13:00:00.000Z');
  });

  it('long outage (10 missed hourly intervals) -> fast-forwards to the next FUTURE hour, never a burst of 10 catch-up runs', () => {
    const from = '2026-09-08T00:00:00.000Z';
    const now = '2026-09-08T10:15:00.000Z'; // 10h15m later, interval=1h
    const result = computeNextIntervalRun(from, 3600, now);
    expect(result).toBe('2026-09-08T11:00:00.000Z'); // next full hour strictly after now, not 00:00 + 10*1h = 10:00 (already past)
    expect(new Date(result).getTime()).toBeGreaterThan(new Date(now).getTime());
  });

  it('DST is structurally a non-issue for INTERVAL recurrence: pure UTC-millisecond duration arithmetic, no local-wall-clock component at all', () => {
    // Spans a real US DST transition date (2026-03-08) — if this were
    // local-wall-clock arithmetic, the interval could silently shift by an
    // hour. It does not, because there is no timezone/local-time input
    // anywhere in this function.
    const result = computeNextIntervalRun('2026-03-08T00:00:00.000Z', 86400, '2026-03-08T00:00:00.000Z');
    expect(result).toBe('2026-03-09T00:00:00.000Z'); // exactly 24h later, not 23h or 25h
  });
});

describe('computeResumeNextRunAt: resume uses the identical catch-up policy as restart — one policy, not two', () => {
  it('ONCE, missed while paused -> runs once, right now (there is only ever one occurrence to catch up on for a one-time schedule; silently dropping it would violate "never fabricate/never silently drop")', () => {
    const schedule: any = { recurrence_type: 'ONCE', next_run_at: '2026-09-08T10:00:00.000Z', interval_seconds: null };
    const result = computeResumeNextRunAt(schedule, '2026-09-08T12:00:00.000Z');
    expect(result).toBe('2026-09-08T12:00:00.000Z');
  });

  it('ONCE, not yet due -> unchanged', () => {
    const schedule: any = { recurrence_type: 'ONCE', next_run_at: '2026-09-08T14:00:00.000Z', interval_seconds: null };
    const result = computeResumeNextRunAt(schedule, '2026-09-08T12:00:00.000Z');
    expect(result).toBe('2026-09-08T14:00:00.000Z');
  });

  it('INTERVAL, missed while paused -> delegates to computeNextIntervalRun (fast-forwards, never bursts)', () => {
    const schedule: any = { recurrence_type: 'INTERVAL', next_run_at: '2026-09-08T00:00:00.000Z', interval_seconds: 3600 };
    const result = computeResumeNextRunAt(schedule, '2026-09-08T10:15:00.000Z');
    expect(result).toBe('2026-09-08T11:00:00.000Z');
  });
});

describe('deriveScheduleOccurrenceIdempotencyKey: deterministic — same schedule+due instant always derives the same key', () => {
  it('identical inputs produce an identical key', () => {
    const a = deriveScheduleOccurrenceIdempotencyKey('sched-1', '2026-09-08T12:00:00.000Z');
    const b = deriveScheduleOccurrenceIdempotencyKey('sched-1', '2026-09-08T12:00:00.000Z');
    expect(a).toBe(b);
  });

  it('a different due instant for the SAME schedule derives a DIFFERENT key (each occurrence is its own identity)', () => {
    const a = deriveScheduleOccurrenceIdempotencyKey('sched-1', '2026-09-08T12:00:00.000Z');
    const b = deriveScheduleOccurrenceIdempotencyKey('sched-1', '2026-09-08T13:00:00.000Z');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Group B — real DB, real vault.write executions (zero cost), no real timer.
// runDueSchedules()/fireScheduleOccurrence() are called directly so tests
// never wait on real wall-clock seconds.
// ---------------------------------------------------------------------------

describe('1/2/3: create a one-time schedule, due-time tick invokes the canonical fabric exactly once', () => {
  it('creates ACTIVE with the correct persisted fields', async () => {
    const parsed = parseSchedulePhrase('save this to the Vault in 10 minutes', new Date().toISOString());
    if ('ambiguous' in parsed) throw new Error('expected a parsed schedule');
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'save this to the Vault', parsed,
    });
    expect(schedule.status).toBe('ACTIVE');
    expect(schedule.recurrence_type).toBe('ONCE');
    expect(schedule.next_run_at).toBeTruthy();
    expect(schedule.workspace_id).toBe(WS);
  });

  it('a due schedule fires through executeEnvelope exactly once, producing exactly one real artifact', async () => {
    const dueNow = new Date().toISOString();
    const parsed = { recurrenceType: 'ONCE' as const, nextRunAt: dueNow, matchedPhrase: 'now' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'scheduler test content one', parsed,
    });
    const result = await runDueSchedules(dueNow);
    expect(result.processed).toBe(1);

    const after = getSchedule(schedule.schedule_id)!;
    expect(after.status).toBe('COMPLETED'); // ONE_TIME schedule reaches a terminal status
    expect(after.next_run_at).toBeNull();

    const occurrences = getScheduleOccurrences(schedule.schedule_id);
    expect(occurrences.length).toBe(1);
    expect(occurrences[0].status).toBe('SUCCEEDED');
    expect(occurrences[0].artifact_id).toBeTruthy();

    const db = getDatabase();
    const artifactCount = (db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE artifact_id = ?').get(occurrences[0].artifact_id) as any).n;
    expect(artifactCount).toBe(1);
  });
});

describe('4: concurrent duplicate ticks for the SAME due occurrence produce exactly ONE real execution', () => {
  it('three simultaneous runDueSchedules() calls against the same due schedule execute it exactly once', async () => {
    const dueNow = new Date().toISOString();
    const parsed = { recurrenceType: 'ONCE' as const, nextRunAt: dueNow, matchedPhrase: 'now' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'scheduler concurrency test content', parsed,
    });

    await Promise.all([runDueSchedules(dueNow), runDueSchedules(dueNow), runDueSchedules(dueNow)]);

    const occurrences = getScheduleOccurrences(schedule.schedule_id);
    expect(occurrences.length).toBe(1); // one occurrence row, not three
    const db = getDatabase();
    const claimCount = (db.prepare('SELECT COUNT(*) AS n FROM execution_claims WHERE task_id = ?').get(occurrences[0].task_id) as any).n;
    expect(claimCount).toBe(1); // the exact Step 6 mechanism, reused — not a second one
    const artifactCount = (db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(occurrences[0].task_id) as any).n;
    expect(artifactCount).toBe(1);

    const after = getSchedule(schedule.schedule_id)!;
    expect(after.status).toBe('COMPLETED');
  });
});

describe('5/15: restart catch-up — a long-overdue INTERVAL schedule fires exactly once and advances to a future instant, never a backlog burst', () => {
  it('simulates the server having been down for 10 missed hourly intervals', async () => {
    const staleFrom = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
    const parsed = { recurrenceType: 'INTERVAL' as const, intervalSeconds: 3600, nextRunAt: staleFrom, matchedPhrase: 'every hour' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'scheduler restart catch-up test', parsed,
    });

    const nowIso = new Date().toISOString();
    const result = await runDueSchedules(nowIso);
    expect(result.processed).toBe(1); // exactly one occurrence this tick, not ten

    const after = getSchedule(schedule.schedule_id)!;
    expect(after.status).toBe('ACTIVE'); // INTERVAL schedules stay ACTIVE
    expect(new Date(after.next_run_at!).getTime()).toBeGreaterThan(new Date(nowIso).getTime()); // fast-forwarded into the future

    const occurrences = getScheduleOccurrences(schedule.schedule_id);
    expect(occurrences.length).toBe(1); // no duplicate occurrence recorded for the missed window
  });
});

describe('6: pause structurally prevents execution — a paused schedule is never even considered due', () => {
  it('a due (next_run_at in the past) but PAUSED schedule produces zero executions', async () => {
    const parsed = { recurrenceType: 'ONCE' as const, nextRunAt: new Date(Date.now() - 60000).toISOString(), matchedPhrase: 'now' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'scheduler pause test', parsed,
    });
    setScheduleStatus(schedule.schedule_id, 'PAUSED');

    const result = await runDueSchedules(new Date().toISOString());
    // Other schedules created by earlier tests may also be due at this
    // instant in the shared test DB — assert THIS schedule specifically,
    // not the global processed count.
    const occurrences = getScheduleOccurrences(schedule.schedule_id);
    expect(occurrences.length).toBe(0);
    expect(getSchedule(schedule.schedule_id)!.status).toBe('PAUSED');
  });
});

describe('7: resume recomputes next_run_at correctly', () => {
  it('resuming a schedule paused with a stale (past) next_run_at recomputes a future one, not the stale value', async () => {
    const parsed = { recurrenceType: 'INTERVAL' as const, intervalSeconds: 3600, nextRunAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(), matchedPhrase: 'every hour' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'scheduler resume test', parsed,
    });
    setScheduleStatus(schedule.schedule_id, 'PAUSED');

    const nowIso = new Date().toISOString();
    const recomputed = computeResumeNextRunAt(getSchedule(schedule.schedule_id)!, nowIso);
    expect(new Date(recomputed!).getTime()).toBeGreaterThan(new Date(nowIso).getTime());
  });
});

describe('8/9: workspace isolation — a schedule never appears in, or is reachable from, a workspace it does not belong to', () => {
  it('listWorkspaceSchedules(WS2) never returns a schedule created in WS', async () => {
    const parsed = { recurrenceType: 'ONCE' as const, nextRunAt: new Date(Date.now() + 3600000).toISOString(), matchedPhrase: 'in 1 hour' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'workspace isolation test', parsed,
    });
    const ws2Schedules = listWorkspaceSchedules(WS2);
    expect(ws2Schedules.find((s) => s.schedule_id === schedule.schedule_id)).toBeUndefined();
  });

  it('isScheduleInWorkspace: mismatch and unknown id are both false — indistinguishable, no existence leak', async () => {
    const parsed = { recurrenceType: 'ONCE' as const, nextRunAt: new Date(Date.now() + 3600000).toISOString(), matchedPhrase: 'in 1 hour' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write',
      parameters: {}, rawText: 'leak test', parsed,
    });
    expect(isScheduleInWorkspace(schedule.schedule_id, WS)).toBe(true);
    expect(isScheduleInWorkspace(schedule.schedule_id, WS2)).toBe(false);
    expect(isScheduleInWorkspace('sched-does-not-exist', WS)).toBe(false);
  });
});

describe('12: an EXTERNAL_ACTION capability without wired Guardian enforcement is refused at schedule CREATION time — scheduling is never an approval bypass', () => {
  it('windmill.job (configured, so status is not NOT_CONFIGURED/UNSUPPORTED) is BLOCKED at creation, never scheduled ACTIVE', async () => {
    process.env.WINDMILL_BASE_URL = 'http://127.0.0.1:1';
    process.env.WINDMILL_TOKEN = 'fake';
    process.env.WINDMILL_WORKSPACE = 'fake';
    try {
      const parsed = { recurrenceType: 'INTERVAL' as const, intervalSeconds: 3600, nextRunAt: new Date(Date.now() + 3600000).toISOString(), matchedPhrase: 'every hour' };
      const schedule = await createValidatedSchedule({
        workspaceId: WS, actorUserId: 'u1', capability: 'windmill.job', action: 'windmill.job',
        parameters: {}, rawText: 'submit a windmill job every hour', parsed,
      });
      expect(schedule.status).toBe('BLOCKED');
      expect(schedule.next_run_at).toBeNull();
      expect(schedule.status_reason).toMatch(/Guardian enforcement/);
    } finally {
      delete process.env.WINDMILL_BASE_URL;
      delete process.env.WINDMILL_TOKEN;
      delete process.env.WINDMILL_WORKSPACE;
    }
  });
});

describe('13: a NOT_CONFIGURED/UNSUPPORTED capability is created ACTIVE (possibly transient) and reports the real status honestly on every occurrence, never permanently BLOCKED for a condition that might resolve itself', () => {
  it('"run Hermes check every hour" — hermes.execute is UNSUPPORTED; the schedule stays ACTIVE and each occurrence records NOT_CONFIGURED, no fake execution', async () => {
    const parsed = { recurrenceType: 'INTERVAL' as const, intervalSeconds: 3600, nextRunAt: new Date().toISOString(), matchedPhrase: 'every hour' };
    const schedule = await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'hermes.execute', action: 'hermes.execute',
      parameters: {}, rawText: 'run Hermes check', parsed,
    });
    expect(schedule.status).toBe('ACTIVE'); // not BLOCKED — this could become configured later

    const nowIso = new Date().toISOString();
    await runDueSchedules(nowIso);

    const after = getSchedule(schedule.schedule_id)!;
    expect(after.status).toBe('ACTIVE'); // still active after a NOT_CONFIGURED occurrence — will try again next tick
    const occurrences = getScheduleOccurrences(schedule.schedule_id);
    expect(occurrences.length).toBe(1);
    expect(occurrences[0].status).toBe('NOT_CONFIGURED');
    expect(occurrences[0].artifact_id).toBeNull();
    expect(occurrences[0].receipt_id).toBeNull();
  });
});

describe('19: schedule creation itself never creates an execution receipt/artifact/Aegis review', () => {
  it('creating a schedule (not firing it) leaves the receipts/artifacts/quality_reviews tables untouched', async () => {
    const db = getDatabase();
    const receiptsBefore = (db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as any).n;
    const artifactsBefore = (db.prepare('SELECT COUNT(*) AS n FROM artifacts').get() as any).n;
    const reviewsBefore = (db.prepare('SELECT COUNT(*) AS n FROM quality_reviews').get() as any).n;

    const parsed = { recurrenceType: 'ONCE' as const, nextRunAt: new Date(Date.now() + 3600000).toISOString(), matchedPhrase: 'in 1 hour' };
    await createValidatedSchedule({
      workspaceId: WS, actorUserId: 'u1', capability: 'research', action: 'research',
      parameters: {}, rawText: 'no execution at creation time test', parsed,
    });

    expect((db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as any).n).toBe(receiptsBefore);
    expect((db.prepare('SELECT COUNT(*) AS n FROM artifacts').get() as any).n).toBe(artifactsBefore);
    expect((db.prepare('SELECT COUNT(*) AS n FROM quality_reviews').get() as any).n).toBe(reviewsBefore);
  });
});

describe('18: Jarvis schedule intent reaches the real scheduler — via executeEnvelope, exactly as any other capability', () => {
  it('"save this to the Vault in 10 minutes" creates a real, persisted ACTIVE schedule, not a fabricated confirmation', async () => {
    const result = await executeEnvelope({
      workspaceId: WS, actorUserId: 'u1', capability: 'schedule', action: 'schedule',
      parameters: {}, rawText: 'save this to the Vault in 10 minutes',
    });
    expect(result.outcome).toBe('SUCCESS');
    expect(result.schedule).toBeTruthy();
    expect(result.schedule!.capability).toBe('vault.write');
    expect(result.schedule!.status).toBe('ACTIVE');
    expect(result.schedule!.workspace_id).toBe(WS);

    // Real, persisted — not just an in-memory confirmation.
    const persisted = getSchedule(result.schedule!.schedule_id);
    expect(persisted).not.toBeNull();
  });

  it('"research the latest AI agent repos tomorrow at 9am" resolves WHAT=research despite the research verb appearing before the time phrase', async () => {
    const result = await executeScheduleFromNaturalLanguage({
      workspaceId: WS, actorUserId: 'u1', rawText: 'research the latest AI agent repos tomorrow at 9am',
    });
    expect(result.outcome).toBe('SUCCESS');
    expect(result.schedule!.capability).toBe('research');
    expect(result.schedule!.recurrence_type).toBe('ONCE');
  });

  it('"publish this every Monday" is refused — "every Monday" is a real time phrase but weekly recurrence is unsupported, checked before WHAT is even classified; either way it is never silently scheduled or executed', async () => {
    const result = await executeScheduleFromNaturalLanguage({ workspaceId: WS, actorUserId: 'u1', rawText: 'publish this every Monday' });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.reason).toMatch(/not supported yet/i);
    expect(result.schedule).toBeUndefined();
  });

  it('"publish this every 2 hours" — a SUPPORTED time phrase — is still approval-required once WHAT is classified: publish is never schedulable', async () => {
    const result = await executeScheduleFromNaturalLanguage({ workspaceId: WS, actorUserId: 'u1', rawText: 'publish this every 2 hours' });
    expect(result.outcome).toBe('APPROVAL_REQUIRED');
    expect(result.schedule).toBeUndefined();
  });

  it('"delete production data nightly" is blocked outright, never scheduled', async () => {
    const result = await executeScheduleFromNaturalLanguage({ workspaceId: WS, actorUserId: 'u1', rawText: 'delete production data nightly' });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.schedule).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group C — failure behavior, using a real local mock GitHub server (same
// pattern as test/research-github-discovery.test.ts) to deterministically
// produce a genuine FAILED outcome with zero real network cost.
// ---------------------------------------------------------------------------

describe('10/11: a scheduled occurrence that genuinely fails records the failure honestly — no fabricated artifact/Aegis/receipt', () => {
  let mockServer: http.Server;
  let mockPort: number;

  beforeAll(async () => {
    mockServer = http.createServer((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'API rate limit exceeded' }));
    });
    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const addr = mockServer.address();
    mockPort = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  it('a GitHub rate-limit failure at fire time records status FAILED, zero artifact/Aegis/receipt, and the schedule reaches terminal FAILED (ONE_TIME)', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-never-reached-github-fails-first';
    process.env.GITHUB_API_BASE_URL = `http://127.0.0.1:${mockPort}`;
    try {
      const dueNow = new Date().toISOString();
      const parsed = { recurrenceType: 'ONCE' as const, nextRunAt: dueNow, matchedPhrase: 'now' };
      const schedule = await createValidatedSchedule({
        workspaceId: WS, actorUserId: 'u1', capability: 'research', action: 'research',
        parameters: {}, rawText: 'this will fail via mocked GitHub rate limit', parsed,
      });

      await runDueSchedules(dueNow);

      const after = getSchedule(schedule.schedule_id)!;
      expect(after.status).toBe('FAILED');
      expect(after.next_run_at).toBeNull();

      const occurrences = getScheduleOccurrences(schedule.schedule_id);
      expect(occurrences.length).toBe(1);
      expect(occurrences[0].status).toBe('FAILED');
      expect(occurrences[0].artifact_id).toBeNull();
      expect(occurrences[0].receipt_id).toBeNull();
      expect(occurrences[0].reason).toMatch(/rate limit/i);

      const db = getDatabase();
      const artifactCount = (db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(occurrences[0].task_id) as any).n;
      expect(artifactCount).toBe(0);
      const reviewCount = (db.prepare('SELECT COUNT(*) AS n FROM quality_reviews WHERE task_id = ?').get(occurrences[0].task_id) as any).n;
      expect(reviewCount).toBe(0);
    } finally {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GITHUB_API_BASE_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// Group D — REST API + real spawned server (workspace isolation over HTTP,
// pause/resume/run-now, 404-not-403 leak semantics).
// ---------------------------------------------------------------------------

describe('REST API: live, real spawned server', () => {
  const REPO_ROOT = process.cwd();
  const SESSION_COOKIE_NAME = 'synthos_session';
  const LIVE_WS = `ws-scheduler-live-${Date.now()}`;
  const LIVE_WS2 = `ws-scheduler-live-other-${Date.now()}`;
  let userToken: string;
  let child: ChildProcess;
  let BASE_URL: string;

  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') { const p = addr.port; srv.close(() => resolve(p)); }
        else srv.close(() => reject(new Error('could not allocate a free port')));
      });
    });
  }

  function cookieHeader(rawToken: string): string { return `${SESSION_COOKIE_NAME}=${rawToken}`; }

  async function api(method: string, urlPath: string, body?: any): Promise<{ status: number; json: any }> {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(userToken) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  beforeAll(async () => {
    // Reuses THIS test file's already-established DB connection/file
    // (TEST_DB_PATH, module-level, locked in by Group A/B/C's earlier
    // getDatabase() calls) rather than a second, disconnected database —
    // getDatabase()'s dbInstance is a process-wide singleton that ignores
    // a later SYNTHOS_DB_PATH reassignment, so the spawned child below
    // must point at the SAME file this process already writes to (the
    // established pattern: see test/jarvis-duplicate-submission.test.ts,
    // which sets SYNTHOS_DB_PATH exactly once for the whole file).
    const { createUser, login } = await import('../lib/auth');
    const { grantMembership } = await import('../lib/workspaces');

    ensureWorkspace(LIVE_WS, 'Scheduler Live Test Workspace');
    ensureWorkspace(LIVE_WS2, 'Scheduler Live Test Workspace Two');
    const user = createUser({ email: `scheduler-live-${Date.now()}@example.test`, password: 'correct horse battery staple 11', displayName: 'Scheduler Live Tester' });
    grantMembership(user.user_id, LIVE_WS, 'admin');
    grantMembership(user.user_id, LIVE_WS2, 'admin');
    const loginResult = login(user.email, 'correct horse battery staple 11');
    if (!loginResult) throw new Error('setup: real login() failed');
    userToken = loginResult.rawToken;

    const PORT = await freePort();
    BASE_URL = `http://127.0.0.1:${PORT}`;
    const env: NodeJS.ProcessEnv = { ...process.env, SYNTHOS_DB_PATH: TEST_DB_PATH, PORT: String(PORT) };
    delete env.GEMINI_API_KEY;

    child = spawn(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['server.ts'], {
      cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      let out = '';
      const timeout = setTimeout(() => reject(new Error(`server did not start within 20s. stdout so far:\n${out}`)), 20000);
      child.stdout?.on('data', (d) => { out += d.toString(); if (out.includes('Server running on')) { clearTimeout(timeout); resolve(); } });
      child.stderr?.on('data', (d) => { out += d.toString(); });
      child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited early (code ${code}). Output:\n${out}`)); });
    });
  }, 30000);

  afterAll(async () => {
    if (child && !child.killed) { child.kill('SIGTERM'); await new Promise((resolve) => setTimeout(resolve, 300)); }
    try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', LIVE_WS), { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', LIVE_WS2), { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('POST /api/schedules creates a real schedule; GET /api/schedules lists it, workspace-scoped', async () => {
    const created = await api('POST', '/api/schedules', {
      workspaceId: LIVE_WS, capability: 'vault.write', rawText: 'REST-created schedule test', when: 'in 10 minutes',
    });
    expect(created.status).toBe(200);
    expect(created.json.success).toBe(true);
    expect(created.json.schedule.status).toBe('ACTIVE');

    const listed = await api('GET', `/api/schedules?workspaceId=${LIVE_WS}`);
    expect(listed.json.schedules.find((s: any) => s.schedule_id === created.json.schedule.schedule_id)).toBeTruthy();

    const listedOther = await api('GET', `/api/schedules?workspaceId=${LIVE_WS2}`);
    expect(listedOther.json.schedules.find((s: any) => s.schedule_id === created.json.schedule.schedule_id)).toBeUndefined();
  });

  it('9: a schedule_id from a different workspace 404s, never a distinct 403 that would leak existence', async () => {
    const created = await api('POST', '/api/schedules', {
      workspaceId: LIVE_WS, capability: 'vault.write', rawText: 'cross-workspace leak test', when: 'in 10 minutes',
    });
    const crossWorkspaceGet = await api('GET', `/api/schedules/${created.json.schedule.schedule_id}?workspaceId=${LIVE_WS2}`);
    expect(crossWorkspaceGet.status).toBe(404);

    const unknownIdGet = await api('GET', `/api/schedules/sched-does-not-exist?workspaceId=${LIVE_WS}`);
    expect(unknownIdGet.status).toBe(404);
    // Both responses carry the same shape — a caller cannot distinguish
    // "exists in another workspace" from "does not exist at all".
    expect(crossWorkspaceGet.json.error).toBe(unknownIdGet.json.error);
  });

  it('pause then resume over the real API: paused schedule cannot run-now, resumed one can', async () => {
    const created = await api('POST', '/api/schedules', {
      workspaceId: LIVE_WS, capability: 'vault.write', rawText: 'pause-resume-run-now test', when: 'in 10 minutes',
    });
    const id = created.json.schedule.schedule_id;

    const paused = await api('POST', `/api/schedules/${id}/pause`, { workspaceId: LIVE_WS });
    expect(paused.json.schedule.status).toBe('PAUSED');

    const runWhilePaused = await api('POST', `/api/schedules/${id}/run-now`, { workspaceId: LIVE_WS });
    expect(runWhilePaused.status).toBe(400); // cannot run-now a paused schedule

    const resumed = await api('POST', `/api/schedules/${id}/resume`, { workspaceId: LIVE_WS });
    expect(resumed.json.schedule.status).toBe('ACTIVE');
  });

  it('20: run-now still uses the canonical fabric — a real vault artifact is produced, not a fabricated confirmation', async () => {
    const created = await api('POST', '/api/schedules', {
      workspaceId: LIVE_WS, capability: 'vault.write', rawText: 'run-now real execution test', when: 'in 1 hour',
    });
    const id = created.json.schedule.schedule_id;

    const ranNow = await api('POST', `/api/schedules/${id}/run-now`, { workspaceId: LIVE_WS });
    expect(ranNow.status).toBe(200);
    expect(ranNow.json.schedule.status).toBe('COMPLETED');
    expect(ranNow.json.occurrences.length).toBe(1);
    expect(ranNow.json.occurrences[0].status).toBe('SUCCEEDED');
    expect(ranNow.json.occurrences[0].artifact_id).toBeTruthy();
  });

  it('DELETE cancels a schedule (soft delete — preserves history) and it never fires again', async () => {
    const created = await api('POST', '/api/schedules', {
      workspaceId: LIVE_WS, capability: 'vault.write', rawText: 'cancel test', when: 'in 10 minutes',
    });
    const id = created.json.schedule.schedule_id;
    const cancelled = await api('DELETE', `/api/schedules/${id}?workspaceId=${LIVE_WS}`);
    expect(cancelled.json.schedule.status).toBe('CANCELLED');
    const stillListed = await api('GET', `/api/schedules/${id}?workspaceId=${LIVE_WS}`);
    expect(stillListed.status).toBe(200); // history preserved, not hard-deleted
    expect(stillListed.json.schedule.status).toBe('CANCELLED');
  });
});
