/**
 * Compiler tests.
 *
 * Tests against the three end-to-end examples from Compiler Spec §12,
 * plus unit tests for each compilation feature.
 */

import { describe, it, expect } from "vitest";
import { compileOne, CompileError, toAgentId } from "./index.js";

// ── Agent ID tests ──

describe("toAgentId", () => {
  it("converts PascalCase to kebab-case", () => {
    expect(toAgentId("OrderService")).toBe("order-service");
    expect(toAgentId("PlayerA")).toBe("player-a");
    expect(toAgentId("FraudDetector")).toBe("fraud-detector");
    expect(toAgentId("A")).toBe("a");
    expect(toAgentId("ConfigService")).toBe("config-service");
    expect(toAgentId("JobService")).toBe("job-service");
    expect(toAgentId("PaymentService")).toBe("payment-service");
  });
});

// ── Spec §12.1: Simple sequential workflow ──

describe("Spec §12.1: Simple sequential workflow", () => {
  const source = `
    function* processOrder(orderId: string): Workflow<Receipt> {
      const order = yield* OrderService().fetchOrder(orderId);
      const receipt = yield* PaymentService().chargeCard(order.payment);
      return receipt;
    }
  `;

  it("compiles to nested Let chain with two external Evals", () => {
    const ir = compileOne(source);

    // Should be a Fn node
    expect(ir).toHaveProperty("tisyn", "fn");
    const fn = ir as { tisyn: "fn"; params: string[]; body: unknown };
    expect(fn.params).toEqual(["orderId"]);

    // Body: Let("order", Eval("order-service.fetchOrder", [...]), Let("receipt", Eval("payment-service.chargeCard", [...]), Ref("receipt")))
    const body = fn.body as {
      tisyn: "eval";
      id: string;
      data: {
        tisyn: "quote";
        expr: { name: string; value: unknown; body: unknown };
      };
    };
    expect(body.tisyn).toBe("eval");
    expect(body.id).toBe("let");

    const outerLet = body.data.expr;
    expect(outerLet.name).toBe("order");

    // value should be external eval with unquoted data (array)
    const fetchOrder = outerLet.value as {
      tisyn: "eval";
      id: string;
      data: unknown;
    };
    expect(fetchOrder.tisyn).toBe("eval");
    expect(fetchOrder.id).toBe("order-service.fetchOrder");
    expect(Array.isArray(fetchOrder.data)).toBe(true);

    // inner body is another Let
    const innerLet = outerLet.body as {
      tisyn: "eval";
      id: string;
      data: {
        tisyn: "quote";
        expr: { name: string; value: unknown; body: unknown };
      };
    };
    expect(innerLet.id).toBe("let");
    const innerLetExpr = innerLet.data.expr;
    expect(innerLetExpr.name).toBe("receipt");

    // chargeCard effect
    const chargeCard = innerLetExpr.value as {
      tisyn: "eval";
      id: string;
      data: unknown;
    };
    expect(chargeCard.id).toBe("payment-service.chargeCard");

    // chargeCard data should include a Get node for order.payment
    const chargeArgs = chargeCard.data as unknown[];
    expect(Array.isArray(chargeArgs)).toBe(true);
    const getNode = chargeArgs[0] as { tisyn: "eval"; id: string };
    expect(getNode.tisyn).toBe("eval");
    expect(getNode.id).toBe("get");

    // return receipt → Ref("receipt")
    const returnExpr = innerLetExpr.body as { tisyn: "ref"; name: string };
    expect(returnExpr).toEqual({ tisyn: "ref", name: "receipt" });
  });
});

// ── Spec §12.2: Effect-driven loop with early return ──

