# SynthOS Admin — Production Readiness Checklist

Pre-launch checklist, updated through Pass VIII's launch-hardening/security-closeout pass (see
`docs/adr-007-launch-security-boundaries.md`), on top of Pass VII's environment/runtime audit.
Checked items are verified by a real test, a real local run, or direct source inspection — not
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
- [x] **`/api/terminal/exec` is now DEV_ONLY** (Pass VIII / ADR-007). Every `/api/terminal/*` route
      sits behind a real `NODE_ENV === "production"` gate returning `403` before
      `requirePlatformAdmin` or any handler logic runs — proven live against a real production
      build with a real platform-admin session (`403 DEV_ONLY_DISABLED`). This app's own configured
      secrets are also stripped from the child process environment as defense in depth. The
      underlying denylist (`checkGuardianRules`) is unchanged and remains bypassable in principle —
      it no longer matters in production since the route is unreachable there.
- [x] **Rate limiting is real** (Pass VIII, `lib/rate-limit.ts`) — a bounded, in-memory, tiered
      limiter. `AUTH_SENSITIVE` (login, setup, setup-token validate/complete): 10 attempts / 15 min
      by IP. `EXPENSIVE_EXECUTION` (`/api/generate`, graph execute, skill execute, MCP probe,
      Windmill submit): 20/min by user. `PRIVILEGED_ADMIN` (terminal exec, admin user creation):
      60/min. Proven live: 12 rapid login attempts against a real running instance returned
      `401 ×10` then `429 ×2`. **`SINGLE_INSTANCE_LIMITER`** — stated honestly, not silently
      claimed as distributed: this is process-local in-memory state; a horizontally-scaled
      deployment gets `replica_count ×` the stated limit per replica. Not every route carries a
      limit yet — see ADR-007's Known limitations.
- [x] **Security headers added** (Pass VIII): `X-Content-Type-Options: nosniff`, `X-Frame-Options:
      DENY`, `Referrer-Policy`, a scoped `Permissions-Policy`, and a `Content-Security-Policy` sized
      to this app's actual external dependencies (Google Fonts, the optional Fish Audio WebSocket) —
      `script-src 'self'` only, no `unsafe-inline`/`unsafe-eval`, no wildcard `connect-src`. HSTS
      only when `NODE_ENV=production`. Verified live: login, Overview, Kanban, Master Admin, and
      Graph Builder all render with zero console errors under this CSP in a real Chrome session.
- [x] **`TRUST_PROXY_HOPS`** (Pass VIII): unset by default (Express trusts nothing — `req.ip` is the
      raw socket address). Set to the real hop count behind a reverse proxy; never blindly
      `trust proxy: true`, which would let any client spoof `X-Forwarded-For` and defeat IP-based
      rate limiting.
- [x] **Reverse proxy example added**: `docs/deploy/Caddyfile.example` — real TLS termination, a
      body-size limit matching this app's own 10MB JSON limit, real timeouts, a `/health`
      passthrough, no hardcoded domain. This app deliberately implements no HTTP→HTTPS redirect of
      its own — the proxy's job, and doing it app-side risks a redirect loop behind a proxy that
      already terminated TLS.
- BLOCKED: actual TLS/HTTPS termination and a real domain — this application does not terminate TLS
  itself; a production deployment needs the reverse proxy above (or equivalent) genuinely running in
  front of it. Out of this repo's scope to provision.

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
- [x] **Full content-level restore drill** (Pass VIII, `test/backup-restore-drill.test.ts`): creates
      a real user + real Vault artifact, backs up, independently re-validates checksums, stages a
      restore, then opens the STAGED copy with its own separate `DatabaseSync` connection (never the
      live handle) and queries it — proving the restored bytes really contain that exact user row
      and artifact content, not just that a file exists. This drill caught two real bugs the same
      pass introduced and fixed (see below) before they could have reached production.
- [x] **WAL-mode backup correctness bug found and fixed** (Pass VIII): adding `PRAGMA journal_mode =
      WAL` (a real concurrency improvement) broke the prior plain `fs.copyFileSync` backup — recent
      writes can sit only in the `-wal` sidecar file, invisible to a raw copy of the main `.db`
      file. The restore drill caught this immediately (`no such table: users` in the restored copy).
      Fixed with `PRAGMA wal_checkpoint(TRUNCATE)` before every backup copy.
