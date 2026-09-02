# ADR-005: Runtime and Provider Boundaries

**Status:** ACCEPTED — 2026-09-02, Platform Completion Pass V.
**Location:** `~/synthos/synthos-admin/docs/adr-005-runtime-provider-boundaries.md`

This document records the runtime architecture added in Pass V: the Skills Execution Engine, real
MCP connectivity, the runtime-observability aggregator, and the Provider Capability Matrix's
explicit Hermes MODEL / Hermes RUNTIME split. It builds on ADR-001 (Hermes adapter governance),
ADR-003 (identity/workspace authority), and ADR-004 (onboarding lifecycle) without reopening any
of them.

---

## Context

Before this pass, "Skills" meant a real, workspace-scoped registry (list/create/enable/disable)
with no execution behind it — `testSkill()` unconditionally returned `NOT_IMPLEMENTED`, honestly.
"MCP" meant nothing more than a skill category string; no connection to an actual MCP server had
ever been attempted. Master Admin's diagnostics conflated several kinds of evidence under
ambiguous labels (`LIVE`, `PARTIAL`) with no way to tell a live probe from a hardcoded value at a
glance. And nothing anywhere distinguished "Hermes" the model alias (served, if at all, through
OpenRouter) from "Hermes" the dedicated runtime service (ADR-001's adapter) — both were just
"Hermes" in conversation and, in one Master Admin table, absent entirely.

This pass closes as much of that as the *real* contracts allow — and, just as importantly,
documents what it deliberately does **not** close, because no real contract exists to build
against.

## Decisions

### 1. Hermes MODEL and Hermes RUNTIME are, and remain, two different things

- **Hermes MODEL** — an LLM identity a caller might name (`"hermes"`, `hermes-3-llama-3.1-405b`).
  `lib/model-router.ts`'s `classifyModelRequest()` explicitly lists `"hermes"` in
  `RECOGNIZED_UNCONFIGURED_PROVIDERS` — recognized by name, `UNSUPPORTED` by mapping, regardless
  of whether `OPENROUTER_API_KEY` happens to be set. It is never silently routed to Gemini.
- **Hermes RUNTIME** — the dedicated adapter service from ADR-001
  (`src/services/hermesAdapter.ts`), reached only via `HERMES_ADAPTER_BASE_URL`. `health()` makes
  a real network call; `execute()`/`events()` are honest stubs (see decision 3).

The Provider Capability Matrix (`MasterAdminView.tsx`, "Providers & Models") previously had no
Hermes row of either kind. It now has two, explicitly labeled, never combined — rule H2's own
requirement, and architecture rules 1/9 from this pass's directive.

### 2. The skill executor has four real, discriminated target types — never a generic executor

A skill's `execution_target_type` (nullable, `NULL` on every pre-existing and newly-created skill
by default) is one of:

| Type | Real target | Executable requires |
|---|---|---|
| `model` | `lib/model-router.ts` + a real Gemini call | `classifyModelRequest` resolves to `GEMINI` **and** `GEMINI_API_KEY` is actually configured |
| `deterministic` | One of a tiny, hardcoded whitelist (`vault.list`, `memory.search`) | The ref matches the whitelist |
| `mcp_tool` | A real Streamable HTTP JSON-RPC call (decision 4) | A live probe succeeds **at call time** — connectivity is never assumed from a past probe |
| `hermes_runtime` | `hermesAdapter.execute()` | Never — no real contract exists (decision 3) |

`classifySkillExecutability()` (`lib/skills.ts`) is the single place this is decided, from real
evidence only. **REGISTERED and ENABLED never imply EXECUTABLE** — a freshly created skill has no
target, and is `NOT_EXECUTABLE` (`reason: NO_TARGET`) until an admin explicitly wires one via the
skill inspector. This was a deliberate schema addition (`execution_target_type`,
`execution_target_ref`, `credential_ciphertext` — all nullable ALTER TABLE columns on the existing
`skills` table), not an assumption that the existing category field
(`system`/`mcp`/`custom`/`tool`/`integration`) already implied an executable target. It didn't —
confirmed by reading the schema before designing anything, not inferred.

