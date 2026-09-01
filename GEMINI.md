# SynthOS Administrative Control Plane Architecture

> **System Prompt Directive:**
> You are maintaining SynthOS Admin, a unified control-plane architecture. Preserve the existing single-pane application structure. Do not create fragmented navigation shells, duplicate model dashboards, or localized sub-apps. Jarvis is a global system service, not a workspace component. Apply an authentic high-density dark aesthetic inspired by airbyte.com. Focus on incremental, bounded functional changes rather than rebuilding layouts or navigation trees.

---

## Operating Directives

- **NON-DEMO BUILD RULE**: This is a real application, not a prototype. Never use mock data, placeholder data, fake telemetry, fake metrics, simulated APIs, setTimeout tests, or Math.random-based statuses. Every visible operational claim must be backed by a real API, runtime, persistent database, external service, or verified deterministic local implementation. If the real capability does not exist, do not simulate it. Display truthful states instead: `NOT_IMPLEMENTED`, `NOT_CONNECTED`, `NOT_CONFIGURED`, `UNTESTED`, `PARTIAL`, `BLOCKED`, or `FAILED`. A UI component existing is not evidence that the capability works. Never mark anything `COMPLETE`, `LIVE`, `PASS`, `CONNECTED`, `VERIFIED`, or `OPERATIONAL` without real execution evidence.
- **Single-Pane Unified Control Plane**: Maintain a unified architecture with clear left rail major sections (OPERATIONS, WORKSPACES, BUILD, KNOWLEDGE, GOVERNANCE, PRODUCTS, SYSTEM, MASTER ADMIN) and contextual workspace top navigation.
- **Global Jarvis Engine**: Jarvis operates as a global system service and HUD, not as a siloed workspace component.
- **Authentic Airbyte Dark Aesthetic**: High-density dark UI with deep dark neutrals (`#05060A`, `#080A16`), `#615EFF` primary brand accents, subtle `#1A1D33` borders, and typography pairings (Plus Jakarta Sans, Space Grotesk, JetBrains Mono).
- **Incremental & Bounded Changes**: Avoid rebuilding layouts, deleting valid working routes, or generating disjointed navigation shells.
