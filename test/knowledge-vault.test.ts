import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getVaultStatus, resolveVaultPath, ensureVaultRoot, canWriteKnowledge,
  countMarkdownFiles, SYNTHOS_VAULT_SUBDIR,
} from '../lib/vault-config';
import {
  writeKnowledgeNote, listKnowledgeNotes, searchKnowledgeNotes,
  semanticSlug, extractTopics, deriveConversationSubject, renderKnowledgeNote, stripLeadingFrontmatter,
} from '../lib/knowledge-vault';

// ---------------------------------------------------------------------------
// DAYS 2-3 PART A — real vault integration.
//
// The 2026-09-12 evidence cleanup recorded a verified negative: "Obsidian is
// NOT integrated — lib/vault.ts hardcodes process.cwd()/vault, there is no
// vault-path environment variable, no watcher, and no reader for the real
// ~1,204-note vault." These tests are what converts that.
//
// Every test uses a REAL temporary directory and REAL files. Nothing is mocked,
// because the thing under test is precisely whether the filesystem behaves.
// ---------------------------------------------------------------------------

let tmp: string;
function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...extra } as NodeJS.ProcessEnv;
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-vault-')); });
afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('PART A: one canonical vault configuration, with explicit precedence', () => {
  it('SYNTHOS_VAULT_PATH wins, and is the only configured source', () => {
    const r = resolveVaultPath(env({ SYNTHOS_VAULT_PATH: tmp }));
    expect(r.root).toBe(path.resolve(tmp));
    expect(r.source).toBe('SYNTHOS_VAULT_PATH');
  });

  it('falls back to the repo-local ./vault when nothing is configured', () => {
    const r = resolveVaultPath(env());
    expect(r.source).toBe('LOCAL_FALLBACK');
    expect(r.root).toBe(path.join(process.cwd(), 'vault'));
  });

  it('expands a leading ~/ — a .env value is never shell-expanded', () => {
    const r = resolveVaultPath(env({ SYNTHOS_VAULT_PATH: '~/my-vault', HOME: '/Users/someone' }));
    expect(r.root).toBe(path.resolve('/Users/someone/my-vault'));
  });
});

