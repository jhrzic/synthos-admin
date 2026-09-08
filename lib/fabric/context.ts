// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 1b: ExecutionContext factory.
//
// createExecutionContext() is the only place an ExecutionContext gets built.
// The workspaceId it carries is never re-derived here — the caller (the
// ingress adapter, e.g. POST /api/execute-agent-task in server.ts) must pass
// the already-resolved canonical value (Phase 0b's `resolvedWorkspaceId`:
// authWorkspaceId when requireWorkspaceMember ran, the request body only for
// the internal-service-token bypass). This file has no opinion about HTTP,
// Express, or auth — it only holds the invocation trace.
//
// RECEIPT PRIVACY (Step 1b instruction): the trace built here holds
// invocation NAMES, timing, and success/failure only — never the prompt
// passed to fn() or the value fn() resolved with. It also never leaves
// process memory: there is no persistent trace store in this step (that is
// explicitly deferred, not silently built). A caller that wants
// toolsInvoked for a response reads getInvocations() while the request is
// still in flight; nothing here writes to disk or SQLite.
// ---------------------------------------------------------------------------

import type { ExecutionContext, InvocationRecord } from './types';

export function createExecutionContext(params: { workspaceId: string }): ExecutionContext {
  const invocations: InvocationRecord[] = [];

  return {
    workspaceId: params.workspaceId,

    async invoke<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      try {
        const result = await fn();
        invocations.push({
          name,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          success: true,
        });
        return result;
      } catch (err: any) {
        invocations.push({
          name,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          success: false,
          error: err?.message || String(err),
        });
        throw err;
      }
    },

    getInvocations(): InvocationRecord[] {
      // A copy — callers must not be able to mutate the real trace.
      return invocations.slice();
    },
  };
}
