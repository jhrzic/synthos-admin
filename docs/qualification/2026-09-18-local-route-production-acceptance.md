# Production acceptance — `local-runtime/qwen2.5-coder:14b` × `literal_transformation`

**Task:** `task-local-acceptance-1789746096513` → **DONE** · 2026-09-18T15:41:36Z–15:42:02Z · code `cd11a8b`
**Result:** **ACCEPTED**. Output is exactly `SYNTHOS LOCAL ROUTE ACCEPTED`, and the calculated cost is exactly $0.
**After the window:** the model is **disabled** again, and local execution is **OFF**. Paid execution, Antigravity,
discovery and refresh stayed OFF throughout.

This was a single task through the normal production task interface, using the existing qualification
`qual-1789743363846-6dbc7d90`. No qualification was created, and no suite was run.

## Preflight (read-only, zero network requests)

| Check | Result |
|---|---|
| Tree / HEAD | clean; local = remote = `cd11a8b` |
| Qualification | `qual-1789743363846-6dbc7d90` VALID; the only qualification; `literal_transformation`; `local-runtime` / `qwen2.5-coder:14b` / `qwen/qwen2.5-coder-14b-q4_k_m` / `default`; run `qrun-1789738253020-aaa41e8c`; substance `fc10e37e…462e` |
| Price | CURRENT and APPROVED, `…:3a336e42ac6c`, identical to the qualification run's; input, cachedInput and output all $0; no tiers or surcharges; unit tokens (actual-cost calculation supported) |
| Substance (offline disk chain) | manifest, config and weights all match `fc10e37e…` |
| Switches | paid OFF, local OFF, Antigravity OFF, discovery OFF, refresh OFF, model disabled |
| Queue | none RUNNING, AWAITING or PAUSED; 0 orchestrator-eligible tasks; 0 open ledger rows; 0 open continuity records |

**Queue note.** 31 old queued tasks exist: 23 TODO `aeo-task-*` and 8 READY `conv-*`, from 2026-09-10/11. All have
`autonomy_eligible = 0`, so the orchestrator never selects them. As a second safeguard, the service was stopped for
the window (`launchctl bootout`) and started again right after. The acceptance task was therefore the only thing
that could run.

## The window

The service was stopped. The model was enabled (`MODEL_ENABLED`) and local execution switched ON. One task was
submitted through the kernel's `executeAgentTask`, the function behind `/api/execute-agent-task` and the orchestrator,
with the service's own configuration:

| Field | Value |
|---|---|
| Task class | `literal_transformation` |
| Output contract | LITERAL, literal `SYNTHOS LOCAL ROUTE ACCEPTED` |
| Pin | `assignedModel: local-runtime/qwen2.5-coder:14b` (a pinned route: validated, never substituted) |
| Instruction | `Reply with exactly: SYNTHOS LOCAL ROUTE ACCEPTED`; the kernel sends it inside its LITERAL contract template (`buildContractPrompt`: TASK, INSTRUCTION, OUTPUT CONTRACT, literal) |
| Idempotency key | `acceptance:task-local-acceptance-1789746096513` |

Local execution was then switched OFF, the model disabled (`MODEL_DISABLED`), and the service started again. It
reports `/api/ready` 200, commit `cd11a8b`, tree CLEAN.

## Evidence

