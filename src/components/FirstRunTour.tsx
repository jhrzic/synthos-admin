import React, { useState, useEffect } from 'react';
import { 
  Sparkles, Layers, LayoutDashboard, Terminal, 
  GitMerge, Database, Globe, Sliders, Command, 
  X, ChevronRight, ChevronLeft, Check, RotateCcw, Bot, ShieldCheck
} from 'lucide-react';
import { ActiveTab } from '../types';

interface FirstRunTourProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab?: (tab: ActiveTab) => void;
  onNavigate?: (tab: ActiveTab) => void;
}

export const TOUR_STEPS = [
  {
    step: 1,
    title: 'MISSION CONTROL',
    subtitle: 'See what SynthOS is doing right now',
    description: 'Monitor current objectives, active agents, active models, active graphs, tasks, alerts, and system health in an interactive HQ view.',
    tab: 'overview' as ActiveTab,
    icon: LayoutDashboard,
    badgeColor: '#A5A2FF',
    target: '#nav-overview'
  },
  {
    step: 2,
    title: 'WORKFORCE',
    subtitle: 'Agent roles and agent workspaces',
    description: 'Manage specialized agent roles (Orchestrator, Scout, Dev, Reach, Analytics, Scribe) and the Hermes natural-language agent workspace.',
    tab: 'agent-fleet' as ActiveTab,
    icon: Bot,
    badgeColor: '#615EFF',
    target: '#nav-agent-fleet'
  },
  {
    step: 3,
    title: 'FLOWS',
    subtitle: 'Orchestrate work across agents and models',
    description: 'Access visual Graph Builder, Graph Runs telemetry, Tasks (kanban), and autonomous Cron automation to compose multi-step agent pipelines.',
    tab: 'kanban' as ActiveTab,
    icon: GitMerge,
    badgeColor: '#00D26A',
    target: '#nav-kanban'
  },
  {
    step: 4,
    title: 'MODELS',
    subtitle: 'AI intelligence & routing rules',
    description: 'Configure Model Router, providers (Gemini, OpenAI, Claude, Kimi, DeepSeek, OpenRouter), routing rules, and fallback chains.',
    tab: 'model-router' as ActiveTab,
    icon: Sliders,
    badgeColor: '#38BDF8',
    target: '#nav-model-router'
  },
  {
    step: 5,
    title: 'KNOWLEDGE',
    subtitle: 'Workspace memory and artifacts',
    description: 'Inspect long-term vector memory, Obsidian vault [[wikilinks]], generated markdown artifacts, and research content libraries.',
    tab: 'obsidian' as ActiveTab,
    icon: Database,
    badgeColor: '#EC4899',
    target: '#nav-obsidian'
  },
  {
    step: 6,
    title: 'PRODUCTS',
    subtitle: 'TON Network, Twins Concierge & Demos',
    description: 'Explore live product domains including TON Network (wallets, guardians, Telegram Mini App), Twins Concierge, and Frontend Demos.',
    tab: 'ton' as ActiveTab,
    icon: Globe,
    badgeColor: '#0088CC',
    target: '#nav-ton'
  },
  {
    step: 7,
    title: 'SYSTEM',
    subtitle: 'Governance, tools, and infrastructure',
    description: 'Manage Guardian Aegis safety policies, execution receipts, activity ledgers, Skills & MCP tools, infrastructure health, and system audit.',
    tab: 'guardian-aegis' as ActiveTab,
    icon: ShieldCheck,
    badgeColor: '#F59E0B',
    target: '#nav-guardian-aegis'
  },
  {
    step: 8,
    title: 'CMD + K',
    subtitle: 'Jump anywhere quickly',
    description: 'Use the global command palette anytime (CMD+K or CTRL+K) to search, switch views, or dispatch agent actions.',
    tab: 'overview' as ActiveTab,
    icon: Command,
    badgeColor: '#8C8AFF',
    target: '#cmd-k-button'
  }
];

export const FirstRunTour: React.FC<FirstRunTourProps> = ({ isOpen, onClose, onNavigateTab, onNavigate }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const navigate = (tab: ActiveTab) => {
    if (onNavigate) onNavigate(tab);
    else if (onNavigateTab) onNavigateTab(tab);
  };

  if (!isOpen) return null;

  const current = TOUR_STEPS[currentStep];
  const Icon = current.icon;

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      onNavigateTab(TOUR_STEPS[nextStep].tab);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      onNavigateTab(TOUR_STEPS[prevStep].tab);
    }
  };

  const handleComplete = () => {
    try {
      localStorage.setItem('synthos_tour_completed', 'true');
    } catch (e) {
      console.warn('LocalStorage unavailable:', e);
    }
    onClose();
  };

  const handleDontShowAgain = () => {
    handleComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-xl bg-[#0B0D1B] border border-[#272B48] rounded-2xl shadow-2xl p-6 md:p-8 space-y-6 font-mono relative">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-xl bg-[#14182E] text-[#8E94B8] hover:text-white hover:bg-[#1E2342] transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Progress indicator */}
        <div className="flex items-center justify-between border-b border-[#1A1E36] pb-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#615EFF]/20 text-[#8C8AFF] border border-[#615EFF]/40">
              SYNTHOS GUIDED TOUR
            </span>
            <span className="text-xs text-[#8E94B8]">Step {currentStep + 1} of {TOUR_STEPS.length}</span>
          </div>

          <div className="flex gap-1">
            {TOUR_STEPS.map((_, idx) => (
              <div 
                key={idx} 
                className={`h-1.5 rounded-full transition-all ${
                  idx === currentStep ? 'w-6 bg-[#615EFF]' : idx < currentStep ? 'w-2 bg-[#00D26A]' : 'w-2 bg-[#1C2038]'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content Card */}
        <div className="space-y-4 pt-2">
          <div className="flex items-start gap-4">
            <div 
              className="w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0"
              style={{ 
                backgroundColor: `${current.badgeColor}15`, 
                borderColor: `${current.badgeColor}40`,
                color: current.badgeColor
              }}
            >
              <Icon className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide font-['Space_Grotesk']">
                  {current.title}
                </h2>
              </div>
              <p className="text-xs font-semibold text-[#38BDF8]">
                {current.subtitle}
              </p>
            </div>
          </div>

          <p className="text-xs text-[#A3A8CC] leading-relaxed font-sans bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36]">
            {current.description}
          </p>
        </div>

        {/* Navigation Actions Footer */}
        <div className="pt-4 border-t border-[#1A1E36] flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={handleDontShowAgain}
            className="text-[11px] text-[#8E94B8] hover:text-[#FF5E8E] underline cursor-pointer"
          >
            Don't show again
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {currentStep > 0 && (
              <button
                onClick={handleBack}
                className="px-4 py-2 rounded-xl bg-[#14182E] text-xs font-semibold text-white hover:bg-[#1E2342] border border-[#272B48] flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>BACK</span>
              </button>
            )}

            <button
              onClick={handleNext}
              className="px-5 py-2 rounded-xl bg-[#615EFF] text-xs font-bold text-white hover:bg-[#504ACC] transition flex items-center gap-1 shadow-lg shadow-[#615EFF]/25 cursor-pointer"
            >
              <span>{currentStep === TOUR_STEPS.length - 1 ? 'FINISH TOUR' : 'NEXT'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
