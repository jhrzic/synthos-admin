import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { observePage, isQuestionHeading } from '../lib/aeo/crawler';
import { analyze, dimensionScore, renderReport, type Check } from '../lib/aeo/analyzer';
import type { SiteCrawlResult, FetchedPage } from '../lib/aeo/crawler';

// ---------------------------------------------------------------------------
// AEO/GEO/SEO audit pipeline.
//
// The rule this file protects above all others: THE PIPELINE NEVER INVENTS A
// NUMBER. A dimension with no evaluable evidence must score null (rendered
// UNKNOWN), and AI-visibility must never be asserted unless a provider was
// genuinely queried. Both were the failure mode of the surface this replaces.
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');
const serverContent = read('server.ts');
const view = read('src/components/AeoAuditView.tsx');
const analyzerSrc = read('lib/aeo/analyzer.ts');
// The audit run moved into a shared service so the HTTP route, the scheduler
// envelope and graph capability nodes all execute the identical code path.
// These assertions follow the behaviour to where it now lives.
const serviceSrc = read('lib/aeo/service.ts');
const crawlerSrc = read('lib/aeo/crawler.ts');

const page = (html: string, url = 'https://example.com/'): FetchedPage => ({
  url, status: 200, ok: true, contentType: 'text/html', bytes: html.length,
  fetchedAt: new Date().toISOString(), durationMs: 1, error: null, html,
});

function crawlOf(pages: FetchedPage[], over: Partial<SiteCrawlResult> = {}): SiteCrawlResult {
  const origin = 'https://example.com';
  return {
    origin, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 10,
    robotsTxt: { present: false, status: 404, sitemapUrls: [], disallowCount: 0, raw: null },
    sitemap: { present: false, status: 404, urlCount: 0, sampledUrls: [] },
    pages: pages.map((p) => observePage(p, origin)),
    fetchFailures: [], discoveredExternalHosts: [],
    ...over,
  };
}

const NO_GEO = { queries: [], providerStatus: 'NOT_CONFIGURED' as const, providerDetail: 'No provider configured.' };

describe('1: the crawler observes only what the HTML actually contains', () => {
  it('extracts title, description, canonical, headings and schema types', () => {
    const o = observePage(page(`
      <html lang="en"><head>
        <title>Acme Roofing</title>
        <meta name="description" content="Roofing in Leeds">
        <link rel="canonical" href="https://example.com/">
        <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      </head><body><h1>Acme Roofing</h1><h2>How much does a roof cost?</h2></body></html>`), 'https://example.com');
    expect(o.title).toBe('Acme Roofing');
    expect(o.metaDescription).toBe('Roofing in Leeds');
    expect(o.canonical).toBe('https://example.com/');
    expect(o.lang).toBe('en');
    expect(o.h1).toEqual(['Acme Roofing']);
    expect(o.jsonLdBlocks).toBe(1);
    expect(o.jsonLdTypes).toContain('Organization');
    expect(o.questionHeadings).toContain('How much does a roof cost?');
  });

  it('reports absence as absence rather than defaulting', () => {
    const o = observePage(page('<html><body><p>hi</p></body></html>'), 'https://example.com');
    expect(o.title).toBeNull();
    expect(o.metaDescription).toBeNull();
    expect(o.canonical).toBeNull();
    expect(o.jsonLdBlocks).toBe(0);
    expect(o.h1).toEqual([]);
  });

  it('counts only images genuinely missing alt text', () => {
    const o = observePage(page('<img src="a.png" alt="a"><img src="b.png"><img src="c.png" alt="">'), 'https://example.com');
    expect(o.images).toBe(3);
    expect(o.imagesMissingAlt).toBe(2);
  });

  it('separates internal from external links', () => {
    const o = observePage(page('<a href="/about">a</a><a href="https://other.com/x">b</a><a href="#top">c</a>'), 'https://example.com');
    expect(o.internalLinks).toBe(1);
    expect(o.externalLinks).toBe(1);
    expect(o.externalHosts).toEqual(['other.com']);
  });

  it('recognises question headings', () => {
    expect(isQuestionHeading('What is AEO?')).toBe(true);
    expect(isQuestionHeading('How we work')).toBe(true);
    expect(isQuestionHeading('Our services')).toBe(false);
  });

  it('a failed fetch yields an observation carrying the error, not blank success', () => {
    const failed: FetchedPage = { url: 'https://example.com/x', status: null, ok: false, contentType: null, bytes: 0, fetchedAt: '', durationMs: 1, error: 'ECONNREFUSED', html: null };
    const o = observePage(failed, 'https://example.com');
    expect(o.error).toBe('ECONNREFUSED');
    expect(o.status).toBeNull();
  });
});

