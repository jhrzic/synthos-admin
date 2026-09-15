// ---------------------------------------------------------------------------
// SYNTHOS — knowledge artifacts in the user's real Markdown vault.
//
// ACTIVITY vs KNOWLEDGE — the distinction this module exists to hold
//
// Activity is what happened: every dispatch, every provider call, every status
// transition. That already has a home — `activity_events` and `runtime_events`
// in SQLite, which stay as granular as they are.
//
// Knowledge is the semantically useful residue of activity: what was discussed,
// what was decided, what must happen next. That is what belongs in a human's
// vault, in their own Markdown, findable by subject.
//
// So this module writes FEW, MEANINGFUL files. It is not a log sink. Nothing
// here produces `Assistant-Log-1726.md`, and nothing here writes one file per
// runtime event.
//
// SEMANTIC NAMING, AND THE INVARIANT IT HAD TO BE RECONCILED WITH
//
// lib/vault.ts::writeWorkspaceArtifact deliberately NEVER derives a filename
// from a title — its header explains why: two artifacts sharing a title must be
// structurally unable to collide, so storage identity is a server-generated id.
// That invariant is correct for the internal artifact store and is left
// untouched.
//
// It is wrong for a human's vault, where `art-1789268520547-45f9e0.md` is
// unfindable. Both requirements are satisfiable at once:
//
//   * the name is semantic          — a slug of the real subject, plus the date
//   * collisions are still impossible — not by a random id, but by an ATOMIC
//     exclusive create (`fs.openSync(..., 'wx')`). On EEXIST the suffix
//     increments and it retries. 'wx' fails if anything is at the path,
//     symlink included, so this is also the same anti-symlink-overwrite posture
//     the internal writer has, achieved by the syscall rather than by an lstat
//     check that a racing process could slip past.
//
// USER DATA IS NOT OURS
//
// Every write lands under a single bounded `SynthOS/` subdirectory of the
// vault. This module has no rename, no move, no delete, and no bulk-rewrite
// path. It never touches a file it did not create.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import {
  getVaultStatus, ensureVaultRoot, canWriteKnowledge,
  SYNTHOS_VAULT_SUBDIR, type VaultStatus,
} from './vault-config';

/** The kinds of knowledge SynthOS writes. Each gets its own subdirectory. */
export type KnowledgeKind = 'Conversations' | 'Decisions' | 'Research' | 'Sessions';

export interface KnowledgeProvenance {
  /** Human title — becomes both the H1 and the basis of the filename. */
  title: string;
  kind: KnowledgeKind;
  workspaceId: string;
  /** Where this came from: 'business-conversation', 'jarvis-session', … */
  source: string;
  /** The originating conversation/session id, when there is one. */
  sessionId?: string | null;
  /** The runtime/model that produced the underlying work, when known. */
  runtime?: string | null;
  model?: string | null;
  project?: string | null;
  topics?: string[];
  tags?: string[];
  summary?: string | null;
  decisions?: string[];
  requirements?: string[];
  actionItems?: string[];
  /** Internal artifact ids this knowledge derives from. */
  artifacts?: string[];
  /** Receipt ids proving the underlying work was verified. */
  receipts?: string[];
  /**
   * Wikilinks to other notes. ONLY pass genuinely known relationships — a
   * fabricated link makes a knowledge graph look populated while making it
   * wrong, which is worse than an empty one.
   */
  related?: string[];
  createdAt?: string;
}

export interface KnowledgeWriteResult {
  written: boolean;
  /** Absolute path written, or null when nothing was written. */
  absolutePath: string | null;
  /** Path relative to the vault root — what a human sees in Obsidian. */
  vaultRelativePath: string | null;
  fileName: string | null;
  status: VaultStatus;
  /** Truthful reason when `written` is false. */
  reason: string | null;
}

/**
 * Turn a human title into a filesystem-safe, readable slug.
 *
 * Keeps letters, digits and internal hyphens; collapses everything else. Length
 * is capped well under the 255-byte limit every common filesystem shares, with
 * room left for the date suffix and a collision counter. Unicode letters are
 * transliterated where trivial and otherwise dropped rather than percent-
 * escaped, because the point of the name is that a human can read it.
 */
