/**
 * Compiler tests for yield* useConfig().
 *
 * useConfig() is an authored form that lowers to ExternalEval("__config", Q(null)).
 * Unlike useAgent(), it is NOT erased — it returns a value that can be bound.
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

describe("useConfig compilation", () => {
  it("yield* useConfig() compiles to ExternalEval(__config, Q(null))", () => {
    const ir = compileOne(`
      function* f(): Workflow<void> {
        yield* useConfig();
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();
    expect(configNode!.data).toEqual({ tisyn: "quote", expr: null });
  });

  it("const cfg = yield* useConfig() binds the result to a variable", () => {
    const ir = compileOne(`
      function* f(): Workflow<void> {
        const cfg = yield* useConfig();
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();

    // The IR should contain a Let binding for cfg
    const json = JSON.stringify(ir);
    expect(json).toContain('"name":"cfg"');
    expect(json).toContain('"__config"');
  });

  it("yield* useConfig('arg') → compile error UC1", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* useConfig("arg");
        }
      `),
    ).toThrow("UC1");
  });

  it("yield* useConfig() inside spawn body compiles", () => {
    const ir = compileOne(`
      function* f(): Workflow<void> {
        yield* spawn(function* () {
          const cfg = yield* useConfig();
        });
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();
  });
});
