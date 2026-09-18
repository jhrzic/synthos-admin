// ---------------------------------------------------------------------------
// ROUTING-PERFORMANCE EVIDENCE — learned from verified executions, applied
// only by approval.
//
// Every execution that reached Aegis records one sample: task class,
// canonical version, route, completion, instruction compliance, integrity,
// latency, cost, retries, continuations, tool success, human correction.
//
// Samples never change routing by themselves. An operator (or the scheduler,
// if ever enabled) PROPOSES statistics from them — workspace-aware, only for
// groups with enough samples, outlier-resistant (median latency, trimmed-mean
// cost) — and an operator APPROVES a proposal, which becomes the versioned
// statistics the router reads. Weight changes follow the same path and create
// a new routing-policy version. Nothing rewrites policy automatically.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from '../persistence';
import { recordRegistryEvent } from './store';

function ensure(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS routing_performance_samples (
      sample_id TEXT PRIMARY KEY, task_id TEXT, segment_id TEXT, workspace_id TEXT, task_class TEXT NOT NULL,
      canonical_version_id TEXT, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, deployment_id TEXT, routing_decision_id TEXT,
      completed INTEGER NOT NULL, instruction_compliance INTEGER, integrity INTEGER NOT NULL, verified INTEGER NOT NULL,
      latency_ms INTEGER, cost_usd REAL, retries INTEGER NOT NULL DEFAULT 0, continuations INTEGER NOT NULL DEFAULT 0,
      tool_success INTEGER, human_correction INTEGER NOT NULL DEFAULT 0, recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_perf_route ON routing_performance_samples (task_class, provider_id, model_id);
    CREATE TABLE IF NOT EXISTS routing_evidence_proposals (
      proposal_id TEXT PRIMARY KEY, kind TEXT NOT NULL, workspace_scope TEXT NOT NULL, payload_json TEXT NOT NULL,
      status TEXT NOT NULL, proposed_by TEXT NOT NULL, proposed_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, decision_note TEXT
    );
    CREATE TABLE IF NOT EXISTS routing_performance_stats (
      stats_version TEXT NOT NULL, workspace_scope TEXT NOT NULL, task_class TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      stats_json TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, active INTEGER NOT NULL,
      PRIMARY KEY (stats_version, workspace_scope, task_class, provider_id, model_id)
    );
  `);
}

export interface PerformanceSample {
  taskId?: string | null;
  segmentId?: string | null;
  workspaceId?: string | null;
  taskClass: string;
  canonicalVersionId?: string | null;
  providerId: string;
  modelId: string;
  deploymentId?: string | null;
  routingDecisionId?: string | null;
  completed: boolean;
  instructionCompliance: boolean | null;
  integrity: boolean;
  verified: boolean;
  latencyMs?: number | null;
  costUsd?: number | null;
  retries?: number;
  continuations?: number;
  toolSuccess?: boolean | null;
  humanCorrection?: boolean;
}

/** Recorded for executions Aegis reviewed. Never throws into the execution path. */
export function recordPerformanceSample(s: PerformanceSample): string | null {
  try {
    ensure();
    const id = `perf-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const b = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);
    getDatabase().prepare(`INSERT INTO routing_performance_samples (sample_id, task_id, segment_id, workspace_id, task_class, canonical_version_id, provider_id, model_id, deployment_id, routing_decision_id,
        completed, instruction_compliance, integrity, verified, latency_ms, cost_usd, retries, continuations, tool_success, human_correction, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.taskId ?? null, s.segmentId ?? null, s.workspaceId ?? null, s.taskClass, s.canonicalVersionId ?? null, s.providerId, s.modelId, s.deploymentId ?? null, s.routingDecisionId ?? null,
        s.completed ? 1 : 0, b(s.instructionCompliance), s.integrity ? 1 : 0, s.verified ? 1 : 0, s.latencyMs ?? null, s.costUsd ?? null, s.retries ?? 0, s.continuations ?? 0, b(s.toolSuccess), s.humanCorrection ? 1 : 0, new Date().toISOString());
    return id;
  } catch {
    return null;
  }
}

/** A human correction after the fact is evidence too. */
export function markHumanCorrection(taskId: string): number {
  ensure();
  return getDatabase().prepare('UPDATE routing_performance_samples SET human_correction = 1 WHERE task_id = ?').run(taskId).changes;
}

export interface RouteStats {
  samples: number;
  completion: number;
  instructionCompliance: number | null;
  integrity: number;
  medianLatencyMs: number | null;
  trimmedMeanCostUsd: number | null;
  meanRetries: number;
  meanContinuations: number;
  toolSuccess: number | null;
  humanCorrectionRate: number;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function trimmedMean(xs: number[], frac: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * frac);
  const kept = s.slice(k, s.length - k);
  return (kept.length ? kept : s).reduce((a, b) => a + b, 0) / (kept.length || s.length);
}

export function computeStats(rows: any[], trimFraction: number): RouteStats {
  const rate = (xs: Array<number | null>) => { const k = xs.filter((x): x is number => x !== null); return k.length ? k.reduce((a, b) => a + b, 0) / k.length : null; };
  return {
    samples: rows.length,
    completion: rate(rows.map((r) => r.completed)) ?? 0,
    instructionCompliance: rate(rows.map((r) => r.instruction_compliance)),
    integrity: rate(rows.map((r) => r.integrity)) ?? 0,
    medianLatencyMs: median(rows.map((r) => r.latency_ms).filter((x: unknown): x is number => typeof x === 'number')),
    trimmedMeanCostUsd: trimmedMean(rows.map((r) => r.cost_usd).filter((x: unknown): x is number => typeof x === 'number'), trimFraction),
    meanRetries: rate(rows.map((r) => r.retries)) ?? 0,
    meanContinuations: rate(rows.map((r) => r.continuations)) ?? 0,
    toolSuccess: rate(rows.map((r) => r.tool_success)),
    humanCorrectionRate: rate(rows.map((r) => r.human_correction)) ?? 0,
  };
}

/**
 * Propose statistics from verified samples. Only groups with at least
 * `minSamples` qualify. Proposing changes nothing the router reads.
 */
export function proposeRouteStats(p: { actor: string; workspaceId?: string | null; minSamples: number; trimFraction: number }): { proposalId: string | null; groups: number; skipped: Array<{ key: string; samples: number }> } {
  ensure();
  const where = p.workspaceId ? 'AND workspace_id = ?' : '';
  const rows = getDatabase().prepare(`SELECT * FROM routing_performance_samples WHERE integrity = 1 ${where}`).all(...(p.workspaceId ? [p.workspaceId] : [])) as any[];
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const k = `${r.task_class}|${r.provider_id}|${r.model_id}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  const stats: Array<{ taskClass: string; providerId: string; modelId: string; stats: RouteStats }> = [];
  const skipped: Array<{ key: string; samples: number }> = [];
  for (const [k, rs] of groups) {
    if (rs.length < p.minSamples) { skipped.push({ key: k, samples: rs.length }); continue; }
    const [taskClass, providerId, modelId] = k.split('|');
    stats.push({ taskClass, providerId, modelId, stats: computeStats(rs, p.trimFraction) });
  }
  if (!stats.length) return { proposalId: null, groups: 0, skipped };
  const proposalId = `rprop-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  getDatabase().prepare(`INSERT INTO routing_evidence_proposals (proposal_id, kind, workspace_scope, payload_json, status, proposed_by, proposed_at) VALUES (?, 'ROUTE_STATS', ?, ?, 'PROPOSED', ?, ?)`)
    .run(proposalId, p.workspaceId ?? '*', JSON.stringify({ stats, minSamples: p.minSamples, trimFraction: p.trimFraction }), p.actor, new Date().toISOString());
  recordRegistryEvent('ROUTING_EVIDENCE_PROPOSED', { actor: p.actor, proposalId, groups: stats.length, workspaceScope: p.workspaceId ?? '*' });
  return { proposalId, groups: stats.length, skipped };
}

/** Propose new policy weights. Approval creates a new routing-policy version. */
export function proposePolicyWeights(p: { actor: string; basePolicyId: string; baseVersion: string; newVersion: string; weights: Record<string, number>; rationale: string }): { ok: true; proposalId: string } | { ok: false; error: string } {
  ensure();
  if (!Object.keys(p.weights).length || Object.values(p.weights).some((w) => !(typeof w === 'number' && w >= 0 && w <= 1))) return { ok: false, error: 'each proposed weight must be a number within 0..1' };
  if (!/^\d+\.\d+\.\d+$/.test(p.newVersion)) return { ok: false, error: 'newVersion must be semver' };
  const proposalId = `rprop-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  getDatabase().prepare(`INSERT INTO routing_evidence_proposals (proposal_id, kind, workspace_scope, payload_json, status, proposed_by, proposed_at) VALUES (?, 'POLICY_WEIGHTS', '*', ?, 'PROPOSED', ?, ?)`)
    .run(proposalId, JSON.stringify(p), p.actor, new Date().toISOString());
  recordRegistryEvent('ROUTING_POLICY_PROPOSED', { actor: p.actor, proposalId, newVersion: p.newVersion });
  return { ok: true, proposalId };
}

export function decideProposal(p: { proposalId: string; actor: string; approve: boolean; note?: string }): { ok: true } | { ok: false; error: string } {
  ensure();
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM routing_evidence_proposals WHERE proposal_id = ?').get(p.proposalId) as any;
  if (!row) return { ok: false, error: 'no such proposal' };
  if (row.status !== 'PROPOSED') return { ok: false, error: `proposal is already ${row.status}` };
  const now = new Date().toISOString();
  if (!p.approve) {
    db.prepare("UPDATE routing_evidence_proposals SET status = 'REJECTED', decided_by = ?, decided_at = ?, decision_note = ? WHERE proposal_id = ?").run(p.actor, now, p.note ?? null, p.proposalId);
    recordRegistryEvent('ROUTING_EVIDENCE_REJECTED', { actor: p.actor, proposalId: p.proposalId });
    return { ok: true };
  }
  const payload = JSON.parse(row.payload_json);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (row.kind === 'ROUTE_STATS') {
      db.prepare('UPDATE routing_performance_stats SET active = 0 WHERE workspace_scope = ?').run(row.workspace_scope);
      const ins = db.prepare('INSERT INTO routing_performance_stats (stats_version, workspace_scope, task_class, provider_id, model_id, stats_json, approved_by, approved_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)');
      for (const s of payload.stats) ins.run(p.proposalId, row.workspace_scope, s.taskClass, s.providerId, s.modelId, JSON.stringify(s.stats), p.actor, now);
    } else if (row.kind === 'POLICY_WEIGHTS') {
      const base = db.prepare('SELECT record_json FROM registry_routing_policies WHERE policy_id = ? AND version = ?').get(payload.basePolicyId, payload.baseVersion) as any;
      if (!base) throw new Error('base policy version not found');
      const rec = { ...JSON.parse(base.record_json), version: payload.newVersion, weights: { ...JSON.parse(base.record_json).weights, ...payload.weights } };
      const total = Object.values(rec.weights as Record<string, number>).reduce((a, b) => a + b, 0);
      if (!(total > 0.5 && total <= 1.5)) throw new Error(`the merged weights sum to ${total.toFixed(3)}; they must sum to roughly 1`);
      db.prepare("UPDATE registry_routing_policies SET status = 'SUPERSEDED' WHERE policy_id = ? AND status = 'ACTIVE'").run(payload.basePolicyId);
      db.prepare("INSERT INTO registry_routing_policies (policy_id, version, record_json, status, source, proposed_by, approved_by, created_at, activated_at) VALUES (?, ?, ?, 'ACTIVE', 'APPROVED_PROPOSAL', ?, ?, ?, ?)")
        .run(payload.basePolicyId, payload.newVersion, JSON.stringify(rec), row.proposed_by, p.actor, now, now);
    }
    db.prepare("UPDATE routing_evidence_proposals SET status = 'APPROVED', decided_by = ?, decided_at = ?, decision_note = ? WHERE proposal_id = ?").run(p.actor, now, p.note ?? null, p.proposalId);
    db.exec('COMMIT');
  } catch (err: any) {
    try { db.exec('ROLLBACK'); } catch { /* none */ }
    return { ok: false, error: String(err?.message || err) };
  }
  recordRegistryEvent('ROUTING_EVIDENCE_APPROVED', { actor: p.actor, proposalId: p.proposalId, kind: row.kind });
  return { ok: true };
}

