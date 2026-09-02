import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import {
  calculateKilConfidence,
  evidenceQuality,
  isPromoted,
  trackRecord,
  verificationGate,
  PROMOTION_THRESHOLD,
  QUALITY_FLOOR,
  type KilCheckResults,
} from './kil';

export interface TaskRecord {
  task_id: string;
  workspace_id: string;
  title: string;
  description: string;
  assigned_agent: string;
  assigned_model: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TaskStatusHistoryRecord {
  id?: number | string;
  task_id: string;
  status: string;
  created_at: string;
}

export interface ActivityEventRecord {
  event_id: string;
  task_id: string;
  event_type: string;
  agent_id: string;
  payload_json: string;
  created_at: string;
}

export interface ArtifactRecord {
  artifact_id: string;
  task_id: string;
  relative_path: string;
  disk_path: string;
  content_hash: string;
  size_bytes: number;
  created_at: string;
}

export interface QualityReviewRecord {
  review_id: string;
  task_id: string;
  reviewer: string;
  method: string;
  score: number | null;
  decision: string;
  checks_json: string;
  evidence_json: string;
  created_at: string;
}

export interface ReceiptRecord {
  receipt_id: string;
  task_id: string;
  review_id: string;
  algorithm: string;
  public_key: string;
  payload_json: string;
  signature: string;
  created_at: string;
}

export interface CanonicalReceiptPayload {
  receiptId: string;
  taskId: string;
  reviewId: string;
  workspaceId: string;
  assignedAgent: string;
  provider: string;
  modelUsed: string;
  artifactId: string;
  artifactHash: string;
  aegisDecision: string;
  aegisMethod: string;
  createdAt: string;
}

export interface AegisCheckResult {
  check: string;
  status: 'PASS' | 'FAIL';
  evidence: string;
}

export interface GraphRecord {
  graph_id: string;
  workspace_id: string | null;
  name: string;
  description: string;
  nodes_json: string;
  edges_json: string;
  created_at: string;
  updated_at: string;
}

export interface GraphRunRecord {
  run_id: string;
  graph_id: string;
  workspace_id: string | null;
  status: string;
  current_node_id: string | null;
  state_json: string;
  created_at: string;
  updated_at: string;
}

export function getDatabasePath(): string {
  return process.env.SYNTHOS_DB_PATH || path.join(process.cwd(), 'data', 'synthos-admin.db');
}

let dbInstance: any = null;

export function getDatabase(): any {
  if (!dbInstance) {
    const dbPath = getDatabasePath();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new DatabaseSync(dbPath);

    // Initialize required SQLite schema
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        workspace_id TEXT,
        title TEXT,
        description TEXT,
        assigned_agent TEXT,
        assigned_model TEXT,
        status TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        event_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        disk_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quality_reviews (
        review_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        method TEXT NOT NULL,
        score REAL NULL,
        decision TEXT NOT NULL,
        checks_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        receipt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        public_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graphs (
        graph_id TEXT PRIMARY KEY,
        workspace_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_runs (
        run_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        workspace_id TEXT,
        status TEXT NOT NULL,
        current_node_id TEXT,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Knowledge Intelligence Layer (KIL). Migrated from the real, shipped
      -- implementation in ~/synthos/mission-control (synthos-kil.ts,
      -- synthos-kil-observations.ts). Scoring lives in lib/kil.ts as pure
      -- functions; this table only stores what was decided, so a past
      -- promotion can be explained from its own row rather than recomputed
      -- against today's weights.
      --
      -- Deliberately omitted vs. the source schema: cron_job_id. This
      -- deployment has no scheduler/loop concept (scheduling is deferred to
      -- Windmill, per project docs) — there is nothing for that column to
      -- ever reference, so it is not carried forward as dead compatibility
      -- surface. agent_id and task_id are TEXT here (not INTEGER) to match
      -- this repo's existing id convention (tasks.task_id, agents are role
      -- strings like "scout"/"dev", not rows in a table).
      CREATE TABLE IF NOT EXISTS kil_observations (
        observation_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT,
        agent_id TEXT,
        verification INTEGER NOT NULL CHECK (verification IN (0, 1)),
        evidence REAL NOT NULL,
        frequency REAL NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL,
        promoted INTEGER NOT NULL DEFAULT 0 CHECK (promoted IN (0, 1)),
        promotion_threshold REAL NOT NULL,
        quality_floor REAL NOT NULL,
        checks_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kil_observations_workspace
        ON kil_observations(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_kil_observations_promoted
        ON kil_observations(workspace_id, promoted);
      CREATE INDEX IF NOT EXISTS idx_kil_observations_task
        ON kil_observations(workspace_id, task_id);

      -- Verified knowledge candidate projection. Migrated from the real
      -- shipped implementation (synthos-verified-knowledge.ts /
      -- knowledge_candidates), narrowed to what this repo's schema can
      -- actually back. The source table also FKs to mission_id, graph_run_id
      -- and activity_id (mission-control's missions/graph_runs/activity_ledger
      -- tables); this repo has no "mission" concept above a task at all, and
      -- its graph_runs/activity_events aren't linked to a task the way the
      -- source's schema assumes. Rather than invent those relationships,
      -- this table preserves the three fields that map onto real rows here
      -- and can be genuinely integrity-checked: task_id, kil_observation_id,
      -- receipt_id. This is a narrower provenance guarantee than the source
      -- table's four-way check, not an equivalent one — reported, not hidden.
      CREATE TABLE IF NOT EXISTS knowledge_candidates (
        candidate_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        candidate_key TEXT NOT NULL,
        label TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kil_observation_id TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        vault_path TEXT NOT NULL,
        verification_state TEXT NOT NULL DEFAULT 'verified'
          CHECK (verification_state IN ('verified', 'failed')),
        promotion_state TEXT NOT NULL DEFAULT 'pending'
          CHECK (promotion_state IN ('pending', 'promoted', 'rejected')),
        promoted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, candidate_key)
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_workspace_state
        ON knowledge_candidates(workspace_id, promotion_state, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_task
        ON knowledge_candidates(workspace_id, task_id);

      -- TON telemetry. Migrated from the real, shipped implementation at
      -- ~/synthos/mission-control (ton-analytics.ts, ton_telemetry_events).
      -- Values shown anywhere in the UI must come from these rows or remain
      -- unavailable — never sample/demo data. occurred_at/created_at are TEXT
      -- ISO-8601 here (not INTEGER unixepoch) to match this repo's existing
      -- timestamp convention; SQLite's date() works directly on ISO-8601.
      CREATE TABLE IF NOT EXISTS ton_telemetry_events (
        event_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'campaign', 'acquisition', 'install', 'attribution', 'fraud_block',
          'wallet_link', 'escrow_deposit', 'verification', 'settlement', 'payout'
        )),
        channel TEXT,
        wallet_hint TEXT,
        amount_usdt REAL,
        spend_usd REAL,
        revenue_usd REAL,
        verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
        blocked_reason TEXT,
        latency_ms INTEGER,
        tx_hash TEXT,
        detail_json TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ton_telemetry_workspace_time
        ON ton_telemetry_events(workspace_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_ton_telemetry_workspace_type_time
        ON ton_telemetry_events(workspace_id, event_type, occurred_at);

      -- TON guardians. Migrated from ~/synthos/mission-control's
      -- ton-guardians.ts, adapted: the source installs guardians as rows in
      -- a real "agents" table this repo does not have (agents here are role
      -- strings, not DB rows — see server.ts's assignedAgent usage). This
      -- table stands alone rather than inventing a generic agents table.
      -- Exactly 5 real guardians exist in the source (attribution, fraud,
      -- treasury, compliance, settlement) — not 8. A row here means that
      -- guardian was genuinely installed for this workspace; there is no
      -- other source of truth for guardian state.
      CREATE TABLE IF NOT EXISTS ton_guardians (
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        config_json TEXT,
        installed_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, name)
      );
    `);

    // Backfill migration: graphs/graph_runs predate workspace_id. This runs
    // once per database (the PRAGMA check below finds the column already
    // present on every subsequent start and skips). ws-synthos-primary here
    // is a one-time migration-compatibility value for rows that already
    // existed before this column did — it is never used as a live default
    // for new graphs/graph_runs, which always carry a caller-resolved
    // workspace_id (see resolveWorkspaceId in server.ts routes).
    const graphCols = dbInstance.prepare("PRAGMA table_info(graphs)").all() as Array<{ name: string }>;
    if (!graphCols.some((c) => c.name === 'workspace_id')) {
      dbInstance.exec("ALTER TABLE graphs ADD COLUMN workspace_id TEXT");
      dbInstance.prepare("UPDATE graphs SET workspace_id = ? WHERE workspace_id IS NULL").run(DEFAULT_WORKSPACE_ID);
    }
    const graphRunCols = dbInstance.prepare("PRAGMA table_info(graph_runs)").all() as Array<{ name: string }>;
    if (!graphRunCols.some((c) => c.name === 'workspace_id')) {
      dbInstance.exec("ALTER TABLE graph_runs ADD COLUMN workspace_id TEXT");
      dbInstance.prepare("UPDATE graph_runs SET workspace_id = ? WHERE workspace_id IS NULL").run(DEFAULT_WORKSPACE_ID);
    }

    dbInstance.exec(`
      CREATE INDEX IF NOT EXISTS idx_graphs_workspace ON graphs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_graph_runs_workspace ON graph_runs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_graph_runs_workspace_graph ON graph_runs(workspace_id, graph_id);
    `);

    // Local memory index (SQLite FTS5) over real, verified Vault artifacts.
    // workspace_id/artifact_id/source_path/updated_at are UNINDEXED — stored
    // for filtering and display, never full-text-matched — which is the
    // standard FTS5 pattern for scoping a virtual table without a separate
    // companion join table. artifact_id is the stable key used to avoid
    // duplicate rows on reindex (delete-then-insert, see lib/memory-index.ts).
    dbInstance.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_index USING fts5(
        workspace_id UNINDEXED,
        artifact_id UNINDEXED,
        title,
        content,
        source_path UNINDEXED,
        updated_at UNINDEXED,
        tokenize = 'porter unicode61'
      );
    `);

    // Real, workspace-scoped skill registry. No secrets — a skill record is
    // metadata (name/description/source reference) plus enabled/status, never
    // a credential. `status` starts NOT_CONFIGURED and stays there: no
    // execution runtime is wired into this deployment (see lib/skills.ts),
    // so nothing here ever claims READY/LIVE without real evidence.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        skill_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'custom',
        version TEXT NOT NULL DEFAULT '0.1.0',
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT,
        markdown_spec TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skills_workspace ON skills(workspace_id);
    `);

    // Every real test-invocation attempt against a skill, workspace-scoped.
    // This is what a skill's derived call count / outcome history is
    // computed from at read time — never a stored, hand-set counter that
    // could silently drift from what actually happened.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS skill_test_events (
        event_id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skill_test_events_skill ON skill_test_events(skill_id);
    `);

    // Real, workspace-scoped Jarvis conversation history. Jarvis itself is
    // a global UI surface, but its history is scoped by the caller's active
    // workspace, same as every admin query it can run (see
    // /api/jarvis/command). No hidden chain-of-thought or secrets are ever
    // stored — only the visible directive text and the visible reply text,
    // the same content already shown on screen.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS jarvis_sessions (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_workspace ON jarvis_sessions(workspace_id);

      CREATE TABLE IF NOT EXISTS jarvis_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        provider TEXT,
        model TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jarvis_messages_session ON jarvis_messages(session_id);
    `);
  }
  return dbInstance;
}

// Graphs are workspace-owned. saveGraph() requires a resolved workspaceId on
// every call (callers resolve it via resolveWorkspaceId() before calling,
// same pattern as tasks). Ownership is immutable once a graph exists: a
// save() against an existing graph_id in a different workspace is rejected,
// not silently reassigned or merged.
export function saveGraph(params: {
  graphId: string;
  workspaceId: string;
  name: string;
  description?: string;
  nodes: any[];
  edges: any[];
}): GraphRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const nodesJson = JSON.stringify(params.nodes || []);
  const edgesJson = JSON.stringify(params.edges || []);
  const desc = params.description || '';

  const existing = db.prepare('SELECT graph_id, workspace_id FROM graphs WHERE graph_id = ?')
    .get(params.graphId) as { graph_id: string; workspace_id: string | null } | undefined;

  if (existing) {
    if (existing.workspace_id !== params.workspaceId) {
      throw new Error(`Graph ${params.graphId} belongs to a different workspace`);
    }
    db.prepare(`
      UPDATE graphs
      SET name = ?, description = ?, nodes_json = ?, edges_json = ?, updated_at = ?
      WHERE graph_id = ? AND workspace_id = ?
    `).run(params.name, desc, nodesJson, edgesJson, now, params.graphId, params.workspaceId);
  } else {
    db.prepare(`
      INSERT INTO graphs (graph_id, workspace_id, name, description, nodes_json, edges_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(params.graphId, params.workspaceId, params.name, desc, nodesJson, edgesJson, now, now);
  }

  return {
    graph_id: params.graphId,
    workspace_id: params.workspaceId,
    name: params.name,
    description: desc,
    nodes_json: nodesJson,
    edges_json: edgesJson,
    created_at: now,
    updated_at: now
  };
}

/**
 * Scoped lookup. Returns null both when the graph doesn't exist and when it
 * belongs to a different workspace — the two cases are indistinguishable to
 * the caller, so a request can't be used to probe for another workspace's
 * graph ids.
 */
export function getGraph(graphId: string, workspaceId: string): GraphRecord | null {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graphs WHERE graph_id = ? AND workspace_id = ?')
    .get(graphId, workspaceId) as GraphRecord) || null;
}

export function listGraphs(workspaceId: string): GraphRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graphs WHERE workspace_id = ? ORDER BY updated_at DESC')
    .all(workspaceId) as GraphRecord[]) || [];
}

/**
 * Graph runs inherit their workspace from the owning graph — never from a
 * caller-supplied value. On first insert, workspace_id is looked up from
 * `graphs` for graphId; if the caller also passed a workspaceId and it
 * disagrees with the graph's real owner, the run is rejected rather than
 * silently reassigned to either side. Updates to an existing run never touch
 * workspace_id — it is set once, at creation, and is immutable after that.
 */
export function saveGraphRun(params: {
  runId: string;
  graphId: string;
  status: string;
  currentNodeId?: string | null;
  state?: any;
  workspaceId?: string;
}): GraphRunRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const stateJson = JSON.stringify(params.state || {});
  const currentNodeId = params.currentNodeId || null;

  const existing = db.prepare('SELECT run_id, workspace_id FROM graph_runs WHERE run_id = ?')
    .get(params.runId) as { run_id: string; workspace_id: string | null } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE graph_runs
      SET status = ?, current_node_id = ?, state_json = ?, updated_at = ?
      WHERE run_id = ?
    `).run(params.status, currentNodeId, stateJson, now, params.runId);

    return {
      run_id: params.runId,
      graph_id: params.graphId,
      workspace_id: existing.workspace_id,
      status: params.status,
      current_node_id: currentNodeId,
      state_json: stateJson,
      created_at: now,
      updated_at: now
    };
  }

  const graph = db.prepare('SELECT workspace_id FROM graphs WHERE graph_id = ?')
    .get(params.graphId) as { workspace_id: string | null } | undefined;
  if (!graph) {
    throw new Error(`Cannot create a run for unknown graph ${params.graphId}`);
  }
  if (params.workspaceId && params.workspaceId !== graph.workspace_id) {
    throw new Error(`Graph ${params.graphId} does not belong to workspace ${params.workspaceId}`);
  }
  const workspaceId = graph.workspace_id;

  db.prepare(`
    INSERT INTO graph_runs (run_id, graph_id, workspace_id, status, current_node_id, state_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.runId, params.graphId, workspaceId, params.status, currentNodeId, stateJson, now, now);

  return {
    run_id: params.runId,
    graph_id: params.graphId,
    workspace_id: workspaceId,
    status: params.status,
    current_node_id: currentNodeId,
    state_json: stateJson,
    created_at: now,
    updated_at: now
  };
}

/** Scoped lookup — same non-disclosure behavior as getGraph(). */
export function getGraphRun(runId: string, workspaceId: string): GraphRunRecord | null {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graph_runs WHERE run_id = ? AND workspace_id = ?')
    .get(runId, workspaceId) as GraphRunRecord) || null;
}

