# Days 2–3 Evidence Report — Vault Integration + Voice Configuration Truth

**Date:** 2026-09-12 · **Repo:** `synthos-admin` · **Branch:** `fix/p0-jarvis-voice-and-knowledge-mesh`
· **Base commit:** `8beeb19` · **Nothing committed.**

Day 1 findings are preserved unchanged. Production remains **SHIPPABLE / NOT YET SHIPPED** —
`BLOCKED — USER ACTION REQUIRED` on the host, and nothing below alters that.

---

## PART A — Knowledge / Vault Integration

### The verified negative this closes

> "Obsidian is NOT integrated. `lib/vault.ts` hardcodes `process.cwd()/vault`; there is no
> vault-path environment variable, no watcher, and no reader for the real ~1,204-note vault."
> — `docs/EVIDENCE-CLEANUP-2026-09-12.md` §9

### The safety decision, stated once

**Two roots, deliberately.** It would have been simpler to repoint `VAULT_ROOT` at the user's real
vault. That would have been wrong, and it is not what was built:

| | What it is | What happens to it |
|---|---|---|
| `VAULT_ROOT` (`lib/vault.ts`) | SynthOS's **internal artifact store** — server-generated filenames, `workspaces/<id>/` layout, every file joined to an `artifacts` row | **UNCHANGED.** Repointing it would pour machine-named files into a human's notes and orphan every existing `artifacts.relative_path` |
| Knowledge vault (`lib/vault-config.ts`) | The **user's own vault** | Read for structure; written **only** beneath one bounded `SynthOS/` subdirectory |

They are the same directory in local development. They occupy different subtrees of it.

### Configuration — one source, one fallback

`SYNTHOS_VAULT_PATH` → else repo-local `./vault`. One level of precedence, on purpose: a second
competing source is exactly what produced the voice mismatch in Part B, and one variable cannot
drift against itself. A leading `~/` is expanded, because a `.env` value is never shell-expanded and
a literal `~` directory is a confusing failure.

### Truth states — every field is a syscall

`mode` is `EXTERNAL` / `LOCAL_FALLBACK` / `UNAVAILABLE`, alongside `configured`, `exists`,
`isDirectory`, `readable`, `writable`, `synthosDirExists`, `markdownFileCount`, `watcher`,
`desktopAppDetected`.

Three rules that are asserted, not just intended:

- **A configured-but-broken path is `UNAVAILABLE`, never silently downgraded to the fallback.** The
  alternative would let an operator believe their vault was integrated while knowledge went
  somewhere else entirely.
- **A configured external path is never auto-created.** A typo must surface as a fault, not
  manufacture an empty directory in the user's filesystem and report success into it. The local
  fallback *is* created on demand — it is inside the repo and its absence is meaningless. The
  asymmetry is the point.
- **`watcher: 'NOT_IMPLEMENTED'`** is stated rather than omitted, so its absence cannot read as
  "active". **`desktopAppDetected` influences nothing** — proven by a test that runs the same
  resolution with it true and false and asserts every other field is identical.

### The five required proofs

| Test | Result | Evidence |
|---|---|---|
| **A** — a real conversation produces a semantically named artifact in the configured vault | **PASS** | `SynthOS/Conversations/Northfield-Sleep-Co-mattress-serta-icomfort-deliver__2026-09-13.md` — written by a real anonymous web conversation through the real HTTP API |
| **B** — an execution result / receipt is associated with provenance | **PASS** | That note's frontmatter carries `receipts: ["rcpt-1789270739308-c10587"]`, `artifacts: ["art-1789270739307-947d10bb3a59"]`, `session_id`, `workspace`, `runtime`, `topics` |
| **C** — findable by topic, not by timestamp | **PASS** | `?q=mattress` → matched **filename**; `?q=Northfield store` → matched **content**, with a real snippet |
| **D** — configuration persists across restart | **PASS** | Process killed and restarted: `KNOWLEDGE_VAULT: READY`, `mode: EXTERNAL`, `markdownFileCount: 4`, the note still present |
| **E** — invalid paths degrade truthfully | **PASS** | Typo path → startup `KNOWLEDGE_VAULT: FAILED`, directory **not** created, and the conversation summary still produced `aegisDecision: VERIFIED` with a receipt while reporting `knowledge.written: false` and the real reason |

