// ---------------------------------------------------------------------------
// TOOL PACK 1 — the filesystem read boundary for files.read.
//
// The instruction: read files only from explicitly allowed SynthOS workspace
// roots; no raw arbitrary path from the client, no `..` traversal, no symlink
// escape, no unrestricted $HOME, no .ssh, no .env, no credential directories.
// And: do not create a generic shell/file manager.
//
// WHY THIS IS A SEPARATE MODULE FROM lib/vault.ts
// lib/vault.ts already owns artifact reads, and its safety contract says so
// explicitly: every path it reads is one the write path itself stored in
// `artifacts.relative_path` — never client-supplied. files.read is the opposite
// case. Its whole purpose is to accept a path from a caller, which means it is
// the first read surface in this repo where client input reaches the
// filesystem. Bolting that onto vault.ts would have quietly falsified that
// module's stated contract, and that contract is load-bearing — it is the
// reason its reads are allowed to be as simple as they are.
//
// THE MODEL: ALLOWLISTED ROOT + RELATIVE PATH. Never one absolute path.
// A caller does not pass a filesystem path. It passes a ROOT KEY naming one of
// a small set of server-defined roots, plus a path relative to that root. There
// is no code path by which a caller-supplied absolute path becomes the target,
// so "no unrestricted $HOME" is structural rather than a blocklist that has to
// anticipate every way of spelling the home directory.
//
// DEFENCE ORDER (each layer catches what the one before cannot):
//   1. Root key must be a known key. Unknown key -> refused, no disk access.
//   2. Relative path is decomposed into segments; any `..`, `.`, absolute
//      prefix, NUL, or path separator inside a segment -> refused.
//   3. Sensitive-name check on every segment (dotfiles like .env/.ssh, key
//      material extensions, credential directories) -> refused. This is belt
//      and braces: layers 1 and 2 already confine the read to a root that
//      should not contain such files, and this catches the case where one gets
//      planted inside an allowed root.
//   4. The root is realpath-resolved as the trusted anchor, the target is
//      realpath-resolved, and containment is re-checked. A symlink anywhere in
//      the chain fails here instead of being followed — the same technique
//      writeWorkspaceArtifact() already uses for writes.
//   5. lstat (which does NOT follow symlinks) confirms the final node is a
//      regular file, so a symlink whose own target is inside the root is still
//      refused rather than read through.
//   6. The read is byte-bounded.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

/** Ceiling on a single tool-mediated file read. */
export const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;

export class FileBoundaryError extends Error {
  readonly code: 'UNKNOWN_ROOT' | 'BAD_PATH' | 'SENSITIVE' | 'ESCAPE' | 'NOT_A_FILE' | 'NOT_FOUND';
  constructor(code: FileBoundaryError['code'], message: string) {
    super(message);
    this.name = 'FileBoundaryError';
    this.code = code;
  }
}

/**
 * The allowed roots, by key.
 *
 * Deliberately small and deliberately NOT the repository root. `docs` and
 * `vault` are content; the repo root would include `.env`, `data/` (the
 * database and encryption keys), `node_modules`, and `.git` — that is not a
 * boundary worth defending, so it is not offered.
 */
export function allowedFileRoots(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const cwd = env.SYNTHOS_REPO_ROOT || process.cwd();
  return {
    docs: path.join(cwd, 'docs'),
    vault: path.join(cwd, 'vault'),
    scripts: path.join(cwd, 'scripts'),
  };
}

export function allowedFileRootKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(allowedFileRoots(env));
}

/**
 * Names that are refused even inside an allowed root.
 *
 * Matched on the whole segment, case-insensitively. A prefix match on "."
 * would refuse too much (`.gitkeep` is harmless) and a substring match would
 * refuse too little, so this is an explicit set plus a small set of
 * key-material extensions.
 */
const SENSITIVE_SEGMENTS = new Set([
  '.env', '.env.local', '.env.production', '.env.development', '.env.test',
  '.ssh', '.aws', '.gnupg', '.gpg', '.kube', '.docker', '.npmrc', '.netrc',
  '.git', '.git-credentials', '.htpasswd', 'id_rsa', 'id_ed25519', 'id_ecdsa',
  'credentials', 'secrets', 'keys', 'keystore', '.synthos',
]);

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.asc', '.ppk']);

export function isSensitiveSegment(segment: string): boolean {
  const s = segment.toLowerCase();
  if (SENSITIVE_SEGMENTS.has(s)) return true;
  // Any .env variant, e.g. .env.staging.local
  if (s === '.env' || s.startsWith('.env.')) return true;
  if (SENSITIVE_EXTENSIONS.has(path.extname(s))) return true;
  return false;
}

export interface ResolvedWorkspaceFile {
  rootKey: string;
  /** Path relative to the root, normalised. What a caller should quote back. */
  relativePath: string;
  absolutePath: string;
}

/**
 * Resolve (rootKey, relativePath) to a real, contained, non-sensitive regular
 * file — or throw. Exported separately from the read so tests can assert the
 * boundary without needing a file to exist.
 */
