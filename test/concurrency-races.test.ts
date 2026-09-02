import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-races-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { createUser } from '../lib/auth';
import { ensureWorkspace, grantMembership } from '../lib/workspaces';
import { createJarvisSession, appendJarvisMessage, listUserJarvisSessions } from '../lib/jarvis-sessions';
import { recordKilObservation, latestKilObservationForTask, getDatabase } from '../lib/persistence';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

const WS = 'ws-races-test';

// ---------------------------------------------------------------------------
// Pass VIII / Workstream R — a real bug this pass found: two of this
// codebase's "most recent row" queries ordered by `created_at` alone, with
// no tiebreaker, for a `LIMIT 1` pick. `created_at` is a millisecond-
// resolution ISO string; two rows written in the same millisecond (a
// realistic, common case — a message immediately followed by a reply, or a
// fast KIL re-gate) tie, and SQLite's ORDER BY gives no guaranteed
// secondary order on a tie. This deterministically forces that collision
// (rather than hoping two real Date.now() calls happen to land in the same
// millisecond) to prove the `rowid DESC` tiebreaker fix actually works.
// ---------------------------------------------------------------------------

describe('R: statsFor() (jarvis-sessions.ts) picks the genuinely last message on a created_at tie', () => {
  it('two messages sharing an identical created_at still resolve to the one inserted second', () => {
    const user = createUser({ email: 'races-user@example.com', password: 'races-user-pw-1', displayName: 'Races User' });
    ensureWorkspace(WS, 'Races Test Workspace');
    grantMembership(user.user_id, WS, 'admin');

    const session = createJarvisSession(WS, user.user_id);
    const tiedTimestamp = new Date().toISOString();
    appendJarvisMessage({ workspaceId: WS, userId: user.user_id, sessionId: session.session_id, role: 'user', content: 'first', createdAt: tiedTimestamp });
    appendJarvisMessage({ workspaceId: WS, userId: user.user_id, sessionId: session.session_id, role: 'assistant', content: 'second reply', createdAt: tiedTimestamp });

    const list = listUserJarvisSessions(WS, user.user_id);
    const found = list.find((s) => s.session_id === session.session_id);
    expect(found?.messageCount).toBe(2);
    // Without the rowid tiebreaker, SQLite is free to return either row on
    // a created_at tie — this assertion is what actually pins the
    // regression, not just "a preview exists."
    expect(found?.lastMessagePreview).toBe('second reply');
  });
});

describe('R: latestKilObservationForTask() picks the genuinely last observation on a created_at tie', () => {
  it('two observations for the same task sharing an identical created_at still resolve to the second one recorded', () => {
    const taskId = 'task-races-kil-1';
    const checks = {
      no_invented_urls: true, no_invented_prices: true, non_empty: true, no_placeholder_text: true,
      min_length: 1, max_length: 1, structural_completeness: 1, citation_density: 1, directive_term_coverage: 1,
    };

    const first = recordKilObservation({ workspaceId: WS, taskId, checks, attempts: 1 });
    // Force an identical created_at on the second row via direct SQL — the
    // public recordKilObservation() has no createdAt override (unlike
    // recordArtifact/appendJarvisMessage), so this reaches into the same
    // real table the function itself writes to, not a parallel mock.
    const db = getDatabase();
    const second = recordKilObservation({ workspaceId: WS, taskId, checks, attempts: 2 });
    db.prepare('UPDATE kil_observations SET created_at = ? WHERE observation_id = ?')
      .run(first.created_at, second.observation_id);

    const latest = latestKilObservationForTask(WS, taskId);
    expect(latest?.observation_id).toBe(second.observation_id);
    expect(latest?.attempts).toBe(2);
  });
});
