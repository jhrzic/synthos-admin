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

  it('STEP 4: every other node takes the native COMPUTE path — a direct ctx.invoke("model.gemini", ...) call, no longer a self-HTTP round-trip through /api/execute-agent-task (that was the per-node-receipt problem Step 4 removes)', () => {
    expect(executeRoute).not.toContain('await fetch(`http://127.0.0.1:${PORT}/api/execute-agent-task`');
    expect(executeRoute).not.toContain('X-Internal-Service-Token');
    expect(executeRoute).toContain('await graphRunCtx.invoke("model.gemini", async () => {');
    expect(executeRoute).toContain('buildAgentRolePrompt({');
    expect(executeRoute).toContain('generateViaGemini({');
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
    const branchWindow = executeRoute.slice(branchStart, branchStart + 6000);
    expect(branchWindow).toContain('success: false');
    // A remote SUCCEEDED is never passed through as the node status: it maps
    // to the ingested task's scoped failure (INCOMPLETE / VERIFICATION_FAILED)
    // or FAILED.
    expect(branchWindow).toContain('execution.status === "SUCCEEDED" ? (windmillTaskStatus === "INCOMPLETE" || windmillTaskStatus === "VERIFICATION_FAILED" ? windmillTaskStatus : "FAILED") : execution.status');
  });

  it('STEP 4: the Windmill (EXTERNAL_ACTION) gate is preserved byte-for-byte; COMPUTE nodes deliberately get a different, receipt-free gate — they are no longer "the exact same gate" by design, not by accident', () => {
    // The pre-Step-4 literal condition survives verbatim as the
    // EXTERNAL_ACTION half of the new classification-aware ternary — proof
    // the Windmill gate itself was not touched.
    expect(executeRoute).toContain('? (nodeExecData.success && nodeExecData.status === "DONE" && nodeExecData.receipt?.verified === true)');
    // COMPUTE nodes never carry a receipt (Step 4 removes per-node receipts
    // for them), so their half of the gate is real-output-produced, not a
    // receipt check.
    expect(executeRoute).toContain(': (nodeExecData.success && nodeExecData.status === "DONE");');
  });

  it('the confirmation gate (confirmed: true) still runs before either dispatch path, Windmill included', () => {
    const confirmIdx = executeRoute.indexOf('req.body?.confirmed !== true');
    const windmillIdx = executeRoute.indexOf('isWindmillNode');
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(windmillIdx).toBeGreaterThan(confirmIdx);
  });
});
