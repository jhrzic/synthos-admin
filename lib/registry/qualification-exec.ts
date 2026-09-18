// ---------------------------------------------------------------------------
// QUALIFICATION EXECUTION — run a suite's cases through the CANONICAL path.
//
// Every case, exactly once:
//
//   qualification case → canonical router (decision persisted, Guardian
//   verdict recorded, pinned to the open run's own route) → spend guard
//   (ledger row naming the run and the decision) → protocol adapter →
//   Aegis (ledger integrity + completion + instruction compliance, recorded
//   as a review) → signed receipt (on the authority record) → case result.
//
// There is no evaluation back door: with paid execution OFF a paid route is
// refused by the router and the guard; with local execution OFF a local route
// is refused the same way. Nothing is retried, nothing falls back, and a case
// whose ledger key already exists is never dispatched again. An UNKNOWN
// outcome (a call that may have been processed) stops the run: it is reported
// for reconciliation and no further case is sent.
//
// A case's output is evidence, not knowledge: no artifact is written, nothing
// is indexed into memory, and passing a suite qualifies nothing — only an
// operator's approveQualification() does (./qualification.ts).
//
// SANDBOX vs CANARY is the operator's statement of where the run happened
// (a sandbox workspace vs a limited production canary); approval requires at
// least one CANARY case backed by a SUCCESS ledger row.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getStoredProvider } from './store';
import { deploymentsOf, providerBodyForDeployment } from './identity';
import { resolveProviderEndpoint } from './endpoints';
import { getProtocolAdapter } from './protocols';
import { credentialForTarget } from './index';
import { runWithRouteContext } from './route-context';
import { getRun, getSuite, getTaskClass, recordCaseResult, evaluateCase, type CaseResult } from './qualification';
import { routeTask, requirementsFor } from './router';
import { listUsageForKey } from '../spend/ledger';
import { verifyContent, type OutputContract } from '../fabric/output-contract';
import { recordQualityReview, recordReceipt, canonicalizePayload, signReceiptPayload, verifyReceiptSignature, type CanonicalReceiptPayload } from '../persistence';

/** A local model may need to load into memory on its first call; a remote API does not. */
export const LOCAL_CASE_TIMEOUT_MS = 300_000;

export const QUALIFICATION_REVIEWER = 'Guardian-Aegis-Qualification-v1';
export const QUALIFICATION_METHOD = 'QUALIFICATION_LEDGER_AUDIT+COMPLETION+INSTRUCTION_COMPLIANCE';

export interface CaseEvidence {
  caseId: string;
  repetition: number;
  caseRef: string;
  decisionId: string | null;
  guardian: string | null;
  usageId: string | null;
  costUsd: number | null;
  providerRequestId: string | null;
  termination: string | null;
  output: string | null;
  pass: boolean;
  reviewId: string | null;
  aegisDecision: string | null;
  receiptId: string | null;
  receiptVerified: boolean;
}

export type QualificationExecResult =
  | { ok: true; recorded: number; refused: Array<{ caseId: string; repetition?: number; reason: string; decisionId?: string | null }>; cases: CaseEvidence[]; stoppedOnUnknown: { caseId: string; repetition: number; usageId: string | null; reason: string } | null }
  | { ok: false; error: string };

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * A LOCAL case's ledger row must show a CALCULATED $0 — reserved at $0 and
 * settled with a KNOWN actual cost of $0. An actual cost the guard could not
 * calculate (ACTUAL_COST_UNKNOWN) fails this check; the $0 estimate is never
 * substituted for it.
 */
export function localZeroCostCheck(row: any): { check: string; ok: boolean; evidence: string } {
  const est = row?.estimated_cost_usd;
  const act = row?.actual_cost_usd;
  const ok = !!row && est !== null && est !== undefined && Number(est) === 0 && row.actual_cost_state === 'KNOWN' && act !== null && act !== undefined && Number(act) === 0;
  return { check: 'integrity:local_zero_cost', ok, evidence: `estimated $${est ?? '?'}, actual $${act ?? '?'} (${row?.actual_cost_state ?? 'no state'})` };
}

