# Admin repair, deployment topology and key revocation (2026-09-18)

Code: `5fc1d2d` and `3b60027`. No inference, provider-model, paid, qualification or discovery call was made. No legacy
task was mutated, and the ambiguous task was **not** resolved. Qwen stays disabled; local, paid and Antigravity
execution stay OFF.

## 1. Deployment topology

| | SynthOS Admin (hosted) | SynthOS Admin (operator's Mac) | Public website |
|---|---|---|---|
| URL | https://admin.getsynthos.com | http://127.0.0.1:3000 | https://getsynthos.com |
| Repository | `jhrzic/synthos-admin` (public) | same | `jhrzic/synthos-site` (private), folder `website/` |
| Host | GCE VM `synthos-core-01` (us-east1-b, project `gen-lang-client-0269921691`, 34.148.246.249), docker compose project `synthos-admin`, Caddy 2 for TLS | launchd `com.synthos.admin` (`scripts/synthos-admin-service.sh`), development mode (`tsx server.ts`) | Netlify site `getsynthos` (`f761be61-a715-4aec-9e0f-b5ef1f86167e`, team CatandMouse) |
| Deployment trigger | **manual**: `scripts/deploy-admin-vm.sh <commit>` (added here). There is no CI deploy | launchd restart | **manual** Netlify CLI deploy. No Git connection and no build command (`build_settings` empty) |
| Build | `git archive <commit>` on the VM → `docker build` with build-identity args → `docker compose up -d --no-build` | none (source) | none (static files) |
| Database | its own SQLite volume `synthos-admin_synthos-data`, **separate from the Mac's** | `data/synthos-admin.db` | none |
| Before this pass | `main@06088f9` (2026-09-08), hand-built 2026-09-13, 86 commits behind the canonical branch | canonical branch | deploy `6a7e55cd…` of 2026-08-13 |
| Now | `3b60027` (verified via `/api/ready`: tree CLEAN, source DEPLOY_ARCHIVE, environment production) | `3b60027` (LAUNCHER_GIT, environment local) | **unchanged**, not deployed (see §8) |

- **Separate deployments.** `getsynthos.com` is the marketing site; the Admin is a separate deployment on its own
  subdomain. Nothing indicates the Admin belongs on `getsynthos.com`.
- **Caching.** There is no CDN or service worker in front of the Admin. Caddy serves `index.html` with
  `max-age=0`, and Vite asset names are content-hashed, so no stale bundle is possible. Netlify serves the site
  with `max-age=0, must-revalidate`. No feature flag hides any UI.
- **VM local edits** (preserved, not part of the image):
  - `docker-compose.yml`: port bound to loopback, plus a caddy service;
  - an untracked `Caddyfile`;
  - a `.env` holding only `NODE_ENV`, `APP_URL` and `PORT`. There are no provider credentials, so the hosted
    Admin cannot spend.

### Root cause of the localhost / hosted drift

1. **Old code.** The VM built `main`, and the canonical branch `checkpoint/synthos-autonomous-runtime-2026-09-17`
   was never merged: 86 commits.
   - `06088f9` has no `lib/registry/` at all: no model registry, families, canonical router, qualification or
     spend guard.
   - Its Vault is the cut-down list from `cd60d81`. The mesh restoration `3cfcac8` (2026-09-10) is not an
     ancestor of `06088f9`.
   - These features were **absent from the deployed source**, not merely undeployed builds of it.
2. **Separate, empty database.** The VM has 1 user, 1 workspace and no tasks, registry tables, skills or vault
   notes. After the deploy the registry provisioned itself from bundled manifests with 0 provider calls. It now
   lists 65 routes against localhost's 67; the difference is the operator's local imports and approved Qwen
   mapping. No local data was copied to the VM.

## 2. Build identity

- **Where it shows.** `/api/ready`, Diagnostics (Diagnostics & Build) and the rail footer now report commit,
  build time, **environment** and **deployment name**.
- **Admin sources:**
  - `SYNTHOS_ENVIRONMENT`, else `NODE_ENV`;
  - `SYNTHOS_DEPLOYMENT_NAME`;
  - the Dockerfile build args;
  - the launcher's defaults (`local`, `localhost (launchd com.synthos.admin)`).
  - Anything unstamped reads UNKNOWN.
- **Website.** `scripts/deploy-site.sh` (site repo, branch `fix/provider-neutral-routing-copy`) writes
  `/version.json` with commit, builtAt, environment and site. It does not exist live, because the site was not
  deployed.

## 3. Reconciliation of ambiguous executions

`reconcileAmbiguousExecution` (`lib/continuity/orphans.ts`) is the one operator action for
`RECONCILING_UNKNOWN_EXECUTION`. Continuity-managed tasks delegate their state change to `resolveUnknownSegment`,
so there is still one reconciliation system.

| Finding | Task becomes |
|---|---|
| PROVIDER_CONFIRMED_COMPLETED | INCOMPLETE: the output never reached SynthOS; never DONE |
| PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE | INCOMPLETE |
| PROVIDER_CONFIRMED_FAILED | FAILED |
| PROVIDER_CONFIRMED_NO_REQUEST | CANCELLED; nothing is re-run |
| EVIDENCE_INCONCLUSIVE | stays RECONCILING_UNKNOWN_EXECUTION; the evidence is recorded |

- **Access:**
  - POST needs workspace admin, an explicit confirmation, and the task in that workspace.
  - GET needs workspace membership.
- **Required evidence:** source, a UTC window that contains the dispatch, provider, the task's own dispatched
  model, the dashboard finding and a note.
- **Optional evidence:** a response id (COMPLETED/FAILED only) and usage figures (not for NO_REQUEST or
  INCONCLUSIVE). Both are stored only as *operator-reported*.
- **Records:** one activity event and one `EXECUTION_RECONCILED` admin-audit record per submission. The same
  submission twice changes nothing. Conflicting later evidence must be an appended correction naming the latest
  event.
- **Never created:** no artifact, review, receipt or ledger row is ever created, and nothing is retried.
- **Where it appears:**
  - Queue Review (Diagnostics → Queue Review), the canonical server task list;
  - Task Detail;
  - the Activity Ledger, which now reads the server's `activity_events` (it had shown a browser-local list seeded
    with an invented event).
