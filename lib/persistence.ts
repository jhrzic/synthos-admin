import fs from 'node:fs';
import { RECEIPT_SIGNING_ALGORITHM, receiptAlgorithmLabel } from './receipt-algorithm';
export { RECEIPT_SIGNING_ALGORITHM, receiptAlgorithmLabel };
import { appendReceiptToLedger } from './authority-ledger';
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
  /**
   * What the task's outcome was, stated in the signed payload so a receipt
   * can never be read as "completed" when content verification failed.
   * Absent on receipts signed before this field existed.
   */
  outcome?: 'COMPLETED' | 'INCOMPLETE' | 'VERIFICATION_FAILED' | 'INTEGRITY_FAILED';
  /** Exactly which verification scopes this receipt attests to, e.g. "integrity=PASS; completion=FAIL; …". */
  verificationScope?: string;
  /**
   * REGISTRY IDENTITY — the canonical provider and model the task selected,
   * resolved once and propagated unchanged (never an alias). `modelUsed` is
   * what the provider reported back; these are what SynthOS asked for.
   * Absent on receipts signed before the registry existed.
   */
  registryProviderId?: string;
  canonicalModelId?: string;
  /** The immutable price version the spend guard reserved against, and that ledger row. */
  priceVersion?: string | null;
  usageId?: string | null;
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

/** The one production database path, relative to the repository root. */
const PRODUCTION_DB_RELATIVE = path.join('data', 'synthos-admin.db');

/**
 * Explicit, deliberately awkward opt-in for the rare integration test that
 * genuinely must touch the production database. Nothing sets this today.
 */
export const PRODUCTION_DB_TEST_OVERRIDE = 'SYNTHOS_ALLOW_PRODUCTION_DB_IN_TEST';

function isTestRuntime(): boolean {
  return !!process.env.VITEST || process.env.NODE_ENV === 'test';
}

/**
 * Resolve the database path, refusing the production database under test.
 *
 * WHY THIS GUARD EXISTS
 * The fallback branch below is a development convenience, not a sandbox. A test
 * that touches persistence without setting SYNTHOS_DB_PATH resolved straight to
 * the operator's real database — and that is not hypothetical: a pre-isolation
 * run of the concierge acceptance tests left three fixture workspaces
 * ("Alder Dental", "Brightwater Plumbing", "Isolation Test Workspace") with 78
 * dependent rows in the live database, where they rendered in the production
 * sidebar as real client workspaces.
 *
 * The vault had the same class of leak and got a guard (test/helpers/
 * isolated-vault.ts). This is the database equivalent, and it is enforced HERE
 * rather than in each test, because 49 of 112 test files did not set the
 * variable and relying on every future test to remember is how this happened.
 *
 * Throwing is deliberate. A test that trips this fails loudly with the reason,
 * instead of silently writing rows a human later has to identify and prove.
 */
export function getDatabasePath(): string {
  const resolved = process.env.SYNTHOS_DB_PATH || path.join(process.cwd(), PRODUCTION_DB_RELATIVE);

  if (isTestRuntime() && !process.env[PRODUCTION_DB_TEST_OVERRIDE]) {
    const absolute = path.resolve(resolved);
    const production = path.resolve(process.cwd(), PRODUCTION_DB_RELATIVE);
    if (absolute === production) {
      throw new Error(
        'Refusing to open the production database from a test run. '
        + `Resolved "${absolute}", which is the production database. `
        + 'Set SYNTHOS_DB_PATH to an isolated temporary file (test/setup/isolate-database.ts '
        + `does this automatically), or set ${PRODUCTION_DB_TEST_OVERRIDE}=1 for a test that `
        + 'genuinely intends to touch production data.',
      );
    }
  }

  return resolved;
}

let dbInstance: any = null;

/**
 * Close the process's SQLite handle cleanly, checkpointing the WAL first.
 *
 * Added for the production graceful-shutdown path (server.ts). Without it, a
 * container SIGTERM kills the process mid-WAL: the database stays correct
 * (that is what WAL is for) but the `-wal` sidecar is left holding committed
 * pages that have never been folded back into the main file. That is not
 * hypothetical here — this repo's own working copy carries a 4MB
 * `synthos-admin.db-wal` against a 1.3MB `synthos-admin.db`, which is exactly
 * the shape a series of abrupt kills produces.
 *
 * `wal_checkpoint(TRUNCATE)` folds the WAL back and resets it to zero length.
 * It is attempted, never required: a checkpoint that cannot complete (a reader
 * still open, a read-only mount) must not stop the process from exiting, so
 * the failure is reported and shutdown continues. Returns true only if the
 * handle was really open and really closed.
 */
export function closeDatabase(): boolean {
  if (!dbInstance) return false;
  const handle = dbInstance;
  // Clear the module handle first, so anything racing us on the way down
  // opens a fresh connection rather than using one we are about to close.
  dbInstance = null;
  try {
    handle.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.error(`[Shutdown] WAL checkpoint failed (continuing): ${(err as Error).message}`);
  }
  try {
    handle.close();
    return true;
  } catch (err) {
    console.error(`[Shutdown] Database close failed: ${(err as Error).message}`);
    return false;
  }
}

