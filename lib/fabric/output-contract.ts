// ---------------------------------------------------------------------------
// TASK OUTPUT CONTRACT + AEGIS CONTENT SCOPES.
//
// WHY THIS EXISTS — found by the first bounded live OpenAI proof
// (task live-proof-1789708229286, artifact art-1789708243094-5c4747858050):
//   * the task said "Reply with exactly: SynthOS live proof OK";
//   * the Scribe persona template wrapped it in an Obsidian-memo brief, so the
//     model wrote a 2,228-character document instead;
//   * the response hit max_output_tokens (512 of 512) and stopped mid-sentence;
//   * Aegis — whose checks are ARTIFACT/LEDGER INTEGRITY only — returned
//     VERIFIED/100, a receipt was signed, the task went DONE and the artifact
//     was indexed into the Brain.
//
// THE FIX, within the existing authorities:
//   1. An explicit contract on the task (not a guess from its wording).
//      LITERAL and JSON_OBJECT contracts are built from a contract prompt
//      INSTEAD of the persona template — the persona cannot override them.
//   2. The provider's own termination report is captured (OpenAI Responses
//      `status` / `incomplete_details.reason`; Gemini `finishReason`), and
//      reaching the output cap counts as incomplete.
//   3. Aegis gains two content scopes beside its integrity scope:
//        COMPLETION             — did the provider finish the response?
//        INSTRUCTION_COMPLIANCE — does the output satisfy the contract?
//      A task is VERIFIED only when every scope its contract requires passed,
//      and the review records exactly which scopes those were. Integrity
//      alone never means the answer is correct.
// ---------------------------------------------------------------------------

import type { AegisCheckResult } from '../persistence';

export type OutputContractMode = 'NARRATIVE' | 'LITERAL' | 'JSON_OBJECT';

export interface OutputContract {
  mode: OutputContractMode;
  /** LITERAL: the exact reply required (surrounding whitespace ignored, nothing else). */
  literal?: string;
  /** JSON_OBJECT: keys that must be present in the returned object. */
  requiredKeys?: string[];
}

export const DEFAULT_OUTPUT_CONTRACT: OutputContract = { mode: 'NARRATIVE' };

/** Validate a contract supplied by a task. Returns an error string, or the normalized contract. */
export function normalizeOutputContract(raw: unknown): { ok: true; contract: OutputContract } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, contract: DEFAULT_OUTPUT_CONTRACT };
  if (typeof raw !== 'object') return { ok: false, error: 'outputContract must be an object.' };
  const r = raw as Record<string, unknown>;
  if (r.mode === 'NARRATIVE') return { ok: true, contract: DEFAULT_OUTPUT_CONTRACT };
  if (r.mode === 'LITERAL') {
    if (typeof r.literal !== 'string' || !r.literal.trim()) return { ok: false, error: 'A LITERAL contract needs a non-empty "literal".' };
    if (r.literal.length > 2000) return { ok: false, error: 'A LITERAL contract\'s "literal" is limited to 2,000 characters.' };
    return { ok: true, contract: { mode: 'LITERAL', literal: r.literal } };
  }
  if (r.mode === 'JSON_OBJECT') {
    const keys = Array.isArray(r.requiredKeys) ? r.requiredKeys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0) : [];
    return { ok: true, contract: { mode: 'JSON_OBJECT', requiredKeys: keys } };
  }
  return { ok: false, error: `Unknown outputContract.mode "${String(r.mode)}". Use NARRATIVE, LITERAL or JSON_OBJECT.` };
}

/**
 * The prompt for a LITERAL / JSON_OBJECT contract. Deliberately does NOT
 * include any agent persona: a persona brief ("produce a memo with five
 * wikilinks") is exactly what overrode the literal instruction in the proof.
 * The contract, not the persona, decides the shape of the output.
 */
