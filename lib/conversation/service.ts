// ---------------------------------------------------------------------------
// CONVERSATION AI — turn orchestration.
//
// engine.ts holds the stateless parts (retrieval, classification, answering).
// This file is the part with consequences: it decides what the assistant does
// with a turn, and it is the only place that creates real work in SynthOS.
//
// THE TRUTH RULE THAT SHAPES THIS FILE
//
// This assistant cannot book anything. There is no calendar integration, no
// availability source, and no scheduling provider configured. So a customer
// who says "book me for Tuesday" gets a FOLLOW_UP_REQUEST — a real task in the
// real task table, addressed to a real person — and is told exactly that.
//
// It must never render, log, summarise or report as APPOINTMENT_BOOKED.
// A business owner who reads "booked" and does not show up loses the customer
// AND the trust. That is a worse failure than having no booking feature.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { writeKnowledgeNote, deriveConversationSubject, type KnowledgeWriteResult } from '../knowledge-vault';
import { getVaultStatus } from '../vault-config';
import {
  createInitialTask, recordActivityEvent, updateTaskStatus, getDatabase,
  recordQualityReview, recordReceipt, runDeterministicAegisVerification,
  canonicalizePayload, signReceiptPayload, verifyReceiptSignature,
  type CanonicalReceiptPayload,
} from '../persistence';
import { writeWorkspaceArtifact } from '../vault';
import { indexVaultArtifact } from '../memory-index';
import {
  type BusinessProfile, type Channel, type ConversationMessage, type LeadData, type ResponseMode,
  answerQuestion, appendMessage, classifyIntent, createConversation, extractLead, getConversation,
  getMessages, getProfile, handleObjection, mentionsTime, recordUnansweredQuestion,
  setStatus, updateLead, gatherEvidence, answerFromProfileOnly,
} from './engine';
import { buildGroundedPrompt, generateGroundedReply, resolveConversationProvider, type EvidenceItem } from './llm';

/**
 * What actually happened as a result of a turn. Deliberately explicit — the
 * caller never has to infer an outcome from prose.
 */
export type TurnAction =
  | { kind: 'NONE' }
  | { kind: 'FOLLOW_UP_REQUEST'; taskId: string; reason: string }
  | { kind: 'HUMAN_HANDOFF'; taskId: string; escalatedTo: string[] };

export interface TurnResult {
  conversationId: string;
  reply: ConversationMessage;
  mode: ResponseMode;
  action: TurnAction;
  lead: LeadData;
  qualificationComplete: boolean;
  nextQuestion: string | null;
  disclosure: string;
  /**
   * What actually produced this reply. Recorded rather than inferred, and
   * never optimistic: `provider`/`model` are only populated when a real call
   * really happened, and `runtimeNote` carries the reason when the LLM path
   * was attempted and did not deliver.
   */
  provenance: {
    provider: string | null;
    model: string | null;
    evidence: { artifactId: string; title: string }[];
    runtimeNote: string | null;
  };
}

// --- bounds ----------------------------------------------------------------
// Real limits on an anonymous, unauthenticated surface. Deliberately generous
// for a genuine customer and bounded for everyone else.

/** One message. Longer than any real customer question, shorter than a payload. */
export const MAX_MESSAGE_CHARS = 4000;

/** Customer turns in one conversation. A real enquiry resolves well inside this. */
export const MAX_CUSTOMER_TURNS = 60;

/** Characters sent to the speech provider per reply. Caps cost per request. */
export const MAX_TTS_CHARS = 1500;

// --- qualification ---------------------------------------------------------
// Deterministic slot-filling. The goals come from the business's own profile;
// when it declares none, these are the four that apply to essentially every
// service business. Never a scored "lead grade" — that would be a fabricated
// judgement about a real person.

const DEFAULT_SLOTS: { slot: keyof LeadData; question: string }[] = [
  { slot: 'need', question: 'What are you looking to get done?' },
  { slot: 'timing', question: 'When were you hoping to have it sorted?' },
  { slot: 'location', question: 'Whereabouts are you based?' },
  { slot: 'contact', question: 'What is the best email or phone number to reach you on?' },
];

export function nextQualificationQuestion(profile: BusinessProfile, lead: LeadData): string | null {
  if (profile.qualification_goals.length > 0) {
    // A declared goal is free text; it is asked verbatim and its answer is
    // stored under `questions` rather than being parsed into a fixed slot.
    const asked = lead.questions || [];
    const pending = profile.qualification_goals.find((g) => !asked.includes(g));
    if (pending) return pending;
  }
  const missing = DEFAULT_SLOTS.find((s) => !lead[s.slot]);
  return missing ? missing.question : null;
}

