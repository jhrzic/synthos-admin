// ---------------------------------------------------------------------------
// SYNTHOS — local memory index.
//
// A SQLite FTS5 full-text index over real Vault content (see lib/vault.ts).
// No vector infrastructure, no external search service, no new database
// engine — this is the same SQLite database everything else in this repo
// already uses. Schema lives in lib/persistence.ts (the `memory_index`
// virtual table); this module is the read/write service over it.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';
import { getWorkspaceVaultEntry, listWorkspaceVaultEntries } from './vault';

export interface MemorySearchResult {
  artifact_id: string;
  workspace_id: string;
  title: string;
  snippet: string;
  source_path: string;
  updated_at: string;
}

/**
 * Index one real, verified Vault artifact. Deletes any existing row for the
 * same artifact_id first, so re-indexing the same artifact is a no-op, not a
 * duplicate. Returns false (and indexes nothing) if the artifact doesn't
 * exist in this workspace or its content can't be read — never indexes a
 * placeholder in its place.
 */
export function indexVaultArtifact(workspaceId: string, artifactId: string): boolean {
  const entry = getWorkspaceVaultEntry(workspaceId, artifactId);
  if (!entry || entry.content === null) return false;

  const db = getDatabase();
  db.prepare(`DELETE FROM memory_index WHERE artifact_id = ? AND workspace_id = ?`).run(artifactId, workspaceId);
  db.prepare(`
    INSERT INTO memory_index (workspace_id, artifact_id, title, content, source_path, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspaceId, artifactId, entry.title, entry.content, entry.relative_path, entry.created_at);
  return true;
}

/**
 * Bounded rebuild over a workspace's real Vault artifacts (capped at 500 by
 * listWorkspaceVaultEntries — never an unbounded or arbitrary-directory
 * scan). Safe to call repeatedly: each artifact is deleted-then-reinserted,
 * so re-running never accumulates duplicates.
 */
export function reindexWorkspaceMemory(workspaceId: string): { indexed: number; skipped: number } {
  const entries = listWorkspaceVaultEntries(workspaceId, 500);
  let indexed = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (indexVaultArtifact(workspaceId, entry.artifact_id)) indexed++;
    else skipped++;
  }
  return { indexed, skipped };
}

export function removeFromMemoryIndex(workspaceId: string, artifactId: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM memory_index WHERE artifact_id = ? AND workspace_id = ?`).run(artifactId, workspaceId);
}

/**
 * Workspace-scoped full-text search. An empty/whitespace-only query returns
 * an empty result (not "everything", and not an error). User input is never
 * passed to MATCH as raw FTS5 query syntax — it's tokenized into plain
 * words and each is quoted, so punctuation, unbalanced quotes, or FTS5
 * operator keywords (AND, OR, NOT) or wildcard characters in the input can
 * never throw a query-syntax error or be interpreted as anything but a
 * literal phrase search.
 */
export function searchWorkspaceMemory(workspaceId: string, query: string, limit = 20): MemorySearchResult[] {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const tokens = trimmed.match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length === 0) return [];
  const matchExpr = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');

  const db = getDatabase();
  try {
    const rows = db.prepare(`
      SELECT artifact_id, workspace_id, title, source_path, updated_at,
             snippet(memory_index, 3, '[', ']', '…', 12) AS snip
      FROM memory_index
      WHERE workspace_id = ? AND memory_index MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(workspaceId, matchExpr, Math.min(Math.max(limit, 1), 100)) as Array<{
      artifact_id: string; workspace_id: string; title: string; source_path: string; updated_at: string; snip: string;
    }>;
    return rows.map((r) => ({
      artifact_id: r.artifact_id,
      workspace_id: r.workspace_id,
      title: r.title,
      snippet: r.snip,
      source_path: r.source_path,
      updated_at: r.updated_at,
    }));
  } catch {
    // A malformed MATCH expression (shouldn't happen given the quoting
    // above, but FTS5 has edge cases) fails safely to an empty result
    // rather than crashing the caller or leaking a syntax error.
    return [];
  }
}
