import type { Operation } from "effection";
import type { Val, FnNode } from "@tisyn/ir";
import { DispatchContext } from "./internal/dispatch-context.js";
import { InvalidInvokeCallSiteError } from "./errors.js";
import type { InvokeOpts } from "./dispatch.js";

/**
 * Evaluate a compiled `Fn` as an inline lane under the active
 * dispatch-boundary middleware.
 *
 * Inline lanes journal effects under a distinct lane coroutineId
 * (journal identity) for deterministic replay, but share the caller's
 * Effection lifetime — they do NOT produce a `CloseEvent` at any
 * nesting level, and they do NOT create a new Effection scope boundary.
 * The inline body's return value propagates directly to the caller;
 * errors propagate directly as well (no reification, unlike `invoke`).
 *
 * MUST be called from inside a dispatch middleware body currently
 * handling a dispatched effect. Calls from agent handlers, `resolve`
 * middleware, `facade.around` per-operation middleware, IR middleware,
 * or code outside any middleware throw `InvalidInvokeCallSiteError`
 * naming `invokeInline`.
 *
 * The lane coroutineId is `${parent}.${k}` where `k` is taken from the
 * parent's unified `childSpawnCount` allocator (shared with `invoke` /
 * `spawn` / `all` / `race` / `timebox` / `resource` / `scope`). A
 * rejected `invokeInline` call — invalid call site, non-Fn input,
 * non-array args, invalid opts — MUST NOT advance the allocator.
 *
 * Overlay frames pushed via `opts.overlay` are visible only to the
 * inline subtree and are not journaled. `opts.label` is diagnostic
 * only.
 *
 * See `tisyn-inline-invocation-specification.md` for the full
 * normative contract. Phase 5B runtime scope: standard-effect
 * dispatch inside the body, nested `invokeInline` / `invoke` calls
 * reached through standard-effect middleware. `stream.subscribe` /
 * `stream.next` and all compound externals (`scope`, `spawn`, `join`,
 * `resource`, `timebox`, `all`, `race`) inside an inline body are
 * rejected with a clear error in this phase; runtime follow-ups will
 * lift those restrictions.
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
