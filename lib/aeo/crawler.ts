// ---------------------------------------------------------------------------
// AEO/GEO/SEO — real site crawler.
//
// Every value this module returns is READ FROM THE LIVE SITE over HTTP. There
// is no sample data, no seeded page list and no synthetic timing. If a fetch
// fails, the failure is recorded as a failure — never smoothed into a default.
//
// This is deliberately dependency-free (node fetch + regex parsing rather than
// a DOM library) so the audit pipeline has no new install surface. The parsing
// is therefore "good enough to observe", not a browser: anything it cannot
// determine is reported UNKNOWN rather than guessed.
// ---------------------------------------------------------------------------

export interface FetchedPage {
  url: string;
  status: number | null;
  ok: boolean;
  contentType: string | null;
  bytes: number;
  fetchedAt: string;
  durationMs: number;
  error: string | null;
  html: string | null;
}

export interface PageObservations {
  url: string;
  status: number | null;
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  metaDescriptionLength: number | null;
  canonical: string | null;
  metaRobots: string | null;
  lang: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  headingOrderIssues: string[];
  jsonLdBlocks: number;
  jsonLdTypes: string[];
  microdataTypes: string[];
  openGraphTags: number;
  twitterTags: number;
  images: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  externalHosts: string[];
  wordCount: number;
  questionHeadings: string[];
  /** Server-rendered visible text length — the AEO-relevant one. */
  visibleTextChars: number;
  scriptTags: number;
  error: string | null;
}

export interface SiteCrawlResult {
  origin: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  robotsTxt: { present: boolean; status: number | null; sitemapUrls: string[]; disallowCount: number; raw: string | null };
  sitemap: { present: boolean; status: number | null; urlCount: number; sampledUrls: string[] };
  pages: PageObservations[];
  fetchFailures: { url: string; error: string }[];
  discoveredExternalHosts: string[];
}