export function getDatabase(): any {
  if (!dbInstance) {
    const dbPath = getDatabasePath();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new DatabaseSync(dbPath);

    // Pass VIII / Workstream Q — real production-safety PRAGMAs, applied
    // once per process on first open, before any table exists.
    //   WAL: readers no longer block writers (and vice versa) — the
    //     default rollback-journal mode locks the whole file for the
    //     duration of a write, which is a real contention risk once more
    //     than one request is touching the DB concurrently (this app is
    //     single-process, but Node's event loop still interleaves many
    //     in-flight requests' DB calls).
    //   busy_timeout: a writer that finds the DB briefly locked retries for
    //     up to 5s instead of throwing SQLITE_BUSY immediately.
    //   synchronous = NORMAL: the standard safe pairing with WAL (still
    //     durable against an application crash; only a full OS-level power
    //     loss during the narrow WAL-checkpoint window is a residual risk,
    //     an already-accepted tradeoff for every WAL-mode SQLite deployment).
    //   foreign_keys = ON: this schema uses few hard FK constraints today,
    //     but turning enforcement on is free and correct — any that do
    //     exist should actually be enforced, not silently inert.
    dbInstance.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);

    // SCHEMA VERSION — fail closed BEFORE touching the schema if the database
    // was written by newer code than this build supports.
    const onDisk = Number((dbInstance.prepare('PRAGMA user_version').get() as any)?.user_version ?? 0);
    if (onDisk > SCHEMA_VERSION) {
      const bad = dbInstance;
      dbInstance = null;
      try { bad.close(); } catch { /* already closed */ }
      throw new SchemaVersionUnsupportedError(onDisk, SCHEMA_VERSION, dbPath);
    }

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
        updated_at TEXT,
        -- NO-COPY/PASTE ORCHESTRATION.
        --
        -- These three columns let a QUEUED task say what it is, so the
        -- orchestrator can carry it forward without a human restating the
        -- request in another runtime.
        --
        -- They are added to THIS table rather than to a new one on purpose.
        -- The instruction was not to create a second queue, and canonical
        -- tasks already carry workspace, status, lifecycle history, activity
        -- events, artifacts and receipts. A parallel "orchestration_tasks"
        -- table would have duplicated every one of those and then had to be
        -- kept in step with them.
        --
        -- capability      NULL  -> a model task: the kernel runs it on the
        --                          router-selected provider.
        --                 set   -> a tool task: dispatched through
        --                          lib/fabric/envelope.ts by capability id.
        -- parameters_json       the tool's bounded inputs. Never a shell
        --                       string, never code — the envelope resolves the
        --                       capability from the registry, so a task cannot
        --                       name an executor that does not exist.
        -- autonomy_eligible     whether the orchestrator may pick this task up
        --                       unattended. Defaults to 0 so that every task
        --                       created by existing code paths stays manual,
        --                       and autonomy is something a caller opts into.
        capability TEXT,
        parameters_json TEXT,
        autonomy_eligible INTEGER NOT NULL DEFAULT 0
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
        created_at TEXT NOT NULL,
        -- ACTIVE: may enter searchable memory. QUARANTINED: kept as evidence
        -- (file, hash, receipts, events untouched) but never indexed.
        retrieval_status TEXT NOT NULL DEFAULT 'ACTIVE',
        retrieval_status_reason TEXT,
        retrieval_status_at TEXT
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

      -- STEP 6 concurrent-idempotency corrective pass. The real defect: the
      -- old check (lib/fabric/envelope.ts's checkIdempotentTask) only ever
      -- READ task state, and the first durable WRITE of that state
      -- (createInitialTask, called only after the real GitHub/Gemini/Vault
      -- work already completed) happened too late to stop truly concurrent
      -- duplicates — a proven live defect (three simultaneous requests with
      -- the same idempotency key produced three real artifacts/receipts).
      --
      -- This table is the atomic claim: a real INSERT guarded by the UNIQUE
      -- constraint below, attempted BEFORE any expensive/side-effectful
      -- call. SQLite's own constraint enforcement is the source of truth —
      -- there is no SELECT-then-INSERT window (see acquireExecutionClaim).
      -- workspace_id leads the UNIQUE tuple so no claim can ever cross a
      -- workspace boundary.
      -- APPROVAL FOUNDATION (prerequisite for Tool Pack 2 / Gmail).
      --
      -- WHY A TABLE AND NOT runtime_events.detail_json:
      -- An approval is not an observation, it is authority with a lifecycle.
      -- Three things it must do are impossible inside an append-only JSON blob:
      --
      --   1. BE QUERIED. The approval queue asks "what is PENDING in this
      --      workspace" on every page load. That is an indexed lookup, not a
      --      scan-and-parse over an event ring that prunes itself.
      --   2. BE CONSUMED ATOMICALLY. Single-use is enforced by
      --      UPDATE ... WHERE status = 'APPROVED' and checking the row count,
      --      so two concurrent dispatches cannot both spend one approval. That
      --      needs a real column with a real constraint.
      --   3. NOT BE PRUNED. runtime_events is a bounded ring (5,000 soft cap);
      --      an authority record that vanishes when the ledger rolls over is
      --      not an audit trail.
      --
      -- Evidence about approvals still flows to activity_events/runtime_events.
      -- This table holds the DECISION; those hold the history. One fact, one
      -- home, cross-referenced by correlation_id.
      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        -- The task this gates, when there is one. Nullable because an approval
        -- can be requested before a task row exists.
        task_id TEXT,
        -- The join key into every other ledger for this unit of work.
        correlation_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        action TEXT NOT NULL,
        effect_class TEXT NOT NULL,
        -- Requester and decider are deliberately separate columns so that
        -- "the requester approved their own request" is a query, not a guess.
        requested_by_user_id TEXT NOT NULL,
        decided_by_user_id TEXT,
        -- Guardian's independent verdict, recorded at request time. Human
        -- approval never overwrites it.
        guardian_decision TEXT NOT NULL,
        guardian_citation TEXT,
        -- Bounded, human-readable. Never a raw provider payload, never a secret.
        action_summary TEXT NOT NULL,
        -- THE BINDING. Approval is valid only for inputs hashing to this.
        input_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED')),
        decision_reason TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        expires_at TEXT,
        consumed_at TEXT,
        consumed_by_task_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_queue ON approvals(workspace_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_binding ON approvals(workspace_id, capability, input_digest, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_correlation ON approvals(correlation_id);

      CREATE TABLE IF NOT EXISTS execution_claims (
        claim_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('CLAIMED', 'DONE', 'FAILED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, actor_user_id, capability, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_execution_claims_task ON execution_claims(task_id);

      -- STEP 7 — the canonical schedule model. The scheduler only decides
      -- WHEN to invoke; capability/action/parameters/raw_text are handed
      -- verbatim to executeEnvelope() (lib/fabric/scheduler.ts) exactly as
      -- Jarvis's own direct path builds one — this table stores what to run
      -- later, never how to run it.
      CREATE TABLE IF NOT EXISTS schedules (
        schedule_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        action TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        raw_text TEXT NOT NULL,
        recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('ONCE', 'INTERVAL')),
        interval_seconds INTEGER,
        next_run_at TEXT,
        last_run_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'BLOCKED', 'NOT_CONFIGURED', 'CANCELLED')),
        status_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_workspace ON schedules(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(status, next_run_at);

      -- One row per real, resolved occurrence (never a duplicate — see
      -- recordScheduleOccurrence's upsert-by-(schedule_id,due_at)). This is
      -- pure bookkeeping/history, not a second idempotency mechanism: the
      -- actual duplicate-execution guard is execution_claims, reached via
      -- the identical idempotency_key stored here for traceability.
      CREATE TABLE IF NOT EXISTS schedule_occurrences (
        occurrence_id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        due_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'NOT_CONFIGURED')),
        outcome TEXT NOT NULL,
        reason TEXT,
        task_id TEXT,
        artifact_id TEXT,
        receipt_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (schedule_id, due_at)
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_occurrences_schedule ON schedule_occurrences(schedule_id);

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

    // Stale-claim reconciliation — see reconcileStaleExecutionClaims below
    // for what this does and why it's sufficient for this deployment.
    reconcileStaleExecutionClaims();

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

    // Jarvis sessions predate identity (Pass II). A session's owner is
    // nullable — a legacy pre-auth session has no owner and is visible to
    // no one under the new authorization layer (never silently reassigned
    // to whichever user happens to ask). New sessions always carry a real
    // owning user_id (see createJarvisSession in lib/jarvis-sessions.ts).
    const jarvisSessionCols = dbInstance.prepare("PRAGMA table_info(jarvis_sessions)").all() as Array<{ name: string }>;
    if (!jarvisSessionCols.some((c) => c.name === 'user_id')) {
      dbInstance.exec("ALTER TABLE jarvis_sessions ADD COLUMN user_id TEXT");
    }

    // ---------------------------------------------------------------------
    // Identity & authorization (Pass III). Real, minimal, server-side.
    // See lib/auth.ts (password/session mechanics) and
    // lib/authorization.ts (the requireX() helpers routes call). No secret
    // ever lives here in recoverable form: password_hash is a scrypt
    // digest, user_sessions.token_hash is a sha256 of the raw session
    // token — the raw token itself is never persisted, only ever handed to
    // the client as an HttpOnly cookie value.
    // ---------------------------------------------------------------------

    // Workspaces did not exist as a real, listable entity before this pass
    // — workspace_id was a bare string nobody validated against a
    // canonical list. workspace_memberships below needs something real to
    // reference.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        platform_role TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

      -- The ONE canonical membership relation (deliberately not a second
      -- "workspace_members" table alongside this one — see B1).
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, workspace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace ON workspace_memberships(workspace_id);
    `);

    // Pass IV — one-time account setup tokens (second-user onboarding, no
    // email infrastructure exists in this codebase, so this is the real
    // delivery mechanism: a link the platform admin copies and hands to the
    // new user out of band). Only the hash is ever stored; the raw token is
    // returned exactly once, at creation.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS setup_tokens (
        token_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_setup_tokens_user ON setup_tokens(user_id);
    `);

    // Pass IV — real audit trail for authority-changing admin actions. Not
    // a general-purpose activity log: `activity_events` (above) has a
    // NOT NULL task_id and is genuinely task-execution-scoped, with its
    // only reader (getTaskActivityEvents) task-scoped — forcing a "user
    // disabled" event through it would mean fabricating a fake task_id.
    // This is a small, purpose-built table for exactly one thing (who
    // changed what authority, when), matching this codebase's existing
    // pattern of separate small tables per real need rather than one
    // universal log (skill_test_events, kil_observations, etc.).
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit_events (
        event_id TEXT PRIMARY KEY,
        actor_user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created ON admin_audit_events(created_at);
    `);

    // Pass V — a skill's execution target. Deliberately absent (NULL) on
    // every pre-existing skill and on every new skill by default: a skill
    // being REGISTERED/ENABLED never implies it is EXECUTABLE (see
    // lib/skills.ts classifySkillExecutability). `execution_target_ref`'s
    // meaning depends on `execution_target_type` — a model alias, a
    // deterministic action key from a fixed whitelist, or an MCP tool name
    // (the MCP endpoint itself is the pre-existing `source_ref`).
    // `credential_ciphertext` is AES-256-GCM at rest (lib/mcp-client.ts) —
    // never plaintext, never returned by any route (see F2's own
    // SECURITY_LIMITATION note in docs/adr-005 for what this does and does
    // not protect against).
    // Restart reconciliation for external executions. Added as a migration as
    // well as in the CREATE TABLE above because databases exist in both
    // states: the developer's live database already had these columns (added
    // out-of-band), while a fresh install created from the CREATE TABLE did
    // not have them at all. Both paths converge here.
    // Artifact retrieval status (see the CREATE TABLE). Existing installs gain
    // the columns; every existing artifact starts ACTIVE, as it effectively was.
    const artifactCols = dbInstance.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>;
    if (artifactCols.length > 0 && !artifactCols.some((c) => c.name === 'retrieval_status')) {
      dbInstance.exec("ALTER TABLE artifacts ADD COLUMN retrieval_status TEXT NOT NULL DEFAULT 'ACTIVE'");
      dbInstance.exec("ALTER TABLE artifacts ADD COLUMN retrieval_status_reason TEXT");
      dbInstance.exec("ALTER TABLE artifacts ADD COLUMN retrieval_status_at TEXT");
    }
    const externalExecCols = dbInstance.prepare("PRAGMA table_info(external_executions)").all() as Array<{ name: string }>;
    if (externalExecCols.length > 0 && !externalExecCols.some((c) => c.name === 'next_poll_at')) {
      dbInstance.exec("ALTER TABLE external_executions ADD COLUMN next_poll_at TEXT");
    }
    if (externalExecCols.length > 0 && !externalExecCols.some((c) => c.name === 'poll_attempts')) {
      dbInstance.exec("ALTER TABLE external_executions ADD COLUMN poll_attempts INTEGER NOT NULL DEFAULT 0");
    }
    // ONE POLLER, ONE MEANING FOR NULL. Two sweeps used to share these
    // columns: the old reconciliation sweep read next_poll_at NULL as "due
    // now", the durable sweep (lib/external-executions.ts) reads it as
    // "stopped for good". Only the durable sweep remains, so a row written
    // under the old meaning — in flight, never stopped on purpose — is made
    // due once here instead of being stranded. Every deliberate stop sets a
    // terminal status or an error_code, so this cannot restart one, and it is
    // a no-op on every run after the first.
    if (externalExecCols.length > 0) {
      dbInstance.exec(`
        UPDATE external_executions
           SET next_poll_at = COALESCE(last_checked_at, updated_at, created_at)
         WHERE next_poll_at IS NULL
           AND remote_job_id IS NOT NULL
           AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
           AND error_code IS NULL
      `);
    }

    // NO-COPY/PASTE ORCHESTRATION — additive task columns. Same
    // check-then-ALTER pattern used above, so an existing database gains them
    // without a rebuild and a fresh one gets them from the CREATE TABLE.
    const taskCols = dbInstance.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (taskCols.length > 0 && !taskCols.some((c) => c.name === 'capability')) {
      dbInstance.exec("ALTER TABLE tasks ADD COLUMN capability TEXT");
    }
    if (taskCols.length > 0 && !taskCols.some((c) => c.name === 'parameters_json')) {
      dbInstance.exec("ALTER TABLE tasks ADD COLUMN parameters_json TEXT");
    }
    if (taskCols.length > 0 && !taskCols.some((c) => c.name === 'autonomy_eligible')) {
      // DEFAULT 0: every task that already exists stays manual. Autonomy is
      // opted into, never inherited by rows written before it existed.
      dbInstance.exec("ALTER TABLE tasks ADD COLUMN autonomy_eligible INTEGER NOT NULL DEFAULT 0");
    }

    const skillCols = dbInstance.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>;
    if (!skillCols.some((c) => c.name === 'execution_target_type')) {
      dbInstance.exec("ALTER TABLE skills ADD COLUMN execution_target_type TEXT");
    }
    if (!skillCols.some((c) => c.name === 'execution_target_ref')) {
      dbInstance.exec("ALTER TABLE skills ADD COLUMN execution_target_ref TEXT");
    }
    if (!skillCols.some((c) => c.name === 'credential_ciphertext')) {
      dbInstance.exec("ALTER TABLE skills ADD COLUMN credential_ciphertext TEXT");
    }

    // Business Conversation AI — the public assistant key. Added as a
    // migration as well as in the CREATE TABLE because an install that ran
    // an earlier build of this branch already has the table without it.
    const bapCols = dbInstance.prepare("PRAGMA table_info(business_assistant_profiles)").all() as Array<{ name: string }>;
    if (bapCols.length > 0 && !bapCols.some((c) => c.name === 'public_key')) {
      dbInstance.exec("ALTER TABLE business_assistant_profiles ADD COLUMN public_key TEXT");
    }
    if (bapCols.length > 0 && !bapCols.some((c) => c.name === 'published')) {
      dbInstance.exec("ALTER TABLE business_assistant_profiles ADD COLUMN published INTEGER NOT NULL DEFAULT 0");
    }
    if (bapCols.length > 0 && !bapCols.some((c) => c.name === 'allowed_origins_json')) {
      dbInstance.exec("ALTER TABLE business_assistant_profiles ADD COLUMN allowed_origins_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (bapCols.length > 0 && !bapCols.some((c) => c.name === 'voice_reference_id')) {
      dbInstance.exec("ALTER TABLE business_assistant_profiles ADD COLUMN voice_reference_id TEXT");
    }
    if (bapCols.length > 0 && !bapCols.some((c) => c.name === 'voice_enabled')) {
      dbInstance.exec("ALTER TABLE business_assistant_profiles ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 1");
    }

    // PUSH 2C — development task kind + structured evidence, added as a
    // migration as well as in the CREATE TABLE for installs from earlier
    // builds of this branch.
    const devTaskCols = dbInstance.prepare("PRAGMA table_info(development_tasks)").all() as Array<{ name: string }>;
    if (devTaskCols.length > 0 && !devTaskCols.some((c) => c.name === 'task_kind')) {
      dbInstance.exec("ALTER TABLE development_tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'GENERAL'");
    }
    if (devTaskCols.length > 0 && !devTaskCols.some((c) => c.name === 'evidence_json')) {
      dbInstance.exec("ALTER TABLE development_tasks ADD COLUMN evidence_json TEXT");
    }

    // Unanswered questions — the commercial feedback loop. A customer asks
    // something the business never published; the business sees it and can
    // publish an answer. Deliberately NOT auto-learned: a customer's own
    // statement is not a business fact.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS business_unanswered_questions (
        question_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        question TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ANSWERED','DISMISSED')),
        answered_artifact_id TEXT,
        answered_by_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_buq_workspace ON business_unanswered_questions(workspace_id, status);
    `);

    // Pass V — a small, bounded, real runtime-event ledger (Workstream I).
    // Deliberately not a reuse of `activity_events` (NOT NULL task_id,
    // task-scoped) or `admin_audit_events` (authority-mutation-scoped) —
    // this is for runtime-level events that are neither: skill execution
    // attempts, MCP connection probes, and similar. Retention is enforced
    // at insert time (see recordRuntimeEvent in lib/runtime-events.ts) —
    // health polling must never grow this table unbounded.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS runtime_events (
        event_id TEXT PRIMARY KEY,
        workspace_id TEXT,
        event_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_events_created ON runtime_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_runtime_events_target ON runtime_events(target_type, target_id);
    `);

    // ADR-006 — Windmill external execution control plane.
    //
    // windmill_targets is the K1 allowed-target registry: the only remote
    // script/flow paths SynthOS is ever permitted to invoke. workspace_id
    // NULL means platform-global (any workspace may use it); non-NULL means
    // that one workspace only. There is no column for a caller-supplied
    // arbitrary path anywhere else in this schema — every real submission
    // must resolve through a row here (R3).
    //
    // external_executions is the canonical LOCAL truth for a remote job
    // (non-negotiable rule: Windmill job state is never the only local
    // truth). correlation_id is the idempotency key (Q1) — unique so a
    // double-submit with the same key cannot insert twice. remote_job_id is
    // nullable because a row can exist before submission succeeds (a
    // SUBMISSION_FAILED row never got a real remote id). Ownership
    // (workspace_id, created_by_user_id) is set once at INSERT time from the
    // server-authoritative caller context and never trusts a remote payload
    // field for it (non-negotiable rule 6/7).
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS windmill_targets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        name TEXT NOT NULL,
        remote_path TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'script',
        enabled INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        input_schema_json TEXT,
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_windmill_targets_workspace ON windmill_targets(workspace_id);

      CREATE TABLE IF NOT EXISTS external_executions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        runtime TEXT NOT NULL DEFAULT 'windmill',
        task_id TEXT,
        graph_run_id TEXT,
        graph_node_id TEXT,
        skill_id TEXT,
        target_id TEXT,
        remote_path TEXT NOT NULL,
        target_kind TEXT NOT NULL DEFAULT 'script',
        remote_job_id TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempt_number INTEGER NOT NULL DEFAULT 1,
        parent_execution_id TEXT,
        correlation_id TEXT NOT NULL,
        input_json TEXT,
        submitted_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        last_checked_at TEXT,
        error_code TEXT,
        error_message_safe TEXT,
        result_artifact_id TEXT,
        result_receipt_id TEXT,
        result_ingested_at TEXT,
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        -- Restart reconciliation. These existed on the developer's live
        -- database but were MISSING from this CREATE TABLE, so a fresh
        -- install had no reconciliation columns at all and the sweep's own
        -- query failed on the first tick. Declared here and migrated below.
        next_poll_at TEXT,
        poll_attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_external_executions_workspace ON external_executions(workspace_id);
      -- Ordering index for the reconciliation sweep's selection query.
      CREATE INDEX IF NOT EXISTS idx_external_executions_next_poll ON external_executions(status, next_poll_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_external_executions_correlation ON external_executions(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_external_executions_remote_job ON external_executions(remote_job_id);
      -- PUSH 2A — durable advancement. next_poll_at is the lease: the sweep
      -- claims a row by compare-and-swapping it forward, so two concurrent
      -- ticks can never poll the same execution. Both columns live on the
      -- EXISTING ledger rather than in a second table, because "when should
      -- this job next be looked at" is a property of the job.
      CREATE INDEX IF NOT EXISTS idx_external_executions_due ON external_executions(next_poll_at);

      -- PUSH 2A — the development loop. This is an EXTENSION of the canonical
      -- task, never a replacement for it: task_id points at the real tasks
      -- row that owns the artifacts, Aegis reviews and receipts, exactly as
      -- external_executions does. It exists because the canonical execution
      -- vocabulary (TODO/READY/RUNNING/AWAITING_VERIFICATION/AWAITING_RECEIPT/
      -- DONE/FAILED) describes ONE execution's lifecycle and genuinely cannot
      -- express WAITING_FOR_REVIEW or WAITING_FOR_APPROVAL — states that occur
      -- before any execution exists. Overloading tasks.status with them would
      -- corrupt the vocabulary every other surface reads.
      CREATE TABLE IF NOT EXISTS development_tasks (
        dev_task_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        state TEXT NOT NULL,
        state_reason TEXT,
        requires_review INTEGER NOT NULL DEFAULT 1,
        requires_approval INTEGER NOT NULL DEFAULT 1,
        review_provider TEXT,
        review_model TEXT,
        review_text TEXT,
        review_at TEXT,
        approved_by_user_id TEXT,
        approved_at TEXT,
        execution_id TEXT,
        result_artifact_id TEXT,
        result_receipt_id TEXT,
        aegis_decision TEXT,
        -- PUSH 2C — coding tasks ask the runtime for structured engineering
        -- evidence. NULL whenever the runtime did not actually produce it;
        -- never back-filled with placeholders.
        task_kind TEXT NOT NULL DEFAULT 'GENERAL',
        evidence_json TEXT,
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_development_tasks_workspace ON development_tasks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_development_tasks_state ON development_tasks(state);
      CREATE INDEX IF NOT EXISTS idx_development_tasks_execution ON development_tasks(execution_id);

      -- P0 voice regression fix. The TTS provider credential now has a real
      -- server-side home instead of living in browser localStorage and
      -- travelling in every /api/voice/tts request body. api_key_encrypted
      -- holds an AES-256-GCM envelope (see lib/voice-credentials.ts) — never
      -- plaintext. reference_id and model are NOT secrets: a voice id names a
      -- voice and a model id names a tier, neither authenticates anything, so
      -- both are stored in the clear and may be read back by the UI.
      -- One row per provider: this is install-level configuration, not
      -- per-workspace data.
      -- ===================================================================
      -- BUSINESS CONVERSATION AI (revenue product #1)
      --
      -- Channel-neutral by design: the same business representative must be
      -- reachable later from mobile, voice call and SMS without a second
      -- conversation store. The channel field is the only thing that changes.
      --
      -- Deliberately separate from jarvis_sessions: that is the OPERATOR's
      -- internal assistant, single-channel and owner-facing. This is a
      -- CUSTOMER-facing conversation with an external participant, lead data
      -- and handoff state, and the two must not share a table.
      -- ===================================================================
      CREATE TABLE IF NOT EXISTS business_assistant_profiles (
        profile_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        business_name TEXT NOT NULL,
        assistant_name TEXT NOT NULL,
        business_description TEXT,
        services_json TEXT NOT NULL DEFAULT '[]',
        locations_json TEXT NOT NULL DEFAULT '[]',
        hours TEXT,
        contact_json TEXT NOT NULL DEFAULT '{}',
        brand_voice TEXT,
        greeting TEXT,
        ai_disclosure TEXT NOT NULL,
        qualification_goals_json TEXT NOT NULL DEFAULT '[]',
        handoff_rules TEXT,
        memory_permissions TEXT NOT NULL DEFAULT 'workspace_only',
        enabled_capabilities_json TEXT NOT NULL DEFAULT '[]',
        allowed_actions_json TEXT NOT NULL DEFAULT '[]',
        escalation_contacts_json TEXT NOT NULL DEFAULT '[]',
        voice_profile TEXT,
        bot_mode_profile TEXT,
        business_line_id TEXT,
        -- The public assistant is addressed by an unguessable key, never by
        -- workspace_id. An anonymous visitor therefore cannot name which
        -- workspace's knowledge is searched, and workspace ids stay
        -- un-enumerable from the public surface.
        public_key TEXT UNIQUE,
        published INTEGER NOT NULL DEFAULT 0,
        -- Websites authorized to embed this assistant. Empty means the
        -- standalone page still works but nobody may frame it — publishing
        -- must never silently make a business embeddable anywhere.
        allowed_origins_json TEXT NOT NULL DEFAULT '[]',
        -- Fish Audio reference voice for THIS business. The API key stays the
        -- platform's (managed-keys phase); only the voice identity is per
        -- business, and a business that sets none gets the platform default
        -- with that stated honestly rather than implied as its own.
        voice_reference_id TEXT,
        voice_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bap_workspace ON business_assistant_profiles(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_bap_public_key ON business_assistant_profiles(public_key);

      CREATE TABLE IF NOT EXISTS business_conversations (
        conversation_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('WEB','MOBILE_APP','VOICE_CALL','SMS','WHATSAPP')),
        participant_ref TEXT,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE','HANDOFF_REQUESTED','CLOSED')),
        lead_json TEXT NOT NULL DEFAULT '{}',
        summary_artifact_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bconv_workspace ON business_conversations(workspace_id);

      CREATE TABLE IF NOT EXISTS business_conversation_messages (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('customer','assistant','system')),
        content TEXT NOT NULL,
        -- How the assistant produced this turn. Never inferred by the client:
        -- GROUNDED_EXTRACTIVE = real passages from workspace knowledge,
        -- LLM = an approved model phrased it, NO_KNOWLEDGE = declined to answer.
        response_mode TEXT,
        sources_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bconvmsg_conv ON business_conversation_messages(conversation_id);

      -- Model provider credentials, encrypted at rest with the same
      -- AES-256-GCM envelope the voice store uses. It exists so enabling
      -- conversational phrasing does not require editing a .env file and
      -- rebuilding a container — the same argument that produced the voice
      -- store, applied to the model key.
      CREATE TABLE IF NOT EXISTS model_credentials (
        provider TEXT PRIMARY KEY,
        api_key_encrypted TEXT,
        updated_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- TOOL PACK 2 — Gmail connections.
      --
      -- WORKSPACE-SCOPED, and that is the one structural difference from the two
      -- credential tables below it. model_credentials and voice_credentials are
      -- keyed by provider alone, because a model API key is platform-level:
      -- SynthOS holds it and pays for it (CLAUDE.md, managed-keys phase 1).
      --
      -- A Gmail account is the opposite. It belongs to whoever connected it, and
      -- "workspace A cannot read workspace B's Gmail" is a requirement rather
      -- than a nicety — mail is the most sensitive data this system will touch.
      -- So workspace_id leads the UNIQUE tuple, exactly as it does in
      -- execution_claims, and there is deliberately no lookup function in
      -- lib/gmail-connection.ts that omits it.
      --
      -- Tokens are stored encrypted (AES-256-GCM via lib/voice-credentials.ts,
      -- the same helper model_credentials uses — not a second crypto path) and
      -- are never returned by any API route. See lib/gmail-connection.ts.
      CREATE TABLE IF NOT EXISTS gmail_connections (
        connection_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        account_email TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        access_token_encrypted TEXT,
        access_token_expires_at TEXT,
        scopes TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('CONNECTED', 'NEEDS_REAUTH', 'REVOKED')),
        connected_by_user_id TEXT NOT NULL,
        last_verified_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, account_email)
      );
      CREATE INDEX IF NOT EXISTS idx_gmail_connections_workspace ON gmail_connections(workspace_id, status);

      -- TOOL PACK 2 — the send ledger. The duplicate-send defence.
      --
      -- Gmail's API has no idempotency key, so "did this already send?" cannot
      -- be asked of the provider. This table answers it locally: one row per
      -- approved send, claimed BEFORE the provider is called, carrying the
      -- provider's message id once it answers.
      --
      -- UNIQUE(approval_id) is the actual protection. An approval is single-use
      -- already, but that guards the authority; this guards the SIDE EFFECT, and
      -- they are different failures. If the process dies between the provider
      -- accepting a message and the row being updated, the row survives in
      -- DISPATCHED with no message id — which is the UNKNOWN state, and the one
      -- state that must never be retried automatically.
      CREATE TABLE IF NOT EXISTS gmail_send_attempts (
        attempt_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        task_id TEXT,
        correlation_id TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('DISPATCHED', 'SENT', 'FAILED', 'UNKNOWN')),
        provider_message_id TEXT,
        provider_thread_id TEXT,
        error_category TEXT,
        error_message TEXT,
        dispatched_at TEXT NOT NULL,
        resolved_at TEXT,
        UNIQUE (approval_id)
      );
      CREATE INDEX IF NOT EXISTS idx_gmail_send_attempts_workspace ON gmail_send_attempts(workspace_id, dispatched_at);

      CREATE TABLE IF NOT EXISTS voice_credentials (
        provider TEXT PRIMARY KEY,
        api_key_encrypted TEXT,
        reference_id TEXT,
        model TEXT,
        format TEXT,
        updated_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    // Advance the schema version transactionally (additive, idempotent).
    applySchemaMigrations(dbInstance);
  }
  return dbInstance;
}

// ---------------------------------------------------------------------------
// SCHEMA VERSION — one monotonic number (SQLite `user_version`) owned by this
// database authority. The provisioning above stays idempotent and additive;
// every change from here on is ALSO a numbered migration below, applied in its
// own transaction together with the version bump, so the version never
// advances without the change and a failed migration leaves both untouched.
//
//   * newer on disk than SCHEMA_VERSION → refuse to open (fail closed);
//   * older → apply each pending migration once, in order;
//   * migrations are additive (CREATE … IF NOT EXISTS / ADD COLUMN) — none
//     drops or rewrites data — so re-running one is a no-op.
// There is no second migration system; this list is it.
// ---------------------------------------------------------------------------

export interface SchemaMigration {
  version: number;
  description: string;
  up: (db: any) => void;
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = Object.freeze([
  {
    version: 1,
    description: 'Baseline: the self-provisioned schema as of 2026-09-18 (every table and additive column provisioned by getDatabase). Recorded, not changed.',
    up: () => { /* the provisioning above already guarantees it */ },
  },
  {
    version: 2,
    description: 'artifact_purpose_events — append-only artifact purpose / retrieval policy (lib/memory-index.ts).',
    up: (db: any) => db.exec(`CREATE TABLE IF NOT EXISTS artifact_purpose_events (
        event_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        purpose TEXT NOT NULL, retrieval_policy TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_purpose_events_artifact ON artifact_purpose_events (artifact_id, created_at);`),
  },
]);

/** The schema version this build supports (the last migration). */
export const SCHEMA_VERSION = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1].version;

export class SchemaVersionUnsupportedError extends Error {
  constructor(public onDisk: number, public supported: number, dbPath: string) {
    super(`Database schema version ${onDisk} at ${dbPath} is newer than this build supports (${supported}). Refusing to open it: running older code against a newer schema could corrupt data. Deploy the newer build, or restore a backup taken at version ${supported} or lower.`);
    this.name = 'SchemaVersionUnsupportedError';
  }
}

/** Apply pending migrations, each in its own transaction with its version bump. Returns what ran. */
export function applySchemaMigrations(db: any, migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS): { from: number; to: number; applied: number[] } {
  const from = Number((db.prepare('PRAGMA user_version').get() as any)?.user_version ?? 0);
  const supported = migrations.length ? migrations[migrations.length - 1].version : 0;
  if (from > supported) throw new SchemaVersionUnsupportedError(from, supported, '(open database)');
  const applied: number[] = [];
  let current = from;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    if (m.version !== current + 1) throw new Error(`schema migrations must be contiguous: at ${current}, next is ${m.version}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* not in a transaction */ }
      throw new Error(`schema migration ${m.version} (${m.description}) failed and was rolled back; the database stays at version ${current}: ${(err as any)?.message || err}`);
    }
    current = m.version;
    applied.push(m.version);
  }
  return { from, to: current, applied };
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

// ---------------------------------------------------------------------------
// NO-COPY/PASTE ORCHESTRATION — the queue, expressed over canonical tasks.
// ---------------------------------------------------------------------------

/**
 * Statuses from which the orchestrator may advance a task.
 *
 * TODO and READY only. Deliberately NOT the mid-flight states: a task sitting
 * in RUNNING / AWAITING_VERIFICATION / AWAITING_RECEIPT either belongs to a
 * live execution or belongs to one that died, and re-entering it from a
 * scheduler tick is how a half-finished run acquires a second artifact.
 * Recovering those is reconciliation's job, not the queue's.
 */
export const ORCHESTRATOR_ELIGIBLE_STATUSES = ['TODO', 'READY'] as const;

/**
 * Terminal statuses. A task here is finished, for good or ill, and the
 * orchestrator must never pick it up again.
 *
 * REJECTED and BLOCKED are terminal for autonomy specifically: a human said no,
 * or policy said no, and an unattended loop that retried either would be
 * converting a refusal into a delay.
 */
export const TASK_TERMINAL_STATUSES = ['DONE', 'VERIFIED', 'FAILED', 'INCOMPLETE', 'VERIFICATION_FAILED', 'BLOCKED', 'REJECTED', 'CANCELLED'] as const;

export interface OrchestratorTaskRow {
  task_id: string;
  workspace_id: string | null;
  title: string | null;
  description: string | null;
  assigned_agent: string | null;
  assigned_model: string | null;
  status: string | null;
  capability: string | null;
  parameters_json: string | null;
  autonomy_eligible: number;
  created_at: string | null;
}

/**
 * The next tasks the orchestrator may consider, oldest first.
 *
 * WORKSPACE-SCOPED, always — there is no unscoped variant to misuse, for the
 * same reason every other read in this file is scoped.
 *
 * `autonomy_eligible = 1` is required, so a task created by any existing code
 * path (all of which leave it 0) can never be picked up unattended. Autonomy
 * is opted into per task, not inherited.
 *
 * Oldest first is FIFO rather than a priority scheme. There is no priority
 * column and inventing one here would be inventing product; FIFO is the
 * behaviour an operator can predict from what they queued.
 */
export function listOrchestratorEligibleTasks(workspaceId: string, limit = 25): OrchestratorTaskRow[] {
  const db = getDatabase();
  const eligible = ORCHESTRATOR_ELIGIBLE_STATUSES.map(() => '?').join(', ');
  const rows: any = db.prepare(
    `SELECT task_id, workspace_id, title, description, assigned_agent, assigned_model, status,
            capability, parameters_json, autonomy_eligible, created_at
       FROM tasks
      WHERE workspace_id = ?
        AND autonomy_eligible = 1
        AND status IN (${eligible})
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?`,
  ).all(workspaceId, ...ORCHESTRATOR_ELIGIBLE_STATUSES, Math.max(1, Math.min(limit, 200)));
  return (rows || []) as OrchestratorTaskRow[];
}

/** Tasks parked at the human gate, so the orchestrator can notice when one is decided. */
export function listTasksAwaitingApproval(workspaceId: string, limit = 50): OrchestratorTaskRow[] {
  const rows: any = getDatabase().prepare(
    `SELECT task_id, workspace_id, title, description, assigned_agent, assigned_model, status,
            capability, parameters_json, autonomy_eligible, created_at
       FROM tasks
      WHERE workspace_id = ? AND autonomy_eligible = 1 AND status = 'WAITING_FOR_APPROVAL'
      ORDER BY updated_at ASC
      LIMIT ?`,
  ).all(workspaceId, Math.max(1, Math.min(limit, 200)));
  return (rows || []) as OrchestratorTaskRow[];
}

/** Create a task the orchestrator is allowed to advance. */
export function createOrchestratedTask(params: {
  taskId: string;
  workspaceId: string;
  title: string;
  description: string;
  assignedAgent: string;
  assignedModel: string;
  /** NULL for a model task; a registry capability id for a tool task. */
  capability?: string | null;
  parameters?: Record<string, unknown> | null;
  createdAt?: string;
}): TaskRecord {
  const created = createInitialTask({
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    title: params.title,
    description: params.description,
    assignedAgent: params.assignedAgent,
    assignedModel: params.assignedModel,
    createdAt: params.createdAt,
  });
  getDatabase()
    .prepare('UPDATE tasks SET capability = ?, parameters_json = ?, autonomy_eligible = 1 WHERE task_id = ?')
    .run(params.capability ?? null, params.parameters ? JSON.stringify(params.parameters) : null, params.taskId);
  return created;
}

export function getOrchestratorTask(taskId: string, workspaceId: string): OrchestratorTaskRow | null {
  const row: any = getDatabase().prepare(
    `SELECT task_id, workspace_id, title, description, assigned_agent, assigned_model, status,
            capability, parameters_json, autonomy_eligible, created_at
       FROM tasks WHERE task_id = ? AND workspace_id = ?`,
  ).get(taskId, workspaceId);
  return row ? (row as OrchestratorTaskRow) : null;
}

/**
 * Atomically move a task out of the eligible set.
 *
 * THIS IS THE DUPLICATE-EXECUTION DEFENCE, and it is a single guarded UPDATE
 * rather than a read-then-write. The `status IN (...)` predicate means SQLite
 * decides the winner: two workers racing the same task produce exactly one
 * `changes === 1`, and the loser sees 0 and moves on. A check-then-claim would
 * have a gap, and for a task that calls a paid provider the gap is a duplicate
 * bill and a duplicate artifact.
 *
 * Returns true if THIS caller now owns the task.
 */
export function claimTaskForOrchestration(taskId: string, workspaceId: string, nowIso?: string): boolean {
  const db = getDatabase();
  const now = nowIso || new Date().toISOString();
  const eligible = ORCHESTRATOR_ELIGIBLE_STATUSES.map(() => '?').join(', ');
  const res: any = db.prepare(
    `UPDATE tasks SET status = 'RUNNING', updated_at = ?
      WHERE task_id = ? AND workspace_id = ? AND status IN (${eligible})`,
  ).run(now, taskId, workspaceId, ...ORCHESTRATOR_ELIGIBLE_STATUSES);
  const won = !!res && res.changes === 1;
  if (won) {
    db.prepare('INSERT INTO task_status_history (task_id, status, created_at) VALUES (?, ?, ?)')
      .run(taskId, 'RUNNING', now);
  }
  return won;
}

/** Release a claim back to READY — used when dispatch is refused before any work happened. */
export function releaseTaskClaim(taskId: string, workspaceId: string, toStatus: string, reason?: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ? AND workspace_id = ? AND status = 'RUNNING'")
    .run(toStatus, now, taskId, workspaceId);
  db.prepare('INSERT INTO task_status_history (task_id, status, created_at) VALUES (?, ?, ?)')
    .run(taskId, toStatus, now);
  if (reason) {
    try {
      recordActivityEvent({
        taskId, expectedWorkspaceId: workspaceId, eventType: 'ORCHESTRATION_DEFERRED',
        agentId: 'orchestrator', payload: { toStatus, reason },
      });
    } catch { /* evidence must never fail the transition */ }
  }
}

/**
 * Tasks the orchestrator claimed but never finished — the crash-recovery set.
 *
 * A RUNNING task with no live execution is the signature of a process that
 * died mid-flight. It is NOT automatically re-run: re-running it is exactly
 * how a duplicate provider call and a duplicate artifact appear. It is
 * surfaced for reconciliation instead.
 */
export function listStrandedOrchestrationTasks(workspaceId: string, olderThanIso: string): OrchestratorTaskRow[] {
  const rows: any = getDatabase().prepare(
    `SELECT task_id, workspace_id, title, description, assigned_agent, assigned_model, status,
            capability, parameters_json, autonomy_eligible, created_at
       FROM tasks
      WHERE workspace_id = ? AND autonomy_eligible = 1 AND status = 'RUNNING' AND updated_at < ?
        -- A task waiting on an external execution the sweep is still polling
        -- is in flight, not stranded. Once polling stops (deadline, blocked on
        -- input) next_poll_at is NULL and the task surfaces here again.
        AND NOT EXISTS (
          SELECT 1 FROM external_executions e
           WHERE e.task_id = tasks.task_id AND e.workspace_id = tasks.workspace_id
             AND e.next_poll_at IS NOT NULL
             AND e.status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
        )
      ORDER BY updated_at ASC`,
  ).all(workspaceId, olderThanIso);
  return (rows || []) as OrchestratorTaskRow[];
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

export interface ExecutionClaimRecord {
  claim_id: string;
  workspace_id: string;
  actor_user_id: string;
  capability: string;
  idempotency_key: string;
  payload_hash: string;
  task_id: string;
  status: 'CLAIMED' | 'DONE' | 'FAILED';
  created_at: string;
  updated_at: string;
}

export type ExecutionClaimAcquisition =
  | { outcome: 'ACQUIRED'; claim: ExecutionClaimRecord }
  | { outcome: 'EXISTS'; claim: ExecutionClaimRecord };

/**
 * The atomic claim itself. Always attempts the real INSERT first — never
 * SELECT-then-INSERT — so SQLite's UNIQUE constraint is the sole arbiter of
 * who owns execution. On a UNIQUE conflict, reads back and returns the
 * winning claim rather than treating the conflict as an error.
 */
export function acquireExecutionClaim(params: {
  workspaceId: string;
  actorUserId: string;
  capability: string;
  idempotencyKey: string;
  payloadHash: string;
  taskId: string;
}): ExecutionClaimAcquisition {
  const db = getDatabase();
  const now = new Date().toISOString();
  const claimId = `claim-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  try {
    db.prepare(`
      INSERT INTO execution_claims (claim_id, workspace_id, actor_user_id, capability, idempotency_key, payload_hash, task_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?)
    `).run(claimId, params.workspaceId, params.actorUserId, params.capability, params.idempotencyKey, params.payloadHash, params.taskId, now, now);
    return {
      outcome: 'ACQUIRED',
      claim: {
        claim_id: claimId,
        workspace_id: params.workspaceId,
        actor_user_id: params.actorUserId,
        capability: params.capability,
        idempotency_key: params.idempotencyKey,
        payload_hash: params.payloadHash,
        task_id: params.taskId,
        status: 'CLAIMED',
        created_at: now,
        updated_at: now,
      },
    };
  } catch (err: any) {
    const isUniqueConflict = err?.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(String(err?.message));
    if (!isUniqueConflict) throw err;
    const existing = db.prepare(`
      SELECT * FROM execution_claims WHERE workspace_id = ? AND actor_user_id = ? AND capability = ? AND idempotency_key = ?
    `).get(params.workspaceId, params.actorUserId, params.capability, params.idempotencyKey) as ExecutionClaimRecord;
    return { outcome: 'EXISTS', claim: existing };
  }
}

/** Resolves a claim this process owns to its terminal state. Called from a try/finally so a claim is never left CLAIMED once its owning call has returned or thrown. */
/**
 * DELETE a claim, for the outcomes that mean "nothing happened; this may be
 * attempted again later".
 *
 * Distinct from resolveExecutionClaim on purpose. Resolving to DONE records
 * that work COMPLETED, and a later attempt correctly short-circuits on it.
 * That is wrong for a task that merely paused — a task parked at an approval
 * gate, or deferred because a capability was briefly unconfigured, did no work
 * at all, and a DONE claim would make the resumed attempt report success
 * without ever executing. That bug existed for one commit and is what this
 * function exists to prevent.
 *
 * Deleting rather than adding a RELEASED status keeps the CHECK constraint and
 * every existing query unchanged, and an absent row is exactly what
 * "unclaimed" already means everywhere else in this table.
 */
export function releaseExecutionClaim(claimId: string): void {
  getDatabase().prepare('DELETE FROM execution_claims WHERE claim_id = ? AND status = ?').run(claimId, 'CLAIMED');
}

/**
 * Settle the orchestrator's durable claim on a task whose work finished
 * asynchronously (a SUBMITTED external execution). Returns true when an open
 * claim existed and was settled — i.e. the task really is orchestrator-owned.
 * Tasks with no such claim (a Development-loop or ad-hoc execution) are left
 * untouched.
 */
export function settleOrchestrationClaimForTask(workspaceId: string, taskId: string, status: 'DONE' | 'FAILED'): boolean {
  const res: any = getDatabase().prepare(
    `UPDATE execution_claims SET status = ?, updated_at = ?
      WHERE workspace_id = ? AND actor_user_id = 'orchestrator' AND idempotency_key = ? AND status = 'CLAIMED'`,
  ).run(status, new Date().toISOString(), workspaceId, `orchestration-task:${taskId}`);
  return !!res && res.changes === 1;
}

export function hasOpenOrchestrationClaim(workspaceId: string, taskId: string): boolean {
  const row = getDatabase().prepare(
    `SELECT 1 FROM execution_claims
      WHERE workspace_id = ? AND actor_user_id = 'orchestrator' AND idempotency_key = ? AND status = 'CLAIMED'`,
  ).get(workspaceId, `orchestration-task:${taskId}`);
  return !!row;
}

export function resolveExecutionClaim(claimId: string, status: 'DONE' | 'FAILED'): void {
  const db = getDatabase();
  db.prepare(`UPDATE execution_claims SET status = ?, updated_at = ? WHERE claim_id = ?`).run(status, new Date().toISOString(), claimId);
}

/**
 * Stale-claim reconciliation. This process is single-instance, single-
 * writer SQLite (see the WAL/busy_timeout pragmas earlier in this file) —
 * a claim can only ever be CLAIMED while the process that inserted it is
 * alive, because the code path that owns it always resolves it to
 * DONE/FAILED in a try/finally before returning (see withAtomicClaim in
 * lib/fabric/envelope.ts). The only way a row can still read CLAIMED when
 * this runs is a hard crash (kill -9, power loss) that skipped that
 * finally block entirely — which also means no live process is still
 * working on it. A full distributed lease/heartbeat is not needed for a
 * single-process deployment; reconciling once at every startup (this
 * function is called once from getDatabase()'s one-time init) is
 * sufficient and honest about what this actually is. Returns the number
 * of rows reconciled, so this is directly testable rather than only
 * inspectable.
 */
export function reconcileStaleExecutionClaims(): number {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE execution_claims SET status = 'FAILED', updated_at = ?
    WHERE status = 'CLAIMED'
  `).run(new Date().toISOString());
  return result.changes;
}

// ---------------------------------------------------------------------------
// STEP 7 — schedule persistence. Pure storage/CRUD only; deciding WHAT a
// schedule may do (capability gating, Guardian/approval eligibility) lives
// in lib/fabric/scheduler.ts, and actually DOING it always goes through
// executeEnvelope() — nothing here calls a provider or writes an artifact.
// ---------------------------------------------------------------------------

export type ScheduleStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'NOT_CONFIGURED' | 'CANCELLED';
export type ScheduleRecurrenceType = 'ONCE' | 'INTERVAL';

export interface ScheduleRecord {
  schedule_id: string;
  workspace_id: string;
  actor_user_id: string;
  capability: string;
  action: string;
  parameters_json: string;
  raw_text: string;
  recurrence_type: ScheduleRecurrenceType;
  interval_seconds: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  status: ScheduleStatus;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function createSchedule(params: {
  scheduleId: string;
  workspaceId: string;
  actorUserId: string;
  capability: string;
  action: string;
  parameters: Record<string, unknown>;
  rawText: string;
  recurrenceType: ScheduleRecurrenceType;
  intervalSeconds?: number | null;
  nextRunAt: string | null;
  status: ScheduleStatus;
  statusReason?: string | null;
}): ScheduleRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO schedules (schedule_id, workspace_id, actor_user_id, capability, action, parameters_json, raw_text, recurrence_type, interval_seconds, next_run_at, last_run_at, status, status_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    params.scheduleId, params.workspaceId, params.actorUserId, params.capability, params.action,
    JSON.stringify(params.parameters ?? {}), params.rawText, params.recurrenceType, params.intervalSeconds ?? null,
    params.nextRunAt, params.status, params.statusReason ?? null, now, now
  );
  return getSchedule(params.scheduleId)!;
}

export function getSchedule(scheduleId: string): ScheduleRecord | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM schedules WHERE schedule_id = ?').get(scheduleId) as ScheduleRecord | undefined;
  return row ?? null;
}

export function getScheduleWorkspaceId(scheduleId: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT workspace_id FROM schedules WHERE schedule_id = ?').get(scheduleId) as { workspace_id: string } | undefined;
  return row?.workspace_id ?? null;
}

/** Mirrors isTaskInWorkspace: unknown id and mismatch are both false, indistinguishable to the caller (404, never a distinct 403 — no existence leak across workspaces). */
export function isScheduleInWorkspace(scheduleId: string, workspaceId: string): boolean {
  return getScheduleWorkspaceId(scheduleId) === workspaceId;
}

export function listWorkspaceSchedules(workspaceId: string, limit = 50): ScheduleRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM schedules WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, limit) as ScheduleRecord[];
}

