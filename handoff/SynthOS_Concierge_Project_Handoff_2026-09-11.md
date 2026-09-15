# SynthOS Concierge / Mobile — Project Handoff
**Date:** 2026-09-11  
**Purpose:** Canonical starting context for a fresh ChatGPT Project chat.  
**Primary repo:** `jhrzic/synthos-admin`  
**Local repo:** `/Users/hrzic/synthos/synthos-admin`  
**Current working branch:** `fix/p0-jarvis-voice-and-knowledge-mesh`  
**Merge rule:** Do not merge to `main` until explicitly approved.

## 1. Product thesis — start here

The power of SynthOS Concierge is **the conversation + the knowledge it accumulates**.

Do not reduce the product to a chatbot, AI receptionist, MVNO, phone-call bot, admin dashboard, or collection of visible agents.

The customer experiences **one persistent Concierge** that can talk, listen, understand the business, remember prior work, retrieve approved knowledge, use tools, execute approved actions, and improve over time.

The same conversational core should adapt to very different businesses because the **business knowledge, skills, permissions, connectors, workflows, and communication rules change — not the core product**.

Priority demo verticals:
1. Estate-planning attorney / law firm
2. Mattress retailer
3. Car dealer
4. HVAC / local-service business

A successful demo should make the viewer think: **“It knows this business.”** Not merely: “It can answer questions.”

### Attorney demo
- intake
- matter-aware knowledge boundaries
- appointment scheduling
- document questions
- lead qualification
- sensitive-data boundaries
- follow-up
- human handoff
- owned firm knowledge

### Mattress demo
- product comparison
- comfort/size/service questions
- delivery policy
- objection handling
- store/location knowledge
- lead capture
- appointment/store visit
- missed-call recovery
- AEO/SEO/GEO content from real customer questions

### Car dealer demo
- inventory questions
- model comparison
- sales appointment
- service appointment
- trade-in intake
- salesperson handoff
- lead routing
- dealership/local search
- follow-up

### HVAC demo
- service-area qualification
- emergency vs non-emergency triage
- scheduling
- service/product FAQs
- technician/customer handoff
- missed-call recovery
- seasonal follow-up
- local AEO/SEO/GEO

## 2. Canonical architecture rule

SynthOS is the control/governance/execution layer.
Hermes is **one runtime/component**, not the foundation.

Canonical flow:

`User objective / conversation`
→ `SynthOS Conversation + Context`
→ `Capability Resolver / Execution Fabric`
→ `approved model / agent / skill / connector / browser / API`
→ `Guardian`
→ `action`
→ `Aegis / evidence / receipt`
→ `artifact + knowledge + memory`

Models and vendors are replaceable. Capability contracts should be stable.
Do not optimize architecture around Jarvis, Hermes, Gemini, Claude, Gigs, or any single vendor.

## 3. Concierge communications model

Concierge is primarily an **in-app / web AI agent**.

Voice inside the app:

`microphone → STT → Conversation AI → knowledge/tools → TTS → speaker`

This does not require PSTN / telecom routing.

Telecom becomes relevant for:
- real cellular line
- eSIM
- phone number
- carrier voice/SMS
- number porting
- usage/billing
- human phone handoff

### Human call handoff
Concierge may identify the right salesperson/employee, prepare a handoff summary, dial that human, and connect the user. A programmable voice provider is only required if SynthOS itself must participate in or bridge a real PSTN call.

### Missed-call / voicemail recovery
`customer calls business`
→ `missed call / voicemail`
→ `voicemail transcript/event`
→ `Concierge understands intent`
→ `contact/CRM/context lookup where authorized`
→ choose human callback, task, approved SMS/email, or secure Voice/Video Concierge link.

The secure Voice/Video Concierge link can feel like a call while supporting video, product cards, appointment choices, documents, quotes, forms, approvals, checkout, and human escalation.

## 4. MVNO / Gigs boundary

Gigs is the telecom/connectivity layer, not the AI brain.

Use Gigs for documented/available capabilities such as:
- customer/user
- plans
- subscriptions
- eSIM/pSIM
- phone number
- porting
- usage
- billing/lifecycle
- Connect Sessions
- webhooks/events
- virtual numbers if enabled

Do not assume Gigs provides programmable AI call media or application-level conversational SMS unless actual project/docs prove it.

