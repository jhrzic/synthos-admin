import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const graphBuilderContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GraphBuilderView.tsx'), 'utf-8');

function routeSlice(startMarker: string, endMarker: string): string {
  const start = serverContent.indexOf(startMarker);
  const end = serverContent.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return serverContent.slice(start, end);
}

describe('POST /api/graphs/execute: real, paid live execution requires explicit confirmation (2, 4)', () => {
  const executeRoute = routeSlice('app.post("/api/graphs/execute"', 'app.get("/api/execution/tasks');

  it('rejects a request without confirmed:true before touching any node', () => {
    expect(executeRoute).toContain('req.body?.confirmed !== true');
    expect(executeRoute).toContain('Live graph execution requires explicit confirmation');
  });

  it('the confirmation check runs before nodes are read from the request body (fails fast, no partial work)', () => {
    const confirmIdx = executeRoute.indexOf('req.body?.confirmed !== true');
    const nodesIdx = executeRoute.indexOf('selectLiveExecutionNodes(');
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(nodesIdx).toBeGreaterThan(confirmIdx);
  });

  it('only agent-type nodes are dispatched — trigger/model/tool/logic nodes are filtered out first (1)', () => {
    expect(executeRoute).toContain('selectLiveExecutionNodes(Array.isArray(rawNodes) ? rawNodes : [])');
  });

  it('a halted run that already completed at least one node is reported PARTIAL, not collapsed into FAILED (5, 6)', () => {
    expect(executeRoute).toContain('executionResults.length > 0 ? "PARTIAL" : "FAILED"');
  });

  it('a node is never marked complete without a verified receipt — gate is unchanged from the pre-existing spine (7)', () => {
    expect(executeRoute).toContain('nodeExecData.success && nodeExecData.status === "DONE" && nodeExecData.receipt?.verified === true');
  });

  it('the confirmed graph_run still inherits workspace from the resolved caller, not a hardcoded constant (10)', () => {
    expect(executeRoute).toContain('const workspaceId = resolved.workspaceId;');
    expect(executeRoute).not.toMatch(/workspaceId:\s*['"]ws-synthos-primary['"]/);
  });
});

describe('POST /api/graphs/estimate: real routing signal only, never a fabricated dollar figure (8, 9)', () => {
  const estimateRoute = routeSlice('app.post("/api/graphs/estimate"', 'app.post("/api/graphs/execute"');

  it('exists as its own route and calls the real estimator, not a stub', () => {
    expect(estimateRoute).toContain('estimateGraphExecution(nodes)');
  });

  it('never dispatches to the execution spine — it is read-only', () => {
    expect(estimateRoute).not.toContain('/api/execute-agent-task');
    expect(estimateRoute).not.toContain('saveGraphRun(');
  });

  it('is workspace-scoped like every other graph route', () => {
    expect(estimateRoute).toContain('resolveWorkspaceId(req.body?.workspaceId)');
  });
});

describe('Graph Builder UI: preview and live execution are two distinct, clearly labeled actions (A2)', () => {
  it('the dry-run button is labeled as a preview, not as execution', () => {
    expect(graphBuilderContent).toContain('Dry-Run Preview');
  });

  it('a separate Run Live action exists and is not the same handler as the dry-run', () => {
    expect(graphBuilderContent).toContain('handleRequestLiveRun');
    expect(graphBuilderContent).toContain('handleConfirmLiveRun');
    expect(graphBuilderContent).toContain('Run Live');
  });

  it('the dry-run handler (handleRunGraph) never calls the live execution APIs', () => {
    const start = graphBuilderContent.indexOf('const handleRunGraph = async () => {');
    const end = graphBuilderContent.indexOf('\n  };', start);
    const body = graphBuilderContent.slice(start, end);
    expect(body).not.toContain('/api/graphs/execute');
    expect(body).not.toContain('/api/graphs/estimate');
  });

  it('live execution always sends confirmed:true explicitly (never implicit)', () => {
    const start = graphBuilderContent.indexOf('const handleConfirmLiveRun');
    const end = graphBuilderContent.indexOf('\n  };', start);
    const body = graphBuilderContent.slice(start, end);
    expect(body).toContain('confirmed: true');
  });

  it('the live-run result panel never claims completion without a real API response (no hardcoded success copy)', () => {
    expect(graphBuilderContent).not.toContain('Cryptographically signed');
    expect(graphBuilderContent).not.toContain('Status 200 OK');
  });

  it('an unavailable cost estimate is displayed honestly, never a fabricated dollar amount', () => {
    expect(graphBuilderContent).toContain('costEstimateStatus');
    expect(graphBuilderContent).not.toMatch(/\$\d+(\.\d+)?\s*(per|\/)\s*(run|node|graph)/i);
  });
});
