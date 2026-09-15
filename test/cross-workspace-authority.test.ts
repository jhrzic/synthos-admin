import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-xws-auth-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'xws.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { createUser, login, SESSION_COOKIE_NAME } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import {
  requireWorkspaceMember,
  authorizedWorkspaceId,
  fromBody,
  fromQuery,
  fromBodyOrQuery,
} from '../lib/authorization';
import {
  createInitialTask,
  isTaskInWorkspace,
  createSchedule,
  isScheduleInWorkspace,
} from '../lib/persistence';

// ---------------------------------------------------------------------------
// TWO-WORKSPACE NEGATIVE TESTS for a REAL vulnerability found in this pass.
//
// server.ts had two ownership guards that re-derived the workspace from
// caller input with the OPPOSITE precedence to the middleware that had just
// verified membership:
//
//   requireWorkspaceMember(fromBodyOrQuery)  ->  body.workspaceId ?? query
//   enforceTaskWorkspaceAccess               ->  query.workspaceId ?? body
//
// Two attacker-controlled inputs, read in opposite order, is a bypass. A
// member of workspace A who knew a resource id in workspace B could send
// body=A (membership verified) with ?workspaceId=B (ownership checked against
// B) and pass both checks.
//
// Blast radius: five task routes leaked B's tasks, activity, artifacts,
// quality reviews and receipts. Three schedule routes were MUTATIONS —
// pause, resume, and run-now, which starts real billable execution.
//
// These tests use the REAL middleware, a REAL session cookie and a REAL
// database. The attacker genuinely knows the victim's resource ids, which is
// the assumption the brief requires.
// ---------------------------------------------------------------------------

const WS_ATTACKER = 'ws-attacker-alpha';
const WS_VICTIM = 'ws-victim-beta';
const PASSWORD = 'attacker-password-1';

let attackerCookie = '';
let victimTaskId = '';
let victimScheduleId = '';
let attackerTaskId = '';

