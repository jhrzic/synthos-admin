import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isolateVaultForTest } from './helpers/isolated-vault';
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
isolateVaultForTest('convprod');

// ---------------------------------------------------------------------------
// PRODUCTION READINESS
//
// Three things this file proves that nothing else did:
//
//  1. A BRAND NEW CUSTOMER WITH ONE DOCUMENT works. That is the condition that
//     exposed the bm25 defect two passes ago — relevance was gated on a score
//     whose magnitude scales with corpus size, so the smallest corpus (the one
//     every customer starts at) had every answer refused.
//  2. TWO BUSINESSES ON ONE INSTALL cannot see each other. This is the claim
//     that makes the product sellable more than once.
//  3. THE PUBLIC ADDRESS IS RIGHT. Behind a TLS-terminating proxy the app sees
//     plain http, so an embed snippet built from req.protocol hands the
//     business an http:// script tag that browsers block on their https site —
//     silently, with nothing in the product admitting it.
// ---------------------------------------------------------------------------

process.env.SYNTHOS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'convprod-')), 'test.db');
process.env.VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'convprod-vault-'));

const { resolvePublicBaseUrl } = await import('../lib/public-url');
const { saveProfile, getProfile, setPublished, setAllowedOrigins, getProfileByPublicKey,
        listConversations, listUnansweredQuestions, retrieveBusinessContext } =
  await import('../lib/conversation/engine');
const { startConversation, handleTurn, addBusinessKnowledge, summarizeConversation,
        answerWithBestAvailableMode, MAX_CUSTOMER_TURNS, MAX_MESSAGE_CHARS, MAX_TTS_CHARS } =
  await import('../lib/conversation/service');
const { getModelCredentialStatus, saveModelCredential, deleteModelCredential, resolveModelApiKey } =
  await import('../lib/model-credentials');
const { getFishAccountState, recordFishObservation } = await import('../lib/voice-credentials');
const { ensureWorkspace } = await import('../lib/workspaces');
const { getDatabase } = await import('../lib/persistence');

const A = 'ws-tenant-a';
const B = 'ws-tenant-b';

beforeAll(() => {
  ensureWorkspace(A, 'Tenant A');
  ensureWorkspace(B, 'Tenant B');
});

describe('1: a brand new customer with ONE document works', () => {
  it('onboards with a single profile and a single knowledge document', () => {
    saveProfile({
      workspace_id: A, business_name: 'Alder Dental', assistant_name: 'Nia',
      business_description: 'Alder Dental is a family dental practice.',
      services: ['Check-ups', 'Hygienist'], locations: ['Didsbury'],
      hours: 'Monday to Thursday, 9am to 5pm', contact: { phone: '0161 555 0101' },
      escalation_contacts: ['reception@example.invalid'],
    } as any);
    const added = addBusinessKnowledge({
      workspaceId: A, title: 'Alder Dental — New patients',
      content: 'We are accepting new NHS patients on a waiting list, and private patients immediately. '
        + 'A first private appointment includes a full examination and two x-rays. '
        + 'Nervous patients can ask for a longer appointment at no extra charge.',
    }) as any;
    expect(added.indexed).toBe(true);

    const entries = retrieveBusinessContext(A, 'are you taking new patients');
    expect(entries.length).toBe(1);   // exactly one document in the corpus
  });

  it('answers a known question from a one-document corpus', async () => {
    // The bm25 defect: with one document the score magnitude collapses toward
    // zero, so an absolute-rank gate refused everything.
    const r = await answerWithBestAvailableMode({
      profile: getProfile(A)!, workspaceId: A,
      text: 'are you accepting new patients?', history: [], isObjection: false,
    });
    expect(r.mode).toBe('GROUNDED_EXTRACTIVE');
    expect(r.content.toLowerCase()).toContain('new nhs patients');
  });

  it('still refuses what the single document does not cover', async () => {
    const r = await answerWithBestAvailableMode({
      profile: getProfile(A)!, workspaceId: A,
      text: 'do you do teeth whitening and how much is it?', history: [], isObjection: false,
    });
    expect(r.mode).toBe('NO_KNOWLEDGE');
    expect(r.content).not.toMatch(/£|\$\d/);
  });

  it('publishes, authorizes one domain, and produces a working public identity', () => {
    const { publicKey } = setPublished(A, true);
    expect(getProfileByPublicKey(publicKey!)?.workspace_id).toBe(A);
    const r = setAllowedOrigins(A, ['https://alderdental.example']);
    expect(r.accepted).toEqual(['https://alderdental.example']);
    expect(r.rejected).toEqual([]);
  });

  it('handles an objection and a callback request on the same tiny corpus', async () => {
    const started = startConversation({ workspaceId: A, channel: 'WEB' })!;
    const objection = await handleTurn({
      workspaceId: A, conversationId: started.conversationId,
      text: 'private dentistry seems expensive, why should I bother?',
    }) as any;
    expect(objection.reply.content).not.toMatch(/£\d|\$\d/);

    const callback = await handleTurn({
      workspaceId: A, conversationId: started.conversationId,
      text: 'can someone call me on Tuesday to arrange it?',
    }) as any;
    expect(callback.action.kind).toBe('FOLLOW_UP_REQUEST');
    expect(callback.reply.content.toLowerCase()).toContain("can't book");
  });
});

