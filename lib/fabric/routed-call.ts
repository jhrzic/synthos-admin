// ---------------------------------------------------------------------------
// ROUTED MODEL CALL — the one way a non-task call site runs a model.
//
//   task requirements → qualification → canonical router → Guardian
//     → spend guard → execution (protocol adapter)
//
// Chat, Jarvis, conversation, YouTube, decomposition, skills, the review
// seat, research synthesis and the AEO probes use this. Kernel tasks use the
// segment runner (lib/continuity/segment-runner.ts), which adds continuity
// on top of the same steps.
//
// Rules this module enforces for every caller:
//   * No default model. A caller either pins one (validated, never swapped)
//     or the router selects a route QUALIFIED for the call's task class.
//   * No model-name prefix routing, no candidate lists, no failover: one
//     routing decision, one dispatch, one ledger row.
//   * The decision is persisted before anything is sent; the ledger row names
//     it (route context).
//   * Nothing qualified → a truthful refusal with the router's reason and
//     wait state. Unknown outcome → reported as UNKNOWN, never retried here.
// ---------------------------------------------------------------------------

import { resolveRoute, credentialForTarget } from '../registry';
import { getStoredProvider } from '../registry/store';
import { deploymentsOf, providerBodyForDeployment } from '../registry/identity';
import { resolveProviderEndpoint } from '../registry/endpoints';
import { getProtocolAdapter, inputCharsOf, type ChatMessage } from '../registry/protocols';
import { resolveTaskClass } from '../registry/qualification';
import { routeTask, requirementsFor, type RoutingConstraints, type RoutingDecision, type WaitState } from '../registry/router';
import { runWithRouteContext } from '../registry/route-context';
import { listUsageForKey } from '../spend/ledger';
import { recordProviderAttempt } from '../provider-state';
import type { ProviderTermination } from './output-contract';
import type { PrivacyClass } from '../registry/types';

