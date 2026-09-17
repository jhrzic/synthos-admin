// ---------------------------------------------------------------------------
// SYNTHOS — real graph live-execution support: cost/routing estimate and the
// node filter used before dispatching paid work.
//
// This deployment has no live per-token pricing table wired to real usage
// accounting (server.ts's own post-execution `costEstimate` field is `null`
// for the same reason — see /api/execute-agent-task). So "the best available
// execution estimate" this module can honestly produce is real provider
// ROUTING status per node (via the same classifyModelRequest() every real
// generateContent() call site gates on) — never an invented dollar figure.
//
// Pure, side-effect-free (no server.ts import) so it's importable directly
// in tests without triggering server.ts's self-executing startServer().
// ---------------------------------------------------------------------------

import { classifyModelRequest, ModelRouteClassification } from './model-router';

// Must match the default applied to a node's assignedModel in the real
// /api/graphs/execute node-dispatch loop in server.ts. Kept as one named
// constant so an estimate can never silently drift from what execution
// actually does.
export const GRAPH_EXECUTION_DEFAULT_MODEL = 'gemini-3.6-flash';

export interface GraphExecutionNodeInput {
  id: string;
  label?: string;
  name?: string;
  title?: string;
  type?: string;
  assignedAgent?: string;
  agentRole?: string;
  assignedModel?: string;
}

export interface GraphNodeEstimate {
  nodeId: string;
  label: string;
  assignedAgent: string;
  requestedModel: string;
  routing: ModelRouteClassification;
}

export interface GraphExecutionEstimate {
  agentNodeCount: number;
  totalNodeCount: number;
  nodes: GraphNodeEstimate[];
  allNodesRoutable: boolean;
  unroutableNodes: GraphNodeEstimate[];
  costEstimateStatus: 'ESTIMATE_UNAVAILABLE';
  costEstimateUsd: null;
  costEstimateReason: string;
}

/**
 * The real /api/graphs/execute node-dispatch loop treats every array entry
 * as a dispatchable task. A Graph Builder canvas mixes trigger/agent/model/
 * tool/logic node types — only 'agent' nodes represent real dispatchable
 * work. This is the one filter both the estimate and the live-execution
 * request body must apply, so they never disagree about what will run.
 */
export function selectLiveExecutionNodes<T extends GraphExecutionNodeInput>(nodes: T[]): T[] {
  // 'agent' nodes dispatch a model call; 'capability' nodes dispatch a
  // SynthOS-native capability (aeo.audit, create_mission, schedule_recheck…)
  // through the capability resolver. Both represent real dispatchable work.
  // Every other canvas type (trigger/model/tool/logic) remains presentational
  // and is still deliberately excluded.
  return nodes.filter((n) => {
    const t = (n.type || 'agent');
    return t === 'agent' || t === 'capability';
  });
}

export type GraphNodeClassification = 'CONTROL' | 'COMPUTE' | 'EXTERNAL_ACTION';

/**
 * STEP 4 — the Rev2 node-class taxonomy, as a pure classifier. This does
 * NOT change what gets dispatched or how — selectLiveExecutionNodes() above
 * still decides that, unchanged, and POST /api/graphs/execute keeps its own
 * inline isWindmillNode check for the real dispatch decision. This exists
 * so the classification has a real, testable definition rather than only
 * living as a comment, for future callers — it adds no new runtime
 * behavior on its own.
 *
 * Traced from actual behavior, not labels: a non-'agent' node (trigger/
 * model/tool/logic) is never dispatched by this engine today — there is no
 * real branch/merge/wait execution to classify as CONTROL beyond "not
 * currently executed business work." Do not read this classifier as
 * evidence that CONTROL nodes run; they don't, and this function does not
 * make them.
 */
export function classifyGraphNode(node: GraphExecutionNodeInput): GraphNodeClassification {
  if ((node.type || 'agent') !== 'agent') return 'CONTROL';
  const n = node as GraphExecutionNodeInput & { runtime?: string; windmillTargetId?: string };
  const isWindmillNode = n.runtime === 'windmill' && typeof n.windmillTargetId === 'string' && n.windmillTargetId.trim().length > 0;
  return isWindmillNode ? 'EXTERNAL_ACTION' : 'COMPUTE';
}

export function estimateGraphExecution(nodes: GraphExecutionNodeInput[]): GraphExecutionEstimate {
  const agentNodes = selectLiveExecutionNodes(nodes);
  const nodeEstimates: GraphNodeEstimate[] = agentNodes.map((n) => {
    const requestedModel = (n.assignedModel && n.assignedModel.trim()) || GRAPH_EXECUTION_DEFAULT_MODEL;
    return {
      nodeId: n.id,
      label: n.label || n.name || n.title || n.id,
      assignedAgent: n.assignedAgent || n.agentRole || 'dev',
      requestedModel,
      routing: classifyModelRequest(requestedModel),
    };
  });
  // PUSH 1 — "routable" means routable BY GRAPH EXECUTION, which is Gemini
  // only (server.ts POST /api/graphs/execute holds a resolved Gemini key and
  // calls generateViaGemini). OpenAI became an executable provider elsewhere
  // in the platform, which made the old `=== 'UNSUPPORTED'` test wrong here:
  // it would have reported an OpenAI node routable while the executor
  // refused it, and an estimate that disagrees with the executor is worse
  // than no estimate. The rule is now stated as what it actually is.
  const unroutableNodes = nodeEstimates.filter((e) => e.routing.provider !== 'GEMINI');

  return {
    agentNodeCount: agentNodes.length,
    totalNodeCount: nodes.length,
    nodes: nodeEstimates,
    allNodesRoutable: unroutableNodes.length === 0,
    unroutableNodes,
    costEstimateStatus: 'ESTIMATE_UNAVAILABLE',
    costEstimateUsd: null,
    costEstimateReason:
      'No live per-token pricing metadata is wired into this deployment. Token cost is only observable after execution, from real provider usage metadata (see executionMetrics.tokensConsumed on each completed task).',
  };
}

