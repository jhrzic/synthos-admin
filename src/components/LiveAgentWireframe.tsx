import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Bot, Crown, Search, PenTool, Share2, Code2, BarChart3, 
  ShieldCheck, ShieldAlert, Database, Cpu, Zap, Activity, 
  ArrowRight, CheckCircle2, AlertTriangle, Clock, RefreshCw,
  ExternalLink, Layers, Terminal, Lock, X, Play
} from 'lucide-react';
import { AgentInfo, KanbanTask, WireframeEvent } from '../types';

export interface WireframeNodeData {
  id: string;
  name: string;
  role: string;
  type: 'agent' | 'governance' | 'memory' | 'tools';
  model: string;
  status: 'idle' | 'active' | 'blocked' | 'approval_required';
  x: number; // 0 - 100 percentage
  y: number; // 0 - 100 percentage
  color: string;
  icon: any;
  currentAction?: string;
  latency?: number;
  tokensConsumed?: number;
  activeTaskId?: string;
}

export interface LiveAgentWireframeProps {
  agents: Record<string, AgentInfo>;
  tasks: KanbanTask[];
  activeEvents?: WireframeEvent[];
  onSelectAgent?: (role: string) => void;
  onSelectEvent?: (event: WireframeEvent) => void;
  onOpenGraphBuilder?: () => void;
  className?: string;
}

