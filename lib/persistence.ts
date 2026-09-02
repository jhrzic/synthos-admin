import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';

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
        status TEXT NOT NULL,
        current_node_id TEXT,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  return dbInstance;
}

export function saveGraph(params: {
  graphId: string;
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

  const existing = db.prepare('SELECT graph_id FROM graphs WHERE graph_id = ?').get(params.graphId);
  if (existing) {
    db.prepare(`
      UPDATE graphs 
      SET name = ?, description = ?, nodes_json = ?, edges_json = ?, updated_at = ?
      WHERE graph_id = ?
    `).run(params.name, desc, nodesJson, edgesJson, now, params.graphId);
  } else {
    db.prepare(`
      INSERT INTO graphs (graph_id, name, description, nodes_json, edges_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(params.graphId, params.name, desc, nodesJson, edgesJson, now, now);
  }

  return {
    graph_id: params.graphId,
    name: params.name,
    description: desc,
    nodes_json: nodesJson,
    edges_json: edgesJson,
    created_at: now,
    updated_at: now
  };
}

export function getGraph(graphId: string): GraphRecord | null {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graphs WHERE graph_id = ?').get(graphId) as GraphRecord) || null;
}

export function listGraphs(): GraphRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graphs ORDER BY updated_at DESC').all() as GraphRecord[]) || [];
}

export function saveGraphRun(params: {
  runId: string;
  graphId: string;
  status: string;
  currentNodeId?: string | null;
  state?: any;
}): GraphRunRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const stateJson = JSON.stringify(params.state || {});
  const currentNodeId = params.currentNodeId || null;

  const existing = db.prepare('SELECT run_id FROM graph_runs WHERE run_id = ?').get(params.runId);
  if (existing) {
    db.prepare(`
      UPDATE graph_runs 
      SET status = ?, current_node_id = ?, state_json = ?, updated_at = ?
      WHERE run_id = ?
    `).run(params.status, currentNodeId, stateJson, now, params.runId);
  } else {
    db.prepare(`
      INSERT INTO graph_runs (run_id, graph_id, status, current_node_id, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(params.runId, params.graphId, params.status, currentNodeId, stateJson, now, now);
  }

  return {
    run_id: params.runId,
    graph_id: params.graphId,
    status: params.status,
    current_node_id: currentNodeId,
    state_json: stateJson,
    created_at: now,
    updated_at: now
  };
}

export function getGraphRun(runId: string): GraphRunRecord | null {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graph_runs WHERE run_id = ?').get(runId) as GraphRunRecord) || null;
}

export function listGraphRuns(): GraphRunRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM graph_runs ORDER BY updated_at DESC').all() as GraphRunRecord[]) || [];
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

