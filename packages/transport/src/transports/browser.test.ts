import { describe, it } from "@effectionx/vitest";
import { expect, vi, beforeEach } from "vitest";
import { scoped } from "effection";
import { invoke } from "@tisyn/agent";
import { agent, operation } from "@tisyn/agent";
import { Fn } from "@tisyn/ir";
import type { IrInput } from "@tisyn/ir";
import { installRemoteAgent } from "../install-remote.js";
import { Browser, browserTransport, localCapability } from "./browser.js";

// ── Test agent for capability composition ──

const Calc = agent("calc", {
  add: operation<{ a: number; b: number }, number>(),
});

const Greet = agent("greet", {
  hello: operation<{ name: string }, string>(),
});

function calcHandlers() {
  return {
    // biome-ignore lint/correctness/useYield: mock
    *add(params: { a: number; b: number }) {
      return params.a + params.b;
    },
  };
}

function greetHandlers() {
  return {
    // biome-ignore lint/correctness/useYield: mock
    *hello(params: { name: string }) {
      return `Hello, ${params.name}!`;
    },
  };
}

// Helper: create IR that dispatches to an agent effect and returns the result
// The workflow is a function with no params whose body is the effect
function effectWorkflow(agentType: string, opName: string, data: unknown = {}): IrInput {
  return Fn([], { tisyn: "eval", id: `${agentType}.${opName}`, data }) as IrInput;
}

// Helper: create IR that just returns a literal value
function literalWorkflow(value: unknown): IrInput {
  return Fn([], value) as IrInput;
}

// ── Mock Playwright ──

let mockPage: {
  goto: ReturnType<typeof vi.fn>;
  addScriptTag: ReturnType<typeof vi.fn>;
  waitForFunction: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

let mockBrowser: {
  close: ReturnType<typeof vi.fn>;
  newContext: ReturnType<typeof vi.fn>;
};

let mockContext: {
  newPage: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockPage = {
    goto: vi.fn(async () => {}),
    addScriptTag: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ({ status: "ok", value: 42 })),
    close: vi.fn(async () => {}),
  };

  mockContext = {
    newPage: vi.fn(async () => mockPage),
  };

  mockBrowser = {
    close: vi.fn(async () => {}),
    newContext: vi.fn(async () => mockContext),
  };

  // Reset launcher mocks so tests don't leak call counts
  mockLaunchers.chromium.launch.mockClear();
  mockLaunchers.firefox.launch.mockClear();
  mockLaunchers.webkit.launch.mockClear();
});

const mockLaunchers = {
  chromium: { launch: vi.fn(async () => mockBrowser) },
  firefox: { launch: vi.fn(async () => mockBrowser) },
  webkit: { launch: vi.fn(async () => mockBrowser) },
};

vi.mock("playwright-core", () => mockLaunchers);

// ── Tests ──

