import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-graph-iso-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  saveGraph,
  getGraph,
  listGraphs,
  saveGraphRun,
  getGraphRun,
  listGraphRuns,
  createInitialTask,
  recordReceipt,
  getTaskReceipts,
  verifyReceipt,
  listWorkspaceTasks,
} from '../lib/persistence';

const WS_A = 'ws-graph-test-alpha';
const WS_B = 'ws-graph-test-beta';

afterAll(() => {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {
    // best-effort cleanup
  }
});

describe('Graph workspace isolation', () => {
  const graphIdA = 'graph-iso-a-1';

  beforeAll(() => {
    saveGraph({
      graphId: graphIdA,
      workspaceId: WS_A,
      name: 'Workspace A graph',
      nodes: [{ id: 'n1' }],
      edges: [],
    });
  });

  it('1. a graph created in Workspace A belongs to A', () => {
    const g = getGraph(graphIdA, WS_A);
    expect(g).not.toBeNull();
    expect(g?.workspace_id).toBe(WS_A);
  });

  it('2. Workspace B cannot list it', () => {
    const graphsInB = listGraphs(WS_B);
    expect(graphsInB.map((g) => g.graph_id)).not.toContain(graphIdA);
    const graphsInA = listGraphs(WS_A);
    expect(graphsInA.map((g) => g.graph_id)).toContain(graphIdA);
  });

  it('3. Workspace B cannot fetch it by ID (same as not-found, no existence disclosure)', () => {
    expect(getGraph(graphIdA, WS_B)).toBeNull();
    expect(getGraph('graph-does-not-exist-at-all', WS_A)).toBeNull();
  });

  it('saveGraph rejects a save into an existing graph_id owned by a different workspace', () => {
    expect(() =>
      saveGraph({ graphId: graphIdA, workspaceId: WS_B, name: 'Hijack attempt', nodes: [], edges: [] })
    ).toThrow();
    // Confirm the original owner and content are unaffected by the rejected attempt.
    const stillA = getGraph(graphIdA, WS_A);
    expect(stillA?.workspace_id).toBe(WS_A);
    expect(stillA?.name).toBe('Workspace A graph');
  });

  it('5. a graph_run inherits its graph\'s workspace, not a caller-supplied value', () => {
    const run = saveGraphRun({
      runId: 'run-iso-a-1',
      graphId: graphIdA,
      status: 'RUNNING',
      state: {},
    });
    expect(run.workspace_id).toBe(WS_A);
  });

  it('8. a caller cannot override the graph\'s workspace when creating a run', () => {
    expect(() =>
      saveGraphRun({
        runId: 'run-iso-a-hijack',
        graphId: graphIdA,
        workspaceId: WS_B,
        status: 'RUNNING',
        state: {},
      })
    ).toThrow();
  });

  it('6. Workspace B cannot read Workspace A\'s graph_run', () => {
    expect(getGraphRun('run-iso-a-1', WS_B)).toBeNull();
    expect(getGraphRun('run-iso-a-1', WS_A)).not.toBeNull();

    const runsInB = listGraphRuns(WS_B);
    expect(runsInB.map((r) => r.run_id)).not.toContain('run-iso-a-1');
  });

  it('updating an existing run never changes its workspace_id', () => {
    const updated = saveGraphRun({
      runId: 'run-iso-a-1',
      graphId: graphIdA,
      status: 'COMPLETED',
      state: { done: true },
    });
    expect(updated.workspace_id).toBe(WS_A);
    expect(getGraphRun('run-iso-a-1', WS_B)).toBeNull();
  });

  it('saveGraphRun rejects creating a run for a graph that does not exist', () => {
    expect(() =>
      saveGraphRun({ runId: 'run-orphan', graphId: 'graph-does-not-exist', status: 'RUNNING', state: {} })
    ).toThrow();
  });
});

describe('Graph-spawned task inherits the graph\'s workspace (7), receipt gate still functions (10)', () => {
  it('7. a task spawned for a graph node is created under the graph\'s workspace, not a default', () => {
    // This mirrors what /api/graphs/execute does: it resolves the graph's
    // workspace once, then creates each node's task with that exact value —
    // never a hardcoded constant. We verify the underlying primitive here
    // (createInitialTask honoring an explicit workspaceId), since exercising
    // the full HTTP route would require a running server.
    const taskId = 'task-graph-iso-spawn-1';
    createInitialTask({
      taskId,
      workspaceId: WS_A,
      title: 'Spawned node task',
      description: 'from graph execution',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });
    // Real, existing workspace-scoped accessor — proves the task really
    // landed in WS_A, not e.g. the old hardcoded 'ws-synthos-primary'.
    const tasksInA = listWorkspaceTasks(WS_A, 50);
    expect(tasksInA.map((t) => t.task_id)).toContain(taskId);
    const tasksInDefault = listWorkspaceTasks('ws-synthos-primary', 50);
    expect(tasksInDefault.map((t) => t.task_id)).not.toContain(taskId);
  });

  it('10. the existing receipt gate still functions after these schema changes', () => {
    const taskId = 'task-graph-iso-receipt-1';
    createInitialTask({
      taskId,
      workspaceId: WS_A,
      title: 'Receipt gate check',
      description: 'test',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });
    recordReceipt({
      receiptId: 'rcpt-graph-iso-1',
      taskId,
      reviewId: 'qr-graph-iso-1',
      algorithm: 'Ed25519',
      publicKey: 'test-key',
      payloadJson: JSON.stringify({ taskId }),
      signature: 'test-signature',
    });
    const receipts = getTaskReceipts(taskId);
    expect(receipts).toHaveLength(1);
    // verifyReceipt() checks the real Ed25519 signature — a fabricated
    // signature/key pair (as used above for a persistence-layer test) must
    // correctly fail cryptographic verification, proving the gate is real
    // and not a rubber stamp.
    expect(verifyReceipt(receipts[0])).toBe(false);
  });
});

describe('9. Jarvis graph query respects workspace (tested via the underlying accessors it calls)', () => {
  it('listGraphs/listGraphRuns — the exact functions /api/jarvis/command\'s ADMIN_GRAPH_QUERY calls — never cross workspaces', () => {
    saveGraph({ graphId: 'graph-jarvis-iso-a', workspaceId: WS_A, name: 'A', nodes: [{ id: 'n1' }], edges: [] });
    saveGraph({ graphId: 'graph-jarvis-iso-b', workspaceId: WS_B, name: 'B', nodes: [{ id: 'n1' }], edges: [] });

    const graphsForA = listGraphs(WS_A);
    expect(graphsForA.some((g) => g.graph_id === 'graph-jarvis-iso-b')).toBe(false);
    expect(graphsForA.some((g) => g.graph_id === 'graph-jarvis-iso-a')).toBe(true);

    saveGraphRun({ runId: 'run-jarvis-iso-a', graphId: 'graph-jarvis-iso-a', status: 'RUNNING', state: {} });
    saveGraphRun({ runId: 'run-jarvis-iso-b', graphId: 'graph-jarvis-iso-b', status: 'RUNNING', state: {} });

    const runsForA = listGraphRuns(WS_A);
    expect(runsForA.some((r) => r.run_id === 'run-jarvis-iso-b')).toBe(false);
    expect(runsForA.some((r) => r.run_id === 'run-jarvis-iso-a')).toBe(true);
  });
});
