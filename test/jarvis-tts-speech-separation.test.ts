import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// P3 — TTS/speech separation. Before this change, GlobalVoiceOverlay and
// JarvisView both called speakText(reply) — the exact same string shown in
// the transcript, which could be long narration ("To accomplish this, I
// will..."), a raw [STATUS: DEGRADED - ...] diagnostic, or (on a JSON-
// contract miss from the model) unparsed raw JSON. All of that got read
// aloud verbatim.
//
// The fix: /api/jarvis/command now returns `spokenSummary` alongside
// `reply` — a concise, spoken-safe counterpart the model is asked to
// produce via structured JSON output (server.ts), with a short honest
// fallback on a degraded/parse-failure outcome. Only spokenSummary ever
// reaches speakText(); reply stays exactly what it was for the transcript,
// vault notes, and activity ledger.
//
// This repo has no separate "Executing..."/"Researching..." live-status
// broadcast and no approval-request voice path today — nothing to assert
// against for those two items on the task's own checklist; noted rather
// than fabricating coverage for code that doesn't exist.
// ---------------------------------------------------------------------------

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
const globalVoiceOverlayContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GlobalVoiceOverlay.tsx'), 'utf-8');
const jarvisViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/JarvisView.tsx'), 'utf-8');

function jarvisCommandRouteSlice(): string {
  const idx = serverContent.indexOf('app.post("/api/jarvis/command"');
  expect(idx).toBeGreaterThan(-1);
  const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, nextRoute);
}

describe('1/3: only the concise spokenSummary ever reaches speakText — never the full reply', () => {
  it('GlobalVoiceOverlay never calls speakText with `reply`', () => {
    expect(globalVoiceOverlayContent).not.toMatch(/speakText\(\s*reply\b/);
    expect(globalVoiceOverlayContent).toContain('await speakText(spokenSummary ||');
  });

  it('JarvisView never calls speakText with the raw `reply` returned from onJarvisCommand', () => {
    // The only speakText(reply...) call in this file must not be the one
    // fed by executeDirective's destructured `reply` — it must use the
    // derived `spoken` (spokenSummary-or-fallback) local instead.
    const idx = jarvisViewContent.indexOf('const { reply, spokenSummary } = await onJarvisCommand(query);');
    expect(idx).toBeGreaterThan(-1);
    const slice = jarvisViewContent.slice(idx, idx + 1000);
    expect(slice).toContain('speakText(spoken)');
    expect(slice).not.toMatch(/speakText\(reply\)/);
  });

  it('JarvisView\'s manual "TEST AUDIO TTS" button also speaks the spoken-safe state, not the full displayed reply', () => {
    expect(jarvisViewContent).toContain('onClick={() => speakText(activeSpokenSummary)}');
    expect(jarvisViewContent).not.toContain('onClick={() => speakText(activeVoiceResponse)}');
  });
});

describe('2: internal planning narration is instructed out of spokenSummary at the source', () => {
  it('the Jarvis system instruction explicitly forbids planning-narration and unsolicited follow-up offers in spokenSummary', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toMatch(/spokenSummary/);
    expect(slice).toMatch(/never phrases like "To accomplish this, I will|planning narration/);
    expect(slice).toMatch(/Would you like me to/);
  });

  it('the model is asked for structured JSON output, not free-form prose, on the natural-language branch', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('responseMimeType: "application/json"');
  });
});

describe('4: approval-required actions are out of scope for this pass — no such path exists to route through TTS yet', () => {
  it('sanity: no dedicated approval-request voice path exists in the Jarvis command route (documents the current absence rather than asserting nothing)', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).not.toContain('APPROVAL_REQUIRED');
  });
});

describe('5: a degraded/failed outcome gets a short honest spoken line, never the raw diagnostic text', () => {
  it('server.ts sets a human spokenSummary for a degraded response, distinct from the raw error/reason fields', () => {
    const slice = jarvisCommandRouteSlice();
    const degradedIdx = slice.indexOf('if (degraded) {\n        spokenSummary =');
    expect(degradedIdx).toBeGreaterThan(-1);
    const degradedSlice = slice.slice(degradedIdx, degradedIdx + 400);
    expect(degradedSlice).not.toContain('degraded.error');
    expect(degradedSlice).toMatch(/I can't process that/);
  });

  it('client-side network-failure branches also set a short honest spokenSummary, never the raw err.message', () => {
    const idx = appContent.indexOf('const handleJarvisCommand');
    const slice = appContent.slice(idx, idx + 3500);
    expect(slice).toContain("spokenSummary = \"I can't reach SynthOS right now.\"");
    // The catch block sets spokenSummary to the fixed string above, not to err.message.
    const catchIdx = slice.indexOf('} catch (err: any) {');
    const catchSlice = slice.slice(catchIdx, catchIdx + 300);
    expect(catchSlice).not.toMatch(/spokenSummary = err/);
  });

  it('a JSON-contract miss (model did not return the requested shape) falls back reply-only, never speaks the raw unparsed text', () => {
    const slice = jarvisCommandRouteSlice();
    const catchIdx = slice.indexOf('} catch {');
    expect(catchIdx).toBeGreaterThan(-1);
    const catchSlice = slice.slice(catchIdx, catchIdx + 500);
    expect(catchSlice).toContain('reply = rawText;');
    expect(catchSlice).toContain('spokenSummary = null;');
  });
});

describe('6: the full reply/artifact text is never automatically spoken — only ever shown', () => {
  it('the dialogue-bubble display still renders the full activeVoiceResponse (reply), separate from what gets spoken', () => {
    expect(jarvisViewContent).toContain('"{activeVoiceResponse}"');
  });

  it('reply and spokenSummary are two distinct fields in the API response, never collapsed into one', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toMatch(/reply,\s*\n\s*spokenSummary,/);
  });
});
