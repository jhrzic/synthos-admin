# One canonical control plane (2026-09-18)

Code: `2a0322b` (a security fix) and `f895bb6` (authority, gateway, Tasks, Agents), plus this record. No inference,
provider, qualification or discovery call was made. No task, receipt, ledger row, review or qualification changed.
The Qwen route stays disabled.

## Before: two independent control planes

| Authority | Operator's Mac (launchd `com.synthos.admin`) | GCE `synthos-core-01` (docker `synthos-admin`) |
|---|---|---|
| Process | `tsx server.ts` (development mode), 127.0.0.1:3000 | `node dist/server.cjs` in a container behind Caddy |
| Database | `data/synthos-admin.db`, schema v2 | volume `synthos-admin_synthos-data:/app/data/synthos-admin.db`, schema v2 |
| Records | **94 tasks**, 365 status rows, 429 activity events, **14 ledger rows**, 7 provider events, **1 qualification**, **53 reviews**, **52 receipts**, 58 artifacts, 52 memory-index rows, 67 registry routes, 10 schedules, 4 users, 24 sessions | 0 tasks, 0 receipts, 0 ledger rows, 0 qualifications, 65 registry routes, 1 user, 1 session |
| Scheduler | running (writes tasks and schedule occurrences) | **running** (a second scheduler, over an empty database) |
| Signing key | `998cf62e…`: signed all 52 receipts | **`d210f8db…`**: a second signing authority, generated on start, never used |
| Spend policy | saved (paid OFF, local OFF) | defaults (never saved) |
| Credentials | encrypted OpenAI credential and voice credential, plus their keys, on the Mac | encrypted voice credential only; `.env` holds NODE_ENV, APP_URL and PORT |
| Vault / Brain | external Obsidian vault (157 notes), 7,992 artifact files | local fallback, 0 files |
| Local models | Ollama (`qwen2.5-coder:14b`, `hermes3:8b`) | none |
| Backups | `backups/` (359 files) | none |
| Classification | **production** (the real operational state) | **empty duplicate**, holding production-shaped data |

**Consequence if both copies keep accepting writes:**
- **Two sources of truth:** tasks, qualifications, receipts and users would diverge, with no reconciliation between
  them.
- **Duplicate schedulers:** a task could be dispatched by either one.
- **Two signing keys:** receipts from either key would look equally valid.
- **Two login systems:** there would be two sets of credentials for the same operator.
- **What was already happening:** the hosted Admin presented an empty, "healthy" system as if it were SynthOS.

## Decision: the Mac stays canonical; admin.getsynthos.com becomes a gateway (option B)

| | A. GCE canonical + Mac execution node | **B. Mac canonical + hosted gateway (chosen)** |
|---|---|---|
| Data migration | Move 94 tasks, signed receipts, the private signing key, 4 users' password hashes, encrypted credentials plus their keys, and the vault | **None**: the canonical database never moves |
| Local models | Needs a new remote-execution protocol (claim, dispatch, idempotent evidence return) that **does not exist** in this code | Ollama already runs next to the canonical scheduler |
| New infrastructure | Execution-node protocol, key migration, vault sync | Existing gcloud / OS Login SSH, and the existing Caddy |
| Security | Private key and credentials leave the operator's machine | Nothing leaves. SSH provides mutual authentication, encryption and replay protection, and the Admin authenticates every request |
| Duplicate execution | Two processes would coordinate claims across the network | One scheduler, one process |
| Offline behaviour | Hosted UI up, but local execution unavailable when the Mac is off | Hosted UI shows **CONTROL PLANE UNREACHABLE** (fail closed) when the Mac is off |
| Cost | A larger VM (a database, vault storage) | The existing e2-standard-2 now runs only Caddy |
| Future client workspaces | Better: an always-on host | Adequate for the beta: one operator plus manual provisioning. Revisit when a client needs 24/7 access (see below) |

**Option C was not viable.** The repository has no other supported remote mechanism. Hermes' `execute()` is an honest
stub, and Windmill runs external scripts rather than acting as a control-plane replica. No federation or
synchronization was invented.

## After: one authority per category

