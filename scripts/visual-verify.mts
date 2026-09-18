// ---------------------------------------------------------------------------
// VISUAL VERIFICATION — the real Admin, real Chrome, explicit device viewports.
//
//   npx tsx scripts/visual-verify.mts [--out docs/evidence/<dir>] [--db <copy.db> --vault <dir>]
//
// Default (synthetic): a disposable database and vault seeded with SYNTHETIC
// records only, so every screenshot is safe to commit to a public repository.
// With --db, a COPY of a real database is used and screenshots must go to a
// directory OUTSIDE the repository (they contain real workspace content).
//
// The server under test is the same server.ts, started with no provider
// credentials and SYNTHOS_SCHEDULER_DISABLED=1 (nothing dispatches on a
// timer), on its own port. A verification-only user and session are created
// in the disposable/copied database — never in the canonical one.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const REPO = process.cwd();
const REAL_DB = arg('--db');
const OUT = path.resolve(arg('--out') ?? path.join(REPO, 'docs/evidence/2026-09-18-visual'));
if (REAL_DB && OUT.startsWith(REPO + path.sep)) { console.error('REFUSED: real-data screenshots may not be written inside the repository'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-visual-'));
const DB = path.join(TMP, 'visual.db');
const VAULT = arg('--vault') ?? path.join(TMP, 'vault');
const WS = REAL_DB ? 'ws-synthos-primary' : 'ws-visual';

if (REAL_DB) fs.copyFileSync(REAL_DB, DB);
process.env.SYNTHOS_DB_PATH = DB;
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
process.env.SYNTHOS_VAULT_PATH = VAULT;

// ---- seed (disposable database only) ----------------------------------------
const { getDatabase, closeDatabase, recordActivityEvent, signReceiptPayload } = await import(`${REPO}/lib/persistence.ts`);
const { ensureWorkspace, grantMembership } = await import(`${REPO}/lib/workspaces.ts`);
const { createUser, login } = await import(`${REPO}/lib/auth.ts`);
getDatabase();
ensureWorkspace(WS, REAL_DB ? undefined : 'Visual verification (synthetic)');
const password = crypto.randomBytes(24).toString('hex');
const email = `visual-verifier-${crypto.randomBytes(3).toString('hex')}@example.test`;
const user = createUser({ email, password, displayName: 'Visual verifier', platformRole: 'platform_admin' });
grantMembership(user.user_id, WS, 'admin');
const session = login(email, password)!;
if (!REAL_DB) {
  const db = getDatabase();
  const t = (id: string, title: string, agent: string, model: string, status: string, at: string) =>
    db.prepare('INSERT INTO tasks (task_id, workspace_id, title, description, assigned_agent, assigned_model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, WS, title, 'Synthetic task for visual verification.', agent, model, status, at, at);
  t('syn-done-1', 'Summarise the weekly research notes', 'scribe', 'example-model-a', 'DONE', '2026-09-15T10:00:00.000Z');
  t('syn-done-2', 'Draft the onboarding checklist', 'scribe', 'example-model-a', 'DONE', '2026-09-16T10:00:00.000Z');
  t('syn-failed', 'Fetch the partner price sheet', 'research', 'example-model-b', 'FAILED', '2026-09-16T12:00:00.000Z');
  t('syn-legacy', 'Publish a sitemap (legacy queued)', 'technical', 'n/a', 'TODO', '2026-09-10T09:00:00.000Z');
  t('syn-recon', 'Restart proof (ambiguous dispatch)', 'scribe', 'example-model-a', 'RECONCILING_UNKNOWN_EXECUTION', '2026-09-17T20:48:20.000Z');
  db.prepare("INSERT INTO task_status_history (task_id, status, created_at) VALUES ('syn-recon', 'RUNNING', '2026-09-17T20:48:27.969Z')").run();
  db.prepare("INSERT INTO activity_events (event_id, task_id, event_type, agent_id, payload_json, created_at) VALUES ('act-syn-start', 'syn-recon', 'EXECUTION_STARTED', 'scribe', '{}', '2026-09-17T20:48:27.969Z')").run();
  recordActivityEvent({ taskId: 'syn-done-1', expectedWorkspaceId: WS, eventType: 'TASK_COMPLETED', agentId: 'scribe', payload: { note: 'synthetic' } });
  const payload = JSON.stringify({ task: 'syn-done-1', synthetic: true }); const sig = signReceiptPayload(payload);
  db.prepare("INSERT INTO quality_reviews (review_id, task_id, reviewer, method, score, decision, checks_json, evidence_json, created_at) VALUES ('qr-syn', 'syn-done-1', 'aegis', 'deterministic', 100, 'VERIFIED', '[]', '{}', '2026-09-15T10:00:01.000Z')").run();
  db.prepare("INSERT INTO receipts (receipt_id, task_id, review_id, algorithm, public_key, payload_json, signature, created_at) VALUES ('rcpt-syn', 'syn-done-1', 'qr-syn', 'Ed25519', ?, ?, ?, '2026-09-15T10:00:02.000Z')").run(sig.publicKeyPem, payload, sig.signature);
  // A small synthetic vault with wikilinks, so the graph has something real-shaped to draw.
  const notes = ['Research', 'Onboarding', 'Pricing', 'Partners', 'Roadmap', 'Verification', 'Receipts', 'Routing'];
  const dir = path.join(VAULT, 'SynthOS', 'notes'); fs.mkdirSync(dir, { recursive: true });
  notes.forEach((n, i) => fs.writeFileSync(path.join(dir, `${n}.md`), `---\ntitle: ${n}\ntags: [synthetic]\n---\n# ${n}\nSynthetic note. Links: [[${notes[(i + 1) % notes.length]}]] [[${notes[(i + 3) % notes.length]}]]\n`));
}
closeDatabase();

// ---- server under test ------------------------------------------------------
const port = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const env: Record<string, string> = { ...(process.env as any), PORT: String(port), SYNTHOS_BIND_HOST: '127.0.0.1', DISABLE_HMR: 'true', SYNTHOS_SCHEDULER_DISABLED: '1',
  SYNTHOS_DEPLOYMENT_NAME: REAL_DB ? 'visual verification (copy of canonical database)' : 'visual verification (synthetic data)', SYNTHOS_ENVIRONMENT: 'test' };
for (const k of Object.keys(env)) if (/(_API_KEY|_TOKEN|_SECRET)$/.test(k) || k === 'ANTIGRAVITY_ENABLED') delete env[k];
let log = '';
// The production bundle (dist/), exactly what the canonical service serves.
if (!fs.existsSync(path.join(REPO, 'dist/server.cjs'))) { console.error('REFUSED: run `npm run build` first'); process.exit(2); }
env.NODE_ENV = 'production';
const child = spawn(process.execPath, ['dist/server.cjs'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout!.on('data', (d) => { log += d; }); child.stderr!.on('data', (d) => { log += d; });
await new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error(`server did not start\n${log}`)), 60000); const i = setInterval(() => { if (log.includes('Server running on')) { clearTimeout(t); clearInterval(i); res(); } }, 200); });
if (!log.includes('SCHEDULER: DISABLED')) { child.kill(); throw new Error('scheduler was not disabled'); }

// ---- browser ---------------------------------------------------------------
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: 'tablet', viewport: { width: 834, height: 1112 }, isMobile: true },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true },
];
const results: any[] = [];