/** Schedules the tick loop must actually fire right now — status ACTIVE and genuinely due. PAUSED/terminal schedules are structurally excluded, which is what makes pause airtight (a paused schedule is never even considered, not merely skipped after being read). */
export function listDueSchedules(nowIso: string): ScheduleRecord[] {
  const db = getDatabase();
  return db.prepare(
    "SELECT * FROM schedules WHERE status = 'ACTIVE' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC"
  ).all(nowIso) as ScheduleRecord[];
}

export function setScheduleStatus(scheduleId: string, status: ScheduleStatus, statusReason?: string | null): void {
  const db = getDatabase();
  db.prepare('UPDATE schedules SET status = ?, status_reason = ?, updated_at = ? WHERE schedule_id = ?')
    .run(status, statusReason ?? null, new Date().toISOString(), scheduleId);
}

/**
 * TOOL PACK 1 — resume a paused schedule.
 *
 * Extracted from POST /api/schedules/:id/resume, which built this UPDATE
 * inline. schedule.resume needs the identical write, and the alternative was a
 * second copy of the SQL in lib/fabric/envelope.ts. Two copies of a status
 * transition drift: one gets a new column and the other does not, and then the
 * same logical action leaves the row in two different shapes depending on
 * which door it came through.
 *
 * The caller computes nextRunAt (lib/fabric/scheduler.ts::computeResumeNextRunAt)
 * — this function does not decide scheduling policy, only how to persist it.
 */
