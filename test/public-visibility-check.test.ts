import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

// The routed call is faked: no test spends money. The canonical router is
// represented by its two entry points — a preview (is a qualified web-search
// route available?) and the routed call itself (answer + grounding payload).
vi.mock('../lib/fabric/routed-call', () => ({
  previewRoutedCall: vi.fn(() => (process.env.GEMINI_API_KEY
    ? { ok: true, decision: { selected: { providerId: 'gemini', modelId: 'fixture-grounded', canonicalVersionId: 'gemini/fixture-grounded' } } }
    : { ok: false, code: 'NO_QUALIFIED_ROUTE', error: 'no qualified web-search route' })),
  routedModelCall: vi.fn(async (inp: { prompt: string; tools?: string[] }) => ({
    ok: true, providerId: 'gemini', modelId: 'fixture-grounded', canonicalVersionId: 'gemini/fixture-grounded',
    output: inp.prompt.includes('best') ? 'Milford Mattress is popular.' : 'Try Mattress Firm.',
    raw: { candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: 'mattressfirm.com' } }, { web: { title: 'yelp.com' } }] } }] },
  })),
}));

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

  it('is off when no qualified web-search route exists, rather than pretending', async () => {
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
