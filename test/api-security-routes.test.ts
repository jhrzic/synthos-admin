import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

// ---------------------------------------------------------------------------
// Pass III / E1: source-level regression lock on route authorization. This
// complements (does not replace) the live HTTP smoke test already run
// against a real server this pass, proving: anonymous blocked everywhere
// except the public allowlist, cross-workspace blocked, workspace-role
// escalation blocked, platform_admin required for Master Admin/backup/
// terminal, and platform_admin does NOT auto-bypass ordinary workspace
// membership checks. This test exists so a future edit that silently
// removes one of those guards fails CI instead of shipping unprotected.
// ---------------------------------------------------------------------------

function routeLine(routePath: string): string {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`app\\.(get|post|put|patch|delete)\\(\\s*(?:\\[)?"${escaped}"[^\\n]*`);
  const match = serverContent.match(pattern);
  expect(match, `route ${routePath} not found in server.ts`).not.toBeNull();
  return match![0];
}

describe('Pass III API security: workspace-scoped real data routes require requireWorkspaceMember', () => {
  const workspaceScopedRoutes = [
    '/api/graphs',
    '/api/graphs/:graphId',
    '/api/graph-runs',
    '/api/graph-runs/:runId',
    '/api/graphs/estimate',
    '/api/graphs/execute',
    '/api/execution/tasks/:taskId',
    '/api/execution/tasks/:taskId/activity',
    '/api/execution/tasks/:taskId/artifacts',
    '/api/execution/tasks/:taskId/reviews',
    '/api/execution/tasks/:taskId/receipts',
    '/api/jarvis/command',
    '/api/jarvis/sessions',
    '/api/jarvis/sessions/:sessionId',
    '/api/jarvis/sessions/:sessionId/messages',
    '/api/vault',
    '/api/vault/:artifactId',
    '/api/memory/search',
    '/api/memory/reindex',
    '/api/skills',
    '/api/skills/:skillId',
    '/api/skills/:skillId/executability',
    '/api/skills/:skillId/execute',
    '/api/skills/:skillId/mcp/probe',
    '/api/ton/status',
    '/api/ton/telemetry',
    '/api/ton/guardians',
  ];

  for (const route of workspaceScopedRoutes) {
    it(`${route} requires requireWorkspaceMember or requireWorkspaceAdmin`, () => {
      const line = routeLine(route);
      expect(line).toMatch(/requireWorkspaceMember\(|requireWorkspaceAdmin\(/);
    });
  }
});

describe('Pass V: skill execution requires the stricter requireWorkspaceAdmin, not just member', () => {
  it('/api/skills/:skillId/execute specifically requires requireWorkspaceAdmin (can spend real provider budget / call external MCP servers)', () => {
    const line = routeLine('/api/skills/:skillId/execute');
    expect(line).toContain('requireWorkspaceAdmin(');
  });
});

describe('Pass III API security: platform-level routes require requirePlatformAdmin', () => {
  const platformAdminRoutes = [
    '/api/master-admin/diagnostics',
    '/api/master-admin/database/test',
    '/api/master-admin/vault/test',
    '/api/master-admin/provider/test',
    '/api/master-admin/e2e/test',
    '/api/backup/create',
    '/api/backup/list',
    '/api/backup/:backupId/manifest',
    '/api/backup/:backupId/validate',
    '/api/backup/:backupId/restore',
    '/api/master-admin/workspaces',
    '/api/master-admin/workspaces/:workspaceId/members',
    '/api/master-admin/workspaces/:workspaceId/members/:userId',
    '/api/master-admin/users',
    '/api/master-admin/users/:userId',
    '/api/master-admin/users/:userId/status',
    '/api/master-admin/users/:userId/platform-role',
    '/api/master-admin/audit',
    '/api/master-admin/runtime-status',
    '/api/master-admin/runtime-events',
    '/api/terminal/status',
    '/api/terminal/sessions',
    '/api/terminal/sessions/:id',
    '/api/terminal/guardian-check',
    '/api/terminal/exec',
    '/api/terminal/stream',
    '/api/hermes/upstream-status',
    '/api/hermes/check',
    '/api/hermes/test-update',
    '/api/hermes/approve-update',
    '/api/hermes/config-check',
    '/api/hermes/config-migrate',
    '/api/hermes/db-state',
    '/api/hermes/logs',
  ];

  for (const route of platformAdminRoutes) {
    it(`${route} requires requirePlatformAdmin`, () => {
      expect(routeLine(route)).toContain('requirePlatformAdmin');
    });
  }
});

describe('Pass III API security: authenticated-but-workspace-agnostic routes require requireAuth', () => {
  const authOnlyRoutes = [
    '/api/generate',
    '/api/youtube/julian-goldie-audit',
    '/api/youtube/ingest',
    '/api/orchestrator/decompose',
    '/api/voice/tts',
    '/api/apollo/status',
    '/api/apollo/command',
    '/api/hermes/health',
    '/api/hermes/capabilities',
    '/api/providers/status',
    '/api/status',
  ];

  for (const route of authOnlyRoutes) {
    it(`${route} requires at least requireAuth`, () => {
      const line = routeLine(route);
      expect(line).toMatch(/requireAuth|requireWorkspaceMember\(|requirePlatformAdmin/);
    });
  }
});

describe('Pass III API security: the explicit public allowlist (E2) — never accidentally protected, never accidentally widened', () => {
  it('auth bootstrap/login/logout endpoints are public by design', () => {
    expect(routeLine('/api/auth/setup-required')).not.toMatch(/requireAuth|requireWorkspaceMember|requirePlatformAdmin/);
    expect(routeLine('/api/auth/setup')).not.toMatch(/requireAuth|requireWorkspaceMember|requirePlatformAdmin/);
    expect(routeLine('/api/auth/login')).not.toMatch(/requireAuth|requireWorkspaceMember|requirePlatformAdmin/);
  });

  it('skills discovery (bounded repo directory scan, no secrets, no workspace concept) is public by design', () => {
    expect(routeLine('/api/skills/discover')).not.toMatch(/requireAuth|requireWorkspaceMember|requirePlatformAdmin/);
  });

  it('Pass IV: setup-token validate/complete are public by design — the invited user has no session yet', () => {
    expect(routeLine('/api/auth/setup-token/:token')).not.toMatch(/requireAuth|requireWorkspaceMember|requirePlatformAdmin/);
    expect(routeLine('/api/auth/setup-token/:token/complete')).not.toMatch(/requireAuth|requireWorkspaceMember|requirePlatformAdmin/);
  });

  it('no route outside the documented allowlist is missing every guard', () => {
    const allRouteMatches = [...serverContent.matchAll(/app\.(get|post|put|patch|delete)\(\s*(?:\[)?"([^"]+)"/g)];
    const guarded = new Set([
      // Explicit public allowlist — anything else must carry a guard.
      '/api/auth/setup-required', '/api/auth/setup', '/api/auth/login', '/api/auth/logout', '/api/auth/me',
      '/api/auth/setup-token/:token', '/api/auth/setup-token/:token/complete',
      '/api/skills/discover',
      '*', // SPA shell fallback — no data of its own
    ]);
    const unguardedUnexpected: string[] = [];
    for (const m of allRouteMatches) {
      const routePath = m[2];
      if (guarded.has(routePath)) continue;
      // Find this route's full declaration line to check for a guard.
      const idx = m.index!;
      const lineEnd = serverContent.indexOf('\n', idx);
      const line = serverContent.slice(idx, lineEnd);
      if (!/requireAuth|requireWorkspaceMember\(|requireWorkspaceAdmin\(|requirePlatformAdmin|x-internal-service-token/i.test(line) &&
          !/app\.post\("\/api\/execute-agent-task"/.test(line)) {
        unguardedUnexpected.push(routePath);
      }
    }
    expect(unguardedUnexpected).toEqual([]);
  });
});

describe('Pass III: CSRF defense-in-depth is wired globally', () => {
  it('requireSameOrigin is applied to all state-changing methods before any route', () => {
    const middlewareBlock = serverContent.slice(
      serverContent.indexOf('CSRF defense-in-depth'),
      serverContent.indexOf('app.get("/api/auth/setup-required"')
    );
    expect(middlewareBlock).toContain('requireSameOrigin');
    expect(middlewareBlock).toContain('"POST", "PUT", "PATCH", "DELETE"');
  });
});

describe('Pass III: session cookie security attributes', () => {
  it('the session cookie is HttpOnly, SameSite=Lax, and Secure conditional on production', () => {
    const cookieFn = serverContent.slice(serverContent.indexOf('function setSessionCookie'), serverContent.indexOf('function clearSessionCookie'));
    expect(cookieFn).toContain('httpOnly: true');
    expect(cookieFn).toContain('sameSite: "lax"');
    expect(cookieFn).toContain('secure: isProdEnv');
  });
});

describe('Pass III: internal service token never leaks to any client-facing response', () => {
  it('INTERNAL_SERVICE_TOKEN is never included in a res.json(...) call', () => {
    const tokenUsages = [...serverContent.matchAll(/INTERNAL_SERVICE_TOKEN/g)];
    expect(tokenUsages.length).toBeGreaterThan(0);
    for (const usage of tokenUsages) {
      const contextStart = Math.max(0, usage.index! - 200);
      const contextEnd = Math.min(serverContent.length, usage.index! + 200);
      const context = serverContent.slice(contextStart, contextEnd);
      // The only legitimate appearances are: its own declaration/comment,
      // the internal fetch header, and the auth-check comparison — never
      // inside a JSON response body.
      expect(context).not.toMatch(/res\.json\(\s*\{[^}]*INTERNAL_SERVICE_TOKEN/);
    }
  });
});
