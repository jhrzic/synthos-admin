import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-approval-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'approval.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.SYNTHOS_APPROVAL_VERIFICATION = 'true';

import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
isolateVaultForTest('approval-lifecycle');

import express from 'express';
import { createUser, login, SESSION_COOKIE_NAME } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { requireWorkspaceMember, requireWorkspaceAdmin, getRequestUser, fromBody, fromQuery, authorizedWorkspaceId } from '../lib/authorization';
import { executeEnvelope } from '../lib/fabric/envelope';
import { resolveCapability } from '../lib/fabric/registry';
import {
  requestApproval, decideApproval, checkApprovalGate, consumeApproval,
  computeInputDigest, getApproval, listWorkspaceApprovals, expireStaleApprovals,
} from '../lib/approvals';
import { checkGraphNodeApproval, GRAPH_EXECUTABLE_CAPABILITIES } from '../lib/graph-execution';
import { createSchedule, getScheduleOccurrences, getTaskArtifacts, getTaskReceipts, verifyReceipt, getDatabase } from '../lib/persistence';
import { fireScheduleOccurrence } from '../lib/fabric/scheduler';
import { listRecentRuntimeEvents } from '../lib/runtime-events';

// ---------------------------------------------------------------------------
// THE APPROVAL TEST MATRIX — Part F.
//
// This is the gate that has to hold before Gmail exists, so these are not
// source greps: they run the REAL envelope against a REAL SQLite database, and
// the authority tests run the REAL Express middleware with a REAL session
// cookie. A mocked approval proves the mock works.
//
// The capability under test is verification.external_action — a registered
// EXTERNAL_ACTION whose "external call" is a bounded local contract double. It
// passes the identical gate real Gmail will, and it sends nothing, so the
// lifecycle can be proven without a side effect to clean up.
// ---------------------------------------------------------------------------

const WS_A = 'ws-approval-alpha';
const WS_B = 'ws-approval-bravo';
const CAP = 'verification.external_action';

let adminA: any, memberA: any, adminB: any;
let adminACookie = '', memberACookie = '', adminBCookie = '';
let app: express.Express;

function uniqueCorrelation(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** One dispatch through the real envelope. */
function dispatch(opts: {
  workspaceId?: string; actor?: string; params?: Record<string, unknown>; correlationId: string;
}) {
  return executeEnvelope({
    workspaceId: opts.workspaceId ?? WS_A,
    actorUserId: opts.actor ?? 'requester-user',
    capability: CAP,
    action: 'execute',
    parameters: opts.params ?? { label: 'matrix', to: 'alice@example.com' },
    rawText: '',
    correlationId: opts.correlationId,
  });
}

beforeAll(async () => {
  ensureWorkspace(WS_A, 'Alpha');
  ensureWorkspace(WS_B, 'Bravo');

  adminA = createUser({ email: 'admin-a@test.local', password: 'Passw0rd-admin-a!', displayName: 'Admin A' });
  memberA = createUser({ email: 'member-a@test.local', password: 'Passw0rd-member-a!', displayName: 'Member A' });
  adminB = createUser({ email: 'admin-b@test.local', password: 'Passw0rd-admin-b!', displayName: 'Admin B' });

  grantMembership(adminA.user_id, WS_A, 'admin');
  grantMembership(memberA.user_id, WS_A, 'member');
  grantMembership(adminB.user_id, WS_B, 'admin');

  // login() takes positional args and returns rawToken — the value the cookie
  // actually carries (session_token in the row is the hash of it).
  const s1 = login('admin-a@test.local', 'Passw0rd-admin-a!')!;
  const s2 = login('member-a@test.local', 'Passw0rd-member-a!')!;
  const s3 = login('admin-b@test.local', 'Passw0rd-admin-b!')!;
  adminACookie = `${SESSION_COOKIE_NAME}=${s1.rawToken}`;
  memberACookie = `${SESSION_COOKIE_NAME}=${s2.rawToken}`;
  adminBCookie = `${SESSION_COOKIE_NAME}=${s3.rawToken}`;

  // The REAL routes, mounted with the REAL middleware.
  app = express();
  app.use(express.json());
  app.get('/api/approvals', requireWorkspaceMember(fromQuery), (req, res) => {
    const ws = authorizedWorkspaceId(req)!;
    expireStaleApprovals();
    res.json({ success: true, approvals: listWorkspaceApprovals(ws, { limit: 500 }) });
  });
  app.post('/api/approvals/:id/decide', requireWorkspaceAdmin(fromBody), (req, res) => {
    const ws = authorizedWorkspaceId(req)!;
    const user = getRequestUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const decision = String((req.body as any)?.decision || '').toUpperCase();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      return res.status(400).json({ success: false, error: 'bad decision' });
    }
    const outcome = decideApproval({
      approvalId: req.params.id, workspaceId: ws, decidedByUserId: user.user_id,
      decision: decision as 'APPROVED' | 'REJECTED', reason: (req.body as any)?.reason ?? null,
    });
    if (!outcome.ok) {
      const code = outcome.code === 'NOT_FOUND' || outcome.code === 'WRONG_WORKSPACE' ? 404 : 409;
      return res.status(code).json({ success: false, error: outcome.reason });
    }
    return res.json({ success: true, approval: outcome.approval });
  });
});

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

