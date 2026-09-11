// ---------------------------------------------------------------------------
// CONVERSATION AI — the platform capability behind the Business Conversation AI
// product. Deliberately NOT called "hermes chat": Hermes is one possible
// implementation of one step, never the architecture.
//
//   customer channel -> conversation state -> business context retrieval
//   -> capability resolution -> (approved model | grounded extraction)
//   -> Guardian-bounded action -> evidence -> memory / follow-up
//
// THE CENTRAL DESIGN DECISION, AND WHY:
//
// No LLM provider is configured on this install (GEMINI/ANTHROPIC/OPENAI/
// OPENROUTER all absent; the Hermes runtime's own models are credential-
// blocked). A conversation product that needs a model to say anything would
// therefore be undemonstrable and unsellable today.
//
// So the answering step has two real modes, and the mode is always recorded on
// the message rather than inferred:
//
//   GROUNDED_EXTRACTIVE — no model needed. Real passages retrieved from this
//     workspace's own indexed Vault content are returned as the answer, with
//     their sources. Zero hallucination by construction, because nothing is
//     generated. This is what ships today.
//   LLM — an approved model phrases the same retrieved context. Switches on
//     automatically the moment a provider is configured; the retrieval,
//     grounding and refusal rules are identical.
//   NO_KNOWLEDGE — retrieval found nothing relevant, so the assistant says so.
//     It never invents a business fact, price, guarantee or availability.
//
// Everything else in the product — qualification, objection classification,
// handoff, follow-up, summary — is deterministic and needs no model at all.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from '../persistence';
import { searchWorkspaceMemoryScoped, type ScopedMemoryResult } from '../memory-index';

export type Channel = 'WEB' | 'MOBILE_APP' | 'VOICE_CALL' | 'SMS' | 'WHATSAPP';
export type ConversationStatus = 'ACTIVE' | 'HANDOFF_REQUESTED' | 'CLOSED';
export type ResponseMode = 'GROUNDED_EXTRACTIVE' | 'LLM' | 'NO_KNOWLEDGE' | 'DETERMINISTIC';

export interface BusinessProfile {
  profile_id: string;
  workspace_id: string;
  business_name: string;
  assistant_name: string;
  business_description: string | null;
  services: string[];
  locations: string[];
  hours: string | null;
  contact: Record<string, string>;
  brand_voice: string | null;
  greeting: string | null;
  ai_disclosure: string;
  qualification_goals: string[];
  handoff_rules: string | null;
  enabled_capabilities: string[];
  allowed_actions: string[];
  escalation_contacts: string[];
  bot_mode_profile: string | null;
  business_line_id: string | null;
  public_key: string | null;
  published: boolean;
}

export interface ConversationMessage {
  message_id: string;
  role: 'customer' | 'assistant' | 'system';
  content: string;
  response_mode: ResponseMode | null;
  sources: { artifactId: string; title: string; path: string }[];
  created_at: string;
}

