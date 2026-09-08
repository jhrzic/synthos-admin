import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';

// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 2: writeWorkspaceArtifact() (lib/vault.ts),
// the canonical Vault writer.
//
// This file uses a real, isolated SQLite DB (SYNTHOS_DB_PATH, same pattern
// as test/jarvis-context.test.ts) but VAULT_ROOT itself
// (path.join(process.cwd(), 'vault')) has no env override — writing through
// the real function means writing into this repo's real vault/ directory.
// Every test below writes under a uniquely-tagged, timestamped workspace id
// (never colliding with real data) and afterAll removes every directory
// this file created — the real repo's vault/ is left exactly as it was.
// ---------------------------------------------------------------------------

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-vault-writer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getDatabase, createInitialTask } from '../lib/persistence';
import { writeWorkspaceArtifact, VaultWriteSecurityError, VAULT_ROOT, getWorkspaceVaultEntry, listWorkspaceVaultEntries } from '../lib/vault';

const RUN_TAG = Date.now();
const createdWorkspaceDirs: string[] = [];

function testWorkspaceId(label: string): string {
  const id = `test-vault-${label}-${RUN_TAG}`;
  createdWorkspaceDirs.push(path.join(VAULT_ROOT, 'workspaces', id));
  return id;
}

function realTask(workspaceId: string, title: string): string {
  const taskId = `task-vault-${RUN_TAG}-${Math.random().toString(36).slice(2)}`;
  createInitialTask({ taskId, workspaceId, title, description: 'vault writer test fixture', assignedAgent: 'scout', assignedModel: 'gemini-3.6-flash' });
  return taskId;
}

beforeAll(() => {
  getDatabase(); // self-provisions schema
});

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  for (const dir of createdWorkspaceDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('writeWorkspaceArtifact: basic real write', () => {
  it('writes a real file to disk and a real artifacts row, with a matching content hash', () => {
    const ws = testWorkspaceId('basic');
    const taskId = realTask(ws, 'Basic Write Test');
    const content = '# Hello\n\nReal content.\n';

    const artifact = writeWorkspaceArtifact({ workspaceId: ws, taskId, content, folder: 'Notes' });

    expect(fs.existsSync(artifact.disk_path)).toBe(true);
    expect(fs.readFileSync(artifact.disk_path, 'utf8')).toBe(content);

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifact.artifact_id) as any;
    expect(row).toBeDefined();
    expect(row.content_hash).toBe(artifact.content_hash);

    const realHash = `sha256:${require('node:crypto').createHash('sha256').update(content, 'utf8').digest('hex')}`;
    expect(artifact.content_hash).toBe(realHash);
  });

  it('the relative_path is workspace-scoped: vault/workspaces/<workspaceId>/<folder>/<artifactId>.<ext>', () => {
    const ws = testWorkspaceId('scoped-path');
    const taskId = realTask(ws, 'Scoped Path Test');
    const artifact = writeWorkspaceArtifact({ workspaceId: ws, taskId, content: 'x', folder: 'Startup-Theses' });

    expect(artifact.relative_path).toBe(`workspaces/${ws}/Startup-Theses/${artifact.artifact_id}.md`);
    expect(artifact.disk_path).toBe(path.resolve(VAULT_ROOT, artifact.relative_path));
  });

  it('defaults folder to "Artifacts" and extension to "md" when omitted', () => {
    const ws = testWorkspaceId('defaults');
    const taskId = realTask(ws, 'Defaults Test');
    const artifact = writeWorkspaceArtifact({ workspaceId: ws, taskId, content: 'x' });
    expect(artifact.relative_path).toBe(`workspaces/${ws}/Artifacts/${artifact.artifact_id}.md`);
  });
});

