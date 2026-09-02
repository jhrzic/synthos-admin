// ---------------------------------------------------------------------------
// SYNTHOS — the Verifier gate, deterministic checks only.
//
// Ported from ~/synthos/mission-control/src/lib/synthos-verifier.ts (the real,
// shipped implementation there), unchanged in behavior. Every check here is
// mechanical: no model is called, nothing costs money, and the same input
// always produces the same verdict.
//
// Two classes of check, and the distinction is load-bearing:
//
//   BLOCKING  non_empty, no_invented_urls, no_invented_prices,
//             no_placeholder_text. Failure blocks the work. Binary — a safety
//             check has no partial credit.
//
//   QUALITY   min_length, max_length, structural_completeness,
//             citation_density, directive_term_coverage. Continuous 0..1.
//             Failure lowers E(K); it must never veto, or a safe-but-brief
//             deliverable would be killed for being short.
//
// Grounding is the important blocking check. An agent may only state a URL or
// a price that already appears in the material it was given.
// ---------------------------------------------------------------------------

export interface VerifierCheck {
  name: string;
  passed: boolean;
  detail: string;
  /**
   * Continuous quality score in [0,1]. Blocking checks are binary (0 or 1) —
   * a safety check has no partial credit. Quality checks may be fractional.
   */
  score: number;
}

export interface VerifierResult {
  /** The SAFETY verdict — every blocking check passed. Quality is excluded. */
  passed: boolean;
  checks: VerifierCheck[];
  passedCount: number;
  totalCount: number;
  /** Blocking checks only — the containment verdict. */
  blockingPassed: boolean;
  /** Mean of the quality vectors, i.e. E(K). Calibration, never containment. */
  qualityScore: number;
}

export interface VerifierInput {
  content: string;
  agentName: string;
  /** Everything the output is allowed to draw facts from: directive + upstream. */
  groundingContext: string;
  /** The token ceiling the run was given, used for the sane-length bound. */
  maxTokens: number;
  /**
   * The sub-requirement for this task (title + description). Drives
   * directive_term_coverage. Empty means "no stated requirement", which
   * scores 1.0 — an absent requirement is not a failure to meet one.
   */
  requirementText?: string;
}

/** A deliverable shorter than this is not a deliverable. */
export const MIN_OUTPUT_CHARS = 20;
/** ~4 chars/token, with 1.5x slack before we call the length insane. */
export const LENGTH_SLACK = 1.5;

const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/gi;
const PRICE_RE = /(?:\$|£|€|\bUSD\s?)\s?\d[\d,]*(?:\.\d+)?/gi;

const PLACEHOLDERS = ['lorem ipsum', 'todo:', '[insert', 'insert here', 'xxxxx', '<placeholder>'];

/** Trailing punctuation should not make a grounded URL look invented. */
function normaliseUrl(u: string): string {
  return u.toLowerCase().replace(/[.,;:!?)\]}'"]+$/, '');
}

function normalisePrice(p: string): string {
  return p.toLowerCase().replace(/\s+/g, '').replace(/,/g, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function findUrls(text: string): string[] {
  return unique((text.match(URL_RE) ?? []).map(normaliseUrl));
}

export function findPrices(text: string): string[] {
  return unique((text.match(PRICE_RE) ?? []).map(normalisePrice));
}

/* ------------------------------------------------- quality-tier constants
 * These thresholds are tuning choices, not measurements. They are named and
 * exported so they can be adjusted from evidence later rather than being
 * buried as magic numbers.
 */
/** Citation markers needed for full credit on a substantial deliverable. */
export const CITATION_TARGET = 3;
/** Below this many chars, citation density is not a fair expectation. */
export const CITATION_EXEMPT_CHARS = 200;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'of', 'to', 'in',
  'on', 'for', 'with', 'as', 'by', 'at', 'from', 'into', 'about', 'it', 'its', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may',
  'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'i', 'not', 'no', 'so', 'up', 'out', 'over', 'also',
  'more', 'most', 'some', 'any', 'all', 'each', 'per', 'via', 'use', 'using', 'used', 'make', 'made', 'get',
]);

/** Content terms worth checking coverage against: >3 chars, not a stopword. */
export function keyTerms(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
    (w) => w.length > 3 && !STOPWORDS.has(w),
  );
  return [...new Set(words)];
}

/**
 * q3 structural_completeness — three mechanical structure signals.
 * A deliverable that is one unbroken run-on block scores low without being unsafe.
 */
export function structuralCompleteness(text: string): number {
  const t = text.trim();
  if (t.length === 0) return 0;
  const signals = [
    /^#{1,6}\s+\S|^[A-Z][^.!?\n]{3,80}:\s*$/m.test(t) || /\n\s*[-*•]\s+\S/.test(t),
    t.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length >= 2,
    /[.!?)\]"’”]$/.test(t),
  ];
  return signals.filter(Boolean).length / signals.length;
}

/**
 * q4 citation_density — how much of the output is anchored to the material it
 * was given. Counts reuse of grounded URLs and prices plus explicit [n]/[source]
 * markers. Short outputs are exempt rather than punished.
 */
export function citationDensity(content: string, groundingContext: string): number {
  if (content.trim().length < CITATION_EXEMPT_CHARS) return 1;
  const groundedUrls = new Set(findUrls(groundingContext));
  const groundedPrices = new Set(findPrices(groundingContext));
  const reusedUrls = findUrls(content).filter((u) => groundedUrls.has(u)).length;
  const reusedPrices = findPrices(content).filter((p) => groundedPrices.has(p)).length;
  const markers = (content.match(/\[(?:\d+|source|ref|citation)[^\]]*\]/gi) ?? []).length;
  return Math.min(1, (reusedUrls + reusedPrices + markers) / CITATION_TARGET);
}

