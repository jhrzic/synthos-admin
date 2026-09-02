import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-jsessions-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createJarvisSession,
  listUserJarvisSessions,
  getOwnedJarvisSession,
  listSessionMessages,
  appendJarvisMessage,
} from '../lib/jarvis-sessions';
import { createUser } from '../lib/auth';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

const WS_A = 'ws-jsessions-a';
const WS_B = 'ws-jsessions-b';

const userA = createUser({ email: 'jsess-user-a@example.com', password: 'password-a-1234', displayName: 'UserA' });
const userB = createUser({ email: 'jsess-user-b@example.com', password: 'password-b-1234', displayName: 'UserB' });

describe('lib/jarvis-sessions: creation, append, resume (1, 2, 3)', () => {
  it('a created session is real, owned by its creator, and retrievable', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    expect(getOwnedJarvisSession(WS_A, userA.user_id, session.session_id)?.session_id).toBe(session.session_id);
    expect(session.user_id).toBe(userA.user_id);
  });

  it('appendJarvisMessage persists a real message and it appears on resume (listSessionMessages)', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'show my tasks' });
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'assistant', content: 'Found 3 tasks.' });

    const messages = listSessionMessages(WS_A, userA.user_id, session.session_id);
    expect(messages).not.toBeNull();
    expect(messages!.length).toBe(2);
    expect(messages![0].role).toBe('user');
    expect(messages![0].content).toBe('show my tasks');
    expect(messages![1].role).toBe('assistant');
  });

  it('the session title is derived from the first real user message, never fabricated', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    expect(getOwnedJarvisSession(WS_A, userA.user_id, session.session_id)?.title).toBeNull();
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'what is the status of the graph runtime' });
    expect(getOwnedJarvisSession(WS_A, userA.user_id, session.session_id)?.title).toBe('what is the status of the graph runtime');
  });
});

describe('lib/jarvis-sessions: workspace isolation (4)', () => {
  it('a session in Workspace B is invisible under Workspace A even for the same user', () => {
    const sessionB = createJarvisSession(WS_B, userA.user_id, 'B-only session');
    appendJarvisMessage({ workspaceId: WS_B, userId: userA.user_id, sessionId: sessionB.session_id, role: 'user', content: 'secret to B' });

    expect(listUserJarvisSessions(WS_A, userA.user_id).map((s) => s.session_id)).not.toContain(sessionB.session_id);
    expect(getOwnedJarvisSession(WS_A, userA.user_id, sessionB.session_id)).toBeNull();
    expect(listSessionMessages(WS_A, userA.user_id, sessionB.session_id)).toBeNull();
  });
});

describe('lib/jarvis-sessions: user ownership — same workspace, different user (Pass III / J1)', () => {
  it('User B cannot resume User A\'s session even though both are real members of the same workspace', () => {
    const sessionA = createJarvisSession(WS_A, userA.user_id, 'A-private session');
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: sessionA.session_id, role: 'user', content: 'private to A' });

    expect(getOwnedJarvisSession(WS_A, userB.user_id, sessionA.session_id)).toBeNull();
    expect(listSessionMessages(WS_A, userB.user_id, sessionA.session_id)).toBeNull();
    expect(listUserJarvisSessions(WS_A, userB.user_id).map((s) => s.session_id)).not.toContain(sessionA.session_id);
  });

  it('User B cannot append a message into User A\'s session', () => {
    const sessionA = createJarvisSession(WS_A, userA.user_id);
    const result = appendJarvisMessage({ workspaceId: WS_A, userId: userB.user_id, sessionId: sessionA.session_id, role: 'user', content: 'injected by B' });
    expect(result).toBeNull();
    expect(listSessionMessages(WS_A, userA.user_id, sessionA.session_id)!.length).toBe(0);
  });

  it('each user\'s session list contains only their own sessions in a shared workspace', () => {
    createJarvisSession(WS_A, userA.user_id, 'A one');
    createJarvisSession(WS_A, userA.user_id, 'A two');
    createJarvisSession(WS_A, userB.user_id, 'B one');

    const aSessions = listUserJarvisSessions(WS_A, userA.user_id);
    const bSessions = listUserJarvisSessions(WS_A, userB.user_id);
    expect(aSessions.every((s) => s.user_id === userA.user_id)).toBe(true);
    expect(bSessions.every((s) => s.user_id === userB.user_id)).toBe(true);
  });
});

describe('lib/jarvis-sessions: admin command and conversational responses both stored (5, 6)', () => {
  it('an admin-intent directive and its visible response are stored exactly as shown on screen', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'list tasks', messageType: 'text' });
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'assistant', content: 'Found 2 active agent tasks in workspace ws-jsessions-a: ...' });
    const messages = listSessionMessages(WS_A, userA.user_id, session.session_id)!;
    expect(messages[0].message_type).toBe('text');
    expect(messages[1].content).toContain('Found 2 active agent tasks');
  });

  it('an ordinary conversational directive and reply are stored the same way', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'what is SynthOS' });
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'assistant', content: 'SynthOS is an agentic marketing OS.' });
    expect(listSessionMessages(WS_A, userA.user_id, session.session_id)!.length).toBe(2);
  });
});

describe('lib/jarvis-sessions: voice transcripts share the same session (7)', () => {
  it('a voice_transcript message type is stored in the same session as text messages, no separate audio store', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'typed directive', messageType: 'text' });
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'spoken directive converted to text', messageType: 'voice_transcript' });
    const messages = listSessionMessages(WS_A, userA.user_id, session.session_id)!;
    expect(messages.map((m) => m.message_type)).toEqual(['text', 'voice_transcript']);
  });
});

describe('lib/jarvis-sessions: no hidden reasoning, safe failure (8, 9)', () => {
  it('only role/content/message_type/provider/model are ever stored — no chain-of-thought field exists on the record shape', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    const message = appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'assistant', content: 'a real reply' });
    const keys = Object.keys(message!).sort();
    expect(keys).toEqual(['content', 'created_at', 'message_id', 'message_type', 'model', 'provider', 'role', 'session_id', 'workspace_id']);
  });

  it('appendJarvisMessage against a nonexistent session returns null, not a fabricated message', () => {
    expect(appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: 'jsess-does-not-exist', role: 'user', content: 'x' })).toBeNull();
  });

  it('getOwnedJarvisSession against an unknown id returns null', () => {
    expect(getOwnedJarvisSession(WS_A, userA.user_id, 'jsess-nope')).toBeNull();
  });

  it('listSessionMessages against an unknown session returns null, not an empty array masquerading as "found but empty"', () => {
    expect(listSessionMessages(WS_A, userA.user_id, 'jsess-nope')).toBeNull();
  });
});

describe('lib/jarvis-sessions: recent sessions reflect real derived stats (10)', () => {
  it('listUserJarvisSessions returns real messageCount and lastMessagePreview, not hardcoded values', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'first' });
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'assistant', content: 'second reply' });

    const list = listUserJarvisSessions(WS_A, userA.user_id);
    const found = list.find((s) => s.session_id === session.session_id);
    expect(found?.messageCount).toBe(2);
    expect(found?.lastMessagePreview).toBe('second reply');
  });
});
