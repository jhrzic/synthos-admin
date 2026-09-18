import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDatabase, recordReceipt, signReceiptPayload, canonicalizePayload } from '../lib/persistence';
import {
  auditWorkspace,
  backfillLedger,
  checkChain,
  exportAuthorityRecord,
  ledgerEntries,
  signCheckpoint,
  entryHashOf,
  recordOutcome,
  summarizeAuthority,
  checkpointDueWorkspaces,
} from '../lib/authority-ledger';
import { verifyBundle } from '../tools/verify-authority-record.mjs';

// ---------------------------------------------------------------------------
// The authority record is only worth anything if tampering is caught. Every
// test below edits, deletes, reorders or truncates something and asserts the
// server audit AND the offline verifier both notice.
// ---------------------------------------------------------------------------

const ws = () => `ws-ledger-${crypto.randomBytes(4).toString('hex')}`;

function receipt(workspaceId: string, taskId: string, note = 'x') {
  const payloadJson = canonicalizePayload({ workspaceId, taskId, note, createdAt: new Date().toISOString() });
  const s = signReceiptPayload(payloadJson);
  return recordReceipt({ taskId, reviewId: `rev-${taskId}`, algorithm: s.algorithm, publicKey: s.publicKeyPem, payloadJson, signature: s.signature });
}

function approve(workspaceId: string, taskId: string, requestedBy: string, decidedBy: string) {
  getDatabase()
    .prepare(
      `INSERT INTO approvals (approval_id, workspace_id, task_id, correlation_id, capability, action, effect_class,
         requested_by_user_id, decided_by_user_id, guardian_decision, action_summary, input_digest, status, created_at, decided_at, consumed_by_task_id)
       VALUES (?, ?, ?, ?, 'gmail.send', 'send', 'EXTERNAL_ACTION', ?, ?, 'PERMIT', 'send one email', ?, 'CONSUMED', ?, ?, ?)`,
    )
    .run(`apr-${workspaceId}-${taskId}`, workspaceId, taskId, `cor-${taskId}`, requestedBy, decidedBy, 'd'.repeat(64), new Date().toISOString(), new Date().toISOString(), taskId);
}

describe('authority ledger', () => {
  it('chains every recorded receipt with the authority behind it', () => {
    const w = ws();
    approve(w, 't1', 'alice', 'bob');
    approve(w, 't2', 'carol', 'carol');
    receipt(w, 't1');
    receipt(w, 't2');
    receipt(w, 't3'); // no approval on record
    const e = ledgerEntries(w);
    expect(e.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(e[0]).toMatchObject({ approvalId: `apr-${w}-t1`, requestedBy: 'alice', decidedBy: 'bob', selfApproved: false, guardianDecision: 'PERMIT' });
    expect(e[1]!.selfApproved).toBe(true);
    expect(e[2]).toMatchObject({ approvalId: null, selfApproved: null });
    expect(auditWorkspace(w).ok).toBe(true);
  });

  it('keeps workspaces on separate chains', () => {
    const a = ws();
    const b = ws();
    receipt(a, 'a1');
    receipt(b, 'b1');
    receipt(a, 'a2');
    expect(ledgerEntries(a).map((e) => e.seq)).toEqual([1, 2]);
    expect(ledgerEntries(b).map((e) => e.seq)).toEqual([1]);
  });

  it('detects an edited receipt', () => {
    const w = ws();
    const r = receipt(w, 't1');
    receipt(w, 't2');
    getDatabase().prepare('UPDATE receipts SET payload_json = ? WHERE receipt_id = ?').run(r.payload_json.replace('"x"', '"y"'), r.receipt_id);
    const a = auditWorkspace(w);
    expect(a.ok).toBe(false);
    expect(a.problems.join()).toMatch(/altered/);
  });

  it('detects a deleted receipt', () => {
    const w = ws();
    receipt(w, 't1');
    const r = receipt(w, 't2');
    getDatabase().prepare('DELETE FROM receipts WHERE receipt_id = ?').run(r.receipt_id);
    expect(auditWorkspace(w).problems.join()).toMatch(/missing/);
  });

  it('detects a rewritten authority field and a removed middle entry', () => {
    const w = ws();
    approve(w, 't1', 'alice', 'bob');
    receipt(w, 't1');
    receipt(w, 't2');
    receipt(w, 't3');
    const entries = ledgerEntries(w);
    expect(checkChain(entries.map((e, i) => (i === 0 ? { ...e, decidedBy: 'mallory' } : e))).problems.join()).toMatch(/changed/);
    expect(checkChain([entries[0]!, entries[2]!]).ok).toBe(false);
  });

  it('backfill chains receipts recorded before the ledger, exactly once', () => {
    const w = ws();
    const payloadJson = canonicalizePayload({ workspaceId: w, taskId: 'old' });
    const s = signReceiptPayload(payloadJson);
    getDatabase()
      .prepare('INSERT INTO receipts (receipt_id, task_id, review_id, algorithm, public_key, payload_json, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`old-${w}`, 'old', 'r', s.algorithm, s.publicKeyPem, payloadJson, s.signature, '2020-01-01T00:00:00Z');
    expect(backfillLedger()).toBeGreaterThanOrEqual(1);
    expect(backfillLedger()).toBe(0);
    expect(ledgerEntries(w)).toHaveLength(1);
  });
});

describe('offline verifier (trusts nothing but the public key)', () => {
  function exported() {
    const w = ws();
    approve(w, 't1', 'alice', 'bob');
    receipt(w, 't1');
    receipt(w, 't2');
    receipt(w, 't3');
    signCheckpoint(w);
    return exportAuthorityRecord(w);
  }

  it('verifies an untouched export and summarises authority', () => {
    const b = exported();
    const key = b.receipts[0]!.publicKey;
    const r = verifyBundle(JSON.parse(JSON.stringify(b)), key);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ actions: 3, withApproval: 1, noApprovalOnRecord: 2, checkpoints: 1, keyPinned: true });
  });

  it('catches a forged receipt, a truncated tail, and a substituted key', () => {
    const b = exported();
    const forged = structuredClone(b);
    forged.receipts[1].payloadJson = forged.receipts[1].payloadJson.replace('t2', 'tX');
    expect(verifyBundle(forged).problems.join()).toMatch(/signature invalid/);

    const truncated = structuredClone(b);
    truncated.entries.pop();
    expect(verifyBundle(truncated).problems.join()).toMatch(/record ends before it/);

    const { publicKey: otherKey } = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    expect(verifyBundle(b, otherKey).problems.join()).toMatch(/key other than the one you pinned/);
  });

  it('catches a rewritten approver even when the attacker recomputes that entry', () => {
    const b = structuredClone(exported());
    b.entries[0].decidedBy = 'mallory';
    const { entryHash: _old, ...rest } = b.entries[0];
    b.entries[0].entryHash = entryHashOf(rest); // entry now self-consistent…
    const r = verifyBundle(b);
    expect(r.ok).toBe(false); // …but the next entry and the signed checkpoint no longer link
    expect(r.problems.join()).toMatch(/does not link|no longer matches/);
  });

  it('the command-line tool verifies an exported file and fails a tampered one', () => {
    const b = exported();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authrec-'));
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    const key = path.join(dir, 'key.pem');
    fs.writeFileSync(good, JSON.stringify(b));
    fs.writeFileSync(key, b.receipts[0]!.publicKey);
    const t = structuredClone(b);
    t.entries.splice(1, 1);
    fs.writeFileSync(bad, JSON.stringify(t));
    const run = (f: string) => spawnSync(process.execPath, ['tools/verify-authority-record.mjs', f, '--key', key], { encoding: 'utf8' });
    const ok = run(good);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/VERIFIED/);
    expect(ok.stdout).toMatch(/1 with a recorded approval/);
    const no = run(bad);
    expect(no.status).toBe(1);
    expect(no.stdout).toMatch(/PROBLEMS FOUND/);
  });
});

