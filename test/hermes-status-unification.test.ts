import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { deriveHermesDisplayStatus } from '../src/hooks/useHermesHealth';
import type { HermesAdapterHealth } from '../src/types/hermes';

// ---------------------------------------------------------------------------
// fix(hermes): unify runtime status across admin UI.
//
// Before this: WorkspaceTopNav.tsx had a hardcoded `statusText: 'LIVE'` on
// the Hermes workspace config and a hardcoded `badge: 'LIVE'` on its Chat
// sub-tab, neither wired to any real health check. Meanwhile the top-bar
// pill (AirbyteHeader) and WorkspaceTopNav's own "Evidence-Based Status
// Pill" each independently re-derived a label from the real
// useHermesHealth() hook with their own separate ternary chains — real,
// but duplicated and free to drift. All of this while HERMES_ADAPTER_
// BASE_URL is unset in this environment, so the real status has always
// been NOT_CONNECTED/NOT_CONFIGURED — "LIVE" was never true here.
//
// The fix: deriveHermesDisplayStatus() (src/hooks/useHermesHealth.ts) is
// the one place that decision is made, and every display imports it.
// ---------------------------------------------------------------------------

function baseHealth(overrides: Partial<HermesAdapterHealth> = {}): HermesAdapterHealth {
  return {
    status: 'NOT_CONNECTED',
    connectivity_status: 'NOT_CONNECTED',
    auth_status: 'NOT_CONFIGURED',
    runtime_type: 'hermes',
    runtime_version: 'NOT_AVAILABLE',
    adapter_version: '1',
    runtime_instance_id: 'NOT_AVAILABLE',
    capabilities_schema_version: '1',
    process_alive: false,
    gateway_alive: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('deriveHermesDisplayStatus: only ever returns one of the four truthful states', () => {
  it('missing HERMES_ADAPTER_BASE_URL (auth_status NOT_CONFIGURED) -> "NOT CONFIGURED", never LIVE/CONNECTED', () => {
    // This is the exact shape HermesAdapter.health() returns when
    // HERMES_ADAPTER_BASE_URL is unset (src/services/hermesAdapter.ts).
    const health = baseHealth({ status: 'NOT_CONNECTED', auth_status: 'NOT_CONFIGURED' });
    const result = deriveHermesDisplayStatus(health);
    expect(result.label).toBe('NOT CONFIGURED');
    expect(result.label).not.toBe('LIVE');
    expect(result.label).not.toBe('CONNECTED');
  });

  it('a real, reachable, healthy runtime (status UP) -> "CONNECTED"', () => {
    const health = baseHealth({ status: 'UP', auth_status: 'AUTHENTICATED' });
    expect(deriveHermesDisplayStatus(health).label).toBe('CONNECTED');
  });

  it('status DEGRADED -> "DEGRADED"', () => {
    const health = baseHealth({ status: 'DEGRADED', auth_status: 'AUTHENTICATED' });
    expect(deriveHermesDisplayStatus(health).label).toBe('DEGRADED');
  });

  it.each(['DOWN', 'NOT_CONNECTED', 'AUTH_ERROR', 'UNKNOWN'] as const)(
    'status %s (configured but not usably connected) -> "NOT CONNECTED", never LIVE',
    (status) => {
      const health = baseHealth({ status, auth_status: 'AUTHENTICATED' });
      const result = deriveHermesDisplayStatus(health);
      expect(result.label).toBe('NOT CONNECTED');
      expect(result.label).not.toBe('LIVE');
    }
  );

  it('the return type only ever contains these four exact strings, structurally', () => {
    const allowed = new Set(['CONNECTED', 'DEGRADED', 'NOT CONNECTED', 'NOT CONFIGURED']);
    const samples: HermesAdapterHealth[] = [
      baseHealth({ status: 'UP', auth_status: 'AUTHENTICATED' }),
      baseHealth({ status: 'DEGRADED', auth_status: 'AUTHENTICATED' }),
      baseHealth({ status: 'DOWN', auth_status: 'AUTHENTICATED' }),
      baseHealth({ status: 'NOT_CONNECTED', auth_status: 'NOT_CONFIGURED' }),
      baseHealth({ status: 'AUTH_ERROR', auth_status: 'AUTH_ERROR' }),
      baseHealth({ status: 'UNKNOWN', auth_status: 'UNKNOWN' }),
    ];
    for (const s of samples) {
      expect(allowed.has(deriveHermesDisplayStatus(s).label)).toBe(true);
    }
  });
});

describe('WorkspaceTopNav.tsx and AirbyteHeader.tsx: no duplicate/static Hermes status remains', () => {
  const workspaceTopNavContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/WorkspaceTopNav.tsx'), 'utf-8');
  const airbyteHeaderContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AirbyteHeader.tsx'), 'utf-8');

  it('WorkspaceTopNav no longer hardcodes statusText/badge "LIVE" for the Hermes workspace config', () => {
    const hermesConfigIdx = workspaceTopNavContent.indexOf("hermes: {");
    const chatTabIdx = workspaceTopNavContent.indexOf("id: 'hermes-chat'");
    expect(hermesConfigIdx).toBeGreaterThan(-1);
    expect(chatTabIdx).toBeGreaterThan(hermesConfigIdx);
    // Slice covers just the hermes config block (up to the next top-level workspace key).
    const nextConfigIdx = workspaceTopNavContent.indexOf('claude: {', hermesConfigIdx);
    const hermesConfigSlice = workspaceTopNavContent.slice(hermesConfigIdx, nextConfigIdx);
    expect(hermesConfigSlice).not.toContain("statusText: 'LIVE'");
    expect(hermesConfigSlice).not.toContain("badge: 'LIVE'");
  });

  it('WorkspaceTopNav imports and uses the canonical deriveHermesDisplayStatus, not a private ternary chain', () => {
    expect(workspaceTopNavContent).toContain("import { useHermesHealth, deriveHermesDisplayStatus } from '../hooks/useHermesHealth'");
    expect(workspaceTopNavContent).toContain('const hermesDisplayStatus = deriveHermesDisplayStatus(hermesHealth)');
    // The old duplicated inline mapping is gone.
    expect(workspaceTopNavContent).not.toMatch(/hermesHealth\.status === 'UP' \? '#00D26A' :\s*\n\s*hermesHealth\.status === 'DEGRADED'/);
  });

  it('AirbyteHeader imports and uses the same canonical deriveHermesDisplayStatus for its HERMES status card', () => {
    expect(airbyteHeaderContent).toContain("import { useHermesHealth, deriveHermesDisplayStatus } from '../hooks/useHermesHealth'");
    expect(airbyteHeaderContent).toContain('const hermesDisplayStatus = deriveHermesDisplayStatus(hermesHealth)');
    expect(airbyteHeaderContent).toContain('state: hermesDisplayStatus.label');
    expect(airbyteHeaderContent).toContain('stateColor: hermesDisplayStatus.color');
    // The old duplicated inline mapping is gone.
    expect(airbyteHeaderContent).not.toMatch(/hermesHealth\.status === 'UP'\s*\n\s*\? 'CONNECTED'/);
  });

  it('the workspace-existing pulse dot (accentColor) is untouched — this fix only touches status claims, not workspace/navigation presence', () => {
    expect(workspaceTopNavContent).toContain("accentColor: '#615EFF',");
  });
});

describe('Consistency: top bar and workspace nav can never disagree, because they compute from the same function', () => {
  it('disconnected Hermes (this environment: no HERMES_ADAPTER_BASE_URL) resolves to the identical label wherever deriveHermesDisplayStatus is called', () => {
    const health = baseHealth({ status: 'NOT_CONNECTED', auth_status: 'NOT_CONFIGURED' });
    const topBarLabel = deriveHermesDisplayStatus(health).label;
    const workspaceNavLabel = deriveHermesDisplayStatus(health).label;
    const chatBadgeLabel = deriveHermesDisplayStatus(health).label;
    expect(topBarLabel).toBe(workspaceNavLabel);
    expect(workspaceNavLabel).toBe(chatBadgeLabel);
    expect(topBarLabel).toBe('NOT CONFIGURED');
  });

  it('a connected Hermes resolves to "CONNECTED" identically everywhere', () => {
    const health = baseHealth({ status: 'UP', auth_status: 'AUTHENTICATED' });
    expect(deriveHermesDisplayStatus(health).label).toBe('CONNECTED');
    expect(deriveHermesDisplayStatus({ ...health }).label).toBe('CONNECTED');
  });
});
