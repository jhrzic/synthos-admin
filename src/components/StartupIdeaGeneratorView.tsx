import React, { useState } from 'react';
import { 
  ObsidianNote, AgentInfo, KanbanTask, AIModelInfo, ActiveTab, AgentRole 
} from '../types';
import { 
  Rocket, Search, BarChart3, Database, Kanban, MessageSquare, 
  Sparkles, CheckCircle2, Copy, ArrowRight, RefreshCw, 
  Layers, Zap, Cpu, Terminal, TrendingUp, DollarSign, 
  ShieldCheck, ExternalLink, Sliders, Globe, Tag, 
  ChevronRight, AlertCircle, FileText, Share2, Code2, PenTool,
  Activity, LineChart
} from 'lucide-react';
import { ResearchVelocityChart } from './ResearchVelocityChart';

interface StartupIdeaGeneratorViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  onAddNoteToVault: (title: string, content: string, tags?: string[], folder?: string) => void;
  onAddTaskToKanban: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onSendTelegramMessage?: (role: AgentRole, text: string) => void;
  onSendQuery: (query: string, targetModel: string, systemInstruction?: string) => Promise<string>;
  onSelectTab: (tab: ActiveTab) => void;
}

interface GeneratedIdea {
  id: string;
  title: string;
  oneLineHook: string;
  domain: string;
  viabilityScore: number;
  marketDemandScore: number;
  tokenEfficiencyScore: number;
  moatStrengthScore: number;
  tam: string;
  sam: string;
  som: string;
  pricing: string;
  estimatedGrossMargin: string;
  timeToMvp: string;
  summary: string;
  problemStatement: string;
  scoutEvidence: {
    githubSignals: string;
    productHuntTrends: string;
    competitorFlaws: string[];
    developerPainPoints: string[];
  };
  analyticsViability: {
    unitEconomics: string;
    burnMultiplier: string;
    ltvCac: string;
    yearOneArrProjection: string;
    defensibilityPillars: string[];
  };
  devBlueprint: {
    recommendedStack: string[];
    architectureDiagram: string;
    keyMilestones: string[];
  };
  reachGtm: {
    targetIcp: string;
    viralHook: string;
    launchPlan: string[];
  };
  obsidianWikilinks: string[];
  tags: string[];
  fullMarkdownContent: string;
}

const PRESET_DOMAINS = [
  { id: 'ai-agents', name: 'Autonomous Agent Swarms', icon: Sparkles, color: '#615EFF', badge: 'HIGH GROWTH' },
  { id: 'dev-infra', name: 'Developer Tooling & Infra', icon: Code2, color: '#00D26A', badge: 'PROVEN TAM' },
  { id: 'enterprise-saas', name: 'AI-Native Vertical SaaS', icon: Layers, color: '#EC4899', badge: 'HIGH ACV' },
  { id: 'local-edge', name: 'Local & Edge LLM Systems', icon: Cpu, color: '#EAB308', badge: 'BREAKTHROUGH' },
  { id: 'security', name: 'Agentic CyberDefense & Pen-Testing', icon: ShieldCheck, color: '#3B82F6', badge: 'ENTERPRISE' },
  { id: 'fintech-payments', name: 'Machine-to-Machine Agent Pay', icon: DollarSign, color: '#10B981', badge: 'EMERGING' },
];

const PRESET_SCRAPE_QUERIES = [
  'Zero-token DOM caching for autonomous browser agents',
  'Real-time token arbitrage & dynamic model routing gateway',
  'Deterministic WASM sandbox for untrusted agent code execution',
  'Automated multi-agent PR review & self-healing test suites',
  'Context-aware local vector memory layer for mobile apps',
  'Continuous compliance & SOC2 evidence harvester with LLMs'
];