export function isQualified(profile: BusinessProfile, lead: LeadData): boolean {
  return nextQualificationQuestion(profile, lead) === null;
}

// --- real work creation ----------------------------------------------------

function createConversationTask(params: {
  workspaceId: string; conversationId: string; kind: 'FOLLOW_UP_REQUEST' | 'HUMAN_HANDOFF';
  profile: BusinessProfile; lead: LeadData; customerText: string;
}): string {
  const { workspaceId, conversationId, kind, profile, lead } = params;
  const nowIso = new Date().toISOString();
  const taskId = `conv-${kind === 'HUMAN_HANDOFF' ? 'handoff' : 'followup'}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const contactLine = lead.contact
    ? `${lead.contactKind === 'phone' ? 'Phone' : 'Email'}: ${lead.contact}`
    : 'Contact: NOT PROVIDED — reply in the conversation thread.';

  const title = kind === 'HUMAN_HANDOFF'
    ? `Human handoff requested — ${lead.name || 'website visitor'}`
    : `Follow-up requested — ${lead.name || 'website visitor'}`;

  createInitialTask({
    taskId, workspaceId, title,
    description: [
      kind === 'HUMAN_HANDOFF'
        ? 'A customer asked to speak with a person. The AI assistant stopped answering and is holding the conversation.'
        : 'A customer asked about scheduling. NOTHING HAS BEEN BOOKED — this assistant cannot book, and the customer was told so. A person must make contact to arrange it.',
      '',
      `**Business:** ${profile.business_name}`,
      `**Conversation:** ${conversationId}`,
      `**${contactLine}**`,
      lead.name ? `**Name:** ${lead.name}` : '',
      lead.need ? `**Need:** ${lead.need}` : '',
      lead.timing ? `**Timing mentioned:** ${lead.timing}` : '',
      lead.location ? `**Location:** ${lead.location}` : '',
      '',
      '**Customer said:**',
      `> ${String(params.customerText).slice(0, 600)}`,
    ].filter(Boolean).join('\n'),
    assignedAgent: 'human',      // explicitly not an agent: a person must do this
    assignedModel: 'n/a',
    createdAt: nowIso,
  });
  recordActivityEvent({
    taskId, expectedWorkspaceId: workspaceId, eventType: 'TASK_CREATED', agentId: 'conversation-ai',
    payload: { kind, conversationId, channel: 'conversation-ai' }, createdAt: nowIso,
  });
  updateTaskStatus(taskId, 'READY', undefined, workspaceId);
  return taskId;
}

// --- answering mode selection ----------------------------------------------

interface AnsweredTurn {
  content: string;
  mode: ResponseMode;
  sources: { artifactId: string; title: string; path: string }[];
  provenance: TurnResult['provenance'];
}

/**
 * Answer a question with the best mode this install can actually deliver.
 *
 * The order is the product's entire safety argument:
 *
 *   1. The business's own declared profile. No retrieval, no model, no spend.
 *   2. Approved evidence from Business-Knowledge only. If there is NONE, the
 *      answer is a refusal and NO MODEL IS CALLED — a model that is never
 *      asked cannot answer from its own priors. This is the line that makes
 *      "never hallucinate a business answer" a property of control flow rather
 *      than a request in a prompt.
 *   3. With evidence in hand: if a provider is configured, the model phrases
 *      THAT EVIDENCE and its output is checked before it is shown. If the
 *      model is absent, fails, or produces a claim the evidence does not
 *      support, the reply falls back to quoting the same evidence directly.
 *
 * Note what cannot happen: the LLM path never sees evidence the extractive
 * path would not have used, and never runs when the extractive path would have
 * refused. Turning a model on can change the wording of an answer. It can
 * never change whether there was an answer.
 */
export async function answerWithBestAvailableMode(params: {
  profile: BusinessProfile;
  workspaceId: string;
  text: string;
  history: ConversationMessage[];
  isObjection: boolean;
  callModel?: (model: string, prompt: any) => Promise<string>;
}): Promise<AnsweredTurn> {
  const { profile, workspaceId, text, isObjection } = params;
  const none: TurnResult['provenance'] = { provider: null, model: null, evidence: [], runtimeNote: null };

  // 1. The profile answers it outright.
  const direct = answerFromProfileOnly(profile, text);
  if (direct) {
    return { content: direct, mode: 'GROUNDED_EXTRACTIVE', sources: [], provenance: none };
  }

  // 2. Evidence, or a refusal. Identical for both modes.
  const scored = gatherEvidence(workspaceId, text);
  if (scored.length === 0) {
    const refusal = isObjection
      ? handleObjection(profile, workspaceId, text)
      : answerQuestion(profile, workspaceId, text);
    return { content: refusal.content, mode: refusal.mode, sources: refusal.sources, provenance: none };
  }

  const keep = [scored[0]];
  if (scored[1] && scored[1].score >= scored[0].score * 0.8 && scored[1].hit.artifact_id !== scored[0].hit.artifact_id) {
    keep.push(scored[1]);
  }
  const evidence: EvidenceItem[] = keep.map((k) => ({
    artifactId: k.hit.artifact_id, title: k.hit.title, path: k.hit.source_path, passage: k.passage,
  }));
  const sources = evidence.map((e) => ({ artifactId: e.artifactId, title: e.title, path: e.path }));

  const extractive = (): AnsweredTurn => {
    const body = evidence.map((e) => e.passage).join('\n\n');
    return {
      content: isObjection ? `That's a fair question.\n\n${body}` : body,
      mode: 'GROUNDED_EXTRACTIVE',
      sources,
      provenance: { ...none, evidence: evidence.map((e) => ({ artifactId: e.artifactId, title: e.title })) },
    };
  };

  // 3. Phrase the evidence with a model, if one is really available.
  const availability = resolveConversationProvider();
  if (availability.available !== true) {
    return {
      ...extractive(),
      provenance: {
        provider: null, model: null,
        evidence: evidence.map((e) => ({ artifactId: e.artifactId, title: e.title })),
        runtimeNote: `LLM_NOT_CONFIGURED: ${availability.detail}`,
      },
    };
  }

  const prompt = buildGroundedPrompt({ profile, history: params.history, question: text, evidence });
  const llm = await generateGroundedReply({ prompt, evidence, callModel: params.callModel as any });

  if (!llm.ok) {
    // A provider failure must never become a worse answer than we already had.
    // The evidence is still real, so the customer still gets it — and the
    // degradation is recorded for the owner rather than hidden from them.
    return {
      ...extractive(),
      provenance: {
        provider: llm.provider ?? null, model: llm.modelUsed ?? null,
        evidence: evidence.map((e) => ({ artifactId: e.artifactId, title: e.title })),
        runtimeNote: `LLM_DEGRADED_${llm.failureReason}: ${llm.failureDetail || 'no detail'}`,
      },
    };
  }

  return {
    content: llm.text!,
    mode: 'LLM',
    sources,
    provenance: {
      provider: llm.provider ?? null, model: llm.modelUsed ?? null,
      evidence: evidence.map((e) => ({ artifactId: e.artifactId, title: e.title })),
      runtimeNote: null,
    },
  };
}

