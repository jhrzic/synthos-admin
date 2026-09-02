import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import {
  health, isWindmillConfigured, submitJob, getJobStatus, getJobResult, cancelJob,
  isJobInputWithinBounds,
} from '../lib/windmill-client';

// ---------------------------------------------------------------------------
// ADR-006 / Workstream S — real contract tests against a local mock HTTP
// server implementing the documented Windmill REST shape this client codes
// against. This proves the CLIENT's request construction, response parsing,
// timeout/SSRF handling, and error mapping are real — it does not prove
// Windmill's actual production API matches this shape exactly (no live
// instance is configured anywhere in this repo; see ADR-006's own stated
// limitation). Production truth (no WINDMILL_BASE_URL configured locally)
// is asserted separately below and in test/runtime-status.test.ts.
// ---------------------------------------------------------------------------

const ENV_KEYS = ['WINDMILL_BASE_URL', 'WINDMILL_TOKEN', 'WINDMILL_WORKSPACE', 'MCP_ALLOW_LOCAL_ENDPOINTS'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('production truth: no WINDMILL_* configured in this deployment', () => {
  it('isWindmillConfigured() is false with nothing set', () => {
    delete process.env.WINDMILL_BASE_URL;
    delete process.env.WINDMILL_TOKEN;
    delete process.env.WINDMILL_WORKSPACE;
    expect(isWindmillConfigured()).toBe(false);
  });

  it('health() reports NOT_CONFIGURED, never a fabricated CONNECTED, when unset', async () => {
    delete process.env.WINDMILL_BASE_URL;
    delete process.env.WINDMILL_TOKEN;
    delete process.env.WINDMILL_WORKSPACE;
    const result = await health();
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.reachable).toBe(false);
    expect(result.authenticated).toBe(false);
  });

  it('submitJob() refuses when not configured, never silently proceeds', async () => {
    delete process.env.WINDMILL_BASE_URL;
    delete process.env.WINDMILL_TOKEN;
    delete process.env.WINDMILL_WORKSPACE;
    const result = await submitJob({ remotePath: 'f/test/script', kind: 'script', input: {} });
    expect(result.ok).toBe(false);
    expect(result.remoteJobId).toBeNull();
  });
});

describe('R4: job input payload size bound', () => {
  it('accepts a small input', () => {
    expect(isJobInputWithinBounds({ hello: 'world' })).toBe(true);
  });
  it('rejects an oversized input', () => {
    expect(isJobInputWithinBounds({ blob: 'x'.repeat(200_000) })).toBe(false);
  });
});

describe('SSRF: a private/loopback WINDMILL_BASE_URL is blocked by default', () => {
  it('health() reports FAILED (not CONNECTED, not a network attempt bypass) against a loopback URL with no escape hatch', async () => {
    delete process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
    process.env.WINDMILL_BASE_URL = 'http://127.0.0.1:1/';
    process.env.WINDMILL_TOKEN = 'fake-token';
    process.env.WINDMILL_WORKSPACE = 'ws';
    const result = await health();
    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/private|reserved/i);
  });
});

