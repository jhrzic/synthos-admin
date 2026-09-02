# SynthOS Admin — Operator Runbook

Practical, no-marketing reference for running this application. Written for the person who has to
actually start it, configure it, onboard a second user, and recover it when something breaks. Pairs
with `docs/PRODUCTION-READINESS.md` (the pre-launch checklist) and `docs/IMPLEMENTATION-STATUS.md`
(what is real vs. partial vs. not implemented).

## 1. Installation

Requirements: Node.js 22+ (this app uses the built-in `node:sqlite` module — no separate database
server). No `engines` field is currently pinned in `package.json`; treat Node 22 as the floor until
that's added.

```bash
git clone <repo-url> synthos-admin
cd synthos-admin
npm ci
```

## 2. Environment setup

Copy `.env.example` to `.env` and fill in only what you actually intend to use. **Core platform
startup requires zero external credentials** — auth, the database, the Vault, the memory index, and
receipt signing all self-provision. Every other variable gates one optional integration; leaving it
unset means that integration honestly reports `NOT_CONFIGURED`, not a startup failure.

Run `lib/env-readiness.ts`'s validator (surfaced automatically in the startup log, see §4) to see
exactly what's configured vs. missing — it never prints a secret value, only presence and shape.

Full variable-by-variable reference: `.env.example` (every variable is commented with what it gates)
and `lib/env-readiness.ts`'s `ENV_VAR_SPECS` (machine-readable, includes `subsystem`/`requiredFor`).

## 3. Build

```bash
npm run build
```

Produces `dist/` (the client bundle, via Vite) and `dist/server.cjs` (the server, bundled via
esbuild with `--packages=external` — so `node_modules` must still be present at runtime; the server
bundle is not fully self-contained). A `>500KB` client chunk warning is known and currently accepted
— see `docs/PRODUCTION-READINESS.md`'s Performance section.

## 4. Start / stop

```bash
NODE_ENV=production npm start     # runs `node dist/server.cjs`
```

On startup the process prints one line per core subsystem to stdout — no secret values, ever:

```
[Startup] AUTH: READY — Local scrypt-hashed accounts; no external IdP required.
[Startup] DATABASE: READY — SQLite, self-provisioning schema on first open.
[Startup] RECEIPT_SIGNING: READY — Ed25519 keypair self-generates on first use if not pre-provisioned.
[Startup] VAULT: READY — Filesystem-backed, directory created on first write.
[Startup] MEMORY_INDEX: READY — SQLite FTS5, part of the same self-provisioning schema.
[Startup] GEMINI_PROVIDER: NOT_CONFIGURED — GEMINI_API_KEY not set — model-backed features disabled, not a startup failure.
[Startup] HERMES_RUNTIME: NOT_CONFIGURED — HERMES_ADAPTER_BASE_URL not set.
[Startup] WINDMILL: NOT_CONFIGURED — WINDMILL_BASE_URL/TOKEN/WORKSPACE not all set.
[Startup] MCP_CREDENTIAL_STORAGE: NOT_CONFIGURED — MCP_CREDENTIAL_ENCRYPTION_KEY not set — credential storage refused, never falls back to plaintext.
[Startup] BACKUP: READY — Local filesystem archive (backups/), no external dependency.
Server running on http://0.0.0.0:3000
```

`NOT_CONFIGURED` lines for optional integrations are expected and not an error — a missing
`WINDMILL_BASE_URL`, for example, is a deliberate choice, not a failure. If a `REQUIRED` variable
were ever missing/invalid (none exist today — see §2), the process still starts but logs an
`ERROR`-level line naming exactly which ones.

Stop with a normal `SIGTERM`/`Ctrl-C`. There is no graceful-shutdown drain implemented (no explicit
`server.close()` handler) — in-flight requests may be cut off. For a zero-downtime restart, run the
new process on a different port, confirm `/api/ready`, then cut traffic over — this app has no
built-in blue/green support.

