import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// A private database and signing-key directory per run: these tests probe the
// REAL subsystems (they sign with the real Ed25519 code path and open a real
// SQLite file), so they must never touch the developer's own data/ directory.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-always-on-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'always-on.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { getRuntimeStatus, resetIntegrityCacheForTests } from '../lib/runtime-status';
import { startScheduler, stopScheduler, getSchedulerHealth, resetSchedulerHealthForTests } from '../lib/fabric/scheduler';
import { getDatabase } from '../lib/persistence';
import { classifyModelRequest } from '../lib/model-router';

// ---------------------------------------------------------------------------
// ALWAYS-ON RUNTIME — the core runtime has to be able to prove it is up.
//
// Every subsystem asserted here previously had NO row in the status
// aggregator at all: the scheduler, the Brain's store, Guardian and Aegis.
// The aggregator reported eleven optional integrations and nothing about the
// four things that have to be working for the process to be doing its job,
// which meant an operator could read a screen full of green and still be
// running a server that dispatches nothing and signs nothing.
// ---------------------------------------------------------------------------

describe('scheduler liveness is recorded, not claimed', () => {
  beforeEach(() => {
    stopScheduler();
    resetSchedulerHealthForTests();
  });

  afterEach(() => {
    stopScheduler();
    resetSchedulerHealthForTests();
    vi.useRealTimers();
  });

  it('reports not-running before the loop is ever armed', () => {
    const health = getSchedulerHealth();
    expect(health.running).toBe(false);
    expect(health.startedAt).toBeNull();
    expect(health.ticks).toBe(0);
    expect(health.lastTickAt).toBeNull();
  });

  it('arming the loop is not the same as ticking, and the two are distinguishable', async () => {
    vi.useFakeTimers();
    startScheduler(1000);

    const armed = getSchedulerHealth();
    expect(armed.running).toBe(true);
    expect(armed.intervalMs).toBe(1000);
    expect(armed.startedAt).not.toBeNull();
    // The distinction that matters: armed, but nothing has happened yet.
    expect(armed.ticks).toBe(0);
    expect(armed.lastTickAt).toBeNull();

    const armedReport = await getRuntimeStatus();
    const armedRow = armedReport.systems.find((s) => s.system === 'Scheduler (in-process poll loop)');
    expect(armedRow?.status).toBe('DEGRADED');
    expect(armedRow?.detail).toContain('Armed is not ticking');

    await vi.advanceTimersByTimeAsync(1000);

    const ticked = getSchedulerHealth();
    expect(ticked.ticks).toBe(1);
    expect(ticked.lastTickAt).not.toBeNull();
  });

  // The failure this guards against is a row that reports HEALTHY forever on
  // the strength of one tick at startup. An always-on runtime must not be
  // able to make that claim.
  it('an armed loop that has stopped ticking reports STALLED, not HEALTHY', async () => {
    vi.useFakeTimers();
    startScheduler(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const healthy = await getRuntimeStatus();
    expect(healthy.systems.find((s) => s.system === 'Scheduler (in-process poll loop)')?.status).toBe('HEALTHY');

    // Move the clock forward WITHOUT running timers: the timer is still
    // armed, and the last tick is now far in the past.
    vi.setSystemTime(new Date(Date.now() + 120_000));

    const stalled = await getRuntimeStatus();
    const row = stalled.systems.find((s) => s.system === 'Scheduler (in-process poll loop)');
    expect(row?.status).toBe('DEGRADED');
    expect(row?.status).not.toBe('HEALTHY');
    expect(row?.detail).toContain('STALLED');
    expect(row?.detail).toContain('is not dispatching scheduled work');
  });

  // The reconciliation sweep shares this one timer. Proving the tick really
  // calls it matters because the sweep is the only thing that recovers an
  // external execution which finished while SynthOS was down — if the wiring
  // were missing, everything else about it could be correct and it would
  // still never run.
  it('the tick also runs external-execution reconciliation, on a separate promise chain', async () => {
    vi.useFakeTimers();
    startScheduler(1000);
    expect(getSchedulerHealth().lastReconcileAt).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);

    const health = getSchedulerHealth();
    expect(health.lastReconcileAt, 'the tick did not run reconciliation').not.toBeNull();
    // An empty ledger is a no-op sweep, not an error.
    expect(health.lastReconcileConsidered).toBe(0);
    expect(health.reconcileErrors).toBe(0);
  });

  it('a stopped loop reports FAILED, because nothing scheduled can dispatch', async () => {
    vi.useFakeTimers();
    startScheduler(1000);
    await vi.advanceTimersByTimeAsync(1000);
    stopScheduler();

    const health = getSchedulerHealth();
    expect(health.running).toBe(false);
    // The record of what really happened survives a graceful stop.
    expect(health.ticks).toBe(1);

    const report = await getRuntimeStatus();
    const row = report.systems.find((s) => s.system === 'Scheduler (in-process poll loop)');
    expect(row?.status).toBe('FAILED');
    expect(row?.evidenceSource).toBe('live_probe');
  });

  it('starting twice does not arm a second timer (no duplicate workers in one process)', async () => {
    vi.useFakeTimers();
    startScheduler(1000);
    const firstStart = getSchedulerHealth().startedAt;
    startScheduler(1000);
    startScheduler(5000);

    // The second and third calls are no-ops: same arm time, unchanged interval.
    expect(getSchedulerHealth().startedAt).toBe(firstStart);
    expect(getSchedulerHealth().intervalMs).toBe(1000);

    await vi.advanceTimersByTimeAsync(1000);
    // One interval elapsed means exactly ONE tick, not two or three.
    expect(getSchedulerHealth().ticks).toBe(1);
  });

  // This is the failure mode the whole scheduler row exists for: the timer
  // is armed, the process is alive and answering HTTP, and every single tick
  // is throwing. Nothing about "the server is up" reveals it, because the
  // loop is unref'd and the tick swallows its own error.
  //
  // The break is a REAL one rather than a mocked function: the schedules
  // table is renamed out from under the query, which is what listDueSchedules
  // actually hitting a broken database looks like.
  it('a ticking loop whose every tick throws is DEGRADED, never HEALTHY', async () => {
    const db = getDatabase();
    db.exec('ALTER TABLE schedules RENAME TO schedules_hidden_for_test');
    try {
      vi.useFakeTimers();
      startScheduler(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const health = getSchedulerHealth();
      expect(health.ticks).toBe(1);
      expect(health.tickErrors).toBe(1);
      expect(health.lastTickError?.message).toMatch(/schedules/);
      expect(health.lastTickProcessed).toBeNull();

      const report = await getRuntimeStatus();
      const row = report.systems.find((s) => s.system === 'Scheduler (in-process poll loop)');
      expect(row?.status).toBe('DEGRADED');
      expect(row?.status).not.toBe('HEALTHY');
      expect(row?.detail).toContain('none has completed');
    } finally {
      db.exec('ALTER TABLE schedules_hidden_for_test RENAME TO schedules');
    }
  });
});

describe('the core in-process subsystems each have a row and prove themselves by running', () => {
  it('Guardian is proven by executing the real policy, and must discriminate rather than just refuse', async () => {
    const report = await getRuntimeStatus();
    const guardian = report.systems.find((s) => s.system === 'Guardian (command + gate policy)');
    expect(guardian, 'Guardian has no row in the runtime status report').toBeDefined();
    expect(guardian?.status).toBe('HEALTHY');
    expect(guardian?.evidenceSource).toBe('live_probe');
    expect(guardian?.lastCheck).not.toBeNull();
    // Blocking everything would pass a block-only check while making the
    // system useless, so the inert-command case is asserted explicitly.
    expect(guardian?.detail).toContain('inert command SAFE');
  });

  it('Aegis is proven by a real sign-and-verify round trip, and names the key fingerprint', async () => {
    const report = await getRuntimeStatus();
    const aegis = report.systems.find((s) => s.system === 'Aegis (receipt signing + verification)');
    expect(aegis, 'Aegis has no row in the runtime status report').toBeDefined();
    expect(aegis?.status).toBe('HEALTHY');
    expect(aegis?.evidenceSource).toBe('live_probe');
    // A changed fingerprint silently invalidates every receipt already
    // issued, so it has to be visible rather than inferred.
    expect(aegis?.detail).toMatch(/sha256:[0-9a-f]{64}/);
    expect(aegis?.detail).toContain('Ed25519');
  });

  it('the Brain store reports read AND write availability, because read-only is a silent writeback failure', async () => {
    const report = await getRuntimeStatus();
    const store = report.systems.find((s) => s.system === 'Brain Store (SQLite)');
    expect(store, 'the Brain store has no row in the runtime status report').toBeDefined();
    expect(store?.status).toBe('HEALTHY');
    expect(store?.evidenceSource).toBe('db_state');
    expect(store?.detail).toContain('writable');
    expect(store?.detail).toContain('quick_check=ok');
  });

  // Observed live: run from the server's long-lived connection while another
  // process held the WAL, quick_check came back non-'ok' and this row flashed
  // DEGRADED on a database that was fine. A panel that cries wolf during
  // normal concurrent access teaches people to ignore it.
  it('an integrity check that cannot run is INCONCLUSIVE, not a corruption verdict', async () => {
    resetIntegrityCacheForTests();
    const db = getDatabase();
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (String(sql).includes('quick_check')) throw new Error('database is locked');
      return original(sql);
    }) as any);

    try {
      const report = await getRuntimeStatus();
      const store = report.systems.find((s) => s.system === 'Brain Store (SQLite)');
      // Availability is unaffected: reads and writes both still work.
      expect(store?.status).toBe('HEALTHY');
      expect(store?.detail).toContain('inconclusive');
      expect(store?.detail).toContain('database is locked');
    } finally {
      spy.mockRestore();
      resetIntegrityCacheForTests();
    }
  });

  it('a genuine corruption verdict DOES degrade the row', async () => {
    resetIntegrityCacheForTests();
    const db = getDatabase();
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (String(sql).includes('quick_check')) {
        return { get: () => ({ quick_check: '*** in database main ***\nPage 42 is never used' }) } as any;
      }
      return original(sql);
    }) as any);

    try {
      const report = await getRuntimeStatus();
      const store = report.systems.find((s) => s.system === 'Brain Store (SQLite)');
      expect(store?.status).toBe('DEGRADED');
      expect(store?.detail).toContain('Page 42 is never used');
    } finally {
      spy.mockRestore();
      resetIntegrityCacheForTests();
    }
  });

  it('the model router is reported separately from the providers, and is never HEALTHY on configuration alone', async () => {
    const originalGemini = process.env.GEMINI_API_KEY;
    const originalOpenAi = process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.OPENAI_API_KEY;
    try {
      const report = await getRuntimeStatus();
      const router = report.systems.find((s) => s.system === 'Model Router');
      expect(router, 'the model router has no row in the runtime status report').toBeDefined();
      // A resolved credential is not a proven one, and no billable call is
      // made to find out — so this can never be HEALTHY here.
      expect(router?.status).not.toBe('HEALTHY');
      expect(router?.status).toBe('UNKNOWN');
      expect(router?.evidenceSource).toBe('configuration_only');
      expect(router?.detail).toContain('gemini');
    } finally {
      if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
      if (originalOpenAi !== undefined) process.env.OPENAI_API_KEY = originalOpenAi;
    }
  });

  it('with no provider credential at all, the router is UNCONFIGURED rather than silently fine', async () => {
    const saved: Record<string, string | undefined> = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const report = await getRuntimeStatus();
      const router = report.systems.find((s) => s.system === 'Model Router');
      expect(router?.status).toBe('NOT_CONFIGURED');
      expect(router?.detail).toContain('no provider credential resolves');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});