/** A minimal express-shaped request carrying a real session cookie. */
function makeReq(opts: { body?: any; query?: any }) {
  return {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${attackerCookie}` },
    body: opts.body ?? {},
    query: opts.query ?? {},
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    payload: undefined,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.payload = body; return res; },
  };
  return res;
}

/** Runs the real middleware and reports what it decided. */
function runGuard(middleware: any, req: any) {
  const res = makeRes();
  let passed = false;
  middleware(req, res, () => { passed = true; });
  return { passed, statusCode: res.statusCode, payload: res.payload };
}

beforeAll(() => {
  ensureWorkspace(WS_ATTACKER, 'Attacker Workspace');
  ensureWorkspace(WS_VICTIM, 'Victim Workspace');

  const attacker = createUser({ email: 'attacker@example.test', displayName: 'Attacker', password: PASSWORD } as any);
  // Membership in the attacker's own workspace ONLY. Never in the victim's.
  grantMembership((attacker as any).user_id, WS_ATTACKER, 'admin');

  const session = login('attacker@example.test', PASSWORD)!;
  attackerCookie = session.rawToken;

  // Real resources in each workspace.
  victimTaskId = 'task-victim-secret';
  createInitialTask({
    taskId: victimTaskId,
    workspaceId: WS_VICTIM,
    title: 'Victim confidential task',
    description: 'Belongs to the victim workspace.',
    assignedAgent: 'scout',
    assignedModel: 'gemini-3.1-flash-lite',
    createdAt: new Date().toISOString(),
  });

  attackerTaskId = 'task-attacker-own';
  createInitialTask({
    taskId: attackerTaskId,
    workspaceId: WS_ATTACKER,
    title: 'Attacker own task',
    description: 'Belongs to the attacker workspace.',
    assignedAgent: 'scout',
    assignedModel: 'gemini-3.1-flash-lite',
    createdAt: new Date().toISOString(),
  });

  victimScheduleId = 'sched-victim-secret';
  createSchedule({
    scheduleId: victimScheduleId,
    workspaceId: WS_VICTIM,
    actorUserId: 'victim-user',
    capability: 'vault.write',
    action: 'vault.write',
    parameters: {},
    rawText: 'every 1 hour',
    recurrenceType: 'INTERVAL',
    intervalSeconds: 3600,
    nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
    status: 'ACTIVE',
  } as any);
});

describe('the root cause: two extractors disagreed about precedence', () => {
  it('fromBodyOrQuery prefers BODY while the old guards preferred QUERY — the bypass', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER }, query: { workspaceId: WS_VICTIM } });

    // What the membership middleware verified.
    expect(fromBodyOrQuery(req)).toBe(WS_ATTACKER);
    expect(fromBody(req)).toBe(WS_ATTACKER);
    // What the old ownership guards checked ownership against.
    expect(req.query.workspaceId ?? req.body?.workspaceId).toBe(WS_VICTIM);
    // Same request, two different answers. That gap was the vulnerability.
    expect(fromBodyOrQuery(req)).not.toBe(req.query.workspaceId);
  });
});

describe('the fix: an ownership check may only use the VERIFIED workspace', () => {
  it('authorizedWorkspaceId ignores body and query entirely', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER }, query: { workspaceId: WS_VICTIM } });
    // Nothing has authorized this request yet.
    expect(authorizedWorkspaceId(req)).toBeNull();

    // After the real middleware runs, it is the verified value and nothing else.
    const outcome = runGuard(requireWorkspaceMember(fromBodyOrQuery), req);
    expect(outcome.passed).toBe(true);
    expect(authorizedWorkspaceId(req)).toBe(WS_ATTACKER);
    expect(authorizedWorkspaceId(req)).not.toBe(WS_VICTIM);
  });

  it('returns null when no auth middleware ran, so a guard cannot fall through to caller input', () => {
    const req = makeReq({ query: { workspaceId: WS_VICTIM } });
    expect(authorizedWorkspaceId(req)).toBeNull();
  });
});

describe('workspace A cannot READ workspace B resources, even knowing the ids', () => {
  it('the membership middleware pins the request to the attacker workspace', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER }, query: { workspaceId: WS_VICTIM } });
    const outcome = runGuard(requireWorkspaceMember(fromBodyOrQuery), req);
    expect(outcome.passed).toBe(true);
    expect((req as any).authWorkspaceId).toBe(WS_ATTACKER);
  });

  // This composition is exactly what enforceTaskWorkspaceAccess now does.
  it('the ownership check refuses the victim task under the verified workspace', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER }, query: { workspaceId: WS_VICTIM } });
    runGuard(requireWorkspaceMember(fromBodyOrQuery), req);

    const workspaceId = authorizedWorkspaceId(req)!;
    expect(isTaskInWorkspace(victimTaskId, workspaceId)).toBe(false);
    // And the attacker's own task still works — the fix is not a blanket denial.
    expect(isTaskInWorkspace(attackerTaskId, workspaceId)).toBe(true);
  });

  it('the OLD logic would have allowed it — proving these tests would have caught the bug', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER }, query: { workspaceId: WS_VICTIM } });
    runGuard(requireWorkspaceMember(fromBodyOrQuery), req);

    const oldDerivation = (req.query.workspaceId ?? req.body?.workspaceId) as string;
    expect(isTaskInWorkspace(victimTaskId, oldDerivation)).toBe(true); // the hole
    expect(isTaskInWorkspace(victimTaskId, authorizedWorkspaceId(req)!)).toBe(false); // closed
  });

  it('a caller with no membership in the requested workspace is rejected outright', () => {
    const req = makeReq({ body: { workspaceId: WS_VICTIM } });
    const outcome = runGuard(requireWorkspaceMember(fromBody), req);
    expect(outcome.passed).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });
});

describe('workspace A cannot MUTATE workspace B schedules — the more serious half', () => {
  // pause / resume / run-now used requireWorkspaceMember(fromBody) while the
  // guard read query first. run-now starts real, billable execution.
  it('the verified workspace refuses the victim schedule', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER }, query: { workspaceId: WS_VICTIM } });
    const outcome = runGuard(requireWorkspaceMember(fromBody), req);
    expect(outcome.passed).toBe(true);

    const workspaceId = authorizedWorkspaceId(req)!;
    expect(isScheduleInWorkspace(victimScheduleId, workspaceId)).toBe(false);
  });

  it('the OLD logic would have allowed pause/resume/run-now on the victim schedule', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER }, query: { workspaceId: WS_VICTIM } });
    runGuard(requireWorkspaceMember(fromBody), req);

    const oldDerivation = (req.query.workspaceId ?? req.body?.workspaceId) as string;
    expect(isScheduleInWorkspace(victimScheduleId, oldDerivation)).toBe(true); // the hole
    expect(isScheduleInWorkspace(victimScheduleId, authorizedWorkspaceId(req)!)).toBe(false); // closed
  });

  it('an unknown id and a foreign id are indistinguishable, so ids cannot be probed', () => {
    const req = makeReq({ body: { workspaceId: WS_ATTACKER } });
    runGuard(requireWorkspaceMember(fromBody), req);
    const workspaceId = authorizedWorkspaceId(req)!;

    expect(isScheduleInWorkspace(victimScheduleId, workspaceId)).toBe(false);
    expect(isScheduleInWorkspace('sched-does-not-exist-at-all', workspaceId)).toBe(false);
    expect(isTaskInWorkspace(victimTaskId, workspaceId)).toBe(false);
    expect(isTaskInWorkspace('task-does-not-exist-at-all', workspaceId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source guards, so the pattern cannot come back. The library can be correct
// while a route re-introduces the unsafe derivation.
// ---------------------------------------------------------------------------
describe('no ownership guard may re-derive the workspace from caller input', () => {
  const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');

  const guardBody = (name: string) => {
    const start = server.indexOf(`function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const open = server.indexOf('{', start);
    // Walk to the matching close brace.
    let depth = 0;
    for (let i = open; i < server.length; i++) {
      if (server[i] === '{') depth++;
      else if (server[i] === '}') { depth--; if (depth === 0) return server.slice(start, i + 1); }
    }
    return server.slice(start);
  };

  for (const name of ['enforceTaskWorkspaceAccess', 'enforceScheduleWorkspaceAccess']) {
    it(`${name} uses authorizedWorkspaceId and reads no workspace from the request`, () => {
      const body = guardBody(name);
      const code = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).toContain('authorizedWorkspaceId(req)');
      expect(
        /req\.(query|body)\s*(\?)?\.\s*workspaceId/.test(code),
        `${name} re-reads workspaceId from the request — that is the bypass`,
      ).toBe(false);
    });
  }
});

