import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

function routeSlice(startMarker: string, endMarker: string): string {
  const start = serverContent.indexOf(startMarker);
  const end = serverContent.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return serverContent.slice(start, end);
}

// ---------------------------------------------------------------------------
// ADR-006 / Workstream G — graph nodes get an explicit Windmill execution
// target. Source-level regression, matching this repo's established
// convention for /api/graphs/execute (see test/graph-live-execution.test.ts)
// — the route is exercised end-to-end at the unit level via
// test/external-executions.test.ts (submitAndAwaitExternalExecution itself)
// and live-verified manually, not via a spun-up Express server in the
// automated suite.
// ---------------------------------------------------------------------------

describe('POST /api/graphs/execute: Windmill node target (G1-G4)', () => {
  const executeRoute = routeSlice('app.post("/api/graphs/execute"', 'app.get("/api/execution/tasks');

  it('a node only routes to Windmill when it explicitly declares BOTH runtime:"windmill" and windmillTargetId — no hidden fallback (G2)', () => {
    expect(executeRoute).toContain('currentNode.runtime === "windmill"');
    expect(executeRoute).toContain("typeof currentNode.windmillTargetId === \"string\"");
  });

  it('every other node still takes the unchanged native dispatch path (byte-identical to the pre-Pass-VI fetch call)', () => {
    expect(executeRoute).toContain('await fetch(`http://127.0.0.1:${PORT}/api/execute-agent-task`');
    expect(executeRoute).toContain('X-Internal-Service-Token');
  });

  it('the Windmill branch submits through the real control plane (submitAndAwaitExternalExecution), never a second/duplicate submission path', () => {
    expect(executeRoute).toContain('await submitAndAwaitExternalExecution({');
  });

  it('workspace is taken from the already-authorized outer request, never from the node payload (rule 6/7)', () => {
    const branchStart = executeRoute.indexOf('await submitAndAwaitExternalExecution({');
    const branchArgs = executeRoute.slice(branchStart, branchStart + 400);
    expect(branchArgs).toContain('workspaceId,');
    expect(branchArgs).not.toMatch(/workspaceId:\s*currentNode/);
  });

  it('a node is only marked DONE when the execution actually carries a real receipt AND task id — a bare remote SUCCEEDED is never enough (rule 15/F4)', () => {
    expect(executeRoute).toContain('execution.status === "SUCCEEDED" && execution.result_receipt_id && execution.task_id');
  });

  it('an unverified or still-pending Windmill node is reported success:false, never silently marked DONE', () => {
    const branchStart = executeRoute.indexOf('await submitAndAwaitExternalExecution({');
    const branchWindow = executeRoute.slice(branchStart, branchStart + 3500);
    expect(branchWindow).toContain('success: false');
    expect(branchWindow).toContain('execution.status === "SUCCEEDED" ? "FAILED" : execution.status');
  });

  it('the existing verification gate applies unconditionally after the branch converges — Windmill nodes go through the exact same gate as native nodes', () => {
    // This assertion (present verbatim in test/graph-live-execution.test.ts
    // too) is what actually stops a graph from advancing past an
    // unverified Windmill node — it is not re-implemented per-branch.
    expect(executeRoute).toContain('nodeExecData.success && nodeExecData.status === "DONE" && nodeExecData.receipt?.verified === true');
  });

  it('the confirmation gate (confirmed: true) still runs before either dispatch path, Windmill included', () => {
    const confirmIdx = executeRoute.indexOf('req.body?.confirmed !== true');
    const windmillIdx = executeRoute.indexOf('isWindmillNode');
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(windmillIdx).toBeGreaterThan(confirmIdx);
  });
});