describe('NOT_IMPLEMENTED is reserved for things that genuinely are not implemented', () => {
  // The allowlist is the point. NOT_IMPLEMENTED is a real and useful status,
  // but it is only honest where the repo contains no implementation — and
  // the entry below is proven by the test underneath it, not asserted here.
  const PROVABLY_UNIMPLEMENTED = ['OpenRouter Provider'];

  it('only a provably-unimplemented subsystem may claim NOT_IMPLEMENTED', async () => {
    const report = await getRuntimeStatus();
    const claiming = report.systems
      .filter((s) => s.status === 'NOT_IMPLEMENTED' || s.evidenceSource === 'not_implemented')
      .map((s) => s.system);
    const unjustified = claiming.filter((system) => !PROVABLY_UNIMPLEMENTED.includes(system));
    expect(
      unjustified,
      'a subsystem is reported as unimplemented without proof. If it really has no implementation, add it to PROVABLY_UNIMPLEMENTED with a test that proves it; if it is implemented but unconfigured, the status is NOT_CONFIGURED',
    ).toEqual([]);
  });

  it('OpenRouter really has no execution mapping, which is what earns it the NOT_IMPLEMENTED label', () => {
    // Repo evidence, not opinion: the router itself refuses to route it, so
    // a credential would change nothing.
    const classification = classifyModelRequest('openrouter/some-model');
    expect(classification.provider).toBe('UNSUPPORTED');
  });

  it('the core subsystems appear ahead of the optional integrations, so "is the runtime up" is answerable at a glance', async () => {
    const report = await getRuntimeStatus();
    const names = report.systems.map((s) => s.system);
    const core = [
      'Scheduler (in-process poll loop)',
      'Brain Store (SQLite)',
      'Guardian (command + gate policy)',
      'Aegis (receipt signing + verification)',
      'Model Router',
    ];
    expect(names.slice(0, core.length)).toEqual(core);
  });
});

