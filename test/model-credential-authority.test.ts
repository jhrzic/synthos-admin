import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-credauth-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'credauth.db');

import {
  SUPPORTED_MODEL_PROVIDERS,
  isModelProvider,
  saveModelCredential,
  deleteModelCredential,
  getModelCredentialStatus,
  resolveModelApiKey,
} from '../lib/model-credentials';
import { getDatabase } from '../lib/persistence';

// ---------------------------------------------------------------------------
// ONE CREDENTIAL AUTHORITY.
//
// The defect these tests lock out: an OpenAI key typed into Settings was
// written to `settings.customApiKeys.openai`, which App.tsx persisted to
// browser localStorage — and the server never received it. So the browser
// displayed a configured key while the server reported NOT_CONFIGURED and
// every real call failed. Two authorities, and the one the runtime actually
// consults was the empty one.
//
// Fish Audio had exactly this bug and it was fixed by making the server the
// only authority and migrating + scrubbing the browser copy. These tests hold
// the same line for model providers, in both directions: the library must
// behave, and the browser must be structurally unable to hold a key.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const readSource = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

beforeEach(() => {
  getDatabase().prepare('DELETE FROM model_credentials').run();
  delete process.env.OPENAI_API_KEY;
});

describe('the server-side store is the authority, for OpenAI as much as Gemini', () => {
  it('openai is a supported provider — the store was never the thing missing', () => {
    expect(SUPPORTED_MODEL_PROVIDERS).toContain('openai');
    expect(isModelProvider('openai')).toBe(true);
    expect(isModelProvider('not-a-provider')).toBe(false);
  });

  it('a saved OpenAI key round-trips through the encrypted store and is reported present', () => {
    expect(getModelCredentialStatus('openai').apiKeyPresent).toBe(false);

    saveModelCredential({ provider: 'openai', apiKey: 'sk-test-canonical-authority', userId: 'test-user' });

    const status = getModelCredentialStatus('openai');
    expect(status.apiKeyPresent).toBe(true);
    expect(status.source).toBe('server_store');
    expect(resolveModelApiKey('openai').apiKey).toBe('sk-test-canonical-authority');
  });

  it('the stored value is encrypted at rest — the raw key is not in the row', () => {
    saveModelCredential({ provider: 'openai', apiKey: 'sk-test-should-not-be-plaintext', userId: 'test-user' });
    const row = getDatabase()
      .prepare('SELECT api_key_encrypted FROM model_credentials WHERE provider = ?')
      .get('openai') as { api_key_encrypted: string };
    expect(row.api_key_encrypted).toBeTruthy();
    expect(row.api_key_encrypted).not.toContain('sk-test-should-not-be-plaintext');
  });

  it('status never carries the key value, only presence and provenance', () => {
    saveModelCredential({ provider: 'openai', apiKey: 'sk-test-secret-value', userId: 'test-user' });
    const serialized = JSON.stringify(getModelCredentialStatus('openai'));
    expect(serialized).not.toContain('sk-test-secret-value');
    expect(serialized).toContain('apiKeyPresent');
  });

  it('the environment still wins over the stored row, so a deployment variable is never silently overridden', () => {
    saveModelCredential({ provider: 'openai', apiKey: 'sk-stored-row', userId: 'test-user' });
    process.env.OPENAI_API_KEY = 'sk-from-environment';
    try {
      const resolved = resolveModelApiKey('openai');
      expect(resolved.apiKey).toBe('sk-from-environment');
      expect(resolved.source).toBe('environment');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('deleting is real: presence goes away and nothing resolves', () => {
    saveModelCredential({ provider: 'openai', apiKey: 'sk-test-delete-me', userId: 'test-user' });
    deleteModelCredential('openai');
    expect(getModelCredentialStatus('openai').apiKeyPresent).toBe(false);
    expect(resolveModelApiKey('openai').apiKey).toBe('');
    expect(resolveModelApiKey('openai').source).toBe('none');
  });

  it('providers are isolated — saving one does not make the other look configured', () => {
    saveModelCredential({ provider: 'openai', apiKey: 'sk-openai-only', userId: 'test-user' });
    expect(getModelCredentialStatus('openai').apiKeyPresent).toBe(true);
    expect(getModelCredentialStatus('gemini').apiKeyPresent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source guards. These are the durable part: the library above can be correct
// while the browser quietly keeps its own copy, which is the bug that existed.
// Scanning source is the same approach test/env-spec-completeness.test.ts uses
// to keep a structural claim true by construction rather than by vigilance.
// ---------------------------------------------------------------------------
describe('the browser cannot hold a model-provider credential', () => {
  it('App.tsx redacts customApiKeys by ALLOWLIST, so the next provider added cannot leak', () => {
    const app = readSource('src/App.tsx');
    const persistBlock = app.slice(app.indexOf('const redacted = {'), app.indexOf("localStorage.setItem('hermes_jarvis_settings'"));

    // The old code named one provider (`fish_audio: undefined`). A blocklist
    // leaks every provider nobody remembered — which is how openai slipped
    // through. The allowlist keeps only the explicit sentinel.
    expect(persistBlock).toContain('SERVER_MANAGED_KEY');
    expect(persistBlock).toMatch(/Object\.(entries|fromEntries)/);
    expect(
      /fish_audio:\s*undefined/.test(persistBlock),
      'customApiKeys is redacted by naming one provider — that is a blocklist, and it is what let openai through',
    ).toBe(false);
  });

  it('SettingsView never seeds an OpenAI key from browser state', () => {
    const settings = readSource('src/components/SettingsView.tsx');
    expect(
      /openai:\s*s\.customApiKeys\?\.openai/.test(settings),
      'SettingsView reads the OpenAI key out of browser settings — the server must be the only authority',
    ).toBe(false);
    expect(settings).toMatch(/openai:\s*'SERVER_MANAGED_KEY'/);
  });

  it('SettingsView renders provider state from the server, not from its own settings object', () => {
    const settings = readSource('src/components/SettingsView.tsx');
    // Presence is read from the real route...
    expect(settings).toContain('/api/business/model-credentials');
    // ...and an unreadable server state is reported as unknown rather than
    // being quietly rendered as "not configured".
    expect(settings).toContain('SERVER STATE UNKNOWN');
  });

  it('a legacy browser key is migrated to the server and then scrubbed, never left in both places', () => {
    const app = readSource('src/App.tsx');
    const migration = app.slice(app.indexOf("synthos_model_credential_migrated"));
    expect(migration).toContain('/api/business/model-credential');
    // The scrub is conditional on the server confirming the save, so a failed
    // request cannot destroy the only copy of the key.
    expect(migration).toMatch(/results\.every\(Boolean\)\s*\)\s*scrubModelKeys\(\)/);
  });

  it('no source file writes a provider key to localStorage under its own key name', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          // A localStorage write whose key names a model provider.
          const match = text.match(/localStorage\.setItem\(\s*['"][^'"]*(openai|gemini|anthropic|deepseek)[^'"]*['"]/i);
          if (match) offenders.push(`${path.relative(ROOT, full)}: ${match[0]}`);
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(offenders, 'a model-provider credential is being written to browser storage').toEqual([]);
  });
});
