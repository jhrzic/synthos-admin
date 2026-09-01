import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  KanbanTask, 
  AgentRole 
} from '../types';
import { 
  GitMerge, 
  Sparkles, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Play, 
  ArrowRight, 
  Layers, 
  Maximize2, 
  Minimize2, 
  Eye, 
  Link2, 
  Unlink, 
  Bot, 
  Activity, 
  Search, 
  ChevronRight,
  Filter,
  Check,
  Compass,
  Cpu,
  Flame
} from 'lucide-react';

export interface CriticalPathAnalysis {
  tasksMap: Map<string, KanbanTask>;
  criticalTaskIds: Set<string>;
  criticalEdgeKeys: Set<string>; // "sourceId->targetId"
  criticalPathSequence: string[];
  totalCriticalDurationHours: number;
  bottleneckTask: KanbanTask | null;
  taskStats: Map<string, {
    duration: number;
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    slack: number;
    isCritical: boolean;
    layer: number;
    predecessors: string[];
    successors: string[];
  }>;
  layers: string[][];
  parallelEfficiencyPercent: number;
}

// Parse hours from string like '3.0h', '2.5', or default to 2.0
export function parseDurationHours(durationStr?: string): number {
  if (!durationStr) return 2.0;
  const match = durationStr.match(/([\d.]+)/);
  if (!match) return 2.0;
  const val = parseFloat(match[1]);
  return isNaN(val) ? 2.0 : val;
}

