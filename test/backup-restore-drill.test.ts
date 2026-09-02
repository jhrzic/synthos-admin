import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-restore-drill-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getDatabase } from '../lib/persistence';
import { createUser } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { recordArtifact } from '../lib/persistence';
import { VAULT_ROOT } from '../lib/vault';
import { createBackup, validateBackupArchive, stageRestore, STAGED_RESTORE_ROOT, BACKUP_ROOT } from '../lib/backup';

// ---------------------------------------------------------------------------
// Pass VIII / Workstream T — a real, controlled restore drill. Prior
// coverage (test/backup.test.ts) proves an archive validates and a restore
// stages real files; it does not open the staged database and actually
// query its content. This test does — it creates real, identifiable data
// (a real user, a real Vault artifact), backs it up, stages a restore, and
// then opens the STAGED copy with an independent DatabaseSync connection
// (never the live getDatabase() handle) to prove the restored bytes really
// contain that exact data. The live working DB (TEST_DB_PATH here, the
// real one in production) is never touched or overwritten by this test —
// only an independent, separately-opened copy is inspected.
// ---------------------------------------------------------------------------

const DRILL_MARKER_EMAIL = `restore-drill-${Date.now()}@example.com`;
const DRILL_WORKSPACE = 'ws-restore-drill';
const DRILL_ARTIFACT_CONTENT = `# Restore Drill Marker\n\nCreated at ${new Date().toISOString()} — proves real content survives a full backup/restore round-trip.\n`;

let createdBackupId: string;
// Unique per test run (pid + random suffix, not just Date.now()) — this
// writes into the real, shared vault/Startup-Theses/ directory (not test-
// isolated; same posture as test/backup.test.ts), so a fixed/predictable
// name risks colliding with a stale file a prior interrupted run left
// behind. Tracked exactly so step 5 checks the file THIS run created,
// never a fuzzy "first file matching a prefix" that could pick up stale
// output from an earlier run.
const DRILL_FILE_NAME = `restore-drill-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`;
let drillDiskPath: string;

beforeAll(async () => {
  getDatabase(); // materialize schema
  const user = createUser({ email: DRILL_MARKER_EMAIL, password: 'restore-drill-pw-1', displayName: 'Restore Drill User' });
  ensureWorkspace(DRILL_WORKSPACE, 'Restore Drill Workspace');
  grantMembership(user.user_id, DRILL_WORKSPACE, 'admin');

  const vaultDir = path.join(VAULT_ROOT, 'Startup-Theses');
  fs.mkdirSync(vaultDir, { recursive: true });
  drillDiskPath = path.join(vaultDir, DRILL_FILE_NAME);
  recordArtifact({
    taskId: 'task-restore-drill', relativePath: `Startup-Theses/${DRILL_FILE_NAME}`,
    diskPath: drillDiskPath, content: DRILL_ARTIFACT_CONTENT,
  });
});

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  try { fs.unlinkSync(drillDiskPath); } catch { /* best effort */ }
  try {
    if (createdBackupId) fs.unlinkSync(path.join(BACKUP_ROOT, `${createdBackupId}.tar.gz`));
  } catch { /* best effort */ }
  try { fs.rmSync(STAGED_RESTORE_ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('T: full backup -> validate -> stage -> independently re-open and verify content drill', () => {
  it('step 1: creates a real backup archive', async () => {
    const summary = await createBackup();
    createdBackupId = summary.backup_id;
    expect(summary.size_bytes).toBeGreaterThan(0);
    expect(summary.manifest.database_included).toBe(true);
  });

  it('step 2: the manifest and checksums independently re-validate against the real archive bytes', () => {
    const validation = validateBackupArchive(createdBackupId);
    expect(validation.valid).toBe(true);
    expect(validation.checksumsVerified).toBe(true);
    expect(validation.manifest?.vault_file_count).toBeGreaterThan(0);
  });

  it('step 3: stages a real restore (extracts real files, never swaps the live DB)', () => {
    const liveDbBytesBefore = fs.readFileSync(TEST_DB_PATH);
    const result = stageRestore(createdBackupId, true);
    expect('error' in result).toBe(false);

    const stagedDbPath = path.join(STAGED_RESTORE_ROOT, 'database.db');
    expect(fs.existsSync(stagedDbPath)).toBe(true);

    // The live DB this process still has open is byte-identical to before
    // staging — staging never touched it.
    const liveDbBytesAfter = fs.readFileSync(TEST_DB_PATH);
    expect(liveDbBytesAfter.equals(liveDbBytesBefore)).toBe(true);
  });

  it('step 4: independently opens the STAGED (restored) database and finds the real user data', () => {
    const stagedDbPath = path.join(STAGED_RESTORE_ROOT, 'database.db');
    const restoredDb = new DatabaseSync(stagedDbPath);
    try {
      const row = restoredDb.prepare('SELECT email, display_name, platform_role FROM users WHERE email = ?').get(DRILL_MARKER_EMAIL) as any;
      expect(row).toBeDefined();
      expect(row.email).toBe(DRILL_MARKER_EMAIL);
      expect(row.display_name).toBe('Restore Drill User');

      const membershipRow = restoredDb.prepare('SELECT role FROM workspace_memberships WHERE workspace_id = ?').get(DRILL_WORKSPACE) as any;
      expect(membershipRow?.role).toBe('admin');
    } finally {
      restoredDb.close();
    }
  });

  it('step 5: the staged Vault directory contains the real artifact with byte-identical content', () => {
    const stagedFilePath = path.join(STAGED_RESTORE_ROOT, 'vault', 'Startup-Theses', DRILL_FILE_NAME);
    expect(fs.existsSync(stagedFilePath)).toBe(true);
    const restoredContent = fs.readFileSync(stagedFilePath, 'utf8');
    expect(restoredContent).toBe(DRILL_ARTIFACT_CONTENT);
  });

  it('honesty check: the real working DB this process is using was never touched by any step above', () => {
    const db = getDatabase();
    const row = db.prepare('SELECT email FROM users WHERE email = ?').get(DRILL_MARKER_EMAIL) as any;
    // The live DB still has the same real row — proving nothing was
    // swapped out from under the running process (which is exactly why
    // this codebase's restore is staged-only, never a live in-place swap).
    expect(row?.email).toBe(DRILL_MARKER_EMAIL);
  });
});
