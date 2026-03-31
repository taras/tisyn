import { describe, it } from "vitest";
import { expectTypeOf } from "expect-type";
import type { Expr, Eval as EvalType, Ref, TisynFn, IrInput } from "./expr.js";
import {
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Gt,
  Eq,
  Not,
  Neg,
  If,
  Let,
  Throw,
  Concat,
  Get,
  Arr,
  Construct,
  Fn,
  Call,
  All,
  Race,
  Eval,
  And,
  Or,
  Seq,
  Ref as RefCtor,
  Q,
} from "./constructors.js";

describe("positive type tests", () => {
  it("Add returns Eval<number>", () => {
    expectTypeOf(Add(1, 2)).toEqualTypeOf<EvalType<number>>();
  });

  it("Sub returns Eval<number>", () => {
    expectTypeOf(Sub(1, 2)).toEqualTypeOf<EvalType<number>>();
  });

  it("Gt returns Eval<boolean>", () => {
    expectTypeOf(Gt(1, 2)).toEqualTypeOf<EvalType<boolean>>();
  });

  it("Eq returns Eval<boolean>", () => {
    expectTypeOf(Eq(1, "x")).toEqualTypeOf<EvalType<boolean>>();
  });

  it("Not returns Eval<boolean>", () => {
    expectTypeOf(Not(1)).toEqualTypeOf<EvalType<boolean>>();
  });

  it("Neg returns Eval<number>", () => {
    expectTypeOf(Neg(1)).toEqualTypeOf<EvalType<number>>();
  });

  it("If preserves T", () => {
    expectTypeOf(If(true, 1, 2)).toEqualTypeOf<EvalType<number>>();
  });

  it("If with optional else", () => {
    expectTypeOf(If(true, "a")).toEqualTypeOf<EvalType<string>>();
  });

  it("Throw is Eval<never>", () => {
    expectTypeOf(Throw("msg")).toEqualTypeOf<EvalType<never>>();
  });

  it("Concat returns Eval<string>", () => {
    expectTypeOf(Concat(1, "a", true)).toEqualTypeOf<EvalType<string>>();
  });

  it("Ref carries asserted T", () => {
    expectTypeOf(RefCtor<number>("x")).toEqualTypeOf<Ref<number>>();
  });

  it("Arr returns Eval<T[]>", () => {
    expectTypeOf(Arr(1, 2, 3)).toEqualTypeOf<EvalType<number[]>>();
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
    expectTypeOf(result).toEqualTypeOf<EvalType<number>>();
  });

  it("Mul returns Eval<number>", () => {
    expectTypeOf(Mul(1, 2)).toEqualTypeOf<EvalType<number>>();
  });

  it("Div returns Eval<number>", () => {
    expectTypeOf(Div(1, 2)).toEqualTypeOf<EvalType<number>>();
  });

  it("Mod returns Eval<number>", () => {
    expectTypeOf(Mod(1, 2)).toEqualTypeOf<EvalType<number>>();
  });

  it("Let preserves body T", () => {
    expectTypeOf(Let("x", 1, RefCtor<string>("x"))).toEqualTypeOf<EvalType<string>>();
  });

  it("Get returns asserted T", () => {
    expectTypeOf(Get<number>(RefCtor("obj"), "age")).toEqualTypeOf<EvalType<number>>();
  });

  it("Construct preserves field types", () => {
    expectTypeOf(Construct({ a: 1, b: "x" })).toEqualTypeOf<EvalType<{ a: number; b: string }>>();
  });

  it("Seq returns last element T", () => {
    expectTypeOf(Seq(1, "a")).toEqualTypeOf<EvalType<string>>();
  });

  it("And preserves T", () => {
    expectTypeOf(And(1, 2)).toEqualTypeOf<EvalType<number>>();
  });

  it("Or preserves T", () => {
    expectTypeOf(Or("a", "b")).toEqualTypeOf<EvalType<string>>();
  });

  it("Call with Ref to callable", () => {
    expectTypeOf(Call(RefCtor<() => number>("f"))).toEqualTypeOf<EvalType<number>>();
  });

  it("All preserves tuple types", () => {
    const result = All(Eval<number>("a.b", []), Eval<string>("c.d", []));
    expectTypeOf(result).toEqualTypeOf<EvalType<[number, string]>>();
  });

  it("Race requires homogeneous", () => {
    const result = Race(Eval<number>("a.b", []), Eval<number>("c.d", []));
    expectTypeOf(result).toEqualTypeOf<EvalType<number>>();
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
    // Kernel allows any types in branches; authoring restricts — could relax to union
    // @ts-expect-error branches disagree on T
    If(true, 1, "a");
  });

  it("And rejects mixed types", () => {
    // Kernel accepts any types; authoring restricts to matching T
    // @ts-expect-error number vs string
    And(1, "a");
  });

  it("Or rejects mixed types", () => {
    // Kernel accepts any types; authoring restricts to matching T
    // @ts-expect-error number vs string
    Or(1, "a");
  });

  it("Arr rejects mixed item types", () => {
    // Kernel accepts any items; authoring restricts to homogeneous — tuple variant may be added later
    // @ts-expect-error number vs string
    Arr(1, "a");
  });

  it("Race rejects mixed types", () => {
    // Kernel allows heterogeneous; authoring restricts — could gain per-child typing like All
    // @ts-expect-error number vs string
    Race(Eval<number>("a", []), Eval<string>("b", []));
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

  it("Expr<unknown> accepts anything", () => {
    const _: Expr<unknown> = { anything: true };
  });
});

describe("Fn/Call pressure tests", () => {
  it("binary Fn", () => {
    const fn = Fn<[number, string], boolean>(["a", "b"], true);
    expectTypeOf(fn).toEqualTypeOf<TisynFn<[number, string], boolean>>();
  });

  it("Call binary correct", () => {
    const result = Call(RefCtor<(a: number, b: string) => boolean>("f"), 1, "x");
    expectTypeOf(result).toEqualTypeOf<EvalType<boolean>>();
  });

  it("Call binary wrong second arg", () => {
    // @ts-expect-error number not string
    Call(RefCtor<(a: number, b: string) => boolean>("f"), 1, 2);
  });

  it("Call arity mismatch: too few", () => {
    // @ts-expect-error missing arg
    Call(RefCtor<(a: number, b: string) => boolean>("f"), 1);
  });

  it("Call arity mismatch: too many", () => {
    // @ts-expect-error extra arg
    Call(RefCtor<(a: number) => string>("f"), 1, 2);
  });

  it("Call non-callable: string literal", () => {
    // @ts-expect-error string is not callable
    Call("hello");
  });

  it("Call return type threads into Add", () => {
    const result = Add(Call(RefCtor<() => number>("f")), 1);
    expectTypeOf(result).toEqualTypeOf<EvalType<number>>();
  });

  it("Call return type threads into If condition", () => {
    const result = If(Call(RefCtor<() => boolean>("f")), 1, 2);
    expectTypeOf(result).toEqualTypeOf<EvalType<number>>();
  });

  it("Call<string> rejected by Add", () => {
    // @ts-expect-error Eval<string> not Expr<number>
    Add(Call(RefCtor<() => string>("f")), 1);
  });

  it("Let body uses Call return", () => {
    const result = Let("x", Call(RefCtor<() => number>("f")), Add(RefCtor<number>("x"), 1));
    expectTypeOf(result).toEqualTypeOf<EvalType<number>>();
  });

  it("Throw in If branch unifies to number", () => {
    const result = If<number>(true, Throw("x"), 42);
    expectTypeOf(result).toEqualTypeOf<EvalType<number>>();
  });
});

describe("IrInput positive type tests", () => {
  it("Eval<T> is assignable to IrInput", () => {
    expectTypeOf<EvalType<number>>().toMatchTypeOf<IrInput>();
  });

  it("Quote<T> is assignable to IrInput", () => {
    expectTypeOf<ReturnType<typeof Q<number>>>().toMatchTypeOf<IrInput>();
  });

  it("Ref<T> is assignable to IrInput", () => {
    expectTypeOf<Ref<string>>().toMatchTypeOf<IrInput>();
  });

  it("TisynFn<A, R> is assignable to IrInput", () => {
    expectTypeOf<TisynFn<[], void>>().toMatchTypeOf<IrInput>();
  });

  it("TisynExpr literal (number) is assignable to IrInput", () => {
    expectTypeOf<number>().toMatchTypeOf<IrInput>();
  });
});

describe("IrInput negative type tests", () => {
  it("function is not assignable to IrInput", () => {
    expectTypeOf<() => number>().not.toMatchTypeOf<IrInput>();
  });

  it("symbol is not assignable to IrInput", () => {
    expectTypeOf<symbol>().not.toMatchTypeOf<IrInput>();
  });

  it("Date is not assignable to IrInput", () => {
    expectTypeOf<Date>().not.toMatchTypeOf<IrInput>();
  });
});
