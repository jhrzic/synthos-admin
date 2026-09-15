// ---------------------------------------------------------------------------
// Hermes local runtime — the REAL interface Hermes exposes on this machine.
//
// Why this module exists rather than a base URL in the env file:
//
// src/services/hermesAdapter.ts speaks a SynthOS-specific REST contract
// (`GET {baseUrl}/synthos/health`, ADR-001 Phase 1). Nothing on this machine
// implements that contract. The Hermes that is actually installed here is:
//
//   * `hermes gateway run`   — the messaging gateway (a LaunchAgent, running).
//                              Listens on NO TCP port. Not an HTTP service.
//   * `hermes serve`         — a JSON-RPC/WebSocket backend on 127.0.0.1:9119
//                              for the desktop app. Not running, and it does
//                              not expose /synthos/health either.
//   * `hermes -z "<prompt>"` — a one-shot, non-interactive task. THIS is the
//                              bounded task interface, and it is what this
//                              module uses.
//
// Pointing HERMES_ADAPTER_BASE_URL at :9119 would 404 on /synthos/health and
// turn an honest NOT_CONFIGURED into a fabricated FAILED. So the integration
// is a subprocess, because Hermes really is process-based for one-shot work —
// no HTTP endpoint is invented here.
//
// COST. `hermes -z` performs a real model call using Hermes's OWN configured
// provider, which on this machine is `openai-codex` (model gpt-5.6-sol-900k,
// base https://chatgpt.com/backend-api/codex) — a ChatGPT/Codex subscription
// authenticated in ~/.hermes/auth.json. A call therefore consumes subscription
// quota rather than metered per-token API credit. It is NOT free, and it is not
// billed to any SynthOS provider key.
//
// Because it spends someone's quota, execution is OFF unless
// HERMES_LOCAL_ENABLED is exactly "true" — the same real kill-switch posture
// as ANTIGRAVITY_ENABLED. A present CLI is not consent to run it.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type HermesLocalStatus = 'CONNECTED' | 'DISABLED' | 'NOT_CONFIGURED' | 'FAILED';

export interface HermesLocalHealth {
  status: HermesLocalStatus;
  cliPath: string | null;
  version: string | null;
  checkedAt: string;
  error?: string;
}

export interface HermesLocalTaskResult {
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'BLOCKED' | 'DISABLED' | 'NOT_CONFIGURED';
  output: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  truncated: boolean;
  error?: string;
}

/** Hard ceilings. A local subprocess that never returns must not be able to wedge the runtime. */
export const HERMES_DEFAULT_TIMEOUT_MS = 120_000;
export const HERMES_MAX_TIMEOUT_MS = 600_000;
export const HERMES_MAX_OUTPUT_BYTES = 256 * 1024;
export const HERMES_MAX_PROMPT_CHARS = 8_000;

export function getHermesCliPath(): string {
  const configured = (process.env.HERMES_CLI_PATH || '').trim();
  if (configured) return configured;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.local', 'bin', 'hermes');
}

/** The CLI exists and is executable. Says nothing about whether we may run it. */
export function isHermesLocalConfigured(): boolean {
  try {
    const cliPath = getHermesCliPath();
    if (!fs.existsSync(cliPath)) return false;
    fs.accessSync(cliPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Execution is refused unless this is exactly "true". Installed is not authorized. */
export function isHermesLocalEnabled(): boolean {
  return (process.env.HERMES_LOCAL_ENABLED || '').trim() === 'true';
}

// Built from char codes rather than written literally: the pattern matches
// control characters, and embedding them in source makes them invisible to
// anyone reviewing this file.
const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const ANSI_PATTERN = new RegExp(
  '[' + ESC + CSI + '][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nq-uy=><]',
  'g',
);

/**
 * Strip ANSI escape sequences. The CLI writes for a terminal; a receipt
 * payload and a Vault note should not carry cursor-movement bytes, and an
 * artifact's content hash must not depend on colour output.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

interface SpawnBoundedResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * Run the CLI with an argv array — never a shell string, so a prompt can
 * never become shell syntax however it is written.
 *
 * The child is started in its own process group and killed by group on
 * timeout: `hermes` spawns its own children (a Python agent, tool
 * subprocesses), and killing only the parent would leave them running and
 * still spending quota after SynthOS had given up on them.
 */
function spawnBounded(cliPath: string, args: string[], timeoutMs: number, maxBytes: number): Promise<SpawnBoundedResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(cliPath, args, {
      cwd: process.env.HOME || undefined,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Keep the CLI out of interactive/TUI paths: a prompt waiting on a
        // TTY would otherwise read as a hang and burn the whole timeout.
        TERM: 'dumb',
        NO_COLOR: '1',
        CI: '1',
      },
    });

    const append = (chunk: string, target: 'out' | 'err') => {
      const current = target === 'out' ? stdout : stderr;
      if (current.length >= maxBytes) {
        truncated = true;
        return;
      }
      const room = maxBytes - current.length;
      const slice = chunk.length > room ? chunk.slice(0, room) : chunk;
      if (slice.length < chunk.length) truncated = true;
      if (target === 'out') stdout += slice; else stderr += slice;
    };

    child.stdout?.on('data', (d) => append(String(d), 'out'));
    child.stderr?.on('data', (d) => append(String(d), 'err'));

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      // Escalate if it does not go down politely.
      const escalation = setTimeout(() => killGroup('SIGKILL'), 5000);
      escalation.unref?.();
    }, timeoutMs);
    timer.unref?.();

    const settle = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stripAnsi(stdout).trim(),
        stderr: stripAnsi(stderr).trim(),
        exitCode,
        signal,
        timedOut,
        truncated,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on('error', (err) => {
      append(`\n[spawn error] ${err.message}`, 'err');
      settle(null, null);
    });
    child.on('close', (code, signal) => settle(code, signal ? String(signal) : null));
  });
}

