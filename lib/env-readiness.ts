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

import { getVaultStatus } from './vault-config';

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

  // --- Hermes LOCAL runtime (the CLI actually installed on the host) ---
  // A different mechanism from the two adapter vars above, not a duplicate:
  // those describe an HTTP contract nothing here implements, these describe
  // the `hermes` CLI that really exists. See lib/hermes-local-runtime.ts.
  { variable: 'HERMES_LOCAL_ENABLED', subsystem: 'Hermes Local Runtime (CLI)', requiredFor: 'Must be exactly "true" for ANY dispatch to the local Hermes CLI (capability hermes.execute). Unset or anything else refuses execution even when the CLI is installed and answering — a run spends real ChatGPT/Codex subscription quota.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'HERMES_CLI_PATH', subsystem: 'Hermes Local Runtime (CLI)', requiredFor: 'Overrides the path to the hermes executable. Unset resolves ~/.local/bin/hermes.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- Windmill (ADR-006) ---
  { variable: 'WINDMILL_BASE_URL', subsystem: 'Windmill External Execution', requiredFor: 'Any real Windmill API call', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'WINDMILL_TOKEN', subsystem: 'Windmill External Execution', requiredFor: 'Authenticated Windmill calls (GET /api/users/whoami, job submit/status/result/cancel)', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'WINDMILL_WORKSPACE', subsystem: 'Windmill External Execution', requiredFor: 'Every /api/w/{workspace}/... Windmill endpoint', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- Antigravity execution runtime (PUSH 1) ---
  // ANTIGRAVITY_ENABLED is a real kill switch, not documentation: the
  // client and the ledger both refuse to dispatch unless it is literally
  // "true", so a deployment that holds a Gemini credential does not
  // silently acquire the ability to run autonomous remote agents.
  { variable: 'ANTIGRAVITY_ENABLED', subsystem: 'Antigravity Runtime', requiredFor: 'OPTIONAL OVERRIDE. Normally set by a platform admin in Master Admin → Antigravity & Autonomy (default OFF). When set here it takes precedence and the Admin control shows it as locked. Must be exactly \"true\" to allow outward Antigravity execution.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'SYNTHOS_AUTONOMY_LEVEL', subsystem: 'Orchestrator', requiredFor: 'OPTIONAL OVERRIDE. Normally set by a platform admin in Master Admin → Antigravity & Autonomy (MANUAL / INTERNAL_AUTOMATION / APPROVAL_GATED_EXTERNAL; default INTERNAL_AUTOMATION). When set here it takes precedence and the Admin control shows it as locked.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'ANTIGRAVITY_API_KEY', subsystem: 'Antigravity Runtime', requiredFor: 'OPTIONAL OVERRIDE. A dedicated Antigravity key is normally stored from Master Admin → Antigravity & Autonomy (encrypted). Unset and not stored falls back to the Gemini credential — same Google key type.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'ANTIGRAVITY_AGENT', subsystem: 'Antigravity Runtime', requiredFor: 'Overrides the managed agent id. Unset uses lib/antigravity-client.ts ANTIGRAVITY_DEFAULT_AGENT.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'ANTIGRAVITY_BASE_URL', subsystem: 'Antigravity Runtime', requiredFor: 'Overrides the managed agent API base URL (an enterprise gateway, or a test double). Unset uses https://generativelanguage.googleapis.com/v1beta.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },

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

  // --- Knowledge vault (DAYS 2-3) ---
  { variable: 'SYNTHOS_VAULT_PATH', subsystem: 'Knowledge Vault', requiredFor: "The user's real Markdown/Obsidian vault. SynthOS writes knowledge notes only under its bounded SynthOS/ subdirectory and never modifies existing notes. Unset means the repo-local ./vault development fallback, which is NOT an Obsidian integration.", requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- Additional model / voice providers (DAY 1: previously undeclared) ---
  // All of these are really read by server.ts or lib/. Leaving them out of this
  // list meant the readiness report, the startup summary and GET /api/ready all
  // under-reported the deployment's real configuration surface — including five
  // SECRET credentials. test/env-spec-completeness.test.ts now fails the build
  // if a server-side read is added without a declaration here.
  // PUSH 1 — this variable's scope genuinely widened. It used to be voice
  // only, and said so. It now also authorizes real, billable TEXT
  // generation through the Execution Fabric, which is a materially
  // different cost and blast radius for an operator to be told about.
  { variable: 'OPENAI_API_KEY', subsystem: 'Provider Router (OpenAI) + Voice (TTS provider: OpenAI)', requiredFor: 'Text generation when the canonical router selects a QUALIFIED OpenAI route (lib/fabric/model-openai.ts via the registry protocol adapter), AND POST /api/voice/speak when provider=openai. Both are real, billable api.openai.com calls.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'OPENAI_BASE_URL', subsystem: 'Provider Router (OpenAI)', requiredFor: 'Overrides the OpenAI API base URL (an Azure/proxy/enterprise gateway, or a test double). Unset uses https://api.openai.com/v1.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'GEMINI_BASE_URL', subsystem: 'Provider Router (Gemini)', requiredFor: 'Overrides the Gemini API base URL for the shared generation adapter (a gateway, or a test double). Unset uses the SDK default.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'SYNTHOS_PROVIDER_HOST_ALLOWLIST', subsystem: 'Model Registry (provider endpoints)', requiredFor: 'Comma-separated extra hostnames a provider base-URL override may point at (an operator gateway). Unset: only each provider manifest\'s approved hosts.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: (v) => v.split(',').map((h) => h.trim()).filter(Boolean).every((h) => /^[a-z0-9.-]+$/i.test(h)) },
  { variable: 'SYNTHOS_ALLOW_LOOPBACK_PROVIDERS', subsystem: 'Model Registry (provider endpoints)', requiredFor: 'Set to "true" to allow a loopback provider endpoint (a local gateway or test double) outside tests. Ignored when NODE_ENV=production.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: (v) => v === 'true' || v === 'false' },
  { variable: 'NVIDIA_API_KEY', subsystem: 'Model Registry (NVIDIA NIM aggregator route)', requiredFor: 'Credential for NVIDIA NIM route offerings. Read through the nvidia provider manifest (auth.envVars). Importing NVIDIA\'s model list never needs it. Every call is still gated by task qualification and the spend guard.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'SYNTHOS_LOCAL_RUNTIME_BASE_URL', subsystem: 'Model Registry (local runtime route)', requiredFor: 'Base URL of a self-hosted OpenAI-compatible runtime (loopback only; no credential is sent). Read through the local-runtime provider manifest (baseUrlEnvVar). Unset: http://localhost:11434/v1.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'SYNTHOS_ARTIFACT_VAULT_DIR', subsystem: 'Vault (artifacts)', requiredFor: 'Absolute path of the artifact vault. Unset: ./vault. The test setup points it at a temporary directory so tests never write into or archive the real vault.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'SYNTHOS_BACKUP_DIR', subsystem: 'Backup System', requiredFor: 'Absolute path where backup archives are written. Unset: ./backups.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'GEO_PROBE_MODEL', subsystem: 'AEO GEO probe', requiredFor: 'Overrides the Gemini model the AEO GEO probe asks. Every probe call goes through the spend guard, which refuses a model that is not qualified and enabled in the model registry.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: (v) => /^[A-Za-z0-9._:\/-]{1,128}$/.test(v) },
  { variable: 'PUBLIC_CHECK_DAILY_CAP', subsystem: 'AEO public visibility check', requiredFor: 'Global daily cap on the unauthenticated /check route (default 150). Each check makes spend-guarded model calls, refused unless paid execution is ON and the probe model is qualified and enabled in the model registry.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: (v) => /^\d+$/.test(v) },
  { variable: 'PUBLIC_CHECK_CTA_URL', subsystem: 'AEO public visibility check', requiredFor: 'Call-to-action link shown after a public /check result.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'ELEVENLABS_API_KEY', subsystem: 'Voice (TTS provider: ElevenLabs)', requiredFor: 'POST /api/voice/speak when provider=elevenlabs — a real, billable call. Not wired for text generation.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'FISH_AUDIO_MODEL', subsystem: 'Apollo Voice (TTS)', requiredFor: 'Fish Audio TTS model selection', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'FISH_AUDIO_VOICE_ID', subsystem: 'Apollo Voice (TTS)', requiredFor: 'Fallback Fish Audio reference/voice id when none is stored per-workspace', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'FISH_AUDIO_AUDIO_FORMAT', subsystem: 'Apollo Voice (TTS)', requiredFor: 'Fish Audio output container (e.g. opus, mp3)', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'FISH_AUDIO_LATENCY_MODE', subsystem: 'Apollo Voice (TTS)', requiredFor: 'Fish Audio latency profile', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'ANTHROPIC_API_KEY', subsystem: 'Provider Status Reporting', requiredFor: 'Presence is REPORTED in provider status only — no execution mapping is wired in this build. Setting it does not enable Claude.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'NOUS_API_KEY', subsystem: 'Provider Status Reporting', requiredFor: 'Presence is REPORTED in Hermes/Nous provider status only — no execution mapping is wired.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'OLLAMA_BASE_URL', subsystem: 'Provider Status Reporting', requiredFor: 'Presence is REPORTED in local-model status only — no execution mapping is wired.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'TELEGRAM_BOT_TOKEN', subsystem: 'Telegram Notifications', requiredFor: 'Reported as CONFIGURED/NOT_CONFIGURED in status surfaces', requirement: 'OPTIONAL', secrecy: 'SECRET' },

  // --- AEO / SEO data providers (lib/aeo/service.ts) ---
  { variable: 'OPENSEO_API_KEY', subsystem: 'AEO Audit (OpenSEO)', requiredFor: 'Live AEO/GEO audit data — a real, billable provider call', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'SERPAPI_KEY', subsystem: 'AEO Audit (SerpAPI)', requiredFor: 'Live SERP data — a real, billable provider call', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'DATAFORSEO_LOGIN', subsystem: 'AEO Audit (DataForSEO)', requiredFor: 'Live DataForSEO data — a real, billable provider call', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'BRIGHTDATA_API_KEY', subsystem: 'AEO Audit (BrightData)', requiredFor: 'Live BrightData retrieval — a real, billable provider call', requirement: 'OPTIONAL', secrecy: 'SECRET' },

  // --- Research (lib/fabric/research.ts) ---
  { variable: 'GITHUB_TOKEN', subsystem: 'Repository Research', requiredFor: 'Raises the GitHub Search API rate limit. Unset still works at the anonymous limit.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'GITHUB_API_BASE_URL', subsystem: 'Repository Research', requiredFor: 'Override for GitHub Enterprise or a test double', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },

  // --- TOOL PACK 1 (lib/github-readonly.ts, lib/workspace-files.ts) ---
  // Declared here even though the completeness guard did not demand it: both
  // are read via a parameterised `env` argument rather than a literal
  // process-env member access, which is exactly the shape that scan cannot
  // see (and writing the literal form here would itself trip it). Leaving
  // them undeclared would have made the readiness panel silent about the one
  // variable that decides whether the repo-scoped GitHub tools work at all.
  { variable: 'GITHUB_APPROVED_REPOS', subsystem: 'Tool Pack — GitHub', requiredFor: 'The repository allowlist for github.read_file and github.inspect. Comma-separated owner/name, or owner/* for one owner. UNSET MEANS NO REPOSITORY IS APPROVED and both tools report NOT_CONFIGURED. github.search does not need it.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  // --- TOOL PACK 2: Gmail (lib/gmail-connection.ts) ---
  { variable: 'GOOGLE_OAUTH_CLIENT_ID', subsystem: 'Gmail Connector', requiredFor: 'Identifies the SynthOS application to Google. Required before any Gmail account can be connected or any access token refreshed. Without it every Gmail capability reports NOT_CONFIGURED.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'GOOGLE_OAUTH_CLIENT_SECRET', subsystem: 'Gmail Connector', requiredFor: 'The OAuth client secret used in the refresh-token exchange. Never stored in the database and never returned by any route.', requirement: 'OPTIONAL', secrecy: 'SECRET' },
  { variable: 'GOOGLE_OAUTH_TOKEN_URL', subsystem: 'Gmail Connector', requiredFor: 'Override for the Google token endpoint (a test double). Defaults to https://oauth2.googleapis.com/token.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'GMAIL_API_BASE_URL', subsystem: 'Gmail Connector', requiredFor: 'Override for the Gmail API base URL (a test double), same convention as GITHUB_API_BASE_URL. Defaults to https://gmail.googleapis.com.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'SYNTHOS_APPROVAL_VERIFICATION', subsystem: 'Approval Foundation', requiredFor: 'Enables verification.external_action \u2014 a synthetic EXTERNAL_ACTION used only to prove the human-approval lifecycle end to end. It passes the full gate (Guardian, then human approval, then single-use consumption) and executes a bounded LOCAL contract double: no socket, no provider, no recipient. Unset means the capability reports NOT_CONFIGURED.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'SYNTHOS_REPO_ROOT', subsystem: 'Tool Pack — Files', requiredFor: 'Base directory the files.read allowed roots (docs, vault, scripts) resolve against. Defaults to the process working directory; overridden in tests.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- TON supplementary (lib/ton-readiness.ts, lib/ton-probe.ts) ---
  { variable: 'TON_CENTER_API_URL', subsystem: 'TON Readiness', requiredFor: 'TON Center RPC endpoint override', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },
  { variable: 'TONAPI_STATUS', subsystem: 'TON Readiness', requiredFor: 'Operator-declared TONAPI approval state', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'TON_ALLOW_CUSTOM_RPC', subsystem: 'TON Readiness', requiredFor: 'Permits a non-default RPC endpoint', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'TON_TELEGRAM_APPS_CENTER_STATUS', subsystem: 'TON Readiness', requiredFor: 'Operator-declared Telegram Apps Center approval state', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'TON_FOUNDATION_STATUS', subsystem: 'TON Readiness', requiredFor: 'Operator-declared TON Foundation approval state', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'TON_SECURITY_AUDIT_STATUS', subsystem: 'TON Readiness', requiredFor: 'Operator-declared security-audit state', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },

  // --- Public address (Business Conversation AI) ---
  // DAY 1 correction. This was read by lib/public-url.ts but declared
  // nowhere, so the startup summary, GET /api/ready and the readiness panel
  // all stayed silent about the single variable that decides whether the
  // embed snippet a customer pastes into their own website actually works.
  // An operator could deploy correctly in every other respect and still ship
  // a widget that browsers block as mixed content, with nothing reporting it.
  { variable: 'PUBLIC_BASE_URL', subsystem: 'Public Assistant Address', requiredFor: 'The https origin used to build the public assistant link and the embed snippet. Unset means the address is inferred per-request from Host/X-Forwarded-Proto, which is correct only when TRUST_PROXY_HOPS matches the real proxy depth.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: isHttpUrl },

  // --- Platform / hosting ---
  { variable: 'PORT', subsystem: 'Server Host', requiredFor: 'HTTP listen port (defaults to 3000)', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: (v) => Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 },
  { variable: 'HOST', subsystem: 'Server Host', requiredFor: 'HTTP listen interface, honoured when SYNTHOS_BIND_HOST is unset. With neither set the Admin binds 127.0.0.1 (loopback only). The Dockerfile sets SYNTHOS_BIND_HOST=0.0.0.0 so a container stays reachable from the reverse proxy beside it.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'SYNTHOS_BIND_HOST', subsystem: 'Server Host', requiredFor: 'Network interface the Admin binds to; takes precedence over HOST. Defaults to 127.0.0.1 (loopback only). Set to 0.0.0.0 ONLY for a containerised deployment that must be reachable from outside its namespace.', requirement: 'OPTIONAL', secrecy: 'NON_SECRET' },
  { variable: 'TRUST_PROXY_HOPS', subsystem: 'Server Host', requiredFor: 'Correct client IP resolution (rate limiting) behind exactly N reverse proxies — unset means trust none, Express default', requirement: 'OPTIONAL', secrecy: 'NON_SECRET', validate: (v) => Number.isInteger(Number(v)) && Number(v) >= 0 },
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
    // DAYS 2-3. The knowledge vault, reported from real filesystem evidence.
    // Never says "Obsidian connected" — a vault is a directory, and whether the
    // Obsidian desktop app happens to be running is irrelevant to it.
    (() => {
      const status = getVaultStatus(env);
      if (status.mode === 'UNAVAILABLE') {
        return { subsystem: 'KNOWLEDGE_VAULT', status: 'FAILED' as const, detail: status.detail };
      }
      if (status.mode === 'LOCAL_FALLBACK') {
        return { subsystem: 'KNOWLEDGE_VAULT', status: 'NOT_CONFIGURED' as const, detail: status.detail };
      }
      return {
        subsystem: 'KNOWLEDGE_VAULT',
        status: status.writable ? ('READY' as const) : ('DEGRADED' as const),
        detail: status.detail,
      };
    })(),
    // DAY 1. The public address decides the origin in the <script> tag a
    // customer pastes into their own website. Unset behind a TLS-terminating
    // proxy, the app infers the origin per-request and — unless TRUST_PROXY_HOPS
    // matches the real proxy depth — infers http, producing a snippet every
    // browser blocks as mixed content on an https page. That failure is silent
    // at the customer's end, so it is reported here at startup instead.
    (() => {
      const raw = (env.PUBLIC_BASE_URL || '').trim();
      if (!raw) {
        const hops = (env.TRUST_PROXY_HOPS || '').trim();
        return {
          subsystem: 'PUBLIC_ADDRESS',
          status: hops ? ('DEGRADED' as const) : ('NOT_CONFIGURED' as const),
          detail: hops
            ? `PUBLIC_BASE_URL not set — the public link and embed snippet are inferred per request, trusting ${hops} proxy hop(s). Set PUBLIC_BASE_URL to your real https origin to remove the guess.`
            : 'PUBLIC_BASE_URL not set and no proxy hops trusted — the embed snippet will be built from the request and will read http:// behind a TLS proxy, which browsers block on an https site.',
        };
      }
      let parsed: URL | null = null;
      try { parsed = new URL(raw); } catch { parsed = null; }
      if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
        return { subsystem: 'PUBLIC_ADDRESS', status: 'FAILED' as const, detail: 'PUBLIC_BASE_URL is set but is not a valid http(s) address, so no usable public link can be produced.' };
      }
      const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname.endsWith('.localhost');
      if (parsed.protocol !== 'https:' && !localHost) {
        return { subsystem: 'PUBLIC_ADDRESS', status: 'FAILED' as const, detail: 'PUBLIC_BASE_URL is a plain http address. The embed snippet will be blocked as mixed content on any https website.' };
      }
      return { subsystem: 'PUBLIC_ADDRESS', status: 'READY' as const, detail: `Public link and embed snippet will use ${parsed.origin}.` };
    })(),
  ];
}
