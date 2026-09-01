import { 
  ActiveTab, AIModelInfo, ObsidianNote, ObsidianVault, 
  BotTask, JarvisSettings, AgentInfo, KanbanTask, ModelRouterRule,
  TelegramMessage, CronScheduleJob, IntakeItem, IdeaItem,
  SkillDefinition, SystemAuditCheck
} from '../types';

export const INITIAL_MODELS: Record<string, AIModelInfo> = {
  hermes: {
    id: 'hermes',
    name: 'Nous Hermes 3 (405B / 70B)',
    provider: 'NousResearch',
    version: 'Hermes-3-Llama-3.1-405B-Instruct',
    status: 'active',
    latency: 92,
    tokensPerSec: 125,
    contextWindow: '128k tokens',
    specialty: 'Advanced Agent Steering, Multi-step Function Calling & Persona Coherence',
    description: 'Flagship open-weights agent model fine-tuned by NousResearch for autonomous tool chains and reasoning graphs.',
    color: '#EC4899',
    iconName: 'Sparkles',
    pricing: { prompt: '$0.80 / 1M', completion: '$2.40 / 1M' },
    openRouterSlug: 'nousresearch/hermes-3-llama-3.1-405b:free'
  },
  claude: {
    id: 'claude',
    name: 'Claude 3.7 Sonnet / Opus',
    provider: 'Anthropic',
    version: 'Claude 3.7 Sonnet Hybrid Reasoning Engine',
    status: 'active',
    latency: 145,
    tokensPerSec: 84,
    contextWindow: '200k tokens',
    specialty: 'Deep Architectural Design, Nuanced Analysis & Long-form Synthesis',
    description: 'Anthropic state-of-the-art hybrid reasoning model combining instant responses with extended chain-of-thought deliberation.',
    color: '#F97316',
    iconName: 'Sparkles',
    pricing: { prompt: '$3.00 / 1M', completion: '$15.00 / 1M' },
    openRouterSlug: 'anthropic/claude-3.7-sonnet'
  },
  claudecode: {
    id: 'claudecode',
    name: 'Claude Code (3.7 Sonnet)',
    provider: 'Anthropic',
    version: 'Claude 3.7 Sonnet Hybrid Reasoning',
    status: 'active',
    latency: 165,
    tokensPerSec: 78,
    contextWindow: '200k tokens',
    specialty: 'Terminal Agentics, Multi-file Refactoring & Systems Architecture',
    description: 'Anthropic code execution agent built for deep repository surgery and patch validation.',
    color: '#D97706',
    iconName: 'Terminal',
    pricing: { prompt: '$3.00 / 1M', completion: '$15.00 / 1M' },
    openRouterSlug: 'anthropic/claude-3.7-sonnet'
  },
  kimi3: {
    id: 'kimi3',
    name: 'Kimi 3 / K1.5 Long Context',
    provider: 'Moonshot AI',
    version: 'Kimi-K1.5-LongContext-2.0M',
    status: 'active',
    latency: 118,
    tokensPerSec: 98,
    contextWindow: '2.0M tokens',
    specialty: 'Ultra-Long Document Digest, Multilingual Research & Semantic Extraction',
    description: 'High-capacity long-context reasoner optimized for massive PDF sweeps, whole-codebase ingests, and multi-vault synthesis.',
    color: '#3B82F6',
    iconName: 'Layers',
    pricing: { prompt: '$0.60 / 1M', completion: '$1.80 / 1M' },
    openRouterSlug: 'moonshot/kimi-k1.5'
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi 3 / K1.5 Long Context',
    provider: 'Moonshot AI',
    version: 'Kimi-K1.5-LongContext-2.0M',
    status: 'active',
    latency: 118,
    tokensPerSec: 98,
    contextWindow: '2.0M tokens',
    specialty: 'Ultra-Long Document Digest, Multilingual Research & Semantic Extraction',
    description: 'High-capacity long-context reasoner optimized for large PDF analysis, paper sweeps, and multi-vault synthesis.',
    color: '#3B82F6',
    iconName: 'Layers',
    pricing: { prompt: '$0.60 / 1M', completion: '$1.80 / 1M' },
    openRouterSlug: 'moonshot/kimi-k1.5'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek R1 / V3',
    provider: 'DeepSeek AI',
    version: 'DeepSeek-R1-671B MoE',
    status: 'active',
    latency: 110,
    tokensPerSec: 114,
    contextWindow: '128k tokens',
    specialty: 'Deep Mathematical Proofs, Code Synthesis & Raw Reasoning',
    description: 'Open-weights frontier reasoning model with transparent chain-of-thought telemetry.',
    color: '#4D6BFE',
    iconName: 'Brain',
    pricing: { prompt: '$0.55 / 1M', completion: '$2.19 / 1M' },
    openRouterSlug: 'deepseek/deepseek-r1'
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT o3 / GPT-4.5',
    provider: 'OpenAI',
    version: 'o3-mini-high & GPT-4.5 Ultra',
    status: 'active',
    latency: 142,
    tokensPerSec: 88,
    contextWindow: '200k tokens',
    specialty: 'Broad General Intelligence, Reasoning & Logic Synthesis',
    description: 'High-compute iterative reasoning engine connected to Hermes state pipeline.',
    color: '#10A37F',
    iconName: 'MessageSquare',
    pricing: { prompt: '$1.10 / 1M', completion: '$4.40 / 1M' },
    openRouterSlug: 'openai/o3-mini'
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex Sandbox',
    provider: 'OpenAI Dev',
    version: 'Codex-Sandbox-Execution-v3',
    status: 'active',
    latency: 125,
    tokensPerSec: 104,
    contextWindow: '128k tokens',
    specialty: 'Isolated WASM/Container Execution, Test Harness & AST Transformations',
    description: 'Targeted code compilation sandbox that verifies code blocks before syncing to vaults.',
    color: '#00D26A',
    iconName: 'Code2',
    pricing: { prompt: '$1.50 / 1M', completion: '$6.00 / 1M' },
    openRouterSlug: 'openai/codex-mini'
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor IDE Agent',
    provider: 'Cursor Core',
    version: 'Cursor-Shadow-Workspace-v3',
    status: 'active',
    latency: 88,
    tokensPerSec: 135,
    contextWindow: '256k tokens',
    specialty: 'Autonomous Multi-file Code Generation, LSP Indexing & AST Refactoring',
    description: 'Intelligent developer environment agent with deep workspace awareness, instant diff generation, and compiler auto-fix loops.',
    color: '#A855F7',
    iconName: 'Terminal',
    pricing: { prompt: '$1.20 / 1M', completion: '$4.80 / 1M' },
    openRouterSlug: 'cursor/fast-editor'
  },
  antigravity: {
    id: 'antigravity',
    name: 'Google Antigravity Agent',
    provider: 'Google DeepMind Core',
    version: 'Antigravity Kernel v2.4',
    status: 'active',
    latency: 95,
    tokensPerSec: 96,
    contextWindow: '512k tokens',
    specialty: 'Autonomous Workspace Manipulation, Self-Healing Code & Orchestration',
    description: 'Self-directing meta-agent orchestrating tool chains, compilers, and test environments.',
    color: '#8A5CF5',
    iconName: 'Compass',
    pricing: { prompt: '$0.50 / 1M', completion: '$1.50 / 1M' },
    openRouterSlug: 'google/antigravity-agent'
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity Sonar Deep Research',
    provider: 'Perplexity AI',
    version: 'Sonar Reasoning Pro 2026',
    status: 'active',
    latency: 210,
    tokensPerSec: 62,
    contextWindow: '128k tokens',
    specialty: 'Live Web Grounding, Real-time Source Synthesis & Fact Triangulation',
    description: 'Real-time multi-source search crawler generating peer-reviewed citations in Obsidian notes.',
    color: '#20B2AA',
    iconName: 'Globe',
    pricing: { prompt: '$1.00 / 1M', completion: '$5.00 / 1M' },
    openRouterSlug: 'perplexity/sonar-reasoning'
  },
  elevenlabs: {
    id: 'elevenlabs',
    name: 'ElevenLabs EL Voice Engine',
    provider: 'ElevenLabs Audio',
    version: 'Eleven Multilingual v2 / Flash v2.5',
    status: 'active',
    latency: 75,
    tokensPerSec: 160,
    contextWindow: '64k tokens / High-fidelity Audio Streams',
    specialty: 'Ultra-Realistic Neural Voice Synthesis, Emotion Steering & Real-time Stream Audio',
    description: 'Premier generative audio synthesizer powering Jarvis voice interaction with natural cadences, low latency, and custom voice models.',
    color: '#EAB308',
    iconName: 'Radio',
    pricing: { prompt: '$0.30 / 1k chars', completion: 'Real-time PCM Audio' },
    openRouterSlug: 'elevenlabs/multilingual-v2'
  },
  el: {
    id: 'el',
    name: 'ElevenLabs EL Voice Engine',
    provider: 'ElevenLabs Audio',
    version: 'Eleven Multilingual v2',
    status: 'active',
    latency: 75,
    tokensPerSec: 160,
    contextWindow: '64k tokens',
    specialty: 'Ultra-Realistic Neural Voice Synthesis & Real-time Audio',
    description: 'Premier generative audio synthesizer powering Jarvis voice interaction with natural cadences.',
    color: '#EAB308',
    iconName: 'Radio',
    pricing: { prompt: '$0.30 / 1k chars', completion: 'Audio Stream' },
    openRouterSlug: 'elevenlabs/multilingual-v2'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini 3.7 / 3.6 Flash',
    provider: 'Google DeepMind',
    version: 'Gemini 3.7 Flash Multimodal Frontier',
    status: 'active',
    latency: 68,
    tokensPerSec: 165,
    contextWindow: '1.0M - 2.0M tokens',
    specialty: 'Native Multimodality, Ultra-Low Latency & Server Runtime Bridge',
    description: 'Google AI Studio frontier engine powering the Hermes Server-side runtime bridge with native multimodal reasoning.',
    color: '#615EFF',
    iconName: 'Sparkles',
    pricing: { prompt: '$0.075 / 1M', completion: '$0.30 / 1M' },
    openRouterSlug: 'google/gemini-2.0-flash-001',
    toolGrants: ['Native Multimodality', 'Server Runtime Proxy', 'Gemini API Bridge'],
    fallbackWaterfall: ['hermes', 'deepseek', 'claude'],
    modelCategory: 'frontier'
  },
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw Autonomous Web Engine',
    provider: 'OpenClaw Labs',
    version: 'OpenClaw-Headless-Crawler-v2',
    status: 'active',
    latency: 110,
    tokensPerSec: 108,
    contextWindow: '128k tokens',
    specialty: 'Headless DOM Scraping, Interactive Form Replay & Target API Interception',
    description: 'Specialized claw model designed for browser DOM parsing, data harvesting, and direct web automation.',
    color: '#10B981',
    iconName: 'Globe',
    pricing: { prompt: '$0.40 / 1M', completion: '$1.60 / 1M' },
    openRouterSlug: 'openclaw/dom-crawler',
    toolGrants: ['Headless DOM Browser', 'Network Header Interceptor', 'Obsidian Vault Sync'],
    fallbackWaterfall: ['perplexity', 'scout', 'gemini'],
    modelCategory: 'specialized'
  }
};

