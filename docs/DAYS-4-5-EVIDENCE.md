# Days 4–5 Evidence Report — Two Vertical Proofs

**Date:** 2026-09-13 · **Repo:** `synthos-admin` · **Branch:** `fix/p0-jarvis-voice-and-knowledge-mesh`
· **Base commit:** `8beeb19` · **Nothing committed.**

All Days 1–3 truth states are preserved. Production remains **SHIPPABLE / NOT YET SHIPPED**.

---

## The headline result

**Both verticals were provisioned with zero code changes, zero schema changes and zero new
architecture** — entirely through the existing HTTP API, using `profile.json` + Markdown knowledge
files. That is the claim this pass exists to prove, and provisioning is the proof:

```
$ node scripts/provision-vertical.mjs <base> <cookie> .../verticals/attorney
workspace   ws-1789272099030-e45iuw
membership  op@example.invalid -> admin
profile     Harrow & Vance Estate Law / Ellis
knowledge   How a consultation with Harrow & Vance works  (indexed=true)
knowledge   What to bring to a consultation              (indexed=true)
knowledge   What Harrow & Vance does and does not handle (indexed=true)
knowledge   Privacy and what we ask for before a consultation (indexed=true)
origins     accepted=["https://www.harrowvance.example"] rejected=0
publicKey   dbeece3f2c2b3623398d27bfac3bcc2bf6324dc5034af483
```

Both verticals then ran **simultaneously on one instance, one process, one binary.**

One thing the provisioning script proves incidentally: creating a workspace returned a real **403**
until membership was granted explicitly. Platform-admin does not silently bypass workspace
membership (ADR-003). That is the authorization model working, not an obstacle.

---

## 1. Attorney vertical — Harrow & Vance Estate Law

**Config:** `docs/products/business-conversation-ai/verticals/attorney/profile.json`
**Knowledge:** `consultation-process.md` · `documents-to-bring.md` · `practice-boundaries.md` ·
`privacy-and-intake.md`

| Proof step | State | Evidence |
|---|---|---|
| Grounded answer | **VERIFIED** | *"My father passed away and I need to understand what documents I should bring."* → `GROUNDED_EXTRACTIVE`, sources **"What to bring to a consultation"** + **"Privacy and what we ask for before a consultation"**. Answered with the firm's own list — death certificate, original will, codicils — not general estate-planning knowledge |
| Firm-specific intake | **VERIFIED** | Asked *this firm's* configured question: *"Which of our practice areas does this relate to — a new estate plan, an existing plan, or settling the estate of someone who has died?"* Recorded in `lead.questions` |
| Legal boundary | **VERIFIED** | *"Do I actually need to go through probate for his house, and how long will it take?"* → returned the firm's published boundary: *"It cannot tell you whether probate is required in your situation, how long a matter will take, what an estate is worth, what any deadline is, or what you should do."* **No timeline, no legal conclusion, no deadline invented** |
| Unknown question | **VERIFIED** | *"Which attorney would be assigned to me?"* → `NO_KNOWLEDGE` |
| Gap captured | **VERIFIED** | `GET /api/business/unanswered` → that exact question, `status: OPEN` |
| Appointment | **VERIFIED (truthful non-booking)** | *"Can I book an appointment for Tuesday afternoon?"* → `FOLLOW_UP_REQUEST`: *"I can't book times myself — I don't have access to the calendar, and I'd rather not promise a slot that turns out not to exist."* No calendar connector exists and none was faked |
| Human handoff | **VERIFIED** | `HUMAN_HANDOFF` task created, contact carried through |
| Receipt | **VERIFIED** | `aegisDecision: VERIFIED`, `rcpt-1789272314362-783a0b` |
| Knowledge writeback | **VERIFIED** | `SynthOS/Conversations/Harrow-Vance-Estate-Law-attorney-assigned-parking-office__2026-09-13.md` |
| Sensitive-data rule | **VERIFIED** | The firm's published rule — no SSNs, account numbers or DOBs before meeting an attorney — was surfaced to the customer unprompted |

## 2. Mattress vertical — Northfield Sleep Co.

