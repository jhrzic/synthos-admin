import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-control-plane-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'cp.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { getDatabase } from '../lib/persistence';
import { resolvePlatformSetting, setPlatformSetting } from '../lib/platform-settings';
import { isAntigravityEnabled, describeAntigravityEnablement, resolveAntigravityApiKey, isAntigravityConfigured } from '../lib/antigravity-client';
import { resolveAutonomyLevel, describeAutonomyLevel, DEFAULT_AUTONOMY_LEVEL } from '../lib/autonomy';
import { saveRuntimeCredential, deleteRuntimeCredential, getRuntimeCredentialStatus, saveModelCredential, deleteModelCredential, SUPPORTED_MODEL_PROVIDERS } from '../lib/model-credentials';
import { recordProviderAttempt, resolveProviderState } from '../lib/provider-state';
import { providerStateToRuntimeStatus } from '../lib/runtime-status';
import { getAntigravityControlStatus } from '../lib/antigravity-control';
import { resolveCapability } from '../lib/fabric/registry';

const ENV_KEYS = ['ANTIGRAVITY_ENABLED', 'SYNTHOS_AUTONOMY_LEVEL', 'ANTIGRAVITY_API_KEY', 'GEMINI_API_KEY'];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  getDatabase().exec('DELETE FROM model_credentials');
  try { getDatabase().exec('DELETE FROM platform_settings'); } catch { /* created lazily */ }
  getDatabase().exec("DELETE FROM runtime_events WHERE event_type = 'PROVIDER_CALL'");
});

describe('platform settings — environment wins, then the Admin store, then the safe default', () => {
  it('defaults: Antigravity OFF, autonomy INTERNAL_AUTOMATION', () => {
    expect(isAntigravityEnabled()).toBe(false);
    expect(describeAntigravityEnablement().source).toBe('default');
    expect(resolveAutonomyLevel()).toBe(DEFAULT_AUTONOMY_LEVEL);
    expect(DEFAULT_AUTONOMY_LEVEL).toBe('INTERNAL_AUTOMATION');
  });

  it('an Admin-set value takes effect on the very next read — no restart', () => {
    setPlatformSetting('antigravity.enabled', 'true', 'platform-admin');
    expect(isAntigravityEnabled()).toBe(true);
    setPlatformSetting('autonomy.level', 'APPROVAL_GATED_EXTERNAL', 'platform-admin');
    expect(resolveAutonomyLevel()).toBe('APPROVAL_GATED_EXTERNAL');
    expect(describeAutonomyLevel().source).toBe('platform_setting');
  });

  it('an environment value overrides the store and is reported as locked', () => {
    setPlatformSetting('antigravity.enabled', 'true', 'platform-admin');
    process.env.ANTIGRAVITY_ENABLED = 'false';
    expect(isAntigravityEnabled()).toBe(false);
    expect(describeAntigravityEnablement().locked).toBe(true);
    expect(resolvePlatformSetting('antigravity.enabled', 'false').source).toBe('environment');
  });

  it('an invalid stored autonomy level resolves to the safe default, never to something wider', () => {
    setPlatformSetting('autonomy.level', 'FULLY_AUTONOMOUS', 'platform-admin');
    expect(resolveAutonomyLevel()).toBe('INTERNAL_AUTOMATION');
  });

  it('settings persist in the database, so they survive a restart', () => {
    setPlatformSetting('antigravity.enabled', 'true', 'platform-admin');
    const row = getDatabase().prepare("SELECT setting_value FROM platform_settings WHERE setting_key = 'antigravity.enabled'").get() as any;
    expect(row.setting_value).toBe('true');
  });
});

