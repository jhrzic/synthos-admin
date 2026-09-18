import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// ONE AUTHORITY PER CATEGORY. The canonical control plane owns every stateful
// category; admin.getsynthos.com is a stateless gateway; the archived GCE
// instance's signing key is revoked. Also: task board and agent roster read
// the canonical records only, never mutate them, and invent nothing.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-authority-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'authority.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');

import { isolateVaultForTest } from './helpers/isolated-vault';
isolateVaultForTest('authority');

import { getDatabase, signReceiptPayload, verifyReceipt, REVOKED_RECEIPT_SIGNING_KEYS } from '../lib/persistence';
import { ensureWorkspace } from '../lib/workspaces';
import { CONTROL_PLANE_AUTHORITY, AUTHORITY_CATEGORIES, detectSplitAuthority } from '../lib/control-plane-authority';
import { listBoardTasks, stageOf } from '../lib/task-board';
import { listObservedAgents, NOT_RECORDED_FIELDS } from '../lib/agent-roster';

const WS = 'ws-auth';
let fetchCalls = 0;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

beforeAll(() => {
  (globalThis as any).fetch = () => { fetchCalls += 1; throw new Error('network forbidden'); };
  getDatabase(); ensureWorkspace(WS, 'Authority'); ensureWorkspace('ws-other', 'Other');
  const db = getDatabase();
  const add = (id: string, status: string, agent: string | null, model: string | null, ws = WS) =>
    db.prepare("INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES (?, ?, ?, 'd', ?, ?, ?, '2026-09-10T00:00:00Z', ?)").run(id, ws, `T ${id}`, agent, model, status, `2026-09-1${id.length % 9}T00:00:00Z`);
  add('t-done', 'DONE', 'scribe', 'model-x'); add('t-fail', 'FAILED', 'scribe', 'model-x'); add('t-recon', 'RECONCILING_UNKNOWN_EXECUTION', 'scribe', 'model-y');
  add('t-legacy', 'TODO', 'technical', 'n/a'); add('t-human', 'READY', 'human', 'n/a'); add('t-foreign', 'DONE', 'scribe', 'model-x', 'ws-other');
  const payload = JSON.stringify({ task: 't-done' }); const sig = signReceiptPayload(payload);
  db.prepare("INSERT INTO quality_reviews (review_id, task_id, reviewer, method, score, decision, checks_json, evidence_json, created_at) VALUES ('qr-1', 't-done', 'aegis', 'deterministic', 100, 'VERIFIED', '[]', '{}', '2026-09-10T00:00:01Z')").run();
  db.prepare("INSERT INTO receipts (receipt_id, task_id, review_id, algorithm, public_key, payload_json, signature, created_at) VALUES ('rc-1', 't-done', 'qr-1', 'Ed25519', ?, ?, ?, '2026-09-10T00:00:02Z')").run(sig.publicKeyPem, payload, sig.signature);
  db.prepare("INSERT INTO artifacts (artifact_id, task_id, relative_path, disk_path, content_hash, size_bytes, created_at, retrieval_status) VALUES ('a-1', 't-done', 'x.md', '/tmp/x.md', 'h', 1, '2026-09-10T00:00:01Z', 'QUARANTINED')").run();
});

