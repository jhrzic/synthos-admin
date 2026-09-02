import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const skillsViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SkillRegistryView.tsx'), 'utf-8');
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
const masterAdminContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/MasterAdminView.tsx'), 'utf-8');
const mockDataContent = fs.readFileSync(path.resolve(process.cwd(), 'src/data/mockData.ts'), 'utf-8');
const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

describe('SkillRegistryView: no fake Sandbox success, UI is backed by the real registry API (7, 10)', () => {
  it('fetches the real skills API, not session-only local state', () => {
    expect(skillsViewContent).toContain("fetch(`/api/skills?workspaceId=");
    expect(skillsViewContent).toContain('/test`');
  });

  it('never claims "Executing In Sandbox" as if a real sandbox exists', () => {
    expect(skillsViewContent).not.toContain('Executing In Sandbox');
  });

  it('never shows an unconditional success toast regardless of the real result', () => {
    expect(skillsViewContent).not.toMatch(/executed successfully/i);
  });

  it('the fabricated demo skill dataset (INITIAL_SKILLS) no longer exists anywhere in the app', () => {
    expect(mockDataContent).not.toContain('INITIAL_SKILLS');
    expect(appContent).not.toContain('INITIAL_SKILLS');
    expect(appContent).not.toContain('handleTestSkill');
    expect(appContent).not.toContain('handleToggleSkill');
    expect(appContent).not.toContain('handleAddSkill');
  });

  it('App.tsx no longer holds its own skills state — SkillRegistryView is self-contained against the API', () => {
    expect(appContent).not.toMatch(/const \[skills, setSkills\]/);
  });
});

describe('MasterAdminView: MCP/Sandbox tools section reflects the real registry, not fabricated risk/readiness copy', () => {
  it('fetches the real skills API for its workspace', () => {
    expect(masterAdminContent).toContain("fetch(`/api/skills?workspaceId=");
  });

  it('no longer claims a fabricated "Sandbox WASM" scope or a hardcoded LOW risk rating', () => {
    expect(masterAdminContent).not.toContain('Sandbox WASM');
    expect(masterAdminContent).not.toContain('Risk: <strong className="text-emerald-400">LOW</strong>');
  });

  it('no longer unconditionally claims READY for every registered skill', () => {
    expect(masterAdminContent).not.toContain('● READY');
  });
});

describe('server.ts: skill routes are workspace-scoped and test is honestly NOT_IMPLEMENTED', () => {
  it('POST /api/skills/:skillId/test calls the real testSkill() function, not a stub returning success', () => {
    const start = serverContent.indexOf('app.post("/api/skills/:skillId/test"');
    const end = serverContent.indexOf('app.get("/api/ton/status"', start);
    const body = serverContent.slice(start, end);
    expect(body).toContain('testSkill(resolved.workspaceId, req.params.skillId)');
  });

  it('every skill route resolves workspaceId — none default to a hardcoded workspace', () => {
    const start = serverContent.indexOf('app.get("/api/skills"');
    const end = serverContent.indexOf('app.get("/api/ton/status"', start);
    const skillRoutes = serverContent.slice(start, end);
    const occurrences = (skillRoutes.match(/resolveWorkspaceId\(/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });
});
