// ---------------------------------------------------------------------------
// TOOL PACK 2 — the communication brief.
//
// A STRUCTURED INPUT CONTRACT, not a prompt. The instruction was explicit about
// that distinction and it is the right one: a large generic marketing prompt is
// unreviewable, untestable, and drifts silently. This is a validated object
// with named fields, so a brief can be inspected, diffed, stored in an
// approval record, and rejected for being incomplete before any model sees it.
//
// ---------------------------------------------------------------------------
// DRAFTING AUTHORITY IS SEPARATE FROM SENDING AUTHORITY
// ---------------------------------------------------------------------------
// Nothing in this file can send. It produces a brief and, from a brief plus
// body text, a draft SPEC. Turning a spec into an outbound message is
// gmail.send's job, and that requires a human approval bound to the exact
// content. Keeping them apart means an agent can be given freedom to draft
// without being given any ability to deliver — which is the property that makes
// drafting safe to automate at all.
//
// WHY `prohibitedClaims` IS REQUIRED RATHER THAN OPTIONAL
// The one failure mode that matters commercially is a confident false statement
// to a real prospect: an invented price, a capability SynthOS does not have, a
// deadline nobody agreed. CLAUDE.md already names this ("cannot invent a
// product fact, price or promise" belongs on an agent's Cannot row). Making the
// field required forces the caller to state the boundary every time rather than
// inheriting a default nobody reviewed.
// ---------------------------------------------------------------------------

import type { GmailMessageSpec } from './gmail-client';

export type CommunicationTone = 'direct' | 'warm' | 'formal' | 'technical' | 'brief';

export interface CommunicationBrief {
  /** What this message is FOR. One sentence, not a topic label. */
  purpose: string;
  /** Who is reading it, in terms that change the writing. */
  audience: string;
  tone: CommunicationTone;
  /**
   * Facts the message must contain, each one something already known to be
   * true. A brief is not a research request: anything in here is treated as
   * given, so an unverified claim placed here becomes an asserted fact.
   */
  requiredFacts: string[];
  /**
   * Claims the message must NOT make. Required — see the header.
   * An explicit empty array is a decision; omitting the field is not.
   */
  prohibitedClaims: string[];
  /** The single action the reader should take, or null for purely informational mail. */
  callToAction: string | null;
  /** The sending identity. Bound into the approval digest, never inferred at send time. */
  senderIdentity: string;
  /** Artifact ids only — never filesystem paths. See attachmentPolicy below. */
  attachmentArtifactIds?: string[];
}

export interface BriefValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const MAX_FIELD = 2000;

/**
 * Validate a brief.
 *
 * Returns errors rather than throwing so a UI can show all of them at once;
 * a caller that wants a hard failure checks `valid`.
 */
