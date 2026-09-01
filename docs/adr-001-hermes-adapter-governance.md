# ADR-001: Hermes Adapter, Network Boundaries, and Governance Tiering

**Status:** ACCEPTED — 2026-09-01, John Hrzic. Only John changes this field.
**Location:** `~/synthos/synthos-admin/docs/adr-001-hermes-adapter-governance.md`

This is the settled architecture. Do not reopen Options A/B/C. Amend this document only when a test disproves one of its assumptions.

---

## Context

SynthOS is a multi-runtime agentic control plane. It coordinates Hermes, Claude, Gemini, Codex, Cursor, Antigravity, OpenClaw, and future runtimes under one governance and knowledge layer. Hermes is a first-class runtime inside SynthOS, not its kernel.

Previous iterations suffered from simulated UI state (hardcoded gateway status, fake PIDs, synthetic efficiency metrics, generated receipt strings), untracked network boundaries, and governance that could not see inside autonomous runtimes. This ADR fixes the boundaries so that does not recur.

---

## Decisions

### 1. Canonical repository

All SynthOS development occurs in:

- GitHub: `jhrzic/synthos-admin`
- Local: `~/synthos/synthos-admin`

`~/synthos/mission-control` is legacy donor/reference code only. It is not the canonical application and is not modified. AI Studio scratchpads and any other unversioned environment are transient and never product canonical.

### 2. Control-plane separation

SynthOS owns: tenancy and workspace authority, the global Model Router, Guardian policy, Aegis verification, receipts, `run_events` telemetry, graph orchestration, and the global knowledge projection.

Hermes owns: its internal process, agent loops, sessions, skills, tools, MCP handling, local memory, file workspace, and native tool execution. SynthOS reads these through an adapter. It does not rebuild them.

The Model Router is independent of Hermes. SynthOS routes tasks to Gemini, Claude, Codex, Hermes, or local models on its own judgment. Hermes is never a required hop for a non-Hermes task.

### 3. Deployment topology and transport

The control plane runs independently from runtime workers. Current deployment is Vercel (app) and Supabase (Postgres with RLS). Hermes runs on a remote VPS. The adapter is a network boundary, not an in-process class. No direct filesystem reads across it.

- Transport: HTTPS with a shared bearer token and a strict request timeout.
- Not now: gRPC, mTLS, circuit breakers. Add only if VPS dropouts become a measured problem.
- Secrets: bearer token lives in Vercel environment variables and the VPS environment. Never in the repo.
- Prefer official Hermes interfaces. A sidecar fills only missing observability endpoints. The sidecar must never grow into a SynthOS reimplementation of Hermes.

### 4. Minimal core adapter contract

Every runtime adapter implements exactly four mandatory primitives:

- `health()` — live process and connectivity status, plus runtime identity: runtime type, runtime version, adapter version, instance ID, capabilities schema version
- `capabilities()` — dynamic declaration of what this runtime actually supports
- `execute()` — task dispatch. The request carries a task context package (relevant SynthOS knowledge for this run). This is how SynthOS gives Hermes context; memory is never written back.
- `events()` — standardized telemetry stream emitted as `run_events`

Everything else (`sessions()`, `tools()`, `memory()`, `terminal()`, `botMode()`) is an optional facet, present only when `capabilities()` says so. A Gemini adapter will not have `sessions()`. That is correct, not a gap.

### 5. `run_events` envelope

`run_events` is the unifying contract. UI, graph engine, receipts, and Aegis consume the event stream and do not care which runtime produced it.

Extend the existing `run_events` table in `synthos_schema_v2.sql`. Do not create a new table. Existing `phase` values (`started | shipped | flagged | held | gate_cleared | escalated`) stay. Add:

- `runtime` — which adapter emitted it
- `runtime_instance_id` — from `health()`
- `observation_tier` — see Decision 7
- `sequence` — deterministic ordering within a run
- `parent_event_id`, `correlation_id` — if not already present

Every adapter emits this envelope. No adapter-specific event shapes reach the UI.

### 6. Governance, MCP proxy, and Bot Mode

Guardian sits at the dispatcher boundary and cannot see tool calls Hermes makes inside its own process. Hermes Bot Mode reaches outside the workspace by design. This is the one place `assert_gated()` is currently blind.

Hermes documentation reportedly supports remote HTTP MCP servers via `mcp_servers` with `url` and `headers`. Treat this as likely but unverified until a real call succeeds. Standardize the SynthOS MCP proxy on Streamable HTTP; use SSE only if testing proves it necessary.

- If the proxy path works: Hermes is configured to reach all MCPs through the SynthOS MCP proxy. Every MCP tool call crosses a boundary Guardian controls.
- If it does not: Hermes Bot Mode is designated a **Trusted / Ungoverned Local Zone**, labeled as such in the UI, and the activity ledger never implies Guardian intercepted its inner tool actions.

