# ADR-003: Identity, Sessions, and Workspace Authority

**Status:** ACCEPTED — 2026-09-02, Platform Completion Pass III.
**Location:** `~/synthos/synthos-admin/docs/adr-003-identity-workspace-authority.md`

This document records the real, minimal identity and authorization architecture added in Pass
III. It does not reopen or restate ADR-001/ADR-002; it is orthogonal to them — Hermes runtime
governance and Jarvis's global-service model are unaffected except that their APIs now sit behind
this same authorization layer.

---

## Context

Before this pass, the application accepted a client-supplied `workspaceId` (query, body, or the
`activeWorkspaceId` React state) as sufficient scoping for every real data route. There was no
concept of a user, no session, no password, no membership record, and no distinction between
"this request named workspace X" and "this caller is actually allowed to see workspace X." Every
real backend surface built in Pass I/II (tasks, graphs, Vault, Memory, KIL, TON, Skills, Jarvis
sessions, backup) was reachable by anyone who could reach the server at all.

## Decisions

### 1. Three separate questions, never conflated

- **Authentication** answers *who is this caller?*
- **Authorization** answers *what may this caller do?*
- **Workspace isolation** answers *which tenant's data may this caller access?*

`resolveWorkspaceId()` (existing, Pass I) still answers the third question at the SQL-scoping
level and is unchanged — it is necessary but no longer sufficient. A request's `workspaceId` is
now always a **requested** workspace, never proof of authorization to see it.

### 2. Identity source

Real, local, server-side accounts. No OAuth/SAML, no external identity provider — this is
explicitly not claimed as enterprise SSO. Schema (`lib/persistence.ts`):

