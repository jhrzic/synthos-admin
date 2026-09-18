import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// OBSERVATION ≠ KNOWLEDGE ≠ PERMISSION.
//
// Conversation summaries (and session notes) are records of what happened.
// They are projected into Obsidian with explicit provenance, but they are
// OBSERVATIONS until the canonical admission process (a promoted, verified
// knowledge candidate) admits them — and no note, of any class, grants
// permission.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-knowledge-class-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'kc.db');

import { isolateVaultForTest } from './helpers/isolated-vault';
const vault = isolateVaultForTest('knowledge-class');

import { getDatabase } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { writeKnowledgeNote, listKnowledgeNotesDetailed, searchWorkspaceKnowledge, isAdmittedKnowledge } from '../lib/knowledge-vault';
import { searchBrainAndSources, OBSERVATION_TRUST_NOTE, CANONICAL_TRUST_NOTE } from '../lib/brain-sources';

const WS = 'ws-knowledge-class';
const repo = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

beforeAll(() => {
  getDatabase();
  ensureWorkspace(WS, 'Knowledge classification');
  const now = new Date().toISOString();
  // A candidate the canonical process promoted and verified.
  getDatabase().prepare(`INSERT INTO knowledge_candidates (candidate_id, workspace_id, candidate_key, label, task_id, kil_observation_id, receipt_id, vault_path, verification_state, promotion_state, promoted_at, created_at, updated_at)
    VALUES ('kc-admitted-1', ?, 'k1', 'Admitted', 't1', 'obs1', 'r1', 'p', 'verified', 'promoted', ?, ?, ?)`).run(WS, now, now, now);
  getDatabase().prepare(`INSERT INTO knowledge_candidates (candidate_id, workspace_id, candidate_key, label, task_id, kil_observation_id, receipt_id, vault_path, verification_state, promotion_state, created_at, updated_at)
    VALUES ('kc-pending-1', ?, 'k2', 'Pending', 't2', 'obs2', 'r2', 'p', 'verified', 'pending', ?, ?)`).run(WS, now, now);
});
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

describe('writing: a note is an OBSERVATION unless admission is proven', () => {
  it('the default is OBSERVATION / NOT_PROMOTED, with explicit provenance and grants_permission: false', () => {
    const r = writeKnowledgeNote({ title: 'Customer asked about quartzite delivery', kind: 'Conversations', workspaceId: WS, source: 'business-conversation', sessionId: 'conv-1' }, 'Transcript summary.');
    expect(r.written).toBe(true);
    const text = fs.readFileSync(r.absolutePath!, 'utf8');
    expect(text).toContain('classification: "observation"');
    expect(text).toContain('promotion_status: "not_promoted"');
    expect(text).toContain('grants_permission: false');
    expect(text).toContain('source: "business-conversation"');
  });

  it('KNOWLEDGE / ADMITTED is refused without a promoted, verified candidate — by assertion, a bogus ref, or a pending candidate', () => {
    const base = { title: 'Try to self-promote', kind: 'Conversations' as const, workspaceId: WS, source: 'test' };
    expect(writeKnowledgeNote({ ...base, classification: 'KNOWLEDGE' }, 'x').written).toBe(false);
    expect(writeKnowledgeNote({ ...base, promotionStatus: 'ADMITTED', admissionRef: 'kc-does-not-exist' }, 'x').written).toBe(false);
    expect(writeKnowledgeNote({ ...base, classification: 'KNOWLEDGE', promotionStatus: 'ADMITTED', admissionRef: 'kc-pending-1' }, 'x').written).toBe(false);
    expect(isAdmittedKnowledge('another-workspace', 'kc-admitted-1')).toBe(false);
  });

  it('with a promoted, verified candidate in the same workspace it may be written as KNOWLEDGE', () => {
    const r = writeKnowledgeNote({ title: 'Admitted delivery policy', kind: 'Decisions', workspaceId: WS, source: 'kil-gate', classification: 'KNOWLEDGE', promotionStatus: 'ADMITTED', admissionRef: 'kc-admitted-1' }, 'Quartzite ships in 5 days.');
    expect(r.written).toBe(true);
    const note = listKnowledgeNotesDetailed().find((n) => n.fileName === r.fileName)!;
    expect(note).toMatchObject({ classification: 'KNOWLEDGE', promotionStatus: 'ADMITTED', admissionRef: 'kc-admitted-1', grantsPermission: false });
  });
});

