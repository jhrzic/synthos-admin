# SynthOS Admin — Implementation Status

Engineering continuity reference. Not marketing copy. `REAL` means backed by a real database
write/read, a real cryptographic check, or a real network call whose failure is honestly
reported — never a claim resting on UI presence alone. Updated after the "Platform Completion
Pass II" turn (Graph live execution + Skills + Jarvis sessions + Backup + Hermes Phase 2 audit).

Legend: **REAL** — real backing, evidenced. **PARTIAL** — some real paths, some gaps or
unverified pieces. **NOT_IMPLEMENTED** — honestly absent, no fabricated stand-in. **DEFERRED** —
explicitly out of scope by a settled decision (ADR or project instruction), not a gap to close
opportunistically.

| Subsystem | Status | Module(s) | Test file(s) | Known limitation |
|---|---|---|---|---|
| **Router** (provider identity) | REAL | `lib/model-router.ts` | `test/model-router.test.ts` | Only Gemini has a live execution mapping; Claude/DeepSeek/etc. are recognized but honestly `UNSUPPORTED` — no credentialed second provider is wired. |
| **Hermes** (ADR-001 adapter) | PARTIAL | `src/services/hermesAdapter.ts`, `lib/hermes-adapter.ts` | `test/hermes-adapter-phase1-truth.test.ts`, `test/hermes-truth-regression.test.ts` | Phase 1 only (`health()`/`capabilities()` real and honest). `execute()`/`events()` are honest `NOT_IMPLEMENTED` stubs — no `HERMES_ADAPTER_BASE_URL` is configured in this environment (no `.env` file exists), and no concrete HTTP contract for `events()` is documented anywhere. Phase 2/3 are real work items, not gaps in this pass. |
| **Jarvis** (admin command + sessions) | REAL | `server.ts` (`/api/jarvis/command`), `lib/jarvis-sessions.ts`, `src/components/JarvisView.tsx`, `src/App.tsx` | `test/jarvis-admin-wiring.test.ts`, `test/jarvis-sessions.test.ts` | Admin-intent classification is 3 keyword-matched intents (tasks/graphs/receipts) plus a real Gemini call as fallback — not a general-purpose NLU classifier. Conversation history is real and workspace-scoped; voice transcripts share the same session. |
| **Apollo** (voice bridge) | PARTIAL | `server.ts` (`/api/apollo/status`, `/api/apollo/command`) | `test/jarvis-admin-wiring.test.ts` (isolation check only) | Architecturally separate from Jarvis (verified, not merged). Not touched this pass — real voice runtime streaming remains unverified from earlier audits. |
| **KIL** (Knowledge Intelligence Layer) | REAL | `lib/kil.ts`, `lib/kil-verifier.ts`, `lib/kil-gate.ts` | `test/kil.test.ts`, exercised end-to-end in `test/full-platform-integration.test.ts` | Verbatim-ported scoring formula (`C(K) = V(K)·[0.7·E(K)+0.3·F(K)]`); no decay/simulation/human-review terms exist (deliberately, per instruction). Gate is wired into `/api/execute-agent-task`. |
| **TON** (network readiness/telemetry) | REAL | `lib/ton-probe.ts`, `lib/ton-readiness.ts`, `lib/ton-analytics.ts`, `lib/ton-guardians.ts` | `test/ton.test.ts` | Fail-closed: config presence alone never exceeds `submitted`; only a live SSRF-protected probe success reaches `approved`. External TON network approval status is inherently outside this app's control. |
| **Graphs** (build/preview/live execution) | REAL | `lib/graph-execution.ts`, `server.ts` (`/api/graphs*`), `src/components/GraphBuilderView.tsx`, `src/components/GraphRunsView.tsx` | `test/graph-workspace-isolation.test.ts`, `test/graph-execution.test.ts`, `test/graph-live-execution.test.ts` | Live execution requires explicit `confirmed:true` (server-enforced, not just UI). No dollar cost estimate is ever shown — this deployment has no live per-token pricing wired to real usage accounting, so cost is honestly `ESTIMATE_UNAVAILABLE`. Dry-run preview makes zero model calls by design. |
| **Vault** (read service) | REAL | `lib/vault.ts`, `src/components/ObsidianView.tsx` | `test/vault.test.ts` | Read-only service over the one real writer (`recordArtifact()` in the execution spine). No live Obsidian desktop-app connection exists — labeled `NOT_CONNECTED` honestly, distinct from the real SQLite/disk-backed Vault content. |
| **Memory** (FTS5 index/search) | REAL | `lib/memory-index.ts`, `src/components/AgentMemoryView.tsx` | `test/memory-index.test.ts` | SQLite FTS5 over real Vault content only (no vector infra, no external search service). Indexing is hooked into the execution spine post-verification; a failure there never blocks task completion. |
| **Skills** (registry) | PARTIAL | `lib/skills.ts`, `server.ts` (`/api/skills*`), `src/components/SkillRegistryView.tsx`, `src/components/MasterAdminView.tsx` | `test/skills.test.ts`, `test/skills-ui-truth.test.ts` | Registry, enable/disable state, and workspace isolation are real and persisted. Test execution always honestly returns `NOT_IMPLEMENTED` — no sandbox or MCP runtime is wired into this deployment for arbitrary skill execution. Bounded repo-directory discovery exists but finds nothing today (no `skills/` directory ships with this repo). |
| **Sessions** (Jarvis conversation history) | REAL | `lib/jarvis-sessions.ts`, `server.ts` (`/api/jarvis/sessions*`) | `test/jarvis-sessions.test.ts` | Workspace-scoped, persists across reload. Session title is derived from the first real user message. No hidden chain-of-thought or secrets are ever stored — only the same visible text already shown on screen. |
| **Backup** (create/validate/restore) | REAL | `lib/backup.ts`, `server.ts` (`/api/backup*`), `src/components/MasterAdminView.tsx` | `test/backup.test.ts`, exercised end-to-end in `test/full-platform-integration.test.ts` | Instance-wide (the one SQLite DB file plus the Vault directory — not workspace-scoped). Restore is always staged, never a live in-process swap: this process holds an open `node:sqlite` handle on the live DB for its whole lifetime, so restore returns `RESTART_REQUIRED` with exact manual steps rather than claiming a live restore completed. |
| **Windmill** | DEFERRED | — | — | Deliberately not built. `server.ts` explicitly reports `DEFER_TO_WINDMILL` / `NOT_CONNECTED` for background worker/cron orchestration wherever it comes up. No competing scheduler exists in this codebase (`MC_DISABLE_SCHEDULER` also does not exist — there is no scheduler to disable). |
| **Auth** | NOT_IMPLEMENTED | — | — | Deliberately out of scope per project instruction ("do NOT add authentication architecture"). No `passport`/`jwt`/`bcrypt` or equivalent exists anywhere in this codebase. Workspace identity is currently a client-supplied `workspaceId` string, not an authenticated principal. |

## Cross-cutting notes

- **Workspace isolation** is enforced at the read/write-path level (`resolveWorkspaceId()` in
  `lib/persistence.ts`) across tasks, activity, artifacts, receipts, KIL, TON, graphs, skills, and
  Jarvis sessions. Tables without their own `workspace_id` column are scoped via a JOIN to the
  owning task's workspace. Unknown-id and wrong-workspace-id are indistinguishable to the caller
  (non-disclosure pattern) everywhere this applies.
- **The margin firewall** (no model identity/token pricing exposed in a client workspace) is out
  of scope for this pass — it applies to the multi-tenant SaaS access model described in the
  top-level `~/synthos/CLAUDE.md`, which this repo's own `AGENTS.md` explicitly does not inherit
  as its architecture. Not evaluated here.
- **No new database engine** was introduced. Everything added this pass (skills, Jarvis sessions,
  memory index) lives in the same SQLite file every other table already uses.
- **One new npm dependency** was added: `tar@^7` (the same library `npm` itself uses internally),
  for safe, auditable archive creation/extraction in `lib/backup.ts`. Not a database engine, not a
  scheduler, not an authentication library.
