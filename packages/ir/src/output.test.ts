import { describe, it, expect } from "vitest";
import type { TisynExpr } from "./types.js";
import { print } from "./print.js";
import { decompile } from "./decompile.js";
import { Ref, Let, Add, Eval, Fn, If, Eq, Call, Construct } from "./constructors.js";

describe("print", () => {
  it("print literal", () => {
    expect(print(42)).toBe("42");
  });

  it("print string literal", () => {
    expect(print("hello")).toBe('"hello"');
  });

  it("print Ref", () => {
    expect(print(Ref("x"))).toBe('Ref("x")');
  });

  it("print Add", () => {
    expect(print(Add(1, 2))).toBe("Add(1, 2)");
  });

  it("print Let", () => {
    expect(print(Let("x", 1, 2))).toBe('Let("x", 1, 2)');
  });

  it("print Eval with empty array payload", () => {
    expect(print(Eval("a.b", []))).toBe('Eval("a.b", [])');
  });

  it("print Eval with single Ref payload", () => {
    expect(print(Eval("a.b", Ref("x")))).toBe('Eval("a.b", Ref("x"))');
  });

  it("print Eval with Construct payload (compiler-generated IR)", () => {
    // Simulates compiler-generated IR: ExternalEval("id", Construct({...}))
    const compilerIR: TisynExpr = {
      tisyn: "eval",
      id: "browser.waitForUser",
      data: { tisyn: "eval", id: "construct", data: { tisyn: "quote", expr: { prompt: "hello" } } },
    };
    expect(print(compilerIR)).toBe('Eval("browser.waitForUser", Construct({ prompt: "hello" }))');
  });

  it("print nested workflow-shaped expression", () => {
    const expr = Fn(["x"], Let("y", Eval("svc.op", Ref("x")), Ref("y")));
    const result = print(expr);
    expect(result).toContain("Fn(");
    expect(result).toContain("Let(");
    expect(result).toContain('Eval("svc.op", Ref("x"))');
    expect(result).toContain('Ref("y")');
  });

  it("print Eval multiline with compact: false", () => {
    const expr = Eval("svc.op", Ref("x"));
    const result = print(expr, { compact: false });
    expect(result).toContain('Eval("svc.op",');
    expect(result).toContain('Ref("x")');
  });

  it("refTypeAnnotation emits typed Ref calls", () => {
    const expr = Let("x", Ref("y"), Ref("x"));
    const result = print(expr, { refTypeAnnotation: "any" });
    expect(result).toContain('Ref<any>("y")');
    expect(result).toContain('Ref<any>("x")');
  });

  it("refTypeAnnotation does not affect string literals", () => {
    const expr = Construct({ msg: "Ref(foo)" });
    const result = print(expr, { refTypeAnnotation: "any" });
    expect(result).toContain('"Ref(foo)"');
    expect(result).not.toContain("Ref<any>(foo)");
  });
});

describe("decompile", () => {
  it("decompile external eval", () => {
    const result = decompile(Eval("order-service.fetchOrder", Ref("id")));
    expect(result).toContain("yield*");
    expect(result).toContain("OrderService");
    expect(result).toContain("fetchOrder");
    expect(result).toContain("id");
  });

  it("decompile sleep", () => {
    const result = decompile(Eval("sleep", 1000));
    expect(result).toBe("yield* sleep(1000)");
  });

  it("decompile with namedExport", () => {
    const fn = Fn(["x"], Ref("x"));
    const result = decompile(fn, { namedExport: "main" });
    expect(result).toContain("function* main(x)");
  });

  it("decompile Let chain", () => {
    const fn = Fn(["id"], Let("result", Eval("a.b", Ref("id")), Ref("result")));
    const result = decompile(fn, { namedExport: "test" });
    expect(result).toContain("const result = yield* A().b(id)");
    expect(result).toContain("return result");
  });

  it("decompile discard binding", () => {
    const fn = Fn([], Let("__discard_0", Eval("x.y", null), 1));
    const result = decompile(fn, { namedExport: "test" });
    expect(result).not.toContain("const __discard");
    expect(result).toContain("yield* X().y(");
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
    );
    const result = decompile(fn, { namedExport: "test" });
    expect(result).toContain("while (true)");
  });
});
