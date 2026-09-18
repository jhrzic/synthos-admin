import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ENV_VAR_SPECS } from '../lib/env-readiness';

// ---------------------------------------------------------------------------
// DAY 1 — env spec drift guard.
//
// docs/IMPLEMENTATION-STATUS.md claims buildEnvReadinessReport() "classifies
// every env var this codebase reads". That claim was FALSE when this test was
// written: PUBLIC_BASE_URL — the variable that decides the https origin used to
// build the embed snippet a customer pastes into their own website — was read
// by lib/public-url.ts and declared nowhere. Startup summary, GET /api/ready
// and the readiness panel were all silent about it.
//
// The individual fix is one line in ENV_VAR_SPECS. This test is the actual
// fix: it fails the build the next time a server-side env read is added
// without a declaration, so the documented completeness claim stays true by
// construction rather than by vigilance.
//
// Scope is deliberately SERVER-SIDE ONLY (lib/ and server.ts). Client bundles
// use import.meta.env, not process.env, and are a different mechanism.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

/** Vars that are legitimately read but are not deployment configuration. */
const NOT_DEPLOYMENT_CONFIG = new Set([
  // Set by the test harness itself, never by an operator.
  'VITEST',
  'NODE_TEST_CONTEXT',
  // Vitest-only gate override for pre-existing execution tests; ignored unless VITEST is set.
  'SYNTHOS_TEST_QUEUED_TASK_PROCESSING',
  // Read only to locate a developer's own machine paths in dev tooling.
  'HOME',
  // The Windows spelling of HOME, read as its fallback when resolving a
  // host path. OS-provided, never operator configuration — same class as
  // HOME above, not a deployment variable someone could set meaningfully.
  'USERPROFILE',
  'PWD',
  'npm_lifecycle_event',
  // OS-provided, read only to pick a shell for the dev-only terminal route
  // (ADR-007: that route is structurally DEV_ONLY and 403s in production).
  // Not something an operator configures for a deployment.
  'SHELL',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Every `process.env.FOO` / `process.env['FOO']` read, with the file it is in. */
function collectEnvReads(): Map<string, string[]> {
  const files = [...walk(path.join(ROOT, 'lib')), path.join(ROOT, 'server.ts')];
  const found = new Map<string, string[]>();
  const pattern = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(pattern)) {
      const name = m[1] || m[2];
      if (NOT_DEPLOYMENT_CONFIG.has(name)) continue;
      const rel = path.relative(ROOT, file);
      const list = found.get(name) ?? [];
      if (!list.includes(rel)) list.push(rel);
      found.set(name, list);
    }
  }
  return found;
}

