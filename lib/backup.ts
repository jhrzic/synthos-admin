// ---------------------------------------------------------------------------
// SYNTHOS — real local backup / restore.
//
// Scope: the one real SQLite database file (getDatabasePath() — this
// already covers every table: tasks, skills, jarvis_sessions, memory_index,
// KIL, TON, graphs, receipts, everything) plus the real Vault directory on
// disk. That is the whole of this deployment's durable state. Nothing else
// is backed up: no .env, no node_modules, no build output, no credentials —
// the archive is built from an explicit allowlist of exactly those two
// real paths, never a directory walk that could pick up something else.
//
// Restore is deliberately staged, never a live in-process swap: this
// process holds an open node:sqlite DatabaseSync handle on the real DB file
// for its entire lifetime, and there is no supported way to safely replace
// the file out from under that open handle while the process keeps running.
// restoreFromBackup() validates the archive, stages the real files at a
// clearly named location, and returns RESTART_REQUIRED with the exact
// manual steps — it never claims a restore completed when only a restart
// away from actually being live.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as tar from 'tar';
import { getDatabasePath, getDatabase } from './persistence';
import { VAULT_ROOT } from './vault';

export const BACKUP_ROOT = path.join(process.cwd(), 'backups');
export const STAGED_RESTORE_ROOT = path.join(BACKUP_ROOT, '.staged-restore');

export const BACKUP_FORMAT_VERSION = '1.0.0';

export interface BackupFileChecksum {
  relative_path: string;
  sha256: string;
  size_bytes: number;
}

export interface BackupManifest {
  format_version: string;
  backup_id: string;
  created_at: string;
  app_version: string | null;
  database_included: boolean;
  vault_included: boolean;
  database_checksum: { sha256: string; size_bytes: number } | null;
  vault_file_count: number;
  vault_checksums: BackupFileChecksum[];
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath: string): { sha256: string; size_bytes: number } {
  const buf = fs.readFileSync(filePath);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size_bytes: buf.byteLength };
}

function listFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const results: string[] = [];
  const walk = (dir: string) => {
    // A directory enumerated a moment ago as a subdirectory entry can
    // genuinely disappear before it's scanned (a concurrent process
    // deleting a now-empty directory elsewhere in the app touching
    // Vault content). Skip it rather than failing the whole backup —
    // same defensive posture as the per-file copy below.
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err?.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
      // Symlinks are deliberately skipped, never followed — a backup only
      // ever contains real regular files.
    }
  };
  walk(root);
  return results.sort();
}

