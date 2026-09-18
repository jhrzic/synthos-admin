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
  // 'source' is an EXTERNAL vault note: read-only material the operator wrote,
  // outside the SynthOS/ subtree, and NOT admitted Brain knowledge. Kept as a
  // distinct type rather than a flag on 'note' so that every place which
  // switches on type has to decide what to do with it — a boolean would have
  // been silently ignored by the draw code and rendered identical to knowledge.
  type: 'note' | 'model' | 'tag' | 'vault' | 'source';
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

/** An external vault note, as /api/brain/sources projects it. */
export interface ExternalSourceNodeInput {
  vaultRelativePath: string;
  title: string;
  folder: string;
  wikilinks: string[];
}

/** A source-authored [[wikilink]] edge. The only external relationship drawn. */
export interface ExternalSourceEdgeInput {
  source: string;
  target: string;
}

interface ObsidianGraphMindProps {
  notes: ObsidianNote[];
  vaults: ObsidianVault[];
  models: Record<string, AIModelInfo>;
  /** External source layer. Absent or empty renders exactly as before. */
  externalSources?: ExternalSourceNodeInput[];
  externalEdges?: ExternalSourceEdgeInput[];
  /** Selecting an external source node. Separate from onSelectNote by design. */
  onSelectSource?: (vaultRelativePath: string) => void;
  selectedNoteId?: string;
  onSelectNote?: (noteId: string) => void;
  onOpenNote?: (noteId: string) => void;
  height?: number | string;
}

