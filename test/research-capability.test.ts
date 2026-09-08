import { describe, it, expect } from 'vitest';
import { extractRepoCandidates, buildReportMarkdown } from '../lib/fabric/research';

// ---------------------------------------------------------------------------
// STEP 6 — the deterministic parts of lib/fabric/research.ts: extracting
// real GitHub repo candidates from grounded text/sources, and building the
// final report from real, already-fetched structured data. These are pure
// functions, testable without a live network call — the live grounding +
// GitHub API calls themselves are proven in test/jarvis-command-routing.test.ts
// (honest NOT_CONFIGURED without a real key) and the Section 13 live
// acceptance pass (with a real key, run separately).
// ---------------------------------------------------------------------------

describe('extractRepoCandidates: real github.com URLs only, deduplicated, never fabricated', () => {
  it('extracts owner/repo from a real github.com URL in grounded text', () => {
    const candidates = extractRepoCandidates('Check out https://github.com/langchain-ai/langchain for agent orchestration.', []);
    expect(candidates).toContainEqual({ owner: 'langchain-ai', repo: 'langchain' });
  });

  it('extracts from grounding source URIs too, not just the text body', () => {
    const candidates = extractRepoCandidates('', [{ title: 'AutoGPT', uri: 'https://github.com/Significant-Gravitas/AutoGPT' }]);
    expect(candidates).toContainEqual({ owner: 'Significant-Gravitas', repo: 'AutoGPT' });
  });

  it('deduplicates the same repo mentioned in both text and sources', () => {
    const candidates = extractRepoCandidates(
      'See https://github.com/microsoft/autogen for details.',
      [{ title: null, uri: 'https://github.com/microsoft/autogen/blob/main/README.md' }]
    );
    const autogenCount = candidates.filter((c) => c.owner.toLowerCase() === 'microsoft' && c.repo.toLowerCase() === 'autogen').length;
    expect(autogenCount).toBe(1);
  });

  it('strips trailing punctuation and .git suffixes', () => {
    const candidates = extractRepoCandidates('(https://github.com/openai/openai-python.git), a client library.', []);
    expect(candidates).toContainEqual({ owner: 'openai', repo: 'openai-python' });
  });

  it('returns an empty list when no real github.com URL is present — never fabricates a repo', () => {
    const candidates = extractRepoCandidates('There are many great open-source projects out there.', []);
    expect(candidates).toEqual([]);
  });
});

describe('buildReportMarkdown: deterministic structure, real data only', () => {
  const repos = [
    { fullName: 'a/one', url: 'https://github.com/a/one', description: 'First', stars: 500, language: 'TypeScript', pushedAt: '2026-08-01T00:00:00Z' },
    { fullName: 'b/two', url: 'https://github.com/b/two', description: 'Second', stars: 900, language: 'Python', pushedAt: '2026-07-15T00:00:00Z' },
  ];
  const sources = [{ title: 'Source One', uri: 'https://example.com/1' }];

  it('includes the query, repo count, and a comparison table with real repo data', () => {
    const md = buildReportMarkdown('AI agent frameworks', repos, sources);
    expect(md).toContain('# Research: AI agent frameworks');
    expect(md).toContain('**Repositories reviewed**: 2');
    expect(md).toContain('[a/one](https://github.com/a/one)');
    expect(md).toContain('[b/two](https://github.com/b/two)');
    expect(md).toContain('500');
    expect(md).toContain('900');
  });

  it('includes a real Sources section with the actual grounding URIs, never fabricated citations', () => {
    const md = buildReportMarkdown('query', repos, sources);
    expect(md).toContain('## Sources');
    expect(md).toContain('[Source One](https://example.com/1)');
  });

  it('an empty repo list produces an honest zero-repo report, never a fabricated entry', () => {
    const md = buildReportMarkdown('query', [], []);
    expect(md).toContain('**Repositories reviewed**: 0');
    expect(md).toContain('No grounding sources were returned by the search.');
  });

  it('a table cell never breaks on a pipe character in a real description (escaped, not corrupting the table)', () => {
    const md = buildReportMarkdown('query', [{ fullName: 'x/y', url: 'https://github.com/x/y', description: 'A | B', stars: 1, language: null, pushedAt: null }], []);
    expect(md).toContain('A \\| B');
  });
});
