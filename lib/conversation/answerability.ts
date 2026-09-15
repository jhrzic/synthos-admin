// ---------------------------------------------------------------------------
// SYNTHOS — answerability: does this evidence answer THIS question?
//
// THE DISTINCTION THIS MODULE EXISTS FOR
//
//   entity relevance  !=  answerability
//
// Retrieval is good at finding the right subject. It is blind to whether the
// material it found says anything about the PROPERTY that was asked for. The
// attorney and mattress vertical proofs exposed this precisely:
//
//   "How much is the Carrow Hybrid?"   -> returned the product description
//   "Is the Carrow Hybrid in stock?"   -> returned the product description
//   "Is there parking at your office?" -> returned the firm's privacy policy
//
// Every one of those quotes was real published material. Nothing was invented,
// and the safety property was never in question. But returning relevant
// material that does not contain the requested attribute reads as an answer,
// and that is its own kind of dishonesty.
//
// WHY THE OLD PIPELINE COULD NOT CATCH IT
//
// `how` and `much` are stopwords, so `queryTerms("How much is the Carrow
// Hybrid?")` returns exactly `["carrow", "hybrid"]`. By the time relevance was
// computed, the question was literally indistinguishable from naming the
// product. The price was never part of the query at all, so no amount of
// scoring could have noticed it was missing. Focus has to be extracted BEFORE
// stopword removal — which is what this module does.
//
// VERTICAL NEUTRALITY — the constraint that shaped the design
//
// There are no product names here, no business types, no catalogues of
// attributes per industry. What IS encoded is language: "how much" asks for a
// quantity in English regardless of who is being asked, exactly as "what" and
// "which" are interrogatives regardless of domain. The same code decides
// answerability for a law firm and a mattress shop, and both verticals are
// asserted against it.
//
// DETERMINISTIC BY NECESSITY AND BY CHOICE
//
// No model call. A deployment with no provider key must still refuse correctly
// — refusal is a safety property and cannot depend on a credential being
// present, or on anyone's balance.
// ---------------------------------------------------------------------------

/** What kind of thing the question is asking for. */
export type FocusKind =
  | 'QUANTITY'      // how much / how many / what does it cost
  | 'AVAILABILITY'  // in stock / available / do you have
  | 'SELECTION'     // which/who X — asks the business to pick a particular X
  | 'PREDICATE'     // anything else: the property asked about the subject
  | 'NONE';         // no interrogative focus could be identified

export interface QuestionFocus {
  kind: FocusKind;
  /**
   * Terms that MUST be supported by the evidence for it to count as an answer.
   * Empty for QUANTITY/AVAILABILITY, whose support test is structural.
   */
  required: string[];
  /** Terms that merely situate the question. Need not be covered. */
  context: string[];
  /** Why this focus was chosen — carried into logs and tests, never guessed at. */
  reason: string;
}

/**
 * Words that carry no focus. Deliberately a LANGUAGE list, not a domain list:
 * auxiliaries, determiners, pronouns, and the interrogatives themselves.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their', 'its', 'his', 'her',
  'i', 'me', 'we', 'us', 'you', 'they', 'them', 'it', 'he', 'she',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because',
  'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'about', 'into', 'over', 'under',
  'there', 'here', 'any', 'some', 'all', 'both', 'each', 'more', 'most', 'very', 'just', 'also',
  'please', 'thanks', 'thank', 'hi', 'hello', 'like', 'want', 'need', 'get', 'got', 'go', 'going',
  'me', 'up', 'out', 'now', 'still', 'yet', 'really', 'actually', 'much', 'many',
]);

/**
 * Clauses that merely set the scene. A question frequently opens with
 * background ("My father passed away and...") before asking for anything, and
 * treating that background as part of the request would refuse a question the
 * knowledge base plainly answers — the exact wrong outcome.
 */
const BACKGROUND_MARKERS = /\b(?:and|but|so)\s+(?:i|we)\s+(?:need|want|would like|am looking|was wondering|wondered)\b/i;

