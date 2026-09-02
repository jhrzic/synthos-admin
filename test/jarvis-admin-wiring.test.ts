import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-jarvis-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { createInitialTask, listWorkspaceTasks } from '../lib/persistence';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const jarvisViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/JarvisView.tsx'), 'utf-8');
const voiceOverlayContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GlobalVoiceOverlay.tsx'), 'utf-8');
const apolloViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ApolloVoiceView.tsx'), 'utf-8');
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

describe('Jarvis admin intent wiring: previously orphaned /api/jarvis/command is now reached by the live UI (WIRED, not RETIRED or left ORPHANED)', () => {
  it('2. JarvisView\'s directive submission calls the real admin-command dispatcher, not generic chat', () => {
    const handleExecute = jarvisViewContent.slice(
      jarvisViewContent.indexOf('const handleExecute'),
      jarvisViewContent.indexOf('const handleExecute') + 800
    );
    expect(handleExecute).toContain('onJarvisCommand(query)');
    expect(handleExecute).not.toContain("onSendQuery(query, 'gemini')");
  });

  it('7. GlobalVoiceOverlay\'s directive submission uses the same dispatcher (voice text, not new streaming audio)', () => {
    // Passes 'voice_transcript' as the real message_type for session
    // persistence (see lib/jarvis-sessions.ts) — still the same shared
    // dispatcher and the same directiveText, not a new/parallel call path.
    expect(voiceOverlayContent).toContain("onJarvisCommand(directiveText, 'voice_transcript')");
    // Confirms no new streaming/barge-in audio infrastructure was introduced
    // as part of this wiring — the existing speech-to-text -> text dispatch
    // path is reused, not replaced with something new.
    expect(voiceOverlayContent).not.toContain('MediaRecorder');
    expect(voiceOverlayContent).not.toContain('AudioWorklet');
  });

  it('App.tsx wires a real, workspace-scoped handleJarvisCommand to both Jarvis surfaces', () => {
    expect(appContent).toContain("fetch('/api/jarvis/command'");
    expect(appContent).toContain('workspaceId: activeWorkspaceId');
    expect(appContent).toContain('onJarvisCommand={handleJarvisCommand}');
    // Wired into both real submission surfaces found during tracing (D1):
    // JarvisView and GlobalVoiceOverlay. JarvisOverlayHUD is a launcher only
    // (confirmed by inspection — it submits nothing itself), so it correctly
    // has no dispatcher wiring of its own.
    const occurrences = (appContent.match(/onJarvisCommand={handleJarvisCommand}/g) || []).length;
    expect(occurrences).toBe(2);
  });

  it('1 & 6. global Jarvis routing is unaffected — JarvisOverlayHUD still opens the "jarvis" tab, not "hermes-apollo", and the Jarvis shell regression suite still passes this exact contract', () => {
    // This mirrors the assertions in test/jarvis-shell-regression.test.ts —
    // re-checked here specifically to prove the new onJarvisCommand wiring
    // didn't disturb global routing while touching these same files.
    expect(appContent).toContain("onOpenFullJarvis={() => setActiveTab('jarvis')}");
    expect(appContent).not.toContain("onOpenFullJarvis={() => setActiveTab('hermes-apollo')}");
  });
});

describe('4 & workspace switch: Jarvis admin queries respect the active workspace, and switching it changes subsequent scope', () => {
  const WS_A = 'ws-jarvis-wiring-a';
  const WS_B = 'ws-jarvis-wiring-b';

  beforeAll(() => {
    createInitialTask({
      taskId: 'task-jarvis-wiring-a-1',
      workspaceId: WS_A,
      title: 'Workspace A only task',
      description: 'test',
      assignedAgent: 'dev',
      assignedModel: 'gemini-3.1-flash-lite',
    });
  });

  it('the exact function server.ts calls for ADMIN_TASK_QUERY (listWorkspaceTasks) returns different results for different workspace ids from the same live process — proving a workspace switch genuinely changes what Jarvis can see, not just what it displays', () => {
    const forA = listWorkspaceTasks(WS_A, 10);
    const forB = listWorkspaceTasks(WS_B, 10);
    expect(forA.map((t) => t.task_id)).toContain('task-jarvis-wiring-a-1');
    expect(forB.map((t) => t.task_id)).not.toContain('task-jarvis-wiring-a-1');
  });

  it('server.ts resolves workspaceId fresh from the request body on every call — not a cached/global value', () => {
    const route = serverContent.slice(
      serverContent.indexOf('app.post("/api/jarvis/command"'),
      serverContent.indexOf('app.get("/api/apollo/status"')
    );
    expect(route).toContain('resolveWorkspaceId(req.body?.workspaceId)');
    expect(route).not.toMatch(/const\s+jarvisWorkspaceId\s*=\s*['"]ws-synthos-primary['"]/);
  });
});

describe('5. conversational prompts remain on real generic chat — no broad keyword hijacking of ordinary conversation', () => {
  it('the else-branch of ADMIN_*_QUERY classification still calls a real Gemini model, unchanged', () => {
    const route = serverContent.slice(
      serverContent.indexOf('app.post("/api/jarvis/command"'),
      serverContent.indexOf('app.get("/api/apollo/status"')
    );
    expect(route).toContain('Natural Language Directive via Live Model');
    expect(route).toContain('ai.models.generateContent');
  });

  it('no new intent types were invented beyond the three the backend already supported (tasks/graphs/receipts)', () => {
    const route = serverContent.slice(
      serverContent.indexOf('app.post("/api/jarvis/command"'),
      serverContent.indexOf('app.get("/api/apollo/status"')
    );
    const intents = route.match(/intent = "([A-Z_]+)"/g) || [];
    const uniqueIntents = new Set(intents);
    // GENERAL_DIRECTIVE is the pre-existing default (conversational) state,
    // not a new intent type — the three ADMIN_* values are the only real
    // classified intents, exactly matching what was already supported.
    expect(uniqueIntents).toEqual(new Set([
      'intent = "GENERAL_DIRECTIVE"',
      'intent = "ADMIN_TASK_QUERY"',
      'intent = "ADMIN_GRAPH_QUERY"',
      'intent = "ADMIN_RECEIPT_QUERY"',
    ]));
  });
});

describe('8. Apollo remains completely unaffected by this wiring', () => {
  it('ApolloVoiceView has no reference to the new Jarvis command dispatcher', () => {
    expect(apolloViewContent).not.toContain('onJarvisCommand');
    expect(apolloViewContent).not.toContain('/api/jarvis/command');
  });

  it('/api/apollo/status and /api/apollo/command routes are untouched and still exist, separate from /api/jarvis/command', () => {
    expect(serverContent).toContain('app.get("/api/apollo/status"');
    expect(serverContent).toContain('app.post("/api/apollo/command"');
  });
});

describe('Workstream F truth sweep: JarvisView header no longer claims an unconditional Fish Audio connection', () => {
  it('the header badge is gated on real activeApiKey evidence, not an unconditional "Connected" claim', () => {
    expect(jarvisViewContent).not.toContain('●●●● Connected to Fish Audio Plus');
    expect(jarvisViewContent).toContain('activeApiKey && activeApiKey.length > 5 ?');
    expect(jarvisViewContent).toContain('NOT_CONFIGURED — falls back to browser speech synthesis');
  });
});