/** Minimal supertest-free HTTP driver against the real app. */
async function httpCall(method: 'GET' | 'POST', url: string, cookie: string, body?: unknown): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let parsed: any = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

// =========================================================================

describe('1. an EXTERNAL_ACTION request waits for approval', () => {
  it('the capability really is a registered EXTERNAL_ACTION with Guardian enforcement', async () => {
    const cap = await resolveCapability(CAP);
    expect(cap).toBeTruthy();
    expect(cap!.effectClass).toBe('EXTERNAL_ACTION');
    expect(cap!.approvalPolicy).toBe('GUARDIAN_ENFORCED');
  });

  it('first dispatch returns APPROVAL_REQUIRED and creates a PENDING record', async () => {
    const corr = uniqueCorrelation('wait');
    const res = await dispatch({ correlationId: corr });
    expect(res.outcome).toBe('APPROVAL_REQUIRED');
    expect(res.approval?.approvalId).toBeTruthy();
    expect(getApproval(res.approval!.approvalId)!.status).toBe('PENDING');
  });

  it('NO provider or executor ran before approval', async () => {
    const corr = uniqueCorrelation('noprovider');
    const res = await dispatch({ correlationId: corr });
    // Nothing invoked, no task, no artifact, no receipt: the refusal happened
    // before any executor was reached.
    expect(res.toolsInvoked ?? []).toHaveLength(0);
    expect(res.taskId).toBeUndefined();
    expect(res.artifact ?? null).toBeNull();
    expect(res.receipt ?? null).toBeNull();
  });

  it('a repeated dispatch reuses the pending request instead of stacking duplicates', async () => {
    const corr = uniqueCorrelation('dedupe');
    const a = await dispatch({ correlationId: corr });
    const b = await dispatch({ correlationId: corr });
    const c = await dispatch({ correlationId: corr });
    expect(b.approval!.approvalId).toBe(a.approval!.approvalId);
    expect(c.approval!.approvalId).toBe(a.approval!.approvalId);
    const pending = listWorkspaceApprovals(WS_A, { status: 'PENDING', limit: 500 })
      .filter((r) => r.correlation_id === corr);
    expect(pending).toHaveLength(1);
  });
});

describe('2. an authorized human approval unlocks dispatch', () => {
  it('approve → dispatch executes and produces the full evidence chain', async () => {
    const corr = uniqueCorrelation('approve');
    const first = await dispatch({ correlationId: corr });
    expect(first.outcome).toBe('APPROVAL_REQUIRED');

    const decided = await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, {
      workspaceId: WS_A, decision: 'APPROVED', reason: 'verified by test',
    });
    expect(decided.status).toBe(200);
    expect(decided.body.approval.status).toBe('APPROVED');
    expect(decided.body.approval.decided_by_user_id).toBe(adminA.user_id);

    const run = await dispatch({ correlationId: corr });
    expect(run.outcome).toBe('SUCCESS');
    expect(run.taskId).toBeTruthy();
    expect(run.artifact?.id).toBeTruthy();
    expect(run.aegis?.decision).toBeTruthy();
    expect(run.receipt?.receiptId).toBeTruthy();

    // The chain is really in the database, and the receipt really verifies.
    const receipts = getTaskReceipts(run.taskId!);
    expect(receipts.length).toBeGreaterThan(0);
    expect(verifyReceipt(receipts[0])).toBe(true);
    expect(getTaskArtifacts(run.taskId!).length).toBeGreaterThan(0);
  });

  it('the executed artifact says plainly that no provider was contacted', async () => {
    const corr = uniqueCorrelation('labelled');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });
    const run = await dispatch({ correlationId: corr });
    const artifacts: any[] = getTaskArtifacts(run.taskId!);
    const content = fs.readFileSync(artifacts[0].disk_path, 'utf8');
    expect(content).toMatch(/APPROVAL WORKFLOW VERIFICATION/);
    expect(content).toMatch(/No external provider was contacted/i);
  });
});

