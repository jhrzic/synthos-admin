# Dynamic local-business directory: WordPress and headless options

**Research date:** 2026-07-31  
**Decision frame:** reusable local-services/TaskRabbit-style directory, a possible professional directory, category × town/DMA landing pages, SEO/AEO/GEO, paid and claimed listings, notifications, future React/mobile clients, and a Synthos Concierge/Caitlyn WordPress integration.

## Bottom line

1. **Best WordPress proof of concept: GeoDirectory.** It has the most explicit location hierarchy and category+location archive model, per-location content, claim workflow, pricing packages, and a first-party directory REST API. This is the shortest path to proving directory economics without inventing the core workflow.[1][2][3][4][5]
2. **Best second WordPress test: Directorist.** It is the broader all-in-one bundle: schema selection, claim and paid/featured listings, editable event email templates, search alerts, REST endpoints, and a marketed iOS/Android app option. Its current bundle pricing includes 30+ extensions and themes.[7][8][9][10][11][12]
3. **Best marketplace UX prototype: HivePress + ExpertHive/TaskHive.** It already models services, requests/offers, orders, payouts, messages and commissions. It is better for testing a TaskRabbit/Fiverr interaction model than for proving programmatic town/category SEO pages or a clean headless API.[13][16][17]
4. **Best durable React-first source of truth: Payload CMS + Postgres, with Directus as the low-code alternative.** Payload is MIT-licensed/self-hostable, TypeScript/Next.js-native, and exposes auth-enabled collections through generated REST and GraphQL APIs; its job queue supports emails, scheduled work and third-party sync.[36][37][38][39][40] Directus dynamically generates REST and GraphQL from the database and provides event/webhook/scheduled Flows, but its current commercial model has material seat/collection/flow limits and a large jump to Team pricing.[26][27][28]
5. **Do not make a directory theme the permanent data contract.** MyListing is a polished $69 ThemeForest storefront/theme and includes claim, WooCommerce packages, priority and promotions, but it is Elementor/theme-centric and has no first-party directory API documented in the reviewed materials.[20][21][22]

## WordPress candidates

Legend: **Strong** = first-party and documented; **Partial** = possible but extension/custom work or proof required; **Weak** = not a product strength.

