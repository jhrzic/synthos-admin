import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-provider-state-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'provider.db');

import {
  resolveProviderState,
  recordProviderAttempt,
  classifyProviderErrorCategory,
  isProviderUsable,
  type ProviderState,
} from '../lib/provider-state';
import { getDatabase } from '../lib/persistence';

// ---------------------------------------------------------------------------
// A DASHBOARD MAY NOT CLAIM MORE THAN IT KNOWS.
//
// The bug: lib/fabric/registry.ts decided model.openai's status with
//
//     status: credential.apiKeyPresent ? 'AVAILABLE' : 'NOT_CONFIGURED'
//
// so the Admin read AVAILABLE while every real call returned
// `HTTP 429: You have no credits remaining`. A resolved key is a fact about
// configuration; AVAILABLE is a claim about capability.
//
// Four independent questions had been collapsed into one: does the code
// exist, does a credential resolve, is it switched on, and what did the last
// real call actually do. These tests keep them separate.
// ---------------------------------------------------------------------------

beforeEach(() => {
  getDatabase().prepare('DELETE FROM runtime_events').run();
});

describe('a credential alone never means usable', () => {
  it('configured but never called is CREDENTIAL_PRESENT, not LIVE_VERIFIED', () => {
    const s = resolveProviderState({ provider: 'test-provider', implemented: true, configured: true });
    expect(s.state).toBe('CREDENTIAL_PRESENT');
    expect(s.state).not.toBe('LIVE_VERIFIED');
    expect(s.lastVerifiedAt).toBeNull();
    expect(s.reason).toMatch(/unproven|not verified/i);
  });

  it('only LIVE_VERIFIED is presentable as usable', () => {
    const states: ProviderState[] = [
      'NO_CREDENTIAL', 'CREDENTIAL_PRESENT', 'QUOTA_BLOCKED', 'PROVIDER_ERROR',
      'NOT_CONFIGURED', 'DISABLED', 'BROKEN_UPSTREAM',
    ];
    for (const st of states) expect(isProviderUsable(st), `${st} must not read as usable`).toBe(false);
    expect(isProviderUsable('LIVE_VERIFIED')).toBe(true);
  });

  it('no credential is NO_CREDENTIAL, never NOT_IMPLEMENTED', () => {
    const s = resolveProviderState({ provider: 'test-provider', implemented: true, configured: false });
    expect(s.state).toBe('NO_CREDENTIAL');
    // Implementation exists; the label must not deny that.
    expect(s.implemented).toBe(true);
  });
});

describe('the OpenAI case that started this — a 429 is QUOTA_BLOCKED', () => {
  it('a real 429 no-credits response resolves to QUOTA_BLOCKED', () => {
    recordProviderAttempt({
      provider: 'openai',
      ok: false,
      errorMessage: 'OpenAI HTTP 429: You have no credits remaining. Add credits to continue using the API.',
      latencyMs: 1051,
    });
    const s = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(s.state).toBe('QUOTA_BLOCKED');
    expect(s.lastErrorCategory).toBe('QUOTA_OR_BILLING');
    expect(s.lastAttemptAt).not.toBeNull();
    expect(s.lastVerifiedAt).toBeNull();
    // The distinction an operator needs: this is not a misconfiguration.
    expect(s.reason).toMatch(/not a configuration fault/i);
  });

  it('quota exhaustion is NOT reported as a transient rate limit', () => {
    // Both are HTTP 429. One needs money, the other needs patience, and
    // calling a billing wall "rate limited" makes a dead provider look like
    // it is about to recover.
    expect(classifyProviderErrorCategory('HTTP 429: You have no credits remaining')).toBe('QUOTA_OR_BILLING');
    expect(classifyProviderErrorCategory('429 Too Many Requests, please slow down')).toBe('RATE_LIMIT');
  });

  it('a non-quota failure is PROVIDER_ERROR, which is a different operator action', () => {
    recordProviderAttempt({ provider: 'openai', ok: false, errorMessage: 'OpenAI HTTP 401: Incorrect API key provided.' });
    const s = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(s.state).toBe('PROVIDER_ERROR');
    expect(s.lastErrorCategory).toBe('AUTHENTICATION');
  });

  it('a success records LIVE_VERIFIED with the model the provider reported', () => {
    recordProviderAttempt({ provider: 'openai', ok: true, modelUsed: 'gpt-5.6-terra-2026-08-01', latencyMs: 812 });
    const s = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(s.state).toBe('LIVE_VERIFIED');
    expect(s.lastVerifiedAt).not.toBeNull();
    expect(s.lastModelUsed).toBe('gpt-5.6-terra-2026-08-01');
  });

  // The current answer is what matters, not the best answer ever seen.
  it('a later failure supersedes an earlier success', () => {
    recordProviderAttempt({ provider: 'openai', ok: true, modelUsed: 'gpt-5.6-terra' });
    recordProviderAttempt({ provider: 'openai', ok: false, errorMessage: 'HTTP 429: You have no credits remaining' });
    const s = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(s.state).toBe('QUOTA_BLOCKED');
    // The earlier success is still on record — it is history, not status.
    expect(s.lastVerifiedAt).not.toBeNull();
  });
});

