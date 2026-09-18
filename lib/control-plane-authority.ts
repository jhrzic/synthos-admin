// ---------------------------------------------------------------------------
// CONTROL-PLANE AUTHORITY — one canonical authority per stateful category.
//
// Topology (decided 2026-09-18, docs/qualification/2026-09-18-canonical-authority.md):
//   * The operator's control plane (launchd com.synthos.admin on the
//     operator's Mac) is CANONICAL for every category below. It holds the
//     task database, registry, qualifications, spend policy, ledger, Aegis
//     reviews, receipts and the one signing key, the Vault/Brain, the memory
//     index, users/sessions, the scheduler, and it is where local Ollama runs.
//   * admin.getsynthos.com is a GATEWAY: Caddy on GCE synthos-core-01 proxies
//     to the canonical control plane over an authenticated SSH reverse tunnel
//     opened outbound by the Mac. It stores no operational state and runs no
//     application process; when the tunnel is down it answers CONTROL PLANE
//     UNREACHABLE (never an empty system).
//   * The Admin instance that ran on GCE with its own empty database is
//     ARCHIVED (container stopped, volume kept, its signing key revoked).
//
// There is no synchronization between copies: no copy other than the
// canonical one accepts writes.
// ---------------------------------------------------------------------------

export type AuthorityCategory =
  | 'workspaces_and_auth' | 'tasks' | 'scheduler' | 'registry' | 'qualifications' | 'spend_policy_and_ledger'
  | 'guardian' | 'execution_claims' | 'provider_adapters_and_credentials' | 'local_model_runtime' | 'aegis_reviews'
  | 'receipts_and_signing_key' | 'vault_and_brain' | 'artifacts' | 'memory_index' | 'backups';

export const AUTHORITY_CATEGORIES: readonly AuthorityCategory[] = [
  'workspaces_and_auth', 'tasks', 'scheduler', 'registry', 'qualifications', 'spend_policy_and_ledger', 'guardian',
  'execution_claims', 'provider_adapters_and_credentials', 'local_model_runtime', 'aegis_reviews',
  'receipts_and_signing_key', 'vault_and_brain', 'artifacts', 'memory_index', 'backups',
];

export interface ControlPlaneAuthority {
  role: 'CANONICAL';
  name: string;
  gateway: { host: string; kind: 'CADDY_SSH_REVERSE_TUNNEL'; storesState: false };
  archived: Array<{ name: string; reason: string }>;
  categories: Record<AuthorityCategory, 'CANONICAL'>;
}

export const CONTROL_PLANE_AUTHORITY: ControlPlaneAuthority = Object.freeze({
  role: 'CANONICAL',
  name: 'operator control plane (launchd com.synthos.admin)',
  gateway: { host: 'admin.getsynthos.com', kind: 'CADDY_SSH_REVERSE_TUNNEL', storesState: false },
  archived: [{ name: 'GCE synthos-core-01 Admin instance (volume synthos-admin_synthos-data)', reason: 'independent empty database, scheduler and signing key; stopped 2026-09-18, signing key revoked' }],
  categories: Object.fromEntries(AUTHORITY_CATEGORIES.map((c) => [c, 'CANONICAL'])) as Record<AuthorityCategory, 'CANONICAL'>,
}) as ControlPlaneAuthority;

/** One observed copy of a stateful authority. */
export interface AuthorityObservation {
  instance: string;
  category: AuthorityCategory;
  acceptsWrites: boolean;
}

/**
 * Split-authority detection: any category with more than one copy accepting
 * writes is a split. Read-only/archived copies are not splits.
 */
export function detectSplitAuthority(observations: AuthorityObservation[]): Array<{ category: AuthorityCategory; writers: string[] }> {
  const byCat = new Map<AuthorityCategory, Set<string>>();
  for (const o of observations) {
    if (!o.acceptsWrites) continue;
    if (!byCat.has(o.category)) byCat.set(o.category, new Set());
    byCat.get(o.category)!.add(o.instance);
  }
  return [...byCat.entries()].filter(([, w]) => w.size > 1).map(([category, w]) => ({ category, writers: [...w].sort() }));
}
