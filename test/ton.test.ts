import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// A fresh, isolated SQLite file for this test file only — set BEFORE any
// persistence function runs its first (lazy) getDatabase() call.
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-ton-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { buildTonReadiness } from '../lib/ton-readiness';
import { probeTonReadiness, __test as tonProbeInternals } from '../lib/ton-probe';
import { recordTonTelemetry, tonAnalyticsSnapshot } from '../lib/ton-analytics';
import { TON_GUARDIANS, tonGuardianViews, installTonGuardians } from '../lib/ton-guardians';

// Cleanup runs once, after every describe block in this file — not nested
// inside one of them, which would delete the shared temp DB file out from
// under later describe blocks that still need the same cached connection.
afterAll(() => {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {
    // best-effort cleanup
  }
});

const WS_A = 'ws-ton-test-alpha';
const WS_B = 'ws-ton-test-beta';

describe('TON readiness: config presence never becomes READY on its own', () => {
  it('3. missing config produces NOT_CONFIGURED everywhere, not READY', () => {
    const readiness = buildTonReadiness({});
    expect(readiness.checklist.every((item) => item.status === 'not_configured')).toBe(true);
    expect(readiness.controllerReady).toBe(false);
    expect(readiness.readyCount).toBe(0);
  });

  it('configuring a value moves an item to SUBMITTED, never straight to APPROVED', () => {
    const readiness = buildTonReadiness({
      TON_CONNECT_MANIFEST_URL: 'https://getsynthos.com/tonconnect-manifest.json',
      TONCENTER_API_KEY: 'test-key',
    });
    expect(readiness.checklist.find((i) => i.id === 'manifest')?.status).toBe('submitted');
    expect(readiness.checklist.find((i) => i.id === 'rpc')?.status).toBe('submitted');
    expect(readiness.controllerReady).toBe(false);
  });
});

describe('TON probe: SSRF protection and fail-closed behavior', () => {
  it('1. a private/local target is rejected (not in the allowlist), regardless of protocol', () => {
    expect(tonProbeInternals.allowedUrl('https://169.254.169.254/latest/meta-data', tonProbeInternals.TON_CENTER_HOSTS)).toBeNull();
    expect(tonProbeInternals.allowedUrl('https://localhost/masterchainInfo', tonProbeInternals.TON_CENTER_HOSTS)).toBeNull();
    expect(tonProbeInternals.allowedUrl('http://toncenter.com/', tonProbeInternals.TON_CENTER_HOSTS)).toBeNull(); // http, not https
  });

  it('2. an invalid/malformed TON endpoint is rejected outright', () => {
    expect(tonProbeInternals.allowedUrl('not a url', tonProbeInternals.TON_CENTER_HOSTS)).toBeNull();
    expect(tonProbeInternals.allowedUrl('ftp://toncenter.com/', tonProbeInternals.TON_CENTER_HOSTS)).toBeNull();
  });

  it('a real allowlisted HTTPS host is accepted', () => {
    expect(tonProbeInternals.allowedUrl('https://toncenter.com/api/v3/', tonProbeInternals.TON_CENTER_HOSTS)).not.toBeNull();
  });

  it('4. a failed live probe leaves the item at SUBMITTED, never APPROVED', async () => {
    const base = buildTonReadiness({ TONCENTER_API_KEY: 'test-key' });
    const failingFetch = (async () => { throw new Error('network unreachable'); }) as unknown as typeof fetch;
    const probed = await probeTonReadiness(base, { TONCENTER_API_KEY: 'test-key' }, failingFetch);
    expect(probed.checklist.find((i) => i.id === 'rpc')?.status).toBe('submitted');
    expect(probed.controllerReady).toBe(false);
  });

  it('5. a successful live probe can produce APPROVED for that item', async () => {
    const base = buildTonReadiness({ TONCENTER_API_KEY: 'test-key' });
    const okFetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const probed = await probeTonReadiness(base, { TONCENTER_API_KEY: 'test-key' }, okFetch);
    expect(probed.checklist.find((i) => i.id === 'rpc')?.status).toBe('approved');
  });

  it('an unconfigured item is never even attempted, let alone approved — probeTonReadiness returns it untouched', async () => {
    const base = buildTonReadiness({}); // no TONCENTER_API_KEY -> rpc.apiKeyConfigured is false
    // A fetch that would report success if called at all — proves the item
    // stays not_configured because the probe never ran, not because this
    // fetch happened to fail.
    const wouldSucceedFetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const probed = await probeTonReadiness(base, {}, wouldSucceedFetch);
    expect(probed.checklist.find((i) => i.id === 'rpc')?.status).toBe('not_configured');
  });
});