// --- the turn --------------------------------------------------------------

export function startConversation(params: {
  workspaceId: string; channel: Channel; participantRef?: string;
}): { conversationId: string; greeting: ConversationMessage; disclosure: string; profile: BusinessProfile } | null {
  const profile = getProfile(params.workspaceId);
  if (!profile) return null;

  const conversationId = createConversation({
    workspaceId: params.workspaceId, profileId: profile.profile_id,
    channel: params.channel, participantRef: params.participantRef,
  });

  const greetingText = profile.greeting?.trim()
    || `Hi — I'm ${profile.assistant_name}, the assistant for ${profile.business_name}. What can I help you with?`;

  const greeting = appendMessage({
    workspaceId: params.workspaceId, conversationId, role: 'assistant',
    content: greetingText, responseMode: 'DETERMINISTIC',
  });

  return { conversationId, greeting, disclosure: profile.ai_disclosure, profile };
}

export async function handleTurn(params: {
  workspaceId: string; conversationId: string; text: string;
  /** Test seam: substitute the model call without touching provider resolution. */
  callModel?: (model: string, prompt: { system: string; user: string; evidenceRefs: { artifactId: string; title: string }[] }) => Promise<string>;
}): Promise<TurnResult | { error: string }> {
  const { workspaceId, conversationId } = params;
  const text = String(params.text || '').trim();
  if (!text) return { error: 'Empty message.' };
  if (text.length > MAX_MESSAGE_CHARS) return { error: 'Message too long.' };

  const conv = getConversation(workspaceId, conversationId);
  if (!conv) return { error: 'Conversation not found in this workspace.' };
  const profile = getProfile(workspaceId);
  if (!profile) return { error: 'No business assistant profile is configured for this workspace.' };

  appendMessage({ workspaceId, conversationId, role: 'customer', content: text });

  // Lead facts are extracted from what the customer actually wrote. Nothing is
  // inferred, scored, or enriched from an outside source.
  let lead: LeadData = (() => { try { return JSON.parse(conv.lead_json || '{}'); } catch { return {}; } })();
  lead = extractLead(text, lead);

  const prior = getMessages(workspaceId, conversationId);

  // A bounded conversation. Without this an anonymous visitor can grow one
  // conversation without limit — every turn re-reads the whole transcript, so
  // the cost of turn N grows with N, and a single session becomes a slow
  // resource drain that no per-request rate limit catches.
  //
  // The cap ends the conversation honestly rather than degrading it: a
  // customer is told to start a new one or ask for a person, which is what a
  // genuine 60-turn conversation needed anyway.
  if (prior.filter((m) => m.role === 'customer').length >= MAX_CUSTOMER_TURNS) {
    return {
      error: `This conversation has reached its length limit. Please start a new one — or say "talk to a human" in a new conversation and someone will pick it up.`,
    };
  }

  const intent = classifyIntent(text);

  // If the assistant's previous turn asked a qualification question, THIS turn
  // may be its answer — but only if it actually looks like one.
  //
  // A live run recorded Timing: "Sounds expensive compared to other tools",
  // because the customer ignored the question and raised an objection instead,
  // and every turn was blindly attributed to whatever slot was open. A human
  // reading that lead is being misinformed by their own software, which is
  // worse than an empty field.
  const looksLikeAnAnswer =
    !text.includes('?') &&
    text.length <= 200 &&
    (intent === 'QUESTION' || intent === 'CONTACT_DETAILS');

  if (looksLikeAnAnswer) {
    const lastAssistant = [...prior].reverse().find((m) => m.role === 'assistant');
    const q = lastAssistant?.content || '';
    if (/looking to get done/.test(q) && !lead.need) lead.need = text.slice(0, 300);
    else if (/Whereabouts are you based/.test(q) && !lead.location) lead.location = text.slice(0, 120);
    // Timing needs an actual time reference, not merely a turn that followed
    // the timing question.
    else if (/hoping to have it sorted/.test(q) && !lead.timing && mentionsTime(text)) lead.timing = text.slice(0, 120);
    else {
      // DAYS 4-5 fix. This compared the WHOLE last assistant message against the
      // configured goals with `.includes(q)` — an exact-equality membership test.
      // But a qualification question is appended AFTER the grounded answer, so
      // the message is "<answer>\n\n<question>" and never equals a goal. The
      // result: a configured question was never marked as asked, so the
      // assistant re-asked it on every turn and intake could never complete.
      //
      // It went unnoticed because the DEFAULT_SLOTS branches above match with
      // regex `.test(q)` against the same full message and therefore worked —
      // so only businesses that configure their OWN qualification goals were
      // affected, which is every real vertical and no default install.
      //
      // Matching on the question the message actually ENDS with is both correct
      // and specific: it identifies which goal was just asked rather than any
      // goal merely mentioned somewhere in the text.
      const askedGoal = profile.qualification_goals.find((g) => q.trimEnd().endsWith(g.trim()));
      if (askedGoal && !(lead.questions || []).includes(askedGoal)) {
        lead.questions = [...(lead.questions || []), askedGoal];
      }
    }
  }

  const alreadyHandedOff = conv.status === 'HANDOFF_REQUESTED';
  let action: TurnAction = { kind: 'NONE' };
  let content: string;
  let mode: ResponseMode;
  let sources: { artifactId: string; title: string; path: string }[] = [];
  let provenance: TurnResult['provenance'] = { provider: null, model: null, evidence: [], runtimeNote: null };

  if (intent === 'HANDOFF') {
    if (alreadyHandedOff) {
      // Don't create a second task for the same request, and don't pretend
      // this is new information.
      mode = 'DETERMINISTIC';
      content = lead.contact
        ? `That's already with a person at ${profile.business_name} — they have ${lead.contact} and will be in touch.`
        : `That's already flagged for a person at ${profile.business_name}. What's the best email or phone number for them to use?`;
    } else {
      const taskId = createConversationTask({ workspaceId, conversationId, kind: 'HUMAN_HANDOFF', profile, lead, customerText: text });
      setStatus(workspaceId, conversationId, 'HANDOFF_REQUESTED');
      action = { kind: 'HUMAN_HANDOFF', taskId, escalatedTo: profile.escalation_contacts };
      mode = 'DETERMINISTIC';
      content = lead.contact
        ? `Done — I've flagged this for a person at ${profile.business_name} and passed on ${lead.contact}. They'll pick it up from here.`
        : `Of course. I've flagged this for a person at ${profile.business_name}. So they can reach you, what's the best email or phone number?`;
    }
  } else if (intent === 'SCHEDULE') {
    const taskId = createConversationTask({ workspaceId, conversationId, kind: 'FOLLOW_UP_REQUEST', profile, lead, customerText: text });
    action = { kind: 'FOLLOW_UP_REQUEST', taskId, reason: 'Customer asked about scheduling; no booking system is connected.' };
    mode = 'DETERMINISTIC';
    // The exact wording is load-bearing. "I've booked you in" would be a lie,
    // and a customer who believes it and turns up is worse off than one who
    // was told the truth.
    content = `I can't book times myself — I don't have access to the calendar, and I'd rather not promise a slot that turns out not to exist. `
      + `What I have done is raise a follow-up request so someone from ${profile.business_name} can contact you and confirm.`
      + (lead.contact ? ` They'll use ${lead.contact}.` : ` What's the best email or phone number for them to use?`);
  } else if (intent === 'CONTACT_DETAILS') {
    // A customer handing over their details gets an acknowledgement, not the
    // business's own contact card back — which is what the previous version
    // did, and it read as though nobody was listening.
    mode = 'DETERMINISTIC';
    if (lead.contact) {
      // The details are stored on the conversation below, which is what the
      // open handoff/follow-up task points a person at — so a number that
      // arrives after the task was raised still reaches them.
      content = alreadyHandedOff
        ? `Thanks${lead.name ? `, ${lead.name}` : ''} — I've added ${lead.contact} to this, and someone from ${profile.business_name} will be in touch.`
        : `Thanks${lead.name ? `, ${lead.name}` : ''} — I've noted ${lead.contact}. Anything else I can answer while you're here?`;
    } else {
      content = `Thanks. I didn't quite catch a usable email or phone number there — could you write it out for me?`;
    }
  } else {
    // --- the answering path: extractive, or the same evidence phrased by a model ---
    const answered = await answerWithBestAvailableMode({
      profile, workspaceId, text, history: prior, isObjection: intent === 'OBJECTION',
      callModel: params.callModel,
    });
    content = answered.content; mode = answered.mode; sources = answered.sources;
    provenance = answered.provenance;

    // A question the business's own material cannot answer is the single most
    // useful thing this product learns. Recorded on the extractive path AND
    // the LLM path, because a refusal is a refusal however it was phrased.
    if (mode === 'NO_KNOWLEDGE') {
      recordUnansweredQuestion({ workspaceId, conversationId, question: text, channel: String(conv.channel) });
    }
  }

  // Qualification rides along with an answer at most every other turn, and
  // never after a NO_KNOWLEDGE reply (which already ends by offering a person)
  // or once a handoff is in flight. Asking on every single turn made the
  // assistant read like a form, which is what a customer leaves.
  const customerTurns = prior.filter((m) => m.role === 'customer').length + 1;
  const nextQuestion = alreadyHandedOff || action.kind !== 'NONE' ? null : nextQualificationQuestion(profile, lead);
  const mayAsk =
    nextQuestion !== null &&
    mode !== 'NO_KNOWLEDGE' &&
    intent !== 'CONTACT_DETAILS' &&
    action.kind === 'NONE' &&
    customerTurns % 2 === 0;
  if (mayAsk) content = `${content}\n\n${nextQuestion}`;

  updateLead(workspaceId, conversationId, lead);
  const reply = appendMessage({ workspaceId, conversationId, role: 'assistant', content, responseMode: mode, sources });

  return {
    conversationId, reply, mode, action, lead,
    qualificationComplete: isQualified(profile, lead),
    nextQuestion: mayAsk ? nextQuestion : null,
    disclosure: profile.ai_disclosure,
    provenance,
  };
}

