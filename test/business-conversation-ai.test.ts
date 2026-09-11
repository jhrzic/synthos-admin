import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// BUSINESS CONVERSATION AI
//
// These are behaviour tests against the real engine on a real database, not
// source greps: every assertion below runs the actual retrieval, the actual
// classifier and the actual task creation.
//
// Four of them exist because the live acceptance run produced a WRONG answer,
// and those are the ones that matter most:
//
//  1. INTERNAL DISCLOSURE. Searching the whole workspace index, the assistant
//     answered a visitor by quoting an internal graph-run log and a workspace
//     file path. Real text from the wrong document is still a wrong answer —
//     and in that case a leak.
//  2. "workspace".includes("work") scored as a term hit, so an irrelevant
//     document earned a quote.
//  3. "Can someone call me next Tuesday?" matched the handoff pattern on
//     "call me" and never reached the branch that says nothing can be booked.
//  4. Every turn was attributed to whatever qualification slot was open, so a
//     customer's objection was recorded as their Timing.
// ---------------------------------------------------------------------------

process.env.SYNTHOS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'convai-')), 'test.db');
process.env.VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'convai-vault-'));

const { saveProfile, getProfile, getProfileByPublicKey, setPublished, classifyIntent,
        answerQuestion, handleObjection, bestPassage, retrieveBusinessContext,
        BUSINESS_KNOWLEDGE_FOLDER } = await import('../lib/conversation/engine');
const { startConversation, handleTurn, summarizeConversation, addBusinessKnowledge,
        nextQualificationQuestion } = await import('../lib/conversation/service');
const { ensureWorkspace } = await import('../lib/workspaces');
const { getDatabase, createInitialTask, updateTaskStatus } = await import('../lib/persistence');
const { writeWorkspaceArtifact } = await import('../lib/vault');
const { indexVaultArtifact } = await import('../lib/memory-index');

const WS = 'ws-convai-test';
const OTHER_WS = 'ws-convai-other';

beforeAll(() => {
  ensureWorkspace(WS, 'Conversation Test Workspace');
  ensureWorkspace(OTHER_WS, 'Other Workspace');

  saveProfile({
    workspace_id: WS,
    business_name: 'Northgate Roofing',
    assistant_name: 'Robin',
    business_description: 'Northgate Roofing repairs and replaces residential roofs.',
    services: ['Roof repair', 'Full roof replacement', 'Gutter cleaning'],
    locations: ['Greater Manchester'],
    hours: 'Monday to Friday, 8am to 5pm',
    contact: { phone: '0161 555 0199' },
    greeting: 'Hi, I am Robin from Northgate Roofing. How can I help?',
    escalation_contacts: ['office@example.invalid'],
  } as any);

  addBusinessKnowledge({
    workspaceId: WS,
    title: 'Northgate Roofing — Guarantee',
    content: 'All completed roof replacements carry a ten year workmanship guarantee. '
      + 'The guarantee covers labour and is transferable if the property is sold. '
      + 'Materials are covered separately by the manufacturer warranty.',
  });

  // An internal operational artifact, in the same workspace but NOT designated
  // as business knowledge. This is the document the live run leaked.
  const internalTaskId = 'internal-ops-task';
  createInitialTask({
    taskId: internalTaskId, workspaceId: WS, title: 'Internal Ops Log',
    description: 'internal', assignedAgent: 'ops', assignedModel: 'n/a',
    createdAt: new Date().toISOString(),
  });
  const art = writeWorkspaceArtifact({
    workspaceId: WS, taskId: internalTaskId,
    content: 'Internal ops log. The guarantee routine failed twice during the nightly roof '
      + 'replacement batch and the workmanship queue backed up. Credentials rotated.',
    folder: 'Internal-Ops', extension: 'md',
  });
  indexVaultArtifact(WS, art.artifact_id);
  updateTaskStatus(internalTaskId, 'DONE', undefined, WS);
});

