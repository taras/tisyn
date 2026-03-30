import { type Operation, createContext } from "effection";
import type { Val, FnNode } from "@tisyn/ir";
import { createApi } from "@effectionx/context-api";

// ---------------------------------------------------------------------------
// EnforcementContext — non-bypassable cross-boundary wrapper
//
// This is separate from EffectsContext so that even if a child scope
// resets Effects middleware, enforcement still runs first.
// ---------------------------------------------------------------------------

export type EnforcementFn = (
  effectId: string,
  data: Val,
  inner: (eid: string, d: Val) => Operation<Val>,
) => Operation<Val>;

const EnforcementContext = createContext<EnforcementFn | null>("$enforcement", null);

export function* installEnforcement(fn: EnforcementFn): Operation<void> {
  yield* EnforcementContext.set(fn);
}

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

// ---------------------------------------------------------------------------
// Effects API
// ---------------------------------------------------------------------------

const EffectsApi = createApi("Effects", {
  *dispatch(effectId: string, data: Val): Operation<Val> {
    throw new Error(`No agent registered for effect: ${effectId}`);
  },
});

export const Effects = EffectsApi;

/**
 * Dispatch an effect. Runs the enforcement wrapper (if installed) before
 * the full Effects middleware chain, making parent restrictions
 * non-bypassable by child middleware.
 */
export function* dispatch(effectId: string, data: Val): Operation<Val> {
  const enforcement = (yield* EnforcementContext.get()) ?? null;

  const inner = (eid: string, d: Val): Operation<Val> => EffectsApi.operations.dispatch(eid, d);

  if (enforcement !== null) {
    return yield* enforcement(effectId, data, inner);
  }
  return yield* inner(effectId, data);
}
