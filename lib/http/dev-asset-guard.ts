// ---------------------------------------------------------------------------
// DEVELOPMENT ASSET GUARD — what the Vite dev middleware may serve.
//
// In development mode Vite serves files straight from the project root. That
// included the operator's production database (/data/synthos-admin.db, also
// via /@fs/…), and the dev server answered with a CORS wildcard, so any web
// page open in the operator's browser could read it from 127.0.0.1.
//
// Allow-list: only what a Vite React app needs (source, dependencies, Vite's
// internal modules). Any other non-API request is rewritten to "/" so Vite
// answers with the app shell and never with a file. Data, keys, vault,
// backups, docs and dotfiles are refused outright (404).
// ---------------------------------------------------------------------------

const ALLOWED = [
  /^\/$/,
  /^\/index\.html$/,
  /^\/src\//,
  /^\/node_modules\//,
  /^\/@vite\//,
  /^\/@react-refresh$/,
  /^\/@id\//,
  /^\/__vite_ping$/,
  /^\/favicon\.(ico|svg|png)$/,
];

const REFUSED = [
  /^\/(data|backups|vault|docs|test|scripts|dist|\.git|\.github|\.claude)(\/|$)/i,
  /\.(db|db-wal|db-shm|sqlite3?|pem|key|log|env)$/i,
  /\/\.env(\.|$)/i,
];

export type DevAssetDecision = 'SERVE' | 'APP_SHELL' | 'REFUSE';

export function devAssetDecision(rawUrl: string): DevAssetDecision {
  let p: string;
  try { p = decodeURIComponent(new URL(rawUrl, 'http://x').pathname); } catch { return 'REFUSE'; }
  if (p.includes('..') || p.includes('\0')) return 'REFUSE';
  // /@fs/ reaches arbitrary absolute paths: only dependencies inside node_modules.
  if (p.startsWith('/@fs/')) return /\/node_modules\//.test(p) && !REFUSED.some((r) => r.test(p.replace(/^.*\/node_modules\//, '/'))) ? 'SERVE' : 'REFUSE';
  if (REFUSED.some((r) => r.test(p))) return 'REFUSE';
  if (ALLOWED.some((r) => r.test(p))) return 'SERVE';
  return 'APP_SHELL';
}

/** Express middleware placed in front of vite.middlewares (development only). */
export function devAssetGuard(req: { url: string; method: string; path?: string }, res: { status(n: number): { end(): void } }, next: () => void): void {
  if (req.url.startsWith('/api/')) return next();
  const d = devAssetDecision(req.url);
  if (d === 'REFUSE') { res.status(404).end(); return; }
  if (d === 'APP_SHELL') req.url = '/';
  next();
}
