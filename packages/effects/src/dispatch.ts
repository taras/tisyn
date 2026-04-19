import { type Operation, sleep as effectionSleep } from "effection";
import type { Val } from "@tisyn/ir";
import { createApi } from "@effectionx/context-api";

/** Scoped-effect frame pushed for the duration of an invoked child subtree. */
export interface ScopedEffectFrame {
  readonly kind: string;
  readonly id: string;
}

/** Options to invoke(fn, args, opts?). */
export interface InvokeOpts {
  readonly overlay?: ScopedEffectFrame;
  readonly label?: string;
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

export const Effects: {
  operations: typeof EffectsApi.operations;
  around: typeof EffectsApi.around;
  sleep: typeof EffectsApi.operations.sleep;
} = {
  operations: EffectsApi.operations,
  around: EffectsApi.around,
  sleep: EffectsApi.operations.sleep,
};

/**
 * Dispatch an effect through the Effects middleware chain.
 *
 * Accepts either an explicit (effectId, data) pair or a call descriptor
 * object with the same shape returned by agent().op(args).
 */
export function dispatch<T = Val>(effectId: string, data: Val): Operation<T>;
export function dispatch<T = Val>(request: {
  readonly effectId: string;
  readonly data: unknown;
}): Operation<T>;
export function dispatch<T = Val>(
  effectIdOrRequest: string | { readonly effectId: string; readonly data: unknown },
  maybeData?: Val,
): Operation<T> {
  if (typeof effectIdOrRequest === "string") {
    return EffectsApi.operations.dispatch(effectIdOrRequest, maybeData as Val) as Operation<T>;
  }
  return EffectsApi.operations.dispatch(
    effectIdOrRequest.effectId,
    effectIdOrRequest.data as Val,
  ) as Operation<T>;
}

/**
 * Query the Effects middleware chain to check if an agent is bound.
 * Returns true if any routing middleware handles the given agent ID.
 */
export const resolve: (agentId: string) => Operation<boolean> = EffectsApi.operations.resolve;
