// ---------------------------------------------------------------------------
// FORWARD PROGRESS — does a continuation segment add something new?
//
// Continuation is not limited by a segment COUNT. A task keeps going while
// each segment makes verified forward progress and authorised budget
// remains; it pauses for replanning when progress stalls. This module is the
// deterministic judgement of "stalled": no model grades another model.
//
// A segment makes forward progress when ALL of these hold:
//   * the provider reported how it ended (a capped response is expected here);
//   * it adds at least `minProgressChars` of non-whitespace text;
//   * its opening is not already present in the text so far (a restart);
//   * most of its word shingles are new (not a cycle over earlier text).
// ---------------------------------------------------------------------------

export interface ProgressVerdict {
  made: boolean;
  newChars: number;
  shingleOverlap: number;
  reason: string;
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

function shingles(text: string, n = 6): Set<string> {
  const words = norm(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function measureProgress(previous: string, next: string, opts: { minProgressChars: number; maxShingleOverlap: number }): ProgressVerdict {
  const n = norm(next);
  const newChars = n.replace(/\s/g, '').length;
  if (newChars < opts.minProgressChars) return { made: false, newChars, shingleOverlap: 1, reason: `added only ${newChars} characters (minimum ${opts.minProgressChars})` };
  const p = norm(previous);
  const opening = n.slice(0, Math.min(200, n.length));
  if (p && opening.length >= 40 && p.includes(opening)) return { made: false, newChars, shingleOverlap: 1, reason: 'the segment restarted text that was already written' };
  const a = shingles(next);
  const b = shingles(previous);
  let seen = 0;
  for (const s of a) if (b.has(s)) seen++;
  const overlap = a.size ? seen / a.size : 0;
  if (overlap > opts.maxShingleOverlap) return { made: false, newChars, shingleOverlap: overlap, reason: `${Math.round(overlap * 100)}% of the segment repeats earlier text (cycling)` };
  return { made: true, newChars, shingleOverlap: overlap, reason: 'new content' };
}