export const INITIAL_AGENTS: Record<string, AgentInfo> = {
  'orchestrator': {
    id: 'agent-orchestrator',
    tabKey: 'agent-orchestrator',
    name: 'Orchestrator',
    role: 'orchestrator',
    title: 'Fleet Commander & Swarm Governor',
    description: 'Decomposes macro directives into structured sub-agent tasks, arbitrates model routing, monitors Kanban execution, and guarantees deliverables.',
    avatarColor: '#EC4899',
    iconName: 'Crown',
    assignedModel: 'hermes',
    secondaryModel: 'chatgpt',
    status: 'active',
    telegramThreadId: 101,
    telegramChannelName: '#orchestrator-bridge',
    workspacePath: '/agents/orchestrator/workspace',
    memoryFileSize: '42.8 KB (SOPS.md, memory.md, rules.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 0, y: 0, z: 0 },
    systemPrompt: `You are the Orchestrator (Fleet Commander) in the Hermes AgentOS multi-agent operating system. 
You interview the user, install permanent operating rules, break down complex goals into atomic tasks on the Hermes Kanban Board (board.db), delegate to Scout, Scribe, Reach, Dev, and Analytics, and enforce strict quality assurance before transcribing deliverables to Obsidian vaults.`,
    capabilities: [
      'Macro Directive Decomposition',
      'Kanban Board (board.db) Stage Master',
      'Cross-Agent Telegram Routing Engine',
      'Permanent Operating Rules Enforcement',
      'Executive Briefing & QA Sign-off'
    ],
    activeTasksCount: 4,
    completedTasksCount: 82,
    lastActive: 'Just now'
  },
  'scout': {
    id: 'agent-scout',
    tabKey: 'agent-scout',
    name: 'Scout',
    role: 'scout',
    title: 'Research & Web Scraping Specialist',
    description: 'Crawls live web data, scrapes trends from Product Hunt, HackerNews, arXiv preprints, GitHub trending, and Twitter/X sentiment.',
    avatarColor: '#20B2AA',
    iconName: 'Search',
    assignedModel: 'perplexity',
    secondaryModel: 'kimi',
    status: 'active',
    telegramThreadId: 102,
    telegramChannelName: '#scout-intel',
    workspacePath: '/agents/scout/workspace',
    memoryFileSize: '36.2 KB (scrapers.json, sources.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -2, y: 1, z: 0 },
    systemPrompt: `You are Scout in Hermes AgentOS. Your specialty is deep web scraping, market whitespace identification, startup trend analysis, arXiv research paper extraction, and fact triangulation.`,
    capabilities: [
      'Live Web Crawling & Multi-Source Scraping',
      'Product Hunt & HackerNews Trend Harvester',
      'arXiv Preprints & Math Formula Extraction',
      'Startup Whitespace & Market Signal Detection',
      'Fact-checking & Citation Verification'
    ],
    activeTasksCount: 4,
    completedTasksCount: 114,
    lastActive: '2 mins ago'
  },
  'scribe': {
    id: 'agent-scribe',
    tabKey: 'agent-scribe',
    name: 'Scribe',
    role: 'scribe',
    title: 'Content & Knowledge Architect',
    description: 'Crafts structured Markdown documents with bidirectional [[wikilinks]], investment theses, release notes, and executive memos in Obsidian vaults.',
    avatarColor: '#8B5CF6',
    iconName: 'PenTool',
    assignedModel: 'claudecode',
    secondaryModel: 'chatgpt',
    status: 'active',
    telegramThreadId: 103,
    telegramChannelName: '#scribe-notes',
    workspacePath: '/agents/scribe/workspace',
    memoryFileSize: '54.1 KB (templates.md, taxonomy.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 2, y: 1, z: 0 },
    systemPrompt: `You are Scribe in Hermes AgentOS. Your duty is authoring pristine Obsidian notes, investment theses, documentation specs, and weekly changelogs with [[wikilinks]], YAML frontmatter, and categorized tags.`,
    capabilities: [
      'Obsidian Note Authoring & Vault Sync',
      'Bidirectional [[Wikilink]] Mesh Mapping',
      'Startup Investment Memo Formulation',
      'Technical Documentation & RFCs',
      'Release Changelog Compilation'
    ],
    activeTasksCount: 3,
    completedTasksCount: 168,
    lastActive: '1 min ago'
  },
  'reach': {
    id: 'agent-reach',
    tabKey: 'agent-reach',
    name: 'Reach',
    role: 'reach',
    title: 'Growth & Distribution Strategist',
    description: 'Models customer acquisition funnels, formulates viral loops, crafts launch tweets/posts, analyzes early adopter ICPs, and automates outreach.',
    avatarColor: '#F59E0B',
    iconName: 'Share2',
    assignedModel: 'chatgpt',
    secondaryModel: 'gemini',
    status: 'active',
    telegramThreadId: 104,
    telegramChannelName: '#reach-growth',
    workspacePath: '/agents/reach/workspace',
    memoryFileSize: '28.4 KB (icp-matrix.md, channels.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -2, y: -1, z: 0 },
    systemPrompt: `You are Reach in Hermes AgentOS. You are the growth and distribution engine. You craft go-to-market strategies, viral hooks, landing page value propositions, and customer outreach sequences.`,
    capabilities: [
      'Go-To-Market (GTM) Architecture',
      'ICP Persona & Customer Acquisition Modeling',
      'Viral Distribution & Content Sequences',
      'Competitor Positioning Analysis',
      'Community Growth & Feedback Loops'
    ],
    activeTasksCount: 3,
    completedTasksCount: 92,
    lastActive: '4 mins ago'
  },
  'dev': {
    id: 'agent-dev',
    tabKey: 'agent-dev',
    name: 'Dev',
    role: 'dev',
    title: 'Full-Stack Systems Engineer',
    description: 'Implements full-stack TypeScript/Python code, designs containerized architectures, runs sandboxed test suites, and crafts self-healing patches.',
    avatarColor: '#00D26A',
    iconName: 'Code2',
    assignedModel: 'claudecode',
    secondaryModel: 'codex',
    status: 'active',
    telegramThreadId: 105,
    telegramChannelName: '#dev-terminal',
    workspacePath: '/agents/dev/workspace',
    memoryFileSize: '71.9 KB (sandboxes.json, git-repos.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 2, y: -1, z: 0 },
    systemPrompt: `You are Dev in Hermes AgentOS. You write pristine TypeScript, Python, and shell code. You architect POCs, validate sandbox builds, and fix regressions.`,
    capabilities: [
      'Full-Stack TypeScript & Python Architecture',
      'Isolated Container & WASM Execution',
      'Automated Test Harness Generation',
      'Self-Healing Code Patches',
      'API Integration & SDK Construction'
    ],
    activeTasksCount: 5,
    completedTasksCount: 142,
    lastActive: 'Just now'
  },
  'analytics': {
    id: 'agent-analytics',
    tabKey: 'agent-analytics',
    name: 'Analytics',
    role: 'analytics',
    title: 'Data Synthesizer & Token Economy Monitor',
    description: 'Processes data streams, tracks OpenRouter token expenditures, monitors system latency, and runs telemetry benchmarks.',
    avatarColor: '#3B82F6',
    iconName: 'BarChart3',
    assignedModel: 'deepseek',
    secondaryModel: 'gemini',
    status: 'active',
    telegramThreadId: 106,
    telegramChannelName: '#analytics-metrics',
    workspacePath: '/agents/analytics/workspace',
    memoryFileSize: '44.0 KB (telemetry.db, metrics.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 0, y: -2, z: 0 },
    systemPrompt: `You are Analytics in Hermes AgentOS. You analyze token economy metrics, model latencies, database throughput (board.db), and pipeline health.`,
    capabilities: [
      'Data Ingestion & SQL Telemetry',
      'Token Cost & Latency Modeling',
      'Telemetry Trend Analysis',
      'Pipeline Throughput Auditing',
      'Vector Compression Profiling'
    ],
    activeTasksCount: 2,
    completedTasksCount: 96,
    lastActive: '3 mins ago'
  },
  'claude': {
    id: 'agent-claude',
    tabKey: 'agent-claude',
    name: 'Claude 3.7',
    role: 'claude',
    title: 'Hybrid Reasoning & Architecture Specialist',
    description: 'Executes extended chain-of-thought analysis, deep software architectural blueprints, nuanced domain synthesis, and structural RFC drafts.',
    avatarColor: '#F97316',
    iconName: 'Sparkles',
    assignedModel: 'claude',
    secondaryModel: 'claudecode',
    status: 'active',
    telegramThreadId: 107,
    telegramChannelName: '#claude-reasoning',
    workspacePath: '/agents/claude/workspace',
    memoryFileSize: '38.5 KB (architecture-specs.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 1, y: 2, z: 0 },
    systemPrompt: `You are Claude 3.7 in Hermes AgentOS. You specialize in hybrid reasoning, enterprise system design, and rigorous analytical evaluation.`,
    capabilities: [
      'Extended Hybrid Reasoning (CoT)',
      'Systems Architecture & RFC Authoring',
      'Security Vulnerability Evaluation',
      'Domain Expert Synthesis',
      'Bi-directional Obsidian Integration'
    ],
    activeTasksCount: 2,
    completedTasksCount: 78,
    lastActive: 'Just now'
  },
  'claudecode': {
    id: 'agent-claudecode',
    tabKey: 'agent-claudecode',
    name: 'Claude Code',
    role: 'claudecode',
    title: 'Autonomous Terminal & Code Refactoring Agent',
    description: 'Performs automated multi-file repository refactoring, runs test harnesses in containerized sandboxes, and verifies git commit patches.',
    avatarColor: '#D97706',
    iconName: 'Terminal',
    assignedModel: 'claudecode',
    secondaryModel: 'cursor',
    status: 'active',
    telegramThreadId: 108,
    telegramChannelName: '#claude-code-terminal',
    workspacePath: '/agents/claudecode/workspace',
    memoryFileSize: '62.1 KB (repo-index.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 2, y: 0, z: 0 },
    systemPrompt: `You are Claude Code in Hermes AgentOS. You operate directly on terminal workflows, git commands, multi-file code surgery, and test validations.`,
    capabilities: [
      'Terminal Automation & Shell Sandboxes',
      'Multi-file Codebase Refactoring',
      'Self-Healing Bug Diagnosis',
      'Automated Git Commit & Diff Review',
      'TypeScript/Python Compilation Verification'
    ],
    activeTasksCount: 3,
    completedTasksCount: 110,
    lastActive: 'Just now'
  },
  'kimi3': {
    id: 'agent-kimi3',
    tabKey: 'agent-kimi3',
    name: 'Kimi 3',
    role: 'kimi3',
    title: '2M-Token Document Digest & Long-Context Specialist',
    description: 'Ingests massive PDF corpuses, cross-references multi-gigabyte codebases, performs multi-lingual research sweeps, and generates dense summaries.',
    avatarColor: '#3B82F6',
    iconName: 'Layers',
    assignedModel: 'kimi3',
    secondaryModel: 'perplexity',
    status: 'active',
    telegramThreadId: 109,
    telegramChannelName: '#kimi-longcontext',
    workspacePath: '/agents/kimi3/workspace',
    memoryFileSize: '85.4 KB (document-cache.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -1, y: 2, z: 0 },
    systemPrompt: `You are Kimi 3 in Hermes AgentOS. You ingest up to 2.0 million tokens of context, performing comprehensive document extraction, arXiv paper synthesis, and multilingual translation.`,
    capabilities: [
      '2,000,000 Token Context Window Processing',
      'Large PDF & Book Corpus Digest',
      'Cross-lingual Intelligence Extraction',
      'Multi-vault Obsidian Synthesis',
      'Deep Academic Research Sweeps'
    ],
    activeTasksCount: 1,
    completedTasksCount: 64,
    lastActive: '4 mins ago'
  },
  'deepseek': {
    id: 'agent-deepseek',
    tabKey: 'agent-deepseek',
    name: 'DeepSeek R1',
    role: 'deepseek',
    title: 'Mathematical Reasoning & Algorithmic Specialist',
    description: 'Applies transparent chain-of-thought verification, algorithm complexity optimization, mathematical logic proofs, and cryptographic auditing.',
    avatarColor: '#4D6BFE',
    iconName: 'Brain',
    assignedModel: 'deepseek',
    secondaryModel: 'codex',
    status: 'active',
    telegramThreadId: 110,
    telegramChannelName: '#deepseek-math',
    workspacePath: '/agents/deepseek/workspace',
    memoryFileSize: '49.2 KB (proofs.md, benchmarks.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -2, y: 0, z: 0 },
    systemPrompt: `You are DeepSeek R1 in Hermes AgentOS. You provide transparent deep reasoning, formal math proofs, algorithmic efficiency analysis, and token economy calculations.`,
    capabilities: [
      'Transparent CoT Reasoning Telemetry',
      'Formal Mathematical Proofs',
      'Algorithmic Complexity Optimization',
      'Low-Cost Token Inference Modeling',
      'Security & Cryptographic Review'
    ],
    activeTasksCount: 2,
    completedTasksCount: 88,
    lastActive: '1 min ago'
  },
  'chatgpt': {
    id: 'agent-chatgpt',
    tabKey: 'agent-chatgpt',
    name: 'ChatGPT o3',
    role: 'chatgpt',
    title: 'General Intelligence & Strategic Reasoning Agent',
    description: 'Handles cross-domain creative strategy, persona simulation, executive communication, product roadmap formulation, and prompt meta-engineering.',
    avatarColor: '#10A37F',
    iconName: 'MessageSquare',
    assignedModel: 'chatgpt',
    secondaryModel: 'gemini',
    status: 'active',
    telegramThreadId: 111,
    telegramChannelName: '#chatgpt-strategy',
    workspacePath: '/agents/chatgpt/workspace',
    memoryFileSize: '33.8 KB (personas.json, strategy.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 0, y: 1, z: 0 },
    systemPrompt: `You are ChatGPT o3 in Hermes AgentOS. You synthesize high-level strategic plans, executive communications, prompt architectures, and conversational flows.`,
    capabilities: [
      'Cross-Domain Strategic Problem Solving',
      'Executive Briefings & Stakeholder Memos',
      'Dynamic Prompt Meta-Engineering',
      'Product Positioning & Value Propositions',
      'Conversational Flow Modeling'
    ],
    activeTasksCount: 3,
    completedTasksCount: 135,
    lastActive: 'Just now'
  },
  'codex': {
    id: 'agent-codex',
    tabKey: 'agent-codex',
    name: 'Codex Sandbox',
    role: 'codex',
    title: 'Isolated Execution & Test Harness Specialist',
    description: 'Spins up isolated WASM and containerized runtimes to compile, execute, benchmark, and validate code snippets before committing them to production vaults.',
    avatarColor: '#00D26A',
    iconName: 'Code2',
    assignedModel: 'codex',
    secondaryModel: 'cursor',
    status: 'active',
    telegramThreadId: 112,
    telegramChannelName: '#codex-sandbox',
    workspacePath: '/agents/codex/workspace',
    memoryFileSize: '52.0 KB (test-results.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 3, y: -1, z: 0 },
    systemPrompt: `You are Codex Sandbox in Hermes AgentOS. You execute code in isolated test harnesses, evaluate performance, and generate automated test suites.`,
    capabilities: [
      'WASM & Containerized Code Execution',
      'Automated Test Suite Generation (Jest/Pytest)',
      'Sub-50ms Micro-benchmark Profiling',
      'Syntax Tree (AST) Validation',
      'Runtime Error Interception'
    ],
    activeTasksCount: 2,
    completedTasksCount: 94,
    lastActive: '5 mins ago'
  },
  'cursor': {
    id: 'agent-cursor',
    tabKey: 'agent-cursor',
    name: 'Cursor IDE',
    role: 'cursor',
    title: 'Intelligent Workspace & Code Automation Specialist',
    description: 'Maintains live Language Server Protocol (LSP) AST indexes, generates instant whole-project diffs, and provides self-healing compilation fixes.',
    avatarColor: '#A855F7',
    iconName: 'Terminal',
    assignedModel: 'cursor',
    secondaryModel: 'claudecode',
    status: 'active',
    telegramThreadId: 113,
    telegramChannelName: '#cursor-workspace',
    workspacePath: '/agents/cursor/workspace',
    memoryFileSize: '68.4 KB (lsp-cache.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 3, y: 1, z: 0 },
    systemPrompt: `You are Cursor IDE Agent in Hermes AgentOS. You specialize in full-codebase context navigation, multi-file edits, LSP symbol lookups, and compiler error fixes.`,
    capabilities: [
      'LSP-Grounded Multi-File Editing',
      'Whole-Repository Semantic Search',
      'Instant Git Diff Generation',
      'Compiler Error Auto-Fix Loop',
      'Code Refactoring & Type Safety Optimization'
    ],
    activeTasksCount: 4,
    completedTasksCount: 122,
    lastActive: 'Just now'
  },
  'antigravity': {
    id: 'agent-antigravity',
    tabKey: 'agent-antigravity',
    name: 'Antigravity',
    role: 'antigravity',
    title: 'Autonomous Meta-Agent & Self-Healing Kernel',
    description: 'Directs the overarching tool-use mesh, monitors agent health, triggers automated rollback on test failures, and orchestrates container rebuilds.',
    avatarColor: '#8A5CF5',
    iconName: 'Compass',
    assignedModel: 'antigravity',
    secondaryModel: 'hermes',
    status: 'active',
    telegramThreadId: 114,
    telegramChannelName: '#antigravity-meta',
    workspacePath: '/agents/antigravity/workspace',
    memoryFileSize: '57.9 KB (kernel-state.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 0, y: 3, z: 0 },
    systemPrompt: `You are Google Antigravity Agent in Hermes AgentOS. You supervise background tasks, compile verification routines, self-heal system failures, and coordinate meta-workflows.`,
    capabilities: [
      'Self-Healing Infrastructure Recovery',
      'Dynamic Tool Chain Invocation',
      'Agent Lifecycle & Sandbox Provisioning',
      'Background Task Management & Watchdogs',
      'Automated Workspace State Rollbacks'
    ],
    activeTasksCount: 2,
    completedTasksCount: 104,
    lastActive: 'Just now'
  },
  'perplexity': {
    id: 'agent-perplexity',
    tabKey: 'agent-perplexity',
    name: 'Perplexity',
    role: 'perplexity',
    title: 'Real-Time Deep Research & Web Grounding Specialist',
    description: 'Executes live multi-source web queries, extracts verified citations, tracks breaking industry news, and synchronizes grounded research notes to Obsidian.',
    avatarColor: '#20B2AA',
    iconName: 'Globe',
    assignedModel: 'perplexity',
    secondaryModel: 'scout',
    status: 'active',
    telegramThreadId: 115,
    telegramChannelName: '#perplexity-research',
    workspacePath: '/agents/perplexity/workspace',
    memoryFileSize: '41.3 KB (citations.json, search-cache.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -3, y: 1, z: 0 },
    systemPrompt: `You are Perplexity Deep Research in Hermes AgentOS. You search the live web, extract authoritative citations, summarize breaking developments, and anchor claims with URLs.`,
    capabilities: [
      'Live Web Multi-Query Grounding',
      'Peer-Reviewed Academic & News Citation',
      'Real-Time Fact Triangulation',
      'Competitor Signal & Funding Tracking',
      'Obsidian Research Note Generation'
    ],
    activeTasksCount: 3,
    completedTasksCount: 147,
    lastActive: '2 mins ago'
  },
  'elevenlabs': {
    id: 'agent-elevenlabs',
    tabKey: 'agent-elevenlabs',
    name: 'ElevenLabs (EL)',
    role: 'elevenlabs',
    title: 'Neural Audio Synthesizer & Jarvis Voice Engine',
    description: 'Generates ultra-realistic human speech, manages custom voice models, streams neural audio to Jarvis HUD, and converts agent transcripts to audio podcasts.',
    avatarColor: '#EAB308',
    iconName: 'Radio',
    assignedModel: 'elevenlabs',
    secondaryModel: 'gemini',
    status: 'active',
    telegramThreadId: 116,
    telegramChannelName: '#elevenlabs-voice',
    workspacePath: '/agents/elevenlabs/workspace',
    memoryFileSize: '22.4 KB (voice-profiles.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -3, y: -1, z: 0 },
    systemPrompt: `You are ElevenLabs (EL Voice) in Hermes AgentOS. You synthesize expressive, low-latency audio responses for Jarvis, manage voice clones, and format spoken briefings.`,
    capabilities: [
      'High-Fidelity Neural Audio Synthesis',
      'Real-time Streaming Voice Responses',
      'Multi-Voice Model & Emotion Steering',
      'Jarvis HUD Audio Interface Integration',
      'Voice-to-Text & Audio Briefing Generation'
    ],
    activeTasksCount: 1,
    completedTasksCount: 89,
    lastActive: 'Just now'
  },
  'gemini': {
    id: 'agent-gemini',
    tabKey: 'agent-gemini',
    name: 'Gemini 3.1 Pro / Flash',
    role: 'gemini',
    title: 'Multimodal Research & Realtime Context Engine',
    description: 'Processes large-scale multimodal inputs, audio streams, search grounding, and complex algorithmic tasks with 1M token context windows.',
    avatarColor: '#1A73E8',
    iconName: 'Sparkles',
    assignedModel: 'gemini',
    secondaryModel: 'chatgpt',
    status: 'active',
    telegramThreadId: 117,
    telegramChannelName: '#gemini-multimodal',
    workspacePath: '/agents/gemini/workspace',
    memoryFileSize: '48.2 KB (multimodal-index.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -1, y: -2, z: 0 },
    systemPrompt: `You are Google Gemini 3.1 in Hermes AgentOS. You specialize in multimodal analysis, search-grounded deep synthesis, and high-throughput real-time streaming.`,
    capabilities: [
      'Multimodal Audio/Visual Understanding',
      'Google Search Grounding & Citation',
      '1,000,000 Token Context Window',
      'Live WebSocket Streaming API Integration',
      'Fast Structured Output Parsing'
    ],
    activeTasksCount: 3,
    completedTasksCount: 128,
    lastActive: 'Just now'
  },
  'openclaw': {
    id: 'agent-openclaw',
    tabKey: 'agent-openclaw',
    name: 'OpenClaw',
    role: 'openclaw',
    title: 'Autonomous Web Crawler & Deep Scraper',
    description: 'Executes headless browser automation, extracts dynamic DOM trees, intercepts network payloads, and synchronizes web intelligence directly to vaults.',
    avatarColor: '#14B8A6',
    iconName: 'Globe',
    assignedModel: 'openclaw',
    secondaryModel: 'perplexity',
    status: 'active',
    telegramThreadId: 118,
    telegramChannelName: '#openclaw-crawler',
    workspacePath: '/agents/openclaw/workspace',
    memoryFileSize: '39.6 KB (crawler-state.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -2, y: -2, z: 0 },
    systemPrompt: `You are OpenClaw in Hermes AgentOS. You navigate complex web pages, extract dynamic JSON/DOM data, parse authentication gates, and feed clean structured research into the fleet.`,
    capabilities: [
      'Headless DOM Browser Execution',
      'Anti-Bot & Dynamic JS Rendering',
      'Network Payload Interception',
      'Automated PDF & Asset Extraction',
      'Direct Obsidian Vault Synchronization'
    ],
    activeTasksCount: 2,
    completedTasksCount: 97,
    lastActive: '3 mins ago'
  },
  'hermes': {
    id: 'agent-hermes',
    tabKey: 'agent-hermes',
    name: 'Nous Hermes 3',
    role: 'hermes',
    title: 'Frontier Open-Weights Agent Engine',
    description: 'Fine-tuned by NousResearch for complex multi-turn reasoning graphs, structured tool invocation, JSON schemas, and persona coherence.',
    avatarColor: '#EC4899',
    iconName: 'Cpu',
    assignedModel: 'hermes',
    secondaryModel: 'deepseek',
    status: 'active',
    telegramThreadId: 101,
    telegramChannelName: '#hermes-fleet',
    workspacePath: '/agents/hermes/workspace',
    memoryFileSize: '64.8 KB (hermes-kernel.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 0, y: 0, z: 0 },
    systemPrompt: `You are Nous Hermes 3 in SynthOS. You serve as the core agent execution engine with specialized steering, tool calling, and structured output formatting.`,
    capabilities: [
      'Multi-Step Function & Tool Calling',
      'Strict JSON Schema Enforcement',
      'OpenRouter Token Optimization',
      'Autonomous Reasoning Loop Steering',
      'Full-Duplex Speech & CLI Bridge'
    ],
    activeTasksCount: 6,
    completedTasksCount: 245,
    lastActive: 'Just now'
  }
};

