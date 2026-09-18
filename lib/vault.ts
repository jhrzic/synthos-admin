// ---------------------------------------------------------------------------
// SYNTHOS — Vault read/write service.
//
// STEP 2 (SynthOS Execution Fabric): writeWorkspaceArtifact() below is now
// the single canonical server-side writer of durable Vault content —
// lib/fabric/kernel.ts's task-execution artifacts and the real Vault-note
// endpoint (server.ts POST /api/vault/notes) both call it. Before this, the
// route wrote directly to `vault/Startup-Theses/${sanitizedTitle}.md` (a
// flat, title-keyed, workspace-unscoped path — characterized as a real
// collision risk in test/fabric-characterization.test.ts) and the frontend's
// "Add Note to Vault" never persisted anything at all. Neither path exists
// anymore; both go through the one function below, which reuses the
// existing `artifacts` persistence layer (recordArtifact, lib/persistence.ts)
// rather than reimplementing storage.
//
// `artifacts` has no workspace_id column of its own (same pattern as
// activity_events/receipts/kil_observations) — every read query here scopes
// through the owning task's workspace_id via a JOIN, never a bare artifact
// lookup. The new storage layout gives every artifact a real, separate
// filesystem root per workspace too (vault/workspaces/<workspaceId>/...),
// so workspace isolation is enforced at both the DB layer and the disk
// layer, not the DB layer alone.
//
// Safety contract for READS: every path this module ever reads is one
// already stored in `artifacts.relative_path` by the real write path
// (writeWorkspaceArtifact -> recordArtifact), never a client-supplied path.
// Even so, every read is re-validated against VAULT_ROOT before touching
// disk (containment check on the resolved path, then a realpath containment
// check to catch a symlink escape) — defense in depth against a corrupted
// or unexpected row, not a trust boundary for client input, since no client
// input reaches the filesystem on the read side at all.
//
// Safety contract for WRITES: workspaceId is always server-resolved
// (lib/fabric's resolvedWorkspaceId, or the real authenticated caller's own
// membership for the Vault-notes route) — never a raw client string trusted
// as-is — but writeWorkspaceArtifact() still treats it as untrusted input
// when building a filesystem path from it: rejected outright if it contains
// a path separator, `..`, or a NUL byte, the target directory is created
// and then re-resolved via realpath to confirm it is still inside VAULT_ROOT
// (catching a symlink planted anywhere in the chain), and the final
// filename is entirely server-generated (never derived from a title) so
// two artifacts can never collide on disk regardless of what a human-
// readable title says. See isSafeRelativePath() below, shared by both reads
// and this validation.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDatabase, recordArtifact, type ArtifactRecord } from './persistence';

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
  task_status: string | null;
  retrieval_status: string | null;
  retrieval_status_reason: string | null;
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
  task_status?: string | null;
  retrieval_status?: string | null;
  retrieval_status_reason?: string | null;
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
    // The producing task's terminal status and whether this artifact is in
    // active retrieval or quarantined (with why). Both read from the rows.
    task_status: row.task_status ?? null,
    retrieval_status: row.retrieval_status ?? null,
    retrieval_status_reason: row.retrieval_status_reason ?? null,
  };
}

/** Every real Vault artifact belonging to a workspace, most recent first. */
export function listWorkspaceVaultEntries(workspaceId: string, limit = 100): VaultEntry[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT a.artifact_id, a.task_id, a.relative_path, a.content_hash, a.size_bytes, a.created_at, t.title, t.status AS task_status, a.retrieval_status, a.retrieval_status_reason
    FROM artifacts a
    JOIN tasks t ON t.task_id = a.task_id
    WHERE t.workspace_id = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(workspaceId, Math.min(Math.max(limit, 1), 500)) as ArtifactJoinRow[];
  return rows.map(toEntry);
}

