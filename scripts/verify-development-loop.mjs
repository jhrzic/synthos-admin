// ---------------------------------------------------------------------------
// Bounded, local-only development-loop verification.
//
// Runs ONE task through the real execution kernel end to end:
//
//   Brain context (real FTS5 memory search)
//     -> provider review (OpenAI Responses API contract)
//     -> Vault artifact
//     -> Aegis deterministic verification
//     -> Ed25519 signed receipt (signature verified, not just issued)
//     -> KIL / Guardian gate
//     -> Brain writeback (memory index + knowledge candidate)
//
// 🔴 WHAT THIS IS NOT: a live OpenAI call. The provider is a LOCAL HTTP server
// implementing the real Responses API contract, reached by the real adapter
// through OPENAI_BASE_URL. Nothing leaves this machine, and no OpenAI
// credential is used or needed — the key passed in is a local-only sentinel
// that only this local server ever sees.
//
// The point is to prove every OTHER segment of the loop is real and wired, so
// that when a real OPENAI_API_KEY is added the only untested thing left is the
// network call itself.
//
// Usage:  node --import tsx scripts/verify-development-loop.mjs [--db <path>]
// Default DB is a temp file. Pass --db data/synthos-admin.db to write real,
// inspectable evidence into the live Brain.
// ---------------------------------------------------------------------------

import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const dbFlagIndex = argv.indexOf('--db');
const DB_PATH = dbFlagIndex >= 0 && argv[dbFlagIndex + 1]
  ? path.resolve(argv[dbFlagIndex + 1])
  : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-loop-')), 'loop.db');

process.env.SYNTHOS_DB_PATH = DB_PATH;

const { executeAgentTask } = await import('../lib/fabric/kernel.ts');
const { createExecutionContext } = await import('../lib/fabric/context.ts');
const { searchWorkspaceMemory } = await import('../lib/memory-index.ts');
const persistence = await import('../lib/persistence.ts');
const {
  getDatabase, getTaskReceipts, getTaskQualityReviews, getTaskArtifacts, verifyReceipt,
} = persistence;

const WORKSPACE = process.env.LOOP_WORKSPACE || 'ws-synthos-primary';
const MODEL = 'gpt-5.6-terra';

const line = (s = '') => console.log(s);
const step = (n, s) => console.log(`\n── ${n}. ${s}`);

line(`database        ${DB_PATH}`);
line(`workspace       ${WORKSPACE}`);
line(`requested model ${MODEL}`);

// -- 1. Brain context -------------------------------------------------------
step(1, 'BRAIN CONTEXT — real FTS5 memory search');
let brainHits = [];
try {
  brainHits = searchWorkspaceMemory(WORKSPACE, 'execution', 5) || [];
} catch (err) {
  line(`   memory search failed: ${err?.message || err}`);
}
const brainContext = brainHits.length > 0
  ? brainHits.map((h, i) => `[${i + 1}] ${h.title || h.artifact_id || 'untitled'}`).join('\n')
  : '(no indexed memory rows matched — context is genuinely empty, not fabricated)';
line(`   rows returned: ${brainHits.length}`);
line(`   context passed to the provider:\n${brainContext.split('\n').map((l) => '     ' + l).join('\n')}`);

// A token unique to this run. It is planted in the Brain context and must
// come back inside the artifact, which is how we prove the context actually
// travelled through the provider call rather than being dropped.
const CONTEXT_TOKEN = `brainctx-${Date.now().toString(36)}`;

// -- 2. Local provider double ----------------------------------------------
step(2, 'PROVIDER — local OpenAI Responses API double (NOT api.openai.com)');
let sawAuthHeader = false;
let sawModel = null;
let sawInputContainsToken = false;

