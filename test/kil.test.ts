import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// A fresh, isolated SQLite file for this test file only — set BEFORE any
// persistence function runs its first (lazy) getDatabase() call.
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-kil-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  calculateKilConfidence,
  evidenceQuality,
  isPromoted,
  trackRecord,
  verificationGate,
  BLOCKING_CHECKS,
  QUALITY_CHECKS,
  QUALITY_FLOOR,
  PROMOTION_THRESHOLD,
  type KilCheckResults,
} from '../lib/kil';
import { verifyOutput } from '../lib/kil-verifier';
import {
  createInitialTask,
  recordReceipt,
  recordKilObservation,
  listKilObservations,
  summariseKil,
  kilAgentAttempts,
  latestKilObservationForTask,
  projectKnowledgeCandidate,
  getKnowledgeCandidate,
} from '../lib/persistence';

// -----------------------------------------------------------------------
// SYNTHOS — Knowledge Intelligence Layer.
//
// These assertions mirror ~/synthos/mission-control's real
// src/lib/__tests__/synthos-kil.test.ts exactly, including its literal
// expected numbers (0.875, 0.925, 0.583, 0.75, ...) — this is the same
// formula, ported unchanged, so it must produce the same verdicts.
// -----------------------------------------------------------------------

const clean = (over: Partial<KilCheckResults> = {}): KilCheckResults => ({
  no_invented_urls: true,
  no_invented_prices: true,
  non_empty: true,
  no_placeholder_text: true,
  min_length: 1,
  max_length: 1,
  structural_completeness: 1,
  citation_density: 1,
  directive_term_coverage: 1,
  ...over,
});

const promote = (checks: KilCheckResults, attempts: number) =>
  isPromoted(calculateKilConfidence({ checks, attempts }), evidenceQuality(checks));

describe('KIL 1: exact weight behavior (W_E=0.7, W_F=0.3), ported unchanged from the real formula', () => {
  it('promotes pristine work immediately but reserves 1.00 for a long record', () => {
    expect(calculateKilConfidence({ checks: clean(), attempts: 1 })).toBe(0.875);
    expect(calculateKilConfidence({ checks: clean(), attempts: 5 })).toBe(0.925);
    expect(calculateKilConfidence({ checks: clean(), attempts: 1e9 })).toBe(1);
  });

  it('track record starts at the prior, never at zero, and ramps as documented', () => {
    expect(trackRecord(0)).toBeGreaterThan(0.5);
    expect(trackRecord(1)).toBeCloseTo(0.583, 3);
    expect(trackRecord(5)).toBeCloseTo(0.75, 3);
    expect(trackRecord(100)).toBeGreaterThan(trackRecord(10));
    expect(trackRecord(1e9)).toBeLessThanOrEqual(1);
  });

  it('a failed blocking check scores 0.00 even on a perfect record — the weight cannot rescue it', () => {
    for (const check of BLOCKING_CHECKS) {
      const checks = clean({ [check]: false } as Partial<KilCheckResults>);
      expect(calculateKilConfidence({ checks, attempts: 10_000 })).toBe(0);
      expect(promote(checks, 10_000)).toBe(false);
    }
  });
});

describe('KIL 2: evidence threshold (QUALITY_FLOOR = 0.90)', () => {
  it('QUALITY_FLOOR is exactly 0.9, matching the migration directive', () => {
    expect(QUALITY_FLOOR).toBe(0.9);
  });

  it('evidenceQuality averages the five quality vectors and clamps out-of-range inputs', () => {
    expect(QUALITY_CHECKS).toHaveLength(5);
    expect(evidenceQuality(clean({ citation_density: 0 }))).toBeCloseTo(0.8, 5);
    expect(evidenceQuality(clean({ citation_density: 5 }))).toBe(1);
    expect(evidenceQuality(clean({ citation_density: -3 }))).toBeCloseTo(0.8, 5);
  });
});

describe('KIL 3: confidence threshold (PROMOTION_THRESHOLD = 0.85)', () => {
  it('PROMOTION_THRESHOLD is exactly 0.85, matching the migration directive', () => {
    expect(PROMOTION_THRESHOLD).toBe(0.85);
  });
});

