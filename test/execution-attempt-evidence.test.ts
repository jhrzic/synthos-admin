import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-attempt-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'attempt.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { executeEnvelope } from '../lib/fabric/envelope';
import { recordRuntimeEvent, listRecentRuntimeEvents, SECURITY_RELEVANT_STATUSES } from '../lib/runtime-events';
import { getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';

// ---------------------------------------------------------------------------
// EVERY EXECUTION ATTEMPT MUST BE PROVABLE — including the refused ones.
//
// The gap this closes: executeEnvelope had four refusal paths — unregistered
// capability, NOT_CONFIGURED/UNSUPPORTED, an external action without wired
// Guardian enforcement, and APPROVAL_REQUIRED — and every one of them
// returned a value to the caller and persisted NOTHING.
//
// That made a specific question unanswerable: "prove nothing executed without
// Guardian's consent." The absence of a receipt is not evidence of a refusal,
// because it is equally consistent with the attempt never having been made.
// Only a recorded attempt distinguishes the two.
//
// The rule these tests defend: a refused or failed attempt leaves durable
// evidence, and that evidence is never a success receipt.
// ---------------------------------------------------------------------------

const WS = 'ws-attempt-evidence';

function attemptRows() {
  return getDatabase()
    .prepare("SELECT * FROM runtime_events WHERE event_type = 'CAPABILITY_INVOCATION' ORDER BY created_at ASC, rowid ASC")
    .all() as any[];
}

function detail(row: any): any {
  return JSON.parse(row.detail_json);
}

beforeAll(() => {
  ensureWorkspace(WS, 'Attempt Evidence Workspace');
});

beforeEach(() => {
  getDatabase().prepare("DELETE FROM runtime_events").run();
});

const baseInput = {
  workspaceId: WS,
  actorUserId: 'user-evidence-test',
  action: 'test.action',
  parameters: {},
  rawText: 'a request',
};

describe('a refused attempt is durable, which it previously was not', () => {
  it('an unregistered capability is recorded, not silently dropped', async () => {
    const result = await executeEnvelope({ ...baseInput, capability: 'capability.that.does.not.exist' });
    expect(result.outcome).toBe('NOT_CONFIGURED');

    const rows = attemptRows();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('NOT_CONFIGURED');
    expect(rows[0].target_id).toBe('capability.that.does.not.exist');
    expect(rows[0].workspace_id).toBe(WS);
  });

  it('a capability the deployment cannot run is recorded with its real reason', async () => {
    // hermes.execute is NOT_CONFIGURED here: no CLI is configured in a temp
    // environment and HERMES_LOCAL_ENABLED is not "true".
    const result = await executeEnvelope({ ...baseInput, capability: 'hermes.execute', rawText: 'summarise something' });
    expect(['NOT_CONFIGURED', 'BLOCKED']).toContain(result.outcome);

    const rows = attemptRows();
    expect(rows.length).toBe(1);
    expect(detail(rows[0]).reason).toBeTruthy();
    // No provider was contacted, and the row says so explicitly.
    expect(detail(rows[0]).providerCalled).toBe(false);
  });

  it('the attempt names who tried it, in which workspace, and what they asked for', async () => {
    await executeEnvelope({ ...baseInput, capability: 'nope.not.real' });
    const d = detail(attemptRows()[0]);
    expect(d.actorUserId).toBe('user-evidence-test');
    expect(d.action).toBe('test.action');
    expect(attemptRows()[0].workspace_id).toBe(WS);
    expect(typeof d.requestDigest).toBe('string');
    expect(d.requestDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  // The ledger must prove two attempts were the same request without
  // retaining the request itself.
  it('records a digest of the request, never its content', async () => {
    const secretish = 'instruction containing sk-live-secret-material-9999';
    await executeEnvelope({ ...baseInput, capability: 'nope.not.real', rawText: secretish });

    const row = attemptRows()[0];
    expect(row.detail_json).not.toContain('sk-live-secret-material-9999');
    expect(row.detail_json).not.toContain(secretish);
    expect(detail(row).requestDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the same request twice produces the same digest; a different one does not', async () => {
    await executeEnvelope({ ...baseInput, capability: 'nope.not.real', rawText: 'identical' });
    await executeEnvelope({ ...baseInput, capability: 'nope.not.real', rawText: 'identical' });
    await executeEnvelope({ ...baseInput, capability: 'nope.not.real', rawText: 'different' });

    const digests = attemptRows().map((r) => detail(r).requestDigest);
    expect(digests.length).toBe(3);
    expect(digests[0]).toBe(digests[1]);
    expect(digests[0]).not.toBe(digests[2]);
  });
});

describe('a refused attempt never produces success evidence', () => {
  it('no artifact, no Aegis decision and no receipt are referenced for a refusal', async () => {
    await executeEnvelope({ ...baseInput, capability: 'hermes.execute', rawText: 'do a thing' });
    const d = detail(attemptRows()[0]);
    expect(d.artifactId).toBeNull();
    expect(d.aegisDecision).toBeNull();
    expect(d.receiptId).toBeNull();
    expect(d.receiptVerified).toBeNull();
  });

  it('a refusal writes no receipt row at all — the distinction that matters most', async () => {
    const before = (getDatabase().prepare('SELECT COUNT(*) AS n FROM receipts').get() as any).n;
    await executeEnvelope({ ...baseInput, capability: 'hermes.execute', rawText: 'do a thing' });
    const after = (getDatabase().prepare('SELECT COUNT(*) AS n FROM receipts').get() as any).n;
    expect(after).toBe(before);
  });

  it('a successful read is recorded as SUCCESS and is distinguishable from a refusal', async () => {
    const result = await executeEnvelope({ ...baseInput, capability: 'task.read', rawText: 'list my tasks' });
    expect(result.outcome).toBe('READ_OK');

    const rows = attemptRows();
    expect(rows.length).toBe(1);
    // READ_OK maps to SUCCESS in the ledger vocabulary, and the outcome is
    // preserved verbatim in the detail so the two are not conflated.
    expect(rows[0].status).toBe('SUCCESS');
    expect(detail(rows[0]).outcome).toBe('READ_OK');
  });
});

describe('the attempt row carries latency and the provider-contacted fact', () => {
  it('latency is recorded as a real measurement', async () => {
    await executeEnvelope({ ...baseInput, capability: 'task.read', rawText: 'list' });
    const row = attemptRows()[0];
    expect(typeof row.latency_ms).toBe('number');
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('providerCalled distinguishes "refused before dispatch" from "an outward call happened"', async () => {
    await executeEnvelope({ ...baseInput, capability: 'nope.not.real' });
    expect(detail(attemptRows()[0]).providerCalled).toBe(false);
    expect(detail(attemptRows()[0]).toolsInvoked).toEqual([]);
  });
});

describe('security evidence survives routine traffic', () => {
  // The ledger is a bounded ring: each insert prunes the 500 oldest rows once
  // the table passes 5,000. That was fine for health probes and wrong for
  // refusals — a burst of successes would have evicted the record of a
  // blocked execution, which is the one row anyone would later need.
  it('BLOCKED and APPROVAL_REQUIRED are classified as security-relevant', () => {
    expect(SECURITY_RELEVANT_STATUSES.has('BLOCKED')).toBe(true);
    expect(SECURITY_RELEVANT_STATUSES.has('APPROVAL_REQUIRED')).toBe(true);
    expect(SECURITY_RELEVANT_STATUSES.has('SUCCESS')).toBe(false);
  });

  it('a flood of routine successes does not evict a blocked attempt', () => {
    recordRuntimeEvent({
      workspaceId: WS,
      eventType: 'CAPABILITY_INVOCATION',
      targetType: 'capability',
      targetId: 'the.blocked.one',
      status: 'BLOCKED',
      detail: { outcome: 'BLOCKED', reason: 'Guardian refused' },
    });

    // Enough routine rows to trigger pruning several times over.
    for (let i = 0; i < 5200; i++) {
      recordRuntimeEvent({
        workspaceId: WS,
        eventType: 'PROVIDER_CALL',
        targetType: 'provider',
        targetId: `routine-${i}`,
        status: 'SUCCESS',
      });
    }

    const survived = getDatabase()
      .prepare("SELECT COUNT(*) AS n FROM runtime_events WHERE status = 'BLOCKED' AND target_id = 'the.blocked.one'")
      .get() as any;
    expect(survived.n, 'routine traffic evicted the blocked-attempt evidence').toBe(1);
  }, 60_000);

  it('the ledger is insert-only — no code path updates a recorded event', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/runtime-events.ts'), 'utf8');
    expect(source).not.toMatch(/UPDATE\s+runtime_events/i);
  });
});

describe('the attempt ledger is queryable as a trace', () => {
  it('an attempt row references the evidence chain rather than duplicating it', async () => {
    await executeEnvelope({ ...baseInput, capability: 'task.read', rawText: 'list' });
    const d = detail(attemptRows()[0]);
    // The reference fields exist on every row, present or null — so a trace
    // can be reconstructed by joining, and a missing link is visible as null
    // rather than as an absent key.
    for (const key of ['taskId', 'artifactId', 'artifactHash', 'aegisDecision', 'receiptId', 'receiptVerified', 'providerCalled', 'requestDigest']) {
      expect(Object.prototype.hasOwnProperty.call(d, key), `attempt detail is missing ${key}`).toBe(true);
    }
  });

  it('attempts are listable through the existing ledger reader', async () => {
    await executeEnvelope({ ...baseInput, capability: 'nope.not.real' });
    const events = listRecentRuntimeEvents({ workspaceId: WS, targetType: 'capability', limit: 10 });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event_type).toBe('CAPABILITY_INVOCATION');
  });
});