export function resumeSchedule(scheduleId: string, nextRunAt: string | null): void {
  const db = getDatabase();
  db.prepare("UPDATE schedules SET status = 'ACTIVE', status_reason = NULL, next_run_at = ?, updated_at = ? WHERE schedule_id = ?")
    .run(nextRunAt, new Date().toISOString(), scheduleId);
}

/** Applied after every real occurrence resolves (never for an IN_PROGRESS duplicate, which contributes nothing — the owning call already does this). */
export function updateScheduleAfterOccurrence(scheduleId: string, params: {
  status: ScheduleStatus;
  statusReason?: string | null;
  nextRunAt: string | null;
  lastRunAt: string;
}): void {
  const db = getDatabase();
  db.prepare('UPDATE schedules SET status = ?, status_reason = ?, next_run_at = ?, last_run_at = ?, updated_at = ? WHERE schedule_id = ?')
    .run(params.status, params.statusReason ?? null, params.nextRunAt, params.lastRunAt, new Date().toISOString(), scheduleId);
}

export interface ScheduleOccurrenceRecord {
  occurrence_id: string;
  schedule_id: string;
  workspace_id: string;
  due_at: string;
  idempotency_key: string;
  status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'NOT_CONFIGURED';
  outcome: string;
  reason: string | null;
  task_id: string | null;
  artifact_id: string | null;
  receipt_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Upsert by (schedule_id, due_at) — pure bookkeeping, not a race gate (see
 * the schema comment). Safe to call more than once with identical content:
 * every concurrent caller for the same occurrence already received the
 * SAME real executeEnvelope() result before reaching here (execution_claims
 * guarantees that), so a redundant write here is a harmless no-op, never a
 * conflicting one.
 */
export function recordScheduleOccurrence(params: {
  scheduleId: string;
  workspaceId: string;
  dueAt: string;
  idempotencyKey: string;
  status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'NOT_CONFIGURED';
  outcome: string;
  reason?: string | null;
  taskId?: string | null;
  artifactId?: string | null;
  receiptId?: string | null;
}): ScheduleOccurrenceRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT occurrence_id FROM schedule_occurrences WHERE schedule_id = ? AND due_at = ?')
    .get(params.scheduleId, params.dueAt) as { occurrence_id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE schedule_occurrences SET status = ?, outcome = ?, reason = ?, task_id = ?, artifact_id = ?, receipt_id = ?, updated_at = ?
      WHERE occurrence_id = ?
    `).run(params.status, params.outcome, params.reason ?? null, params.taskId ?? null, params.artifactId ?? null, params.receiptId ?? null, now, existing.occurrence_id);
    return db.prepare('SELECT * FROM schedule_occurrences WHERE occurrence_id = ?').get(existing.occurrence_id) as ScheduleOccurrenceRecord;
  }

  const occurrenceId = `occ-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(`
    INSERT INTO schedule_occurrences (occurrence_id, schedule_id, workspace_id, due_at, idempotency_key, status, outcome, reason, task_id, artifact_id, receipt_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(occurrenceId, params.scheduleId, params.workspaceId, params.dueAt, params.idempotencyKey, params.status, params.outcome, params.reason ?? null, params.taskId ?? null, params.artifactId ?? null, params.receiptId ?? null, now, now);
  return db.prepare('SELECT * FROM schedule_occurrences WHERE occurrence_id = ?').get(occurrenceId) as ScheduleOccurrenceRecord;
}

export function getScheduleOccurrences(scheduleId: string): ScheduleOccurrenceRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM schedule_occurrences WHERE schedule_id = ? ORDER BY due_at ASC').all(scheduleId) as ScheduleOccurrenceRecord[];
}

// PHASE 0b — thrown by updateTaskStatus/recordActivityEvent when an
// optional expectedWorkspaceId is supplied and does not match the task's
// real, persisted workspace_id. A distinct name so a caller (or a test)
// can distinguish "this task belongs to someone else" from any other
// failure mode, rather than pattern-matching a generic Error's message.
export class TaskWorkspaceMismatchError extends Error {
  constructor(taskId: string, expectedWorkspaceId: string, actualWorkspaceId: string | null) {
    super(`Task ${taskId} belongs to workspace ${actualWorkspaceId ?? '(not found)'}, not ${expectedWorkspaceId}.`);
    this.name = 'TaskWorkspaceMismatchError';
  }
}

/**
 * expectedWorkspaceId is optional and, when supplied, is a defense-in-depth
 * backstop, not the primary gate: callers that already reject a workspace
 * mismatch before ever reaching here (e.g. POST /api/execute-agent-task's
 * own entry check, Phase 0b) will never actually trigger this throw in
 * practice. It exists so this helper itself never trusts taskId alone when
 * a caller chooses to pass workspace context. Omitted (the default),
 * behavior is byte-for-byte what it was before Phase 0b — every existing
 * caller (lib/external-executions.ts and others) is unaffected.
 */
export function updateTaskStatus(taskId: string, status: string, timestamp?: string, expectedWorkspaceId?: string): void {
  const db = getDatabase();

  if (expectedWorkspaceId !== undefined) {
    const actual = getTaskWorkspaceId(taskId);
    if (actual !== expectedWorkspaceId) {
      throw new TaskWorkspaceMismatchError(taskId, expectedWorkspaceId, actual);
    }
  }

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

/** See updateTaskStatus's doc comment — same optional, backstop-only expectedWorkspaceId contract. */
export function recordActivityEvent(params: {
  eventId?: string;
  taskId: string;
  eventType: string;
  agentId: string;
  payload?: any;
  createdAt?: string;
  expectedWorkspaceId?: string;
}): ActivityEventRecord {
  const db = getDatabase();

  if (params.expectedWorkspaceId !== undefined) {
    const actual = getTaskWorkspaceId(params.taskId);
    if (actual !== params.expectedWorkspaceId) {
      throw new TaskWorkspaceMismatchError(params.taskId, params.expectedWorkspaceId, actual);
    }
  }

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

export interface WorkspaceTaskCounts {
  total: number;
  active: number;
  done: number;
  failed: number;
}

// Real Workspace Overview backend (Pass X) — one COUNT/SUM query, never a
// full-table scan counted in JavaScript. "active" is every non-terminal
// status a task can hold (READY/RUNNING/AWAITING_VERIFICATION/
// AWAITING_RECEIPT); DONE and FAILED are the two terminal states — see the
// literal status strings server.ts's updateTaskStatus call sites use.
export function summariseWorkspaceTasks(workspaceId: string): WorkspaceTaskCounts {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status NOT IN ('DONE', 'FAILED') THEN 1 ELSE 0 END) AS active
    FROM tasks WHERE workspace_id = ?
  `).get(workspaceId) as { total: number | null; done: number | null; failed: number | null; active: number | null } | undefined;
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    done: row?.done ?? 0,
    failed: row?.failed ?? 0,
  };
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

// Real total, independent of listWorkspaceReceipts' bounded page — a
// dashboard count must never silently equal the fetch limit.
export function countWorkspaceReceipts(workspaceId: string): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM receipts r JOIN tasks t ON t.task_id = r.task_id WHERE t.workspace_id = ?
  `).get(workspaceId) as { n: number | null } | undefined;
  return row?.n ?? 0;
}

/**
 * Full workspace-scoped receipt page for the Receipts product surface.
 *
 * Distinct from listWorkspaceReceipts() above, which is a deliberately tiny
 * 4-column summary for Jarvis's ADMIN_RECEIPT_QUERY intent. This returns the
 * whole row (payload_json, signature, public_key, algorithm) so the caller can
 * re-verify each signature independently — the same `receipts` table, not a
 * second store. Scoped via the owning task exactly as the summary query is,
 * because `receipts` carries no workspace_id column of its own.
 */
export function listWorkspaceReceiptsFull(
  workspaceId: string,
  limit = 200
): ReceiptRecord[] {
  const db = getDatabase();
  return (db.prepare(`
    SELECT r.*
    FROM receipts r
    JOIN tasks t ON t.task_id = r.task_id
    WHERE t.workspace_id = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(workspaceId, limit) as ReceiptRecord[]) || [];
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

