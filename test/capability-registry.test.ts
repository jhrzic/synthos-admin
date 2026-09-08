import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-registry-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { listCapabilities, resolveCapability, classifyMcpOperation } from '../lib/fabric/registry';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

// ---------------------------------------------------------------------------
// STEP 5 — capability registry truth tests. Every assertion here is driven
// by real env/config manipulation, not a mocked status object — the point
// is proving the registry derives status from actual evidence, matching
// lib/runtime-status.ts's own already-live-probing sources.
// ---------------------------------------------------------------------------

// NOTE: fn is always async here — the finally block must await it before
// restoring env vars, otherwise the restore runs on the next microtask
// tick, before fn()'s own internal awaits ever observe the override.
async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('model.gemini: status derived from real GEMINI_API_KEY presence', () => {
  it('AVAILABLE when GEMINI_API_KEY is set', async () => {
    await withEnv({ GEMINI_API_KEY: 'test-key-for-registry' }, async () => {
      const cap = await resolveCapability('model.gemini');
      expect(cap?.status).toBe('AVAILABLE');
      expect(cap?.effectClass).toBe('COMPUTE');
    });
  });

  it('NOT_CONFIGURED when GEMINI_API_KEY is absent', async () => {
    await withEnv({ GEMINI_API_KEY: undefined }, async () => {
      const cap = await resolveCapability('model.gemini');
      expect(cap?.status).toBe('NOT_CONFIGURED');
    });
  });
});

describe('windmill.job: status derived from real WINDMILL_* env presence', () => {
  it('NOT_CONFIGURED when Windmill env is missing', async () => {
    await withEnv({ WINDMILL_BASE_URL: undefined, WINDMILL_TOKEN: undefined, WINDMILL_WORKSPACE: undefined }, async () => {
      const cap = await resolveCapability('windmill.job');
      expect(cap?.status).toBe('NOT_CONFIGURED');
      expect(cap?.effectClass).toBe('EXTERNAL_ACTION');
    });
  });
});

describe('hermes.execute: the stub never reports AVAILABLE, regardless of connectivity config', () => {
  it('UNSUPPORTED even with HERMES_ADAPTER_BASE_URL unset', async () => {
    await withEnv({ HERMES_ADAPTER_BASE_URL: undefined }, async () => {
      const cap = await resolveCapability('hermes.execute');
      expect(cap?.status).not.toBe('AVAILABLE');
      expect(['NOT_CONFIGURED', 'UNSUPPORTED']).toContain(cap?.status);
    });
  });

  it('still UNSUPPORTED (never AVAILABLE) even if HERMES_ADAPTER_BASE_URL were configured, because execute() itself has no real contract', async () => {
    await withEnv({ HERMES_ADAPTER_BASE_URL: 'http://127.0.0.1:1' }, async () => {
      const cap = await resolveCapability('hermes.execute');
      expect(cap?.status).not.toBe('AVAILABLE');
      expect(cap?.status).toBe('UNSUPPORTED');
    });
  }, 10000);
});

describe('vault.read / vault.write: AVAILABLE when the canonical Vault store/writer is reachable', () => {
  it('vault.read is AVAILABLE (real vault/ directory exists in this repo) and READ', async () => {
    const cap = await resolveCapability('vault.read');
    expect(cap?.status).toBe('AVAILABLE');
    expect(cap?.effectClass).toBe('READ');
  });

  it('vault.write is AVAILABLE and EXTERNAL_ACTION per canonical policy', async () => {
    const cap = await resolveCapability('vault.write');
    expect(cap?.status).toBe('AVAILABLE');
    expect(cap?.effectClass).toBe('EXTERNAL_ACTION');
  });
});

describe('memory.search: AVAILABLE when the FTS5 memory index is reachable, and READ', () => {
  it('AVAILABLE + READ', async () => {
    const cap = await resolveCapability('memory.search');
    expect(cap?.status).toBe('AVAILABLE');
    expect(cap?.effectClass).toBe('READ');
  });
});

