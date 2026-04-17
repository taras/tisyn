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
// Dispatch-boundary context — carries ctx.invoke for the active dispatch chain.
//
// Nested invocation primitive: dispatch-boundary middleware MAY execute a
// compiled Fn as a journaled child coroutine via ctx.invoke(fn, args, opts?).
// The runtime installs a fresh DispatchCtx for each standard-effect dispatch
// via DispatchContext.with(...); middleware reads the active value via
// DispatchContext.get(). Agent handlers wrap their body with
// DispatchContext.with(null, ...) so handler code cannot reuse an outer ctx.
// ---------------------------------------------------------------------------

/** Scoped-effect frame pushed for the duration of an invoked child subtree. */
export interface ScopedEffectFrame {
  readonly kind: string;
  readonly id: string;
}

/** Options to ctx.invoke(fn, args, opts?). */
export interface InvokeOpts {
  readonly overlay?: ScopedEffectFrame;
  readonly label?: string;
}

/** Runtime-controlled dispatch-boundary context exposed to middleware. */
export interface DispatchCtx {
  readonly coroutineId: string;
  invoke<T = Val>(
    fn: FnNode,
    args: readonly Val[],
    opts?: InvokeOpts,
  ): Operation<T>;
}

export const DispatchContext = createContext<DispatchCtx | null>(
  "$tisyn-dispatch-context",
  null,
);

/** Thrown when ctx.invoke is called outside its owning active dispatch-boundary middleware. */
export class InvalidInvokeCallSiteError extends Error {
  override name = "InvalidInvokeCallSiteError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when ctx.invoke is called with malformed fn or args. */
export class InvalidInvokeInputError extends Error {
  override name = "InvalidInvokeInputError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when ctx.invoke is called with malformed opts (overlay shape, label type). */
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

// ---------------------------------------------------------------------------
// Arity-based 3-arg adapter.
//
// Host-side JS dispatch-boundary middleware MAY declare a third `ctx`
// parameter whose type is DispatchCtx. The underlying @effectionx/context-api
// contract calls middleware with (args, next) — so when fn.length > 2 we wrap
// to read the active DispatchContext and forward it as the third argument.
// 2-arg middleware is installed byte-identical to the existing behavior.
// ---------------------------------------------------------------------------

type DispatchMwUser = (
  args: [string, Val],
  next: (eid: string, d: Val) => Operation<Val>,
  ctx: DispatchCtx | null,
) => Operation<Val>;

type ResolveMwUser = (
  args: [string],
  next: (agentId: string) => Operation<boolean>,
  ctx: DispatchCtx | null,
) => Operation<boolean>;

function adaptDispatch(userFn: (...a: unknown[]) => Operation<Val>) {
  if (userFn.length <= 2) {
    return userFn as unknown as (
      args: [string, Val],
      next: (eid: string, d: Val) => Operation<Val>,
    ) => Operation<Val>;
  }
  const threeArg = userFn as unknown as DispatchMwUser;
  return function* adapted(
    args: [string, Val],
    next: (eid: string, d: Val) => Operation<Val>,
  ): Operation<Val> {
    const ctx = (yield* DispatchContext.get()) ?? null;
    return yield* threeArg(args, next, ctx);
  };
}

function adaptResolve(userFn: (...a: unknown[]) => Operation<boolean>) {
  if (userFn.length <= 2) {
    return userFn as unknown as (
      args: [string],
      next: (agentId: string) => Operation<boolean>,
    ) => Operation<boolean>;
  }
  const threeArg = userFn as unknown as ResolveMwUser;
  return function* adapted(
    args: [string],
    next: (agentId: string) => Operation<boolean>,
  ): Operation<boolean> {
    const ctx = (yield* DispatchContext.get()) ?? null;
    return yield* threeArg(args, next, ctx);
  };
}

type EffectsApiAround = typeof EffectsApi.around;
type EffectsMiddlewareArg = Parameters<EffectsApiAround>[0];
type EffectsAroundOptions = Parameters<EffectsApiAround>[1];

/**
 * Widened middleware shape: dispatch/resolve members MAY declare a third
 * `ctx: DispatchCtx | null` parameter. The arity-based adapter below detects
 * 3-arg functions via `fn.length` and wraps them to read the active
 * DispatchContext; 2-arg functions pass through byte-identical.
 *
 * Other members (sleep, etc.) inherit their original 2-arg constraints.
 */
type EffectsMiddlewareArgWithCtx = Omit<EffectsMiddlewareArg, "dispatch" | "resolve"> & {
  dispatch?: (
    args: [string, Val],
    next: (eid: string, d: Val) => Operation<Val>,
    ctx?: DispatchCtx | null,
  ) => Operation<Val>;
  resolve?: (
    args: [string],
    next: (agentId: string) => Operation<boolean>,
    ctx?: DispatchCtx | null,
  ) => Operation<boolean>;
};

type EffectsAroundWithCtx = (
  middleware: EffectsMiddlewareArgWithCtx,
  options?: EffectsAroundOptions,
) => Operation<void>;

/**
 * Effects.around accepts the underlying 2-arg contract plus an optional
 * 3rd `ctx` argument on dispatch/resolve members. Internally, any function
 * member whose arity is ≥3 is wrapped by the adapter — the 3rd argument is
 * the active DispatchContext (or null when no dispatch chain is active).
 */
function aroundWithAdapter(
  middleware: EffectsMiddlewareArgWithCtx,
  options?: EffectsAroundOptions,
): Operation<void> {
  const adapted: Record<string, unknown> = { ...(middleware as object) };
  const raw = middleware as {
    dispatch?: (...a: unknown[]) => Operation<Val>;
    resolve?: (...a: unknown[]) => Operation<boolean>;
  };
  if (raw.dispatch) {
    adapted.dispatch = adaptDispatch(raw.dispatch);
  }
  if (raw.resolve) {
    adapted.resolve = adaptResolve(raw.resolve);
  }
  return EffectsApi.around(adapted as EffectsMiddlewareArg, options);
}

export const Effects: {
  operations: typeof EffectsApi.operations;
  around: EffectsAroundWithCtx;
  sleep: typeof EffectsApi.operations.sleep;
} = {
  operations: EffectsApi.operations,
  around: aroundWithAdapter,
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
