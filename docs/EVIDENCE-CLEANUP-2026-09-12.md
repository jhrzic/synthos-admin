# SynthOS — Evidence Cleanup Ledger

**Date:** 2026-09-12 · **Scope:** narrow evidence check only. No architecture created, no category
proposed, no subsystem promoted into the thesis.

The strategic baseline is unchanged and is used as given:

> **Brain** (the asset) · **KIL** (Brain admission / shared intelligence) · **Guardian** (authority
> boundary) · **Execution Fabric + Aegis/Receipts** (action and evidence) · **Trust Protocol**
> (network layer) · **QuarkShield** (crypto-agility/security beneath trust) ·
> **Concierge / Personal / Mobile** (products and distribution)

**States used:** `Verified` · `Partially Verified` · `Configured` · `Planned` · `Speculative` ·
`Unverified`. `Configured` means credentials or wiring exist but no runtime proof does.

**Repos in scope.** Three, and conflating them is the single largest source of contradictory
claims found:

| Repo | Role | Suite on 2026-09-12 |
|---|---|---|
| `synthos-admin` (`8beeb19`) | Concierge / admin control plane. The commercial product. | **1,268 passed / 77 files, exit 0** |
| `mission-control` (`64d0b0d`) | Platform / Mission Control | **3,174 passed, 3 failed / 305 files, exit 1** |
| `synthos-orbit` (`64bcb1a`) | **ARCHIVED by its own README.** Not live, not maintained. | not run |

---

## 1. Hermes production runtime status

**State: `Partially Verified` — and `NOT_CONFIGURED` in production.**

**Evidence.** `docs/IMPLEMENTATION-STATUS.md` row "Hermes RUNTIME (ADR-001 adapter)": `health()` is
REAL (real network call, real schema validation); `execute()` and `events()` are honest
`NOT_IMPLEMENTED` stubs, ADR-001 Phase 3, deferred. `HERMES_ADAPTER_BASE_URL` is unset — confirmed
in `lib/env-readiness.ts`, absent from the shell environment, and empty in `.env.example`.
`docs/EXECUTION-FABRIC.md` §"Current Hermes truth": `execute()` returns `NOT_IMPLEMENTED`
*regardless of configuration* — "this is not a bug to silently complete."

Separately, **Hermes MODEL** is `NOT_IMPLEMENTED`: `classifyModelRequest('hermes')` is explicitly
`UNSUPPORTED` regardless of `OPENROUTER_API_KEY`, asserted by `test/model-router.test.ts` and
`test/pass5-truth-sweep.test.ts`.

**Conflict.** A Hermes-named process *is* running on this machine right now
(`~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main serve --host 127.0.0.1 --port 0`, plus
an Electron desktop app). It is **not** the integration target. `docs/PRODUCTION-READINESS.md`
already calls it a false friend: the ADR's target is "Nous Hermes 3 AgentOS Adapter" with a
`nousresearch/hermes-3-*` model family, while the local tool is a personal desktop agent on a
private Unix socket with no documented HTTP contract. Anyone who sees the running process and
concludes "Hermes runtime is live" is wrong.

**Cleanup action: keep as-is, and never say "Hermes runtime" without a qualifier.** Externally:
*adapter contract and health probe are real; execution is deferred and unconfigured.* Do not cite
the running desktop app as evidence of anything.

---

## 2. Model-provider production connection status

**State: `Partially Verified` in code · `Unverified` in production.**

**Evidence.** `lib/model-credentials.ts`: `SUPPORTED_MODEL_PROVIDERS = ['gemini'] as const` —
commented "Providers this build can actually execute. Not a wish list." `lib/model-router.ts` has a
live execution mapping for Gemini only; Claude, DeepSeek, OpenRouter and Hermes are recognised and
honestly `UNSUPPORTED`. In this working copy there is **no `.env` file** and `model_credentials`
holds **0 rows** — so no model key is configured anywhere locally.

