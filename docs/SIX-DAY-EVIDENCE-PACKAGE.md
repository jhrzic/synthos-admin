# SynthOS — Six-Day Stage Evidence Package

**Date:** 2026-09-13 · **Repo:** `synthos-admin` · **Branch:** `fix/p0-jarvis-voice-and-knowledge-mesh`
· **Base SHA:** `8beeb1932493e80bd0e2b805b6686689fcbcd729` · **Nothing committed.**

Supporting detail: `docs/EVIDENCE-CLEANUP-2026-09-12.md` (baseline) ·
`docs/deploy/PRODUCTION-DEPLOYMENT.md` (Day 1) · `docs/DAYS-2-3-EVIDENCE.md` ·
`docs/DAYS-4-5-EVIDENCE.md`.

> **Two corrections to figures used earlier in this stage**, made here rather than carried forward:
> the suite is **83 test files**, not the 85 stated in the Days 4–5 report; and the test-port race
> measured **1 in 20**, not 1 in 10 — it did not recur in a further 10 runs. Both corrected at
> source.

---

## 1. Executive evidence summary

- **Two businesses, one binary.** An estate-planning firm and a mattress retailer ran
  simultaneously on one instance, in one process, from one build — with **zero code changes, zero
  schema changes and zero new architecture** between them. No vertical-specific branching exists.
- **Configuration, not engineering.** Each vertical is one `profile.json` plus four Markdown files,
  provisioned through the existing HTTP API. That is the product thesis demonstrated rather than
  asserted — **for these two verticals**, which is as far as the evidence goes.
- **Receipts are real cryptography.** An Ed25519 signature was verified **independently of the
  application**: `true` on the genuine payload, **`false`** on a one-word tamper.
- **Refusal works.** Unpublished facts return `NO_KNOWLEDGE` rather than invention — proven in both
  verticals ("Which attorney would be assigned to me?", "Are you running any discounts this month?").
- **Nothing was ever fabricated.** Across every run in six days, no price, stock level, discount,
  delivery date, legal timeline or legal conclusion was invented. Every quote was real published
  material.
- **Grounded answers cite real sources.** The bereavement scenario answered from the firm's own
  documents, citing two of them by title.
- **Unanswered questions become owner work.** Each gap is captured `OPEN` and appears in the
  knowledge note as a publishing requirement. **Nothing is auto-published.**
- **Authorization holds under test.** Creating a workspace returned a real **403** until membership
  was granted explicitly — platform-admin does not silently bypass workspace membership.
- **Obsidian integration now exists.** `SYNTHOS_VAULT_PATH` targets a real external vault; SynthOS
  writes only inside a bounded `SynthOS/` subtree and provably never touched pre-existing notes.
- **Voice configuration has one source of truth.** Provider selection moved out of browser
  `localStorage` into server state; dashboard and runtime now read the same resolver.
- **Four pre-existing defects were found by building real things**, not by reading code: an embed
  variable that was declared nowhere, a backup listing that crashed on a vanished file, intake
  questions that re-asked forever, and product catalogues that answered every question identically.
- **One limitation is stated rather than hidden:** attribute-level answerability is not implemented.
- **Production is shippable, not shipped.** No host exists. That is a user-action blocker, unchanged.
- **1,354 tests pass across 83 files**, typecheck and build clean, **19 of 20 repeated runs green** —
  one pre-existing test-port race. Not "fully stable".

---

## 2. Claim ledger