/**
 * Verbs that frame a request without being its subject. "I need to UNDERSTAND
 * what documents to bring" is a question about documents, not about
 * understanding. Left in, they become the head term and refuse everything.
 */
export const FRAMING_VERBS = new Set([
  'understand', 'know', 'find', 'finding', 'tell', 'explain', 'clarify', 'confirm',
  'check', 'ask', 'asking', 'wondering', 'wonder', 'see', 'learn', 'help',
  // Light/process verbs. English asks "what HAPPENS at the meeting" or "how
  // does it WORK" to request a description of the noun, not of the verb.
  // Leaving them in makes the verb the apparent subject and refuses questions
  // the business answers in full — observed on "What happens at the first
  // meeting?" against a document describing exactly that.
  'happen', 'happens', 'happening', 'involve', 'involves', 'involved',
  'entail', 'entails', 'mean', 'means', 'work', 'works', 'working',
  'expect', 'expects', 'looking', 'look', 'sort', 'deal', 'deals',
  // Comparison and choice framing. "What is the DIFFERENCE between latex and
  // memory foam" is a question about latex and foam; "which is BEST for side
  // sleepers" is a question about side sleepers. Treating the framing noun as
  // the subject refused both against documents that answer them directly.
  'difference', 'differences', 'different', 'compare', 'comparison', 'versus',
  'between', 'better', 'best', 'worst', 'option', 'options', 'choice', 'choices',
  'recommend', 'recommends', 'recommendation', 'suggest', 'suggestion',
]);

/**
 * "Which X" / "who X" asks the business to SELECT a particular one. Evidence
 * that merely describes the category does not answer it: a page saying "our
 * three attorneys handle estate planning" does not tell you which attorney you
 * get. Answering needs a stated selection or assignment rule, or a specific
 * named instance.
 */
const SELECTION_PATTERNS: RegExp[] = [
  // Narrowed deliberately. A first version matched any "which X", which swept
  // in "Which mattress is best for side sleepers?" — a RECOMMENDATION, which a
  // catalogue answers perfectly well. What needs an assignment rule is the
  // business allocating a particular person or resource TO THE ASKER, and that
  // is what these patterns describe.
  /\bassign(?:ed|s|ment)?\b/i,
  /\bwho\s+(?:will|would)\s+(?:be\s+)?(?:handling|handle|dealing|deal|looking after|working on)\b/i,
  /\bwho\s+(?:is|will be)\s+my\b/i,
  /\bwhich\s+\w+\s+(?:will|would|do i|am i)\b[\s\S]*\b(?:my|me|mine|our|us)\b/i,
  /\bwhich\s+(?:one\s+)?of\s+(?:your|the)\s+\w+\s+(?:will|would|do)\b/i,
];

/** Evidence that a selection or assignment rule is actually stated. */
const SELECTION_EVIDENCE: RegExp[] = [
  /\bassign(?:ed|s|ment)?\b/i,
  /\ballocat(?:ed|es|ion)\b/i,
  /\bwill be (?:handled|seen|met) by\b/i,
  /\byour (?:attorney|adviser|advisor|consultant|rep|representative) (?:is|will be)\b/i,
  /\bdepend(?:s|ing) on\b/i,
  /\bmatched (?:to|with)\b/i,
];

