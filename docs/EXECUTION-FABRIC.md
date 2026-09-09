# SynthOS Execution Fabric — Canonical Architecture

**Status:** Canonical, as of Step 8 (consolidation pass). Built across Steps 4–8 of a staged
migration recorded in this repo's own commit history (`0ba33f9` → `06088f9` → this pass). This
document is the one a new session should read before touching execution, scheduling, or capability
routing — grounded in current source, not remembered plans. **Repo truth overrides remembered
architecture**: if this doc and the code ever disagree, the code is right and this doc is stale —
fix the doc, don't trust it blind.

## The one governing idea

**The Execution Fabric (`lib/fabric/*.ts`) is the only place real work happens.** Every real
ingress — Jarvis, graph runs, the scheduler, admin/manual execution, skills — routes through it.
None of them are a second execution engine; each decides *what a user/system asked for*, then hands
a structured request to the fabric, which decides *whether and how it actually runs*.

```
ingress (Jarvis / Graph / Scheduler / Admin / Skills)
  -> classification (what capability, what risk)
  -> capability registry (is it real, what class, what approval policy)
  -> Guardian rule (Section 7: EXTERNAL_ACTION without real enforcement is refused, not executed)
  -> canonical execution (ctx.invoke() — the only place a real call is ever recorded)
  -> artifact (Vault writer) + Aegis (on success) + receipt (on VERIFIED) — or an honest failure
  -> activity/memory index
```

## Ingresses are peers, not a hierarchy

- **Jarvis** (`server.ts` `/api/jarvis/command`) — a natural-language ingress. `classifyIntent()`
  (`lib/fabric/intent.ts`) turns text into a capability + parameters; `executeEnvelope()`
  (`lib/fabric/envelope.ts`) does the rest. Jarvis has zero special execution privilege — it cannot
  call a provider, write a Vault artifact, or sign a receipt itself.
