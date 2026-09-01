# SynthOS Administrative Control Plane Architecture

> **System Prompt Directive:**
> You are maintaining SynthOS Admin, a unified control-plane architecture. Preserve the existing single-pane application structure. Do not create fragmented navigation shells, duplicate model dashboards, or localized sub-apps. Jarvis is a global system service, not a workspace component. Apply an authentic high-density dark aesthetic inspired by airbyte.com. Focus on incremental, bounded functional changes rather than rebuilding layouts or navigation trees.

---

## Operating Directives

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
- **Single-Pane Unified Control Plane**: Maintain a unified architecture with clear left rail major sections (OPERATIONS, WORKSPACES, BUILD, KNOWLEDGE, GOVERNANCE, PRODUCTS, SYSTEM, MASTER ADMIN) and contextual workspace top navigation.
- **Global Jarvis Engine**: Jarvis operates as a global system service and HUD, not as a siloed workspace component.
- **Authentic Airbyte Dark Aesthetic**: High-density dark UI with deep dark neutrals (`#05060A`, `#080A16`), `#615EFF` primary brand accents, subtle `#1A1D33` borders, and typography pairings (Plus Jakarta Sans, Space Grotesk, JetBrains Mono).
- **Incremental & Bounded Changes**: Avoid rebuilding layouts, deleting valid working routes, or generating disjointed navigation shells.