// --- knowledge -------------------------------------------------------------

/**
 * The business's own knowledge, added through the ONE artifact path everything
 * else uses. There is deliberately no second knowledge store: a knowledge
 * document is a Vault artifact on a real task, indexed into the same FTS5
 * index the rest of the platform searches.
 *
 * This matters beyond tidiness. Because it is an ordinary artifact, the owner
 * can see it, search it, and check exactly what the assistant is allowed to
 * say — the answer to "why did it tell my customer that" is always a document
 * they can open.
 */
export function addBusinessKnowledge(params: {
  workspaceId: string; title: string; content: string;
}): { artifactId: string; path: string; taskId: string; indexed: boolean } | { error: string } {
  const title = String(params.title || '').trim().slice(0, 200);
  const content = String(params.content || '').trim();
  if (!title) return { error: 'A title is required.' };
  if (content.length < 20) return { error: 'The document is too short to be useful knowledge.' };
  if (content.length > 200_000) return { error: 'The document is too large (200,000 character limit).' };

  const nowIso = new Date().toISOString();
  const taskId = `conv-knowledge-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  createInitialTask({
    taskId, workspaceId: params.workspaceId, title,
    description: `Business knowledge document added for the conversation assistant.`,
    assignedAgent: 'conversation-ai', assignedModel: 'n/a', createdAt: nowIso,
  });
  recordActivityEvent({ taskId, expectedWorkspaceId: params.workspaceId, eventType: 'TASK_CREATED', agentId: 'conversation-ai', payload: { kind: 'knowledge' }, createdAt: nowIso });
  updateTaskStatus(taskId, 'READY', undefined, params.workspaceId);
  updateTaskStatus(taskId, 'RUNNING', undefined, params.workspaceId);

  const artifact = writeWorkspaceArtifact({
    workspaceId: params.workspaceId, taskId,
    content: `# ${title}\n\n${content}\n`,
    folder: 'Business-Knowledge', extension: 'md', createdAt: nowIso,
  });
  let indexed = false;
  try { indexed = indexVaultArtifact(params.workspaceId, artifact.artifact_id); } catch { indexed = false; }
  recordActivityEvent({
    taskId, expectedWorkspaceId: params.workspaceId, eventType: 'ARTIFACT_SAVED', agentId: 'conversation-ai',
    payload: { artifactId: artifact.artifact_id, relativePath: artifact.relative_path, indexed }, createdAt: nowIso,
  });
  updateTaskStatus(taskId, 'DONE', undefined, params.workspaceId);

  return { artifactId: artifact.artifact_id, path: artifact.relative_path, taskId, indexed };
}