**Test E matters most.** A misconfigured vault must never break a live customer conversation, and
must never silently claim to have saved knowledge. Both hold.

### The user's data was not touched

A stand-in vault was built with pre-existing notes, then a real conversation was run against it:

```
shasum -a 256 -c before.sha
  Daily/2026-09-01.md:    OK
  Projects/Kitchen.md:    OK
  README.md:              OK

ls -a vault/  ->  . .. .obsidian Daily Projects README.md SynthOS
```

Every pre-existing file byte-identical, `.obsidian/` untouched, and exactly one new top-level entry.
Also asserted by test at the mtime level: a note that was not rewritten must have an unchanged
mtime. The module has **no rename, move, delete, or bulk-rewrite path at all.**

`listKnowledgeNotes()` reads only the `SynthOS/` subtree — SynthOS never inventories the user's own
notes.

### Semantic naming, and the invariant it had to be reconciled with

`writeWorkspaceArtifact` **deliberately never** derives a filename from a title — its header
explains that two artifacts sharing a title must be structurally unable to collide. That is correct
for the internal store and is left untouched. It is wrong for a human's vault, where
`art-1789268520547-45f9e0.md` is unfindable.

Both hold at once: the name is **semantic**, and collisions are impossible by **atomic exclusive
create** (`fs.openSync(path, 'wx')`), incrementing on `EEXIST`. `'wx'` fails if anything is at the
path — **including a symlink** — so this is the same anti-symlink-overwrite posture the internal
writer has, achieved by the syscall rather than by an `lstat` check a racing process could slip past.

Proven: three notes with an identical subject produced `…__2026-09-13.md`, `-2`, `-3` with the first
two intact; a symlink planted at the target name was **not** written through (its target still reads
`ORIGINAL CONTENT`); `../../etc/passwd` as a title stays inside `SynthOS/`.

Subject derivation is **deterministic** — no model call. A knowledge note must be reproducible, cost
nothing, and not become one more thing that breaks when no provider key is configured.

### A defect found by the end-to-end run, not by inspection

The first real note had **two YAML frontmatter blocks**: the embedded conversation summary is also a
standalone artifact and carries its own `---` header. Obsidian parses the first and renders the
second as a stray horizontal rule followed by raw `key: "value"` lines. Fixed by
`stripLeadingFrontmatter()`, which touches only a block at the very start — a `---` used as a real
horizontal rule later in a document is left exactly as written. Three tests cover it.

### Source matrix — what is actually ingested

**Universal ingestion is NOT claimed.** One source is connected. Every other named runtime is listed
at its real state rather than omitted:

| Source / runtime | Ingestion state | Evidence |
|---|---|---|
| Business Conversation AI (web) | **LIVE** | `lib/conversation/service.ts::summarizeConversation` writes a knowledge note with receipt + artifact provenance. Proven end-to-end above |
| Aegis receipts / verified execution | **LIVE** (as provenance) | `receipts: [...]` in frontmatter, linked to a real Ed25519-signed receipt |
| Jarvis sessions | **NOT_CONNECTED** | `lib/jarvis-sessions.ts` persists to SQLite; no knowledge writer is wired to it |
| Graph / task execution | **NOT_CONNECTED** | `lib/fabric/kernel.ts` writes internal artifacts via `writeWorkspaceArtifact`; no knowledge note |
| Scheduler / recurring work | **NOT_CONNECTED** | Same — internal artifacts only |
| Hermes runtime | **BLOCKED** | `execute()` is `NOT_IMPLEMENTED` regardless of configuration (ADR-001 Phase 3). Nothing to ingest |
| Windmill external executions | **NOT_CONNECTED** | Ledger exists; no knowledge writer |
| Voice directives | **NOT_CONNECTED** | No knowledge writer |
| Claude / Gemini / OpenAI / Codex / Cursor / Antigravity / OpenClaw | **NOT_IMPLEMENTED** | No integration of any kind exists in this codebase for these as knowledge sources |
| Filesystem watcher / sync | **NOT_IMPLEMENTED** | Reported as such in `VaultStatus.watcher` |