export async function executeQualificationCases(p: { runId: string; workspaceId: string; source: 'SANDBOX' | 'CANARY'; actor: string }): Promise<QualificationExecResult> {
  const run = getRun(p.runId);
  if (!run) return { ok: false, error: 'no such run' };
  if (run.status !== 'OPEN') return { ok: false, error: `run is ${run.status}` };
  const suite = getSuite(run.suite_id, run.suite_version)!;
  const tc = getTaskClass(run.task_class);
  if (!tc) return { ok: false, error: `task class ${run.task_class} does not exist` };
  const body = getStoredProvider(run.provider_id)?.manifest.provider;
  if (!body) return { ok: false, error: 'provider not installed' };
  const dep = deploymentsOf(body).find((d) => d.deploymentId === run.deployment_id);
  if (!dep) return { ok: false, error: 'deployment not found' };
  const ep = resolveProviderEndpoint(providerBodyForDeployment(body, dep));
  const adapter = getProtocolAdapter(body.protocol);
  if (!ep.ok) return { ok: false, error: ep.reason };
  if (!adapter?.call) return { ok: false, error: `no dispatch adapter for ${body.protocol}` };
  if (suite.cases.some((c) => /\{fixture_/.test(JSON.stringify(c.check)))) return { ok: false, error: `${suite.suiteId} needs operator-supplied fixtures; record its case results directly` };
  const apiKey = credentialForTarget(run.provider_id);
  const local = body.billing === 'FREE_LOCAL';

  let recorded = 0;
  const refused: Array<{ caseId: string; repetition?: number; reason: string; decisionId?: string | null }> = [];
  const cases: CaseEvidence[] = [];
  for (let rep = 1; rep <= Math.max(1, suite.repetitions); rep++) {
    for (const c of suite.cases) {
      const key = `qualification:${p.runId}:${c.caseId}:${rep}`;
      const caseRef = `qcase:${p.runId}:${c.caseId}:${rep}`;
      // Dispatched before (ledger key exists) → never sent again, whatever happened.
      if (listUsageForKey(key).length) { refused.push({ caseId: c.caseId, repetition: rep, reason: 'ALREADY_DISPATCHED: this case already has a ledger row; it is never sent twice' }); continue; }

      // 1. CANONICAL ROUTER — pinned to the run's route; Guardian inspects the case prompt.
      const req = requirementsFor({ taskClass: run.task_class, outputContract: tc.outputContract, instruction: c.prompt, inputChars: c.prompt.length });
      if ('error' in req) return { ok: false, error: req.error };
      const decision = routeTask({ workspaceId: p.workspaceId, taskId: caseRef, requirements: req, qualificationRunId: p.runId });
      const sel = decision.selected;
      if (!sel || sel.providerId !== run.provider_id || sel.modelId !== run.model_id || sel.deploymentId !== run.deployment_id) {
        const codes = [...new Set(decision.candidates.filter((x) => x.providerId === run.provider_id && x.modelId === run.model_id).flatMap((x) => x.disqualified.map((d) => d.code)))];
        refused.push({ caseId: c.caseId, repetition: rep, decisionId: decision.decisionId, reason: `${decision.outcome}${codes.length ? ` (${codes.join(', ')})` : ''}: ${decision.explanation}` });
        continue;
      }

      // 2. SPEND GUARD + ADAPTER — one dispatch, no retry, no fallback.
      const gen = await runWithRouteContext(
        { qualificationRunId: p.runId, routingDecisionId: decision.decisionId, deploymentId: run.deployment_id, canonicalVersionId: run.canonical_version_id, taskClass: run.task_class, outputContract: tc.outputContract },
        () => adapter.call!({
          providerId: run.provider_id, modelId: run.model_id, apiKey, baseUrl: ep.baseUrl, contents: c.prompt,
          ...(local ? { timeoutMs: LOCAL_CASE_TIMEOUT_MS } : {}),
          spend: { callSite: 'registry.qualification', workspaceId: p.workspaceId, taskId: caseRef, correlationId: p.runId, idempotencyKey: key },
        }),
      );
      if (gen.spendBlockedCode || /^BLOCKED_BUDGET \(/.test(String(gen.lastProviderError || ''))) {
        refused.push({ caseId: c.caseId, repetition: rep, decisionId: decision.decisionId, reason: String(gen.lastProviderError) });
        continue;
      }
      const row: any = listUsageForKey(key).pop() ?? null;
      if (row && (row.status === 'UNKNOWN' || row.status === 'TIMEOUT_AFTER_DISPATCH' || row.status === 'RESERVED' || row.status === 'DISPATCHED')) {
        // May have been processed: stop, report, reconcile. Never re-sent.
        return { ok: true, recorded, refused, cases, stoppedOnUnknown: { caseId: c.caseId, repetition: rep, usageId: row.usage_id, reason: `ledger row ${row.usage_id} is ${row.status}: ${gen.lastProviderError ?? 'no response'}` } };
      }
      const output = gen.output && gen.output.trim() ? gen.output : '';
      const term = gen.termination ?? { status: 'NOT_REPORTED' as const, providerStatus: null, reason: null };

      // 3. AEGIS — integrity from the ledger, completion, instruction compliance.
      const integrityChecks = [
        { check: 'integrity:ledger_row_exists', ok: !!row, evidence: row ? `ledger row ${row.usage_id}` : 'no ledger row for this case key' },
        { check: 'integrity:ledger_status_success', ok: row?.status === 'SUCCESS', evidence: `status ${row?.status ?? 'none'}` },
        { check: 'integrity:ledger_names_route', ok: row?.provider === run.provider_id && row?.model === run.model_id && (row?.deployment_id ?? run.deployment_id) === run.deployment_id, evidence: `${row?.provider}/${row?.model}@${row?.deployment_id ?? 'default'}` },
        { check: 'integrity:ledger_names_decision', ok: row?.routing_decision_id === decision.decisionId, evidence: `routing_decision_id ${row?.routing_decision_id ?? 'none'}` },
        { check: 'integrity:ledger_names_run', ok: row?.correlation_id === p.runId, evidence: `correlation_id ${row?.correlation_id ?? 'none'}` },
        ...(local ? [localZeroCostCheck(row)] : []),
      ];
      const integrityOk = integrityChecks.every((x) => x.ok);
      const scored = output ? evaluateCase(c.check, output) : { pass: false, detail: 'no output' };
      const contract: OutputContract = c.check.type === 'EXACT' ? { mode: 'LITERAL', literal: c.check.expected } : { mode: tc.outputContract === 'JSON_OBJECT' ? 'JSON_OBJECT' : 'NARRATIVE', ...(c.check.type === 'JSON_KEYS' ? { requiredKeys: c.check.requiredKeys } : {}) };
      const content = verifyContent({ integrityDecision: integrityOk ? 'VERIFIED' : 'FAILED', output, termination: term, contract });
      // The suite's own check is the instruction-compliance verdict for this case.
      const compliant = scored.pass;
      const verified = integrityOk && content.decision === 'VERIFIED' && compliant;
      const aegisDecision = verified ? 'VERIFIED' : content.decision === 'VERIFIED' ? 'VERIFICATION_FAILED' : content.decision;
      const checks = [
        ...integrityChecks.map((x) => ({ check: x.check, status: x.ok ? 'PASS' : 'FAIL', evidence: x.evidence })),
        ...content.checks,
        { check: `instruction:suite_${c.check.type.toLowerCase()}`, status: compliant ? 'PASS' : 'FAIL', evidence: scored.detail },
      ];
      const nowIso = new Date().toISOString();
      const review = recordQualityReview({
        taskId: caseRef, reviewer: QUALIFICATION_REVIEWER, method: QUALIFICATION_METHOD, score: verified ? 1 : 0, decision: aegisDecision, checks,
        evidence: { qualificationRunId: p.runId, caseId: c.caseId, repetition: rep, routingDecisionId: decision.decisionId, usageId: row?.usage_id ?? null, termination: term, scopeStatement: content.scopeStatement, outputHash: sha256(output) },
        createdAt: nowIso,
      });

      // 4. SIGNED RECEIPT — pass or fail, stating the outcome.
      const receiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const payload: CanonicalReceiptPayload & Record<string, unknown> = {
        receiptId, taskId: caseRef, reviewId: review.review_id, workspaceId: p.workspaceId, assignedAgent: 'qualification',
        provider: run.provider_id, modelUsed: gen.modelUsed || run.model_id,
        artifactId: 'none:qualification-evidence', artifactHash: sha256(output),
        aegisDecision, aegisMethod: QUALIFICATION_METHOD,
        outcome: verified ? 'COMPLETED' : !integrityOk ? 'INTEGRITY_FAILED' : term.status !== 'COMPLETE' ? 'INCOMPLETE' : 'VERIFICATION_FAILED',
        verificationScope: `${content.scopeStatement}; suite_check=${compliant ? 'PASS' : 'FAIL'}`,
        registryProviderId: run.provider_id, canonicalModelId: run.model_id, priceVersion: row?.price_version ?? null,
        routingDecisionId: decision.decisionId, qualificationRunId: p.runId, caseId: c.caseId, repetition: rep,
        usageId: row?.usage_id ?? null, providerRequestId: row?.provider_request_id ?? null, termination: `${term.status}:${term.providerStatus ?? ''}`,
        createdAt: nowIso,
      };
      const payloadStr = canonicalizePayload(payload);
      const sig = signReceiptPayload(payloadStr);
      const receiptVerified = verifyReceiptSignature(payloadStr, sig.signature, sig.publicKeyPem);
      if (receiptVerified) recordReceipt({ receiptId, taskId: caseRef, reviewId: review.review_id, algorithm: sig.algorithm, publicKey: sig.publicKeyPem, payloadJson: payloadStr, signature: sig.signature, createdAt: nowIso });

      // 5. CASE RESULT — scored again by the run's own deterministic check.
      const result: CaseResult = {
        caseId: c.caseId, repetition: rep, output: output || null,
        termination: !output && gen.hadProviderError ? 'ERROR' : (term.status as CaseResult['termination']),
        usageId: row?.usage_id ?? null, receiptId: receiptVerified ? receiptId : null, source: p.source,
        decisionId: decision.decisionId, reviewId: review.review_id,
      };
      const r = recordCaseResult(p.runId, result);
      if (r.ok) recorded++;
      cases.push({
        caseId: c.caseId, repetition: rep, caseRef, decisionId: decision.decisionId, guardian: decision.guardian?.status ?? null,
        usageId: row?.usage_id ?? null, costUsd: row ? Number(row.actual_cost_usd ?? row.estimated_cost_usd) : null, providerRequestId: row?.provider_request_id ?? null,
        termination: `${term.status}:${term.providerStatus ?? ''}`, output: output || null, pass: verified,
        reviewId: review.review_id, aegisDecision, receiptId: receiptVerified ? receiptId : null, receiptVerified,
      });
    }
  }
  return { ok: true, recorded, refused, cases, stoppedOnUnknown: null };
}

