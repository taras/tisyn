/**
 * Compiler tests for resource/provide.
 *
 * Tests the compilation of `yield* resource(function*() { ... })` and `yield* provide(value)`.
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

describe("resource compilation", () => {
  it("resource(function*() { yield* provide(v) }) → ResourceEval with ProvideEval", () => {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        return yield* resource(function* () {
          yield* provide(42);
        });
      }
    `);
    const resourceNode = findNode(ir, "resource");
    expect(resourceNode).toBeDefined();
    expect(resourceNode!.data).toHaveProperty("tisyn", "quote");
    expect(resourceNode!.data.expr).toHaveProperty("body");

    const provideNode = findNode(ir, "provide");
    expect(provideNode).toBeDefined();
  });

  it("try/finally resource compiles with cleanup", () => {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        return yield* resource(function* () {
          try {
            yield* provide(42);
          } finally {
            // finally block for cleanup
          }
        });
      }
    `);
    const resourceNode = findNode(ir, "resource");
    expect(resourceNode).toBeDefined();
    const provideNode = findNode(ir, "provide");
    expect(provideNode).toBeDefined();
  });

  it("provide with computed expression", () => {
    const ir = compileOne(`
      function* f(x: number): Workflow<number> {
        return yield* resource(function* () {
          yield* provide(x + 1);
        });
      }
    `);
    const provideNode = findNode(ir, "provide");
    expect(provideNode).toBeDefined();
    // provide data is the compiled expression, not Quote-wrapped
    expect(provideNode!.data).not.toHaveProperty("tisyn", "quote");
  });
});

// ── Rejection tests ──

describe("resource rejection", () => {
  it("rejects provide outside resource body (P2)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* provide(42);
        }
      `),
    ).toThrow("P2");
  });

  it("rejects provide with no arguments (P1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(function* () {
            yield* provide();
          });
        }
      `),
    ).toThrow("P1");
  });

  it("rejects provide inside if branch (P5)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(function* () {
            if (true) {
              yield* provide(42);
            }
          });
        }
      `),
    ).toThrow("P5");
  });

  it("rejects provide inside while loop (P5)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(function* () {
            while (true) {
              yield* provide(42);
            }
          });
        }
      `),
    ).toThrow("P5");
  });

  it("rejects duplicate provide (second provide triggers P6)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(function* () {
            yield* provide(1);
            yield* provide(2);
          });
        }
      `),
    ).toThrow("P6");
  });

  it("rejects code after provide (P6)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(function* () {
            yield* provide(42);
            yield* agent.cleanup();
          });
        }
      `),
    ).toThrow("P6");
  });

  it("rejects nested resource in resource body (RS7)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(function* () {
            yield* resource(function* () {
              yield* provide(1);
            });
            yield* provide(2);
          });
        }
      `),
    ).toThrow("RS7");
  });

  it("rejects non-generator argument (RS1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(() => 42);
        }
      `),
    ).toThrow("RS1");
  });

  it("rejects missing provide (RS4)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* resource(function* () {
            yield* agent.doSomething();
          });
        }
      `),
    ).toThrow("RS4");
  });
});
