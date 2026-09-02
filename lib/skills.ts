// ---------------------------------------------------------------------------
// SYNTHOS — real, workspace-scoped skill registry.
//
// Replaces the previous SkillRegistryView / App.tsx session-only useState
// (seeded from fabricated demo entries with hardcoded call counts and a
// "Sandbox" test that asked an LLM to roleplay a tool's output). This module
// is the real backing store: SQLite (no new engine), workspace-scoped,
// no secrets persisted.
//
// Truth boundary: no execution runtime for arbitrary skills is wired into
// this deployment (no real sandbox, no MCP client). testSkill() always
// returns NOT_IMPLEMENTED and says so — it never claims a fabricated
// success. What IS real: the skill record, its enabled/workspace state, and
// the recorded history of test *attempts* (used to derive callCount, never
// a hand-set fabricated number).
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDatabase } from './persistence';

export type SkillCategory = 'system' | 'mcp' | 'custom' | 'tool' | 'integration';

export interface SkillRecord {
  skill_id: string;
  workspace_id: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
  enabled: boolean;
  status: 'NOT_CONFIGURED';
  source_type: string;
  source_ref: string | null;
  markdown_spec: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillRecordWithStats extends SkillRecord {
  callCount: number;
  successCount: number;
  lastTestedAt: string | null;
}

interface SkillRow {
  skill_id: string;
  workspace_id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  enabled: number;
  status: string;
  source_type: string;
  source_ref: string | null;
  markdown_spec: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: SkillRow): SkillRecord {
  return {
    skill_id: row.skill_id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description,
    category: row.category as SkillCategory,
    version: row.version,
    enabled: !!row.enabled,
    status: 'NOT_CONFIGURED',
    source_type: row.source_type,
    source_ref: row.source_ref,
    markdown_spec: row.markdown_spec,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function withStats(record: SkillRecord): SkillRecordWithStats {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successes,
      MAX(created_at) AS last_at
    FROM skill_test_events
    WHERE skill_id = ? AND workspace_id = ?
  `).get(record.skill_id, record.workspace_id) as { total: number; successes: number | null; last_at: string | null };

  return {
    ...record,
    callCount: row?.total || 0,
    successCount: row?.successes || 0,
    lastTestedAt: row?.last_at || null,
  };
}

export function listWorkspaceSkills(workspaceId: string): SkillRecordWithStats[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM skills WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId) as SkillRow[];
  return rows.map((r) => withStats(toRecord(r)));
}

export function getWorkspaceSkill(workspaceId: string, skillId: string): SkillRecordWithStats | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM skills WHERE workspace_id = ? AND skill_id = ?').get(workspaceId, skillId) as SkillRow | undefined;
  if (!row) return null;
  return withStats(toRecord(row));
}

export function createSkill(params: {
  workspaceId: string;
  name: string;
  description?: string;
  category?: SkillCategory;
  version?: string;
  sourceType?: string;
  sourceRef?: string;
  markdownSpec?: string;
  enabled?: boolean;
}): SkillRecordWithStats {
  const db = getDatabase();
  const now = new Date().toISOString();
  const skillId = `skill-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  db.prepare(`
    INSERT INTO skills (skill_id, workspace_id, name, description, category, version, enabled, status, source_type, source_ref, markdown_spec, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'NOT_CONFIGURED', ?, ?, ?, ?, ?)
  `).run(
    skillId,
    params.workspaceId,
    params.name,
    params.description || '',
    params.category || 'custom',
    params.version || '0.1.0',
    params.enabled === false ? 0 : 1,
    params.sourceType || 'manual',
    params.sourceRef || null,
    params.markdownSpec || null,
    now,
    now
  );

  return getWorkspaceSkill(params.workspaceId, skillId)!;
}

/**
 * Returns null (never throws, never silently no-ops on the wrong workspace)
 * if the skill doesn't exist in this workspace — same non-disclosure
 * pattern as tasks/graphs/vault: an unknown id and a wrong-workspace id are
 * indistinguishable to the caller.
 */
export function updateSkill(
  workspaceId: string,
  skillId: string,
  patch: Partial<Pick<SkillRecord, 'name' | 'description' | 'category' | 'version' | 'enabled' | 'source_ref' | 'markdown_spec'>>
): SkillRecordWithStats | null {
  const existing = getWorkspaceSkill(workspaceId, skillId);
  if (!existing) return null;

  const db = getDatabase();
  const next = { ...existing, ...patch };
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE skills SET name = ?, description = ?, category = ?, version = ?, enabled = ?, source_ref = ?, markdown_spec = ?, updated_at = ?
    WHERE workspace_id = ? AND skill_id = ?
  `).run(
    next.name,
    next.description,
    next.category,
    next.version,
    next.enabled ? 1 : 0,
    next.source_ref,
    next.markdown_spec,
    now,
    workspaceId,
    skillId
  );

  return getWorkspaceSkill(workspaceId, skillId);
}

export interface SkillTestResult {
  status: 'NOT_IMPLEMENTED';
  success: false;
  message: string;
}

/**
 * Honest skill test execution. No execution runtime for arbitrary skills
 * (no sandbox, no MCP client, no wired tool invocation) exists in this
 * deployment, so this always returns NOT_IMPLEMENTED — never a fabricated
 * "Sandbox" success. The attempt itself is still real: a row is recorded in
 * skill_test_events so the registry's derived call history reflects what
 * actually happened (a real attempt against an unimplemented runtime),
 * never a hand-set counter.
 */
export function testSkill(workspaceId: string, skillId: string): SkillTestResult | null {
  const skill = getWorkspaceSkill(workspaceId, skillId);
  if (!skill) return null;

  const db = getDatabase();
  const eventId = `ste-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const message = `No skill execution runtime is wired into this deployment. "${skill.name}" was not actually invoked — this records the attempt, not a real result.`;
  db.prepare(`
    INSERT INTO skill_test_events (event_id, skill_id, workspace_id, status, message, created_at)
    VALUES (?, ?, ?, 'NOT_IMPLEMENTED', ?, ?)
  `).run(eventId, skillId, workspaceId, message, new Date().toISOString());

  return { status: 'NOT_IMPLEMENTED', success: false, message };
}

// ---------------------------------------------------------------------------
// Bounded discovery of real skill files. Scans ONLY this fixed, approved
// directory — never an arbitrary or client-supplied path. If the directory
// doesn't exist (true today — no skill files ship with this repo), returns
// an empty list. No example/sample skills are ever invented here.
// ---------------------------------------------------------------------------

export const SKILLS_DIR = path.join(process.cwd(), 'skills');

export interface DiscoveredSkillFile {
  fileName: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    if (key) fields[key] = value;
  }
  return fields;
}

const VALID_CATEGORIES = new Set<SkillCategory>(['system', 'mcp', 'custom', 'tool', 'integration']);

export function discoverRepoSkillFiles(): DiscoveredSkillFile[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(SKILLS_DIR);
  } catch {
    // Directory doesn't exist — an honest empty result, not an error and
    // not a fabricated example.
    return [];
  }

  const root = path.resolve(SKILLS_DIR);
  const results: DiscoveredSkillFile[] = [];
  for (const fileName of entries) {
    if (!fileName.toLowerCase().endsWith('.md')) continue;
    const resolved = path.resolve(root, fileName);
    // Containment check even though fileName comes from readdirSync of a
    // fixed directory, not client input — defense in depth, same posture
    // as lib/vault.ts.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;

    let content: string;
    try {
      content = fs.readFileSync(resolved, 'utf8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    const category = VALID_CATEGORIES.has(fm.category as SkillCategory) ? (fm.category as SkillCategory) : 'custom';
    results.push({
      fileName,
      name: fm.name || fileName.replace(/\.md$/i, ''),
      description: fm.description || '',
      category,
      version: fm.version || '0.1.0',
    });
  }
  return results;
}