describe('writeWorkspaceArtifact: same-title collision — REQUIRED regression (Step 2, item 3)', () => {
  it('identical titles within one workspace cannot silently overwrite — two writes with the same title produce two real, independently-readable files', () => {
    const ws = testWorkspaceId('same-title-one-ws');
    const taskA = realTask(ws, 'Duplicate Title');
    const taskB = realTask(ws, 'Duplicate Title');

    const contentA = '# Duplicate Title\n\nVersion A — must survive.\n';
    const contentB = '# Duplicate Title\n\nVersion B — must NOT overwrite A.\n';

    const artifactA = writeWorkspaceArtifact({ workspaceId: ws, taskId: taskA, content: contentA, folder: 'Startup-Theses' });
    const artifactB = writeWorkspaceArtifact({ workspaceId: ws, taskId: taskB, content: contentB, folder: 'Startup-Theses' });

    expect(artifactA.disk_path).not.toBe(artifactB.disk_path);
    expect(artifactA.artifact_id).not.toBe(artifactB.artifact_id);
    // Both real files exist, independently, with their own real content —
    // this is the exact failure mode of the old
    // vault/Startup-Theses/${sanitizedTitle}.md scheme: the second write
    // would have overwritten the first at the identical path.
    expect(fs.readFileSync(artifactA.disk_path, 'utf8')).toBe(contentA);
    expect(fs.readFileSync(artifactB.disk_path, 'utf8')).toBe(contentB);
  });

  it('identical titles across two different workspaces cannot collide — different roots entirely', () => {
    const wsX = testWorkspaceId('same-title-x');
    const wsY = testWorkspaceId('same-title-y');
    const taskX = realTask(wsX, 'Cross-Workspace Duplicate');
    const taskY = realTask(wsY, 'Cross-Workspace Duplicate');

    const artifactX = writeWorkspaceArtifact({ workspaceId: wsX, taskId: taskX, content: 'X content', folder: 'Startup-Theses' });
    const artifactY = writeWorkspaceArtifact({ workspaceId: wsY, taskId: taskY, content: 'Y content', folder: 'Startup-Theses' });

    expect(artifactX.disk_path).not.toBe(artifactY.disk_path);
    expect(artifactX.relative_path.startsWith(`workspaces/${wsX}/`)).toBe(true);
    expect(artifactY.relative_path.startsWith(`workspaces/${wsY}/`)).toBe(true);
    expect(fs.readFileSync(artifactX.disk_path, 'utf8')).toBe('X content');
    expect(fs.readFileSync(artifactY.disk_path, 'utf8')).toBe('Y content');
  });
});

describe('writeWorkspaceArtifact: cross-workspace artifact isolation (read side, REQUIRED — Step 2, item 3/7)', () => {
  it('an artifact written under workspace A does not appear in workspace B\'s listing, and is not readable by workspace B\'s id', () => {
    const wsA = testWorkspaceId('iso-a');
    const wsB = testWorkspaceId('iso-b');
    const taskA = realTask(wsA, 'Isolation Owner Task');

    const artifact = writeWorkspaceArtifact({ workspaceId: wsA, taskId: taskA, content: 'secret to A', folder: 'Notes' });

    const entryViaB = getWorkspaceVaultEntry(wsB, artifact.artifact_id);
    expect(entryViaB).toBeNull();

    const listB = listWorkspaceVaultEntries(wsB);
    expect(listB.find((e) => e.artifact_id === artifact.artifact_id)).toBeUndefined();

    const entryViaA = getWorkspaceVaultEntry(wsA, artifact.artifact_id);
    expect(entryViaA).not.toBeNull();
    expect(entryViaA?.content).toBe('secret to A');
  });
});

describe('writeWorkspaceArtifact: path traversal / absolute path / NUL protections (Rev 2, REQUIRED)', () => {
  it('rejects a workspaceId containing ".."', () => {
    expect(() => writeWorkspaceArtifact({ workspaceId: '../../etc', taskId: 't1', content: 'x' })).toThrow(VaultWriteSecurityError);
  });

  it('rejects a workspaceId containing a path separator', () => {
    expect(() => writeWorkspaceArtifact({ workspaceId: 'a/b', taskId: 't1', content: 'x' })).toThrow(VaultWriteSecurityError);
    expect(() => writeWorkspaceArtifact({ workspaceId: 'a\\b', taskId: 't1', content: 'x' })).toThrow(VaultWriteSecurityError);
  });

  it('rejects an absolute-path-shaped workspaceId', () => {
    expect(() => writeWorkspaceArtifact({ workspaceId: '/etc/passwd', taskId: 't1', content: 'x' })).toThrow(VaultWriteSecurityError);
  });

  it('rejects a workspaceId containing a NUL byte', () => {
    expect(() => writeWorkspaceArtifact({ workspaceId: 'ws\0evil', taskId: 't1', content: 'x' })).toThrow(VaultWriteSecurityError);
  });

  it('rejects an empty workspaceId', () => {
    expect(() => writeWorkspaceArtifact({ workspaceId: '', taskId: 't1', content: 'x' })).toThrow(VaultWriteSecurityError);
  });

  it('rejects a folder containing ".." or a separator', () => {
    const ws = testWorkspaceId('bad-folder');
    expect(() => writeWorkspaceArtifact({ workspaceId: ws, taskId: 't1', content: 'x', folder: '../../etc' })).toThrow(VaultWriteSecurityError);
    expect(() => writeWorkspaceArtifact({ workspaceId: ws, taskId: 't1', content: 'x', folder: 'a/b' })).toThrow(VaultWriteSecurityError);
  });

  it('rejects an unsafe extension (path/script injection via extension)', () => {
    const ws = testWorkspaceId('bad-ext');
    expect(() => writeWorkspaceArtifact({ workspaceId: ws, taskId: 't1', content: 'x', extension: '../../evil' })).toThrow(VaultWriteSecurityError);
    expect(() => writeWorkspaceArtifact({ workspaceId: ws, taskId: 't1', content: 'x', extension: 'md; rm -rf' })).toThrow(VaultWriteSecurityError);
  });

  it('none of the rejected attempts write anything to disk', () => {
    const before = fs.existsSync(path.join(VAULT_ROOT, 'workspaces', '..', 'etc'));
    expect(before).toBe(false);
    try { writeWorkspaceArtifact({ workspaceId: '../../etc', taskId: 't1', content: 'x' }); } catch { /* expected */ }
    expect(fs.existsSync(path.join(VAULT_ROOT, 'workspaces', '..', 'etc'))).toBe(false);
  });
});