/** Interrogatives that ask for a NUMBER — language-level, not domain-level. */
const QUANTITY_PATTERNS: RegExp[] = [
  /\bhow much\b/i,
  /\bhow many\b/i,
  /\bwhat(?:'s| is| are)?\s+(?:the\s+)?(?:price|cost|fee|fees|rate|rates|charge|charges)\b/i,
  /\b(?:price|pricing|cost|costs|fee|fees|quote|charge|charges)\b/i,
  /\bhow expensive\b/i,
];

/** Interrogatives that ask whether something is OBTAINABLE right now. */
const AVAILABILITY_PATTERNS: RegExp[] = [
  /\bin stock\b/i,
  /\bavailab(?:le|ility)\b/i,
  /\bdo you (?:have|carry|stock)\b/i,
  /\bgot any\b/i,
  /\bany left\b/i,
  /\bsold out\b/i,
];

/**
 * Evidence that a passage actually states a quantity: a currency amount, or an
 * explicit statement about price. A product description that merely mentions
 * the word "cost" in passing will not match the currency form, which is the
 * point — the test is for a stated figure, not for the topic.
 */
const MONEY_EVIDENCE: RegExp[] = [
  /[$£€]\s?\d/,
  /\b\d+(?:[.,]\d+)?\s*(?:dollars|pounds|euros|usd|gbp|eur)\b/i,
  /\b(?:costs?|priced|price is|fee is|charge is|rate is)\s+(?:[$£€]?\s?\d|from\b)/i,
  // "free" ALONE is too loose — "delivery is free within 25 miles" is about
  // delivery, not about what a product costs. The phrase forms below state a
  // price; the bare adjective merely describes something.
  /\bfree of charge\b|\bno extra charge\b|\bat no charge\b|\bincluded at no\b|\bis free\b|\bfree delivery\b/i,
];

/** Evidence that a passage actually states availability. */
const AVAILABILITY_EVIDENCE: RegExp[] = [
  /\bin stock\b/i,
  /\bout of stock\b/i,
  /\bsold out\b/i,
  /\bcurrently (?:available|unavailable|in stock)\b/i,
  /\bawaiting (?:stock|delivery)\b/i,
  /\bback[- ]?order(?:ed)?\b/i,
  // Deliberately NOT a bare /available (in|from)/. A catalogue line reading
  // "all six are available in single, double, king and super king" is about
  // SIZES, and matching it answered "is the Carrow Hybrid in stock?" with a
  // list of bed sizes — a real failure caught by rerunning the vertical.
  // Stock is a claim about inventory at a moment, and only explicit inventory
  // language states it.
];

/**
 * Closed value classes. A question naming ONE member of a class is answerable
 * from evidence naming OTHER members, because the evidence constrains the whole
 * class: "deliveries run Tuesday to Saturday" genuinely answers "can you
 * deliver Monday?" — the absence of Monday IS the answer.
 *
 * Language-level sets only. Nothing here is business-specific.
 */
const VALUE_CLASSES: string[][] = [
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'weekday', 'weekend'],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['morning', 'afternoon', 'evening', 'night', 'midday', 'noon'],
];

/** Words belonging to a price/quantity frame rather than to the thing priced. */
const QUANTITY_FRAME_WORDS = new Set([
  'price', 'prices', 'pricing', 'priced', 'cost', 'costs', 'fee', 'fees', 'rate', 'rates',
  'charge', 'charges', 'quote', 'expensive', 'cheap', 'dollars', 'pounds', 'euros',
]);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !FUNCTION_WORDS.has(w));
}

/**
 * Split background from request.
 *
 * "My father passed away and I need to understand what documents I should
 * bring." — everything before the marker is context, everything after is the
 * actual request. Without this the bereavement question would be refused for
 * lacking evidence about "father", which no firm publishes and which nobody was
 * asking about.
 */
export function splitRequest(question: string): { context: string; request: string } {
  const m = question.match(BACKGROUND_MARKERS);
  if (m && m.index !== undefined) {
    return { context: question.slice(0, m.index), request: question.slice(m.index + m[0].length) };
  }

  // A leading conditional or subordinate clause is context too, and English
  // marks the boundary with a comma before the real interrogative:
  //
  //   "what if the work fails, IS THERE ANY GUARANTEE?"
  //
  // The request is the second clause. Without this the head term became
  // "fails", and the question was refused against a document that states the
  // guarantee outright — caught by an existing objection test, not by
  // inspection.
  const clause = question.match(/^.*?,\s*(?=(?:is|are|was|were|do|does|did|can|could|will|would|should|what|which|who|how|when|where)\b)/i);
  if (clause && clause[0].length < question.length) {
    return { context: clause[0], request: question.slice(clause[0].length) };
  }

  return { context: '', request: question };
}

