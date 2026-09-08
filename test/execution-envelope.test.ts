import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-envelope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;
delete process.env.GEMINI_API_KEY;
delete process.env.WINDMILL_BASE_URL;
delete process.env.WINDMILL_TOKEN;
delete process.env.WINDMILL_WORKSPACE;

import { executeEnvelope } from '../lib/fabric/envelope';
import { classifyMcpOperation } from '../lib/fabric/registry';
import { getDatabase, getTaskReceipts, createInitialTask } from '../lib/persistence';
import { VAULT_ROOT } from '../lib/vault';
import { ensureWorkspace } from '../lib/workspaces';

const WS = `ws-envelope-test-${Date.now()}`;

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', WS), { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('STEP 6 Section 9: NOT_CONFIGURED/UNSUPPORTED capabilities refuse honestly, never execute', () => {
  it('hermes.execute refuses — the stub never runs', async () => {
    const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'hermes.execute', action: 'hermes.execute', parameters: {}, rawText: 'hermes do X' });
    expect(result.outcome).toBe('NOT_CONFIGURED');
  });

  it('STEP 7: schedule is real now — a bare, time-ambiguous phrase is honestly BLOCKED with a clarification, never a silently-guessed time', async () => {
    // "schedule this tomorrow" has no explicit time attached ("tomorrow at
    // 9am" would succeed) — refused rather than inventing an hour.
    const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'schedule', action: 'schedule', parameters: {}, rawText: 'schedule this tomorrow' });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.reason).toMatch(/no time attached/i);
  });

  it('research refuses without GEMINI_API_KEY — never falls back to model memory', async () => {
    const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'research', action: 'research', parameters: {}, rawText: 'research the latest AI repos' });
    expect(result.outcome).toBe('NOT_CONFIGURED');
  });

  it('an unregistered capability key returns NOT_CONFIGURED, never a fabricated executor', async () => {
    const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'not.a.real.capability', action: 'x', parameters: {}, rawText: 'x' });
    expect(result.outcome).toBe('NOT_CONFIGURED');
  });
});

describe('STEP 6 Section 7: EXTERNAL_ACTION capabilities without real Guardian enforcement are BLOCKED, never executed on advisory policy alone', () => {
  it('windmill.job is blocked even when Windmill IS configured, because no real Guardian enforcement wraps submission', async () => {
    process.env.WINDMILL_BASE_URL = 'http://127.0.0.1:1';
    process.env.WINDMILL_TOKEN = 'fake';
    process.env.WINDMILL_WORKSPACE = 'fake';
    try {
      const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'windmill.job', action: 'windmill.job', parameters: {}, rawText: 'submit a windmill job' });
      expect(result.outcome).toBe('BLOCKED');
      expect(result.reason).toMatch(/Guardian enforcement/);
    } finally {
      delete process.env.WINDMILL_BASE_URL;
      delete process.env.WINDMILL_TOKEN;
      delete process.env.WINDMILL_WORKSPACE;
    }
  });

  it('MCP outward action without enforced Guardian is blocked from the envelope: classifyMcpOperation correctly flags an EXTERNAL_ACTION operation as approvalPolicy RECOMMENDED_NOT_ENFORCED, and the same rule that blocks windmill.job blocks any EXTERNAL_ACTION capability lacking GUARDIAN_ENFORCED — proven here in combination since Jarvis has no natural-language path in Step 6 that names a specific MCP tool call to route end-to-end', () => {
    const classification = classifyMcpOperation('mcp.delete_issue');
    expect(classification.effectClass).toBe('EXTERNAL_ACTION');
    expect(classification.approvalPolicy).toBe('RECOMMENDED_NOT_ENFORCED');
    // The envelope's own rule (verified live above for windmill.job) refuses
    // any capability whose approvalPolicy !== 'GUARDIAN_ENFORCED' when its
    // effectClass is EXTERNAL_ACTION — an MCP operation classified this way
    // would be refused by the identical check, not a different one.
    expect(classification.approvalPolicy).not.toBe('GUARDIAN_ENFORCED');
  });

  it('terminal.exec is exempt from the BLOCKED rule because it has real, wired Guardian enforcement — it returns APPROVAL_REQUIRED, not BLOCKED', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'terminal.exec', action: 'terminal.exec', parameters: {}, rawText: 'run rm -rf /' });
      expect(result.outcome).toBe('APPROVAL_REQUIRED');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe('STEP 6: READ capabilities return real data, create zero receipts/artifacts, and stay workspace-isolated', () => {
  it('task.read returns real workspace-scoped data with no receipt created', async () => {
    ensureWorkspace(WS, 'Envelope Test Workspace');
    createInitialTask({ taskId: `task-envelope-${Date.now()}`, workspaceId: WS, title: 'Real task', description: 'test', assignedAgent: 'dev', assignedModel: 'gemini-3.1-flash-lite' });
    const db = getDatabase();
    const receiptsBefore = (db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as any).n;

    const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'task.read', action: 'task.read', parameters: {}, rawText: 'show me my tasks' });
    expect(result.outcome).toBe('READ_OK');
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as any[]).length).toBeGreaterThan(0);

    const receiptsAfter = (db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as any).n;
    expect(receiptsAfter).toBe(receiptsBefore);
  });

  it('a different workspace never sees the first workspace\'s task.read results', async () => {
    const otherWs = `ws-envelope-other-${Date.now()}`;
    ensureWorkspace(otherWs, 'Other');
    const result = await executeEnvelope({ workspaceId: otherWs, actorUserId: 'u2', capability: 'task.read', action: 'task.read', parameters: {}, rawText: 'show me my tasks' });
    expect(result.outcome).toBe('READ_OK');
    expect(result.data).toEqual([]);
  });
});

describe('STEP 6: vault.write is the one explicit, canonical-policy exemption from the EXTERNAL_ACTION Guardian rule', () => {
  it('vault.write executes and produces a real, workspace-scoped artifact', async () => {
    const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write', parameters: {}, rawText: 'save this note' });
    expect(result.outcome).toBe('SUCCESS');
    expect(result.artifact?.path).toContain(`workspaces/${WS}/Jarvis-Notes/`);
    const onDisk = fs.existsSync(path.join(VAULT_ROOT, ...(result.artifact!.path.split('/'))));
    expect(onDisk).toBe(true);
    // No Aegis/receipt for vault.write — canonical policy already approved.
    expect(result.aegis).toBeUndefined();
    expect(result.receipt).toBeUndefined();
  });
});
