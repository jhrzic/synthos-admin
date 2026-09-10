# Agentic OS Parity Matrix

Layer 1 recovery. Each row is **one capability**, regardless of how many videos, screenshots or
repos demonstrate it — deduplicated per the recovery brief.

**Evidence key:** `AOS` = `~/agentic-os` v0.3.0 (installed on this Mac, read from disk) ·
`BASE` = SynthOS baseline commit `f6a2083` · `OPMAP` = `docs/OPERATIONALIZATION-MAP.md` ·
`HERMES` = hermes-agent v0.20.5 source at `~/.hermes/hermes-agent`.

**Status key:** `IMPLEMENTED_AND_SURFACED` · `IMPLEMENTED_BUT_HIDDEN` · `PARTIALLY_IMPLEMENTED` ·
`UPSTREAM_NOT_INTEGRATED` (real in Hermes, SynthOS doesn't call it) · `UI_MISSING` ·
`BACKEND_MISSING` · `REMOVED/REGRESSED` · `NOT_IMPLEMENTED`.

| # | Capability | Evidence | Expected behaviour | Current SynthOS status | Hermes / 3rd-party support | Actual gap | Required action |
|---|---|---|---|---|---|---|---|
| 1 | **Chat with agent** | AOS `chat`, BASE, OPMAP | Real conversation, logged | `IMPLEMENTED_AND_SURFACED` | Hermes `/api/chat`, `ws` | none | — |
| 2 | **Agent roster + health** | AOS `agent-health`, BASE | Live per-agent availability | `PARTIALLY_IMPLEMENTED` — roster real, health partly derived | Hermes profiles + `/api/health` | health not from Hermes | Adapter |
| 3 | **Smart routing** | AOS `smart-router`, OPMAP | Route task → best agent, w/ confidence | `PARTIALLY_IMPLEMENTED` | Hermes model routing + MoA | SynthOS router is its own | Govern, don't rebuild |
| 4 | **Multi-model deliberation (Advisor/Boardroom)** | AOS 3-agent engine; `~/.hermes/config.yaml` **MoA enabled** | Several models deliberate, one aggregates | `UPSTREAM_NOT_INTEGRATED` — `ModelStackingView` has **0 fetch calls** | **Hermes MoA already configured** (4 refs + Opus aggregator) | UI simulates what the runtime really does | **Surface MoA. Delete the simulation.** |
| 5 | **Tasks / Kanban** | AOS `kanban`, BASE | Board, drag, block/unblock, detail | `IMPLEMENTED_AND_SURFACED` (SynthOS-native) | Hermes ships **14 `kanban_*` tools** | two boards | Decide one owner |
| 6 | **Skills registry + run** | AOS `skills` (16), BASE | Browse, view, execute, score | `PARTIALLY_IMPLEMENTED` — SynthOS `skills` table has **0 rows** | Hermes: 21 packs installed, **90,605-skill hub**, 3 tools, hub API | SynthOS ignores the real registry | **Adapter + UI** |
| 7 | **Scheduler / cron** | AOS `scheduler` (4 jobs), OPMAP `DEFER_TO_WINDMILL` | Jobs, next/last run, history | `IMPLEMENTED_AND_SURFACED` (new `SchedulerView`, 6 real schedules) | Hermes `cron` module + `/api/cron/*` | **duplicate engines** | Reconcile |
| 8 | **Memory + search** | AOS `memory` + `brain/` FTS5 | Search everything the agent knows | `PARTIALLY_IMPLEMENTED` — FTS5 over 22 receipted artifacts | Hermes `MEMORY.md`/`USER.md` + provider ABC + `/api/memory` | two stores, neither complete | **Adapter** |
| 9 | **Knowledge vault / notes** | AOS `journal`, BASE | Notes, links, graph | `IMPLEMENTED_AND_SURFACED` (Knowledge Mesh restored `3cfcac8`) | — | none | — |
| 10 | **Decision history** | AOS `brain/recent-decisions.md` | What was decided and why | `PARTIALLY_IMPLEMENTED` — activity ledger, not decisions | — | no decision record type | Small build |
| 11 | **Cost analytics** | AOS `cost`, OPMAP | Spend per provider/model/agent | `BACKEND_MISSING` — **no `token_usage` table exists** | Hermes `/api/analytics/usage`, `/api/analytics/models` | SynthOS has no meter | **Adapter first** |
| 12 | **Audit trail** | AOS `audit`, OPMAP | Every action logged | `IMPLEMENTED_AND_SURFACED` — 202 events | — | none | — |
| 13 | **Sessions / replay** | AOS `session-replay` | Browse + replay past sessions | `NOT_IMPLEMENTED` for Hermes; SynthOS has own `jarvis_sessions` | Hermes **66 sessions**, 3 routers, `session_search` | invisible | **UI only** |
| 14 | **Projects / goals** | AOS `goals`, `active-projects.md` | Targets w/ progress | `NOT_IMPLEMENTED` | Hermes `project_*` tools + profiles router | absent both sides | UI + adapter |
| 15 | **Prompt library** | AOS `prompts` (10) | Reusable templates | `NOT_IMPLEMENTED` | — | absent | Small build |
| 16 | **Standards injection** | AOS `standards` | Inject conventions into work | `NOT_IMPLEMENTED` | Hermes SOUL/rulebook | absent | Small build |
| 17 | **Plugin / MCP registry** | AOS `plugins`, `registry/` | Install + manage extensions | `PARTIALLY_IMPLEMENTED` — MCP Registry UI, **0 servers configured** | Hermes MCP router + plugin API | not wired | **Adapter** |
| 18 | **Errors + circuit breaker** | AOS `errors` | Failure feed, breaker state | `NOT_IMPLEMENTED` | Hermes error/egress status | absent | UI + adapter |
| 19 | **Skill learning analytics** | AOS `learning-analytics` | Eval scores over time | `PARTIALLY_IMPLEMENTED` — KIL (15 observations) | Hermes `/api/learning/graph` | different models | Keep KIL |
| 20 | **Backups / DR** | AOS `backups` | Snapshot + restore | `IMPLEMENTED_AND_SURFACED` (validated restore drill) | Hermes `backup.py` | none | — |
| 21 | **Setup wizard** | AOS `setup-wizard`, BASE | Guided first run | `IMPLEMENTED_AND_SURFACED` | — | none | — |
| 22 | **Webhooks → execution** | AOS `/api/webhook` | External trigger runs work | `NOT_IMPLEMENTED` | Hermes `/api/webhooks/*` | absent | Adapter + governance |
| 23 | **Autonomous background work** | AOS heartbeat/consolidation/standup jobs | Agent works unattended | `PARTIALLY_IMPLEMENTED` — scheduler real, **0 cron executions** | Hermes cron + Bot Mode | never actually runs | **Wire + prove** |
| 24 | **Terminal** | BASE, OPMAP | Real shell, guarded | `IMPLEMENTED_AND_SURFACED` | Hermes PTY websocket | duplicate | Keep SynthOS (Guardian) |
| 25 | **Browser / computer-use agent** | HERMES; corpus | Agent drives a browser | `NOT_IMPLEMENTED` | Hermes: **14 browser tools + `computer_use`** | fully invisible | **UI only** |
| 26 | **Tool registry** | AOS skills; HERMES | See/enable what agents can do | `PARTIALLY_IMPLEMENTED` — SynthOS capability registry | Hermes **98 tools / ~35 toolsets** | real registry unexposed | **UI + govern** |
| 27 | **Agent creation / config** | AOS `agents/`, BASE `NewAgentView` | Define a new specialist | `PARTIALLY_IMPLEMENTED` | Hermes profiles (**0 configured**) | no real provisioning | Adapter |
| 28 | **Agent delegation** | HERMES `delegate_task` | Agent hands work to agent | `NOT_IMPLEMENTED` | Hermes `delegate_task` + async delegation | invisible | UI + govern |
| 29 | **Messaging gateways** | AOS Hermes "channels"; OPMAP | Telegram/Discord etc. | `PARTIALLY_IMPLEMENTED` — Telegram view, mock when unset | Hermes gateway module (**0 platforms connected**) | not wired | Adapter |
| 30 | **Voice interaction** | BASE, OPMAP, `gh screens/jarvis.png` | Speak to / hear the OS | `IMPLEMENTED_AND_SURFACED` (`c4e70da`) | Hermes `text_to_speech` | none | — |
| 31 | **Graph / workflow execution** | BASE, OPMAP | Build + run a DAG | `IMPLEMENTED_AND_SURFACED` (2 graphs, 2 runs) | — | SynthOS-owned | — |
| 32 | **Approvals** | OPMAP, BASE | Human gate before risky acts | `IMPLEMENTED_AND_SURFACED` | Hermes `tools/approval.py` | two models | Reconcile |
| 33 | **Artifacts** | OPMAP | Work products, retrievable | `IMPLEMENTED_AND_SURFACED` — 26 artifacts | Hermes files API | none | — |
| 34 | **Verification + receipts** | OPMAP (SynthOS-only) | Prove the work | `IMPLEMENTED_AND_SURFACED` — 15 receipts (`4a82dab`) | **none — SynthOS-only** | none | — |
| 35 | **Autonomous research (GitHub/YouTube/Radar)** | `ea0dda5` GitHub Search; nav "Radar"/"Intelligence" | Find things unattended | `PARTIALLY_IMPLEMENTED` — GitHub discovery real; Radar/Intelligence are **renamed older tabs** (`lead-scraper`, `hermes-oracle`) | Hermes `web_search`, `web_extract`, browser | thin | Scope properly |
| 36 | **Client / workspace environments** | ADR-003, OPMAP | Isolated customer spaces | `IMPLEMENTED_AND_SURFACED` — 2 workspaces | — | SynthOS-owned | — |
| 37 | **Launchpad / product building** | Nav "Launchpad" → `startup-generator` | Build a product with the OS | `PARTIALLY_IMPLEMENTED` | — | thin | Scope properly |
| 38 | **Work dashboards (not status)** | AOS `dashboard`; the whole thesis | Show *work*, not connectivity | `PARTIALLY_IMPLEMENTED` | — | **the core gap** | See gap matrix |

---

## The one-line verdict

Of 38 recovered parity capabilities: **12 delivered · 14 partial · 12 not delivered.**
Of the 26 that are partial or missing, **15 already exist inside Hermes v0.20.5 and are simply not
called** — the gap is overwhelmingly integration, not construction.
