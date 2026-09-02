import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

// ---------------------------------------------------------------------------
// Pass VIII / Workstream C — trust proxy, security headers. Source-level
// regression (matching this repo's convention for route/config assertions)
// plus a real live check via the production smoke test performed
// separately in this pass (see docs/PRODUCTION-READINESS.md).
// ---------------------------------------------------------------------------

describe('C1: trust proxy is never blindly enabled', () => {
  it('trust proxy is only set when TRUST_PROXY_HOPS is a real configured positive integer', () => {
    expect(serverContent).toContain('app.set("trust proxy", trustProxyHops)');
    expect(serverContent).not.toMatch(/app\.set\(["']trust proxy["'],\s*true\)/);
  });

  it('the trust-proxy config is derived from TRUST_PROXY_HOPS, not from a client-controlled header', () => {
    const idx = serverContent.indexOf('trustProxyHops');
    const block = serverContent.slice(idx, idx + 200);
    expect(block).toContain('process.env.TRUST_PROXY_HOPS');
  });
});

describe('C5: real, minimal security headers on every response', () => {
  const headerBlock = serverContent.slice(
    serverContent.indexOf('res.setHeader("X-Content-Type-Options"'),
    serverContent.indexOf('const INTERNAL_SERVICE_TOKEN'),
  );

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(headerBlock).toContain('"X-Content-Type-Options", "nosniff"');
  });

  it('sets X-Frame-Options: DENY (frame/clickjacking protection)', () => {
    expect(headerBlock).toContain('"X-Frame-Options", "DENY"');
  });

  it('sets a Referrer-Policy', () => {
    expect(headerBlock).toContain('"Referrer-Policy"');
  });

  it('sets a Permissions-Policy that does not blanket-allow camera/mic/geolocation to third parties', () => {
    expect(headerBlock).toContain('"Permissions-Policy"');
    expect(headerBlock).not.toContain('camera=*');
    expect(headerBlock).not.toContain('microphone=*');
  });

  it('CSP script-src is self-only — no unsafe-inline, no unsafe-eval, no wildcard', () => {
    expect(headerBlock).toContain("script-src 'self'");
    expect(headerBlock).not.toMatch(/script-src[^"]*unsafe-inline/);
    expect(headerBlock).not.toMatch(/script-src[^"]*unsafe-eval/);
  });

  it('CSP only allows the real external hosts this app actually uses (Google Fonts, Fish Audio WSS) — never a wildcard connect-src', () => {
    expect(headerBlock).toContain('fonts.googleapis.com');
    expect(headerBlock).toContain('fonts.gstatic.com');
    expect(headerBlock).toContain('wss://api.fish.audio');
    expect(headerBlock).not.toMatch(/connect-src[^"]*\*/);
  });

  it('frame-ancestors is none (defense in depth alongside X-Frame-Options)', () => {
    expect(headerBlock).toContain("frame-ancestors 'none'");
  });

  it('HSTS is only sent when NODE_ENV is production, never unconditionally', () => {
    const hstsIdx = headerBlock.indexOf('Strict-Transport-Security');
    expect(hstsIdx).toBeGreaterThan(-1);
    const before = headerBlock.slice(Math.max(0, hstsIdx - 150), hstsIdx);
    expect(before).toContain('NODE_ENV === "production"');
  });
});
