// ---------------------------------------------------------------------------
// TOOL PACK 2 — the send ledger. Duplicate-send protection.
//
// THE PROBLEM, stated exactly.
// Gmail's messages.send endpoint accepts no idempotency key. There is no
// request id to replay safely, and no way to ask the provider "did you already
// accept this?" — a search for the message proves only that SOMETHING like it
// exists, not that this particular attempt produced it. So idempotency has to
// be local, and it has to be claimed BEFORE the provider is contacted.
//
// WHY THE APPROVAL'S OWN SINGLE-USE IS NOT ENOUGH.
// lib/approvals.ts already consumes an approval atomically, so one approval
// cannot authorize two sends. That protects AUTHORITY. It does not protect the
// SIDE EFFECT, and they fail differently:
//
//   - The approval is consumed, then the process dies before Gmail is called.
//     Authority is spent, nothing was sent. Safe, but the operator needs to
//     know the difference between that and a send that happened.
//   - Gmail accepts the message, then the process dies before anything is
//     recorded. Authority is spent AND a message is in someone's inbox, with
//     no local evidence of it. This is the state that must never be retried,
//     and nothing in the approval record can distinguish it from the case
//     above.
//
// The ledger distinguishes them. A row is claimed before dispatch and resolved
// after, so a row left in DISPATCHED with no message id is precisely "we do not
// know" — and UNKNOWN is a terminal state here, never an input to a retry.
//
// UNIQUE(approval_id) in the schema is the hard stop: a second claim for the
// same approval fails on the constraint, decided by SQLite rather than by
// application logic, the same INSERT-first pattern acquireExecutionClaim uses.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { canonicalizePayload, getDatabase, recordReceipt, signReceiptPayload } from './persistence';
import { recordRuntimeEvent } from './runtime-events';
import { scrubSecrets } from './redact';
import type { GmailSendClaim, GmailErrorCategory } from './gmail-client';

export type GmailSendStatus = 'DISPATCHED' | 'SENT' | 'FAILED' | 'UNKNOWN';

export interface GmailSendAttemptRecord {
  attempt_id: string;
  workspace_id: string;
  approval_id: string;
  connection_id: string;
  task_id: string | null;
  correlation_id: string;
  content_digest: string;
  status: GmailSendStatus;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  error_category: string | null;
  error_message: string | null;
  dispatched_at: string;
  resolved_at: string | null;
}

export type ClaimRefusalCode = 'ALREADY_SENT' | 'ALREADY_DISPATCHED_UNKNOWN' | 'ALREADY_FAILED';

export type ClaimResult =
  | { ok: true; claim: GmailSendClaim; attempt: GmailSendAttemptRecord; existing?: undefined; reason?: undefined; code?: undefined }
  | { ok: false; claim?: undefined; attempt?: undefined; reason: string; code: ClaimRefusalCode; existing: GmailSendAttemptRecord };

/**
 * Claim the right to send exactly once for this approval.
 *
 * On a UNIQUE violation the existing row decides what the caller is told, and
 * every branch refuses:
 *
 *   SENT        — already delivered. Returning the original message id rather
 *                 than sending again is the whole point.
 *   DISPATCHED  — a previous attempt reached the provider and never came back.
 *   UNKNOWN     — same, already classified.
 *   FAILED      — a definite failure. Still refused: a retry needs a NEW
 *                 approval, because a human should see that the first attempt
 *                 failed before authorizing a second. Silent retry is how one
 *                 failed send becomes two delivered ones.
 */
export function claimGmailSend(params: {
  workspaceId: string;
  approvalId: string;
  connectionId: string;
  correlationId: string;
  contentDigest: string;
  taskId?: string | null;
}): ClaimResult {
  const db = getDatabase();
  const now = new Date().toISOString();
  const attemptId = `gsa-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  try {
    db.prepare(
      `INSERT INTO gmail_send_attempts (
         attempt_id, workspace_id, approval_id, connection_id, task_id, correlation_id,
         content_digest, status, provider_message_id, provider_thread_id,
         error_category, error_message, dispatched_at, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DISPATCHED', NULL, NULL, NULL, NULL, ?, NULL)`,
    ).run(
      attemptId, params.workspaceId, params.approvalId, params.connectionId,
      params.taskId ?? null, params.correlationId, params.contentDigest, now,
    );
  } catch (err: any) {
    // UNIQUE(approval_id) — somebody already claimed this send.
    const existing: any = db.prepare('SELECT * FROM gmail_send_attempts WHERE approval_id = ?').get(params.approvalId);
    if (!existing) throw err; // a genuinely different failure, not a duplicate

    const row = existing as GmailSendAttemptRecord;
    if (row.status === 'SENT') {
      return {
        ok: false,
        code: 'ALREADY_SENT',
        reason: `This approved message was already sent (Gmail message id ${row.provider_message_id}) at ${row.resolved_at}. Not sending again.`,
        existing: row,
      };
    }
    if (row.status === 'FAILED') {
      return {
        ok: false,
        code: 'ALREADY_FAILED',
        reason: `A previous send for this approval failed (${row.error_category}) at ${row.resolved_at}. A new approval is required before trying again — a failed send is never retried silently.`,
        existing: row,
      };
    }
    return {
      ok: false,
      code: 'ALREADY_DISPATCHED_UNKNOWN',
      reason: `A previous send for this approval reached Gmail at ${row.dispatched_at} and its outcome is unknown. The message MAY already have been delivered, so this will NOT be retried automatically. Check the mailbox and, if nothing was sent, request a new approval.`,
      existing: row,
    };
  }

  const inserted: any = db.prepare('SELECT * FROM gmail_send_attempts WHERE attempt_id = ?').get(attemptId);
  recordSendEvent(inserted, 'BLOCKED', 'Send claimed; provider not yet contacted.');

  return {
    ok: true,
    attempt: inserted as GmailSendAttemptRecord,
    claim: {
      attemptId,
      approvalId: params.approvalId,
      contentDigest: params.contentDigest,
      __claimed: true,
    },
  };
}