export function listGraphRuns(workspaceId: string): GraphRunRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graph_runs WHERE workspace_id = ? ORDER BY updated_at DESC')
    .all(workspaceId) as GraphRunRecord[]) || [];
}

export function createInitialTask(params: {
  taskId: string;
  workspaceId?: string;
  title: string;
  description: string;
  assignedAgent: string;
  assignedModel: string;
  createdAt?: string;
}): TaskRecord {
  const db = getDatabase();
  const now = params.createdAt || new Date().toISOString();
  const workspaceId = params.workspaceId || 'ws-synthos-primary';

  // Upsert or insert task as TODO
  const existing = db.prepare('SELECT task_id FROM tasks WHERE task_id = ?').get(params.taskId);
  if (existing) {
    db.prepare(`
      UPDATE tasks 
      SET workspace_id = ?, title = ?, description = ?, assigned_agent = ?, assigned_model = ?, status = 'TODO', updated_at = ?
      WHERE task_id = ?
    `).run(workspaceId, params.title, params.description, params.assignedAgent, params.assignedModel, now, params.taskId);
  } else {
    db.prepare(`
      INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'TODO', ?, ?)
    `).run(params.taskId, workspaceId, params.title, params.description, params.assignedAgent, params.assignedModel, now, now);
  }

  // Record initial status history
  db.prepare(`
    INSERT INTO task_status_history (task_id, status, created_at)
    VALUES (?, 'TODO', ?)
  `).run(params.taskId, now);

  return {
    task_id: params.taskId,
    workspace_id: workspaceId,
    title: params.title,
    description: params.description,
    assigned_agent: params.assignedAgent,
    assigned_model: params.assignedModel,
    status: 'TODO',
    created_at: now,
    updated_at: now
  };
}

