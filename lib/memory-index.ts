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
/**
 * Browse the indexed corpus with no search term.
 *
 * searchWorkspaceMemory() deliberately returns [] for an empty query (FTS5
 * MATCH has nothing to match on), which is correct for SEARCH but makes a
 * document-list UI claim "no indexed memory" when the index is in fact
 * populated. This is a plain ordered read of the same memory_index rows —
 * same table, same workspace scoping, no FTS5 involved — so the list panel
 * can show what is really there before anyone types.
 */
export function listWorkspaceMemory(workspaceId: string, limit = 50): MemorySearchResult[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT artifact_id, workspace_id, title, source_path, updated_at,
           substr(content, 1, 240) AS snip
    FROM memory_index
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(workspaceId, Math.min(Math.max(limit, 1), 200)) as Array<{
    artifact_id: string; workspace_id: string; title: string; source_path: string; updated_at: string; snip: string;
  }>;
  return rows.map((r) => ({
    artifact_id: r.artifact_id,
    workspace_id: r.workspace_id,
    title: r.title,
    // No FTS5 markers in a browse result — nothing was matched, so nothing
    // is highlighted. The snippet is a plain content prefix.
    snippet: r.snip || '',
    source_path: r.source_path,
    updated_at: r.updated_at,
  }));
}

/**
 * Function words that would otherwise match nearly every document.
 *
 * Deliberately tiny and limited to true grammatical filler. Content words are
 * NEVER dropped — "review", "change", "current" and the like carry real
 * meaning and belong in the match.
 */
const MATCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is', 'it', 'its',
  'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there', 'these', 'this',
  'those', 'to', 'was', 'were', 'will', 'with',
]);

/**
 * Build the FTS5 MATCH expression for a free-text query.
 *
 * THE DEFECT THIS FIXES (found live, 2026-09-14). Terms separated by spaces
 * are ANDed by FTS5, so the previous expression required a document to
 * contain EVERY word of the query. That is fine for a two-word lookup and
 * useless for a sentence: a real question like "Extend the Kepler Retrieval
 * Marker heartbeat — review whether the interval should change" returned
 * nothing, even though the indexed document was about exactly that, because
 * it did not also contain "Extend" and "whether".
 *
 * It surfaced as the development loop retrieving zero Brain context for
 * every task, since that caller searches with a whole title plus instruction.
 * The index was correct throughout; the query was wrong.
 *
 * OR is the right semantics here because relevance is already handled:
 * results are ordered by bm25, whose IDF term naturally sinks documents that
 * matched only a common word. Stopwords are still removed so such a document
 * is not retrieved at all, which keeps an unrelated query returning nothing
 * rather than everything.
 */
export function buildMemoryMatchExpression(query: string): string | null {
  const tokens = (query || '').match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length === 0) return null;

  const significant = tokens.filter((t) => t.length > 1 && !MATCH_STOPWORDS.has(t.toLowerCase()));
  // A query made entirely of stopwords still searches for what it actually
  // said, rather than silently becoming an empty search.
  const chosen = significant.length > 0 ? significant : tokens;

  const unique = chosen.filter((t, i, a) => a.indexOf(t) === i);
  return unique.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

export function searchWorkspaceMemory(workspaceId: string, query: string, limit = 20): MemorySearchResult[] {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const matchExpr = buildMemoryMatchExpression(trimmed);
  if (!matchExpr) return [];

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

/**
 * Search a NAMED SUBSET of a workspace's indexed material, returning the full
 * document content and the bm25 rank alongside the usual fields.
 *
 * Added for the customer-facing conversation assistant, and the reason is a
 * real defect found by running it against a live workspace: an assistant that
 * searched the whole index answered a visitor's question by quoting an
 * internal graph-run log, a Jarvis directive and a workspace file path. Every
 * one of those documents was real — and none of them were things a business
 * would ever say to a customer.
 *
 * So the customer-facing surface searches only what the business has
 * explicitly designated as its published knowledge (a path prefix), and gets
 * the rank back so it can refuse a weak match instead of presenting it.
 *
 * searchWorkspaceMemory() above is deliberately left exactly as it was — it is
 * the operator-facing search, where searching everything is correct.
 */
export interface ScopedMemoryResult extends MemorySearchResult {
  /** FTS5 bm25 rank. More negative is a better match. */
  rank: number;
  /** Full indexed document text, so a caller can quote a whole paragraph rather than an FTS5 shard. */
  content: string;
}

export function searchWorkspaceMemoryScoped(
  workspaceId: string,
  query: string,
  opts: { pathPrefix?: string; limit?: number } = {}
): ScopedMemoryResult[] {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];
  const tokens = trimmed.match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length === 0) return [];
  // OR the terms: a visitor's question rarely contains every term of the
  // answer, and an implicit AND makes a well-stocked knowledge base look empty.
  const matchExpr = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50);

  const db = getDatabase();
  try {
    const like = opts.pathPrefix ? `%${opts.pathPrefix}%` : null;
    const sql = `
      SELECT artifact_id, workspace_id, title, source_path, updated_at, content, rank AS bm25
      FROM memory_index
      WHERE workspace_id = ? AND memory_index MATCH ?
      ${like ? 'AND source_path LIKE ?' : ''}
      ORDER BY rank
      LIMIT ?
    `;
    const args: unknown[] = like ? [workspaceId, matchExpr, like, limit] : [workspaceId, matchExpr, limit];
    const rows = db.prepare(sql).all(...(args as any[])) as Array<{
      artifact_id: string; workspace_id: string; title: string; source_path: string;
      updated_at: string; content: string; bm25: number;
    }>;
    return rows.map((r) => ({
      artifact_id: r.artifact_id, workspace_id: r.workspace_id, title: r.title,
      snippet: '', source_path: r.source_path, updated_at: r.updated_at,
      rank: Number(r.bm25), content: r.content,
    }));
  } catch {
    return [];
  }
}
