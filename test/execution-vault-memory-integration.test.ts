import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-integ-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createInitialTask,
  recordArtifact,
  recordQualityReview,
  recordReceipt,
  canonicalizePayload,
  signReceiptPayload,
  verifyReceipt,
  CanonicalReceiptPayload,
} from '../lib/persistence';
import { listWorkspaceVaultEntries, getWorkspaceVaultEntry, VAULT_ROOT } from '../lib/vault';
import { indexVaultArtifact, searchWorkspaceMemory } from '../lib/memory-index';

// ---------------------------------------------------------------------------
// Required end-to-end integration test:
//   Workspace A -> real task -> verified artifact -> Vault -> Memory indexed
//   -> search finds it -> receipt still valid.
//
// Service-level (no live GEMINI_API_KEY in this environment), so this drives
// the exact same functions the real /api/execute-agent-task route drives
// after a model call succeeds: recordArtifact, recordQualityReview,
// canonicalizePayload/signReceiptPayload/recordReceipt (the real Ed25519
// signing path), then indexVaultArtifact (the hook added this turn) and
// searchWorkspaceMemory. Nothing here is mocked — this is the real SQLite
// database, the real filesystem write/read, and the real crypto.
// ---------------------------------------------------------------------------

const WORKSPACE_A = 'ws-integration-a';
const WORKSPACE_B = 'ws-integration-b';
const UNIQUE_MARKER = `synthosintegmarker${Date.now()}`;
const RELATIVE_PATH = `Integration-Test-Runs/integ-${Date.now()}.md`;
const DISK_PATH = path.join(VAULT_ROOT, RELATIVE_PATH);

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  try { fs.unlinkSync(DISK_PATH); } catch { /* best effort */ }
  try { fs.rmdirSync(path.dirname(DISK_PATH)); } catch { /* only removes if empty; best effort */ }
});

describe('Integration: Workspace A execution -> verified artifact -> Vault -> Memory index -> search -> receipt still valid', () => {
  const taskId = `task-integ-${Date.now()}`;
  let artifactId: string;
  let artifactHash: string;
  let receiptRecord: ReturnType<typeof recordReceipt>;
  const content = `# Integration Test Thesis\n\nThis artifact exists to prove the real execution -> Vault -> Memory chain end to end. Marker: ${UNIQUE_MARKER}.`;

  beforeAll(() => {
    createInitialTask({
      taskId,
      workspaceId: WORKSPACE_A,
      title: 'Integration Test Thesis',
      description: 'Service-level integration test task',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });

    const artifact = recordArtifact({
      taskId,
      relativePath: RELATIVE_PATH,
      diskPath: DISK_PATH,
      content,
    });
    artifactId = artifact.artifact_id;
    artifactHash = artifact.content_hash;

    const review = recordQualityReview({
      taskId,
      reviewer: 'aegis',
      method: 'deterministic',
      score: 1,
      decision: 'PASS',
      checks: [{ check: 'content_integrity', status: 'PASS', evidence: 'sha256 match on independent re-read' }],
      evidence: { note: 'integration test review' },
    });

    const payload: CanonicalReceiptPayload = {
      receiptId: `rcpt-integ-${Date.now()}`,
      taskId,
      reviewId: review.review_id,
      workspaceId: WORKSPACE_A,
      assignedAgent: 'dev',
      provider: 'google',
      modelUsed: 'gemini-3.1-flash-lite',
      artifactId,
      artifactHash,
      aegisDecision: 'PASS',
      aegisMethod: 'deterministic',
      createdAt: new Date().toISOString(),
    };
    const canonical = canonicalizePayload(payload);
    const signed = signReceiptPayload(canonical);

    receiptRecord = recordReceipt({
      receiptId: payload.receiptId,
      taskId,
      reviewId: review.review_id,
      algorithm: signed.algorithm,
      publicKey: signed.publicKeyPem,
      payloadJson: canonical,
      signature: signed.signature,
    });
  });

  it('1. the artifact is real on disk with real content', () => {
    expect(fs.existsSync(DISK_PATH)).toBe(true);
    expect(fs.readFileSync(DISK_PATH, 'utf8')).toBe(content);
  });

  it('2. the Ed25519 receipt cryptographically verifies (real signature, real key, not a stub)', () => {
    expect(verifyReceipt(receiptRecord)).toBe(true);
  });

  it('2b. a tampered receipt payload fails verification (proves this is a real check, not a hardcoded true)', () => {
    const tampered = { ...receiptRecord, payload_json: receiptRecord.payload_json.replace(artifactHash, 'sha256:tampered') };
    expect(verifyReceipt(tampered)).toBe(false);
  });

  it('3. the artifact surfaces in Workspace A\'s real Vault listing', () => {
    const entries = listWorkspaceVaultEntries(WORKSPACE_A, 100);
    expect(entries.map((e) => e.artifact_id)).toContain(artifactId);
  });

  it('3b. Workspace B cannot see Workspace A\'s Vault artifact (isolation holds through the real Vault read path)', () => {
    const entries = listWorkspaceVaultEntries(WORKSPACE_B, 100);
    expect(entries.map((e) => e.artifact_id)).not.toContain(artifactId);
    expect(getWorkspaceVaultEntry(WORKSPACE_B, artifactId)).toBeNull();
  });

  it('4. indexVaultArtifact indexes the real Vault content (the hook wired into /api/execute-agent-task)', () => {
    const ok = indexVaultArtifact(WORKSPACE_A, artifactId);
    expect(ok).toBe(true);
  });

  it('5. searchWorkspaceMemory finds the artifact by its real content, not a fabricated result', () => {
    const results = searchWorkspaceMemory(WORKSPACE_A, UNIQUE_MARKER);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].artifact_id).toBe(artifactId);
    expect(results[0].snippet).toContain('[');
  });

  it('5b. the same search in Workspace B returns nothing (memory index isolation holds)', () => {
    const results = searchWorkspaceMemory(WORKSPACE_B, UNIQUE_MARKER);
    expect(results).toEqual([]);
  });

  it('5c. a query with no matching content returns an honest empty array, not a fabricated hit', () => {
    const results = searchWorkspaceMemory(WORKSPACE_A, 'nonexistentqueryterm9999');
    expect(results).toEqual([]);
  });

  it('6. the receipt is still valid after Vault read and Memory indexing — no shared mutable state corrupted it', () => {
    expect(verifyReceipt(receiptRecord)).toBe(true);
  });
});
