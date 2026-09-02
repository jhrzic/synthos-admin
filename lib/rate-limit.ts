// ---------------------------------------------------------------------------
// Pass VIII / Workstream A — real, server-side rate limiting.
//
// SINGLE_INSTANCE_LIMITER: this is a bounded in-memory fixed-window
// counter, correct for exactly one running process. It does NOT coordinate
// across multiple instances — running this app behind a load balancer with
// more than one replica means each replica enforces its own independent
// limit (an attacker distributed across replicas gets replica_count× the
// stated limit). No distributed store (Redis, etc.) exists in this stack
// today; documented here rather than silently claimed otherwise. See
// docs/PRODUCTION-READINESS.md.
//
// Keying never trusts a client-controlled header. `req.ip` is Express's own
// resolution, which is the raw socket address unless `app.set('trust
// proxy', ...)` has been explicitly configured to trust a specific proxy
// hop (see the trustProxy() setup in server.ts, Workstream C) — never a
// blind X-Forwarded-For read.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';

export type RateLimitClass = 'AUTH_SENSITIVE' | 'EXPENSIVE_EXECUTION' | 'PRIVILEGED_ADMIN' | 'GENERAL_API';

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

// A2 — tiered, not one arbitrary limit everywhere. Numbers are deliberately
// generous enough not to interfere with normal single-operator/small-team
// use (this is beta software, not a public multi-tenant SaaS yet — see
// CLAUDE.md's access model) while bounding brute-force/cost-abuse shape.
const LIMITS: Record<RateLimitClass, RateLimitConfig> = {
  AUTH_SENSITIVE: { windowMs: 15 * 60 * 1000, max: 10 },
  EXPENSIVE_EXECUTION: { windowMs: 60 * 1000, max: 20 },
  PRIVILEGED_ADMIN: { windowMs: 60 * 1000, max: 60 },
  GENERAL_API: { windowMs: 60 * 1000, max: 120 },
};

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup — no setInterval/timer (this app adds no
// scheduler, per the project's own non-negotiable rule). A sweep runs
// inline, at most once every SWEEP_INTERVAL calls, so the map never grows
// unbounded across a long-running process without ever spawning a timer.
let callsSinceSweep = 0;
const SWEEP_INTERVAL = 500;

function sweepExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/** Pure function — real fixed-window counting, no fabricated "remaining" number. */
export function checkRateLimit(key: string, cls: RateLimitClass, now: number = Date.now()): RateLimitResult {
  const config = LIMITS[cls];
  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_INTERVAL) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  const allowed = bucket.count <= config.max;
  return {
    allowed,
    limit: config.max,
    remaining: Math.max(0, config.max - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Test-only reset — production code never calls this. */
export function _resetRateLimitStateForTests() {
  buckets.clear();
  callsSinceSweep = 0;
}

// ---------------------------------------------------------------------------
// A5 — the real Express middleware. A key function decides IP-based vs.
// user/workspace-based keying per route; callers pick the right one for
// where in the middleware chain they're applied (before vs. after auth
// resolves req.authUser/req.authWorkspaceId).
// ---------------------------------------------------------------------------

export function byIp(req: Request): string {
  return req.ip || 'unknown-ip';
}

/** For a route already behind requireAuth/requireWorkspaceMember — falls back to IP only if somehow unauthenticated (defense in depth, never the primary path). */
export function byUserOrIp(req: Request): string {
  const user = (req as any).authUser;
  return user?.user_id ? `user:${user.user_id}` : `ip:${byIp(req)}`;
}

export function rateLimit(cls: RateLimitClass, keyFn: (req: Request) => string, routeLabel: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${cls}:${routeLabel}:${keyFn(req)}`;
    const result = checkRateLimit(key, cls);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      // A5 — a real 429, no internal counter state beyond what's already
      // in the standard rate-limit headers above.
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please slow down and try again shortly.',
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    next();
  };
}