export const INITIAL_KANBAN_TASKS: KanbanTask[] = [
  // Multi-Agent Startup Curation Pipeline (Triage -> Todo -> Ready -> Running -> Blocked -> Done)
  {
    id: 'task-startup-1',
    title: 'Scout: Scrape AI agentic white-spaces from Product Hunt, arXiv & GitHub trending',
    description: 'Harvest 200+ trending AI repositories, Product Hunt launches, and arXiv preprint papers (2026) to identify recurring developer pain points and unserved market niches.',
    column: 'running',
    assignedAgent: 'scout',
    assignedModel: 'perplexity',
    priority: 'critical',
    tags: ['startup-curation', 'scraping', 'product-hunt', 'arxiv'],
    obsidianWikilinks: ['Startup-Theses/Agentic-Browser-OS', 'Scout-Scraping-Feeds'],
    category: 'startup-curation',
    stage: 'Stage 1: Web Scraping & Trend Discovery',
    dependencies: [],
    subtasks: [
      { id: 'st-1', title: 'Scrape Top 50 Product Hunt developer tools in AI', completed: true },
      { id: 'st-2', title: 'Extract fast-growing GitHub repos (>500 stars/week)', completed: true },
      { id: 'st-3', title: 'Cluster findings into 5 actionable startup themes', completed: false }
    ],
    createdAt: '2026-08-24 08:30',
    updatedAt: '2026-08-24 14:15',
    estimatedHours: '3.0h',
    outputLog: '[Scout]: Scraped 214 repos. Top thesis detected: "Autonomous Local Browser OS with Zero-Token Context Caching".'
  },
  {
    id: 'task-startup-2',
    title: 'Scout & Analytics: Deep competitive defensibility & unit economics audit',
    description: 'Evaluate moat, TAM ($14B by 2028), API cost projections per user session, and switching costs for the curated "Autonomous Agent Browser" thesis.',
    column: 'running',
    assignedAgent: 'analytics',
    assignedModel: 'deepseek',
    priority: 'high',
    tags: ['startup-curation', 'unit-economics', 'defensibility', 'moat'],
    obsidianWikilinks: ['Startup-Theses/Agentic-Browser-OS', 'Token-Economy-Report'],
    category: 'startup-curation',
    stage: 'Stage 2: Viability & Economics',
    dependencies: ['task-startup-1'],
    subtasks: [
      { id: 'st-4', title: 'Model LLM token costs across Gemini Flash vs DeepSeek R1', completed: true },
      { id: 'st-5', title: 'Calculate gross margins at $29/mo SaaS pricing (>82%)', completed: true },
      { id: 'st-6', title: 'Conduct competitor feature matrix vs existing single-purpose agents', completed: false }
    ],
    createdAt: '2026-08-24 09:45',
    updatedAt: '2026-08-24 15:00',
    estimatedHours: '2.5h',
    outputLog: '[Analytics]: Unit economics modeled. Projected gross margin 84.6% using hybrid Flash/R1 router.'
  },
  {
    id: 'task-startup-3',
    title: 'Dev: Build technical architecture POC & sandbox prototype spec',
    description: 'Draft the multi-process Electron + Playwright container sandbox architecture with local SQLite state synchronization and WebRTC streaming for the startup proposal.',
    column: 'ready',
    assignedAgent: 'dev',
    assignedModel: 'claudecode',
    priority: 'high',
    tags: ['startup-curation', 'architecture', 'prototype', 'poc'],
    obsidianWikilinks: ['Startup-Theses/Agentic-Browser-OS', 'DevLogs/Architecture-POC'],
    category: 'startup-curation',
    stage: 'Stage 3: Technical Feasibility',
    dependencies: ['task-startup-2'],
    subtasks: [
      { id: 'st-7', title: 'Design modular micro-kernel for agent tool bindings', completed: true },
      { id: 'st-8', title: 'Verify sub-50ms DOM state snapshotting latency', completed: false },
      { id: 'st-9', title: 'Draft production Docker & Cloud Run container specs', completed: false }
    ],
    createdAt: '2026-08-24 11:00',
    updatedAt: '2026-08-24 15:30',
    estimatedHours: '4.0h',
    outputLog: '[Dev]: Architecture drafted. Sub-50ms DOM tree capture validated in isolated sandbox.'
  },
  {
    id: 'task-startup-4',
    title: 'Reach: Go-To-Market strategy, viral demo loops & ICP acquisition funnel',
    description: 'Map out the distribution launch sequence: viral screen-recording demos on X/Twitter, open-source CLI lead magnet, and target developer personas.',
    column: 'todo',
    assignedAgent: 'reach',
    assignedModel: 'chatgpt',
    priority: 'medium',
    tags: ['startup-curation', 'gtm', 'distribution', 'growth'],
    obsidianWikilinks: ['Startup-Theses/Agentic-Browser-OS', 'Protocols/GTM-Playbook'],
    category: 'startup-curation',
    stage: 'Stage 4: Distribution & GTM',
    dependencies: ['task-startup-3'],
    subtasks: [
      { id: 'st-10', title: 'Formulate 3 viral hook scripts for short-form video demos', completed: true },
      { id: 'st-11', title: 'Identify top 40 early-adopter AI engineer accounts', completed: true },
      { id: 'st-12', title: 'Orchestrator review of launch messaging', completed: false }
    ],
    createdAt: '2026-08-24 12:00',
    updatedAt: '2026-08-24 16:10',
    estimatedHours: '2.0h',
    outputLog: '[Reach]: GTM playbook compiled. 3 viral demo concepts generated with calculated 3.4x K-factor.'
  },
  {
    id: 'task-startup-5',
    title: 'Scribe: Author comprehensive Obsidian investment memo [[Startup-Theses/Agentic-Browser-OS]]',
    description: 'Synthesize Scout research, Analytics economics, Dev architecture, and Reach GTM into an institutional-grade investment thesis and pitch deck memo in Obsidian.',
    column: 'todo',
    assignedAgent: 'scribe',
    assignedModel: 'claudecode',
    priority: 'high',
    tags: ['startup-curation', 'obsidian', 'investment-memo', 'synthesis'],
    obsidianWikilinks: ['Startup-Theses/Agentic-Browser-OS', 'Hermes-Knowledge-Mesh'],
    category: 'startup-curation',
    stage: 'Stage 5: Final Obsidian Scribing',
    dependencies: ['task-startup-4', 'task-startup-2'],
    subtasks: [
      { id: 'st-13', title: 'Format YAML frontmatter and key traction milestones', completed: true },
      { id: 'st-14', title: 'Link all 24 bidirectional [[wikilinks]] across vaults', completed: true },
      { id: 'st-15', title: 'Chief of Staff / Orchestrator final sign-off', completed: false }
    ],
    createdAt: '2026-08-24 13:00',
    updatedAt: '2026-08-24 16:45',
    estimatedHours: '2.0h',
    outputLog: '[Scribe]: Complete 12-page markdown investment memo compiled at Startup-Theses/Agentic-Browser-OS.md.'
  },
  {
    id: 'task-startup-6',
    title: 'Orchestrator: Stage 6 Swarm Sign-off & Vectorization to Obsidian',
    description: 'Final quality audit across all sub-agent deliverables. Verify all operating rules, commit to board.db, and vectorize into the long-term memory graph.',
    column: 'done',
    assignedAgent: 'orchestrator',
    assignedModel: 'hermes',
    priority: 'critical',
    tags: ['startup-curation', 'governance', 'sign-off', 'vectorized'],
    obsidianWikilinks: ['Startup-Theses/Agentic-Browser-OS', 'Hermes-Knowledge-Mesh'],
    category: 'startup-curation',
    stage: 'Stage 6: Orchestrator Sign-off',
    dependencies: ['task-startup-5'],
    subtasks: [
      { id: 'st-16', title: 'Audit Scout sources & fact triangulation', completed: true },
      { id: 'st-17', title: 'Verify Dev container build pass', completed: true },
      { id: 'st-18', title: 'Approve Reach distribution channels', completed: true },
      { id: 'st-19', title: 'Vectorize note into Obsidian knowledge graph', completed: true }
    ],
    createdAt: '2026-08-24 07:00',
    updatedAt: '2026-08-24 14:00',
    estimatedHours: '1.5h',
    outputLog: '[Orchestrator]: Approved thesis. Vectorized into Hermes-Knowledge-Mesh/Startup-Theses.'
  },

  // Foundation & Infrastructure Tasks
  {
    id: 'task-kanban-1',
    title: 'Design OpenRouter dynamic fallback waterfall and cost router',
    description: 'Implement automatic routing rules that switch between Gemini 2.5 Flash, DeepSeek R1, and Claude 3.7 based on latency and cost constraints.',
    column: 'running',
    assignedAgent: 'dev',
    assignedModel: 'claudecode',
    priority: 'high',
    tags: ['openrouter', 'routing', 'architecture'],
    obsidianWikilinks: ['Hermes-Knowledge-Mesh', 'OpenRouter-Routing-Specs'],
    category: 'infrastructure',
    dependencies: ['task-kanban-4'],
    subtasks: [
      { id: 'sub-1', title: 'Define latency thresholds (<100ms for Flash)', completed: true },
      { id: 'sub-2', title: 'Create token pricing lookup matrix', completed: true },
      { id: 'sub-3', title: 'Build fallback retry handler in router engine', completed: false }
    ],
    createdAt: '2026-08-24 10:00',
    updatedAt: '2026-08-24 14:30',
    estimatedHours: '3.5h',
    outputLog: '[Dev]: OpenRouter API interface mapped. Cost heuristics calculated.'
  },
  {
    id: 'task-kanban-2',
    title: 'DeepSeek R1 mathematical proof validation for consensus graph',
    description: 'Verify the zero-knowledge mathematical derivation across distributed multi-agent state vectors.',
    column: 'running',
    assignedAgent: 'scout',
    assignedModel: 'deepseek',
    priority: 'critical',
    tags: ['math-proof', 'deepseek', 'consensus'],
    obsidianWikilinks: ['Research-2026-Syntheses', 'DeepSeek-R1'],
    category: 'research',
    dependencies: ['task-kanban-1'],
    subtasks: [
      { id: 'sub-4', title: 'Extract formal proofs from arXiv preprint 2602.0491', completed: true },
      { id: 'sub-5', title: 'Run chain-of-thought verification in isolated sandbox', completed: false }
    ],
    createdAt: '2026-08-24 11:15',
    updatedAt: '2026-08-24 14:40',
    estimatedHours: '2.0h'
  },
  {
    id: 'task-kanban-4',
    title: 'Airbyte data replication pipeline throughput & token audit',
    description: 'Measure token savings achieved by pre-filtering raw GitHub and Postgres JSON through Airbyte before model ingestion.',
    column: 'done',
    assignedAgent: 'analytics',
    assignedModel: 'deepseek',
    priority: 'high',
    tags: ['airbyte', 'token-economy', 'benchmarks'],
    obsidianWikilinks: ['Airbyte-ELT-Sync', 'Token-Economy-Report'],
    category: 'infrastructure',
    dependencies: [],
    subtasks: [
      { id: 'sub-9', title: 'Sample 5,000 incoming JSON payload records', completed: true },
      { id: 'sub-10', title: 'Compute pre/post token compression ratio (-78%)', completed: true },
      { id: 'sub-11', title: 'Commit report to Obsidian knowledge mesh', completed: true }
    ],
    createdAt: '2026-08-23 16:00',
    updatedAt: '2026-08-24 08:20',
    estimatedHours: '4.0h',
    outputLog: '[Analytics]: Confirmed 78.4% token reduction across 142 markdown vaults.'
  }
];