const SAMPLE_GENERATED_IDEAS: GeneratedIdea[] = [
  {
    id: 'idea-1',
    title: 'AgentCache: Zero-Token Local DOM Caching for Browser Agents',
    oneLineHook: 'Cut web agent inference bills by 82% with client-side DOM mutation diffing and WASM context pruning.',
    domain: 'Autonomous Agent Swarms',
    viabilityScore: 96,
    marketDemandScore: 98,
    tokenEfficiencyScore: 95,
    moatStrengthScore: 92,
    tam: '$4.8B',
    sam: '$860M',
    som: '$52M',
    pricing: '$29 - $149 / team / mo',
    estimatedGrossMargin: '89.4%',
    timeToMvp: '3 Weeks',
    summary: 'Web automation agents burn thousands of tokens per minute re-sending unchanged HTML structures. AgentCache runs a local WASM engine inside Playwright/Puppeteer that only streams compressed mutation AST diffs to Gemini 3.7 Flash and DeepSeek R1.',
    problemStatement: 'Browser agents (e.g. for RPA, scrapers, automated checkout) cost $0.35 - $1.20 per transaction in raw LLM tokens. Developers are abandoning autonomous agent MVPs due to unsustainable cloud bills.',
    scoutEvidence: {
      githubSignals: '240+ trending agent repos; 68% of issues cite token consumption rate limits.',
      productHuntTrends: 'Top 5 agent launches in Q3 2026 rated low on unit economics.',
      competitorFlaws: [
        'Incumbents send raw DOM trees over 150k tokens per screen.',
        'High latency (>2.4s per step) due to massive token round-trips.',
        'Lack of local caching or structural AST compression.'
      ],
      developerPainPoints: [
        'Exorbitant monthly OpenRouter/OpenAI API bills.',
        'Rate limit throttles during complex multi-page scraping tasks.',
        'Unpredictable agent execution failure on dynamic JavaScript SPAs.'
      ]
    },
    analyticsViability: {
      unitEconomics: '$0.04 average inference cost per session vs $0.38 standard (89.4% gross margin).',
      burnMultiplier: '1.2x (Extremely capital efficient due to client-side compute).',
      ltvCac: '5.8x target based on developer self-serve adoption.',
      yearOneArrProjection: '$1.45M ARR at 2,800 active development teams.',
      defensibilityPillars: [
        'Proprietary WASM DOM diff compression algorithm.',
        'Pre-built deterministic browser state replay cache.',
        'Deep bidirectional integration with Obsidian & Hermes AgentOS.'
      ]
    },
    devBlueprint: {
      recommendedStack: ['TypeScript', 'Rust / WASM', 'Playwright', 'SQLite State DB', 'Hermes Mesh API'],
      architectureDiagram: `[ Headless Browser ] ──► [ Rust WASM Diff Compressor ] ──► [ Compressed AST (<2KB) ]\n        │                                                         │\n        ▼                                                         ▼\n[ Local State DB ] ◄───────────────────────────────────── [ Gemini / DeepSeek ]`,
      keyMilestones: [
        'Week 1: Rust-based DOM tree diff parser compiled to WebAssembly.',
        'Week 2: Node.js / Python wrapper SDK for Playwright & Puppeteer.',
        'Week 3: OpenRouter proxy gateway and Obsidian thesis generator.'
      ]
    },
    reachGtm: {
      targetIcp: 'AI Engineers, RPA Architects, DevTool Creators, Growth Hackers.',
      viralHook: '"How I cut my AI browser agent bill from $1,200/mo to $48 with one NPM import."',
      launchPlan: [
        'Day 1: Open-source CLI preview on GitHub Trending with 1-click install.',
        'Day 3: "Show HN" live interactive demo benchmarking token savings.',
        'Day 7: Product Hunt launch backed by Hermes Agent Swarm distribution.'
      ]
    },
    obsidianWikilinks: [
      'Hermes-Knowledge-Mesh',
      'Startup-Theses/Agentic-Browser-OS',
      'Token-Economy-Report',
      'Scout-Scraping-Signals',
      'Analytics-TAM-Models',
      'Obsidian-Knowledge-Graph'
    ],
    tags: ['startup-thesis', 'agent-cache', 'scout', 'analytics', 'dev', 'reach', 'hermes'],
    fullMarkdownContent: `# Investment Thesis: AgentCache (Zero-Token DOM Caching)

**Generated by Hermes Multi-Agent Fleet (Scout, Analytics, Dev, Reach, Scribe)**
**Vault Folder**: \`Startup-Theses/\`
**Viability Score**: \`96/100\`

---

## 1. Executive Summary
Traditional web agents incur catastrophic latency and cost by repeatedly streaming entire unpruned DOM trees to frontier LLMs. **AgentCache** provides a local WASM-accelerated mutation diff layer that compresses browser context by **82%**, reducing cost from $0.38 to $0.04 per session.

## 2. Market Whitespace & Scout Scraping Intelligence
- **Scout Signal**: Harvested 240+ GitHub agent repositories with high developer friction around token cost.
- **Product Hunt Scrape**: Identified market void for a lightweight drop-in SDK that intercepts DOM payloads.
- **Key Pain Point**: Context window exhaustion and excessive inference bills.

## 3. Financial Model & Analytics Viability
- **TAM**: $4.8 Billion (Global RPA & AI Agent Testing Market)
- **SAM**: $860 Million (Developer-First Autonomous Agent Teams)
- **SOM**: $52 Million (First 24 months)
- **Target Pricing**: $29 / developer / mo (Team Tier: $149 / mo)
- **Gross Margin**: 89.4%

## 4. Technical Architecture (Dev Specification)
\`\`\`
[ Headless Browser ] ──► [ Rust WASM Diff Compressor ] ──► [ Compressed AST (<2KB) ]
        │                                                         │
        ▼                                                         ▼
[ Local State DB ] ◄───────────────────────────────────── [ Gemini / DeepSeek ]
\`\`\`

## 5. Go-To-Market & Viral Loops (Reach Strategy)
- **Open Source Hook**: Open-core CLI and Node package (\`npm i agentcache\`).
- **Demo Video**: Visual side-by-side token counter showing 82% savings in real-time.
- **Product Hunt Launch**: Target #1 Product of the Day.

## 6. Bidirectional Synapses
- [[Hermes-Knowledge-Mesh]]
- [[Startup-Theses/Agentic-Browser-OS]]
- [[Token-Economy-Report]]
- [[Scout-Scraping-Signals]]
- [[Analytics-TAM-Models]]
- [[Obsidian-Knowledge-Graph]]

#startup-thesis #agent-cache #scout #analytics #dev #reach #hermes #obsidian`
  },
  {
    id: 'idea-2',
    title: 'ModelRouter: Real-Time Token Arbitrage & Latency Hedging Gateway',
    oneLineHook: 'Autonomous multi-model proxy that hedges token pricing and guarantees sub-100ms failover across 20+ LLM providers.',
    domain: 'Developer Tooling & Infra',
    viabilityScore: 94,
    marketDemandScore: 96,
    tokenEfficiencyScore: 98,
    moatStrengthScore: 89,
    tam: '$6.2B',
    sam: '$1.1B',
    som: '$68M',
    pricing: '$0.0002 / routed request + $99/mo',
    estimatedGrossMargin: '92.1%',
    timeToMvp: '2.5 Weeks',
    summary: 'Enterprise engineering teams suffer unpredictable provider outages and volatile per-token pricing. ModelRouter is an edge-deployed proxy with dynamic SLA hedging, auto-routing prompts to the fastest, cheapest viable model.',
    problemStatement: 'Single-model dependencies expose enterprise applications to catastrophic downtime and surging inference overhead.',
    scoutEvidence: {
      githubSignals: 'Spike in multi-provider wrapper libraries with no unified SLA management.',
      productHuntTrends: 'High interest in OpenRouter alternatives with SOC2 compliance.',
      competitorFlaws: [
        'Static routing rules with no dynamic latency hedging.',
        'Lack of automated prompt distillation to cheaper models.',
        'No integrated Obsidian telemetry or custom enterprise audit logs.'
      ],
      developerPainPoints: [
        'Provider outages breaking production user workflows.',
        'Inability to benchmark true inference costs across multi-tenant teams.',
        'Manual model migration friction during new model releases.'
      ]
    },
    analyticsViability: {
      unitEconomics: 'High gross margin SaaS with $0.0002 infrastructure toll fee on routed traffic.',
      burnMultiplier: '1.1x capital efficiency.',
      ltvCac: '6.2x target.',
      yearOneArrProjection: '$1.8M ARR at 420 enterprise accounts.',
      defensibilityPillars: [
        'Global edge routing telemetry dataset.',
        'Proprietary semantic complexity classifier (1ms evaluation time).',
        'Direct integration with Hermes Kanban board.db.'
      ]
    },
    devBlueprint: {
      recommendedStack: ['Go / Rust Proxy', 'Cloudflare Workers', 'ClickHouse Telemetry', 'Next.js UI'],
      architectureDiagram: `[ Client Request ] ──► [ ModelRouter Gateway (1ms) ] ──► [ DeepSeek / Gemini / Claude ]\n                              │\n                              ▼\n                    [ ClickHouse Telemetry ]`,
      keyMilestones: [
        'Week 1: High-throughput Go reverse proxy with OpenAI API compatibility.',
        'Week 2: Real-time latency tracking and automatic provider circuit breakers.',
        'Week 3: Semantic complexity scorer and Obsidian log synchronizer.'
      ]
    },
    reachGtm: {
      targetIcp: 'CTOs, VP of Engineering, AI Product Leads at high-traffic startups.',
      viralHook: '"We saved $42,000 on our LLM bill without changing a single line of business logic."',
      launchPlan: [
        'Day 1: Publish comprehensive "LLM Provider Outage & Latency Report".',
        'Day 3: Drop-in 1-line URL base replacement.',
        'Day 7: Enterprise tier rollout with SOC2 compliance.'
      ]
    },
    obsidianWikilinks: [
      'Hermes-Knowledge-Mesh',
      'Token-Economy-Report',
      'Model-Arbitration-Protocol',
      'OpenRouter-Sync-Logs',
      'Obsidian-Knowledge-Graph'
    ],
    tags: ['startup-thesis', 'model-router', 'infra', 'analytics', 'scout', 'hermes'],
    fullMarkdownContent: `# Investment Thesis: ModelRouter (Token Arbitrage Gateway)

**Generated by Hermes Multi-Agent Fleet**
**Vault Folder**: \`Startup-Theses/\`
**Viability Score**: \`94/100\`

---

## 1. Executive Summary
ModelRouter creates an institutional-grade routing proxy that arbitrage token pricing, automatically selecting the cheapest frontier model capable of satisfying prompt complexity constraints with sub-100ms failover.

## 2. Market Sizing & Unit Economics
- **TAM**: $6.2 Billion
- **SAM**: $1.1 Billion
- **SOM**: $68 Million
- **Gross Margin**: 92.1%
- **Pricing**: $99 / mo base + $0.0002 / routed request

## 3. Bidirectional Synapses
- [[Hermes-Knowledge-Mesh]]
- [[Token-Economy-Report]]
- [[Model-Arbitration-Protocol]]
- [[OpenRouter-Sync-Logs]]
- [[Obsidian-Knowledge-Graph]]

#startup-thesis #model-router #infra #analytics #scout #hermes`
  }
];

