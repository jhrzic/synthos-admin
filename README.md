# SynthOS

SynthOS is a governed agentic business operating system. It combines persistent
business knowledge, model and tool orchestration, policy enforcement,
autonomous execution, verification, and signed evidence.

This repository is the SynthOS Admin control plane: a persistent, localhost-only
runtime that holds the Brain, the Execution Fabric, and the governance layers.

Two invariants hold everywhere in this codebase, and most of the architecture
exists to enforce them:

> **Observation ≠ Knowledge** — something being read, retrieved or generated does
> not make it knowledge. Admission is a separate, gated step.
>
> **Knowledge ≠ Permission** — knowing a thing is true does not authorise acting
> on it. Authority is a separate, gated step.

---

## Architecture

### Brain — *it knows*

Persistent business knowledge, memory, source retrieval and context.

The Brain holds canonical knowledge notes, a memory index, and a read-only
projection of external source material. Retrieval is scoped: a query can run
against canonical knowledge only, external sources only, or both, and results
carry which of the two they came from.

### KIL — *it learns*

The Knowledge Integrity Layer is the admission gate. Observations are recorded
with an evidence score and a confidence score; promotion to knowledge requires
clearing a threshold. Nothing is promoted implicitly.

- Promotion threshold: **0.85** (`PROMOTION_THRESHOLD`, `lib/kil.ts`), plus a
  separate quality floor on evidence.
- Observations that fail the gate are recorded as blocked, not discarded and not
  quietly promoted.
- The Admin surfaces the real counts, including how many observations were
  blocked and the resulting promotion rate.

### Guardian — *it permits*

The policy and authority layer. Guardian decides what an agent, tool or model
may do, and is consulted before any external action and before internal
mutations.

Guardian denial is not overridable by a human approval — the two are separate
checks and both must pass.

### Execution Fabric — *it does*

The single canonical execution path: task spine, capability resolution, tool
registry, model router, scheduler, and runtime dispatch.

Every capability goes through one envelope (`lib/fabric/envelope.ts`) and one
kernel. There is deliberately no second control plane, no parallel executor and
no alternate credential store.

Task lifecycle:

```
TODO → READY → RUNNING → AWAITING_VERIFICATION → AWAITING_RECEIPT → DONE
```

Effect classes are explicit per capability: `READ_ONLY`, `COMPUTE`,
`INTERNAL_MUTATION`, `EXTERNAL_ACTION`, `CONTROL`.

### Aegis / Receipts — *it proves*

Deterministic verification, artifacts, execution evidence and signed receipts.

Work that completes is verified by Aegis, committed as an artifact, and issued
an **Ed25519-signed receipt**. The receipt is the evidence record: it is what
makes a delivery claim checkable rather than asserted.

### Trust Protocol — *it connects*

**Not implemented.** This is the intended inter-system trust boundary for
SynthOS instances and external parties. No code for it exists in this
repository yet. It is listed here as architecture direction, not capability.

---

## Current verified capabilities

Everything in this section is present and exercised in the current tree. Status
qualifiers are deliberate — read them.

**Control plane**
- Persistent SynthOS Admin control plane, running as a managed background
  service, bound to loopback only.
- Workspace isolation enforced at the API layer, not by hiding UI.
- Strict TypeScript across the repository.

**Brain and knowledge**
- Brain projected onto a real Markdown/Obsidian vault on disk.
- Managed Brain content and read-only external sources kept separate, with an
  explicit boundary between them.
- Real graphical knowledge view driven by actual notes and authored wikilinks.
- KIL admission threshold enforced (0.85) with blocked observations recorded.

**Governance**
- Guardian policy enforcement.
- Human approval lifecycle: `WAITING_FOR_APPROVAL → APPROVED/REJECTED →
  execution`, with approvals bound to an exact input digest, single-use, and
  expiring.

**Execution**
- Canonical Execution Fabric (envelope → capability resolution → registry).
- Autonomous internal task progression: eligible internal tasks advance without
  a human copying prompts between tools.
- Scheduler and reconciliation loop, with atomic claims so a restart does not
  duplicate work.
- Model router.
- OpenAI live model execution — proven by real calls end to end. See status
  table below for current runtime state.

**Tool Pack 1** — 19 registered capabilities, each with a declared effect class
and approval policy:

| Group | Capabilities |
|---|---|
| Brain | `brain.search`, `brain.read`, `brain.read_source`, `brain.write_session_note` |
| GitHub (read-only) | `github.search`, `github.read_file`, `github.inspect` |
| Workspace files | `files.read`, `files.write_artifact` |
| Scheduler (internal) | `schedule.list`, `schedule.create_internal`, `schedule.pause`, `schedule.resume` |
| Research | `research.search`, `research.fetch` |
| Gmail | `gmail.search`, `gmail.read_thread`, `gmail.create_draft`, `gmail.send` |

The GitHub tools are read-only by construction — a single request helper with a
hardcoded `GET`. The Gmail capabilities are **registered but not enabled**: no
credentials are configured and no connection exists, so they cannot execute.
`gmail.send` is the only `EXTERNAL_ACTION` in the pack.

**Evidence**
- Aegis verification.
- Signed receipts (Ed25519).
- Provider truth ledger: every provider call is recorded with its real outcome
  and latency. Provider state reflects the last real call, including failures.

---

## Autonomous execution flow