- **This task.** The guide shown live for `task-restart-1789678099` is derived from its records:
  - window `2026-09-17T20:48:27.969Z → ~20:50:00Z`;
  - OpenAI, `POST /v1/responses`, `gpt-5.6-terra`;
  - the exact instruction;
  - exclude `task-restart2-1789678410` at 20:53:37Z.
- **No finding submitted:** 0 reconciliation events and 0 reconciliation audit records exist. Activation stays
  blocked until John records the dashboard result through this action.

## 4. Navigation

`src/navigation/canonical-nav.ts` is the only definition. It feeds the desktop rail, the mobile drawer (the same
component), the command palette and the workspace top-bar labels.

**What was wrong:**
- Eight independent hand-written lists.
- The same destination under different names:
  - `agent-fleet` was "Agent Fleet", "Agents" and "Open Workforce Overview";
  - `guardian-aegis` was "Approvals" twice and "Governance", while the real Approval Queue was a different entry.
- Graph Runs, Approvals and Receipts were each listed twice.
- No Model Registry, Tools or Scheduler entry in the deployed build.
- The Hermes workspace's "Overview" opened the **Antigravity** agent.
- The `hermes` tab rendered two screens stacked.
- No URLs at all.
- `platform_role` was never used.

**What changed:**
- An AGENTS group: Agent Registry, Skills, Tools, Model Registry and Model Router.
- Agent Detail is a nested route (`#/agents/<role>`) that lights up Agent Registry.
- Placeholder agents are not navigable.
- Every destination has a hash deep link; there were no earlier URLs to break.
- Platform-admin items are hidden from standard users. The server still authorizes every API.
- DOM ids stay `nav-<tabId>`, so the first-run tour keeps working.

**Why localhost and hosted differed:** the hosted Admin ran `06088f9`, which predates all of the above.

## 5. Obsidian Vault graph

- **The original exists** (`ObsidianGraphMind`, 1,118 lines, in HEAD since `3cfcac8`). It was not deployed:
  missing from the deployed source, per §1.
- **On localhost** it was hidden by an empty-state check that ignored the source filter. The Brain has 1 note,
  and the 155 external notes could not be shown.
- **Fixes:**
  - The empty state is now per source.
  - Reduced motion gives a settled still frame.
  - The loop stops while the tab is hidden or the graph is off-screen.
  - Sizing uses ResizeObserver; `ctx.scale` had compounded on every resize.
  - A static fallback appears when there is no canvas.
  - New data repaints while paused.
- **Verified:**
  - on localhost, with all 156 notes and 22 links drawn;
  - in the production bundle (`dist/assets/index-*.js` contains the graph, the fallback and reduced-motion paths);
  - on the hosted Admin, which shows the truthful empty state because its vault has no notes. Nothing was seeded.

## 6. Model registry visibility

The Model Registry is its own destination (`ProviderModelCatalog`).

- **Fields shown per route:**
  - provider, family, canonical version, route kind and deployment;
  - mapping status and admin state;
  - credential/endpoint configuration and metadata provenance;
  - price with approval and stale-after date;
  - qualifications by class;
  - every blocker.
- **Read failures** show as errors, not an empty registry.
- **No hardcoded names.** The one hardcoded model name (an input placeholder) was replaced, and a test fails on
  any model name in an `<option>`.
- **Rendering is local only:** local registry reads, no polling, no external calls.
- **Aggregator offerings** stay under "Unmapped — cannot run" until mapped.

## 7. Skills

The authority is the `skills` table via `lib/skills.ts` and `/api/skills*`.

- **Skill record.** Every field is shown. Owner, compatible agents and I/O contract read **NOT RECORDED**: the
  authority does not hold them, and nothing is inferred.
- **Empty states are distinguished:** none installed, not accessible (401/403), and failed to load.
- **Cross-links:** a skill links to Agent Registry and Tools, and Agent Detail links to Skills. Agents do not
  declare skills, and the page says so.
