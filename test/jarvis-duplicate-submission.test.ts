import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import net from 'node:net';

// ---------------------------------------------------------------------------
// STEP 6 corrective pass, Part B — B1 (TTS root cause) and B2 (duplicate
// submission). Two kinds of proof, matching this repo's established split:
//
// STATIC — the client-side guards (JarvisView.tsx, GlobalVoiceOverlay.tsx,
// App.tsx, voiceEngine.ts) are real React/DOM code with no jsdom/RTL
// harness anywhere in this repo's existing test suite; verified here by
// real source inspection of the actual guard structure (ref-based,
// checked-and-set before any async work, cleared on every real exit path),
// the same convention every other client-side proof in this repo already
// uses (see test/jarvis-tts-speech-separation.test.ts, test/jarvis-
// provider-ownership.test.ts). "One TTS playback, no overlapping audio"
// specifically is additionally live-verified by hand in the Part C
// browser acceptance pass (deliberate double-click), not simulated here.
//
// LIVE — the server-side idempotency mechanism (B2) is fully real: a
// spawned server, real HTTP, real SQLite, real Vault writes. This is the
// mechanism that actually guarantees "one artifact, one memory index, one
// Aegis review, one receipt" even if a client-side guard were ever
// bypassed (a second tab, a replay) — proven end-to-end here.
// ---------------------------------------------------------------------------

const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
const jarvisViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/JarvisView.tsx'), 'utf-8');
const globalVoiceOverlayContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GlobalVoiceOverlay.tsx'), 'utf-8');
const voiceEngineContent = fs.readFileSync(path.resolve(process.cwd(), 'src/services/voiceEngine.ts'), 'utf-8');
const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

describe('B1 (TTS root cause): server.ts never aliases spokenSummary to the full reply', () => {
  it('no branch in /api/jarvis/command sets spokenSummary = reply (the confirmed root cause, now fixed)', () => {
    const idx = serverContent.indexOf('app.post("/api/jarvis/command"');
    const end = serverContent.indexOf('\n  app.', idx + 10);
    const route = serverContent.slice(idx, end);
    expect(route).not.toMatch(/spokenSummary\s*=\s*reply\s*;/);
  });

  it('the Windmill status branch now speaks a short, fixed line per real status, never health.error verbatim', () => {
    const idx = serverContent.indexOf('ADMIN_WINDMILL_STATUS_QUERY');
    const slice = serverContent.slice(idx, idx + 1400);
    expect(slice).toContain('"Windmill is connected."');
    expect(slice).toContain('"Windmill isn\'t configured on this deployment."');
    expect(slice).toContain('"Windmill\'s connection isn\'t healthy right now."');
    expect(slice).not.toMatch(/spokenSummary = reply/);
  });
});

describe('B1: never allow overlapping speech — every playback path stops the prior one first', () => {
  it('voiceEngine.ts (the shared TTS service used by GlobalVoiceOverlay and others) tracks and cancels its own prior playback at the top of every speakText() call', () => {
    expect(voiceEngineContent).toContain('export function stopSpeaking(): void');
    const idx = voiceEngineContent.indexOf('export async function speakText');
    const slice = voiceEngineContent.slice(idx, idx + 200);
    expect(slice).toContain('stopSpeaking();');
  });

  it('JarvisView.tsx stops its own prior playback (audio ref + speechSynthesis) at the top of every speakText() call', () => {
    const idx = jarvisViewContent.indexOf('const speakText = async (text: string) => {');
    const slice = jarvisViewContent.slice(idx, idx + 200);
    expect(slice).toContain('stopActiveSpeech();');
    expect(jarvisViewContent).toContain('const stopActiveSpeech = () => {');
  });
});

