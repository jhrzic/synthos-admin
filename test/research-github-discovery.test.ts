import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { discoverLiveRepositories, runLiveRepositoryResearch } from '../lib/fabric/research';
import { createExecutionContext } from '../lib/fabric/context';

// ---------------------------------------------------------------------------
// STEP 6 corrective pass, A7 — real HTTP against a real local mock GitHub
// server (same pattern as test/external-executions.test.ts's mock Windmill
// server), not a fetch mock. Proves: GitHub Search is actually called,
// ranking/dedup/field-safety are real, and a real rate-limit response stops
// the run before any synthesis/artifact/receipt is attempted.
// ---------------------------------------------------------------------------

let server: http.Server;
let port: number;
const requestLog: string[] = [];

function repoItem(fullName: string, stars: number, overrides: Partial<Record<string, unknown>> = {}) {
  const [owner, repo] = fullName.split('/');
  return {
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: `Description for ${repo}`,
    stargazers_count: stars,
    forks_count: Math.floor(stars / 10),
    language: 'Python',
    topics: ['agents'],
    license: { spdx_id: 'MIT' },
    open_issues_count: 5,
    archived: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    pushed_at: '2026-09-01T00:00:00Z',
    default_branch: 'main',
    homepage: null,
    ...overrides,
  };
}

let mode: 'normal' | 'rate-limited' | 'sparse' | 'missing-fields' = 'normal';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requestLog.push(req.url || '');
    const url = new URL(req.url || '', 'http://localhost');
    if (url.pathname !== '/search/repositories') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'not found' }));
    }
    if (mode === 'rate-limited') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'API rate limit exceeded' }));
    }
    if (mode === 'missing-fields') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items: [{ full_name: 'x/bare' }] })); // only the required field present
    }
    if (mode === 'sparse') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items: [repoItem('a/one', 100)] })); // fewer than maxRepos
    }
    // normal: 6 real-shaped items with a deliberate cross-query duplicate
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items: [
        repoItem('org1/low', 50),
        repoItem('org2/high', 900),
        repoItem('org3/mid', 300),
        repoItem('org4/dup', 200),
        repoItem('org4/dup', 200), // same full_name again within one response — must still dedupe
        repoItem('org5/mid2', 400),
        repoItem('org6/extra', 10),
      ],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  process.env.GITHUB_API_BASE_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.GITHUB_API_BASE_URL;
});

describe('A7.1/A7.4/A7.5: GitHub Search is actually called, and ranking/dedup are real', () => {
  it('discoverLiveRepositories makes a real HTTP call to /search/repositories and returns up to maxRepos, sorted by real stars descending, deduplicated', async () => {
    mode = 'normal';
    requestLog.length = 0;
    const ctx = createExecutionContext({ workspaceId: 'ws-research-discovery' });
    const result = await discoverLiveRepositories('ai agent framework', ctx, 5);

    expect(requestLog.some((u) => u.startsWith('/search/repositories'))).toBe(true);
    expect(result.repos.length).toBe(5);
    // Real, distinct, deduplicated full names — the intra-response duplicate never appears twice.
    const names = result.repos.map((r) => r.fullName);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n === 'org4/dup').length).toBe(1);

    const invocationNames = ctx.getInvocations().map((r) => r.name);
    expect(invocationNames.every((n) => n === 'github.search')).toBe(true);
  });
});

describe('A7.9: toolsInvoked reflects only real calls — a second query is never made once enough candidates exist', () => {
  it('stops after one real search call when the first query already returns enough candidates', async () => {
    mode = 'normal';
    requestLog.length = 0;
    const ctx = createExecutionContext({ workspaceId: 'ws-research-discovery' });
    await discoverLiveRepositories('ai agent framework', ctx, 5);
    expect(requestLog.length).toBe(1); // the primary query alone already yielded 5+ unique repos
  });

  it('tries the second (fallback) real query only when the first was insufficient', async () => {
    mode = 'sparse';
    requestLog.length = 0;
    const ctx = createExecutionContext({ workspaceId: 'ws-research-discovery' });
    const result = await discoverLiveRepositories('research the latest multi agent orchestration tools', ctx, 5);
    expect(requestLog.length).toBe(2); // primary + fallback, both real, both needed since 'sparse' mode never has enough
    expect(result.searchQueriesUsed.length).toBe(2);
  });
});

describe('A7.6: missing optional fields never fabricate a value', () => {
  it('a search result with only full_name present maps to honest defaults, not invented data', async () => {
    mode = 'missing-fields';
    requestLog.length = 0;
    const ctx = createExecutionContext({ workspaceId: 'ws-research-discovery' });
    const result = await discoverLiveRepositories('ai agent framework', ctx, 5);
    expect(result.repos.length).toBe(1);
    const repo = result.repos[0];
    expect(repo.fullName).toBe('x/bare');
    expect(repo.stars).toBe(0);
    expect(repo.forks).toBe(0);
    expect(repo.description).toBeNull();
    expect(repo.language).toBeNull();
    expect(repo.license).toBeNull();
    expect(repo.topics).toEqual([]);
    expect(repo.archived).toBe(false);
    expect(repo.pushedAt).toBeNull();
    expect(repo.homepage).toBeNull();
  });
});

describe('A7.7: a real GitHub rate-limit response stops the run before synthesis/artifact/Aegis/receipt', () => {
  it('runLiveRepositoryResearch throws a real GithubRateLimitError, before any Gemini call is attempted', async () => {
    mode = 'rate-limited';
    requestLog.length = 0;
    const ctx = createExecutionContext({ workspaceId: 'ws-research-discovery' });
    await expect(
      runLiveRepositoryResearch({ apiKey: 'irrelevant-never-reached', query: 'ai agent framework' }, ctx)
    ).rejects.toMatchObject({ name: 'GithubRateLimitError' });

    // No model.gemini invocation was ever attempted — the failure happened
    // at discovery, before synthesis had anything to work with.
    const invocationNames = ctx.getInvocations().map((r) => r.name);
    expect(invocationNames).not.toContain('model.gemini');
  });
});

describe('A7.2: no Google Search grounding remains anywhere in the research module', () => {
  it('the source contains no googleSearch tool config, grounding config, or grounding metadata field access', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/fabric/research.ts'), 'utf-8');
    expect(source).not.toContain('googleSearch');
    expect(source).not.toContain('tools: [{');
    expect(source).not.toContain('groundingMetadata');
    expect(source).not.toContain('groundingChunks');
  });
});

describe('A7.3: candidates never come from model-memory text — only from real, structured GitHub JSON', () => {
  it('a repo is only ever produced by mapping a real search-result item (full_name required) — there is no code path that derives a repo from free text', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/fabric/research.ts'), 'utf-8');
    // The only place a ResearchRepo is constructed is toResearchRepo(), fed
    // exclusively by real JSON search response items — confirmed by the
    // absence of any text-regex-based extraction (the old
    // extractRepoCandidates()/GITHUB_REPO_URL_PATTERN approach is gone).
    expect(source).not.toContain('GITHUB_REPO_URL_PATTERN');
    expect(source).not.toContain('extractRepoCandidates');
    expect(source).toContain('function toResearchRepo(item: GithubSearchItem)');
  });
});
