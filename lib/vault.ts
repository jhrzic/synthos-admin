// ---------------------------------------------------------------------------
// SYNTHOS — Vault read service.
//
// The execution spine (/api/execute-agent-task) is the ONE real writer of
// Vault content: it writes a markdown file to disk and records a matching
// `artifacts` row (content_hash, size_bytes, relative_path) — see
// lib/persistence.ts recordArtifact(). This module is a read-only service
// over that same real data; it does not create a second storage system.
//
// `artifacts` has no workspace_id column of its own (same pattern as
// activity_events/receipts/kil_observations) — every query here scopes
// through the owning task's workspace_id via a JOIN, never a bare artifact
// lookup.
//
// Safety contract: every path this module ever reads is one already stored
// in `artifacts.relative_path` by the real write path (recordArtifact),
// never a client-supplied path. Even so, every read is re-validated against
// VAULT_ROOT before touching disk (containment check on the resolved path,
// then a realpath containment check to catch a symlink escape) — defense in
// depth against a corrupted or unexpected row, not a trust boundary for
// client input, since no client input reaches the filesystem here at all.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './persistence';

export const VAULT_ROOT = path.join(process.cwd(), 'vault');

export interface VaultEntry {
  artifact_id: string;
  task_id: string;
  title: string;
  relative_path: string;
  content_hash: string;
  size_bytes: number;
  created_at: string;
  content_type: string;
}

export interface VaultEntryDetail extends VaultEntry {
  content: string | null;
}

function contentTypeFor(relativePath: string): string {
  return relativePath.toLowerCase().endsWith('.md') ? 'text/markdown' : 'application/octet-stream';
}

/**
 * True only if relativePath is a real relative path (no leading slash, no
 * `..`/`.` segments, no NUL) whose resolved location stays inside VAULT_ROOT.
 */
function isSafeRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\0') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    return false;
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((s) => s === '..' || s === '.' || s === '')) return false;

  const root = path.resolve(VAULT_ROOT);
  const resolved = path.resolve(root, relativePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

interface ArtifactJoinRow {
  artifact_id: string;
  task_id: string;
  relative_path: string;
  content_hash: string;
  size_bytes: number;
  created_at: string;
  title: string | null;
}

function toEntry(row: ArtifactJoinRow): VaultEntry {
  return {
    artifact_id: row.artifact_id,
    task_id: row.task_id,
    title: row.title && row.title.trim() ? row.title : row.relative_path,
    relative_path: row.relative_path,
    content_hash: row.content_hash,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    content_type: contentTypeFor(row.relative_path),
  };
}

/** Every real Vault artifact belonging to a workspace, most recent first. */
export function listWorkspaceVaultEntries(workspaceId: string, limit = 100): VaultEntry[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT a.artifact_id, a.task_id, a.relative_path, a.content_hash, a.size_bytes, a.created_at, t.title
    FROM artifacts a
    JOIN tasks t ON t.task_id = a.task_id
    WHERE t.workspace_id = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(workspaceId, Math.min(Math.max(limit, 1), 500)) as ArtifactJoinRow[];
  return rows.map(toEntry);
}

/**
 * A short, safe preview of a Vault entry's content — first N characters,
 * read from the same real file listWorkspaceVaultEntries() indexes. Never
 * loads the full file into the list response.
 */
export function previewWorkspaceVaultEntry(workspaceId: string, artifactId: string, maxChars = 220): string | null {
  const detail = getWorkspaceVaultEntry(workspaceId, artifactId);
  if (!detail || detail.content === null) return null;
  const trimmed = detail.content.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/**
 * One Vault entry with full content, scoped to workspaceId. Returns null for
 * an unknown artifact id, an artifact belonging to another workspace, or a
 * stored path that fails the safety check — all indistinguishable to the
 * caller, matching the same non-disclosure pattern used for tasks/graphs.
 */
export function getWorkspaceVaultEntry(workspaceId: string, artifactId: string): VaultEntryDetail | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT a.artifact_id, a.task_id, a.relative_path, a.content_hash, a.size_bytes, a.created_at, t.title
    FROM artifacts a
    JOIN tasks t ON t.task_id = a.task_id
    WHERE t.workspace_id = ? AND a.artifact_id = ?
  `).get(workspaceId, artifactId) as ArtifactJoinRow | undefined;
  if (!row) return null;

  if (!isSafeRelativePath(row.relative_path)) {
    return { ...toEntry(row), content: null };
  }

  let content: string | null = null;
  try {
    const resolvedPath = path.resolve(VAULT_ROOT, row.relative_path);
    const realRoot = fs.realpathSync(path.resolve(VAULT_ROOT));
    const realPath = fs.realpathSync(resolvedPath);
    if (realPath === realRoot || realPath.startsWith(realRoot + path.sep)) {
      content = fs.readFileSync(resolvedPath, 'utf8');
    }
  } catch {
    // File genuinely missing/unreadable on disk — an honest null, never a
    // fabricated placeholder.
    content = null;
  }

  return { ...toEntry(row), content };
}
