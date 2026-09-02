import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  isSafeMcpUrl,
  probeMcpServer,
  encryptCredential,
  decryptCredential,
  credentialEncryptionConfigured,
} from '../lib/mcp-client';

// ---------------------------------------------------------------------------
// Pass V / Workstream F8 — real MCP connectivity tests. Spins a tiny real
// HTTP server implementing a correct (if minimal) Streamable HTTP JSON-RPC
// MCP handshake, so "successful handshake" is proven against a real
// listening server, not mocked away. Also proves the SSRF guard actually
// blocks a private-address target by default and only allows it with the
// explicit MCP_ALLOW_LOCAL_ENDPOINTS escape hatch.
// ---------------------------------------------------------------------------

describe('SSRF guard: private/loopback/link-local addresses are blocked by default', () => {
  const originalAllowLocal = process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
  afterAll(() => {
    if (originalAllowLocal === undefined) delete process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
    else process.env.MCP_ALLOW_LOCAL_ENDPOINTS = originalAllowLocal;
  });

  it('blocks a loopback URL by default', async () => {
    delete process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
    const result = await isSafeMcpUrl('http://127.0.0.1:9999/mcp');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/private|reserved/i);
  });

  it('blocks localhost by hostname (resolves to loopback) by default', async () => {
    delete process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
    const result = await isSafeMcpUrl('http://localhost:9999/mcp');
    expect(result.safe).toBe(false);
  });

  it('allows a loopback URL when MCP_ALLOW_LOCAL_ENDPOINTS=true', async () => {
    process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';
    const result = await isSafeMcpUrl('http://127.0.0.1:9999/mcp');
    expect(result.safe).toBe(true);
  });

  it('rejects a non-http(s) protocol regardless of the escape hatch', async () => {
    process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';
    const result = await isSafeMcpUrl('ftp://127.0.0.1/mcp');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/protocol/i);
  });

  it('rejects a malformed URL', async () => {
    const result = await isSafeMcpUrl('not a url');
    expect(result.safe).toBe(false);
  });

  it('blocks the cloud metadata address 169.254.169.254', async () => {
    delete process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
    const result = await isSafeMcpUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.safe).toBe(false);
  });
});

describe('probeMcpServer: real handshake against a real local server', () => {
  let server: http.Server;
  let baseUrl: string;
  const originalAllowLocal = process.env.MCP_ALLOW_LOCAL_ENDPOINTS;

  beforeAll(async () => {
    process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let parsed: any;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (parsed.method === 'initialize') {
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: parsed.id,
            result: { protocolVersion: '2024-11-05', serverInfo: { name: 'test-mcp-server', version: '0.0.1' }, capabilities: {} },
          }));
        } else if (parsed.method === 'notifications/initialized') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
        } else if (parsed.method === 'tools/list') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { tools: [{ name: 'echo', description: 'Echoes input' }] } }));
        } else if (parsed.method === 'resources/list') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { resources: [] } }));
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'Method not found' } }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalAllowLocal === undefined) delete process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
    else process.env.MCP_ALLOW_LOCAL_ENDPOINTS = originalAllowLocal;
  });

  it('reports CONNECTED with real discovered tools from a real handshake', async () => {
    const result = await probeMcpServer(baseUrl);
    expect(result.status).toBe('CONNECTED');
    expect(result.evidenceSource).toBe('live_probe');
    expect(result.serverInfo?.name).toBe('test-mcp-server');
    expect(result.tools).toEqual([{ name: 'echo', description: 'Echoes input' }]);
    expect(result.resources).toEqual([]);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('reports FAILED for an unreachable endpoint, never a fabricated CONNECTED', async () => {
    const result = await probeMcpServer('http://127.0.0.1:1/mcp');
    expect(result.status).toBe('FAILED');
    expect(result.error).toBeTruthy();
  });

  it('reports NOT_CONFIGURED for an empty endpoint', async () => {
    const result = await probeMcpServer('');
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.evidenceSource).toBe('not_attempted');
  });

  it('reports PROBE_NOT_IMPLEMENTED for a non-HTTP (stdio-shaped) endpoint', async () => {
    const result = await probeMcpServer('run-my-mcp-server --stdio');
    expect(result.status).toBe('PROBE_NOT_IMPLEMENTED');
    expect(result.evidenceSource).toBe('not_attempted');
  });

  it('reports FAILED when the server returns a JSON-RPC error on initialize', async () => {
    const errorServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32000, message: 'Auth required' } }));
      });
    });
    await new Promise<void>((resolve) => errorServer.listen(0, '127.0.0.1', resolve));
    const addr = errorServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const result = await probeMcpServer(`http://127.0.0.1:${port}/mcp`);
      expect(result.status).toBe('FAILED');
      expect(result.error).toMatch(/Auth required/);
    } finally {
      await new Promise<void>((resolve) => errorServer.close(() => resolve()));
    }
  });
});

describe('F2: credential encryption at rest', () => {
  const originalKey = process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
  afterAll(() => {
    if (originalKey === undefined) delete process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  it('reports not configured when no key is set', () => {
    delete process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
    expect(credentialEncryptionConfigured()).toBe(false);
    expect(() => encryptCredential('secret-token')).toThrow(/MCP_CREDENTIAL_ENCRYPTION_KEY/);
  });

  it('round-trips a real secret through encrypt/decrypt when a key is configured', () => {
    process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'test-encryption-key-do-not-use-in-prod';
    expect(credentialEncryptionConfigured()).toBe(true);
    const ciphertext = encryptCredential('bearer-token-abc123');
    expect(ciphertext).not.toContain('bearer-token-abc123');
    expect(decryptCredential(ciphertext)).toBe('bearer-token-abc123');
  });

  it('fails to decrypt with a different key (tamper/wrong-key detection via GCM auth tag)', () => {
    process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'key-one';
    const ciphertext = encryptCredential('secret-value');
    process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'key-two';
    expect(() => decryptCredential(ciphertext)).toThrow();
  });
});
