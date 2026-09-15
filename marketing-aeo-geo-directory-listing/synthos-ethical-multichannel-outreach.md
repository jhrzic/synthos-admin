# Synthos ethical multi-channel marketing and outreach workflow

## 1. Operating constraints

This workflow is a supervised **discover → assess → approve → contact → respond → verify → learn** system for marketing Synthos and installing Caitlyn on a customer site, browser, or MCP surface.

Non-negotiable invariants:

1. **Private operating layer, public marketing layer.** Synthos remains invite-only. The public website and approved campaign pages may be crawlable; agent control planes, prospect records, audit work, approval queues, and Caitlyn configuration remain authenticated and private.
2. **10 core agents are always available; one vertical pack adds 3-7 roles.** A campaign therefore has **13-17 active roles**, selected from the 30-agent library. **Never run all 30** as concurrent processes. A role can be a capability invoked by the orchestrator rather than a persistent process.
3. **No approval, no contact.** Nine core agents have no external-contact permission. Outreach is the only core role technically able to release a message, and it can do so only with a human-issued, single-use release token tied to the exact recipient, channel, content hash, sender identity, and send window.
4. **No autonomous spend.** Agents may estimate cost and request an allocation. They cannot purchase lists, ads, enrichment, data, inboxes, domains, or model capacity, nor exceed a workspace allocation. Public visitors trigger zero paid compute.
5. **Nothing commits unverified.** Claims, recipient eligibility, links, landing pages, CRM changes with external consequences, and every rendered message pass policy and independent verification before a human can approve them.
6. **Respect intent.** Relevance, truthful identity, minimal data, clear opt-out, low frequency, and an immediate stop after disinterest outrank volume.
7. **Policy is configuration, not agent opinion.** Counsel/operations owns jurisdiction and channel rules. Agents attach policy flags and escalate unknown cases; they do not make legal conclusions.

### Hard permission boundary

| Capability | Default | Required authority |
|---|---:|---|
| Read public web pages at conservative rates | Allowed | Research policy |
| Read authenticated/private sources | Denied | Source owner authorization + scoped connector |
| Buy data, ads, tools, domains, or compute | Denied | Human budget approval and normal purchasing control |
| Draft content or replies | Allowed | Internal only |
| Publish a page or public post | Denied | Human approval of exact artifact/version |
| Send email, DM, connection note, or chat reply | Denied | Human approval + single-use release token |
| Install Caitlyn or change a customer integration | Denied | Customer admin authorization + human change approval |
| Remove/override suppression | Denied | Privacy/compliance owner; reason and audit trail required |

## 2. Agent responsibilities

### 10 core agents

| Core role | Responsibility | Produces | Cannot do |
|---|---|---|---|
| **Chief of Staff** | Orchestrates the state machine, assigns pack roles, enforces dependencies and budgets | Campaign brief, work graph, approval packet | Contact, publish, spend, or waive gates |
| **Researcher** | Ingests personas, discovers companies, gathers public evidence, records provenance | Account/contact candidates, evidence bundle, source timestamps | Bypass access controls, infer sensitive traits, contact |
| **Strategist** | Chooses segment, value hypothesis, channel mix, sequence, stop rules | Campaign strategy and test hypothesis | Send, spend, or declare legal eligibility |
| **Copywriter** | Creates honest, concise, evidence-bound micro-audits, messages, and replies | Message variants with claim-to-source map | Invent familiarity/results or send |
| **Designer** | Builds accessible landing and audit visuals | Approved-design candidate, accessibility notes | Publish or use manipulative patterns |
| **Web/Coder** | Pre-renders campaign pages and prepares site/browser/MCP install plans | Staging page, signed build, test/rollback plan | Production deploy or customer install without approval |
| **Outreach** | Renders and releases approved messages; processes provider events | Exact message render, send receipt, channel status | Generate its own approval, alter approved content, spend |
| **Distributor** | Queues approved public/organic content and coordinates owned-channel placement | Distribution queue and attribution links | Unapproved posting, paid promotion, customer DMs |
| **Ops** | Owns CRM transitions, consent ledger, suppression, throttles, sender health, budgets | Eligibility decision inputs, caps, alerts, audit log | Override suppression or approve its own exception |
| **Verifier** | Independently checks evidence, claims, links, identity, policy, rendering, state, and outcomes | Pass/fail report and reason codes | Edit the artifact it verifies or contact prospects |

