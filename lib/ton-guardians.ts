// ---------------------------------------------------------------------------
// SYNTHOS — TON guardians, adapted from the real, shipped implementation at
// ~/synthos/mission-control/src/lib/ton-guardians.ts.
//
// The identity list (name/label/capability) and block-only permission
// contract are ported unchanged: exactly 5 guardians — attribution, fraud,
// treasury, compliance, settlement. This repo's own TONNetworkView.tsx
// previously claimed "GUARDIANS: 8/8 READY" as a hardcoded banner; 8 has no
// basis in the source and is not preserved here.
//
// Adapted from the source: Mission Control installs guardians as rows in a
// real "agents" table (id, role, soul_content, roster_state, ...). This repo
// has no such table — agents here are role-name strings passed through
// server.ts, not database rows. Rather than invent a generic agents table to
// preserve the exact source shape, guardian installation state stands alone
// in its own workspace-scoped table (see lib/persistence.ts).
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';

export const TON_GUARDIANS = [
  {
    name: 'ton-attribution-guardian',
    label: 'Attribution',
    capability: 'Validates campaign provenance, UTM continuity, and receipt correlation.',
  },
  {
    name: 'ton-fraud-guardian',
    label: 'Fraud',
    capability: 'Blocks suspicious channel, install, wallet, and bot-farm patterns.',
  },
  {
    name: 'ton-treasury-guardian',
    label: 'Treasury',
    capability: 'Blocks settlement when budget, token, recipient, or contract state differs.',
  },
  {
    name: 'ton-compliance-guardian',
    label: 'Compliance',
    capability: 'Enforces approval, jurisdiction, disclosure, and audit requirements.',
  },
  {
    name: 'ton-settlement-guardian',
    label: 'Settlement',
    capability: 'Requires finalized on-chain evidence before a settlement receipt can pass.',
  },
] as const;

export interface TonGuardianView {
  name: string;
  label: string;
  capability: string;
  installed: boolean;
  status: string | null;
}

export function tonGuardianViews(workspaceId: string): TonGuardianView[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT name, status FROM ton_guardians
    WHERE workspace_id = ? AND name IN (${TON_GUARDIANS.map(() => '?').join(', ')})
  `).all(workspaceId, ...TON_GUARDIANS.map((g) => g.name)) as Array<{ name: string; status: string }>;
  const byName = new Map(rows.map((row) => [row.name, row.status]));
  return TON_GUARDIANS.map((guardian) => ({
    ...guardian,
    installed: byName.has(guardian.name),
    status: byName.get(guardian.name) || null,
  }));
}

export function installTonGuardians(workspaceId: string): TonGuardianView[] {
  const db = getDatabase();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ton_guardians (workspace_id, name, status, config_json, installed_at)
    VALUES (?, ?, 'offline', ?, ?)
  `);
  for (const guardian of TON_GUARDIANS) {
    insert.run(
      workspaceId,
      guardian.name,
      JSON.stringify({
        tonGuardian: true,
        authorityTier: 0,
        mode: 'block_only',
        capability: guardian.capability,
        permissions: { publish: false, contact: false, moveFunds: false, sign: false },
      }),
      now,
    );
  }
  return tonGuardianViews(workspaceId);
}
