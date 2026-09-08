import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

function jarvisCommandRouteSlice(): string {
  const idx = serverContent.indexOf('app.post("/api/jarvis/command"');
  expect(idx).toBeGreaterThan(-1);
  const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, nextRoute);
}

describe('Jarvis conversation memory: server-side wiring is real, not decorative', () => {
  it('the fake "jarvis-global-session" placeholder default is gone', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).not.toContain('jarvis-global-session');
  });

  it('the route resolves the real authenticated user id via the same authority mechanism the sibling session routes use', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('(req as AuthedRequest).authUser?.user_id');
  });

  it('retrieval is gated on the server-resolved workspace and the real authenticated user, never a caller-supplied shortcut', () => {
    const slice = jarvisCommandRouteSlice();
    // listSessionMessages() performs the exact ownership check
    // (getOwnedJarvisSession) internally and returns null on any mismatch —
    // calling it a second time here would be a redundant query, not extra
    // safety, so this route deliberately doesn't (see the comment above the
    // retrieval block in server.ts).
    expect(slice).toContain('listSessionMessages(jarvisWorkspaceId, jarvisUserId, sessionId)');
    expect(slice).toContain('if (history !== null)');
    // The workspace id used is the server-RESOLVED one (resolveWorkspaceId's output), not a raw client-supplied field.
    expect(slice).toContain('const jarvisWorkspaceId = workspaceResolution.workspaceId');
  });

  it('retrieval calls the real store (listSessionMessages) and the real bounding function (selectBoundedContext), not a new memory system', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('listSessionMessages(jarvisWorkspaceId, jarvisUserId, sessionId)');
    expect(slice).toContain('selectBoundedContext(history, trimmed)');
  });

  it('imports selectBoundedContext from the existing lib/jarvis-sessions module — no new memory/context database created', () => {
    expect(serverContent).toMatch(/import \{[^}]*\bselectBoundedContext\b[^}]*\} from "\.\/lib\/jarvis-sessions"/);
  });

  it('12/15: the model request uses native chat-role turns, never flattens history into the system instruction string', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('role: m.role === "assistant" ? "model" : "user"');
    expect(slice).toContain('parts: [{ text: m.content }]');
    // The system instruction itself is a static literal, never built by concatenating history.
    expect(slice).toMatch(/const jarvisSystemInstruction = "You are Jarvis[^"]*";/);
  });

  it('the current message is appended exactly once, as the final turn, separately from retrieved history', () => {
    const slice = jarvisCommandRouteSlice();
    const conversationContentsIdx = slice.indexOf('const conversationContents = [');
    expect(conversationContentsIdx).toBeGreaterThan(-1);
    const constructionSlice = slice.slice(conversationContentsIdx, conversationContentsIdx + 400);
    expect(constructionSlice).toContain('{ role: "user", parts: [{ text: trimmed }] }');
    // Exactly one occurrence of appending `trimmed` as its own turn.
    const occurrences = (constructionSlice.match(/parts: \[\{ text: trimmed \}\]/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('13: the failover helper still receives the full candidate model list — 2f16fad\'s failover logic is untouched', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('jarvisFailover = await generateWithFailover(candidateModels, async (candidateModel)');
    expect(slice).toContain('...DEFAULT_CANDIDATE_MODELS');
  });

  it('14: real provenance (session id, prior message count, context size, strategy, truncation) is returned — never fabricated', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('contextProvenance: {');
    expect(slice).toContain('retrievalStrategy: "bounded_recent_history"');
    expect(slice).toContain('context: contextProvenance');
  });

  it('provenance defaults to contextInjected:false / retrievalStrategy:"none" — never claims context was used when it wasn\'t', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('contextInjected: false,');
    expect(slice).toContain('retrievalStrategy: "none",');
  });

  it('provenance is metadata only — the route never logs the retrieved prior message content itself to the activity ledger', () => {
    const slice = jarvisCommandRouteSlice();
    // The ledger payload includes `context: contextProvenance` (counts/flags) but never the message text field name from JarvisMessageRecord.
    expect(slice).not.toMatch(/payload:[\s\S]{0,400}priorTurns\.map\(\(m\) => m\.content\)/);
  });

  it('11: /api/jarvis/command never calls appendJarvisMessage itself — it cannot fabricate assistant history on provider failure (persistence stays client-driven, only after a real reply exists)', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).not.toContain('appendJarvisMessage(');
  });
});

describe('Jarvis conversation memory: client-side wiring passes the real session id', () => {
  it('handleJarvisCommand sends sessionId to /api/jarvis/command (it did not before this task)', () => {
    const idx = appContent.indexOf('const handleJarvisCommand');
    const slice = appContent.slice(idx, idx + 2000);
    expect(slice).toContain("body: JSON.stringify({ command, workspaceId: activeWorkspaceId, sessionId: sessionId || null })");
  });
});
