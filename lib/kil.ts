// ---------------------------------------------------------------------------
// SYNTHOS — Knowledge Intelligence Layer, confidence scoring.
//
// Ported unchanged from the real, shipped implementation at
// ~/synthos/mission-control/src/lib/synthos-kil.ts. This is the CURRENT
// shipped formula there — not the earlier documented baseline in
// synthos-orbit-master-architecture-v2.md (superseded), and not the fuller
// kil-v2-scoring-spec.md design (which adds a decay term, simulation gate,
// and human-review multiplier that the shipped code does not implement).
// Per the migration directive: those three terms are deliberately NOT added
// here. This ports exactly what is real and running today, nothing more.
//
// The architecture is a gated two-tier score, and the split is the point:
//
//   CONTAINMENT — V(K) is a hard multiplicative gate. Any blocking safety
//   failure returns 0.00. It is not a weighted term, because a weighted
//   safety term can be averaged away by good prose.
//
//   CALIBRATION — E(K) is five continuous quality vectors. A deliverable can
//   be thin, unstructured or lightly cited without being dangerous, so
//   quality never vetoes: it lowers the score and holds the knowledge back.
//
//     C(K) = V(K) · [ wE·E(K) + wF·F(K) ]        S excluded while unbuilt
//
// Promotion needs BOTH C(K) >= 0.85 AND E(K) >= 0.90.
//
// Pure functions only: no database, no clock, no I/O. Same input, same verdict.
// ---------------------------------------------------------------------------

/** The verifier's nine deterministic checks, by class. */
export interface KilCheckResults {
  // Blocking (V): safety and grounding. Any failure -> C(K) = 0.00
  no_invented_urls: boolean;
  no_invented_prices: boolean;
  non_empty: boolean;
  no_placeholder_text: boolean;
  // Quality (E): continuous, 0..1
  min_length: number;
  max_length: number;
  structural_completeness: number;
  citation_density: number;
  directive_term_coverage: number;
}

export const BLOCKING_CHECKS = [
  'no_invented_urls',
  'no_invented_prices',
  'non_empty',
  'no_placeholder_text',
] as const satisfies readonly (keyof KilCheckResults)[];

export const QUALITY_CHECKS = [
  'min_length',
  'max_length',
  'structural_completeness',
  'citation_density',
  'directive_term_coverage',
] as const satisfies readonly (keyof KilCheckResults)[];

export interface KilInput {
  checks: KilCheckResults;
  /** This agent's prior verified attempts. Drives the track-record ramp. */
  attempts: number;
}

export const PROMOTION_THRESHOLD = 0.85;
/** A track record must never buy promotion for structurally incomplete work. */
export const QUALITY_FLOOR = 0.9;

const W_E = 0.7;
const W_F = 0.3;
/** Ramp constant: F reaches 0.75 at n=5, approaches 1.0 asymptotically. */
const RAMP_K = 5;

/** V(K) — product of the blocking checks. Any zero makes the whole gate zero. */
export function verificationGate(checks: KilCheckResults): 0 | 1 {
  return BLOCKING_CHECKS.every((c) => checks[c]) ? 1 : 0;
}

/** E(K) — mean of the five continuous quality vectors, each clamped to [0,1]. */
export function evidenceQuality(checks: KilCheckResults): number {
  const total = QUALITY_CHECKS.reduce(
    (sum, c) => sum + Math.min(1, Math.max(0, Number(checks[c]) || 0)),
    0,
  );
  return total / QUALITY_CHECKS.length;
}

/**
 * F(K) — track record with a 0.50 prior and an asymptotic ramp.
 *
 * Starts at "unknown", not at "failed". n=1 -> 0.583, n=5 -> 0.750,
 * n->inf -> 1.000.
 */
export function trackRecord(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return 0.5 + 0.5 * (n / (n + RAMP_K));
}

/** C(K). Returns 0.00 on any blocking failure, else the weighted quality score. */
export function calculateKilConfidence(input: KilInput): number {
  if (verificationGate(input.checks) === 0) return 0;
  const score = W_E * evidenceQuality(input.checks) + W_F * trackRecord(input.attempts);
  return Math.round(score * 1000) / 1000;
}

/**
 * Promotion needs both gates. Confidence alone cannot authorise promotion —
 * that is what the quality floor is for.
 */
export function isPromoted(confidence: number, evidence: number): boolean {
  return confidence >= PROMOTION_THRESHOLD && evidence >= QUALITY_FLOOR;
}
