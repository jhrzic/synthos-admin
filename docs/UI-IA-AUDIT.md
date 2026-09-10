# UI / Navigation Information Architecture Audit

Pass X / Workstream K2. This is an **inventory for Pass XI**, not a redesign — nothing here was
acted on this pass beyond a few obvious, low-risk duplicate/dead-badge fixes noted inline. Every
row is a snapshot of where a tool currently lives, not a decision about where it should end up;
`RECOMMENDED_DOMAIN` is a starting suggestion for the next pass to accept, reject, or refine.

Nav locations below use this repo's `ActiveTab` id and the label(s) shown in the sidebar/nav —
confirmed by reading `src/components/SidebarNav.tsx`, `src/components/WorkspaceTopNav.tsx`, and
`src/App.tsx`'s tab-render switch, not assumed.

## Conceptual domains used below

`HOME/OVERVIEW` · `WORK/OPERATIONS` · `AGENTS` · `ORCHESTRATION` · `KNOWLEDGE` ·
`TRUST/GOVERNANCE` · `RUNTIMES/INTEGRATIONS` · `PRODUCTS` · `ADMIN`

## Inventory

| Tool | CURRENT_LOCATION | PURPOSE | SCOPE | USER_TYPE | SHOULD_MOVE? | RECOMMENDED_DOMAIN |
|---|---|---|---|---|---|---|
| Jarvis | `jarvis` tab ("Jarvis Executive Hub"), plus a global header orb (`AirbyteHeader`) and `GlobalVoiceOverlay` reachable from any screen | Global SynthOS assistant — directive execution, admin queries, voice input | Global | All | No | `HOME/OVERVIEW` (already correctly global) |
| Apollo | `hermes-apollo` tab, inside the separate Hermes workspace sub-nav (`WorkspaceTopNav`) | Hermes-specific voice assistant | Hermes workspace only | All (Hermes context) | No | `AGENTS` (correctly scoped under Hermes, per AA6) |
| Hermes (dedicated runtime) | `hermes-core` tab (WORKSPACES list) + a whole separate sub-nav (`hermes-chat`, `hermes-terminal`, `hermes-sessions`, `hermes-agents`, `hermes-kanban`, `hermes-skills`/`hermes-mcps`/`hermes-tools`, `hermes-cron`, `hermes-channels`, `hermes-memory`, `hermes-knowledge`, `hermes-files`, `hermes-models`, `hermes-usage`, `hermes-approvals`, `hermes-activity`, `hermes-gateway`, `hermes-analytics`, `hermes-logs`, `hermes-updates`) | The Hermes-specific workspace: chat, terminal, agents, its own Kanban, its own knowledge/model/usage views | Hermes workspace | Operator-leaning (many sub-tabs are diagnostic) | **Yes, worth reviewing** | `RUNTIMES/INTEGRATIONS` for the connection status; `AGENTS` for the working surfaces |
| Model Router | `model-router` tab **and** `hermes-models` tab (both render the same `ModelRouterView`) | Free-model catalog browsing, zero-cost routing simulator, agent-role-to-model matrix config | Platform-wide config | Operator (per CLAUDE.md, model/pricing identity is operator-only margin data) | **Yes** | `RUNTIMES/INTEGRATIONS` or `ADMIN` — **flag:** no operator-gate was found on either tab in this pass; CLAUDE.md says model IDs/tiers/pricing must never reach a client workspace, worth a real access-control check next pass, not just a nav move |
| Windmill | No dedicated top-level nav tab found — real client/target-registry/execution-ledger code exists (`lib/windmill-client.ts`, `/api/windmill/*`, `/api/master-admin/windmill/*`) but this pass did not find where its own settings screen (if any) is reachable from the nav | External execution/scheduling control plane (ADR-006) | Platform + per-workspace targets | Operator (target registration), workspace member (submission) | **Needs locating first** | `RUNTIMES/INTEGRATIONS` |
| MCP | `hermes-mcps` tab ("MCP Registry") | External MCP server credential/probe management | Per-skill, workspace-scoped | Operator/workspace admin | Possibly — currently nested only under the Hermes sub-nav, but MCP-backed skills apply to any workspace | `RUNTIMES/INTEGRATIONS` |
| Graph Builder | `graph-builder` tab | Build/edit execution graphs | Workspace | Builder-type user | No | `ORCHESTRATION` |
| Graph Runs | `graph-runs` tab, labeled **"Active Runs"** in one sidebar group and **"Graph Runtime"** in another (two labels, same tab, via `navId` override) | Real graph execution history/status | Workspace | All | Fix the label inconsistency at least | `ORCHESTRATION` |
| Tasks | `kanban` tab ("Kanban") | Task lifecycle board | Workspace | All | No | `WORK/OPERATIONS` |
| Mixture of Agents | Not found anywhere in `ActiveTab` or the nav — no evidence this concept exists in this codebase | — | — | — | N/A | N/A — do not build a placeholder for it |
| Skills | `skill-registry` tab ("Skills Registry") | Skill definitions, execution targets, credentials | Workspace | Workspace admin | No | `ORCHESTRATION` |
| Vault | `obsidian` tab **and** `hermes-knowledge` tab (both render the same, real `ObsidianView`) | Real filesystem-backed Vault artifacts + session-local Quick Notes | Workspace | All | Consolidate the duplicate entry | `KNOWLEDGE` |
| Memory | `agent-memory` tab (separate from Vault) | Not fully audited this pass — worth confirming whether this duplicates `/api/memory/search` (already used elsewhere) or is a distinct, real feature | Workspace | All | Verify before deciding | `KNOWLEDGE` |
| KIL | No dedicated nav tab found. Real backend exists (`lib/kil.ts`, `lib/persistence.ts`'s `summariseKil`/`listKilObservations`) and is now surfaced as a summary card on the rewritten Overview screen this pass, but there is no dedicated KIL browse/detail screen | Knowledge Integrity Ledger — observation scoring, promotion | Workspace | All | **Create**, not move — Workstream J's "bounded knowledge/evidence view" was not built this pass given time | `TRUST/GOVERNANCE` |
| Knowledge Graph | Not found as a real, reachable screen this pass. The screenshot supplied at the start of this pass (showing vault cards, a velocity chart, and a force-directed "mind graph") does **not** match any currently-wired component — see the flagged finding below | — | — | — | **Investigate the discrepancy first** | `KNOWLEDGE` |
| Aegis | `system-audit` tab ("Aegis Verifier") | Deterministic verification | Workspace | All | No | `TRUST/GOVERNANCE` |
| Guardian | `guardian-aegis` tab, appearing under **two different labels** in two sidebar groups ("Approvals" in one, "Guardian Gate" in the other, via `navId` override) | Policy enforcement / cross-workspace isolation guard | Platform + workspace | All (approvals), operator (policy) | Fix the label inconsistency | `TRUST/GOVERNANCE` |
| Receipts | `receipts` tab, also appearing under **two different labels** ("Results & Receipts" and "Cryptographic Receipts") | Real Ed25519 receipts, real re-verification | Workspace | All | Fix the label inconsistency | `TRUST/GOVERNANCE` |
| TON | `ton` tab ("TON Network") | TON guardian/telemetry product surface | Workspace (product-specific) | Product user | No | `PRODUCTS` |
| Backups | No dedicated top-level nav tab found — real backend exists (`/api/backup/*`), reachable only through Master Admin per `docs/OPERATOR-RUNBOOK.md` | Backup/restore | Platform | Operator | Confirm/document | `ADMIN` |
| Users | `users-roles` tab ("Users & Roles") | User/role management | Platform | Operator | No | `ADMIN` |
| Workspaces | `workspaces` tab ("Customer Workspaces") | Workspace creation/management | Platform | Operator | No | `ADMIN` |
| Provider configuration | `master-admin-providers` ("Providers Matrix") inside Master Admin | Gemini/other provider keys | Platform | Operator | No | `ADMIN` |
| Voice configuration | `master-admin-voice` ("Voice & Apollo") inside Master Admin, **and** a separate Fish Audio setup wizard embedded directly in `jarvis`'s own view | Fish Audio / TTS setup | Platform + per-surface | Operator (Master Admin), any user (Jarvis's own setup card) | Confirm these two don't drift out of sync | `ADMIN` for the platform-wide config; leave the in-context Jarvis card where it is |

