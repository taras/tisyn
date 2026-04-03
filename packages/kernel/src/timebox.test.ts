/**
 * Kernel tests for `timebox` per-ID evaluation rule.
 *
 * Verifies:
 * - Duration is evaluated to a Val (number)
 * - Body remains as unevaluated Expr in the descriptor
 * - TypeError for non-numeric, negative, NaN, Infinity durations
 * - Classification as compound external
 */

import { describe, it, expect } from "vitest";
import { classify, isCompoundExternal } from "./classify.js";
import { evaluate } from "./eval.js";
import { extend, EMPTY_ENV } from "./environment.js";
import type { TisynExpr as Expr, Val } from "@tisyn/ir";
import type { EffectDescriptor } from "./events.js";

// ── IR helpers (plain objects, no build deps) ──

function Q(expr: unknown) {
  return { tisyn: "quote" as const, expr };
}

function Ref(name: string) {
  return { tisyn: "ref" as const, name };
}

function TimeboxIR(duration: unknown, body: unknown) {
  return { tisyn: "eval" as const, id: "timebox", data: Q({ duration, body }) };
}

function MulIR(a: unknown, b: unknown) {
  return { tisyn: "eval" as const, id: "mul", data: Q({ a, b }) };
}

describe("timebox classification", () => {
  it("classify('timebox') returns EXTERNAL", () => {
    expect(classify("timebox")).toBe("EXTERNAL");
  });

  it("isCompoundExternal('timebox') returns true", () => {
    expect(isCompoundExternal("timebox")).toBe(true);
  });
});

describe("timebox kernel evaluation", () => {
  it("literal duration yields descriptor with resolved number", () => {
    const bodyExpr = { tisyn: "eval" as const, id: "agent.work", data: [] };
    const ir = TimeboxIR(5000, bodyExpr);

    const gen = evaluate(ir as unknown as Expr, EMPTY_ENV);
    const result = gen.next();

    expect(result.done).toBe(false);
    const descriptor = result.value as EffectDescriptor;
    expect(descriptor.id).toBe("timebox");

    const inner = (descriptor.data as Record<string, unknown>).__tisyn_inner as {
      duration: unknown;
      body: unknown;
    };
    expect(inner.duration).toBe(5000);
  });

  it("Ref duration resolves from env", () => {
    const env = extend(EMPTY_ENV, "timeout", 3000 as unknown as Val);
    const bodyExpr = { tisyn: "eval" as const, id: "agent.work", data: [] };
    const ir = TimeboxIR(Ref("timeout"), bodyExpr);

    const gen = evaluate(ir as unknown as Expr, env);
    const result = gen.next();

    expect(result.done).toBe(false);
    const descriptor = result.value as EffectDescriptor;
    const inner = (descriptor.data as Record<string, unknown>).__tisyn_inner as {
      duration: unknown;
      body: unknown;
    };
    expect(inner.duration).toBe(3000);
  });

  it("structural expression duration (mul) evaluates synchronously", () => {
    const env = extend(EMPTY_ENV, "base", 1000 as unknown as Val);
    const bodyExpr = 42;
    const ir = TimeboxIR(MulIR(Ref("base"), 3), bodyExpr);

    const gen = evaluate(ir as unknown as Expr, env);
    const result = gen.next();

    expect(result.done).toBe(false);
    const descriptor = result.value as EffectDescriptor;
    const inner = (descriptor.data as Record<string, unknown>).__tisyn_inner as {
      duration: unknown;
      body: unknown;
    };
    expect(inner.duration).toBe(3000);
  });

  it("body remains as unevaluated Expr in descriptor", () => {
    const bodyExpr = { tisyn: "eval" as const, id: "agent.work", data: [1, 2, 3] };
    const ir = TimeboxIR(5000, bodyExpr);

    const gen = evaluate(ir as unknown as Expr, EMPTY_ENV);
    const result = gen.next();

    expect(result.done).toBe(false);
    const descriptor = result.value as EffectDescriptor;
    const inner = (descriptor.data as Record<string, unknown>).__tisyn_inner as {
      duration: unknown;
      body: unknown;
    };
    // Body is the raw Expr, not evaluated
    expect(inner.body).toEqual(bodyExpr);
  });

  it("env is attached for runtime child kernel creation", () => {
    const env = extend(EMPTY_ENV, "x", 42 as unknown as Val);
    const ir = TimeboxIR(1000, 99);

    const gen = evaluate(ir as unknown as Expr, env);
    const result = gen.next();

    expect(result.done).toBe(false);
    const descriptor = result.value as EffectDescriptor;
    const attachedEnv = (descriptor.data as Record<string, unknown>).__tisyn_env;
    expect(attachedEnv).toBe(env);
  });

  it("non-numeric duration throws TypeError", () => {
    const ir = TimeboxIR("not a number", 42);
    const gen = evaluate(ir as unknown as Expr, EMPTY_ENV);

    expect(() => gen.next()).toThrow(/timebox: duration must be a non-negative finite number/);
  });

  it("negative duration throws TypeError", () => {
    const ir = TimeboxIR(-100, 42);
    const gen = evaluate(ir as unknown as Expr, EMPTY_ENV);

    expect(() => gen.next()).toThrow(/timebox: duration must be a non-negative finite number/);
  });

  it("NaN duration throws TypeError", () => {
    const env = extend(EMPTY_ENV, "d", NaN as unknown as Val);
    const ir = TimeboxIR(Ref("d"), 42);
    const gen = evaluate(ir as unknown as Expr, env);

    expect(() => gen.next()).toThrow(/timebox: duration must be a non-negative finite number/);
  });

  it("Infinity duration throws TypeError", () => {
    const env = extend(EMPTY_ENV, "d", Infinity as unknown as Val);
    const ir = TimeboxIR(Ref("d"), 42);
    const gen = evaluate(ir as unknown as Expr, env);

    expect(() => gen.next()).toThrow(/timebox: duration must be a non-negative finite number/);
  });

  it("zero duration is valid", () => {
    const ir = TimeboxIR(0, 42);
    const gen = evaluate(ir as unknown as Expr, EMPTY_ENV);
    const result = gen.next();

    expect(result.done).toBe(false);
    const descriptor = result.value as EffectDescriptor;
    const inner = (descriptor.data as Record<string, unknown>).__tisyn_inner as {
      duration: unknown;
    };
    expect(inner.duration).toBe(0);
  });

  it("kernel resumes with runtime-provided result", () => {
    const ir = TimeboxIR(1000, 42);
    const gen = evaluate(ir as unknown as Expr, EMPTY_ENV);

    // Yield the descriptor
    const yieldResult = gen.next();
    expect(yieldResult.done).toBe(false);

    // Feed the result back (simulating runtime response)
    const timeboxResult = { status: "completed", value: 99 };
    const finalResult = gen.next(timeboxResult as unknown as Val);
    expect(finalResult.done).toBe(true);
    expect(finalResult.value).toEqual(timeboxResult);
  });
});
