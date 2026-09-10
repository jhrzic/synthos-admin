# SynthOS Admin — Claude instructions (repo level)

Architecture, navigation rules and the non-demo build rule live in **`AGENTS.md`** — read it.
This file carries the rules that must be loaded into *every* Claude session in this repo.

> **Note on `~/synthos/CLAUDE.md`:** that path is a symlink into
> `mission-control/docs/synthos/CLAUDE.md`, which governs the **Mission Control** project, not this
> one. Repo-level rules for `synthos-admin` belong here.

---

## 🔴 STANDING RULE — PRODUCT PRESERVATION

> **"Dead", "demo", "mock", "prototype", "legacy", "unused", "unmounted", "orphaned", "static" and
> "hardcoded" describe IMPLEMENTATION STATE. They do NOT mean the product design should be
> discarded.**

Historical components may encode intentional SynthOS **UI/UX, workflows, navigation, information
architecture, animations, visualizations, editors, dashboards, controls and product concepts**.

### Evaluate two things separately, always

| | Question |
|---|---|
| **A. PRODUCT / UX VALUE** | What design intent does this encode? |
| **B. IMPLEMENTATION TRUTH** | `REAL` / `PARTIAL` / `MOCKED` / `STATIC` / `UNKNOWN` |

**A component with fake data may still contain the correct intended UX.** A low score on B never by
itself justifies discarding A.

### Preferred remediation

```
INTENDED HISTORICAL UX  +  CURRENT CANONICAL BACKEND  +  REAL/TRUTHFUL DATA
```

**NOT:** delete the rich UX because the previous backend was fake.

### The failure pattern this exists to stop

Proven twice in this repo's own history. Every individual step was defensible; the *pipeline* is
the failure, because it silently converts product design into deletable dead code.

```
rich UI  →  datasource judged fake/stale  →  component simplified or unmounted
         →  component becomes orphaned  →  dead-code cleanup deletes it
```

| Step | Obsidian Knowledge Mesh | Context Governor Telemetry |
|---|---|---|
| Rich UX mounted | `f6a2083` | `f6a2083` |
| Disconnected | `cd60d81` — `ObsidianView.tsx` 1150 → 388 lines against the real Vault API, orphaning `ObsidianGraphMind` + `VaultActivitySparkline` | `739c663` — truth sweep removed the `<ContextGovernorTelemetry />` mount because its telemetry was fabricated |
| Deleted as dead code | `fee6fe4` — "orphaned, zero React tree callers" | `fee6fe4` — same commit, same justification |

**This must not happen again.**

### Before deleting any component

1. **Zero callers is not sufficient grounds.** Zero callers is the *symptom* this rule is about.
2. Record product/UX value and implementation truth **in the commit message**.
3. Classify explicitly: `PRESERVE_AND_REWIRE` · `PRESERVE_VISUAL_UX_ONLY` ·
   `MERGE_WITH_CURRENT_SURFACE` · `KEEP_AS_REFERENCE` · `DO_NOT_RESTORE_DUPLICATE` ·
   `DO_NOT_RESTORE_INVALID_CONCEPT`.
4. A true duplicate may be removed — **prove the coverage first.** The one case that passed this
   bar: `HermesTopNav` was deleted in `fee6fe4` after `b21b1a1` replaced it, and all 25 of its tab
   ids are present in `WorkspaceTopNav`.

### This does NOT weaken the non-demo build rule (`AGENTS.md` §3)

`AGENTS.md` §3 still governs what may be **displayed**: fabricated metrics must be removed or
replaced with truthful states (`UNKNOWN`, `NOT_CONNECTED`, `NOT_CONFIGURED`, …).

The two rules combine as: **keep the surface, fix the data.**

When the real backend does not exist yet, render the surface with `UNKNOWN` rather than deleting
the surface. That is exactly how `VaultActivitySparkline` was restored in `3cfcac8` — real note
timestamps replaced hardcoded seeds, and a window with no dated notes reads
`NO DATED NOTES IN WINDOW — UNKNOWN` instead of drawing a convincing flat line.