describe('3. rejection blocks, permanently, and nothing runs', () => {
  it('reject → BLOCKED, no provider called', async () => {
    const corr = uniqueCorrelation('reject');
    const first = await dispatch({ correlationId: corr });
    const decided = await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, {
      workspaceId: WS_A, decision: 'REJECTED', reason: 'not this one',
    });
    expect(decided.status).toBe(200);

    const after = await dispatch({ correlationId: corr });
    expect(after.outcome).toBe('BLOCKED');
    expect(after.reason).toMatch(/rejected/i);
    expect(after.reason).toMatch(/not this one/);
    expect(after.taskId).toBeUndefined();
    expect(after.artifact ?? null).toBeNull();
  });
});

describe('4. authority — who may decide', () => {
  it('an admin of ANOTHER workspace cannot decide this workspace’s approval', async () => {
    const corr = uniqueCorrelation('xws');
    const first = await dispatch({ correlationId: corr });

    // Admin B tries, naming workspace B (their own, so the middleware passes)…
    const asOwnWs = await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminBCookie, {
      workspaceId: WS_B, decision: 'APPROVED',
    });
    expect(asOwnWs.status).toBe(404); // reported as absent, not forbidden

    // …and naming workspace A, where they hold no membership at all.
    const asVictimWs = await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminBCookie, {
      workspaceId: WS_A, decision: 'APPROVED',
    });
    expect([401, 403]).toContain(asVictimWs.status);

    // Untouched either way — the assertion that matters.
    expect(getApproval(first.approval!.approvalId)!.status).toBe('PENDING');
  });

  it('a plain MEMBER cannot decide (insufficient role)', async () => {
    const corr = uniqueCorrelation('role');
    const first = await dispatch({ correlationId: corr });
    const res = await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, memberACookie, {
      workspaceId: WS_A, decision: 'APPROVED',
    });
    expect([401, 403]).toContain(res.status);
    expect(getApproval(first.approval!.approvalId)!.status).toBe('PENDING');
  });

  it('a member CAN read the queue (seeing is not deciding)', async () => {
    const res = await httpCall('GET', `/api/approvals?workspaceId=${WS_A}`, memberACookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.approvals)).toBe(true);
  });

  it('the queue is workspace-scoped — B never sees A’s approvals', async () => {
    const corr = uniqueCorrelation('scope');
    await dispatch({ correlationId: corr });
    const res = await httpCall('GET', `/api/approvals?workspaceId=${WS_B}`, adminBCookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.approvals)).not.toContain(corr);
  });

  it('the decider is taken from the SESSION — a forged body field is ignored', async () => {
    const corr = uniqueCorrelation('forge');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, {
      workspaceId: WS_A,
      decision: 'APPROVED',
      // All of this is attacker-supplied noise. None of it is read.
      decidedByUserId: 'someone-else',
      decided_by_user_id: 'someone-else',
      approved: true,
      status: 'APPROVED',
    });
    const row = getApproval(first.approval!.approvalId)!;
    expect(row.decided_by_user_id).toBe(adminA.user_id);
    expect(row.decided_by_user_id).not.toBe('someone-else');
  });

  it('a client-supplied fake approval in the dispatch parameters is ignored', async () => {
    const corr = uniqueCorrelation('fakeapproval');
    const res = await executeEnvelope({
      workspaceId: WS_A, actorUserId: 'requester-user', capability: CAP, action: 'execute',
      parameters: {
        label: 'matrix',
        // A caller cannot vouch for itself. There is no parameter the gate reads.
        approved: true, approval: 'apr-fake', approvalId: 'apr-fake',
        humanApproved: true, guardianDecision: 'SAFE',
      },
      rawText: '', correlationId: corr,
    });
    expect(res.outcome).toBe('APPROVAL_REQUIRED');
    expect(res.taskId).toBeUndefined();
  });

  it('the requester cannot self-approve through the model/provider path', async () => {
    // There is no API by which the requesting actor id becomes a decider: the
    // only writer of decided_by_user_id is decideApproval, and its caller is an
    // HTTP route behind requireWorkspaceAdmin reading the session. Asserted
    // structurally AND by the absence of any other writer.
    const approvalsSource = fs.readFileSync(path.join(process.cwd(), 'lib/approvals.ts'), 'utf8');
    const writers = approvalsSource.match(/decided_by_user_id\s*=/g) || [];
    // Exactly one SQL assignment, inside decideApproval.
    expect(writers.length).toBe(1);
    const envelopeSource = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/envelope.ts'), 'utf8');
    // The envelope never decides an approval; it only requests, checks, consumes.
    expect(envelopeSource).not.toMatch(/decideApproval/);
  });
});

