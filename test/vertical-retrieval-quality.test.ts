import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const TEST_DB = path.join(os.tmpdir(), `synthos-retr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB;

import { bestPassage } from '../lib/conversation/engine';

// ---------------------------------------------------------------------------
// DAYS 4-5 — two retrieval defects found by running real verticals.
//
// Neither was a fabrication bug: in every failing case the assistant quoted
// REAL published material. Both were relevance bugs, which are their own kind
// of dishonesty — a confidently irrelevant passage reads as an answer.
// ---------------------------------------------------------------------------

const RANGE_DOC = `# Our range

We stock six models.

| Model | Construction | Firmness | Typically suits |
|---|---|---|---|
| Bellamy Foam | Gel-infused memory foam | Medium | Back sleepers who like close contouring |
| Carrow Hybrid | Pocket springs with foam comfort layer | Medium-firm | The most common recommendation for lower back pain |
| Ashgrove Latex | Natural latex over a spring base | Medium-firm | Customers who sleep hot and dislike the sinking feeling of foam |

All six are available in single, double, king and super king.`;

describe('a markdown table does not collapse into one undifferentiated passage', () => {
  it('splits into ROWS, so a row can be selected on its own merits', () => {
    // The defect: `.replace(/\s+/g, ' ')` ran before sentence splitting, and a
    // table has no sentence punctuation — so the entire catalogue became one
    // giant "sentence" that matched almost any product question and, being a
    // single unit, always won. The mattress vertical answered three unrelated
    // questions with the identical table dump.
    //
    // Rows still accumulate to fill the passage budget once the best one is
    // chosen — that is the pre-existing "a quote should read as prose" rule and
    // is deliberately left alone; on the real 6-row catalogue it surfaced the
    // two relevant models together, which is a better answer than one row.
    // What matters here is that a row is now an independently selectable unit.
    const p = bestPassage(RANGE_DOC, 'lower back pain recommendation');
    expect(p).not.toBeNull();
    expect(p!.text).toContain('Carrow Hybrid');
    expect(p!.text).toContain('lower back pain');
  });

  it('a narrow question that matches nothing in the table still refuses', () => {
    // Proof the table is no longer a catch-all: a term absent from every row
    // must not be answered from it.
    expect(bestPassage(RANGE_DOC, 'what is your warranty claims procedure?')).toBeNull();
  });

  it('drops the header and separator rows, which answer nothing', () => {
    // Visible in real output before this: every table answer opened with
    // "Model | Construction | Firmness | Typically suits".
    const p = bestPassage(RANGE_DOC, 'lower back pain recommendation');
    expect(p).not.toBeNull();
    expect(p!.text).not.toMatch(/\|\s*-{3,}/);
    expect(p!.text).not.toMatch(/Model \| Construction \| Firmness/);
  });

  it('still reads prose documents as prose', () => {
    const prose = 'Delivery is free within 25 miles of the showroom. Deliveries run Tuesday to Saturday. Old mattress removal is included at no extra charge.';
    const p = bestPassage(prose, 'do you remove my old mattress?');
    expect(p!.text).toContain('removal is included');
  });
});

describe('a lone match on a corpus-ubiquitous term is not evidence', () => {
  // ubiquitousTerms() reads a workspace corpus from the database; the rule it
  // feeds is exercised directly here by passing the set bestPassage accepts.
  const PRIVACY_DOC = 'We do not ask for Social Security numbers or account numbers before you have met an attorney. If a caller asks for those in our name, please telephone the office before responding.';

  it('refuses when the only match is a term that appears throughout the corpus', () => {
    // The real failure: "Which attorney would be assigned to me?" matched
    // "attorney" — a word in every document a law firm publishes — and returned
    // a privacy disclaimer as though it were an answer.
    const ubiquitous = new Set(['attorney', 'estate', 'consultation']);
    expect(bestPassage(PRIVACY_DOC, 'which attorney would be assigned to me?', 700, ubiquitous)).toBeNull();
  });

  it('still answers when the match is on a genuinely distinguishing term', () => {
    const ubiquitous = new Set(['attorney', 'estate', 'consultation']);
    const p = bestPassage(PRIVACY_DOC, 'do you ask for my social security number?', 700, ubiquitous);
    expect(p).not.toBeNull();
    expect(p!.text).toContain('Social Security');
  });

  it('two matching concepts are still enough — the rule governs LONE matches only', () => {
    const ubiquitous = new Set(['attorney']);
    const p = bestPassage(PRIVACY_DOC, 'does the attorney need my account numbers?', 700, ubiquitous);
    expect(p, 'attorney + account is two concepts, so specificity is not in question').not.toBeNull();
  });

  it('behaves exactly as before when no ubiquity set is supplied', () => {
    // Every existing caller and the small-corpus case (<3 documents) pass
    // nothing, and must be unaffected.
    const p = bestPassage(PRIVACY_DOC, 'which attorney would be assigned to me?');
    expect(p).not.toBeNull();
  });

  it('the short-common-word rule still applies independently', () => {
    const doc = 'Our team will work with you throughout the area we serve.';
    // "work" is short and common — a lone match on it was already refused, and
    // still is, with or without a ubiquity set.
    expect(bestPassage(doc, 'do you work?', 700, new Set())).toBeNull();
  });
});
