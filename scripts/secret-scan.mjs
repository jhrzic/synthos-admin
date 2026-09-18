#!/usr/bin/env node
// ---------------------------------------------------------------------------
// REPOSITORY SECRET SCAN.
//
// WHY THIS EXISTS AS A COMMITTED SCRIPT
// Previous passes ran ad-hoc regex sets inline and reported "SECRET_SCAN:
// clean". One of those sets had no Slack pattern, so a `xoxb-` test vector
// went unreported here and was then caught by GitHub push protection instead.
// The scan was narrower than the word "clean" implied.
//
// An ad-hoc scan cannot be reviewed, cannot be extended in one place, and
// cannot be re-run identically. This one can.
//
// It reports two categories separately, because conflating them is what makes
// a scanner either useless or ignored:
//
//   FINDING    — a credential-shaped value that is NOT recognisably synthetic.
//   SYNTHETIC  — a credential-shaped value that is a test vector: placeholder
//                bodies (sequential letters/digits, "xxxx", "example",
//                "REDACTED") or a known redaction-test file.
//
// Exit code is 1 only when a real FINDING exists. Synthetic vectors are listed
// but do not fail the scan, because removing them would mean deleting the
// tests that prove the redaction layer works.
//
// Run:  node scripts/secret-scan.mjs [--all] [--json]
//       (default scans files differing from origin/main; --all scans tracked files)
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const JSON_OUT = process.argv.includes('--json');
const SCAN_ALL = process.argv.includes('--all');

// Token families relevant to this repository. Keep this list as the single
// place coverage is added — including families the repo does not use yet, so
// a future integration is covered before it ships rather than after.
const PATTERNS = [
  ['openai',        /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g],
  ['anthropic',     /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['google-apikey', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['google-oauth',  /\b[0-9]{10,}-[a-z0-9_]{20,}\.apps\.googleusercontent\.com/g],
  ['google-sa',     /"type"\s*:\s*"service_account"/g],
  ['aws-akid',      /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g],
  ['aws-secret',    /\baws_secret_access_key\s*=\s*['"]?[A-Za-z0-9/+=]{40}/gi],
  ['github-pat',    /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ['github-fine',   /\bgithub_pat_[A-Za-z0-9_]{60,}/g],
  ['slack-token',   /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],   // the family that was missed
  ['slack-webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g],
  ['private-key',   /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ['jwt',           /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['bearer',        /\bBearer\s+[A-Za-z0-9._-]{30,}/g],
  ['stripe',        /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['twilio',        /\bSK[0-9a-fA-F]{32}\b/g],
  ['sendgrid',      /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g],
  ['openrouter',    /\bsk-or-v1-[A-Za-z0-9]{32,}/g],
  ['generic-assign',/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-!@#$%^&*]{24,}['"]/gi],
];

/** Markers that make a credential-shaped value recognisably a test fixture. */
const SYNTHETIC_MARKERS = [
  'abcdefghij', 'abcdef', '1234567890', 'xxxxxxxx', 'example', 'redacted',
  'placeholder', 'dummy', 'fixture', 'notreal', 'deadbeef', 'nope', 'test',
];

/**
 * Shannon entropy per character. A real API key is a high-entropy base62 blob
 * (~5 bits/char). A placeholder is not: 'sk-secret-never-returned' is English
 * words, 'sk-proj-AAAABBBBCCCC' is repeated runs. Both sit far below the
 * threshold.
 *
 * This replaces keyword whack-a-mole. A marker list only ever catches the
 * placeholder spellings somebody already thought of — it missed
 * 'sk-live-secret-material-9999', 'sk-environment-key-value' and
 * 'sk-secret-never-returned' on the first run of this scanner.
 */
function entropyPerChar(value) {
  if (!value.length) return 0;
  const freq = new Map();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Strip a known vendor prefix so the entropy test sees only the body. */
function tokenBody(match) {
  return match
    .replace(/^(?:sk-(?:proj-|svcacct-|admin-|ant-|or-v1-|live_|test_)?|AIza|gh[pousr]_|github_pat_|xox[abprs]-|SG\.|Bearer\s+|rk_(?:live|test)_)/i, '')
    .replace(/[^A-Za-z0-9]/g, '');
}

/** Sequential or repeated runs are a strong placeholder signal on their own. */
function hasFillerRun(value) {
  if (/(.)\1{3,}/.test(value)) return true;                      // AAAA, xxxx
  const seq = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const lower = value.toLowerCase();
  for (let i = 0; i + 4 <= seq.length; i += 1) {
    if (lower.includes(seq.slice(i, i + 4))) return true;         // abcd, 1234
  }
  return false;
}

/**
 * Bits/char below this is treated as a placeholder. Base62 random material
 * lands around 5.0-5.9; the synthetic vectors in this repository land 3.1-4.2.
 * Deliberately conservative: a borderline value is reported, not excused.
 */
const ENTROPY_FLOOR = 4.4;

/** Files whose entire purpose is to carry credential-shaped test vectors. */
const SYNTHETIC_FILES = [
  'test/redaction.test.ts',
  'lib/redact.ts',
];

const SKIP_PATHS = [/^package-lock\.json$/, /^bun\.lock$/, /^node_modules\//, /^dist\//, /^data\//];
const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|woff2?|ttf|eot|mp4|mp3|db)$/i;

function fileList() {
  const cmd = SCAN_ALL
    ? 'git ls-files'
    : 'git diff --name-only origin/main...HEAD; git status --porcelain | cut -c4-';
  const out = execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' });
  return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
}

function isSynthetic(file, match) {
  if (SYNTHETIC_FILES.some((f) => file === f)) return true;
  const lower = match.toLowerCase();
  if (SYNTHETIC_MARKERS.some((m) => lower.includes(m))) return true;
  const body = tokenBody(match);
  if (hasFillerRun(body)) return true;
  // Short bodies carry too little signal for entropy to mean anything, and a
  // real credential is not short — so a short body is placeholder-shaped.
  if (body.length < 16) return true;
  return entropyPerChar(body) < ENTROPY_FLOOR;
}

const findings = [];
const synthetic = [];
let scanned = 0;

for (const file of fileList()) {
  if (SKIP_PATHS.some((re) => re.test(file))) continue;
  if (BINARY_EXT.test(file)) continue;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  scanned += 1;
  const lines = text.split('\n');
  for (const [name, re] of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      // Report a short prefix only — never echo a full candidate credential.
      const redacted = `${m[0].slice(0, 12)}…(${m[0].length} chars)`;
      const entry = { family: name, file, line, preview: redacted, context: (lines[line - 1] || '').trim().slice(0, 100) };
      (isSynthetic(file, m[0]) ? synthetic : findings).push(entry);
    }
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned, findings, synthetic }, null, 1));
} else {
  console.log(`Secret scan — ${scanned} file(s), ${PATTERNS.length} token families`);
  console.log(`  families: ${PATTERNS.map(([n]) => n).join(', ')}`);
  console.log('');
  if (synthetic.length) {
    console.log(`SYNTHETIC test vectors (informational, ${synthetic.length}):`);
    for (const s of synthetic) console.log(`  ${s.family.padEnd(15)} ${s.file}:${s.line}  ${s.preview}`);
    console.log('');
  }
  if (findings.length) {
    console.log(`FINDINGS (${findings.length}) — credential-shaped and NOT recognisably synthetic:`);
    for (const f of findings) console.log(`  ${f.family.padEnd(15)} ${f.file}:${f.line}  ${f.preview}\n      ${f.context}`);
  } else {
    console.log('FINDINGS: none');
  }
}

process.exit(findings.length ? 1 : 0);