const UA = 'SynthOS-Audit/1.0 (+https://getsynthos.com; site audit)';
const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchPage(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchedPage> {
  const started = Date.now();
  const startedIso = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const contentType = res.headers.get('content-type');
    const isText = !contentType || /text|html|xml|json/i.test(contentType);
    const body = isText ? await res.text() : '';
    return {
      url,
      status: res.status,
      ok: res.ok,
      contentType,
      bytes: body.length,
      fetchedAt: startedIso,
      durationMs: Date.now() - started,
      error: null,
      html: body,
    };
  } catch (err: any) {
    return {
      url,
      status: null,
      ok: false,
      contentType: null,
      bytes: 0,
      fetchedAt: startedIso,
      durationMs: Date.now() - started,
      error: err?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : String(err?.message || err),
      html: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');
}

function stripTags(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  return decodeEntities(noScript.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function headings(html: string, level: number): string[] {
  const out: string[] = [];
  const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = stripTags(m[1]);
    if (t) out.push(t.slice(0, 200));
  }
  return out;
}

/** A heading that asks something — the primary AEO signal available from HTML alone. */
export function isQuestionHeading(text: string): boolean {
  if (/\?\s*$/.test(text)) return true;
  return /^(what|why|how|when|where|who|which|can|do|does|is|are|should|will)\b/i.test(text.trim());
}

export function observePage(page: FetchedPage, origin: string): PageObservations {
  const base: PageObservations = {
    url: page.url, status: page.status, title: null, titleLength: null,
    metaDescription: null, metaDescriptionLength: null, canonical: null, metaRobots: null, lang: null,
    h1: [], h2: [], h3: [], headingOrderIssues: [],
    jsonLdBlocks: 0, jsonLdTypes: [], microdataTypes: [], openGraphTags: 0, twitterTags: 0,
    images: 0, imagesMissingAlt: 0, internalLinks: 0, externalLinks: 0, externalHosts: [],
    wordCount: 0, questionHeadings: [], visibleTextChars: 0, scriptTags: 0,
    error: page.error,
  };
  if (!page.html) return base;
  const html = page.html;

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  base.title = titleM ? stripTags(titleM[1]) : null;
  base.titleLength = base.title ? base.title.length : null;

  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const name = (attr(tag, 'name') || '').toLowerCase();
    const prop = (attr(tag, 'property') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (name === 'description' && content) {
      base.metaDescription = decodeEntities(content);
      base.metaDescriptionLength = base.metaDescription.length;
    }
    if (name === 'robots' && content) base.metaRobots = content;
    if (prop.startsWith('og:')) base.openGraphTags++;
    if (name.startsWith('twitter:')) base.twitterTags++;
  }

  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if ((attr(tag, 'rel') || '').toLowerCase() === 'canonical') base.canonical = attr(tag, 'href');
  }

  const htmlTag = html.match(/<html\b[^>]*>/i);
  base.lang = htmlTag ? attr(htmlTag[0], 'lang') : null;

  base.h1 = headings(html, 1);
  base.h2 = headings(html, 2);
  base.h3 = headings(html, 3);
  if (base.h1.length === 0) base.headingOrderIssues.push('No H1 on page');
  if (base.h1.length > 1) base.headingOrderIssues.push(`${base.h1.length} H1 elements (expected 1)`);
  if (base.h1.length === 0 && base.h2.length > 0) base.headingOrderIssues.push('H2 present without an H1');
  base.questionHeadings = [...base.h1, ...base.h2, ...base.h3].filter(isQuestionHeading);

  const ldRe = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  while ((ld = ldRe.exec(html)) !== null) {
    base.jsonLdBlocks++;
    try {
      const parsed = JSON.parse(ld[1].trim());
      const collect = (node: any) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (typeof node === 'object') {
          if (typeof node['@type'] === 'string') base.jsonLdTypes.push(node['@type']);
          else if (Array.isArray(node['@type'])) base.jsonLdTypes.push(...node['@type'].filter((t: any) => typeof t === 'string'));
          if (node['@graph']) collect(node['@graph']);
        }
      };
      collect(parsed);
    } catch {
      base.jsonLdTypes.push('UNPARSEABLE');
    }
  }
  const micro = html.match(/itemtype\s*=\s*["']([^"']+)["']/gi) || [];
  base.microdataTypes = [...new Set(micro.map((m) => (m.split(/["']/)[1] || '').split('/').pop() || '').filter(Boolean))];

  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  base.images = imgs.length;
  base.imagesMissingAlt = imgs.filter((t) => {
    const a = attr(t, 'alt');
    return a === null || a.trim() === '';
  }).length;

  const anchors = html.match(/<a\b[^>]*href\s*=\s*("[^"]*"|'[^']*')[^>]*>/gi) || [];
  const hosts = new Set<string>();
  for (const a of anchors) {
    const href = attr(a, 'href');
    if (!href) continue;
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const resolved = new URL(href, origin);
      if (resolved.origin === origin) base.internalLinks++;
      else if (resolved.protocol.startsWith('http')) { base.externalLinks++; hosts.add(resolved.host); }
    } catch { /* unparseable href — not counted either way */ }
  }
  base.externalHosts = [...hosts];

  base.scriptTags = (html.match(/<script\b[^>]*src\s*=/gi) || []).length;
  const text = stripTags(html);
  base.visibleTextChars = text.length;
  base.wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  return base;
}

function parseRobots(raw: string): { sitemapUrls: string[]; disallowCount: number } {
  const sitemapUrls: string[] = [];
  let disallowCount = 0;
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (/^sitemap\s*:/i.test(l)) sitemapUrls.push(l.split(/:(.+)/)[1]?.trim() || '');
    if (/^disallow\s*:/i.test(l) && l.split(':')[1]?.trim()) disallowCount++;
  }
  return { sitemapUrls: sitemapUrls.filter(Boolean), disallowCount };
}

/** True only when the response really is a robots.txt, not an SPA 404 page served with HTTP 200. */
function looksLikeRobots(body: string): boolean {
  return /^\s*(user-agent|sitemap|disallow|allow)\s*:/im.test(body) && !/<html/i.test(body.slice(0, 400));
}

export async function crawlSite(params: {
  domain: string;
  maxPages?: number;
  timeoutMs?: number;
}): Promise<SiteCrawlResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const maxPages = Math.min(Math.max(params.maxPages ?? 12, 1), 40);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let origin: string;
  try {
    const u = new URL(params.domain.startsWith('http') ? params.domain : `https://${params.domain}`);
    origin = u.origin;
  } catch {
    throw new Error(`Not a valid domain or URL: ${params.domain}`);
  }

  const failures: { url: string; error: string }[] = [];

  // --- robots.txt ---
  const robotsRes = await fetchPage(`${origin}/robots.txt`, timeoutMs);
  const robotsIsReal = Boolean(robotsRes.ok && robotsRes.html && looksLikeRobots(robotsRes.html));
  const robotsParsed = robotsIsReal ? parseRobots(robotsRes.html!) : { sitemapUrls: [], disallowCount: 0 };
  const robots = {
    present: robotsIsReal,
    status: robotsRes.status,
    sitemapUrls: robotsParsed.sitemapUrls,
    disallowCount: robotsParsed.disallowCount,
    raw: robotsIsReal ? robotsRes.html!.slice(0, 2000) : null,
  };

  // --- sitemap ---
  const sitemapCandidates = [...robots.sitemapUrls, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  let sitemap = { present: false, status: null as number | null, urlCount: 0, sampledUrls: [] as string[] };
  const sitemapUrls: string[] = [];
  for (const cand of sitemapCandidates) {
    const r = await fetchPage(cand, timeoutMs);
    if (r.ok && r.html && /<urlset|<sitemapindex/i.test(r.html)) {
      const locs = [...r.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      sitemap = { present: true, status: r.status, urlCount: locs.length, sampledUrls: locs.slice(0, 50) };
      sitemapUrls.push(...locs);
      break;
    }
    if (!sitemap.status) sitemap.status = r.status;
  }

  // --- page set: homepage, then sitemap urls, then homepage internal links ---
  const home = await fetchPage(origin, timeoutMs);
  if (!home.ok) failures.push({ url: origin, error: home.error || `HTTP ${home.status}` });
  const homeObs = observePage(home, origin);

  const queue: string[] = [];
  const seen = new Set<string>([origin]);
  const push = (u: string) => {
    try {
      const abs = new URL(u, origin);
      if (abs.origin !== origin) return;
      abs.hash = '';
      const s = abs.toString().replace(/\/$/, '') || origin;
      if (!seen.has(s) && !/\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|xml)$/i.test(abs.pathname)) {
        seen.add(s); queue.push(s);
      }
    } catch { /* skip */ }
  };
  sitemapUrls.forEach(push);
  if (home.html) {
    for (const a of home.html.match(/<a\b[^>]*href\s*=\s*("[^"]*"|'[^']*')[^>]*>/gi) || []) {
      const href = attr(a, 'href');
      if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) push(href);
    }
  }

  const pages: PageObservations[] = [homeObs];
  for (const url of queue.slice(0, maxPages - 1)) {
    const r = await fetchPage(url, timeoutMs);
    if (!r.ok) failures.push({ url, error: r.error || `HTTP ${r.status}` });
    pages.push(observePage(r, origin));
  }

  const externalHosts = [...new Set(pages.flatMap((p) => p.externalHosts))];

  return {
    origin,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    robotsTxt: robots,
    sitemap,
    pages,
    fetchFailures: failures,
    discoveredExternalHosts: externalHosts,
  };
}
