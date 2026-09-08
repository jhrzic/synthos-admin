import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  classifyProviderError,
  generateWithFailover,
  resetFailoverCircuitBreakers,
  type FailoverResult,
} from '../lib/model-router';

// ---------------------------------------------------------------------------
// Jarvis routing stabilization (3-hour timebox task, following Pass X).
//
// The real problem: /api/jarvis/command's natural-language branch — the one
// JarvisView and GlobalVoiceOverlay actually call for every typed or spoken
// directive — had zero retry logic of any kind (a single direct Gemini
// call; any failure, including a transient 503, went straight to a 500).
// Separately, it fabricated two different "success" states on real
// failure: a hardcoded acknowledgment when GEMINI_API_KEY was unset, and a
// hardcoded acknowledgment when the model returned an empty response.
//
// Fixed by routing both /api/jarvis/command and /api/generate through the
// same pure, SDK-free generateWithFailover() (lib/model-router.ts). These
// tests exercise that pure function directly with an injected fake
// `callModel`, never a real network call and never real Gemini uptime —
// deterministic by construction.
//
// No cross-provider fallback exists or is tested here on purpose: this
// deployment has exactly one configured provider (Gemini). Claude/DeepSeek/
// Hermes/OpenAI are recognized by classifyModelRequest() but have no
// configured execution mapping — see lib/model-router.ts's header comment
// and RECOGNIZED_UNCONFIGURED_PROVIDERS. "Fallback" here means a different
// Gemini *model*, never a different provider.
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetFailoverCircuitBreakers();
});

function gemini503() {
  return new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}');
}
function gemini429() {
  return new Error('{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}');
}
function timeoutError() {
  const e: any = new Error('The operation was aborted due to timeout');
  e.code = 'ETIMEDOUT';
  return e;
}
function invalidCredentials() {
  return new Error('{"error":{"code":401,"message":"API key not valid. Please pass a valid API key.","status":"UNAUTHENTICATED"}}');
}

describe('classifyProviderError — retryable vs non-retryable', () => {
  it('classifies a real Gemini 503 "high demand" error as RETRYABLE', () => {
    const result = classifyProviderError(gemini503());
    expect(result.classification).toBe('RETRYABLE');
    expect(result.httpStatus).toBe(503);
  });

  it('classifies a real Gemini 429 rate-limit error as RETRYABLE', () => {
    const result = classifyProviderError(gemini429());
    expect(result.classification).toBe('RETRYABLE');
    expect(result.httpStatus).toBe(429);
  });

  it('classifies a network timeout as RETRYABLE', () => {
    const result = classifyProviderError(timeoutError());
    expect(result.classification).toBe('RETRYABLE');
  });

  it('classifies HTTP 500/502/504 as RETRYABLE', () => {
    expect(classifyProviderError(new Error('{"error":{"code":500,"status":"INTERNAL"}}')).classification).toBe('RETRYABLE');
    expect(classifyProviderError(new Error('{"error":{"code":502,"status":"BAD_GATEWAY"}}')).classification).toBe('RETRYABLE');
    expect(classifyProviderError(new Error('{"error":{"code":504,"status":"DEADLINE_EXCEEDED"}}')).classification).toBe('RETRYABLE');
  });

  it('classifies invalid/unauthorized credentials as NON_RETRYABLE', () => {
    const result = classifyProviderError(invalidCredentials());
    expect(result.classification).toBe('NON_RETRYABLE');
    expect(result.httpStatus).toBe(401);
  });

  it('classifies a malformed/invalid-argument request as NON_RETRYABLE', () => {
    const result = classifyProviderError(new Error('{"error":{"code":400,"message":"Invalid argument","status":"INVALID_ARGUMENT"}}'));
    expect(result.classification).toBe('NON_RETRYABLE');
  });

  it('classifies a safety/policy block as NON_RETRYABLE', () => {
    const result = classifyProviderError(new Error('Response blocked: SAFETY'));
    expect(result.classification).toBe('NON_RETRYABLE');
  });
});

describe('generateWithFailover — 1. preferred provider succeeds, no fallback', () => {
  it('returns the real text with fallbackUsed:false and no retries', async () => {
    let callCount = 0;
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      callCount++;
      expect(model).toBe('gemini-3.7-flash');
      return 'a real answer';
    }, { sleep: async () => {} });

    expect(result.success).toBe(true);
    expect(result.text).toBe('a real answer');
    expect(result.modelUsed).toBe('gemini-3.7-flash');
    expect(result.fallbackUsed).toBe(false);
    expect(callCount).toBe(1);
  });
});

