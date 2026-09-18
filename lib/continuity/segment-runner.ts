// ---------------------------------------------------------------------------
// SEGMENT RUNNER — the kernel's model step, through the router and the
// continuity controller.
//
//   1. identity: a named model must resolve in the registry (else refused)
//   2. route: the canonical router selects a QUALIFIED route (a named model
//      is a PINNED_ROUTE — validated, never substituted); the decision is
//      persisted before anything is sent
//   3. segment: opened with its input hash and checkpoint reference
//   4. dispatch: the adapter runs inside the route context, so the spend
//      guard's gate checks this task class's qualification and the ledger row
//      carries the version, deployment, decision and segment
//   5. outcome:
//        spend "not now"          → checkpoint, PAUSED_AWAITING_BUDGET/CAPACITY
//        timeout / unknown        → checkpoint, RECONCILING_UNKNOWN_EXECUTION (never retried)
//        quota / rate / 5xx known → checkpoint, route excluded, qualified switch
//        output cap on NARRATIVE  → checkpoint, next segment continues the text
//        output cap on LITERAL/JSON → stays INCOMPLETE (never split)
//        complete                 → assembled output goes to Aegis
//
// No path substitutes an unqualified or weaker model. A pinned route that
// cannot run pauses; it is not replaced.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { resolveRoute, credentialForTarget, credentialHint, primaryCredentialEnvVar, evaluateModel } from '../registry';
import { getStoredProvider } from '../registry/store';
import { credentialReadiness } from '../registry/credentials';
import { deploymentsOf, providerBodyForDeployment } from '../registry/identity';
import { resolveProviderEndpoint } from '../registry/endpoints';
import { getProtocolAdapter } from '../registry/protocols';
import { resolveTaskClass, listQualifications } from '../registry/qualification';
import { routeTask, requirementsFor, type RoutingConstraints, type RoutingDecision } from '../registry/router';
import { runWithRouteContext } from '../registry/route-context';
import { listUsageForKey } from '../spend/ledger';
import { SPEND_WAIT_CODES } from '../spend/guard';
import { recordActivityEvent, getDatabase } from '../persistence';
import { recordProviderAttempt } from '../provider-state';
import type { OutputContract, ProviderTermination } from '../fabric/output-contract';
import type { PrivacyClass } from '../registry/types';
import {
  getContinuity, openContinuity, openSegment, closeSegment, writeCheckpoint, continuationContext, transition, excludeRoute, floorFrom,
  listSegments, sha256, MAX_SEGMENTS, type PauseState, type SegmentRecord,
} from './controller';

export interface SegmentRunInput {
  taskId: string;
  workspaceId: string;
  assignedAgent: string;
  assignedModel: string;
  taskTitle: string;
  description: string;
  firstPrompt: string;
  outputContract: OutputContract;
  taskClass?: string | null;
  routing?: RoutingConstraints | null;
  privacyClass?: PrivacyClass | null;
  spendIdempotencyKey?: string;
  invoke: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** Called once identity, contract and credential checks pass — the task claims RUNNING only then. */
  onRunning?: () => void;
}

export type SegmentRunResult =
  | {
      kind: 'OUTPUT';
      output: string;
      modelUsed: string;
      providerId: string;
      modelId: string;
      usageMetadata: any;
      termination: ProviderTermination;
      successUsageKeys: string[];
      decision: RoutingDecision;
      taskClass: string;
      qualificationId: string | null;
      segments: SegmentRecord[];
      latencyMs: number | null;
    }
  | { kind: 'PAUSED'; state: PauseState; reason: string; decision: RoutingDecision | null }
  | { kind: 'RECONCILING'; reason: string; segmentId: string }
  | { kind: 'REFUSED'; httpStatus: number; code: string; error: string; requestedModel?: string; blocked?: boolean; eventType: string }
  | { kind: 'PROVIDER_FAILED'; code: 'MODEL_PROVIDER_UNAVAILABLE' | 'EMPTY_PROVIDER_RESPONSE'; error: string; lastProviderError: string | null; hadProviderError: boolean };