// ---------------------------------------------------------------------------
// REVOKED RECEIPT-SIGNING KEYS — part of the receipt-verification authority.
//
// Only PUBLIC-key fingerprints are stored (SHA-256 of the SPKI DER encoding),
// never private material. A key listed here is rejected everywhere: a receipt
// whose public key (or the configured trusted key) matches it never verifies,
// and nothing may be signed with it. Revocation is permanent; entries are
// never removed.
// ---------------------------------------------------------------------------

export interface RevokedSigningKey {
  fingerprint: string;
  algorithm: 'Ed25519';
  status: 'REVOKED';
  reason: string;
  discoveredAt: string;
  affectedCommits: string[];
  scope: string;
}

export const REVOKED_RECEIPT_SIGNING_KEYS: readonly RevokedSigningKey[] = Object.freeze([
  {
    fingerprint: 'sha256:7adbc0bb09b99bf93ad57a4ee29069592824ebdc56b1cdc3a4f0e169832cd6ab',
    algorithm: 'Ed25519',
    status: 'REVOKED',
    reason: 'Private key data/keys/ed25519_private.pem was committed to the public jhrzic/synthos-admin repository; it remains recoverable from Git history.',
    discoveredAt: '2026-09-18',
    affectedCommits: ['0e09586', 'e2fd065', '7b07203'],
    scope: 'Development-era receipt-signing key, replaced before the first production receipt (2026-09-08). No production receipt uses it. Rejected for all receipts, in every workspace, permanently.',
  },
  {
    fingerprint: 'sha256:d210f8db5c25dbaa4cf31c47f204378b32ca1b5adf9b0f5180fcc2f7ddacb3f2',
    algorithm: 'Ed25519',
    status: 'REVOKED',
    reason: 'Retired second signing authority: generated automatically by the separate SynthOS Admin instance on GCE synthos-core-01 (volume synthos-admin_synthos-data) when it ran as an independent control plane. It never signed a receipt. The canonical signing key is the operator control plane\'s; there is exactly one.',
    discoveredAt: '2026-09-18',
    affectedCommits: [],
    scope: 'Never exposed and never used. Revoked so the archived instance can never issue receipts that verify, should it be started again.',
  },
]);