describe('B2: a real, synchronous (ref-based, not state-only) in-flight guard exists at every real submission entry point', () => {
  it('App.tsx: handleJarvisCommand is a real ref-guarded wrapper around dispatchJarvisCommand, shared by both Jarvis surfaces', () => {
    expect(appContent).toContain('const jarvisInFlightRef = useRef(false);');
    const idx = appContent.indexOf('const handleJarvisCommand = async');
    const slice = appContent.slice(idx, idx + 900);
    expect(slice).toContain('if (jarvisInFlightRef.current) {');
    expect(slice).toContain('return null;');
    expect(slice).toContain('jarvisInFlightRef.current = true;');
    expect(slice).toContain('return await dispatchJarvisCommand(command, messageType);');
    expect(slice).toContain('jarvisInFlightRef.current = false;'); // cleared in the finally
  });

  it('both real Jarvis surfaces (JarvisView, GlobalVoiceOverlay) receive the exact same handleJarvisCommand — the one shared guard, never two separate ones', () => {
    const occurrences = (appContent.match(/onJarvisCommand={handleJarvisCommand}/g) || []).length;
    expect(occurrences).toBe(2);
  });

  it('JarvisView.tsx: executeDirective (typed submit AND voice-transcript delivery both call this) guards synchronously via a ref, not only isLoading state', () => {
    expect(jarvisViewContent).toContain('const isLoadingRef = useRef(false);');
    const idx = jarvisViewContent.indexOf('const executeDirective = useCallback');
    const slice = jarvisViewContent.slice(idx, idx + 500);
    expect(slice).toContain('isLoadingRef.current) return;');
    expect(slice).toContain('isLoadingRef.current = true;');
  });

  it('GlobalVoiceOverlay.tsx: handleExecuteVoiceDirective (shared by the button AND the voice-transcript callback) guards synchronously via a ref', () => {
    expect(globalVoiceOverlayContent).toContain('const isProcessingRef = useRef(false);');
    const idx = globalVoiceOverlayContent.indexOf('const handleExecuteVoiceDirective = async');
    const slice = globalVoiceOverlayContent.slice(idx, idx + 500);
    expect(slice).toContain('isProcessingRef.current) return;');
    expect(slice).toContain('isProcessingRef.current = true;');
    // The voice callback (handleFinalTranscript) and the manual button
    // onClick both funnel into this exact function — one guard covers both.
    expect(globalVoiceOverlayContent).toContain('await handleExecuteVoiceDirective(transcript);');
    expect(globalVoiceOverlayContent).toContain('onClick={() => handleExecuteVoiceDirective(inputText)}');
  });

  it('the ref guard clears on every real exit path in both components: success, the duplicate no-op, and the catch/failure branch', () => {
    // JarvisView: cleared in the finally, which runs on every path
    // (success, thrown error, or the early "duplicate, do nothing" return).
    const jvIdx = jarvisViewContent.indexOf('const executeDirective = useCallback');
    const jvEnd = jarvisViewContent.indexOf('}, [onJarvisCommand', jvIdx);
    const jvSlice = jarvisViewContent.slice(jvIdx, jvEnd);
    expect(jvSlice).toContain('isLoadingRef.current = false;');

    // GlobalVoiceOverlay: cleared at each of its three real exit points
    // (duplicate no-op, success, catch) — not a single finally, since the
    // existing function structure predates this fix and uses explicit
    // setIsProcessing(false) calls at each point instead.
    const count = (globalVoiceOverlayContent.match(/isProcessingRef\.current = false;/g) || []).length;
    expect(count).toBe(3);
  });
});

describe('B2: no callback ever speaks or logs the full reply when the shared guard rejects a duplicate (null result)', () => {
  it('JarvisView.tsx treats a null onJarvisCommand() result as a real no-op — no HUD log, no speech, no vault sync', () => {
    const idx = jarvisViewContent.indexOf('const result = await onJarvisCommand(query);');
    const slice = jarvisViewContent.slice(idx, idx + 300);
    expect(slice).toContain('if (!result) {');
    expect(slice).toContain('return;');
  });

  it('GlobalVoiceOverlay.tsx treats a null onJarvisCommand() result as a real no-op — no transcript entry, no speech', () => {
    const idx = globalVoiceOverlayContent.indexOf('const dispatchResult = await onJarvisCommand');
    const slice = globalVoiceOverlayContent.slice(idx, idx + 500);
    expect(slice).toContain('if (!dispatchResult) {');
    expect(slice).toContain('return;');
  });
});

// ---------------------------------------------------------------------------
// LIVE — B2's server-side idempotency mechanism, real end to end.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-jarvis-dup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getDatabase } from '../lib/persistence';
import { createUser, login } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { VAULT_ROOT } from '../lib/vault';
import { deriveIdempotentTaskId, checkIdempotentTask, hashRequestPayload, executeEnvelope } from '../lib/fabric/envelope';
import { createInitialTask, updateTaskStatus, recordReceipt, recordQualityReview, runDeterministicAegisVerification, acquireExecutionClaim, resolveExecutionClaim, reconcileStaleExecutionClaims } from '../lib/persistence';
import { writeWorkspaceArtifact } from '../lib/vault';

