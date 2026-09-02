# ADR-006 — Windmill External Execution Control Plane

**Status:** Accepted. **Date:** Pass VI.

## Context

Windmill has been referenced throughout this codebase since Pass I as the deferred answer to
"where does scheduling/orchestration live" — `docs/adr-001-hermes-adapter-governance.md` and prior
revisions of `docs/IMPLEMENTATION-STATUS.md` marked it `DEFERRED`, with `lib/runtime-status.ts`
hardcoding `windmillStatus()` to `NOT_IMPLEMENTED` and Master Admin's "Workers / Windmill" panel
showing a static `DEFER_TO_WINDMILL (NOT_CONNECTED)` placeholder. That deferral stands for
**scheduling** — SynthOS still has no cron, no timer, no in-process job loop, and this pass adds
none. What changes here is narrower: SynthOS can now submit a job to an already-running external
Windmill instance, track it, and turn its result into a real SynthOS artifact — a request/response
control-plane connection, not a scheduler.

## Decision

Build a real, authenticated REST client against Windmill's public API, a local, authoritative
execution ledger that never treats Windmill's own job state as sufficient truth on its own, and a
controlled target registry so no caller can invoke an arbitrary remote script or flow path.
Windmill becomes an **external execution runtime** only — SynthOS remains the authority, workspace,
policy, verification, and receipt layer, exactly as the task brief requires.

```
SynthOS task/graph-node/skill intent
  -> authorized submission (workspace-scoped, target-registry-resolved)
  -> Windmill job (remote_job_id)
  -> on-demand status refresh (never a timer)
  -> real result fetch
  -> local artifact
  -> Aegis verification (the same deterministic verifier /api/execute-agent-task uses)
  -> SynthOS-signed Ed25519 receipt (only on VERIFIED)
  -> Vault write + Memory index + KIL observation (identical to the native task pipeline)
```

## SynthOS authority boundary vs. Windmill execution boundary

| | SynthOS | Windmill |
|---|---|---|
| Decides who may submit a job | ✔ (`requireWorkspaceAdmin`) | — |
| Decides which remote paths are invokable | ✔ (`windmill_targets` registry) | — |
| Runs the script/flow | — | ✔ |
| Reports job state | — | ✔ (raw evidence only) |
| Decides what that state *means* locally | ✔ (`external_executions.status`, mapped, never copied verbatim) | — |
| Verifies the result | ✔ (Aegis, deterministic) | — |
| Signs the receipt | ✔ (Ed25519, `lib/persistence.ts`) | — never |
| Owns the workspace/task mapping | ✔ | — |

A Windmill workspace or job identifier is **never** treated as a SynthOS workspace identity. Every
`external_executions` row is workspace-owned at INSERT time from the authenticated, already-
authorized caller context (`req.authWorkspaceId`) — never from anything a remote payload claims,
and never from a client-supplied `workspaceId` inside a job's input.

## Workspace mapping and target allowlist

`windmill_targets` is the **only** mechanism that turns a logical id into a remote script/flow
path (K1). `workspace_id` is nullable: `NULL` means platform-global (visible to every workspace),
non-`NULL` scopes it to exactly one. No route anywhere accepts a caller-supplied remote path
directly — `resolveWindmillTarget(workspaceId, targetId)` is the one real gate every submission
path (skill execution, graph node, the direct API) passes through, and it re-checks visibility and
`enabled` on every call rather than trusting a previously-resolved target.

## Remote job correlation

`external_executions` is the canonical **local** truth for a remote job — the non-negotiable rule
this pass was built under. `remote_job_id` is Windmill's UUID, stored as foreign identity only;
`correlation_id` is SynthOS's own idempotency key (Q1), unique per workspace, so a retried
submission with the same key returns the existing row instead of creating a duplicate remote job.
A row can legitimately exist with `remote_job_id = NULL` — a `SUBMISSION_FAILED` attempt that never
reached Windmill at all.

Canonical local status values: `PENDING → SUBMITTED → RUNNING → SUCCEEDED | FAILED | CANCELLED`,
plus `UNKNOWN` for a status read that could not be resolved (P2 — never fabricated `FAILED`).
Windmill's own job shape (`QueuedJob` / `CompletedJob`, `running`, `success`, `canceled`) is mapped
into this vocabulary, never stored or surfaced verbatim as if it were SynthOS's own state.

## Status synchronization — no scheduler

Status refresh is **on-demand only** (E1): a UI refresh click, a bounded synchronous wait inside a
skill-execute or graph-node request (E2, capped attempts/timeout, never unbounded), or an orphan-
reconciliation read after a restart (P3). Nothing in this pass starts a timer, a cron job, or an
in-process poll loop — the non-negotiable "do not build a competing scheduler" rule holds. If a
Windmill job finishes while SynthOS is offline, the next real refresh call picks up the result
exactly once.

