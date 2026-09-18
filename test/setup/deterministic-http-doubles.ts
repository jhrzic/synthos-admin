import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';

// ---------------------------------------------------------------------------
// DETERMINISTIC IN-PROCESS HTTP DOUBLES — one request per connection.
//
// ROOT CAUSE this closes (orchestration.test.ts, 2026-09-18): a provider
// double used Node's default keep-alive. The double's idle timer (5s) and the
// client's pooled socket live on the SAME event loop; under full-suite load a
// POST was written onto a pooled connection in the same instant the double's
// idle timer destroyed it. The request died at the transport layer
// ("fetch failed", cause UND_ERR_SOCKET), which the spend guard correctly
// records as UNKNOWN — a request that may have been processed is never
// retried — so the task went RECONCILING_UNKNOWN_EXECUTION instead of pausing
// on the double's 429. The product was right; the double's connection
// lifetime was nondeterministic.
//
// Every in-process test server now answers `Connection: close`: the client
// never reuses a connection, so an idle close can never race a request. The
// product's UNKNOWN handling is untouched (test/http-double-determinism.test.ts
// proves both halves). A test that must exercise keep-alive opts out with
// `(server as any).allowKeepAlive = true`.
// ---------------------------------------------------------------------------

const original = http.createServer;
function createServer(this: unknown, ...args: any[]): http.Server {
  const server = (original as any).apply(this, args) as http.Server;
  server.prependListener('request', (_req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!(server as any).allowKeepAlive && !res.headersSent) res.setHeader('Connection', 'close');
  });
  return server;
}
(http as any).createServer = createServer;
syncBuiltinESMExports();