Restart safety: every table this app writes to is in the single SQLite file at `SYNTHOS_DB_PATH`
(default `./data/synthos-admin.db`) plus the `vault/` and `backups/` directories. A restart with
those three paths intact loses nothing — verified live in this pass (create a user, kill the
process, restart, log in with the same credentials — same `user_id`, same session cookie still
valid). The one non-persistent thing by design is the per-process internal service token used for
the graph-execution loop's own self-call — it regenerates every start and grants no external
authority, so this is not a data-loss concern.

## 5. Health and readiness

- `GET /health` — liveness. Always `200 {"status":"ok"}` if the process is up. No DB touch. Use this
  for a container orchestrator's liveness probe.
- `GET /api/ready` — readiness. `200 {"ready":true,...}` when core systems (env, Vault, memory
  index) are usable; `503` otherwise. An optional integration being `NOT_CONFIGURED` never fails
  readiness. Use this for a readiness/startup probe, not liveness.
- `GET /api/master-admin/runtime-status` (platform-admin session required) — the full per-subsystem
  breakdown shown in Master Admin's Runtime tab, including live-probed Windmill/Hermes/MCP status.

## 6. First admin setup

On first boot, `GET /api/auth/setup-required` returns `true` until an account exists. The very first
account created via `POST /api/auth/setup` (or the Auth screen in the UI) automatically becomes
`platform_admin` and is granted `admin` on the seeded `ws-synthos-primary` workspace. There is no
separate "create the first admin" CLI step — the setup screen *is* that step, and only works once
(subsequent calls to `/api/auth/setup` are rejected once any user exists).

## 7. Workspace creation

Platform admins create workspaces from Master Admin → Workspaces (`POST /api/master-admin/workspaces`).
Per `CLAUDE.md`'s beta access model, this is a manual, by-hand action — there is no public/self-serve
workspace creation, and none should be added during beta.

## 8. Second-user onboarding

No email infrastructure exists anywhere in this codebase. Onboarding a second user is a real,
one-time-use setup token flow:

1. Master Admin → Users → Create User. The API response includes the raw setup link **exactly
   once** — copy it immediately; it is never shown again and is not re-derivable.
2. Hand that link to the new user out of band (Slack, a DM, however you'd share a password reset
   link).
3. They open it, set their own password, and are auto-logged-in. The token is single-use and
   expires after 24h.