/**
 * What is this question actually asking for?
 *
 * Order matters: the quantity and availability frames are checked first because
 * their focus is carried by the interrogative itself rather than by a noun, and
 * that focus is invisible once stopwords are removed.
 */
export function questionFocus(question: string): QuestionFocus {
  const { context, request } = splitRequest(question);
  const contextTerms = contentWords(context);

  for (const p of QUANTITY_PATTERNS) {
    if (p.test(request)) {
      return {
        kind: 'QUANTITY',
        // Carried so the support test can check the figure is about the right
        // thing, not merely that a figure exists somewhere in the passage.
        required: contentWords(request).filter((w) => !FRAMING_VERBS.has(w)),
        context: contextTerms,
        reason: `quantity interrogative: ${p.source}`,
      };
    }
  }
  for (const p of AVAILABILITY_PATTERNS) {
    if (p.test(request)) {
      return { kind: 'AVAILABILITY', required: [], context: contextTerms, reason: `availability interrogative: ${p.source}` };
    }
  }

  for (const p of SELECTION_PATTERNS) {
    if (p.test(request)) {
      return {
        kind: 'SELECTION',
        required: contentWords(request).filter((w) => !FRAMING_VERBS.has(w)),
        context: contextTerms,
        reason: `selection interrogative: ${p.source}`,
      };
    }
  }

  // Otherwise the focus is the content of the request clause, minus the verbs
  // that merely frame it. isAnswerable() decides which of these genuinely must
  // be supported, because only it knows what this corpus talks about.
  const required = contentWords(request).filter((w) => !FRAMING_VERBS.has(w));
  if (required.length === 0) {
    return { kind: 'NONE', required: [], context: contextTerms, reason: 'no content terms in the request clause' };
  }
  return { kind: 'PREDICATE', required, context: contextTerms, reason: 'predicate terms of the request clause' };
}

export interface AnswerabilityVerdict {
  answerable: boolean;
  /** The terms that were asked about and are not supported by the evidence. */
  unsupported: string[];
  reason: string;
}

export interface AnswerabilityOptions {
  /**
   * Terms so common in this business's own corpus that they distinguish
   * nothing, and therefore cannot be the thing being asked about.
   */
  ubiquitous?: Set<string>;
  /** Synonym lookup, supplied by the engine so there is one vocabulary. */
  synonymsOf?: (term: string) => string[];
  /** Whole-word/prefix matcher, supplied so matching rules stay identical. */
  matches?: (haystackLower: string, term: string) => boolean;
}

function defaultMatches(haystackLower: string, term: string): boolean {
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(term.length <= 5 ? `\\b${safe}\\b` : `\\b${safe}`, 'i').test(haystackLower);
}

/** True when the evidence names another member of the same closed class. */
function supportsTerm(
  term: string,
  evidenceLower: string,
  matches: (h: string, t: string) => boolean,
  synonymsOf: (t: string) => string[],
): boolean {
  if ([term, ...synonymsOf(term)].some((t) => matches(evidenceLower, t))) return true;
  return classSiblingPresent(term, evidenceLower);
}

function classSiblingPresent(term: string, evidenceLower: string): boolean {
  for (const klass of VALUE_CLASSES) {
    if (!klass.includes(term)) continue;
    return klass.some((sib) => sib !== term && new RegExp(`\\b${sib}\\b`, 'i').test(evidenceLower));
  }
  return false;
}

/**
 * Does this evidence support what was asked?
 *
 * Returns a verdict rather than a boolean so the caller can record WHICH term
 * went unsupported — that is what makes the refusal explainable and what gets
 * captured as the owner's unresolved question.
 */
