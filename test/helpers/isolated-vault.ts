import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// TEST VAULT ISOLATION.
//
// THE PROBLEM THIS EXISTS TO END
// lib/vault-config.ts resolves the knowledge vault as:
//
//     SYNTHOS_VAULT_PATH   ||   <process.cwd()>/vault
//
// A test that exercises anything writing knowledge notes and does NOT set
// SYNTHOS_VAULT_PATH therefore writes into the SECOND branch — the repository's
// own vault/ directory. Six tests did exactly that, which is why
// vault/SynthOS/Conversations accumulated 162 "Northgate Roofing" fixture notes
// that no human ever asked for.
//
// It has been landing in the repo-local fallback rather than the operator's real
// Obsidian vault, which is why nobody noticed. That is luck, not safety: the
// moment SYNTHOS_VAULT_PATH is exported in a shell, added to a .env that vitest
// loads, or inherited from the launchd service environment, those same tests
// write fixture notes straight into the operator's real Brain. The fallback is a
// convenience for development, not a sandbox, and relying on it to protect real
// data is relying on a variable staying unset forever.
//
// WHY A SHARED HELPER RATHER THAN SIX COPIES
// Six copies of "mkdtemp, set the env var, remember to clean up" is six chances
// to set the wrong variable — which already happened: one test set VAULT_ROOT,
// a name lib/vault-config.ts does not read at all, so it looked isolated in
// review while writing to the repository the whole time. One helper, one
// variable name, one cleanup path.
//
// MUST BE CALLED AT MODULE SCOPE, BEFORE THE lib/ IMPORTS
// Vault status is resolved when vault code first runs, so this has to be in
// place before the import graph is evaluated. Every call site therefore looks
// like:
//
//     import { isolateVaultForTest } from './helpers/isolated-vault';
//     isolateVaultForTest('my-suite');          // <-- before the lib imports
//     import { thingUnderTest } from '../lib/…';
//
// ESLint would normally object to a statement between imports; that ordering is
// load-bearing here, and a comment at each call site says so.
// ---------------------------------------------------------------------------

export interface IsolatedVault {
  /** Absolute path to this test file's private vault. */
  root: string;
  /** The SynthOS/ subtree inside it, pre-created. */
  synthosSubdir: string;
}

/** Every vault this process created, so the guard test can assert on them. */
const created: string[] = [];

export function isolatedVaultsCreated(): string[] {
  return created.slice();
}

/**
 * Point the knowledge vault at a private temporary directory for this test file.
 *
 * Uniqueness is belt AND braces: mkdtempSync already guarantees a fresh
 * directory, and the label plus pid plus random suffix make the name
 * self-describing when a run leaves one behind. Vitest runs test FILES in
 * parallel across worker processes, so two files using the same label must not
 * collide — with mkdtemp they cannot.
 */
export function isolateVaultForTest(label: string): IsolatedVault {
  const safeLabel = label.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || 'vault';
  const base = fs.mkdtempSync(
    path.join(os.tmpdir(), `synthos-testvault-${safeLabel}-${process.pid}-${crypto.randomBytes(3).toString('hex')}-`),
  );
  const synthosSubdir = path.join(base, 'SynthOS');
  fs.mkdirSync(synthosSubdir, { recursive: true });

  // The ONE variable lib/vault-config.ts actually reads.
  process.env.SYNTHOS_VAULT_PATH = base;

  // DELIBERATELY NOT setting VAULT_ROOT.
  //
  // An earlier draft of this helper set it, on the assumption it redirected
  // artifact storage. It does not: lib/vault.ts declares
  //
  //     export const VAULT_ROOT = path.join(process.cwd(), 'vault');
  //
  // a compile-time constant that reads no environment variable at all. Setting
  // VAULT_ROOT here would have been a line that looks like protection and
  // provides none — exactly the mistake test/business-assistant-embed.ts made,
  // which is what let it look isolated in review while writing to the
  // repository the whole time.
  //
  // That constant is also why artifact writes are a MILDER problem than
  // knowledge-note writes: being derived from cwd, they can only ever land
  // inside the repository working tree (vault/workspaces/, gitignored), and
  // can never reach the operator's real Obsidian vault however the environment
  // is configured. Knowledge notes are the dangerous case, because their root
  // IS environment-driven.

  created.push(base);

  afterAll(() => {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* a leftover temp dir is harmless */ }
  });

  return { root: base, synthosSubdir };
}

/** The paths a test must never be able to resolve its vault to. */
export function forbiddenVaultRoots(): string[] {
  return [
    // The operator's real Obsidian vault.
    path.join(os.homedir(), 'synthos', 'vault'),
    // The repository's own fallback vault.
    path.join(process.cwd(), 'vault'),
  ];
}
