import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Jarvis runtime ownership audit (follow-up to 2f16fad's failover fix).
//
// Question this answers: is Gemini intentionally Jarvis's primary reasoning
// provider, or a hardcoded implementation artifact? Verified answer: Gemini
// is the ONLY real, configured, callable provider anywhere in this codebase
// (no @anthropic-ai/sdk dependency exists in package.json; ANTHROPIC_API_KEY
// is referenced exactly once, as a boolean "configured" flag in Master
// Admin's providers matrix, with zero functional generateContent()-style
// call anywhere). CLAUDE.md's architecture doc names Anthropic Claude as the
// intended default worker and explicitly defers adding ANTHROPIC_API_KEY
// until budget rails exist — so Gemini's role here is a real, working
// implementation detail, not a redesign target for this pass. What WAS a
// real bug: Jarvis's natural-language branch hardcoded "gemini-3.7-flash"
// as a raw string literal, bypassing classifyModelRequest() (the same
// central classifier /api/generate already used) entirely. Fixed: Jarvis
// now resolves its preferred model THROUGH the classifier — same model,
// same behavior today (Gemini is the only configured provider), but Jarvis
// now asks the router instead of assuming the answer.
// ---------------------------------------------------------------------------

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const globalVoiceOverlayContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GlobalVoiceOverlay.tsx'), 'utf-8');
const jarvisViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/JarvisView.tsx'), 'utf-8');
const hermesAdapterContent = fs.readFileSync(path.resolve(process.cwd(), 'src/services/hermesAdapter.ts'), 'utf-8');
const voiceEngineContent = fs.readFileSync(path.resolve(process.cwd(), 'src/services/voiceEngine.ts'), 'utf-8');

function jarvisCommandRouteSlice(): string {
  const idx = serverContent.indexOf('app.post("/api/jarvis/command"');
  expect(idx).toBeGreaterThan(-1);
  const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, nextRoute);
}

describe('1/2/3: Jarvis resolves its model through the central router, not a direct hardcoded provider call', () => {
  it('calls classifyModelRequest() to resolve its preferred model, not a raw string literal fed straight to generateWithFailover', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('classifyModelRequest("gemini-3.7-flash")');
    // The old bug: this exact array literal fed the raw string directly to
    // the failover helper, never touching the classifier.
    expect(slice).not.toContain('["gemini-3.7-flash", ...DEFAULT_CANDIDATE_MODELS]');
  });

  it('uses the classifier\'s resolvedModel, not the literal, to build the candidate list', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('[jarvisClassification.resolvedModel, ...DEFAULT_CANDIDATE_MODELS]');
  });

  it('does not assume the classification is GEMINI without checking — a real UNSUPPORTED classification degrades honestly', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('jarvisClassification.provider !== "GEMINI"');
  });

  it('Jarvis and /api/generate share the exact same classifier import (one central router, not two)', () => {
    expect(serverContent).toMatch(/import \{[^}]*\bclassifyModelRequest\b[^}]*\} from "\.\/lib\/model-router"/);
    const generateIdx = serverContent.indexOf('app.post(["/api/generate"]');
    const generateNextRoute = serverContent.indexOf('\n  app.', generateIdx + 10);
    const generateSlice = serverContent.slice(generateIdx, generateNextRoute);
    expect(generateSlice).toContain('classifyModelRequest(model)');
    // Same shared failover helper on both routes — one router, not a second one.
    expect(jarvisCommandRouteSlice()).toContain('generateWithFailover(candidateModels');
    expect(generateSlice).toContain('generateWithFailover(candidateModels');
  });
});

describe('4: provider fallback still works after the routing fix (2f16fad not regressed)', () => {
  it('Jarvis still builds a multi-candidate list and still calls generateWithFailover with it', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('...DEFAULT_CANDIDATE_MODELS');
    expect(slice).toContain('jarvisFailover = await generateWithFailover(candidateModels');
  });

  it('a failed candidate still throws rather than returning a fabricated empty-response success', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('if (!response.text)');
    expect(slice).toContain('throw new Error("Model returned an empty response.")');
  });
});

describe('5: Hermes\'s role is not misrepresented anywhere in the Jarvis request path', () => {
  it('Jarvis\'s natural-language branch never calls hermesAdapter (Hermes is not currently a model provider for Jarvis)', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).not.toContain('hermesAdapter');
  });

  it('hermesAdapter.execute() is honestly a Phase-1 stub, never a real inference/tool call', () => {
    expect(hermesAdapterContent).toContain('NOT_IMPLEMENTED');
    expect(hermesAdapterContent).toContain('success: false');
    const executeIdx = hermesAdapterContent.indexOf('public async execute(');
    const executeSlice = hermesAdapterContent.slice(executeIdx, executeIdx + 300);
    expect(executeSlice).toContain('NOT_IMPLEMENTED');
  });

  it('hermesAdapter.events() is honestly a no-op, not a real event stream', () => {
    const eventsIdx = hermesAdapterContent.indexOf('public events(');
    const eventsSlice = hermesAdapterContent.slice(eventsIdx, eventsIdx + 300);
    expect(eventsSlice).toContain('No-op for Phase 1');
  });
});