- **Graphs** (`server.ts` `/api/graphs/execute`, `lib/graph-execution.ts`) — native COMPUTE nodes
  call `ctx.invoke('model.gemini', ...)` directly through one shared `ExecutionContext` per run;
  Windmill-target nodes go through `lib/external-executions.ts`'s own real ledger. A full graph run
  produces one aggregate task/artifact/Aegis/receipt (`server.ts`'s `graphRunReceipt` path), not one
  per node.
- **Scheduler** (`lib/fabric/scheduler.ts`, Step 7) — decides **only WHEN**. Every due occurrence is
  a plain `executeEnvelope()` call, identical to what Jarvis would build for the same capability. It
  has no direct call to Gemini/GitHub/Vault/Windmill/MCP/Hermes anywhere in its source (verified,
  Step 8 audit) — there is no way to reach a real effect from `scheduler.ts` except through the
  fabric.
- **Admin/manual execution** (`server.ts` `/api/execute-agent-task` → `lib/fabric/kernel.ts`) — the
  original native-task pipeline; `commitEvidencedArtifact`-shaped logic, kept separate from the
  envelope's own equivalent because it predates the envelope and serves a different input shape
  (a fully-specified task, not a classified natural-language request). Both correctly reuse the same
  underlying primitives (Aegis, receipt signing, Vault writer) — this is a documented, deliberate
  near-duplication across genuinely different ingress shapes, not an oversight (Step 8 audit).
- **Skills** (`lib/skill-execution.ts`) — real `ctx.invoke()`-wrapped calls (model or MCP), but **no
  artifact/Aegis/receipt lifecycle by design** — a skill execution is a raw integration test/output,
  not a verified deliverable. This is a real, intentional difference from research/vault.write, not
  a bypass; flagged here so a future session doesn't "fix" it into matching the others without a
  deliberate decision.

## Capability registry is the one source of truth for "can this actually happen"

`lib/fabric/registry.ts`'s `resolveCapability(key)` is the only place that answers: is this real
(`AVAILABLE`/`DEGRADED`), not built (`NOT_CONFIGURED`/`UNSUPPORTED`), gated (`APPROVAL_REQUIRED`)?
What effect class is it (`READ`/`COMPUTE`/`EXTERNAL_ACTION`/`CONTROL`)? What's its real approval
policy? Every status is derived from a real check — a real env var presence, a real DB count, a
real on-demand health call — never a hardcoded literal (verified repo-wide, Step 8 audit; the one
hardcoded-status object found, `apiHealth` in the legacy `synthosControlService.ts`, is documented
as a known issue below, not part of this registry).

`NOT_CONFIGURED` vs `UNSUPPORTED`: `NOT_CONFIGURED` means the capability is real code, missing
config (a key, an adapter URL) — plausibly fixable by the operator without a code change.
`UNSUPPORTED` means the capability has no real implementation at all (e.g. `hermes.execute` — a
stub with no contract, ADR-001 Phase 3, deferred) — no config would ever make it work. This
distinction matters for the scheduler: a schedule against a `NOT_CONFIGURED`/`UNSUPPORTED`
capability is still created `ACTIVE` and re-checked honestly on every real occurrence, since either
could become real later without recreating the schedule.

## Guardian governs eligibility — Section 7's rule

`executeEnvelope()` refuses any `EXTERNAL_ACTION` capability whose `approvalPolicy !==
'GUARDIAN_ENFORCED'`, unless explicitly exempted (`EXTERNAL_ACTION_EXEMPT_FROM_GUARDIAN_RULE`,
exported from `lib/fabric/envelope.ts` — currently `{'vault.write'}` only, and nothing else; this
set is the **one** place that exemption is defined — `lib/fabric/scheduler.ts` imports it rather
than hand-copying the value, Step 8 fix). Advisory risk policy alone is never treated as
permission. The scheduler enforces the identical rule **at schedule-creation time** for a
capability that structurally lacks Guardian enforcement (refuses to even create an `ACTIVE` row) —
scheduling can never be used to route around approval.

## `ctx.invoke()` — the only real-call ledger

`lib/fabric/context.ts`'s `ctx.invoke(name, fn)` is the sole place an `InvocationRecord` is ever
created, and only after actually `await`-ing a real function (verified, Step 8 audit: every
`toolsInvoked:` assignment in production code is `ctx.getInvocations().map(r => r.name)` — zero
manually-constructed arrays found anywhere). A name that appears in `toolsInvoked` is a real call
that happened; nothing fabricates this array.

## Vault writer, Aegis, and receipts

`lib/vault.ts`'s `writeWorkspaceArtifact()` is the one canonical artifact path — no other code
writes into the Vault directory tree directly (verified, Step 8 audit). Aegis
(`runDeterministicAegisVerification`) runs only after a real artifact is written, on every
successful artifact-bearing execution; a receipt is signed (`canonicalizePayload` →
`signReceiptPayload` → `verifyReceiptSignature` → `recordReceipt`) only after that self-verification
step passes — a signature that fails to independently re-verify is never persisted at all (Step 8
audit confirmed this self-check precedes every real `recordReceipt` call). **A failed execution
never fabricates an artifact, Aegis review, or receipt** — this holds across every ingress,
including the scheduler (a `FAILED`/`BLOCKED`/`NOT_CONFIGURED` occurrence records that outcome
honestly in `schedule_occurrences`, with `artifact_id`/`receipt_id` left `null`).

## Idempotency — one mechanism, reused everywhere

`execution_claims` (Step 6) is the only atomic idempotency mechanism in this repo. A real `INSERT`
guarded by `UNIQUE(workspace_id, actor_user_id, capability, idempotency_key)` is attempted **before**
any expensive call — SQLite's own constraint, not application logic, decides who owns execution.
The scheduler (Step 7) reuses this exact mechanism for occurrence identity
(`schedule:{scheduleId}:{dueAt}`) rather than building a second one. No other idempotency system
exists or should be added.

## Current model-routing truth

`lib/model-router.ts::generateWithFailover` (candidate-model failover, currently Gemini-family only:
`DEFAULT_CANDIDATE_MODELS`) and `lib/fabric/model-gemini.ts::generateViaGemini` (the fabric's own
thin wrapper around it, used by `kernel.ts` and `research.ts`) are the two canonical real-call
helpers. **Known, not-yet-consolidated bypasses** (Step 8 audit, not fixed this pass — each needs
caller-liveness confirmation first, per this repo's own no-delete-without-proof rule):
`server.ts`'s `/api/youtube/julian-goldie-audit`, `/api/youtube/ingest`, and
`/api/orchestrator/decompose` routes, plus `lib/skill-execution.ts`'s model-role skill execution,
all construct `GoogleGenAI` directly and call `.generateContent()` without going through either
canonical helper — no failover, no shared retry/error classification. **No other model provider is
actually wired for real completions today** — Anthropic/OpenAI/DeepSeek/OpenRouter are recognized by
name in various type unions but have no real execution path; treat any UI or copy implying
otherwise as stale until specifically re-verified.

## Current Hermes truth

`src/services/hermesAdapter.ts` is the one canonical server-side Hermes adapter: `health()` makes a
real HTTP call when `HERMES_ADAPTER_BASE_URL` is configured; `execute()` is an unconditional stub
regardless of configuration (ADR-001 Phase 3, deferred — this is not a bug to silently "complete").
`lib/fabric/registry.ts`'s `hermesExecuteCapability()` correctly reports `UNSUPPORTED` for this
reason. `lib/runtime-status.ts`'s `hermesRuntimeStatus()` is the one canonical health source.
Two genuinely dead client-side helper files (`src/lib/hermes-db.ts` and
`src/services/hermesDbServer.ts` — zero real callers, one missing its own required dependency) were
removed in Step 8; the two Hermes DB-related routes they were never actually wired to
(`/api/hermes/db-state`, `/api/hermes/logs`) already independently return `NOT_IMPLEMENTED` and were
untouched by that removal.

## Current scheduler truth

See `lib/fabric/scheduler.ts`'s own header comment and Step 7's build for full detail. Summary: one
real in-process poll loop (`startScheduler()`, called once at server startup), persisted
`schedules`/`schedule_occurrences` tables, `ONE_TIME` and fixed-`INTERVAL` recurrence only — weekday/
local-time recurrence ("every Monday") is deliberately unsupported (refused with a clarification,
never silently mis-scheduled) since it needs real DST-aware timezone math this repo has no
dependency for. `next_run_at` is always UTC; no workspace/user timezone data exists anywhere in
this repo (audited). Restart/resume catch-up policy: a missed one-time schedule runs once; a missed
interval schedule skips ahead to the next future instant, never a backlog burst.

## Current research truth

`lib/fabric/research.ts::runLiveRepositoryResearch` — live GitHub Search REST API discovery (real,
public, `GITHUB_TOKEN` optional) followed by a Gemini synthesis call constrained to only the
already-retrieved facts. **No Google Search grounding** — removed in Step 6's corrective pass after
hitting a real account quota; `lib/fabric/registry.ts`'s capability descriptor was corrected in
Step 8 to stop describing the removed grounding mechanism. Zero real repos returned is an honest
`FAILED`, never a plausible-looking fallback from model memory.

## Known limitation carried forward, not fixed this pass

**`src/services/synthosControlService.ts`** is a separate, client-side, `localStorage`-persisted
Guardian/Aegis/receipt pipeline for the legacy Kanban demo flow in `src/App.tsx` — **not** part of
the Execution Fabric, and it predates it entirely. Its own code comment already states plainly that
its `signatureHash` is a client-side rolling hash, "not SHA/Ed25519, no key material, not
independently verifiable," and must never be presented as a cryptographic signature. Step 8 fixed
the one place that promise was being broken — `src/components/ReceiptsView.tsx` and this service's
own log line no longer say "VERIFIED PROOF" / "Cryptographic Hash" / "LIVE VERIFIED" for a receipt
with zero real backing, and a hardcoded-`PASSED` Guardian badge now reads the receipt's real
`guardianPolicyPassed` field instead. **Not fixed**: this remains a fully separate pipeline from the
real fabric, and three client-side components (`JarvisView.tsx`'s local TTS path, `fishAudio.ts`,
`openRouterService.ts`) still send a user's own locally-entered third-party API key directly from
the browser to that provider, bypassing the server's existing `/api/voice/tts` proxy for the TTS
case specifically. Rewiring the Kanban flow onto the real fabric, and consolidating the TTS path
onto the server-proxied one, are real, deliberate migration projects — correctly out of scope for a
cleanup pass, and named here so they aren't lost.

## Terminology map (Section 6) — different vocabularies kept distinct, not merged

- **Effect class** (`READ`/`COMPUTE`/`EXTERNAL_ACTION`/`CONTROL`, registry-level) is a different
  axis from **MCP transport classification** (`classifyMcpOperation`'s verb-driven READ/COMPUTE/
  EXTERNAL_ACTION judgment for a specific MCP tool call) — the registry answers "what kind of thing
  is this capability," MCP classification answers "what kind of side effect does this specific
  tool name imply." Both use the same three effect-class words on purpose (one vocabulary), applied
  at two different levels (capability vs. individual tool call) — not a naming collision to resolve.
- **`NOT_CONFIGURED` vs `UNSUPPORTED`** — see above; kept as two distinct, meaningful states, not
  collapsed into one "not available" bucket, because the scheduler's transient-retry policy depends
  on the distinction being real.
- **Approval policy** (`NONE`/`GUARDIAN_ENFORCED`/`RECOMMENDED_NOT_ENFORCED`) is enforcement-grade
  vocabulary — `RECOMMENDED_NOT_ENFORCED` means a policy exists on paper but nothing in code checks
  it, and Section 7's rule treats it identically to `NONE` (both refuse an `EXTERNAL_ACTION`). This
  is deliberate: an unenforced recommendation is not permission.

## Reading order for a new session

1. This document.
2. `lib/fabric/registry.ts` — what capabilities exist and their real status.
3. `lib/fabric/envelope.ts` — the one dispatcher; read `executeEnvelope()` top to bottom.
4. `lib/fabric/scheduler.ts` — if the work touches scheduling.
5. `docs/AI-STUDIO-DIVERGENCE.md` — if a UI surface looks like it might be an AI-Studio-era artifact.
6. `docs/IMPLEMENTATION-STATUS.md` — the older, still-real "Pass"-numbered history this repo also
   maintains, a **different numbering scheme** from the "Step 4–8" fabric build this document
   describes. Say which scheme you mean when discussing either.
