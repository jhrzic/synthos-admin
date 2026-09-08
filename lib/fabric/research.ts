// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 6: the first real live-research capability.
//
// Two real external calls, both wrapped in the caller's ExecutionContext so
// the invocation trace is truthful:
//
//   1. model.gemini.grounded — a real Gemini call using the installed SDK's
//      (@google/genai 2.18.0) built-in Google Search grounding tool
//      (config.tools: [{ googleSearch: {} }]). This is genuinely live —
//      the model's response carries real groundingMetadata.groundingChunks
//      with real web URIs, not text recalled from training data. This is
//      the ONLY thing standing in for a live web search here: no
//      Tavily/Brave/Serper dependency was added, per the explicit
//      instruction to prefer what the existing provider can truthfully do
//      before reaching for a new one.
//
//   2. github.api — the real, public GitHub REST API
//      (api.github.com/repos/{owner}/{repo}), one real HTTP call per
//      candidate repository the grounded search actually surfaced.
//      Unauthenticated calls work today (GitHub's public per-IP rate
//      limit is enough for a handful of repos per research call); an
//      optional GITHUB_TOKEN raises that limit for production use. It is
//      read only from a real Node process environment
//      (`process.env.GITHUB_TOKEN`) — never a VITE_-prefixed variable,
//      matching the same rule this repo already applies to
//      HERMES_ADAPTER_TOKEN and WINDMILL_TOKEN.
//
// This module gathers real data and returns it; it does not persist
// anything itself (no task/artifact/Aegis/receipt) — that lifecycle is
// lib/fabric/envelope.ts's job, shared with any future ACTION_REQUEST
// capability that needs the same real pipeline.
//
// A repo candidate that the GitHub API can't resolve (404, rate-limited,
// network error) is skipped, never fabricated or padded with invented
// stats. The final synthesis is built deterministically from the real
// fetched numbers only — no second model call that could introduce an
// unverified claim about repositories that were already fetched as real
// structured data.
// ---------------------------------------------------------------------------

import { GoogleGenAI } from '@google/genai';
import type { ExecutionContext } from './types';

export interface ResearchSource {
  title: string | null;
  uri: string;
}

export interface ResearchRepo {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  pushedAt: string | null;
}

export interface ResearchResult {
  query: string;
  groundedText: string;
  sources: ResearchSource[];
  repos: ResearchRepo[];
  reportMarkdown: string;
}

const GITHUB_REPO_URL_PATTERN = /github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)/g;

// Model choice: the same Gemini identifiers this deployment already
// resolves via lib/model-router.ts's classifyModelRequest; grounding is
// requested via config.tools, not a different model family.
const GROUNDED_MODEL = 'gemini-3.1-flash-lite';

export function extractRepoCandidates(text: string, sources: ResearchSource[]): Array<{ owner: string; repo: string }> {
  const seen = new Set<string>();
  const candidates: Array<{ owner: string; repo: string }> = [];
  const haystacks = [text, ...sources.map((s) => s.uri)];
  for (const haystack of haystacks) {
    if (!haystack) continue;
    for (const match of haystack.matchAll(GITHUB_REPO_URL_PATTERN)) {
      const owner = match[1];
      const repo = match[2].replace(/\.git$/, '').replace(/[).,;:'"]+$/, '');
      if (!owner || !repo) continue;
      const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ owner, repo });
      }
    }
  }
  return candidates;
}

export function buildReportMarkdown(query: string, repos: ResearchRepo[], sources: ResearchSource[]): string {
  const lines: string[] = [];
  lines.push(`# Research: ${query}`);
  lines.push('');
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push(`**Repositories reviewed**: ${repos.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Repository Comparison');
  lines.push('');
  lines.push('| # | Repository | Stars | Language | Last Updated | Description |');
  lines.push('|---|---|---|---|---|---|');
  repos.forEach((r, i) => {
    const description = (r.description || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${i + 1} | [${r.fullName}](${r.url}) | ${r.stars} | ${r.language || 'n/a'} | ${r.pushedAt ? r.pushedAt.slice(0, 10) : 'n/a'} | ${description} |`);
  });
  lines.push('');
  if (repos.length > 0) {
    const top = repos[0];
    lines.push(`Of the ${repos.length} repositories reviewed, **${top.fullName}** has the most stars (${top.stars}), last updated ${top.pushedAt ? top.pushedAt.slice(0, 10) : 'unknown'}.`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Sources');
  lines.push('');
  if (sources.length === 0) {
    lines.push('No grounding sources were returned by the search.');
  } else {
    for (const s of sources) {
      lines.push(`- [${s.title || s.uri}](${s.uri})`);
    }
  }
  return lines.join('\n');
}

export async function runLiveRepositoryResearch(
  params: { apiKey: string; query: string; maxRepos?: number },
  ctx: ExecutionContext
): Promise<ResearchResult> {
  const maxRepos = params.maxRepos ?? 5;

  const grounded = await ctx.invoke('model.gemini.grounded', async () => {
    const ai = new GoogleGenAI({ apiKey: params.apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const response = await ai.models.generateContent({
      model: GROUNDED_MODEL,
      contents: `Using live Google Search, list at least 8 currently active, real, well-known open-source GitHub repositories relevant to: ${params.query}. For each one, state its exact github.com URL on its own line. Prefer projects with recent activity.`,
      config: { tools: [{ googleSearch: {} }], temperature: 0.1 },
    });
    const text = response.text || '';
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources: ResearchSource[] = chunks
      .map((c) => (c.web?.uri ? { title: c.web.title || null, uri: c.web.uri } : null))
      .filter((s): s is ResearchSource => !!s);
    return { text, sources };
  });

  const candidates = extractRepoCandidates(grounded.text, grounded.sources);
  const repos: ResearchRepo[] = [];
  const githubToken = process.env.GITHUB_TOKEN || '';
  for (const candidate of candidates) {
    if (repos.length >= maxRepos) break;
    try {
      const repo = await ctx.invoke('github.api', async () => {
        const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'synthos-research' };
        if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
        const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(candidate.owner)}/${encodeURIComponent(candidate.repo)}`, { headers });
        if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status} for ${candidate.owner}/${candidate.repo}`);
        const body: any = await res.json();
        const result: ResearchRepo = {
          fullName: String(body.full_name ?? `${candidate.owner}/${candidate.repo}`),
          url: String(body.html_url ?? `https://github.com/${candidate.owner}/${candidate.repo}`),
          description: typeof body.description === 'string' ? body.description : null,
          stars: typeof body.stargazers_count === 'number' ? body.stargazers_count : 0,
          language: typeof body.language === 'string' ? body.language : null,
          pushedAt: typeof body.pushed_at === 'string' ? body.pushed_at : null,
        };
        return result;
      });
      repos.push(repo);
    } catch {
      // A single unresolved candidate is skipped honestly — never padded
      // with a fabricated entry.
    }
  }

  repos.sort((a, b) => b.stars - a.stars);
  const reportMarkdown = buildReportMarkdown(params.query, repos, grounded.sources);

  return { query: params.query, groundedText: grounded.text, sources: grounded.sources, repos, reportMarkdown };
}
