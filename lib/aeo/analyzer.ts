// ---------------------------------------------------------------------------
// AEO/GEO/SEO — deterministic analyzer.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE:
//
// 1. NO FABRICATED SCORES. Every number below is a ratio of checks that
//    actually PASSED over checks that were actually APPLICABLE against crawled
//    evidence. The formula is `dimensionScore()` and it is the only place a
//    score is produced. A dimension with no applicable checks scores `null`,
//    which renders as UNKNOWN — never 0, and never a filler mid-range number.
//
// 2. NO CLAIMED AI VISIBILITY WITHOUT A QUERY. GEO findings are only emitted
//    from evidence that was actually gathered. With no search/AI provider
//    configured, the GEO dimension returns NOT_CONFIGURED and says which
//    credential would change that. It never infers "you are not cited".
// ---------------------------------------------------------------------------

import type { SiteCrawlResult, PageObservations } from './crawler';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type CheckStatus = 'pass' | 'fail' | 'warn' | 'not_applicable' | 'unknown';

export interface Check {
  id: string;
  dimension: 'seo' | 'aeo' | 'geo';
  title: string;
  status: CheckStatus;
  severity: Severity;
  /** The literal observation this verdict came from. Always populated for pass/fail/warn. */
  evidence: string;
  /** What to do about it. Feeds the action plan and mission creation. */
  recommendation?: string;
  effort?: 'quick_win' | 'standard' | 'project';
  category?: 'technical' | 'content' | 'schema' | 'local' | 'authority';
}

export interface DimensionScore {
  /** 0–100, or null when no check in this dimension was applicable. */
  score: number | null;
  passed: number;
  applicable: number;
  formula: string;
  unknownReason?: string;
}

export interface AuditAnalysis {
  domain: string;
  origin: string;
  generatedAt: string;
  crawl: { pagesAnalyzed: number; pagesFailed: number; durationMs: number };
  checks: Check[];
  scores: { seo: DimensionScore; aeo: DimensionScore; geo: DimensionScore; overall: DimensionScore };
  sourcesUsed: { source: string; status: 'USED' | 'NOT_CONFIGURED' | 'UNAVAILABLE'; detail: string }[];
  competitors: { host: string; basis: string }[];
  unknowns: string[];
  summary: {
    topProblems: Check[];
    topOpportunities: Check[];
    quickWins: Check[];
    technicalFixes: Check[];
    contentOpportunities: Check[];
    localActions: Check[];
    aeoGeoActions: Check[];
  };
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * THE ONLY SCORING FORMULA IN THIS PIPELINE.
 *
 *   score = round( 100 * Σ(weight of passed checks) / Σ(weight of applicable checks) )
 *
 * "Applicable" excludes `not_applicable` and `unknown` — a check we could not
 * evaluate must not drag a score down, because that would manufacture a bad
 * number out of missing evidence. `warn` counts as half credit.
 * Zero applicable checks → null → UNKNOWN.
 */
export function dimensionScore(checks: Check[], unknownReason?: string): DimensionScore {
  const applicable = checks.filter((c) => c.status === 'pass' || c.status === 'fail' || c.status === 'warn');
  const totalWeight = applicable.reduce((a, c) => a + SEVERITY_WEIGHT[c.severity], 0);
  if (totalWeight === 0) {
    return {
      score: null, passed: 0, applicable: 0,
      formula: '100 × Σ(weight of passed) / Σ(weight of applicable); severity weights critical=4 high=3 medium=2 low=1; warn = half credit',
      unknownReason: unknownReason || 'No applicable checks could be evaluated from the evidence gathered.',
    };
  }
  const earned = applicable.reduce(
    (a, c) => a + (c.status === 'pass' ? SEVERITY_WEIGHT[c.severity] : c.status === 'warn' ? SEVERITY_WEIGHT[c.severity] / 2 : 0),
    0
  );
  return {
    score: Math.round((100 * earned) / totalWeight),
    passed: applicable.filter((c) => c.status === 'pass').length,
    applicable: applicable.length,
    formula: '100 × Σ(weight of passed) / Σ(weight of applicable); severity weights critical=4 high=3 medium=2 low=1; warn = half credit',
  };
}

const ok = (p: PageObservations) => p.status !== null && p.status >= 200 && p.status < 400;

export interface GeoEvidence {
  /** Real AI/search results, when a provider was actually queried. Empty means "not queried". */
  queries: { engine: string; query: string; brandAppeared: boolean; competitorsSeen: string[]; citedSources: string[] }[];
  providerStatus: 'USED' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  providerDetail: string;
}

export function analyze(params: {
  crawl: SiteCrawlResult;
  domain: string;
  businessName?: string;
  location?: string;
  targetService?: string;
  targetKeywords?: string[];
  geo: GeoEvidence;
}): AuditAnalysis {
  const { crawl, geo } = params;
  const checks: Check[] = [];
  const unknowns: string[] = [];
  const pages = crawl.pages.filter(ok);
  // A crawl can legitimately return zero pages (every URL failed). Every
  // homepage-derived check must then read "unknown" rather than crash or, worse,
  // report a confident failure about a page that was never retrieved.
  const EMPTY_HOME: PageObservations = {
    url: crawl.origin, status: null, title: null, titleLength: null,
    metaDescription: null, metaDescriptionLength: null, canonical: null, metaRobots: null, lang: null,
    h1: [], h2: [], h3: [], headingOrderIssues: [], jsonLdBlocks: 0, jsonLdTypes: [], microdataTypes: [],
    openGraphTags: 0, twitterTags: 0, images: 0, imagesMissingAlt: 0, internalLinks: 0, externalLinks: 0,
    externalHosts: [], wordCount: 0, questionHeadings: [], visibleTextChars: 0, scriptTags: 0,
    error: 'No page was retrieved.',
  };
  const home = crawl.pages[0] ?? EMPTY_HOME;
  const homeRetrieved = crawl.pages.length > 0;

  const add = (c: Check) => checks.push(c);
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((100 * n) / d));

