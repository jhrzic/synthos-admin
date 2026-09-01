# ADR-002: Jarvis as a Non-Removable Global Architecture Invariant

## Status
APPROVED (Canonical Architecture Invariant)

## Context
SynthOS is a unified multi-agent operating system and administrative control plane hosting independent workspaces (Hermes, Gemini, Claude, Codex, Cursor, Antigravity, OpenClaw, and Orchestrator). 

During workspace, navigation, or runtime refactoring, there is a risk that the global Jarvis assistant could be mistakenly localized, nested into a specific agent workspace (e.g., Hermes), merged with workspace-specific audio components (e.g., Apollo), or orphaned/removed during navigation cleanups.

## Decision & Architectural Invariants

1. **Mandatory Global System Service**:
   - Jarvis is a mandatory global SynthOS system service mounted once at the application shell level (`src/App.tsx`).
   - Jarvis is independent of Hermes and independent of any single model or runtime engine.
   - Jarvis serves as the global command, orchestration, and voice interface for the entire SynthOS control plane.

2. **Cross-Workspace Persistence**:
   - Jarvis remains mounted, reachable, and active across all workspaces (Hermes, Gemini, Claude, Codex, Cursor, Antigravity, OpenClaw, Orchestrator, and future workspaces).
   - Switching workspaces or active tabs does not unmount, recreate, or reset global Jarvis shell components (`JarvisOverlayHUD`, `GlobalVoiceOverlay`, `AirbyteHeader` Jarvis Orb, and `CommandPalette`).

3. **Strict Separation from Hermes Apollo**:
   - Apollo is a Hermes-specific voice/audio bridge dedicated to the Hermes workspace and `/api/apollo/*` backend routing.
   - Apollo is not global Jarvis. Apollo must never be promoted to global Jarvis ownership, and Jarvis must never be merged into Apollo.

4. **Explicit Prohibitions**:
   - Jarvis is NOT a Hermes feature.
   - Jarvis is NOT a workspace-specific child component.
   - Jarvis is NOT removable during navigation or layout cleanups.
   - Jarvis is NOT optional during workspace refactors.

## Compliance and Enforcement
- Automated regression suite verifies shell-level mounting across all workspace switches.
- Code-level invariants prevent nesting Jarvis within any workspace subtree or creating duplicate instances.
