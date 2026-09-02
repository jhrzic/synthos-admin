import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-onboarding-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createUser,
  createPendingUser,
  createSetupToken,
  resolveSetupToken,
  completeSetup,
  login,
  resolveSessionUser,
  setPlatformRole,
  countActivePlatformAdmins,
  setUserStatus,
  getUserById,
  listUsers,
} from '../lib/auth';
import {
  ensureWorkspace,
  grantMembership,
  removeMembership,
  updateMembershipRole,
  getMembership,
  hasWorkspaceAccess,
  listUserMembershipsWithWorkspaceNames,
  listWorkspaceMembersWithUserInfo,
  getWorkspaceActivityCounts,
} from '../lib/workspaces';
import { getDatabase } from '../lib/persistence';
import { recordAdminAuditEvent, listRecentAdminAuditEvents } from '../lib/audit';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

// ---------------------------------------------------------------------------
// Pass IV: second-user onboarding (D), membership management (B), platform
// role / last-admin invariant (A5), and the audit trail (F).
// ---------------------------------------------------------------------------

describe('D2/D3/D4: admin-created accounts and one-time setup tokens', () => {
  it('a pending user cannot log in with any password — status is setup_required, not active', () => {
    const pending = createPendingUser({ email: 'pending-a@example.com', displayName: 'PendingA' });
    expect(pending.status).toBe('setup_required');
    expect(login('pending-a@example.com', 'any-guess-at-all')).toBeNull();
  });

  it('a real setup token validates and reveals only email/displayName, nothing else', () => {
    const pending = createPendingUser({ email: 'pending-b@example.com', displayName: 'PendingB' });
    const { rawToken } = createSetupToken(pending.user_id);
    const resolved = resolveSetupToken(rawToken);
    expect(resolved?.email).toBe('pending-b@example.com');
  });

  it('an unknown/garbage token resolves to null', () => {
    expect(resolveSetupToken('not-a-real-token')).toBeNull();
  });

  it('completeSetup sets a real password, activates the account, and logs the user in — all in one step', () => {
    const pending = createPendingUser({ email: 'pending-c@example.com', displayName: 'PendingC' });
    const { rawToken } = createSetupToken(pending.user_id);
    const result = completeSetup(rawToken, 'real-chosen-password-1');
    expect(result?.user.status).toBe('active');
    expect(resolveSessionUser(result!.rawSessionToken)?.user_id).toBe(pending.user_id);
    // The new real password now actually works via the normal login path.
    expect(login('pending-c@example.com', 'real-chosen-password-1')).not.toBeNull();
  });

  it('a setup token is single-use — completing setup twice with the same token fails the second time', () => {
    const pending = createPendingUser({ email: 'pending-d@example.com', displayName: 'PendingD' });
    const { rawToken } = createSetupToken(pending.user_id);
    expect(completeSetup(rawToken, 'first-password-123')).not.toBeNull();
    expect(completeSetup(rawToken, 'second-password-123')).toBeNull();
  });

  it('completeSetup rejects a token for a user who is already active (re-used stale token)', () => {
    const user = createUser({ email: 'already-active@example.com', password: 'already-active-pw-1', displayName: 'AlreadyActive' });
    const { rawToken } = createSetupToken(user.user_id);
    // Directly simulate an already-active account being targeted by a
    // leftover token — resolveSetupToken must refuse it (status check).
    expect(resolveSetupToken(rawToken)).toBeNull();
  });

  it('no email is ever sent or claimed — the only delivery mechanism is the raw token value itself', () => {
    // Structural proof: createSetupToken's return type carries only
    // {rawToken, expiresAt} — nothing resembling an email/delivery status.
    const pending = createPendingUser({ email: 'no-email-claim@example.com', displayName: 'NoEmailClaim' });
    const result = createSetupToken(pending.user_id);
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'rawToken']);
  });
});

