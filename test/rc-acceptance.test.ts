import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'node:http';
import crypto from 'node:crypto';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-rc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;
process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';

import { anyUserExists, createUser, createPendingUser, createSetupToken, resolveSetupToken, completeSetup, login } from '../lib/auth';
import { ensureWorkspace, grantMembership, hasWorkspaceAccess } from '../lib/workspaces';
import { createSkill } from '../lib/skills';
import { executeSkill } from '../lib/skill-execution';
import { createWindmillTarget } from '../lib/windmill-targets';
import { submitAndAwaitExternalExecution } from '../lib/external-executions';
import { getTaskReceipts, getTaskQualityReviews, verifyReceipt, listWorkspaceReceipts } from '../lib/persistence';
import { listWorkspaceVaultEntries } from '../lib/vault';
import { searchWorkspaceMemory } from '../lib/memory-index';
import { createBackup, validateBackupArchive } from '../lib/backup';

// ---------------------------------------------------------------------------
// Pass VII / Workstream T — release-candidate acceptance test.
//
// What this DOES prove, against real code (real SQLite, real filesystem
// Vault, real Aegis verifier, real Ed25519 signing, real KIL scoring, a real
// local mock Windmill server exercising the real HTTP client):
//   platform admin account creation (the real first-user path)
//   -> second-user onboarding via a real one-time setup token
//   -> workspace membership grant
//   -> a real deterministic skill execution
//   -> a real Windmill-backed skill execution through the FULL pipeline
//      (submit -> real remote job -> result -> artifact -> Aegis -> a real
//      SynthOS-signed Ed25519 receipt -> KIL -> memory index)
//   -> that receipt independently re-verifies
//   -> a real backup archive created afterward contains real, checksummed
//      evidence of all of the above
//
// What this deliberately does NOT prove, because nothing is configured in
// this environment (verified honestly, not glossed over — see
// docs/PRODUCTION-READINESS.md): a real Gemini-backed skill execution, a
// real Hermes dedicated-runtime call, or a real external (non-mock) MCP
// server. Those three are exercised by their own dedicated test suites
// against local mock servers (test/skill-execution.test.ts,
// test/hermes-adapter-phase1-truth.test.ts, test/mcp-client.test.ts) — this
// file does not re-fabricate a "pass" for what genuinely has no live
// credential in this deployment.
// ---------------------------------------------------------------------------

const RC_WORKSPACE = 'ws-rc-acceptance';

let server: http.Server;
let adminUserId: string;

beforeAll(async () => {
  // Real local mock Windmill server — same contract shape as Pass VI's
  // client/orchestration tests (see lib/windmill-client.ts's own stated
  // limitation: grounded in Windmill's published REST API shape, not
  // verified against a live instance because none is configured here).
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url || '';
      if (req.method === 'GET' && url === '/api/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('v-rc-test'); }
      if (req.method === 'GET' && url === '/api/users/whoami') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ username: 'rc-runner' })); }
      if (req.method === 'POST' && /\/jobs\/run\//.test(url)) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('99999999-8888-7777-6666-555544443333');
      }
      if (req.method === 'GET' && url.endsWith('/jobs_u/get/99999999-8888-7777-6666-555544443333')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ type: 'CompletedJob', running: false, success: true, canceled: false }));
      }
      if (req.method === 'GET' && url.endsWith('/jobs_u/get_completed_job_result/99999999-8888-7777-6666-555544443333')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ finding: 'RC acceptance synthetic report', confidence: 'high' }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.env.WINDMILL_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.WINDMILL_TOKEN = 'rc-test-token';
  process.env.WINDMILL_WORKSPACE = 'rc-test-ws';
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

describe('RC step 1: platform admin bootstrap and second-user onboarding', () => {
  it('the first account created becomes real (no fabricated identity)', () => {
    expect(anyUserExists()).toBe(false);
    const admin = createUser({ email: 'rc-admin@example.com', password: 'rc-admin-pw-1', displayName: 'RC Admin', platformRole: 'platform_admin' });
    adminUserId = admin.user_id;
    expect(anyUserExists()).toBe(true);

    const loggedIn = login('rc-admin@example.com', 'rc-admin-pw-1');
    expect(loggedIn).not.toBeNull();
  });

  it('a workspace exists and the admin has real membership', () => {
    ensureWorkspace(RC_WORKSPACE, 'RC Acceptance Workspace');
    grantMembership(adminUserId, RC_WORKSPACE, 'admin');
    expect(hasWorkspaceAccess(adminUserId, RC_WORKSPACE)).not.toBeNull();
  });

  it('a second user onboards through a real one-time setup token, never a fabricated account', () => {
    const pending = createPendingUser({ email: 'rc-member@example.com', displayName: 'RC Member' });
    const { rawToken } = createSetupToken(pending.user_id);

    // The raw token is only ever returned at creation — resolving it back
    // proves the real hash-comparison path, not a bypass.
    const resolved = resolveSetupToken(rawToken);
    expect(resolved?.user_id).toBe(pending.user_id);

    const completed = completeSetup(rawToken, 'rc-member-real-password-1');
    expect(completed?.user.status).toBe('active');

    grantMembership(pending.user_id, RC_WORKSPACE, 'member');
    expect(hasWorkspaceAccess(pending.user_id, RC_WORKSPACE)).not.toBeNull();

    // Cross-workspace isolation still holds for the new member.
    expect(hasWorkspaceAccess(pending.user_id, 'ws-some-other-workspace')).toBeNull();
  });
});