Conceptually:
- **Gigs:** connectivity / eSIM / plan / carrier line / lifecycle
- **SynthOS:** conversation / intelligence / memory / governance / tools / workflows
- **Web + Mobile:** Concierge interaction surface
- **Optional communications bridge:** only where programmable PSTN/SMS is required

Gigs Operator is a UX reference because it is a conversational agent invoking telecom actions. Concierge should be broader: telecom + business operations + customer communication + knowledge + growth.

## 5. Current Business Conversation AI status

Latest Claude implementation reports:
- installable website assistant: working
- real text conversation: working
- grounded business knowledge: working
- `NO_KNOWLEDGE` refusal: working
- public assistant publishing: working
- authorized-domain embed: working
- owner inbox: working
- lead/follow-up: working
- unanswered-question capture: working
- Fish Audio voice output: working on free tier
- voice input: wired; live physical microphone proof may still require human check depending on automation
- multi-tenant isolation: tested
- Aegis / receipts: working
- production URL / reverse-proxy fixes: implemented
- readiness panel: implemented
- latest reported test suite after production-readiness pass: **1268 passing**
- typecheck: clean
- build: clean
- branch pushed, not merged

Latest Claude conclusion:
`CAN_WE_ONBOARD_A_FIRST_REAL_WEB_CUSTOMER: YES`

User actions before a paid deployment:
1. rotate leaked OpenRouter credential
2. top up production Fish Audio credit if selling voice
3. stand up HTTPS host with documented deployment configuration

Do not rebuild this product from scratch.

### 🔴 Evidence relabel — 2026-09-12 cleanup pass

The status list above is accurate about the **code**. It is not a production-state claim, and two lines of it do not survive an evidence check. Corrections, bounded to what was actually verified:

- **`CAN_WE_ONBOARD_A_FIRST_REAL_WEB_CUSTOMER` is `YES, CONDITIONAL` — not `YES`.** Item 3 above is not a to-do alongside the YES; it is a precondition of it. No HTTPS host, domain, TLS terminator or deployment of any kind exists. `docs/PRODUCTION-READINESS.md` records it as `BLOCKED`, there is no `netlify.toml` / `vercel.json` / `fly.toml` / `render.yaml` in the repo, and `docs/products/business-conversation-ai/FIRST-CUSTOMER-RUNBOOK.md` §0 calls HTTPS "the one hard requirement." The honest form is: **shippable, not shipped.**
- **"rotate leaked OpenRouter credential" is `UNVERIFIED` as a repo finding.** No live OpenRouter key exists in the working tree or git history of `synthos-admin`, `mission-control`, `synthos-orbit` or `agentic-os`, and none is present anywhere under `~/synthos`. The only `sk-or-v1` strings are 9-character UI **placeholders** in `src/components/SettingsView.tsx` and `src/components/ModelRouterView.tsx`. If a key really was exposed it happened outside these repos (a chat paste, an untracked file elsewhere) — rotate it anyway, but do not carry this forward as evidence the repo leaked a secret, because it does not show one.
- **"Fish Audio voice output: working on free tier" — keep, and carry the paid state with it.** A real AES-256-GCM-encrypted Fish Audio credential is stored (`voice_credentials`, 1 row, written 2026-09-10). The runbook records the paid balance as **exhausted**.
- **"multi-model" is not a claim this build can make.** `lib/model-credentials.ts` declares `SUPPORTED_MODEL_PROVIDERS = ['gemini']`, and `lib/model-router.ts` classifies every other provider — Claude, DeepSeek, OpenRouter, Hermes — as honestly `UNSUPPORTED`. Locally there is no `.env` and `model_credentials` holds 0 rows, so no model key is configured at all right now; `conversation.respond` is correspondingly `DEGRADED` and answers extractively.
- **Test-figure attribution.** "1268 passing" is `synthos-admin`, re-verified green on 2026-09-12 (1,268 passed across 77 files, exit 0). It is **not** Mission Control's number — that repo is currently 3,174 passed / **3 failed**, including two failures of its own `/api/public` token-authorisation guard. Never quote one figure for "SynthOS".

## 6. Knowledge / Obsidian — next P0

Every meaningful SynthOS conversation, discussion, voice directive, agent exchange, execution and decision should become searchable knowledge regardless of model/runtime.

