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
import { searchWorkspaceMemoryScoped, listWorkspaceMemoryContent, workspaceCorpusFingerprint, type ScopedMemoryResult } from '../memory-index';
import { normalizeOrigin } from './origins';
import { questionFocus, isAnswerable, FRAMING_VERBS } from './answerability';

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
  allowed_origins: string[];
  voice_reference_id: string | null;
  voice_enabled: boolean;
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
    allowed_origins: j(row.allowed_origins_json ?? '[]', []),
    voice_reference_id: row.voice_reference_id ?? null,
    voice_enabled: row.voice_enabled === undefined ? true : Boolean(row.voice_enabled),
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
       escalation_contacts_json, voice_profile, bot_mode_profile, business_line_id,
       voice_reference_id, voice_enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      voice_reference_id=excluded.voice_reference_id, voice_enabled=excluded.voice_enabled,
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
    merged.voice_reference_id ?? null, merged.voice_enabled === false ? 0 : 1,
    existing ? (getDatabase().prepare('SELECT created_at FROM business_assistant_profiles WHERE profile_id=?').get(id) as any)?.created_at || now : now,
    now
  );
  return getProfile(p.workspace_id)!;
}

// ---------------------------------------------------------------------------
// Authorized embed origins
// ---------------------------------------------------------------------------

/**
 * Replace the set of websites allowed to embed this assistant.
 *
 * Every entry is validated and canonicalized before it is stored, so nothing
 * unvalidated can ever reach a Content-Security-Policy header. Invalid entries
 * are returned to the caller with the reason rather than silently dropped — a
 * business that typos its own domain must be told, not left with an assistant
 * that mysteriously refuses to load.
 */
