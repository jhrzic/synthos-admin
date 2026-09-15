// ---------------------------------------------------------------------------
// SYNTHOS — canonical knowledge-vault configuration and truth states.
//
// THE GAP THIS CLOSES
//
// Before this module, `lib/vault.ts` hardcoded `VAULT_ROOT =
// path.join(process.cwd(), 'vault')` and that was the only vault concept in the
// codebase. There was no environment variable, no configurable path, no
// watcher, and no reader for the user's real ~1,204-note Markdown vault. The
// 2026-09-12 evidence cleanup recorded this as: "Obsidian is NOT integrated."
//
// TWO ROOTS, DELIBERATELY — this is the safety decision, stated once
//
// It would be a mistake to simply repoint VAULT_ROOT at the user's real vault,
// and this module deliberately does not:
//
//   * VAULT_ROOT (lib/vault.ts, UNCHANGED) is SynthOS's INTERNAL ARTIFACT
//     STORE. Its filenames are server-generated ids, its layout is
//     `workspaces/<id>/<folder>/`, and every file is joined to an `artifacts`
//     row. Repointing it would pour machine-named files into a human's
//     personal notes, and would orphan every existing artifact row whose
//     relative_path no longer resolves.
//
//   * KNOWLEDGE VAULT (this module) is the USER'S OWN vault. SynthOS treats it
//     as user-owned data: it reads structure, and it writes ONLY beneath a
//     single bounded `SynthOS/` subdirectory. It never renames, moves,
//     normalises, rewrites or deletes anything that was already there.
//
// The two happen to be the same directory in local development (the fallback
// below), and that is fine — they occupy different subtrees of it.
//
// OBSIDIAN IS NOT THE BOUNDARY; THE FILESYSTEM IS
//
// Whether the Obsidian desktop application is running is irrelevant to whether
// SynthOS can read and write knowledge. A vault is a directory of Markdown
// files. This module reports on the directory, and never claims "connected"
// because a GUI process exists.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

/** How the active knowledge-vault path was chosen. */
export type VaultSource = 'SYNTHOS_VAULT_PATH' | 'LOCAL_FALLBACK';

/**
 * What the vault actually is right now, as opposed to what was configured.
 *
 *  EXTERNAL       — a real configured vault outside the repo, usable.
 *  LOCAL_FALLBACK — no vault configured; the repo-local ./vault is in use.
 *                   Correct for development, and never to be reported as an
 *                   Obsidian integration.
 *  UNAVAILABLE    — a vault was configured but cannot be used (missing,
 *                   unreadable, not a directory). Never silently downgraded to
 *                   the fallback: a configured-but-broken vault is a fault the
 *                   operator must see, not a condition to paper over.
 */
export type VaultMode = 'EXTERNAL' | 'LOCAL_FALLBACK' | 'UNAVAILABLE';

export interface VaultStatus {
  mode: VaultMode;
  /** The resolved absolute path, or null when a configured path was unusable. */
  root: string | null;
  /** The raw configured value, for display. Null when nothing was configured. */
  configuredPath: string | null;
  source: VaultSource;
  /** Real filesystem evidence, each from an actual syscall — never inferred. */
  configured: boolean;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  /** The bounded subtree SynthOS may write into, once it exists. */
  synthosDir: string | null;
  synthosDirExists: boolean;
  /** Real count of Markdown files found, or null when not scanned/unavailable. */
  markdownFileCount: number | null;
  /**
   * Filesystem watching is not implemented. Stated explicitly rather than
   * omitted, so nothing reads the absence as "active".
   */
  watcher: 'NOT_IMPLEMENTED';
  /**
   * Whether an Obsidian desktop process was detected. OPTIONAL INFORMATION
   * ONLY — it never affects any other field, and never means "connected".
   */
  desktopAppDetected: boolean | null;
  /** Human-readable reason when mode is UNAVAILABLE. */
  detail: string;
}

/** The directory SynthOS is allowed to write into, inside any vault. */
export const SYNTHOS_VAULT_SUBDIR = 'SynthOS';

/** The repo-local development fallback — today's behaviour, unchanged. */
export function localFallbackRoot(): string {
  return path.join(process.cwd(), 'vault');
}

/**
 * Resolve the configured knowledge-vault path.
 *
 * Precedence is exactly one level deep, on purpose. A second competing source
 * (a config file, a database row, a CLI flag) is what produced the CLI-vs-
 * dashboard voice mismatch this same work had to untangle; one variable with a
 * documented fallback cannot drift against itself.
 *
 *   1. SYNTHOS_VAULT_PATH   — the user's real vault
 *   2. ./vault              — local development fallback
 */
export function resolveVaultPath(env: NodeJS.ProcessEnv = process.env): {
  root: string;
  source: VaultSource;
  configuredPath: string | null;
} {
  const configured = (env.SYNTHOS_VAULT_PATH || '').trim();
  if (configured) {
    // `~` is not expanded by the shell when a value comes from a .env file, and
    // silently creating a literal "~" directory would be a confusing failure.
    const expanded = configured.startsWith('~/')
      ? path.join(env.HOME || env.USERPROFILE || '', configured.slice(2))
      : configured;
    return { root: path.resolve(expanded), source: 'SYNTHOS_VAULT_PATH', configuredPath: configured };
  }
  return { root: localFallbackRoot(), source: 'LOCAL_FALLBACK', configuredPath: null };
}

