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
  return nodes.filter((n) => (n.type || 'agent') === 'agent');
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
