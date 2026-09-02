import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-workspaces-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  ensureWorkspace,
  getWorkspace,
  listWorkspaces,
  createWorkspace,
  grantMembership,
  getMembership,
  hasWorkspaceAccess,
  listUserMemberships,
  listWorkspaceMembers,
  countWorkspaceMembers,
} from '../lib/workspaces';
import { createUser } from '../lib/auth';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

describe('lib/workspaces: real, listable workspace entities (not a bare unvalidated string)', () => {
  it('ensureWorkspace creates a real row, idempotently', () => {
    const first = ensureWorkspace('ws-test-a', 'Test Workspace A');
    const second = ensureWorkspace('ws-test-a', 'A different name — ignored since it already exists');
    expect(first.workspace_id).toBe('ws-test-a');
    expect(second.name).toBe('Test Workspace A'); // first-write-wins, not silently renamed
    expect(getWorkspace('ws-test-a')?.name).toBe('Test Workspace A');
  });

  it('createWorkspace generates a real, unique workspace', () => {
    const ws = createWorkspace('Newly Created');
    expect(listWorkspaces().map((w) => w.workspace_id)).toContain(ws.workspace_id);
  });

  it('an unknown workspace id returns null, not a fabricated placeholder', () => {
    expect(getWorkspace('ws-does-not-exist')).toBeNull();
  });
});

describe('lib/workspaces: the ONE canonical membership relation (B1)', () => {
  it('grantMembership creates a real, retrievable membership', () => {
    const user = createUser({ email: 'member-test@example.com', password: 'pw-member-1', displayName: 'MemberTest' });
    ensureWorkspace('ws-membership-a');
    const membership = grantMembership(user.user_id, 'ws-membership-a', 'member');
    expect(membership.role).toBe('member');
    expect(getMembership(user.user_id, 'ws-membership-a')?.role).toBe('member');
  });

  it('granting membership again updates role rather than creating a duplicate row', () => {
    const user = createUser({ email: 'upgrade-test@example.com', password: 'pw-upgrade-1', displayName: 'UpgradeTest' });
    ensureWorkspace('ws-upgrade-a');
    grantMembership(user.user_id, 'ws-upgrade-a', 'member');
    grantMembership(user.user_id, 'ws-upgrade-a', 'admin');
    expect(getMembership(user.user_id, 'ws-upgrade-a')?.role).toBe('admin');
    expect(countWorkspaceMembers('ws-upgrade-a')).toBe(1);
  });

  it('hasWorkspaceAccess returns null for a user with no membership row at all', () => {
    const user = createUser({ email: 'no-access@example.com', password: 'pw-noaccess-1', displayName: 'NoAccess' });
    ensureWorkspace('ws-no-access-target');
    expect(hasWorkspaceAccess(user.user_id, 'ws-no-access-target')).toBeNull();
  });

  it('listUserMemberships and listWorkspaceMembers reflect real, current state', () => {
    const user = createUser({ email: 'multi-ws@example.com', password: 'pw-multi-1', displayName: 'MultiWs' });
    ensureWorkspace('ws-multi-1');
    ensureWorkspace('ws-multi-2');
    grantMembership(user.user_id, 'ws-multi-1', 'admin');
    grantMembership(user.user_id, 'ws-multi-2', 'member');

    const memberships = listUserMemberships(user.user_id);
    expect(memberships.map((m) => m.workspace_id).sort()).toEqual(['ws-multi-1', 'ws-multi-2']);

    const members = listWorkspaceMembers('ws-multi-1');
    expect(members.some((m) => m.user_id === user.user_id)).toBe(true);
  });
});