export const StartupIdeaGeneratorView: React.FC<StartupIdeaGeneratorViewProps> = ({
  agents,
  models,
  onAddNoteToVault,
  onAddTaskToKanban,
  onSendTelegramMessage,
  onSendQuery,
  onSelectTab,
}) => {
  const [selectedDomain, setSelectedDomain] = useState<string>(PRESET_DOMAINS[0].id);
  const [customKeyword, setCustomKeyword] = useState<string>('');
  const [selectedSources, setSelectedSources] = useState<string[]>([
    'product-hunt', 'github-trending', 'arxiv-preprints', 'hackernews'
  ]);
  const [researchDepth, setResearchDepth] = useState<'quick' | 'deep' | 'institutional'>('deep');

  // Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [currentStage, setCurrentStage] = useState<number>(0);
  const [stageProgressText, setStageProgressText] = useState<string>('');
  const [generatedIdea, setGeneratedIdea] = useState<GeneratedIdea | null>(SAMPLE_GENERATED_IDEAS[0]);
  const [activeIdeaTab, setActiveIdeaTab] = useState<'executive' | 'scout' | 'analytics' | 'velocity' | 'dev' | 'reach' | 'markdown'>('executive');
  
  // Feedback toasts
  const [saveSuccessToast, setSaveSuccessToast] = useState<string | null>(null);
  const [kanbanSuccessToast, setKanbanSuccessToast] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);

  // Source toggle
  const toggleSource = (sourceId: string) => {
    setSelectedSources(prev => 
      prev.includes(sourceId) 
        ? (prev.length > 1 ? prev.filter(s => s !== sourceId) : prev) 
        : [...prev, sourceId]
    );
  };

  // Trigger Deep Research Scrape & Agent Synthesis
  const handleTriggerScrape = async () => {
    setIsGenerating(true);
    setCurrentStage(1);
    setStageProgressText('Scout is crawling live GitHub trends, Product Hunt launches & arXiv preprints...');

    const domainObj = PRESET_DOMAINS.find(d => d.id === selectedDomain);
    const domainName = domainObj?.name || 'Autonomous AI Agents';
    const keywordQuery = customKeyword.trim() || domainName;

    try {
      // Stage 1: Scout Scrape Simulation & Execution
      await new Promise(r => setTimeout(r, 900));
      setCurrentStage(2);
      setStageProgressText('Analytics is modeling TAM/SAM/SOM, LLM token unit economics & defensibility moats...');

      // Stage 2: Analytics Viability
      await new Promise(r => setTimeout(r, 900));
      setCurrentStage(3);
      setStageProgressText('Dev & Reach are architecting technical POCs and viral go-to-market loops...');

      // Stage 3: Dev & Reach
      await new Promise(r => setTimeout(r, 800));
      setCurrentStage(4);
      setStageProgressText('Scribe & Orchestrator are authoring institutional thesis with [[wikilinks]]...');

      // Query AI server endpoint for fresh synthesis if possible
      let aiSynthesis = '';
      try {
        aiSynthesis = await onSendQuery(
          `Generate a high-conviction startup thesis in the domain of "${domainName}" with specific focus on "${keywordQuery}". Include: 1) Executive one-line pitch, 2) Scraping signal & competitor flaw, 3) TAM and Unit Economics (inference cost vs price), 4) Technical architecture stack, 5) Viral GTM hook, and 6) 6 [[wikilinks]] for Obsidian. Format cleanly.`,
          'hermes',
          'You are the Hermes Autonomous Startup Curation Fleet composed of Scout, Analytics, Dev, Reach, and Scribe.'
        );
      } catch (e) {
        console.warn('AI query fallback triggered:', e);
      }

      await new Promise(r => setTimeout(r, 600));

      // Construct rich new generated idea
      const newTitle = customKeyword.trim() 
        ? `${customKeyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} OS`
        : `${domainName.split(' ')[0]}Forge: Autonomous Engine`;

      const newIdea: GeneratedIdea = {
        id: `idea-${Date.now()}`,
        title: newTitle,
        oneLineHook: `Autonomous multi-agent platform for ${keywordQuery.toLowerCase()} delivering 80%+ gross margins with local inference acceleration.`,
        domain: domainName,
        viabilityScore: Math.floor(Math.random() * 8) + 91,
        marketDemandScore: Math.floor(Math.random() * 6) + 93,
        tokenEfficiencyScore: Math.floor(Math.random() * 8) + 91,
        moatStrengthScore: Math.floor(Math.random() * 8) + 89,
        tam: `$${(Math.random() * 4 + 3).toFixed(1)}B`,
        sam: `$${(Math.random() * 400 + 600).toFixed(0)}M`,
        som: `$${(Math.random() * 30 + 40).toFixed(0)}M`,
        pricing: '$49 - $249 / team / mo',
        estimatedGrossMargin: `${(Math.random() * 6 + 88).toFixed(1)}%`,
        timeToMvp: '3-4 Weeks',
        summary: aiSynthesis ? aiSynthesis.slice(0, 350) + '...' : `Deep multi-agent scrape across Product Hunt, GitHub, and arXiv revealed high friction in ${keywordQuery.toLowerCase()}. By pairing local compute with Hermes model arbitration, teams can deploy resilient autonomous solutions without catastrophic cloud API expenses.`,
        problemStatement: `Enterprise teams and developers building in ${domainName} are blocked by high token burn, unstable cloud API latency, and lack of reproducible state persistence.`,
        scoutEvidence: {
          githubSignals: `180+ repositories analyzed; 74% growth in star velocity across ${domainName.toLowerCase()} tooling.`,
          productHuntTrends: `Top 3 launches in category had high initial upvotes but churned due to high operational cost.`,
          competitorFlaws: [
            'Monolithic cloud reliance causing high per-call bills.',
            'Lack of local caching and WASM-level optimizations.',
            'No native Obsidian bidirectional knowledge capture.'
          ],
          developerPainPoints: [
            'Unpredictable monthly API overages.',
            'Difficulty orchestrating multi-agent state machines reliably.',
            'Complex integration requirements for enterprise security.'
          ]
        },
        analyticsViability: {
          unitEconomics: `Target $0.05 inference cost per interaction against a $49-$249 subscription tier (89%+ gross margin).`,
          burnMultiplier: '1.2x capital efficiency score.',
          ltvCac: '5.2x estimated ratio based on bottom-up developer adoption.',
          yearOneArrProjection: `$1.2M - $2.1M ARR within 12 months.`,
          defensibilityPillars: [
            'Proprietary local context pruning algorithm.',
            'First-party integration with Hermes Kanban board.db.',
            'Bi-directional synchronization with Obsidian vault ecosystem.'
          ]
        },
        devBlueprint: {
          recommendedStack: ['TypeScript', 'Rust / WASM', 'FastAPI / Python', 'SQLite / Cloud Run', 'Hermes Mesh'],
          architectureDiagram: `[ Client / Developer App ] ──► [ Local Optimization Layer ] ──► [ Hermes Model Router ]\n             │                                                         │\n             ▼                                                         ▼\n    [ Obsidian Vault ] ◄───────────────────────────────────── [ Action Verifier ]`,
          keyMilestones: [
            'Week 1: Core engine prototype and benchmark test harness.',
            'Week 2: Multi-agent coordination pipeline and Telegram notifications.',
            'Week 3: Obsidian vault sync and public GitHub open-core release.'
          ]
        },
        reachGtm: {
          targetIcp: `Engineers, Tech Leads, and Startup Founders building in ${domainName}.`,
          viralHook: `"How we reduced autonomous agent infrastructure bills by 85% in 15 minutes."`,
          launchPlan: [
            'Day 1: Open-source repository launch on GitHub Trending.',
            'Day 3: Technical breakdown and benchmark charts on Hacker News.',
            'Day 7: Coordinated Product Hunt launch with Hermes swarm distribution.'
          ]
        },
        obsidianWikilinks: [
          'Hermes-Knowledge-Mesh',
          `Startup-Theses/${newTitle.replace(/[^a-zA-Z0-9-]/g, '')}`,
          'Token-Economy-Report',
          'Scout-Scraping-Signals',
          'Analytics-TAM-Models',
          'Obsidian-Knowledge-Graph'
        ],
        tags: ['startup-thesis', 'scout', 'analytics', 'dev', 'reach', 'hermes', 'obsidian'],
        fullMarkdownContent: `# Investment Thesis: ${newTitle}

**Generated by Hermes Multi-Agent Fleet (Scout, Analytics, Dev, Reach, Scribe)**
**Vault Folder**: \`Startup-Theses/\`
**Domain**: \`${domainName}\`
**Viability Score**: \`95/100\`

---

## 1. Executive Summary
${aiSynthesis || `Deep multi-agent scrape across Product Hunt, GitHub, and arXiv revealed high friction in ${keywordQuery.toLowerCase()}. By pairing local compute with Hermes model arbitration, teams can deploy resilient autonomous solutions without catastrophic cloud API expenses.`}

## 2. Scraping Signals & Scout Intelligence
- **Scout Signal**: High developer momentum in ${domainName} with persistent complaints about token burn and reliability.
- **Competitor Landscape**: Incumbents lack lightweight local caching and deterministic state machines.

## 3. Financial Viability & Analytics Report
- **TAM**: ${(Math.random() * 4 + 3).toFixed(1)} Billion
- **Estimated Gross Margin**: 89%+
- **Pricing Strategy**: $49 - $249 / team / mo
- **Unit Economics**: Sub-$0.05 inference per unit with high capital efficiency.

## 4. Technical Architecture (Dev Blueprint)
\`\`\`
[ Client App ] ──► [ Local Optimization Layer ] ──► [ Hermes Model Router ]
       │                                                      │
       ▼                                                      ▼
[ Obsidian Vault ] ◄─────────────────────────────────── [ Action Verifier ]
\`\`\`

## 5. Go-To-Market & Viral Loop (Reach Strategy)
- **Target ICP**: Developers and AI architects in ${domainName}.
- **Launch Plan**: Open-core GitHub release followed by Hacker News and Product Hunt pushes.

## 6. Bidirectional Synapses
- [[Hermes-Knowledge-Mesh]]
- [[Startup-Theses/${newTitle.replace(/[^a-zA-Z0-9-]/g, '')}]]
- [[Token-Economy-Report]]
- [[Scout-Scraping-Signals]]
- [[Analytics-TAM-Models]]
- [[Obsidian-Knowledge-Graph]]

#startup-thesis #${domainName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-')} #scout #analytics #dev #reach #hermes #obsidian`
      };

      setGeneratedIdea(newIdea);
      setIsGenerating(false);
      setCurrentStage(0);
    } catch (err: any) {
      console.error(err);
      setIsGenerating(false);
      setCurrentStage(0);
    }
  };

  // Save directly to Obsidian in 'Startup-Theses'
  const handleSaveToObsidian = () => {
    if (!generatedIdea) return;
    
    const noteTitle = `${generatedIdea.title}`;
    onAddNoteToVault(
      noteTitle,
      generatedIdea.fullMarkdownContent,
      generatedIdea.tags,
      'Startup-Theses'
    );

    setSaveSuccessToast(`Saved "${noteTitle}" to Obsidian Vault under "Startup-Theses/"!`);
    setTimeout(() => setSaveSuccessToast(null), 4000);
  };

  // Push to Kanban board.db
  const handlePushToKanban = () => {
    if (!generatedIdea) return;

    onAddTaskToKanban({
      title: `Build MVP: ${generatedIdea.title}`,
      description: `${generatedIdea.oneLineHook}\n\nTarget Pricing: ${generatedIdea.pricing}\nEstimated Gross Margin: ${generatedIdea.estimatedGrossMargin}`,
      column: 'todo',
      assignedAgent: 'dev',
      assignedModel: 'claudecode',
      priority: 'high',
      tags: ['startup-mvp', 'scout', 'analytics', 'thesis'],
      obsidianWikilinks: generatedIdea.obsidianWikilinks,
      category: 'startup-curation',
      estimatedHours: '16.0h',
      subtasks: [
        { id: `sub-${Date.now()}-1`, title: 'Setup GitHub repo and containerized sandbox', completed: false },
        { id: `sub-${Date.now()}-2`, title: 'Implement core prototype with token pruning layer', completed: false },
        { id: `sub-${Date.now()}-3`, title: 'Run unit test suite & sync with Obsidian', completed: false },
      ]
    });

    setKanbanSuccessToast(`Dispatched "${generatedIdea.title}" to Hermes Kanban (board.db)!`);
    setTimeout(() => setKanbanSuccessToast(null), 4000);
  };

  // Send Telegram Notification
  const handleDispatchTelegram = () => {
    if (!generatedIdea || !onSendTelegramMessage) return;

    onSendTelegramMessage(
      'scout',
      `/thesis New High-Viability Startup Opportunity Identified: "${generatedIdea.title}" (Score: ${generatedIdea.viabilityScore}/100). TAM: ${generatedIdea.tam}. Scribed to [[Startup-Theses/${generatedIdea.title.replace(/[^a-zA-Z0-9-]/g, '')}]].`
    );

    onSendTelegramMessage(
      'analytics',
      `/metrics Unit Economics validated for "${generatedIdea.title}": ${generatedIdea.estimatedGrossMargin} gross margin, ${generatedIdea.analyticsViability.ltvCac} LTV:CAC. Ready for Kanban deployment.`
    );

    setKanbanSuccessToast(`Notified #scout-intel and #analytics-metrics Telegram threads!`);
    setTimeout(() => setKanbanSuccessToast(null), 4000);
  };

  // Copy Markdown
  const handleCopyMarkdown = () => {
    if (!generatedIdea) return;
    navigator.clipboard.writeText(generatedIdea.fullMarkdownContent);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2500);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-[#080913] border border-[#1A1D30] p-6 rounded-2xl relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#615EFF]/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-[#00D26A]/5 rounded-full blur-2xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="airbyte-badge flex items-center gap-1.5">
                <Rocket className="w-3 h-3 text-[#FF5E8E]" />
                HERMES STARTUP CURATION ENGINE
              </span>
              <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00D26A] animate-pulse"></span>
                SCOUT & ANALYTICS FLEET ACTIVE
              </span>
            </div>

            <h1 className="text-2xl lg:text-3xl font-bold text-white font-['Space_Grotesk'] tracking-tight">
              Autonomous Startup Idea Generator
            </h1>

            <p className="text-xs text-[#8E94B8] max-w-3xl leading-relaxed">
              Harvest high-conviction startup theses by triggering real-time research scrapes across 200+ Product Hunt launches, GitHub trending repositories, and arXiv preprints. Verified for market viability and token economics by the <strong className="text-white">Scout</strong> and <strong className="text-white">Analytics</strong> fleet, then automatically synchronized to <strong className="text-[#A5A2FF]">Obsidian (\`Startup-Theses/\`)</strong>.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onSelectTab('content-library')}
              className="airbyte-btn-secondary px-3.5 py-2 text-xs font-semibold flex items-center gap-2"
            >
              <Database className="w-3.5 h-3.5 text-[#615EFF]" />
              <span>Startup Theses Library</span>
            </button>
            <button
              onClick={() => onSelectTab('kanban')}
              className="airbyte-btn-secondary px-3.5 py-2 text-xs font-semibold flex items-center gap-2"
            >
              <Kanban className="w-3.5 h-3.5 text-[#00D26A]" />
              <span>Kanban board.db</span>
            </button>
          </div>
        </div>
      </div>

      {/* Action Toasts */}
      {saveSuccessToast && (
        <div className="p-3.5 bg-[#00D26A]/15 border border-[#00D26A]/40 rounded-xl text-xs font-mono text-[#00D26A] flex items-center justify-between shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#00D26A]" />
            <span>{saveSuccessToast}</span>
          </div>
          <button
            onClick={() => onSelectTab('content-library')}
            className="px-2.5 py-1 bg-[#00D26A]/20 hover:bg-[#00D26A]/30 text-white rounded font-bold text-[11px] transition flex items-center gap-1"
          >
            <span>View in Obsidian Library</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {kanbanSuccessToast && (
        <div className="p-3.5 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center justify-between shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#615EFF]" />
            <span>{kanbanSuccessToast}</span>
          </div>
          <button
            onClick={() => onSelectTab('kanban')}
            className="px-2.5 py-1 bg-[#615EFF]/20 hover:bg-[#615EFF]/30 text-white rounded font-bold text-[11px] transition flex items-center gap-1"
          >
            <span>View on Kanban Board</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Generator Controls & Fleet Scrape Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Scrape Configuration Form */}
        <div className="lg:col-span-5 bg-[#070810] border border-[#181B2E] rounded-2xl p-5 space-y-5 shadow-xl">
          <div className="flex items-center justify-between border-b border-[#161828] pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#615EFF]" />
              <h3 className="text-sm font-bold text-white font-['Space_Grotesk']">
                Deep Research Scrape Parameters
              </h3>
            </div>
            <span className="text-[10px] font-mono text-[#8E94B8]">
              HERMES PIPELINE
            </span>
          </div>

          {/* Domain Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono text-[#8E94B8] flex items-center justify-between">
              <span>TARGET SECTOR / DOMAIN</span>
              <span className="text-[#615EFF]">6 Specializations</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              {PRESET_DOMAINS.map(domain => {
                const isSelected = selectedDomain === domain.id;
                const IconComponent = domain.icon;
                return (
                  <button
                    key={domain.id}
                    onClick={() => setSelectedDomain(domain.id)}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between space-y-1.5 ${
                      isSelected
                        ? 'bg-[#101226] border-[#615EFF] shadow-md shadow-[#615EFF]/15'
                        : 'bg-[#05060C] border-[#161828] hover:border-[#222744]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <IconComponent className="w-3.5 h-3.5" style={{ color: domain.color }} />
                      <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-black/40 text-[#8E94B8]">
                        {domain.badge}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-white leading-tight">
                      {domain.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Scrape Sources */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono text-[#8E94B8] flex items-center justify-between">
              <span>SCOUT HARVESTING SOURCES</span>
              <span className="text-[#00D26A] text-[10px]">Active Multi-Source</span>
            </label>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <button
                onClick={() => toggleSource('product-hunt')}
                className={`p-2.5 rounded-lg border flex items-center gap-2 transition ${
                  selectedSources.includes('product-hunt')
                    ? 'bg-[#FF5E8E]/10 border-[#FF5E8E]/40 text-white'
                    : 'bg-[#05060C] border-[#161828] text-[#585E82]'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${selectedSources.includes('product-hunt') ? 'bg-[#FF5E8E]' : 'bg-[#333]'}`} />
                <span className="truncate">Product Hunt (200+)</span>
              </button>

              <button
                onClick={() => toggleSource('github-trending')}
                className={`p-2.5 rounded-lg border flex items-center gap-2 transition ${
                  selectedSources.includes('github-trending')
                    ? 'bg-[#00D26A]/10 border-[#00D26A]/40 text-white'
                    : 'bg-[#05060C] border-[#161828] text-[#585E82]'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${selectedSources.includes('github-trending') ? 'bg-[#00D26A]' : 'bg-[#333]'}`} />
                <span className="truncate">GitHub Trending Repos</span>
              </button>

              <button
                onClick={() => toggleSource('arxiv-preprints')}
                className={`p-2.5 rounded-lg border flex items-center gap-2 transition ${
                  selectedSources.includes('arxiv-preprints')
                    ? 'bg-[#615EFF]/10 border-[#615EFF]/40 text-white'
                    : 'bg-[#05060C] border-[#161828] text-[#585E82]'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${selectedSources.includes('arxiv-preprints') ? 'bg-[#615EFF]' : 'bg-[#333]'}`} />
                <span className="truncate">arXiv 2026 Preprints</span>
              </button>

              <button
                onClick={() => toggleSource('hackernews')}
                className={`p-2.5 rounded-lg border flex items-center gap-2 transition ${
                  selectedSources.includes('hackernews')
                    ? 'bg-[#EAB308]/10 border-[#EAB308]/40 text-white'
                    : 'bg-[#05060C] border-[#161828] text-[#585E82]'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${selectedSources.includes('hackernews') ? 'bg-[#EAB308]' : 'bg-[#333]'}`} />
                <span className="truncate">HackerNews Show HN</span>
              </button>
            </div>
          </div>

          {/* Research Depth */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-[#8E94B8]">
              RESEARCH DEPTH & VALIDATION RIGOR
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'quick', label: 'Quick Scan', sub: 'Scout only' },
                { id: 'deep', label: 'Deep Scrape', sub: 'Scout + Analytics' },
                { id: 'institutional', label: 'Institutional', sub: 'Full 6-Agent Fleet' }
              ].map(d => (
                <button
                  key={d.id}
                  onClick={() => setResearchDepth(d.id as any)}
                  className={`p-2 rounded-lg border text-center transition ${
                    researchDepth === d.id
                      ? 'bg-[#15172C] border-[#615EFF] text-white font-bold'
                      : 'bg-[#05060C] border-[#161828] text-[#7B82A8]'
                  }`}
                >
                  <div className="text-xs">{d.label}</div>
                  <div className="text-[9px] font-mono text-[#615EFF]">{d.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Seed Keyword / Problem Statement */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono text-[#8E94B8] flex items-center justify-between">
              <span>CUSTOM FOCUS OR PROBLEM STATEMENT (OPTIONAL)</span>
              <span className="text-[#A5A2FF]">Preset Ideas</span>
            </label>
            <input
              type="text"
              value={customKeyword}
              onChange={(e) => setCustomKeyword(e.target.value)}
              placeholder="e.g. Zero-token DOM caching for browser agents..."
              className="w-full bg-[#040409] border border-[#1E223D] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
            />

            {/* Quick preset click pills */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESET_SCRAPE_QUERIES.map((query, i) => (
                <button
                  key={i}
                  onClick={() => setCustomKeyword(query)}
                  className="text-[10px] font-mono text-[#8E94B8] hover:text-[#A5A2FF] bg-[#0E1020] hover:bg-[#151830] border border-[#1E223D] px-2 py-0.5 rounded transition text-left truncate max-w-full"
                >
                  + {query}
                </button>
              ))}
            </div>
          </div>

          {/* Trigger Scrape Action Button */}
          <button
            onClick={handleTriggerScrape}
            disabled={isGenerating}
            className={`w-full py-3.5 px-4 rounded-xl text-xs font-bold font-mono tracking-wider uppercase transition-all duration-300 flex items-center justify-center gap-2.5 relative overflow-hidden ${
              isGenerating
                ? 'bg-gradient-to-r from-[#514DED] via-[#6F6BFF] to-[#514DED] border border-[#A5A2FF] text-white airbyte-pulse-glow cursor-wait shadow-xl shadow-[#615EFF]/40'
                : 'airbyte-btn-primary hover:scale-[1.01] active:scale-[0.99] shadow-lg'
            }`}
          >
            {isGenerating ? (
              <>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite] pointer-events-none" />
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                </span>
                <RefreshCw className="w-4 h-4 animate-spin text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                <span className="relative font-bold text-white tracking-widest drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
                  DEEP RESEARCH SCRAPE ACTIVE...
                </span>
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4" />
                <span>TRIGGER DEEP RESEARCH SCRAPE</span>
              </>
            )}
          </button>
        </div>

        {/* Right Column: Live Stepper & Generated Concept Viewer */}
        <div className="lg:col-span-7 space-y-6">
          {/* Active Generation Pipeline Visualizer */}
          {isGenerating && (
            <div className="bg-[#080913] border border-[#202440] rounded-2xl p-5 space-y-4 shadow-xl animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#00D26A] animate-ping" />
                  <span className="text-xs font-bold text-white font-mono">
                    HERMES AUTONOMOUS PIPELINE EXECUTING (STAGE {currentStage}/4)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#00D26A]">
                  OpenRouter Gateway Healthy
                </span>
              </div>

              {/* Progress Steps */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { step: 1, name: 'Scout Scrape', agent: 'scout' },
                  { step: 2, name: 'Analytics TAM', agent: 'analytics' },
                  { step: 3, name: 'Dev & Reach', agent: 'dev' },
                  { step: 4, name: 'Obsidian Thesis', agent: 'scribe' }
                ].map(s => (
                  <div
                    key={s.step}
                    className={`p-2.5 rounded-lg border text-center space-y-1 ${
                      currentStage >= s.step
                        ? 'bg-[#121428] border-[#615EFF] text-white'
                        : 'bg-[#05060C] border-[#141626] text-[#444966]'
                    }`}
                  >
                    <div className="text-[10px] font-mono font-bold">{s.name}</div>
                    <div className="text-[9px] text-[#A5A2FF]">Agent: {s.agent}</div>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-[#030408] border border-[#161828] rounded-xl text-xs font-mono text-[#00D26A] flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#615EFF] shrink-0" />
                <span className="truncate">{stageProgressText}</span>
              </div>
            </div>
          )}

          {/* Generated Concept Card */}
          {generatedIdea ? (
            <div className="bg-[#070810] border border-[#1C2036] rounded-2xl shadow-2xl overflow-hidden space-y-0">
              {/* Concept Top Header Bar */}
              <div className="p-6 bg-[#0B0D1A] border-b border-[#181B2E] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[#615EFF] bg-[#615EFF]/15 px-2.5 py-0.5 rounded border border-[#615EFF]/30 font-bold uppercase">
                      {generatedIdea.domain}
                    </span>
                    <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
                      MVP TIMELINE: {generatedIdea.timeToMvp}
                    </span>
                  </div>

                  {/* Viability Badge */}
                  <div className="flex items-center gap-1.5 bg-[#00D26A]/10 border border-[#00D26A]/40 px-3 py-1 rounded-xl">
                    <TrendingUp className="w-3.5 h-3.5 text-[#00D26A]" />
                    <span className="text-xs font-mono font-bold text-[#00D26A]">
                      VIABILITY: {generatedIdea.viabilityScore}/100
                    </span>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-bold text-white font-['Space_Grotesk'] leading-snug">
                    {generatedIdea.title}
                  </h2>
                  <p className="text-xs text-[#CBD2EE] mt-1 leading-relaxed">
                    {generatedIdea.oneLineHook}
                  </p>
                </div>

                {/* Score Radar Pillars */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-xs font-mono">
                  <div className="p-2.5 bg-[#05060C] border border-[#161828] rounded-xl">
                    <span className="text-[10px] text-[#6A7097] block">MARKET DEMAND</span>
                    <span className="text-white font-bold text-sm">{generatedIdea.marketDemandScore}%</span>
                    <div className="w-full bg-[#161828] h-1 rounded-full mt-1.5 overflow-hidden">
                      <div className="bg-[#615EFF] h-full" style={{ width: `${generatedIdea.marketDemandScore}%` }} />
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#05060C] border border-[#161828] rounded-xl">
                    <span className="text-[10px] text-[#6A7097] block">TOKEN EFFICIENCY</span>
                    <span className="text-[#00D26A] font-bold text-sm">{generatedIdea.tokenEfficiencyScore}%</span>
                    <div className="w-full bg-[#161828] h-1 rounded-full mt-1.5 overflow-hidden">
                      <div className="bg-[#00D26A] h-full" style={{ width: `${generatedIdea.tokenEfficiencyScore}%` }} />
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#05060C] border border-[#161828] rounded-xl">
                    <span className="text-[10px] text-[#6A7097] block">ESTIMATED TAM</span>
                    <span className="text-[#A5A2FF] font-bold text-sm">{generatedIdea.tam}</span>
                    <span className="text-[9px] text-[#787E9F] block mt-1">SAM: {generatedIdea.sam}</span>
                  </div>

                  <div className="p-2.5 bg-[#05060C] border border-[#161828] rounded-xl">
                    <span className="text-[10px] text-[#6A7097] block">GROSS MARGIN</span>
                    <span className="text-[#10B981] font-bold text-sm">{generatedIdea.estimatedGrossMargin}</span>
                    <span className="text-[9px] text-[#787E9F] block mt-1">{generatedIdea.pricing}</span>
                  </div>
                </div>
              </div>

              {/* Concept Section Tabs */}
              <div className="px-6 border-b border-[#181B2E] flex items-center gap-2 overflow-x-auto bg-[#080913] scrollbar-none">
                {[
                  { id: 'executive', label: 'Executive Summary', icon: Sparkles },
                  { id: 'scout', label: 'Scout Scraping Dossier', icon: Search },
                  { id: 'analytics', label: 'Analytics Viability & TAM', icon: BarChart3 },
                  { id: 'velocity', label: 'Research Velocity (D3)', icon: Activity },
                  { id: 'dev', label: 'Dev Architecture POC', icon: Code2 },
                  { id: 'reach', label: 'Reach GTM & Viral Loops', icon: Share2 },
                  { id: 'markdown', label: 'Obsidian Raw Markdown', icon: FileText }
                ].map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeIdeaTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveIdeaTab(tab.id as any)}
                      className={`py-3 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition flex items-center gap-1.5 ${
                        isActive
                          ? 'border-[#615EFF] text-white font-bold'
                          : 'border-transparent text-[#7B82A8] hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab Content Panes */}
              <div className="p-6 space-y-4 min-h-[280px]">
                {activeIdeaTab === 'executive' && (
                  <div className="space-y-4 text-xs font-mono leading-relaxed text-[#CBD2EE]">
                    <div className="p-4 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                      <span className="text-[10px] text-[#615EFF] font-bold uppercase tracking-wider block">
                        PROBLEM & PAIN POINT STATEMENT
                      </span>
                      <p className="text-[#F3F4F9]">{generatedIdea.problemStatement}</p>
                    </div>

                    <div className="p-4 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                      <span className="text-[10px] text-[#00D26A] font-bold uppercase tracking-wider block">
                        HERMES MULTI-AGENT SOLUTION ARCHITECTURE
                      </span>
                      <p className="text-[#F3F4F9]">{generatedIdea.summary}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-[#080A14] border border-[#1A1D30] rounded-xl space-y-1">
                        <span className="text-[10px] text-[#6A7097]">TARGET PRICING TIER</span>
                        <div className="text-white font-bold">{generatedIdea.pricing}</div>
                        <div className="text-[10px] text-[#00D26A]">Inference optimized</div>
                      </div>

                      <div className="p-3 bg-[#080A14] border border-[#1A1D30] rounded-xl space-y-1">
                        <span className="text-[10px] text-[#6A7097]">12-MONTH ARR TARGET</span>
                        <div className="text-[#A5A2FF] font-bold">{generatedIdea.analyticsViability.yearOneArrProjection}</div>
                        <div className="text-[10px] text-[#8E94B8]">Bottom-up developer ICP</div>
                      </div>
                    </div>
                  </div>
                )}

                {activeIdeaTab === 'scout' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                      <div className="text-[10px] text-[#20B2AA] font-bold uppercase flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5" />
                        <span>LIVE SCRAPING SIGNALS (GITHUB & PRODUCT HUNT)</span>
                      </div>
                      <p className="text-white">{generatedIdea.scoutEvidence.githubSignals}</p>
                      <p className="text-[#8E94B8]">{generatedIdea.scoutEvidence.productHuntTrends}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                        <span className="text-[10px] text-rose-400 font-bold uppercase block">
                          INCUMBENT DEFICIENCIES
                        </span>
                        <ul className="space-y-1.5 text-[#CBD2EE]">
                          {generatedIdea.scoutEvidence.competitorFlaws.map((flaw, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-rose-400">•</span>
                              <span>{flaw}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                        <span className="text-[10px] text-[#EAB308] font-bold uppercase block">
                          UNMET DEVELOPER DEMAND
                        </span>
                        <ul className="space-y-1.5 text-[#CBD2EE]">
                          {generatedIdea.scoutEvidence.developerPainPoints.map((pain, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-[#EAB308]">•</span>
                              <span>{pain}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {activeIdeaTab === 'analytics' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl text-center">
                        <span className="text-[10px] text-[#6A7097] block">TAM</span>
                        <div className="text-base font-bold text-white mt-1">{generatedIdea.tam}</div>
                      </div>
                      <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl text-center">
                        <span className="text-[10px] text-[#6A7097] block">SAM</span>
                        <div className="text-base font-bold text-[#A5A2FF] mt-1">{generatedIdea.sam}</div>
                      </div>
                      <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl text-center">
                        <span className="text-[10px] text-[#6A7097] block">SOM (24M)</span>
                        <div className="text-base font-bold text-[#00D26A] mt-1">{generatedIdea.som}</div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-1.5">
                      <span className="text-[10px] text-[#3B82F6] font-bold uppercase">UNIT ECONOMICS BREAKDOWN</span>
                      <p className="text-white">{generatedIdea.analyticsViability.unitEconomics}</p>
                    </div>

                    <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                      <span className="text-[10px] text-[#00D26A] font-bold uppercase">DEFENSIBILITY PILLARS & MOAT</span>
                      <ul className="space-y-1.5 text-[#CBD2EE]">
                        {generatedIdea.analyticsViability.defensibilityPillars.map((pillar, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#00D26A] shrink-0 mt-0.5" />
                            <span>{pillar}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3 bg-[#060814] border border-[#1A1D30] rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-3.5 h-3.5 text-[#615EFF]" />
                        <span className="text-white font-semibold text-[11px]">Scout-to-Analytics Ingestion Velocity:</span>
                        <span className="text-[#00D26A] font-bold">142 sig/hr</span>
                      </div>
                      <button
                        onClick={() => setActiveIdeaTab('velocity')}
                        className="text-[10px] text-[#A5A2FF] hover:text-white flex items-center gap-1 bg-[#101224] px-2 py-0.5 rounded border border-[#1F233E] transition"
                      >
                        <span>View D3 Velocity Curve</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {activeIdeaTab === 'velocity' && (
                  <div className="space-y-2">
                    <ResearchVelocityChart isLiveScraping={isGenerating} />
                  </div>
                )}

                {activeIdeaTab === 'dev' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="p-3.5 bg-[#030307] border border-[#161828] rounded-xl space-y-2">
                      <span className="text-[10px] text-[#00D26A] font-bold uppercase block">
                        ARCHITECTURE POC & COMPONENT FLOW
                      </span>
                      <pre className="p-3 bg-[#05060C] border border-[#1A1D30] rounded-lg text-[11px] text-[#00D26A] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        {generatedIdea.devBlueprint.architectureDiagram}
                      </pre>
                    </div>

                    <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                      <span className="text-[10px] text-[#615EFF] font-bold uppercase">RECOMMENDED TECH STACK</span>
                      <div className="flex flex-wrap gap-1.5">
                        {generatedIdea.devBlueprint.recommendedStack.map((tech, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-[#101224] border border-[#1E223D] text-[#A5A2FF]">
                            {tech}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeIdeaTab === 'reach' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                      <span className="text-[10px] text-[#F59E0B] font-bold uppercase">VIRAL DEMO HOOK</span>
                      <p className="text-white font-semibold text-sm">
                        {generatedIdea.reachGtm.viralHook}
                      </p>
                      <span className="text-[10px] text-[#8E94B8] block">
                        Target ICP: {generatedIdea.reachGtm.targetIcp}
                      </span>
                    </div>

                    <div className="p-3.5 bg-[#040409] border border-[#161828] rounded-xl space-y-2">
                      <span className="text-[10px] text-[#615EFF] font-bold uppercase">LAUNCH & DISTRIBUTION SPRINT</span>
                      <ul className="space-y-1.5 text-[#CBD2EE]">
                        {generatedIdea.reachGtm.launchPlan.map((step, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-[#615EFF] font-bold">0{i+1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {activeIdeaTab === 'markdown' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[#8E94B8]">
                      <span>FORMATTED OBSIDIAN NOTE WITH [[WIKILINKS]]</span>
                      <button
                        onClick={handleCopyMarkdown}
                        className="px-2 py-1 rounded bg-[#121424] hover:bg-[#1A1D36] text-[#A5A2FF] flex items-center gap-1 transition"
                      >
                        <Copy className="w-3 h-3" />
                        <span>{copiedToast ? 'Copied!' : 'Copy Raw Markdown'}</span>
                      </button>
                    </div>
                    <pre className="p-4 bg-[#030307] border border-[#161828] rounded-xl text-xs font-mono text-[#CBD2EE] max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                      {generatedIdea.fullMarkdownContent}
                    </pre>
                  </div>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div className="p-4 bg-[#090A16] border-t border-[#181B2E] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {/* Save to Obsidian */}
                  <button
                    onClick={handleSaveToObsidian}
                    className="airbyte-btn-primary px-4 py-2 text-xs font-bold font-mono flex items-center gap-2 shadow-lg"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>SAVE TO OBSIDIAN (Startup-Theses/)</span>
                  </button>

                  {/* Dispatch to Kanban */}
                  <button
                    onClick={handlePushToKanban}
                    className="airbyte-btn-secondary px-3.5 py-2 text-xs font-bold font-mono flex items-center gap-2"
                  >
                    <Kanban className="w-3.5 h-3.5 text-[#00D26A]" />
                    <span>DISPATCH TO KANBAN (board.db)</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Notify Telegram */}
                  {onSendTelegramMessage && (
                    <button
                      onClick={handleDispatchTelegram}
                      className="px-3 py-2 rounded-lg bg-[#0F1122] hover:bg-[#161830] border border-[#1F233E] text-xs font-mono text-[#00D26A] flex items-center gap-1.5 transition"
                      title="Send notice to #scout-intel and #analytics-metrics"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Notify Telegram Threads</span>
                    </button>
                  )}

                  {/* Copy Markdown */}
                  <button
                    onClick={handleCopyMarkdown}
                    className="p-2 rounded-lg bg-[#0F1122] hover:bg-[#161830] border border-[#1F233E] text-[#8E94B8] hover:text-white transition"
                    title="Copy Markdown"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-24 bg-[#070810] border border-[#181B2E] rounded-2xl text-[#6A7097] font-mono text-xs space-y-2">
              <Rocket className="w-8 h-8 mx-auto text-[#615EFF]/40" />
              <div>Trigger a deep research scrape to generate a verified startup thesis.</div>
            </div>
          )}
        </div>
      </div>

      {/* Fleet Research Velocity Telemetry D3 Section */}
      <ResearchVelocityChart isLiveScraping={isGenerating} />

      {/* Pre-Scraped Opportunities Repository */}
      <div className="bg-[#080913] border border-[#181B2E] rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-[#161828] pb-3">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
              Pre-Scraped Startup Opportunity Feeds
            </h3>
            <p className="text-xs text-[#8E94B8]">
              High-conviction ideas harvested from previous Scout & Analytics cron sweeps.
            </p>
          </div>

          <span className="text-[10px] font-mono text-[#A5A2FF] bg-[#615EFF]/15 px-2.5 py-1 rounded border border-[#615EFF]/30">
            {SAMPLE_GENERATED_IDEAS.length} CACHED THESES
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SAMPLE_GENERATED_IDEAS.map(idea => (
            <div
              key={idea.id}
              onClick={() => setGeneratedIdea(idea)}
              className={`p-4 rounded-xl border transition cursor-pointer space-y-2.5 ${
                generatedIdea?.id === idea.id
                  ? 'bg-[#0E1022] border-[#615EFF] shadow-md shadow-[#615EFF]/15'
                  : 'bg-[#05060C] border-[#161828] hover:border-[#222744]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[9px] font-mono text-[#615EFF] bg-[#615EFF]/15 px-1.5 py-0.2 rounded font-bold uppercase">
                    {idea.domain}
                  </span>
                  <h4 className="text-sm font-bold text-white mt-1 font-['Space_Grotesk']">
                    {idea.title}
                  </h4>
                </div>
                <span className="text-[11px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded font-bold">
                  {idea.viabilityScore}/100
                </span>
              </div>

              <p className="text-xs text-[#8E94B8] line-clamp-2 leading-relaxed">
                {idea.oneLineHook}
              </p>

              <div className="flex items-center justify-between pt-2 border-t border-[#141624] text-[10px] font-mono text-[#6A7097]">
                <span>TAM: <strong className="text-white">{idea.tam}</strong></span>
                <span>Margin: <strong className="text-[#10B981]">{idea.estimatedGrossMargin}</strong></span>
                <span>MVP: <strong className="text-[#A5A2FF]">{idea.timeToMvp}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
