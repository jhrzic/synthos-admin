// ---------------------------------------------------------------------------
// OFFICIAL PRICING PARSERS — provider-published markdown → price records.
//
// Sources are the providers' own documentation, served as markdown by the
// providers themselves:
//   OpenAI  https://platform.openai.com/docs/pricing.md   (+ /docs/models/<id>.md for the long-context threshold)
//   Google  https://ai.google.dev/gemini-api/docs/pricing.md.txt
//   Google  https://ai.google.dev/gemini-api/docs/antigravity-agent.md.txt (which model the agent runs on)
//
// STRICT BY DESIGN. Each parser recognises a small set of grammars it has been
// written against. A cell it does not recognise yields NO price for that model
// — never a partial or best-guess one — and the model stays PRICE_UNKNOWN,
// which the spend guard blocks. Every number is sanity-bounded, so a parse
// that wanders into an image or per-minute price is rejected rather than
// mistaken for a per-token price.
//
// Nothing here calls a model, and nothing here performs I/O: parsers take text.
// ---------------------------------------------------------------------------

export interface RateSet {
  input: number;
  output: number;
  cachedInput: number | null;
}

/** A price valid from `from` (inclusive) until `until` (inclusive), ISO dates; null = open. */
export interface PriceWindow {
  from: string | null;
  until: string | null;
  rates: RateSet;
}

export interface PriceRecord {
  provider: 'openai' | 'gemini' | 'antigravity' | 'openai_tts';
  modelId: string;
  unit: 'tokens' | 'chars';
  currency: 'USD';
  /** Standard-tier (and short-context) prices, possibly date-windowed. */
  windows: PriceWindow[];
  /** Prices that apply above a prompt-size threshold. thresholdTokens null = threshold not published. */
  longContext: { thresholdTokens: number | null; windows: PriceWindow[] } | null;
  /** Antigravity: the Gemini record this price is derived from. */
  derivedFrom: string | null;
  sourceUrl: string;
  notes: string[];
}

/** Largest per-million price accepted. Anything above is a mis-parse (images, minutes, requests), not a token price. */
const MAX_RATE = 5000;

