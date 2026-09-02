// ---------------------------------------------------------------------------
// SYNTHOS — real, workspace-scoped Jarvis conversation history.
//
// Jarvis (JarvisView / GlobalVoiceOverlay) previously held its transcript
// only in React state — reload the page and it was gone, and there was no
// concept of a session to resume. This module is the real persisted store
// behind it: SQLite (no new engine), workspace-scoped, minimal fields.
//
// Only the same visible text already shown on screen is ever stored — no
// hidden model chain-of-thought, no secrets.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from './persistence';

export interface JarvisSessionRecord {
  session_id: string;
  workspace_id: string;
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

export function createJarvisSession(workspaceId: string, title?: string): JarvisSessionRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const sessionId = `jsess-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare(`
    INSERT INTO jarvis_sessions (session_id, workspace_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, workspaceId, title || null, now, now);
  return { session_id: sessionId, workspace_id: workspaceId, title: title || null, created_at: now, updated_at: now };
}

interface SessionRow {
  session_id: string;
  workspace_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

function statsFor(session: SessionRow): JarvisSessionWithStats {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) AS total FROM jarvis_messages WHERE session_id = ? AND workspace_id = ?
  `).get(session.session_id, session.workspace_id) as { total: number };
  const last = db.prepare(`
    SELECT content FROM jarvis_messages WHERE session_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(session.session_id, session.workspace_id) as { content: string } | undefined;

  return {
    session_id: session.session_id,
    workspace_id: session.workspace_id,
    title: session.title,
    created_at: session.created_at,
    updated_at: session.updated_at,
    messageCount: row?.total || 0,
    lastMessagePreview: last ? (last.content.length > 120 ? `${last.content.slice(0, 120)}…` : last.content) : null,
  };
}

export function listWorkspaceJarvisSessions(workspaceId: string, limit = 50): JarvisSessionWithStats[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM jarvis_sessions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?
  `).all(workspaceId, Math.min(Math.max(limit, 1), 200)) as SessionRow[];
  return rows.map(statsFor);
}

export function getWorkspaceJarvisSession(workspaceId: string, sessionId: string): JarvisSessionWithStats | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM jarvis_sessions WHERE workspace_id = ? AND session_id = ?
  `).get(workspaceId, sessionId) as SessionRow | undefined;
  if (!row) return null;
  return statsFor(row);
}

/**
 * Real messages for a session, oldest first. Returns null (never an empty
 * array) when the session doesn't exist in this workspace — same
 * non-disclosure pattern as tasks/graphs/vault/skills: unknown id and
 * wrong-workspace id are indistinguishable to the caller.
 */
export function listSessionMessages(workspaceId: string, sessionId: string): JarvisMessageRecord[] | null {
  const session = getWorkspaceJarvisSession(workspaceId, sessionId);
  if (!session) return null;
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM jarvis_messages WHERE workspace_id = ? AND session_id = ? ORDER BY created_at ASC
  `).all(workspaceId, sessionId) as JarvisMessageRecord[];
}

/**
 * Appends one real message to a session. Returns null if the session isn't
 * real in this workspace (never silently creates one under the caller's
 * feet). The session's title is derived from the first user message if it
 * doesn't have one yet — never fabricated, never a generic placeholder like
 * "New Chat N".
 */
export function appendJarvisMessage(params: {
  workspaceId: string;
  sessionId: string;
  role: JarvisMessageRole;
  content: string;
  messageType?: JarvisMessageType;
  provider?: string | null;
  model?: string | null;
}): JarvisMessageRecord | null {
  const session = getWorkspaceJarvisSession(params.workspaceId, params.sessionId);
  if (!session) return null;

  const db = getDatabase();
  const now = new Date().toISOString();
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