export function updateTaskStatus(taskId: string, status: string, timestamp?: string): void {
  const db = getDatabase();
  const now = timestamp || new Date().toISOString();

  db.prepare(`
    UPDATE tasks 
    SET status = ?, updated_at = ?
    WHERE task_id = ?
  `).run(status, now, taskId);

  db.prepare(`
    INSERT INTO task_status_history (task_id, status, created_at)
    VALUES (?, ?, ?)
  `).run(taskId, status, now);
}

export function recordActivityEvent(params: {
  eventId?: string;
  taskId: string;
  eventType: string;
  agentId: string;
  payload?: any;
  createdAt?: string;
}): ActivityEventRecord {
  const db = getDatabase();
  const eventId = params.eventId || `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = params.createdAt || new Date().toISOString();
  const payloadJson = typeof params.payload === 'string' ? params.payload : JSON.stringify(params.payload || {});

  db.prepare(`
    INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, params.taskId, params.eventType, params.agentId, payloadJson, now);

  return {
    event_id: eventId,
    task_id: params.taskId,
    event_type: params.eventType,
    agent_id: params.agentId,
    payload_json: payloadJson,
    created_at: now
  };
}

export function recordArtifact(params: {
  artifactId?: string;
  taskId: string;
  relativePath: string;
  diskPath: string;
  content: string | Buffer;
  createdAt?: string;
}): ArtifactRecord {
  const db = getDatabase();
  const artifactId = params.artifactId || `art-${Date.now()}`;
  const now = params.createdAt || new Date().toISOString();
  
  const contentBuffer = typeof params.content === 'string' ? Buffer.from(params.content, 'utf8') : params.content;
  const contentHash = `sha256:${crypto.createHash('sha256').update(contentBuffer).digest('hex')}`;
  const sizeBytes = contentBuffer.byteLength;

  // Ensure disk directory exists and write file to disk
  if (params.diskPath) {
    const parentDir = path.dirname(params.diskPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(params.diskPath, contentBuffer);
  }

  db.prepare(`
    INSERT INTO artifacts (artifact_id, task_id, relative_path, disk_path, content_hash, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(artifactId, params.taskId, params.relativePath, params.diskPath, contentHash, sizeBytes, now);

  return {
    artifact_id: artifactId,
    task_id: params.taskId,
    relative_path: params.relativePath,
    disk_path: params.diskPath,
    content_hash: contentHash,
    size_bytes: sizeBytes,
    created_at: now
  };
}

// The single seeded workspace this deployment defaults to when a caller
// omits workspaceId — matches the existing convention already used by
// createInitialTask() and the graph/task execution routes.
export const DEFAULT_WORKSPACE_ID = 'ws-synthos-primary';

// Resolves a client-supplied workspace identity for read-path scoping.
// - omitted -> defaults to the primary workspace (existing write-path
//   convention, not a new mechanism).
// - present but not a non-empty string -> explicitly invalid; the caller
//   must reject the request rather than silently defaulting or ignoring it.
export function resolveWorkspaceId(raw: unknown): { workspaceId: string } | { error: string } {
  // Truly omitted (field absent from the request) -> default to the primary
  // workspace, matching the existing write-path convention.
  if (raw === undefined || raw === null) {
    return { workspaceId: DEFAULT_WORKSPACE_ID };
  }
  // Explicitly supplied but empty/whitespace/non-string -> invalid. This is
  // NOT treated the same as omission: a caller that sends a blank or
  // malformed value gets a truthful rejection, never a silent default and
  // never an unscoped read.
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { error: 'workspaceId, when supplied, must be a non-empty string.' };
  }
  return { workspaceId: raw.trim() };
}

// Workspace-ownership check for read routes that accept a client-supplied
// task_id directly (e.g. GET /api/execution/tasks/:taskId*). A task_id alone
// is not proof of workspace membership — callers must verify the task's real
// workspace_id matches the caller's active workspace before returning any
// task-scoped data (activity, artifacts, reviews, receipts).
export function getTaskWorkspaceId(taskId: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT workspace_id FROM tasks WHERE task_id = ?').get(taskId) as { workspace_id: string } | undefined;
  return row?.workspace_id ?? null;
}

// The actual access-control decision behind every /api/execution/tasks/:taskId*
// route: true only if the task exists AND its real workspace_id matches the
// caller's resolved workspace. An unknown task_id is treated the same as a
// mismatched one (false) — never distinguished in the response — so a caller
// cannot use it as an oracle for whether a task_id exists in another workspace.
export function isTaskInWorkspace(taskId: string, workspaceId: string): boolean {
  return getTaskWorkspaceId(taskId) === workspaceId;
}

export interface WorkspaceTaskSummary {
  task_id: string;
  title: string;
  assigned_agent: string;
  assigned_model: string;
  status: string;
  created_at: string;
}

// Used by Jarvis's ADMIN_TASK_QUERY intent. Jarvis is a global UI surface,
// but it reads within the caller's active workspace, not across tenants —
// there is no privileged cross-workspace mode implemented in this
// repository.
export function listWorkspaceTasks(workspaceId: string, limit = 10): WorkspaceTaskSummary[] {
  const db = getDatabase();
  return (db.prepare(`
    SELECT task_id, title, assigned_agent, assigned_model, status, created_at
    FROM tasks
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit) as WorkspaceTaskSummary[]) || [];
}