**Activity vs Knowledge is preserved.** `activity_events` and `runtime_events` stay as granular as
they were. The vault receives few, meaningful files. Nothing writes one file per runtime event, and
nothing produces `Assistant-Log-<timestamp>.md`.

---

## PART B — Voice Configuration Truth

### The real cause, found by tracing rather than by mirroring one UI onto another

`configuration source → persistence → API → dashboard → runtime → provider` turned up **two**
genuine causes:

**1. Which provider speaks lived in the browser.** `src/App.tsx` initialised `voiceConfig` from
`localStorage['hermes_voice_config']`, defaulting to `web_speech`, and wrote back to it. The server
never saw it, never stored it, could not report it. **Two browsers disagreed with each other and
both disagreed with the runtime** — and a cleared cache silently changed the "current configuration".
The dashboard was not reading runtime configuration at all.

**2. The voice id was still browser-sourced, and silently won.** `src/services/fishAudio.ts`
read a voice id from **two** localStorage stores, and the client sent it in the request body —
where `resolveFishConfig` gives a request-supplied `reference_id` **precedence over the server
store**. So a stale value in one browser overrode the configured voice while the configuration
screen went on displaying the server's value. A **hardcoded fallback id** made it worse by
guaranteeing some voice always came out, so the misconfiguration never surfaced as a failure.

That file's own header already documented the *first half* of this bug (the API key, fixed
earlier — "Jarvis read the one it was NOT saved in"). The voice-id half survived it.

### What changed

- `lib/voice-settings.ts` — one canonical server-side store, and `resolveVoiceRuntime()`, which is
  **the same function the dashboard reads and the description of what the runtime does**. There is
  no second path that could report something different from what happens.
- `GET/PUT /api/voice/runtime-config` — read and write that configuration. `PUT` returns the
  **resolved** config, not the raw row, so the caller sees what the runtime will actually do.
- `src/App.tsx` — the client is now a **cache** of server state, hydrated on load. `speed` remains
  local because it is a playback preference, not runtime configuration.
- `src/services/fishAudio.ts` — localStorage reads and the hardcoded fallback **removed**. It now
  returns `''` when the caller supplies nothing, so the server resolves its own stored voice.

### Five identities, kept distinct

`agentDisplayName` · `voiceProfileName` · `provider` · `providerVoiceId` · `ttsModel` — five
columns, five fields. Asserted: an opaque provider voice id never determines the agent name (and
specifically is never `"Jarvis"`), and changing the voice id leaves the agent name untouched.

STT is deliberately **not** in this table: recognition runs in the visitor's browser via the Web
Speech API, no audio reaches the server, and there is no server-side STT provider or model to
configure. Recording one would imply a choice that does not exist.

### Runtime proof — change → save → restart → persists → provider actually invoked

| Step | Result |
|---|---|
| Dashboard reads before any change | `provider: web_speech`, `providerSource: default`, names `null` (never an invented placeholder) |
| Set agent `Avery`, profile `Warm British`, provider `fish_audio` | Saved; immediately `ready: false` — *"No Fish Audio API key is configured"* |
| Save voice id + model through the existing credential route | `providerVoiceId: 7f92f8afb8ec…`, `ttsModelSource: server_store`, `ready: true` |
| **Voice test** | Real call to Fish Audio with the configured model and voice → **`PROVIDER_AUTH_REJECTED`, `{"status":401,"message":"Invalid Token"}"`** |
| **Restart (new process, same DB)** | `Avery` / `Warm British` / `fish_audio` / `7f92f8afb8ec…` / `s2.1-pro` / `ready: true` — **all persisted** |
| Change provider only | Agent name and voice profile **survive** — a partial save never wipes the others |
| Unsupported provider | Rejected: *"This build can use: web_speech, fish_audio, elevenlabs, openai."* |

**The 401 is the proof, not a failure.** The key supplied was deliberately fake. A real HTTP call
reached Fish Audio carrying the configured model and voice id, and the result was reported honestly
instead of being dressed up as a pass. The test takes **no** provider/voice/model override on
purpose — a test that accepts overrides proves *some* path works, not that *the configured* path
works, which is exactly how a voice test passes while the runtime stays silent.