- `users` — `user_id`, `email` (unique), `display_name`, `password_hash` + `password_salt`
  (scrypt, Node's built-in KDF — no bcrypt/argon2 dependency added), `platform_role`
  (`platform_admin` | `standard`), `status` (`active` | `disabled`).
- `user_sessions` — `session_id`, `user_id`, `token_hash` (sha256 of a random 32-byte token —
  the raw token is never persisted, only ever handed to the client as the session cookie value),
  `created_at`, `expires_at` (14-day TTL), `last_seen_at`, `revoked_at`.

Mechanics live in `lib/auth.ts` (`hashPassword`/`verifyPassword`/`createUser`/`login`/
`resolveSessionUser`/`revokeSessionByToken`). `login()` returns the same generic failure for
every wrong-guess case (unknown email, wrong password, disabled account) — a login attempt can
never be used to enumerate real accounts.

### 3. Session model

A server-managed session, not a client-trusted token. `resolveSessionUser()` performs a real,
revocation-aware database lookup on every request — there is no JWT-style "trust the signature
locally" shortcut, so a revoked or expired session is rejected immediately, not just at its
original expiry.

Cookie (`SESSION_COOKIE_NAME = 'synthos_session'`, set in `server.ts`):
`HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, 14-day `Max-Age`, `path=/`.

### 4. Workspace membership — the one canonical relation

`workspaces` (new — workspace IDs were previously bare, unvalidated strings; this pass made them
a real, listable entity) and `workspace_memberships` (`user_id`, `workspace_id`, `role`
(`admin` | `member`), `status`, composite primary key). This is the **only** membership table —
no parallel `workspace_members` concept exists or should be added.

`lib/workspaces.ts` is the source of truth: `ensureWorkspace`, `getWorkspace`, `listWorkspaces`,
`createWorkspace`, `grantMembership`, `getMembership`, `hasWorkspaceAccess`,
`listUserMemberships`, `listWorkspaceMembers`, `countWorkspaceMembers`.

### 5. Platform vs. workspace authority — kept separate, and platform authority does NOT auto-bypass workspace scope

Two independent axes:

- **Platform role** (`users.platform_role`): `platform_admin` or `standard`. Governs
  platform-level surfaces only — Master Admin, backup/restore, raw terminal execution,
  platform-level Hermes management.
- **Workspace role** (`workspace_memberships.role`): `admin` or `member`, per workspace.
  Governs privileged actions *inside* a specific workspace (e.g. enabling/disabling a skill,
  installing TON guardians).

**A `platform_admin` does not automatically gain access to an arbitrary workspace's ordinary
data.** A platform admin who wants to read Workspace X's tasks, graphs, Vault, or Memory still
needs a real membership row in that workspace, exactly like any other user. Platform authority is
scoped narrowly to the routes that are genuinely platform-level (Master Admin, backup, terminal),
never used as a blanket bypass for workspace-scoped queries. This was a deliberate design choice,
not an oversight — an accidental bypass would be a real cross-tenant confidentiality violation the
moment a second real tenant exists, and is exactly the failure mode this ADR exists to prevent.

The one exception, by construction rather than by a bypass flag: the first bootstrap user is
auto-granted `admin` membership on the default workspace (`ws-synthos-primary`) at account
creation, so the platform administrator can use the product immediately after setup. That is a
real membership row, not a privilege check being skipped.

### 6. Authorization helpers (`lib/authorization.ts`)

Reusable, composable Express middleware — not ad hoc per-route checks:

- `requireAuth` — authentication only.
- `requireWorkspaceMember(extractWorkspaceId)` — authentication + a real, active membership row
  for the requested workspace. `extractWorkspaceId` is one of `fromBody` / `fromQuery` /
  `fromBodyOrQuery`, so the same middleware factory covers both GET (query) and POST (body)
  routes.
- `requireWorkspaceAdmin(extractWorkspaceId)` — same, but the membership must carry the
  workspace `admin` role.
- `requirePlatformAdmin` — `users.platform_role === 'platform_admin'`, independent of any
  workspace.

Each is self-contained (re-resolves the session itself from the request) rather than depending on
a previous middleware having populated `req.authUser` — this removes an easy-to-miss ordering
footgun where a route could accidentally skip authentication by omitting one middleware from a
chain.

### 7. `activeWorkspaceId` is client input, never authorization proof

Documented explicitly because it is the exact anti-pattern this pass closes: the client
(`activeWorkspaceId` in `App.tsx`, or any `workspaceId` in a request body/query) names a
**requested** workspace. The server always independently verifies that request against a real
membership row via `requireWorkspaceMember`/`requireWorkspaceAdmin` before granting anything. No
route trusts the client's claim about which workspace it belongs to.

### 8. The internal-service-token pattern

`/api/execute-agent-task` is called both directly by external clients (now behind
`requireWorkspaceMember`) and internally, via a same-process HTTP self-call, from
`/api/graphs/execute`'s node-dispatch loop (no browser cookie is available there to forward). A
random 32-byte `INTERNAL_SERVICE_TOKEN` is generated fresh at process startup, held only in
server memory, and never returned in any API response. The internal call includes it as an
`X-Internal-Service-Token` header; the route accepts either a valid session+membership **or** an
exact match on this token. An external caller has no way to obtain or guess it. This pattern may
recur if another route needs a same-process internal caller — the same construction (random,
process-local, never exposed) is the template.

### 9. Public allowlist

Explicit, not incidental:

- `GET /api/auth/setup-required`, `POST /api/auth/setup` (self-disabling once any user exists —
  race-free because `node:sqlite`'s `DatabaseSync` is fully synchronous within one Node process,
  so the check-then-insert has no interleaving window), `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me` — the identity bootstrap surface itself.
- `GET /api/skills/discover` — a bounded scan of a fixed repo-relative directory, no secrets, no
  workspace concept.
- The SPA shell fallback (`app.get("*", ...)`) — serves only the static client bundle; every real
  data call it makes is separately authorized.

Every other route requires at minimum `requireAuth`. This is enforced as a source-level
regression test (`test/api-security-routes.test.ts`), not just documented intent.

### 10. CSRF defense-in-depth

`SameSite=Lax` on the session cookie is the primary defense (a Lax cookie is not sent on a
cross-site POST/PUT/PATCH/DELETE from another origin in any modern browser). A second, independent
layer — `requireSameOrigin` — is applied globally to every state-changing request: if an `Origin`
header is present, it must match the request's own `Host`. No `csurf`-style token dependency was
added (that package is unmaintained upstream); both layers are self-contained.

### 11. Master Admin enforcement

Every `/api/master-admin/*` and `/api/backup/*` route requires `requirePlatformAdmin`
server-side. Sidebar visibility (`SidebarNav.tsx` / `App.tsx`) is convenience only — hiding a link
is not a security boundary, and a direct API call from a non-admin correctly receives `403`
regardless of what the UI shows.

## Consequences

- Every real data surface built in Pass I/II now sits behind a real identity and membership
  check, verified live (not just unit-tested) against a real running server: anonymous callers
  blocked, cross-workspace access blocked, workspace-role escalation blocked, platform-admin
  routes blocked for standard users and reachable for the real platform admin, and platform
  admin does not silently bypass ordinary workspace scoping.
- The application now requires a login step to be usable at all — a deliberately bare
  (`src/components/AuthGate.tsx`) setup/login gate exists so the product remains operable, not a
  fully designed onboarding flow.
- `WorkspacesView.tsx`, found disconnected from real data during this pass's tracing, was rebuilt
  against `GET/POST /api/master-admin/workspaces` and is now the first place workspace switching
  is a real, meaningful action rather than fully-local fake state.
- User management (list/disable users, assign workspace membership) exists as real, guarded API
  routes (`GET /api/master-admin/users`, `PATCH /api/master-admin/users/:id/status`,
  `POST /api/master-admin/workspaces/:id/members`) without a dedicated UI panel yet — a real,
  acknowledged gap, not a silently-claimed feature.