- [x] **Concurrent-restore race found and fixed** (Pass VIII): `stageRestore()` used to `rm` then
      rebuild the shared staging directory in place — two concurrent restore calls could corrupt
      each other's extraction. Now each call extracts privately and publishes via two atomic
      renames; the last call to finish wins wholly, never a torn mix.
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
      is unset, so `HERMES_RUNTIME` is honestly `NOT_CONFIGURED`. Pass VII searched the local
      machine for a real Hermes installation and found one: a running "Hermes Agent" v0.20.5
      CLI/desktop app (gateway process, `~/.hermes/` config directory). **This is very likely not
      the same "Hermes" `docs/adr-001-hermes-adapter-governance.md` describes integrating with** —
      it presents as a personal, general-purpose AI agent tool (kanban board, cron jobs, "pets,"
      per-user memories) with no observed documented HTTP contract, communicating over a private
      Unix socket rather than a REST API.
- [x] **Pass VIII corroboration**: a real browser walkthrough of Master Admin's own "Providers &
      Models" and "Hermes Admin" panels shows this codebase's UI *itself* labels the intended
      integration **"Nous Hermes 3 AgentOS Adapter (ADR-001)"** and lists `nousresearch/hermes-3-*`
      as the associated model family — a specific, real reference to Nous Research's Hermes model
      line, not a general-purpose personal CLI tool. This corroborates, from the app's own source of
      truth rather than inference alone, that the locally-discovered "Hermes Agent" is a false
      friend. **Before this can move past `NOT_CONFIGURED`: confirm with the project owner what the
      real Nous Hermes 3 AgentOS integration target is, and get its documented API surface** —
      building an adapter bridge to an undocumented protocol was explicitly out of scope this pass.
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
- [x] **Response size bound added** (Pass VIII): every MCP JSON-RPC call (probe and `tools/call`)
      is now bounded at 1MB — checked against `Content-Length` when present, and via a manual
      stream-read-with-early-abort when absent (chunked encoding) — proven by test against both a
      declared-oversized response and an actual oversized stream. Previously unbounded: a
      misbehaving MCP server could have forced this app to buffer an arbitrarily large response into
      memory before any validation.
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
  section's TLS note. A real reverse-proxy example now exists (`docs/deploy/Caddyfile.example`) to
  make standing one up fast once a domain is chosen.

## Production browser smoke (Pass VIII, `PRODUCTION_BROWSER_SMOKE: PASS` with one major UI finding)

A real Chrome session against a real `NODE_ENV=production node dist/server.cjs` instance: login,
Overview, Master Admin (Overview & Scorecard, Setup Walkthrough, Providers & Models, Hermes Admin
tabs), Kanban, Graph Builder. Zero JavaScript console errors on any screen. The three newly
lazy-loaded views (Kanban, Master Admin, Graph Builder — see Performance below) all rendered
correctly through their `Suspense` boundary with no visible flash-of-broken-content or hydration
issue.

**Major finding, not cosmetic:** the application's **default landing screen** ("Overview") and its
sibling OPERATIONS-section screens (Kanban, Active Runs, Agent Wireframe) show **entirely fabricated
static demo data** inherited from the pre-SynthOS Mission Control UI this project forked — invented
agent counts (`ACTIVE 7 agents`), invented `LIVE`/`PARTIAL` status badges for products this codebase
does not integrate with (Cursor, Antigravity, OpenClaw — not present anywhere in `lib/model-router.ts`
or any real provider list), an invented `22% Complete` pipeline progress bar, fabricated Kanban tasks.
This is exactly the class of finding this checklist's own truth-sweep instruction was looking for
(`CONNECTED`/`LIVE`/`ACTIVE` claims without backing evidence) — found by actually looking, not
assumed clean because other passes' work was real.

The **real, tested, live-data-driven surface** — everything else in this document — is reached via
the sidebar's "MASTER ADMIN" section, not the default view. See `docs/DEMO-PROFILE.md` for the
practical implication (demo from Master Admin, not the default landing screen) and the final report's
`RECOMMENDED_NEXT_TASK` for why fixing this is the single highest-priority remaining item.

