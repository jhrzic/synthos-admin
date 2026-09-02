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
import { classifyModelRequest } from './model-router';
import { encryptCredential, credentialEncryptionConfigured } from './mcp-client';

export type SkillCategory = 'system' | 'mcp' | 'custom' | 'tool' | 'integration';

// Pass V / Workstream E2 — the discriminated execution-target type. A skill
// with no target (the default for every pre-existing skill and every new
// one unless explicitly set) is REGISTERED but never EXECUTABLE — this is
// not inferred from `enabled`, `category`, or anything else; it is this
// one explicit field. See classifySkillExecutability below.
export type ExecutionTargetType = 'model' | 'deterministic' | 'mcp_tool' | 'hermes_runtime';

/**
 * E3 — the deterministic-skill whitelist. Deliberately tiny and explicit:
 * only real, already-workspace-scoped, read-only functions this codebase
 * already exposes elsewhere (lib/vault.ts, lib/memory-index.ts). This is
 * NOT a generic "expose any server function" mechanism — adding an entry
 * here is a deliberate code change, never data-driven.
 */
export const DETERMINISTIC_ACTIONS = ['vault.list', 'memory.search'] as const;
export type DeterministicAction = (typeof DETERMINISTIC_ACTIONS)[number];

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
  execution_target_type: ExecutionTargetType | null;
  execution_target_ref: string | null;
  credential_configured: boolean;
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
  execution_target_type: string | null;
  execution_target_ref: string | null;
  credential_ciphertext: string | null;
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
    execution_target_type: (row.execution_target_type as ExecutionTargetType) || null,
    execution_target_ref: row.execution_target_ref,
    // Never the ciphertext itself — only whether a credential exists (F2).
    credential_configured: !!row.credential_ciphertext,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Internal-only accessor — the decrypted credential never leaves lib/skills.ts or lib/skill-execution.ts. */
export function getRawCredentialCiphertext(workspaceId: string, skillId: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT credential_ciphertext FROM skills WHERE workspace_id = ? AND skill_id = ?').get(workspaceId, skillId) as { credential_ciphertext: string | null } | undefined;
  return row?.credential_ciphertext || null;
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

/**
 * Real URL validation for an MCP-category skill's HTTP(S) endpoint
 * reference — F2's "if HTTP/SSE transport exists: validate URLs." Only
 * validates shape (a real, well-formed http/https URL) — it never makes a
 * network call, since a live connectivity probe against a caller-supplied
 * URL from an authenticated-but-untrusted-endpoint would be a real SSRF
 * risk this deployment's architecture doesn't yet have a proxy boundary
 * for (see ADR-001 §6 — the MCP proxy path is still unverified/deferred).
 * A non-HTTP sourceRef (e.g. a stdio command string) is left unvalidated
 * here — that's a different, non-URL transport shape.
 */
export function isValidMcpEndpointRef(sourceRef: string): boolean {
  if (!sourceRef.startsWith('http://') && !sourceRef.startsWith('https://')) return true;
  try {
    new URL(sourceRef);
    return true;
  } catch {
    return false;
  }
}

/** Throws if a credential was supplied but no encryption key is configured — never silently stores plaintext (F2). */
function encryptCredentialOrThrow(credential: string | undefined | null): string | null {
  if (!credential) return null;
  return encryptCredential(credential); // throws if MCP_CREDENTIAL_ENCRYPTION_KEY is unset
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
  executionTargetType?: ExecutionTargetType | null;
  executionTargetRef?: string | null;
  credential?: string | null;
}): SkillRecordWithStats {
  const db = getDatabase();
  const now = new Date().toISOString();
  const skillId = `skill-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const credentialCiphertext = encryptCredentialOrThrow(params.credential);

  db.prepare(`
    INSERT INTO skills (skill_id, workspace_id, name, description, category, version, enabled, status, source_type, source_ref, markdown_spec, execution_target_type, execution_target_ref, credential_ciphertext, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'NOT_CONFIGURED', ?, ?, ?, ?, ?, ?, ?, ?)
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
    params.executionTargetType || null,
    params.executionTargetRef || null,
    credentialCiphertext,
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
  patch: Partial<Pick<SkillRecord, 'name' | 'description' | 'category' | 'version' | 'enabled' | 'source_ref' | 'markdown_spec' | 'execution_target_type' | 'execution_target_ref'>> & {
    /** Write-only. Omit to leave unchanged; pass '' or null to clear; pass a value to re-encrypt and replace. */
    credential?: string | null;
  }
): SkillRecordWithStats | null {
  const existing = getWorkspaceSkill(workspaceId, skillId);
  if (!existing) return null;

  const db = getDatabase();
  const next = { ...existing, ...patch };
  const now = new Date().toISOString();

  // 'credential' undefined => leave the stored ciphertext untouched.
  // 'credential' === '' or null => explicitly clear it.
  // 'credential' === a string => re-encrypt and replace.
  let credentialSql = '';
  let credentialArgs: unknown[] = [];
  if (Object.prototype.hasOwnProperty.call(patch, 'credential')) {
    const ciphertext = patch.credential ? encryptCredentialOrThrow(patch.credential) : null;
    credentialSql = ', credential_ciphertext = ?';
    credentialArgs = [ciphertext];
  }

  db.prepare(`
    UPDATE skills SET name = ?, description = ?, category = ?, version = ?, enabled = ?, source_ref = ?, markdown_spec = ?, execution_target_type = ?, execution_target_ref = ?, updated_at = ?${credentialSql}
    WHERE workspace_id = ? AND skill_id = ?
  `).run(
    next.name,
    next.description,
    next.category,
    next.version,
    next.enabled ? 1 : 0,
    next.source_ref,
    next.markdown_spec,
    next.execution_target_type,
    next.execution_target_ref,
    now,
    ...credentialArgs,
    workspaceId,
    skillId
  );

  return getWorkspaceSkill(workspaceId, skillId);
}

