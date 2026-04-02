/**
 * Stream iteration compiler tests.
 *
 * Tests for `for (const x of yield* each(expr)) { ... }` support.
 * Covers rejection (Phase 1) and acceptance/lowering (Phase 2).
 */

import { describe, it, expect } from "vitest";
import { compileOne, CompileError } from "./index.js";

// ── Helpers ──

function expectCompileError(source: string, expectedCode: string) {
  try {
    compileOne(source);
    throw new Error(`Expected CompileError ${expectedCode} but compilation succeeded`);
  } catch (e) {
    expect(e).toBeInstanceOf(CompileError);
    expect((e as CompileError).code).toBe(expectedCode);
  }
}

/** Walk an IR tree, collecting all Eval ids encountered. */
function collectEvalIds(ir: unknown): string[] {
  const ids: string[] = [];
  walkIR(ir, (node: any) => {
    if (node && typeof node === "object" && node.tisyn === "eval" && typeof node.id === "string") {
      ids.push(node.id);
    }
  });
  return ids;
}

function walkIR(node: unknown, visitor: (n: unknown) => void): void {
  if (node === null || node === undefined || typeof node !== "object") return;
  visitor(node);
  if (Array.isArray(node)) {
    for (const item of node) walkIR(item, visitor);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    walkIR(obj[key], visitor);
  }
}

/** Find a node in the IR tree matching a predicate. */
function findIR(ir: unknown, pred: (n: any) => boolean): unknown | undefined {
  if (ir === null || ir === undefined || typeof ir !== "object") return undefined;
  if (pred(ir)) return ir;
  if (Array.isArray(ir)) {
    for (const item of ir) {
      const found = findIR(item, pred);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const obj = ir as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const found = findIR(obj[key], pred);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Count occurrences of eval nodes with a given id. */
function countEval(ir: unknown, id: string): number {
  let count = 0;
  walkIR(ir, (node: any) => {
    if (node && typeof node === "object" && node.tisyn === "eval" && node.id === id) {
      count++;
    }
  });
  return count;
}

// ── Rejection tests (Phase 1) ──

describe("stream iteration rejection", () => {
  it("SI-C-020: rejects let binding (E-STREAM-001)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (let x of yield* each(source)) {}
      }`,
      "E-STREAM-001",
    );
  });

  it("SI-C-021: rejects object destructuring (E-STREAM-002)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const { a } of yield* each(source)) {}
      }`,
      "E-STREAM-002",
    );
  });

  it("SI-C-022: rejects array destructuring (E-STREAM-002)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const [a] of yield* each(source)) {}
      }`,
      "E-STREAM-002",
    );
  });

  it("SI-C-030: rejects missing yield* (E-STREAM-003)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const x of each(source)) {}
      }`,
      "E-STREAM-003",
    );
  });

  it("SI-C-031: rejects yield* each(source) as bare statement (E-STREAM-004)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        yield* each(source);
      }`,
      "E-STREAM-004",
    );
  });

  it("SI-C-031b: rejects yield* each(source) in variable init (E-STREAM-004)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        const s = yield* each(source);
      }`,
      "E-STREAM-004",
    );
  });

  it("SI-C-031c: rejects const s = each(source) expression-form (E-STREAM-004)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        const s = each(source);
      }`,
      "E-STREAM-004",
    );
  });

  it("SI-C-031d: rejects return each(source) expression-form (E-STREAM-004)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        return each(source);
      }`,
      "E-STREAM-004",
    );
  });

  it("SI-C-040: rejects each.next() inside loop body (E-STREAM-005)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const x of yield* each(source)) {
          each.next();
        }
      }`,
      "E-STREAM-005",
    );
  });

  it("SI-C-041: rejects each.next() standalone (E-STREAM-005)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        each.next();
      }`,
      "E-STREAM-005",
    );
  });

  it("SI-C-050: rejects general for...of with non-each iterable (E013)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const x of yield* items()) {}
      }`,
      "E013",
    );
  });

  it("SI-C-051: rejects for...of with array literal (E013)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const x of [1, 2, 3]) {}
      }`,
      "E013",
    );
  });

  it("SI-C-060: rejects break (E020)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const x of yield* each(source)) {
          break;
        }
      }`,
      "E020",
    );
  });

  it("SI-C-061: rejects continue (E020)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const x of yield* each(source)) {
          continue;
        }
      }`,
      "E020",
    );
  });

  it("SI-C-070: rejects nested for...of each (E-STREAM-006)", () => {
    expectCompileError(
      `function* f(): Workflow<void> {
        for (const x of yield* each(source)) {
          for (const y of yield* each(source)) {}
        }
      }`,
      "E-STREAM-006",
    );
  });
});

// ── Acceptance tests (Phase 2) ──

describe("stream iteration acceptance", () => {
  it("SI-C-001: minimal valid loop compiles", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {
          yield* OrderService().process(x);
        }
      }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });

  it("SI-C-002: empty loop body compiles", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {}
      }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });

  it("SI-C-003: loop followed by continuation", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<number> {
        for (const x of yield* each(source)) {
          yield* OrderService().process(x);
        }
        return 42;
      }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });

  it("SI-C-004: loop body with return (outcome packing)", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<any> {
        for (const x of yield* each(source)) {
          if (x === "stop") {
            return x;
          }
        }
        return null;
      }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });

  it("SI-C-005: source expression is property access", () => {
    const ir = compileOne(`
      function* f(config: any): Workflow<void> {
        for (const x of yield* each(config.events)) {
          yield* OrderService().process(x);
        }
      }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });

  it("SI-C-006: body with if/else containing effects", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {
          if (x === "a") {
            yield* OrderService().handleA(x);
          } else {
            yield* OrderService().handleB(x);
          }
        }
      }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });

  it("SI-C-009: loop-carried state preserved post-loop", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<number> {
        let n = 0;
        for (const x of yield* each(source)) {
          n = n + 1;
        }
        return n;
      }
    `);
    expect(ir).toHaveProperty("tisyn", "fn");
  });
});

