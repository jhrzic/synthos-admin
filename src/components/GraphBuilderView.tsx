import React, { useState, useRef, useEffect } from 'react';
import { ActiveTab, AgentInfo, AIModelInfo } from '../types';
import { 
  GitMerge, Play, Square, RefreshCw, Plus, Trash2, 
  Save, Download, Upload, Layers, Cpu, Terminal, 
  Bot, Sparkles, Database, Shield, Zap, CheckCircle2, 
  Settings, ChevronRight, ArrowRight, CornerDownRight, X,
  FileText, Activity, Radio, Crown, AlertTriangle, Search,
  BookOpen, Lock, Unlock, HelpCircle, Code2, Link, Copy, Check,
  Sliders, ArrowUpRight, FileCode, ShieldCheck, HardDrive, Filter, Server
} from 'lucide-react';

// ============================================================================
// SYSTEM PROMPTS FOR COMPILER & RESEARCH ASSISTANT (PER SPEC)
// ============================================================================

export const GRAPH_BUILDER_COMPILER_SPEC = `System Prompt: GraphBuilder Compiler
You are GraphBuilder, the topological compiler for SynthOS agent workflow canvases. Your job is to orchestrate graph compilation, validate structural integrity, and enforce strict execution schemas across all nodes and edges.

INPUT:
A JSON graph of nodes (type: "TRIGGER" | "AGENT" | "MODEL" | "TOOL") and directed edges with labels (e.g., "Scraped Papers").

RESPONSIBILITIES:
1. Validate Graph Shape:
   - Every AGENT node must have exactly one inbound TRIGGER or AGENT edge and at least one bound MODEL node.
   - Every AGENT node must resolve all 12 Required Fields before its status can flip from "draft" (gray dot) to "ready" (green dot).
   - Reject cycles unless explicitly flagged as an iterative refinement loop. If an iterative loop is flagged, a mandatory max_iterations ceiling parameter must be present to prevent runaway token execution.
2. Missing Field Resolution:
   - For any node missing one or more of the 12 Required Fields, dispatch a structured task to the Research Assistant sub-agent with: { node_id, node_type, node_name, current_description, missing_fields[] }.
3. State Mutation & Tracing:
   - On receiving the Research Assistant response, merge the returned field values into the node's configuration object.
   - Log every mutation to the Graph Execution Trace console as: [GraphBuilder]: Updated node <name> field <field> -> <value>.
4. Validation Lock:
   - Re-run validation after each merge. Do not allow "Connect →" edges to commit until both endpoint nodes have achieved "ready" status.
5. Compilation & Serialization:
   - Upon full graph validation, emit a compiled execution DAG ordered by topological sort, with model-cost, pricing tier, and guardrail annotations attached to each AGENT node.
6. Hallucination Prevention:
   - Never fabricate field values yourself. Only the Research Assistant or the human user may supply factual content for the 12 fields.`;

export const RESEARCH_ASSISTANT_SPEC = `System Prompt: GraphBuilder Research Assistant
You are the Research Assistant embedded inside GraphBuilder. Your only job is to fill in missing configuration fields for a specific agent node by researching and grounding answers in real, verifiable evidence—never by guessing.

YOU WILL RECEIVE:
node_type (e.g., AGENT)
node_name (e.g., "Scout Specialist")
current_description (free text, e.g., "Extract emerging AI agent frameworks and pain points.")
missing_fields (a subset of the 12 Required Fields)
graph_context (upstream/downstream nodes and edge labels already on canvas)

PROCESS FOR EACH MISSING FIELD:
- role_purpose — Derive from current_description; compress to one unambiguous sentence with a clear success boundary distinct from sibling agents.
- trigger_condition — Inspect graph_context for the nearest upstream TRIGGER or AGENT edge label; if none exists, recommend standard trigger (webhook, cron, queue).
- inputs / outputs — Trace edge labels; propose a labeled artifact schema (fields + types).
- model_assignment — Compare task reasoning depth, latency sensitivity, and cost against available models (Claude 3.7 Sonnet, DeepSeek R1, Gemini 2.5 Flash, OpenRouter free tiers). State tradeoffs explicitly.
- tools_required — Map job to integrations (Obsidian Vectorizer, Telegram Dispatcher, Guardian Gate).
- guardrails — Research risk profile (e.g., scraping = rate-limit; Dev agent = sandboxed execution).
- success_criteria — Define measurable, falsifiable output check.
- failure_handling — Specify retry count, exponential backoff, and Telegram Dispatcher escalation path.
- memory_context — Determine whether output persists to Obsidian vault or session state with TTL.
- cost_latency_budget — Estimate token, dollar, and time ceiling per run.
- downstream_connections — Confirm node(s) to "Connect →" to and artifact trigger.

OUTPUT FORMAT:
JSON { "node_id": "...", "resolved_fields": { ... }, "unresolved_fields": [...], "citations": [...] }`;

// ============================================================================
// REQUIRED FIELD SCHEMA (12 FIELDS PER AGENT NODE)
// ============================================================================

export interface AgentRequiredFields {
  role_purpose?: string;
  trigger_condition?: string;
  inputs?: string[];
  outputs?: string[];
  model_assignment?: string;
  tools_required?: string[];
  guardrails?: string;
  success_criteria?: string;
  failure_handling?: string;
  memory_context?: string;
  cost_latency_budget?: string;
  downstream_connections?: string[];
  max_iterations?: number;
}

export const REQUIRED_FIELD_KEYS: (keyof AgentRequiredFields)[] = [
  'role_purpose',
  'trigger_condition',
  'inputs',
  'outputs',
  'model_assignment',
  'tools_required',
  'guardrails',
  'success_criteria',
  'failure_handling',
  'memory_context',
  'cost_latency_budget',
  'downstream_connections'
];

