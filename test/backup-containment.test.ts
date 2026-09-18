import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// RUNTIME BACKUPS STAY LOCAL. A database, journal or archive must never be
// committable, wherever it lands. (An early dev database was committed on
// 2026-09-01 and deleted in 2bc5d79; this keeps it from recurring.)
// ---------------------------------------------------------------------------

const git = (...args: string[]) => spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });

describe('backup containment', () => {
  it('representative backup, database, journal and archive names are ignored', () => {
    const names = [
      'backups/pre-local-qualification-2026-09-18.db',
      'backups/backup-1788383982963-58ec98.tar.gz',
      'backups/.staging-backup-1789726743740-230606/database.db',
      'backups/anything/at/all.json',
      'data/synthos-admin.db', 'data/synthos-admin.db-wal', 'data/synthos-admin.db-shm',
      'scratch/copy-of-prod.db', 'tmp/export.sqlite', 'tmp/export.sqlite3', 'notes/old.db-journal',
      'restore/snapshot.tgz', 'x.bak',
    ];
    for (const n of names) {
      const r = git('check-ignore', '-q', '--no-index', n);
      expect(r.status, `${n} must be ignored`).toBe(0);
    }
  });

  it('no database, journal, backup or archive is tracked', () => {
    const tracked = git('ls-files').stdout.split('\n').filter(Boolean);
    const bad = tracked.filter((f) => /^backups\//.test(f) || /\.(db|sqlite|sqlite3|bak|tgz)$|\.tar\.gz$|\.db-(wal|shm|journal)$|\.sqlite-/.test(f));
    expect(bad).toEqual([]);
  });

  it('ordinary source files are not caught by the patterns', () => {
    for (const n of ['lib/backup.ts', 'test/backup.test.ts', 'docs/deploy/ALWAYS-ON-LOCAL-RUNTIME.md']) {
      expect(git('check-ignore', '-q', '--no-index', n).status, n).toBe(1);
    }
  });
});
