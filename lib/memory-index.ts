// ---------------------------------------------------------------------------
// SYNTHOS — local memory index.
//
// A SQLite FTS5 full-text index over real Vault content (see lib/vault.ts).
// No vector infrastructure, no external search service, no new database
// engine — this is the same SQLite database everything else in this repo
// already uses. Schema lives in lib/persistence.ts (the `memory_index`
// virtual table); this module is the read/write service over it.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { recordActivityEvent, getDatabase } from './persistence';
import { getWorkspaceVaultEntry, listWorkspaceVaultEntries } from './vault';

// ---------------------------------------------------------------------------
// ARTIFACT PURPOSE AND RETRIEVAL POLICY.
//
// Integrity verification decides whether an artifact is TRUE evidence; it
// must not also decide whether operational test output shows up when someone
// searches their workspace. So every artifact has a PURPOSE, and the purpose
// sets its RETRIEVAL POLICY:
//
//   PRODUCTION_WORK         ORDINARY    in the memory index (ordinary search)
//   ACCEPTANCE_EVIDENCE     AUDIT_ONLY  preserved, hash-verifiable, receipt-
//   QUALIFICATION_EVIDENCE  AUDIT_ONLY  addressable — found only by an
//   TEST_FIXTURE            AUDIT_ONLY  explicit, authorized evidence search
//
// Append-only: a classification is a row in artifact_purpose_events; the
// latest one for an artifact is its purpose. The artifact row, its file and
// hash, its review, receipt, ledger row and earlier events are never
// rewritten. Only the DERIVED memory index follows the policy.
//
// BACKWARD COMPATIBILITY: an artifact with no purpose event is
// PRODUCTION_WORK / ORDINARY — exactly how every artifact behaved before this
// existed, so no existing work silently disappears from search.
//
// KNOWLEDGE is separate: admission to canonical knowledge is decided by KIL
// alone. A purpose never promotes anything; ORDINARY retrieval is not
// knowledge, and verification is not knowledge.
// ---------------------------------------------------------------------------

export const ARTIFACT_PURPOSES = ['PRODUCTION_WORK', 'ACCEPTANCE_EVIDENCE', 'QUALIFICATION_EVIDENCE', 'TEST_FIXTURE'] as const;
export type ArtifactPurpose = (typeof ARTIFACT_PURPOSES)[number];
export type RetrievalPolicy = 'ORDINARY' | 'AUDIT_ONLY';

export function retrievalPolicyFor(purpose: ArtifactPurpose): RetrievalPolicy {
  return purpose === 'PRODUCTION_WORK' ? 'ORDINARY' : 'AUDIT_ONLY';
}

export function isArtifactPurpose(v: unknown): v is ArtifactPurpose {
  return typeof v === 'string' && (ARTIFACT_PURPOSES as readonly string[]).includes(v);
}

function ensurePurposeTable(): void {
  getDatabase().exec(`CREATE TABLE IF NOT EXISTS artifact_purpose_events (
    event_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    purpose TEXT NOT NULL, retrieval_policy TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_artifact_purpose_events_artifact ON artifact_purpose_events (artifact_id, created_at);`);
}

export interface ArtifactPurposeView {
  artifactId: string;
  purpose: ArtifactPurpose;
  retrievalPolicy: RetrievalPolicy;
  source: 'EVENT' | 'DEFAULT';
  eventId: string | null;
  reason: string | null;
  classifiedAt: string | null;
}

