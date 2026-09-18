import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// SCHEMA VERSION — the monotonic `user_version` owned by lib/persistence.ts.
// Temp databases only.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-schema-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'schema.db');

import { getDatabase, closeDatabase, applySchemaMigrations, SCHEMA_MIGRATIONS, SCHEMA_VERSION, SchemaVersionUnsupportedError, type SchemaMigration } from '../lib/persistence';

const userVersion = (db: any) => Number((db.prepare('PRAGMA user_version').get() as any).user_version);
const tables = (db: any) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as any[]).map((r) => r.name);
const withDbPath = <T>(p: string, fn: () => T): T => {
  const saved = process.env.SYNTHOS_DB_PATH;
  closeDatabase(); process.env.SYNTHOS_DB_PATH = p;
  try { return fn(); } finally { closeDatabase(); process.env.SYNTHOS_DB_PATH = saved; }
};

describe('schema version', () => {
  it('migrations are contiguous from 1, and the supported version is the last one', () => {
    expect(SCHEMA_MIGRATIONS.map((m) => m.version)).toEqual(SCHEMA_MIGRATIONS.map((_, i) => i + 1));
    expect(SCHEMA_VERSION).toBe(SCHEMA_MIGRATIONS.length);
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('a fresh database opens at the current version', () => {
    const db = withDbPath(path.join(TMP, 'fresh.db'), () => { const d = getDatabase(); return { v: userVersion(d), t: tables(d) }; });
    expect(db.v).toBe(SCHEMA_VERSION);
    expect(db.t).toContain('artifact_purpose_events');
  });

  it('an older (unversioned, version 0) database is migrated forward without losing data', () => {
    const p = path.join(TMP, 'older.db');
    const raw = new DatabaseSync(p);
    raw.exec("CREATE TABLE tasks (task_id TEXT PRIMARY KEY, title TEXT); INSERT INTO tasks VALUES ('t-1', 'kept');");
    expect(userVersion(raw)).toBe(0);
    raw.close();
    const out = withDbPath(p, () => { const d = getDatabase(); return { v: userVersion(d), rows: d.prepare('SELECT task_id, title FROM tasks').all(), t: tables(d) }; });
    expect(out.v).toBe(SCHEMA_VERSION);
    expect(out.rows).toEqual([{ task_id: 't-1', title: 'kept' }]);
    expect(out.t).toContain('artifact_purpose_events');
  });

  it('a database at version 1 applies only migrations 2 and 3', () => {
    const db = new DatabaseSync(path.join(TMP, 'v1.db'));
    db.exec('PRAGMA user_version = 1');
    expect(applySchemaMigrations(db)).toEqual({ from: 1, to: 3, applied: [2, 3] });
    expect(tables(db)).toContain('artifact_purpose_events');
    expect(tables(db)).toContain('queued_task_activations');
    db.close();
  });

  it('a database at version 2 applies only migration 3, which creates an empty activation table', () => {
    const db = new DatabaseSync(path.join(TMP, 'v2.db'));
    db.exec('PRAGMA user_version = 2');
    expect(applySchemaMigrations(db)).toEqual({ from: 2, to: 3, applied: [3] });
    expect((db.prepare('SELECT COUNT(*) AS n FROM queued_task_activations').get() as any).n).toBe(0);
    db.close();
  });

  it('re-running is a no-op (idempotent), and reopening changes nothing', () => {
    const p = path.join(TMP, 'repeat.db');
    const first = withDbPath(p, () => { const d = getDatabase(); return d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all(); });
    const again = withDbPath(p, () => { const d = getDatabase(); return { r: applySchemaMigrations(d), s: d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all(), v: userVersion(d) }; });
    expect(again.r).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, applied: [] });
    expect(again.s).toEqual(first);
    expect(again.v).toBe(SCHEMA_VERSION);
    // A migration applied to a database that already has its table (the lazily-created case) is harmless.
    const db = new DatabaseSync(p);
    db.exec('PRAGMA user_version = 1');
    expect(applySchemaMigrations(db).applied).toEqual([2, 3]);
    db.close();
  });

  it('fails closed on a database newer than this build supports, and leaves it untouched', () => {
    const p = path.join(TMP, 'newer.db');
    const raw = new DatabaseSync(p);
    raw.exec(`CREATE TABLE future_only (x TEXT); PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
    raw.close();
    withDbPath(p, () => {
      expect(() => getDatabase()).toThrow(SchemaVersionUnsupportedError);
      expect(() => getDatabase()).toThrow(/newer than this build supports/);
    });
    const after = new DatabaseSync(p);
    expect(userVersion(after)).toBe(SCHEMA_VERSION + 1);
    expect(tables(after)).toEqual(['future_only']); // no table provisioned, nothing migrated
    after.close();
    const direct = new DatabaseSync(p);
    expect(() => applySchemaMigrations(direct)).toThrow(SchemaVersionUnsupportedError);
    direct.close();
  });

  it('an interrupted (failing) migration rolls back both its change and the version bump', () => {
    const db = new DatabaseSync(path.join(TMP, 'interrupted.db'));
    const migrations: SchemaMigration[] = [
      { version: 1, description: 'base', up: (d) => d.exec('CREATE TABLE a (x TEXT)') },
      { version: 2, description: 'half-done', up: (d) => { d.exec('CREATE TABLE b (x TEXT)'); throw new Error('power cut'); } },
    ];
    expect(() => applySchemaMigrations(db, migrations)).toThrow(/migration 2 .* rolled back; the database stays at version 1: power cut/);
    expect(userVersion(db)).toBe(1);
    expect(tables(db)).toEqual(['a']); // b was rolled back
    // Once the migration is fixed, the retry completes from where it stopped.
    migrations[1] = { version: 2, description: 'fixed', up: (d) => d.exec('CREATE TABLE b (x TEXT)') };
    expect(applySchemaMigrations(db, migrations)).toEqual({ from: 1, to: 2, applied: [2] });
    expect(tables(db)).toEqual(['a', 'b']);
    db.close();
  });

  it('refuses a non-contiguous migration list', () => {
    const db = new DatabaseSync(path.join(TMP, 'gap.db'));
    expect(() => applySchemaMigrations(db, [{ version: 1, description: 'a', up: () => {} }, { version: 3, description: 'c', up: () => {} }])).toThrow(/contiguous/);
    expect(userVersion(db)).toBe(1);
    db.close();
  });

  it('no migration is destructive', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/persistence.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const SCHEMA_MIGRATIONS'), src.indexOf('export const SCHEMA_VERSION'));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/\b(DROP|DELETE|UPDATE|RENAME)\b/i);
  });
});
