// ---------------------------------------------------------------------------
// CANONICAL MODEL ROUTER — selection, on the existing authorities.
//
// This is the registry deciding WHICH qualified route runs a task. It does
// not replace any authority it consults:
//   what exists / may run    the registry (viewOf, identity, qualification)
//   what it costs / budgets  the registry price + the spend policy/ledger
//   what is safe             Guardian (the task instruction), workspace policy
//   whether it may dispatch  still the spend guard, at call time
// (lib/model-router.ts is the older provider-identity classifier used by
// non-registry call sites; it selects nothing.)
//
// Sequence, as the product defines it:
//   requirements → qualified models → eligible canonical versions → permitted
//   routes → available deployments → continuity/capacity → quality and
//   reliability → cost.
//
// Hard filters remove a candidate and record why. Only survivors are scored,
// with explicit weights from a VERSIONED policy (data). Nothing is inferred
// from a model's name. If nothing survives, the decision says so and names
// the wait (budget, capacity, qualification, approval) — there is no silent
// fallback to an unqualified or weaker route.
//
// Every decision is persisted BEFORE execution and referenced by the ledger
// row, Aegis review and receipt of the call it authorised.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from '../persistence';
import { ensureRegistry } from './install';
import { listStoredModels, listStoredProviders, recordRegistryEvent } from './store';
import { viewOf } from './index';
import { routeIdentity, deploymentsOf, providerBodyForDeployment, privacyRank, routeKindOf } from './identity';
import { findQualification, getTaskClass, type QualificationView } from './qualification';
import { isRouteStale } from './route-import';
import { resolveProviderEndpoint } from './endpoints';
import { getProtocolAdapter } from './protocols';
import { currentPricing, priceVersionKey } from './pricing';
import { assessCapacity, type CapacityReport } from '../continuity/capacity';
import { approvedRouteStats } from './performance';
import { checkGuardianRules } from '../kil-gate';
import { resolveProviderState } from '../provider-state';
import { resolvePlatformSetting } from '../platform-settings';
import { getSpendPolicy } from '../spend/policy';
import type { PrivacyClass, RouteKind, ModelManifest, PricingRecord } from './types';
import bundledPolicies from './data/routing-policies.json';

// ---- policy (data, versioned) ------------------------------------------------------

export const ROUTING_MODES = ['BEST_QUALIFIED', 'LOWEST_COST_QUALIFIED', 'FASTEST_QUALIFIED', 'PRIVACY_FIRST', 'LOCAL_ONLY', 'DIRECT_PROVIDER_ONLY', 'AGGREGATORS_ALLOWED', 'FREE_WHEN_QUALIFIED', 'PINNED_MODEL_VERSION', 'PINNED_ROUTE'] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

export type WeightKey = 'quality' | 'reliability' | 'instructionCompliance' | 'completion' | 'latency' | 'contextHeadroom' | 'toolSuccess' | 'cost' | 'freeTier' | 'health' | 'capacityHeadroom' | 'privacyPreference' | 'workspacePreference';

export interface RoutingPolicy {
  policyId: string;
  version: string;
  description: string;
  weights: Record<WeightKey, number>;
  modes: Record<string, { weightOverrides: Partial<Record<WeightKey, number>>; routeKinds?: RouteKind[]; minPrivacyClass?: PrivacyClass; requiresPin?: 'version' | 'route' }>;
  defaultMode: RoutingMode;
  defaultRouteKinds: RouteKind[];
  scaling: { latencyMsCeiling: number; costUsdCeiling: number; costScoring?: string };
  evidence: { minSamples: number; trimFraction: number };
  capacity: { warnAt: number; actAt: number };
  health?: { cooldownMinutes: number };
}

