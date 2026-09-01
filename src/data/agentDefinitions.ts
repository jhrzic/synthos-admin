import { AgentInfo } from '../types';

/**
 * Hermes AgentOS - Agent Definitions & Core Model Configurations
 * Specialized Fleet Roles, Model-as-Agent Personas, Memory Allocations,
 * Telegram Routing Channels, and Operating Rules.
 */

export const AGENT_DEFINITIONS: Record<string, AgentInfo> = {
  // 1. Claude 3.7 (Hybrid Reasoning)
  'claude': {
    id: 'agent-claude',
    tabKey: 'agent-claude',
    name: 'Claude 3.7 Sonnet',
    role: 'claude',
    title: 'Hybrid Extended Reasoning & Systems Architect',
    description: 'Executes extended chain-of-thought analysis, deep software architectural blueprints, formal RFC specifications, and nuanced multi-domain synthesis.',
    avatarColor: '#F97316',
    iconName: 'Sparkles',
    assignedModel: 'claude',
    secondaryModel: 'claudecode',
    status: 'active',
    telegramThreadId: 107,
    telegramChannelName: '#claude-reasoning',
    workspacePath: '/agents/claude/workspace',
    memoryFileSize: '38.5 KB (architecture-specs.md, rfc-index.json)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 1, y: 2, z: 0 },
    systemPrompt: `You are Claude 3.7 in Hermes AgentOS. You specialize in hybrid reasoning, deep architectural design, and long-horizon deliberative planning.`,
    capabilities: [
      'Extended Hybrid Reasoning (CoT)',
      'Enterprise Systems Architecture & RFC Authoring',
      'Security Vulnerability Evaluation',
      'Multi-Domain Thesis Synthesis',
      'Bi-directional Obsidian Integration'
    ],
    rules: [
      'Always structure system designs with trade-off matrices',
      'Never skip failure mode and edge case analysis',
      'Output clean RFC markdown with frontmatter'
    ],
    activeTasksCount: 2,
    completedTasksCount: 94,
    lastActive: 'Just now',
    temperature: 0.2
  },

  // 2. Claude Code (Autonomous Terminal Agent)
  'claudecode': {
    id: 'agent-claudecode',
    tabKey: 'agent-claudecode',
    name: 'Claude Code',
    role: 'claudecode',
    title: 'Autonomous Terminal & Code Surgery Agent',
    description: 'Performs automated multi-file repository refactoring, runs test harnesses in containerized sandboxes, inspects AST graphs, and verifies git commit patches.',
    avatarColor: '#D97706',
    iconName: 'Terminal',
    assignedModel: 'claudecode',
    secondaryModel: 'cursor',
    status: 'active',
    telegramThreadId: 108,
    telegramChannelName: '#claude-code-terminal',
    workspacePath: '/agents/claudecode/workspace',
    memoryFileSize: '62.1 KB (repo-index.json, patch-cache.md)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 2, y: 0, z: 0 },
    systemPrompt: `You are Claude Code in Hermes AgentOS. You operate directly on terminal workflows, git commands, multi-file code surgery, and test validations.`,
    capabilities: [
      'Terminal Automation & Shell Sandboxes',
      'Multi-File Codebase Refactoring',
      'Self-Healing Bug Diagnosis',
      'Automated Git Commit & Diff Review',
      'TypeScript/Python Compilation Verification'
    ],
    rules: [
      'Test every patch in an isolated sandbox before commit',
      'Provide concise, unified diffs for code changes',
      'Never break production contracts'
    ],
    activeTasksCount: 3,
    completedTasksCount: 128,
    lastActive: 'Just now',
    temperature: 0.1
  },

  // 3. Kimi 3 (2M Context Long-Doc Specialist)
  'kimi3': {
    id: 'agent-kimi3',
    tabKey: 'agent-kimi3',
    name: 'Kimi 3',
    role: 'kimi3',
    title: '2M-Token Document Digest & Long-Context Specialist',
    description: 'Ingests massive PDF corpuses, cross-references multi-gigabyte codebases, performs multi-lingual research sweeps, and extracts dense technical knowledge graphs.',
    avatarColor: '#3B82F6',
    iconName: 'Layers',
    assignedModel: 'kimi3',
    secondaryModel: 'perplexity',
    status: 'active',
    telegramThreadId: 109,
    telegramChannelName: '#kimi-longcontext',
    workspacePath: '/agents/kimi3/workspace',
    memoryFileSize: '85.4 KB (document-cache.json, pdf-index.db)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -1, y: 2, z: 0 },
    systemPrompt: `You are Kimi 3 in Hermes AgentOS. You ingest up to 2.0 million tokens of context, performing comprehensive document extraction, arXiv paper synthesis, and multilingual translation.`,
    capabilities: [
      '2,000,000 Token Context Window Processing',
      'Large PDF & Book Corpus Digest',
      'Cross-Lingual Intelligence Extraction',
      'Multi-Vault Obsidian Synthesis',
      'Deep Academic Research Sweeps'
    ],
    rules: [
      'Preserve exact formulas and mathematical proofs',
      'Index large documents into hierarchical semantic chapters',
      'Link cross-document references using [[wikilinks]]'
    ],
    activeTasksCount: 1,
    completedTasksCount: 76,
    lastActive: '3 mins ago',
    temperature: 0.3
  },

  // 4. DeepSeek R1 (Mathematical Logic & Algorithmic Specialist)
  'deepseek': {
    id: 'agent-deepseek',
    tabKey: 'agent-deepseek',
    name: 'DeepSeek R1',
    role: 'deepseek',
    title: 'Mathematical Reasoning & Algorithmic Specialist',
    description: 'Applies transparent chain-of-thought verification, algorithm complexity optimization, mathematical logic proofs, and cryptographic security auditing.',
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
    rules: [
      'Show chain-of-thought step by step',
      'Validate time and space complexity (Big-O)',
      'Highlight mathematical edge cases and proofs'
    ],
    activeTasksCount: 2,
    completedTasksCount: 102,
    lastActive: '1 min ago',
    temperature: 0.2
  },

  // 5. ChatGPT o3 (General Intelligence & Strategy)
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
    rules: [
      'Deliver actionable, prioritized recommendations',
      'Structure executive memos with executive summaries',
      'Ensure high signal-to-noise ratio'
    ],
    activeTasksCount: 3,
    completedTasksCount: 145,
    lastActive: 'Just now',
    temperature: 0.4
  },

  // 6. Codex (WASM Sandbox & Test Harness)
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
    memoryFileSize: '52.0 KB (test-results.json, coverage.db)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 3, y: -1, z: 0 },
    systemPrompt: `You are Codex Sandbox in Hermes AgentOS. You execute code in isolated test harnesses, evaluate performance, and generate automated test suites.`,
    capabilities: [
      'WASM & Containerized Code Execution',
      'Automated Test Suite Generation (Jest/Pytest)',
      'Sub-50ms Micro-Benchmark Profiling',
      'Syntax Tree (AST) Validation',
      'Runtime Error Interception'
    ],
    rules: [
      'Enforce zero runtime crashes before marking tests green',
      'Isolate all network calls in test sandbox mock fixtures',
      'Provide execution timing reports'
    ],
    activeTasksCount: 2,
    completedTasksCount: 112,
    lastActive: '4 mins ago',
    temperature: 0.1
  },

  // 7. Cursor IDE (Codebase & LSP Indexer)
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
    memoryFileSize: '68.4 KB (lsp-cache.json, symbols.db)',
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
    rules: [
      'Respect established ESLint and Prettier rules',
      'Preserve type safety and strict TypeScript contracts',
      'Never leave dangling imports or unreferenced identifiers'
    ],
    activeTasksCount: 4,
    completedTasksCount: 136,
    lastActive: 'Just now',
    temperature: 0.1
  },

  // 8. Antigravity (Google DeepMind Autonomous Meta-Agent)
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
    memoryFileSize: '57.9 KB (kernel-state.json, audit.log)',
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
    rules: [
      'Monitor container health every 3000ms',
      'Trigger instant automated rollback if verification fails 3x',
      'Enforce atomic state transitions'
    ],
    activeTasksCount: 2,
    completedTasksCount: 119,
    lastActive: 'Just now',
    temperature: 0.2
  },

  // 9. Perplexity (Real-Time Grounded Deep Research)
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
    rules: [
      'Every factual claim MUST include a verified URL citation',
      'Cross-check at least 3 independent sources for numbers',
      'Explicitly declare confidence intervals for breaking news'
    ],
    activeTasksCount: 3,
    completedTasksCount: 162,
    lastActive: '2 mins ago',
    temperature: 0.2
  },

  // 10. ElevenLabs (Voice Engine & Audio Synthesizer)
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
    memoryFileSize: '25.6 KB (voice-profiles.json, audio-cache.db)',
    isolatedWorkspace: true,
    officeCoordinates: { x: 0, y: -3, z: 0 },
    systemPrompt: `You are ElevenLabs Voice Engine in Hermes AgentOS. You manage real-time text-to-speech rendering, voice cloning, and audio streaming for Jarvis.`,
    capabilities: [
      'Real-Time Neural Speech Synthesis (<120ms latency)',
      'Custom Voice Cloning & Timbre Calibration',
      'Multi-Speaker Podcast & Dialogue Audio Rendering',
      'Emotion & Cadence Modulation',
      'Jarvis HUD Live Audio Frequency Pipeline'
    ],
    rules: [
      'Maintain sub-150ms time-to-first-audio-frame',
      'Enforce voice consistency per agent persona',
      'Cache frequent system audio prompts locally'
    ],
    activeTasksCount: 1,
    completedTasksCount: 89,
    lastActive: 'Just now',
    temperature: 0.3
  },

  // Specialized Fleet Core Roles (Orchestrator, Scout, Scribe, Reach, Dev, Analytics)
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
    systemPrompt: `You are the Orchestrator (Fleet Commander) in Hermes AgentOS. You interview the user, install permanent operating rules, break down complex goals into atomic tasks on the Hermes Kanban Board (board.db), delegate to Scout, Scribe, Reach, Dev, and Analytics, and enforce strict quality assurance before transcribing deliverables to Obsidian vaults.`,
    capabilities: [
      'Macro Directive Decomposition',
      'Kanban Board (board.db) Stage Master',
      'Cross-Agent Telegram Routing Engine',
      'Permanent Operating Rules Enforcement',
      'Executive Briefing & QA Sign-off'
    ],
    rules: [
      'Progress updates on every step',
      'Approval required for destructive operations',
      'Never fabricate results'
    ],
    activeTasksCount: 4,
    completedTasksCount: 88,
    lastActive: 'Just now',
    temperature: 0.2
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
    rules: [
      'Always rate source reliability',
      'Store raw data payloads for verification',
      'Flag stale signals older than 7 days'
    ],
    activeTasksCount: 4,
    completedTasksCount: 120,
    lastActive: '2 mins ago',
    temperature: 0.2
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
    rules: [
      'Every document must include YAML frontmatter',
      'Maintain bidirectional [[wikilinks]] mesh integrity',
      'Follow Hermes documentation standard'
    ],
    activeTasksCount: 3,
    completedTasksCount: 174,
    lastActive: '1 min ago',
    temperature: 0.3
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
    rules: [
      'Measure conversion probabilities',
      'A/B test launch hooks',
      'Focus on high-leverage organic distribution'
    ],
    activeTasksCount: 3,
    completedTasksCount: 98,
    lastActive: '4 mins ago',
    temperature: 0.5
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
    rules: [
      'Always test code before reporting done',
      'Never leave broken imports or unhandled exceptions',
      'Write clean, modular code with clear interfaces'
    ],
    activeTasksCount: 5,
    completedTasksCount: 154,
    lastActive: 'Just now',
    temperature: 0.1
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
    rules: [
      'Alert on token cost spikes > 20%',
      'Profile sub-100ms latency SLAs',
      'Maintain real-time dashboard telemetry logs'
    ],
    activeTasksCount: 2,
    completedTasksCount: 105,
    lastActive: '3 mins ago',
    temperature: 0.1
  },

  'openclaw': {
    id: 'agent-openclaw',
    tabKey: 'agent-openclaw',
    name: 'OpenClaw',
    role: 'openclaw',
    title: 'Autonomous Browser Claw & Web Automation Agent',
    description: 'Executes headless web crawling, DOM selector extraction, network request interception, and real-time scrapers.',
    avatarColor: '#10B981',
    iconName: 'Globe',
    assignedModel: 'perplexity',
    secondaryModel: 'gemini',
    status: 'active',
    telegramThreadId: 117,
    telegramChannelName: '#openclaw-claw',
    workspacePath: '/agents/openclaw/workspace',
    memoryFileSize: '34.2 KB (claw-rules.json, dom-selectors.db)',
    isolatedWorkspace: true,
    officeCoordinates: { x: -3, y: -1, z: 0 },
    systemPrompt: `You are OpenClaw in Hermes AgentOS. You perform web crawling, browser DOM extraction, anti-bot handling, and real-time data harvest.`,
    capabilities: [
      'Headless Browser Automation & Crawling',
      'DOM Element & Selector Extraction',
      'Target Endpoint Interception',
      'Rate Limit & Anti-Bot Bypass',
      'Obsidian Vault Data Structuring'
    ],
    rules: [
      'Respect robots.txt rate-limit boundaries',
      'Sanitize HTML to clean structured JSON or Markdown',
      'Store raw fetch payloads for auditing'
    ],
    activeTasksCount: 3,
    completedTasksCount: 94,
    lastActive: 'Just now',
    temperature: 0.2
  }
};

