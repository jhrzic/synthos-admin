import { describe, it, expect } from 'vitest';
import {
  estimateGraphExecution,
  selectLiveExecutionNodes,
  GRAPH_EXECUTION_DEFAULT_MODEL,
} from '../lib/graph-execution';

describe('lib/graph-execution: real routing estimate, never a fabricated dollar figure', () => {
  it('selectLiveExecutionNodes keeps only agent-type nodes (trigger/model/tool/logic never dispatched as real tasks)', () => {
    const nodes = [
      { id: 'n1', type: 'trigger' },
      { id: 'n2', type: 'agent' },
      { id: 'n3', type: 'model' },
      { id: 'n4', type: 'tool' },
      { id: 'n5', type: 'agent' },
    ];
    expect(selectLiveExecutionNodes(nodes).map((n) => n.id)).toEqual(['n2', 'n5']);
  });

  it('a node with no type defaults to being treated as agent (matches the estimate/execute default)', () => {
    expect(selectLiveExecutionNodes([{ id: 'n1' }]).map((n) => n.id)).toEqual(['n1']);
  });

  it('costEstimateUsd is always null and status is always ESTIMATE_UNAVAILABLE — no invented dollar figure', () => {
    const est = estimateGraphExecution([{ id: 'n1', type: 'agent', label: 'A' }]);
    expect(est.costEstimateUsd).toBeNull();
    expect(est.costEstimateStatus).toBe('ESTIMATE_UNAVAILABLE');
    expect(est.costEstimateReason.length).toBeGreaterThan(0);
  });

  it('a node with no assignedModel is estimated against the real execution default, not a guess', () => {
    const est = estimateGraphExecution([{ id: 'n1', type: 'agent', label: 'A' }]);
    expect(est.nodes[0].requestedModel).toBe(GRAPH_EXECUTION_DEFAULT_MODEL);
    expect(est.nodes[0].routing.provider).toBe('GEMINI');
  });

  it('a node requesting an unconfigured provider is flagged UNSUPPORTED and drives allNodesRoutable=false', () => {
    const est = estimateGraphExecution([
      { id: 'n1', type: 'agent', label: 'A', assignedModel: 'gemini-3.1-flash-lite' },
      { id: 'n2', type: 'agent', label: 'B', assignedModel: 'gpt-4o' },
    ]);
    expect(est.allNodesRoutable).toBe(false);
    expect(est.unroutableNodes.map((n) => n.nodeId)).toEqual(['n2']);
    expect(est.unroutableNodes[0].routing.provider).toBe('UNSUPPORTED');
  });

  it('non-agent nodes are excluded from the estimate entirely (agentNodeCount != totalNodeCount)', () => {
    const est = estimateGraphExecution([
      { id: 'n1', type: 'trigger' },
      { id: 'n2', type: 'agent' },
    ]);
    expect(est.totalNodeCount).toBe(2);
    expect(est.agentNodeCount).toBe(1);
    expect(est.nodes.length).toBe(1);
  });

  it('all nodes routable when every assigned model resolves to a real configured provider', () => {
    const est = estimateGraphExecution([
      { id: 'n1', type: 'agent', assignedModel: 'gemini-3.1-flash-lite' },
      { id: 'n2', type: 'agent', assignedModel: 'gemini-3.7-flash' },
    ]);
    expect(est.allNodesRoutable).toBe(true);
    expect(est.unroutableNodes).toEqual([]);
  });
});