/**
 * Capability keys a graph `capability` node can actually dispatch today.
 *
 * This is the single source of truth shared by the executor and the Builder's
 * capability picker, so the UI can never offer a capability the runtime would
 * refuse. Registered-but-not-graph-executable capabilities still appear in the
 * picker — marked unavailable — rather than being hidden, so the gap is
 * visible instead of mysterious.
 */
export const GRAPH_EXECUTABLE_CAPABILITIES: string[] = [
  'aeo.audit',
  'opportunity.review',
  'create_mission',
  'schedule_recheck',
];

// ---------------------------------------------------------------------------
// APPROVAL FOUNDATION — C7, the graph's external-action stop.
//
// STATE OF THE WORLD, said plainly before the mechanism: no capability in
// GRAPH_EXECUTABLE_CAPABILITIES above is an EXTERNAL_ACTION. All four are
// internal/compute, so today a graph structurally cannot traverse an external
// action — "the graph cannot self-approve" is currently true because the graph
// cannot perform an external action at all.
//
// This guard exists so that stays true when Tool Pack 2 adds Gmail and somebody
// adds it to that list. The failure it prevents is specific: the graph runner
// dispatches capability nodes through its own bespoke calls (runAeoAudit and
// friends), NOT through executeEnvelope, so it does not inherit the approval
// gate that protects every other caller. A Gmail node added to the allowlist
// would have sent mail without ever consulting an approval.
//
// WHAT THIS DOES AND DOES NOT DO:
//   It halts the run at the node, records current_node_id and a
//   WAITING_FOR_APPROVAL status, and requests a human approval bound to that
//   run's own correlation. The run's position is preserved in the existing
//   graph_runs columns, so the work done before the node is not thrown away.
//
//   It does NOT implement automatic resume-after-approval. There is no
//   continuation mechanism in this runtime to reuse — graph_runs carries the
//   columns for one but nothing reads them to restart mid-graph — and inventing
//   one here would be a second execution path in a pass whose instruction was
//   not to build one. So a halted run must be re-triggered once the approval is
//   granted, and it resumes from the recorded node rather than restarting.
//   Recorded as a known limit rather than implied to be finished.
// ---------------------------------------------------------------------------

import { checkApprovalGate, requestApproval, computeInputDigest } from './approvals';

export interface GraphNodeApprovalVerdict {
  /** True when the node may execute now. */
  mayTraverse: boolean;
  /** Present when traversal is withheld. */
  approvalId?: string;
  state?: string;
  reason?: string;
}

/**
 * Decide whether a graph capability node may traverse.
 *
 * `effectClass` is passed in by the caller from the real registry rather than
 * re-derived here, so the graph and the envelope cannot disagree about what a
 * capability is.
 */
export function checkGraphNodeApproval(params: {
  workspaceId: string;
  runId: string;
  nodeId: string;
  capability: string;
  effectClass: string;
  parameters: Record<string, unknown>;
  requestedByUserId: string;
  guardianDecision: string;
}): GraphNodeApprovalVerdict {
  // Only external actions stop. A compute or read node is unaffected, which is
  // why adding this guard changes nothing about any graph that runs today.
  if (params.effectClass !== 'EXTERNAL_ACTION') return { mayTraverse: true };

  // Correlation is the RUN plus the NODE. Per-run so two runs of the same graph
  // need separate approvals; per-node so approving one external node in a graph
  // does not authorize a different one later in the same run.
  const correlationId = `graph-run:${params.runId}:node:${params.nodeId}`;
  const inputDigest = computeInputDigest({
    workspaceId: params.workspaceId,
    capability: params.capability,
    action: 'graph-node',
    parameters: params.parameters || {},
  });

  const gate = checkApprovalGate({
    workspaceId: params.workspaceId,
    capability: params.capability,
    action: 'graph-node',
    inputDigest,
    correlationId,
  });

  if (gate.allowed) {
    // NOTE: consumption is the CALLER's responsibility, immediately before it
    // performs the action. Consuming here would spend the approval during a
    // check, so a node that then failed to start would have burned it.
    return { mayTraverse: true, approvalId: gate.approval.approval_id };
  }

  if (gate.state === 'WAITING_FOR_APPROVAL' && !gate.approval) {
    const requested = requestApproval({
      workspaceId: params.workspaceId,
      taskId: null,
      correlationId,
      capability: params.capability,
      action: 'graph-node',
      effectClass: params.effectClass,
      requestedByUserId: params.requestedByUserId,
      guardianDecision: params.guardianDecision,
      actionSummary: `Graph run ${params.runId}, node ${params.nodeId}: ${params.capability}`,
      inputDigest,
    });
    return {
      mayTraverse: false,
      approvalId: requested.approval_id,
      state: 'WAITING_FOR_APPROVAL',
      reason: `Graph node "${params.nodeId}" performs an external action and is waiting for human approval "${requested.approval_id}". The run is halted at this node; work already completed is preserved.`,
    };
  }

  return {
    mayTraverse: false,
    approvalId: gate.approval?.approval_id,
    state: gate.state,
    reason: gate.reason,
  };
}