const WAIT_CODE_STATE: Record<string, PauseState> = {
  PAID_EXECUTION_DISABLED: 'PAUSED_AWAITING_BUDGET', PROVIDER_DISABLED: 'PAUSED_AWAITING_BUDGET', PRICING_UNKNOWN: 'PAUSED_AWAITING_QUALIFIED_CAPACITY',
  BUDGET_GLOBAL_DAILY: 'PAUSED_AWAITING_BUDGET', BUDGET_GLOBAL_MONTHLY: 'PAUSED_AWAITING_BUDGET', BUDGET_PROVIDER_DAILY: 'PAUSED_AWAITING_BUDGET',
  BUDGET_PROVIDER_MONTHLY: 'PAUSED_AWAITING_BUDGET', BUDGET_WORKSPACE_DAILY: 'PAUSED_AWAITING_BUDGET',
  CONCURRENCY_GLOBAL: 'PAUSED_AWAITING_CAPACITY', CONCURRENCY_PROVIDER: 'PAUSED_AWAITING_CAPACITY', CONCURRENCY_WORKSPACE: 'PAUSED_AWAITING_CAPACITY',
};

const OUTPUT_CAP = /OUTPUT_CAP|max_output_tokens|MAX_TOKENS|length|max_tokens/i;

function isOutputCap(t: ProviderTermination): boolean {
  return t.status === 'INCOMPLETE' && OUTPUT_CAP.test(`${t.reason ?? ''} ${t.providerStatus ?? ''}`);
}

/** Classify a provider failure that produced no output. */
function failureKind(lastError: string | null, usageStatus: string | null): 'AMBIGUOUS' | 'CAPACITY' | 'REJECTED' | 'OTHER' {
  if (usageStatus === 'TIMEOUT_AFTER_DISPATCH' || usageStatus === 'UNKNOWN') return 'AMBIGUOUS';
  const e = String(lastError || '');
  if (/HTTP 429|rate.?limit|quota|resource.?exhausted|overloaded|HTTP 503|HTTP 529/i.test(e)) return 'CAPACITY';
  if (usageStatus === 'PROVIDER_REJECTION') return 'REJECTED';
  return 'OTHER';
}

