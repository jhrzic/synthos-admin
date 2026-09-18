import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// REVOKED RECEIPT-SIGNING KEYS. Synthetic keys only — the real revoked key's
// private half is never read or reproduced here.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-revoke-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'revoke.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { REVOKED_RECEIPT_SIGNING_KEYS, receiptKeyFingerprint, revokedReceiptKey, revokeReceiptKeyForTest, signReceiptPayload, verifyReceipt, getSigningPublicKey, type RevokedSigningKey } from '../lib/persistence';

const synthetic = () => crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const entry = (fingerprint: string): RevokedSigningKey => ({ fingerprint, algorithm: 'Ed25519', status: 'REVOKED', reason: 'synthetic test key', discoveredAt: '2026-09-18', affectedCommits: [], scope: 'test' });

describe('revoked receipt-signing keys', () => {
  it('the registry holds only public fingerprints for the key exposed in public Git history', () => {
    expect(REVOKED_RECEIPT_SIGNING_KEYS).toHaveLength(1);
    const k = REVOKED_RECEIPT_SIGNING_KEYS[0];
    expect(k).toMatchObject({ fingerprint: 'sha256:7adbc0bb09b99bf93ad57a4ee29069592824ebdc56b1cdc3a4f0e169832cd6ab', status: 'REVOKED', algorithm: 'Ed25519', discoveredAt: '2026-09-18', affectedCommits: ['0e09586', 'e2fd065', '7b07203'] });
    expect(JSON.stringify(REVOKED_RECEIPT_SIGNING_KEYS)).not.toMatch(/PRIVATE KEY|BEGIN/);
    expect(Object.isFrozen(REVOKED_RECEIPT_SIGNING_KEYS)).toBe(true);
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/persistence.ts'), 'utf8');
    expect(src).not.toMatch(/-----BEGIN (?:ED25519 )?PRIVATE KEY-----\n[A-Za-z0-9+/]/);
  });

  it('fingerprints are SHA-256 of the SPKI DER encoding and ignore PEM formatting', () => {
    const { publicKey } = synthetic();
    const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
    const fp = `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
    expect(receiptKeyFingerprint(publicKey)).toBe(fp);
    expect(receiptKeyFingerprint(publicKey.replace(/\n/g, '\r\n'))).toBe(fp);
    expect(receiptKeyFingerprint('not a key')).toBeNull();
    expect(revokedReceiptKey(publicKey)).toBeNull();
  });

  it('a valid receipt stops verifying once its signing key is revoked, and the revoked key cannot sign', () => {
    const payload = JSON.stringify({ n: 1 });
    const signed = signReceiptPayload(payload);
    const receipt = { algorithm: 'Ed25519', payload_json: payload, signature: signed.signature, public_key: signed.publicKeyPem };
    expect(verifyReceipt(receipt)).toBe(true);
    revokeReceiptKeyForTest(entry(receiptKeyFingerprint(getSigningPublicKey().publicKeyPem)!));
    // Same bytes, mathematically valid signature, matching public key: rejected.
    expect(crypto.verify(null, Buffer.from(payload), signed.publicKeyPem, Buffer.from(signed.signature, 'hex'))).toBe(true);
    expect(verifyReceipt(receipt)).toBe(false);
    expect(() => signReceiptPayload(payload)).toThrow(/REVOKED/);
  });

  it('a receipt carrying a revoked key is rejected even when it names that key and the signature is valid', () => {
    const k = synthetic();
    revokeReceiptKeyForTest(entry(receiptKeyFingerprint(k.publicKey)!));
    const payload = '{"x":2}';
    const sig = crypto.sign(null, Buffer.from(payload), k.privateKey).toString('hex');
    expect(verifyReceipt({ algorithm: 'Ed25519', payload_json: payload, signature: sig, public_key: k.publicKey })).toBe(false);
  });

  it('the test hook is refused outside the test runner', () => {
    const saved = process.env.VITEST;
    delete process.env.VITEST;
    try { expect(() => revokeReceiptKeyForTest(entry('sha256:00'))).toThrow(/only available under the test runner/); } finally { process.env.VITEST = saved; }
  });
});