`web_speech` returns `BROWSER_SIDE`, not `PASS`: the server produces no audio for it, so claiming a
pass would be claiming evidence that does not exist.

No credential value appears in any response, log, or the resolved config — asserted by test.

### Microphone path — `HUMAN VERIFICATION REQUIRED`

Microphone hardware **is** present on this machine (unlike the Pass IX sandbox). It still cannot be
proven from here, for two reasons, the second of which automation cannot solve:

1. The macOS microphone permission dialog is outside the page DOM and cannot be granted by automation.
2. **There is no way to produce actual speech to be transcribed.** Even with permission granted,
   nothing here can speak.

"Wired in code" is not promoted to "verified working". Exact procedure for a human:

1. Start the server with a real `FISH_AUDIO_API_KEY` (or set the provider to `web_speech`).
2. Open the app over **https or `localhost`** — `SpeechRecognition` requires a secure context.
3. Open Jarvis → Global Voice Core, click the microphone, and **grant** the OS prompt.
4. Say: *"What is the delivery policy?"*
5. **Confirm in order:** the transcript appears; it auto-submits (Pass IX fixed a bug where it did
   not); a reply is produced; audio plays.
6. Confirm provenance in DevTools → Network → the `/api/voice/tts` response headers:
   `X-Voice-Provider`, `X-Voice-Model`, `X-Voice-Reference-Id` must match
   `GET /api/voice/runtime-config`.

Step 6 is the one that matters — it proves the chain end-to-end rather than proving that *a* sound
came out.

---

## Verification

| | |
|---|---|
| Tests | **1,336 passed** (was 1,284) across **82 files** |
| Repeated-run stability | **5 consecutive full runs, all exit 0** |
| Typecheck | `tsc --noEmit` clean |
| Build | `npm run build` exit 0 |
| Repo / branch | `synthos-admin` · `fix/p0-jarvis-voice-and-knowledge-mesh` |
| Commit | **Nothing committed.** Base `8beeb19`; all work is in the working tree |

No assertion was weakened. The Day 1 `testTimeout` change (a time budget, not an assertion) stands
and is unrelated to these files.

### Defect classification

| Defect | Classification |
|---|---|
| Voice provider stored only in browser localStorage | **Pre-existing** |
| Voice id read from two localStorage stores and overriding the server store | **Pre-existing** |
| Hardcoded fallback voice id masking misconfiguration | **Pre-existing** |
| No vault path configuration / no Obsidian integration | **Pre-existing** (recorded 2026-09-12) |
| Double YAML frontmatter in knowledge notes | **Introduced by this work**, found by its own end-to-end run, fixed, covered by 3 tests |
| Microphone end-to-end proof | **Environment limitation** — no way to produce speech |

### Files changed

**New:** `lib/vault-config.ts` · `lib/knowledge-vault.ts` · `lib/voice-settings.ts` ·
`test/knowledge-vault.test.ts` · `test/voice-configuration-truth.test.ts` · this file

**Modified:** `lib/conversation/service.ts` · `lib/env-readiness.ts` · `server.ts` · `src/App.tsx` ·
`src/services/fishAudio.ts` · `.env.example`

### Blockers

| Blocker | Owner |
|---|---|
| Production host / DNS / TLS | **USER ACTION REQUIRED** — unchanged from Day 1 |
| Microphone end-to-end proof | **HUMAN VERIFICATION REQUIRED** — procedure above |
| A real Fish Audio balance to prove a successful synthesis | **USER ACTION REQUIRED** — the 401 proves the path; a 200 needs credit |
| `SYNTHOS_VAULT_PATH` pointed at the real ~1,204-note vault | **USER DECISION** — proven against a realistic stand-in; not pointed at real personal data without being asked |

### Not done, deliberately

Filesystem watching, ingestion from Jarvis/graph/scheduler/Windmill, and FTS5 indexing of vault
notes. Each is a real feature and none was required by the stop condition. They are listed at their
true state in the source matrix rather than implied.