describe('6/7/8: Fish Audio / TTS never fabricates a response and never destroys a real one', () => {
  it('GlobalVoiceOverlay speaks the concise spokenSummary (or an honest fallback), never the full reply text and never a fabricated success claim', () => {
    // P3 (TTS/speech separation): the full `reply` (which can be long
    // narration, a raw diagnostic, or unparsed model output) goes to the
    // transcript/vault only. Only spokenSummary — the concise, spoken-safe
    // counterpart /api/jarvis/command now returns alongside reply — ever
    // reaches speakText.
    expect(globalVoiceOverlayContent).not.toContain('"Directive dispatched successfully."');
    expect(globalVoiceOverlayContent).toContain('await speakText(spokenSummary || `${target.toUpperCase()} directive complete — see the response log.`, voiceConfig)');
    expect(globalVoiceOverlayContent).not.toMatch(/await speakText\(reply\b/);
  });

  it('TTS playback happens after the real reply is already logged to the transcript, never before/instead of it', () => {
    const logIdx = globalVoiceOverlayContent.indexOf('setTranscriptLogs(prev => [...prev, {');
    const ttsIdx = globalVoiceOverlayContent.indexOf('await speakText(spokenSummary');
    expect(logIdx).toBeGreaterThan(-1);
    expect(ttsIdx).toBeGreaterThan(logIdx);
  });

  it('a TTS failure is caught and does not throw back up through the directive-dispatch flow (the real text response already landed)', () => {
    const ttsIdx = globalVoiceOverlayContent.indexOf('setIsSpeaking(true);\n      try {\n        const voiceConfig');
    expect(ttsIdx).toBeGreaterThan(-1);
    const slice = globalVoiceOverlayContent.slice(ttsIdx, ttsIdx + 400);
    expect(slice).toContain('catch (err) {');
    expect(slice).toContain('console.warn("TTS playback fallback:", err)');
  });

  it('voiceEngine.speakText() falls back to Web Speech on any real TTS failure, never silently dropping the text', () => {
    expect(voiceEngineContent).toContain('return playWebSpeech(text, config.speed)');
    // Every real failure branch (bad response, wrong content-type, empty blob, playback error) falls back — never just swallows the text.
    const fallbackCount = (voiceEngineContent.match(/playWebSpeech\(text, config\.speed\)/g) || []).length;
    expect(fallbackCount).toBeGreaterThanOrEqual(4);
  });

  it('JarvisView\'s local speakText also falls back through providers on failure rather than losing the response', () => {
    expect(jarvisViewContent).toContain('fallbackBrowserSpeak(text)');
  });
});

describe('9: the actual resolved provider/model is surfaced in the real API response and activity ledger', () => {
  it('the success response includes the real modelUsed and fallbackUsed fields', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('modelUsed: jarvisFailover?.modelUsed');
    expect(slice).toContain('fallbackUsed: jarvisFailover?.fallbackUsed');
  });

  it('the activity ledger records the requested vs. actual model and whether fallback occurred', () => {
    const slice = jarvisCommandRouteSlice();
    expect(slice).toContain('requestedModel: jarvisFailover?.requestedModel');
    expect(slice).toContain('modelUsed: jarvisFailover?.modelUsed');
    expect(slice).toContain('fallbackUsed: jarvisFailover?.fallbackUsed ?? false');
  });
});

describe('Gemini is a real, configured, callable provider — not an invented one (DO NOT invent provider availability)', () => {
  it('package.json depends on the real Gemini SDK', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    expect(pkg.dependencies['@google/genai']).toBeTruthy();
  });

  it('no Anthropic SDK dependency exists — Anthropic is not a real, callable provider in this codebase today', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    expect(pkg.dependencies['@anthropic-ai/sdk']).toBeUndefined();
  });

  it('ANTHROPIC_API_KEY appears only as a configuration-presence flag (Master Admin providers matrix), never in a real inference call', () => {
    const matches = serverContent.match(/ANTHROPIC_API_KEY/g) || [];
    expect(matches.length).toBe(1);
    expect(serverContent).toContain('configured: !!process.env.ANTHROPIC_API_KEY');
  });
});
