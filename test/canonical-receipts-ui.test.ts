import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// P0-A — the visible Receipts surface must be the CANONICAL, Ed25519-signed
// receipts written by the execution fabric.
//
// Before this change the `receipts` nav slot rendered ReceiptsView, which shows
// the legacy Kanban board's LOCAL/DEMO receipts: a client-side rolling hash
// (src/services/synthosControlService.ts, no key material, not independently
// verifiable). The 15 real signed receipts in the database had no UI at all, so
// the product showed non-cryptographic receipts in the exact place a user looks
// for proof.
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');

const serverContent = read('server.ts');
const appContent = read('src/App.tsx');
const canonicalView = read('src/components/CanonicalReceiptsView.tsx');
const legacyView = read('src/components/ReceiptsView.tsx');
const persistenceContent = read('lib/persistence.ts');

function listRouteSlice(): string {
  const idx = serverContent.indexOf('app.get("/api/execution/receipts"');
  expect(idx).toBeGreaterThan(-1);
  const next = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, next === -1 ? undefined : next);
}

describe('1: canonical receipt data is what the screen renders', () => {
  it('a workspace-scoped listing route exists over the real receipts table', () => {
    expect(persistenceContent).toContain('export function listWorkspaceReceiptsFull');
    const fn = persistenceContent.slice(persistenceContent.indexOf('export function listWorkspaceReceiptsFull'));
    // Same `receipts` table, scoped through its owning task — not a new store.
    expect(fn.slice(0, 500)).toContain('FROM receipts r');
    expect(fn.slice(0, 500)).toContain('JOIN tasks t ON t.task_id = r.task_id');
    expect(fn.slice(0, 500)).toContain('WHERE t.workspace_id = ?');
  });

  it('the route is workspace-guarded and re-verifies each signature server-side', () => {
    const slice = listRouteSlice();
    expect(slice).toContain('requireWorkspaceMember(fromBodyOrQuery)');
    // verified must be a check that ran, never a stored flag.
    expect(slice).toContain('verifyReceipt(r)');
    expect(slice).not.toMatch(/verified:\s*true/);
  });

  it('the view renders the canonical payload fields', () => {
    for (const field of ['aegisDecision', 'aegisMethod', 'artifactHash', 'artifactId', 'assignedAgent', 'modelUsed', 'provider', 'workspaceId']) {
      expect(canonicalView).toContain(field);
    }
    expect(canonicalView).toContain('receipt_id');
    expect(canonicalView).toContain('task_id');
    expect(canonicalView).toContain('signature');
    expect(canonicalView).toContain('public_key');
    expect(canonicalView).toContain('created_at');
  });

  it('it has truthful empty and error states, and never invents a count', () => {
    expect(canonicalView).toContain('No execution receipts in this workspace yet.');
    expect(canonicalView).toContain('Could not load receipts');
    expect(canonicalView).toContain("'UNKNOWN'");
  });
});

describe('2: the legacy demo pipeline is no longer presented as canonical', () => {
  it('the receipts nav slot renders the canonical view, not the Kanban demo one', () => {
    const idx = appContent.indexOf("activeTab === 'receipts'");
    expect(idx).toBeGreaterThan(-1);
    const slice = appContent.slice(idx, idx + 240);
    expect(slice).toContain('<CanonicalReceiptsView');
    expect(slice).not.toContain('<ReceiptsView');
  });

  it('the legacy view is kept only behind a non-navigable developer tab', () => {
    // Preserved (product-preservation rule) but stripped of its product-nav role.
    expect(appContent).toContain("activeTab === 'dev-kanban-receipts'");
    const navFiles = ['src/components/SidebarNav.tsx', 'src/components/WorkspaceTopNav.tsx', 'src/components/CommandPalette.tsx'];
    for (const f of navFiles) {
      expect(read(f)).not.toContain('dev-kanban-receipts');
    }
  });

  it('the legacy view still labels itself LOCAL / DEMO wherever it is shown', () => {
    expect(legacyView).toContain('LOCAL / DEMO');
    expect(legacyView).toContain('non-cryptographic');
  });

  it('the canonical view does not borrow the legacy rolling-hash pipeline', () => {
    // It may NAME synthosControlService in its header comment (explaining what
    // it replaced); it must never import from or call it.
    expect(canonicalView).not.toMatch(/import[^;]*synthosControl/);
    expect(canonicalView).not.toContain('synthosControl.');
    expect(canonicalView).not.toContain('getReceipts()');
  });
});

describe('3: no secrets, prompts or provider payloads are exposed', () => {
  it('the route returns only the signed canonical payload', () => {
    // Strip comments first: the comment legitimately says the payload carries
    // "no prompts, secrets or provider payloads", which is the opposite of a leak.
    const code = listRouteSlice()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const leak of ['prompt', 'apiKey', 'api_key', 'GEMINI_API_KEY', 'secret', 'password']) {
      expect(code.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    // What it DOES return is the stored payload and signature material only.
    expect(code).toContain('payload');
    expect(code).toContain('signature');
  });
});