describe('terminal.exec: APPROVAL_REQUIRED per existing Guardian policy (outside production)', () => {
  it('APPROVAL_REQUIRED, EXTERNAL_ACTION, CRITICAL risk, GUARDIAN_ENFORCED', async () => {
    await withEnv({ NODE_ENV: 'development' }, async () => {
      const cap = await resolveCapability('terminal.exec');
      expect(cap?.status).toBe('APPROVAL_REQUIRED');
      expect(cap?.effectClass).toBe('EXTERNAL_ACTION');
      expect(cap?.riskTier).toBe('CRITICAL');
      expect(cap?.approvalPolicy).toBe('GUARDIAN_ENFORCED');
    });
  });

  it('UNSUPPORTED in production — structurally disabled regardless of role', async () => {
    await withEnv({ NODE_ENV: 'production' }, async () => {
      const cap = await resolveCapability('terminal.exec');
      expect(cap?.status).toBe('UNSUPPORTED');
    });
  });
});

describe('browser / research: honestly NOT_CONFIGURED — no code exists for either', () => {
  it('STEP 7: schedule is now AVAILABLE — a real in-process scheduler exists (lib/fabric/scheduler.ts)', async () => {
    const cap = await resolveCapability('schedule');
    expect(cap?.status).toBe('AVAILABLE');
    expect(cap?.reference).toBe('lib/fabric/scheduler.ts');
  });

  it('browser is NOT_CONFIGURED (no browser capability exists)', async () => {
    const cap = await resolveCapability('browser');
    expect(cap?.status).toBe('NOT_CONFIGURED');
  });

  it('research (live web/GitHub search) is NOT_CONFIGURED — perplexity/sonar are recognized-but-unsupported, never silently substituted', async () => {
    const cap = await resolveCapability('research');
    expect(cap?.status).toBe('NOT_CONFIGURED');
  });
});

describe('listCapabilities(): every registered capability status comes from the allowed vocabulary, never a literal', () => {
  it('every status is one of the 5 allowed values', async () => {
    const caps = await listCapabilities();
    expect(caps.length).toBeGreaterThan(0);
    const allowed = new Set(['AVAILABLE', 'DEGRADED', 'NOT_CONFIGURED', 'UNSUPPORTED', 'APPROVAL_REQUIRED']);
    for (const cap of caps) {
      expect(allowed.has(cap.status), `${cap.key} has an unrecognized status "${cap.status}"`).toBe(true);
    }
  });

  it('resolveCapability returns null for an unregistered key, never a fabricated entry', async () => {
    const cap = await resolveCapability('not.a.real.capability');
    expect(cap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CANONICAL POLICY — MCP is a transport, not a risk class. These tests
// exercise the real classifier against the exact operation-name shapes the
// canonical policy specifies.
// ---------------------------------------------------------------------------
describe('classifyMcpOperation: transport-agnostic, verb-driven classification', () => {
  it('mcp.search -> READ', () => {
    expect(classifyMcpOperation('mcp.search').effectClass).toBe('READ');
  });
  it('mcp.list -> READ', () => {
    expect(classifyMcpOperation('mcp.list').effectClass).toBe('READ');
  });
  it('mcp.get -> READ', () => {
    expect(classifyMcpOperation('mcp.get').effectClass).toBe('READ');
  });
  it('mcp.create / mcp.update / mcp.send / mcp.publish / mcp.delete -> EXTERNAL_ACTION', () => {
    for (const op of ['mcp.create', 'mcp.update', 'mcp.send', 'mcp.publish', 'mcp.delete']) {
      const result = classifyMcpOperation(op);
      expect(result.effectClass, `${op} should classify EXTERNAL_ACTION`).toBe('EXTERNAL_ACTION');
      expect(result.riskTier).toBe('HIGH');
    }
  });
  it('an unknown MCP operation fails closed — not matched, not automatically AVAILABLE/READ', () => {
    const result = classifyMcpOperation('mcp.frobnicate');
    expect(result.matched).toBe(false);
    expect(result.effectClass).toBeNull();
    expect(result.riskTier).toBe('HIGH');
  });
  it('a realistic compound tool name (createIssue) still classifies EXTERNAL_ACTION — transport/casing does not hide the verb', () => {
    expect(classifyMcpOperation('createIssue').effectClass).toBe('EXTERNAL_ACTION');
    expect(classifyMcpOperation('list_repos').effectClass).toBe('READ');
  });
});