| Candidate | Schema | Dynamic location/category pages | Claim / paid / featured | Notifications | React/mobile/headless | Maintenance profile | Pricing/licensing observed |
|---|---|---|---|---|---|---|---|
| **GeoDirectory** | **Strong.** Native schema is marketed in core; verify actual JSON-LD fields by listing type in the POC.[6] | **Strongest.** Country/region/city/neighborhood data, location-aware URLs, editable meta/title/description, and category × location archives with unique or fallback descriptions.[1][2] | **Strong.** Unclaimed status, email/payment auto-approval or manual moderation; Pricing Manager supports free/paid packages, featured fields, expiry, subscriptions via WP Invoicing or WooCommerce.[3][5] | **Partial/strong.** Claim and commerce emails exist, but advanced orchestration depends on cart/email stack; test deliverability and event coverage.[3][5] | **Strong REST.** Dedicated `/wp-json/geodir/v2/` routes cover listings, types, categories, reviews, fields and location levels, with per-app read/write keys.[4] GraphQL would require custom WPGraphQL exposure/resolvers. | Medium. The functionality is split into core plus paid modules and a cart/user-profile choice, but it can stay within one vendor family. Location term counts and custom DMA mapping need operational care.[1][5] | Free core; vendor page quotes **$139/year one site or $229/year unlimited**, with some add-ons à la carte at $19–$49. Confirm checkout because promotional pricing changes.[6] |
| **Directorist** | **Strong.** JSON-LD can be set globally or per directory with types including LocalBusiness, Event and JobPosting.[9] | **Partial.** It has categories, locations, maps, radius/location filtering, multi-directory, filters and page builders, but the reviewed docs do not establish GeoDirectory-style editable category × location landing-page content. Treat this as a POC gate.[12] | **Strong.** Free featured-listing flow; paid pricing plans, recurring payments, claim listing, Stripe/PayPal/WooCommerce, ads and coupons are in the bundle.[8][11][12] | **Strong.** Per-event email toggles/templates for orders, payments, listing submission/approval/rejection/edit/delete, contact and reviews; search alerts are bundled.[10][12] | **Strong REST, mobile option.** First-party endpoints cover listings, users and favorites; vendor offers mobile support and currently markets a one-year iOS/Android app in its $999 setup package.[7][12] **Security POC:** its API reference shows some credentials in query parameters; do not copy that pattern—use HTTPS, headers/tokens and server-side proxying. | Medium. Fewer vendors than assembling equivalent standalone plugins, but 30+ bundled extensions still create update/compatibility surface. | Current sale page: **$116/year 1 site**, **$135/year 5 sites**, **$153/year 20 sites**; lifetime **$379/$579/$749** respectively. It says all plans include 30+ extensions/themes. Verify renewal and sale terms at checkout.[12] |
| **HivePress + ExpertHive/TaskHive** | **Strong with $29 SEO extension.** Map attributes to schema.org types/properties; LocalBusiness plus geolocation-derived address/lat/long/hasMap are documented.[14][15] | **Partial/weak.** Geolocation and categories/search filters are available, but no first-party hierarchical country→region→city→DMA and category × location content system was found. Build custom taxonomies/templates or generate pages in React.[13] | **Strong marketplace.** Free claims; Marketplace, Memberships, requests, bookings and search alerts are modular; TaskHive/ExpertHive support commissions, paid service listings and paid featured placement.[13][16][17] | **Partial.** Messages are free and Search Alerts is $39; workflow email/push breadth should be tested rather than assumed.[13] | **Weak/unknown headless.** No stable, public, first-party listing REST/GraphQL contract was found in reviewed official docs. WordPress core REST may expose posts, but custom HivePress entities/actions need a spike. | Medium-high if fully assembled: the official catalog itself is many extensions, although all are one vendor and the plugin—not the theme—owns data.[13][16] | Core free. All-extension/theme bundle **$99/year** (unlimited sites per bundle page; $199/year multisite upgrade shown on SEO page). Examples: Marketplace/Memberships/Requests/Search Alerts $39 each; SEO $29 lifetime single-site; claim/geolocation/messages/reviews free.[13][14] |
| **MyListing** | **Partial.** It can integrate with WordPress SEO plugins, but structured-data completeness was not established in the official docs reviewed; validate page source and Google Rich Results before considering it. | **Partial.** Strong listing types, fields, filters and map explore UI; no evidence reviewed of GeoDirectory-like category × city/DMA content management. | **Strong.** Claims can be monetized, manually approved/rejected and marked verified. WooCommerce products supply free/paid/subscription packages, listing limits/duration/priority and promotions.[20][21][22] | **Partial.** Claim status emails and WooCommerce emails exist; broader workflow/push coverage is not a clear product strength.[20] | **Weak.** No documented first-party directory REST/GraphQL API in the reviewed materials. WordPress core REST does not guarantee custom fields/actions. | High lock-in. Listing presentation is built around 50+ Elementor elements and theme-specific listing types; theme updates, Elementor and WooCommerce must move together.[22] | ThemeForest extraction displayed **$69** at research time (price can vary by promotion/region); sold under an Envato/ThemeForest license for the purchased end product. Confirm current price and license scope before reuse across sites.[22] |
| **Business Directory Plugin** | **Partial.** Pricing lists Yoast integration, but no first-party schema.org implementation was established in the reviewed docs. | **Partial/weak.** Categories and city/ZIP filtering exist, but not a documented hierarchy plus programmatic category × location content engine.[18] | **Strong traditional directory.** Featured listings are in Basic; Claim Listings is Elite and claim forms support reCAPTCHA.[18][19] | **Partial.** Standard listing/payment email behavior exists, but no differentiated mobile/push workflow was established. | **Weak.** No first-party directory REST/GraphQL API found in reviewed official material. | Medium for a conventional web directory; weak strategic fit for app-first plans. | Introductory **Basic $99/year/1 site**, **Pro $149/year/3 sites**, **Elite $249/year/25 sites**; stated normal renewals $149/$249/$349. Claim Listings requires Elite.[18] |

