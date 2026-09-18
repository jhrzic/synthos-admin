import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveRoute } from '../lib/registry';

// ---------------------------------------------------------------------------
// PROVIDER IDENTITY — the model registry resolves identity; nothing routes a
// model by its name, and nothing has a default model.
//
// The legacy classifier (lib/model-router.ts: prefix rules, provider
// defaults, a failover candidate list) was removed once every execution path
// moved onto the canonical router. These assertions keep it from returning.
// ---------------------------------------------------------------------------

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

describe('identity comes from the registry, never from a name', () => {
  for (const alias of ['gemini', 'claude', 'deepseek', 'hermes', 'perplexity', 'chatgpt', 'openai', 'gpt', 'google', 'totally-unknown-model']) {
    it(`"${alias}" is not routed by its name: unregistered ids are refused, never mapped to a provider`, () => {
      const r = resolveRoute(alias);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['MODEL_NOT_REGISTERED', 'MODEL_AMBIGUOUS']).toContain(r.code);
    });
  }

  it('the legacy classifier and its defaults are gone from the codebase', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'lib/model-router.ts'))).toBe(false);
    for (const dir of ['lib', 'src']) {
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
      for (const f of walk(path.resolve(process.cwd(), dir)).filter((x) => /\.(ts|tsx)$/.test(x))) {
        const src = fs.readFileSync(f, 'utf8');
        expect(src, f).not.toMatch(/from ['"][./]*model-router['"]/);
        expect(src, f).not.toMatch(/\b(classifyModelRequest|generateWithFailover|DEFAULT_CANDIDATE_MODELS|resolveDefaultOpenAiModel|resolveReviewSeatModel|normalizeGeminiModel)\s*\(/);
      }
    }
    expect(serverContent).not.toMatch(/model-router/);
  });
});

describe('the kernel', () => {
  it('lib/fabric/kernel.ts routes through the model registry (resolveRoute) before the task is marked RUNNING', () => {
    // The kernel no longer classifies by name prefix: the registry resolves a
    // canonical provider/model and protocol, and refuses anything else.
    // The kernel's model step lives in lib/continuity/segment-runner.ts: a
    // named model is resolved there, and the task claims RUNNING (the
    // kernel's onRunning callback) only after identity resolved.
    const kernelContent = fs.readFileSync(path.resolve(process.cwd(), 'lib/fabric/kernel.ts'), 'utf-8');
    const runner = fs.readFileSync(path.resolve(process.cwd(), 'lib/continuity/segment-runner.ts'), 'utf-8');
    expect(kernelContent).toContain('runModelSegments({');
    expect(runner).toContain('resolveRoute(inp.assignedModel)');
    expect(runner).toContain('if (!route.ok) return');
    expect(kernelContent).not.toContain('classifyModelRequest(');
    expect(runner).not.toContain('classifyModelRequest(');
    expect(runner.indexOf('resolveRoute(inp.assignedModel)')).toBeLessThan(runner.indexOf('inp.onRunning?.()'));
    expect(kernelContent.indexOf('onRunning: () => {')).toBeLessThan(kernelContent.indexOf('updateTaskStatus(taskId, "RUNNING"'));
    // The old exclude-list hack (silent Gemini fallback for claude/o3/sonar
    // while leaving deepseek/hermes/perplexity/chatgpt unguarded) must be gone
    expect(kernelContent).not.toContain('!v.includes("claude")');
  });

});