export interface WorkspaceReceiptSummary {
  receipt_id: string;
  task_id: string;
  algorithm: string;
  created_at: string;
}

// Used by Jarvis's ADMIN_RECEIPT_QUERY intent. receipts carries no
// workspace_id column directly — scoped via its owning task, which does.
export function listWorkspaceReceipts(workspaceId: string, limit = 5): WorkspaceReceiptSummary[] {
  const db = getDatabase();
  return (db.prepare(`
    SELECT r.receipt_id, r.task_id, r.algorithm, r.created_at
    FROM receipts r
    JOIN tasks t ON t.task_id = r.task_id
    WHERE t.workspace_id = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(workspaceId, limit) as WorkspaceReceiptSummary[]) || [];
}

export function getTaskWithHistory(taskId: string): { task: TaskRecord | null; statusHistory: TaskStatusHistoryRecord[] } {
  const db = getDatabase();
  const task = (db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as TaskRecord) || null;
  const statusHistory = (db.prepare('SELECT * FROM task_status_history WHERE task_id = ? ORDER BY id ASC').all(taskId) as TaskStatusHistoryRecord[]) || [];

  return { task, statusHistory };
}

export function getTaskActivityEvents(taskId: string): ActivityEventRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM activity_events WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as ActivityEventRecord[]) || [];
}

export function getTaskArtifacts(taskId: string): ArtifactRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as ArtifactRecord[]) || [];
}

export function recordQualityReview(params: {
  reviewId?: string;
  taskId: string;
  reviewer: string;
  method: string;
  score: number | null;
  decision: string;
  checks: AegisCheckResult[] | any;
  evidence: any;
  createdAt?: string;
}): QualityReviewRecord {
  const db = getDatabase();
  const reviewId = params.reviewId || `qr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = params.createdAt || new Date().toISOString();
  const checksJson = typeof params.checks === 'string' ? params.checks : JSON.stringify(params.checks || []);
  const evidenceJson = typeof params.evidence === 'string' ? params.evidence : JSON.stringify(params.evidence || {});

  db.prepare(`
    INSERT INTO quality_reviews (review_id, task_id, reviewer, method, score, decision, checks_json, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(reviewId, params.taskId, params.reviewer, params.method, params.score, params.decision, checksJson, evidenceJson, now);

  return {
    review_id: reviewId,
    task_id: params.taskId,
    reviewer: params.reviewer,
    method: params.method,
    score: params.score,
    decision: params.decision,
    checks_json: checksJson,
    evidence_json: evidenceJson,
    created_at: now
  };
}

export function getTaskQualityReviews(taskId: string): QualityReviewRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM quality_reviews WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as QualityReviewRecord[]) || [];
}

// --------------------------------------------------------------------------
// Deterministic Package Metadata Tool & Verification
// --------------------------------------------------------------------------

export interface PackageMetadataResult {
  packageName: string;
  packageVersion: string;
  relativePath: string;
  absolutePath: string;
  sourceHash: string;
}

export function read_package_metadata(): PackageMetadataResult {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('package.json not found at process.cwd()');
  }
  const rawContent = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(rawContent);
  const hash = `sha256:${crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex')}`;
  return {
    packageName: pkg.name || 'unknown',
    packageVersion: pkg.version || '0.0.0',
    relativePath: 'package.json',
    absolutePath: pkgPath,
    sourceHash: hash
  };
}

export function deleteTaskRecords(taskId: string): void {
  const db = getDatabase();
  const artifacts = getTaskArtifacts(taskId);
  for (const art of artifacts) {
    if (art.disk_path && fs.existsSync(art.disk_path)) {
      try {
        fs.unlinkSync(art.disk_path);
      } catch {
        // ignore disk deletion failure
      }
    }
  }
  db.prepare('DELETE FROM receipts WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM quality_reviews WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM artifacts WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM activity_events WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM task_status_history WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);
}

export function runDeterministicAegisVerification(taskId: string, expectedOutputText?: string): {
  decision: 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE';
  score: number | null;
  reviewer: string;
  method: string;
  checks: AegisCheckResult[];
  evidence: Record<string, any>;
} {
  const reviewer = "Guardian-Aegis-Deterministic-v1";
  const method = "DETERMINISTIC_ARTIFACT_AND_LEDGER_AUDIT";
  const checks: AegisCheckResult[] = [];
  const evidence: Record<string, any> = {};

  try {
    const { task, statusHistory } = getTaskWithHistory(taskId);
    const activityEvents = getTaskActivityEvents(taskId);
    const artifacts = getTaskArtifacts(taskId);

    // 1. Task exists in SQLite
    if (task) {
      checks.push({
        check: "task_exists_in_sqlite",
        status: "PASS",
        evidence: `Task ${taskId} found with status "${task.status}"`
      });
      evidence.task = { taskId: task.task_id, status: task.status, title: task.title };
    } else {
      checks.push({
        check: "task_exists_in_sqlite",
        status: "FAIL",
        evidence: `Task ${taskId} not found in SQLite database`
      });
      return {
        decision: "INCONCLUSIVE",
        score: null,
        reviewer,
        method,
        checks,
        evidence: { error: `Task ${taskId} record not found` }
      };
    }

    // 2. Provider output is non-empty
    const providerCompletedEvent = activityEvents.find(e => e.event_type === "PROVIDER_COMPLETED");
    let outputLength = 0;
    if (expectedOutputText && expectedOutputText.trim().length > 0) {
      outputLength = expectedOutputText.length;
    } else if (providerCompletedEvent) {
      try {
        const payload = JSON.parse(providerCompletedEvent.payload_json);
        outputLength = payload.outputLength || 0;
      } catch {
        outputLength = 0;
      }
    }

    if (outputLength > 0) {
      checks.push({
        check: "provider_output_non_empty",
        status: "PASS",
        evidence: `Provider output length is ${outputLength} characters`
      });
      evidence.outputLength = outputLength;
    } else {
      checks.push({
        check: "provider_output_non_empty",
        status: "FAIL",
        evidence: "Provider output is empty (0 characters)"
      });
    }

    // 3. Persisted artifact exists
    const artifact = artifacts[0] || null;
    if (artifact) {
      checks.push({
        check: "persisted_artifact_exists",
        status: "PASS",
        evidence: `Artifact record ${artifact.artifact_id} found (relative_path: ${artifact.relative_path})`
      });
      evidence.artifactRecord = {
        artifactId: artifact.artifact_id,
        relativePath: artifact.relative_path,
        contentHash: artifact.content_hash,
        sizeBytes: artifact.size_bytes
      };
    } else {
      checks.push({
        check: "persisted_artifact_exists",
        status: "FAIL",
        evidence: `No artifact record found for task ${taskId}`
      });
    }

    // 4. Artifact belongs to the same task ID
    if (artifact && artifact.task_id === taskId) {
      checks.push({
        check: "artifact_belongs_to_task",
        status: "PASS",
        evidence: `Artifact task_id (${artifact.task_id}) strictly matches current task (${taskId})`
      });
    } else {
      checks.push({
        check: "artifact_belongs_to_task",
        status: "FAIL",
        evidence: artifact ? `Artifact task_id (${artifact.task_id}) does not match current task (${taskId})` : "No artifact to check task ID association"
      });
    }

    // 5. Artifact can be read back from disk
    let diskBuffer: Buffer | null = null;
    if (artifact && artifact.disk_path && fs.existsSync(artifact.disk_path)) {
      try {
        diskBuffer = fs.readFileSync(artifact.disk_path);
        checks.push({
          check: "artifact_readable_from_disk",
          status: "PASS",
          evidence: `Artifact read from ${artifact.disk_path} (${diskBuffer.byteLength} bytes)`
        });
        evidence.diskReadBytes = diskBuffer.byteLength;
      } catch (readErr: any) {
        checks.push({
          check: "artifact_readable_from_disk",
          status: "FAIL",
          evidence: `Failed to read disk artifact: ${readErr?.message || String(readErr)}`
        });
      }
    } else {
      checks.push({
        check: "artifact_readable_from_disk",
        status: "FAIL",
        evidence: artifact ? `Artifact file does not exist on disk at path ${artifact.disk_path}` : "No artifact disk path specified"
      });
    }

    // 6. Artifact SHA-256 equals persisted artifact hash
    if (diskBuffer && artifact) {
      const computedHash = `sha256:${crypto.createHash('sha256').update(diskBuffer).digest('hex')}`;
      if (computedHash === artifact.content_hash) {
        checks.push({
          check: "artifact_hash_match",
          status: "PASS",
          evidence: `Disk content SHA-256 (${computedHash}) exactly matches persisted artifact record hash`
        });
        evidence.computedHash = computedHash;
        evidence.persistedHash = artifact.content_hash;
      } else {
        checks.push({
          check: "artifact_hash_match",
          status: "FAIL",
          evidence: `Disk content SHA-256 (${computedHash}) MISMATCH against persisted artifact record hash (${artifact.content_hash})`
        });
        evidence.computedHash = computedHash;
        evidence.persistedHash = artifact.content_hash;
      }
    } else {
      checks.push({
        check: "artifact_hash_match",
        status: "FAIL",
        evidence: "Cannot verify artifact content hash because disk reading failed or artifact record is missing"
      });
    }

    // 7. Status history contains TODO, READY, RUNNING, AWAITING_VERIFICATION in chronological order
    const historyStatuses = statusHistory.map(s => s.status);
    const requiredSequence = ["TODO", "READY", "RUNNING", "AWAITING_VERIFICATION"];
    
    let seqIdx = 0;
    for (const st of historyStatuses) {
      if (st === requiredSequence[seqIdx]) {
        seqIdx++;
        if (seqIdx === requiredSequence.length) {
          break;
        }
      }
    }

    if (seqIdx === requiredSequence.length) {
      checks.push({
        check: "status_history_sequence",
        status: "PASS",
        evidence: `Task transitioned through required statuses in chronological order: [${requiredSequence.join(" -> ")}]. Full history: [${historyStatuses.join(" -> ")}]`
      });
      evidence.statusHistory = historyStatuses;
    } else {
      checks.push({
        check: "status_history_sequence",
        status: "FAIL",
        evidence: `Status history violates required chronological sequence [${requiredSequence.join(" -> ")}]. Next expected status was '${requiredSequence[seqIdx]}'. Found history: [${historyStatuses.join(" -> ")}]`
      });
      evidence.statusHistory = historyStatuses;
    }

    // 8. PROVIDER_COMPLETED event exists
    if (providerCompletedEvent) {
      checks.push({
        check: "provider_completed_event_exists",
        status: "PASS",
        evidence: `PROVIDER_COMPLETED event ${providerCompletedEvent.event_id} verified in activity ledger`
      });
    } else {
      checks.push({
        check: "provider_completed_event_exists",
        status: "FAIL",
        evidence: "PROVIDER_COMPLETED activity event missing from ledger"
      });
    }

    // 9. ARTIFACT_SAVED event exists
    const artifactSavedEvent = activityEvents.find(e => e.event_type === "ARTIFACT_SAVED");
    if (artifactSavedEvent) {
      checks.push({
        check: "artifact_saved_event_exists",
        status: "PASS",
        evidence: `ARTIFACT_SAVED event ${artifactSavedEvent.event_id} verified in activity ledger`
      });
    } else {
      checks.push({
        check: "artifact_saved_event_exists",
        status: "FAIL",
        evidence: "ARTIFACT_SAVED activity event missing from ledger"
      });
    }

    // 10. Specific Deterministic Domain Checks for package version / metadata tasks
    const isPackageVersionTask = /package(\.json)?\s*(version|metadata|name)?|version\s+and\s+save/i.test(
      `${task.title || ''} ${task.description || ''}`
    );

    if (isPackageVersionTask) {
      let pkgMeta: PackageMetadataResult | null = null;
      try {
        pkgMeta = read_package_metadata();
      } catch {
        pkgMeta = null;
      }

      // Check: package_metadata_source_exists
      if (pkgMeta && fs.existsSync(pkgMeta.absolutePath)) {
        checks.push({
          check: "package_metadata_source_exists",
          status: "PASS",
          evidence: `Verified package.json exists at ${pkgMeta.absolutePath} (size: ${fs.statSync(pkgMeta.absolutePath).size} bytes)`
        });
      } else {
        checks.push({
          check: "package_metadata_source_exists",
          status: "FAIL",
          evidence: "package.json does not exist on disk or could not be read"
        });
      }

      // Check artifact text content
      const diskContentStr = diskBuffer ? diskBuffer.toString('utf8') : '';

      // Check: artifact_version_matches_package_json
      if (pkgMeta && diskContentStr.includes(pkgMeta.packageVersion)) {
        checks.push({
          check: "artifact_version_matches_package_json",
          status: "PASS",
          evidence: `Artifact correctly includes actual package version "${pkgMeta.packageVersion}" matching package.json`
        });
      } else {
        checks.push({
          check: "artifact_version_matches_package_json",
          status: "FAIL",
          evidence: pkgMeta ? `Artifact does not contain actual package version "${pkgMeta.packageVersion}"` : "Cannot verify package version"
        });
      }

      // Check: artifact_package_name_matches_package_json
      if (pkgMeta && diskContentStr.includes(pkgMeta.packageName)) {
        checks.push({
          check: "artifact_package_name_matches_package_json",
          status: "PASS",
          evidence: `Artifact correctly includes actual package name "${pkgMeta.packageName}" matching package.json`
        });
      } else {
        checks.push({
          check: "artifact_package_name_matches_package_json",
          status: "FAIL",
          evidence: pkgMeta ? `Artifact does not contain actual package name "${pkgMeta.packageName}"` : "Cannot verify package name"
        });
      }

      // Check: artifact_source_hash_matches_package_json
      if (pkgMeta && diskContentStr.includes(pkgMeta.sourceHash)) {
        checks.push({
          check: "artifact_source_hash_matches_package_json",
          status: "PASS",
          evidence: `Artifact correctly includes actual sourceHash "${pkgMeta.sourceHash}" matching package.json SHA-256`
        });
      } else {
        checks.push({
          check: "artifact_source_hash_matches_package_json",
          status: "FAIL",
          evidence: pkgMeta ? `Artifact does not contain actual sourceHash "${pkgMeta.sourceHash}"` : "Cannot verify package source hash"
        });
      }
    }

    // Decision logic
    const anyFailed = checks.some(c => c.status === "FAIL");
    if (!anyFailed) {
      return {
        decision: "VERIFIED",
        score: 100,
        reviewer,
        method,
        checks,
        evidence
      };
    } else {
      return {
        decision: "FAILED",
        score: null,
        reviewer,
        method,
        checks,
        evidence
      };
    }
  } catch (err: any) {
    return {
      decision: "INCONCLUSIVE",
      score: null,
      reviewer,
      method,
      checks,
      evidence: { exception: err?.message || String(err) }
    };
  }
}

// --------------------------------------------------------------------------
// Real Cryptographic Key Management & Ed25519 Signing / Verification
// --------------------------------------------------------------------------

export function getSigningKeyDir(): string {
  return process.env.SYNTHOS_SIGNING_KEY_DIR || path.join(process.cwd(), 'data', 'keys');
}

export function ensureSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string; fingerprint: string } {
  // Check secure environment variable overrides first (e.g. injected via Secret Manager / container runtime)
  if (process.env.SYNTHOS_SIGNING_PRIVATE_KEY_PEM && process.env.SYNTHOS_SIGNING_PUBLIC_KEY_PEM) {
    const privateKeyPem = process.env.SYNTHOS_SIGNING_PRIVATE_KEY_PEM.replace(/\\n/g, '\n');
    const publicKeyPem = process.env.SYNTHOS_SIGNING_PUBLIC_KEY_PEM.replace(/\\n/g, '\n');
    const fingerprint = `sha256:${crypto.createHash('sha256').update(publicKeyPem).digest('hex')}`;
    return { privateKeyPem, publicKeyPem, fingerprint };
  }

  const keyDir = getSigningKeyDir();
  const privPath = path.join(keyDir, 'ed25519_private.pem');
  const pubPath = path.join(keyDir, 'ed25519_public.pem');

  // If both exist on disk, read and reuse existing keys
  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    const privateKeyPem = fs.readFileSync(privPath, 'utf8');
    const publicKeyPem = fs.readFileSync(pubPath, 'utf8');
    const fingerprint = `sha256:${crypto.createHash('sha256').update(publicKeyPem).digest('hex')}`;
    return { privateKeyPem, publicKeyPem, fingerprint };
  }

  // Ensure keys directory exists
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }

  // Generate durable Ed25519 keypair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(privPath, privateKey, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(pubPath, publicKey, { encoding: 'utf8', mode: 0o644 });

  const fingerprint = `sha256:${crypto.createHash('sha256').update(publicKey).digest('hex')}`;
  return { privateKeyPem: privateKey, publicKeyPem: publicKey, fingerprint };
}

export function getSigningPublicKey(): { publicKeyPem: string; fingerprint: string; algorithm: string } {
  const { publicKeyPem, fingerprint } = ensureSigningKeyPair();
  return { publicKeyPem, fingerprint, algorithm: 'Ed25519' };
}

export function canonicalizePayload(payload: CanonicalReceiptPayload | Record<string, any>): string {
  const orderedKeys = Object.keys(payload).sort();
  const orderedObj: Record<string, any> = {};
  for (const key of orderedKeys) {
    orderedObj[key] = (payload as any)[key];
  }
  return JSON.stringify(orderedObj);
}

export function signReceiptPayload(canonicalPayloadStr: string): { 
  signature: string; 
  publicKeyPem: string; 
  algorithm: string; 
  fingerprint: string;
} {
  const { privateKeyPem, publicKeyPem, fingerprint } = ensureSigningKeyPair();
  const signatureBuffer = crypto.sign(null, Buffer.from(canonicalPayloadStr, 'utf8'), privateKeyPem);
  const signature = signatureBuffer.toString('hex');
  return {
    signature,
    publicKeyPem,
    algorithm: 'Ed25519',
    fingerprint
  };
}

export function verifyReceiptSignature(
  canonicalPayloadStr: string,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    const signatureBuffer = Buffer.from(signature, 'hex');
    return crypto.verify(
      null,
      Buffer.from(canonicalPayloadStr, 'utf8'),
      publicKeyPem,
      signatureBuffer
    );
  } catch {
    return false;
  }
}

export function verifyReceipt(receipt: {
  algorithm?: string;
  payload_json: string;
  signature: string;
  public_key: string;
}): boolean {
  try {
    const trustedKeyInfo = getSigningPublicKey();

    // 1. Confirm algorithm === "Ed25519"
    if (receipt.algorithm !== 'Ed25519') {
      return false;
    }

    // 2. Confirm receipt.public_key exactly matches the trusted SynthOS public key
    const cleanReceiptKey = (receipt.public_key || '').trim().replace(/\r\n/g, '\n');
    const cleanTrustedKey = (trustedKeyInfo.publicKeyPem || '').trim().replace(/\r\n/g, '\n');
    if (!cleanReceiptKey || cleanReceiptKey !== cleanTrustedKey) {
      return false;
    }

    // 3. Cryptographically verify signature using trusted SynthOS public key
    return verifyReceiptSignature(
      receipt.payload_json,
      receipt.signature,
      trustedKeyInfo.publicKeyPem
    );
  } catch {
    return false;
  }
}

export function recordReceipt(params: {
  receiptId?: string;
  taskId: string;
  reviewId: string;
  algorithm: string;
  publicKey: string;
  payloadJson: string;
  signature: string;
  createdAt?: string;
}): ReceiptRecord {
  const db = getDatabase();
  const receiptId = params.receiptId || `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const nowIso = params.createdAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO receipts (receipt_id, task_id, review_id, algorithm, public_key, payload_json, signature, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receiptId,
    params.taskId,
    params.reviewId,
    params.algorithm,
    params.publicKey,
    params.payloadJson,
    params.signature,
    nowIso
  );

  return {
    receipt_id: receiptId,
    task_id: params.taskId,
    review_id: params.reviewId,
    algorithm: params.algorithm,
    public_key: params.publicKey,
    payload_json: params.payloadJson,
    signature: params.signature,
    created_at: nowIso
  };
}

export function getTaskReceipts(taskId: string): ReceiptRecord[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM receipts WHERE task_id = ? ORDER BY created_at ASC
  `).all(taskId);
  return rows as ReceiptRecord[];
}