### Theme/template verdict

- **Use themes only as disposable presentation accelerators.** GeoDirectory with a block theme keeps the data model in a plugin. HivePress explicitly says its data is plugin-owned even if the theme changes.[16]
- **ExpertHive** is the better demo for a professional/local expert directory; **TaskHive** is the better micro-job/service-order demo. Both already show requests, bids, orders, payouts and messages, which makes them useful UX references even if they are not selected as the backend.[16][17]
- **Avoid MyListing as the reusable master template** unless the business has committed to a WordPress-rendered frontend. Its Elementor/theme coupling is the opposite of a stable React/mobile contract.[22]

## Headless alternatives

| Platform | What is native | What must be built for this directory | Fit and cost |
|---|---|---|---|
| **Payload CMS + Postgres** | TypeScript/Next.js application framework; generated CRUD REST and GraphQL; auth-enabled collections expose login/logout/reset/verify operations; access control; jobs/workflows for delayed email, webhooks, embeddings and sync.[36][37][39][40] | Listing claim state machine and proof review; Stripe subscriptions/featured placement; taxonomy/location hierarchy; geospatial/radius search; moderation; notification templates; frontend JSON-LD; owner dashboard; abuse controls. | **Best engineering fit** when React/mobile and the Concierge API are first-class. Self-hosted is free and MIT licensed.[38] More initial build than a directory plugin, but the schema and workflows become portable product IP. |
| **Directus + Postgres/PostGIS** | Database-first admin, dynamically generated REST/GraphQL/SDK, granular permissions, files, and no-code Flows triggered by events, webhooks, schedules or manual action.[27][28] | Same directory business workflows as Payload; custom claim verification, Stripe and public owner UX; schema.org generated by Next/React; likely a custom extension for polished operator tools. | **Best low-code data operations fit.** Current pricing says Core has 3 seats/25 collections/5 flows; eligible organizations under $5M revenue and 50 employees can self-host at no software cost via its grant, while Team is $499/month annual or $599 monthly, with Cloud hosting $99/month.[26] Validate licensing eligibility before committing. |
| **Strapi 5 + Postgres** | MIT Community edition, RBAC, generated REST and GraphQL, webhooks, cron, API tokens and unlimited entries/API calls; paid Growth is $45/month and Enterprise adds review workflows/audit logs.[29][30][31] | Nearly all directory-specific commerce, claims, geospatial search, public account workflow, notifications and JSON-LD. Relation population and permission configuration must be deliberate for performance/security.[30] | Viable generic headless CMS, but less integrated with Next/React than Payload and less database/no-code friendly than Directus. Choose only if the team already knows Strapi. |

**Schema.org note:** none of these generic headless systems should emit structured data from the CMS itself. Store normalized facts and a `schema_type`; have the server-rendered React/Next frontend generate canonical JSON-LD per listing and `ItemList`/breadcrumb markup for valid index pages. Validate output against schema.org and Google tools; structured data is not a substitute for unique useful landing-page copy.

## Should WordPress be the source of truth?

**Long-term: no—not for the cross-channel directory product.** The stated priorities (reusable sites, React mobile, a Concierge/Caitlyn plugin, and likely more than one directory) favor one typed catalog/workflow API independent of WordPress. Make **Postgres behind Payload** the canonical store for listings, owners, claims, plans/entitlements, payments, reviews, locations, categories and notification events. WordPress should own editorial posts/pages only, and the Synthos plugin should query the canonical API or maintain a clearly disposable read cache.

