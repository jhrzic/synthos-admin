// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 1b types.
//
// This is the extraction of POST /api/execute-agent-task's logic (server.ts,
// characterized live and statically in test/fabric-characterization.test.ts,
// corrected in Phase 0/0b) into a canonical, ingress-agnostic kernel. These
// types describe that kernel's real input/output/context shapes — nothing
// here is aspirational or names a capability that doesn't exist yet.
// ---------------------------------------------------------------------------

/**
 * The kernel's input. Deliberately the same shape as the raw request body
 * this route has always accepted (POST /api/execute-agent-task) — an
 * ingress adapter (the Express route today; Jarvis/graph/scheduler adapters
 * in later steps, NOT built here) is responsible for producing this from
 * whatever its own transport looks like. Every field is optional with the
 * exact same defaults the original inline destructuring applied — see
 * kernel.ts.
 */
export interface ExecuteAgentTaskInput {
  taskId?: string;
  /**
   * SPEND GUARD — the logical-execution key for the paid model call. The
   * orchestrator passes a stable per-task key so a requeue, restart or resume
   * can never pay twice. Absent (a direct request), each request is its own
   * logical execution.
   */
  spendIdempotencyKey?: string;
  /**
   * The task's OUTPUT CONTRACT (lib/fabric/output-contract.ts). NARRATIVE by
   * default. LITERAL / JSON_OBJECT bypass the agent persona and are verified
   * in code (Aegis INSTRUCTION_COMPLIANCE scope) before the task can be DONE.
   */
  outputContract?: unknown;
  /** Registry task class (data). Absent → the class registered for the output contract. */
  taskClass?: string;
  /**
   * What the artifact is FOR (lib/memory-index.ts). Absent → PRODUCTION_WORK
   * (ordinary retrieval, the pre-existing behaviour). ACCEPTANCE_EVIDENCE /
   * QUALIFICATION_EVIDENCE / TEST_FIXTURE are kept as evidence but are never
   * admitted to ordinary retrieval.
   */
  artifactPurpose?: string;
  /** Routing constraints/mode for the canonical router (narrow the workspace's; never widen). */
  routing?: import('../registry/router').RoutingConstraints;
  privacyClass?: import('../registry/types').PrivacyClass;
  taskTitle?: string;
  description?: string;
  assignedAgent?: string;
  assignedModel?: string;
  inputs?: string;
  dependencies?: unknown[];
  sourceUrl?: string;
  /**
   * Not read by the kernel for scope resolution (that is the ingress
   * adapter's job — see resolvedWorkspaceId below) — kept only because the
   * original route's catch-block error-recovery path reads
   * `req.body?.assignedAgent` a second time, independently of the
   * destructured `assignedAgent` above, and the kernel preserves that exact
   * behavior rather than collapsing the two reads into one and silently
   * changing what happens on a destructuring-time failure.
   */
  [key: string]: unknown;
}

/**
 * The kernel's return value: a direct, unopinionated mirror of what the
 * route has always sent over HTTP (`res.status(result.status).json(result.body)`).
 * Deliberately not a richer discriminated union — every branch of the
 * original route already produces its own concrete status/body pair, and
 * turning that into a new abstraction here would be inventing structure
 * the characterization oracle never asked for, for no behavioral gain.
 */
export interface ExecutionResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * One real, observed ctx.invoke() call. Deliberately holds no raw
 * prompt/response content — see lib/fabric/context.ts and the Step 1b task
 * instructions on receipt privacy. `name` is the only thing that ever
 * becomes part of toolsInvoked/toolCalls.
 */
export interface InvocationRecord {
  name: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  /** Present only on failure. The error's message, never the raw input/output that produced it. */
  error?: string;
}

/**
 * ExecutionContext — the one sanctioned path for model/tool/external-service
 * calls inside the kernel (Step 1b rule). Deliberately minimal: workspaceId
 * (the canonical, already-resolved scope — see kernel.ts and Phase 0b) plus
 * invoke() and its observation log. No taskId, no user identity, no
 * transport details — those belong to whichever ingress adapter builds the
 * context, not to the fabric's own notion of "what happened during this
 * execution." Extending this is later-step work (registry.ts, intent.ts,
 * adapters — none built here).
 */
export interface ExecutionContext {
  readonly workspaceId: string;
  /**
   * Runs `fn`, recording one InvocationRecord (name, timing, success/
   * failure) regardless of outcome, and returns/rethrows exactly what `fn`
   * returned/threw — invoke() never swallows an error or alters a result,
   * it only observes. This is deliberately a thin wrapper around the
   * REAL existing call the kernel already makes (e.g. the real Gemini
   * request loop) — it does not replace, retry, or reinterpret it.
   */
  invoke<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** All invocations observed so far, in call order. In-memory only for this step — see context.ts. */
  getInvocations(): InvocationRecord[];
}
