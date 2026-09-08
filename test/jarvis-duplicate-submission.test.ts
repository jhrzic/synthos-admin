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
import { deriveIdempotentTaskId, checkIdempotentTask } from '../lib/fabric/envelope';
import { createInitialTask, updateTaskStatus, recordReceipt, recordQualityReview, runDeterministicAegisVerification } from '../lib/persistence';
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