const ONLY = arg('--only');
async function shoot(vp: typeof VIEWPORTS[number], name: string, hash: string, act: (page: any) => Promise<Record<string, unknown>>, opts: { reducedMotion?: 'reduce'; authorityDown?: boolean } = {}) {
  if (ONLY && name !== ONLY) return;
  const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.isMobile, deviceScaleFactor: 1, reducedMotion: opts.reducedMotion ?? 'no-preference' });
  await ctx.addCookies([{ name: 'synthos_session', value: session.rawToken, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  const consoleErrors: string[] = []; const failed: string[] = []; const external: string[] = [];
  page.on('console', (m: any) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('response', (r: any) => { if (r.status() >= 400 && !r.url().includes('/api/authority')) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('request', (r: any) => { const u = new URL(r.url()); if (u.origin !== base && !/fonts\.(googleapis|gstatic)\.com$/.test(u.host)) external.push(u.origin); });
  if (opts.authorityDown) await page.route('**/api/authority', (r: any) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, controlPlane: 'UNREACHABLE' }) }));
  await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  let checks: Record<string, unknown> = {};
  try { checks = await act(page); } catch (e: any) { checks = { error: String(e?.message || e).slice(0, 300) }; }
  const file = `${vp.name}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  const overflow = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth })).catch(() => null);
  results.push({ viewport: vp.name, screen: name, file, checks, horizontalOverflow: overflow ? overflow.innerWidth > (vp.viewport.width) || overflow.scrollWidth > overflow.innerWidth : null, consoleErrors, failedRequests: failed, externalOrigins: [...new Set(external)] });
  await ctx.close();
}

const text = async (page: any, sel: string) => (await page.locator(sel).first().textContent({ timeout: 8000 }).catch(() => null));
for (const vp of VIEWPORTS) {
  const railVisible = async (page: any) => { const b = await page.locator('aside').first().boundingBox().catch(() => null); return !!b && b.x >= 0 && b.x + b.width > 0; };
  await shoot(vp, 'tasks', '#/tasks', async (p) => ({ stages: await p.locator('[data-testid="task-stage"]').count(), cards: await p.locator('[data-testid="task-card"]').count(), banner: await p.locator('[data-testid="authority-banner"]').getAttribute('data-authority-status'), railVisible: await railVisible(p) }));
  await shoot(vp, 'task-detail-reconciliation', '#/tasks', async (p) => { await p.getByText('Restart proof (ambiguous dispatch)').first().click(); await p.waitForTimeout(1500); return { guide: await text(p, '[data-testid="guide-window"]'), submitDisabled: await p.locator('[data-testid="reconciliation-submit"]').isDisabled().catch(() => null) }; });
  await shoot(vp, 'agents', '#/agents', async (p) => ({ agents: await p.locator('[data-testid="agent-row"]').count() }));
  await shoot(vp, 'agent-detail', '#/agents/scribe', async (p) => ({ fields: (await text(p, '[data-testid="agent-detail-fields"]'))?.includes('NOT RECORDED') ?? false }));
  await shoot(vp, 'skills', '#/skills', async (p) => ({ empty: await p.locator('[data-testid="skills-empty-state"]').getAttribute('data-empty-kind').catch(() => null) }));
  await shoot(vp, 'model-registry', '#/models', async (p) => { await p.locator('[data-testid="registry-route"]').first().waitFor({ timeout: 15000 }).catch(() => {}); return { routes: await p.locator('[data-testid="registry-route"]').count(), error: await p.locator('[data-testid="model-families-error"]').count() }; });
  await shoot(vp, 'router', '#/router', async (p) => ({ text: ((await p.locator('main').textContent()) || '').slice(0, 80) }));
  await shoot(vp, 'vault', '#/vault', async (p) => { await p.locator('[data-testid="obsidian-graph-mind"]').scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(1500); return { motion: await p.locator('[data-testid="obsidian-graph-mind"]').getAttribute('data-motion').catch(() => null) }; });
  await shoot(vp, 'vault-reduced-motion', '#/vault', async (p) => { await p.locator('[data-testid="obsidian-graph-mind"]').scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(1000); return { motion: await p.locator('[data-testid="obsidian-graph-mind"]').getAttribute('data-motion').catch(() => null) }; }, { reducedMotion: 'reduce' });
  await shoot(vp, 'diagnostics', '#/diagnostics', async (p) => { await p.waitForFunction(() => !/deployment UNKNOWN/.test(document.querySelector('[data-testid="runtime-version-deployment"]')?.textContent || 'deployment UNKNOWN'), null, { timeout: 15000 }).catch(() => {}); return { version: ((await text(p, '[data-testid="runtime-version-deployment"]')) || '').slice(0, 120) }; });
  await shoot(vp, 'queue-review-reconciliation', '#/diagnostics', async (p) => { await p.getByRole('button', { name: /Queue Review/ }).first().click({ timeout: 10000 }); await p.locator('[data-testid="reconciliation-form"]').first().waitFor({ timeout: 15000 }).catch(() => {}); await p.locator('[data-testid="queue-task-reconciliation"]').first().scrollIntoViewIfNeeded().catch(() => {}); return { form: await p.locator('[data-testid="reconciliation-form"]').count(), guide: await text(p, '[data-testid="guide-window"]') }; });
  await shoot(vp, 'command-palette', '#/overview', async (p) => { await p.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await p.waitForTimeout(800); return { models: await p.getByText('Open Model Registry').count() }; });
  if (vp.name !== 'desktop') await shoot(vp, 'mobile-drawer', '#/skills', async (p) => {
    const fab = p.locator('[data-testid="mobile-nav-open"]');
    const box = await fab.boundingBox();
    const under = box ? await p.evaluate(([x, y]: number[]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)}` : null; }, [box.x + box.width / 2, box.y + box.height / 2]) : null;
    const layout = await p.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth, visualScale: (window as any).visualViewport?.scale ?? 1,
      widest: [...document.querySelectorAll('body *')].map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.right > 391 && x.r.width > 0).map((x) => `${x.e.tagName.toLowerCase()}.${String((x.e as any).className?.baseVal ?? x.e.className).slice(0, 70)} right=${Math.round(x.r.right)} w=${Math.round(x.r.width)}`).slice(0, 8) }));
    let tapped = true; let tapError: string | null = null; await fab.click({ timeout: 5000 }).catch((e: any) => { tapped = false; tapError = String(e?.message || e).split('\n').filter((l: string) => /intercepts|not visible|outside|stable|detached/.test(l)).slice(0, 3).join(' | '); });
    if (!tapped && box && vp.isMobile) { await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); }
    await p.waitForTimeout(800);
    const aside = await p.locator('aside').first().boundingBox();
    return { layout, elementUnderButton: under, tapped, tapError, drawerOnScreen: !!aside && aside.x >= 0 && aside.width > 100, items: await p.locator('aside [data-nav-key]').count() };
  });
  await shoot(vp, 'control-plane-unreachable', '#/tasks', async (p) => ({ panel: await p.locator('[data-testid="control-plane-unavailable"]').count(), banner: await text(p, '[data-testid="authority-state"]'), taskCards: await p.locator('[data-testid="task-card"]').count() }), { authorityDown: true });
}

await browser.close();
child.kill('SIGTERM');
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), data: REAL_DB ? 'COPY_OF_CANONICAL (not for publication)' : 'SYNTHETIC', server: 'server.ts (scheduler disabled, no provider credentials)', browser: 'Google Chrome (headless) via playwright-core', results }, null, 2));
console.log(JSON.stringify(results.map((r) => ({ v: r.viewport, s: r.screen, c: r.checks, e: r.consoleErrors.length, f: r.failedRequests, x: r.externalOrigins })), null, 0));
fs.rmSync(TMP, { recursive: true, force: true });