describe('environment specification completeness', () => {
  const declared = new Set(ENV_VAR_SPECS.map((s) => s.variable));

  it('every server-side process.env read is declared in ENV_VAR_SPECS', () => {
    const reads = collectEnvReads();
    const undeclared = [...reads.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([name, files]) => `${name} (read in ${files.join(', ')})`);

    expect(
      undeclared,
      'These variables are read by the server but never classified, so the startup ' +
        'summary, /api/ready and the readiness panel cannot report on them. Add each ' +
        'to ENV_VAR_SPECS in lib/env-readiness.ts, or to NOT_DEPLOYMENT_CONFIG here ' +
        'if it is genuinely not operator-facing configuration.',
    ).toEqual([]);
  });

  it('PUBLIC_BASE_URL specifically is declared — the DAY 1 regression', () => {
    // Named explicitly because this is the variable whose absence would ship a
    // customer an embed snippet that browsers block as mixed content.
    expect(declared.has('PUBLIC_BASE_URL')).toBe(true);
    const spec = ENV_VAR_SPECS.find((s) => s.variable === 'PUBLIC_BASE_URL')!;
    expect(spec.secrecy).toBe('NON_SECRET');
    expect(spec.validate, 'a malformed public address must be reported as INVALID').toBeDefined();
    expect(spec.validate!('https://admin.example.com')).toBe(true);
    expect(spec.validate!('not-a-url')).toBe(false);
  });

  it('.env.example documents every non-secret operator-facing variable', () => {
    const examplePath = path.join(ROOT, '.env.example');
    expect(fs.existsSync(examplePath)).toBe(true);
    const example = fs.readFileSync(examplePath, 'utf8');
    const present = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

    const missing = ENV_VAR_SPECS
      .map((s) => s.variable)
      // NODE_ENV is set by the runtime/compose file, not by a .env entry.
      .filter((v) => v !== 'NODE_ENV')
      .filter((v) => !present.has(v));

    expect(
      missing,
      'An operator copies .env.example to .env. A variable absent from it is a ' +
        'variable they will never know to set.',
    ).toEqual([]);
  });

  it('.env.example contains no variable the app does not actually read', () => {
    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const present = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    const stale = present.filter((v) => !declared.has(v));
    expect(
      stale,
      'These are offered to the operator but read by nothing — either wire them ' +
        'up or delete them. An inert knob reads as a working one.',
    ).toEqual([]);
  });

  it('.env.example ships no real secret values', () => {
    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    for (const spec of ENV_VAR_SPECS.filter((s) => s.secrecy === 'SECRET')) {
      const m = example.match(new RegExp(`^${spec.variable}=(.*)$`, 'm'));
      if (!m) continue;
      const value = m[1].trim().replace(/^["']|["']$/g, '');
      expect(
        value === '' || value.startsWith('MY_') || value.startsWith('your-'),
        `${spec.variable} in .env.example must be empty or an obvious placeholder, got a real-looking value`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// DAY 1 — the public address is REPORTED at startup, in every configuration.
//
// Declaring PUBLIC_BASE_URL in ENV_VAR_SPECS fixed the classification report.
// It did not fix buildStartupSummary(), which is a separate hand-written list —
// so an operator could still start a production server and be told nothing
// about the one variable that decides whether the customer's embed works.
// These assert the four configurations that actually occur in the field.
// ---------------------------------------------------------------------------

import { buildStartupSummary } from '../lib/env-readiness';

function publicAddressLine(env: Record<string, string>) {
  const line = buildStartupSummary(env as NodeJS.ProcessEnv)
    .find((l) => l.subsystem === 'PUBLIC_ADDRESS');
  expect(line, 'PUBLIC_ADDRESS must appear in the startup summary').toBeDefined();
  return line!;
}

describe('public address startup reporting', () => {
  it('unset, no proxy trusted -> NOT_CONFIGURED, and says why it will break', () => {
    const line = publicAddressLine({});
    expect(line.status).toBe('NOT_CONFIGURED');
    expect(line.detail).toMatch(/mixed content|http:\/\//i);
  });

  it('unset but behind a trusted proxy -> DEGRADED, not silently fine', () => {
    const line = publicAddressLine({ TRUST_PROXY_HOPS: '1' });
    expect(line.status).toBe('DEGRADED');
    expect(line.detail).toMatch(/inferred/i);
  });

  it('set to a plain http origin -> FAILED, because the widget cannot install', () => {
    // The dangerous case: it LOOKS configured. Reporting this as READY would be
    // the exact silent failure this whole subsystem exists to prevent.
    const line = publicAddressLine({ PUBLIC_BASE_URL: 'http://admin.example.com' });
    expect(line.status).toBe('FAILED');
    expect(line.detail).toMatch(/mixed content/i);
  });

  it('set to a malformed value -> FAILED', () => {
    expect(publicAddressLine({ PUBLIC_BASE_URL: 'not-a-url' }).status).toBe('FAILED');
  });

  it('set to a real https origin -> READY, and names the origin', () => {
    const line = publicAddressLine({ PUBLIC_BASE_URL: 'https://admin.example.com' });
    expect(line.status).toBe('READY');
    expect(line.detail).toContain('https://admin.example.com');
  });

  it('http on localhost is READY — local development is not a mixed-content risk', () => {
    expect(publicAddressLine({ PUBLIC_BASE_URL: 'http://localhost:3000' }).status).toBe('READY');
  });

  it('never echoes a secret into the startup log', () => {
    const summary = buildStartupSummary({
      GEMINI_API_KEY: 'super-secret-gemini-value',
      OPENAI_API_KEY: 'super-secret-openai-value',
      PUBLIC_BASE_URL: 'https://admin.example.com',
    } as NodeJS.ProcessEnv);
    const text = JSON.stringify(summary);
    expect(text).not.toContain('super-secret-gemini-value');
    expect(text).not.toContain('super-secret-openai-value');
  });
});