## Findings that affect placement decisions (not fixed this pass unless noted)

1. ~~**`agent-wireframe` tab is a byte-for-byte duplicate of `overview`**~~ — **RESOLVED in Pass
   XI.** `agent-wireframe`'s `ActiveTab` type entry, its `App.tsx` render block, and its
   now-redundant `SidebarNav` entry were removed (Overview already existed in the same nav
   section); `WorkspaceTopNav`'s "Delegation" quick-link was repointed to `overview` instead of
   duplicating it.
2. ~~**`guardian-aegis` and `receipts` each have two different sidebar labels for the same tab.**~~
   — **RESOLVED in Pass XI.** Both nav entries kept (legitimate dual discoverability from
   OPERATIONS and GOVERNANCE) — labels unified to "Approvals" and "Receipts" respectively,
   matching the name already used consistently everywhere else in the app (header, command
   palette, guided tour, workspace nav).
3. ~~**`hermes-knowledge` and `obsidian` are the same tab; `hermes-models` and `model-router` are
   the same tab.**~~ — **RESOLVED in Pass XI.** Both duplicate `ActiveTab` entries and their
   `App.tsx` render blocks removed; `WorkspaceTopNav`/`HermesTopNav`'s "Knowledge"/"Models"
   quick-links (their only reachability path — neither was in the main `SidebarNav`) repointed to
   the canonical `obsidian`/`model-router` tab ids, keeping their contextual labels.

   **A sixth true duplicate was found during Pass XI verification, not in the original five:**
   `policies` (SidebarNav, GOVERNANCE, "Operating Policies") rendered the exact same
   `GuardianAegisControlView()` with zero props as `guardian-aegis` — worse than the pairs above,
   since both lived in the *same* GOVERNANCE section of the *same* sidebar. Removed (type entry,
   render block, and nav entry) rather than relabeled, since `guardian-aegis`/"Approvals" already
   covered the function in that exact section.
