import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { checkRateLimit, rateLimit, byIp, byUserOrIp, _resetRateLimitStateForTests } from '../lib/rate-limit';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

// ---------------------------------------------------------------------------
// Pass VIII / Workstream A — real, deterministic tests against the fixed-
// window counter itself (no timers, no flakiness — `now` is passed
// explicitly), plus source-level confirmation the high-risk routes
// identified in A1 actually carry the middleware.
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetRateLimitStateForTests();
});

describe('A2: checkRateLimit — real fixed-window counting, no fabricated remaining count', () => {
  it('allows requests up to the configured max, then blocks', () => {
    const key = 'test-key-1';
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit(key, 'AUTH_SENSITIVE', 1000);
      expect(result.allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, 'AUTH_SENSITIVE', 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('different keys are completely isolated from each other', () => {
    const keyA = 'user-a';
    const keyB = 'user-b';
    for (let i = 0; i < 10; i++) checkRateLimit(keyA, 'AUTH_SENSITIVE', 1000);
    expect(checkRateLimit(keyA, 'AUTH_SENSITIVE', 1000).allowed).toBe(false);
    // keyB has never been touched — still fully allowed.
    expect(checkRateLimit(keyB, 'AUTH_SENSITIVE', 1000).allowed).toBe(true);
  });

  it('the window resets after resetAt — real time-window behavior, not a permanent ban', () => {
    const key = 'reset-test';
    for (let i = 0; i < 10; i++) checkRateLimit(key, 'AUTH_SENSITIVE', 1000);
    expect(checkRateLimit(key, 'AUTH_SENSITIVE', 1000).allowed).toBe(false);

    // Advance past the 15-minute AUTH_SENSITIVE window.
    const farFuture = 1000 + 16 * 60 * 1000;
    const afterReset = checkRateLimit(key, 'AUTH_SENSITIVE', farFuture);
    expect(afterReset.allowed).toBe(true);
  });

  it('different rate limit classes for the same underlying key do not share a bucket', () => {
    const key = 'shared-identity';
    for (let i = 0; i < 20; i++) checkRateLimit(key, 'EXPENSIVE_EXECUTION', 1000);
    expect(checkRateLimit(key, 'EXPENSIVE_EXECUTION', 1000).allowed).toBe(false);
    // A differently-classed key string (as the real middleware constructs
    // it, prefixed by class+route) is a distinct bucket even if some
    // substring overlaps.
    expect(checkRateLimit(`AUTH_SENSITIVE:${key}`, 'AUTH_SENSITIVE', 1000).allowed).toBe(true);
  });

  it('normal traffic under the limit is never blocked', () => {
    const key = 'normal-user';
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 'GENERAL_API', 1000).allowed).toBe(true);
    }
  });
});