describe('canonical authority topology', () => {
  it('every stateful category has exactly one canonical owner; the gateway stores no state', () => {
    expect(new Set(AUTHORITY_CATEGORIES).size).toBe(AUTHORITY_CATEGORIES.length);
    for (const c of AUTHORITY_CATEGORIES) expect(CONTROL_PLANE_AUTHORITY.categories[c]).toBe('CANONICAL');
    for (const c of ['tasks', 'registry', 'qualifications', 'spend_policy_and_ledger', 'receipts_and_signing_key', 'memory_index', 'scheduler'] as const) expect(AUTHORITY_CATEGORIES).toContain(c);
    expect(CONTROL_PLANE_AUTHORITY.gateway).toEqual({ host: 'admin.getsynthos.com', kind: 'CADDY_SSH_REVERSE_TUNNEL', storesState: false });
  });

  it('split-authority detection flags two writers of a category; archived/read-only copies are not splits', () => {
    expect(detectSplitAuthority([
      { instance: 'mac', category: 'tasks', acceptsWrites: true }, { instance: 'gce', category: 'tasks', acceptsWrites: true },
      { instance: 'mac', category: 'registry', acceptsWrites: true }, { instance: 'gce-archived', category: 'registry', acceptsWrites: false },
    ])).toEqual([{ category: 'tasks', writers: ['gce', 'mac'] }]);
    expect(detectSplitAuthority(AUTHORITY_CATEGORIES.map((c) => ({ instance: 'canonical', category: c, acceptsWrites: true })))).toEqual([]);
  });

  it('the archived instance cannot become a second signing authority: its key is revoked', () => {
    expect(REVOKED_RECEIPT_SIGNING_KEYS.map((k) => k.fingerprint)).toContain('sha256:d210f8db5c25dbaa4cf31c47f204378b32ca1b5adf9b0f5180fcc2f7ddacb3f2');
  });

  it('the gateway is fail-closed, stateless and has a single fixed upstream', () => {
    const caddy = read('docs/deploy/gateway/Caddyfile.gateway');
    expect(caddy.match(/reverse_proxy /g)).toHaveLength(1);
    expect(caddy).toContain('reverse_proxy 127.0.0.1:18080');
    expect(caddy).toMatch(/handle_errors 502 503 504/);
    expect(caddy).toContain('CONTROL PLANE UNREACHABLE');
    expect(caddy).toContain('"controlPlane":"UNREACHABLE"');
    expect(caddy).toMatch(/dial_timeout 3s/);
    const compose = read('docs/deploy/gateway/docker-compose.gateway.yml');
    expect(compose).not.toMatch(/synthos-admin:|build:|synthos-data|SYNTHOS_DB_PATH/);
    const tunnel = read('scripts/synthos-gateway-tunnel.sh');
    expect(tunnel).toContain('-R "127.0.0.1:${REMOTE_PORT}:127.0.0.1:${LOCAL_PORT}"');
    expect(tunnel).toContain('ExitOnForwardFailure=yes');
    expect(tunnel).not.toMatch(/-L |GatewayPorts|0\.0\.0\.0/);
  });

  it('/api/authority reports identity without data, paths or secrets', () => {
    const server = read('server.ts');
    const block = server.slice(server.indexOf('app.get("/api/authority"'), server.indexOf('app.get("/api/ready"'));
    expect(block).toContain('path.basename(getDatabasePath())');
    expect(block).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN)/);
    expect(server).toContain('secure: cookieSecure(res.req),');
    expect(server).toMatch(/if \(req\?\.secure === true\) return true;/);
  });
});

describe('task board: canonical records, read-only, nothing invented', () => {
  it('lists this workspace only, maps lifecycle stages, and joins real evidence', () => {
    const before = getDatabase().prepare('SELECT * FROM tasks ORDER BY task_id').all();
    const r = listBoardTasks(WS);
    expect(getDatabase().prepare('SELECT * FROM tasks ORDER BY task_id').all()).toEqual(before);
    expect(r.total).toBe(5);
    expect(r.tasks.map((t) => t.taskId).sort()).toEqual(['t-done', 't-fail', 't-human', 't-legacy', 't-recon']);
    const done = r.tasks.find((t) => t.taskId === 't-done')!;
    expect(done).toMatchObject({ stage: 'DONE', aegis: { decision: 'VERIFIED', score: 100 }, receipts: { count: 1, verified: 1, latestId: 'rc-1' }, artifacts: { count: 1, quarantined: 1 } });
    expect(done.taskClass).toBeNull(); expect(done.route).toBeNull(); expect(done.guardian).toBeNull(); expect(done.spend).toBeNull();
    expect(r.tasks.find((t) => t.taskId === 't-recon')).toMatchObject({ stage: 'RECONCILING', reconciliation: { findings: 0, latestFinding: null } });
    expect(r.tasks.find((t) => t.taskId === 't-legacy')).toMatchObject({ stage: 'QUEUED', legacy: true });
  });

  it('stage mapping is total and never hides an unknown status', () => {
    expect(stageOf('PAUSED_AWAITING_BUDGET')).toBe('PAUSED');
    expect(stageOf('AWAITING_RECEIPT')).toBe('VERIFYING');
    expect(stageOf('SOMETHING_NEW')).toBe('OTHER');
  });
});

describe('agent roster: recorded facts only', () => {
  it('derives agents from the task record with real counts; every unrecorded field is null', () => {
    const agents = listObservedAgents(WS);
    expect(agents.map((a) => a.agentId)).toEqual(['scribe', 'human', 'technical']);
    const scribe = agents[0];
    expect(scribe).toMatchObject({ kind: 'AGENT_ROLE', source: 'CANONICAL_TASK_RECORD', taskCount: 3, succeeded: 1, failed: 1, modelsUsed: ['model-x', 'model-y'] });
    for (const f of NOT_RECORDED_FIELDS) expect((scribe as any)[f], f).toBeNull();
    expect(agents.find((a) => a.agentId === 'human')!.kind).toBe('HUMAN');
    expect(JSON.stringify(agents)).not.toMatch(/completedTasksCount|memoryFileSize|uptime|ONLINE/i);
  });

  it('made no network request', () => { expect(fetchCalls).toBe(0); });
});