describe('2: two businesses on one install cannot see each other', () => {
  beforeAll(() => {
    saveProfile({
      workspace_id: B, business_name: 'Brightwater Plumbing', assistant_name: 'Sam',
      business_description: 'Brightwater Plumbing handles emergency leaks and boiler repair.',
      services: ['Emergency leaks', 'Boiler repair'], locations: ['Stockport'],
      contact: { phone: '0161 555 0202' }, escalation_contacts: ['office@example.invalid'],
    } as any);
    addBusinessKnowledge({
      workspaceId: B, title: 'Brightwater Plumbing — Callout',
      content: 'Our emergency callout fee is a flat forty pounds and is waived if the repair proceeds. '
        + 'Engineers carry the twelve most common boiler parts so most repairs finish in one visit.',
    });
    setPublished(B, true);
  });

  it("A's visitor cannot reach B's unique fact", async () => {
    const r = await answerWithBestAvailableMode({
      profile: getProfile(A)!, workspaceId: A,
      text: 'what is your emergency callout fee?', history: [], isObjection: false,
    });
    expect(r.mode).toBe('NO_KNOWLEDGE');
    expect(r.content.toLowerCase()).not.toContain('forty pounds');
    expect(r.content).not.toContain('Brightwater');
  });

  it("B's visitor cannot reach A's unique fact", async () => {
    const r = await answerWithBestAvailableMode({
      profile: getProfile(B)!, workspaceId: B,
      text: 'are you accepting new NHS patients?', history: [], isObjection: false,
    });
    expect(r.mode).toBe('NO_KNOWLEDGE');
    expect(r.content.toLowerCase()).not.toContain('waiting list');
    expect(r.content).not.toContain('Alder');
  });

  it('retrieval itself is scoped, not merely the answer text', () => {
    expect(retrieveBusinessContext(A, 'emergency callout fee flat forty pounds')).toEqual([]);
    expect(retrieveBusinessContext(B, 'new NHS patients waiting list')).toEqual([]);
  });

  it('each business resolves only its own public key', () => {
    const ka = getProfile(A)!.public_key!;
    const kb = getProfile(B)!.public_key!;
    expect(ka).not.toBe(kb);
    expect(getProfileByPublicKey(ka)!.workspace_id).toBe(A);
    expect(getProfileByPublicKey(kb)!.workspace_id).toBe(B);
  });

  it("a conversation started in A is invisible and unusable from B", async () => {
    const started = startConversation({ workspaceId: A, channel: 'WEB' })!;
    await handleTurn({ workspaceId: A, conversationId: started.conversationId, text: 'hello' });

    const fromB = await handleTurn({ workspaceId: B, conversationId: started.conversationId, text: 'hello' }) as any;
    expect(fromB.error).toBeTruthy();
    expect(listConversations(B).some((c: any) => c.conversation_id === started.conversationId)).toBe(false);
    expect(summarizeConversation(B, started.conversationId) as any).toHaveProperty('error');
  });

  it('follow-up tasks and unanswered questions stay in their own workspace', async () => {
    const started = startConversation({ workspaceId: B, channel: 'WEB' })!;
    const r = await handleTurn({
      workspaceId: B, conversationId: started.conversationId, text: 'can you book me in tomorrow?',
    }) as any;
    const task = getDatabase().prepare('SELECT workspace_id FROM tasks WHERE task_id = ?').get(r.action.taskId) as any;
    expect(task.workspace_id).toBe(B);

    await handleTurn({ workspaceId: B, conversationId: started.conversationId, text: 'do you fit solar thermal panels?' });
    expect(listUnansweredQuestions(B).some((q) => q.question.includes('solar thermal'))).toBe(true);
    expect(listUnansweredQuestions(A).some((q) => q.question.includes('solar thermal'))).toBe(false);
  });

  it("an owner's knowledge document never appears in the other tenant's corpus", () => {
    const rowsA = getDatabase().prepare('SELECT workspace_id FROM memory_index WHERE workspace_id = ?').all(A) as any[];
    const rowsB = getDatabase().prepare('SELECT workspace_id FROM memory_index WHERE workspace_id = ?').all(B) as any[];
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsB.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.workspace_id === A)).toBe(true);
    expect(rowsB.every((r) => r.workspace_id === B)).toBe(true);
  });
});

