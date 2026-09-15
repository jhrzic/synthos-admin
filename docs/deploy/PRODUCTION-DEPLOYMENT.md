# Production Deployment — the first-customer gate

**Status as of 2026-09-12:** every application-side precondition is **closed and proven**. The
remaining work is **host provisioning, which requires actions only the account owner can take.**
See "BLOCKED — USER ACTION REQUIRED" at the bottom for the exact list.

`CAN_WE_ONBOARD_A_FIRST_REAL_WEB_CUSTOMER` is still **YES, CONDITIONAL**. This document is what
converts it, and it names precisely who has to do what.

---

## 1. Why not Netlify, Vercel, or Cloud Run

This is a storage-model constraint, not a preference, so it is worth stating once and not
relitigating. The application keeps durable state on a filesystem:

| What | Where | Why it cannot be ephemeral |
|---|---|---|
| SQLite database (WAL mode) | `/app/data/synthos-admin.db` | Every workspace, user, conversation and lead |
| Vault artifacts | `/app/vault/` | The business's own knowledge, and every summary |
| Ed25519 signing keypair | `/app/data/keys/` | A new keypair means every previously issued receipt becomes unverifiable |
| Backups | `/app/backups/` | — |

Serverless platforms give each invocation an ephemeral filesystem. On Netlify or Vercel the
database, the customer's knowledge and the signed receipts would not survive between requests. That
rules them out **regardless of account or plan** — note that a Netlify account is already
authenticated on this machine, and it is still the wrong target.

**Any host with a persistent disk works.** A $6–12/month VPS is sufficient for the first customer.
So is a GCE/EC2 VM, Fly.io with a volume, or Render with a disk.

---

## 2. The deployment

Two files, both committed:

- `docker-compose.prod.yml` — the app plus Caddy, with real TLS
- `docs/deploy/Caddyfile.prod` — the reverse-proxy config it mounts

The app is deliberately **not** published to the host (`expose:`, not `ports:`), so there is no way
to reach it bypassing TLS. Caddy obtains and renews a real Let's Encrypt certificate.

```bash
# On the host, once:
#   1. Point DNS:  admin.your-domain.com  A  <host IP>
#   2. Ensure ports 80 and 443 are reachable from the internet (ACME needs both)

git clone <repo> && cd synthos-admin
cp .env.example .env      # fill in only what you use

cat >> .env <<'EOF'
SYNTHOS_DOMAIN=admin.your-domain.com
[email protected]
PUBLIC_BASE_URL=https://admin.your-domain.com
TRUST_PROXY_HOPS=1
EOF

docker compose -f docker-compose.prod.yml up -d --build
curl https://admin.your-domain.com/health     # -> {"status":"ok",...}
```

### The two settings that silently break the product if wrong

Both were previously easy to get wrong with nothing reporting it. Both are now reported at startup.

