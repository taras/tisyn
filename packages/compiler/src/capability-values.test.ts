/**
 * Capability Values — Compiler Conformance Test Suite
 *
 * Validates the shared capability-value rules from the Capability Values
 * specification amendment. 38 Core tests + Extended tests.
 *
 * See: capability-values-test-plan.md
 */

import { describe, it, expect } from "vitest";
import { compileOne } from "./index.js";

// Helper: search IR tree for an Eval node with a given id
function findEval(node: unknown, id: string): Record<string, any> | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "eval" && obj["id"] === id) return obj as Record<string, any>;
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findEval(item, id);
        if (found) return found;
      }
    } else {
      const found = findEval(value, id);
      if (found) return found;
    }
  }
  return undefined;
}

const fn = `function* () { return 1; }`;

// ── A. Capability Origin Recognition ──

describe("capability origin recognition", () => {
  it("CV-O-001: spawn origin classified as capability", () => {
    // Spawn handle is classified as capability — verified indirectly:
    // the compiler rejects it in expression position (CV-E1)
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const t = yield* spawn(${fn});
          return t;
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-O-002: non-capability origin remains ordinary", () => {
    // Agent effect result is ordinary — can be returned
    compileOne(`
      function* f(): Workflow<any> {
        const x = yield* OrderService().fetchOrder("id");
        return x;
      }
    `);
  });

  it("CV-O-003: literal value remains ordinary", () => {
    compileOne(`
      function* f(): Workflow<number> {
        const n = 42;
        return n;
      }
    `);
  });

  it("CV-O-004: durable descriptor from agent effect is ordinary", () => {
    compileOne(`
      function* f(): Workflow<any> {
        const sessionId = yield* SessionService().openSession("config");
        return sessionId;
      }
    `);
  });

  it("CV-O-005: binding from non-recognized function is ordinary", () => {
    // yield* of a sub-workflow call is ordinary
    compileOne(`
      function* helper(): Workflow<number> {
        return 42;
      }
      function* f(): Workflow<number> {
        const result = yield* helper();
        return result;
      }
    `);
  });
});

// ── B. Binding Rules ──

describe("binding rules", () => {
  it("CV-B-001: const binding of spawn origin accepted", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const t = yield* spawn(${fn});
        yield* t;
      }
    `);
  });

  it("CV-B-002: let binding of spawn origin rejected (CV-E5)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          let t = yield* spawn(${fn});
        }
      `),
    ).toThrow("CV-E5");
  });

  it("CV-B-003: let binding does not apply to ordinary values", () => {
    compileOne(`
      function* f(): Workflow<any> {
        let x = yield* OrderService().fetchOrder("id");
        return x;
      }
    `);
  });
});

// ── C. Spatial Restrictions — Prohibited ──

describe("spatial restrictions — prohibited", () => {
  it("CV-S-001: capability binding returned from workflow (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const t = yield* spawn(${fn});
          return t;
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-S-002: capability binding in object literal (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const t = yield* spawn(${fn});
          return { task: t };
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-S-003: capability binding in array literal (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const t = yield* spawn(${fn});
          return [t];
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-S-004: capability binding as agent method arg (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const t = yield* spawn(${fn});
          yield* OrderService().send(t);
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-S-005: spawn handle captured in spawned body (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const t = yield* spawn(${fn});
          yield* spawn(function* () {
            yield* t;
          });
        }
      `),
    ).toThrow("CV-E1");
  });
});

// ── C. Spatial Restrictions — Permitted ──

describe("spatial restrictions — permitted", () => {
  it("CV-S-010: capability binding referenced in join position", () => {
    compileOne(`
      function* f(): Workflow<number> {
        const t = yield* spawn(${fn});
        const r = yield* t;
        return r;
      }
    `);
  });

  it("CV-S-011: family-defined operation on capability binding (join)", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const t = yield* spawn(${fn});
        yield* t;
      }
    `);
  });

  it("CV-S-012: ordinary value in object literal", () => {
    compileOne(`
      function* f(): Workflow<any> {
        const x = yield* OrderService().fetchOrder("id");
        return { result: x };
      }
    `);
  });

  it("CV-S-013: ordinary value returned from workflow", () => {
    compileOne(`
      function* f(): Workflow<any> {
        const x = yield* OrderService().fetchOrder("id");
        return x;
      }
    `);
  });
});

// ── D. Lifecycle Legality ──

describe("lifecycle legality", () => {
  it("CV-L-001: completion in active state accepted", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const t = yield* spawn(${fn});
        yield* t;
      }
    `);
  });

  it("CV-L-002: operations before completion accepted", () => {
    compileOne(`
      function* f(): Workflow<number> {
        const t = yield* spawn(${fn});
        const x = yield* OrderService().doWork("data");
        const r = yield* t;
        return r;
      }
    `);
  });

  it("CV-L-010: operation after straight-line completion rejected (CV-E2 or CV-E3)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const t = yield* spawn(${fn});
          yield* t;
          yield* t;
        }
      `),
    ).toThrow(/CV-E[23]/);
  });
});

