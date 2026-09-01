# SynthOS Administrative Control Plane Architecture

> **Canonical System Directive:**
> SynthOS Admin is the canonical administrative control plane for the SynthOS multi-agent operating system. It manages independent agent and runtime workspaces, task dispatch, graph orchestration, model routing, tools and MCPs, shared memory and Obsidian/Vault integration, automation, governance through Guardian and Aegis, receipts, activity, and global Jarvis voice control.

---

## 1. System Host & Workspace Architecture

- **SynthOS Control Layer**: SynthOS is the host and administrative control layer.
- **Independent Workspaces**: Hermes, Claude, Gemini, Codex, Cursor, Antigravity, OpenClaw, and Orchestrator operate as independent workspaces managed within the unified control plane.
- **Jarvis Engine**: Jarvis is a global system service and HUD accessible system-wide across all workspaces. Jarvis is not owned by Hermes or any specific workspace.
- **Apollo Service**: Apollo is a Hermes-specific voice/audio bridge, separate and distinct from global Jarvis.
- **No Legacy Mission Control Product Silos**: Do not reintroduce the legacy Builderz/Mission Control architecture as the canonical product or wrap the app in model-specific UI silos.

---

## 2. Unified Navigation Rules

The application uses a single unified shell with a two-tier navigation structure that applies universally:

- **Left Rail**: Hosts major environments, workspaces, and system areas only (`OPERATIONS`, `WORKSPACES`, `BUILD`, `KNOWLEDGE`, `GOVERNANCE`, `PRODUCTS`, `SYSTEM`, `MASTER ADMIN`). Workspace child pages are strictly prohibited in the left rail.
- **Top Navigation (`WorkspaceTopNav`)**: Dynamically hosts contextual tools, runtime views, and capability matrix tabs specific to the active workspace.
- **Global Header**: Hosts global utilities and system-wide services, including the global Jarvis engine.
- **No Fragmented Shells**: Do not create duplicate dashboards, parallel navigation systems, or fragmented sub-apps.

---

## 3. Engineering & Verification Directives

- **PERSISTENT NON-DEMO BUILD RULE**: This is a real application, not a prototype.
  - Never use: mock data, placeholder data, fake telemetry, fake metrics, simulated APIs, fabricated backend responses, `setTimeout`-based tests, `Math.random`-based statuses/scores/latency/results, frontend-only state changes that pretend a real action succeeded, or preloaded `PASS` / `LIVE` / `CONNECTED` / `VERIFIED` states without evidence.
  - Every visible operational claim must be backed by at least one of:
    1. A real API
    2. A real runtime or process
    3. A real persistent database or storage system
    4. A real external service
    5. A verified deterministic local implementation
    6. A real execution result with evidence
  - If the real capability does not exist, do not simulate it. Display truthful states instead: `NOT_IMPLEMENTED`, `NOT_CONNECTED`, `NOT_CONFIGURED`, `UNTESTED`, `PARTIAL`, `BLOCKED`, `FAILED`, or `DEFERRED`.
  - A UI component existing is not evidence that the underlying capability works.
  - A button must do one of three things only:
    1. Execute a real backend action
    2. Navigate to a real configuration or system surface
    3. Be disabled with a truthful unavailable state
  - Never allow a button to merely change frontend state and imply success.
  - Never mark anything `COMPLETE`, `LIVE`, `PASS`, `CONNECTED`, `VERIFIED`, `OPERATIONAL`, `HEALTHY`, or `READY` without real execution evidence.
  - Do not optimize for making the dashboard look complete. Optimize for making the underlying capability actually work.
  - If a capability cannot be verified, state exactly what is missing or blocked instead of inventing success.
- **Evidence-Based Status Badges**: Use status indicators (`LIVE`, `PARTIAL`, `NOT_CONNECTED`, `NOT_CONFIGURED`, `BLOCKED`, `FAILED`, `MISSING`, `DEFERRED`) strictly when supported by runtime verification evidence.
- **Zero Simulation / No Mock Stubs**: Do not create fake routes, simulated capabilities, or mock stub buttons to artificially fill navigation.
- **Capability Completion Standard**: Mark a capability complete only when real execution is proven with traceable runtime evidence.
- **Preserve & Extend**: Preserve existing working screens and integrations. Extend existing components and routes before creating replacements.
- **Bounded Incremental Execution**: Make bounded, incremental changes only. Do not redesign layouts, navigation, or visual styling unless explicitly requested.
- **Visual Design Integrity**: Preserve the high-density dark enterprise aesthetic (`#05060A`, `#080A16`, `#615EFF` accents, `#1A1D33` borders, and typography pairings).