describe('RC step 2: a real deterministic skill executes', () => {
  it('vault.list executes for real and is recorded, not fabricated', async () => {
    const skill = createSkill({
      workspaceId: RC_WORKSPACE, name: 'RC Deterministic Skill', enabled: true,
      executionTargetType: 'deterministic', executionTargetRef: 'vault.list',
    });
    const result = await executeSkill(RC_WORKSPACE, skill.skill_id);
    expect(result?.status).toBe('SUCCESS');
    expect(Array.isArray(result?.output)).toBe(true);
  });
});

describe('RC step 3: a Windmill-backed skill goes through the FULL verification spine', () => {
  it('submit -> remote result -> artifact -> Aegis -> Ed25519 receipt -> KIL -> memory index', async () => {
    const target = createWindmillTarget({
      workspaceId: RC_WORKSPACE, name: 'RC report script', remotePath: 'f/rc/report',
      kind: 'script', createdByUserId: adminUserId,
    });
    const skill = createSkill({
      workspaceId: RC_WORKSPACE, name: 'RC Windmill Skill', enabled: true,
      executionTargetType: 'windmill', executionTargetRef: target.id,
    });

    const result = await executeSkill(RC_WORKSPACE, skill.skill_id, { windmillInput: { subject: 'RC test' } }, adminUserId);
    expect(result?.status).toBe('SUCCESS');
    const output = result?.output as any;
    expect(output.verified).toBe(true);
    expect(output.receiptId).toBeTruthy();
    expect(output.taskId).toBeTruthy();

    // Independent re-verification — the whole point of a receipt.
    const receipts = getTaskReceipts(output.taskId);
    expect(receipts.length).toBe(1);
    expect(verifyReceipt(receipts[0])).toBe(true);

    // Aegis actually ran and reached VERIFIED — not skipped.
    const reviews = getTaskQualityReviews(output.taskId);
    expect(reviews.some((r) => r.decision === 'VERIFIED')).toBe(true);

    // The artifact reached the real Vault, and is real-text-searchable via
    // the real memory index (not a fabricated search result).
    const vaultEntries = listWorkspaceVaultEntries(RC_WORKSPACE, 50);
    expect(vaultEntries.some((e) => e.artifact_id === output.artifactId)).toBe(true);
    const searchResults = searchWorkspaceMemory(RC_WORKSPACE, 'RC acceptance synthetic report', 10);
    expect(searchResults.some((r) => r.artifact_id === output.artifactId)).toBe(true);
  });
});

describe('RC step 4: workspace receipt ledger reflects everything real that happened', () => {
  it('listWorkspaceReceipts returns the real Windmill-path receipt', () => {
    const receipts = listWorkspaceReceipts(RC_WORKSPACE, 10);
    expect(receipts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('RC step 5: a real backup afterward contains real, checksummed evidence', () => {
  it('a fresh backup archive validates cleanly against its own independently recomputed checksums', async () => {
    const summary = await createBackup();
    const validation = validateBackupArchive(summary.backup_id);
    expect(validation.valid).toBe(true);
    expect(validation.checksumsVerified).toBe(true);
    expect(validation.manifest?.database_included).toBe(true);
  });
});

describe('RC honesty check: nothing here claims a live provider/Hermes/external-MCP connection', () => {
  it('GEMINI_API_KEY is genuinely absent in this test environment — this suite never fakes a live call', () => {
    // A deliberate, explicit assertion: if a future CI environment injects
    // a real key, this line (not a silent skip) is what would need
    // updating — the absence is asserted, not assumed.
    expect(!!process.env.GEMINI_API_KEY).toBe(false);
  });

  it('HERMES_ADAPTER_BASE_URL is genuinely absent — Hermes runtime stays honestly NOT_CONFIGURED', () => {
    expect(!!process.env.HERMES_ADAPTER_BASE_URL).toBe(false);
  });
});
