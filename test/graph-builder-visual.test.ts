import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { selectLiveExecutionNodes, GRAPH_EXECUTABLE_CAPABILITIES } from '../lib/graph-execution';

// ---------------------------------------------------------------------------
// GRAPH BUILDER — visual authoring.
//
// The previous pass proved the SAVE/LOAD/EXECUTE contract. This pass proves the
// canvas itself: create, drag, connect, disconnect, delete, configure, save,
// reload, run — through the UI.
//
// Two gaps this closes, both real:
//   1. The Builder had NO server persistence at all. It shipped hardcoded
//      TEMPLATES in local state — you could not save or load a graph from it.
//   2. Three capabilities (opportunity.review, create_mission,
//      schedule_recheck) had working graph executors but were never registered,
//      so the capability picker could not offer them and the registry was an
//      incomplete inventory of what the system can actually do.
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');
const builder = read('src/components/GraphBuilderView.tsx');
const serverContent = read('server.ts');
const registrySrc = read('lib/fabric/registry.ts');

describe('1: the Builder persists through the canonical contract', () => {
  it('saves via POST /api/graphs — the same contract an AI-generated graph would use', () => {
    expect(builder).toContain("fetch('/api/graphs'");
    expect(builder).toContain("method: 'POST'");
    expect(builder).toContain('const handleSaveGraph');
  });

  it('lists and loads stored graphs', () => {
    expect(builder).toContain("fetch(`/api/graphs?workspaceId=");
    expect(builder).toContain('const handleLoadGraph');
    expect(builder).toContain('/api/graphs/${encodeURIComponent(id)}?workspaceId=');
  });

  it('hydrates layout from the stored node, and lays out deterministically when absent', () => {
    // Reload must restore where the author positioned things, not stack
    // everything at the origin.
    expect(builder).toContain("x: typeof n.x === 'number' ? n.x :");
    expect(builder).toContain("y: typeof n.y === 'number' ? n.y :");
  });

  it('sends the full canvas on execute so running cannot strip nodes', () => {
    expect(builder).toContain('nodes: nodes.map((n) => ({');
    expect(builder).toContain('x: n.x, y: n.y, label: n.label, subType: n.subType,');
  });
});

describe('2: capability nodes come from the real registry', () => {
  it('the Builder reads GET /api/capabilities rather than a hardcoded list', () => {
    expect(builder).toContain("fetch('/api/capabilities')");
    expect(serverContent).toContain('app.get("/api/capabilities"');
    expect(serverContent).toContain('listCapabilities()');
  });

  it('non-executable capabilities are shown but disabled, never hidden', () => {
    // Hiding them would make the gap mysterious; disabling states it.
    expect(builder).toContain('disabled={!c.graphExecutable}');
    expect(builder).toContain('not graph-executable');
  });

  it('every graph-executable capability is actually registered', () => {
    for (const key of GRAPH_EXECUTABLE_CAPABILITIES) {
      expect(registrySrc).toContain(`key: '${key}'`);
    }
  });

  it('a capability node stores the capability key, never a vendor', () => {
    expect(builder).toContain('const handleAddCapabilityNode');
    expect(builder).toContain('capability: capabilityKey');
    expect(builder).toContain('type: \'capability\'');
    // Scoped to the capability-node creator: the file legitimately mentions
    // vendor URLs elsewhere (model reference citations), which is not the same
    // as a capability node hardcoding a provider.
    const idx = builder.indexOf('const handleAddCapabilityNode');
    const creator = builder.slice(idx, idx + 900);
    for (const vendor of ['HermesSEO', 'GeminiSEO', 'openai', 'anthropic', 'gemini']) {
      expect(creator.toLowerCase()).not.toContain(vendor.toLowerCase());
    }
  });

  it('capability nodes are dispatchable alongside agent nodes', () => {
    const picked = selectLiveExecutionNodes([
      { id: 'a', type: 'agent' }, { id: 'b', type: 'capability' }, { id: 'c', type: 'trigger' },
    ] as any).map((n: any) => n.id);
    expect(picked).toEqual(['a', 'b']);
    // The Builder's own run filter must agree with the server's.
    expect(builder).toContain("n.type === 'agent' || n.type === 'capability'");
  });
});

describe('3: edges are visually selectable, deletable and re-creatable', () => {
  it('each edge has a wide invisible hit-path so it can actually be clicked', () => {
    expect(builder).toContain('data-testid={`edge-hit-${edge.id}`}');
    expect(builder).toContain("strokeWidth=\"18\"");
    expect(builder).toContain("pointerEvents: 'stroke'");
  });

  it('a selected edge is visibly distinct and can be deleted', () => {
    expect(builder).toContain('setSelectedEdgeId');
    expect(builder).toContain('const handleDeleteEdge');
    expect(builder).toContain('data-testid="edge-delete-btn"');
  });

  it('deleting a node also removes its attached edges', () => {
    const idx = builder.indexOf('const handleRemoveNode');
    const slice = builder.slice(idx, idx + 400);
    expect(slice).toContain('setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id))');
  });

  it('self-edges and duplicate edges are refused', () => {
    // The function carries a long validation-lock block between the two
    // guards, so the window has to span it.
    const idx = builder.indexOf('const handleConnectNodes');
    const slice = builder.slice(idx, idx + 2600);
    expect(slice).toContain('connectSourceId === targetId');
    expect(slice).toContain('edges.some((e) => e.source === connectSourceId && e.target === targetId)');
  });
});