  // ===================== TRADITIONAL SEO =====================

  add({
    id: 'seo.reachable', dimension: 'seo', title: 'Homepage is reachable', severity: 'critical', category: 'technical',
    status: !homeRetrieved ? 'unknown' : ok(home) ? 'pass' : 'fail',
    evidence: !homeRetrieved ? 'No page was retrieved for this origin.' : ok(home) ? `Homepage returned HTTP ${home.status}.` : `Homepage did not return a success status (${home.status ?? home.error}).`,
    recommendation: ok(home) ? undefined : 'Restore homepage availability before any other SEO work — nothing else can be indexed.',
    effort: 'standard',
  });

  add({
    id: 'seo.robots', dimension: 'seo', title: 'robots.txt present', severity: 'medium', category: 'technical',
    status: crawl.robotsTxt.present ? 'pass' : 'fail',
    evidence: crawl.robotsTxt.present
      ? `robots.txt served with ${crawl.robotsTxt.disallowCount} Disallow rule(s) and ${crawl.robotsTxt.sitemapUrls.length} Sitemap directive(s).`
      : `No valid robots.txt at ${crawl.origin}/robots.txt (HTTP ${crawl.robotsTxt.status ?? 'no response'}).`,
    recommendation: crawl.robotsTxt.present ? undefined : 'Publish a robots.txt that allows crawling and declares the sitemap URL.',
    effort: 'quick_win',
  });

  add({
    id: 'seo.sitemap', dimension: 'seo', title: 'XML sitemap present', severity: 'high', category: 'technical',
    status: crawl.sitemap.present ? 'pass' : 'fail',
    evidence: crawl.sitemap.present
      ? `Sitemap found listing ${crawl.sitemap.urlCount} URL(s).`
      : `No XML sitemap found at the standard locations or in robots.txt.`,
    recommendation: crawl.sitemap.present ? undefined : 'Generate and publish an XML sitemap, then reference it from robots.txt. Crawlers and AI answer engines both use it for discovery.',
    effort: 'quick_win',
  });

  const missingTitle = pages.filter((p) => !p.title);
  add({
    id: 'seo.titles', dimension: 'seo', title: 'Every page has a title', severity: 'critical', category: 'technical',
    status: pages.length === 0 ? 'unknown' : missingTitle.length === 0 ? 'pass' : 'fail',
    evidence: pages.length === 0 ? 'No pages were successfully crawled.' : `${pages.length - missingTitle.length}/${pages.length} crawled pages have a <title>.`,
    recommendation: missingTitle.length ? `Add unique titles to: ${missingTitle.slice(0, 5).map((p) => p.url).join(', ')}` : undefined,
    effort: 'quick_win',
  });

