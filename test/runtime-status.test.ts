import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-runtime-status-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getRuntimeStatus } from '../lib/runtime-status';

const LEGAL_STATUSES = new Set(['HEALTHY', 'DEGRADED', 'NOT_CONFIGURED', 'NOT_IMPLEMENTED', 'FAILED', 'UNKNOWN']);
const LEGAL_EVIDENCE = new Set(['live_probe', 'configuration_only', 'db_state', 'filesystem_check', 'last_successful_operation', 'not_implemented']);

describe('G1/G2/G3: runtime status aggregator uses the real vocabulary and never fabricates evidence', () => {
  it('every system reports a legal status and a legal evidence source', async () => {
    const report = await getRuntimeStatus();
    expect(report.systems.length).toBeGreaterThan(0);
    for (const system of report.systems) {
      expect(LEGAL_STATUSES.has(system.status), `${system.system} has illegal status "${system.status}"`).toBe(true);
      expect(LEGAL_EVIDENCE.has(system.evidenceSource), `${system.system} has illegal evidenceSource "${system.evidenceSource}"`).toBe(true);
    }
  });

  it('never uses "LIVE" as a status value (that is the old, different vocabulary from the diagnostics route)', async () => {
    const report = await getRuntimeStatus();
    for (const system of report.systems) {
      expect(system.status).not.toBe('LIVE');
    }
  });

  it('a system with lastCheck=null never claims evidenceSource "live_probe" (G3 — no fabricated timestamp)', async () => {
    const report = await getRuntimeStatus();
    for (const system of report.systems) {
      if (system.lastCheck === null) {
        expect(system.evidenceSource, `${system.system} claims live_probe with no lastCheck`).not.toBe('live_probe');
      }
    }
  });

  it('Gemini without a configured key reports NOT_CONFIGURED, never HEALTHY', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const report = await getRuntimeStatus();
      const gemini = report.systems.find((s) => s.system === 'Gemini Provider');
      expect(gemini?.status).toBe('NOT_CONFIGURED');
    } finally {
      if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it('Gemini with a key configured is UNKNOWN (config presence only), never HEALTHY without a live probe', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    try {
      const report = await getRuntimeStatus();
      const gemini = report.systems.find((s) => s.system === 'Gemini Provider');
      expect(gemini?.status).not.toBe('HEALTHY');
      expect(gemini?.evidenceSource).toBe('configuration_only');
    } finally {
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it('Hermes dedicated runtime without HERMES_ADAPTER_BASE_URL reports NOT_CONFIGURED', async () => {
    const original = process.env.HERMES_ADAPTER_BASE_URL;
    delete process.env.HERMES_ADAPTER_BASE_URL;
    try {
      const report = await getRuntimeStatus();
      const hermes = report.systems.find((s) => s.system === 'Hermes Dedicated Runtime');
      expect(hermes?.status).toBe('NOT_CONFIGURED');
    } finally {
      if (original !== undefined) process.env.HERMES_ADAPTER_BASE_URL = original;
    }
  });

  it('Windmill is always NOT_IMPLEMENTED — deliberately deferred, never claimed otherwise', async () => {
    const report = await getRuntimeStatus();
    const windmill = report.systems.find((s) => s.system.includes('Windmill'));
    expect(windmill?.status).toBe('NOT_IMPLEMENTED');
  });

  it('MCP connectivity is NOT_IMPLEMENTED when no probe has ever run, never a fabricated HEALTHY', async () => {
    const report = await getRuntimeStatus();
    const mcp = report.systems.find((s) => s.system === 'MCP Connectivity');
    expect(mcp?.status).toBe('NOT_IMPLEMENTED');
    expect(mcp?.evidenceSource).toBe('not_implemented');
  });

  it('reports a real generatedAt timestamp', async () => {
    const report = await getRuntimeStatus();
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
  });
});