export function semanticSlug(title: string, maxLength = 80): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')       // strip combining accents
    .replace(/['’`]/g, '')                  // apostrophes vanish, not become hyphens
    .replace(/[^a-zA-Z0-9]+/g, '-')         // everything else becomes a separator
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  const trimmed = slug.slice(0, maxLength).replace(/-+$/g, '');
  // A title of only punctuation would otherwise produce an empty filename.
  return trimmed || 'Untitled';
}

/** `YYYY-MM-DD` in UTC, matching the rest of this codebase's timestamps. */
function dateStamp(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Remove a leading YAML frontmatter block from an embedded body.
 *
 * The conversation summary this module embeds is also a standalone artifact, so
 * it carries its own `---` header. Nesting that inside a knowledge note gave
 * every note TWO frontmatter blocks: Obsidian parses only the first, renders
 * the second as a stray horizontal rule followed by raw `key: "value"` lines,
 * and a reader sees duplicated, conflicting metadata. The outer frontmatter
 * written by renderKnowledgeNote is the authoritative one, so the inner block
 * is stripped rather than duplicated.
 *
 * Only a block at the very start is touched — a `---` used as a real horizontal
 * rule later in the document is left exactly as the author wrote it.
 */
export function stripLeadingFrontmatter(body: string): string {
  const text = body.replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return body;
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? text.slice(match[0].length).replace(/^\r?\n/, '') : body;
}

function yamlString(v: string): string {
  return JSON.stringify(v); // valid YAML double-quoted scalar, handles every escape
}

function yamlList(items: string[]): string {
  return `[${items.map(yamlString).join(', ')}]`;
}

/**
 * Render the note. Frontmatter carries provenance for machines; the body is for
 * a person reading it in Obsidian six months from now.
 *
 * Empty sections are OMITTED rather than written as "None" — a note full of
 * empty headings is noise, and an absent section is honest about there being
 * nothing to say.
 */
export function renderKnowledgeNote(p: KnowledgeProvenance, body: string): string {
  const createdAt = p.createdAt || new Date().toISOString();
  const fm: string[] = [
    '---',
    `title: ${yamlString(p.title)}`,
    `type: ${yamlString(`synthos-${p.kind.toLowerCase()}`)}`,
    `created: ${yamlString(createdAt)}`,
    `updated: ${yamlString(createdAt)}`,
    `workspace: ${yamlString(p.workspaceId)}`,
    `source: ${yamlString(p.source)}`,
  ];
  if (p.sessionId) fm.push(`session_id: ${yamlString(p.sessionId)}`);
  if (p.project) fm.push(`project: ${yamlString(p.project)}`);
  if (p.runtime) fm.push(`runtime: ${yamlString(p.runtime)}`);
  if (p.model) fm.push(`model: ${yamlString(p.model)}`);
  if (p.topics?.length) fm.push(`topics: ${yamlList(p.topics)}`);
  if (p.tags?.length) fm.push(`tags: ${yamlList(p.tags)}`);
  if (p.artifacts?.length) fm.push(`artifacts: ${yamlList(p.artifacts)}`);
  if (p.receipts?.length) fm.push(`receipts: ${yamlList(p.receipts)}`);
  fm.push('generated_by: "SynthOS"');
  fm.push('---', '');

  const out: string[] = [fm.join('\n')];
  out.push(`# ${p.title}`, '');

  if (p.summary) out.push('## Summary', '', p.summary, '');
  if (p.decisions?.length) out.push('## Decisions', '', ...p.decisions.map((d) => `- ${d}`), '');
  if (p.requirements?.length) out.push('## Requirements', '', ...p.requirements.map((r) => `- ${r}`), '');
  if (p.actionItems?.length) out.push('## Action items', '', ...p.actionItems.map((a) => `- [ ] ${a}`), '');

  out.push(stripLeadingFrontmatter(body).trim(), '');

  if (p.receipts?.length) {
    out.push('## Evidence', '');
    out.push(...p.receipts.map((r) => `- Receipt \`${r}\` — Ed25519-signed, independently verifiable.`));
    out.push('');
  }
  // Wikilinks last: only real relationships, never invented ones.
  if (p.related?.length) {
    out.push('## Related', '', ...p.related.map((r) => `- [[${r}]]`), '');
  }
  return out.join('\n');
}

/**
 * Write one knowledge note into the configured vault.
 *
 * Never throws for an unusable vault — returns `written: false` with a real
 * reason, so a caller (a live customer conversation, say) is never broken by a
 * misconfigured vault path. Silently succeeding would be the worse failure.
 */
export function writeKnowledgeNote(
  provenance: KnowledgeProvenance,
  body: string,
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeWriteResult {
  const status = ensureVaultRoot(env);

  if (!canWriteKnowledge(status) || !status.root) {
    return {
      written: false, absolutePath: null, vaultRelativePath: null, fileName: null,
      status,
      reason: status.mode === 'UNAVAILABLE'
        ? `Vault unavailable: ${status.detail}`
        : `Vault at ${status.root} is not writable. ${status.detail}`,
    };
  }

  const createdAt = provenance.createdAt || new Date().toISOString();
  const targetDir = path.join(status.root, SYNTHOS_VAULT_SUBDIR, provenance.kind);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err: any) {
    return {
      written: false, absolutePath: null, vaultRelativePath: null, fileName: null,
      status, reason: `Could not create ${targetDir}: ${err?.message || err}`,
    };
  }

  const slug = semanticSlug(provenance.title);
  const stamp = dateStamp(createdAt);
  const contents = renderKnowledgeNote({ ...provenance, createdAt }, body);

  // Atomic exclusive create. 'wx' fails with EEXIST if ANYTHING is at the path
  // — including a symlink — so the name is claimed by the syscall itself rather
  // than by a check-then-write that a concurrent writer could interleave with.
  for (let attempt = 0; attempt < 50; attempt++) {
    const fileName = attempt === 0
      ? `${slug}__${stamp}.md`
      : `${slug}__${stamp}-${attempt + 1}.md`;
    const absolutePath = path.join(targetDir, fileName);
    try {
      const fd = fs.openSync(absolutePath, 'wx');
      try {
        fs.writeFileSync(fd, contents, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      return {
        written: true,
        absolutePath,
        vaultRelativePath: path.relative(status.root, absolutePath).split(path.sep).join('/'),
        fileName,
        status,
        reason: null,
      };
    } catch (err: any) {
      if (err?.code === 'EEXIST') continue; // name taken — try the next suffix
      return {
        written: false, absolutePath: null, vaultRelativePath: null, fileName: null,
        status, reason: `Write failed at ${absolutePath}: ${err?.message || err}`,
      };
    }
  }

  return {
    written: false, absolutePath: null, vaultRelativePath: null, fileName: null,
    status, reason: `50 notes already share the name "${slug}__${stamp}" — refusing to keep incrementing.`,
  };
}

/**
 * Every knowledge note SynthOS has written, newest first.
 *
 * Reads ONLY the bounded SynthOS/ subtree. It never enumerates, indexes or
 * reports on the user's own notes — those are not ours to inventory.
 */
export function listKnowledgeNotes(
  env: NodeJS.ProcessEnv = process.env,
  limit = 200,
): Array<{ fileName: string; vaultRelativePath: string; kind: string; sizeBytes: number; modifiedAt: string }> {
  const status = getVaultStatus(env);
  if (!status.root || status.mode === 'UNAVAILABLE') return [];
  const base = path.join(status.root, SYNTHOS_VAULT_SUBDIR);
  if (!fs.existsSync(base)) return [];

  const out: Array<{ fileName: string; vaultRelativePath: string; kind: string; sizeBytes: number; modifiedAt: string }> = [];
  let kinds: fs.Dirent[] = [];
  try {
    kinds = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const kindDir of kinds) {
    if (!kindDir.isDirectory()) continue;
    const dir = path.join(base, kindDir.name);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const fileName of files) {
      if (!fileName.toLowerCase().endsWith('.md')) continue;
      const abs = path.join(dir, fileName);
      try {
        const st = fs.statSync(abs);
        out.push({
          fileName,
          vaultRelativePath: path.relative(status.root, abs).split(path.sep).join('/'),
          kind: kindDir.name,
          sizeBytes: st.size,
          modifiedAt: st.mtime.toISOString(),
        });
      } catch {
        // Vanished between readdir and stat — skip it, exactly as listBackups does.
      }
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, limit);
}

/**
 * Find SynthOS knowledge by subject — the whole point of semantic naming.
 *
 * Matches the filename AND the note's content, so a note is retrievable by what
 * it is about rather than by when it happened. Deliberately a plain substring
 * scan over the bounded SynthOS/ subtree: the FTS5 index in lib/memory-index.ts
 * covers internal artifacts, and pointing it at arbitrary user filesystems is a
 * larger decision than this work should make on its own.
 */
export function searchKnowledgeNotes(
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  limit = 50,
): Array<{ fileName: string; vaultRelativePath: string; kind: string; matchedIn: 'filename' | 'content'; snippet: string | null }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const status = getVaultStatus(env);
  if (!status.root) return [];

  const results: Array<{ fileName: string; vaultRelativePath: string; kind: string; matchedIn: 'filename' | 'content'; snippet: string | null }> = [];
  for (const note of listKnowledgeNotes(env, 1000)) {
    if (results.length >= limit) break;
    if (note.fileName.toLowerCase().includes(needle)) {
      results.push({ ...note, matchedIn: 'filename', snippet: null });
      continue;
    }
    try {
      const content = fs.readFileSync(path.join(status.root, note.vaultRelativePath), 'utf8');
      const at = content.toLowerCase().indexOf(needle);
      if (at >= 0) {
        results.push({
          ...note,
          matchedIn: 'content',
          snippet: content.slice(Math.max(0, at - 60), at + needle.length + 60).replace(/\s+/g, ' ').trim(),
        });
      }
    } catch {
      // Unreadable note — skip rather than fail the whole search.
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Deriving a SUBJECT from a conversation.
//
// This is what makes the filename semantic rather than a timestamp. It is
// deliberately DETERMINISTIC — no model call. A knowledge note must be
// reproducible, must cost nothing, and must not become one more thing that
// breaks when no provider key is configured.
// ---------------------------------------------------------------------------

/**
 * Words carrying no subject information. Kept small and general on purpose: an
 * aggressive domain-specific list would quietly bias what topics can ever be
 * detected.
 */
const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','but','by','can','could','did','do','does','for','from',
  'had','has','have','how','i','if','in','is','it','its','just','me','my','need','of','on','or','our',
  'she','he','they','so','that','the','their','them','then','there','these','this','to','too','up','us',
  'was','we','were','what','when','where','which','who','why','will','with','would','you','your','about',
  'am','get','got','like','want','some','any','much','many','really','please','thanks','thank','hi','hello',
  'im','ive','id','dont','doesnt','cant','isnt','wont','not','no','yes','ok','okay','also','out','over',
  'take','takes','away','look','looking','help','tell','know','see','make','made','one','two','back',
]);

/**
 * Pick the salient terms from customer text, most frequent first.
 *
 * Ties break on first appearance, so the result is stable for the same input —
 * which matters, because an unstable subject would produce a different filename
 * for the same conversation on a re-run.
 */
export function extractTopics(texts: string[], max = 4): string[] {
  const counts = new Map<string, { n: number; first: number; display: string }>();
  let position = 0;
  for (const text of texts) {
    for (const raw of text.split(/[^A-Za-z0-9'-]+/)) {
      const word = raw.replace(/['-]+$/g, '').replace(/^['-]+/g, '');
      if (word.length < 3) continue;
      const key = word.toLowerCase();
      if (STOPWORDS.has(key)) continue;
      if (/^\d+$/.test(key)) continue; // bare numbers are not subjects
      const existing = counts.get(key);
      if (existing) existing.n++;
      else counts.set(key, { n: 1, first: position, display: word.toLowerCase() });
      position++;
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1].n - a[1].n) || (a[1].first - b[1].first))
    .slice(0, max)
    .map(([, v]) => v.display);
}

/**
 * A human-readable subject line for a conversation, e.g.
 * "Northfield Sleep Co — delivery, mattress, removal".
 *
 * Falls back to the business name alone when there is nothing to extract. It
 * never falls back to a timestamp — a timestamp-named note is precisely the
 * failure mode this whole module exists to avoid.
 */
export function deriveConversationSubject(businessName: string, customerTexts: string[]): {
  title: string;
  topics: string[];
} {
  const topics = extractTopics(customerTexts);
  const base = businessName?.trim() || 'Conversation';
  return {
    title: topics.length > 0 ? `${base} — ${topics.join(', ')}` : `${base} — conversation`,
    topics,
  };
}

// ---------------------------------------------------------------------------
// BRAIN SURFACE — real notes, with the provenance that is already written into
// them.
//
// listKnowledgeNotes() above returns filesystem facts only (name, path, kind,
// size, mtime). That is enough for a count and not enough for a surface: the
// Admin's knowledge mesh needs titles, tags, wikilinks and the provenance
// chain (which workspace, which session, which runtime/model, and which
// artifacts and receipts a note is evidence for).
//
// All of that is ALREADY in every note's frontmatter, written by
// renderKnowledgeNote above. Nothing here invents a field: a note without a
// `model:` line simply has no model, and the surface renders that as unknown
// rather than filling it in.
//
// Reading is bounded (notes are capped, and each file is read up to a byte
// ceiling) because this runs behind an HTTP route.
// ---------------------------------------------------------------------------

/** Per-file read ceiling. A knowledge note is prose; anything larger is truncated rather than streamed into a response. */
const NOTE_READ_MAX_BYTES = 256 * 1024;

export interface KnowledgeNoteDetail {
  fileName: string;
  vaultRelativePath: string;
  kind: string;
  sizeBytes: number;
  modifiedAt: string;
  /** From frontmatter `title:`, falling back to the first H1, then the filename. */
  title: string;
  /** Frontmatter provenance. Every field is absent-if-absent, never defaulted to a plausible value. */
  type: string | null;
  createdAt: string | null;
  workspaceId: string | null;
  source: string | null;
  sessionId: string | null;
  project: string | null;
  runtime: string | null;
  model: string | null;
  topics: string[];
  tags: string[];
  /** Artifact ids this note is derived from — the link back to the evidence spine. */
  artifacts: string[];
  /** Receipt ids attesting the work this note describes. */
  receipts: string[];
  generatedBy: string | null;
  /** [[wikilinks]] found in the body — real relationships only, as written. */
  wikilinks: string[];
  body: string;
  truncated: boolean;
}

function parseYamlScalar(raw: string): string {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).replace(/\\"/g, '"');
  }
  return v;
}

function parseYamlList(raw: string): string[] {
  const v = raw.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) return v ? [parseYamlScalar(v)] : [];
  const inner = v.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((part) => parseYamlScalar(part))
    .filter((part) => part.length > 0);
}

/** Frontmatter only. Returns an empty map when a note has none, never a guess. */
export function parseNoteFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = content.slice(3, end);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key || key.startsWith('#')) continue;
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Wikilinks as written. Deduplicated, order preserved — never synthesised from tags or folders. */
export function extractWikilinks(body: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const pattern = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const target = match[1].trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      found.push(target);
    }
  }
  return found;
}

