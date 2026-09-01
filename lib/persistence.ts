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

export interface AegisCheckResult {
  check: string;
  status: 'PASS' | 'FAIL';
  evidence: string;
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
    `);
  }
  return dbInstance;
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

    // 7. Status history contains TODO, READY, RUNNING, AWAITING_VERIFICATION
    const historyStatuses = statusHistory.map(s => s.status);
    const requiredStatuses = ["TODO", "READY", "RUNNING", "AWAITING_VERIFICATION"];
    const missingStatuses = requiredStatuses.filter(st => !historyStatuses.includes(st));
    if (missingStatuses.length === 0) {
      checks.push({
        check: "status_history_sequence",
        status: "PASS",
        evidence: `Task transitioned through all required statuses: [${historyStatuses.join(" -> ")}]`
      });
      evidence.statusHistory = historyStatuses;
    } else {
      checks.push({
        check: "status_history_sequence",
        status: "FAIL",
        evidence: `Status history missing required states: [${missingStatuses.join(", ")}]. Found: [${historyStatuses.join(", ")}]`
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
