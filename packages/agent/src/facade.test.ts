import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import type { Val } from "@tisyn/ir";
import {
  agent,
  operation,
  implementAgent,
  Effects,
  useAgent,
  BoundAgentsContext,
} from "./index.js";
import type { AgentDeclaration, AgentImplementation, OperationSpec } from "./types.js";

/**
 * Bind an agent in the current scope: register its ID in BoundAgentsContext
 * and install the implementation as dispatch middleware.
 */
function* bindAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  impl: AgentImplementation<Ops>,
) {
  const current = yield* BoundAgentsContext.expect();
  const next = new Set(current);
  next.add(declaration.id);
  yield* BoundAgentsContext.set(next);
  yield* impl.install();
}

describe("agent facade", () => {
  // F-1: useAgent() returns object with direct methods AND .around()
  it("returns facade with direct methods and .around()", function* () {
    const reviewer = agent("reviewer-f1", {
      review: operation<{ text: string }, string>(),
      summarize: operation<{ text: string }, string>(),
    });

    const impl = implementAgent(reviewer, {
      // biome-ignore lint/correctness/useYield: mock handler
      *review({ text }) {
        return `reviewed: ${text}`;
      },
      // biome-ignore lint/correctness/useYield: mock handler
      *summarize({ text }) {
        return `summary: ${text}`;
      },
    });

    yield* bindAgent(reviewer, impl);
    const facade = yield* useAgent(reviewer);

    // Direct methods exist and are functions
    expect(typeof facade.review).toBe("function");
    expect(typeof facade.summarize).toBe("function");

    // .around() exists and is a function
    expect(typeof facade.around).toBe("function");

    // Direct method dispatches correctly
    const result = yield* facade.review({ text: "hello" });
    expect(result).toBe("reviewed: hello");
  });

  // F-2: facade .around() per-operation middleware intercepts before Effects
  it("per-operation facade middleware intercepts before Effects middleware", function* () {
    const order: string[] = [];

    const calc = agent("calc-f2", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const impl = implementAgent(calc, {
      // biome-ignore lint/correctness/useYield: mock handler
      *add({ a, b }) {
        return a + b;
      },
    });

    // Install Effects-level middleware FIRST so it's outermost max
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        order.push("effects");
        return yield* next(e, d);
      },
    });

    // Then bind the agent (impl installs as next max, inner)
    yield* bindAgent(calc, impl);

    const facade = yield* useAgent(calc);

    // Install facade-level middleware on the "add" operation
    yield* facade.around({
      *add([args]: [Val], next) {
        order.push("facade");
        return yield* next(args);
      },
    });

    yield* facade.add({ a: 1, b: 2 });

    // Facade middleware runs first (structurally wraps dispatch),
    // then Effects-level middleware fires (outermost in Effects chain)
    expect(order).toEqual(["facade", "effects"]);
  });

  // F-3: two useAgent() calls for same agent share middleware visibility
  it("two useAgent() calls in same scope share middleware", function* () {
    const calc = agent("calc-f3", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const impl = implementAgent(calc, {
      // biome-ignore lint/correctness/useYield: mock handler
      *add({ a, b }) {
        return a + b;
      },
    });

    yield* bindAgent(calc, impl);

    const facade1 = yield* useAgent(calc);
    const facade2 = yield* useAgent(calc);

    // Install middleware via facade1
    let intercepted = false;
    yield* facade1.around({
      *add([args]: [Val], next) {
        intercepted = true;
        return yield* next(args);
      },
    });

    // Dispatch via facade2 — should see middleware from facade1
    yield* facade2.add({ a: 1, b: 2 });
    expect(intercepted).toBe(true);
  });

  // F-4: child scope inherits facade MW; child-installed facade MW doesn't affect parent
  it("child facade middleware inherits down but not up", function* () {
    const calc = agent("calc-f4", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const impl = implementAgent(calc, {
      // biome-ignore lint/correctness/useYield: mock handler
      *add({ a, b }) {
        return a + b;
      },
    });

    yield* bindAgent(calc, impl);

    const parentFacade = yield* useAgent(calc);

    // Install parent-level facade middleware
    const parentLog: string[] = [];
    yield* parentFacade.around({
      *add([args]: [Val], next) {
        parentLog.push("parent");
        return yield* next(args);
      },
    });

    // Run child scope
    const childLog: string[] = [];
    yield* scoped(function* () {
      const childFacade = yield* useAgent(calc);

      // Install child-level facade middleware
      yield* childFacade.around({
        *add([args]: [Val], next) {
          childLog.push("child");
          return yield* next(args);
        },
      });

      // Child dispatch sees both parent and child facade MW
      yield* childFacade.add({ a: 1, b: 2 });
      expect(parentLog).toContain("parent");
      expect(childLog).toContain("child");
    });

    // Reset logs
    parentLog.length = 0;
    childLog.length = 0;

    // Parent dispatch should NOT see child facade MW
    yield* parentFacade.add({ a: 3, b: 4 });
    expect(parentLog).toContain("parent");
    expect(childLog).toHaveLength(0);
  });

  // F-5: composition order: facade max → facade min → Effects max → core handler
  // The impl handler short-circuits matching effects (calls handler directly
  // without delegating to next), so Effects min-priority middleware only runs
  // for non-matching effects. The key property tested here is that BOTH facade
  // layers run before the Effects chain.
  it("facade max → facade min → Effects max → core handler", function* () {
    const order: string[] = [];

    const calc = agent("calc-f5", {
      add: operation<{ a: number; b: number }, number>(),
    });

    // Install Effects-level middleware FIRST so it's outermost in Effects chain
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        order.push("effects-max");
        return yield* next(e, d);
      },
    });

    // Install core handler AFTER effects MW so it's inner
    const impl = implementAgent(calc, {
      // biome-ignore lint/correctness/useYield: mock handler
      *add({ a, b }) {
        order.push("core");
        return a + b;
      },
    });
    yield* bindAgent(calc, impl);

    const facade = yield* useAgent(calc);

    // Facade max
    yield* facade.around({
      *add([args]: [Val], next) {
        order.push("facade-max");
        return yield* next(args);
      },
    });

    // Facade min
    yield* facade.around(
      {
        *add([args]: [Val], next) {
          order.push("facade-min");
          return yield* next(args);
        },
      },
      { at: "min" },
    );

    yield* facade.add({ a: 1, b: 2 });

    // Facade composes before Effects (structural: facade calls dispatch)
    // Within each layer: max before min
    expect(order).toEqual(["facade-max", "facade-min", "effects-max", "core"]);
  });

  // F-6: single-payload contract preserved
  it("single-payload contract: method takes one arg, returns one result", function* () {
    const calc = agent("calc-f6", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const impl = implementAgent(calc, {
      // biome-ignore lint/correctness/useYield: mock handler
      *add({ a, b }) {
        return a + b;
      },
    });

    yield* bindAgent(calc, impl);

    const facade = yield* useAgent(calc);
    const result = yield* facade.add({ a: 21, b: 21 });
    expect(result).toBe(42);
  });
});