## Result ingestion, Aegis, receipt ownership

A `SUCCEEDED` remote job is **not** automatically a verified SynthOS result (rule 15). Ingestion
(`ingestExternalExecutionResult` in `lib/external-executions.ts`) fetches the real result, writes a
Vault artifact, and runs `runDeterministicAegisVerification` — the **same** deterministic verifier
`/api/execute-agent-task` uses, not a second, parallel one. Only a `VERIFIED` Aegis decision
produces a receipt, signed with the existing Ed25519 path (`canonicalizePayload` →
`signReceiptPayload` → `verifyReceiptSignature` → `recordReceipt`). Windmill never signs, never
mints, and never sees the signing key — the remote runtime's job is finished the moment its result
is fetched. On `VERIFIED`, the same KIL gate (`verifyTaskAtGate`) and memory indexing
(`indexVaultArtifact`) run as the native pipeline, isolated in their own try/catch so a KIL or index
failure never blocks the task, receipt, or response — identical posture to `/api/execute-agent-task`.

## Idempotency

- **Submission (Q1):** an explicit `idempotencyKey` maps to `external_executions.correlation_id`,
  which carries a `UNIQUE` constraint per workspace. A resubmission with the same key returns the
  existing row; it is never silently allowed to create a second remote job.
- **Result ingestion (Q2):** `ingestExternalExecutionResult` checks `result_ingested_at` first — a
  second call against an already-ingested row is a pure read, never a second artifact, receipt,
  Vault write, or KIL observation.
- **Retry (N2/N3):** a retry after a genuine failure creates a **new** `external_executions` row
  linked via `parent_execution_id` with `attempt_number` incremented — the prior attempt's history
  is never overwritten. A failed attempt never produces a receipt (N4).

## Cancel/reconciliation

Cancellation only ever marks `CANCELLED` on real remote confirmation (O2) — a cancel request that
Windmill accepts but has not yet actually stopped leaves the row in its real, unconfirmed status,
never speculatively `CANCELLED`. Orphan reconciliation (P1–P3) is just the same on-demand refresh
path: a row with a `remote_job_id` surviving a SynthOS restart is picked back up by the next real
refresh, resolves to `UNKNOWN` (not `FAILED`) if the remote job is unreachable/purged, and ingests
its result exactly once if it finished while SynthOS was down.

## Secret handling

`WINDMILL_TOKEN` lives in `process.env` only — unlike MCP's per-skill encrypted credential model,
there is no per-workspace Windmill credential in this pass (a single deployment-wide token, same
posture as `HERMES_ADAPTER_TOKEN`). It is never persisted to SQLite, never returned by any API
response, never logged, and is therefore automatically excluded from the database/Vault backup
archive (`lib/backup.ts`'s explicit allowlist covers only those two paths) without needing a special
case. `MCP_ALLOW_LOCAL_ENDPOINTS`-style SSRF protection is reused (via `isSafeMcpUrl`) against
`WINDMILL_BASE_URL` before every real network call.

## No local scheduler — restated

This pass adds **zero** new timers, cron entries, or background loops. `MC_DISABLE_SCHEDULER` still
does not exist because there is still nothing to disable. The acceptance test for this ADR is the
same one named in `CLAUDE.md`: *prove nothing dispatches on a timer* — `test/hermes-truth-regression.test.ts`
already asserts this for the codebase generally, and nothing added in this pass introduces a
`setInterval`/cron path anywhere in `lib/windmill-client.ts`, `lib/windmill-targets.ts`, or
`lib/external-executions.ts`.

## Known limitation, stated honestly

Windmill's REST contract here (`GET /api/version`, `GET /api/users/whoami`,
`POST /api/w/{workspace}/jobs/run/{p|f}/{path}`, `GET /api/w/{workspace}/jobs_u/get/{id}`,
`GET /api/w/{workspace}/jobs_u/get_completed_job_result/{id}`,
`POST /api/w/{workspace}/jobs_u/cancel/{id}`) is implemented against Windmill's published, public
REST API shape — it has **not** been verified against a live Windmill instance in this pass, because
no `WINDMILL_BASE_URL` is configured anywhere in this local deployment. Per this task's own rule
("if unavailable: NOT_CONFIGURED, do not fabricate"), production status is honestly
`NOT_CONFIGURED` until real credentials are supplied. Contract tests (`test/windmill-client.test.ts`)
validate this client's request/response handling, timeout, SSRF-guard, and error-mapping behavior
against a real local HTTP server implementing the same documented shape — that proves the client
code is real, not that Windmill's actual API matches it exactly. First real-instance verification
is the natural next step once a Windmill deployment is reachable.