function recordSendEvent(row: any, status: 'SUCCESS' | 'BLOCKED' | 'FAILED', note: string): void {
  try {
    recordRuntimeEvent({
      workspaceId: row.workspace_id,
      eventType: 'CAPABILITY_INVOCATION',
      targetType: 'capability',
      targetId: 'gmail.send',
      status,
      detail: {
        gmailAttemptId: row.attempt_id,
        approvalId: row.approval_id,
        correlationId: row.correlation_id,
        sendStatus: row.status,
        // The provider's own identifier — the evidence that a send happened.
        providerMessageId: row.provider_message_id ?? null,
        providerThreadId: row.provider_thread_id ?? null,
        // A DIGEST, never the recipients or the body.
        contentDigest: row.content_digest,
        errorCategory: row.error_category ?? null,
        note,
      },
    });
  } catch {
    /* evidence must never fail the action */
  }
}

/**
 * A signed receipt for every resolved send, chained into the workspace's
 * authority record with the approval that permitted it. The payload carries
 * ids and digests only — never recipients, subject or body.
 */
function issueSendReceipt(row: GmailSendAttemptRecord): void {
  try {
    const createdAt = row.resolved_at || new Date().toISOString();
    const payloadJson = canonicalizePayload({
      kind: 'gmail.send',
      workspaceId: row.workspace_id,
      attemptId: row.attempt_id,
      approvalId: row.approval_id,
      contentDigest: row.content_digest,
      status: row.status,
      providerMessageId: row.provider_message_id,
      outcome: row.status === 'SENT' ? 'COMPLETED' : 'INCOMPLETE',
      createdAt,
    });
    const s = signReceiptPayload(payloadJson);
    recordReceipt({
      receiptId: `rcpt-gmail-${row.attempt_id}`,
      taskId: row.task_id || `gmail:${row.attempt_id}`,
      reviewId: `gmail-send:${row.attempt_id}`,
      algorithm: s.algorithm,
      publicKey: s.publicKeyPem,
      payloadJson,
      signature: s.signature,
      createdAt,
      approvalId: row.approval_id,
    });
  } catch {
    /* evidence must never fail the action */
  }
}

/** Resolve a claimed send as delivered, recording the provider's identifiers. */
export function resolveGmailSendSent(attemptId: string, messageId: string, threadId: string | null): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE gmail_send_attempts
        SET status = 'SENT', provider_message_id = ?, provider_thread_id = ?, resolved_at = ?
      WHERE attempt_id = ? AND status = 'DISPATCHED'`,
  ).run(messageId, threadId, now, attemptId);
  const row: any = db.prepare('SELECT * FROM gmail_send_attempts WHERE attempt_id = ?').get(attemptId);
  if (row) {
    recordSendEvent(row, 'SUCCESS', 'Gmail accepted the message and returned a message id.');
    issueSendReceipt(row as GmailSendAttemptRecord);
  }
}

/**
 * Resolve a claimed send as failed OR unknown.
 *
 * `ambiguous` decides which. It is not a judgement made here — it comes from
 * GmailApiError.ambiguous, which lib/gmail-client.ts sets only for a timeout,
 * a network failure mid-send, or a 2xx with no message id. Those are the three
 * ways Gmail can have delivered a message without telling us.
 */
export function resolveGmailSendFailure(
  attemptId: string,
  category: GmailErrorCategory | string,
  message: string,
  ambiguous: boolean,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE gmail_send_attempts
        SET status = ?, error_category = ?, error_message = ?, resolved_at = ?
      WHERE attempt_id = ? AND status = 'DISPATCHED'`,
  ).run(ambiguous ? 'UNKNOWN' : 'FAILED', String(category), scrubSecrets(message, 400), now, attemptId);
  const row: any = db.prepare('SELECT * FROM gmail_send_attempts WHERE attempt_id = ?').get(attemptId);
  if (row) {
    recordSendEvent(
      row,
      'FAILED',
      ambiguous
        ? 'Gmail send outcome is UNKNOWN — the message may have been delivered. Will not be retried automatically.'
        : 'Gmail refused the message before delivery.',
    );
    issueSendReceipt(row as GmailSendAttemptRecord);
  }
}

export function getGmailSendAttemptByApproval(approvalId: string): GmailSendAttemptRecord | null {
  const row: any = getDatabase().prepare('SELECT * FROM gmail_send_attempts WHERE approval_id = ?').get(approvalId);
  return row ? (row as GmailSendAttemptRecord) : null;
}

/** Workspace-scoped, always. */
export function listWorkspaceGmailSendAttempts(workspaceId: string, limit = 100): GmailSendAttemptRecord[] {
  const rows: any = getDatabase()
    .prepare('SELECT * FROM gmail_send_attempts WHERE workspace_id = ? ORDER BY dispatched_at DESC LIMIT ?')
    .all(workspaceId, Math.max(1, Math.min(limit, 500)));
  return (rows || []) as GmailSendAttemptRecord[];
}

/** Attach the task id once the executor has created one. Only ever fills a NULL. */
export function linkGmailSendToTask(attemptId: string, taskId: string): void {
  try {
    getDatabase()
      .prepare('UPDATE gmail_send_attempts SET task_id = ? WHERE attempt_id = ? AND task_id IS NULL')
      .run(taskId, attemptId);
  } catch {
    /* a missing back-link is a visible gap, never a reason to fail a send */
  }
}
