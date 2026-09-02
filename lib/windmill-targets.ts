import crypto from 'node:crypto';
import { getDatabase } from './persistence';

// ---------------------------------------------------------------------------
// ADR-006 / Workstream K — the allowed Windmill target registry.
//
// This is the ONLY mechanism that turns a logical name into a remote
// script/flow path. No route anywhere accepts a caller-supplied remote path
// directly (R3) — every submission resolves `targetId` through this table.
// A target is either platform-global (workspace_id NULL, visible to every
// workspace) or scoped to exactly one workspace.
// ---------------------------------------------------------------------------

export type WindmillTargetKind = 'script' | 'flow';

export interface WindmillTargetRecord {
  id: string;
  workspace_id: string | null;
  name: string;
  remote_path: string;
  kind: WindmillTargetKind;
  enabled: boolean;
  description: string | null;
  input_schema_json: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

interface WindmillTargetRow {
  id: string;
  workspace_id: string | null;
  name: string;
  remote_path: string;
  kind: string;
  enabled: number;
  description: string | null;
  input_schema_json: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

function toRecord(row: WindmillTargetRow): WindmillTargetRecord {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    remote_path: row.remote_path,
    kind: (row.kind as WindmillTargetKind) || 'script',
    enabled: !!row.enabled,
    description: row.description,
    input_schema_json: row.input_schema_json,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** A remote path must be a bounded, safe-looking Windmill path segment — never containing traversal or protocol markers. */
export function isValidRemotePath(remotePath: string): boolean {
  if (typeof remotePath !== 'string') return false;
  const trimmed = remotePath.trim();
  if (!trimmed || trimmed.length > 300) return false;
  if (trimmed.includes('..') || trimmed.includes('://')) return false;
  return /^[a-zA-Z0-9_\-\/]+$/.test(trimmed);
}

/**
 * Every target visible to a workspace: its own workspace-scoped targets
 * plus every platform-global one. Never targets scoped to a *different*
 * workspace (K2/R3).
 */
export function listVisibleWindmillTargets(workspaceId: string): WindmillTargetRecord[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT * FROM windmill_targets WHERE workspace_id IS NULL OR workspace_id = ? ORDER BY created_at DESC`
  ).all(workspaceId) as WindmillTargetRow[];
  return rows.map(toRecord);
}

export function listPlatformWindmillTargets(): WindmillTargetRecord[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM windmill_targets ORDER BY created_at DESC`).all() as WindmillTargetRow[];
  return rows.map(toRecord);
}

/** Resolves a targetId to a usable record IF it is visible to the given workspace and enabled — the one real gate every submission path must pass through (K4/R3). */
export function resolveWindmillTarget(workspaceId: string, targetId: string): WindmillTargetRecord | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT * FROM windmill_targets WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)`
  ).get(targetId, workspaceId) as WindmillTargetRow | undefined;
  if (!row) return null;
  const record = toRecord(row);
  return record.enabled ? record : null;
}

export function createWindmillTarget(params: {
  workspaceId: string | null;
  name: string;
  remotePath: string;
  kind?: WindmillTargetKind;
  description?: string;
  inputSchema?: unknown;
  enabled?: boolean;
  createdByUserId: string;
}): WindmillTargetRecord {
  if (!isValidRemotePath(params.remotePath)) {
    throw new Error('remotePath must be a bounded path of letters, digits, "_", "-", and "/" only.');
  }
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = `wmt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare(`
    INSERT INTO windmill_targets (id, workspace_id, name, remote_path, kind, enabled, description, input_schema_json, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.workspaceId ?? null,
    params.name.trim(),
    params.remotePath.trim(),
    params.kind || 'script',
    params.enabled === false ? 0 : 1,
    params.description || null,
    params.inputSchema ? JSON.stringify(params.inputSchema) : null,
    params.createdByUserId,
    now,
    now
  );
  return toRecord(db.prepare('SELECT * FROM windmill_targets WHERE id = ?').get(id) as WindmillTargetRow);
}

/** Returns null for an unknown id or one outside the caller's platform/workspace scope — same non-disclosure pattern as tasks/skills. */
export function updateWindmillTarget(
  scopeWorkspaceId: string | null,
  targetId: string,
  patch: Partial<Pick<WindmillTargetRecord, 'name' | 'remote_path' | 'kind' | 'enabled' | 'description'>> & { inputSchema?: unknown }
): WindmillTargetRecord | null {
  const db = getDatabase();
  const existingRow = db.prepare('SELECT * FROM windmill_targets WHERE id = ?').get(targetId) as WindmillTargetRow | undefined;
  if (!existingRow) return null;
  // A workspace-scoped caller (non-null scopeWorkspaceId) may only edit its
  // own workspace's targets — never a platform-global one or another
  // workspace's. A platform admin (scopeWorkspaceId === null) may edit any.
  if (scopeWorkspaceId !== null && existingRow.workspace_id !== scopeWorkspaceId) return null;

  if (patch.remote_path !== undefined && !isValidRemotePath(patch.remote_path)) {
    throw new Error('remotePath must be a bounded path of letters, digits, "_", "-", and "/" only.');
  }

  const existing = toRecord(existingRow);
  const next = { ...existing, ...patch };
  const now = new Date().toISOString();
  const inputSchemaJson = Object.prototype.hasOwnProperty.call(patch, 'inputSchema')
    ? (patch.inputSchema ? JSON.stringify(patch.inputSchema) : null)
    : existing.input_schema_json;

  db.prepare(`
    UPDATE windmill_targets SET name = ?, remote_path = ?, kind = ?, enabled = ?, description = ?, input_schema_json = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.remote_path, next.kind, next.enabled ? 1 : 0, next.description, inputSchemaJson, now, targetId);

  return toRecord(db.prepare('SELECT * FROM windmill_targets WHERE id = ?').get(targetId) as WindmillTargetRow);
}

/**
 * K4 — validates a job input against the target's stored JSON Schema, if
 * one is configured. No schema configured means no validation is performed
 * (never a fabricated schema, per the workstream's own instruction).
 * Deliberately a small, dependency-free structural check (type + required
 * keys for a top-level object schema) rather than pulling in a full JSON
 * Schema validator for one bounded use.
 */
export function validateAgainstInputSchema(target: WindmillTargetRecord, input: Record<string, unknown>): { valid: boolean; error?: string } {
  if (!target.input_schema_json) return { valid: true };
  let schema: any;
  try {
    schema = JSON.parse(target.input_schema_json);
  } catch {
    return { valid: true }; // a malformed stored schema must never block execution silently-wrongly; treat as absent
  }
  if (!schema || typeof schema !== 'object') return { valid: true };

  if (schema.type === 'object' && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!(key in (input || {}))) {
        return { valid: false, error: `Missing required input field "${key}".` };
      }
    }
  }
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, propSchema] of Object.entries<any>(schema.properties)) {
      if (!(key in (input || {}))) continue;
      const expectedType = propSchema?.type;
      if (!expectedType) continue;
      const actual = (input as any)[key];
      const actualType = Array.isArray(actual) ? 'array' : typeof actual;
      if (expectedType !== actualType) {
        return { valid: false, error: `Field "${key}" must be of type "${expectedType}", got "${actualType}".` };
      }
    }
  }
  return { valid: true };
}