- **Discover route.** `/api/skills/discover` stays public by the recorded design (`test/api-security-routes`).
- **Current contents.** Both Admins have 0 installed skills.

## 8. Public website (`getsynthos.com`) — not deployed; John's decision needed

- **The model names were stale.** They were hand-written illustrative copy (Claude Opus 5, Claude Sonnet 4.6,
  Claude Haiku 4.5, Gemini 3 Pro, GPT-5.2) in `index.html`, `app.js`, `use-cases.html` and `mission-control.html`,
  not generated from any registry.
- **Replacement.** Provider-neutral language describing what the router enforces, on branch
  `fix/provider-neutral-routing-copy` (`eb897ea`, pushed, not merged).
- **Why it was not deployed.** Deploying the site would also publish `4f52bfa` (2026-08-22, never deployed).
  That commit makes the contact form post through `netlify/functions/public-intake.mjs`, which returns 503
  unless `MISSION_CONTROL_PUBLIC_URL` is set, and that variable is not set on the Netlify site. The site repo
  also has uncommitted work that is not part of this change.

**Manual action for John:**
1. Set `MISSION_CONTROL_PUBLIC_URL` on the Netlify site, or decide to revert `4f52bfa`.
2. Merge the branch.
3. Run `scripts/deploy-site.sh` from the site repo. It publishes one committed tree and refuses the unsafe case.

## 9. Revoked signing key

- **The registry.** `REVOKED_RECEIPT_SIGNING_KEYS` (`lib/persistence.ts`) holds only the public fingerprint:
  `sha256:7adbc0bb09b99bf93ad57a4ee29069592824ebdc56b1cdc3a4f0e169832cd6ab` (SPKI DER).
  - Reason, discovered 2026-09-18, commits `0e09586`/`e2fd065`/`7b07203`, all scopes.
  - Verification rejects it even with a valid signature and a matching public key. It cannot sign.
- **Receipts.** All 52 production receipts verify; none uses the revoked key (they use `998cf62e…`). The
  current key was not rotated: there is no evidence it was exposed.
- **Public history.** The private key remains recoverable from the public history. No history rewrite was done.
- **GitHub secret scanning** (read with `gh api …/secret-scanning/alerts`; no state was changed):
  - **There is no alert for the Ed25519 key.** GitHub's scanner does not flag Ed25519 private keys.
  - **Alert #2** (Slack token, `test/redaction.test.ts`) is resolved as "used in tests".
  - **Alert #1 is OPEN:** a "Google API Key", publicly leaked, validity unknown, in `test/redaction.test.ts:20`,
    commit `5ee663f`. Evidence says it is a synthetic fixture: the redaction test's other cases use the same
    patterned values (`abcdefghij1234567890…`); the value is patterned; it equals no configured key (none is
    configured locally); and alert #2 from the same file was already resolved as a test fixture.
  - **Action for John:** close alert #1 as "used in tests" in GitHub → Security → Secret scanning. If there is any
    doubt, also confirm in Google Cloud that no key with that value exists. Nothing needs rotating on current
    evidence.
- **Scope of the earlier history audit.** It scanned database files and key/secret file names, not every source
  file. This alert was found by GitHub's own scanner, not by that audit.

## 10. Verification

| | Result |
|---|---|
| Tests | 2,645 / 2,645 across 162 files, at both default workers and 2 (before the last UI test was added: 2,641, twice) |
| Typecheck / build | clean / clean |
| Secret scan | FINDINGS: none |
| Dependency audit | 0 high; 1 moderate (unchanged) |
| SBOM | 456 components |
| CI | `5fc1d2d` run 35379750871 green; `3b60027` run 35381207240 green |
| Hosted Admin sweep | all 15 destinations render with the correct active state; 0 console errors; every request HTTP 200 and same-origin (plus Google Fonts) |
| Mobile layout | **not visually verified**: the automation browser window is minimized, so it could not be resized. The drawer is the same component, covered by render tests |

**Production invariants (operator's database, after all work):**
- ledger 14, provider events 7;
- 1 qualification (VALID, `literal_transformation`); Qwen disabled;
- paid, local, Antigravity, discovery and route refresh all OFF;
- 31 legacy tasks, fingerprint `7c36dac0…` unchanged;
- `task-restart-1789678099` still RECONCILING with 0 ledger rows;
- 94 tasks, 53 reviews, 52 receipts (all verify), 58 artifacts;
- quarantined artifact still excluded;
- schema version 2.

**Hosted Admin database:** 0 tasks, 0 ledger rows, 0 provider events, 0 qualifications, no model enabled,
default switches (all execution OFF).

### Found and left for a decision (not fixed here)

- **The Tasks board is browser-local.** It uses localStorage and is not the server task table, as already
  recorded in `docs/UI-IA-AUDIT.md`. Fresh browsers no longer get invented tasks, and Agent Detail labels its
  list, but the board needs a server-backed data layer.
- **Agent definitions are hardcoded.** `src/data/agentDefinitions.ts` includes invented statistics. The status
  selector is now labelled as an operator label.
