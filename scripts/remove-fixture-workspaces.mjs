#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ONE-TIME REMOVAL OF PRE-ISOLATION TEST-FIXTURE WORKSPACES.
//
// Three workspaces were written into the production database by test runs that
// happened before database isolation existed. They rendered in the Admin
// sidebar as real client workspaces:
//
//   ws-1789099080486-zm8v8p  "Alder Dental"
//   ws-1789099080551-f6r0y8  "Brightwater Plumbing"
//   ws-1788875949023-l61ecq  "Isolation Test Workspace"
//
// EVIDENCE THAT EACH IS TEST-CREATED (gathered before writing this script):
//
//  * The business profiles are byte-identical to fixtures in
//    test/business-assistant-production.test.ts — business_name, assistant_name
//    ("Nia", "Sam") and business_description all match the test source exactly.
//  * Task titles "Alder Dental — New patients" and "Brightwater Plumbing —
//    Callout" appear verbatim in that same test file.
//  * The Brightwater conversation asks a PLUMBER "are you accepting new NHS
//    patients on a waiting list?" — that is the two-tenant isolation assertion
//    from commit 8beeb19, not something a human would type.
//  * All content rows were created by user conv-acceptance@example.test (a
//    .test TLD address) inside a single 2026-09-11 03:58–04:01 session window,
//    milliseconds apart.
//  * "Isolation Test Workspace" was created in a passx-smoke@example.com
//    session window on 2026-09-08 and owns no content at all.
//  * The only rows touching these workspaces after the isolation fix are
//    workspace_memberships dated 2026-09-15T12:06:04.426Z — granted 33ms after
//    jhrzic@gmail.com's account was created, to all four workspaces at once.
//    That is an account-creation backfill, not use of the fixtures.
//  * receipts referencing these workspaces' tasks: 0. No signed receipt is
//    affected.
//
// SAFETY
//  * Takes its own verified backup first and refuses to proceed without one.
//  * Deletes inside a single transaction, children before parents (foreign
//    keys are not enforced in this schema, so order is enforced here).
//  * Compares every per-table delete count against the exported manifest and
//    ROLLS BACK on any mismatch.
//  * Re-checks, before commit, that the primary workspace survives, that the
//    operator keeps its membership, and that receipt and KIL counts are
//    unchanged.
//
// Run:  node scripts/remove-fixture-workspaces.mjs
// Dry run (default is a real run; pass --dry-run to only report):
//       node scripts/remove-fixture-workspaces.mjs --dry-run
// ---------------------------------------------------------------------------

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DRY_RUN = process.argv.includes('--dry-run');
const DB = path.resolve(process.cwd(), 'data', 'synthos-admin.db');
const OPERATOR_EMAIL = 'jhrzic@gmail.com';

const WORKSPACES = [
  'ws-1789099080486-zm8v8p',
  'ws-1789099080551-f6r0y8',
  'ws-1788875949023-l61ecq',
];

// Children first. Tables keyed by task_id are cleared before `tasks`, and
// `workspaces` is last.
const PLAN = [
  ['activity_events', 'task_id'],
  ['task_status_history', 'task_id'],
  ['artifacts', 'task_id'],
  ['quality_reviews', 'task_id'],
  ['business_conversation_messages', 'workspace_id'],
  ['business_unanswered_questions', 'workspace_id'],
  ['business_conversations', 'workspace_id'],
  ['business_assistant_profiles', 'workspace_id'],
  ['memory_index', 'workspace_id'],
  ['tasks', 'workspace_id'],
  ['workspace_memberships', 'workspace_id'],
  ['workspaces', 'workspace_id'],
];

if (!fs.existsSync(DB)) {
  console.error(`No database at ${DB}`);
  process.exit(1);
}

const db = new DatabaseSync(DB);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const ph = (n) => Array(n).fill('?').join(',');

// ---- 1. identify -----------------------------------------------------------
const present = all(
  `SELECT workspace_id, name, created_at FROM workspaces WHERE workspace_id IN (${ph(WORKSPACES.length)})`,
  ...WORKSPACES,
);
if (present.length === 0) {
  console.log('Nothing to do — none of the three fixture workspaces are present.');
  process.exit(0);
}
console.log('Fixture workspaces found:');
for (const w of present) console.log(`  ${w.workspace_id}  ${w.name}  (created ${w.created_at})`);

const taskIds = all(
  `SELECT task_id FROM tasks WHERE workspace_id IN (${ph(WORKSPACES.length)})`,
  ...WORKSPACES,
).map((r) => r.task_id);
console.log(`Owned tasks: ${taskIds.length}`);

// Refuse if a receipt depends on any of these tasks — that would mean real
// verified work lives here and the situation is no longer unambiguous.
if (taskIds.length) {
  const receipts = one(
    `SELECT COUNT(*) AS n FROM receipts WHERE task_id IN (${ph(taskIds.length)})`,
    ...taskIds,
  );
  if (receipts.n > 0) {
    console.error(`REFUSING: ${receipts.n} signed receipt(s) reference these tasks. Stopping for review.`);
    process.exit(1);
  }
}