describe("Spec §12.2: Effect-driven loop with early return", () => {
  const source = `
    function* pollJob(jobId: string): Workflow<Result> {
      const config = yield* ConfigService().getRetryConfig();

      while (true) {
        const status = yield* JobService().checkStatus(jobId);

        if (status.state === "complete") {
          return yield* JobService().getResult(jobId);
        }

        if (status.state === "failed") {
          throw new Error("Job failed");
        }

        yield* sleep(config.intervalMs);
      }
    }
  `;

  it("compiles while-with-return to recursive Fn + Call (Case B)", () => {
    const ir = compileOne(source);
    expect(ir).toHaveProperty("tisyn", "fn");

    const fn = ir as { tisyn: "fn"; params: string[]; body: unknown };
    expect(fn.params).toEqual(["jobId"]);

    // Body should be:
    // Let("config", Eval("config-service.getRetryConfig", []),
    //   Let("__loop_0", Fn([], ...), Call(Ref("__loop_0"), [])))
    const body = fn.body as any;
    expect(body.tisyn).toBe("eval");
    expect(body.id).toBe("let");
    expect(body.data.expr.name).toBe("config");

    // The config value should be an external eval
    const configVal = body.data.expr.value;
    expect(configVal.id).toBe("config-service.getRetryConfig");

    // After config, should have the loop
    const afterConfig = body.data.expr.body;
    expect(afterConfig.id).toBe("let");

    const loopLetExpr = afterConfig.data.expr;
    expect(loopLetExpr.name).toBe("__loop_0");

    // The loop value should be a Fn
    const loopFn = loopLetExpr.value;
    expect(loopFn.tisyn).toBe("fn");
    expect(loopFn.params).toEqual([]);

    // The body after the loop binding should be Call(Ref("__loop_0"), [])
    const loopCall = loopLetExpr.body;
    expect(loopCall.tisyn).toBe("eval");
    expect(loopCall.id).toBe("call");

    const callData = loopCall.data.expr;
    expect(callData.fn).toEqual({ tisyn: "ref", name: "__loop_0" });
    expect(callData.args).toEqual([]);
  });

  it("loop body contains status check, early returns, and recursive call", () => {
    const ir = compileOne(source) as any;

    // Navigate to the loop Fn body
    const loopFn = ir.body.data.expr.body.data.expr.value;
    expect(loopFn.tisyn).toBe("fn");

    // The loop body should start with:
    // Let("status", Eval("job-service.checkStatus", [Ref("jobId")]),
    //   If(Eq(Get(Ref("status"), "state"), "complete"),
    //     Eval("job-service.getResult", [Ref("jobId")]),
    //     If(Eq(Get(Ref("status"), "state"), "failed"),
    //       Throw("Job failed"),
    //       Let("__discard_0", Eval("sleep", [Get(Ref("config"), "intervalMs")]),
    //         Call(Ref("__loop_0"), [])))))
    const loopBody = loopFn.body;
    expect(loopBody.id).toBe("let");
    expect(loopBody.data.expr.name).toBe("status");

    // Check the status effect
    const statusEffect = loopBody.data.expr.value;
    expect(statusEffect.id).toBe("job-service.checkStatus");

    // The body after status binding should have the if chain
    const ifChain = loopBody.data.expr.body;
    expect(ifChain.id).toBe("if");
  });
});

// ── Spec §12.3: Concurrency with all ──

describe("Spec §12.3: Concurrency with all", () => {
  const source = `
    function* parallelProcess(id1: string, id2: string): Workflow<string> {
      const orderA = yield* OrderService().fetchOrder(id1);
      const orderB = yield* OrderService().fetchOrder(id2);

      const results = yield* all([
        () => Processor().process(orderA),
        () => Processor().process(orderB),
      ]);

      return yield* Aggregator().combine(results);
    }
  `;

  it("compiles all() with quoted data and unwrapped arrow bodies", () => {
    const ir = compileOne(source);
    expect(ir).toHaveProperty("tisyn", "fn");

    const fn = ir as { tisyn: "fn"; params: string[]; body: unknown };
    expect(fn.params).toEqual(["id1", "id2"]);

    // Navigate: Let(orderA) → Let(orderB) → Let(results) → return
    const body = fn.body as any;
    expect(body.data.expr.name).toBe("orderA");

    const letOrderB = body.data.expr.body;
    expect(letOrderB.data.expr.name).toBe("orderB");

    const letResults = letOrderB.data.expr.body;
    expect(letResults.data.expr.name).toBe("results");

    // The all() effect
    const allEval = letResults.data.expr.value;
    expect(allEval.tisyn).toBe("eval");
    expect(allEval.id).toBe("all");

    // Data should be quoted
    expect(allEval.data.tisyn).toBe("quote");

    // The quoted expr should have exprs array
    const quotedExpr = allEval.data.expr;
    expect(quotedExpr.exprs).toHaveLength(2);

    // Each child should be an external eval (arrow bodies unwrapped)
    expect(quotedExpr.exprs[0].tisyn).toBe("eval");
    expect(quotedExpr.exprs[0].id).toBe("processor.process");
    expect(quotedExpr.exprs[1].tisyn).toBe("eval");
    expect(quotedExpr.exprs[1].id).toBe("processor.process");

    // The return should be Eval("aggregator.combine", [Ref("results")])
    const returnExpr = letResults.data.expr.body;
    expect(returnExpr.id).toBe("aggregator.combine");
  });
});