function readAppVersion(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/** Rejects a backup id that isn't a bare, safe filename segment — defense against path traversal via the id itself. */
function isSafeBackupId(backupId: string): boolean {
  return /^backup-[0-9]+-[a-f0-9]{6}$/.test(backupId);
}

function backupFilePath(backupId: string): string | null {
  if (!isSafeBackupId(backupId)) return null;
  const resolved = path.resolve(BACKUP_ROOT, `${backupId}.tar.gz`);
  const root = path.resolve(BACKUP_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

export interface BackupSummary {
  backup_id: string;
  file_name: string;
  size_bytes: number;
  manifest: BackupManifest;
}

/**
 * Creates a real backup archive: the real database file plus the real
 * Vault directory, gzipped tar, written to BACKUP_ROOT. Nothing else is
 * ever included — no credentials, no node_modules, no build output.
 */
export async function createBackup(): Promise<BackupSummary> {
  ensureDir(BACKUP_ROOT);
  const backupId = `backup-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const stagingDir = path.join(BACKUP_ROOT, `.staging-${backupId}`);
  ensureDir(stagingDir);

  try {
    const dbPath = getDatabasePath();
    const databaseIncluded = fs.existsSync(dbPath);
    let databaseChecksum: { sha256: string; size_bytes: number } | null = null;
    if (databaseIncluded) {
      // Pass VIII / Workstream Q/T — in WAL mode (lib/persistence.ts), a
      // recent write can still be sitting only in the `-wal` sidecar file,
      // not yet folded into the main `.db` file. A plain fs.copyFileSync of
      // just the main file can silently miss it — a real bug this pass's
      // backup/restore drill (test/backup-restore-drill.test.ts) caught.
      // TRUNCATE checkpoints everything into the main file AND truncates
      // the WAL back to empty, so the copy below is always complete and
      // self-contained (no separate `-wal`/`-shm` file needed in the
      // archive). Safe to call on the live, in-use database handle — this
      // is a normal, supported SQLite operation, not a schema change.
      getDatabase().exec('PRAGMA wal_checkpoint(TRUNCATE);');
      fs.copyFileSync(dbPath, path.join(stagingDir, 'database.db'));
      databaseChecksum = sha256File(dbPath);
    }

    const vaultIncluded = fs.existsSync(VAULT_ROOT);
    const vaultChecksums: BackupFileChecksum[] = [];
    if (vaultIncluded) {
      const stagedVaultDir = path.join(stagingDir, 'vault');
      ensureDir(stagedVaultDir);
      for (const filePath of listFilesRecursive(VAULT_ROOT)) {
        // A file enumerated a moment ago can genuinely disappear before
        // it's copied (a concurrent write elsewhere in the app touching
        // Vault content). Skip it rather than failing the whole backup —
        // vault_file_count only ever counts files that were actually
        // copied and hashed, so the manifest stays honest either way.
        try {
          const relative = path.relative(VAULT_ROOT, filePath);
          const destPath = path.join(stagedVaultDir, relative);
          ensureDir(path.dirname(destPath));
          fs.copyFileSync(filePath, destPath);
          const { sha256, size_bytes } = sha256File(filePath);
          vaultChecksums.push({ relative_path: relative.split(path.sep).join('/'), sha256, size_bytes });
        } catch (err: any) {
          if (err?.code !== 'ENOENT') throw err;
        }
      }
    }

    const manifest: BackupManifest = {
      format_version: BACKUP_FORMAT_VERSION,
      backup_id: backupId,
      created_at: new Date().toISOString(),
      app_version: readAppVersion(),
      database_included: databaseIncluded,
      vault_included: vaultIncluded,
      database_checksum: databaseChecksum,
      vault_file_count: vaultChecksums.length,
      vault_checksums: vaultChecksums,
    };
    fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const archivePath = path.join(BACKUP_ROOT, `${backupId}.tar.gz`);
    const entries = fs.readdirSync(stagingDir);
    await tar.create({ gzip: true, file: archivePath, cwd: stagingDir, portable: true }, entries);

    const sizeBytes = fs.statSync(archivePath).size;
    return { backup_id: backupId, file_name: `${backupId}.tar.gz`, size_bytes: sizeBytes, manifest };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function listBackups(): Array<{ backup_id: string; file_name: string; size_bytes: number; created_at: string | null }> {
  ensureDir(BACKUP_ROOT);
  const files = fs.readdirSync(BACKUP_ROOT).filter((f) => f.endsWith('.tar.gz'));
  return files
    .map((fileName) => {
      const backupId = fileName.replace(/\.tar\.gz$/, '');
      const filePath = path.join(BACKUP_ROOT, fileName);
      const stat = fs.statSync(filePath);
      let createdAt: string | null = null;
      try {
        const manifest = readManifestFromArchive(backupId);
        createdAt = manifest?.created_at || null;
      } catch {
        createdAt = null;
      }
      return { backup_id: backupId, file_name: fileName, size_bytes: stat.size, created_at: createdAt };
    })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

/** Every entry in a backup archive we ever created — defense-in-depth allowlist checked during both manifest reads and restore validation. */
function isSafeArchiveEntry(entryPath: string): boolean {
  if (!entryPath || entryPath.includes('\0')) return false;
  if (path.isAbsolute(entryPath)) return false;
  // Directory entries end in '/' (e.g. "vault/", "vault/Startup-Theses/") —
  // strip exactly one trailing slash before segment-checking so a real
  // directory entry isn't mistaken for a path with an empty segment.
  const withoutTrailingSlash = entryPath.endsWith('/') ? entryPath.slice(0, -1) : entryPath;
  const segments = withoutTrailingSlash.split('/');
  if (segments.some((s) => s === '..' || s === '')) return false;
  return entryPath === 'manifest.json' || entryPath === 'database.db' || entryPath === 'vault' || entryPath.startsWith('vault/');
}

export function readManifestFromArchive(backupId: string): BackupManifest | null {
  const archivePath = backupFilePath(backupId);
  if (!archivePath || !fs.existsSync(archivePath)) return null;

  let manifestText: string | null = null;
  tar.list({
    file: archivePath,
    sync: true,
    filter: (entryPath) => entryPath === 'manifest.json',
    onReadEntry: (entry) => {
      const chunks: Buffer[] = [];
      entry.on('data', (c: Buffer) => chunks.push(c));
      entry.on('end', () => { manifestText = Buffer.concat(chunks).toString('utf8'); });
    },
  } as any);

  if (!manifestText) return null;
  try {
    return JSON.parse(manifestText) as BackupManifest;
  } catch {
    return null;
  }
}

export interface BackupValidationResult {
  valid: boolean;
  backupId: string;
  manifestPresent: boolean;
  manifestValid: boolean;
  entriesSafe: boolean;
  checksumsVerified: boolean;
  issues: string[];
  manifest: BackupManifest | null;
}

/**
 * Full, real validation of a backup archive — never mutates live state.
 * Lists every entry (rejecting traversal/absolute paths/anything outside
 * the known allowlist), reads the manifest, and independently recomputes
 * checksums from the archive's own bytes to confirm the manifest wasn't
 * tampered with or the archive corrupted.
 */
export function validateBackupArchive(backupId: string): BackupValidationResult {
  const issues: string[] = [];
  const archivePath = backupFilePath(backupId);
  if (!archivePath || !fs.existsSync(archivePath)) {
    return { valid: false, backupId, manifestPresent: false, manifestValid: false, entriesSafe: false, checksumsVerified: false, issues: ['Backup archive not found.'], manifest: null };
  }

  let entriesSafe = true;
  const seenPaths: string[] = [];
  try {
    tar.list({
      file: archivePath,
      sync: true,
      onentry: (entry: any) => {
        seenPaths.push(entry.path);
        if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
          entriesSafe = false;
          issues.push(`Rejected: archive contains a link entry ("${entry.path}") — backups never legitimately contain symlinks.`);
        }
        if (!isSafeArchiveEntry(entry.path)) {
          entriesSafe = false;
          issues.push(`Rejected: unsafe or unexpected entry path "${entry.path}".`);
        }
      },
    } as any);
  } catch (err: any) {
    return { valid: false, backupId, manifestPresent: false, manifestValid: false, entriesSafe: false, checksumsVerified: false, issues: [`Archive is corrupted or unreadable: ${err?.message || err}`], manifest: null };
  }

  const manifest = readManifestFromArchive(backupId);
  const manifestPresent = manifest !== null;
  if (!manifestPresent) issues.push('manifest.json missing or unparsable.');

  const manifestValid = manifestPresent && manifest!.format_version === BACKUP_FORMAT_VERSION && manifest!.backup_id === backupId;
  if (manifestPresent && !manifestValid) issues.push('Manifest format_version or backup_id does not match this archive.');

  let checksumsVerified = false;
  if (entriesSafe && manifestValid) {
    const stagingDir = path.join(BACKUP_ROOT, `.validate-${backupId}-${crypto.randomBytes(3).toString('hex')}`);
    try {
      ensureDir(stagingDir);
      tar.extract({ file: archivePath, cwd: stagingDir, sync: true, strict: true, preservePaths: false } as any);

      let dbOk = true;
      if (manifest!.database_included && manifest!.database_checksum) {
        const stagedDbPath = path.join(stagingDir, 'database.db');
        dbOk = fs.existsSync(stagedDbPath) && sha256File(stagedDbPath).sha256 === manifest!.database_checksum.sha256;
        if (!dbOk) issues.push('Database checksum mismatch — archive may be corrupted or tampered with.');
      }

      let vaultOk = true;
      for (const entry of manifest!.vault_checksums) {
        const stagedFilePath = path.join(stagingDir, 'vault', entry.relative_path);
        const root = path.resolve(stagingDir, 'vault');
        const resolved = path.resolve(stagedFilePath);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) { vaultOk = false; issues.push(`Vault entry escapes extraction root: ${entry.relative_path}`); continue; }
        if (!fs.existsSync(resolved) || sha256File(resolved).sha256 !== entry.sha256) {
          vaultOk = false;
          issues.push(`Vault file checksum mismatch: ${entry.relative_path}`);
        }
      }

      checksumsVerified = dbOk && vaultOk;
    } catch (err: any) {
      issues.push(`Checksum verification failed: ${err?.message || err}`);
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  return {
    valid: entriesSafe && manifestPresent && manifestValid && checksumsVerified,
    backupId,
    manifestPresent,
    manifestValid,
    entriesSafe,
    checksumsVerified,
    issues,
    manifest,
  };
}

export interface RestorePlan {
  backupId: string;
  willReplace: { databasePath: string; vaultPath: string };
  fileCounts: { vaultFiles: number };
  manifest: BackupManifest;
}

export interface StagedRestoreResult {
  status: 'RESTART_REQUIRED';
  stagedAt: string;
  instructions: string[];
  plan: RestorePlan;
}

/**
 * Validates the archive, then stages its real contents at a clearly named
 * location on disk. Never touches the live database file or the live Vault
 * directory — this process holds an open handle on the live DB for its
 * entire lifetime, so an in-place swap here would be unsafe. Actually
 * applying a staged restore is a manual, documented step taken at process
 * startup, before the database is ever opened.
 */
export function stageRestore(backupId: string, confirmed: boolean): StagedRestoreResult | { error: string; validation?: BackupValidationResult } {
  if (confirmed !== true) {
    return { error: 'Restore requires explicit confirmation. Set confirmed: true after reviewing the restore plan.' };
  }
  const validation = validateBackupArchive(backupId);
  if (!validation.valid || !validation.manifest) {
    return { error: 'Backup archive failed validation and will not be staged for restore.', validation };
  }

  // Pass VIII / Workstream R — extract into a private, uniquely-named
  // directory first, then publish it to the well-known STAGED_RESTORE_ROOT
  // path via two atomic renames (never a remove-then-slowly-rebuild
  // window). Two concurrent stageRestore() calls previously raced directly
  // on STAGED_RESTORE_ROOT — one's `rmSync` could delete the other's
  // mid-extraction directory, or a reader could observe a torn, partially-
  // extracted archive. Now: each call's own tar.extract runs in full
  // isolation, and only the atomic rename below is ever visible at the
  // public path — the last call to finish deterministically wins, wholly,
  // never a mix of two extractions.
  const privateStagingDir = path.join(BACKUP_ROOT, `.staging-restore-${crypto.randomBytes(6).toString('hex')}`);
  ensureDir(privateStagingDir);
  tar.extract({ file: backupFilePath(backupId)!, cwd: privateStagingDir, sync: true, strict: true, preservePaths: false } as any);

  const trashDir = `${STAGED_RESTORE_ROOT}.trash-${crypto.randomBytes(4).toString('hex')}`;
  if (fs.existsSync(STAGED_RESTORE_ROOT)) {
    fs.renameSync(STAGED_RESTORE_ROOT, trashDir); // atomic — STAGED_RESTORE_ROOT is briefly absent, never partial
  }
  fs.renameSync(privateStagingDir, STAGED_RESTORE_ROOT); // atomic publish
  fs.rmSync(trashDir, { recursive: true, force: true }); // best-effort cleanup of the old copy, already unreferenced

  const dbPath = getDatabasePath();
  const plan: RestorePlan = {
    backupId,
    willReplace: { databasePath: dbPath, vaultPath: VAULT_ROOT },
    fileCounts: { vaultFiles: validation.manifest.vault_file_count },
    manifest: validation.manifest,
  };

  return {
    status: 'RESTART_REQUIRED',
    stagedAt: STAGED_RESTORE_ROOT,
    instructions: [
      'Stop the running server.',
      `Replace the database file at ${dbPath} with ${path.join(STAGED_RESTORE_ROOT, 'database.db')}.`,
      `Replace the Vault directory at ${VAULT_ROOT} with ${path.join(STAGED_RESTORE_ROOT, 'vault')}.`,
      'Restart the server.',
    ],
    plan,
  };
}
