// ---------------------------------------------------------------------------
// PLATFORM SETTINGS — operator-controlled, platform-wide switches.
//
// WHY THIS EXISTS
//
// Two runtime switches could only be changed by editing
// ~/.synthos/synthos-admin.env and restarting the service:
//   - whether outward Antigravity execution is enabled at all
//   - the autonomy level the orchestrator runs at
// That is engineering intervention for an operator decision. Nothing in the
// codebase stored platform-wide settings (voice_settings is voice-only), so
// this is the one small store for them.
//
// NOT A SECOND AUTHORITY
//
// The precedence rule is the one lib/model-credentials.ts already uses for
// keys: a real ENVIRONMENT VARIABLE WINS, then this store, then the safe
// default. A deployment that pins a value in its environment is never
// silently overridden from a browser, and the Admin shows such a value as
// locked rather than pretending a toggle changed something.
//
// No restart: every reader resolves the value at call time.
//
// Writes are platform_admin-only at the HTTP boundary (requirePlatformAdmin)
// and audited there via lib/audit.ts. This module takes an already-authorized
// actor id.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';

export const PLATFORM_SETTING_KEYS = ['antigravity.enabled', 'autonomy.level', 'spend.policy', 'registry.manualDiscovery', 'registry.routeRefresh', 'router.policy', 'execution.queuedTaskProcessing'] as const;
export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

/** The environment variable that, when set, overrides each setting. */
export const PLATFORM_SETTING_ENV_VAR: Partial<Record<PlatformSettingKey, string>> = {
  'antigravity.enabled': 'ANTIGRAVITY_ENABLED',
  'autonomy.level': 'SYNTHOS_AUTONOMY_LEVEL',
};

export type PlatformSettingSource = 'environment' | 'platform_setting' | 'default';

export interface PlatformSettingRecord {
  key: PlatformSettingKey;
  value: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

function ensureTable(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      setting_key        TEXT PRIMARY KEY,
      setting_value      TEXT NOT NULL,
      updated_by_user_id TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
  `);
}

export function getStoredPlatformSetting(key: PlatformSettingKey): PlatformSettingRecord | null {
  try {
    ensureTable();
    const row = getDatabase()
      .prepare('SELECT setting_key, setting_value, updated_by_user_id, updated_at FROM platform_settings WHERE setting_key = ?')
      .get(key) as any;
    if (!row) return null;
    return { key, value: String(row.setting_value), updatedByUserId: row.updated_by_user_id ?? null, updatedAt: String(row.updated_at) };
  } catch {
    // An unreadable store resolves to the safe default, never to a guess.
    return null;
  }
}

export function setPlatformSetting(key: PlatformSettingKey, value: string, updatedByUserId: string): PlatformSettingRecord {
  ensureTable();
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO platform_settings (setting_key, setting_value, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at
  `).run(key, value, updatedByUserId, now, now);
  return getStoredPlatformSetting(key)!;
}

/** The environment value for a setting, or null when the environment does not set it. */
export function environmentValue(key: PlatformSettingKey, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = PLATFORM_SETTING_ENV_VAR[key];
  // Spend policy and pricing have NO environment override on purpose: a
  // budget must be visible and auditable in one place.
  if (!name) return null;
  const raw = env[name];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : null;
}

/**
 * Resolve a setting: environment, then store, then default. `locked` is true
 * when the environment decides, which is what an Admin control must show.
 */
export function resolvePlatformSetting(
  key: PlatformSettingKey,
  defaultValue: string,
  env: NodeJS.ProcessEnv = process.env,
): { value: string; source: PlatformSettingSource; locked: boolean; updatedAt: string | null; updatedByUserId: string | null } {
  const fromEnv = environmentValue(key, env);
  if (fromEnv !== null) return { value: fromEnv, source: 'environment', locked: true, updatedAt: null, updatedByUserId: null };
  const stored = getStoredPlatformSetting(key);
  if (stored) return { value: stored.value, source: 'platform_setting', locked: false, updatedAt: stored.updatedAt, updatedByUserId: stored.updatedByUserId };
  return { value: defaultValue, source: 'default', locked: false, updatedAt: null, updatedByUserId: null };
}
