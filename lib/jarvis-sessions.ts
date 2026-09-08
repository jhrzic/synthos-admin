// ---------------------------------------------------------------------------
// SYNTHOS — real, user-owned, workspace-scoped Jarvis conversation history.
//
// Jarvis (JarvisView / GlobalVoiceOverlay) previously held its transcript
// only in React state — reload the page and it was gone, and there was no
// concept of a session to resume. This module is the real persisted store
// behind it: SQLite (no new engine).
//
// Pass III / J1: a session belongs to the user who started it, not to
// "anyone in the workspace." User A cannot resume User B's session just
// because both are members of the same workspace — every read/append here
// checks both workspace scope AND real session ownership.
//
// Only the same visible text already shown on screen is ever stored — no
// hidden model chain-of-thought, no secrets.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from './persistence';

export interface JarvisSessionRecord {
  session_id: string;
  workspace_id: string;
  user_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface JarvisSessionWithStats extends JarvisSessionRecord {
  messageCount: number;
  lastMessagePreview: string | null;
}

export type JarvisMessageRole = 'user' | 'assistant';
export type JarvisMessageType = 'text' | 'voice_transcript' | 'admin_command';

export interface JarvisMessageRecord {
  message_id: string;
  session_id: string;
  workspace_id: string;
  role: JarvisMessageRole;
  content: string;
  message_type: JarvisMessageType;
  provider: string | null;
  model: string | null;
  created_at: string;
}

function deriveTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

export function createJarvisSession(workspaceId: string, userId: string, title?: string): JarvisSessionRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const sessionId = `jsess-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare(`
    INSERT INTO jarvis_sessions (session_id, workspace_id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, workspaceId, userId, title || null, now, now);
  return { session_id: sessionId, workspace_id: workspaceId, user_id: userId, title: title || null, created_at: now, updated_at: now };
}

interface SessionRow {
  session_id: string;
  workspace_id: string;
  user_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

function statsFor(session: SessionRow): JarvisSessionWithStats {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) AS total FROM jarvis_messages WHERE session_id = ? AND workspace_id = ?
  `).get(session.session_id, session.workspace_id) as { total: number };
  // Pass VIII / Workstream R — created_at is a millisecond-resolution
  // ISO string; two messages appended in quick succession (the common case
  // — a user message immediately followed by a reply) can legitimately
  // share the same value, and ORDER BY on a tied column has no guaranteed
  // secondary order in SQLite. `rowid` is the table's real, implicit,
  // strictly-monotonic-per-insert column (this table has no INTEGER
  // PRIMARY KEY aliasing it away) — a correct, free tiebreaker for "most
  // recently inserted," not a fabricated ordering guess.
  const last = db.prepare(`
    SELECT content FROM jarvis_messages WHERE session_id = ? AND workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(session.session_id, session.workspace_id) as { content: string } | undefined;

  return {
    session_id: session.session_id,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    title: session.title,
    created_at: session.created_at,
    updated_at: session.updated_at,
    messageCount: row?.total || 0,
    lastMessagePreview: last ? (last.content.length > 120 ? `${last.content.slice(0, 120)}…` : last.content) : null,
  };
}

/** Only the real, current user's own sessions in this workspace — never another member's. */
export function listUserJarvisSessions(workspaceId: string, userId: string, limit = 50): JarvisSessionWithStats[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM jarvis_sessions WHERE workspace_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT ?
  `).all(workspaceId, userId, Math.min(Math.max(limit, 1), 200)) as SessionRow[];
  return rows.map(statsFor);
}

/**
 * Returns null (never someone else's session) unless the session is real,
 * in this workspace, AND owned by this exact user — a legacy pre-auth
 * session (user_id NULL) is owned by no one and is never resumable.
 */
export function getOwnedJarvisSession(workspaceId: string, userId: string, sessionId: string): JarvisSessionWithStats | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM jarvis_sessions WHERE workspace_id = ? AND session_id = ? AND user_id = ?
  `).get(workspaceId, sessionId, userId) as SessionRow | undefined;
  if (!row) return null;
  return statsFor(row);
}