// Critical Path Method (CPM) calculation
export function computeCriticalPathAnalysis(tasks: KanbanTask[]): CriticalPathAnalysis {
  const tasksMap = new Map<string, KanbanTask>();
  tasks.forEach(t => tasksMap.set(t.id, t));

  const predecessorsMap = new Map<string, string[]>();
  const successorsMap = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  tasks.forEach(t => {
    predecessorsMap.set(t.id, []);
    successorsMap.set(t.id, []);
    inDegree.set(t.id, 0);
  });

  tasks.forEach(t => {
    const deps = t.dependencies || [];
    deps.forEach(depId => {
      if (tasksMap.has(depId)) {
        predecessorsMap.get(t.id)!.push(depId);
        successorsMap.get(depId)!.push(t.id);
        inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
      }
    });
  });

  // Kahn's Algorithm for Topological Sort & Layer assignment
  const zeroInDegreeQueue: string[] = [];
  const inDegreeCopy = new Map(inDegree);
  const layersMap = new Map<string, number>();

  tasks.forEach(t => {
    if ((inDegreeCopy.get(t.id) || 0) === 0) {
      zeroInDegreeQueue.push(t.id);
      layersMap.set(t.id, 0);
    }
  });

  const topoOrder: string[] = [];
  while (zeroInDegreeQueue.length > 0) {
    const u = zeroInDegreeQueue.shift()!;
    topoOrder.push(u);
    const uLayer = layersMap.get(u) || 0;

    const succs = successorsMap.get(u) || [];
    succs.forEach(v => {
      const curLayer = layersMap.get(v) || 0;
      layersMap.set(v, Math.max(curLayer, uLayer + 1));

      const newDeg = (inDegreeCopy.get(v) || 0) - 1;
      inDegreeCopy.set(v, newDeg);
      if (newDeg === 0) {
        zeroInDegreeQueue.push(v);
      }
    });
  }

  // If there's any cycle or unreached node, append remaining
  tasks.forEach(t => {
    if (!topoOrder.includes(t.id)) {
      topoOrder.push(t.id);
      layersMap.set(t.id, 0);
    }
  });

  // Forward Pass: Early Start (ES) and Early Finish (EF)
  const es = new Map<string, number>();
  const ef = new Map<string, number>();

  topoOrder.forEach(u => {
    const preds = predecessorsMap.get(u) || [];
    let maxPredEF = 0;
    preds.forEach(p => {
      const pEF = ef.get(p) || 0;
      if (pEF > maxPredEF) maxPredEF = pEF;
    });

    const duration = parseDurationHours(tasksMap.get(u)?.estimatedHours);
    const earlyStart = maxPredEF;
    const earlyFinish = earlyStart + duration;

    es.set(u, earlyStart);
    ef.set(u, earlyFinish);
  });

  // Project Total Duration
  let totalProjectDuration = 0;
  tasks.forEach(t => {
    const taskEF = ef.get(t.id) || 0;
    if (taskEF > totalProjectDuration) totalProjectDuration = taskEF;
  });

  // Backward Pass: Late Start (LS) and Late Finish (LF)
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();

  // Reverse topological order
  const reverseTopo = [...topoOrder].reverse();
  reverseTopo.forEach(u => {
    const succs = successorsMap.get(u) || [];
    let minSuccLS = totalProjectDuration;

    if (succs.length > 0) {
      succs.forEach(s => {
        const sLS = ls.get(s) ?? totalProjectDuration;
        if (sLS < minSuccLS) minSuccLS = sLS;
      });
    }

    const duration = parseDurationHours(tasksMap.get(u)?.estimatedHours);
    const lateFinish = minSuccLS;
    const lateStart = lateFinish - duration;

    lf.set(u, lateFinish);
    ls.set(u, lateStart);
  });

  // Identify Critical Tasks and Edges
  const criticalTaskIds = new Set<string>();
  const criticalEdgeKeys = new Set<string>();
  const taskStats = new Map<string, {
    duration: number;
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    slack: number;
    isCritical: boolean;
    layer: number;
    predecessors: string[];
    successors: string[];
  }>();

  let maxDurationOnCritical = -1;
  let bottleneckTask: KanbanTask | null = null;

  tasks.forEach(t => {
    const earlyStart = es.get(t.id) || 0;
    const earlyFinish = ef.get(t.id) || 0;
    const lateStart = ls.get(t.id) || 0;
    const lateFinish = lf.get(t.id) || 0;
    const slack = Math.max(0, Math.round((lateStart - earlyStart) * 100) / 100);
    const isCritical = slack <= 0.05 && totalProjectDuration > 0;
    const duration = parseDurationHours(t.estimatedHours);

    if (isCritical) {
      criticalTaskIds.add(t.id);
      if (duration > maxDurationOnCritical) {
        maxDurationOnCritical = duration;
        bottleneckTask = t;
      }
    }

    taskStats.set(t.id, {
      duration,
      earlyStart,
      earlyFinish,
      lateStart,
      lateFinish,
      slack,
      isCritical,
      layer: layersMap.get(t.id) || 0,
      predecessors: predecessorsMap.get(t.id) || [],
      successors: successorsMap.get(t.id) || []
    });
  });

  // Mark critical edges
  tasks.forEach(t => {
    const preds = predecessorsMap.get(t.id) || [];
    preds.forEach(pId => {
      if (criticalTaskIds.has(pId) && criticalTaskIds.has(t.id)) {
        const pEF = ef.get(pId) || 0;
        const tES = es.get(t.id) || 0;
        // If predecessor early finish equals task early start
        if (Math.abs(pEF - tES) <= 0.05) {
          criticalEdgeKeys.add(`${pId}->${t.id}`);
        }
      }
    });
  });

  // Extract ordered critical path sequence
  const criticalSequence = topoOrder.filter(id => criticalTaskIds.has(id));

  // Organize tasks by layers
  const maxLayer = Math.max(0, ...Array.from(layersMap.values()));
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  tasks.forEach(t => {
    const l = layersMap.get(t.id) || 0;
    layers[l].push(t.id);
  });

  // Calculate parallel efficiency
  const totalWorkHours = tasks.reduce((sum, t) => sum + parseDurationHours(t.estimatedHours), 0);
  const parallelEfficiencyPercent = totalWorkHours > 0 && totalProjectDuration > 0
    ? Math.min(100, Math.round(((totalWorkHours - totalProjectDuration) / totalWorkHours) * 100))
    : 0;

  return {
    tasksMap,
    criticalTaskIds,
    criticalEdgeKeys,
    criticalPathSequence: criticalSequence,
    totalCriticalDurationHours: totalProjectDuration,
    bottleneckTask,
    taskStats,
    layers,
    parallelEfficiencyPercent
  };
}

interface KanbanDependencyDAGProps {
  tasks: KanbanTask[];
  onSelectTask?: (task: KanbanTask) => void;
  onUpdateDependencies?: (taskId: string, newDependencies: string[]) => void;
  onRunTask?: (taskId: string) => void;
  highlightedTaskId?: string | null;
  onHighlightTask?: (taskId: string | null) => void;
}

