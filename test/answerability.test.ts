import { describe, it, expect } from 'vitest';
import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
isolateVaultForTest('answerability');
import { questionFocus, isAnswerable, splitRequest } from '../lib/conversation/answerability';

// ---------------------------------------------------------------------------
// Attribute-level answerability.
//
//   entity relevance != answerability
//
// Every case below is run through the SAME functions with no vertical
// branching. The attorney and mattress fixtures are different data, not
// different code paths — that is the property under test as much as the
// verdicts are.
// ---------------------------------------------------------------------------

// --- fixtures: real passages from the two vertical knowledge packs ----------

const CARROW_ROW =
  'Carrow Hybrid | Pocket springs with foam comfort layer | Medium-firm | The most common recommendation for lower back pain';
const COOLING_DOC =
  'Traditional memory foam holds heat because it is dense. The Carrow Hybrid uses a cooling cover material and a pocket-spring core, so air moves through the spring unit and it runs noticeably cooler than solid foam.';
const DELIVERY_DOC =
  'Delivery is free within 25 miles of the Northfield showroom. Deliveries run Tuesday to Saturday. Old mattress removal is included at no extra charge when we deliver a new one.';
const FIRM_ADDRESS_DOC =
  'Harrow & Vance Estate Law, 218 Cranmer Street, Suite 4, Ashfield. Consultations are held in person at our Cranmer Street office, or by video call if travelling is difficult.';
const DOCUMENTS_DOC =
  'Bring whatever you can find. Nothing on this list is required in order to meet with us. The death certificate, or a copy. The original will if you can locate it, along with any codicils. We do not ask for copies of documents before you have met an attorney.';
const CONSULT_FEE_DOC =
  'Every new matter starts with a 45-minute initial consultation. The consultation fee is $150, payable at the appointment, and is credited against your first invoice.';
const ATTORNEY_BIO_DOC =
  'Our three attorneys handle estate planning and probate. We do not handle litigation of any kind, criminal matters, family law, divorce, personal injury, immigration or employment.';

// Ubiquity sets, as the engine derives them from each corpus.
const MATTRESS_UBIQ = new Set(['mattress', 'sleep', 'sleeping', 'showroom']);
const ATTORNEY_UBIQ = new Set(['attorney', 'attorneys', 'estate', 'consultation', 'firm', 'matter']);

// The engine's own synonym map is used, so the test exercises ONE vocabulary
// rather than a parallel one that could drift from production behaviour.
import { SYNONYMS_FOR_TEST } from '../lib/conversation/engine';

const verdict = (q: string, evidence: string, ubiquitous: Set<string>) =>
  isAnswerable(questionFocus(q), evidence, {
    ubiquitous,
    synonymsOf: (t) => SYNONYMS_FOR_TEST[t] || [],
  });

// --- the required example matrix -------------------------------------------

describe('MATTRESS — entity known, attribute known', () => {
  it('answers a published property', () => {
    const v = verdict('Does the Carrow Hybrid sleep cool?', COOLING_DOC, MATTRESS_UBIQ);
    expect(v.answerable).toBe(true);
  });

  it('answers a paraphrased version of the same question', () => {
    expect(verdict('will the carrow hybrid keep me cooler at night?', COOLING_DOC, MATTRESS_UBIQ).answerable).toBe(true);
  });
});

describe('MATTRESS — entity known, attribute absent', () => {
  it('refuses a price the business has not published', () => {
    const v = verdict('How much is the Carrow Hybrid?', CARROW_ROW, MATTRESS_UBIQ);
    expect(v.answerable).toBe(false);
    expect(v.unsupported).toContain('price');
  });

  it('refuses a price even when a rich product description is available', () => {
    // The exact failure from the vertical proof: a good description is not a price.
    expect(verdict('How much is the Carrow Hybrid?', COOLING_DOC, MATTRESS_UBIQ).answerable).toBe(false);
  });

  it('refuses stock the business does not track', () => {
    const v = verdict('Is the Carrow Hybrid in stock?', CARROW_ROW, MATTRESS_UBIQ);
    expect(v.answerable).toBe(false);
    expect(v.unsupported).toContain('availability');
  });

  it('refuses "do you have it" phrasing too', () => {
    expect(verdict('Do you have the Ashgrove Latex?', CARROW_ROW, MATTRESS_UBIQ).answerable).toBe(false);
  });

  it('refuses a discount question', () => {
    expect(verdict('Are you running any discounts this month?', DELIVERY_DOC, MATTRESS_UBIQ).answerable).toBe(false);
  });
});

describe('MATTRESS — policy questions still answer', () => {
  it('answers a delivery-day question from a stated range', () => {
    // The absence of Monday IS the answer, because the evidence constrains the
    // whole weekday class.
    const v = verdict('Can you deliver on Monday?', DELIVERY_DOC, MATTRESS_UBIQ);
    expect(v.answerable).toBe(true);
  });

  it('answers the removal policy', () => {
    expect(verdict('Do you take away my old mattress?', DELIVERY_DOC, MATTRESS_UBIQ).answerable).toBe(true);
  });

  it('a stated "no charge" counts as a price answer', () => {
    // "Free" is a figure. Refusing here would be over-conservative.
    expect(verdict('How much does removal cost?', DELIVERY_DOC, MATTRESS_UBIQ).answerable).toBe(true);
  });
});