| # | Claim | Previous | Current | Evidence | Limitation | Safe external wording |
|---|---|---|---|---|---|---|
| 1 | Business Conversation AI production-ready | `YES` (overstated) | **YES, CONDITIONAL** | Full first-customer path proven end-to-end on a production build; HTTPS host is a precondition, not a parallel task | No host exists | "Ready to deploy; not yet deployed." |
| 2 | External HTTPS deployment | No config existed | **BLOCKED — USER ACTION** | `docker-compose.prod.yml` + `Caddyfile.prod`; app unpublished to host so TLS cannot be bypassed. Docker absent here, so **UNVERIFIED at runtime** | Needs host, DNS, ports 80/443 | "Deployment configuration is written and reviewed; it has not been run on a live host." |
| 3 | Grounded responses | Claimed | **VERIFIED** | Attorney: 2 sources cited. Mattress: correct 2 of 6 models surfaced | Attribute gap (#25) | "Answers come from the business's own published material, with sources shown." |
| 4 | `NO_KNOWLEDGE` refusal | Claimed | **VERIFIED** | Both verticals; no fabricated value in any run | Does not fire for every unanswerable case (#25) | "It refuses rather than inventing facts the business has not published." |
| 5 | Unresolved-question capture | Claimed | **VERIFIED** | `status: OPEN` in both workspaces; appears as a publishing requirement in the knowledge note | Manual to action | "Every question it could not answer is captured for the owner." |
| 6 | Origin / domain enforcement | Claimed | **VERIFIED** | `https://…` accepted; `http://insecure.example` **rejected with a reason** | Exact-origin only, by design | "Only websites the business authorises can embed it, and insecure origins are refused." |
| 7 | Aegis verification | Claimed | **VERIFIED** | Deterministic checks over real rows → `VERIFIED`; receipts in both verticals | Deterministic, not semantic | "Every committed result is verified before it is signed." |
| 8 | Ed25519 tamper-evidence | Claimed | **VERIFIED (independently)** | 64-byte signature; `crypto.verify` → `true` genuine, **`false`** on one-word tamper — checked outside the app | Key lives in process env, not an HSM | "Results are cryptographically signed, and any alteration is detectable." |
| 9 | Knowledge vault integration | **NOT INTEGRATED** | **LIVE (one source)** | `SYNTHOS_VAULT_PATH`; semantic notes with receipt + artifact provenance; 5 proofs incl. restart and degraded paths | Real ~1,204-note vault not targeted — user's decision | "Conversations become searchable Markdown knowledge in the customer's own vault." |
| 10 | Universal ingestion | Implied | **NOT IMPLEMENTED** | Source matrix: web conversation LIVE; Jarvis/graph/scheduler/Windmill `NOT_CONNECTED`; Hermes `BLOCKED`; watcher `NOT_IMPLEMENTED` | — | "One source is connected today. Universal ingestion is not built." |
| 11 | Voice configuration truth | Mismatched | **VERIFIED** | Provider moved from browser `localStorage` to server; same resolver serves dashboard and runtime; persisted across restart | — | "One server-side source of truth; the dashboard shows what the runtime will actually do." |
| 12 | Fish Audio provider path | "Working" | **PARTIAL — proven to the provider boundary** | Real call with configured model + voice → **`401 Invalid Token`** for a deliberately fake key, reported honestly | No successful paid synthesis; balance exhausted | "The path reaches the provider and reports real results. A successful paid synthesis needs account credit." |
| 13 | Microphone path | "Wired" | **HUMAN VERIFICATION REQUIRED** | OS permission prompt is outside the DOM, and nothing here can produce speech | — | "Voice input is implemented; end-to-end capture needs a person to verify." |
| 14 | Attorney vertical | Did not exist | **VERIFIED** | Grounded bereavement answer, firm-specific intake, no invented probate timeline, truthful non-booking, `HUMAN_HANDOFF`, receipt, semantic note | No calendar connector | "Firm-specific grounded intake and safe handoff, without inventing legal conclusions or calendar availability." |
| 15 | Mattress vertical | Partially proven | **VERIFIED** | Correct models surfaced, delivery answered from real policy, discount refused, gap captured, receipt, semantic note | Price/stock (#25) | "Business-specific product guidance grounded in the retailer's own material, with safe refusal of unsupported commercial claims." |
| 16 | Same product, different business | Asserted | **VERIFIED (two verticals)** | One instance, one process, one binary; zero code/schema changes; no `if (vertical === …)` anywhere | Proven for two verticals only | "The same Concierge behaves like two different businesses purely from approved knowledge and configuration." |
| 17 | Workspace authorization | Claimed | **VERIFIED** | Real **403** until membership granted explicitly | — | "Platform-admin status does not silently grant access to a customer workspace." |
| 18 | Guardian | Overstated historically | **PARTIAL, narrow** | Real: deterministic command gate + enforced `EXTERNAL_ACTION` eligibility the scheduler imports rather than copies. Absent: policy store, approval queue, HITL UI | — | "Guardian is the authority-boundary layer. Today it enforces execution eligibility and a command gate; the policy and human-approval surfaces are not built." |
| 19 | KIL | Claimed | **VERIFIED as shipped** | `C(K) = V(K)·[wE·E(K) + wF·F(K)]`, hard containment gate, promotion at C≥0.85 **and** E≥0.90 | Spec's decay, simulation gate and human-review multiplier **not** implemented — stated in the code itself | "KIL's containment and calibration scoring is implemented; three specified terms are deliberately not yet built." |
| 20 | Trust Protocol | Positioned as a layer | **NOT IMPLEMENTED** | Zero hits in every repo; no smart contract of any kind exists | — | "Strategic network layer. Not implemented." |
| 21 | QuarkShield | Positioned as a layer | **NOT IMPLEMENTED** | Zero hits; a PRD and web pages exist outside any repo | — | "Planned crypto-agility/security layer. Not implemented." |
| 22 | Gotham | Ambiguous | **Prior consulting revenue, pre-SynthOS** | Two real invoices, $4,575 + $4,650 (May 2025), for GA4/SEO/social/Monday.com work. No SynthOS product on either | Payment not confirmed | "A prior paid consulting engagement from 2025. Not SynthOS product revenue and not a SynthOS customer." |
| 23 | Test count | "2,757/2,757" (wrong repo + stale) | **1,354 / 83 files** in `synthos-admin` | Fresh runs today | Mission Control is a different repo and is **currently red** (3 failures) | "1,354 tests passing in the Concierge repo." |
| 24 | Test stability | "all tests pass" | **19/20 repeated runs** | One `EADDRINUSE` from a pre-existing `freePort()` TOCTOU shared by spawned-server tests | — | "1,354 tests passing; repeated-run stability 19/20 due to one known pre-existing test-port race." |
| 25 | Attribute-level answerability | Not previously identified | **NOT IMPLEMENTED** | Price / stock / parking return related source material instead of `NO_KNOWLEDGE` | Safety holds — the value is never invented | "SynthOS refuses to fabricate unsupported facts, but attribute-level answerability detection is still being tightened for cases where relevant source material exists without the requested attribute." |

---

## 3. Investor-ready proof, ranked by strength of evidence

Ranked by what is *provable today*. No speculative layer appears above an implemented one.

1. **Cryptographic receipts (Aegis + Ed25519).** The strongest claim in the system and the hardest
   to imitate. Verified outside the application: genuine payload `true`, one-word tamper `false`.
   Deterministic verification means it costs approximately nothing, which is what makes "nothing
   commits unverified" a rule rather than an aspiration.
2. **One binary, two businesses.** Two verticals on one instance with zero code or schema changes.
   The engineering claim competitors cannot answer by adding a feature — they would have to not have
   built two products.
3. **Grounded answers plus refusal.** Real sources cited; unpublished facts refused. Across six days
   of adversarial questioning, nothing was fabricated.
4. **Semantic knowledge writeback.** Conversations become findable Markdown in the customer's own
   vault, carrying receipt and artifact provenance — searchable by subject, not by timestamp.
5. **Authority and workspace isolation.** A real 403 where a lesser system would have leaked:
   platform-admin does not bypass workspace membership.
6. **Voice configuration truth.** One server-side source; dashboard and runtime read the same
   resolver; the provider path reaches the real provider and reports real failures.

---

## 4. Demo-safe claims

Short, concrete, and each backed by a row in §2.

- "The same product runs both of these businesses. No code differs between them."
- "It answers only from this business's own published material, and it shows you the source."
- "Ask it something they haven't published and it refuses rather than inventing an answer."
- "Every question it couldn't answer is captured for the owner to publish."
- "It can't book anything — there's no calendar connected — so it raises a request for a person and
  says so."
- "Every committed result is verified and cryptographically signed. Change one word and the
  signature fails."
- "The conversation becomes a searchable note in the business's own Obsidian vault, named by subject."
- "Only websites the business authorises can embed it."
- "Nine of the ten core agents cannot contact a customer under any configuration."

**Demo scripting note:** use the two proven refusals — *"Which attorney would be assigned to me?"*
and *"Are you running any discounts this month?"* **Do not** feature price, stock or "is there
parking" questions; they return relevant-but-non-answering material (§2 #25).

---

## 5. Claims that are NOT safe yet

Say none of these:

- ❌ "We have a customer in production" — **no host is deployed at all.**
- ❌ "Universal ingestion" / "it remembers everything across every runtime" — **one source is connected.**
- ❌ "All-runtime memory" — Jarvis, graph, scheduler and Windmill are `NOT_CONNECTED`; Hermes is `BLOCKED`.
- ❌ "It always knows when it doesn't know" — attribute-level answerability is **not solved**.
- ❌ "Voice works end to end" — the provider path returns **401** on the current credential.
- ❌ "Microphone verified" — **HUMAN VERIFICATION REQUIRED.**
- ❌ "Guardian enforces policy with human approval" — no policy store, no approval queue, no HITL UI.
- ❌ "Trust Protocol" as a thing that exists — **NOT IMPLEMENTED.**
- ❌ "QuarkShield" as a thing that exists — **NOT IMPLEMENTED.**
- ❌ "Gotham is a SynthOS customer" or any SynthOS revenue figure — **pre-SynthOS consulting.**
- ❌ "The test suite is fully stable" — it is **19/20**.
- ❌ Any Mission Control test figure — that repo is currently **red**.
- ❌ "Multi-model" — one provider (Gemini) executes text generation.

---

## 6. Remaining blockers

### User-action blockers — nothing proceeds without these

| Blocker | Why it is yours |
|---|---|
| Provision a host with a persistent disk ($6–12/mo VPS is enough), install Docker | Account + payment. SQLite-WAL, vault files and the signing keypair need real disk — a new keypair makes every prior receipt unverifiable, which rules out serverless regardless of plan |
| Point DNS; open ports 80/443 for ACME | Domain control |
| Set `SYNTHOS_DOMAIN`, `SYNTHOS_ACME_EMAIL`, `PUBLIC_BASE_URL` | Depends on the above |
| Fish Audio balance | Turns the proven 401 into a 200 |
| Microphone verification (6-step procedure in `DAYS-2-3-EVIDENCE.md`) | Needs a person who can speak |
| Decide whether `SYNTHOS_VAULT_PATH` targets the real ~1,204-note vault | Your personal data |
| *(optional)* `GEMINI_API_KEY` | Without it answers are accurate quotes rather than conversational phrasing |

### Engineering backlog — ours, not yet done

| Item | Note |
|---|---|
| Attribute-level answerability | The one limitation that affects demo quality |
| `freePort()` TOCTOU in spawned-server tests | 1-in-20; touches six pre-existing files |
| Docker image never built | No Docker here; build once on the host |
| Mission Control's red `/api/public` token guard | Different repo; bounded and documented, deliberately not allowed to consume this sprint |
| Ingestion for Jarvis / graph / scheduler / Windmill | Each `NOT_CONNECTED` today |
| Vault filesystem watcher | `NOT_IMPLEMENTED` |
| Guardian policy store + approval queue | Would make the narrow implementation match the broad name |

### Planned strategic layers — architecture, not backlog

These stay in the thesis. They are **not** work items for this stage and must never be presented as
implemented.

| Layer | Status |
|---|---|
| **Brain** — the asset | Partially realised: knowledge vault + memory index are live for one source |
| **KIL** — admission / shared intelligence | Implemented as shipped; three specified terms deliberately unbuilt |
| **Guardian** — authority boundary | Concept stands; implementation is narrow and described as such |
| **Execution Fabric + Aegis/Receipts** — action and evidence | **Implemented and the strongest proof in the system** |
| **Trust Protocol** — network layer | `NOT_IMPLEMENTED` |
| **QuarkShield** — crypto-agility beneath trust | `NOT_IMPLEMENTED` |
| **Concierge / Personal / Mobile** — products and distribution | Concierge web is real; Personal and Mobile do not exist |

---

## 7. Six-day stage delta

What actually moved, and it is implementation rather than documentation:

| Claim | Before the stage | After |
|---|---|---|
| Obsidian / vault integration | **NOT INTEGRATED** — no path variable, no watcher, no reader | **LIVE for one source**, with 5 proofs including restart and degraded paths |
| `PUBLIC_BASE_URL` | Read by code, **declared nowhere** — invisible to every status surface | Declared, validated, reported at startup in all four field configurations |
| Env declaration completeness | Claimed complete; **false for 18 variables** incl. 5 secrets | True, and a drift guard fails the build on the next omission |
| Graceful shutdown | **Absent** — SIGTERM cut in-flight requests, WAL stranded | Ordered drain + WAL checkpoint, proven on a real process |
| `listBackups()` | Crashed the whole listing if one archive vanished | Skips it; regression test proven to fail without the fix |
| Voice provider selection | Browser `localStorage`, per-browser, invisible to the server | Server-side single source; dashboard and runtime agree |
| Voice id | Read from **two** localStorage stores, silently overriding the server | Server resolves; hardcoded fallback removed |
| Configured intake questions | Re-asked **forever** for any business with custom goals | Recorded correctly; 9 tests |
| Corpus-ubiquitous terms | "attorney" counted as specific → irrelevant answers | Document-frequency rule; `NO_KNOWLEDGE` now fires |
| Product catalogues | Whole table returned for **every** product question | Row-level passages; relevant models surfaced |
| Vertical proof | None | **Two verticals, one binary, zero code changes** |
| Deployment config | HTTP on :3000 only | HTTPS compose + Caddy, app unpublished to host |
| Test count | 1,268 | **1,354** (+86), with the truth about stability |

Six pre-existing defects were found **by building and running real things**. None was found by
reading code, and none would have been found by another audit — which is the argument for this
sprint having been implementation rather than another documentation cycle.

---

## 8. Exact repo state

| | |
|---|---|
| Repo | `synthos-admin` |
| Branch | `fix/p0-jarvis-voice-and-knowledge-mesh` |
| Base SHA | `8beeb1932493e80bd0e2b805b6686689fcbcd729` (`8beeb19`) |
| Current SHA | **Unchanged — nothing committed** |
| Working tree | 15 modified · 17 new (excluding pre-existing untracked `gh screens/`, `vault/`, `handoff/`) |
| Source diff | 13 files, **+990 / −94** |
| Tests | **1,354 passed · 83 files** |
| Typecheck | `tsc --noEmit` clean |
| Build | `npm run build` exit 0 |
| Repeated runs | **19 of 20 green** (10/10 today; 9/10 on Day 5, one `EADDRINUSE`) |

**Modified (15):** `.env.example` · `docs/IMPLEMENTATION-STATUS.md` · `docs/PRODUCTION-READINESS.md` ·
`lib/backup.ts` · `lib/conversation/engine.ts` · `lib/conversation/service.ts` ·
`lib/env-readiness.ts` · `lib/memory-index.ts` · `lib/persistence.ts` · `package.json` · `server.ts` ·
`src/App.tsx` · `src/services/fishAudio.ts` · `test/backup.test.ts` · `vite.config.ts`

**New (17):** `lib/vault-config.ts` · `lib/knowledge-vault.ts` · `lib/voice-settings.ts` ·
`scripts/provision-vertical.mjs` · `docker-compose.prod.yml` · `docs/deploy/Caddyfile.prod` ·
`docs/deploy/PRODUCTION-DEPLOYMENT.md` · `docs/EVIDENCE-CLEANUP-2026-09-12.md` ·
`docs/DAYS-2-3-EVIDENCE.md` · `docs/DAYS-4-5-EVIDENCE.md` · this file · 6 test files
(`graceful-shutdown`, `env-spec-completeness`, `knowledge-vault`, `voice-configuration-truth`,
`vertical-qualification-tracking`, `vertical-retrieval-quality`) · 10 vertical config/knowledge files

Also modified in a **different repo**, deliberately: `mission-control/docs/synthos/CLAUDE.md` — the
stale "2,757/2,757" claim, corrected with the live red-suite result and the repo-attribution rule.

---

## Investor narrative rule — observed

The company thesis and architecture hierarchy are unchanged. No layer was promoted, demoted,
renamed or added. The only change is that **strategic layer** and **implemented proof** are now
distinguishable at a glance: Trust Protocol and QuarkShield remain in the architecture and are
marked `NOT_IMPLEMENTED`; Guardian remains the authority boundary with its real, narrow
implementation described truthfully; Execution Fabric + Aegis/Receipts is where the evidence is, and
is ranked first accordingly.
