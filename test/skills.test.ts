import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-skills-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  listWorkspaceSkills,
  getWorkspaceSkill,
  createSkill,
  updateSkill,
  testSkill,
  discoverRepoSkillFiles,
  SKILLS_DIR,
} from '../lib/skills';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

const WS_A = 'ws-skills-a';
const WS_B = 'ws-skills-b';

describe('lib/skills: no invented skills, real persistence, workspace isolation (1, 2, 3)', () => {
  it('a fresh workspace has no skills — nothing is seeded/invented', () => {
    expect(listWorkspaceSkills('ws-skills-fresh-' + Date.now())).toEqual([]);
  });

  it('a created skill persists and is retrievable by id', () => {
    const skill = createSkill({ workspaceId: WS_A, name: 'test_skill_one', description: 'A real test skill' });
    const fetched = getWorkspaceSkill(WS_A, skill.skill_id);
    expect(fetched?.name).toBe('test_skill_one');
    expect(fetched?.status).toBe('NOT_CONFIGURED');
  });

  it('Workspace A cannot see Workspace B\'s skill, and vice versa', () => {
    const skillA = createSkill({ workspaceId: WS_A, name: 'only_in_a' });
    createSkill({ workspaceId: WS_B, name: 'only_in_b' });

    expect(listWorkspaceSkills(WS_A).map((s) => s.name)).toContain('only_in_a');
    expect(listWorkspaceSkills(WS_A).map((s) => s.name)).not.toContain('only_in_b');
    expect(getWorkspaceSkill(WS_B, skillA.skill_id)).toBeNull();
  });
});

describe('lib/skills: enable state persists, real (4)', () => {
  it('updateSkill persists an enabled=false flip, readable on a later fetch', () => {
    const skill = createSkill({ workspaceId: WS_A, name: 'toggle_me', enabled: true });
    expect(getWorkspaceSkill(WS_A, skill.skill_id)?.enabled).toBe(true);

    const updated = updateSkill(WS_A, skill.skill_id, { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(getWorkspaceSkill(WS_A, skill.skill_id)?.enabled).toBe(false);
  });

  it('updateSkill against another workspace\'s skill id fails safely (null, no cross-workspace mutation)', () => {
    const skill = createSkill({ workspaceId: WS_A, name: 'workspace_bound' });
    const result = updateSkill(WS_B, skill.skill_id, { enabled: false });
    expect(result).toBeNull();
    expect(getWorkspaceSkill(WS_A, skill.skill_id)?.enabled).toBe(true);
  });
});

describe('lib/skills: honest test execution — never a fabricated Sandbox success (5, 6, 7)', () => {
  it('testSkill always returns NOT_IMPLEMENTED, never SUCCESS — no execution runtime is wired', () => {
    const skill = createSkill({ workspaceId: WS_A, name: 'test_target' });
    const result = testSkill(WS_A, skill.skill_id);
    expect(result?.status).toBe('NOT_IMPLEMENTED');
    expect(result?.success).toBe(false);
    expect(result?.message.toLowerCase()).not.toContain('sandbox executed');
  });

  it('a real test attempt is recorded and reflected in derived callCount (never a hardcoded number)', () => {
    const skill = createSkill({ workspaceId: WS_A, name: 'counted_skill' });
    expect(getWorkspaceSkill(WS_A, skill.skill_id)?.callCount).toBe(0);
    testSkill(WS_A, skill.skill_id);
    testSkill(WS_A, skill.skill_id);
    expect(getWorkspaceSkill(WS_A, skill.skill_id)?.callCount).toBe(2);
    // NOT_IMPLEMENTED is never counted as a success
    expect(getWorkspaceSkill(WS_A, skill.skill_id)?.successCount).toBe(0);
  });

  it('the response text never claims a sandbox actually ran the skill', () => {
    const skill = createSkill({ workspaceId: WS_A, name: 'no_sandbox_claim' });
    const result = testSkill(WS_A, skill.skill_id);
    expect(result?.message).not.toMatch(/executing in sandbox/i);
  });
});

describe('lib/skills: safe failure and traversal defense (8, 9)', () => {
  it('testSkill against an unknown skill id returns null, not a fabricated result', () => {
    expect(testSkill(WS_A, 'skill-does-not-exist')).toBeNull();
  });

  it('getWorkspaceSkill against an unknown id returns null (indistinguishable from wrong-workspace)', () => {
    expect(getWorkspaceSkill(WS_A, 'skill-nope')).toBeNull();
  });

  it('discoverRepoSkillFiles only ever reads from the fixed SKILLS_DIR, never an arbitrary path', () => {
    // SKILLS_DIR is a compile-time constant derived from process.cwd(), not
    // client input — there is no parameter through which a caller could
    // redirect the scan. This asserts that invariant holds.
    expect(SKILLS_DIR).toBe(path.join(process.cwd(), 'skills'));
    expect(Array.isArray(discoverRepoSkillFiles())).toBe(true);
  });

  it('discoverRepoSkillFiles returns an honest empty list when the directory does not exist — no invented example skills', () => {
    // True today: this repo ships no skills/ directory.
    if (!fs.existsSync(SKILLS_DIR)) {
      expect(discoverRepoSkillFiles()).toEqual([]);
    }
  });
});