describe('Antigravity credential — the existing encrypted store, dedicated key first, truthful Gemini fallback', () => {
  it('order: dedicated env, dedicated store, Gemini credential, none', () => {
    expect(resolveAntigravityApiKey().source).toBe('none');
    saveModelCredential({ provider: 'gemini', apiKey: 'AIza-gemini-fallback-key-value-000000', userId: 'p' });
    expect(resolveAntigravityApiKey().source).toBe('gemini_credential');
    saveRuntimeCredential({ slot: 'antigravity', apiKey: 'ag-dedicated-stored-key-value-000000', userId: 'p' });
    expect(resolveAntigravityApiKey().source).toBe('antigravity_store');
    process.env.ANTIGRAVITY_API_KEY = 'ag-dedicated-env-key-value-000000';
    expect(resolveAntigravityApiKey().source).toBe('antigravity_env');
    expect(getRuntimeCredentialStatus('antigravity').overriddenByEnvironment).toBe(true);
    deleteModelCredential('gemini');
  });

  it('the dedicated key is encrypted at rest and never part of any status shape', () => {
    saveRuntimeCredential({ slot: 'antigravity', apiKey: 'ag-secret-must-not-appear-000000', userId: 'p' });
    const raw = JSON.stringify(getDatabase().prepare('SELECT * FROM model_credentials').all());
    expect(raw).not.toContain('ag-secret-must-not-appear-000000');
    expect(JSON.stringify(getRuntimeCredentialStatus('antigravity'))).not.toContain('ag-secret');
    expect(JSON.stringify(getAntigravityControlStatus())).not.toContain('ag-secret');
    deleteRuntimeCredential('antigravity');
    expect(getRuntimeCredentialStatus('antigravity').state).toBe('NOT_CONFIGURED');
  });

  it('Antigravity is a runtime slot, NOT a model provider — routing is unchanged', () => {
    expect(SUPPORTED_MODEL_PROVIDERS).not.toContain('antigravity' as any);
  });
});

describe('control status — separate facts, and READY only when both gates are open', () => {
  it('starts NOT_READY with both gaps named; nothing is ever LIVE without a receipt', () => {
    const s = getAntigravityControlStatus();
    expect(s.implementation).toBe('IMPLEMENTED');
    expect(s.credential.state).toBe('NOT_CONFIGURED');
    expect(s.enabled.value).toBe(false);
    expect(s.readiness).toBe('NOT_READY');
    expect(s.missing).toEqual(['CREDENTIAL', 'ENABLED']);
    expect(s.lastLiveVerified).toBeNull();
    expect(s.approvalPolicy.requiresHumanApproval).toBe(true);
  });

  it('configured + enabled is READY_FOR_LIVE_VERIFICATION — not LIVE_VERIFIED', async () => {
    saveRuntimeCredential({ slot: 'antigravity', apiKey: 'ag-ready-key-value-000000000000', userId: 'p' });
    setPlatformSetting('antigravity.enabled', 'true', 'p');
    const s = getAntigravityControlStatus();
    expect(s.readiness).toBe('READY_FOR_LIVE_VERIFICATION');
    expect(s.lastLiveVerified).toBeNull();
    expect(isAntigravityConfigured()).toBe(true);
    // The registry sees the Admin settings too — the envelope would dispatch.
    expect((await resolveCapability('runtime.antigravity'))!.status).toBe('AVAILABLE');
    deleteRuntimeCredential('antigravity');
  });
});

describe('OpenAI status truth — a timeout is not a rejected credential', () => {
  it('three successes then one TIMEOUT reads DEGRADED, and says the credential was not rejected', () => {
    for (let i = 0; i < 3; i++) recordProviderAttempt({ provider: 'openai', ok: true, modelUsed: 'gpt-5.6-terra', latencyMs: 2000 });
    recordProviderAttempt({ provider: 'openai', ok: false, errorMessage: 'OpenAI request to "gpt-5.6-terra" timed out after 60000ms.', latencyMs: 60007 });
    const state = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(state.state).toBe('PROVIDER_ERROR');
    expect(state.lastErrorCategory).toBe('TIMEOUT');
    expect(providerStateToRuntimeStatus(state.state, state.lastErrorCategory)).toBe('DEGRADED');
    expect(state.reason).toContain('was not rejected');
  });

  it('an authentication failure is still FAILED', () => {
    recordProviderAttempt({ provider: 'openai', ok: false, errorMessage: 'OpenAI HTTP 401: Incorrect API key provided.' });
    const state = resolveProviderState({ provider: 'openai', implemented: true, configured: true });
    expect(state.lastErrorCategory).toBe('AUTHENTICATION');
    expect(providerStateToRuntimeStatus(state.state, state.lastErrorCategory)).toBe('FAILED');
  });

  it('quota stays DEGRADED and an unclassified error stays FAILED', () => {
    expect(providerStateToRuntimeStatus('QUOTA_BLOCKED')).toBe('DEGRADED');
    expect(providerStateToRuntimeStatus('PROVIDER_ERROR', 'UNKNOWN')).toBe('FAILED');
    expect(providerStateToRuntimeStatus('PROVIDER_ERROR')).toBe('FAILED');
  });
});