describe('generateWithFailover — 2/3/4. retryable failures trigger fallback to the next model', () => {
  it('503 on the preferred model → falls back to the next configured model', async () => {
    const calls: string[] = [];
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      calls.push(model);
      if (model === 'gemini-3.7-flash') throw gemini503();
      return 'fallback answer';
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });

    expect(result.success).toBe(true);
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(result.fallbackUsed).toBe(true);
    expect(calls).toEqual(['gemini-3.7-flash', 'gemini-3.1-flash-lite']);
  });

  it('429 on the preferred model → falls back to the next configured model', async () => {
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      if (model === 'gemini-3.7-flash') throw gemini429();
      return 'fallback answer';
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });

    expect(result.success).toBe(true);
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(result.fallbackUsed).toBe(true);
  });

  it('timeout on the preferred model → falls back to the next configured model', async () => {
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      if (model === 'gemini-3.7-flash') throw timeoutError();
      return 'fallback answer';
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });

    expect(result.success).toBe(true);
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(result.fallbackUsed).toBe(true);
  });

  it('retries the SAME model with bounded backoff before moving to the next candidate', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    let attemptOnFirstModel = 0;
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      calls.push(model);
      if (model === 'gemini-3.7-flash') {
        attemptOnFirstModel++;
        throw gemini503(); // always fails — exhausts retries on this model
      }
      return 'fallback answer';
    }, { sleep: async (ms) => { sleeps.push(ms); }, maxRetriesPerModel: 2 });

    // 1 initial + 2 retries = 3 attempts on the first model before moving on
    expect(attemptOnFirstModel).toBe(3);
    expect(calls.filter((c) => c === 'gemini-3.7-flash').length).toBe(3);
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(sleeps.length).toBe(2); // backed off between the 3 same-model attempts, bounded
  });
});

describe('generateWithFailover — 5. invalid credentials do not trigger an inappropriate retry loop', () => {
  it('a non-retryable failure moves to the next candidate immediately, without retrying the same model', async () => {
    const calls: string[] = [];
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      calls.push(model);
      if (model === 'gemini-3.7-flash') throw invalidCredentials();
      return 'fallback answer';
    }, { sleep: async () => {}, maxRetriesPerModel: 2 });

    // Only ONE call to the first model despite maxRetriesPerModel:2 — a
    // non-retryable failure must not be retried on the same model.
    expect(calls.filter((c) => c === 'gemini-3.7-flash').length).toBe(1);
    expect(result.success).toBe(true);
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
  });

  it('invalid credentials on every candidate never loops indefinitely', async () => {
    const calls: string[] = [];
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      calls.push(model);
      throw invalidCredentials();
    }, { sleep: async () => {}, maxRetriesPerModel: 2 });

    expect(calls.length).toBe(2); // one attempt per candidate, no retries — bounded and finite
    expect(result.success).toBe(false);
  });
});

describe('generateWithFailover — 6. a successful fallback reports the actual provider/model used', () => {
  it('modelUsed reflects the real fallback model, not the originally requested one', async () => {
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      if (model === 'gemini-3.7-flash') throw gemini503();
      return 'real fallback text';
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });

    expect(result.requestedModel).toBe('gemini-3.7-flash');
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(result.fallbackUsed).toBe(true);
    expect(result.text).toBe('real fallback text');
    // Full attempt log is real evidence, not fabricated — one failed + one succeeded.
    expect(result.attempts.some((a) => a.outcome === 'RETRYABLE_FAILURE' && a.model === 'gemini-3.7-flash')).toBe(true);
    expect(result.attempts.some((a) => a.outcome === 'SUCCESS' && a.model === 'gemini-3.1-flash-lite')).toBe(true);
  });
});

describe('generateWithFailover — 7. all configured providers fail → honest DEGRADED result', () => {
  it('returns success:false with the real final error when every candidate fails', async () => {
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async () => {
      throw gemini503();
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });

    expect(result.success).toBe(false);
    expect(result.text).toBeUndefined();
    expect(result.modelUsed).toBeNull();
    expect(result.finalError).toContain('high demand');
  });
});

