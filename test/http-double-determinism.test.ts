import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// REGRESSION for the orchestration.test.ts flake (2026-09-18).
//
// Deterministic reproduction of the mechanism: a server that closes a REUSED
// keep-alive connection as a request arrives (its idle timer firing at that
// instant). The client sees a transport failure after dispatch; the spend
// guard must record UNKNOWN — never a clean rejection, never retried.
// Then the fix: with one request per connection (the central test setup) the
// race cannot occur, and a 429 is recorded as a 429.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-httpdet-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'httpdet.db');

import { generateViaOpenAI } from '../lib/fabric/model-openai';
import { getDatabase } from '../lib/persistence';
import { listUsageForKey } from '../lib/spend/ledger';
import { allowPaidExecutionForTest } from './helpers/spend';
import { invalidateProviderEndpointCache } from '../lib/spend/network-guard';

function double(opts: { keepAlive: boolean }) {
  const conns = new WeakMap<object, number>();
  let connections = 0;
  const stats = { requests: 0, killedOnReuse: 0 };
  const server = http.createServer((req, res) => {
    stats.requests += 1;
    const served = (req.socket as any).__served === true;
    if (served) { stats.killedOnReuse += 1; req.socket.destroy(); return; } // idle timer fires as the request lands
    (req.socket as any).__served = true;
    req.resume();
    req.on('end', () => { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Rate limit reached.' } })); });
  });
  if (opts.keepAlive) (server as any).allowKeepAlive = true;
  server.on('connection', (s) => { conns.set(s, ++connections); });
  return { server, stats, connections: () => connections };
}

// The double is the approved OpenAI endpoint for this file (as orchestration.test.ts does it).
const call = async (base: string, key: string) => {
  process.env.OPENAI_BASE_URL = base;
  invalidateProviderEndpointCache();
  return generateViaOpenAI({ apiKey: 'sk-proj-httpdet-000000000000000000000000', contents: 'hi', candidateModels: ['gpt-5.6-terra'], spend: { callSite: 'test.httpdet', idempotencyKey: key } } as any);
};

beforeAll(() => { getDatabase(); allowPaidExecutionForTest([['openai', 'gpt-5.6-terra']]); });
afterAll(() => { delete process.env.OPENAI_BASE_URL; try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

describe('keep-alive close racing a request', () => {
  it('REPRODUCTION: with keep-alive, a reused connection closed as the request lands is a transport failure → ledger UNKNOWN, not retried', async () => {
    const d = double({ keepAlive: true });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(d.server.address() as any).port}/v1`;
    // Sequential calls; the client reuses a pooled connection within the first
    // few (it may open a second one first). The call that lands on the reused
    // connection is the one the double kills.
    let hit: string | null = null;
    for (let i = 0; i < 10 && !hit; i++) {
      const key = `det-ka-${i}-${Date.now()}`;
      const before = d.stats.killedOnReuse;
      const r = await call(base, key);
      const rows = listUsageForKey(key);
      expect(rows, `call ${i}`).toHaveLength(1);
      if (d.stats.killedOnReuse > before) {
        hit = key;
        expect(r.lastProviderError).toMatch(/fetch failed/);
        expect(rows[0].status).toBe('UNKNOWN'); // UNKNOWN protection intact: it may have been processed.
      } else {
        expect(r.lastProviderError, `call ${i}`).toMatch(/HTTP 429/);
        expect(rows[0].status, `call ${i}`).toBe('PROVIDER_REJECTION');
      }
    }
    expect(hit, 'a pooled connection was reused and closed mid-request').not.toBeNull();
    // Each call sent exactly one request: nothing was retried.
    expect(d.stats.requests).toBe((getDatabase().prepare("SELECT COUNT(*) AS n FROM provider_usage WHERE idempotency_key LIKE 'det-ka-%'").get() as any).n);
    await new Promise<void>((r) => d.server.close(() => r()));
  });

  it('FIX: with one request per connection the race cannot occur — every 429 is recorded as a rejection', async () => {
    const d = double({ keepAlive: false });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(d.server.address() as any).port}/v1`;
    for (let i = 0; i < 25; i++) {
      const key = `det-close-${i}-${Date.now()}`;
      const r = await call(base, key);
      expect(r.lastProviderError, `call ${i}`).toMatch(/HTTP 429/);
      expect(listUsageForKey(key)[0].status, `call ${i}`).toBe('PROVIDER_REJECTION');
    }
    expect(d.stats.killedOnReuse).toBe(0);
    expect(d.connections()).toBe(25); // a fresh connection for every request
    await new Promise<void>((r) => d.server.close(() => r()));
  });

  it('the central setup is installed for every test file', () => {
    const cfg = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(cfg).toContain("'./test/setup/deterministic-http-doubles.ts'");
  });
});