// ── Lowering invariant tests (Phase 2) ──

describe("stream iteration lowering invariants", () => {
  it("SI-L-001: exactly one stream.subscribe per loop", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {
          yield* OrderService().process(x);
        }
      }
    `);
    expect(countEval(ir, "stream.subscribe")).toBe(1);
  });

  it("SI-L-002: exactly one stream.next inside the loop", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {
          yield* OrderService().process(x);
        }
      }
    `);
    expect(countEval(ir, "stream.next")).toBe(1);
  });

  it("SI-L-003: recursive Call(Ref(__loop_N)) in else branch", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {
          yield* OrderService().process(x);
        }
      }
    `);
    // Find a call node where fn is Ref("__loop_0")
    const recursiveCall = findIR(ir, (n: any) =>
      n?.tisyn === "eval" &&
      n?.id === "call" &&
      n?.data?.expr?.fn?.tisyn === "ref" &&
      n?.data?.expr?.fn?.name?.startsWith("__loop_"),
    );
    expect(recursiveCall).toBeDefined();
  });

  it("SI-L-004: synthetic names __sub_N, __loop_N, __item_N are bound", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {
          yield* OrderService().process(x);
        }
      }
    `);
    // Check for Let nodes with synthetic names
    const letNames: string[] = [];
    walkIR(ir, (node: any) => {
      if (
        node?.tisyn === "eval" &&
        node?.id === "let" &&
        typeof node?.data?.expr?.name === "string"
      ) {
        letNames.push(node.data.expr.name);
      }
    });
    expect(letNames.some((n) => n.startsWith("__sub_"))).toBe(true);
    expect(letNames.some((n) => n.startsWith("__loop_"))).toBe(true);
    expect(letNames.some((n) => n.startsWith("__item_"))).toBe(true);
  });

  it("SI-L-005: stream.subscribe data contains compiled source", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {}
      }
    `);
    const sub = findIR(ir, (n: any) => n?.tisyn === "eval" && n?.id === "stream.subscribe") as any;
    expect(sub).toBeDefined();
    // data should be an array containing a Ref to source
    const data = sub.data;
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toEqual({ tisyn: "ref", name: "source" });
  });

  it("SI-L-006: stream.next data contains Ref(__sub_N)", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {}
      }
    `);
    const next = findIR(ir, (n: any) => n?.tisyn === "eval" && n?.id === "stream.next") as any;
    expect(next).toBeDefined();
    const data = next.data;
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]?.tisyn).toBe("ref");
    expect(data[0]?.name).toMatch(/^__sub_/);
  });

  it("SI-L-007: authored variable bound via Let with Get(item, 'value')", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const myItem of yield* each(source)) {
          yield* OrderService().process(myItem);
        }
      }
    `);
    // Find Let where name is "myItem" and value is Get(__item_N, "value")
    const binding = findIR(ir, (n: any) =>
      n?.tisyn === "eval" &&
      n?.id === "let" &&
      n?.data?.expr?.name === "myItem" &&
      n?.data?.expr?.value?.tisyn === "eval" &&
      n?.data?.expr?.value?.id === "get" &&
      n?.data?.expr?.value?.data?.expr?.key === "value",
    );
    expect(binding).toBeDefined();
  });

  it("SI-L-008: loop as last statement — call site is direct Call", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<void> {
        for (const x of yield* each(source)) {}
      }
    `);
    // The __loop_ Let's body should be a Call (not wrapped in another Let)
    const loopLet = findIR(ir, (n: any) =>
      n?.tisyn === "eval" &&
      n?.id === "let" &&
      typeof n?.data?.expr?.name === "string" &&
      n?.data?.expr?.name.startsWith("__loop_"),
    ) as any;
    expect(loopLet).toBeDefined();
    const body = loopLet.data.expr.body;
    expect(body.tisyn).toBe("eval");
    expect(body.id).toBe("call");
  });

  it("SI-L-009: loop with continuation — call site wrapped in Let", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<number> {
        for (const x of yield* each(source)) {}
        return 42;
      }
    `);
    // The __loop_ Let's body should be a Let(__discard, Call, continuation)
    const loopLet = findIR(ir, (n: any) =>
      n?.tisyn === "eval" &&
      n?.id === "let" &&
      typeof n?.data?.expr?.name === "string" &&
      n?.data?.expr?.name.startsWith("__loop_"),
    ) as any;
    expect(loopLet).toBeDefined();
    const body = loopLet.data.expr.body;
    expect(body.tisyn).toBe("eval");
    expect(body.id).toBe("let");
    // The value should be a Call
    expect(body.data.expr.value.tisyn).toBe("eval");
    expect(body.data.expr.value.id).toBe("call");
  });

  it("SI-L-011: loop-carried state — Fn has params, Call passes updated versions", () => {
    const ir = compileOne(`
      function* f(source: any): Workflow<number> {
        let n = 0;
        for (const x of yield* each(source)) {
          n = n + 1;
        }
        return n;
      }
    `);
    // Find the Fn node for the loop — it should have params for carried state
    const loopFn = findIR(ir, (n: any) =>
      n?.tisyn === "fn" &&
      Array.isArray(n?.params) &&
      n?.params.length > 0 &&
      n?.params.some((p: string) => p.startsWith("n_")),
    ) as any;
    expect(loopFn).toBeDefined();
    expect(loopFn.params.length).toBeGreaterThan(0);
  });
});
