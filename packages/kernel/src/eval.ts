/**
 * Tisyn kernel evaluator.
 *
 * eval : (Expr, Env) → Val | Error | Suspend(EffectDescriptor)
 *
 * Implemented as a generator: yield = Suspend, return = Val, throw = Error.
 * The execution layer drives the generator, feeding results via .next().
 *
 * See Kernel Specification §1.4, §4, §5.
 */

import {
  type Expr,
  type Val,
  type Json,
  type EffectDescriptor,
  isEvalNode,
  isQuoteNode,
  isRefNode,
  isFnNode,
  canonical,
  TypeError,
  DivisionByZero,
  ExplicitThrow,
  NotCallable,
} from "@tisyn/shared";
import { type Env, lookup, extend, extendMulti } from "./environment.js";
import { classify, isCompoundExternal } from "./classify.js";
import { resolve } from "./resolve.js";
import { unquote } from "./unquote.js";

// ── Truthiness per Kernel Spec §5.3 ──

function truthy(v: Val): boolean {
  return v !== false && v !== null && v !== 0 && v !== "";
}

// ── The evaluator ──

/**
 * Evaluate a Tisyn IR expression.
 *
 * This is a generator that yields EffectDescriptors when it encounters
 * external operations. The caller feeds results back via .next(val).
 */
export function* evaluate(expr: Expr, env: Env): Generator<EffectDescriptor, Val, Val> {
  // Rule LITERAL: value without matching tisyn → itself
  if (expr === null || typeof expr !== "object") {
    return expr as Val;
  }

  // Array literal → itself
  if (Array.isArray(expr)) {
    return expr as Val;
  }

  // Rule REF: resolve in environment
  if (isRefNode(expr)) {
    return lookup(expr.name, env);
  }

  // Rule QUOTE: return inner expression without evaluating
  if (isQuoteNode(expr)) {
    return expr.expr as Val;
  }

  // Rule FN: evaluates to itself
  if (isFnNode(expr)) {
    return expr as unknown as Val;
  }

  // Rule EVAL: classify and dispatch
  if (isEvalNode(expr)) {
    const { id, data } = expr;

    if (classify(id) === "STRUCTURAL") {
      return yield* evalStructural(id, data, env);
    }

    // EXTERNAL: compound or standard
    if (isCompoundExternal(id)) {
      // Compound: use unquote to preserve child expressions
      const inner = yield* unquote(data, env, evaluate);
      const descriptor: EffectDescriptor = { id, data: inner };
      return yield descriptor;
    }

    // Standard external: resolve all data to Val
    const resolved = yield* resolve(data, env, evaluate);
    const descriptor: EffectDescriptor = { id, data: resolved };
    return yield descriptor;
  }

  // Plain object literal without matching tisyn → itself
  return expr as Val;
}

// ── Structural operations (Kernel Spec §5) ──