Only **Outreach** holds an external-send capability. Its API requires all gates plus a single-use release token. Distributor can publish only an already-approved public artifact through a separate publish token; it has no direct-message permission.

### Vertical pack: activate 3-7 of the remaining 20 library roles

Choose one pack per campaign unless a human approves a documented cross-pack need. Typical role modules:

1. **Vertical domain analyst** — validates industry terminology, workflows, and value hypothesis.
2. **Vertical policy analyst** — maps counsel-authored rules to sector-specific risks; marks `unknown` rather than guessing.
3. **Buyer-language specialist** — adapts vocabulary and proof level to the persona without stereotyping.
4. **Micro-audit rubric specialist** — selects safe, observable audit checks for the vertical.
5. **Channel etiquette specialist** — enforces platform and community norms.
6. **Integration mapper** — scopes site, browser, or MCP installation prerequisites and rollback.
7. **Localization/accessibility specialist** — checks locale, language, accessibility, and cultural fit.

Pack roles inherit a deny-by-default policy: no contact, publishing, spend, credential use, or production change. They return structured work to the core agents and then may be suspended to control cost.

### Caitlyn's role

Caitlyn is the named prospect/customer interaction interface operating inside the Outreach permission boundary, not an eleventh unrestricted sender. For outreach replies, Caitlyn classifies intent, updates a proposed CRM transition, retrieves approved knowledge, drafts a response, and routes it to a person. **No unsupervised contact:** every email, social, or chat reply needs a human release token. On an installed customer surface, any future automation mode must be a separately contracted, disclosed, bounded configuration; it is outside this no-unsupervised-contact campaign workflow.

## 3. Canonical records and data minimization

Each record has a workspace ID, immutable event history, source provenance, retention class, and owner.

- `Persona`: business problem, role/seniority ranges, firmographic criteria, exclusions, permitted geographies, prohibited sensitive attributes, channel preferences, value hypothesis, version.
- `Account`: legal/company name, domains, industry, size band, geography, observed public signals, fit score, sources, timestamps, confidence.
- `Contact`: business identity, role relevance, channel address/handle, source, verification status, consent/channel flags, last contact, frequency ledger. Store only what is needed.
- `PolicyDecision`: jurisdiction, organization/contact type, channel, source category, consent/lawful-basis flag, platform restriction, do-not-contact status, decision (`eligible`, `restricted`, `unknown`, `ineligible`), ruleset version, reviewer.
- `AuditFinding`: URL/source, observation, captured time, evidence, confidence, materiality, safe recommendation; no exploit data or private content.
- `Artifact`: exact message/page/reply, content hash, claims and evidence, variant, accessibility result, approver, expiry.
- `Approval`: actor, scope, exact hash, recipient/channel, permitted send window, expiry, reason, optional batch ID. Approval is immutable and non-transferable.
- `Suppression`: normalized destination plus hashed lookup key, channel/scope, reason, source, effective time, optional legal retention basis. Suppression survives ordinary record deletion.
- `BudgetAllocation`: workspace, category, hard ceiling, currency, approver, validity. Missing allocation means zero.

Do not collect protected/sensitive traits, personal-life details, inferred health/financial status, login-only information, or unnecessary personal contact data. Do not use anonymous site visits to identify or contact a person elsewhere.

## 4. Event contract

Every event is append-only and contains:

```text
event_id, event_type, occurred_at, workspace_id, campaign_id,
subject_type, subject_id, actor_type, actor_id, causation_id,
correlation_id, policy_ruleset_version, artifact_hash,
approval_id, idempotency_key, source_provenance[], payload
```

Sensitive payloads are access-controlled; logs use internal IDs rather than message bodies or raw addresses. Consumers are idempotent. A later correction adds an event; it does not rewrite history.

Core events:

- `PersonaIngested`, `PersonaValidated`, `PersonaRejected`
- `AccountDiscovered`, `AccountDeduplicated`, `AccountQualified`, `AccountDisqualified`
- `ContactSourced`, `ContactVerified`, `ContactInvalidated`
- `PolicyEvaluated`, `ConsentCaptured`, `EligibilityRestricted`
- `AuditRequested`, `AuditCompleted`, `AuditVerified`, `AuditRejected`
- `LandingBuilt`, `LandingVerified`, `ArtifactReady`
- `ApprovalRequested`, `ApprovalGranted`, `ApprovalExpired`, `ApprovalRevoked`
- `PreflightPassed`, `PreflightFailed`, `TouchReleased`, `DeliveryUpdated`
- `InboundReceived`, `IntentClassified`, `ReplyDrafted`, `HumanEscalated`, `ReplyReleased`
- `OptOutReceived`, `SuppressionApplied`, `CampaignPaused`
- `MeetingBooked`, `InviteOffered`, `InviteAccepted`, `InstallAuthorized`, `InstallVerified`
- `ExperimentConcluded`, `LearningProposed`, `LearningApproved`

## 5. Workflow, gates, and events

| Stage | Agent path | Gate and required evidence | Event / CRM result |
|---|---|---|---|
| 0. Campaign charter | Chief of Staff → Strategist → Ops | Named owner; persona/version; countries; channels; exclusions; sender identities; volume ceiling; zero/default spend; stop rules; retention; KPI hypothesis | `CampaignDrafted` → `PLANNED` |
| 1. Persona ingestion | Researcher + buyer-language pack role | Schema valid; business relevance; no sensitive/prohibited criteria; source/owner documented; Verifier checks exclusions | `PersonaIngested`, `PersonaValidated` |
| 2. Company discovery | Researcher + vertical analyst | Public or authorized source; robots/terms/rate policy honored; account-domain dedupe; fit reasons cite evidence; no paid enrichment without approved allocation | `AccountDiscovered` → `DISCOVERED` |
| 3. Contact and legal evaluation | Researcher → Ops + policy pack role | Business-role relevance; provenance; channel validity; consent/lawful-basis and jurisdiction from counsel rules; platform rules; suppression; ambiguous = `unknown` and blocked | `ContactSourced`, `PolicyEvaluated` → `ELIGIBLE`, `RESTRICTED`, or `SUPPRESSED` |
| 4. Personalized micro-audit | Researcher → domain/rubric role → Strategist → Copywriter | Public, passive, reproducible checks only; every claim cited; no invasive security testing; confidence shown; no fabricated benchmarks; Verifier independently reopens sources | `AuditCompleted`, `AuditVerified` → `AUDITED` |
| 5. Landing and message production | Copywriter + Designer + Web/Coder | Honest identity; one clear CTA; evidence mapping; accessible/mobile render; no dark patterns; no sensitive URL parameters; static/pre-rendered page; link and analytics checks | `LandingBuilt`, `ArtifactReady` → `READY_FOR_APPROVAL` |
| 6. Human approval | Chief of Staff assembles; human owner decides | Human sees recipient, source, policy status, full rendered message, audit evidence, landing preview, sequence history, timing, sender, and risk flags. Approval covers an exact hash and one touch only | `ApprovalGranted` → `APPROVED` |
| 7. Send-time preflight | Ops → Verifier → Outreach | Approval unexpired; exact hash; identity/authentication healthy; recipient still eligible; suppression is checked twice (queue and release); throttle/budget/time window pass | `PreflightPassed`, `TouchReleased` → `CONTACTED` |
| 8. Delivery and response | Provider events → Ops → Caitlyn | Delivery status mapped idempotently; bounce/complaint/opt-out pauses future work immediately; inbound intent and confidence recorded; sensitive/negative/contractual cases routed to a person | `DeliveryUpdated`, `InboundReceived` → response state |
| 9. Human-approved reply | Caitlyn → Verifier → human → Outreach | Answer grounded in approved knowledge; no unapproved commitments; correct thread/context; single-use reply token | `ReplyReleased` → `ENGAGED`, `QUALIFIED`, or terminal state |
| 10. Invite/install | Strategist + Integration mapper + Web/Coder → customer admin → Verifier | Explicit customer admin authorization; least privilege; requested scope; workspace allocation; staging test; security review; data map; rollback; no credential exposure | `InviteAccepted`, `InstallAuthorized`, `InstallVerified` → `INSTALLED` |
| 11. Outcome and learning | Ops → Verifier → Strategist | Denominators complete; deliverability guardrails healthy; no suppressed contacts included; quality review; human approves any policy/template change | `ExperimentConcluded`, `LearningApproved` |