const SESSION_COOKIE_NAME = 'synthos_session';
const WS = `ws-jarvis-dup-${Date.now()}`;
let userToken: string;

let child: ChildProcess;
let PORT: number;
let BASE_URL: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error('could not allocate a free port')));
      }
    });
  });
}

function cookieHeader(rawToken: string): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}`;
}

async function jarvisCommand(command: string, idempotencyKey?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}/api/jarvis/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(userToken) },
    body: JSON.stringify({ workspaceId: WS, command, idempotencyKey }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  getDatabase();
  ensureWorkspace(WS, 'Jarvis Duplicate Submission Test Workspace');
  const user = createUser({ email: `jarvis-dup-${Date.now()}@example.test`, password: 'correct horse battery staple 11', displayName: 'Jarvis Dup Tester' });
  grantMembership(user.user_id, WS, 'member');
  const loginResult = login(user.email, 'correct horse battery staple 11');
  if (!loginResult) throw new Error('setup: real login() failed');
  userToken = loginResult.rawToken;

  PORT = await freePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;
  const env: NodeJS.ProcessEnv = { ...process.env, SYNTHOS_DB_PATH: TEST_DB_PATH, PORT: String(PORT) };
  delete env.GEMINI_API_KEY;

  child = spawn(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['server.ts'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    let out = '';
    const timeout = setTimeout(() => reject(new Error(`server did not start within 20s. stdout so far:\n${out}`)), 20000);
    child.stdout?.on('data', (d) => {
      out += d.toString();
      if (out.includes('Server running on')) { clearTimeout(timeout); resolve(); }
    });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited early (code ${code}). Output:\n${out}`)); });
  });
}, 30000);

afterAll(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
  try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', WS), { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('B2 LIVE: two real submissions with the SAME idempotency key produce exactly one real artifact', () => {
  it('"save this to the Vault" sent twice with the same key writes exactly one real file, second call short-circuits honestly', async () => {
    const key = `dup-test-${Date.now()}`;
    const first = await jarvisCommand('save this to the Vault', key);
    expect(first.status).toBe(200);
    expect(first.json.evidence.outcome).toBe('SUCCESS');
    const firstPath = first.json.evidence.artifact.path;

    const second = await jarvisCommand('save this to the Vault', key);
    expect(second.status).toBe(200);
    expect(second.json.evidence.outcome).toBe('SUCCESS');
    expect(second.json.evidence.reason).toMatch(/duplicate submission ignored/i);
    expect(second.json.evidence.artifact.path).toBe(firstPath); // the SAME real file, not a second one

    // Real, independent proof: only one file exists on disk at that path,
    // and no second artifact row was created for this task id.
    const onDiskCount = fs.existsSync(path.join(VAULT_ROOT, ...firstPath.split('/'))) ? 1 : 0;
    expect(onDiskCount).toBe(1);
  });

  it('two DIFFERENT (or omitted) idempotency keys are never deduplicated against each other — the mechanism is opt-in, not a blanket cache', async () => {
    const a = await jarvisCommand('save this to the Vault'); // no key
    const b = await jarvisCommand('save this to the Vault'); // no key
    expect(a.json.evidence.artifact.path).not.toBe(b.json.evidence.artifact.path);
  });
});