function* evalStructural(id: string, data: Expr, env: Env): Generator<EffectDescriptor, Val, Val> {
  const fields = (yield* unquote(data, env, evaluate)) as Record<string, unknown>;

  switch (id) {
    // §5.1 let
    case "let": {
      const name = fields["name"] as string;
      const value = yield* evaluate(fields["value"] as Expr, env);
      const newEnv = extend(env, name, value);
      return yield* evaluate(fields["body"] as Expr, newEnv);
    }

    // §5.2 seq
    case "seq": {
      const exprs = fields["exprs"] as Expr[];
      let result: Val = null;
      for (const expr of exprs) {
        result = yield* evaluate(expr, env);
      }
      return result;
    }

    // §5.3 if
    case "if": {
      const condition = yield* evaluate(fields["condition"] as Expr, env);
      if (truthy(condition)) {
        return yield* evaluate(fields["then"] as Expr, env);
      }
      if ("else" in fields) {
        return yield* evaluate(fields["else"] as Expr, env);
      }
      return null;
    }

    // §5.4 while
    case "while": {
      const condExpr = fields["condition"] as Expr;
      const bodyExprs = fields["exprs"] as Expr[];
      let result: Val = null;
      for (;;) {
        const cond = yield* evaluate(condExpr, env);
        if (!truthy(cond)) return result;
        for (const expr of bodyExprs) {
          result = yield* evaluate(expr, env);
        }
      }
    }

    // §5.5 call
    case "call": {
      const fnExpr = fields["fn"] as Expr;
      const argExprs = fields["args"] as Expr[];
      const fn = yield* evaluate(fnExpr, env);

      if (
        typeof fn !== "object" ||
        fn === null ||
        (fn as Record<string, unknown>)["tisyn"] !== "fn"
      ) {
        throw new NotCallable(`Value is not callable: ${JSON.stringify(fn)}`);
      }

      const fnNode = fn as unknown as { params: string[]; body: Expr };
      const args: Val[] = [];
      for (const argExpr of argExprs) {
        args.push(yield* evaluate(argExpr, env));
      }

      // Call-site resolution: body evaluates in CALLER's env + param bindings
      const callEnv = extendMulti(env, fnNode.params, args);
      return yield* evaluate(fnNode.body as Expr, callEnv);
    }

    // §5.6 get
    case "get": {
      const obj = yield* evaluate(fields["obj"] as Expr, env);
      const key = fields["key"] as string; // key is a literal, not evaluated
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj) && key in obj) {
        return (obj as Record<string, Val>)[key]!;
      }
      return null;
    }

    // §5.7 Arithmetic
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod": {
      const a = yield* evaluate(fields["a"] as Expr, env);
      const b = yield* evaluate(fields["b"] as Expr, env);
      if (typeof a !== "number") throw new TypeError(`${id}: left operand is not a number`);
      if (typeof b !== "number") throw new TypeError(`${id}: right operand is not a number`);
      if ((id === "div" || id === "mod") && b === 0) throw new DivisionByZero();
      switch (id) {
        case "add":
          return a + b;
        case "sub":
          return a - b;
        case "mul":
          return a * b;
        case "div":
          return a / b;
        case "mod":
          return a % b;
      }
      break;
    }

    // §5.8 Comparison
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = yield* evaluate(fields["a"] as Expr, env);
      const b = yield* evaluate(fields["b"] as Expr, env);
      if (typeof a !== "number") throw new TypeError(`${id}: left operand is not a number`);
      if (typeof b !== "number") throw new TypeError(`${id}: right operand is not a number`);
      switch (id) {
        case "gt":
          return a > b;
        case "gte":
          return a >= b;
        case "lt":
          return a < b;
        case "lte":
          return a <= b;
      }
      break;
    }

    // §5.9 Equality
    case "eq":
    case "neq": {
      const a = yield* evaluate(fields["a"] as Expr, env);
      const b = yield* evaluate(fields["b"] as Expr, env);
      const equal = canonical(a as Json) === canonical(b as Json);
      return id === "eq" ? equal : !equal;
    }

    // §5.10 Short-circuit — return operand values, NOT booleans
    case "and": {
      const a = yield* evaluate(fields["a"] as Expr, env);
      if (!truthy(a)) return a; // short-circuit: return A itself
      return yield* evaluate(fields["b"] as Expr, env);
    }

    case "or": {
      const a = yield* evaluate(fields["a"] as Expr, env);
      if (truthy(a)) return a; // short-circuit: return A itself
      return yield* evaluate(fields["b"] as Expr, env);
    }

    // §5.11 Unary
    case "not": {
      const a = yield* evaluate(fields["a"] as Expr, env);
      return !truthy(a);
    }

    case "neg": {
      const a = yield* evaluate(fields["a"] as Expr, env);
      if (typeof a !== "number") throw new TypeError("neg: operand is not a number");
      return -a;
    }

    // §5.12 construct — lexicographic key order
    case "construct": {
      const keys = Object.keys(fields).sort();
      const result: Record<string, Val> = {};
      for (const key of keys) {
        result[key] = yield* evaluate(fields[key] as Expr, env);
      }
      return result;
    }

    // §5.13 array
    case "array": {
      const items = fields["items"] as Expr[];
      const result: Val[] = [];
      for (const item of items) {
        result.push(yield* evaluate(item, env));
      }
      return result;
    }

    // §5.14 concat
    case "concat": {
      const parts = fields["parts"] as Expr[];
      let result = "";
      for (const part of parts) {
        const val = yield* evaluate(part, env);
        result += String(val);
      }
      return result;
    }

    // §5.15 throw
    case "throw": {
      const message = yield* evaluate(fields["message"] as Expr, env);
      throw new ExplicitThrow(String(message));
    }

    default:
      throw new Error(`Unknown structural operation: ${id}`);
  }

  // TypeScript: unreachable but needed for exhaustiveness
  throw new Error(`Unreachable: ${id}`);
}
