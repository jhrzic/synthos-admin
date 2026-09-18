#!/usr/bin/env node
// ---------------------------------------------------------------------------
// BUILD INFO — which exact commit is this process running?
//
// Stamped OUTSIDE the server, at the moment the code is fixed:
//   * `npm run build` writes dist/build-info.json next to the bundle;
//   * the launchd launcher (scripts/synthos-admin-service.sh) stamps the
//     source it is about to run in development mode, or re-exports the
//     bundle's manifest in production mode.
// The server only reads the result (lib/build-info.ts); it never runs git.
//
// Truth rules:
//   * A SHA is recorded ONLY when `git status --porcelain` is empty. With any
//     modified, staged or untracked (non-ignored) file the running code is
//     not that commit, so the SHA is withheld and the tree is MODIFIED.
//   * Anything that cannot be read is simply absent — the server reports it
//     as UNKNOWN. Nothing here guesses.
//
// Usage:
//   node scripts/write-build-info.mjs --out dist/build-info.json   (build)
//   node scripts/write-build-info.mjs --shell                      (launcher, dev)
//   node scripts/write-build-info.mjs --from dist/build-info.json --shell
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Collect build info for the working tree at `cwd`. Pure apart from reading git.
 * @returns {{ schema: number, tree: 'CLEAN'|'MODIFIED'|'UNKNOWN', buildTime: string, commit?: string, ref?: string }}
 */
export function collectBuildInfo(cwd, now = new Date()) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const porcelain = git(cwd, ['status', '--porcelain']);
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const tree = porcelain === null ? 'UNKNOWN' : porcelain === '' ? 'CLEAN' : 'MODIFIED';
  /** @type {{ schema: number, tree: 'CLEAN'|'MODIFIED'|'UNKNOWN', buildTime: string, commit?: string, ref?: string }} */
  const info = { schema: 1, tree, buildTime: now.toISOString() };
  if (tree === 'CLEAN' && head && SHA_RE.test(head)) info.commit = head;
  if (branch && branch !== 'HEAD' && REF_RE.test(branch)) info.ref = branch;
  return info;
}

/** KEY=value lines for the launcher. Only validated values are emitted. */
export function toShell(info, source) {
  const lines = [`SYNTHOS_BUILD_SOURCE=${source}`];
  if (typeof info.commit === 'string' && SHA_RE.test(info.commit)) lines.push(`SYNTHOS_BUILD_SHA=${info.commit}`);
  if (typeof info.buildTime === 'string' && !Number.isNaN(Date.parse(info.buildTime))) lines.push(`SYNTHOS_BUILD_TIME=${new Date(info.buildTime).toISOString()}`);
  if (typeof info.ref === 'string' && REF_RE.test(info.ref)) lines.push(`SYNTHOS_BUILD_REF=${info.ref}`);
  if (['CLEAN', 'MODIFIED', 'UNKNOWN'].includes(info.tree)) lines.push(`SYNTHOS_BUILD_TREE=${info.tree}`);
  return lines.join('\n');
}

function main(argv) {
  const cwd = process.cwd();
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const from = at('--from');
  const out = at('--out');
  let info;
  let source;
  if (from) {
    try { info = JSON.parse(fs.readFileSync(path.resolve(cwd, from), 'utf8')); } catch { info = {}; }
    source = 'BUILD_MANIFEST';
  } else {
    info = collectBuildInfo(cwd);
    source = 'LAUNCHER_GIT';
  }
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(cwd, out)), { recursive: true });
    fs.writeFileSync(path.resolve(cwd, out), JSON.stringify(info, null, 2) + '\n');
  }
  if (argv.includes('--shell')) process.stdout.write(toShell(info, source) + '\n');
  if (!out && !argv.includes('--shell')) process.stdout.write(JSON.stringify(info, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
