import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// VAULT ISOLATION GUARD.
//
// The fix for real-vault contamination was to give six tests an isolated
// temporary vault. That fix is only as durable as the next person's memory, so
// this file is the actual fix: it fails the build the next time a test can
// resolve its knowledge vault to a real one.
//
// Two independent checks, because each catches what the other cannot:
//
//   1. A SOURCE CHECK over every test file: any test that can reach
//      vault-writing code must isolate first. This catches a new test before it
//      ever runs, and it is the only check that can see a test that would only
//      contaminate under an environment this run does not have.
//
//   2. A RESOLUTION CHECK using the real resolver: given no
//      SYNTHOS_VAULT_PATH, lib/vault-config.ts falls back to
//      <cwd>/vault — so the fallback itself is proven to be the repository, and
//      the danger is made explicit rather than assumed.
//
// WHY THE SOURCE CHECK IS NOT "SUPERFICIAL SOURCE ASSERTION"
// The thing being asserted is a property of the FILE'S MODULE ORDER — that
// isolation happens before the import graph is evaluated. That ordering cannot
// be observed at runtime from inside another test file, because by then the
// damage (or its absence) has already happened in a different worker process.
// A source check is the correct instrument for it, and it is paired with the
// live resolution check above rather than standing alone.
// ---------------------------------------------------------------------------

const TEST_DIR = path.join(process.cwd(), 'test');
const REPO_VAULT = path.join(process.cwd(), 'vault');
const REAL_OBSIDIAN_VAULT = path.join(os.homedir(), 'synthos', 'vault');

// ---------------------------------------------------------------------------
// TWO RISK CLASSES, and they are not the same severity. Treating them as one
// would either under-protect the dangerous case or force twenty unrelated test
// files to change for a problem they cannot cause.
//
//   KNOWLEDGE NOTES — lib/knowledge-vault.ts resolves its root through
//   lib/vault-config.ts, which reads SYNTHOS_VAULT_PATH. That root is
//   ENVIRONMENT-DRIVEN, so an unisolated test writes into whatever vault the
//   environment names — including the operator's real Obsidian vault. This is
//   the dangerous class, and isolation is MANDATORY for it.
//
//   ARTIFACTS — lib/vault.ts declares
//       export const VAULT_ROOT = path.join(process.cwd(), 'vault');
//   a compile-time constant reading no environment variable. Artifact writes
//   can therefore only ever land inside the repository working tree
//   (vault/workspaces/, which is gitignored) and can NEVER reach the real
//   Obsidian vault however the environment is set. Untidy, contained, and
//   structurally incapable of the harm this guard exists to prevent — so it is
//   asserted as a containment property below rather than demanded of every
//   test that writes an artifact.
// ---------------------------------------------------------------------------

/**
 * Modules that can transitively write KNOWLEDGE NOTES — the environment-driven,
 * dangerous class. A test importing any of these must isolate.
 *
 * Kept as import SPECIFIERS rather than resolved paths so the check is about
 * what a test file declares, which is what a reviewer reads.
 */
const KNOWLEDGE_REACHING_IMPORTS = [
  'lib/knowledge-vault',
  'lib/vault-config',
  'lib/conversation/service',
  'lib/conversation/engine',
  'lib/conversation/llm',
  'lib/conversation/answerability',
  // Tool Pack 1 gave the envelope a brain.write_session_note executor, so it
  // now reaches knowledge writes; the kernel reaches them through conversation.
  'lib/fabric/envelope',
  'lib/fabric/kernel',
];

/**
 * Whether a test has done something deliberate about its vault.
 *
 * Three accepted forms, because there are three legitimate styles already in
 * the suite and rejecting the working ones would be noise:
 *
 *   1. the shared helper;
 *   2. mutating process.env directly;
 *   3. passing an explicit `{ SYNTHOS_VAULT_PATH: tmp }` env object to each
 *      vault call — which is what test/knowledge-vault.test.ts and
 *      test/brain-surface.test.ts do, and is arguably the cleanest of the
 *      three since it never touches global state at all.
 *
 * HONEST LIMIT, recorded rather than glossed: for form 3 this check confirms
 * the test names the variable, not that EVERY call site inside it passes the
 * override. A file that threads an explicit env through most calls and forgets
 * one would still pass here. Closing that would need call-graph analysis; what
 * this guard reliably catches is the failure mode actually observed — a test
 * that does nothing about the vault at all, which is how all six contaminating
 * tests behaved.
 */
