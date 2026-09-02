import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-windmill-targets-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createWindmillTarget, listVisibleWindmillTargets, listPlatformWindmillTargets,
  resolveWindmillTarget, updateWindmillTarget, isValidRemotePath, validateAgainstInputSchema,
} from '../lib/windmill-targets';

// ---------------------------------------------------------------------------
// ADR-006 / Workstream K — the allowed target registry. No route anywhere
// accepts a caller-supplied remote path directly; every submission resolves
// a targetId through resolveWindmillTarget(). These tests exercise the real
// SQLite-backed registry (a fresh, isolated DB file per test run), not a
// mock — workspace scoping and path validation are exactly what a live
// submission path depends on.
// ---------------------------------------------------------------------------

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

describe('K4: isValidRemotePath — bounded, safe-looking paths only', () => {
  it('accepts a normal script path', () => {
    expect(isValidRemotePath('f/folder/script')).toBe(true);
  });
  it('rejects path traversal', () => {
    expect(isValidRemotePath('f/../../etc/passwd')).toBe(false);
  });
  it('rejects an embedded protocol/URL', () => {
    expect(isValidRemotePath('http://evil.example/x')).toBe(false);
  });
  it('rejects a path exceeding the bound', () => {
    expect(isValidRemotePath('f/' + 'a'.repeat(400))).toBe(false);
  });
  it('rejects non-string input', () => {
    // @ts-expect-error deliberate wrong type
    expect(isValidRemotePath(123)).toBe(false);
  });
});

describe('K1/K2/K3: workspace scoping of the target registry', () => {
  const wsA = 'ws-test-alpha';
  const wsB = 'ws-test-beta';
  let workspaceTargetId: string;
  let platformTargetId: string;

  beforeAll(() => {
    const wsTarget = createWindmillTarget({
      workspaceId: wsA, name: 'Alpha-only script', remotePath: 'f/alpha/report',
      kind: 'script', createdByUserId: 'user-1',
    });
    workspaceTargetId = wsTarget.id;

    const platformTarget = createWindmillTarget({
      workspaceId: null, name: 'Global flow', remotePath: 'f/shared/pipeline',
      kind: 'flow', createdByUserId: 'platform-admin-1',
    });
    platformTargetId = platformTarget.id;
  });

  it('a workspace-scoped target is visible to its own workspace', () => {
    const visible = listVisibleWindmillTargets(wsA);
    expect(visible.some((t) => t.id === workspaceTargetId)).toBe(true);
  });

  it('a workspace-scoped target is NOT visible to a different workspace', () => {
    const visible = listVisibleWindmillTargets(wsB);
    expect(visible.some((t) => t.id === workspaceTargetId)).toBe(false);
  });

  it('a platform-global target is visible to every workspace', () => {
    expect(listVisibleWindmillTargets(wsA).some((t) => t.id === platformTargetId)).toBe(true);
    expect(listVisibleWindmillTargets(wsB).some((t) => t.id === platformTargetId)).toBe(true);
  });

  it('resolveWindmillTarget scoped to the wrong workspace returns null (R3) — never leaks the target', () => {
    expect(resolveWindmillTarget(wsB, workspaceTargetId)).toBeNull();
  });

  it('resolveWindmillTarget scoped to the owning workspace returns the real target', () => {
    const resolved = resolveWindmillTarget(wsA, workspaceTargetId);
    expect(resolved?.id).toBe(workspaceTargetId);
    expect(resolved?.remote_path).toBe('f/alpha/report');
  });

  it('resolveWindmillTarget resolves a platform-global target from any workspace', () => {
    expect(resolveWindmillTarget(wsA, platformTargetId)?.id).toBe(platformTargetId);
    expect(resolveWindmillTarget(wsB, platformTargetId)?.id).toBe(platformTargetId);
  });

  it('a disabled target does not resolve, even for its own workspace', () => {
    updateWindmillTarget(wsA, workspaceTargetId, { enabled: false });
    expect(resolveWindmillTarget(wsA, workspaceTargetId)).toBeNull();
    updateWindmillTarget(wsA, workspaceTargetId, { enabled: true }); // restore for subsequent tests
  });

  it('a workspace admin cannot edit a target belonging to a different workspace (K3)', () => {
    const result = updateWindmillTarget(wsB, workspaceTargetId, { name: 'hijacked' });
    expect(result).toBeNull();
  });

  it('platform scope (null) can edit any target', () => {
    const result = updateWindmillTarget(null, workspaceTargetId, { description: 'edited by platform admin' });
    expect(result?.description).toBe('edited by platform admin');
  });

  it('createWindmillTarget rejects an unsafe remote path before ever writing a row', () => {
    expect(() => createWindmillTarget({
      workspaceId: wsA, name: 'bad', remotePath: '../../etc/passwd', kind: 'script', createdByUserId: 'user-1',
    })).toThrow();
  });

  it('listPlatformWindmillTargets returns every target regardless of scope (platform-admin view)', () => {
    const all = listPlatformWindmillTargets();
    expect(all.some((t) => t.id === workspaceTargetId)).toBe(true);
    expect(all.some((t) => t.id === platformTargetId)).toBe(true);
  });
});

describe('K4: validateAgainstInputSchema — real but bounded, never fabricated', () => {
  it('passes when no schema is configured', () => {
    const target = createWindmillTarget({
      workspaceId: 'ws-schema-test', name: 'no schema', remotePath: 'f/x/y', kind: 'script', createdByUserId: 'u',
    });
    expect(validateAgainstInputSchema(target, { anything: true }).valid).toBe(true);
  });

  it('rejects a missing required field', () => {
    const target = createWindmillTarget({
      workspaceId: 'ws-schema-test', name: 'with schema', remotePath: 'f/x/z', kind: 'script', createdByUserId: 'u',
      inputSchema: { type: 'object', required: ['company'], properties: { company: { type: 'string' } } },
    });
    const result = validateAgainstInputSchema(target, {});
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/company/);
  });

  it('accepts a valid input matching the schema', () => {
    const target = createWindmillTarget({
      workspaceId: 'ws-schema-test', name: 'with schema 2', remotePath: 'f/x/w', kind: 'script', createdByUserId: 'u',
      inputSchema: { type: 'object', required: ['company'], properties: { company: { type: 'string' } } },
    });
    expect(validateAgainstInputSchema(target, { company: 'Acme' }).valid).toBe(true);
  });

  it('rejects a wrong-typed field', () => {
    const target = createWindmillTarget({
      workspaceId: 'ws-schema-test', name: 'with schema 3', remotePath: 'f/x/v', kind: 'script', createdByUserId: 'u',
      inputSchema: { type: 'object', properties: { count: { type: 'number' } } },
    });
    const result = validateAgainstInputSchema(target, { count: 'not-a-number' });
    expect(result.valid).toBe(false);
  });
});