export const KanbanDependencyDAG: React.FC<KanbanDependencyDAGProps> = ({
  tasks,
  onSelectTask,
  onUpdateDependencies,
  onRunTask,
  highlightedTaskId,
  onHighlightTask
}) => {
  const [selectedTaskForLinking, setSelectedTaskForLinking] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'critical' | 'active'>('all');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLinkingMode, setIsLinkingMode] = useState<boolean>(false);
  const [hoveredEdge, setHoveredEdge] = useState<{ sourceId: string; targetId: string } | null>(null);

  // Compute Critical Path analysis
  const cpm = useMemo(() => computeCriticalPathAnalysis(tasks), [tasks]);

  // Filter tasks based on settings
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (filterMode === 'critical' && !cpm.criticalTaskIds.has(task.id)) return false;
      if (filterMode === 'active' && task.column === 'done') return false;
      if (activeCategory !== 'all' && task.category !== activeCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          task.title.toLowerCase().includes(q) ||
          task.assignedAgent.toLowerCase().includes(q) ||
          (task.assignedModel && task.assignedModel.toLowerCase().includes(q)) ||
          task.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tasks, filterMode, activeCategory, searchQuery, cpm]);

  // Handler to toggle dependency link between two tasks
  const handleToggleLink = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const targetTask = cpm.tasksMap.get(targetId);
    if (!targetTask || !onUpdateDependencies) return;

    const currentDeps = targetTask.dependencies || [];
    let updatedDeps: string[];

    if (currentDeps.includes(sourceId)) {
      // Remove dependency
      updatedDeps = currentDeps.filter(id => id !== sourceId);
    } else {
      // Add dependency
      updatedDeps = [...currentDeps, sourceId];
    }

    onUpdateDependencies(targetId, updatedDeps);
    setSelectedTaskForLinking(null);
  };

  // Agent role badge color
  const getAgentColor = (role: AgentRole) => {
    switch (role) {
      case 'orchestrator': return { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/40', glow: 'shadow-purple-500/20' };
      case 'scout': return { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/40', glow: 'shadow-blue-500/20' };
      case 'scribe': return { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/40', glow: 'shadow-emerald-500/20' };
      case 'reach': return { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/40', glow: 'shadow-orange-500/20' };
      case 'dev': return { bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/40', glow: 'shadow-indigo-500/20' };
      case 'analytics': return { bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/40', glow: 'shadow-cyan-500/20' };
      default: return { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/40', glow: 'shadow-gray-500/20' };
    }
  };

  const getStatusBadge = (column: string) => {
    switch (column) {
      case 'done':
        return <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle2 className="w-3 h-3" /> Done</span>;
      case 'blocked':
        return <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20"><AlertTriangle className="w-3 h-3" /> Blocked</span>;
      case 'running':
      case 'in-progress':
        return <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20"><Play className="w-3 h-3 animate-spin" /> Running</span>;
      case 'ready':
      case 'review':
        return <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"><Activity className="w-3 h-3 animate-pulse" /> Ready</span>;
      case 'todo':
        return <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"><Clock className="w-3 h-3" /> Todo</span>;
      case 'triage':
      case 'backlog':
      default:
        return <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20"><Sparkles className="w-3 h-3" /> Triage</span>;
    }
  };

  return (
    <div className="w-full bg-[#05060C] border border-[#181C38] rounded-2xl p-4 md:p-6 space-y-6 shadow-2xl relative overflow-hidden">
      {/* Background glow mesh */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#615EFF]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#F59E0B]/10 rounded-full blur-3xl pointer-events-none" />

      {/* HEADER: CRITICAL PATH TELEMETRY BANNER */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 rounded-xl bg-[#0B0D1B] border border-[#21264E]">
        {/* Metric 1: Critical Path Total Lead Time */}
        <div className="flex items-center gap-3.5 p-3 rounded-lg bg-[#0E1226] border border-[#1A1F3F]">
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-lg shadow-amber-500/10">
            <Flame className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase text-[#8E94B8] tracking-wider">Critical Path Time</div>
            <div className="text-xl font-bold text-white font-['Space_Grotesk'] flex items-center gap-2">
              <span>{cpm.totalCriticalDurationHours.toFixed(1)}h</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {cpm.criticalTaskIds.size} Tasks
              </span>
            </div>
          </div>
        </div>

        {/* Metric 2: Primary Bottleneck */}
        <div className="flex items-center gap-3.5 p-3 rounded-lg bg-[#0E1226] border border-[#1A1F3F]">
          <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="overflow-hidden">
            <div className="text-[11px] font-mono uppercase text-[#8E94B8] tracking-wider">Critical Bottleneck</div>
            <div className="text-sm font-bold text-white truncate font-['Space_Grotesk']">
              {cpm.bottleneckTask ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-rose-400">[{cpm.bottleneckTask.assignedAgent.toUpperCase()}]</span>
                  <span className="truncate">{cpm.bottleneckTask.title}</span>
                  <span className="text-[10px] font-mono text-[#8E94B8]">({cpm.bottleneckTask.estimatedHours})</span>
                </span>
              ) : (
                <span className="text-gray-400">None detected</span>
              )}
            </div>
          </div>
        </div>

        {/* Metric 3: Parallelization Factor */}
        <div className="flex items-center gap-3.5 p-3 rounded-lg bg-[#0E1226] border border-[#1A1F3F]">
          <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase text-[#8E94B8] tracking-wider">Concurrency Efficiency</div>
            <div className="text-xl font-bold text-white font-['Space_Grotesk'] flex items-center gap-2">
              <span>{cpm.parallelEfficiencyPercent}%</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {cpm.layers.length} Stages
              </span>
            </div>
          </div>
        </div>

        {/* Metric 4: CPM Slack & Zero Float */}
        <div className="flex items-center gap-3.5 p-3 rounded-lg bg-[#0E1226] border border-[#1A1F3F]">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase text-[#8E94B8] tracking-wider">Zero Slack Tasks</div>
            <div className="text-xl font-bold text-white font-['Space_Grotesk'] flex items-center gap-2">
              <span>{cpm.criticalTaskIds.size}</span>
              <span className="text-[10px] font-mono text-[#8E94B8]">
                of {tasks.length} total tasks
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* TOOLBAR CONTROLS */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter Mode */}
          <div className="flex items-center bg-[#0C0E1E] p-1 rounded-xl border border-[#1D2244]">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 text-xs font-mono rounded-lg transition ${
                filterMode === 'all'
                  ? 'bg-[#615EFF] text-white font-bold shadow'
                  : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              All DAG Nodes ({tasks.length})
            </button>
            <button
              onClick={() => setFilterMode('critical')}
              className={`px-3 py-1.5 text-xs font-mono rounded-lg transition flex items-center gap-1.5 ${
                filterMode === 'critical'
                  ? 'bg-amber-500 text-black font-bold shadow-lg shadow-amber-500/25'
                  : 'text-amber-400 hover:text-amber-300'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Critical Path Only ({cpm.criticalTaskIds.size})</span>
            </button>
            <button
              onClick={() => setFilterMode('active')}
              className={`px-3 py-1.5 text-xs font-mono rounded-lg transition ${
                filterMode === 'active'
                  ? 'bg-[#1E2548] text-white font-bold'
                  : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              Active Pipeline
            </button>
          </div>

          {/* Interactive Link Mode Toggle */}
          {onUpdateDependencies && (
            <button
              onClick={() => {
                setIsLinkingMode(!isLinkingMode);
                setSelectedTaskForLinking(null);
              }}
              className={`px-3 py-1.5 text-xs font-mono rounded-xl border transition flex items-center gap-1.5 ${
                isLinkingMode
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                  : 'bg-[#0C0E1E] text-[#8E94B8] border-[#1D2244] hover:text-white'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{isLinkingMode ? 'Connecting Mode Active' : 'Edit Dependencies'}</span>
            </button>
          )}
        </div>

        {/* Search & Reset */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#646A94]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search DAG by agent, tag, title..."
              className="bg-[#0A0C1A] border border-[#1D2244] rounded-xl pl-9 pr-3 py-1.5 text-xs font-mono text-white placeholder-[#585E86] focus:outline-none focus:border-[#615EFF] w-48 md:w-64"
            />
          </div>

          {highlightedTaskId && (
            <button
              onClick={() => onHighlightTask?.(null)}
              className="px-2.5 py-1.5 text-xs font-mono text-gray-400 hover:text-white bg-[#121528] rounded-xl border border-[#202548]"
            >
              Clear Focus
            </button>
          )}
        </div>
      </div>

      {/* LINKING INSTRUCTIONS BANNER */}
      {isLinkingMode && (
        <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 animate-bounce" />
            <span>
              {selectedTaskForLinking
                ? `Selected Source: "${cpm.tasksMap.get(selectedTaskForLinking)?.title}". Click any target task card below to Toggle (Add / Remove) dependency line.`
                : 'Click any task to select it as the PREREQUISITE (Source), then click the DEPENDENT task (Target).'}
            </span>
          </div>
          {selectedTaskForLinking && (
            <button
              onClick={() => setSelectedTaskForLinking(null)}
              className="px-2 py-0.5 rounded bg-emerald-800/50 hover:bg-emerald-700 text-white text-[11px]"
            >
              Deselect
            </button>
          )}
        </div>
      )}

      {/* TOPOLOGICAL STAGES DAG CANVAS */}
      <div className="space-y-6 overflow-x-auto pb-4">
        {/* Visual Topological Pipeline Flow */}
        <div className="min-w-[900px] space-y-6">
          {cpm.layers.map((layerTaskIds, layerIdx) => {
            const layerTasks = layerTaskIds
              .map(id => cpm.tasksMap.get(id))
              .filter((t): t is KanbanTask => !!t && filteredTasks.some(ft => ft.id === t.id));

            if (layerTasks.length === 0) return null;

            return (
              <div key={layerIdx} className="relative space-y-3">
                {/* Stage Header */}
                <div className="flex items-center justify-between bg-[#0B0D1D] px-4 py-2 rounded-xl border border-[#1A1F3E]">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-[#615EFF]/20 border border-[#615EFF]/40 text-[#A299FF] text-xs font-mono font-bold flex items-center justify-center">
                      {layerIdx + 1}
                    </span>
                    <span className="text-xs font-mono font-bold text-white tracking-wide">
                      STAGE {layerIdx + 1}: {layerIdx === 0 ? 'Root Ingestion & Scraping' : layerIdx === cpm.layers.length - 1 ? 'Terminal Synthesis & Sign-off' : `Execution Depth ${layerIdx}`}
                    </span>
                    <span className="text-[11px] font-mono text-[#8E94B8]">
                      ({layerTasks.length} parallelizable {layerTasks.length === 1 ? 'task' : 'tasks'})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#6A719C]">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      Cumulative ES: {Math.min(...layerTasks.map(t => cpm.taskStats.get(t.id)?.earlyStart || 0)).toFixed(1)}h
                    </span>
                  </div>
                </div>

                {/* Node Cards in this Stage */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4 border-l-2 border-[#1E2346]">
                  {layerTasks.map(task => {
                    const stats = cpm.taskStats.get(task.id);
                    const isCritical = cpm.criticalTaskIds.has(task.id);
                    const agentStyle = getAgentColor(task.assignedAgent);
                    const isHighlighted = highlightedTaskId === task.id;
                    const isLinkingSource = selectedTaskForLinking === task.id;

                    // Check if this card is prerequisite or dependent of highlighted task
                    const isPrereqOfHighlighted = highlightedTaskId && stats?.successors.includes(highlightedTaskId);
                    const isDependentOfHighlighted = highlightedTaskId && stats?.predecessors.includes(highlightedTaskId);

                    return (
                      <div
                        key={task.id}
                        data-dag-node-id={task.id}
                        onClick={() => {
                          if (isLinkingMode) {
                            if (!selectedTaskForLinking) {
                              setSelectedTaskForLinking(task.id);
                            } else {
                              handleToggleLink(selectedTaskForLinking, task.id);
                            }
                          } else {
                            onHighlightTask?.(isHighlighted ? null : task.id);
                          }
                        }}
                        className={`group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                          isCritical
                            ? 'bg-[#100F1D] border-amber-500/60 shadow-lg shadow-amber-500/10'
                            : 'bg-[#090B18] border-[#1E2344] hover:border-[#615EFF]'
                        } ${
                          isHighlighted
                            ? 'ring-2 ring-[#615EFF] border-transparent shadow-xl shadow-[#615EFF]/20'
                            : ''
                        } ${
                          isLinkingSource
                            ? 'ring-2 ring-emerald-400 bg-emerald-950/20'
                            : ''
                        } ${
                          isPrereqOfHighlighted
                            ? 'border-cyan-400 bg-cyan-950/20'
                            : ''
                        } ${
                          isDependentOfHighlighted
                            ? 'border-purple-400 bg-purple-950/20'
                            : ''
                        }`}
                      >
                        {/* Critical Path Neon Ribbon */}
                        {isCritical && (
                          <div className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full bg-amber-500 text-black text-[9px] font-mono font-extrabold flex items-center gap-1 shadow-md shadow-amber-500/30 uppercase">
                            <Flame className="w-2.5 h-2.5" />
                            <span>Critical Path</span>
                          </div>
                        )}

                        {/* Top Meta Bar */}
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${agentStyle.bg} ${agentStyle.text} ${agentStyle.border}`}>
                              {task.assignedAgent}
                            </span>
                            {task.assignedModel && (
                              <span className="text-[10px] font-mono text-[#8E94B8] bg-[#121528] px-1.5 py-0.5 rounded border border-[#1E2344]">
                                {task.assignedModel}
                              </span>
                            )}
                          </div>
                          <div>
                            {getStatusBadge(task.column)}
                          </div>
                        </div>

                        {/* Title */}
                        <h4 className="text-xs font-bold text-white group-hover:text-[#A299FF] transition line-clamp-2 leading-relaxed">
                          {task.title}
                        </h4>

                        {/* Description snippet */}
                        <p className="text-[11px] text-[#767EAA] mt-1 line-clamp-2 leading-normal">
                          {task.description}
                        </p>

                        {/* Dependencies and Blockers Badges */}
                        <div className="mt-3 pt-2.5 border-t border-[#161A36] space-y-2">
                          {/* Upstream Prerequisites */}
                          {stats && stats.predecessors.length > 0 ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-mono text-[#8E94B8] flex items-center gap-1">
                                <Link2 className="w-3 h-3 text-cyan-400" /> Prereqs:
                              </span>
                              {stats.predecessors.map(pId => {
                                const pTask = cpm.tasksMap.get(pId);
                                const isCritEdge = cpm.criticalEdgeKeys.has(`${pId}->${task.id}`);
                                return (
                                  <span
                                    key={pId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onHighlightTask?.(pId);
                                    }}
                                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition hover:scale-105 ${
                                      isCritEdge
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                        : 'bg-[#121630] text-cyan-300 border-[#202752]'
                                    }`}
                                    title={pTask?.title || pId}
                                  >
                                    [{pTask?.assignedAgent || 'task'}] {pId.replace('task-', '')}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-[10px] font-mono text-[#4F557E]">
                              • Root Entry Node (No prerequisites)
                            </span>
                          )}

                          {/* Downstream Successors / Blocked Tasks */}
                          {stats && stats.successors.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-mono text-[#8E94B8] flex items-center gap-1">
                                <ArrowRight className="w-3 h-3 text-purple-400" /> Blocks:
                              </span>
                              {stats.successors.map(sId => {
                                const sTask = cpm.tasksMap.get(sId);
                                const isCritEdge = cpm.criticalEdgeKeys.has(`${task.id}->${sId}`);
                                return (
                                  <span
                                    key={sId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onHighlightTask?.(sId);
                                    }}
                                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition hover:scale-105 ${
                                      isCritEdge
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                        : 'bg-[#151230] text-purple-300 border-[#2B2052]'
                                    }`}
                                    title={sTask?.title || sId}
                                  >
                                    [{sTask?.assignedAgent || 'task'}] {sId.replace('task-', '')}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Timing & Action Footer */}
                        <div className="mt-3 pt-2 border-t border-[#161A36] flex items-center justify-between text-[10px] font-mono">
                          <div className="text-[#8E94B8] flex items-center gap-2">
                            <span>Est: <strong className="text-white">{task.estimatedHours || '2.0h'}</strong></span>
                            <span>•</span>
                            <span>Slack: <strong className={stats?.slack === 0 ? 'text-amber-400' : 'text-emerald-400'}>{stats?.slack.toFixed(1)}h</strong></span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {onRunTask && task.column !== 'done' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRunTask(task.id);
                                }}
                                className="px-2 py-0.5 rounded bg-[#615EFF] hover:bg-[#5653D9] text-white font-bold flex items-center gap-1 transition"
                              >
                                <Play className="w-2.5 h-2.5" />
                                <span>Run</span>
                              </button>
                            )}

                            {onSelectTask && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectTask(task);
                                }}
                                className="px-2 py-0.5 rounded bg-[#161932] hover:bg-[#202548] text-[#A299FF] border border-[#252C58] transition"
                              >
                                Details
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Connecting arrow indicator between stages */}
                {layerIdx < cpm.layers.length - 1 && (
                  <div className="flex items-center justify-center py-1">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#0D1022] border border-[#1E2346] text-[10px] font-mono text-[#8E94B8]">
                      <ArrowRight className="w-3.5 h-3.5 text-[#615EFF]" />
                      <span>Directed DAG Transition to Stage {layerIdx + 2}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CRITICAL PATH SEQUENCE SUMMARY BAR */}
      <div className="p-4 rounded-xl bg-[#090B18] border border-[#1E2344] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400">
            <Flame className="w-4 h-4" />
            <span>Critical Path Directed Chain ({cpm.criticalPathSequence.length} Tasks)</span>
          </div>
          <span className="text-[11px] font-mono text-[#8E94B8]">
            Total Duration: <strong className="text-white">{cpm.totalCriticalDurationHours.toFixed(1)}h</strong>
          </span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin">
          {cpm.criticalPathSequence.map((taskId, idx) => {
            const task = cpm.tasksMap.get(taskId);
            if (!task) return null;
            const isLast = idx === cpm.criticalPathSequence.length - 1;

            return (
              <React.Fragment key={taskId}>
                <div
                  onClick={() => onHighlightTask?.(taskId)}
                  className={`flex-shrink-0 p-2 rounded-lg border transition cursor-pointer hover:scale-105 ${
                    highlightedTaskId === taskId
                      ? 'bg-amber-500/20 border-amber-400 text-white'
                      : 'bg-[#101224] border-[#252B52] text-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className="text-amber-400 font-bold">[{task.assignedAgent.toUpperCase()}]</span>
                    <span className="truncate max-w-[140px] font-semibold">{task.title}</span>
                    <span className="text-[#8E94B8]">({task.estimatedHours})</span>
                  </div>
                </div>

                {!isLast && (
                  <ArrowRight className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0 animate-pulse" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// OVERLAY COMPONENT: Draws directed SVG lines directly across Kanban columns/cards
interface KanbanDAGOverlayProps {
  tasks: KanbanTask[];
  containerRef: React.RefObject<HTMLDivElement>;
  highlightedTaskId?: string | null;
  highlightCriticalOnly?: boolean;
}

export const KanbanDAGOverlay: React.FC<KanbanDAGOverlayProps> = ({
  tasks,
  containerRef,
  highlightedTaskId,
  highlightCriticalOnly = false
}) => {
  const [svgSize, setSvgSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [lines, setLines] = useState<Array<{
    key: string;
    sourceId: string;
    targetId: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    isCritical: boolean;
    isHighlighted: boolean;
    isCompleted: boolean;
    sourceAgent: AgentRole;
    targetAgent: AgentRole;
  }>>([]);

  const cpm = useMemo(() => computeCriticalPathAnalysis(tasks), [tasks]);

  const updatePositions = React.useCallback(() => {
    const board = containerRef.current;
    if (!board) return;

    const boardRect = board.getBoundingClientRect();
    const scrollLeft = board.scrollLeft;
    const scrollTop = board.scrollTop;

    const boardScrollWidth = Math.max(board.scrollWidth, board.clientWidth);
    const boardScrollHeight = Math.max(board.scrollHeight, board.clientHeight);

    setSvgSize(prev => {
      if (prev.width !== boardScrollWidth || prev.height !== boardScrollHeight) {
        return { width: boardScrollWidth, height: boardScrollHeight };
      }
      return prev;
    });

    const newLines: typeof lines = [];

    tasks.forEach(targetTask => {
      const deps = targetTask.dependencies || [];
      if (deps.length === 0) return;

      const targetEl = board.querySelector(`[data-task-id="${targetTask.id}"]`) as HTMLElement | null;
      if (!targetEl) return;

      const targetRect = targetEl.getBoundingClientRect();
      const targetX = targetRect.left - boardRect.left + scrollLeft;
      const targetY = targetRect.top - boardRect.top + scrollTop + targetRect.height / 2;

      deps.forEach(sourceId => {
        const sourceTask = cpm.tasksMap.get(sourceId);
        if (!sourceTask) return;

        const sourceEl = board.querySelector(`[data-task-id="${sourceId}"]`) as HTMLElement | null;
        if (!sourceEl) return;

        const sourceRect = sourceEl.getBoundingClientRect();
        const sourceX = sourceRect.right - boardRect.left + scrollLeft;
        const sourceY = sourceRect.top - boardRect.top + scrollTop + sourceRect.height / 2;

        const edgeKey = `${sourceId}->${targetTask.id}`;
        const isCritical = cpm.criticalEdgeKeys.has(edgeKey);
        const isHighlighted = highlightedTaskId === sourceId || highlightedTaskId === targetTask.id;
        const isCompleted = sourceTask.column === 'done';

        if (highlightCriticalOnly && !isCritical) return;

        newLines.push({
          key: edgeKey,
          sourceId,
          targetId: targetTask.id,
          x1: sourceX,
          y1: sourceY,
          x2: targetX,
          y2: targetY,
          isCritical,
          isHighlighted,
          isCompleted,
          sourceAgent: sourceTask.assignedAgent,
          targetAgent: targetTask.assignedAgent
        });
      });
    });

    setLines(newLines);
  }, [tasks, highlightedTaskId, highlightCriticalOnly, cpm, containerRef]);

  React.useLayoutEffect(() => {
    updatePositions();
  }, [updatePositions]);

  useEffect(() => {
    let animationFrameId: number | null = null;

    const scheduleUpdate = () => {
      if (animationFrameId !== null) return;
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null;
        updatePositions();
      });
    };

    scheduleUpdate();

    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const board = containerRef.current;
    if (board && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate();
      });

      resizeObserver.observe(board);
      if (document.body) {
        resizeObserver.observe(document.body);
      }

      const columnsAndCards = board.querySelectorAll('.dashboard-box, [data-task-id], .overflow-y-auto');
      columnsAndCards.forEach(el => {
        resizeObserver?.observe(el);
      });
    }

    if (board && typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        scheduleUpdate();
      });
      mutationObserver.observe(board, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-task-id', 'class', 'style']
      });
    }

    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    const timer1 = setTimeout(scheduleUpdate, 50);
    const timer2 = setTimeout(scheduleUpdate, 150);
    const timer3 = setTimeout(scheduleUpdate, 350);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
      }
      window.removeEventListener('scroll', scheduleUpdate, { capture: true } as any);
      window.removeEventListener('resize', scheduleUpdate);
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [updatePositions, containerRef]);

  if (lines.length === 0) return null;

  return (
    <svg 
      className="absolute top-0 left-0 pointer-events-none z-10 overflow-visible"
      style={{ 
        width: svgSize.width ? `${svgSize.width}px` : '100%',
        height: svgSize.height ? `${svgSize.height}px` : '100%',
        minHeight: '100%', 
        minWidth: '100%' 
      }}
    >
      <defs>
        {/* Critical Path Arrow Marker */}
        <marker
          id="dag-marker-critical"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#F59E0B" />
        </marker>

        {/* Standard Arrow Marker */}
        <marker
          id="dag-marker-normal"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#615EFF" />
        </marker>

        {/* Completed Arrow Marker */}
        <marker
          id="dag-marker-done"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#00D26A" />
        </marker>

        {/* Highlighted Marker */}
        <marker
          id="dag-marker-highlight"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0.5 L 10 5 L 0 9.5 z" fill="#A299FF" />
        </marker>
      </defs>

      {lines.map((line) => {
        const dx = line.x2 - line.x1;
        const offset = dx > 0 
          ? Math.min(60, Math.max(20, dx * 0.35))
          : Math.min(40, Math.max(16, Math.abs(dx) * 0.25 + 16));

        const cp1x = line.x1 + offset;
        const cp1y = line.y1;
        const cp2x = line.x2 - offset;
        const cp2y = line.y2;

        const pathData = `M ${line.x1} ${line.y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${line.x2} ${line.y2}`;

        let strokeColor = '#615EFF';
        let strokeWidth = 2;
        let strokeDasharray = 'none';
        let markerId = 'dag-marker-normal';
        let opacity = highlightedTaskId ? (line.isHighlighted ? 1 : 0.2) : 0.75;

        if (line.isCritical) {
          strokeColor = '#F59E0B';
          strokeWidth = 3;
          markerId = 'dag-marker-critical';
          opacity = highlightedTaskId ? (line.isHighlighted ? 1 : 0.4) : 0.95;
          strokeDasharray = '6 4';
        } else if (line.isCompleted) {
          strokeColor = '#00D26A';
          strokeWidth = 2;
          markerId = 'dag-marker-done';
        }

        if (line.isHighlighted) {
          strokeWidth = line.isCritical ? 4 : 3;
          opacity = 1;
        }

        return (
          <g key={line.key}>
            {/* Background halo for contrast */}
            <path
              d={pathData}
              fill="none"
              stroke="#05060C"
              strokeWidth={strokeWidth + 3}
              opacity={0.8}
            />

            {/* Main Directed Line */}
            <path
              d={pathData}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeOpacity={opacity}
              markerEnd={`url(#${line.isHighlighted ? 'dag-marker-highlight' : markerId})`}
              className={line.isCritical ? 'animate-[pulse_3s_ease-in-out_infinite]' : ''}
            />
          </g>
        );
      })}
    </svg>
  );
};