/** A real write probe: create a temp file, then remove it. Nothing else proves writability. */
function probeWritable(dir: string): boolean {
  const probe = path.join(dir, `.synthos-write-probe-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'probe');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Count Markdown files, bounded. A real vault can hold thousands of notes and
 * this runs on a status request, so it stops early rather than walking an
 * unbounded tree — and stops descending into the directories Obsidian and git
 * keep their own machinery in.
 */
const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.stfolder']);

export function countMarkdownFiles(root: string, limit = 5000): number {
  let count = 0;
  const stack: string[] = [root];
  while (stack.length > 0 && count < limit) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // An unreadable subdirectory is skipped, never fatal to the count.
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        count++;
        if (count >= limit) break;
      }
    }
  }
  return count;
}

/**
 * The real status of the knowledge vault, from actual syscalls.
 *
 * Every boolean here is evidence. Nothing is inferred from a variable merely
 * being set: `configured` says a path was supplied, and `exists`/`readable`/
 * `writable` say what was actually found at it.
 */
export function getVaultStatus(
  env: NodeJS.ProcessEnv = process.env,
  opts: { countFiles?: boolean; desktopAppDetected?: boolean | null } = {},
): VaultStatus {
  const { root, source, configuredPath } = resolveVaultPath(env);
  const configured = source === 'SYNTHOS_VAULT_PATH';

  const base: VaultStatus = {
    mode: 'UNAVAILABLE',
    root: null,
    configuredPath,
    source,
    configured,
    exists: false,
    isDirectory: false,
    readable: false,
    writable: false,
    synthosDir: null,
    synthosDirExists: false,
    markdownFileCount: null,
    watcher: 'NOT_IMPLEMENTED',
    desktopAppDetected: opts.desktopAppDetected ?? null,
    detail: '',
  };

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(root);
  } catch {
    stat = null;
  }

  if (!stat) {
    // A configured path that does not exist is a fault. The local fallback not
    // existing yet is not — it is created on first write, as it always was.
    if (configured) {
      return { ...base, detail: `SYNTHOS_VAULT_PATH is set to "${configuredPath}" but nothing exists at ${root}. Knowledge will not be written until this path exists.` };
    }
    return {
      ...base,
      mode: 'LOCAL_FALLBACK',
      root,
      exists: false,
      detail: `No SYNTHOS_VAULT_PATH configured. Using the repo-local development fallback at ${root}, which does not exist yet and will be created on first write. This is NOT an Obsidian vault integration.`,
    };
  }

  if (!stat.isDirectory()) {
    return { ...base, root, exists: true, isDirectory: false, detail: `${root} exists but is not a directory.` };
  }

  let readable = false;
  try {
    fs.readdirSync(root);
    readable = true;
  } catch {
    readable = false;
  }

  if (!readable) {
    return { ...base, root, exists: true, isDirectory: true, detail: `${root} exists but is not readable by this process.` };
  }

  const writable = probeWritable(root);
  const synthosDir = path.join(root, SYNTHOS_VAULT_SUBDIR);
  const synthosDirExists = fs.existsSync(synthosDir);

  return {
    ...base,
    mode: configured ? 'EXTERNAL' : 'LOCAL_FALLBACK',
    root,
    exists: true,
    isDirectory: true,
    readable: true,
    writable,
    synthosDir,
    synthosDirExists,
    markdownFileCount: opts.countFiles ? countMarkdownFiles(root) : null,
    detail: configured
      ? `External vault at ${root}.${writable ? '' : ' NOT WRITABLE — knowledge cannot be saved here.'} SynthOS writes only under ${SYNTHOS_VAULT_SUBDIR}/.`
      : `No SYNTHOS_VAULT_PATH configured. Using the repo-local development fallback at ${root}. This is NOT an Obsidian vault integration.`,
  };
}

/**
 * Create the local development fallback directory if that is what is in use.
 *
 * Deliberately asymmetric: the fallback is created on demand (it is inside the
 * repo and its absence is meaningless), but a CONFIGURED external path is never
 * created. A typo in SYNTHOS_VAULT_PATH must surface as UNAVAILABLE, not
 * silently manufacture an empty directory somewhere in the user's filesystem
 * and then report success into it.
 */
export function ensureVaultRoot(env: NodeJS.ProcessEnv = process.env): VaultStatus {
  const { root, source } = resolveVaultPath(env);
  if (source === 'LOCAL_FALLBACK' && !fs.existsSync(root)) {
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch {
      // Fall through — getVaultStatus below reports the real resulting state.
    }
  }
  return getVaultStatus(env);
}

/** True only when knowledge can actually be written right now. */
export function canWriteKnowledge(status: VaultStatus): boolean {
  return (status.mode === 'EXTERNAL' || status.mode === 'LOCAL_FALLBACK') && status.writable;
}
