// ---------------------------------------------------------------------------
// TASK-SPECIFIC QUALIFICATION.
//
// A model being admitted to the registry (qualified + enabled on its record)
// says it MAY be called. It does not say it is any good at a given kind of
// work. A qualification record says: THIS canonical version, on THIS route
// and deployment, passed THIS evaluation suite for THIS task class, within
// THIS scope (capabilities, modality, output contract, context range, tools,
// privacy class), and an operator approved it with sandbox/canary evidence.
//
// Nothing executes for a task class without a VALID qualification for it.
//
// Task classes and evaluation suites are registry DATA (./data/*.json,
// installable/extendable), not code. Evaluations are deterministic checks
// (exact, JSON keys, contains, regex) over outputs produced through the
// normal spend-guarded dispatch; no model grades another model.
//
// A qualification binds to a hash of everything it was granted on. When any
// of them changes — canonical version or its mapping, the route's manifest
// substance, the deployment (endpoint, region, credential binding, limits,
// retention), the model's capabilities, limits, contracts or pricing rates,
// the adapter build, the suite or its thresholds — it reads INVALIDATED with
// the component named, and the router will not use it.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from '../persistence';
import { canonicalJson, sha256, modelSubstanceHash } from './schema';
import { getStoredModel, getStoredProvider, recordRegistryEvent } from './store';
import { routeIdentity, deploymentsOf, deploymentHash, providerBodyForDeployment } from './identity';
import { getProtocolAdapter } from './protocols';
import { resolveProviderEndpoint, isTestEnvironment } from './endpoints';
import type { ProviderManifestBody, PrivacyClass } from './types';
import taskClassData from './data/task-classes.json';
import suiteData from './data/eval-suites.json';

// ---- task classes -------------------------------------------------------------

export interface TaskClass {
  taskClassId: string;
  displayName: string;
  description: string;
  outputContract: 'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT';
  requiredCapabilities: string[];
  modality: { input: string[]; output: string[] };
  segmentable: boolean;
  evalSuiteId: string;
  minQuality: number;
  minReliability: number;
  qualificationValidityDays: number;
  minContextTokens: number | null;
  requiredTools: string[];
  callSites: string[];
  defaultForContracts: string[];
  /** How many continuation segments a truncated NARRATIVE may use (each a separate spend-guarded call). */
  maxContinuations?: number;
}

export interface EvalCase { caseId: string; prompt: string; check: EvalCheck }
export type EvalCheck =
  | { type: 'EXACT'; expected: string }
  | { type: 'JSON_KEYS'; requiredKeys: string[]; expectedValues?: Record<string, unknown> }
  | { type: 'CONTAINS_ALL'; terms: string[]; maxChars?: number }
  | { type: 'CONTAINS_ANY'; terms: string[]; maxChars?: number }
  | { type: 'NOT_CONTAINS'; terms: string[]; maxChars?: number }
  | { type: 'REGEX'; pattern: string; flags?: string };
export interface EvalSuite { suiteId: string; version: string; taskClass: string; repetitions: number; cases: EvalCase[] }

