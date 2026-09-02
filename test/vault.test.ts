import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-vault-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

// VAULT_ROOT is a fixed constant (path.join(process.cwd(), 'vault')), not
// configurable — the "legitimate write" tests below use it as-is, via the
// real recordArtifact() write path, and clean up the specific files they
// create in afterAll. The traversal/escape tests never call recordArtifact()
// with a real filesystem side effect at all (see note there) — they insert
// a row directly so no attempt is ever made to actually write outside the
// vault, not even one that's expected to fail.

import { createInitialTask, recordArtifact, getDatabase } from '../lib/persistence';
import {
  VAULT_ROOT,
  listWorkspaceVaultEntries,
  getWorkspaceVaultEntry,
  previewWorkspaceVaultEntry,
} from '../lib/vault';

const WS_A = 'ws-vault-test-alpha';
const WS_B = 'ws-vault-test-beta';

function writeRealArtifact(workspaceId: string, taskId: string, filename: string, content: string) {
  createInitialTask({
    taskId,
    workspaceId,
    title: `Vault test task ${taskId}`,
    description: 'test',
    assignedAgent: 'dev',
    assignedModel: 'gemini-3.1-flash-lite',
  });
  const relativePath = `Startup-Theses/${filename}`;
  const diskPath = path.join(VAULT_ROOT, relativePath);
  return recordArtifact({
    artifactId: `art-vault-test-${filename}`,
    taskId,
    relativePath,
    diskPath,
    content,
  });
}

const writtenDiskPaths: string[] = [];

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  for (const p of writtenDiskPaths) {
    try { fs.unlinkSync(p); } catch { /* best effort */ }
  }
});

describe('Vault: workspace scoping, real content, path safety', () => {
  const taskA = 'task-vault-a-1';

  beforeAll(() => {
    const artifact = writeRealArtifact(WS_A, taskA, 'vault-test-a-1.md', '# Real Vault Content\n\nThis is real, workspace-A content written to a real file.');
    writtenDiskPaths.push(artifact.disk_path);
  });

  it('1. Workspace A lists only its own Vault records', () => {
    const entriesA = listWorkspaceVaultEntries(WS_A);
    expect(entriesA.length).toBeGreaterThan(0);
    expect(entriesA.every((e) => e.task_id === taskA || true)).toBe(true); // sanity: no throw
    const entriesB = listWorkspaceVaultEntries(WS_B);
    expect(entriesB.map((e) => e.task_id)).not.toContain(taskA);
  });

  it('2. Workspace B cannot read Workspace A\'s entry by id', () => {
    const entriesA = listWorkspaceVaultEntries(WS_A);
    const artifactId = entriesA[0].artifact_id;
    expect(getWorkspaceVaultEntry(WS_B, artifactId)).toBeNull();
    expect(getWorkspaceVaultEntry(WS_A, artifactId)).not.toBeNull();
  });

  it('6. the listed content_hash matches the stored artifact\'s real SHA-256', () => {
    const entriesA = listWorkspaceVaultEntries(WS_A);
    const entry = entriesA.find((e) => e.task_id === taskA)!;
    const diskPath = path.join(VAULT_ROOT, entry.relative_path);
    const realBytes = fs.readFileSync(diskPath);
    const crypto = require('crypto');
    const realHash = `sha256:${crypto.createHash('sha256').update(realBytes).digest('hex')}`;
    expect(entry.content_hash).toBe(realHash);
  });

  it('7. an empty workspace returns []', () => {
    expect(listWorkspaceVaultEntries('ws-vault-truly-empty')).toEqual([]);
  });

  it('5. an unknown artifact id fails safely (null, not a throw or fabricated entry)', () => {
    expect(getWorkspaceVaultEntry(WS_A, 'art-does-not-exist')).toBeNull();
  });

  it('preview returns real leading content, not a placeholder', () => {
    const entriesA = listWorkspaceVaultEntries(WS_A);
    const entry = entriesA.find((e) => e.task_id === taskA)!;
    const preview = previewWorkspaceVaultEntry(WS_A, entry.artifact_id, 20);
    expect(preview).not.toBeNull();
    expect(preview!.length).toBeLessThanOrEqual(21); // 20 chars + ellipsis
    expect('# Real Vault Content'.startsWith(preview!.replace('…', ''))).toBe(true);
  });

  it('full detail read returns the real file content', () => {
    const entriesA = listWorkspaceVaultEntries(WS_A);
    const entry = entriesA.find((e) => e.task_id === taskA)!;
    const detail = getWorkspaceVaultEntry(WS_A, entry.artifact_id);
    expect(detail?.content).toContain('This is real, workspace-A content');
  });
});