  const badTitleLen = pages.filter((p) => p.titleLength !== null && (p.titleLength < 15 || p.titleLength > 65));
  add({
    id: 'seo.title_length', dimension: 'seo', title: 'Title lengths in usable range', severity: 'low', category: 'content',
    status: pages.length === 0 ? 'unknown' : badTitleLen.length === 0 ? 'pass' : 'warn',
    evidence: `${badTitleLen.length}/${pages.length} titles fall outside 15–65 characters.`,
    recommendation: badTitleLen.length ? 'Rewrite outlying titles so they render fully in results.' : undefined,
    effort: 'quick_win',
  });

  const missingDesc = pages.filter((p) => !p.metaDescription);
  add({
    id: 'seo.meta_description', dimension: 'seo', title: 'Meta descriptions present', severity: 'medium', category: 'content',
    status: pages.length === 0 ? 'unknown' : missingDesc.length === 0 ? 'pass' : missingDesc.length === pages.length ? 'fail' : 'warn',
    evidence: `${pages.length - missingDesc.length}/${pages.length} crawled pages have a meta description.`,
    recommendation: missingDesc.length ? `Write descriptions for ${missingDesc.length} page(s); these are frequently reused verbatim as answer snippets.` : undefined,
    effort: 'quick_win',
  });

  const h1Issues = pages.filter((p) => p.h1.length !== 1);
  add({
    id: 'seo.h1', dimension: 'seo', title: 'Exactly one H1 per page', severity: 'medium', category: 'content',
    status: pages.length === 0 ? 'unknown' : h1Issues.length === 0 ? 'pass' : 'warn',
    evidence: `${h1Issues.length}/${pages.length} pages do not have exactly one H1.`,
    recommendation: h1Issues.length ? 'Give each page a single descriptive H1 stating what the page is about.' : undefined,
    effort: 'quick_win',
  });

  const noCanonical = pages.filter((p) => !p.canonical);
  add({
    id: 'seo.canonical', dimension: 'seo', title: 'Canonical URLs declared', severity: 'medium', category: 'technical',
    status: pages.length === 0 ? 'unknown' : noCanonical.length === 0 ? 'pass' : noCanonical.length === pages.length ? 'fail' : 'warn',
    evidence: `${pages.length - noCanonical.length}/${pages.length} pages declare a canonical URL.`,
    recommendation: noCanonical.length ? 'Add rel=canonical to prevent duplicate-URL dilution.' : undefined,
    effort: 'quick_win',
  });

  const totalImgs = pages.reduce((a, p) => a + p.images, 0);
  const missingAlt = pages.reduce((a, p) => a + p.imagesMissingAlt, 0);
  add({
    id: 'seo.image_alt', dimension: 'seo', title: 'Images have alt text', severity: 'low', category: 'content',
    status: totalImgs === 0 ? 'not_applicable' : missingAlt === 0 ? 'pass' : missingAlt / totalImgs > 0.5 ? 'fail' : 'warn',
    evidence: totalImgs === 0 ? 'No <img> elements found on crawled pages.' : `${missingAlt}/${totalImgs} images (${pct(missingAlt, totalImgs)}%) have no alt text.`,
    recommendation: missingAlt ? 'Add descriptive alt text — it is also the only thing a text-only answer engine can read from an image.' : undefined,
    effort: 'quick_win',
  });

  add({
    id: 'seo.lang', dimension: 'seo', title: 'Language declared', severity: 'low', category: 'technical',
    status: !homeRetrieved ? 'unknown' : !home.lang ? 'fail' : 'pass',
    evidence: !homeRetrieved ? 'No page was retrieved, so no lang attribute could be observed.' : home.lang ? `<html lang="${home.lang}">` : 'Homepage <html> has no lang attribute.',
    recommendation: home.lang ? undefined : 'Declare lang on <html>.',
    effort: 'quick_win',
  });

