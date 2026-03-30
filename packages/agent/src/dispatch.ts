import { type Operation, createContext, useScope } from "effection";
import type { Val } from "@tisyn/ir";
import { createApi } from "@effectionx/context-api";

// ---------------------------------------------------------------------------
// EnforcementContext — non-bypassable cross-boundary wrapper
//
// This is separate from DispatchContext so that even if a child scope
// resets Dispatch middleware, enforcement still runs first.
// ---------------------------------------------------------------------------

export type EnforcementFn = (
  effectId: string,
  data: Val,
  inner: (eid: string, d: Val) => Operation<Val>,
) => Operation<Val>;

const EnforcementContext = createContext<EnforcementFn | null>("$enforcement", null);

export function* installEnforcement(fn: EnforcementFn): Operation<void> {
  const scope = yield* useScope();
  scope.set(EnforcementContext, fn);
}

// ---------------------------------------------------------------------------
// Dispatch API
// ---------------------------------------------------------------------------

const DispatchApi = createApi("Dispatch", {
  *dispatch(effectId: string, data: Val): Operation<Val> {
    throw new Error(`No agent registered for effect: ${effectId}`);
  },
});

export const Dispatch = DispatchApi;

/**
 * Dispatch an effect. Runs the enforcement wrapper (if installed) before
 * the full Dispatch middleware chain, making parent restrictions
 * non-bypassable by child middleware.
 */
export function* dispatch(effectId: string, data: Val): Operation<Val> {
  const scope = yield* useScope();
  const enforcement = scope.get(EnforcementContext) ?? null;

  const inner = (eid: string, d: Val): Operation<Val> => DispatchApi.operations.dispatch(eid, d);

  if (enforcement !== null) {
    return yield* enforcement(effectId, data, inner);
  }
  return yield* inner(effectId, data);
}
