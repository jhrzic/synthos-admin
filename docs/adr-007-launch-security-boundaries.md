# ADR-007 — Launch Security Boundaries

**Status:** Accepted. **Date:** Pass VIII.

## Context

Pass VII's production-readiness audit named four open security blockers: no rate limiting, a
generic-shell `/api/terminal/exec` surface, no reverse-proxy/TLS readiness, and unverified Docker
artifacts. This pass closes the first three with real, tested code and documents the fourth's real
limits. It also fixes two genuine bugs the work itself surfaced: a WAL-mode backup correctness gap
and an unbounded-response risk in the MCP client.

## Rate limiting

A bounded, in-memory, fixed-window limiter (`lib/rate-limit.ts`), tiered by risk rather than one
number everywhere:

| Class | Window | Max | Applied to |
|---|---|---|---|
| `AUTH_SENSITIVE` | 15 min | 10 | login, setup, setup-token validate/complete |
| `EXPENSIVE_EXECUTION` | 1 min | 20 | `/api/generate`, graph execute, skill execute, MCP probe, Windmill submit |
| `PRIVILEGED_ADMIN` | 1 min | 60 | terminal exec (dev-only), admin user creation |
| `GENERAL_API` | 1 min | 120 | defined, not yet blanket-applied (see Known limitations) |

**SINGLE_INSTANCE_LIMITER**, stated plainly: this is process-local in-memory state. It does not
coordinate across replicas — a horizontally-scaled deployment gets `replica_count ×` the stated
limit, since each replica enforces its own independent counter. No distributed store (Redis, etc.)
exists in this stack. Acceptable for the current single-instance beta deployment; revisit before
scaling out.

Keying: `byIp` for unauthenticated routes, `byUserOrIp` (falls back to IP only if somehow
unauthenticated) for routes already behind `requireWorkspaceMember`/`requireWorkspaceAdmin` —
resolved from `req.authUser`, populated by the auth middleware earlier in the same chain, never
from a client-controlled header. `req.ip` itself is Express's own resolution: the raw socket
address unless `TRUST_PROXY_HOPS` is explicitly configured (see below) to trust a specific number
of real proxy hops.

## Terminal execution — DEV_ONLY

**B1 finding.** `/api/terminal/exec` was a genuine, unrestricted `child_process.exec()` shell
surface. Its only prior defense beyond `requirePlatformAdmin` was `checkGuardianRules` — a regex
**denylist**, a fundamentally bypassable pattern (any destructive command not matching one of a
handful of specific shapes sailed through as `SAFE`), and `approvedByHuman` was a client-supplied
boolean the same caller could set to `true` — not an independent approval step.

**B1 classification:**

| | |
|---|---|
| CURRENT_PURPOSE | An operator/dev terminal panel (`HermesTerminalView.tsx` in Master Admin) |
| CURRENT_CALLERS | That one UI component only — verified by grep, no internal route calls it |
| CURRENT_REQUIRED_FOR_CORE | **NO** |
| CURRENT_SECURITY_RISK | **CRITICAL** if reachable in production |

**B2/B3 decision: DEV_ONLY.** Nothing in the real product depends on this route, so removing a
tool the owner may actively use locally wasn't the safest option that also serves the goal — making
it structurally unreachable in production is. Every `/api/terminal/*` route now sits behind a real
`NODE_ENV === "production"` gate that returns `403` before `requirePlatformAdmin` or any handler
logic runs (not merely hidden by the UI — proven live: a real production build, with a real
platform-admin session, gets `403 DEV_ONLY_DISABLED` on both `/api/terminal/status` and
`/api/terminal/exec`). This reuses the exact `NODE_ENV` convention the rest of the codebase already
treats as authoritative for prod-vs-dev (cookie `Secure` flag, Vite dev-middleware selection) —
not a second flag someone could forget to set.

**B5 — defense in depth kept even though the route is now dev-only:** this app's own configured
secrets (`GEMINI_API_KEY`, `WINDMILL_TOKEN`, `HERMES_ADAPTER_TOKEN`,
`MCP_CREDENTIAL_ENCRYPTION_KEY`, `FISH_AUDIO_API_KEY`, TON keys, the signing private key) are
stripped from the child process environment before every exec call. A local developer's own shell
already has full access to their own machine, so a normal dev `PATH`/`HOME`/npm-config environment
is preserved — only this app's own secrets are removed.

## TLS / reverse proxy readiness

- **`TRUST_PROXY_HOPS`** (C1): unset by default — Express trusts nothing, `req.ip` is the raw
  socket address. Set to the real number of reverse-proxy hops in front of the app (typically `1`)
  to correctly resolve client IP for rate limiting. Never `app.set('trust proxy', true)` — that
  would let any client spoof `X-Forwarded-For` and defeat IP-based limiting entirely.
- **Cookie `Secure`** stays gated on `NODE_ENV === "production"` directly, not on `req.secure` —
  deliberately. This is more robust than depending on a perfectly-configured
  trust-proxy/`X-Forwarded-Proto` chain: the flag is set whenever this process believes it's a
  production deployment, independent of what any upstream proxy claims.
- **No app-level HTTP→HTTPS redirect.** The task that produced this ADR explicitly warned against
  redirect loops behind a reverse proxy that has already terminated TLS. Caddy (the documented
  example, `docs/deploy/Caddyfile.example`) handles HTTP→HTTPS automatically; this app does not
  duplicate that responsibility.