// ---------------------------------------------------------------------------
// The loopback guarantee. This is a regression test for a real hole rather
// than a hypothetical: with DISABLE_HMR=true the admin bound 127.0.0.1:3000
// correctly, and Vite still opened a websocket listener on port 24678 across
// EVERY interface, because `hmr: false` does not stop the socket — only
// `server.ws: false` does.
// ---------------------------------------------------------------------------
describe('an always-on local service exposes exactly one loopback port', () => {
  it('DISABLE_HMR=true disables the websocket server, not merely the HMR client', async () => {
    const { resolveConfig } = await import('vite');
    const original = process.env.DISABLE_HMR;
    process.env.DISABLE_HMR = 'true';
    try {
      const config = await resolveConfig({ server: { middlewareMode: true }, appType: 'spa' }, 'serve');
      // Both, and the second one is the one that actually closes the port.
      expect(config.server.hmr).toBe(false);
      expect(config.server.ws).toBe(false);
      // File watching off too: an unattended service should not be walking
      // the tree for changes nobody is going to make.
      expect(config.server.watch).toBeNull();
    } finally {
      if (original === undefined) delete process.env.DISABLE_HMR; else process.env.DISABLE_HMR = original;
    }
  });

  it('with HMR left on, the websocket is pinned to loopback rather than every interface', async () => {
    const { resolveConfig } = await import('vite');
    const original = process.env.DISABLE_HMR;
    delete process.env.DISABLE_HMR;
    try {
      const config = await resolveConfig({ server: { middlewareMode: true }, appType: 'spa' }, 'serve');
      expect(config.server.hmr).toMatchObject({ host: '127.0.0.1' });
    } finally {
      if (original !== undefined) process.env.DISABLE_HMR = original;
    }
  });
});
