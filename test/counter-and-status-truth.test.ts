import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-counter-truth-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'counter.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { getRuntimeStatus, providerStateToRuntimeStatus } from '../lib/runtime-status';
import { recordProviderAttempt } from '../lib/provider-state';
import { getWorkspaceOverview } from '../lib/overview';
import { createInitialTask, getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { recordRuntimeEvent, listRecentRuntimeEvents } from '../lib/runtime-events';

// ---------------------------------------------------------------------------
// THE ADMIN MUST NOT MISREPORT WHAT EXISTS.
//
// Two failure shapes, both found in this repo:
//
//   1. A status that overclaims. `model.openai` read AVAILABLE while every
//      real call returned HTTP 429 no-credits.
//   2. A panel that fabricates. ClaudeArtifactsView rendered three invented
//      artifacts from a hardcoded array while the real store held 48.
//
// Overclaiming and fabricating are the same bug in opposite directions: the
// screen asserts something the runtime cannot back.
// ---------------------------------------------------------------------------

const WS = 'ws-counter-truth';
const OTHER_WS = 'ws-counter-other';

beforeAll(() => {
  ensureWorkspace(WS, 'Counter Truth Workspace');
  ensureWorkspace(OTHER_WS, 'Other Workspace');
});

describe('runtime-status keeps its contract while telling the truth', () => {
  // Three components consume this array: AirbyteHeader, OverviewOfficeView,
  // MasterAdminView. Changing the outer shape to be tidier would break all
  // three, so the canonical state is ADDITIVE.
  it('every row still carries the five fields existing consumers read', async () => {
    const report = await getRuntimeStatus();
    expect(report.systems.length).toBeGreaterThan(0);
    for (const s of report.systems) {
      expect(typeof s.system).toBe('string');
      expect(typeof s.status).toBe('string');
      expect(typeof s.evidenceSource).toBe('string');
      expect(Object.prototype.hasOwnProperty.call(s, 'lastCheck')).toBe(true);
    }
  });

  it('the outer status vocabulary is unchanged, so no badge breaks', async () => {
    const LEGAL = new Set(['HEALTHY', 'DEGRADED', 'NOT_CONFIGURED', 'NOT_IMPLEMENTED', 'FAILED', 'UNKNOWN']);
    const report = await getRuntimeStatus();
    for (const s of report.systems) {
      expect(LEGAL.has(s.status), `${s.system} introduced a new outer status "${s.status}"`).toBe(true);
    }
  });

  it('provider rows add the canonical state alongside the old fields', async () => {
    const report = await getRuntimeStatus();
    const openai = report.systems.find((s) => s.system === 'OpenAI Provider');
    expect(openai?.provider).toBeTruthy();
    expect(openai?.provider?.state).toBeTruthy();
    // The fields the brief asked to expose.
    for (const key of ['state', 'configured', 'enabled', 'lastVerifiedAt', 'lastErrorCategory']) {
      expect(Object.prototype.hasOwnProperty.call(openai!.provider!, key), `missing ${key}`).toBe(true);
    }
  });

  // The mapping must never be more optimistic than reality.
  it('HEALTHY is reachable only from LIVE_VERIFIED', () => {
    expect(providerStateToRuntimeStatus('LIVE_VERIFIED')).toBe('HEALTHY');
    for (const st of ['NO_CREDENTIAL', 'CREDENTIAL_PRESENT', 'QUOTA_BLOCKED', 'PROVIDER_ERROR', 'NOT_CONFIGURED', 'DISABLED', 'BROKEN_UPSTREAM'] as const) {
      expect(providerStateToRuntimeStatus(st), `${st} must not map to HEALTHY`).not.toBe('HEALTHY');
    }
  });

  it('a quota-blocked provider is DEGRADED outside and QUOTA_BLOCKED inside', async () => {
    getDatabase().prepare('DELETE FROM runtime_events').run();
    process.env.OPENAI_API_KEY = 'sk-test-counter-truth-key';
    try {
      recordProviderAttempt({ provider: 'openai', ok: false, errorMessage: 'OpenAI HTTP 429: You have no credits remaining.' });
      const report = await getRuntimeStatus();
      const row = report.systems.find((s) => s.system === 'OpenAI Provider')!;
      expect(row.provider?.state).toBe('QUOTA_BLOCKED');
      expect(row.status).toBe('DEGRADED');
      expect(row.status).not.toBe('HEALTHY');
      expect(row.provider?.lastErrorCategory).toBe('QUOTA_OR_BILLING');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('Hermes reads BROKEN_UPSTREAM, not NOT_CONFIGURED — a missing setting is not the problem', async () => {
    const report = await getRuntimeStatus();
    const row = report.systems.find((s) => s.system === 'Hermes Local Runtime (CLI)');
    if (row?.provider) {
      expect(row.provider.state).toBe('BROKEN_UPSTREAM');
      expect(row.detail).toMatch(/upstream/i);
    } else {
      // No CLI on this machine — then NOT_CONFIGURED is the honest answer.
      expect(row?.status).toBe('NOT_CONFIGURED');
    }
  });

  it('MCP is NOT_CONFIGURED, never NOT_IMPLEMENTED — the probe exists', async () => {
    const report = await getRuntimeStatus();
    const mcp = report.systems.find((s) => s.system === 'MCP Connectivity')!;
    expect(mcp.status).toBe('NOT_CONFIGURED');
    expect(mcp.status).not.toBe('NOT_IMPLEMENTED');
  });

  it('a disabled runtime with no credential names BOTH gates, not just one', async () => {
    const report = await getRuntimeStatus();
    const ag = report.systems.find((s) => s.system === 'Antigravity Runtime')!;
    if (ag.provider?.state === 'DISABLED' && ag.provider.configured === false) {
      // Otherwise an operator flips the flag and finds it still does not work.
      expect(ag.detail).toMatch(/no credential/i);
    }
    expect(ag.status).not.toBe('HEALTHY');
  });
});

describe('counters come from the canonical store, scoped to one workspace', () => {
  beforeEach(() => {
    getDatabase().prepare('DELETE FROM tasks').run();
  });

  it('a task in another workspace is never counted in this one', () => {
    createInitialTask({
      taskId: 'task-counter-mine', workspaceId: WS, title: 'Mine', description: '',
      assignedAgent: 'scout', assignedModel: 'gemini-3.1-flash-lite', createdAt: new Date().toISOString(),
    });
    createInitialTask({
      taskId: 'task-counter-theirs', workspaceId: OTHER_WS, title: 'Theirs', description: '',
      assignedAgent: 'scout', assignedModel: 'gemini-3.1-flash-lite', createdAt: new Date().toISOString(),
    });

    expect(getWorkspaceOverview(WS).tasks.total).toBe(1);
    expect(getWorkspaceOverview(OTHER_WS).tasks.total).toBe(1);
  });

  it('an empty workspace reports a real zero, distinguishable from a broken query', () => {
    const o = getWorkspaceOverview('ws-genuinely-empty');
    expect(o.tasks.total).toBe(0);
    expect(o.graphCount).toBe(0);
    expect(o.receiptCount).toBe(0);
    // A real zero still carries a generated timestamp — proof the query ran.
    expect(o.generatedAt).toBeTruthy();
  });

  // Graph definitions and graph runs are different things and were reported
  // as one number in conversation. The overview keeps them separate.
  it('graph definitions and graph runs are reported as separate counts', () => {
    const o = getWorkspaceOverview(WS);
    expect(Object.prototype.hasOwnProperty.call(o, 'graphCount')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(o, 'graphRunCount')).toBe(true);
  });

  // Pass 2 made blocked/failed attempts durable. Those are evidence, not
  // receipts, and must never inflate a signed-receipt count.
  it('attempt evidence is never counted as a signed receipt', () => {
    recordRuntimeEvent({
      workspaceId: WS, eventType: 'CAPABILITY_INVOCATION', targetType: 'capability',
      targetId: 'some.capability', status: 'BLOCKED', detail: { outcome: 'BLOCKED' },
    });
    const o = getWorkspaceOverview(WS);
    const receiptRows = (getDatabase().prepare('SELECT COUNT(*) AS n FROM receipts').get() as any).n;
    expect(o.receiptCount).toBe(receiptRows);
    expect(o.receiptCount).toBe(0);
  });
});

describe('no production panel fabricates rows', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('ClaudeArtifactsView reads the canonical Vault store, not a hardcoded array', () => {
    const view = read('src/components/ClaudeArtifactsView.tsx');
    expect(view).toContain('/api/vault?workspaceId=');
    // The invented artifacts that used to ship in production.
    expect(view).not.toContain('Decentralized Agent Fleet Health HUD');
    expect(
      /useState<ClaudeArtifact\[\]>\(\[\s*\{/.test(view),
      'ClaudeArtifactsView is seeding state with a literal artifact again',
    ).toBe(false);
  });

  it('its count reports UNKNOWN on a failed fetch rather than 0', () => {
    const view = read('src/components/ClaudeArtifactsView.tsx');
    // 0 on error is a fabricated fact: the real answer is "we could not tell".
    expect(view).toContain("artifactsError ? 'UNKNOWN'");
  });

  it('fields the Vault does not carry are reported UNKNOWN, not invented', () => {
    const view = read('src/components/ClaudeArtifactsView.tsx');
    expect(view).toContain("agentRole: 'UNKNOWN'");
    expect(view).toContain("modelName: 'UNKNOWN'");
  });

  it('the Brain surface still renders real vault notes only', () => {
    const view = read('src/components/ObsidianView.tsx');
    expect(view).toContain('/api/knowledge/mesh');
    expect(/<ObsidianGraphMind[\s\S]{0,200}notes=\{notes\}/.test(view)).toBe(false);
    // No fixture business names in the production Brain surface.
    expect(view).not.toContain('Northgate');
  });

  it('mockData is not imported by any production view rewired in these passes', () => {
    for (const rel of ['src/components/ObsidianView.tsx', 'src/components/ClaudeArtifactsView.tsx']) {
      expect(read(rel)).not.toMatch(/from '\.\.\/data\/mockData'/);
    }
  });
});

describe('provider event ordering stays deterministic', () => {
  beforeEach(() => {
    getDatabase().prepare('DELETE FROM runtime_events').run();
  });

  // ISO timestamps have millisecond resolution, so two events in the same
  // millisecond is routine. Ordering on created_at alone made "the latest
  // call" non-deterministic and let a superseded success read as current.
  it('success then failure in the same millisecond → failure is latest', () => {
    recordProviderAttempt({ provider: 'p-order', ok: true, modelUsed: 'm' });
    recordProviderAttempt({ provider: 'p-order', ok: false, errorMessage: 'HTTP 500 upstream' });
    const events = listRecentRuntimeEvents({ targetType: 'provider', limit: 10 })
      .filter((e) => e.target_id === 'p-order');
    expect(events[0].status).toBe('FAILED');
  });

  it('failure then success in the same millisecond → success is latest', () => {
    recordProviderAttempt({ provider: 'p-order2', ok: false, errorMessage: 'HTTP 500 upstream' });
    recordProviderAttempt({ provider: 'p-order2', ok: true, modelUsed: 'm' });
    const events = listRecentRuntimeEvents({ targetType: 'provider', limit: 10 })
      .filter((e) => e.target_id === 'p-order2');
    expect(events[0].status).toBe('SUCCESS');
  });

  it('the ledger read and both prune paths all use the rowid tiebreaker', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/runtime-events.ts'), 'utf8');
    expect(source).toContain('ORDER BY created_at DESC, rowid DESC');
    const ascOrders = source.match(/ORDER BY created_at ASC, rowid ASC/g) || [];
    expect(ascOrders.length).toBe(2);
  });
});
