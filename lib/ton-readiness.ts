// ---------------------------------------------------------------------------
// SYNTHOS — TON readiness, ported unchanged from the real, shipped
// implementation at ~/synthos/mission-control/src/lib/ton-readiness.ts.
//
// Pure, no I/O. Config presence alone never produces 'approved' — that
// requires applyTonProbe() to be called with a real live-probe result.
// This is the fail-closed contract: NOT_CONFIGURED -> submitted (once a
// value is present) -> approved (only after a live probe succeeds).
// ---------------------------------------------------------------------------

export type TonNetwork = 'mainnet' | 'testnet';
export type TonApprovalStatus = 'not_configured' | 'submitted' | 'approved';

export interface TonReadinessItem {
  id: 'manifest' | 'rpc' | 'tonapi' | 'escrow' | 'telegram' | 'foundation' | 'audit';
  label: string;
  status: TonApprovalStatus;
  detail: string;
}

export interface TonReadiness {
  network: TonNetwork;
  manifest: {
    configured: boolean;
    url: string;
    reachable: boolean | null;
  };
  rpc: {
    endpoint: string;
    apiKeyConfigured: boolean;
    reachable: boolean | null;
  };
  tonapi: {
    apiKeyConfigured: boolean;
  };
  escrow: {
    configured: boolean;
    address: string | null;
    active: boolean | null;
  };
  checklist: TonReadinessItem[];
  readyCount: number;
  totalCount: number;
  controllerReady: boolean;
  lastCheckedAt: string | null;
}

const EXPECTED_MANIFEST_URL = 'https://getsynthos.com/tonconnect-manifest.json';

function httpsUrl(value: string | undefined): string | null {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function approvalStatus(value: string | undefined): TonApprovalStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'approved') return 'approved';
  if (normalized === 'submitted') return 'submitted';
  return 'not_configured';
}

export function buildTonReadiness(env: Readonly<Record<string, string | undefined>> = process.env): TonReadiness {
  const network: TonNetwork = String(env.TON_NETWORK || '').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
  const configuredManifest = httpsUrl(env.TON_CONNECT_MANIFEST_URL);
  const endpoint = httpsUrl(env.TON_CENTER_API_URL)
    || (network === 'mainnet' ? 'https://toncenter.com/api/v3/' : 'https://testnet.toncenter.com/api/v3/');
  const escrowAddress = String(env.TON_ESCROW_ADDRESS || '').trim() || null;
  const telegram = approvalStatus(env.TON_TELEGRAM_APPS_CENTER_STATUS);
  const foundation = approvalStatus(env.TON_FOUNDATION_STATUS);
  const audit = approvalStatus(env.TON_SECURITY_AUDIT_STATUS);
  const apiKeyConfigured = Boolean(String(env.TONCENTER_API_KEY || '').trim());
  const tonapiKeyConfigured = Boolean(String(env.TONAPI_API_KEY || '').trim());
  const tonapi = tonapiKeyConfigured ? approvalStatus(env.TONAPI_STATUS) : 'not_configured';

  const checklist: TonReadinessItem[] = [
    {
      id: 'manifest',
      label: 'TON Connect manifest',
      status: configuredManifest ? 'submitted' : 'not_configured',
      detail: configuredManifest ? 'HTTPS URL configured; live verification pending' : `Host the manifest at ${EXPECTED_MANIFEST_URL}`,
    },
    {
      id: 'rpc',
      label: 'TON Center indexer',
      status: apiKeyConfigured ? 'submitted' : 'not_configured',
      detail: apiKeyConfigured ? `${network} credential configured; live verification pending` : 'Add a server-side TONCENTER_API_KEY',
    },
    {
      id: 'tonapi',
      label: 'TonAPI indexer',
      status: tonapi,
      detail: !tonapiKeyConfigured ? 'Add a server-side TONAPI_API_KEY' : tonapi === 'approved' ? 'Provisioning evidence recorded' : 'Credential configured; set TONAPI_STATUS after validation',
    },
    {
      id: 'escrow',
      label: 'USDT escrow contract',
      status: escrowAddress ? 'submitted' : 'not_configured',
      detail: escrowAddress ? 'Address configured; active account verification pending' : 'Deploy and configure the audited contract address',
    },
    {
      id: 'telegram',
      label: 'Telegram Apps Center',
      status: telegram,
      detail: telegram === 'approved' ? 'Approval recorded by configuration' : telegram === 'submitted' ? 'Submission recorded; approval pending' : 'No submission evidence configured',
    },
    {
      id: 'foundation',
      label: 'TON Foundation review',
      status: foundation,
      detail: foundation === 'approved' ? 'Approval recorded by configuration' : foundation === 'submitted' ? 'Review recorded as in progress' : 'No review evidence configured',
    },
    {
      id: 'audit',
      label: 'Contract security audit',
      status: audit,
      detail: audit === 'approved' ? 'Audit completion recorded by configuration' : audit === 'submitted' ? 'Audit recorded as in progress' : 'No completed audit configured',
    },
  ];
  const readyCount = checklist.filter((item) => item.status === 'approved').length;

  return {
    network,
    manifest: { configured: Boolean(configuredManifest), url: configuredManifest || EXPECTED_MANIFEST_URL, reachable: null },
    rpc: { endpoint, apiKeyConfigured, reachable: null },
    tonapi: { apiKeyConfigured: tonapiKeyConfigured },
    escrow: { configured: Boolean(escrowAddress), address: escrowAddress, active: null },
    checklist,
    readyCount,
    totalCount: checklist.length,
    controllerReady: readyCount === checklist.length,
    lastCheckedAt: null,
  };
}

export function applyTonProbe(
  readiness: TonReadiness,
  probe: { manifest?: boolean; rpc?: boolean; escrowActive?: boolean },
  checkedAt = new Date().toISOString(),
): TonReadiness {
  const checklist = readiness.checklist.map((item) => {
    if (item.id === 'manifest' && probe.manifest !== undefined) {
      return {
        ...item,
        status: probe.manifest ? 'approved' as const : readiness.manifest.configured ? 'submitted' as const : 'not_configured' as const,
        detail: probe.manifest ? 'Manifest and required public assets verified live' : 'Configured manifest could not be verified live',
      };
    }
    if (item.id === 'rpc' && probe.rpc !== undefined) {
      return {
        ...item,
        status: probe.rpc ? 'approved' as const : readiness.rpc.apiKeyConfigured ? 'submitted' as const : 'not_configured' as const,
        detail: probe.rpc ? `${readiness.network} indexer responded successfully` : 'Configured TON Center endpoint did not pass its live check',
      };
    }
    if (item.id === 'escrow' && probe.escrowActive !== undefined) {
      return {
        ...item,
        status: probe.escrowActive ? 'approved' as const : readiness.escrow.configured ? 'submitted' as const : 'not_configured' as const,
        detail: probe.escrowActive ? 'Escrow account is active on the configured network' : 'Escrow address is not an active account on the configured network',
      };
    }
    return item;
  });
  const readyCount = checklist.filter((item) => item.status === 'approved').length;

  return {
    ...readiness,
    manifest: { ...readiness.manifest, reachable: probe.manifest ?? readiness.manifest.reachable },
    rpc: { ...readiness.rpc, reachable: probe.rpc ?? readiness.rpc.reachable },
    escrow: { ...readiness.escrow, active: probe.escrowActive ?? readiness.escrow.active },
    checklist,
    readyCount,
    controllerReady: readyCount === checklist.length,
    lastCheckedAt: checkedAt,
  };
}