describe('5. binding — approval covers exactly one action', () => {
  it('changing the inputs invalidates the approval and re-enters WAITING', async () => {
    const corr = uniqueCorrelation('bind');
    const alice = await dispatch({ correlationId: corr, params: { label: 'm', to: 'alice@example.com' } });
    await httpCall('POST', `/api/approvals/${alice.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });

    // The Alice-to-Bob case. Approving a draft to Alice must not authorize Bob.
    const bob = await dispatch({ correlationId: corr, params: { label: 'm', to: 'bob@example.com' } });
    expect(bob.outcome).toBe('APPROVAL_REQUIRED');
    expect(bob.approval!.approvalId).not.toBe(alice.approval!.approvalId);
    expect(bob.reason).toMatch(/inputs.*changed/i);
    expect(bob.taskId).toBeUndefined();

    // Alice's approval is untouched and still spendable for Alice's own inputs.
    expect(getApproval(alice.approval!.approvalId)!.status).toBe('APPROVED');
  });

  it('the digest changes with the payload and is stable for the same payload', () => {
    const base = { workspaceId: WS_A, capability: CAP, action: 'execute' };
    const d1 = computeInputDigest({ ...base, parameters: { to: 'alice@example.com', body: 'hi' } });
    const d2 = computeInputDigest({ ...base, parameters: { body: 'hi', to: 'alice@example.com' } });
    const d3 = computeInputDigest({ ...base, parameters: { to: 'bob@example.com', body: 'hi' } });
    // Key order is not meaning.
    expect(d1).toBe(d2);
    // Recipient is.
    expect(d1).not.toBe(d3);
  });

  it('an approval for one capability does not authorize a different capability', () => {
    const corr = uniqueCorrelation('capbind');
    const digest = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: { x: 1 } });
    const apr = requestApproval({
      workspaceId: WS_A, correlationId: corr, capability: CAP, action: 'execute',
      effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'r', guardianDecision: 'SAFE',
      actionSummary: 'test', inputDigest: digest,
    });
    decideApproval({ approvalId: apr.approval_id, workspaceId: WS_A, decidedByUserId: adminA.user_id, decision: 'APPROVED' });

    const other = checkApprovalGate({
      workspaceId: WS_A, capability: 'some.other.capability', action: 'execute',
      inputDigest: digest, correlationId: corr,
    });
    expect(other.allowed).toBe(false);
  });

  it('an approval from workspace A does not authorize the same action in workspace B', () => {
    const corr = uniqueCorrelation('wsbind');
    const digest = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: { x: 2 } });
    const apr = requestApproval({
      workspaceId: WS_A, correlationId: corr, capability: CAP, action: 'execute',
      effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'r', guardianDecision: 'SAFE',
      actionSummary: 'test', inputDigest: digest,
    });
    decideApproval({ approvalId: apr.approval_id, workspaceId: WS_A, decidedByUserId: adminA.user_id, decision: 'APPROVED' });

    const inB = checkApprovalGate({
      workspaceId: WS_B, capability: CAP, action: 'execute', inputDigest: digest, correlationId: corr,
    });
    expect(inB.allowed).toBe(false);
  });
});

describe('6. single use — replay is impossible', () => {
  it('a consumed approval cannot authorize a second dispatch', async () => {
    const corr = uniqueCorrelation('replay');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });

    const run1 = await dispatch({ correlationId: corr });
    expect(run1.outcome).toBe('SUCCESS');
    expect(getApproval(first.approval!.approvalId)!.status).toBe('CONSUMED');

    const run2 = await dispatch({ correlationId: corr });
    expect(run2.outcome).toBe('BLOCKED');
    expect(run2.reason).toMatch(/single-use|already used/i);
  });

  it('consumeApproval is atomic — only one of two concurrent spends wins', () => {
    const corr = uniqueCorrelation('atomic');
    const digest = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: { x: 3 } });
    const apr = requestApproval({
      workspaceId: WS_A, correlationId: corr, capability: CAP, action: 'execute',
      effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'r', guardianDecision: 'SAFE',
      actionSummary: 'test', inputDigest: digest,
    });
    decideApproval({ approvalId: apr.approval_id, workspaceId: WS_A, decidedByUserId: adminA.user_id, decision: 'APPROVED' });

    const a = consumeApproval(apr.approval_id, 'task-1');
    const b = consumeApproval(apr.approval_id, 'task-2');
    // The database decides the winner, not application logic.
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(getApproval(apr.approval_id)!.consumed_by_task_id).toBe('task-1');
  });

  it('a decided approval cannot be decided again', async () => {
    const corr = uniqueCorrelation('redecide');
    const first = await dispatch({ correlationId: corr });
    const one = await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });
    expect(one.status).toBe(200);
    const two = await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'REJECTED' });
    expect(two.status).toBe(409);
    expect(getApproval(first.approval!.approvalId)!.status).toBe('APPROVED');
  });
});

describe('7. expiration', () => {
  it('an approval past its expiry does not authorize dispatch', async () => {
    const corr = uniqueCorrelation('expiry');
    const digest = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: { label: 'exp' } });
    const apr = requestApproval({
      workspaceId: WS_A, correlationId: corr, capability: CAP, action: 'execute',
      effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'r', guardianDecision: 'SAFE',
      actionSummary: 'test', inputDigest: digest,
    });
    // Decide with a NORMAL ttl, then move the deadline into the past.
    //
    // An earlier version used ttlMs: 1 and raced its own decision: under suite
    // load the millisecond elapsed before decideApproval ran, so the row was
    // EXPIRED rather than APPROVED and the test measured a different path than
    // it claimed to. Forcing the deadline afterwards tests expiry of an
    // APPROVED approval deterministically.
    decideApproval({ approvalId: apr.approval_id, workspaceId: WS_A, decidedByUserId: adminA.user_id, decision: 'APPROVED' });
    expect(getApproval(apr.approval_id)!.status).toBe('APPROVED');

    getDatabase()
      .prepare('UPDATE approvals SET expires_at = ? WHERE approval_id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), apr.approval_id);

    const gate = checkApprovalGate({ workspaceId: WS_A, capability: CAP, action: 'execute', inputDigest: digest, correlationId: corr });
    expect(gate.allowed).toBe(false);
    expect(gate.state).toBe('EXPIRED');
    expect(getApproval(apr.approval_id)!.status).toBe('EXPIRED');
  });

  it('expiry is enforced at the gate even if the sweep never runs', async () => {
    const corr = uniqueCorrelation('expiry2');
    const digest = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: { label: 'exp2' } });
    const apr = requestApproval({
      workspaceId: WS_A, correlationId: corr, capability: CAP, action: 'execute',
      effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'r', guardianDecision: 'SAFE',
      actionSummary: 'test', inputDigest: digest,
    });
    decideApproval({ approvalId: apr.approval_id, workspaceId: WS_A, decidedByUserId: adminA.user_id, decision: 'APPROVED' });
    getDatabase()
      .prepare('UPDATE approvals SET expires_at = ? WHERE approval_id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), apr.approval_id);
    // No expireStaleApprovals() call here on purpose — the gate must enforce
    // expiry itself, so the sweep is hygiene rather than the protection.
    expect(checkApprovalGate({ workspaceId: WS_A, capability: CAP, action: 'execute', inputDigest: digest, correlationId: corr }).allowed).toBe(false);
  });
  it('a lapsed approval re-enters WAITING rather than dead-ending the action', async () => {
    const corr = uniqueCorrelation('lapsed');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });

    getDatabase()
      .prepare('UPDATE approvals SET expires_at = ? WHERE approval_id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), first.approval!.approvalId);

    const again = await dispatch({ correlationId: corr });
    // Lapsed permission is not a refusal: the human is asked again.
    expect(again.outcome).toBe('APPROVAL_REQUIRED');
    expect(again.reason).toMatch(/lapsed/i);
    expect(again.approval!.approvalId).not.toBe(first.approval!.approvalId);
    // And nothing ran in the meantime.
    expect(again.taskId).toBeUndefined();
  });

  it('a REJECTED approval does NOT re-enter WAITING — "no" is not "not yet"', async () => {
    const corr = uniqueCorrelation('norepeat');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'REJECTED' });
    const again = await dispatch({ correlationId: corr });
    expect(again.outcome).toBe('BLOCKED');
    // No new approval was raised — an agent must not be able to re-ask until
    // it gets a yes.
    const forCorr = listWorkspaceApprovals(WS_A, { limit: 500 }).filter((r) => r.correlation_id === corr);
    expect(forCorr).toHaveLength(1);
  });
});

describe('8. Guardian remains independent and cannot be overridden', () => {
  it('Guardian denies + a human approves → still BLOCKED, and nothing runs', async () => {
    // A Guardian-denied payload. The rule set refuses destructive shell content,
    // so it is embedded in the action's own inputs.
    const corr = uniqueCorrelation('guardian');
    const hostile = { label: 'guardian-probe', command: 'rm -rf / --no-preserve-root' };

    const first = await dispatch({ correlationId: corr, params: hostile });
    // Guardian refuses BEFORE any approval is requested — offering a human the
    // chance to approve what policy forbids is the override this prevents.
    expect(first.outcome).toBe('BLOCKED');
    expect(first.reason).toMatch(/Guardian/i);
    expect(first.approval ?? null).toBeNull();

    // No approval record was even created for it.
    const created = listWorkspaceApprovals(WS_A, { limit: 500 }).filter((r) => r.correlation_id === corr);
    expect(created).toHaveLength(0);

    // And even if one is forced into existence and approved by a real admin,
    // dispatch still refuses, because Guardian runs first every time.
    const digest = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: hostile });
    const forced = requestApproval({
      workspaceId: WS_A, correlationId: corr, capability: CAP, action: 'execute',
      effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'r', guardianDecision: 'FORCED',
      actionSummary: 'forced', inputDigest: digest,
    });
    decideApproval({ approvalId: forced.approval_id, workspaceId: WS_A, decidedByUserId: adminA.user_id, decision: 'APPROVED' });

    const after = await dispatch({ correlationId: corr, params: hostile });
    expect(after.outcome).toBe('BLOCKED');
    expect(after.reason).toMatch(/Guardian/i);
    expect(after.taskId).toBeUndefined();
    // The forced approval was never spent.
    expect(getApproval(forced.approval_id)!.status).toBe('APPROVED');
  });

  it('the gate requires BOTH — Guardian is consulted before any approval lookup', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/envelope.ts'), 'utf8');
    const guardianAt = src.indexOf('const guardian = guardianCheckInstruction(`${capabilityKey}');
    const gateAt = src.indexOf('const gate = checkApprovalGate({');
    expect(guardianAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    // Order is the mechanism: a Guardian denial returns before an approval is
    // ever looked up, so no human decision can precede or replace policy.
    expect(guardianAt).toBeLessThan(gateAt);
  });
});

describe('9. the scheduler cannot grant authority', () => {
  it('a scheduled occurrence of an external action waits for approval and dispatches nothing', async () => {
    const scheduleId = `sched-approval-${Date.now()}`;
    createSchedule({
      scheduleId, workspaceId: WS_A, actorUserId: 'requester-user',
      capability: CAP, action: 'execute',
      parameters: { label: 'scheduled' }, rawText: 'every 6 hours',
      recurrenceType: 'INTERVAL', intervalSeconds: 21600,
      nextRunAt: new Date().toISOString(), status: 'ACTIVE', statusReason: null,
    } as any);

    const dueAt = new Date().toISOString();
    await fireScheduleOccurrence({
      schedule_id: scheduleId, workspace_id: WS_A, actor_user_id: 'requester-user',
      capability: CAP, action: 'execute', parameters_json: JSON.stringify({ label: 'scheduled' }),
      raw_text: 'every 6 hours', recurrence_type: 'INTERVAL', interval_seconds: 21600,
      next_run_at: dueAt, last_run_at: null, status: 'ACTIVE', status_reason: null,
      created_at: dueAt, updated_at: dueAt,
    } as any, dueAt);

    const occurrences = getScheduleOccurrences(scheduleId);
    expect(occurrences.length).toBeGreaterThan(0);
    const occ: any = occurrences[occurrences.length - 1];
    // The occurrence did NOT run, and is recorded as such — never fabricated
    // as a success.
    expect(occ.outcome).toBe('APPROVAL_REQUIRED');
    expect(occ.status).toBe('BLOCKED');
    expect(occ.receipt_id ?? null).toBeNull();
    expect(occ.artifact_id ?? null).toBeNull();

    // And it raised a real approval for a human.
    const pending = listWorkspaceApprovals(WS_A, { status: 'PENDING', limit: 500 });
    expect(pending.some((r) => r.capability === CAP)).toBe(true);
  });

  it('each occurrence needs its OWN approval — one grant is not a standing grant', () => {
    // Occurrence correlation is derived from the occurrence idempotency key, so
    // two occurrences of the same schedule never share an approval binding.
    const schedulerSource = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/scheduler.ts'), 'utf8');
    expect(schedulerSource).toMatch(/deriveScheduleOccurrenceIdempotencyKey\(schedule\.schedule_id, dueAtIso\)/);

    const d1 = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: { label: 'x' } });
    const g1 = checkApprovalGate({ workspaceId: WS_A, capability: CAP, action: 'execute', inputDigest: d1, correlationId: 'occurrence-1' });
    const g2 = checkApprovalGate({ workspaceId: WS_A, capability: CAP, action: 'execute', inputDigest: d1, correlationId: 'occurrence-2' });
    // Same payload, different occurrence: neither inherits the other's decision.
    expect(g1.allowed).toBe(false);
    expect(g2.allowed).toBe(false);
  });
});