```
Brain
  → Planner / Model Router
    → Guardian
      → Approval (when policy requires it)
        → Execution Fabric
          → Tool / Runtime
            → Aegis
              → Receipt
                → Brain
```

Internal eligible tasks now advance through this path on their own. The
scheduler picks up queued work, claims it atomically, and carries it forward —
there is no manual prompt transfer between steps, and a restart mid-task does
not produce duplicates.

External actions do not get this treatment. They remain governed by Guardian and
by explicit approval policy, and an approval is bound to the exact action and
inputs it was granted for.

---

## Brain and Obsidian

**The Brain is the knowledge and memory system. Obsidian is a human-readable
projection of it, not the authority.** Editing a note in Obsidian does not
promote it to knowledge, and the Brain does not treat the vault as canonical by
default.

The boundary inside the vault:

- `SynthOS/**` — managed Brain content. SynthOS writes only here.
- Everything else in the vault — **read-only external sources**. Observed, never
  modified, and not knowledge unless admitted.

Rules that hold:

- External sources are **not** automatically promoted into Brain knowledge.
- Author-written `[[wikilinks]]` are honoured as real relationships.
- No inferred, similarity-based or fabricated graph edges. A sparse Brain looks
  sparse.
- Links pointing at nothing are dropped rather than drawn.

The vault location is configured by environment variable. It is not hardcoded
and is not published here.

---

## Governance and approvals

- **Guardian is checked before external action**, and before internal mutation.
- **A human approval does not override a Guardian denial.** They are independent
  gates; both must pass.
- **Approvals bind to an exact input digest.** Change the action or its inputs
  and the existing approval no longer applies — the request re-enters the
  waiting state rather than executing under a stale grant.
- **Approvals are single-use and expire.** Statuses are
  `PENDING → APPROVED → CONSUMED`, with `REJECTED` and `EXPIRED` terminal or
  re-askable as appropriate. A consumed approval cannot authorise a second
  action.
- **Models, schedulers and graphs cannot self-approve.** Approval is a human
  decision recorded against an identity.

---

## Status

| Capability | Status |
|---|---|
| Brain / source retrieval | Verified |
| KIL admission (threshold 0.85) | Verified |
| Guardian | Verified |
| Approval lifecycle | Verified |
| Execution Fabric | Verified |
| Autonomous internal tasks | Verified |
| Scheduler / reconciliation | Verified |
| Aegis / receipts (Ed25519) | Verified |
| Tool Pack 1 (19 capabilities) | Verified |
| Provider truth ledger | Verified |
| Workspace isolation | Verified |
| Strict TypeScript | Verified — enforced repo-wide, 0 errors |
| OpenAI provider | Live — real successful calls recorded; most recent call failed on a 60s timeout, and the ledger reports that rather than hiding it |
| Gmail | **Not enabled.** Capabilities registered; no credentials, no connection. Next connector. |
| Hermes local runtime | **Disabled** (`HERMES_LOCAL_ENABLED=false`). Upstream broken; reports NOT_CONFIGURED / Offline. |
| Telegram | **No transport implemented.** In-app agent threads only; nothing is sent. |
| MCP | Adapter present (`lib/mcp-client.ts`); no server configured. |
| Trust Protocol | **Not implemented.** |
| Diagnostics runner | **Not implemented.** System Audit reports UNKNOWN rather than a pass. |

---

## Development

Stack:

- **Vite** 6 + **React** 19 + **TypeScript** 5.8 (strict mode)
- **Tailwind CSS** 4
- **Express** 4 (TypeScript, bundled with esbuild)
- **SQLite** via Node's built-in `node:sqlite`
- **Vitest** 4

Commands, as defined in `package.json`:

```bash
npm run dev      # tsx server.ts — Vite in middleware mode behind Express
npm run build    # vite build, then bundle the server to dist/server.cjs
npm run start    # NODE_ENV=production node dist/server.cjs
npm run lint     # tsc --noEmit (strict)
npm run clean    # rm -rf dist
```

There is no `test` script; the suite runs directly:

```bash
npx vitest run
```

Configuration is supplied through environment variables. Secrets are never
committed, and none appear in this file.

---

## Security and design principles

- **Workspace isolation** enforced at the API layer.
- **Bounded tools.** Filesystem access is limited to known roots by relative
  path only, with realpath containment re-checked after resolution and symlinks
  refused via `lstat`. GitHub access is read-only by construction against an
  explicit repository allowlist.
- **SSRF protection** on outbound requests: DNS-resolving URL validation that
  refuses private and reserved address ranges and embedded credentials, with
  bounded response reads.
- **Canonical credential authority.** Credentials live in one place, encrypted at
  rest in the control plane's own store.
- **No browser-local credential authority.** Tokens are not held in
  `localStorage` and secrets are not passed through the client or argv.
- **Approval-gated external actions**, bound to an exact input digest.
- **Execution evidence.** Completed work carries a signed receipt.

No external security certification or third-party penetration test has been
performed on this codebase. The above describes controls implemented in code,
not audited assurances.

---

## Tests

**2,017 tests passing across 112 files.** Strict typecheck: 0 errors. Production
build: clean.

The suite covers the security boundaries directly — tool sandboxing, path
traversal and SSRF refusal, approval lifecycle including digest binding and
expiry, workspace isolation, Brain source boundaries, orchestration claim
atomicity, provider ledger truth, and rendered-UI truth states.
