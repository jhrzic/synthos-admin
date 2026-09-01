# ADR-001: Hermes Adapter Governance & Unified Control Plane Architecture

## Status
**ACCEPTED**

## Canonical Repositories
- **GitHub**: `jhrzic/synthos-admin`
- **Local**: `~/synthos/synthos-admin`
- **Legacy/Reference**: `mission-control` (Reference only; strictly non-canonical)

---

## 1. Context & Objectives
SynthOS Admin (`synthos-admin`) is the canonical administrative control plane for the SynthOS multi-agent operating system. It governs multiple independent agent and runtime workspaces, including Nous Hermes, Claude Code, Gemini, OpenAI Codex, Cursor, and custom swarm engines.

Prior to ADR-001, legacy prototypes introduced fragmented sub-apps, unverified mock metrics, and un-sandboxed execution assumptions. This Architecture Decision Record (ADR) defines the formal adapter governance protocol, architectural boundaries, strict health contracts, and phased integration requirements for the Hermes runtime workspace within SynthOS Admin.

---

## 2. Architectural Decision & Host Topology
1. **Host Control Plane**: `synthos-admin` serves as the authoritative administrative control layer.
2. **Independent Workspace**: Hermes operates as an independent runtime workspace governed within the unified single-pane shell.
3. **Global Services Isolation**: Global systems such as Jarvis HUD, Guardian Sentinel, and Aegis Governance remain global system-level services and are not siloed into or owned by any individual workspace.
4. **No Legacy Product Silos**: The legacy Mission Control product silo is deprecated and maintained for reference only.

---

## 3. Mandatory Adapter Interface Contract (`IHermesAdapter`)

All interactions with the Hermes runtime are mediated by the `IHermesAdapter` interface:

```typescript
export interface IHermesAdapter {
  health(): Promise<HermesAdapterHealth>;
  capabilities(): Promise<HermesAdapterCapabilities>;
  execute(options: HermesExecuteOptions): Promise<HermesExecuteResult>;
  events(eventType: string, handler: (event: any) => void): HermesEventSubscription;
}
```

---

## 4. Health Contract & Validation Protocol

The adapter communicates with the Hermes runtime via `GET /synthos/health`.

### Contract Specification
- **Endpoint**: `GET ${HERMES_ADAPTER_BASE_URL}/synthos/health`
- **Authorization**: `Authorization: Bearer ${HERMES_ADAPTER_TOKEN}`
- **Timeout**: Strict 5000ms (5s) `AbortSignal` timeout
- **Polling Interval**: ≤ 15 seconds
- **Content-Type**: `application/json`

### Upstream 200 JSON Response Schema:
```json
{
  "status": "UP" | "DEGRADED" | "DOWN",
  "runtime_type": "hermes",
  "runtime_version": "<string>",
  "runtime_instance_id": "<stable_instance_id>",
  "adapter_schema_version": "1",
  "process_alive": true | false,
  "gateway_alive": true | false | null,
  "timestamp": "<ISO 8601 string>"
}
```

### Strict Health State Mapping Matrix:
| HTTP Status | Body Condition | Resulting Status | Auth Status | Runtime Fields |
|---|---|---|---|---|
| **200 OK** | Valid JSON, valid contract schema with `status: "UP"` | `UP` | `AUTHENTICATED` | Extracted from payload |
| **200 OK** | Valid JSON, valid contract schema with `status: "DEGRADED"` | `DEGRADED` | `AUTHENTICATED` | Extracted from payload |
| **200 OK** | Valid JSON, valid contract schema with `status: "DOWN"` | `DOWN` | `AUTHENTICATED` | Extracted from payload |
| **200 OK** | Malformed JSON or incomplete/missing contract fields | `UNKNOWN` | `AUTHENTICATED` | `NOT_AVAILABLE` |
| **401 / 403** | Unauthorized or Forbidden | `AUTH_ERROR` | `AUTH_ERROR` | `NOT_AVAILABLE` |
| **500 / Non-200** | Any status other than 200, 401, 403 (even if body has `"status": "UP"`) | `UNKNOWN` | `UNKNOWN` | `NOT_AVAILABLE` |
| **Timeout / Error** | Request aborted after 5s or network failure | `NOT_CONNECTED` | As configured | `NOT_AVAILABLE` |

*Rule: An HTTP status other than 200 MUST NEVER produce `UP`, `DEGRADED`, or `DOWN`. Contract fields (including `process_alive`) must never be inferred or faked.*

---

## 5. Phased Execution Roadmap

### Phase 1: Governance, Telemetry, and Contract Enforcement
- Implement `IHermesAdapter` in `src/services/hermesAdapter.ts`.
- Implement `health()` with strict HTTP 200 schema validation, 5s timeout, and state mapping.
- Implement `capabilities()` exposing confirmed introspection schema v1.
- Provide Phase 1 stubs for `execute()` and `events()`.
- Eliminate all synthetic mocks, randomized telemetry, fake cryptographic hashes, and simulated execution indicators.
- Audit codebase for un-sandboxed code execution: `EVAL_PATH_STATUS: NOT_PRESENT`.

### Phase 2: Execution Protocol & Streaming Event Hooks
- Implement full `execute()` payload dispatch with task state transitions.
- Implement `events()` Server-Sent Events (SSE) / WebSocket multiplexing.
- Connect bidirectional Obsidian vault syncing and multi-agent DAG task dispatch.

---

## 6. Security Governance & Audit Verification
- **Eval Path Audit**: `EVAL_PATH_STATUS: NOT_PRESENT`.
- **Environment Variable Declarations**:
  - `HERMES_ADAPTER_BASE_URL`: Base HTTP URL for the upstream Hermes adapter service.
  - `HERMES_ADAPTER_TOKEN`: Bearer token for authenticating control plane health and management requests.
