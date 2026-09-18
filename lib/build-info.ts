// ---------------------------------------------------------------------------
// RUNNING VERSION — reported by /api/ready.
//
// The values are stamped outside this process when the code is fixed (see
// scripts/write-build-info.mjs and scripts/synthos-admin-service.sh) and
// passed in through five SYNTHOS_BUILD_* variables. This module reads ONLY
// those five variables, validates each one, and reports UNKNOWN for anything
// missing or malformed. It never runs git, never reads the working tree, never
// infers a commit from process-start time, and never echoes any other
// environment value.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { REGISTRY_SCHEMA_VERSION } from './registry/types';

export type BuildTree = 'CLEAN' | 'MODIFIED' | 'UNKNOWN';
export type BuildSource = 'LAUNCHER_GIT' | 'BUILD_MANIFEST' | 'DEPLOY_ARCHIVE' | 'UNKNOWN';

export interface BuildInfo {
  /** Full 40-hex commit SHA, or UNKNOWN. */
  commit: string;
  /** ISO time the metadata was stamped (bundle build, or source launch), or UNKNOWN. */
  buildTime: string;
  /** Branch or release identifier, or UNKNOWN. */
  ref: string;
  /** Whether the stamped checkout matched its commit exactly. */
  tree: BuildTree;
  /** Who stamped it. DEPLOY_ARCHIVE: built from `git archive <commit>` by scripts/deploy-admin-vm.sh. */
  source: BuildSource;
  /** Which environment this process runs as (SYNTHOS_ENVIRONMENT, else NODE_ENV), or UNKNOWN. */
  environment: string;
  /** Which deployment/site this is (SYNTHOS_DEPLOYMENT_NAME), or UNKNOWN. */
  deployment: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const ENV_RE = /^[a-z][a-z0-9-]{1,30}$/;
const DEPLOYMENT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._:()/-]{0,99}$/;

export function readBuildInfo(env: Record<string, string | undefined> = process.env): BuildInfo {
  const tree: BuildTree = env.SYNTHOS_BUILD_TREE === 'CLEAN' || env.SYNTHOS_BUILD_TREE === 'MODIFIED' ? env.SYNTHOS_BUILD_TREE : 'UNKNOWN';
  const rawSha = (env.SYNTHOS_BUILD_SHA ?? '').trim();
  // A SHA is only meaningful for a checkout that matched it exactly.
  const commit = SHA_RE.test(rawSha) && tree === 'CLEAN' ? rawSha : 'UNKNOWN';
  const rawTime = (env.SYNTHOS_BUILD_TIME ?? '').trim();
  const buildTime = rawTime && /^\d{4}-\d{2}-\d{2}T/.test(rawTime) && !Number.isNaN(Date.parse(rawTime)) ? new Date(rawTime).toISOString() : 'UNKNOWN';
  const rawRef = (env.SYNTHOS_BUILD_REF ?? '').trim();
  const ref = REF_RE.test(rawRef) ? rawRef : 'UNKNOWN';
  const source: BuildSource = env.SYNTHOS_BUILD_SOURCE === 'LAUNCHER_GIT' || env.SYNTHOS_BUILD_SOURCE === 'BUILD_MANIFEST' || env.SYNTHOS_BUILD_SOURCE === 'DEPLOY_ARCHIVE' ? env.SYNTHOS_BUILD_SOURCE : 'UNKNOWN';
  const rawEnv = (env.SYNTHOS_ENVIRONMENT ?? '').trim();
  const nodeEnv = (env.NODE_ENV ?? '').trim();
  const environment = ENV_RE.test(rawEnv) ? rawEnv : ['production', 'development', 'test'].includes(nodeEnv) ? nodeEnv : 'UNKNOWN';
  const rawDeployment = (env.SYNTHOS_DEPLOYMENT_NAME ?? '').trim();
  const deployment = DEPLOYMENT_RE.test(rawDeployment) ? rawDeployment : 'UNKNOWN';
  return { commit, buildTime, ref, tree, source, environment, deployment };
}

/**
 * The full running-version report for diagnostics: the stamped build
 * (above), the Node runtime, the registry manifest schema, and the database
 * schema — its monotonic VERSION (SQLite `user_version`, advanced only by the
 * numbered migrations in lib/persistence.ts), the version this build SUPPORTS
 * (passed in by the caller, so this module never imports the database layer),
 * and a FINGERPRINT of the live schema (SHA-256 of sqlite_master) so drift
 * that no migration accounts for is still visible. UNKNOWN when unreadable.
 */
export function runtimeVersionReport(db?: { prepare(sql: string): { all(): unknown[] } } | null, supportedSchemaVersion?: number): BuildInfo & { node: string; registrySchema: string; databaseSchema: { version: number | 'UNKNOWN'; supported: number | 'UNKNOWN'; fingerprint: string } } {
  let fingerprint = 'UNKNOWN';
  let version: number | 'UNKNOWN' = 'UNKNOWN';
  if (db) {
    try {
      const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all() as Array<{ type: string; name: string; sql: string }>;
      fingerprint = `sha256:${createHash('sha256').update(rows.map((r) => `${r.type}|${r.name}|${r.sql}`).join('\n')).digest('hex')}`;
    } catch { /* stays UNKNOWN */ }
    try {
      const v = Number((db.prepare('PRAGMA user_version').all() as Array<{ user_version: number }>)[0]?.user_version);
      if (Number.isInteger(v) && v >= 0) version = v;
    } catch { /* stays UNKNOWN */ }
  }
  const supported = Number.isInteger(supportedSchemaVersion) ? (supportedSchemaVersion as number) : 'UNKNOWN';
  return { ...readBuildInfo(), node: process.version, registrySchema: REGISTRY_SCHEMA_VERSION, databaseSchema: { version, supported, fingerprint } };
}
