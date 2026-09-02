import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-jsessions-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createJarvisSession,
  listWorkspaceJarvisSessions,
  getWorkspaceJarvisSession,
  listSessionMessages,
  appendJarvisMessage,
} from '../lib/jarvis-sessions';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

const WS_A = 'ws-jsessions-a';
const WS_B = 'ws-jsessions-b';

describe('lib/jarvis-sessions: creation, append, resume (1, 2, 3)', () => {
  it('a created session is real and retrievable', () => {
    const session = createJarvisSession(WS_A);
    expect(getWorkspaceJarvisSession(WS_A, session.session_id)?.session_id).toBe(session.session_id);
  });

  it('appendJarvisMessage persists a real message and it appears on resume (listSessionMessages)', () => {
    const session = createJarvisSession(WS_A);
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'user', content: 'show my tasks' });
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'assistant', content: 'Found 3 tasks.' });

    const messages = listSessionMessages(WS_A, session.session_id);
    expect(messages).not.toBeNull();
    expect(messages!.length).toBe(2);
    expect(messages![0].role).toBe('user');
    expect(messages![0].content).toBe('show my tasks');
    expect(messages![1].role).toBe('assistant');
  });

  it('the session title is derived from the first real user message, never fabricated', () => {
    const session = createJarvisSession(WS_A);
    expect(getWorkspaceJarvisSession(WS_A, session.session_id)?.title).toBeNull();
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'user', content: 'what is the status of the graph runtime' });
    expect(getWorkspaceJarvisSession(WS_A, session.session_id)?.title).toBe('what is the status of the graph runtime');
  });
});

describe('lib/jarvis-sessions: workspace isolation (4)', () => {
  it('Workspace A cannot list or resume Workspace B\'s sessions', () => {
    const sessionB = createJarvisSession(WS_B, 'B-only session');
    appendJarvisMessage({ workspaceId: WS_B, sessionId: sessionB.session_id, role: 'user', content: 'secret to B' });

    expect(listWorkspaceJarvisSessions(WS_A).map((s) => s.session_id)).not.toContain(sessionB.session_id);
    expect(getWorkspaceJarvisSession(WS_A, sessionB.session_id)).toBeNull();
    expect(listSessionMessages(WS_A, sessionB.session_id)).toBeNull();
  });
});

describe('lib/jarvis-sessions: admin command and conversational responses both stored (5, 6)', () => {
  it('an admin-intent directive and its visible response are stored exactly as shown on screen', () => {
    const session = createJarvisSession(WS_A);
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'user', content: 'list tasks', messageType: 'text' });
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'assistant', content: 'Found 2 active agent tasks in workspace ws-jsessions-a: ...' });
    const messages = listSessionMessages(WS_A, session.session_id)!;
    expect(messages[0].message_type).toBe('text');
    expect(messages[1].content).toContain('Found 2 active agent tasks');
  });

  it('an ordinary conversational directive and reply are stored the same way', () => {
    const session = createJarvisSession(WS_A);
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'user', content: 'what is SynthOS' });
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'assistant', content: 'SynthOS is an agentic marketing OS.' });
    expect(listSessionMessages(WS_A, session.session_id)!.length).toBe(2);
  });
});

describe('lib/jarvis-sessions: voice transcripts share the same session (7)', () => {
  it('a voice_transcript message type is stored in the same session as text messages, no separate audio store', () => {
    const session = createJarvisSession(WS_A);
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'user', content: 'typed directive', messageType: 'text' });
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'user', content: 'spoken directive converted to text', messageType: 'voice_transcript' });
    const messages = listSessionMessages(WS_A, session.session_id)!;
    expect(messages.map((m) => m.message_type)).toEqual(['text', 'voice_transcript']);
  });
});

describe('lib/jarvis-sessions: no hidden reasoning, safe failure (8, 9)', () => {
  it('only role/content/message_type/provider/model are ever stored — no chain-of-thought field exists on the record shape', () => {
    const session = createJarvisSession(WS_A);
    const message = appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'assistant', content: 'a real reply' });
    const keys = Object.keys(message!).sort();
    expect(keys).toEqual(['content', 'created_at', 'message_id', 'message_type', 'model', 'provider', 'role', 'session_id', 'workspace_id']);
  });

  it('appendJarvisMessage against a nonexistent session returns null, not a fabricated message', () => {
    expect(appendJarvisMessage({ workspaceId: WS_A, sessionId: 'jsess-does-not-exist', role: 'user', content: 'x' })).toBeNull();
  });

  it('getWorkspaceJarvisSession against an unknown id returns null', () => {
    expect(getWorkspaceJarvisSession(WS_A, 'jsess-nope')).toBeNull();
  });

  it('listSessionMessages against an unknown session returns null, not an empty array masquerading as "found but empty"', () => {
    expect(listSessionMessages(WS_A, 'jsess-nope')).toBeNull();
  });
});

describe('lib/jarvis-sessions: recent sessions reflect real derived stats (10)', () => {
  it('listWorkspaceJarvisSessions returns real messageCount and lastMessagePreview, not hardcoded values', () => {
    const session = createJarvisSession(WS_A);
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'user', content: 'first' });
    appendJarvisMessage({ workspaceId: WS_A, sessionId: session.session_id, role: 'assistant', content: 'second reply' });

    const list = listWorkspaceJarvisSessions(WS_A);
    const found = list.find((s) => s.session_id === session.session_id);
    expect(found?.messageCount).toBe(2);
    expect(found?.lastMessagePreview).toBe('second reply');
  });
});
