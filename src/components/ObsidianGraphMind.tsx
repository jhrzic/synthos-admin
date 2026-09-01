import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ObsidianNote, ObsidianVault, AIModelInfo } from '../types';
import { 
  Sparkles, Maximize2, Minimize2, ZoomIn, ZoomOut, 
  RotateCcw, Search, Filter, Play, Pause, Zap, 
  Share2, Layers, Compass, Sliders, Hash, Database,
  FileText, Link as LinkIcon, Cpu
} from 'lucide-react';

interface GraphNode {
  id: string;
  name: string;
  type: 'note' | 'model' | 'tag' | 'vault';
  color: string;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  data?: any;
}

interface GraphLink {
  source: string;
  target: string;
  color?: string;
  strength?: number;
}

interface Particle {
  sourceId: string;
  targetId: string;
  progress: number;
  speed: number;
  color: string;
}

interface ObsidianGraphMindProps {
  notes: ObsidianNote[];
  vaults: ObsidianVault[];
  models: Record<string, AIModelInfo>;
  selectedNoteId?: string;
  onSelectNote?: (noteId: string) => void;
  onOpenNote?: (noteId: string) => void;
  height?: number | string;
}

export const ObsidianGraphMind: React.FC<ObsidianGraphMindProps> = ({
  notes,
  vaults,
  models,
  selectedNoteId,
  onSelectNote,
  onOpenNote,
  height = 560,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isSimulating, setIsSimulating] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [showSynapseParticles, setShowSynapseParticles] = useState(true);
  const [layoutMode, setLayoutMode] = useState<'force' | 'radial' | 'cluster'>('force');

  // Simulation physics parameters
  const [repulsion, setRepulsion] = useState(160);
  const [linkDistance, setLinkDistance] = useState(85);
  const [gravity, setGravity] = useState(0.04);
  const [particleSpeed, setParticleSpeed] = useState(1.2);

  // Transform view (pan & zoom)
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);

  // Synapse particles
  const particlesRef = useRef<Particle[]>([]);
  // Wave rings
  const waveRingsRef = useRef<Array<{ x: number; y: number; r: number; maxR: number; alpha: number; color: string }>>([]);

  // Extract unique folders and tags
  const folders = useMemo(() => Array.from(new Set(notes.map(n => n.folder))), [notes]);
  const tags = useMemo(() => Array.from(new Set(notes.flatMap(n => n.tags))), [notes]);

  // Construct Nodes and Links from Notes, Vaults, and Models
  const { initialNodes, initialLinks } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const linkList: GraphLink[] = [];

    // 1. Vault Nodes (Central hubs)
    vaults.forEach((v, i) => {
      const angle = (i / Math.max(1, vaults.length)) * Math.PI * 2;
      const dist = 140;
      nodeMap.set(`vault-${v.id}`, {
        id: `vault-${v.id}`,
        name: v.name,
        type: 'vault',
        color: '#00D26A',
        radius: 14,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        degree: 0,
        data: v,
      });
    });

    // 2. AI Model Synapses
    Object.entries(models).forEach(([key, model], i) => {
      const angle = (i / Object.keys(models).length) * Math.PI * 2;
      const dist = 240;
      nodeMap.set(`model-${key}`, {
        id: `model-${key}`,
        name: model.name,
        type: 'model',
        color: model.color || '#615EFF',
        radius: 12,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        degree: 0,
        data: model,
      });
    });

    // 3. Note Nodes
    notes.forEach((n, i) => {
      // Pick color based on folder
      let color = '#8C8AFF';
      if (n.folder === 'Architecture') color = '#615EFF';
      else if (n.folder === 'Research-2026') color = '#00D26A';
      else if (n.folder === 'Protocols') color = '#EAB308';
      else if (n.folder === 'Daily-Syntheses') color = '#EC4899';
      else if (n.folder === 'Pipelines') color = '#06B6D4';

      const angle = (i / Math.max(1, notes.length)) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 80 + Math.random() * 180;
      nodeMap.set(n.id, {
        id: n.id,
        name: n.title,
        type: 'note',
        color,
        radius: 6 + Math.min(8, (n.wikilinks?.length || 0) * 1.5 + (n.tags?.length || 0)),
        x: Math.cos(angle) * dist + (Math.random() - 0.5) * 40,
        y: Math.sin(angle) * dist + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        degree: 0,
        data: n,
      });

      // Link to a vault node
      linkList.push({
        source: `vault-${vaults[0]?.id || 'vault-1'}`,
        target: n.id,
        color: 'rgba(97, 94, 255, 0.15)',
      });

      // Link to models if referenced
      Object.keys(models).forEach(mKey => {
        if (n.content.toLowerCase().includes(mKey) || n.title.toLowerCase().includes(mKey) || n.tags.includes(mKey)) {
          linkList.push({
            source: `model-${mKey}`,
            target: n.id,
            color: 'rgba(234, 179, 8, 0.25)',
          });
        }
      });
    });

    // 4. Wikilinks Connections between notes
    notes.forEach(sourceNote => {
      if (!sourceNote.wikilinks) return;
      sourceNote.wikilinks.forEach(linkName => {
        // Find if target note matches
        const targetNote = notes.find(n => 
          n.title.toLowerCase().includes(linkName.toLowerCase()) || 
          linkName.toLowerCase().includes(n.title.toLowerCase())
        );
        if (targetNote && targetNote.id !== sourceNote.id) {
          linkList.push({
            source: sourceNote.id,
            target: targetNote.id,
            color: 'rgba(140, 138, 255, 0.4)',
          });
        }
      });
    });

    // Calculate node degrees
    const nodes = Array.from(nodeMap.values());
    linkList.forEach(link => {
      const s = nodeMap.get(link.source);
      const t = nodeMap.get(link.target);
      if (s) s.degree = (s.degree || 0) + 1;
      if (t) t.degree = (t.degree || 0) + 1;
    });

    return { initialNodes: nodes, initialLinks: linkList };
  }, [notes, vaults, models]);

  // Keep node mutable array across frames
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);

  // Update refs when structure changes
  useEffect(() => {
    // preserve existing positions if available
    const posMap = new Map(nodesRef.current.map(n => [n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }]));
    nodesRef.current = initialNodes.map(node => {
      const existing = posMap.get(node.id);
      if (existing) {
        return { ...node, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy };
      }
      return { ...node };
    });
    linksRef.current = initialLinks;

    // Seed particles
    const seededParticles: Particle[] = [];
    for (let i = 0; i < 28; i++) {
      if (initialLinks.length > 0) {
        const randomLink = initialLinks[Math.floor(Math.random() * initialLinks.length)];
        seededParticles.push({
          sourceId: randomLink.source,
          targetId: randomLink.target,
          progress: Math.random(),
          speed: 0.004 + Math.random() * 0.008,
          color: Math.random() > 0.5 ? '#615EFF' : '#EAB308',
        });
      }
    }
    particlesRef.current = seededParticles;
  }, [initialNodes, initialLinks]);

  // Handle Canvas Resize & Simulation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resize = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    // Initial transform center
    if (transformRef.current.x === 0 && transformRef.current.y === 0) {
      const container = containerRef.current;
      if (container) {
        transformRef.current.x = container.clientWidth / 2;
        transformRef.current.y = container.clientHeight / 2;
      }
    }

    // Animation & Physics Step
    let lastWaveTime = Date.now();

    const render = () => {
      const container = containerRef.current;
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;

      ctx.clearRect(0, 0, width, height);

      // Save context for camera transform
      ctx.save();
      ctx.translate(transformRef.current.x, transformRef.current.y);
      ctx.scale(transformRef.current.k, transformRef.current.k);

      const nodes = nodesRef.current;
      const links = linksRef.current;

      // Filter nodes based on filters
      const isNodeVisible = (node: GraphNode) => {
        if (searchTerm) {
          const matchName = node.name.toLowerCase().includes(searchTerm.toLowerCase());
          const matchContent = node.data?.content ? node.data.content.toLowerCase().includes(searchTerm.toLowerCase()) : false;
          if (!matchName && !matchContent) return false;
        }
        if (selectedTagFilter && node.type === 'note') {
          if (!node.data?.tags?.includes(selectedTagFilter)) return false;
        }
        if (selectedFolderFilter && node.type === 'note') {
          if (node.data?.folder !== selectedFolderFilter) return false;
        }
        return true;
      };

      // Physics update step
      if (isSimulating) {
        // 1. Repulsion between all node pairs
        for (let i = 0; i < nodes.length; i++) {
          const n1 = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const n2 = nodes[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist < 320) {
              const force = (repulsion * 40) / (dist * dist);
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              n1.vx -= fx;
              n1.vy -= fy;
              n2.vx += fx;
              n2.vy += fy;
            }
          }
        }

        // 2. Link Spring Tension
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        for (const link of links) {
          const source = nodeMap.get(link.source);
          const target = nodeMap.get(link.target);
          if (source && target) {
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const displacement = dist - linkDistance;
            const force = displacement * 0.025;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            source.vx += fx;
            source.vy += fy;
            target.vx -= fx;
            target.vy -= fy;
          }
        }

        // 3. Center Gravity & Velocity integration
        for (const node of nodes) {
          if (draggedNodeRef.current?.id === node.id) continue;

          // Radial or cluster layout bias
          if (layoutMode === 'radial' && node.type === 'vault') {
            node.vx += -node.x * 0.08;
            node.vy += -node.y * 0.08;
          } else {
            node.vx += -node.x * gravity;
            node.vy += -node.y * gravity;
          }

          // Damping
          node.vx *= 0.84;
          node.vy *= 0.84;

          node.x += node.vx;
          node.y += node.vy;
        }
      }

      // Render subtle background coordinate grid
      ctx.strokeStyle = 'rgba(30, 33, 56, 0.25)';
      ctx.lineWidth = 1;
      const gridSize = 80;
      const minX = -1200;
      const maxX = 1200;
      const minY = -1200;
      const maxY = 1200;

      for (let gx = minX; gx <= maxX; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, minY);
        ctx.lineTo(gx, maxY);
        ctx.stroke();
      }
      for (let gy = minY; gy <= maxY; gy += gridSize) {
        ctx.beginPath();
        ctx.moveTo(minX, gy);
        ctx.lineTo(maxX, gy);
        ctx.stroke();
      }

      // Periodic Wave Rings from Hubs
      if (Date.now() - lastWaveTime > 2400) {
        lastWaveTime = Date.now();
        const hubs = nodes.filter(n => n.type === 'vault' || n.type === 'model');
        if (hubs.length > 0) {
          const randHub = hubs[Math.floor(Math.random() * hubs.length)];
          waveRingsRef.current.push({
            x: randHub.x,
            y: randHub.y,
            r: randHub.radius,
            maxR: 180,
            alpha: 0.6,
            color: randHub.color,
          });
        }
      }

      // Draw & update Wave Rings
      for (let i = waveRingsRef.current.length - 1; i >= 0; i--) {
        const ring = waveRingsRef.current[i];
        ring.r += 1.2;
        ring.alpha -= 0.005;

        if (ring.alpha <= 0 || ring.r >= ring.maxR) {
          waveRingsRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = ring.color;
        ctx.globalAlpha = Math.max(0, ring.alpha * 0.4);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      // 1. Draw Links
      for (const link of links) {
        const source = nodeMap.get(link.source);
        const target = nodeMap.get(link.target);
        if (!source || !target) continue;

        const isSourceVisible = isNodeVisible(source);
        const isTargetVisible = isNodeVisible(target);
        if (!isSourceVisible && !isTargetVisible) continue;

        const isHighlighted = 
          hoveredNode && (hoveredNode.id === source.id || hoveredNode.id === target.id);
        const isSelected = 
          selectedNoteId && (selectedNoteId === source.id || selectedNoteId === target.id);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);

        if (isHighlighted || isSelected) {
          ctx.strokeStyle = '#615EFF';
          ctx.lineWidth = 2.2;
          ctx.globalAlpha = 0.9;
          ctx.shadowColor = '#615EFF';
          ctx.shadowBlur = 8;
        } else {
          ctx.strokeStyle = link.color || 'rgba(97, 94, 255, 0.18)';
          ctx.lineWidth = 1;
          ctx.globalAlpha = isSourceVisible && isTargetVisible ? 0.35 : 0.08;
        }

        ctx.stroke();
        ctx.restore();
      }

      // 2. Draw Synapse Particles traveling along edges
      if (showSynapseParticles && particlesRef.current.length > 0) {
        for (const p of particlesRef.current) {
          const s = nodeMap.get(p.sourceId);
          const t = nodeMap.get(p.targetId);
          if (!s || !t) continue;

          p.progress += p.speed * particleSpeed;
          if (p.progress >= 1) {
            p.progress = 0;
            // occasionally jump to another random link
            if (Math.random() > 0.4 && links.length > 0) {
              const nextLink = links[Math.floor(Math.random() * links.length)];
              p.sourceId = nextLink.source;
              p.targetId = nextLink.target;
            }
          }

          const px = s.x + (t.x - s.x) * p.progress;
          const py = s.y + (t.y - s.y) * p.progress;

          ctx.save();
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.restore();
        }
      }

      // 3. Draw Nodes
      for (const node of nodes) {
        const isVisible = isNodeVisible(node);
        const isHovered = hoveredNode?.id === node.id;
        const isSelected = selectedNoteId === node.id;
        const isNeighbor = 
          hoveredNode && links.some(l => 
            (l.source === hoveredNode.id && l.target === node.id) ||
            (l.target === hoveredNode.id && l.source === node.id)
          );

        ctx.save();
        ctx.globalAlpha = isVisible ? 1 : 0.18;

        // Glowing outer halo
        if (isHovered || isSelected || isNeighbor) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + (isHovered ? 8 : 4), 0, Math.PI * 2);
          ctx.fillStyle = node.color;
          ctx.globalAlpha = 0.25;
          ctx.shadowColor = node.color;
          ctx.shadowBlur = 16;
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // Inner solid circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isHovered || isSelected ? 12 : 4;
        ctx.fill();

        // Node border
        ctx.strokeStyle = isSelected ? '#FFFFFF' : '#0B0D18';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.stroke();

        // Node label
        if (node.radius >= 9 || isHovered || isSelected || isNeighbor || node.degree > 3) {
          ctx.font = `${isHovered || isSelected ? '600 11px' : '500 10px'} 'Plus Jakarta Sans', sans-serif`;
          ctx.fillStyle = isHovered || isSelected ? '#FFFFFF' : '#B2B7D6';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(node.name, node.x, node.y + node.radius + 4);
        }

        ctx.restore();
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, [
    isSimulating, repulsion, linkDistance, gravity, 
    particleSpeed, showSynapseParticles, searchTerm, 
    selectedTagFilter, selectedFolderFilter, layoutMode, 
    selectedNoteId, hoveredNode
  ]);

  // Pointer Interaction Handlers (Pan, Zoom, Drag, Hover)
  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - transformRef.current.x) / transformRef.current.k;
    const y = (clientY - rect.top - transformRef.current.y) / transformRef.current.k;
    return { x, y };
  };

  const findNodeAt = (x: number, y: number): GraphNode | null => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const dx = node.x - x;
      const dy = node.y - y;
      if (dx * dx + dy * dy <= (node.radius + 6) * (node.radius + 6)) {
        return node;
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const coords = getCanvasCoords(e.clientX, e.clientY);
    const node = findNodeAt(coords.x, coords.y);

    if (node) {
      draggedNodeRef.current = node;
    } else {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getCanvasCoords(e.clientX, e.clientY);

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = coords.x;
      draggedNodeRef.current.y = coords.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
    } else if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      transformRef.current.x += dx;
      transformRef.current.y += dy;
    } else {
      // Hover detection
      const node = findNodeAt(coords.x, coords.y);
      if (node !== hoveredNode) {
        setHoveredNode(node);
      }
      if (node) {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          setHoverPos({
            x: e.clientX - rect.left + 15,
            y: e.clientY - rect.top + 15,
          });
        }
      } else {
        setHoverPos(null);
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (draggedNodeRef.current) {
      const coords = getCanvasCoords(e.clientX, e.clientY);
      const node = draggedNodeRef.current;
      draggedNodeRef.current = null;

      // If clicked without large drag, select note
      if (node.type === 'note' && onSelectNote) {
        onSelectNote(node.id);
      }
    }
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const newK = Math.max(0.2, Math.min(3.5, transformRef.current.k * zoomFactor));
    
    // Zoom toward mouse pointer
    transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * (newK / transformRef.current.k);
    transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * (newK / transformRef.current.k);
    transformRef.current.k = newK;
  };

  const handleResetZoom = () => {
    const container = containerRef.current;
    if (container) {
      transformRef.current = {
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
        k: 1,
      };
    }
  };

  const handleSynapseBurst = () => {
    // Blast a burst of energy from central hubs
    nodesRef.current.forEach(node => {
      const angle = Math.random() * Math.PI * 2;
      const force = 12 + Math.random() * 20;
      node.vx += Math.cos(angle) * force;
      node.vy += Math.sin(angle) * force;
    });

    // Create wave rings
    nodesRef.current.slice(0, 4).forEach(n => {
      waveRingsRef.current.push({
        x: n.x,
        y: n.y,
        r: 10,
        maxR: 240,
        alpha: 0.9,
        color: n.color,
      });
    });
  };

  return (
    <div 
      ref={containerRef}
      className={`relative bg-[#06070E] border border-[#1A1D30] rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 ${
        isFullscreen ? 'fixed inset-4 z-50 rounded-2xl border-[#615EFF]' : 'w-full'
      }`}
      style={{ height: isFullscreen ? 'calc(100vh - 2rem)' : height }}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Top Header Controls Bar */}
      <div className="absolute top-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Search & Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#62688E] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search graph & wikilinks..."
              className="bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] focus:border-[#615EFF] text-xs text-white placeholder-[#585E82] rounded-lg pl-8 pr-3 py-1.5 focus:outline-none w-44 sm:w-56 transition font-mono"
            />
          </div>

          {/* Folder filter dropdown */}
          <select
            value={selectedFolderFilter || ''}
            onChange={(e) => setSelectedFolderFilter(e.target.value || null)}
            className="bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] text-[11px] font-mono text-[#8E94B8] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#615EFF]"
          >
            <option value="">All Folders ({folders.length})</option>
            {folders.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          {/* Tag filter dropdown */}
          <select
            value={selectedTagFilter || ''}
            onChange={(e) => setSelectedTagFilter(e.target.value || null)}
            className="bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] text-[11px] font-mono text-[#8E94B8] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#615EFF]"
          >
            <option value="">All Tags ({tags.length})</option>
            {tags.map(t => (
              <option key={t} value={t}>#{t}</option>
            ))}
          </select>
        </div>

        {/* Right: Actions & Physics Controls */}
        <div className="flex items-center gap-1.5 pointer-events-auto bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] p-1 rounded-xl shadow-lg">
          <button
            onClick={handleSynapseBurst}
            className="p-1.5 rounded-lg text-[#EAB308] hover:bg-[#EAB308]/15 transition flex items-center gap-1 text-[11px] font-mono font-bold px-2"
            title="Trigger Neural Synapse Burst"
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">SYNAPSE BURST</span>
          </button>

          <div className="w-[1px] h-4 bg-[#232742]" />

          <button
            onClick={() => setIsSimulating(!isSimulating)}
            className="p-1.5 rounded-lg text-[#8E94B8] hover:text-white hover:bg-[#1A1D30] transition"
            title={isSimulating ? "Pause Physics" : "Resume Physics"}
          >
            {isSimulating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg transition ${
              showSettings ? 'bg-[#615EFF] text-white' : 'text-[#8E94B8] hover:text-white hover:bg-[#1A1D30]'
            }`}
            title="Physics & Graph Parameters"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleResetZoom}
            className="p-1.5 rounded-lg text-[#8E94B8] hover:text-white hover:bg-[#1A1D30] transition"
            title="Reset Graph Zoom & Position"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg text-[#8E94B8] hover:text-white hover:bg-[#1A1D30] transition"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mind View"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Physics Settings Drawer Panel */}
      {showSettings && (
        <div className="absolute top-16 right-4 w-72 bg-[#0B0D18]/95 backdrop-blur-xl border border-[#2B3050] rounded-xl p-4 shadow-2xl space-y-3 z-30 animate-fadeIn font-mono text-xs text-[#8E94B8]">
          <div className="flex items-center justify-between text-white font-bold pb-2 border-b border-[#1C2036]">
            <span>Graph Physics & Mind Settings</span>
            <button onClick={() => setShowSettings(false)} className="text-[#6A7097] hover:text-white">✕</button>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span>Repulsion Force</span>
              <span className="text-white">{repulsion}</span>
            </div>
            <input
              type="range"
              min="50"
              max="400"
              value={repulsion}
              onChange={(e) => setRepulsion(parseInt(e.target.value))}
              className="w-full accent-[#615EFF]"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span>Link Distance</span>
              <span className="text-white">{linkDistance}px</span>
            </div>
            <input
              type="range"
              min="40"
              max="200"
              value={linkDistance}
              onChange={(e) => setLinkDistance(parseInt(e.target.value))}
              className="w-full accent-[#615EFF]"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span>Center Gravity</span>
              <span className="text-white">{gravity.toFixed(3)}</span>
            </div>
            <input
              type="range"
              min="0.005"
              max="0.1"
              step="0.005"
              value={gravity}
              onChange={(e) => setGravity(parseFloat(e.target.value))}
              className="w-full accent-[#615EFF]"
            />
          </div>

          <div className="pt-2 border-t border-[#1C2036] space-y-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span>Synapse Light Particles</span>
              <input
                type="checkbox"
                checked={showSynapseParticles}
                onChange={(e) => setShowSynapseParticles(e.target.checked)}
                className="accent-[#615EFF] rounded"
              />
            </label>

            <div className="flex items-center justify-between pt-1">
              <span>Layout Topology</span>
              <div className="flex gap-1">
                {(['force', 'radial'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setLayoutMode(mode)}
                    className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold transition ${
                      layoutMode === mode ? 'bg-[#615EFF] text-white' : 'bg-[#151728] text-[#8E94B8]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hovered Node Details Popover */}
      {hoveredNode && hoverPos && (
        <div 
          className="absolute z-40 max-w-xs bg-[#0B0D18]/95 backdrop-blur-md border border-[#2B3050] rounded-xl p-3.5 shadow-2xl pointer-events-none animate-fadeIn space-y-2"
          style={{ left: Math.min(hoverPos.x, (containerRef.current?.clientWidth || 600) - 280), top: hoverPos.y }}
        >
          <div className="flex items-center gap-2">
            <span 
              className="w-2.5 h-2.5 rounded-full" 
              style={{ backgroundColor: hoveredNode.color }} 
            />
            <h4 className="text-xs font-bold text-white truncate">
              {hoveredNode.name}
            </h4>
          </div>

          <div className="text-[10px] font-mono text-[#8E94B8] flex items-center gap-2">
            <span className="uppercase">{hoveredNode.type}</span>
            <span>•</span>
            <span>{hoveredNode.degree} Synaptic Links</span>
          </div>

          {hoveredNode.type === 'note' && hoveredNode.data && (
            <>
              <p className="text-[11px] text-[#C0C5DE] line-clamp-2 font-mono">
                {hoveredNode.data.content.replace(/[#*`_]/g, '')}
              </p>
              {hoveredNode.data.wikilinks?.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {hoveredNode.data.wikilinks.slice(0, 3).map((w: string, i: number) => (
                    <span key={i} className="text-[9px] font-mono text-[#8C8AFF] bg-[#615EFF]/10 px-1 py-0.2 rounded border border-[#615EFF]/20">
                      [[{w}]]
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {hoveredNode.type === 'model' && hoveredNode.data && (
            <p className="text-[11px] text-[#C0C5DE] font-mono">
              Specialty: {hoveredNode.data.specialty}
            </p>
          )}
        </div>
      )}

      {/* Bottom Live Mind Telemetry Overlay */}
      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        <div className="bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] px-3 py-1.5 rounded-xl flex items-center gap-3 text-[11px] font-mono text-[#8E94B8] pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#00D26A] animate-pulse" />
            <span className="text-white font-bold">MIND GRAPH ACTIVE</span>
          </div>
          <span>•</span>
          <span>{notes.length} Notes</span>
          <span>•</span>
          <span>{vaults.length} Vaults</span>
          <span>•</span>
          <span>7 AI Engines</span>
        </div>

        <div className="bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] px-3 py-1.5 rounded-xl flex items-center gap-2 text-[10px] font-mono text-[#7E85A8] pointer-events-auto">
          <span>Scroll to Zoom</span>
          <span>•</span>
          <span>Drag to Pan / Move Nodes</span>
          <span>•</span>
          <span>Click to Inspect</span>
        </div>
      </div>
    </div>
  );
};
