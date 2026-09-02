# SynthOS Admin — Truthful Demo Profile

What this application can genuinely demonstrate **today**, with the credentials actually present in
a given environment — no fake-data mode, no mock fallback dressed up as a feature. Every item below
is either verified live in Pass VII/VIII or backed by a passing automated test; nothing here is
aspirational.

## Available with zero external credentials (verified live this pass)

The entire authority/verification/receipt spine works end to end without any API key:

- **Auth** — first-admin bootstrap, session login/logout, second-user onboarding via a real
  one-time setup token.
- **Workspaces** — creation, membership grant/role-change/removal, cross-workspace isolation.
- **Deterministic skill execution** — `vault.list`/`memory.search`-class skills run for real.
- **Task pipeline** — task lifecycle, artifact write to a real Vault file, deterministic Aegis
  verification, a real Ed25519-signed receipt, independent signature re-verification.
- **KIL** — the gate scores real output, promotes/doesn't promote per its real formula.
- **Vault** — real filesystem-backed notes, listable and readable per workspace.
- **Memory** — real SQLite FTS5 full-text search over indexed Vault content.
- **TON (local capabilities)** — readiness checklist, guardian installation, telemetry recording;
  live TON Center/TONAPI probes need real credentials (see below).
- **Backup / restore** — real archive creation, independent checksum re-verification, a full staged-
  restore drill proving the restored data is byte-correct (this pass added a drill that opens the
  restored database directly and queries it, not just checks the file exists).
- **Admin** — Master Admin's real diagnostics, user/workspace management, audit trail, runtime
  status aggregator (every row honestly `NOT_CONFIGURED` for anything actually unconfigured).
- **Rate limiting, terminal dev-only gate, security headers** — all provable by hitting a real
  running instance (see `docs/PRODUCTION-READINESS.md`).

## Requires real credentials to demonstrate live

| Feature | Needs | Current state here |
|---|---|---|
| Model-backed skills, `/api/generate`, live graph execution, Jarvis NLU fallback | `GEMINI_API_KEY` | Not configured |
| Hermes dedicated runtime (`execute`/`events`) | A real, documented Hermes contract at `HERMES_ADAPTER_BASE_URL` | Not configured, and the intended integration target itself is an open question this pass — see `docs/adr-007-launch-security-boundaries.md` and the Hermes row in `docs/PRODUCTION-READINESS.md` |
| Windmill external execution (submit/status/result/cancel) | `WINDMILL_BASE_URL`/`TOKEN`/`WORKSPACE` pointed at a real instance | Not configured — client and orchestration are real and contract-tested against a local mock server (Pass VI), never verified against production Windmill |
| MCP-backed skills | At least one real, reachable MCP server | None configured — client is real and tested against local mock servers |
| Fish Audio TTS / Apollo barge-in | `FISH_AUDIO_API_KEY` | Not configured |
| Live TON Center / TONAPI probes | `TONCENTER_API_KEY` / `TONAPI_API_KEY` | Not configured |

## A finding from this pass worth knowing before demoing

The application's **default landing screen** ("Overview," and its sibling "Kanban"/"Active
Runs"/"Agent Wireframe" screens under the OPERATIONS/WORKSPACES sidebar sections) is inherited,
pre-SynthOS-transformation Mission Control UI showing **entirely fabricated, static demo data** —
invented agent counts, invented "LIVE" provider rows for products this codebase doesn't integrate
with (Cursor, Antigravity, OpenClaw), an invented "22% Complete" pipeline. This was discovered via
a real browser walkthrough in this pass, not assumed.

The **real, live-data-driven surface** (the one every other section of this document describes) is
reached via the sidebar's "MASTER ADMIN" section — labeled "Hermes Admin" for the runtime-diagnostics
sub-tab specifically, which is confusing but does route to the genuine, tested backend. **For any
demo, navigate directly to Master Admin rather than relying on the default landing view** — the
Overview screen a stranger sees first is not representative of what the rest of this document
describes, and showing it in a demo would show fabricated data. Wiring the default Overview screen
to real data (or replacing/removing it) is this pass's single highest-priority recommended next
task — see the final section of the Pass VIII report.