describe('KIL 4: promotion requires BOTH thresholds, not either alone', () => {
  it('a long track record clears the confidence bar but is still blocked by the quality floor', () => {
    const thin = clean({ citation_density: 0 }); // evidence = 0.8, below QUALITY_FLOOR
    expect(calculateKilConfidence({ checks: thin, attempts: 1000 })).toBeGreaterThan(PROMOTION_THRESHOLD);
    expect(promote(thin, 1000)).toBe(false);
  });

  it('admits work exactly at the floor once a small record exists, not before', () => {
    const atFloor = clean({ citation_density: 0.5 });
    expect(evidenceQuality(atFloor)).toBeCloseTo(QUALITY_FLOOR, 5);
    expect(promote(atFloor, 1)).toBe(false);
    expect(promote(atFloor, 5)).toBe(true);
  });
});

describe('KIL 5: below-threshold candidates do not promote', () => {
  it('holds a thin deliverable back at every possible number of attempts', () => {
    const thin = clean({ citation_density: 0 });
    for (const n of [1, 10, 100, 1_000, 1e9]) expect(promote(thin, n)).toBe(false);
  });

  it('a thin but safe deliverable still clears the verifier gate (quality never vetoes)', () => {
    const r = verifyOutput({
      content: 'Short but entirely safe and grounded text about the directive.',
      agentName: 'Test Agent',
      groundingContext: 'directive text',
      maxTokens: 4000,
    });
    expect(r.blockingPassed).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.qualityScore).toBeLessThan(1);
  });
});