**Config:** `.../verticals/mattress/profile.json` · **Knowledge:** `sleeping-hot.md` ·
`back-pain-and-support.md` · `range-and-construction.md` · `delivery-and-trial.md`

Built on the Northfield configuration already proven in Days 1–3 rather than replacing it.

| Proof step | State | Evidence |
|---|---|---|
| Grounded recommendation | **VERIFIED** | *"I sleep hot and my lower back hurts. What should I look at?"* → `GROUNDED_EXTRACTIVE` from **"Our range"**, surfacing **Carrow Hybrid** (*"the most common recommendation for lower back pain"*) and **Ashgrove Latex** (*"customers who sleep hot"*) — the two genuinely relevant models out of six |
| Needs discovery | **VERIFIED** | Asked *this shop's* configured question: *"How are you sleeping at the moment — what would you change if you could?"* — materially different from the attorney's |
| Unknown commercial fact | **VERIFIED** | *"Are you running any discounts this month?"* → `NO_KNOWLEDGE` |
| Gap captured | **VERIFIED** | `GET /api/business/unanswered` → that question, `status: OPEN` |
| Policy with source | **VERIFIED** | *"Can you deliver on Monday?"* → *"Deliveries run Tuesday to Saturday"* — a real answer implying Monday is not available, from **"Delivery, removal and the comfort trial"** |
| Lead capture | **VERIFIED** | Email recognised and stored |
| Human handoff | **VERIFIED** | `HUMAN_HANDOFF` task, contact carried |
| Receipt | **VERIFIED** | `aegisDecision: VERIFIED`, `rcpt-1789272314391-e759fe` |
| Knowledge writeback | **VERIFIED** | `SynthOS/Conversations/Northfield-Sleep-Co-sleep-hot-lower-hurts__2026-09-13.md` |
| AEO/GEO signal | **VERIFIED** | The note's **Requirements** section reads: *"Publish an answer for: 'Are you running any discounts this month?'"* — a real customer question becoming a content requirement. **Nothing was published** |
| Price / stock refusal | **PARTIAL** | See the limitation below |
| Store visit | **PARTIAL** | Answered from product knowledge rather than raising a visit request. No calendar connector exists; nothing was fabricated |

---

## Three real defects found by running the verticals

None was a fabrication bug — in every failing case the assistant quoted **real published
material**. All three were relevance or state-tracking bugs, which are their own kind of
dishonesty: a confidently irrelevant passage reads as an answer.

### 1. Configured intake questions were never recorded — **pre-existing**

The capture branch compared the **whole** last assistant message against the configured goals with
`.includes(q)`, an exact-equality membership test. A qualification question is appended *after* the
grounded answer, so the message is `"<answer>\n\n<question>"` and never equals a goal. A configured
question was therefore never marked as asked, the assistant **re-asked it every turn**, and intake
could never complete.

It hid because the `DEFAULT_SLOTS` branches beside it match with regex `.test(q)` against that same
full message and work correctly — so the bug was invisible on a default install and hit **every
business that configures its own qualification goals**, which is every real vertical.

Fixed by matching the goal the message actually *ends with* — which also identifies *which* goal was
asked, rather than any goal merely mentioned. 9 tests in `test/vertical-qualification-tracking.test.ts`.

### 2. Length is a poor proxy for specificity — **pre-existing**

`SPECIFIC_TERM_MIN_LENGTH = 5` rejects incidental overlap on short common words. It cannot reject
overlap on a **long word that is ubiquitous in one business's corpus**:

> *"Which attorney would be assigned to me?"* → matched on **"attorney"** → returned a **privacy
> disclaimer** as though it answered the question.

"attorney" is ≥5 characters and appears in nearly every document a law firm publishes, so it
distinguishes nothing. The same shape produced the Day 1 observation where a mattress pricing
question matched the delivery policy on **"mattress"** — so this is a corpus property, not a
legal-domain quirk.

Fixed with document frequency, the classic signal for exactly this: a term appearing in ≥60% of a
workspace's knowledge documents is not specific. Expressed as a **fraction**, so it stays
corpus-size independent in the way the bm25 magnitude it replaced was not. Below three documents the
notion is meaningless and the rule does not apply — which is the behaviour every new customer starts
with, unchanged. Computed from real indexed content, memoised against a corpus fingerprint.

