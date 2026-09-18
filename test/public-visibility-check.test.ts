import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

// The one paid call is faked: no test spends money.
vi.mock('../lib/spend/adapters', () => ({
  guardedGeminiGenerate: vi.fn(async (_ai: unknown, args: { contents: string }) => ({
    text: args.contents.includes('best') ? 'Milford Mattress is popular.' : 'Try Mattress Firm.',
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: 'mattressfirm.com' } }, { web: { title: 'yelp.com' } }] } }],
  })),
}));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {} }));

import { registerPublicVisibilityCheck, resetPublicCheckCaps, capReason } from '../lib/aeo/public-check';

async function appWith() {
  const app = express();
  app.use(express.json());
  registerPublicVisibilityCheck(app, (_req, _res, next) => next(), (req) => String(req.headers['x-ip'] || 'ip'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (b: unknown, ip = 'ip') => {
    const r = await fetch(`${base}/api/public/visibility-check`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ip': ip }, body: JSON.stringify(b) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { base, post, close: () => server.close() };
}
const body = { businessName: 'Milford Mattress', location: 'Milford, CT', service: 'mattress store' };

describe('public visibility check', () => {
  beforeEach(() => {
    resetPublicCheckCaps();
    process.env.GEMINI_API_KEY = 'test';
    delete process.env.PUBLIC_CHECK_DAILY_CAP;
  });

  it('serves the page', async () => {
    const a = await appWith();
    const r = await fetch(`${a.base}/check`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Are you visible');
    a.close();
  });

  it('reports only what the queries found, with sources split from competitors', async () => {
    const a = await appWith();
    const r = await a.post(body);
    a.close();
    expect(r.status).toBe(200);
    expect(r.body.asked).toBe(3);
    expect(r.body.appeared).toBe(1);
    expect(r.body.competitors).toEqual([{ host: 'mattressfirm.com', n: 3 }]);
    expect(r.body.sources).toEqual([{ host: 'yelp.com', n: 3 }]);
  });

  it('needs all three fields', async () => {
    const a = await appWith();
    expect((await a.post({ businessName: 'x' })).status).toBe(400);
    a.close();
  });

  it('is off without a key rather than pretending', async () => {
    delete process.env.GEMINI_API_KEY;
    const a = await appWith();
    expect((await a.post(body)).status).toBe(503);
    a.close();
  });

  it('caps each IP at 3 a day and the whole service at the daily cap', async () => {
    const a = await appWith();
    for (let i = 0; i < 3; i++) expect((await a.post(body, 'a')).status).toBe(200);
    expect((await a.post(body, 'a')).status).toBe(429);
    expect((await a.post(body, 'b')).status).toBe(200);
    a.close();
    expect(capReason('z', 4)).toMatch(/busy today/);
  });
});
