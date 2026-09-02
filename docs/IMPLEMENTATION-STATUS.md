# SynthOS Admin — Implementation Status

Engineering continuity reference. Not marketing copy. `REAL` means backed by a real database
write/read, a real cryptographic check, or a real network call whose failure is honestly
reported — never a claim resting on UI presence alone. Updated after "Platform Completion
Pass III" (Identity + Authorization + Workspace Authority + Master Admin + MCP + Hermes Phase 2
re-verification).

Legend: **REAL** — real backing, evidenced. **PARTIAL** — some real paths, some gaps or
unverified pieces. **NOT_IMPLEMENTED** — honestly absent, no fabricated stand-in. **DEFERRED** —
explicitly out of scope by a settled decision (ADR or project instruction), not a gap to close
opportunistically.

| Subsystem | Status | Module(s) | Test file(s) | Known limitation |
|---|---|---|---|---|
| **Authentication** | REAL | `lib/auth.ts`, `server.ts` (`/api/auth/*`), `src/components/AuthGate.tsx` | `test/auth.test.ts` | Local accounts only — no OAuth/SAML/SSO, deliberately not claimed. Password reset / email verification are not implemented (no email-sending infrastructure exists in this codebase). |
| **Authorization** | REAL | `lib/authorization.ts`, `lib/workspaces.ts` | `test/workspaces.test.ts`, `test/api-security-routes.test.ts` | `requireWorkspaceAdmin`/`requirePlatformAdmin` cover the roles this app actually uses (`admin`/`member`, `platform_admin`/`standard`) — not a general RBAC framework. Verified live against a real running server (anonymous blocked, cross-workspace blocked, role escalation blocked, platform-admin gating correct) as well as by 69 source-level regression tests. |
| **Workspace Membership** | REAL | `lib/workspaces.ts` (`workspaces`, `workspace_memberships` tables) | `test/workspaces.test.ts` | One canonical membership table, as intended — no competing "workspace_members" concept. `WorkspacesView.tsx` (workspace admin UI) was rebuilt this pass against real data; it previously showed entirely fabricated demo tenants disconnected from any backend. |
| **Router** (provider identity) | REAL | `lib/model-router.ts`, `server.ts` (`/api/generate`, now `requireAuth`) | `test/model-router.test.ts` | Only Gemini has a live execution mapping; Claude/DeepSeek/etc. are recognized but honestly `UNSUPPORTED`. Anonymous callers can no longer trigger a paid provider call (Pass III / H1) — no per-workspace budget/role policy exists beyond "must be an authenticated user," since none existed to preserve. |
| **Hermes** (ADR-001 adapter) | PARTIAL | `src/services/hermesAdapter.ts`, `lib/hermes-adapter.ts` | `test/hermes-adapter-phase1-truth.test.ts`, `test/hermes-truth-regression.test.ts` | Re-verified unchanged this pass (only an auth-layer guard was added to the HTTP routes wrapping it; `execute()`/`events()` remain honest Phase-1 `NOT_IMPLEMENTED` stubs — no `HERMES_ADAPTER_BASE_URL` is configured in this environment, and no concrete HTTP contract for `events()` is documented anywhere). Platform-level Hermes management routes now require `requirePlatformAdmin`. |
| **Jarvis** (admin command + sessions) | REAL | `server.ts` (`/api/jarvis/command`, `requireWorkspaceMember`), `lib/jarvis-sessions.ts`, `src/components/JarvisView.tsx` | `test/jarvis-admin-wiring.test.ts`, `test/jarvis-sessions.test.ts` | Sessions are now real, per-user owned (Pass III / J1) — a session belongs to the authenticated caller, not to "anyone in the workspace"; verified with cross-user isolation tests. Admin-intent classification is still 3 keyword-matched intents plus a real Gemini fallback, not general NLU. No platform-level commands exist in Jarvis to gate (J3 — nothing to restrict). |
| **Apollo** (voice bridge) | PARTIAL | `server.ts` (`/api/apollo/status`, `/api/apollo/command`, now `requireAuth`) | `test/jarvis-admin-wiring.test.ts` (isolation check only) | Architecturally separate from Jarvis (verified, not merged). Real voice runtime streaming remains unverified from earlier audits — unchanged this pass beyond the auth guard. |
| **KIL** | REAL | `lib/kil.ts`, `lib/kil-verifier.ts`, `lib/kil-gate.ts` | `test/kil.test.ts`, exercised in `test/full-platform-integration.test.ts` | Unchanged this pass except gaining workspace-membership authorization on its read route (`GET /api/ton/status`... KIL itself has no dedicated HTTP route; it is invoked server-side inside `/api/execute-agent-task`, which now requires authorization). Scoring formula untouched, as instructed. |
| **TON** | REAL | `lib/ton-probe.ts`, `lib/ton-readiness.ts`, `lib/ton-analytics.ts`, `lib/ton-guardians.ts` | `test/ton.test.ts` | All 5 `/api/ton/*` routes now require `requireWorkspaceMember`; installing guardians requires `requireWorkspaceAdmin`. Business logic untouched. |
| **Graphs** (build/preview/live execution) | REAL | `lib/graph-execution.ts`, `server.ts` (`/api/graphs*`) | `test/graph-workspace-isolation.test.ts`, `test/graph-execution.test.ts`, `test/graph-live-execution.test.ts` | All graph routes now require `requireWorkspaceMember`. `/api/execute-agent-task` (called both directly and internally by the graph-execution node loop) uses a real per-process internal-service-token so the internal self-call isn't blocked by the new auth requirement — see ADR-003 §8. Cost remains honestly `ESTIMATE_UNAVAILABLE`. |
| **Vault** | REAL | `lib/vault.ts` | `test/vault.test.ts` | Both Vault routes now require `requireWorkspaceMember` — unauthorized reads are rejected before any file path is ever touched, not just filtered after. |
| **Memory** (FTS5 index/search) | REAL | `lib/memory-index.ts` | `test/memory-index.test.ts` | Both Memory routes now require `requireWorkspaceMember` — search results can no longer be read by a non-member. |
| **Skills** | PARTIAL | `lib/skills.ts`, `server.ts` (`/api/skills*`) | `test/skills.test.ts`, `test/skills-ui-truth.test.ts`, `test/mcp-registry.test.ts` | List/get/create/test require `requireWorkspaceMember`; enabling/disabling (`PATCH`) now requires `requireWorkspaceAdmin`. Test execution still honestly `NOT_IMPLEMENTED` (no execution runtime exists). `/api/skills/discover` remains intentionally public (no secrets, no workspace concept). |
| **Sessions** (Jarvis conversation history) | REAL | `lib/jarvis-sessions.ts` | `test/jarvis-sessions.test.ts` | Now real, user-owned (see Jarvis row) as well as workspace-scoped. |
| **Backup** | REAL | `lib/backup.ts`, `server.ts` (`/api/backup*`) | `test/backup.test.ts`, exercised in `test/full-platform-integration.test.ts` | All 5 routes now require `requirePlatformAdmin` (Pass III / I1 — the backup covers the one shared instance-wide database, so workspace-admin scoping would be meaningless; verified this is correct by inspecting `lib/backup.ts`'s actual scope before deciding). Restore remains staged-only, never a live swap. |
| **MCP** (registry) | PARTIAL | `lib/skills.ts` (`category: 'mcp'`), `server.ts` | `test/mcp-registry.test.ts` | No separate "MCP Servers" concept exists anywhere in this codebase distinct from the Skills registry — an `mcp`-category skill already has exactly the fields a minimal MCP registry needs (name, transport/endpoint via `source_type`/`source_ref`, enabled, status). Added this pass: real HTTP(S) endpoint URL validation. `CONFIGURED` is never conflated with `CONNECTED` — no live MCP connection probe exists (a caller-supplied-URL network probe would be a real SSRF risk without a proxy boundary; ADR-001 §6 itself treats the MCP proxy path as unverified/deferred), so status is honestly `NOT_CONFIGURED`/`NOT_IMPLEMENTED`, never `CONNECTED`. |
| **Master Admin** | PARTIAL | `server.ts` (`/api/master-admin/*`), `src/components/MasterAdminView.tsx` | `test/api-security-routes.test.ts` | All routes now require `requirePlatformAdmin`, verified live (standard user 403, real platform admin 200). Backend routes exist for user management (`GET /api/master-admin/users`, `PATCH .../status`) and workspace/membership management (`GET/POST /api/master-admin/workspaces`, `POST .../members`) — no dedicated UI panel was built for user management in this pass (workspace management UI was, replacing the old fabricated `WorkspacesView.tsx`). A real, acknowledged gap, not a silently-claimed feature. |
| **Windmill** | DEFERRED | — | — | Deliberately not built. No competing scheduler exists in this codebase. |

## Cross-cutting notes

- **Identity and authorization architecture** is documented in full in
  `docs/adr-003-identity-workspace-authority.md` — read that for the session model, the
  platform-vs-workspace authority split, the public-route allowlist, the internal-service-token
  pattern, and CSRF defense-in-depth. `activeWorkspaceId` (client-supplied, in the UI or any
  request body/query) is explicitly documented there as a **requested** workspace, never
  authorization proof — every route independently verifies it against a real membership row.
- **Live-verified, not just unit-tested.** Pass III's authorization wiring was proven against a
  real running server (both via `curl` and a real Chrome browser session): anonymous blocked
  everywhere except the public allowlist, cross-workspace access blocked, workspace-role
  escalation blocked, platform-admin routes correctly gated in both directions, and — the subtle
  case — platform admin does **not** silently bypass ordinary workspace membership checks for
  tenant data it isn't a member of.
- **Workspace isolation** (the pre-existing `resolveWorkspaceId()` scoping) is unchanged and still
  necessary — Pass III adds membership authorization *in front of* it, not instead of it.
- **No new database engine** was introduced. Every table added this pass (`users`,
  `user_sessions`, `workspaces`, `workspace_memberships`) lives in the same SQLite file every
  other table already uses.
- **No new npm dependency** was added this pass. Password hashing uses Node's built-in
  `crypto.scrypt`; session-cookie parsing is a ~10-line hand-rolled reader rather than adding
  `cookie-parser`; CSRF defense is an Origin-header check rather than adding `csurf` (unmaintained
  upstream). `tar@^7` (added in Pass II, for `lib/backup.ts`) remains the only third-party
  dependency introduced across the three platform-completion passes.