// ---------------------------------------------------------------------------
// Knowledge Intelligence Layer (KIL) persistence.
//
// Migrated from the real, shipped implementation at
// ~/synthos/mission-control/src/lib/synthos-kil-observations.ts. Scoring
// itself lives in lib/kil.ts as pure functions (also a direct port); this
// module is the only accessor for what those functions decided.
//
// The one rule, carried forward unchanged from the source: every read and
// every write is filtered by workspace_id. There is no unscoped variant here
// and none should be added — matches the same discipline already enforced
// on tasks/activity/receipts elsewhere in this file.
// ---------------------------------------------------------------------------

export interface KilObservationRecord {
  observation_id: string;
  workspace_id: string;
  task_id: string | null;
  agent_id: string | null;
  /** V(K): 1 when every blocking safety check passed. */
  verification: number;
  /** E(K): mean of the five continuous quality vectors. */
  evidence: number;
  /** F(K): the computed track-record score, not the raw attempt count. */
  frequency: number;
  attempts: number;
  confidence: number;
  promoted: number;
  promotion_threshold: number;
  quality_floor: number;
  checks_json: string | null;
  created_at: string;
}

/**
 * Score one verification and write the observation. Returns what was decided.
 *
 * Promotion requires BOTH the confidence bar and the quality floor: a long
 * track record cannot buy promotion for structurally incomplete work.
 */
