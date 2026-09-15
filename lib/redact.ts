// ---------------------------------------------------------------------------
// One secret scrubber, for every log line and every error string that might
// carry provider output.
//
// There were two, and they had different coverage:
//
//   lib/fabric/model-openai.ts   sk-…  plus a generic 40+ character token
//   lib/antigravity-client.ts    AIza… plus a generic 32+ character token
//
// So each one knew its own provider's key shape and not the other's, and the
// generic rules disagreed by eight characters. A Google API key is around 39
// characters — under the OpenAI scrubber's 40-character floor — so a Google
// key surfacing in an OpenAI error string would have passed through
// unredacted. The reverse held for anything between 32 and 39 characters in
// the other direction.
//
// Divergent copies of a redaction rule fail exactly where the two providers
// meet, which is the case nobody tests. This is the single implementation.
//
// WHAT IS DELIBERATELY NOT REDACTED: model prompts and completion content.
// Those are the substance of an authorized audit — a receipt attests to an
// artifact whose text has to remain readable, and scrubbing it would break
// the evidence chain this platform exists to provide. Secrets are redacted by
// SHAPE (key prefixes, bearer tokens, PEM blocks, long opaque tokens), never
// by removing content wholesale.
// ---------------------------------------------------------------------------

/** Default ceiling for a scrubbed string destined for a log or an error field. */
export const DEFAULT_SCRUB_MAX_LENGTH = 500;

const REDACTED = '…REDACTED…';

interface Rule {
  pattern: RegExp;
  replacement: string;
  /** Why this shape is a secret — kept so the list stays reviewable. */
  reason: string;
}

/**
 * Prefix-shaped credentials first, so a recognisable key is replaced with a
 * marker that still says WHICH provider leaked. That distinction matters when
 * reading an incident log: "an OpenAI key appeared here" is actionable,
 * "…REDACTED…" alone is not.
 */
const RULES: Rule[] = [
  { pattern: /sk-[A-Za-z0-9_-]{10,}/g, replacement: `sk-${REDACTED}`, reason: 'OpenAI secret key' },
  { pattern: /AIza[A-Za-z0-9_-]{10,}/g, replacement: `AIza${REDACTED}`, reason: 'Google API key' },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: `xox-${REDACTED}`, reason: 'Slack token' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g, replacement: `gh_${REDACTED}`, reason: 'GitHub token' },
  { pattern: /\bbb_[A-Za-z0-9_-]{10,}/g, replacement: `bb_${REDACTED}`, reason: 'Browserbase key' },
  // Authorization headers, if one is ever interpolated into a message.
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `$1 ${REDACTED}`, reason: 'Authorization header value' },
  // A cookie header carrying a session token.
  { pattern: /\b(synthos_session)=[^;\s]+/g, replacement: `$1=${REDACTED}`, reason: 'session cookie' },
  // PEM blocks — the highest-severity shape, and the one no previous scrubber
  // handled at all. Non-greedy so several blocks in one string each collapse.
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: `-----BEGIN PRIVATE KEY----- ${REDACTED} -----END PRIVATE KEY-----`,
    reason: 'private key material',
  },
  // `key=…` / `token=…` / `secret=…` / `password=…` in a query string or a
  // serialized payload.
  {
    pattern: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)(["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `$1$2${REDACTED}`,
    reason: 'named credential field',
  },
  // Backstop: any long opaque run that looks like an unrecognised token.
  // 32 is the lower of the two previous floors — the safer choice, since a
  // false redaction costs a diagnostic while a miss costs a credential.
  { pattern: /\b[A-Za-z0-9_-]{32,}\b/g, replacement: REDACTED, reason: 'unrecognised long opaque token' },
];

/** The rule set, exported so a test can assert coverage rather than trust the list. */
export const REDACTION_RULES: ReadonlyArray<{ reason: string }> = RULES.map(({ reason }) => ({ reason }));

/**
 * Redact credential-shaped substrings from a string bound for a log, an error
 * field or an API response.
 *
 * Truncation happens AFTER redaction, never before: truncating first can cut
 * a key in half and leave a recognisable prefix behind, which is worse than
 * either outcome alone.
 */
export function scrubSecrets(raw: string, maxLength: number = DEFAULT_SCRUB_MAX_LENGTH): string {
  let text = String(raw ?? '');
  for (const { pattern, replacement } of RULES) {
    text = text.replace(pattern, replacement);
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

/**
 * Strip control characters, then redact. Control characters are removed
 * because a provider error carrying ANSI or NUL bytes corrupts a log line and
 * can hide the rest of the message from a reader.
 */
export function sanitizeErrorMessage(message: string | undefined | null, maxLength: number = DEFAULT_SCRUB_MAX_LENGTH): string {
  if (!message) return 'Unknown error.';
  // eslint-disable-next-line no-control-regex
  const withoutControls = String(message).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return scrubSecrets(withoutControls, maxLength);
}
