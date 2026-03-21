/**
 * The resolve function — produces fully resolved Val from Expr.
 *
 * See Kernel Specification §3.
 *
 * Used exclusively at the external effect boundary (§4.3) for
 * standard (non-compound) operations.
 *
 * THE OPAQUE VALUE RULE (§3.2):
 * resolve() MUST NOT recurse into any value returned by lookup()
 * or eval(). Such values are terminal — returned without inspection.
 *
 * resolve() is a generator because it may need to eval() sub-expressions
 * which may themselves yield external effects.
 */

import {
  type TisynExpr as Expr,
  type Val,
  isEvalNode,
  isQuoteNode,
  isRefNode,
  isFnNode,
} from "@tisyn/ir";
import type { EffectDescriptor } from "./events.js";
import { lookup } from "./environment.js";
import type { Env } from "./environment.js";

/**
 * Resolve an expression tree into a fully resolved Val.
 *
 * Categories:
 * - Terminal: Results of lookup/eval; Fn nodes; primitives → return as-is
 * - Unwrap: Quote → strip layer, resolve contents
 * - Traversable: Plain arrays; plain objects without matching tisyn → recurse
 */
export function* resolve(
  node: Expr,
  env: Env,
  evalFn: (expr: Expr, env: Env) => Generator<EffectDescriptor, Val, Val>,
): Generator<EffectDescriptor, Val, Val> {
  // TERMINAL: Ref → lookup returns a Val, don't recurse into it
  if (isRefNode(node)) {
    return lookup(node.name, env);
  }

  // TERMINAL: Eval → eval returns a Val, don't recurse into it
  if (isEvalNode(node)) {
    return yield* evalFn(node, env);
  }

  // TERMINAL: Fn → evaluates to itself
  if (isFnNode(node)) {
    return node as unknown as Val;
  }

  // UNWRAP: Quote → strip layer, resolve contents
  if (isQuoteNode(node)) {
    return yield* resolve(node.expr, env, evalFn);
  }

  // TRAVERSABLE: Array → recurse into each element
  if (Array.isArray(node)) {
    const result: Val[] = [];
    for (const item of node) {
      result.push(yield* resolve(item as Expr, env, evalFn));
    }
    return result;
  }

  // TRAVERSABLE: Plain object without matching tisyn → recurse
  if (typeof node === "object" && node !== null) {
    const result: Record<string, Val> = {};
    const keys = Object.keys(node as Record<string, unknown>).sort();
    for (const key of keys) {
      result[key] = yield* resolve((node as Record<string, unknown>)[key] as Expr, env, evalFn);
    }
    return result;
  }

  // TERMINAL: Primitive (string, number, boolean, null)
  return node as Val;
}