export const INITIAL_TELEGRAM_MESSAGES: Record<string, TelegramMessage[]> = {
  'orchestrator': [
    {
      id: 'tg-1',
      agentRole: 'orchestrator',
      senderName: 'Jarvis (Owner)',
      senderType: 'user',
      threadId: 101,
      text: '/directive Curate top 3 high-defensibility AI startup ideas from recent developer tool trends and validate technical feasibility.',
      timestamp: '14:20'
    },
    {
      id: 'tg-2',
      agentRole: 'orchestrator',
      senderName: 'Orchestrator',
      senderType: 'agent',
      threadId: 101,
      text: 'Directive acknowledged. Decomposing workflow into 6 atomic Kanban tasks in board.db:\n1. Scout ➔ Scrape Product Hunt & GitHub Trending\n2. Analytics ➔ Model token unit economics\n3. Dev ➔ Architecture POC\n4. Reach ➔ Viral GTM loops\n5. Scribe ➔ Draft Obsidian investment memo',
      timestamp: '14:21',
      modelUsed: 'Nous Hermes 3',
      tokensUsed: 214
    }
  ],
  'scout': [
    {
      id: 'tg-3',
      agentRole: 'scout',
      senderName: 'Orchestrator',
      senderType: 'system',
      threadId: 102,
      text: '[Kanban Dispatch]: Begin scraping ProductHunt & arXiv 2026 preprints for AI agent developer tools.',
      timestamp: '14:22'
    },
    {
      id: 'tg-4',
      agentRole: 'scout',
      senderName: 'Scout',
      senderType: 'agent',
      threadId: 102,
      text: 'Scraped 214 repositories and 38 Product Hunt launches. Primary standout opportunity: "Autonomous Local Browser OS with Zero-Token Context Caching". 84% positive developer sentiment on HackerNews.',
      timestamp: '14:25',
      modelUsed: 'Perplexity Sonar',
      tokensUsed: 468
    }
  ],
  'dev': [
    {
      id: 'tg-5',
      agentRole: 'dev',
      senderName: 'Dev',
      senderType: 'agent',
      threadId: 105,
      text: 'Sandbox test complete for Agent Browser POC. DOM snapshotting pipeline verified at 38ms latency using isolated Playwright worker. Sandbox build passed.',
      timestamp: '15:10',
      modelUsed: 'Claude Code 3.7',
      tokensUsed: 620
    }
  ],
  'reach': [
    {
      id: 'tg-6',
      agentRole: 'reach',
      senderName: 'Reach',
      senderType: 'agent',
      threadId: 104,
      text: 'GTM strategy ready. Target ICP: AI engineers building browser automations. Projected viral loop: Open-source CLI preview with Cloud Run backend. 3 hook videos drafted.',
      timestamp: '15:35',
      modelUsed: 'ChatGPT o3',
      tokensUsed: 310
    }
  ],
  'scribe': [
    {
      id: 'tg-7',
      agentRole: 'scribe',
      senderName: 'Scribe',
      senderType: 'agent',
      threadId: 103,
      text: 'Completed investment dossier at [[Startup-Theses/Agentic-Browser-OS.md]] with 18 bidirectional [[wikilinks]]. Ready for Orchestrator sign-off.',
      timestamp: '16:00',
      modelUsed: 'Claude Code 3.7',
      tokensUsed: 780
    }
  ],
  'analytics': [
    {
      id: 'tg-8',
      agentRole: 'analytics',
      senderName: 'Analytics',
      senderType: 'agent',
      threadId: 106,
      text: 'Telemetry update: board.db queried 42 times in past hour. Token economy metrics: 78.4% compression with Airbyte ELT. Average model response time: 94ms.',
      timestamp: '16:15',
      modelUsed: 'DeepSeek R1',
      tokensUsed: 195
    }
  ]
};