  const thin = pages.filter((p) => p.wordCount < 300);
  add({
    id: 'seo.content_depth', dimension: 'seo', title: 'Pages carry substantive content', severity: 'medium', category: 'content',
    status: pages.length === 0 ? 'unknown' : thin.length === 0 ? 'pass' : thin.length > pages.length / 2 ? 'fail' : 'warn',
    evidence: `${thin.length}/${pages.length} crawled pages have fewer than 300 words of server-rendered text.`,
    recommendation: thin.length ? 'Expand thin pages; answer engines extract from rendered text, not from scripts.' : undefined,
    effort: 'standard',
  });

  add({
    id: 'seo.crawl_errors', dimension: 'seo', title: 'No fetch failures during crawl', severity: 'high', category: 'technical',
    status: crawl.fetchFailures.length === 0 ? 'pass' : 'warn',
    evidence: crawl.fetchFailures.length === 0 ? 'All requested URLs responded successfully.' : `${crawl.fetchFailures.length} URL(s) failed: ${crawl.fetchFailures.slice(0, 3).map((f) => `${f.url} (${f.error})`).join('; ')}`,
    recommendation: crawl.fetchFailures.length ? 'Fix or remove links to failing URLs.' : undefined,
    effort: 'standard',
  });

  // ===================== AEO =====================

  const schemaPages = pages.filter((p) => p.jsonLdBlocks > 0);
  const allTypes = [...new Set(pages.flatMap((p) => p.jsonLdTypes))];
  add({
    id: 'aeo.structured_data', dimension: 'aeo', title: 'Structured data (JSON-LD) present', severity: 'critical', category: 'schema',
    status: pages.length === 0 ? 'unknown' : schemaPages.length === 0 ? 'fail' : schemaPages.length < pages.length / 2 ? 'warn' : 'pass',
    evidence: schemaPages.length === 0
      ? `No JSON-LD found on any of the ${pages.length} crawled pages.`
      : `${schemaPages.length}/${pages.length} pages carry JSON-LD. Types: ${allTypes.join(', ') || 'none parsed'}.`,
    recommendation: schemaPages.length < pages.length
      ? 'Add JSON-LD. This is the single highest-leverage AEO fix: it is how an answer engine resolves what the entity IS rather than inferring it from prose.'
      : undefined,
    effort: 'standard',
  });

  const hasOrg = allTypes.some((t) => /Organization|LocalBusiness|Corporation/i.test(t));
  add({
    id: 'aeo.entity_clarity', dimension: 'aeo', title: 'Organization entity declared', severity: 'high', category: 'schema',
    status: !homeRetrieved ? 'unknown' : hasOrg ? 'pass' : 'fail',
    evidence: hasOrg ? `Organization-class schema present (${allTypes.filter((t) => /Organization|LocalBusiness|Corporation/i.test(t)).join(', ')}).` : 'No Organization / LocalBusiness schema found — the entity is not machine-identifiable.',
    recommendation: hasOrg ? undefined : 'Add Organization schema with name, url, logo, sameAs links and description so the brand resolves as an entity.',
    effort: 'quick_win',
  });

  const hasFaqSchema = allTypes.some((t) => /FAQPage|QAPage|Question/i.test(t));
  const questionHeadings = pages.flatMap((p) => p.questionHeadings);
  add({
    id: 'aeo.faq_coverage', dimension: 'aeo', title: 'Question/answer content exists', severity: 'high', category: 'content',
    status: hasFaqSchema ? 'pass' : questionHeadings.length > 0 ? 'warn' : 'fail',
    evidence: hasFaqSchema
      ? 'FAQ/QA schema present.'
      : questionHeadings.length > 0
        ? `${questionHeadings.length} question-form heading(s) found but no FAQPage schema: e.g. "${questionHeadings.slice(0, 3).join('", "')}".`
        : 'No question-form headings and no FAQ schema found.',
    recommendation: hasFaqSchema ? undefined : 'Publish a real FAQ answering the questions buyers actually ask, marked up with FAQPage schema. Direct-answer engines lift these verbatim.',
    effort: 'standard',
  });

