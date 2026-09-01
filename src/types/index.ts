export type ActiveTab = 
  | 'overview'
  | 'overview-office'
  | 'intake-triage'
  | 'master-ops'
  | 'work'
  | 'knowledge'
  | 'products'
  | 'system'
  | 'ton'
  | 'twins'
  | 'demos'
  | 'system-audit'
  | 'kanban'
  | 'graph-builder'
  | 'graph-runs'
  | 'activity-ledger'
  | 'receipts'
  | 'guardian-aegis'
  | 'workspaces'
  | 'idea-strategy'
  | 'jarvis'
  | 'skill-registry'
  | 'system-diagnostics'
  | 'message-bridge'
  | 'claude-artifacts'
  | 'lead-scraper'
  | 'ecosystem-repos'
  | 'startup-generator'
  | 'hermes-core'
  | 'hermes-oracle'
  | 'auto-content'
  | 'studio-leadgen'
  | 'model-stacking'
  | 'agent-memory'
  | 'agent-fleet'
  | 'telegram-chat'
  | 'content-library'
  | 'schedule-cron'
  | 'guide-walkthrough'
  | 'model-router'
  | 'obsidian'
  | 'bot-mode'
  // Specialist Fleet Agent Tabs
  | 'agent-orchestrator'
  | 'agent-hermes'
  | 'agent-scout'
  | 'agent-scribe'
  | 'agent-reach'
  | 'agent-dev'
  | 'agent-analytics'
  | 'agent-openclaw'
  | 'agent-chief-of-staff'
  | 'agent-writer'
  | 'agent-coder'
  | 'agent-researcher'
  // Model-as-Agent Tabs
  | 'agent-claude'
  | 'agent-claudecode'
  | 'agent-gemini'
  | 'agent-kimi3'
  | 'agent-deepseek'
  | 'agent-chatgpt'
  | 'agent-codex'
  | 'agent-cursor'
  | 'agent-antigravity'
  | 'agent-perplexity'
  | 'agent-elevenlabs'
  // Frontier Model Views
  | 'hermes'
  | 'hermes-core'
  | 'hermes-overview'
  | 'hermes-chat'
  | 'hermes-terminal'
  | 'hermes-apollo'
  | 'hermes-sessions'
  | 'hermes-agents'
  | 'hermes-bot-mode'
  | 'hermes-kanban'
  | 'hermes-skills'
  | 'hermes-mcps'
  | 'hermes-tools'
  | 'hermes-cron'
  | 'hermes-channels'
  | 'hermes-memory'
  | 'hermes-knowledge'
  | 'hermes-files'
  | 'hermes-models'
  | 'hermes-usage'
  | 'hermes-approvals'
  | 'hermes-activity'
  | 'hermes-analytics'
  | 'hermes-logs'
  | 'hermes-gateway'
  | 'hermes-manage'
  | 'hermes-updates'
  | 'openclaw'
  | 'claude'
  | 'claudecode'
  | 'kimi3'
  | 'kimi'
  | 'deepseek'
  | 'chatgpt'
  | 'codex'
  | 'cursor'
  | 'antigravity'
  | 'perplexity'
  | 'elevenlabs'
  | 'el'
  | 'gemini'
  | 'upstream-registry'
  // Master Admin & Governance Tabs
  | 'master-admin'
  | 'master-admin-platform'
  | 'master-admin-providers'
  | 'master-admin-hermes'
  | 'master-admin-voice'
  | 'master-admin-models'
  | 'master-admin-mcps'
  | 'master-admin-storage'
  | 'master-admin-database'
  | 'master-admin-security'
  | 'master-admin-tenancy'
  | 'master-admin-flags'
  | 'master-admin-health'
  | 'master-admin-audit'
  | 'master-admin-walkthrough'
  | 'agent-wireframe'
  | 'users-roles'
  | 'policies'
  | 'settings';

export type TerminalCommandStatus = 
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'BLOCKED'
  | 'APPROVAL_REQUIRED';

export type TerminalConnectionStatus = 'CONNECTED' | 'PARTIAL' | 'NOT_CONNECTED';

export interface TerminalExecutionRecord {
  id: string;
  command: string;
  status: TerminalCommandStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cwd: string;
  durationMs: number;
  timestamp: string;
  sessionId: string;
  taskId?: string;
  runId?: string;
  guardianCheck?: {
    status: 'SAFE' | 'APPROVAL_REQUIRED' | 'BLOCKED';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'FATAL';
    warning?: string;
    ruleCitation?: string;
  };
  verificationReceipt?: {
    receiptId: string;
    aegisScore: number;
    signature: string;
    status: string;
    timestamp: string;
  };
}

