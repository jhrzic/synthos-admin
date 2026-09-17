// ---------------------------------------------------------------------------
// TOOL PACK 2 — the Gmail API client.
//
// FOUR OPERATIONS, and the file is organised by EFFECT rather than by endpoint:
//   read-only   gmailSearch, gmailReadThread
//   internal    gmailCreateDraft        (a draft is not a send)
//   external    gmailSendMessage        (the only function that sends)
//
// gmailSendMessage is the only exported function that performs an outward,
// irreversible action, and it is the only one that takes a `sendClaim`. It
// cannot be called without one, so a caller cannot reach the send path without
// having first claimed the attempt in the local ledger — the duplicate-send
// defence is therefore in the type signature rather than in a comment asking
// people to remember it.
//
// ---------------------------------------------------------------------------
// WHY NO googleapis SDK
// ---------------------------------------------------------------------------
// The repo has no Google client library and adding one would pull a large
// transitive tree for four REST calls. Every other external integration here
// (GitHub, MCP, Windmill, Antigravity) is a plain bounded `fetch`, with a
// base-URL override so tests run against a real local double instead of mocking
// fetch. This follows that pattern exactly.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { gmailApiBase, resolveAccessToken, GmailAuthError } from './gmail-connection';
import { readBoundedBody } from './net-guard';
import { scrubSecrets } from './redact';

const GMAIL_TIMEOUT_MS = 15_000;
const MAX_GMAIL_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Ceiling on returned body text per message, so a thread cannot flood context. */
export const MAX_MESSAGE_BODY_CHARS = 20_000;

export type GmailErrorCategory =
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'RECIPIENT'
  | 'QUOTA_OR_RATE_LIMIT'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'PROVIDER_ERROR'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AMBIGUOUS';