describe('the internal-service-token bypass is gone, not merely unused', () => {
  const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');

  // It was dead code — nothing ever set the header — but it still skipped
  // requireWorkspaceMember and then took workspaceId from the body,
  // defaulting to "ws-synthos-primary". Anything that leaked the token could
  // have written verified tasks and signed receipts into any named workspace.
  it('no header-based auth bypass remains in any route', () => {
    const code = server.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/x-internal-service-token/i);
    expect(code).not.toContain('INTERNAL_SERVICE_TOKEN');
  });

  it('/api/execute-agent-task requires a verified workspace member like every other mutating route', () => {
    const idx = server.indexOf('app.post("/api/execute-agent-task"');
    expect(idx).toBeGreaterThan(-1);
    const declaration = server.slice(idx, server.indexOf('\n', idx));
    expect(declaration).toContain('requireWorkspaceMember(fromBody)');
  });

  it('it no longer falls back to a caller-supplied workspace or a hardcoded default', () => {
    const idx = server.indexOf('app.post("/api/execute-agent-task"');
    const routeSlice = server.slice(idx, idx + 3000);
    const code = routeSlice.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).toContain('const resolvedWorkspaceId = (req as AuthedRequest).authWorkspaceId!');
    expect(code).not.toContain('"ws-synthos-primary"');
  });
});