describe('precedence — the operative fact wins', () => {
  it('BROKEN_UPSTREAM outranks everything, because a credential cannot fix it', () => {
    recordProviderAttempt({ provider: 'hermes', ok: true, modelUsed: 'whatever' });
    const s = resolveProviderState({ provider: 'hermes', implemented: true, configured: true, brokenUpstream: true });
    expect(s.state).toBe('BROKEN_UPSTREAM');
  });

  it('DISABLED outranks a present credential — "off" is the operative fact', () => {
    const s = resolveProviderState({ provider: 'antigravity', implemented: true, configured: true, enabled: false });
    expect(s.state).toBe('DISABLED');
    expect(s.configured).toBe(true);
  });

  it('a credential with other configuration missing is NOT_CONFIGURED, and says what is missing', () => {
    const s = resolveProviderState({
      provider: 'windmill', implemented: true, configured: true,
      missingConfiguration: 'WINDMILL_BASE_URL and WINDMILL_WORKSPACE',
    });
    expect(s.state).toBe('NOT_CONFIGURED');
    expect(s.reason).toContain('WINDMILL_BASE_URL');
  });

  it('a disabled provider is not reported as broken, and vice versa', () => {
    expect(resolveProviderState({ provider: 'x', implemented: true, configured: true, enabled: false }).state).toBe('DISABLED');
    expect(resolveProviderState({ provider: 'y', implemented: true, configured: false, brokenUpstream: true }).state).toBe('BROKEN_UPSTREAM');
  });
});

describe('evidence is recorded, bounded and scrubbed', () => {
  it('a provider attempt writes one PROVIDER_CALL row to the existing ledger', () => {
    recordProviderAttempt({ provider: 'openai', ok: true, modelUsed: 'm', latencyMs: 10 });
    const rows = getDatabase()
      .prepare("SELECT * FROM runtime_events WHERE event_type='PROVIDER_CALL'")
      .all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].target_type).toBe('provider');
    expect(rows[0].target_id).toBe('openai');
    expect(rows[0].status).toBe('SUCCESS');
  });

  it('a provider error carrying a key is scrubbed before it is stored', () => {
    recordProviderAttempt({
      provider: 'openai',
      ok: false,
      errorMessage: 'HTTP 401 for key sk-proj-abcdefghij1234567890ABCDEFGHIJ rejected',
    });
    const row = getDatabase().prepare("SELECT detail_json FROM runtime_events WHERE event_type='PROVIDER_CALL'").get() as any;
    expect(row.detail_json).not.toContain('sk-proj-abcdefghij1234567890ABCDEFGHIJ');
    expect(row.detail_json).toContain('REDACTED');
  });

  it('providers do not contaminate each other', () => {
    recordProviderAttempt({ provider: 'openai', ok: false, errorMessage: 'HTTP 429: no credits remaining' });
    recordProviderAttempt({ provider: 'gemini', ok: true, modelUsed: 'gemini-3.1-flash-lite' });

    expect(resolveProviderState({ provider: 'openai', implemented: true, configured: true }).state).toBe('QUOTA_BLOCKED');
    expect(resolveProviderState({ provider: 'gemini', implemented: true, configured: true }).state).toBe('LIVE_VERIFIED');
  });

  it('recording never throws, so evidence cannot break a provider call', () => {
    expect(() => recordProviderAttempt({ provider: 'x', ok: false, errorMessage: null })).not.toThrow();
    expect(() => recordProviderAttempt({ provider: 'x', ok: true })).not.toThrow();
  });
});

describe('the registry no longer claims AVAILABLE on a key alone', () => {
  const registry = fs.readFileSync(path.join(process.cwd(), 'lib/fabric/registry.ts'), 'utf8');

  it('model.openai derives its status from the provider state model', () => {
    const code = registry.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(code).toContain("resolveProviderState({");
    // The exact expression that was the bug.
    expect(
      /status:\s*credential\.apiKeyPresent\s*\?\s*'AVAILABLE'/.test(code),
      "registry still maps a present key straight to AVAILABLE — that is the bug this pass exists to fix",
    ).toBe(false);
  });

  it('AVAILABLE is reachable only from LIVE_VERIFIED', () => {
    const code = registry.slice(registry.indexOf('const providerState = resolveProviderState'), registry.indexOf("key: 'model.openai'"));
    expect(code).toContain("providerState.state === 'LIVE_VERIFIED' ? 'AVAILABLE'");
  });
});