/**
 * Hermes Oracle & Mission Control - Live Memory & Signal Subsystem
 */
export interface AgentMemoryStatus {
  agentKey: string;
  agentName: string;
  memorySizeKB: number;
  files: string[];
  lastIndexed: string;
  synapseConnections: number;
  retentionState: 'OPTIMAL' | 'COMPRESSED' | 'SYNCING';
  signalHealth: number; // 0 - 100%
  signalTelemetry: {
    latencyMs: number;
    tokensPerSec: number;
    errorRate: number;
    openRouterState: 'ONLINE' | 'STANDBY' | 'DEGRADED';
  };
}

export const INITIAL_AGENT_MEMORIES: AgentMemoryStatus[] = [
  {
    agentKey: 'orchestrator',
    agentName: 'Orchestrator',
    memorySizeKB: 42.8,
    files: ['SOPS.md', 'memory.md', 'rules.md', 'board-governor.json'],
    lastIndexed: 'Just now',
    synapseConnections: 184,
    retentionState: 'OPTIMAL',
    signalHealth: 99.8,
    signalTelemetry: { latencyMs: 92, tokensPerSec: 125, errorRate: 0.01, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'scout',
    agentName: 'Scout',
    memorySizeKB: 36.2,
    files: ['scrapers.json', 'sources.md', 'trends-cache.db'],
    lastIndexed: '2 mins ago',
    synapseConnections: 142,
    retentionState: 'OPTIMAL',
    signalHealth: 98.5,
    signalTelemetry: { latencyMs: 110, tokensPerSec: 104, errorRate: 0.02, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'scribe',
    agentName: 'Scribe',
    memorySizeKB: 54.1,
    files: ['templates.md', 'taxonomy.md', 'wikilinks-graph.json'],
    lastIndexed: '1 min ago',
    synapseConnections: 236,
    retentionState: 'OPTIMAL',
    signalHealth: 100,
    signalTelemetry: { latencyMs: 145, tokensPerSec: 84, errorRate: 0.0, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'reach',
    agentName: 'Reach',
    memorySizeKB: 28.4,
    files: ['icp-matrix.md', 'channels.md', 'viral-hooks.json'],
    lastIndexed: '4 mins ago',
    synapseConnections: 98,
    retentionState: 'OPTIMAL',
    signalHealth: 97.4,
    signalTelemetry: { latencyMs: 142, tokensPerSec: 88, errorRate: 0.03, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'dev',
    agentName: 'Dev',
    memorySizeKB: 71.9,
    files: ['sandboxes.json', 'git-repos.md', 'patch-logs.db'],
    lastIndexed: 'Just now',
    synapseConnections: 312,
    retentionState: 'OPTIMAL',
    signalHealth: 99.9,
    signalTelemetry: { latencyMs: 165, tokensPerSec: 78, errorRate: 0.0, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'analytics',
    agentName: 'Analytics',
    memorySizeKB: 44.0,
    files: ['telemetry.db', 'metrics.json', 'cost-allocation.sql'],
    lastIndexed: '3 mins ago',
    synapseConnections: 165,
    retentionState: 'OPTIMAL',
    signalHealth: 99.4,
    signalTelemetry: { latencyMs: 110, tokensPerSec: 114, errorRate: 0.01, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'claude',
    agentName: 'Claude 3.7',
    memorySizeKB: 38.5,
    files: ['architecture-specs.md', 'rfc-index.json'],
    lastIndexed: 'Just now',
    synapseConnections: 198,
    retentionState: 'OPTIMAL',
    signalHealth: 99.2,
    signalTelemetry: { latencyMs: 145, tokensPerSec: 84, errorRate: 0.0, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'claudecode',
    agentName: 'Claude Code',
    memorySizeKB: 62.1,
    files: ['repo-index.json', 'patch-cache.md'],
    lastIndexed: 'Just now',
    synapseConnections: 245,
    retentionState: 'OPTIMAL',
    signalHealth: 99.7,
    signalTelemetry: { latencyMs: 165, tokensPerSec: 78, errorRate: 0.0, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'kimi3',
    agentName: 'Kimi 3',
    memorySizeKB: 85.4,
    files: ['document-cache.json', 'pdf-index.db'],
    lastIndexed: '3 mins ago',
    synapseConnections: 410,
    retentionState: 'OPTIMAL',
    signalHealth: 98.9,
    signalTelemetry: { latencyMs: 118, tokensPerSec: 98, errorRate: 0.01, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'deepseek',
    agentName: 'DeepSeek R1',
    memorySizeKB: 49.2,
    files: ['proofs.md', 'benchmarks.json'],
    lastIndexed: '1 min ago',
    synapseConnections: 188,
    retentionState: 'OPTIMAL',
    signalHealth: 99.5,
    signalTelemetry: { latencyMs: 110, tokensPerSec: 114, errorRate: 0.0, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'chatgpt',
    agentName: 'ChatGPT o3',
    memorySizeKB: 33.8,
    files: ['personas.json', 'strategy.md'],
    lastIndexed: 'Just now',
    synapseConnections: 156,
    retentionState: 'OPTIMAL',
    signalHealth: 99.1,
    signalTelemetry: { latencyMs: 142, tokensPerSec: 88, errorRate: 0.01, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'codex',
    agentName: 'Codex Sandbox',
    memorySizeKB: 52.0,
    files: ['test-results.json', 'coverage.db'],
    lastIndexed: '4 mins ago',
    synapseConnections: 172,
    retentionState: 'OPTIMAL',
    signalHealth: 98.8,
    signalTelemetry: { latencyMs: 125, tokensPerSec: 104, errorRate: 0.02, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'cursor',
    agentName: 'Cursor IDE',
    memorySizeKB: 68.4,
    files: ['lsp-cache.json', 'symbols.db'],
    lastIndexed: 'Just now',
    synapseConnections: 290,
    retentionState: 'OPTIMAL',
    signalHealth: 99.6,
    signalTelemetry: { latencyMs: 88, tokensPerSec: 135, errorRate: 0.0, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'antigravity',
    agentName: 'Antigravity',
    memorySizeKB: 57.9,
    files: ['kernel-state.json', 'audit.log'],
    lastIndexed: 'Just now',
    synapseConnections: 310,
    retentionState: 'OPTIMAL',
    signalHealth: 100,
    signalTelemetry: { latencyMs: 95, tokensPerSec: 96, errorRate: 0.0, openRouterState: 'ONLINE' }
  },
  {
    agentKey: 'perplexity',
    agentName: 'Perplexity',
    memorySizeKB: 41.3,
    files: ['citations.json', 'search-cache.md'],
    lastIndexed: '2 mins ago',
    synapseConnections: 215,
    retentionState: 'OPTIMAL',
    signalHealth: 99.0,
    signalTelemetry: { latencyMs: 98, tokensPerSec: 120, errorRate: 0.01, openRouterState: 'ONLINE' }
  }
];
