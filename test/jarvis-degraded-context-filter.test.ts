import { describe, it, expect } from 'vitest';
import { selectBoundedContext, isRuntimeFailureOnlyMessage, type JarvisMessageRecord } from '../lib/jarvis-sessions';

// ---------------------------------------------------------------------------
// c2262fd (selectBoundedContext) injects real prior conversation turns back
// into Jarvis's own reasoning context. It never distinguished a pure
// runtime/provider-failure assistant turn (the "[STATUS: DEGRADED - ...]"
// marker src/App.tsx writes when /api/jarvis/command fails) from a real
// reply — so a transient outage got fed back into the model as if it were
// part of the conversation. This file covers the fix: those turns are
// dropped from what re-enters reasoning, while remaining untouched in
// storage/display (this module never touches either).
// ---------------------------------------------------------------------------

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

describe('isRuntimeFailureOnlyMessage', () => {
  it('matches every real DEGRADED marker src/App.tsx actually writes', () => {
    expect(isRuntimeFailureOnlyMessage('[STATUS: DEGRADED - MODEL_RUNTIME_UNAVAILABLE]\nFailed to process request: x\nProvider: gemini')).toBe(true);
    expect(isRuntimeFailureOnlyMessage('[STATUS: DEGRADED - EMPTY_RESPONSE]\nThe model returned no content.\nProvider: gemini')).toBe(true);
    expect(isRuntimeFailureOnlyMessage('[STATUS: DEGRADED - JARVIS_COMMAND_UNAVAILABLE]\nHTTP 503')).toBe(true);
    expect(isRuntimeFailureOnlyMessage('[STATUS: DEGRADED - JARVIS_COMMAND_UNAVAILABLE]\nReason: Network error / API gateway unreachable')).toBe(true);
  });

  it('tolerates leading whitespace (defensive, matches how it is applied)', () => {
    expect(isRuntimeFailureOnlyMessage('  \n[STATUS: DEGRADED - EMPTY_RESPONSE]\n...')).toBe(true);
  });

  it('does NOT match a real reply that merely discusses degraded systems', () => {
    expect(isRuntimeFailureOnlyMessage('Your API is currently degraded because of rate limiting — here is a workaround.')).toBe(false);
  });

  it('does NOT match a substantive partial answer that happens to carry a degraded flag elsewhere in its text', () => {
    // Deliberately not a producer-shaped string: real content first, status
    // mentioned only in passing. Must never be filtered on this basis alone.
    expect(isRuntimeFailureOnlyMessage('Here are the three repos I found. (Note: response quality degraded slightly due to truncation.)')).toBe(false);
  });

  it('does not match a normal user message', () => {
    expect(isRuntimeFailureOnlyMessage('what did I ask you to research earlier?')).toBe(false);
  });
});

describe('selectBoundedContext excludes pure runtime-failure assistant turns from reasoning context', () => {
  it('drops a DEGRADED-only assistant turn, keeps the real turns around it', () => {
    const history: JarvisMessageRecord[] = [
      msg('user', 'Research the latest AI agent repos.', '2026-09-08T10:00:00.000Z'),
      msg('assistant', '[STATUS: DEGRADED - JARVIS_COMMAND_UNAVAILABLE]\nHTTP 503', '2026-09-08T10:00:01.000Z'),
      msg('user', 'try again', '2026-09-08T10:00:05.000Z'),
      msg('assistant', 'Found three actively maintained repos and summarized each below.', '2026-09-08T10:00:06.000Z'),
    ];

    const result = selectBoundedContext(history, 'follow up question');

    expect(result.turns.map((t) => t.content)).toEqual([
      'Research the latest AI agent repos.',
      'try again',
      'Found three actively maintained repos and summarized each below.',
    ]);
    expect(result.priorMessageCount).toBe(3);
  });

  it('a session with only DEGRADED assistant turns yields zero prior context, not a crash', () => {
    const history: JarvisMessageRecord[] = [
      msg('user', 'hello?', '2026-09-08T10:00:00.000Z'),
      msg('assistant', '[STATUS: DEGRADED - MODEL_RUNTIME_UNAVAILABLE]\nReason: timeout', '2026-09-08T10:00:01.000Z'),
    ];

    const result = selectBoundedContext(history, 'current message');

    expect(result.turns.map((t) => t.content)).toEqual(['hello?']);
    expect(result.priorMessageCount).toBe(1);
  });

  it('a real reply is never dropped just because an unrelated DEGRADED turn exists elsewhere in the same session', () => {
    const history: JarvisMessageRecord[] = [
      msg('user', 'what is the project codename?', '2026-09-08T10:00:00.000Z'),
      msg('assistant', 'The codename is Blue Lantern.', '2026-09-08T10:00:01.000Z'),
      msg('user', 'and the deadline?', '2026-09-08T10:00:02.000Z'),
      msg('assistant', '[STATUS: DEGRADED - EMPTY_RESPONSE]\nThe model returned no content.\nProvider: gemini', '2026-09-08T10:00:03.000Z'),
    ];

    const result = selectBoundedContext(history, 'current message');

    expect(result.turns.map((t) => t.content)).toEqual([
      'what is the project codename?',
      'The codename is Blue Lantern.',
      'and the deadline?',
    ]);
  });
});
