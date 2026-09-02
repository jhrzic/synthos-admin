import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { HermesAdapter } from '../src/services/hermesAdapter';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const adrContent = fs.readFileSync(path.resolve(process.cwd(), 'docs/adr-001-hermes-adapter-governance.md'), 'utf-8');

// ---------------------------------------------------------------------------
// Workstream E — Hermes Runtime Phase 2 truth check.
//
// ADR-001 (docs/adr-001-hermes-adapter-governance.md) is the real,
// authoritative contract. It explicitly places execute() in "Phase 3 —
// Controlled execution (deferred)... Not started until Phase 2 passes," and
// events() in Phase 2 Track A, which requires wiring against a real,
// reachable Hermes VPS instance. No HERMES_ADAPTER_BASE_URL is configured
// in this environment (no .env file exists in this repo at all), and no
// concrete HTTP contract for an events endpoint is documented anywhere
// beyond the Phase 1 health check (GET /synthos/health). Per this task's
// own rule ("do not guess an endpoint"), the correct state for this pass is
// NOT_IMPLEMENTED for both — which is what the code already does. These
// tests verify that honest state holds, not new functionality.
// ---------------------------------------------------------------------------

describe('ADR-001 defers execute() to Phase 3 and events() to Phase 2 — no real endpoint documented for either', () => {
  it('the ADR itself places execute() in a deferred Phase 3, not started until Phase 2 passes', () => {
    expect(adrContent).toContain('Phase 3 — Controlled execution (deferred)');
    expect(adrContent).toContain('Not started until Phase 2 passes');
  });

  it('no concrete HTTP endpoint path is documented for events() anywhere in the ADR — only health() names one', () => {
    const eventsEndpointPattern = /\/synthos\/events|\/synthos\/run_events|\/synthos\/stream/;
    expect(adrContent).not.toMatch(eventsEndpointPattern);
    // health()'s real, concrete endpoint is documented in the adapter code
    // itself (the ADR only describes it structurally) — confirm that one
    // real, named endpoint exists at all, which is what makes the absence
    // of any equivalent for events() meaningful rather than an artifact of
    // this ADR never naming endpoints.
    const adapterContent = fs.readFileSync(path.resolve(process.cwd(), 'src/services/hermesAdapter.ts'), 'utf-8');
    expect(adapterContent).toContain('/synthos/health');
    expect(adapterContent).not.toMatch(/\/synthos\/events|\/synthos\/run_events|\/synthos\/stream/);
  });
});

describe('HermesAdapter.capabilities(): execute and events are honestly reported NOT_IMPLEMENTED_PHASE_1', () => {
  it('capabilities() never claims execute or events are supported', async () => {
    const adapter = new HermesAdapter({ baseUrl: undefined, token: undefined });
    const caps = await adapter.capabilities();
    expect(caps.capabilities.execute.supported).toBe(false);
    expect(caps.capabilities.execute.status).toBe('NOT_IMPLEMENTED_PHASE_1');
    expect(caps.capabilities.events.supported).toBe(false);
    expect(caps.capabilities.events.status).toBe('NOT_IMPLEMENTED_PHASE_1');
  });

  it('capabilities() attributes the NOT_IMPLEMENTED status to the real ADR-001 spec, not an arbitrary string', () => {
    const adapter = new HermesAdapter({ baseUrl: undefined, token: undefined });
    return adapter.capabilities().then((caps) => {
      expect(caps.capabilities.execute.confirmed_by).toBe('adr_001_phase_1_spec');
      expect(caps.capabilities.events.confirmed_by).toBe('adr_001_phase_1_spec');
    });
  });
});

describe('HermesAdapter.execute(): honest NOT_IMPLEMENTED, never a fabricated task result', () => {
  it('always returns success:false, status:NOT_IMPLEMENTED regardless of input', async () => {
    const adapter = new HermesAdapter({ baseUrl: undefined, token: undefined });
    const result = await adapter.execute({ taskId: 'anything', command: 'do something' });
    expect(result.success).toBe(false);
    expect(result.status).toBe('NOT_IMPLEMENTED');
    expect(result.receiptId).toBeUndefined();
    expect(result.output).toBeUndefined();
  });
});

describe('HermesAdapter.events(): honest no-op subscription, never delivers a fabricated event', () => {
  it('the handler is never invoked synchronously or on a hidden timer — no sample events are emitted', async () => {
    const adapter = new HermesAdapter({ baseUrl: undefined, token: undefined });
    const handler = vi.fn();
    const sub = adapter.events('task_update', handler);
    expect(sub.eventType).toBe('task_update');
    expect(typeof sub.unsubscribe).toBe('function');
    // Give any hidden async/timer path a chance to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 50));
    expect(handler).not.toHaveBeenCalled();
    expect(() => sub.unsubscribe()).not.toThrow();
  });
});

describe('HermesAdapter.health(): unaffected by this pass, and honestly reflects an unconfigured environment', () => {
  it('reports NOT_CONNECTED with a real, specific reason when no base URL is configured (this repo has no .env)', async () => {
    const adapter = new HermesAdapter({ baseUrl: undefined, token: undefined });
    const health = await adapter.health();
    expect(health.status).toBe('NOT_CONNECTED');
    expect(health.error).toContain('HERMES_ADAPTER_BASE_URL is not configured');
    expect(health.process_alive).toBe(false);
  });

  it('a network failure (unreachable configured URL) reports NOT_CONNECTED with a real error, not a fabricated UP', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    try {
      const adapter = new HermesAdapter({ baseUrl: 'https://hermes.example.invalid', token: 'x', timeoutMs: 100 });
      const health = await adapter.health();
      expect(health.status).toBe('NOT_CONNECTED');
      expect(health.error).toContain('ECONNREFUSED');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('a timeout (AbortError) reports NOT_CONNECTED with a real timeout message, not a fabricated status', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() => {
      const err: any = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    try {
      const adapter = new HermesAdapter({ baseUrl: 'https://hermes.example.invalid', token: 'x', timeoutMs: 50 });
      const health = await adapter.health();
      expect(health.status).toBe('NOT_CONNECTED');
      expect(health.error).toContain('timed out');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('a 401/403 from a configured endpoint reports AUTH_ERROR, never UP', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ status: 401, statusText: 'Unauthorized' } as any);
    try {
      const adapter = new HermesAdapter({ baseUrl: 'https://hermes.example.invalid', token: 'bad-token', timeoutMs: 100 });
      const health = await adapter.health();
      expect(health.status).toBe('AUTH_ERROR');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server.ts: local Hermes surfaces remain honestly NOT_IMPLEMENTED, no fabricated events list (E4)', () => {
  it('/api/hermes/db-state still refuses to fabricate local database state', () => {
    expect(serverContent).toContain('Direct Hermes database access is not implemented');
  });

  it('/api/hermes/logs still refuses to fabricate a log stream, and correctly attributes the gap to events() being Phase 2', () => {
    expect(serverContent).toContain('Hermes log streaming is not implemented');
    expect(serverContent).toContain('hermesAdapter.events() is deferred to ADR-001 Phase 2');
  });

  it('no route in server.ts returns a hardcoded/sample Hermes run_events array', () => {
    expect(serverContent).not.toMatch(/run_events\s*:\s*\[\s*\{/);
  });

  it('/api/hermes/health still routes through the canonical hermesAdapter, unchanged by this pass', () => {
    expect(serverContent).toContain('const health = await hermesAdapter.health();');
  });
});
