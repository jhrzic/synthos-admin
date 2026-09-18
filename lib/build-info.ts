// ---------------------------------------------------------------------------
// RUNNING VERSION — reported by /api/ready.
//
// The values are stamped outside this process when the code is fixed (see
// scripts/write-build-info.mjs and scripts/synthos-admin-service.sh) and
// passed in through five SYNTHOS_BUILD_* variables. This module reads ONLY
// those five variables, validates each one, and reports UNKNOWN for anything
// missing or malformed. It never runs git, never reads the working tree, never
// infers a commit from process-start time, and never echoes any other
// environment value.
// ---------------------------------------------------------------------------

export type BuildTree = 'CLEAN' | 'MODIFIED' | 'UNKNOWN';
export type BuildSource = 'LAUNCHER_GIT' | 'BUILD_MANIFEST' | 'UNKNOWN';

export interface BuildInfo {
  /** Full 40-hex commit SHA, or UNKNOWN. */
  commit: string;
  /** ISO time the metadata was stamped (bundle build, or source launch), or UNKNOWN. */
  buildTime: string;
  /** Branch or release identifier, or UNKNOWN. */
  ref: string;
  /** Whether the stamped checkout matched its commit exactly. */
  tree: BuildTree;
  /** Who stamped it. */
  source: BuildSource;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;

export function readBuildInfo(env: Record<string, string | undefined> = process.env): BuildInfo {
  const tree: BuildTree = env.SYNTHOS_BUILD_TREE === 'CLEAN' || env.SYNTHOS_BUILD_TREE === 'MODIFIED' ? env.SYNTHOS_BUILD_TREE : 'UNKNOWN';
  const rawSha = (env.SYNTHOS_BUILD_SHA ?? '').trim();
  // A SHA is only meaningful for a checkout that matched it exactly.
  const commit = SHA_RE.test(rawSha) && tree === 'CLEAN' ? rawSha : 'UNKNOWN';
  const rawTime = (env.SYNTHOS_BUILD_TIME ?? '').trim();
  const buildTime = rawTime && /^\d{4}-\d{2}-\d{2}T/.test(rawTime) && !Number.isNaN(Date.parse(rawTime)) ? new Date(rawTime).toISOString() : 'UNKNOWN';
  const rawRef = (env.SYNTHOS_BUILD_REF ?? '').trim();
  const ref = REF_RE.test(rawRef) ? rawRef : 'UNKNOWN';
  const source: BuildSource = env.SYNTHOS_BUILD_SOURCE === 'LAUNCHER_GIT' || env.SYNTHOS_BUILD_SOURCE === 'BUILD_MANIFEST' ? env.SYNTHOS_BUILD_SOURCE : 'UNKNOWN';
  return { commit, buildTime, ref, tree, source };
}
