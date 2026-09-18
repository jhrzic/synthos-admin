import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// THE CANONICAL SECRET SCANNER (scripts/secret-scan.mjs) is the single CI
// authority. These tests prove it still FAILS on genuine-looking credential
// material and still PASSES the repository's synthetic security fixtures.
//
// Genuine-looking material is generated at runtime into a temp directory and
// never written into the repository.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-secret-scan-'));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const random62 = (n: number) => Array.from(crypto.randomBytes(n), (b) => BASE62[b % 62]).join('');

function scan(files: string[]) {
  const r = spawnSync(process.execPath, ['scripts/secret-scan.mjs', '--json', '--paths', ...files], { cwd: process.cwd(), encoding: 'utf8' });
  return { code: r.status, out: JSON.parse(r.stdout) as { findings: Array<{ family: string }>; synthetic: Array<{ family: string }> } };
}

describe('canonical secret scanner', () => {
  it('fails on a high-entropy provider key', () => {
    const f = path.join(TMP, 'leak.ts');
    fs.writeFileSync(f, `const k = 'sk-proj-${random62(48)}';\n`);
    const r = scan([f]);
    expect(r.code).toBe(1);
    expect(r.out.findings.map((x) => x.family)).toContain('openai');
  });

  it('fails on a real PEM private key (judged by its body, not its short header)', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const f = path.join(TMP, 'server.pem');
    fs.writeFileSync(f, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const r = scan([f]);
    expect(r.code).toBe(1);
    expect(r.out.findings.map((x) => x.family)).toContain('private-key');
  });

  it('passes the repository\'s synthetic security fixtures, listing them as SYNTHETIC', () => {
    const fixtures = ['test/tool-pack-security.test.ts', 'test/approval-lifecycle.test.ts', 'test/business-assistant-production.test.ts', 'test/control-plane-settings.test.ts', 'test/platform-credentials-api.test.ts', 'test/redaction.test.ts'];
    const r = scan(fixtures);
    expect(r.code).toBe(0);
    expect(r.out.findings).toEqual([]);
    expect(r.out.synthetic.length).toBeGreaterThan(5);
  });

  it('CI runs this scanner over every tracked file, and no second ad-hoc scanner', () => {
    const wf = fs.readFileSync(path.join(process.cwd(), '.github/workflows/security.yml'), 'utf8');
    expect(wf).toContain('node scripts/secret-scan.mjs --all');
    expect(wf).not.toMatch(/xargs -0 grep -nEI/);
  });
});
