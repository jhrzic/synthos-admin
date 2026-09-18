# Control-plane hardening — production actions and verification (2026-09-18)

Code: `c51df66` (scheduler initialization order) and `9b9ca99` (drain-and-settle shutdown, artifact purpose and
retrieval, queue review, running version, admin controls). No inference, provider, qualification, discovery or
external call was made.

## Production change (append-only)

| Action | Record |
|---|---|
| `art-1789746122280-3b609948e475` → `ACCEPTANCE_EVIDENCE` (AUDIT_ONLY) | purpose event `apx-1789748826596-7975a8` + activity `ARTIFACT_PURPOSE_CLASSIFIED` |
| Qualification-run artifacts → `QUALIFICATION_EVIDENCE` | **none exist**: qualification cases write no artifact. Their evidence is ledger rows, reviews and receipts |
| `art-1789708243094-5c4747858050` (the earlier OpenAI proof) | unchanged: still QUARANTINED, not in the memory index; found only by an explicit quarantined-evidence search |

## Verified before and after

- **Ledger and provider events:** the ledger holds 14 rows before and after, and provider runtime events number 7
  before and after.
- **Qualification:** `qual-1789743363846-6dbc7d90` is still the only qualification and still evaluates VALID for
  `literal_transformation`. The check made 0 network requests.
- **Model and switches:** `qwen2.5-coder:14b` is still disabled (`enabled = 0`). Paid execution, local execution,
  Antigravity, manual discovery and route refresh are all OFF. General model execution is ON (the default).
- **Legacy tasks:** the fingerprint over the 31 legacy queued tasks, covering their rows, status history and activity,
  is identical before and after (`7c36dac0…`). All 31 are still TODO/READY with `autonomy_eligible = 0`.
- **Acceptance evidence:** the fingerprint over its artifact, review, receipts and ledger rows is identical
  (`0a010506…`). Only the derived memory index changed: 53 entries before, 52 after.
- **Ordinary retrieval:** the acceptance artifact is absent from ordinary search and browse. The authorized evidence
  search finds it, and its hash verifies. `indexVaultArtifact` refuses to re-admit it, and refuses the quarantined
  artifact too.

## Root causes (details in the commit messages)

- **Shutdown orphan.** The drain waited only for HTTP connections, so work the scheduler had started in the background
  was abandoned by `process.exit` and nothing recorded the interruption. Shutdown now enters DRAINING, refuses new
  work, waits a bounded time and settles interrupted work from evidence before it exits.
- **`Cannot access 'health' before initialization`.** Each tick issued a new `import('./orchestrator')`. Across a real
  import cycle, the module runner handed a later tick the module's unfinished exports. Each tick module is now loaded
  once, and every tick awaits that single load.