**Conflict.** The Concierge handoff describes a vendor-neutral capability layer ("Models and
vendors are replaceable"). True as *design*; today one provider executes. A deck line implying
multi-model or model-agnostic execution is not supported. Note that `mission-control/docs/synthos/
CLAUDE.md`'s six-row tier table (Fable/Opus/Sonnet/Haiku/DeepSeek/Ollama) is a **routing plan for a
different repo**, not a connection status for the product being sold.

**Cleanup action: downgrade.** Say *"one approved provider executes today (Gemini); the capability
contract is provider-neutral."* Remove any external wording implying several providers are live.

---

## 3. Production voice path

**State: `Configured` (output) · `Partially Verified` (input) · `NOT_CONFIGURED` (telephony).**

**Evidence.**
- **Output (TTS).** A real AES-256-GCM-encrypted Fish Audio credential exists —
  `voice_credentials`, 1 row, provider `fish_audio`, written 2026-09-10.
  `docs/products/business-conversation-ai/CAPABILITY-MAP.md` marks `conversation.voice_output`
  `AVAILABLE`, synthesizing **a stored assistant message by id**, never caller-supplied text.
  `FIRST-CUSTOMER-RUNBOOK.md` §0 records the paid balance as **exhausted** — free tier only.
- **Input (STT).** `conversation.voice_input` is `AVAILABLE` — Web Speech API in the *visitor's*
  browser; no audio reaches the server. On the admin side,
  `docs/PRODUCTION-READINESS.md` records a real Chrome run against a production build reaching
  `onstart`→`LISTENING` with zero console errors, but `MIC_BROWSER_TEST: ENVIRONMENT_BLOCKED` —
  `navigator.permissions.query({name:'microphone'})` never resolved past `prompt`, so **end-to-end
  spoken-audio transcription has never been proven.** Blocked on hardware and a human, not on code.
- **Telephony.** `lib/fabric/registry.ts::conversationTelephonyCapability()` is `NOT_CONFIGURED`,
  with the comment "Telephony and SMS require an MVNO/carrier line that does not exist on this
  install." `VOICE_CALL`, `SMS`, `WHATSAPP` are all `NOT_CONFIGURED` in the channel contract.

**Conflict.** "Fish Audio voice output: working" in the handoff is true but reads as production-
ready; the account has no paid credit. And no demo script should imply a phone call.

**Cleanup action: relabel.** *"In-browser voice in and out is real; the voice account is free-tier
and has no paid balance; live microphone capture has not been proven end-to-end; there is no phone
or SMS path."*

---

## 4. Agent email capability

**State: `Unverified` — nothing exists.**

**Evidence.** There is no email-sending infrastructure in this codebase at all: no `nodemailer`, no
SMTP config, no SendGrid/Resend/Postmark, no `RESEND_API`/`SENDGRID` env var (checked against the
complete declared list in `lib/env-readiness.ts`). The absence is *asserted by test* —
`test/master-admin-truth-pass4.test.ts:125` requires the user-creation route to match
`not.toMatch(/sendMail|sendEmail|nodemailer|sendgrid/i)`. Second-user onboarding returns a one-time
setup link in the API response precisely because no email can be sent, and the UI states "No email
will be sent." `CAPABILITY-MAP.md`: `conversation.handoff` "**does not contact anyone** — no
outbound message is sent by this capability under any configuration."

**Conflict.** Handoff §10 proposes `concierge@theirdomain` as a desired agent identity. That is a
**Planned** concept with zero implementation. It must never appear in a demo, deck or customer
statement as a capability.

**Cleanup action: remove from any external claim; keep as Planned in the roadmap only.**

---

## 5. Gigs / connectivity status

**State: `Unverified` — no integration exists.**

**Evidence.** One line of code mentions Gigs, and it is a truthful negative:
`server.ts:2639` → `row("GIGS", "NOT_CONFIGURED", "No Gigs/MVNO integration exists.")`. No Gigs SDK,
client, credential, env var or webhook handler exists anywhere in the repo.

**Conflict.** Handoff §4 reads as an integration boundary spec and could be mistaken for
integration status. It is a **Planned** scope statement. Handoff §19 item 7 correctly lists it as
future work.

**Cleanup action: keep the truthful `NOT_CONFIGURED` state; relabel §4 as scope, not status.** No
external MVNO/eSIM claim of any kind.

---

## 6. Trust Protocol implementation status

**State: `Speculative` — no implementation, and no artifact under that name.**

**Evidence.** `"Trust Protocol"` returns **zero hits** across every repo. The nearest real artifacts
are (a) the phrase "Trust Layer" as *positioning* in `SynthOS_On-Chain_Infrastructure_PRD.md` and
`mission-control/docs/synthos/kil-positioning-and-onchain-prd.md`, and (b) the TON subsystem in
`synthos-admin` — `lib/ton-probe.ts`, `ton-readiness.ts`, `ton-analytics.ts`, `ton-guardians.ts`,
tested by `test/ton.test.ts`. TON's business logic is real; its runtime state is not: no
`TONCENTER_API_KEY`/`TONAPI_API_KEY` is set, `docs/PRODUCTION-READINESS.md` marks live validation
`BLOCKED`, and `ton_guardians` holds **0 rows**. **No smart contract exists in any repo** — zero
`.sol`, `.fc` or `.tact` files.

**Conflict.** The on-chain PRD describes ten features (agent identity, reputation engine, skill
registry, marketplace, autonomous treasury, immutable audit trail…). None is implemented. A design
document is not proof the feature exists.

**Cleanup action: downgrade to `Speculative` and bound it.** Externally, the network layer is a
**stated architectural position with no shipped implementation**. Keep it in the baseline as a
layer; remove it from any claim about what works. Cite TON as `NOT_CONFIGURED`, never as the
Trust Protocol shipping.

---

## 7. Guardian implementation status

**State: `Partially Verified` — two real, narrow mechanisms; not a policy engine.**

**Evidence — what is real.**
1. `lib/kil-gate.ts::checkGuardianRules(cmd)` — a real deterministic classifier returning
   `SAFE` / `APPROVAL_REQUIRED` / `BLOCKED` with a risk level and rule citation, over a regex
   denylist (fork bombs, `rm -rf /`, `mkfs`, `dd of=/dev/*`, `sudo`, `curl | sh`, `drop database`…).
   Tested by `test/terminal-security.test.ts`. It guards `/api/terminal/exec`, which
   `lib/fabric/registry.ts` reports as `UNSUPPORTED` in production and `APPROVAL_REQUIRED` in dev.
2. `lib/fabric/envelope.ts::executeEnvelope()` — refuses any `EXTERNAL_ACTION` capability whose
   `approvalPolicy !== 'GUARDIAN_ENFORCED'`, with exactly one exemption (`{'vault.write'}`) defined
   in one place. `lib/fabric/scheduler.ts` **imports** that set rather than copying it and enforces
   the same rule at schedule-creation time — so scheduling cannot route around approval.

**Evidence — what does not exist.** No `guardian_policies` table. No approval-queue route. No HITL
review UI. `server.ts:5691` carries the comment recording this, and Pass V **removed a real
fabrication**: `/api/master-admin/diagnostics` had hardcoded `policyCount: 4`, `mode: "ENFORCING"`,
`hitlRequired: true` with zero backing query. Pass X removed three more hardcoded
`getStatusBadge('LIVE')` calls on Guardian/Aegis.

**Conflict.** The baseline names Guardian "the authority boundary," which is fair as architecture.
But "Guardian enforces policy" would re-assert exactly the claim the repo already deleted as
fabricated. That regression must not be reintroduced.

**Cleanup action: relabel precisely.** *"Guardian is an enforced eligibility rule in the dispatcher
plus a deterministic command gate — not a configurable policy engine, and there is no human
approval queue."* Any surface implying policy counts, an enforcing mode, or HITL is a regression.

---

## 8. Aegis / receipts status

**State: `Verified` — the strongest-evidenced layer in the stack.**

**Evidence.** `runDeterministicAegisVerification()` in `lib/persistence.ts` runs named
deterministic checks over real rows (task exists in SQLite, provider output non-empty, artifact
persisted…), returning `VERIFIED` / `FAILED` / `INCONCLUSIVE` with per-check evidence — reviewer
`"Guardian-Aegis-Deterministic-v1"`, method `DETERMINISTIC_ARTIFACT_AND_LEDGER_AUDIT`. Receipts are
**real Ed25519 signatures**: `crypto.generateKeyPairSync('ed25519', …)`, a durable keypair under
`data/keys/`, and a `receipts` table carrying `algorithm` / `public_key` / `payload_json` /
`signature`. The local database holds **27 receipts and 28 quality reviews** against 75 real tasks.
`docs/EXECUTION-FABRIC.md`: a failed execution never fabricates an artifact, Aegis review or
receipt. Windmill results are re-verified through the same verifier and **Windmill never signs**.

**Conflict.** One real confusion, already documented, not yet fixed: the Kanban client-side
`synthosControlService.ts` has its own non-cryptographic "receipt" token. It is now labeled
honestly but is easy to mistake for the real pipeline.

**Cleanup action: keep — and this is the claim to lead with.** Add one qualifier to prevent the
Kanban confusion: *server-side Ed25519 receipts are the real ones.*

---

## 9. Brain / Obsidian / memory implementation status

**State: memory `Verified` (narrow) · Obsidian `Unverified` · "Brain" `Speculative` in this repo.**

**Evidence.** `lib/memory-index.ts` is a real SQLite FTS5 index over real Vault artifacts — no
vector store, no external search service; 42 rows locally, workspace-scoped, membership-gated.
That part works.

**But the "Vault" is not Obsidian.** `lib/vault.ts` hardcodes
`VAULT_ROOT = path.join(process.cwd(), 'vault')` — a repo-local artifact store whose files are
written only by `writeWorkspaceArtifact()` with server-generated filenames. There is **no
vault-path environment variable at all** (verified against the complete declared list in
`lib/env-readiness.ts`), no configurable path, no watcher, no sync, and no reader for the real
~1,204-note vault at `~/synthos/vault`.

"Brain" as a named subsystem exists in **`mission-control`** — `src/lib/synthos-brain-knowledge.ts`,
`/api/brain/knowledge-graph`, `/api/brain/ask`, a 13-category ontology — not in `synthos-admin`.
In `synthos-admin`, `brain` appears only in component names.

**Conflict — the sharpest one in this cleanup.** Handoff §6 lists the states a dashboard "should
expose" (path configured / exists / readable / writable / index ready / watcher status). Every one
of those is `NOT_IMPLEMENTED`. Read quickly, §6 looks like a status report. It is a work order.
(Relabelled in place, 2026-09-12.)

**Cleanup action: downgrade and split.** *"Real full-text memory over the platform's own artifacts;
no Obsidian vault integration exists yet."* Do not claim ~1,204 notes are ingested. Do not present
Mission Control's Brain as a `synthos-admin` capability.

> **UPDATE — Days 2–3 (2026-09-12).** The vault half of this finding is now **closed**;
> the Brain half stands unchanged. `SYNTHOS_VAULT_PATH` configures a real external vault,
> `lib/knowledge-vault.ts` writes semantically-named notes with receipt/artifact provenance into a
> bounded `SynthOS/` subdirectory, and every truth state is derived from real syscalls. Proven
> end-to-end; see `docs/DAYS-2-3-EVIDENCE.md`.
>
> Two limits survive and must still be stated externally: **universal ingestion is NOT claimed** —
> one source (Business Conversation AI) is LIVE and every other runtime is listed at its real state
> in that report's source matrix — and **the ~1,204-note personal vault has not been pointed at**,
> since that is the user's decision, not this work's. "Brain" as a named subsystem remains
> `mission-control`'s, not `synthos-admin`'s.

---

## 10. Graph builder / Execution Fabric status

**State: `Verified` in `synthos-admin` · `Planned` in `mission-control`. Do not merge the two.**

**Evidence (`synthos-admin`).** `lib/fabric/*` is real and closed across Steps 4–8
(`docs/EXECUTION-FABRIC.md`): every ingress — Jarvis, graph runs, the in-process scheduler, manual
execution, skills — routes through one `executeEnvelope()` dispatcher enforcing capability
availability, Guardian eligibility and one atomic idempotency mechanism (`execution_claims`, a real
`UNIQUE`-guarded INSERT introduced after a *proven live defect* where three concurrent requests
produced three artifacts). Graphs are REAL and workspace-isolated
(`test/graph-workspace-isolation.test.ts`, `graph-execution.test.ts`, `graph-live-execution.test.ts`;
4 graphs and 8 runs in the local DB). **Draggable editing exists and persists** —
`GraphBuilderView.tsx` (2,872 lines) has real node-position drag with the comment "a reload restores
exactly what the author positioned."

Honest limits: graph cost is `ESTIMATE_UNAVAILABLE`; the scheduler supports `ONE_TIME` and fixed
`INTERVAL` only — weekday/local-time recurrence is *refused with a clarification*, never silently
mis-scheduled, because no DST-aware timezone dependency exists.

**Conflict.** `mission-control/docs/synthos/CLAUDE.md` lists "graph execution and draggable editing"
as **open work**. That is true of Mission Control and false of `synthos-admin`. Quoting it against
the product being sold understates a shipped capability; quoting the reverse overstates Mission
Control.

**Cleanup action: keep, with the repo named every time.**

---

## 11. KIL — implementation vs. spec

**State: `Verified` as implemented · spec is `Partially` implemented, and the code says so itself.**

**Evidence.** `lib/kil.ts`'s own header is the primary source: it is ported unchanged from the
shipped `mission-control/src/lib/synthos-kil.ts`, and it states explicitly that the fuller
`kil-v2-scoring-spec.md` design "adds a decay term, simulation gate, and human-review multiplier
that the shipped code does not implement… those three terms are deliberately NOT added here."

Shipped formula: `C(K) = V(K) · [ wE·E(K) + wF·F(K) ]`, **S excluded while unbuilt**. `V(K)` is a
hard multiplicative containment gate — any blocking failure returns `0.00`, deliberately not a
weighted term "because a weighted safety term can be averaged away by good prose." `E(K)` is five
continuous quality vectors, and quality never vetoes. Promotion requires **both** `C(K) ≥ 0.85`
**and** `E(K) ≥ 0.90`. Nine deterministic checks, four blocking. Pure functions — no DB, no clock,
no I/O. `test/kil.test.ts` plus `test/full-platform-integration.test.ts`; 19 real observations in
the local DB.

**Conflict.** Three specs describe KIL: the archived `synthos-orbit` version, `kil-v2-scoring-spec.md`,
and the shipped code — and the orbit README confirms that repo is archived reference only. Citing the
spec as the implementation overstates it by three terms.

**Cleanup action: keep, and always cite the shipped formula.** State the gap as a deliberate
exclusion, which is stronger than silence: *decay, simulation gate and human-review multiplier are
specified and not built.*

---

## 12. QuarkShield implementation vs. spec

**State: `Speculative` — zero implementation, and it is not part of the SynthOS codebase.**

**Evidence.** `"QuarkShield"` returns **zero hits** across every file in every SynthOS repo. What
exists is in `~/Downloads`: `quarkshield-web3-prd-business-plan.md`, `quarkshield-pages/`,
`quarkshield-pages-v2/` and two zips — a PRD and web pages, outside any repo, with no build, no
tests and no integration point. No cryptographic-agility code exists anywhere in SynthOS.

**Conflict.** The baseline places QuarkShield "beneath trust" as a layer. That is a position, not a
status, and nothing in the codebase implements it.

**Cleanup action: downgrade to `Speculative`; state plainly that it is unbuilt.** Keep it in the
baseline as a layer if the thesis needs it — remove it from anything describing what exists. Per
the permanent rule, this strengthens no layer today.

---

## 13. Gotham — commercial state

**State: `Verified` as past consulting revenue · `Unverified` as SynthOS revenue. Not the same
claim.**

**Evidence.** Two real invoices from John Hrzic to GothamGR / Gotham Polling / Gotham Government
Relations, 546 5th Avenue, New York:

| Invoice | Date | Period | Amount |
|---|---|---|---|
| `2025-0512` | 2025-05-12 | 2025-03-26 → 2025-04-30 | **$4,575.00** (after a $2,000 delay discount) |
| `GGR-0525` | 2025-05-30 | 2025-05-01 → 2025-05-30 | **$4,650.00** |

**The services billed are manual digital-marketing consulting**, not SynthOS: GA4/Search Console/Tag
Manager setup, SEO and Google Business Profile work, LinkedIn/Quora/Reddit accounts, Monday.com
boards, Apps Script digests, 7 written articles, weekly reports. A SynthOS product does not appear
on either invoice. Also present: `~/gotham/Gotham_Agentic_OS_Proposal_Draft.docx` — a **proposal**,
and `~/gotham-advocacy-platform/` — a codebase with no git history. No contract, no signed SOW and
no payment confirmation was found; an invoice is evidence of billing, not of collection.

**Conflict.** Any deck line treating Gotham as a SynthOS customer, pilot or design partner is not
supported. It is a real prior client relationship from ~16 months ago for different work.

**Cleanup action: relabel, do not delete.** Truthful form: *"prior paid consulting engagement
(2025), pre-SynthOS, ~$9.2K invoiced."* Remove any implication of product revenue, ARR, pilot or
reference customer. If collection matters to the claim, confirm payment before using the figure.

---

## 14. RentGain — commercial / distribution state

**State: `Speculative` — a test fixture and two demo zips. No commercial relationship evidenced.**

**Evidence.** `mission-control/src/lib/__tests__/rentgain-acceptance.test.ts` is titled "Real
**RentGain-Style** End-to-End Acceptance Test" and seeds its own tenant row
(`'rentgain-holdings', 'RentGain Real Estate'`) — a fixture, by its own naming. `DECISIONS.md` lists
RentGain alongside SurfLiquid and SynthOS Global as tenant scopes in the Brain graph. Outside the
repos: `~/synthos-os/rentgain-demo-DRAG-TO-NETLIFY.zip` and `…NETLIFY2.zip`. No contract, invoice,
deployed URL, distribution agreement or account was found.

**Conflict — two, and one is a governance breach.** (a) The test title's word "Real" reads as a real
customer in any quotation; it describes fidelity of the *test*, not of the customer. (b)
`mission-control/docs/synthos/CLAUDE.md` carries a hard rule: **"No client, company or person names
anywhere in code, schema, or seed data."** `rentgain-holdings` and `SurfLiquid` are in test seed
data. Either they are fictional — and still violate the rule — or they are real names in code,
which is worse.

**Cleanup action: remove from every commercial claim; keep the test.** Rename the fixture tenants to
generic placeholders to close the seed-data rule breach — small, and it removes the ambiguity
permanently.

---

## 15. Bloomcraft / TestFlight state

**State: `Configured` — a real App Store Connect pipeline; no evidence a TestFlight build is live.**

**Evidence.** `~/bloomcraft/eas.json` carries a real submit profile: `ascAppId: "6804840743"`, key
`LP678ALZGN`, issuer `69a6de86-…`, with `AuthKey_LP678ALZGN.p8` and `SubscriptionKey_MKS62C36N8.p8`
present on disk. `AGENTS.md` is titled "Antigravity (AG) Agent Contract & **TestFlight Pipeline**",
bundle `com.bloomcraft.app`. `app.base.json` shows version `0.2.1`, `buildNumber "4"` — but
`eas.json` sets `appVersionSource: "remote"` with `autoIncrement`, so the local number is not
authoritative. Last commit 2026-09-02. A native Xcode project also exists at
`~/Desktop/Git repo xcode/bloomcraft`.

**Conflict — and a ship blocker.** `~/bloomcraft/AUDIT.md` (2026-08-27) records a P0:
`app/(tabs)/affiliate.tsx` presents an "AGENT PROMOTION ENGINE RUNNING" with hardcoded earnings
($184.50), referral clicks, four channels pre-marked `connected: true`, and **the owner's personal
email as a string constant in the distributed binary**. The audit itself flags Apple Guideline 2.3.1
and 3.1.1 exposure. Whether that P0 is fixed was not verified in this pass. Separately, Bloomcraft
is a distinct product and is not part of the SynthOS architecture baseline.

**Cleanup action: downgrade to `Configured`; do not claim a shipped or beta app.** To promote it to
`Verified`, one piece of evidence closes it: a TestFlight build record in App Store Connect for app
`6804840743`. Fix the P0 before any submission.

---

## 16. Current passing test count — and which repo it belongs to

**State: `Verified` for `synthos-admin` · `Verified negative` for `mission-control`.**

**Evidence — run today, 2026-09-12, not quoted from docs.**

| Repo | Commit | Result |
|---|---|---|
| `synthos-admin` | `8beeb19` | `npx vitest run` → **77 files passed, 1,268 tests passed**, exit **0** |
| `mission-control` | `64d0b0d` | `npx vitest run` → **305 files (2 failed), 3,177 tests (3 failed)**, exit **1** |

Mission Control's three failures, stated exactly:

1. `src/lib/__tests__/synthos-public-surface.test.ts` — *"`src/app/api/public/intake/route.ts` must
   call one of: `resolveToken`, `resolveWebhookToken`"* — it calls neither.
2. same file — *"must live under a `[token]` segment"* — it does not.
3. `src/lib/__tests__/router-telemetry.test.ts` — *"expected 0.06 to be close to 0.04"*, a cost
   assertion drift consistent with the model-price re-basing that `CLAUDE.md` itself flags as due
   before 2026-08-31.

**(1) and (2) are a live security-guard breach, not cosmetic.** The repo's own 🔴 invariant is
*every route under `/api/public` authorises by token*. Commit `6b41057` ("feat(intake): add public
website bridge") added a deliberately anonymous intake route — its own comment says "Anonymous
getsynthos.com bridge" — without amending or excepting the guard. The anonymous bridge may be the
right product call; an unamended red guard is not, because the invariant now protects nothing.

**Conflict.** `mission-control/docs/synthos/CLAUDE.md` claimed "2,757/2,757 tests across 244/244
files" as of 2026-08-11. That is both stale and **no longer true**. Corrected in place, 2026-09-12.

**Cleanup action: relabel — done.** Standing rule, now written into both files: **never quote a test
count for "SynthOS" without naming the repo, and never add or average the two.**

---

## 17. Deck claims marked `[Verified]`

**State: `Unverified` — no such deck is present.**

**Evidence.** `grep -rl "\[Verified\]"` over `~/synthos` and the wider home directory returns **zero
files**. No investor deck, pitch document or file carrying `[Verified]` markers exists on disk. The
nearest artifacts are `SynthOS_Whitepaper_Master_Draft_v1.md` (98 lines, explicitly a "Foundation
Outline"), `SynthOS_On-Chain_Infrastructure_PRD.md`, `SynthOS_Enterprise_Infrastructure_Whitepaper.pdf`
and `Catlyn (Maya).pdf`.

**Cleanup action: cannot audit what is not here.** Supply the deck file (or its location) and the
`[Verified]` rows can be checked against §§1–16 directly. Until then, the safe default: **no claim
outside §8 (Aegis/receipts), §11 (KIL as shipped), §10 (Execution Fabric in `synthos-admin`) and
§16 (`synthos-admin` 1,268/1,268) should carry a `[Verified]` badge.**

---

## What the evidence supports externally, in one paragraph

A working, honestly-instrumented Business Conversation AI that answers only from a business's own
published material, refuses with `NO_KNOWLEDGE` rather than inventing, cryptographically signs a
deterministic verification of every committed result, isolates tenants, and states its own gaps in
its own code. It is **shippable and not shipped**: no HTTPS host exists. One model provider
executes. There is no email, no phone, no SMS, no calendar, no Obsidian integration and no
on-chain implementation. There is no current SynthOS revenue; the one paid engagement on record is
pre-SynthOS consulting from 2025.

## Files changed by this cleanup

| File | Change |
|---|---|
| `mission-control/docs/synthos/CLAUDE.md` | Stale "2,757/2,757" relabelled; live 3-failure result and the repo-attribution rule recorded |
| `synthos-admin/handoff/SynthOS_Concierge_Project_Handoff_2026-09-11.md` | §5 conclusion relabelled `YES, CONDITIONAL`; OpenRouter-leak line marked `UNVERIFIED`; single-provider reality stated; §6 Obsidian relabelled as work order, not status |
| `synthos-admin/docs/EVIDENCE-CLEANUP-2026-09-12.md` | This ledger |

No architecture was created. No category was proposed. No subsystem was promoted into the company
thesis. Two verified negatives — Hermes `execute()` `NOT_IMPLEMENTED`, and Guardian having no policy
store or approval queue — were preserved at full strength and bound to the paths where they were
found.
