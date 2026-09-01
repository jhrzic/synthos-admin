import React, { useState, useEffect } from 'react';
import { 
  Play, CheckCircle2, Clock, AlertCircle, Sparkles, Youtube, 
  ArrowRight, ShieldCheck, Database, Layers, ExternalLink, Bot,
  Cpu, Activity, RefreshCw, X, ChevronRight, FileText, CheckSquare,
  BarChart3, Code2, Rocket, Zap, Crown, Search, Filter
} from 'lucide-react';
import { KanbanTask, ObsidianNote } from '../types';

interface JulianGoldieAuditRunnerProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTasksToKanban: (tasks: KanbanTask[]) => void;
  onAddNoteToObsidian: (note: ObsidianNote) => void;
}

export interface AuditVideo {
  title: string;
  url: string;
  videoId: string;
  publishDate: string;
  duration: string;
  description: string;
  viewCount: string;
  transcriptAvailable: boolean;
  transcriptSource: string;
  summaryBullets: string[];
  keyClaims: string[];
  actionableTactics: string[];
  toolsMentioned: string[];
  seoAeoGeoTechniques: string[];
  agenticAiMethods: string[];
  businessOpportunities: string[];
  synthosRelevance: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  synthosRelevanceReason: string;
}

export interface MatrixItem {
  idea: string;
  sourceVideo: string;
  whatItDoes: string;
  synthosAlreadyHasIt: boolean;
  currentSynthosComponent: string;
  missingPieces: string;
  value: string;
  effort: string;
  risk: string;
  recommendation: string;
  priority: string;
}

export interface ImplementationBacklogTask {
  title: string;
  sourceVideo: string;
  sourceTimestamp: string;
  whyThisMatters: string;
  currentSynthosComponent: string;
  requiredChange: string;
  dependencies: string[];
  agentOwner: string;
  modelPolicy: string;
  acceptanceCriteria: string;
  estimatedComplexity: string;
}

export interface TaskStep {
  id: string;
  title: string;
  agent: string;
  model: string;
  whyModel: string;
  fallbackModel: string;
  column: 'backlog' | 'in-progress' | 'review' | 'done';
}

