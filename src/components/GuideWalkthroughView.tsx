import React, { useState } from 'react';
import { GuideStep, ActiveTab } from '../types';
import { 
  BookOpen, CheckCircle2, Circle, Code2, Terminal, 
  ChevronDown, ChevronUp, Search, Filter, Sparkles, 
  RefreshCw, Play, Copy, Check, ExternalLink, ShieldCheck,
  Layers, ArrowRight
} from 'lucide-react';

interface GuideWalkthroughViewProps {
  steps: GuideStep[];
  onToggleStep: (stepId: string) => void;
  onResetProgress?: () => void;
  onSelectTab: (tab: ActiveTab) => void;
}

export const GuideWalkthroughView: React.FC<GuideWalkthroughViewProps> = ({
  steps,
  onToggleStep,
  onResetProgress,
  onSelectTab,
}) => {
  const [selectedPart, setSelectedPart] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedParts, setExpandedParts] = useState<Record<number, boolean>>({
    1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true
  });
  const [executionFeedback, setExecutionFeedback] = useState<string | null>(null);

  const completedCount = steps.filter(s => s.completed).length;
  const totalCount = steps.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const parts = [
    { num: 1, title: 'Part 01 — Foundation & Orchestrator Rules' },
    { num: 2, title: 'Part 02 — Specialist Fleet Setup' },
    { num: 3, title: 'Part 03 — Telemetry & Log Retention' },
    { num: 4, title: 'Part 04 — Telegram Routing Mesh (Threads 101-106)' },
    { num: 5, title: 'Part 05 — Read-Only Server & Data Layer' },
    { num: 6, title: 'Part 06 — Mission Control Dashboard Wiring' },
    { num: 7, title: 'Part 07 — Remote Access & Office 3D Glow' },
    { num: 8, title: 'Part 08 — Troubleshooting & Diagnostic Fixes' },
  ];

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleSimulateExecution = (step: GuideStep) => {
    setExecutionFeedback(`Executed step ${step.stepNumber} [${step.title}]: Diagnostic check passed with 100% compliance.`);
    setTimeout(() => setExecutionFeedback(null), 4000);
  };

  const togglePartExpand = (partNum: number) => {
    setExpandedParts(prev => ({ ...prev, [partNum]: !prev[partNum] }));
  };

  const filteredSteps = steps.filter(step => {
    const matchesPart = selectedPart === 'all' || step.partNumber === selectedPart;
    const matchesQuery = !searchQuery.trim() || 
      step.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      step.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (step.codeSnippet && step.codeSnippet.toLowerCase().includes(searchQuery.toLowerCase())) ||
      step.stepNumber.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPart && matchesQuery;
  });

  const getTabJumpForStep = (stepNumber: string): { tab: ActiveTab; label: string } | null => {
    if (stepNumber === '11' || stepNumber === '12' || stepNumber === '13' || stepNumber === '14' || stepNumber === '15a' || stepNumber === '15b' || stepNumber === '25' || stepNumber === 'T1') {
      return { tab: 'telegram-chat', label: 'Open Telegram Mesh' };
    }
    if (stepNumber === '24' || stepNumber === 'T2') {
      return { tab: 'kanban', label: 'Open Kanban (board.db)' };
    }
    if (stepNumber === '26' || stepNumber === '27') {
      return { tab: 'content-library', label: 'Open Content Library' };
    }
    if (stepNumber === '28') {
      return { tab: 'schedule-cron', label: 'Open Hermes Cron' };
    }
    if (stepNumber === '29' || stepNumber === '30' || stepNumber === '22') {
      return { tab: 'overview', label: 'Open Mission Control' };
    }
    if (stepNumber === '31' || stepNumber === '32') {
      return { tab: 'system-diagnostics', label: 'Open Infrastructure' };
    }
    if (stepNumber === '5' || stepNumber === '6' || stepNumber === '7' || stepNumber === '23') {
      return { tab: 'agent-fleet', label: 'Open Fleet Roster' };
    }
    return null;
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-[#080913] border border-[#181B2E] p-6 rounded-2xl shadow-xl">
        <div className="space-y-2 max-w-3xl">
          <div className="inline-flex items-center gap-2">
            <span className="airbyte-badge">
              HERMES MISSION CONTROL CURRICULUM • PARTS 01 - 08
            </span>
            <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30 font-bold">
              34 STEPS INTEGRATED
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white font-['Space_Grotesk']">
            32-Step Swarm Curriculum & Guide Walkthrough
          </h2>
          <p className="text-xs text-[#8E94B8] leading-relaxed">
            Step-by-step master checklist implementing the NousResearch Hermes AgentOS Mission Control architecture. 
            Covers fleet isolation, Telegram thread routing (101-106), board.db state machine, and diagnostic recovery harnesses.
          </p>
        </div>

        {/* Progress Card */}
        <div className="bg-[#0A0C1B] border border-[#1E223D] p-5 rounded-xl min-w-[260px] space-y-3 shrink-0">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-[#8E94B8]">CURRICULUM PROGRESS</span>
            <span className="text-[#00D26A] font-bold">{progressPercent}%</span>
          </div>

          <div className="w-full h-2.5 bg-[#121528] rounded-full overflow-hidden border border-[#202542]">
            <div 
              className="h-full bg-gradient-to-r from-[#615EFF] via-[#8C8AFF] to-[#00D26A] transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-white font-bold">{completedCount} of {totalCount} Steps Completed</span>
            {onResetProgress && (
              <button
                onClick={onResetProgress}
                className="text-[#6A7097] hover:text-[#EC4899] transition underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Execution Feedback Notification */}
      {executionFeedback && (
        <div className="p-4 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl flex items-center justify-between text-xs font-mono text-[#00D26A]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-[#00D26A]" />
            <span>{executionFeedback}</span>
          </div>
          <button onClick={() => setExecutionFeedback(null)} className="text-[10px] underline hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {/* Filter and Search Controls */}
      <div className="bg-[#070810] border border-[#181B2E] p-4 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search Bar */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-[#5D6388] absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search curriculum steps, commands, or topics..."
            className="w-full bg-[#03040A] border border-[#1B1E36] focus:border-[#615EFF] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-[#585E82] font-mono focus:outline-none transition"
          />
        </div>

        {/* Part Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 scrollbar-none">
          <button
            onClick={() => setSelectedPart('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition whitespace-nowrap ${
              selectedPart === 'all'
                ? 'bg-[#615EFF] text-white shadow-md'
                : 'bg-[#0E1020] text-[#8E94B8] hover:bg-[#161930] hover:text-white border border-[#1B1E36]'
            }`}
          >
            All Steps ({steps.length})
          </button>
          {[1, 2, 3, 4, 5, 6, 7, 8].map(pNum => (
            <button
              key={pNum}
              onClick={() => setSelectedPart(pNum)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono transition whitespace-nowrap ${
                selectedPart === pNum
                  ? 'bg-[#615EFF] text-white font-bold shadow-md'
                  : 'bg-[#0E1020] text-[#787FAD] hover:bg-[#161930] hover:text-white border border-[#1B1E36]'
              }`}
            >
              Part {pNum}
            </button>
          ))}
        </div>
      </div>

      {/* Curriculum Parts Accordion List */}
      <div className="space-y-6">
        {parts.map((part) => {
          const partSteps = filteredSteps.filter(s => s.partNumber === part.num);
          if (partSteps.length === 0 && selectedPart !== 'all' && selectedPart !== part.num) return null;
          if (partSteps.length === 0 && searchQuery.trim()) return null;

          const partCompleted = partSteps.filter(s => s.completed).length;
          const isExpanded = expandedParts[part.num] ?? true;

          return (
            <div key={part.num} className="bg-[#070810] border border-[#181B2E] rounded-2xl overflow-hidden shadow-lg">
              {/* Part Header Bar */}
              <div 
                onClick={() => togglePartExpand(part.num)}
                className="p-4 bg-[#0A0C1B] border-b border-[#181B2E] flex items-center justify-between cursor-pointer hover:bg-[#0F1228] transition select-none"
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#A5A2FF] font-mono font-bold text-xs flex items-center justify-center">
                    P0{part.num}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white font-['Space_Grotesk']">
                      {part.title}
                    </h3>
                    <p className="text-[11px] text-[#7B82A8] font-mono">
                      {partCompleted} of {partSteps.length} items verified
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
                    {partCompleted === partSteps.length && partSteps.length > 0 ? 'COMPLETE' : `${partCompleted}/${partSteps.length}`}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-[#6A7097]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#6A7097]" />
                  )}
                </div>
              </div>

              {/* Part Steps Grid */}
              {isExpanded && (
                <div className="p-4 space-y-3 divide-y divide-[#14172B]/60">
                  {partSteps.map((step) => {
                    const jumpConfig = getTabJumpForStep(step.stepNumber);

                    return (
                      <div 
                        key={step.id} 
                        className={`pt-3 first:pt-0 flex flex-col sm:flex-row items-start justify-between gap-4 p-3.5 rounded-xl transition ${
                          step.completed ? 'bg-[#090B17]/60 border border-[#12162B]' : 'bg-[#0B0D1A] border border-[#1B1E38]'
                        }`}
                      >
                        {/* Left Checkbox and Metadata */}
                        <div className="flex items-start gap-3.5 flex-1 min-w-0">
                          <button
                            onClick={() => onToggleStep(step.id)}
                            className="mt-0.5 transition cursor-pointer shrink-0 focus:outline-none"
                            title={step.completed ? 'Mark as incomplete' : 'Mark step completed'}
                          >
                            {step.completed ? (
                              <CheckCircle2 className="w-5 h-5 text-[#00D26A] fill-[#00D26A]/20" />
                            ) : (
                              <Circle className="w-5 h-5 text-[#4B5175] hover:text-[#615EFF]" />
                            )}
                          </button>

                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30 font-bold">
                                STEP {step.stepNumber}
                              </span>
                              <h4 className={`text-sm font-semibold text-white ${step.completed ? 'line-through opacity-75' : ''}`}>
                                {step.title}
                              </h4>
                              <span className="text-[10px] font-mono text-[#6A7097] bg-[#121424] px-1.5 py-0.5 rounded uppercase">
                                {step.category}
                              </span>
                            </div>

                            <p className="text-xs text-[#8E94B8] leading-relaxed">
                              {step.description}
                            </p>

                            {/* Code Snippet Drawer */}
                            {step.codeSnippet && (
                              <div className="mt-2.5 p-3 bg-[#03040A] border border-[#1B1E36] rounded-xl font-mono text-xs text-[#A5A2FF] relative group">
                                <div className="flex items-center justify-between gap-2 mb-1 text-[10px] text-[#555B7F] uppercase tracking-wider border-b border-[#14172B] pb-1">
                                  <span className="flex items-center gap-1 text-[#00D26A]">
                                    <Terminal className="w-3 h-3" />
                                    COMMAND SNIPPET
                                  </span>
                                  <button
                                    onClick={() => handleCopyCode(step.codeSnippet!, step.id)}
                                    className="text-[#615EFF] hover:text-white transition flex items-center gap-1"
                                  >
                                    {copiedId === step.id ? (
                                      <>
                                        <Check className="w-3 h-3 text-[#00D26A]" />
                                        <span className="text-[#00D26A]">COPIED</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>COPY</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                                <code className="block whitespace-pre-wrap text-[#00D26A] font-bold">
                                  {step.codeSnippet}
                                </code>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right Action Trigger Buttons */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
                          <button
                            onClick={() => handleSimulateExecution(step)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1A1D36] border border-[#202440] text-[11px] font-mono text-[#8E94B8] hover:text-white transition flex items-center gap-1.5"
                            title="Run compliance verification test"
                          >
                            <Play className="w-3 h-3 text-[#00D26A]" />
                            <span>TEST STEP</span>
                          </button>

                          {jumpConfig && (
                            <button
                              onClick={() => onSelectTab(jumpConfig.tab)}
                              className="px-2.5 py-1.5 rounded-lg bg-[#615EFF]/15 hover:bg-[#615EFF]/30 border border-[#615EFF]/40 text-[11px] font-mono text-[#A5A2FF] transition flex items-center gap-1.5 font-bold"
                            >
                              <span>{jumpConfig.label}</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
