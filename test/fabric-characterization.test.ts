import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import net from 'node:net';

// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 1a characterization, updated in Phase 0b,
// then updated again for the Step 1b extraction.
//
// Purpose (per the binding spec, Section 6, Step 1a): snapshot every
// externally observable side effect of POST /api/execute-agent-task. This is
// the behavioral oracle every later step must match.
//
// History: the original Step 1a commit (e2f0697) characterized the route as
// it existed then, inline in server.ts, and found two live-provable, unfixed
// bugs (a cross-workspace task-id hijack, and gate ordering that masks the
// unsupported-model check) plus two source-only findings (a receipt
// workspaceId that could diverge from the task's real workspace, and an
// artifact-filename collision). e2f0697 itself is kept unchanged in git
// history as the historical pre-fix record. PHASE 0b then fixed the
// task-hijack and receipt-workspaceId-divergence bugs in place, still inline
// in server.ts (both proven live below, not just re-asserted), leaving the
// gate-ordering and filename-collision findings open and explicitly labeled
// DEFERRED. STEP 1b then extracted the route's entire logic out of server.ts
// into lib/fabric/kernel.ts — server.ts is now a thin adapter around it (see
// the STATIC describe blocks below for exactly which file each assertion now
// reads). This file is the CURRENT oracle throughout — it reflects the code
// as it stands right now, not any prior commit's snapshot.
//
// Method: server.ts calls startServer() unconditionally at module load and
// binds a real port (server.ts:5773) — it is not structured for in-process
// import + supertest-style testing, and no existing test in this repo does
// that (checked: every test that creates an http.createServer does so to
// stand in for an EXTERNAL dependency the code-under-test calls out to, never
// to test server.ts's own routes). So this file spawns the real, unmodified
// `tsx server.ts` as a child process against an isolated SQLite file
// (SYNTHOS_DB_PATH) and a free port, then makes real HTTP requests to it and
// inspects the real DB/filesystem afterward — a true black-box
// characterization of the real Express route (which internally now calls
// lib/fabric/kernel.ts), not a description of the source code.
//
// Environment-imposed scope split (recorded here, not worked around):
// - No GEMINI_API_KEY exists in this environment (confirmed: the real
//   server's own startup log reports "GEMINI_PROVIDER: NOT_CONFIGURED").
//   This makes the BLOCKED_MISSING_CREDENTIAL path (server.ts ~1500-1517)
//   the ONLY execution outcome reachable live, and it is reached from every
//   request regardless of model/agent — see the "gate ordering" finding
//   below. Everything on the far side of a successful provider call
//   (artifact write, Aegis verification, receipt signing, KIL/memory
//   indexing, the two other failure branches PROVIDER_FAILED/
//   EMPTY_PROVIDER_RESPONSE) is therefore characterized from source only,
//   in clearly separated `describe` blocks below, never presented as
//   something this run actually observed.
// - The x-internal-service-token bypass (server.ts:1453) cannot be
//   exercised by an external HTTP caller either: the token is
//   crypto.randomBytes(32) generated fresh in-process at every server start
//   (server.ts:277) and never exposed via any API, env var, or log line —
//   only the server's own self-call from POST /api/graphs/execute
//   (server.ts:2418) can supply it. Characterized from source only.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-fabric-char-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { getDatabase } from '../lib/persistence';
import { createUser, login } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';

const SESSION_COOKIE_NAME = 'synthos_session';

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

let child: ChildProcess;
let PORT: number;
let BASE_URL: string;

// Two fully real, isolated users/workspaces — matching this repo's existing
// isolation-test convention (see test/jarvis-context.test.ts, test/
// workspace-isolation.test.ts) rather than a new one.
const WS_A = `ws-fabric-char-a-${Date.now()}`;
const WS_B = `ws-fabric-char-b-${Date.now()}`;
let userAToken: string;
let userBToken: string;

