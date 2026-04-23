import type { Operation } from "effection";
import type { Val, FnNode } from "@tisyn/ir";
import { DispatchContext } from "./internal/dispatch-context.js";
import { InvalidInvokeCallSiteError } from "./errors.js";
import type { InvokeOpts } from "./dispatch.js";

/**
 * Evaluate a compiled Fn under the caller's effective coroutine identity and
 * scope, journaling its yields on an inline journal lane per
 * `tisyn-inline-invocation-specification.md` §6.5.5.
 *
 * MUST be called from inside a dispatch middleware body currently handling a
 * dispatched effect on the caller's own coroutine cursor. Calls from other
 * sites — agent handlers, `resolve` middleware, `facade.around` per-operation
 * middleware, middleware dispatching an inline-body effect (§5.3.1.a), or
 * code outside any middleware — throw InvalidInvokeCallSiteError with zero
 * side effects.
 *
 * Inline-body yields are recorded under a lane key
 * `${callerCoroutineId}@inline${q}.${j}`; no new coroutineId is allocated,
 * no new scope boundary is opened, and no CloseEvent is written for the
 * inline body or the call itself. Effective coroutine identity inside the
 * inline body is the caller's.
 */
export function* invokeInline<T = Val>(
  fn: FnNode,
  args: readonly Val[],
  opts?: InvokeOpts,
): Operation<T> {
  const ctx = yield* DispatchContext.get();
  if (!ctx) {
    throw new InvalidInvokeCallSiteError(
      "invokeInline must be called from an active dispatch-boundary middleware",
    );
  }
  return yield* ctx.invokeInline<T>(fn, args, opts);
}