/**
 * Real messages for a session, oldest first. Returns null (never an empty
 * array) when the session doesn't exist, isn't in this workspace, or isn't
 * owned by this user — same non-disclosure pattern used everywhere else in
 * this codebase: unknown id, wrong workspace, and wrong owner are all
 * indistinguishable to the caller.
 */
export function listSessionMessages(workspaceId: string, userId: string, sessionId: string): JarvisMessageRecord[] | null {
  const session = getOwnedJarvisSession(workspaceId, userId, sessionId);
  if (!session) return null;
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM jarvis_messages WHERE workspace_id = ? AND session_id = ? ORDER BY created_at ASC
  `).all(workspaceId, sessionId) as JarvisMessageRecord[];
}

/**
 * Appends one real message to a session. Returns null if the session isn't
 * real, in this workspace, and owned by this user (never silently creates
 * one, never appends to someone else's conversation). The session's title
 * is derived from the first user message if it doesn't have one yet —
 * never fabricated, never a generic placeholder like "New Chat N".
 */
export function appendJarvisMessage(params: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  role: JarvisMessageRole;
  content: string;
  messageType?: JarvisMessageType;
  provider?: string | null;
  model?: string | null;
  /** Test-only override — production call sites never pass this (see the same pattern in lib/persistence.ts's recordArtifact/recordActivityEvent). */
  createdAt?: string;
}): JarvisMessageRecord | null {
  const session = getOwnedJarvisSession(params.workspaceId, params.userId, params.sessionId);
  if (!session) return null;

  const db = getDatabase();
  const now = params.createdAt || new Date().toISOString();
  const messageId = `jmsg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  db.prepare(`
    INSERT INTO jarvis_messages (message_id, session_id, workspace_id, role, content, message_type, provider, model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId,
    params.sessionId,
    params.workspaceId,
    params.role,
    params.content,
    params.messageType || 'text',
    params.provider || null,
    params.model || null,
    now
  );

  db.prepare(`UPDATE jarvis_sessions SET updated_at = ? WHERE session_id = ? AND workspace_id = ?`)
    .run(now, params.sessionId, params.workspaceId);

  if (!session.title && params.role === 'user') {
    db.prepare(`UPDATE jarvis_sessions SET title = ? WHERE session_id = ? AND workspace_id = ?`)
      .run(deriveTitle(params.content), params.sessionId, params.workspaceId);
  }

  return {
    message_id: messageId,
    session_id: params.sessionId,
    workspace_id: params.workspaceId,
    role: params.role,
    content: params.content,
    message_type: params.messageType || 'text',
    provider: params.provider || null,
    model: params.model || null,
    created_at: now,
  };
}

// ---------------------------------------------------------------------------
// Bounded conversation context for reasoning (Jarvis memory-retrieval task).
//
// listSessionMessages() above already existed as a real, workspace+user-
// scoped, chronological retrieval primitive — /api/jarvis/command simply
// never called it before this. This file adds no new storage and no new
// authority model: selectBoundedContext() is a pure, DB-free function over
// whatever listSessionMessages() already returned, so it's fully testable
// with plain arrays and carries zero risk of its own isolation bugs (all
// isolation is enforced once, in getOwnedJarvisSession(), before this ever
// runs).
//
// No embeddings/semantic search — none exists anywhere in this codebase to
// reuse, and building one is out of scope for a first version. This is
// bounded *recent* history: newest turns preferred, oldest dropped first
// when either bound is exceeded.
// ---------------------------------------------------------------------------

/** Maximum prior turns considered, before the character budget is applied. */
export const MAX_PRIOR_TURNS = 10;

/** Maximum total characters across all included prior turns. Reserves room
 *  for the system instruction and the current user message, which are
 *  never counted against this budget. */
export const MAX_CONTEXT_CHARS = 6000;

/**
 * True only for an assistant message that is nothing but the honest
 * runtime/provider-failure marker src/App.tsx writes on a DEGRADED command
 * (e.g. "[STATUS: DEGRADED - JARVIS_COMMAND_UNAVAILABLE]\n<error>") — never
 * for a real reply that happens to mention the word "degraded" in passing.
 * The visible transcript keeps these messages (truthful failure history the
 * user should see); this only decides what re-enters the model's own
 * reasoning context, where a stale "the model was unreachable" turn adds
 * noise and no signal for the next request.
 *
 * Deliberately a prefix match, not a substring search: every producer of
 * this marker (src/App.tsx's four DEGRADED branches) puts it at the very
 * start of the message with nothing else ahead of it. A substantive reply
 * that happened to discuss degraded systems would not start with the
 * literal marker and so would never match.
 */
export function isRuntimeFailureOnlyMessage(content: string): boolean {
  return content.trimStart().startsWith('[STATUS: DEGRADED');
}

export interface BoundedContextResult {
  /** Chronological (oldest first), ready to map into provider-native chat roles. Never includes the current message. */
  turns: JarvisMessageRecord[];
  priorMessageCount: number;
  contextSizeChars: number;
  /** True if real history existed beyond what fit inside the turn/char budget. */
  truncated: boolean;
}

/**
 * Selects a bounded, chronological slice of real prior conversation turns
 * to inject alongside the current message. Never mutates or reorders its
 * input; never includes the current message (explicit dedup guard below);
 * skips malformed/empty rows defensively rather than crashing or silently
 * degrading the whole request.
 */
export function selectBoundedContext(
  history: JarvisMessageRecord[],
  currentMessage: string,
  opts?: { maxTurns?: number; maxChars?: number }
): BoundedContextResult {
  const maxTurns = opts?.maxTurns ?? MAX_PRIOR_TURNS;
  const maxChars = opts?.maxChars ?? MAX_CONTEXT_CHARS;

  // Malformed/empty rows are skipped, not fatal — a single corrupted row
  // must never take down context construction for the whole request. A
  // pure runtime/provider-failure assistant turn is also skipped here: it
  // stays in the visible transcript (this function never touches storage
  // or display), but it is not real conversational content and carries
  // nothing useful into the next reasoning call.
  const clean = history.filter(
    (m) =>
      m &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0 &&
      (m.role === 'user' || m.role === 'assistant') &&
      !(m.role === 'assistant' && isRuntimeFailureOnlyMessage(m.content))
  );

  // Dedup guard: the caller persists the current user turn via a separate,
  // un-awaited request that may or may not have landed in the DB yet by
  // the time this runs (a real race, not a bug to "fix" by reordering
  // existing client persistence). If the most recent retrieved row is
  // exactly this same user turn, drop it here — the current message is
  // always appended once, explicitly, by the caller.
  const trimmedCurrent = currentMessage.trim();
  const last = clean[clean.length - 1];
  const withoutCurrentTurn =
    last && last.role === 'user' && last.content.trim() === trimmedCurrent
      ? clean.slice(0, -1)
      : clean;

  const truncatedByTurnCount = withoutCurrentTurn.length > maxTurns;
  const turnWindowed = withoutCurrentTurn.slice(-maxTurns); // newest maxTurns, still chronological

  // Character-budget from the newest end backward, so the most recent
  // turns always survive and the oldest are dropped first. Always keeps
  // at least the single most recent message, even if it alone exceeds the
  // budget — an empty context is worse than one slightly-over-budget turn.
  const bounded: JarvisMessageRecord[] = [];
  let totalChars = 0;
  for (let i = turnWindowed.length - 1; i >= 0; i--) {
    const len = turnWindowed[i].content.length;
    if (totalChars + len > maxChars && bounded.length > 0) break;
    bounded.unshift(turnWindowed[i]);
    totalChars += len;
  }

  return {
    turns: bounded,
    priorMessageCount: bounded.length,
    contextSizeChars: totalChars,
    truncated: truncatedByTurnCount || bounded.length < turnWindowed.length,
  };
}
