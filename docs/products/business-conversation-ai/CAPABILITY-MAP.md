# CONVERSATION AI — Capability Map

The platform capability behind the Business Conversation AI product. Registered in
`lib/fabric/registry.ts` and returned by `listCapabilities()` like every other capability, so the
registry stays an honest inventory of what the system can actually do.

**It is not called `HERMES_CHAT`, and that is deliberate.** Hermes, a hosted model or a local model
can each satisfy `conversation.respond`; none of them *is* the capability. Naming a contract after
a swappable implementation bakes that implementation into every caller.

---

## Sub-capabilities

| Key | Status | Effect | Risk | Implementation | Why that status |
|---|---|---|---|---|---|
| `conversation.respond` | `DEGRADED` → `AVAILABLE` | READ | LOW | `lib/conversation/engine.ts::answerQuestion` | DEGRADED **only** while no approved model is configured. It still answers — by quoting the workspace's own published material — but is reported DEGRADED so nobody reads the registry and concludes generative phrasing is live. Becomes AVAILABLE automatically when a provider key appears. |
| `conversation.qualify` | `AVAILABLE` | READ | LOW | `lib/conversation/service.ts::nextQualificationQuestion` | Deterministic slot-filling against the business's own declared goals. Records only stated facts; produces no score or grade about a real person. |
| `conversation.handoff` | `AVAILABLE` | READ | LOW | `lib/conversation/service.ts::createConversationTask` | Creates a real task assigned to `human`. **It does not contact anyone** — no outbound message is sent by this capability under any configuration. |
| `conversation.summarize` | `AVAILABLE` | READ | LOW | `lib/conversation/service.ts::summarizeConversation` | Deterministic summary on the canonical spine, Aegis-verified and Ed25519-signed. No model paraphrase, so it cannot report an outcome the conversation did not have. |
| `conversation.booking` | `NOT_CONFIGURED` | EXTERNAL_ACTION | MEDIUM | `NOT_IMPLEMENTED` | No calendar or scheduling provider is connected. Registered rather than omitted so the gap is a stated fact, not a silence a future caller can misread. |
| `conversation.telephony` | `NOT_CONFIGURED` | EXTERNAL_ACTION | HIGH | contract only | No voice/SMS carrier line is provisioned. The channel contract exists; no number, trunk or message provider does. |

`effectClass: READ` on handoff and summarize is not an oversight: both write only into the
**caller's own workspace** through the canonical task and artifact paths, and neither reaches
outside the platform. Booking and telephony are `EXTERNAL_ACTION` because they would.

## Agent authority

The assistant sits at **Tier 2 — Produce**. It makes artifacts (replies, summaries) and creates
tasks. It **cannot contact anyone**: no email, no SMS, no call, under any configuration. A handoff
raises work for a person; a person does the contacting. That keeps the platform's core claim —
nine of the ten core agents cannot contact a customer — true for this product too.

## What it reuses, and what it must never duplicate

| Need | Uses | Must not build |
|---|---|---|
| Business knowledge | `memory_index` FTS5 over Vault artifacts | a second knowledge store or vector DB |
| Handoff / follow-up | `tasks` + `activity_events` | a second work queue |
| Summary evidence | canonical spine + Aegis + Ed25519 receipts | a second report database |
| Recurring work | `lib/fabric/scheduler.ts` | a second scheduler |
| Credentials | `lib/voice-credentials.ts` AES-256-GCM store | plaintext keys, browser-held secrets |

The one addition is `searchWorkspaceMemoryScoped()` in `lib/memory-index.ts`, which searches a
**named subset** of the index and returns bm25 rank and full content. `searchWorkspaceMemory()` is
left exactly as it was — it is the operator-facing search, where searching everything is correct.

## Resolution order inside `conversation.respond`

1. **The business's declared profile** — services, hours, locations, contact, description. Most
   authoritative, needs no retrieval.
2. **Published knowledge** — `Business-Knowledge/` only, quoted as whole passages.
3. **Explicit refusal** — `NO_KNOWLEDGE`, with an offer of a person.

There is no fourth branch. That is what makes "never hallucinate a business answer" a property of
the code rather than a hope about a prompt.

### Relevance

Decided by **concept coverage**, not by the search engine's score. bm25 magnitude scales with
inverse document frequency, so an absolute rank threshold is corpus-size dependent — the same
perfect match measured `-0.35` against 36 documents and `-0.000004` against one. Since every new
customer starts at one document, that gate would have refused every answer for exactly the
businesses being onboarded. Concept coverage is corpus-independent: a passage is relevant when it
covers enough of what was asked. A single covered concept is enough when it is a specific one
(≥5 characters), which admits *"what if the work fails, is there any guarantee?"* while still
rejecting incidental overlap on a short common word.

## Channel contract

One engine, five channels. `handleTurn()` takes text and returns a reply plus an explicit action;
a voice turn is the same call with a transcript. The `channel` column is the only difference.

| Channel | Transport | Status |
|---|---|---|
| `WEB` | `POST /api/public/assistant/:key/message` | **LIVE** |
| `MOBILE_APP` | same HTTP contract | `NOT_IMPLEMENTED` — no mobile codebase exists |
| `VOICE_CALL` | carrier webhook → STT → `handleTurn` → TTS | `NOT_CONFIGURED` |
| `SMS` | provider webhook → `handleTurn` → provider send | `NOT_CONFIGURED` |
| `WHATSAPP` | as SMS | `NOT_CONFIGURED` |

Voice would reuse the existing, working Fish Audio TTS path. STT, a number, and a
`business_line_id` → workspace resolver are the three genuinely missing pieces.