  const answerable = pages.filter((p) => p.questionHeadings.length > 0);
  add({
    id: 'aeo.direct_answer', dimension: 'aeo', title: 'Pages are structured for direct answers', severity: 'high', category: 'content',
    status: pages.length === 0 ? 'unknown' : answerable.length === 0 ? 'fail' : answerable.length < pages.length / 3 ? 'warn' : 'pass',
    evidence: `${answerable.length}/${pages.length} crawled pages use question-form headings.`,
    recommendation: answerable.length < pages.length / 3 ? 'Restructure key pages as question → short direct answer → supporting detail. That shape is what gets quoted.' : undefined,
    effort: 'standard',
  });

  const totalText = pages.reduce((a, p) => a + p.visibleTextChars, 0);
  const avgText = pages.length ? Math.round(totalText / pages.length) : 0;
  add({
    id: 'aeo.server_rendered', dimension: 'aeo', title: 'Content is server-rendered', severity: 'critical', category: 'technical',
    status: pages.length === 0 ? 'unknown' : avgText < 500 ? 'fail' : avgText < 1500 ? 'warn' : 'pass',
    evidence: `Average ${avgText} characters of server-rendered visible text per page across ${pages.length} pages.`,
    recommendation: avgText < 1500 ? 'Ensure primary content is present in the HTML response. Many AI crawlers do not execute JavaScript — client-rendered content is invisible to them.' : undefined,
    effort: 'project',
  });

  const withSameAs = pages.some((p) => /sameAs/i.test(JSON.stringify(p.jsonLdTypes)) );
  add({
    id: 'aeo.authority_links', dimension: 'aeo', title: 'Outbound authority/citation links', severity: 'medium', category: 'authority',
    status: crawl.discoveredExternalHosts.length === 0 ? 'fail' : crawl.discoveredExternalHosts.length < 3 ? 'warn' : 'pass',
    evidence: crawl.discoveredExternalHosts.length === 0
      ? 'No outbound external links found — the site cites no supporting sources.'
      : `Links out to ${crawl.discoveredExternalHosts.length} external host(s): ${crawl.discoveredExternalHosts.slice(0, 6).join(', ')}.`,
    recommendation: crawl.discoveredExternalHosts.length < 3 ? 'Cite authoritative sources and add sameAs links to profiles the brand controls. Entity relationships are how answer engines corroborate claims.' : undefined,
    effort: 'quick_win',
  });

  // ---- Local (only when a location was actually supplied) ----
  if (params.location) {
    const hasLocal = allTypes.some((t) => /LocalBusiness|Place|PostalAddress/i.test(t));
    add({
      id: 'aeo.local_schema', dimension: 'aeo', title: 'Local business schema', severity: 'high', category: 'local',
      status: hasLocal ? 'pass' : 'fail',
      evidence: hasLocal ? 'LocalBusiness/Place schema present.' : `Location "${params.location}" was supplied but no LocalBusiness/Place schema was found.`,
      recommendation: hasLocal ? undefined : 'Add LocalBusiness schema with address, geo, openingHours and telephone.',
      effort: 'quick_win',
    });
  }

  // ===================== GEO / AI VISIBILITY =====================
  // Emitted ONLY from evidence actually gathered. No provider → NOT_CONFIGURED.

  if (geo.providerStatus === 'USED' && geo.queries.length > 0) {
    const appeared = geo.queries.filter((q) => q.brandAppeared).length;
    add({
      id: 'geo.brand_presence', dimension: 'geo', title: 'Brand appears in AI/search answers', severity: 'critical', category: 'authority',
      status: appeared === 0 ? 'fail' : appeared < geo.queries.length ? 'warn' : 'pass',
      evidence: `Brand appeared in ${appeared}/${geo.queries.length} executed queries across ${[...new Set(geo.queries.map((q) => q.engine))].join(', ')}.`,
      recommendation: appeared < geo.queries.length ? 'Build citable content and third-party corroboration for the queries where the brand is absent.' : undefined,
      effort: 'project',
    });
    const competitorsSeen = [...new Set(geo.queries.flatMap((q) => q.competitorsSeen))];
    if (competitorsSeen.length) {
      add({
        id: 'geo.competitor_presence', dimension: 'geo', title: 'Competitors occupying the answers', severity: 'high', category: 'authority',
        status: 'warn',
        evidence: `Observed instead of / alongside the brand: ${competitorsSeen.slice(0, 8).join(', ')}.`,
        recommendation: 'Analyse what those pages answer that this site does not, and publish a better-sourced version.',
        effort: 'project',
      });
    }
  } else {
    unknowns.push(
      `AI visibility (GEO) was NOT measured. ${geo.providerDetail} No claim is made about whether this brand appears in ChatGPT, Perplexity, Gemini or AI Overviews.`
    );
  }

