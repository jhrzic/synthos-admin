# Business Conversation AI — Product PRD

**Status:** web channel shipped and live-verified. Voice, SMS and mobile are contracts, not code.
**Branch:** `fix/p0-jarvis-voice-and-knowledge-mesh` — NOT merged to `main`.
**Last verified:** 2026-09-10, against a real workspace over real HTTP.

---

## 1. What this is

A white-label business representative. A business configures what it does and what it may say;
its customers then talk to it on a public web page and get answers drawn from that business's own
published material. When it cannot answer, it says so and puts a person in the loop.

It is a SynthOS **capability** (`conversation.*`), used by a **product**. The capability is not
named after any runtime: Hermes, a hosted model or a local model can each satisfy one step of it,
and none of them is the architecture.

## 2. The constraint that shapes the whole product

**No LLM provider is configured on this install.** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`OPENAI_API_KEY` and `OPENROUTER_API_KEY` are all absent, and the Hermes runtime's own models are
credential-blocked. Checked, not assumed — `conversationModelConfigured()` in
`lib/fabric/registry.ts` is the single place that decision is made.

A conversation product that needs a model in order to say anything would therefore be
undemonstrable and unsellable today. So the answering step has three modes, and the mode is
**recorded on every message row** rather than inferred:

| Mode | What it means | Needs a model |
|---|---|---|
| `GROUNDED_EXTRACTIVE` | Real passages from the business's own published documents, quoted. | No — ships today |
| `LLM` | An approved model phrases the *same* retrieved context. Switches on automatically the moment a provider is configured. | Yes |
| `NO_KNOWLEDGE` | Retrieval found nothing relevant, so it says so and offers a person. | No |
| `DETERMINISTIC` | Handoff, follow-up, greeting, acknowledgement — fixed copy, no retrieval. | No |

This is not a downgrade dressed up as a feature. Extraction makes "never hallucinate a business
answer" true **by construction**: nothing is generated, so nothing can be invented. Adding a model
later changes the phrasing, not the grounding rules and not the refusal.

Everything else — qualification, objection classification, handoff, follow-up, summary — is
deterministic and needs no model at all.

## 3. The truth requirements, and how each is enforced

| Requirement | Enforcement | Test |
|---|---|---|
| Never claim an appointment was booked | `conversation.booking` is registered `NOT_CONFIGURED`. A scheduling request creates a `FOLLOW_UP_REQUEST` task whose description begins "NOTHING HAS BEEN BOOKED". The reply says "I can't book times myself". | §4 of `test/business-conversation-ai.test.ts` asserts the words *booked / confirmed for / you're all set* never appear |
| Never invent a business fact | Answers are quoted passages or an explicit refusal | §1, §7 |
| Never quote what the business did not publish | Retrieval is scoped to the `Business-Knowledge/` folder only | §1 |
| Never invent telemetry | Analytics are counts of rows; booking/calls/SMS/revenue read `NOT_IMPLEMENTED` / `NOT_CONFIGURED` / `UNKNOWN` | §9 |
| Never score a real person | The lead record holds only stated facts. No grade, rating or intent score exists | §6 |
| Never expose internal prompts or configuration | The public profile route returns only name, greeting, disclosure, services, locations, hours | `test/api-security-routes.test.ts` |
| AI disclosure before the first message | Rendered in the page header, not a footer | `lib/conversation/public-page.ts` |

## 4. Architecture

```
public page  /a/<publicKey>            (customer — anonymous, no SynthOS account)
      │
      ├── POST /api/public/assistant/:publicKey/session
      └── POST /api/public/assistant/:publicKey/message
                    │
                    ▼
        lib/conversation/service.ts      turn orchestration, real work creation
                    │
                    ├── lib/conversation/engine.ts   retrieval · classification · answering
                    │        └── searchWorkspaceMemoryScoped()  ← existing FTS5 index
                    │
                    ├── createInitialTask()          ← existing task table
                    └── writeWorkspaceArtifact()     ← existing Vault + canonical spine
```

**No second anything.** No new workflow engine, no new scheduler, no new memory store, no new
report database. Knowledge is Vault artifacts in the existing FTS5 index; handoffs and follow-ups
are ordinary tasks; the summary walks the canonical spine
(`createInitialTask → READY → RUNNING → PROVIDER_COMPLETED → writeWorkspaceArtifact →
ARTIFACT_SAVED → AWAITING_VERIFICATION → Aegis → Ed25519 receipt`) and is genuinely signed.

## 5. Isolation, and why the public surface is safe

A customer has no SynthOS account, so the customer routes are unauthenticated by design. What
replaces the session guard is narrower, and is asserted by a dedicated test:

