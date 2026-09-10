import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { selectLiveExecutionNodes } from '../lib/graph-execution';

// ---------------------------------------------------------------------------
// GRAPH BUILDER — capability nodes and the prospect-growth workflow.
//
// The engine is SYNTHOS-NATIVE. Graph definition, storage, execution and run
// history depend on nothing from Hermes; Hermes (or any other runtime) can
// only ever be reached through capability resolution inside a node.
//
// Two real defects this file locks closed, both found by running the thing:
//
//  1. DATA LOSS: /api/graphs/execute persisted the FILTERED executable node
//     set back over the stored graph, so simply running a graph deleted every
//     trigger/logic/presentational node from the saved canvas.
//  2. RUNTIME BLINDNESS: GraphRunsView read state.totalNodes / currentStep /
//     executionLog, which the execution spine never writes. Every run showed
//     "—" and "no log entries" while full per-node evidence sat in
//     state.nodeResults.
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');
const serverContent = read('server.ts');
const runsView = read('src/components/GraphRunsView.tsx');
const envelopeSrc = read('lib/fabric/envelope.ts');
const serviceSrc = read('lib/aeo/service.ts');

function executeSlice(): string {
  const i = serverContent.indexOf('app.post("/api/graphs/execute"');
  expect(i).toBeGreaterThan(-1);
  const n = serverContent.indexOf('\n  app.', i + 10);
  return serverContent.slice(i, n === -1 ? undefined : n);
}

describe('1: capability nodes are dispatchable work', () => {
  it('selectLiveExecutionNodes accepts agent and capability, and only those', () => {
    const nodes = [
      { id: 'a', type: 'agent' },
      { id: 'b', type: 'capability' },
      { id: 'c', type: 'trigger' },
      { id: 'd', type: 'logic' },
      { id: 'e', type: 'model' },
      { id: 'f' }, // untyped defaults to agent
    ];
    const picked = selectLiveExecutionNodes(nodes as any).map((n: any) => n.id);
    expect(picked).toEqual(['a', 'b', 'f']);
  });

  it('a capability node dispatches by capability key, never by vendor', () => {
    const s = executeSlice();
    expect(s).toContain('const isCapabilityNode = currentNode.type === "capability"');
    expect(s).toContain('currentNode.capability');
    for (const cap of ['aeo.audit', 'opportunity.review', 'create_mission', 'schedule_recheck']) {
      expect(s).toContain(`"${cap}"`);
    }
  });

  it('an unknown capability is reported, never silently skipped or faked', () => {
    const s = executeSlice();
    expect(s).toContain('NO_CAPABILITY_EXECUTOR');
    expect(s).toContain('NOT_CONFIGURED');
  });

  it('capability nodes satisfy the same verification gate as agent nodes', () => {
    // The gate requires status === "DONE"; a capability node returning
    // "SUCCESS" silently failed the graph while having actually succeeded.
    const s = executeSlice();
    expect(s).toContain('success: true, status: "DONE", modelUsed: `capability:${capKey}`');
    expect(s).not.toContain('status: "SUCCESS", modelUsed: `capability:${capKey}`');
  });
});

describe('2: the graph engine is SynthOS-native — no Hermes dependency', () => {
  it('the execute route never imports or calls Hermes', () => {
    const s = executeSlice();
    for (const bad of ['hermes', 'Hermes', 'HERMES']) expect(s).not.toContain(bad);
  });

  it('graph storage and execution modules carry no Hermes coupling', () => {
    const graphExec = read('lib/graph-execution.ts');
    for (const bad of ['hermes', 'Hermes']) expect(graphExec).not.toContain(bad);
  });

  it('the graph definition names capabilities, not providers', () => {
    // A stored graph must not hardcode a vendor; the resolver picks what runs.
    const s = executeSlice();
    for (const vendor of ['HermesSEO', 'GeminiSEO', 'openai', 'anthropic']) {
      expect(s).not.toContain(vendor);
    }
  });
});

describe('3: running a graph must not destroy the canvas', () => {
  it('execute persists the FULL node set, not the filtered executable subset', () => {
    const s = executeSlice();
    expect(s).toContain('saveGraph({ graphId, workspaceId, name, nodes: Array.isArray(rawNodes) ? rawNodes : nodes, edges })');
    // The exact defect: saving the filtered list.
    expect(s).not.toContain('saveGraph({ graphId, workspaceId, name, nodes, edges })');
  });

  it('execution still runs only the filtered set', () => {
    const s = executeSlice();
    expect(s).toContain('selectLiveExecutionNodes(');
  });
});

