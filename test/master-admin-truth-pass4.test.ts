import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const sidebarContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SidebarNav.tsx'), 'utf-8');
const masterAdminContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/MasterAdminView.tsx'), 'utf-8');
const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

// ---------------------------------------------------------------------------
// Pass IV / H: targeted Master Admin truth sweep on surfaces touched this
// pass. Locks in real fabrications found and fixed during this pass so a
// future edit can't silently reintroduce them.
// ---------------------------------------------------------------------------

describe('E1: the workspace switcher uses real authorized workspaces, never a hardcoded sample list', () => {
  it('SidebarNav no longer hardcodes the fake Pass III demo workspace options', () => {
    expect(sidebarContent).not.toContain('ws-research-sandbox');
    expect(sidebarContent).not.toContain('ws-growth-reach');
    expect(sidebarContent).not.toContain('arXiv Sandbox (Stg)');
    expect(sidebarContent).not.toContain('GTM Viral Engine (Dev)');
  });

  it('SidebarNav renders its options from a real authorizedWorkspaces prop', () => {
    expect(sidebarContent).toContain('authorizedWorkspaces');
    expect(sidebarContent).toMatch(/authorizedWorkspaces\.map/);
  });

  it('App.tsx threads real currentUser/authorizedWorkspaces from AuthGate rather than hardcoding a default workspace', () => {
    expect(appContent).toContain('authorizedWorkspaces');
    expect(appContent).toContain('LAST_WORKSPACE_STORAGE_KEY');
  });
});

describe('H: a real fabrication found during this pass — Aegis signing algorithm — is fixed', () => {
  it('/api/master-admin/diagnostics no longer claims a fabricated HMAC-SHA256 signing algorithm', () => {
    expect(serverContent).not.toContain('HMAC-SHA256 / SHA-256 Digest');
  });

  it('the diagnostics response reports the real algorithm (Ed25519) used by lib/persistence.ts', () => {
    const idx = serverContent.indexOf('aegis: {');
    const slice = serverContent.slice(idx, idx + 500);
    expect(slice).toContain('signingAlgorithm: "Ed25519"');
  });
});

describe('N: Master Admin overview counts are real queries, never mock totals', () => {
  it('the diagnostics route computes identity counts from real listUsers/listWorkspaces/admin_audit_events, not a hardcoded number', () => {
    const idx = serverContent.indexOf('identity: (() => {');
    expect(idx).toBeGreaterThan(-1);
    const slice = serverContent.slice(idx, idx + 400);
    expect(slice).toContain('listUsers().length');
    expect(slice).toContain('listWorkspaces().length');
    expect(slice).toContain('FROM admin_audit_events');
  });
});

describe('I1/I3: the MCP registry panel shows only real mcp-category entries, honest status', () => {
  it('filters to category === "mcp" rather than showing every skill under an MCP heading', () => {
    const idx = masterAdminContent.indexOf("activeSection === 'mcps'");
    const slice = masterAdminContent.slice(idx, idx + 3000);
    expect(slice).toContain("skills.filter((s) => s.category === 'mcp')");
  });

  it('never renders a hardcoded CONNECTED status for an MCP entry', () => {
    const idx = masterAdminContent.indexOf("activeSection === 'mcps'");
    const slice = masterAdminContent.slice(idx, idx + 3000);
    expect(slice).not.toMatch(/>CONNECTED</);
  });
});

describe('F2/F3: real admin audit trail is wired into every authority-changing route', () => {
  const mutationRoutes = [
    'app.post("/api/master-admin/workspaces"',
    'app.post("/api/master-admin/workspaces/:workspaceId/members"',
    'app.patch("/api/master-admin/workspaces/:workspaceId/members/:userId"',
    'app.delete("/api/master-admin/workspaces/:workspaceId/members/:userId"',
    'app.post("/api/master-admin/users"',
    'app.patch("/api/master-admin/users/:userId/status"',
    'app.patch("/api/master-admin/users/:userId/platform-role"',
  ];

  for (const routeStart of mutationRoutes) {
    it(`${routeStart.replace('app.', '').split('"')[1] || routeStart} records a real admin_audit_events entry`, () => {
      const idx = serverContent.indexOf(routeStart);
      expect(idx, `route ${routeStart} not found`).toBeGreaterThan(-1);
      const nextRouteIdx = serverContent.indexOf('\n  app.', idx + 10);
      const slice = serverContent.slice(idx, nextRouteIdx > -1 ? nextRouteIdx : idx + 2000);
      expect(slice).toContain('recordAdminAuditEvent(');
    });
  }
});

describe('Browser regression: MasterAdminView must never reference the Node "process" global directly', () => {
  it('does not access bare `process.` in client component source (found crashing the whole Platform panel with "ReferenceError: process is not defined" during a live browser walkthrough of this pass; the real value already arrives from the server via diagnostics.platform.nodeVersion)', () => {
    // Match a bare `process.` reference (not part of another identifier like
    // `import.meta` or a comment mentioning "the node process"). The browser
    // has no `process` global — only server.ts (Node) may reference it.
    expect(masterAdminContent).not.toMatch(/[^.\w]process\.\w/);
  });
});

describe('D2/D3: no fabricated "invitation sent" claim anywhere in the create-user flow', () => {
  it('the create-user UI never claims an email was sent', () => {
    // Start after the explanatory comment itself (which legitimately
    // mentions the phrase while describing what was fixed) — only the
    // actual rendered UI text below it must avoid the claim.
    const idx = masterAdminContent.indexOf('{showCreateUser && (');
    const slice = masterAdminContent.slice(idx, idx + 3000);
    expect(slice).not.toMatch(/invitation (has been |was )?sent/i);
    expect(slice).not.toMatch(/email (has been|was) sent/i);
    expect(slice).toContain('No email will be sent');
  });

  it('the backend create-user route never calls a mail-sending function (none exists in this codebase)', () => {
    const idx = serverContent.indexOf('app.post("/api/master-admin/users"');
    const nextRouteIdx = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRouteIdx);
    expect(slice).not.toMatch(/sendMail|sendEmail|nodemailer|sendgrid/i);
  });
});