- **`PUBLIC_BASE_URL`** — the https origin used to build the `<script>` tag the customer pastes into
  their own website. Unset behind a TLS-terminating proxy, the app infers the origin per request
  and can infer `http`, producing a snippet **every browser blocks as mixed content**. The failure
  happens on the customer's site, silently. The startup log now prints `PUBLIC_ADDRESS: READY |
  DEGRADED | NOT_CONFIGURED | FAILED` and says which.
- **`TRUST_PROXY_HOPS=1`** — exactly one proxy (Caddy) sits in front. Trusting more lets a client
  forge `X-Forwarded-For` and defeat per-IP rate limiting; trusting none makes every request look
  like it came from Caddy. `docker-compose.prod.yml` sets it explicitly rather than leaving it to
  `.env`.

### A staging-certificate dry run

`Caddyfile.prod` carries a commented `acme_ca` staging line. Use it while getting DNS right — Let's
Encrypt's production rate limits will lock a domain out for a week if you loop on a failing
challenge. Uncomment, get a successful (untrusted) certificate, then comment it out and restart.

---

## 3. What was verified on 2026-09-12, and how

Run against a real `NODE_ENV=production node dist/server.cjs`, over real HTTP, with a real
throwaway database. Not unit tests, and not claims.

| # | Proof | Result |
|---|---|---|
| 1 | Production build | `npm run build` exit 0 |
| 2 | Startup reports the public address | `[Startup] PUBLIC_ADDRESS: READY — Public link and embed snippet will use https://admin.synthos-demo.example` |
| 3 | Liveness / readiness | `/health` → `{"status":"ok"}`; `/api/ready` → `ready: true`, every optional subsystem honestly `NOT_CONFIGURED` |
| 4 | First admin bootstrap | `POST /api/auth/setup` created a real `platform_admin`, auto-granted on the seeded workspace |
| 5 | Business configured | Real profile + one real knowledge artifact, FTS5-indexed (`indexed: true`) |
| 6 | Authorized-domain embed | `https://www.northfieldsleep.example` **accepted**; `http://insecure.example` **rejected** with a real reason. Origin validation is enforced, not cosmetic |
| 7 | **The embed snippet is https** | `<script src="https://admin.synthos-demo.example/a/embed.js" …>`, `publicBaseUrlSource: PUBLIC_BASE_URL`, `warning: null`, `embeddable: true` |
| 8 | **A real anonymous conversation** | Visitor asked about delivery → `GROUNDED_EXTRACTIVE`, answered from the business's own material, citing source *"Delivery policy"* |
| 9 | **An honest refusal** | Visitor asked a price that was never published → `NO_KNOWLEDGE`. It did not invent a figure: *"I won't quote a figure I can't stand behind."* |
| 10 | Unanswered-question capture | The unanswerable question was recorded as `OPEN` for the owner to answer |
| 11 | **Aegis + Ed25519 receipt** | Summary produced `aegisDecision: VERIFIED`, `receiptId: rcpt-…`. The signature was then verified **independently of the application**: 64-byte Ed25519, `crypto.verify` → `true` on the real payload and **`false`** on a one-word tamper |
| 12 | Graceful shutdown | SIGTERM → scheduler stopped → in-flight drained → WAL checkpointed → exit **0** |
| 13 | Data survived | After shutdown: 1 profile, 1 conversation, 5 messages, 1 unanswered question, 1 receipt, 1 quality review, 2 artifacts. `-wal`/`-shm` folded into the main file and gone |
| 14 | Full suite | **1,284 passed / 79 files, exit 0 — six consecutive green runs** (was 1,268 / 77) |

### A note on suite stability, because the first number was wrong

An early conclusion in this pass — "the baseline is stable 3/3, so this pass introduced a flake" —
was drawn from too small a sample and is withdrawn. Running the **untouched** baseline six times
produced **two failures**, both `test/backup.test.ts > lists a real created backup with its real
size`, both the same pre-existing `listBackups` ENOENT race fixed in §4 below. The suite was already
intermittent; it was not reported as such.

Two separate causes were found and fixed rather than averaged away:

1. **A real bug** — `listBackups()` did `readdirSync` then `statSync` with no ENOENT handling, so one
   vanished archive threw and took down the entire listing. Fixed, with a regression test that uses a
   dangling symlink to reproduce the condition deterministically (verified to fail without the fix).
2. **A time budget, not an assertion** — several files spawn real servers, run real concurrent HTTP
   requests, build real tar archives and do real Ed25519 signing across parallel workers. Vitest's
   5s default per-test timeout is simply too tight for that, so a correct test could fail purely by
   waiting for CPU. `vite.config.ts` now sets `testTimeout`/`hookTimeout` to 20s. **No assertion was
   changed** — a genuinely hung test still fails, 20s later. Loosening the concurrency assertions
   themselves would have hidden real defects, which is the opposite of what this suite is for.

One further self-inflicted issue was found and removed in passing: this pass's own shutdown test
initially spawned servers with the repository as their cwd, and `BACKUP_ROOT`/`VAULT_ROOT` are fixed
relative to `process.cwd()` — so those servers wrote into the repo's real `backups/` and `vault/`
directories and raced `backup-restore-drill.test.ts`. The spawned server now gets its own cwd, which
isolates all four state roots rather than only the two that have environment overrides.

