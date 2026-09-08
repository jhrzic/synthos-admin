import { describe, it, expect } from 'vitest';
import { buildSearchQueries, buildReportMarkdown, GithubRateLimitError, type ResearchRepo, type ResearchSource } from '../lib/fabric/research';

// ---------------------------------------------------------------------------
// STEP 6 corrective pass — the deterministic parts of lib/fabric/research.ts
// now that discovery is GitHub Search API, not Gemini grounding. Pure
// functions, testable without a live network call — the live GitHub Search
// + synthesis calls themselves are proven in
// test/jarvis-command-routing.test.ts (honest NOT_CONFIGURED/FAILED without
// real credentials) and the live acceptance pass (with real credentials).
// ---------------------------------------------------------------------------

describe('buildSearchQueries: derives real queries from the caller\'s own text, strips task-framing words and the platform\'s own name', () => {
  it('the Step 6 acceptance command reduces to a real, meaningful primary query, never including "synthos"', () => {
    const queries = buildSearchQueries('Research the latest AI agent repositories relevant to SynthOS, compare the five most useful, and save the report to the Vault.');
    expect(queries[0]).toBe('ai agent');
    expect(queries.join(' ')).not.toContain('synthos');
  });

  it('never returns more than two queries', () => {
    const queries = buildSearchQueries('research the latest multi agent orchestration frameworks for autonomous llm agents');
    expect(queries.length).toBeLessThanOrEqual(2);
  });

  it('always includes the curated fallback query so a second attempt is possible if the primary is insufficient', () => {
    const queries = buildSearchQueries('research the latest AI agent repos');
    expect(queries).toContain('ai agent framework');
  });

  it('a query with no significant words after stripping falls back to the curated query alone', () => {
    const queries = buildSearchQueries('research the latest and most useful repos for the vault');
    expect(queries).toEqual(['ai agent framework']);
  });
});

describe('GithubRateLimitError: a real, distinguishable failure class for A5', () => {
  it('is a real Error subclass with its own name, distinguishable from a generic failure', () => {
    const err = new GithubRateLimitError('rate limited');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GithubRateLimitError');
    expect(err.message).toBe('rate limited');
  });
});

describe('buildReportMarkdown: deterministic structure, real data only, live GitHub provenance', () => {
  const repos: ResearchRepo[] = [
    { fullName: 'a/one', url: 'https://github.com/a/one', description: 'First', stars: 500, forks: 10, language: 'TypeScript', topics: ['agents'], license: 'MIT', openIssues: 3, archived: false, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', pushedAt: '2026-08-01T00:00:00Z', defaultBranch: 'main', homepage: null },
    { fullName: 'b/two', url: 'https://github.com/b/two', description: 'Second', stars: 900, forks: 20, language: 'Python', topics: [], license: null, openIssues: 1, archived: false, createdAt: null, updatedAt: null, pushedAt: '2026-07-15T00:00:00Z', defaultBranch: 'main', homepage: null },
  ];
  const sources: ResearchSource[] = repos.map((r) => ({ title: r.fullName, uri: r.url, retrievedAt: '2026-09-08T00:00:00Z' }));

  it('identifies GitHub, not Google Search, as the live source', () => {
    const md = buildReportMarkdown('AI agent frameworks', repos, sources, 'A real synthesis paragraph.', ['ai agent']);
    expect(md).toContain('**Live source**: GitHub Search API');
    expect(md).not.toMatch(/google search/i);
  });

  it('includes the query, repo count, real comparison table, and the real synthesis text verbatim', () => {
    const md = buildReportMarkdown('AI agent frameworks', repos, sources, 'A real synthesis paragraph.', ['ai agent']);
    expect(md).toContain('# Research: AI agent frameworks');
    expect(md).toContain('**Repositories reviewed**: 2');
    expect(md).toContain('[a/one](https://github.com/a/one)');
    expect(md).toContain('[b/two](https://github.com/b/two)');
    expect(md).toContain('500');
    expect(md).toContain('900');
    expect(md).toContain('A real synthesis paragraph.');
  });

  it('includes real per-repo provenance with a retrieval timestamp, never fabricated citations', () => {
    const md = buildReportMarkdown('query', repos, sources, 'synthesis', ['ai agent']);
    expect(md).toContain('## Sources (live, GitHub, retrieved this run)');
    expect(md).toContain('[a/one](https://github.com/a/one) — retrieved 2026-09-08T00:00:00Z');
  });

  it('missing optional fields (license, homepage) render honestly as n/a, never a fabricated value', () => {
    const md = buildReportMarkdown('query', [repos[1]], [sources[1]], 'synthesis', ['ai agent']);
    const row = md.split('\n').find((l) => l.includes('b/two'))!;
    expect(row).toContain('| n/a |'); // license column, real absence
  });

  it('a table cell never breaks on a pipe character in a real description', () => {
    const md = buildReportMarkdown('query', [{ ...repos[0], description: 'A | B' }], sources, 'synthesis', ['ai agent']);
    expect(md).toContain('A \\| B');
  });
});
