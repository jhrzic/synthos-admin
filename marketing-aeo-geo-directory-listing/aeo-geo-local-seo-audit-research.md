# Defensible AEO/GEO/Local SEO Audit Framework for Local Businesses

**Research date:** 2026-07-31  
**Initial verticals:** HVAC, legal, dentists, automotive  
**Purpose:** a hosted free micro audit that creates a truthful reason to act, followed by a deeper paid audit and measurable remediation.

## Executive recommendation

Do not sell a single opaque “AI/SEO score.” Publish three separate outputs:

1. **Readiness score (0–100):** evidence-backed, controllable conditions across Business Profile, site, entity, content, structured data, reputation, and conversion.
2. **Observed visibility:** sampled local-search and generative-answer outcomes, reported as frequencies and distributions—not as a permanent “rank.”
3. **Evidence coverage and uncertainty:** what could be verified, when, with which method, and the plausible score range created by missing or volatile evidence.

This separation matters because Google says local results are mainly based on relevance, distance, and prominence/popularity, while the detailed algorithm is confidential and better placement cannot be bought.[1] An audit can test observable proxies and outcomes; it cannot reverse-engineer the weighting or promise movement.

Google’s current guidance also says that eligibility for AI Overviews and AI Mode uses ordinary Search foundations: the page must be indexed and snippet-eligible, with no extra AI-specific technical requirements.[7] Consequently, “GEO” should be treated as measurement of answer visibility plus improvements to accessible, accurate, uniquely useful content—not a secret optimization layer.

## 1. Product architecture

### Free micro audit

**Goal:** identify 3–5 consequential, verifiable gaps in under five minutes of reading.

**Scope:**

- one business entity and one primary location or service area;
- homepage, primary location page, and up to two principal service/practice/procedure pages;
- public Google Business Profile fields and recent review sample;
- crawl/index eligibility and selected structured-data checks;
- small, disclosed prompt/query panel;
- a benchmark comparison only if the relevant cohort meets publication thresholds.

**Output:**

- readiness score, evidence coverage, and critical-risk flags;
- dimension bars with actual observations;
- benchmark percentile/range with cohort definition and sample size;
- “what this means” and three prioritized actions;
- a clear boundary: this is a snapshot, not a ranking guarantee or complete compliance review.

### Paid full audit

Add:

- all locations, main templates, canonical/indexation, internal links, page speed/page experience, sitemap and Search Console evidence;
- full Business Profile field/policy review, duplicates, categories, services, hours, attributes, photos, landing-page match, and multi-location governance;
- citation/entity consistency across first-party and material third-party sources;
- service/location content inventory, duplication and doorway-risk review;
- deeper review velocity/recency/response/topic analysis without inferring causation;
- category-specific credentials, claims, and content integrity;
- larger local-grid query panel and repeated generative-search prompt panel;
- Google Search Console, Business Profile Performance, Bing Webmaster Tools, analytics, and conversion evidence where the owner grants access;
- remediation backlog with owner, priority, expected mechanism, acceptance test, and recheck date.

Google Business Profile Performance provides views, searches, directions, call-button clicks, website clicks, and other interactions, but availability varies by business and the data includes both organic and Google Ads activity.[3] These are outcome signals, not proof that an individual optimization caused a result.

## 2. Scoring model

### A. Readiness score: sample weights