export function resolveWorkspaceFile(
  rootKey: string,
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedWorkspaceFile {
  // --- Layer 1: known root key --------------------------------------------
  const roots = allowedFileRoots(env);
  if (!Object.prototype.hasOwnProperty.call(roots, rootKey)) {
    throw new FileBoundaryError(
      'UNKNOWN_ROOT',
      `"${rootKey}" is not an allowed file root. Allowed roots: ${Object.keys(roots).join(', ')}.`,
    );
  }
  const rootPath = roots[rootKey];

  // --- Layer 2: path shape -------------------------------------------------
  const raw = String(relativePath ?? '').trim();
  if (!raw) throw new FileBoundaryError('BAD_PATH', 'A relative file path is required.');
  if (raw.includes('\0')) throw new FileBoundaryError('BAD_PATH', 'A path containing a NUL byte is refused.');
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new FileBoundaryError('BAD_PATH', 'An absolute path is refused — pass a path relative to the chosen root.');
  }
  // Split on BOTH separators, so a Windows-style `..\\..\\etc` cannot survive
  // on a platform where path.sep is '/'.
  const segments = raw.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.length === 0) throw new FileBoundaryError('BAD_PATH', 'A relative file path is required.');
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new FileBoundaryError('BAD_PATH', `A path containing a "${segment}" segment is refused.`);
    }
  }

  // --- Layer 3: sensitive names -------------------------------------------
  for (const segment of segments) {
    if (isSensitiveSegment(segment)) {
      throw new FileBoundaryError('SENSITIVE', `"${segment}" names a credential-bearing or sensitive path and is refused.`);
    }
  }

  const normalisedRelative = segments.join('/');
  const candidate = path.join(rootPath, ...segments);

  // --- Layer 4: realpath containment --------------------------------------
  let trustedRoot: string;
  try {
    trustedRoot = fs.realpathSync(rootPath);
  } catch {
    throw new FileBoundaryError('NOT_FOUND', `The "${rootKey}" root does not exist on this machine (${rootPath}).`);
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(candidate);
  } catch {
    throw new FileBoundaryError('NOT_FOUND', `"${normalisedRelative}" does not exist under the "${rootKey}" root.`);
  }
  const contained = realTarget === trustedRoot || realTarget.startsWith(trustedRoot + path.sep);
  if (!contained) {
    throw new FileBoundaryError(
      'ESCAPE',
      `"${normalisedRelative}" resolves outside the "${rootKey}" root (symlink escape) and is refused.`,
    );
  }

  // --- Layer 5: lstat, which does NOT follow symlinks ---------------------
  // Checked AFTER containment so the message is about the right problem, and
  // on the pre-realpath candidate so a symlink is caught as a symlink.
  let lst: fs.Stats;
  try {
    lst = fs.lstatSync(candidate);
  } catch {
    throw new FileBoundaryError('NOT_FOUND', `"${normalisedRelative}" does not exist under the "${rootKey}" root.`);
  }
  if (lst.isSymbolicLink()) {
    throw new FileBoundaryError('ESCAPE', `"${normalisedRelative}" is a symbolic link; reading through it is refused.`);
  }
  if (!lst.isFile()) {
    throw new FileBoundaryError('NOT_A_FILE', `"${normalisedRelative}" is not a regular file.`);
  }

  return { rootKey, relativePath: normalisedRelative, absolutePath: realTarget };
}

export interface WorkspaceFileRead {
  rootKey: string;
  relativePath: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
  modifiedAt: string;
  /** Where this came from, for provenance. Root-relative — never the absolute host path. */
  provenance: string;
}

/**
 * Read one allowed file, bounded.
 *
 * The returned provenance is deliberately `rootKey:relativePath` and not the
 * absolute path: the absolute path leaks the host's directory layout (and the
 * operator's username) into model context, evidence rows and any UI that
 * displays the result, for no benefit to the caller.
 */
export function readWorkspaceFile(
  rootKey: string,
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env,
  maxBytes: number = MAX_WORKSPACE_FILE_BYTES,
): WorkspaceFileRead {
  const resolved = resolveWorkspaceFile(rootKey, relativePath, env);
  const stat = fs.statSync(resolved.absolutePath);

  // --- Layer 6: bounded read ----------------------------------------------
  let content: string;
  let truncated = false;
  if (stat.size > maxBytes) {
    const fd = fs.openSync(resolved.absolutePath, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const read = fs.readSync(fd, buf, 0, maxBytes, 0);
      content = buf.subarray(0, read).toString('utf8');
      truncated = true;
    } finally {
      fs.closeSync(fd);
    }
  } else {
    content = fs.readFileSync(resolved.absolutePath, 'utf8');
  }

  return {
    rootKey: resolved.rootKey,
    relativePath: resolved.relativePath,
    sizeBytes: stat.size,
    content,
    truncated,
    modifiedAt: stat.mtime.toISOString(),
    provenance: `${resolved.rootKey}:${resolved.relativePath}`,
  };
}
