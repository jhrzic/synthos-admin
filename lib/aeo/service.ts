// ---------------------------------------------------------------------------
// AEO audit — the ONE runnable service.
//
// Three callers invoke this and nothing re-implements it:
//   1. POST /api/aeo/audit          (the UI)
//   2. executeEnvelope 'aeo.audit'  (the scheduler's recurring recheck)
//   3. a graph node of type 'capability' with capability 'aeo.audit'
//
// Extracting this closed a real gap: the recheck schedule created in the
// previous pass registered `aeo.audit` as a capability but had no executor
// behind it, so it would have failed the moment it fired. A capability that
// is schedulable must be runnable from the same place the scheduler dispatches.
//
// Persistence walks the canonical spine deliberately and in full — Aegis
// genuinely verifies the status history and the activity ledger, so a receipt
// is only issued when the work really happened in the order it claims.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import {
  createInitialTask,
  updateTaskStatus,
  recordActivityEvent,
  recordQualityReview,
  recordReceipt,
  canonicalizePayload,
  signReceiptPayload,
  verifyReceiptSignature,
  type CanonicalReceiptPayload,
} from '../persistence';
import { writeWorkspaceArtifact } from '../vault';
import { indexVaultArtifact } from '../memory-index';
import { runScopedAegis, receiptOutcomeFields, commitContentFailure, isContentFailure, DETERMINISTIC_COMPLETION } from '../fabric/scoped-verification';
import { crawlSite } from './crawler';
import { analyze, renderReport, type AuditAnalysis } from './analyzer';

export interface AeoAuditParams {
  workspaceId: string;
  domain: string;
  businessName?: string;
  location?: string;
  targetService?: string;
  targetKeywords?: string[];
  maxPages?: number;
}

export type AeoAuditResult =
  | {
      outcome: 'SUCCESS';
      taskId: string;
      artifact: { id: string; path: string; contentHash: string };
      aegis: { decision: string; score: number | null; reviewId: string };
      receiptId: string | null;
      analysis: AuditAnalysis;
      report: string;
    }
  | { outcome: 'FAILED'; reason: string; error: string; detail?: unknown };

/**
 * Which AI/search provider (if any) can answer visibility questions right now.
 * Named credentials, never a silent downgrade.
 */
export function resolveGeoProvider(): { providerStatus: 'USED' | 'NOT_CONFIGURED' | 'UNAVAILABLE'; providerDetail: string } {
  const candidates: Array<[string, string | undefined]> = [
    ['GEMINI_API_KEY', process.env.GEMINI_API_KEY],
    ['SERPAPI_KEY', process.env.SERPAPI_KEY],
    ['DATAFORSEO_LOGIN', process.env.DATAFORSEO_LOGIN],
    ['BRIGHTDATA_API_KEY', process.env.BRIGHTDATA_API_KEY],
    ['OPENSEO_API_KEY', process.env.OPENSEO_API_KEY],
  ];
  const present = candidates.filter(([, v]) => Boolean(v && String(v).trim()));
  if (present.length === 0) {
    return {
      providerStatus: 'NOT_CONFIGURED',
      providerDetail:
        'No AI/search visibility provider is configured (checked GEMINI_API_KEY, SERPAPI_KEY, DATAFORSEO_LOGIN, BRIGHTDATA_API_KEY, OPENSEO_API_KEY).',
    };
  }
  return {
    providerStatus: 'UNAVAILABLE',
    providerDetail: `Credential present (${present.map(([k]) => k).join(', ')}) but no visibility query adapter is wired in this build, so no AI query was executed.`,
  };
}

