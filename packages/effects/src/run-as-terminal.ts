import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import { RuntimeTerminal } from "./internal/runtime-terminal.js";

/**
 * Delegation contract for any `Effects.around({ dispatch })` middleware that
 * terminates the chain (returns a value without calling `next()`) and performs
 * effectful work for an effect id it handles. Terminal middleware MUST compose
 * through this helper so that, under replay, the runtime can substitute
 * stored results in place of running `liveWork()` again.
 *
 * See `tisyn-scoped-effects-specification.md` §9.5 — Replay Semantics and
 * Middleware Contract.
 *
 * Behavior:
 * - When a Tisyn runtime is installed (i.e. code runs inside `execute(...)`),
 *   `runAsTerminal` delegates to the runtime's per-dispatch terminal boundary.
 *   On replay the boundary returns the stored result without invoking
 *   `liveWork()`. On live dispatch it invokes `liveWork()`, journals the
 *   result, and returns it.
 * - When no runtime boundary is installed (standalone `@tisyn/effects` use),
 *   it invokes `liveWork()` directly with no replay semantics applied.
 *
 * `effectId` and `data` identify the dispatched effect so the boundary can
 * perform description-match / divergence checks. They must match the effect
 * that the enclosing middleware is handling.
 *
 * @example
 * ```ts
 * yield* Effects.around({
 *   *dispatch([effectId, data], next) {
 *     const { type, name } = parseEffectId(effectId);
 *     if (type === "my-agent") {
 *       return yield* runAsTerminal(effectId, data, () =>
 *         myAgentHandler(name, data),
 *       );
 *     }
 *     return yield* next(effectId, data);
 *   },
 * });
 * ```
 */
export function* runAsTerminal<T extends Val = Val>(
  effectId: string,
  data: Val,
  liveWork: () => Operation<T>,
): Operation<T> {
  const boundary = yield* RuntimeTerminal.get();
  if (!boundary) {
    return yield* liveWork();
  }
  return yield* boundary.run<T>(effectId, data, liveWork);
}