// ── E. Control-Flow Analysis — Conditionals ──

describe("control-flow analysis — conditionals", () => {
  it("CV-CF-010: completion in one branch, use after conditional (CV-E4)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const t = yield* spawn(${fn});
          const cond = yield* OrderService().check();
          if (cond) {
            yield* t;
          }
          yield* t;
        }
      `),
    ).toThrow("CV-E4");
  });

  it("CV-CF-011: completion in both branches, no use after conditional", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const t = yield* spawn(${fn});
        const cond = yield* OrderService().check();
        if (cond) {
          yield* t;
        } else {
          yield* t;
        }
      }
    `);
  });

  it("CV-CF-012: completion in one branch only, no use after", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const t = yield* spawn(${fn});
        const cond = yield* OrderService().check();
        if (cond) {
          yield* t;
        }
      }
    `);
  });

  it("CV-CF-013: completion in else branch, use after conditional (CV-E4)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const t = yield* spawn(${fn});
          const cond = yield* OrderService().check();
          if (cond) {
            yield* OrderService().doOther();
          } else {
            yield* t;
          }
          yield* t;
        }
      `),
    ).toThrow("CV-E4");
  });
});

// ── E. Control-Flow Analysis — Loops ──

describe("control-flow analysis — loops", () => {
  it("CV-CF-020: completion in loop body, use after loop (CV-E4)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const t = yield* spawn(${fn});
          let cond = true;
          while (cond) {
            yield* t;
            cond = false;
          }
          yield* t;
        }
      `),
    ).toThrow("CV-E4");
  });

  it("CV-CF-021: completion in loop body, no use after loop", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const t = yield* spawn(${fn});
        let cond = true;
        while (cond) {
          yield* t;
          cond = false;
        }
      }
    `);
  });
});

// ── F. Compiler-Internal vs Author-Visible ──

describe("compiler-internal vs author-visible", () => {
  it("CV-V-001: spawn handle produces user-facing diagnostic on violation (CV-E5)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          let t = yield* spawn(${fn});
        }
      `),
    ).toThrow("CV-E5");
  });

  it("CV-V-002: stream subscription handle is not author-accessible (E-STREAM-004)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const sub = yield* each(source);
        }
      `),
    ).toThrow("E-STREAM-004");
  });

  it("CV-V-003: compiler-internal subscription handles enforce restrictions structurally", () => {
    const compiled = compileOne(`
      function* f(): Workflow<void> {
        for (const x of yield* each(source)) {
          yield* OrderService().process(x);
        }
      }
    `);
    // Verify stream.subscribe and stream.next evals exist in IR
    const subscribe = findEval(compiled.body, "stream.subscribe");
    expect(subscribe).toBeDefined();
    const next = findEval(compiled.body, "stream.next");
    expect(next).toBeDefined();
  });
});

// ── G. Durable Descriptor Distinction ──

describe("durable descriptor distinction", () => {
  it("CV-DD-001: agent effect result is ordinary, not capability", () => {
    compileOne(`
      function* f(): Workflow<any> {
        const id = yield* SessionService().openSession("cfg");
        return id;
      }
    `);
  });

  it("CV-DD-002: ordinary value passed to agent after being returned by agent", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const id = yield* SessionService().open("cfg");
        yield* SessionService().use(id);
      }
    `);
  });

  it("CV-DD-003: compiler does not apply lifecycle rules to ordinary values", () => {
    compileOne(`
      function* f(): Workflow<void> {
        const id = yield* SessionService().open("cfg");
        yield* SessionService().close(id);
        yield* SessionService().reuse(id);
      }
    `);
  });
});

// ── H. Cross-Spec Migration Consistency ──

describe("cross-spec migration", () => {
  it("CV-MIG-001: spawn handle returned from workflow still rejected (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const t = yield* spawn(${fn});
          return t;
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-MIG-002: spawn handle in object literal still rejected (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const t = yield* spawn(${fn});
          return { t: t };
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-MIG-003: spawn handle in array literal still rejected (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const t = yield* spawn(${fn});
          return [t];
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-MIG-004: spawn handle capture in spawned body still rejected (CV-E1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const t = yield* spawn(${fn});
          yield* spawn(function* () {
            yield* t;
          });
        }
      `),
    ).toThrow("CV-E1");
  });

  it("CV-MIG-005: let binding of spawn handle still rejected (CV-E5)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          let t = yield* spawn(${fn});
        }
      `),
    ).toThrow("CV-E5");
  });

  it("CV-MIG-006: stream each() outside for...of still rejected (E-STREAM-004)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const sub = yield* each(source);
        }
      `),
    ).toThrow("E-STREAM-004");
  });
});