describe('3: the public address a business is told to use', () => {
  const req = (headers: Record<string, string>, protocol = 'http') => ({
    protocol, headers, get: (n: string) => headers[n.toLowerCase()],
  });

  it('behind a TLS-terminating proxy it follows X-Forwarded-Proto, not req.protocol', () => {
    // The exact production bug: Caddy terminates TLS and forwards plain http,
    // so req.protocol is "http" and the business gets a mixed-content snippet.
    const r = resolvePublicBaseUrl(req({ host: 'admin.example.com', 'x-forwarded-proto': 'https' }), { isProduction: true });
    expect(r.origin).toBe('https://admin.example.com');
    expect(r.secure).toBe(true);
    expect(r.warning).toBeNull();
  });

  it('an explicit PUBLIC_BASE_URL beats every inference', () => {
    const prior = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://assistant.example.com';
    try {
      const r = resolvePublicBaseUrl(req({ host: 'internal-container:3000' }), { isProduction: true });
      expect(r.origin).toBe('https://assistant.example.com');
      expect(r.source).toBe('PUBLIC_BASE_URL');
      expect(r.warning).toBeNull();
    } finally {
      if (prior === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = prior;
    }
  });

  it('WARNS in production when it cannot tell it is served over https', () => {
    // Silence here is the whole defect: the business pastes the snippet, the
    // browser blocks it, and nothing explains why.
    const r = resolvePublicBaseUrl(req({ host: 'admin.example.com' }), { isProduction: true });
    expect(r.secure).toBe(false);
    expect(r.warning).toBeTruthy();
    expect(r.warning!.toLowerCase()).toContain('https');
  });

  it('local development is not warned at, and still works', () => {
    const r = resolvePublicBaseUrl(req({ host: 'localhost:3000' }), { isProduction: false });
    expect(r.origin).toBe('http://localhost:3000');
    expect(r.secure).toBe(true);
    expect(r.warning).toBeNull();
  });

  it('a malformed PUBLIC_BASE_URL is reported, never silently ignored', () => {
    const prior = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'not a url';
    try {
      const r = resolvePublicBaseUrl(req({ host: 'admin.example.com' }), { isProduction: true });
      expect(r.origin).toBe('');
      expect(r.warning).toBeTruthy();
    } finally {
      if (prior === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = prior;
    }
  });

  it('the server builds the embed snippet from this resolver, not from req.protocol', () => {
    const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
    const i = serverSrc.indexOf('app.get("/api/business/embed"');
    const slice = serverSrc.slice(i, i + 2000);
    expect(slice).toContain('resolvePublicBaseUrl(req)');
    expect(slice).not.toContain('`${req.protocol}://${req.get("host")}`');
  });
});

describe('4: the model key can be supplied without a redeploy', () => {
  it('reports absent honestly before anything is stored', () => {
    const s = getModelCredentialStatus('gemini');
    expect(s.apiKeyPresent).toBe(false);
    expect(s.source).toBe('none');
    expect(s.envVar).toBe('GEMINI_API_KEY');
  });

  it('a stored key is encrypted at rest and never returned', () => {
    saveModelCredential({ provider: 'gemini', apiKey: 'test-key-value-1234567890', userId: 'u1' });
    const row = getDatabase().prepare('SELECT api_key_encrypted FROM model_credentials WHERE provider = ?').get('gemini') as any;
    expect(row.api_key_encrypted).toBeTruthy();
    expect(row.api_key_encrypted).not.toContain('test-key-value');
    expect(row.api_key_encrypted.split('.').length).toBe(3);   // iv.tag.ciphertext

    const status = getModelCredentialStatus('gemini');
    expect(JSON.stringify(status)).not.toContain('test-key-value');
    expect(status.apiKeyPresent).toBe(true);
    expect(status.source).toBe('server_store');
  });

  it('an environment key always beats a stored one', () => {
    const prior = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'env-key-wins';
    try {
      const r = resolveModelApiKey('gemini');
      expect(r.apiKey).toBe('env-key-wins');
      expect(r.source).toBe('environment');
    } finally {
      if (prior === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prior;
    }
  });

  it('removing the key returns the assistant to extractive answers', async () => {
    deleteModelCredential('gemini');
    expect(getModelCredentialStatus('gemini').apiKeyPresent).toBe(false);
    const r = await answerWithBestAvailableMode({
      profile: getProfile(A)!, workspaceId: A,
      text: 'are you accepting new patients?', history: [], isObjection: false,
    });
    expect(r.mode).toBe('GROUNDED_EXTRACTIVE');
    expect(r.provenance.runtimeNote).toContain('LLM_NOT_CONFIGURED');
  });
});

describe('5: Fish Audio account state is named, not inferred from a lucky success', () => {
  beforeAll(async () => {
    // The state machine only speaks about an account that exists; seed a
    // credential so the NOT_CONFIGURED short-circuit is not what is measured.
    const { saveVoiceCredential } = await import('../lib/voice-credentials');
    saveVoiceCredential({ provider: 'fish_audio', apiKey: 'test-fish-key', referenceId: 'test-voice-ref', userId: 'u1' } as any);
  });

  it('free-tier fallback is its own state, distinct from ready', () => {
    recordFishObservation({ paidCreditExhausted: true, failure: null });
    const s = getFishAccountState();
    expect(s.state).toBe('FREE_TIER_ONLY');
    expect(s.detail.toLowerCase()).toContain('free tier');
    // It must say plainly that this is not a basis to sell voice.
    expect(s.detail.toLowerCase()).toContain('top up');
  });

  it('a paid success reads PRODUCTION_READY', () => {
    recordFishObservation({ paidCreditExhausted: false, failure: null });
    expect(getFishAccountState().state).toBe('PRODUCTION_READY');
  });

  it('a provider failure reads FAILED rather than staying green', () => {
    recordFishObservation({ paidCreditExhausted: false, failure: 'provider returned 502' });
    expect(getFishAccountState().state).toBe('FAILED');
  });
});

describe('6: anonymous resource bounds are real', () => {
  it('the documented limits exist as enforced constants', () => {
    expect(MAX_MESSAGE_CHARS).toBe(4000);
    expect(MAX_CUSTOMER_TURNS).toBeGreaterThan(0);
    expect(MAX_TTS_CHARS).toBeGreaterThan(0);
  });

  it('a conversation cannot be grown without limit', async () => {
    // Every turn re-reads the whole transcript, so the cost of turn N grows
    // with N. A per-request rate limit never catches that; this does.
    const started = startConversation({ workspaceId: A, channel: 'WEB' })!;
    let refusal: any = null;
    for (let i = 0; i < MAX_CUSTOMER_TURNS + 2; i++) {
      const r = await handleTurn({ workspaceId: A, conversationId: started.conversationId, text: `question ${i}` }) as any;
      if (r.error) { refusal = r; break; }
    }
    expect(refusal).toBeTruthy();
    expect(refusal.error.toLowerCase()).toContain('length limit');
  });

  it('the public TTS route caps what it will synthesize', () => {
    const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
    const i = serverSrc.indexOf('app.post("/api/public/assistant/:publicKey/speak"');
    expect(serverSrc.slice(i, i + 3000)).toContain('MAX_TTS_CHARS');
  });
});

describe('7: nothing internal reaches a customer, including in a failure', () => {
  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

  function publicSurface(): string {
    const start = serverSrc.indexOf('app.get("/api/public/assistant/:publicKey"');
    const end = serverSrc.indexOf('app.get("/api/execution/receipts"');
    return serverSrc.slice(start, end);
  }

  it('no public handler returns a stack, path, SQL or provider payload', () => {
    const s = publicSurface();
    for (const leak of ['err.stack', 'error.stack', '__dirname', 'process.cwd()', 'SELECT ', 'providerError }']) {
      expect(s).not.toContain(leak);
    }
  });

  it('the model key is never rendered into the owner UI or returned by a route', () => {
    const view = fs.readFileSync(path.resolve(process.cwd(), 'src/components/BusinessAssistantView.tsx'), 'utf-8');
    // The input is write-only: state is cleared on save and never populated
    // from the server, because the server never sends it.
    expect(view).toContain("type=\"password\"");
    expect(view).toContain("setModelKey('')");
    const cred = fs.readFileSync(path.resolve(process.cwd(), 'lib/model-credentials.ts'), 'utf-8');
    const statusFn = cred.slice(cred.indexOf('export function getModelCredentialStatus'), cred.indexOf('export function saveModelCredential'));
    expect(statusFn).toContain('apiKeyPresent');
    expect(statusFn).not.toContain('apiKey:');
  });

  // UPDATED: this used to assert the literals 'REDACTED' and 'AIza' appeared
  // inside verifyModelCredential, i.e. that it carried its own inline
  // scrubber. That scrubber was consolidated into lib/redact.ts (Pass 2
  // found two divergent copies whose generic floors differed by eight
  // characters, so a ~39-char Google key slipped through one of them).
  //
  // Asserting the BEHAVIOUR rather than the implementation: the function must
  // delegate to the shared scrubber, and that scrubber must actually redact
  // the shapes in question.
  it('a provider verification error is scrubbed of key-shaped tokens', async () => {
    const cred = fs.readFileSync(path.resolve(process.cwd(), 'lib/model-credentials.ts'), 'utf-8');
    const verify = cred.slice(cred.indexOf('export async function verifyModelCredential'));
    expect(verify).toContain('scrubSecrets(');

    const { scrubSecrets } = await import('../lib/redact');
    const googleKey = 'AIzaSyA1234567890abcdefghijklmnopqrstu';
    const openAiKey = 'sk-proj-1234567890abcdefghijklmnopqrstuvwx';
    for (const key of [googleKey, openAiKey]) {
      const out = scrubSecrets(`provider rejected ${key}`);
      expect(out).not.toContain(key);
      expect(out).toContain('REDACTED');
    }
  });
});
