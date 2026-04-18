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
// DispatchContext — carries invocation capability for the active dispatch chain.
//
// The runtime installs a fresh DispatchContext value for each standard-effect
// dispatch via DispatchContext.with(...); the `invoke(fn, args, opts?)` helper
// reads the active value via DispatchContext.get(). Agent handlers and other
// isolated code wrap their body with DispatchContext.with(undefined, ...) so
// those bodies cannot reuse an outer context.
// ---------------------------------------------------------------------------

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

/** Runtime-controlled dispatch-boundary context exposed to middleware. */
export interface DispatchContext {
  readonly coroutineId: string;
  invoke<T = Val>(fn: FnNode, args: readonly Val[], opts?: InvokeOpts): Operation<T>;
}

/**
 * Active dispatch-boundary context, or `undefined` when no dispatch chain is
 * active. Installed by the runtime via `DispatchContext.with(ctx, body)` for
 * the duration of each standard-effect dispatch; cleared to `undefined` by
 * agent handler wrappers.
 */
export const DispatchContext = createContext<DispatchContext | undefined>(
  "$tisyn-dispatch",
  undefined,
);

/** Thrown when invoke() is called outside an active dispatch-boundary middleware. */
export class InvalidInvokeCallSiteError extends Error {
  override name = "InvalidInvokeCallSiteError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when invoke() is called with malformed fn or args. */
export class InvalidInvokeInputError extends Error {
  override name = "InvalidInvokeInputError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when invoke() is called with malformed opts (overlay shape, label type). */
export class InvalidInvokeOptionError extends Error {
  override name = "InvalidInvokeOptionError" as const;
  constructor(message: string) {
    super(message);
  }
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