Sources include Jarvis, Hermes, Hermes Bot Mode profiles, Claude, Gemini, OpenAI, Codex, Cursor, Antigravity, OpenClaw, graphs, scheduled jobs, voice directives, Business Conversation AI, agent-to-agent work, approvals, and meaningful tool results.

Hermes does not own memory ingestion. Obsidian does not belong to Hermes. Knowledge ingestion is a SynthOS platform capability.

### Two layers
**Activity:** complete observable history.  
**Knowledge:** semantically useful information derived from that history.

Do not generate thousands of useless files named `Assistant-Log-<timestamp>` or `Voice-Directive-<timestamp>`.

Conversation/session records need semantic titles such as:
`Gigs-eSIM-Provisioning-and-Missed-Call-Recovery__2026-09-11.md`

Use semantic title, summary, topics, normalized tags, project, runtime/model provenance, workspace, related knowledge, decisions, requirements, action items, artifacts/receipts and wikilinks.

The user must be able to search by **what the discussion was about**, not by date.

### Obsidian connection truth
The local Markdown vault is the integration boundary. Do not conflate vault connectivity with whether the Obsidian desktop app is running.

> **Relabel 2026-09-12 — this section is a target, not a description.** `synthos-admin` today has **no Obsidian integration at all.** `lib/vault.ts` hardcodes `VAULT_ROOT = path.join(process.cwd(), 'vault')` — a repo-local artifact store written only by `writeWorkspaceArtifact()`. There is no vault-path environment variable (confirmed against the full declared list in `lib/env-readiness.ts`), no configurable path, no watcher, no sync, and no reader for the real ~1,204-note vault at `~/synthos/vault`. `lib/memory-index.ts` is a real SQLite FTS5 index, but only over those repo-local artifacts (42 rows locally). Every truthful state this section asks the dashboard to expose — *path configured / exists / readable / writable / index ready / watcher status* — is `NOT_IMPLEMENTED` today. That is the work, not the status.

Dashboard should expose truthful states:
- vault path configured
- path exists
- readable
- writable
- index ready
- watcher/sync status
- optional desktop detected/not detected/not required

## 7. Jarvis / voice configuration issue

There has been a CLI vs dashboard configuration mismatch.

The next repair must determine the single canonical configuration source and make CLI + dashboard reflect the same runtime setting.

Separate:
- agent display name
- voice profile display name
- provider voice ID
- TTS model
- voice provider

The provider's opaque voice ID must not force the agent to be named “Jarvis.” Dashboard must show the current real provider/model/voice, test real voice, change supported voice, save, persist after restart, and affect the actual runtime.

## 8. White-label Hermes Bot Mode

Hermes is a runtime that can support persistent specialist agents.

Desired white-label Bot Mode concepts:
- agent profile
- role
- persona
- scoped memory
- skills
- tools/connectors
- task inbox
- communication identity
- approval policy
- escalation
- business knowledge
- inter-agent delegation

Agent preconfiguration should feel like onboarding an employee.

Role templates may include Front Desk, Sales Concierge, Customer Support, Office Assistant, Growth / Visibility, Executive Assistant, Legal Intake, Retail Sales.

Each role template defines instructions, approved knowledge, skills, required connectors, allowed/prohibited actions, communication tone, approval defaults, handoff behavior and success criteria.

## 9. Connectors / tool layer

Concierge needs provider-neutral tool access through some combination of:
- native API integrations
- MCP
- Composio-style connector platform
- browser automation
- specialized providers

Customer-facing UX should say **Connect your tools**, not force users to understand MCP.

Important connector domains:
Google Calendar, Gmail/Google Workspace, Microsoft 365/Outlook, CRM, Salesforce, HubSpot, Clio, Shopify, Stripe, QuickBooks, Slack, Teams, Notion, Google Drive, Dropbox, Google Business Profile, CMS/WordPress/Webflow/Framer, scheduling, travel, support/helpdesk, payments, practice management.

All external actions remain governed by Guardian / policy / approval.

## 10. Agent communications identity

Business agents may need:
- business role/name
- avatar/photo
- voice
- business email address
- phone/business line
- authorized channels
- business signature
- approved hours
- escalation target
- disclosure policy
- knowledge scope
- tool permissions
- language support

Desired agent email concept: `concierge@theirdomain`.
Every outbound email/message/call-related action must be behind policy/approval as appropriate and generate evidence/receipt.

## 11. Communication skills that must be explicitly defined

Do not rely on one giant generic prompt.