/**
 * q5 directive_term_coverage — the deterministic proxy for requirement coverage.
 * Fraction of the sub-requirement's key terms that appear in the output.
 * No model call: same input always produces the same verdict.
 */
export function directiveTermCoverage(content: string, requirementText: string): number {
  const terms = keyTerms(requirementText);
  if (terms.length === 0) return 1;
  const body = content.toLowerCase();
  const hit = terms.filter((t) => body.includes(t)).length;
  return hit / terms.length;
}

/** Checks whose failure blocks. Everything else is quality. */
export const BLOCKING_CHECK_NAMES = [
  'non_empty',
  'no_invented_urls',
  'no_invented_prices',
  'no_placeholder_text',
] as const;

export function verifyOutput(input: VerifierInput): VerifierResult {
  const checks: VerifierCheck[] = [];
  const content = input.content ?? '';
  const trimmed = content.trim();

  // 1. non-empty
  checks.push({
    name: 'non_empty',
    passed: trimmed.length > 0,
    score: trimmed.length > 0 ? 1 : 0,
    detail: trimmed.length > 0 ? 'output is not empty' : 'output is empty',
  });

  // 2. minimum length
  checks.push({
    name: 'min_length',
    passed: trimmed.length >= MIN_OUTPUT_CHARS,
    score: trimmed.length >= MIN_OUTPUT_CHARS ? 1 : 0,
    detail:
      trimmed.length >= MIN_OUTPUT_CHARS
        ? `${trimmed.length} chars >= ${MIN_OUTPUT_CHARS}`
        : `${trimmed.length} chars is below the ${MIN_OUTPUT_CHARS}-char minimum`,
  });

  // 3. sane maximum length against the token budget the run was given
  const maxChars = Math.ceil(input.maxTokens * 4 * LENGTH_SLACK);
  checks.push({
    name: 'max_length',
    passed: trimmed.length <= maxChars,
    score: trimmed.length <= maxChars ? 1 : 0,
    detail:
      trimmed.length <= maxChars
        ? `${trimmed.length} chars <= ${maxChars} budget`
        : `${trimmed.length} chars exceeds the ${maxChars}-char budget for ${input.maxTokens} tokens`,
  });

  // 4. no invented URLs
  const groundedUrls = new Set(findUrls(input.groundingContext));
  const inventedUrls = findUrls(content).filter((u) => !groundedUrls.has(u));
  checks.push({
    name: 'no_invented_urls',
    passed: inventedUrls.length === 0,
    score: inventedUrls.length === 0 ? 1 : 0,
    detail:
      inventedUrls.length === 0
        ? 'every URL appears in the source material'
        : `invented URL(s) not present in the source material: ${inventedUrls.join(', ')}`,
  });

  // 5. no invented prices
  const groundedPrices = new Set(findPrices(input.groundingContext));
  const inventedPrices = findPrices(content).filter((p) => !groundedPrices.has(p));
  checks.push({
    name: 'no_invented_prices',
    passed: inventedPrices.length === 0,
    score: inventedPrices.length === 0 ? 1 : 0,
    detail:
      inventedPrices.length === 0
        ? 'every price appears in the source material'
        : `invented price(s) not present in the source material: ${inventedPrices.join(', ')}`,
  });

  // 6. no unfilled placeholder text
  const lower = content.toLowerCase();
  const found = PLACEHOLDERS.filter((p) => lower.includes(p));
  checks.push({
    name: 'no_placeholder_text',
    passed: found.length === 0,
    score: found.length === 0 ? 1 : 0,
    detail:
      found.length === 0 ? 'no placeholder text' : `unfilled placeholder(s): ${found.join(', ')}`,
  });

  // 7. structural completeness (quality — continuous)
  const structural = structuralCompleteness(content);
  checks.push({
    name: 'structural_completeness',
    passed: structural >= 1,
    score: structural,
    detail: `structure score ${structural.toFixed(2)} (heading/list, paragraphs, terminated)`,
  });

  // 8. citation density (quality — continuous)
  const citation = citationDensity(content, input.groundingContext);
  checks.push({
    name: 'citation_density',
    passed: citation >= 1,
    score: citation,
    detail: `citation density ${citation.toFixed(2)} against a target of ${CITATION_TARGET}`,
  });

  // 9. directive term coverage (quality — continuous, deterministic proxy)
  const coverage = directiveTermCoverage(content, input.requirementText ?? '');
  checks.push({
    name: 'directive_term_coverage',
    passed: coverage >= 1,
    score: coverage,
    detail: `covered ${(coverage * 100).toFixed(0)}% of the sub-requirement's key terms`,
  });

  const passedCount = checks.filter((c) => c.passed).length;
  const blocking = checks.filter((c) =>
    (BLOCKING_CHECK_NAMES as readonly string[]).includes(c.name),
  );
  const quality = checks.filter(
    (c) => !(BLOCKING_CHECK_NAMES as readonly string[]).includes(c.name),
  );
  const blockingPassed = blocking.every((c) => c.passed);
  const qualityScore =
    quality.length === 0
      ? 1
      : quality.reduce((sum, c) => sum + Math.min(1, Math.max(0, c.score)), 0) / quality.length;

  return {
    // Containment only. Calibration lives in qualityScore.
    passed: blockingPassed,
    checks,
    passedCount,
    totalCount: checks.length,
    blockingPassed,
    qualityScore,
  };
}
