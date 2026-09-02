# ADR-004: Second-User Onboarding, Account Lifecycle, and the Last-Admin Invariant

**Status:** ACCEPTED — 2026-09-02, Platform Completion Pass IV.
**Location:** `~/synthos/synthos-admin/docs/adr-004-user-onboarding-lifecycle.md`

This document records the real onboarding and account-lifecycle model added in Pass IV. It builds
directly on ADR-003 (identity, sessions, workspace authority) and does not reopen it — this ADR
covers only what ADR-003 left for a later pass: how a *second* account comes into existence, how
it activates, and what happens when the platform's only administrator account is at risk of being
locked out or disabled.

---

## Context

ADR-003 gave SynthOS real local accounts, real server-side sessions, and real workspace
membership. It did not answer how a **second** account gets created. The only account-creation
path was `POST /api/auth/setup` — the one-time bootstrap that creates the *first* account and
makes it `platform_admin`. There was no way for that admin to bring a second person onto the
platform, no concept of an account existing but not yet usable, and no protection against an
admin action leaving the platform with zero people able to administer it.

Two hard constraints, confirmed by re-checking the codebase before designing anything:

- **No email-sending infrastructure exists anywhere in this repository.** Not a stubbed one, not
  a disabled one — none. Any onboarding design that assumes "send them an email" would be
  fabricating a capability this app does not have.
- **No client-side router exists.** The SPA has zero routing library. A `/setup/<token>` URL only
  works because Express's SPA catch-all (production) and Vite's `appType: "spa"` dev middleware
  both already serve `index.html` for any unmatched path — confirmed by reading `server.ts`
  directly rather than assumed.

## Decisions

### 1. A third account status: `setup_required`

`users.status` was `'active' | 'disabled'` (ADR-003). Pass IV adds `'setup_required'` — a real,
distinct lifecycle state, not a flag bolted onto `active`:

```
setup_required  →  active  →  disabled
                     ↑___________|
                (re-enable, same account)
```

An account created by an admin (`createPendingUser()`) starts in `setup_required`. Its
`password_hash`/`password_salt` are a real scrypt hash of a random 32-byte value generated and
then immediately discarded — never stored, never logged, never returned. This makes `login()`
cryptographically impossible for a `setup_required` account: there is no password anyone could
guess or be told, by design, not by a status check that could be bypassed.

### 2. Activation is a one-time setup token, not an email link

Since no email path exists, the admin who creates the account is handed a raw token **exactly
once**, in the `POST /api/master-admin/users` response body, and must deliver it to the new user
themselves (Slack, in person, whatever channel they already use). The UI states this outright:
"No email will be sent" — never implying delivery that cannot happen.

Server-side, only `sha256(rawToken)` is ever persisted (`setup_tokens` table). Properties enforced
by `resolveSetupToken()`:

- **Single-use** — `used_at` is set on `completeSetup()`; a reused token is rejected.
- **Expiring** — 24-hour TTL (`SETUP_TOKEN_TTL_MS`), checked against `expires_at`.
- **Bound to `setup_required`** — if the underlying user is somehow no longer in that state (e.g.
  already activated through another path), the token is rejected even if otherwise valid. A token
  is a capability to *activate a specific pending account*, not a general-purpose credential.

`completeSetup(rawToken, password)` sets a real password, flips status to `active`, marks the
token used, and calls the existing `login()` internally so the user is immediately signed in —
one step, not "activate, then separately log in."

### 3. The last-active-platform_admin invariant

This codebase has **no account-recovery path** — no email reset, no support-ticket flow, nothing.
If the only active `platform_admin` account is demoted or disabled, the platform becomes
permanently unadministrable from inside itself. That is a real, structural risk this pass
introduces the *ability* to trigger (it didn't exist before because there was no second-user
management surface at all), so it must close it in the same pass that opens it.

`countActivePlatformAdmins()` counts active accounts with `platform_role = 'platform_admin'`.
Both mutation paths check it before acting and refuse (HTTP 409, not a silent no-op) when the
result would be zero:

- `setPlatformRole(userId, 'standard')` — demoting the last admin.
- `setUserStatus(userId, 'disabled')` — disabling the last admin.

This is enforced **server-side only**. The UI shows a "Disable User" / "Revoke Platform Admin"
button on every account including the sole admin — the button is not hidden or disabled
client-side, because a hidden button is not a security control. The server's refusal is the
control; the UI simply surfaces the resulting error.

### 4. Every mutation writes a real audit event

`admin_audit_events` (Pass IV, `lib/audit.ts`) is a small, purpose-built table — deliberately
**not** a reuse of the pre-existing `activity_events` table, which has `task_id TEXT NOT NULL`
and only a task-scoped reader (`getTaskActivityEvents(taskId)`). Reusing it would have meant
fabricating fake task ids for non-task admin actions, which is the wrong architecture, not a
shortcut. `admin_audit_events` matches the codebase's existing convention of small, purpose-built
event tables (`skill_test_events`, `kil_observations`, `ton_telemetry_events`) rather than one
universal log.

Every authority-mutating route — user create/disable/enable/role-change, workspace create,
membership assign/role-change/remove, setup-token issuance — writes one row: actor, event type,
target type/id, and a small detail payload. Master Admin's "Recent Admin Activity" panel reads
this table directly; it is not a separate, parallel feed that could drift from what actually
happened.

## What this does not change

- **Workspace membership** (`workspace_memberships`, ADR-003) is untouched — `removeMembership()`
  remains a real hard `DELETE` with no invented "last owner" invariant. That schema has no
  `owner` role distinct from `admin`, and a workspace with zero members is recoverable by any
  platform_admin re-granting membership — unlike the last-admin case above, which has no recovery
  path at all. The two are genuinely different risks and are not given the same guard.
- **Session/CSRF/cookie model** (ADR-003 §§3-4) is unchanged. `completeSetup()` calls the existing
  `login()` rather than duplicating session-issuance logic.
- **No SSO/OAuth/email verification was added.** This ADR describes how the platform works with
  the constraints it actually has, not a plan to add the infrastructure it doesn't.

## Verification

Live-verified against a real running server (not just unit tests): platform admin creates a
pending user → real setup token issued → workspace created → membership granted → setup token
resolved and completed (real auto-login) → new user's session correctly scoped to only their
granted workspace, a real `403` on the workspace they were never granted → user disabled →
**existing session immediately `401`s** (server-side revocation takes effect without waiting for
the client to reload or the token to expire) → fresh re-login correctly rejected → attempting to
demote/disable the sole remaining active admin correctly returns `409` → the real audit trail
(`GET /api/master-admin/audit`) captured every one of these events, in order, with the correct
actor and target. Confirmed a second time visually in a real browser session (Master Admin Users
list/detail, workspace switcher, identity counts, and the audit panel all rendering the same real
data, not a separate mocked view).
