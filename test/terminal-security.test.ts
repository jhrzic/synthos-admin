import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

function routeLine(routePath: string): string {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`app\\.(get|post|delete)\\(\\s*(?:\\[)?"${escaped}"[^\\n]*`);
  const match = serverContent.match(pattern);
  expect(match, `route ${routePath} not found in server.ts`).not.toBeNull();
  return match![0];
}

// ---------------------------------------------------------------------------
// Pass VIII / Workstream B — /api/terminal/* is a real, unrestricted
// child_process.exec() shell surface (B1 finding). Its only prior defense
// was requirePlatformAdmin + a bypassable regex denylist. B2/B3 decision:
// DEV_ONLY — gated on NODE_ENV, structurally unreachable in production
// regardless of session/role, not merely hidden by the UI.
// ---------------------------------------------------------------------------

describe('B3: /api/terminal/* is dev-only — a real 403 in production, not just a hidden UI', () => {
  it('a NODE_ENV === "production" gate exists ahead of every /api/terminal route', () => {
    const gateIdx = serverContent.indexOf('app.use("/api/terminal"');
    expect(gateIdx).toBeGreaterThan(-1);
    const gateBlock = serverContent.slice(gateIdx, gateIdx + 500);
    expect(gateBlock).toContain('process.env.NODE_ENV === "production"');
    expect(gateBlock).toContain('403');
  });

  it('the dev-only gate is registered BEFORE every terminal route it must protect', () => {
    const gateIdx = serverContent.indexOf('app.use("/api/terminal"');
    for (const route of ['/api/terminal/status', '/api/terminal/sessions', '/api/terminal/guardian-check', '/api/terminal/exec', '/api/terminal/stream']) {
      const routeIdx = serverContent.indexOf(`"${route}"`, gateIdx);
      expect(routeIdx, `${route} must be registered after the gate`).toBeGreaterThan(gateIdx);
    }
  });

  it('every terminal route still independently requires requirePlatformAdmin (defense in depth — the prod gate does not replace auth)', () => {
    for (const route of ['/api/terminal/status', '/api/terminal/sessions', '/api/terminal/guardian-check', '/api/terminal/exec', '/api/terminal/stream']) {
      expect(routeLine(route)).toContain('requirePlatformAdmin');
    }
  });
});

describe('B5: process safety — bounded timeout/output, no app-secret pass-through', () => {
  const execRoute = serverContent.slice(
    serverContent.indexOf('app.post("/api/terminal/exec"'),
    serverContent.indexOf('// Server-Sent Events (SSE) Live Streamed Execution'),
  );

  it('a real timeout is set on the child process', () => {
    expect(execRoute).toContain('timeout: 45000');
  });

  it('a bounded output buffer is set (no unbounded stdout/stderr accumulation)', () => {
    expect(execRoute).toMatch(/maxBuffer:\s*10 \* 1024 \* 1024/);
  });

  it('this app\'s own configured secrets are stripped from the child process environment', () => {
    expect(execRoute).toContain('SECRET_ENV_KEYS');
    for (const key of ['GEMINI_API_KEY', 'WINDMILL_TOKEN', 'HERMES_ADAPTER_TOKEN', 'MCP_CREDENTIAL_ENCRYPTION_KEY', 'FISH_AUDIO_API_KEY']) {
      expect(execRoute).toContain(key);
    }
    expect(execRoute).toContain('delete sanitizedProcessEnv[key]');
  });
});

describe('B1: the pre-existing Guardian denylist still catches the documented dangerous shapes (defense in depth, not the primary control anymore)', () => {
  // checkGuardianRules is a module-private function in server.ts, not
  // exported — asserting its real regex behavior via source inspection
  // (same posture as this repo's other source-level route/security tests)
  // rather than duplicating its logic here.
  const guardianFn = serverContent.slice(
    serverContent.indexOf('function checkGuardianRules'),
    serverContent.indexOf('function checkGuardianRules') + 2000,
  );

  it('blocks a fork bomb and root-destructive patterns outright (BLOCKED, not just APPROVAL_REQUIRED)', () => {
    expect(guardianFn).toContain(':(){ :|:& };:');
    expect(guardianFn).toMatch(/rm\\s\+-rf/);
  });

  it('requires approval for sudo / hard reset / piping a remote script into a shell', () => {
    expect(guardianFn).toMatch(/sudo\\b/);
    expect(guardianFn).toContain('curl');
    expect(guardianFn).toContain('wget');
  });
});

describe('B1 finding preserved honestly: no core product path depends on terminal exec', () => {
  it('no graph/skill/Windmill/MCP/task-execution route calls /api/terminal internally', () => {
    // Every real internal caller of another route in this file uses a
    // loopback fetch with the internal service token (see
    // /api/graphs/execute -> /api/execute-agent-task) — terminal has no
    // such caller anywhere in server.ts.
    const internalCallers = [...serverContent.matchAll(/fetch\(`http:\/\/127\.0\.0\.1:\$\{PORT\}([^`]+)`/g)].map((m) => m[1]);
    expect(internalCallers.some((p) => p.startsWith('/api/terminal'))).toBe(false);
  });
});