export function recordKilObservation(params: {
  workspaceId: string;
  taskId?: string | null;
  agentId?: string | null;
  checks: KilCheckResults;
  attempts: number;
}): KilObservationRecord {
  const db = getDatabase();
  const evidence = evidenceQuality(params.checks);
  const confidence = calculateKilConfidence({ checks: params.checks, attempts: params.attempts });
  const promoted = isPromoted(confidence, evidence);
  const observationId = `kil-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO kil_observations (
      observation_id, workspace_id, task_id, agent_id, verification, evidence, frequency,
      attempts, confidence, promoted, promotion_threshold, quality_floor, checks_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    observationId,
    params.workspaceId,
    params.taskId ?? null,
    params.agentId ?? null,
    verificationGate(params.checks),
    evidence,
    trackRecord(params.attempts),
    Math.max(0, Math.floor(params.attempts)),
    confidence,
    promoted ? 1 : 0,
    PROMOTION_THRESHOLD,
    QUALITY_FLOOR,
    JSON.stringify(params.checks),
    now
  );

  return db.prepare('SELECT * FROM kil_observations WHERE observation_id = ? AND workspace_id = ?')
    .get(observationId, params.workspaceId) as KilObservationRecord;
}

export interface ListKilObservationsOptions {
  promotedOnly?: boolean;
  taskId?: string;
  limit?: number;
}

/** Most recent first. */
export function listKilObservations(
  workspaceId: string,
  options: ListKilObservationsOptions = {}
): KilObservationRecord[] {
  const db = getDatabase();
  const clauses = ['workspace_id = ?'];
  const params: any[] = [workspaceId];

  if (options.promotedOnly) clauses.push('promoted = 1');
  if (options.taskId) {
    clauses.push('task_id = ?');
    params.push(options.taskId);
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const rows = db.prepare(
    `SELECT * FROM kil_observations WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit);
  return rows as KilObservationRecord[];
}

