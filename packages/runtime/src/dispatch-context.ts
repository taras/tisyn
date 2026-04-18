import { createContext, type Operation } from "effection";
import type { FnNode, Val } from "@tisyn/ir";
import type { InvokeOpts } from "@tisyn/agent";

// Runtime-private dispatch-boundary context. Intentionally shares the
// same Effection scope slot as @tisyn/agent's internal DispatchContext:
// two createContext(name, …) calls with identical name strings resolve
// to the same slot in Effection's Scope (see scope-internal.ts:19 in
// the effection source). This file MUST NOT be re-exported from the
// @tisyn/runtime public barrel; no public package path anywhere
// exposes DispatchContext.

export interface DispatchContext {
  readonly coroutineId: string;
  invoke<T = Val>(fn: FnNode, args: readonly Val[], opts?: InvokeOpts): Operation<T>;
}

export const DispatchContext = createContext<DispatchContext | undefined>(
  "$tisyn-dispatch",
  undefined,
);
