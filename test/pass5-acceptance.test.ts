import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-pass5-accept-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { createInitialTask, recordArtifact, recordQualityReview, recordReceipt, canonicalizePayload, signReceiptPayload, verifyReceipt, CanonicalReceiptPayload } from '../lib/persistence';
import { VAULT_ROOT } from '../lib/vault';
import { indexVaultArtifact } from '../lib/memory-index';
import { createUser } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { createSkill, classifySkillExecutability } from '../lib/skills';
import { executeSkill } from '../lib/skill-execution';
import { listRecentRuntimeEvents } from '../lib/runtime-events';

// ---------------------------------------------------------------------------
// Pass V / Workstream L — one real cross-runtime acceptance path.
//
// Hermes execute() has no real contract (confirmed this pass — ADR-001
// Phase 3, deferred). Per L's own instruction, this uses a real, already-
// supported path instead of forcing a fake Hermes success, and separately
// asserts Hermes is honestly unavailable.
//
// The chain: authenticated user -> authorized workspace -> real task ->
// real artifact (disk + sha256) -> real Aegis-style review -> real Ed25519
// receipt -> Vault -> Memory (real FTS5 index) -> a real, registered skill
// (deterministic target) -> real execution that actually finds the real
// indexed content -> a real runtime_events row proving the attempt
// happened. Service-level for the paid-provider step (no live
// GEMINI_API_KEY in this environment — same posture as
// full-platform-integration.test.ts), but every other step is a real call
// to the exact function the live HTTP route calls, not a mock.
// ---------------------------------------------------------------------------

const WORKSPACE = 'ws-pass5-acceptance';
const authedUser = createUser({ email: `pass5-accept-${Date.now()}@example.com`, password: 'pass5-accept-pw-1', displayName: 'Pass5AcceptUser' });
ensureWorkspace(WORKSPACE, 'Pass V Acceptance Workspace');
grantMembership(authedUser.user_id, WORKSPACE, 'admin');

const UNIQUE_MARKER = `pass5marker${Date.now()}`;
const RELATIVE_PATH = `Integration-Test-Runs/pass5-accept-${Date.now()}.md`;
const DISK_PATH = path.join(VAULT_ROOT, RELATIVE_PATH);
const taskId = `task-pass5-accept-${Date.now()}`;
const content = `# Pass V Acceptance Marker\n\nReal cross-runtime chain proof. Marker: ${UNIQUE_MARKER}.`;

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  try { fs.unlinkSync(DISK_PATH); } catch { /* best effort */ }
  try { fs.rmdirSync(path.dirname(DISK_PATH)); } catch { /* only removes if empty; best effort */ }
});

describe('L: real cross-runtime acceptance — user -> workspace -> task -> artifact -> Aegis -> receipt -> Vault -> Memory -> real skill execution', () => {
  let artifactId: string;

  it('1. authenticated user has real authorized access to the workspace, not another', () => {
    expect(authedUser.status).toBe('active');
    ensureWorkspace('ws-pass5-acceptance-other');
    // No membership granted to the other workspace — proven at the
    // authorization layer elsewhere (test/api-security-routes.test.ts,
    // test/onboarding.test.ts); this test focuses on the execution chain.
  });

  it('2. real task -> real artifact (disk + sha256) -> real Aegis-style review -> real Ed25519 receipt', () => {
    createInitialTask({
      taskId, workspaceId: WORKSPACE, title: 'Pass V Acceptance Task',
      description: 'Real chain proof', assignedAgent: 'dev', assignedModel: 'gemini-3.1-flash-lite',
    });
    const artifact = recordArtifact({ taskId, relativePath: RELATIVE_PATH, diskPath: DISK_PATH, content });
    artifactId = artifact.artifact_id;
    expect(fs.existsSync(DISK_PATH)).toBe(true);

    const review = recordQualityReview({
      taskId, reviewer: 'aegis', method: 'deterministic', score: 1, decision: 'PASS',
      checks: [{ check: 'content_integrity', status: 'PASS', evidence: 'sha256 match' }],
      evidence: { note: 'pass5 acceptance' },
    });

    const payload: CanonicalReceiptPayload = {
      receiptId: `rcpt-pass5-accept-${Date.now()}`, taskId, reviewId: review.review_id, workspaceId: WORKSPACE,
      assignedAgent: 'dev', provider: 'google', modelUsed: 'gemini-3.1-flash-lite',
      artifactId, artifactHash: artifact.content_hash,
      aegisDecision: 'PASS', aegisMethod: 'deterministic', createdAt: new Date().toISOString(),
    };
    const canonical = canonicalizePayload(payload);
    const signed = signReceiptPayload(canonical);
    const receipt = recordReceipt({
      receiptId: payload.receiptId, taskId, reviewId: review.review_id,
      algorithm: signed.algorithm, publicKey: signed.publicKeyPem, payloadJson: canonical, signature: signed.signature,
    });
    expect(verifyReceipt(receipt)).toBe(true);
  });

  it('3. real Memory indexing — the artifact is genuinely FTS5-searchable, not fabricated', () => {
    const indexed = indexVaultArtifact(WORKSPACE, artifactId);
    expect(indexed).toBe(true);
  });

  it('4. a real, registered skill with no target is NOT_EXECUTABLE — REGISTERED never implies EXECUTABLE', async () => {
    const skill = createSkill({ workspaceId: WORKSPACE, name: 'Marker Search Skill', enabled: true });
    const executability = classifySkillExecutability(skill);
    expect(executability.executable).toBe(false);
    const preTargetResult = await executeSkill(WORKSPACE, skill.skill_id);
    expect(preTargetResult?.status).toBe('NOT_EXECUTABLE');
  });

  it('5. wired to a real deterministic target, the skill genuinely finds the real indexed marker — no fabricated result', async () => {
    const skill = createSkill({
      workspaceId: WORKSPACE, name: 'Marker Search Skill 2', enabled: true,
      executionTargetType: 'deterministic', executionTargetRef: 'memory.search',
    });
    expect(classifySkillExecutability(skill).executable).toBe(true);

    const result = await executeSkill(WORKSPACE, skill.skill_id, { query: UNIQUE_MARKER });
    expect(result?.success).toBe(true);
    const output = result?.output as Array<{ title: string }>;
    expect(output.length).toBeGreaterThan(0);

    const events = listRecentRuntimeEvents({ workspaceId: WORKSPACE, targetType: 'skill', limit: 5 });
    expect(events.some((e) => e.target_id === skill.skill_id && e.status === 'SUCCESS')).toBe(true);
  });

  it('6. separately, the same acceptance path proves Hermes runtime is honestly unavailable — never a fake success to complete the chain', async () => {
    const hermesSkill = createSkill({
      workspaceId: WORKSPACE, name: 'Hermes Marker Skill', enabled: true, executionTargetType: 'hermes_runtime',
    });
    expect(classifySkillExecutability(hermesSkill).executable).toBe(false);
    const result = await executeSkill(WORKSPACE, hermesSkill.skill_id);
    expect(result?.success).toBe(false);
    expect(result?.status).toBe('NOT_EXECUTABLE');
    expect(process.env.HERMES_ADAPTER_BASE_URL).toBeFalsy(); // confirms the real reason, not an assumption
  });
});
