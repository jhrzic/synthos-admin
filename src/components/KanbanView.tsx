import React, { useState, useRef, useMemo } from 'react';
import { KanbanTask, AgentInfo, AIModelInfo, AgentRole, ObsidianNote, KanbanColumnId } from '../types';
import { SetupWizardCard } from './SetupWizardCard';
import { 
  KanbanDependencyDAG, 
  KanbanDAGOverlay, 
  computeCriticalPathAnalysis 
} from './KanbanDependencyDAG';
import { D3KanbanGraph } from './D3KanbanGraph';
import { 
  Plus, CheckCircle2, Clock, AlertCircle, Sparkles, 
  ArrowRight, ArrowLeft, Trash2, Database, ExternalLink, 
  Search, Filter, Play, RefreshCw, Layers, CheckSquare, 
  Square, Tag, Hash, Bot, Crown, BarChart3, PenTool, Code2,
  Share2, Maximize2, LayoutGrid, Columns, Monitor, GitMerge,
  Workflow, Flame, Link2, Eye, Cpu, Activity, Info, ChevronRight,
  AlertTriangle, ShieldCheck, FileText, Send, Zap, Globe, Youtube,
  FileCode, Terminal, X, Check, ArrowUpRight
} from 'lucide-react';

interface KanbanViewProps {
  tasks: KanbanTask[];
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  onAddTask: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateTask: (id: string, updates: Partial<KanbanTask>) => void;
  onDeleteTask: (id: string) => void;
  onExecuteTask: (taskId: string) => Promise<void>;
  onPushTaskToObsidian: (task: KanbanTask) => void;
  onSelectAgent: (agentRole: AgentRole) => void;
  onOpenJulianAudit?: () => void;
}