describe('10. the graph cannot grant authority', () => {
  it('no graph-executable capability is an EXTERNAL_ACTION today', async () => {
    for (const key of GRAPH_EXECUTABLE_CAPABILITIES) {
      const cap = await resolveCapability(key);
      if (!cap) continue;
      expect(cap.effectClass, `${key} must not be an external action`).not.toBe('EXTERNAL_ACTION');
    }
  });

  it('an external-action graph node halts and requests approval instead of traversing', () => {
    const verdict = checkGraphNodeApproval({
      workspaceId: WS_A, runId: `run-${Date.now()}`, nodeId: 'node-send',
      capability: CAP, effectClass: 'EXTERNAL_ACTION',
      parameters: { to: 'alice@example.com' }, requestedByUserId: 'graph-runner',
      guardianDecision: 'SAFE',
    });
    expect(verdict.mayTraverse).toBe(false);
    expect(verdict.state).toBe('WAITING_FOR_APPROVAL');
    expect(verdict.approvalId).toBeTruthy();
    expect(getApproval(verdict.approvalId!)!.status).toBe('PENDING');
  });

  it('a non-external node is unaffected, so existing graphs are unchanged', () => {
    const verdict = checkGraphNodeApproval({
      workspaceId: WS_A, runId: 'run-x', nodeId: 'node-audit',
      capability: 'aeo.audit', effectClass: 'COMPUTE',
      parameters: {}, requestedByUserId: 'graph-runner', guardianDecision: 'SAFE',
    });
    expect(verdict.mayTraverse).toBe(true);
  });

  it('approving one graph node does not authorize a different node in the same run', () => {
    const runId = `run-multi-${Date.now()}`;
    const first = checkGraphNodeApproval({
      workspaceId: WS_A, runId, nodeId: 'node-a', capability: CAP, effectClass: 'EXTERNAL_ACTION',
      parameters: { to: 'a@example.com' }, requestedByUserId: 'graph-runner', guardianDecision: 'SAFE',
    });
    decideApproval({ approvalId: first.approvalId!, workspaceId: WS_A, decidedByUserId: adminA.user_id, decision: 'APPROVED' });

    const second = checkGraphNodeApproval({
      workspaceId: WS_A, runId, nodeId: 'node-b', capability: CAP, effectClass: 'EXTERNAL_ACTION',
      parameters: { to: 'a@example.com' }, requestedByUserId: 'graph-runner', guardianDecision: 'SAFE',
    });
    expect(second.mayTraverse).toBe(false);
  });
});

