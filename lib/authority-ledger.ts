// ---------------------------------------------------------------------------
// Authority Ledger — the record that is the moat.
//
// A signed receipt proves ONE action happened. On its own it cannot prove:
//   1. who authorized it,
//   2. that nothing was deleted, reordered or edited around it,
//   3. anything, to someone who does not trust this server.
//
// This module closes those three gaps without changing the signed receipt
// format (old receipts stay valid):
//   - Every recorded receipt is appended to a per-workspace hash chain. Each
//     entry binds the receipt's digest to the authority behind it (approval,
//     requester, decider, Guardian verdict, bound input digest) and to the
//     previous entry's hash. Deleting, editing or reordering any receipt breaks
//     the chain from that point on.
//   - The chain head can be signed as a checkpoint with the same Ed25519 key.
//     A checkpoint the customer holds makes truncation of the tail detectable.
//   - exportAuthorityRecord() produces a self-contained bundle that
//     tools/verify-authority-record.mjs verifies offline, trusting nothing but
//     the public key.
//
// Honesty rules:
//   - Authority is looked up, never inferred. No approval row → authority is
//     recorded as null ("no approval on record"), not as "system".
//   - self_approved is a fact from two columns, not a judgement.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase, signReceiptPayload } from './persistence';

export const LEDGER_VERSION = 1;
export const GENESIS_HASH = '0'.repeat(64);

export interface LedgerAuthority {
  approvalId: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  guardianDecision: string | null;
  inputDigest: string | null;
  selfApproved: boolean | null;
}

export type EntryKind = 'RECEIPT' | 'OUTCOME';