| Dimension | Micro | Full | What is measured |
|---|---:|---:|---|
| Business Profile/entity integrity | 25 | 15 | verified/claimed status when accessible; real-world name; address/service-area model; hours; primary/secondary categories; phone/URL; duplicate risk; first-party consistency |
| Local and service relevance | 20 | 15 | explicit services/practice areas/procedures; service-area truthfulness; page-to-intent match; useful location facts; internal linking; distinct local value |
| Reputation and corroboration | 15 | 15 | review count/rating/recency/response observables; independent mentions/links/directories; credential and award verification; consistency of claims |
| Technical crawl/index health | 15 | 10 | HTTP status, robots/meta controls, canonical, rendered text, mobile access, index evidence, sitemap, broken links, template defects |
| Answer usefulness/extractability | 10 | 15 | direct answers; clear headings; definitions, costs/ranges with caveats, process, eligibility, service limits, author/reviewer, sources, updated dates, usable tables/lists |
| Structured data integrity | 10 | 7 | valid JSON-LD; correct specific types; identity/address/hours consistency; visible-content match; supported properties; rich-results eligibility issues |
| Conversion and accessibility | 5 | 8 | working call/booking/contact paths; mobile usability; form friction; accessibility basics; location-specific CTA and tracking |
| Governance, freshness, compliance | — | 15 | update ownership; review and content workflows; license/credential checks; claim substantiation; change monitoring; privacy and regulated-content controls |
| **Total** | **100** | **100** | |

These weights are a product rubric, **not claimed Google ranking weights**. Keep them versioned and stable for at least a quarter; change only with documented calibration evidence.

### B. Item scoring

Use a small anchored scale to reduce reviewer discretion:

- **0 — absent, false, blocked, or materially noncompliant**
- **1 — present but defective or materially incomplete**
- **2 — adequate and verifiably correct**
- **3 — strong, complete, and maintained**

For each item store: `dimension`, `weight`, `criterion_version`, `observed_value`, `score`, `rationale`, `evidence_id`, `captured_at`, `fresh_until`, `confidence`, and `status` (`known`, `unknown`, `not_applicable`). Never silently convert “unknown” to zero or “not applicable” to a pass.

**Dimension score:** weighted points earned divided by weighted points possible among known applicable items.  
**Coverage:** known applicable weight divided by all potentially applicable weight.  
**Uncertainty interval:** calculate a lower bound with unknown applicable items at 0 and an upper bound with them at 3. Publish the observed score, coverage, and bounds together. Do not publish a percentile when coverage is below 80%, any critical eligibility check is unknown, or the comparison cohort is too small.

### C. Critical gates and caps

A high average must not hide foundational failures:

- Site cannot be crawled, returns non-200, or has no indexable content: “Search eligibility at risk”; cap readiness at 40 until verified. Google identifies these as minimum technical requirements and explicitly says indexing is still not guaranteed.[11]
- Primary commercial pages carry `noindex`/snippet restrictions unintentionally: critical flag.
- Profile appears ineligible, falsely located, duplicated, or uses a misleading name/category: policy-risk flag; do not prescribe keyword stuffing. Google requires real-world representation, precise address/service area, few categories describing the core business, and generally one profile per business.[2]
- Materially false claims, fake reviews, fake locations, fabricated credentials, or mismatched structured data: integrity failure; withhold comparative badge and escalate for human review.
- Legal/medical safety or licensing facts cannot be verified: mark unknown; do not infer.

## 3. What each dimension should test

### Business Profile/entity integrity

- Exact business name matches real-world signage/branding and first-party site.
- Storefront versus service-area configuration is truthful; no virtual/fake office.
- Primary category reflects the core business; secondary categories are restrained.
- Address, phone, hours, holiday hours, URL, appointment/booking links, services, and attributes are complete and consistent.
- Landing page represents the same entity/location and has working contact paths.
- Duplicate/department/practitioner profiles are handled according to eligibility rules.

The defensible rationale is completeness, accuracy, and policy compliance. Google says complete and accurate profile information can improve matching; it also recommends verification, current hours, reviews, and photos.[1]

### Local/service relevance

- Build a canonical service taxonomy from actual offerings, not keyword volumes alone.
- Map each important query intent to a useful page or page section.
- A location page must contain operationally true details: staff, jurisdiction/service limits, arrival process, parking/access, equipment or procedures offered, local licenses, photos, case examples where permissible, and location-specific FAQs.
- Test that nearby-city pages answer a distinct user need. If only city names change, consolidate.