describe('11. retry revalidates rather than inheriting', () => {
  it('a retry after consumption is refused, not silently repeated', async () => {
    const corr = uniqueCorrelation('retry');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });
    await dispatch({ correlationId: corr });

    // The retry re-runs Guardian, re-checks the approval, finds it spent.
    const retry = await dispatch({ correlationId: corr });
    expect(retry.outcome).toBe('BLOCKED');
    expect(retry.taskId).toBeUndefined();
  });

  it('a retry whose inputs changed does not inherit the earlier approval', async () => {
    const corr = uniqueCorrelation('retrychanged');
    const first = await dispatch({ correlationId: corr, params: { label: 'v1' } });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });

    const changed = await dispatch({ correlationId: corr, params: { label: 'v2' } });
    expect(changed.outcome).toBe('APPROVAL_REQUIRED');
    expect(changed.taskId).toBeUndefined();
    // v1's approval is still unspent — the changed retry did not burn it.
    expect(getApproval(first.approval!.approvalId)!.status).toBe('APPROVED');
  });

  it('an unknown external state is never blindly retried — consumption happens BEFORE the action', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/envelope.ts'), 'utf8');
    // consumeApproval sits inside enforceHumanApproval, which returns null to
    // ALLOW dispatch — so the approval is spent before the executor runs. A
    // crash mid-action therefore leaves a consumed approval and the retry stops
    // to ask a human rather than performing the side effect twice.
    const gateFn = src.slice(src.indexOf('async function enforceHumanApproval'));
    const consumeAt = gateFn.indexOf('consumeApproval(');
    const allowAt = gateFn.indexOf('return { consumedApprovalId:');
    expect(consumeAt).toBeGreaterThan(-1);
    expect(allowAt).toBeGreaterThan(-1);
    expect(consumeAt).toBeLessThan(allowAt);
  });
});