export function setAllowedOrigins(workspaceId: string, origins: unknown[]): {
  accepted: string[];
  rejected: { value: string; reason: string }[];
} {
  const profile = getProfile(workspaceId);
  if (!profile) return { accepted: [], rejected: [] };

  const accepted: string[] = [];
  const rejected: { value: string; reason: string }[] = [];
  for (const raw of (origins || []).slice(0, 50)) {
    const v = normalizeOrigin(raw);
    if (v.ok && v.origin) {
      if (!accepted.includes(v.origin)) accepted.push(v.origin);
    } else {
      rejected.push({ value: String(raw).slice(0, 120), reason: v.reason || 'Invalid.' });
    }
  }

  getDatabase()
    .prepare('UPDATE business_assistant_profiles SET allowed_origins_json = ?, updated_at = ? WHERE profile_id = ?')
    .run(JSON.stringify(accepted), new Date().toISOString(), profile.profile_id);
  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Unanswered questions — the commercial feedback loop
// ---------------------------------------------------------------------------

/**
 * Record a question the business's published material could not answer.
 *
 * This is the single most commercially useful by-product of the whole system:
 * every row is a real customer asking something the business's website is
 * silent on. It is recorded, never acted on automatically — the assistant does
 * not learn a fact because a customer asked about it.
 */
export function recordUnansweredQuestion(params: {
  workspaceId: string; conversationId: string; question: string; channel: string;
}): void {
  const question = String(params.question || '').trim().slice(0, 500);
  if (question.length < 3) return;
  const db = getDatabase();
  const now = new Date().toISOString();

  // Collapse the identical question asked repeatedly into one open row rather
  // than manufacturing a queue of duplicates the owner has to wade through.
  const existing = db
    .prepare("SELECT question_id FROM business_unanswered_questions WHERE workspace_id = ? AND question = ? AND status = 'OPEN'")
    .get(params.workspaceId, question) as { question_id?: string } | undefined;
  if (existing?.question_id) {
    db.prepare('UPDATE business_unanswered_questions SET updated_at = ? WHERE question_id = ?').run(now, existing.question_id);
    return;
  }

  db.prepare(`
    INSERT INTO business_unanswered_questions
      (question_id, workspace_id, conversation_id, question, channel, status, created_at, updated_at)
    VALUES (?,?,?,?,?,'OPEN',?,?)
  `).run(
    `uq-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    params.workspaceId, params.conversationId, question, params.channel, now, now
  );
}

export interface UnansweredQuestion {
  question_id: string; conversation_id: string; question: string; channel: string;
  status: 'OPEN' | 'ANSWERED' | 'DISMISSED'; answered_artifact_id: string | null;
  created_at: string; updated_at: string;
}

export function listUnansweredQuestions(workspaceId: string, status = 'OPEN', limit = 100): UnansweredQuestion[] {
  return getDatabase()
    .prepare(`SELECT question_id, conversation_id, question, channel, status, answered_artifact_id, created_at, updated_at
              FROM business_unanswered_questions
              WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?`)
    .all(workspaceId, status, Math.min(Math.max(limit, 1), 200)) as UnansweredQuestion[];
}

export function resolveUnansweredQuestion(params: {
  workspaceId: string; questionId: string; status: 'ANSWERED' | 'DISMISSED';
  artifactId?: string; userId?: string;
}): boolean {
  const r = getDatabase()
    .prepare(`UPDATE business_unanswered_questions
              SET status = ?, answered_artifact_id = ?, answered_by_user_id = ?, updated_at = ?
              WHERE question_id = ? AND workspace_id = ?`)
    .run(params.status, params.artifactId ?? null, params.userId ?? null,
         new Date().toISOString(), params.questionId, params.workspaceId);
  return Number((r as any).changes || 0) > 0;
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

/**
 * A request to arrange something. VERBS, not nouns.
 *
 * This distinction cost a live acceptance run: "appointment" was in the
 * scheduling pattern, so "What does that first appointment include?" — a plain
 * question about what a customer would receive — was answered with "I can't
 * book times myself" AND created a follow-up task for a human. The customer
 * got a non-answer and the business owner got a false lead.
 *
 * A noun like "appointment" or "visit" appears in questions at least as often
 * as in requests. Only a verb, or a noun paired with a named time, is a
 * request to arrange something.
 */
const BOOKING_VERB = /\b(book|booking|schedule|reschedule|arrange|set up|come out|send someone|call me|ring me|phone me|get a call|availability|slots?\s+available)\b/;
const SCHEDULING_NOUN = /\b(appointment|visit|consultation|callout|call out|survey|quote visit)\b/;
const TIME_REFERENCE = /\b(today|tomorrow|tonight|this (week|afternoon|morning|evening)|next (week|month|monday|tuesday|wednesday|thursday|friday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\s?(am|pm))\b/;

/** An informational question, which a scheduling NOUN alone must never override. */
const INFORMATIONAL = /^(what|how|why|which|who|where|when do you|does|do you|is|are|can you tell|could you tell|tell me)\b/;

const OBJECTION = /\b(too expensive|expensive|pricing|price|cost|afford|discount|cheaper|budget|not sure|unsure|hesitant|why should|compare|competitor|alternative|think about it|worth it|guarantee|risk)\b/;
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|\b\+?\d[\d\s().-]{7,}\d\b/;

/** Does this turn actually name a time? Used to keep a mislabelled answer out of the lead. */
export function mentionsTime(text: string): boolean {
  return TIME_REFERENCE.test(text.toLowerCase());
}

export function classifyIntent(text: string): Intent {
  const t = text.toLowerCase();

  // A request to ARRANGE something: a booking verb, or a scheduling noun with
  // a named time that is not simply a question about it.
  const asksToArrange =
    BOOKING_VERB.test(t) ||
    (SCHEDULING_NOUN.test(t) && TIME_REFERENCE.test(t) && !INFORMATIONAL.test(t.trim()));

  // A scheduling request wins over handoff when the customer named a time —
  // that is a booking attempt, and it must reach the branch that says nothing
  // can be booked here.
  if (asksToArrange && TIME_REFERENCE.test(t)) return 'SCHEDULE';
  if (EXPLICIT_HANDOFF.test(t)) return 'HANDOFF';
  if (asksToArrange) return 'SCHEDULE';
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
 * DAYS 4-5 — length is a poor proxy for specificity, and the attorney vertical
 * proved it.
 *
 * The length rule above rejects incidental overlap on SHORT common words
 * ("work", "area", "time"). It cannot reject overlap on a LONG word that
 * happens to be ubiquitous in one particular business's corpus. Real failures,
 * both from live runs:
 *
 *   "Is there parking at your office?"        -> matched on "office"
 *   "Which attorney would be assigned to me?" -> matched on "attorney"
 *
 * Both are ≥5 characters, so both counted as specific; both appear in nearly
 * every document a law firm publishes, so neither carries any information. The
 * assistant answered a parking question with a privacy disclaimer. It never
 * INVENTED anything — the quote was real published material — but returning a
 * confidently irrelevant passage instead of admitting ignorance is its own
 * failure, and a worse one for a demo, because it reads as an answer.
 *
 * The same shape appeared in the mattress vertical on "mattress", which is why
 * this is a corpus property rather than a legal-domain quirk.
 *
 * The fix is document frequency, the classic signal for exactly this: a term
 * appearing in most of a corpus distinguishes nothing within it. Expressed as a
 * FRACTION, so it stays corpus-size independent in the way the note above
 * cares about — unlike the bm25 magnitude that was correctly abandoned.
 *
 * Below three documents the notion is meaningless (in a two-document corpus
 * every shared term is "ubiquitous"), so the rule does not apply there and the
 * length rule alone governs — which is the behaviour every new customer starts
 * with, unchanged.
 */
const UBIQUITOUS_DOC_FRACTION = 0.6;
const MIN_DOCS_FOR_UBIQUITY = 3;

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
  // General English, not domain vocabulary: a customer says "take away", a
  // business writes "removal". Both name the same act for a mattress, a skip or
  // a piano, which is what keeps this vertical-neutral.
  take: ['remove', 'removal', 'removes', 'removing', 'collect', 'collection'],
  remove: ['removal', 'take', 'collect', 'collection'],
  removal: ['remove', 'take', 'collect'],
  parking: ['park', 'car park', 'carpark'],
  documents: ['document', 'paperwork', 'papers', 'certificate', 'certificates'],
  document: ['documents', 'paperwork', 'papers'],
};

/** Exported for tests, so answerability is exercised against the real vocabulary. */
export const SYNONYMS_FOR_TEST = SYNONYMS;

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
/**
 * Terms that appear in at least UBIQUITOUS_DOC_FRACTION of a workspace's
 * published knowledge, and therefore distinguish nothing within it.
 *
 * Computed from the real indexed corpus, bounded by listWorkspaceMemory's own
 * limit. Memoised per workspace against a cheap fingerprint (document count +
 * latest update), so an unchanged corpus is computed once rather than on every
 * turn, and a changed one is recomputed without any explicit invalidation.
 */
const ubiquityCache = new Map<string, { fingerprint: string; terms: Set<string> }>();

export function ubiquitousTerms(workspaceId: string): Set<string> {
  // Check the cache with two SQL aggregates FIRST. Loading every document's
  // text just to decide whether the cache is still valid made this the most
  // expensive thing on the conversation path, for no benefit on a warm cache.
  const fingerprint = workspaceCorpusFingerprint(workspaceId, BUSINESS_KNOWLEDGE_FOLDER);
  const cached = ubiquityCache.get(workspaceId);
  if (cached && cached.fingerprint === fingerprint) return cached.terms;

  const docs = listWorkspaceMemoryContent(workspaceId, BUSINESS_KNOWLEDGE_FOLDER, 200);
  if (docs.length < MIN_DOCS_FOR_UBIQUITY) {
    // Cache the empty answer too — otherwise a small corpus reloads every turn.
    ubiquityCache.set(workspaceId, { fingerprint, terms: new Set() });
    return new Set();
  }

  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set<string>();
    for (const raw of `${doc.title} ${doc.content}`.toLowerCase().split(/[^a-z0-9']+/)) {
      if (raw.length < SPECIFIC_TERM_MIN_LENGTH) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      docFreq.set(raw, (docFreq.get(raw) || 0) + 1);
    }
  }
  const threshold = docs.length * UBIQUITOUS_DOC_FRACTION;
  const terms = new Set<string>();
  for (const [term, n] of docFreq) if (n >= threshold) terms.add(term);

  ubiquityCache.set(workspaceId, { fingerprint, terms });
  return terms;
}

export function bestPassage(content: string, query: string, maxChars = 700, ubiquitous?: Set<string>): { text: string; score: number } | null {
  const concepts = conceptsOf(query);
  if (concepts.length === 0) return null;

  const stripped = String(content || '')
    .replace(/^#+\s.*$/gm, '')            // headings carry the title, not the answer
    .replace(/^-{3,}[\s\S]*?-{3,}/m, ''); // yaml frontmatter

  // DAYS 4-5 — tables must not collapse into one passage.
  //
  // This used to `.replace(/\s+/g, ' ')` the whole document before splitting on
  // sentence punctuation. A markdown table contains no sentence punctuation, so
  // an entire product catalogue became a SINGLE enormous "sentence" holding
  // every model name and every attribute in the range. It then matched almost
  // any question about any product and, being one unit, always won — so the
  // mattress vertical answered "how much is the Ashgrove Latex?", "do you have
  // the Carrow Hybrid in stock?" and "latex versus memory foam?" with the same
  // undifferentiated table dump.
  //
  // Product catalogues are tables, so this is a general defect rather than a
  // quirk of one demo. Each table ROW is a coherent unit about one thing and is
  // treated as its own passage; the header and separator rows are dropped
  // because they describe the table rather than answer anything.
  const units: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    paragraph = [];
    for (const piece of text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/)) units.push(piece);
  };

  const isSeparatorRow = (line: string) => /^\|[\s:|-]+\|?$/.test(line);
  const lines = stripped.split(/\r?\n/).map((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('|')) {
      flushParagraph();
      // A separator row (|---|---|) carries no content.
      if (isSeparatorRow(line)) continue;
      // The row immediately ABOVE a separator is the header. It names the
      // columns rather than saying anything, and including it was visible in
      // real output: every table answer opened with
      // "Model | Construction | Firmness | Typically suits". Dropping it needs
      // this lookahead — a header row is otherwise indistinguishable from a
      // data row, since both are just pipes and text.
      const next = lines.slice(i + 1).find((l) => l !== '');
      if (next && isSeparatorRow(next)) continue;
      units.push(line.replace(/\s*\|\s*/g, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim());
    } else if (line === '') {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();

  const sentences = units.filter((x) => x.trim().length > 25);
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

  if (matched.length === 1) {
    const only = matched[0];
    // A lone match must be on a specific word. Two ways a word fails that:
    //   - it is SHORT and common ("work", "area", "time") — coincidence;
    //   - it is long but UBIQUITOUS in this business's own corpus ("attorney"
    //     for a law firm, "mattress" for a mattress shop) — it distinguishes
    //     nothing, so matching it is not evidence the passage answers anything.
    //
    // EXCEPTION, found by rerunning the attorney vertical: when the question
    // contains only ONE concept and that concept is the corpus's own central
    // subject, ubiquity must not veto. "How does a consultation work?" reduces
    // to the single concept "consultation" — ubiquitous in a law firm's
    // corpus — and refusing it meant refusing a question answered by a document
    // literally titled "How a consultation with Harrow & Vance works". Ubiquity
    // means "this term does not DISTINGUISH between documents", which is only a
    // reason to refuse when something more specific was available to ask about.
    // "Substantive" excludes the light/process verbs that frame a request
    // without being its subject — shared with the answerability module so both
    // use one notion of what counts as a thing being asked about. Without this,
    // "How does a consultation work?" looks like a two-concept question
    // (consultation + work) and the exception below never fires.
    const substantive = concepts.filter((g) => !FRAMING_VERBS.has(g[0]));
    const onlyConceptAsked = substantive.length <= 1;
    const specific = only.some((t) =>
      t.length >= SPECIFIC_TERM_MIN_LENGTH
      && hasTerm(low, t)
      && (onlyConceptAsked || !(ubiquitous && ubiquitous.has(t))));
    if (!specific) return null;

    // ...and it must be the customer's OWN word, not only a synonym of it.
    //
    // Found live: "do you do teeth whitening and how much is it?" was answered
    // with "nervous patients can ask for a longer appointment at no extra
    // charge" — the cost concept matched through the synonym "charge" while
    // the words the question was actually about (teeth, whitening) matched
    // nothing at all. A non-sequitur that implies whitening might be free.
    //
    // Synonyms still do their job whenever a second concept also matches; they
    // just cannot carry a passage on their own. `only[0]` is the original term
    // by construction of conceptsOf().
    if (!hasTerm(low, only[0])) return null;
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

/**
 * Topics the business's PUBLISHED MATERIAL must answer, never the profile's
 * generic fields.
 *
 * This exists because of a real wrong answer: "what guarantee do you offer?"
 * was answered with the list of services, because the services matcher fires
 * on the bare word "offer". The reply was fluent, confident, and about
 * something the customer had not asked — the same failure shape as answering
 * "what is your refund policy?" with the company description.
 *
 * A question naming one of these wins over every generic profile answer. If
 * the business has published nothing about it, the honest outcome is
 * NO_KNOWLEDGE — not a different question's answer delivered with confidence.
 */
// "how much" is in here for the same reason as the rest: a question naming a
// quantity or a price is not answered by the list of services, however
// naturally "do you do X" also matches the services pattern. Found live —
// "do you do teeth whitening and how much is it?" returned the service list
// and silently dropped the half of the question the customer cared about.
const SPECIFIC_TOPIC = /\b(guarantee|guaranteed|warranty|refund|deposit|cancel|cancellation|policy|insurance|licen[cs]ed|accredit|price|pricing|cost|costs|quote|fee|fees|rate|rates|discount|payment|finance|financing|how much|how many|how long|timeline|lead time|turnaround|emergency|complaint|process|qualification|experience)\b/;

function asksSpecificTopic(lowerText: string): boolean {
  return SPECIFIC_TOPIC.test(lowerText);
}

/** Does the profile itself answer this, without touching the knowledge base? */
function answerFromProfile(p: BusinessProfile, text: string): string | null {
  const t = text.toLowerCase();
  // A question about a specific published topic is never answered from the
  // profile's generic fields. Retrieval owns it, or nobody does.
  if (asksSpecificTopic(t)) return null;

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

/**
 * Exported so the LLM path takes the same shortcut the extractive path takes:
 * a question the business's own declared profile answers needs no model and no
 * retrieval, and should spend neither.
 */
export function answerFromProfileOnly(p: BusinessProfile, text: string): string | null {
  return answerFromProfile(p, text);
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
/**
 * The evidence set for a question: the approved passages, and nothing else.
 *
 * Both answering modes call this. That is the point — LLM mode does not get a
 * wider view of the workspace than extractive mode, it gets the identical
 * evidence and only phrases it differently.
 */
export function gatherEvidence(workspaceId: string, text: string): {
  hit: ScopedMemoryResult; passage: string; score: number;
}[] {
  const hits = retrieveBusinessContext(workspaceId, text, 4);
  // Computed once per turn, memoised across turns for an unchanged corpus.
  const ubiquitous = ubiquitousTerms(workspaceId);
  const scored: { hit: ScopedMemoryResult; passage: string; score: number }[] = [];
  for (const h of hits) {
    const p = bestPassage(h.content, text, 700, ubiquitous);
    if (p) scored.push({ hit: h, passage: p.text, score: p.score });
  }
  scored.sort((a, b) => b.score - a.score);

  // ANSWERABILITY GATE — placed here deliberately, and this placement is the fix.
  //
  // It was first put in answerQuestion(), where it did nothing: the live path is
  // answerWithBestAvailableMode(), which calls gatherEvidence() directly and
  // builds its own extractive reply, reaching answerQuestion() only when there
  // is no evidence at all. Two callers, two copies of the same decision, and the
  // gate sitting in the one that customers never reach.
  //
  // gatherEvidence() is the single point where retrieval becomes an answer, so
  // gating here covers every consumer and cannot drift between them. Returning
  // [] rather than a flag is deliberate too: both callers already treat "no
  // evidence" as a refusal, so no caller has to learn a new concept.
  //
  // Retrieval itself is untouched — relevance still finds and orders the
  // candidates. This only asks whether the best one speaks to what was asked.
  if (scored.length > 0) {
    const verdict = isAnswerable(questionFocus(text), scored[0].passage, {
      ubiquitous: ubiquitousTerms(workspaceId),
      synonymsOf: (t) => SYNONYMS[t] || [],
      matches: hasTerm,
    });
    if (!verdict.answerable) return [];
  }

  return scored;
}

export function answerQuestion(profile: BusinessProfile, workspaceId: string, text: string): AnswerResult {
  const direct = answerFromProfile(profile, text);
  if (direct) return { content: direct, mode: 'GROUNDED_EXTRACTIVE', sources: [] };

  const scored = gatherEvidence(workspaceId, text);
  if (scored.length === 0) return dontKnow(profile);

  // A second passage is included only when it is genuinely comparable to the
  // first. Padding a good answer with a weak one made a correct reply look
  // like a document dump, and buried the part that answered the question.
  const keep = [scored[0]];
  if (scored[1] && scored[1].score >= scored[0].score * 0.8 && scored[1].hit.artifact_id !== scored[0].hit.artifact_id) {
    keep.push(scored[1]);
  }

  return {
    content: keep.map((p) => p.passage).join('\n\n'),
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