describe('real handshake against a real local mock Windmill server', () => {
  let server: http.Server;
  let baseUrl: string;
  const VALID_TOKEN = 'test-windmill-token';
  const JOB_ID = '11111111-2222-3333-4444-555555555555';

  beforeAll(async () => {
    process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const auth = req.headers.authorization || '';
        if (req.method === 'GET' && req.url === '/api/version') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end('v1.400.0');
        }
        if (req.method === 'GET' && req.url === '/api/users/whoami') {
          if (auth !== `Bearer ${VALID_TOKEN}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'unauthorized' }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ username: 'test-user', email: 'test@example.com' }));
        }
        if (req.method === 'POST' && req.url === '/api/w/test-ws/jobs/run/p/f/test/script') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end(JOB_ID);
        }
        if (req.method === 'GET' && req.url === `/api/w/test-ws/jobs_u/get/${JOB_ID}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ type: 'CompletedJob', running: false, success: true, canceled: false }));
        }
        if (req.method === 'GET' && req.url === '/api/w/test-ws/jobs_u/get/22222222-2222-2222-2222-222222222222') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ type: 'QueuedJob', running: false, canceled: false }));
        }
        if (req.method === 'GET' && req.url === '/api/w/test-ws/jobs_u/get/33333333-3333-3333-3333-333333333333') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ type: 'CompletedJob', running: false, success: false, canceled: false }));
        }
        if (req.method === 'GET' && req.url === `/api/w/test-ws/jobs_u/get_completed_job_result/${JOB_ID}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, value: 42 }));
        }
        if (req.method === 'POST' && req.url === `/api/w/test-ws/jobs_u/cancel/${JOB_ID}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ canceled: true }));
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    process.env.WINDMILL_BASE_URL = baseUrl;
    process.env.WINDMILL_TOKEN = VALID_TOKEN;
    process.env.WINDMILL_WORKSPACE = 'test-ws';
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('isWindmillConfigured() is true once all three vars are set', () => {
    expect(isWindmillConfigured()).toBe(true);
  });

  it('health() reports CONNECTED only after a real reachable + real authenticated call — never CONFIGURED alone', async () => {
    const result = await health();
    expect(result.status).toBe('CONNECTED');
    expect(result.reachable).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.identity).toBe('test-user');
    expect(result.version).toBe('v1.400.0');
  });

  it('health() reports FAILED (never CONNECTED) when the token is wrong — CONFIGURED never equals CONNECTED', async () => {
    process.env.WINDMILL_TOKEN = 'wrong-token';
    try {
      const result = await health();
      expect(result.status).toBe('FAILED');
      expect(result.reachable).toBe(true);
      expect(result.authenticated).toBe(false);
    } finally {
      process.env.WINDMILL_TOKEN = VALID_TOKEN;
    }
  });

  it('never exposes the token in a health() result', async () => {
    const result = await health();
    expect(JSON.stringify(result)).not.toContain(VALID_TOKEN);
  });

  it('submitJob() returns a real parsed job UUID on success', async () => {
    const result = await submitJob({ remotePath: 'f/test/script', kind: 'script', input: { x: 1 } });
    expect(result.ok).toBe(true);
    expect(result.remoteJobId).toBe(JOB_ID);
  });

  it('submitJob() refuses an oversized input before ever making a network call (R4)', async () => {
    const result = await submitJob({ remotePath: 'f/test/script', kind: 'script', input: { blob: 'x'.repeat(200_000) } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds/i);
  });

  it('getJobStatus(): QUEUED maps from a real QueuedJob response', async () => {
    const result = await getJobStatus('22222222-2222-2222-2222-222222222222');
    expect(result.ok).toBe(true);
    expect(result.state).toBe('QUEUED');
  });

  it('getJobStatus(): SUCCESS maps from a real completed+success response — SUBMITTED != RUNNING != SUCCEEDED', async () => {
    const result = await getJobStatus(JOB_ID);
    expect(result.ok).toBe(true);
    expect(result.state).toBe('SUCCESS');
  });

  it('getJobStatus(): FAILURE maps from a real completed+failed response', async () => {
    const result = await getJobStatus('33333333-3333-3333-3333-333333333333');
    expect(result.ok).toBe(true);
    expect(result.state).toBe('FAILURE');
  });

  it('getJobStatus(): an unknown remote job id reports UNKNOWN (404), never a fabricated FAILED', async () => {
    const result = await getJobStatus('99999999-9999-9999-9999-999999999999');
    expect(result.ok).toBe(false);
    expect(result.state).toBe('UNKNOWN');
  });

  it('getJobResult() fetches the real completed-job result payload', async () => {
    const result = await getJobResult(JOB_ID);
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ ok: true, value: 42 });
  });

  it('cancelJob() only reports confirmed:true after a real follow-up status read shows CANCELLED', async () => {
    // The mock server's cancel endpoint accepts the request but its
    // jobs_u/get endpoint above still reports the job as CompletedJob —
    // proving cancelJob() does not blindly trust the cancel POST's 2xx.
    const result = await cancelJob(JOB_ID);
    expect(result.ok).toBe(true);
    expect(result.confirmed).toBe(false);
  });
});
