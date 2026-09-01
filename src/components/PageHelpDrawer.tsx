import React from 'react';
import { HelpCircle, X, CheckCircle2, AlertTriangle, ShieldCheck, Terminal, Lightbulb, PlayCircle, Layers } from 'lucide-react';
import { ActiveTab } from '../types';

export interface PageHelpData {
  title: string;
  what: string;
  why: string;
  how: string[];
  status: 'LIVE' | 'CLIENT PROTOTYPE' | 'HYBRID' | 'SIMULATED' | 'NOT CONNECTED' | 'DEGRADED';
  statusDetail: string;
  example: string;
}

const DEFAULT_PAGE_HELP: Record<string, PageHelpData> = {
  overview: {
    title: 'MISSION CONTROL HQ',
    what: 'Central command dashboard displaying real-time agent state, active runs, task board velocity, and system health.',
    why: 'Provides instant operational clarity across all 6 specialized agent roles and active pipelines without switching views.',
    how: [
      'View active runs and top-level agent status.',
      'Click any agent role or task card to inspect details.',
      'Dispatch quick commands or trigger workforce standups.'
    ],
    status: 'HYBRID',
    statusDetail: 'Integrates local board state with live server-side Gemini router.',
    example: 'Click "Start Tour" or select an agent in the 3D office layout.'
  },
  'hermes-core': {
    title: 'HERMES COMMAND WORKSPACE',
    what: 'Natural-language objective router that automatically dispatches agents, models, tools, and execution graphs.',
    why: 'Operate SynthOS by stating what you want accomplished rather than manually selecting internal subsystems.',
    how: [
      'Type any objective in the natural language bar.',
      'Watch the 10-stage execution timeline process in real-time.',
      'Inspect generated runs, receipts, and vault notes.'
    ],
    status: 'LIVE',
    statusDetail: 'Connected directly to server-side Gemini 2.5/3.7 API endpoints.',
    example: '"Research top emerging AI agent opportunities and write a GTM memo"'
  },
  kanban: {
    title: 'WORK & TASK BOARD (board.db)',
    what: 'State machine managing execution tasks across Backlog, In Progress, Review, and Done stages.',
    why: 'Ensures structured task delegation with assigned agents, models, subtasks, and Obsidian [[wikilinks]].',
    how: [
      'Drag and drop tasks between columns.',
      'Click "Add Task" to delegate new work to specific agents.',
      'Push completed task summaries directly into Obsidian vaults.'
    ],
    status: 'HYBRID',
    statusDetail: 'Persisted in localStorage with board.db schema structure.',
    example: 'Move a task from Backlog to In Progress to dispatch assigned agent.'
  },
  'graph-builder': {
    title: 'GRAPH BUILDER & DAG COMPILER',
    what: 'Visual workflow canvas for composing multi-agent directed acyclic graphs (DAGs).',
    why: 'Build complex, multi-step agent chains with strict 12-field agent contracts and topological validation.',
    how: [
      'Click "+ Add Node to Canvas" to add Trigger, Agent, Model, or Tool nodes.',
      'Connect nodes to define control flow.',
      'Click "Compile & Execute" to validate and run the graph.'
    ],
    status: 'LIVE',
    statusDetail: 'Custom canvas layer with topological sort and graph persistence.',
    example: 'Connect [Trigger] -> [Scout Agent] -> [Gemini Model].'
  },
  ton: {
    title: 'TON NETWORK WORKSPACE',
    what: 'TON blockchain integration center for wallet bindings, Telegram Mini App preview, and Guardian nodes.',
    why: 'Deploy smart contract micro-transactions and Telegram Mini App agents on the TON ecosystem.',
    how: [
      'Inspect connected Tonkeeper / MyTonWallet bindings.',
      'Preview the Telegram Mini App container frame.',
      'Run Guardian node consensus verification checks.'
    ],
    status: 'PARTIAL' as any,
    statusDetail: 'Wallet UI and GraphQL schemas active; mainnet dispatch requires key approval.',
    example: 'Click "Connect Wallet" or "Open Mini App Preview".'
  },
  twins: {
    title: 'TWINS EXECUTIVE CONCIERGE',
    what: 'AI Executive Twin featuring real-time voice streaming, 3D mind visualizer, and delegated actions.',
    why: 'Provides a personal digital twin that learns from your Obsidian notes and handles executive scheduling.',
    how: [
      'Click "Start Voice Session" to speak with ElevenLabs + Gemini 2.5 voice twin.',
      'View the real-time Jarvis Neural Mind Visualizer.',
      'Inspect long-term memory compaction and delegated actions.'
    ],
    status: 'LIVE',
    statusDetail: 'Connected to Fish Audio / ElevenLabs fallback and Gemini voice streaming.',
    example: 'Click "Start Voice Session" and say "Summarize my calendar".'
  },
  demos: {
    title: 'FRONTEND DEMOS LAUNCHER',
    what: 'Catalog of interactive application prototypes built on SynthOS.',
    why: 'Test specialized domain engines including Startup Generator, News Harvester, and Lead Scrapers.',
    how: [
      'Browse demo cards by category.',
      'Click "Launch Demo" to open the interactive sandbox.',
      'Review output notes saved into Obsidian vaults.'
    ],
    status: 'LIVE',
    statusDetail: 'All 6 frontend demo sandboxes fully loaded and executable.',
    example: 'Click "Launch Demo" on Startup Idea Generator.'
  }
};