Google defines doorway abuse to include substantially similar city/region pages that funnel users to the same destination, and scaled content abuse includes mass-produced unoriginal pages with little value.[10] This is the governing guardrail for the shared template: reusable structure is acceptable; facts, utility, and intent must be genuinely location-specific.

### Reputation and corroboration

Measure, without causal overclaiming:

- total review count, rating, newest-review age, reviews in 30/90/365-day windows;
- owner response rate and median response delay where timestamps allow;
- distribution and recurring topics, with sample size and quoted evidence;
- suspicious bursts/duplication as “review integrity risk,” never an accusation without proof;
- relevant independent links/mentions/directories and consistency of entity facts;
- verified licenses, accreditations, memberships, publications, and awards.

Google says prominence includes information such as links and reviews, and that more reviews and positive ratings can help local ranking.[1] It does not publish a formula; the audit must not assign causal lift to one review or backlink.

### Technical eligibility

Verify with raw response and rendered evidence:

- DNS/TLS and final URL; status/redirect chain;
- robots.txt, robots meta, `X-Robots-Tag`, canonical, hreflang where relevant;
- Googlebot-accessible textual content, JavaScript rendering dependence, internal crawl paths;
- sitemap membership, Search Console inspection/index status when authorized;
- duplicate/thin URL patterns, broken internal links, mobile layout, performance and accessibility diagnostics.

### Structured data

Test syntax **and** truth:

- parse all JSON-LD and identify duplicate/conflicting entities;
- use the most specific applicable `LocalBusiness` subtype;
- validate `name`, `url`, `telephone`, `address`, `geo`, `openingHoursSpecification`, `image`, `sameAs`, and location relationships against visible and first-party facts;
- separate schema.org validity from Google rich-result eligibility;
- archive Rich Results Test/validator outputs and rendered visible text.

Google’s structured-data rules require markup to describe visible, relevant content and prohibit misleading markup or fake reviews.[4] LocalBusiness markup can communicate details such as hours and departments, but correct markup does not guarantee a rich result.[5] Self-serving review markup on pages controlled by the reviewed `LocalBusiness`/`Organization` is ineligible for Google’s star review feature.[6] Therefore never score “review schema installed” as an automatic win.

### Answer usefulness (AEO)

Evaluate a fixed question set based on customer tasks, not keyword density:

- Is there a concise, factually bounded answer near the question?
- Are prerequisites, exclusions, process, timing, price/range, service boundaries, and next steps clear?
- Are claims attributed to identifiable professionals or authoritative sources?
- Are dates and jurisdiction/location explicit where facts change?
- Can a reader complete the task without visiting many near-duplicate pages?
- Are tables, headings, lists, images, and video meaningful and accessible?

For Google AI features, ordinary SEO foundations apply; important content should be textual, structured data should match it, and Business Profile information should be current.[7] Google also advises unique, valuable people-first content and says more restrictive snippet controls limit AI-feature presentation.[7]

## 4. Observed visibility: keep it outside the readiness score

### Local-search observation panel

Report separately by surface:

- Maps/local pack;
- localized organic results;
- branded/knowledge result;
- AI answer surfaces.

For every observation capture:

- exact query, query class, coordinates or ZIP centroid, radius/grid node, language, device class, signed-in/personalization state if knowable, surface, timestamp/timezone;
- returned business/result identifier, displayed position, URL/profile, screenshot or licensed provider response, and collection method/version;
- whether ads or nonlocal modules appeared;
- repeat count and variation.

Never state “you rank #4 in the DMA.” State: “Observed median local-pack position 4 across 24 eligible grid/query observations, 2026-07-29–31; interquartile range 3–7.” Distance is explicitly one of Google’s principal local factors, so a single office or single GPS point is not a market-wide rank.[1]

Do not scrape Google Search directly for rank checking: Google’s spam policies characterize automated queries, including scraping results for rank checking without express permission, as machine-generated traffic that violates its policies and Terms.[10] Use owner-provided Search Console data, manual documented checks, or a provider with a lawful/approved collection basis.

