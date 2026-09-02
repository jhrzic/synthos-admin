# SynthOS Admin — Production Readiness Checklist

Pre-launch checklist, written after Pass VII's real environment/runtime audit. Checked items are
verified by a real test, a real local run, or direct source inspection performed in this pass — not
assumed. Unchecked items are named honestly, with what's blocking them.

Legend: `[x]` verified this pass · `[ ]` not yet done · `BLOCKED` needs something outside this
repo/session (a real credential, a live external service, infrastructure access) before it can be
verified.

## Security

- [x] Session cookie is `httpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`
      (`server.ts` `setSessionCookie`) — verified by source inspection.
  - **Operator responsibility, not code**: `Secure` is gated on `NODE_ENV=production` being
    actually set. Forgetting to set it in production silently ships a non-Secure cookie. There is
    no code-level failsafe for this — add explicit `NODE_ENV=production` to your deployment's
    documented required variables (it already is, in `docker-compose.yml` and the Dockerfile).
- [x] CSRF defense-in-depth: a site-wide `Origin` check on every `POST`/`PUT`/`PATCH`/`DELETE`,
      ahead of all routes (`requireSameOrigin`, wired in `server.ts` before route registration).
- [x] No CORS middleware is installed — the API is same-origin only by default (verified: no `cors`
      package, no `Access-Control-Allow-Origin` header set anywhere). Correct default for this
      architecture; do not add a permissive CORS policy without a specific reason.
