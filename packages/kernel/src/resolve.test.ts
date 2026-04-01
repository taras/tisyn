/**
 * Kernel resolve() tests.
 *
 * Tests use plain-object IR to avoid circular build deps.
 * The generator driver runs synchronously for non-yielding cases.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "./resolve.js";
import { EMPTY_ENV, extend } from "./environment.js";
import type { TisynExpr as Expr, Val } from "@tisyn/ir";
import type { EffectDescriptor } from "./events.js";
import type { Env } from "./environment.js";

// ── IR helpers (plain objects, no build deps) ──

function Q(expr: unknown) {
  return { tisyn: "quote" as const, expr };
}

function Ref(name: string) {
  return { tisyn: "ref" as const, name };
}

function Eval(id: string, data: unknown) {
  return { tisyn: "eval" as const, id, data };
}

// ── Driver ──

/**
 * Drive resolve() to completion. Throws if the generator yields
 * (i.e. tries to dispatch an effect).
 */
function run(node: unknown, env: Env = EMPTY_ENV): unknown {
  const evalFn = function* (expr: Expr, _env: Env): Generator<EffectDescriptor, Val, Val> {
    throw new Error(`Unexpected eval call for: ${JSON.stringify(expr)}`);
  };
  const gen = resolve(node as Expr, env, evalFn);
  const result = gen.next();
  if (!result.done) {
    throw new Error(`Unexpected yield: ${JSON.stringify(result.value)}`);
  }
  return result.value;
}

/**
 * Drive resolve() with a real evalFn that yields effect descriptors.
 * Returns the first yielded descriptor (does not resume).
 */
function runUntilYield(node: unknown, env: Env = EMPTY_ENV): EffectDescriptor {
  const evalFn = function* (expr: Expr, _env: Env): Generator<EffectDescriptor, Val, Val> {
    // For EvalNode, yield the descriptor like the real evaluator would
    const evalNode = expr as unknown as { tisyn: "eval"; id: string; data: unknown };
    const descriptor: EffectDescriptor = { id: evalNode.id, data: evalNode.data as Val };
    return yield descriptor;
  };
  const gen = resolve(node as Expr, env, evalFn);
  const result = gen.next();
  if (result.done) {
    throw new Error(`Expected yield but generator completed with: ${JSON.stringify(result.value)}`);
  }
  return result.value;
}

// ── Tests ──

describe("resolve()", () => {
  describe("Quote unwraps to opaque data", () => {
    it("Q(primitive) returns the primitive", () => {
      expect(run(Q(42))).toBe(42);
    });

    it("Q(null) returns null", () => {
      expect(run(Q(null))).toBe(null);
    });

    it("Q(plain object) returns the object as-is", () => {
      expect(run(Q({ a: 1, b: "hello" }))).toEqual({ a: 1, b: "hello" });
    });

    it("Q(nested Eval) preserves the Eval node as data", () => {
      const inner = Eval("inner-effect", Q({ value: 42 }));
      const result = run(Q({ nested: inner }));
      // The nested Eval node must be preserved as inert data
      expect(result).toEqual({ nested: inner });
    });

    it("Q(nested Ref) preserves the Ref node as data", () => {
      const env = extend(EMPTY_ENV, "x", 10 as Val);
      const result = run(Q({ nested: Ref("x") }), env);
      // The nested Ref must NOT be resolved to 10
      expect(result).toEqual({ nested: { tisyn: "ref", name: "x" } });
    });

    it("Q(nested Quote) preserves the inner Quote as data", () => {
      const result = run(Q(Q(1)));
      // The inner Quote node must be preserved as-is
      expect(result).toEqual({ tisyn: "quote", expr: 1 });
    });
  });

  describe("Unquoted positions still resolve normally", () => {
    it("plain object with Ref resolves the Ref", () => {
      const env = extend(EMPTY_ENV, "x", 10 as Val);
      // Use a real evalFn that handles lookup for Ref
      const evalFn = function* (): Generator<EffectDescriptor, Val, Val> {
        throw new Error("should not eval");
      };
      // For Ref, resolve calls lookup directly (not evalFn)
      const gen = resolve({ a: Ref("x") } as unknown as Expr, env, evalFn);
      const result = gen.next();
      expect(result.done).toBe(true);
      expect(result.value).toEqual({ a: 10 });
    });

    it("plain object with Eval yields the effect", () => {
      const descriptor = runUntilYield({ nested: Eval("some-effect", 99) });
      expect(descriptor.id).toBe("some-effect");
    });

    it("array elements are resolved", () => {
      const env = extend(EMPTY_ENV, "x", 5 as Val);
      const result = run([Q(1), Ref("x"), Q(3)], env);
      expect(result).toEqual([1, 5, 3]);
    });
  });
});
