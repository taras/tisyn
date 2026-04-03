/**
 * Compiler tests for timebox.
 *
 * Tests the compilation of `yield* timebox(duration, function*() { ... })`.
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

// ── Acceptance tests ──

describe("timebox compilation", () => {
  it("literal duration compiles to TimeboxEval with number", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* timebox(5000, function* () {
          return 42;
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    expect(tb).toBeDefined();
    expect(tb!.data).toHaveProperty("tisyn", "quote");
    expect(tb!.data.expr).toHaveProperty("duration", 5000);
    expect(tb!.data.expr).toHaveProperty("body");
  });

  it("ref duration from prior const binding", () => {
    const ir = compileOne(`
      function* f(timeout: number): Workflow<any> {
        return yield* timebox(timeout, function* () {
          return 42;
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    expect(tb).toBeDefined();
    // Duration should be a Ref to "timeout"
    expect(tb!.data.expr.duration).toMatchObject({ tisyn: "ref", name: "timeout" });
  });

  it("ref duration from prior yield* binding (in outer Let)", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        const ms = yield* sleep(100);
        return yield* timebox(ms, function* () {
          return 42;
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    expect(tb).toBeDefined();
    expect(tb!.data.expr.duration).toMatchObject({ tisyn: "ref", name: "ms" });
  });

  it("body with agent calls compiles correctly", () => {
    const ir = compileOne(`
      function* f(): Workflow<any> {
        return yield* timebox(5000, function* () {
          return yield* sleep(100);
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    expect(tb).toBeDefined();
    // Body should contain a sleep call
    const sleepNode = findNode(tb!.data.expr.body, "sleep");
    expect(sleepNode).toBeDefined();
  });

  it("body captures outer lexical refs", () => {
    const ir = compileOne(`
      function* f(x: number): Workflow<any> {
        return yield* timebox(5000, function* () {
          return x;
        });
      }
    `);
    const tb = findNode(ir, "timebox");
    expect(tb).toBeDefined();
    // Body should reference "x"
    const body = tb!.data.expr.body;
    expect(body).toMatchObject({ tisyn: "ref", name: "x" });
  });
});

// ── Rejection tests ──

describe("timebox rejection", () => {
  it("rejects missing body (E-TB-01)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* timebox(5000);
        }
      `),
    ).toThrow("E-TB-01");
  });

  it("rejects extra args (E-TB-01)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* timebox(5000, function* () { return 1; }, 99);
        }
      `),
    ).toThrow("E-TB-01");
  });

  it("rejects arrow body (E-TB-02)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* timebox(5000, () => 42);
        }
      `),
    ).toThrow("E-TB-02");
  });

  it("rejects non-generator function body (E-TB-02)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          return yield* timebox(5000, function() { return 42; });
        }
      `),
    ).toThrow("E-TB-02");
  });
});