/**
 * Real notes with provenance, for the Brain surface.
 *
 * Returns [] for an unavailable vault or a vault with no SynthOS/ subtree —
 * an honest empty, which the surface must render as "no notes yet" rather
 * than as a loading state that never resolves.
 */
export function listKnowledgeNotesDetailed(
  env: NodeJS.ProcessEnv = process.env,
  limit = 200,
): KnowledgeNoteDetail[] {
  const summaries = listKnowledgeNotes(env, limit);
  const status = getVaultStatus(env);
  if (!status.root) return [];

  const out: KnowledgeNoteDetail[] = [];
  for (const note of summaries) {
    const absolutePath = path.join(status.root, note.vaultRelativePath);
    let content = '';
    let truncated = false;
    try {
      const stat = fs.statSync(absolutePath);
      if (stat.size > NOTE_READ_MAX_BYTES) {
        const fd = fs.openSync(absolutePath, 'r');
        try {
          const buf = Buffer.alloc(NOTE_READ_MAX_BYTES);
          const read = fs.readSync(fd, buf, 0, NOTE_READ_MAX_BYTES, 0);
          content = buf.slice(0, read).toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
        truncated = true;
      } else {
        content = fs.readFileSync(absolutePath, 'utf8');
      }
    } catch {
      // A note that cannot be read is skipped rather than represented by a
      // placeholder row that would look like real knowledge.
      continue;
    }

    const fm = parseNoteFrontmatter(content);
    const body = stripLeadingFrontmatter(content);
    const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();

    out.push({
      fileName: note.fileName,
      vaultRelativePath: note.vaultRelativePath,
      kind: note.kind,
      sizeBytes: note.sizeBytes,
      modifiedAt: note.modifiedAt,
      title: (fm.title ? parseYamlScalar(fm.title) : '') || h1 || note.fileName.replace(/\.md$/, ''),
      type: fm.type ? parseYamlScalar(fm.type) : null,
      createdAt: fm.created ? parseYamlScalar(fm.created) : null,
      workspaceId: fm.workspace ? parseYamlScalar(fm.workspace) : null,
      source: fm.source ? parseYamlScalar(fm.source) : null,
      sessionId: fm.session_id ? parseYamlScalar(fm.session_id) : null,
      project: fm.project ? parseYamlScalar(fm.project) : null,
      runtime: fm.runtime ? parseYamlScalar(fm.runtime) : null,
      model: fm.model ? parseYamlScalar(fm.model) : null,
      topics: fm.topics ? parseYamlList(fm.topics) : [],
      tags: fm.tags ? parseYamlList(fm.tags) : [],
      artifacts: fm.artifacts ? parseYamlList(fm.artifacts) : [],
      receipts: fm.receipts ? parseYamlList(fm.receipts) : [],
      generatedBy: fm.generated_by ? parseYamlScalar(fm.generated_by) : null,
      wikilinks: extractWikilinks(body),
      body,
      truncated,
    });
  }
  return out;
}