describe('ATTORNEY — the same code, different data', () => {
  it('answers the bereavement question — background is not part of the request', () => {
    // The flagship demo. "My father passed away" is context; no firm publishes
    // anything about anyone's father, and nobody was asking about one.
    const v = verdict(
      'My father passed away and I need to understand what documents I should bring.',
      DOCUMENTS_DOC, ATTORNEY_UBIQ,
    );
    expect(v.answerable).toBe(true);
  });

  it('refuses parking rather than returning the address', () => {
    const v = verdict('Is there parking at your office?', FIRM_ADDRESS_DOC, ATTORNEY_UBIQ);
    expect(v.answerable).toBe(false);
    expect(v.unsupported).toContain('parking');
  });

  it('refuses attorney assignment rather than returning a generic attorney document', () => {
    const v = verdict('Which attorney would handle my case?', ATTORNEY_BIO_DOC, ATTORNEY_UBIQ);
    expect(v.answerable).toBe(false);
  });

  it('answers the consultation fee, which IS published', () => {
    // Symmetry check: the quantity rule must not refuse a real published figure.
    expect(verdict('What does a consultation cost?', CONSULT_FEE_DOC, ATTORNEY_UBIQ).answerable).toBe(true);
  });

  it('refuses a probate fee, which is not published, despite a fee document existing', () => {
    expect(verdict('How much do you charge for a full probate?', ATTORNEY_BIO_DOC, ATTORNEY_UBIQ).answerable).toBe(false);
  });
});

describe('negative facts — an explicit "we do not" is a real answer', () => {
  it('answers what the firm does not handle', () => {
    const v = verdict('Do you handle divorce cases?', ATTORNEY_BIO_DOC, ATTORNEY_UBIQ);
    expect(v.answerable).toBe(true);
  });

  it('answers a stated removal exclusion', () => {
    const doc = 'We cannot remove a mattress that is wet, soiled or infested.';
    expect(verdict('Will you take a soiled mattress?', doc, MATTRESS_UBIQ).answerable).toBe(true);
  });
});

describe('several documents naming the entity but not the property', () => {
  it('refuses when every candidate mentions the product and none states the attribute', () => {
    for (const doc of [CARROW_ROW, COOLING_DOC, DELIVERY_DOC]) {
      expect(verdict('How much is the Carrow Hybrid?', doc, MATTRESS_UBIQ).answerable).toBe(false);
    }
  });
});

describe('no matching entity at all', () => {
  it('refuses a subject the business has never written about', () => {
    expect(verdict('Do you sell garden furniture?', CARROW_ROW, MATTRESS_UBIQ).answerable).toBe(false);
  });
});

describe('focus extraction itself', () => {
  it('separates background from the request clause', () => {
    const { context, request } = splitRequest('My father passed away and I need to understand what documents I should bring.');
    expect(context).toContain('father');
    expect(request).toContain('documents');
    expect(request).not.toContain('father');
  });

  it('identifies a quantity interrogative that survives stopword removal', () => {
    // "how" and "much" are both stopwords in the retrieval pipeline, which is
    // exactly why this had to be extracted separately.
    expect(questionFocus('How much is the Carrow Hybrid?').kind).toBe('QUANTITY');
    expect(questionFocus('What is the price?').kind).toBe('QUANTITY');
    expect(questionFocus('How many do you have?').kind).toBe('QUANTITY');
  });

  it('identifies availability interrogatives', () => {
    expect(questionFocus('Is it in stock?').kind).toBe('AVAILABILITY');
    expect(questionFocus('Is that available?').kind).toBe('AVAILABILITY');
  });

  it('falls back to predicate terms otherwise', () => {
    const f = questionFocus('Is there parking at your office?');
    expect(f.kind).toBe('PREDICATE');
    expect(f.required).toContain('parking');
  });

  it('carries a reason for every verdict, never a bare boolean', () => {
    expect(questionFocus('How much is it?').reason).toMatch(/quantity/);
    expect(verdict('Is there parking?', FIRM_ADDRESS_DOC, ATTORNEY_UBIQ).reason).toBeTruthy();
  });
});