export interface RoutedCallInput {
  /** Spend call site; also selects the task class (registry data) when none is given. */
  callSite: string;
  workspaceId: string | null;
  taskId?: string | null;
  taskClass?: string | null;
  outputContract?: 'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT';
  /** A model the caller pinned (canonical id or alias). Empty → the router selects. */
  model?: string | null;
  prompt?: string;
  messages?: ChatMessage[];
  responseFormat?: 'json';
  tools?: Array<'web_search'>;
  idempotencyKey: string;
  maxOutputTokens?: number;
  /** What Guardian inspects. Defaults to the prompt / last user message. */
  instruction?: string;
  routing?: RoutingConstraints | null;
  privacyClass?: PrivacyClass | null;
  invoke?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

export type RoutedCallRefusal =
  | 'TASK_CLASS_UNKNOWN' | 'MODEL_NOT_REGISTERED' | 'MODEL_AMBIGUOUS' | 'UNSUPPORTED_BY_ADAPTER' | 'ENDPOINT_NOT_APPROVED'
  | 'NO_QUALIFIED_ROUTE' | 'GUARDIAN_REFUSED' | 'SPEND_BLOCKED' | 'OUTCOME_UNKNOWN' | 'PROVIDER_FAILED';

export type RoutedCallResult =
  | {
      ok: true;
      output: string;
      providerId: string;
      modelId: string;
      modelUsed: string;
      canonicalVersionId: string | null;
      termination: ProviderTermination;
      usageMetadata: unknown;
      raw: unknown;
      decision: RoutingDecision;
      usageId: string | null;
      taskClass: string;
    }
  | { ok: false; code: RoutedCallRefusal; error: string; waitState?: WaitState; spendCode?: string | null; decision?: RoutingDecision | null; taskClass?: string | null };

const passthrough = <T>(_: string, fn: () => Promise<T>) => fn();

export async function routedModelCall(inp: RoutedCallInput): Promise<RoutedCallResult> {
  const tc = resolveTaskClass({ taskClass: inp.taskClass ?? null, callSite: inp.callSite, outputContract: inp.outputContract ?? null });
  if (!tc) return { ok: false, code: 'TASK_CLASS_UNKNOWN', error: `No task class is registered for "${inp.taskClass || inp.callSite}". Nothing was run.` };

  const constraints: RoutingConstraints = { ...(inp.routing ?? {}) };
  if (inp.model && inp.model.trim()) {
    const r = resolveRoute(inp.model.trim());
    if (!r.ok) return { ok: false, code: r.code, error: r.reason, taskClass: tc.taskClassId };
    constraints.pinnedRoute = { providerId: r.providerId, modelId: r.modelId };
    constraints.mode = 'PINNED_ROUTE';
  }
  const text = inp.messages ? inp.messages.map((m) => m.content).join('\n') : (inp.prompt ?? '');
  const lastUser = inp.messages ? [...inp.messages].reverse().find((m) => m.role === 'user')?.content : inp.prompt;
  const req = requirementsFor({
    taskClass: tc.taskClassId, outputContract: inp.outputContract, instruction: inp.instruction ?? lastUser ?? text,
    inputChars: text.length, expectedOutputTokens: inp.maxOutputTokens, privacyClass: inp.privacyClass ?? 'STANDARD',
    extraCapabilities: inp.tools?.includes('web_search') ? ['tools.web_search'] : [],
  });
  if ('error' in req) return { ok: false, code: 'TASK_CLASS_UNKNOWN', error: req.error };

  const decision = routeTask({ workspaceId: inp.workspaceId, taskId: inp.taskId ?? null, requirements: req, constraints });
  if (!decision.selected) {
    return {
      ok: false, code: decision.outcome === 'GUARDIAN_REFUSED' ? 'GUARDIAN_REFUSED' : 'NO_QUALIFIED_ROUTE',
      error: decision.explanation, waitState: decision.waitState, decision, taskClass: tc.taskClassId,
    };
  }
  const sel = decision.selected;
  const body = getStoredProvider(sel.providerId)!.manifest.provider;
  const dep = deploymentsOf(body).find((d) => d.deploymentId === sel.deploymentId)!;
  const ep = resolveProviderEndpoint(providerBodyForDeployment(body, dep));
  const adapter = getProtocolAdapter(body.protocol);
  if (!ep.ok) return { ok: false, code: 'ENDPOINT_NOT_APPROVED', error: ep.reason, decision, taskClass: tc.taskClassId };
  if (!adapter?.call) return { ok: false, code: 'UNSUPPORTED_BY_ADAPTER', error: `${body.protocol} cannot be dispatched as a model call in this build.`, decision, taskClass: tc.taskClassId };
  for (const t of inp.tools || []) {
    if (!adapter.tools?.includes(t)) return { ok: false, code: 'UNSUPPORTED_BY_ADAPTER', error: `The selected route's adapter (${body.protocol}) cannot send the ${t} tool.`, decision, taskClass: tc.taskClassId };
  }

  const started = Date.now();
  const invoke = inp.invoke ?? passthrough;
  const gen = await invoke(`model.${sel.providerId}`, () => runWithRouteContext(
    { taskClass: tc.taskClassId, deploymentId: sel.deploymentId, canonicalVersionId: sel.canonicalVersionId, routingDecisionId: decision.decisionId, outputContract: inp.outputContract ?? tc.outputContract },
    () => adapter.call!({
      providerId: sel.providerId, modelId: sel.modelId, apiKey: credentialForTarget(sel.providerId), baseUrl: ep.baseUrl,
      contents: inp.prompt ?? '', messages: inp.messages, responseFormat: inp.responseFormat, tools: inp.tools,
      spend: { callSite: inp.callSite, workspaceId: inp.workspaceId, taskId: inp.taskId ?? null, idempotencyKey: inp.idempotencyKey, ...(inp.maxOutputTokens ? { maxOutputTokens: inp.maxOutputTokens } : {}) },
    }),
  ));
  const row = listUsageForKey(inp.idempotencyKey).pop() ?? null;
  const spendBlocked = !!gen.spendBlockedCode || /^BLOCKED_BUDGET \(/.test(String(gen.lastProviderError || ''));
  if (spendBlocked) {
    const code = gen.spendBlockedCode || /BLOCKED_BUDGET \(([A-Z_]+)\)/.exec(String(gen.lastProviderError))?.[1] || null;
    return { ok: false, code: 'SPEND_BLOCKED', spendCode: code, error: String(gen.lastProviderError), decision, taskClass: tc.taskClassId };
  }
  const okOut = !!gen.output?.trim() && !gen.hadProviderError;
  recordProviderAttempt({ provider: sel.providerId, ok: okOut, modelUsed: gen.modelUsed, errorMessage: okOut ? null : gen.lastProviderError, latencyMs: gen.latencyMs ?? (Date.now() - started), workspaceId: inp.workspaceId ?? undefined });
  if (row && (row.status === 'UNKNOWN' || row.status === 'TIMEOUT_AFTER_DISPATCH')) {
    return { ok: false, code: 'OUTCOME_UNKNOWN', error: `The ${sel.providerId} call may have been processed (${gen.lastProviderError ?? 'no response'}); it is not retried.`, decision, taskClass: tc.taskClassId };
  }
  if (!okOut) return { ok: false, code: 'PROVIDER_FAILED', error: gen.lastProviderError || 'The provider returned no text.', decision, taskClass: tc.taskClassId };
  return {
    ok: true, output: gen.output, providerId: sel.providerId, modelId: sel.modelId, modelUsed: gen.modelUsed || sel.modelId,
    canonicalVersionId: sel.canonicalVersionId, termination: gen.termination ?? { status: 'NOT_REPORTED', providerStatus: null, reason: null },
    usageMetadata: gen.providerUsageMetadata, raw: gen.raw ?? null, decision, usageId: row?.usage_id ?? null, taskClass: tc.taskClassId,
  };
}

/** One-line operator-facing explanation of a refusal (safe to show; no provider body). */
export function describeRefusal(r: Extract<RoutedCallResult, { ok: false }>): string {
  return r.code === 'NO_QUALIFIED_ROUTE' ? `No qualified model route: ${r.error}` : r.error;
}

export { inputCharsOf };

/**
 * A routing PREVIEW for a call site (nothing persisted, nothing sent) — lets a
 * route refuse early and truthfully before doing expensive preparation.
 */
export function previewRoutedCall(p: { callSite: string; workspaceId: string | null; model?: string | null; tools?: Array<'web_search'>; inputChars?: number }): { ok: true; decision: RoutingDecision } | { ok: false; code: RoutedCallRefusal; error: string; waitState?: WaitState } {
  const tc = resolveTaskClass({ taskClass: null, callSite: p.callSite, outputContract: null });
  if (!tc) return { ok: false, code: 'TASK_CLASS_UNKNOWN', error: `No task class is registered for "${p.callSite}". Nothing was run.` };
  const constraints: RoutingConstraints = {};
  if (p.model && p.model.trim()) {
    const r = resolveRoute(p.model.trim());
    if (!r.ok) return { ok: false, code: r.code, error: r.reason };
    constraints.pinnedRoute = { providerId: r.providerId, modelId: r.modelId };
    constraints.mode = 'PINNED_ROUTE';
  }
  const req = requirementsFor({ taskClass: tc.taskClassId, inputChars: p.inputChars ?? 0, extraCapabilities: p.tools?.includes('web_search') ? ['tools.web_search'] : [] });
  if ('error' in req) return { ok: false, code: 'TASK_CLASS_UNKNOWN', error: req.error };
  const d = routeTask({ workspaceId: p.workspaceId, requirements: req, constraints, persist: false });
  return d.selected ? { ok: true, decision: d } : { ok: false, code: d.outcome === 'GUARDIAN_REFUSED' ? 'GUARDIAN_REFUSED' : 'NO_QUALIFIED_ROUTE', error: d.explanation, waitState: d.waitState };
}
