# Legacy queue — decision report (2026-09-18)

Read-only. **No task was mutated.** The data comes from the canonical queue review (`reviewQueuedTasks`, `lib/task-queue-review.ts`).
It ran against a read-only snapshot copy of the production database, so no code path could write to the live database.
Nothing here has been acted on. Each recommendation is for John to decide, and any action goes through the audited
queue actions: a reason and a confirmation, with history kept. PII is redacted: contact values are never shown, only their category.

## Summary

| | |
|---|---|
| Legacy queued tasks | **31** (23 TODO, 8 READY), all in `ws-synthos-primary` |
| Could execute under current switches | **0** |
| Autonomy-eligible | 0 of 31 (the orchestrator never selects them) |
| Class / output contract / model route recorded | 0 of 31. The assigned model is the placeholder `n/a` |
| Valid qualification | 0 of 31 (none has a class to qualify against) |
| Continuity, ledger rows, own artifacts or receipts | none for any of the 31 |
| `task-restart-1789678099` | Not legacy work. It is the **activation blocker** (RECONCILING_UNKNOWN_EXECUTION; see `2026-09-18-qwen-activation-blocked.md`). CANCEL, ARCHIVE and REQUEUE are all refused for it by design, and it was not touched |

**Exact blocker, identical for all 31** (verbatim from the canonical review):

1. *not autonomy-eligible: the orchestrator never selects it; only an explicit REQUEUE could*
2. *no task class recorded: the canonical router has nothing to qualify it against*
3. *assigned model "n/a" is not a registered model route*

Actions the review offers for each of the 31:

- **CANCEL:** allowed.
- **ARCHIVE:** allowed.
- **REQUEUE:** refused (*no task class recorded: it could not be routed*).

CANCEL and ARCHIVE both **preserve evidence**. The row, the status history and the activity stay, and a status row and an audited event are appended. No available action deletes anything.

## Groups

Every one of the 31 falls into **all four configuration groups**: incomplete configuration, missing model selection, missing qualification and missing output contract.
That is why none can run. The decision groups below are what distinguish them:

| Decision group | Count |
|---|---|
| POTENTIALLY_VALID_BUSINESS_WORK | 5 |
| OBSOLETE_TEST_CANDIDATE (duplicate) | 16 |
| OBSOLETE_TEST_CANDIDATE (superseded) | 2 |
| OBSOLETE_TEST_CANDIDATE (scripted) | 7 |
| REQUIRES_JOHN_REVIEW | 1 |
| **Total** | **31** |