1. **The workspace is never named by the caller.** It is resolved from a 24-byte random published
   key. There is no `workspaceId` parameter on any public route.
2. **Unpublishing is a real off switch.** `getProfileByPublicKey` requires `published = 1`; an
   unpublished key resolves to nothing, verified live (404).
3. **Retrieval is folder-scoped**, so even within the right workspace only designated material is
   reachable.
4. **Every public route is IP rate-limited**, messages under `EXPENSIVE_EXECUTION`.
5. Cross-origin POSTs are rejected by the existing site-wide Origin check (verified: 403).

### The defect this design exists to prevent

The first live run searched the whole workspace index. The assistant answered a visitor by quoting
an **internal graph-run log**, a **Jarvis directive**, and a **workspace file path**. Every
document was real and correctly retrieved. That is the point: real text from the wrong document is
still a wrong answer, and in that case a disclosure. Folder scoping is the fix, and
`BUSINESS_KNOWLEDGE_FOLDER` is the one line that enforces it.

## 6. Channels

| Channel | Status | What exists |
|---|---|---|
| **Web** | **LIVE** | Public page, session, multi-turn, qualification, objections, handoff, follow-up, signed summary. Verified end-to-end. |
| **Mobile app** | `NOT_IMPLEMENTED` | No mobile codebase exists in this repo or any connected folder. The HTTP contract above is channel-agnostic and a client would use it unchanged. No scaffolding was written. |
| **Voice call** | `NOT_CONFIGURED` | Contract defined below. Needs a carrier line. |
| **SMS / WhatsApp** | `NOT_CONFIGURED` | Contract defined below. Needs a messaging provider. |
| **Embedded widget** | `NOT_IMPLEMENTED` | The app sets `frame-ancestors 'none'` site-wide. Embedding on a customer's own site requires a deliberate, scoped relaxation — not a silent one. |

The `channel` column on `business_conversations` already carries all five values, and the turn
engine is channel-agnostic: a voice turn is the same `handleTurn()` with a transcript as its text.
**The channel is the only thing that changes.**

### What voice and SMS actually need — classified, not guessed

| Requirement | Status |
|---|---|
| Provisioned phone number / MVNO line | `NOT_PROVISIONED` |
| Carrier or SIP trunk | `NOT_CONFIGURED` |
| Speech-to-text | `NOT_CONFIGURED` |
| Text-to-speech | **PRESENT** — Fish Audio is wired and working (`lib/voice-credentials.ts`) |
| SMS provider credential | `NOT_CONFIGURED` |
| Per-business number → workspace mapping | Schema column `business_line_id` exists; no resolver is wired |

There is no Gigs integration and none was faked. `business_line_id` is a nullable column awaiting
a real provisioning step.

## 7. What was verified live

Real HTTP, real database, anonymous client, production build (`NODE_ENV=production node dist/server.cjs`).

- Profile configured, two knowledge documents added and indexed through the product routes.
- Published → public key minted → page and script served (200) with no session.
- Six-turn conversation: identity question, grounded answer from a real document, pricing question
  answered from the business's own text, an unpublished topic refused as `NO_KNOWLEDGE`, a
  scheduling request producing `FOLLOW_UP_REQUEST` with an explicit "I can't book times myself",
  and contact details acknowledged.
- Summary artifact written, **Aegis VERIFIED**, Ed25519 receipt issued.
- Nine security probes: unknown key 404 · traversal 404 · owner routes 401 · foreign conversation
  refused · cross-origin 403 · no workspace id in any public response · unpublish 404 ·
  republish keeps the same link.

Four defects were found by running it and fixed, each now locked by a test: the internal-artifact
disclosure; `"workspace".includes("work")` scoring as a term hit; "call me next Tuesday" matching
handoff before scheduling so the no-booking truth was never stated; and every turn being attributed
to whatever qualification slot was open, which recorded a customer's objection as their *timing*.

A fifth was found in the fix itself: relevance was gated on bm25 rank, whose magnitude scales with
corpus size — the same perfect match scored `-0.35` against 36 documents and `-0.000004` against
one. Every new customer starts at one document, so that gate would have refused every answer for
exactly the businesses being onboarded. Replaced with corpus-independent concept coverage.

## 8. Deliberately not built

- **A second knowledge store.** Documents are Vault artifacts in the existing index.
- **Lead scoring.** A fabricated judgement about a real person.
- **Booking.** No calendar is connected; a follow-up task is the honest substitute.
- **Mobile scaffolding.** An empty app shell is not progress.
- **Bot Mode adapter.** The thin adapter is optional and unbuilt; nothing depends on it.
- **Anything that makes Hermes the foundation.** Hermes remains one possible implementation of one
  step, reachable only through capability resolution.
