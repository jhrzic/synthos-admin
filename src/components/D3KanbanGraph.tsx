import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { KanbanTask, AgentRole } from '../types';
import { computeCriticalPathAnalysis } from './KanbanDependencyDAG';
import { Flame, Link2, ArrowRight, ShieldAlert, Cpu, Sparkles, RefreshCw } from 'lucide-react';

interface D3KanbanGraphProps {
  tasks: KanbanTask[];
  onSelectTask?: (task: KanbanTask) => void;
  highlightedTaskId?: string | null;
  onHighlightTask?: (taskId: string | null) => void;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  agent: AgentRole;
  column: string;
  isCritical: boolean;
  priority: string;
  estimatedHours: string;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  isCritical: boolean;
  edgeKey: string;
}

export const D3KanbanGraph: React.FC<D3KanbanGraphProps> = ({
  tasks,
  onSelectTask,
  highlightedTaskId,
  onHighlightTask
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredLink, setHoveredLink] = useState<{ source: string; target: string; isCritical: boolean } | null>(null);
  const [simulationMode, setSimulationMode] = useState<'force' | 'cluster'>('force');

  const cpm = useMemo(() => computeCriticalPathAnalysis(tasks), [tasks]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 900;
    const height = 650;

    // Clear previous SVG content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%');

    // Add zoom container group
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Prepare nodes and links data
    const nodes: GraphNode[] = tasks.map(t => ({
      id: t.id,
      title: t.title,
      agent: t.assignedAgent,
      column: t.column,
      isCritical: cpm.criticalTaskIds.has(t.id),
      priority: t.priority,
      estimatedHours: t.estimatedHours || '2.0h'
    }));

    const links: GraphLink[] = [];
    tasks.forEach(t => {
      const deps = t.dependencies || [];
      deps.forEach(srcId => {
        if (cpm.tasksMap.has(srcId)) {
          links.push({
            source: srcId,
            target: t.id,
            isCritical: cpm.criticalEdgeKeys.has(`${srcId}->${t.id}`),
            edgeKey: `${srcId}->${t.id}`
          });
        }
      });
    });

    // Arrow markers definitions
    const defs = svg.append('defs');

    // Normal arrow
    defs.append('marker')
      .attr('id', 'd3-arrow-normal')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 22)
      .attr('refY', 5)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M 0 1.5 L 10 5 L 0 8.5 z')
      .attr('fill', '#615EFF');

    // Critical arrow
    defs.append('marker')
      .attr('id', 'd3-arrow-critical')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 22)
      .attr('refY', 5)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M 0 1 L 10 5 L 0 9 z')
      .attr('fill', '#F59E0B');

    // Highlighted arrow
    defs.append('marker')
      .attr('id', 'd3-arrow-highlight')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 22)
      .attr('refY', 5)
      .attr('markerWidth', 8)
      .attr('markerHeight', 8)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M 0 0.5 L 10 5 L 0 9.5 z')
      .attr('fill', '#A299FF');

    // Force simulation setup
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(130))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(45));

    if (simulationMode === 'cluster') {
      simulation.force('x', d3.forceX<GraphNode>(d => {
        if (d.column === 'backlog') return width * 0.2;
        if (d.column === 'in-progress') return width * 0.4;
        if (d.column === 'review') return width * 0.65;
        return width * 0.85;
      }).strength(0.8));
    }

    // Draw links
    const linkGroup = g.append('g').attr('class', 'links');
    const link = linkGroup.selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', d => d.isCritical ? '#F59E0B' : '#615EFF')
      .attr('stroke-width', d => d.isCritical ? 3 : 1.8)
      .attr('stroke-dasharray', d => d.isCritical ? '5 3' : 'none')
      .attr('stroke-opacity', 0.7)
      .attr('marker-end', d => d.isCritical ? 'url(#d3-arrow-critical)' : 'url(#d3-arrow-normal)')
      .on('mouseenter', (event, d) => {
        const srcId = typeof d.source === 'object' ? d.source.id : d.source;
        const tgtId = typeof d.target === 'object' ? d.target.id : d.target;
        setHoveredLink({ source: srcId, target: tgtId, isCritical: d.isCritical });

        d3.select(event.currentTarget)
          .transition().duration(150)
          .attr('stroke-width', 4)
          .attr('stroke-opacity', 1)
          .attr('stroke', '#A299FF');
      })
      .on('mouseleave', (event, d) => {
        setHoveredLink(null);
        d3.select(event.currentTarget)
          .transition().duration(150)
          .attr('stroke-width', d.isCritical ? 3 : 1.8)
          .attr('stroke-opacity', 0.7)
          .attr('stroke', d.isCritical ? '#F59E0B' : '#615EFF');
      });

    // Draw nodes
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const node = nodeGroup.selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      )
      .on('click', (event, d) => {
        onHighlightTask?.(highlightedTaskId === d.id ? null : d.id);
        const originalTask = tasks.find(t => t.id === d.id);
        if (originalTask && onSelectTask) {
          onSelectTask(originalTask);
        }
      });

    // Node background circle / card
    node.append('rect')
      .attr('width', 130)
      .attr('height', 56)
      .attr('x', -65)
      .attr('y', -28)
      .attr('rx', 12)
      .attr('fill', d => d.isCritical ? '#16140D' : '#0B0D1B')
      .attr('stroke', d => highlightedTaskId === d.id ? '#A299FF' : d.isCritical ? '#F59E0B' : '#202548')
      .attr('stroke-width', d => highlightedTaskId === d.id ? 2.5 : d.isCritical ? 2 : 1)
      .attr('filter', 'drop-shadow(0px 8px 16px rgba(0,0,0,0.4))');

    // Agent badge pill inside node
    node.append('rect')
      .attr('width', 50)
      .attr('height', 16)
      .attr('x', -55)
      .attr('y', -20)
      .attr('rx', 4)
      .attr('fill', d => {
        if (d.agent === 'scout') return 'rgba(32, 178, 170, 0.2)';
        if (d.agent === 'scribe') return 'rgba(139, 92, 246, 0.2)';
        if (d.agent === 'dev') return 'rgba(0, 210, 106, 0.2)';
        return 'rgba(97, 95, 255, 0.2)';
      });

    node.append('text')
      .attr('x', -50)
      .attr('y', -9)
      .attr('fill', '#A299FF')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .text(d => d.agent.toUpperCase());

    // Task Title text
    node.append('text')
      .attr('x', -55)
      .attr('y', 7)
      .attr('fill', '#FFFFFF')
      .attr('font-size', '11px')
      .attr('font-family', 'system-ui, sans-serif')
      .attr('font-weight', '600')
      .text(d => d.title.length > 18 ? d.title.substring(0, 16) + '...' : d.title);

    // Subtext hours
    node.append('text')
      .attr('x', -55)
      .attr('y', 20)
      .attr('fill', '#8E94B8')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text(d => `${d.column} • ${d.estimatedHours}`);

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x || 0)
        .attr('y1', d => (d.source as GraphNode).y || 0)
        .attr('x2', d => (d.target as GraphNode).x || 0)
        .attr('y2', d => (d.target as GraphNode).y || 0);

      node.attr('transform', d => `translate(${d.x || 0}, ${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [tasks, cpm, simulationMode, highlightedTaskId]);

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#090B18] border border-[#1D2244] p-4 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#615EFF]/15 text-[#615EFF] border border-[#615EFF]/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white font-['Space_Grotesk']">
              D3.js Interactive Directed Dependency Network
            </h3>
            <p className="text-xs text-[#8E94B8]">
              Hover over directed edges to highlight connection types. Drag nodes to rearrange force-simulation physics.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#05060C] border border-[#1D2244] rounded-xl p-1">
            <button
              onClick={() => setSimulationMode('force')}
              className={`px-3 py-1.5 text-xs font-mono rounded-lg transition ${
                simulationMode === 'force' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              Force Simulation
            </button>
            <button
              onClick={() => setSimulationMode('cluster')}
              className={`px-3 py-1.5 text-xs font-mono rounded-lg transition ${
                simulationMode === 'cluster' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              Stage Cluster
            </button>
          </div>
        </div>
      </div>

      {/* Hovered Edge Tooltip Banner */}
      {hoveredLink && (
        <div className="p-3 rounded-xl bg-[#12162E] border border-[#2B315C] text-xs font-mono flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-[#A299FF]" />
            <span className="text-[#8E94B8]">Connection Type:</span>
            <span className={hoveredLink.isCritical ? 'text-amber-400 font-bold flex items-center gap-1' : 'text-white font-bold'}>
              {hoveredLink.isCritical && <Flame className="w-3 h-3 animate-pulse" />}
              {hoveredLink.isCritical ? 'Critical Path Dependency' : 'Standard Directed Prerequisite ➔ Successor'}
            </span>
          </div>
          <div className="text-[11px] text-[#8E94B8]">
            Source: <strong className="text-white">{hoveredLink.source}</strong> | Target: <strong className="text-white">{hoveredLink.target}</strong>
          </div>
        </div>
      )}

      {/* D3 SVG Container */}
      <div 
        ref={containerRef}
        className="relative w-full h-[650px] bg-[#05060C] border border-[#181C38] rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center"
      >
        <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

        <div className="absolute bottom-4 left-4 pointer-events-none flex items-center gap-3 p-3 bg-black/70 backdrop-blur-md rounded-xl border border-white/10 text-[11px] font-mono text-gray-300">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#F59E0B] inline-block" />
            <span>Critical Path Edge</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#615EFF] inline-block" />
            <span>Standard Dependency</span>
          </div>
          <div className="text-gray-500">| Scroll to zoom, Drag to pan/reposition</div>
        </div>
      </div>
    </div>
  );
};