**MVP exception:** if the immediate goal is to validate supply acquisition, claims and paid listings before funding a custom application, let **GeoDirectory be the temporary canonical directory store**. Its dedicated API is materially better than scraping theme output and covers listings, fields, reviews and locations.[4] Put a versioned API façade in front of it, assign immutable external IDs, export nightly, and prohibit dual writes. This keeps migration possible.

**Do not dual-master WordPress and a headless CMS.** Choose exactly one writer for listing/claim/payment state. Replicas and search indexes are fine; bidirectional workflow ownership is not.

WordPress core can support separate applications over JSON REST, including Swift/Kotlin clients, and Application Passwords provide revocable per-integration credentials over HTTPS.[24][25] WPGraphQL is free/open source, but custom post types must be explicitly exposed and authentication is not built in; directory plugin fields/actions may still require custom resolvers and mutations.[23] Therefore, “WordPress has REST/GraphQL” is not enough—test the exact claim, checkout, favorites, review and owner-edit operations.

## Recommended test plan

### Test A — GeoDirectory vertical slice (primary, 5–7 working days)

Build one service category across three towns plus one DMA-like custom region, 50 imported unclaimed listings, two claim attempts, one free and one paid/featured package, reviews and expiry/renewal email. Render these URL types: listing, town, category, category×town and DMA. Verify:

- unique canonical URLs, title/meta copy and index/noindex rules;
- JSON-LD has correct type, NAP, geo, hours, images, aggregate rating and no false `sameAs`/review data;
- REST can list/filter locations/categories/listings, retrieve one complete listing, submit/update through a least-privilege test user, and represent claim/payment state without scraping HTML;
- custom DMA grouping does not create duplicate cities or orphan listings—GeoDirectory warns that map-provider naming and custom locations can create merge/maintenance problems.[1]
- 10k/100k-listing query plan, cache behavior, map-marker payload, imports and term-count rebuild time.

**Pass condition:** category×location SEO works without thousands of thin pages; all mobile-critical reads work through the API; claim/paid flows require no more than GeoDirectory + one cart + SMTP/security tooling.

### Test B — Directorist parity spike (3–4 days)

Repeat 20 listings, one claim, featured checkout, review, favorite, search alert and every relevant notification. Confirm category×town editable landing pages, REST field completeness, authentication, rate limiting, app source-code/maintenance terms, and whether the mobile app supports the same extensions. The feature surface and current bundle price justify a real comparison, but not an assumption that every bundled extension works headlessly.[7][10][12]

### Test C — Payload canonical model spike (5 days)

Create collections for `businesses`, `service_locations`, `categories`, `business_categories`, `owners`, `claims`, `plans`, `entitlements`, `reviews`, and immutable `notification_events`. Add PostGIS/search strategy, role/row-level access, claim transitions, a Stripe test webhook, one queued email and a Next.js listing/category×town page with JSON-LD. Generate an OpenAPI/GraphQL contract consumed by both a React Native screen and a minimal WordPress Synthos plugin. Payload already provides generated APIs and auth operations; the spike should measure only the missing directory logic.[36][37][39][40]

### Decision gate

- Choose **GeoDirectory canonical for MVP** if it passes Test A, launch speed matters more than app parity, and the mobile client is at least 6–12 months away.
- Choose **Payload/Postgres canonical now** if mobile/Concierge is a launch dependency, more than one branded directory will share records, or custom service-request/order matching is core.
- Choose **Directorist** if Test B matches GeoDirectory on category×location SEO/API completeness and its notification/mobile bundle removes enough custom work.
- Use **HivePress ExpertHive/TaskHive as a UX benchmark or fast marketplace demo**, not as the canonical backend unless its API spike proves all custom entities and mutations.

## Spam, security and maintenance baseline

