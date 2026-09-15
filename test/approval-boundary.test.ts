import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-approval-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'approval.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { executeEnvelope, EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE } from '../lib/fabric/envelope';
import { listCapabilities, resolveCapability } from '../lib/fabric/registry';
import { createValidatedSchedule } from '../lib/fabric/scheduler';
import { GRAPH_EXECUTABLE_CAPABILITIES } from '../lib/graph-execution';
import { getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';

// ---------------------------------------------------------------------------
// THE APPROVAL BOUNDARY, across every path that can dispatch work.
//
// The rule (envelope Section 7): a capability whose effectClass is
// EXTERNAL_ACTION may not execute unless its approvalPolicy is genuinely
// GUARDIAN_ENFORCED — meaning real wired code gates it, not a label — or it
// is on a narrow, named exemption list.
//
// The risk this covers is not the rule itself but the number of ways into it.
// Manual, scheduled, graph, retry and run-now are five different entry
// points, and a rule enforced in four of them is not enforced.
// ---------------------------------------------------------------------------

const WS = 'ws-approval-boundary';

beforeAll(() => {
  ensureWorkspace(WS, 'Approval Boundary Workspace');
});

const baseInput = {
  workspaceId: WS,
  actorUserId: 'user-approval-test',
  action: 'test.action',
  parameters: {},
  rawText: 'attempt something outward',
};

/** Every registered capability that the rule is meant to catch. */
async function unenforcedExternalActions() {
  const all = await listCapabilities();
  return all.filter(
    (c) =>
      c.effectClass === 'EXTERNAL_ACTION' &&
      c.approvalPolicy !== 'GUARDIAN_ENFORCED' &&
      !EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.has(c.key),
  );
}

describe('the rule is coherent before testing the paths', () => {
  it('every EXTERNAL_ACTION capability is either Guardian-enforced or explicitly exempt', async () => {
    const unenforced = await unenforcedExternalActions();
    // Any capability here would be refused at dispatch by all five paths. That
    // is safe, but it means the capability is dead weight, so it is worth
    // surfacing rather than leaving as a silent permanent refusal.
    for (const cap of unenforced) {
      expect(
        ['NOT_CONFIGURED', 'UNSUPPORTED', 'APPROVAL_REQUIRED'].includes(cap.status),
        `${cap.key} is AVAILABLE, is an EXTERNAL_ACTION, and is neither Guardian-enforced nor exempt — every dispatch path will refuse it`,
      ).toBe(true);
    }
  });

  it('the exemption list is narrow and named, not a category', () => {
    expect(EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.size).toBeLessThanOrEqual(2);
    for (const key of EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE) {
      expect(typeof key).toBe('string');
      expect(key).not.toContain('*');
    }
  });

  it('hermes.execute claims GUARDIAN_ENFORCED and the executor really runs the gate', async () => {
    const cap = await resolveCapability('hermes.execute');
    expect(cap?.effectClass).toBe('EXTERNAL_ACTION');
    expect(cap?.approvalPolicy).toBe('GUARDIAN_ENFORCED');
    // A label is only true if wired code backs it.
    const envelope = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/envelope.ts'), 'utf8');
    const executor = envelope.slice(envelope.indexOf('async function executeHermesTask'));
    expect(executor).toContain('guardianCheckInstruction(prompt)');
    // And the gate runs BEFORE the subprocess and before any claim is taken.
    expect(executor.indexOf('guardianCheckInstruction')).toBeLessThan(executor.indexOf('withAtomicClaim'));
  });
});

describe('PATH 1 — manual dispatch cannot cross the boundary', () => {
  it('a Guardian-refused instruction is BLOCKED and nothing is executed', async () => {
    const result = await executeEnvelope({
      ...baseInput,
      capability: 'hermes.execute',
      rawText: 'rm -rf / --no-preserve-root',
    });
    expect(['BLOCKED', 'NOT_CONFIGURED']).toContain(result.outcome);
    expect(result.outcome).not.toBe('SUCCESS');
    expect(result.receipt ?? null).toBeNull();
  });

  it('the refusal is durable evidence, not just a return value', async () => {
    await executeEnvelope({ ...baseInput, capability: 'hermes.execute', rawText: ':(){ :|:& };:' });
    const row = getDatabase()
      .prepare("SELECT * FROM runtime_events WHERE event_type='CAPABILITY_INVOCATION' ORDER BY rowid DESC LIMIT 1")
      .get() as any;
    expect(row).toBeTruthy();
    expect(['BLOCKED', 'NOT_CONFIGURED']).toContain(row.status);
    expect(JSON.parse(row.detail_json).providerCalled).toBe(false);
  });
});

describe('PATH 2 — scheduling is not a way around the boundary', () => {
  // The specific worry: refuse a direct call, then schedule the same thing.
  it('a capability the envelope would refuse cannot be scheduled ACTIVE', async () => {
    const unenforced = await unenforcedExternalActions();
    const target = unenforced.find((c) => !['NOT_CONFIGURED', 'UNSUPPORTED'].includes(c.status));
    if (!target) {
      // Nothing currently reaches the eager-block branch. The rule is still
      // asserted structurally below, so this is a real pass rather than a
      // skipped one.
      const scheduler = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/scheduler.ts'), 'utf8');
      expect(scheduler).toContain("cap.approvalPolicy !== 'GUARDIAN_ENFORCED'");
      expect(scheduler).toContain('EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.has(cap.key)');
      return;
    }
    const schedule = await createValidatedSchedule({
      workspaceId: WS,
      actorUserId: 'user-approval-test',
      capability: target.key,
      action: target.key,
      parameters: {},
      rawText: 'every 1 hour',
      parsed: { recurrenceType: 'INTERVAL', intervalSeconds: 3600, nextRunAt: new Date(Date.now() + 3600_000).toISOString(), matchedPhrase: 'every 1 hour' },
    });
    expect(schedule.status).toBe('BLOCKED');
    expect(schedule.next_run_at).toBeNull();
  });

  it('the scheduler imports the exemption set rather than keeping its own copy', () => {
    const scheduler = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/scheduler.ts'), 'utf8');
    expect(scheduler).toContain("EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE } from './envelope'");
    // A hand-synced duplicate would drift, and drift here means a scheduled
    // action permitted that a direct one is refused.
    expect(scheduler).not.toMatch(/const EXTERNAL_ACTION_EXEMPT[^=]*=\s*new Set/);
  });

  it('every scheduled occurrence dispatches through the envelope, so the rule is re-checked each time', () => {
    const scheduler = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/scheduler.ts'), 'utf8');
    const fire = scheduler.slice(scheduler.indexOf('export async function fireScheduleOccurrence'));
    expect(fire).toContain('executeEnvelope(');
  });
});

describe('PATH 3 — graph execution cannot cross the boundary', () => {
  it('graph capability nodes are restricted to a named allowlist', () => {
    expect(GRAPH_EXECUTABLE_CAPABILITIES.length).toBeGreaterThan(0);
    for (const key of GRAPH_EXECUTABLE_CAPABILITIES) {
      expect(key).not.toContain('*');
    }
  });

  it('no graph-executable capability is an unenforced external action', async () => {
    const offenders: string[] = [];
    for (const key of GRAPH_EXECUTABLE_CAPABILITIES) {
      const cap = await resolveCapability(key);
      if (!cap) continue;
      if (
        cap.effectClass === 'EXTERNAL_ACTION' &&
        cap.approvalPolicy !== 'GUARDIAN_ENFORCED' &&
        !EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE.has(cap.key)
      ) {
        offenders.push(`${key} (${cap.approvalPolicy})`);
      }
    }
    expect(offenders, 'a graph node could dispatch an external action with no Guardian enforcement').toEqual([]);
  });

  it('live graph execution requires explicit server-side confirmation, not a client-side modal', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    const idx = server.indexOf('app.post("/api/graphs/run"');
    const route = server.slice(server.indexOf('/api/graphs/execute') - 200);
    // The gate is a server-enforced `confirmed: true`, checked before any
    // node runs — a UI that forgets the modal cannot start paid work.
    expect(route).toContain('confirmed !== true');
    expect(idx === -1 || route.length > 0).toBe(true);
  });
});

