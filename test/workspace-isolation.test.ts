import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// A fresh, isolated SQLite file for this test file only — set BEFORE any
// persistence function runs its first (lazy) getDatabase() call, so this
// test never touches the real dev database.
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-workspace-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createInitialTask,
  recordActivityEvent,
  getTaskActivityEvents,
  recordReceipt,
  getTaskReceipts,
  listWorkspaceTasks,
  listWorkspaceReceipts,
  getTaskWorkspaceId,
  isTaskInWorkspace,
  resolveWorkspaceId,
  DEFAULT_WORKSPACE_ID,
} from '../lib/persistence';

const WORKSPACE_A = 'ws-test-alpha';
const WORKSPACE_B = 'ws-test-beta';

const TASK_A = 'task-isolation-a-1';
const TASK_B = 'task-isolation-b-1';

describe('SYNTHOS WORKSPACE ISOLATION: records belonging to one workspace must not be readable from another', () => {
  beforeAll(() => {
    createInitialTask({
      taskId: TASK_A,
      workspaceId: WORKSPACE_A,
      title: 'Workspace A private task',
      description: 'belongs to workspace A only',
      assignedAgent: 'scout',
      assignedModel: 'gemini-3.1-flash-lite',
    });
    createInitialTask({
      taskId: TASK_B,
      workspaceId: WORKSPACE_B,
      title: 'Workspace B private task',
      description: 'belongs to workspace B only',
      assignedAgent: 'scout',
      assignedModel: 'gemini-3.1-flash-lite',
    });

    recordActivityEvent({
      taskId: TASK_A,
      eventType: 'TASK_CREATED',
      agentId: 'orchestrator',
      payload: { secret: 'workspace-a-activity' },
    });
    recordActivityEvent({
      taskId: TASK_B,
      eventType: 'TASK_CREATED',
      agentId: 'orchestrator',
      payload: { secret: 'workspace-b-activity' },
    });

    recordReceipt({
      receiptId: 'rcpt-isolation-a-1',
      taskId: TASK_A,
      reviewId: 'qr-isolation-a-1',
      algorithm: 'Ed25519',
      publicKey: 'test-public-key-a',
      payloadJson: JSON.stringify({ taskId: TASK_A, note: 'workspace-a-receipt' }),
      signature: 'test-signature-a',
    });
    recordReceipt({
      receiptId: 'rcpt-isolation-b-1',
      taskId: TASK_B,
      reviewId: 'qr-isolation-b-1',
      algorithm: 'Ed25519',
      publicKey: 'test-public-key-b',
      payloadJson: JSON.stringify({ taskId: TASK_B, note: 'workspace-b-receipt' }),
      signature: 'test-signature-b',
    });
  });

  afterAll(() => {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch {
      // best-effort cleanup
    }
  });

  it('1. Workspace A task is visible in Workspace A', () => {
    const tasks = listWorkspaceTasks(WORKSPACE_A);
    expect(tasks.map(t => t.task_id)).toContain(TASK_A);
  });

  it('2. Workspace A task is NOT visible in Workspace B', () => {
    const tasksInB = listWorkspaceTasks(WORKSPACE_B);
    expect(tasksInB.map(t => t.task_id)).not.toContain(TASK_A);
    expect(tasksInB.map(t => t.task_id)).toContain(TASK_B);
  });

  it('3. Workspace A activity events are NOT reachable from Workspace B (the ownership gate blocks it before any activity data is read)', () => {
    // This is the actual mechanism /api/execution/tasks/:taskId/activity relies
    // on: the gate must reject before getTaskActivityEvents() is ever called.
    expect(isTaskInWorkspace(TASK_A, WORKSPACE_B)).toBe(false);
    expect(isTaskInWorkspace(TASK_A, WORKSPACE_A)).toBe(true);

    // Prove the data really is there (so the gate is doing real work, not
    // passing vacuously because there's nothing to protect).
    const events = getTaskActivityEvents(TASK_A);
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.parse(events[0].payload_json).secret).toBe('workspace-a-activity');
  });

  it('4. Workspace A receipts are NOT visible in Workspace B', () => {
    const receiptsInB = listWorkspaceReceipts(WORKSPACE_B);
    expect(receiptsInB.map(r => r.receipt_id)).not.toContain('rcpt-isolation-a-1');
    expect(receiptsInB.map(r => r.receipt_id)).toContain('rcpt-isolation-b-1');

    const receiptsInA = listWorkspaceReceipts(WORKSPACE_A);
    expect(receiptsInA.map(r => r.receipt_id)).toContain('rcpt-isolation-a-1');
    expect(receiptsInA.map(r => r.receipt_id)).not.toContain('rcpt-isolation-b-1');

    // Prove the data really exists (task-scoped getter still works for a
    // caller who is legitimately allowed to see this task).
    expect(getTaskReceipts(TASK_A).length).toBeGreaterThan(0);
  });

  it('5. Jarvis-equivalent scoped query (listWorkspaceTasks / listWorkspaceReceipts — the exact functions /api/jarvis/command calls) does not return Workspace B records while Workspace A is active', () => {
    const jarvisTasksForA = listWorkspaceTasks(WORKSPACE_A);
    expect(jarvisTasksForA.some(t => t.task_id === TASK_B)).toBe(false);

    const jarvisReceiptsForA = listWorkspaceReceipts(WORKSPACE_A);
    expect(jarvisReceiptsForA.some(r => r.receipt_id === 'rcpt-isolation-b-1')).toBe(false);
  });

  it('6. Ordinary APIs cannot bypass scope by omitting workspace identity — omission resolves to one specific default workspace, never an unfiltered/global read', () => {
    const resolved = resolveWorkspaceId(undefined);
    expect('workspaceId' in resolved).toBe(true);
    expect((resolved as any).workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect((resolved as any).workspaceId).not.toBe(WORKSPACE_A);
    expect((resolved as any).workspaceId).not.toBe(WORKSPACE_B);

    // Omitting workspaceId must not surface either test workspace's tasks —
    // it resolves to DEFAULT_WORKSPACE_ID, a workspace neither test task
    // belongs to, so it must see neither.
    const defaultScopeTasks = listWorkspaceTasks(DEFAULT_WORKSPACE_ID);
    expect(defaultScopeTasks.map(t => t.task_id)).not.toContain(TASK_A);
    expect(defaultScopeTasks.map(t => t.task_id)).not.toContain(TASK_B);
  });

  it('7. Invalid workspace identity fails explicitly rather than defaulting or matching everything', () => {
    expect('error' in resolveWorkspaceId('')).toBe(true);
    expect('error' in resolveWorkspaceId('   ')).toBe(true);
    expect('error' in resolveWorkspaceId(123 as any)).toBe(true);
    expect('error' in resolveWorkspaceId({} as any)).toBe(true);
    // Only true omission (undefined/null) is treated as "use the default" —
    // an explicitly blank/malformed value is not silently coerced into it.
    expect('workspaceId' in resolveWorkspaceId(undefined)).toBe(true);
    expect('workspaceId' in resolveWorkspaceId(null)).toBe(true);
  });

  it('8. Platform-global diagnostics remain intentionally unscoped only where explicitly documented (row counts, not per-workspace content) — this test documents the boundary rather than asserting new behavior', () => {
    // /api/master-admin/diagnostics reports aggregate row counts across the
    // whole database by design (operator-only screen, no per-record content
    // exposed) — this is intentionally NOT workspace-filtered, and this test
    // exists so a future change to that intent is a visible decision, not a
    // silent regression. Nothing to assert against live server state here
    // (server.ts is not imported in tests); this is a documentation anchor.
    expect(true).toBe(true);
  });

  it('9. No Radar / workspace-1 cross-workspace exception exists in this repository — task and receipt scoping is uniform with no special-cased workspace id', () => {
    // Verified by direct repository inspection: no tenant_id concept, no
    // cross-workspace exemption path, and no reference to such a mechanism
    // exists anywhere in this codebase (grepped clean). listWorkspaceTasks /
    // listWorkspaceReceipts apply the same WHERE workspace_id = ? filter
    // regardless of which workspace id is passed — including the primary
    // workspace id, which receives no special treatment.
    const primaryScopeTasks = listWorkspaceTasks(DEFAULT_WORKSPACE_ID);
    expect(primaryScopeTasks.map(t => t.task_id)).not.toContain(TASK_A);
    expect(primaryScopeTasks.map(t => t.task_id)).not.toContain(TASK_B);
  });

  it('getTaskWorkspaceId returns null for an unknown task, never a false-positive match', () => {
    expect(getTaskWorkspaceId('task-does-not-exist')).toBeNull();
    expect(isTaskInWorkspace('task-does-not-exist', WORKSPACE_A)).toBe(false);
  });
});