interface PageHelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab?: ActiveTab;
  data?: PageHelpData;
  onSelectTab?: (tab: ActiveTab) => void;
}

export const PageHelpDrawer: React.FC<PageHelpDrawerProps> = ({ 
  isOpen, 
  onClose, 
  activeTab = 'overview',
  data: customData
}) => {
  if (!isOpen) return null;

  const data = customData || DEFAULT_PAGE_HELP[activeTab] || {
    title: `${activeTab.toUpperCase()} WORKSPACE`,
    what: `Workspace view for managing ${activeTab} capabilities inside SynthOS.`,
    why: 'Supports specialized execution, monitoring, and agent configuration.',
    how: [
      'Inspect the active controls and status indicators.',
      'Execute commands or modify configurations as needed.',
      'View real-time event telemetry in the Activity Pane.'
    ],
    status: 'HYBRID',
    statusDetail: 'Fully integrated with SynthOS state and router.',
    example: 'Explore available tabs and controls.'
  };

  const getStatusBadge = (status: PageHelpData['status']) => {
    switch (status) {
      case 'LIVE':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/40 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> SERVER LIVE</span>;
      case 'HYBRID':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40 flex items-center gap-1"><Layers className="w-3 h-3"/> HYBRID (CLIENT + API)</span>;
      case 'CLIENT PROTOTYPE':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#A5A2FF]/20 text-[#A5A2FF] border border-[#A5A2FF]/40 flex items-center gap-1"><Terminal className="w-3 h-3"/> CLIENT PROTOTYPE</span>;
      case 'SIMULATED':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40 flex items-center gap-1"><PlayCircle className="w-3 h-3"/> SIMULATED DEMO</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> ACTIVE</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div 
        className="w-full max-w-lg bg-[#0B0D1B] border-l border-[#1D2139] shadow-2xl h-full flex flex-col justify-between font-mono p-6 overflow-y-auto animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-6">
          {/* Drawer Header */}
          <div className="flex items-start justify-between pb-4 border-b border-[#1A1E36]">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-[#615EFF]" />
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">{data.title}</h3>
              </div>
              <p className="text-xs text-[#8E94B8]">Page Guide & Architecture Reference</p>
            </div>
            <button 
              onClick={onClose} 
              className="p-1.5 rounded-lg bg-[#14182E] text-[#8E94B8] hover:text-white hover:bg-[#1E2342] transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Section 1: What is this? */}
          <div className="space-y-2 bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#A5A2FF]">
              <Layers className="w-4 h-4 text-[#615EFF]" />
              <span>WHAT IS THIS?</span>
            </div>
            <p className="text-xs text-[#C5C9E0] leading-relaxed font-sans">{data.what}</p>
          </div>

          {/* Section 2: Why use it? */}
          <div className="space-y-2 bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#38BDF8]">
              <Lightbulb className="w-4 h-4 text-[#38BDF8]" />
              <span>WHY USE IT?</span>
            </div>
            <p className="text-xs text-[#C5C9E0] leading-relaxed font-sans">{data.why}</p>
          </div>

          {/* Section 3: How to use it? */}
          <div className="space-y-2 bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#00D26A]">
              <Terminal className="w-4 h-4 text-[#00D26A]" />
              <span>HOW TO USE IT?</span>
            </div>
            <ul className="space-y-1.5 text-xs text-[#C5C9E0] font-sans">
              {data.how.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-[#615EFF] font-mono font-bold text-[10px] mt-0.5">{idx + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Section 4: Current Status */}
          <div className="space-y-2 bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#8E94B8]">CAPABILITY STATUS:</span>
              {getStatusBadge(data.status)}
            </div>
            <p className="text-xs text-[#8E94B8] font-sans pt-1 border-t border-[#171A2E]">{data.statusDetail}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-[#1D2139] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#615EFF] text-white text-xs font-bold hover:bg-[#504ACC] transition cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