4. Grant workspace membership separately (Master Admin → Workspaces → a workspace's Members panel,
   or the user's own Workspace Memberships panel) — creating a user does not itself grant access to
   any workspace beyond what you explicitly assign.

## 9. Provider configuration (Gemini)

Set `GEMINI_API_KEY`. There is no live-call verification at startup (a live call costs money) — the
key's real validity is proven the first time something actually calls it; check
`/api/master-admin/runtime-status`'s Gemini Provider row after a first real use, or watch for a
`BLOCKED_MISSING_CREDENTIAL` / provider-error response from `/api/generate` or
`/api/execute-agent-task`. `OPENROUTER_API_KEY` is recognized but has no execution mapping wired —
setting it configures nothing.

## 10. Hermes runtime configuration (ADR-001)

Set `HERMES_ADAPTER_BASE_URL` (and `HERMES_ADAPTER_TOKEN` if the adapter requires auth). `health()`
is real (a genuine network call with real failure states); `execute()`/`events()` remain honest
`NOT_IMPLEMENTED` stubs regardless of configuration — no real contract exists for either yet (see
`docs/adr-001-hermes-adapter-governance.md`). Do not point this at a personal AI-agent CLI/desktop
tool that happens to also be named "Hermes" unless you have confirmed it exposes the specific
health/execute/events HTTP contract this adapter expects — a locally-discovered Hermes-named process
during this pass turned out to be exactly that kind of false-friend risk (see
`docs/PRODUCTION-READINESS.md`).

## 11. Windmill configuration (ADR-006)

Set all three: `WINDMILL_BASE_URL`, `WINDMILL_TOKEN`, `WINDMILL_WORKSPACE`. Verify with
`GET /api/master-admin/windmill/status` (platform admin) — `CONNECTED` requires both a real
`GET /api/version` and a real authenticated `GET /api/users/whoami`, never fabricated from
configuration alone. Before anyone can submit a job, a platform or workspace admin must register at
least one target in the registry (`POST /api/windmill/targets` for a workspace-scoped target,
`POST /api/master-admin/windmill/targets` for a platform-global one) — no arbitrary remote
script/flow path is ever accepted directly from a submission request.

## 12. MCP configuration

Per skill: set an `mcp`-category skill's `source_ref` to the server's Streamable HTTP endpoint, and
supply a bearer credential if the server requires one (requires `MCP_CREDENTIAL_ENCRYPTION_KEY` to
be set first — without it, credential storage is refused outright, never silently stored in
plaintext). Probe with `POST /api/skills/:skillId/mcp/probe`. `MCP_ALLOW_LOCAL_ENDPOINTS=true` is a
local-development-only escape hatch for the SSRF guard — **must stay unset in production**.

## 13. Backup

```bash
curl -X POST http://localhost:3000/api/backup/create -b <platform-admin-cookies>
```

Creates a real `.tar.gz` under `backups/` containing the SQLite database and the Vault directory —
nothing else (no `.env`, no credentials, no node_modules). List with `GET /api/backup/list`, inspect
a manifest with `GET /api/backup/:backupId/manifest`, independently re-verify checksums with
`POST /api/backup/:backupId/validate`. Automate this on your own schedule (cron/systemd timer/your
orchestrator's job scheduler) — **this application has no built-in scheduler and none should be
added inside it**; recurring backups are an operator responsibility, not a SynthOS feature.

## 14. Restore

Restore is deliberately staged, never a live in-place swap — this process holds an open SQLite
handle on the live database file for its entire lifetime.

```bash
curl -X POST http://localhost:3000/api/backup/:backupId/restore -d '{"confirmed":true}' -b <cookies>
```

This validates the archive, extracts it to `backups/.staged-restore/`, and returns the exact manual
steps (stop the server, replace the two real files/directories, restart). It never claims a restore
completed while the process is still running the old data.

## 15. Logs

Everything currently goes to stdout/stderr — there is no structured log file or log shipper wired
in. Capture stdout at the process/container level (systemd journal, `docker logs`, your platform's
log collector). Startup readiness (§4), runtime connection failures (provider/Hermes/Windmill/MCP
errors), external-execution lifecycle transitions, and critical auth events (setup, login failures,
account disable) are all real `console.log`/`console.error`/`console.warn` calls today — grep stdout
for `[Startup]`, `[Agent Execution Error]`, `[Jarvis Command Error]`, etc. Passwords, session tokens,
setup tokens, API keys, and raw MCP/Windmill credentials are never logged anywhere in this codebase
(verified by source grep in this pass — see `docs/PRODUCTION-READINESS.md`).

## 16. Common failure states

| Symptom | Likely cause | Check |
|---|---|---|
| `GET /health` fails to connect | Process not running / wrong port | Is the process alive? `PORT` env var matches what you're hitting? |
| `GET /api/ready` returns 503 | A required env var is missing/invalid, or Vault/Memory index is unreachable | Response body lists `requiredEnvMissing`/`requiredEnvInvalid` and per-system status |
| `/api/auth/login` always fails | Wrong password, or account `status != 'active'` (disabled) | `GET /api/master-admin/users` (platform admin) to check status |
| Every request 403s cross-origin | CSRF `Origin` check (site-wide, by design) — see `requireSameOrigin` | Confirm you're calling the API from the same origin, or via a same-origin proxy |
| Model-backed feature fails with `BLOCKED_MISSING_CREDENTIAL` | `GEMINI_API_KEY` unset | Set it, restart |
| Windmill submission always fails `TARGET_NOT_ALLOWED` | No registry target exists for that workspace, or it's disabled | `GET /api/windmill/targets`, register one if empty |
| Windmill status stuck `NOT_CONFIGURED` | One of `WINDMILL_BASE_URL`/`TOKEN`/`WORKSPACE` unset | Startup log or `/api/ready` names which |
| A skill won't execute despite being enabled | Registered ≠ executable — no execution target configured, or the target's provider/runtime is unavailable | `GET /api/skills/:id/executability` explains the real reason |
| Login/setup suddenly returns `429 Too Many Requests` | Rate limiting (§19) — 10 attempts per 15 minutes per IP on auth routes | Real protection working as intended; wait for the window, or check `Retry-After` in the response |
| `/api/terminal/*` returns `403 DEV_ONLY_DISABLED` | You're running with `NODE_ENV=production` — this is deliberate (§19), not a bug | Run locally with `npm run dev` if you need the terminal panel |

## 17. Safe restart procedure

1. Confirm a recent backup exists (§13) — cheap insurance, this app has no automatic pre-restart
   backup.
2. Stop the process (`SIGTERM`, or your orchestrator's normal stop).
3. Start it again (§4).
4. Poll `GET /api/ready` until `200`.
5. Spot-check: log in, load Master Admin, confirm the workspace/user list you expect is still there.

There is no separate migration step — schema changes are applied automatically via `CREATE TABLE IF
NOT EXISTS` / guarded `ALTER TABLE` checks the first time `getDatabase()` runs after start (see
`lib/persistence.ts`), so a normal restart is also how a schema update gets applied.

## 18. Deploying behind a reverse proxy (TLS)

This application does not terminate TLS itself. Put a real reverse proxy in front of it — an
example Caddy config is at `docs/deploy/Caddyfile.example` (real TLS termination, a body-size limit
matching this app's own 10MB JSON limit, real timeouts, a `/health` passthrough; no domain
hardcoded, fill in your own).

Start this app with `TRUST_PROXY_HOPS=1` when it sits behind exactly one such proxy — this tells
Express to trust that one hop's `X-Forwarded-*` headers (needed for correct client-IP resolution in
rate limiting, see §19). **Never** set this to an arbitrary large number or leave it unset while
also trusting `X-Forwarded-For` some other way — an untrusted hop count lets any client spoof its
own IP and defeat rate limiting entirely. The session cookie's `Secure` flag does not depend on this
setting — it's gated on `NODE_ENV=production` directly, which you should already have set (§4).

This app implements no HTTP→HTTPS redirect of its own — that's the proxy's job (Caddy does it
automatically). Do not add one app-side; behind a proxy that has already terminated TLS, an
app-side redirect risks a loop.

## 19. Rate limiting and the dev-only terminal

**Rate limiting** (`lib/rate-limit.ts`) is real but process-local (`SINGLE_INSTANCE_LIMITER`) — if
you ever run more than one instance of this app behind a load balancer, each instance enforces its
own independent limit; there is no shared/distributed limiter in this stack. Four tiers: login/setup
(10 per 15 min per IP), expensive execution — `/api/generate`, graph execute, skill execute, MCP
probe, Windmill submit (20 per min per user), privileged admin actions — terminal exec, user
creation (60 per min), general API (defined, not yet applied everywhere). A `429` response includes
`Retry-After`.

**`/api/terminal/*`** (the Hermes Terminal panel in Master Admin) is a real, unrestricted shell-exec
surface — genuinely useful for local development, genuinely dangerous in production. It is
structurally disabled whenever `NODE_ENV=production`, regardless of session or role — not just
hidden by the UI. There is no environment variable to re-enable it in production; if you need this
capability in a deployed environment, that is a deliberate architecture change, not a config flag,
and should go through the same review this restriction did (see
`docs/adr-007-launch-security-boundaries.md`).
