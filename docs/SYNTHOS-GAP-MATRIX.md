# SynthOS Gap Matrix

The actionable half of the recovery. Every row is an **original requirement**, not a proposal.
Derived from `ORIGINAL-PRD-RECOVERY.md` and `AGENTIC-OS-PARITY-MATRIX.md`.

## 1. Delivered (close these out — stop re-litigating them)

Knowledge Mesh · Vault/artifacts · Aegis verification · Ed25519 receipts (surfaced `4a82dab`) ·
Guardian · Execution Fabric · graph build/run · workspace isolation + membership · activity/audit
ledger · backup + validated restore · Jarvis voice (`c4e70da`) · terminal (Guardian-gated) ·
approvals · setup wizard · scheduler UI (`ac95205`) · Memory workspace (`9b7d7c8`).

## 2. Partially delivered

| Requirement | What's real | What's missing |
|---|---|---|
| Agent roster + health | roster | health not sourced from the runtime |
| Skills | UI shell | **0 skills registered**; 21 local packs + 90,605-skill hub invisible |
| Memory | FTS5 over 22 receipted artifacts | Hermes' own memory + providers not integrated |
| MCP registry | UI | **0 servers**; Hermes MCP router not called |
| Autonomous background work | 6 real schedules | **0 executions ever** — never proven end to end |
| Agent creation | UI | **0 Hermes profiles**; no real provisioning |
| Messaging gateways | Telegram view | **0 platforms connected** |
| Research / Radar / Intelligence | GitHub Search discovery is real | Radar + Intelligence are **renamed older tabs** (`lead-scraper`, `hermes-oracle`), not built surfaces |
| Learning analytics | KIL, 15 observations | no skill-eval trend view |
| Smart routing | SynthOS router | not reconciled with Hermes routing/MoA |

## 3. Not delivered (all originally required)

Multi-model deliberation surface · Hermes sessions/replay · projects & goals · prompt library ·
standards injection · errors + circuit breaker · webhook triggers · browser/computer-use surface ·
agent delegation surface · decision history · cost analytics · real work dashboards.

## 4. Removed / regressed

| Item | Removed by | Disposition |
|---|---|---|
| Obsidian Knowledge Mesh | `cd60d81` → `fee6fe4` | **Restored** `3cfcac8` |
| Context Governor Telemetry (token/cost governor UX) | `739c663` → `fee6fe4` | Blocked — **no `token_usage` backend exists**. Restore *with* the cost adapter, not before |
| Aegis receipt strip in terminal | `63266b1` | Re-add against canonical receipts |
| Rich Memory IA | `cd60d81` | **Restored** `9b7d7c8` |

## 5. Already provided by Hermes v0.20.5 — **do not build**

`98 tools / ~35 toolsets` · `139 REST endpoints` incl. routers for sessions (list/search/manage),
profiles, cron, MCP, skills + hub, tools, git, memory · 14 browser tools + `computer_use` ·
`delegate_task` · 14 `kanban_*` tools · gateways · `/api/analytics/usage` · `/api/learning/graph` ·
PTY + `ws` websockets · **MoA multi-model deliberation, already configured on this machine**.

## 6. Genuinely new infrastructure required

Only these. Everything else is UI or adapter work.

1. **Cost/token metering** — no `token_usage` table exists. Required before Context Governor,
   before per-workspace budget rails, before margin reporting.
2. **Decision-history record type** — distinct from the activity ledger.
3. **Prompt library + standards store** — small, no upstream equivalent worth adapting.
4. **Governance wrappers** on each newly-surfaced Hermes capability (Guardian gate + receipt).

## 7. UI / adapter only

Sessions · skills + hub · tools registry · browser/computer-use · delegation · projects/goals ·
MCP · gateways · profiles/Bot Mode · analytics · errors · webhooks · **MoA deliberation surface**.

**The enabling fact:** Hermes ships its own FastAPI server (`hermes_cli/web_server.py`, 139
endpoints). `HERMES_ADAPTER_BASE_URL` is unset, `hermesAdapter.execute()` returns
`NOT_IMPLEMENTED`, `events()` is a no-op, and every `/api/hermes/*` route in `server.ts` returns
`NOT_IMPLEMENTED`. **The adapter SynthOS planned to build largely already exists on the other side.**

## 8. Do not recreate

CPU/RAM tiles · context-ingestion counts · Telegram mesh volume · "Sub-15ms Vector CDC" ·
inotify/Obsidian daemon · vector-synapse counts · per-agent memory sizes · hardcoded `Latency: 42ms`
· simulated fleet standup · simulated daemon ticker · mock MCP badges · hardcoded model "active"
badges · **`ModelStackingView`'s fake multi-model pipeline** (0 fetch calls — replace with real MoA,
don't preserve).

## 9. Shortest path to original PRD completion

Ordered by *evidence unlocked per unit of work*. No new architecture in steps 1–4.

| Step | Work | Unlocks |
|---|---|---|
| **0** | Start Hermes' own web server; set `HERMES_ADAPTER_BASE_URL`; replace the four `NOT_IMPLEMENTED` adapter stubs with proxied **reads** | Everything below |
| **1** | Surface **sessions · skills+hub · tools(98) · profiles** read-only | 4 parity rows, zero new backend |
| **2** | Surface **MoA deliberation** as the Advisor/Boardroom; delete the simulation | The most-repeated corpus capability, already running |
| **3** | Surface **browser/computer-use · delegation · kanban tools · gateways · MCP** | 5 more rows |
| **4** | Prove **one real autonomous cron execution** end to end through Guardian → Aegis → receipt | Closes the "0 executions" hole; is also the Layer 2 proof |
| **5** | Build **cost/token metering**; then restore Context Governor over it | Unblocks budget rails + margin |
| **6** | Build **projects/goals · prompt library · standards · decision history · errors** | Remaining parity |

Steps 0–4 are integration. Only 5–6 are construction.

---

## The answer

**ARE WE AT FUNCTIONAL PARITY WITH THE AGENTIC OS BASELINE? — NO.**

12 of 38 recovered parity capabilities are delivered. The missing ones, exactly:

1. Multi-model deliberation surface (Advisor/Boardroom) — **runtime already configured**
2. Hermes sessions + replay — **66 sessions invisible**
3. Skills registry — **21 packs + 90,605-skill hub invisible; SynthOS table empty**
4. Tool registry — **98 tools invisible**
5. Browser / computer-use — **15 tools invisible**
6. Agent delegation
7. Projects / goals
8. Prompt library
9. Standards injection
10. Errors + circuit breaker
11. Webhook triggers
12. Cost analytics — **no backend**
13. Decision history
14. Proven autonomous background execution — **0 cron runs**
15. Real work dashboards rather than status displays

**The governance layer (Layer 2) is ahead of schedule; the parity layer (Layer 1) is behind.** And
the deficit is not construction debt — **15 of these 15 are either already running in Hermes or a
small store away.**
