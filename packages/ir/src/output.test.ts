import { describe, it, expect } from "vitest";
import type { TisynExpr } from "./types.js";
import { print } from "./print.js";
import { decompile } from "./decompile.js";
import { Ref, Let, Add, TisynEval, Fn, If, Eq, Get, Throw, Call } from "./constructors.js";

describe("print", () => {
  it("print literal", () => {
    expect(print(42)).toBe("42");
  });

  it("print string literal", () => {
    expect(print("hello")).toBe('"hello"');
  });

  it("print Ref", () => {
    expect(print(Ref("x") as TisynExpr)).toBe('Ref("x")');
  });

  it("print Add", () => {
    expect(print(Add(1, 2) as TisynExpr)).toBe("Add(1, 2)");
  });

  it("print Let", () => {
    expect(print(Let("x", 1, 2) as TisynExpr)).toBe('Let("x", 1, 2)');
  });

  it("print Eval", () => {
    expect(print(TisynEval("a.b", []) as TisynExpr)).toBe('Eval("a.b", [])');
  });
});

describe("decompile", () => {
  it("decompile external eval", () => {
    const result = decompile(
      TisynEval("order-service.fetchOrder", [Ref("id")]) as TisynExpr,
    );
    expect(result).toContain("yield*");
    expect(result).toContain("OrderService");
    expect(result).toContain("fetchOrder");
    expect(result).toContain("id");
  });

  it("decompile sleep", () => {
    const result = decompile(TisynEval("sleep", [1000]) as TisynExpr);
    expect(result).toBe("yield* sleep(1000)");
  });

  it("decompile with namedExport", () => {
    const fn = Fn(["x"], Ref("x")) as TisynExpr;
    const result = decompile(fn, { namedExport: "main" });
    expect(result).toContain("function* main(x)");
  });

  it("decompile Let chain", () => {
    const fn = Fn(
      ["id"],
      Let("result", TisynEval("a.b", [Ref("id")]), Ref("result")),
    ) as TisynExpr;
    const result = decompile(fn, { namedExport: "test" });
    expect(result).toContain("const result = yield* A().b(id)");
    expect(result).toContain("return result");
  });

  it("decompile discard binding", () => {
    const fn = Fn(
      [],
      Let("__discard_0", TisynEval("x.y", []), 1),
    ) as TisynExpr;
    const result = decompile(fn, { namedExport: "test" });
    expect(result).not.toContain("const __discard");
    expect(result).toContain("yield* X().y()");
  });

  it("decompile recursive loop", () => {
    const loopBody = If<number>(
      Eq(Ref("i"), 0),
      Ref<number>("i"),
      Call(Ref<() => number>("__loop_0")),
    );
    const fn = Fn(
      [],
      Let("__loop_0", Fn<[], number>([], loopBody), Call(Ref<() => number>("__loop_0"))),
    ) as TisynExpr;
    const result = decompile(fn, { namedExport: "test" });
    expect(result).toContain("while (true)");
  });
});
