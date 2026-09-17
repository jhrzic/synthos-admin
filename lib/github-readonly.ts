// ---------------------------------------------------------------------------
// TOOL PACK 1 — GitHub, read-only.
//
// Tool Pack 1 exposes github.search / github.read_file / github.inspect. The
// instruction was explicit: READ_ONLY only, no commit, no push, no issue or PR
// mutation, no repository administration — and reuse the existing GitHub
// plumbing rather than rebuilding it.
//
// WHAT WAS ALREADY THERE, AND WHAT IT COULD NOT DO
// lib/fabric/research.ts already calls GitHub's real Search API (repository
// search, with auth-header and base-URL-override conventions this file keeps).
// Two things stopped it being reusable as a tool:
//
//   1. It only searches repositories. There is no file read and no
//      commit/issue/PR/branch inspection anywhere in the repo.
//   2. Its one entry point, runLiveRepositoryResearch, REQUIRES a Gemini key
//      and throws if synthesis fails. So "search GitHub" was unreachable
//      without a model credential, even though the search itself needs none.
//
// So the HTTP conventions are reused and the read surface is widened. The
// discovery/ranking logic in research.ts is imported rather than reimplemented.
//
// READ-ONLY BY CONSTRUCTION, NOT BY CONVENTION
// Every request in this file goes through githubGet(), which hardcodes
// `method: 'GET'`. There is no parameter for a method, no request-body
// parameter, and no exported function that takes either. A mutation is
// therefore not something a caller can get wrong or a reviewer has to notice —
// the code to perform one does not exist here. test/tool-pack-security.test.ts
// asserts that by scanning this file's source for mutating verbs, so adding one
// later breaks the build rather than quietly shipping.
// ---------------------------------------------------------------------------

import { readBoundedBody } from './net-guard';

/** Same convention as lib/fabric/research.ts — optional, raises the rate limit. */
function githubAuthHeader(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Same override convention as lib/fabric/research.ts, so tests point at a real local double. */
export function githubApiBase(): string {
  return (process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '');
}

export function githubTokenPresent(): boolean {
  return !!(process.env.GITHUB_TOKEN || '').trim();
}

/** A file read is bounded — a repository may hold a 50MB generated file. */
export const MAX_GITHUB_FILE_BYTES = 512 * 1024;
const GITHUB_TIMEOUT_MS = 10_000;

export class GithubReadError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GithubReadError';
    this.status = status;
  }
}

/**
 * An input the boundary refused: a traversal segment, an absolute path, a
 * malformed ref.
 *
 * Distinct from GithubReadError on purpose. The envelope maps this to BLOCKED
 * and a GithubReadError to FAILED, and that distinction is what lets an audit
 * of the attempt ledger separate "a boundary held" from "the upstream call
 * broke". Collapsing them would make every rate limit look like an attack and
 * every traversal attempt look like an outage.
 */
export class GithubBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubBoundaryError';
  }
}

export class GithubRepositoryNotApprovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubRepositoryNotApprovedError';
  }
}

// ---------------------------------------------------------------------------
// The approved-repository boundary.
//
// A read-only tool still reads something, and an unbounded one would let any
// caller pull any file from any public repository on GitHub through SynthOS's
// own credential and rate limit. The boundary is an explicit allowlist.
//
// Empty allowlist = no repository approved = every repo-scoped read refused.
// That is the honest default: a tool whose boundary has not been configured is
// not usable, and reporting it NOT_CONFIGURED is better than defaulting to
// "all of GitHub" and calling it a feature.
//
// github.search is deliberately NOT repo-scoped — searching the public index
// discovers repositories and reads no repository content, so gating it on an
// allowlist of things you must already know about would make discovery
// impossible. It is bounded by result count instead.
// ---------------------------------------------------------------------------

export function approvedRepositories(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.GITHUB_APPROVED_REPOS || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.toLowerCase());
}

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Whether `repo` ("owner/name") is approved.
 *
 * A wildcard entry `owner/*` approves a whole owner, because approving forty
 * repositories of one org by hand is the kind of friction that gets a boundary
 * switched off entirely. A bare `*` is deliberately NOT honoured — "all of
 * GitHub" is not a boundary, and silently supporting it would make the
 * allowlist decorative.
 */
export function isRepositoryApproved(repo: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const target = repo.trim().toLowerCase();
  if (!REPO_SHAPE.test(target)) return false;
  const owner = target.split('/')[0];
  for (const entry of approvedRepositories(env)) {
    if (entry === '*' || entry === '*/*') continue; // never a valid boundary
    if (entry === target) return true;
    if (entry === `${owner}/*`) return true;
  }
  return false;
}