### Generative visibility panel

Use a stable, versioned prompt bank with four intent groups:

1. **Discovery:** “Who provides [service] near [place]?”
2. **Comparison/qualification:** “Compare options for [constraint].”
3. **Problem/answer:** symptom, urgency, cost, process, or legal/clinical/service question.
4. **Brand verification:** hours, services, credentials, location, or reputation claims.

Measure per platform/surface and never merge them into a universal “AI rank”:

- answer-trigger rate;
- business mention rate;
- citation/link rate;
- cited-URL share and coverage across the site;
- factual entity accuracy (name, location, service, hours, credentials);
- recommendation/context polarity using a disclosed rubric;
- prompt coverage;
- repeatability/volatility across reruns and dates;
- referral sessions/conversions where analytics identifies them.

Capture exact prompt, platform/surface, locale, date/time, account state, model/mode when exposed, complete answer, citations and destination URLs, screenshot/export, and collector version. A micro audit should use at least two runs on two dates across a small disclosed panel; a full audit should use a stratified prompt bank with repeated runs. Report the denominator: “mentioned in 7 of 24 observed answers,” not “29% AI visibility” without context.

Authoritative measurement is improving but remains surface-specific. Google announced limited-rollout Search Console reports for AI Overviews and AI Mode impressions, with page/country/device/date dimensions.[8][9]

Bing’s public-preview AI Performance reports citations, cited URLs, grounding-query samples, and trends, while explicitly warning that citation counts do not indicate ranking, authority, importance, or placement.[13]

OpenAI says public sites can appear in ChatGPT search, OAI-SearchBot access is needed for content in summaries/snippets, and ChatGPT referral links include `utm_source=chatgpt.com`.[12] These first-party signals should outrank synthetic prompt tests when available, but none supports a cross-platform universal rank.

## 5. Benchmark design: state/category/DMA

Call the result a **benchmark distribution**, not “market consensus,” unless consensus has a defined statistical meaning.

### Cohort keys

At minimum stratify by:

- category/subcategory (e.g., auto dealer, repair shop, collision center—not all “automotive”);
- business model (storefront, service-area, hybrid; practitioner versus organization);
- geography (DMA, then state, then national category fallback);
- single versus multi-location;
- market density band and business age/size proxy where reliably available.

### Sampling

A search-visible-only panel creates survivorship bias. Use two labeled samples:

- **Market panel:** random/stratified set of eligible active businesses from a reproducible frame.
- **Visibility panel:** businesses observed on selected local/organic result surfaces.

Do not mix them. Preserve inclusion/exclusion rules, deduplication logic, frame source/license, collection dates, and counts.

### Publication thresholds and fallback

Recommended initial rules:

- publish DMA × category percentiles only at **n ≥ 50** unique eligible businesses;
- state × category at **n ≥ 100**;
- national category at **n ≥ 250**;
- otherwise show “insufficient local sample” and use a clearly labeled broader cohort;
- suppress a percentile if one chain contributes more than 20% of the cohort, unless chain weighting is intentional and disclosed.

For sparse DMAs, use hierarchical shrinkage toward state/category estimates, but label the result “modeled” and publish the effective sample size and interval. Do not present a modeled percentile as direct observation.

### Statistics

- Continuous measures: median, interquartile range, 10th/90th percentiles, sample size, collection window.
- Binary checks: proportion plus Wilson confidence interval.
- Composite score percentile: bootstrap confidence interval and tie handling.
- Highly skewed counts such as reviews/links: log transform for modeling, but display raw medians/percentiles.
- Temporal metrics: same-season year-over-year where category seasonality matters; otherwise rolling 28/90-day windows.
- Audit comparison: match the business to one predeclared cohort; do not cherry-pick the cohort that yields the strongest sales message.

### Benchmark labels

Every chart must show:

`Cohort definition | geography | n | data window | source mix | metric definition | last refresh | confidence/limitations`

