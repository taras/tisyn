/**
 * Scope-local middleware evaluation.
 *
 * Drives the kernel evaluator for an IR function node, routing only
 * 'dispatch' effects to the provided next continuation. Any other effect
 * throws ProhibitedEffectError (§10.2 constraint).
 *
 * @internal — workspace seam, not part of the stable public surface.
 */
import type { Operation } from "effection";
import type { TisynExpr, Val } from "@tisyn/ir";
import { evaluate, EMPTY_ENV, extendMulti, ProhibitedEffectError } from "@tisyn/kernel";

/**
 * @internal
 *
 * Evaluate an IR middleware function with the given effect arguments.
 *
 * The function body is driven as a kernel generator. When it suspends
 * with id="dispatch", the [effectId, data] payload is forwarded to `next`.
 * Any other effect id throws ProhibitedEffectError.
 *
 * Accepts any object with `params` and `body` — compatible with both
 * `FnNode` (tagged node format) and `TisynFn<A,R>` (typed expression format).
 */
export function evaluateMiddlewareFn(
  fn: { readonly params: readonly string[]; readonly body: unknown },
  effectId: string,
  data: Val,
  next: (eid: string, d: Val) => Operation<Val>,
): Operation<Val> {
  return {
    *[Symbol.iterator]() {
      const env = extendMulti(EMPTY_ENV, [...fn.params], [effectId, data] as Val[]);
      const gen = evaluate(fn.body as TisynExpr, env);

      let nextVal: Val = null as Val;

      for (;;) {
        const step = gen.next(nextVal);

        if (step.done) {
          return step.value as Val;
        }

        const descriptor = step.value;

        if (descriptor.id !== "dispatch") {
          throw new ProhibitedEffectError(descriptor.id);
        }

        // dispatch effect: data is [forwardedEffectId, forwardedData]
        const [forwardedId, forwardedData] = descriptor.data as [string, Val];

        try {
          nextVal = yield* next(forwardedId, forwardedData);
        } catch (err) {
          // Propagate dispatch error into the kernel generator
          const throwResult = gen.throw(err);
          if (throwResult.done) {
            return throwResult.value as Val;
          }
          nextVal = null as Val;
        }
      }
    },
  };
}
