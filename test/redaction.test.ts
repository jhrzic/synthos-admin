import { describe, it, expect } from 'vitest';
import { scrubSecrets, sanitizeErrorMessage, REDACTION_RULES } from '../lib/redact';
import { scrubSecrets as openAiScrub } from '../lib/fabric/model-openai';
import { scrubSecrets as antigravityScrub } from '../lib/antigravity-client';

// ---------------------------------------------------------------------------
// ONE SCRUBBER, and it has to actually cover the shapes.
//
// There were two implementations with different coverage: the OpenAI one knew
// `sk-` keys plus a 40-character generic floor, the Antigravity one knew
// `AIza` keys plus a 32-character floor. A Google API key is around 39
// characters, so it fell into the eight-character gap and passed through the
// OpenAI scrubber unredacted — the failure landing exactly where the two
// providers meet, which is the case neither file's own tests covered.
// ---------------------------------------------------------------------------

// A Google-key-SHAPED synthetic value, assembled at runtime so no literal
// key-shaped string sits in source (GitHub secret scanning raised alert #1 on
// the earlier literal fixture). Same shape the redactor must catch: "AIza" +
// 35 key characters.
const GOOGLE_KEY_SHAPE = ['AI', 'za'].join('') + 'Sy' + 'synthetic0redaction0fixture0xx'.padEnd(33, 'x');