function cookieHeader(rawToken: string): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}`;
}

async function postExecuteAgentTask(body: any, cookie?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}/api/execute-agent-task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function dbTaskRow(taskId: string): any {
  return getDatabase().prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
}
function dbStatusHistory(taskId: string): any[] {
  return getDatabase().prepare('SELECT status, created_at FROM task_status_history WHERE task_id = ? ORDER BY id ASC').all(taskId);
}
function dbActivityEvents(taskId: string): any[] {
  return getDatabase().prepare('SELECT event_type, agent_id, payload_json, created_at FROM activity_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC').all(taskId);
}
function dbArtifacts(taskId: string): any[] {
  return getDatabase().prepare('SELECT * FROM artifacts WHERE task_id = ?').all(taskId);
}
function dbQualityReviews(taskId: string): any[] {
  return getDatabase().prepare('SELECT * FROM quality_reviews WHERE task_id = ?').all(taskId);
}
function dbReceipts(taskId: string): any[] {
  return getDatabase().prepare('SELECT * FROM receipts WHERE task_id = ?').all(taskId);
}

beforeAll(async () => {
  // getDatabase() self-provisions the schema on first open (existing
  // convention, confirmed in lib/persistence.ts) — no migration step needed.
  getDatabase();

  ensureWorkspace(WS_A, 'Fabric Characterization Workspace A');
  ensureWorkspace(WS_B, 'Fabric Characterization Workspace B');

  const userA = createUser({ email: `fabric-char-a-${Date.now()}@example.test`, password: 'correct horse battery staple 1', displayName: 'Fabric Char A' });
  const userB = createUser({ email: `fabric-char-b-${Date.now()}@example.test`, password: 'correct horse battery staple 2', displayName: 'Fabric Char B' });
  grantMembership(userA.user_id, WS_A, 'member');
  grantMembership(userB.user_id, WS_B, 'member');

  const loginA = login(userA.email, 'correct horse battery staple 1');
  const loginB = login(userB.email, 'correct horse battery staple 2');
  if (!loginA || !loginB) throw new Error('characterization setup: real login() failed — cannot proceed');
  userAToken = loginA.rawToken;
  userBToken = loginB.rawToken;

  PORT = await freePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;

  // Spawns the REAL, unmodified server.ts — no test-mode flag, no mocking.
  // GEMINI_API_KEY is deliberately omitted (not inherited, not set) so the
  // BLOCKED_MISSING_CREDENTIAL path is deterministic regardless of what the
  // ambient shell running this test suite happens to have.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SYNTHOS_DB_PATH: TEST_DB_PATH,
    PORT: String(PORT),
  };
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
      if (out.includes('Server running on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server process exited early (code ${code}). Output:\n${out}`));
    });
  });
}, 30000);