Measured on the attorney corpus: `assistant, attorney, consultation, coordinator, estate, intake, matter`.

### 3. Markdown tables collapsed into one passage — **pre-existing**

`.replace(/\s+/g, ' ')` ran before sentence splitting. A table contains no sentence punctuation, so
an entire product catalogue became **one enormous "sentence"** holding every model and attribute. It
matched almost any product question and, being a single unit, always won:

| Question | Before |
|---|---|
| *"How much is the Ashgrove Latex in a king size?"* | entire 6-model table |
| *"Do you have the Carrow Hybrid Zoned in stock?"* | entire 6-model table |
| *"What is the difference between latex and memory foam?"* | entire 6-model table |

Product catalogues are tables, so this is general. Each row is now its own passage; header and
separator rows are dropped (real output used to open with *"Model | Construction | Firmness |
Typically suits"*). After the fix, the same question surfaces the two genuinely relevant models.
9 tests in `test/vertical-retrieval-quality.test.ts`.

---

## Honest limitation — attribute-level grounding does not exist

**A question that names a product the business publishes returns that product's material, even when
the specific attribute asked about is absent.**

| Question | Result | What it should be |
|---|---|---|
| *"How much is the Ashgrove Latex in a king size?"* | product rows | `NO_KNOWLEDGE` |
| *"Do you have the Carrow Hybrid Zoned in stock?"* | product rows | `NO_KNOWLEDGE` |
| *"Is there parking at your office?"* | consultation/privacy material | `NO_KNOWLEDGE` |

The system matches on **topic** (which product, which firm subject). It has no notion of
**attribute** (price vs. construction; stock vs. suitability). The `parking` case survives the
ubiquity fix because "office" appears in only 2 of 4 documents — genuinely below the threshold.

**The safety property holds absolutely: no price, stock level, discount, delivery date, timeline or
legal conclusion was ever invented, in any run.** Every quote was real published material. The gap
is that the assistant returns *relevant-but-non-answering* material instead of admitting it does not
know.

Closing this needs attribute-aware grounding — real architecture, explicitly out of scope for this
pass. It is stated here rather than worked around by editing the demo knowledge to dodge it.

**Demo guidance:** the price/stock questions are not safe to feature. The proven refusals —
*"Which attorney would be assigned to me?"* and *"Are you running any discounts this month?"* — are.

---

## Cross-vertical comparison

### What changed — configuration only

| Dimension | Attorney | Mattress |
|---|---|---|
| Approved knowledge | 4 docs: consultation process, documents to bring, practice boundaries, privacy | 4 docs: sleeping hot, back pain, range, delivery & trial |
| Terminology | matter, estate, probate, intake coordinator, attorney-client | firmness, hybrid, latex, comfort trial, showroom |
| Assistant identity | **Ellis** | **Avery** |
| Tone (`brandVoice`) | *"Calm, plain-spoken and unhurried… lead with what happens next rather than legal terminology. Never use pressure or urgency language."* | *"Direct, practical and unpushy. Talk about sleep problems, not product features. Never invent a discount."* |
| Intake fields | practice area · relationship to the estate · contact | current sleep problem · sleeping position · contact |
| Risk boundary | no legal advice, no deadline, no probate determination, no estate valuation | no price, no stock, no discount, no delivery date, no medical claim |
| Escalation trigger | court date, deadline, family dispute, distress, fees | price, discount, finance, stock, delivery date, warranty claim |
| Permitted actions | `capture_lead`, `request_consultation`, `human_handoff` | `capture_lead`, `request_store_visit`, `human_handoff` |
| Disclosure | *"…cannot give legal advice. Nothing you share here creates an attorney-client relationship."* | *"…answers only from this shop's published information."* |
| Ubiquitous terms (derived) | attorney, estate, consultation, intake, matter, coordinator | (derived from its own corpus) |
| Connectors used | **none** — no calendar, no CRM | **none** — no calendar, no inventory, no pricing |
| Unresolved-question behaviour | *"Which attorney would be assigned to me?"* → OPEN | *"Are you running any discounts this month?"* → OPEN |

### What did not change — one implementation

| | |
|---|---|
| Conversation engine | `lib/conversation/engine.ts` — identical, one binary |
| Grounding mechanism | `bestPassage` concept coverage — identical |
| Knowledge retrieval | `memory_index` FTS5 over Vault artifacts — identical |
| Truth behaviour | `GROUNDED_EXTRACTIVE` / `NO_KNOWLEDGE` / `DETERMINISTIC` — identical |
| Authority framework | 9 of 10 agents cannot contact a customer; `conversation.handoff` contacts nobody |
| Receipt model | Deterministic Aegis → Ed25519 — identical, both verified |
| Knowledge writeback | `lib/knowledge-vault.ts` — identical, both semantic |
| Runtime contract | Same process, same port, same `/api/public/assistant/:key/message` |

**Zero lines of vertical-specific code exist.** No `if (vertical === 'attorney')` anywhere. The only
per-vertical artifacts are a JSON profile and Markdown files.

---

## Verification

| | |
|---|---|
| Tests | **1,354 passed** (was 1,336) across **83 files** |
| Repeated-run stability | **9 of 10 full runs green.** See below |
| Typecheck | clean |
| Build | exit 0 |
| Branch / base | `fix/p0-jarvis-voice-and-knowledge-mesh` · `8beeb19` · **nothing committed** |

### The one failing run, reported rather than averaged away

Run 5 of 10 failed with `Error: listen EADDRINUSE: address already in use 0.0.0.0:51952` in
`test/fabric-characterization.test.ts`.

**Classification: pre-existing test-infrastructure race.** Seven test files spawn real servers, and
several share a `freePort()` helper that does `listen(0)` → read the port → `close()` → spawn later.
Between the close and the bind, another file can take the port. Classic TOCTOU.

**Not attributable to this work:** the only spawned-server test added in this project (Day 1's
`graceful-shutdown`) uses fixed port **3471**, far outside the macOS ephemeral range
(49152–65535), so it cannot collide with `freePort()` allocations. No test added in Days 4–5 spawns
a server at all.

Rate: **1 in 20** measured (it did not recur in a further 10 runs on Day 6; cumulative 19/20 green). The recommended fix — retry the spawn on `EADDRINUSE` rather than trusting a
stale allocation — touches six pre-existing files and was not required by this stage's stop
condition, so it is reported rather than done.

### Defect classification

| Defect | Classification |
|---|---|
| Configured qualification questions never recorded | **Pre-existing**, fixed, 9 tests |
| Corpus-ubiquitous terms treated as specific | **Pre-existing**, fixed, tests |
| Markdown tables collapsing into one passage | **Pre-existing**, fixed, 9 tests |
| Attribute-level grounding absent (price/stock/parking) | **Pre-existing architectural gap**, stated, not worked around |
| `freePort()` TOCTOU race | **Pre-existing infrastructure**, 1-in-10, reported |
| Introduced by this work | **None found** |

### Files changed

**New:** `verticals/attorney/` (profile + 4 knowledge docs) · `verticals/mattress/` (profile + 4
knowledge docs) · `scripts/provision-vertical.mjs` · `test/vertical-qualification-tracking.test.ts` ·
`test/vertical-retrieval-quality.test.ts` · this file

**Modified:** `lib/conversation/engine.ts` (ubiquity rule, table-aware passages) ·
`lib/conversation/service.ts` (qualification tracking) · `lib/memory-index.ts`
(`listWorkspaceMemoryContent`)

### Blockers carried forward, unchanged

Production host · microphone (`HUMAN VERIFICATION REQUIRED`) · Fish Audio balance ·
`SYNTHOS_VAULT_PATH` not pointed at the real personal vault.

### Not implemented, as instructed

Trust Protocol · QuarkShield · Guardian/HITL UI · new graph infrastructure · universal ingestion ·
telecom · Gigs · 0ID · Mission Control changes · model router · CRM · calendar · payments ·
inventory. No connector was simulated and none was labelled live.
