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
  const unroutableNodes = nodeEstimates.filter((e) => e.routing.provider === 'UNSUPPORTED');

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