describe('1: it answers only from what the business published', () => {
  it('an internal operational artifact is never retrievable by a customer', async () => {
    // The exact leak found in the live run: this document matches the query
    // on "guarantee" and "workmanship", is indexed, and is in this workspace.
    // It must still be unreachable, because the business never published it.
    const hits = retrieveBusinessContext(WS, 'what workmanship guarantee do you offer');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.source_path).toContain(BUSINESS_KNOWLEDGE_FOLDER);
      expect(h.source_path).not.toContain('Internal-Ops');
    }
  });

  it('an answer quotes the real published document', async () => {
    const profile = getProfile(WS)!;
    const a = answerQuestion(profile, WS, 'what guarantee do you give on a roof replacement?');
    expect(a.mode).toBe('GROUNDED_EXTRACTIVE');
    expect(a.content).toContain('ten year workmanship guarantee');
    expect(a.sources[0].title).toContain('Guarantee');
  });

  it('a question with no published answer is refused, never improvised', async () => {
    const profile = getProfile(WS)!;
    const a = answerQuestion(profile, WS, 'do you install solar panels and battery storage?');
    expect(a.mode).toBe('NO_KNOWLEDGE');
    expect(a.sources).toEqual([]);
    // It must offer the real escape hatch rather than trailing off.
    expect(a.content.toLowerCase()).toMatch(/talk to a human|email or phone/);
  });

  it('knowledge is scoped to its own workspace', async () => {
    expect(retrieveBusinessContext(OTHER_WS, 'workmanship guarantee')).toEqual([]);
  });
});

describe('2: passage selection quotes a thought, not a fragment', () => {
  it('returns whole sentences around the best match', async () => {
    const p = bestPassage(
      'We open at eight. All completed roof replacements carry a ten year workmanship guarantee. '
      + 'The guarantee covers labour and is transferable if the property is sold.',
      'workmanship guarantee'
    );
    expect(p).not.toBeNull();
    expect(p!.text).toContain('ten year workmanship guarantee');
    expect(p!.text.length).toBeGreaterThan(40);
  });

  it('a document that merely shares a substring does not score', async () => {
    // "workspace" must not count as a hit for "work" — the live-run defect.
    const p = bestPassage('Every workspace is created by hand during the beta programme.', 'work');
    expect(p).toBeNull();
  });

  it('a document with no term match yields nothing rather than its first paragraph', async () => {
    expect(bestPassage('We are open Monday to Friday for general enquiries.', 'guarantee')).toBeNull();
  });
});

describe('3: intent classification, including the ordering defect', () => {
  it('a scheduling request that names a time is SCHEDULE, not HANDOFF', async () => {
    // "call me" previously matched handoff first, so the customer was never
    // told that nothing can be booked.
    expect(classifyIntent('Can someone call me next Tuesday?')).toBe('SCHEDULE');
    expect(classifyIntent('can you book me in for tomorrow morning')).toBe('SCHEDULE');
  });

  it('an explicit request for a person is still HANDOFF', async () => {
    expect(classifyIntent('Can I speak to a real person?')).toBe('HANDOFF');
    expect(classifyIntent('I want to talk to someone about this')).toBe('HANDOFF');
  });

  it('price and risk language is an OBJECTION', async () => {
    expect(classifyIntent('that sounds too expensive')).toBe('OBJECTION');
    expect(classifyIntent('do you offer any discount')).toBe('OBJECTION');
  });

  it('a bare contact detail is CONTACT_DETAILS', async () => {
    expect(classifyIntent('sure, alex@example.com')).toBe('CONTACT_DETAILS');
  });
});