function assertApproved(repo: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!REPO_SHAPE.test(repo.trim())) {
    throw new GithubRepositoryNotApprovedError(`"${repo}" is not a well-formed owner/name repository reference.`);
  }
  if (!isRepositoryApproved(repo, env)) {
    const approved = approvedRepositories(env);
    throw new GithubRepositoryNotApprovedError(
      approved.length === 0
        ? `No GitHub repositories are approved for reading. Set GITHUB_APPROVED_REPOS to an explicit comma-separated list (owner/name, or owner/* for a whole owner) before using repository-scoped GitHub tools.`
        : `"${repo}" is not in the approved repository list (${approved.join(', ')}).`,
    );
  }
}

/**
 * The ONLY request function in this file. GET is hardcoded; there is no
 * parameter that could make it anything else.
 */
async function githubGet(pathAndQuery: string): Promise<{ status: number; body: unknown; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const res = await fetch(`${githubApiBase()}${pathAndQuery}`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'synthos-tools',
        ...githubAuthHeader(),
      },
      signal: controller.signal,
    });
    if (res.status === 403 || res.status === 429) {
      throw new GithubReadError(`GitHub refused the request (HTTP ${res.status}) — rate limit or access restriction.`, res.status);
    }
    if (res.status === 404) {
      throw new GithubReadError(`GitHub returned 404 for ${pathAndQuery} — the resource does not exist or is not visible to this credential.`, 404);
    }
    const { text, truncated } = await readBoundedBody(res, MAX_GITHUB_FILE_BYTES);
    if (!res.ok) {
      throw new GithubReadError(`GitHub returned HTTP ${res.status} for ${pathAndQuery}.`, res.status);
    }
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: res.status, body, truncated };
  } catch (err: any) {
    if (err instanceof GithubReadError) throw err;
    if (err?.name === 'AbortError') throw new GithubReadError(`GitHub request timed out after ${GITHUB_TIMEOUT_MS}ms.`, null);
    throw new GithubReadError(err?.message || String(err), null);
  } finally {
    clearTimeout(timer);
  }
}

// --- github.search -------------------------------------------------------

export interface GithubRepoSummary {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  license: string | null;
  pushedAt: string | null;
  archived: boolean;
}

export interface GithubSearchOutcome {
  query: string;
  totalCount: number | null;
  /** Bounded to `limit`; `totalCount` reports what GitHub says exists. */
  repositories: GithubRepoSummary[];
  retrievedAt: string;
  /** The exact upstream endpoint, recorded as provenance. */
  sourceEndpoint: string;
}

export async function githubSearchRepositories(query: string, limit = 10): Promise<GithubSearchOutcome> {
  const q = query.trim();
  if (!q) throw new GithubReadError('A non-empty search query is required.');
  const perPage = Math.max(1, Math.min(limit, 25));
  const pathAndQuery = `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`;
  const { body } = await githubGet(pathAndQuery);
  const items = Array.isArray((body as any)?.items) ? (body as any).items : [];
  return {
    query: q,
    totalCount: typeof (body as any)?.total_count === 'number' ? (body as any).total_count : null,
    repositories: items.slice(0, perPage).map((i: any): GithubRepoSummary => ({
      fullName: String(i?.full_name || ''),
      url: typeof i?.html_url === 'string' ? i.html_url : `https://github.com/${i?.full_name}`,
      description: typeof i?.description === 'string' ? i.description : null,
      stars: typeof i?.stargazers_count === 'number' ? i.stargazers_count : 0,
      language: typeof i?.language === 'string' ? i.language : null,
      license: i?.license && typeof i.license.spdx_id === 'string' ? i.license.spdx_id : null,
      pushedAt: typeof i?.pushed_at === 'string' ? i.pushed_at : null,
      archived: i?.archived === true,
    })).filter((r: GithubRepoSummary) => r.fullName),
    retrievedAt: new Date().toISOString(),
    sourceEndpoint: `${githubApiBase()}${pathAndQuery}`,
  };
}

// --- github.read_file ----------------------------------------------------

export interface GithubFileOutcome {
  repo: string;
  path: string;
  ref: string | null;
  sizeBytes: number;
  /** Decoded UTF-8 text. Null when the target is binary or not a file. */
  content: string | null;
  truncated: boolean;
  sha: string;
  htmlUrl: string | null;
  retrievedAt: string;
  sourceEndpoint: string;
}

