import { describe, it, expect } from "vitest";
import type { TisynExpr } from "./types.js";
import { walk } from "./walk.js";
import { fold, defaultAlgebra, foldWith } from "./fold.js";
import { transform } from "./transform.js";
import { collectRefs, collectExternalIds, collectFreeRefs } from "./collect.js";
import { Ref, Let, Add, Q, Fn, Eval, If, Seq } from "./constructors.js";
import { isRefNode, isEvalNode } from "./guards.js";

describe("walk", () => {
  it("visits literal", () => {
    const visited: TisynExpr[] = [];
    walk(42, { enter(node) { visited.push(node); } });
    expect(visited).toEqual([42]);
  });

  it("visits Ref", () => {
    const visited: TisynExpr[] = [];
    walk(Ref("x") as TisynExpr, { enter(node) { visited.push(node); } });
    expect(visited).toHaveLength(1);
    expect(isRefNode(visited[0])).toBe(true);
  });

  it("enters Quote contents", () => {
    const visited: TisynExpr[] = [];
    walk(Q(Ref("x")) as TisynExpr, { enter(node) { visited.push(node); } });
    const refs = visited.filter(isRefNode);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("x");
  });

  it("enters external Eval data", () => {
    const visited: TisynExpr[] = [];
    walk(Eval("a.b", [Ref("x")]) as TisynExpr, { enter(node) { visited.push(node); } });
    const refs = visited.filter(isRefNode);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("x");
  });

  it("provides correct path", () => {
    const paths: string[][] = [];
    walk(Let("x", 1, Ref("x")) as TisynExpr, {
      enter(node, path) {
        if (isRefNode(node)) paths.push([...path]);
      },
    });
    expect(paths[0]).toEqual(["data", "expr", "body"]);
  });

  it("calls leave in post-order", () => {
    const order: string[] = [];
    walk(Add(1, 2) as TisynExpr, {
      leave(node) {
        if (typeof node === "number") order.push(String(node));
        if (isEvalNode(node)) order.push("add");
      },
    });
    expect(order).toEqual(["1", "2", "add"]);
  });
});

describe("fold", () => {
  const countingAlgebra = () => {
    const calls: string[] = [];
    const alg = {
      ...defaultAlgebra(() => 0),
      literal(v: TisynExpr) { calls.push("literal"); return 0; },
      ref(name: string) { calls.push(`ref:${name}`); return 0; },
      add(a: number, b: number) { calls.push("add"); return a + b; },
      quote(expr: TisynExpr) { calls.push("quote"); return 0; },
      eval(id: string, data: TisynExpr) { calls.push(`eval:${id}`); return 0; },
      let(name: string, value: number, body: number) { calls.push("let"); return body; },
      if(cond: number, then_: number, else_: number | null) { calls.push("if"); return then_; },
    };
    return { alg, calls };
  };

  it("fold literal returns algebra.literal result", () => {
    const { alg, calls } = countingAlgebra();
    fold(42, alg);
    expect(calls).toContain("literal");
  });

  it("fold Ref calls ref handler", () => {
    const { alg, calls } = countingAlgebra();
    fold(Ref("x") as TisynExpr, alg);
    expect(calls).toContain("ref:x");
  });

  it("fold does NOT recurse into Quote", () => {
    const { alg, calls } = countingAlgebra();
    fold(Q(Add(1, 2)) as TisynExpr, alg);
    expect(calls).toContain("quote");
    expect(calls).not.toContain("add");
  });

  it("fold does NOT recurse into external Eval data", () => {
    const { alg, calls } = countingAlgebra();
    fold(Eval("a.b", [Ref("x")]) as TisynExpr, alg);
    expect(calls).toContain("eval:a.b");
    expect(calls).not.toContain("ref:x");
  });

  it("fold DOES recurse into structural Eval", () => {
    const { alg, calls } = countingAlgebra();
    fold(Add(1, 2) as TisynExpr, alg);
    expect(calls).toContain("add");
    expect(calls.filter((c) => c === "literal")).toHaveLength(2);
  });

  it("fold Let receives folded value and body", () => {
    const { alg, calls } = countingAlgebra();
    fold(Let("x", 42, Ref("x")) as TisynExpr, alg);
    expect(calls).toContain("let");
    expect(calls).toContain("literal");
    expect(calls).toContain("ref:x");
  });

  it("fold If with no else", () => {
    const { alg, calls } = countingAlgebra();
    fold(If(true, 1) as TisynExpr, alg);
    expect(calls).toContain("if");
  });

  it("fold arithmetic: nested", () => {
    const evalAlg = {
      ...defaultAlgebra(() => 0),
      literal(v: TisynExpr) { return typeof v === "number" ? v : 0; },
      add(a: number, b: number) { return a + b; },
      sub(a: number, b: number) { return a - b; },
    };
    const result = fold(Add(Add(1, 2), 3) as TisynExpr, evalAlg);
    expect(result).toBe(6);
  });
});