4. **Seven fictional-provider "agent" tabs live under the WORKSPACES sidebar category**
   (`agent-orchestrator`, `hermes-core`, `agent-claude`, `agent-gemini`, `agent-codex`,
   `agent-cursor`, `agent-antigravity`, `agent-openclaw`). Their sidebar `statusTag` badges
   (`LIVE`/`PARTIAL`/`NOT CONNECTED`) were 100% hardcoded with no real backing signal — this pass
   removed the badges (Workstream A2/F fix), but the underlying per-provider dashboard pages
   themselves (`AgentView.tsx` and friends) were **not** individually audited this pass given
   time. Per `CLAUDE.md`, Codex/Cursor/Antigravity/OpenClaw are not in the real stack at all
   (Anthropic/DeepSeek/Ollama only) — worth deciding in Pass XI whether these pages should be
   removed, clearly marked aspirational, or built for real.
5. **The "Julian Goldie SEO — 4 Day Intelligence Audit" CTA was removed from the default Overview
   screen this pass** (it was a promotional card for a specific, narrow audit tool, confusing on
   a cold first-time landing screen) but the feature itself (`JulianGoldieAuditRunner.tsx`, still
   reachable from `StartupIdeaGeneratorView`) was left alone. Worth deciding in Pass XI whether it
   belongs in `PRODUCTS` or `WORK/OPERATIONS` rather than nowhere-in-particular.