export async function runAeoAudit(params: AeoAuditParams): Promise<AeoAuditResult> {
  const { workspaceId } = params;
  const nowIso = new Date().toISOString();
  const domain = String(params.domain || '').trim();
  if (!domain) return { outcome: 'FAILED', reason: 'MISSING_DOMAIN', error: 'domain is required.' };

  let crawl;
  try {
    crawl = await crawlSite({ domain, maxPages: Number(params.maxPages) || 12 });
  } catch (err: any) {
    return { outcome: 'FAILED', reason: 'CRAWL_FAILED', error: err?.message || 'The site could not be crawled.' };
  }

  if (crawl.pages.every((p) => p.status === null || p.status >= 400)) {
    return {
      outcome: 'FAILED',
      reason: 'SITE_UNREACHABLE',
      error: `No page of ${crawl.origin} returned a success status. Nothing can be analysed.`,
      detail: { origin: crawl.origin, failures: crawl.fetchFailures.slice(0, 5) },
    };
  }

  const analysis = analyze({
    crawl,
    domain,
    businessName: params.businessName,
    location: params.location,
    targetService: params.targetService,
    targetKeywords: params.targetKeywords,
    geo: { queries: [], ...resolveGeoProvider() },
  });

  const report = renderReport(analysis, {
    businessName: params.businessName,
    location: params.location,
    targetService: params.targetService,
  });

  // --- canonical persistence spine ---
  const taskId = `aeo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const title = `SEO/AEO/GEO Audit — ${params.businessName || analysis.origin}`;
  createInitialTask({
    taskId, workspaceId, title,
    description: `Live audit of ${analysis.origin}: ${analysis.crawl.pagesAnalyzed} page(s) crawled, ${analysis.checks.length} checks evaluated.`,
    assignedAgent: 'aeo-auditor', assignedModel: 'deterministic-crawl', createdAt: nowIso,
  });
  // Aegis requires TODO -> READY -> RUNNING -> AWAITING_VERIFICATION plus
  // PROVIDER_COMPLETED and ARTIFACT_SAVED. Walked, not short-circuited.
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'TASK_CREATED', agentId: 'aeo-auditor', payload: { domain: analysis.origin }, createdAt: nowIso });
  updateTaskStatus(taskId, 'READY', undefined, workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'AGENT_ASSIGNED', agentId: 'aeo-auditor', payload: { agent: 'aeo-auditor' }, createdAt: nowIso });
  updateTaskStatus(taskId, 'RUNNING', undefined, workspaceId);
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'EXECUTION_STARTED', agentId: 'aeo-auditor', payload: { pages: analysis.crawl.pagesAnalyzed }, createdAt: nowIso });
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'PROVIDER_COMPLETED', agentId: 'aeo-auditor', payload: { provider: 'synthos-aeo-audit', pagesAnalyzed: analysis.crawl.pagesAnalyzed, checks: analysis.checks.length, durationMs: analysis.crawl.durationMs }, createdAt: nowIso });

  const frontmatter = [
    '---',
    'type: "aeo-audit"',
    `domain: ${JSON.stringify(analysis.origin)}`,
    `businessName: ${JSON.stringify(params.businessName || null)}`,
    `location: ${JSON.stringify(params.location || null)}`,
    `generatedAt: ${JSON.stringify(analysis.generatedAt)}`,
    `pagesAnalyzed: ${analysis.crawl.pagesAnalyzed}`,
    `scoreSeo: ${analysis.scores.seo.score ?? 'null'}`,
    `scoreAeo: ${analysis.scores.aeo.score ?? 'null'}`,
    `scoreGeo: ${analysis.scores.geo.score ?? 'null'}`,
    `scoreOverall: ${analysis.scores.overall.score ?? 'null'}`,
    `taskId: ${JSON.stringify(taskId)}`,
    '---',
    '',
  ].join('\n');

  const artifact = writeWorkspaceArtifact({
    workspaceId, taskId, content: frontmatter + report,
    folder: 'AEO-Audits', extension: 'md', createdAt: nowIso,
  });
  recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'ARTIFACT_SAVED', agentId: 'aeo-auditor', payload: { artifactId: artifact.artifact_id, relativePath: artifact.relative_path, contentHash: artifact.content_hash }, createdAt: nowIso });
  updateTaskStatus(taskId, 'AWAITING_VERIFICATION', undefined, workspaceId);

  // Scoped Aegis. The report is built by SynthOS's own analyzer from real
  // crawl evidence, so completion is DETERMINISTIC_LOCAL by construction; the
  // contract is NARRATIVE. Indexing happens only after VERIFIED + receipt.
  const scoped = runScopedAegis({ taskId, output: frontmatter + report, termination: DETERMINISTIC_COMPLETION, contract: { mode: 'NARRATIVE' } });
  const aegisResult = scoped.review;
  const persistedReview = recordQualityReview({
    taskId, reviewer: aegisResult.reviewer, method: aegisResult.method, score: aegisResult.score,
    decision: aegisResult.decision, checks: aegisResult.checks, evidence: aegisResult.evidence, createdAt: nowIso,
  });

  let receiptId: string | null = null;
  if (aegisResult.decision === 'VERIFIED') {
    updateTaskStatus(taskId, 'AWAITING_RECEIPT', undefined, workspaceId);
    recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'AEGIS_REVIEWED', agentId: 'aegis', payload: { reviewId: persistedReview.review_id, decision: aegisResult.decision, score: aegisResult.score }, createdAt: nowIso });
    const newReceiptId = `rcpt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const canonicalPayload: CanonicalReceiptPayload = {
      receiptId: newReceiptId, taskId, reviewId: persistedReview.review_id, workspaceId,
      assignedAgent: 'aeo-auditor', provider: 'synthos-aeo-audit',
      modelUsed: `crawl:${analysis.crawl.pagesAnalyzed}-pages`,
      artifactId: artifact.artifact_id, artifactHash: artifact.content_hash,
      aegisDecision: aegisResult.decision, aegisMethod: aegisResult.method, ...receiptOutcomeFields(scoped.content), createdAt: nowIso,
    };
    const canonicalPayloadStr = canonicalizePayload(canonicalPayload);
    const { signature, publicKeyPem, algorithm, fingerprint } = signReceiptPayload(canonicalPayloadStr);
    if (verifyReceiptSignature(canonicalPayloadStr, signature, publicKeyPem)) {
      recordReceipt({ receiptId: newReceiptId, taskId, reviewId: persistedReview.review_id, algorithm, publicKey: publicKeyPem, payloadJson: canonicalPayloadStr, signature, createdAt: nowIso });
      recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'RECEIPT_CREATED', agentId: 'guardian', payload: { receiptId: newReceiptId, algorithm, fingerprint, verified: true }, createdAt: nowIso });
      receiptId = newReceiptId;
    }
  } else if (isContentFailure(scoped.content)) {
    commitContentFailure({
      taskId, workspaceId, reviewId: persistedReview.review_id, scoped, artifact,
      identity: { assignedAgent: 'aeo-auditor', provider: 'synthos-aeo-audit', modelUsed: `crawl:${analysis.crawl.pagesAnalyzed}-pages` }, nowIso,
    });
  }

  // DONE only with a verified, signed receipt. Before this the task went DONE
  // whatever Aegis said, and the report was indexed before Aegis ran.
  if (!receiptId) {
    if (!isContentFailure(scoped.content)) {
      updateTaskStatus(taskId, 'FAILED', undefined, workspaceId);
      recordActivityEvent({ taskId, expectedWorkspaceId: workspaceId, eventType: 'AEGIS_REVIEWED', agentId: 'aegis', payload: { reviewId: persistedReview.review_id, decision: aegisResult.decision, verificationScopes: scoped.content.scopes }, createdAt: nowIso });
    }
    return {
      outcome: 'FAILED',
      reason: 'AEGIS_NOT_VERIFIED',
      error: `The audit report did not pass scoped verification (${aegisResult.decision}): ${scoped.content.scopeStatement}`,
      detail: { taskId, artifactId: artifact.artifact_id, reviewId: persistedReview.review_id, decision: aegisResult.decision },
    };
  }
  updateTaskStatus(taskId, 'DONE', undefined, workspaceId);
  try { indexVaultArtifact(workspaceId, artifact.artifact_id); } catch { /* index best-effort */ }

  return {
    outcome: 'SUCCESS',
    taskId,
    artifact: { id: artifact.artifact_id, path: artifact.relative_path, contentHash: artifact.content_hash },
    aegis: { decision: aegisResult.decision, score: aegisResult.score, reviewId: persistedReview.review_id },
    receiptId,
    analysis,
    report,
  };
}

/** Turn selected audit findings into real SynthOS tasks. Used by the route and by graph nodes. */
export function createAuditMissionTasks(params: {
  workspaceId: string;
  auditTaskId?: string;
  domain?: string;
  items: Array<{ title?: string; recommendation?: string; evidence?: string; category?: string }>;
}): { taskId: string; title: string }[] {
  const nowIso = new Date().toISOString();
  return params.items.slice(0, 25).map((it, idx) => {
    const id = `aeo-task-${Date.now()}-${idx}-${crypto.randomBytes(2).toString('hex')}`;
    const title = String(it?.title || 'AEO remediation').slice(0, 200);
    createInitialTask({
      taskId: id, workspaceId: params.workspaceId, title,
      description: [
        String(it?.recommendation || ''),
        it?.evidence ? `\n\n**Evidence:** ${String(it.evidence)}` : '',
        params.domain ? `\n\n**Domain:** ${String(params.domain)}` : '',
        params.auditTaskId ? `\n\n**From audit task:** ${String(params.auditTaskId)}` : '',
      ].join(''),
      assignedAgent: String(it?.category || 'web').slice(0, 40),
      assignedModel: 'n/a', createdAt: nowIso,
    });
    return { taskId: id, title };
  });
}