export function listProposals(): any[] {
  ensure();
  return (getDatabase().prepare('SELECT * FROM routing_evidence_proposals ORDER BY proposed_at DESC LIMIT 100').all() as any[]).map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
}

/** The APPROVED statistics the router may use (workspace-specific first, else global). Null → no approved evidence. */
export function approvedRouteStats(providerId: string, modelId: string, taskClass: string, workspaceId?: string | null): (RouteStats & { statsVersion: string }) | null {
  try {
    ensure();
    const q = getDatabase().prepare('SELECT stats_json, stats_version FROM routing_performance_stats WHERE active = 1 AND workspace_scope = ? AND task_class = ? AND provider_id = ? AND model_id = ?');
    const r = (workspaceId ? q.get(workspaceId, taskClass, providerId, modelId) : null) ?? q.get('*', taskClass, providerId, modelId);
    return r ? { ...JSON.parse((r as any).stats_json), statsVersion: (r as any).stats_version } : null;
  } catch {
    return null;
  }
}

export function sampleCount(filter: { taskClass?: string; providerId?: string } = {}): number {
  ensure();
  const where: string[] = []; const args: any[] = [];
  if (filter.taskClass) { where.push('task_class = ?'); args.push(filter.taskClass); }
  if (filter.providerId) { where.push('provider_id = ?'); args.push(filter.providerId); }
  return (getDatabase().prepare(`SELECT COUNT(*) AS n FROM routing_performance_samples ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).get(...args) as any).n;
}