// ── Expression compilation ──

describe("Expression compilation", () => {
  it("compiles numeric literals", () => {
    const ir = compileOne(`function* f(): Workflow<number> { return 42; }`);
    const fn = ir as { body: unknown };
    expect(fn.body).toBe(42);
  });

  it("compiles string literals", () => {
    const ir = compileOne(`function* f(): Workflow<string> { return "hello"; }`);
    const fn = ir as { body: unknown };
    expect(fn.body).toBe("hello");
  });

  it("compiles boolean literals", () => {
    const ir = compileOne(`function* f(): Workflow<boolean> { return true; }`);
    const fn = ir as { body: unknown };
    expect(fn.body).toBe(true);
  });

  it("compiles null", () => {
    const ir = compileOne(`function* f(): Workflow<null> { return null; }`);
    const fn = ir as { body: unknown };
    expect(fn.body).toBe(null);
  });

  it("compiles property access to Get", () => {
    const ir = compileOne(`function* f(obj: any): Workflow<any> { return obj.prop; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("get");
    expect(fn.body.data.expr.obj).toEqual({ tisyn: "ref", name: "obj" });
    expect(fn.body.data.expr.key).toBe("prop");
  });

  it("compiles chained property access", () => {
    const ir = compileOne(`function* f(obj: any): Workflow<any> { return obj.a.b; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("get");
    expect(fn.body.data.expr.key).toBe("b");
    // obj.a is also a Get
    const inner = fn.body.data.expr.obj;
    expect(inner.id).toBe("get");
    expect(inner.data.expr.key).toBe("a");
  });

  it("compiles object literals to Construct", () => {
    const ir = compileOne(`function* f(x: number): Workflow<any> { return { a: 1, b: x }; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("construct");
    const fields = fn.body.data.expr;
    expect(fields.a).toBe(1);
    expect(fields.b).toEqual({ tisyn: "ref", name: "x" });
  });

  it("compiles array literals to Array", () => {
    const ir = compileOne(`function* f(x: number): Workflow<any> { return [1, x, 3]; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("array");
    const items = fn.body.data.expr.items;
    expect(items).toEqual([1, { tisyn: "ref", name: "x" }, 3]);
  });

  it("compiles template literals to Concat", () => {
    const ir = compileOne(
      "function* f(name: string): Workflow<string> { return `hello ${name}!`; }",
    );
    const fn = ir as any;
    expect(fn.body.id).toBe("concat");
    expect(fn.body.data.expr.parts).toEqual(["hello ", { tisyn: "ref", name: "name" }, "!"]);
  });

  it("compiles arithmetic operators", () => {
    const ir = compileOne(`function* f(a: number, b: number): Workflow<number> { return a + b; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("add");
  });

  it("compiles comparison operators", () => {
    const ir = compileOne(`function* f(a: number, b: number): Workflow<boolean> { return a > b; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("gt");
  });

  it("compiles equality operators", () => {
    const ir = compileOne(`function* f(a: any, b: any): Workflow<boolean> { return a === b; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("eq");
  });

  it("compiles logical operators", () => {
    const ir = compileOne(`function* f(a: any, b: any): Workflow<any> { return a && b; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("and");
  });

  it("compiles negation", () => {
    const ir = compileOne(`function* f(a: boolean): Workflow<boolean> { return !a; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("not");
  });

  it("compiles unary minus", () => {
    const ir = compileOne(`function* f(a: number): Workflow<number> { return -a; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("neg");
  });

  it("compiles arrow functions to Fn", () => {
    const ir = compileOne(`function* f(): Workflow<any> { return (x: number) => x + 1; }`) as any;
    // The return should be a Fn node
    // But wait — x + 1 is compiled to add, and x is a Ref. The arrow becomes Fn(["x"], Add(Ref("x"), 1))
    // However, validate() will check this. Let's just ensure it has the right shape.
    expect(ir.body.tisyn).toBe("fn");
    expect(ir.body.params).toEqual(["x"]);
    expect(ir.body.body.id).toBe("add");
  });

  it("compiles shorthand property in object literal", () => {
    const ir = compileOne(`function* f(x: number): Workflow<any> { return { x }; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("construct");
    expect(fn.body.data.expr.x).toEqual({ tisyn: "ref", name: "x" });
  });

  it("compiles ternary to If", () => {
    const ir = compileOne(`function* f(a: boolean): Workflow<number> { return a ? 1 : 2; }`);
    const fn = ir as any;
    expect(fn.body.id).toBe("if");
  });
});

// ── Control flow ──

describe("Control flow", () => {
  it("compiles simple if/else", () => {
    const ir = compileOne(`
      function* f(x: number): Workflow<string> {
        if (x > 0) {
          return "positive";
        } else {
          return "non-positive";
        }
      }
    `);
    const fn = ir as any;
    expect(fn.body.id).toBe("if");
  });

  it("compiles while (no return) to While", () => {
    const ir = compileOne(`
      function* f(): Workflow<null> {
        while (true) {
          yield* Agent().tick();
        }
      }
    `) as any;
    // Should have a while node (possibly wrapped in let for the loop var)
    // Actually, while(true) with no return is Case A → While IR node
    // The body is: Let("__discard_0", Eval("agent.tick", []), ...rest)
    // But since the while is the only statement and has no return, it's just While
    expect(fn_contains_while(ir.body)).toBe(true);
  });

  it("Case A while preserves per-iteration bindings", () => {
    const ir = compileOne(`
      function* f(): Workflow<null> {
        while (true) {
          const x = yield* Agent().getValue();
          yield* Agent().useValue(x);
        }
      }
    `) as any;
    const whileNode = findWhileNode(ir.body);
    expect(whileNode).toBeDefined();
    const exprs = whileNode!.data.expr.exprs;
    expect(exprs).toHaveLength(1);
    // The single body expression should be a Let binding preserving "x"
    expect(exprs[0].tisyn).toBe("eval");
    expect(exprs[0].id).toBe("let");
    expect(exprs[0].data.expr.name).toBe("x");
  });

  it("compiles early return transform", () => {
    const ir = compileOne(`
      function* f(x: number): Workflow<string> {
        if (x < 0) {
          return "negative";
        }
        const result = yield* Agent().process(x);
        return result;
      }
    `);
    const fn = ir as any;
    // The if-with-return should absorb the remaining statements into else
    expect(fn.body.id).toBe("if");

    // Then branch: "negative"
    const thenBranch = fn.body.data.expr.then;
    expect(thenBranch).toBe("negative");

    // Else branch: Let("result", Eval("agent.process", [Ref("x")]), Ref("result"))
    const elseBranch = fn.body.data.expr.else;
    expect(elseBranch.id).toBe("let");
  });

  it("compiles throw", () => {
    const ir = compileOne(`
      function* f(): Workflow<never> {
        throw new Error("something went wrong");
      }
    `);
    const fn = ir as any;
    expect(fn.body.id).toBe("throw");
    expect(fn.body.data.expr.message).toBe("something went wrong");
  });
});

// ── Effects ──

describe("Effects", () => {
  it("compiles agent effect with correct ID and unquoted data", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        const result = yield* OrderService().fetchOrder("123");
        return result;
      }
    `) as any;
    const letExpr = ir.body.data.expr;
    expect(letExpr.name).toBe("result");
    const effect = letExpr.value;
    expect(effect.tisyn).toBe("eval");
    expect(effect.id).toBe("order-service.fetchOrder");
    // Data should be unquoted array
    expect(Array.isArray(effect.data)).toBe(true);
    expect(effect.data[0]).toBe("123");
  });

  it("compiles sleep as built-in effect", () => {
    const ir = compileOne(`
      function* f(): Workflow<null> {
        yield* sleep(5000);
      }
    `) as any;
    // bare yield* as last statement → returns effect directly
    expect(ir.body.tisyn).toBe("eval");
    expect(ir.body.id).toBe("sleep");
    expect(ir.body.data).toEqual([5000]);
  });

  it("compiles discarded effects with __discard names", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        yield* Agent().step1();
        yield* Agent().step2();
        return yield* Agent().step3();
      }
    `) as any;
    // Let("__discard_0", Eval("agent.step1", []),
    //   Let("__discard_1", Eval("agent.step2", []),
    //     Eval("agent.step3", [])))
    expect(ir.body.id).toBe("let");
    expect(ir.body.data.expr.name).toBe("__discard_0");
    const inner = ir.body.data.expr.body;
    expect(inner.id).toBe("let");
    expect(inner.data.expr.name).toBe("__discard_1");
    const final = inner.data.expr.body;
    expect(final.id).toBe("agent.step3");
  });
});

// ── SSA let + reassignment ──

describe("SSA: let declarations and reassignment", () => {
  it("compiles let in straight-line code with correct versioning", () => {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        let x = 1;
        return x;
      }
    `);
    // Body should be Let("x_0", 1, Ref("x_0"))
    expect(ir).toHaveProperty("tisyn", "fn");
    const fn = ir as any;
    const body = fn.body;
    expect(body.id).toBe("let");
    expect(body.data.expr.name).toBe("x_0");
    expect(body.data.expr.value).toBe(1);
    const ret = body.data.expr.body;
    expect(ret).toHaveProperty("tisyn", "ref");
    expect(ret.name).toBe("x_0");
  });

  it("compiles let reassignment with version bump", () => {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        let x = 1;
        x = 2;
        return x;
      }
    `) as any;
    const fn = ir;
    // body: Let(x_0, 1, Let(x_1, 2, Ref(x_1)))
    const outer = fn.body;
    expect(outer.id).toBe("let");
    expect(outer.data.expr.name).toBe("x_0");
    const mid = outer.data.expr.body;
    expect(mid.id).toBe("let");
    expect(mid.data.expr.name).toBe("x_1");
    const ret = mid.data.expr.body;
    expect(ret.name).toBe("x_1");
  });

  it("rejects reassignment to const (E003)", () => {
    expect(() =>
      compileOne(`function* f(): Workflow<any> { const x = 1; x = 2; return x; }`),
    ).toThrow(CompileError);
  });

  it("rejects reassignment to undeclared name (E003)", () => {
    expect(() =>
      compileOne(`function* f(): Workflow<any> { x = 2; return x; }`),
    ).toThrow(CompileError);
  });

  it("rejects reassignment to function param (E003)", () => {
    expect(() =>
      compileOne(`function* f(x: number): Workflow<any> { x = 2; return x; }`),
    ).toThrow(CompileError);
  });
});

// ── SSA if-branch join ──

describe("SSA: if-branch join lowering", () => {
  it("compiles if with single reassigned var as join", () => {
    const ir = compileOne(`
      function* f(cond: boolean): Workflow<number> {
        let x = 0;
        if (cond) {
          x = 1;
        }
        return x;
      }
    `) as any;
    // Should produce: Let(x_0, 0, Let(x_1, If(cond, ..., ...), Ref(x_1)))
    expect(ir.tisyn).toBe("fn");
    const body = ir.body;
    expect(body.id).toBe("let"); // x_0
    expect(body.data.expr.name).toBe("x_0");
    const joinLet = body.data.expr.body;
    expect(joinLet.id).toBe("let"); // x_1
    expect(joinLet.data.expr.name).toBe("x_1");
    expect(joinLet.data.expr.value.id).toBe("if"); // If node
    const ret = joinLet.data.expr.body;
    expect(ret.name).toBe("x_1");
  });

  it("compiles if-else with two reassigned vars using Construct + Get", () => {
    const ir = compileOne(`
      function* f(cond: boolean): Workflow<number> {
        let x = 0;
        let y = 0;
        if (cond) {
          x = 1;
          y = 2;
        } else {
          x = 3;
          y = 4;
        }
        return x;
      }
    `) as any;
    // Should produce __j = If(cond, Construct({x,y}), Construct({x,y}))
    // followed by x_1 = Get(__j, "x"), y_1 = Get(__j, "y")
    expect(ir.tisyn).toBe("fn");
    // Find the __j let node
    function findLetById(node: any, namePrefix: string): any {
      if (!node || typeof node !== "object") return null;
      if (node.id === "let" && node.data?.expr?.name?.startsWith(namePrefix)) return node;
      for (const v of Object.values(node)) {
        const found = findLetById(v, namePrefix);
        if (found) return found;
      }
      return null;
    }
    const jLet = findLetById(ir.body, "__j");
    expect(jLet).toBeTruthy();
    expect(jLet.data.expr.value.id).toBe("if");
  });
});

// ── Spread lowering ──

describe("Spread lowering", () => {
  it("array spread produces concat-arrays IR", () => {
    const ir = compileOne(`
      function* f(arr: number[]): Workflow<number[]> {
        return [...arr, 1];
      }
    `) as any;
    const body = ir.body;
    expect(body.id).toBe("concat-arrays");
  });

  it("object spread produces merge-objects IR", () => {
    const ir = compileOne(`
      function* f(obj: Record<string, number>): Workflow<Record<string, number>> {
        return { ...obj, x: 1 };
      }
    `) as any;
    const body = ir.body;
    expect(body.id).toBe("merge-objects");
  });

  it("rejects spread in function call args (E032)", () => {
    expect(() =>
      compileOne(`function* f(arr: number[]): Workflow<any> { return someFunc(...arr); }`),
    ).toThrow(CompileError);
  });

  it("plain array without spread produces array IR", () => {
    const ir = compileOne(`
      function* f(): Workflow<number[]> { return [1, 2, 3]; }
    `) as any;
    const body = ir.body;
    expect(body.id).toBe("array");
  });
});

// ── Mutation detection ──

describe("Mutation detection", () => {
  it("rejects array .push call (E031)", () => {
    expect(() =>
      compileOne(`function* f(arr: number[]): Workflow<any> { arr.push(1); return arr; }`),
    ).toThrow(CompileError);
  });

  it("rejects property mutation (E004)", () => {
    expect(() =>
      compileOne(`function* f(obj: any): Workflow<any> { obj.x = 1; return obj; }`),
    ).toThrow(CompileError);
  });
});

// ── Error detection ──

describe("Error detection", () => {
  it("accepts let declarations (E001 removed)", () => {
    // 'let' is now supported; this should compile without error
    const result = compileOne(`function* f(): Workflow<any> { let x = 1; return x; }`);
    expect(result).toBeDefined();
  });

  it("rejects reassignment (E003)", () => {
    expect(() =>
      compileOne(`function* f(): Workflow<any> { const x = 1; x = 2; return x; }`),
    ).toThrow(CompileError);
  });

  it("rejects computed property access (E005)", () => {
    expect(() =>
      compileOne(`function* f(obj: any, key: string): Workflow<any> { return obj[key]; }`),
    ).toThrow(CompileError);
  });

  it("rejects yield without * (E017)", () => {
    expect(() => compileOne(`function* f(): Workflow<any> { yield 1; }`)).toThrow(CompileError);
  });

  it("rejects arrow block bodies (E024)", () => {
    expect(() =>
      compileOne(`function* f(): Workflow<any> { return (x: number) => { return x; }; }`),
    ).toThrow(CompileError);
  });

  it("rejects __ prefixed variables (E028)", () => {
    expect(() => compileOne(`function* f(): Workflow<any> { const __x = 1; return __x; }`)).toThrow(
      CompileError,
    );
  });

  it("rejects non-Error throw (E023)", () => {
    expect(() => compileOne(`function* f(): Workflow<any> { throw "oops"; }`)).toThrow(
      CompileError,
    );
  });
});

// ── Validation ──

describe("Validation", () => {
  it("validates output IR by default", () => {
    // This should pass validation
    const ir = compileOne(`
      function* f(): Workflow<number> { return 42; }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });

  it("can disable validation", () => {
    const ir = compileOne(`function* f(): Workflow<number> { return 42; }`, {
      validate: false,
    });
    expect(ir).toHaveProperty("tisyn", "fn");
  });
});

// ── Helpers ──

function findWhileNode(node: unknown): Record<string, any> | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "eval" && obj["id"] === "while") return obj as Record<string, any>;
  for (const value of Object.values(obj)) {
    const found = findWhileNode(value);
    if (found) return found;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findWhileNode(item);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function fn_contains_while(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "eval" && obj["id"] === "while") return true;
  for (const value of Object.values(obj)) {
    if (fn_contains_while(value)) return true;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (fn_contains_while(item)) return true;
      }
    }
  }
  return false;
}
