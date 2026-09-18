# Reconciliation — `task-restart-1789678099` (stale RUNNING since 2026-09-17)

**Decision:** `RUNNING` → **`RECONCILING_UNKNOWN_EXECUTION`**, applied 2026-09-18T13:30:52Z by
`reconcileOrphanedRunningTask` (`lib/continuity/orphans.ts`). The decision was appended as a `RECONCILIATION_REQUIRED`
activity event and a new status-history row. Nothing was retried, deleted or rewritten.

## Evidence (append-only records)

| Source | Finding |
|---|---|
| Task | "RESTART PROOF — runtime verification synthesis", scribe / `gpt-5.6-terra`, workspace `ws-synthos-primary` |
| Status history | TODO 20:48:20.017Z → RUNNING 20:48:27.960Z → TODO → READY → RUNNING 20:48:27.969Z; nothing after |
| Activity | TASK_CREATED, AGENT_ASSIGNED, EXECUTION_STARTED (20:48:27.969Z); nothing after |
| Service log | "Starting execution … task-restart-1789678099", then SIGTERM, then a restart at 16:48:29 −0400 (20:48:29Z) |
| Shutdown drain | Waits only for HTTP connections. This task ran in the background from the orchestrator, so `process.exit` abandoned it mid-flight |
| Provider-usage rows | none. The spend ledger did not exist until 2026-09-18T04:17:58Z (commit `22e955f`), so a missing row proves nothing |
| Provider response id | none recorded |
| Provider runtime events | none after 20:48:27Z; they are only written after a call completes |
| Execution claims / reservations / heartbeat | none |
| Artifacts / Aegis reviews / receipts | none |
| Process ownership | none; the owning process exited on 2026-09-17, and the current service started 2026-09-18 |

## Reasoning

Execution began one second before the owning process was stopped. The kernel sends the model request immediately
after that point. Whether it reached OpenAI cannot be determined:
- there was no ledger at the time;
- no response was recorded;
- OpenAI cannot be queried without an external call, which is prohibited here.

So the dispatch outcome is **ambiguous**. Under the rules:
- it is not DONE, because no receipt exists;
- it is not READY, because non-dispatch cannot be proven;
- it is not FAILED, because nothing failed on its merits;
- it is **RECONCILING_UNKNOWN_EXECUTION**.

The only possible side effect is an OpenAI charge of a fraction of a cent. The task was an internal summary, so no
message, post or outward action was possible. No reservation existed, so nothing was released.

**To resolve (operator):** check OpenAI's usage dashboard for 2026-09-17 around 20:48Z. If no request appears, the
task may be CANCELLED. If one appears, record it as INCOMPLETE. Either way, do not re-run it automatically.

## Note on the sibling task

`task-restart2-1789678410` went through the same restart test at 20:53Z. It was set to CANCELLED on 2026-09-17 with a
payload asserting `provider_calls: 0`. The same evidence gap applies: that figure was not provable. The record is left
as it is, because history is not rewritten, and this note is the correction.