const OUTPUT = (token, ctx) => [
  '# Executive Summary & Core Signals',
  '',
  'This document is the output of a LOCAL development-loop verification run.',
  'It was produced by a local HTTP server implementing the OpenAI Responses API',
  'contract, and NOT by a live OpenAI model. It exists to prove the execution',
  'spine is real: Brain context, Vault artifact, Aegis verification, signed',
  'receipt, Guardian gate and Brain writeback.',
  '',
  `Context token echoed from the Brain: ${token}`,
  '',
  '## Discovered Architecture / Code Specifications',
  '',
  'The kernel fixes provider identity before resolving any credential, so a',
  'request for one provider can never be answered by another. The credential is',
  'read server-side through the encrypted store and passed only to the adapter.',
  'See [[execution-kernel]] and [[provider-routing]].',
  '',
  '## Brain context supplied to this run',
  '',
  ctx,
  '',
  '## Market & Developer Pain Points',
  '',
  'Most agent stacks ship whatever the last model returned. Nothing here commits',
  'without deterministic verification and a signed receipt, which is the property',
  'this run demonstrates. See [[verification-gate]] and [[receipt-chain]].',
  '',
  '## Strategic Implications',
  '',
  'With the spine proven, adding a live provider is a credential change rather',
  'than an architectural one. See [[live-provider-activation]].',
  '',
  '## Recommended Next Actions',
  '',
  '1. Add a real OPENAI_API_KEY to the canonical server-side store.',
  '2. Re-run this loop against the live provider.',
  '3. Compare the receipt from both runs — only `modelUsed` should differ.',
].join('\n');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    sawAuthHeader = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ');
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    sawModel = parsed?.model ?? null;
    sawInputContainsToken = typeof parsed?.input === 'string' && parsed.input.includes(CONTEXT_TOKEN);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      // A real provider reports the model it actually ran; the receipt must
      // attest to THAT, not to what we asked for. The suffix makes the
      // difference visible in the receipt below.
      model: `${sawModel}-local-double`,
      output_text: OUTPUT(CONTEXT_TOKEN, brainContext),
      usage: { input_tokens: 1234, output_tokens: 567, total_tokens: 1801 },
    }));
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}`;
// Local-only sentinel. It is NOT an OpenAI credential and is never persisted.
process.env.OPENAI_API_KEY = 'local-double-sentinel-not-a-real-key';
line(`   listening on ${process.env.OPENAI_BASE_URL} (loopback)`);

// -- 3. Run the real kernel -------------------------------------------------
step(3, 'EXECUTION — the real kernel, same path a live run takes');
const taskId = `task-loopverify-${Date.now()}`;
const ctx = createExecutionContext({ workspaceId: WORKSPACE });

const result = await executeAgentTask(
  {
    taskId,
    taskTitle: 'Development loop verification (local provider double)',
    description:
      'Bounded local-only verification of the execution spine. Produced against a local OpenAI-contract double, not a live provider.',
    assignedAgent: 'scout',
    assignedModel: MODEL,
    inputs: `BRAIN CONTEXT (context token ${CONTEXT_TOKEN}):\n${brainContext}`,
  },
  WORKSPACE,
  ctx,
);

line(`   http status   ${result.status}`);
line(`   task status   ${result.body?.status}`);
if (result.body?.error) line(`   error         ${result.body.error}`);

// -- 4. Evidence ------------------------------------------------------------
step(4, 'EVIDENCE — read back from the database, not from the return value');
const artifacts = getTaskArtifacts(taskId) || [];
const reviews = getTaskQualityReviews(taskId) || [];
const receipts = getTaskReceipts(taskId) || [];
const events = getDatabase()
  .prepare('SELECT event_type FROM activity_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC')
  .all(taskId)
  .map((r) => r.event_type);

line(`   activity events  ${events.length}: ${events.join(' -> ')}`);
line(`   artifacts        ${artifacts.length}${artifacts[0] ? ` (${artifacts[0].relative_path})` : ''}`);
line(`   aegis reviews    ${reviews.length}${reviews[0] ? ` decision=${reviews[0].decision} score=${reviews[0].score}` : ''}`);
line(`   receipts         ${receipts.length}${receipts[0] ? ` (${receipts[0].receipt_id})` : ''}`);

let receiptVerified = null;
let receiptModel = null;
if (receipts[0]) {
  // verifyReceipt takes the receipt ROW and returns a boolean. It re-derives
  // the canonical payload, confirms the algorithm, confirms the embedded
  // public key matches this deployment's trusted key, and only then checks
  // the signature — so a receipt signed by a different keypair fails here.
  receiptVerified = verifyReceipt({
    algorithm: receipts[0].algorithm,
    payload_json: receipts[0].payload_json,
    signature: receipts[0].signature,
    public_key: receipts[0].public_key,
  });
  try {
    receiptModel = JSON.parse(receipts[0].payload_json)?.modelUsed ?? null;
  } catch { /* ignore */ }
  line(`   signature        ${receiptVerified ? 'VERIFIED' : 'NOT VERIFIED'} (re-checked against the stored public key)`);
  line(`   attests model    ${receiptModel}`);
}

const kilRows = getDatabase()
  .prepare('SELECT COUNT(*) AS n FROM kil_observations WHERE task_id = ?')
  .get(taskId)?.n ?? 0;
line(`   KIL observations ${kilRows}`);

const indexed = getDatabase()
  .prepare('SELECT COUNT(*) AS n FROM memory_index WHERE workspace_id = ? AND artifact_id = ?')
  .get(WORKSPACE, artifacts[0]?.artifact_id ?? '')?.n ?? 0;
line(`   brain writeback  ${indexed} memory_index row(s) for this artifact`);

const artifactOnDisk = artifacts[0]?.disk_path && fs.existsSync(artifacts[0].disk_path);
const artifactHasToken = artifactOnDisk && fs.readFileSync(artifacts[0].disk_path, 'utf8').includes(CONTEXT_TOKEN);

// -- 5. Verdict -------------------------------------------------------------
step(5, 'VERDICT');
const invocations = ctx.getInvocations().map((i) => i.name);
const checks = {
  BRAIN_CONTEXT_REACHED_PROVIDER: sawInputContainsToken,
  CREDENTIAL_SENT_SERVER_SIDE: sawAuthHeader,
  PROVIDER_ROUTED_OPENAI: invocations.includes('model.openai'),
  NO_GEMINI_SUBSTITUTION: !invocations.includes('model.gemini'),
  MODEL_REQUESTED_AS_SENT: sawModel === MODEL,
  ARTIFACT_WRITTEN: artifacts.length === 1 && !!artifactOnDisk,
  ARTIFACT_CARRIES_BRAIN_CONTEXT: !!artifactHasToken,
  AEGIS_VERIFIED: reviews[0]?.decision === 'VERIFIED',
  RECEIPT_CREATED: receipts.length === 1,
  RECEIPT_SIGNATURE_VERIFIED: receiptVerified === true,
  RECEIPT_ATTESTS_PROVIDER_MODEL: receiptModel === `${MODEL}-local-double`,
  GUARDIAN_KIL_GATE_RAN: kilRows >= 1,
  BRAIN_WRITEBACK: indexed >= 1,
  TASK_COMPLETED: result.body?.status === 'COMPLETED' || events.includes('TASK_COMPLETED'),
  // The provider reported usage; the metric must carry it rather than
  // claiming NOT_AVAILABLE while the number sits in the ledger.
  PROVIDER_USAGE_RECORDED: result.body?.executionMetrics?.tokensConsumed === 1801
    && result.body?.executionMetrics?.metricsStatus === 'LIVE_PROVIDER_METADATA',
};
for (const [k, v] of Object.entries(checks)) line(`   ${v ? 'PASS' : 'FAIL'}  ${k}`);
line(`\n   invocation trace: ${invocations.join(', ') || '(none)'}`);
line(`   execution metrics:        ${JSON.stringify(result.body?.executionMetrics ?? null)}`);
const ledgerUsage = getDatabase()
  .prepare("SELECT payload_json FROM activity_events WHERE task_id = ? AND event_type = 'PROVIDER_COMPLETED'")
  .get(taskId)?.payload_json;
let ledgerUsageObj = null;
try { ledgerUsageObj = JSON.parse(ledgerUsage || '{}'); } catch { /* ignore */ }
line(`   ledger provider+usage:    provider=${ledgerUsageObj?.provider} model=${ledgerUsageObj?.model} usage=${JSON.stringify(ledgerUsageObj?.usage ?? null)}`);

const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
line('');
line(failed.length === 0
  ? 'LOOP_VERIFIED: all segments real. The only untested step is the live network call.'
  : `LOOP_INCOMPLETE: ${failed.join(', ')}`);
line(`TASK_ID: ${taskId}`);

server.close();
process.exit(failed.length === 0 ? 0 : 1);
