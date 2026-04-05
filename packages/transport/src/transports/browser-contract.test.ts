/**
 * Compiler acceptance tests for the Browser contract.
 *
 * Verifies the compiler handles Browser as an ordinary agent contract
 * with navigate and execute operations — no browser-specific compilation rules.
 */

import { describe, it, expect } from "vitest";
import { compileOne } from "@tisyn/compiler";

// Ambient browser contract declaration matching the authored surface
const BROWSER_PREAMBLE = `
  interface NavigateParams { url: string }
  interface ExecuteParams { workflow: unknown }

  declare function Browser(): {
    navigate(params: NavigateParams): Workflow<void>;
    execute(params: ExecuteParams): Workflow<unknown>;
  };
`;

// ── Helpers ──

function findScopeNode(node: unknown): Record<string, any> | undefined {
  if (typeof node !== "object" || node === null) {
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "eval" && obj["id"] === "scope") {
    return obj as Record<string, any>;
  }
  for (const value of Object.values(obj)) {
    const found = findScopeNode(value);
    if (found) {
      return found;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findScopeNode(item);
        if (found) {
          return found;
        }
      }
    }
  }
  return undefined;
}

function findEvalNodes(node: unknown, prefix: string): Record<string, any>[] {
  const results: Record<string, any>[] = [];
  function walk(n: unknown) {
    if (typeof n !== "object" || n === null) {
      return;
    }
    const obj = n as Record<string, unknown>;
    if (
      obj["tisyn"] === "eval" &&
      typeof obj["id"] === "string" &&
      (obj["id"] as string).startsWith(prefix)
    ) {
      results.push(obj as Record<string, any>);
    }
    for (const value of Object.values(obj)) {
      walk(value);
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item);
        }
      }
    }
  }
  walk(node);
  return results;
}

// ── Tests ──

describe("Browser contract compiler acceptance", () => {
  it("BC-C-001: browser scope compiles with navigate and execute", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<unknown> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          const browser = yield* useAgent(Browser);
          yield* browser.navigate({ url: "https://example.com" });
          return yield* browser.execute({ workflow: 42 });
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    // Binding key is "browser" (from toAgentId("Browser"))
    const bindings = scope!.data.expr.bindings;
    expect(bindings).toHaveProperty("browser");

    // Body contains both Eval("browser.navigate", ...) and Eval("browser.execute", ...)
    const evals = findEvalNodes(scope!.data.expr.body, "browser.");
    const ids = evals.map((e) => e.id);
    expect(ids).toContain("browser.navigate");
    expect(ids).toContain("browser.execute");
  });

  it("BC-C-003: useAgent(Browser) erased from IR", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<unknown> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          const browser = yield* useAgent(Browser);
          return yield* browser.execute({ workflow: 42 });
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    // No useAgent node should appear in the IR — useAgent is erased
    const useAgentNodes = findEvalNodes(scope!, "useAgent");
    expect(useAgentNodes).toHaveLength(0);
  });

  it("BC-C-008: browser.navigate lowers to Eval", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<void> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          const browser = yield* useAgent(Browser);
          yield* browser.navigate({ url: "https://example.com" });
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    const evals = findEvalNodes(scope!.data.expr.body, "browser.navigate");
    expect(evals.length).toBeGreaterThanOrEqual(1);
    expect(evals[0]!.id).toBe("browser.navigate");
  });

  it("BC-C-007: browserTransport() compiled as ordinary call, not built-in", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<string> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          return "ok";
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    // Binding expression should be a Call node (not a special built-in)
    const binding = scope!.data.expr.bindings["browser"];
    expect(binding).toBeDefined();
    expect(binding.tisyn).toBe("eval");
    expect(binding.id).toBe("call");
  });
});