| Category | Canonical owner | Other copies |
|---|---|---|
| Every category in `lib/control-plane-authority.ts` (workspaces/auth, tasks, scheduler, registry, qualifications, spend policy and ledger, Guardian, execution claims, provider credentials, local model runtime, Aegis reviews, receipts and signing key, Vault/Brain, artifacts, memory index, backups) | the operator control plane, `data/synthos-admin.db` | none that accept writes |
| admin.getsynthos.com | **gateway**: Caddy with a fixed upstream `127.0.0.1:18080` (the SSH reverse tunnel from the Mac); no application, no database | — |
| Archived GCE instance | container **stopped**. Volumes kept untouched; a verified copy is at `~/archive/gce-admin-archived-2026-09-18.db` on the VM. **Its signing key is revoked** (`REVOKED_RECEIPT_SIGNING_KEYS`), so it can never issue a receipt that verifies | read-only archive |

**How the gateway works:**
- The Mac runs `scripts/synthos-gateway-tunnel.sh` under launchd (`com.synthos.gateway-tunnel`, KeepAlive). It
  opens an outbound SSH connection with `-R 127.0.0.1:18080:127.0.0.1:3000`, exposing nothing on any public
  interface.
- The VM runs Caddy from `docs/deploy/gateway/` (host network, the existing TLS certificate volumes). Caddy validates
  its config before any switch.
- The VM's sshd binds forwards to loopback only (`gatewayports no`) and reaps dead sessions (keep-alive 120 s × 3).

**Security, request by request:**
- TLS terminates at Caddy.
- SSH (mutual key authentication, encryption, replay protection) carries each request.
- The Admin's own session, workspace authorization, same-origin checks, rate limits and audit apply.
- The session cookie is Secure on requests that arrive over TLS.
- There is no credential forwarding and no configurable upstream.

**Verified live on 2026-09-18:**
- `/api/authority` through the gateway reports the canonical control plane at `f895bb6`, access path GATEWAY, and
  database fingerprint `sha256:2e21e688…`, the same as the Mac.
- An unauthenticated `/api/tasks` returns 401.
- With the tunnel stopped: the page returns 503 **CONTROL PLANE UNREACHABLE**, and `/api/*` returns 503
  `{"controlPlane":"UNREACHABLE"}`. With it restored: 200.

**Also changed in the canonical service:**
- **Security fix.** Development mode served the whole database at `/data/synthos-admin.db` with a CORS wildcard
  (`2a0322b`). The service now runs the **production bundle**: `SYNTHOS_SERVICE_MODE=production`, with the earlier
  env file kept as `~/.synthos/synthos-admin.env.bak-2026-09-18`.
- **Identity.** It reports "canonical control plane (launchd com.synthos.admin)", production.
- **Scheduler kill switch.** `SYNTHOS_SCHEDULER_DISABLED=1` now exists; it is used by every verification copy.

**Proof nothing changed** (SHA-256 prefixes, live database vs the verified pre-gateway backup
`backups/pre-gateway-2026-09-18/canonical-synthos-admin.db`, integrity `ok`, `7b82fc18…818b`):

| Table | Live | Backup |
|---|---|---|
| receipts | `0463ca700ac3` | `0463ca700ac3` |
| provider_usage | `d69027c5910f` | `d69027c5910f` |
| quality_reviews | `74f032c5af11` | `74f032c5af11` |
| authority_ledger | `ea5bf9bc7507` | `ea5bf9bc7507` |
| registry_qualifications | `844205378b74` | `844205378b74` |
| task ids and creation times | `8891cb30d4be` | `8891cb30d4be` |
| status history (before the gateway) | `050f2bb1c6d0` | `050f2bb1c6d0` |

## Admin views on the canonical data

- **Authority banner and fail-closed gate on every view.** The banner shows identity, access path, database/schema,
  runtime SHA, last verification and read/write state. If the control plane is unreachable, the views are
  replaced, never shown as zeros.
- **Tasks.** `GET /api/tasks` returns the canonical records, read-only. The browser-local Kanban board and its
  invented starter tasks are gone from production.
- **Agents.** `GET /api/agents` lists the 14 roles the task record has assigned work to, with real counts; everything
  else reads NOT RECORDED. There is no agent registry. The hardcoded personas and invented statistics are not
  rendered.
- **Skills.** 0 installed and 0 enabled. No SynthOS skill definitions exist; see `docs/skills/SKILL-MANIFEST-SPEC.md`.

## Known limits and next steps

- **Availability follows the Mac.** When it sleeps or is off, the hosted Admin says so. Before any client needs 24/7
  access, move to option A with a real execution-node protocol, or run the canonical control plane on an always-on
  host.
- **Operator login.** The operator logs in on admin.getsynthos.com with the **Mac** account. The archived GCE account
  no longer exists anywhere that serves requests.
- **Gateway access log** is at `/data/gateway-access.log` in the gateway's Caddy volume.