export interface TerminalSessionInfo {
  id: string;
  name: string;
  cwd: string;
  history: string[];
  associatedTaskId?: string;
  associatedRunId?: string;
  lastActive: string;
  env?: Record<string, string>;
}

export type CanonicalNodeType = 
  | 'AGENT'
  | 'MODEL_ROUTE'
  | 'TOOL'
  | 'MCP'
  | 'GUARDIAN_GATE'
  | 'HUMAN_APPROVAL'
  | 'VERIFIER'
  | 'CONDITION'
  | 'MEMORY_READ'
  | 'MEMORY_WRITE'
  | 'ARTIFACT'
  | 'SUBGRAPH';

export type JarvisCanonicalState =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'RESPONDING'
  | 'APPROVAL_REQUIRED'
  | 'BLOCKED';

export interface WireframeEvent {
  id: string;
  source: string;
  target: string;
  type: 'delegation' | 'tool_call' | 'model_route' | 'memory_read' | 'memory_write' | 'guardian_decision' | 'aegis_verification';
  label: string;
  detail?: string;
  timestamp: string;
  payload?: any;
  status: 'active' | 'success' | 'blocked' | 'approval_required';
}

export interface RunStage {
  id: string;
  name: string;
  status: 'WAITING' | 'RUNNING' | 'PASS' | 'FAILED' | 'SKIPPED' | 'SIMULATED' | 'NOT_IMPLEMENTED' | 'DEGRADED';
  detail?: string;
  timestamp?: string;
}

export interface SynthOSRun {
  id: string;
  objective: string;
  workspace: string;
  startTime: string;
  endTime?: string;
  status: 'COMPLETE' | 'RUNNING' | 'FAILED' | 'BLOCKED' | 'WAITING' | 'SIMULATED';
  selectedAgents: string[];
  selectedModels: string[];
  skillsTools: string[];
  graphId?: string;
  graphName?: string;
  stages: RunStage[];
  costTokens: { costUSD: number; promptTokens: number; completionTokens: number };
  artifacts: Array<{ id: string; name: string; type: string; url?: string; content?: string }>;
  guardianResult: { status: 'PASS' | 'WARN' | 'BLOCK' | 'SIMULATED' | 'NOT_AVAILABLE'; policy: string; checks: string[] };
  aegisResult: { status: 'PASS' | 'WARN' | 'FAIL' | 'SIMULATED' | 'NOT_AVAILABLE'; hash: string; auditTrace: string };
  receipt: { receiptId: string; signature: string; timestamp: string };
  activityHistory: Array<{ timestamp: string; event: string; actor: string; level: 'info' | 'warn' | 'success' | 'error' }>;
}

export type AgentRole = 
  | 'orchestrator' 
  | 'hermes'
  | 'scout' 
  | 'scribe' 
  | 'reach' 
  | 'dev' 
  | 'analytics' 
  | 'openclaw'
  | 'claude'
  | 'claudecode'
  | 'kimi3'
  | 'deepseek'
  | 'chatgpt'
  | 'codex'
  | 'cursor'
  | 'antigravity'
  | 'perplexity'
  | 'elevenlabs'
  | 'gemini'
  | 'chief-of-staff' 
  | 'writer' 
  | 'coder' 
  | 'researcher';

export interface VoiceConfig {
  provider?: 'web_speech' | 'fish_audio' | 'openai_realtime' | 'elevenlabs';
  voiceId?: string;
  speed?: number;
  pitch?: number;
  latencyMode?: 'low' | 'balanced';
  format?: 'mp3' | 'opus' | 'wav';
}

export interface AgentInfo {
  id: string;
  tabKey: ActiveTab;
  name: string;
  role: AgentRole;
  title: string;
  description: string;
  avatarColor: string;
  iconName: string;
  assignedModel: string;
  secondaryModel: string;
  status: 'active' | 'busy' | 'idle' | 'standby';
  systemPrompt: string;
  capabilities: string[];
  activeTasksCount: number;
  completedTasksCount: number;
  lastActive: string;
  // Mission Control & Telegram details from Guide
  telegramThreadId?: number;
  telegramChannelName?: string;
  workspacePath?: string;
  memoryFileSize?: string;
  isolatedWorkspace?: boolean;
  officeCoordinates?: { x: number; y: number; z: number };
  rules?: string[];
  temperature?: number;
}