| | |
|---|---|
| Status path | TODO → READY → RUNNING → AWAITING_VERIFICATION → AWAITING_RECEIPT → **DONE** (15:42:02.341Z) |
| Routing decision | `route-1789746096517-c6dc8acc`, persisted 15:41:36.517Z, before dispatch at 15:41:36.645Z. SELECTED, PINNED_ROUTE, LOCAL, `qwen/qwen2.5-coder-14b-q4_k_m@default`, qualification `qual-1789743363846-6dbc7d90`, price `…:3a336e42ac6c`, substance `fc10e37e…` |
| Guardian | `SAFE` (LOW) |
| Spend guard | admitted as a governed local $0 call: ledger row `use-1789746096643-46e46276`, `kernel.model_task`, attempt 1, SUCCESS |
| Price snapshot (immutable, on the ledger row) | `{"versionKey":"…:3a336e42ac6c","unit":"tokens","input":0,"output":0,"cachedInput":0,"long":null,"derivedFrom":null}` |
| Cost | estimated **$0**; actual **$0**; `actual_cost_state = KNOWN` |
| Provider | response `chatcmpl-823`; termination `COMPLETE:stop`; latency 25.6 s |
| Tokens | input 101, cached 0, output 10, total 111; reasoning not reported |
| Segment | `seg-task-local-acceptance-1789746096513-1-a15280`, COMPLETED, 1 of 1 (no continuation) |
| Output | `SYNTHOS LOCAL ROUTE ACCEPTED` (28 characters) |
| Aegis | `qr-1789746122303-jxxo`, **VERIFIED**, score 100: integrity PASS, completion PASS, instructionCompliance PASS (contract LITERAL) |
| Receipt | `rcpt-1789746122304-c81636`, **Ed25519, verifies**. Names the qualification, routing decision, canonical version, deployment, price version, usage row, substance hash, verification scope and outcome COMPLETED. Recorded before DONE; authority record seq 52 |
| Artifact | `art-1789746122280-3b609948e475`, retrieval ACTIVE (not quarantined); hash `sha256:c76ed88e…a1a0` |
| Memory / knowledge | indexed in the local memory index (by design, for verified artifacts). The knowledge layer (KIL) scored it at confidence 0.707, below the 0.85 promotion threshold, so it was **not promoted**; 0 knowledge candidates |

### Aegis checks

All eleven passed:
- `integrity:task_exists_in_sqlite`
- `integrity:provider_output_non_empty`
- `integrity:persisted_artifact_exists`
- `integrity:artifact_belongs_to_task`
- `integrity:artifact_readable_from_disk`
- `integrity:artifact_hash_match`
- `integrity:status_history_sequence`
- `integrity:provider_completed_event_exists`
- `integrity:artifact_saved_event_exists`
- `completion:provider_termination`
- `instruction:literal_exact_match`

## Network (every request this process made)

| # | Request | Purpose |
|---|---|---|
| 1 | `GET http://127.0.0.1:11434/api/tags`, no Authorization, redirect refused | runtime substance check (metadata, no inference) |
| 2 | `POST http://127.0.0.1:11434/v1/chat/completions`, no Authorization, redirect refused | **the one inference request** |

There were no other requests: no paid or external provider, no retry, no fallback, no continuation, no duplicate and
no judge call. The only model invocation name was `model.local-runtime`, and the ledger holds one row for the
idempotency key.

## Count reconciliation (before → after)

| Record | Before → after | Explained by this one task |
|---|---|---|
| tasks | 93 → 94 | the task |
| task status history | 359 → 365 | TODO, READY, RUNNING, AWAITING_VERIFICATION, AWAITING_RECEIPT, DONE |
| activity events | 417 → 428 | 11 events, from TASK_CREATED to TASK_COMPLETED |
| routing decisions | 12 → 13 | 1 |
| provider runtime events | 6 → 7 | 1 PROVIDER_CALL SUCCESS |
| ledger rows | 13 → 14 | 1 |
| Aegis reviews | 52 → 53 | 1 |
| receipts | 51 → 52 | 1 |
| authority record | 51 → 52 | 1 |
| artifacts | 57 → 58 | 1 |
| memory index | 52 → 53 | 1 |
| segments / continuity | 0 → 1 / 0 → 1 | 1 / 1 |
| checkpoints | 0 → 0 | none (no continuation) |
| KIL observations | 28 → 29 | 1 (not promoted) |
| registry events | 31 → 33 | MODEL_ENABLED, MODEL_DISABLED |
| qualifications | 1 → 1 | unchanged |

## Observations (no code change made)

- **Memory index:** the acceptance artifact is now retrievable in the local memory index, because verified artifacts
  are indexed by design. It is not canonical knowledge, since KIL did not promote it. If test outputs should not be
  retrievable, that needs a product decision; it is not a defect in this run.
- **Event timestamps:** the activity events after the provider call share the execution's single timestamp
  (15:42:02.276Z), while the DONE status row carries its own write time (15:42:02.341Z). The ordering is still
  correct, since the receipt was recorded before DONE. This is existing kernel behaviour.
- **Queued tasks:** the 31 dormant tasks from 2026-09-10/11 remain as they were. They are not orchestrator-eligible,
  and were left untouched.