The deterministic whitelist is intentionally tiny. Adding an entry is a deliberate code change in
`lib/skills.ts`'s `DETERMINISTIC_ACTIONS` constant, never data-driven — the explicit alternative to
"expose arbitrary server internals as skills," which the directive for this pass ruled out by
name.

### 3. Hermes RUNTIME execute()/events() stay `NOT_IMPLEMENTED` — the real contract does not exist

Re-verified this pass, not assumed from Pass III/IV's prior finding:

- `execute()`: ADR-001 places it in **Phase 3 — Controlled execution (deferred)**, explicitly
  gated: *"Not started until Phase 2 passes."* No concrete HTTP path, request/response schema, or
  streaming behavior is documented anywhere.
- `events()`: ADR-001's own Phase 2 plan (*"wire `sessions()` and `events()` from the Hermes state
  database, read-only"*) directly contradicts ADR-001 Decision 3's rule that *"the adapter is a
  network boundary, not an in-process class — no direct filesystem reads across it."* This is an
  unresolved contradiction in the ADR itself, not merely an absence of detail.

Building either against an invented contract would have meant fabricating the exact thing this
pass's own rules (5, 6, 9, 11) forbid, and would have broken `test/hermes-adapter-phase1-truth.ts`,
which already locks in "no concrete contract exists" as a regression assertion. Workstreams B and
C (Hermes Events/Execute Phase 2) are therefore correctly `NOT_IMPLEMENTED` — a research finding,
not a shortcut.

One consequence: **Apollo's text dispatch is also `NOT_IMPLEMENTED`**, honestly, regardless of
Hermes health. Apollo is Hermes-specific (architecture rule 3) and has no other execution path —
routing it through Jarvis/Gemini instead would have been exactly the disguise rule 5/D2 forbid.

### 4. MCP connectivity: real Streamable HTTP, real SSRF protection, real (bounded) credential storage

ADR-001 §6 already commits this project to **Streamable HTTP** (single JSON-RPC-2.0-over-POST) as
the standard MCP transport. `lib/mcp-client.ts` implements exactly that: `initialize` →
`notifications/initialized` → `tools/list` → `resources/list`, each a real `fetch` call with a
real `AbortController` timeout — no SDK (none is installed, none was added).

**CONFIGURED never means CONNECTED.** `probeMcpServer()` is a live call every time; a skill's
`mcp_tool` executability is "structurally ready" (an endpoint and tool name exist), never
"connected" — connectivity is proven fresh at execution time, not cached from a prior probe.

**SSRF protection is real, not cosmetic**: `isSafeMcpUrl()` resolves the hostname's actual IP via
DNS and blocks loopback/private/link-local/metadata ranges — not a hostname string match, which a
DNS-rebinding-style hostname could defeat. Local development requires the explicit
`MCP_ALLOW_LOCAL_ENDPOINTS=true` escape hatch. Proven live this pass: a probe against
`127.0.0.1` was correctly blocked by default and correctly succeeded once the escape hatch was set
and a real local test server answered a real handshake.