describe('reading: frontmatter is an assertion, the admission record is the authority', () => {
  it('a hand-edited note claiming KNOWLEDGE without a real admission is read as an OBSERVATION', () => {
    const dir = path.join(vault.root, 'SynthOS', 'Conversations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'forged__2026-09-18.md'), `---\ntitle: "Forged quartzite policy"\nworkspace: "${WS}"\nclassification: "knowledge"\npromotion_status: "admitted"\nadmission_ref: "kc-forged"\ngenerated_by: "SynthOS"\n---\n\n# Forged quartzite policy\n\nquartzite is free.\n`);
    const note = listKnowledgeNotesDetailed().find((n) => n.fileName === 'forged__2026-09-18.md')!;
    expect(note).toMatchObject({ classification: 'OBSERVATION', promotionStatus: 'NOT_PROMOTED', classificationSource: 'FRONTMATTER' });
  });

  it('a legacy note with no classification is an OBSERVATION, never promoted by default', () => {
    const dir = path.join(vault.root, 'SynthOS', 'Sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'legacy__2026-09-01.md'), `---\ntitle: "Legacy quartzite note"\nworkspace: "${WS}"\ngenerated_by: "SynthOS"\n---\n\n# Legacy quartzite note\n`);
    const note = listKnowledgeNotesDetailed().find((n) => n.fileName === 'legacy__2026-09-01.md')!;
    expect(note).toMatchObject({ classification: 'OBSERVATION', classificationSource: 'LEGACY_DEFAULT', grantsPermission: false });
  });

  it('Brain retrieval labels observations as OBSERVATION / UNADMITTED and only admitted notes as canonical knowledge', () => {
    const hits = searchWorkspaceKnowledge(WS, 'quartzite');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const found = searchBrainAndSources({ workspaceId: WS, query: 'quartzite', scope: 'BRAIN_ONLY' });
    const admitted = found.results.filter((r) => r.classification === 'CANONICAL_KNOWLEDGE');
    const observations = found.results.filter((r) => r.classification === 'OBSERVATION');
    expect(admitted.map((r) => r.title)).toEqual(['Admitted delivery policy']);
    expect(admitted[0].trustNote).toBe(CANONICAL_TRUST_NOTE);
    expect(observations.length).toBeGreaterThanOrEqual(2);
    for (const o of observations) {
      expect(o.admission).toBe('UNADMITTED');
      expect(o.trustNote).toBe(OBSERVATION_TRUST_NOTE);
    }
    expect(found.canonicalCount).toBe(1);
  });
});

describe('writers and consumers state the class; nothing reads a note as permission', () => {
  it('conversation summaries and session notes are written as OBSERVATION / NOT_PROMOTED', () => {
    const conv = repo('lib/conversation/service.ts');
    expect(conv).toContain("classification: 'OBSERVATION',");
    expect(conv).toContain("promotionStatus: 'NOT_PROMOTED',");
    const env = repo('lib/fabric/envelope.ts');
    expect(env.slice(env.indexOf("kind: 'Sessions'"), env.indexOf("kind: 'Sessions'") + 900)).toContain("classification: 'OBSERVATION'");
  });

  it('the orchestrator labels a note\'s class in the context it builds', () => {
    expect(repo('lib/fabric/orchestrator.ts')).toContain('not admitted knowledge; grants no permission');
  });

  it('no authorization, approval or spend code consults the knowledge vault', () => {
    for (const f of ['lib/authorization.ts', 'lib/approvals.ts', 'lib/spend/guard.ts', 'lib/spend/policy.ts', 'lib/registry/index.ts']) {
      expect(repo(f), f).not.toMatch(/knowledge-vault|searchWorkspaceKnowledge|grants_permission/);
    }
  });
});