**What this does not prove:** that the app is reachable from the public internet over a real
certificate on a real domain. Nothing local can prove that. It is the one thing item 15 below is
for, and it is not claimed here.

---

## 4. Application-side gaps closed in this pass

| Gap | Was | Now |
|---|---|---|
| No graceful shutdown | SIGTERM cut in-flight requests; WAL left stranded (this repo's own working copy carries a 4 MB `-wal` against a 1.3 MB db) | Ordered drain, WAL `TRUNCATE` checkpoint, 8s self-imposed force-exit. 4 real process tests |
| `PUBLIC_BASE_URL` undeclared | Read by `lib/public-url.ts`, declared nowhere — invisible to the startup summary, `/api/ready` and the readiness panel | Declared, validated, and reported at startup in all four field configurations |
| 17 further env reads undeclared | Including 5 SECRET credentials (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `NOUS_API_KEY`, `TELEGRAM_BOT_TOKEN`) | All declared, each stating whether it *executes* or is only *reported* |
| `.env.example` drifted | Missing 8 real variables, offering 1 dead one (`APP_URL`) | Regenerated from the specs; a drift guard now fails the build both ways |
| No Node version pin | — | `engines: node >=22.5.0` (the app's database is `node:sqlite`) |
| No HTTPS deployment config | `docker-compose.yml` served plain http on :3000 | `docker-compose.prod.yml` + `Caddyfile.prod` |

**One correction to a documented claim.** `docs/IMPLEMENTATION-STATUS.md` said
`buildEnvReadinessReport()` "classifies every env var this codebase reads." That was false for 18
variables. It is true now, and `test/env-spec-completeness.test.ts` keeps it true by failing the
build on the next undeclared read — which is the actual fix; the 18 declarations are just today's
backlog.

**Not a model-provider change.** `SUPPORTED_MODEL_PROVIDERS` is still `['gemini']`. Declaring
`ANTHROPIC_API_KEY` documents a variable that is *reported*; it wires nothing, and setting it does
not enable Claude. Noted because the opposite reading would be exactly the kind of drift this
repo's rules exist to stop.

---

## 5. BLOCKED — USER ACTION REQUIRED

Everything above is done. These five items cannot be completed from a coding environment, because
each requires an account, a payment, or control of a domain.

| # | Action | Why it is yours | Blocks |
|---|---|---|---|
| 15.1 | **Provision a host with a persistent disk.** A $6–12/mo VPS is enough. Install Docker. | Requires an account and a payment method | Everything below |
| 15.2 | **Point DNS at it.** `admin.<your-domain>` A → host IP. Confirm ports 80 and 443 are open. | Requires control of the domain | TLS issuance |
| 15.3 | **Set `SYNTHOS_DOMAIN`, `SYNTHOS_ACME_EMAIL`, `PUBLIC_BASE_URL`** in `.env` on the host | Depends on 15.2 | The embed snippet |
| 15.4 | **Supply `GEMINI_API_KEY`** — *optional.* Without it the assistant still works and answers accurately by quoting published material (`GROUNDED_EXTRACTIVE`, proven above); replies read like documents rather than conversation. | Your credential and your spend | `LLM` phrasing mode only |
| 15.5 | **Top up Fish Audio** — *only if voice is part of the offer.* `FIRST-CUSTOMER-RUNBOOK.md` records the account's paid balance as exhausted. | Your account and your spend | Spoken replies only |

**Docker was not installed in this environment**, so `docker build` was never executed here. The
Dockerfile predates this pass and remains **UNVERIFIED at runtime** — run `docker compose -f
docker-compose.prod.yml build` once on the host and confirm before relying on it. The compose files
are YAML-valid; that is a syntax check, not a build.

### What to send back to close this

Three things, and Day 1 is genuinely done rather than conditionally done:

1. `curl -i https://<your-domain>/health` — showing a real certificate and `{"status":"ok"}`
2. The `[Startup] PUBLIC_ADDRESS:` line from the host's logs — it must read `READY`
3. One real conversation on the deployed instance

Until those exist, the honest external wording stays: **shippable, not shipped.**