export interface AIModelInfo {
  id: string;
  name: string;
  provider: string;
  version: string;
  status: 'active' | 'idle' | 'running' | 'error' | 'requires_key' | 'unconfigured' | 'partial';
  latency: number;
  tokensPerSec: number;
  contextWindow: string;
  specialty: string;
  description: string;
  color: string;
  iconName: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  openRouterSlug?: string;
  toolGrants?: string[];
  fallbackWaterfall?: string[];
  modelCategory?: 'core_agent' | 'frontier' | 'open_weights' | 'specialized';
}

export interface KanbanSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export type KanbanColumnId = 
  | 'triage'
  | 'todo'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'review'
  | 'done';

export interface KanbanTask {
  id: string;
  task_id?: string;
  title: string;
  description: string;
  column: KanbanColumnId;
  assignedAgent: AgentRole;
  supervisingAgent?: string;
  assignedModel: string;
  model_tier?: 'FRONTIER_REASONING' | 'FAST_CODE' | 'LONG_CONTEXT' | 'FAST_STANDARD' | 'LOW_LATENCY';
  priority: 'low' | 'medium' | 'high' | 'critical' | 'P1_HIGH' | 'P2_MED' | 'P3_LOW';
  origin?: 'VOICE_MEMO_JARVIS' | 'VOICE_MEMO_APOLLO' | 'DIRECTIVE' | 'EMAIL_WEBHOOK' | 'TELEGRAM' | 'MANUAL';
  tags: string[];
  obsidianWikilinks: string[];
  dependencies?: string[];
  skills_required?: string[];
  context_references?: string[];
  subtasks: KanbanSubtask[];
  createdAt: string;
  updatedAt: string;
  estimatedHours?: string;
  outputLog?: string;
  category?: 'startup-curation' | 'infrastructure' | 'research' | 'code' | 'marketing' | 'growth' | string;
  stage?: string;

  // Parent/Child Hierarchy & Triage Operating Model
  parentTaskId?: string;
  isParent?: boolean;
  isParentTask?: boolean;
  childTaskIds?: string[];
  source?: string;
  claimedBy?: string; // e.g. "Research Agent (Scout)"
  claimedAt?: string; // Timestamp when agent claimed the card
  latestAction?: string; // Latest log/action string
  orchestratorDecision?: string; // e.g. "Model 503 Failover -> Selected Gemini 2.5"
  modelSelectionReason?: string;
  inputs?: string;
  outputs?: string;
  toolCalls?: string[];
  executionLogs?: string[];
  errors?: string[];
  artifact?: {
    id: string;
    title: string;
    folder?: string;
    wikilinks?: string[];
    content: string;
    videoCount?: number;
    sources?: string[];
    createdAt?: string;
  };
  verificationReceipt?: {
    id?: string;
    receiptId?: string;
    guardianPassed?: boolean;
    aegisScore?: number;
    score?: number;
    signature: string;
    timestamp?: string;
    verifiedAt?: string;
  };

  executionMetrics?: {
    latencyMs?: number;
    tokensConsumed?: number;
    costEstimate?: string;
  };
}

export interface IntakeItem {
  id: string;
  rawInput: string;
  origin: 'VOICE_MEMO_JARVIS' | 'DIRECTIVE' | 'EMAIL_WEBHOOK' | 'TELEGRAM' | 'MANUAL';
  timestamp: string;
  status: 'pending_triage' | 'optimizing' | 'optimized' | 'approved' | 'dispatched' | 'rejected';
  complexityScore: number; // 1-10
  cognitiveLoad: 'Light' | 'Moderate' | 'Heavy' | 'Extreme';
  recommendedAgent: AgentRole;
  recommendedModelTier: 'FRONTIER_REASONING' | 'FAST_CODE' | 'LONG_CONTEXT' | 'FAST_STANDARD' | 'LOW_LATENCY';
  recommendedModel: string;
  suggestedSkills: string[];
  contextEnrichment: string[];
  deliverableSpec: {
    objective: string;
    constraints: string[];
    expectedOutputFormat: string;
    evaluationCriteria: string;
  };
  dependencies: string[];
  optimizedTaskDraft?: Partial<KanbanTask>;
  audioWaveformData?: number[];
}