export function isAnswerable(
  focus: QuestionFocus,
  evidence: string,
  opts: AnswerabilityOptions = {},
): AnswerabilityVerdict {
  const low = String(evidence || '').toLowerCase();
  const matches = opts.matches || defaultMatches;
  const synonymsOf = opts.synonymsOf || (() => []);
  const ubiquitous = opts.ubiquitous || new Set<string>();

  if (focus.kind === 'QUANTITY') {
    if (!MONEY_EVIDENCE.some((p) => p.test(evidence))) {
      return { answerable: false, unsupported: ['price'], reason: 'a price was asked for and the evidence states no figure' };
    }
    // A figure is not enough: it has to be a figure about the thing asked
    // about. "Delivery is free within 25 miles" states a price and answers
    // nothing whatsoever about what a mattress costs — a real failure this
    // check exists to stop.
    const entityTerms = focus.required
      .filter((t) => !ubiquitous.has(t) && !QUANTITY_FRAME_WORDS.has(t));
    if (entityTerms.length > 0 && !entityTerms.some((t) => supportsTerm(t, low, matches, synonymsOf))) {
      return {
        answerable: false,
        unsupported: entityTerms,
        reason: `the evidence states a figure, but not about ${entityTerms.join(', ')}`,
      };
    }
    return { answerable: true, unsupported: [], reason: 'evidence states a figure about the subject asked about' };
  }

  if (focus.kind === 'AVAILABILITY') {
    const stated = AVAILABILITY_EVIDENCE.some((p) => p.test(evidence));
    return stated
      ? { answerable: true, unsupported: [], reason: 'evidence states availability' }
      : { answerable: false, unsupported: ['availability'], reason: 'availability was asked for and the evidence states none' };
  }

  if (focus.kind === 'NONE') {
    // Nothing identifiable was asked for; fall back to the caller's own
    // relevance decision rather than inventing a verdict.
    return { answerable: true, unsupported: [], reason: 'no identifiable focus — deferring to relevance' };
  }

  // A value whose class the evidence already constrains counts as supported:
  // "deliveries run Tuesday to Saturday" genuinely answers "can you deliver
  // Monday?" — the absence of Monday IS the answer.
  const supports = (term: string): boolean => supportsTerm(term, low, matches, synonymsOf);

  if (focus.kind === 'SELECTION') {
    const stated = SELECTION_EVIDENCE.some((p) => p.test(evidence));
    return stated
      ? { answerable: true, unsupported: [], reason: 'evidence states a selection or assignment rule' }
      : {
          answerable: false,
          unsupported: focus.required.filter((t) => !ubiquitous.has(t) && !supports(t)).concat('assignment'),
          reason: 'a specific one was asked for and the evidence states no selection or assignment rule',
        };
  }

  // PREDICATE.
  //
  // The HEAD of the request decides, not a vote across every word in it.
  //
  // A vote was the first attempt and it was wrong in both directions: "Is there
  // parking at your office?" scored 1-1 (office supported, parking not) and so
  // passed, answering a parking question with an address; while a naturally
  // phrased question that happened to use three words the business words
  // differently would be refused despite being plainly answered.
  //
  // In English the thing being asked about comes first in the request clause.
  // Terms after it situate the question. So: the head must be supported, and a
  // term the business writes about constantly cannot be the head — it
  // distinguishes nothing, so it is not what is being asked.
  const candidates = focus.required.filter((t) => !ubiquitous.has(t));
  const unsupported = candidates.filter((t) => !supports(t));

  if (candidates.length === 0) {
    // Everything asked about is ubiquitous in this corpus, so there is no
    // specific claim to check. Defer to the caller's relevance decision.
    return { answerable: true, unsupported: [], reason: 'no distinguishing focus term — deferring to relevance' };
  }

  const head = candidates[0];
  if (!supports(head)) {
    return {
      answerable: false,
      unsupported,
      reason: `the request is about "${head}" and the evidence does not address it`,
    };
  }

  return {
    answerable: true,
    unsupported,
    reason: unsupported.length === 0
      ? 'every focus term is supported by the evidence'
      : `the request's subject "${head}" is supported; ${unsupported.join(', ')} not addressed`,
  };
}