export function currentArtifactPurpose(artifactId: string): ArtifactPurposeView {
  ensurePurposeTable();
  const r = getDatabase().prepare('SELECT * FROM artifact_purpose_events WHERE artifact_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(artifactId) as any;
  if (!r) return { artifactId, purpose: 'PRODUCTION_WORK', retrievalPolicy: 'ORDINARY', source: 'DEFAULT', eventId: null, reason: null, classifiedAt: null };
  return { artifactId, purpose: r.purpose, retrievalPolicy: r.retrieval_policy, source: 'EVENT', eventId: r.event_id, reason: r.reason, classifiedAt: r.created_at };
}

export function artifactPurposeHistory(artifactId: string): Array<{ eventId: string; purpose: string; retrievalPolicy: string; reason: string; actor: string; createdAt: string }> {
  ensurePurposeTable();
  return (getDatabase().prepare('SELECT * FROM artifact_purpose_events WHERE artifact_id = ? ORDER BY created_at, rowid').all(artifactId) as any[])
    .map((r) => ({ eventId: r.event_id, purpose: r.purpose, retrievalPolicy: r.retrieval_policy, reason: r.reason, actor: r.actor, createdAt: r.created_at }));
}

/**
 * Classify an artifact (append-only). The memory index follows: AUDIT_ONLY
 * removes it from ordinary retrieval; ORDINARY re-admits it only if ACTIVE.
 * Idempotent: classifying to the current purpose appends nothing.
 */
export function classifyArtifactPurpose(p: { workspaceId: string; artifactId: string; purpose: ArtifactPurpose; reason: string; actor: string }): { ok: true; changed: boolean; view: ArtifactPurposeView } | { ok: false; error: string } {
  if (!isArtifactPurpose(p.purpose)) return { ok: false, error: `purpose must be one of ${ARTIFACT_PURPOSES.join(', ')}` };
  if (!p.reason || p.reason.trim().length < 3) return { ok: false, error: 'a classification must state its reason' };
  const db = getDatabase();
  const row = db.prepare('SELECT a.artifact_id, a.task_id FROM artifacts a JOIN tasks t ON t.task_id = a.task_id WHERE a.artifact_id = ? AND t.workspace_id = ?').get(p.artifactId, p.workspaceId) as any;
  if (!row) return { ok: false, error: `artifact ${p.artifactId} does not exist in workspace ${p.workspaceId}` };
  const cur = currentArtifactPurpose(p.artifactId);
  if (cur.source === 'EVENT' && cur.purpose === p.purpose) return { ok: true, changed: false, view: cur };
  const policy = retrievalPolicyFor(p.purpose);
  const eventId = `apx-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare('INSERT INTO artifact_purpose_events (event_id, artifact_id, workspace_id, purpose, retrieval_policy, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(eventId, p.artifactId, p.workspaceId, p.purpose, policy, p.reason.slice(0, 1000), p.actor, new Date().toISOString());
  if (policy === 'AUDIT_ONLY') db.prepare('DELETE FROM memory_index WHERE artifact_id = ? AND workspace_id = ?').run(p.artifactId, p.workspaceId);
  else indexVaultArtifact(p.workspaceId, p.artifactId);
  try {
    recordActivityEvent({ taskId: row.task_id, expectedWorkspaceId: p.workspaceId, eventType: 'ARTIFACT_PURPOSE_CLASSIFIED', agentId: p.actor, payload: { artifactId: p.artifactId, from: cur.purpose, to: p.purpose, retrievalPolicy: policy, reason: p.reason, eventId } });
  } catch { /* the classification stands even if the event cannot be written */ }
  return { ok: true, changed: true, view: currentArtifactPurpose(p.artifactId) };
}

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
  // Only ACTIVE artifacts may enter searchable memory. A QUARANTINED artifact
  // (failed or incomplete output) stays on disk and in the artifacts table as
  // evidence, but no index path — including reindexWorkspaceMemory — can
  // bring it back into retrieval.
  const status = db.prepare('SELECT retrieval_status FROM artifacts WHERE artifact_id = ?').get(artifactId) as { retrieval_status?: string } | undefined;
  if (status && status.retrieval_status && status.retrieval_status !== 'ACTIVE') {
    db.prepare(`DELETE FROM memory_index WHERE artifact_id = ? AND workspace_id = ?`).run(artifactId, workspaceId);
    return false;
  }
  // Only ORDINARY artifacts (production work) enter ordinary retrieval. The
  // same gate runs on every rebuild, so a rebuild cannot restore evidence.
  if (currentArtifactPurpose(artifactId).retrievalPolicy !== 'ORDINARY') {
    db.prepare(`DELETE FROM memory_index WHERE artifact_id = ? AND workspace_id = ?`).run(artifactId, workspaceId);
    return false;
  }
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
 * Full indexed content for a workspace's documents, for corpus-level
 * statistics rather than display.
 *
 * listWorkspaceMemory returns a 240-character prefix, which is right for a
 * browse list and wrong for counting document frequency — a term appearing only
 * later in a document would be missed, and the count would be systematically
 * biased toward whatever each document opens with. Bounded the same way, and
 * deliberately separate so no display path accidentally pulls whole documents.
 */
/**
 * A cheap fingerprint of a workspace's corpus: how many documents, and when the
 * newest was updated.
 *
 * Exists because computing it from listWorkspaceMemoryContent() meant loading
 * every document's full text out of SQLite on every call — including the calls
 * that were about to hit a warm cache and throw the content away. Under ten
 * concurrent conversation turns that was enough to time out a 20s test. Two
 * aggregates answer "has anything changed?" without reading a single document.
 */
export function workspaceCorpusFingerprint(workspaceId: string, pathPrefix?: string): string {
  const db = getDatabase();
  const row = (pathPrefix
    ? db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS newest
        FROM memory_index WHERE workspace_id = ? AND source_path LIKE ?
      `).get(workspaceId, `%${pathPrefix}%`)
    : db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS newest
        FROM memory_index WHERE workspace_id = ?
      `).get(workspaceId)) as { n: number; newest: string };
  return `${row.n}:${row.newest}`;
}

export function listWorkspaceMemoryContent(
  workspaceId: string,
  pathPrefix?: string,
  limit = 200,
): Array<{ artifact_id: string; title: string; content: string; source_path: string; updated_at: string }> {
  const db = getDatabase();
  const bounded = Math.min(Math.max(limit, 1), 200);
  const rows = pathPrefix
    ? db.prepare(`
        SELECT artifact_id, title, content, source_path, updated_at
        FROM memory_index
        WHERE workspace_id = ? AND source_path LIKE ?
        ORDER BY updated_at DESC LIMIT ?
      `)
        // Contains-match, identical to searchWorkspaceMemoryScoped. A real path
        // is `workspaces/<id>/Business-Knowledge/<file>.md`, so an anchored
        // prefix match finds nothing — which is exactly the bug this comment
        // exists to stop someone reintroducing while "tidying up" the LIKE.
        .all(workspaceId, `%${pathPrefix}%`, bounded)
    : db.prepare(`
        SELECT artifact_id, title, content, source_path, updated_at
        FROM memory_index
        WHERE workspace_id = ?
        ORDER BY updated_at DESC LIMIT ?
      `).all(workspaceId, bounded);
  return rows as any;
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


/**
 * Take an artifact out of active retrieval without destroying it.
 *
 * The file, its content hash, its artifact row, receipts, reviews and events
 * are all left exactly as they are — the evidence of what happened is
 * preserved. The artifact is marked QUARANTINED with the reason, removed from
 * the searchable index, and the decision is appended to the task's activity
 * trail. Idempotent.
 */
export function quarantineArtifact(params: { workspaceId: string; artifactId: string; reason: string; actor: string }): { quarantined: boolean; alreadyQuarantined: boolean } {
  const db = getDatabase();
  const row = db.prepare('SELECT artifact_id, task_id, retrieval_status FROM artifacts WHERE artifact_id = ?').get(params.artifactId) as { artifact_id: string; task_id: string; retrieval_status: string } | undefined;
  if (!row) return { quarantined: false, alreadyQuarantined: false };
  const already = row.retrieval_status === 'QUARANTINED';
  const now = new Date().toISOString();
  if (!already) {
    db.prepare(`UPDATE artifacts SET retrieval_status = 'QUARANTINED', retrieval_status_reason = ?, retrieval_status_at = ? WHERE artifact_id = ?`)
      .run(params.reason.slice(0, 1000), now, params.artifactId);
  }
  db.prepare(`DELETE FROM memory_index WHERE artifact_id = ? AND workspace_id = ?`).run(params.artifactId, params.workspaceId);
  if (!already) {
    try {
      recordActivityEvent({
        taskId: row.task_id, expectedWorkspaceId: params.workspaceId, eventType: 'ARTIFACT_QUARANTINED', agentId: params.actor,
        payload: { artifactId: params.artifactId, reason: params.reason, removedFromMemoryIndex: true, evidencePreserved: true },
      });
    } catch { /* the quarantine itself stands even if the event cannot be written */ }
  }
  return { quarantined: !already, alreadyQuarantined: already };
}

export function getArtifactRetrievalStatus(artifactId: string): { status: string; reason: string | null; at: string | null } | null {
  const row = getDatabase().prepare('SELECT retrieval_status, retrieval_status_reason, retrieval_status_at FROM artifacts WHERE artifact_id = ?').get(artifactId) as any;
  return row ? { status: row.retrieval_status, reason: row.retrieval_status_reason ?? null, at: row.retrieval_status_at ?? null } : null;
}


/**
 * AUTHORIZED EVIDENCE SEARCH — explicit, never part of ordinary retrieval.
 * Reads the evidence artifacts themselves (not the memory index), re-checks
 * each file against its recorded hash, and says which purpose and retrieval
 * state it has. Callers must gate it on workspace-admin / platform-admin.
 */
export interface EvidenceSearchResult {
  artifactId: string;
  taskId: string;
  title: string;
  purpose: ArtifactPurpose;
  retrievalPolicy: RetrievalPolicy;
  retrievalStatus: string | null;
  contentHash: string;
  hashVerifies: boolean | null;
  relativePath: string;
  createdAt: string;
  snippet: string;
}

export function searchEvidenceArtifacts(workspaceId: string, query: string, opts: { purposes?: ArtifactPurpose[]; includeQuarantined?: boolean; limit?: number } = {}): EvidenceSearchResult[] {
  ensurePurposeTable();
  const purposes = new Set(opts.purposes?.length ? opts.purposes : ARTIFACT_PURPOSES.filter((x) => x !== 'PRODUCTION_WORK'));
  const tokens = ((query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const out: EvidenceSearchResult[] = [];
  const rows = getDatabase().prepare(`SELECT a.artifact_id FROM artifacts a JOIN tasks t ON t.task_id = a.task_id WHERE t.workspace_id = ? ORDER BY a.created_at DESC LIMIT 2000`).all(workspaceId) as any[];
  for (const { artifact_id } of rows) {
    if (out.length >= limit) break;
    const view = currentArtifactPurpose(artifact_id);
    const entry = getWorkspaceVaultEntry(workspaceId, artifact_id);
    if (!entry) continue;
    const quarantined = entry.retrieval_status === 'QUARANTINED';
    if (!purposes.has(view.purpose) && !(opts.includeQuarantined && quarantined)) continue;
    if (quarantined && !opts.includeQuarantined) continue;
    const text = entry.content ?? '';
    const hay = `${entry.title}\n${text}`.toLowerCase();
    if (tokens.length && !tokens.every((t) => hay.includes(t))) continue;
    const hashVerifies = entry.content === null ? null : `sha256:${crypto.createHash('sha256').update(entry.content, 'utf8').digest('hex')}` === entry.content_hash;
    out.push({
      artifactId: artifact_id, taskId: entry.task_id, title: entry.title, purpose: view.purpose, retrievalPolicy: view.retrievalPolicy,
      retrievalStatus: entry.retrieval_status, contentHash: entry.content_hash, hashVerifies, relativePath: entry.relative_path, createdAt: entry.created_at,
      snippet: text.replace(/\s+/g, ' ').slice(0, 240),
    });
  }
  return out;
}