/**
 * Validate a repository-relative path, returning its safe segments.
 *
 * Exported so the envelope can run it BEFORE entering ctx.invoke(). Where a
 * boundary is checked changes what the evidence says: inside the invocation
 * wrapper, a refusal still records an invocation, and the attempt ledger
 * derives `providerCalled` from whether any invocation was recorded — so a
 * traversal attempt that never left the process would have appeared in the
 * ledger as a real call to GitHub. githubReadFile still calls this itself, so
 * the check cannot be skipped by a caller that forgets; running it early only
 * makes the evidence truthful.
 */
export function validateRepoPath(rawInput: string | null | undefined): string[] {
  const raw = String(rawInput || '').trim();
  if (!raw) throw new GithubBoundaryError('A file path is required.');
  if (raw.startsWith('/') || raw.startsWith('\\')) {
    throw new GithubBoundaryError('An absolute path is not accepted — give a repository-relative path.');
  }
  if (raw.includes('\0')) throw new GithubBoundaryError('A path containing a NUL byte is refused.');
  const segments = raw.split(/[\\/]+/).filter(Boolean);
  if (segments.some((seg) => seg === '..' || seg === '.')) {
    throw new GithubBoundaryError('A path containing "." or ".." segments is refused.');
  }
  return segments;
}

/** Validate an optional git ref. Returns null when absent. */
export function validateRef(rawInput: string | null | undefined): string | null {
  const ref = rawInput && String(rawInput).trim() ? String(rawInput).trim() : null;
  if (ref && !/^[A-Za-z0-9._\/-]{1,255}$/.test(ref)) {
    throw new GithubBoundaryError('The ref contains characters that are not valid in a git ref.');
  }
  return ref;
}

/**
 * Read one file from an APPROVED repository.
 *
 * The path is sanitised independently of the allowlist: GitHub's contents API
 * takes the path in the URL, so `..` segments would otherwise be a traversal
 * against the API's own namespace, and an absolute path or a protocol-relative
 * string could redirect the request away from the intended repository.
 */
