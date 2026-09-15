# Always-on local runtime (macOS)

What this is: SynthOS running continuously on this Mac, started by `launchd` at login, with no
Terminal, IDE, Claude Code or Antigravity window involved. Closing every window changes nothing.

It is deliberately **not** a second control plane. There is one admin process, one scheduler, one
database, and the health of all of it is reported by the status aggregator that already existed
(`lib/runtime-status.ts`), surfaced where it already was — the Master Admin runtime panel and
`GET /api/ready`.

---

## 1. What actually runs

The thing worth understanding first: **SynthOS Admin is one process, not a fleet.** The scheduler,
Guardian, Aegis receipt signing, the model router and every Brain read/write live *inside* the
admin server process. There is no separate scheduler daemon to supervise, and inventing one would
be a second execution pipeline.

| Service | Owner | Persistence |
|---|---|---|
| **SynthOS Admin** — HTTP API, UI, scheduler, Guardian, Aegis, model router, Brain access | `com.synthos.admin` LaunchAgent | Starts at login, restarts on crash |
| **Hermes gateway/runtime** | `ai.hermes.gateway` LaunchAgent | Already persistent; not modified here |
| **Ollama** | `homebrew.mxcl.ollama` LaunchAgent | Pre-existing |

Two consequences, both deliberate:

- Killing the admin process stops the scheduler with it. That is correct — they are the same
  process — and the scheduler row in the status report says so rather than implying otherwise.
- The Hermes *gateway* being up is **not** the same fact as SynthOS being able to reach Hermes.
  See §7.

## 2. Files

| Path | Role |
|---|---|
| `~/Library/LaunchAgents/com.synthos.admin.plist` | The service definition |
| `scripts/synthos-admin-service.sh` | Launcher: preflight, config, exec |
| `~/.synthos/synthos-admin.env` | Configuration and secrets, mode 0600 |
| `~/Library/Logs/synthos/admin.log` | stdout |
| `~/Library/Logs/synthos/admin.error.log` | stderr |

Secrets live in the env file and nowhere else — not in the plist, not in argv, so they never appear
in `ps`. The launcher re-asserts mode 0600 on every start.

## 3. Operating it

```bash
# Status
launchctl list | grep com.synthos.admin        # -> PID  last-exit-code  label

# Restart (after changing the env file, or pulling code)
launchctl kickstart -k gui/$(id -u)/com.synthos.admin

# Stop until next login
launchctl bootout gui/$(id -u)/com.synthos.admin

# Start again / install after editing the plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.synthos.admin.plist

# What it thinks of itself
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/ready | python3 -m json.tool

# Logs
tail -f ~/Library/Logs/synthos/admin.log
```

## 4. Crash versus misconfiguration

These are different failures and launchd cannot tell them apart, so the launcher does it:

- **A crash** — SIGKILL, an uncaught throw, the OS reclaiming memory — exits non-zero. launchd
  restarts it, with `ThrottleInterval` 30s as the floor between starts. Verified by `kill -9` on
  the server process: launchd restarted it and `/health` answered 200 within five seconds.
- **A misconfiguration** — missing Node, missing repo, unwritable database, or port 3000 already
  held by something else — makes the launcher log the reason and **exit 0**. Because `KeepAlive` is
  `{SuccessfulExit: false}`, launchd does **not** retry. A bad config produces one clear log line,
  not a restart loop.

A deliberate stop is also exit 0: the server's SIGTERM handler drains in-flight requests and
checkpoints the SQLite WAL, so `launchctl bootout` stays booted out.

## 5. Loopback only

`HOST=127.0.0.1` in the env file makes the server bind loopback, enforced at the socket rather than
by a firewall rule someone has to remember.

Worth knowing, because it was a real hole: Vite's `hmr: false` does **not** stop Vite opening a
websocket server. In middleware mode with HMR off, Vite still created its own listener on port
24678 bound to *every* interface — so the admin was correctly on 127.0.0.1 while a websocket port
sat open on the local network beside it. Only `server.ws: false` closes it. `DISABLE_HMR=true` now
sets both, and when HMR is wanted it is pinned to loopback.

Check it with:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E '3000|24678'   # expect ONE line: 127.0.0.1:3000
```

## 6. Execution mode

`SYNTHOS_SERVICE_MODE` in the env file:

- **`development`** (default) — `tsx` + Vite middleware with HMR and file watching off. This is
  the configuration already proven on this machine, and it changes nothing about authentication.
- **`production`** — serves the prebuilt `dist/` bundle. One process instead of two, less memory,
  faster page loads. Run `npm run build` first.

The reason production is not the default is specific and worth fixing later: `NODE_ENV=production`
also makes the session cookie `Secure` (`server.ts`, `setSessionCookie`). Chrome and Firefox accept
a Secure cookie over `http://127.0.0.1`; not every browser reliably does. Switching the default
without confirming a real login would risk locking the owner out of an unattended service. The
underlying issue is that the cookie's `Secure` flag is keyed to `NODE_ENV`, which is not a property
of the transport — worth correcting on its own terms, not as a side effect of a deployment change.

Development mode also leaves the dev-only terminal routes enabled (ADR-007 — they 403 in
production). They require authentication and are loopback-only, but that is a real difference
between the two modes.

## 7. What is up, and what is merely running

| Subsystem | Reality |
|---|---|
| Admin, scheduler, Brain store, Guardian, Aegis | In-process and reporting `HEALTHY` from real probes |
| Hermes gateway | Running as its own LaunchAgent, healthy, since login |
| Hermes **as seen by SynthOS** | `NOT_CONFIGURED` — and it cannot currently be configured |

`HERMES_ADAPTER_BASE_URL` wants an HTTP endpoint. The local Hermes gateway **listens on no TCP
port** — it is a process-based gateway, not an HTTP service — so there is nothing on this machine
for that variable to point at. Setting it to a guess would turn an honest `NOT_CONFIGURED` into a
fabricated `FAILED`. Closing this needs a real adapter endpoint, which is work, not configuration.

## 8. Status vocabulary

The repo's status words map onto plain operational language like this:

| Repo | Meaning |
|---|---|
| `HEALTHY` | ONLINE — proven by a probe that ran |
| `DEGRADED` | Working but impaired, or armed but stalled |
| `NOT_CONFIGURED` | UNCONFIGURED — implemented, no credential or endpoint |
| `FAILED` | OFFLINE — tried and did not work |
| `UNKNOWN` | Configuration present, health not proven |
| `NOT_IMPLEMENTED` | No implementation exists in this repo |

`NOT_IMPLEMENTED` is reserved, and `test/always-on-runtime.test.ts` enforces it: any row claiming
it must be on a short allowlist with a test proving the implementation really is absent. MCP was
mislabelled this way and is now `NOT_CONFIGURED` — the probe is implemented, it has simply never
been pointed at a server.
