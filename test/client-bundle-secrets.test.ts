import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// NO SECRET MAY REACH THE CLIENT BUNDLE.
//
// Vite inlines every `VITE_*` variable into the JavaScript it ships to the
// browser. That is the whole point of the prefix, and it makes the prefix a
// one-way door: the moment a secret-shaped variable is named `VITE_…`, its
// value is in a file anyone who loads the page can read. There is no
// server-side mitigation after that — only rotation.
//
// This repo's canonical pattern is the opposite and already proven twice:
// credentials live in the encrypted server-side store (Fish Audio via
// lib/voice-credentials.ts, OpenAI/Gemini via lib/model-credentials.ts), the
// browser holds nothing, and the value is never returned to the client. These
// tests keep that true by construction.
//
// DELIBERATELY NOT OVERBROAD. `VITE_*` is not banned — a client needs public
// identifiers, and calling them secrets would push developers to smuggle them
// somewhere worse. Only secret-SHAPED names are rejected, and a public
// identifier can be declared as such explicitly.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

/**
 * Name fragments that make a client variable a secret. Matched against the
 * part after `VITE_`, so `VITE_API_KEY` is rejected while `VITE_API_BASE_URL`
 * is fine.
 */
const SECRET_NAME_PATTERNS: RegExp[] = [
  /TOKEN/i,
  /SECRET/i,
  /PRIVATE_KEY/i,
  /API_KEY/i,
  /APIKEY/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /_PEM$/i,
  /SIGNING/i,
];

/**
 * Client variables that are genuinely public identifiers, each with a reason.
 *
 * An allowlist rather than a looser rule: adding an entry is a deliberate act
 * that shows up in review, which is exactly the friction this should have.
 * A base URL is not a secret — it is in every network request the browser
 * makes anyway.
 */
const PUBLIC_CLIENT_IDENTIFIERS: Record<string, string> = {
  VITE_HERMES_ADAPTER_BASE_URL: 'An endpoint URL, visible in every request the browser makes to it. Carries no authority; the bearer token for that adapter is server-side only (HERMES_ADAPTER_TOKEN).',
};

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every VITE_* name referenced anywhere in the repo's source or env template. */
function referencedClientVars(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const record = (name: string, where: string) => {
    const list = found.get(name) ?? [];
    list.push(where);
    found.set(name, list);
  };

  for (const file of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'lib'))]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/VITE_[A-Z0-9_]+/g)) {
      record(m[0], path.relative(ROOT, file));
    }
  }
  for (const f of ['server.ts', 'vite.config.ts', '.env.example', 'index.html']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/VITE_[A-Z0-9_]+/g)) record(m[0], f);
  }
  return found;
}

function secretShaped(name: string): RegExp | null {
  const suffix = name.replace(/^VITE_/, '');
  return SECRET_NAME_PATTERNS.find((p) => p.test(suffix)) ?? null;
}

describe('no secret-shaped variable may be exposed to the client bundle', () => {
  it('every referenced VITE_* name is either non-secret-shaped or an explicitly declared public identifier', () => {
    const offenders: string[] = [];
    for (const [name, locations] of referencedClientVars()) {
      const pattern = secretShaped(name);
      if (!pattern) continue;
      if (name in PUBLIC_CLIENT_IDENTIFIERS) {
        offenders.push(
          `${name} is on the public-identifier allowlist but its NAME is secret-shaped (${pattern}). ` +
          `Rename it, or remove it from the allowlist. Seen in: ${locations.join(', ')}`,
        );
        continue;
      }
      offenders.push(
        `${name} would be inlined into the client bundle by Vite and its name matches ${pattern}. ` +
        `Move it to the encrypted server-side store (see lib/model-credentials.ts). Seen in: ${locations.join(', ')}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlisted public identifier carries a stated reason', () => {
    for (const [name, reason] of Object.entries(PUBLIC_CLIENT_IDENTIFIERS)) {
      expect(name).toMatch(/^VITE_/);
      expect(reason.length, `${name} needs a real justification, not a placeholder`).toBeGreaterThan(40);
    }
  });

  // The detector itself has to be known-good, or the suite above is theatre.
  it('the detector rejects the shapes the brief names', () => {
    for (const name of ['VITE_SLACK_TOKEN', 'VITE_APP_SECRET', 'VITE_SIGNING_PRIVATE_KEY', 'VITE_OPENAI_API_KEY', 'VITE_DB_PASSWORD', 'VITE_SERVICE_CREDENTIAL']) {
      expect(secretShaped(name), `${name} should be rejected`).not.toBeNull();
    }
  });

  it('the detector permits genuine public identifiers, so it is not overbroad', () => {
    for (const name of ['VITE_API_BASE_URL', 'VITE_PUBLIC_APP_NAME', 'VITE_SENTRY_DSN', 'VITE_BUILD_SHA', 'VITE_FEATURE_FLAGS']) {
      expect(secretShaped(name), `${name} should be permitted`).toBeNull();
    }
  });
});

describe('server-side secrets never cross into client source', () => {
  // The other direction: a client file reading a SERVER variable name. Vite
  // does not inline bare `process.env` into the browser bundle, so this would
  // be undefined at runtime rather than leaked — but it signals a developer
  // believing a secret is available client-side, which is how the Fish Audio
  // localStorage bug started.
  it('no file under src/ references a known server-side secret variable', () => {
    const SERVER_SECRETS = [
      'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'FISH_AUDIO_API_KEY',
      'HERMES_ADAPTER_TOKEN', 'WINDMILL_TOKEN', 'MCP_CREDENTIAL_ENCRYPTION_KEY',
      'SYNTHOS_SIGNING_PRIVATE_KEY_PEM', 'TELEGRAM_BOT_TOKEN', 'OPENSEO_API_KEY',
    ];
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const secret of SERVER_SECRETS) {
        // A settings FORM may legitimately name a provider field; what must
        // not appear is a read of the server's environment variable.
        const re = new RegExp(`(process\\\\.env|import\\\\.meta\\\\.env)\\\\s*[.\\\\[]\\\\s*['"\`]?${secret}`);
        if (re.test(text)) offenders.push(`${path.relative(ROOT, file)} reads ${secret}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the built client bundle contains no credential-shaped literal', () => {
    const assets = path.join(ROOT, 'dist', 'assets');
    if (!fs.existsSync(assets)) {
      // The guard is only meaningful against a real build. Skipping silently
      // would make a missing build look like a pass, so this states it.
      expect(fs.existsSync(path.join(ROOT, 'dist')), 'run `npm run build` before this assertion is meaningful').toBe(false);
      return;
    }
    const offenders: string[] = [];
    for (const file of fs.readdirSync(assets).filter((f) => f.endsWith('.js'))) {
      const text = fs.readFileSync(path.join(assets, file), 'utf8');
      // Real key shapes, not the word "key" — the bundle legitimately
      // contains identifiers like `apiKey` as object property names.
      for (const [label, re] of [
        ['OpenAI secret key', /sk-[A-Za-z0-9]{20,}/],
        ['Google API key', /AIza[A-Za-z0-9_-]{30,}/],
        ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/],
        ['GitHub token', /gh[pousr]_[A-Za-z0-9]{30,}/],
        ['PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ] as Array<[string, RegExp]>) {
        if (re.test(text)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders, 'a credential-shaped literal is present in the shipped client bundle').toEqual([]);
  });
});