export class GmailApiError extends Error {
  readonly category: GmailErrorCategory;
  readonly status: number | null;
  /**
   * True when the request may or may not have taken effect. Only ever set on
   * the send path, and it is the flag that must prevent automatic retry.
   */
  readonly ambiguous: boolean;
  constructor(message: string, category: GmailErrorCategory, status: number | null = null, ambiguous = false) {
    super(message);
    this.name = 'GmailApiError';
    this.category = category;
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

/**
 * Map a provider response to a category.
 *
 * RECIPIENT is separated from INVALID_REQUEST because they need opposite
 * responses from a human: a bad address is corrected and re-approved, a
 * malformed request is a bug in SynthOS. Reporting both as "provider error"
 * would send the operator looking in the wrong place.
 */
function categorize(status: number, body: string): GmailErrorCategory {
  const b = body.toLowerCase();
  if (status === 401) return 'AUTHENTICATION';
  if (status === 403) {
    if (/rate|quota|limit|userRateLimitExceeded/i.test(b)) return 'QUOTA_OR_RATE_LIMIT';
    return 'PERMISSION';
  }
  if (status === 429) return 'QUOTA_OR_RATE_LIMIT';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400) {
    if (/invalid.*(to|recipient|address)|malformed.*address|不正/i.test(b)) return 'RECIPIENT';
    return 'INVALID_REQUEST';
  }
  if (status >= 500) return 'PROVIDER_ERROR';
  return 'PROVIDER_ERROR';
}

interface GmailRequest {
  connectionId: string;
  workspaceId: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Only the send path sets this; it changes how a timeout is classified. */
  sideEffecting?: boolean;
}

async function gmailFetch(req: GmailRequest): Promise<any> {
  let accessToken: string;
  try {
    accessToken = await resolveAccessToken(req.connectionId, req.workspaceId);
  } catch (err: any) {
    if (err instanceof GmailAuthError) {
      throw new GmailApiError(err.message, 'AUTHENTICATION', 401, false);
    }
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(`${gmailApiBase()}${req.path}`, {
      method: req.method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(req.body ? { 'Content-Type': 'application/json' } : {}),
        'User-Agent': 'synthos-gmail',
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });

    const { text } = await readBoundedBody(res, MAX_GMAIL_RESPONSE_BYTES);
    if (!res.ok) {
      throw new GmailApiError(
        // Scrubbed: a provider error body can echo an Authorization header back.
        scrubSecrets(`Gmail API returned HTTP ${res.status}: ${text.slice(0, 400)}`, 500),
        categorize(res.status, text),
        res.status,
        false,
      );
    }
    try { return text ? JSON.parse(text) : {}; } catch {
      throw new GmailApiError('Gmail API returned a non-JSON success response.', 'PROVIDER_ERROR', res.status, false);
    }
  } catch (err: any) {
    if (err instanceof GmailApiError) throw err;
    if (err?.name === 'AbortError') {
      // THE CRITICAL DISTINCTION. A timeout on a read is just a timeout. A
      // timeout on a SEND means the request may already have been accepted and
      // the message may already be in someone's inbox — we do not know. That is
      // AMBIGUOUS, and it must never be retried automatically.
      throw new GmailApiError(
        req.sideEffecting
          ? `Gmail send timed out after ${GMAIL_TIMEOUT_MS}ms. The message MAY have been sent — this is an ambiguous state and will not be retried automatically.`
          : `Gmail request timed out after ${GMAIL_TIMEOUT_MS}ms.`,
        req.sideEffecting ? 'AMBIGUOUS' : 'TIMEOUT',
        null,
        !!req.sideEffecting,
      );
    }
    // A network failure mid-send is equally ambiguous.
    throw new GmailApiError(
      req.sideEffecting
        ? `Gmail send failed at the network layer: ${scrubSecrets(err?.message || String(err), 200)}. The message MAY have been sent — ambiguous, not retried.`
        : scrubSecrets(err?.message || String(err), 200),
      req.sideEffecting ? 'AMBIGUOUS' : 'NETWORK',
      null,
      !!req.sideEffecting,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// ADDRESS + CONTENT HANDLING
// ---------------------------------------------------------------------------

/** Conservative address shape check. Rejects header injection outright. */
export function isValidEmailAddress(addr: string): boolean {
  const a = String(addr || '').trim();
  if (!a || a.length > 320) return false;
  // Newlines or a bare colon in an address are header-injection vectors: they
  // would let a recipient string add its own Bcc: line to the MIME message.
  if (/[\r\n\t]/.test(a)) return false;
  return /^[^\s@<>,;]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(a);
}

export interface GmailMessageSpec {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** For a reply: the thread this belongs to, and the message being replied to. */
  threadId?: string | null;
  inReplyToMessageId?: string | null;
}

export class GmailContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailContentError';
  }
}

function assertAddresses(label: string, list: string[] | undefined): string[] {
  const arr = (list || []).map((a) => String(a || '').trim()).filter(Boolean);
  for (const a of arr) {
    if (!isValidEmailAddress(a)) {
      throw new GmailContentError(`"${a}" is not a valid ${label} address (or contains characters that are refused).`);
    }
  }
  return arr;
}

/**
 * Build the RFC 2822 message.
 *
 * Header values are validated, not escaped. A subject containing a newline
 * cannot be safely encoded into a header by quoting, and attempting to sanitise
 * it invites a bypass — so it is refused. Refusing an odd subject is a minor
 * inconvenience; permitting a Bcc header smuggled through one is not.
 */
export function buildRawMessage(spec: GmailMessageSpec): string {
  if (!isValidEmailAddress(spec.from)) throw new GmailContentError(`Sender "${spec.from}" is not a valid address.`);
  const to = assertAddresses('To', spec.to);
  const cc = assertAddresses('Cc', spec.cc);
  const bcc = assertAddresses('Bcc', spec.bcc);
  if (to.length === 0) throw new GmailContentError('At least one To recipient is required.');

  const subject = String(spec.subject ?? '');
  if (/[\r\n]/.test(subject)) throw new GmailContentError('The subject contains a line break, which is refused as a header-injection risk.');
  if (subject.length > 998) throw new GmailContentError('The subject exceeds the 998-character header limit.');

  const headers: string[] = [
    `From: ${spec.from}`,
    `To: ${to.join(', ')}`,
  ];
  if (cc.length) headers.push(`Cc: ${cc.join(', ')}`);
  if (bcc.length) headers.push(`Bcc: ${bcc.join(', ')}`);
  headers.push(`Subject: ${subject}`);
  if (spec.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${spec.inReplyToMessageId}`);
    headers.push(`References: ${spec.inReplyToMessageId}`);
  }
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 8bit');

  return `${headers.join('\r\n')}\r\n\r\n${spec.body}`;
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The canonical digest of a message's MATERIAL content.
 *
 * This is what a human approval binds to. Everything that changes who receives
 * what is in here — sender, every recipient list, subject, body, thread and
 * the message being replied to. Recipient lists are sorted and lowercased so
 * that reordering them is not treated as a change, while ADDING one always is.
 *
 * Deliberately excludes nothing that matters. Notably Bcc IS included: a Bcc
 * added after approval is exactly the silent-recipient case the binding exists
 * to prevent.
 */
export function computeMessageContentDigest(spec: GmailMessageSpec): string {
  const norm = (l: string[] | undefined) => (l || []).map((a) => a.trim().toLowerCase()).filter(Boolean).sort();
  const canonical = JSON.stringify({
    from: spec.from.trim().toLowerCase(),
    to: norm(spec.to),
    cc: norm(spec.cc),
    bcc: norm(spec.bcc),
    subject: String(spec.subject ?? ''),
    body: String(spec.body ?? ''),
    threadId: spec.threadId ?? null,
    inReplyToMessageId: spec.inReplyToMessageId ?? null,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// READ-ONLY
// ---------------------------------------------------------------------------

export interface GmailSearchHit {
  messageId: string;
  threadId: string;
  snippet: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  date: string | null;
  labelIds: string[];
}

export interface GmailSearchOutcome {
  query: string;
  account: string;
  resultCount: number;
  estimatedTotal: number | null;
  hits: GmailSearchHit[];
  retrievedAt: string;
  sourceEndpoint: string;
}

function headerValue(payload: any, name: string): string | null {
  const headers = payload?.headers;
  if (!Array.isArray(headers)) return null;
  const found = headers.find((h: any) => String(h?.name || '').toLowerCase() === name.toLowerCase());
  return found && typeof found.value === 'string' ? found.value : null;
}

/**
 * Search the connected mailbox.
 *
 * `format: 'metadata'` with an explicit header allowlist is requested rather
 * than 'full'. Search results are a LIST — pulling full bodies for twenty
 * messages to show a result list would put a large amount of private mail into
 * memory (and into any caller's context) that nobody asked to read. Bodies come
 * from gmail.read_thread, where reading is the explicit intent.
 */
export async function gmailSearch(params: {
  connectionId: string;
  workspaceId: string;
  account: string;
  query: string;
  limit?: number;
}): Promise<GmailSearchOutcome> {
  const limit = Math.max(1, Math.min(params.limit ?? 10, 25));
  const q = String(params.query || '').trim();
  if (!q) throw new GmailContentError('A search query is required.');

  const listPath = `/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${limit}`;
  const list = await gmailFetch({ connectionId: params.connectionId, workspaceId: params.workspaceId, path: listPath });

  const ids: Array<{ id: string; threadId: string }> = Array.isArray(list?.messages)
    ? list.messages.filter((m: any) => m?.id).map((m: any) => ({ id: String(m.id), threadId: String(m.threadId || '') }))
    : [];

  const hits: GmailSearchHit[] = [];
  for (const { id } of ids.slice(0, limit)) {
    const metaPath =
      `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata` +
      `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
    const msg = await gmailFetch({ connectionId: params.connectionId, workspaceId: params.workspaceId, path: metaPath });
    hits.push({
      messageId: String(msg?.id || id),
      threadId: String(msg?.threadId || ''),
      snippet: typeof msg?.snippet === 'string' ? msg.snippet.slice(0, 500) : null,
      from: headerValue(msg?.payload, 'From'),
      to: headerValue(msg?.payload, 'To'),
      subject: headerValue(msg?.payload, 'Subject'),
      date: headerValue(msg?.payload, 'Date'),
      labelIds: Array.isArray(msg?.labelIds) ? msg.labelIds.map(String) : [],
    });
  }

  return {
    query: q,
    account: params.account,
    resultCount: hits.length,
    estimatedTotal: typeof list?.resultSizeEstimate === 'number' ? list.resultSizeEstimate : null,
    hits,
    retrievedAt: new Date().toISOString(),
    sourceEndpoint: `${gmailApiBase()}${listPath}`,
  };
}

export interface GmailThreadMessage {
  messageId: string;
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
  date: string | null;
  snippet: string | null;
  body: string;
  bodyTruncated: boolean;
  labelIds: string[];
}

export interface GmailThreadOutcome {
  threadId: string;
  account: string;
  messageCount: number;
  messages: GmailThreadMessage[];
  retrievedAt: string;
  sourceEndpoint: string;
}

/** Decode a Gmail base64url part, tolerating absent/odd padding. */
function decodePart(data: string | undefined): string {
  if (!data) return '';
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** Walk a MIME tree for the best text representation, preferring text/plain. */
function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodePart(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part?.mimeType === 'text/plain' && part.body?.data) return decodePart(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
    for (const part of payload.parts) {
      if (part?.mimeType === 'text/html' && part.body?.data) {
        // Tags stripped rather than rendered — this text goes into a model's
        // context, and HTML there is noise at best.
        return decodePart(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  if (payload.body?.data) return decodePart(payload.body.data);
  return '';
}

/**
 * Read one thread, bounded.
 *
 * READ-ONLY IN THE STRICT SENSE: Gmail will mark messages read as a side effect
 * only if a caller asks it to (by removing the UNREAD label), and nothing here
 * does. There is no modify call in this file at all, and the token does not
 * carry gmail.modify, so an accidental mark-read is not merely unimplemented —
 * it is unauthorized at the provider.
 */
export async function gmailReadThread(params: {
  connectionId: string;
  workspaceId: string;
  account: string;
  threadId: string;
  maxMessages?: number;
}): Promise<GmailThreadOutcome> {
  const threadId = String(params.threadId || '').trim();
  if (!threadId) throw new GmailContentError('A threadId is required.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new GmailContentError('The threadId contains characters that are not valid.');
  const maxMessages = Math.max(1, Math.min(params.maxMessages ?? 20, 50));

  const path = `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`;
  const thread = await gmailFetch({ connectionId: params.connectionId, workspaceId: params.workspaceId, path });

  const raw: any[] = Array.isArray(thread?.messages) ? thread.messages : [];
  const messages: GmailThreadMessage[] = raw.slice(0, maxMessages).map((m: any) => {
    const full = extractBody(m?.payload);
    const truncated = full.length > MAX_MESSAGE_BODY_CHARS;
    return {
      messageId: String(m?.id || ''),
      from: headerValue(m?.payload, 'From'),
      to: headerValue(m?.payload, 'To'),
      cc: headerValue(m?.payload, 'Cc'),
      subject: headerValue(m?.payload, 'Subject'),
      date: headerValue(m?.payload, 'Date'),
      snippet: typeof m?.snippet === 'string' ? m.snippet.slice(0, 500) : null,
      body: truncated ? full.slice(0, MAX_MESSAGE_BODY_CHARS) : full,
      bodyTruncated: truncated,
      labelIds: Array.isArray(m?.labelIds) ? m.labelIds.map(String) : [],
    };
  });

  return {
    threadId,
    account: params.account,
    messageCount: raw.length,
    messages,
    retrievedAt: new Date().toISOString(),
    sourceEndpoint: `${gmailApiBase()}${path}`,
  };
}

// ---------------------------------------------------------------------------
// INTERNAL MUTATION — a draft is not a send
// ---------------------------------------------------------------------------

export interface GmailDraftOutcome {
  draftId: string;
  messageId: string | null;
  threadId: string | null;
  account: string;
  contentDigest: string;
  createdAt: string;
  sourceEndpoint: string;
}

/**
 * Create a draft. This does NOT send.
 *
 * Gmail's drafts.create endpoint stores the message in the Drafts folder and
 * delivers nothing. It is a genuinely internal mutation — the account owner can
 * see it, nobody else can — which is why gmail.create_draft is classed
 * INTERNAL_MUTATION and needs no human approval, while gmail.send is
 * EXTERNAL_ACTION and needs one.
 */
export async function gmailCreateDraft(params: {
  connectionId: string;
  workspaceId: string;
  account: string;
  spec: GmailMessageSpec;
}): Promise<GmailDraftOutcome> {
  const raw = buildRawMessage(params.spec);
  const path = '/gmail/v1/users/me/drafts';
  const body: any = { message: { raw: base64url(raw) } };
  if (params.spec.threadId) body.message.threadId = params.spec.threadId;

  const created = await gmailFetch({
    connectionId: params.connectionId,
    workspaceId: params.workspaceId,
    path,
    method: 'POST',
    body,
  });

  return {
    draftId: String(created?.id || ''),
    messageId: created?.message?.id ? String(created.message.id) : null,
    threadId: created?.message?.threadId ? String(created.message.threadId) : null,
    account: params.account,
    contentDigest: computeMessageContentDigest(params.spec),
    createdAt: new Date().toISOString(),
    sourceEndpoint: `${gmailApiBase()}${path}`,
  };
}

// ---------------------------------------------------------------------------
// EXTERNAL ACTION — the only function that sends
// ---------------------------------------------------------------------------

/**
 * Proof that the caller claimed this send in the local ledger first.
 *
 * Constructed only by lib/gmail-send-ledger.ts. gmailSendMessage requires one,
 * so there is no way to reach the provider send endpoint without a claim row
 * already existing — which is what makes "cannot send twice" structural rather
 * than procedural.
 */
export interface GmailSendClaim {
  readonly attemptId: string;
  readonly approvalId: string;
  readonly contentDigest: string;
  readonly __claimed: true;
}

export interface GmailSendOutcome {
  messageId: string;
  threadId: string | null;
  labelIds: string[];
  account: string;
  contentDigest: string;
  sentAt: string;
  sourceEndpoint: string;
}

export async function gmailSendMessage(params: {
  connectionId: string;
  workspaceId: string;
  account: string;
  spec: GmailMessageSpec;
  /** Required. See GmailSendClaim. */
  sendClaim: GmailSendClaim;
}): Promise<GmailSendOutcome> {
  const digest = computeMessageContentDigest(params.spec);
  if (digest !== params.sendClaim.contentDigest) {
    // The claim was made for different content. Refused rather than sent — this
    // is the last line of defence if an earlier binding check were bypassed.
    throw new GmailApiError(
      'The message content does not match the claimed send (content digest mismatch). Refusing to send.',
      'INVALID_REQUEST',
      null,
      false,
    );
  }

  const raw = buildRawMessage(params.spec);
  const path = '/gmail/v1/users/me/messages/send';
  const body: any = { raw: base64url(raw) };
  if (params.spec.threadId) body.threadId = params.spec.threadId;

  const sent = await gmailFetch({
    connectionId: params.connectionId,
    workspaceId: params.workspaceId,
    path,
    method: 'POST',
    body,
    // Marks timeouts and network failures AMBIGUOUS rather than retryable.
    sideEffecting: true,
  });

  const messageId = String(sent?.id || '');
  if (!messageId) {
    // A 2xx with no id is ambiguous: Gmail may have accepted the message.
    throw new GmailApiError(
      'Gmail returned success but no message id. The message MAY have been sent — ambiguous, not retried.',
      'AMBIGUOUS',
      200,
      true,
    );
  }

  return {
    messageId,
    threadId: sent?.threadId ? String(sent.threadId) : null,
    labelIds: Array.isArray(sent?.labelIds) ? sent.labelIds.map(String) : [],
    account: params.account,
    contentDigest: digest,
    sentAt: new Date().toISOString(),
    sourceEndpoint: `${gmailApiBase()}${path}`,
  };
}