Example: “HVAC service-area businesses, Atlanta DMA, n=73, public data captured 2026-07-01–21; median review recency 8 days (IQR 3–19). Market panel; chains capped by weighting.”

## 6. Freshness and re-audit policy

Assign an evidence TTL, not one blanket audit expiration:

| Evidence | Suggested TTL |
|---|---:|
| Live profile fields, hours, review counts/recency | 7 days; holiday hours 48 hours near holidays |
| Local-search and generative-answer observations | 72 hours for “current snapshot”; trend valid only for its stated window |
| Crawl/index/robots/status/structured data | 7 days after capture; invalidate immediately after deploy/migration |
| Search Console, GBP Performance, AI reports | refresh weekly; use complete-day/month windows and mark preliminary data |
| Citations/backlinks/directory facts | 30 days |
| License/credential/insurance/regulated claims | 30–90 days or source expiry date, whichever comes first |
| Benchmark cohorts | monthly for volatile public metrics; quarterly for rubric recalibration |

Stamp every score “observed as of” and “refresh by.” If more than 20% of weighted evidence is stale, mark the total stale and withhold comparison badges. Google notes that current profile information matters, and recrawl/processing after changes may take days to months.[1][7]

## 7. Category modules

### HVAC

- Split storefront from service-area business; never recommend fake city offices.
- Verify service territory, emergency availability, hours, phone routing, license/insurance claims, technician credentials, equipment brands, financing/rebate dates, maintenance plans, and seasonal availability.
- Question bank: no-heat/no-cool urgency, repair versus replace, system sizing, permits, energy incentives, indoor-air-quality claims, response areas.
- Refresh seasonal offers and rebates aggressively; archive expired claims.

### Legal

- Separate firm, office, and individual-practitioner entities.
- Verify bar status/jurisdiction, practice areas, attorney authorship/review, office truth, consultation terms, advertising disclaimers, and case-result context.
- Prohibit guarantees, invented “specialist/best” claims, fabricated offices, or decontextualized outcomes.
- Question bank must be state/jurisdiction specific and distinguish general information from legal advice.

### Dentists

- Separate practice, location, and clinician entities.
- Verify licenses/credentials, procedures actually offered at each site, insurance/financing accuracy, accessibility, emergency policies, sedation/safety claims, and clinical review/update process.
- Protect patient privacy in review responses and examples; never expose protected information.
- Question bank: emergency triage boundaries, procedure candidacy, expected process, costs/coverage caveats, aftercare, and clinician credentials.

### Automotive

- Split dealer, independent repair, collision, tire, and specialty cohorts.
- Verify makes/models, certifications, warranties, hours, service booking, loaner/towing, inventory/pricing freshness, parts and service areas.
- Treat inventory/price/availability as fast-expiring facts and distinguish “starting at” from an actual offer.
- Question bank: symptom/problem, service interval, estimate process, warranty, OEM versus aftermarket, collision/insurance workflow, and current inventory.

## 8. Evidence package

Each finding should be independently reproducible from an immutable evidence record:

- audit, business, location and canonical entity IDs;
- criterion/rubric version;
- source URL or authorized data export;
- exact query/prompt/request and collection method;
- timestamp, timezone, locale, device/account state;
- raw response/export plus rendered screenshot when presentation matters;
- normalized observation and pass/fail rule;
- artifact checksum, access control, retention/expiry;
- reviewer, automated tool/version, and manual override history;
- confidence and known limitations.

For authenticated exports, collect owner consent, minimize personal data, encrypt access, and keep credentials out of artifacts. Preserve enough evidence for auditability without redistributing data contrary to platform or provider terms.

## 9. Claim language and sales guardrails

### Safe language

- “Observed,” “eligible,” “consistent with,” “correlated proxy,” “sampled,” “as of,” and “we could not verify.”
- “Google identifies relevance, distance, and prominence/popularity as its main local factors.”[1]
- “Valid markup can make a page eligible; appearance is not guaranteed.”[4][5]
- “This page was cited in 4 of 12 observed Bing/Copilot answers,” with evidence.