describe('TON telemetry: real persistence, aggregation, workspace isolation', () => {
  it('8. empty telemetry produces an empty/unavailable result, not fake example metrics', () => {
    const snapshot = tonAnalyticsSnapshot(WS_A, 30);
    expect(snapshot.hasTelemetry).toBe(false);
    expect(snapshot.metrics.managedSpendUsd).toBeNull();
    expect(snapshot.metrics.verifiedInstalls).toBeNull();
    expect(snapshot.activity).toHaveLength(0);
  });

  it('6. a telemetry event persists', () => {
    const eventId = recordTonTelemetry(WS_A, {
      eventType: 'install',
      channel: 'organic',
      verified: true,
      spendUsd: 10,
      revenueUsd: 25,
    });
    expect(typeof eventId).toBe('string');
    expect(eventId.length).toBeGreaterThan(0);

    const snapshot = tonAnalyticsSnapshot(WS_A, 30);
    expect(snapshot.hasTelemetry).toBe(true);
    expect(snapshot.activity.some((e) => e.id === eventId)).toBe(true);
  });

  it('9. aggregation is computed from the real persisted rows, not invented', () => {
    recordTonTelemetry(WS_A, { eventType: 'install', verified: true, spendUsd: 20, revenueUsd: 40 });
    recordTonTelemetry(WS_A, { eventType: 'fraud_block', blockedReason: 'bot pattern', spendUsd: 0 });

    const snapshot = tonAnalyticsSnapshot(WS_A, 30);
    // Sum of spendUsd across the three real rows recorded for WS_A in this suite (10 + 20 + 0).
    expect(snapshot.metrics.managedSpendUsd).toBe(30);
    expect(snapshot.metrics.verifiedInstalls).toBe(2);
  });

  it('7. Workspace A telemetry is invisible to Workspace B', () => {
    const snapshotB = tonAnalyticsSnapshot(WS_B, 30);
    expect(snapshotB.hasTelemetry).toBe(false);
    expect(snapshotB.activity).toHaveLength(0);
    expect(snapshotB.metrics.managedSpendUsd).toBeNull();

    recordTonTelemetry(WS_B, { eventType: 'acquisition', spendUsd: 999 });
    const snapshotAAfter = tonAnalyticsSnapshot(WS_A, 30);
    // WS_A's aggregate must be unaffected by WS_B's new row.
    expect(snapshotAAfter.metrics.managedSpendUsd).toBe(30);
  });

  it('rejects an unsupported event type rather than silently accepting it', () => {
    expect(() => recordTonTelemetry(WS_A, { eventType: 'not_a_real_type' as any })).toThrow();
  });
});

describe('TON guardians: real, workspace-scoped, not fabricated', () => {
  it('10. exactly 5 guardians are defined — not 8, matching the real source, not the fabricated banner', () => {
    expect(TON_GUARDIANS).toHaveLength(5);
    expect(TON_GUARDIANS.map((g) => g.name).sort()).toEqual([
      'ton-attribution-guardian',
      'ton-compliance-guardian',
      'ton-fraud-guardian',
      'ton-settlement-guardian',
      'ton-treasury-guardian',
    ]);
  });

  it('guardians report not_installed until a real install call is made, per workspace', () => {
    const before = tonGuardianViews(WS_A);
    expect(before.every((g) => !g.installed)).toBe(true);

    const after = installTonGuardians(WS_A);
    expect(after.every((g) => g.installed)).toBe(true);
    expect(after).toHaveLength(5);

    // Installing in one workspace must not install in another.
    const stillNotInstalledInB = tonGuardianViews(WS_B);
    expect(stillNotInstalledInB.every((g) => !g.installed)).toBe(true);
  });
});

describe('TON UI truth: no fabricated status text anywhere in this repo', () => {
  const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  const tonViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/products/TONNetworkView.tsx'), 'utf-8');
  const sidebarContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SidebarNav.tsx'), 'utf-8');
  const tourContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/FirstRunTour.tsx'), 'utf-8');

  it('11. the hardcoded "TON MAINNET: CONNECTED" claim is gone', () => {
    expect(tonViewContent).not.toContain('TON MAINNET: CONNECTED');
    expect(serverContent).not.toContain('TON MAINNET: CONNECTED');
  });

  it('12. the hardcoded "GUARDIANS: 8/8 READY" claim (and any other 8/8 guardian claim) is gone', () => {
    expect(tonViewContent).not.toContain('GUARDIANS: 8/8');
    expect(tonViewContent).not.toMatch(/8\s*\/\s*8\s*READY/i);
  });

  it('the fabricated wallet balance and address strings are gone', () => {
    expect(tonViewContent).not.toContain('142.50 TON');
    expect(tonViewContent).not.toContain('EQA...9x2F');
    expect(tonViewContent).not.toContain('EQD...3m8B');
  });

  it('13. the TON UI actually consumes the real backend routes, not local mock state', () => {
    expect(tonViewContent).toContain('/api/ton/status');
    expect(tonViewContent).toContain('/api/ton/telemetry');
    expect(tonViewContent).toContain('/api/ton/guardians');
    // The old component's entire hardcoded capabilities array must be gone.
    expect(tonViewContent).not.toContain("status: 'MOCK'");
    expect(tonViewContent).not.toContain("status: 'UI ONLY'");
  });

  it('14. FirstRunTour\'s agent-fleet target resolves to a real nav item', () => {
    expect(tourContent).toContain("target: '#nav-agent-fleet'");
    expect(sidebarContent).toContain("id: 'agent-fleet'");
  });

  it('15. Sidebar nav DOM ids are unique across the whole nav (item.navId ?? item.id, deduplicated)', () => {
    // Extract every { id: 'x' ... } or { id: 'x', navId: 'y' ... } object literal
    // from the navigationGroups source and compute the DOM id each would render.
    const itemRe = /\{\s*id:\s*'([^']+)'\s*as ActiveTab(?:,\s*navId:\s*'([^']+)')?/g;
    const domIds: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = itemRe.exec(sidebarContent)) !== null) {
      domIds.push(match[2] ?? match[1]);
    }
    expect(domIds.length).toBeGreaterThan(0);
    expect(new Set(domIds).size).toBe(domIds.length);
  });
});