A failed gate creates a reason-coded task. No agent can skip forward or approve its own output. Material changes to recipient, channel, message, landing target, sender, schedule, or policy version invalidate approval.

## 6. Persona ingestion and company discovery details

### Persona ingestion

Accept structured uploads or human-entered briefs. Normalize only company and role attributes required for relevance. Reject or require revision when the persona uses protected characteristics, personal hardship, covert behavioral inference, or a vague “everyone” target.

Minimum persona acceptance:

- A job-to-be-done Synthos can plausibly help with.
- Observable firmographic and role criteria.
- Explicit negative criteria and geographies.
- A proof standard: what evidence may support personalization.
- Approved channels and contact-frequency ceiling.
- A named human campaign owner.

### Company discovery

Use public company sites, authorized directories, first-party CRM records, opt-in event lists, and vendors with documented provenance/contract rights. Do not scrape authenticated pages, evade rate limits, or import purchased lists without human procurement, source rights, and policy review. A public address is not automatically permission to use every channel.

Discovery score components: persona fit, observable trigger relevance, data confidence, auditability, channel eligibility, and existing relationship. Fit cannot override a legal, consent, platform, or suppression block.

## 7. Consent, legal, and source policy

Ops evaluates a versioned matrix per **jurisdiction × organization/contact type × channel × source × relationship**. The ruleset is supplied by counsel/privacy operations and records:

- Required consent/lawful-basis category and evidence.
- Business versus personal destination restrictions.
- Identification, address, disclosure, and opt-out requirements.
- Quiet hours, frequency, retention, and recordkeeping rules.
- Platform terms/API restrictions for chat and social.
- Sector-specific restrictions and internal exclusions.

Decision semantics:

- `eligible`: rule requirements and evidence are complete.
- `restricted`: permitted only after a named additional condition.
- `unknown`: conflict, missing country, unclear source, or stale ruleset; no outreach.
- `ineligible`: channel/contact cannot be used.
- `suppressed`: intent-based block; stronger than fit or approval.

Consent is channel- and purpose-specific. Revocation applies immediately to the relevant scope. A global “do not contact” blocks all outbound channels. Only the privacy/compliance owner can correct a mistaken suppression, with dual review and an audit event; campaign staff cannot override it.

## 8. Personalized micro-audit, landing pages, and channel playbooks

### Personalized micro-audit

The audit earns attention by being useful before asking for a meeting. It is not a fear tactic.

Template:

1. **Observed:** 1-3 factual observations from public pages, each with URL and capture time.
2. **Why it may matter:** a clearly labeled hypothesis, not a claim about hidden performance.
3. **Small opportunity:** one low-risk improvement or workflow Synthos/Caitlyn could support.
4. **Show, do not exaggerate:** a static mock/example using public information, with limitations.
5. **CTA:** ask whether the person wants the full audit, private invite, or install discussion.