let ensured = false;
export function ensureQualificationTables(): void {
  const db = getDatabase();
  if (ensured) {
    try { db.prepare('SELECT 1 FROM registry_qualifications LIMIT 1').get(); return; } catch { ensured = false; }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_task_classes (
      task_class_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, record_hash TEXT NOT NULL,
      source TEXT NOT NULL, data_version TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registry_eval_suites (
      suite_id TEXT NOT NULL, version TEXT NOT NULL, record_json TEXT NOT NULL, record_hash TEXT NOT NULL,
      source TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (suite_id, version)
    );
    CREATE TABLE IF NOT EXISTS registry_qualification_runs (
      run_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, deployment_id TEXT NOT NULL,
      canonical_version_id TEXT, task_class TEXT NOT NULL, suite_id TEXT NOT NULL, suite_version TEXT NOT NULL,
      binding_json TEXT NOT NULL, status TEXT NOT NULL, quality REAL, reliability REAL, results_json TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, evaluated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS registry_qualifications (
      qualification_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, deployment_id TEXT NOT NULL,
      canonical_version_id TEXT, task_class TEXT NOT NULL, scope_json TEXT NOT NULL,
      quality REAL NOT NULL, reliability REAL NOT NULL, min_quality REAL NOT NULL, min_reliability REAL NOT NULL,
      suite_id TEXT NOT NULL, suite_version TEXT NOT NULL, run_id TEXT, evidence_json TEXT NOT NULL,
      binding_json TEXT NOT NULL, binding_hash TEXT NOT NULL, status TEXT NOT NULL,
      approved_by TEXT NOT NULL, qualified_at TEXT NOT NULL, expires_at TEXT NOT NULL, review_at TEXT,
      revoked_reason TEXT, revoked_by TEXT, revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_registry_qualifications_route ON registry_qualifications (provider_id, model_id, task_class);
  `);
  const now = new Date().toISOString();
  const tc = db.prepare(`INSERT INTO registry_task_classes (task_class_id, record_json, record_hash, source, data_version, updated_by, updated_at) VALUES (?, ?, ?, 'BUNDLED', ?, 'bundled-data', ?)
    ON CONFLICT(task_class_id) DO UPDATE SET record_json = excluded.record_json, record_hash = excluded.record_hash, data_version = excluded.data_version, updated_at = excluded.updated_at
    WHERE registry_task_classes.source = 'BUNDLED' AND registry_task_classes.record_hash != excluded.record_hash`);
  for (const c of (taskClassData as any).taskClasses as TaskClass[]) tc.run(c.taskClassId, JSON.stringify(c), sha256(canonicalJson(c)), (taskClassData as any).dataVersion, now);
  const su = db.prepare(`INSERT OR IGNORE INTO registry_eval_suites (suite_id, version, record_json, record_hash, source, updated_at) VALUES (?, ?, ?, ?, 'BUNDLED', ?)`);
  for (const s of (suiteData as any).suites as EvalSuite[]) su.run(s.suiteId, s.version, JSON.stringify(s), sha256(canonicalJson(s)), now);
  ensured = true;
}

export function listTaskClasses(): TaskClass[] {
  ensureQualificationTables();
  return (getDatabase().prepare('SELECT record_json FROM registry_task_classes ORDER BY task_class_id').all() as any[]).map((r) => JSON.parse(r.record_json));
}

export function getTaskClass(id: string): (TaskClass & { recordHash: string }) | null {
  ensureQualificationTables();
  const r = getDatabase().prepare('SELECT record_json, record_hash FROM registry_task_classes WHERE task_class_id = ?').get(id) as any;
  return r ? { ...JSON.parse(r.record_json), recordHash: r.record_hash } : null;
}

/** An operator adds or edits a task class (data, audited by the caller). */
export function upsertTaskClass(c: TaskClass, actor: string): { ok: true } | { ok: false; error: string } {
  ensureQualificationTables();
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(c?.taskClassId || '')) return { ok: false, error: 'taskClassId must be lowercase snake_case' };
  if (!['NARRATIVE', 'LITERAL', 'JSON_OBJECT'].includes(c.outputContract)) return { ok: false, error: 'outputContract is invalid' };
  if (!(c.minQuality >= 0 && c.minQuality <= 1 && c.minReliability >= 0 && c.minReliability <= 1)) return { ok: false, error: 'minQuality/minReliability must be within 0..1' };
  if (!getSuite(c.evalSuiteId)) return { ok: false, error: `evaluation suite ${c.evalSuiteId} does not exist` };
  const rec: TaskClass = {
    taskClassId: c.taskClassId, displayName: String(c.displayName || c.taskClassId), description: String(c.description || ''), outputContract: c.outputContract,
    requiredCapabilities: [...(c.requiredCapabilities || [])], modality: { input: [...(c.modality?.input || ['text'])], output: [...(c.modality?.output || ['text'])] },
    segmentable: !!c.segmentable, evalSuiteId: c.evalSuiteId, minQuality: c.minQuality, minReliability: c.minReliability,
    qualificationValidityDays: Math.max(1, Math.min(365, Number(c.qualificationValidityDays) || 60)), minContextTokens: c.minContextTokens ?? null,
    requiredTools: [...(c.requiredTools || [])], callSites: [...(c.callSites || [])], defaultForContracts: [...(c.defaultForContracts || [])],
    maxContinuations: Math.max(0, Math.min(6, Number(c.maxContinuations ?? (c.segmentable ? 2 : 0)) || 0)),
  };
  getDatabase().prepare(`INSERT INTO registry_task_classes (task_class_id, record_json, record_hash, source, data_version, updated_by, updated_at) VALUES (?, ?, ?, 'ADMIN', 'admin', ?, ?)
    ON CONFLICT(task_class_id) DO UPDATE SET record_json = excluded.record_json, record_hash = excluded.record_hash, source = 'ADMIN', updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(rec.taskClassId, JSON.stringify(rec), sha256(canonicalJson(rec)), actor, new Date().toISOString());
  recordRegistryEvent('TASK_CLASS_CHANGED', { actor, taskClassId: rec.taskClassId });
  return { ok: true };
}

/** The task class for a call: explicit, else the class that lists the call site, else the contract's default. */
export function resolveTaskClass(p: { taskClass?: string | null; callSite?: string | null; outputContract?: string | null }): TaskClass | null {
  const all = listTaskClasses();
  if (p.taskClass) return all.find((c) => c.taskClassId === p.taskClass) ?? null;
  if (p.callSite) {
    const site = p.callSite;
    // Exact call sites first; then a data-declared prefix ("x.*").
    const bySite = all.find((c) => c.callSites.includes(site))
      ?? all.find((c) => c.callSites.some((cs) => cs.endsWith('.*') && site.startsWith(cs.slice(0, -1))));
    if (bySite) return bySite;
  }
  if (p.outputContract) return all.find((c) => c.defaultForContracts.includes(p.outputContract!)) ?? null;
  return null;
}

export function getSuite(suiteId: string, version?: string): (EvalSuite & { recordHash: string }) | null {
  ensureQualificationTables();
  const r = (version
    ? getDatabase().prepare('SELECT record_json, record_hash FROM registry_eval_suites WHERE suite_id = ? AND version = ?').get(suiteId, version)
    : getDatabase().prepare('SELECT record_json, record_hash FROM registry_eval_suites WHERE suite_id = ? ORDER BY version DESC LIMIT 1').get(suiteId)) as any;
  return r ? { ...JSON.parse(r.record_json), recordHash: r.record_hash } : null;
}

// ---- deterministic evaluation ---------------------------------------------------

export function evaluateCase(check: EvalCheck, output: string): { pass: boolean; detail: string } {
  const out = String(output ?? '');
  const within = (max?: number) => (typeof max === 'number' && out.length > max ? `output is ${out.length} chars; limit ${max}` : null);
  switch (check.type) {
    case 'EXACT':
      return out.trim() === check.expected ? { pass: true, detail: 'exact match' } : { pass: false, detail: 'output does not match exactly' };
    case 'JSON_KEYS': {
      let obj: any;
      try { obj = JSON.parse(out.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); } catch { return { pass: false, detail: 'output is not valid JSON' }; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { pass: false, detail: 'output is not a JSON object' };
      const missing = check.requiredKeys.filter((k) => !(k in obj));
      if (missing.length) return { pass: false, detail: `missing keys: ${missing.join(', ')}` };
      for (const [k, v] of Object.entries(check.expectedValues || {})) if (JSON.stringify(obj[k]) !== JSON.stringify(v)) return { pass: false, detail: `key ${k} has an unexpected value` };
      return { pass: true, detail: 'required keys present' };
    }
    case 'CONTAINS_ALL': {
      const over = within(check.maxChars); if (over) return { pass: false, detail: over };
      const missing = check.terms.filter((t) => !out.toLowerCase().includes(t.toLowerCase()));
      return missing.length ? { pass: false, detail: `missing: ${missing.join(', ')}` } : { pass: true, detail: 'all terms present' };
    }
    case 'CONTAINS_ANY': {
      const over = within(check.maxChars); if (over) return { pass: false, detail: over };
      return check.terms.some((t) => out.toLowerCase().includes(t.toLowerCase())) ? { pass: true, detail: 'a required term is present' } : { pass: false, detail: 'none of the terms is present' };
    }
    case 'NOT_CONTAINS': {
      const over = within(check.maxChars); if (over) return { pass: false, detail: over };
      const hit = check.terms.filter((t) => out.toLowerCase().includes(t.toLowerCase()));
      return hit.length ? { pass: false, detail: `contains prohibited: ${hit.join(', ')}` } : { pass: true, detail: 'no prohibited term' };
    }
    case 'REGEX': {
      let re: RegExp;
      try { re = new RegExp(check.pattern, (check.flags || '').replace(/[^imsu]/g, '')); } catch { return { pass: false, detail: 'suite pattern is invalid' }; }
      return re.test(out) ? { pass: true, detail: 'pattern matched' } : { pass: false, detail: 'pattern did not match' };
    }
  }
}

// ---- binding --------------------------------------------------------------------

export interface QualificationBinding {
  canonicalVersionId: string | null;
  mappingStatus: string;
  modelSubstance: string;
  routeSubstance: string;
  deployment: string;
  adapterVersion: string | null;
  endpoint: string | null;
  suite: string;
  taskClass: string;
}

function routeSubstance(body: ProviderManifestBody): string {
  // Everything about the route except the model list and version label.
  return sha256(canonicalJson({ ...body, deployments: undefined }));
}

export function currentBinding(providerId: string, modelId: string, deploymentId: string, taskClassId: string, suiteId: string, suiteVersion: string): QualificationBinding | { error: string } {
  const m = getStoredModel(providerId, modelId);
  const p = getStoredProvider(providerId);
  if (!m || !p) return { error: `${providerId}/${modelId} is not registered` };
  const body = p.manifest.provider;
  const dep = deploymentsOf(body).find((d) => d.deploymentId === deploymentId);
  if (!dep) return { error: `deployment ${deploymentId} does not exist on ${providerId}` };
  const tc = getTaskClass(taskClassId);
  if (!tc) return { error: `task class ${taskClassId} does not exist` };
  const suite = getSuite(suiteId, suiteVersion);
  if (!suite) return { error: `suite ${suiteId}@${suiteVersion} does not exist` };
  const id = routeIdentity(providerId, modelId);
  const ep = resolveProviderEndpoint(providerBodyForDeployment(body, dep));
  const adapter = getProtocolAdapter(body.protocol);
  return {
    canonicalVersionId: id.canonicalVersionId, mappingStatus: id.status,
    modelSubstance: modelSubstanceHash(providerId, m.record), routeSubstance: routeSubstance(body), deployment: deploymentHash(dep),
    adapterVersion: adapter?.adapterVersion ?? null, endpoint: ep.ok ? ep.baseUrl : null,
    suite: suite.recordHash, taskClass: tc.recordHash,
  };
}

const BINDING_LABELS: Record<keyof QualificationBinding, string> = {
  canonicalVersionId: 'the canonical model version', mappingStatus: 'the route→version mapping', modelSubstance: 'the model record (capabilities, limits, contracts, pricing rates, tools)',
  routeSubstance: 'the route (protocol, hosts, auth, billing, retention, restrictions)', deployment: 'the deployment (endpoint, region, credential binding, limits, retention)',
  adapterVersion: 'the adapter version', endpoint: 'the resolved endpoint', suite: 'the evaluation suite or its thresholds', taskClass: 'the task class definition (thresholds)',
};

/** '*' is written only by the test-fixture insert (refused outside tests): a fixture is not bound to a test double's port. */
export function bindingDiff(stored: QualificationBinding, now: QualificationBinding): string[] {
  return (Object.keys(BINDING_LABELS) as Array<keyof QualificationBinding>)
    .filter((k) => !(k === 'endpoint' && stored.endpoint === '*' && isTestEnvironment()) && stored[k] !== now[k])
    .map((k) => BINDING_LABELS[k]);
}

// ---- runs ---------------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export interface CaseResult {
  caseId: string;
  repetition: number;
  output: string | null;
  termination: 'COMPLETE' | 'INCOMPLETE' | 'NOT_REPORTED' | 'ERROR' | 'BLOCKED';
  usageId: string | null;
  receiptId: string | null;
  source: 'SANDBOX' | 'CANARY';
  pass?: boolean;
  detail?: string;
}

export function startQualificationRun(p: { providerId: string; modelId: string; deploymentId?: string; taskClass: string; actor: string }): { ok: true; runId: string; suite: EvalSuite } | { ok: false; error: string } {
  ensureQualificationTables();
  const tc = getTaskClass(p.taskClass);
  if (!tc) return { ok: false, error: `task class ${p.taskClass} does not exist` };
  const suite = getSuite(tc.evalSuiteId);
  if (!suite) return { ok: false, error: `task class ${p.taskClass} names suite ${tc.evalSuiteId}, which does not exist` };
  const deploymentId = p.deploymentId || 'default';
  const binding = currentBinding(p.providerId, p.modelId, deploymentId, p.taskClass, suite.suiteId, suite.version);
  if ('error' in binding) return { ok: false, error: binding.error };
  const runId = newId('qrun');
  getDatabase().prepare(`INSERT INTO registry_qualification_runs (run_id, provider_id, model_id, deployment_id, canonical_version_id, task_class, suite_id, suite_version, binding_json, status, results_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', '[]', ?, ?)`)
    .run(runId, p.providerId, p.modelId, deploymentId, binding.canonicalVersionId, p.taskClass, suite.suiteId, suite.version, JSON.stringify(binding), p.actor, new Date().toISOString());
  recordRegistryEvent('QUALIFICATION_RUN_STARTED', { actor: p.actor, providerId: p.providerId, modelId: p.modelId, runId, taskClass: p.taskClass, suite: `${suite.suiteId}@${suite.version}` });
  return { ok: true, runId, suite };
}

export function getRun(runId: string): any | null {
  ensureQualificationTables();
  const r = getDatabase().prepare('SELECT * FROM registry_qualification_runs WHERE run_id = ?').get(runId) as any;
  return r ? { ...r, binding: JSON.parse(r.binding_json), results: JSON.parse(r.results_json) as CaseResult[] } : null;
}

/** Record one case's output, produced by a sandbox or canary execution through the spend guard. */
export function recordCaseResult(runId: string, result: CaseResult): { ok: true } | { ok: false; error: string } {
  const run = getRun(runId);
  if (!run) return { ok: false, error: 'no such run' };
  if (run.status !== 'OPEN') return { ok: false, error: `run is ${run.status}` };
  const suite = getSuite(run.suite_id, run.suite_version)!;
  const c = suite.cases.find((x) => x.caseId === result.caseId);
  if (!c) return { ok: false, error: `case ${result.caseId} is not in ${suite.suiteId}` };
  const scored = result.output !== null && result.termination !== 'ERROR' && result.termination !== 'BLOCKED' ? evaluateCase(c.check, result.output) : { pass: false, detail: `no output (${result.termination})` };
  // A response the provider did not finish is not a pass, whatever it says.
  const pass = scored.pass && result.termination === 'COMPLETE';
  const results = [...run.results.filter((r: CaseResult) => !(r.caseId === result.caseId && r.repetition === result.repetition)), { ...result, output: result.output === null ? null : result.output.slice(0, 4000), pass, detail: result.termination === 'COMPLETE' ? scored.detail : `${scored.detail}; provider termination ${result.termination}` }];
  getDatabase().prepare('UPDATE registry_qualification_runs SET results_json = ? WHERE run_id = ?').run(JSON.stringify(results), runId);
  return { ok: true };
}

/**
 * Deterministic scoring. quality = share of cases whose checks pass (every
 * repetition counted); reliability = share of attempts the provider finished.
 * Every case × repetition must have a result.
 */
export function evaluateRun(runId: string): { ok: true; status: 'PASSED' | 'FAILED'; quality: number; reliability: number; reasons: string[] } | { ok: false; error: string } {
  const run = getRun(runId);
  if (!run) return { ok: false, error: 'no such run' };
  if (run.status !== 'OPEN') return { ok: false, error: `run is already ${run.status}` };
  const suite = getSuite(run.suite_id, run.suite_version)!;
  const tc = getTaskClass(run.task_class)!;
  const expected = suite.cases.length * Math.max(1, suite.repetitions);
  const results = run.results as CaseResult[];
  if (results.length < expected) return { ok: false, error: `${results.length} of ${expected} case results recorded; every case and repetition must run before scoring` };
  const quality = results.filter((r) => r.pass).length / results.length;
  const reliability = results.filter((r) => r.termination === 'COMPLETE').length / results.length;
  const reasons: string[] = [];
  if (quality < tc.minQuality) reasons.push(`quality ${quality.toFixed(3)} is below ${tc.minQuality}`);
  if (reliability < tc.minReliability) reasons.push(`reliability ${reliability.toFixed(3)} is below ${tc.minReliability}`);
  const status = reasons.length ? 'FAILED' : 'PASSED';
  getDatabase().prepare('UPDATE registry_qualification_runs SET status = ?, quality = ?, reliability = ?, evaluated_at = ? WHERE run_id = ?').run(status, quality, reliability, new Date().toISOString(), runId);
  recordRegistryEvent('QUALIFICATION_RUN_EVALUATED', { runId, status, quality, reliability, providerId: run.provider_id, modelId: run.model_id, taskClass: run.task_class });
  return { ok: true, status, quality, reliability, reasons };
}

// ---- approval -------------------------------------------------------------------

export interface QualificationScope {
  capabilities: string[];
  modality: { input: string[]; output: string[] };
  outputContract: 'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT';
  contextRange: { min: number; max: number | null };
  tools: string[];
  privacyClass: PrivacyClass;
}

function evidenceRefsValid(run: any): { ok: true; usageIds: string[]; receiptIds: string[] } | { ok: false; error: string } {
  const results = run.results as CaseResult[];
  const usageIds = results.map((r) => r.usageId).filter((x): x is string => !!x);
  const receiptIds = results.map((r) => r.receiptId).filter((x): x is string => !!x);
  if (!results.some((r) => r.source === 'CANARY')) return { ok: false, error: 'no canary evidence: at least one case must have run as a CANARY through the normal execution path' };
  const db = getDatabase();
  let proven = 0;
  for (const u of usageIds) {
    const row = db.prepare('SELECT provider, model, status FROM provider_usage WHERE usage_id = ?').get(u) as any;
    if (row && row.provider === run.provider_id && row.model === run.model_id && row.status === 'SUCCESS') proven++;
  }
  if (proven === 0) return { ok: false, error: 'no case result is backed by a SUCCESS ledger row for this exact provider/model; outputs without a ledger record are claims, not evidence' };
  return { ok: true, usageIds, receiptIds };
}

export function approveQualification(p: { runId: string; actor: string; scope?: Partial<QualificationScope>; validityDays?: number }): { ok: true; qualificationId: string } | { ok: false; error: string } {
  ensureQualificationTables();
  const run = getRun(p.runId);
  if (!run) return { ok: false, error: 'no such run' };
  if (run.status !== 'PASSED') return { ok: false, error: `only a PASSED run can be approved (this run is ${run.status})` };
  const ev = evidenceRefsValid(run);
  if (!ev.ok) return { ok: false, error: ev.error };
  const now = currentBinding(run.provider_id, run.model_id, run.deployment_id, run.task_class, run.suite_id, run.suite_version);
  if ('error' in now) return { ok: false, error: now.error };
  const drift = bindingDiff(run.binding, now);
  if (drift.length) return { ok: false, error: `the run no longer describes this route: ${drift.join('; ')} changed since it ran` };
  const id = routeIdentity(run.provider_id, run.model_id);
  if (!id.resolved) return { ok: false, error: `the route's canonical version is ${id.status}; approve its mapping first` };
  const tc = getTaskClass(run.task_class)!;
  const m = getStoredModel(run.provider_id, run.model_id)!;
  const body = getStoredProvider(run.provider_id)!.manifest.provider;
  const dep = deploymentsOf(body).find((d) => d.deploymentId === run.deployment_id)!;
  const caps = m.record.capabilities.filter((c) => c.supported).map((c) => c.id);
  const scope: QualificationScope = {
    // The scope can only narrow what the model declares, never widen it.
    capabilities: (p.scope?.capabilities ?? tc.requiredCapabilities).filter((c) => caps.includes(c)),
    modality: p.scope?.modality ?? tc.modality,
    outputContract: tc.outputContract,
    contextRange: { min: Math.max(0, p.scope?.contextRange?.min ?? 0), max: Math.min(p.scope?.contextRange?.max ?? m.record.limits.contextTokens ?? Number.MAX_SAFE_INTEGER, m.record.limits.contextTokens ?? Number.MAX_SAFE_INTEGER) },
    tools: p.scope?.tools ?? tc.requiredTools,
    privacyClass: dep.privacyClass,
  };
  const missing = tc.requiredCapabilities.filter((c) => !scope.capabilities.includes(c));
  if (missing.length) return { ok: false, error: `the model does not declare ${missing.join(', ')}, which ${tc.taskClassId} requires` };
  const days = Math.max(1, Math.min(tc.qualificationValidityDays, p.validityDays ?? tc.qualificationValidityDays));
  const qualifiedAt = new Date();
  const qid = newId('qual');
  getDatabase().prepare(`INSERT INTO registry_qualifications (qualification_id, provider_id, model_id, deployment_id, canonical_version_id, task_class, scope_json, quality, reliability, min_quality, min_reliability,
      suite_id, suite_version, run_id, evidence_json, binding_json, binding_hash, status, approved_by, qualified_at, expires_at, review_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUALIFIED', ?, ?, ?, ?)`)
    .run(qid, run.provider_id, run.model_id, run.deployment_id, now.canonicalVersionId, run.task_class, JSON.stringify(scope), run.quality, run.reliability, tc.minQuality, tc.minReliability,
      run.suite_id, run.suite_version, run.run_id, JSON.stringify({ usageIds: ev.usageIds, receiptIds: ev.receiptIds }), JSON.stringify(now), sha256(canonicalJson(now)),
      p.actor, qualifiedAt.toISOString(), new Date(qualifiedAt.getTime() + days * 86_400_000).toISOString(), new Date(qualifiedAt.getTime() + Math.floor(days * 0.8) * 86_400_000).toISOString());
  recordRegistryEvent('TASK_QUALIFICATION_APPROVED', { actor: p.actor, qualificationId: qid, providerId: run.provider_id, modelId: run.model_id, deploymentId: run.deployment_id, taskClass: run.task_class, canonicalVersionId: now.canonicalVersionId });
  return { ok: true, qualificationId: qid };
}

export function revokeQualification(qualificationId: string, actor: string, reason: string): boolean {
  ensureQualificationTables();
  const r = getDatabase().prepare("UPDATE registry_qualifications SET status = 'REVOKED', revoked_reason = ?, revoked_by = ?, revoked_at = ? WHERE qualification_id = ? AND status = 'QUALIFIED'")
    .run(reason || 'revoked by an operator', actor, new Date().toISOString(), qualificationId);
  if (r.changes) recordRegistryEvent('TASK_QUALIFICATION_REVOKED', { actor, qualificationId, reason });
  return r.changes > 0;
}

/** Test fixtures only: a qualification without a run. Refused outside the test environment. */
export function insertQualificationForTest(p: { providerId: string; modelId: string; taskClass: string; deploymentId?: string; quality?: number; reliability?: number }): string {
  if (!isTestEnvironment()) throw new Error('insertQualificationForTest is test-only');
  ensureQualificationTables();
  const tc = getTaskClass(p.taskClass);
  if (!tc) throw new Error(`no task class ${p.taskClass}`);
  const suite = getSuite(tc.evalSuiteId)!;
  const deploymentId = p.deploymentId || 'default';
  const b = currentBinding(p.providerId, p.modelId, deploymentId, p.taskClass, suite.suiteId, suite.version);
  if ('error' in b) throw new Error(b.error);
  b.endpoint = '*';
  const m = getStoredModel(p.providerId, p.modelId)!;
  const body = getStoredProvider(p.providerId)!.manifest.provider;
  const dep = deploymentsOf(body).find((d) => d.deploymentId === deploymentId)!;
  const qid = newId('qual');
  const scope: QualificationScope = {
    capabilities: m.record.capabilities.filter((c) => c.supported).map((c) => c.id), modality: tc.modality, outputContract: tc.outputContract,
    contextRange: { min: 0, max: m.record.limits.contextTokens }, tools: tc.requiredTools, privacyClass: dep.privacyClass,
  };
  const now = new Date();
  getDatabase().prepare(`INSERT INTO registry_qualifications (qualification_id, provider_id, model_id, deployment_id, canonical_version_id, task_class, scope_json, quality, reliability, min_quality, min_reliability,
      suite_id, suite_version, run_id, evidence_json, binding_json, binding_hash, status, approved_by, qualified_at, expires_at, review_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '{"fixture":true}', ?, ?, 'QUALIFIED', 'test-fixture', ?, ?, NULL)`)
    .run(qid, p.providerId, p.modelId, deploymentId, b.canonicalVersionId, p.taskClass, JSON.stringify(scope), p.quality ?? 1, p.reliability ?? 1, tc.minQuality, tc.minReliability,
      suite.suiteId, suite.version, JSON.stringify(b), sha256(canonicalJson(b)), now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString());
  return qid;
}

// ---- reading qualifications --------------------------------------------------------

export type QualificationState = 'VALID' | 'EXPIRED' | 'INVALIDATED' | 'REVOKED';

export interface QualificationView {
  qualificationId: string;
  providerId: string;
  modelId: string;
  deploymentId: string;
  canonicalVersionId: string | null;
  taskClass: string;
  scope: QualificationScope;
  quality: number;
  reliability: number;
  minQuality: number;
  minReliability: number;
  suite: string;
  runId: string | null;
  evidence: { usageIds?: string[]; receiptIds?: string[]; fixture?: boolean };
  approvedBy: string;
  qualifiedAt: string;
  expiresAt: string;
  reviewAt: string | null;
  state: QualificationState;
  stateReasons: string[];
}

function viewRow(r: any): QualificationView {
  const stored = JSON.parse(r.binding_json) as QualificationBinding;
  const reasons: string[] = [];
  let state: QualificationState = 'VALID';
  if (r.status === 'REVOKED') { state = 'REVOKED'; reasons.push(r.revoked_reason || 'revoked'); }
  else if (Date.parse(r.expires_at) <= Date.now()) { state = 'EXPIRED'; reasons.push(`expired ${r.expires_at}; re-run the suite`); }
  else {
    const now = currentBinding(r.provider_id, r.model_id, r.deployment_id, r.task_class, r.suite_id, r.suite_version);
    if ('error' in now) { state = 'INVALIDATED'; reasons.push(now.error); }
    else {
      const d = bindingDiff(stored, now);
      if (d.length) { state = 'INVALIDATED'; reasons.push(...d.map((x) => `${x} changed since qualification`)); }
      else if (!['AUTHORITATIVE', 'APPROVED', 'IMPLICIT_PUBLISHER'].includes(now.mappingStatus)) { state = 'INVALIDATED'; reasons.push(`route mapping is ${now.mappingStatus}`); }
    }
  }
  return {
    qualificationId: r.qualification_id, providerId: r.provider_id, modelId: r.model_id, deploymentId: r.deployment_id, canonicalVersionId: r.canonical_version_id,
    taskClass: r.task_class, scope: JSON.parse(r.scope_json), quality: r.quality, reliability: r.reliability, minQuality: r.min_quality, minReliability: r.min_reliability,
    suite: `${r.suite_id}@${r.suite_version}`, runId: r.run_id, evidence: JSON.parse(r.evidence_json), approvedBy: r.approved_by, qualifiedAt: r.qualified_at,
    expiresAt: r.expires_at, reviewAt: r.review_at, state, stateReasons: reasons,
  };
}

export function listQualifications(filter: { providerId?: string; modelId?: string; taskClass?: string } = {}): QualificationView[] {
  ensureQualificationTables();
  const rows = getDatabase().prepare('SELECT * FROM registry_qualifications ORDER BY qualified_at DESC').all() as any[];
  return rows
    .filter((r) => (!filter.providerId || r.provider_id === filter.providerId) && (!filter.modelId || r.model_id === filter.modelId) && (!filter.taskClass || r.task_class === filter.taskClass))
    .map(viewRow);
}

export interface QualificationRequirement {
  taskClass: string;
  deploymentId?: string | null;
  outputContract?: string | null;
  capabilities?: string[];
  contextTokens?: number | null;
  tools?: string[];
  privacyClass?: PrivacyClass | null;
  minQuality?: number | null;
  minReliability?: number | null;
}

const PRIVACY_ORDER = ['STANDARD', 'NO_TRAINING', 'ZERO_RETENTION', 'LOCAL_ONLY'];

/** The VALID qualification covering this requirement on this route, or every reason there is none. */
export function findQualification(providerId: string, modelId: string, req: QualificationRequirement): { ok: true; qualification: QualificationView } | { ok: false; reasons: string[] } {
  const all = listQualifications({ providerId, modelId, taskClass: req.taskClass }).filter((q) => !req.deploymentId || q.deploymentId === req.deploymentId);
  if (!all.length) return { ok: false, reasons: [`not qualified for ${req.taskClass}${req.deploymentId ? ` on deployment ${req.deploymentId}` : ''}`] };
  const reasons: string[] = [];
  for (const q of all) {
    if (q.state !== 'VALID') { reasons.push(`qualification ${q.qualificationId} is ${q.state}: ${q.stateReasons.join('; ')}`); continue; }
    const miss: string[] = [];
    if (req.outputContract && q.scope.outputContract !== req.outputContract) miss.push(`qualified for ${q.scope.outputContract}, not ${req.outputContract}`);
    for (const c of req.capabilities || []) if (!q.scope.capabilities.includes(c)) miss.push(`capability ${c} is outside the qualified scope`);
    for (const t of req.tools || []) if (!q.scope.tools.includes(t)) miss.push(`tool ${t} is outside the qualified scope`);
    if (req.contextTokens != null && (req.contextTokens < q.scope.contextRange.min || (q.scope.contextRange.max != null && req.contextTokens > q.scope.contextRange.max))) miss.push(`context ${req.contextTokens} is outside the qualified range`);
    if (req.privacyClass && PRIVACY_ORDER.indexOf(q.scope.privacyClass) < PRIVACY_ORDER.indexOf(req.privacyClass)) miss.push(`qualified at privacy ${q.scope.privacyClass}, task needs ${req.privacyClass}`);
    if (req.minQuality != null && q.quality < req.minQuality) miss.push(`qualified quality ${q.quality} < required ${req.minQuality}`);
    if (req.minReliability != null && q.reliability < req.minReliability) miss.push(`qualified reliability ${q.reliability} < required ${req.minReliability}`);
    if (!miss.length) return { ok: true, qualification: q };
    reasons.push(...miss);
  }
  return { ok: false, reasons };
}