describe('4: it never claims to have booked anything', () => {
  it('a scheduling request produces FOLLOW_UP_REQUEST and says so plainly', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    const r = await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'Can someone come out next Tuesday?' }) as any;
    expect(r.action.kind).toBe('FOLLOW_UP_REQUEST');
    // The words that would be a lie.
    expect(r.reply.content.toLowerCase()).not.toMatch(/booked|confirmed for|you're all set|appointment is/);
    expect(r.reply.content.toLowerCase()).toContain("can't book");
  });

  it('the follow-up is a real task assigned to a human, not to an agent', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    const r = await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'book me in for tomorrow please' }) as any;
    const task = getDatabase().prepare('SELECT * FROM tasks WHERE task_id = ?').get(r.action.taskId) as any;
    expect(task).toBeTruthy();
    expect(task.workspace_id).toBe(WS);
    expect(task.assigned_agent).toBe('human');
    expect(task.description).toContain('NOTHING HAS BEEN BOOKED');
  });

  it('the summary artifact records that nothing was booked', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'can you book me in for friday' });
    const s = summarizeConversation(WS, started.conversationId) as any;
    expect(s.markdown).toContain('appointmentBooked: false');
    expect(s.markdown).toContain('NO APPOINTMENT WAS BOOKED');
    expect(s.markdown).not.toContain('APPOINTMENT_BOOKED');
  });
});

describe('5: handoff creates real work and does not repeat itself', () => {
  it('a handoff opens one task and moves the conversation status', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    const r = await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'I want to speak to a real person' }) as any;
    expect(r.action.kind).toBe('HUMAN_HANDOFF');
    const conv = getDatabase().prepare('SELECT status FROM business_conversations WHERE conversation_id = ?')
      .get(started.conversationId) as any;
    expect(conv.status).toBe('HANDOFF_REQUESTED');

    // Asking again must not open a second task for the same request.
    const again = await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'can I speak to someone' }) as any;
    expect(again.action.kind).toBe('NONE');
  });
});

describe('6: qualification records what was said, and only that', () => {
  it('an objection is never recorded as the customer\'s timing', async () => {
    // The live-run defect: Timing came back as "Sounds expensive compared to
    // other tools" because every turn filled whatever slot was open.
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'what services do you offer' });
    await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'a leaking flat roof' });
    const r = await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'that sounds far too expensive' }) as any;
    expect(r.lead.timing).toBeUndefined();
  });

  it('a real contact detail is captured verbatim', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    const r = await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'my name is Sam and my email is sam@example.invalid' }) as any;
    expect(r.lead.contact).toBe('sam@example.invalid');
    expect(r.lead.name).toBe('Sam');
  });

  it('there is no lead score, grade or rating anywhere in the result', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    const r = await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'I need a roof repair' }) as any;
    const keys = Object.keys(r.lead);
    for (const invented of ['score', 'grade', 'rating', 'quality', 'intent_score', 'value']) {
      expect(keys).not.toContain(invented);
    }
  });

  it('qualification stops once the declared goals are met', async () => {
    const profile = getProfile(WS)!;
    const full = { need: 'roof repair', timing: 'next week', location: 'Bolton', contact: 'x@example.invalid' };
    expect(nextQualificationQuestion(profile, full)).toBeNull();
  });
});

describe('7: objections are grounded or refused — never reassured with an invented fact', () => {
  it('a pricing objection with no published price refuses to quote one', async () => {
    const profile = getProfile(WS)!;
    const a = handleObjection(profile, WS, 'that seems really expensive, can you do it cheaper?');
    expect(a.mode).toBe('NO_KNOWLEDGE');
    expect(a.content).not.toMatch(/\d+\s*(%|percent|off)/);
    expect(a.content).not.toMatch(/£|\$\d/);
  });

  it('an objection the knowledge base does answer is answered from it', async () => {
    const profile = getProfile(WS)!;
    const a = handleObjection(profile, WS, 'what if the work fails, is there any guarantee?');
    expect(a.mode).toBe('GROUNDED_EXTRACTIVE');
    expect(a.content).toContain('guarantee');
    expect(a.sources.length).toBeGreaterThan(0);
  });
});