Permitted checks include public navigation, accessibility surface checks, obvious FAQ/content gaps, publicly described workflows, and visible integration opportunities. Prohibited checks include credential attacks, vulnerability exploitation, intrusive scanning, form submission, hidden endpoint probing, bypassing controls, and collecting visitor data. Claims such as revenue lift or response-time improvement require approved evidence; otherwise use conditional language.

### Landing pages

- Default to a reusable vertical page; create an account-specific page only when its added relevance justifies the data exposure.
- Pre-render/static host so public visits incur **zero paid compute**. Caitlyn model calls occur only after an authenticated/authorized workflow funded by a workspace allocation.
- Use opaque, expiring identifiers; never put recipient email, personal name, or CRM ID in URLs. Account-specific pages should normally be `noindex` and excluded from public sitemaps even though the main website is crawlable.
- Show Synthos identity, privacy information, why the recipient is seeing the page, evidence timestamps, limitations, and a direct opt-out/contact route.
- Use first-party, minimal analytics. No fingerprinting or cross-site retargeting by default. Avoid open-tracking pixels; use aggregate delivery and intentional actions where possible.
- A request-invite or install CTA must disclose that Synthos is private/invite-only and that install requires an authorized administrator.

### Channel playbooks

**Email**

- Use a stable, truthful sender identity and monitored reply address; maintain domain authentication and provider feedback handling.
- Plain, specific subject; no fake `Re:`/`Fwd:`, false urgency, deceptive familiarity, or fabricated results.
- Keep the audit useful and concise. Include required identity/address disclosures and a one-step opt-out.
- Internal default sequence: initial message plus at most two follow-ups, each separately human-approved. Stop on any reply except a clear request to continue later. Never “break up” shame or pressure.
- Thread only when it is a genuine continuation. Do not rotate domains/inboxes to evade reputation controls.

**Chat**

- Synthos public-site chat is inbound-only. Anonymous visitors are not deanonymized or contacted elsewhere. A static FAQ/contact experience avoids paid compute for public browsing.
- When a visitor intentionally submits a question, Caitlyn may classify and draft privately; a human approves the response before release under this workflow.
- On a customer site, disclose Caitlyn’s nature and the operating organization. Collect only necessary information, provide human escalation, and do not imply monitoring beyond the disclosed scope.

**Social**

- Prefer relevant public content and genuine engagement over unsolicited DMs.
- No automated scraping, mass following, connection automation, engagement pods, or platform-rule evasion.
- A connection note or DM is drafted from public professional context, reviewed, and sent manually or via a permitted official API with a single-use release token.
- Do not repeat an email pitch immediately on social. Cross-channel follow-up counts toward the same contact-frequency ledger.

### Caitlyn inbound response handling

Caitlyn processes inbound events without independently contacting the person:

1. Match the thread and verify sender/recipient context; quarantine suspicious attachments or prompt-injection-like content.
2. Immediately detect opt-out, complaint, wrong person, legal/privacy request, and negative sentiment before ordinary intent classification.
3. Classify into `OPT_OUT`, `NEGATIVE`, `NOT_NOW`, `WRONG_PERSON`, `QUESTION`, `INTERESTED`, `MEETING`, `INVITE`, `INSTALL`, `SUPPORT`, `LEGAL_PRIVACY`, or `ABUSE`, with confidence and cited message span.
4. Apply deterministic state/suppression actions where required; uncertain cases route to a human without a reply.
5. Retrieve only approved product, security, pricing, and install knowledge; draft a bounded answer. Never invent pricing, roadmap, availability, security guarantees, or contractual terms.
6. Verifier checks grounding, tone, recipient/thread, links, commitments, and CRM proposal.
7. A person edits/approves the exact reply; Outreach releases it with a single-use token.
8. Meeting, invite, and install requests go to the named owner. Caitlyn cannot grant production access or authorize installation.

