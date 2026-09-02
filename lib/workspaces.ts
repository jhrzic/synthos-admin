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