export interface IdeaItem {
  id: string;
  title: string;
  summary: string;
  domain: 'Growth' | 'Infrastructure' | 'Product' | 'AI Core' | 'Monetization' | 'Research';
  status: 'raw' | 'exploring' | 'synthesized' | 'converted_to_task' | 'archived';
  potentialImpact: 'High' | 'Medium' | 'Moonshot';
  effortEstimate: 'Small (1-2d)' | 'Medium (1w)' | 'Large (2-4w)' | 'Epic (Months)';
  tags: string[];
  notes: string[];
  targetAudience?: string;
  monetizationModel?: string;
  wikilinks: string[];
  authorAgent?: AgentRole;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: 'system' | 'mcp' | 'custom' | 'tool' | 'integration';
  version: string;
  enabled: boolean;
  installed?: boolean;
  permissions: Array<'network' | 'drive_read' | 'drive_write' | 'shell_exec' | 'filesystem' | 'audio_stream'>;
  executionMode: 'autonomous' | 'confirm_first';
  parametersSchema: Record<string, any>;
  markdownSpec: string;
  sourceFile?: string;
  author: string;
  callCount: number;
  successRate: number;
  lastExecuted?: string;
}

export interface GuideStep {
  id: string;
  partNumber: number;
  partTitle: string;
  stepNumber: string;
  title: string;
  description: string;
  category: 'foundation' | 'specialists' | 'logging' | 'telegram' | 'server' | 'dashboard' | 'remote' | 'troubleshooting' | string;
  completed: boolean;
  codeSnippet?: string;
}

export interface SystemAuditCheck {
  id: string;
  component: string;
  category: 'api_routing' | 'audio_pipeline' | 'control_integrity' | 'memory_vault' | 'model_latency';
  status: 'passed' | 'warning' | 'failed' | 'testing';
  latencyMs: number;
  message: string;
  lastTested: string;
  traceLog?: string;
}

export interface TelegramMessage {
  id: string;
  agentRole: AgentRole;
  senderName: string;
  senderType: 'user' | 'agent' | 'system';
  threadId: number;
  text: string;
  timestamp: string;
  modelUsed?: string;
  tokensUsed?: number;
}

export interface CronScheduleJob {
  id: string;
  name: string;
  expression: string;
  agentRole: AgentRole;
  model: string;
  targetOutput: string;
  status: 'running' | 'active' | 'paused' | 'disabled';
  lastRun: string;
  nextRun: string;
  runCount: number;
  description: string;
  category: 'scraping' | 'synthesis' | 'dev' | 'outreach';
}

export interface ModelRouterRule {
  id: string;
  name: string;
  condition: string;
  targetModel: string;
  fallbackModel: string;
  enabled: boolean;
  priority: number;
}

export interface ObsidianNote {
  id: string;
  title: string;
  path: string;
  folder: string;
  content: string;
  tags: string[];
  wikilinks: string[];
  updatedAt: string;
  createdAt: string;
  linkedModel?: string;
  linkedAgent?: string;
  // Workspace memory provenance
  workspace?: string;
  objective?: string;
  task?: string;
  agent?: string;
  model?: string;
  tools?: string[];
  sources?: string[];
  artifact?: string;
  decision?: string;
  verification?: string;
  lesson?: string;
  error?: string;
  timestamp?: string;
  provenance?: string;
}

export interface ObsidianVault {
  id: string;
  name: string;
  path: string;
  notesCount: number;
  lastSynced: string;
  status: 'synced' | 'syncing' | 'offline';
  size: string;
}

export interface BotTask {
  id: string;
  name: string;
  cron: string;
  model: string;
  targetVaultNote: string;
  status: 'running' | 'scheduled' | 'completed' | 'paused';
  lastRun: string;
  nextRun: string;
  actionsCount: number;
  description: string;
}