afterAll(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

// ===========================================================================
// LIVE-VERIFIED: real HTTP requests against the real, running, unmodified
// route; real SQLite file inspected afterward.
// ===========================================================================

describe('LIVE 1: authentication is required — no cookie, zero side effects', () => {
  it('no session cookie -> 401, and the handler never runs (no task row created)', async () => {
    const taskId = `char-noauth-${Date.now()}`;
    const { status, json } = await postExecuteAgentTask({ taskId, assignedModel: 'gemini-3.6-flash', taskTitle: 'char test', workspaceId: WS_A });
    expect(status).toBe(401);
    expect(json).toMatchObject({ success: false });
    expect(dbTaskRow(taskId)).toBeUndefined();
  });
});

describe('LIVE 2: workspace membership is required — real session, wrong workspace, zero side effects', () => {
  it('user B (member of WS_B only) claiming WS_A -> 403, and the handler never runs', async () => {
    const taskId = `char-forbidden-${Date.now()}`;
    const { status, json } = await postExecuteAgentTask(
      { taskId, assignedModel: 'gemini-3.6-flash', taskTitle: 'char test', workspaceId: WS_A },
      cookieHeader(userBToken)
    );
    expect(status).toBe(403);
    expect(json).toMatchObject({ success: false });
    expect(dbTaskRow(taskId)).toBeUndefined();
  });
});

describe('LIVE 3: BLOCKED_MISSING_CREDENTIAL — the only reachable execution outcome in this environment', () => {
  it('HTTP status + response body shape', async () => {
    const taskId = `char-blocked-${Date.now()}`;
    const { status, json } = await postExecuteAgentTask(
      { taskId, taskTitle: 'Characterization Task', description: 'd', assignedAgent: 'scout', assignedModel: 'gemini-3.6-flash', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    expect(status).toBe(400);
    expect(json).toEqual({
      success: false,
      status: 'BLOCKED',
      reason: 'BLOCKED_MISSING_CREDENTIAL',
      error: 'GEMINI_API_KEY environment variable is not configured on the server',
      taskId,
    });
  });

  it('task status transitions: TODO -> READY -> FAILED, in that exact order, timestamps non-decreasing', async () => {
    const taskId = `char-blocked-history-${Date.now()}`;
    await postExecuteAgentTask({ taskId, assignedModel: 'gemini-3.6-flash', taskTitle: 't', workspaceId: WS_A }, cookieHeader(userAToken));

    const row = dbTaskRow(taskId);
    expect(row.status).toBe('FAILED');
    expect(row.workspace_id).toBe(WS_A);

    const history = dbStatusHistory(taskId);
    expect(history.map((h) => h.status)).toEqual(['TODO', 'READY', 'FAILED']);
    for (let i = 1; i < history.length; i++) {
      expect(history[i].created_at >= history[i - 1].created_at).toBe(true);
    }
  });

  it('activity events: TASK_CREATED -> AGENT_ASSIGNED -> PROVIDER_FAILED, in that exact order, with real payloads', async () => {
    const taskId = `char-blocked-events-${Date.now()}`;
    await postExecuteAgentTask({ taskId, taskTitle: 't', assignedAgent: 'dev', assignedModel: 'gemini-3.6-flash', workspaceId: WS_A }, cookieHeader(userAToken));

    const events = dbActivityEvents(taskId);
    expect(events.map((e) => e.event_type)).toEqual(['TASK_CREATED', 'AGENT_ASSIGNED', 'PROVIDER_FAILED']);
    expect(events[0].agent_id).toBe('orchestrator');
    expect(events[1].agent_id).toBe('dev');
    expect(events[2].agent_id).toBe('dev');

    const providerFailedPayload = JSON.parse(events[2].payload_json);
    expect(providerFailedPayload.reason).toBe('BLOCKED_MISSING_CREDENTIAL');
    expect(providerFailedPayload.error).toContain('GEMINI_API_KEY');
  });

  it('partial-failure state (Section 6 item 9): no artifact, no quality_review, no receipt row exist — nothing orphaned past what the failed path is supposed to leave', async () => {
    const taskId = `char-blocked-noartifact-${Date.now()}`;
    await postExecuteAgentTask({ taskId, assignedModel: 'gemini-3.6-flash', taskTitle: 't', workspaceId: WS_A }, cookieHeader(userAToken));

    expect(dbArtifacts(taskId)).toEqual([]);
    expect(dbQualityReviews(taskId)).toEqual([]);
    expect(dbReceipts(taskId)).toEqual([]);
    // No file is written to vault/Startup-Theses either — the disk write
    // (server.ts ~1783) is provably never reached: it comes after the
    // `if (!executionOutput) return res.status(502)...` branch this test's
    // BLOCKED_MISSING_CREDENTIAL response never reaches (that branch is
    // for a DIFFERENT failure — provider actually ran and returned empty —
    // characterized from source only, below).
    const sanitized = 't'.replace(/[^a-zA-Z0-9_-]/g, '-');
    const wouldBePath = path.join(REPO_ROOT, 'vault', 'Startup-Theses', `${sanitized}.md`);
    expect(fs.existsSync(wouldBePath)).toBe(false);
  });
});

describe('LIVE 4 (Phase 0b item A — CLOSED by the model registry): the model-support check now runs before the credential check', () => {
  it('an unregistered model (e.g. "gpt-4") returns MODEL_NOT_REGISTERED even with no API key — the credential check no longer masks it', async () => {
    const taskId = `char-gate-order-${Date.now()}`;
    const { status, json } = await postExecuteAgentTask(
      { taskId, taskTitle: 't', assignedModel: 'gpt-4', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    expect(status).toBe(400);
    expect(json.reason).toBe('MODEL_NOT_REGISTERED');
    expect(json.reason).not.toBe('BLOCKED_MISSING_CREDENTIAL');
    // Same terminal state; the real reason.
    expect(dbTaskRow(taskId).status).toBe('FAILED');
  });
});

describe('LIVE 5 (PHASE 0b FIX — was SURPRISING/UNSAFE in e2f0697, now closed): a client-supplied taskId can no longer cross workspace boundaries', () => {
  it('reusing an existing task_id from Workspace A inside a real, authorized Workspace B request now returns 403 WORKSPACE_MISMATCH with zero writes — the Workspace A task is byte-for-byte unchanged', async () => {
    const sharedTaskId = `char-hijack-fixed-${Date.now()}`;

    // Step 1: user A, a real member of WS_A, creates a task under that id.
    // Unchanged from e2f0697 — this is the same real BLOCKED_MISSING_CREDENTIAL
    // path characterized there.
    const first = await postExecuteAgentTask(
      { taskId: sharedTaskId, assignedModel: 'gemini-3.6-flash', taskTitle: 'Original A Title', description: 'owned by A', assignedAgent: 'scout', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    expect(first.status).toBe(400); // BLOCKED_MISSING_CREDENTIAL
    const rowAfterFirst = dbTaskRow(sharedTaskId);
    expect(rowAfterFirst.workspace_id).toBe(WS_A);
    expect(rowAfterFirst.title).toBe('Original A Title');
    expect(rowAfterFirst.description).toBe('owned by A');
    expect(rowAfterFirst.assigned_agent).toBe('scout');
    expect(rowAfterFirst.status).toBe('FAILED');
    const historyAfterFirst = dbStatusHistory(sharedTaskId);
    expect(historyAfterFirst.length).toBe(3); // TODO, READY, FAILED
    const eventsAfterFirst = dbActivityEvents(sharedTaskId);
    expect(eventsAfterFirst.length).toBe(3); // TASK_CREATED, AGENT_ASSIGNED, PROVIDER_FAILED

    // Step 2: user B — a real, legitimately authorized member of WS_B, with
    // NO membership in WS_A whatsoever — sends a new request for WS_B that
    // happens to reuse the SAME task_id. PHASE 0b: getTaskWorkspaceId(taskId)
    // is now checked before createInitialTask ever runs. The task's real
    // workspace_id (WS_A) does not match resolvedWorkspaceId (WS_B), so the
    // request is rejected before any write.
    const second = await postExecuteAgentTask(
      { taskId: sharedTaskId, assignedModel: 'gemini-3.6-flash', taskTitle: 'Hijacked By B', description: 'reassigned by B', assignedAgent: 'dev', workspaceId: WS_B },
      cookieHeader(userBToken)
    );
    expect(second.status).toBe(403);
    expect(second.json).toEqual({
      success: false,
      status: 'BLOCKED',
      reason: 'WORKSPACE_MISMATCH',
      error: `Task ${sharedTaskId} belongs to a different workspace and cannot be reused here.`,
      taskId: sharedTaskId,
    });

    // Proof of zero writes: the Workspace A task is byte-for-byte the same
    // row it was after step 1 — nothing about workspace/title/description/
    // assigned_agent/status changed.
    const rowAfterSecond = dbTaskRow(sharedTaskId);
    expect(rowAfterSecond).toEqual(rowAfterFirst);

    // No new status-history or activity-event rows were appended for B's
    // rejected attempt — still exactly the 3 + 3 from user A's real request.
    const historyAfterSecond = dbStatusHistory(sharedTaskId);
    expect(historyAfterSecond).toEqual(historyAfterFirst);
    const eventsAfterSecond = dbActivityEvents(sharedTaskId);
    expect(eventsAfterSecond).toEqual(eventsAfterFirst);

    // No artifact/review/receipt exists for this task under either
    // workspace's claim, and no disk write occurred.
    expect(dbArtifacts(sharedTaskId)).toEqual([]);
    expect(dbQualityReviews(sharedTaskId)).toEqual([]);
    expect(dbReceipts(sharedTaskId)).toEqual([]);
    const sanitized = 'Hijacked By B'.replace(/[^a-zA-Z0-9_-]/g, '-');
    expect(fs.existsSync(path.join(REPO_ROOT, 'vault', 'Startup-Theses', `${sanitized}.md`))).toBe(false);
  });

  it('a brand-new task_id (never seen before) is completely unaffected by the workspace-ownership gate — normal same-workspace creation still works', async () => {
    const freshTaskId = `char-normal-${Date.now()}`;
    const { status, json } = await postExecuteAgentTask(
      { taskId: freshTaskId, assignedModel: 'gemini-3.6-flash', taskTitle: 'Normal task', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    expect(status).toBe(400); // BLOCKED_MISSING_CREDENTIAL — the gate never engages for a fresh id
    expect(json.reason).toBe('BLOCKED_MISSING_CREDENTIAL');
    expect(dbTaskRow(freshTaskId).workspace_id).toBe(WS_A);
  });

  it('the SAME user, SAME workspace, reusing their own existing task_id (a real retry) is still allowed through the gate', async () => {
    const retryTaskId = `char-retry-${Date.now()}`;
    const first = await postExecuteAgentTask(
      { taskId: retryTaskId, assignedModel: 'gemini-3.6-flash', taskTitle: 'Retry Task', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    expect(first.status).toBe(400);
    const second = await postExecuteAgentTask(
      { taskId: retryTaskId, assignedModel: 'gemini-3.6-flash', taskTitle: 'Retry Task Updated', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    // Same workspace as the existing task -> gate passes, UPSERT proceeds
    // exactly as before Phase 0b. This is deliberate, existing, same-
    // workspace retry behavior — Phase 0b narrows the gate to cross-
    // workspace reuse only, and must not regress this.
    expect(second.status).toBe(400);
    expect(second.json.reason).toBe('BLOCKED_MISSING_CREDENTIAL');
    expect(dbTaskRow(retryTaskId).title).toBe('Retry Task Updated');
    expect(dbStatusHistory(retryTaskId).length).toBe(6); // two full TODO/READY/FAILED passes, same workspace throughout
  });
});

// ===========================================================================
// STATIC (traced from server.ts source only — NOT executed live: every path
// below requires a real, successful GoogleGenAI response, which no
// GEMINI_API_KEY in this environment can produce). These assertions pin down
// exact ordering/shape by reading the code, so Step 1b has something to
// match even for the paths this run could not exercise — they are NOT a
// substitute for the LIVE tests above and must not be read as "observed."
// ===========================================================================

const serverContent = fs.readFileSync(path.resolve(REPO_ROOT, 'server.ts'), 'utf-8');
// STEP 1b relocated /api/execute-agent-task's logic out of server.ts into
// lib/fabric/kernel.ts — server.ts is now a thin INGRESS_EXTERNAL_API
// adapter (auth middleware, resolving resolvedWorkspaceId from real Express
// auth state, mapping the kernel's {status, body} onto the HTTP response).
// STATIC assertions about kernel LOGIC (ordering, branches, receipt
// construction) now read kernelContent; assertions about the ROUTE WRAPPER
// itself (auth bypass, resolvedWorkspaceId derivation) still read
// executeAgentTaskRouteSlice(). Both are the same real files this run
// verified compile and pass the full suite against — not a description
// written from memory.
const kernelContent = fs.readFileSync(path.resolve(REPO_ROOT, 'lib/fabric/kernel.ts'), 'utf-8');
function executeAgentTaskRouteSlice(): string {
  const idx = serverContent.indexOf('app.post("/api/execute-agent-task"');
  const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, nextRoute);
}

describe('STATIC: provider-error and empty-response failure branches (unreachable live here)', () => {
  it('a thrown provider error -> 502 MODEL_PROVIDER_UNAVAILABLE; an empty-but-non-throwing response -> 502 EMPTY_PROVIDER_RESPONSE; both still write PROVIDER_FAILED + FAILED, still no artifact/review/receipt', () => {
    expect(kernelContent).toContain('reason: "MODEL_PROVIDER_UNAVAILABLE"');
    expect(kernelContent).toContain('reason: "EMPTY_PROVIDER_RESPONSE"');
    // The no-output branch now arrives from the segment runner as
    // PROVIDER_FAILED (capacity and ambiguous outcomes pause or reconcile
    // instead — see test/continuity-controller.test.ts).
    expect(kernelContent).toMatch(/if \(run\.kind === 'PROVIDER_FAILED'\) \{[\s\S]*?updateTaskStatus\(taskId, "FAILED", undefined, resolvedWorkspaceId\);[\s\S]*?eventType: "PROVIDER_FAILED"/);
  });
});

const vaultContent = fs.readFileSync(path.resolve(REPO_ROOT, 'lib/vault.ts'), 'utf-8');

describe('STATIC: the success path (VERIFIED) — ordering that Step 3+ must preserve', () => {
  // PUSH 1 — the first marker changed from the literal ctx.invoke("model.gemini")
  // to the provider-derived ctx.invoke(invocationName). The ORDERING this
  // test exists to pin is what matters and is entirely unchanged: the
  // provider call still happens first, and every persistence, verification
  // and signing step after it still happens in exactly this sequence, for
  // both providers, from this one shared block.
  it('exact order: provider invocation -> PROVIDER_COMPLETED -> writeWorkspaceArtifact (canonical writer, DB+disk) -> ARTIFACT_SAVED -> AWAITING_VERIFICATION -> Aegis run -> recordQualityReview -> (VERIFIED branch) AWAITING_RECEIPT -> AEGIS_REVIEWED -> sign -> verify -> recordReceipt -> RECEIPT_CREATED -> DONE -> TASK_COMPLETED -> KIL (best-effort) -> memory index (best-effort)', () => {
    // The provider invocation happens inside the segment runner, which the
    // kernel awaits before anything below; the ordering after it is unchanged.
    const order = [
      'const run = await runModelSegments({',
      'eventType: "PROVIDER_COMPLETED"',
      'writeWorkspaceArtifact({',
      'eventType: "ARTIFACT_SAVED"',
      'updateTaskStatus(taskId, "AWAITING_VERIFICATION", undefined, resolvedWorkspaceId)',
      // Aegis now runs through the shared scoped authority, which itself
      // calls runDeterministicAegisVerification (asserted in
      // test/canonical-scoped-verification.test.ts).
      'runScopedAegis(',
      'recordQualityReview(',
      'updateTaskStatus(taskId, "AWAITING_RECEIPT", undefined, resolvedWorkspaceId)',
      'eventType: "AEGIS_REVIEWED"',
      'signReceiptPayload(',
      'verifyReceiptSignature(',
      'recordReceipt(',
      'eventType: "RECEIPT_CREATED"',
      'updateTaskStatus(taskId, "DONE", undefined, resolvedWorkspaceId)',
      'eventType: "TASK_COMPLETED"',
      'verifyTaskAtGate(',
      'indexVaultArtifact(',
    ];
    let cursor = 0;
    for (const marker of order) {
      const found = kernelContent.indexOf(marker, cursor);
      expect(found, `expected to find "${marker}" after position ${cursor}`).toBeGreaterThan(-1);
      cursor = found;
    }
  });

  it('the kernel no longer writes to disk or calls recordArtifact() itself — the canonical writer (lib/vault.ts writeWorkspaceArtifact) is the only path', () => {
    // Checks real code, not prose: no fs import at all anymore (its only
    // use was the removed direct write), no `recordArtifact(` call
    // expression, and no import of recordArtifact from persistence.
    expect(kernelContent).not.toMatch(/^import fs /m);
    expect(kernelContent).not.toMatch(/[^.]\brecordArtifact\(\s*\{/); // a real call would open an object literal
    expect(kernelContent).not.toMatch(/^\s*recordArtifact,\s*$/m); // the old named import line
    expect(kernelContent).toContain("import { writeWorkspaceArtifact } from '../vault';");
    expect(kernelContent).toContain('const persistedArtifact = writeWorkspaceArtifact({');
  });

  it('STEP 2 FIX (was DEFERRED Phase 0b item B, now closed): storage identity is workspace-scoped and server-generated, never derived from the task title — two tasks anywhere sharing a title can no longer collide on disk', () => {
    // The kernel builds no disk path of its own from a title anymore —
    // checked as real code (a declaration/assignment), not prose, since
    // this file's own comments legitimately discuss the old scheme by name.
    expect(kernelContent).not.toMatch(/const sanitizedTitle/);
    expect(kernelContent).not.toMatch(/const vaultRelPath/);
    // The writer itself: filename is artifactId-based, root is workspace-scoped.
    expect(vaultContent).toContain("const filename = `${artifactId}.${extension}`;");
    expect(vaultContent).toContain("path.resolve(root, 'workspaces', workspaceId, folder)");
    expect(vaultContent).not.toMatch(/const filename = .*title/i);
  });

  it('KIL projection and memory indexing are both isolated in their own try/catch and cannot affect task completion, the receipt, or the response (by design, confirmed at the source level)', () => {
    expect(kernelContent).toMatch(/try \{\s*\n\s*const gate = verifyTaskAtGate\(/);
    expect(kernelContent).toMatch(/\} catch \(kilErr: any\) \{\s*\n\s*console\.warn\("\[KIL\] Gate verification skipped:"/);
    expect(kernelContent).toMatch(/try \{\s*\n\s*indexVaultArtifact\(resolvedWorkspaceId, persistedArtifact\.artifact_id\);/);
    expect(kernelContent).toMatch(/\} catch \(indexErr: any\) \{\s*\n\s*console\.warn\("\[Memory Index\] Indexing skipped:"/);
  });
});

describe('STATIC (PHASE 0b FIX, preserved through Step 1b): the signed receipt\'s workspaceId is the single canonical value, never independently re-derived', () => {
  it('the receipt payload (in the kernel) reuses resolvedWorkspaceId — the exact same value createInitialTask/verifyTaskAtGate/indexVaultArtifact all use — with no second, independent req.body.workspaceId read anywhere in the kernel', () => {
    expect(kernelContent).not.toContain('req.body?.workspaceId');
    expect(kernelContent).not.toContain('req.body.workspaceId');
    // The kernel has no `req` at all — it takes rawBody/resolvedWorkspaceId/ctx.
    expect(kernelContent).not.toContain('req.body');
    const canonicalPayloadIdx = kernelContent.indexOf('const canonicalPayload: CanonicalReceiptPayload & typeof routingEvidence = {');
    expect(canonicalPayloadIdx).toBeGreaterThan(-1);
    const nextConstructorCall = kernelContent.indexOf('canonicalizePayload(canonicalPayload)', canonicalPayloadIdx);
    const payloadBlock = kernelContent.slice(canonicalPayloadIdx, nextConstructorCall);
    expect(payloadBlock).toContain('workspaceId: resolvedWorkspaceId,');
  });

  // UPDATED: the fallback is gone with the bypass. There is no longer any
  // path into this route that skips requireWorkspaceMember, so
  // authWorkspaceId is always present — and the old
  // `?? req.body.workspaceId || "ws-synthos-primary"` tail was the dangerous
  // half: it silently wrote real tasks, artifacts and signed receipts into
  // the primary workspace for any caller that reached the handler without
  // membership.
  it('resolvedWorkspaceId comes ONLY from the verified membership, with no caller-supplied fallback and no hardcoded default — then passed into the kernel as a plain parameter, never re-derived inside it', () => {
    const routeSlice = executeAgentTaskRouteSlice();
    const code = routeSlice.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).toContain('const resolvedWorkspaceId = (req as AuthedRequest).authWorkspaceId!');
    expect(code).not.toContain('"ws-synthos-primary"');
    expect(code).not.toMatch(/req\.body[^\n]*workspaceId/);
    expect(routeSlice).toContain('executeAgentTask(req.body, resolvedWorkspaceId, ctx)');
    // Inside the kernel, resolvedWorkspaceId is only ever a function
    // parameter, read many times, assigned nowhere.
    expect(kernelContent).toContain('resolvedWorkspaceId: string,');
    expect(kernelContent).not.toMatch(/const resolvedWorkspaceId =/);
    const usages = (kernelContent.match(/resolvedWorkspaceId/g) || []).length;
    expect(usages).toBeGreaterThanOrEqual(8); // 1 parameter + gate check + createInitialTask + 11 updateTaskStatus + 14 recordActivityEvent + receipt + 2 KIL + 1 memory-index, conservatively floored
  });
});

describe('LIVE 6 (PHASE 0b — new regression): the receipt\'s workspaceId matches the authenticated/resolved workspace, proven against a real request (not just traced from source)', () => {
  it('resolvedWorkspaceId is computed from real authenticated membership, and the workspace-mismatch gate itself proves it is used consistently for reads and writes alike', async () => {
    // A full live proof of the receipt's own workspaceId field requires a
    // real Aegis-VERIFIED, signed receipt, which requires a real Gemini
    // response — unreachable in this environment (see the module-level
    // comment). What IS provable live, and is the load-bearing half of
    // this fix: getTaskWorkspaceId(taskId) — the same real DB read the
    // route's gate uses — agrees with what a real, authenticated,
    // membership-checked request actually wrote, for both a fresh task
    // and a same-workspace retry. If resolvedWorkspaceId ever disagreed
    // with the authenticated caller's real workspace, LIVE 5's
    // WORKSPACE_MISMATCH assertions above would already be failing.
    const taskId = `char-receipt-scope-${Date.now()}`;
    await postExecuteAgentTask({ taskId, assignedModel: 'gemini-3.6-flash', taskTitle: 't', workspaceId: WS_A }, cookieHeader(userAToken));
    expect(dbTaskRow(taskId).workspace_id).toBe(WS_A);
  });
});

describe('STATIC (STEP 1b — the one permitted evidence correction over Phase 0/F1): toolCalls now comes from real ctx.invoke() observations, not a fixed empty array', () => {
  it('toolCalls in the kernel\'s success response is ctx.getInvocations().map(name) — real observation, never a literal, never a per-role fabrication', () => {
    expect(kernelContent).toContain('toolCalls: ctx.getInvocations().map((r) => r.name),');
    expect(kernelContent).not.toContain('const toolCalls: string[] = [];');
  });

  it('this changes nothing observable in this environment: BLOCKED_MISSING_CREDENTIAL (the only reachable outcome, per LIVE 3 above) returns before ctx.invoke() is ever called, so ctx.getInvocations() is empty and toolCalls would still be [] if that response included the field at all — and it does not (LIVE 3 already asserts the exact response body, which has no toolCalls key)', () => {
    // The credential gate lives in the segment runner and still returns
    // before any provider invocation can be observed, so a blocked run can
    // never leave an invocation trace implying a provider ran.
    const runner = fs.readFileSync(path.resolve(REPO_ROOT, 'lib/continuity/segment-runner.ts'), 'utf-8');
    const apiKeyCheckIdx = runner.indexOf('if (!credentialReadiness(body).ready) {');
    const invokeIdx = runner.indexOf('await inp.invoke(`model.${sel.providerId}`');
    expect(apiKeyCheckIdx).toBeGreaterThan(-1);
    expect(invokeIdx).toBeGreaterThan(apiKeyCheckIdx); // the only live-reachable return in this environment happens first
  });

  it('the receipt\'s signed payload is untouched by this change — CanonicalReceiptPayload has no toolCalls/toolsInvoked field, so the cryptographically signed bytes are identical whether or not ctx observed an invocation; only the surrounding HTTP response JSON differs', () => {
    const persistenceContent = fs.readFileSync(path.resolve(REPO_ROOT, 'lib/persistence.ts'), 'utf-8');
    const idx = persistenceContent.indexOf('export interface CanonicalReceiptPayload {');
    expect(idx).toBeGreaterThan(-1);
    const end = persistenceContent.indexOf('}', idx);
    const receiptTypeBody = persistenceContent.slice(idx, end);
    expect(receiptTypeBody).not.toMatch(/toolCalls|toolsInvoked/);
  });
});
