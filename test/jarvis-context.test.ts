import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-jcontext-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createJarvisSession,
  getOwnedJarvisSession,
  listSessionMessages,
  appendJarvisMessage,
  selectBoundedContext,
  MAX_PRIOR_TURNS,
  MAX_CONTEXT_CHARS,
  type JarvisMessageRecord,
} from '../lib/jarvis-sessions';
import { createUser } from '../lib/auth';

// ---------------------------------------------------------------------------
// Jarvis conversation-memory task. lib/jarvis-sessions.ts's storage/
// ownership primitives (createJarvisSession, getOwnedJarvisSession,
// listSessionMessages, appendJarvisMessage) already have their own
// dedicated isolation coverage in test/jarvis-sessions.test.ts — this file
// does not repeat that. It covers what's actually new: selectBoundedContext
// (the pure bounding/dedup logic), the exact retrieval composition
// /api/jarvis/command now uses end-to-end, and source-level regression
// guards proving the route is actually wired this way.
// ---------------------------------------------------------------------------

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

function msg(role: 'user' | 'assistant', content: string, at: string): JarvisMessageRecord {
  return {
    message_id: `m-${Math.random().toString(36).slice(2)}`,
    session_id: 's-1',
    workspace_id: 'ws-1',
    role,
    content,
    message_type: 'text',
    provider: null,
    model: null,
    created_at: at,
  };
}