// ---------------------------------------------------------------------------
// E1/E9 — real executability classification. A skill being REGISTERED or
// ENABLED never implies EXECUTABLE — this function is the one place that
// decides it, and it decides from real evidence only (a real target set, a
// real provider-identity classification, a real credential-encryption
// configuration check) — never from `enabled` alone.
// ---------------------------------------------------------------------------

export type SkillExecutabilityReason =
  | 'DISABLED'
  | 'NO_TARGET'
  | 'MISSING_PROVIDER'
  | 'MISSING_RUNTIME'
  | 'READY';

export interface SkillExecutability {
  executable: boolean;
  reason: SkillExecutabilityReason;
  message: string;
}

export function classifySkillExecutability(skill: SkillRecord): SkillExecutability {
  if (!skill.enabled) {
    return { executable: false, reason: 'DISABLED', message: 'Skill is disabled.' };
  }
  if (!skill.execution_target_type) {
    return { executable: false, reason: 'NO_TARGET', message: 'No execution target is configured — this skill is registered but has never been wired to a real target.' };
  }

  switch (skill.execution_target_type) {
    case 'model': {
      const classification = classifyModelRequest(skill.execution_target_ref || undefined);
      if (classification.provider !== 'GEMINI') {
        return { executable: false, reason: 'MISSING_PROVIDER', message: classification.message };
      }
      if (!process.env.GEMINI_API_KEY) {
        return { executable: false, reason: 'MISSING_PROVIDER', message: 'GEMINI_API_KEY is not configured in this deployment.' };
      }
      return { executable: true, reason: 'READY', message: `Routes to Gemini model "${classification.resolvedModel}".` };
    }
    case 'hermes_runtime': {
      // execute() is an honest Phase-1 NOT_IMPLEMENTED stub (ADR-001) — no
      // real contract exists yet, so this is never executable today. See
      // docs/adr-005-runtime-provider-boundaries.md.
      return { executable: false, reason: 'MISSING_RUNTIME', message: 'The dedicated Hermes runtime execute() endpoint has no real contract in this deployment (ADR-001 Phase 3, deferred until Phase 2 passes).' };
    }
    case 'mcp_tool': {
      if (!skill.source_ref) {
        return { executable: false, reason: 'MISSING_RUNTIME', message: 'No MCP endpoint (source_ref) is configured on this skill.' };
      }
      if (!skill.execution_target_ref) {
        return { executable: false, reason: 'NO_TARGET', message: 'No MCP tool name is configured.' };
      }
      // Connectivity itself is only known at call time (a live probe) — a
      // skill is structurally executable if it has an endpoint and a tool
      // name; whether the server actually answers is discovered on execute.
      return { executable: true, reason: 'READY', message: `Will call tool "${skill.execution_target_ref}" on ${skill.source_ref} — connectivity is verified live at execution time.` };
    }
    case 'deterministic': {
      if (!DETERMINISTIC_ACTIONS.includes(skill.execution_target_ref as DeterministicAction)) {
        return { executable: false, reason: 'NO_TARGET', message: `"${skill.execution_target_ref}" is not a recognized deterministic action.` };
      }
      return { executable: true, reason: 'READY', message: `Runs the real internal action "${skill.execution_target_ref}".` };
    }
    default:
      return { executable: false, reason: 'NO_TARGET', message: 'Unrecognized execution target type.' };
  }
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