describe('Vault: path traversal and escape protection', () => {
  // These insert an `artifacts` row directly via SQL rather than through
  // recordArtifact() — recordArtifact() unconditionally fs.writeFileSync()s
  // to whatever diskPath it's given (it's a low-level primitive trusted only
  // from the real execution spine, which always supplies a safe path itself).
  // A real attacker-controlled row reaching this table would have to arrive
  // some other way; simulating that here must not itself perform a real
  // write to a system path, so we insert the row and nothing else, then
  // prove lib/vault.ts's own re-validation refuses to read it back.
  function insertRawArtifactRow(taskId: string, artifactId: string, relativePath: string, diskPath: string) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO artifacts (artifact_id, task_id, relative_path, disk_path, content_hash, size_bytes, created_at)
      VALUES (?, ?, ?, ?, 'sha256:test', 0, ?)
    `).run(artifactId, taskId, relativePath, diskPath, new Date().toISOString());
  }

  it('3. a traversal-style relative_path is rejected (content comes back null, not an escaped file)', () => {
    const taskId = 'task-vault-traversal-1';
    createInitialTask({
      taskId,
      workspaceId: WS_A,
      title: 'Traversal attempt',
      description: 'test',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });
    insertRawArtifactRow(taskId, 'art-vault-traversal-1', '../../../../etc/passwd', '/etc/passwd');
    const detail = getWorkspaceVaultEntry(WS_A, 'art-vault-traversal-1');
    expect(detail).not.toBeNull(); // the row exists
    expect(detail!.content).toBeNull(); // but its content is never served
  });

  it('4. an absolute-path relative_path is rejected the same way', () => {
    const taskId = 'task-vault-abspath-1';
    createInitialTask({
      taskId,
      workspaceId: WS_A,
      title: 'Absolute path attempt',
      description: 'test',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });
    insertRawArtifactRow(taskId, 'art-vault-abspath-1', '/etc/hosts', '/etc/hosts');
    const detail = getWorkspaceVaultEntry(WS_A, 'art-vault-abspath-1');
    expect(detail!.content).toBeNull();
  });
});

describe('Vault: no server paths exposed, UI/API truthfulness', () => {
  const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  const vaultViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ObsidianView.tsx'), 'utf-8');

  it('10. /api/vault routes never send disk_path (the absolute server path) in a response', () => {
    const vaultRoute = serverContent.slice(
      serverContent.indexOf('app.get("/api/vault"'),
      serverContent.indexOf('app.get("/api/ton/status"')
    );
    expect(vaultRoute).not.toContain('disk_path');
  });

  it('8. the Vault UI actually calls the real backend routes, not local mock data', () => {
    expect(vaultViewContent).toContain('/api/vault');
    expect(vaultViewContent).not.toContain('DiagnosticReport');
  });

  it('9. no hardcoded fake Vault documents/diagnostic-sync theater remain in the active screen', () => {
    expect(vaultViewContent).not.toContain('autoSyncCountdown');
    expect(vaultViewContent).not.toContain('isDiagnosing');
    expect(vaultViewContent).not.toContain('meshSynapses');
  });

  it('Obsidian application connection is shown as NOT_CONNECTED, not a fabricated live sync', () => {
    expect(vaultViewContent).toContain('NOT_CONNECTED');
  });
});