  // ===================== SCORES =====================
  const seoChecks = checks.filter((c) => c.dimension === 'seo');
  const aeoChecks = checks.filter((c) => c.dimension === 'aeo');
  const geoChecks = checks.filter((c) => c.dimension === 'geo');

  const scores = {
    seo: dimensionScore(seoChecks),
    aeo: dimensionScore(aeoChecks),
    geo: dimensionScore(geoChecks, `No AI/search provider was queried. ${geo.providerDetail}`),
    overall: dimensionScore([...seoChecks, ...aeoChecks, ...geoChecks]),
  };

  // ===================== COMPETITORS =====================
  // Only from real evidence. Outbound-link hosts are a weak but honest basis and
  // are labelled as such; a real competitor set needs a search provider.
  const competitors: { host: string; basis: string }[] = [];
  if (geo.providerStatus === 'USED') {
    for (const h of [...new Set(geo.queries.flatMap((q) => q.competitorsSeen))]) {
      competitors.push({ host: h, basis: 'Appeared in an executed AI/search query result' });
    }
  }
  if (competitors.length === 0) {
    unknowns.push('Competitor discovery requires a search or AI provider. None is configured, so no competitor set was derived — outbound links are not competitors and were not used as a substitute.');
  }

  // ===================== SUMMARY BUCKETS =====================
  const failing = checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const bySeverity = (a: Check, b: Check) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
  const actionable = failing.filter((c) => c.recommendation);

  const analysis: AuditAnalysis = {
    domain: params.domain,
    origin: crawl.origin,
    generatedAt: new Date().toISOString(),
    crawl: { pagesAnalyzed: pages.length, pagesFailed: crawl.fetchFailures.length, durationMs: crawl.durationMs },
    checks,
    scores,
    sourcesUsed: [
      { source: 'Live HTTP crawl', status: 'USED', detail: `${crawl.pages.length} URL(s) fetched from ${crawl.origin}` },
      { source: 'robots.txt', status: crawl.robotsTxt.present ? 'USED' : 'UNAVAILABLE', detail: crawl.robotsTxt.present ? 'Parsed' : `HTTP ${crawl.robotsTxt.status ?? 'no response'}` },
      { source: 'XML sitemap', status: crawl.sitemap.present ? 'USED' : 'UNAVAILABLE', detail: crawl.sitemap.present ? `${crawl.sitemap.urlCount} URLs` : 'Not found' },
      { source: 'AI/search visibility provider', status: geo.providerStatus, detail: geo.providerDetail },
    ],
    competitors,
    unknowns,
    summary: {
      topProblems: [...failing].sort(bySeverity).slice(0, 5),
      topOpportunities: [...actionable].sort(bySeverity).slice(0, 5),
      quickWins: actionable.filter((c) => c.effort === 'quick_win').sort(bySeverity),
      technicalFixes: actionable.filter((c) => c.category === 'technical'),
      contentOpportunities: actionable.filter((c) => c.category === 'content'),
      localActions: actionable.filter((c) => c.category === 'local'),
      aeoGeoActions: actionable.filter((c) => c.dimension === 'aeo' || c.dimension === 'geo'),
    },
  };

  return analysis;
}

