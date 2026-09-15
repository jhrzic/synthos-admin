import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-hermes-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'hermes.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import {
  runHermesLocalTask,
  hermesLocalHealth,
  isHermesLocalConfigured,
  isHermesLocalEnabled,
  getHermesCliPath,
  stripAnsi,
  HERMES_MAX_PROMPT_CHARS,
} from '../lib/hermes-local-runtime';

// ---------------------------------------------------------------------------
// The Hermes integration is a SUBPROCESS, because the Hermes installed on this
// host is process-based for one-shot work and exposes no HTTP contract that
// src/services/hermesAdapter.ts could talk to.
//
// A subprocess integration has failure modes an HTTP one does not — argv
// injection, unbounded output, a child that never exits, orphaned
// grandchildren — so those are what these tests are about. None of them spend
// model quota: every test drives a fake CLI, except the ones that assert the
// kill switch refuses before anything is spawned at all.
// ---------------------------------------------------------------------------

/** A stand-in for `hermes` that lets a test control exactly what the child does. */
function writeFakeCli(name: string, body: string): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return p;
}

let ORIGINAL_CLI: string | undefined;
let ORIGINAL_ENABLED: string | undefined;

beforeAll(() => {
  ORIGINAL_CLI = process.env.HERMES_CLI_PATH;
  ORIGINAL_ENABLED = process.env.HERMES_LOCAL_ENABLED;
});

afterAll(() => {
  if (ORIGINAL_CLI === undefined) delete process.env.HERMES_CLI_PATH; else process.env.HERMES_CLI_PATH = ORIGINAL_CLI;
  if (ORIGINAL_ENABLED === undefined) delete process.env.HERMES_LOCAL_ENABLED; else process.env.HERMES_LOCAL_ENABLED = ORIGINAL_ENABLED;
});

describe('the kill switch is real: installed is not authorized', () => {
  beforeEach(() => {
    process.env.HERMES_CLI_PATH = writeFakeCli('echo-cli', 'echo "SHOULD NOT RUN"');
  });
  afterEach(() => {
    delete process.env.HERMES_LOCAL_ENABLED;
  });

  it('refuses to dispatch when HERMES_LOCAL_ENABLED is unset, even with a working CLI', async () => {
    delete process.env.HERMES_LOCAL_ENABLED;
    expect(isHermesLocalConfigured()).toBe(true);
    expect(isHermesLocalEnabled()).toBe(false);

    const result = await runHermesLocalTask({ prompt: 'anything' });
    expect(result.status).toBe('DISABLED');
    // Nothing ran, so there is no output to have captured.
    expect(result.output).toBe('');
    expect(result.error).toMatch(/quota/i);
  });

  it('refuses on any value other than exactly "true" — no truthiness', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'True', 'on', '']) {
      process.env.HERMES_LOCAL_ENABLED = value;
      const result = await runHermesLocalTask({ prompt: 'anything' });
      expect(result.status, `"${value}" was treated as enabled`).toBe('DISABLED');
    }
  });

  it('reports DISABLED distinctly from unreachable, because they need different fixes', async () => {
    delete process.env.HERMES_LOCAL_ENABLED;
    const reachableButOff = await hermesLocalHealth();
    expect(reachableButOff.status).toBe('DISABLED');
    // A version means the binary really answered.
    expect(reachableButOff.version).not.toBeNull();

    process.env.HERMES_CLI_PATH = path.join(TMP, 'does-not-exist');
    const unreachable = await hermesLocalHealth();
    expect(unreachable.status).toBe('NOT_CONFIGURED');
    expect(unreachable.version).toBeNull();
  });
});

describe('a prompt is an argument, never shell syntax', () => {
  beforeEach(() => {
    process.env.HERMES_LOCAL_ENABLED = 'true';
  });

  // The whole point of spawning with an argv array. If the prompt were
  // interpolated into a shell string, this prompt would run `id` and the
  // sentinel file would appear.
  it('shell metacharacters in a prompt are passed through as literal text', async () => {
    const sentinel = path.join(TMP, 'pwned.txt');
    // The fake CLI echoes its own last argument back verbatim.
    process.env.HERMES_CLI_PATH = writeFakeCli('argv-cli', 'printf "%s" "$2"');

    const hostile = `benign; touch ${sentinel}; echo $(id) \`whoami\` && rm -rf /tmp/nope`;
    const result = await runHermesLocalTask({ prompt: hostile });

    expect(result.status).toBe('SUCCESS');
    // Returned verbatim: it was data, not code.
    expect(result.output).toBe(hostile);
    expect(fs.existsSync(sentinel), 'the prompt executed as shell — argv safety is broken').toBe(false);
  });

  it('passes exactly two arguments: the -z flag and the prompt', async () => {
    process.env.HERMES_CLI_PATH = writeFakeCli('count-cli', 'echo "argc=$#|1=$1"');
    const result = await runHermesLocalTask({ prompt: 'hello world with spaces' });
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toBe('argc=2|1=-z');
  });
});

