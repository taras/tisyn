import { describe, it } from "vitest";
import { expectTypeOf } from "expect-type";
import type { Expr, Eval, Ref, TisynFn } from "./expr.js";
import {
  Add, Sub, Gt, Eq, Not, Neg, If, Let, Throw, Concat, Get,
  Arr, Construct, Fn, Call, All, Race, TisynEval, And, Or,
  Ref as RefCtor,
} from "./constructors.js";

describe("positive type tests", () => {
  it("Add returns Eval<number>", () => {
    expectTypeOf(Add(1, 2)).toEqualTypeOf<Eval<number>>();
  });

  it("Sub returns Eval<number>", () => {
    expectTypeOf(Sub(1, 2)).toEqualTypeOf<Eval<number>>();
  });

  it("Gt returns Eval<boolean>", () => {
    expectTypeOf(Gt(1, 2)).toEqualTypeOf<Eval<boolean>>();
  });

  it("Eq returns Eval<boolean>", () => {
    expectTypeOf(Eq(1, "x")).toEqualTypeOf<Eval<boolean>>();
  });

  it("Not returns Eval<boolean>", () => {
    expectTypeOf(Not(1)).toEqualTypeOf<Eval<boolean>>();
  });

  it("Neg returns Eval<number>", () => {
    expectTypeOf(Neg(1)).toEqualTypeOf<Eval<number>>();
  });

  it("If preserves T", () => {
    expectTypeOf(If(true, 1, 2)).toEqualTypeOf<Eval<number>>();
  });

  it("If with optional else", () => {
    expectTypeOf(If(true, "a")).toEqualTypeOf<Eval<string>>();
  });

  it("Throw is Eval<never>", () => {
    expectTypeOf(Throw("msg")).toEqualTypeOf<Eval<never>>();
  });

  it("Concat returns Eval<string>", () => {
    expectTypeOf(Concat(1, "a", true)).toEqualTypeOf<Eval<string>>();
  });

  it("Ref carries asserted T", () => {
    expectTypeOf(RefCtor<number>("x")).toEqualTypeOf<Ref<number>>();
  });

  it("Arr returns Eval<T[]>", () => {
    expectTypeOf(Arr(1, 2, 3)).toEqualTypeOf<Eval<number[]>>();
  });

  it("Fn produces callable Expr", () => {
    const fn = Fn<[number], string>(["x"], RefCtor<string>("x"));
    expectTypeOf(fn).toEqualTypeOf<TisynFn<[number], string>>();
  });

  it("Fn nullary produces callable", () => {
    const fn = Fn<[], number>([], 42);
    expectTypeOf(fn).toEqualTypeOf<TisynFn<[], number>>();
  });

  it("Call extracts return type", () => {
    const result = Call(RefCtor<() => number>("f"));
    expectTypeOf(result).toEqualTypeOf<Eval<number>>();
  });

  it("All preserves tuple types", () => {
    const result = All(TisynEval<number>("a.b", []), TisynEval<string>("c.d", []));
    expectTypeOf(result).toEqualTypeOf<Eval<[number, string]>>();
  });
});

describe("negative type tests (settled)", () => {
  it("Add rejects string operands", () => {
    // @ts-expect-error string is not Expr<number>
    Add("a", "b");
  });

  it("Add rejects boolean operands", () => {
    // @ts-expect-error boolean is not Expr<number>
    Add(true, false);
  });

  it("Add rejects mixed operands", () => {
    // @ts-expect-error string is not Expr<number>
    Add(1, "a");
  });

  it("Gt rejects string operands", () => {
    // @ts-expect-error string is not Expr<number>
    Gt("a", "b");
  });

  it("Throw rejects non-string message", () => {
    // @ts-expect-error number is not Expr<string>
    Throw(42);
  });

  it("Call rejects non-callable", () => {
    // @ts-expect-error number is not callable
    Call(42);
  });

  it("Call rejects non-callable Ref", () => {
    // @ts-expect-error Ref<number> is not callable
    Call(RefCtor<number>("x"));
  });

  it("Call rejects wrong arg types", () => {
    // @ts-expect-error string not number
    Call(RefCtor<(a: number) => string>("f"), "x");
  });

  it("If rejects non-boolean condition", () => {
    // @ts-expect-error number is not Expr<boolean>
    If(1, "a", "b");
  });
});

describe("provisional restrictions", () => {
  it("If rejects mismatched branches", () => {
    // @ts-expect-error branches disagree on T
    If(true, 1, "a");
  });

  it("And rejects mixed types", () => {
    // @ts-expect-error number vs string
    And(1, "a");
  });

  it("Or rejects mixed types", () => {
    // @ts-expect-error number vs string
    Or(1, "a");
  });

  it("Arr rejects mixed item types", () => {
    // @ts-expect-error number vs string
    Arr(1, "a");
  });
});

describe("Expr<T> literal branch", () => {
  it("number literal is Expr<number>", () => {
    const _: Expr<number> = 42;
  });

  it("string literal is Expr<string>", () => {
    const _: Expr<string> = "hello";
  });

  it("boolean literal is Expr<boolean>", () => {
    const _: Expr<boolean> = true;
  });

  it("null is Expr<null>", () => {
    const _: Expr<null> = null;
  });

  it("Expr<{x:number}> accepts raw object", () => {
    const _: Expr<{ x: number }> = { x: 1 };
  });

  it("function taking Expr<number> rejects string", () => {
    function f(_e: Expr<number>) {}
    // @ts-expect-error string not Expr<number>
    f("x");
  });
});
