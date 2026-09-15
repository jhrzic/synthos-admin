import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-brain-surface-'));
const VAULT = path.join(TMP, 'vault');
fs.mkdirSync(VAULT, { recursive: true });
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'brain.db');

import {
  writeKnowledgeNote,
  listKnowledgeNotesDetailed,
  parseNoteFrontmatter,
  extractWikilinks,
} from '../lib/knowledge-vault';

// ---------------------------------------------------------------------------
// THE BRAIN SURFACE MUST SHOW THE BRAIN.
//
// The Admin's Obsidian Knowledge Mesh was rendering INITIAL_NOTES from
// src/data/mockData.ts, persisted per-browser in localStorage. So the
// knowledge graph on screen was a graph of invented notes about invented
// startups, while the real vault — the one the Brain actually writes to — was
// not reachable from any screen.
//
// Architecture rule these tests encode: the Brain is the canonical knowledge
// system and Obsidian is a human-readable projection of it. So the surface
// reads the vault; the vault is never treated as the Brain itself, and nothing
// on the surface may be invented when the vault is empty.
// ---------------------------------------------------------------------------

const ENV = { ...process.env, SYNTHOS_VAULT_PATH: VAULT } as NodeJS.ProcessEnv;

beforeAll(() => {
  // A note with FULL provenance, written by the real writer — not a fixture
  // string, so the parser is tested against the real on-disk format.
  writeKnowledgeNote(
    {
      title: 'Execution spine verification',
      kind: 'Sessions',
      workspaceId: 'ws-brain-test',
      source: 'core-verification',
      sessionId: 'sess-abc-123',
      runtime: 'synthos-admin',
      model: 'gpt-5.6-terra',
      topics: ['execution', 'receipts'],
      tags: ['synthos', 'verification'],
      artifacts: ['art-111', 'art-222'],
      receipts: ['rcpt-999'],
      summary: 'A run that produced a signed receipt.',
      related: ['execution-kernel', 'receipt-chain'],
    },
    'Body text referencing [[verification-gate]] and [[execution-kernel]] again.\n',
    ENV,
  );

  // A deliberately SPARSE note: only the fields the writer always emits. Its
  // absent fields must read as absent, never be filled in.
  writeKnowledgeNote(
    {
      title: 'Sparse note',
      kind: 'Decisions',
      workspaceId: 'ws-brain-test',
      source: 'manual',
    },
    'No wikilinks, no receipts, no model.\n',
    ENV,
  );
});

describe('frontmatter is parsed, never guessed', () => {
  it('reads quoted scalars and bracketed lists as written', () => {
    const fm = parseNoteFrontmatter([
      '---',
      'title: "A title: with a colon"',
      'model: "gpt-5.6-terra"',
      'topics: ["one", "two"]',
      'generated_by: "SynthOS"',
      '---',
      '',
      '# Body',
    ].join('\n'));

    expect(fm.title).toBe('"A title: with a colon"');
    expect(fm.topics).toBe('["one", "two"]');
  });

  it('a note with no frontmatter yields an empty map rather than defaults', () => {
    expect(parseNoteFrontmatter('# Just a heading\n\nSome text.')).toEqual({});
  });

  it('an unterminated frontmatter block is not half-parsed', () => {
    expect(parseNoteFrontmatter('---\ntitle: "x"\nno closing fence')).toEqual({});
  });
});