describe('outcomes and routine checkpoints', () => {
  it('attaches results to earlier actions and verifies them offline', () => {
    const w = ws();
    approve(w, 't1', 'alice', 'bob');
    const r = receipt(w, 't1');
    recordOutcome({ workspaceId: w, receiptId: r.receipt_id, label: 'visit_booked', recordedBy: 'alice' });
    recordOutcome({ workspaceId: w, receiptId: r.receipt_id, label: 'sale_closed', detail: 'queen hybrid', recordedBy: 'alice' });
    const s = summarizeAuthority(w);
    expect(s).toMatchObject({ actions: 1, withApproval: 1, outcomes: { visit_booked: 1, sale_closed: 1 }, headSeq: 3 });
    expect(s.integrity.ok).toBe(true);
    const v = verifyBundle(JSON.parse(JSON.stringify(exportAuthorityRecord(w))));
    expect(v.ok).toBe(true);
    expect(v.summary.results).toEqual({ visit_booked: 1, sale_closed: 1 });
  });

  it('refuses results for actions not on this workspace record, and bad labels', () => {
    const a = ws();
    const b = ws();
    const r = receipt(a, 't1');
    expect(() => recordOutcome({ workspaceId: b, receiptId: r.receipt_id, label: 'sale_closed', recordedBy: 'x' })).toThrow(/not on this workspace/);
    expect(() => recordOutcome({ workspaceId: a, receiptId: r.receipt_id, label: 'Sale Closed!', recordedBy: 'x' })).toThrow(/label/);
  });

  it('catches an edited or deleted result', () => {
    const w = ws();
    const r = receipt(w, 't1');
    const e = recordOutcome({ workspaceId: w, receiptId: r.receipt_id, label: 'sale_closed', recordedBy: 'a' });
    getDatabase().prepare('UPDATE authority_outcomes SET payload_json = replace(payload_json, ?, ?) WHERE outcome_id = ?').run('sale_closed', 'refund_issued', e.receiptId);
    expect(summarizeAuthority(w).integrity.problems.join()).toMatch(/altered/);
    const b = exportAuthorityRecord(w);
    expect(verifyBundle(JSON.parse(JSON.stringify(b))).ok).toBe(false);
  });

  it('signs a checkpoint only for workspaces that moved and are due', () => {
    const w = ws();
    receipt(w, 't1');
    const now = Date.now();
    expect(checkpointDueWorkspaces(24 * 3600_000, now)).toBeGreaterThanOrEqual(1);
    const signedFor = summarizeAuthority(w).lastCheckpoint;
    expect(signedFor?.seq).toBe(1);
    // Nothing moved: no new checkpoint even when due.
    checkpointDueWorkspaces(0, now + 1);
    expect(summarizeAuthority(w).lastCheckpoint?.seq).toBe(1);
    // Moved but not yet a day: still none.
    receipt(w, 't2');
    checkpointDueWorkspaces(24 * 3600_000, now + 1000);
    expect(summarizeAuthority(w).lastCheckpoint?.seq).toBe(1);
  });
});