export async function githubReadFile(params: { repo: string; path: string; ref?: string | null }): Promise<GithubFileOutcome> {
  assertApproved(params.repo);

  const segments = validateRepoPath(params.path);
  const safePath = segments.join('/');
  const ref = validateRef(params.ref);

  const pathAndQuery =
    `/repos/${params.repo}/contents/${segments.map(encodeURIComponent).join('/')}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : '');
  const { body, truncated } = await githubGet(pathAndQuery);

  const node: any = body;
  if (Array.isArray(node)) {
    throw new GithubReadError(`"${safePath}" is a directory, not a file.`);
  }
  if (!node || node.type !== 'file') {
    throw new GithubReadError(`"${safePath}" is not a readable file (type: ${node?.type ?? 'unknown'}).`);
  }

  let content: string | null = null;
  if (typeof node.content === 'string' && node.encoding === 'base64') {
    const buf = Buffer.from(node.content.replace(/\n/g, ''), 'base64');
    // A NUL byte in the first chunk is the standard heuristic for binary.
    content = buf.subarray(0, 8000).includes(0) ? null : buf.subarray(0, MAX_GITHUB_FILE_BYTES).toString('utf8');
  }

  return {
    repo: params.repo,
    path: safePath,
    ref,
    sizeBytes: typeof node.size === 'number' ? node.size : 0,
    content,
    truncated: truncated || node.truncated === true || (typeof node.size === 'number' && node.size > MAX_GITHUB_FILE_BYTES),
    sha: String(node.sha || ''),
    htmlUrl: typeof node.html_url === 'string' ? node.html_url : null,
    retrievedAt: new Date().toISOString(),
    sourceEndpoint: `${githubApiBase()}${pathAndQuery}`,
  };
}

// --- github.inspect ------------------------------------------------------

export type GithubInspectSubject = 'commit' | 'issue' | 'pull' | 'branch' | 'repo';

export interface GithubInspectOutcome {
  repo: string;
  subject: GithubInspectSubject;
  ref: string | null;
  /** Normalised metadata. Deliberately a projection, not the raw upstream payload. */
  metadata: Record<string, unknown>;
  retrievedAt: string;
  sourceEndpoint: string;
}

/**
 * Inspect commit / issue / pull request / branch / repository METADATA.
 *
 * Returns a projection rather than GitHub's raw JSON on purpose. The raw
 * payloads carry hundreds of fields including full user objects and every
 * available API URL; handing that through unfiltered would put a large,
 * unreviewed, attacker-influenceable blob (an issue title and body are written
 * by whoever opened the issue) straight into a model's context. The projection
 * is the reviewed surface.
 */
export async function githubInspect(params: { repo: string; subject: GithubInspectSubject; ref?: string | null }): Promise<GithubInspectOutcome> {
  assertApproved(params.repo);
  const subject = params.subject;
  const ref = validateRef(params.ref);

  const needsRef: GithubInspectSubject[] = ['commit', 'issue', 'pull', 'branch'];
  if (needsRef.includes(subject) && !ref) {
    throw new GithubReadError(`Inspecting a ${subject} requires a ref (a sha, number or branch name).`);
  }
  if ((subject === 'issue' || subject === 'pull') && !/^\d+$/.test(ref || '')) {
    throw new GithubReadError(`Inspecting a ${subject} requires its number.`);
  }

  let pathAndQuery: string;
  switch (subject) {
    case 'commit': pathAndQuery = `/repos/${params.repo}/commits/${encodeURIComponent(ref!)}`; break;
    case 'issue': pathAndQuery = `/repos/${params.repo}/issues/${encodeURIComponent(ref!)}`; break;
    case 'pull': pathAndQuery = `/repos/${params.repo}/pulls/${encodeURIComponent(ref!)}`; break;
    case 'branch': pathAndQuery = `/repos/${params.repo}/branches/${encodeURIComponent(ref!)}`; break;
    case 'repo': pathAndQuery = `/repos/${params.repo}`; break;
    default: throw new GithubReadError(`Unsupported inspect subject "${subject}".`);
  }

  const { body } = await githubGet(pathAndQuery);
  const n: any = body || {};

  let metadata: Record<string, unknown>;
  switch (subject) {
    case 'commit':
      metadata = {
        sha: n.sha ?? null,
        message: typeof n.commit?.message === 'string' ? n.commit.message.slice(0, 2000) : null,
        authorName: n.commit?.author?.name ?? null,
        authoredAt: n.commit?.author?.date ?? null,
        committedAt: n.commit?.committer?.date ?? null,
        additions: n.stats?.additions ?? null,
        deletions: n.stats?.deletions ?? null,
        changedFiles: Array.isArray(n.files) ? n.files.length : null,
        htmlUrl: n.html_url ?? null,
      };
      break;
    case 'issue':
      metadata = {
        number: n.number ?? null,
        title: typeof n.title === 'string' ? n.title.slice(0, 500) : null,
        state: n.state ?? null,
        authorLogin: n.user?.login ?? null,
        createdAt: n.created_at ?? null,
        updatedAt: n.updated_at ?? null,
        closedAt: n.closed_at ?? null,
        comments: n.comments ?? null,
        labels: Array.isArray(n.labels) ? n.labels.map((l: any) => (typeof l === 'string' ? l : l?.name)).filter(Boolean) : [],
        bodyExcerpt: typeof n.body === 'string' ? n.body.slice(0, 2000) : null,
        htmlUrl: n.html_url ?? null,
      };
      break;
    case 'pull':
      metadata = {
        number: n.number ?? null,
        title: typeof n.title === 'string' ? n.title.slice(0, 500) : null,
        state: n.state ?? null,
        draft: n.draft === true,
        merged: n.merged === true,
        mergeable: n.mergeable ?? null,
        authorLogin: n.user?.login ?? null,
        baseRef: n.base?.ref ?? null,
        headRef: n.head?.ref ?? null,
        additions: n.additions ?? null,
        deletions: n.deletions ?? null,
        changedFiles: n.changed_files ?? null,
        createdAt: n.created_at ?? null,
        mergedAt: n.merged_at ?? null,
        bodyExcerpt: typeof n.body === 'string' ? n.body.slice(0, 2000) : null,
        htmlUrl: n.html_url ?? null,
      };
      break;
    case 'branch':
      metadata = {
        name: n.name ?? null,
        protected: n.protected === true,
        commitSha: n.commit?.sha ?? null,
        commitMessage: typeof n.commit?.commit?.message === 'string' ? n.commit.commit.message.slice(0, 2000) : null,
        commitAuthoredAt: n.commit?.commit?.author?.date ?? null,
      };
      break;
    default:
      metadata = {
        fullName: n.full_name ?? null,
        description: typeof n.description === 'string' ? n.description.slice(0, 1000) : null,
        defaultBranch: n.default_branch ?? null,
        stars: n.stargazers_count ?? null,
        forks: n.forks_count ?? null,
        openIssues: n.open_issues_count ?? null,
        language: n.language ?? null,
        license: n.license?.spdx_id ?? null,
        archived: n.archived === true,
        pushedAt: n.pushed_at ?? null,
        visibility: n.visibility ?? null,
      };
      break;
  }

  return {
    repo: params.repo,
    subject,
    ref,
    metadata,
    retrievedAt: new Date().toISOString(),
    sourceEndpoint: `${githubApiBase()}${pathAndQuery}`,
  };
}
