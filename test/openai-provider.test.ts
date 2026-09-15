import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-openai-provider-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  classifyModelRequest, normalizeOpenAiModel, resolveDefaultOpenAiModel,
  explainUnroutableModel, DEFAULT_OPENAI_MODEL,
} from '../lib/model-router';
import { generateViaOpenAI, extractOpenAiText, scrubSecrets, resolveOpenAiBaseUrl } from '../lib/fabric/model-openai';
import { getModelCredentialStatus, saveModelCredential, deleteModelCredential } from '../lib/model-credentials';
import { listCapabilities } from '../lib/fabric/registry';
import { getRuntimeStatus } from '../lib/runtime-status';
import { getDatabase } from '../lib/persistence';

// ---------------------------------------------------------------------------
// PUSH 1 — OpenAI as a real execution provider.
//
// METHOD, and its honest limit. There is no OpenAI credential in this
// environment, so no test here calls api.openai.com. Instead this file
// stands up a real local HTTP server that implements OpenAI's actual
// Responses API contract and points the REAL adapter at it via
// OPENAI_BASE_URL — the same technique test/external-executions.test.ts
// already uses for Windmill. Every byte of lib/fabric/model-openai.ts runs:
// real fetch, real headers, real JSON parsing, real error classification.
//
// What that proves: the adapter is correct against the published contract,
// records the provider-reported model rather than the requested one,
// captures real usage, and fails truthfully. What it does NOT prove: that
// any particular OpenAI account or model id is live. That needs a real key
// and is reported as unproven rather than implied here.
// ---------------------------------------------------------------------------

interface StubBehaviour {
  status: number;
  body: unknown;
  /** Captured from the last request, so the test can assert what was really sent. */
  seen?: { auth?: string; model?: string; input?: string; hasTemperature: boolean };
}

let server: http.Server;
let baseUrl: string;
let behaviour: StubBehaviour;
let lastSeen: StubBehaviour['seen'];