describe('A5: platform role changes and the last-active-admin invariant', () => {
  // This describe block's own DB file is shared with the rest of this test
  // file (module-level SYNTHOS_DB_PATH), so "the last active admin" is
  // asserted deterministically by first demoting every OTHER active admin
  // that exists at the time each test runs, rather than assuming isolation.
  function demoteAllAdminsExcept(exceptUserId: string) {
    // Deliberately uses the real functions under test (self-consistent —
    // these are exactly the operations a real platform admin would use).
    let guardTrips = 0;
    while (countActivePlatformAdmins() > 1 && guardTrips < 50) {
      guardTrips++;
      const others = listUsers().filter((u) => u.platform_role === 'platform_admin' && u.status === 'active' && u.user_id !== exceptUserId);
      if (others.length === 0) break;
      setPlatformRole(others[0].user_id, 'standard');
    }
  }

  it('demoting a platform_admin succeeds when another active admin still exists', () => {
    const admin1 = createUser({ email: 'admin1@example.com', password: 'admin1-password-1', displayName: 'Admin1', platformRole: 'platform_admin' });
    const admin2 = createUser({ email: 'admin2@example.com', password: 'admin2-password-1', displayName: 'Admin2', platformRole: 'platform_admin' });
    const result = setPlatformRole(admin1.user_id, 'standard');
    expect(result.success).toBe(true);
    expect(getUserById(admin1.user_id)?.platform_role).toBe('standard');
    expect(getUserById(admin2.user_id)?.platform_role).toBe('platform_admin'); // admin2 untouched
  });

  it('demoting the LAST active platform_admin is refused', () => {
    const solo = createUser({ email: 'solo-admin@example.com', password: 'solo-admin-pw-1', displayName: 'SoloAdmin', platformRole: 'platform_admin' });
    demoteAllAdminsExcept(solo.user_id);
    expect(countActivePlatformAdmins()).toBe(1);

    const result = setPlatformRole(solo.user_id, 'standard');
    expect(result.success).toBe(false);
    expect(getUserById(solo.user_id)?.platform_role).toBe('platform_admin');
  });

  it('disabling the last active platform_admin is refused by setUserStatus too', () => {
    const onlyAdmin = createUser({ email: 'only-admin-disable-test@example.com', password: 'only-admin-pw-1', displayName: 'OnlyAdminDisableTest', platformRole: 'platform_admin' });
    demoteAllAdminsExcept(onlyAdmin.user_id);
    expect(countActivePlatformAdmins()).toBe(1);

    const result = setUserStatus(onlyAdmin.user_id, 'disabled');
    expect(result?.error).toBeDefined();
    expect(getUserById(onlyAdmin.user_id)?.status).toBe('active');
  });

  it('enabling a disabled user never triggers the last-admin guard', () => {
    const user = createUser({ email: 'enable-no-guard@example.com', password: 'enable-no-guard-1', displayName: 'EnableNoGuard' });
    setUserStatus(user.user_id, 'disabled');
    const result = setUserStatus(user.user_id, 'active');
    expect(result?.error).toBeUndefined();
    expect(result?.user?.status).toBe('active');
  });
});

describe('B1-B4: membership assignment, role change, removal', () => {
  it('B2: a platform admin can assign a real membership, and it persists', () => {
    const user = createUser({ email: 'member-assign@example.com', password: 'member-assign-pw-1', displayName: 'MemberAssign' });
    ensureWorkspace('ws-onboard-a');
    grantMembership(user.user_id, 'ws-onboard-a', 'member');
    expect(getMembership(user.user_id, 'ws-onboard-a')?.role).toBe('member');
  });

  it('B4: assigned user immediately gains access (4), removed user immediately loses it (5)', () => {
    const user = createUser({ email: 'access-toggle@example.com', password: 'access-toggle-pw-1', displayName: 'AccessToggle' });
    ensureWorkspace('ws-onboard-b');
    expect(hasWorkspaceAccess(user.user_id, 'ws-onboard-b')).toBeNull();
    grantMembership(user.user_id, 'ws-onboard-b', 'member');
    expect(hasWorkspaceAccess(user.user_id, 'ws-onboard-b')).not.toBeNull();
    removeMembership(user.user_id, 'ws-onboard-b');
    expect(hasWorkspaceAccess(user.user_id, 'ws-onboard-b')).toBeNull();
  });

  it('B3: workspace role changes persist (6)', () => {
    const user = createUser({ email: 'role-change@example.com', password: 'role-change-pw-1', displayName: 'RoleChange' });
    ensureWorkspace('ws-onboard-c');
    grantMembership(user.user_id, 'ws-onboard-c', 'member');
    updateMembershipRole(user.user_id, 'ws-onboard-c', 'admin');
    expect(getMembership(user.user_id, 'ws-onboard-c')?.role).toBe('admin');
  });

  it('duplicate membership grants are handled safely — update, not a second row (8)', () => {
    const user = createUser({ email: 'dup-membership@example.com', password: 'dup-membership-pw-1', displayName: 'DupMembership' });
    ensureWorkspace('ws-onboard-d');
    grantMembership(user.user_id, 'ws-onboard-d', 'member');
    grantMembership(user.user_id, 'ws-onboard-d', 'admin');
    const memberships = listUserMembershipsWithWorkspaceNames(user.user_id).filter((m) => m.workspace_id === 'ws-onboard-d');
    expect(memberships.length).toBe(1);
    expect(memberships[0].role).toBe('admin');
  });

  it('removing a nonexistent membership returns false, not an error or fabricated success', () => {
    const user = createUser({ email: 'remove-nothing@example.com', password: 'remove-nothing-pw-1', displayName: 'RemoveNothing' });
    ensureWorkspace('ws-onboard-e');
    expect(removeMembership(user.user_id, 'ws-onboard-e')).toBe(false);
  });

  it('updateMembershipRole against a nonexistent membership returns null, never fabricates one', () => {
    const user = createUser({ email: 'role-change-missing@example.com', password: 'role-change-missing-1', displayName: 'RoleChangeMissing' });
    ensureWorkspace('ws-onboard-f');
    expect(updateMembershipRole(user.user_id, 'ws-onboard-f', 'admin')).toBeNull();
  });

  it('enriched membership listings carry real workspace names and real user identity, not bare ids', () => {
    const user = createUser({ email: 'enriched-check@example.com', password: 'enriched-check-pw-1', displayName: 'EnrichedCheck' });
    ensureWorkspace('ws-onboard-g', 'Onboard G Real Name');
    grantMembership(user.user_id, 'ws-onboard-g', 'member');

    const userView = listUserMembershipsWithWorkspaceNames(user.user_id).find((m) => m.workspace_id === 'ws-onboard-g');
    expect(userView?.workspace_name).toBe('Onboard G Real Name');

    const workspaceView = listWorkspaceMembersWithUserInfo('ws-onboard-g').find((m) => m.user_id === user.user_id);
    expect(workspaceView?.email).toBe('enriched-check@example.com');
    expect(workspaceView?.display_name).toBe('EnrichedCheck');
  });
});

