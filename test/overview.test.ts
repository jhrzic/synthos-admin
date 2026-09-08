import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-overview-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createInitialTask,
  updateTaskStatus,
  recordArtifact,
  recordQualityReview,
  recordReceipt,
  canonicalizePayload,
  signReceiptPayload,
  saveGraph,
  saveGraphRun,
  CanonicalReceiptPayload,
} from '../lib/persistence';
import { getWorkspaceOverview } from '../lib/overview';

// ---------------------------------------------------------------------------
// Pass X / Workstream T — Overview truth regression test.
//
// Proves getWorkspaceOverview() (the real backend behind the rewritten
// default Overview screen) returns genuine zero/empty values for an unused
// workspace, then that real backend state — created through the same real
// task/graph/artifact/receipt functions the rest of this app's execution
// pipeline uses, never a mock or a seeded fixture table — changes the
// reported counts. No mock KPI array, no random value, no hardcoded
// business metric anywhere in lib/overview.ts; this test would fail the
// moment one was reintroduced.
// ---------------------------------------------------------------------------

const WS_EMPTY = 'ws-overview-empty';
const WS_A = 'ws-overview-a';
const WS_B = 'ws-overview-b';

const VAULT_ROOT = path.join(process.cwd(), 'vault');
const RELATIVE_PATH = `overview-test-artifact-${Date.now()}.md`;
const DISK_PATH = path.join(VAULT_ROOT, RELATIVE_PATH);

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  try { fs.unlinkSync(DISK_PATH); } catch { /* best effort */ }
});

describe('Overview backend: empty workspace reports real zeros, never fabricated placeholders', () => {
  it('a brand-new, never-used workspace gets 0/0/0 everywhere, not a plausible-looking default', () => {
    const report = getWorkspaceOverview(WS_EMPTY);
    expect(report.tasks).toEqual({ total: 0, active: 0, done: 0, failed: 0 });
    expect(report.graphCount).toBe(0);
    expect(report.graphRunCount).toBe(0);
    expect(report.receiptCount).toBe(0);
    expect(report.vaultArtifactCount).toBe(0);
    expect(report.skillCount).toBe(0);
    expect(report.externalExecutionCount).toBe(0);
    expect(report.kil.total).toBe(0);
    // No observations means unknown, not a fabricated 0 — same convention
    // as summariseKil elsewhere in this codebase.
    expect(report.kil.promotionRate).toBeNull();
    expect(report.recentActivity).toEqual([]);
  });
});

describe('Overview backend: real task state changes real counts', () => {
  const taskId = `task-overview-${Date.now()}`;

  beforeAll(() => {
    createInitialTask({
      taskId,
      workspaceId: WS_A,
      title: 'Overview regression task',
      description: 'test',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });
  });

  it('a freshly created task (status TODO) counts as active, not done or failed', () => {
    const report = getWorkspaceOverview(WS_A);
    expect(report.tasks).toEqual({ total: 1, active: 1, done: 0, failed: 0 });
  });

  it('recent activity reflects the real task, with its real title', () => {
    const report = getWorkspaceOverview(WS_A);
    expect(report.recentActivity.length).toBeGreaterThan(0);
    const taskItem = report.recentActivity.find((a) => a.id === taskId);
    expect(taskItem).toBeTruthy();
    expect(taskItem?.label).toBe('Overview regression task');
  });

  it('moving the task to DONE moves the real count from active to done', () => {
    updateTaskStatus(taskId, 'DONE');
    const report = getWorkspaceOverview(WS_A);
    expect(report.tasks).toEqual({ total: 1, active: 0, done: 1, failed: 0 });
  });
});

describe('Overview backend: graphs, receipts, and Vault artifacts are real counts, not the fetch-page length', () => {
  const taskId = `task-overview-artifact-${Date.now()}`;
  const content = '# Overview regression artifact\n\nReal content, real file.';

  beforeAll(() => {
    createInitialTask({
      taskId,
      workspaceId: WS_A,
      title: 'Artifact task',
      description: 'test',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });

    saveGraph({
      graphId: `graph-overview-${Date.now()}`,
      workspaceId: WS_A,
      name: 'Overview regression graph',
      nodes: [],
      edges: [],
    });

    const artifact = recordArtifact({ taskId, relativePath: RELATIVE_PATH, diskPath: DISK_PATH, content });

    const review = recordQualityReview({
      taskId,
      reviewer: 'aegis',
      method: 'deterministic',
      score: 1,
      decision: 'PASS',
      checks: [{ check: 'content_integrity', status: 'PASS', evidence: 'sha256 match' }],
      evidence: { note: 'overview regression test' },
    });

    const payload: CanonicalReceiptPayload = {
      receiptId: `rcpt-overview-${Date.now()}`,
      taskId,
      reviewId: review.review_id,
      workspaceId: WS_A,
      assignedAgent: 'dev',
      provider: 'google',
      modelUsed: 'gemini-3.1-flash-lite',
      artifactId: artifact.artifact_id,
      artifactHash: artifact.content_hash,
      aegisDecision: 'PASS',
      aegisMethod: 'deterministic',
      createdAt: new Date().toISOString(),
    };
    const canonical = canonicalizePayload(payload);
    const signed = signReceiptPayload(canonical);
    recordReceipt({
      receiptId: payload.receiptId,
      taskId,
      reviewId: review.review_id,
      algorithm: signed.algorithm,
      publicKey: signed.publicKeyPem,
      payloadJson: canonical,
      signature: signed.signature,
    });
  });

  it('graphCount, vaultArtifactCount, and receiptCount reflect the real rows just created', () => {
    const report = getWorkspaceOverview(WS_A);
    expect(report.graphCount).toBe(1);
    expect(report.vaultArtifactCount).toBe(1);
    expect(report.receiptCount).toBe(1);
  });
});

describe('Overview backend: workspace isolation — B2, no cross-workspace bleed', () => {
  it('WS_B (never touched) still reports real zeros while WS_A has real data', () => {
    const reportA = getWorkspaceOverview(WS_A);
    const reportB = getWorkspaceOverview(WS_B);
    expect(reportA.tasks.total).toBeGreaterThan(0);
    expect(reportB.tasks.total).toBe(0);
    expect(reportB.graphCount).toBe(0);
    expect(reportB.vaultArtifactCount).toBe(0);
    expect(reportB.receiptCount).toBe(0);
  });
});

describe('Overview backend: no fabricated fields leak through', () => {
  it('the report never includes a "latency", "cpu", "throughput", "coherence", or "temperature" field', () => {
    const report = getWorkspaceOverview(WS_A) as any;
    for (const key of ['latency', 'cpu', 'throughput', 'coherence', 'temperature', 'synapse']) {
      expect(report[key]).toBeUndefined();
    }
  });
});