/** Structured lead facts. Only business-appropriate slots — no behavioural scoring. */
export interface LeadData {
  name?: string;
  contact?: string;
  contactKind?: 'email' | 'phone';
  interest?: string;
  location?: string;
  timing?: string;
  need?: string;
  questions?: string[];
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const DEFAULT_DISCLOSURE =
  'You are chatting with an AI assistant. It can answer from this business\'s published information and connect you with a person.';

export function getProfile(workspaceId: string): BusinessProfile | null {
  const row = getDatabase()
    .prepare('SELECT * FROM business_assistant_profiles WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(workspaceId) as any;
  if (!row) return null;
  const j = (v: string, d: any) => { try { return JSON.parse(v); } catch { return d; } };
  return {
    profile_id: row.profile_id, workspace_id: row.workspace_id,
    business_name: row.business_name, assistant_name: row.assistant_name,
    business_description: row.business_description,
    services: j(row.services_json, []), locations: j(row.locations_json, []),
    hours: row.hours, contact: j(row.contact_json, {}),
    brand_voice: row.brand_voice, greeting: row.greeting,
    ai_disclosure: row.ai_disclosure || DEFAULT_DISCLOSURE,
    qualification_goals: j(row.qualification_goals_json, []),
    handoff_rules: row.handoff_rules,
    enabled_capabilities: j(row.enabled_capabilities_json, []),
    allowed_actions: j(row.allowed_actions_json, []),
    escalation_contacts: j(row.escalation_contacts_json, []),
    bot_mode_profile: row.bot_mode_profile, business_line_id: row.business_line_id,
    public_key: row.public_key ?? null, published: Boolean(row.published),
  };
}

/**
 * Resolve a published assistant from its public key.
 *
 * This is the ONLY way an anonymous visitor reaches a workspace. The key is
 * 32 random bytes, the lookup is exact, and an unpublished profile resolves to
 * null — so unpublishing genuinely takes the assistant off the air rather than
 * merely hiding a link. The caller never supplies a workspace id.
 */
export function getProfileByPublicKey(publicKey: string): BusinessProfile | null {
  const key = String(publicKey || '');
  if (!/^[a-f0-9]{32,64}$/.test(key)) return null;
  const row = getDatabase()
    .prepare('SELECT workspace_id FROM business_assistant_profiles WHERE public_key = ? AND published = 1')
    .get(key) as { workspace_id?: string } | undefined;
  if (!row?.workspace_id) return null;
  return getProfile(row.workspace_id);
}

/**
 * Publish or unpublish. Publishing mints a key on first use and keeps it
 * stable afterwards, so re-publishing does not break a link a business has
 * already put on its website.
 */
export function setPublished(workspaceId: string, published: boolean): { publicKey: string | null; published: boolean } {
  const existing = getProfile(workspaceId);
  if (!existing) return { publicKey: null, published: false };
  const key = existing.public_key || crypto.randomBytes(24).toString('hex');
  getDatabase()
    .prepare('UPDATE business_assistant_profiles SET public_key = ?, published = ?, updated_at = ? WHERE profile_id = ?')
    .run(key, published ? 1 : 0, new Date().toISOString(), existing.profile_id);
  return { publicKey: key, published };
}

export function saveProfile(p: Partial<BusinessProfile> & { workspace_id: string }): BusinessProfile {
  const existing = getProfile(p.workspace_id);
  const now = new Date().toISOString();
  const id = existing?.profile_id || `bap-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const merged = { ...existing, ...p };
  getDatabase().prepare(`
    INSERT INTO business_assistant_profiles
      (profile_id, workspace_id, business_name, assistant_name, business_description, services_json,
       locations_json, hours, contact_json, brand_voice, greeting, ai_disclosure, qualification_goals_json,
       handoff_rules, memory_permissions, enabled_capabilities_json, allowed_actions_json,
       escalation_contacts_json, voice_profile, bot_mode_profile, business_line_id, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(profile_id) DO UPDATE SET
      business_name=excluded.business_name, assistant_name=excluded.assistant_name,
      business_description=excluded.business_description, services_json=excluded.services_json,
      locations_json=excluded.locations_json, hours=excluded.hours, contact_json=excluded.contact_json,
      brand_voice=excluded.brand_voice, greeting=excluded.greeting, ai_disclosure=excluded.ai_disclosure,
      qualification_goals_json=excluded.qualification_goals_json, handoff_rules=excluded.handoff_rules,
      enabled_capabilities_json=excluded.enabled_capabilities_json,
      allowed_actions_json=excluded.allowed_actions_json,
      escalation_contacts_json=excluded.escalation_contacts_json,
      bot_mode_profile=excluded.bot_mode_profile, business_line_id=excluded.business_line_id,
      updated_at=excluded.updated_at
  `).run(
    id, p.workspace_id, merged.business_name || 'Unnamed Business',
    merged.assistant_name || 'Assistant', merged.business_description ?? null,
    JSON.stringify(merged.services || []), JSON.stringify(merged.locations || []),
    merged.hours ?? null, JSON.stringify(merged.contact || {}),
    merged.brand_voice ?? null, merged.greeting ?? null,
    merged.ai_disclosure || DEFAULT_DISCLOSURE,
    JSON.stringify(merged.qualification_goals || []), merged.handoff_rules ?? null,
    'workspace_only', JSON.stringify(merged.enabled_capabilities || []),
    JSON.stringify(merged.allowed_actions || []), JSON.stringify(merged.escalation_contacts || []),
    null, merged.bot_mode_profile ?? null, merged.business_line_id ?? null,
    existing ? (getDatabase().prepare('SELECT created_at FROM business_assistant_profiles WHERE profile_id=?').get(id) as any)?.created_at || now : now,
    now
  );
  return getProfile(p.workspace_id)!;
}

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------

export function createConversation(params: {
  workspaceId: string; profileId: string; channel: Channel; participantRef?: string;
}): string {
  const id = `conv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO business_conversations
      (conversation_id, workspace_id, profile_id, channel, participant_ref, status, lead_json, created_at, updated_at)
    VALUES (?,?,?,?,?,'ACTIVE','{}',?,?)
  `).run(id, params.workspaceId, params.profileId, params.channel, params.participantRef ?? null, now, now);
  return id;
}

export function getConversation(workspaceId: string, conversationId: string): any | null {
  return getDatabase()
    .prepare('SELECT * FROM business_conversations WHERE conversation_id = ? AND workspace_id = ?')
    .get(conversationId, workspaceId) || null;
}

export function listConversations(workspaceId: string, limit = 100): any[] {
  return getDatabase()
    .prepare('SELECT * FROM business_conversations WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(workspaceId, limit) as any[];
}

export function getMessages(workspaceId: string, conversationId: string): ConversationMessage[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM business_conversation_messages WHERE conversation_id = ? AND workspace_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(conversationId, workspaceId) as any[];
  return rows.map((r) => ({
    message_id: r.message_id, role: r.role, content: r.content,
    response_mode: r.response_mode,
    sources: (() => { try { return JSON.parse(r.sources_json); } catch { return []; } })(),
    created_at: r.created_at,
  }));
}

export function appendMessage(params: {
  workspaceId: string; conversationId: string;
  role: 'customer' | 'assistant' | 'system'; content: string;
  responseMode?: ResponseMode; sources?: { artifactId: string; title: string; path: string }[];
}): ConversationMessage {
  const id = `msg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO business_conversation_messages
      (message_id, conversation_id, workspace_id, role, content, response_mode, sources_json, created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, params.conversationId, params.workspaceId, params.role, params.content,
         params.responseMode ?? null, JSON.stringify(params.sources || []), now);
  getDatabase().prepare('UPDATE business_conversations SET updated_at = ? WHERE conversation_id = ?')
    .run(now, params.conversationId);
  return { message_id: id, role: params.role, content: params.content,
           response_mode: params.responseMode ?? null, sources: params.sources || [], created_at: now };
}

// ---------------------------------------------------------------------------
// Intent classification — deterministic, no model
// ---------------------------------------------------------------------------

export type Intent = 'HANDOFF' | 'OBJECTION' | 'SCHEDULE' | 'CONTACT_DETAILS' | 'QUESTION';

/**
 * Deterministic intent classification. No model, so it is inspectable,
 * testable and identical on every run.
 *
 * The ORDER is the fix for a real defect. "Can someone call me next Tuesday?"
 * previously matched the handoff pattern on "call me" and never reached the
 * scheduling branch — so the customer was never told the one thing that
 * matters most: that nothing can be booked here. An explicit request for a
 * person still wins; a scheduling request that merely mentions a call does not.
 */
const EXPLICIT_HANDOFF = /\b(human|real person|a person|representative|speak to someone|talk to someone|talk to a|speak with|customer service|manager|transfer me|put me through)\b/;
const SCHEDULING = /\b(book|booking|schedule|appointment|reschedule|availability|available|slot|come out|visit|consultation|call me back|get a call|call me)\b/;
const TIME_REFERENCE = /\b(today|tomorrow|tonight|this (week|afternoon|morning|evening)|next (week|month|monday|tuesday|wednesday|thursday|friday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\s?(am|pm))\b/;
const OBJECTION = /\b(too expensive|expensive|pricing|price|cost|afford|discount|cheaper|budget|not sure|unsure|hesitant|why should|compare|competitor|alternative|think about it|worth it|guarantee|risk)\b/;
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|\b\+?\d[\d\s().-]{7,}\d\b/;

/** Does this turn actually name a time? Used to keep a mislabelled answer out of the lead. */
export function mentionsTime(text: string): boolean {
  return TIME_REFERENCE.test(text.toLowerCase());
}

export function classifyIntent(text: string): Intent {
  const t = text.toLowerCase();
  const scheduling = SCHEDULING.test(t);

  // A scheduling request wins over handoff when the customer named a time —
  // that is a booking attempt, and it must reach the branch that says so.
  if (scheduling && TIME_REFERENCE.test(t)) return 'SCHEDULE';
  if (EXPLICIT_HANDOFF.test(t)) return 'HANDOFF';
  if (scheduling) return 'SCHEDULE';
  if (OBJECTION.test(t)) return 'OBJECTION';
  // Contact details are only the intent when the turn is essentially just
  // that — an address inside a long question is a detail, not the point.
  if (CONTACT.test(text) && text.length < 160) return 'CONTACT_DETAILS';
  return 'QUESTION';
}

/** Extract lead facts from a turn. Only explicit, present facts — never guessed. */
export function extractLead(text: string, existing: LeadData): LeadData {
  const out: LeadData = { ...existing };
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const phone = text.match(/\b(\+?\d[\d\s().-]{7,}\d)\b/);
  if (email && !out.contact) { out.contact = email[0]; out.contactKind = 'email'; }
  else if (phone && !out.contact) { out.contact = phone[0].trim(); out.contactKind = 'phone'; }
  const name = text.match(/\b(?:my name is|i'?m|this is)\s+([A-Z][a-zA-Z]{1,20}(?:\s+[A-Z][a-zA-Z]{1,20})?)/);
  if (name && !out.name) out.name = name[1];
  const timing = text.match(/\b(today|tomorrow|this week|next week|this month|asap|urgent|monday|tuesday|wednesday|thursday|friday)\b/i);
  if (timing && !out.timing) out.timing = timing[1];
  return out;
}

export function updateLead(workspaceId: string, conversationId: string, lead: LeadData): void {
  getDatabase()
    .prepare('UPDATE business_conversations SET lead_json = ?, updated_at = ? WHERE conversation_id = ? AND workspace_id = ?')
    .run(JSON.stringify(lead), new Date().toISOString(), conversationId, workspaceId);
}

export function setStatus(workspaceId: string, conversationId: string, status: ConversationStatus): void {
  getDatabase()
    .prepare('UPDATE business_conversations SET status = ?, updated_at = ? WHERE conversation_id = ? AND workspace_id = ?')
    .run(status, new Date().toISOString(), conversationId, workspaceId);
}

// ---------------------------------------------------------------------------
// Business knowledge retrieval — workspace-scoped, no cross-tenant reach
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['what','which','where','when','who','how','does','do','did','are','is','the','a','an','and','or','of','to','for','in','on','with','your','you','my','me','i','we','can','could','would','should','have','has','it','this','that','about','tell','please','thanks','hi','hello','there','their','our','us','be','been','was','were','get','got','make','just','really','actually','any','all','some','more','most','very','much','also']);

/**
 * The folder a business's published knowledge lives in.
 *
 * This is the single most important line in the file. A customer-facing
 * assistant may quote ONLY what the business has explicitly published into
 * this folder — never the rest of the workspace.
 *
 * Found by running the thing: an assistant searching the whole workspace index
 * answered a visitor by quoting an internal graph-run log and a Jarvis
 * directive, complete with an internal file path. Every document was real, and
 * not one of them was something a business would say to a customer. Real text
 * from the wrong document is still a fabricated answer.
 */
export const BUSINESS_KNOWLEDGE_FOLDER = 'Business-Knowledge/';

/**
 * Relevance is decided by CONCEPT COVERAGE, not by the search engine's score.
 *
 * The first version gated on bm25 rank. That looked principled and was wrong:
 * bm25 magnitude scales with inverse document frequency, so the same perfect
 * match scored -0.35 against a 36-document corpus and -0.000004 against a
 * one-document corpus. A business with a small knowledge base would have had
 * every answer refused — a quality bug that only surfaces at the size every
 * new customer starts at.
 *
 * Concept coverage does not care how big the corpus is: a passage is relevant
 * when it covers enough of what was asked, which is the thing we actually mean.
 *
 * One concept is enough when it is a SPECIFIC one. "what if the work fails, is
 * there any guarantee?" is a question about exactly one thing wrapped in five
 * words of preamble, and demanding two matches refuses a document that answers
 * it outright. Incidental overlap on a short common word is not enough, which
 * is what the length rule below is for.
 */
const SPECIFIC_TERM_MIN_LENGTH = 5;

/**
 * Vocabulary bridging.
 *
 * A customer asks "how much does it cost"; the business wrote "the diagnostic
 * is priced between…". Both are real, neither shares a word, and a pure
 * keyword search therefore refuses a question the knowledge base plainly
 * answers — which is the wrong kind of honest: a correct refusal caused by a
 * retrieval failure still loses the customer.
 *
 * This is a fixed, inspectable, deterministic map. It only widens WHICH
 * documents are considered and which words count as the same concept; it never
 * changes what is quoted from them, and it cannot manufacture an answer that
 * is not written down somewhere.
 */
const SYNONYMS: Record<string, string[]> = {
  cost: ['price', 'priced', 'pricing', 'fee', 'fees', 'rate', 'rates', 'charge', 'dollars', 'budget'],
  price: ['cost', 'priced', 'pricing', 'fee', 'rate', 'charge', 'dollars'],
  pricing: ['price', 'priced', 'cost', 'fee', 'rate', 'dollars'],
  expensive: ['price', 'priced', 'pricing', 'cost', 'budget'],
  afford: ['price', 'priced', 'pricing', 'cost', 'budget', 'payment'],
  discount: ['price', 'priced', 'pricing', 'cost', 'offer'],
  quote: ['price', 'priced', 'pricing', 'cost', 'estimate'],
  started: ['start', 'begin', 'onboarding', 'engagement', 'first'],
  start: ['begin', 'onboarding', 'engagement', 'started'],
  hours: ['open', 'opening', 'closing', 'times', 'schedule'],
  open: ['hours', 'opening', 'closing', 'times'],
  location: ['located', 'address', 'area', 'based', 'serve'],
  area: ['location', 'located', 'serve', 'region', 'based'],
  guarantee: ['warranty', 'guaranteed', 'refund', 'assurance'],
  warranty: ['guarantee', 'guaranteed', 'refund'],
  timeline: ['duration', 'takes', 'weeks', 'days', 'schedule'],
  work: ['works', 'working', 'process', 'approach', 'method'],
  works: ['work', 'working', 'process', 'approach', 'method'],
  process: ['works', 'work', 'approach', 'method', 'steps'],
  experience: ['years', 'qualified', 'certified', 'credentials', 'expertise'],
  payment: ['pay', 'invoice', 'billing', 'terms', 'deposit'],
  service: ['services', 'offer', 'provide'],
  services: ['service', 'offer', 'provide'],
  replacement: ['replace', 'replacements', 'replacing', 'new'],
  repair: ['repairs', 'repairing', 'fix', 'fixing'],
};

function queryTerms(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOPWORDS.has(w));
}

function expandTerms(terms: string[]): string[] {
  const out = new Set(terms);
  for (const t of terms) for (const syn of SYNONYMS[t] || []) out.add(syn);
  return [...out];
}

/**
 * One concept per thing the customer asked about, carrying its synonyms.
 * "cost" and "priced" are the same concept, so a document mentioning only
 * "priced" still counts as answering a question about cost — once, not twice.
 */
function conceptsOf(query: string): string[][] {
  return queryTerms(query).map((t) => [t, ...(SYNONYMS[t] || [])]);
}

export function retrieveBusinessContext(workspaceId: string, query: string, limit = 4): ScopedMemoryResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  // Rank still orders the candidates; it no longer decides relevance.
  return searchWorkspaceMemoryScoped(workspaceId, expandTerms(terms).join(' '), {
    pathPrefix: BUSINESS_KNOWLEDGE_FOLDER,
    limit,
  });
}

/**
 * Word matching, with one rule that exists because of a real wrong answer:
 * substring matching counted "workspace" as a hit for "work", and that is how
 * an irrelevant document earned a quote in a live run.
 *
 * Short terms must match as whole words. Longer ones may match as a prefix, so
 * "verification" still finds "verifications" and "priced" finds "pricing"
 * without a synonym entry for every inflection.
 */
function hasTerm(haystackLower: string, term: string): boolean {
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = term.length <= 5 ? `\\b${safe}\\b` : `\\b${safe}`;
  return new RegExp(pattern, 'i').test(haystackLower);
}

/**
 * Pick the passage of a real document that actually addresses the question,
 * and say how strongly it does.
 *
 * The first version returned FTS5's 12-token snippet, which produced fragments
 * like "…profiling captures cycle-accurate execution costs…" — technically a
 * quote, useless as an answer. A business answer has to be a whole thought.
 */
export function bestPassage(content: string, query: string, maxChars = 700): { text: string; score: number } | null {
  const concepts = conceptsOf(query);
  if (concepts.length === 0) return null;

  const body = String(content || '')
    .replace(/^#+\s.*$/gm, '')            // headings carry the title, not the answer
    .replace(/^-{3,}[\s\S]*?-{3,}/m, '')  // yaml frontmatter
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter((x) => x.trim().length > 25);
  if (sentences.length === 0) return null;

  const coverage = (text: string) => {
    const low = text.toLowerCase();
    return concepts.reduce((acc, group) => acc + (group.some((t) => hasTerm(low, t)) ? 1 : 0), 0);
  };

  const scores = sentences.map(coverage);
  const best = Math.max(...scores);
  if (best === 0) return null;

  // Take the best sentence plus its neighbours, so the quote reads as prose
  // rather than as a clipping.
  const idx = scores.indexOf(best);
  let out = sentences[idx];
  let lo = idx, hi = idx;
  while (out.length < maxChars) {
    const nextHi = hi + 1 < sentences.length ? sentences[hi + 1] : null;
    const nextLo = lo - 1 >= 0 ? sentences[lo - 1] : null;
    // Prefer continuing forwards — a following sentence usually completes the
    // thought, a preceding one usually introduces it.
    if (nextHi && out.length + nextHi.length + 1 <= maxChars) { out = `${out} ${nextHi}`; hi++; }
    else if (nextLo && out.length + nextLo.length + 1 <= maxChars) { out = `${nextLo} ${out}`; lo--; }
    else break;
  }

  const low = out.toLowerCase();
  const matched = concepts.filter((group) => group.some((t) => hasTerm(low, t)));
  if (matched.length === 0) return null;
  // A lone match must be on a specific word. Overlapping on a short common
  // term ("work", "area", "time") is a coincidence, not an answer.
  if (matched.length === 1 && !matched[0].some((t) => t.length >= SPECIFIC_TERM_MIN_LENGTH && hasTerm(low, t))) {
    return null;
  }
  return { text: out.trim(), score: matched.length };
}

const IDENTITY_PATTERNS = [
  /\bwho are you\b/, /\bwhat do you do\b/, /\bwhat kind of (business|company)\b/,
  /\btell me about (you|yourself|your business|your company|the company)\b/,
  /\babout your (business|company)\b/,
];

function isIdentityQuestion(lowerText: string, businessName: string): boolean {
  if (IDENTITY_PATTERNS.some((re) => re.test(lowerText))) return true;
  const name = businessName.toLowerCase().trim();
  // "what is <business name>" / "what does <business name> do"
  return name.length > 2 && (lowerText.includes(`what is ${name}`) || lowerText.includes(`what does ${name}`));
}

/** Does the profile itself answer this, without touching the knowledge base? */
function answerFromProfile(p: BusinessProfile, text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(service|services|offer|do you do|provide|products?)\b/.test(t) && p.services.length) {
    return `${p.business_name} offers: ${p.services.join(', ')}.`;
  }
  if (/\b(hour|open|closing|closed|when are you)\b/.test(t) && p.hours) {
    return `Our hours are ${p.hours}.`;
  }
  if (/\b(where|location|address|area|near)\b/.test(t) && p.locations.length) {
    return `We operate in: ${p.locations.join(', ')}.`;
  }
  // Deliberately narrow: "how do I contact you", not any sentence containing
  // the word "email". A customer giving their own email address was previously
  // answered with the business's — this is that fix.
  if (/\b(how (can|do) i (contact|reach|call)|contact (you|details)|your (email|phone|number)|get in touch)\b/.test(t) && Object.keys(p.contact).length) {
    return `You can reach us at ${Object.entries(p.contact).map(([k, v]) => `${k}: ${v}`).join(', ')}.`;
  }
  // Identity questions only. "what is" alone was far too loose — it answered
  // "what is your refund policy?" with the company description: a real
  // document answering a question nobody asked, which is still a wrong answer.
  if (isIdentityQuestion(t, p.business_name) && p.business_description) {
    return p.business_description;
  }

  return null;
}

export interface AnswerResult {
  content: string;
  mode: ResponseMode;
  sources: { artifactId: string; title: string; path: string }[];
}

function dontKnow(profile: BusinessProfile, topic?: string): AnswerResult {
  return {
    content:
      `I don't have anything verified about ${topic || 'that'} in ${profile.business_name}'s published information, and I'd rather not guess at it. `
      + `I can put it to a person who can answer properly — leave me an email or phone number, or just say "talk to a human".`,
    mode: 'NO_KNOWLEDGE',
    sources: [],
  };
}

/**
 * Produce the assistant's answer for a question turn.
 *
 * Order is deliberate: the business's own declared profile first (most
 * authoritative, no retrieval needed), then its published knowledge, then an
 * explicit refusal. There is no fourth branch that guesses.
 */
export function answerQuestion(profile: BusinessProfile, workspaceId: string, text: string): AnswerResult {
  const direct = answerFromProfile(profile, text);
  if (direct) return { content: direct, mode: 'GROUNDED_EXTRACTIVE', sources: [] };

  const hits = retrieveBusinessContext(workspaceId, text, 4);
  const scored: { text: string; score: number; hit: ScopedMemoryResult }[] = [];
  for (const h of hits) {
    const p = bestPassage(h.content, text);
    if (p) scored.push({ ...p, hit: h });
  }
  if (scored.length === 0) return dontKnow(profile);

  scored.sort((a, b) => b.score - a.score);
  // A second passage is included only when it is genuinely comparable to the
  // first. Padding a good answer with a weak one made a correct reply look
  // like a document dump, and buried the part that answered the question.
  const keep = [scored[0]];
  if (scored[1] && scored[1].score >= scored[0].score * 0.8 && scored[1].hit.artifact_id !== scored[0].hit.artifact_id) {
    keep.push(scored[1]);
  }

  return {
    content: keep.map((p) => p.text).join('\n\n'),
    mode: 'GROUNDED_EXTRACTIVE',
    sources: keep.map((p) => ({ artifactId: p.hit.artifact_id, title: p.hit.title, path: p.hit.source_path })),
  };
}

/**
 * Objection handling. Grounded or explicitly unknown — it must never invent a
 * price, discount, guarantee or availability claim, and it must not wrap an
 * irrelevant quote in reassuring language, which reads as an answer and is not.
 */
export function handleObjection(profile: BusinessProfile, workspaceId: string, text: string): AnswerResult {
  const t = text.toLowerCase();
  const isPricing = /\b(price|pricing|cost|expensive|afford|quote|rate|discount|cheaper|budget)\b/.test(t);
  const grounded = answerQuestion(profile, workspaceId, text);

  if (grounded.mode === 'NO_KNOWLEDGE') {
    return {
      content: isPricing
        ? `I don't have verified pricing published for that, and I won't quote a figure I can't stand behind. `
          + `The quickest way to a real number is a person — leave me an email or phone number, or say "talk to a human".`
        : `That's a fair thing to weigh up, and I don't have anything verified to say about that specific point. `
          + `Rather than guess, I'd put you in front of someone from ${profile.business_name}. Shall I arrange that?`,
      mode: 'NO_KNOWLEDGE',
      sources: [],
    };
  }
  return {
    content: `That's a fair question.\n\n${grounded.content}`,
    mode: grounded.mode,
    sources: grounded.sources,
  };
}
