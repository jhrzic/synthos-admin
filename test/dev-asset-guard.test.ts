import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { devAssetDecision } from '../lib/http/dev-asset-guard';

// ---------------------------------------------------------------------------
// The development server served the production database (/data/*.db, also via
// /@fs/) with a CORS wildcard. Only source, dependencies and Vite internals
// may be served; everything else is refused or answered with the app shell.
// ---------------------------------------------------------------------------

describe('development asset guard', () => {
  it('refuses data, keys, vault, backups, docs, dotfiles and traversal', () => {
    for (const u of ['/data/synthos-admin.db', '/data/synthos-admin.db-wal', '/DATA/synthos-admin.db', '/data/keys/ed25519_private.pem', '/backups/x.tar', '/vault/workspaces/a.md',
      '/docs/qualification/x.md', '/.git/config', '/.env', '/.env.local', '/x.sqlite', '/src/../data/synthos-admin.db', '/%2e%2e/data/x.db', '/%64ata/synthos-admin.db',
      '/@fs/Users/me/synthos-admin/data/synthos-admin.db', '/@fs/Users/me/synthos-admin/src/App.tsx', '/@fs/etc/passwd', '/@fs/x/node_modules/../../data/a.db']) {
      expect(devAssetDecision(u), u).toBe('REFUSE');
    }
  });

  it('serves only source, dependencies and Vite internals; anything else gets the app shell', () => {
    for (const u of ['/', '/src/main.tsx', '/src/App.tsx?t=1', '/node_modules/.vite/deps/react.js', '/@vite/client', '/@react-refresh', '/@id/__x00__react', '/@fs/Users/me/app/node_modules/vite/dist/client/env.mjs']) {
      expect(devAssetDecision(u), u).toBe('SERVE');
    }
    for (const u of ['/package.json', '/server.ts', '/setup/abc123', '/random']) expect(devAssetDecision(u), u).toBe('APP_SHELL');
  });

  it('is mounted in front of Vite, and the dev server sends no CORS wildcard', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(server.indexOf('app.use(devAssetGuard as any);')).toBeGreaterThan(-1);
    expect(server.indexOf('app.use(devAssetGuard as any);')).toBeLessThan(server.indexOf('app.use(vite.middlewares);'));
    const vite = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(vite).toMatch(/cors: false/);
    expect(vite).not.toMatch(/cors: true/);
  });
});