describe('credential shapes are redacted', () => {
  it('the synthetic Google fixture has exactly the real key shape (so coverage is unchanged)', () => {
    expect(GOOGLE_KEY_SHAPE).toMatch(/^AIza[0-9A-Za-z_-]{35}$/);
    expect(scrubSecrets(`x ${GOOGLE_KEY_SHAPE} y`)).not.toContain(GOOGLE_KEY_SHAPE);
  });

  const cases: Array<[string, string]> = [
    ['OpenAI key', 'error for sk-proj-abcdefghij1234567890ABCDEFGHIJ'],
    ['Google key', `failed with ${GOOGLE_KEY_SHAPE}`],
    ['Slack token', 'posting failed: xoxb-1234567890-abcdefghijklmnop'],
    ['GitHub token', 'auth failed ghp_abcdefghij1234567890ABCDEFGHIJ12345'],
    ['Bearer header', 'upstream rejected Authorization: Bearer abcdef1234567890xyz'],
    ['session cookie', 'request had cookie synthos_session=deadbeefcafebabe0123456789'],
  ];

  for (const [label, input] of cases) {
    it(`${label} is redacted`, () => {
      const out = scrubSecrets(input);
      expect(out).toContain('REDACTED');
      // The secret body must be gone, not merely shortened.
      const secretBody = input.match(/[A-Za-z0-9_-]{16,}/g)?.pop();
      if (secretBody) expect(out).not.toContain(secretBody);
    });
  }

  it('PEM private key material collapses — the shape no previous scrubber handled', () => {
    const pem = [
      'signing failed with key:',
      '-----BEGIN PRIVATE KEY-----',
      'MC4CAQAwBQYDK2VwBCIEIHhdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00',
      'aGVsbG8gdGhpcyBpcyBub3QgYSByZWFsIGtleSBidXQgaXQgaXMgbG9uZw==',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const out = scrubSecrets(pem, 0);
    expect(out).not.toContain('MC4CAQAwBQYDK2VwBCIEIHh');
    expect(out).toContain('REDACTED');
  });

  it('named credential fields are redacted even without a recognisable prefix', () => {
    const out = scrubSecrets('POST body was {"api_key":"zzz11122233344455566677788899900","note":"hi"}', 0);
    expect(out).not.toContain('zzz11122233344455566677788899900');
    expect(out).toContain('REDACTED');
  });
});

describe('the specific cross-provider gap that existed is closed', () => {
  // A 39-character Google key: under the old OpenAI scrubber's 40-character
  // floor, so it survived that path untouched.
  const googleKey = 'AIzaSyA1234567890abcdefghijklmnopqrstu';
  const openAiKey = 'sk-proj-1234567890abcdefghijklmnopqrstuvwx';

  it('a Google key in an OpenAI-path error is now redacted', () => {
    expect(googleKey.length).toBeLessThan(40); // the gap it fell through
    expect(openAiScrub(`OpenAI HTTP 401: upstream said ${googleKey}`)).not.toContain(googleKey);
  });

  it('an OpenAI key in an Antigravity-path error is now redacted', () => {
    expect(antigravityScrub(`Antigravity rejected ${openAiKey}`)).not.toContain(openAiKey);
  });

  it('both provider modules now produce identical output for the same input', () => {
    const input = `two keys: ${googleKey} and ${openAiKey}`;
    expect(openAiScrub(input)).toBe(antigravityScrub(input));
    expect(openAiScrub(input)).toBe(scrubSecrets(input));
  });
});

describe('diagnostics survive redaction — it is not a blanket delete', () => {
  it('an error message keeps its meaning', () => {
    const out = scrubSecrets('OpenAI HTTP 429: rate limit exceeded for organization org-abc');
    expect(out).toContain('HTTP 429');
    expect(out).toContain('rate limit exceeded');
  });

  // Prompts and completions are the substance of an authorized audit. A
  // receipt attests to an artifact whose text has to stay readable.
  it('ordinary prose and model content are untouched', () => {
    const prose = 'The model recommended consolidating the two schedulers into one poll loop.';
    expect(scrubSecrets(prose)).toBe(prose);
  });

  it('short identifiers are not mistaken for secrets', () => {
    const line = 'task-1789 failed at node compute-3 after 412ms';
    expect(scrubSecrets(line)).toBe(line);
  });
});

describe('redaction happens before truncation', () => {
  // Truncating first can cut a key in half and leave a recognisable prefix
  // behind, which is worse than either outcome alone.
  it('a key near the truncation boundary is not left half-exposed', () => {
    const padding = 'x'.repeat(480);
    const out = scrubSecrets(`${padding} sk-proj-abcdefghij1234567890ABCDEFGHIJ`, 500);
    expect(out).not.toMatch(/sk-proj-abcdefghij/);
  });

  // Uses short words, not one long run: a 5000-character opaque run is itself
  // a secret shape and is correctly collapsed to a marker, which would test
  // the redactor rather than the ceiling.
  const longProse = Array.from({ length: 1000 }, (_, i) => `word${i % 7}`).join(' ');

  it('the default ceiling is applied', () => {
    expect(longProse.length).toBeGreaterThan(500);
    expect(scrubSecrets(longProse).length).toBe(500);
  });

  it('a zero ceiling means no truncation, for callers that need the whole string', () => {
    expect(scrubSecrets(longProse, 0).length).toBe(longProse.length);
  });
});

describe('sanitizeErrorMessage strips control characters as well', () => {
  it('removes ANSI and NUL bytes that would corrupt a log line', () => {
    const esc = String.fromCharCode(0x1b);
    const nul = String.fromCharCode(0x00);
    const out = sanitizeErrorMessage(`${esc}[31mfailed${esc}[0m${nul} badly`);
    expect(out).not.toContain(esc);
    expect(out).not.toContain(nul);
    expect(out).toContain('failed');
  });

  it('an empty message is reported honestly rather than as an empty string', () => {
    expect(sanitizeErrorMessage(null)).toBe('Unknown error.');
    expect(sanitizeErrorMessage('')).toBe('Unknown error.');
  });
});

describe('the rule set stays reviewable', () => {
  it('every rule states why its shape is a secret', () => {
    expect(REDACTION_RULES.length).toBeGreaterThan(5);
    for (const rule of REDACTION_RULES) {
      expect(rule.reason.length).toBeGreaterThan(5);
    }
  });
});