// --- summary ---------------------------------------------------------------

/**
 * A conversation summary is a real Vault artifact on the canonical spine, not
 * a side note: createInitialTask -> READY -> RUNNING -> PROVIDER_COMPLETED ->
 * artifact -> ARTIFACT_SAVED -> AWAITING_VERIFICATION -> Aegis -> receipt.
 *
 * That is deliberate and not ceremony. The summary is the thing a business
 * owner reads instead of the transcript, and it is the thing a dispute would
 * turn on ("your bot told my customer X"). It gets the same signed evidence
 * chain as any other delivered work.
 *
 * It is assembled deterministically from what was actually said and done. No
 * model paraphrases it, so it cannot invent an outcome the conversation did
 * not have.
 */
export function summarizeConversation(workspaceId: string, conversationId: string):
  | {
      artifactId: string; path: string; taskId: string; receiptId: string | null;
      aegisDecision: string; markdown: string;
      /** Where this conversation landed in the user's real vault, or why it did not. */
      knowledge: KnowledgeWriteResult | null;
    }
  | { error: string } {
  const conv = getConversation(workspaceId, conversationId);
  if (!conv) return { error: 'Conversation not found in this workspace.' };
  const profile = getProfile(workspaceId);
  const messages = getMessages(workspaceId, conversationId);
  const lead: LeadData = (() => { try { return JSON.parse(conv.lead_json || '{}'); } catch { return {}; } })();

  const assistantTurns = messages.filter((m) => m.role === 'assistant');
  const noKnowledge = assistantTurns.filter((m) => m.response_mode === 'NO_KNOWLEDGE').length;
  const grounded = assistantTurns.filter((m) => m.response_mode === 'GROUNDED_EXTRACTIVE').length;
  const llm = assistantTurns.filter((m) => m.response_mode === 'LLM').length;

  // Every question the assistant could not answer. This is the most
  // commercially useful thing in the whole document: each one is a real
  // customer asking something the business has not published.
  const unanswered: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'assistant' && messages[i].response_mode === 'NO_KNOWLEDGE') {
      const q = [...messages.slice(0, i)].reverse().find((m) => m.role === 'customer');
      if (q) unanswered.push(q.content.slice(0, 200));
    }
  }

  const markdown = [
    '---',
    'type: "business-conversation-summary"',
    `conversationId: ${JSON.stringify(conversationId)}`,
    `channel: ${JSON.stringify(conv.channel)}`,
    `status: ${JSON.stringify(conv.status)}`,
    `startedAt: ${JSON.stringify(conv.created_at)}`,
    `appointmentBooked: false`,
    '---',
    '',
    `# Conversation summary — ${profile?.business_name || 'Business'}`,
    '',
    `- **Channel:** ${conv.channel}`,
    `- **Status:** ${conv.status}`,
    `- **Turns:** ${messages.filter((m) => m.role === 'customer').length} from the customer, ${assistantTurns.length} from the assistant`,
    '',
    '## What the customer told us',
    '',
    lead.name ? `- **Name:** ${lead.name}` : '- **Name:** NOT PROVIDED',
    lead.contact ? `- **Contact:** ${lead.contact} (${lead.contactKind})` : '- **Contact:** NOT PROVIDED',
    lead.need ? `- **Need:** ${lead.need}` : '- **Need:** NOT PROVIDED',
    lead.timing ? `- **Timing:** ${lead.timing}` : '- **Timing:** NOT PROVIDED',
    lead.location ? `- **Location:** ${lead.location}` : '- **Location:** NOT PROVIDED',
    '',
    '## Outcome',
    '',
    conv.status === 'HANDOFF_REQUESTED'
      ? '**HUMAN HANDOFF REQUESTED.** A person must respond. The open task is on the Task Board.'
      : '**NO APPOINTMENT WAS BOOKED.** This assistant cannot book — there is no calendar or scheduling provider connected to it. Where the customer asked about scheduling, a FOLLOW-UP REQUEST task was created for a person to confirm a time.',
    '',
    '## How the assistant answered',
    '',
    `- Grounded in the business's own published material: **${grounded}**`,
    `- Phrased by an approved model over that same material: **${llm}**`,
    `- Declined to answer because nothing verified was found: **${noKnowledge}**`,
    '',
    ...(unanswered.length
      ? ['### Questions your published material does not answer', '',
         ...unanswered.map((q) => `- "${q}"`), '',
         '> Each of these is a real customer asking something your site does not say. Publishing the answer fixes it for every future visitor — and for the AI assistants that read your site.', '']
      : ['> Every question asked was answerable from your published material.', '']),
    '## Transcript',
    '',
    ...messages.map((m) => {
      const who = m.role === 'customer' ? 'Customer' : m.role === 'assistant' ? (profile?.assistant_name || 'Assistant') : 'System';
      const tag = m.role === 'assistant' && m.response_mode ? ` _(${m.response_mode})_` : '';
      const src = m.sources.length ? `\n\nSources: ${m.sources.map((s) => s.path).join(', ')}` : '';
      return `**${who}**${tag}\n\n${m.content}${src}\n`;
    }),
  ].join('\n');

  const nowIso = new Date().toISOString();
  const taskId = `conv-summary-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  createInitialTask({
    taskId, workspaceId,
    title: `Conversation summary — ${profile?.business_name || 'Business'} (${conv.channel})`,
    description: `Deterministic summary of conversation ${conversationId}.`,
    assignedAgent: 'conversation-ai', assignedModel: 'deterministic-summary', createdAt: nowIso,
  });
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'TASK_CREATED', agentId: 'conversation-ai', payload: { conversationId }, createdAt: nowIso });
  updateTaskStatus(taskId, 'READY', undefined, workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'AGENT_ASSIGNED', agentId: 'conversation-ai', payload: { agent: 'conversation-ai' }, createdAt: nowIso });
  updateTaskStatus(taskId, 'RUNNING', undefined, workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'EXECUTION_STARTED', agentId: 'conversation-ai', payload: { messages: messages.length }, createdAt: nowIso });
  recordActivityEvent({
    taskId, expectedWorkspaceId: workspaceId, eventType: 'PROVIDER_COMPLETED', agentId: 'conversation-ai',
    payload: { provider: 'synthos-conversation-ai', messages: messages.length, grounded, llm, noKnowledge }, createdAt: nowIso,
  });

  const artifact = writeWorkspaceArtifact({
    workspaceId, taskId, content: markdown, folder: 'Conversations', extension: 'md', createdAt: nowIso,
  });
  try { indexVaultArtifact(workspaceId, artifact.artifact_id); } catch { /* index best-effort */ }
  recordActivityEvent({
    taskId, expectedWorkspaceId: workspaceId, eventType: 'ARTIFACT_SAVED', agentId: 'conversation-ai',
    payload: { artifactId: artifact.artifact_id, relativePath: artifact.relative_path, contentHash: artifact.content_hash }, createdAt: nowIso,
  });
  updateTaskStatus(taskId, 'AWAITING_VERIFICATION', undefined, workspaceId);

  const aegisResult = runDeterministicAegisVerification(taskId, markdown);
  const review = recordQualityReview({
    taskId, reviewer: aegisResult.reviewer, method: aegisResult.method, score: aegisResult.score,
    decision: aegisResult.decision, checks: aegisResult.checks, evidence: aegisResult.evidence, createdAt: nowIso,
  });

  let receiptId: string | null = null;
  if (aegisResult.decision === 'VERIFIED') {
    updateTaskStatus(taskId, 'AWAITING_RECEIPT', undefined, workspaceId);
    recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'AEGIS_REVIEWED', agentId: 'aegis', payload: { reviewId: review.review_id, decision: aegisResult.decision, score: aegisResult.score }, createdAt: nowIso });
    const newReceiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const payload: CanonicalReceiptPayload = {
      receiptId: newReceiptId, taskId, reviewId: review.review_id, workspaceId,
      assignedAgent: 'conversation-ai', provider: 'synthos-conversation-ai',
      modelUsed: 'deterministic-summary',
      artifactId: artifact.artifact_id, artifactHash: artifact.content_hash,
      aegisDecision: aegisResult.decision, aegisMethod: aegisResult.method, createdAt: nowIso,
    };
    const payloadStr = canonicalizePayload(payload);
    const { signature, publicKeyPem, algorithm, fingerprint } = signReceiptPayload(payloadStr);
    if (verifyReceiptSignature(payloadStr, signature, publicKeyPem)) {
      recordReceipt({ receiptId: newReceiptId, taskId, reviewId: review.review_id, algorithm, publicKey: publicKeyPem, payloadJson: payloadStr, signature, createdAt: nowIso });
      recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'RECEIPT_CREATED', agentId: 'guardian', payload: { receiptId: newReceiptId, algorithm, fingerprint, verified: true }, createdAt: nowIso });
      receiptId = newReceiptId;
    }
  }
  updateTaskStatus(taskId, 'DONE', undefined, workspaceId);

  getDatabase()
    .prepare('UPDATE business_conversations SET summary_artifact_id = ?, updated_at = ? WHERE conversation_id = ? AND workspace_id = ?')
    .run(artifact.artifact_id, nowIso, conversationId, workspaceId);

  // -------------------------------------------------------------------------
  // DAYS 2-3 — the same conversation, as KNOWLEDGE in the user's real vault.
  //
  // This is deliberately a SECOND, different write, not a replacement for the
  // artifact above:
  //
  //   * the artifact (above) is SynthOS's internal, hashed, receipt-bearing
  //     record — machine-named by design, joined to a task row;
  //   * the knowledge note (here) is a human's Markdown file, named by SUBJECT,
  //     living in their own vault where they will actually find it.
  //
  // It runs LAST and cannot fail the summary. A vault that is misconfigured,
  // read-only or absent must never break a live customer conversation — the
  // result records `written: false` with a real reason instead. Silently
  // reporting success would be the worse failure, so the reason is returned to
  // the caller rather than swallowed.
  const customerTexts = messages.filter((m) => m.role === 'customer').map((m) => m.content);
  const subject = deriveConversationSubject(profile?.business_name || 'Business', customerTexts);
  let knowledge: KnowledgeWriteResult | null = null;
  try {
    knowledge = writeKnowledgeNote(
      {
        title: subject.title,
        kind: 'Conversations',
        workspaceId,
        source: 'business-conversation',
        sessionId: conversationId,
        runtime: 'synthos-conversation-ai',
        model: llm > 0 ? 'approved-model' : 'deterministic',
        topics: subject.topics,
        tags: ['synthos', 'conversation', conv.channel.toLowerCase()],
        summary: `${messages.filter((m) => m.role === 'customer').length} customer turns. `
          + `${grounded} answered from published material, ${llm} phrased by an approved model, `
          + `${noKnowledge} declined for lack of verified evidence.`,
        // Only genuinely-known facts become "decisions" — never invented ones.
        decisions: conv.status === 'HANDOFF_REQUESTED'
          ? ['Customer asked for a person. A human handoff task was created.']
          : [],
        // Each unanswered question is a real requirement on the business's
        // published material, which is exactly what makes it worth keeping.
        requirements: unanswered.map((q) => `Publish an answer for: "${q}"`),
        actionItems: unanswered.length > 0
          ? ['Answer the unpublished questions above so the assistant can use them.']
          : [],
        artifacts: [artifact.artifact_id],
        // Present only when a receipt genuinely exists — this is the link that
        // makes the knowledge note traceable back to verified work.
        receipts: receiptId ? [receiptId] : [],
        createdAt: nowIso,
      },
      markdown,
    );
  } catch (err: any) {
    knowledge = {
      written: false, absolutePath: null, vaultRelativePath: null, fileName: null,
      status: getVaultStatus(), reason: `Knowledge write threw: ${err?.message || err}`,
    };
  }

  return {
    artifactId: artifact.artifact_id, path: artifact.relative_path, taskId,
    receiptId, aegisDecision: aegisResult.decision, markdown,
    knowledge,
  };
}