describe('wikilinks are the real relationships, as written', () => {
  it('extracts targets, strips aliases and anchors, and deduplicates', () => {
    const links = extractWikilinks('See [[alpha]], [[beta|Beta Label]], [[gamma#section]] and [[alpha]] again.');
    expect(links).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('a body with no links yields an empty list, not a synthesised one', () => {
    expect(extractWikilinks('Plain prose with no links at all.')).toEqual([]);
  });

  // Guards against the temptation to derive a graph from folders or tags when
  // a note genuinely has no relationships — that would be a fabricated graph.
  it('never invents a link from tags or folder names', () => {
    expect(extractWikilinks('#tagged text in Sessions/ folder')).toEqual([]);
  });
});

describe('the surface reads real notes with their provenance chain', () => {
  it('returns the notes actually on disk, with title from frontmatter', () => {
    const notes = listKnowledgeNotesDetailed(ENV);
    expect(notes.length).toBe(2);
    expect(notes.map((n) => n.title).sort()).toEqual(['Execution spine verification', 'Sparse note']);
  });

  it('carries the full provenance chain the Admin needs to show', () => {
    const note = listKnowledgeNotesDetailed(ENV).find((n) => n.title === 'Execution spine verification')!;
    expect(note.workspaceId).toBe('ws-brain-test');
    expect(note.source).toBe('core-verification');
    expect(note.sessionId).toBe('sess-abc-123');
    expect(note.runtime).toBe('synthos-admin');
    expect(note.model).toBe('gpt-5.6-terra');
    expect(note.kind).toBe('Sessions');
    expect(note.generatedBy).toBe('SynthOS');
    expect(note.topics).toEqual(['execution', 'receipts']);
    expect(note.tags).toEqual(['synthos', 'verification']);
  });

  it('links a note back to the evidence spine — the artifacts and receipts it cites', () => {
    const note = listKnowledgeNotesDetailed(ENV).find((n) => n.title === 'Execution spine verification')!;
    expect(note.artifacts).toEqual(['art-111', 'art-222']);
    expect(note.receipts).toEqual(['rcpt-999']);
  });

  it('collects wikilinks from the real rendered body, including the Related block', () => {
    const note = listKnowledgeNotesDetailed(ENV).find((n) => n.title === 'Execution spine verification')!;
    expect(note.wikilinks).toContain('verification-gate');
    expect(note.wikilinks).toContain('execution-kernel');
    expect(note.wikilinks).toContain('receipt-chain');
    // Deduplicated even though execution-kernel appears twice.
    expect(note.wikilinks.filter((w) => w === 'execution-kernel').length).toBe(1);
  });

  // The whole point: no field is ever filled in with something plausible.
  it('a sparse note reports its absent fields as null rather than inventing them', () => {
    const note = listKnowledgeNotesDetailed(ENV).find((n) => n.title === 'Sparse note')!;
    expect(note.model).toBeNull();
    expect(note.sessionId).toBeNull();
    expect(note.runtime).toBeNull();
    expect(note.artifacts).toEqual([]);
    expect(note.receipts).toEqual([]);
    expect(note.wikilinks).toEqual([]);
    // But what IS present is real.
    expect(note.source).toBe('manual');
    expect(note.workspaceId).toBe('ws-brain-test');
  });

  it('an empty vault returns an empty list — never a sample note', () => {
    const emptyVault = path.join(TMP, 'empty-vault');
    fs.mkdirSync(emptyVault, { recursive: true });
    const notes = listKnowledgeNotesDetailed({ ...process.env, SYNTHOS_VAULT_PATH: emptyVault } as NodeJS.ProcessEnv);
    expect(notes).toEqual([]);
  });

  it('reads only the bounded SynthOS/ subtree, so a private vault is not inventoried', () => {
    // A note the user wrote themselves, outside SynthOS/.
    const personal = path.join(VAULT, '10-context');
    fs.mkdirSync(personal, { recursive: true });
    fs.writeFileSync(path.join(personal, 'my-private-note.md'), '# Private\n\nNot SynthOS output.\n');

    const notes = listKnowledgeNotesDetailed(ENV);
    expect(notes.every((n) => n.vaultRelativePath.startsWith('SynthOS/'))).toBe(true);
    expect(notes.some((n) => n.title === 'Private')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source guard. The library can be correct while the screen still renders
// mockData — which is exactly the state this work found.
// ---------------------------------------------------------------------------
describe('the Admin surface renders the real vault, not fixtures', () => {
  const view = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianView.tsx'), 'utf8');

  it('the knowledge mesh is fed real vault notes', () => {
    expect(view).toContain('/api/knowledge/mesh');
    expect(view).toMatch(/<ObsidianGraphMind[\s\S]{0,200}notes=\{brainNotes\}/);
  });

  it('the graph is NOT fed the session-local fixture prop', () => {
    expect(
      /<ObsidianGraphMind[\s\S]{0,200}notes=\{notes\}/.test(view),
      'the knowledge graph is being fed the fixture `notes` prop again — that is the mockData regression',
    ).toBe(false);
  });

  it('an empty vault renders an explicit empty state instead of a graph of nothing', () => {
    expect(view).toContain('No SynthOS knowledge notes yet');
  });

  it('the surface states which vault it is reading, because EXTERNAL and LOCAL_FALLBACK are not the same claim', () => {
    expect(view).toContain('isObsidianIntegration');
    expect(view).toContain('not an Obsidian integration');
  });
});