### Missed-call recovery
Inputs: caller, business, voicemail transcript, timestamp, contact match, prior conversation, business hours, consent/channel permissions.

Possible actions: create callback task, notify assigned employee, send approved reply, send secure Voice/Video Concierge link, schedule only when real availability is confirmed.

Rules: do not invent caller intent; do not impersonate a human; do not promise an appointment without real confirmation; honor opt-out/DNC/quiet hours; escalate ambiguity.

### Appointment booking
Inputs: customer, service, requested time, real calendar availability, location/timezone, duration, staff rules, prior context.

Rules: never claim booking without calendar confirmation; never invent availability; confirm required details; persist booking reference/evidence.

### Return missed call / human callback
Possible modes: prepare employee callback, dial/connect to human, send secure voice/video link, approved text/email follow-up. The AI must not automatically place external calls merely because a voicemail exists.

## 12. Web + mobile product

### Web
- secure public assistant
- embed
- text
- voice
- optional video
- knowledge
- qualification
- actions/cards
- follow-up
- human takeover
- business branding

### Mobile
Do not build a shrunken admin dashboard.

Primary navigation concept:
- Concierge
- Inbox
- Business
- Line
- Knowledge
- More

Concierge is the home screen. Primary interaction: Talk / Type.

Responses may render interactive cards for appointment, customer/lead, plan/eSIM, invoice, product, audit, approval, connector, task, contact, knowledge and handoff.

## 13. B2B / B2C / Enterprise

### B2B
One persistent business representative with business knowledge, customer conversations, web/voice/video, communications identity, CRM/calendar/email/tools, growth/AEO/SEO/GEO, memory, approvals, receipts and optional line/eSIM.

### B2C / personal
Personal agent with memory, research, approved tools, voice, communication, task execution, permission controls and optional connectivity.

### Enterprise
Enterprise is more than “add seats.” It needs companies, teams/locations, managers/employees, roles, multiple lines, shared business knowledge, private scope boundaries, policies, approval routing, capability packs, employee onboarding/offboarding, eSIM/line assignment, usage/budget controls and audit receipts.

## 14. 0ID / SynthOS Zero concept

Future consumer/private communications component:
allow person-to-person / person-to-agent communication without requiring public disclosure of phone number, email or name.

Do not claim this is implemented until a repository/component is selected and proven.

There are multiple candidate GitHub repos to compare before final architecture. Compare license, mobile stack, identity model, encryption, signaling, WebRTC, push notifications, key management, federation, scalability, auditability, maintainership, dependency risk and ability to embed inside the SynthOS mobile product.

## 15. Growth / AEO / SEO / GEO

Conversation is a first-party source of market intelligence.

The system should learn from real customer questions, objections, comparisons, missing information, location/service queries and conversion outcomes.

Flow:
conversation → repeated question/gap → audit → evidence → content brief → draft → schema → verification → approval → publish → recheck → outcome → knowledge.

Major demo: customer asks why business is not appearing in AI answers. Concierge invokes audit capability, shows evidence, drafts approved AEO content and publishes only through a real configured integration and approval gate.

## 16. Website / design direction

The public website should be built around **the agent at work**, not feature cards.

First 3 seconds should communicate:
- this is already operating
- this is not another chatbot
- the agent can act
- the system remembers
- the owner stays in control

Website must use real application data, not fake demo telemetry.

Primary explainer stories:
1. agent opens browser while helping customer with a setting
2. agents/capabilities perform AEO/SEO/GEO audit
3. agent drafts/verifies/gets approval/publishes AEO content
4. missed-call → voicemail → secure Voice/Video Concierge recovery
5. connector needed → user connects Calendar/CRM/email → task completes

Website areas include Home, Product/Concierge, Business, Personal, Enterprise, Mobile, Web Assistant, Voice + Video, Memory, Communications, Growth/AEO SEO GEO, Integrations, Security/Governance, Developers, Docs, Setup, Pricing, FAQ, About, Contact and Login.

Visual direction:
- place, not page
- one persistent Concierge object through the story
- high-resolution typography/images
- SVG/vector quality
- modern Motion/Framer-quality interaction
- motion explains architecture
- no generic purple AI template
- no fake stats/logo walls/testimonials

## 17. Demo design principle

The demo should prove **same product, different business knowledge**.

Recommended examples:

### Attorney
“My father passed away and I need to understand what documents I should bring.”
Show knowledge → safe intake → appointment → handoff → memory.

### Mattress
“I sleep hot and my lower back hurts. What should I look at?”
Show product knowledge → comparison → objection → location/delivery → appointment → AEO signal.

### Car dealer
“Do you have a hybrid SUV under $45k and can I come after work?”
Show inventory connector → comparison → real availability → sales appointment → rep handoff.

### HVAC
“My AC stopped working and it’s 90 degrees. Can someone come today?”
Show service area + urgency policy → real availability → scheduling/handoff → follow-up.

Every demo should visibly prove real conversation, approved knowledge retrieval, optional connector/tool call, action, Guardian when required, receipt and knowledge writeback.

## 18. Truth rules

Never fabricate integrations, customers, telecom status, usage, calls, model/provider execution, receipts, knowledge, audit results, scores, availability, appointments, publishing or security states.

Use LIVE / PARTIAL / NOT_CONFIGURED / BLOCKED / UNKNOWN / UNAVAILABLE.

Feature complete means **CODED + WIRED + VISIBLE + VERIFIED**.

## 19. Immediate work order

1. Complete Universal Knowledge Ingestion / Obsidian truth / semantic naming / Jarvis voice settings repair.
2. Finalize full Concierge/MVNO functional scope and architecture before further large build passes.
3. Compare the 0ID GitHub candidates once URLs are supplied.
4. Define connector strategy (native vs MCP vs Composio-style broker vs browser).
5. Define agent preconfiguration + communication skills.
6. Build/align mobile Concierge shell around conversation-first UX.
7. Implement Gigs connectivity capabilities without making Gigs the AI layer.
8. Add missed-call/voicemail recovery workflow.
9. Produce vertical demos for attorney, mattress, dealer and HVAC.
10. Advance public site using real product data and real recordings.

## 20. Process rules for the new chat

- Do not make the user re-explain architecture.
- Do not restart from old Mission Control assumptions.
- Do not treat Hermes as the OS foundation.
- Do not rebuild working Conversation AI.
- Do not reopen Graph Builder unless a real workflow requires an advanced feature.
- Do not turn Concierge into a PSTN call-center project.
- Do not substitute telecom for in-app voice.
- Do not generate demo data where real data is required.
- Do not burn premium-model usage on formatting, file naming or repetitive PRD review.
- Prefer one bounded implementation prompt at a time.
- Repo/runtime evidence beats old documentation when they conflict.
- Preserve historical UX value, but replace fake values with real data/truth states.
- Revenue/product functionality takes precedence over dashboard perfection.

## 21. Recommended Project source files

Add these if available:
1. This handoff file — canonical current-state context.
2. `SYNTHOS-MASTER-COMPONENT-CHECKLIST.md`
3. `Aetheris_Concierge_Executive_Master_Business_Plan.pdf`
4. `SynthOS_Master_PRD_v1_0_Combined_2026-08-16.md`
5. `synthos_consolidated_prd_v0_2.pdf`
6. Latest Business Conversation AI docs:
   - `docs/products/business-conversation-ai/PRODUCT-PRD.md`
   - `docs/products/business-conversation-ai/CAPABILITY-MAP.md`
   - `FIRST-CUSTOMER-RUNBOOK.md`
7. Latest repo status / Claude output showing branch, tests, build and blockers.
8. Universal Knowledge Ingestion prompt from 2026-09-11.
9. AI Studio website/design master prompt from 2026-09-11.
10. URLs for the three candidate 0ID GitHub repos when available.

Avoid loading dozens of obsolete PRDs into the Project. Use this handoff as the current decision layer; older docs are supporting/reference material.

## 22. Suggested first message in the new Project chat

> Use `SynthOS_Concierge_Project_Handoff_2026-09-11.md` as the current canonical decision layer. Older PRDs are reference material and must not override newer decisions or repo evidence.
>
> The key product thesis is that the power is in **conversation + accumulated business knowledge**. We need the same Concierge to demonstrate materially different behavior for an attorney, mattress retailer, car dealer and HVAC business by changing approved knowledge, skills, connectors, permissions and workflows — not by creating four separate products.
>
> First, review the handoff and tell me only:
> 1. whether you see any contradictions that would block architecture work,
> 2. what source files are missing,
> 3. the proposed functional-scope outline we should lock before drawing the final architecture.
>
> Do not start coding yet.