- [x] No stack trace is ever returned in an API response (verified: no `.stack` reference anywhere
      in `server.ts`'s response bodies).
- [x] No password, session token, setup token, API key, or raw MCP/Windmill credential appears in
      any `console.log`/`console.error`/`console.warn` call (verified by source grep across
      `server.ts` and `lib/*.ts` in this pass).
- [x] `WINDMILL_TOKEN` and `MCP_CREDENTIAL_ENCRYPTION_KEY`-encrypted credentials are excluded from
      the backup archive — proven by a real test (`test/backup.test.ts`'s token-exclusion test
      extracts the actual archive bytes and asserts the token string is absent, not just "should
      be").
- [ ] **`/api/terminal/exec` is a real shell-execution surface**, gated to `requirePlatformAdmin`
      and a "Guardian" policy filter (`checkGuardianRules`), but it is a genuine, large blast-radius
      feature — a compromised platform-admin session means real command execution on the host.
      This is presumably an intentional operator/dev tool, not an oversight, but it needs an
      explicit decision before a production launch: keep it (and treat platform-admin credential
      security accordingly), or feature-flag it off outside trusted/local deployments. **Not fixed
      in this pass — flagged for owner decision.**
- [ ] Rate limiting: none exists anywhere in this codebase (verified — no rate-limit middleware in
      `server.ts`, no dependency on any rate-limiting package). Login, setup-token validation, and
      every paid-provider-calling route are all unlimited today. Add rate limiting (at minimum on
      `/api/auth/login` and `/api/auth/setup-token/:token/complete`) before any internet-facing
      launch.
- BLOCKED: TLS/HTTPS termination — this application does not terminate TLS itself (no HTTPS server,
  no certificate handling). A production deployment needs a reverse proxy/load balancer in front of
  it; the `Secure` cookie flag assumes one exists. Out of this repo's scope to verify further.

## Credentials

- [x] Zero credentials required for core platform startup, verified live in this pass (server
      started with a completely empty environment — no `.env` file, no exported shell vars — and
      reached `ready:true` on `/api/ready`).
- [ ] `GEMINI_API_KEY` — MISSING in this environment. Required for any model-backed feature
      (`/api/generate`, model-backed skills, graph/task execution, Jarvis's NLU fallback).
- [ ] `OPENROUTER_API_KEY` — MISSING. Even if set, no execution mapping exists (`UNSUPPORTED` in
      `lib/model-router.ts`) — setting it currently configures nothing.
- [ ] `HERMES_ADAPTER_BASE_URL` / `HERMES_ADAPTER_TOKEN` — MISSING. See the Hermes section below —
      this needs a genuine architectural decision, not just a value.
- [ ] `WINDMILL_BASE_URL` / `WINDMILL_TOKEN` / `WINDMILL_WORKSPACE` — MISSING. See the Windmill
      section below.
- [ ] `MCP_CREDENTIAL_ENCRYPTION_KEY` — MISSING. Needed before any MCP skill can store a bearer
      credential.
- [ ] `FISH_AUDIO_API_KEY` — MISSING. Needed for Apollo TTS/barge-in.
- [ ] `TONCENTER_API_KEY` / `TONAPI_API_KEY` — MISSING. Needed for live TON readiness probes.

## Database

- [x] SQLite, self-provisioning schema (`CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE`
      migrations), no separate database server to provision.
- [x] Configurable path via `SYNTHOS_DB_PATH` — not hardcoded to a developer home directory
      (verified: defaults to `./data/synthos-admin.db`, relative to `process.cwd()`).
- [x] Restart persistence proven live in this pass: created a user via a real running production
      build, killed the process, restarted it, logged in with the same credentials — identical
      `user_id`, and the pre-restart session cookie was still valid (proves both the `users` and
      `user_sessions` tables survive a real process restart, not just "should").

## Vault

- [x] Filesystem-backed, directory auto-created on first write, configurable relative to
      `process.cwd()` (not user-home-hardcoded).
- [ ] Not included: any content-level retention/cleanup policy — the Vault only grows. Fine for
      beta scale; revisit before it matters.

## Backup

- [x] Real archive creation, manifest, SHA-256 checksums (`lib/backup.ts`).
- [x] Real, independent checksum re-verification (`validateBackupArchive`) — not just "the manifest
      says it's fine."
- [x] Restore is staged, never a live in-place swap (this process holds an open SQLite handle for
      its whole lifetime) — proven by test and by design.
- [x] Restore drill: covered by the existing automated test suite (`test/backup.test.ts`) —
      create → validate → stage → verify staged files exist → confirm the *live* DB is untouched
      until a manual restart applies the staged copy. Not re-run as a separate manual drill against
      a throwaway instance in this pass (the automated coverage already exercises the identical
      code path with real files); do that manual drill once before the first real production
      restore if you want additional confidence.
- [ ] No automated backup schedule exists, and none should be added inside this application (see
      `CLAUDE.md`'s no-competing-scheduler rule) — this is an operator responsibility (cron/systemd
      timer/orchestrator job), documented in `docs/OPERATOR-RUNBOOK.md` §13.

## Providers

- [ ] Gemini — `NOT_CONFIGURED` in this environment. BLOCKED on a real API key.
- [ ] OpenRouter — recognized, `UNSUPPORTED` regardless of configuration (no execution mapping).
- [x] Router identity proven by source + test (`test/model-router.test.ts`): a requested model
      always maps to a real, named provider/model or an explicit `UNSUPPORTED` — never a silent
      cross-provider fallback.

## Hermes

- [ ] **BLOCKED — genuine open question, not just a missing credential.** `HERMES_ADAPTER_BASE_URL`
      is unset, so `HERMES_RUNTIME` is honestly `NOT_CONFIGURED`. This pass searched the local
      machine for a real Hermes installation per the task's own instruction, and found one: a
      running "Hermes Agent" v0.20.5 CLI/desktop app (gateway process, `~/.hermes/` config
      directory). **This is very likely not the same "Hermes" `docs/adr-001-hermes-adapter-governance.md`
      describes integrating with** — it presents as a personal, general-purpose AI agent tool
      (kanban board, cron jobs, "pets," per-user memories) with no observed documented HTTP contract,
      communicating over a private Unix socket rather than a REST API. Building a live adapter
      bridge to it would mean guessing at an undocumented protocol, which the task that produced
      this checklist explicitly prohibited ("do not invent paths"). **Before this can move past
      `NOT_CONFIGURED`: confirm with the project owner whether this locally-installed tool is
      actually the intended integration target, and if so, get its real documented API surface.**
- [x] `health()` is real (genuine network call, real failure states) — unreachable to verify
      further without a real base URL.
- [x] `execute()`/`events()` remain honest `NOT_IMPLEMENTED` regardless of configuration — confirmed
      unchanged by source inspection.

## Windmill

- [ ] `NOT_CONFIGURED` in this environment — no `WINDMILL_BASE_URL`/`TOKEN`/`WORKSPACE` set anywhere
      (no `.env` file exists in this checkout at all).
- [x] Client, target registry, and execution ledger are real and contract-tested against a local
      mock server (Pass VI) — this checklist's gap is a live instance to point at, not missing code.
- BLOCKED: a real Windmill deployment to connect to. Per ADR-006, this application is a client of
  an externally-owned Windmill instance — provisioning one (local Docker, VPS, or managed) is
  outside this repo's scope and wasn't done in this pass per the task's own instruction not to
  provision unrelated infrastructure silently.

## MCP

- [x] Real Streamable HTTP JSON-RPC client, real SSRF guard (proven blocking a loopback address by
      default, proven allowing it only with the explicit `MCP_ALLOW_LOCAL_ENDPOINTS=true` escape
      hatch).
- [ ] Zero MCP servers configured in this environment (fresh workspace, no skills seeded — correct
      per `CLAUDE.md`'s "seed nothing but workspace 1" rule). Live validation needs at least one
      real MCP server configured by an operator.

## TON

- [ ] `NOT_CONFIGURED` — no `TONCENTER_API_KEY`/`TONAPI_API_KEY` set. Business logic and the
      5-guardian install path are real and tested; live network validation is BLOCKED on real
      credentials.

## Health

- [x] `GET /health` (liveness) and `GET /api/ready` (readiness) added this pass, both public by
      design, both verified against a real running production build (`{"status":"ok"}` and
      `{"ready":true,...}` respectively).

## Domain / TLS

- BLOCKED: no domain or TLS termination is configured or in scope for this repo — see the Security
  section's TLS note.

## Monitoring

- [ ] No metrics/tracing/APM integration exists. Stdout logging only (see
      `docs/OPERATOR-RUNBOOK.md` §15). Acceptable for beta; revisit before scale.

## Restore test

- [x] See Backup section above — automated, real, not a manual one-off.

## RC acceptance

- [x] `test/rc-acceptance.test.ts` (added this pass) exercises the deterministic, credential-free
      portion of the full pipeline end-to-end against real SQLite/Vault/Aegis/receipt/KIL/memory
      code: authenticated admin → workspace → task execution... → Aegis → receipt → Vault → Memory
      → KIL, plus Windmill's equivalent chain via a local mock server, backup creation/validation,
      and Jarvis admin queries. It does **not** exercise a real Gemini call, a real Hermes runtime,
      or a real external MCP server — none are configured in this environment, and the test suite
      correctly treats their absence as the honest, expected state rather than skipping silently.
      See the test file's own header for exactly what it does and does not prove.

## Known deployment gaps (worth fixing before GA, not blocking beta)

- `PORT` is now configurable (this pass); no `engines` field pins a minimum Node version yet.
- Build tooling (`vite`, `esbuild`, `typescript`, `tsx`, `@vitejs/plugin-react`, `tailwindcss`,
  `autoprefixer`, `@tailwindcss/vite`) lives in `dependencies`, not `devDependencies` — harmless
  functionally, but means a production install can't trim them via `--omit=dev`.
- No graceful-shutdown handler (`server.close()` on `SIGTERM`) — an in-flight request can be cut off
  on stop/restart.
- `Dockerfile`/`docker-compose.yml` added this pass but **UNVERIFIED** — Docker is not installed in
  this session's environment, so `docker build` was never actually run. Verify before relying on it.