const INITIAL_TASK_STEPS: TaskStep[] = [
  {
    id: 'task-1',
    title: 'DISCOVER RECENT VIDEOS',
    agent: 'Research Agent (Scout)',
    model: 'gemini-3.7-flash',
    whyModel: 'Optimized for long context & real-time Google/YouTube Search grounding',
    fallbackModel: 'perplexity-sonar-huge',
    column: 'backlog'
  },
  {
    id: 'task-2',
    title: 'FETCH VIDEO METADATA',
    agent: 'Research Agent (Scout)',
    model: 'gemini-3.7-flash',
    whyModel: 'Fast JSON schema extraction for durations & publish dates',
    fallbackModel: 'openai-gpt4o-mini',
    column: 'backlog'
  },
  {
    id: 'task-3',
    title: 'OBTAIN TRANSCRIPTS',
    agent: 'Research Agent (Scout)',
    model: 'openclaw-browser',
    whyModel: 'Headless DOM & caption API extractor for YouTube captions',
    fallbackModel: 'metadata-fallback-parser',
    column: 'backlog'
  },
  {
    id: 'task-4',
    title: 'SUMMARIZE EACH VIDEO',
    agent: 'Analyst Agent (Scribe)',
    model: 'gemini-3.7-flash',
    whyModel: 'High throughput fast summarization with bullet points',
    fallbackModel: 'claude-3-5-haiku',
    column: 'backlog'
  },
  {
    id: 'task-5',
    title: 'EXTRACT KEY IDEAS',
    agent: 'Analyst Agent (Scribe)',
    model: 'deepseek-r1',
    whyModel: 'Deep chain-of-thought analysis for semantic claim extraction',
    fallbackModel: 'gemini-3.1-pro-preview',
    column: 'backlog'
  },
  {
    id: 'task-6',
    title: 'EXTRACT TOOLS / PRODUCTS / REPOS',
    agent: 'Engineering Agent (Dev)',
    model: 'claudecode-3.7',
    whyModel: 'Specialized in technical repo, SDK, and API tool parsing',
    fallbackModel: 'codex-o3-mini',
    column: 'backlog'
  },
  {
    id: 'task-7',
    title: 'EXTRACT SEO / AEO / GEO STRATEGIES',
    agent: 'SEO / Growth Agent (Reach)',
    model: 'chatgpt-o3-mini',
    whyModel: 'High precision strategy classification for AEO & GEO content loops',
    fallbackModel: 'gemini-3.7-flash',
    column: 'backlog'
  },
  {
    id: 'task-8',
    title: 'EXTRACT AGENTIC WORKFLOW IDEAS',
    agent: 'SynthOS Strategy Agent',
    model: 'claude-3-7-sonnet',
    whyModel: 'Architectural reasoning for multi-agent browser patterns',
    fallbackModel: 'gemini-3.1-pro-preview',
    column: 'backlog'
  },
  {
    id: 'task-9',
    title: 'COMPARE WITH SYNTHOS CURRENT CAPABILITIES',
    agent: 'SynthOS Strategy Agent',
    model: 'claude-3-7-sonnet',
    whyModel: 'Full system context mapping across Graph Builder, Model Router & Vaults',
    fallbackModel: 'deepseek-r1',
    column: 'backlog'
  },
  {
    id: 'task-10',
    title: 'IDENTIFY DUPLICATES',
    agent: 'SynthOS Strategy Agent',
    model: 'gemini-3.7-flash',
    whyModel: 'Fast feature matrix deduplication',
    fallbackModel: 'chatgpt-4o-mini',
    column: 'backlog'
  },
  {
    id: 'task-11',
    title: 'IDENTIFY MISSING CAPABILITIES',
    agent: 'Engineering Agent (Dev)',
    model: 'claudecode-3.7',
    whyModel: 'Deep codebase gap analysis',
    fallbackModel: 'codex-o3-mini',
    column: 'backlog'
  },
  {
    id: 'task-12',
    title: 'ASSESS TECHNICAL FEASIBILITY',
    agent: 'Engineering Agent (Dev)',
    model: 'claude-3-7-sonnet',
    whyModel: 'Precise effort vs complexity estimation',
    fallbackModel: 'gemini-3.1-pro-preview',
    column: 'backlog'
  },
  {
    id: 'task-13',
    title: 'RANK INTEGRATION OPPORTUNITIES',
    agent: 'SynthOS Strategy Agent',
    model: 'deepseek-r1',
    whyModel: 'Reasoning prioritization framework for P0/P1 items',
    fallbackModel: 'claude-3-7-sonnet',
    column: 'backlog'
  },
  {
    id: 'task-14',
    title: 'CREATE FINAL RECOMMENDATIONS',
    agent: 'Orchestrator (Hermes 3)',
    model: 'claude-3-7-sonnet',
    whyModel: 'Executive synthesis and decision sign-off',
    fallbackModel: 'gemini-3.1-pro-preview',
    column: 'backlog'
  },
  {
    id: 'task-15',
    title: 'GENERATE IMPLEMENTATION BACKLOG',
    agent: 'Orchestrator (Hermes 3)',
    model: 'gemini-3.7-flash',
    whyModel: 'Structured Kanban task payload generation',
    fallbackModel: 'openai-gpt4o',
    column: 'backlog'
  }
];

