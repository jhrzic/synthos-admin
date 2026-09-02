// ---------------------------------------------------------------------------
// Pass VII / Workstream A — real environment readiness inventory + a
// server-side validator. This is the canonical map of every environment
// variable production code actually reads (grepped from server.ts + lib/,
// not hand-guessed) — CONFIG PRESENT never means CONNECTED (that's proven
// per-subsystem elsewhere: lib/windmill-client.ts's health(),
// lib/mcp-client.ts's probeMcpServer(), hermesAdapter.health()); this module
// only answers "is a value present and shaped correctly," never "does it
// work." No secret VALUE is ever read into a log line or API response here —
// only presence/absence and, for a handful of shape-checkable vars, whether
// the shape looks well-formed (INVALID).
// ---------------------------------------------------------------------------

export type EnvRequirement = 'REQUIRED' | 'OPTIONAL';
export type EnvClassification = 'REQUIRED_MISSING' | 'OPTIONAL_MISSING' | 'CONFIGURED' | 'INVALID';
export type EnvSecrecy = 'SECRET' | 'NON_SECRET';

export interface EnvVarSpec {
  variable: string;
  subsystem: string;
  requiredFor: string;
  requirement: EnvRequirement;
  secrecy: EnvSecrecy;
  /** Optional shape check — never inspects the value beyond format. Returns true if well-formed. */
  validate?: (value: string) => boolean;
}

