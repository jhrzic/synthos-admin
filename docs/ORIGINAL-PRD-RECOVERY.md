# SynthOS — Original PRD Recovery

**Purpose.** Reconstruct what SynthOS was *originally scoped to be*, so that recurring capabilities
in the reference corpus stop being mistaken for new roadmap proposals. This is scope **recovery**,
not strategy creation.

## Evidence base actually used

| Source | What it proves | Reliability |
|---|---|---|
| `~/agentic-os` v0.3.0 — a real, installed multi-agent OS on this Mac | The Layer 1 parity target, concretely: 24 dashboard pages, 16 skills, 4 cron jobs, a 9-file `brain/` memory layer | **Primary.** Read from disk, not remembered |
| `f6a2083` "baseline: current SynthOS Admin before verification" | The originally-imported SynthOS screen inventory and intended IA | **Primary.** Git |
| `docs/OPERATIONALIZATION-MAP.md` | A capability-by-capability matrix of intended backend + intended UI + known fake elements | **Primary.** Already written; not re-derived |
| `docs/DEMO-PROFILE.md` | The honest line between demonstrable and aspirational | **Primary** |
| `docs/adr-001…007` | Deliberate architectural commitments | **Primary** |
| `~/.hermes/hermes-agent` v0.20.5 (full source) | What the runtime layer already provides | **Primary** |
| `gh screens/` (5 PNGs: jarvis, knowledge, router, tour, +1) | Fragmentary visual reference | Weak |

### Stated limitation — read this before trusting any conclusion

**The 100+ videos and screenshots are not accessible to this session.** Only five PNGs exist in the
repo. Every requirement recorded below is therefore inferred from *code, docs, git history and the
installed Agentic OS*, never from the video corpus. Where the corpus is the only plausible source of
a requirement, the row is marked `UNKNOWN` rather than guessed. Feeding the corpus in later can only
*add* rows — it should not overturn the ones marked `ORIGINAL_REQUIRED`, because those are evidenced
in code that already exists in this repo.

---

## A. Original product thesis

Recovered from `AGENTS.md`, `OPERATIONALIZATION-MAP.md` and the shape of the `f6a2083` import:

> SynthOS Admin is **the canonical administrative control plane for a multi-agent operating
> system** — it manages independent agent and runtime workspaces, task dispatch, graph
> orchestration, model routing, tools and MCPs, shared memory and Obsidian/Vault integration,
> automation, governance through Guardian and Aegis, receipts, activity, and global Jarvis voice
> control.

Two layers were always intended, in this order:

1. **Layer 1 — Agentic OS parity.** Reproduce the agent-operating-system experience John already ran
   locally: a real work surface, not a status page.
2. **Layer 2 — SynthOS expansion.** Add what no agent OS in the corpus has: Guardian authority,
   Aegis verification, canonical Ed25519 receipts, Execution Fabric, workspace/customer isolation,
   graph orchestration and cross-runtime routing.

**The failure mode this document exists to correct:** Layer 2 was built to a high standard while
Layer 1 was progressively *reduced* — first to truthful status displays (correctly, because the
originals were fabricated), then in some cases removed entirely. The result reads as a governance
spine with a thin work surface on top.

---

## B. Classification scheme

| Class | Meaning |
|---|---|
| `ORIGINAL_REQUIRED` | Evidenced as intended scope in code/docs/baseline that already exist here |
| `ORIGINAL_OPTIONAL` | Present in the baseline but never load-bearing |
| `SYNTHOS_EXTENSION` | Layer 2 — deliberately beyond parity |
| `VISUAL_REFERENCE_ONLY` | A look, not a requirement |
| `DEMO/FAKE_NOT_REQUIRED` | Existed only as fabricated behaviour; must not be recreated |
| `UNKNOWN` | Cannot be evidenced without the video corpus |

---

## C. The recovered requirement set

### Layer 1 — Agentic OS parity (`ORIGINAL_REQUIRED` unless noted)

Every row is evidenced by a corresponding page/skill/job in `~/agentic-os` **and** a corresponding
screen or table in the SynthOS baseline. That double-attestation is why these are requirements
rather than ideas.

