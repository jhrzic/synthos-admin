# AI Studio Divergence — Decision Record

**Status:** Closed, Step 8 (Execution Fabric consolidation pass).

## What "AI Studio" actually refers to in this repo

There is **no separate AI Studio prototype codebase** to audit against `synthos-admin`. This
repo was originally scaffolded using Google's AI Studio app-builder tool, and the only remaining
footprints of that origin are leftover artifacts inside this same, canonical repo — not a second
reference implementation living anywhere else. `docs/adr-001-hermes-adapter-governance.md`'s own
line — *"AI Studio scratchpads and any other unversioned environment are transient and never
product canonical"* — refers to this same generic sense (an ad hoc prototyping tool), not a named
directory with code to port or remove.

Three concrete footprints were found and classified:

| Footprint | Where | Classification | Action |
|---|---|---|---|
| `"Please configure X in AI Studio Secrets"` error wording | `server.ts` (Gemini/Fish Audio/OpenAI/ElevenLabs key-missing errors) | **REMOVE_FROM_CANONICAL_PLAN** | Fixed in Step 8 — now points at `.env`/the deployment shell's real environment, since this app runs as a standalone Node process, not inside an AI Studio container. |
| `runtime: "Node.js (AI Studio Container)"` | `server.ts`, `/api/master-admin/system/health`-style route | **REMOVE_FROM_CANONICAL_PLAN** | Fixed in Step 8 — now `"Node.js"`, since the real host is whatever machine actually runs the process, not an AI Studio container. |
| `"aistudio-build"` `User-Agent` header on Gemini SDK calls | `lib/fabric/model-gemini.ts`, `server.ts` (several `httpOptions.headers`) | **KEEP_AS_REFERENCE** | Harmless technical identifier, no user-facing claim, no fix needed. |

## UI copy audited against the user-named terms

The Step 8 instruction specifically asked about "Neural Speech Stream," "Directive Execution
Bridge," and "Hermes Voice Protocol." A repo-wide search found:

- **"Directive Execution Bridge"** and **"NEURAL SPEECH STREAM"** — real, present UI copy in
  `src/components/JarvisView.tsx`, labeling the Jarvis dialogue panel and its live speaking/standby
  indicator. Both are decorative sci-fi-style panel labels, not architectural claims — neither
  names a specific technology or mechanism that could be factually wrong, and the "TRANSMITTING /
  STANDBY" state they show is tied to the real `isSpeaking` flag. **KEEP_AS_REFERENCE** — cosmetic,
  accurate to what it displays, no change needed.
- **"Hermes Voice Protocol"** — does not exist anywhere in the current source. **UNKNOWN** — no
  live discrepancy to reconcile; nothing to remove or port.

## Governing rule going forward

Any future reference to "the AI Studio version" of a feature should be understood as "however this
repo's code looked before this consolidation pass, if it still had AI-Studio-scaffold artifacts in
it" — not a pointer to a second codebase. If a genuinely separate prototype/reference repo is ever
introduced later (e.g. a new Figma/AI-Studio spec asset, matching the pattern
`synthos-os-glass-orbit.html` already plays for the platform's visual design), it should get its
own entry in this file rather than being assumed to already be covered here.
