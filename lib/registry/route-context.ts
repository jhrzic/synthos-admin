// ---------------------------------------------------------------------------
// ROUTE CONTEXT — what the router decided, carried to the spend guard.
//
// The same pattern as the network guard's spend permit: the dispatcher runs
// the adapter inside this context, and the spend guard's registry gate reads
// it. Adapters do not need to know about routing, and a call made outside any
// routing decision is still gated — its task class is then resolved from its
// call site (registry data), and it must be qualified for that class.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RouteContext {
  taskClass?: string | null;
  deploymentId?: string | null;
  canonicalVersionId?: string | null;
  routingDecisionId?: string | null;
  segmentId?: string | null;
  /** Set only while a qualification run's own cases execute. */
  qualificationRunId?: string | null;
  outputContract?: string | null;
}

const store = new AsyncLocalStorage<RouteContext>();

export function runWithRouteContext<T>(ctx: RouteContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

export function currentRouteContext(): RouteContext | undefined {
  return store.getStore();
}
