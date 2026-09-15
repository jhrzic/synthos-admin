# Ship + Grounding Precision — Evidence Report

**Date:** 2026-09-13 · **Repo:** `synthos-admin` · **Branch:** `fix/p0-jarvis-voice-and-knowledge-mesh`
· **Base SHA:** `8beeb1932493e80bd0e2b805b6686689fcbcd729` · **Nothing committed.**

---

## 1. Production

**Status: `BLOCKED — USER ACTION REQUIRED`. Unchanged from Day 1.**

`SHIPPABLE → SHIPPED` **cannot** move. Nothing in this stage changed that, and no local result
is offered as a substitute.

Checked at the start of this stage, not assumed:

| Precondition | State |
|---|---|
| `.env` | absent |
| `SYNTHOS_DOMAIN` / `SYNTHOS_ACME_EMAIL` / `PUBLIC_BASE_URL` | all unset |
| Docker | **not installed** |
| SSH config / reachable host | none |
| `GEMINI_API_KEY` / `FISH_AUDIO_API_KEY` | unset |

Every required proof — A (runtime on target), B (HTTPS with a valid certificate), C (persistence
across redeploy), D (real external embed), E (end-to-end conversation on the deployed instance) —
requires a host that does not exist. **No local Docker run is offered as proof of public
deployment**, per the explicit instruction.

The host boundary stands as written: persistent disk required. A recreated signing keypair would
invalidate verification continuity for every previously issued receipt, which rules out serverless
regardless of plan.

**Remaining user action:** provision a persistent Linux host, install Docker, point DNS, open 80/443,
set the three variables. Then `docs/deploy/PRODUCTION-DEPLOYMENT.md` §5 lists the three artifacts to
send back that close it.

---

## 2. Grounding precision — `ATTRIBUTE-LEVEL ANSWERABILITY`

### Status: `NOT_IMPLEMENTED → VERIFIED` for the tested surface

Upgraded on direct evidence: **23 of 23 live conversation cases correct across both verticals, in
both directions**, plus 38 unit cases. Scope is stated honestly in §2.7.

### 2.1 Root cause

Two distinct causes, and the first explains why no amount of scoring could have caught it.

**`how` and `much` are stopwords.** `queryTerms("How much is the Carrow Hybrid?")` returns exactly
`["carrow", "hybrid"]`. By the time relevance was computed the question was *literally
indistinguishable* from naming the product. The price was never part of the query, so the retrieval
pipeline could not notice it was missing. **Focus has to be extracted before stopword removal.**

**Retrieval answers "which subject", never "which property".** Concept coverage measured how much of
the question the passage matched, treating every term alike. A passage matching the entity scored
well whether or not it said anything about the attribute asked for.

### 2.2 Implementation

New module `lib/conversation/answerability.ts`, deterministic, no model call — refusal is a safety
property and cannot depend on a credential being present or on anyone's balance.

```
question → split off background/conditional clauses
         → classify focus: QUANTITY | AVAILABILITY | SELECTION | PREDICATE
         → test whether the evidence SUPPORTS that focus
         → answer OR NO_KNOWLEDGE
```