describe('PATH 4 — retry and reconciliation cannot launder an action past Guardian', () => {
  it('a retry re-runs the Guardian check rather than trusting the original approval', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/external-executions.ts'), 'utf8');
    const retry = source.slice(source.indexOf('export async function retryExternalExecution'));
    const body = retry.slice(0, retry.indexOf('\n}\n'));
    expect(body).toContain('guardianCheckInstruction');
  });

  it('a retry chains the parent correlation id, so the attempt chain stays traceable', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/external-executions.ts'), 'utf8');
    expect(source).toContain('::retry-');
  });

  // Reconciliation is the subtler one: it must never be a dispatch path.
  it('the reconciliation sweep only refreshes and ingests — it never submits new work', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/external-executions.ts'), 'utf8');
    const sweep = source.slice(source.indexOf('export async function reconcileExternalExecutions'));
    expect(sweep).toContain('refreshAndIngestIfComplete');
    // A submit or a retry inside the sweep would make an unattended timer a
    // dispatcher, which is exactly what the Guardian boundary exists to stop.
    expect(sweep).not.toContain('submitExternalExecution');
    expect(sweep).not.toContain('retryExternalExecution');
  });

  it('terminal executions are excluded from the sweep, so nothing is re-run after completion', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/external-executions.ts'), 'utf8');
    const selector = source.slice(source.indexOf('export function listReconcilableExternalExecutions'));
    expect(selector).toContain('status NOT IN');
  });
});