describe('vertical neutrality', () => {
  it('the same question shape is decided identically for both businesses', () => {
    // A price question refuses against a description-only passage, whichever
    // business it is. No branch anywhere knows what industry this is.
    const mattress = verdict('How much is the Carrow Hybrid?', COOLING_DOC, MATTRESS_UBIQ);
    const attorney = verdict('How much is a full probate?', ATTORNEY_BIO_DOC, ATTORNEY_UBIQ);
    expect(mattress.answerable).toBe(attorney.answerable);
    expect(mattress.answerable).toBe(false);
  });

  it('and a published figure answers for both', () => {
    expect(verdict('What does it cost?', CONSULT_FEE_DOC, ATTORNEY_UBIQ).answerable).toBe(true);
    expect(verdict('What does removal cost?', DELIVERY_DOC, MATTRESS_UBIQ).answerable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rules added after rerunning the two verticals end-to-end. Each one exists
// because the first implementation was WRONG in a way only a live run showed:
// it refused questions both businesses answer in full. False refusal is safer
// than fabrication, but it is still a failure.
// ---------------------------------------------------------------------------

describe('selection is about ALLOCATION, not recommendation', () => {
  const RANGE = 'Carrow Hybrid Zoned | Zoned pocket springs | Medium-firm | Side sleepers with lower back pain';
  const BIO = 'Our three attorneys handle estate planning and probate.';

  it('"which X would be assigned to me" needs an assignment rule', () => {
    expect(verdict('Which attorney would be assigned to me?', BIO, ATTORNEY_UBIQ).answerable).toBe(false);
  });

  it('"who will be handling my case" needs an assignment rule', () => {
    expect(verdict('Who will be handling my case?', BIO, ATTORNEY_UBIQ).answerable).toBe(false);
  });

  it('"which X is best for Y" is a RECOMMENDATION and a catalogue answers it', () => {
    // A first version matched any "which X" and refused this against a table
    // that answers it directly.
    expect(verdict('Which mattress is best for side sleepers?', RANGE, MATTRESS_UBIQ).answerable).toBe(true);
  });

  it('an explicit assignment rule makes the allocation question answerable', () => {
    const doc = 'Your attorney is assigned at intake, depending on which practice area your matter falls under.';
    expect(verdict('Which attorney would be assigned to me?', doc, ATTORNEY_UBIQ).answerable).toBe(true);
  });
});

describe('framing nouns are not the subject of the question', () => {
  const COOLING = 'Natural latex is open-celled so it breathes well, while traditional memory foam holds heat.';

  it('"what is the difference between A and B" is about A and B', () => {
    expect(verdict('What is the difference between latex and memory foam?', COOLING, MATTRESS_UBIQ).answerable).toBe(true);
  });

  it('"how does X work" is about X', () => {
    const doc = 'Every new matter starts with a 45-minute initial consultation with one of our three attorneys.';
    expect(verdict('How does a consultation work?', doc, ATTORNEY_UBIQ).answerable).toBe(true);
  });

  it('"what happens at X" is about X', () => {
    const doc = 'You will leave the first meeting with a written summary of the options available to you.';
    expect(verdict('What happens at the first meeting?', doc, ATTORNEY_UBIQ).answerable).toBe(true);
  });

  it('but a real content word spelled like a frame still counts', () => {
    // "work" is a framing verb in "how does it work" and a content word in
    // "do you work weekends" — the other terms carry the question either way.
    const doc = 'We are open Monday to Thursday, and closed at weekends.';
    expect(verdict('Do you work weekends?', doc, ATTORNEY_UBIQ).answerable).toBe(true);
  });
});

describe('availability evidence must be about inventory, not about sizes', () => {
  it('a size list does not answer a stock question', () => {
    // Real failure: "all six are available in single, double, king and super
    // king" satisfied an availability check and answered "is it in stock?"
    // with a list of bed sizes.
    const sizes = 'All six are available in single, double, king and super king.';
    expect(verdict('Is the Carrow Hybrid in stock?', sizes, MATTRESS_UBIQ).answerable).toBe(false);
  });

  it('a real inventory statement does answer it', () => {
    expect(verdict('Is the Carrow Hybrid in stock?', 'The Carrow Hybrid is currently in stock.', MATTRESS_UBIQ).answerable).toBe(true);
  });
});

describe('a price must be a price FOR THE THING ASKED ABOUT', () => {
  it('a delivery charge does not answer a product price question', () => {
    // Real failure: "delivery is free within 25 miles" satisfied the money
    // check and answered "how much is the Carrow Hybrid?".
    const delivery = 'Delivery is free within 25 miles of the showroom. Old mattress removal is included at no extra charge.';
    expect(verdict('How much is the Carrow Hybrid?', delivery, MATTRESS_UBIQ).answerable).toBe(false);
  });

  it('but it does answer a question about delivery cost', () => {
    const delivery = 'Delivery is free within 25 miles of the showroom. Old mattress removal is included at no extra charge.';
    expect(verdict('How much does delivery cost?', delivery, MATTRESS_UBIQ).answerable).toBe(true);
  });
});

describe('a leading conditional clause is context, not the request', () => {
  it('takes the head from the interrogative clause after the comma', () => {
    // Caught by an existing objection test, not by inspection: the head became
    // "fails" and refused a document stating the guarantee outright.
    const doc = 'Every engagement carries a written guarantee: if the work does not meet the agreed specification we redo it at no charge.';
    expect(verdict('what if the work fails, is there any guarantee?', doc, new Set()).answerable).toBe(true);
  });

  it('splits on the interrogative, not on any comma', () => {
    const { request } = splitRequest('what if the work fails, is there any guarantee?');
    expect(request.trim().startsWith('is there')).toBe(true);
  });

  it('leaves a comma with no following interrogative alone', () => {
    const { context, request } = splitRequest('Can you deliver on Monday, please?');
    expect(context).toBe('');
    expect(request).toContain('deliver');
  });
});