- **Minimize public write endpoints.** Public search can be cached/read-only; claim, review, contact and listing submissions require verified accounts, per-IP/account velocity limits, CAPTCHA/honeypot, disposable-email checks where lawful, and a moderation queue.
- **Claims need evidence and auditability.** Store claim state, evidence, reviewer, timestamps and reason codes; do not auto-approve on email alone for high-risk categories. GeoDirectory and Directorist both support manual moderation; Business Directory Plugin explicitly supports reCAPTCHA on claim forms.[3][8][19]
- **Payments grant entitlements, not ownership by client request.** Process signed Stripe/WooCommerce webhooks idempotently, retain event IDs, and make featured/paid expiry server-controlled.
- **Separate notification events from delivery.** Queue immutable events and send through a transactional provider; add suppression, retries, bounce handling and preference controls. Directorist’s event templates are a useful acceptance checklist.[10]
- **WordPress baseline:** managed host/WAF/CDN, least-privilege roles, 2FA/passkeys, staging, tested backups, uptime/error monitoring, SMTP, monthly restore drill, and rapid core/plugin/theme patching. Wordfence offers firewall, malware scanning, brute-force controls and 2FA; Akismet covers comments/contact forms but requires a paid plan for commercial sites.[33][34]
- **Reduce plugin surface:** one directory suite, one commerce route, one SMTP provider, one security layer, one backup path, and only essential SEO/cache tooling. Do not install overlapping schema, membership, form, security or cache plugins.
- **API security:** TLS only, origin restrictions, short-lived user tokens, revocable server integration credentials, scoped roles, audit logs, secret rotation and edge rate limits. WordPress Application Passwords are individually revocable and intended for programmatic access, but they must be carried over HTTPS.[25]
- **Headless does not eliminate maintenance.** It trades WordPress plugin compatibility risk for application code, dependency, database migration, abuse, auth and payment-webhook responsibility. Payload warns custom endpoints are not authenticated by default; every custom route needs explicit access checks.[36]

## Sources

[1] https://wpgeodirectory.com/docs-v2/addons/location-manager
[2] https://wpgeodirectory.com/docs-v2/places/categories
[3] https://wpgeodirectory.com/docs-v2/addons/claim
[4] https://wpgeodirectory.com/docs-v2/geodirectory/settings/api
[5] https://wpgeodirectory.com/docs-v2/addons/pricing-manager
[6] https://wpgeodirectory.com/geodirectory-vs-hivepress
[7] https://directorist.com/docs/api-reference
[8] https://directorist.com/docs/claim-listing
[9] https://directorist.com/docs/schema-markup
[10] https://directorist.com/docs/directorist-settings-panel-notifications
[11] https://directorist.com/docs/monetization-overview
[12] https://directorist.com/pricing
[13] https://hivepress.io/extensions
[14] https://hivepress.io/extensions/seo
[15] https://help.hivepress.io/article/122-how-to-set-up-schema
[16] https://hivepress.io/themes/taskhive
[17] https://hivepress.io/themes/experthive
[18] https://businessdirectoryplugin.com/pricing
[19] https://businessdirectoryplugin.com/knowledge-base/claim-listings-module
[20] https://docs.mylistingtheme.com/article/how-to-setup-claim-listing
[21] https://docs.mylistingtheme.com/article/paid-listings-and-creating-listing-packages
[22] https://themeforest.net/item/mylisting-directory-listing-wordpress-theme/20593226
[23] https://www.wpgraphql.com/docs/faqs
[24] https://developer.wordpress.org/rest-api
[25] https://developer.wordpress.org/advanced-administration/security/application-passwords
[26] https://directus.io/pricing
[27] https://directus.io/docs/api
[28] https://directus.io/docs/guides/automate/triggers
[29] https://strapi.io/pricing-cms
[30] https://docs.strapi.io/cms/api/rest
[31] https://docs.strapi.io/cms/backend-customization/webhooks
[33] https://wordpress.org/plugins/akismet
[34] https://wordpress.org/plugins/wordfence
[36] https://payloadcms.com/docs/rest-api/overview
[37] https://payloadcms.com/docs/graphql/overview
[38] https://payloadcms.com/cloud-pricing
[39] https://payloadcms.com/docs/jobs-queue/overview
[40] https://payloadcms.com/docs/authentication/operations
