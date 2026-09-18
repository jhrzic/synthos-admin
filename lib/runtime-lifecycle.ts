// ---------------------------------------------------------------------------
// SERVICE LIFECYCLE STATE — RUNNING or DRAINING, and what is in flight.
//
// A leaf module on purpose (no imports), so the spend guard, the kernel, the
// orchestrator and the scheduler can all read it without adding an import
// cycle. It holds STATE only — it runs nothing, schedules nothing, retries
// nothing. The scheduler owns the drain (lib/fabric/scheduler.ts
// drainAndSettle), the kernel registers each execution it starts, and every
// dispatch authority refuses new work while DRAINING.
//
// Why it exists: shutdown used to wait only for HTTP connections. Work the
// scheduler had started in the background (an orchestrated task mid-dispatch)
// was invisible to it, so `process.exit` abandoned it and nothing recorded
// that it had been interrupted — task-restart-1789678099 stayed RUNNING.
// ---------------------------------------------------------------------------

export type LifecycleState = 'RUNNING' | 'DRAINING';

export interface InFlightExecution {
  taskId: string;
  kind: string;
  startedAt: string;
}

const state = { value: 'RUNNING' as LifecycleState, since: null as string | null, reason: null as string | null };
const inFlight = new Map<string, InFlightExecution>();
const waiters = new Set<() => void>();

export function lifecycleState(): { state: LifecycleState; since: string | null; reason: string | null; inFlight: InFlightExecution[] } {
  return { state: state.value, since: state.since, reason: state.reason, inFlight: [...inFlight.values()] };
}

export function isDraining(): boolean {
  return state.value === 'DRAINING';
}

/** Enter DRAINING. Idempotent; never returns to RUNNING in the same process. */
export function beginDraining(reason: string): boolean {
  if (state.value === 'DRAINING') return false;
  state.value = 'DRAINING';
  state.since = new Date().toISOString();
  state.reason = reason;
  return true;
}

/** Register an execution that has started; the returned function marks it finished. */
export function noteExecutionStarted(taskId: string, kind: string): () => void {
  const key = `${kind}:${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  inFlight.set(key, { taskId, kind, startedAt: new Date().toISOString() });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight.delete(key);
    if (inFlight.size === 0) for (const w of [...waiters]) w();
  };
}

export function inFlightExecutions(): InFlightExecution[] {
  return [...inFlight.values()];
}

/** Resolves when nothing is in flight, or after `timeoutMs` — whichever is first. */
export function waitForNoExecutions(timeoutMs: number): Promise<{ settled: boolean; outstanding: InFlightExecution[] }> {
  if (inFlight.size === 0) return Promise.resolve({ settled: true, outstanding: [] });
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); waiters.delete(done); resolve({ settled: inFlight.size === 0, outstanding: [...inFlight.values()] }); };
    const t = setTimeout(done, Math.max(0, timeoutMs));
    waiters.add(done);
  });
}

/** Test hook only. */
export function resetLifecycleForTests(): void {
  state.value = 'RUNNING'; state.since = null; state.reason = null;
  inFlight.clear();
  waiters.clear();
}