describe("transform", () => {
  it("replaces Ref", () => {
    const result = transform(Ref("x") as TisynExpr, {
      ref: (n) => n.name === "x" ? 42 : undefined,
    });
    expect(result).toBe(42);
  });

  it("preserves unreplaced nodes", () => {
    const input = Add(1, 2) as TisynExpr;
    const result = transform(input, {
      ref: () => undefined,
    });
    expect(result).toEqual(input);
  });

  it("does not re-visit replacements", () => {
    let callCount = 0;
    const result = transform(Ref("x") as TisynExpr, {
      ref: () => {
        callCount++;
        return Ref("y") as TisynExpr;
      },
    });
    expect(callCount).toBe(1);
    expect(result).toEqual({ tisyn: "ref", name: "y" });
  });

  it("replaces structural by id", () => {
    const result = transform(Add(1, 2) as TisynExpr, {
      add: () => 99,
    });
    expect(result).toBe(99);
  });

  it("recurses into children", () => {
    const result = transform(Let("x", Ref("a"), Ref("b")) as TisynExpr, {
      ref: (n) => n.name === "a" ? 42 : undefined,
    });
    const data = (result as { data: { expr: { value: unknown; body: unknown } } }).data.expr;
    expect(data.value).toBe(42);
    expect(data.body).toEqual({ tisyn: "ref", name: "b" });
  });
});

describe("collectRefs", () => {
  it("finds all refs", () => {
    const refs = collectRefs(Add(Ref("a"), Ref("b")) as TisynExpr);
    expect(refs.sort()).toEqual(["a", "b"]);
  });

  it("enters Quote", () => {
    const refs = collectRefs(Q(Ref("x")) as TisynExpr);
    expect(refs).toEqual(["x"]);
  });

  it("enters external data", () => {
    const refs = collectRefs(Eval("a", [Ref("y")]) as TisynExpr);
    expect(refs).toEqual(["y"]);
  });
});

describe("collectExternalIds", () => {
  it("finds external eval IDs", () => {
    const ids = collectExternalIds(
      Let("x", Eval("a.b", []), Eval("c.d", [])) as TisynExpr,
    );
    expect(ids.sort()).toEqual(["a.b", "c.d"]);
  });

  it("skips structural IDs", () => {
    const ids = collectExternalIds(Add(1, 2) as TisynExpr);
    expect(ids).toEqual([]);
  });
});

describe("collectFreeRefs", () => {
  it("bound ref not free", () => {
    expect(collectFreeRefs(Let("x", 1, Ref("x")) as TisynExpr)).toEqual([]);
  });

  it("unbound ref is free", () => {
    expect(collectFreeRefs(Add(Ref("x"), 1) as TisynExpr)).toEqual(["x"]);
  });

  it("Fn param binds", () => {
    expect(collectFreeRefs(Fn(["x"], Ref("x")) as TisynExpr)).toEqual([]);
  });

  it("Fn free var", () => {
    expect(collectFreeRefs(Fn(["x"], Ref("y")) as TisynExpr)).toEqual(["y"]);
  });

  it("shadowing", () => {
    expect(
      collectFreeRefs(Let("x", 1, Let("x", 2, Ref("x"))) as TisynExpr),
    ).toEqual([]);
  });
});
