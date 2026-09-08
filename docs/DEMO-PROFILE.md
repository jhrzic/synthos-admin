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
- **Overview (default landing screen)** — Pass X. Real workspace summary (task/graph/receipt/Vault-
  artifact/skill/external-execution counts, all real SQL `COUNT`/`SUM`), real recent-activity feed,
  real runtime-status section (same evidence Master Admin uses), an honest empty state for a
  workspace that hasn't done anything yet. See the finding below for what this replaces.
- **Rate limiting, terminal dev-only gate, security headers** — all provable by hitting a real
  running instance (see `docs/PRODUCTION-READINESS.md`).
- **Jarvis and Apollo voice input (microphone)** — real browser-native speech capture (Chromium/
  WebKit only; Firefox shows an honest "unsupported" state), real permission/error states (never a
  faked "Listening"), and real transcript routing: a spoken Jarvis command reaches the same
  dispatcher a typed one does, and an Apollo command never leaks to Jarvis or to a generic chat
  reply. Requires HTTPS in production (or `localhost` in development) — the browser's Web Speech
  API refuses to run otherwise. Live audio capture itself needs a real microphone and a real human
  speaking — it cannot be demoed in a headless/automated environment, only the surrounding
  capability/permission/routing behavior can (see `docs/PRODUCTION-READINESS.md`'s Voice input
  section). Apollo's *voice output* (TTS) and its *task execution* after a command is heard are
  separate concerns from hearing it — see the row below for what execution actually goes through.

## Requires real credentials to demonstrate live

Grouped by what each one gates, not exaggerated — every row below is honestly `NOT_CONFIGURED` in
this environment until the named variable is set.

**REQUIRES GEMINI** (`GEMINI_API_KEY`): model-backed skills, `/api/generate`, live graph execution,
Jarvis NLU fallback, Overview's "AI Provider" runtime-status chip.

**REQUIRES OPENROUTER** (`OPENROUTER_API_KEY`): the Model Router screen's live free-model catalog
sync (falls back to a real-but-static local catalog without it) — even with a real key, `OPENROUTER`
itself has **no execution mapping wired** (`classifyModelRequest` reports it `UNSUPPORTED`), so this
only ever affects what the catalog *displays*, never what SynthOS can actually execute.

**REQUIRES HERMES RUNTIME** (a real, documented Hermes contract at `HERMES_ADAPTER_BASE_URL`):
`execute()`/`events()`. Not configured, and the intended integration target itself is an open
question — see `docs/adr-007-launch-security-boundaries.md` and the Hermes row in
`docs/PRODUCTION-READINESS.md`.

**REQUIRES WINDMILL** (`WINDMILL_BASE_URL`/`TOKEN`/`WORKSPACE`): external execution
(submit/status/result/cancel). Not configured — client and orchestration are real and
contract-tested against a local mock server (Pass VI), never verified against production Windmill.

**REQUIRES EXTERNAL MCP** (at least one real, reachable MCP server): MCP-backed skills. None
configured — client is real and tested against local mock servers.

**REQUIRES FISH AUDIO** (`FISH_AUDIO_API_KEY`): Jarvis/Apollo TTS output and barge-in. Not
configured in this environment; when it is, `testFishAudioConnection`'s failure path now honestly
reports a failed connection instead of a disguised success (Pass X fix — see
`docs/PRODUCTION-READINESS.md`).

**Also credential-gated, not in the six categories above:** live TON Center/TONAPI probes need
`TONCENTER_API_KEY`/`TONAPI_API_KEY`.

## A finding from Pass VIII, closed in Pass X

The application's **default landing screen** ("Overview") previously showed entirely fabricated,
static demo data inherited from the pre-SynthOS Mission Control fork — invented agent counts,
invented "LIVE"/"PARTIAL" provider badges for products this codebase never integrated with (Cursor,
Antigravity, OpenClaw, Codex), an invented pipeline-completion percentage, and a global header
(rendered on every screen) with four of its six status chips hardcoded regardless of real state.

**This is now closed.** Overview is a full rewrite against a real backend
(`lib/overview.ts` / `GET /api/overview`) — see the entry above and
`docs/IMPLEMENTATION-STATUS.md`'s Overview row for the complete list of what was fabricated and how
each piece was fixed. The default landing screen is now representative of the rest of this
document; there is no longer a need to detour through Master Admin just to see real data.

**One thing surfaced during this pass that needs the user's own input, not a code fix:** a
Knowledge/Vault-graph screenshot supplied at the start of Pass X does not correspond to any
reachable screen in this exact repository — its apparent source files have had zero importers
anywhere in `src/` since the very first commit in this repo's history. See `docs/UI-IA-AUDIT.md`
finding #6 for the detail; worth confirming whether that screenshot came from a different
checkout or a stale server before anyone spends effort on it.
