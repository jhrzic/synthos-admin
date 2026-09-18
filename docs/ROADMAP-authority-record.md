# Roadmap: the authority record

*2026-09-18. Why this exists: the defensible asset is not memory (every lab is building memory) but an accumulated, independently verifiable record of **who authorized what an agent did, and what happened**, per person and per business. It cannot be backfilled by a competitor, a single model vendor cannot credibly be its neutral keeper, and its value rises as liability rules around agents tighten. Status tags: **Built** (code + tests in this repo), **Planned**, **Later**.*

## Phase 0 — Tamper-evident record · **Built** (this commit)

- `lib/authority-ledger.ts`: every receipt recorded through `recordReceipt()` is appended to a per-workspace hash chain that binds the receipt digest to the approval behind it (approval id, requester, decider, Guardian verdict, bound input digest, self-approved flag). Deleting, editing, reordering or truncating is detectable.
- Signed checkpoints (`signCheckpoint`) pin the chain head with the existing Ed25519 key.
- `tools/verify-authority-record.mjs`: zero-dependency offline verifier. Trusts nothing but a public key the customer pins.
- API: `GET /api/authority/record`, `GET /api/authority/audit`, `POST /api/authority/checkpoint` (verified workspace membership / admin).
- Old receipts: `backfillLedger()` chains them once; the signed receipt format is unchanged.
- Tests: `test/authority-ledger.test.ts` tampers every way and asserts both the server audit and the offline tool catch it.

**Known limits, stated plainly:**
- Authority is attached where an approval row exists. Actions that ran with no approval are recorded as "no approval on record", which is the truth, not a gap to hide.
- The operator holds the signing key. Checkpoints only protect against tampering *after* the customer received them. Phase 2 removes that trust.

## Phase 1 — Make it visible and routine · Planned (1–2 weeks)

1. **Daily checkpoint job** per active workspace, emailed or downloadable, so every customer holds recent signed heads.
2. **"Authority record" panel** in Admin: actions, % with human approval, self-approvals, open problems from `auditWorkspace`, one-click export. Reuses the existing receipts UX (Product Preservation rule applies).
3. **Outcome events**: attach later outcomes (sale closed, email replied, refund) to the original receipt as new chained entries. This is what turns the record from "what happened" into "what worked", the input the Brain needs.
4. **Receipts on every consequential path**: audit which EXTERNAL_ACTION paths still finish without `recordReceipt` and close them.

## Phase 2 — Remove trust in SynthOS · Planned (3–6 weeks)

5. **Public anchoring** of checkpoint hashes (e.g. a transparency log or a public timestamping service) so even SynthOS cannot rewrite history unnoticed.
6. **Customer-held keys**: the business co-signs its checkpoints; key rotation recorded in the chain.
7. **Approval signatures from the human**: the approver signs the approval itself (passkey/WebAuthn), so "who authorized" is a signature, not a database column.

## Phase 3 — The record travels · Later

8. **Delegation credentials**: an agent presents a verifiable statement of what it is allowed to do, derived from the record (the Trust Protocol's first real primitive).
9. **Counterparty verification**: a merchant, bank or platform checks an agent's authority and history before accepting an action.
10. Only then: cross-customer learning (KIL) over the structure of verified outcomes.

## How this maps to revenue now

- **Local businesses (Showroom Advisor, audits):** every lead captured, visit booked and review response approved lands in the record. The monthly report is an export of it: "here is exactly what your assistant did and who approved it."
- **Regulated buyers:** the export plus the offline verifier is the procurement answer to "prove what your agents did."
- **Consumers (Rengain):** "your agent, not your identity": the user can see and export every action taken on their behalf.

## What not to claim yet

"Blockchain", "zero-knowledge", "immutable" (the operator can still delete; deletion is *detectable*, not *impossible*), "compliance-certified", "Trust Protocol live".