beforeAll(async () => {
  getDatabase();

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url || '').endsWith('/responses')) {
        let parsed: any = {};
        try { parsed = JSON.parse(body); } catch { /* recorded as empty */ }
        lastSeen = {
          auth: req.headers.authorization as string | undefined,
          model: parsed?.model,
          input: parsed?.input,
          hasTemperature: Object.prototype.hasOwnProperty.call(parsed || {}, 'temperature'),
        };
        res.writeHead(behaviour.status, { 'Content-Type': 'application/json' });
        return res.end(typeof behaviour.body === 'string' ? behaviour.body : JSON.stringify(behaviour.body));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/v1`;
  process.env.OPENAI_BASE_URL = baseUrl;
});

afterAll(async () => {
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  lastSeen = undefined;
  behaviour = { status: 200, body: {} };
});

describe('1. PROVIDER IDENTITY — OpenAI is recognized as itself and never as another provider', () => {
  it('a bare provider alias resolves to the configured default model, not to a Gemini id', () => {
    const result = classifyModelRequest('openai');
    expect(result.provider).toBe('OPENAI');
    expect(result.provider === 'OPENAI' && result.resolvedModel).toBe(DEFAULT_OPENAI_MODEL);
  });

  it('a specific model id is preserved exactly — the router never rewrites a caller\'s explicit choice', () => {
    const result = classifyModelRequest('gpt-6-astra');
    expect(result.provider).toBe('OPENAI');
    expect(result.provider === 'OPENAI' && result.resolvedModel).toBe('gpt-6-astra');
  });

  it('OPENAI_MODEL overrides the default, so an operator can move off a retired snapshot without a code change', () => {
    process.env.OPENAI_MODEL = 'gpt-5.6-luna';
    try {
      expect(resolveDefaultOpenAiModel()).toBe('gpt-5.6-luna');
      expect(normalizeOpenAiModel('openai')).toBe('gpt-5.6-luna');
    } finally {
      delete process.env.OPENAI_MODEL;
    }
    expect(resolveDefaultOpenAiModel()).toBe(DEFAULT_OPENAI_MODEL);
  });

  it('a Gemini-only surface refuses an OpenAI model with a truthful, actionable message — never an "unsupported provider" lie', () => {
    const message = explainUnroutableModel(classifyModelRequest('gpt-4o'), 'POST /api/generate');
    expect(message).toContain('OPENAI');
    expect(message).toContain('POST /api/execute-agent-task');
    expect(message).toContain('no substitute was used');
    // The one thing it must never say about a provider this platform runs.
    expect(message).not.toContain('is not a recognized provider');
  });
});

describe('2. TRUTHFUL CONFIGURATION STATE — NOT_CONFIGURED is reported, never assumed away', () => {
  it('with no key anywhere, the credential status is honestly absent and names the variable to set', () => {
    delete process.env.OPENAI_API_KEY;
    deleteModelCredential('openai');
    const status = getModelCredentialStatus('openai');
    expect(status.apiKeyPresent).toBe(false);
    expect(status.source).toBe('none');
    expect(status.envVar).toBe('OPENAI_API_KEY');
  });

  it('the capability registry reports model.openai NOT_CONFIGURED, naming the real state', async () => {
    delete process.env.OPENAI_API_KEY;
    deleteModelCredential('openai');
    const cap = (await listCapabilities()).find((c) => c.key === 'model.openai');
    expect(cap).toBeTruthy();
    expect(cap!.status).toBe('NOT_CONFIGURED');
    // The reason now carries the canonical provider state (lib/provider-state.ts)
    // rather than an env-var name, so the row explains itself.
    expect(cap!.reason).toContain('NO_CREDENTIAL');
    expect(cap!.status).not.toBe('AVAILABLE');
  });

  it('the runtime status table carries an OpenAI row, NOT_CONFIGURED, evidence "configuration_only" — configured is never shown as healthy', async () => {
    delete process.env.OPENAI_API_KEY;
    deleteModelCredential('openai');
    const report = await getRuntimeStatus();
    const row = report.systems.find((s) => s.system === 'OpenAI Provider');
    expect(row).toBeTruthy();
    expect(row!.status).toBe('NOT_CONFIGURED');
    expect(row!.evidenceSource).toBe('configuration_only');
  });

  // CORRECTED. This test used to assert that a present key flips the
  // capability to AVAILABLE, and it said so in its own name: "AVAILABLE still
  // only ever means 'a credential resolves', never 'the provider is up'".
  //
  // That was the bug, written down as an expectation. The Admin read AVAILABLE
  // while every real call returned `HTTP 429: You have no credits remaining`.
  // A resolved key is a fact about configuration; AVAILABLE is a claim about
  // capability, and a status whose own documentation has to explain that it
  // does not mean what it says is the wrong status.
  //
  // AVAILABLE is now reachable only from LIVE_VERIFIED — a real call that
  // really succeeded. A credential with nothing proven is DEGRADED.
  it('a present key does NOT make the capability AVAILABLE — that needs a verified real call', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key-for-capability-resolution-only';
    try {
      const cap = (await listCapabilities()).find((c) => c.key === 'model.openai');
      expect(cap!.status).not.toBe('AVAILABLE');
      expect(cap!.status).toBe('DEGRADED');
      expect(cap!.reason).toMatch(/CREDENTIAL_PRESENT|QUOTA_BLOCKED|PROVIDER_ERROR/);
      expect(cap!.reference).toBe('lib/fabric/model-openai.ts::generateViaOpenAI');

      const report = await getRuntimeStatus();
      const row = report.systems.find((s) => s.system === 'OpenAI Provider');
      // UNKNOWN, not HEALTHY: nothing has actually called the provider.
      expect(row!.status).toBe('UNKNOWN');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('a key in the encrypted server-side store is honoured, and the environment still wins over it', () => {
    deleteModelCredential('openai');
    saveModelCredential({ provider: 'openai', apiKey: 'sk-stored-key-value', userId: 'test-user' });
    try {
      delete process.env.OPENAI_API_KEY;
      expect(getModelCredentialStatus('openai').source).toBe('server_store');

      process.env.OPENAI_API_KEY = 'sk-environment-key-value';
      expect(getModelCredentialStatus('openai').source).toBe('environment');
    } finally {
      delete process.env.OPENAI_API_KEY;
      deleteModelCredential('openai');
    }
  });
});

describe('3. REAL EXECUTION against the real Responses API contract', () => {
  it('a successful call returns the provider\'s text and records the model the PROVIDER reported, not the one requested', async () => {
    behaviour = {
      status: 200,
      body: {
        id: 'resp_abc',
        // The provider resolved our alias to a dated snapshot. THIS is what
        // a receipt must attest to.
        model: 'gpt-5.6-terra-2026-08-01',
        output_text: 'Structured intelligence findings.',
        usage: { input_tokens: 41, output_tokens: 12, total_tokens: 53 },
      },
    };

    const result = await generateViaOpenAI({
      apiKey: 'sk-live-looking-key',
      contents: 'Produce findings.',
      candidateModels: ['gpt-5.6-terra'],
    });

    expect(result.output).toBe('Structured intelligence findings.');
    expect(result.modelUsed).toBe('gpt-5.6-terra-2026-08-01');
    expect(result.modelUsed).not.toBe('gpt-5.6-terra');
    expect(result.hadProviderError).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('real provider usage is captured verbatim and never estimated', async () => {
    behaviour = { status: 200, body: { model: 'gpt-5.6-terra', output_text: 'ok', usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } } };
    const result = await generateViaOpenAI({ apiKey: 'sk-k', contents: 'hi', candidateModels: ['gpt-5.6-terra'] });
    expect(result.providerUsageMetadata).toEqual({ input_tokens: 7, output_tokens: 3, total_tokens: 10 });
  });

  it('a response with no usage block reports null usage rather than a fabricated token count', async () => {
    behaviour = { status: 200, body: { model: 'gpt-5.6-terra', output_text: 'ok' } };
    const result = await generateViaOpenAI({ apiKey: 'sk-k', contents: 'hi', candidateModels: ['gpt-5.6-terra'] });
    expect(result.providerUsageMetadata).toBeNull();
  });

  it('the credential is sent as a real bearer header, and no sampling parameter is sent (GPT-6 Astra rejects custom temperature)', async () => {
    behaviour = { status: 200, body: { model: 'gpt-6-astra', output_text: 'ok' } };
    await generateViaOpenAI({ apiKey: 'sk-header-check', contents: 'prompt body', candidateModels: ['gpt-6-astra'] });
    expect(lastSeen?.auth).toBe('Bearer sk-header-check');
    expect(lastSeen?.model).toBe('gpt-6-astra');
    expect(lastSeen?.input).toBe('prompt body');
    expect(lastSeen?.hasTemperature).toBe(false);
  });

  it('content parts are read when output_text is absent — the documented fallback shape still yields real text', () => {
    const text = extractOpenAiText({
      output: [{ content: [{ text: 'part one ' }, { text: 'part two' }] }],
    });
    expect(text).toBe('part one part two');
  });
});

describe('4. TRUTHFUL FAILURE — an invalid credential fails as a failure, never as empty success', () => {
  it('a 401 is reported with the provider\'s own message and produces no output', async () => {
    behaviour = { status: 401, body: { error: { message: 'Incorrect API key provided.' } } };
    const result = await generateViaOpenAI({ apiKey: 'sk-wrong', contents: 'hi', candidateModels: ['gpt-5.6-terra'] });

    expect(result.output).toBe('');
    expect(result.modelUsed).toBeNull();
    expect(result.hadProviderError).toBe(true);
    expect(result.lastProviderError).toContain('401');
    expect(result.lastProviderError).toContain('Incorrect API key provided.');
  });

  it('a 200 containing no text is an error, not a silent success', async () => {
    behaviour = { status: 200, body: { model: 'gpt-5.6-terra', output_text: '' } };
    const result = await generateViaOpenAI({ apiKey: 'sk-k', contents: 'hi', candidateModels: ['gpt-5.6-terra'] });
    expect(result.output).toBe('');
    expect(result.hadProviderError).toBe(true);
    expect(result.lastProviderError).toContain('no text');
  });

  it('a non-JSON body is reported honestly rather than crashing the caller', async () => {
    behaviour = { status: 200, body: '<html>gateway error</html>' };
    const result = await generateViaOpenAI({ apiKey: 'sk-k', contents: 'hi', candidateModels: ['gpt-5.6-terra'] });
    expect(result.hadProviderError).toBe(true);
    expect(result.lastProviderError).toContain('not valid JSON');
  });

  it('an unreachable provider is a failure, and the adapter never throws — the kernel\'s one error path stays intact', async () => {
    const saved = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
    try {
      const result = await generateViaOpenAI({ apiKey: 'sk-k', contents: 'hi', candidateModels: ['gpt-5.6-terra'], timeoutMs: 2000 });
      expect(result.output).toBe('');
      expect(result.hadProviderError).toBe(true);
      expect(result.lastProviderError).toBeTruthy();
    } finally {
      process.env.OPENAI_BASE_URL = saved;
    }
  });
});

describe('5. NO CREDENTIAL LEAKAGE — a key must never survive into a log, a message, or a returned object', () => {
  it('a key echoed back by the provider in an error body is scrubbed before it can reach a response', async () => {
    behaviour = {
      status: 400,
      body: { error: { message: 'Bad request for key sk-proj-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH' } },
    };
    const result = await generateViaOpenAI({ apiKey: 'sk-proj-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH', contents: 'hi', candidateModels: ['gpt-5.6-terra'] });
    expect(result.lastProviderError).not.toContain('AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH');
    expect(result.lastProviderError).toContain('REDACTED');
  });

  it('the scrubber removes both sk- keys and bare long tokens', () => {
    expect(scrubSecrets('key sk-abcdefghijklmnop failed')).not.toContain('abcdefghijklmnop');
    expect(scrubSecrets(`token ${'z'.repeat(45)} rejected`)).not.toContain('z'.repeat(45));
  });

  it('no successful result object carries the key in any field', async () => {
    behaviour = { status: 200, body: { model: 'gpt-5.6-terra', output_text: 'ok' } };
    const result = await generateViaOpenAI({ apiKey: 'sk-secret-never-returned', contents: 'hi', candidateModels: ['gpt-5.6-terra'] });
    expect(JSON.stringify(result)).not.toContain('sk-secret-never-returned');
  });

  it('the credential status object reports presence and provenance but never the value', () => {
    process.env.OPENAI_API_KEY = 'sk-must-not-appear';
    try {
      expect(JSON.stringify(getModelCredentialStatus('openai'))).not.toContain('sk-must-not-appear');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('the base URL override is honoured, so an enterprise gateway or a test double is reachable without code changes', () => {
    expect(resolveOpenAiBaseUrl()).toBe(baseUrl);
  });
});