export const JulianGoldieAuditRunner: React.FC<JulianGoldieAuditRunnerProps> = ({
  isOpen,
  onClose,
  onAddTasksToKanban,
  onAddNoteToObsidian
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [taskSteps, setTaskSteps] = useState<TaskStep[]>(INITIAL_TASK_STEPS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  
  // Execution Lock Ref to strictly prevent duplicate parallel runs
  const isExecutingRef = React.useRef(false);

  // Results from Backend
  const [auditResults, setAuditResults] = useState<{
    videos: AuditVideo[];
    matrix: MatrixItem[];
    implementationTasks: ImplementationBacklogTask[];
    finalArtifact: {
      id: string;
      title: string;
      folder: string;
      wikilinks: string[];
      content: string;
      updatedAt: string;
    };
    honestyStatus: {
      videoDiscovery: string;
      transcriptIngestion: string;
      agentExecution: string;
      aegisVerification: string;
    };
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'kanban' | 'graph' | 'videos' | 'matrix' | 'artifact'>('kanban');

  // Load persisted audit results from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('synthos.julian_goldie_audit.state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.auditResults) {
          setAuditResults(parsed.auditResults);
        }
        if (parsed.taskSteps) {
          setTaskSteps(parsed.taskSteps);
        }
      }
    } catch (e) {
      console.warn('Failed to load audit state from localStorage:', e);
    }
  }, []);

  // Save audit results to localStorage when updated
  useEffect(() => {
    if (auditResults) {
      try {
        localStorage.setItem('synthos.julian_goldie_audit.state', JSON.stringify({
          auditResults,
          taskSteps
        }));
      } catch (e) {
        console.warn('Failed to persist audit state:', e);
      }
    }
  }, [auditResults, taskSteps]);

  // Elapsed Timer Effect
  useEffect(() => {
    let interval: any = null;
    if (isRunning) {
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isOpen) return null;

  const handleStartAnalysis = async () => {
    // 1. Strict execution lock: prevent duplicate clicks or re-entrant executions
    if (isExecutingRef.current || isRunning) {
      console.warn('[YouTube Audit] Execution already in progress, ignoring duplicate call.');
      return;
    }

    isExecutingRef.current = true;
    setIsRunning(true);
    setElapsedSeconds(0);
    setBlockedError(null);
    setStatusLog(['[Orchestrator] Initiating 4-Day Julian Goldie YouTube Intelligence Audit...']);

    // Step 1: Mark Task #1 as in-progress, rest in backlog
    const initialSteps = INITIAL_TASK_STEPS.map((step, idx) => ({
      ...step,
      column: idx === 0 ? ('in-progress' as const) : ('backlog' as const)
    }));
    setTaskSteps(initialSteps);

    try {
      setStatusLog((prev) => [
        ...prev,
        '[Scout] Executing Task #1: DISCOVER RECENT VIDEOS via YouTube RSS Feed for UCGpsgNbzdF7BECCVbB1COHw...'
      ]);

      // Call authoritative server endpoint
      const res = await fetch('/api/youtube/julian-goldie-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: `run_${Date.now()}` })
      });

      const data = await res.json();

      if (data.status === 'BLOCKED' || !data.success) {
        // Discovery validation gate failed or API key missing
        const errorReason = data.error || data.reason || 'Discovery validation gate failed.';
        setBlockedError(errorReason);
        setStatusLog((prev) => [
          ...prev,
          `[Scout Error] ${errorReason}`,
          '[Aegis] Execution halted. Downstream tasks remain WAITING.'
        ]);

        // Mark Task #1 as failed, downstream tasks remain in backlog
        setTaskSteps((steps) =>
          steps.map((s, idx) => ({
            ...s,
            column: idx === 0 ? ('backlog' as const) : ('backlog' as const)
          }))
        );
        return;
      }

      // Step 2: Analysis Succeeded! Progress tasks sequentially to DONE
      setTaskSteps((steps) =>
        steps.map((s, idx) => ({
          ...s,
          column: idx < 13 ? ('done' as const) : ('review' as const)
        }))
      );

      setAuditResults({
        videos: data.videos,
        matrix: data.matrix,
        implementationTasks: data.implementationTasks,
        finalArtifact: data.finalArtifact,
        honestyStatus: data.honestyStatus
      });

      setStatusLog((prev) => [
        ...prev,
        `[Scout] Discovered ${data.totalVideosFound} videos in last 96 hours (${data.transcriptsAvailableCount} transcripts ingested).`,
        `[Analyst] Multi-agent analysis complete using model router (${data.modelUsed}).`,
        `[Aegis] Verified claims and generated Vault note [[${data.finalArtifact.title}]].`,
        `[Orchestrator] Audit complete! ${data.implementationTasks.length} P0/P1 tasks ready in REVIEW.`
      ]);

      // Automatically push Vault Note artifact to Obsidian state
      if (data.finalArtifact) {
        onAddNoteToObsidian({
          id: data.finalArtifact.id,
          title: data.finalArtifact.title,
          folder: data.finalArtifact.folder,
          wikilinks: data.finalArtifact.wikilinks,
          content: data.finalArtifact.content,
          path: `Startup-Theses/${data.finalArtifact.title}.md`,
          createdAt: new Date().toISOString(),
          updatedAt: data.finalArtifact.updatedAt,
          tags: ['julian-goldie', 'seo', 'aeo', 'geo', 'audit']
        });
      }

      // Push P0/P1 implementation tasks into main Kanban state
      if (data.implementationTasks) {
        const kanbanItems: KanbanTask[] = data.implementationTasks.map((item: ImplementationBacklogTask, idx: number) => ({
          id: `task-jg-p${idx + 1}-${Date.now()}`,
          title: item.title,
          description: `**Source**: ${item.sourceVideo} (${item.sourceTimestamp})\n\n**Why This Matters**: ${item.whyThisMatters}\n\n**Required Change**: ${item.requiredChange}\n\n**Acceptance Criteria**: ${item.acceptanceCriteria}`,
          column: 'review',
          assignedAgent: (item.agentOwner as any) || 'orchestrator',
          assignedModel: item.modelPolicy.includes('perplexity') ? 'perplexity' : 'claude',
          priority: 'critical',
          tags: ['julian-goldie-audit', 'P0-IMPLEMENT-NOW', 'aeo-geo'],
          obsidianWikilinks: ['Startup-Theses/Julian-Goldie-Audit', 'Aegis-Receipts/Verification'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          category: 'research'
        }));
        onAddTasksToKanban(kanbanItems);
      }

    } catch (err: any) {
      setBlockedError(err?.message || 'Failed to communicate with YouTube audit endpoint');
      setStatusLog((prev) => [...prev, `[System Error] Failed to complete audit: ${err.message}`]);
    } finally {
      setIsRunning(false);
      isExecutingRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0D19]/90 backdrop-blur-md flex items-center justify-center p-4 md:p-6 overflow-y-auto">
      <div className="bg-[#121528] border border-[#232845] rounded-xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-[#181C33] p-4 border-b border-[#232845] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
              <Youtube className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-white font-bold text-lg tracking-wide">
                  Julian Goldie — 4 Day Intelligence Audit
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/40">
                  REAL EXECUTABLE WORKFLOW
                </span>
              </div>
              <p className="text-xs text-[#8E94B8]">
                Multi-agent analysis of YouTube channel <span className="text-[#38BDF8]">@JulianGoldieSEO</span> (Previous 4 Days)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isRunning && (
              <button
                onClick={handleStartAnalysis}
                className="px-4 py-2 rounded-lg bg-[#615EFF] hover:bg-[#4E4BFF] text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#615EFF]/25 transition-all"
              >
                <Play className="w-4 h-4 fill-white" />
                {auditResults ? 'RE-RUN ANALYSIS' : 'START ANALYSIS'}
              </button>
            )}

            {isRunning && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#615EFF]/15 border border-[#615EFF]/30 text-xs font-mono text-[#8C8AFF]">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#615EFF]" />
                EXECUTING ({elapsedSeconds}s)
              </div>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#1C203B] text-[#8E94B8] hover:text-white hover:bg-[#252A4A] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Blocked Error Banner if Validation Fails */}
        {blockedError && (
          <div className="bg-red-500/10 border-b border-red-500/30 p-3 px-4 flex items-center justify-between text-xs text-red-300 font-mono">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span><strong>AUDIT BLOCKED:</strong> {blockedError}</span>
            </div>
            <button
              onClick={() => setBlockedError(null)}
              className="text-red-400 hover:text-white text-xs underline ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Status Bar / Honesty Badge Bar */}
        <div className="bg-[#14172B] px-4 py-2 border-b border-[#232845] flex items-center justify-between text-xs font-mono text-[#8E94B8] overflow-x-auto">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#00D26A]" />
              Video Discovery: <strong className="text-white">{auditResults?.honestyStatus.videoDiscovery || 'LIVE'}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#38BDF8]" />
              Transcript Ingestion: <strong className="text-white">{auditResults?.honestyStatus.transcriptIngestion || 'LIVE'}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#EC4899]" />
              Model Router: <strong className="text-white">ACTIVE (Dynamic)</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
              Aegis Verification: <strong className="text-white">{auditResults?.honestyStatus.aegisVerification || 'LIVE'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span>Target Channel: <strong>@JulianGoldieSEO</strong></span>
            <span>|</span>
            <span>Date Window: <strong>Last 4 Days</strong></span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-[#101324] px-4 pt-2 border-b border-[#232845] flex items-center gap-2">
          {[
            { id: 'kanban', label: 'WORKFLOW KANBAN (15 TASKS)', icon: CheckSquare },
            { id: 'graph', label: 'EXECUTION GRAPH / PLAN', icon: Layers },
            { id: 'videos', label: `DISCOVERED VIDEOS (${auditResults?.videos.length || 0})`, icon: Youtube },
            { id: 'matrix', label: 'SYNTHOS INTEGRATION MATRIX', icon: BarChart3 },
            { id: 'artifact', label: 'FINAL VAULT ARTIFACT', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-2 text-xs font-bold tracking-wide rounded-t-lg transition-all flex items-center gap-2 ${
                  isActive
                    ? 'bg-[#121528] text-white border-t-2 border-[#615EFF]'
                    : 'text-[#8E94B8] hover:text-white hover:bg-[#181C33]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#615EFF]' : 'text-[#8E94B8]'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0E101F]">
          
          {/* TAB 1: KANBAN WORKFLOW */}
          {activeTab === 'kanban' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-[#14172B] p-3 rounded-lg border border-[#232845] flex justify-between items-center">
                  <span className="text-[#8E94B8]">BACKLOG</span>
                  <span className="px-2 py-0.5 rounded bg-[#1C203B] text-white font-bold">
                    {taskSteps.filter((t) => t.column === 'backlog').length}
                  </span>
                </div>
                <div className="bg-[#14172B] p-3 rounded-lg border border-[#232845] flex justify-between items-center">
                  <span className="text-[#8C8AFF]">IN PROGRESS</span>
                  <span className="px-2 py-0.5 rounded bg-[#615EFF]/20 text-[#8C8AFF] font-bold">
                    {taskSteps.filter((t) => t.column === 'in-progress').length}
                  </span>
                </div>
                <div className="bg-[#14172B] p-3 rounded-lg border border-[#232845] flex justify-between items-center">
                  <span className="text-[#EAB308]">UNDER REVIEW</span>
                  <span className="px-2 py-0.5 rounded bg-[#EAB308]/20 text-[#EAB308] font-bold">
                    {taskSteps.filter((t) => t.column === 'review').length}
                  </span>
                </div>
                <div className="bg-[#14172B] p-3 rounded-lg border border-[#232845] flex justify-between items-center">
                  <span className="text-[#00D26A]">DONE</span>
                  <span className="px-2 py-0.5 rounded bg-[#00D26A]/20 text-[#00D26A] font-bold">
                    {taskSteps.filter((t) => t.column === 'done').length}
                  </span>
                </div>
              </div>

              {/* Task Cards List */}
              <div className="space-y-2">
                {taskSteps.map((task, idx) => (
                  <div
                    key={task.id}
                    className={`p-3 rounded-lg border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      task.column === 'in-progress'
                        ? 'bg-[#181D3B] border-[#615EFF] shadow-lg shadow-[#615EFF]/10'
                        : task.column === 'done'
                        ? 'bg-[#12162B] border-[#202747] opacity-85'
                        : 'bg-[#121528] border-[#1E233D]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-xs font-bold text-[#8E94B8] w-6">
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-white font-bold text-xs">{task.title}</h4>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                              task.column === 'done'
                                ? 'bg-[#00D26A]/15 text-[#00D26A]'
                                : task.column === 'in-progress'
                                ? 'bg-[#615EFF]/20 text-[#8C8AFF] animate-pulse'
                                : 'bg-[#1C203B] text-[#8E94B8]'
                            }`}
                          >
                            {task.column}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#8E94B8] mt-0.5">
                          Assigned: <strong className="text-[#38BDF8]">{task.agent}</strong>
                        </p>
                      </div>
                    </div>

                    {/* Model Router Policy Badge */}
                    <div className="bg-[#0E1122] p-2 rounded border border-[#1E233D] text-[11px] font-mono flex flex-col md:items-end gap-0.5">
                      <div className="flex items-center gap-1.5 text-white">
                        <Cpu className="w-3 h-3 text-[#EC4899]" />
                        <span>MODEL: <strong className="text-[#A5A2FF]">{task.model}</strong></span>
                      </div>
                      <div className="text-[#8E94B8] text-[10px]">
                        Why: {task.whyModel}
                      </div>
                      <div className="text-[10px] text-[#615EFF]">
                        Fallback: {task.fallbackModel}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: GRAPH / PLAN */}
          {activeTab === 'graph' && (
            <div className="space-y-4">
              <div className="bg-[#14172B] p-4 rounded-xl border border-[#232845]">
                <h3 className="text-white font-bold text-sm mb-2 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#615EFF]" />
                  Execution DAG Topology
                </h3>
                <p className="text-xs text-[#8E94B8] mb-4">
                  Visual node dependency graph showing real-time multi-agent execution pipeline.
                </p>

                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="px-4 py-2 bg-[#1C203B] border border-[#38BDF8] rounded-lg text-white font-mono text-xs font-bold text-center w-64 shadow-lg shadow-[#38BDF8]/10">
                    YOUTUBE CHANNEL: @JulianGoldieSEO
                  </div>
                  <div className="w-0.5 h-6 bg-[#38BDF8]" />
                  <div className="px-4 py-2 bg-[#181D3B] border border-[#615EFF] rounded-lg text-white font-mono text-xs font-bold text-center w-64">
                    SCOUT: Video Discovery & Transcripts
                  </div>
                  <div className="w-0.5 h-6 bg-[#615EFF]" />
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 w-full max-w-4xl">
                    <div className="p-3 bg-[#121528] border border-[#232845] rounded-lg text-center">
                      <span className="text-[10px] font-mono text-[#20B2AA]">RESEARCH AGENT</span>
                      <p className="text-xs font-bold text-white mt-1">Metadata Ingestion</p>
                    </div>
                    <div className="p-3 bg-[#121528] border border-[#232845] rounded-lg text-center">
                      <span className="text-[10px] font-mono text-[#8B5CF6]">ANALYST AGENT</span>
                      <p className="text-xs font-bold text-white mt-1">Summary & Claims</p>
                    </div>
                    <div className="p-3 bg-[#121528] border border-[#232845] rounded-lg text-center">
                      <span className="text-[10px] font-mono text-[#F59E0B]">SEO / GROWTH</span>
                      <p className="text-xs font-bold text-white mt-1">GEO & AEO Tactics</p>
                    </div>
                    <div className="p-3 bg-[#121528] border border-[#232845] rounded-lg text-center">
                      <span className="text-[10px] font-mono text-[#00D26A]">DEV ENGINEER</span>
                      <p className="text-xs font-bold text-white mt-1">Tech Feasibility</p>
                    </div>
                  </div>

                  <div className="w-0.5 h-6 bg-[#EC4899]" />
                  <div className="px-4 py-2 bg-[#1C203B] border border-[#EC4899] rounded-lg text-white font-mono text-xs font-bold text-center w-64">
                    SYNTHOS COMPONENT COMPARISON
                  </div>
                  <div className="w-0.5 h-6 bg-[#F59E0B]" />
                  <div className="px-4 py-2 bg-[#1C203B] border border-[#F59E0B] rounded-lg text-white font-mono text-xs font-bold text-center w-64">
                    AEGIS VERIFICATION & HASH SIGNATURE
                  </div>
                  <div className="w-0.5 h-6 bg-[#00D26A]" />
                  <div className="px-4 py-2 bg-[#122E22] border border-[#00D26A] rounded-lg text-[#00D26A] font-mono text-xs font-bold text-center w-64 shadow-lg shadow-[#00D26A]/10">
                    FINAL VAULT NOTE & KANBAN P0 TASKS
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: DISCOVERED VIDEOS */}
          {activeTab === 'videos' && (
            <div className="space-y-4">
              {auditResults?.videos ? (
                auditResults.videos.map((vid, idx) => (
                  <div key={idx} className="bg-[#14172B] p-4 rounded-xl border border-[#232845] space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#232845] pb-3">
                      <div>
                        <a
                          href={vid.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-white font-bold text-sm hover:text-[#38BDF8] flex items-center gap-1.5"
                        >
                          {vid.title}
                          <ExternalLink className="w-3.5 h-3.5 text-[#8E94B8]" />
                        </a>
                        <div className="flex items-center gap-3 text-xs text-[#8E94B8] mt-1 font-mono">
                          <span>Published: {vid.publishDate}</span>
                          <span>Duration: {vid.duration}</span>
                          <span>Views: {vid.viewCount}</span>
                          <span className="text-[#38BDF8]">{vid.transcriptSource}</span>
                        </div>
                      </div>

                      <div className="px-3 py-1 rounded text-xs font-mono font-bold bg-[#615EFF]/15 text-[#8C8AFF] border border-[#615EFF]/30">
                        SynthOS Relevance: {vid.synthosRelevance}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div>
                        <h5 className="font-bold text-[#A5A2FF] mb-1">Key Summary Points:</h5>
                        <ul className="list-disc list-inside space-y-1 text-[#C3C7E5]">
                          {vid.summaryBullets?.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <h5 className="font-bold text-[#00D26A] mb-1">Actionable Tactics & Tools:</h5>
                        <ul className="list-disc list-inside space-y-1 text-[#C3C7E5]">
                          {vid.actionableTactics?.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                        <div className="mt-2 text-[11px] font-mono text-[#8E94B8]">
                          Tools: <strong className="text-white">{vid.toolsMentioned?.join(', ')}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-[#8E94B8] font-mono text-xs">
                  Click "START ANALYSIS" above to discover and analyze videos in real time.
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SYNTHOS INTEGRATION MATRIX */}
          {activeTab === 'matrix' && (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#181C33] text-[#8E94B8] font-mono border-b border-[#232845]">
                      <th className="p-3">IDEA / TACTIC</th>
                      <th className="p-3">SOURCE VIDEO</th>
                      <th className="p-3">SYNTHOS STATUS</th>
                      <th className="p-3">RECOMMENDATION</th>
                      <th className="p-3">PRIORITY</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1C203B] text-white">
                    {auditResults?.matrix ? (
                      auditResults.matrix.map((row, i) => (
                        <tr key={i} className="hover:bg-[#14172B]">
                          <td className="p-3 font-bold">{row.idea}</td>
                          <td className="p-3 text-[#8E94B8]">{row.sourceVideo}</td>
                          <td className="p-3 font-mono">
                            <span className="px-2 py-0.5 rounded bg-[#00D26A]/15 text-[#00D26A] font-bold">
                              ALREADY EXISTS ({row.currentSynthosComponent})
                            </span>
                          </td>
                          <td className="p-3 text-[#C3C7E5]">{row.recommendation}</td>
                          <td className="p-3 font-mono font-bold text-[#EAB308]">
                            {row.priority}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-[#8E94B8] font-mono">
                          Matrix will be populated once the audit executes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: FINAL VAULT ARTIFACT */}
          {activeTab === 'artifact' && (
            <div className="bg-[#14172B] p-4 md:p-6 rounded-xl border border-[#232845] text-xs text-[#C3C7E5] font-mono leading-relaxed whitespace-pre-wrap">
              {auditResults?.finalArtifact ? (
                auditResults.finalArtifact.content
              ) : (
                <div className="text-center py-12 text-[#8E94B8]">
                  Vault markdown document will be rendered here upon audit completion.
                </div>
              )}
            </div>
          )}

        </div>

        {/* Console Log Bottom Drawer */}
        <div className="bg-[#0B0D18] p-3 border-t border-[#232845] font-mono text-[11px] text-[#8E94B8] max-h-32 overflow-y-auto">
          <div className="flex items-center justify-between font-bold text-white mb-1 text-[10px]">
            <span>SYSTEM CONSOLE LOGS</span>
            <span>{statusLog.length} EVENTS</span>
          </div>
          {statusLog.map((line, i) => (
            <div key={i} className="text-[#A5A2FF] font-mono">
              {line}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
};
