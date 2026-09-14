import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The Admin must not be LAN-visible by default. Two lines once disagreed on
// this (one defaulted to 0.0.0.0 for the container's sake, one to loopback);
// the integrated rule is loopback unless a deployment asks, and the container
// asks explicitly. Pinned at the source because the listen call runs at the
// bottom of server.ts startup and is not reachable from a unit test.
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('bind host', () => {
  it('server.ts falls back to 127.0.0.1 when neither SYNTHOS_BIND_HOST nor HOST is set', () => {
    const server = read('server.ts');
    expect(server).toContain('(process.env.SYNTHOS_BIND_HOST || "").trim() || (process.env.HOST || "").trim() || "127.0.0.1"');
    expect(server).not.toMatch(/:\s*"0\.0\.0\.0";/);
  });

  it('the container opts into 0.0.0.0 explicitly, so the reverse proxy can still reach it', () => {
    expect(read('Dockerfile')).toContain('ENV SYNTHOS_BIND_HOST=0.0.0.0');
  });

  it('the HMR websocket is pinned to loopback too, not left on every interface', () => {
    expect(read('vite.config.ts')).toContain("{ host: '127.0.0.1' }");
  });
});