1. **Chat with the agent** — `agentic-os/dashboard/pages/chat` · SynthOS `HermesChatView`
2. **Agent roster + health** — `agent-health` · `AgentFleetView`
3. **Smart routing between agents/models** — `smart-router` · `ModelRouterView`
4. **Tasks / Kanban** — `kanban` · `KanbanView`
5. **Skills registry + execution** — `skills` (16 packs) · `SkillRegistryView`
6. **Scheduler / cron with execution history** — `scheduler` (4 jobs) · `ScheduleCronView`
7. **Memory / brain with search** — `memory` + `brain/` (FTS5) · `AgentMemoryView`
8. **Knowledge vault / notes** — `journal` + `brain/*.md` · `ObsidianView`
9. **Decision history** — `brain/recent-decisions.md` · Activity Ledger
10. **Cost analytics** — `cost` · `Usage & Costs`
11. **Audit trail** — `audit` · `ActivityLedgerView`
12. **Session history / replay** — `session-replay` · Hermes sessions
13. **Goals / projects** — `goals`, `brain/active-projects.md` · *(no SynthOS equivalent)*
14. **Prompt library** — `prompts` (10 templates) · *(no SynthOS equivalent)*
15. **Standards / conventions injection** — `standards` · *(no SynthOS equivalent)*
16. **Plugin / marketplace registry** — `plugins`, `registry/` · `MCP Registry`
17. **Errors + circuit breaker** — `errors` · *(no SynthOS equivalent)*
18. **Learning analytics (skill eval scores)** — `learning-analytics` · KIL (partial overlap)
19. **Backups / disaster recovery** — `backups` · MasterAdmin backup (**delivered**)
20. **Setup wizard** — `setup-wizard` · `SetupWizardCard` (**delivered**)
21. **Webhook receiver → skill execution** — `/api/webhook` · *(no SynthOS equivalent)*
22. **Autonomous/background work on a timer** — heartbeat, memory-consolidation, daily-standup jobs

### Multi-model deliberation — the "Advisor / Boardroom" question

**Verdict: `ORIGINAL_REQUIRED`, and it is already configured in the runtime.**

- `~/.hermes/config.yaml` has **MoA (Mixture of Agents) enabled**: four reference models
  (`minimax-m3` via nvidia, `deepseek-v4-pro`, `claude-opus-4.8`, `MiniMax-M3`) with
  `anthropic/claude-opus-4.8` as **aggregator**, `fanout: user_turn`,
  `degraded_reference_policy: loud`.
- SynthOS has `ModelStackingView` — a "multi-model stacked pipeline" — but it contains **zero
  `fetch` calls**; it is `setNotice(...)` theatre.

So multi-model collaborative deliberation is **not a new feature idea**. It is an original
requirement, **already running in Hermes**, and SynthOS currently shows a *simulation* of it.
Classification: `ORIGINAL_REQUIRED — NOT YET DELIVERED (upstream capability not integrated)`.

### Layer 2 — SynthOS expansions (`SYNTHOS_EXTENSION`)

Guardian authority · Aegis deterministic verification · canonical Ed25519 receipts · Execution
Fabric (Steps 1–8) · workspace/tenant isolation + membership · graph build/run with topological
execution · KIL knowledge scoring · capability registry + intent classifier · external execution
control plane (ADR-006) · admin/audit/identity (ADR-003/004) · launch security (ADR-007).

**None of these exist in `~/agentic-os` or in Hermes.** This is the real differentiator and it is
largely delivered.

### `DEMO/FAKE_NOT_REQUIRED` — do not recreate

Enumerated so no future pass mistakes them for lost features: CPU/RAM tiles · context-ingestion
counts · Telegram mesh volume · "Sub-15ms Vector CDC" · inotify/Obsidian daemon websocket ·
vector-synapse counts · per-agent memory sizes · hardcoded `Latency: 42ms` · simulated fleet-standup
results · simulated background daemon ticker · mock MCP connection badges · hardcoded model "active"
badges without credentials.

### `UNKNOWN` — needs the corpus to settle

Julian Goldie / Boardroom modules (**Astros**, **Apollo**, **Oracle**): a full search of upstream
Hermes v0.20.5, of `~/.hermes`, and of all 90,605 indexed hub skills found **no such agents**. The
only "Apollo" hits are Apollo GraphQL and Apollo.io. Whatever these are, they are configuration
*above* Hermes, and their required behaviour cannot be recovered from anything on this machine.

> ⚠️ **Terminology collision to resolve.** SynthOS's own `AGENTS.md` defines "Apollo" as *"a
> Hermes-specific voice/audio bridge"* and ships `ApolloVoiceView` at tab `hermes-apollo`. That is a
> **SynthOS-invented meaning**, unrelated to any Boardroom "Apollo". Same for `hermes-oracle` →
> `HermesOracleView`. These names should not be treated as evidence that a Boardroom module was ever
> implemented here.