- **QUANTITY** — needs a stated figure **about the thing asked about**. A figure alone is not enough.
- **AVAILABILITY** — needs explicit inventory language.
- **SELECTION** — allocation of a person/resource *to the asker*; needs a stated assignment rule.
- **PREDICATE** — the **head** of the request must be supported, with two exemptions: a term the
  business writes about constantly (it distinguishes nothing, so it is not the question's point), and
  a value whose closed class the evidence already constrains.

**Vertical-neutral by construction.** No product names, no business types, no per-industry attribute
catalogues. What is encoded is language: "how much" asks for a quantity in English regardless of who
is asked. The same code decides for a law firm and a mattress shop, and both are asserted against it.

### 2.3 The placement bug that mattered more than the algorithm

The gate was first added to `answerQuestion()`, where **it did nothing**. The live path is
`answerWithBestAvailableMode()`, which calls `gatherEvidence()` directly and builds its own
extractive reply, reaching `answerQuestion()` only when there is no evidence at all. Two callers,
two copies of the same decision, and the gate sitting in the one customers never reach.

It now sits in `gatherEvidence()` — the single point where retrieval becomes an answer — returning
`[]` so both callers use their existing refusal path and neither learns a new concept.

### 2.4 Files changed

| File | Change |
|---|---|
| `lib/conversation/answerability.ts` | **New.** Focus classification and support tests |
| `lib/conversation/engine.ts` | Gate in `gatherEvidence`; ubiquity exemption when only one substantive concept was asked; shares the light-verb set; general synonyms (`take`/`removal`, `parking`, `documents`) |
| `lib/memory-index.ts` | `workspaceCorpusFingerprint()` — see §2.6 |
| `test/answerability.test.ts` | **New**, 38 cases |
| `test/jarvis-duplicate-submission.test.ts` | One per-test time budget — see §3 |

### 2.5 Live results — rerun against the unchanged knowledge packs

**The knowledge packs were not edited.** The question was whether the engine improved against the
same material.

#### Mattress — previously unsafe

| Question | Before | After | Attribute genuinely supported? | Captured |
|---|---|---|---|---|
| "How much is the Carrow Hybrid in a king size?" | product rows | **`NO_KNOWLEDGE`** | No — no price published | ✅ |
| "Is the Carrow Hybrid Zoned in stock right now?" | product rows | **`NO_KNOWLEDGE`** | No — no inventory data | ✅ |
| "Are you running any discounts this month?" | `NO_KNOWLEDGE` | **`NO_KNOWLEDGE`** | No | ✅ |
| "Can you deliver on Monday?" | grounded | **grounded** | Yes — "Tuesday to Saturday" constrains the week | n/a |

#### Attorney — previously unsafe

| Question | Before | After | Attribute genuinely supported? | Captured |
|---|---|---|---|---|
| "Which attorney would be assigned to me?" | generic attorney doc | **`NO_KNOWLEDGE`** | No — no assignment policy | ✅ |
| "Is there parking at your office?" | privacy policy | **`NO_KNOWLEDGE`** | No | ✅ |
| "How much do you charge for a full probate?" | scope text | **`NO_KNOWLEDGE`** | No — only a consultation fee is published | ✅ |
| "How long will probate take?" | scope text | **grounded** | Yes — the firm publishes that it *cannot* say | n/a |
| "Can I book an appointment for Tuesday?" | `FOLLOW_UP_REQUEST` | **`FOLLOW_UP_REQUEST`** | No calendar; nothing fabricated | n/a |

"How long will probate take?" returns the firm's own published boundary — *"It cannot tell you
whether probate is required in your situation, how long a matter will take…"* That is a real answer
from real material, and better than a refusal.

#### Must still answer — the over-refusal check

All 15 pass: bereavement documents · "How does a consultation work?" · "What happens at the first
meeting?" · death certificate · divorce · consultation cost · video consultation · probate · sleep
hot + back pain · old mattress removal · Monday delivery · comfort trial · latex vs memory foam ·
delivery free · best for side sleepers.

**Total: 23/23 correct.**

### 2.6 Defects introduced by this work, found and fixed

Stated plainly because all three were mine, and all three were found by running rather than reading.

1. **Over-refusal from a vote.** The first PREDICATE rule counted supported vs unsupported terms.
   "Is there parking at your office?" scored 1–1 and passed, answering a parking question with an
   address. Replaced by head-term logic.
2. **Light verbs treated as the subject.** "What happens at the first meeting?" made *happens* the
   subject and refused a document describing exactly that. Same for "how does X work" and "what is
   the difference between A and B". Fixed with a language-level framing-term set.
3. **A real performance regression.** The ubiquity cache loaded every document's full text from
   SQLite *just to compute its own cache key* — on every call, including warm hits. Under ten
   concurrent requests it was the most expensive thing on the conversation path. Fixed with
   `workspaceCorpusFingerprint()`: two SQL aggregates, no document reads.

Also fixed, both pre-existing and both exposed here: a size list ("available in single, double,
king") satisfied an availability check; and a delivery charge ("free within 25 miles") satisfied a
*product* price question.

### 2.7 Remaining false positives / negatives

- **No false negatives** in the 23-case live sweep or the 38 unit cases.
- **No false positives** on the tested attribute classes.
- **Bounded to what was tested.** Coverage is strong for price, stock, assignment and absent-property
  questions in English. Not claimed: non-English phrasing, multi-hop questions ("is the cheaper one
  also cooler?"), or attributes with no linguistic marker.
- **`SELECTION` is narrow on purpose.** It fires on allocation to the asker, not recommendation, so
  "which mattress is best for side sleepers" still answers from the catalogue.
- **A stale-capture artifact, not a defect:** the unresolved-question lists contain questions from
  pre-fix iterations that now answer correctly, because those runs shared one database.

---

## 3. Test port race (Priority 4)

**Not the EADDRINUSE race**, and worth separating. During this stage the recurring failure was
`test/jarvis-duplicate-submission.test.ts` timing out — *ten truly concurrent requests*, each doing a
real Vault write, Aegis verification and Ed25519 signature.

Diagnosis, in order: it passed **5/5 alone**; raising the global timeout changed nothing because the
test carries its **own** explicit `}, 20000)` which overrides global config; my own +41 tests
increased parallel load. Budget raised to 45s on that test.

**A time budget, not an assertion.** Still exactly one execution claim and exactly one artifact.
Loosening the concurrency assertion would have hidden the defect it exists to catch. The global
`testTimeout` was returned to 20s — no blanket loosening.

The original `freePort()` TOCTOU is untouched and remains bounded for a dedicated pass, as instructed.

---

## 4. Verification

| | |
|---|---|
| Tests | **1,395 passed · 84 files** (was 1,354 · 83) |
| Repeated runs | **8 of 8 green** |
| Typecheck | clean |
| Build | exit 0 |
| Repo / branch | `synthos-admin` · `fix/p0-jarvis-voice-and-knowledge-mesh` |
| Base SHA | `8beeb1932493e80bd0e2b805b6686689fcbcd729` |
| Current SHA | **unchanged — nothing committed** |

### Changes in the tree that are NOT mine

Flagged rather than absorbed. These appeared during the session and I did not make them:

- `src/index.css`, `src/components/AirbyteHeader.tsx`, `SidebarNav.tsx`, `WorkspaceTopNav.tsx` — a
  UI restyle (new font tokens, new colour palette, header treatment).
- `package-lock.json` — transitive resolution churn. **`package.json` shows only my `engines` line;
  no new dependency was declared.**

All 8 verification runs include them and pass. Nothing in this stage's work depends on them.

---

## 5. State changes

| Claim | Before | After | Basis |
|---|---|---|---|
| Production | `SHIPPABLE / NOT YET SHIPPED` | **unchanged** | No host exists. Not upgraded |
| Attribute-level answerability | `NOT_IMPLEMENTED` | **`VERIFIED`** for the tested surface | 23/23 live across both verticals + 38 unit cases |

### The demo restriction can now be lifted — with one correction

Price, stock and parking questions **are** now safe to demo: they refuse correctly and are captured
for the owner. The previous instruction to avoid them is withdrawn on this evidence.

Correct the framing when demoing: the strong claim is **"it knows what it doesn't know"**, not "it
answers everything". The refusal *is* the feature.

### Safe external wording

> SynthOS answers only from a business's own published material, and distinguishes between finding
> the right subject and actually having the answer. Asked for a price, stock level or policy the
> business has not published, it refuses and records the gap for the owner rather than returning
> related material as though it answered. Verified across two different businesses running on the
> same binary with no code differences between them.

---

## 6. Stop condition

1. Production — **bounded to an exact user-owned blocker.** ✅
2. Attribute-level answerability — **implemented and tested across both verticals**, no
   vertical-specific branching. ✅
3. Vertical evidence — **rerun against unchanged knowledge packs.** ✅
4. Truth states — **updated above.** ✅

Stopping here. No new stage begun.