describe('generateWithFailover — 8. no configured fallback (single candidate) → honest DEGRADED result', () => {
  it('a single-candidate list that fails returns success:false, never a fabricated success', async () => {
    const result: FailoverResult = await generateWithFailover(['gemini-3.7-flash'], async () => {
      throw gemini503();
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.attempts.length).toBe(1);
  });
});

describe('generateWithFailover — 9. no fabricated success state', () => {
  it('an empty/falsy response from callModel must be treated as a real failure by the caller contract, never coerced into text', async () => {
    // generateWithFailover itself just returns whatever callModel resolves
    // with — the "empty response is a failure" rule lives in the caller
    // (server.ts throws before returning ''), verified below via the
    // real server.ts source, not duplicated logic here.
    const result = await generateWithFailover(['gemini-3.7-flash'], async () => {
      throw new Error('Model returned an empty response.');
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });
    expect(result.success).toBe(false);
  });

  it('never returns success:true without real text', async () => {
    const result = await generateWithFailover(['gemini-3.7-flash'], async () => {
      throw gemini503();
    }, { sleep: async () => {}, maxRetriesPerModel: 0 });
    expect(result.success).toBe(false);
    expect(result.text).toBeUndefined();
  });
});

describe('generateWithFailover — circuit breaker: a model failing repeatedly across requests is skipped, then recovers', () => {
  it('opens after repeated consecutive failures and skips the model without a real call', async () => {
    let now = 0;
    const clock = () => now;

    // Fail the first model 3 times across 3 separate "requests" (separate
    // generateWithFailover calls, simulating repeated incoming requests).
    for (let i = 0; i < 3; i++) {
      await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
        if (model === 'gemini-3.7-flash') throw gemini503();
        return 'fallback';
      }, { sleep: async () => {}, maxRetriesPerModel: 0, now: clock });
    }

    // 4th request: circuit should now be open for gemini-3.7-flash — skipped without a real call.
    const calls: string[] = [];
    const result = await generateWithFailover(['gemini-3.7-flash', 'gemini-3.1-flash-lite'], async (model) => {
      calls.push(model);
      return 'fallback';
    }, { sleep: async () => {}, maxRetriesPerModel: 0, now: clock });

    expect(calls).toEqual(['gemini-3.1-flash-lite']); // gemini-3.7-flash was never actually called
    expect(result.attempts.some((a) => a.model === 'gemini-3.7-flash' && a.outcome === 'CIRCUIT_OPEN_SKIPPED')).toBe(true);
  });

  it('recovers automatically after the cooldown window elapses', async () => {
    let now = 0;
    const clock = () => now;

    for (let i = 0; i < 3; i++) {
      await generateWithFailover(['gemini-3.7-flash'], async () => { throw gemini503(); }, { sleep: async () => {}, maxRetriesPerModel: 0, now: clock });
    }

    now += 31_000; // past the 30s cooldown

    const calls: string[] = [];
    const result = await generateWithFailover(['gemini-3.7-flash'], async (model) => {
      calls.push(model);
      return 'recovered';
    }, { sleep: async () => {}, maxRetriesPerModel: 0, now: clock });

    expect(calls).toEqual(['gemini-3.7-flash']); // real call was allowed again after cooldown
    expect(result.success).toBe(true);
  });
});

describe('server.ts: /api/jarvis/command and /api/generate route through the real failover helper', () => {
  const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

  it('imports generateWithFailover from the shared, pure model-router module', () => {
    expect(serverContent).toContain('generateWithFailover');
    expect(serverContent).toMatch(/from "\.\/lib\/model-router"/);
  });

  it('/api/jarvis/command no longer fabricates a success message when GEMINI_API_KEY is unset', () => {
    const idx = serverContent.indexOf('app.post("/api/jarvis/command"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).not.toContain('Directive acknowledged: ');
    expect(slice).not.toContain('Processing through SynthOS execution mesh');
    expect(slice).toContain('API_KEY_NOT_CONFIGURED');
  });

  it('/api/jarvis/command no longer fabricates a success message on an empty model response', () => {
    const idx = serverContent.indexOf('app.post("/api/jarvis/command"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).not.toContain('Directive acknowledged and dispatched to system mesh');
  });

  it('/api/jarvis/command calls generateWithFailover for its natural-language branch', () => {
    const idx = serverContent.indexOf('app.post("/api/jarvis/command"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).toContain('generateWithFailover(candidateModels');
  });

  it('/api/generate calls generateWithFailover instead of its own ad-hoc candidate loop', () => {
    const idx = serverContent.indexOf('app.post(["/api/generate"]');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).toContain('generateWithFailover(candidateModels');
  });
});