export function validateCommunicationBrief(brief: Partial<CommunicationBrief> | null | undefined): BriefValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const b = brief || {};

  const requireText = (field: keyof CommunicationBrief, label: string) => {
    const v = (b as any)[field];
    if (typeof v !== 'string' || !v.trim()) errors.push(`${label} is required.`);
    else if (v.length > MAX_FIELD) errors.push(`${label} exceeds ${MAX_FIELD} characters.`);
  };

  requireText('purpose', 'purpose');
  requireText('audience', 'audience');
  requireText('senderIdentity', 'senderIdentity');

  const tones: CommunicationTone[] = ['direct', 'warm', 'formal', 'technical', 'brief'];
  if (!b.tone || !tones.includes(b.tone as CommunicationTone)) {
    errors.push(`tone must be one of: ${tones.join(', ')}.`);
  }

  if (!Array.isArray(b.requiredFacts)) {
    errors.push('requiredFacts must be an array (an empty array is allowed and means "no facts are mandatory").');
  } else if (b.requiredFacts.some((f) => typeof f !== 'string' || !f.trim())) {
    errors.push('every requiredFacts entry must be a non-empty string.');
  }

  // Required, not defaulted — the point of the field is that somebody stated it.
  if (!Array.isArray(b.prohibitedClaims)) {
    errors.push('prohibitedClaims must be an array. State the boundary explicitly; an empty array is a decision, an absent field is not.');
  } else if (b.prohibitedClaims.length === 0) {
    warnings.push('prohibitedClaims is empty. Outbound mail to a real person normally has at least one boundary (for example: no prices, no delivery dates, no capability claims).');
  }

  if (b.callToAction !== null && b.callToAction !== undefined && typeof b.callToAction !== 'string') {
    errors.push('callToAction must be a string or null.');
  }

  if (b.attachmentArtifactIds !== undefined) {
    if (!Array.isArray(b.attachmentArtifactIds)) {
      errors.push('attachmentArtifactIds must be an array of SynthOS artifact ids.');
    } else {
      for (const id of b.attachmentArtifactIds) {
        // Artifact ids only. A path here is refused rather than resolved,
        // because "attach this file" from a model is exactly the input that
        // turns an email tool into a filesystem exfiltration tool.
        if (typeof id !== 'string' || !/^art-[A-Za-z0-9-]+$/.test(id)) {
          errors.push(`"${String(id)}" is not a SynthOS artifact id. Filesystem paths are never accepted as attachments.`);
        }
      }
      if (b.attachmentArtifactIds.length > 0) {
        errors.push('Attachments are not implemented in Tool Pack 2 — see ATTACHMENT_POLICY. Remove attachmentArtifactIds.');
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * ATTACHMENTS — the honest position.
 *
 * Option A from the instruction (no attachments) is taken. The reason is
 * specific rather than reluctance: an attachment materially widens the
 * approval-binding problem. The digest would have to cover attachment CONTENT,
 * not just its name, or "approve this with the Q3 report attached" could be
 * satisfied by a different file with the same name. That means hashing artifact
 * bytes into the binding and re-verifying them at send time, plus a MIME
 * multipart builder, plus a decision about what happens when an artifact is
 * mutated between approval and send.
 *
 * Each of those is tractable; together they are a larger piece of safety work
 * than the rest of this pack, and shipping a half-bound attachment would be
 * exactly the kind of convincing-but-wrong surface the whole approval
 * foundation exists to prevent. So it is refused explicitly, in validation, and
 * reported as NOT_IMPLEMENTED rather than silently ignored.
 */
export const ATTACHMENT_POLICY = 'NOT_IMPLEMENTED_IN_TOOL_PACK_2' as const;

/**
 * Turn a validated brief plus already-written body text into a message spec.
 *
 * This does NOT write the body. Composition is a model's job (or a human's) and
 * happens outside this contract; the contract's job is to carry the constraints
 * alongside the text so an approver sees both. Passing the body in, rather than
 * generating it here, is what keeps this file free of prompts.
 */
export function briefToMessageSpec(params: {
  brief: CommunicationBrief;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
}): GmailMessageSpec {
  return {
    from: params.brief.senderIdentity,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    threadId: params.threadId ?? null,
    inReplyToMessageId: params.inReplyToMessageId ?? null,
  };
}

/**
 * A compact rendering of the brief for the approval queue.
 *
 * The approver needs to see the CONSTRAINTS the message was written under, not
 * only the message. "Does this text obey the brief?" is a question they can
 * only answer if the brief is in front of them.
 */
export function renderBriefForApproval(brief: CommunicationBrief): string {
  const lines = [
    `Purpose: ${brief.purpose}`,
    `Audience: ${brief.audience}`,
    `Tone: ${brief.tone}`,
    `Sender identity: ${brief.senderIdentity}`,
  ];
  if (brief.requiredFacts.length) lines.push(`Required facts: ${brief.requiredFacts.join(' | ')}`);
  if (brief.prohibitedClaims.length) lines.push(`Prohibited claims: ${brief.prohibitedClaims.join(' | ')}`);
  lines.push(`Call to action: ${brief.callToAction ?? '(none — informational)'}`);
  lines.push(`Attachments: ${ATTACHMENT_POLICY}`);
  return lines.join('\n');
}
