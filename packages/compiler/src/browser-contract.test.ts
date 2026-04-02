/**
 * Compiler acceptance tests for the Browser contract.
 *
 * Verifies the compiler handles Browser as an ordinary agent contract
 * with no browser-specific compilation rules (CR8).
 */

import { describe, it, expect } from "vitest";
import { compileOne } from "./index.js";

// Ambient browser contract declaration matching the authored surface
const BROWSER_PREAMBLE = `
  interface NavigateParams { url: string; page?: string; timeout?: number }
  interface NavigateResult { page: string; status: number; url: string }
  interface ClickParams { selector: string; page?: string; timeout?: number }
  interface ClickResult { ok: true }
  interface FillParams { selector: string; value: string; page?: string; timeout?: number }
  interface FillResult { ok: true }
  interface ContentParams { page?: string; format?: "text" | "html" }
  interface ContentResult { text: string; url: string; title: string }
  interface ScreenshotParams { page?: string; fullPage?: boolean; format?: "png" | "jpeg"; quality?: number }
  interface ScreenshotResult { data: string; mimeType: string; width: number; height: number }
  interface SelectPageParams { page: string }
  interface SelectPageResult { page: string; url: string }
  interface ClosePageParams { page: string }
  interface ClosePageResult { ok: true; activePage: string | null }

  declare function Browser(): {
    navigate(params: NavigateParams): Workflow<NavigateResult>;
    click(params: ClickParams): Workflow<ClickResult>;
    fill(params: FillParams): Workflow<FillResult>;
    content(params: ContentParams): Workflow<ContentResult>;
    screenshot(params: ScreenshotParams): Workflow<ScreenshotResult>;
    selectPage(params: SelectPageParams): Workflow<SelectPageResult>;
    closePage(params: ClosePageParams): Workflow<ClosePageResult>;
  };
`;

// ── Helpers ──

function findScopeNode(node: unknown): Record<string, any> | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "eval" && obj["id"] === "scope") return obj as Record<string, any>;
  for (const value of Object.values(obj)) {
    const found = findScopeNode(value);
    if (found) return found;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findScopeNode(item);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function findEvalNodes(node: unknown, prefix: string): Record<string, any>[] {
  const results: Record<string, any>[] = [];
  function walk(n: unknown) {
    if (typeof n !== "object" || n === null) return;
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
        for (const item of value) walk(item);
      }
    }
  }
  walk(node);
  return results;
}

// ── Tests ──

describe("Browser contract compiler acceptance", () => {
  it("BC-C-001: minimal browser scope compiles", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<NavigateResult> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          const browser = yield* useAgent(Browser);
          return yield* browser.navigate({ url: "https://example.com" });
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    // Binding key is "browser" (from toAgentId("Browser"))
    const bindings = scope!.data.expr.bindings;
    expect(bindings).toHaveProperty("browser");

    // Body contains Eval("browser.navigate", ...)
    const evals = findEvalNodes(scope!.data.expr.body, "browser.");
    expect(evals.length).toBeGreaterThanOrEqual(1);
    expect(evals[0]!.id).toBe("browser.navigate");
  });

  it("BC-C-004: multiple browser methods lower to distinct Evals", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<ContentResult> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          const browser = yield* useAgent(Browser);
          yield* browser.navigate({ url: "https://example.com" });
          yield* browser.click({ selector: "#btn" });
          return yield* browser.content({ format: "text" });
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    const evals = findEvalNodes(scope!.data.expr.body, "browser.");
    const evalIds = evals.map((e) => e.id);
    expect(evalIds).toContain("browser.navigate");
    expect(evalIds).toContain("browser.click");
    expect(evalIds).toContain("browser.content");
  });

  it("BC-C-003: useAgent(Browser) erased from IR", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<NavigateResult> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          const browser = yield* useAgent(Browser);
          return yield* browser.navigate({ url: "https://example.com" });
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    // No useAgent node should appear in the IR — useAgent is erased
    const useAgentNodes = findEvalNodes(scope!, "useAgent");
    expect(useAgentNodes).toHaveLength(0);
  });

  it("BC-C-006: all seven contract methods compile to correct effect IDs", () => {
    const ir = compileOne(`
      ${BROWSER_PREAMBLE}
      function* test(browserTransport: () => AgentTransportFactory): Workflow<ClosePageResult> {
        return yield* scoped(function* () {
          yield* useTransport(Browser, browserTransport());
          const browser = yield* useAgent(Browser);
          yield* browser.navigate({ url: "https://example.com" });
          yield* browser.click({ selector: "#btn" });
          yield* browser.fill({ selector: "#input", value: "hello" });
          yield* browser.content({ format: "text" });
          yield* browser.screenshot({ fullPage: true });
          yield* browser.selectPage({ page: "page:0" });
          return yield* browser.closePage({ page: "page:1" });
        });
      }
    `);

    const scope = findScopeNode(ir);
    expect(scope).toBeDefined();

    const evals = findEvalNodes(scope!.data.expr.body, "browser.");
    const evalIds = evals.map((e) => e.id);
    expect(evalIds).toContain("browser.navigate");
    expect(evalIds).toContain("browser.click");
    expect(evalIds).toContain("browser.fill");
    expect(evalIds).toContain("browser.content");
    expect(evalIds).toContain("browser.screenshot");
    expect(evalIds).toContain("browser.selectPage");
    expect(evalIds).toContain("browser.closePage");
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