### Prohibited or misleading language

- “Google score,” “official ranking factor weight,” or “we know the algorithm.”
- “Guaranteed top 3,” “schema will boost rankings,” “one review equals X positions,” or forecast leads/revenue without a calibrated model and interval.
- A single-point search result labeled as a city/DMA rank.
- A synthetic API model response labeled as what users saw in ChatGPT, Google, Bing, or Gemini.
- “Not cited” when the actual result is “not observed in this finite prompt sample.”
- “Top 10% in your market” without cohort definition, adequate n, date, coverage, and uncertainty.
- Treating absence from an AI answer as proof of technical ineligibility.
- Invented competitor traffic, conversions, profile ownership, or sales.
- Review fraud accusations based solely on bursts or text similarity.
- Location/category pages that differ only by tokens, fake rankings, fake addresses, fake testimonials, or fabricated benchmark records.

## 10. Recommended report schema

```json
{
  "audit_version": "1.0.0",
  "observed_at": "ISO-8601",
  "entity": {"business_id": "...", "location_id": "...", "business_model": "..."},
  "readiness": {
    "score": 0,
    "coverage": 0,
    "lower_bound": 0,
    "upper_bound": 0,
    "critical_flags": []
  },
  "dimensions": [],
  "visibility_panels": {
    "local": {"observations": 0, "queries": 0, "locations": 0, "summary": {}},
    "generative": {"observations": 0, "prompts": 0, "platforms": [], "summary": {}}
  },
  "benchmark": {
    "cohort_id": "...",
    "definition": "...",
    "geography_level": "DMA|state|national",
    "n": 0,
    "window": "...",
    "percentile": null,
    "confidence_interval": null,
    "modeled": false
  },
  "findings": [],
  "evidence_manifest": [],
  "limitations": [],
  "refresh_by": "ISO-8601"
}
```

## 11. Rollout and calibration

1. Freeze rubric v1 and category modules before scoring prospects.
2. Blind-double-score a calibration set; revise criteria with weak reviewer agreement.
3. Build market and visibility panels separately for each starting category.
4. Backtest whether high-level dimensions predict owner-controlled outcomes (qualified calls, bookings, consultations), controlling for location, category, season, ads, and brand size where possible.
5. Re-estimate weights only after enough longitudinal data; until then call them expert rubric weights.
6. Run a red-team check for fake-location incentives, review manipulation, regulated claims, privacy leakage, doorway templates, and benchmark cherry-picking.
7. Version all changes; never recompute an old audit silently under a new rubric.

## Sources

[1] https://support.google.com/business/answer/7091?hl=en — Tips to improve your local ranking on Google
[2] https://support.google.com/business/answer/3038177?hl=en — Guidelines for representing your business on Google
[3] https://support.google.com/business/answer/9918094?hl=en — Understand your Business Profile performance & insights
[4] https://developers.google.com/search/docs/appearance/structured-data/sd-policies — General structured data guidelines
[5] https://developers.google.com/search/docs/appearance/structured-data/local-business — LocalBusiness structured data
[6] https://developers.google.com/search/docs/appearance/structured-data/review-snippet — Review snippet structured data
[7] https://developers.google.com/search/docs/appearance/ai-features — AI features and your website
[8] https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports — Introducing Search Generative AI performance reports in Search Console
[9] https://support.google.com/webmasters/answer/16984139?hl=en — Generative AI performance report (Search)
[10] https://developers.google.com/search/docs/essentials/spam-policies — Spam policies for Google web search
[11] https://developers.google.com/search/docs/essentials/technical — Google Search technical requirements
[12] https://help.openai.com/en/articles/12627856-publishers-and-developers-faq — OpenAI Publishers and Developers FAQ
[13] https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview — Introducing AI Performance in Bing Webmaster Tools Public Preview