/** sha256:<hex> of the key's SPKI DER encoding, or null when it is not a parseable public key. */
export function receiptKeyFingerprint(publicKeyPem: string): string | null {
  try {
    const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
  } catch {
    return null;
  }
}

// Test-only additions (synthetic keys), refused outside the test runner.
const revokedForTest: RevokedSigningKey[] = [];
export function revokeReceiptKeyForTest(entry: RevokedSigningKey): void {
  if (!process.env.VITEST) throw new Error('revokeReceiptKeyForTest is only available under the test runner');
  revokedForTest.push(entry);
}

export function revokedReceiptKey(publicKeyPem: string): RevokedSigningKey | null {
  const fp = receiptKeyFingerprint(publicKeyPem);
  if (!fp) return null;
  return REVOKED_RECEIPT_SIGNING_KEYS.find((k) => k.fingerprint === fp) ?? revokedForTest.find((k) => k.fingerprint === fp) ?? null;
}

export function getSigningPublicKey(): { publicKeyPem: string; fingerprint: string; algorithm: string } {
  const { publicKeyPem, fingerprint } = ensureSigningKeyPair();
  return { publicKeyPem, fingerprint, algorithm: RECEIPT_SIGNING_ALGORITHM };
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
  const revoked = revokedReceiptKey(publicKeyPem);
  if (revoked) throw new Error(`Refusing to sign: the configured receipt-signing key ${revoked.fingerprint} is REVOKED (${revoked.reason})`);
  const signatureBuffer = crypto.sign(null, Buffer.from(canonicalPayloadStr, 'utf8'), privateKeyPem);
  const signature = signatureBuffer.toString('hex');
  return {
    signature,
    publicKeyPem,
    algorithm: RECEIPT_SIGNING_ALGORITHM,
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

    // 2. A revoked key never verifies — neither as the receipt's key nor as
    //    the configured trusted key — even with a mathematically valid signature.
    if (revokedReceiptKey(receipt.public_key || '') || revokedReceiptKey(trustedKeyInfo.publicKeyPem || '')) {
      return false;
    }

    // 3. Confirm receipt.public_key exactly matches the trusted SynthOS public key
    const cleanReceiptKey = (receipt.public_key || '').trim().replace(/\r\n/g, '\n');
    const cleanTrustedKey = (trustedKeyInfo.publicKeyPem || '').trim().replace(/\r\n/g, '\n');
    if (!cleanReceiptKey || cleanReceiptKey !== cleanTrustedKey) {
      return false;
    }

    // 4. Cryptographically verify signature using trusted SynthOS public key
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
  /** The approval behind this action, for the authority record. */
  approvalId?: string | null;
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

  // Chain every receipt into the workspace's tamper-evident authority record.
  appendReceiptToLedger({
    receiptId,
    taskId: params.taskId,
    payloadJson: params.payloadJson,
    signature: params.signature,
    recordedAt: nowIso,
    approvalId: params.approvalId ?? null,
  });

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
  // Pass VIII / Workstream R — `rowid` tiebreaker: same reasoning as
  // lib/jarvis-sessions.ts's statsFor(). A task can genuinely gate twice in
  // the same millisecond (a fast retry); ORDER BY on the tied created_at
  // column alone has no guaranteed winner.
  const row = db.prepare(
    `SELECT * FROM kil_observations WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
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