/**
 * Reachability, proven by running the CLI rather than by finding the file.
 * `--version` makes no model call, so this costs nothing and is safe to call
 * on a status read.
 */
// ---------------------------------------------------------------------------
// The probe is CACHED, and that is not an optimisation — it is a correctness
// fix for a regression this module introduced.
//
// getRuntimeStatus() calls this, and lib/fabric/registry.ts's
// listCapabilities() calls getRuntimeStatus(). So the chain
//
//   executeEnvelope -> resolveCapability -> listCapabilities
//                   -> getRuntimeStatus -> hermesLocalHealth
//
// put a SUBPROCESS SPAWN with a 20s ceiling on the hot path of every
// capability dispatch: every Jarvis command, every scheduled occurrence,
// every graph node. Three concurrent scheduler ticks meant three concurrent
// `hermes --version` spawns, and test/scheduler.test.ts's exactly-once test
// timed out at 20s as a direct result — it never failed an assertion about
// duplicate execution, it simply never finished.
//
// `hermes --version` cannot change between two calls a second apart, so
// caching it costs no truthfulness. The TTL is short enough that installing
// or removing the CLI is reflected promptly, and the probe timeout drops from
// 20s to 5s because a version string that takes five seconds is already a
// failed probe.
// ---------------------------------------------------------------------------
const HEALTH_CACHE_TTL_MS = 60_000;
const VERSION_PROBE_TIMEOUT_MS = 5_000;
// Keyed on the resolved CLI PATH. The first version of this cache was keyed
// on nothing, so changing HERMES_CLI_PATH kept returning the previous
// binary's answer — which is not merely a test problem: an operator who
// repointed the path would have been shown a stale verdict about a binary
// that is no longer the one being used.
let cachedHealth: { at: number; cliPath: string; value: HermesLocalHealth } | null = null;

/** Test-only: drops the cached probe so a test can control the observed state. */
export function resetHermesHealthCacheForTests(): void {
  cachedHealth = null;
}

export async function hermesLocalHealth(): Promise<HermesLocalHealth> {
  // The enablement flag is read fresh on every call — it is a cheap env read,
  // and a cached DISABLED/CONNECTED would make toggling the flag look inert.
  const cliPathNow = getHermesCliPath();
  if (cachedHealth && cachedHealth.cliPath === cliPathNow && Date.now() - cachedHealth.at < HEALTH_CACHE_TTL_MS) {
    const cached = cachedHealth.value;
    if (cached.status === 'CONNECTED' || cached.status === 'DISABLED') {
      return isHermesLocalEnabled()
        ? { ...cached, status: 'CONNECTED', error: undefined }
        : { ...cached, status: 'DISABLED', error: 'HERMES_LOCAL_ENABLED is not "true" — the CLI answers, but SynthOS will not dispatch to it.' };
    }
    return cached;
  }

  const health = await probeHermesLocalHealth();
  cachedHealth = { at: Date.now(), cliPath: cliPathNow, value: health };
  return health;
}