Not done this pass, given the scope of a proper fix (rewiring or replacing an entire legacy
dashboard is a materially different task than hardening what's already real): actually wiring
Overview to real data, relabeling it as a demo, or removing it.

## Monitoring

- [ ] No metrics/tracing/APM integration exists. Stdout logging only (see
      `docs/OPERATOR-RUNBOOK.md` §15). Acceptable for beta; revisit before scale.

## Restore test

- [x] See Backup section above — automated, real, not a manual one-off.

## RC acceptance

- [x] `test/rc-acceptance.test.ts` (Pass VII, expanded Pass VIII) exercises the deterministic,
      credential-free portion of the full pipeline end-to-end against real SQLite/Vault/Aegis/
      receipt/KIL/Jarvis code: platform-admin bootstrap → second-user onboarding via a real setup
      token → workspace membership → a real deterministic skill execution → a real Windmill-backed
      skill execution through the full pipeline (submit → real remote job via a local mock server →
      artifact → Aegis → a real Ed25519 receipt → independent re-verification → a real KIL
      observation with real confidence scoring → memory-index full-text search) → a real Jarvis
      session reflecting the real receipt count → a real backup afterward, independently
      re-validated. Rate limiting and the content-level restore drill have their own dedicated, more
      thorough test files (`test/rate-limit.test.ts`, `test/backup-restore-drill.test.ts`);
      restart/session persistence was proven live against a running production build rather than in
      this suite. It does **not** exercise a real Gemini call, a real Hermes runtime, or a real
      external MCP server — none are configured in this environment, and the test suite asserts
      their absence explicitly rather than skipping silently. See the test file's own header for
      exactly what it does and does not prove.

## Performance (Pass VIII, `IMPROVED`, not `RESOLVED`)

The main JS chunk was 1,886.52 kB raw / 483.35 kB gzip. Five heaviest, non-default-view components
(`MasterAdminView`, `GraphBuilderView`, `KanbanView`, `StartupIdeaGeneratorView`, `SettingsView` —
consistently the largest files in `src/components/`, none of them the default `overview` tab) are
now `React.lazy()`-loaded behind one `Suspense` boundary wrapping the whole tab-content area (safe:
only one `{activeTab === 'x' && <X/>}` block is ever mounted at a time). Main chunk is now
1,480.91 kB raw / 387.36 kB gzip (≈21.5%/19.9% reduction), with the five views as separate chunks
(39–109 kB raw each) downloaded only when their tab is opened. **Verified live**, not just measured
by build output: all three of Kanban/Master Admin/Graph Builder rendered correctly with zero console
errors in a real Chrome session against the production build. The `>500KB chunk` build warning still
fires — the main chunk is still well over that threshold — a full fix would mean vendor-splitting
large libraries (d3, recharts, motion) via `manualChunks`, a larger change than this pass's "no broad
rewrite" instruction allowed.

## Voice input — microphone (Pass IX, Jarvis + Apollo hearing repair)

- [x] **Real browser capability detection**, never assumed: `isSpeechRecognitionSupported()`
      checks for a real `SpeechRecognition`/`webkitSpeechRecognition` constructor; the shared hook
      (`src/hooks/useSpeechRecognition.ts`) starts in a real `unsupported` `micState` on a browser
      without it, and `startListening()` returns `false` rather than pretending to start. Proven by
      test (`test/use-speech-recognition.test.ts`).
- [x] **Listening state is driven by real browser events** (`onstart`/`onend`/`onerror`), never a
      timer or an optimistic UI flip — proven by test with a real (mocked) constructible
      `SpeechRecognition` firing real event callbacks.
- [x] **Errors are classified, not swallowed.** `not-allowed`/`service-not-allowed` →
      `permission-denied`; `audio-capture` → `no-device` (a missing microphone is reported
      distinctly from a denied permission); `no-speech` is treated as transient, not a hard error;
      every other browser error code surfaces a real `{ code, message }`, never a raw stack trace.
- [x] **No empty/duplicate submission.** A whitespace-only final transcript is never submitted; the
      same final transcript firing twice in rapid succession submits once (1.5s dedup window); two
      distinct consecutive utterances both submit.
- [x] **Only one recognizer active at a time**, enforced by a module-level singleton in the shared
      hook — starting Apollo's mic stops Jarvis's real recognizer (and vice versa) as a genuine side
      effect (`.stop()` called on the other instance's real object), not just a state flag.
- [x] **Cleanup is real.** Unmounting a component while listening calls the real recognizer's
      `.abort()` — no orphaned capture survives a surface close.
- [x] **Jarvis and Apollo routing separation verified by source-level regression test**
      (`test/voice-routing-separation.test.ts`, matching this repo's established convention): a
      Jarvis transcript reaches only `executeDirective`/`onJarvisCommand`; an Apollo transcript
      reaches only its own `handleVoiceCommandReceived`; Apollo contains no reference to
      `onJarvisCommand` or `/api/jarvis/command`; Apollo's spoken responses are real templates tied
      to actual task outcomes, never a raw `/api/generate` chat completion presented as its own
      voice.
- [x] **A real, previously-broken transcript-delivery bug was found and fixed in JarvisView.**
      Before this pass, a finished Jarvis voice transcript populated the text input but was never
      submitted — the user had to manually click Execute after speaking. Voice input is now
      auto-submitted through the same dispatcher a typed command uses (`executeDirective`), proven
      by both the fixed regression test in `test/jarvis-admin-wiring.test.ts` and the new
      `test/voice-routing-separation.test.ts`.
- [x] **TTS/voice-output configuration untouched.** `voiceEngine.ts` and `fishAudio.ts` were never
      opened for editing this pass; JarvisView's Fish Audio → ElevenLabs → browser-`speechSynthesis`
      provider chain and voice-selection logic are byte-identical to before, proven by source-level
      assertion in `test/voice-routing-separation.test.ts`. `TTS_VOICE_CHANGED: NO`.
- [x] **Real browser validation performed** against a real `NODE_ENV=production node dist/server.cjs`
      instance in a real Chrome session (Pass IX): Apollo's "START APOLLO LIVE" control produced a
      real `onstart`→`LISTENING` transition (live waveform, running session timer) and a clean
      `onend`→idle transition on stop, with zero console errors either way. Jarvis's Global Voice
      Core mic control was exercised the same way with zero console errors. `isSecureContext` was
      confirmed `true` and a real `SpeechRecognition` global was confirmed present in that browser.
      No physical microphone hardware exists in this sandboxed environment — the native
      OS-level Chrome permission prompt (if any) is outside the page DOM and cannot be granted by
      automation, and `navigator.permissions.query({name:'microphone'})` reported `prompt`
      (never resolved to `granted`), so **live audio capture was not, and cannot honestly be
      claimed to have been, proven end-to-end** — only the real code path up to and including the
      browser's own permission gate was. `MIC_BROWSER_TEST: ENVIRONMENT_BLOCKED`.
- [ ] Not done this pass: real end-to-end proof of actual spoken audio being transcribed and
      dispatched, which requires real microphone hardware and a human in the loop — BLOCKED on
      environment, not on code. `CommandPalette.tsx`'s own separate, pre-existing
      `SpeechRecognition` implementation was deliberately left out of scope (the task named only
      Jarvis and Apollo); it does not share the repaired hook and was not touched.

## Known deployment gaps (worth fixing before GA, not blocking beta)

- `PORT` is now configurable (Pass VII); no `engines` field pins a minimum Node version yet.
- Build tooling (`vite`, `esbuild`, `typescript`, `tsx`, `@vitejs/plugin-react`, `tailwindcss`,
  `autoprefixer`, `@tailwindcss/vite`) lives in `dependencies`, not `devDependencies` — harmless
  functionally, but means a production install can't trim them via `--omit=dev`.
- No graceful-shutdown handler (`server.close()` on `SIGTERM`) — an in-flight request can be cut off
  on stop/restart.
- `Dockerfile`/`docker-compose.yml` (Pass VII, hardened Pass VIII — now runs as non-root `node`
  user) but **UNVERIFIED at runtime** — Docker is not installed in this session's environment, so
  `docker build` was never actually run. Verify before relying on it.
- Rate limiting (Pass VIII) covers four named risk tiers, not every route — see ADR-007.
- The default "Overview" landing screen shows fabricated demo data — see the Production browser
  smoke section above and `docs/DEMO-PROFILE.md`. The single highest-priority remaining item.