**Credential storage is real but bounded, and says so.** No credential column existed on `skills`
before this pass. `credential_ciphertext` is AES-256-GCM, keyed from
`MCP_CREDENTIAL_ENCRYPTION_KEY` (sha256'd to a stable 32-byte key). No key configured means
credential storage is refused outright (a real 400) — never a silent plaintext fallback.
**SECURITY_LIMITATION, stated rather than hidden**: this is application-managed symmetric
encryption, not a KMS/HSM. The key lives in the same process environment as the app; if the
database file and the environment are compromised together, the credential is recoverable. This is
a real improvement over plaintext-at-rest (the state before this pass), not a claim of
hardware-backed secrecy — and building an actual KMS/vault was explicitly out of scope ("do not
build a giant vault architecture").

### 5. Skill execution deliberately does not join the task/artifact/Aegis/receipt spine

`/api/execute-agent-task` is real and shaped for a specific product concept: an autonomous agent
persona that writes a Vault artifact, gets deterministically verified by Aegis, and receives a
signed receipt. Forcing every skill execution through it — including a read-only `memory.search`
call that answers a question and produces no artifact — would have been a worse architectural fit
than the gap it replaced, not a better one.

Instead, every skill execution (success or failure) writes a real row to a new, small, bounded
`runtime_events` table (`lib/runtime-events.ts` — 5000-row cap, pruned at insert, never a task
scoped table stretched to fit). Nothing is untracked; it simply isn't force-fit into a spine built
for a different shape of action. `SKILLS_RECEIPT_INTEGRATION: NO` in this pass's report reflects
that deliberate choice, not an oversight.

### 6. Runtime status uses one honest vocabulary, with a real evidence source per row

`lib/runtime-status.ts` aggregates real evidence across 9 systems using exactly six states —
`HEALTHY` / `DEGRADED` / `NOT_CONFIGURED` / `NOT_IMPLEMENTED` / `FAILED` / `UNKNOWN` — replacing
the ad hoc `LIVE`/`PARTIAL`/`NOT_CONNECTED` vocabulary scattered across the pre-existing
diagnostics route. Every row also carries a real `evidenceSource` (`live_probe` /
`configuration_only` / `db_state` / `filesystem_check` / `last_successful_operation` /
`not_implemented`) so "a key is set" is never presentationally indistinguishable from "it was
proven to work." `lastCheck` is `null` unless a probe genuinely ran this call — never a fabricated
timestamp for a system that was never checked.

One deliberate efficiency choice: MCP status in the aggregator reports the *last known* probe
outcome from `runtime_events`, not a fresh live re-probe of every configured MCP server on every
dashboard load. Synchronously calling out to an arbitrary number of admin-configured remote
endpoints every time an operator opens the Runtime panel would be slow, could hang, and isn't
necessary — a dedicated per-skill "Probe" button already exists for a real, on-demand check.

Also fixed under this same "evidence, not presence" rule: `/api/master-admin/diagnostics`'s
`guardian` block previously hardcoded `policyCount: 4` / `mode: "ENFORCING"` / `hitlRequired: true`
with no backing query anywhere in the codebase (no `guardian_policies` table, no approval-queue
route). It now derives real `reviewsCount`/`byDecision` from the `quality_reviews` table — the
real, existing evidence of deterministic Aegis verification actually running inside the execution
spine.

## What this does not change

- **KIL scoring** — untouched, as required.
- **TON logic** — untouched except where already noted in prior ADRs.
- **No competing scheduler** — Windmill remains deferred; nothing in this pass adds cron/timer
  dispatch of any kind.
- **Authorization** — every new route reuses the existing `requireAuth`/`requireWorkspaceMember`/
  `requireWorkspaceAdmin`/`requirePlatformAdmin` middleware; skill execution specifically uses the
  stricter `requireWorkspaceAdmin` (not just member) because it can spend real provider budget or
  reach an external MCP server, and no dedicated approval-queue concept exists yet to gate it more
  granularly — a documented interim posture, not a weakening of the existing model.

## Verification

Live-verified against a real running server: anonymous blocked on every new route; a real
deterministic skill (`vault.list`) created with no target (`NOT_EXECUTABLE`), then wired
(`READY`), then executed for real; a real local MCP test server correctly SSRF-blocked by default
and correctly reached with the escape hatch set, including a real `tools/call`; Apollo's status
and command routes confirmed honest (`NOT_CONFIGURED`/`NOT_IMPLEMENTED`, no fabricated
`CONNECTED`); the diagnostics `guardian` block confirmed deriving from real `quality_reviews` data;
a second workspace and second user proving cross-workspace access is a real `403`, membership-gated
routes correctly reject a member on an admin-only route, and disabling a user immediately
`401`s their existing session. A full automated acceptance test
(`test/pass5-acceptance.test.ts`) chains: real user → real workspace membership → real task →
real artifact (disk + sha256) → real Aegis review → real Ed25519 receipt → real Vault entry → real
Memory (FTS5) indexing → a real, registered-but-not-yet-executable skill → wired to a real
deterministic target → executed for real, genuinely finding the real indexed content — and
separately proves Hermes-runtime-backed execution is honestly unavailable, never faked to
complete the chain.
