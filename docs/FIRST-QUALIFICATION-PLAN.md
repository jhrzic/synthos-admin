# First route qualification — plan (NOT EXECUTED)

Prepared 2026-09-18. **Nothing in this document has been run.** Paid execution is OFF, local
execution is OFF, Antigravity is OFF, manual discovery is OFF and scheduled route refresh is
OFF. There are 0 qualifications. Every model task therefore waits (paused, not failed) until
one route is qualified.

This plan does **not** reuse the earlier live proof (ledger row `use-1789708234302-c6ec7634`,
`openai/gpt-5.6-terra`, `kernel.model_task`). That run produced a response that failed the
semantic check, so it is not qualification evidence for anything. The plan below is a fresh
run under a different task class and suite.

---

## A. Paid route — one bounded run

| Item | Value |
|---|---|
| Model / version | `openai/gpt-5.6-terra` — canonical version `openai/gpt-5.6-terra` (the publisher's own route defines the version) |
| Route | `openai` DIRECT, deployment `default`, protocol `openai.responses` |
| Why this route | OpenAI is the only provider with a stored credential (`model_credentials`: openai). No Gemini key is configured. Of the OpenAI offerings in the registry, only `gpt-5.6-terra` and `gpt-5.6-sol` declare the LITERAL output contract; terra is the cheaper one ($2 / $12 per MTok vs $4 / $20). |
| Task class | `literal_transformation` (LITERAL; not segmentable) |
| Suite | `suite.literal` v1.0.0 — 3 cases × 2 repetitions |
| Number of calls | **6**, one per case per repetition. No retries: a failed or UNKNOWN call is recorded as it happened and is not repeated. |
| Max input per call | the longest case prompt is 53 characters → 18 tokens by the guard's estimate (chars ÷ 3) |
| Max output per call | 512 tokens (production `task.maxOutputTokens`; reasoning tokens count inside this cap and are billed as output) |
| Worst-case cost per call | 18 × $2/M + 512 × $12/M = **$0.00618** |
| Worst-case cost, whole run | 6 × $0.00618 = **$0.0371** |
| Spend already on the ledger | $0.006368 (the one existing row) |

### Switches required, and only for the run

1. `paidExecutionEnabled` → **true**. Admin → Spend control → *Enable paid execution*.
2. The `openai` provider limit stays as it is today: enabled, $0.05/day, $0.05/month, concurrency 1.
   The worst case ($0.0371) plus existing spend ($0.0064) = $0.0435, which fits the $0.05 month.
3. `modelExecutionEnabled` stays true (default). `localExecutionEnabled` stays false.
   Gemini, Antigravity, TTS, ElevenLabs stay disabled.
4. No route is enabled for production traffic by the run. The run opens a *qualification run*;
   only an operator approval creates a qualification.

### Guardian

The six prompts are fixed registry data (`Reply with exactly: ALPHA-7`, …). They contain no
tool use, no outward action, no credentials and no customer data. Expected Guardian decision:
**SAFE**. Qualification cases are admitted by the spend guard only inside a route context that
names the open qualification run (evaluation-only admission); production routing of the same
route still passes Guardian in `routeTask` on every call.

### Spend Guard reservation

Each call reserves its own worst case ($0.00618) before dispatch and settles to actual
afterwards. Concurrency 1 means one reservation at a time. Per-call ceiling
`task.maxEstimatedUsd` = $0.01 ≥ $0.00618, so no call needs a separate approval
(`approvalThresholdUsd` = $0.10).

### Pass thresholds (registry data, not chosen here)

`literal_transformation` requires quality ≥ **0.98** and reliability ≥ **0.95**. With 6 exact-match
checks that means **all 6 must match exactly**. 5 of 6 fails the run.

### Canary evidence

Run the cases with source **CANARY** from the Admin qualification runner (Model Registry → the
route → *Run suite*). Approval is refused unless at least one case is a CANARY backed by a
`SUCCESS` row in `provider_usage` for exactly `openai/gpt-5.6-terra`.

### What success creates

- 6 new `provider_usage` rows (ledger goes from 1 to 7), each naming the qualification run.
- A `registry_qualification_runs` row, status PASSED.
- After an operator approves it: one `registry_qualifications` row, state **VALID**, for
  `openai/gpt-5.6-terra@default` × `literal_transformation` only, valid 90 days, bound by hash to
  the model, route, deployment, adapter, endpoint, price record, suite version and thresholds. Any
  change to one of those shows it as INVALIDATED and names what changed.
- It qualifies **one task class**. Conversation, content, research, review and everything else
  stay unqualified and keep waiting.

### Shutdown, immediately after the sixth call

1. Admin → Spend control → *Disable all paid execution* (`paidExecutionEnabled` = false).
2. Confirm: `SELECT COUNT(*) FROM provider_usage` = 7; no row in status `RESERVED`; no row with
   status `UNKNOWN` / `TIMEOUT_AFTER_DISPATCH` (if one exists, reconcile it before anything else;
   it is never retried).
3. Confirm the Spend panel reads PAID EXECUTION OFF.

### Rollback

- Run failed: nothing to roll back. The run stays FAILED as a record, and no qualification exists.
- Qualification approved in error: `revokeQualification(<id>, actor, reason)` (Model Registry →
  qualification → *Revoke*). The route stops being routable at once. Ledger rows, the run and
  receipts are history and are **not** deleted.

---

## B. Zero-cost local path — a runtime is actually installed

Evidence gathered without contacting it (filesystem and process table only):

- `/usr/local/bin/ollama` exists; `Ollama.app` is in `/Applications`.
- A process named `ollama` is listening on `127.0.0.1:11434`.
- Model manifests are on disk for `qwen2.5-coder:14b` and `hermes3:8b`
  (`~/.ollama/models/manifests/registry.ollama.ai/library/…`).

**Not yet shown:** that either model answers, or how fast it is on this Mac. No request was sent.

Steps, none executed:

1. **Import (manual discovery, one time).** Model Registry → Route imports → *local-runtime* →
   *Import now*. This is a metadata read from `http://localhost:11434/v1/models` on loopback. It
   is the only step that needs manual discovery switched on, and it can be switched off again
   right after.
2. **Price.** The importer records each offering at $0 as UNREVIEWED. An operator must approve the
   $0 price record. Until then the route is PRICE_UNKNOWN, and unknown pricing is never treated as free.
3. **Identity.** Approve a route mapping to a canonical version, e.g. `qwen2.5-coder:14b` → family
   `qwen`, version `qwen/qwen2.5-coder-14b`. A local model has no publisher route of its own
   here.
4. **Switch.** `localExecutionEnabled` → true. Paid execution **stays OFF**; the local route runs
   anyway because it is LOCAL, billed FREE_LOCAL, with an approved $0 price.
5. **Run** `suite.literal` (6 calls, CANARY) against the local route. Cost $0.00. Each case still
   goes through the spend guard and writes a ledger row at $0 naming the qualification run —
   that row is the canary evidence. The thresholds are the same: 6 of 6. After approval, every
   production call on the route carries a routing decision, an Aegis review and a signed receipt,
   exactly like a paid call (proven by `test/canonical-router-entrypoints.test.ts`).
6. **Shutdown and rollback** are as in section A, using `localExecutionEnabled` = false instead of
   the paid switch.

A free *aggregator* route (for example an OpenRouter `:free` offering) is **not** this path. It
stays under paid execution, and paid OFF blocks it.
