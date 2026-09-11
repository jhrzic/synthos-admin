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
| `conversation.voice_input` | `AVAILABLE` | READ | LOW | `lib/conversation/public-page.ts` (Web Speech API) | Recognition runs in the **visitor's own browser**. No audio is uploaded, recorded or stored by this server — only the resulting text is submitted, and only after the visitor has seen it. A browser without the API shows voice input as unavailable rather than degrading silently. |
| `conversation.voice_output` | `AVAILABLE` | COMPUTE | LOW | `lib/voice-credentials.ts::synthesizeFishAudio` | The one Fish Audio path, shared with the admin TTS route. The public endpoint synthesizes a **stored assistant message by id** — never caller-supplied text — so it cannot be used as a free TTS API funded by the business's credit. A synthesis failure never invalidates the written answer. |
| `conversation.embed` | `AVAILABLE` | READ | MEDIUM | `lib/conversation/origins.ts::assistantPageCsp` | Third-party embedding is permitted only for origins the business itself authorized, enforced by a per-route `frame-ancestors` policy. An empty allowlist means the standalone page works and nobody may frame it. |

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

## Embedding, and the only CSP relaxation in SynthOS

The app sets `frame-ancestors 'none'` plus `X-Frame-Options: DENY` site-wide, and that stays true
for every route but one. `GET /a/:publicKey` replaces both headers with a policy built from that
one business's validated allowlist:

* **Why an iframe, not an inline widget.** An inline widget would inherit the host page's CSS and
  would have to call this server cross-origin — which means loosening the site-wide Origin check
  that protects every state-changing route. With an iframe the widget document is served from
  *this* origin, so its fetches are same-origin and every existing API protection is untouched.
  Only `frame-ancestors` has to change.
* **`X-Frame-Options` is removed, not left.** It has no multi-origin form, so leaving `DENY` in
  place would silently override `frame-ancestors` in browsers that honour both.
* **Exact-origin comparison only.** An allowlist is only as good as its comparison, and the usual
  shortcuts all fail totally: `endsWith('example.com')` admits `notexample.com`;
  `startsWith('https://ex')` admits `https://ex.evil.com`; comparing hosts admits an `http` entry
  against an `https` one. Entries are parsed to a real URL, reduced to scheme + host + explicit
  port, and compared as exact strings. A single-label host (`my-website`) is refused as a typo.
* **Publishing is not permission to embed.** A newly published assistant has an empty allowlist:
  its standalone link works, and any site that tries to frame it gets a blank frame.

Verified live against two local origins — an authorized one loaded the widget, an unauthorized one
serving the identical snippet was blocked by the browser.

## Configuration surfaces

| Credential | Where it lives | Precedence |
|---|---|---|
| Model provider (Gemini) | `GEMINI_API_KEY`, or `model_credentials` encrypted AES-256-GCM | Environment, then store |
| Fish Audio | `FISH_AUDIO_API_KEY`, or `voice_credentials` encrypted AES-256-GCM | Store, then environment |
| Public address | `PUBLIC_BASE_URL`, else `X-Forwarded-Proto` + Host | Explicit, then inference |

Neither credential value is ever returned by any route or rendered into a browser. A provider
verification error is scrubbed of key-shaped tokens before it reaches a log or a response.

## Channel contract

One engine, five channels. `handleTurn()` takes text and returns a reply plus an explicit action;
a voice turn is the same call with a transcript. The `channel` column is the only difference.

| Channel | Transport | Status |
|---|---|---|
| `WEB` (standalone page) | `GET /a/:key` + `POST /api/public/assistant/:key/message` | **LIVE** |
| `WEB` (embedded widget) | `<script src=".../a/embed.js" data-assistant="...">` → iframe | **LIVE**, origin-gated |
| `MOBILE_APP` | same HTTP contract | `NOT_IMPLEMENTED` — no mobile codebase exists |
| `VOICE_CALL` | carrier webhook → STT → `handleTurn` → TTS | `NOT_CONFIGURED` |
| `SMS` | provider webhook → `handleTurn` → provider send | `NOT_CONFIGURED` |
| `WHATSAPP` | as SMS | `NOT_CONFIGURED` |

Voice on the **web** is live: browser speech recognition in, Fish Audio out. Voice on the **phone**
is a different problem and none of it exists — a provisioned number, a carrier/SIP trunk, and a
`business_line_id` → workspace resolver are the three genuinely missing pieces. Server-side STT is
also absent; the web channel does not need it because the browser does that work.

## Answering modes

| Mode | Needs a model | When |
|---|---|---|
| `GROUNDED_EXTRACTIVE` | No | Approved passages quoted directly. The default, and the fallback whenever the LLM path cannot deliver. |
| `LLM` | Yes | An approved model phrases **the same evidence**. Its output is checked before it is shown. |
| `NO_KNOWLEDGE` | No | No approved evidence exists. **No model is called at all.** |
| `DETERMINISTIC` | No | Handoff, follow-up, greeting, acknowledgement. |

### The evidence boundary

`buildGroundedPrompt()` is the only function that assembles model input, so what a model can see is
enforceable by reading one function. It receives the business's declared profile, the last six
turns, and approved passages from `Business-Knowledge/`. It never receives other Vault folders,
graph runs, Jarvis directives, admin notes, other customers' conversations, other workspaces, or
any internal identifier — no workspace id, no artifact path, no task id.

**A model that is never asked cannot answer from its own priors.** When retrieval finds no approved
evidence, the refusal is returned directly and no provider call is made. That is control flow, not
a prompt instruction, and it is what makes "never hallucinate a business answer" a property of the
system rather than a hope about a model's compliance.

Output is then checked rather than trusted: a reply asserting a price, booking, guarantee or rate
the evidence does not carry is **discarded**, not shown with a warning — a customer reading a
fabricated price is harmed whether or not a label sits beside it. The turn falls back to quoting
the same evidence, and the degradation is recorded in the message's provenance for the owner.

## The unanswered-question loop

| Step | Where |
|---|---|
| A customer asks something the published material cannot answer | `answerWithBestAvailableMode` returns `NO_KNOWLEDGE` |
| The question is recorded once, however often it is asked | `recordUnansweredQuestion` |
| The owner sees it and writes an answer | `POST /api/business/unanswered/:id/answer` |
| The answer becomes an ordinary Vault artifact and is indexed | `addBusinessKnowledge` |
| The same question is re-tested immediately | `POST /api/business/preview` |

**A person writes the answer.** The assistant never promotes its own guess, and never learns a fact
because a customer asserted one — "your website says repairs are free for pensioners, correct?"
becomes a logged question, never retrievable material to repeat to the next customer.