describe('4: one audit implementation, three callers', () => {
  it('the audit service exists and is what the route calls', () => {
    expect(serviceSrc).toContain('export async function runAeoAudit');
    expect(serverContent).toContain('runAeoAudit({');
    // The route must not re-implement crawl/analyze.
    const routeIdx = serverContent.indexOf('app.post("/api/aeo/audit"');
    const routeSlice = serverContent.slice(routeIdx, routeIdx + 1600);
    expect(routeSlice).not.toContain('crawlSite(');
    expect(routeSlice).not.toContain('analyzeAudit(');
  });

  it('the scheduler envelope has a real aeo.audit executor', () => {
    // Registered-but-unwired was a real gap: the recheck schedule would have
    // failed the moment it fired.
    expect(envelopeSrc).toContain("case 'aeo.audit':");
    expect(envelopeSrc).toContain('async function executeAeoAudit');
    expect(envelopeSrc).toContain("await import('../aeo/service')");
  });

  it('the graph node calls the same service rather than duplicating logic', () => {
    const s = executeSlice();
    expect(s).toContain('runAeoAudit({');
    expect(s).not.toContain('crawlSite(');
    expect(s).not.toContain('renderReport(');
  });
});

describe('5: downstream capability nodes require real upstream evidence', () => {
  it('review, mission and schedule nodes fail without an upstream audit', () => {
    const s = executeSlice();
    expect(s).toContain('NO_UPSTREAM_AUDIT');
    expect(s).toContain('NO_OPPORTUNITIES');
  });

  it('mission creation uses the real task path', () => {
    const s = executeSlice();
    expect(s).toContain('createAuditMissionTasks({');
  });

  it('recheck uses the canonical scheduler, not a second one', () => {
    const s = executeSlice();
    expect(s).toContain('parseSchedulePhrase(');
    expect(s).toContain('createValidatedSchedule({');
    expect(s).toContain("capability: \"aeo.audit\"");
    expect(s).not.toContain('setInterval');
  });

  it('an UNKNOWN GEO score is preserved, never converted to a failure or a number', () => {
    const s = executeSlice();
    expect(s).toContain('GEO remains UNKNOWN and is preserved as UNKNOWN');
    expect(s).toContain('sc.geo.score ?? "UNKNOWN"');
  });
});

describe('6: workspace isolation and run persistence', () => {
  it('execute is workspace-guarded and threads workspaceId into every capability', () => {
    const s = executeSlice();
    expect(s).toContain('requireWorkspaceMember');
    expect(s).toContain('runAeoAudit({\n                workspaceId,');
  });

  it('capability state is scoped to a single run, never global', () => {
    const s = executeSlice();
    expect(s).toContain('const capabilityState: {');
    expect(serverContent).not.toMatch(/^let capabilityState/m);
  });

  it('a failed node halts the graph and persists the failed run', () => {
    const s = executeSlice();
    expect(s).toContain('failedAtNode');
    expect(s).toContain('saveGraphRun({');
    expect(s).toContain('"Node failed verification gate. Graph execution halted."');
  });
});

describe('7: the runtime view renders the state the spine really writes', () => {
  it('reads state.nodeResults rather than fields nothing writes', () => {
    expect(runsView).toContain('selectedRun.state.nodeResults');
    expect(runsView).not.toContain('selectedRun.state.executionLog');
    expect(runsView).not.toContain('selectedRun.state.totalNodes');
    expect(runsView).not.toContain('selectedRun.state.currentStep');
  });

  it('shows per-node status, timing, gate and provenance', () => {
    for (const f of ['nodeName', 'classification', 'modelUsed', 'gate', 'startedAt', 'finishedAt', 'receiptId']) {
      expect(runsView).toContain(f);
    }
  });

  it('surfaces the run-level Aegis decision, receipt and artifact', () => {
    expect(runsView).toContain('graphRunReceipt');
    expect(runsView).toContain('aegisDecision');
    expect(runsView).toContain('Run Artifact');
  });

  it('missing values read UNKNOWN — no fabricated cost, token or latency figures', () => {
    expect(runsView).toContain("'UNKNOWN'");
    for (const fake of ['tokensUsed', 'costUsd', 'estimatedCost', 'Math.random']) {
      expect(runsView).not.toContain(fake);
    }
  });
});
