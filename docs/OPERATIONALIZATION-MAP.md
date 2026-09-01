# SynthOS Platform Operationalization Dependency Map

> **Operationalization Standard**: Statuses strictly reflect verified real backend execution and authentic provider connectivity. No capability is marked `VERIFIED` or `LIVE` based merely on UI presentation.

---

## Capability Dependency Matrix

| Capability | Status | Upstream Dependencies | Downstream Dependents | Current Backend | Current UI | Fake / Synthetic Elements | Known Blockers |
|---|---|---|---|---|---|---|---|
| **Startup / Build** | **VERIFIED** | Node.js, Vite, TypeScript | Entire Platform | `server.ts` (Express 4 + Vite middleware on Port 3000) | Single-pane unified shell (`App.tsx`) | None | None |
| **Workspace Context** | **PARTIAL** | Startup / Build | All Workspaces, Task Execution, Activity Ledger | In-memory `activeWorkspaceId` (`ws-synthos-primary`), SQLite ledger logging | `WorkspacesView.tsx`, `SidebarNav.tsx`, `WorkspaceTopNav.tsx` | Hardcoded mock API health status (`ONLINE`) in `DEFAULT_WORKSPACES` | True tenant filesystem isolation unverified |
| **Settings & Credentials** | **PARTIAL** | Startup / Build | Model Execution, Voice Engines, Integrations | `server.ts` `process.env` inspection, localStorage client sync | `SettingsView.tsx`, `VoiceSettingsModal.tsx` | Static fallback keys and mock tunnel statuses | External API keys optional; local env keys only |
| **Provider & Model Registry** | **PARTIAL** | Settings & Credentials | Model Execution, Model Router, Agent Swarm | `POST /api/generate` fallback queue (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.7-flash`), `openRouterService.ts` | `ModelRouterView.tsx`, `ModelDashboardView.tsx`, `ModelStackingView.tsx` | Hardcoded `active` status for unsupported models (Anthropic, DeepSeek, Kimi) without keys | Real provider calls currently verified for Google Gemini only |
| **Model Execution Core** | **VERIFIED** | Provider Registry, Credentials | Task Execution, Hermes Chat, Bot Mode, Jarvis | `POST /api/generate` (`@google/genai` SDK with real token telemetry) | `HermesChatView.tsx`, `ModelDashboardView.tsx` | None (Real provider call verified) | External providers require keys |
| **Task Execution Engine** | **VERIFIED** | Model Execution, SQLite Database | Graph Runtime, Bot Mode, Kanban | `POST /api/execute-agent-task` (SQLite state machine, 6-stage lifecycle) | `KanbanView.tsx`, `OverviewOfficeView.tsx`, `RightActivityPane.tsx` | None | None |
| **Activity Ledger** | **VERIFIED** | Task Execution, SQLite Database | Receipts, Guardian, Jarvis Query | `lib/persistence.ts` `activity_events` table | `ActivityLedgerView.tsx`, `RightActivityPane.tsx` | None | Container replacement durability blocked without cloud DB |
| **Artifact Storage** | **PARTIAL** | Task Execution, File System | Scribe, Obsidian Sync, Aegis | Local container disk (`/vault/Startup-Theses/...`), SQLite metadata | `ClaudeArtifactsView.tsx`, `ObsidianView.tsx` | None | Ephemeral container disk; cloud blob storage not connected |
| **Guardian Sentinel** | **VERIFIED** | Task Execution, Terminal | Terminal, Agent Dispatch | `checkGuardianRules` (`SAFE`, `APPROVAL_REQUIRED`, `BLOCKED`) | `GuardianAegisControlView.tsx`, `HermesTerminalView.tsx` | None | None |
| **Aegis Verification** | **VERIFIED** | Artifacts, Activity Ledger | Receipts | `runDeterministicAegisVerification` (SHA-256 artifact & status history audit) | `GuardianAegisControlView.tsx`, `KanbanView.tsx` | None (Fabricated terminal receipts removed) | None |
| **Ed25519 Receipts** | **VERIFIED** | Aegis, Node Crypto | Task Completion, Receipts View | `signReceiptPayload`, `verifyReceiptSignature` (Ed25519) | `ReceiptsView.tsx` | None | Private key stored on ephemeral container disk |
| **Hermes Chat** | **VERIFIED** | Model Execution, Activity Ledger | User Interface | `POST /api/generate` + `activity_events` logging | `HermesChatView.tsx` | None | None |
| **Hermes Terminal** | **PARTIAL** | Guardian Sentinel, Node `child_process` | Workspace Command Execution | `POST /api/terminal/exec`, `/api/terminal/guardian-check` | `HermesTerminalView.tsx` | Fabricated terminal receipts removed | PTY interactive streaming unverified |
| **Hermes Bot Mode** | **PARTIAL** | Task Execution, Model Execution | Scheduled Jobs, Background Swarm | `POST /api/execute-agent-task` (direct execution) | `BotModeView.tsx` | Simulated background daemon ticker claims | Production cron scheduling deferred to Windmill |
| **Agent Fleet Matrix** | **PARTIAL** | Task Execution, Model Registry | Workspaces, Graph Execution | `server.ts` agent role mapping (`scout`, `dev`, `scribe`, `guardian`, `orchestrator`) | `AgentFleetView.tsx`, `AgentView.tsx`, `AgentDrawer.tsx` | Visual worker count simulation | Autonomous inter-agent socket protocol unverified |
| **Tools & Skills Registry** | **PARTIAL** | Task Execution, Local Filesystem | Agent Execution | `read_package_metadata`, file read tools | `SkillRegistryView.tsx` | Mock MCP server connection badges | External MCP server connectors unverified |
| **Universal Memory / Vault** | **PARTIAL** | File System, SQLite | Obsidian View, Agent Context | Local `/vault` markdown files + `lib/persistence.ts` | `ObsidianView.tsx`, `ObsidianGraphMind.tsx`, `AgentMemoryView.tsx` | Mock Obsidian daemon websocket status (`ws://127.0.0.1:27124`) | Real Obsidian desktop app websocket bridge not running in container |
| **Graph Builder** | **PARTIAL** | Task Execution, Persistence | Graph Runtime | `POST /api/graphs`, `GET /api/graphs` (SQLite persistence) | `GraphBuilderView.tsx` | None | Complex visual node wiring in UI |
| **Graph Runtime (DAG)** | **PARTIAL** | Graph Builder, Task Execution, Aegis | Multi-Agent Pipelines | `POST /api/graphs/execute` (topological execution, receipt validation) | `GraphRunsView.tsx`, `KanbanDependencyDAG.tsx` | None | Parallel branch execution unverified |
| **Jarvis Command Engine** | **PARTIAL** | Model Execution, Activity Ledger | Global Control | `POST /api/jarvis/command` (SQLite ledger query + live model response) | `JarvisView.tsx`, `JarvisOverlayHUD.tsx`, `GlobalVoiceOverlay.tsx` | None | End-to-end multi-agent orchestration dispatch unverified |
| **Jarvis Voice (TTS)** | **PARTIAL** | Settings, Provider Credentials | Jarvis HUD | `POST /api/tts` (Fish Audio API with fail-closed status) | `JarvisView.tsx`, `GlobalVoiceOverlay.tsx` | None | Requires external `FISH_AUDIO_API_KEY` |
| **Apollo Voice Bridge** | **PARTIAL** | Hermes Context, Guardian | Hermes Workspace | `GET /api/apollo/status`, `POST /api/apollo/command` | `ApolloVoiceView.tsx`, `ApolloVoiceVisualizer.tsx` | None | Live audio streaming/barge-in unverified |
| **Scheduling & Cron** | **DEFER_TO_WINDMILL** | Background Workers | Bot Mode, Recurring Audits | In-process timeout triggers | `ScheduleCronView.tsx` | In-memory cron timers reset on container restart | Production scheduler deferred to Windmill |
| **Channel Integrations** | **PARTIAL** | External APIs, Webhooks | Outreach, Notifications | `POST /api/telegram/send` (Telegram bot route) | `TelegramChatView.tsx`, `MessageBridgeView.tsx` | Mock webhook messages when tokens unset | Requires `TELEGRAM_BOT_TOKEN` |
| **Workspace Creation / Admin** | **PARTIAL** | Persistence | Multi-Tenancy | `DEFAULT_WORKSPACES` in memory / client state | `WorkspacesView.tsx`, `MasterAdminView.tsx` | Dynamic tenant filesystem provisioning | Durable tenant isolation requires cloud backend |
| **Architecture & System Audit** | **PARTIAL** | Backend Status API | System Diagnostics | `GET /api/status`, `GET /api/hermes/upstream-status` | `SystemAuditView.tsx`, `UpstreamCapabilityRegistry.tsx` | Hardcoded upstream version and mock system metric gauges | Live telemetry should reflect true container resources |

---

## Dependency Execution Order

```
LAYER 0: PLATFORM FOUNDATION (Target of current checkpoint)
├── Startup / Build (Vite + Express Server on Port 3000)
├── Workspace Context (Tenant state, workspace switching, top navigation)
├── Settings & Credentials (Environment secret access, client preferences)
└── Provider & Model Registry (Truthful provider connectivity, model availability)

LAYER 1: EXECUTION CORE
├── Real Model Execution (@google/genai SDK proxy)
├── Task Execution Engine (6-stage state machine in SQLite)
├── Activity Ledger (Factual event log)
├── Artifacts Metadata & Content Storage
├── Guardian Sentinel (Safety & approval policy)
├── Aegis Verification (Deterministic audit checks)
└── Ed25519 Cryptographic Receipts

LAYER 2: HERMES CORE
├── Hermes Chat
├── Hermes Terminal (Subprocess exec + Guardian gate)
├── Hermes Bot Mode
├── Agent Fleet Mapping
├── Tools & Skills Registry
└── Universal Memory / Obsidian Vault

LAYER 3: ORCHESTRATION
├── Graph Builder (DAG specification)
├── Graph Runtime (Topological execution & receipt gate)
└── Kanban Dependency Mesh

LAYER 4: GLOBAL SERVICES
├── Jarvis Command Engine
├── Jarvis Voice (TTS fail-closed reporting)
├── Apollo Voice Bridge (Hermes audio separation)
└── Channel Bridges (Telegram / Email transport)

LAYER 5: ADMIN & OPERABILITY
├── Multi-Tenant Workspaces
├── System Diagnostics & Live Telemetry
├── Commercial Revenue / Lead Discovery Engine
└── Production Durability & Async Jobs (DEFER TO WINDMILL)
```