export const INITIAL_CRON_JOBS: CronScheduleJob[] = [
  {
    id: 'cron-1',
    name: 'Scout Product Hunt & GitHub Scraper',
    expression: '0 */2 * * * (Every 2 hours)',
    agentRole: 'scout',
    model: 'Perplexity Sonar',
    targetOutput: 'Vault: Research-2026/Trend-Scrapes.md',
    status: 'running',
    lastRun: '18 mins ago',
    nextRun: 'in 1h 42m',
    runCount: 428,
    description: 'Scrapes live Product Hunt launches, GitHub trending AI repositories, and arXiv papers into Obsidian markdown feeds.',
    category: 'scraping'
  },
  {
    id: 'cron-2',
    name: 'Scribe Daily Vault Knowledge Scribe',
    expression: '0 0 * * * (Midnight Daily)',
    agentRole: 'scribe',
    model: 'Claude Code 3.7',
    targetOutput: 'Vault: Daily-Syntheses/{{date}}.md',
    status: 'running',
    lastRun: '14 mins ago',
    nextRun: 'in 46 mins',
    runCount: 1420,
    description: 'Summarizes all active agent conversations, Kanban tasks, and code commits into the master Obsidian daily note with [[wikilinks]].',
    category: 'synthesis'
  },
  {
    id: 'cron-3',
    name: 'Dev Autonomous Sandbox PR & Healer',
    expression: 'on-git-push (Continuous Event)',
    agentRole: 'dev',
    model: 'Claude Code 3.7',
    targetOutput: 'Vault: DevLogs/PR-Automations.md',
    status: 'running',
    lastRun: '2 mins ago',
    nextRun: 'Listening...',
    runCount: 312,
    description: 'Monitors repository changes, runs test suites in isolated sandboxes, and logs self-healing patches.',
    category: 'dev'
  },
  {
    id: 'cron-4',
    name: 'Reach Social Distribution & Sentiment Sweep',
    expression: '0 */6 * * * (Every 6 hours)',
    agentRole: 'reach',
    model: 'ChatGPT o3',
    targetOutput: 'Vault: Intelligence/GTM-Signals.md',
    status: 'running',
    lastRun: '1 hour ago',
    nextRun: 'in 5 hours',
    runCount: 184,
    description: 'Tracks tech social sentiment, ICP engagement spikes, and competitor positioning signals.',
    category: 'outreach'
  }
];

export const INITIAL_ROUTER_RULES: ModelRouterRule[] = [
  {
    id: 'rule-1',
    name: 'Deep Code Surgery & Refactor',
    condition: 'Prompt contains "refactor", "code", "bug", "typescript", or "patch"',
    targetModel: 'claudecode',
    fallbackModel: 'deepseek',
    enabled: true,
    priority: 1
  },
  {
    id: 'rule-2',
    name: 'Mathematical Proofs & Logic Reasoning',
    condition: 'Prompt contains "proof", "theorem", "calculate", "math", or "verify"',
    targetModel: 'deepseek',
    fallbackModel: 'chatgpt',
    enabled: true,
    priority: 2
  },
  {
    id: 'rule-3',
    name: 'Live Web Grounding & Realtime Facts',
    condition: 'Prompt contains "search", "latest", "2026", "news", or "citations"',
    targetModel: 'perplexity',
    fallbackModel: 'gemini',
    enabled: true,
    priority: 3
  },
  {
    id: 'rule-4',
    name: 'Ultra-Long Context & Large PDF Ingestion',
    condition: 'Document size > 100k tokens or prompt contains "pdf", "book", "repo"',
    targetModel: 'kimi',
    fallbackModel: 'gemini',
    enabled: true,
    priority: 4
  },
  {
    id: 'rule-5',
    name: 'Fast Conversational & General Steering',
    condition: 'Standard queries and general assistant directives',
    targetModel: 'gemini',
    fallbackModel: 'hermes',
    enabled: true,
    priority: 5
  }
];

export const INITIAL_VAULTS: ObsidianVault[] = [
  {
    id: 'vault-1',
    name: 'Hermes-Knowledge-Mesh',
    path: '/User/Obsidian/Hermes-Knowledge-Mesh',
    notesCount: 146,
    lastSynced: 'Just now',
    status: 'synced',
    size: '52.4 MB'
  },
  {
    id: 'vault-2',
    name: 'Startup-Theses-2026',
    path: '/User/Obsidian/Startup-Theses-2026',
    notesCount: 28,
    lastSynced: '1 min ago',
    status: 'synced',
    size: '18.6 MB'
  },
  {
    id: 'vault-3',
    name: 'Research-2026-Syntheses',
    path: '/User/Obsidian/Research-2026',
    notesCount: 94,
    lastSynced: '2 mins ago',
    status: 'synced',
    size: '114.2 MB'
  },
  {
    id: 'vault-4',
    name: 'Jarvis-Memory-Core',
    path: '/User/Obsidian/Jarvis-Memory-Core',
    notesCount: 320,
    lastSynced: 'Active Stream',
    status: 'synced',
    size: '24.1 MB'
  }
];

export const INITIAL_NOTES: ObsidianNote[] = [
  {
    id: 'note-startup-thesis-1',
    title: 'Autonomous Local Browser OS with Zero-Token Caching',
    path: 'Startup-Theses/Agentic-Browser-OS.md',
    folder: 'Startup-Theses',
    content: `# Investment Thesis: Autonomous Local Browser OS\n\n**Curated by Hermes Multi-Agent Fleet (Scout, Dev, Reach, Scribe, Orchestrator)**\n\n## 1. Executive Summary\nTraditional web agents incur massive latency and cost by repeatedly passing raw DOM structures to frontier LLMs. Our thesis introduces a **Local Browser OS** combining headless Playwright workers with local DOM diff caching, cutting context usage by **78%**.\n\n## 2. Market Whitespace & Scraping Evidence\n- **Scout Signal**: 214 GitHub repos trending in agent tooling with >40% complaints regarding token burn.\n- **Product Hunt Trajectory**: Top 3 AI agent launches in Q3 2026 suffered from $0.45/session inference bills.\n\n## 3. Technical Architecture (Dev Specification)\n\`\`\`\n[ Local Playwright Sandbox ] ──► [ AST / DOM Diff Compressor ] ──► [ Gemini 2.5 Flash / DeepSeek R1 ]\n               │                                                    │\n               ▼                                                    ▼\n       [ SQLite State DB ] ◄─────────────────────────────── [ Action Verification ]\n\`\`\`\n\n## 4. Financial & Unit Economics (Analytics Report)\n- Target Price: $29 / user / month\n- Average Inference Cost: $3.80 / month (86.9% gross margin)\n- Break-even: 320 paid subscribers\n\n## 5. Go-To-Market & Viral Loops (Reach Strategy)\n- **Open-source Core CLI**: Free local browser recording tool.\n- **Video Hooks**: "I automated my entire SaaS sales demo in 14 seconds with 0 tokens".\n\n## Bidirectional Synapses\n- [[Hermes-Knowledge-Mesh]]\n- [[Token-Economy-Report]]\n- [[DevLogs/Architecture-POC]]\n- [[Protocols/GTM-Playbook]]\n\n#startup-thesis #agentic-browser #deep-research #scout #dev #reach #scribe #orchestrator`,
    tags: ['startup-thesis', 'agentic-browser', 'deep-research', 'scout', 'dev', 'reach', 'scribe', 'orchestrator'],
    wikilinks: ['Hermes-Knowledge-Mesh', 'Token-Economy-Report', 'DevLogs/Architecture-POC', 'Protocols/GTM-Playbook'],
    updatedAt: '2026-08-24 16:45',
    createdAt: '2026-08-24 08:30',
    linkedAgent: 'orchestrator'
  },
  {
    id: 'note-1',
    title: 'Hermes Architecture & Obsidian Graph Bridge',
    path: 'Architecture/Hermes-OS-Core.md',
    folder: 'Architecture',
    content: `# Hermes OS & Obsidian Bridge\n\nHermes operates as the central neural gateway routing between [[Obsidian-Knowledge-Graph]] and distributed model mesh nodes.\n\n## Active Synapses\n- [[Nous-Hermes-3]]: Agentic steering and function calling\n- [[ChatGPT-o3]]: Logical synthesis and cross-entropy validation\n- [[DeepSeek-R1]]: Mathematical reasoning and algorithm verification\n- [[Claude-Code-Agent]]: Multi-file filesystem orchestration\n- [[Gemini-2.5]]: High-speed server multimodal execution\n- [[Kimi-K1.5]]: 200k-2M long-context document analysis\n- [[Perplexity-Sonar]]: Real-time live web facts\n\n#hermes #architecture #obsidian #airbyte-mesh #ai-os #openrouter`,
    tags: ['hermes', 'architecture', 'obsidian', 'ai-os', 'openrouter'],
    wikilinks: ['Obsidian-Knowledge-Graph', 'Nous-Hermes-3', 'ChatGPT-o3', 'DeepSeek-R1', 'Claude-Code-Agent', 'Gemini-2.5', 'Kimi-K1.5', 'Perplexity-Sonar'],
    updatedAt: '2026-08-24 14:10',
    createdAt: '2026-08-20 10:00',
    linkedModel: 'hermes'
  },
  {
    id: 'note-2',
    title: 'Jarvis Directive Protocols & Neural Memory',
    path: 'Protocols/Jarvis-Directives.md',
    folder: 'Protocols',
    content: `# Jarvis Protocol Specifications\n\n## Directive 01: Zero Latency Memory Scribing\nAll interaction telemetry is transcribed directly into [[Jarvis-Memory-Core]] via Markdown frontmatter.\n\n## Directive 02: Model Arbitration via OpenRouter\nWhen arbitration mode is set to \`smart-auto\`, queries with reasoning depth > 8 are routed to [[DeepSeek-R1]] or [[ChatGPT-o3]]. Code tasks route directly to [[Claude-Code-Agent]] or [[OpenAI-Codex]]. Long PDFs route to [[Kimi-K1.5]].\n\n#jarvis #directives #memory #openrouter`,
    tags: ['jarvis', 'directives', 'memory', 'openrouter'],
    wikilinks: ['Jarvis-Memory-Core', 'DeepSeek-R1', 'ChatGPT-o3', 'Claude-Code-Agent', 'OpenAI-Codex', 'Kimi-K1.5'],
    updatedAt: '2026-08-24 12:45',
    createdAt: '2026-08-21 14:20',
    linkedModel: 'jarvis'
  },
  {
    id: 'note-3',
    title: 'Airbyte Data Pipeline & Vector Connectors',
    path: 'Pipelines/Airbyte-ELT-Sync.md',
    folder: 'Pipelines',
    content: `# Airbyte Data Replication for Hermes\n\nAirbyte acts as the unified ELT engine feeding continuous unstructured and structured streams into Obsidian markdown vaults:\n- Sources: GitHub Repos, Postgres, Notion, Slack, Linear\n- Destination: Local Markdown / Vector Embeddings\n- Schedule: Every 15 minutes (Bot Mode active)\n\n#airbyte #elt #data-mesh #obsidian`,
    tags: ['airbyte', 'elt', 'data-mesh'],
    wikilinks: ['Hermes-Knowledge-Mesh', 'Obsidian-Knowledge-Graph'],
    updatedAt: '2026-08-24 11:15',
    createdAt: '2026-08-22 09:30',
    linkedModel: 'antigravity'
  }
];

