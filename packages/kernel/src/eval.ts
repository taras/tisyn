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
  type TisynExpr as Expr,
  type Val,
  type Json,
  isEvalNode,
  isQuoteNode,
  isRefNode,
  isFnNode,
} from "@tisyn/ir";
import type { EffectDescriptor } from "./events.js";
import { canonical } from "./canonical.js";
import {
  TypeError,
  DivisionByZero,
  ExplicitThrow,
  NotCallable,
  isCatchable,
  errorToValue,
} from "./errors.js";
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
      if (id === "timebox") {
        // Per-ID evaluation rule (Timebox Spec §7):
        // Evaluate duration to a Val, keep body as unevaluated Expr.
        const inner = yield* unquote(data, env, evaluate);
        const fields = inner as { duration: unknown; body: unknown };
        const durationVal = yield* evaluate(fields.duration as Expr, env);
        if (
          typeof durationVal !== "number" ||
          !Number.isFinite(durationVal) ||
          durationVal < 0
        ) {
          throw new TypeError(
            `timebox: duration must be a non-negative finite number, got ${JSON.stringify(durationVal)}`,
          );
        }
        const descriptor: EffectDescriptor = {
          id,
          data: {
            __tisyn_inner: { duration: durationVal, body: fields.body },
            __tisyn_env: env,
          },
        };
        return yield descriptor;
      }

      // Generic compound external path (all, race, scope, spawn, etc.)
      // Attach env via wrapper struct so the runtime can spawn child
      // kernels in the parent's scope. Using a wrapper (not spread)
      // prevents collision with user data fields.
      // The runtime MUST strip these immediately — they must never
      // escape the orchestration boundary.
      const inner = yield* unquote(data, env, evaluate);
      const descriptor: EffectDescriptor = {
        id,
        data: { __tisyn_inner: inner, __tisyn_env: env },
      };
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

    // §5.16 concat-arrays
    case "concat-arrays": {
      const arrays = fields["arrays"] as Expr[];
      const result: Val[] = [];
      for (const arr of arrays) {
        const val = yield* evaluate(arr, env);
        if (!Array.isArray(val)) throw new TypeError(`concat-arrays: operand is not an array`);
        result.push(...(val as Val[]));
      }
      return result;
    }

    // §5.17 merge-objects
    case "merge-objects": {
      const objects = fields["objects"] as Expr[];
      const result: Record<string, Val> = {};
      for (const obj of objects) {
        const val = yield* evaluate(obj, env);
        if (typeof val !== "object" || val === null || Array.isArray(val))
          throw new TypeError(`merge-objects: operand is not an object`);
        Object.assign(result, val as Record<string, Val>);
      }
      return result;
    }

    // §5.16 try
    case "try": {
      const body = fields["body"] as Expr;
      const catchParam = fields["catchParam"] as string | undefined;
      const catchBody = fields["catchBody"] as Expr | undefined;
      const finallyBody = fields["finally"] as Expr | undefined;

      type Outcome = { ok: true; value: Val } | { ok: false; error: unknown };
      let outcome: Outcome;

      // Phase 1: body
      try {
        outcome = { ok: true, value: yield* evaluate(body, env) };
      } catch (e) {
        if (!isCatchable(e)) {
          // Non-catchable (halt, divergence, etc.): run finally if present, then re-raise
          if (finallyBody !== undefined) {
            yield* evaluate(finallyBody, env);
          }
          throw e;
        }
        outcome = { ok: false, error: e };
      }

      // Phase 2: catch clause
      if (!outcome.ok && catchBody !== undefined) {
        const errorVal = errorToValue(outcome.error);
        const catchEnv = catchParam !== undefined ? extend(env, catchParam, errorVal) : env;
        try {
          outcome = { ok: true, value: yield* evaluate(catchBody, catchEnv) };
        } catch (e) {
          outcome = { ok: false, error: e };
        }
      }

      // Phase 3: finally — result DISCARDED; if it throws, that error replaces prior outcome
      if (finallyBody !== undefined) {
        const fp = fields["finallyPayload"] as string | undefined;
        const finallyEnv =
          fp !== undefined && outcome.ok ? extend(env, fp, outcome.value as Val) : env;
        yield* evaluate(finallyBody, finallyEnv);
      }

      if (outcome.ok) return outcome.value;
      throw outcome.error;
    }

    default:
      throw new Error(`Unknown structural operation: ${id}`);
  }

  // TypeScript: unreachable but needed for exhaustiveness
  throw new Error(`Unreachable: ${id}`);
}