async function probeHermesLocalHealth(): Promise<HermesLocalHealth> {
  const checkedAt = new Date().toISOString();
  if (!isHermesLocalConfigured()) {
    return {
      status: 'NOT_CONFIGURED',
      cliPath: null,
      version: null,
      checkedAt,
      error: `No executable Hermes CLI at ${getHermesCliPath()}. Set HERMES_CLI_PATH if it lives elsewhere.`,
    };
  }

  const cliPath = getHermesCliPath();
  const probe = await spawnBounded(cliPath, ['--version'], VERSION_PROBE_TIMEOUT_MS, 8 * 1024);

  if (probe.timedOut) {
    return { status: 'FAILED', cliPath, version: null, checkedAt, error: `\`hermes --version\` did not return within ${VERSION_PROBE_TIMEOUT_MS}ms.` };
  }
  if (probe.exitCode !== 0) {
    return {
      status: 'FAILED',
      cliPath,
      version: null,
      checkedAt,
      error: `\`hermes --version\` exited ${probe.exitCode}: ${(probe.stderr || probe.stdout).slice(0, 200)}`,
    };
  }

  const version = (probe.stdout || probe.stderr).split('\n')[0]?.trim() || null;

  // Reachable, but execution is still switched off — a distinct state from
  // "cannot be reached", and the operator needs to be told which one it is.
  if (!isHermesLocalEnabled()) {
    return {
      status: 'DISABLED',
      cliPath,
      version,
      checkedAt,
      error: 'HERMES_LOCAL_ENABLED is not "true" — the CLI answers, but SynthOS will not dispatch to it.',
    };
  }

  return { status: 'CONNECTED', cliPath, version, checkedAt };
}

/**
 * Run one bounded Hermes task.
 *
 * Deliberately NOT responsible for Guardian gating, receipts, the ledger or
 * Brain writeback: this is the transport only. The caller is
 * lib/fabric/envelope.ts's hermes.execute executor, which already owns all
 * four — putting them here would build a second execution pipeline beside
 * the canonical one.
 */
export async function runHermesLocalTask(params: {
  prompt: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<HermesLocalTaskResult> {
  const startedAt = Date.now();
  const base = { output: '', exitCode: null, signal: null, truncated: false };

  if (!isHermesLocalConfigured()) {
    return { ...base, status: 'NOT_CONFIGURED', durationMs: Date.now() - startedAt, error: `No executable Hermes CLI at ${getHermesCliPath()}.` };
  }
  if (!isHermesLocalEnabled()) {
    return { ...base, status: 'DISABLED', durationMs: Date.now() - startedAt, error: 'HERMES_LOCAL_ENABLED is not "true" — refusing to spend subscription quota.' };
  }

  const prompt = String(params.prompt || '').trim();
  if (!prompt) {
    return { ...base, status: 'FAILED', durationMs: Date.now() - startedAt, error: 'A prompt is required.' };
  }
  if (prompt.length > HERMES_MAX_PROMPT_CHARS) {
    return {
      ...base,
      status: 'FAILED',
      durationMs: Date.now() - startedAt,
      error: `Prompt is ${prompt.length} characters; the ceiling is ${HERMES_MAX_PROMPT_CHARS}.`,
    };
  }

  const timeoutMs = Math.min(
    Math.max(Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : HERMES_DEFAULT_TIMEOUT_MS, 5_000),
    HERMES_MAX_TIMEOUT_MS,
  );
  const maxBytes = Math.min(
    Math.max(Number(params.maxOutputBytes) > 0 ? Number(params.maxOutputBytes) : HERMES_MAX_OUTPUT_BYTES, 1024),
    HERMES_MAX_OUTPUT_BYTES,
  );

  const run = await spawnBounded(getHermesCliPath(), ['-z', prompt], timeoutMs, maxBytes);

  if (run.timedOut) {
    return {
      status: 'TIMEOUT',
      output: run.stdout,
      exitCode: run.exitCode,
      signal: run.signal,
      durationMs: run.durationMs,
      truncated: run.truncated,
      error: `Hermes did not finish within ${timeoutMs}ms; the process group was killed.`,
    };
  }

  if (run.exitCode !== 0) {
    return {
      status: 'FAILED',
      output: run.stdout,
      exitCode: run.exitCode,
      signal: run.signal,
      durationMs: run.durationMs,
      truncated: run.truncated,
      error: `Hermes exited ${run.exitCode}${run.signal ? ` (signal ${run.signal})` : ''}: ${run.stderr.slice(0, 400) || 'no stderr'}`,
    };
  }

  if (!run.stdout) {
    // Exit 0 with nothing on stdout is not a satisfied task. Reported as a
    // failure rather than committed as an empty, Aegis-verified artifact.
    return {
      status: 'FAILED',
      output: '',
      exitCode: run.exitCode,
      signal: run.signal,
      durationMs: run.durationMs,
      truncated: run.truncated,
      error: `Hermes exited 0 but produced no output${run.stderr ? `; stderr: ${run.stderr.slice(0, 300)}` : ''}.`,
    };
  }

  return {
    status: 'SUCCESS',
    output: run.stdout,
    exitCode: run.exitCode,
    signal: run.signal,
    durationMs: run.durationMs,
    truncated: run.truncated,
  };
}