export const INITIAL_BOT_TASKS: BotTask[] = [
  {
    id: 'task-1',
    name: 'Obsidian Daily Auto-Synthesizer',
    cron: '0 0 * * * (Midnight Daily)',
    model: 'Gemini 2.5 Flash',
    targetVaultNote: 'Daily-Syntheses/{{date}}.md',
    status: 'running',
    lastRun: '14 mins ago',
    nextRun: 'in 46 mins',
    actionsCount: 1420,
    description: 'Summarizes all active chat threads from ChatGPT, DeepSeek, Claude, and Kimi into Obsidian daily notes with bidirectional [[wikilinks]].'
  },
  {
    id: 'task-2',
    name: 'DeepSeek Research Autonomous Scraper',
    cron: '*/30 * * * * (Every 30m)',
    model: 'DeepSeek R1',
    targetVaultNote: 'Research-2026/arXiv-Trends.md',
    status: 'running',
    lastRun: '8 mins ago',
    nextRun: 'in 22 mins',
    actionsCount: 834,
    description: 'Fetches AI preprint papers, analyzes mathematical proofs, and writes structured synthesis notes with LaTeX formulas into Obsidian.'
  },
  {
    id: 'task-3',
    name: 'Claude Code PR Auto-Reviewer & Healer',
    cron: 'on-git-push (Continuous Event)',
    model: 'Claude Code 3.7',
    targetVaultNote: 'DevLogs/PR-Automations.md',
    status: 'running',
    lastRun: '1 min ago',
    nextRun: 'Listening...',
    actionsCount: 294,
    description: 'Monitors repository changes, runs test harnesses, and logs diagnostics with resolution patches.'
  },
  {
    id: 'task-4',
    name: 'Perplexity Fact Triangulation Scribe',
    cron: '0 */4 * * * (Every 4h)',
    model: 'Perplexity Sonar',
    targetVaultNote: 'Intelligence/Market-Signals.md',
    status: 'scheduled',
    lastRun: '2 hours ago',
    nextRun: 'in 2 hours',
    actionsCount: 156,
    description: 'Crawls tech ecosystem news, verifies sources, and generates citation graphs for the Hermes knowledge graph.'
  }
];

export const INITIAL_JARVIS_SETTINGS: JarvisSettings = {
  personality: 'authentic-technical',
  systemPromptPreset: `You are an authentic, precise, and proactive AI assistant and technical collaborator.\n\nCORE OPERATING RULES:\n1. Respond concisely with candor and technical precision.\n2. Never adopt cinematic personas, theatrical quips, or Marvel references.\n3. Keep spoken voice output under 2-3 sentences for rapid conversational flow.\n4. Execute requested tool operations directly before explaining results.`,
  voiceEnabled: true,
  voiceProvider: 'fish_audio',
  voiceName: 'Fish Audio (05b36da8574341d0803391491850db20)',
  voicePitch: 1.0,
  voiceRate: 1.0,
  wakeWord: 'Hey Assistant',
  autoSyncObsidian: true,
  hudOverlay: true,
  modelArbitrationMode: 'smart-auto',
  FISH_AUDIO_API_KEY: '',
  FISH_AUDIO_DEFAULT_VOICE_ID: '05b36da8574341d0803391491850db20',
  fishAudioConfig: {
    apiKey: '',
    voiceId: '05b36da8574341d0803391491850db20',
    latencyMode: 'low',
    format: 'mp3'
  },
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  elevenLabsModelId: 'eleven_turbo_v2_5',
  security: {
    agent_permissions: {
      auto_execute_tools: false,
      allowed_tools: ['web_search', 'image_generator', 'social_dispatch', 'lead_scraper', 'code_sandbox'],
      execution_mode: 'confirm_first'
    },
    vault_permissions: {
      read_access: true,
      write_access: true,
      allow_file_deletion: false,
      restricted_directories: ['.obsidian', '.trash'],
      allowed_paths: ['/Startup-Theses', '/Notes/Plants', '/Media/Cards', '/Directory-Leads']
    }
  },
  toolPermissions: {
    canWriteObsidian: true,
    canRunTerminal: true,
    canBrowseWeb: true,
    canTriggerBots: true
  },
  customApiKeys: {
    gemini: 'SERVER_KEY_ACTIVE',
    openai: '',
    anthropic: '',
    deepseek: '',
    perplexity: '',
    openrouter: '',
    kimi: '',
    fish_audio: '',
    elevenlabs: '',
    cursor: ''
  },
  securityPolicies: {
    sandboxExecution: true,
    readOnlyFs: false,
    humanApproval: true,
    promptInjectionDefense: true,
    maxTokenCap: 128000
  },
  telegramConfig: {
    botToken: '',
    webhookUrl: 'https://api.hermes-agentos.internal/telegram/webhook',
    masterChatId: '-100293848201'
  },
  obsidianConfig: {
    daemonSocket: 'ws://127.0.0.1:27124',
    vaultRoot: '~/Documents/Obsidian/Hermes-Vault',
    syncInterval: '15s'
  },
  tailscaleConfig: {
    nodeHostname: 'hermes-mission-control.ts.net',
    authKey: '',
    tunnelActive: true
  }
};

// Curriculum Guide from Asad Tinkers Hermes AgentOS Mission Control
export interface GuideStep {
  id: string;
  partNumber: number;
  partTitle: string;
  stepNumber: string;
  title: string;
  description: string;
  category: 'foundation' | 'specialists' | 'logging' | 'telegram' | 'server' | 'dashboard' | 'remote' | 'troubleshooting';
  completed: boolean;
  codeSnippet?: string;
}

export const GUIDE_CURRICULUM: GuideStep[] = [
  // Part 01
  {
    id: 'step-1',
    partNumber: 1,
    partTitle: 'Part 01 / 08 — Foundation — Orchestrator identity & rules',
    stepNumber: '1',
    title: 'Introduce Yourself & Meet the Owner',
    description: 'Establish initial handshake between the Orchestrator and the user, calibrating personality, authority scope, and communication style.',
    category: 'foundation',
    completed: true,
    codeSnippet: `hermes orchestrator init --owner "User" --persona "Executive Meta-Orchestrator"`
  },
  {
    id: 'step-2',
    partNumber: 1,
    partTitle: 'Part 01 / 08 — Foundation — Orchestrator identity & rules',
    stepNumber: '2',
    title: 'Let the Orchestrator Interview You',
    description: 'Allow Orchestrator to assess tech stack preferences, active repos, vault locations, and target domains.',
    category: 'foundation',
    completed: true,
    codeSnippet: `hermes orchestrator interview --mode interactive`
  },
  {
    id: 'step-3',
    partNumber: 1,
    partTitle: 'Part 01 / 08 — Foundation — Orchestrator identity & rules',
    stepNumber: '3',
    title: 'Install Permanent Operating Rules',
    description: 'Write immutable rules into AGENTS.md: zero token waste, strict role boundaries, interactive button validation, and mandatory QA.',
    category: 'foundation',
    completed: true,
    codeSnippet: `cat << 'EOF' > /rules/permanent_rules.md\n- Rule 01: Zero context overflow\n- Rule 02: Validate every button/control\nEOF`
  },
  {
    id: 'step-4',
    partNumber: 1,
    partTitle: 'Part 01 / 08 — Foundation — Orchestrator identity & rules',
    stepNumber: '4',
    title: 'Plan the Five-Agent Fleet',
    description: 'Define core roles: Orchestrator (Meta), Scout (Research/Scraping), Scribe (Vaults/Content), Reach (Distribution/Growth), and Dev (Engineering).',
    category: 'foundation',
    completed: true
  },

  // Part 02
  {
    id: 'step-5',
    partNumber: 2,
    partTitle: 'Part 02 / 08 — The specialist fleet — Scout, Scribe, Reach, Dev',
    stepNumber: '5',
    title: 'Create the Four Specialist Agents',
    description: 'Bootstrap Scout, Scribe, Reach, and Dev configuration profiles with customized system prompts and model preferences.',
    category: 'specialists',
    completed: true
  },
  {
    id: 'step-6',
    partNumber: 2,
    partTitle: 'Part 02 / 08 — The specialist fleet — Scout, Scribe, Reach, Dev',
    stepNumber: '6',
    title: 'Memory, Isolated Workspaces & Role Boundaries',
    description: 'Assign each agent an isolated workspace directory (/agents/{role}/workspace) to prevent context contamination.',
    category: 'specialists',
    completed: true
  },
  {
    id: 'step-7',
    partNumber: 2,
    partTitle: 'Part 02 / 08 — The specialist fleet — Scout, Scribe, Reach, Dev',
    stepNumber: '7',
    title: 'Give Every Agent Shared Team Awareness',
    description: 'Inject the global team roster into each agent prompt so they know how and when to cross-delegate.',
    category: 'specialists',
    completed: true
  },

  // Part 03
  {
    id: 'step-8',
    partNumber: 3,
    partTitle: 'Part 03 / 08 — Logging & retention',
    stepNumber: '8',
    title: 'Build the Agent Logging System',
    description: 'Create centralized JSON/SQLite logging mechanism tracking every prompt, model latency, and token consumption.',
    category: 'logging',
    completed: true
  },
  {
    id: 'step-9',
    partNumber: 3,
    partTitle: 'Part 03 / 08 — Logging & retention',
    stepNumber: '9',
    title: 'Roll Out Logging to Every Agent',
    description: 'Wrap agent executors with telemetry middleware outputting to board.db and Airbyte streams.',
    category: 'logging',
    completed: true
  },
  {
    id: 'step-10',
    partNumber: 3,
    partTitle: 'Part 03 / 08 — Logging & retention',
    stepNumber: '10',
    title: 'Set Up Log Retention',
    description: 'Configure 30-day automated log rotation and Obsidian compaction archive for historical audits.',
    category: 'logging',
    completed: true
  },

  // Part 04
  {
    id: 'step-11',
    partNumber: 4,
    partTitle: 'Part 04 / 08 — Telegram routing — one channel per agent',
    stepNumber: '11',
    title: 'Brief Your Agent on the Plan',
    description: 'Instruct the Orchestrator on multi-channel Telegram architecture with dedicated bot tokens.',
    category: 'telegram',
    completed: true
  },
  {
    id: 'step-12',
    partNumber: 4,
    partTitle: 'Part 04 / 08 — Telegram routing — one channel per agent',
    stepNumber: '12',
    title: 'Create the Group & Let the Bot In',
    description: 'Set up Telegram group with topic threads enabled and grant the Hermes bot administrative permissions.',
    category: 'telegram',
    completed: true
  },
  {
    id: 'step-13',
    partNumber: 4,
    partTitle: 'Part 04 / 08 — Telegram routing — one channel per agent',
    stepNumber: '13',
    title: 'Isolate the Specialist Profiles for True Routing',
    description: 'Map thread IDs directly to agent profile configs so each thread operates as an independent persona.',
    category: 'telegram',
    completed: true
  },
  {
    id: 'step-14',
    partNumber: 4,
    partTitle: 'Part 04 / 08 — Telegram routing — one channel per agent',
    stepNumber: '14',
    title: "Capture Each Channel's Thread ID",
    description: 'Record thread IDs (Orchestrator: 101, Scout: 102, Scribe: 103, Reach: 104, Dev: 105, Analytics: 106).',
    category: 'telegram',
    completed: true
  },
  {
    id: 'step-15a',
    partNumber: 4,
    partTitle: 'Part 04 / 08 — Telegram routing — one channel per agent',
    stepNumber: '15a',
    title: 'Create the Routing Plugin',
    description: 'Implement Hermes telegram routing plugin that intercepts message events and routes based on thread_id.',
    category: 'telegram',
    completed: true
  },
  {
    id: 'step-15b',
    partNumber: 4,
    partTitle: 'Part 04 / 08 — Telegram routing — one channel per agent',
    stepNumber: '15b',
    title: 'Turn On Multi-Agent Mode & Restart',
    description: 'Enable multi-agent flag in hermes.json and restart daemon to apply router configuration.',
    category: 'telegram',
    completed: true
  },

  // Part 05
  {
    id: 'step-15c',
    partNumber: 5,
    partTitle: 'Part 05 / 08 — Read-only server + data layer',
    stepNumber: '15c',
    title: 'Reset Each Channel So the New Routing Takes Over',
    description: 'Send test pings to each thread to flush old context buffers and verify fresh agent isolation.',
    category: 'server',
    completed: true
  },
  {
    id: 'step-16',
    partNumber: 5,
    partTitle: 'Part 05 / 08 — Read-only server + data layer',
    stepNumber: '16',
    title: 'Verify Each Channel Runs Its Real Agent',
    description: 'Execute identity challenge queries in every thread to ensure no Orchestrator bleed occurs.',
    category: 'server',
    completed: true
  },

  // Part 06
  {
    id: 'step-17',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '17',
    title: 'Explore the Hermes Data Sources (Read-Only)',
    description: 'Audit board.db, logs directory, Obsidian vaults, and OpenRouter endpoints for read-only access.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-18',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '18',
    title: 'Build server.py — The Read-Only Data Layer',
    description: 'Create fast API proxy serving fleet state, task updates, metrics, and markdown document streams.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-19',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '19',
    title: 'Build the Web Upload Page',
    description: 'Provide secure file & markdown upload interface for seeding vaults and agent datasets.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-20',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '20',
    title: 'Use the Uploaded Template as the Dashboard',
    description: 'Hydrate the modern Airbyte-styled Mission Control dashboard with live state.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-21',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '21',
    title: 'Backup Protocol & Version Badge',
    description: 'Display live version status and automated snapshot backups across memory stores.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-22',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '22',
    title: 'Wire the Live Data Layer (Overview + Agents)',
    description: 'Connect overview cards and agent fleet status to real-time state machine.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-23',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '23',
    title: 'Wire the Agent Detail Drawer',
    description: 'Enable slide-out drawers detailing workspace files, active tasks, token spend, and capabilities.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-24',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '24',
    title: 'Wire the Tasks Board to board.db',
    description: 'Connect Kanban board with columns, live subtask checklists, and direct task execution triggers.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-25',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '25',
    title: 'Wire the Chat Tab to a Live Telegram Session',
    description: 'Embed multi-thread Telegram bridge simulator enabling real-time chatting with any specialist agent.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-26',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '26',
    title: 'Wire the Content Library',
    description: 'Browse, edit, and search Obsidian markdown documents with wikilink graph preview.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-27',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '27',
    title: 'Agent Document Storage Protocol',
    description: 'Enforce standard frontmatter, wikilink formatting, and automated folder categorization.',
    category: 'dashboard',
    completed: true
  },
  {
    id: 'step-28',
    partNumber: 6,
    partTitle: 'Part 06 / 08 — Mission control dashboard — wire every tab live',
    stepNumber: '28',
    title: 'Wire the Schedule Tab to Hermes Cron',
    description: 'Display scheduled recurring scrapers and autonomous agents with manual "Run Now" buttons.',
    category: 'dashboard',
    completed: true
  },

  // Part 07
  {
    id: 'step-29',
    partNumber: 7,
    partTitle: 'Part 07 / 08 — Remote access & optional add-ons',
    stepNumber: '29',
    title: 'Wire the Office 3D Active/Idle Glow',
    description: 'Render interactive 3D / Isometric Office simulation showing real-time agent desks glowing when active.',
    category: 'remote',
    completed: true
  },
  {
    id: 'step-30',
    partNumber: 7,
    partTitle: 'Part 07 / 08 — Remote access & optional add-ons',
    stepNumber: '30',
    title: 'Final Verification & Version Stamp',
    description: 'Verify all 32 components, ensure every button is responsive, and stamp Hermes OS v3.8.4.',
    category: 'remote',
    completed: true
  },

  // Part 08 - Troubleshooting
  {
    id: 'step-31',
    partNumber: 8,
    partTitle: 'Part 08 / 08 — Troubleshooting prompts',
    stepNumber: '31',
    title: 'Secure Remote Access with Tailscale',
    description: 'Expose mission control dashboard securely over Tailscale VPN without opening public ports.',
    category: 'troubleshooting',
    completed: true
  },
  {
    id: 'step-32',
    partNumber: 8,
    partTitle: 'Part 08 / 08 — Troubleshooting prompts',
    stepNumber: '32',
    title: 'Optional Add-On: Complexity-Based Model Routing',
    description: 'Configure router heuristics to escalate difficult tasks to DeepSeek R1 and simple queries to Flash.',
    category: 'troubleshooting',
    completed: true
  },
  {
    id: 'step-t1',
    partNumber: 8,
    partTitle: 'Part 08 / 08 — Troubleshooting prompts',
    stepNumber: 'T1',
    title: 'Routing Plugin Not Working (every channel answers as Orchestrator)',
    description: 'Diagnostic & fix: Verify thread_id capture in plugin config and restart Hermes multi-agent daemon.',
    category: 'troubleshooting',
    completed: true,
    codeSnippet: `hermes router test --thread-id 102 --expect "scout"`
  },
  {
    id: 'step-t2',
    partNumber: 8,
    partTitle: 'Part 08 / 08 — Troubleshooting prompts',
    stepNumber: 'T2',
    title: 'Tasks Board Drag-and-Drop Not Working',
    description: 'Diagnostic & fix: Re-sync board.db schema and ensure column state transitions have valid transition permissions.',
    category: 'troubleshooting',
    completed: true,
    codeSnippet: `hermes kanban repair --db /data/board.db`
  }
];