function money(cell: string): number | null {
  const t = cell.trim();
  if (t === '-' || t === '' ) return null;
  const m = /^\$\s*([0-9]+(?:\.[0-9]+)?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= 0 && v <= MAX_RATE ? v : null;
}

const MONTHS: Record<string, number> = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
function isoDate(text: string): string | null {
  const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(text.trim());
  if (!m || MONTHS[m[1]] === undefined) return null;
  const d = new Date(Date.UTC(Number(m[3]), MONTHS[m[1]], Number(m[2])));
  return d.toISOString().slice(0, 10);
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

export function parseOpenAiPricingMarkdown(md: string, sourceUrl: string): { records: PriceRecord[]; needsThreshold: string[] } {
  const records: PriceRecord[] = [];
  const needsThreshold: string[] = [];
  const lines = md.split('\n');

  // 1. The standard-tier text model table.
  const start = lines.findIndex((l) => l.trim() === '### Standard pricing data');
  if (start >= 0) {
    const headerIdx = lines.findIndex((l, i) => i > start && l.trim().startsWith('| Model |'));
    if (headerIdx > 0) {
      const header = splitRow(lines[headerIdx]).map((h) => h.toLowerCase());
      const col = (name: string) => header.indexOf(name);
      const iIn = col('short context input'), iCached = col('short context cached input'), iOut = col('short context output');
      const lIn = col('long context input'), lCached = col('long context cached input'), lOut = col('long context output');
      if (iIn > 0 && iOut > 0) {
        for (let i = headerIdx + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
          const cells = splitRow(lines[i]);
          const rawName = cells[0] || '';
          const nm = /^([a-z0-9][a-z0-9.\-]*)(?:\s*\(<\s*(\d+)K context length\))?$/i.exec(rawName);
          if (!nm) continue;
          const input = money(cells[iIn] ?? ''); const output = money(cells[iOut] ?? '');
          if (input === null || output === null) continue; // unpriced or unparsable: stays unknown
          const cachedInput = iCached > 0 ? money(cells[iCached] ?? '') : null;
          const longIn = lIn > 0 ? money(cells[lIn] ?? '') : null;
          const longOut = lOut > 0 ? money(cells[lOut] ?? '') : null;
          const longCached = lCached > 0 ? money(cells[lCached] ?? '') : null;
          const threshold = nm[2] ? Number(nm[2]) * 1000 : null;
          const hasLong = longIn !== null && longOut !== null;
          if (hasLong && threshold === null) needsThreshold.push(nm[1]);
          records.push({
            provider: 'openai', modelId: nm[1], unit: 'tokens', currency: 'USD',
            windows: [{ from: null, until: null, rates: { input, output, cachedInput } }],
            longContext: hasLong ? { thresholdTokens: threshold, windows: [{ from: null, until: null, rates: { input: longIn!, output: longOut!, cachedInput: longCached } }] } : null,
            derivedFrom: null, sourceUrl, notes: [],
          });
        }
      }
    }
  }

  // 2. Speech models priced per character ("$15.00 / 1M characters").
  for (const line of lines) {
    const cells = line.trim().startsWith('|') ? splitRow(line) : [];
    if (cells.length < 3) continue;
    const m = /^\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*1M characters$/.exec(cells[2] || '');
    if (!/^[a-z0-9][a-z0-9.\-]*$/i.test(cells[0] || '') || (cells[1] || '').toLowerCase() !== 'text' || !m) continue;
    const v = Number(m[1]);
    if (!Number.isFinite(v) || v > MAX_RATE) continue;
    records.push({
      provider: 'openai_tts', modelId: cells[0], unit: 'chars', currency: 'USD',
      windows: [{ from: null, until: null, rates: { input: v, output: 0, cachedInput: null } }],
      longContext: null, derivedFrom: null, sourceUrl, notes: [],
    });
  }
  return { records, needsThreshold };
}

/** "Prompts with >272K input tokens are priced at …" on a model's own page. */
export function parseOpenAiLongContextThreshold(modelMd: string): number | null {
  const m = /Prompts with\s*>\s*(\d+)K input tokens are priced/i.exec(modelMd);
  return m ? Number(m[1]) * 1000 : null;
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

type CellPrice =
  | { kind: 'windows'; windows: Array<{ from: string | null; until: string | null; price: number }> }
  | { kind: 'tiers'; thresholdTokens: number; short: number; long: number };

function cleanCell(cell: string): string {
  return cell.replace(/\^\\?\*+\\?\*?\^/g, '').replace(/\\([<>*])/g, '$1').replace(/\s+/g, ' ').trim();
}

function ok(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= MAX_RATE;
}

/** The TEXT per-million-token price in a Gemini paid-tier cell, or null when the cell is not one we understand. */
export function parseGeminiCell(raw: string, opts: { allowTrailing?: boolean; conservativeMax?: boolean } = {}): CellPrice | null {
  const cell = cleanCell(raw);
  let m = /^\$([0-9]+(?:\.[0-9]+)?) through ([A-Z][a-z]+ \d{1,2}, \d{4})\. \$([0-9]+(?:\.[0-9]+)?) starting ([A-Z][a-z]+ \d{1,2}, \d{4})\.(.*)$/.exec(cell);
  if (m && (opts.allowTrailing || m[5].trim() === '')) {
    const until = isoDate(m[2]); const from = isoDate(m[4]);
    const a = Number(m[1]); const b = Number(m[3]);
    if (until && from && ok(a) && ok(b)) return { kind: 'windows', windows: [{ from: null, until, price: a }, { from, until: null, price: b }] };
    return null;
  }
  m = /^\$([0-9]+(?:\.[0-9]+)?), prompts <= (\d+)k tokens \$([0-9]+(?:\.[0-9]+)?), prompts > \d+k(?: tokens)?$/.exec(cell);
  if (m) {
    const a = Number(m[1]); const b = Number(m[3]);
    return ok(a) && ok(b) ? { kind: 'tiers', thresholdTokens: Number(m[2]) * 1000, short: a, long: b } : null;
  }
  m = /^\$([0-9]+(?:\.[0-9]+)?)$/.exec(cell);
  if (m) return ok(Number(m[1])) ? { kind: 'windows', windows: [{ from: null, until: null, price: Number(m[1]) }] } : null;
  // Modality-labelled components: take the one whose label names text.
  const parts = [...cell.matchAll(/\$([0-9]+(?:\.[0-9]+)?)(?: or \$[0-9.]+\/min)? \(([^)]*)\)/g)];
  if (parts.length > 0) {
    // OUTPUT: the highest listed price. A call that produces images or audio is
    // billed at that rate, and an estimate must never assume the cheap case.
    if (opts.conservativeMax) {
      const max = Math.max(...parts.map((p) => Number(p[1])));
      return ok(max) ? { kind: 'windows', windows: [{ from: null, until: null, price: max }] } : null;
    }
    const text = parts.find((p) => /\btext\b/i.test(p[2]));
    if (text && ok(Number(text[1]))) return { kind: 'windows', windows: [{ from: null, until: null, price: Number(text[1]) }] };
  }
  return null;
}

export function parseGeminiPricingMarkdown(md: string, sourceUrl: string): { records: PriceRecord[]; sectionsByName: Record<string, string[]> } {
  const records: PriceRecord[] = [];
  const sectionsByName: Record<string, string[]> = {};
  const sections = md.split(/\n(?=## )/);
  for (const section of sections) {
    const heading = /^## (.+)$/m.exec(section)?.[1]?.trim();
    if (!heading) continue;
    const idLine = section.split('\n').find((l) => /^\*\[`[a-z0-9.\-]+`\]/.test(l.trim()));
    if (!idLine) continue;
    const ids = [...idLine.matchAll(/\[`([a-z0-9.\-]+)`\]/g)].map((x) => x[1]);
    sectionsByName[heading] = ids;
    const std = section.split(/\n(?=### )/).find((s) => /^### Standard\s*$/m.test(s));
    if (!std) continue;
    let input: CellPrice | null = null; let output: CellPrice | null = null; let cached: CellPrice | null = null;
    for (const line of std.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const cells = splitRow(line);
      const label = (cells[0] || '').toLowerCase();
      const paid = cells[2] ?? '';
      if (label === 'input price') input = parseGeminiCell(paid);
      else if (label.startsWith('output price')) output = parseGeminiCell(paid, { conservativeMax: true });
      else if (label === 'context caching price') cached = parseGeminiCell(paid, { allowTrailing: true });
    }
    if (!input || !output) continue; // not a per-token text model we can price: stays unknown
    const rec = toRecord(input, output, cached);
    if (!rec) continue;
    for (const id of ids) {
      records.push({ provider: 'gemini', modelId: id, unit: 'tokens', currency: 'USD', ...rec, derivedFrom: null, sourceUrl, notes: [] });
    }
  }
  return { records, sectionsByName };
}

function toRecord(input: CellPrice, output: CellPrice, cached: CellPrice | null): Pick<PriceRecord, 'windows' | 'longContext'> | null {
  if (input.kind === 'tiers' || output.kind === 'tiers') {
    if (input.kind !== 'tiers' || output.kind !== 'tiers' || input.thresholdTokens !== output.thresholdTokens) return null;
    const c = cached && cached.kind === 'windows' && cached.windows.length === 1 ? cached.windows[0].price : null;
    return {
      windows: [{ from: null, until: null, rates: { input: input.short, output: output.short, cachedInput: c } }],
      longContext: { thresholdTokens: input.thresholdTokens, windows: [{ from: null, until: null, rates: { input: input.long, output: output.long, cachedInput: null } }] },
    };
  }
  // Date windows must line up between input and output, or the record is ambiguous.
  const bounds = (w: CellPrice & { kind: 'windows' }) => w.windows.map((x) => `${x.from}|${x.until}`).join(',');
  if (bounds(input) !== bounds(output)) return null;
  const cachedAt = (i: number) => {
    if (!cached || cached.kind !== 'windows') return null;
    if (cached.windows.length === input.windows.length && bounds(cached) === bounds(input)) return cached.windows[i].price;
    return cached.windows.length === 1 ? cached.windows[0].price : null;
  };
  return {
    windows: input.windows.map((w, i) => ({ from: w.from, until: w.until, rates: { input: w.price, output: (output as any).windows[i].price, cachedInput: cachedAt(i) } })),
    longContext: null,
  };
}

/** "…built with Gemini 3.8 Flash…" → "Gemini 3.8 Flash". */
export function parseAntigravityUnderlyingModel(agentMd: string): string | null {
  const m = /built with (Gemini [0-9.]+(?: [A-Z][A-Za-z\-]*)+?)(?=[.,]| and| uses)/.exec(agentMd);
  return m ? m[1].trim() : null;
}

/** The price windows in force at `at` (ISO), or null. */
export function ratesAt(windows: PriceWindow[], at: string): RateSet | null {
  const day = at.slice(0, 10);
  const w = windows.find((x) => (!x.from || x.from <= day) && (!x.until || day <= x.until));
  return w ? w.rates : null;
}
