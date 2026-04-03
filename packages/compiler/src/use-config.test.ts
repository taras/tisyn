/**
 * Compiler tests for yield* useConfig(Token).
 *
 * useConfig(Token) is an authored form that lowers to ExternalEval("__config", Q(null)).
 * The token argument provides static typing and is erased by the compiler.
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
  it("yield* useConfig(Token) compiles to ExternalEval(__config, Q(null))", () => {
    const ir = compileOne(`
      declare const AppToken: ConfigToken<{debug: boolean}>;
      function* f(): Workflow<void> {
        yield* useConfig(AppToken);
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();
    expect(configNode!.data).toEqual({ tisyn: "quote", expr: null });
  });

  it("const cfg = yield* useConfig(Token) binds the result to a variable", () => {
    const ir = compileOne(`
      declare const AppToken: ConfigToken<{debug: boolean}>;
      function* f(): Workflow<void> {
        const cfg = yield* useConfig(AppToken);
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();

    // The IR should contain a Let binding for cfg
    const json = JSON.stringify(ir);
    expect(json).toContain('"name":"cfg"');
    expect(json).toContain('"__config"');
  });

  it("yield* useConfig() (no args) → compile error UC1", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* useConfig();
        }
      `),
    ).toThrow("UC1");
  });

  it("yield* useConfig(a, b) (multiple args) → compile error UC1", () => {
    expect(() =>
      compileOne(`
        declare const A: ConfigToken<unknown>;
        declare const B: ConfigToken<unknown>;
        function* f(): Workflow<void> {
          yield* useConfig(A, B);
        }
      `),
    ).toThrow("UC1");
  });

  it('yield* useConfig("string") (non-identifier) → compile error UC2', () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* useConfig("not-an-identifier");
        }
      `),
    ).toThrow("UC2");
  });

  it("yield* useConfig(Token) inside spawn body compiles", () => {
    const ir = compileOne(`
      declare const AppToken: ConfigToken<{debug: boolean}>;
      function* f(): Workflow<void> {
        yield* spawn(function* () {
          const cfg = yield* useConfig(AppToken);
        });
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();
  });
});
