/**
 * Compiler tests for yield* Config.useConfig(Token).
 *
 * Config.useConfig(Token) is an authored form that lowers to ExternalEval("__config", Q(null)).
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

const PREAMBLE = `
  declare const Config: { useConfig<T>(token: ConfigToken<T>): Generator<unknown, T, unknown> };
  declare const AppToken: ConfigToken<{debug: boolean}>;
`;

describe("Config.useConfig compilation", () => {
  it("yield* Config.useConfig(Token) compiles to ExternalEval(__config, Q(null))", () => {
    const ir = compileOne(`
      ${PREAMBLE}
      function* f(): Workflow<void> {
        yield* Config.useConfig(AppToken);
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();
    expect(configNode!.data).toEqual({ tisyn: "quote", expr: null });
  });

  it("const cfg = yield* Config.useConfig(Token) binds the result to a variable", () => {
    const ir = compileOne(`
      ${PREAMBLE}
      function* f(): Workflow<void> {
        const cfg = yield* Config.useConfig(AppToken);
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();

    // The IR should contain a Let binding for cfg
    const json = JSON.stringify(ir);
    expect(json).toContain('"name":"cfg"');
    expect(json).toContain('"__config"');
  });

  it("yield* Config.useConfig() (no args) → compile error UC1", () => {
    expect(() =>
      compileOne(`
        declare const Config: { useConfig<T>(token: ConfigToken<T>): Generator<unknown, T, unknown> };
        function* f(): Workflow<void> {
          yield* Config.useConfig();
        }
      `),
    ).toThrow("UC1");
  });

  it("yield* Config.useConfig(a, b) (multiple args) → compile error UC1", () => {
    expect(() =>
      compileOne(`
        declare const Config: { useConfig<T>(token: ConfigToken<T>): Generator<unknown, T, unknown> };
        declare const A: ConfigToken<unknown>;
        declare const B: ConfigToken<unknown>;
        function* f(): Workflow<void> {
          yield* Config.useConfig(A, B);
        }
      `),
    ).toThrow("UC1");
  });

  it('yield* Config.useConfig("string") (non-identifier) → compile error UC2', () => {
    expect(() =>
      compileOne(`
        declare const Config: { useConfig<T>(token: ConfigToken<T>): Generator<unknown, T, unknown> };
        function* f(): Workflow<void> {
          yield* Config.useConfig("not-an-identifier");
        }
      `),
    ).toThrow("UC2");
  });

  it("bare yield* useConfig(Token) → compile error UC3", () => {
    expect(() =>
      compileOne(`
        declare const AppToken: ConfigToken<{debug: boolean}>;
        function* f(): Workflow<void> {
          yield* useConfig(AppToken);
        }
      `),
    ).toThrow("UC3");
  });

  it("yield* Config.useConfig(Token) inside spawn body compiles", () => {
    const ir = compileOne(`
      ${PREAMBLE}
      function* f(): Workflow<void> {
        yield* spawn(function* () {
          const cfg = yield* Config.useConfig(AppToken);
        });
      }
    `);
    const configNode = findNode(ir, "__config");
    expect(configNode).toBeDefined();
  });
});