Suggested response SLAs are internal goals, not permission to auto-send: opt-outs applied within minutes; positive or support replies surfaced promptly during business hours; legal/privacy and security matters immediately escalated.

## 9. CRM state machine

Canonical account/contact states:

```text
PLANNED
  → DISCOVERED
  → ELIGIBILITY_REVIEW
  → ELIGIBLE | RESTRICTED | DISQUALIFIED | SUPPRESSED
ELIGIBLE
  → AUDITED
  → READY_FOR_APPROVAL
  → APPROVED
  → QUEUED
  → CONTACTED
CONTACTED
  → DELIVERED | SOFT_BOUNCE | HARD_BOUNCE | COMPLAINT
DELIVERED
  → NO_RESPONSE | ENGAGED | NEGATIVE | NOT_NOW | WRONG_PERSON | OPTED_OUT
ENGAGED
  → QUALIFIED | UNQUALIFIED
QUALIFIED
  → MEETING_BOOKED
  → INVITE_OFFERED
  → INVITE_ACCEPTED
  → INSTALL_AUTHORIZED
  → INSTALLED
INSTALLED
  → VERIFIED_ACTIVE | ROLLED_BACK | CLOSED
```

Global/terminal precedence:

- `OPTED_OUT`/`SUPPRESSED` cancels every queued touch in scope immediately.
- `COMPLAINT` and `HARD_BOUNCE` suppress that destination and pause related sequence work.
- `NEGATIVE`, `WRONG_PERSON`, `UNQUALIFIED`, `DISQUALIFIED`, and `CLOSED` stop the sequence unless the person explicitly requests otherwise.
- `NOT_NOW` stores an explicit requested date or an approved cooling-off date; no hidden nurture loop.
- New evidence may move `RESTRICTED` back to review, never directly to `APPROVED`.
- Install success is not `VERIFIED_ACTIVE` until health, permissions, data boundaries, disclosure, rollback, and customer acceptance checks pass.

Transition requirements include actor, reason code, evidence/event ID, previous state, new state, and policy version. Invalid transitions fail closed and alert Ops.

## 10. Throttling and deliverability controls

Apply limits at **workspace, campaign, sending domain, mailbox, provider, channel, company, contact, and jurisdiction** levels. The strictest limit wins.

Conservative launch defaults (internal policy starting points, adjusted only by Ops after evidence):

- New email sender: low daily cap (for example 10 manually approved messages/mailbox/day), gradual increases no larger than 25% between review periods, and no sudden volume spikes.
- One company: no more than two concurrently contacted people without explicit account-owner approval.
- One person: initial plus at most two follow-ups across all outbound channels; minimum business-day spacing configured by region.
- Social DMs/connection notes: lower than email and always individually reviewed.
- Quiet hours use recipient-local business time; unknown timezone uses the more conservative campaign window.
- Per-domain concurrency and retry caps prevent bursts. Retries use provider result codes; hard failures are never retried.

Automatic pause conditions are safety brakes, not optimization targets:

- Any complaint or provider abuse warning triggers immediate review of the affected segment/sender.
- Hard-bounce rate at or above 2% in a meaningful rolling sample pauses the source/segment.
- Complaint rate at or above 0.1% pauses the sender/campaign.
- Opt-out rate at or above 1%, a sharp negative-reply increase, authentication failure, blocklisting signal, or anomalous volume triggers review.
- Small samples use absolute-event alerts to avoid hiding one serious event behind percentages.

Ops may lower caps automatically. Raising caps requires human approval. There is no agent-controlled inbox rotation, domain rotation, paid warm-up, or spend increase. A preflight budget check must resolve to an approved allocation; otherwise external cost is zero and the action is blocked.

## 11. Suppression and opt-out

