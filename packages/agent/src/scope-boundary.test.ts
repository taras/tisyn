import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import type { Val } from "@tisyn/ir";
import { Effects, dispatch } from "./index.js";

// Shared helper: install a catch-all core handler at min priority.
// Using { at: "min" } ensures it runs AFTER any interceptors installed
// at the default max priority.
function* installCoreHandler() {
  yield* Effects.around(
    {
      // biome-ignore lint/correctness/useYield: mock handler
      *dispatch([_e, _d]: [string, Val]) {
        return "core";
      },
    },
    { at: "min" },
  );
}

describe("scope boundaries", () => {
  // S-1: scope creates isolation boundary
  it("child scope inherits parent middleware; child middleware does NOT run in parent", function* () {
    yield* installCoreHandler();

    const parentLog: string[] = [];

    // Parent middleware
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        parentLog.push("parent");
        return yield* next(e, d);
      },
    });

    // Run a child scope that installs additional middleware
    const childLog: string[] = [];
    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          childLog.push("child");
          return yield* next(e, d);
        },
      });

      // Child dispatch should hit both parent and child middleware
      yield* dispatch("test.op", null);
      expect(parentLog).toContain("parent");
      expect(childLog).toContain("child");
    });

    // Reset logs
    parentLog.length = 0;
    childLog.length = 0;

    // Parent dispatch should NOT hit child middleware
    yield* dispatch("test.op", null);
    expect(parentLog).toContain("parent");
    expect(childLog).toHaveLength(0);
  });

  // S-4: multiple sibling scopes are isolated
  it("sibling scopes are isolated from each other", function* () {
    yield* installCoreHandler();

    const log1: string[] = [];
    const log2: string[] = [];

    // Sibling scope 1 installs M1
    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log1.push("M1");
          return yield* next(e, d);
        },
      });
      yield* dispatch("test.op", null);
      expect(log1).toContain("M1");
      expect(log2).toHaveLength(0);
    });

    // Sibling scope 2 installs M2
    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log2.push("M2");
          return yield* next(e, d);
        },
      });
      yield* dispatch("test.op", null);
      expect(log2).toContain("M2");
      // M1 was installed in a sibling scope, not visible here
      expect(log1).toHaveLength(1); // unchanged from first scope
    });
  });

  // S-5: generator call does not create scope
  it("helper generator does NOT create a scope — caller sees middleware installed in helper", function* () {
    yield* installCoreHandler();

    const log: string[] = [];

    function* helperInstallsMiddleware() {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("helper-mw");
          return yield* next(e, d);
        },
      });
    }

    // Call the helper — it does NOT run in a child scope
    yield* helperInstallsMiddleware();

    // Caller dispatches and should see middleware installed in helper
    yield* dispatch("test.op", null);
    expect(log).toContain("helper-mw");
  });

  // S-6: middleware installed in helper persists in enclosing scope after helper returns
  it("middleware installed in helper persists in enclosing scope after helper returns", function* () {
    yield* installCoreHandler();

    const log: string[] = [];

    function* installM2() {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("M2");
          return yield* next(e, d);
        },
      });
    }

    // Install M2 via helper generator (no scope boundary)
    yield* installM2();

    // After the helper generator returns, dispatch in this scope should still hit M2
    yield* dispatch("test.op", null);
    expect(log).toEqual(["M2"]);

    log.length = 0;
    yield* dispatch("test.op", null);
    expect(log).toEqual(["M2"]);
  });

  // S-8: subworkflow (helper generator) does not create scope — sees parent middleware
  it("subworkflow helper generator sees parent middleware", function* () {
    yield* installCoreHandler();

    const log: string[] = [];

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("parent-mw");
        return yield* next(e, d);
      },
    });

    function subworkflow() {
      // This is a plain generator call — no scope boundary
      return dispatch("test.op", null);
    }

    yield* subworkflow();
    expect(log).toContain("parent-mw");
  });

  // S-9: child scope inherits parent middleware
  it("child scope inherits parent middleware — parent middleware intercepts dispatch inside child", function* () {
    yield* installCoreHandler();

    const log: string[] = [];

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("parent-M");
        return yield* next(e, d);
      },
    });

    yield* scoped(function* () {
      // No additional middleware installed in child
      yield* dispatch("test.op", null);
    });

    expect(log).toContain("parent-M");
  });
});
