import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import net from 'node:net';

// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 1a: characterization test.
//
// Purpose (per the binding spec, Section 6, Step 1a): snapshot every
// externally observable side effect of the UNMODIFIED POST
// /api/execute-agent-task route (server.ts:1452-2117) BEFORE any extraction
// work touches it. This becomes the behavioral oracle Step 1b must match.
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
// characterization, not a description of the source code.
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
    const { status, json } = await postExecuteAgentTask({ taskId, taskTitle: 'char test', workspaceId: WS_A });
    expect(status).toBe(401);
    expect(json).toMatchObject({ success: false });
    expect(dbTaskRow(taskId)).toBeUndefined();
  });
});

describe('LIVE 2: workspace membership is required — real session, wrong workspace, zero side effects', () => {
  it('user B (member of WS_B only) claiming WS_A -> 403, and the handler never runs', async () => {
    const taskId = `char-forbidden-${Date.now()}`;
    const { status, json } = await postExecuteAgentTask(
      { taskId, taskTitle: 'char test', workspaceId: WS_A },
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
    await postExecuteAgentTask({ taskId, taskTitle: 't', workspaceId: WS_A }, cookieHeader(userAToken));

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
    await postExecuteAgentTask({ taskId, taskTitle: 't', workspaceId: WS_A }, cookieHeader(userAToken));

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

describe('LIVE 4 (SURPRISING/UNSAFE — reported, not fixed): gate ordering makes the model-support check unreachable whenever the API key is missing', () => {
  it('an UNSUPPORTED model (e.g. "gpt-4") still returns BLOCKED_MISSING_CREDENTIAL, never PROVIDER_UNSUPPORTED, because the API-key check runs first', async () => {
    const taskId = `char-gate-order-${Date.now()}`;
    const { status, json } = await postExecuteAgentTask(
      { taskId, taskTitle: 't', assignedModel: 'gpt-4', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    expect(status).toBe(400);
    expect(json.reason).toBe('BLOCKED_MISSING_CREDENTIAL');
    expect(json.reason).not.toBe('PROVIDER_UNSUPPORTED');
    // The task still reaches FAILED via the credential gate, not the model
    // gate — same terminal state, different (and in this environment, only
    // ever the credential) reason.
    expect(dbTaskRow(taskId).status).toBe('FAILED');
  });
});

describe('LIVE 5 (SURPRISING/UNSAFE — reported, not fixed): a client-supplied taskId is trusted across workspace boundaries', () => {
  it('reusing an existing task_id from Workspace A inside a real, authorized Workspace B request silently reassigns that task to Workspace B', async () => {
    const sharedTaskId = `char-hijack-${Date.now()}`;

    // Step 1: user A, a real member of WS_A, creates a task under that id.
    const first = await postExecuteAgentTask(
      { taskId: sharedTaskId, taskTitle: 'Original A Title', description: 'owned by A', assignedAgent: 'scout', workspaceId: WS_A },
      cookieHeader(userAToken)
    );
    expect(first.status).toBe(400); // BLOCKED_MISSING_CREDENTIAL, as characterized above
    expect(dbTaskRow(sharedTaskId).workspace_id).toBe(WS_A);
    expect(dbTaskRow(sharedTaskId).title).toBe('Original A Title');
    const historyAfterFirst = dbStatusHistory(sharedTaskId);
    expect(historyAfterFirst.length).toBe(3); // TODO, READY, FAILED

    // Step 2: user B — a real, legitimately authorized member of WS_B, with
    // NO membership in WS_A whatsoever — sends a new request for WS_B that
    // happens to reuse the SAME task_id. requireWorkspaceMember(fromBody)
    // only checks "is this caller a member of the workspaceId in the body"
    // (WS_B: yes) — it has no concept of "does this task_id already belong
    // to a workspace this caller cannot access." createInitialTask() then
    // UPSERTs: since the task_id already exists, it overwrites
    // workspace_id/title/description/assigned_agent/assigned_model in place
    // rather than rejecting or creating a new row.
    const second = await postExecuteAgentTask(
      { taskId: sharedTaskId, taskTitle: 'Hijacked By B', description: 'reassigned by B', assignedAgent: 'dev', workspaceId: WS_B },
      cookieHeader(userBToken)
    );
    expect(second.status).toBe(400); // Still just BLOCKED_MISSING_CREDENTIAL — nothing about this rejects the hijack.

    const rowAfterSecond = dbTaskRow(sharedTaskId);
    // The task that started in WS_A, owned by user A, now belongs to WS_B —
    // user B, who never had access to WS_A, has overwritten a WS_A task's
    // ownership, title, and description using only their own real,
    // legitimate WS_B membership.
    expect(rowAfterSecond.workspace_id).toBe(WS_B);
    expect(rowAfterSecond.title).toBe('Hijacked By B');
    expect(rowAfterSecond.description).toBe('reassigned by B');
    expect(rowAfterSecond.assigned_agent).toBe('dev');

    // The status-history row from user A's original TODO is never deleted —
    // it's still there, now sitting underneath a task the history no longer
    // has full custody of. A second full TODO->READY->FAILED sequence is
    // appended on top by B's request, so the table now shows 6 rows for one
    // task_id, 3 of which were written before B ever had any claim to it.
    const historyAfterSecond = dbStatusHistory(sharedTaskId);
    expect(historyAfterSecond.length).toBe(6);
    expect(historyAfterSecond.map((h: any) => h.status)).toEqual(['TODO', 'READY', 'FAILED', 'TODO', 'READY', 'FAILED']);

    // Likewise activity_events: A's three events (TASK_CREATED,
    // AGENT_ASSIGNED, PROVIDER_FAILED) are still on disk under this
    // task_id, now joined by B's three — a full mixed-ownership event log
    // for a single task_id, readable by anyone who can read WS_B's tasks
    // (whatever route surfaces that; not itself re-verified here).
    const eventsAfterSecond = dbActivityEvents(sharedTaskId);
    expect(eventsAfterSecond.length).toBe(6);
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
function executeAgentTaskRouteSlice(): string {
  const idx = serverContent.indexOf('app.post("/api/execute-agent-task"');
  const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, nextRoute);
}

describe('STATIC: provider-error and empty-response failure branches (unreachable live here)', () => {
  const slice = executeAgentTaskRouteSlice();

  it('a thrown provider error -> 502 MODEL_PROVIDER_UNAVAILABLE; an empty-but-non-throwing response -> 502 EMPTY_PROVIDER_RESPONSE; both still write PROVIDER_FAILED + FAILED, still no artifact/review/receipt', () => {
    expect(slice).toContain('reason: "MODEL_PROVIDER_UNAVAILABLE"');
    expect(slice).toContain('reason: "EMPTY_PROVIDER_RESPONSE"');
    expect(slice).toMatch(/if \(!executionOutput\) \{[\s\S]*?updateTaskStatus\(taskId, "FAILED"\);[\s\S]*?eventType: "PROVIDER_FAILED"/);
  });
});

describe('STATIC: the success path (VERIFIED) — ordering that Step 1b must preserve', () => {
  const slice = executeAgentTaskRouteSlice();

  it('exact order: PROVIDER_COMPLETED -> disk write -> recordArtifact (DB+disk) -> ARTIFACT_SAVED -> AWAITING_VERIFICATION -> Aegis run -> recordQualityReview -> (VERIFIED branch) AWAITING_RECEIPT -> AEGIS_REVIEWED -> sign -> verify -> recordReceipt -> RECEIPT_CREATED -> DONE -> TASK_COMPLETED -> KIL (best-effort) -> memory index (best-effort)', () => {
    const order = [
      'eventType: "PROVIDER_COMPLETED"',
      'fs.writeFileSync(vaultDiskPath',
      'recordArtifact(',
      'eventType: "ARTIFACT_SAVED"',
      'updateTaskStatus(taskId, "AWAITING_VERIFICATION")',
      'runDeterministicAegisVerification(',
      'recordQualityReview(',
      'updateTaskStatus(taskId, "AWAITING_RECEIPT")',
      'eventType: "AEGIS_REVIEWED"',
      'signReceiptPayload(',
      'verifyReceiptSignature(',
      'recordReceipt(',
      'eventType: "RECEIPT_CREATED"',
      'updateTaskStatus(taskId, "DONE")',
      'eventType: "TASK_COMPLETED"',
      'verifyTaskAtGate(',
      'indexVaultArtifact(',
    ];
    let cursor = 0;
    for (const marker of order) {
      const found = slice.indexOf(marker, cursor);
      expect(found, `expected to find "${marker}" after position ${cursor}`).toBeGreaterThan(-1);
      cursor = found;
    }
  });

  it('the artifact disk path is derived from the task title alone, NOT workspaceId or taskId (SURPRISING/UNSAFE, reported, not fixed): two tasks in ANY workspaces sharing a sanitized title silently overwrite each other\'s file on disk', () => {
    expect(slice).toContain('const vaultRelPath = `Startup-Theses/${sanitizedTitle}.md`');
    expect(slice).not.toMatch(/vaultRelPath = `.*workspaceId.*Startup-Theses/);
    expect(slice).not.toMatch(/vaultRelPath = `.*taskId.*Startup-Theses/);
  });

  it('KIL projection and memory indexing are both isolated in their own try/catch and cannot affect task completion, the receipt, or the response (by design, confirmed at the source level)', () => {
    expect(slice).toMatch(/try \{\s*\n\s*const gate = verifyTaskAtGate\(/);
    expect(slice).toMatch(/\} catch \(kilErr: any\) \{\s*\n\s*console\.warn\("\[KIL\] Gate verification skipped:"/);
    expect(slice).toMatch(/try \{\s*\n\s*indexVaultArtifact\(workspaceId, persistedArtifact\.artifact_id\);/);
    expect(slice).toMatch(/\} catch \(indexErr: any\) \{\s*\n\s*console\.warn\("\[Memory Index\] Indexing skipped:"/);
  });
});

describe('STATIC (SURPRISING/UNSAFE — reported, not fixed): the signed receipt\'s workspaceId is re-derived independently of the task\'s real workspace_id', () => {
  const slice = executeAgentTaskRouteSlice();

  it('the receipt payload reads req.body.workspaceId a second time with its own fallback, instead of reusing the already-resolved `workspaceId` variable used for the task/artifact/KIL/memory-index calls', () => {
    // The rest of the route (createInitialTask, updateTaskStatus,
    // recordActivityEvent, verifyTaskAtGate, indexVaultArtifact) all use the
    // single `workspaceId` destructured once at the top (default applies
    // only when the field is OMITTED). The receipt instead does:
    expect(slice).toContain('workspaceId: req.body?.workspaceId || "ws-synthos-primary"');
    // `||` defaults on ANY falsy value, including an explicitly-supplied
    // empty string — which the top-level destructuring default does NOT
    // catch (JS default parameters only apply to `undefined`). A request
    // with workspaceId: "" would (if it ever got this far — it cannot in
    // this environment, and would in fact be rejected earlier by
    // requireWorkspaceMember's resolveWorkspaceId, which explicitly treats
    // an empty string as invalid, UNLESS reached via the x-internal-
    // service-token bypass, which skips that middleware entirely) create
    // the task under workspace_id "" while its own receipt CLAIMS
    // workspace "ws-synthos-primary" — a real mismatch between what was
    // written and what the signed receipt says was written.
    expect(slice).toMatch(/const canonicalPayload: CanonicalReceiptPayload = \{[\s\S]{0,50}receiptId,[\s\S]{0,50}taskId,[\s\S]{0,80}workspaceId: req\.body\?\.workspaceId/);
  });
});

describe('STATIC: toolCalls after Phase 0 (F1) — confirmed honest, cross-referenced against the live BLOCKED_MISSING_CREDENTIAL response', () => {
  it('toolCalls is a fixed const [] in the route source (Phase 0, commit c0083dc) — the live response in LIVE 3 never included the field at all because BLOCKED_MISSING_CREDENTIAL returns before the response object containing toolCalls is ever built; this static check pins the source guarantee for the path this environment cannot reach', () => {
    expect(executeAgentTaskRouteSlice()).toContain('const toolCalls: string[] = [];');
  });
});
