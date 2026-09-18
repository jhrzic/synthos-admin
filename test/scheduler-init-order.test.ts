import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// STARTUP / TICK INITIALIZATION ORDER.
//
// Regression for the CI log "Cannot access 'health' before initialization":
// ticks that re-imported the orchestrator while its first load was still in
// progress were handed its UNFINISHED exports (the module runner resolves a
// cyclic request with partial exports), and the hoisted tick function hit the
// module-level `const health` in its temporal dead zone.
//
// Reproduced deterministically below — many ticks fire while the orchestrator
// graph is still loading — and fixed by loading each tick module once and
// having every tick await that single load.
// ---------------------------------------------------------------------------

process.env.SYNTHOS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-init-order-')), 'init.db');

afterEach(() => { vi.useRealTimers(); vi.doUnmock('../lib/fabric/orchestrator'); vi.resetModules(); });

async function tickWhileLoading(sched: typeof import('../lib/fabric/scheduler'), n: number) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a); });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  sched.startScheduler(1000);
  // Real time passes between ticks, so later ticks land while the first
  // orchestrator load is in progress (the window CI hit by chance).
  for (let i = 0; i < n; i++) { vi.advanceTimersByTime(1000); await new Promise((r) => setTimeout(r, 2)); }
  sched.stopScheduler();
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, 1500));
  spy.mockRestore();
  return { health: sched.getSchedulerHealth(), errors };
}

describe('scheduler tick modules are fully initialized before any tick uses them', () => {
  it('many ticks during the orchestrator\'s first load: no temporal-dead-zone access, no error logged', async () => {
    vi.resetModules();
    const sched = await import('../lib/fabric/scheduler');
    sched.resetSchedulerHealthForTests();
    const { health, errors } = await tickWhileLoading(sched, 300);
    expect(health.ticks).toBe(300);
    expect(health.orchestrationErrors).toBe(0);
    expect(health.lastOrchestrationError).toBeNull();
    expect(JSON.stringify(errors.map((e) => String((e as any[])[1] ?? '')))).not.toMatch(/before initialization/);
    // The orchestrator's health exists and was driven by the ticks.
    const orch = await import('../lib/fabric/orchestrator');
    expect(orch.getOrchestratorHealth().ticks).toBeGreaterThan(0);
  }, 30000);

  it('a tick module that fails to load stays failed and is reported on every tick (fail closed, visible)', async () => {
    vi.resetModules();
    vi.doMock('../lib/fabric/orchestrator', () => { throw new Error('orchestrator failed to initialise'); });
    const sched = await import('../lib/fabric/scheduler');
    sched.resetSchedulerHealthForTests();
    const { health, errors } = await tickWhileLoading(sched, 5);
    expect(health.ticks).toBe(5);
    expect(health.orchestrationErrors).toBe(5);
    // vitest wraps the factory's error; either way the load failure is recorded.
    expect(health.lastOrchestrationError?.message).toMatch(/orchestrator failed to initialise|error when mocking/);
    expect(errors.length).toBeGreaterThanOrEqual(5);
  }, 30000);

  it('the scheduler loads each tick module through one shared promise (no per-tick import)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/scheduler.ts'), 'utf8');
    for (const m of ['../spend/ledger', '../continuity/resume', '../registry/route-import', '../authority-ledger', './orchestrator']) {
      expect(src).toContain(`() => import('${m}'))`);
    }
    expect(src).not.toMatch(/^\s+import\('\.\/orchestrator'\)\s*$/m);
  });
});