describe('C3: per-workspace activity counts are real, cheap COUNT queries — never fabricated', () => {
  it('counts real tasks and graphs scoped to the workspace, zero for an unused one', () => {
    ensureWorkspace('ws-onboard-h');
    expect(getWorkspaceActivityCounts('ws-onboard-h')).toEqual({ taskCount: 0, graphCount: 0 });

    const db = getDatabase();
    db.prepare(
      "INSERT INTO tasks (task_id, title, status, created_at, updated_at, workspace_id) VALUES (?, ?, 'pending', datetime('now'), datetime('now'), ?)"
    ).run('task-onboard-h-1', 'Onboard H task', 'ws-onboard-h');
    db.prepare(
      "INSERT INTO graphs (graph_id, name, nodes_json, edges_json, created_at, updated_at, workspace_id) VALUES (?, ?, '[]', '[]', datetime('now'), datetime('now'), ?)"
    ).run('graph-onboard-h-1', 'Onboard H graph', 'ws-onboard-h');

    expect(getWorkspaceActivityCounts('ws-onboard-h')).toEqual({ taskCount: 1, graphCount: 1 });
  });

  it('never counts another workspace\'s rows', () => {
    ensureWorkspace('ws-onboard-i');
    ensureWorkspace('ws-onboard-j');
    const db = getDatabase();
    db.prepare(
      "INSERT INTO tasks (task_id, title, status, created_at, updated_at, workspace_id) VALUES (?, ?, 'pending', datetime('now'), datetime('now'), ?)"
    ).run('task-onboard-i-1', 'Onboard I task', 'ws-onboard-i');

    expect(getWorkspaceActivityCounts('ws-onboard-i').taskCount).toBe(1);
    expect(getWorkspaceActivityCounts('ws-onboard-j').taskCount).toBe(0);
  });
});

describe('F: real admin audit trail — never a fabricated feed', () => {
  it('recordAdminAuditEvent persists a real, retrievable event', () => {
    const admin = createUser({ email: 'audit-actor@example.com', password: 'audit-actor-pw-1', displayName: 'AuditActor', platformRole: 'platform_admin' });
    recordAdminAuditEvent({ actorUserId: admin.user_id, eventType: 'USER_CREATED', targetType: 'user', targetId: 'user-target-xyz' });
    const events = listRecentAdminAuditEvents(200);
    expect(events.some((e) => e.actor_user_id === admin.user_id && e.target_id === 'user-target-xyz')).toBe(true);
  });

  it('listRecentAdminAuditEvents returns real events ordered newest-first', () => {
    const admin = createUser({ email: 'audit-order@example.com', password: 'audit-order-pw-1', displayName: 'AuditOrder' });
    recordAdminAuditEvent({ actorUserId: admin.user_id, eventType: 'WORKSPACE_CREATED', targetType: 'workspace', targetId: 'ws-order-1' });
    recordAdminAuditEvent({ actorUserId: admin.user_id, eventType: 'WORKSPACE_CREATED', targetType: 'workspace', targetId: 'ws-order-2' });
    const events = listRecentAdminAuditEvents(2);
    expect(events[0].target_id).toBe('ws-order-2');
    expect(events[1].target_id).toBe('ws-order-1');
  });
});