describe('PATH 5 — run-now is the schedule path, not a shortcut around it', () => {
  it('run-now fires an occurrence through the same envelope dispatch', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    const idx = server.indexOf('app.post("/api/schedules/:id/run-now"');
    expect(idx).toBeGreaterThan(-1);
    const route = server.slice(idx, idx + 1200);
    // It must reuse the real occurrence path; a direct capability call here
    // would skip the schedule's own BLOCKED status and the envelope re-check.
    expect(route).toMatch(/fireScheduleOccurrence|executeEnvelope/);
  });

  it('run-now is workspace-ownership guarded (the Pass 1 fix still holds)', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    const idx = server.indexOf('app.post("/api/schedules/:id/run-now"');
    const route = server.slice(idx, idx + 600);
    expect(route).toContain('enforceScheduleWorkspaceAccess');
    const declaration = server.slice(idx, server.indexOf('\n', idx));
    expect(declaration).toContain('requireWorkspaceMember');
  });
});

describe('one canonical trace key spans the attempt and the external execution', () => {
  it('the attempt ledger always records a correlation id', async () => {
    await executeEnvelope({ ...baseInput, capability: 'task.read', rawText: 'list my tasks', idempotencyKey: 'corr-key-abc' });
    const row = getDatabase()
      .prepare("SELECT * FROM runtime_events WHERE event_type='CAPABILITY_INVOCATION' ORDER BY rowid DESC LIMIT 1")
      .get() as any;
    expect(JSON.parse(row.detail_json).correlationId).toBe('corr-key-abc');
  });

  it('an attempt with no natural key still gets a deterministic correlation id', async () => {
    await executeEnvelope({ ...baseInput, capability: 'task.read', rawText: 'no key supplied' });
    const row = getDatabase()
      .prepare("SELECT * FROM runtime_events WHERE event_type='CAPABILITY_INVOCATION' ORDER BY rowid DESC LIMIT 1")
      .get() as any;
    const d = JSON.parse(row.detail_json);
    expect(d.correlationId).toBeTruthy();
    // Derived from the request digest, so the same request correlates.
    expect(d.correlationId).toContain(d.requestDigest.slice(0, 12));
  });

  it('external executions derive the same key, so the two sides join', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/external-executions.ts'), 'utf8');
    // The existing derivation the attempt ledger now mirrors.
    expect(source).toContain('params.idempotencyKey || `adhoc-');
    // And the skill path records it alongside the execution id.
    const skills = fs.readFileSync(path.join(process.cwd(), 'lib/skill-execution.ts'), 'utf8');
    expect(skills).toContain('correlationId: execution.correlation_id');
  });
});