describe('8: the public surface resolves a workspace only from a published key', () => {
  it('publishing mints a key and unpublishing takes it off the air', async () => {
    const { publicKey } = setPublished(WS, true);
    expect(publicKey).toMatch(/^[a-f0-9]{32,64}$/);
    expect(getProfileByPublicKey(publicKey!)?.workspace_id).toBe(WS);

    setPublished(WS, false);
    expect(getProfileByPublicKey(publicKey!)).toBeNull();

    // Republishing keeps the same link a business already put on its website.
    expect(setPublished(WS, true).publicKey).toBe(publicKey);
  });

  it('a malformed or unknown key resolves to nothing', async () => {
    for (const bad of ['', '../../etc/passwd', 'not-hex', 'a'.repeat(200), 'deadbeef']) {
      expect(getProfileByPublicKey(bad)).toBeNull();
    }
  });

  it('a turn is refused when the conversation belongs to another workspace', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    const r = await handleTurn({ workspaceId: OTHER_WS, conversationId: started.conversationId, text: 'hello' }) as any;
    expect(r.error).toBeTruthy();
    expect(r.reply).toBeUndefined();
  });
});

describe('9: the product states what it cannot do', () => {
  const engineSrc = fs.readFileSync(path.resolve(process.cwd(), 'lib/conversation/engine.ts'), 'utf-8');
  const serviceSrc = fs.readFileSync(path.resolve(process.cwd(), 'lib/conversation/service.ts'), 'utf-8');
  const registrySrc = fs.readFileSync(path.resolve(process.cwd(), 'lib/fabric/registry.ts'), 'utf-8');

  it('booking and telephony are registered as NOT_CONFIGURED, not omitted', async () => {
    // Omitting them would let a future caller assume a path exists.
    expect(registrySrc).toContain("key: 'conversation.booking'");
    expect(registrySrc).toContain("key: 'conversation.telephony'");
    const bookingIdx = registrySrc.indexOf("key: 'conversation.booking'");
    expect(registrySrc.slice(bookingIdx, bookingIdx + 400)).toContain("status: 'NOT_CONFIGURED'");
  });

  it('the capability is not named after a runtime', async () => {
    // Hermes, or any model vendor, is one possible implementation of one step.
    for (const src of [engineSrc, serviceSrc]) {
      expect(src).not.toMatch(/HERMES_CHAT|hermesChat/);
    }
    expect(registrySrc).toContain("key: 'conversation.respond'");
  });

  it('no fabricated telemetry anywhere in the conversation modules', async () => {
    for (const src of [engineSrc, serviceSrc]) {
      for (const fake of ['Math.random', 'tokensUsed', 'costUsd', 'confidenceScore', 'leadScore', 'sentimentScore']) {
        expect(src).not.toContain(fake);
      }
    }
  });

  it('the answering mode is recorded on every assistant message, never inferred', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'do you clean gutters' });
    const rows = getDatabase()
      .prepare("SELECT response_mode FROM business_conversation_messages WHERE conversation_id = ? AND role = 'assistant'")
      .all(started.conversationId) as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(['GROUNDED_EXTRACTIVE', 'LLM', 'NO_KNOWLEDGE', 'DETERMINISTIC']).toContain(r.response_mode);
    }
  });
});

describe('10: the summary is real evidence, not a paraphrase', () => {
  it('it is signed, verified, and names the questions the business could not answer', async () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    await handleTurn({ workspaceId: WS, conversationId: started.conversationId, text: 'do you install solar panels' });
    const s = summarizeConversation(WS, started.conversationId) as any;
    expect(s.aegisDecision).toBe('VERIFIED');
    expect(s.receiptId).toMatch(/^rcpt-/);
    expect(s.markdown).toContain('Questions your published material does not answer');
    expect(s.markdown).toContain('solar panels');
  });

  it('summarizing another workspace\'s conversation is refused', () => {
    const started = startConversation({ workspaceId: WS, channel: 'WEB' })!;
    const s = summarizeConversation(OTHER_WS, started.conversationId) as any;
    expect(s.error).toBeTruthy();
  });
});
