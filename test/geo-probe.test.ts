import { describe, it, expect } from 'vitest';
import { buildGeoQueries, evaluateAnswer, runGeoProbe, GEO_MAX_QUERIES } from '../lib/aeo/geo-probe';
import { analyze } from '../lib/aeo/analyzer';

// ---------------------------------------------------------------------------
// GEO probe. Protects the analyzer's rule: AI visibility is only ever reported
// from queries that actually ran, and a failed query is dropped, never guessed.
// No test here spends money: `generate` is injected.
// ---------------------------------------------------------------------------

const biz = { businessName: 'Milford Mattress Co.', domain: 'milfordmattress.com', location: 'Milford, CT', targetService: 'mattress store' };

describe('buildGeoQueries', () => {
  it('asks a small, deterministic local panel', () => {
    const q = buildGeoQueries({ ...biz, targetKeywords: ['latex mattress', 'adjustable bed'] });
    expect(q.length).toBeLessThanOrEqual(GEO_MAX_QUERIES);
    expect(q[0]).toBe('What is the best mattress store in Milford, CT?');
    expect(buildGeoQueries({ ...biz, targetKeywords: ['latex mattress', 'adjustable bed'] })).toEqual(q);
  });
  it('asks nothing without a location or service', () => {
    expect(buildGeoQueries({ domain: 'x.com', location: 'Milford' })).toEqual([]);
    expect(buildGeoQueries({ domain: 'x.com', targetService: 'mattress' })).toEqual([]);
  });
});

describe('evaluateAnswer', () => {
  it('finds the brand by name in the answer text', () => {
    const r = evaluateAnswer('Locals like Milford Mattress for latex beds.', [{ web: { title: 'yelp.com' } }, { web: { title: 'mattressplusct.com' } }], biz);
    expect(r.brandAppeared).toBe(true);
    // Review sites are sources to get listed on, not competitors.
    expect(r.competitorsSeen).toEqual(['mattressplusct.com']);
    expect(r.citedSources).toContain('yelp.com');
  });
  it('finds the brand when only its site is cited', () => {
    const r = evaluateAnswer('Several stores stock latex.', [{ web: { title: 'milfordmattress.com' } }], biz);
    expect(r.brandAppeared).toBe(true);
    expect(r.competitorsSeen).toEqual([]);
  });
  it('reports absence and the sites occupying the answer', () => {
    const r = evaluateAnswer('Try Sleep Number or Mattress Firm.', [{ web: { title: 'mattressfirm.com' } }, { web: { uri: 'https://www.sleepnumber.com/x' } }], biz);
    expect(r.brandAppeared).toBe(false);
    expect(r.competitorsSeen).toEqual(['mattressfirm.com', 'sleepnumber.com']);
  });
});

describe('runGeoProbe', () => {
  it('drops failed queries and reports only what ran', async () => {
    let n = 0;
    const geo = await runGeoProbe(biz, async () => {
      n++;
      if (n === 2) throw new Error('BLOCKED_BUDGET');
      return { text: n === 1 ? 'Milford Mattress is well reviewed.' : 'Mattress Firm is nearby.', chunks: [] };
    });
    expect(geo.providerStatus).toBe('USED');
    expect(geo.queries.length).toBe(2);
    expect(geo.queries.filter((q) => q.brandAppeared).length).toBe(1);
    expect(geo.providerDetail).toMatch(/1 question\(s\) failed/);
  });
  it('is UNAVAILABLE, with no queries, when every call fails', async () => {
    const geo = await runGeoProbe(biz, async () => {
      throw new Error('BLOCKED_BUDGET');
    });
    expect(geo.providerStatus).toBe('UNAVAILABLE');
    expect(geo.queries).toEqual([]);
  });
  it('feeds the analyzer a warn when the brand appears in some answers', async () => {
    let n = 0;
    const geo = await runGeoProbe(biz, async () => ({ text: n++ === 0 ? 'Milford Mattress' : 'Other store', chunks: [] }));
    const analysis = analyze({
      crawl: {
        origin: 'https://milfordmattress.com', startedAt: '', finishedAt: '', durationMs: 1,
        robotsTxt: { present: false, status: 404, sitemapUrls: [], disallowCount: 0, raw: null },
        sitemap: { present: false, status: 404, urlCount: 0, sampledUrls: [] },
        pages: [], fetchFailures: [], discoveredExternalHosts: [],
      },
      domain: 'milfordmattress.com',
      geo,
    });
    const presence = analysis.checks.find((c) => c.id === 'geo.brand_presence');
    expect(presence?.status).toBe('warn');
    expect(presence?.evidence).toMatch(/1\/3/);
  });
});
