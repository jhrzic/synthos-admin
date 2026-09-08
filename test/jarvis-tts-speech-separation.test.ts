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
// This repo still has no separate "Executing..."/"Researching..." live-status
// broadcast (UI may show that text; Fish Audio never speaks it — see
// Step 6). A real approval-required voice path was added in Step 6 (see
// the "4 (STEP 6)" describe block below) — the exact canonical spoken
// lines for SUCCESS/BLOCKED/APPROVAL are asserted there.
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
    // derived `spoken` (spokenSummary-or-fallback) local instead. STEP 6
    // (B2) inserted a null-check (a duplicate-submission no-op) between
    // the onJarvisCommand() call and the destructure, so the search
    // anchors on the call itself, not the exact original destructure line.
    const idx = jarvisViewContent.indexOf('const result = await onJarvisCommand(query);');
    expect(idx).toBeGreaterThan(-1);
    const slice = jarvisViewContent.slice(idx, idx + 1200);
    expect(slice).toContain('const { reply, spokenSummary } = result;');
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

describe('4 (STEP 6): a real approval-required voice path now exists, with the exact canonical short spoken line — no execution, no raw reason text spoken', () => {
  it('APPROVAL_REQUIRED_ACTION sets the exact canonical spokenSummary, never the classification reason itself', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('intent = "APPROVAL_REQUIRED_ACTION"');
    expect(slice).toContain('spokenSummary = "This action requires approval before I can execute it.";');
  });

  it('BLOCKED_ACTION and a NOT_CONFIGURED/BLOCKED envelope outcome both speak the same short canonical line, never the raw reason', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('intent = "BLOCKED_ACTION"');
    const occurrences = (slice.match(/spokenSummary = "I can't run that yet because the required capability isn't configured\.";/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2); // BLOCKED_ACTION branch + envelope NOT_CONFIGURED/BLOCKED branch
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
    // STEP 6 (B2) wrapped the original function in a shared in-flight
    // guard (handleJarvisCommand) that delegates to the renamed
    // dispatchJarvisCommand, which still contains this exact logic —
    // anchor on the renamed function so the window isn't pushed out by
    // the guard's own body.
    const idx = appContent.indexOf('const dispatchJarvisCommand');
    expect(idx).toBeGreaterThan(-1);
    const slice = appContent.slice(idx, idx + 4200);
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