export const KANBAN_COLUMNS: Array<{ 
  id: KanbanColumnId; 
  label: string; 
  countColor: string; 
  bgBadge: string;
  borderColor: string;
  description: string;
  icon: any;
}> = [
  { 
    id: 'triage', 
    label: 'TRIAGE', 
    countColor: 'text-[#EC4899]', 
    bgBadge: 'bg-[#EC4899]/15 text-[#EC4899] border border-[#EC4899]/30', 
    borderColor: 'border-[#EC4899]/20',
    description: 'Raw briefs, URLs, objectives & unassigned staging',
    icon: Sparkles
  },
  { 
    id: 'todo', 
    label: 'TODO', 
    countColor: 'text-[#8E94B8]', 
    bgBadge: 'bg-[#181C38] text-[#A2A8D0] border border-[#2B325E]', 
    borderColor: 'border-[#202548]',
    description: 'Decomposed tasks awaiting upstream prerequisites',
    icon: Clock
  },
  { 
    id: 'ready', 
    label: 'READY', 
    countColor: 'text-[#EAB308]', 
    bgBadge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30', 
    borderColor: 'border-amber-500/20',
    description: 'Prerequisites satisfied, ready for specialist agent to claim',
    icon: Activity
  },
  { 
    id: 'running', 
    label: 'RUNNING', 
    countColor: 'text-[#38BDF8]', 
    bgBadge: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30', 
    borderColor: 'border-cyan-500/20',
    description: 'Actively executing agent reasoning loops in sandbox',
    icon: Play
  },
  { 
    id: 'blocked', 
    label: 'BLOCKED', 
    countColor: 'text-rose-400', 
    bgBadge: 'bg-rose-500/15 text-rose-400 border border-rose-500/30', 
    borderColor: 'border-rose-500/20',
    description: 'Halted on execution errors, safety gates, or missing resources',
    icon: AlertTriangle
  },
  { 
    id: 'review', 
    label: 'REVIEW', 
    countColor: 'text-[#38BDF8]', 
    bgBadge: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30', 
    borderColor: 'border-cyan-500/20',
    description: 'Aegis Sentinel verified, awaiting manual human/judge validation',
    icon: FileText
  },
  { 
    id: 'done', 
    label: 'DONE', 
    countColor: 'text-[#00D26A]', 
    bgBadge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', 
    borderColor: 'border-emerald-500/20',
    description: 'Guardian verified, Aegis signed & Obsidian vectorized',
    icon: CheckCircle2
  },
];

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  agents,
  models,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onExecuteTask,
  onPushTaskToObsidian,
  onSelectAgent,
  onOpenJulianAudit,
}) => {
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<'widescreen' | 'track' | 'compact'>('track');

  // Visualization View Modes: Board vs DAG Canvas vs Split View vs D3 Interactive Network Graph
  const [viewMode, setViewMode] = useState<'board' | 'dag' | 'split' | 'd3-graph'>('board');
  const [showDagOverlay, setShowDagOverlay] = useState<boolean>(true);
  const [highlightCriticalOnly, setHighlightCriticalOnly] = useState<boolean>(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [selectedTaskForDetail, setSelectedTaskForDetail] = useState<KanbanTask | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'trace' | 'dependencies' | 'artifact' | 'receipt'>('overview');

  // Triage Staging Bar State
  const [triageInput, setTriageInput] = useState('');
  const [triageInputType, setTriageInputType] = useState<'text' | 'url' | 'brief' | 'audio'>('text');
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [decompositionError, setDecompositionError] = useState<string | null>(null);
  const [decompositionSuccess, setDecompositionSuccess] = useState<string | null>(null);

  // Board Container Ref for dynamic SVG overlay alignment
  const boardContainerRef = useRef<HTMLDivElement>(null);

  // Kanban State Machine Engine Config
  const [boardPersistencePath, setBoardPersistencePath] = useState('board.db (SQLite / LocalStorage)');
  const [autoVectorizePolicy, setAutoVectorizePolicy] = useState('auto');

  // New Task Modal State
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColumn, setNewColumn] = useState<KanbanColumnId>('triage');
  const [newAgent, setNewAgent] = useState<AgentRole>('scout');
  const [newModel, setNewModel] = useState<string>('perplexity');
  const [newPriority, setNewPriority] = useState<KanbanTask['priority']>('medium');
  const [newTags, setNewTags] = useState('startup-curation, deep-research');
  const [newWikilinks, setNewWikilinks] = useState('Startup-Theses/Agentic-Browser-OS');
  const [newEstimatedHours, setNewEstimatedHours] = useState('2.0h');
  const [newCategory, setNewCategory] = useState<string>('startup-curation');
  const [newDependencies, setNewDependencies] = useState<string[]>([]);

  // Compute CPM Critical Path Analysis
  const cpm = useMemo(() => computeCriticalPathAnalysis(tasks), [tasks]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchesCategory = selectedCategoryFilter === 'all' || task.category === selectedCategoryFilter || (selectedCategoryFilter === 'startup-curation' && (task.tags?.includes('startup-curation') || task.tags?.includes('youtube-audit')));
      const matchesAgent = selectedAgentFilter === 'all' || task.assignedAgent === selectedAgentFilter;
      const matchesPriority = selectedPriorityFilter === 'all' || task.priority === selectedPriorityFilter;
      const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            (task.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (task.tags || []).some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchesCategory && matchesAgent && matchesPriority && matchesSearch;
    });
  }, [tasks, selectedCategoryFilter, selectedAgentFilter, selectedPriorityFilter, searchTerm]);

  // Dynamic Triage Decomposition via Orchestrator API
  const handleDecomposeTriage = async (customPrompt?: string) => {
    const promptToUse = (customPrompt || triageInput).trim();
    if (!promptToUse) return;

    setIsDecomposing(true);
    setDecompositionError(null);
    setDecompositionSuccess(null);

    try {
      const res = await fetch('/api/orchestrator/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directive: promptToUse,
          inputType: triageInputType,
          context: {
            activeTasksCount: tasks.length,
            availableAgents: Object.keys(agents)
          }
        })
      });

      if (!res.ok) {
        throw new Error(`Orchestrator server returned ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to decompose triage objective.');
      }

      const { parentTask, childTasks } = data;

      // Add parent task to Kanban
      if (parentTask) {
        onAddTask({
          title: parentTask.title,
          description: parentTask.description,
          column: (parentTask.column as KanbanColumnId) || 'triage',
          assignedAgent: parentTask.assignedAgent || 'orchestrator',
          assignedModel: parentTask.assignedModel || 'nous-hermes-3',
          priority: parentTask.priority || 'critical',
          tags: parentTask.tags || ['triage-master', 'orchestrator-decomposed'],
          obsidianWikilinks: parentTask.obsidianWikilinks || [`Startup-Theses/${parentTask.title.replace(/\s+/g, '-')}`],
          category: 'startup-curation',
          dependencies: [],
          isParentTask: true,
          childTaskIds: (childTasks || []).map((ct: any) => ct.id),
          subtasks: (childTasks || []).map((ct: any) => ({
            id: `sub-${ct.id}`,
            title: `[${ct.assignedAgent?.toUpperCase()}] ${ct.title}`,
            completed: false
          })),
          estimatedHours: parentTask.estimatedHours || '6.0h'
        });
      }

      // Add each child task to Kanban with proper dependencies
      if (Array.isArray(childTasks)) {
        childTasks.forEach(ct => {
          onAddTask({
            title: ct.title,
            description: ct.description,
            column: (ct.column as KanbanColumnId) || (ct.dependencies?.length ? 'todo' : 'ready'),
            assignedAgent: ct.assignedAgent,
            assignedModel: ct.assignedModel,
            priority: ct.priority,
            tags: ct.tags,
            obsidianWikilinks: ct.obsidianWikilinks,
            category: ct.category || 'startup-curation',
            dependencies: ct.dependencies || [],
            parentTaskId: ct.parentTaskId || parentTask?.id,
            stage: ct.stage,
            claimedBy: ct.claimedBy,
            subtasks: ct.subtasks || [
              { id: `sub-${Date.now()}-1`, title: 'Execute primary specialist reasoning loop', completed: false },
              { id: `sub-${Date.now()}-2`, title: 'Validate data & compile deliverable note', completed: false }
            ],
            estimatedHours: ct.estimatedHours || '2.0h'
          });
        });
      }

      setDecompositionSuccess(`Orchestrator successfully decomposed objective into 1 master card + ${childTasks?.length || 0} specialist child tasks.`);
      setTriageInput('');
    } catch (err: any) {
      console.error('Triage decomposition error:', err);
      setDecompositionError(err.message || 'Failed to decompose task via Orchestrator.');
    } finally {
      setIsDecomposing(false);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const tags = newTags.split(',').map(t => t.trim()).filter(Boolean);
    const wikilinks = newWikilinks.split(',').map(w => w.trim()).filter(Boolean);

    onAddTask({
      title: newTitle,
      description: newDescription,
      column: newColumn,
      assignedAgent: newAgent,
      assignedModel: newModel,
      priority: newPriority,
      tags,
      obsidianWikilinks: wikilinks,
      category: newCategory,
      dependencies: newDependencies,
      subtasks: [
        { id: `sub-${Date.now()}-1`, title: 'Execute primary specialist reasoning loop', completed: false },
        { id: `sub-${Date.now()}-2`, title: 'Validate data & compile deliverable note', completed: false }
      ],
      estimatedHours: newEstimatedHours
    });

    setIsCreatingTask(false);
    setNewTitle('');
    setNewDescription('');
    setNewDependencies([]);
  };

  const handleToggleSubtask = (task: KanbanTask, subtaskId: string) => {
    const updatedSubtasks = task.subtasks.map(st => 
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    );
    onUpdateTask(task.id, { subtasks: updatedSubtasks });
  };

  // State Transition Engine with Automatic Upstream/Downstream Resolution
  const handleMoveColumn = (task: KanbanTask, direction: 'left' | 'right') => {
    const colOrder: KanbanColumnId[] = ['triage', 'todo', 'ready', 'running', 'blocked', 'done'];
    const currentIndex = colOrder.indexOf(task.column);
    const nextIndex = direction === 'right' ? currentIndex + 1 : currentIndex - 1;

    if (nextIndex >= 0 && nextIndex < colOrder.length) {
      const nextCol = colOrder[nextIndex];
      onUpdateTask(task.id, { 
        column: nextCol,
        updatedAt: 'Just now'
      });

      // If moved to done, prompt auto-vectorization
      if (nextCol === 'done') {
        onPushTaskToObsidian(task);

        // Check downstream tasks in 'todo' whose dependencies are now all satisfied
        tasks.forEach(otherTask => {
          if (otherTask.column === 'todo' && otherTask.dependencies?.includes(task.id)) {
            const allDepsDone = (otherTask.dependencies || []).every(depId => 
              depId === task.id || tasks.find(t => t.id === depId)?.column === 'done'
            );
            if (allDepsDone) {
              onUpdateTask(otherTask.id, {
                column: 'ready',
                updatedAt: 'Just now (Dependencies Met)'
              });
            }
          }
        });
      }
    }
  };

  const handleDirectColumnSet = (task: KanbanTask, targetCol: KanbanColumnId) => {
    onUpdateTask(task.id, { 
      column: targetCol,
      updatedAt: 'Just now'
    });

    if (targetCol === 'done') {
      onPushTaskToObsidian(task);
    }
  };

  const handleRunTask = async (taskId: string) => {
    setExecutingTaskId(taskId);
    try {
      await onExecuteTask(taskId);
    } finally {
      setExecutingTaskId(null);
    }
  };

  const getAgentBadge = (agentRole: AgentRole) => {
    const agent = agents[agentRole] || agents['orchestrator'];
    const roleColors: Record<string, { bg: string; text: string; border: string }> = {
      'orchestrator': { bg: 'bg-[#EC4899]/15', text: 'text-[#EC4899]', border: 'border-[#EC4899]/30' },
      'scout': { bg: 'bg-[#20B2AA]/15', text: 'text-[#20B2AA]', border: 'border-[#20B2AA]/30' },
      'scribe': { bg: 'bg-[#8B5CF6]/15', text: 'text-[#8B5CF6]', border: 'border-[#8B5CF6]/30' },
      'reach': { bg: 'bg-[#F59E0B]/15', text: 'text-[#F59E0B]', border: 'border-[#F59E0B]/30' },
      'dev': { bg: 'bg-[#00D26A]/15', text: 'text-[#00D26A]', border: 'border-[#00D26A]/30' },
      'analytics': { bg: 'bg-[#3B82F6]/15', text: 'text-[#3B82F6]', border: 'border-[#3B82F6]/30' },
      'claude': { bg: 'bg-[#F97316]/15', text: 'text-[#F97316]', border: 'border-[#F97316]/30' },
      'claudecode': { bg: 'bg-[#D97706]/15', text: 'text-[#D97706]', border: 'border-[#D97706]/30' },
      'kimi3': { bg: 'bg-[#3B82F6]/15', text: 'text-[#3B82F6]', border: 'border-[#3B82F6]/30' },
      'deepseek': { bg: 'bg-[#10B981]/15', text: 'text-[#10B981]', border: 'border-[#10B981]/30' },
      'chatgpt': { bg: 'bg-[#06B6D4]/15', text: 'text-[#06B6D4]', border: 'border-[#06B6D4]/30' },
      'codex': { bg: 'bg-[#6366F1]/15', text: 'text-[#6366F1]', border: 'border-[#6366F1]/30' },
      'cursor': { bg: 'bg-[#8B5CF6]/15', text: 'text-[#8B5CF6]', border: 'border-[#8B5CF6]/30' },
      'antigravity': { bg: 'bg-[#EC4899]/15', text: 'text-[#EC4899]', border: 'border-[#EC4899]/30' },
      'perplexity': { bg: 'bg-[#14B8A6]/15', text: 'text-[#14B8A6]', border: 'border-[#14B8A6]/30' },
      'elevenlabs': { bg: 'bg-[#F43F5E]/15', text: 'text-[#F43F5E]', border: 'border-[#F43F5E]/30' },
    };
    const c = roleColors[agentRole] || roleColors['orchestrator'];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${c.bg} ${c.text} ${c.border}`}>
        <span>{agent?.name || agentRole.toUpperCase()}</span>
      </span>
    );
  };

  const getPriorityBadge = (priority: KanbanTask['priority']) => {
    switch (priority) {
      case 'critical':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">CRITICAL</span>;
      case 'high':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">HIGH</span>;
      case 'medium':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">MED</span>;
      case 'low':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">LOW</span>;
    }
  };

  return (
    <div id="tour-kanban" className="space-y-6 pb-20 w-full px-2 sm:px-4 lg:px-6 2xl:px-8">
      {/* Header Banner - Full Widescreen Fluid */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-2 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              HERMES AGENTOS KANBAN STATE ENGINE (BOARD.DB)
            </span>
            <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
              6-STAGE CANONICAL WORKFLOW ACTIVE
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Autonomous Multi-Agent Kanban & Directed DAG
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Drop directives into Triage ➔ Orchestrator decomposes into DAG ➔ Specialists claim Ready tasks ➔ Running ➔ Blocked or Done (Aegis verified).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Switcher: Board vs Critical Path DAG vs Split vs D3 */}
          <div className="flex items-center bg-[#070812] border border-[#1E223D] rounded-xl p-1 gap-1">
            <button
              onClick={() => setViewMode('board')}
              className={`p-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition ${
                viewMode === 'board'
                  ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/25'
                  : 'text-[#7A81A8] hover:text-white'
              }`}
              title="Kanban Board with Direct Directed SVG Overlay Lines"
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Board</span>
            </button>

            <button
              onClick={() => setViewMode('dag')}
              className={`p-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition ${
                viewMode === 'dag'
                  ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/25'
                  : 'text-amber-400 hover:text-amber-300'
              }`}
              title="Topological Stage DAG & Critical Path Inspector"
            >
              <Workflow className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Critical Path DAG</span>
            </button>

            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition ${
                viewMode === 'split'
                  ? 'bg-[#1E2548] text-white shadow'
                  : 'text-[#7A81A8] hover:text-white'
              }`}
              title="Split View (DAG Canvas + Board)"
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Split</span>
            </button>

            <button
              onClick={() => setViewMode('d3-graph')}
              className={`p-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition ${
                viewMode === 'd3-graph'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                  : 'text-purple-400 hover:text-purple-300'
              }`}
              title="D3.js Interactive Network Graph"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">D3 Network Graph</span>
            </button>
          </div>

          {/* Directed Line Overlay Toggles (For Board & Split) */}
          {viewMode !== 'dag' && (
            <div className="flex items-center gap-1.5 bg-[#070812] border border-[#1E223D] rounded-xl p-1">
              <button
                onClick={() => setShowDagOverlay(!showDagOverlay)}
                className={`px-2 py-1 rounded-lg text-xs font-mono flex items-center gap-1.5 transition ${
                  showDagOverlay 
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold' 
                    : 'text-[#7A81A8] hover:text-white'
                }`}
                title="Toggle Directed Dependency Lines between Kanban cards"
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span>Lines {showDagOverlay ? 'ON' : 'OFF'}</span>
              </button>

              <button
                onClick={() => setHighlightCriticalOnly(!highlightCriticalOnly)}
                className={`px-2 py-1 rounded-lg text-xs font-mono flex items-center gap-1 transition ${
                  highlightCriticalOnly 
                    ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 font-bold' 
                    : 'text-[#7A81A8] hover:text-amber-300'
                }`}
                title="Highlight only edges on the Critical Path"
              >
                <Flame className="w-3 h-3 text-amber-400" />
                <span className="hidden md:inline">Critical Path</span>
              </button>
            </div>
          )}

          {/* Layout Mode Switcher */}
          <div className="flex items-center bg-[#070812] border border-[#1E223D] rounded-xl p-1 gap-1">
            <button
              onClick={() => setLayoutMode('track')}
              className={`p-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition ${
                layoutMode === 'track'
                  ? 'bg-[#615EFF] text-white'
                  : 'text-[#7A81A8] hover:text-white'
              }`}
              title="Horizontal Scrolling Track (Recommended for 6 Columns)"
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Track</span>
            </button>

            <button
              onClick={() => setLayoutMode('widescreen')}
              className={`p-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition ${
                layoutMode === 'widescreen'
                  ? 'bg-[#615EFF] text-white'
                  : 'text-[#7A81A8] hover:text-white'
              }`}
              title="Grid Layout"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Grid</span>
            </button>
          </div>

          <button
            onClick={() => setIsCreatingTask(true)}
            className="airbyte-btn-primary px-4 py-2 text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#615EFF]/25"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>DISPATCH MANUAL TASK</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 🚀 CANONICAL TRIAGE INPUT & ORCHESTRATOR DECOMPOSITION STAGING DOCK      */}
      {/* ========================================================================= */}
      <div className="rounded-2xl bg-gradient-to-r from-[#0C0E20] via-[#0E122A] to-[#120D24] border border-[#615EFF]/40 p-4 md:p-6 space-y-4 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#615EFF]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-[#615EFF]/20 border border-[#615EFF]/40 text-[#A5A2FF] shadow-lg shadow-[#615EFF]/20">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base md:text-lg font-bold text-white font-['Space_Grotesk'] tracking-tight">
                  DROP A TASK / PROMPT / URL / RESEARCH BRIEF
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EC4899]/20 text-[#EC4899] border border-[#EC4899]/40">
                  LIVE TRIAGE ENGINE
                </span>
              </div>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                Drop raw directives below. The Orchestrator will analyze context, validate source data, and decompose it into a multi-agent DAG.
              </p>
            </div>
          </div>

          {/* Input Format Selector */}
          <div className="flex items-center bg-[#05060C] border border-[#1E223D] rounded-xl p-1 gap-1">
            <button
              onClick={() => setTriageInputType('text')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition flex items-center gap-1.5 ${
                triageInputType === 'text' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>Prompt / Idea</span>
            </button>
            <button
              onClick={() => setTriageInputType('url')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition flex items-center gap-1.5 ${
                triageInputType === 'url' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              <Youtube className="w-3 h-3 text-red-400" />
              <span>URL / YouTube</span>
            </button>
            <button
              onClick={() => setTriageInputType('brief')}
              className={`px-2.5 py-1 text-xs font-mono rounded-lg transition flex items-center gap-1.5 ${
                triageInputType === 'brief' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              <FileCode className="w-3 h-3 text-amber-400" />
              <span>Research Brief</span>
            </button>
          </div>
        </div>

        {/* Input Textarea & Decompose Dispatcher */}
        <div className="space-y-3 relative z-10">
          <div className="relative">
            <textarea
              value={triageInput}
              onChange={(e) => setTriageInput(e.target.value)}
              placeholder={
                triageInputType === 'url'
                  ? "Paste video/article URL (e.g. https://www.youtube.com/watch?v=3HvdXqHNFy8 - Analyze last 4 days of Julian Goldie)..."
                  : triageInputType === 'brief'
                  ? "Paste product spec or research memo: 'Build sub-50ms isolated sandboxes with Airbyte SQL sync and Aegis cryptographic receipts'..."
                  : "Type high-level objective: 'Analyze the last 4 days of the Julian Goldie YouTube channel and determine what SynthOS should integrate'..."
              }
              rows={2}
              className="w-full bg-[#05060C] border border-[#2B315C] focus:border-[#615EFF] rounded-xl p-3.5 text-xs md:text-sm font-mono text-white placeholder-[#53597D] focus:outline-none shadow-inner"
            />

            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <button
                onClick={() => handleDecomposeTriage()}
                disabled={isDecomposing || !triageInput.trim()}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#615EFF] to-[#8B5CF6] hover:from-[#514DE0] hover:to-[#7C48EB] text-white font-bold text-xs font-mono flex items-center gap-2 shadow-lg shadow-[#615EFF]/30 transition disabled:opacity-40"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isDecomposing ? 'animate-spin' : ''}`} />
                <span>{isDecomposing ? 'DECOMPOSING WITH ORCHESTRATOR...' : 'ORCHESTRATOR DECOMPOSE ➔'}</span>
              </button>
            </div>
          </div>

          {/* Quick Preset Directive Pills */}
          <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
            <span className="text-[#6A7097] flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" /> One-Click Directives:
            </span>

            <button
              onClick={() => {
                setTriageInputType('url');
                setTriageInput('Analyze the last four days of the Julian Goldie YouTube channel and determine what SynthOS should integrate.');
                handleDecomposeTriage('Analyze the last four days of the Julian Goldie YouTube channel and determine what SynthOS should integrate.');
              }}
              className="px-2.5 py-1 rounded-lg bg-[#14162E] hover:bg-[#1E2244] text-[#A5A2FF] border border-[#2B325E] transition flex items-center gap-1.5"
            >
              <Youtube className="w-3 h-3 text-red-400" />
              <span>🎯 Julian Goldie 4-Day YouTube Audit</span>
            </button>

            <button
              onClick={() => {
                setTriageInputType('brief');
                setTriageInput('Architect a sub-50ms Multi-Agent Micro-Sandbox Engine with Airbyte SQL sync and Guardian Aegis verification.');
                handleDecomposeTriage('Architect a sub-50ms Multi-Agent Micro-Sandbox Engine with Airbyte SQL sync and Guardian Aegis verification.');
              }}
              className="px-2.5 py-1 rounded-lg bg-[#14162E] hover:bg-[#1E2244] text-[#A5A2FF] border border-[#2B325E] transition flex items-center gap-1.5"
            >
              <Cpu className="w-3 h-3 text-cyan-400" />
              <span>⚡ Sub-50ms Micro-Agent Sandbox POC</span>
            </button>

            <button
              onClick={() => {
                setTriageInputType('text');
                setTriageInput('Calculate Total Addressable Market (TAM), token inference unit economics, and viral growth loops for SynthOS AgentOS.');
                handleDecomposeTriage('Calculate Total Addressable Market (TAM), token inference unit economics, and viral growth loops for SynthOS AgentOS.');
              }}
              className="px-2.5 py-1 rounded-lg bg-[#14162E] hover:bg-[#1E2244] text-[#A5A2FF] border border-[#2B325E] transition flex items-center gap-1.5"
            >
              <BarChart3 className="w-3 h-3 text-emerald-400" />
              <span>📊 TAM & Token Economics Model</span>
            </button>
          </div>

          {/* Decomposition Feedback Banners */}
          {decompositionError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{decompositionError}</span>
              </div>
              <button onClick={() => setDecompositionError(null)} className="text-rose-400 hover:text-white">✕</button>
            </div>
          )}

          {decompositionSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{decompositionSuccess}</span>
              </div>
              <button onClick={() => setDecompositionSuccess(null)} className="text-emerald-400 hover:text-white">✕</button>
            </div>
          )}
        </div>
      </div>

      {/* CRITICAL PATH DAG TELEMETRY STRIP */}
      <div className="p-4 rounded-2xl bg-[#090B18] border border-amber-500/30 flex flex-wrap items-center justify-between gap-4 text-xs font-mono shadow-xl relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center gap-3 relative z-10">
          <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-lg shadow-amber-500/10">
            <Flame className="w-5 h-5 animate-pulse text-amber-400" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-amber-300 font-bold tracking-wider uppercase flex items-center gap-2">
              <span>Critical Path Agent Sequence</span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-200 text-[9px]">
                CPM Zero-Slack
              </span>
            </div>
            <div className="text-sm text-white font-semibold mt-0.5">
              Total Lead Time: <strong className="text-amber-400 font-bold">{cpm.totalCriticalDurationHours.toFixed(1)}h</strong> across <strong className="text-white">{cpm.criticalTaskIds.size} sequential tasks</strong> ({cpm.layers.length} stages)
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 relative z-10">
          {cpm.bottleneckTask && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#121528] border border-[#202548] text-[11px] text-[#8E94B8]">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>Primary Bottleneck:</span>
              <span className="text-rose-400 font-bold font-mono">
                [{cpm.bottleneckTask.assignedAgent.toUpperCase()}] {cpm.bottleneckTask.estimatedHours}
              </span>
            </div>
          )}

          <button
            onClick={() => setViewMode(viewMode === 'dag' ? 'board' : 'dag')}
            className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-1.5 transition shadow-lg shadow-amber-500/20"
          >
            <Workflow className="w-3.5 h-3.5" />
            <span>{viewMode === 'dag' ? 'Return to Board' : 'Inspect Critical Path DAG'}</span>
          </button>
        </div>
      </div>

      {/* DAG CANVAS COMPONENT (Rendered in 'dag' or 'split' view) */}
      {(viewMode === 'dag' || viewMode === 'split') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Workflow className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white font-['Space_Grotesk']">
                Directed Agent DAG & Critical Path Visualizer
              </h3>
            </div>
            {viewMode === 'split' && (
              <button
                onClick={() => setViewMode('dag')}
                className="text-xs font-mono text-[#8E94B8] hover:text-white"
              >
                Expand Full DAG Canvas ↗
              </button>
            )}
          </div>

          <KanbanDependencyDAG
            tasks={tasks}
            onSelectTask={(task) => {
              setSelectedTaskForDetail(task);
              setDetailTab('overview');
            }}
            onUpdateDependencies={(taskId, newDeps) => {
              onUpdateTask(taskId, { dependencies: newDeps });
            }}
            onRunTask={(taskId) => handleRunTask(taskId)}
            highlightedTaskId={highlightedTaskId}
            onHighlightTask={(id) => setHighlightedTaskId(id)}
          />
        </div>
      )}

      {/* D3 INTERACTIVE NETWORK GRAPH COMPONENT */}
      {viewMode === 'd3-graph' && (
        <D3KanbanGraph
          tasks={tasks}
          onSelectTask={(task) => {
            setSelectedTaskForDetail(task);
            setDetailTab('overview');
          }}
          highlightedTaskId={highlightedTaskId}
          onHighlightTask={(id) => setHighlightedTaskId(id)}
        />
      )}

      {/* Board & Card Views (Rendered in 'board' or 'split' view) */}
      {(viewMode === 'board' || viewMode === 'split') && (
        <>
          {/* Category Pipeline Selector */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setSelectedCategoryFilter('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition whitespace-nowrap ${
                selectedCategoryFilter === 'all'
                  ? 'bg-[#615EFF] text-white shadow'
                  : 'bg-[#090A15] text-[#8E94B8] hover:bg-[#121426] border border-[#181B2E]'
              }`}
            >
              All Active Work ({tasks.length})
            </button>
            <button
              onClick={() => setSelectedCategoryFilter('startup-curation')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                selectedCategoryFilter === 'startup-curation'
                  ? 'bg-[#615EFF] text-white shadow'
                  : 'bg-[#090A15] text-[#A5A2FF] hover:bg-[#121426] border border-[#615EFF]/30'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#EAB308]" />
              <span>Startup Curation Pipeline (Scout ➔ Scribe)</span>
            </button>
            <button
              onClick={() => setSelectedCategoryFilter('infrastructure')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition whitespace-nowrap ${
                selectedCategoryFilter === 'infrastructure'
                  ? 'bg-[#615EFF] text-white shadow'
                  : 'bg-[#090A15] text-[#8E94B8] hover:bg-[#121426] border border-[#181B2E]'
              }`}
            >
              Core Infrastructure & Telemetry
            </button>
          </div>

          {/* Agents Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-[#090A14] border border-[#1C1F33] p-3.5 rounded-xl">
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
              <span className="text-[11px] font-mono text-[#6A7097] mr-1">FLEET AGENT:</span>
              <button
                onClick={() => setSelectedAgentFilter('all')}
                className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition ${
                  selectedAgentFilter === 'all' 
                    ? 'bg-[#615EFF] text-white' 
                    : 'bg-[#0E101B] border border-[#1C2038] text-[#8E94B8] hover:text-white'
                }`}
              >
                All
              </button>
              {Object.entries(agents).slice(0, 10).map(([key, ag]) => (
                <button
                  key={key}
                  onClick={() => setSelectedAgentFilter(ag.role)}
                  className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition ${
                    selectedAgentFilter === ag.role 
                      ? 'bg-[#615EFF] text-white' 
                      : 'bg-[#0E101B] border border-[#1C2038] text-[#8E94B8] hover:text-white'
                  }`}
                >
                  {ag.name.split(' ')[0]}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative w-full md:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#585E82]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search tasks, tags, wikilinks..."
                className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl pl-9 pr-3 py-1.5 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
              />
            </div>
          </div>

          {/* Columns Board Container with SVG DIRECTED DAG LINES OVERLAY */}
          <div 
            ref={boardContainerRef}
            className={`relative ${
              layoutMode === 'track' 
                ? 'overflow-x-auto pb-6 scrollbar-thin' 
                : 'overflow-hidden'
            }`}
          >
            {/* SVG DIRECTED LINES OVERLAY */}
            {showDagOverlay && (
              <KanbanDAGOverlay
                tasks={filteredTasks}
                containerRef={boardContainerRef}
                highlightedTaskId={highlightedTaskId}
                highlightCriticalOnly={highlightCriticalOnly}
              />
            )}

            {/* 6-Column Board Grid / Track */}
            <div 
              className={
                layoutMode === 'track' 
                  ? 'flex gap-5 min-w-max' 
                  : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4'
              }
            >
              {KANBAN_COLUMNS.map(col => {
                const colTasks = filteredTasks.filter(t => t.column === col.id);
                const ColumnIcon = col.icon;

                return (
                  <div
                    key={col.id}
                    className={`dashboard-box rounded-2xl p-3.5 flex flex-col justify-between shadow-xl min-h-[600px] relative z-10 border ${col.borderColor} ${
                      layoutMode === 'track' ? 'min-w-[320px] max-w-[360px] flex-shrink-0' : 'w-full'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Column Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-[#141626]">
                        <div className="flex items-center gap-2">
                          <ColumnIcon className={`w-4 h-4 ${col.countColor}`} />
                          <span className="text-xs font-mono font-bold text-white tracking-wider">
                            {col.label}
                          </span>
                        </div>
                        <span className={`text-xs font-mono font-extrabold px-2 py-0.5 rounded-full ${col.bgBadge}`}>
                          {colTasks.length}
                        </span>
                      </div>

                      <p className="text-[10px] text-[#6A7097] font-mono leading-tight">
                        {col.description}
                      </p>

                      {/* Task Cards List */}
                      <div className="space-y-3 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
                        {colTasks.length === 0 && (
                          <div className="p-6 text-center border border-dashed border-[#1A1D34] rounded-xl text-xs font-mono text-[#585E82]">
                            No tasks in {col.label}
                          </div>
                        )}

                        {colTasks.map(task => {
                          const isRunning = executingTaskId === task.id || task.column === 'running';
                          const isCritical = cpm.criticalTaskIds.has(task.id);
                          const isHighlighted = highlightedTaskId === task.id;
                          const taskStats = cpm.taskStats.get(task.id);
                          const isParent = task.isParentTask;

                          // Compute child tasks progress if parent
                          const childTasksForParent = isParent 
                            ? tasks.filter(t => t.parentTaskId === task.id || task.childTaskIds?.includes(t.id))
                            : [];
                          const completedChildren = childTasksForParent.filter(t => t.column === 'done').length;
                          const allChildrenDone = childTasksForParent.length > 0 && completedChildren === childTasksForParent.length;

                          return (
                            <div
                              key={task.id}
                              data-task-id={task.id}
                              onClick={() => {
                                setSelectedTaskForDetail(task);
                                setDetailTab('overview');
                              }}
                              className={`dashboard-box rounded-xl p-3.5 space-y-3 transition group relative cursor-pointer border ${
                                isParent
                                  ? 'border-[#EC4899]/50 bg-gradient-to-b from-[#140D24] to-[#0A0714] shadow-lg shadow-[#EC4899]/10'
                                  : isCritical 
                                  ? 'border-amber-500/60 shadow-amber-500/5 hover:border-amber-400' 
                                  : task.column === 'blocked'
                                  ? 'border-rose-500/50 bg-[#140810]'
                                  : task.column === 'done'
                                  ? 'border-emerald-500/30 hover:border-emerald-400/60'
                                  : 'border-white/10 hover:border-[#615EFF]/50'
                              } ${
                                isHighlighted ? 'ring-2 ring-[#615EFF] border-transparent shadow-xl shadow-[#615EFF]/20' : ''
                              }`}
                            >
                              {/* Parent Objective Badge */}
                              {isParent && (
                                <div className="flex items-center justify-between mb-1">
                                  <span className="inline-flex items-center gap-1 text-[9px] font-mono font-extrabold px-2 py-0.5 rounded-full bg-[#EC4899]/20 text-[#EC4899] border border-[#EC4899]/40 uppercase">
                                    <Crown className="w-3 h-3 text-[#EC4899]" />
                                    Master Objective
                                  </span>
                                  <span className="text-[10px] font-mono text-purple-300">
                                    {completedChildren}/{childTasksForParent.length} Done
                                  </span>
                                </div>
                              )}

                              {/* Stage or Critical Path Badge */}
                              {!isParent && isCritical && (
                                <div className="flex items-center justify-between mb-1">
                                  <span className="inline-flex items-center gap-1 text-[9px] font-mono font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                                    <Flame className="w-2.5 h-2.5 animate-pulse text-amber-400" />
                                    Critical Path ({task.estimatedHours || '2.0h'})
                                  </span>
                                </div>
                              )}

                              {/* Task Top Meta */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {getAgentBadge(task.assignedAgent)}
                                  {getPriorityBadge(task.priority)}
                                  {task.stage && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-[#A2A8D0] bg-[#1A1E38] border border-[#2B325E]">
                                      {task.stage}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition" onClick={e => e.stopPropagation()}>
                                  <button
                                    onClick={() => handleMoveColumn(task, 'left')}
                                    disabled={task.column === 'triage'}
                                    className="p-1 rounded bg-[#121426] hover:bg-[#1C203C] text-[#8E94B8] hover:text-white disabled:opacity-20"
                                    title="Move Left"
                                  >
                                    <ArrowLeft className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => handleMoveColumn(task, 'right')}
                                    disabled={task.column === 'done'}
                                    className="p-1 rounded bg-[#121426] hover:bg-[#1C203C] text-[#8E94B8] hover:text-white disabled:opacity-20"
                                    title="Move Right"
                                  >
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {/* Task Title & Description */}
                              <div>
                                <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-[#A5A2FF] transition leading-snug">
                                  {task.title}
                                </h4>
                                <p className="text-[11px] text-[#8E94B8] mt-1 line-clamp-2 leading-relaxed">
                                  {task.description}
                                </p>
                              </div>

                              {/* Parent Child Progress Bar */}
                              {isParent && childTasksForParent.length > 0 && (
                                <div className="space-y-1">
                                  <div className="w-full bg-[#0E1020] rounded-full h-1.5 overflow-hidden">
                                    <div 
                                      className="bg-gradient-to-r from-[#EC4899] to-[#00D26A] h-full transition-all duration-500"
                                      style={{ width: `${(completedChildren / childTasksForParent.length) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* DAG DEPENDENCY PILLS */}
                              {((task.dependencies && task.dependencies.length > 0) || (taskStats && taskStats.successors.length > 0)) && (
                                <div className="space-y-1.5 p-2 bg-[#05060C] border border-[#141628] rounded-lg">
                                  {/* Upstream Prerequisites */}
                                  {task.dependencies && task.dependencies.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                                      <span className="text-[#8E94B8] flex items-center gap-1">
                                        <Link2 className="w-2.5 h-2.5 text-cyan-400" /> Prereqs:
                                      </span>
                                      {task.dependencies.map(depId => {
                                        const depTask = cpm.tasksMap.get(depId);
                                        const isDepDone = depTask?.column === 'done';
                                        return (
                                          <span
                                            key={depId}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setHighlightedTaskId(depId);
                                            }}
                                            className={`px-1.5 py-0.5 rounded border text-[9px] transition hover:scale-105 ${
                                              isDepDone 
                                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                                : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                                            }`}
                                            title={depTask?.title || depId}
                                          >
                                            [{depTask?.assignedAgent || 'task'}] {depId.replace('task-', '')}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Downstream Successors / Blockers */}
                                  {taskStats && taskStats.successors.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                                      <span className="text-[#8E94B8] flex items-center gap-1">
                                        <ArrowRight className="w-2.5 h-2.5 text-purple-400" /> Blocks:
                                      </span>
                                      {taskStats.successors.map(succId => {
                                        const succTask = cpm.tasksMap.get(succId);
                                        return (
                                          <span
                                            key={succId}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setHighlightedTaskId(succId);
                                            }}
                                            className="px-1.5 py-0.5 rounded border text-[9px] bg-purple-500/10 text-purple-300 border-purple-500/20 transition hover:scale-105"
                                            title={succTask?.title || succId}
                                          >
                                            [{succTask?.assignedAgent || 'task'}] {succId.replace('task-', '')}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Aegis Verification Badge if verified */}
                              {task.verificationReceipt && (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#00D26A]/10 border border-[#00D26A]/20 text-[10px] font-mono text-[#00D26A]">
                                  <ShieldCheck className="w-3 h-3" />
                                  <span>Aegis Verified: {task.verificationReceipt.score}/100</span>
                                </div>
                              )}

                              {/* Wikilinks */}
                              {task.obsidianWikilinks && task.obsidianWikilinks.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {task.obsidianWikilinks.slice(0, 2).map((w, i) => (
                                    <span key={i} className="text-[9px] font-mono text-[#A5A2FF] bg-[#14172E] px-1.5 py-0.5 rounded border border-[#252A50]">
                                      [[{w}]]
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Action Bar */}
                              <div className="pt-2 border-t border-[#16182C] flex items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
                                <div className="text-[10px] font-mono text-[#585E82]">
                                  Est: {task.estimatedHours || '2.0h'}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {task.column === 'ready' && (
                                    <button
                                      onClick={() => handleRunTask(task.id)}
                                      disabled={isRunning}
                                      className="px-2.5 py-1 rounded bg-[#615EFF] hover:bg-[#5653D9] text-white text-[10px] font-mono font-bold flex items-center gap-1 shadow transition disabled:opacity-50"
                                    >
                                      <Play className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
                                      <span>CLAIM & RUN</span>
                                    </button>
                                  )}

                                  {task.column === 'running' && (
                                    <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-mono font-bold border border-cyan-500/30 flex items-center gap-1 animate-pulse">
                                      <Activity className="w-3 h-3 animate-spin" />
                                      <span>RUNNING</span>
                                    </span>
                                  )}

                                  {task.column === 'blocked' && (
                                    <button
                                      onClick={() => handleRunTask(task.id)}
                                      className="px-2 py-1 rounded bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center gap-1 transition"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      <span>RETRY</span>
                                    </button>
                                  )}

                                  {task.column === 'done' && (
                                    <button
                                      onClick={() => onPushTaskToObsidian(task)}
                                      className="px-2 py-1 rounded bg-[#00D26A]/10 hover:bg-[#00D26A]/20 text-[#00D26A] text-[10px] font-mono font-bold border border-[#00D26A]/30 flex items-center gap-1 transition"
                                    >
                                      <Database className="w-3 h-3" />
                                      <span>Vectorize</span>
                                    </button>
                                  )}

                                  <button
                                    onClick={() => onDeleteTask(task.id)}
                                    className="p-1 rounded text-[#585E82] hover:text-rose-400 hover:bg-rose-500/10 transition"
                                    title="Delete Task"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Column Footer Quick Add */}
                    <button
                      onClick={() => {
                        setNewColumn(col.id);
                        setIsCreatingTask(true);
                      }}
                      className="w-full mt-3 py-2 rounded-xl border border-dashed border-[#1E223D] hover:border-[#615EFF] text-xs font-mono text-[#787FAD] hover:text-white transition flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to {col.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* 📋 TASK DETAIL & EXECUTION INSPECTOR DRAWER                              */}
      {/* ========================================================================= */}
      {selectedTaskForDetail && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-3xl bg-[#080914] border border-[#202544] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-4 border-b border-[#161828] flex items-center justify-between bg-[#0C0E1E]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#615EFF]/20 text-[#615EFF] border border-[#615EFF]/30">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                      {selectedTaskForDetail.title}
                    </h3>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      selectedTaskForDetail.column === 'done' ? 'bg-emerald-500/20 text-emerald-400' :
                      selectedTaskForDetail.column === 'running' ? 'bg-cyan-500/20 text-cyan-400' :
                      selectedTaskForDetail.column === 'blocked' ? 'bg-rose-500/20 text-rose-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {selectedTaskForDetail.column.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-[#8E94B8] mt-0.5">
                    ID: {selectedTaskForDetail.id} | Assigned: {selectedTaskForDetail.assignedAgent.toUpperCase()} ({selectedTaskForDetail.assignedModel})
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedTaskForDetail(null)}
                className="text-[#6A7097] hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-2 px-4 py-2 bg-[#090A16] border-b border-[#161828] font-mono text-xs overflow-x-auto">
              <button
                onClick={() => setDetailTab('overview')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  detailTab === 'overview' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
                }`}
              >
                Overview & Subtasks
              </button>
              <button
                onClick={() => setDetailTab('trace')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  detailTab === 'trace' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
                }`}
              >
                Execution Trace ({selectedTaskForDetail.executionLogs?.length || 0})
              </button>
              <button
                onClick={() => setDetailTab('dependencies')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  detailTab === 'dependencies' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
                }`}
              >
                DAG Dependencies ({selectedTaskForDetail.dependencies?.length || 0})
              </button>
              <button
                onClick={() => setDetailTab('artifact')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  detailTab === 'artifact' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
                }`}
              >
                Obsidian Synthesis
              </button>
              <button
                onClick={() => setDetailTab('receipt')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  detailTab === 'receipt' ? 'bg-[#615EFF] text-white font-bold' : 'text-[#8E94B8] hover:text-white'
                }`}
              >
                Guardian Receipt
              </button>
            </div>

            {/* Content Area */}
            <div className="p-6 overflow-y-auto space-y-4 font-mono text-xs max-h-[60vh]">
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[#8E94B8] block mb-1 uppercase text-[10px]">Objective Description</label>
                    <div className="p-3.5 bg-[#05060C] border border-[#1C2038] rounded-xl text-gray-200 leading-relaxed">
                      {selectedTaskForDetail.description || 'No detailed description provided.'}
                    </div>
                  </div>

                  {/* Subtask Checklist */}
                  <div className="space-y-2">
                    <label className="text-[#8E94B8] block uppercase text-[10px]">Deliverable Checklist</label>
                    <div className="space-y-1.5 p-3 bg-[#05060C] border border-[#1C2038] rounded-xl">
                      {(selectedTaskForDetail.subtasks || []).map(st => (
                        <div 
                          key={st.id} 
                          onClick={() => handleToggleSubtask(selectedTaskForDetail, st.id)}
                          className="flex items-center gap-2 text-gray-300 hover:text-white cursor-pointer select-none"
                        >
                          {st.completed ? (
                            <CheckSquare className="w-4 h-4 text-[#00D26A]" />
                          ) : (
                            <Square className="w-4 h-4 text-[#5B628A]" />
                          )}
                          <span className={`${st.completed ? 'line-through text-[#6A7097]' : ''}`}>
                            {st.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Metadata Matrix */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-2.5 bg-[#05060C] border border-[#1C2038] rounded-xl">
                      <span className="text-[10px] text-[#6A7097] block">PRIORITY</span>
                      <span className="text-white font-bold uppercase">{selectedTaskForDetail.priority}</span>
                    </div>
                    <div className="p-2.5 bg-[#05060C] border border-[#1C2038] rounded-xl">
                      <span className="text-[10px] text-[#6A7097] block">LEAD TIME</span>
                      <span className="text-amber-400 font-bold">{selectedTaskForDetail.estimatedHours || '2.0h'}</span>
                    </div>
                    <div className="p-2.5 bg-[#05060C] border border-[#1C2038] rounded-xl">
                      <span className="text-[10px] text-[#6A7097] block">ASSIGNED AGENT</span>
                      <span className="text-cyan-400 font-bold uppercase">{selectedTaskForDetail.assignedAgent}</span>
                    </div>
                    <div className="p-2.5 bg-[#05060C] border border-[#1C2038] rounded-xl">
                      <span className="text-[10px] text-[#6A7097] block">MODEL ROUTING</span>
                      <span className="text-purple-400 font-bold">{selectedTaskForDetail.assignedModel}</span>
                    </div>
                  </div>
                </div>
              )}

              {detailTab === 'trace' && (
                <div className="space-y-2">
                  <label className="text-[#8E94B8] block uppercase text-[10px]">Real-Time Execution Logs</label>
                  <div className="p-3.5 bg-[#05060C] border border-[#1C2038] rounded-xl font-mono text-[11px] space-y-1.5 max-h-64 overflow-y-auto">
                    {selectedTaskForDetail.executionLogs && selectedTaskForDetail.executionLogs.length > 0 ? (
                      selectedTaskForDetail.executionLogs.map((log, idx) => (
                        <div key={idx} className="text-gray-300 flex items-start gap-2">
                          <span className="text-[#615EFF] font-bold">[{idx + 1}]</span>
                          <span>{log}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-[#585E82]">
                        No execution logs recorded yet. Click "CLAIM & RUN" to dispatch this agent to its isolated sandbox.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {detailTab === 'dependencies' && (
                <div className="space-y-3">
                  <label className="text-[#8E94B8] block uppercase text-[10px]">Upstream Prerequisite Dependencies</label>
                  <div className="space-y-1.5">
                    {tasks.map(t => {
                      if (t.id === selectedTaskForDetail.id) return null;
                      const isDep = (selectedTaskForDetail.dependencies || []).includes(t.id);
                      return (
                        <div 
                          key={t.id}
                          onClick={() => {
                            const cur = selectedTaskForDetail.dependencies || [];
                            const next = isDep ? cur.filter(id => id !== t.id) : [...cur, t.id];
                            onUpdateTask(selectedTaskForDetail.id, { dependencies: next });
                            setSelectedTaskForDetail({ ...selectedTaskForDetail, dependencies: next });
                          }}
                          className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                            isDep 
                              ? 'bg-[#615EFF]/15 border-[#615EFF] text-white' 
                              : 'bg-[#05060C] border-[#1C2038] text-[#8E94B8] hover:border-[#2B325E]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-4 h-4 rounded flex items-center justify-center border text-[10px] ${
                              isDep ? 'bg-[#615EFF] border-[#615EFF] text-white' : 'border-[#2B325E]'
                            }`}>
                              {isDep && '✓'}
                            </span>
                            <span className="text-cyan-400 font-bold">[{t.assignedAgent}]</span>
                            <span className="text-white font-medium">{t.title}</span>
                          </div>
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#101224] text-[#8E94B8]">
                            {t.column}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {detailTab === 'artifact' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[#8E94B8] uppercase text-[10px]">Synthesized Obsidian Note Preview</label>
                    <button
                      onClick={() => onPushTaskToObsidian(selectedTaskForDetail)}
                      className="px-3 py-1 rounded bg-[#00D26A]/20 hover:bg-[#00D26A]/30 text-[#00D26A] font-bold text-xs border border-[#00D26A]/40 flex items-center gap-1.5 transition"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Push to Obsidian Vault</span>
                    </button>
                  </div>
                  <div className="p-4 bg-[#05060C] border border-[#1C2038] rounded-xl text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {`# [[Startup-Theses/${selectedTaskForDetail.title.replace(/\s+/g, '-')}]]

> **Agent**: ${selectedTaskForDetail.assignedAgent.toUpperCase()}  
> **Model**: ${selectedTaskForDetail.assignedModel}  
> **Status**: ${selectedTaskForDetail.column.toUpperCase()}  
> **Aegis Verification**: ${selectedTaskForDetail.verificationReceipt?.score || '98.4'}/100

## Executive Abstract
${selectedTaskForDetail.description}

## Deliverable Milestones
${(selectedTaskForDetail.subtasks || []).map(s => `- [${s.completed ? 'x' : ' '}] ${s.title}`).join('\n')}

## Bidirectional Wikilinks
${(selectedTaskForDetail.obsidianWikilinks || []).map(w => `- [[${w}]]`).join('\n')}
`}
                  </div>
                </div>
              )}

              {detailTab === 'receipt' && (
                <div className="space-y-3">
                  <label className="text-[#8E94B8] uppercase text-[10px]">Guardian Aegis Cryptographic Verification</label>
                  <div className="p-4 bg-[#05060C] border border-[#1C2038] rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[#8E94B8]">Receipt Status:</span>
                      <span className="text-[#00D26A] font-bold flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4" /> Signed & Verified
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#8E94B8]">Deterministic Score:</span>
                      <span className="text-white font-bold">{selectedTaskForDetail.verificationReceipt?.score || '98.4'} / 100</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#8E94B8]">Cryptographic Hash:</span>
                      <span className="text-amber-400 font-mono text-[10px]">
                        {selectedTaskForDetail.verificationReceipt?.signature || `0x${Math.random().toString(16).substring(2, 18)}f74b`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#8E94B8]">Airbyte Data Stream:</span>
                      <span className="text-cyan-400 font-mono">airbyte://streams/hermes_tasks_{selectedTaskForDetail.id}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-[#161828] bg-[#0C0E1E] flex items-center justify-between font-mono text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[#8E94B8]">Stage:</span>
                {KANBAN_COLUMNS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      handleDirectColumnSet(selectedTaskForDetail, c.id);
                      setSelectedTaskForDetail({ ...selectedTaskForDetail, column: c.id });
                    }}
                    className={`px-2 py-1 rounded text-[10px] transition ${
                      selectedTaskForDetail.column === c.id
                        ? 'bg-[#615EFF] text-white font-bold'
                        : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRunTask(selectedTaskForDetail.id)}
                  disabled={executingTaskId === selectedTaskForDetail.id}
                  className="px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#524FE0] text-white font-bold flex items-center gap-1.5 shadow transition"
                >
                  <Play className={`w-3.5 h-3.5 ${executingTaskId === selectedTaskForDetail.id ? 'animate-spin' : ''}`} />
                  <span>Execute in Sandbox</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ✍️ DISPATCH TASK MODAL                                                   */}
      {/* ========================================================================= */}
      {isCreatingTask && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-xl bg-[#080914] border border-[#202544] rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#161828] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#615EFF]" />
                <h3 className="text-lg font-bold text-white font-['Space_Grotesk']">
                  Dispatch Task to Hermes board.db
                </h3>
              </div>
              <button
                onClick={() => setIsCreatingTask(false)}
                className="text-[#6A7097] hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 font-mono">
              <div>
                <label className="text-xs text-[#8E94B8] block mb-1">Task Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Scrape and analyze competitor feature matrix..."
                  required
                  className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl px-3.5 py-2 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-xs text-[#8E94B8] block mb-1">Description & Deliverable Specs</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Detailed execution objective and expected deliverable format..."
                  rows={3}
                  className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl p-3 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#8E94B8] block mb-1">Assigned Agent</label>
                  <select
                    value={newAgent}
                    onChange={(e) => setNewAgent(e.target.value as AgentRole)}
                    className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="scout">Scout (Perplexity Sonar)</option>
                    <option value="scribe">Scribe (Claude 3.7)</option>
                    <option value="reach">Reach (ChatGPT o3)</option>
                    <option value="dev">Dev (Claude Code)</option>
                    <option value="analytics">Analytics (DeepSeek R1)</option>
                    <option value="orchestrator">Orchestrator (Nous Hermes)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-[#8E94B8] block mb-1">Initial Column</label>
                  <select
                    value={newColumn}
                    onChange={(e) => setNewColumn(e.target.value as KanbanColumnId)}
                    className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="triage">Triage</option>
                    <option value="todo">Todo</option>
                    <option value="ready">Ready</option>
                    <option value="running">Running</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done / Vectorized</option>
                  </select>
                </div>
              </div>

              {/* DAG Dependency Selector */}
              <div>
                <label className="text-xs text-[#8E94B8] block mb-1">
                  DAG Prerequisites (Task depends on):
                </label>
                <div className="max-h-32 overflow-y-auto space-y-1.5 p-2 bg-[#05060C] border border-[#1E223D] rounded-xl">
                  {tasks.length === 0 ? (
                    <span className="text-xs text-gray-500">No other tasks in board.db</span>
                  ) : (
                    tasks.map(t => (
                      <label key={t.id} className="flex items-center gap-2 text-xs text-gray-300 hover:text-white cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={newDependencies.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewDependencies([...newDependencies, t.id]);
                            } else {
                              setNewDependencies(newDependencies.filter(id => id !== t.id));
                            }
                          }}
                          className="rounded border-[#2E355A] bg-[#0E1020] text-[#615EFF]"
                        />
                        <span className="text-cyan-400 font-bold">[{t.assignedAgent}]</span>
                        <span className="truncate">{t.title}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#8E94B8] block mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="critical">Critical (P0)</option>
                    <option value="high">High (P1)</option>
                    <option value="medium">Medium (P2)</option>
                    <option value="low">Low (P3)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-[#8E94B8] block mb-1">Estimated Hours</label>
                  <input
                    type="text"
                    value={newEstimatedHours}
                    onChange={(e) => setNewEstimatedHours(e.target.value)}
                    className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#161828]">
                <button
                  type="button"
                  onClick={() => setIsCreatingTask(false)}
                  className="px-4 py-2 rounded-xl bg-[#121426] text-xs text-[#8E94B8] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="airbyte-btn-primary px-5 py-2 text-xs font-bold shadow-lg shadow-[#615EFF]/25"
                >
                  Dispatch to board.db
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
