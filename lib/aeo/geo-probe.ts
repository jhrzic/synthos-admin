// ---------------------------------------------------------------------------
// GEO probe — the adapter that turns "AI visibility: NOT_CONFIGURED" into a
// measurement.
//
// For a small, disclosed panel of local-intent questions it asks Gemini WITH
// Google Search grounding (so the answer reflects the live web the way AI
// Overviews / AI Mode do, not stale training data) and records, per question:
//   - whether the business was named or its domain cited,
//   - which other sites were cited (competitors occupying the answer),
//   - the cited sources.
//
// Rules inherited from analyzer.ts:
//   - Frequencies, never a "rank". One engine, one sample, stated as such.
//   - Every call is a paid request and goes through guardedGeminiGenerate, so
//     it is reserved against the spend policy and appears in the ledger.
//   - A refused or failed query is dropped, not guessed; if none ran, the
//     caller reports UNAVAILABLE with the reason.
// ---------------------------------------------------------------------------

import type { GeoEvidence } from './analyzer';

export const GEO_ENGINE = 'gemini+google_search';
export const GEO_MAX_QUERIES = 5;
export const GEO_MODEL = process.env.GEO_PROBE_MODEL || 'gemini-3.5-flash';

export interface GeoProbeParams {
  businessName?: string;
  domain: string;
  location?: string;
  targetService?: string;
  targetKeywords?: string[];
}

/** The disclosed question panel. Deterministic so a re-audit asks the same questions. */
export function buildGeoQueries(p: GeoProbeParams): string[] {
  const where = p.location?.trim();
  const what = p.targetService?.trim() || p.targetKeywords?.[0]?.trim();
  if (!where || !what) return [];
  const qs = [
    `What is the best ${what} in ${where}?`,
    `Where should I go for ${what} near ${where}?`,
    `Recommend a trusted ${what} in ${where} with good reviews.`,
    ...(p.targetKeywords ?? []).slice(0, 3).map((k) => `${k} in ${where}`),
  ];
  return [...new Set(qs.map((q) => q.trim()))].slice(0, GEO_MAX_QUERIES);
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Distinctive words of a business name ("Milford Mattress Co." → ["milford mattress"]). */
function brandNeedles(name: string | undefined, domain: string): string[] {
  const needles: string[] = [];
  const cleaned = (name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|company|corp|the)\b\.?/g, '')
    .replace(/[^a-z0-9&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 4) needles.push(cleaned);
  const bareDomain = hostOf(domain.startsWith('http') ? domain : `https://${domain}`);
  if (bareDomain) needles.push(bareDomain);
  return needles;
}

/**
 * Review sites, directories, marketplaces and media that AI answers cite as
 * SOURCES. They are not competitors — they are where a business needs to be
 * listed. Kept out of competitorsSeen; they stay in citedSources.
 */
export const SOURCE_HOSTS = new Set([
  'yelp.com', 'google.com', 'maps.google.com', 'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com',
  'tripadvisor.com', 'bbb.org', 'trustpilot.com', 'birdeye.com', 'yellowpages.com', 'angi.com', 'thumbtack.com',
  'nextdoor.com', 'houzz.com', 'mapquest.com', 'foursquare.com', 'loc8nearme.com', 'consumeraffairs.com',
  'goodbed.com', 'wheretobuyamattress.com', 'wanderboat.ai', 'giftly.com', 'loopnet.com', 'atly.com',
  'chamberofcommerce.com', 'manta.com', 'wikipedia.org', 'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com',
]);

export function isSourceHost(host: string): boolean {
  return [...SOURCE_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
}

export interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

/**
 * Pure: judge one grounded answer. `chunks` are the grounding sources; their
 * titles usually carry the real site name because Google returns redirect URIs.
 */
export function evaluateAnswer(
  text: string,
  chunks: GroundingChunk[],
  params: Pick<GeoProbeParams, 'businessName' | 'domain'>,
): { brandAppeared: boolean; competitorsSeen: string[]; citedSources: string[] } {
  const needles = brandNeedles(params.businessName, params.domain);
  const own = needles[needles.length - 1] ?? '';
  const hay = text.toLowerCase();
  const cited = chunks
    .map((c) => (c.web?.title || hostOf(c.web?.uri || '') || '').toLowerCase().trim())
    .filter(Boolean);
  const brandAppeared = needles.some((n) => hay.includes(n) || cited.some((s) => s.includes(n)));
  const competitorsSeen = [...new Set(cited.filter((s) => !needles.some((n) => s.includes(n)) && s !== own && !isSourceHost(s)))];
  return { brandAppeared, competitorsSeen, citedSources: [...new Set(cited)] };
}

type Generate = (query: string) => Promise<{ text: string; chunks: GroundingChunk[] }>;

/**
 * Run the panel. `generate` performs one guarded, grounded call; injected so
 * tests never spend money and the service owns credentials and spend context.
 */
export async function runGeoProbe(params: GeoProbeParams, generate: Generate): Promise<GeoEvidence> {
  const queries = buildGeoQueries(params);
  if (queries.length === 0) {
    return {
      queries: [],
      providerStatus: 'UNAVAILABLE',
      providerDetail: 'A location and a target service (or keyword) are needed to ask AI engines local questions; none were given, so no AI query was executed.',
    };
  }
  const results: GeoEvidence['queries'] = [];
  const failures: string[] = [];
  for (const query of queries) {
    try {
      const { text, chunks } = await generate(query);
      results.push({ engine: GEO_ENGINE, query, ...evaluateAnswer(text, chunks, params) });
    } catch (err: any) {
      failures.push(`${query}: ${String(err?.message || err).slice(0, 120)}`);
    }
  }
  if (results.length === 0) {
    return {
      queries: [],
      providerStatus: 'UNAVAILABLE',
      providerDetail: `Gemini with Google Search was configured but every query failed or was blocked (${failures[0] ?? 'unknown'}). No AI query result is reported.`,
    };
  }
  return {
    queries: results,
    providerStatus: 'USED',
    providerDetail: `${results.length} of ${queries.length} questions asked of ${GEO_MODEL} with Google Search grounding on ${new Date().toISOString().slice(0, 10)}. One engine, one sample: answers vary between runs, so treat these as frequencies, not a ranking.${failures.length ? ` ${failures.length} question(s) failed and are excluded.` : ''}`,
  };
}