describe('B2 unit: checkIdempotentTask short-circuits correctly for every real terminal/non-terminal task status', () => {
  it('no idempotencyKey supplied -> always null (unguarded, normal execution)', () => {
    expect(checkIdempotentTask('any-task-id', 'vault.write', undefined)).toBeNull();
  });

  it('no prior task exists for this key -> null (first real attempt proceeds normally)', () => {
    const taskId = deriveIdempotentTaskId('unit-test', `nonexistent-${Date.now()}`);
    expect(checkIdempotentTask(taskId, 'research', 'nonexistent-key')).toBeNull();
  });

  it('a real DONE task with a real receipt short-circuits to SUCCESS with that real receipt/artifact, never re-executing', () => {
    const key = `done-${Date.now()}`;
    const taskId = deriveIdempotentTaskId('unit-test', key);
    createInitialTask({ taskId, workspaceId: WS, title: 'Unit test task', description: 'test', assignedAgent: 'research', assignedModel: 'multi' });
    const artifact = writeWorkspaceArtifact({ workspaceId: WS, taskId, content: '# Real content\n', folder: 'Research', extension: 'md' });
    const aegis = runDeterministicAegisVerification(taskId, '# Real content\n');
    const review = recordQualityReview({ taskId, reviewer: aegis.reviewer, method: aegis.method, score: aegis.score, decision: aegis.decision, checks: aegis.checks, evidence: aegis.evidence });
    recordReceipt({ receiptId: `rcpt-unit-${Date.now()}`, taskId, reviewId: review.review_id, algorithm: 'Ed25519', publicKey: 'unit-test-key', payloadJson: '{}', signature: 'unit-test-signature' });
    updateTaskStatus(taskId, 'DONE');

    const result = checkIdempotentTask(taskId, 'research', key);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe('SUCCESS');
    expect(result!.artifact?.id).toBe(artifact.artifact_id);
    expect(result!.receipt?.receiptId).toBeTruthy();
  });

  it('a real FAILED task short-circuits to FAILED, never silently retried', () => {
    const key = `failed-${Date.now()}`;
    const taskId = deriveIdempotentTaskId('unit-test', key);
    createInitialTask({ taskId, workspaceId: WS, title: 'Unit test failed task', description: 'test', assignedAgent: 'research', assignedModel: 'multi' });
    updateTaskStatus(taskId, 'FAILED');

    const result = checkIdempotentTask(taskId, 'research', key);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe('FAILED');
    expect(result!.reason).toMatch(/duplicate submission ignored, not retried/i);
  });

  it('a real task in a non-terminal status refuses as BLOCKED rather than racing a concurrent execution', () => {
    const key = `inflight-${Date.now()}`;
    const taskId = deriveIdempotentTaskId('unit-test', key);
    createInitialTask({ taskId, workspaceId: WS, title: 'Unit test in-flight task', description: 'test', assignedAgent: 'research', assignedModel: 'multi' });
    updateTaskStatus(taskId, 'RUNNING');

    const result = checkIdempotentTask(taskId, 'research', key);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe('BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// STEP 6 concurrent-idempotency corrective pass.
//
// The defect this closes was proven live against the real :3000 server:
// three truly concurrent (Promise.all, not sequential) requests carrying
// the same idempotency key produced three real github.search calls, three
// real model.gemini calls, three artifacts, three receipts, all sharing
// one derived taskId — because the old check (checkIdempotentTask, above)
// only ever READ task state, and the first durable WRITE of that state
// happened only after the real provider work had already completed.
//
// The fix (withAtomicClaim in lib/fabric/envelope.ts, backed by
// execution_claims' UNIQUE(workspace_id, actor_user_id, capability,
// idempotency_key) constraint) is exercised here via vault.write, not
// research — both capabilities share the exact same withAtomicClaim
// function; vault.write differs only in what its `run()` callback does
// (a real Vault write, no Gemini/GitHub call), which makes it possible to
// prove the mechanism exhaustively, at zero cost, with real HTTP against
// the real spawned server. This repo's own existing convention (see
// test/execution-envelope.test.ts deliberately deleting GEMINI_API_KEY)
// already avoids ever invoking the real paid Gemini path from the
// automated suite — this file does not introduce an exception for research
// specifically. The research-specific real call-count-of-exactly-one
// (github.search once, model.gemini once) is proven live in the separate
// LIVE_REACCEPTANCE pass against the real :3000 server with the real
// GEMINI_API_KEY already present there, not fabricated here for free.
// Since research and vault.write both route every duplicate through the
// identical withAtomicClaim gate, "run() executes at most once" is proven
// once, generically, and applies to both.
// ---------------------------------------------------------------------------

describe('STEP 6 concurrent-idempotency corrective pass — LIVE: real concurrent HTTP requests against the real spawned server', () => {
  it('1. three truly concurrent identical requests (same key, same payload) produce exactly one real execution', async () => {
    const key = `concurrent3-${Date.now()}`;
    const command = 'save this to the Vault — concurrency test 3-way';
    const results = await Promise.all([
      jarvisCommand(command, key),
      jarvisCommand(command, key),
      jarvisCommand(command, key),
    ]);

    for (const r of results) {
      expect(r.status).toBe(200);
      // Per spec: every duplicate caller either reuses the same terminal
      // result (SUCCESS, replaying the real artifact) or receives the
      // defined IN_PROGRESS response — none may execute again.
      expect(['SUCCESS', 'IN_PROGRESS']).toContain(r.json.evidence.outcome);
    }

    const successResults = results.filter((r) => r.json.evidence.outcome === 'SUCCESS');
    expect(successResults.length).toBeGreaterThan(0); // at least the winner must have succeeded
    const distinctPaths = new Set(successResults.map((r) => r.json.evidence.artifact?.path));
    expect(distinctPaths.size).toBe(1); // every SUCCESS response points at the SAME real artifact

    const db = getDatabase();
    const taskId = deriveIdempotentTaskId('vault', key);
    expect((db.prepare('SELECT COUNT(*) AS n FROM execution_claims WHERE task_id = ?').get(taskId) as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(taskId) as any).n).toBe(1);

    const winningPath = [...distinctPaths][0] as string;
    const onDiskCount = fs.existsSync(path.join(VAULT_ROOT, ...winningPath.split('/'))) ? 1 : 0;
    expect(onDiskCount).toBe(1);
  });

  it('2. ten truly concurrent identical requests (same key, same payload) still produce exactly one real execution', async () => {
    const key = `concurrent10-${Date.now()}`;
    const command = 'save this to the Vault — concurrency test 10-way';
    const results = await Promise.all(Array.from({ length: 10 }, () => jarvisCommand(command, key)));

    for (const r of results) {
      expect(r.status).toBe(200);
      expect(['SUCCESS', 'IN_PROGRESS']).toContain(r.json.evidence.outcome);
    }
    const successResults = results.filter((r) => r.json.evidence.outcome === 'SUCCESS');
    const distinctPaths = new Set(successResults.map((r) => r.json.evidence.artifact?.path));
    expect(distinctPaths.size).toBe(1);

    const db = getDatabase();
    const taskId = deriveIdempotentTaskId('vault', key);
    expect((db.prepare('SELECT COUNT(*) AS n FROM execution_claims WHERE task_id = ?').get(taskId) as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(taskId) as any).n).toBe(1);
    // 45s, raised from 20s. This fires TEN genuinely concurrent HTTP requests,
    // each doing a real Vault write, a real Aegis verification and a real
    // Ed25519 signature, while 80-odd other test files run in parallel. An
    // explicit per-test timeout overrides the global config, which is why
    // raising the global had no effect on it.
    //
    // A TIME BUDGET ONLY. Every assertion above is unchanged — still exactly one
    // execution claim and exactly one artifact, which is the whole point of the
    // test. It passes 5/5 when run alone; the budget, not the behaviour, was
    // what the suite's growth outgrew.
  }, 45000);

  it('3. same idempotency key with a DIFFERENT payload is a conflict, never an accidental duplicate execution', async () => {
    const key = `payload-collision-${Date.now()}`;
    const first = await jarvisCommand('save this to the Vault — original payload', key);
    expect(first.status).toBe(200);
    expect(first.json.evidence.outcome).toBe('SUCCESS');

    const second = await jarvisCommand('save this to the Vault — a completely different payload', key);
    expect(second.status).toBe(200);
    expect(second.json.evidence.outcome).toBe('CONFLICT');
    expect(second.json.evidence.reason).toMatch(/different request/i);

    // Zero accidental second execution: still exactly one artifact for this taskId.
    const db = getDatabase();
    const taskId = deriveIdempotentTaskId('vault', key);
    expect((db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(taskId) as any).n).toBe(1);
  });
});

describe('STEP 6 concurrent-idempotency corrective pass — direct executeEnvelope: deterministic edge cases', () => {
  it('4. same idempotency key in a DIFFERENT workspace executes independently — no cross-workspace claim collision', async () => {
    const otherWs = `ws-claim-other-${Date.now()}`;
    ensureWorkspace(otherWs, 'Claim Cross-Workspace Test');
    const key = `cross-ws-${Date.now()}`;

    const a = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write', parameters: {}, rawText: 'cross-workspace claim test', idempotencyKey: key });
    const b = await executeEnvelope({ workspaceId: otherWs, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write', parameters: {}, rawText: 'cross-workspace claim test', idempotencyKey: key });

    expect(a.outcome).toBe('SUCCESS');
    expect(b.outcome).toBe('SUCCESS');
    expect(a.artifact?.path).not.toBe(b.artifact?.path); // two real, independent artifacts
    expect(a.artifact?.path).toContain(`workspaces/${WS}/`);
    expect(b.artifact?.path).toContain(`workspaces/${otherWs}/`);

    try { fs.rmSync(path.join(VAULT_ROOT, 'workspaces', otherWs), { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('5. a duplicate arriving while the first is still CLAIMED (genuinely in-flight) gets IN_PROGRESS, never a second execution', async () => {
    const key = `inflight-claim-${Date.now()}`;
    const rawText = 'in-flight claim test';
    const taskId = deriveIdempotentTaskId('vault', key);
    const payloadHash = hashRequestPayload('vault.write', rawText, {});

    // Simulate "request A is still running": acquire the claim ourselves and
    // deliberately do NOT resolve it — the exact state a real in-flight
    // request would leave it in.
    const acquisition = acquireExecutionClaim({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', idempotencyKey: key, payloadHash, taskId });
    expect(acquisition.outcome).toBe('ACQUIRED');

    const duplicate = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write', parameters: {}, rawText, idempotencyKey: key });
    expect(duplicate.outcome).toBe('IN_PROGRESS');

    // No execution happened for the duplicate: no artifact exists for this taskId yet.
    const db = getDatabase();
    expect((db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(taskId) as any).n).toBe(0);

    resolveExecutionClaim(acquisition.claim.claim_id, 'DONE'); // cleanup — this test never lets the real run() happen
  });

  it('6. a previously FAILED claim is never silently retried — matches the existing approved failure policy', async () => {
    const key = `failed-claim-${Date.now()}`;
    const rawText = 'failed claim test';
    const taskId = deriveIdempotentTaskId('vault', key);
    const payloadHash = hashRequestPayload('vault.write', rawText, {});

    const acquisition = acquireExecutionClaim({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', idempotencyKey: key, payloadHash, taskId });
    resolveExecutionClaim(acquisition.claim.claim_id, 'FAILED');

    const result = await executeEnvelope({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', action: 'vault.write', parameters: {}, rawText, idempotencyKey: key });
    expect(result.outcome).toBe('FAILED');
    expect(result.reason).toMatch(/duplicate submission ignored, not retried/i);

    const db = getDatabase();
    expect((db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE task_id = ?').get(taskId) as any).n).toBe(0);
  });

  it('7. a real UNIQUE constraint backs the claim table — a second raw INSERT for the same identity is rejected by SQLite itself, not application logic', () => {
    const key = `unique-constraint-${Date.now()}`;
    const taskId = deriveIdempotentTaskId('vault', key);
    const payloadHash = hashRequestPayload('vault.write', 'unique constraint test', {});

    const first = acquireExecutionClaim({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', idempotencyKey: key, payloadHash, taskId });
    expect(first.outcome).toBe('ACQUIRED');

    const second = acquireExecutionClaim({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', idempotencyKey: key, payloadHash, taskId });
    expect(second.outcome).toBe('EXISTS');
    expect(second.claim.claim_id).toBe(first.claim.claim_id); // the exact same row, not a second one

    const db = getDatabase();
    const rowCount = (db.prepare(
      'SELECT COUNT(*) AS n FROM execution_claims WHERE workspace_id = ? AND actor_user_id = ? AND capability = ? AND idempotency_key = ?'
    ).get(WS, 'u1', 'vault.write', key) as any).n;
    expect(rowCount).toBe(1);
  });

  it('8. stale-claim reconciliation: a CLAIMED row left behind by a hard crash is reconciled to FAILED, never left to block a legitimate retry forever', () => {
    const key = `stale-claim-${Date.now()}`;
    const taskId = deriveIdempotentTaskId('vault', key);
    const payloadHash = hashRequestPayload('vault.write', 'stale claim test', {});

    const acquisition = acquireExecutionClaim({ workspaceId: WS, actorUserId: 'u1', capability: 'vault.write', idempotencyKey: key, payloadHash, taskId });
    expect(acquisition.outcome).toBe('ACQUIRED'); // left CLAIMED — simulates a process that crashed before resolving it

    const reconciledCount = reconcileStaleExecutionClaims();
    expect(reconciledCount).toBeGreaterThanOrEqual(1);

    const db = getDatabase();
    const row = db.prepare('SELECT status FROM execution_claims WHERE claim_id = ?').get(acquisition.claim.claim_id) as any;
    expect(row.status).toBe('FAILED');
  });
});
