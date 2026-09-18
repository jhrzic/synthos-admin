# Qwen route activation — BLOCKED (2026-09-18)

**Route:**
- qualification `qual-1789743363846-6dbc7d90`;
- provider `local-runtime` / model `qwen2.5-coder:14b` @ `default`;
- canonical version `qwen/qwen2.5-coder-14b-q4_k_m`;
- LOCAL route, class `literal_transformation` only;
- substance `fc10e37e…462e`.

**Decision:** **no activation change was made.** Pre-activation check 8 (*no ambiguous or RECONCILING task*) failed on
`task-restart-1789678099`. John ruled that it blocks activation. The ruling was given as option 1 on 2026-09-18.

State as left:
- the model is **disabled**;
- local execution, paid execution, Antigravity, manual discovery and route refresh are all **OFF**;
- general model execution is ON (the default);
- no task ran, no inference or qualification run was made, and no provider or external call was made.

`task-restart-1789678099` is preserved exactly as `RECONCILING_UNKNOWN_EXECUTION`:
- not retried, cancelled or completed;
- no outcome inferred;
- no ledger row created, and no history rewritten.

The fingerprint over its task row, status history, activity and ledger rows is `75d3702d…` before and after this work.

## Pre-activation checks

| # | Check | Result |
|---|---|---|
| 1 | Clean tree; local = remote = running service; CI green | pass (at `f3173a1`, CI run 35368620316) |
| 2 | Qualification VALID and the only one; class literal_transformation; expires 2026-12-17T14:56:03.846Z; run `qrun-1789738253020-aaa41e8c` | pass |
| 3 | Binding substance = `fc10e37e…` = disk substance | pass (then confirmed by the full audit below) |
| 4 | Price CURRENT and APPROVED; rates 0/0/0; no tiers or charges | pass |
| 5 | All 7 receipts verify (6 qualification + acceptance `rcpt-1789746122304-c81636`) | pass. Re-verified after deploy: 7/7, and all 52 production receipts verify |
| 6 | Ledger 14, provider events 7; no open ledger rows | pass |
| 7 | Nothing running, paused or held in continuity | pass |
| **8** | **No RECONCILING / ambiguous task** | **FAIL: `task-restart-1789678099`** |
| 9–12 | Switches OFF; model disabled; no model enabled; 31 legacy tasks not eligible | pass |

## Full offline substance audit (done; the route stays OFF)

`auditLocalRouteSubstance` (commit `366b4bc`) ran against production at **2026-09-18T17:29:01.409Z**:
- actor `claude-code:operator-directed-by-john-2026-09-18`;
- **0 network requests**, no inference;
- 7.0 s, with the file cached by the OS.

| File | Path (under `~/.ollama/models`) | Bytes | SHA-256 of the full content |
|---|---|---|---|
| manifest | `manifests/registry.ollama.ai/library/qwen2.5-coder/14b` | 858 | `9ec8897f747e246e970bc5cfdda85d22f1123dc2e3d34978a010a75968716849` |
| config | `blobs/sha256-0578f229…bc40` | 488 | `0578f229f23ad620e123654fd0b4708405e7af3629ec1aecf3f553f54e06bc40` |
| weights | `blobs/sha256-ac9bc7a6…b1ed` | **8,988,110,784** | `ac9bc7a69dab38da1c790838955f1293420b55ab555ef6b4615efa1c1507b1ed` |

- **Chain:**
  - the manifest names config `0578f229…` and weights `ac9bc7a6…`;
  - each blob's content hashes to its own address;
  - the weights size matches the manifest.
- **Config fields:** gguf / qwen2 / 14.8B / Q4_K_M.
- **Final substance hash:** `fc10e37e2012287a67f23ee2dbce9a38ad953bc968da50516b481186c789462e`, identical to the approved and expected value. There were no mismatches.
- **Independent check:** `shasum -a 256` over the weights blob took 36 s and gives the same `ac9bc7a6…b1ed`.
- **Record:** one append-only registry event, `rev-1789752548423-4ba1c3` (`LOCAL_SUBSTANCE_AUDITED`).
- **Qualification:** the row is byte-identical before and after. Nothing was invalidated, because nothing mismatched.

## Router previews (non-saving, current not-activated state)

`routeTask(..., persist: false)` against production made 0 network requests. Counts immediately before and after the previews are identical:
- routing_decisions 16, provider_usage 14, registry_events 36;
- tasks 94, task_status_history 365, activity_events 429;
- runtime_events 77, receipts 52;
- qualifications 1, continuity 1.

| Preview | Outcome |
|---|---|
| literal_transformation pinned to Qwen | **refused**: MODEL_DISABLED; LOCAL_EXECUTION_DISABLED |
| content_generation pinned to Qwen | **refused**: NOT_QUALIFIED for content_generation; MODEL_DISABLED; LOCAL_EXECUTION_DISABLED |
| literal_transformation, unpinned (67 offerings) | **refused**: no eligible route; nothing substituted |
| pinned to `hermes3:8b` | **refused**: NOT_QUALIFIED; IDENTITY_UNRESOLVED (UNMAPPED); PRICING_MISSING_OR_UNREVIEWED (unreviewed price); MODEL_NOT_ADMITTED; LOCAL_EXECUTION_DISABLED; MODEL_SUBSTANCE_UNBOUND |

The previews for the *activated* state were **not run**, because nothing was activated. Those are:
- literal_transformation selects the route;
- another class is refused;
- unknown-price, unqualified and disabled routes are refused.

They are the post-activation checks, to be run after the blocker is resolved and the route is switched on.

