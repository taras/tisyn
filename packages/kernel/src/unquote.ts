/**
 * The unquote operation.
 *
 * See Kernel Specification §4.1.
 *
 * unquote(node, E):
 *   if node is Quote: return node.expr  (raw Expr, NOT evaluated)
 *   else: return eval(node, E)
 *
 * Used by structural operations to destructure their quoted data.
 * The result is an Expr (not necessarily a Val) — the structural
 * operation selectively evaluates sub-fields.
 */

import {
  type Expr,
  type Val,
  type EffectDescriptor,
  isQuoteNode,
} from "@tisyn/shared";
import type { Env } from "./environment.js";

export function* unquote(
  node: Expr,
  env: Env,
  evalFn: (expr: Expr, env: Env) => Generator<EffectDescriptor, Val, Val>,
): Generator<EffectDescriptor, unknown, Val> {
  if (isQuoteNode(node)) {
    return node.expr;
  }
  return yield* evalFn(node, env);
}
