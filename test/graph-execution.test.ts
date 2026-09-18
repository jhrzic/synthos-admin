import { describe, it, expect } from 'vitest';
import {
  estimateGraphExecution,
  selectLiveExecutionNodes,
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

  it('a node with no assignedModel is NOT_SELECTED — there is no default model to fall back to', () => {
    const est = estimateGraphExecution([{ id: 'n1', type: 'agent', label: 'A' }]);
    expect(est.nodes[0].requestedModel).toBe('');
    expect(est.nodes[0].routing).toMatchObject({ provider: 'NOT_SELECTED', routable: false, code: 'MODEL_NOT_SELECTED' });
    expect(est.allNodesRoutable).toBe(false);
  });

  it('a node requesting a provider no one can run is flagged UNSUPPORTED and drives allNodesRoutable=false', () => {
    const est = estimateGraphExecution([
      { id: 'n1', type: 'agent', label: 'A', assignedModel: 'gemini-3.1-flash-lite' },
      { id: 'n2', type: 'agent', label: 'B', assignedModel: 'claude' },
    ]);
    expect(est.allNodesRoutable).toBe(false);
    expect(est.unroutableNodes.map((n) => n.nodeId)).toEqual(['n2']);
    expect(est.unroutableNodes[0].routing.provider).toBe('UNSUPPORTED');
  });

  // Graph nodes now route through the model registry exactly like the
  // kernel, so any registered model on a MODEL_CALL protocol is routable here
  // too. Routable is not the same as runnable: availability (qualification,
  // enablement, pricing, policy) is reported separately and is decided by the
  // spend guard at dispatch.
  it('a registered model on another dispatchable protocol is routable; its availability is reported separately', () => {
    const est = estimateGraphExecution([
      { id: 'n1', type: 'agent', label: 'A', assignedModel: 'gemini-3.1-flash-lite' },
      { id: 'n2', type: 'agent', label: 'B', assignedModel: 'gpt-4o' },
    ]);
    expect(est.allNodesRoutable).toBe(true);
    expect(est.nodes[1].routing).toMatchObject({ provider: 'openai', routable: true, resolvedModel: 'gpt-4o' });
    // Installed but not qualified in a fresh registry: routable, not executable.
    expect(est.nodes[1].routing.executable).toBe(false);
    expect(est.nodes[1].routing.availability).not.toBe('AVAILABLE');
  });

  it('a registered model on a protocol this build cannot dispatch is unroutable', () => {
    const est = estimateGraphExecution([{ id: 'n1', type: 'agent', label: 'A', assignedModel: 'claude-opus-5' }]);
    expect(est.allNodesRoutable).toBe(false);
    expect(est.unroutableNodes[0].routing).toMatchObject({ provider: 'UNSUPPORTED', code: 'UNSUPPORTED_BY_ADAPTER' });
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
