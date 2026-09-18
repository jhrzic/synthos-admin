// ---------------------------------------------------------------------------
// Every tab id App.tsx renders a screen for. Deep links only resolve to these,
// and test/canonical-navigation.test.ts checks this list against App.tsx in
// both directions, so a tab that renders nothing can never be navigated to.
// ---------------------------------------------------------------------------

/** Tabs rendered by an explicit `activeTab === '<id>'` branch in App.tsx. */
export const DIRECT_RENDERED_TABS = [
  'activity-ledger', 'aeo-audit', 'agent-fleet', 'agent-memory', 'approval-queue', 'auto-content', 'bot-mode',
  'business-assistant', 'claude-artifacts', 'content-library', 'demos', 'dev-kanban-receipts', 'development',
  'ecosystem-repos', 'external-executions', 'graph-builder', 'graph-runs', 'guardian-aegis', 'guide-walkthrough',
  'hermes', 'hermes-activity', 'hermes-agents', 'hermes-analytics', 'hermes-apollo', 'hermes-approvals',
  'hermes-bot-mode', 'hermes-channels', 'hermes-chat', 'hermes-core', 'hermes-cron', 'hermes-files',
  'hermes-gateway', 'hermes-kanban', 'hermes-logs', 'hermes-manage', 'hermes-mcps', 'hermes-memory',
  'hermes-oracle', 'hermes-overview', 'hermes-sessions', 'hermes-skills', 'hermes-terminal', 'hermes-tools',
  'hermes-updates', 'hermes-usage', 'idea-strategy', 'intake-triage', 'jarvis', 'kanban', 'lead-scraper',
  'master-admin', 'master-ops', 'message-bridge', 'model-registry', 'model-router', 'model-stacking', 'obsidian',
  'overview', 'receipts', 'schedule-cron', 'scheduler', 'settings', 'skill-registry', 'startup-generator',
  'studio-leadgen', 'system-audit', 'system-diagnostics', 'telegram-chat', 'ton', 'tool-registry', 'twins',
  'upstream-registry', 'users-roles', 'workspaces',
] as const;

/** Model seat views (App.tsx isModelTab). */
export const MODEL_SEAT_TABS = ['claude', 'claudecode', 'kimi3', 'kimi', 'deepseek', 'chatgpt', 'codex', 'cursor', 'antigravity', 'perplexity', 'elevenlabs', 'el', 'gemini', 'openclaw'] as const;

/**
 * Agent detail views (App.tsx isAgentTab) that have an agent definition.
 * agent-hermes, agent-chief-of-staff, agent-writer, agent-coder,
 * agent-researcher exist in the ActiveTab union but render
 * only an "Agent not configured" placeholder, so nothing navigates to them.
 */
export const AGENT_DETAIL_TABS = [
  'agent-orchestrator', 'agent-scout', 'agent-scribe', 'agent-reach', 'agent-dev', 'agent-analytics', 'agent-openclaw',
  'agent-claude', 'agent-claudecode', 'agent-gemini', 'agent-kimi3', 'agent-deepseek', 'agent-chatgpt', 'agent-codex', 'agent-cursor',
  'agent-antigravity', 'agent-perplexity', 'agent-elevenlabs',
] as const;

/** Master Admin sections (App.tsx startsWith('master-admin')) that exist in MasterAdminView. */
export const MASTER_ADMIN_TABS = [
  'master-admin-platform', 'master-admin-providers', 'master-admin-hermes', 'master-admin-voice', 'master-admin-models',
  'master-admin-mcps', 'master-admin-storage', 'master-admin-database', 'master-admin-security', 'master-admin-health',
  'master-admin-audit', 'master-admin-walkthrough',
] as const;

export const RENDERED_TABS: ReadonlySet<string> = new Set<string>([...DIRECT_RENDERED_TABS, ...MODEL_SEAT_TABS, ...AGENT_DETAIL_TABS, ...MASTER_ADMIN_TABS]);