Even with the proxy working, Hermes retains native non-MCP capabilities outside Guardian's view. Do not claim full Hermes governance. Receipt tiers remain mandatory.

Validating the proxy path is a Phase 2 deliverable. It does not block Phase 2's other tracks.

### 7. Receipt attribution and legacy data hygiene

Every receipt carries an `observation_tier`:

- `executed` — SynthOS ran and verified the action directly
- `boundary` — SynthOS dispatched and received payloads across an adapter edge; inner steps were run by the target runtime
- `self_reported` — the runtime claimed success via its own logs, unverified by SynthOS

A valid signature proves the payload was not altered. It does not prove the claims inside it are true. The tier states what SynthOS actually witnessed.

Legacy receipts with fabricated or unverified hashes are identified and exported for forensic history, then backfilled as `self_reported` and excluded from trusted views. They are not purged. No untagged receipts remain.

### 8. Memory projection

Memory integration is one-way and read-only. The adapter's `memory` facet reads Hermes memory files/state. SynthOS's global knowledge layer ingests a projection from that facet. This is separate from `run_events`; memory changes are not run events.

SynthOS never writes into Hermes memory. Context flows to Hermes only through the `execute()` task context package. Bidirectional sync is prohibited.

### 9. DAG engine: security fix, then isolation

The existing graph engine has an un-sandboxed `eval()` path, broken resume logic, and no cycle detection.

- Immediately: remove or disable the `eval()` path. This is a security fix, not feature work, and is not deferred.
- Then: wrap the engine behind a strict runtime contract so it can be swapped for Windmill without a rewrite.
- Do not add features to the DAG engine.

---

## Execution sequence

### Phase 1 — Health foundation (4 hours)

Ownership: Gemini writes the adapter and sidecar code in `synthos-admin`. John or Claude Code on the VPS deploys the sidecar and sets the bearer token. Gemini cannot complete Phase 1 alone.

1. Deploy the VPS liveness endpoint (gateway state file + process alive check + runtime identity). Use the Hermes gateway API if one exists; sidecar otherwise.
2. Implement `HermesAdapter.health()` calling that endpoint.
3. Implement `HermesAdapter.capabilities()` returning only what is actually wired.
4. Delete every hardcoded Hermes metric in the UI: mock PIDs, synthetic efficiency percentages, fake version strings, fake replication status, simulated update events.

**Acceptance tests — run by John, not self-reported:**

- Runtime failure: kill the Hermes process on the VPS → UI shows DOWN within 30 seconds → restart → UI shows UP.
- Auth failure: revoke or corrupt the bearer token → UI shows NOT_CONNECTED / AUTH_ERROR → never UP.

Both must pass. If either fails, no subsequent phase is approved.

### Phase 2 — Hermes runtime integration (1 day)

Four tracks, run in parallel:

- **A. Sessions and events** — wire `sessions()` and `events()` from the Hermes state database, read-only, emitting the Decision 5 envelope.
- **B. Overview** — one honest Hermes Overview page backed entirely by adapter data.
- **C. Bot Mode discovery** — read-only `botMode` facet: available, current bots, status, native schedules, native task definitions, native logs. No mutation.
- **D. MCP transport validation** — configure Hermes to call one MCP through a SynthOS proxy endpoint over Streamable HTTP. Deliverable: working call with evidence, or a written failure with the exact error.

### Phase 3 — Controlled execution (deferred)

SynthOS task → Guardian → `HermesAdapter.execute()` → Hermes → `run_events` → Aegis → receipt with `observation_tier = boundary`. Acceptance: one harmless bounded task completes end-to-end with every step captured. Not started until Phase 2 passes.

### Explicitly deferred

- Guardian interception of non-MCP Hermes tool calls
- Bidirectional memory sync (prohibited, not deferred)
- Windmill migration
- Adapters for Antigravity and OpenClaw
- Top-navigation depth expansion across workspaces
- Bot Mode as an internal development workforce (after Phase 3)
- Anything not listed in Phase 1 or Phase 2

---

## Rules for implementation

- Work only in `~/synthos/synthos-admin`. Do not touch `mission-control`.
- Do not mark any tab, status, or metric LIVE because a component exists. LIVE means backed by adapter data.
- Do not report PASS on acceptance tests. Report what was built and what data source backs it; John runs the tests.
- Do not redesign existing screens. Replace fake data sources with adapter calls only.
- If a step cannot be completed without VPS access, say so and stop. Do not simulate.

For every item touched, return:

```
ITEM:
ROUTE / COMPONENT:
DATA SOURCE:
STATUS: LIVE | PARTIAL | NOT CONNECTED | MISSING
FILES CHANGED:
BLOCKERS:
```

---

## Consequences

- Fake telemetry is removed at the source, not hidden.
- Runtime failures are bounded to their adapter.
- Receipts state honestly what SynthOS observed.
- Hermes is fully usable inside SynthOS without becoming SynthOS.
- Windmill can replace the DAG engine later without a rewrite.
- Development happens in one repository.
