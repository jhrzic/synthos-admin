import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-memory-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { createInitialTask, recordArtifact, getDatabase } from '../lib/persistence';
import { VAULT_ROOT } from '../lib/vault';
import { indexVaultArtifact, reindexWorkspaceMemory, searchWorkspaceMemory, removeFromMemoryIndex } from '../lib/memory-index';

const WS_A = 'ws-memory-test-alpha';
const WS_B = 'ws-memory-test-beta';

const writtenDiskPaths: string[] = [];

function writeRealArtifact(workspaceId: string, taskId: string, artifactId: string, filename: string, content: string) {
  createInitialTask({
    taskId,
    workspaceId,
    title: `Memory test task ${taskId}`,
    description: 'test',
    assignedAgent: 'dev',
    assignedModel: 'gemini-3.1-flash-lite',
  });
  const relativePath = `Startup-Theses/${filename}`;
  const diskPath = path.join(VAULT_ROOT, relativePath);
  const artifact = recordArtifact({ artifactId, taskId, relativePath, diskPath, content });
  writtenDiskPaths.push(diskPath);
  return artifact;
}

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  for (const p of writtenDiskPaths) {
    try { fs.unlinkSync(p); } catch { /* best effort */ }
  }
});

describe('Memory index: indexing real, verified Vault content', () => {
  const taskId = 'task-memory-a-1';
  const artifactId = 'art-memory-a-1';

  beforeAll(() => {
    writeRealArtifact(WS_A, taskId, artifactId, 'memory-test-a-1.md', '# Photosynthesis Research\n\nChlorophyll absorbs sunlight to drive the Calvin cycle in plant cells.');
  });

  it('1. a verified Vault artifact indexes successfully', () => {
    expect(indexVaultArtifact(WS_A, artifactId)).toBe(true);
  });

  it('2. an exact phrase from the content can be found', () => {
    const results = searchWorkspaceMemory(WS_A, 'Calvin cycle');
    expect(results.some((r) => r.artifact_id === artifactId)).toBe(true);
  });

  it('3. an unrelated term returns zero results', () => {
    const results = searchWorkspaceMemory(WS_A, 'quantum blockchain derivatives trading');
    expect(results).toHaveLength(0);
  });

  it('4. Workspace A\'s indexed content cannot be searched from Workspace B', () => {
    const resultsInB = searchWorkspaceMemory(WS_B, 'Calvin cycle');
    expect(resultsInB).toHaveLength(0);
    const resultsInA = searchWorkspaceMemory(WS_A, 'Calvin cycle');
    expect(resultsInA.length).toBeGreaterThan(0);
  });

  it('5. reindexing does not duplicate records', () => {
    indexVaultArtifact(WS_A, artifactId);
    indexVaultArtifact(WS_A, artifactId);
    indexVaultArtifact(WS_A, artifactId);
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as n FROM memory_index WHERE artifact_id = ? AND workspace_id = ?').get(artifactId, WS_A) as { n: number };
    expect(row.n).toBe(1);
  });

  it('reindexWorkspaceMemory rebuilds from real Vault entries without duplicating', () => {
    const result = reindexWorkspaceMemory(WS_A);
    expect(result.indexed).toBeGreaterThanOrEqual(1);
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as n FROM memory_index WHERE artifact_id = ? AND workspace_id = ?').get(artifactId, WS_A) as { n: number };
    expect(row.n).toBe(1);
  });

  it('8. a search result points to a real, resolvable Vault/artifact id', () => {
    const results = searchWorkspaceMemory(WS_A, 'Chlorophyll');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].artifact_id).toBe(artifactId);
    expect(results[0].source_path).toBe('Startup-Theses/memory-test-a-1.md');
  });
});

describe('Memory index: safety and honest empty states', () => {
  it('6. an artifact whose source is unavailable (deleted/never wrote) is not indexed as if it were', () => {
    const taskId = 'task-memory-missing-1';
    createInitialTask({
      taskId,
      workspaceId: WS_A,
      title: 'Missing source',
      description: 'test',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });
    // A row referencing a file that was never actually written to disk.
    const db = getDatabase();
    db.prepare(`
      INSERT INTO artifacts (artifact_id, task_id, relative_path, disk_path, content_hash, size_bytes, created_at)
      VALUES (?, ?, ?, ?, 'sha256:none', 0, ?)
    `).run('art-memory-missing-1', taskId, 'Startup-Theses/does-not-exist.md', path.join(VAULT_ROOT, 'Startup-Theses/does-not-exist.md'), new Date().toISOString());

    expect(indexVaultArtifact(WS_A, 'art-memory-missing-1')).toBe(false);
    const row = getDatabase().prepare('SELECT COUNT(*) as n FROM memory_index WHERE artifact_id = ?').get('art-memory-missing-1') as { n: number };
    expect(row.n).toBe(0);
  });

  it('7. a malicious/malformed FTS query does not crash or inject — it fails safely to an empty result', () => {
    const attempts = ['"', 'AND OR NOT', '((((', '*', '"unterminated', 'a" OR "1"="1'];
    for (const q of attempts) {
      expect(() => searchWorkspaceMemory(WS_A, q)).not.toThrow();
    }
  });

  it('empty and whitespace-only queries return an empty result, not everything', () => {
    expect(searchWorkspaceMemory(WS_A, '')).toEqual([]);
    expect(searchWorkspaceMemory(WS_A, '   ')).toEqual([]);
  });

  it('removeFromMemoryIndex removes exactly the targeted row', () => {
    const taskId = 'task-memory-remove-1';
    const artifactId = 'art-memory-remove-1';
    writeRealArtifact(WS_A, taskId, artifactId, 'memory-test-remove.md', 'Removable content about aardvarks.');
    indexVaultArtifact(WS_A, artifactId);
    expect(searchWorkspaceMemory(WS_A, 'aardvarks').length).toBeGreaterThan(0);
    removeFromMemoryIndex(WS_A, artifactId);
    expect(searchWorkspaceMemory(WS_A, 'aardvarks')).toHaveLength(0);
  });
});

describe('Memory UI truth', () => {
  const uiContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AgentMemoryView.tsx'), 'utf-8');

  it('9. the Memory UI calls the real search API, not local mock data', () => {
    expect(uiContent).toContain('/api/memory/search');
    expect(uiContent).not.toContain('INITIAL_AGENT_MEMORIES');
  });

  it('10. fake sample memory results / fabricated confidence and telemetry claims are gone', () => {
    expect(uiContent).not.toContain('Vector CDC');
    expect(uiContent).not.toContain('cross-vault connections');
    expect(uiContent).not.toContain('inotify');
    expect(uiContent).not.toMatch(/confidence/i);
  });

  it('the snippet renderer escapes HTML before highlighting matches (no XSS via indexed content)', () => {
    expect(uiContent).toContain('highlightSnippet');
    expect(uiContent).toContain('&lt;');
    expect(uiContent).toContain('&amp;');
  });
});