- **`docs/deploy/Caddyfile.example`** (C4): real body-size limit matching this app's own 10MB JSON
  limit, real timeouts, a `/health` passthrough, no hardcoded domain.

## Security headers

Minimal, real, no new dependency (`lib/rate-limit.ts`-adjacent middleware in `server.ts`):
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, a `Permissions-Policy`
that doesn't blanket-grant camera/mic/geolocation, and a `Content-Security-Policy` sized to this
app's **actual, verified** external dependencies — Google Fonts (`style-src`/`font-src`) and the
optional Fish Audio TTS WebSocket (`connect-src`) — never a wildcard. `script-src 'self'` only, no
`unsafe-inline`/`unsafe-eval`. `Strict-Transport-Security` is sent only when `NODE_ENV=production`.

**Verified live** (production build, real Chrome session): the SPA, Master Admin, Kanban, and Graph
Builder all render correctly under this CSP with zero console errors — this was not left as an
unverified guess.

## Docker — static review only, `DOCKER_RUNTIME_VERIFIED: NO`

Docker remains uninstalled in this development environment. Static review this pass (D1–D3): base
image `node:22-slim` (matches the installed Node version; `node:sqlite` needs no native build
toolchain so a slim, non-Alpine base was chosen for broadest compatibility), multi-stage build,
runs as the non-root `node` user the base image already provides (uid 1000, `chown -R node:node
/app` before dropping root — fixed this pass, was previously running as root), named volumes for
`/app/data`, `/app/vault`, `/app/backups`, a real `HEALTHCHECK` against `/health`, `.dockerignore`
excludes `node_modules`, `.git`, `.env`, local DB/Vault/backup data, and `synthos-admin.mp4`. No
secret is baked into the image — all injected via environment at run time. **None of this has been
confirmed by an actual `docker build`.**

## Two real bugs this pass's own work surfaced and fixed

1. **WAL-mode backup correctness gap.** Adding `PRAGMA journal_mode = WAL` (a real production-
   safety improvement — readers no longer block writers) broke `createBackup()`'s plain
   `fs.copyFileSync` of the main `.db` file: recent writes can sit only in the `-wal` sidecar file,
   never captured by a raw copy. The backup/restore drill added this pass
   (`test/backup-restore-drill.test.ts`) caught this immediately — the restored database was
   missing its `users` table entirely. Fixed with `PRAGMA wal_checkpoint(TRUNCATE)` before every
   copy, folding all WAL content into the main file first.
2. **`stageRestore()` was not safe under concurrent calls.** It used to `rm` then rebuild
   `STAGED_RESTORE_ROOT` in place — two concurrent restore-stage calls could have one delete the
   other's mid-extraction files, or a reader observe a torn, partially-extracted archive. Now each
   call extracts into a private, uniquely-named directory and publishes it to the well-known
   `STAGED_RESTORE_ROOT` path via two atomic renames (old → trash, new → live) — the last call to
   finish wins wholly, never a mix of two extractions.
3. **A real ordering race in two "most recent row" queries.** `ORDER BY created_at DESC LIMIT 1`
   with no tiebreaker, where `created_at` is a millisecond-resolution string — two rows written in
   the same millisecond (a realistic case: a message immediately followed by a reply) tie, and
   SQLite gives no guaranteed secondary order. Fixed in both `lib/jarvis-sessions.ts`'s
   `statsFor()` and `lib/persistence.ts`'s `latestKilObservationForTask()` with a `rowid DESC`
   tiebreaker — SQLite's real, implicit, strictly-monotonic-per-insert column.

## MCP response size bound

`lib/mcp-client.ts`'s `jsonRpcCall` and `lib/skill-execution.ts`'s `runMcpToolAction` previously
called `res.json()` directly on a fetch response from an admin-configured (but still external,
outside this app's control) MCP server, with no bound. A misbehaving server could hand back an
unbounded body, buffered entirely into memory before any validation. Now bounded at 1MB — checked
against `Content-Length` when present, and via a manual stream-read-with-early-abort when absent
(chunked encoding) — proven by test against both cases.

## Public route allowlist (Workstream N)

Enforced by the existing exhaustive source-level test (`test/api-security-routes.test.ts`'s "no
route outside the documented allowlist is missing every guard"): every route in `server.ts` either
carries `requireAuth`/`requireWorkspaceMember`/`requireWorkspaceAdmin`/`requirePlatformAdmin`, is
the internal-service-token-gated `/api/execute-agent-task`, or is on the explicit public list:

```
/api/auth/setup-required, /api/auth/setup, /api/auth/login, /api/auth/logout, /api/auth/me,
/api/auth/setup-token/:token, /api/auth/setup-token/:token/complete,
/api/skills/discover,
/health, /api/ready,
* (SPA shell fallback — no data of its own)
```

No debug/terminal/admin route is on this list — `/api/terminal/*` requires both `requirePlatformAdmin`
*and* the dev-only gate.

## Known limitations, stated honestly

- **Rate limiting is not applied to every route** — only the four risk tiers named above. A broader
  `GENERAL_API` sweep across all remaining authenticated routes was deliberately not done this pass
  (the task's own A1 instruction: "do not apply one arbitrary limit everywhere" — targeted
  application over blanket coverage).
- **Docker is entirely unverified at runtime.** Static review only.
- **CSP was verified against the specific screens exercised in this pass's browser smoke test**
  (login, Overview, Kanban, Master Admin, Graph Builder) — not every one of the ~40 view components
  in `src/components/`. A screen using an external resource not accounted for here would silently
  fail under this CSP; watch the browser console after this ships.