1. Detect unsubscribe links, natural-language opt-outs, “wrong person,” complaints, and channel-level blocks from every inbound/provider source.
2. Process explicit opt-outs deterministically before LLM classification. Apply the suppression event, cancel queued touches, and then allow only a required/approved confirmation.
3. Normalize destination identifiers and retain a salted/hash lookup key so deletion requests do not cause accidental re-contact. Restrict raw values and retention to the minimum required by policy.
4. Propagate suppression to CRM, outreach queue, social queue, Caitlyn drafts, and imported-list matching. Reconcile failed propagation until all systems acknowledge.
5. Suppression is checked twice: when work is queued and atomically at release. The release transaction fails if suppression changed after approval.
6. Honor channel-specific and global scope exactly; when ambiguous, choose the broader block and route for review.
7. Never make opt-out conditional on login, explanation, or additional marketing. Never use an opt-out as a reason to switch channels.

## 12. Verification

Verifier is independent from the producing agent and returns machine-readable reason codes.

### Before approval

- Persona uses allowed attributes and exclusions.
- Account/contact source, capture time, and relevance are present.
- Policy decision is eligible under the current ruleset; suppression is clear.
- Each factual statement maps to accessible evidence; uncertainty is labeled.
- Micro-audit is passive, reproducible, and non-alarmist.
- Message shows truthful identity, channel-required disclosures, opt-out, and valid CTA.
- Landing page is static, safe, accessible, mobile-tested, and free of personal URL data.

### At release

- Exact content hash equals the approved hash.
- Human approver is authorized; approval and send window are live.
- Release token is single-use and bound to recipient/channel/sender.
- Current suppression, frequency, quiet-hour, deliverability, and budget checks pass atomically.
- Sender authentication/health and reply monitoring are operational.

### After release/install

- Provider receipt and CRM event agree; discrepancies are quarantined.
- Bounce, complaint, opt-out, and reply events arrived and propagated.
- Landing links and CTA work without paid compute on passive visits.
- Caitlyn reply claims are grounded; human approval is recorded.
- Installation uses least privilege, passes staging/health/data-boundary tests, shows disclosure, and has a tested rollback.
- Weekly sampling compares audit claims and intent labels to human review. Factual error, policy false-negative, or unauthorized-send defects trigger rollback/pause.

## 13. Learning loop

1. **Observe:** collect delivery, reply intent, audit usefulness, landing actions, approvals/edits, suppression, install, and customer acceptance events. Avoid vanity tracking and fingerprinting.
2. **Verify data quality:** reconcile provider and CRM denominators; exclude tests, duplicates, invalid destinations, and already-suppressed records.
3. **Diagnose by segment:** separate persona fit, source quality, sender reputation, copy, offer, channel, and timing. Never optimize solely for opens.
4. **Propose one bounded change:** Strategist states hypothesis, audience, variant, primary metric, harm guardrails, sample/time box, and rollback.
5. **Human approves experiment:** no policy, volume, spend, source, or channel expansion without the relevant owner.
6. **Run safely:** fixed allocations; no autonomous reallocation; immutable assignment; stop on guardrail breach.
7. **Independent evaluation:** Verifier checks practical value and safety metrics, not just statistical uplift.
8. **Promote or reject:** a person approves template/rubric changes. Rejected variants and reasons remain available to prevent relearning harmful tactics.

Use approval edits as training signals only after redaction and explicit governance. Do not train on private messages, customer data, or sensitive fields by default. Negative responses reduce targeting/frequency; they are not prompts for more persuasive pressure.

## 14. KPI scorecard

Report counts and rates with numerator, denominator, time window, channel, segment, and confidence/sample caveat. Never combine channels in a way that hides harm.

### Safety and governance (primary gates)