describe('2: NO FABRICATED SCORES', () => {
  it('a dimension with zero applicable checks scores null, never 0', () => {
    const d = dimensionScore([]);
    expect(d.score).toBeNull();
    expect(d.applicable).toBe(0);
    expect(d.unknownReason).toBeTruthy();
  });

  it('not_applicable and unknown checks never drag a score down', () => {
    const checks: Check[] = [
      { id: 'a', dimension: 'seo', title: 'a', status: 'pass', severity: 'high', evidence: 'e' },
      { id: 'b', dimension: 'seo', title: 'b', status: 'not_applicable', severity: 'critical', evidence: 'e' },
      { id: 'c', dimension: 'seo', title: 'c', status: 'unknown', severity: 'critical', evidence: 'e' },
    ];
    expect(dimensionScore(checks).score).toBe(100);
    expect(dimensionScore(checks).applicable).toBe(1);
  });

  it('the formula is published with every score', () => {
    expect(dimensionScore([{ id: 'a', dimension: 'seo', title: 'a', status: 'pass', severity: 'low', evidence: 'e' }]).formula)
      .toContain('Σ(weight of passed)');
  });

  it('there is exactly one scoring function, and no random or hardcoded score', () => {
    expect(analyzerSrc).not.toMatch(/Math\.random/);
    // No literal score assignments — every number must come from dimensionScore.
    expect(analyzerSrc).not.toMatch(/score:\s*\d+\s*[,}]/);
    expect((analyzerSrc.match(/export function dimensionScore/g) || []).length).toBe(1);
  });
});

describe('3: GEO / AI visibility is never claimed without a query', () => {
  it('with no provider, GEO scores UNKNOWN and an explicit no-claim note is recorded', () => {
    const a = analyze({ crawl: crawlOf([page('<html><head><title>t</title></head><body><h1>h</h1></body></html>')]), domain: 'example.com', geo: NO_GEO });
    expect(a.scores.geo.score).toBeNull();
    expect(a.scores.geo.unknownReason).toBeTruthy();
    expect(a.checks.filter((c) => c.dimension === 'geo')).toHaveLength(0);
    expect(a.unknowns.join(' ')).toMatch(/No claim is made about whether this brand appears in ChatGPT, Perplexity, Gemini/i);
  });

  it('GEO findings appear only when queries were genuinely executed', () => {
    const a = analyze({
      crawl: crawlOf([page('<html><head><title>t</title></head><body><h1>h</h1></body></html>')]),
      domain: 'example.com',
      geo: { providerStatus: 'USED', providerDetail: 'queried', queries: [{ engine: 'test', query: 'q', brandAppeared: false, competitorsSeen: ['rival.com'], citedSources: [] }] },
    });
    expect(a.checks.some((c) => c.id === 'geo.brand_presence')).toBe(true);
    expect(a.scores.geo.score).not.toBeNull();
    expect(a.competitors.map((c) => c.host)).toContain('rival.com');
  });

  it('competitors are never inferred from outbound links', () => {
    const a = analyze({
      crawl: crawlOf([page('<a href="https://rival.com">x</a>')], { discoveredExternalHosts: ['rival.com'] }),
      domain: 'example.com', geo: NO_GEO,
    });
    expect(a.competitors).toHaveLength(0);
    expect(a.unknowns.join(' ')).toMatch(/outbound links are not competitors/i);
  });
});

describe('4: findings are evidence-backed', () => {
  it('a missing sitemap and robots.txt are reported as failures with the real status', () => {
    const a = analyze({ crawl: crawlOf([page('<html><head><title>t</title></head><body><h1>h</h1></body></html>')]), domain: 'example.com', geo: NO_GEO });
    const sitemap = a.checks.find((c) => c.id === 'seo.sitemap')!;
    expect(sitemap.status).toBe('fail');
    expect(sitemap.recommendation).toBeTruthy();
    expect(a.checks.find((c) => c.id === 'seo.robots')!.status).toBe('fail');
  });

  it('an empty crawl produces unknown checks rather than confident failures', () => {
    const a = analyze({ crawl: crawlOf([]), domain: 'example.com', geo: NO_GEO });
    const titles = a.checks.find((c) => c.id === 'seo.titles')!;
    expect(titles.status).toBe('unknown');
  });

  it('image alt is not_applicable when there are no images — not a failure', () => {
    const a = analyze({ crawl: crawlOf([page('<html><head><title>t</title></head><body><h1>h</h1></body></html>')]), domain: 'example.com', geo: NO_GEO });
    expect(a.checks.find((c) => c.id === 'seo.image_alt')!.status).toBe('not_applicable');
  });

  it('local checks only appear when a location was actually supplied', () => {
    const base = crawlOf([page('<html><head><title>t</title></head><body><h1>h</h1></body></html>')]);
    expect(analyze({ crawl: base, domain: 'e.com', geo: NO_GEO }).checks.some((c) => c.category === 'local')).toBe(false);
    expect(analyze({ crawl: base, domain: 'e.com', location: 'Leeds', geo: NO_GEO }).checks.some((c) => c.category === 'local')).toBe(true);
  });
});