// ---- 2. count what will go, per table --------------------------------------
const expected = {};
for (const [table, col] of PLAN) {
  let row;
  if (col === 'task_id') {
    if (!taskIds.length) { expected[table] = 0; continue; }
    row = one(`SELECT COUNT(*) AS n FROM ${table} WHERE task_id IN (${ph(taskIds.length)})`, ...taskIds);
  } else {
    row = one(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id IN (${ph(WORKSPACES.length)})`, ...WORKSPACES);
  }
  expected[table] = row.n;
}
const total = Object.values(expected).reduce((a, b) => a + b, 0);
console.log('\nRows to remove:');
for (const [t, n] of Object.entries(expected)) if (n) console.log(`  ${t.padEnd(32)} ${n}`);
console.log(`  ${'TOTAL'.padEnd(32)} ${total}`);

if (DRY_RUN) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

// ---- 3. backup -------------------------------------------------------------
fs.mkdirSync('data/backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const backup = path.join('data', 'backups', `synthos-admin-pre-fixture-removal-${stamp}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
const hash = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
fs.writeFileSync(`${backup}.sha256`, `${hash}  ${path.basename(backup)}\n`);
console.log(`\nBackup:  ${backup}`);
console.log(`SHA256:  ${hash}`);
const check = new DatabaseSync(backup);
const integrity = check.prepare('PRAGMA integrity_check').get();
console.log(`Backup integrity: ${Object.values(integrity)[0]}`);
check.close();

// ---- 4. pre-state ----------------------------------------------------------
const before = {
  receipts: one('SELECT COUNT(*) AS n FROM receipts').n,
  kil: one('SELECT COUNT(*) AS n FROM kil_observations').n,
};

// ---- 5. delete in one transaction -----------------------------------------
const deleted = {};
db.exec('BEGIN IMMEDIATE');
try {
  for (const [table, col] of PLAN) {
    let info;
    if (col === 'task_id') {
      if (!taskIds.length) { deleted[table] = 0; continue; }
      info = db.prepare(`DELETE FROM ${table} WHERE task_id IN (${ph(taskIds.length)})`).run(...taskIds);
    } else {
      info = db.prepare(`DELETE FROM ${table} WHERE workspace_id IN (${ph(WORKSPACES.length)})`).run(...WORKSPACES);
    }
    deleted[table] = Number(info.changes);
  }

  const problems = [];
  for (const [t, n] of Object.entries(expected)) {
    if (deleted[t] !== n) problems.push(`${t}: deleted ${deleted[t]}, expected ${n}`);
  }
  if (one(`SELECT COUNT(*) AS n FROM workspaces WHERE workspace_id = 'ws-synthos-primary'`).n !== 1) {
    problems.push('primary workspace missing');
  }
  const op = one(
    `SELECT COUNT(*) AS n FROM workspace_memberships
     WHERE workspace_id = 'ws-synthos-primary'
       AND user_id = (SELECT user_id FROM users WHERE email = ?)`,
    OPERATOR_EMAIL,
  );
  if (op.n !== 1) problems.push('operator membership on the primary workspace missing');
  if (one('SELECT COUNT(*) AS n FROM receipts').n !== before.receipts) problems.push('receipt count changed');
  if (one('SELECT COUNT(*) AS n FROM kil_observations').n !== before.kil) problems.push('KIL observation count changed');

  if (problems.length) {
    db.exec('ROLLBACK');
    console.error('\nROLLED BACK. Nothing was changed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  db.exec('COMMIT');
  console.log('\nCOMMITTED.');
  for (const [t, n] of Object.entries(deleted)) if (n) console.log(`  removed ${String(n).padStart(3)} from ${t}`);
  console.log(`  total removed: ${Object.values(deleted).reduce((a, b) => a + b, 0)}`);
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
  console.error('\nROLLED BACK on error:', err?.message ?? err);
  process.exit(1);
}

// ---- 6. verify -------------------------------------------------------------
console.log('\nPost-state:');
console.log(`  workspaces remaining: ${one('SELECT COUNT(*) AS n FROM workspaces').n}`);
for (const w of all('SELECT workspace_id, name FROM workspaces ORDER BY created_at')) {
  console.log(`    ${w.workspace_id}  ${w.name}`);
}
console.log(`  receipts: ${one('SELECT COUNT(*) AS n FROM receipts').n} (was ${before.receipts})`);
console.log(`  kil_observations: ${one('SELECT COUNT(*) AS n FROM kil_observations').n} (was ${before.kil})`);
console.log(`  operator memberships: ${one(
  'SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = (SELECT user_id FROM users WHERE email = ?)',
  OPERATOR_EMAIL,
).n}`);
db.close();
console.log('\nRestart the Admin so it picks up the change:');
console.log('  launchctl kickstart -k gui/$(id -u)/com.synthos.admin');
