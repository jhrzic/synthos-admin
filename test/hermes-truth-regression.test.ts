import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SYNTHOS NON-DEMO RULE: Hermes admin surfaces must never fabricate operational evidence', () => {
  const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  const hermesDbContent = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/hermes-db.ts'), 'utf-8');
  const hermesManageContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/HermesManageView.tsx'), 'utf-8');

  it('1. /api/hermes/db-state never returns fabricated table/agent/task/log/synapse counts', () => {
    const dbStateRoute = serverContent.slice(
      serverContent.indexOf('app.get("/api/hermes/db-state"'),
      serverContent.indexOf('app.get("/api/hermes/logs"')
    );
    expect(dbStateRoute).not.toBe('');
    // Previously hardcoded fake evidence — must never reappear
    expect(dbStateRoute).not.toContain('agents: 6');
    expect(dbStateRoute).not.toContain('tasks: 18');
    expect(dbStateRoute).not.toContain('logs: 342');
    expect(dbStateRoute).not.toContain('synapses: 7');
    expect(dbStateRoute).not.toContain('READONLY_ATTACHED');
    expect(dbStateRoute).not.toContain('LOCAL_FOUND');
    // Must honestly report NOT_IMPLEMENTED instead
    expect(dbStateRoute).toContain('NOT_IMPLEMENTED');
    expect(dbStateRoute).toContain('connected: false');
  });

  it('2. /api/hermes/logs never returns fabricated log entries', () => {
    const logsRoute = serverContent.slice(
      serverContent.indexOf('app.get("/api/hermes/logs"'),
      serverContent.indexOf('app.get("/api/providers/status"')
    );
    expect(logsRoute).not.toBe('');
    // Previously fabricated telemetry claims — must never reappear
    expect(logsRoute).not.toContain('Token inference efficiency measured');
    expect(logsRoute).not.toContain('28.4%');
    expect(logsRoute).not.toContain('Sandbox execution latency validated');
    expect(logsRoute).not.toContain('41ms');
    expect(logsRoute).not.toContain('Harvested 18 new trend signals');
    expect(logsRoute).not.toContain('board.db state machine');
    // Must honestly report NOT_IMPLEMENTED with no invented entries
    expect(logsRoute).toContain('NOT_IMPLEMENTED');
    expect(logsRoute).toContain('logs: []');
  });

  it('3. unavailable Hermes local-database access produces a truthful NOT_IMPLEMENTED state, not a fabricated fallback', () => {
    // Server route
    expect(serverContent).not.toContain('classification: isFullyConnected');
    // Client helper (src/lib/hermes-db.ts) must not silently claim connected:true on failure
    expect(hermesDbContent).not.toContain('connected: true');
    expect(hermesDbContent).toContain('connected: false');
  });

  it('4. no route claims dailyCronActive (or any cron-active claim) without a real scheduler behind it', () => {
    // No scheduler dispatches on a timer anywhere in this codebase (Windmill deferred) —
    // so no route may assert an active cron/scheduler state.
    expect(serverContent).not.toContain('dailyCronActive');
  });

  it('5. fake Hermes commit/version literals cannot silently return', () => {
    expect(serverContent).not.toContain('7f8a92c');
    expect(serverContent).not.toContain('9e41b80');
    expect(serverContent).not.toContain('"v3.0.4"');
    expect(serverContent).not.toContain('"v3.2.1"');
    // The fabricated in-memory state object itself must be gone (a mention in an
    // explanatory comment about the fix is fine; a live declaration or usage is not).
    expect(serverContent).not.toMatch(/hermesState\s*=|hermesState\./);
  });

  it('5b. the frontend no longer overwrites live upstream data with fabricated check/update/migrate results', () => {
    // These handlers previously wrote fake installedVersion/latestVersion/configVersion
    // into upstreamData on both success and network-error paths. Real upstream data must
    // come only from GET /api/hermes/upstream-status (hermesAdapter-backed).
    expect(hermesManageContent).not.toContain('installedVersion: result.installedVersion');
    expect(hermesManageContent).not.toContain('configVersion: result.newConfigVersion');
    // Catch blocks must not fabricate success on network failure
    expect(hermesManageContent).not.toContain('Check completed with cached local state');
    expect(hermesManageContent).not.toContain('Sandbox verified locally');
    expect(hermesManageContent).not.toContain('Production successfully upgraded to latest');
    expect(hermesManageContent).not.toContain('Configuration schema successfully migrated to v2.5.0');
  });

  it('6. /api/hermes/health still uses the canonical hermesAdapter, untouched by this fix', () => {
    const healthRoute = serverContent.slice(
      serverContent.indexOf('app.get("/api/hermes/health"'),
      serverContent.indexOf('app.get("/api/hermes/capabilities"')
    );
    expect(healthRoute).not.toBe('');
    expect(healthRoute).toContain('hermesAdapter.health()');

    const upstreamStatusRoute = serverContent.slice(
      serverContent.indexOf('app.get("/api/hermes/upstream-status"'),
      serverContent.indexOf('app.post("/api/hermes/check"')
    );
    expect(upstreamStatusRoute).not.toBe('');
    expect(upstreamStatusRoute).toContain('hermesAdapter.health()');
  });
});