export const LiveAgentWireframe: React.FC<LiveAgentWireframeProps> = ({
  agents,
  tasks,
  activeEvents = [],
  onSelectAgent,
  onSelectEvent,
  onOpenGraphBuilder,
  className = ''
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeEvent, setSelectedEdgeEvent] = useState<WireframeEvent | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'AGENTS' | 'GOVERNANCE' | 'FLOWS'>('ALL');

  // Compute live node states based on actual real tasks
  const nodes = useMemo<WireframeNodeData[]>(() => {
    const runningTasks = tasks.filter(t => t.column === 'running');
    const reviewTasks = tasks.filter(t => t.column === 'ready');
    const blockedTasks = tasks.filter(t => (t as any).isBlocked || t.tags?.includes('blocked'));

    const getAgentStatus = (role: string): 'idle' | 'active' | 'blocked' | 'approval_required' => {
      if (blockedTasks.some(t => t.assignedAgent === role)) return 'blocked';
      if (reviewTasks.some(t => t.assignedAgent === role)) return 'approval_required';
      if (runningTasks.some(t => t.assignedAgent === role)) return 'active';
      return 'idle';
    };

    const getAgentAction = (role: string): string => {
      const running = runningTasks.find(t => t.assignedAgent === role);
      if (running) return running.title;
      const review = reviewTasks.find(t => t.assignedAgent === role);
      if (review) return `Approval required: ${review.title}`;
      return 'Standby / Listening on Telegram thread';
    };

    return [
      // Top Level: Orchestrator Fleet Commander
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        role: 'orchestrator',
        type: 'agent',
        model: 'Nous Hermes 3 (405B)',
        status: getAgentStatus('orchestrator') === 'idle' && runningTasks.length > 0 ? 'active' : getAgentStatus('orchestrator'),
        x: 50,
        y: 18,
        color: '#EC4899',
        icon: Crown,
        currentAction: getAgentAction('orchestrator'),
        latency: 28,
        tokensConsumed: 12400
      },
      // Middle Tier 1: Specialist Agents
      {
        id: 'scout',
        name: 'Scout Specialist',
        role: 'scout',
        type: 'agent',
        model: 'Perplexity Sonar / Kimi K1.5',
        status: getAgentStatus('scout'),
        x: 18,
        y: 44,
        color: '#20B2AA',
        icon: Search,
        currentAction: getAgentAction('scout'),
        latency: 42,
        tokensConsumed: 8900
      },
      {
        id: 'dev',
        name: 'Dev Engineer',
        role: 'dev',
        type: 'agent',
        model: 'Claude Code 3.7 / Codex',
        status: getAgentStatus('dev'),
        x: 39,
        y: 44,
        color: '#00D26A',
        icon: Code2,
        currentAction: getAgentAction('dev'),
        latency: 35,
        tokensConsumed: 16500
      },
      {
        id: 'reach',
        name: 'Reach Architect',
        role: 'reach',
        type: 'agent',
        model: 'ChatGPT o3 / Gemini 2.5',
        status: getAgentStatus('reach'),
        x: 61,
        y: 44,
        color: '#F59E0B',
        icon: Share2,
        currentAction: getAgentAction('reach'),
        latency: 38,
        tokensConsumed: 6700
      },
      {
        id: 'analytics',
        name: 'Analytics Engine',
        role: 'analytics',
        type: 'agent',
        model: 'DeepSeek R1 / Gemini 2.5',
        status: getAgentStatus('analytics'),
        x: 82,
        y: 44,
        color: '#38BDF8',
        icon: BarChart3,
        currentAction: getAgentAction('analytics'),
        latency: 45,
        tokensConsumed: 14200
      },
      // Bottom Tier: Scribe, Governance, Memory, Tool Bus
      {
        id: 'scribe',
        name: 'Scribe Vault Sync',
        role: 'scribe',
        type: 'agent',
        model: 'Claude Code 3.7',
        status: getAgentStatus('scribe'),
        x: 25,
        y: 78,
        color: '#8B5CF6',
        icon: PenTool,
        currentAction: getAgentAction('scribe'),
        latency: 31,
        tokensConsumed: 9400
      },
      {
        id: 'guardian',
        name: 'Guardian Gate',
        role: 'governance',
        type: 'governance',
        model: 'Policy Enforcer v2',
        status: 'idle',
        x: 45,
        y: 78,
        color: '#F97316',
        icon: ShieldAlert,
        currentAction: 'Enforcing rate limits & RBAC boundaries',
        latency: 4,
        tokensConsumed: 1200
      },
      {
        id: 'aegis',
        name: 'Aegis Verifier',
        role: 'governance',
        type: 'governance',
        model: 'ZK / Hash Sentinel',
        status: 'idle',
        x: 58,
        y: 78,
        color: '#10B981',
        icon: ShieldCheck,
        currentAction: 'Emitting cryptographic execution receipts',
        latency: 6,
        tokensConsumed: 800
      },
      {
        id: 'memory',
        name: 'Obsidian Memory Core',
        role: 'memory',
        type: 'memory',
        model: 'Local Vector / SQLite',
        status: 'idle',
        x: 75,
        y: 78,
        color: '#A855F7',
        icon: Database,
        currentAction: '142 Bidirectional [[wikilinks]] cached in warm memory',
        latency: 12,
        tokensConsumed: 3100
      }
    ];
  }, [agents, tasks]);

  // Derive real edges from active events and standard structural paths
  const edges = useMemo(() => {
    // Standard persistent topology mesh
    const baseEdges: Array<{
      id: string;
      source: string;
      target: string;
      type: WireframeEvent['type'];
      label: string;
      status: 'active' | 'success' | 'blocked' | 'approval_required';
    }> = [
      { id: 'edge-orch-scout', source: 'orchestrator', target: 'scout', type: 'delegation', label: 'Crawl / Research', status: 'active' },
      { id: 'edge-orch-dev', source: 'orchestrator', target: 'dev', type: 'delegation', label: 'TDD / Sandbox', status: 'active' },
      { id: 'edge-orch-reach', source: 'orchestrator', target: 'reach', type: 'delegation', label: 'Distribution', status: 'active' },
      { id: 'edge-orch-analytics', source: 'orchestrator', target: 'analytics', type: 'delegation', label: 'Unit Economics', status: 'active' },
      { id: 'edge-scout-scribe', source: 'scout', target: 'scribe', type: 'memory_write', label: 'Memo Drafting', status: 'active' },
      { id: 'edge-dev-guardian', source: 'dev', target: 'guardian', type: 'guardian_decision', label: 'Security Preflight', status: 'active' },
      { id: 'edge-guardian-aegis', source: 'guardian', target: 'aegis', type: 'aegis_verification', label: 'Proof Signature', status: 'active' },
      { id: 'edge-scribe-memory', source: 'scribe', target: 'memory', type: 'memory_write', label: '[[Wikilinks]] Sync', status: 'active' },
      { id: 'edge-analytics-aegis', source: 'analytics', target: 'aegis', type: 'aegis_verification', label: 'Telemetry Receipt', status: 'active' },
    ];

    // Overlay any dynamic active events passed into the component
    if (activeEvents.length > 0) {
      activeEvents.forEach(evt => {
        const existingIdx = baseEdges.findIndex(e => e.source === evt.source && e.target === evt.target);
        if (existingIdx >= 0) {
          baseEdges[existingIdx] = {
            ...baseEdges[existingIdx],
            label: evt.label,
            status: evt.status,
            type: evt.type
          };
        } else {
          baseEdges.push({
            id: evt.id,
            source: evt.source,
            target: evt.target,
            type: evt.type,
            label: evt.label,
            status: evt.status
          });
        }
      });
    }

    return baseEdges;
  }, [activeEvents]);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  // SVG Helper to calculate line coordinates
  const getNodePos = (id: string) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return { x: 50, y: 50 };
    return { x: node.x, y: node.y };
  };

  const getEdgeColor = (type: WireframeEvent['type'], status: string) => {
    if (status === 'blocked') return '#EF4444';
    if (status === 'approval_required') return '#F59E0B';
    switch (type) {
      case 'delegation': return '#615EFF';
      case 'tool_call': return '#00D26A';
      case 'model_route': return '#38BDF8';
      case 'memory_read':
      case 'memory_write': return '#8B5CF6';
      case 'guardian_decision': return '#F97316';
      case 'aegis_verification': return '#10B981';
      default: return '#615EFF';
    }
  };

  return (
    <div className={`relative bg-[#070811] border border-[#1A1E36] rounded-2xl overflow-hidden font-mono ${className}`}>
      {/* Wireframe Header Controls */}
      <div className="bg-[#0B0D1B] px-4 py-3 border-b border-[#1A1E36] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#00D26A] shadow-[0_0_8px_#00D26A] animate-pulse" />
          <span className="font-bold text-white tracking-wider">HERMES AGENTOS LIVE WIREFRAME</span>
          <span className="text-[10px] bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/40 px-2 py-0.5 rounded font-bold uppercase">
            CANONICAL TOPOLOGY
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#05060C] p-0.5 rounded-lg border border-[#1E233D] text-[10px]">
            {(['ALL', 'AGENTS', 'GOVERNANCE'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilterType(tab)}
                className={`px-2.5 py-1 rounded-md transition font-bold cursor-pointer ${
                  filterType === tab 
                    ? 'bg-[#615EFF] text-white' 
                    : 'text-[#7E85A8] hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {onOpenGraphBuilder && (
            <button
              onClick={onOpenGraphBuilder}
              className="px-2.5 py-1 rounded-lg bg-[#121424] hover:bg-[#1C2038] text-[#38BDF8] border border-[#232742] text-[10px] font-bold flex items-center gap-1.5 transition cursor-pointer"
              title="Open full interactive Graph Builder"
            >
              <span>GRAPH BUILDER</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Interactive Topology Canvas */}
      <div className="relative w-full h-[400px] sm:h-[460px] bg-[#05060C] overflow-hidden select-none">
        {/* Subtle SVG Grid Background */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="wireframe-grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#242844" strokeWidth="0.8" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wireframe-grid)" />
        </svg>

        {/* Live Directed SVG Edges */}
        <svg className="absolute inset-0 w-full h-full pointer-events-auto">
          <defs>
            <marker id="arrow-blue" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#615EFF" />
            </marker>
            <marker id="arrow-green" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#00D26A" />
            </marker>
            <marker id="arrow-purple" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#8B5CF6" />
            </marker>
            <marker id="arrow-orange" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#F97316" />
            </marker>
            <marker id="arrow-emerald" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#10B981" />
            </marker>
          </defs>

          {edges.map(edge => {
            const p1 = getNodePos(edge.source);
            const p2 = getNodePos(edge.target);
            const strokeColor = getEdgeColor(edge.type, edge.status);
            const isSelected = selectedEdgeEvent?.id === edge.id;

            return (
              <g 
                key={edge.id} 
                className="cursor-pointer group"
                onClick={() => {
                  const ev: WireframeEvent = {
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                    type: edge.type,
                    label: edge.label,
                    detail: `Directed event trace from [${edge.source}] to [${edge.target}]. Protocol: ${edge.type.toUpperCase()}. Status: ${edge.status.toUpperCase()}.`,
                    timestamp: new Date().toLocaleTimeString(),
                    status: edge.status
                  };
                  setSelectedEdgeEvent(ev);
                  if (onSelectEvent) onSelectEvent(ev);
                }}
              >
                {/* Wider invisible path for easy clicking */}
                <line
                  x1={`${p1.x}%`}
                  y1={`${p1.y}%`}
                  x2={`${p2.x}%`}
                  y2={`${p2.y}%`}
                  stroke="transparent"
                  strokeWidth="18"
                />
                
                {/* Visible Base Line */}
                <line
                  x1={`${p1.x}%`}
                  y1={`${p1.y}%`}
                  x2={`${p2.x}%`}
                  y2={`${p2.y}%`}
                  stroke={strokeColor}
                  strokeWidth={isSelected ? '2.5' : '1.5'}
                  strokeOpacity={isSelected ? '1' : '0.6'}
                  strokeDasharray="4 4"
                  className="transition-all duration-300 group-hover:stroke-opacity-100 group-hover:stroke-width-2"
                />

                {/* Animated Flow Pulse Particle along Edge */}
                <circle r={isSelected ? '4' : '3'} fill={strokeColor}>
                  <animateMotion
                    path={`M ${p1.x * 4} ${p1.y * 4} L ${p2.x * 4} ${p2.y * 4}`}
                    dur="3s"
                    repeatCount="indefinite"
                  />
                </circle>

                {/* Edge Label Badge */}
                <foreignObject
                  x={`${(p1.x + p2.x) / 2 - 12}%`}
                  y={`${(p1.y + p2.y) / 2 - 3}%`}
                  width="120"
                  height="26"
                  className="overflow-visible pointer-events-none"
                >
                  <div className="flex items-center justify-center">
                    <span 
                      className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider backdrop-blur-sm border"
                      style={{
                        backgroundColor: `${strokeColor}15`,
                        borderColor: `${strokeColor}40`,
                        color: strokeColor
                      }}
                    >
                      {edge.label}
                    </span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>

        {/* Live Nodes positioned on the canvas */}
        {nodes.map(node => {
          if (filterType === 'AGENTS' && node.type !== 'agent') return null;
          if (filterType === 'GOVERNANCE' && node.type !== 'governance') return null;

          const Icon = node.icon;
          const isSelected = selectedNodeId === node.id;
          const isActive = node.status === 'active';
          const isBlocked = node.status === 'blocked';
          const isApproval = node.status === 'approval_required';

          return (
            <div
              key={node.id}
              onClick={() => {
                setSelectedNodeId(node.id);
                setSelectedEdgeEvent(null);
                if (onSelectAgent && node.role) onSelectAgent(node.role);
              }}
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: 'translate(-50%, -50%)'
              }}
              className={`absolute cursor-pointer transition-all duration-300 z-10 group ${
                isSelected ? 'scale-110' : 'hover:scale-105'
              }`}
            >
              {/* Pulsing Active Ring */}
              {isActive && (
                <div 
                  className="absolute -inset-2 rounded-2xl animate-ping opacity-30 pointer-events-none"
                  style={{ backgroundColor: node.color }}
                />
              )}

              {/* Blocked Warning Ring */}
              {isBlocked && (
                <div className="absolute -inset-2 rounded-2xl animate-pulse bg-red-500/30 border border-red-500 pointer-events-none" />
              )}

              {/* Node Card Container */}
              <div 
                className={`p-2.5 rounded-xl border flex items-center gap-2.5 shadow-xl transition-all duration-200 ${
                  isSelected
                    ? 'bg-[#151930] shadow-2xl'
                    : 'bg-[#0B0D1A] hover:bg-[#111425]'
                }`}
                style={{
                  borderColor: isSelected 
                    ? node.color 
                    : isBlocked 
                      ? '#EF4444' 
                      : isApproval 
                        ? '#F59E0B' 
                        : `${node.color}50`,
                  boxShadow: isSelected ? `0 0 20px ${node.color}40` : undefined
                }}
              >
                {/* Node Icon Box */}
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
                  style={{
                    backgroundColor: `${node.color}20`,
                    borderColor: `${node.color}50`,
                    color: node.color
                  }}
                >
                  <Icon className="w-4 h-4" />
                </div>

                {/* Node Text & Status Indicator */}
                <div className="min-w-0 pr-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-white whitespace-nowrap truncate">
                      {node.name}
                    </span>
                    
                    {/* Status Pill */}
                    <span 
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isActive 
                          ? 'bg-[#00D26A] shadow-[0_0_6px_#00D26A] animate-pulse' 
                          : isBlocked 
                            ? 'bg-[#EF4444] shadow-[0_0_6px_#EF4444] animate-bounce' 
                            : isApproval 
                              ? 'bg-[#F59E0B] shadow-[0_0_6px_#F59E0B]' 
                              : 'bg-[#4B5272]'
                      }`}
                    />
                  </div>

                  <div className="text-[9px] text-[#7E85A8] truncate max-w-[120px]">
                    {node.model}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Live Telemetry & Inspector Panel */}
      <div className="bg-[#0B0D1A] p-3 border-t border-[#1A1E36] flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
        {selectedNode ? (
          <div className="flex-1 flex items-center justify-between gap-4 w-full">
            <div className="flex items-center gap-3">
              <div 
                className="w-7 h-7 rounded-lg flex items-center justify-center border text-white font-bold"
                style={{ backgroundColor: `${selectedNode.color}25`, borderColor: selectedNode.color }}
              >
                <selectedNode.icon className="w-3.5 h-3.5" style={{ color: selectedNode.color }} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{selectedNode.name}</span>
                  <span className="text-[10px] text-[#A5A2FF] bg-[#615EFF]/20 px-1.5 py-0.5 rounded border border-[#615EFF]/40 font-mono">
                    {selectedNode.model}
                  </span>
                  <span 
                    className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
                    style={{
                      backgroundColor: selectedNode.status === 'active' ? '#00D26A20' : '#4B527220',
                      color: selectedNode.status === 'active' ? '#00D26A' : '#8E94B8',
                      border: `1px solid ${selectedNode.status === 'active' ? '#00D26A40' : '#4B527240'}`
                    }}
                  >
                    {selectedNode.status}
                  </span>
                </div>
                <div className="text-[10px] text-[#8E94B8] truncate max-w-xl">
                  {selectedNode.currentAction}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 text-[10px] text-[#7E85A8] font-mono shrink-0">
              <div>LATENCY: <strong className="text-white">{selectedNode.latency}ms</strong></div>
              <div>TOKENS: <strong className="text-[#38BDF8]">{(selectedNode.tokensConsumed || 0).toLocaleString()}</strong></div>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="p-1 hover:bg-[#1C2038] rounded text-[#7E85A8] hover:text-white transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : selectedEdgeEvent ? (
          <div className="flex-1 flex items-center justify-between gap-4 w-full">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-[#615EFF]/20 border border-[#615EFF]/50 flex items-center justify-center text-[#A5A2FF]">
                <Activity className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">EVENT TRACE: {selectedEdgeEvent.label}</span>
                  <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/20 px-1.5 py-0.5 rounded border border-[#00D26A]/40 font-mono uppercase">
                    {selectedEdgeEvent.type}
                  </span>
                </div>
                <div className="text-[10px] text-[#8E94B8]">
                  {selectedEdgeEvent.detail}
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedEdgeEvent(null)}
              className="p-1 hover:bg-[#1C2038] rounded text-[#7E85A8] hover:text-white transition shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full text-[#7E85A8] text-[11px]">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#615EFF]" />
              <span>Click any agent node or directed edge to inspect real-time payload, model telemetry, and guardian verification trace.</span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#EC4899]" /> Orchestrator</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#00D26A]" /> Dev Sandbox</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]" /> DeepSeek Analytics</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