## What John must check on the OpenAI dashboard

Everything below comes from records already in the database and the service log. Nothing was fetched from OpenAI.

**The window.**
- The task recorded `EXECUTION_STARTED` at **2026-09-17T20:48:27.969Z**.
- The service log shows SIGTERM immediately after, and the next service start at `16:48:29 -0400`, which is **20:48:29Z**.
- So if the request left the machine at all, it left between **20:48:27.969Z and 20:48:30Z**.
- Other requests that evening took 2.5–21.7 s, and one timed out at 60 s. Any usage OpenAI recorded for it would therefore fall in **2026-09-17 20:48–20:50 UTC** (16:48–16:50 EDT).

**What SynthOS knows about the request:**
- endpoint `POST https://api.openai.com/v1/responses`, model **`gpt-5.6-terra`**;
- the API key configured in `~/.synthos/synthos-admin.env` at the time (not printed);
- the instruction was the task description: *"Summarise the always-on runtime verification note from the supplied Brain context in two sentences."*

**Known identifiers:** **none.**
- No provider request ID, response ID or usage was recorded: the process died before a response could be written.
- The spend ledger did not exist until 2026-09-18T04:17:58Z.

**Every SynthOS OpenAI request recorded on 2026-09-17 (UTC).** All were `gpt-5.6-terra`; use them to line up against the dashboard:

| Time (UTC) | Record | Tokens in / out (reasoning) |
|---|---|---|
| 20:22:28.489 | runtime event PROVIDER_CALL SUCCESS, 2,527 ms | not recorded |
| 20:24:25.219 | `task-openai-closeout-1789676625948` PROVIDER_COMPLETED | 138 / 2,988 (44) |
| 20:42:41.956 | `task-nocp-A-1789677748776` | 142 / 950 (152) |
| 20:44:48.596 | `task-nocp-A-1789677866890` | 133 / 1,578 (91) |
| 20:45:57.959 → 20:46:57.970 | `task-service-driven-1789677954`, **timed out after 60 s**; OpenAI may still have processed and billed it | unknown |
| **20:48:27.969 → ?** | **`task-restart-1789678099`: the blocker** | **unknown** |
| 20:53:37.097 → ? | `task-restart2-1789678410`: same restart test. Recorded as CANCELLED with `provider_calls: 0`, which was **not provable** | unknown |

The 20:22 and 20:24 records were written by different paths. SynthOS evidence does not show whether they are one request or two.

**How to read the dashboard:**
1. **Logs** (platform.openai.com → Logs → Responses). The adapter at the time did not set `store`, and `/v1/responses`
   stores responses by default unless the organisation's data controls disable it. Look for a response created
   around **2026-09-17 20:48:28Z** whose input is the instruction above. **This is the strongest evidence.**
2. **Usage**, per-minute or per-request, filtered to the project/key and model `gpt-5.6-terra`. Check whether any request
   is recorded between **20:48 and 20:50 UTC**. A request at 20:53–20:55 UTC would be `task-restart2`, not this one.
3. Other software sharing the same key or project will confuse a count-only comparison. The Logs entry does not have
   that problem.

**Decision rule**, stated in the earlier reconciliation record (`2026-09-18-reconciliation-task-restart-1789678099.md`):
- **Request found:** it was received. Record the task as INCOMPLETE with the dashboard's usage figures. Do not re-run it.
- **Nothing in 20:48–20:50 UTC and nothing in Logs:** it was not received. The task may be CANCELLED.
- **Still unclear:** it stays RECONCILING, and activation stays blocked unless John rules otherwise in writing.

**Gap to close before that ruling can be recorded.** No canonical, audited operator action exists yet to resolve a
`RECONCILING_UNKNOWN_EXECUTION` task with attached external evidence. The queue review deliberately refuses CANCEL,
ARCHIVE and REQUEUE in this state. Resolving it will need that one small action first. It was not built here, because
this task authorized no change to the task.

## Schema version (deployed in `366b4bc`)

The production database moved from `user_version` **0 → 2**. Both migrations were no-ops against the existing schema:
- v1 records the baseline;
- v2's table already existed.

`/api/ready` and the diagnostics now report `databaseSchema: { version: 2, supported: 2, fingerprint: sha256:2e21e688… }`.

## Production state after this work

| | Before | After |
|---|---|---|
| Ledger rows / provider events | 14 / 7 | 14 / 7 |
| Qualification | 1, QUALIFIED (VALID) | same, row unchanged |
| `qwen2.5-coder:14b` enabled | 0 | 0 |
| Paid / local / Antigravity / discovery / refresh | OFF | OFF |
| Legacy queue fingerprint (31 tasks) | `7c36dac0…` | `7c36dac0…` |
| Blocker fingerprint | `75d3702d…` | `75d3702d…` |
| Acceptance evidence fingerprint | `0a010506…` | `0a010506…` |
| Quarantined artifact | QUARANTINED, not indexed | same |
| Schema version | 0 | **2** |
| Registry events | 34 | **36**: +1 `LOCAL_SUBSTANCE_AUDITED` (`rev-1789752548423-4ba1c3`) and +1 `SHUTDOWN_SETTLED` (`rev-1789752523979-4a4ab20e`, from the deploy restart: 0 reservations released, 0 calls marked UNKNOWN, no tasks). Each later restart appends one more `SHUTDOWN_SETTLED` |

Related reports:
- `2026-09-18-legacy-queue-decision-report.md`;
- `2026-09-18-committed-database-history-audit.md`, which found the retired receipt-signing private key in the public history, with a remediation plan and no action taken.