The AEO tasks come from **five audits of the same site** (`getsynthos.com`, the company's own site) run on 2026-09-10 and 2026-09-11. All five audit tasks are DONE.
- The first audit found 3 issues.
- The next four each found the same 5 issues, with identical evidence text.

Only the latest audit's five are kept as potentially valid. Whether they are **still** true is UNKNOWN until the site is re-audited, and that needs a network call, which was not made.

## Per task

Common to every row:
- class NOT RECORDED · contract NOT RECORDED · model `n/a` · eligibility NO · qualification NONE;
- blocker: the three lines above, verbatim.

| # | Task ID | Workspace | Created (UTC) | Status | Title / purpose | Source | Group | Recommended action | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `aeo-task-1789069604913-0-d0bb` | ws-synthos-primary | 2026-09-10T19:46:44.913Z | TODO | robots.txt present | AEO audit `aeo-1789069563911-aa6b20f6` of the company's own site (agent `technical`) | OBSOLETE_TEST_CANDIDATE (superseded) | ARCHIVE. The four later audits of the same site no longer report this finding. Whether the site changed or the check changed is not recorded, so confirm before archiving. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 2 | `aeo-task-1789069604916-1-d8ad` | ws-synthos-primary | 2026-09-10T19:46:44.913Z | TODO | XML sitemap present | AEO audit `aeo-1789069563911-aa6b20f6` of the company's own site (agent `technical`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 3 | `aeo-task-1789069604918-2-7264` | ws-synthos-primary | 2026-09-10T19:46:44.913Z | TODO | Exactly one H1 per page | AEO audit `aeo-1789069563911-aa6b20f6` of the company's own site (agent `content`) | OBSOLETE_TEST_CANDIDATE (superseded) | ARCHIVE. The four later audits of the same site no longer report this finding. Whether the site changed or the check changed is not recorded, so confirm before archiving. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 4 | `aeo-task-1789077450428-0-cd8f` | ws-synthos-primary | 2026-09-10T21:57:30.428Z | TODO | Structured data (JSON-LD) present | AEO audit `aeo-1789077450417-a14aee60` of the company's own site (agent `schema`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 5 | `aeo-task-1789077450428-1-44cb` | ws-synthos-primary | 2026-09-10T21:57:30.428Z | TODO | XML sitemap present | AEO audit `aeo-1789077450417-a14aee60` of the company's own site (agent `technical`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 6 | `aeo-task-1789077450428-2-08c5` | ws-synthos-primary | 2026-09-10T21:57:30.428Z | TODO | Organization entity declared | AEO audit `aeo-1789077450417-a14aee60` of the company's own site (agent `schema`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 7 | `aeo-task-1789077450428-3-198e` | ws-synthos-primary | 2026-09-10T21:57:30.428Z | TODO | Question/answer content exists | AEO audit `aeo-1789077450417-a14aee60` of the company's own site (agent `content`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 8 | `aeo-task-1789077450428-4-82c4` | ws-synthos-primary | 2026-09-10T21:57:30.428Z | TODO | Pages are structured for direct answers | AEO audit `aeo-1789077450417-a14aee60` of the company's own site (agent `content`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 9 | `aeo-task-1789077658149-0-54c6` | ws-synthos-primary | 2026-09-10T22:00:58.149Z | TODO | Structured data (JSON-LD) present | AEO audit `aeo-1789077658134-2bb072fc` of the company's own site (agent `schema`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 10 | `aeo-task-1789077658149-1-2372` | ws-synthos-primary | 2026-09-10T22:00:58.149Z | TODO | XML sitemap present | AEO audit `aeo-1789077658134-2bb072fc` of the company's own site (agent `technical`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 11 | `aeo-task-1789077658150-2-50ae` | ws-synthos-primary | 2026-09-10T22:00:58.149Z | TODO | Organization entity declared | AEO audit `aeo-1789077658134-2bb072fc` of the company's own site (agent `schema`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 12 | `aeo-task-1789077658150-3-382e` | ws-synthos-primary | 2026-09-10T22:00:58.149Z | TODO | Question/answer content exists | AEO audit `aeo-1789077658134-2bb072fc` of the company's own site (agent `content`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 13 | `aeo-task-1789077658150-4-c38c` | ws-synthos-primary | 2026-09-10T22:00:58.149Z | TODO | Pages are structured for direct answers | AEO audit `aeo-1789077658134-2bb072fc` of the company's own site (agent `content`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 14 | `aeo-task-1789079727694-0-ef94` | ws-synthos-primary | 2026-09-10T22:35:27.694Z | TODO | Structured data (JSON-LD) present | AEO audit `aeo-1789079727678-1775c5ce` of the company's own site (agent `schema`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 15 | `aeo-task-1789079727694-1-6cd9` | ws-synthos-primary | 2026-09-10T22:35:27.694Z | TODO | XML sitemap present | AEO audit `aeo-1789079727678-1775c5ce` of the company's own site (agent `technical`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 16 | `aeo-task-1789079727695-2-b354` | ws-synthos-primary | 2026-09-10T22:35:27.694Z | TODO | Organization entity declared | AEO audit `aeo-1789079727678-1775c5ce` of the company's own site (agent `schema`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 17 | `aeo-task-1789079727695-3-2f54` | ws-synthos-primary | 2026-09-10T22:35:27.694Z | TODO | Question/answer content exists | AEO audit `aeo-1789079727678-1775c5ce` of the company's own site (agent `content`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 18 | `aeo-task-1789079727695-4-6672` | ws-synthos-primary | 2026-09-10T22:35:27.694Z | TODO | Pages are structured for direct answers | AEO audit `aeo-1789079727678-1775c5ce` of the company's own site (agent `content`) | OBSOLETE_TEST_CANDIDATE (duplicate) | ARCHIVE. Duplicate of the same finding in the latest audit `aeo-1789089846077-333cc1f7`, with identical evidence text. | preserves (row, history, activity kept; CANCELLED + archive event appended) |
| 19 | `aeo-task-1789089846089-0-0dd6` | ws-synthos-primary | 2026-09-11T01:24:06.089Z | TODO | Structured data (JSON-LD) present | AEO audit `aeo-1789089846077-333cc1f7` of the company's own site (agent `schema`) | POTENTIALLY_VALID_BUSINESS_WORK | KEEP for now. If the fix is wanted, create a fresh task through the canonical path (class + contract), then ARCHIVE this one. Current truth is UNKNOWN until the site is re-audited (a network call, not made here). | preserves (no action) |
| 20 | `aeo-task-1789089846089-1-d7ad` | ws-synthos-primary | 2026-09-11T01:24:06.089Z | TODO | XML sitemap present | AEO audit `aeo-1789089846077-333cc1f7` of the company's own site (agent `technical`) | POTENTIALLY_VALID_BUSINESS_WORK | KEEP for now. If the fix is wanted, create a fresh task through the canonical path (class + contract), then ARCHIVE this one. Current truth is UNKNOWN until the site is re-audited (a network call, not made here). | preserves (no action) |
| 21 | `aeo-task-1789089846089-2-d2af` | ws-synthos-primary | 2026-09-11T01:24:06.089Z | TODO | Organization entity declared | AEO audit `aeo-1789089846077-333cc1f7` of the company's own site (agent `schema`) | POTENTIALLY_VALID_BUSINESS_WORK | KEEP for now. If the fix is wanted, create a fresh task through the canonical path (class + contract), then ARCHIVE this one. Current truth is UNKNOWN until the site is re-audited (a network call, not made here). | preserves (no action) |
| 22 | `aeo-task-1789089846090-3-5d60` | ws-synthos-primary | 2026-09-11T01:24:06.089Z | TODO | Question/answer content exists | AEO audit `aeo-1789089846077-333cc1f7` of the company's own site (agent `content`) | POTENTIALLY_VALID_BUSINESS_WORK | KEEP for now. If the fix is wanted, create a fresh task through the canonical path (class + contract), then ARCHIVE this one. Current truth is UNKNOWN until the site is re-audited (a network call, not made here). | preserves (no action) |
| 23 | `aeo-task-1789089846090-4-3c5e` | ws-synthos-primary | 2026-09-11T01:24:06.089Z | TODO | Pages are structured for direct answers | AEO audit `aeo-1789089846077-333cc1f7` of the company's own site (agent `content`) | POTENTIALLY_VALID_BUSINESS_WORK | KEEP for now. If the fix is wanted, create a fresh task through the canonical path (class + contract), then ARCHIVE this one. Current truth is UNKNOWN until the site is re-audited (a network call, not made here). | preserves (no action) |
| 24 | `conv-handoff-1789091528694-aa41e0` | ws-synthos-primary | 2026-09-11T01:52:08.694Z | READY | Human handoff requested — website visitor | website conversation `conv-1789091528385-4a28f5c4` (human handoff, channel WEB, created by `conversation-ai`) | OBSOLETE_TEST_CANDIDATE (scripted) | ARCHIVE. 6 customer messages arrived within 0.223s, which is machine speed. Contact: reserved example domain. Part of one 01:52–03:34 UTC test burst against one profile. | preserves (the conversation and its messages are untouched) |
| 25 | `conv-followup-1789091733434-dcf9a8` | ws-synthos-primary | 2026-09-11T01:55:33.434Z | READY | Follow-up requested — website visitor | website conversation `conv-1789091733160-12471f4c` (follow-up request, channel WEB, created by `conversation-ai`) | OBSOLETE_TEST_CANDIDATE (scripted) | ARCHIVE. 6 customer messages arrived within 0.195s, which is machine speed. Contact: reserved example domain. Part of one 01:52–03:34 UTC test burst against one profile. | preserves (the conversation and its messages are untouched) |
| 26 | `conv-followup-1789091813120-463ebc` | ws-synthos-primary | 2026-09-11T01:56:53.120Z | READY | Follow-up requested — website visitor | website conversation `conv-1789091812864-994d768d` (follow-up request, channel WEB, created by `conversation-ai`) | OBSOLETE_TEST_CANDIDATE (scripted) | ARCHIVE. 7 customer messages arrived within 0.236s, which is machine speed. Contact: reserved example domain. Part of one 01:52–03:34 UTC test burst against one profile. | preserves (the conversation and its messages are untouched) |
| 27 | `conv-handoff-1789091869695-6e2664` | ws-synthos-primary | 2026-09-11T01:57:49.695Z | READY | Human handoff requested — website visitor | website conversation `conv-1789091869479-a6e9845b` (human handoff, channel WEB, created by `conversation-ai`) | OBSOLETE_TEST_CANDIDATE (scripted) | ARCHIVE. 4 customer messages arrived within 0.119s, which is machine speed. Contact: none. Part of one 01:52–03:34 UTC test burst against one profile. | preserves (the conversation and its messages are untouched) |
| 28 | `conv-followup-1789091929964-6220c2` | ws-synthos-primary | 2026-09-11T01:58:49.964Z | READY | Follow-up requested — website visitor | website conversation `conv-1789091929709-2907975a` (follow-up request, channel WEB, created by `conversation-ai`) | OBSOLETE_TEST_CANDIDATE (scripted) | ARCHIVE. 6 customer messages arrived within 0.197s, which is machine speed. Contact: reserved example domain. Part of one 01:52–03:34 UTC test burst against one profile. | preserves (the conversation and its messages are untouched) |
| 29 | `conv-followup-1789092299982-7dccb0` | ws-synthos-primary | 2026-09-11T02:04:59.982Z | READY | Follow-up requested — website visitor | website conversation `conv-1789092299727-5954028b` (follow-up request, channel WEB, created by `conversation-ai`) | OBSOLETE_TEST_CANDIDATE (scripted) | ARCHIVE. 6 customer messages arrived within 0.204s, which is machine speed. Contact: reserved example domain. Part of one 01:52–03:34 UTC test burst against one profile. | preserves (the conversation and its messages are untouched) |
| 30 | `conv-followup-1789092709285-b8674d` | ws-synthos-primary | 2026-09-11T02:11:49.285Z | READY | Follow-up requested — website visitor | website conversation `conv-1789092684022-0f914fce` (follow-up request, channel WEB, created by `conversation-ai`) | REQUIRES_JOHN_REVIEW | Decide. It has one customer message and no contact, so timing cannot show it was scripted. It sits inside the same test burst and profile, which suggests a test but does not prove it. | preserves (no action until decided) |
| 31 | `conv-followup-1789097680843-6dcf53` | ws-synthos-primary | 2026-09-11T03:34:40.843Z | READY | Follow-up requested — website visitor | website conversation `conv-1789097680521-5883eb21` (follow-up request, channel WEB, created by `conversation-ai`) | OBSOLETE_TEST_CANDIDATE (scripted) | ARCHIVE. 6 customer messages arrived within 0.303s, which is machine speed. Contact: reserved example domain. Part of one 01:52–03:34 UTC test burst against one profile. | preserves (the conversation and its messages are untouched) |

## What was not done

No CANCEL, ARCHIVE or REQUEUE. No task, status, history, activity, conversation or continuity row was changed.
The queue was not processed, and no model was run.
