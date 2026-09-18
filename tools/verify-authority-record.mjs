#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Verify a SynthOS authority record WITHOUT trusting SynthOS.
//
//   node verify-authority-record.mjs record.json [--key synthos-public.pem]
//
// Zero dependencies (Node 18+). It never contacts a server. It checks:
//   1. every receipt's Ed25519 signature,
//   2. every receipt's digest matches the ledger entry that chained it,
//   3. every ledger entry's hash and link to the one before (nothing deleted,
//      edited or reordered),
//   4. every signed checkpoint (so the tail cannot have been cut off since),
//   5. optionally, that everything was signed by the key you pinned (--key),
//      obtained from SynthOS through a channel other than this file.
// Then it summarises the authority behind the actions.
//
// Exit code 0 = verified, 1 = problems found, 2 = could not read input.
// Keep entryHashOf() byte-identical to lib/authority-ledger.ts.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import fs from 'node:fs';

const GENESIS = '0'.repeat(64);
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const norm = (pem) => String(pem || '').trim().replace(/\r\n/g, '\n');

function entryHashOf(e, version) {
  return sha256(
    [
      `v${version}`, e.workspaceId, String(e.seq), e.receiptId, e.receiptDigest,
      e.approvalId ?? '', e.requestedBy ?? '', e.decidedBy ?? '', e.guardianDecision ?? '', e.inputDigest ?? '',
      e.selfApproved === null || e.selfApproved === undefined ? '' : e.selfApproved ? '1' : '0',
      e.recordedAt, e.prevHash,
    ].join('|'),
  );
}

function verifySig(message, signatureHex, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(message, 'utf8'), publicKeyPem, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * @param {any} bundle
 * @param {string | null} [pinnedKey]
 * @returns {{ ok: boolean, problems: string[], summary?: any }}
 */
export function verifyBundle(bundle, pinnedKey = null) {
  const problems = [];
  if (bundle?.format !== 'synthos-authority-record') return { ok: false, problems: ['not a SynthOS authority record'] };
  const v = bundle.version;
  const receipts = new Map((bundle.receipts || []).map((r) => [r.receiptId, r]));
  const keys = new Set();

  let prev = GENESIS;
  const hashes = new Map();
  (bundle.entries || []).forEach((e, i) => {
    if (e.workspaceId !== bundle.workspaceId) problems.push(`entry ${e.seq}: belongs to another workspace`);
    if (e.seq !== i + 1) problems.push(`entry ${i + 1}: sequence is ${e.seq} (gap or reorder)`);
    if (e.prevHash !== prev) problems.push(`entry ${e.seq}: does not link to the previous entry`);
    if (entryHashOf(e, v) !== e.entryHash) problems.push(`entry ${e.seq}: contents changed after recording`);
    hashes.set(e.seq, e.entryHash);
    prev = e.entryHash;

    const r = receipts.get(e.receiptId);
    if (!r) {
      problems.push(`entry ${e.seq}: receipt ${e.receiptId} is not in the record`);
      return;
    }
    if (r.algorithm !== 'Ed25519') problems.push(`receipt ${r.receiptId}: unsupported algorithm ${r.algorithm}`);
    if (!verifySig(r.payloadJson, r.signature, r.publicKey)) problems.push(`receipt ${r.receiptId}: signature invalid`);
    if (sha256(`${r.payloadJson}\n${r.signature}`) !== e.receiptDigest) problems.push(`receipt ${r.receiptId}: differs from what was chained`);
    keys.add(norm(r.publicKey));
  });

  for (const cp of bundle.checkpoints || []) {
    const msg = `synthos-authority-checkpoint|v${v}|${cp.workspaceId}|${cp.seq}|${cp.headHash}|${cp.signedAt}`;
    if (!verifySig(msg, cp.signature, cp.publicKey)) problems.push(`checkpoint at ${cp.seq}: signature invalid`);
    const h = hashes.get(cp.seq);
    if (!h) problems.push(`checkpoint at ${cp.seq}: the record ends before it (entries were removed)`);
    else if (h !== cp.headHash) problems.push(`checkpoint at ${cp.seq}: chain no longer matches what was signed`);
    keys.add(norm(cp.publicKey));
  }

  if (pinnedKey) {
    for (const k of keys) if (k !== norm(pinnedKey)) problems.push('something was signed by a key other than the one you pinned');
  } else if (keys.size > 1) {
    problems.push('more than one signing key appears in this record');
  }

  const entries = bundle.entries || [];
  const summary = {
    workspace: bundle.workspaceId,
    actions: entries.length,
    withApproval: entries.filter((e) => e.approvalId).length,
    selfApproved: entries.filter((e) => e.selfApproved === true).length,
    noApprovalOnRecord: entries.filter((e) => !e.approvalId).length,
    checkpoints: (bundle.checkpoints || []).length,
    keyPinned: Boolean(pinnedKey),
  };
  return { ok: problems.length === 0, problems: [...new Set(problems)], summary };
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify-authority-record.mjs');
if (isMain) {
  const file = process.argv[2];
  const keyIdx = process.argv.indexOf('--key');
  if (!file) {
    console.error('usage: node verify-authority-record.mjs record.json [--key synthos-public.pem]');
    process.exit(2);
  }
  let bundle, key = null;
  try {
    bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (keyIdx > 0) key = fs.readFileSync(process.argv[keyIdx + 1], 'utf8');
  } catch (e) {
    console.error(`could not read input: ${e.message}`);
    process.exit(2);
  }
  const r = verifyBundle(bundle, key);
  const s = r.summary || {};
  console.log(r.ok ? 'VERIFIED' : 'PROBLEMS FOUND');
  if (r.summary) {
    console.log(`workspace ${s.workspace}: ${s.actions} actions; ${s.withApproval} with a recorded approval (${s.selfApproved} self-approved); ${s.noApprovalOnRecord} with no approval on record; ${s.checkpoints} signed checkpoint(s).`);
    if (!s.keyPinned) console.log('Note: signing key not pinned. Pass --key with the public key you got from SynthOS separately to rule out a substituted key.');
  }
  for (const p of r.problems) console.log(`  - ${p}`);
  process.exit(r.ok ? 0 : 1);
}
