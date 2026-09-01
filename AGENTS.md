# NousResearch Hermes AgentOS Mission Control Architecture

> Unified multi-agent coordination protocol, specialized fleet roles (Orchestrator, Scout, Scribe, Reach, Dev, Analytics), OpenRouter model arbitration, Telegram thread routing, and bi-directional Obsidian Knowledge Graph synchronization.
> References: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) & [Asad Tinkers Hermes AgentOS Mission Control](https://asadtinkers.com/guides/hermes-agentos-mission-control-dashboard/)

---

## 1. Executive Overview

The **Hermes AgentOS Swarm** is an autonomous multi-agent operating system designed to eliminate token waste, parallelize cognitive workloads across dedicated specialists, and maintain persistent, structured knowledge in Obsidian vaults.

Rather than running monolithic prompts through a single LLM, Hermes decomposes complex requests across **6 specialized agents**, routes tokens dynamically across frontier models (via **OpenRouter** and native APIs), manages execution state through a real-time **Kanban State Machine (`board.db`)**, and isolates communications via **Telegram thread routing**.

```
                           ┌────────────────────────┐
                           │   USER / JARVIS HUD    │
                           └───────────┬────────────┘
                                       │
                      ┌────────────────▼────────────────┐
                      │    ORCHESTRATOR (FLEET MASTER)  │
                      └───────┬──────────────┬──────────┘
                              │              │
       ┌──────────────────────┼──────────────┼─────────────────────┐
       │                      │              │                     │
┌──────▼──────┐        ┌──────▼──────┐ ┌─────▼───────┐      ┌──────▼──────┐
│    SCOUT    │        │   SCRIBE    │ │    REACH    │      │     DEV     │
│ (Scraping)  │        │  (Vaults)   │ │  (Growth)   │      │ (Engineers) │
└──────┬──────┘        └──────┬──────┘ └─────┬───────┘      └──────┬──────┘
       │                      │              │                     │
       └──────────────────────┼──────────────┴─────────────────────┘
                              │
                       ┌──────▼──────┐
                       │  ANALYTICS  │
                       │  (Metrics)  │
                       └──────┬──────┘
                              │
                       ┌──────▼──────────────────────┐
                       │     HERMES MODEL ROUTER     │
                       │ (OpenRouter / Gemini / etc.)│
                       └──────────────┬──────────────┘
                                      │
                       ┌──────────────▼──────────────┐
                       │  OBSIDIAN KNOWLEDGE GRAPH   │
                       │    & TELEGRAM THREAD MESH   │
                       └─────────────────────────────┘
```

---

## 2. Specialized Fleet Roles & Telegram Routing

| Agent Role | Telegram Thread ID | Channel Name | Primary Model | Specialty & Responsibilities |
| :--- | :--- | :--- | :--- | :--- |
| **Orchestrator** | `101` | `#orchestrator-bridge` | `Nous Hermes 3` | Fleet Commander, goal decomposition, board.db governor, permanent operating rules, executive sign-off. |
| **Scout** | `102` | `#scout-intel` | `Perplexity Sonar` / `Kimi K1.5` | Live web crawling, Product Hunt & GitHub trend scraping, arXiv preprints, market whitespace detection. |
| **Scribe** | `103` | `#scribe-notes` | `Claude Code 3.7` / `ChatGPT o3` | Obsidian knowledge scribe, investment thesis authoring, documentation specs, [[wikilinks]] mesh mapping. |
| **Reach** | `104` | `#reach-growth` | `ChatGPT o3` / `Gemini 2.5` | Distribution & GTM architect, viral loop modeling, customer acquisition, social sentiment, launch hooks. |
| **Dev** | `105` | `#dev-terminal` | `Claude Code 3.7` / `Codex` | Full-stack systems engineer, sandbox execution, TypeScript/Python, test harnesses, self-healing patches. |
| **Analytics** | `106` | `#analytics-metrics` | `DeepSeek R1` / `Gemini 2.5` | Data synthesizer, token economy optimization, latency tracking, SQL telemetry, Airbyte stream audits. |

---

## 3. Mandatory Interactive UI & Button Validation Rule

> [!IMPORTANT]
> **MANDATORY RULE: Complete Control Validation**
> Every button, label, tab trigger, drawer toggle, modal opener, Telegram message dispatcher, Kanban stage transition, filter chip, and execution trigger created in this system **MUST ALWAYS BE TESTED AND VERIFIED TO BE FULLY FUNCTIONAL**.
> - Never create static mock buttons without click handlers.
> - Never leave broken state listeners or dead links.
> - Every action must provide instant visual feedback, clear state updates, and error resilience.

---

## 4. Multi-Agent Startup Curation Pipeline

The Hermes fleet collaborates on a multi-stage startup ideation and curation workflow:
1. **Stage 1 (Scout)**: Scrapes 200+ trending repositories, Product Hunt launches, and arXiv research papers to harvest developer pain points.
2. **Stage 2 (Analytics)**: Runs TAM calculations, competitor feature matrices, and LLM token inference unit economics.
3. **Stage 3 (Dev)**: Architects technical feasibility POCs, containerized sandboxes, and validates sub-50ms execution latencies.
4. **Stage 4 (Reach)**: Formulates go-to-market viral loops, target early-adopter ICP personas, and short-form demo hooks.
5. **Stage 5 (Scribe)**: Synthesizes findings into comprehensive Obsidian investment memos at `[[Startup-Theses/]]` with 20+ bidirectional `[[wikilinks]]`.
6. **Stage 6 (Orchestrator)**: Conducts final quality audit, verifies permanent rules, approves move to `Done`, and vectorizes into memory.

---

## 5. Mission Control Curriculum (Parts 01 - 08)

The system incorporates all 32 steps and troubleshooting diagnostics from the official guide:
- **Part 01**: Foundation — Orchestrator Identity & Permanent Rules (Steps 1–4)
- **Part 02**: The Specialist Fleet — Scout, Scribe, Reach, Dev (Steps 5–7)
- **Part 03**: Logging & Retention Systems (Steps 8–10)
- **Part 04**: Telegram Routing — One Channel per Agent (Steps 11–15b)
- **Part 05**: Read-Only Data Layer & Server Verification (Steps 15c–16)
- **Part 06**: Mission Control Dashboard — Wire Every Tab Live (`board.db`, Telegram chat, Content Library, Hermes Cron) (Steps 17–28)
- **Part 07**: Remote Access & Isometric 3D Office Active/Idle Glow (Steps 29–30)
- **Part 08**: Troubleshooting Diagnostics (Tailscale, Complexity Routing, T1 Routing Plugin, T2 Kanban Drag-and-Drop) (Steps 31–32, T1, T2)
