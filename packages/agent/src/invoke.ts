import type { Operation } from "effection";
import type { Val, FnNode } from "@tisyn/ir";
import { DispatchContext, InvalidInvokeCallSiteError, type InvokeOpts } from "./dispatch.js";

/**
 * Invoke a compiled Fn as a journaled child coroutine under the active
 * dispatch-boundary middleware.
 *
 * MUST be called from inside a dispatch middleware body currently handling a
 * dispatched effect. Agent handlers, `resolve` middleware, `facade.around`
 * per-operation middleware, and code outside any middleware throw
 * InvalidInvokeCallSiteError.
 *
 * The child coroutineId is `${parent}.${k}` where `k` is taken from the
 * parent's unified `childSpawnCount` allocator. The child's YieldEvent /
 * CloseEvent stream is journaled under that id. Overlay frames pushed via
 * `opts.overlay` are visible only to the child subtree and are not journaled.
 */
export function* invoke<T = Val>(
  fn: FnNode,
  args: readonly Val[],
  opts?: InvokeOpts,
): Operation<T> {
  const ctx = yield* DispatchContext.get();
  if (!ctx) {
    throw new InvalidInvokeCallSiteError(
      "invoke must be called from an active dispatch-boundary middleware",
    );
  }
  return yield* ctx.invoke<T>(fn, args, opts);
}
