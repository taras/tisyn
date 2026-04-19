/**
 * Tests for the Agents setup API.
 *
 * AG-1: Agents.use() makes useAgent() succeed
 * AG-2: useAgent() without binding throws descriptive "not bound" error
 * AG-3: Child scope inherits parent's Agents.use() binding
 * AG-4: Child scope binding doesn't affect parent
 * AG-5: Root Effects.around() intercepts locally-bound agent dispatch
 * AG-6: Agents.use() for two different agents in same scope — both accessible
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import type { Val } from "@tisyn/ir";
import { agent, operation, Agents, useAgent } from "./index.js";
import { Effects } from "@tisyn/effects";

describe("Agents setup API", () => {
  // AG-1
  it("Agents.use() makes useAgent() succeed", function* () {
    const calc = agent("calc-ag1", {
      add: operation<{ a: number; b: number }, number>(),
    });

    yield* Agents.use(calc, {
      *add({ a, b }) {
        return a + b;
      },
    });

    const facade = yield* useAgent(calc);
    const result = yield* facade.add({ a: 3, b: 4 });
    expect(result).toBe(7);
  });

  // AG-2
  it("useAgent() without binding throws descriptive error", function* () {
    const unbound = agent("unbound-ag2", {
      run: operation<null, string>(),
    });

    try {
      yield* useAgent(unbound);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("unbound-ag2");
      expect((error as Error).message).toContain("not bound");
    }
  });

  // AG-3
  it("child scope inherits parent's Agents.use() binding", function* () {
    const calc = agent("calc-ag3", {
      add: operation<{ a: number; b: number }, number>(),
    });

    yield* Agents.use(calc, {
      *add({ a, b }) {
        return a + b;
      },
    });

    // Child scope should see parent's binding
    yield* scoped(function* () {
      const facade = yield* useAgent(calc);
      const result = yield* facade.add({ a: 10, b: 20 });
      expect(result).toBe(30);
    });
  });

  // AG-4
  it("child scope binding doesn't affect parent", function* () {
    const parent_agent = agent("parent-ag4", {
      run: operation<null, string>(),
    });

    const child_agent = agent("child-ag4", {
      run: operation<null, string>(),
    });

    yield* Agents.use(parent_agent, {
      *run() {
        return "parent";
      },
    });

    yield* scoped(function* () {
      yield* Agents.use(child_agent, {
        *run() {
          return "child";
        },
      });

      // Child can see both
      const childFacade = yield* useAgent(child_agent);
      expect(yield* childFacade.run(null)).toBe("child");

      const parentFacade = yield* useAgent(parent_agent);
      expect(yield* parentFacade.run(null)).toBe("parent");
    });

    // Parent cannot see child's binding
    try {
      yield* useAgent(child_agent);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("child-ag4");
      expect((error as Error).message).toContain("not bound");
    }
  });

  // AG-5
  it("root Effects.around() intercepts locally-bound agent dispatch", function* () {
    const calc = agent("calc-ag5", {
      add: operation<{ a: number; b: number }, number>(),
    });

    let intercepted = false;

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        intercepted = true;
        return yield* next(e, d);
      },
    });

    yield* Agents.use(calc, {
      *add({ a, b }) {
        return a + b;
      },
    });

    const facade = yield* useAgent(calc);
    yield* facade.add({ a: 1, b: 2 });

    expect(intercepted).toBe(true);
  });

  // AG-6
  it("Agents.use() for two different agents — both accessible", function* () {
    const calc = agent("calc-ag6", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const greeter = agent("greeter-ag6", {
      greet: operation<{ name: string }, string>(),
    });

    yield* Agents.use(calc, {
      *add({ a, b }) {
        return a + b;
      },
    });

    yield* Agents.use(greeter, {
      *greet({ name }) {
        return `hello ${name}`;
      },
    });

    const calcFacade = yield* useAgent(calc);
    const greeterFacade = yield* useAgent(greeter);

    expect(yield* calcFacade.add({ a: 5, b: 5 })).toBe(10);
    expect(yield* greeterFacade.greet({ name: "world" })).toBe("hello world");
  });
});