- **Unauthorized sends:** target 0; count sends without valid release token/hash match.
- **Autonomous spend events:** target 0; count external charges without approved allocation.
- **Approval coverage:** approved released touches / all released touches; target 100%.
- **Suppression leakage:** touches released after effective suppression / suppressed destinations; target 0.
- **Opt-out propagation SLA:** time from inbound opt-out to all queue acknowledgments.
- **Policy completeness:** eligible records with provenance, jurisdiction, source, and ruleset / eligible records; target 100%.
- **Sensitive-data incidents, platform violations, and invasive-audit findings:** target 0.

### Deliverability and recipient experience

- Accepted, delivered, soft-bounce, and hard-bounce rates by sender/source.
- Complaint rate and provider abuse-warning count.
- Opt-out rate; negative, wrong-person, and “not now” rates.
- Contacts/company, touches/person, time between touches, and quiet-hour violations.
- Positive reply rate and qualified reply rate; use human-reviewed intent as the source of truth.
- Audit usefulness rate: recipients who explicitly call the audit useful or request more / delivered audits.

### Funnel and product outcomes

- `DISCOVERED → ELIGIBLE → AUDITED → APPROVED → DELIVERED` conversion and time in state.
- Landing intentional-action rate (request invite, audit, meeting, or install), not passive page views alone.
- Meeting booked / qualified conversations; show rate.
- Invite acceptance / invites offered.
- Install authorization / qualified opportunities.
- Verified Caitlyn installations / install authorizations.
- Time from positive reply to human response; time from authorization to verified install.
- 30-day retained/healthy installs and customer-confirmed value signal.

### Quality and operating efficiency

- Evidence coverage: factual claims with valid citations / factual claims; target 100%.
- Audit factual-error rate and stale-source rate.
- Caitlyn intent classification agreement with human review.
- Draft acceptance rate, material-edit rate, and top edit reasons.
- Verifier first-pass rate by artifact type and reason code.
- Human approval latency and queue age.
- Cost per verified install, reported only from approved allocations; never used to justify unsafe volume.

A campaign can scale only if safety gates are green, deliverability is stable, audit quality is verified, and a human approves the new cap. Conversion lift never offsets suppression leakage, complaints, policy uncertainty, or unauthorized contact.

## 15. Human approval packet and operational dashboard

The approval screen should show outcomes first and logs second:

- **Who/why:** account, role, persona fit, source provenance, relationship, and exclusion checks.
- **Can we:** policy decision, jurisdiction, consent/lawful-basis flag, platform rule, suppression and frequency status.
- **What we observed:** cited micro-audit with confidence and captured time.
- **What will be sent:** exact rendered content, sender, channel, landing preview, all disclosures, send window, and previous touches.
- **Risk:** unknowns, claim flags, provider/sender health, budget impact (normally zero), and Verifier report.
- **Actions:** approve this exact touch, edit (which creates a new hash and re-verification), reject with reason, suppress, or escalate.

Bulk approval, if offered, still creates one immutable approval per exact recipient-message pair and must show the full batch, exceptions, aggregate risk, and every rendered artifact. Sampling alone is not approval. Approval cannot be delegated to an agent.

## 16. Rollout sequence

1. **Shadow mode:** use seeded/internal accounts; no external contact. Validate events, CRM transitions, suppressions, hashes, approval expiry, and rollback.
2. **Human-only pilot:** one vertical, one sender, one region, 10 core agents plus 3-5 pack roles, tiny manually approved cohort, static pages, no paid acquisition.
3. **Deliverability review:** reconcile every provider event and human-label every reply; repair source/copy/policy issues before increasing caps.
4. **Invite/install pilot:** only interested prospects; customer admin authorization; staging install; least privilege; verified rollback.
5. **Controlled expansion:** add one dimension at a time (persona, region, channel, or volume), never several at once; human approves caps and any budget.

Launch readiness requires: counsel-authored ruleset loaded; source registry; suppression propagation test; sender authentication and monitored reply inbox; provider webhooks; atomic preflight; human approval UI; static landing build; Caitlyn response queue; install authorization/rollback; verifier test suite; and incident owner. Until all are proven, remain in shadow mode.