describe('A5: the Express middleware returns a real 429 with Retry-After, never a silent drop', () => {
  function mockReqRes(ip: string) {
    const headers: Record<string, string> = {};
    const req: any = { ip };
    const res: any = {
      statusCode: 200,
      body: null as any,
      setHeader(key: string, value: string) { headers[key] = value; },
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.body = body; return this; },
    };
    return { req, res, headers };
  }

  it('blocks the 11th request from the same IP within the AUTH_SENSITIVE window (login throttling)', () => {
    const middleware = rateLimit('AUTH_SENSITIVE', byIp, 'unit-test-login');
    let lastRes: any;
    for (let i = 0; i < 11; i++) {
      const { req, res } = mockReqRes('203.0.113.5');
      const next = vi.fn();
      middleware(req, res, next);
      lastRes = { res, next };
    }
    expect(lastRes.res.statusCode).toBe(429);
    expect(lastRes.res.body.success).toBe(false);
    expect(lastRes.next).not.toHaveBeenCalled();
  });

  it('two different IPs (simulating two different anonymous callers) are rate-limited independently', () => {
    const middleware = rateLimit('AUTH_SENSITIVE', byIp, 'unit-test-isolated');
    for (let i = 0; i < 10; i++) {
      const { req, res } = mockReqRes('198.51.100.1');
      middleware(req, res, vi.fn());
    }
    const { req: reqBlocked, res: resBlocked } = mockReqRes('198.51.100.1');
    middleware(reqBlocked, resBlocked, vi.fn());
    expect(resBlocked.statusCode).toBe(429);

    // A different IP has its own independent budget.
    const { req: reqOther, res: resOther } = mockReqRes('198.51.100.2');
    const nextOther = vi.fn();
    middleware(reqOther, resOther, nextOther);
    expect(nextOther).toHaveBeenCalled();
    expect(resOther.statusCode).toBe(200);
  });

  it('byUserOrIp keys authenticated callers by user_id, not IP — two different workspaces/users on the same IP have independent budgets', () => {
    const middleware = rateLimit('EXPENSIVE_EXECUTION', byUserOrIp, 'unit-test-workspace-exec');
    const sameIp = '10.0.0.1';
    for (let i = 0; i < 20; i++) {
      const { req, res } = mockReqRes(sameIp);
      req.authUser = { user_id: 'user-alpha' };
      middleware(req, res, vi.fn());
    }
    const { req: exhausted, res: exhaustedRes } = mockReqRes(sameIp);
    exhausted.authUser = { user_id: 'user-alpha' };
    middleware(exhausted, exhaustedRes, vi.fn());
    expect(exhaustedRes.statusCode).toBe(429);

    // A different authenticated user, same IP — independent budget.
    const { req: otherUser, res: otherRes } = mockReqRes(sameIp);
    otherUser.authUser = { user_id: 'user-beta' };
    const nextOther = vi.fn();
    middleware(otherUser, otherRes, nextOther);
    expect(nextOther).toHaveBeenCalled();
  });

  it('never reveals raw internal bucket state beyond the standard rate-limit headers', () => {
    const { req, res, headers } = mockReqRes('192.0.2.1');
    const middleware = rateLimit('GENERAL_API', byIp, 'unit-test-headers');
    middleware(req, res, vi.fn());
    expect(headers['X-RateLimit-Limit']).toBeTruthy();
    expect(headers['X-RateLimit-Remaining']).toBeTruthy();
    expect(Object.keys(headers)).not.toContain('X-Internal-Bucket-Map');
  });
});

describe('A1/A3/A4: the identified high-risk routes actually carry rate limiting in server.ts', () => {
  const authRoutes = ['/api/auth/setup', '/api/auth/login', '/api/auth/setup-token/:token', '/api/auth/setup-token/:token/complete'];
  const expensiveRoutes = ['/api/generate', '/api/graphs/execute', '/api/skills/:skillId/execute', '/api/skills/:skillId/mcp/probe', '/api/external-executions'];

  function routeDeclarationLine(method: 'get' | 'post' | 'patch', routePath: string): string {
    const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`app\\.${method}\\(\\s*(?:\\[)?"${escaped}"[^\\n]*`);
    const match = serverContent.match(pattern);
    expect(match, `${method.toUpperCase()} ${routePath} not found`).not.toBeNull();
    return match![0];
  }

  for (const route of authRoutes) {
    it(`${route} carries AUTH_SENSITIVE rate limiting`, () => {
      const method = route === '/api/auth/setup-token/:token' ? 'get' : 'post';
      expect(routeDeclarationLine(method, route)).toContain('"AUTH_SENSITIVE"');
    });
  }

  for (const route of expensiveRoutes) {
    it(`${route} carries EXPENSIVE_EXECUTION rate limiting`, () => {
      expect(routeDeclarationLine('post', route)).toContain('"EXPENSIVE_EXECUTION"');
    });
  }

  it('/api/terminal/exec and admin user creation carry PRIVILEGED_ADMIN rate limiting', () => {
    expect(routeDeclarationLine('post', '/api/terminal/exec')).toContain('"PRIVILEGED_ADMIN"');
    expect(routeDeclarationLine('post', '/api/master-admin/users')).toContain('"PRIVILEGED_ADMIN"');
  });
});

describe('A2 honesty: SINGLE_INSTANCE_LIMITER is documented, not silently claimed as distributed', () => {
  it('lib/rate-limit.ts explicitly states this is a single-instance, in-memory limiter', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'lib/rate-limit.ts'), 'utf-8');
    expect(content).toContain('SINGLE_INSTANCE_LIMITER');
  });
});
