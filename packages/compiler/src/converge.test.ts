/**
 * Compiler tests for converge.
 *
 * Tests the compilation of `yield* converge({ probe, until, timeout, interval? })`.
 * Converge lowers entirely to timebox IR — no "converge" id in the output.
 */

import { describe, it, expect } from "vitest";
import { compileOne } from "./index.js";

// ── Helpers ──

function findNode(node: unknown, id: string): Record<string, any> | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "eval" && obj["id"] === id) return obj as Record<string, any>;
  for (const value of Object.values(obj)) {
    const found = findNode(value, id);
    if (found) return found;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findNode(item, id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function findAllNodes(node: unknown, id: string): Record<string, any>[] {
  const results: Record<string, any>[] = [];
  function walk(n: unknown) {
    if (typeof n !== "object" || n === null) return;
    const obj = n as Record<string, unknown>;
    if (obj["tisyn"] === "eval" && obj["id"] === id) results.push(obj as Record<string, any>);
    for (const value of Object.values(obj)) {
      walk(value);
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      }
    }
  }
  walk(node);
  return results;
}

function findFnNode(node: unknown): Record<string, any> | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "fn") return obj as Record<string, any>;
  for (const value of Object.values(obj)) {
    const found = findFnNode(value);
    if (found) return found;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFnNode(item);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// ── Acceptance tests ──

describe("converge compilation", () => {
  it("basic converge lowers to timebox IR (no 'converge' id in output)", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* converge({
          probe: function* () { return 42; },
          until: (x) => x > 0,
          timeout: 5000,
        });
      }
    `);
    // Should have a timebox node, no converge node
    const tb = findNode(ir, "timebox");
    expect(tb).toBeDefined();
    expect(findNode(ir, "converge")).toBeUndefined();
  });

  it("timeout becomes timebox duration", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* converge({
          probe: function* () { return 42; },
          until: (x) => x > 0,
          timeout: 3000,
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    expect(tb!.data.expr.duration).toBe(3000);
  });

  it("__until_N Fn has structural-only body", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* converge({
          probe: function* () { return 42; },
          until: (x) => x > 0,
          timeout: 5000,
        });
      }
    `);
    // The timebox body should contain Let bindings with Fn nodes
    const tb = findNode(ir, "timebox");
    const body = tb!.data.expr.body;
    // First let is __until_N
    expect(body.id).toBe("let");
    const untilFn = body.data.expr.value;
    expect(untilFn.tisyn).toBe("fn");
    expect(untilFn.params).toHaveLength(1);
    // The body should be a structural gt expression
    const fnBody = untilFn.body;
    expect(findNode(fnBody, "gt") || fnBody.id === "gt").toBeTruthy();
  });

  it("__poll_N Fn has recursive Call", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* converge({
          probe: function* () { return 42; },
          until: (x) => x > 0,
          timeout: 5000,
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    // Navigate: timebox body → let __until → body → let __poll → value (Fn)
    const body = tb!.data.expr.body;
    const pollLet = body.data.expr.body; // second let
    expect(pollLet.id).toBe("let");
    const pollFn = pollLet.data.expr.value;
    expect(pollFn.tisyn).toBe("fn");
    // The poll fn body should contain a recursive call to __poll
    const calls = findAllNodes(pollFn.body, "call");
    const recursiveCall = calls.find(
      (c) => c.data?.expr?.fn?.tisyn === "ref" && c.data.expr.fn.name.startsWith("__poll_"),
    );
    expect(recursiveCall).toBeDefined();
  });

  it("sleep in else branch with interval value", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* converge({
          probe: function* () { return 42; },
          until: (x) => x > 0,
          timeout: 5000,
          interval: 200,
        });
      }
    `);
    const sleepNodes = findAllNodes(ir, "sleep");
    expect(sleepNodes.length).toBeGreaterThanOrEqual(1);
    // One sleep should have interval 200
    const intervalSleep = sleepNodes.find(
      (s) => Array.isArray(s.data) && s.data[0] === 200,
    );
    expect(intervalSleep).toBeDefined();
  });

  it("default interval is 100 when not specified", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* converge({
          probe: function* () { return 42; },
          until: (x) => x > 0,
          timeout: 5000,
        });
      }
    `);
    const sleepNodes = findAllNodes(ir, "sleep");
    expect(sleepNodes.length).toBeGreaterThanOrEqual(1);
    const defaultSleep = sleepNodes.find(
      (s) => Array.isArray(s.data) && s.data[0] === 100,
    );
    expect(defaultSleep).toBeDefined();
  });

  it("free variables preserved as Refs", () => {
    const ir = compileOne(`
      function* f(target: number): Workflow<any> {
        return yield* converge({
          probe: function* () { return yield* sleep(10); },
          until: (x) => x > target,
          timeout: 5000,
        });
      }
    `);
    // The until body should reference "target" as a Ref
    const tb = findNode(ir, "timebox");
    const body = tb!.data.expr.body;
    const untilFn = body.data.expr.value;
    // Find a ref to "target" somewhere in the until body
    function findRef(node: unknown, name: string): boolean {
      if (typeof node !== "object" || node === null) return false;
      const obj = node as Record<string, unknown>;
      if (obj["tisyn"] === "ref" && obj["name"] === name) return true;
      return Object.values(obj).some((v) => {
        if (Array.isArray(v)) return v.some((item) => findRef(item, name));
        return findRef(v, name);
      });
    }
    expect(findRef(untilFn.body, "target")).toBe(true);
  });

  it("dynamic timeout from prior binding", () => {
    const ir = compileOne(`
      function* f(ms: number): Workflow<any> {
        return yield* converge({
          probe: function* () { return 42; },
          until: (x) => x > 0,
          timeout: ms,
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    expect(tb!.data.expr.duration).toMatchObject({ tisyn: "ref", name: "ms" });
  });

  it("scope/shadowing: until param shadows outer binding", () => {
    const ir = compileOne(`
      function* f(x: number): Workflow<any> {
        return yield* converge({
          probe: function* () { return x; },
          until: (x) => x > 0,
          timeout: 5000,
        });
      }
    `);
    // The until Fn should use its own parameter "x", not the outer "x"
    const tb = findNode(ir, "timebox");
    const body = tb!.data.expr.body;
    const untilFn = body.data.expr.value;
    expect(untilFn.params).toContain("x");
    // The probe body should reference the outer "x"
    const pollLet = body.data.expr.body;
    const pollFn = pollLet.data.expr.value;
    const probeLet = pollFn.body;
    // probe body is the value of the __probe let
    const probeBody = probeLet.data.expr.value;
    expect(probeBody).toMatchObject({ tisyn: "ref", name: "x" });
  });
});

// ── Rejection tests ──

describe("converge rejection", () => {
  it("rejects arrow probe (E-CONV-01)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: () => 42,
            until: (x) => x > 0,
            timeout: 5000,
          });
        }
      `),
    ).toThrow("E-CONV-01");
  });

  it("rejects non-generator probe (E-CONV-01)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: function() { return 42; },
            until: (x) => x > 0,
            timeout: 5000,
          });
        }
      `),
    ).toThrow("E-CONV-01");
  });

  it("rejects generator until (E-CONV-02)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: function* () { return 42; },
            until: function* (x) { return x > 0; },
            timeout: 5000,
          });
        }
      `),
    ).toThrow("E-CONV-02");
  });

  it("rejects block body until (E-CONV-03)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: function* () { return 42; },
            until: (x) => { return x > 0; },
            timeout: 5000,
          });
        }
      `),
    ).toThrow("E-CONV-03");
  });

  it("rejects missing timeout (E-CONV-06)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: function* () { return 42; },
            until: (x) => x > 0,
          });
        }
      `),
    ).toThrow("E-CONV-06");
  });

  it("rejects variable config (E-CONV-07)", () => {
    expect(() =>
      compileOne(`
        function* f(opts: any): Workflow<any> {
          return yield* converge(opts);
        }
      `),
    ).toThrow("E-CONV-07");
  });

  it("rejects yield* in until body (E-CONV-04)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: function* () { return 42; },
            until: (x) => (yield* sleep(1)),
            timeout: 5000,
          });
        }
      `),
    ).toThrow("E-CONV-04");
  });

  it("rejects yield* in interval (E-CONV-08)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: function* () { return 42; },
            until: (x) => x > 0,
            timeout: 5000,
            interval: (yield* sleep(1)),
          });
        }
      `),
    ).toThrow("E-CONV-08");
  });

  it("rejects yield* in timeout (E-CONV-09)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* converge({
            probe: function* () { return 42; },
            until: (x) => x > 0,
            timeout: (yield* sleep(1)),
          });
        }
      `),
    ).toThrow("E-CONV-09");
  });
});