function isolatesVault(source: string): boolean {
  if (/isolateVaultForTest\s*\(/.test(source)) return true;
  if (/process\.env\.SYNTHOS_VAULT_PATH\s*=/.test(source)) return true;
  if (/SYNTHOS_VAULT_PATH\s*:/.test(source)) return true;
  return false;
}

function reachesKnowledgeVault(source: string): string | null {
  for (const spec of KNOWLEDGE_REACHING_IMPORTS) {
    // Matches both '../lib/x' and '../../lib/x' relative forms.
    const bare = spec.replace(/^lib\//, '');
    const re = new RegExp(`from\\s+['"]\\.{1,2}(?:/\\.\\.)*/(?:lib/)?${bare.replace(/[/-]/g, '[/-]')}['"]`);
    if (re.test(source)) return spec;
    if (source.includes(`'../${spec}'`) || source.includes(`"../${spec}"`)) return spec;
  }
  return null;
}

const testFiles = fs
  .readdirSync(TEST_DIR)
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => ({ name: f, source: fs.readFileSync(path.join(TEST_DIR, f), 'utf8') }));

describe('no test may write into a real knowledge vault', () => {
  it('finds test files to check (a silent empty sweep would pass vacuously)', () => {
    expect(testFiles.length).toBeGreaterThan(50);
  });

  it('every test that can reach vault-writing code isolates its vault first', () => {
    const offenders = testFiles
      .map(({ name, source }) => {
        const reached = reachesKnowledgeVault(source);
        if (!reached) return null;
        if (isolatesVault(source)) return null;
        return `${name} (imports ${reached})`;
      })
      .filter((x): x is string => x !== null);

    expect(
      offenders,
      'These tests can reach vault-writing code without isolating their vault, so they will ' +
        'write fixture notes into <cwd>/vault — and into the operator’s real Obsidian vault ' +
        'the moment SYNTHOS_VAULT_PATH is set in the environment. Call ' +
        "isolateVaultForTest('<label>') from test/helpers/isolated-vault.ts at module scope, " +
        'BEFORE the lib/ imports.',
    ).toEqual([]);
  });

  it('isolation appears BEFORE the first lib/ import, not after it', () => {
    // Order is the whole point: vault status is resolved when vault code first
    // runs, so isolating after the import graph has been evaluated is too late.
    const misordered: string[] = [];
    for (const { name, source } of testFiles) {
      if (!/isolateVaultForTest\s*\(/.test(source)) continue;
      const isolationAt = source.search(/isolateVaultForTest\s*\(\s*['"]/);
      const firstLibImport = source.search(/^import[^\n]*from\s+['"]\.{1,2}\/(?:\.\.\/)*lib\//m);
      if (firstLibImport >= 0 && isolationAt > firstLibImport) {
        misordered.push(name);
      }
    }
    expect(misordered, 'Isolation must precede the first lib/ import in these files.').toEqual([]);
  });

  it('the real Obsidian vault is never named as a target in any test', () => {
    const offenders = testFiles
      .filter(({ source }) => source.includes('/synthos/vault') || source.includes(REAL_OBSIDIAN_VAULT))
      // The guard itself names it in order to forbid it.
      .filter(({ name }) => name !== 'vault-isolation-guard.test.ts')
      // ui-truth-render names it inside a stubbed API RESPONSE fixture — the
      // string is what the component is asked to RENDER, never a path anything
      // writes to. Narrowly excluded, with the reason recorded, rather than
      // weakening the check for every file.
      .filter(({ name }) => name !== 'ui-truth-render.test.tsx')
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

describe('the fallback the guard protects against is real', () => {
  it('with no SYNTHOS_VAULT_PATH the resolver returns the repository vault', async () => {
    const { resolveVaultPath } = await import('../lib/vault-config');
    // Proven against the real resolver with an explicit empty env, rather than
    // asserted from reading the source.
    const resolved = resolveVaultPath({} as NodeJS.ProcessEnv);
    expect(resolved.source).toBe('LOCAL_FALLBACK');
    expect(resolved.root).toBe(REPO_VAULT);
  });

  it('with SYNTHOS_VAULT_PATH set the resolver follows it — which is why an unisolated test is dangerous', async () => {
    const { resolveVaultPath } = await import('../lib/vault-config');
    const resolved = resolveVaultPath({ SYNTHOS_VAULT_PATH: REAL_OBSIDIAN_VAULT } as NodeJS.ProcessEnv);
    expect(resolved.source).toBe('SYNTHOS_VAULT_PATH');
    expect(resolved.root).toBe(REAL_OBSIDIAN_VAULT);
  });

  it('the helper points the resolver at a temporary directory, not either real vault', async () => {
    const { isolateVaultForTest, forbiddenVaultRoots } = await import('./helpers/isolated-vault');
    const { resolveVaultPath } = await import('../lib/vault-config');

    const { root } = isolateVaultForTest('guard-selfcheck');
    const resolved = resolveVaultPath();

    expect(resolved.root).toBe(root);
    expect(root.startsWith(fs.realpathSync(os.tmpdir())) || root.startsWith(os.tmpdir())).toBe(true);
    for (const forbidden of forbiddenVaultRoots()) {
      expect(root).not.toBe(forbidden);
      expect(root.startsWith(forbidden + path.sep)).toBe(false);
    }
  });

  it('artifact storage: ./vault by default, isolated per test worker, and never allowed inside the knowledge vault', async () => {
    // It became environment-driven (SYNTHOS_ARTIFACT_VAULT_DIR), which is the
    // condition this test used to warn about — so artifact-writing tests are
    // now isolated centrally (test/setup/isolate-database.ts), and the
    // override refuses any path that overlaps SYNTHOS_VAULT_PATH.
    const vaultSource = fs.readFileSync(path.join(process.cwd(), 'lib/vault.ts'), 'utf8');
    expect(vaultSource).toContain("if (!override) return path.join(process.cwd(), 'vault');");
    expect(vaultSource).toContain('overlaps the knowledge vault SYNTHOS_VAULT_PATH');

    const { VAULT_ROOT } = await import('../lib/vault');
    expect(VAULT_ROOT).not.toBe(REPO_VAULT);
    expect(VAULT_ROOT.startsWith(REPO_VAULT + path.sep)).toBe(false);
    expect(VAULT_ROOT.startsWith(fs.realpathSync(os.tmpdir())) || VAULT_ROOT.startsWith(os.tmpdir())).toBe(true);
    expect(VAULT_ROOT.startsWith(REAL_OBSIDIAN_VAULT)).toBe(false);

    const setup = fs.readFileSync(path.join(process.cwd(), 'test/setup/isolate-database.ts'), 'utf8');
    expect(setup).toContain("process.env.SYNTHOS_ARTIFACT_VAULT_DIR = path.join(dir, 'vault');");
  });

  it('an artifact-vault override inside the knowledge vault is refused at load', async () => {
    const { vi } = await import('vitest');
    const prevA = process.env.SYNTHOS_ARTIFACT_VAULT_DIR; const prevK = process.env.SYNTHOS_VAULT_PATH;
    const knowledge = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-knowledge-'));
    process.env.SYNTHOS_VAULT_PATH = knowledge;
    process.env.SYNTHOS_ARTIFACT_VAULT_DIR = path.join(knowledge, 'artifacts');
    vi.resetModules();
    try {
      await expect(import('../lib/vault')).rejects.toThrow(/overlaps the knowledge vault/);
    } finally {
      process.env.SYNTHOS_ARTIFACT_VAULT_DIR = prevA;
      if (prevK === undefined) delete process.env.SYNTHOS_VAULT_PATH; else process.env.SYNTHOS_VAULT_PATH = prevK;
      vi.resetModules();
      fs.rmSync(knowledge, { recursive: true, force: true });
    }
  });

  it('two isolations never collide, so parallel test files cannot share a vault', async () => {
    const { isolateVaultForTest } = await import('./helpers/isolated-vault');
    const a = isolateVaultForTest('collide');
    const b = isolateVaultForTest('collide');
    expect(a.root).not.toBe(b.root);
  });
});