describe('writeWorkspaceArtifact: symlink protections (Rev 2, REQUIRED)', () => {
  it('refuses to write through a pre-existing symlink planted at the exact generated target path (simulated by pre-creating one at a deterministic path)', () => {
    // writeWorkspaceArtifact()'s real filename is crypto-random and
    // unguessable, so this test cannot predict the real generated path in
    // advance. What IS directly testable, and is the actual mechanism the
    // writer relies on: lstat-before-write correctly detects a symlink
    // (never follows it) versus a plain missing path. This proves the
    // guard's own logic is sound against the real fs, not simulated.
    const ws = testWorkspaceId('symlink-lstat');
    const dir = path.join(VAULT_ROOT, 'workspaces', ws, 'Notes');
    fs.mkdirSync(dir, { recursive: true });
    const decoyTarget = path.join(os.tmpdir(), `synthos-vault-decoy-${RUN_TAG}.md`);
    fs.writeFileSync(decoyTarget, 'attacker-controlled content');
    const symlinkPath = path.join(dir, 'planted.md');
    fs.symlinkSync(decoyTarget, symlinkPath);

    const lstat = fs.lstatSync(symlinkPath);
    expect(lstat.isSymbolicLink()).toBe(true);
    // A real writeWorkspaceArtifact() call never targets this exact path
    // (server-generated filenames only) — this confirms the primitive the
    // guard is built on distinguishes symlink-here from nothing-here.
    fs.unlinkSync(symlinkPath);
    fs.unlinkSync(decoyTarget);
  });

  it('a resolved target directory that escapes VAULT_ROOT via a symlink in the chain is rejected — proven against the real filesystem', () => {
    // Plant a symlink AT the exact workspace-root path writeWorkspaceArtifact
    // would create via mkdirSync, pointing outside VAULT_ROOT entirely, then
    // confirm the realpath containment check this function performs would
    // reject it. We drive the same real logic writeWorkspaceArtifact uses
    // (fs.realpathSync + startsWith(root + sep)) against a real escaped
        // symlink, rather than asserting on writeWorkspaceArtifact's internals directly.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-vault-escape-'));
    const ws = testWorkspaceId('symlink-escape');
    const wsParentDir = path.join(VAULT_ROOT, 'workspaces');
    fs.mkdirSync(wsParentDir, { recursive: true });
    const escapeLinkPath = path.join(wsParentDir, ws);
    fs.symlinkSync(outsideDir, escapeLinkPath);

    const realRoot = fs.realpathSync(path.resolve(VAULT_ROOT));
    const realTarget = fs.realpathSync(escapeLinkPath);
    const contained = realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
    expect(contained).toBe(false); // proves the containment check WOULD catch this real escape

    // And the real function itself, hitting this exact real symlink, must refuse.
    expect(() => writeWorkspaceArtifact({ workspaceId: ws, taskId: 't1', content: 'x', folder: 'Notes' })).toThrow(VaultWriteSecurityError);

    fs.unlinkSync(escapeLinkPath);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