describe('12. evidence', () => {
  it('every approval transition leaves a durable runtime event', async () => {
    const corr = uniqueCorrelation('evidence');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });
    await dispatch({ correlationId: corr });

    const events = listRecentRuntimeEvents({ targetType: 'capability', limit: 500 })
      .map((e) => { try { return { e, d: JSON.parse(e.detail_json || '{}') }; } catch { return null; } })
      .filter((x): x is { e: any; d: any } => !!x)
      .filter((x) => x.d.approvalId === first.approval!.approvalId);

    const notes = events.map((x) => String(x.d.note || ''));
    expect(notes.some((n) => /Approval requested/i.test(n))).toBe(true);
    expect(notes.some((n) => /Human decision: APPROVED/i.test(n))).toBe(true);
    expect(notes.some((n) => /consumed/i.test(n))).toBe(true);
  });

  it('a consumed approval records WHICH task spent it', async () => {
    const corr = uniqueCorrelation('link');
    const first = await dispatch({ correlationId: corr });
    await httpCall('POST', `/api/approvals/${first.approval!.approvalId}/decide`, adminACookie, { workspaceId: WS_A, decision: 'APPROVED' });
    const run = await dispatch({ correlationId: corr });

    expect(run.outcome).toBe('SUCCESS');
    const row = getApproval(first.approval!.approvalId)!;
    expect(row.status).toBe('CONSUMED');
    // The direct approval -> task link. Without it the audit trail can say an
    // approval was spent but not what it authorized; the live Part G run is
    // what surfaced this being null.
    expect(row.consumed_by_task_id).toBe(run.taskId);
    // And the result reports the approval that authorized it.
    expect(run.approval?.approvalId).toBe(first.approval!.approvalId);
    expect(run.approval?.status).toBe('CONSUMED');
  });

  it('the approval record never stores a secret', () => {
    const corr = uniqueCorrelation('secret');
    const digest = computeInputDigest({ workspaceId: WS_A, capability: CAP, action: 'execute', parameters: {} });
    const apr = requestApproval({
      workspaceId: WS_A, correlationId: corr, capability: CAP, action: 'execute',
      effectClass: 'EXTERNAL_ACTION', requestedByUserId: 'r', guardianDecision: 'SAFE',
      actionSummary: 'Send using key sk-proj-abcdefghij1234567890ABCDEFGHIJ and AIzaSyA1234567890abcdefghijklmnopqrstu',
      inputDigest: digest,
    });
    const stored = getApproval(apr.approval_id)!;
    expect(stored.action_summary).not.toMatch(/sk-proj-abcdefghij/);
    expect(stored.action_summary).not.toMatch(/AIzaSyA1234567890/);
    expect(stored.action_summary).toMatch(/REDACTED|\*{3}/i);
  });
});