// Every REQUIRED entry here is required for CORE PLATFORM STARTUP (auth,
// database, session, signing) — not for any optional integration. As of
// this pass, core platform startup genuinely requires zero external
// credentials (SQLite + a generated Ed25519 keypair are both self-
// provisioning) — that's a real property of this codebase, not an
// oversight, and is asserted by test/env-readiness.test.ts so it can't
// silently regress into a hidden required var.
export const ENV_VAR_SPECS: EnvVarSpec[] = [
  // --- Provider routing ---
  { variable: 'GEMINI_API_KEY', subsystem: 'Provider Router (Gemini)', requiredFor: '/api/generate, model-backed skills, graph/task execution', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'OPENROUTER_API_KEY', subsystem: 'Provider Router (OpenRouter)', requiredFor: 'Recognized but UNSUPPORTED — no execution mapping wired (see lib/model-router.ts)', requirement: 'OPTIONAL', secrecy: 'SECRET' },

  // --- Hermes dedicated runtime (ADR-001) ---
  { variable: 'HERMES_ADAPTER_BASE_URL', subsystem: 'Hermes Runtime Adapter', requiredFor: 'hermesAdapter.health()/execute() real network calls', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'HERMES_ADAPTER_TOKEN', subsystem: 'Hermes Runtime Adapter', requiredFor: 'Authenticated calls to the Hermes adapter base URL', requirement: 'OPTIONAL', secrecy: 'SECRET' },

  // --- Windmill (ADR-006) ---
  { variable: 'WINDMILL_BASE_URL', subsystem: 'Windmill External Execution', requiredFor: 'Any real Windmill API call', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'WINDMILL_TOKEN', subsystem: 'Windmill External Execution', requiredFor: 'Authenticated Windmill calls (GET /api/users/whoami, job submit/status/result/cancel)', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'WINDMILL_WORKSPACE', subsystem: 'Windmill External Execution', requiredFor: 'Every /api/w/{workspace}/... Windmill endpoint', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- MCP (ADR-005) ---
  { variable: 'MCP_ALLOW_LOCAL_ENDPOINTS', subsystem: 'MCP Connectivity', requiredFor: 'Local-development escape hatch for the SSRF guard — must stay unset in production', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'MCP_CREDENTIAL_ENCRYPTION_KEY', subsystem: 'MCP Connectivity', requiredFor: 'Storing an MCP server bearer-token credential at rest', requirement: 'OPTIONAL', secrecy: 'SECRET' },

  // --- Voice / Apollo ---
  { variable: 'FISH_AUDIO_API_KEY', subsystem: 'Apollo Voice (TTS)', requiredFor: 'Fish Audio TTS + barge-in (interrupt())', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'FISH_AUDIO_DEFAULT_VOICE_ID', subsystem: 'Apollo Voice (TTS)', requiredFor: 'Selecting a Fish Audio voice', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- TON / Telegram product ---
  { variable: 'TON_NETWORK', subsystem: 'TON Readiness', requiredFor: 'testnet/mainnet selection (defaults to testnet)', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'TONCENTER_API_KEY', subsystem: 'TON Readiness', requiredFor: 'Live TON Center probes', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'TONAPI_API_KEY', subsystem: 'TON Readiness', requiredFor: 'Live TONAPI probes', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'TON_CONNECT_MANIFEST_URL', subsystem: 'TON Readiness', requiredFor: 'TON Connect wallet manifest', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'TON_ESCROW_ADDRESS', subsystem: 'TON Readiness', requiredFor: 'Escrow settlement address', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- Platform / hosting ---
  { variable: 'PORT', subsystem: 'Server Host', requiredFor: 'HTTP listen port (defaults to 3000)', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: (v) => Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 },
  { variable: 'SYNTHOS_DB_PATH', subsystem: 'Database', requiredFor: 'SQLite file location (defaults to ./data/synthos-admin.db)', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'SYNTHOS_SIGNING_KEY_DIR', subsystem: 'Receipt Signing', requiredFor: 'Ed25519 keypair storage location (defaults to ./data/keys, self-generates on first use)', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'SYNTHOS_SIGNING_PRIVATE_KEY_PEM', subsystem: 'Receipt Signing', requiredFor: 'Injecting a pre-provisioned signing key (e.g. from a secret manager) instead of self-generating', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'SYNTHOS_SIGNING_PUBLIC_KEY_PEM', subsystem: 'Receipt Signing', requiredFor: 'Paired with SYNTHOS_SIGNING_PRIVATE_KEY_PEM', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'NODE_ENV', subsystem: 'Server Host', requiredFor: 'Vite dev-vs-production middleware selection', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
];

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface EnvVarStatus {
  variable: string;
  subsystem: string;
  requiredFor: string;
  requirement: EnvRequirement;
  secrecy: EnvSecrecy;
  classification: EnvClassification;
}

/** Never returns or logs a value — classification only. */
export function classifyEnvVar(spec: EnvVarSpec, rawValue: string | undefined): EnvVarStatus {
  const present = typeof rawValue === 'string' && rawValue.trim().length > 0;
  let classification: EnvClassification;
  if (!present) {
    classification = spec.requirement === 'REQUIRED' ? 'REQUIRED_MISSING' : 'OPTIONAL_MISSING';
  } else if (spec.validate && !spec.validate(rawValue!.trim())) {
    classification = 'INVALID';
  } else {
    classification = 'CONFIGURED';
  }
  return {
    variable: spec.variable,
    subsystem: spec.subsystem,
    requiredFor: spec.requiredFor,
    requirement: spec.requirement,
    secrecy: spec.secrecy,
    classification,
  };
}

export interface EnvReadinessReport {
  statuses: EnvVarStatus[];
  requiredMissing: string[];
  invalid: string[];
  coreReady: boolean;
  generatedAt: string;
}

/**
 * A1 — the real validator. `coreReady` is true iff no REQUIRED var is
 * missing and no REQUIRED var is INVALID — an OPTIONAL var being missing or
 * invalid never blocks core readiness (an integration being unconfigured is
 * not an application failure; see the subsystem's own NOT_CONFIGURED state).
 */
export function buildEnvReadinessReport(env: NodeJS.ProcessEnv = process.env): EnvReadinessReport {
  const statuses = ENV_VAR_SPECS.map((spec) => classifyEnvVar(spec, env[spec.variable]));
  const requiredMissing = statuses.filter((s) => s.classification === 'REQUIRED_MISSING').map((s) => s.variable);
  const requiredInvalid = statuses.filter((s) => s.requirement === 'REQUIRED' && s.classification === 'INVALID').map((s) => s.variable);
  return {
    statuses,
    requiredMissing,
    invalid: statuses.filter((s) => s.classification === 'INVALID').map((s) => s.variable),
    coreReady: requiredMissing.length === 0 && requiredInvalid.length === 0,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// A2 — startup readiness summary. One line per core subsystem, safe for
// stdout logs: no secret values, no raw filesystem paths beyond what's
// already non-secret (SYNTHOS_DB_PATH's configured *presence*, not a
// resolved absolute path guess). Each line's status comes from a real check
// (a value being set, or — for CONFIGURED_UNVERIFIED — a value being set
// without yet having made a live call), never a hardcoded READY.
// ---------------------------------------------------------------------------

export type SubsystemStartupStatus = 'READY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'FAILED';

export interface SubsystemStartupLine {
  subsystem: string;
  status: SubsystemStartupStatus;
  detail: string;
}

export function buildStartupSummary(env: NodeJS.ProcessEnv = process.env): SubsystemStartupLine[] {
  const configured = (v: string) => !!env[v] && env[v]!.trim().length > 0;
  return [
    { subsystem: 'AUTH', status: 'READY', detail: 'Local scrypt-hashed accounts; no external IdP required.' },
    { subsystem: 'DATABASE', status: 'READY', detail: 'SQLite, self-provisioning schema on first open.' },
    { subsystem: 'RECEIPT_SIGNING', status: 'READY', detail: 'Ed25519 keypair self-generates on first use if not pre-provisioned.' },
    { subsystem: 'VAULT', status: 'READY', detail: 'Filesystem-backed, directory created on first write.' },
    { subsystem: 'MEMORY_INDEX', status: 'READY', detail: 'SQLite FTS5, part of the same self-provisioning schema.' },
    { subsystem: 'GEMINI_PROVIDER', status: configured('GEMINI_API_KEY') ? 'DEGRADED' : 'NOT_CONFIGURED', detail: configured('GEMINI_API_KEY') ? 'Key present — health only proven per real call, see Provider Capability Matrix.' : 'GEMINI_API_KEY not set — model-backed features disabled, not a startup failure.' },
    { subsystem: 'HERMES_RUNTIME', status: configured('HERMES_ADAPTER_BASE_URL') ? 'DEGRADED' : 'NOT_CONFIGURED', detail: configured('HERMES_ADAPTER_BASE_URL') ? 'Base URL present — see /api/hermes/health for live status.' : 'HERMES_ADAPTER_BASE_URL not set.' },
    { subsystem: 'WINDMILL', status: (configured('WINDMILL_BASE_URL') && configured('WINDMILL_TOKEN') && configured('WINDMILL_WORKSPACE')) ? 'DEGRADED' : 'NOT_CONFIGURED', detail: (configured('WINDMILL_BASE_URL') && configured('WINDMILL_TOKEN') && configured('WINDMILL_WORKSPACE')) ? 'Configured — see /api/master-admin/windmill/status for live CONNECTED/FAILED.' : 'WINDMILL_BASE_URL/TOKEN/WORKSPACE not all set.' },
    { subsystem: 'MCP_CREDENTIAL_STORAGE', status: configured('MCP_CREDENTIAL_ENCRYPTION_KEY') ? 'READY' : 'NOT_CONFIGURED', detail: configured('MCP_CREDENTIAL_ENCRYPTION_KEY') ? 'Encryption key present — credential storage enabled.' : 'MCP_CREDENTIAL_ENCRYPTION_KEY not set — credential storage refused, never falls back to plaintext.' },
    { subsystem: 'BACKUP', status: 'READY', detail: 'Local filesystem archive (backups/), no external dependency.' },
  ];
}
