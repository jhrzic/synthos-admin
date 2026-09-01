import React from 'react';
import { 
  Rocket, Newspaper, Zap, Search, Layers, Inbox, 
  Play, ArrowUpRight, CheckCircle2, Sparkles, Terminal 
} from 'lucide-react';
import { ActiveTab } from '../../types';

interface DemoCard {
  id: ActiveTab;
  name: string;
  purpose: string;
  category: string;
  status: 'LIVE' | 'PROTOTYPE' | 'SIMULATED';
  icon: any;
  color: string;
}

interface FrontendDemosViewProps {
  onSelectTab: (tab: ActiveTab) => void;
}

export const FrontendDemosView: React.FC<FrontendDemosViewProps> = ({ onSelectTab }) => {
  const demos: DemoCard[] = [
    {
      id: 'startup-generator',
      name: 'Startup Idea Generator',
      purpose: 'Deep research thesis scraper combining Scout Web Crawling with Analytics TAM calculations and Product Hunt trend harvesting.',
      category: 'Research & Ideation',
      status: 'LIVE',
      icon: Rocket,
      color: '#FF5E8E'
    },
    {
      id: 'auto-content',
      name: 'Auto-Content & News Harvester',
      purpose: 'Automated Substack, RSS, ArXiv, and social trend monitoring feed with auto-synthesis into Obsidian notes.',
      category: 'Publishing',
      status: 'LIVE',
      icon: Newspaper,
      color: '#38BDF8'
    },
    {
      id: 'studio-leadgen',
      name: 'Studio & Lead Gen Pipeline',
      purpose: 'Enterprise agency lead qualification, SOW auto-generation, and deal flow velocity tracking.',
      category: 'Growth & Sales',
      status: 'PROTOTYPE',
      icon: Zap,
      color: '#F59E0B'
    },
    {
      id: 'lead-scraper',
      name: 'Lead Scraper & Ecosystem Repos',
      purpose: 'Scrapes developer pain points across 200+ GitHub trending repositories and tech research preprints.',
      category: 'Scout Intelligence',
      status: 'LIVE',
      icon: Search,
      color: '#00D26A'
    },
    {
      id: 'model-stacking',
      name: 'Multi-Model Stacking Chain',
      purpose: 'Sequential multi-LLM pipeline chaining Perplexity research -> DeepSeek reasoning -> Claude synthesis.',
      category: 'Pipeline Engineering',
      status: 'LIVE',
      icon: Layers,
      color: '#A855F7'
    },
    {
      id: 'intake-triage',
      name: 'Intake & Triage Pipeline',
      purpose: 'Automated request classification, severity routing, and agent task assignment engine.',
      category: 'Operations',
      status: 'PROTOTYPE',
      icon: Inbox,
      color: '#A5A2FF'
    }
  ];

  return (
    <div className="space-y-6 font-mono pb-12">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[#615EFF]/20 via-[#0B0D1B] to-[#38BDF8]/20 border border-[#615EFF]/40 rounded-2xl p-6 space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#615EFF]/20 border border-[#615EFF]/50 flex items-center justify-center text-[#8C8AFF]">
            <Play className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">
              SynthOS Frontend Demo Launcher
            </h1>
            <p className="text-xs text-[#8E94B8] font-sans">
              Interactive application prototypes, research engines, and specialized GTM sandboxes built on SynthOS.
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {demos.map((demo) => {
          const Icon = demo.icon;
          return (
            <div 
              key={demo.id} 
              className="bg-[#0B0D1B] border border-[#1D2139] hover:border-[#615EFF]/60 rounded-2xl p-5 space-y-4 transition flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div 
                      className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0"
                      style={{ 
                        backgroundColor: `${demo.color}15`, 
                        borderColor: `${demo.color}40`,
                        color: demo.color
                      }}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-bold text-[#8E94B8] uppercase tracking-wider">{demo.category}</span>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    demo.status === 'LIVE' ? 'bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/40' :
                    'bg-[#A5A2FF]/20 text-[#A5A2FF] border border-[#A5A2FF]/40'
                  }`}>
                    {demo.status}
                  </span>
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white font-['Space_Grotesk'] group-hover:text-[#8C8AFF] transition">
                    {demo.name}
                  </h3>
                  <p className="text-xs text-[#A3A8CC] font-sans leading-relaxed">
                    {demo.purpose}
                  </p>
                </div>
              </div>

              <button
                onClick={() => onSelectTab(demo.id)}
                className="w-full py-2.5 bg-[#615EFF] text-white font-bold text-xs rounded-xl shadow-lg shadow-[#615EFF]/25 hover:bg-[#504ACC] transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>LAUNCH DEMO</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
