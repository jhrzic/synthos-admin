import React, { useState } from 'react';
import { EcosystemRepo, AIModelInfo } from '../types';
import { 
  GitFork, Star, ExternalLink, Copy, Check, Terminal, 
  Layers, Smartphone, MessageSquare, Sparkles, Database,
  ArrowUpRight, ShieldCheck, Cpu, Code2, Globe
} from 'lucide-react';

interface EcosystemReposViewProps {
  models?: Record<string, AIModelInfo>;
}

export const EcosystemReposView: React.FC<EcosystemReposViewProps> = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const repos: EcosystemRepo[] = [
    // 1. AI Orchestration & Hermes Core
    {
      id: 'repo-hermes-agent',
      name: 'NousResearch/hermes-agent',
      repoUrl: 'https://github.com/NousResearch/hermes-agent',
      category: 'ai-orchestration',
      focus: 'Autonomous Multi-Agent Swarm Orchestrator',
      useCase: 'Coordinates the 6 specialized roles (Orchestrator, Scout, Scribe, Reach, Dev, Analytics), runs state machine on board.db, and prevents token thrashing.',
      keyFeatures: ['Telegram thread routing (#101-#106)', 'OpenRouter arbitration', 'Obsidian sync', 'board.db state machine'],
      starsCount: '12.4k',
      status: 'active',
    },
    {
      id: 'repo-hermes-3',
      name: 'NousResearch/Hermes-3-Llama-3.1',
      repoUrl: 'https://github.com/NousResearch/Hermes-3',
      category: 'ai-orchestration',
      focus: 'Frontier Open-Source Reasoning & Agentic Model',
      useCase: 'Primary intelligence engine for Hermes Orchestrator with advanced tool-calling and structured JSON generation.',
      keyFeatures: ['128k context window', 'Native XML function calling', 'Steerable system prompts', 'State estimation'],
      starsCount: '18.9k',
      status: 'active',
    },
    // 2. Mobile Engine & Runtime
    {
      id: 'repo-hermes-engine',
      name: 'facebook/hermes',
      repoUrl: 'https://github.com/facebook/hermes',
      category: 'mobile-runtime',
      focus: 'AOT Bytecode JavaScript Engine for Mobile',
      useCase: 'Compiles Hermes mobile apps into lightweight Hermes bytecode (HBC) with instant startup and minimal RAM footprint on iOS/Android.',
      keyFeatures: ['Ahead-of-time (AOT) bytecode compiler', 'Custom garbage collector', 'Sub-30ms TTI', 'ES6+ support'],
      starsCount: '9.8k',
      status: 'integrated',
    },
    // 3. Messaging Bridges
    {
      id: 'repo-baileys',
      name: 'WhiskeySockets/Baileys',
      repoUrl: 'https://github.com/WhiskeySockets/Baileys',
      category: 'messaging-bridges',
      focus: 'Headless Multi-Device WhatsApp Web Gateway',
      useCase: 'Pairs personal phone numbers (such as +1 646 941 9454) via QR code to route incoming WhatsApp messages directly into Hermes agents without Meta Business approval.',
      keyFeatures: ['Pure TypeScript WebSocket client', 'Multi-Device protocol', 'Zero browser dependency', 'Media handling'],
      starsCount: '15.2k',
      status: 'active',
    },
    {
      id: 'repo-bluebubbles',
      name: 'BlueBubbles/BlueBubbles-Server',
      repoUrl: 'https://github.com/BlueBubblesApp/bluebubbles-server',
      category: 'messaging-bridges',
      focus: 'macOS iMessage Bridge Gateway & REST API',
      useCase: 'Runs on a Mac Mini host to bridge Apple iMessage into Hermes webhooks for seamless SMS/iMessage bot automation.',
      keyFeatures: ['Private API support', 'Real-time WebSocket events', 'Attachment relay', 'End-to-end encryption'],
      starsCount: '4.6k',
      status: 'active',
    },
    // 4. Modal & Copilot Frameworks
    {
      id: 'repo-fragments',
      name: 'e2b-dev/fragments',
      repoUrl: 'https://github.com/e2b-dev/fragments',
      category: 'modal-copilots',
      focus: 'Claude-Style Artifacts & Sandbox Previews',
      useCase: 'Provides full split-pane drawer UI where generated React components and apps render live beside the Hermes conversation stream.',
      keyFeatures: ['Sandboxed WebContainer', 'Multi-file TSX support', 'Live hot-reload', 'Claude artifact UX'],
      starsCount: '8.3k',
      status: 'integrated',
    },
    {
      id: 'repo-copilotkit',
      name: 'CopilotKit/CopilotKit',
      repoUrl: 'https://github.com/CopilotKit/CopilotKit',
      category: 'modal-copilots',
      focus: 'In-App AI Copilots, Modals & Sidebars',
      useCase: 'Provides <CopilotSidebar/>, <CopilotModal/>, and <CopilotPopup/> components connected directly to Hermes function-calling tools.',
      keyFeatures: ['React hooks (useCopilotAction)', 'Generative UI', 'Context providers', 'Tailwind styling'],
      starsCount: '14.1k',
      status: 'integrated',
    },
    {
      id: 'repo-assistant-ui',
      name: 'assistant-ui/assistant-ui',
      repoUrl: 'https://github.com/assistant-ui/assistant-ui',
      category: 'modal-copilots',
      focus: 'Composable AI Chat & Modal UI Components',
      useCase: 'Modern React chat surfaces with tool-call cards, side panels, bottom sheets, and stream cancellation controls.',
      keyFeatures: ['Tailwind-first', 'Branching threads', 'Tool call renderers', 'Modal drawers'],
      starsCount: '3.9k',
      status: 'recommended',
    },
    // 5. Scraping & Automation
    {
      id: 'repo-crawl4ai',
      name: 'unclecode/crawl4ai',
      repoUrl: 'https://github.com/unclecode/crawl4ai',
      category: 'scraping-automation',
      focus: 'LLM-Friendly High-Speed Web Scraper & Distiller',
      useCase: 'Crawls Google Maps listings, directories, and research preprints, outputting clean structured Markdown for Scout & Scribe agents.',
      keyFeatures: ['Playwright headless browser', 'Automatic noise reduction', 'Structured JSON extraction', 'Sub-100ms processing'],
      starsCount: '21.5k',
      status: 'active',
    },
  ];

  const categories = [
    { id: 'all', label: 'All Repositories' },
    { id: 'ai-orchestration', label: 'AI Swarm & Orchestration' },
    { id: 'messaging-bridges', label: 'iMessage & WhatsApp Bridges' },
    { id: 'modal-copilots', label: 'Claude Artifacts & Modals' },
    { id: 'mobile-runtime', label: 'Mobile Runtime (Hermes HBC)' },
    { id: 'scraping-automation', label: 'Scraping & Lead Harvesters' },
  ];

  const filteredRepos = selectedCategory === 'all' 
    ? repos 
    : repos.filter(r => r.category === selectedCategory);

  const handleCopyClone = (repoUrl: string, id: string) => {
    navigator.clipboard.writeText(`git clone ${repoUrl}.git`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4 font-mono">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
              HERMES AGENTOS ECOSYSTEM ATLAS
            </span>
            <span className="bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
              VERIFIED REPOSITORIES
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-sans">
            Ecosystem Repositories &amp; Infrastructure
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1 font-sans">
            Comprehensive architectural index connecting NousResearch Hermes swarms, Facebook Hermes mobile engine, Baileys &amp; BlueBubbles messaging bridges, and Claude-style artifact runtimes.
          </p>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 border-b border-[#1A1D2E] pb-3 overflow-x-auto">
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => setSelectedCategory(c.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              selectedCategory === c.id
                ? 'bg-[#615EFF] text-white shadow-md shadow-[#615EFF]/20'
                : 'bg-[#0E101D] text-[#8E94B8] hover:text-white hover:bg-[#16182B]'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Repos Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredRepos.map((repo) => (
          <div
            key={repo.id}
            className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 hover:border-[#2D335E] transition space-y-4 shadow-xl flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#A5A2FF] bg-[#615EFF]/10 px-2 py-0.5 rounded border border-[#615EFF]/20">
                  {repo.category}
                </span>

                <div className="flex items-center gap-3 text-xs text-[#8E94B8]">
                  <span className="flex items-center gap-1 text-[#F59E0B]">
                    <Star className="w-3.5 h-3.5 fill-[#F59E0B]" />
                    {repo.starsCount}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/30">
                    {repo.status}
                  </span>
                </div>
              </div>

              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                  <Code2 className="w-4 h-4 text-[#38BDF8]" />
                  <span>{repo.name}</span>
                </h3>
                <p className="text-xs text-[#38BDF8] font-bold mt-0.5">{repo.focus}</p>
                <p className="text-xs text-[#8E94B8] mt-2 leading-relaxed">
                  {repo.useCase}
                </p>
              </div>

              {/* Key Features Chips */}
              <div className="flex flex-wrap gap-1.5 pt-2">
                {repo.keyFeatures.map((feat, idx) => (
                  <span key={idx} className="text-[10px] bg-[#05060C] text-[#7A82A6] px-2 py-0.5 rounded-md border border-[#161828]">
                    {feat}
                  </span>
                ))}
              </div>
            </div>

            {/* Footer Action Buttons */}
            <div className="pt-4 border-t border-[#16182C] flex items-center justify-between gap-3">
              <button
                onClick={() => handleCopyClone(repo.repoUrl, repo.id)}
                className="px-3 py-1.5 bg-[#05060C] hover:bg-[#121424] border border-[#1E2240] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
              >
                {copiedId === repo.id ? <Check className="w-3.5 h-3.5 text-[#00D26A]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedId === repo.id ? 'Copied Clone' : 'git clone'}</span>
              </button>

              <a
                href={repo.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-1.5 bg-[#615EFF] hover:bg-[#504DF5] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-md shadow-[#615EFF]/20"
              >
                <span>View on GitHub</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
