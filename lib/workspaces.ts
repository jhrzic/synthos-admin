// ---------------------------------------------------------------------------
// SYNTHOS — real workspaces and the one canonical membership relation.
//
// Before this pass, `workspace_id` was a bare string nobody validated
// against a canonical list — this module makes workspaces a real,
// listable entity, and workspace_memberships the single source of truth
// for "which user may access which workspace." Deliberately not a second
// "workspace_members" table alongside this one (see ADR-003 / Pass III B1).
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';

export type WorkspaceRole = 'admin' | 'member';

export interface WorkspaceRecord {
  workspace_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface MembershipRecord {
  user_id: string;
  workspace_id: string;
  role: WorkspaceRole;
  status: 'active' | 'disabled';
  created_at: string;
}

export function ensureWorkspace(workspaceId: string, name?: string): WorkspaceRecord {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM workspaces WHERE workspace_id = ?').get(workspaceId) as WorkspaceRecord | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workspaces (workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(workspaceId, name || workspaceId, now, now);
  return { workspace_id: workspaceId, name: name || workspaceId, created_at: now, updated_at: now };
}

export function getWorkspace(workspaceId: string): WorkspaceRecord | null {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM workspaces WHERE workspace_id = ?').get(workspaceId) as WorkspaceRecord | undefined) || null;
}

export function listWorkspaces(): WorkspaceRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as WorkspaceRecord[];
}

export function createWorkspace(name: string): WorkspaceRecord {
  const workspaceId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return ensureWorkspace(workspaceId, name);
}

export function grantMembership(userId: string, workspaceId: string, role: WorkspaceRole = 'member'): MembershipRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = getMembership(userId, workspaceId);
  if (existing) {
    db.prepare('UPDATE workspace_memberships SET role = ?, status = ? WHERE user_id = ? AND workspace_id = ?')
      .run(role, 'active', userId, workspaceId);
    return { ...existing, role, status: 'active' };
  }
  db.prepare('INSERT INTO workspace_memberships (user_id, workspace_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, workspaceId, role, 'active', now);
  return { user_id: userId, workspace_id: workspaceId, role, status: 'active', created_at: now };
}

export function getMembership(userId: string, workspaceId: string): MembershipRecord | null {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?').get(userId, workspaceId) as MembershipRecord | undefined) || null;
}

/** Real, active membership only — a disabled/removed membership is treated as no access. */
export function hasWorkspaceAccess(userId: string, workspaceId: string): MembershipRecord | null {
  const membership = getMembership(userId, workspaceId);
  if (!membership || membership.status !== 'active') return null;
  return membership;
}

export function listUserMemberships(userId: string): MembershipRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM workspace_memberships WHERE user_id = ? AND status = ? ORDER BY created_at ASC').all(userId, 'active') as MembershipRecord[];
}

export function listWorkspaceMembers(workspaceId: string): MembershipRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM workspace_memberships WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId) as MembershipRecord[];
}

export function countWorkspaceMembers(workspaceId: string): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE workspace_id = ? AND status = 'active'").get(workspaceId) as { n: number };
  return row.n;
}

/**
 * Real per-workspace activity counts (Pass IV / C3) — cheap because `tasks`
 * and `graphs` already carry a real `workspace_id` column (lib/persistence.ts),
 * so this is a plain indexed COUNT, not new architecture. Deliberately does
 * NOT include a vault/note count: the Obsidian vault is filesystem-scoped,
 * not workspace-scoped in the DB, and faking that mapping would be worse
 * than omitting it (C3's own instruction: only if cheap and real).
 */
export function getWorkspaceActivityCounts(workspaceId: string): { taskCount: number; graphCount: number } {
  const db = getDatabase();
  const tasks = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?').get(workspaceId) as { n: number };
  const graphs = db.prepare('SELECT COUNT(*) AS n FROM graphs WHERE workspace_id = ?').get(workspaceId) as { n: number };
  return { taskCount: tasks.n, graphCount: graphs.n };
}

/**
 * Real removal (a hard DELETE, not a soft "disabled" status) — B4. No
 * "last owner" invariant exists in this schema (there is no `owner` role
 * distinct from `admin`, and a workspace left with zero members is
 * recoverable by any platform_admin re-granting membership — unlike the
 * last-platform-admin case in lib/auth.ts, which has no recovery path at
 * all). Per B4's own instruction not to invent an invariant that doesn't
 * exist: this is reported as current behavior, not silently guarded.
 */
export function removeMembership(userId: string, workspaceId: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?').run(userId, workspaceId);
  return (result as any).changes > 0;
}

export function updateMembershipRole(userId: string, workspaceId: string, role: WorkspaceRole): MembershipRecord | null {
  const existing = getMembership(userId, workspaceId);
  if (!existing) return null;
  const db = getDatabase();
  db.prepare('UPDATE workspace_memberships SET role = ? WHERE user_id = ? AND workspace_id = ?').run(role, userId, workspaceId);
  return { ...existing, role };
}

export interface MembershipWithWorkspaceName extends MembershipRecord {
  workspace_name: string;
}

/** listUserMemberships, enriched with the real workspace name — needed anywhere a human-readable switcher/list is shown, not just raw ids. */
export function listUserMembershipsWithWorkspaceNames(userId: string): MembershipWithWorkspaceName[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT m.*, w.name AS workspace_name
    FROM workspace_memberships m
    JOIN workspaces w ON w.workspace_id = m.workspace_id
    WHERE m.user_id = ? AND m.status = 'active'
    ORDER BY m.created_at ASC
  `).all(userId) as MembershipWithWorkspaceName[];
}

export interface MembershipWithUserInfo extends MembershipRecord {
  email: string;
  display_name: string;
}

/** listWorkspaceMembers, enriched with the real user's email/display name — needed for a workspace detail panel, not just raw user_ids. */
export function listWorkspaceMembersWithUserInfo(workspaceId: string): MembershipWithUserInfo[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT m.*, u.email AS email, u.display_name AS display_name
    FROM workspace_memberships m
    JOIN users u ON u.user_id = m.user_id
    WHERE m.workspace_id = ?
    ORDER BY m.created_at ASC
  `).all(workspaceId) as MembershipWithUserInfo[];
}
