import { type Operation, createContext, sleep as effectionSleep } from "effection";
import type { Val, FnNode } from "@tisyn/ir";
import { createApi } from "@effectionx/context-api";

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
  *dispatch(effectId: string, _data: Val): Operation<Val> {
    if (effectId === "sleep") {
      const ms = (_data as unknown[])[0] as number;
      yield* effectionSleep(ms);
      return null as Val;
    }
    throw new Error(`No agent registered for effect: ${effectId}`);
  },
  *resolve(_agentId: string): Operation<boolean> {
    return false;
  },
  *sleep(ms: number): Operation<Val> {
    return yield* dispatch("sleep", [ms] as unknown as Val);
  },
});

export const Effects = Object.assign(EffectsApi, {
  sleep: EffectsApi.operations.sleep,
});

/**
 * Dispatch an effect through the Effects middleware chain.
 *
 * Cross-boundary constraints are installed as ordinary Effects.around()
 * middleware in the execution scope — no separate enforcement context.
 */
export const dispatch: (effectId: string, data: Val) => Operation<Val> =
  EffectsApi.operations.dispatch;

/**
 * Query the Effects middleware chain to check if an agent is bound.
 * Returns true if any routing middleware handles the given agent ID.
 */
export const resolve: (agentId: string) => Operation<boolean> = EffectsApi.operations.resolve;
