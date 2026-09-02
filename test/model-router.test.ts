import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalizeGeminiModel, classifyModelRequest } from '../lib/model-router';

describe('SYNTHOS PROVIDER IDENTITY RULE: non-Gemini requests must never silently execute on Gemini', () => {
  // --- Real behavioral tests against the actual classifier used at every
  //     server.ts generateContent() call site (not string-presence checks) ---

  it('1. "gemini" resolves to the live Gemini model and is routed to GEMINI', () => {
    const result = classifyModelRequest('gemini');
    expect(result.provider).toBe('GEMINI');
    expect(result.provider === 'GEMINI' && result.resolvedModel).toBe('gemini-3.1-flash-lite');
  });

  it('2. "gemini-3.1-flash-lite" passes through unchanged and is routed to GEMINI', () => {
    const result = classifyModelRequest('gemini-3.1-flash-lite');
    expect(result.provider).toBe('GEMINI');
    expect(result.provider === 'GEMINI' && result.resolvedModel).toBe('gemini-3.1-flash-lite');
  });

  it('3. "claude" is never classified GEMINI and never receives a resolvedModel for GoogleGenAI', () => {
    const result = classifyModelRequest('claude');
    expect(result.provider).not.toBe('GEMINI');
    expect(result.provider).toBe('UNSUPPORTED');
    expect((result as any).resolvedModel).toBeUndefined();
  });

  it('4. "deepseek" is never classified GEMINI', () => {
    const result = classifyModelRequest('deepseek');
    expect(result.provider).not.toBe('GEMINI');
    expect(result.provider).toBe('UNSUPPORTED');
  });

  it('5. "hermes" is never classified GEMINI', () => {
    const result = classifyModelRequest('hermes');
    expect(result.provider).not.toBe('GEMINI');
    expect(result.provider).toBe('UNSUPPORTED');
  });

  it('6. "perplexity" is never classified GEMINI', () => {
    const result = classifyModelRequest('perplexity');
    expect(result.provider).not.toBe('GEMINI');
    expect(result.provider).toBe('UNSUPPORTED');
  });

  it('7. "chatgpt" is never classified GEMINI', () => {
    const result = classifyModelRequest('chatgpt');
    expect(result.provider).not.toBe('GEMINI');
    expect(result.provider).toBe('UNSUPPORTED');
  });

  it('8. a wholly unknown alias fails explicitly as UNSUPPORTED_PROVIDER, not a silent pass-through', () => {
    const result = classifyModelRequest('totally-made-up-model-xyz-123');
    expect(result.provider).toBe('UNSUPPORTED');
    expect(result.provider === 'UNSUPPORTED' && result.reason).toBe('UNSUPPORTED_PROVIDER');
    expect(result.provider === 'UNSUPPORTED' && result.message.length).toBeGreaterThan(0);
  });

  it('9. a recognized-but-unavailable provider fails with a precise, truthful reason (not a generic 500 or a Gemini substitution)', () => {
    for (const alias of ['claude', 'deepseek', 'hermes', 'perplexity', 'chatgpt']) {
      const result = classifyModelRequest(alias);
      expect(result.provider).toBe('UNSUPPORTED');
      expect(result.provider === 'UNSUPPORTED' && result.reason).toBe('MODEL_MAPPING_NOT_FOUND');
      expect(result.provider === 'UNSUPPORTED' && result.requestedModel).toBe(alias);
    }
  });

  it('10a. no silent cross-provider fallback: every non-Gemini alias classification carries no resolvedModel at all', () => {
    for (const alias of ['claude', 'deepseek', 'hermes', 'perplexity', 'chatgpt', 'unknown-thing']) {
      const result = classifyModelRequest(alias);
      expect('resolvedModel' in result).toBe(false);
    }
  });

  it('10b. same-provider fallback within Gemini remains allowed (an unrecognized but clearly Gemini-family id still resolves to GEMINI, unchanged)', () => {
    const result = classifyModelRequest('gemini-9.9-future-preview');
    expect(result.provider).toBe('GEMINI');
    expect(result.provider === 'GEMINI' && result.resolvedModel).toBe('gemini-9.9-future-preview');
  });

  it('case/prefix variants of Gemini aliases resolve correctly (google, gemini-flash, models/ prefix)', () => {
    expect(classifyModelRequest('google').provider).toBe('GEMINI');
    expect(classifyModelRequest('gemini-flash').provider).toBe('GEMINI');
    expect(classifyModelRequest('models/gemini-3.1-flash-lite').provider).toBe('GEMINI');
  });

  it('normalizeGeminiModel alone never resolves a non-Gemini alias to a Gemini id (the underlying bug this fix closes)', () => {
    // This is the literal defect that previously let "claude" reach the
    // GoogleGenAI SDK: normalizeGeminiModel passes unrecognized strings
    // through unchanged. classifyModelRequest is what must catch that case
    // before any generateContent() call — verified directly above — but we
    // also assert the raw building block behaves as expected in isolation.
    expect(normalizeGeminiModel('claude')).toBe('claude');
    expect(normalizeGeminiModel('claude')).not.toMatch(/^gemini/);
  });

  // --- Wiring verification: the classifier must actually gate the three real
  //     execution call sites, not merely exist unused ---

  const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

  it('/api/generate gates on classifyModelRequest before building the Gemini candidate queue', () => {
    const route = serverContent.slice(
      serverContent.indexOf('app.post(["/api/generate"]'),
      serverContent.indexOf('app.post("/api/youtube/julian-goldie-audit"')
    );
    expect(route).toContain('classifyModelRequest(model)');
    expect(route).toContain("classification.provider === \"UNSUPPORTED\"");
    // The gate must appear before the candidate queue is built
    expect(route.indexOf('classifyModelRequest(model)')).toBeLessThan(route.indexOf('candidateModels'));
  });

  it('/api/execute-agent-task gates on classifyModelRequest before the task is marked RUNNING', () => {
    const route = serverContent.slice(
      serverContent.indexOf('app.post("/api/execute-agent-task"'),
      serverContent.indexOf('app.get("/api/graphs"')
    );
    expect(route).toContain('classifyModelRequest(assignedModel)');
    expect(route).toContain("modelClassification.provider === \"UNSUPPORTED\"");
    expect(route.indexOf('classifyModelRequest(assignedModel)')).toBeLessThan(route.indexOf('updateTaskStatus(taskId, "RUNNING")'));
    // The old exclude-list hack (silent Gemini fallback for claude/o3/sonar
    // while leaving deepseek/hermes/perplexity/chatgpt unguarded) must be gone
    expect(route).not.toContain('!v.includes("claude")');
  });

  it('server.ts no longer defines its own permissive model resolution — it imports the shared classifier', () => {
    expect(serverContent).toContain('import { classifyModelRequest } from "./lib/model-router"');
  });
});