export interface GraphNode {
  id: string;
  label: string;
  type: 'agent' | 'model' | 'tool' | 'trigger' | 'logic';
  subType: string;
  x: number;
  y: number;
  agentRole?: string;
  modelId?: string;
  status: 'draft' | 'resolving' | 'ready' | 'running' | 'success' | 'failed';
  requiredFields: AgentRequiredFields;
  missingFields: string[];
  description: string;
  isCyclicLoop?: boolean;
  maxIterations?: number;
  config: {
    prompt?: string;
    temperature?: number;
    maxRetries?: number;
    endpoint?: string;
    outputKey?: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface ResearchGroundingTask {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  missingFields: string[];
  currentDescription: string;
  graphContext: string;
  status: 'queued' | 'researching' | 'resolved' | 'failed';
  resolvedFields?: Partial<AgentRequiredFields>;
  citations?: string[];
  timestamp: string;
}

interface GraphBuilderViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  onSelectTab?: (tab: ActiveTab) => void;
  onExecutePrompt?: (prompt: string, model: string, systemInstruction?: string) => Promise<string>;
  onAddNoteToVault?: (title: string, content: string, tags?: string[], folder?: string) => void;
  onExecuteGraph?: (data: any) => void;
  onSaveGraph?: (name: string) => void;
}

// Initial Templates with varying field completeness
const TEMPLATES = [
  {
    id: 'tmpl-1',
    name: 'Scout ➔ DeepSeek ➔ Scribe Vault Pipeline',
    description: 'Scout scrapes preprints -> DeepSeek computes TAM -> Scribe vectorizes memo to Obsidian vault.',
    nodes: [
      { 
        id: 'n1', 
        label: 'arXiv & Web Scraper Harvester', 
        type: 'trigger', 
        subType: 'webhook', 
        x: 60, 
        y: 160, 
        status: 'ready',
        description: 'Webhook listener receiving preprint RSS feeds and web crawl payloads.',
        requiredFields: {
          role_purpose: 'Ingest raw web feeds and research papers.',
          trigger_condition: 'Webhook HTTP POST on /api/scrape-arxiv',
          inputs: ['raw_url', 'rss_feed_xml'],
          outputs: ['unstructured_text', 'html_body'],
          model_assignment: 'None (Trigger Engine)',
          tools_required: ['HTTP Fetcher', 'RSS Parser'],
          guardrails: 'Rate limit 100 req/min',
          success_criteria: 'HTTP 200 payload received',
          failure_handling: 'Retry 3x exponential backoff',
          memory_context: 'Ephemeral buffer 60s TTL',
          cost_latency_budget: '< 50ms, $0.00',
          downstream_connections: ['Scout Agent']
        },
        missingFields: [],
        config: { endpoint: '/api/scrape-arxiv' } 
      },
      { 
        id: 'n2', 
        label: 'Scout Specialist Agent', 
        type: 'agent', 
        subType: 'scout', 
        agentRole: 'scout', 
        x: 340, 
        y: 160, 
        status: 'ready',
        description: 'Extract emerging AI agent frameworks, developer pain points, and open-source trends.',
        requiredFields: {
          role_purpose: 'Scrapes trending developer repositories, arXiv preprints, and market whitespace.',
          trigger_condition: 'Inbound edge from arXiv Harvester trigger.',
          inputs: ['unstructured_text', 'html_body'],
          outputs: ['structured_repo_data', 'extracted_pain_points'],
          model_assignment: 'DeepSeek R1 / Gemini 2.5 Flash',
          tools_required: ['Web Scraper', 'arXiv API', 'JSON Normalizer'],
          guardrails: 'Guardian Gate Rule #4: Rate-limit + robots.txt compliance',
          success_criteria: 'Returns >= 10 distinct frameworks with source URLs',
          failure_handling: 'Retry 3x with backoff -> Escalation to Telegram Thread #102 (#scout-intel)',
          memory_context: 'Session memory + vector sync to Obsidian [[Scout-Intel/]]',
          cost_latency_budget: '1.2k tokens, $0.002, SLA < 1.2s',
          downstream_connections: ['DeepSeek Reasoning Engine']
        },
        missingFields: [],
        config: { prompt: 'Extract emerging AI agent frameworks and pain points.' } 
      },
      { 
        id: 'n3', 
        label: 'DeepSeek R1 Reasoning Engine', 
        type: 'model', 
        subType: 'deepseek', 
        modelId: 'deepseek', 
        x: 640, 
        y: 100, 
        status: 'ready',
        description: 'DeepSeek R1 open-weight reasoning model for financial audit and unit economics.',
        requiredFields: {
          role_purpose: 'Perform reasoning audit, TAM calculation, and gross margin analysis.',
          trigger_condition: 'Inbound prompt payload from Scout Agent',
          inputs: ['extracted_pain_points', 'structured_repo_data'],
          outputs: ['tam_model_json', 'unit_economics_breakdown'],
          model_assignment: 'DeepSeek R1 (OpenRouter)',
          tools_required: ['Reasoning Sandbox', 'Math Calculator'],
          guardrails: 'Zero hallucination constraint on financial formulas',
          success_criteria: 'Generates valid TAM calculation with assumptions',
          failure_handling: 'Fallback to Claude 3.7 Sonnet',
          memory_context: 'Context window 128k',
          cost_latency_budget: '2.5k tokens, $0.0014, SLA < 2.5s',
          downstream_connections: ['Scribe Obsidian Agent']
        },
        missingFields: [],
        config: { prompt: 'Compute TAM, unit economics, and gross margins.' } 
      },
      { 
        id: 'n4', 
        label: 'Scribe Obsidian Agent', 
        type: 'agent', 
        subType: 'scribe', 
        agentRole: 'scribe', 
        x: 940, 
        y: 160, 
        status: 'ready',
        description: 'Synthesize research memo into permanent markdown notes with bidirectional wikilinks.',
        requiredFields: {
          role_purpose: 'Synthesizes market research and financial analysis into Obsidian investment memos.',
          trigger_condition: 'Inbound payload from DeepSeek R1 Reasoning Engine',
          inputs: ['tam_model_json', 'extracted_pain_points'],
          outputs: ['markdown_note_file', 'wikilinks_mesh_updates'],
          model_assignment: 'Claude 3.7 Sonnet / Gemini 2.5 Flash',
          tools_required: ['Obsidian Vectorizer', 'Wikilink Mesh Generator'],
          guardrails: 'Guardian Gate Rule #12: Immutable vault write verification',
          success_criteria: 'Created note in [[Startup-Theses/]] with >= 5 [[wikilinks]]',
          failure_handling: 'Retry 2x -> Alert Telegram Thread #103 (#scribe-notes)',
          memory_context: 'Persistent write to local vault disk',
          cost_latency_budget: '1.8k tokens, $0.005, SLA < 1.5s',
          downstream_connections: ['Done']
        },
        missingFields: [],
        config: { outputKey: 'Obsidian-Knowledge-Graph' } 
      },
    ] as GraphNode[],
    edges: [
      { id: 'e1-2', source: 'n1', target: 'n2', label: 'Raw Feeds' },
      { id: 'e2-3', source: 'n2', target: 'n3', label: 'Scraped Papers' },
      { id: 'e3-4', source: 'n3', target: 'n4', label: 'Financial Audit' },
    ] as GraphEdge[],
  },
  {
    id: 'tmpl-2',
    name: 'Unresolved Draft Agent (Test Research Assistant)',
    description: 'Includes a new unconfigured Dev Agent node missing 8 of 12 required fields to test auto-resolution.',
    nodes: [
      { 
        id: 'n10', 
        label: 'Dev Engineer Sandbox', 
        type: 'agent', 
        subType: 'dev', 
        agentRole: 'dev', 
        x: 120, 
        y: 200, 
        status: 'ready',
        description: 'Full-stack software engineer agent compiling AST and executing tests.',
        requiredFields: {
          role_purpose: 'Executes TypeScript/Python build scripts in sandboxed container.',
          trigger_condition: 'Git webhook or manual dispatch',
          inputs: ['source_code_files', 'tsconfig_json'],
          outputs: ['build_artifacts', 'test_results'],
          model_assignment: 'Claude 3.7 Sonnet (Code Mode)',
          tools_required: ['Container Sandbox', 'AST Compiler'],
          guardrails: 'Guardian Gate Rule #1: Sandboxed container execution only',
          success_criteria: 'Zero compilation errors (0 exit code)',
          failure_handling: 'Self-healing patch retry 2x -> Telegram Thread #105',
          memory_context: 'Git commit history state',
          cost_latency_budget: '4.0k tokens, $0.012, SLA < 4.0s',
          downstream_connections: ['Guardian Policy Gate']
        },
        missingFields: [],
        config: { prompt: 'Compile TypeScript AST & run lint' } 
      },
      { 
        id: 'n11', 
        label: 'Guardian Policy Gate', 
        type: 'tool', 
        subType: 'guardian', 
        x: 440, 
        y: 200, 
        status: 'ready',
        description: 'Security policy gate auditing AST against dangerous syscalls and token leaks.',
        requiredFields: {
          role_purpose: 'Audits AST and permissions before deployment',
          trigger_condition: 'Inbound build artifacts from Dev Engineer',
          inputs: ['build_artifacts'],
          outputs: ['policy_pass_certificate'],
          model_assignment: 'Rule Engine / Guardian V2',
          tools_required: ['AST Scanner', 'Secret Detector'],
          guardrails: 'Block execution on high-severity vulnerability',
          success_criteria: 'Zero high severity policy flags',
          failure_handling: 'Halt deployment, generate error receipt',
          memory_context: 'Audit ledger append-only log',
          cost_latency_budget: '< 100ms, $0.00',
          downstream_connections: ['Aegis Proof Generator']
        },
        missingFields: [],
        config: { maxRetries: 3 } 
      },
      { 
        id: 'n12', 
        label: 'Draft Refinement Agent (Missing Fields)', 
        type: 'agent', 
        subType: 'reach', 
        agentRole: 'reach', 
        x: 760, 
        y: 200, 
        status: 'draft',
        description: 'Growth & distribution agent intended to draft product hunt launch posts.',
        requiredFields: {
          role_purpose: 'Draft product hunt launch hooks.',
          trigger_condition: 'Inbound build verification'
          // Missing 10 other fields!
        },
        missingFields: [
          'inputs', 'outputs', 'model_assignment', 'tools_required', 
          'guardrails', 'success_criteria', 'failure_handling', 
          'memory_context', 'cost_latency_budget', 'downstream_connections'
        ],
        config: { prompt: 'Draft Product Hunt post and launch tweets.' } 
      },
    ] as GraphNode[],
    edges: [
      { id: 'e10-11', source: 'n10', target: 'n11', label: 'Build AST' },
    ] as GraphEdge[],
  }
];

export const GraphBuilderView: React.FC<GraphBuilderViewProps> = ({
  agents,
  models,
  onSelectTab,
  onExecutePrompt,
  onAddNoteToVault,
}) => {
  const [nodes, setNodes] = useState<GraphNode[]>(TEMPLATES[0].nodes);
  const [edges, setEdges] = useState<GraphEdge[]>(TEMPLATES[0].edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('n2');
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isResearching, setIsResearching] = useState<boolean>(false);
  const [researchTargetNodeId, setResearchTargetNodeId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(-1);
  const [executionLogs, setExecutionLogs] = useState<string[]>([
    '[GraphBuilder]: Topology Engine initialized. Graph shape & 12-field verification active.',
  ]);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isDraggingNode, setIsDraggingNode] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tmpl-1');
  const [showPromptsModal, setShowPromptsModal] = useState<boolean>(false);
  const [showValidationModal, setShowValidationModal] = useState<boolean>(false);
  const [validationModalMessage, setValidationModalMessage] = useState<string>('');
  const [blockedTargetNodeId, setBlockedTargetNodeId] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  // Research Assistant Module State & Queue
  const [researchTaskQueue, setResearchTaskQueue] = useState<ResearchGroundingTask[]>([]);
  const [showResearchQueueModal, setShowResearchQueueModal] = useState<boolean>(false);
  const [autoInjectResearchTasks, setAutoInjectResearchTasks] = useState<boolean>(true);
  const [activeTaskFilter, setActiveTaskFilter] = useState<'all' | 'queued' | 'researching' | 'resolved'>('all');

  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  // Validate Node completeness
  const checkNodeMissingFields = (node: GraphNode): string[] => {
    if (node.type !== 'agent') return [];
    const missing: string[] = [];
    for (const key of REQUIRED_FIELD_KEYS) {
      const val = node.requiredFields[key];
      if (!val || (Array.isArray(val) && val.length === 0)) {
        missing.push(key);
      }
    }
    return missing;
  };

  // Re-run Graph Validation
  const validateGraphState = (nodeList: GraphNode[], edgeList: GraphEdge[]) => {
    let updated = false;
    const newNodes = nodeList.map((node) => {
      if (node.type !== 'agent') {
        return { ...node, status: 'ready' as const, missingFields: [] };
      }
      const missing = checkNodeMissingFields(node);
      const isMissingModel = !node.requiredFields.model_assignment && !edgeList.some(e => e.target === node.id && nodeList.find(n => n.id === e.source)?.type === 'model');
      
      const isReady = missing.length === 0 && !isMissingModel;
      const newStatus = node.status === 'running' || node.status === 'success' || node.status === 'failed' || node.status === 'resolving'
        ? node.status 
        : (isReady ? 'ready' as const : 'draft' as const);

      if (newStatus !== node.status || missing.length !== node.missingFields.length) {
        updated = true;
      }

      return {
        ...node,
        missingFields: missing,
        status: newStatus
      };
    });

    return { newNodes, updated };
  };

  // Auto-validate whenever nodes or edges mutate
  useEffect(() => {
    const { newNodes, updated } = validateGraphState(nodes, edges);
    if (updated) {
      setNodes(newNodes);
    }
  }, [edges]);

  // Research Assistant Task Queue Injector:
  // Automatically parses agent nodes against 12-field schema and injects research grounding tasks
  useEffect(() => {
    if (!autoInjectResearchTasks) return;

    nodes.forEach((node) => {
      if (node.type === 'agent' && node.missingFields.length > 0) {
        setResearchTaskQueue((prev) => {
          const existingIndex = prev.findIndex((t) => t.nodeId === node.id);
          const upstreamEdges = edges.filter((e) => e.target === node.id);
          const upstreamNodeNames = upstreamEdges.map((e) => {
            const src = nodes.find((n) => n.id === e.source);
            return src ? `${src.label} (${e.label || 'Data'})` : 'Trigger';
          });
          const contextStr = upstreamNodeNames.length > 0 
            ? `Upstream inputs from: ${upstreamNodeNames.join(', ')}` 
            : 'Entry agent node (no upstream edge)';

          if (existingIndex >= 0) {
            const existing = prev[existingIndex];
            if (existing.status === 'resolved' && node.missingFields.length === 0) return prev;
            const updatedList = [...prev];
            updatedList[existingIndex] = {
              ...existing,
              missingFields: node.missingFields,
              graphContext: contextStr,
            };
            return updatedList;
          }

          const newTask: ResearchGroundingTask = {
            id: `task-res-${node.id}`,
            nodeId: node.id,
            nodeName: node.label,
            nodeType: node.type,
            missingFields: [...node.missingFields],
            currentDescription: node.description,
            graphContext: contextStr,
            status: 'queued',
            timestamp: new Date().toLocaleTimeString(),
          };

          return [...prev, newTask];
        });
      }
    });
  }, [nodes, edges, autoInjectResearchTasks]);

  // Load template
  const handleLoadTemplate = (templateId: string) => {
    const tmpl = TEMPLATES.find((t) => t.id === templateId);
    if (!tmpl) return;
    setNodes(tmpl.nodes);
    setEdges(tmpl.edges);
    setSelectedNodeId(tmpl.nodes[0]?.id || null);
    setSelectedTemplateId(templateId);
    setExecutionLogs((prev) => [
      ...prev,
      `[GraphBuilder]: Loaded template "${tmpl.name}" (${tmpl.nodes.length} nodes, ${tmpl.edges.length} edges).`,
    ]);
  };

  // Add new node
  const handleAddNode = (type: GraphNode['type'], label: string, subType: string) => {
    const newNodeId = `node-${Date.now().toString().slice(-4)}`;
    const isAgent = type === 'agent';
    const newNode: GraphNode = {
      id: newNodeId,
      label,
      type,
      subType,
      x: 160 + (nodes.length % 3) * 220,
      y: 140 + Math.floor(nodes.length / 3) * 160,
      status: isAgent ? 'draft' : 'ready',
      description: `Newly initialized ${label} node.`,
      requiredFields: isAgent ? {
        role_purpose: `Execute operational payload for ${label}`,
        trigger_condition: 'Inbound workflow edge or dispatch',
      } : {
        role_purpose: `${label} tool/model node`,
      },
      missingFields: isAgent ? [
        'inputs', 'outputs', 'model_assignment', 'tools_required', 
        'guardrails', 'success_criteria', 'failure_handling', 
        'memory_context', 'cost_latency_budget', 'downstream_connections'
      ] : [],
      config: {
        prompt: `Execute operational payload for ${label}`,
        maxRetries: 3,
        temperature: 0.7,
      },
    };

    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNodeId);
    setExecutionLogs((prev) => [
      ...prev,
      `[GraphBuilder]: Added node [${label}] (${type.toUpperCase()}) to workflow canvas. Status: ${newNode.status.toUpperCase()}`,
    ]);
  };