export function buildContractPrompt(contract: OutputContract, taskTitle: string, description: string): string {
  if (contract.mode === 'LITERAL') {
    return [
      'You are executing a task with a strict output contract.',
      `TASK: ${taskTitle}`,
      `INSTRUCTION: ${description}`,
      '',
      'OUTPUT CONTRACT: reply with exactly the following text and nothing else — no preamble, no explanation, no formatting, no quotes, no code fences:',
      contract.literal!,
    ].join('\n');
  }
  return [
    'You are executing a task with a strict output contract.',
    `TASK: ${taskTitle}`,
    `INSTRUCTION: ${description}`,
    '',
    'OUTPUT CONTRACT: reply with ONE JSON object and nothing else — no prose, no markdown, no code fences.',
    contract.requiredKeys && contract.requiredKeys.length ? `The object MUST contain these keys: ${contract.requiredKeys.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// PROVIDER TERMINATION
// ---------------------------------------------------------------------------

export type TerminationStatus = 'COMPLETE' | 'INCOMPLETE' | 'NOT_REPORTED';

export interface ProviderTermination {
  status: TerminationStatus;
  /** The provider's own words: OpenAI response `status`, Gemini `finishReason`. */
  providerStatus: string | null;
  /** OpenAI `incomplete_details.reason`, or a SynthOS-derived reason such as OUTPUT_CAP_REACHED. */
  reason: string | null;
}

/** OpenAI Responses API: `status` is "completed" | "incomplete" | "failed" | …; `incomplete_details.reason` e.g. "max_output_tokens". */
export function openAiTermination(payload: any, maxOutputTokens: number | null): ProviderTermination {
  const status = typeof payload?.status === 'string' ? payload.status : null;
  const reason = typeof payload?.incomplete_details?.reason === 'string' ? payload.incomplete_details.reason : null;
  const out = typeof payload?.usage?.output_tokens === 'number' ? payload.usage.output_tokens : null;
  const capReached = out !== null && maxOutputTokens !== null && out >= maxOutputTokens;
  if (status && status !== 'completed') return { status: 'INCOMPLETE', providerStatus: status, reason: reason ?? (capReached ? 'OUTPUT_CAP_REACHED' : null) };
  // Even a "completed" status is not trusted when the provider's own usage
  // says every permitted output token was consumed.
  if (capReached) return { status: 'INCOMPLETE', providerStatus: status, reason: 'OUTPUT_CAP_REACHED' };
  if (status === 'completed') return { status: 'COMPLETE', providerStatus: status, reason: null };
  return { status: 'NOT_REPORTED', providerStatus: null, reason: null };
}

/** Gemini: candidates[0].finishReason is "STOP" for a normal end; MAX_TOKENS, SAFETY, RECITATION, … otherwise. */
export function geminiTermination(response: any, maxOutputTokens: number | null): ProviderTermination {
  const fr = typeof response?.candidates?.[0]?.finishReason === 'string' ? response.candidates[0].finishReason : null;
  const out = typeof response?.usageMetadata?.candidatesTokenCount === 'number' ? response.usageMetadata.candidatesTokenCount : null;
  const capReached = out !== null && maxOutputTokens !== null && out >= maxOutputTokens;
  if (fr && fr !== 'STOP') return { status: 'INCOMPLETE', providerStatus: fr, reason: fr === 'MAX_TOKENS' ? 'max_output_tokens' : fr };
  if (capReached) return { status: 'INCOMPLETE', providerStatus: fr, reason: 'OUTPUT_CAP_REACHED' };
  if (fr === 'STOP') return { status: 'COMPLETE', providerStatus: fr, reason: null };
  return { status: 'NOT_REPORTED', providerStatus: null, reason: null };
}

// ---------------------------------------------------------------------------
// AEGIS CONTENT SCOPES
// ---------------------------------------------------------------------------

export type ScopeResult = 'PASS' | 'FAIL' | 'NOT_REPORTED' | 'NOT_APPLICABLE';

export interface VerificationScopes {
  integrity: ScopeResult;
  completion: ScopeResult;
  instructionCompliance: ScopeResult;
  /** The scopes this task's contract REQUIRES to pass before it may be DONE. */
  required: Array<'INTEGRITY' | 'COMPLETION' | 'INSTRUCTION_COMPLIANCE'>;
}

export type OverallDecision = 'VERIFIED' | 'INCOMPLETE' | 'FAILED' | 'INCONCLUSIVE';

export interface ContentVerification {
  checks: AegisCheckResult[];
  scopes: VerificationScopes;
  decision: OverallDecision;
  /** Lifecycle state the task must end in. DONE only when decision is VERIFIED. */
  taskStatus: 'DONE' | 'INCOMPLETE' | 'VERIFICATION_FAILED' | 'FAILED' | 'AWAITING_VERIFICATION';
  /** Human-readable scope statement stored with the review and the receipt. */
  scopeStatement: string;
}

function stripOuterWhitespace(s: string): string {
  return s.replace(/^\s+|\s+$/g, '');
}

/**
 * Combine the integrity decision with the content scopes. The contract decides
 * which scopes are REQUIRED:
 *   NARRATIVE    integrity + completion (instruction compliance is not
 *                machine-checkable for free prose — recorded NOT_APPLICABLE,
 *                and the scope statement says so)
 *   LITERAL      integrity + completion + exact-literal compliance
 *   JSON_OBJECT  integrity + completion + parseable-object/required-key compliance
 * Completion NOT_REPORTED is tolerated for NARRATIVE (older providers/doubles
 * do not report it) but NOT for a contract whose correctness depends on it.
 */
export function verifyContent(params: {
  integrityDecision: 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE';
  output: string;
  termination: ProviderTermination;
  contract: OutputContract;
}): ContentVerification {
  const { output, termination, contract } = params;
  const checks: AegisCheckResult[] = [];
  const integrity: ScopeResult = params.integrityDecision === 'VERIFIED' ? 'PASS' : params.integrityDecision === 'FAILED' ? 'FAIL' : 'NOT_REPORTED';

  // COMPLETION
  let completion: ScopeResult;
  if (termination.status === 'COMPLETE') {
    completion = 'PASS';
    checks.push({ check: 'completion:provider_termination', status: 'PASS', evidence: `Provider reported ${termination.providerStatus}.` });
  } else if (termination.status === 'INCOMPLETE') {
    completion = 'FAIL';
    checks.push({ check: 'completion:provider_termination', status: 'FAIL', evidence: `Provider did not finish: ${termination.providerStatus ?? 'no status'}${termination.reason ? ` (${termination.reason})` : ''}.` });
  } else {
    completion = 'NOT_REPORTED';
    checks.push({ check: 'completion:provider_termination', status: contract.mode === 'NARRATIVE' ? 'PASS' : 'FAIL', evidence: 'The provider did not report how the response ended; completion is unverified.' });
  }

  // INSTRUCTION COMPLIANCE
  let instructionCompliance: ScopeResult = 'NOT_APPLICABLE';
  if (contract.mode === 'LITERAL') {
    const got = stripOuterWhitespace(output);
    const want = stripOuterWhitespace(contract.literal!);
    instructionCompliance = got === want ? 'PASS' : 'FAIL';
    checks.push({
      check: 'instruction:literal_exact_match',
      status: instructionCompliance === 'PASS' ? 'PASS' : 'FAIL',
      evidence: instructionCompliance === 'PASS'
        ? `Output is exactly the required ${want.length}-character literal.`
        : `Required exactly ${JSON.stringify(want.slice(0, 120))}; got ${got.length} characters beginning ${JSON.stringify(got.slice(0, 80))}.`,
    });
  } else if (contract.mode === 'JSON_OBJECT') {
    let parsed: unknown = undefined;
    try { parsed = JSON.parse(stripOuterWhitespace(output)); } catch { /* malformed */ }
    const isObject = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    const missing = isObject ? (contract.requiredKeys || []).filter((k) => !(k in (parsed as Record<string, unknown>))) : (contract.requiredKeys || []);
    instructionCompliance = isObject && missing.length === 0 ? 'PASS' : 'FAIL';
    checks.push({
      check: 'instruction:json_object',
      status: instructionCompliance === 'PASS' ? 'PASS' : 'FAIL',
      evidence: !isObject ? 'Output is not a single parseable JSON object.' : missing.length ? `Missing required keys: ${missing.join(', ')}.` : 'Output is a JSON object with every required key.',
    });
  }

  const required: VerificationScopes['required'] = contract.mode === 'NARRATIVE' ? ['INTEGRITY', 'COMPLETION'] : ['INTEGRITY', 'COMPLETION', 'INSTRUCTION_COMPLIANCE'];
  const scopes: VerificationScopes = { integrity, completion, instructionCompliance, required };

  let decision: OverallDecision;
  let taskStatus: ContentVerification['taskStatus'];
  if (integrity === 'FAIL') { decision = 'FAILED'; taskStatus = 'FAILED'; }
  else if (integrity === 'NOT_REPORTED') { decision = 'INCONCLUSIVE'; taskStatus = 'AWAITING_VERIFICATION'; }
  else if (completion === 'FAIL' || (completion === 'NOT_REPORTED' && contract.mode !== 'NARRATIVE')) { decision = 'INCOMPLETE'; taskStatus = 'INCOMPLETE'; }
  else if (instructionCompliance === 'FAIL') { decision = 'FAILED'; taskStatus = 'VERIFICATION_FAILED'; }
  else { decision = 'VERIFIED'; taskStatus = 'DONE'; }

  const scopeStatement = [
    `integrity=${integrity}`,
    `completion=${completion}`,
    `instructionCompliance=${instructionCompliance}`,
    `required=${required.join('+')}`,
    `contract=${contract.mode}`,
  ].join('; ');

  return { checks, scopes, decision, taskStatus, scopeStatement };
}