export interface LedgerEntry extends LedgerAuthority {
  /** RECEIPT: an action's signed receipt. OUTCOME: a later result attached to an earlier receipt. */
  kind?: EntryKind;
  /** OUTCOME only: the receipt this result belongs to. */
  subjectReceiptId?: string | null;
  /** OUTCOME only: short result label, e.g. "visit_booked", "sale_closed". */
  outcomeLabel?: string | null;
  workspaceId: string;
  seq: number;
  receiptId: string;
  receiptDigest: string;
  prevHash: string;
  entryHash: string;
  recordedAt: string;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** What a receipt's digest covers: the exact signed bytes plus the signature. */
export function receiptDigest(payloadJson: string, signature: string): string {
  return sha256(`${payloadJson}\n${signature}`);
}

/** Pure. The exact bytes an entry hash covers; the offline verifier re-implements this. */
export function entryHashOf(e: Omit<LedgerEntry, 'entryHash'>): string {
  const fields = [
    `v${LEDGER_VERSION}`,
    e.workspaceId,
    String(e.seq),
    e.receiptId,
    e.receiptDigest,
    e.approvalId ?? '',
    e.requestedBy ?? '',
    e.decidedBy ?? '',
    e.guardianDecision ?? '',
    e.inputDigest ?? '',
    e.selfApproved === null ? '' : e.selfApproved ? '1' : '0',
    e.recordedAt,
    e.prevHash,
  ];
  // Receipt entries hash exactly as in v1. Outcome entries also bind what they refer to.
  if (e.kind === 'OUTCOME') fields.push('OUTCOME', e.subjectReceiptId ?? '', e.outcomeLabel ?? '');
  return sha256(fields.join('|'));
}

let ensured = false;
export function ensureLedgerTables(): void {
  if (ensured) return;
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS authority_ledger (
      workspace_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      receipt_id TEXT NOT NULL UNIQUE,
      receipt_digest TEXT NOT NULL,
      approval_id TEXT,
      requested_by TEXT,
      decided_by TEXT,
      guardian_decision TEXT,
      input_digest TEXT,
      self_approved INTEGER,
      recorded_at TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL,
      PRIMARY KEY (workspace_id, seq)
    );
    CREATE TABLE IF NOT EXISTS authority_checkpoints (
      workspace_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      head_hash TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      public_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      signature TEXT NOT NULL,
      PRIMARY KEY (workspace_id, seq)
    );
    CREATE TABLE IF NOT EXISTS authority_outcomes (
      outcome_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  // Columns added after the first release of this table; ALTER is a no-op error if present.
  for (const col of [
    "ALTER TABLE authority_ledger ADD COLUMN kind TEXT NOT NULL DEFAULT 'RECEIPT'",
    'ALTER TABLE authority_ledger ADD COLUMN subject_receipt_id TEXT',
    'ALTER TABLE authority_ledger ADD COLUMN outcome_label TEXT',
  ]) {
    try {
      getDatabase().exec(col);
    } catch {
      /* column already exists */
    }
  }
  ensured = true;
}

/** Authority behind a task: the approval it consumed, looked up — never inferred. */
function authorityFor(taskId: string | null | undefined, workspaceId: string): LedgerAuthority {
  const none: LedgerAuthority = {
    approvalId: null, requestedBy: null, decidedBy: null, guardianDecision: null, inputDigest: null, selfApproved: null,
  };
  if (!taskId) return none;
  let row: any;
  try {
    row = getDatabase()
      .prepare(
        `SELECT approval_id, requested_by_user_id, decided_by_user_id, guardian_decision, input_digest
           FROM approvals
          WHERE workspace_id = ? AND (consumed_by_task_id = ? OR task_id = ?) AND status IN ('APPROVED','CONSUMED')
          ORDER BY decided_at DESC LIMIT 1`,
      )
      .get(workspaceId, taskId, taskId);
  } catch {
    return none; // approvals table absent in minimal test databases
  }
  if (!row) return none;
  return {
    approvalId: row.approval_id,
    requestedBy: row.requested_by_user_id ?? null,
    decidedBy: row.decided_by_user_id ?? null,
    guardianDecision: row.guardian_decision ?? null,
    inputDigest: row.input_digest ?? null,
    selfApproved: row.decided_by_user_id ? row.decided_by_user_id === row.requested_by_user_id : null,
  };
}

function workspaceOf(payloadJson: string): string {
  try {
    const w = JSON.parse(payloadJson)?.workspaceId;
    return typeof w === 'string' && w ? w : 'unscoped';
  } catch {
    return 'unscoped';
  }
}

function rowToEntry(r: any): LedgerEntry {
  const kind: EntryKind = r.kind === 'OUTCOME' ? 'OUTCOME' : 'RECEIPT';
  return {
    ...(kind === 'OUTCOME' ? { kind, subjectReceiptId: r.subject_receipt_id, outcomeLabel: r.outcome_label } : {}),
    workspaceId: r.workspace_id,
    seq: r.seq,
    receiptId: r.receipt_id,
    receiptDigest: r.receipt_digest,
    approvalId: r.approval_id,
    requestedBy: r.requested_by,
    decidedBy: r.decided_by,
    guardianDecision: r.guardian_decision,
    inputDigest: r.input_digest,
    selfApproved: r.self_approved === null || r.self_approved === undefined ? null : r.self_approved === 1,
    recordedAt: r.recorded_at,
    prevHash: r.prev_hash,
    entryHash: r.entry_hash,
  };
}

function insertEntry(entry: LedgerEntry): void {
  getDatabase()
    .prepare(
      `INSERT INTO authority_ledger (workspace_id, seq, receipt_id, receipt_digest, approval_id, requested_by, decided_by,
         guardian_decision, input_digest, self_approved, recorded_at, prev_hash, entry_hash, kind, subject_receipt_id, outcome_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.workspaceId, entry.seq, entry.receiptId, entry.receiptDigest, entry.approvalId, entry.requestedBy,
      entry.decidedBy, entry.guardianDecision, entry.inputDigest,
      entry.selfApproved === null ? null : entry.selfApproved ? 1 : 0,
      entry.recordedAt, entry.prevHash, entry.entryHash,
      entry.kind ?? 'RECEIPT', entry.subjectReceiptId ?? null, entry.outcomeLabel ?? null,
    );
}

/**
 * Append one receipt to its workspace chain. Idempotent per receipt. Runs in a
 * SAVEPOINT so it composes with any transaction the caller is already in.
 */
export function appendReceiptToLedger(receipt: {
  receiptId: string;
  taskId?: string | null;
  payloadJson: string;
  signature: string;
  recordedAt?: string;
}): LedgerEntry {
  ensureLedgerTables();
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM authority_ledger WHERE receipt_id = ?').get(receipt.receiptId);
  if (existing) return rowToEntry(existing);

  const workspaceId = workspaceOf(receipt.payloadJson);
  db.exec('SAVEPOINT authority_append');
  try {
    const head: any = db
      .prepare('SELECT seq, entry_hash FROM authority_ledger WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1')
      .get(workspaceId);
    const base: Omit<LedgerEntry, 'entryHash'> = {
      workspaceId,
      seq: head ? head.seq + 1 : 1,
      receiptId: receipt.receiptId,
      receiptDigest: receiptDigest(receipt.payloadJson, receipt.signature),
      ...authorityFor(receipt.taskId, workspaceId),
      recordedAt: receipt.recordedAt || new Date().toISOString(),
      prevHash: head ? head.entry_hash : GENESIS_HASH,
    };
    const entry: LedgerEntry = { ...base, entryHash: entryHashOf(base) };
    insertEntry(entry);
    db.exec('RELEASE authority_append');
    return entry;
  } catch (err) {
    db.exec('ROLLBACK TO authority_append');
    db.exec('RELEASE authority_append');
    throw err;
  }
}

export const OUTCOME_LABEL = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Attach a later result to an earlier action ("visit_booked", "sale_closed",
 * "email_replied", "refund_issued"…). Appended as its own chained entry, so
 * results can be added but never silently rewritten or removed.
 */
export function recordOutcome(params: {
  workspaceId: string;
  receiptId: string;
  label: string;
  detail?: string;
  recordedBy: string;
  at?: string;
}): LedgerEntry {
  ensureLedgerTables();
  if (!OUTCOME_LABEL.test(params.label)) throw new Error('Outcome label must be lower_snake_case, 2–40 characters.');
  const db = getDatabase();
  const subject: any = db
    .prepare("SELECT seq FROM authority_ledger WHERE workspace_id = ? AND receipt_id = ? AND kind = 'RECEIPT'")
    .get(params.workspaceId, params.receiptId);
  if (!subject) throw new Error('That action is not on this workspace\'s record.');
  const at = params.at || new Date().toISOString();
  const outcomeId = `out-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const payloadJson = JSON.stringify({
    outcomeId, receiptId: params.receiptId, label: params.label,
    detail: (params.detail || '').slice(0, 500), recordedBy: params.recordedBy, at,
  });
  db.exec('SAVEPOINT authority_outcome');
  try {
    db.prepare('INSERT INTO authority_outcomes (outcome_id, workspace_id, receipt_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(outcomeId, params.workspaceId, params.receiptId, payloadJson, at);
    const head: any = db
      .prepare('SELECT seq, entry_hash FROM authority_ledger WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1')
      .get(params.workspaceId);
    const base: Omit<LedgerEntry, 'entryHash'> = {
      kind: 'OUTCOME',
      subjectReceiptId: params.receiptId,
      outcomeLabel: params.label,
      workspaceId: params.workspaceId,
      seq: head.seq + 1,
      receiptId: outcomeId,
      receiptDigest: sha256(payloadJson),
      approvalId: null, requestedBy: params.recordedBy, decidedBy: null, guardianDecision: null, inputDigest: null, selfApproved: null,
      recordedAt: at,
      prevHash: head.entry_hash,
    };
    const entry: LedgerEntry = { ...base, entryHash: entryHashOf(base) };
    insertEntry(entry);
    db.exec('RELEASE authority_outcome');
    return entry;
  } catch (err) {
    db.exec('ROLLBACK TO authority_outcome');
    db.exec('RELEASE authority_outcome');
    throw err;
  }
}

/** Chain receipts recorded before the ledger existed, oldest first. Returns how many were added. */
export function backfillLedger(): number {
  ensureLedgerTables();
  const rows: any[] = getDatabase()
    .prepare(
      `SELECT r.receipt_id, r.task_id, r.payload_json, r.signature, r.created_at
         FROM receipts r LEFT JOIN authority_ledger l ON l.receipt_id = r.receipt_id
        WHERE l.receipt_id IS NULL ORDER BY r.created_at ASC, r.receipt_id ASC`,
    )
    .all();
  for (const r of rows) {
    appendReceiptToLedger({ receiptId: r.receipt_id, taskId: r.task_id, payloadJson: r.payload_json, signature: r.signature, recordedAt: r.created_at });
  }
  return rows.length;
}

export function ledgerEntries(workspaceId: string): LedgerEntry[] {
  ensureLedgerTables();
  return getDatabase()
    .prepare('SELECT * FROM authority_ledger WHERE workspace_id = ? ORDER BY seq ASC')
    .all(workspaceId)
    .map(rowToEntry);
}

export interface Checkpoint {
  workspaceId: string;
  seq: number;
  headHash: string;
  signedAt: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  signature: string;
}

export const checkpointMessage = (workspaceId: string, seq: number, headHash: string, signedAt: string) =>
  `synthos-authority-checkpoint|v${LEDGER_VERSION}|${workspaceId}|${seq}|${headHash}|${signedAt}`;

/** Sign the current chain head. Give the result to the customer: it pins the tail. */
export function signCheckpoint(workspaceId: string): Checkpoint | null {
  ensureLedgerTables();
  const db = getDatabase();
  const head: any = db
    .prepare('SELECT seq, entry_hash FROM authority_ledger WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1')
    .get(workspaceId);
  if (!head) return null;
  const signedAt = new Date().toISOString();
  const s = signReceiptPayload(checkpointMessage(workspaceId, head.seq, head.entry_hash, signedAt));
  const cp: Checkpoint = {
    workspaceId, seq: head.seq, headHash: head.entry_hash, signedAt,
    algorithm: s.algorithm, publicKey: s.publicKeyPem, fingerprint: s.fingerprint, signature: s.signature,
  };
  db.prepare(
    `INSERT OR REPLACE INTO authority_checkpoints (workspace_id, seq, head_hash, signed_at, algorithm, public_key, fingerprint, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(cp.workspaceId, cp.seq, cp.headHash, cp.signedAt, cp.algorithm, cp.publicKey, cp.fingerprint, cp.signature);
  return cp;
}

export interface ChainCheck {
  ok: boolean;
  entries: number;
  problems: string[];
}

/** Pure: re-derive every hash and link. Shared logic with the offline verifier. */
export function checkChain(entries: LedgerEntry[]): ChainCheck {
  const problems: string[] = [];
  let prev = GENESIS_HASH;
  entries.forEach((e, i) => {
    if (e.seq !== i + 1) problems.push(`entry ${i + 1}: sequence is ${e.seq} (gap or reorder)`);
    if (e.prevHash !== prev) problems.push(`entry ${e.seq}: does not link to the previous entry`);
    const { entryHash, ...rest } = e;
    if (entryHashOf(rest) !== entryHash) problems.push(`entry ${e.seq}: contents changed after recording`);
    prev = entryHash;
  });
  return { ok: problems.length === 0, entries: entries.length, problems };
}

/** Server-side audit: chain integrity plus receipts that were deleted or edited after chaining. */
export function auditWorkspace(workspaceId: string): ChainCheck {
  const entries = ledgerEntries(workspaceId);
  const result = checkChain(entries);
  const db = getDatabase();
  for (const e of entries) {
    if (e.kind === 'OUTCOME') {
      const o: any = db.prepare('SELECT payload_json FROM authority_outcomes WHERE outcome_id = ?').get(e.receiptId);
      if (!o) result.problems.push(`entry ${e.seq}: result ${e.receiptId} is missing`);
      else if (sha256(o.payload_json) !== e.receiptDigest) result.problems.push(`entry ${e.seq}: result ${e.receiptId} was altered`);
      continue;
    }
    const r: any = db.prepare('SELECT payload_json, signature FROM receipts WHERE receipt_id = ?').get(e.receiptId);
    if (!r) result.problems.push(`entry ${e.seq}: receipt ${e.receiptId} is missing`);
    else if (receiptDigest(r.payload_json, r.signature) !== e.receiptDigest)
      result.problems.push(`entry ${e.seq}: receipt ${e.receiptId} was altered`);
  }
  result.ok = result.problems.length === 0;
  return result;
}

export interface AuthorityRecordBundle {
  format: 'synthos-authority-record';
  version: number;
  workspaceId: string;
  exportedAt: string;
  entries: LedgerEntry[];
  receipts: { receiptId: string; algorithm: string; publicKey: string; payloadJson: string; signature: string }[];
  outcomes: { outcomeId: string; payloadJson: string }[];
  checkpoints: Checkpoint[];
}

/** Everything needed to verify this workspace's record without this server. */
export function exportAuthorityRecord(workspaceId: string): AuthorityRecordBundle {
  const entries = ledgerEntries(workspaceId);
  const db = getDatabase();
  const receipts = entries
    .filter((e) => e.kind !== 'OUTCOME')
    .map((e) => db.prepare('SELECT receipt_id, algorithm, public_key, payload_json, signature FROM receipts WHERE receipt_id = ?').get(e.receiptId))
    .filter(Boolean)
    .map((r: any) => ({ receiptId: r.receipt_id, algorithm: r.algorithm, publicKey: r.public_key, payloadJson: r.payload_json, signature: r.signature }));
  const checkpoints: Checkpoint[] = db
    .prepare('SELECT * FROM authority_checkpoints WHERE workspace_id = ? ORDER BY seq ASC')
    .all(workspaceId)
    .map((c: any) => ({
      workspaceId: c.workspace_id, seq: c.seq, headHash: c.head_hash, signedAt: c.signed_at,
      algorithm: c.algorithm, publicKey: c.public_key, fingerprint: c.fingerprint, signature: c.signature,
    }));
  const outcomes = entries
    .filter((e) => e.kind === 'OUTCOME')
    .map((e) => db.prepare('SELECT outcome_id, payload_json FROM authority_outcomes WHERE outcome_id = ?').get(e.receiptId))
    .filter(Boolean)
    .map((o: any) => ({ outcomeId: o.outcome_id, payloadJson: o.payload_json }));
  return { format: 'synthos-authority-record', version: LEDGER_VERSION, workspaceId, exportedAt: new Date().toISOString(), entries, receipts, outcomes, checkpoints };
}

export interface AuthoritySummary {
  workspaceId: string;
  actions: number;
  withApproval: number;
  selfApproved: number;
  noApprovalOnRecord: number;
  outcomes: Record<string, number>;
  lastCheckpoint: { seq: number; signedAt: string } | null;
  headSeq: number;
  integrity: ChainCheck;
}

/** Everything the Admin panel shows, computed from the ledger itself. */
export function summarizeAuthority(workspaceId: string): AuthoritySummary {
  const entries = ledgerEntries(workspaceId);
  const actions = entries.filter((e) => e.kind !== 'OUTCOME');
  const outcomes: Record<string, number> = {};
  for (const e of entries) if (e.kind === 'OUTCOME' && e.outcomeLabel) outcomes[e.outcomeLabel] = (outcomes[e.outcomeLabel] ?? 0) + 1;
  const cp: any = getDatabase()
    .prepare('SELECT seq, signed_at FROM authority_checkpoints WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1')
    .get(workspaceId);
  return {
    workspaceId,
    actions: actions.length,
    withApproval: actions.filter((e) => e.approvalId).length,
    selfApproved: actions.filter((e) => e.selfApproved === true).length,
    noApprovalOnRecord: actions.filter((e) => !e.approvalId).length,
    outcomes,
    lastCheckpoint: cp ? { seq: cp.seq, signedAt: cp.signed_at } : null,
    headSeq: entries.length ? entries[entries.length - 1]!.seq : 0,
    integrity: auditWorkspace(workspaceId),
  };
}

/**
 * Sign a checkpoint for every workspace whose chain moved since its last
 * checkpoint and whose last checkpoint is older than `minAgeMs`. Returns how
 * many were signed. Driven by startAuthorityCheckpointTimer().
 */
export function checkpointDueWorkspaces(minAgeMs = 24 * 3600_000, now = Date.now()): number {
  ensureLedgerTables();
  const rows: any[] = getDatabase()
    .prepare(
      `SELECT l.workspace_id AS w, MAX(l.seq) AS head,
              (SELECT MAX(seq) FROM authority_checkpoints c WHERE c.workspace_id = l.workspace_id) AS cp_seq,
              (SELECT MAX(signed_at) FROM authority_checkpoints c WHERE c.workspace_id = l.workspace_id) AS cp_at
         FROM authority_ledger l GROUP BY l.workspace_id`,
    )
    .all();
  let n = 0;
  for (const r of rows) {
    const moved = r.cp_seq === null || r.head > r.cp_seq;
    const old = r.cp_at === null || now - Date.parse(r.cp_at) >= minAgeMs;
    if (moved && old && signCheckpoint(r.w)) n++;
  }
  return n;
}

let lastSweepAt = 0;
/**
 * Driven by the ONE scheduler timer (lib/fabric/scheduler.ts), not a timer of
 * its own. Local database work only — no outbound connection. Throttled to
 * one sweep an hour; each workspace still gets at most one checkpoint a day.
 */
export function authorityTickForScheduler(now = Date.now()): number {
  if (now - lastSweepAt < 3600_000) return 0;
  lastSweepAt = now;
  backfillLedger();
  return checkpointDueWorkspaces(24 * 3600_000, now);
}