export async function runModelSegments(inp: SegmentRunInput): Promise<SegmentRunResult> {
  const contract = inp.outputContract;
  // ---- 1. identity (a named model) -------------------------------------------------
  let pinned: { providerId: string; modelId: string } | null = null;
  if (inp.assignedModel.trim()) {
    const route = resolveRoute(inp.assignedModel);
    if (!route.ok) return { kind: 'REFUSED', httpStatus: 400, code: route.code, error: route.reason, requestedModel: route.requested, eventType: 'PROVIDER_UNSUPPORTED' };
    const view = evaluateModel(route.providerId, route.modelId, { workspaceId: inp.workspaceId, outputContract: contract.mode, credentialHeld: true });
    if (view && !view.outputContracts.includes(contract.mode)) {
      return { kind: 'REFUSED', httpStatus: 400, code: 'MODEL_TASK_INCOMPATIBLE', error: `${route.providerId}/${route.modelId} does not declare the ${contract.mode} output contract this task requires. It was not run.`, eventType: 'PROVIDER_UNSUPPORTED' };
    }
    const body = getStoredProvider(route.providerId)!.manifest.provider;
    if (!credentialReadiness(body).ready) {
      const hint = credentialHint(route.providerId);
      return { kind: 'REFUSED', httpStatus: 400, code: 'BLOCKED_MISSING_CREDENTIAL', blocked: true, eventType: 'PROVIDER_FAILED', error: `${primaryCredentialEnvVar(route.providerId) ?? hint} environment variable is not configured on the server` };
    }
    pinned = { providerId: route.providerId, modelId: route.modelId };
  }

  // ---- task class ---------------------------------------------------------------------
  const tc = resolveTaskClass({ taskClass: inp.taskClass ?? null, outputContract: contract.mode });
  if (!tc) return { kind: 'REFUSED', httpStatus: 400, code: 'TASK_CLASS_UNKNOWN', error: `No task class "${inp.taskClass ?? contract.mode}" is registered. Nothing was run.`, eventType: 'PROVIDER_UNSUPPORTED' };
  const constraints: RoutingConstraints = { ...(inp.routing ?? {}), ...(pinned ? { pinnedRoute: { providerId: pinned.providerId, modelId: pinned.modelId }, mode: 'PINNED_ROUTE' as const } : {}) };
  const req = requirementsFor({ taskClass: tc.taskClassId, outputContract: contract.mode, instruction: `${inp.taskTitle}\n${inp.description}`, inputChars: inp.firstPrompt.length, privacyClass: inp.privacyClass ?? 'STANDARD' });
  if ('error' in req) return { kind: 'REFUSED', httpStatus: 400, code: 'TASK_CLASS_UNKNOWN', error: req.error, eventType: 'PROVIDER_UNSUPPORTED' };

  // An ambiguous segment that has not been reconciled blocks everything: a
  // fresh segment would carry a fresh spend key and could pay twice for work
  // the provider may already have done. Never retried, never switched.
  const unresolved = listSegments(inp.taskId).find((x) => x.status === 'UNKNOWN');
  if (unresolved) {
    transition(inp.taskId, inp.workspaceId, 'RECONCILING_UNKNOWN_EXECUTION', `Segment ${unresolved.sequence} (${unresolved.segmentId}) has an unknown outcome and has not been reconciled; nothing is run until it is.`);
    return { kind: 'RECONCILING', reason: 'an earlier segment is still unreconciled', segmentId: unresolved.segmentId };
  }
  inp.onRunning?.();
  let cont = getContinuity(inp.taskId);
  const { instruction: _i, ...storedReq } = req;
  if (!cont) cont = openContinuity({ taskId: inp.taskId, workspaceId: inp.workspaceId, taskClass: tc.taskClassId, contract, requirements: storedReq, constraints, privacyClass: inp.privacyClass ?? 'STANDARD' });

  // Outputs of earlier segments (a resumed task) are re-read from their text column.
  const outputs: string[] = priorOutputs(inp.taskId);
  let switching = false;
  let lastDecision: RoutingDecision | null = null;
  let usageMetadata: any = null;
  let modelUsed = inp.assignedModel;
  let latencyMs: number | null = null;
  const successKeys: string[] = [];
  let nextStep = outputs.length ? 'Continue the text exactly where it stopped, completing the remaining work.' : '';

  for (;;) {
    cont = getContinuity(inp.taskId)!;
    if (cont.segmentCount >= MAX_SEGMENTS) {
      transition(inp.taskId, inp.workspaceId, 'PAUSED_AWAITING_QUALIFIED_CAPACITY', `The task reached ${MAX_SEGMENTS} segments without completing its contract; it waits for an operator rather than continuing indefinitely.`);
      return { kind: 'PAUSED', state: 'PAUSED_AWAITING_QUALIFIED_CAPACITY', reason: `segment limit ${MAX_SEGMENTS} reached`, decision: lastDecision };
    }
    // ---- 2. route --------------------------------------------------------------------
    const current = cont.currentDecisionId ? lastDecision : null;
    let floor = null;
    if (switching && lastDecision?.selected) {
      const q = listQualifications({ providerId: lastDecision.selected.providerId, modelId: lastDecision.selected.modelId, taskClass: tc.taskClassId }).find((x) => x.qualificationId === lastDecision!.selected!.qualificationId);
      floor = floorFrom(current, cont, q?.quality ?? tc.minQuality, q?.reliability ?? tc.minReliability, null, req.capabilities);
    }
    const decision = routeTask({ workspaceId: inp.workspaceId, taskId: inp.taskId, requirements: req, constraints, floor });
    lastDecision = decision;
    try { recordActivityEvent({ taskId: inp.taskId, expectedWorkspaceId: inp.workspaceId, eventType: 'ROUTING_DECIDED', agentId: 'router', payload: { decisionId: decision.decisionId, outcome: decision.outcome, mode: decision.mode, policy: decision.policy, selected: decision.selected ? { providerId: decision.selected.providerId, modelId: decision.selected.modelId, deploymentId: decision.selected.deploymentId, canonicalVersionId: decision.selected.canonicalVersionId, priceVersion: decision.selected.priceVersion } : null, explanation: decision.explanation } }); } catch { /* evidence only */ }
    if (decision.outcome === 'GUARDIAN_REFUSED') {
      return { kind: 'REFUSED', httpStatus: 403, code: 'GUARDIAN_REFUSED', error: decision.explanation, eventType: 'GUARDIAN_BLOCKED', blocked: true };
    }
    if (!decision.selected) {
      const state = (decision.waitState ?? 'PAUSED_AWAITING_QUALIFIED_CAPACITY') as PauseState;
      if (cont.segmentCount > 0) writeCheckpoint({ taskId: inp.taskId, reason: `NO_ROUTE: ${state}`, objective: `${inp.taskTitle}\n${inp.description}`, acceptanceCriteria: acceptance(contract), remainingWork: [nextStep || 'Run the task'], tail: outputs.join('') || null });
      transition(inp.taskId, inp.workspaceId, state, decision.explanation, { decisionId: decision.decisionId });
      return { kind: 'PAUSED', state, reason: decision.explanation, decision };
    }
    if (switching) {
      try { recordActivityEvent({ taskId: inp.taskId, expectedWorkspaceId: inp.workspaceId, eventType: 'ROUTE_SWITCHED', agentId: 'continuity', payload: { from: cont.currentRouteKey, to: `${decision.selected.providerId}/${decision.selected.modelId}@${decision.selected.deploymentId}`, decisionId: decision.decisionId } }); } catch { /* evidence only */ }
    }
    const sel = decision.selected;
    const selCand = decision.candidates.find((c) => c.routeKey === `${sel.providerId}/${sel.modelId}@${sel.deploymentId}`);
    if (selCand?.capacity?.acting?.length) {
      try { recordActivityEvent({ taskId: inp.taskId, expectedWorkspaceId: inp.workspaceId, eventType: 'CAPACITY_WARNING', agentId: 'continuity', payload: { route: selCand.routeKey, acting: selCand.capacity.acting, headroom: selCand.capacity.headroom } }); } catch { /* evidence only */ }
    }

    // ---- 3. segment ------------------------------------------------------------------
    let prompt = inp.firstPrompt;
    if (outputs.length || cont.lastCheckpointId) {
      const ck = cont.lastCheckpointId;
      if (ck && outputs.length) {
        const ctxRes = continuationContext(ck, nextStep || 'Complete the task.');
        if (!ctxRes.ok) {
          transition(inp.taskId, inp.workspaceId, 'PAUSED_AWAITING_APPROVAL', `Continuation refused: ${ctxRes.error}. An operator must review the checkpoint.`);
          return { kind: 'PAUSED', state: 'PAUSED_AWAITING_APPROVAL', reason: ctxRes.error, decision };
        }
        prompt = ctxRes.text;
      }
    }
    const seg = openSegment({ taskId: inp.taskId, contract, decision, inputHash: sha256(prompt), checkpointRef: cont.lastCheckpointId });
    const body = getStoredProvider(sel.providerId)!.manifest.provider;
    const dep = deploymentsOf(body).find((d) => d.deploymentId === sel.deploymentId)!;
    const ep = resolveProviderEndpoint(providerBodyForDeployment(body, dep));
    const adapter = getProtocolAdapter(body.protocol);
    if (!ep.ok || !adapter?.call) {
      closeSegment(seg.segmentId, { status: 'BLOCKED', statusReason: ep.ok ? 'no dispatch adapter' : ep.reason });
      transition(inp.taskId, inp.workspaceId, 'PAUSED_AWAITING_QUALIFIED_CAPACITY', `The selected route cannot be dispatched: ${ep.ok ? 'no adapter' : ep.reason}.`);
      return { kind: 'PAUSED', state: 'PAUSED_AWAITING_QUALIFIED_CAPACITY', reason: ep.ok ? 'no adapter' : ep.reason, decision };
    }
    const apiKey = credentialForTarget(sel.providerId);
    // Stable per (task, segment): a requeue of the same segment can never pay twice.
    const spendKey = seg.sequence === 1
      ? (inp.spendIdempotencyKey || `kernel:${inp.taskId}:${crypto.randomUUID()}`)
      : `${inp.spendIdempotencyKey || `kernel:${inp.taskId}`}:s${seg.sequence}`;

    // ---- 4. dispatch -----------------------------------------------------------------
    const started = Date.now();
    const gen = await inp.invoke(`model.${sel.providerId}`, () => runWithRouteContext(
      { taskClass: tc.taskClassId, deploymentId: sel.deploymentId, canonicalVersionId: sel.canonicalVersionId, routingDecisionId: decision.decisionId, segmentId: seg.segmentId, outputContract: contract.mode },
      () => adapter.call!({ providerId: sel.providerId, modelId: sel.modelId, apiKey, baseUrl: ep.baseUrl, contents: prompt, spend: { callSite: 'kernel.model_task', workspaceId: inp.workspaceId, taskId: inp.taskId, correlationId: inp.spendIdempotencyKey ?? inp.taskId, idempotencyKey: spendKey } }),
    ));
    const rows = listUsageForKey(spendKey);
    const row = rows[rows.length - 1] ?? null;
    const termination: ProviderTermination = gen.termination ?? { status: 'NOT_REPORTED', providerStatus: null, reason: null };
    if (gen.modelUsed) modelUsed = gen.modelUsed;
    if (gen.providerUsageMetadata) usageMetadata = gen.providerUsageMetadata;
    latencyMs = gen.latencyMs ?? (Date.now() - started);
    const spendBlocked = !!gen.spendBlockedCode || /^BLOCKED_BUDGET \(/.test(String(gen.lastProviderError || ''));
    if (!spendBlocked) {
      recordProviderAttempt({ provider: sel.providerId, ok: !!gen.output.trim() && !gen.hadProviderError, modelUsed: gen.modelUsed, errorMessage: gen.output.trim() && !gen.hadProviderError ? null : gen.lastProviderError, latencyMs, workspaceId: inp.workspaceId });
    }
    const segUsage = { budgetUsageId: row?.usage_id ?? null, providerResponseId: row?.provider_request_id ?? null, usage: usageMetadata, termination };

    // ---- 5. outcome ------------------------------------------------------------------
    if (spendBlocked) {
      const code = gen.spendBlockedCode || /BLOCKED_BUDGET \(([A-Z_]+)\)/.exec(String(gen.lastProviderError))?.[1] || 'UNKNOWN';
      closeSegment(seg.segmentId, { ...segUsage, status: 'BLOCKED', statusReason: String(gen.lastProviderError).slice(0, 500) });
      const wait = WAIT_CODE_STATE[code] ?? (SPEND_WAIT_CODES.has(code) ? 'PAUSED_AWAITING_CAPACITY' : null);
      if (wait) {
        writeCheckpoint({ taskId: inp.taskId, reason: `SPEND_WAIT: ${code}`, objective: `${inp.taskTitle}\n${inp.description}`, acceptanceCriteria: acceptance(contract), remainingWork: [nextStep || 'Run the task'], tail: outputs.join('') || null });
        transition(inp.taskId, inp.workspaceId, wait, String(gen.lastProviderError));
        return { kind: 'PAUSED', state: wait, reason: String(gen.lastProviderError), decision };
      }
      if (code === 'APPROVAL_REQUIRED_EXPENSIVE') {
        transition(inp.taskId, inp.workspaceId, 'PAUSED_AWAITING_APPROVAL', String(gen.lastProviderError));
        return { kind: 'PAUSED', state: 'PAUSED_AWAITING_APPROVAL', reason: String(gen.lastProviderError), decision };
      }
      if (code === 'RECONCILIATION_REQUIRED') {
        transition(inp.taskId, inp.workspaceId, 'RECONCILING_UNKNOWN_EXECUTION', String(gen.lastProviderError));
        return { kind: 'RECONCILING', reason: String(gen.lastProviderError), segmentId: seg.segmentId };
      }
      return { kind: 'PROVIDER_FAILED', code: 'MODEL_PROVIDER_UNAVAILABLE', error: String(gen.lastProviderError), lastProviderError: gen.lastProviderError, hadProviderError: true };
    }

    if (!gen.output.trim()) {
      const kind = failureKind(gen.lastProviderError, row?.status ?? null);
      if (kind === 'AMBIGUOUS') {
        closeSegment(seg.segmentId, { ...segUsage, status: 'UNKNOWN', statusReason: String(gen.lastProviderError || 'outcome unknown').slice(0, 500) });
        writeCheckpoint({ taskId: inp.taskId, reason: 'UNKNOWN_OUTCOME', objective: `${inp.taskTitle}\n${inp.description}`, acceptanceCriteria: acceptance(contract), remainingWork: [nextStep || 'Run the task'], openQuestions: [`Did ${sel.providerId} accept request ${spendKey}?`], tail: outputs.join('') || null });
        transition(inp.taskId, inp.workspaceId, 'RECONCILING_UNKNOWN_EXECUTION', `The ${sel.providerId} call may have been processed (${gen.lastProviderError ?? 'no response'}). It is NOT retried and NOT switched until reconciled.`, { segmentId: seg.segmentId, usageId: row?.usage_id ?? null });
        return { kind: 'RECONCILING', reason: String(gen.lastProviderError), segmentId: seg.segmentId };
      }
      if (kind === 'CAPACITY') {
        closeSegment(seg.segmentId, { ...segUsage, status: 'FAILED', statusReason: `capacity: ${String(gen.lastProviderError).slice(0, 400)}` });
        writeCheckpoint({ taskId: inp.taskId, reason: 'ROUTE_CAPACITY', objective: `${inp.taskTitle}\n${inp.description}`, acceptanceCriteria: acceptance(contract), remainingWork: [nextStep || 'Run the task'], tail: outputs.join('') || null });
        excludeRoute(inp.taskId, `${sel.providerId}/${sel.modelId}@${sel.deploymentId}`, String(gen.lastProviderError).slice(0, 200));
        transition(inp.taskId, inp.workspaceId, 'ROUTE_SWITCHING', `Route ${sel.providerId}/${sel.modelId} reported capacity exhaustion (${gen.lastProviderError}). The provider rejected the request, so a qualified same-or-stronger route may continue it.`);
        switching = true;
        continue;
      }
      closeSegment(seg.segmentId, { ...segUsage, status: 'FAILED', statusReason: String(gen.lastProviderError || 'empty response').slice(0, 500) });
      return gen.hadProviderError && gen.lastProviderError
        ? { kind: 'PROVIDER_FAILED', code: 'MODEL_PROVIDER_UNAVAILABLE', error: gen.lastProviderError, lastProviderError: gen.lastProviderError, hadProviderError: true }
        : { kind: 'PROVIDER_FAILED', code: 'EMPTY_PROVIDER_RESPONSE', error: 'Model provider returned an empty or unparseable response', lastProviderError: gen.lastProviderError, hadProviderError: gen.hadProviderError };
    }

    if (row?.status === 'SUCCESS') successKeys.push(spendKey);
    outputs.push(gen.output);
    const outputHash = sha256(gen.output);

    if (isOutputCap(termination)) {
      const continuationsUsed = listSegments(inp.taskId).filter((x) => x.status === 'INCOMPLETE').length;
      if (contract.mode === 'NARRATIVE' && tc.segmentable && continuationsUsed < (tc.maxContinuations ?? 0)) {
        // Output pressure on a narrative: the text so far is kept (unverified
        // until assembly), and the next segment continues it.
        closeSegment(seg.segmentId, { ...segUsage, status: 'INCOMPLETE', statusReason: `output capacity reached (${termination.providerStatus ?? termination.reason}); continued in the next segment`, outputHash, artifactHashes: [outputHash] });
        storeSegmentOutput(seg.segmentId, gen.output);
        writeCheckpoint({ taskId: inp.taskId, reason: 'OUTPUT_CAPACITY', objective: `${inp.taskTitle}\n${inp.description}`, acceptanceCriteria: acceptance(contract), remainingWork: ['Continue the text exactly where it stopped, completing the remaining work.'], tail: outputs.join('') });
        transition(inp.taskId, inp.workspaceId, 'AWAITING_CONTINUATION', `Segment ${seg.sequence} reached the output limit; the task continues in segment ${seg.sequence + 1}.`);
        nextStep = 'Continue the text exactly where it stopped, completing the remaining work.';
        switching = false;
        continue;
      }
      // LITERAL / JSON: never split. A NARRATIVE that used every continuation
      // its class allows stops too. Either way the truncated answer stays
      // INCOMPLETE and goes to Aegis as such — never DONE.
      closeSegment(seg.segmentId, { ...segUsage, status: 'INCOMPLETE', statusReason: contract.mode === 'NARRATIVE' ? `output limit reached with no continuation left (${tc.maxContinuations ?? 0} allowed for ${tc.taskClassId})` : `${contract.mode} output truncated at the output limit; a ${contract.mode} answer is never split across segments`, outputHash, artifactHashes: [outputHash] });
      storeSegmentOutput(seg.segmentId, gen.output);
    } else {
      closeSegment(seg.segmentId, { ...segUsage, status: 'COMPLETED', outputHash, artifactHashes: [outputHash] });
      storeSegmentOutput(seg.segmentId, gen.output);
    }
    return {
      kind: 'OUTPUT', output: outputs.join(''), modelUsed, providerId: sel.providerId, modelId: sel.modelId, usageMetadata, termination,
      successUsageKeys: successKeys, decision, taskClass: tc.taskClassId, qualificationId: sel.qualificationId, segments: listSegments(inp.taskId), latencyMs,
    };
  }
}

function acceptance(contract: OutputContract): string[] {
  if (contract.mode === 'LITERAL') return [`The reply is exactly: ${contract.literal}`];
  if (contract.mode === 'JSON_OBJECT') return [`One JSON object with keys: ${(contract.requiredKeys || []).join(', ') || '(any)'}`];
  return ['The provider reports the response complete', 'Aegis integrity and completion scopes pass on the assembled output'];
}

function storeSegmentOutput(segmentId: string, output: string): void {
  getDatabase().prepare('UPDATE task_segments SET output_text = ? WHERE segment_id = ?').run(output.slice(0, 2 * 1024 * 1024), segmentId);
}

function priorOutputs(taskId: string): string[] {
  const db = getDatabase();
  try {
    return (db.prepare("SELECT output_text FROM task_segments WHERE task_id = ? AND status IN ('COMPLETED', 'INCOMPLETE') AND output_text IS NOT NULL ORDER BY sequence").all(taskId) as any[]).map((r) => r.output_text);
  } catch {
    return [];
  }
}
