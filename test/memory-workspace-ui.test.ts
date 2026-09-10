import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// P1-A — the historical "Long-Term Agent Memory Subsystem" IA, rebuilt over the
// canonical backend.
//
// cd60d81 reduced this screen from that IA (agent roster · file panel · editor ·
// export) to a bare search box, because everything it displayed was fabricated.
// Removing the fabricated numbers was right; removing the product surface with
// them was the regression.
//
// This file protects both halves at once:
//   - the real FTS5 capability is RETAINED, and
//   - the restored IA does NOT reintroduce a single fabricated field.
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');

const view = read('src/components/AgentMemoryView.tsx');
const serverContent = read('server.ts');
const memoryIndex = read('lib/memory-index.ts');

describe('1: the real FTS5 capability is retained', () => {
  it('still searches through /api/memory/search, workspace-scoped', () => {
    expect(view).toContain('/api/memory/search?workspaceId=');
    expect(view).toContain('encodeURIComponent(workspaceId)');
  });

  it('still exposes reindex', () => {
    expect(view).toContain("'/api/memory/reindex'");
    expect(view).toContain('REINDEX');
  });

  it('renders the real result fields, including source path', () => {
    for (const f of ['artifact_id', 'title', 'snippet', 'source_path']) {
      expect(view).toContain(f);
    }
  });

  it('the snippet renderer still escapes HTML before highlighting (no XSS via indexed content)', () => {
    // This feeds dangerouslySetInnerHTML with content that originates from LLM
    // task output. Escaping must happen BEFORE the [ / ] markers become tags.
    expect(view).toContain('highlightSnippet');
    expect(view).toContain("replace(/&/g, '&amp;')");
    expect(view).toContain("replace(/</g, '&lt;')");
    const fn = view.slice(view.indexOf('function highlightSnippet'), view.indexOf('interface AgentMemoryViewProps'));
    expect(fn.indexOf("'&lt;'")).toBeLessThan(fn.indexOf('<mark'));
  });
});

describe('2: browsing the corpus does not lie about an empty index', () => {
  it('an empty FTS5 query still matches nothing — that contract is unchanged', () => {
    const fn = memoryIndex.slice(memoryIndex.indexOf('export function searchWorkspaceMemory'));
    expect(fn.slice(0, 300)).toContain('if (!trimmed) return [];');
  });

  it('browsing uses a separate listing read, so a populated index never renders as empty', () => {
    expect(memoryIndex).toContain('export function listWorkspaceMemory');
    expect(serverContent).toContain('app.get("/api/memory/documents"');
    expect(view).toContain('/api/memory/documents?workspaceId=');
    // The list panel loads on arrival via the browse path, not via search.
    expect(view).toContain('void loadDocuments();');
  });

  it('the listing is workspace-scoped and reads the same memory_index table', () => {
    const fn = memoryIndex.slice(memoryIndex.indexOf('export function listWorkspaceMemory'));
    expect(fn.slice(0, 600)).toContain('FROM memory_index');
    expect(fn.slice(0, 600)).toContain('WHERE workspace_id = ?');
    expect(serverContent.slice(serverContent.indexOf('app.get("/api/memory/documents"'), serverContent.indexOf('app.get("/api/memory/documents"') + 400))
      .toContain('requireWorkspaceMember(fromQuery)');
  });
});

describe('3: the restored IA is present', () => {
  it('has the agent roster, document list and document viewer panes', () => {
    expect(view).toContain('Agents');
    expect(view).toContain('Indexed Memory');
    expect(view).toContain('Document');
    expect(view).toContain('agentList');
  });

  it('the viewer reads REAL Vault content, not a fabricated memory file', () => {
    expect(view).toContain('/api/vault/${encodeURIComponent(doc.artifact_id)}');
    expect(view).toContain('docDetail');
  });

  it('Export writes through the canonical vault writer', () => {
    expect(view).toContain('EXPORT TO VAULT');
    expect(view).toContain('onAddNoteToVault(');
    // App wires onAddNoteToVault to the real /api/vault/notes path.
    expect(serverContent).toContain('app.post("/api/vault/notes"');
  });
});

describe('4: nothing unavailable is fabricated', () => {
  it('per-agent memory files are declared NOT AVAILABLE, not invented', () => {
    expect(view).toContain('NOT AVAILABLE');
    expect(view).toContain('Per-agent memory files have no backend in this app.');
    // The specific fabrications the audit named must not come back.
    for (const fake of ['SOPS.md', 'memory.md', 'rules.md', 'board-governor.json', 'memorySizeKB', 'synapseConnections', 'signalTelemetry', 'Vector CDC', 'Inotify']) {
      expect(view).not.toContain(fake);
    }
  });

  it('Compact Memory is present but permanently disabled, never faking success', () => {
    expect(view).toContain('COMPACT · NOT IMPLEMENTED');
    const idx = view.indexOf('COMPACT · NOT IMPLEMENTED');
    const btn = view.slice(Math.max(0, idx - 700), idx);
    expect(btn).toContain('disabled');
    expect(view).not.toContain('setIsCompacting');
  });

  it('the document editor is READ-ONLY, because artifacts are immutable and have no write-back route', () => {
    expect(view).toContain('READ-ONLY');
    expect(serverContent).not.toContain('app.put("/api/vault/:artifactId"');
    expect(serverContent).not.toContain('app.patch("/api/vault/:artifactId"');
  });

  it('missing metadata reads UNKNOWN rather than a placeholder value', () => {
    expect(view).toContain("'UNKNOWN'");
  });
});
