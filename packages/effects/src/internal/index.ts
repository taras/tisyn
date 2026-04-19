/**
 * @tisyn/effects/internal — non-stable workspace seam.
 *
 * See `README.md` in this directory for the consumer-discipline contract.
 * The lint rule installed in `packages/conformance/src/internal-subpath-consumers.test.ts`
 * restricts importers to { @tisyn/effects, @tisyn/agent, @tisyn/runtime, @tisyn/transport }.
 */
export { DispatchContext } from "./dispatch-context.js";
export { evaluateMiddlewareFn } from "./middleware-eval.js";