export interface JarvisSettings {
  personality: 'authentic-technical' | 'tactical' | 'minimalist' | 'academic' | 'executive';
  systemPromptPreset?: string;
  voiceEnabled: boolean;
  voiceProvider: 'fish_audio' | 'browser' | 'elevenlabs' | 'openai';
  voiceName: string;
  voicePitch: number;
  voiceRate: number;
  wakeWord: string;
  autoSyncObsidian: boolean;
  hudOverlay: boolean;
  modelArbitrationMode: 'smart-auto' | 'fastest' | 'cheapest' | 'deep-reasoning';
  // Explicit Fish Audio Credentials & Default Voice IDs
  FISH_AUDIO_API_KEY?: string;
  FISH_AUDIO_DEFAULT_VOICE_ID?: string;
  // Fish Audio Configuration
  fishAudioConfig?: {
    apiKey?: string;
    voiceId: string;
    latencyMode: 'low' | 'balanced';
    format: 'mp3' | 'opus' | 'wav';
  };
  // ElevenLabs Configuration
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  // Security & Permissions Hierarchy
  security?: {
    agent_permissions: {
      auto_execute_tools: boolean;
      allowed_tools: string[];
      execution_mode: 'autonomous' | 'confirm_first';
    };
    vault_permissions: {
      read_access: boolean;
      write_access: boolean;
      allow_file_deletion: boolean;
      restricted_directories: string[];
      allowed_paths: string[];
    };
  };
  toolPermissions: {
    canWriteObsidian: boolean;
    canRunTerminal: boolean;
    canBrowseWeb: boolean;
    canTriggerBots: boolean;
  };
  customApiKeys: {
    gemini: string;
    openai: string;
    anthropic: string;
    deepseek: string;
    perplexity: string;
    openrouter: string;
    kimi: string;
    fish_audio?: string;
    elevenlabs: string;
    cursor: string;
  };
  securityPolicies?: {
    sandboxExecution: boolean;
    readOnlyFs: boolean;
    humanApproval: boolean;
    promptInjectionDefense: boolean;
    maxTokenCap: number;
  };
  telegramConfig?: {
    botToken: string;
    webhookUrl: string;
    masterChatId: string;
  };
  obsidianConfig?: {
    daemonSocket: string;
    vaultRoot: string;
    syncInterval: string;
  };
  tailscaleConfig?: {
    nodeHostname: string;
    authKey: string;
    tunnelActive: boolean;
  };
}

export interface SystemLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'success' | 'agent' | 'error';
  source: string;
  message: string;
  meta?: any;
}

// 1. iMessage & WhatsApp Unified Bridge Types
export interface MessageBridgeConfig {
  imessageEnabled: boolean;
  whatsappEnabled: boolean;
  imessageBridgeUrl: string;
  imessageBridgePassword: string;
  imessageWebhookSecret: string;
  whatsappMode: 'meta-cloud-api' | 'headless-baileys-qr';
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  whatsappApiToken: string;
  whatsappVerifyToken: string;
  whatsappPersonalNumber: string;
  whatsappQrCodeStatus: 'unpaired' | 'scanning' | 'connected' | 'expired';
  botOptInRequired: boolean;
  rateLimitPerMinute: number;
  cooldownSeconds: number;
  autoRoutingAgentRole: AgentRole;
}

export interface BridgeMessage {
  id: string;
  channel: 'imessage' | 'whatsapp';
  senderId: string;
  senderName?: string;
  recipientId: string;
  direction: 'inbound' | 'outbound';
  messageText: string;
  mediaUrl?: string;
  timestamp: string;
  status: 'delivered' | 'processing' | 'replied' | 'failed';
  assignedAgent?: AgentRole;
  modelUsed?: string;
  tokensCount?: number;
}

// 2. Scraped Lead & Local Directory Types
export interface ScrapedNurseryLead {
  id: string;
  name: string;
  website: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  instagramHandle?: string;
  email?: string;
  rating?: number;
  reviewsCount?: number;
  specialty?: string;
  syncedToObsidian?: boolean;
  syncedToKanban?: boolean;
}

// 3. Claude-Style Artifacts & Agent Modals
export interface ClaudeArtifact {
  id: string;
  title: string;
  type: 'code' | 'react-component' | 'markdown' | '3d-card' | 'json-schema' | 'interactive-preview';
  language?: string;
  content: string;
  agentRole: AgentRole;
  modelName: string;
  timestamp: string;
  version: number;
  tags: string[];
}

export interface AgentModalEvent {
  name: 'open_agent_modal';
  modalType: 'artifact_preview' | 'hydration_sheet' | 'ebook_editor' | 'claim_directory_modal';
  title: string;
  payload: Record<string, any>;
}

// 4. Hermes Ecosystem Repositories
export interface EcosystemRepo {
  id: string;
  name: string;
  repoUrl: string;
  category: 'ai-orchestration' | 'mobile-runtime' | 'messaging-bridges' | 'scraping-automation' | 'modal-copilots';
  focus: string;
  useCase: string;
  keyFeatures: string[];
  starsCount: string;
  status: 'recommended' | 'integrated' | 'active';
}

export * from './synthos';