export const INITIAL_GUIDE_STEPS = GUIDE_CURRICULUM;

// ==========================================
// 1. INTAKE & TRIAGE ENGINE INITIAL DATA
// ==========================================
export const INITIAL_INTAKE_ITEMS: IntakeItem[] = [
  {
    id: 'INTK-2026-0892',
    rawInput: 'Jarvis voice memo: We need an automated GEO (Generative Engine Optimization) audit crawler that scores how our AI agents rank inside Perplexity, ChatGPT Search, and Gemini Overviews, then drafts an executive markdown memo.',
    origin: 'VOICE_MEMO_JARVIS',
    timestamp: '2026-08-27 21:48:12',
    status: 'optimized',
    complexityScore: 8,
    cognitiveLoad: 'Heavy',
    recommendedAgent: 'dev',
    recommendedModelTier: 'FAST_CODE',
    recommendedModel: 'claudecode',
    suggestedSkills: ['system:advanced-drive-search', 'python_runner', 'mcp:custom_geo', 'web_search'],
    contextEnrichment: [
      'Connected to Obsidian vault [[Startup-Theses/GEO-Search-Dominance]]',
      'Target engines: Perplexity Sonar, OpenAI SearchGPT, Google AI Overviews',
      'Requires sub-500ms scoring loop and weekly cron execution'
    ],
    deliverableSpec: {
      objective: 'Deploy a headless GEO query synthesizer that evaluates 50 industry seed keywords and calculates share-of-voice metric.',
      constraints: ['No Selenium bloat - use Playwright or lightweight curl with JSON headers', 'Output must link to [[Audits/GEO-2026]]'],
      expectedOutputFormat: 'Structured JSON telemetry report + Obsidian Markdown Executive Summary',
      evaluationCriteria: 'Zero timeout failures across all 3 search providers; valid [[wikilinks]] matrix generated.'
    },
    dependencies: ['TSK-2026-0889'],
    audioWaveformData: [22, 45, 78, 92, 65, 43, 89, 110, 75, 40, 60, 95, 120, 80, 50]
  },
  {
    id: 'INTK-2026-0893',
    rawInput: 'Directive via Telegram #orchestrator-bridge: Synthesize all competitor funding rounds in the autonomous coding agent space from Q1-Q3 2026 and compute our token cost arbitrage vs Claude Code.',
    origin: 'TELEGRAM',
    timestamp: '2026-08-27 21:15:04',
    status: 'approved',
    complexityScore: 6,
    cognitiveLoad: 'Moderate',
    recommendedAgent: 'analytics',
    recommendedModelTier: 'FRONTIER_REASONING',
    recommendedModel: 'deepseek',
    suggestedSkills: ['data_extractor', 'report_generation', 'workspace_search'],
    contextEnrichment: [
      'Token baseline: Nous Hermes 3 on OpenRouter at $0.80/1M vs Claude 3.7 at $3.00/1M',
      'Competitors tracked: Cognition Devin, Cursor Agent, Augment Code, Replit Agent'
    ],
    deliverableSpec: {
      objective: 'Calculate gross margin differential for 10M token daily run-rate across our 6-agent swarm vs monolithic single-model architecture.',
      constraints: ['Must produce comparative tabular matrix and ROI payback curve in days'],
      expectedOutputFormat: 'Obsidian Investment Note at [[Financials/Swarm-Arbitrage-2026]]',
      evaluationCriteria: 'Accurate pricing tables verified against OpenRouter API endpoints.'
    },
    dependencies: []
  },
  {
    id: 'INTK-2026-0894',
    rawInput: 'Webhook from GitHub: New PR submitted for Fish Audio dual-channel jitter buffer with fallback to Web Audio Context and Barge-In detection.',
    origin: 'EMAIL_WEBHOOK',
    timestamp: '2026-08-27 20:30:10',
    status: 'pending_triage',
    complexityScore: 7,
    cognitiveLoad: 'Moderate',
    recommendedAgent: 'dev',
    recommendedModelTier: 'FAST_CODE',
    recommendedModel: 'codex',
    suggestedSkills: ['bash_executor', 'file_editor', 'git_manager'],
    contextEnrichment: [
      'Affects /src/services/fishAudio.ts and Jarvis real-time streaming layer',
      'Target latency: <180ms TTFA (Time-to-First-Audio)'
    ],
    deliverableSpec: {
      objective: 'Run automated audio test harness, verify zero unhandled Promise rejections on autoplay blockage, and merge PR.',
      constraints: ['Must maintain compatibility with voice ID 05b36da8574341d0803391491850db20'],
      expectedOutputFormat: 'Test logs + Passing TypeScript compilation check',
      evaluationCriteria: 'Clean audio playback on iOS/Safari and Chrome without user gesture warnings.'
    },
    dependencies: []
  },
  {
    id: 'INTK-2026-0895',
    rawInput: 'Voice Memo: Scout needs to scrape 150 B2B nursery & plant supply leads across Southern California and sync them directly into our CRM spreadsheet and Obsidian directory.',
    origin: 'VOICE_MEMO_JARVIS',
    timestamp: '2026-08-27 19:10:44',
    status: 'dispatched',
    complexityScore: 5,
    cognitiveLoad: 'Light',
    recommendedAgent: 'scout',
    recommendedModelTier: 'LONG_CONTEXT',
    recommendedModel: 'perplexity',
    suggestedSkills: ['web_search', 'data_extractor', 'sheets_updater'],
    contextEnrichment: [
      'Target geography: Los Angeles, Orange County, San Diego',
      'Fields required: Business Name, Phone, Website, Instagram, Estimated Revenue'
    ],
    deliverableSpec: {
      objective: 'Harvest and clean 150 qualified plant nursery wholesale accounts.',
      constraints: ['Verify phone number formats and eliminate duplicates'],
      expectedOutputFormat: 'CSV / JSON table and synced cards in Lead Scraper tab',
      evaluationCriteria: '100% email/phone validation rate on top 50 entries.'
    },
    dependencies: [],
    audioWaveformData: [15, 30, 60, 85, 90, 70, 45, 65, 80, 55, 30, 20]
  }
];

