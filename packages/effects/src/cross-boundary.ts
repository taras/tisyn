import { type Operation, createContext } from "effection";
import type { FnNode } from "@tisyn/ir";

// ---------------------------------------------------------------------------
// CrossBoundaryMiddlewareContext — per-execute IR middleware carrier
//
// Set by installCrossBoundaryMiddleware() before a remote execution.
// Read by install-remote.ts at dispatch time to attach the middleware
// to the execute request, making parent constraints visible to the child.
// ---------------------------------------------------------------------------

const CrossBoundaryMiddlewareContext = createContext<FnNode | null>(
  "$cross-boundary-middleware",
  null,
);

/** Install an IR middleware function to be propagated to remote child executions. */
export function* installCrossBoundaryMiddleware(fn: FnNode): Operation<void> {
  yield* CrossBoundaryMiddlewareContext.set(fn);
}

/** Read the cross-boundary middleware from the current scope (or null if not set). */
export function* getCrossBoundaryMiddleware(): Operation<FnNode | null> {
  return (yield* CrossBoundaryMiddlewareContext.get()) ?? null;
}
