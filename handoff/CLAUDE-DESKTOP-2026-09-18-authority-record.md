# Handoff from the Claude desktop session — 2026-09-18

Two Claude Code sessions worked in this repo at the same time (this one, and the Antigravity session doing the router/continuity refactor). This note is so the Antigravity session knows what the desktop session built and does not undo it. The desktop session has stopped editing this repo, and has committed nothing on top of your staged work.

## Committed by the desktop session

| Commit | What |
|---|---|
| 1c469bb | `lib/aeo/geo-probe.ts`: GEO (AI-visibility) evidence via Gemini + Google Search grounding |
| 13d8cda | `lib/aeo/public-check.ts` + `/check`: free public "visible in AI answers?" check (you have since moved it onto `routed-call`, which is fine) |
| d38e195 | `docs/sales/mattress-store-offer.md` |
| a66ad4f | **Authority record**: `lib/authority-ledger.ts`, `lib/authority-routes.ts`, `tools/verify-authority-record.mjs`, `docs/ROADMAP-authority-record.md` |
| 4c154c3 | Results on the record, daily checkpoints, `src/components/AuthorityRecordPanel.tsx` (top of Execution Receipts) |
| 8cdb750 | Gmail sends issue signed receipts (`lib/gmail-send-ledger.ts` → `issueSendReceipt`) |
| 712ebf3 | `lib/authority-report.ts` + `GET /api/authority/report` (monthly owner report) |

## Invariants to keep while refactoring

1. **`recordReceipt()` in `lib/persistence.ts` calls `appendReceiptToLedger()`.** Every receipt must keep going through `recordReceipt`. A new path that inserts into `receipts` directly will be missing from the authority record, and the tests will not catch it.
2. **`lib/fabric/scheduler.ts` drives `authorityTickForScheduler()`** (from `../authority-ledger`) on the one timer. It is local DB work only. Keep that import block if you restructure the tick.
3. **`entryHashOf()` in `lib/authority-ledger.ts` must stay byte-identical** to the copy in `tools/verify-authority-record.mjs`. Changing either without the other invalidates every exported record.
4. `recordReceipt` accepts an optional `approvalId`. Pass it on new EXTERNAL_ACTION paths so the approver is on the record.
5. New EXTERNAL_ACTION capabilities need a signed receipt when they resolve (see `issueSendReceipt` for the pattern: ids and digests only, never message content).

## Tests that cover this

`test/authority-ledger.test.ts` (tamper cases, outcomes, checkpoints, Gmail, report), `test/authority-record-panel.test.tsx`, `test/geo-probe.test.ts`, `test/public-visibility-check.test.ts`.

## Noticed, not fixed

`server.ts` diagnostic step 7 reports "HMAC-SHA256 signature generation"; the signing is Ed25519.