describe('5: report rendering and unsafe external content', () => {
  it('renders UNKNOWN rather than a number for an unmeasured dimension', () => {
    const a = analyze({ crawl: crawlOf([page('<html><head><title>t</title></head><body><h1>h</h1></body></html>')]), domain: 'example.com', geo: NO_GEO });
    const md = renderReport(a, {});
    expect(md).toMatch(/GEO \(AI visibility\) \| UNKNOWN/);
    expect(md).toContain('never zero');
  });

  it('site-controlled text cannot break the evidence table', () => {
    // A title containing a pipe would otherwise corrupt the markdown table.
    const a = analyze({ crawl: crawlOf([page('<html><head><title>a|b|c</title></head><body><h1>h</h1></body></html>')]), domain: 'example.com', geo: NO_GEO });
    const md = renderReport(a, {});
    const tableRows = md.split('\n').filter((l) => l.startsWith('| SEO |'));
    for (const row of tableRows) expect(row.split(' | ').length).toBeLessThanOrEqual(6);
  });

  it('the UI never dangerously injects crawled site content', () => {
    // Everything from the audited site is rendered as text, never as HTML.
    expect(view).not.toContain('dangerouslySetInnerHTML');
  });

  it('script and style content is excluded from the visible-text measurement', () => {
    const o = observePage(page('<html><body><script>var evil="LOTSOFTEXT"</script><p>hi</p></body></html>'), 'https://example.com');
    expect(o.visibleTextChars).toBeLessThan(20);
    expect(o.wordCount).toBe(1);
  });
});

describe('6: server wiring — persistence, isolation, honest degradation', () => {
  const slice = (name: string) => {
    const i = serverContent.indexOf(`app.post("/api/aeo/${name}"`);
    expect(i).toBeGreaterThan(-1);
    const n = serverContent.indexOf('\n  app.', i + 10);
    return serverContent.slice(i, n === -1 ? undefined : n);
  };

  it('every audit route is workspace-guarded', () => {
    expect(slice('audit')).toContain('requireWorkspaceMember(fromBody)');
    expect(slice('missions')).toContain('requireWorkspaceMember(fromBody)');
    expect(serverContent).toContain('app.get("/api/aeo/audits", requireWorkspaceMember(fromQuery)');
  });

  it('audits persist through the canonical spine — no second report database', () => {
    for (const fn of ['createInitialTask', 'writeWorkspaceArtifact', 'indexVaultArtifact', 'runScopedAegis', 'recordQualityReview', 'recordReceipt']) {
      expect(serviceSrc).toContain(fn);
    }
    expect(serverContent).not.toContain('CREATE TABLE IF NOT EXISTS aeo_audits');
    // And the route delegates rather than re-implementing it.
    expect(slice('audit')).toContain('runAeoAudit({');
  });

  it('the canonical lifecycle Aegis requires is actually walked', () => {
    for (const st of ["'READY'", "'RUNNING'", "'AWAITING_VERIFICATION'"]) expect(serviceSrc).toContain(st);
    for (const ev of ['PROVIDER_COMPLETED', 'ARTIFACT_SAVED']) expect(serviceSrc).toContain(ev);
  });

  it('an unreachable site fails loudly instead of returning an empty audit', () => {
    expect(serviceSrc).toContain('SITE_UNREACHABLE');
    expect(serviceSrc).toContain('CRAWL_FAILED');
    // The route surfaces that failure as a real error status, never a 200.
    expect(slice('audit')).toContain('res.status(422)');
  });

  it('missing providers are named rather than silently ignored', () => {
    expect(serverContent).toContain('resolveGeoProvider');
    for (const k of ['GEMINI_API_KEY', 'SERPAPI_KEY', 'DATAFORSEO_LOGIN', 'BRIGHTDATA_API_KEY', 'OPENSEO_API_KEY']) {
      expect(serverContent).toContain(k);
    }
    expect(serverContent).toContain('"NOT_CONFIGURED"');
  });

  it('audit history reads the Vault artifacts already written', () => {
    const i = serverContent.indexOf('app.get("/api/aeo/audits"');
    const s = serverContent.slice(i, i + 1400);
    expect(s).toContain('listWorkspaceVaultEntries');
    expect(s).toContain('AEO-Audits/');
  });

  it('aeo.audit is a registered capability so a recheck schedule really resolves', () => {
    const reg = read('lib/fabric/registry.ts');
    expect(reg).toContain("key: 'aeo.audit'");
    expect(reg).toContain('aeoAuditCapability()');
  });
});

describe('7: no demo behaviour survives', () => {
  it('the crawler has no sample/fixture page set', () => {
    for (const bad of ['SAMPLE_', 'MOCK_', 'DEMO_', 'Math.random']) expect(crawlerSrc).not.toContain(bad);
  });

  it('the view has no seeded audit and shows the formula to the user', () => {
    expect(view).not.toMatch(/const\s+(SAMPLE|MOCK|DEMO)/);
    expect(view).toContain('Score formula');
    expect(view).toContain('UNKNOWN');
  });

  it('the scheduler limitation is stated rather than hidden', () => {
    expect(view).toMatch(/calendar recurrence/i);
  });
});