6. **Flagged, not resolved — the Knowledge/Vault graph screenshot supplied at the start of this
   pass does not match any reachable screen in this exact repository.** Its apparent source
   components, `src/components/ObsidianGraphMind.tsx` and
   `src/components/VaultActivitySparkline.tsx`, contain the exact fabricated strings visible in
   the screenshot ("SYNAPSE BURST", "MIND GRAPH ACTIVE", "Obsidian Ingestion Daemon: 14ms…",
   fictional vault paths/note counts, a force-directed graph referencing providers not in this
   app's stack). Both files have zero importers anywhere in `src/`, confirmed by exhaustive
   `grep`, and `git log` shows neither has been modified since the very first commit in this
   repo's history (`f6a2083`) — they have never been wired to any tab, in this repo, ever. The
   real `obsidian`/`hermes-knowledge` tabs both render a fully honest, already-real `ObsidianView`
   with none of that content. **This needs the user's input**: if the screenshot came from a
   different checkout, branch, or a stale running server, that would explain the mismatch — worth
   confirming before anyone spends effort "fixing" a screen that may not need to exist. Per
   Workstream F1 ("fix active user-visible lies... unused legacy code can be documented for later
   cleanup"), no further effort went into these two files' internals this pass.
7. **`MessageBridgeView.tsx` has a fabricated per-message token count** (`Math.random() * 400 +
   400`, plus four hardcoded seed values) inside a section explicitly labeled **"SECTION 4:
   SIMULATOR"** in its own heading. Left as-is this pass given the explicit self-labeling
   (materially different from an unlabeled live claim) — worth a decision in Pass XI on whether a
   labeled simulator may still show fabricated numbers or should show `SIMULATED` instead of a
   specific value.
8. **`CommandPalette.tsx` runs its own, separate, working `SpeechRecognition` implementation**
   (Workstream O) — real capability detection, real error handling, real cleanup on close. It does
   **not** participate in the shared cross-assistant collision guard the rest of the app's voice
   surfaces (Jarvis, Apollo) use (see Pass IX / `src/hooks/useSpeechRecognition.ts`), so a user
   could in principle have the Command Palette and Jarvis or Apollo listening at the same time.
   Classified `SEPARATE_VALID` rather than `SHOULD_USE_SHARED_HOOK` this pass given the size and
   working state of the component and the remaining time budget — worth reconsidering in Pass XI
   specifically for the collision-guard gap, not for its overall design.

## Addendum — second truth sweep, same pass

The findings above were written after a first pass through the files this session's own diff had
already touched. A second, targeted sweep for the same class of problem in files that first pass
never opened (`HermesOracleView.tsx`, `JulianGoldieAuditRunner.tsx`, `StartupIdeaGeneratorView.tsx`,
plus a spot-check of `MasterAdminView.tsx`) found and fixed four more real, active-screen
fabrications of the same severity as the ones already documented above — full detail in
`docs/IMPLEMENTATION-STATUS.md`'s Overview row and this pass's final report. Noted here so Pass XI
doesn't re-discover them: `StartupIdeaGeneratorView.tsx` ("Launchpad") and `HermesOracleView.tsx`
("Hermes Oracle") were both significant enough to warrant this document's own inventory being
revisited if either screen's purpose changes materially in a future pass — right now both still
serve the same conceptual role (an idea-brainstorming tool and an agent-roster/Hermes-health view,
respectively), just with honest data underneath instead of fabricated telemetry.

## What Pass XI did with this document

Both of the two changes flagged above as cheapest and least risky are now done: the six confirmed
duplicate tab pairs (`agent-wireframe`/`overview`, `guardian-aegis` double-label,
`receipts` double-label, `hermes-knowledge`/`obsidian`, `hermes-models`/`model-router`, and the
newly-found `policies`/`guardian-aegis`) are collapsed to one real destination each — see findings
1–3 above. Finding #6 (the Knowledge/Vault screenshot mismatch) was deliberately left untouched
per this pass's own instruction, still pending your confirmation of which representation is
intended before anyone builds or fixes anything there.

Treat every `RECOMMENDED_DOMAIN` in the inventory table above as a still-open proposal, not a
decision — that part of this document is unchanged by Pass XI. Findings #4, #5, #7, and #8 above
also remain open, as does Workstream H (task → graph run → execution cross-linking), which this
pass did not reach.

---

## Unlinked-screen review (P1-C, restoration pass)

Three screens have a render block in `src/App.tsx` but are reachable from no navigation surface.
Git shows **no nav entry ever existed** for any of them (`git log -S "setActiveTab('<id>')"` and
`-S "id: '<id>'"` return nothing across all refs), so these are orphaned-at-import from the
`f6a2083` baseline — **not** casualties of the later cleanup that removed the Obsidian Knowledge
Mesh and Context Governor Telemetry.

Each was compared against current navigation and against its own data sources before deciding.
**None were wired in this pass**, and the reason for each is recorded so the next session does not
re-derive it.

| Screen | Tab id | Size | Data source | Duplicate of | Decision |
|---|---|---|---|---|---|
| `GuideWalkthroughView` | `guide-walkthrough` | 353 L | `GUIDE_CURRICULUM` (static curriculum), user progress in localStorage | **Yes** — `master-admin-walkthrough` "Setup Walkthrough (12 Steps)" is already in the sidebar and is *computed from real diagnostic data* (`MasterAdminView.tsx:801`) | `DO_NOT_WIRE_DUPLICATE` |
| `EcosystemReposView` | `ecosystem-repos` | 252 L | A hardcoded `repos` array inside the component; zero `fetch` calls | No | `KEEP_UNLINKED_INTERNAL` |
| `MasterOperationsView` | `master-ops` | 617 L | Real props (agents, models, tasks, messages, audit checks) and real handlers (`handleRunAudit`, fleet standup, execute prompt) — **but also fabricated telemetry** | No — "Master Operations / Chief of Staff" is a distinct concept with no current nav entry | `KEEP_UNLINKED_INTERNAL` (blocked) |

### Why `MasterOperationsView` was not wired

It is the strongest candidate of the three — a distinct product concept, substantial, and already
fed real data by `App.tsx`. It is blocked on truthfulness, not on value:

- `Latency: 42ms` is hardcoded (`MasterOperationsView.tsx:374`).
- The fleet-standup broadcast asserts invented results, e.g. *"Sandbox test harness 100% green.
  Fish Audio dual-channel buffer verified at 78ms latency."* (line 69).

Wiring it as-is would put fabricated telemetry back into product navigation, which `AGENTS.md` §3
forbids and which the restoration brief explicitly rules out. The correct disposition is
`PRESERVE_AND_REWIRE` at **P2**: keep the Chief-of-Staff UX, replace the invented figures with real
runtime data or `UNKNOWN`, then wire it. That is a separate, scoped piece of work — not something
to fold into a restoration pass.

### Also checked, not a problem

`master-admin` and the 14 `master-admin-*` ids resolve through `activeTab.startsWith('master-admin')`
to `MasterAdminView`, and the agent tabs resolve through `getAgentRoleFromTab(activeTab)`. Both are
reachable and correctly rendered — an earlier count of "declared ActiveTab ids without a render
block" over-reported because it did not account for these catch-all blocks.