/** Deterministic, evidence-only markdown report. Every line traces to a check. */
export function renderReport(a: AuditAnalysis, meta: { businessName?: string; location?: string; targetService?: string }): string {
  const s = (d: DimensionScore) => (d.score === null ? 'UNKNOWN' : `${d.score}/100`);
  const line = (c: Check) => `- **[${c.severity.toUpperCase()}] ${c.title}** — ${c.evidence}${c.recommendation ? `\n  - *Action:* ${c.recommendation}` : ''}`;
  const section = (title: string, list: Check[], empty: string) =>
    `## ${title}\n\n${list.length ? list.map(line).join('\n') : `_${empty}_`}\n`;

  return [
    `# SEO / AEO / GEO Audit — ${meta.businessName || a.domain}`,
    ``,
    `**Domain:** ${a.origin}  `,
    meta.location ? `**Location:** ${meta.location}  ` : '',
    meta.targetService ? `**Target service:** ${meta.targetService}  ` : '',
    `**Generated:** ${a.generatedAt}  `,
    `**Pages analysed:** ${a.crawl.pagesAnalyzed} (${a.crawl.pagesFailed} failed) in ${a.crawl.durationMs}ms`,
    ``,
    `## Scores`,
    ``,
    `| Dimension | Score | Checks passed |`,
    `|---|---|---|`,
    `| Traditional SEO | ${s(a.scores.seo)} | ${a.scores.seo.passed}/${a.scores.seo.applicable} |`,
    `| AEO (answer readiness) | ${s(a.scores.aeo)} | ${a.scores.aeo.passed}/${a.scores.aeo.applicable} |`,
    `| GEO (AI visibility) | ${s(a.scores.geo)} | ${a.scores.geo.passed}/${a.scores.geo.applicable} |`,
    `| **Overall** | **${s(a.scores.overall)}** | ${a.scores.overall.passed}/${a.scores.overall.applicable} |`,
    ``,
    `> **Formula:** ${a.scores.overall.formula}. A dimension with no applicable checks is reported UNKNOWN, never zero.`,
    a.scores.geo.unknownReason ? `>\n> **GEO is UNKNOWN:** ${a.scores.geo.unknownReason}` : '',
    ``,
    `## Executive summary`,
    ``,
    `${a.crawl.pagesAnalyzed} page(s) of ${a.origin} were crawled live. ` +
      `Traditional SEO scores ${s(a.scores.seo)} and answer-engine readiness scores ${s(a.scores.aeo)}. ` +
      `${a.summary.topProblems.length} issue(s) need attention, ${a.summary.quickWins.length} of which are quick wins. ` +
      (a.scores.geo.score === null ? 'AI visibility was not measured — see Unknowns.' : `AI visibility scores ${s(a.scores.geo)}.`),
    ``,
    section('Top 5 problems', a.summary.topProblems, 'No failing checks.'),
    section('Top 5 opportunities', a.summary.topOpportunities, 'No actionable opportunities identified.'),
    section('Quick wins', a.summary.quickWins, 'None.'),
    section('Required technical fixes', a.summary.technicalFixes, 'None.'),
    section('Content opportunities', a.summary.contentOpportunities, 'None.'),
    meta.location ? section('Local SEO actions', a.summary.localActions, 'None.') : '',
    section('AEO / GEO actions', a.summary.aeoGeoActions, 'None.'),
    `## Competitor gap`,
    ``,
    a.competitors.length
      ? a.competitors.map((c) => `- **${c.host}** — ${c.basis}`).join('\n')
      : '_No competitor set was derived. Competitor discovery requires a search or AI provider; none is configured._',
    ``,
    `## 30-day action plan`,
    ``,
    (a.summary.quickWins.length ? a.summary.quickWins : a.summary.topOpportunities)
      .slice(0, 6).map((c, i) => `${i + 1}. ${c.title} — ${c.recommendation || 'See evidence above.'}`).join('\n') || '_Nothing outstanding._',
    ``,
    `## 90-day action plan`,
    ``,
    a.summary.topOpportunities.filter((c) => c.effort !== 'quick_win')
      .map((c, i) => `${i + 1}. ${c.title} — ${c.recommendation || ''}`).join('\n') || '_Nothing outstanding._',
    ``,
    `## Evidence / sources used`,
    ``,
    a.sourcesUsed.map((s2) => `- **${s2.source}** — ${s2.status}: ${s2.detail}`).join('\n'),
    ``,
    `## Unknown / unverified`,
    ``,
    a.unknowns.length ? a.unknowns.map((u) => `- ${u}`).join('\n') : '_Nothing withheld._',
    ``,
    `## All checks`,
    ``,
    `| Dimension | Check | Status | Severity | Evidence |`,
    `|---|---|---|---|---|`,
    ...a.checks.map((c) => `| ${c.dimension.toUpperCase()} | ${c.title} | ${c.status} | ${c.severity} | ${c.evidence.replace(/\|/g, '\\|').slice(0, 180)} |`),
    ``,
  ].filter((l) => l !== '').join('\n');
}
