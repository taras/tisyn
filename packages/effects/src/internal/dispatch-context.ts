import { createContext, type Operation } from "effection";
import type { FnNode, Val } from "@tisyn/ir";
import type { InvokeOpts } from "../dispatch.js";

// ---------------------------------------------------------------------------
// DispatchContext — cross-package seam carrying invocation capability for the
// active dispatch chain.
//
// Declared once, exported only via `@tisyn/effects/internal` — a non-stable
// workspace-intended subpath. User code has no supported way to reach this
// module and MUST NOT import it. The type and value live here together so
// consumers wire through a single entry point.
//
// The runtime installs a fresh DispatchContext value for each standard-effect
// dispatch via DispatchContext.with(...); the `invoke(fn, args, opts?)` helper
// reads the active value via DispatchContext.get(). Agent handlers and other
// isolated code wrap their body with DispatchContext.with(undefined, ...) so
// those bodies cannot reuse an outer context.
// ---------------------------------------------------------------------------

/**
 * @internal
 *
 * Cross-package seam describing the active dispatch chain.
 */
export interface DispatchContext {
  readonly coroutineId: string;
  invoke<T = Val>(fn: FnNode, args: readonly Val[], opts?: InvokeOpts): Operation<T>;
  invokeInline<T = Val>(fn: FnNode, args: readonly Val[], opts?: InvokeOpts): Operation<T>;
}

/**
 * @internal
 *
 * Active dispatch-boundary context, or `undefined` when no dispatch chain is
 * active. Single declaration across the workspace — `context.name` is
 * scope-keyed by Effection, so introducing a second `createContext` call with
 * the same name elsewhere would silently share this slot. Do not do that.
 */
export const DispatchContext = createContext<DispatchContext | undefined>(
  "$tisyn-dispatch",
  undefined,
);