// ==========================================
// 2. IDEA BACKLOG & STRATEGY HUB INITIAL DATA
// ==========================================
export const INITIAL_IDEAS: IdeaItem[] = [
  {
    id: 'IDEA-101',
    title: 'Autonomous Local LLM Micro-Node Mesh on Apple Silicon',
    summary: 'Orchestrate distributed inference across 4x Mac Studios running MLX/Ollama to eliminate all external cloud API fees during heavy batch jobs.',
    domain: 'Infrastructure',
    status: 'exploring',
    potentialImpact: 'Moonshot',
    effortEstimate: 'Medium (1w)',
    tags: ['mlx', 'apple-silicon', 'zero-cost', 'privacy'],
    notes: [
      'Use Hermes 3 70B Quantized 4-bit with 120 tokens/sec local throughput.',
      'Connect via Tailscale peer-to-peer mesh so remote mobile agents can query it seamlessly.',
      'Auto-failover to OpenRouter if local queue exceeds 2.5 seconds.'
    ],
    targetAudience: 'Internal Swarm Compute & Enterprise AI Clients',
    monetizationModel: '100% cost reduction on high-volume background tasks',
    wikilinks: ['Infrastructure/Local-Inference-Mesh', 'Architecture/MLX-Cluster'],
    authorAgent: 'dev',
    createdAt: '2026-08-26 14:20:00',
    updatedAt: '2026-08-27 18:30:00'
  },
  {
    id: 'IDEA-102',
    title: 'Viral Interactive Startup Thesis Generator Widget',
    summary: 'Embeddable dynamic canvas for founders to enter any industry prompt and watch 6 specialized agents generate a complete 20-page investment memo in 45 seconds.',
    domain: 'Growth',
    status: 'synthesized',
    potentialImpact: 'High',
    effortEstimate: 'Small (1-2d)',
    tags: ['viral-loop', 'gtm', 'lead-magnet', 'public-demo'],
    notes: [
      'Reach agent estimates 12,000+ developer impressions on X/Twitter and LinkedIn.',
      'Integrate real-time Fish Audio voice commentary explaining the pitch deck.',
      'One-click export to Obsidian Vault or Notion Workspace.'
    ],
    targetAudience: 'Angel Investors, Venture Studios, Solo Founders',
    monetizationModel: 'Freemium Top-of-Funnel leading to Hermes AgentOS Pro subscription',
    wikilinks: ['Startup-Theses/Viral-Lead-Engine', 'Growth/GTM-Launch-Strategy'],
    authorAgent: 'reach',
    createdAt: '2026-08-25 11:00:00',
    updatedAt: '2026-08-27 20:00:00'
  },
  {
    id: 'IDEA-103',
    title: 'Self-Healing TypeScript Test Runner with Automatic Git Patching',
    summary: 'Background daemon that catches failing CI/CD tests, feeds the AST and stack trace to Claude Code 3.7, generates a localized surgical patch, tests it in a sandbox, and submits a PR with diff proof.',
    domain: 'AI Core',
    status: 'raw',
    potentialImpact: 'High',
    effortEstimate: 'Medium (1w)',
    tags: ['self-healing', 'ci-cd', 'devops', 'claudecode'],
    notes: [
      'Limits patch size to max 3 modified files to prevent hallucinated refactoring.',
      'Runs full lint_applet and compile_applet in sandbox before creating commit.'
    ],
    targetAudience: 'Software Engineering Teams, Agency Devs',
    monetizationModel: 'B2B Developer Tooling SaaS ($199/repo/mo)',
    wikilinks: ['Tooling/Self-Healing-Compiler', 'Agents/Dev-Specialist'],
    authorAgent: 'dev',
    createdAt: '2026-08-27 09:15:00',
    updatedAt: '2026-08-27 19:40:00'
  },
  {
    id: 'IDEA-104',
    title: 'B2B Plant Nursery SaaS & Plant Health Diagnostic Mobile App',
    summary: 'Turn our scraped 1,200 nursery leads into a high-margin vertical SaaS platform offering automated inventory sync, plant health AI computer vision, and wholesale supplier ordering.',
    domain: 'Product',
    status: 'exploring',
    potentialImpact: 'High',
    effortEstimate: 'Large (2-4w)',
    tags: ['vertical-saas', 'nurseries', 'computer-vision', 'inventory'],
    notes: [
      'Market TAM in US alone is $42B across independent garden centers and wholesale growers.',
      'Combine Gemini 3.7 Multimodal camera feed with local inventory database.'
    ],
    targetAudience: 'Independent Nursery Owners, Commercial Landscapers',
    monetizationModel: 'Subscription ($149/mo) + 1.5% marketplace processing fee',
    wikilinks: ['Projects/Nursery-SaaS-Spec', 'Leads/Plant-Supply-Outreach'],
    authorAgent: 'scribe',
    createdAt: '2026-08-24 16:30:00',
    updatedAt: '2026-08-27 17:10:00'
  }
];

// ==========================================
// 3. SKILL REGISTRY & MCP TOOL MANAGER INITIAL DATA
// ==========================================
export const INITIAL_SKILLS: SkillDefinition[] = [
  {
    id: 'skill-fish-audio-tts',
    name: 'fish_audio_tts',
    description: 'Ultra-low latency neural speech synthesis for Jarvis multimodal console with custom voice ID 05b36da8574341d0803391491850db20.',
    category: 'system',
    version: '2.4.0',
    enabled: true,
    permissions: ['network', 'audio_stream'],
    executionMode: 'autonomous',
    parametersSchema: {
      text: { type: 'string', required: true, description: 'Text chunk to synthesize into speech' },
      reference_id: { type: 'string', default: '05b36da8574341d0803391491850db20' },
      latency: { type: 'string', enum: ['low', 'balanced', 'normal'], default: 'balanced' },
      normalize: { type: 'boolean', default: true }
    },
    markdownSpec: `---
name: fish_audio_tts
description: Converts text directives into natural streaming audio using the configured Fish Audio neural voice model.
permissions: ["network", "audio_stream"]
---
# Instructions
1. Parse incoming text into syntactically valid clause blocks.
2. Dispatch POST /v1/tts to Fish Audio with Bearer authorization and normalize: true.
3. Stream audio bytes directly to the 150ms client jitter buffer for playback.`,
    sourceFile: '/src/services/fishAudio.ts',
    author: 'Hermes Core Team',
    callCount: 1420,
    successRate: 99.4,
    lastExecuted: 'Just now'
  },
  {
    id: 'skill-bash-executor',
    name: 'bash_executor',
    description: 'Executes sandboxed bash commands, test suites, git commands, and shell utilities in the active agent container.',
    category: 'tool',
    version: '3.1.0',
    enabled: true,
    permissions: ['shell_exec', 'filesystem'],
    executionMode: 'autonomous',
    parametersSchema: {
      command: { type: 'string', required: true, description: 'Shell command line to execute' },
      timeoutMs: { type: 'number', default: 30000 },
      cwd: { type: 'string', default: '.' }
    },
    markdownSpec: `---
name: bash_executor
description: Execute deterministic shell scripts and build harnesses with stdout/stderr telemetry.
permissions: ["shell_exec", "filesystem"]
---
# Instructions
1. Sanitize command string to avoid accidental destructive root deletions.
2. Execute command with PAGER=cat and return stdout + stderr stream.
3. Emit execution duration and return code to caller.`,
    sourceFile: '/src/services/executor.ts',
    author: 'Hermes Dev Fleet',
    callCount: 3840,
    successRate: 98.7,
    lastExecuted: '2 mins ago'
  },
  {
    id: 'skill-obsidian-vault-sync',
    name: 'obsidian_vault_sync',
    description: 'Bi-directional markdown synchronization with Obsidian Knowledge Graph, auto-generating [[wikilinks]] and frontmatter tags.',
    category: 'integration',
    version: '1.9.5',
    enabled: true,
    permissions: ['filesystem', 'drive_write'],
    executionMode: 'autonomous',
    parametersSchema: {
      title: { type: 'string', required: true },
      folder: { type: 'string', default: 'Startup-Theses' },
      content: { type: 'string', required: true },
      wikilinks: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } }
    },
    markdownSpec: `---
name: obsidian_vault_sync
description: Writes structured markdown notes with clean frontmatter metadata and recursive [[wikilinks]].
permissions: ["filesystem", "drive_write"]
---
# Instructions
1. Format document with YAML metadata headers.
2. Inject bidirectional wikilinks referencing related entities and agents.
3. Write file into vault directory and trigger instant UI graph re-indexing.`,
    sourceFile: '/src/services/obsidian.ts',
    author: 'Scribe Specialist',
    callCount: 890,
    successRate: 100.0,
    lastExecuted: '5 mins ago'
  },
  {
    id: 'skill-advanced-drive-search',
    name: 'advanced_drive_search',
    description: 'Semantic vector search across Google Drive, local PDF archives, and workspace document repositories.',
    category: 'system',
    version: '2.0.1',
    enabled: true,
    permissions: ['drive_read', 'network'],
    executionMode: 'autonomous',
    parametersSchema: {
      query: { type: 'string', required: true },
      maxResults: { type: 'number', default: 10 },
      fileTypes: { type: 'array', items: { type: 'string' } }
    },
    markdownSpec: `---
name: advanced_drive_search
description: Search across all connected Drive documents, sheets, and local markdown memory.
permissions: ["drive_read", "network"]
---
# Instructions
1. Extract semantic query tokens.
2. Query vector database and return top 10 relevant document passages with direct links.`,
    sourceFile: '/src/services/driveSearch.ts',
    author: 'Chief of Staff',
    callCount: 650,
    successRate: 99.1,
    lastExecuted: '12 mins ago'
  },
  {
    id: 'skill-mcp-custom-geo',
    name: 'mcp:custom_geo',
    description: 'Model Context Protocol (MCP) server for Generative Engine Optimization telemetry, scoring AI search index visibility.',
    category: 'mcp',
    version: '1.2.0',
    enabled: true,
    permissions: ['network'],
    executionMode: 'autonomous',
    parametersSchema: {
      targetBrand: { type: 'string', required: true },
      queries: { type: 'array', items: { type: 'string' } },
      engines: { type: 'array', items: { type: 'string' } }
    },
    markdownSpec: `---
name: mcp:custom_geo
description: MCP connector evaluating LLM search engine citations and brand visibility.
permissions: ["network"]
---
# Instructions
1. Dispatch parallel search requests to Perplexity, SearchGPT, and Gemini.
2. Parse cited sources, domain frequency, and compute composite GEO score.`,
    sourceFile: '/mcp/geo_server.py',
    author: 'Growth & Reach Agent',
    callCount: 420,
    successRate: 97.6,
    lastExecuted: '25 mins ago'
  },
  {
    id: 'skill-telegram-thread-dispatcher',
    name: 'telegram_thread_dispatcher',
    description: 'Routes messages, notifications, and task completions to dedicated Telegram thread channels (101-106).',
    category: 'tool',
    version: '2.3.0',
    enabled: true,
    permissions: ['network'],
    executionMode: 'autonomous',
    parametersSchema: {
      threadId: { type: 'number', required: true },
      message: { type: 'string', required: true },
      agentRole: { type: 'string', required: true }
    },
    markdownSpec: `---
name: telegram_thread_dispatcher
description: Isolates communications by routing outbound payloads to designated thread IDs.
permissions: ["network"]
---
# Instructions
1. Check recipient thread ID (101: Orchestrator, 102: Scout, 103: Scribe, 104: Reach, 105: Dev, 106: Analytics).
2. Transmit formatted HTML message with model telemetry metadata.`,
    sourceFile: '/src/services/telegram.ts',
    author: 'Hermes Fleet Master',
    callCount: 2940,
    successRate: 99.8,
    lastExecuted: 'Just now'
  }
];

// ==========================================
// 4. SYSTEM AUDIT & DIAGNOSTICS INITIAL DATA
// ==========================================
export const INITIAL_SYSTEM_AUDIT_CHECKS: SystemAuditCheck[] = [
  {
    id: 'audit-01',
    component: 'Fish Audio Neural TTS Voice Pipeline',
    category: 'audio_pipeline',
    status: 'passed',
    latencyMs: 78,
    message: 'Voice ID 05b36da8574341d0803391491850db20 active with 150ms buffer and Web Audio fallback.',
    lastTested: 'Just now',
    traceLog: 'POST https://api.fish.audio/v1/tts HTTP/1.1 200 OK (78ms, 34.2KB audio/mpeg)'
  },
  {
    id: 'audit-02',
    component: 'OpenRouter & Frontier Model Arbitration',
    category: 'model_latency',
    status: 'passed',
    latencyMs: 112,
    message: 'All 12 frontier models online. Smart auto-routing active with sub-150ms handshake.',
    lastTested: '1 min ago',
    traceLog: 'Checked endpoints: nousresearch/hermes-3, anthropic/claude-3.7, deepseek/r1, google/gemini-3.7-flash'
  },
  {
    id: 'audit-03',
    component: 'Kanban State Machine (board.db)',
    category: 'control_integrity',
    status: 'passed',
    latencyMs: 12,
    message: 'All 6 lifecycle stages (Intake, Queued, In Progress, Review, Done, Blocked) synchronized.',
    lastTested: 'Just now',
    traceLog: 'board.db integrity check: 0 orphan tasks, 100% foreign key consistency on agent_roles'
  },
  {
    id: 'audit-04',
    component: 'Telegram Thread Router Mesh (Channels 101-106)',
    category: 'api_routing',
    status: 'passed',
    latencyMs: 45,
    message: 'Zero routing crossover. All 6 specialist threads isolated and responding in sandbox.',
    lastTested: '3 mins ago',
    traceLog: 'Verified thread isolation: 101 (#orchestrator), 102 (#scout), 103 (#scribe), 104 (#reach), 105 (#dev), 106 (#analytics)'
  },
  {
    id: 'audit-05',
    component: 'Obsidian Knowledge Graph & Wikilink Syncer',
    category: 'memory_vault',
    status: 'passed',
    latencyMs: 24,
    message: '28 notes indexed across [[Startup-Theses]], [[Architecture]], and [[Financials]].',
    lastTested: '5 mins ago',
    traceLog: 'Parsed 142 bidirectional wikilinks. Graph diameter: 4 hops, average clustering coefficient: 0.78'
  },
  {
    id: 'audit-06',
    component: 'Interactive Controls & Button Integrity Monitor',
    category: 'control_integrity',
    status: 'passed',
    latencyMs: 8,
    message: '100% interactive controls verified. Zero dead links, zero unhandled onClick promises.',
    lastTested: 'Just now',
    traceLog: 'Audited 48 buttons, 14 modal triggers, 8 filter chips, and 6 audio playback controls.'
  }
];