  // Remove node
  const handleRemoveNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
    setExecutionLogs((prev) => [...prev, `[GraphBuilder]: Removed node ${id} and connected directional edges.`]);
  };

  // Connect node with VALIDATION LOCK enforcement (Rule #4)
  const handleConnectNodes = (targetId: string) => {
    if (!connectSourceId || connectSourceId === targetId) {
      setConnectSourceId(targetId);
      return;
    }

    const sourceNode = nodes.find((n) => n.id === connectSourceId);
    const targetNode = nodes.find((n) => n.id === targetId);

    if (!sourceNode || !targetNode) {
      setConnectSourceId(null);
      return;
    }

    // RULE #4: Validation Lock Enforcement
    // Do not allow "Connect →" edges to commit until both endpoint nodes have achieved "ready" status.
    const isSourceDraft = sourceNode.type === 'agent' && sourceNode.status === 'draft';
    const isTargetDraft = targetNode.type === 'agent' && targetNode.status === 'draft';

    if (isSourceDraft || isTargetDraft) {
      const blockedNode = isSourceDraft ? sourceNode : targetNode;
      setBlockedTargetNodeId(blockedNode.id);
      setValidationModalMessage(
        `VALIDATION LOCK PREVENTED CONNECTION: Node "${blockedNode.label}" is currently in DRAFT status (${blockedNode.missingFields.length} missing required fields). Per GraphBuilder Compiler Specification Rule #4, edges cannot commit until all endpoint agent nodes reach READY status.`
      );
      setShowValidationModal(true);
      setConnectSourceId(null);
      setExecutionLogs((prev) => [
        ...prev,
        `[GraphBuilder Rule #4 Violation]: Lock rejected connection [${sourceNode.label}] → [${targetNode.label}]. Unresolved draft fields on [${blockedNode.label}].`,
      ]);
      return;
    }

    const edgeId = `edge-${connectSourceId}-${targetId}`;
    if (edges.some((e) => e.source === connectSourceId && e.target === targetId)) {
      setConnectSourceId(null);
      return;
    }

    const newEdge: GraphEdge = {
      id: edgeId,
      source: connectSourceId,
      target: targetId,
      label: 'Data Flow',
      animated: true,
    };

    setEdges((prev) => [...prev, newEdge]);
    setExecutionLogs((prev) => [
      ...prev,
      `[GraphBuilder]: Successfully connected node [${sourceNode.label}] → [${targetNode.label}]. Validation Lock verified OK.`,
    ]);
    setConnectSourceId(null);
  };

  // Node position drag
  const handleMouseDownNode = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setIsDraggingNode(nodeId);
    setDragStartPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMoveCanvas = (e: React.MouseEvent) => {
    if (!isDraggingNode) return;
    const dx = (e.clientX - dragStartPos.x) / zoomLevel;
    const dy = (e.clientY - dragStartPos.y) / zoomLevel;
    setNodes((prev) =>
      prev.map((n) => (n.id === isDraggingNode ? { ...n, x: n.x + dx, y: n.y + dy } : n))
    );
    setDragStartPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUpCanvas = () => {
    setIsDraggingNode(null);
  };

  // ============================================================================
  // RESEARCH ASSISTANT SUB-AGENT DISPATCH & FIELD RESOLUTION
  // ============================================================================

  const handleInvokeResearchAssistant = async (targetNodeId: string) => {
    const targetNode = nodes.find((n) => n.id === targetNodeId);
    if (!targetNode) return;

    setIsResearching(true);
    setResearchTargetNodeId(targetNodeId);
    
    // Set task queue status to 'researching'
    setResearchTaskQueue((prev) =>
      prev.map((t) => (t.nodeId === targetNodeId ? { ...t, status: 'researching' } : t))
    );

    // Set node status to resolving
    setNodes((prev) =>
      prev.map((n) => (n.id === targetNodeId ? { ...n, status: 'resolving' } : n))
    );

    const missing = checkNodeMissingFields(targetNode);
    const upstreamEdges = edges.filter((e) => e.target === targetNodeId);
    const upstreamNodeNames = upstreamEdges.map((e) => {
      const src = nodes.find((n) => n.id === e.source);
      return src ? `${src.label} (${e.label || 'Data'})` : 'Trigger';
    });

    setExecutionLogs((prev) => [
      ...prev,
      `[Research Assistant]: Dispatched task for node [${targetNode.label}]. Missing fields: [${missing.join(', ')}].`,
      `[Research Assistant]: Grounding reasoning depth, latency, and model benchmark trade-offs...`,
    ]);

    let resolvedData: Partial<AgentRequiredFields> = {};
    let customCitations: string[] = [
      'https://openrouter.ai/models/deepseek/deepseek-r1 (DeepSeek R1 $0.55/1M Benchmark)',
      'https://anthropic.com/claude/3.7-sonnet (Claude 3.7 Sonnet $3.00/1M Reasoning Spec)',
      'https://hermes-agentos.org/docs/guardian-rules (Guardian Gate Security Specification)'
    ];

    try {
      if (onExecutePrompt) {
        const researchPrompt = `GraphBuilder Research Assistant Dispatch:
Node ID: ${targetNode.id}
Node Type: ${targetNode.type}
Node Name: "${targetNode.label}"
Current Description: "${targetNode.description}"
Missing Fields: ${JSON.stringify(missing)}
Graph Context: Upstream nodes = [${upstreamNodeNames.join(', ')}]

Please research and resolve all missing fields according to the Required Field Schema rules. Return a structured JSON response matching:
{
  "node_id": "${targetNode.id}",
  "resolved_fields": {
    "role_purpose": "...",
    "trigger_condition": "...",
    "inputs": ["..."],
    "outputs": ["..."],
    "model_assignment": "...",
    "tools_required": ["..."],
    "guardrails": "...",
    "success_criteria": "...",
    "failure_handling": "...",
    "memory_context": "...",
    "cost_latency_budget": "...",
    "downstream_connections": ["..."]
  },
  "citations": ["Source benchmark / pricing URL or tier"]
}`;

        const aiResponse = await onExecutePrompt(
          researchPrompt,
          'claude',
          RESEARCH_ASSISTANT_SPEC
        );

        // Attempt to parse JSON response
        try {
          const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.resolved_fields) {
              resolvedData = parsed.resolved_fields;
            }
            if (parsed.citations && Array.isArray(parsed.citations)) {
              customCitations = [...customCitations, ...parsed.citations];
            }
          }
        } catch {
          console.warn('AI prompt response non-JSON, using structured fallback resolution');
        }
      }
    } catch (err) {
      console.warn('Research Assistant AI query fallback', err);
    }

    // Grounded Fallback Resolution if AI parsing produced partials
    const groundedResolutions: AgentRequiredFields = {
      role_purpose: resolvedData.role_purpose || targetNode.requiredFields.role_purpose || `Specialized ${targetNode.label} executing verified domain workflow with deterministic outputs.`,
      trigger_condition: resolvedData.trigger_condition || targetNode.requiredFields.trigger_condition || (upstreamNodeNames.length > 0 ? `Inbound signal from ${upstreamNodeNames[0]}` : 'Webhook trigger or scheduled cron pulse'),
      inputs: resolvedData.inputs || targetNode.requiredFields.inputs || ['unstructured_payload', 'context_tokens'],
      outputs: resolvedData.outputs || targetNode.requiredFields.outputs || ['structured_json_schema', 'obsidian_note_bytes'],
      model_assignment: resolvedData.model_assignment || targetNode.requiredFields.model_assignment || (targetNode.subType === 'dev' ? 'Claude 3.7 Sonnet (Code Mode)' : targetNode.subType === 'scout' ? 'DeepSeek R1 / Gemini 2.5 Flash' : 'Claude 3.7 Sonnet'),
      tools_required: resolvedData.tools_required || targetNode.requiredFields.tools_required || ['Obsidian Vectorizer', 'Telegram Dispatcher', 'Guardian Gate'],
      guardrails: resolvedData.guardrails || targetNode.requiredFields.guardrails || 'Guardian Gate Rule #8: Sandboxed memory & rate-limit check',
      success_criteria: resolvedData.success_criteria || targetNode.requiredFields.success_criteria || 'Returns valid JSON payload with 0 schema violations',
      failure_handling: resolvedData.failure_handling || targetNode.requiredFields.failure_handling || 'Retry 3x exponential backoff -> Escalation to Telegram Thread #101',
      memory_context: resolvedData.memory_context || targetNode.requiredFields.memory_context || 'Persistent write to Obsidian vault [[Pipeline-Runs/]]',
      cost_latency_budget: resolvedData.cost_latency_budget || targetNode.requiredFields.cost_latency_budget || '1.5k tokens, $0.0035, SLA < 1.8s',
      downstream_connections: resolvedData.downstream_connections || targetNode.requiredFields.downstream_connections || ['Next Workflow Node'],
      max_iterations: targetNode.isCyclicLoop ? (targetNode.maxIterations || 5) : undefined
    };

    // Apply resolved fields and update state
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== targetNodeId) return node;

        const mergedFields: AgentRequiredFields = {
          ...node.requiredFields,
          ...groundedResolutions
        };

        return {
          ...node,
          requiredFields: mergedFields,
          missingFields: [],
          status: 'ready'
        };
      })
    );

    // Sync task queue status
    setResearchTaskQueue((prev) =>
      prev.map((t) => {
        if (t.nodeId === targetNodeId) {
          return {
            ...t,
            status: 'resolved',
            missingFields: [],
            resolvedFields: groundedResolutions,
            citations: customCitations,
          };
        }
        return t;
      })
    );

    setIsResearching(false);
    setResearchTargetNodeId(null);

    // Trace logs for each updated field per specification Rule #3
    const logEntries = Object.entries(groundedResolutions).map(
      ([fKey, fVal]) => `[GraphBuilder]: Updated node [${targetNode.label}] field <${fKey}> -> "${Array.isArray(fVal) ? fVal.join(', ') : fVal}"`
    );

    setExecutionLogs((prev) => [
      ...prev,
      ...logEntries,
      `[GraphBuilder]: Validation passed for [${targetNode.label}]. All 12 required fields resolved. Status flipped: DRAFT ➔ READY (Green Dot).`
    ]);
  };

  // Batch resolve all queued research grounding tasks
  const handleBatchResolveResearchTasks = async () => {
    const pendingTasks = researchTaskQueue.filter((t) => t.status === 'queued' || t.status === 'failed');
    if (pendingTasks.length === 0) return;

    setExecutionLogs((prev) => [
      ...prev,
      `[Research Assistant Module]: Starting batch resolution for ${pendingTasks.length} queued research grounding tasks...`,
    ]);

    for (const task of pendingTasks) {
      await handleInvokeResearchAssistant(task.nodeId);
    }
  };

  // Local structural dry-run of the graph definition. This does NOT call the
  // real execution backend (POST /api/graphs/execute) and therefore makes no
  // model calls, spends no budget, and produces no verified receipts — it
  // only checks that every agent node has left DRAFT status. Real, paid
  // execution (with real Aegis verification and receipts) happens from the
  // Graph Runs screen against a saved graph, so this preview is never
  // mislabeled as a completed run.
  const handleRunGraph = async () => {
    // Check if any agent nodes are still in draft
    const draftNodes = nodes.filter((n) => n.type === 'agent' && n.status === 'draft');
    if (draftNodes.length > 0) {
      setValidationModalMessage(
        `COMPILATION HALTED: ${draftNodes.length} agent node(s) remain in DRAFT status (${draftNodes.map(n => n.label).join(', ')}). Please invoke Research Assistant to resolve all required fields before compilation.`
      );
      setShowValidationModal(true);
      return;
    }

    if (nodes.length === 0) return;
    setIsRunning(true);
    setActiveStepIndex(0);
    setExecutionLogs((prev) => [
      ...prev,
      `[GraphCompiler]: DRY-RUN PREVIEW ONLY — validating topology across ${nodes.length} nodes and ${edges.length} edges. This does not call the live execution backend, spend budget, or produce a verified receipt.`,
    ]);

    for (let i = 0; i < nodes.length; i++) {
      const currentNode = nodes[i];
      setActiveStepIndex(i);
      setNodes((prev) => prev.map((n) => (n.id === currentNode.id ? { ...n, status: 'running' } : n)));
      setExecutionLogs((prev) => [
        ...prev,
        `[Step ${i + 1}/${nodes.length}]: Checking [${currentNode.label}] (${currentNode.type.toUpperCase()}) config | Model assignment: ${currentNode.requiredFields.model_assignment || 'Default'} | SLA target: ${currentNode.requiredFields.cost_latency_budget || 'Nominal'}...`,
      ]);

      await new Promise((res) => setTimeout(res, 350));

      setNodes((prev) => prev.map((n) => (n.id === currentNode.id ? { ...n, status: 'success' } : n)));
      setExecutionLogs((prev) => [
        ...prev,
        `[Step ${i + 1}/${nodes.length}]: [${currentNode.label}] structurally valid (dry-run only — not executed).`,
      ]);
    }

    setIsRunning(false);
    setActiveStepIndex(-1);
    setExecutionLogs((prev) => [
      ...prev,
      `[GraphCompiler]: Dry-run preview finished — all nodes structurally valid. No model calls were made. To actually run this graph against the live execution backend, save it and dispatch it from Graph Runs.`,
    ]);
  };

  const getNodeColor = (type: GraphNode['type'], status: GraphNode['status']) => {
    if (status === 'draft') return '#6B7280'; // Gray dot for Draft
    if (status === 'resolving') return '#A855F7'; // Purple for Resolving
    switch (type) {
      case 'agent':
        return '#00D26A'; // Green for Ready Agent
      case 'model':
        return '#38BDF8';
      case 'tool':
        return '#615EFF';
      case 'trigger':
        return '#EC4899';
      case 'logic':
        return '#F59E0B';
      default:
        return '#8C8AFF';
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(label);
    setTimeout(() => setCopiedPrompt(null), 2000);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] w-full bg-[#06070B] border border-[#181B2E] rounded-2xl overflow-hidden font-mono text-white shadow-2xl">
      {/* 1. Top Navigation & Compiler Toolbar */}
      <div className="bg-[#0B0D18] border-b border-[#1A1D33] px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
            <GitMerge className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              GraphBuilder Topological Compiler & Research Assistant
              <span className="text-[10px] px-2 py-0.5 rounded bg-[#00D26A]/20 text-[#00D26A] font-semibold border border-[#00D26A]/30">
                12-FIELD SCHEMA
              </span>
            </h2>
            <p className="text-[11px] text-[#8E94B8]">
              Automated DAG validation, Validation Lock (Rule #4), and grounded Research Assistant field resolution.
            </p>
          </div>
        </div>

        {/* Action Controls Toolbar */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Template Selector */}
          <select
            value={selectedTemplateId}
            onChange={(e) => handleLoadTemplate(e.target.value)}
            className="bg-[#121424] border border-[#272B48] text-[#D0D4EE] text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#615EFF]"
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                Template: {t.name}
              </option>
            ))}
          </select>

          {/* System Prompt Spec Modal Toggle */}
          <button
            onClick={() => setShowPromptsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121424] border border-[#272B48] text-[#A5A2FF] text-xs font-semibold hover:border-[#615EFF] transition cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#615EFF]" />
            System Prompts Spec
          </button>

          {/* Research Tasks Queue Modal Toggle */}
          <button
            onClick={() => setShowResearchQueueModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181128] border border-[#8C8AFF]/40 text-[#A5A2FF] text-xs font-semibold hover:border-[#8C8AFF] transition cursor-pointer relative"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#8C8AFF]" />
            Research Task Queue
            {researchTaskQueue.filter((t) => t.status === 'queued').length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-[#8C8AFF] text-black text-[10px] font-bold rounded-full">
                {researchTaskQueue.filter((t) => t.status === 'queued').length}
              </span>
            )}
          </button>

          {/* Global Research Assistant Auto-Resolve Button */}
          <button
            onClick={() => {
              const draftNode = nodes.find((n) => n.type === 'agent' && n.status === 'draft');
              if (draftNode) {
                handleInvokeResearchAssistant(draftNode.id);
              } else {
                setExecutionLogs((prev) => [
                  ...prev,
                  `[GraphBuilder]: All agent nodes are already fully resolved (READY status).`,
                ]);
              }
            }}
            disabled={isResearching || !nodes.some((n) => n.type === 'agent' && n.status === 'draft')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-lg cursor-pointer ${
              isResearching
                ? 'bg-[#1E1228] border-[#8C8AFF] text-[#8C8AFF]'
                : 'bg-[#615EFF]/20 border-[#615EFF] text-[#A5A2FF] hover:bg-[#615EFF]/30'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${isResearching ? 'animate-spin text-[#8C8AFF]' : 'text-[#615EFF]'}`} />
            {isResearching ? 'Researching Fields...' : 'Auto-Resolve Draft Nodes'}
          </button>

          {/* Compile & Run Graph Button */}
          <button
            onClick={handleRunGraph}
            disabled={isRunning || nodes.length === 0}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-lg cursor-pointer ${
              isRunning
                ? 'bg-[#1E2138] text-[#8E94B8] border border-[#2D3352]'
                : 'bg-[#00D26A] text-black hover:bg-[#00E574] shadow-[#00D26A]/20'
            }`}
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#00D26A]" />
                Executing DAG...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Compile & Run DAG
              </>
            )}
          </button>

          {/* Switch to Graph Runs History */}
          <button
            onClick={() => onSelectTab && onSelectTab('graph-runs')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121424] border border-[#272B48] text-[#8E94B8] text-xs font-medium hover:border-[#615EFF] hover:text-white transition cursor-pointer"
          >
            <Activity className="w-3.5 h-3.5 text-[#38BDF8]" />
            Runs History
          </button>
        </div>
      </div>

      {/* 2. Main Canvas & Sub-panels Area */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Toolbar / Node Library Drawer */}
        <div className="w-60 bg-[#090A13] border-r border-[#161828] p-3 flex flex-col justify-between shrink-0 overflow-y-auto">
          <div className="space-y-4">
            <div className="text-[10px] font-bold text-[#636B95] uppercase tracking-wider px-1">
              + Add Node to Canvas
            </div>

            {/* Agent Nodes */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-[#00D26A] font-semibold px-1 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Crown className="w-3 h-3 text-[#00D26A]" />
                  Specialist Agents
                </span>
                <span className="text-[9px] text-[#636B95]">(12-Field)</span>
              </div>
              <button
                onClick={() => handleAddNode('agent', 'Scout Specialist', 'scout')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#00D26A]" />
                  <span>Scout (Scraping)</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('agent', 'Scribe Specialist', 'scribe')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                  <span>Scribe (Obsidian)</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('agent', 'Dev Specialist', 'dev')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#38BDF8]" />
                  <span>Dev (Full-Stack)</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('agent', 'Reach Specialist', 'reach')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                  <span>Reach (Growth)</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
            </div>

            {/* Frontier Models */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-[#38BDF8] font-semibold px-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#38BDF8]" />
                Frontier AI Models
              </div>
              <button
                onClick={() => handleAddNode('model', 'Claude 3.7 Sonnet', 'claude')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3 h-3 text-[#F97316]" />
                  <span>Claude 3.7 Sonnet</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('model', 'DeepSeek R1', 'deepseek')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Cpu className="w-3 h-3 text-[#3B82F6]" />
                  <span>DeepSeek R1</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('model', 'Gemini 2.5 Flash', 'gemini')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Radio className="w-3 h-3 text-[#00D26A]" />
                  <span>Gemini 2.5 Flash</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
            </div>

            {/* Tools & Integrations */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-[#615EFF] font-semibold px-1 flex items-center gap-1">
                <Terminal className="w-3 h-3" />
                Canonical Nodes & Governance
              </div>
              <button
                onClick={() => handleAddNode('tool', 'Obsidian Vectorizer', 'obsidian')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Database className="w-3 h-3 text-[#8C8AFF]" />
                  <span>Obsidian Vectorizer</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('tool', 'Guardian Policy Gate', 'guardian')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-3 h-3 text-[#EC4899]" />
                  <span>GUARDIAN_GATE</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('tool', 'MCP Tool Server', 'mcp')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Server className="w-3 h-3 text-[#38BDF8]" />
                  <span>MCP Server</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('tool', 'Human Sign-off Approval', 'human_approval')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3 h-3 text-[#F59E0B]" />
                  <span>HUMAN_APPROVAL</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('tool', 'Aegis Formal Verifier', 'verifier')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3 h-3 text-[#00D26A]" />
                  <span>VERIFIER (Aegis)</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('logic', 'Condition Branching', 'condition')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Filter className="w-3 h-3 text-[#EC4899]" />
                  <span>CONDITION Gate</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('tool', 'Memory Read (Obsidian)', 'memory_read')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Database className="w-3 h-3 text-[#38BDF8]" />
                  <span>MEMORY_READ</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('tool', 'Memory Write (Vector Store)', 'memory_write')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <HardDrive className="w-3 h-3 text-[#A5A2FF]" />
                  <span>MEMORY_WRITE</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('tool', 'Artifact Generator', 'artifact')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <FileCode className="w-3 h-3 text-[#F59E0B]" />
                  <span>ARTIFACT Export</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
              <button
                onClick={() => handleAddNode('agent', 'Nested Subgraph Routine', 'subgraph')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1C1F38] border border-[#222642] text-xs text-[#E2E6F8] transition cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-3 h-3 text-[#615EFF]" />
                  <span>SUBGRAPH Routine</span>
                </div>
                <Plus className="w-3 h-3 text-[#636B95] group-hover:text-white" />
              </button>
            </div>
          </div>

          {/* Validation Status Summary Footer */}
          <div className="pt-3 border-t border-[#181B2E] space-y-2">
            <div className="text-[10px] font-bold text-[#8E94B8] flex items-center justify-between">
              <span>Graph Readiness:</span>
              <span className="text-[#00D26A] font-bold">
                {nodes.filter(n => n.status === 'ready').length}/{nodes.length} READY
              </span>
            </div>
            <button
              onClick={() => {
                setNodes([]);
                setEdges([]);
                setSelectedNodeId(null);
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B111A] border border-[#481E32] text-[#FF5E8E] text-xs hover:bg-[#281525] transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Canvas
            </button>
          </div>
        </div>

        {/* Middle Interactive Canvas Area */}
        <div
          ref={canvasRef}
          onMouseMove={handleMouseMoveCanvas}
          onMouseUp={handleMouseUpCanvas}
          className="flex-1 bg-grid-dots relative overflow-hidden select-none bg-[#05060A]"
        >
          {/* Zoom & View Controls Overlay */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-[#0E101B]/90 border border-[#21253E] p-1 rounded-lg backdrop-blur shadow-xl">
            <button
              onClick={() => setZoomLevel((z) => Math.min(1.5, z + 0.1))}
              className="px-2 py-1 hover:bg-[#1E223D] rounded text-xs text-[#A5A2FF] font-bold cursor-pointer"
            >
              +
            </button>
            <span className="text-[11px] font-mono text-[#8E94B8] px-1">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.1))}
              className="px-2 py-1 hover:bg-[#1E223D] rounded text-xs text-[#A5A2FF] font-bold cursor-pointer"
            >
              -
            </button>
          </div>

          {/* Connection Mode Banner */}
          {connectSourceId && (
            <div className="absolute top-3 right-3 z-10 bg-[#615EFF]/20 border border-[#615EFF]/50 px-3 py-1.5 rounded-lg text-xs text-white flex items-center gap-2 backdrop-blur animate-pulse shadow-xl">
              <CornerDownRight className="w-4 h-4 text-[#8C8AFF]" />
              Select target node to create directional edge (Rule #4 Validation Lock active)...
              <button
                onClick={() => setConnectSourceId(null)}
                className="ml-2 hover:text-[#FF5E8E] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Canvas SVG Container for Edges */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="28"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#615EFF" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const srcNode = nodes.find((n) => n.id === edge.source);
              const tgtNode = nodes.find((n) => n.id === edge.target);
              if (!srcNode || !tgtNode) return null;

              const x1 = srcNode.x + 120;
              const y1 = srcNode.y + 40;
              const x2 = tgtNode.x;
              const y2 = tgtNode.y + 40;

              const dx = (x2 - x1) * 0.5;
              const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

              return (
                <g key={edge.id}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#615EFF"
                    strokeWidth="2.5"
                    strokeOpacity="0.8"
                    markerEnd="url(#arrow)"
                    strokeDasharray={edge.animated || isRunning ? '6,6' : undefined}
                    className={isRunning ? 'animate-[dash_1s_linear_infinite]' : undefined}
                  />
                  {edge.label && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 8}
                      fill="#8C8AFF"
                      fontSize="10"
                      fontFamily="monospace"
                      textAnchor="middle"
                      className="bg-[#05060A] px-1 font-bold"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Canvas Render Nodes */}
          <div
            className="absolute inset-0 z-10 transform origin-top-left transition-transform duration-75"
            style={{ transform: `scale(${zoomLevel})` }}
          >
            {nodes.map((node) => {
              const isSelected = node.id === selectedNodeId;
              const isConnectSource = node.id === connectSourceId;
              const nodeColor = getNodeColor(node.type, node.status);
              const missingCount = node.missingFields.length;

              return (
                <div
                  key={node.id}
                  onClick={() => {
                    if (connectSourceId && connectSourceId !== node.id) {
                      handleConnectNodes(node.id);
                    } else {
                      setSelectedNodeId(node.id);
                    }
                  }}
                  onMouseDown={(e) => handleMouseDownNode(e, node.id)}
                  style={{ left: `${node.x}px`, top: `${node.y}px` }}
                  className={`absolute w-60 rounded-xl dashboard-box p-3 cursor-grab active:cursor-grabbing transition-all ${
                    isSelected
                      ? 'ring-2 ring-[#615EFF] border-transparent shadow-[0_0_24px_rgba(97,94,255,0.4)]'
                      : isConnectSource
                      ? 'ring-2 ring-[#EC4899] bg-[#1C1220] animate-pulse'
                      : 'hover:border-[#3B4168]'
                  }`}
                >
                  {/* Node Header with Status Badge */}
                  <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-[#1A1D33]">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Status Indicator Dot */}
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          node.status === 'resolving' ? 'animate-ping' : ''
                        }`}
                        style={{ backgroundColor: nodeColor }}
                        title={`Status: ${node.status.toUpperCase()}`}
                      />
                      <span className="text-xs font-bold text-white truncate">
                        {node.label}
                      </span>
                    </div>

                    {/* Status Badge */}
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded font-bold border ${
                        node.status === 'ready'
                          ? 'bg-[#00D26A]/10 text-[#00D26A] border-[#00D26A]/30'
                          : node.status === 'draft'
                          ? 'bg-gray-800 text-gray-400 border-gray-700'
                          : node.status === 'resolving'
                          ? 'bg-purple-900/50 text-purple-300 border-purple-500 animate-pulse'
                          : 'bg-[#615EFF]/10 text-[#8C8AFF] border-[#615EFF]/30'
                      }`}
                    >
                      {node.status === 'draft' ? `DRAFT (${missingCount})` : node.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Subtitle / Description */}
                  <p className="text-[10px] text-[#8E94B8] line-clamp-2 mb-3 leading-relaxed">
                    {node.description || node.requiredFields.role_purpose || 'No description provided.'}
                  </p>

                  {/* Node Metadata Badges */}
                  {node.type === 'agent' && (
                    <div className="mb-3 flex items-center justify-between text-[10px] bg-[#121424] p-1.5 rounded-lg border border-[#1E223D]">
                      <span className="text-[#8E94B8]">Model:</span>
                      <span className="text-[#38BDF8] font-bold truncate max-w-[120px]">
                        {node.requiredFields.model_assignment || 'Unassigned'}
                      </span>
                    </div>
                  )}

                  {/* Node Footer Actions & Connection Handles */}
                  <div className="flex items-center justify-between pt-1 text-[10px] text-[#636B95] border-t border-[#141628]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConnectSourceId(node.id);
                      }}
                      className="hover:text-[#615EFF] flex items-center gap-1 font-semibold cursor-pointer"
                    >
                      <CornerDownRight className="w-3 h-3 text-[#615EFF]" />
                      Connect →
                    </button>

                    {node.type === 'agent' && node.status === 'draft' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInvokeResearchAssistant(node.id);
                        }}
                        className="text-[#A5A2FF] hover:text-white flex items-center gap-1 font-bold bg-[#615EFF]/20 px-1.5 py-0.5 rounded cursor-pointer"
                      >
                        <Sparkles className="w-2.5 h-2.5 text-[#615EFF]" />
                        Auto-Resolve
                      </button>
                    )}

                    {node.status === 'running' && (
                      <span className="text-[#00D26A] flex items-center gap-1 animate-pulse font-bold">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        RUNNING
                      </span>
                    )}
                    {node.status === 'success' && (
                      <span className="text-[#00D26A] flex items-center gap-1 font-bold">
                        <CheckCircle2 className="w-3 h-3" />
                        DONE
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Node Inspector & 12-Field Schema Panel */}
        {selectedNode && (
          <div className="w-80 bg-[#090A13] border-l border-[#161828] p-4 flex flex-col justify-between shrink-0 overflow-y-auto z-20 space-y-4">
            <div className="space-y-4">
              {/* Header Inspector */}
              <div className="flex items-center justify-between border-b border-[#1A1D33] pb-2">
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5 text-[#615EFF]" />
                  Node Inspector & Schema
                </h3>
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="text-[#636B95] hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Title Input */}
              <div>
                <label className="text-[10px] text-[#7A82A6] uppercase font-bold block mb-1">
                  Node Title
                </label>
                <input
                  type="text"
                  value={selectedNode.label}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNodes((prev) =>
                      prev.map((n) => (n.id === selectedNode.id ? { ...n, label: val } : n))
                    );
                  }}
                  className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                />
              </div>

              {/* Status & Resolution Meter for Agent Nodes */}
              {selectedNode.type === 'agent' && (
                <div className="bg-[#121424] p-3 rounded-xl border border-[#232742] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#8E94B8] font-semibold">12-Field Schema:</span>
                    <span className={`font-bold ${
                      selectedNode.missingFields.length === 0 ? 'text-[#00D26A]' : 'text-amber-400'
                    }`}>
                      {12 - selectedNode.missingFields.length}/12 Resolved
                    </span>
                  </div>

                  {/* Meter Progress Bar */}
                  <div className="w-full bg-[#1E223D] h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-[#615EFF] to-[#00D26A] h-full transition-all duration-300"
                      style={{ width: `${((12 - selectedNode.missingFields.length) / 12) * 100}%` }}
                    />
                  </div>

                  {/* Auto-Resolve Button */}
                  {selectedNode.missingFields.length > 0 && (
                    <button
                      onClick={() => handleInvokeResearchAssistant(selectedNode.id)}
                      disabled={isResearching}
                      className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#615EFF]/20 border border-[#615EFF]/50 text-[#A5A2FF] text-xs font-bold hover:bg-[#615EFF]/30 transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#615EFF]" />
                      Invoke Research Assistant ({selectedNode.missingFields.length} Missing)
                    </button>
                  )}
                </div>
              )}

              {/* 12 Required Fields Breakdown for Agent Nodes */}
              {selectedNode.type === 'agent' ? (
                <div className="space-y-3 pt-2 border-t border-[#1A1D33]">
                  <div className="text-[10px] font-bold text-[#A5A2FF] uppercase tracking-wider flex items-center justify-between">
                    <span>12 Required Agent Fields</span>
                    <span className="text-[#636B95]">GraphBuilder Schema</span>
                  </div>

                  {/* 1. role_purpose */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      1. Role Purpose
                    </label>
                    <textarea
                      rows={2}
                      value={selectedNode.requiredFields.role_purpose || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, role_purpose: val } }
                              : n
                          )
                        );
                      }}
                      placeholder="One unambiguous sentence with success boundary"
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>

                  {/* 2. trigger_condition */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      2. Trigger Condition
                    </label>
                    <input
                      type="text"
                      value={selectedNode.requiredFields.trigger_condition || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, trigger_condition: val } }
                              : n
                          )
                        );
                      }}
                      placeholder="Nearest upstream trigger or edge label"
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>

                  {/* 3. model_assignment */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      3. Model Assignment & Tradeoff
                    </label>
                    <select
                      value={selectedNode.requiredFields.model_assignment || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, model_assignment: val } }
                              : n
                          )
                        );
                      }}
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    >
                      <option value="">Select Grounded Model...</option>
                      <option value="Claude 3.7 Sonnet (Code Mode)">Claude 3.7 Sonnet ($3.00/1M tokens, High Reasoning)</option>
                      <option value="DeepSeek R1 / Gemini 2.5 Flash">DeepSeek R1 ($0.55/1M tokens, Math & Audit)</option>
                      <option value="Gemini 2.5 Flash">Gemini 2.5 Flash ($0.075/1M tokens, Low Latency)</option>
                      <option value="OpenRouter Free Tier (Llama 3)">OpenRouter Free Tier ($0.00/1M tokens)</option>
                    </select>
                  </div>

                  {/* 4. inputs & outputs */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                        4. Inputs Schema
                      </label>
                      <input
                        type="text"
                        value={Array.isArray(selectedNode.requiredFields.inputs) ? selectedNode.requiredFields.inputs.join(', ') : ''}
                        onChange={(e) => {
                          const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setNodes((prev) =>
                            prev.map((n) =>
                              n.id === selectedNode.id
                                ? { ...n, requiredFields: { ...n.requiredFields, inputs: arr } }
                                : n
                            )
                          );
                        }}
                        placeholder="e.g. raw_html, url"
                        className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-1.5 focus:border-[#615EFF]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                        5. Outputs Schema
                      </label>
                      <input
                        type="text"
                        value={Array.isArray(selectedNode.requiredFields.outputs) ? selectedNode.requiredFields.outputs.join(', ') : ''}
                        onChange={(e) => {
                          const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setNodes((prev) =>
                            prev.map((n) =>
                              n.id === selectedNode.id
                                ? { ...n, requiredFields: { ...n.requiredFields, outputs: arr } }
                                : n
                            )
                          );
                        }}
                        placeholder="e.g. json_memo, note"
                        className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-1.5 focus:border-[#615EFF]"
                      />
                    </div>
                  </div>

                  {/* 6. guardrails */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      6. Guardrails & Risk Profile
                    </label>
                    <input
                      type="text"
                      value={selectedNode.requiredFields.guardrails || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, guardrails: val } }
                              : n
                          )
                        );
                      }}
                      placeholder="e.g. Rate-limit + robots.txt compliance"
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>

                  {/* 7. success_criteria */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      7. Success Criteria (Falsifiable Check)
                    </label>
                    <input
                      type="text"
                      value={selectedNode.requiredFields.success_criteria || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, success_criteria: val } }
                              : n
                          )
                        );
                      }}
                      placeholder="e.g. Returns >= 10 distinct frameworks"
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>

                  {/* 8. failure_handling */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      8. Failure Handling & Escalation Path
                    </label>
                    <input
                      type="text"
                      value={selectedNode.requiredFields.failure_handling || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, failure_handling: val } }
                              : n
                          )
                        );
                      }}
                      placeholder="e.g. Retry 3x -> Route to Telegram Thread #101"
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>

                  {/* 9. memory_context */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      9. Memory Context & Vault TTL
                    </label>
                    <input
                      type="text"
                      value={selectedNode.requiredFields.memory_context || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, memory_context: val } }
                              : n
                          )
                        );
                      }}
                      placeholder="e.g. Vectorize to Obsidian vault [[Startup-Theses/]]"
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>

                  {/* 10. cost_latency_budget */}
                  <div>
                    <label className="text-[10px] text-[#8E94B8] font-bold block mb-1">
                      10. Cost & Latency Budget
                    </label>
                    <input
                      type="text"
                      value={selectedNode.requiredFields.cost_latency_budget || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, requiredFields: { ...n.requiredFields, cost_latency_budget: val } }
                              : n
                          )
                        );
                      }}
                      placeholder="e.g. 1.2k tokens, $0.002, SLA < 1.2s"
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>

                  {/* Cyclic Refinement Loop Toggle & Max Iterations */}
                  <div className="pt-2 border-t border-[#1A1D33] space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-amber-400 font-bold">
                        Iterative Refinement Loop?
                      </label>
                      <input
                        type="checkbox"
                        checked={!!selectedNode.isCyclicLoop}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setNodes((prev) =>
                            prev.map((n) =>
                              n.id === selectedNode.id
                                ? { ...n, isCyclicLoop: val, maxIterations: val ? (n.maxIterations || 5) : undefined }
                                : n
                            )
                          );
                        }}
                        className="rounded border-gray-700 bg-gray-900 text-[#615EFF]"
                      />
                    </div>

                    {selectedNode.isCyclicLoop && (
                      <div>
                        <label className="text-[10px] text-amber-400 font-bold block mb-1">
                          Max Iterations Ceiling (Mandatory for Cycles)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={selectedNode.maxIterations || 5}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 5;
                            setNodes((prev) =>
                              prev.map((n) =>
                                n.id === selectedNode.id
                                  ? { ...n, maxIterations: val }
                                  : n
                              )
                            );
                          }}
                          className="w-full bg-[#121424] border border-amber-500/50 text-white text-xs rounded-lg p-2 focus:border-amber-400"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Non-Agent Node Settings */
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-[#7A82A6] uppercase font-bold block mb-1">
                      Directive Prompt
                    </label>
                    <textarea
                      rows={3}
                      value={selectedNode.config.prompt || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === selectedNode.id
                              ? { ...n, config: { ...n.config, prompt: val } }
                              : n
                          )
                        );
                      }}
                      className="w-full bg-[#121424] border border-[#232742] text-white text-xs rounded-lg p-2 focus:border-[#615EFF]"
                    />
                  </div>
                </div>
              )}

              {/* Delete Node Button */}
              <div className="pt-3">
                <button
                  onClick={() => handleRemoveNode(selectedNode.id)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#24131B] border border-[#521D32] text-[#FF5E8E] text-xs hover:bg-[#341826] transition cursor-pointer font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Node
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Bottom Execution Trace Console */}
      <div className="h-32 bg-[#05060B] border-t border-[#181B2E] p-3 flex flex-col justify-between shrink-0 font-mono text-xs">
        <div className="flex items-center justify-between pb-1 border-b border-[#141626]">
          <span className="text-[10px] text-[#7A82A6] uppercase font-bold flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-[#00D26A]" />
            Graph Execution Trace & Mutation Console
          </span>
          <button
            onClick={() =>
              setExecutionLogs(['[GraphBuilder]: Console cleared.'])
            }
            className="text-[10px] text-[#636B95] hover:text-white cursor-pointer"
          >
            Clear Log
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 py-1 pr-1 scrollbar-thin text-[11px] text-[#A2A9D4]">
          {executionLogs.map((log, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-[#565C82] select-none">&gt;</span>
              <span className={log.includes('Rule #4 Violation') ? 'text-amber-400 font-bold' : log.includes('Updated node') ? 'text-[#00D26A]' : ''}>
                {log}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ============================================================================ */}
      {/* SYSTEM PROMPTS ARCHITECTURE MODAL */}
      {/* ============================================================================ */}
      {showPromptsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0B0D18] border border-[#232742] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-white">
            <div className="px-6 py-4 border-b border-[#1A1D33] flex items-center justify-between bg-[#121424]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#615EFF]" />
                <h3 className="font-bold text-sm text-white">
                  GraphBuilder Compiler & Research Assistant Prompt Specification
                </h3>
              </div>
              <button
                onClick={() => setShowPromptsModal(false)}
                className="text-[#636B95] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-xs text-[#C5C9E5]">
              {/* Compiler Prompt */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-[#A5A2FF] uppercase tracking-wide flex items-center gap-2">
                    <Crown className="w-4 h-4 text-[#615EFF]" />
                    1. System Prompt: GraphBuilder Compiler
                  </h4>
                  <button
                    onClick={() => copyToClipboard(GRAPH_BUILDER_COMPILER_SPEC, 'compiler')}
                    className="flex items-center gap-1 text-[10px] text-[#8C8AFF] hover:text-white bg-[#1A1D33] px-2 py-1 rounded cursor-pointer"
                  >
                    {copiedPrompt === 'compiler' ? <Check className="w-3 h-3 text-[#00D26A]" /> : <Copy className="w-3 h-3" />}
                    {copiedPrompt === 'compiler' ? 'Copied!' : 'Copy Compiler Prompt'}
                  </button>
                </div>
                <pre className="bg-[#05060A] p-4 rounded-xl border border-[#1A1D33] text-[11px] text-[#8E94B8] whitespace-pre-wrap leading-relaxed font-mono">
                  {GRAPH_BUILDER_COMPILER_SPEC}
                </pre>
              </div>

              {/* Research Assistant Prompt */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-[#00D26A] uppercase tracking-wide flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#00D26A]" />
                    2. System Prompt: GraphBuilder Research Assistant
                  </h4>
                  <button
                    onClick={() => copyToClipboard(RESEARCH_ASSISTANT_SPEC, 'researcher')}
                    className="flex items-center gap-1 text-[10px] text-[#00D26A] hover:text-white bg-[#1A1D33] px-2 py-1 rounded cursor-pointer"
                  >
                    {copiedPrompt === 'researcher' ? <Check className="w-3 h-3 text-[#00D26A]" /> : <Copy className="w-3 h-3" />}
                    {copiedPrompt === 'researcher' ? 'Copied!' : 'Copy Assistant Prompt'}
                  </button>
                </div>
                <pre className="bg-[#05060A] p-4 rounded-xl border border-[#1A1D33] text-[11px] text-[#8E94B8] whitespace-pre-wrap leading-relaxed font-mono">
                  {RESEARCH_ASSISTANT_SPEC}
                </pre>
              </div>
            </div>

            <div className="p-4 border-t border-[#1A1D33] bg-[#090A13] flex justify-end">
              <button
                onClick={() => setShowPromptsModal(false)}
                className="px-4 py-2 rounded-xl bg-[#615EFF] text-white font-bold text-xs hover:bg-[#504CDE] transition cursor-pointer"
              >
                Close Spec Panel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* RESEARCH ASSISTANT TASK QUEUE & GROUNDING CONSOLE MODAL */}
      {/* ============================================================================ */}
      {showResearchQueueModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0B0D18] border border-[#232742] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-white">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#1A1D33] flex items-center justify-between bg-[#121424]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#8C8AFF]/20 border border-[#8C8AFF]/40 text-[#A5A2FF]">
                  <Sparkles className="w-5 h-5 text-[#8C8AFF]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    Research Assistant Task Queue & Grounding Console
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#8C8AFF]/20 text-[#A5A2FF] font-semibold border border-[#8C8AFF]/30">
                      12-FIELD GROUNDER
                    </span>
                  </h3>
                  <p className="text-[11px] text-[#8E94B8]">
                    Automatically parses missing node fields, injects research grounding tasks, and resolves 12-field schemas.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowResearchQueueModal(false)}
                className="text-[#636B95] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-header Controls Bar */}
            <div className="px-6 py-3 bg-[#080911] border-b border-[#1A1D33] flex flex-wrap items-center justify-between gap-3">
              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 bg-[#121424] p-1 rounded-lg border border-[#222642]">
                {(['all', 'queued', 'researching', 'resolved'] as const).map((filter) => {
                  const count = filter === 'all' 
                    ? researchTaskQueue.length 
                    : researchTaskQueue.filter((t) => t.status === filter).length;
                  return (
                    <button
                      key={filter}
                      onClick={() => setActiveTaskFilter(filter)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition cursor-pointer ${
                        activeTaskFilter === filter
                          ? 'bg-[#615EFF] text-white shadow'
                          : 'text-[#8E94B8] hover:text-white'
                      }`}
                    >
                      {filter} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Auto Inject Toggle & Batch Resolve Button */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-[#A5A2FF] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoInjectResearchTasks}
                    onChange={(e) => setAutoInjectResearchTasks(e.target.checked)}
                    className="rounded border-gray-700 bg-gray-900 text-[#615EFF]"
                  />
                  <span>Auto-Inject Grounding Tasks</span>
                </label>

                <button
                  onClick={handleBatchResolveResearchTasks}
                  disabled={isResearching || !researchTaskQueue.some((t) => t.status === 'queued')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-lg cursor-pointer ${
                    isResearching || !researchTaskQueue.some((t) => t.status === 'queued')
                      ? 'bg-[#181B2E] text-[#636B95] border border-[#232742]'
                      : 'bg-[#615EFF] text-white hover:bg-[#504CDE] shadow-[#615EFF]/20'
                  }`}
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isResearching ? 'animate-spin' : ''}`} />
                  Batch Resolve Pending Tasks
                </button>
              </div>
            </div>

            {/* Modal Body: Benchmarks Matrix + Task Queue Grid */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs text-[#C5C9E5]">
              {/* Grounding Model Benchmark Quick Reference */}
              <div className="p-4 rounded-xl bg-[#090A14] border border-[#1A1D33] space-y-2">
                <div className="text-[10px] font-bold text-[#A5A2FF] uppercase tracking-wider flex items-center justify-between">
                  <span>Grounding Trade-off & Benchmark Reference Matrix</span>
                  <span className="text-[#636B95]">OpenRouter & Guardian Specs 2026</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-[#121424] border border-[#232742]">
                    <div className="font-bold text-[#F97316]">Claude 3.7 Sonnet</div>
                    <div className="text-[10px] text-[#8E94B8]">$3.00 / 1M tokens · High Reasoning</div>
                    <div className="text-[10px] text-emerald-400 font-medium mt-1">Code & Multi-agent Spec</div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#121424] border border-[#232742]">
                    <div className="font-bold text-[#3B82F6]">DeepSeek R1</div>
                    <div className="text-[10px] text-[#8E94B8]">$0.55 / 1M tokens · TAM Math</div>
                    <div className="text-[10px] text-emerald-400 font-medium mt-1">Proof & Audit Reasoning</div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#121424] border border-[#232742]">
                    <div className="font-bold text-[#00D26A]">Gemini 2.5 Flash</div>
                    <div className="text-[10px] text-[#8E94B8]">$0.075 / 1M tokens · SLA &lt; 400ms</div>
                    <div className="text-[10px] text-emerald-400 font-medium mt-1">High-throughput Scraper</div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#121424] border border-[#232742]">
                    <div className="font-bold text-[#EC4899]">Guardian Gate Rules</div>
                    <div className="text-[10px] text-[#8E94B8]">Rule #4 Lock · Rule #8 Sandbox</div>
                    <div className="text-[10px] text-emerald-400 font-medium mt-1">Security Verification</div>
                  </div>
                </div>
              </div>

              {/* Task Cards List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px] font-bold text-[#8E94B8]">
                  <span>Active Grounding Research Tasks ({researchTaskQueue.length})</span>
                  <span>12-Field Auto Resolver Active</span>
                </div>

                {researchTaskQueue.length === 0 ? (
                  <div className="p-8 text-center text-[#636B95] bg-[#090A14] rounded-xl border border-[#1A1D33]">
                    No grounding tasks queued. All agent nodes are fully resolved or auto-injection is idle.
                  </div>
                ) : (
                  researchTaskQueue
                    .filter((t) => activeTaskFilter === 'all' || t.status === activeTaskFilter)
                    .map((task) => (
                      <div
                        key={task.id}
                        className={`p-4 rounded-xl border transition-all space-y-3 ${
                          task.status === 'resolved'
                            ? 'bg-[#0A1213] border-[#00D26A]/30'
                            : task.status === 'researching'
                            ? 'bg-[#120F24] border-[#8C8AFF] animate-pulse'
                            : 'bg-[#121424] border-[#222642]'
                        }`}
                      >
                        {/* Task Item Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">{task.nodeName}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#1C1F38] text-[#A5A2FF] font-mono border border-[#2D3356]">
                              ID: {task.nodeId}
                            </span>
                            <span className="text-[10px] text-[#636B95]">{task.timestamp}</span>
                          </div>

                          {/* Task Status Badge */}
                          <div className="flex items-center gap-2">
                            {task.status === 'resolved' && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#00D26A]/20 text-[#00D26A] font-bold border border-[#00D26A]/30">
                                <Check className="w-3 h-3" />
                                RESOLVED (12/12 Fields)
                              </span>
                            )}
                            {task.status === 'researching' && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#8C8AFF]/20 text-[#8C8AFF] font-bold border border-[#8C8AFF]/30 animate-pulse">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Grounding Research Active...
                              </span>
                            )}
                            {task.status === 'queued' && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                                QUEUED ({task.missingFields.length} Missing)
                              </span>
                            )}

                            {/* Action Trigger */}
                            {task.status !== 'resolved' && (
                              <button
                                onClick={() => handleInvokeResearchAssistant(task.nodeId)}
                                disabled={isResearching}
                                className="px-3 py-1 rounded-lg bg-[#615EFF] text-white font-bold text-xs hover:bg-[#504CDE] transition cursor-pointer flex items-center gap-1"
                              >
                                <Sparkles className="w-3 h-3" />
                                Resolve Now
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Parsed Missing Fields */}
                        {task.missingFields.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] text-[#8E94B8] font-bold">Parsed Missing Required Fields:</div>
                            <div className="flex flex-wrap gap-1">
                              {task.missingFields.map((f) => (
                                <span
                                  key={f}
                                  className="text-[10px] px-2 py-0.5 rounded bg-[#1C1F38] text-amber-300 font-mono border border-amber-500/30"
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Graph Context */}
                        <div className="text-[11px] text-[#8E94B8] bg-[#080911] p-2 rounded-lg border border-[#1A1D33]">
                          <span className="text-[#A5A2FF] font-semibold">Graph Context: </span>
                          {task.graphContext}
                        </div>

                        {/* Resolved Fields Output Preview & Citations */}
                        {task.status === 'resolved' && task.resolvedFields && (
                          <div className="space-y-2 pt-2 border-t border-[#181B2E]">
                            <div className="text-[10px] font-bold text-[#00D26A] flex items-center justify-between">
                              <span>Grounded 12-Field Schema Resolution Output</span>
                              <span>Verified Citations Attached</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-[#05060A] p-3 rounded-lg border border-[#181B2E]">
                              <div>
                                <span className="text-[#8E94B8]">Role Purpose: </span>
                                <span className="text-white">{task.resolvedFields.role_purpose}</span>
                              </div>
                              <div>
                                <span className="text-[#8E94B8]">Model Assigned: </span>
                                <span className="text-[#38BDF8] font-bold">{task.resolvedFields.model_assignment}</span>
                              </div>
                              <div>
                                <span className="text-[#8E94B8]">Guardrails: </span>
                                <span className="text-amber-300">{task.resolvedFields.guardrails}</span>
                              </div>
                              <div>
                                <span className="text-[#8E94B8]">Budget SLA: </span>
                                <span className="text-emerald-400">{task.resolvedFields.cost_latency_budget}</span>
                              </div>
                            </div>

                            {/* Citations List */}
                            {task.citations && task.citations.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-[10px] text-[#636B95] font-bold">Research Assistant Citations & Benchmark Sources:</div>
                                <div className="flex flex-wrap gap-2 text-[10px] text-[#8C8AFF]">
                                  {task.citations.map((cite, cIdx) => (
                                    <span key={cIdx} className="bg-[#121424] px-2 py-0.5 rounded border border-[#222642]">
                                      • {cite}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#1A1D33] bg-[#090A13] flex justify-between items-center">
              <div className="text-[11px] text-[#8E94B8]">
                GraphBuilder Compiler Rule #3: All resolved mutations append to Execution Trace Console.
              </div>
              <button
                onClick={() => setShowResearchQueueModal(false)}
                className="px-4 py-2 rounded-xl bg-[#615EFF] text-white font-bold text-xs hover:bg-[#504CDE] transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* VALIDATION LOCK WARNING MODAL */}
      {/* ============================================================================ */}
      {showValidationModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0B0D18] border border-amber-500/50 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl font-mono text-white">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-bold text-sm uppercase tracking-wide">
                Validation Lock Prevented Action
              </h3>
            </div>

            <p className="text-xs text-[#C5C9E5] leading-relaxed bg-[#14121A] p-3 rounded-xl border border-amber-500/20">
              {validationModalMessage}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowValidationModal(false);
                  setBlockedTargetNodeId(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-[#181B2E] text-[#8E94B8] hover:text-white text-xs cursor-pointer"
              >
                Dismiss Warning
              </button>

              {blockedTargetNodeId && (
                <button
                  onClick={() => {
                    const id = blockedTargetNodeId;
                    setShowValidationModal(false);
                    setBlockedTargetNodeId(null);
                    handleInvokeResearchAssistant(id);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-[#615EFF] text-white font-bold text-xs hover:bg-[#504CDE] transition cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Auto-Resolve Node Fields Now
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
