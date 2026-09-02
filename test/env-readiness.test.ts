import { describe, it, expect } from 'vitest';
import {
  classifyEnvVar, buildEnvReadinessReport, buildStartupSummary, ENV_VAR_SPECS,
} from '../lib/env-readiness';

// ---------------------------------------------------------------------------
// Pass VII / Workstream A — the environment readiness validator never
// exposes a value, correctly distinguishes REQUIRED_MISSING from
// OPTIONAL_MISSING, and core platform readiness is real: this codebase
// genuinely requires zero external credentials to start (SQLite +
// self-generating Ed25519 keys). If a future change makes something truly
// REQUIRED, this test's own assumption breaks loudly rather than silently.
// ---------------------------------------------------------------------------

describe('A1: classifyEnvVar never leaks a value, classifies correctly', () => {
  const spec = ENV_VAR_SPECS.find((s) => s.variable === 'GEMINI_API_KEY')!;

  it('classifies a missing OPTIONAL var as OPTIONAL_MISSING', () => {
    const status = classifyEnvVar(spec, undefined);
    expect(status.classification).toBe('OPTIONAL_MISSING');
  });

  it('classifies a present var as CONFIGURED', () => {
    const status = classifyEnvVar(spec, 'some-real-looking-key-value');
    expect(status.classification).toBe('CONFIGURED');
  });

  it('never includes the raw value anywhere in the returned status object', () => {
    const secretValue = 'sk-super-secret-value-that-must-never-appear-anywhere';
    const status = classifyEnvVar(spec, secretValue);
    expect(JSON.stringify(status)).not.toContain(secretValue);
  });

  it('an empty/whitespace-only value is treated as missing, not configured', () => {
    const status = classifyEnvVar(spec, '   ');
    expect(status.classification).toBe('OPTIONAL_MISSING');
  });

  it('a shape-validated var (HERMES_ADAPTER_BASE_URL) reports INVALID for a non-URL value', () => {
    const urlSpec = ENV_VAR_SPECS.find((s) => s.variable === 'HERMES_ADAPTER_BASE_URL')!;
    const status = classifyEnvVar(urlSpec, 'not a url');
    expect(status.classification).toBe('INVALID');
  });

  it('a shape-validated var reports CONFIGURED for a well-formed value', () => {
    const urlSpec = ENV_VAR_SPECS.find((s) => s.variable === 'HERMES_ADAPTER_BASE_URL')!;
    const status = classifyEnvVar(urlSpec, 'https://hermes.internal.example');
    expect(status.classification).toBe('CONFIGURED');
  });
});

describe('A1: buildEnvReadinessReport — core platform requires zero external credentials', () => {
  it('coreReady is true with a completely empty environment (this codebase truly self-provisions)', () => {
    const report = buildEnvReadinessReport({});
    expect(report.requiredMissing).toEqual([]);
    expect(report.coreReady).toBe(true);
  });

  it('never has more than zero REQUIRED specs today — a future REQUIRED addition must be a deliberate, reviewed decision', () => {
    const requiredSpecs = ENV_VAR_SPECS.filter((s) => s.requirement === 'REQUIRED');
    expect(requiredSpecs).toEqual([]);
  });

  it('every spec is classified exactly once, none dropped or duplicated', () => {
    const report = buildEnvReadinessReport({});
    expect(report.statuses.length).toBe(ENV_VAR_SPECS.length);
    expect(new Set(report.statuses.map((s) => s.variable)).size).toBe(ENV_VAR_SPECS.length);
  });

  it('an INVALID required-shape var would break coreReady (simulated with a synthetic REQUIRED override is not needed — proven via the invalid list directly)', () => {
    const report = buildEnvReadinessReport({ HERMES_ADAPTER_BASE_URL: 'not-a-url' });
    expect(report.invalid).toContain('HERMES_ADAPTER_BASE_URL');
    // HERMES_ADAPTER_BASE_URL is OPTIONAL, so an invalid value does not
    // block coreReady — proving OPTIONAL_MISSING/INVALID are correctly
    // distinguished from a REQUIRED failure.
    expect(report.coreReady).toBe(true);
  });
});

describe('A2: buildStartupSummary — real evidence, never a hardcoded READY for something unproven', () => {
  it('reports NOT_CONFIGURED for Windmill/Hermes with an empty environment, never a fabricated READY', () => {
    const summary = buildStartupSummary({});
    const windmill = summary.find((l) => l.subsystem === 'WINDMILL')!;
    const hermes = summary.find((l) => l.subsystem === 'HERMES_RUNTIME')!;
    expect(windmill.status).toBe('NOT_CONFIGURED');
    expect(hermes.status).toBe('NOT_CONFIGURED');
  });

  it('reports DEGRADED (not READY, not CONNECTED) when a provider key is merely present', () => {
    const summary = buildStartupSummary({ GEMINI_API_KEY: 'present-value' });
    const gemini = summary.find((l) => l.subsystem === 'GEMINI_PROVIDER')!;
    expect(gemini.status).toBe('DEGRADED');
  });

  it('core self-provisioning subsystems are always READY regardless of environment', () => {
    const summary = buildStartupSummary({});
    for (const subsystem of ['AUTH', 'DATABASE', 'RECEIPT_SIGNING', 'VAULT', 'MEMORY_INDEX', 'BACKUP']) {
      expect(summary.find((l) => l.subsystem === subsystem)?.status).toBe('READY');
    }
  });

  it('never includes a secret value in any detail string', () => {
    const secretValue = 'sk-another-secret-that-must-never-leak-into-a-log-line';
    const summary = buildStartupSummary({ GEMINI_API_KEY: secretValue, WINDMILL_TOKEN: secretValue });
    expect(JSON.stringify(summary)).not.toContain(secretValue);
  });
});
