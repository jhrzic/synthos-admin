// ---------------------------------------------------------------------------
// QUALIFICATION EXECUTION — run a suite's cases through the NORMAL path.
//
// Each case is one call through the route's protocol adapter, inside a route
// context that names the open qualification run — so the spend guard admits
// it for evaluation only, prices it, reserves it and ledgers it like any other
// paid call. There is no evaluation back door: with paid execution OFF every
// case is refused by the guard and nothing is recorded as a result.
//
// SANDBOX vs CANARY is the operator's statement of where the run happened
// (a sandbox workspace vs a limited production canary); approval requires at
// least one CANARY case backed by a SUCCESS ledger row (./qualification.ts).
// ---------------------------------------------------------------------------

import { getStoredProvider } from './store';
import { deploymentsOf, providerBodyForDeployment } from './identity';
import { resolveProviderEndpoint } from './endpoints';
import { getProtocolAdapter } from './protocols';
import { credentialForTarget } from './index';
import { runWithRouteContext } from './route-context';
import { getRun, getSuite, recordCaseResult, type CaseResult } from './qualification';
import { listUsageForKey } from '../spend/ledger';

export async function executeQualificationCases(p: { runId: string; workspaceId: string; source: 'SANDBOX' | 'CANARY'; actor: string }): Promise<{ ok: true; recorded: number; refused: Array<{ caseId: string; reason: string }> } | { ok: false; error: string }> {
  const run = getRun(p.runId);
  if (!run) return { ok: false, error: 'no such run' };
  if (run.status !== 'OPEN') return { ok: false, error: `run is ${run.status}` };
  const suite = getSuite(run.suite_id, run.suite_version)!;
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
  let recorded = 0;
  const refused: Array<{ caseId: string; reason: string }> = [];
  for (let rep = 1; rep <= Math.max(1, suite.repetitions); rep++) {
    for (const c of suite.cases) {
      const key = `qualification:${p.runId}:${c.caseId}:${rep}`;
      const gen = await runWithRouteContext(
        { qualificationRunId: p.runId, deploymentId: run.deployment_id, canonicalVersionId: run.canonical_version_id, taskClass: run.task_class },
        () => adapter.call!({ providerId: run.provider_id, modelId: run.model_id, apiKey, baseUrl: ep.baseUrl, contents: c.prompt, spend: { callSite: 'registry.qualification', workspaceId: p.workspaceId, correlationId: p.runId, idempotencyKey: key } }),
      );
      if (gen.spendBlockedCode || /^BLOCKED_BUDGET \(/.test(String(gen.lastProviderError || ''))) {
        refused.push({ caseId: c.caseId, reason: String(gen.lastProviderError) });
        continue;
      }
      const row = listUsageForKey(key).pop() ?? null;
      const term = gen.termination?.status ?? 'NOT_REPORTED';
      const result: CaseResult = {
        caseId: c.caseId, repetition: rep, output: gen.output || null,
        termination: !gen.output && gen.hadProviderError ? 'ERROR' : (term as CaseResult['termination']),
        usageId: row?.usage_id ?? null, receiptId: null, source: p.source,
      };
      const r = recordCaseResult(p.runId, result);
      if (r.ok) recorded++;
    }
  }
  return { ok: true, recorded, refused };
}