// Real total, independent of listWorkspaceVaultEntries' bounded page — a
// dashboard count must never silently equal the fetch limit.
export function countWorkspaceVaultEntries(workspaceId: string): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM artifacts a JOIN tasks t ON t.task_id = a.task_id WHERE t.workspace_id = ?
  `).get(workspaceId) as { n: number | null } | undefined;
  return row?.n ?? 0;
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
    SELECT a.artifact_id, a.task_id, a.relative_path, a.content_hash, a.size_bytes, a.created_at, t.title, t.status AS task_status, a.retrieval_status, a.retrieval_status_reason
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

// ---------------------------------------------------------------------------
// writeWorkspaceArtifact() — the canonical writer (STEP 2).
// ---------------------------------------------------------------------------

/**
 * True only for a single, safe path SEGMENT — no separator, no `..`/`.`,
 * no NUL, non-empty. Stricter than isSafeRelativePath() (which allows
 * multiple segments): workspaceId and folder are each exactly one segment,
 * never a path of their own, so this rejects `workspaceId: "../.."` outright
 * rather than relying on the later realpath check to catch it.
 */
function isSafeSegment(segment: string): boolean {
  if (!segment || segment.includes('\0')) return false;
  if (segment === '.' || segment === '..') return false;
  if (segment.includes('/') || segment.includes('\\')) return false;
  return true;
}

export class VaultWriteSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultWriteSecurityError';
  }
}

export interface WriteWorkspaceArtifactParams {
  /** Server-resolved workspace scope — never trusted client input, but still validated as a path segment. */
  workspaceId: string;
  taskId: string;
  /**
   * The document content to persist. The human-readable title belongs
   * inside this string (e.g. a Markdown H1), exactly like every existing
   * artifact-content caller already does — writeWorkspaceArtifact() never
   * derives the filename or any storage identity from a title, so there is
   * deliberately no separate `title` parameter here to be misused for that.
   */
  content: string;
  /** A logical grouping folder, e.g. "Startup-Theses" or "Notes". Server-controlled; validated as a single path segment. */
  folder?: string;
  /** File extension without the dot. Defaults to "md". */
  extension?: string;
  createdAt?: string;
}

/**
 * The single server-side owner of durable Vault artifact writes. Both
 * lib/fabric/kernel.ts (task-execution artifacts) and
 * POST /api/vault/notes (manual notes) call this — neither writes to disk
 * or inserts an `artifacts` row any other way.
 *
 * Storage identity (the on-disk path and the DB row) is determined
 * entirely by workspaceId + a server-generated artifact id — never by any
 * human-readable title, which callers embed inside `content` itself and
 * which this function never inspects. This is what makes two artifacts
 * with the same title, in the same workspace or different ones,
 * structurally unable to collide: their filenames never depend on the
 * title at all.
 *
 * Traversal/symlink protections (Rev 2):
 *  1. workspaceId and folder are each validated as a single safe path
 *     segment (isSafeSegment) — rejects separators, `..`, NUL outright.
 *  2. The workspace root is derived server-side: VAULT_ROOT/workspaces/<workspaceId>.
 *  3. VAULT_ROOT itself is realpath-resolved once as the trusted anchor.
 *  4. The target directory is created, then realpath-resolved again and
 *     checked for containment inside the trusted anchor — a symlink
 *     anywhere in the chain (e.g. `vault/workspaces` itself replaced with
 *     a symlink) fails this check rather than being silently followed.
 *  5. The filename is server-generated (artifactId + extension) — never
 *     derived from title or any other client-influenced string.
 *  6. Immediately before writing, `lstat` (which does NOT follow symlinks)
 *     checks the exact target path: if anything already exists there,
 *     the write is refused rather than following/overwriting through it.
 */
export function writeWorkspaceArtifact(params: WriteWorkspaceArtifactParams): ArtifactRecord {
  const { workspaceId, taskId, content } = params;
  const folder = params.folder && params.folder.trim() ? params.folder.trim() : 'Artifacts';
  const extension = (params.extension && params.extension.trim()) || 'md';
  const createdAt = params.createdAt || new Date().toISOString();

  if (!isSafeSegment(workspaceId)) {
    throw new VaultWriteSecurityError(`writeWorkspaceArtifact: unsafe workspaceId segment: ${JSON.stringify(workspaceId)}`);
  }
  if (!isSafeSegment(folder)) {
    throw new VaultWriteSecurityError(`writeWorkspaceArtifact: unsafe folder segment: ${JSON.stringify(folder)}`);
  }
  if (!/^[a-zA-Z0-9]{1,10}$/.test(extension)) {
    throw new VaultWriteSecurityError(`writeWorkspaceArtifact: unsafe extension: ${JSON.stringify(extension)}`);
  }

  const root = path.resolve(VAULT_ROOT);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);

  const targetDir = path.resolve(root, 'workspaces', workspaceId, folder);
  fs.mkdirSync(targetDir, { recursive: true });
  const realTargetDir = fs.realpathSync(targetDir);
  if (realTargetDir !== realRoot && !realTargetDir.startsWith(realRoot + path.sep)) {
    throw new VaultWriteSecurityError(
      `writeWorkspaceArtifact: resolved target directory escapes VAULT_ROOT (symlink?) — refusing to write. root=${realRoot} target=${realTargetDir}`
    );
  }

  // Server-generated identity — title never enters the filename.
  const artifactId = `art-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const filename = `${artifactId}.${extension}`;
  const diskPath = path.join(targetDir, filename);
  const relativePath = path.relative(root, diskPath).split(path.sep).join('/');

  // Symlink-following-overwrite guard: lstat never follows the final
  // symlink component, unlike existsSync/statSync. A crypto-random
  // filename should never already exist, but if anything is there —
  // symlink or otherwise — refuse rather than write through/over it.
  try {
    fs.lstatSync(diskPath);
    throw new VaultWriteSecurityError(`writeWorkspaceArtifact: refusing to write — a filesystem entry already exists at the generated path: ${diskPath}`);
  } catch (err: any) {
    if (err instanceof VaultWriteSecurityError) throw err;
    if (err?.code !== 'ENOENT') throw err; // any other lstat failure is a real, unexpected error — surface it
  }

  // The real write + DB insert — reuses the existing persistence layer
  // rather than a second implementation. recordArtifact() computes the
  // real SHA-256 hash from the same content buffer it writes, so the
  // stored content_hash always matches the file that lands on disk.
  const persisted = recordArtifact({
    artifactId,
    taskId,
    relativePath,
    diskPath,
    content,
    createdAt,
  });

  return persisted;
}
