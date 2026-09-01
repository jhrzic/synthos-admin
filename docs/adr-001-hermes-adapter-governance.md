# ADR-001: Hermes Adapter Governance & Unified Control Plane Architecture

## Status
- **Phase 1**: IMPLEMENTED (Health, Capabilities, Strict Contract Mapping, Interface Definitions)
- **Phase 2**: DEFERRED (Execute, Event Streaming, Task State Transitions)

---

## Context & Objectives
Hermes is an independent agent and runtime workspace governed by the SynthOS administrative control plane. 

To eliminate fragmented sub-apps, simulated mocks, fake runtime metrics, and un-sandboxed execution paths, ADR-001 establishes a formal adapter interface and contract for Hermes integration.

---

## Adapter Interface Contract (Phase 1)

The Hermes adapter implements the following mandatory primitives:

```typescript
export interface IHermesAdapter {
  health(): Promise<HermesAdapterHealth>;
  capabilities(): Promise<HermesAdapterCapabilities>;
  execute(options: HermesExecuteOptions): Promise<HermesExecuteResult>;
  events(eventType: string, handler: (event: any) => void): HermesEventSubscription;
}
```

---

## Health Endpoint Contract

`health()` consumes `GET /synthos/health` from the upstream runtime:

- **Method**: `GET ${HERMES_ADAPTER_BASE_URL}/synthos/health`
- **Header**: `Authorization: Bearer <HERMES_ADAPTER_TOKEN>`
- **Timeout**: Strict 5000ms (5s) AbortSignal timeout
- **Poll Interval**: ≤ 15s (recommended 15s)

### Upstream 200 JSON Response Schema:
```json
{
  "status": "UP" | "DEGRADED" | "DOWN",
  "runtime_type": "hermes",
  "runtime_version": "<string>",
  "runtime_instance_id": "<stable_id>",
  "adapter_schema_version": "1",
  "process_alive": true | false,
  "gateway_alive": true | false | null,
  "timestamp": "<ISO 8601>"
}
```

### Exact State Mapping Rules:
| Upstream Condition | Adapter State | Auth State | Version / Instance |
|---|---|---|---|
| HTTP 200 + valid JSON status `UP` | `UP` | `AUTHENTICATED` | Extracted from payload |
| HTTP 200 + valid JSON status `DEGRADED` | `DEGRADED` | `AUTHENTICATED` | Extracted from payload |
| HTTP 200 + valid JSON status `DOWN` | `DOWN` | `AUTHENTICATED` | Extracted from payload |
| HTTP 401 / 403 (Invalid/Missing token) | `AUTH_ERROR` | `AUTH_ERROR` | `NOT_AVAILABLE` |
| Timeout (>5s) or Network connection failure | `NOT_CONNECTED` | As configured | `NOT_AVAILABLE` |
| Malformed / Non-JSON response | `UNKNOWN` | `UNKNOWN` | `NOT_AVAILABLE` |

---

## Capabilities Introspection

`capabilities()` exposes only verified capabilities confirmed by adapter wiring and authoritative runtime data:
- `health_check`: `CONFIRMED`
- `capabilities_discovery`: `CONFIRMED`
- `execute`: `NOT_IMPLEMENTED_PHASE_1`
- `events`: `NOT_IMPLEMENTED_PHASE_1`

---

## Security Governance & Eval Audit

- **Un-sandboxed eval() paths**: `EVAL_PATH_STATUS: NOT_PRESENT` in `synthos-admin`.
- **Environment Isolation**: Configured via `HERMES_ADAPTER_BASE_URL` and `HERMES_ADAPTER_TOKEN`.