describe('a local subprocess cannot wedge or flood the runtime', () => {
  beforeEach(() => {
    process.env.HERMES_LOCAL_ENABLED = 'true';
  });

  it('a child that never exits is killed and reported as TIMEOUT, not as a hang', async () => {
    process.env.HERMES_CLI_PATH = writeFakeCli('hang-cli', 'sleep 120');
    const startedAt = Date.now();
    const result = await runHermesLocalTask({ prompt: 'hang please', timeoutMs: 5000 });
    const elapsed = Date.now() - startedAt;

    expect(result.status).toBe('TIMEOUT');
    expect(result.error).toMatch(/did not finish/i);
    // Returned on the timeout, not after the child's own 120s.
    expect(elapsed).toBeLessThan(30_000);
  }, 40_000);

  it('output past the ceiling is truncated and SAYS it was truncated', async () => {
    // 300KB of output against a 2KB ceiling.
    process.env.HERMES_CLI_PATH = writeFakeCli('flood-cli', `awk 'BEGIN{for(i=0;i<30000;i++)printf "0123456789"}'`);
    const result = await runHermesLocalTask({ prompt: 'flood', maxOutputBytes: 2048 });

    expect(result.status).toBe('SUCCESS');
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(2048);
  }, 30_000);

  it('a non-zero exit is a real failure carrying the real stderr', async () => {
    process.env.HERMES_CLI_PATH = writeFakeCli('fail-cli', 'echo "partial output"; echo "the actual reason" >&2; exit 3');
    const result = await runHermesLocalTask({ prompt: 'fail' });

    expect(result.status).toBe('FAILED');
    expect(result.exitCode).toBe(3);
    expect(result.error).toContain('the actual reason');
  });

  // Exit 0 with an empty stdout must not become an empty artifact that Aegis
  // then cheerfully verifies and signs a receipt for.
  it('exit 0 with no output is a failure, not an empty success', async () => {
    process.env.HERMES_CLI_PATH = writeFakeCli('silent-cli', 'exit 0');
    const result = await runHermesLocalTask({ prompt: 'say nothing' });

    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/no output/i);
  });

  it('a missing executable is NOT_CONFIGURED rather than a thrown spawn error', async () => {
    process.env.HERMES_CLI_PATH = path.join(TMP, 'absent-binary');
    const result = await runHermesLocalTask({ prompt: 'anything' });
    expect(result.status).toBe('NOT_CONFIGURED');
  });
});

describe('prompt and output hygiene', () => {
  beforeEach(() => {
    process.env.HERMES_LOCAL_ENABLED = 'true';
    process.env.HERMES_CLI_PATH = writeFakeCli('ok-cli', 'echo ok');
  });

  it('an empty prompt is refused before anything is spawned', async () => {
    const result = await runHermesLocalTask({ prompt: '   ' });
    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/prompt is required/i);
  });

  it('an oversized prompt is refused with its real size named', async () => {
    const result = await runHermesLocalTask({ prompt: 'x'.repeat(HERMES_MAX_PROMPT_CHARS + 1) });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain(String(HERMES_MAX_PROMPT_CHARS + 1));
  });

  // Terminal control bytes must not reach an artifact: they would otherwise
  // be hashed into its content hash and signed into a receipt.
  it('ANSI escape sequences are stripped from captured output', () => {
    const esc = String.fromCharCode(0x1b);
    const coloured = `${esc}[31mred${esc}[0m and ${esc}[1mbold${esc}[22m`;
    expect(stripAnsi(coloured)).toBe('red and bold');
  });

  it('the CLI path is overridable and falls back to a resolved home path', () => {
    process.env.HERMES_CLI_PATH = '/custom/hermes';
    expect(getHermesCliPath()).toBe('/custom/hermes');
    delete process.env.HERMES_CLI_PATH;
    expect(getHermesCliPath()).toMatch(/\.local\/bin\/hermes$/);
  });
});