export const ObsidianGraphMind: React.FC<ObsidianGraphMindProps> = ({
  notes,
  vaults,
  models,
  externalSources = [],
  externalEdges = [],
  onSelectSource,
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

  // Motion policy. Reduced motion: the layout is settled once and drawn as a
  // still frame — no particles, no bursts, no running loop. The loop also
  // stops while the tab is hidden or the graph is scrolled off-screen, and
  // resumes when it is visible again, so it never burns CPU/GPU unseen.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  const [isPageHidden, setIsPageHidden] = useState<boolean>(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [isOffscreen, setIsOffscreen] = useState(false);
  const [canvasUnsupported, setCanvasUnsupported] = useState(false);
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    const onMq = () => setPrefersReducedMotion(!!mq?.matches);
    mq?.addEventListener?.('change', onMq);
    const onVis = () => setIsPageHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && containerRef.current) {
      io = new IntersectionObserver((entries) => setIsOffscreen(!entries.some((e) => e.isIntersecting)));
      io.observe(containerRef.current);
    }
    return () => { mq?.removeEventListener?.('change', onMq); document.removeEventListener('visibilitychange', onVis); io?.disconnect(); };
  }, []);
  const animate = !prefersReducedMotion && !isPageHidden && !isOffscreen;
  const settledRef = useRef(false);

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

    // 2. AI Model Synapses — ONLY models a real note actually came from.
    //
    // THE TRUTH DEFECT THIS FIXES, visible in the live Admin before the change:
    // this loop ran over the WHOLE model registry unconditionally, so a Brain
    // holding one note rendered twelve model nodes around it — ElevenLabs,
    // Perplexity, Cursor, Codex, OpenClaw and others, most of which this build
    // cannot execute at all. The graph looked populated while the knowledge in
    // it was a single note, which is exactly the "rich graphics, fake data"
    // failure the non-demo rule exists to prevent.
    //
    // A model now earns a node by being named in a note's own frontmatter
    // `model:` field — a canonical provenance relationship, recorded by
    // whichever run produced the note. Not a substring guess, and not the
    // roster. With no notes attributed to a model, there are no model nodes,
    // and the graph is honestly sparse.
    const referencedModelKeys = new Set<string>();
    notes.forEach((n) => {
      const noteModel = (n as { model?: string }).model;
      if (!noteModel) return;
      const wanted = String(noteModel).toLowerCase();
      // Match a registry entry by its key or its display name, so a note
      // recording "gpt-5.6-terra" links to the OpenAI entry it really used.
      Object.entries(models).forEach(([key, model]) => {
        const name = String(model?.name || '').toLowerCase();
        if (wanted === key.toLowerCase() || wanted.includes(key.toLowerCase()) || (name && wanted.includes(name))) {
          referencedModelKeys.add(key);
        }
      });
    });

    const referencedModels = Object.entries(models).filter(([key]) => referencedModelKeys.has(key));
    referencedModels.forEach(([key, model], i) => {
      const angle = (i / Math.max(1, referencedModels.length)) * Math.PI * 2;
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

      // Link to the model that actually PRODUCED this note.
      //
      // Previously this drew an edge whenever a note's body happened to
      // contain a model key as a substring — so a note merely discussing
      // "claude" acquired a provenance edge to Claude. That is inference
      // dressed as provenance, and the canonical answer was already in the
      // note: its frontmatter `model:` field, written by the run itself.
      const producedBy = (n as { model?: string }).model;
      if (producedBy) {
        const wanted = String(producedBy).toLowerCase();
        Object.entries(models).forEach(([mKey, m]) => {
          if (!referencedModelKeys.has(mKey)) return;
          const name = String(m?.name || '').toLowerCase();
          if (wanted === mKey.toLowerCase() || wanted.includes(mKey.toLowerCase()) || (name && wanted.includes(name))) {
            linkList.push({
              source: `model-${mKey}`,
              target: n.id,
              color: 'rgba(234, 179, 8, 0.25)',
            });
          }
        });
      }
    });

    // 3b. EXTERNAL SOURCE NODES — visually distinct, never mixed with knowledge.
    //
    // Steel (#7E8BB5) and a smaller radius, deliberately: the palette already
    // means "inert / unknown / no data" with that colour, which is the right
    // register for material SynthOS has observed but not admitted. Canonical
    // knowledge keeps its violet/accent treatment, so the two classes are
    // distinguishable at a glance rather than by clicking each node.
    //
    // No relationship is invented here. Edges come only from externalEdges,
    // which lib/brain-sources.ts builds from [[wikilinks]] the AUTHOR wrote.
    externalSources.forEach((src, i) => {
      const ring = 320 + (i % 3) * 46;
      const angle = (i / Math.max(1, externalSources.length)) * Math.PI * 2;
      nodeMap.set(`source-${src.vaultRelativePath}`, {
        id: `source-${src.vaultRelativePath}`,
        name: src.title,
        type: 'source',
        color: '#7E8BB5',
        radius: 5 + Math.min(4, (src.wikilinks?.length || 0)),
        x: Math.cos(angle) * ring,
        y: Math.sin(angle) * ring,
        vx: 0,
        vy: 0,
        degree: 0,
        data: { ...src, classification: 'EXTERNAL_SOURCE', admission: 'UNADMITTED' },
      });
    });

    // 3c. Source-authored wikilink edges between external notes.
    externalEdges.forEach((e) => {
      const a = `source-${e.source}`;
      const b = `source-${e.target}`;
      if (!nodeMap.has(a) || !nodeMap.has(b)) return;
      linkList.push({
        source: a,
        target: b,
        // Dimmer than knowledge edges: a real relationship between
        // unadmitted material.
        color: 'rgba(126, 139, 181, 0.28)',
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
  }, [notes, vaults, models, externalSources, externalEdges]);

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

  // A content key for the graph data (stable across renders with equal data):
  // new data re-settles and repaints even while the loop is paused or motion
  // is reduced, so a still frame is never stale.
  const graphDataKey = useMemo(() => `${initialNodes.map((n) => n.id).join('|')}#${initialLinks.map((l) => `${l.source}>${l.target}`).join('|')}`, [initialNodes, initialLinks]);
  const lastDataKeyRef = useRef('');

  // Handle Canvas Resize & Simulation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
    if (!ctx) { setCanvasUnsupported(true); return; }
    const g = ctx;

    let animationFrameId = 0;
    let stopped = false;
    let ready = false;

    const resize = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      // setTransform, not scale: scale() compounded on every resize.
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!animate && ready) paintStill();
    };

    // The container is observed directly (window resize misses fullscreen
    // and layout changes).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
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
      // The original loop did `if (!container) return;` here — WITHOUT
      // scheduling another frame. A single frame where the ref is momentarily
      // null (a remount, or a queued callback landing after React clears the
      // ref) therefore killed the animation permanently: the graph stayed on
      // screen, frozen, because the last painted frame was never cleared.
      // The loop now always re-arms and simply skips painting a frame it
      // cannot measure, so it heals instead of dying.
      if (!container || container.clientWidth === 0 || container.clientHeight === 0) {
        if (animate && !stopped) animationFrameId = requestAnimationFrame(render);
        return;
      }
      const width = container.clientWidth;
      const height = container.clientHeight;

      g.clearRect(0, 0, width, height);

      // Save context for camera transform
      g.save();
      g.translate(transformRef.current.x, transformRef.current.y);
      g.scale(transformRef.current.k, transformRef.current.k);

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
      g.strokeStyle = 'rgba(30, 33, 56, 0.25)';
      g.lineWidth = 1;
      const gridSize = 80;
      const minX = -1200;
      const maxX = 1200;
      const minY = -1200;
      const maxY = 1200;

      for (let gx = minX; gx <= maxX; gx += gridSize) {
        g.beginPath();
        g.moveTo(gx, minY);
        g.lineTo(gx, maxY);
        g.stroke();
      }
      for (let gy = minY; gy <= maxY; gy += gridSize) {
        g.beginPath();
        g.moveTo(minX, gy);
        g.lineTo(maxX, gy);
        g.stroke();
      }

      // Periodic Wave Rings from Hubs
      if (animate && Date.now() - lastWaveTime > 2400) {
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

        g.save();
        g.beginPath();
        g.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        g.strokeStyle = ring.color;
        g.globalAlpha = Math.max(0, ring.alpha * 0.4);
        g.lineWidth = 1.5;
        g.stroke();
        g.restore();
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

        g.save();
        g.beginPath();
        g.moveTo(source.x, source.y);
        g.lineTo(target.x, target.y);

        if (isHighlighted || isSelected) {
          g.strokeStyle = '#615EFF';
          g.lineWidth = 2.2;
          g.globalAlpha = 0.9;
          g.shadowColor = '#615EFF';
          g.shadowBlur = 8;
        } else {
          g.strokeStyle = link.color || 'rgba(97, 94, 255, 0.18)';
          g.lineWidth = 1;
          g.globalAlpha = isSourceVisible && isTargetVisible ? 0.35 : 0.08;
        }

        g.stroke();
        g.restore();
      }

      // 2. Draw Synapse Particles traveling along edges
      if (animate && showSynapseParticles && particlesRef.current.length > 0) {
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

          g.save();
          g.beginPath();
          g.arc(px, py, 2.2, 0, Math.PI * 2);
          g.fillStyle = p.color;
          g.shadowColor = p.color;
          g.shadowBlur = 6;
          g.fill();
          g.restore();
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

        g.save();
        g.globalAlpha = isVisible ? 1 : 0.18;

        // Glowing outer halo
        if (isHovered || isSelected || isNeighbor) {
          g.beginPath();
          g.arc(node.x, node.y, node.radius + (isHovered ? 8 : 4), 0, Math.PI * 2);
          g.fillStyle = node.color;
          g.globalAlpha = 0.25;
          g.shadowColor = node.color;
          g.shadowBlur = 16;
          g.fill();
          g.globalAlpha = 1;
        }

        // Inner solid circle
        g.beginPath();
        g.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        g.fillStyle = node.color;
        g.shadowColor = node.color;
        g.shadowBlur = isHovered || isSelected ? 12 : 4;
        g.fill();

        // Node border
        g.strokeStyle = isSelected ? '#FFFFFF' : '#0B0D18';
        g.lineWidth = isSelected ? 2.5 : 1.5;
        g.stroke();

        // Node label
        if (node.radius >= 9 || isHovered || isSelected || isNeighbor || node.degree > 3) {
          g.font = `${isHovered || isSelected ? '600 11px' : '500 10px'} 'Plus Jakarta Sans', sans-serif`;
          g.fillStyle = isHovered || isSelected ? '#FFFFFF' : '#B2B7D6';
          g.textAlign = 'center';
          g.textBaseline = 'top';
          g.fillText(node.name, node.x, node.y + node.radius + 4);
        }

        g.restore();
      }

      g.restore();

      if (animate && !stopped) animationFrameId = requestAnimationFrame(render);
    };

    // A still frame: settle the layout once (bounded), then paint.
    function paintStill() {
      if (!settledRef.current) { for (let i = 0; i < 160; i++) render(); settledRef.current = true; }
      else render();
    }

    if (lastDataKeyRef.current !== graphDataKey) { lastDataKeyRef.current = graphDataKey; settledRef.current = false; }
    ready = true;
    resize();
    if (animate) render();
    else paintStill();

    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      ro?.disconnect();
    };
  }, [
    isSimulating, repulsion, linkDistance, gravity, 
    particleSpeed, showSynapseParticles, searchTerm, 
    selectedTagFilter, selectedFolderFilter, layoutMode, 
    selectedNoteId, hoveredNode, animate, graphDataKey
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
      if (node.type === 'source' && onSelectSource) {
        // Routed separately so a source can never be handed to a knowledge
        // detail view that would present it as admitted.
        onSelectSource(String((node.data as { vaultRelativePath?: string })?.vaultRelativePath || ''));
        return;
      }
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
      data-testid="obsidian-graph-mind"
      data-motion={canvasUnsupported ? 'static-fallback' : animate ? 'animating' : prefersReducedMotion ? 'reduced-motion' : 'paused'}
    >
      {canvasUnsupported && (
        <div className="absolute inset-0 z-10 p-4 overflow-y-auto text-xs text-[#C9CCE6]" data-testid="obsidian-graph-static-fallback">
          <div className="text-white font-bold mb-1">Knowledge graph (static view)</div>
          <div className="text-[#8E94B8] mb-2">This browser cannot draw the graph canvas. {initialNodes.length} nodes and {initialLinks.length} links, listed by connections:</div>
          <ul className="space-y-0.5">
            {[...initialNodes].sort((a, b) => b.degree - a.degree).slice(0, 40).map((n) => (
              <li key={n.id}><span style={{ color: n.color }}>●</span> {n.name} <span className="text-[#6A7097]">· {n.type} · {n.degree} links</span></li>
            ))}
          </ul>
        </div>
      )}
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
          {/* Counts derived from the graph that is actually on screen.
              A hardcoded engine total used to sit here — a literal that
              reported the same figure whatever the registry held, and which
              after model nodes were restricted to real provenance would have
              reported it while drawing none. A number presented as a count
              has to be counted. */}
          <span>{notes.length} Notes</span>
          <span>•</span>
          <span>{vaults.length} Vaults</span>
          {externalSources.length > 0 && (
            <>
              <span>•</span>
              <span style={{ color: '#7E8BB5' }}>{externalSources.length} External Sources</span>
            </>
          )}
          {externalEdges.length > 0 && (
            <>
              <span>•</span>
              <span style={{ color: '#7E8BB5' }}>{externalEdges.length} Wikilink Edges</span>
            </>
          )}
          <span>•</span>
          <span>{initialNodes.filter((n) => n.type === 'model').length} Model Nodes</span>
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