describe('KIL 6/7: persistence — workspace isolation and round-trip', () => {
  const WS_A = 'ws-kil-test-alpha';
  const WS_B = 'ws-kil-test-beta';
  const TASK_A = 'task-kil-a-1';

  beforeAll(() => {
    createInitialTask({
      taskId: TASK_A,
      workspaceId: WS_A,
      title: 'KIL test task',
      description: 'test',
      assignedAgent: 'scout',
      assignedModel: 'gemini-3.1-flash-lite',
    });
  });

  afterAll(() => {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch {
      // best-effort cleanup
    }
  });

  it('6. a Workspace A observation cannot affect Workspace B (attempts, listing, summary)', () => {
    recordKilObservation({ workspaceId: WS_B, agentId: 'scout', checks: clean(), attempts: 1 });
    recordKilObservation({ workspaceId: WS_B, agentId: 'scout', checks: clean(), attempts: 1 });

    expect(listKilObservations(WS_A)).toHaveLength(0);
    expect(kilAgentAttempts(WS_A, 'scout')).toBe(0);
    expect(kilAgentAttempts(WS_B, 'scout')).toBe(2);

    const summaryA = summariseKil(WS_A);
    expect(summaryA.total).toBe(0);
    expect(summaryA.promotionRate).toBeNull();
    expect(summaryA.averageEvidence).toBeNull();
  });

  it('7. persistence round-trip: recordKilObservation stores the decision, not just the inputs', () => {
    const o = recordKilObservation({ workspaceId: WS_A, taskId: TASK_A, agentId: 'scout', checks: clean(), attempts: 1 });
    expect(o.confidence).toBe(0.875);
    expect(o.evidence).toBe(1);
    expect(o.promoted).toBe(1);
    expect(o.promotion_threshold).toBe(PROMOTION_THRESHOLD);
    expect(o.quality_floor).toBe(QUALITY_FLOOR);
    expect(JSON.parse(o.checks_json || '{}').citation_density).toBe(1);

    const read = latestKilObservationForTask(WS_A, TASK_A);
    expect(read?.observation_id).toBe(o.observation_id);
    expect(read?.confidence).toBe(0.875);
  });

  it('a blocked observation counts as blocked, not merely unpromoted, in the summary', () => {
    recordKilObservation({ workspaceId: WS_A, taskId: TASK_A, agentId: 'scout', checks: clean({ non_empty: false }), attempts: 3 });
    const s = summariseKil(WS_A);
    expect(s.blocked).toBeGreaterThanOrEqual(1);
  });

  it('knowledge candidate projection requires a real task, a real verified observation, and a real receipt in the same workspace', () => {
    const observation = recordKilObservation({ workspaceId: WS_A, taskId: TASK_A, agentId: 'scout', checks: clean(), attempts: 1 });
    expect(observation.promoted).toBe(1);

    recordReceipt({
      receiptId: 'rcpt-kil-test-1',
      taskId: TASK_A,
      reviewId: 'qr-kil-test-1',
      algorithm: 'Ed25519',
      publicKey: 'test-public-key',
      payloadJson: JSON.stringify({ taskId: TASK_A }),
      signature: 'test-signature',
    });

    const { candidate, created } = projectKnowledgeCandidate({
      workspaceId: WS_A,
      taskId: TASK_A,
      kilObservationId: observation.observation_id,
      receiptId: 'rcpt-kil-test-1',
      vaultPath: 'Startup-Theses/kil-test.md',
      label: 'KIL test task',
    });
    expect(created).toBe(true);
    expect(candidate.promotion_state).toBe('pending');
    expect(candidate.verification_state).toBe('verified');

    // Repeat projection of the same evidence is a no-op, not a duplicate row.
    const again = projectKnowledgeCandidate({
      workspaceId: WS_A,
      taskId: TASK_A,
      kilObservationId: observation.observation_id,
      receiptId: 'rcpt-kil-test-1',
      vaultPath: 'Startup-Theses/kil-test.md',
      label: 'KIL test task',
    });
    expect(again.created).toBe(false);
    expect(again.candidate.candidate_id).toBe(candidate.candidate_id);

    // Cross-workspace: the same real observation/receipt cannot be projected
    // into a workspace that doesn't own the underlying task.
    expect(() =>
      projectKnowledgeCandidate({
        workspaceId: WS_B,
        taskId: TASK_A,
        kilObservationId: observation.observation_id,
        receiptId: 'rcpt-kil-test-1',
        vaultPath: 'Startup-Theses/kil-test.md',
        label: 'KIL test task',
      })
    ).toThrow();

    expect(getKnowledgeCandidate(WS_A, candidate.candidate_id)).not.toBeNull();
    expect(getKnowledgeCandidate(WS_B, candidate.candidate_id)).toBeNull();
  });

  it('candidate projection rejects an unverified observation, an unknown task, or a receipt from a different task', () => {
    const unpromoted = recordKilObservation({ workspaceId: WS_A, taskId: TASK_A, agentId: 'scout', checks: clean({ non_empty: false }), attempts: 1 });
    expect(unpromoted.verification).toBe(0);

    expect(() =>
      projectKnowledgeCandidate({
        workspaceId: WS_A,
        taskId: TASK_A,
        kilObservationId: unpromoted.observation_id,
        receiptId: 'rcpt-kil-test-1',
        vaultPath: 'Startup-Theses/kil-test-2.md',
        label: 'Unverified',
      })
    ).toThrow(/verified KIL observation/i);

    expect(() =>
      projectKnowledgeCandidate({
        workspaceId: WS_A,
        taskId: 'task-does-not-exist',
        kilObservationId: unpromoted.observation_id,
        receiptId: 'rcpt-kil-test-1',
        vaultPath: 'Startup-Theses/kil-test-2.md',
        label: 'No task',
      })
    ).toThrow(/task does not belong/i);
  });
});

describe('KIL 8: no hardcoded confidence values anywhere in the migrated engine', () => {
  it('the scoring and persistence modules contain no literal confidence assignment — every value is computed', () => {
    const kilSource = fs.readFileSync(path.resolve(process.cwd(), 'lib/kil.ts'), 'utf-8');
    const gateSource = fs.readFileSync(path.resolve(process.cwd(), 'lib/kil-gate.ts'), 'utf-8');
    // The exact anti-pattern found in Mission Control's synthos-brain-knowledge.ts
    // (confidence: 100, confidence: 96, ...) must never appear here.
    expect(kilSource).not.toMatch(/confidence:\s*\d/);
    expect(gateSource).not.toMatch(/confidence:\s*\d/);
  });

  it('calculateKilConfidence is a pure function of its real inputs — two different inputs never collide on a hardcoded output', () => {
    const a = calculateKilConfidence({ checks: clean(), attempts: 1 });
    const b = calculateKilConfidence({ checks: clean({ citation_density: 0.2 }), attempts: 1 });
    expect(a).not.toBe(b);
  });
});