export interface KilSummary {
  total: number;
  promoted: number;
  blocked: number;
  /** Share promoted, 0-1. Null when nothing has been observed. */
  promotionRate: number | null;
  /** Mean E(K). Null when nothing has been observed. */
  averageEvidence: number | null;
}

export function summariseKil(workspaceId: string): KilSummary {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN promoted = 1 THEN 1 ELSE 0 END) AS promoted,
      SUM(CASE WHEN verification = 0 THEN 1 ELSE 0 END) AS blocked,
      AVG(evidence) AS avg_evidence
    FROM kil_observations WHERE workspace_id = ?
  `).get(workspaceId) as { total: number | null; promoted: number | null; blocked: number | null; avg_evidence: number | null } | undefined;

  const total = row?.total ?? 0;
  const promoted = row?.promoted ?? 0;
  return {
    total,
    promoted,
    blocked: row?.blocked ?? 0,
    // No observations means unknown, not zero.
    promotionRate: total > 0 ? promoted / total : null,
    averageEvidence: total > 0 ? (row?.avg_evidence ?? null) : null,
  };
}

/**
 * An agent's prior attempts, for F(K). Counts this workspace's observations
 * only — a track record earned for one client does not transfer to another.
 */
export function kilAgentAttempts(workspaceId: string, agentId: string): number {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM kil_observations WHERE workspace_id = ? AND agent_id = ?'
  ).get(workspaceId, agentId) as { n: number | null } | undefined;
  return row?.n ?? 0;
}

/**
 * The most recent observation for a task, scoped to the workspace. Null when
 * the task has never been through the gate.
 */
export function latestKilObservationForTask(workspaceId: string, taskId: string): KilObservationRecord | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT * FROM kil_observations WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(workspaceId, taskId);
  return (row as KilObservationRecord) || null;
}

// ---------------------------------------------------------------------------
// Verified knowledge candidate projection.
//
// Migrated from ~/synthos/mission-control/src/lib/synthos-verified-knowledge.ts,
// narrowed to what this repo's schema can actually back. The source table
// also FKs to mission_id, graph_run_id and activity_id; this repo has no
// "mission" concept above a task, and its graph_runs/activity_events are not
// linked to a task the way the source schema assumes. This preserves the
// three-way check that DOES map onto real rows here (task + verified KIL
// observation + receipt, all in the same workspace) rather than inventing
// the other relationships. That is a narrower provenance guarantee than the
// source's four-way check — reported here, not hidden.
// ---------------------------------------------------------------------------

export interface KnowledgeCandidateRecord {
  candidate_id: string;
  workspace_id: string;
  candidate_key: string;
  label: string;
  task_id: string;
  kil_observation_id: string;
  receipt_id: string;
  vault_path: string;
  verification_state: 'verified' | 'failed';
  promotion_state: 'pending' | 'promoted' | 'rejected';
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

function isValidVaultPath(value: string): boolean {
  return value.length > 0 && !value.startsWith('/') && !value.split('/').includes('..');
}

/**
 * Idempotently projects one verified KIL observation + receipt into a
 * workspace-scoped knowledge candidate. Throws if the task, a verified KIL
 * observation for it, or a receipt for it cannot be found in this workspace
 * — a candidate must be backed by real rows, never invented ones.
 */
export function projectKnowledgeCandidate(params: {
  workspaceId: string;
  taskId: string;
  kilObservationId: string;
  receiptId: string;
  vaultPath: string;
  label: string;
}): { candidate: KnowledgeCandidateRecord; created: boolean } {
  const db = getDatabase();
  const label = params.label.trim();
  if (!label) throw new Error('label is required');
  if (!isValidVaultPath(params.vaultPath)) throw new Error('vaultPath must be a workspace-relative path');

  const task = db.prepare('SELECT task_id FROM tasks WHERE task_id = ? AND workspace_id = ?')
    .get(params.taskId, params.workspaceId);
  if (!task) throw new Error('Task does not belong to this workspace');

  const observation = db.prepare(
    'SELECT observation_id FROM kil_observations WHERE observation_id = ? AND workspace_id = ? AND task_id = ? AND verification = 1'
  ).get(params.kilObservationId, params.workspaceId, params.taskId);
  if (!observation) throw new Error('Verified KIL observation was not found in this workspace for this task');

  const receipt = db.prepare(`
    SELECT r.receipt_id FROM receipts r
    JOIN tasks t ON t.task_id = r.task_id
    WHERE r.receipt_id = ? AND r.task_id = ? AND t.workspace_id = ?
  `).get(params.receiptId, params.taskId, params.workspaceId);
  if (!receipt) throw new Error('Receipt was not found in this workspace for this task');

  // Same identity as the source's candidateKey(): repeat projection of the
  // same evidence is a no-op, not a duplicate row.
  const candidateKey = [params.taskId, params.kilObservationId, params.receiptId, params.vaultPath].join(':');
  const existing = db.prepare('SELECT * FROM knowledge_candidates WHERE workspace_id = ? AND candidate_key = ?')
    .get(params.workspaceId, candidateKey);
  if (existing) return { candidate: existing as KnowledgeCandidateRecord, created: false };

  const candidateId = `kc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO knowledge_candidates (
      candidate_id, workspace_id, candidate_key, label, task_id, kil_observation_id,
      receipt_id, vault_path, verification_state, promotion_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', 'pending', ?, ?)
  `).run(
    candidateId, params.workspaceId, candidateKey, label, params.taskId,
    params.kilObservationId, params.receiptId, params.vaultPath, now, now
  );

  const row = db.prepare('SELECT * FROM knowledge_candidates WHERE candidate_id = ? AND workspace_id = ?')
    .get(candidateId, params.workspaceId);
  return { candidate: row as KnowledgeCandidateRecord, created: true };
}

export function getKnowledgeCandidate(workspaceId: string, candidateId: string): KnowledgeCandidateRecord | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM knowledge_candidates WHERE candidate_id = ? AND workspace_id = ?')
    .get(candidateId, workspaceId);
  return (row as KnowledgeCandidateRecord) || null;
}

export function listWorkspaceKnowledgeCandidates(workspaceId: string, limit = 50): KnowledgeCandidateRecord[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM knowledge_candidates WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, Math.min(Math.max(limit, 1), 500));
  return rows as KnowledgeCandidateRecord[];
}