describe("browser transport", () => {
  // --- Capability composition — in-process mode ---

  describe("Capability composition — in-process mode", () => {
    it("installed local capability is available to incoming IR", function* () {
      const factory = browserTransport({
        capabilities: [localCapability(Calc, calcHandlers())],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        const result = yield* invoke(
          Browser.execute({ workflow: effectWorkflow("calc", "add", { a: 3, b: 4 }) }),
        );
        expect(result).toBe(7);
      });
    });

    it("multiple capabilities compose correctly", function* () {
      const factory = browserTransport({
        capabilities: [
          localCapability(Calc, calcHandlers()),
          localCapability(Greet, greetHandlers()),
        ],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);

        const sum = yield* invoke(
          Browser.execute({ workflow: effectWorkflow("calc", "add", { a: 10, b: 20 }) }),
        );
        expect(sum).toBe(30);

        const greeting = yield* invoke(
          Browser.execute({ workflow: effectWorkflow("greet", "hello", { name: "World" }) }),
        );
        expect(greeting).toBe("Hello, World!");
      });
    });

    it("uninstalled capability causes local error", function* () {
      // No capabilities installed
      const factory = browserTransport({});

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(
            Browser.execute({ workflow: effectWorkflow("calc", "add", { a: 1, b: 2 }) }),
          );
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      });
    });

    it("no host fallback for missing local capabilities", function* () {
      // Install Calc but NOT Greet — dispatching to greet should fail locally
      const factory = browserTransport({
        capabilities: [localCapability(Calc, calcHandlers())],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);

        // Calc works
        const sum = yield* invoke(
          Browser.execute({ workflow: effectWorkflow("calc", "add", { a: 1, b: 2 }) }),
        );
        expect(sum).toBe(3);

        // Greet fails — no host fallback
        try {
          yield* invoke(
            Browser.execute({ workflow: effectWorkflow("greet", "hello", { name: "X" }) }),
          );
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      });
    });
  });

  // --- Capability composition — real-browser mode ---

  describe("Capability composition — real-browser mode", () => {
    it("executor bundle is injected via page.addScriptTag", function* () {
      const factory = browserTransport({
        executor: "/path/to/executor.iife.js",
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        // Execute to trigger transport setup
        yield* invoke(Browser.execute({ workflow: literalWorkflow(42) }));
      });

      expect(mockPage.addScriptTag).toHaveBeenCalledWith({
        path: "/path/to/executor.iife.js",
      });
      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });

    it("transport drives page.evaluate with IR and returns result", function* () {
      const expectedResult = { key: "value", nested: [1, 2, 3] };
      mockPage.evaluate.mockResolvedValue({ status: "ok", value: expectedResult });

      const factory = browserTransport({
        executor: "/path/to/executor.iife.js",
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        const result = yield* invoke(Browser.execute({ workflow: literalWorkflow("ignored") }));
        expect(result).toEqual(expectedResult);
      });

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it("executor error propagates as thrown Error", function* () {
      mockPage.evaluate.mockResolvedValue({
        status: "err",
        error: { message: "capability not found: dom.click" },
      });

      const factory = browserTransport({
        executor: "/path/to/executor.iife.js",
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(Browser.execute({ workflow: literalWorkflow(null) }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("capability not found: dom.click");
        }
      });
    });
  });

  // --- Execute envelope ---

  describe("Execute envelope", () => {
    it("returns JSON-serializable result value", function* () {
      const factory = browserTransport({
        capabilities: [localCapability(Calc, calcHandlers())],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        const result = yield* invoke(
          Browser.execute({ workflow: effectWorkflow("calc", "add", { a: 100, b: 200 }) }),
        );
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        expect(result).toBe(300);
      });
    });

    it("executor error throws Error with message", function* () {
      const factory = browserTransport({
        capabilities: [localCapability(Calc, calcHandlers())],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          // Pass IR that references nonexistent agent — causes runtime error
          yield* invoke(Browser.execute({ workflow: effectWorkflow("nonexistent", "op", {}) }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      });
    });

    it("each execute call gets fresh capability scope", function* () {
      let callCount = 0;
      const countingCalc = agent("counting", {
        inc: operation<Record<string, never>, number>(),
      });
      const countingCap = localCapability(countingCalc, {
        // biome-ignore lint/correctness/useYield: mock
        *inc() {
          callCount++;
          return callCount;
        },
      });

      const factory = browserTransport({
        capabilities: [countingCap],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);

        const r1 = yield* invoke(
          Browser.execute({ workflow: effectWorkflow("counting", "inc", {}) }),
        );
        const r2 = yield* invoke(
          Browser.execute({ workflow: effectWorkflow("counting", "inc", {}) }),
        );

        // Both calls succeed (capabilities installed each time)
        expect(r1).toBe(1);
        expect(r2).toBe(2);
      });
    });
  });

  // --- Transport lifecycle ---

  describe("Transport lifecycle", () => {
    it("factory creates transport in in-process mode", function* () {
      const factory = browserTransport({
        capabilities: [localCapability(Calc, calcHandlers())],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        const result = yield* invoke(Browser.execute({ workflow: literalWorkflow(42) }));
        expect(result).toBe(42);
      });
    });

    it("in-process mode does not touch Playwright", function* () {
      const factory = browserTransport({
        capabilities: [localCapability(Calc, calcHandlers())],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        yield* invoke(Browser.execute({ workflow: effectWorkflow("calc", "add", { a: 1, b: 2 }) }));
      });

      // Playwright should never have been launched
      expect(mockLaunchers.chromium.launch).not.toHaveBeenCalled();
      expect(mockLaunchers.firefox.launch).not.toHaveBeenCalled();
      expect(mockLaunchers.webkit.launch).not.toHaveBeenCalled();
    });

    it("real-browser mode shuts down browser on scope exit", function* () {
      const factory = browserTransport({
        executor: "/path/to/executor.iife.js",
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        yield* invoke(Browser.execute({ workflow: literalWorkflow("hello") }));
      });

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  // --- Navigate operation ---

  describe("Navigate operation — real-browser mode", () => {
    it("navigate({ url }) calls page.goto(url)", function* () {
      const factory = browserTransport({
        executor: "/path/to/executor.iife.js",
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        yield* invoke(Browser.navigate({ url: "https://example.com" }));
      });

      expect(mockPage.goto).toHaveBeenCalledWith("https://example.com");
    });

    it("navigate then execute operate on same implicit page", function* () {
      const factory = browserTransport({
        executor: "/path/to/executor.iife.js",
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        yield* invoke(Browser.navigate({ url: "https://example.com/app" }));
        yield* invoke(Browser.execute({ workflow: literalWorkflow("test") }));
      });

      expect(mockPage.goto).toHaveBeenCalledWith("https://example.com/app");
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it("navigate error propagates", function* () {
      mockPage.goto.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED"));

      const factory = browserTransport({
        executor: "/path/to/executor.iife.js",
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(Browser.navigate({ url: "https://unreachable.test" }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("net::ERR_CONNECTION_REFUSED");
        }
      });
    });
  });

  describe("Navigate operation — in-process mode", () => {
    it("navigate throws in in-process mode", function* () {
      const factory = browserTransport({
        capabilities: [localCapability(Calc, calcHandlers())],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(Browser.navigate({ url: "https://example.com" }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("requires real-browser mode");
        }
      });
    });
  });
});