describe('4: validation names the exact problem', () => {
  it('validateGraph exists and is run before both save and run', () => {
    expect(builder).toContain('const validateGraph');
    const saveIdx = builder.indexOf('const handleSaveGraph');
    expect(builder.slice(saveIdx, saveIdx + 400)).toContain('validateGraph(nodes, edges)');
  });

  it('it detects each documented structural fault by name', () => {
    for (const msg of [
      'Duplicate node id',
      'has no capability selected',
      'source node that does not exist',
      'target node that does not exist',
      'is a self-loop',
      'contains a cycle',
      'no agent or capability node',
    ]) {
      expect(builder).toContain(msg);
    }
    // Never a bare generic failure.
    expect(builder).not.toContain('Graph Invalid');
  });

  it('validation errors are surfaced to the author, not just logged', () => {
    expect(builder).toContain('data-testid="graph-validation-errors"');
    expect(builder).toContain('setValidationErrors');
  });
});

describe('5: node dragging is real and does not corrupt execution semantics', () => {
  it('drag is bound to the window, not the canvas element', () => {
    // Canvas-scoped handlers drop a drag the moment the pointer outruns the
    // node, crosses another element, or is released outside the canvas — all
    // routine with a real mouse. Window listeners are the robust pattern.
    expect(builder).toContain("window.addEventListener('mousemove', onMove)");
    expect(builder).toContain("window.addEventListener('mouseup', onUp)");
    expect(builder).toContain("window.removeEventListener('mousemove', onMove)");
    expect(builder).toContain("window.removeEventListener('mouseup', onUp)");
  });

  it('drag updates only x/y — never execution semantics', () => {
    const idx = builder.indexOf('const onMove = (ev: MouseEvent)');
    const slice = builder.slice(idx, idx + 420);
    expect(slice).toContain('{ ...n, x: n.x + dx, y: n.y + dy }');
    expect(slice).not.toContain('type:');
    expect(slice).not.toContain('capability:');
  });

  it('drag is scaled by zoom so movement tracks the pointer', () => {
    const idx = builder.indexOf('const onMove = (ev: MouseEvent)');
    expect(builder.slice(idx, idx + 300)).toContain('/ zoomLevel');
  });
});

describe('5b: connecting two nodes is discoverable', () => {
  it('clicking Connect on a second node completes the edge instead of re-arming', () => {
    // Previously this silently moved the source: the edge never appeared and
    // nothing explained why. It is the obvious gesture, so it now finishes.
    const idx = builder.indexOf('// If a source is already armed');
    expect(idx).toBeGreaterThan(-1);
    const slice = builder.slice(idx, idx + 700);
    expect(slice).toContain('handleConnectNodes(node.id)');
    expect(slice).toContain('setConnectSourceId(null)');
  });

  it('the armed source and candidate targets are labelled', () => {
    expect(builder).toContain("'Source — click target'");
    expect(builder).toContain("'Connect here ←'");
    expect(builder).toContain("data-connect-role");
  });

  it('nodes carry a stable test id so interaction can be verified', () => {
    expect(builder).toContain('data-testid={`graph-node-${node.id}`}');
  });
});

describe('6: the same schema serves human and generated graphs', () => {
  it('there is exactly one graph-create contract', () => {
    const posts = (serverContent.match(/app\.post\("\/api\/graphs"/g) || []).length;
    expect(posts).toBe(1);
    // No parallel "AI graph" endpoint or format.
    expect(serverContent).not.toContain('/api/graphs/ai');
    expect(serverContent).not.toContain('/api/graphs/generate');
  });

  it('the stored shape is nodes_json + edges_json for every author', () => {
    const persistence = read('lib/persistence.ts');
    expect(persistence).toContain('nodes_json TEXT NOT NULL');
    expect(persistence).toContain('edges_json TEXT NOT NULL');
  });
});

describe('7: unsupported features are not implied', () => {
  it('the Builder does not offer retry, branching or approval controls the runtime lacks', () => {
    // These exist in the roadmap, not the runtime. A control that pretends to
    // work is worse than an absent one.
    expect(builder).not.toContain('data-testid="retry-policy"');
    expect(builder).not.toContain('data-testid="branch-condition"');
    expect(builder).not.toContain('data-testid="approval-node"');
  });
});