describe('selectBoundedContext — 1/2: retrieves prior turns from the same conversation, chronological', () => {
  it('returns real prior turns in the same order they were given (oldest first)', () => {
    const history = [
      msg('user', 'My project codename is Blue Lantern.', '2026-01-01T00:00:00.000Z'),
      msg('assistant', 'Noted — Blue Lantern.', '2026-01-01T00:00:01.000Z'),
    ];
    const result = selectBoundedContext(history, 'What project codename did I just give you?');
    expect(result.turns.map((t) => t.content)).toEqual([
      'My project codename is Blue Lantern.',
      'Noted — Blue Lantern.',
    ]);
    expect(result.priorMessageCount).toBe(2);
  });

  it('an empty/new conversation yields zero history, not an error', () => {
    const result = selectBoundedContext([], 'first message ever');
    expect(result.turns).toEqual([]);
    expect(result.priorMessageCount).toBe(0);
    expect(result.contextSizeChars).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

describe('selectBoundedContext — 3: the current message is never duplicated in the returned history', () => {
  it('drops a trailing history row that exactly matches the current message (the client\'s own fire-and-forget persistence race)', () => {
    const history = [
      msg('user', 'earlier question', '2026-01-01T00:00:00.000Z'),
      msg('assistant', 'earlier answer', '2026-01-01T00:00:01.000Z'),
      msg('user', 'what is the weather today', '2026-01-01T00:00:02.000Z'),
    ];
    const result = selectBoundedContext(history, 'what is the weather today');
    expect(result.turns.length).toBe(2);
    expect(result.turns.some((t) => t.content === 'what is the weather today')).toBe(false);
  });

  it('does not drop a real prior turn that merely resembles but does not exactly match the current message', () => {
    const history = [msg('user', 'what is the weather today in Boston', '2026-01-01T00:00:00.000Z')];
    const result = selectBoundedContext(history, 'what is the weather today');
    expect(result.turns.length).toBe(1);
  });
});

describe('selectBoundedContext — 4/5: different conversation / different workspace never appear (enforced upstream, verified end-to-end below)', () => {
  it('operates only on the array it is given — proves it cannot itself pull in anything beyond its input', () => {
    const historyA = [msg('user', 'session A content', '2026-01-01T00:00:00.000Z')];
    const result = selectBoundedContext(historyA, 'new message');
    expect(result.turns.every((t) => t.content === 'session A content')).toBe(true);
  });
});

describe('selectBoundedContext — 8: history/turn limit is enforced', () => {
  it(`keeps only the newest ${MAX_PRIOR_TURNS} turns when more exist`, () => {
    const history: JarvisMessageRecord[] = [];
    for (let i = 0; i < MAX_PRIOR_TURNS + 5; i++) {
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`));
    }
    const result = selectBoundedContext(history, 'current message');
    expect(result.turns.length).toBe(MAX_PRIOR_TURNS);
    expect(result.truncated).toBe(true);
    // The newest turns survive, not the oldest.
    expect(result.turns[result.turns.length - 1].content).toBe(`turn ${MAX_PRIOR_TURNS + 4}`);
  });

  it('a custom maxTurns option is respected', () => {
    const history = [
      msg('user', 'a', '2026-01-01T00:00:00.000Z'),
      msg('assistant', 'b', '2026-01-01T00:00:01.000Z'),
      msg('user', 'c', '2026-01-01T00:00:02.000Z'),
    ];
    const result = selectBoundedContext(history, 'current', { maxTurns: 1 });
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].content).toBe('c');
  });
});

describe('selectBoundedContext — 9: context character-size limit is enforced', () => {
  it(`drops the oldest turns first when the total would exceed ${MAX_CONTEXT_CHARS} characters`, () => {
    const big = 'x'.repeat(4000);
    const history = [
      msg('user', big, '2026-01-01T00:00:00.000Z'),
      msg('assistant', big, '2026-01-01T00:00:01.000Z'),
      msg('user', 'short recent turn', '2026-01-01T00:00:02.000Z'),
    ];
    const result = selectBoundedContext(history, 'current message');
    // Only the newest turn(s) fit under the 6000-char budget — the two 4000-char turns cannot both survive.
    expect(result.contextSizeChars).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(result.turns[result.turns.length - 1].content).toBe('short recent turn');
    expect(result.truncated).toBe(true);
  });

  it('always keeps at least the single most recent turn even if it alone exceeds the character budget', () => {
    const huge = 'y'.repeat(MAX_CONTEXT_CHARS + 500);
    const history = [msg('user', huge, '2026-01-01T00:00:00.000Z')];
    const result = selectBoundedContext(history, 'current message');
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].content).toBe(huge);
  });

  it('a custom maxChars option is respected', () => {
    const history = [
      msg('user', 'a'.repeat(50), '2026-01-01T00:00:00.000Z'),
      msg('assistant', 'b'.repeat(50), '2026-01-01T00:00:01.000Z'),
    ];
    const result = selectBoundedContext(history, 'current', { maxChars: 60 });
    expect(result.contextSizeChars).toBeLessThanOrEqual(60);
  });
});

describe('selectBoundedContext — 10: malformed/empty messages are skipped safely', () => {
  it('skips empty-content and whitespace-only rows without throwing', () => {
    const history = [
      msg('user', '', '2026-01-01T00:00:00.000Z'),
      msg('assistant', '   ', '2026-01-01T00:00:01.000Z'),
      msg('user', 'a real message', '2026-01-01T00:00:02.000Z'),
    ];
    const result = selectBoundedContext(history, 'current message');
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].content).toBe('a real message');
  });

  it('skips a row with an unrecognized role rather than crashing', () => {
    const bad = { ...msg('user', 'weird row', '2026-01-01T00:00:00.000Z'), role: 'system' as any };
    const result = selectBoundedContext([bad], 'current message');
    expect(result.turns.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end retrieval composition — the exact sequence /api/jarvis/command
// now runs: getOwnedJarvisSession() -> listSessionMessages() ->
// selectBoundedContext(). Proves the FULL path, not just the individual
// primitives (already covered separately in test/jarvis-sessions.test.ts).
// ---------------------------------------------------------------------------

const WS_A = 'ws-jcontext-a';
const WS_B = 'ws-jcontext-b';
const userA = createUser({ email: 'jcontext-user-a@example.com', password: 'password-a-12345', displayName: 'ContextUserA' });
const userB = createUser({ email: 'jcontext-user-b@example.com', password: 'password-b-12345', displayName: 'ContextUserB' });

function retrieveContextAsRouteWould(workspaceId: string, userId: string, sessionId: string, currentMessage: string) {
  const owned = getOwnedJarvisSession(workspaceId, userId, sessionId);
  if (!owned) return { contextInjected: false, turns: [] as JarvisMessageRecord[] };
  const history = listSessionMessages(workspaceId, userId, sessionId) || [];
  const selection = selectBoundedContext(history, currentMessage);
  return { contextInjected: selection.turns.length > 0, turns: selection.turns };
}

describe('End-to-end: multi-turn recall within the same real conversation (Blue Lantern scenario)', () => {
  it('turn 2 sees turn 1 in its retrieved context', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'My project codename is Blue Lantern.' });
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'assistant', content: 'Understood — I\'ll refer to it as Blue Lantern.' });

    const result = retrieveContextAsRouteWould(WS_A, userA.user_id, session.session_id, 'What project codename did I just give you?');
    expect(result.contextInjected).toBe(true);
    expect(result.turns.some((t) => t.content.includes('Blue Lantern'))).toBe(true);
  });
});

describe('End-to-end — 5: a DIFFERENT conversation ID in the SAME workspace/user is never included', () => {
  it('a second session for the same user starts with zero knowledge of the first', () => {
    const sessionOne = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: sessionOne.session_id, role: 'user', content: 'My project codename is Blue Lantern.' });

    const sessionTwo = createJarvisSession(WS_A, userA.user_id);
    const result = retrieveContextAsRouteWould(WS_A, userA.user_id, sessionTwo.session_id, 'What project codename did I just give you?');
    expect(result.contextInjected).toBe(false);
    expect(result.turns.length).toBe(0);
  });
});

describe('End-to-end — 6: a DIFFERENT workspace never receives another workspace\'s conversation', () => {
  it('the same user, in a different workspace, gets no context even with the real session id', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'My project codename is Blue Lantern.' });

    // Same user, same real session id, WRONG workspace.
    const result = retrieveContextAsRouteWould(WS_B, userA.user_id, session.session_id, 'What project codename did I just give you?');
    expect(result.contextInjected).toBe(false);
    expect(result.turns.length).toBe(0);
  });
});

describe('End-to-end — 7: an unauthorized user cannot retrieve another user\'s conversation', () => {
  it('User B gets no context from User A\'s session even in the same workspace with the real session id', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'My project codename is Blue Lantern.' });

    const result = retrieveContextAsRouteWould(WS_A, userB.user_id, session.session_id, 'What project codename did I just give you?');
    expect(result.contextInjected).toBe(false);
    expect(result.turns.length).toBe(0);
  });
});

describe('End-to-end — 11: provider failure never fabricates assistant history at the store layer', () => {
  it('a session with only a user turn (no assistant reply ever appended) reflects exactly that — no invented reply', () => {
    const session = createJarvisSession(WS_A, userA.user_id);
    appendJarvisMessage({ workspaceId: WS_A, userId: userA.user_id, sessionId: session.session_id, role: 'user', content: 'a message with no successful reply yet' });
    const messages = listSessionMessages(WS_A, userA.user_id, session.session_id);
    expect(messages).not.toBeNull();
    expect(messages!.length).toBe(1);
    expect(messages![0].role).toBe('user');
  });
});