export function ensureRouterTables(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS registry_routing_policies (
      policy_id TEXT NOT NULL, version TEXT NOT NULL, record_json TEXT NOT NULL, status TEXT NOT NULL,
      source TEXT NOT NULL, proposed_by TEXT, approved_by TEXT, created_at TEXT NOT NULL, activated_at TEXT,
      PRIMARY KEY (policy_id, version)
    );
    CREATE TABLE IF NOT EXISTS registry_workspace_routing (
      workspace_id TEXT PRIMARY KEY, constraints_json TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS routing_decisions (
      decision_id TEXT PRIMARY KEY, task_id TEXT, workspace_id TEXT, segment_id TEXT,
      policy_id TEXT NOT NULL, policy_version TEXT NOT NULL, mode TEXT NOT NULL,
      requirements_json TEXT NOT NULL, constraints_json TEXT NOT NULL, candidates_json TEXT NOT NULL,
      selected_json TEXT, outcome TEXT NOT NULL, wait_state TEXT, explanation TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_routing_decisions_task ON routing_decisions (task_id, created_at);
  `);
  const now = new Date().toISOString();
  const ins = getDatabase().prepare(`INSERT OR IGNORE INTO registry_routing_policies (policy_id, version, record_json, status, source, approved_by, created_at, activated_at) VALUES (?, ?, ?, 'ACTIVE', 'BUNDLED', 'bundled-data', ?, ?)`);
  for (const p of (bundledPolicies as any).policies as RoutingPolicy[]) ins.run(p.policyId, p.version, JSON.stringify(p), now, now);
}

export function activePolicy(): RoutingPolicy {
  ensureRouterTables();
  const id = resolvePlatformSetting('router.policy', 'router.default').value || 'router.default';
  const r = getDatabase().prepare("SELECT record_json FROM registry_routing_policies WHERE policy_id = ? AND status = 'ACTIVE' ORDER BY activated_at DESC, rowid DESC LIMIT 1").get(id) as any
    ?? getDatabase().prepare("SELECT record_json FROM registry_routing_policies WHERE policy_id = 'router.default' AND status = 'ACTIVE' ORDER BY activated_at DESC, rowid DESC LIMIT 1").get() as any;
  return JSON.parse(r.record_json);
}

export function listPolicies(): Array<{ policyId: string; version: string; status: string; source: string; proposedBy: string | null; approvedBy: string | null; createdAt: string; activatedAt: string | null; record: RoutingPolicy }> {
  ensureRouterTables();
  return (getDatabase().prepare('SELECT * FROM registry_routing_policies ORDER BY created_at DESC, rowid DESC').all() as any[]).map((r) => ({
    policyId: r.policy_id, version: r.version, status: r.status, source: r.source, proposedBy: r.proposed_by, approvedBy: r.approved_by, createdAt: r.created_at, activatedAt: r.activated_at, record: JSON.parse(r.record_json),
  }));
}

// ---- workspace / user constraints --------------------------------------------------

export interface RoutingConstraints {
  mode?: RoutingMode;
  minQuality?: number | null;
  minReliability?: number | null;
  maxCostUsd?: number | null;
  permittedProviders?: string[];
  permittedAggregators?: string[];
  regions?: string[];
  localOnly?: boolean;
  directOnly?: boolean;
  preferFree?: boolean;
  prohibited?: string[];
  preferred?: string[];
  prohibitDeprecated?: boolean;
  pinnedVersion?: string | null;
  pinnedRoute?: { providerId: string; modelId: string; deploymentId?: string | null } | null;
}

export function getWorkspaceRouting(workspaceId: string): RoutingConstraints {
  ensureRouterTables();
  const r = getDatabase().prepare('SELECT constraints_json FROM registry_workspace_routing WHERE workspace_id = ?').get(workspaceId) as any;
  return r ? JSON.parse(r.constraints_json) : {};
}

export function setWorkspaceRouting(workspaceId: string, c: RoutingConstraints, actor: string): { ok: true; constraints: RoutingConstraints } | { ok: false; error: string } {
  ensureRouterTables();
  if (c.mode && !ROUTING_MODES.includes(c.mode)) return { ok: false, error: `unknown routing mode ${c.mode}` };
  for (const k of ['minQuality', 'minReliability'] as const) if (c[k] != null && !(c[k]! >= 0 && c[k]! <= 1)) return { ok: false, error: `${k} must be within 0..1` };
  if (c.maxCostUsd != null && !(c.maxCostUsd >= 0)) return { ok: false, error: 'maxCostUsd must be ≥ 0' };
  const clean: RoutingConstraints = JSON.parse(JSON.stringify(c));
  getDatabase().prepare(`INSERT INTO registry_workspace_routing (workspace_id, constraints_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET constraints_json = excluded.constraints_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(workspaceId, JSON.stringify(clean), actor, new Date().toISOString());
  recordRegistryEvent('WORKSPACE_ROUTING_CHANGED', { actor, workspaceId, constraints: clean });
  return { ok: true, constraints: clean };
}

/** Workspace constraints are the floor; a task may only narrow them. */
function mergeConstraints(ws: RoutingConstraints, task: RoutingConstraints): RoutingConstraints {
  const max = (a?: number | null, b?: number | null) => (a == null ? b ?? null : b == null ? a : Math.max(a, b));
  const min = (a?: number | null, b?: number | null) => (a == null ? b ?? null : b == null ? a : Math.min(a, b));
  const inter = (a?: string[], b?: string[]) => (a && a.length ? (b && b.length ? a.filter((x) => b.includes(x)) : a) : b);
  return {
    mode: task.mode ?? ws.mode,
    minQuality: max(ws.minQuality, task.minQuality), minReliability: max(ws.minReliability, task.minReliability), maxCostUsd: min(ws.maxCostUsd, task.maxCostUsd),
    permittedProviders: inter(ws.permittedProviders, task.permittedProviders), permittedAggregators: inter(ws.permittedAggregators, task.permittedAggregators),
    regions: inter(ws.regions, task.regions), localOnly: !!(ws.localOnly || task.localOnly), directOnly: !!(ws.directOnly || task.directOnly),
    preferFree: task.preferFree ?? ws.preferFree, prohibited: [...(ws.prohibited || []), ...(task.prohibited || [])], preferred: task.preferred ?? ws.preferred,
    prohibitDeprecated: !!(ws.prohibitDeprecated || task.prohibitDeprecated),
    pinnedVersion: task.pinnedVersion ?? ws.pinnedVersion ?? null, pinnedRoute: task.pinnedRoute ?? ws.pinnedRoute ?? null,
  };
}

// ---- requirements ---------------------------------------------------------------------

export interface RoutingRequirements {
  taskClass: string;
  outputContract: 'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT';
  capabilities: string[];
  modality: { input: string[]; output: string[] };
  estimatedInputTokens: number;
  expectedOutputTokens: number;
  tools: string[];
  privacyClass: PrivacyClass;
  /** The instruction Guardian inspects. Not stored in the decision. */
  instruction?: string;
}

/** Same-or-stronger floor for a continuation: never route to something weaker than the route being replaced. */
export interface ContinuationFloor {
  minQuality: number;
  minReliability: number;
  privacyClass: PrivacyClass;
  minContextTokens: number | null;
  capabilities: string[];
  outputContract: string;
  excludeRoutes: string[];
}

export function requirementsFor(p: { taskClass: string; outputContract?: string; instruction?: string; inputChars?: number; expectedOutputTokens?: number; privacyClass?: PrivacyClass; extraCapabilities?: string[] }): RoutingRequirements | { error: string } {
  const tc = getTaskClass(p.taskClass);
  if (!tc) return { error: `task class ${p.taskClass} is not registered` };
  const contract = (p.outputContract as RoutingRequirements['outputContract']) || tc.outputContract;
  return {
    taskClass: tc.taskClassId, outputContract: contract,
    capabilities: [...new Set([...tc.requiredCapabilities, ...(p.extraCapabilities || [])])], modality: tc.modality,
    // ~4 characters per token: an estimate for headroom, not a price.
    // Default expected output = what a call will actually request: the spend
    // policy's per-call output ceiling (never an assumed figure above it).
    estimatedInputTokens: Math.ceil((p.inputChars ?? 0) / 4), expectedOutputTokens: p.expectedOutputTokens ?? getSpendPolicy().task.maxOutputTokens,
    tools: tc.requiredTools, privacyClass: p.privacyClass ?? 'STANDARD', instruction: p.instruction,
  };
}

// ---- candidates --------------------------------------------------------------------------

export interface Disqualification { code: string; reason: string }

export interface Candidate {
  routeKey: string;
  providerId: string;
  modelId: string;
  deploymentId: string;
  canonicalVersionId: string | null;
  familyId: string | null;
  routeKind: RouteKind;
  region: string | null;
  privacyClass: PrivacyClass;
  free: boolean;
  freeGuaranteed: boolean;
  estimatedCostUsd: number | null;
  priceVersion: string | null;
  qualificationId: string | null;
  disqualified: Disqualification[];
  capacity?: { headroom: number; exhausted: string[]; acting: string[] };
  features?: Record<WeightKey, number | null>;
  score?: number;
  scoreBreakdown?: Array<{ weight: WeightKey; w: number; value: number | null; contribution: number }>;
}

export interface SelectedRoute {
  providerId: string;
  modelId: string;
  deploymentId: string;
  canonicalVersionId: string | null;
  familyId: string | null;
  routeKind: RouteKind;
  qualificationId: string;
  priceVersion: string | null;
  priceSnapshot: PricingRecord | null;
  estimatedCostUsd: number | null;
  score: number;
}

export type WaitState = 'PAUSED_AWAITING_BUDGET' | 'PAUSED_AWAITING_CAPACITY' | 'PAUSED_AWAITING_QUALIFIED_CAPACITY' | 'PAUSED_AWAITING_APPROVAL' | null;

export interface RoutingDecision {
  decisionId: string;
  taskId: string | null;
  workspaceId: string | null;
  segmentId: string | null;
  policy: { policyId: string; version: string };
  mode: RoutingMode;
  requirements: Omit<RoutingRequirements, 'instruction'>;
  constraints: RoutingConstraints;
  candidates: Candidate[];
  selected: SelectedRoute | null;
  outcome: 'SELECTED' | 'NO_ELIGIBLE_ROUTE' | 'GUARDIAN_REFUSED';
  waitState: WaitState;
  explanation: string;
  createdAt: string;
}

function estimateCost(pricing: PricingRecord | null, inTok: number, outTok: number, billing: string): number | null {
  if (billing === 'FREE_LOCAL') return 0;
  if (!pricing) return null;
  if (pricing.unit !== 'tokens') return null;
  let rates = pricing.rates;
  for (const t of pricing.tiers) if (inTok > t.thresholdTokens) rates = t.rates;
  return (inTok * rates.input + outTok * rates.output) / 1_000_000;
}

const VIEW_CODE: Record<string, string> = {
  REMOVED: 'REMOVED', UNSUPPORTED_BY_ADAPTER: 'ADAPTER_UNSUPPORTED', METADATA_REQUIRED: 'METADATA_REQUIRED', PRICING_REQUIRED: 'PRICING_MISSING_OR_UNREVIEWED',
  PRICE_STALE: 'PRICING_STALE', UNQUALIFIED: 'MODEL_NOT_ADMITTED', QUALIFIED: 'MODEL_NOT_ENABLED', DISABLED: 'MODEL_DISABLED', NOT_CONFIGURED: 'NOT_CONFIGURED', POLICY_BLOCKED: 'POLICY_BLOCKED',
};

// ---- the router ----------------------------------------------------------------------------

export interface RouteRequest {
  workspaceId: string | null;
  taskId?: string | null;
  segmentId?: string | null;
  requirements: RoutingRequirements;
  constraints?: RoutingConstraints;
  floor?: ContinuationFloor | null;
  /** false: evaluate and return, but do not persist (a preview the UI shows). */
  persist?: boolean;
}

export function routeTask(req: RouteRequest): RoutingDecision {
  ensureRegistry();
  ensureRouterTables();
  const policy = activePolicy();
  const constraints = mergeConstraints(req.workspaceId ? getWorkspaceRouting(req.workspaceId) : {}, req.constraints ?? {});
  let mode: RoutingMode = constraints.mode ?? policy.defaultMode;
  if (constraints.pinnedRoute && !req.constraints?.mode) mode = 'PINNED_ROUTE';
  else if (constraints.pinnedVersion && !req.constraints?.mode) mode = 'PINNED_MODEL_VERSION';
  const modeSpec = policy.modes[mode] ?? { weightOverrides: {} };
  const R = req.requirements;
  const floor = req.floor ?? null;
  const tc = getTaskClass(R.taskClass);
  const createdAt = new Date().toISOString();
  const decisionId = `route-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const { instruction, ...reqStored } = R;

  const finish = (d: Omit<RoutingDecision, 'decisionId' | 'createdAt' | 'policy' | 'mode' | 'requirements' | 'constraints' | 'taskId' | 'workspaceId' | 'segmentId'>): RoutingDecision => {
    const decision: RoutingDecision = {
      decisionId, taskId: req.taskId ?? null, workspaceId: req.workspaceId, segmentId: req.segmentId ?? null,
      policy: { policyId: policy.policyId, version: policy.version }, mode, requirements: reqStored, constraints, createdAt, ...d,
    };
    if (req.persist !== false) {
      getDatabase().prepare(`INSERT INTO routing_decisions (decision_id, task_id, workspace_id, segment_id, policy_id, policy_version, mode, requirements_json, constraints_json, candidates_json, selected_json, outcome, wait_state, explanation, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(decisionId, decision.taskId, decision.workspaceId, decision.segmentId, policy.policyId, policy.version, mode, JSON.stringify(reqStored), JSON.stringify(constraints),
          JSON.stringify(decision.candidates), decision.selected ? JSON.stringify(decision.selected) : null, decision.outcome, decision.waitState, decision.explanation, createdAt);
    }
    return decision;
  };

  if (!tc) return finish({ candidates: [], selected: null, outcome: 'NO_ELIGIBLE_ROUTE', waitState: 'PAUSED_AWAITING_QUALIFIED_CAPACITY', explanation: `No route was selected: task class ${R.taskClass} is not registered.` });

  // GUARDIAN — the instruction itself. A refusal stops routing entirely.
  if (instruction) {
    const g = checkGuardianRules(instruction);
    if (g.status === 'BLOCKED') return finish({ candidates: [], selected: null, outcome: 'GUARDIAN_REFUSED', waitState: null, explanation: `Guardian refused this task (${g.ruleCitation ?? g.riskLevel}): ${g.warning ?? 'blocked'}. No model was selected.` });
    if (g.status === 'APPROVAL_REQUIRED') return finish({ candidates: [], selected: null, outcome: 'NO_ELIGIBLE_ROUTE', waitState: 'PAUSED_AWAITING_APPROVAL', explanation: `Guardian requires a human approval before this task may run (${g.ruleCitation ?? g.riskLevel}). No model was selected.` });
  }

  // Route kinds this mode + these constraints permit.
  // A pinned route was chosen explicitly: its kind is permitted (workspace
  // local-only / direct-only still apply below).
  let kinds: RouteKind[] = constraints.pinnedRoute ? ['DIRECT', 'AGGREGATOR', 'LOCAL', 'ENTERPRISE'] : modeSpec.routeKinds ?? ([...policy.defaultRouteKinds, ...((constraints.permittedAggregators?.length ?? 0) > 0 ? ['AGGREGATOR' as RouteKind] : [])]);
  if (constraints.localOnly) kinds = kinds.filter((k) => k === 'LOCAL');
  if (constraints.directOnly) kinds = kinds.filter((k) => k === 'DIRECT');
  const minPrivacy = [R.privacyClass, modeSpec.minPrivacyClass ?? 'STANDARD', floor?.privacyClass ?? 'STANDARD'].reduce((a, b) => (privacyRank(b) > privacyRank(a) ? b : a)) as PrivacyClass;
  const minQuality = Math.max(constraints.minQuality ?? 0, floor?.minQuality ?? 0, tc.minQuality);
  const minReliability = Math.max(constraints.minReliability ?? 0, floor?.minReliability ?? 0, tc.minReliability);

  const providers = new Map(listStoredProviders().map((p) => [p.providerId, p]));
  const outputCeilingNow = getSpendPolicy().task.maxOutputTokens;
  const candidates: Candidate[] = [];
  for (const m of listStoredModels()) {
    const p = providers.get(m.providerId);
    if (!p) continue;
    const body = p.manifest.provider;
    const kind = routeKindOf(body);
    const id = routeIdentity(m.providerId, m.modelId);
    const rec: ModelManifest = m.record;
    const view = viewOf(m, p, { workspaceId: req.workspaceId, outputContract: R.outputContract, requiredCapabilities: R.capabilities, credentialHeld: false });
    const pricing = currentPricing(rec);
    for (const dep of deploymentsOf(body)) {
      const dq: Disqualification[] = [];
      const add = (code: string, reason: string) => dq.push({ code, reason });
      const routeKey = `${m.providerId}/${m.modelId}@${dep.deploymentId}`;
      const est = estimateCost(pricing.record, R.estimatedInputTokens, R.expectedOutputTokens, body.billing);

      // 1. requirements → qualified models
      const q = findQualification(m.providerId, m.modelId, {
        taskClass: R.taskClass, deploymentId: dep.deploymentId, outputContract: R.outputContract, capabilities: R.capabilities,
        contextTokens: R.estimatedInputTokens + R.expectedOutputTokens, tools: R.tools, privacyClass: minPrivacy, minQuality, minReliability,
      });
      if (!q.ok) add('NOT_QUALIFIED', q.reasons.join('; '));
      // 2. eligible canonical versions
      if (!id.resolved) add('IDENTITY_UNRESOLVED', `canonical version mapping is ${id.status}${id.reason ? `: ${id.reason}` : ''}`);
      if (constraints.pinnedVersion && id.canonicalVersionId !== constraints.pinnedVersion) add('NOT_PINNED_VERSION', `pinned to ${constraints.pinnedVersion}`);
      if (mode === 'PINNED_MODEL_VERSION' && !constraints.pinnedVersion) add('PIN_MISSING', 'PINNED_MODEL_VERSION needs a pinned version');
      if (constraints.prohibited?.some((x) => x === `${m.providerId}/${m.modelId}` || x === id.canonicalVersionId || x === m.providerId)) add('PROHIBITED', 'prohibited by workspace or task');
      if (constraints.prohibitDeprecated && view.blockers.some((b) => b.state === 'DEPRECATED')) add('DEPRECATED_PROHIBITED', 'deprecated, and deprecated models are prohibited here');
      // 3. permitted routes
      if (!kinds.includes(kind)) add('ROUTE_KIND_NOT_PERMITTED', `${kind} routes are not permitted under ${mode}${constraints.localOnly ? ' / local-only' : ''}${constraints.directOnly ? ' / direct-only' : ''}`);
      if (kind === 'AGGREGATOR' && !constraints.pinnedRoute && mode !== 'AGGREGATORS_ALLOWED' && !(constraints.permittedAggregators || []).includes(m.providerId) && !(modeSpec.routeKinds || []).includes('AGGREGATOR')) add('AGGREGATOR_NOT_PERMITTED', `aggregator ${m.providerId} is not permitted`);
      if (constraints.permittedProviders?.length && !constraints.permittedProviders.includes(m.providerId)) add('PROVIDER_NOT_PERMITTED', `${m.providerId} is not in the permitted providers`);
      if (constraints.pinnedRoute && (constraints.pinnedRoute.providerId !== m.providerId || constraints.pinnedRoute.modelId !== m.modelId || (constraints.pinnedRoute.deploymentId && constraints.pinnedRoute.deploymentId !== dep.deploymentId))) add('NOT_PINNED_ROUTE', `pinned to ${constraints.pinnedRoute.providerId}/${constraints.pinnedRoute.modelId}`);
      if (floor?.excludeRoutes.includes(routeKey)) add('ROUTE_EXCLUDED', 'this is the route being replaced (continuation); it is not re-selected until it has recovered');
      // registry state of the offering itself
      for (const b of view.blockers) {
        if (b.state === 'DEPRECATED' || b.state === 'DEGRADED') continue;
        if (b.state === 'NOT_CONFIGURED' && /credential/.test(b.reason)) { add('INVALID_OR_MISSING_CREDENTIAL', b.reason); continue; }
        if (b.state === 'POLICY_BLOCKED' && /paid execution is switched off/.test(b.reason)) { add('PAID_EXECUTION_DISABLED', b.reason); continue; }
        if (b.state === 'POLICY_BLOCKED' && /local \$0 execution is switched off/.test(b.reason)) { add('LOCAL_EXECUTION_DISABLED', b.reason); continue; }
        if (b.state === 'POLICY_BLOCKED' && /all model execution is switched off/.test(b.reason)) { add('MODEL_EXECUTION_DISABLED', b.reason); continue; }
        if (b.state === 'POLICY_BLOCKED' && /spend policy does not enable/.test(b.reason)) { add('PROVIDER_DISABLED', b.reason); continue; }
        if (b.state === 'POLICY_BLOCKED' && /workspace/.test(b.reason)) { add('WORKSPACE_PROHIBITED', b.reason); continue; }
        if (b.state === 'POLICY_BLOCKED' && /output contract/.test(b.reason)) { add('CONTRACT_MISMATCH', b.reason); continue; }
        if (b.state === 'POLICY_BLOCKED' && /capability/.test(b.reason)) { add('CAPABILITY_MISMATCH', b.reason); continue; }
        add(VIEW_CODE[b.state] ?? b.state, b.reason);
      }
      if (body.billing !== 'FREE_LOCAL' && isRouteStale(m.providerId)) add('ROUTE_DATA_STALE', `the last ${m.providerId} route import failed; its prices are not trusted until a successful import`);
      // A managed-agent runtime (EXTERNAL_RUNTIME) is not a model call: it is
      // eligible only for agent orchestration, never for ordinary model work.
      const dispatch = getProtocolAdapter(body.protocol)?.dispatch ?? 'NONE';
      if (dispatch === 'EXTERNAL_RUNTIME' && R.taskClass !== 'agent_orchestration') add('ADAPTER_NOT_A_MODEL_CALL', `${body.protocol} is a managed-agent runtime, not a model call`);
      // 4. available deployments
      if (dep.status !== 'ACTIVE') add('DEPLOYMENT_DISABLED', `deployment ${dep.deploymentId} is ${dep.status}`);
      const ep = resolveProviderEndpoint(providerBodyForDeployment(body, dep));
      if (!ep.ok) add('ENDPOINT_NOT_APPROVED', ep.reason);
      if (privacyRank(dep.privacyClass) < privacyRank(minPrivacy)) add('PRIVACY', `deployment privacy ${dep.privacyClass} is below the required ${minPrivacy}`);
      if (constraints.regions?.length && (!dep.region || !constraints.regions.includes(dep.region))) add('RESIDENCY', `deployment region ${dep.region ?? 'unspecified'} is not in ${constraints.regions.join(', ')}`);
      // modality / context / output / tools
      for (const mi of R.modality.input) if (!rec.modalities.input.includes(mi)) add('MODALITY_MISMATCH', `input modality ${mi} is not supported`);
      for (const mo of R.modality.output) if (!rec.modalities.output.includes(mo)) add('MODALITY_MISMATCH', `output modality ${mo} is not supported`);
      const needCtx = R.estimatedInputTokens + R.expectedOutputTokens;
      if (rec.limits.contextTokens != null && needCtx > rec.limits.contextTokens) add('CONTEXT_TOO_SMALL', `needs ~${needCtx} tokens of context; the model has ${rec.limits.contextTokens}`);
      if (floor?.minContextTokens != null && (rec.limits.contextTokens ?? 0) < floor.minContextTokens) add('CONTEXT_WEAKER', `a continuation needs at least ${floor.minContextTokens} context tokens`);
      // A LITERAL/JSON contract cannot be split: the whole answer must fit one response.
      // A contract-atomic answer (LITERAL / JSON, or a non-segmentable class)
      // cannot be split: the whole answer must fit ONE response — under both
      // the model's limit and the spend policy's output ceiling.
      const atomic = R.outputContract !== 'NARRATIVE' || !tc.segmentable;
      if (atomic && rec.limits.outputTokens != null && R.expectedOutputTokens > rec.limits.outputTokens) add('OUTPUT_TOO_SMALL', `a ${R.outputContract} answer cannot be segmented; it needs ${R.expectedOutputTokens} output tokens and the model allows ${rec.limits.outputTokens}`);
      if (atomic && R.expectedOutputTokens > outputCeilingNow) add('OUTPUT_POLICY_CEILING', `a contract-atomic answer needs ${R.expectedOutputTokens} output tokens; the spend policy allows ${outputCeilingNow} per call`);
      for (const c of floor?.capabilities || []) if (!rec.capabilities.some((x) => x.id === c && x.supported)) add('CAPABILITY_WEAKER', `the replaced route had ${c}`);
      // budget
      if (body.billing !== 'FREE_LOCAL' && est === null) add('COST_UNBOUNDED', 'no usable price to bound this call');
      if (constraints.maxCostUsd != null && est != null && est > constraints.maxCostUsd) add('OVER_TASK_BUDGET', `estimated $${est.toFixed(6)} exceeds the $${constraints.maxCostUsd} limit`);
      // health — a failed route is ineligible for a cool-down, then eligible
      // again (a recovered route may be chosen later; it is never bounced to
      // mid-task — see the continuity controller's exclusions).
      // An explicitly pinned route is the operator's choice: its health is
      // reported, not used to refuse it (qualification and the spend guard still apply).
      const h = recentFailure(m.providerId, policy.health?.cooldownMinutes ?? 5);
      if (h && !constraints.pinnedRoute) add('UNHEALTHY', h);

      const cand: Candidate = {
        routeKey, providerId: m.providerId, modelId: m.modelId, deploymentId: dep.deploymentId, canonicalVersionId: id.canonicalVersionId, familyId: id.familyId,
        routeKind: kind, region: dep.region, privacyClass: dep.privacyClass, free: !!rec.freeTier?.free || body.billing === 'FREE_LOCAL', freeGuaranteed: !!rec.freeTier?.guaranteed || body.billing === 'FREE_LOCAL',
        estimatedCostUsd: est, priceVersion: pricing.record ? priceVersionKey(m.providerId, m.modelId, m.manifestVersion, pricing.record) : null,
        qualificationId: q.ok ? q.qualification.qualificationId : null, disqualified: dq,
      };
      // 5. continuity / capacity — only for candidates still standing.
      if (!dq.length) {
        const cap: CapacityReport = assessCapacity({
          providerId: m.providerId, modelId: m.modelId, deploymentId: dep.deploymentId, workspaceId: req.workspaceId,
          estimatedInputTokens: R.estimatedInputTokens, expectedOutputTokens: R.expectedOutputTokens, estimatedCostUsd: est ?? 0,
          limits: rec.limits, rateLimits: dep.rateLimits, billing: body.billing, thresholds: policy.capacity,
        });
        cand.capacity = { headroom: cap.headroom, exhausted: cap.exhausted.map((d) => `${d.dimension} (${d.detail})`), acting: cap.acting.map((d) => d.dimension) };
        // Codes use the spend guard's vocabulary (budget.global_daily → BUDGET_GLOBAL_DAILY).
        // Context and output were judged above with the contract in view (a
        // NARRATIVE may continue across segments; LITERAL/JSON may not).
        for (const d of cap.exhausted.filter((x) => x.dimension !== 'context' && x.dimension !== 'output')) add(d.dimension.toUpperCase().replace(/\./g, '_'), `${d.detail}: ${d.used} used + ${d.need} needed exceeds ${d.limit}`);
        cand.features = features(q.ok ? q.qualification : null, cand, cap, rec, R, policy, constraints, m.providerId, m.modelId, req.workspaceId);
      }
      candidates.push(cand);
    }
  }

  // 6-7. quality/reliability then cost — as explicit, versioned weights.
  const weights: Record<WeightKey, number> = { ...policy.weights, ...modeSpec.weightOverrides } as Record<WeightKey, number>;
  if (constraints.preferFree && !modeSpec.weightOverrides.freeTier) weights.freeTier = Math.max(weights.freeTier, 0.2);
  const eligible = candidates.filter((c) => !c.disqualified.length);
  // COST is scored relative to the other eligible routes (cheapest 1, dearest
  // 0), capped by the policy ceiling — an absolute scale would make every
  // cheap route look the same.
  const costs = eligible.map((c) => c.estimatedCostUsd).filter((x): x is number => x !== null);
  const minCost = costs.length ? Math.min(...costs) : 0; const maxCost = costs.length ? Math.max(...costs) : 0;
  for (const c of eligible) {
    if (c.features && c.estimatedCostUsd !== null) {
      c.features.cost = c.estimatedCostUsd > policy.scaling.costUsdCeiling ? 0 : maxCost === minCost ? 1 : (maxCost - c.estimatedCostUsd) / (maxCost - minCost);
    }
  }
  for (const c of eligible) {
    c.scoreBreakdown = (Object.keys(weights) as WeightKey[]).map((k) => {
      const value = c.features![k];
      return { weight: k, w: weights[k], value, contribution: value === null ? 0 : weights[k] * value };
    });
    c.score = Math.round(c.scoreBreakdown.reduce((s, x) => s + x.contribution, 0) * 1e6) / 1e6;
  }
  // ACT BEFORE EXHAUSTION: a route already past the policy's act threshold on
  // budget / quota / rate / concurrency ranks after every route with headroom.
  const acting = (c: Candidate) => ((c.capacity?.acting || []).some((d) => !['context', 'output'].includes(d)) ? 1 : 0);
  eligible.sort((a, b) => (acting(a) - acting(b)) || (b.score! - a.score!) || (a.estimatedCostUsd ?? 0) - (b.estimatedCostUsd ?? 0) || a.routeKey.localeCompare(b.routeKey));

  if (!eligible.length) {
    const isBudget = (c: string) => c.startsWith('BUDGET_') || c === 'PAID_EXECUTION_DISABLED' || c === 'LOCAL_EXECUTION_DISABLED' || c === 'MODEL_EXECUTION_DISABLED' || c === 'PROVIDER_DISABLED';
    // ROUTE_EXCLUDED: the route just hit capacity mid-task and cools down
    // before it may be chosen again — waiting, not unqualified.
    const isCapacity = (c: string) => c.startsWith('CONCURRENCY_') || c.startsWith('QUOTA_') || c.startsWith('RATE_') || c === 'UNHEALTHY' || c === 'ROUTE_EXCLUDED';
    // A pinned route is judged on its own reasons; otherwise on every route
    // that is only waiting (budget or capacity) rather than unqualified.
    const pinnedCands = constraints.pinnedRoute ? candidates.filter((c) => !c.disqualified.some((d) => d.code === 'NOT_PINNED_ROUTE')) : [];
    const pool = constraints.pinnedRoute ? pinnedCands : candidates;
    const waitState: WaitState =
      pool.some((c) => c.disqualified.length && c.disqualified.every((d) => isBudget(d.code) || isCapacity(d.code)) && c.disqualified.some((d) => isBudget(d.code))) ? 'PAUSED_AWAITING_BUDGET'
      : pool.some((c) => c.disqualified.length && c.disqualified.every((d) => isCapacity(d.code))) ? 'PAUSED_AWAITING_CAPACITY'
      : 'PAUSED_AWAITING_QUALIFIED_CAPACITY';
    let explanation: string;
    if (constraints.pinnedRoute) {
      const p = constraints.pinnedRoute;
      const reasons = pinnedCands.flatMap((c) => c.disqualified).map((d) => `${d.code} (${d.reason})`);
      explanation = `The pinned route ${p.providerId}/${p.modelId} cannot run this ${R.taskClass} task now: ${reasons.join('; ') || 'it is not registered'}. Nothing was run and no other model was substituted. The task waits (${waitState}).`;
    } else {
      const all = candidates.flatMap((c) => c.disqualified.map((d) => d.code));
      const top = Object.entries(all.reduce((acc: Record<string, number>, c) => ((acc[c] = (acc[c] || 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ×${n}`).join(', ');
      explanation = `No qualified route can run this ${R.taskClass} task now, so nothing was run and no weaker route was substituted. ${candidates.length} route offering(s) were considered; ${candidates.length ? `the commonest reasons: ${top}` : 'none are registered'}. The task waits (${waitState}).`;
    }
    return finish({ candidates, selected: null, outcome: 'NO_ELIGIBLE_ROUTE', waitState, explanation });
  }

  const best = eligible[0];
  const m = listStoredModels(best.providerId).find((x) => x.modelId === best.modelId)!;
  const priceNow = currentPricing(m.record).record;
  const selected: SelectedRoute = {
    providerId: best.providerId, modelId: best.modelId, deploymentId: best.deploymentId, canonicalVersionId: best.canonicalVersionId, familyId: best.familyId,
    routeKind: best.routeKind, qualificationId: best.qualificationId!, priceVersion: best.priceVersion, priceSnapshot: priceNow, estimatedCostUsd: best.estimatedCostUsd, score: best.score!,
  };
  return finish({ candidates, selected, outcome: 'SELECTED', waitState: null, explanation: explain(best, eligible, candidates, R, mode, policy) });
}

function recentFailure(providerId: string, cooldownMinutes: number): string | null {
  try {
    const st = resolveProviderState({ provider: providerId, implemented: true, configured: true });
    if ((st.state === 'PROVIDER_ERROR' || st.state === 'QUOTA_BLOCKED') && st.lastAttemptAt && Date.now() - Date.parse(st.lastAttemptAt) < cooldownMinutes * 60_000) {
      return `the last real ${providerId} call failed at ${st.lastAttemptAt} (${st.lastErrorCategory ?? 'error'}); eligible again after ${cooldownMinutes} min without a newer failure`;
    }
  } catch { /* no health record is not a failure */ }
  return null;
}

function features(q: QualificationView | null, c: Candidate, cap: CapacityReport, rec: ModelManifest, R: RoutingRequirements, policy: RoutingPolicy, cons: RoutingConstraints, providerId: string, modelId: string, workspaceId: string | null): Record<WeightKey, number | null> {
  const stats = approvedRouteStats(providerId, modelId, R.taskClass, workspaceId);
  const need = R.estimatedInputTokens + R.expectedOutputTokens;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return {
    quality: q ? q.quality : null,
    reliability: q ? q.reliability : null,
    instructionCompliance: stats?.instructionCompliance ?? null,
    completion: stats?.completion ?? null,
    latency: stats?.medianLatencyMs != null ? clamp(1 - stats.medianLatencyMs / policy.scaling.latencyMsCeiling) : null,
    contextHeadroom: rec.limits.contextTokens ? clamp(1 - need / rec.limits.contextTokens) : null,
    toolSuccess: R.tools.length ? stats?.toolSuccess ?? null : null,
    cost: c.estimatedCostUsd != null ? clamp(1 - c.estimatedCostUsd / policy.scaling.costUsdCeiling) : null,
    // Free is volatile unless guaranteed: half credit.
    freeTier: c.free ? (c.freeGuaranteed ? 1 : 0.5) : 0,
    // Unhealthy routes were filtered above; survivors are healthy as far as the ledger shows.
    health: 1,
    capacityHeadroom: cap.headroom,
    privacyPreference: privacyRank(c.privacyClass) / 3,
    workspacePreference: cons.preferred?.some((x) => x === `${providerId}/${modelId}` || x === c.canonicalVersionId || x === providerId) ? 1 : 0,
  };
}

function explain(best: Candidate, eligible: Candidate[], all: Candidate[], R: RoutingRequirements, mode: RoutingMode, policy: RoutingPolicy): string {
  const via = best.routeKind === 'DIRECT' ? 'directly from its publisher' : best.routeKind === 'AGGREGATOR' ? `through the aggregator ${best.providerId}` : best.routeKind === 'LOCAL' ? 'on the local runtime' : `through the private deployment ${best.providerId}`;
  const cost = best.estimatedCostUsd == null ? 'cost unknown' : best.estimatedCostUsd === 0 ? 'no charge' : `about $${best.estimatedCostUsd.toFixed(6)} at most`;
  const top = [...(best.scoreBreakdown || [])].sort((a, b) => b.contribution - a.contribution).slice(0, 3).map((x) => `${x.weight} ${x.value === null ? 'unknown' : x.value.toFixed(2)}`).join(', ');
  const parts = [
    `Selected ${best.canonicalVersionId ?? `${best.providerId}/${best.modelId}`} ${via} (deployment ${best.deploymentId}) for this ${R.taskClass} task: it holds a valid ${R.taskClass} qualification (${best.qualificationId}) and scored ${best.score!.toFixed(3)} under ${policy.policyId} v${policy.version} in ${mode} mode — strongest factors: ${top}. Estimated ${cost}.`,
  ];
  const second = eligible[1];
  if (second) {
    const cheaper = (second.estimatedCostUsd ?? Infinity) < (best.estimatedCostUsd ?? Infinity);
    parts.push(`Runner-up ${second.canonicalVersionId ?? second.routeKey} scored ${second.score!.toFixed(3)}${cheaper ? `; it was cheaper, but lost on ${[...(second.scoreBreakdown || [])].sort((a, b) => (best.scoreBreakdown!.find((x) => x.weight === b.weight)!.contribution - b.contribution) - (best.scoreBreakdown!.find((x) => x.weight === a.weight)!.contribution - a.contribution))[0]?.weight ?? 'score'}` : ''}.`);
  }
  const rejected = all.length - eligible.length;
  if (rejected) parts.push(`${rejected} other route offering(s) were ruled out (not qualified, not permitted, not configured, or no capacity/budget) — each with its reason in the decision record.`);
  return parts.join(' ');
}

// ---- reads ---------------------------------------------------------------------------------

function decisionFromRow(r: any): RoutingDecision {
  return {
    decisionId: r.decision_id, taskId: r.task_id, workspaceId: r.workspace_id, segmentId: r.segment_id,
    policy: { policyId: r.policy_id, version: r.policy_version }, mode: r.mode, requirements: JSON.parse(r.requirements_json), constraints: JSON.parse(r.constraints_json),
    candidates: JSON.parse(r.candidates_json), selected: r.selected_json ? JSON.parse(r.selected_json) : null, outcome: r.outcome, waitState: r.wait_state,
    explanation: r.explanation, createdAt: r.created_at,
  };
}

export function getDecision(decisionId: string): RoutingDecision | null {
  ensureRouterTables();
  const r = getDatabase().prepare('SELECT * FROM routing_decisions WHERE decision_id = ?').get(decisionId);
  return r ? decisionFromRow(r) : null;
}

export function listDecisions(filter: { taskId?: string; workspaceId?: string; limit?: number } = {}): RoutingDecision[] {
  ensureRouterTables();
  const where: string[] = []; const args: any[] = [];
  if (filter.taskId) { where.push('task_id = ?'); args.push(filter.taskId); }
  if (filter.workspaceId) { where.push('workspace_id = ?'); args.push(filter.workspaceId); }
  return (getDatabase().prepare(`SELECT * FROM routing_decisions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...args, Math.min(200, filter.limit ?? 50)) as any[]).map(decisionFromRow);
}