describe('PART A: truth states come from real syscalls, never from a variable being set', () => {
  it('a real, writable configured vault reports EXTERNAL with every flag proven', () => {
    const s = getVaultStatus(env({ SYNTHOS_VAULT_PATH: tmp }));
    expect(s.mode).toBe('EXTERNAL');
    expect(s.configured).toBe(true);
    expect(s.exists).toBe(true);
    expect(s.isDirectory).toBe(true);
    expect(s.readable).toBe(true);
    expect(s.writable).toBe(true);
    expect(canWriteKnowledge(s)).toBe(true);
  });

  it('TEST E: a configured path that does not exist is UNAVAILABLE, never silently downgraded', () => {
    // The dangerous alternative would be falling back to ./vault and reporting
    // success — the operator would believe their vault was integrated while
    // knowledge went somewhere else entirely.
    const missing = path.join(tmp, 'no-such-vault');
    const s = getVaultStatus(env({ SYNTHOS_VAULT_PATH: missing }));
    expect(s.mode).toBe('UNAVAILABLE');
    expect(s.exists).toBe(false);
    expect(canWriteKnowledge(s)).toBe(false);
    expect(s.detail).toContain('nothing exists at');
  });

  it('TEST E: a path that is a file, not a directory, is UNAVAILABLE', () => {
    const file = path.join(tmp, 'a-file.md');
    fs.writeFileSync(file, 'not a vault');
    const s = getVaultStatus(env({ SYNTHOS_VAULT_PATH: file }));
    expect(s.mode).toBe('UNAVAILABLE');
    expect(s.isDirectory).toBe(false);
  });

  it('TEST E: a read-only vault reports writable:false and refuses to claim success', () => {
    const ro = path.join(tmp, 'readonly');
    fs.mkdirSync(ro);
    fs.chmodSync(ro, 0o500); // r-x, no write
    try {
      const s = getVaultStatus(env({ SYNTHOS_VAULT_PATH: ro }));
      expect(s.exists).toBe(true);
      expect(s.readable).toBe(true);
      expect(s.writable).toBe(false);
      expect(canWriteKnowledge(s)).toBe(false);
      expect(s.detail).toContain('NOT WRITABLE');

      const result = writeKnowledgeNote(
        { title: 'Should not be written', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' },
        'body',
        env({ SYNTHOS_VAULT_PATH: ro }),
      );
      expect(result.written).toBe(false);
      expect(result.reason).toMatch(/not writable/i);
      expect(result.absolutePath).toBeNull();
    } finally {
      fs.chmodSync(ro, 0o700);
    }
  });

  it('the local fallback is never reported as an Obsidian integration', () => {
    const s = getVaultStatus(env());
    expect(s.mode).toBe('LOCAL_FALLBACK');
    expect(s.detail).toContain('NOT an Obsidian vault integration');
  });

  it('watcher is NOT_IMPLEMENTED, stated rather than omitted', () => {
    expect(getVaultStatus(env({ SYNTHOS_VAULT_PATH: tmp })).watcher).toBe('NOT_IMPLEMENTED');
  });

  it('desktop detection never influences any other field', () => {
    const withApp = getVaultStatus(env({ SYNTHOS_VAULT_PATH: tmp }), { desktopAppDetected: true });
    const withoutApp = getVaultStatus(env({ SYNTHOS_VAULT_PATH: tmp }), { desktopAppDetected: false });
    expect(withApp.mode).toBe(withoutApp.mode);
    expect(withApp.writable).toBe(withoutApp.writable);
    expect(withApp.readable).toBe(withoutApp.readable);
  });

  it('a configured external path is NEVER auto-created — a typo must not manufacture a directory', () => {
    const typo = path.join(tmp, 'Vaultt');
    ensureVaultRoot(env({ SYNTHOS_VAULT_PATH: typo }));
    expect(fs.existsSync(typo), 'a typo must surface as UNAVAILABLE, not create an empty vault').toBe(false);
  });
});

describe('PART A: existing vault contents are user-owned and must not be touched', () => {
  it('writing knowledge does not modify, rename, move or delete any pre-existing note', () => {
    // A small stand-in for the real ~1,204-note vault, including the folder
    // shapes that make a vault a vault.
    const existing: Record<string, string> = {
      'Daily/2024-01-01.md': '# Monday\n\nsome private thoughts',
      'Projects/Some Project.md': '---\ntags: [personal]\n---\n\n# A project',
      'README.md': '# My vault',
      '.obsidian/app.json': '{"theme":"obsidian"}',
    };
    for (const [rel, content] of Object.entries(existing)) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    const before = Object.keys(existing).map((rel) => ({
      rel,
      content: fs.readFileSync(path.join(tmp, rel), 'utf8'),
      mtime: fs.statSync(path.join(tmp, rel)).mtimeMs,
    }));

    const result = writeKnowledgeNote(
      { title: 'Gigs eSIM provisioning and missed call recovery', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' },
      'body',
      env({ SYNTHOS_VAULT_PATH: tmp }),
    );
    expect(result.written).toBe(true);

    for (const f of before) {
      const abs = path.join(tmp, f.rel);
      expect(fs.existsSync(abs), `${f.rel} must still exist`).toBe(true);
      expect(fs.readFileSync(abs, 'utf8'), `${f.rel} content must be byte-identical`).toBe(f.content);
      expect(fs.statSync(abs).mtimeMs, `${f.rel} must not have been rewritten`).toBe(f.mtime);
    }
  });

  it('every write lands inside the bounded SynthOS/ subdirectory', () => {
    const r = writeKnowledgeNote(
      { title: 'Delivery policy question', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' },
      'body',
      env({ SYNTHOS_VAULT_PATH: tmp }),
    );
    expect(r.vaultRelativePath!.startsWith(`${SYNTHOS_VAULT_SUBDIR}/`)).toBe(true);
    // Top level gains exactly one entry, and it is ours.
    expect(fs.readdirSync(tmp)).toEqual([SYNTHOS_VAULT_SUBDIR]);
  });

  it('listing knowledge never enumerates the user\'s own notes', () => {
    fs.mkdirSync(path.join(tmp, 'Personal'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Personal', 'Private.md'), '# private');
    writeKnowledgeNote(
      { title: 'A real subject', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' },
      'body', env({ SYNTHOS_VAULT_PATH: tmp }),
    );
    const notes = listKnowledgeNotes(env({ SYNTHOS_VAULT_PATH: tmp }));
    expect(notes).toHaveLength(1);
    expect(notes.every((n) => !n.vaultRelativePath.includes('Personal'))).toBe(true);
  });
});

describe('PART A: semantic naming', () => {
  it('names by SUBJECT, not by timestamp', () => {
    const r = writeKnowledgeNote(
      { title: 'Gigs eSIM provisioning and missed call recovery', kind: 'Conversations', workspaceId: 'ws-1', source: 'test', createdAt: '2026-09-13T10:00:00.000Z' },
      'body', env({ SYNTHOS_VAULT_PATH: tmp }),
    );
    expect(r.fileName).toBe('Gigs-eSIM-provisioning-and-missed-call-recovery__2026-09-13.md');
    // The failure this exists to prevent.
    expect(r.fileName).not.toMatch(/^Assistant-Log/);
    expect(r.fileName).not.toMatch(/^\d{10,}/);
  });

  it('is collision-safe by ATOMIC exclusive create, not by a random id', () => {
    const provenance = { title: 'Same subject twice', kind: 'Conversations' as const, workspaceId: 'ws-1', source: 'test', createdAt: '2026-09-13T10:00:00.000Z' };
    const a = writeKnowledgeNote(provenance, 'first', env({ SYNTHOS_VAULT_PATH: tmp }));
    const b = writeKnowledgeNote(provenance, 'second', env({ SYNTHOS_VAULT_PATH: tmp }));
    const c = writeKnowledgeNote(provenance, 'third', env({ SYNTHOS_VAULT_PATH: tmp }));
    expect(a.fileName).toBe('Same-subject-twice__2026-09-13.md');
    expect(b.fileName).toBe('Same-subject-twice__2026-09-13-2.md');
    expect(c.fileName).toBe('Same-subject-twice__2026-09-13-3.md');
    // Crucially, the first file was not overwritten.
    expect(fs.readFileSync(a.absolutePath!, 'utf8')).toContain('first');
    expect(fs.readFileSync(b.absolutePath!, 'utf8')).toContain('second');
  });

  it('refuses to write THROUGH a symlink planted at the target name', () => {
    const outside = path.join(tmp, 'outside.md');
    fs.writeFileSync(outside, 'ORIGINAL CONTENT');
    const dir = path.join(tmp, SYNTHOS_VAULT_SUBDIR, 'Conversations');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(outside, path.join(dir, 'Target__2026-09-13.md'));

    const r = writeKnowledgeNote(
      { title: 'Target', kind: 'Conversations', workspaceId: 'ws-1', source: 'test', createdAt: '2026-09-13T10:00:00.000Z' },
      'new content', env({ SYNTHOS_VAULT_PATH: tmp }),
    );
    // 'wx' refuses the symlinked name and the counter moves past it.
    expect(r.written).toBe(true);
    expect(r.fileName).toBe('Target__2026-09-13-2.md');
    expect(fs.readFileSync(outside, 'utf8'), 'the symlink target must be untouched').toBe('ORIGINAL CONTENT');
  });

  it('produces filesystem-safe names from hostile titles', () => {
    expect(semanticSlug('../../etc/passwd')).toBe('etc-passwd');
    expect(semanticSlug('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(semanticSlug('!!!')).toBe('Untitled');
    expect(semanticSlug('Café résumé naïve')).toBe('Cafe-resume-naive');
    expect(semanticSlug('x'.repeat(500)).length).toBeLessThanOrEqual(80);
  });

  it('a traversal-shaped title cannot escape the SynthOS directory', () => {
    const r = writeKnowledgeNote(
      { title: '../../../../etc/passwd', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' },
      'body', env({ SYNTHOS_VAULT_PATH: tmp }),
    );
    expect(r.written).toBe(true);
    expect(path.resolve(r.absolutePath!).startsWith(path.resolve(tmp, SYNTHOS_VAULT_SUBDIR))).toBe(true);
  });
});

describe('PART A: subject derivation is deterministic and needs no model', () => {
  it('extracts the real subject from customer questions', () => {
    const topics = extractTopics([
      'Do you deliver, and do you take away my old mattress?',
      'What is the delivery charge for a mattress?',
    ]);
    expect(topics).toContain('mattress');
    expect(topics).toContain('deliver');
    expect(topics).not.toContain('the');
    expect(topics).not.toContain('you');
  });

  it('is stable — the same input always yields the same subject', () => {
    const input = ['I sleep hot and my lower back hurts', 'which mattress is best for back pain'];
    const a = deriveConversationSubject('Northfield Sleep Co.', input);
    const b = deriveConversationSubject('Northfield Sleep Co.', input);
    expect(a.title).toBe(b.title);
    expect(a.topics).toEqual(b.topics);
  });

  it('falls back to the business name, never to a timestamp', () => {
    const s = deriveConversationSubject('Acme Ltd', []);
    expect(s.title).toBe('Acme Ltd — conversation');
    expect(s.title).not.toMatch(/\d{10,}/);
  });
});

describe('PART A: provenance and the Activity/Knowledge boundary', () => {
  it('carries real provenance in frontmatter, and omits what is unknown', () => {
    const note = renderKnowledgeNote({
      title: 'Delivery and removal', kind: 'Conversations', workspaceId: 'ws-1',
      source: 'business-conversation', sessionId: 'conv-123', runtime: 'synthos-conversation-ai',
      topics: ['delivery', 'mattress'], tags: ['synthos'], receipts: ['rcpt-abc'], artifacts: ['art-xyz'],
      summary: 'A summary.', createdAt: '2026-09-13T10:00:00.000Z',
    }, 'The body.');
    expect(note).toContain('session_id: "conv-123"');
    expect(note).toContain('receipts: ["rcpt-abc"]');
    expect(note).toContain('topics: ["delivery", "mattress"]');
    expect(note).toContain('generated_by: "SynthOS"');
    // Unknown fields are absent, not written as empty or "None".
    expect(note).not.toContain('project:');
    expect(note).not.toContain('model:');
  });

  it('never fabricates a relationship to populate a graph', () => {
    const note = renderKnowledgeNote({
      title: 'Standalone', kind: 'Conversations', workspaceId: 'ws-1', source: 'test',
    }, 'body');
    expect(note).not.toContain('## Related');
    expect(note).not.toContain('[[');
  });

  it('writes real wikilinks only when relationships are genuinely known', () => {
    const note = renderKnowledgeNote({
      title: 'Linked', kind: 'Conversations', workspaceId: 'ws-1', source: 'test',
      related: ['Some-Other-Note'],
    }, 'body');
    expect(note).toContain('- [[Some-Other-Note]]');
  });
});

describe('PART A: TEST C — knowledge is retrievable by subject, not by timestamp', () => {
  it('finds a note by a word in its title', () => {
    const e = env({ SYNTHOS_VAULT_PATH: tmp });
    writeKnowledgeNote({ title: 'Gigs eSIM provisioning and missed call recovery', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' }, 'body', e);
    writeKnowledgeNote({ title: 'Mattress delivery policy', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' }, 'body', e);
    const hits = searchKnowledgeNotes('eSIM', e);
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedIn).toBe('filename');
    expect(hits[0].fileName).toContain('eSIM');
  });

  it('finds a note by its CONTENT when the title does not contain the term', () => {
    const e = env({ SYNTHOS_VAULT_PATH: tmp });
    writeKnowledgeNote(
      { title: 'A conversation', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' },
      'The customer asked about free delivery within 25 miles of the Northfield store.', e,
    );
    const hits = searchKnowledgeNotes('Northfield', e);
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedIn).toBe('content');
    expect(hits[0].snippet).toContain('Northfield');
  });

  it('returns nothing rather than guessing when there is no match', () => {
    expect(searchKnowledgeNotes('nonexistent-term', env({ SYNTHOS_VAULT_PATH: tmp }))).toEqual([]);
  });
});

describe('PART A: vault scanning is bounded and skips machinery directories', () => {
  it('counts real markdown files and ignores .obsidian/.git', () => {
    fs.mkdirSync(path.join(tmp, '.obsidian'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'Notes'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.obsidian', 'ignored.md'), 'x');
    fs.writeFileSync(path.join(tmp, '.git', 'ignored.md'), 'x');
    fs.writeFileSync(path.join(tmp, 'Notes', 'a.md'), 'x');
    fs.writeFileSync(path.join(tmp, 'Notes', 'b.md'), 'x');
    fs.writeFileSync(path.join(tmp, 'not-markdown.txt'), 'x');
    expect(countMarkdownFiles(tmp)).toBe(2);
  });

  it('stops at the limit rather than walking an unbounded tree', () => {
    fs.mkdirSync(path.join(tmp, 'Many'), { recursive: true });
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(tmp, 'Many', `n${i}.md`), 'x');
    expect(countMarkdownFiles(tmp, 10)).toBeLessThanOrEqual(12);
  });
});

describe('PART A: an embedded document does not produce a second frontmatter block', () => {
  it('strips the inner frontmatter of an embedded body', () => {
    // Found in the real end-to-end run: the conversation summary is also a
    // standalone artifact and carries its own `---` header. Nesting it gave the
    // note two frontmatter blocks — Obsidian parses the first and renders the
    // second as a stray rule plus raw key/value lines.
    const body = ['---', 'type: "business-conversation-summary"', 'channel: "WEB"', '---', '', '# Heading', '', 'Real content.'].join('\n');
    const note = renderKnowledgeNote(
      { title: 'Subject', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' },
      body,
    );
    expect(note.split('\n').filter((l) => l.trim() === '---')).toHaveLength(2); // exactly one block
    expect(note).not.toContain('type: "business-conversation-summary"');
    expect(note).toContain('Real content.');
  });

  it('leaves a mid-document horizontal rule alone', () => {
    const body = 'Intro paragraph.\n\n---\n\nAfter the rule.';
    const note = renderKnowledgeNote(
      { title: 'Subject', kind: 'Conversations', workspaceId: 'ws-1', source: 'test' }, body,
    );
    expect(note).toContain('After the rule.');
    expect(note).toContain('Intro paragraph.');
  });

  it('leaves a body with no frontmatter unchanged', () => {
    expect(stripLeadingFrontmatter('# Just a heading\n\ntext')).toBe('# Just a heading\n\ntext');
  });
});
