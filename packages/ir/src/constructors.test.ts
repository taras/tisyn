import { describe, it, expect } from "vitest";
import {
  Ref,
  Q,
  Fn,
  Let,
  Seq,
  If,
  While,
  Call,
  Get,
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Neg,
  Gt,
  Gte,
  Lt,
  Lte,
  Eq,
  Neq,
  And,
  Or,
  Not,
  Construct,
  Arr,
  Concat,
  Throw,
  Eval,
  All,
  Race,
} from "./constructors.js";

describe("structural constructors", () => {
  it("Let produces correct shape", () => {
    const node = Let("x", 1, Ref("x"));
    expect(node).toEqual({
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: { name: "x", value: 1, body: { tisyn: "ref", name: "x" } },
      },
    });
  });

  it("If produces correct shape", () => {
    const node = If(true, 1, 2);
    expect(node).toEqual({
      tisyn: "eval",
      id: "if",
      data: {
        tisyn: "quote",
        expr: { condition: true, then: 1, else: 2 },
      },
    });
  });

  it("If omits else when undefined", () => {
    const node = If(true, 1);
    const data = node.data as { tisyn: string; expr: Record<string, unknown> };
    expect(data.expr).not.toHaveProperty("else");
  });

  it("Seq produces correct shape", () => {
    const node = Seq(1, 2, 3);
    expect(node).toEqual({
      tisyn: "eval",
      id: "seq",
      data: { tisyn: "quote", expr: { exprs: [1, 2, 3] } },
    });
  });

  it("Add produces correct shape", () => {
    const node = Add(1, 2);
    expect(node).toEqual({
      tisyn: "eval",
      id: "add",
      data: { tisyn: "quote", expr: { a: 1, b: 2 } },
    });
  });

  it("Not produces correct shape", () => {
    const node = Not(true);
    expect(node).toEqual({
      tisyn: "eval",
      id: "not",
      data: { tisyn: "quote", expr: { a: true } },
    });
  });

  it("Get produces correct shape", () => {
    const node = Get(Ref("o"), "k");
    expect(node).toEqual({
      tisyn: "eval",
      id: "get",
      data: {
        tisyn: "quote",
        expr: { obj: { tisyn: "ref", name: "o" }, key: "k" },
      },
    });
  });

  it("Construct produces correct shape", () => {
    const node = Construct({ a: 1, b: 2 });
    expect(node).toEqual({
      tisyn: "eval",
      id: "construct",
      data: { tisyn: "quote", expr: { a: 1, b: 2 } },
    });
  });

  it("Arr produces correct shape", () => {
    const node = Arr(1, 2, 3);
    expect(node).toEqual({
      tisyn: "eval",
      id: "array",
      data: { tisyn: "quote", expr: { items: [1, 2, 3] } },
    });
  });

  it("Concat produces correct shape", () => {
    const node = Concat("a", "b");
    expect(node).toEqual({
      tisyn: "eval",
      id: "concat",
      data: { tisyn: "quote", expr: { parts: ["a", "b"] } },
    });
  });

  it("Throw produces correct shape", () => {
    const node = Throw("msg");
    expect(node).toEqual({
      tisyn: "eval",
      id: "throw",
      data: { tisyn: "quote", expr: { message: "msg" } },
    });
  });

  it("Call produces correct shape", () => {
    const node = Call(Ref<() => number>("f"));
    expect(node).toEqual({
      tisyn: "eval",
      id: "call",
      data: {
        tisyn: "quote",
        expr: { fn: { tisyn: "ref", name: "f" }, args: [] },
      },
    });
  });

  it("While produces correct shape", () => {
    const node = While(true, [Ref("x")]);
    expect(node).toEqual({
      tisyn: "eval",
      id: "while",
      data: {
        tisyn: "quote",
        expr: { condition: true, exprs: [{ tisyn: "ref", name: "x" }] },
      },
    });
  });
});

describe("external constructors", () => {
  it("Eval produces unquoted data", () => {
    const node = Eval("a.b", [1, Ref("x")]);
    expect(node.tisyn).toBe("eval");
    expect(node.id).toBe("a.b");
    expect(Array.isArray(node.data)).toBe(true);
    expect(node.data).toEqual([1, { tisyn: "ref", name: "x" }]);
  });

  it("All wraps in Quote with exprs", () => {
    const node = All(Eval("a.b", []), Eval("c.d", []));
    expect(node.tisyn).toBe("eval");
    expect(node.id).toBe("all");
    const data = node.data as { tisyn: string; expr: { exprs: unknown[] } };
    expect(data.tisyn).toBe("quote");
    expect(data.expr.exprs).toHaveLength(2);
  });

  it("Race wraps in Quote with exprs", () => {
    const node = Race(Eval("a.b", []));
    expect(node.tisyn).toBe("eval");
    expect(node.id).toBe("race");
    const data = node.data as { tisyn: string; expr: { exprs: unknown[] } };
    expect(data.tisyn).toBe("quote");
    expect(data.expr.exprs).toHaveLength(1);
  });
});

describe("primitive constructors", () => {
  it("Ref produces correct shape", () => {
    expect(Ref("x")).toEqual({ tisyn: "ref", name: "x" });
  });

  it("Fn produces correct shape", () => {
    expect(Fn(["a"], 1)).toEqual({ tisyn: "fn", params: ["a"], body: 1 });
  });

  it("Q produces correct shape", () => {
    expect(Q(Ref("x"))).toEqual({
      tisyn: "quote",
      expr: { tisyn: "ref", name: "x" },
    });
  });
});

describe("JSON round-trip safety", () => {
  it("phantom fields absent in JSON", () => {
    const ref = Ref("x");
    const json = JSON.stringify(ref);
    expect(json).not.toContain('"T"');
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ tisyn: "ref", name: "x" });
  });

  it("Eval phantom absent", () => {
    const node = Eval("a.b", []);
    const json = JSON.stringify(node);
    expect(json).not.toContain('"T"');
  });

  it("round-trip preserves structure", () => {
    const node = Let("x", Add(1, 2), If(Gt(Ref("x"), 0), Ref("x"), Neg(Ref("x"))));
    const roundTripped = JSON.parse(JSON.stringify(node));
    expect(roundTripped).toEqual(node);
  });

  it("nested tree round-trips", () => {
    const node = Let(
      "config",
      Eval("config-service.getRetryConfig", []),
      Let(
        "status",
        Eval("job-service.checkStatus", [Ref("jobId")]),
        If(
          Eq(Get(Ref("status"), "state"), "complete"),
          Eval("job-service.getResult", [Ref("jobId")]),
          Throw("Job failed"),
        ),
      ),
    );
    const roundTripped = JSON.parse(JSON.stringify(node));
    expect(roundTripped).toEqual(node);
  });

  it("Quote data survives round-trip", () => {
    const node = Let("x", 1, Ref("x"));
    const roundTripped = JSON.parse(JSON.stringify(node));
    expect(roundTripped.data.tisyn).toBe("quote");
  });
});
