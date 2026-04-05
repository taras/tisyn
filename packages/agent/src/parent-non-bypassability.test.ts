import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import type { Operation } from "effection";
import { scoped, spawn } from "effection";
import type { Val } from "@tisyn/ir";
import type { FnNode } from "@tisyn/ir";
import { Fn, Eval, Ref, Arr, If, Eq, Q, Throw } from "@tisyn/ir";
import { Effects, dispatch, evaluateMiddlewareFn } from "./index.js";
import { ProhibitedEffectError } from "@tisyn/kernel";

// ---------------------------------------------------------------------------
// IR helpers
// ---------------------------------------------------------------------------

// Allow-all middleware: passes every effect through to dispatch
const allowAll: FnNode = Fn(
  ["effectId", "data"],
  Eval("dispatch", Arr(Ref("effectId"), Ref("data"))),
);

// Deny specific effect: if effectId === targetId, throw; else forward
function denyEffect(id: string): FnNode {
  return Fn(
    ["effectId", "data"],
    If(
      Eq(Ref("effectId"), Q(id)),
      Throw(Q(id)),
      Eval("dispatch", Arr(Ref("effectId"), Ref("data"))),
    ),
  );
}

// Helper that simulates protocol-server wiring of IR middleware
// as ordinary Effects.around() middleware (replacing the old installEnforcement path).
function withCrossBoundaryMiddleware(fn: FnNode) {
  return Effects.around({
    dispatch: ([effectId, data]: [string, Val], next: (eid: string, d: Val) => Operation<Val>) =>
      evaluateMiddlewareFn(fn, effectId, data, (eid: string, d: Val) => next(eid, d)),
  });
}

// ---------------------------------------------------------------------------
// PNB tests — parent middleware non-bypassability
//
// These tests verify that parent-scope Effects.around() middleware runs
// before child-scope middleware, preserving monotonic narrowing. This is
// guaranteed by collectMiddleware's prototype chain traversal: parent max
// middleware is always outermost.
// ---------------------------------------------------------------------------

describe("parent middleware non-bypassability", () => {
  // PNB-1: middleware installed in parent scope is inherited by child scopes
  it("parent middleware fires for dispatches from child scopes", function* () {
    const log: string[] = [];

    // Core handler at min priority (innermost)
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    // Parent middleware at default max priority (outermost)
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("parent-mw");
        return yield* next(e, d);
      },
    });

    // Child scope dispatch — parent middleware fires via prototype chain inheritance
    yield* scoped(function* () {
      yield* dispatch("test.op", null);
    });

    expect(log).toContain("parent-mw");
    expect(log).toContain("core");
    expect(log.indexOf("parent-mw")).toBeLessThan(log.indexOf("core"));
  });

  // PNB-2: parent middleware runs before child middleware in the same dispatch
  it("parent middleware runs before child middleware in same dispatch", function* () {
    const log: string[] = [];

    // Core handler at min priority
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    // Parent middleware
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("parent-mw");
        return yield* next(e, d);
      },
    });

    yield* scoped(function* () {
      // Child middleware — installed later, runs after parent
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("child-mw");
          return yield* next(e, d);
        },
      });

      yield* dispatch("test.op", null);
    });

    expect(log[0]).toBe("parent-mw");
    expect(log[1]).toBe("child-mw");
    expect(log).toContain("core");
  });

  // PNB-3: parent denial cannot be bypassed by child middleware
  it("parent denial cannot be bypassed by child Effects middleware", function* () {
    // Core handler at min priority
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    // Parent middleware denies "blocked.op" — installed first, outermost max
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        if (e === "blocked.op") {
          throw new Error("denied by parent");
        }
        return yield* next(e, d);
      },
    });

    yield* scoped(function* () {
      // Child installs pass-through — cannot undo parent denial
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          return yield* next(e, d);
        },
      });

      try {
        yield* dispatch("blocked.op", null);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect((error as Error).message).toBe("denied by parent");
      }
    });
  });

  // PNB-4: IR-based middleware (evaluateMiddlewareFn with allow-all) passes effects through
  it("IR allow-all middleware passes effects through to the Effects chain", function* () {
    let coreReached = false;

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          coreReached = true;
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* withCrossBoundaryMiddleware(allowAll);

    const result = yield* dispatch("any.op", null);
    expect(coreReached).toBe(true);
    expect(result).toBe("core");
  });

  // PNB-5: IR-based middleware (evaluateMiddlewareFn with denyEffect) denies the target effect
  it("IR denyEffect middleware denies specific effect", function* () {
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* withCrossBoundaryMiddleware(denyEffect("sensitive.op"));

    // allowed.op passes through
    const result = yield* dispatch("allowed.op", null);
    expect(result).toBe("core");

    // sensitive.op is denied by the IR middleware
    try {
      yield* dispatch("sensitive.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  // PNB-6: IR middleware that uses a non-dispatch effect ID throws ProhibitedEffectError
  it("IR middleware that yields non-dispatch effect throws ProhibitedEffectError", function* () {
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    // IR fn that tries to yield a "sleep" effect — not allowed in middleware
    const illegalMiddleware = Fn(
      ["effectId", "data"],
      Eval("sleep", Q(null)), // "sleep" is not "dispatch" — prohibited
    );

    yield* withCrossBoundaryMiddleware(illegalMiddleware);

    try {
      yield* dispatch("test.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProhibitedEffectError);
      expect((error as ProhibitedEffectError).message).toContain("sleep");
    }
  });

  // PNB-7: middleware installed in a scope is not visible to a sibling scope
  it("middleware installed in one scope does not apply to sibling scope", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    // Sibling scope 1: installs middleware
    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("mw-s1");
          return yield* next(e, d);
        },
      });

      yield* dispatch("test.op", null);
      expect(log).toContain("mw-s1");
    });

    log.length = 0;

    // Sibling scope 2: middleware from scope 1 must NOT be visible here
    yield* scoped(function* () {
      yield* dispatch("test.op", null);
      expect(log).not.toContain("mw-s1");
      expect(log).toContain("core");
    });
  });

  // PNB-8: child scope can install its own middleware independent of parent
  it("child scope middleware does not affect parent scope dispatch", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("child-mw");
          return yield* next(e, d);
        },
      });

      yield* dispatch("test.op", null);
      expect(log).toContain("child-mw");
    });

    log.length = 0;

    // Parent scope dispatch: child middleware must NOT run here
    yield* dispatch("test.op", null);
    expect(log).not.toContain("child-mw");
    expect(log).toContain("core");
  });

  // PNB-9: middleware can transform effectId before forwarding
  it("middleware can transform the effectId before forwarding to the rest of the chain", function* () {
    let receivedEffectId: string | null = null;

    yield* Effects.around(
      {
        *dispatch([e, _d]: [string, Val]) {
          receivedEffectId = e;
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([_e, d]: [string, Val], next) {
        // Rewrite effectId to a canonical form
        return yield* next("canonical.op", d);
      },
    });

    yield* dispatch("original.op", null);
    expect(receivedEffectId).toBe("canonical.op");
  });

  // PNB-10: child scope inherits parent middleware (inherited lookup)
  it("child scoped() task inherits parent middleware", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("parent-mw");
        return yield* next(e, d);
      },
    });

    yield* scoped(function* () {
      yield* dispatch("test.op", null);
    });

    expect(log).toContain("parent-mw");
    expect(log).toContain("core");
  });

  // PNB-11: spawned task inherits parent middleware
  it("spawned task inherits parent middleware", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("parent-mw");
        return yield* next(e, d);
      },
    });

    const task = yield* spawn(function* () {
      yield* dispatch("test.op", null);
    });
    yield* task;

    expect(log).toContain("parent-mw");
    expect(log).toContain("core");
  });

  // PNB-12: child middleware stacks with parent (monotonic narrowing)
  // Unlike the old EnforcementContext (which shadowed), Effects.around()
  // middleware stacks via prototype chain — both parent and child run,
  // parent first. This is correct monotonic narrowing per spec §7.5.
  it("child middleware stacks with parent — both run, parent first", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    // Parent middleware
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("parent-mw");
        return yield* next(e, d);
      },
    });

    // Child installs its own middleware — stacks with parent
    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("child-mw");
          return yield* next(e, d);
        },
      });

      yield* dispatch("test.op", null);
    });

    // Both run — parent first (outermost), then child, then core
    expect(log).toContain("parent-mw");
    expect(log).toContain("child-mw");
    expect(log).toContain("core");
    expect(log.indexOf("parent-mw")).toBeLessThan(log.indexOf("child-mw"));
    expect(log.indexOf("child-mw")).toBeLessThan(log.indexOf("core"));
  });

  // PNB-13: cross-boundary IR middleware → child max → child min → core ordering
  it("cross-boundary IR middleware runs before child max, child min, and core", function* () {
    const log: string[] = [];

    // Core handler (first min — innermost)
    yield* Effects.around(
      {
        *dispatch([_e, d]: [string, Val]) {
          log.push(`core:${d}`);
          return "done" as Val;
        },
      },
      { at: "min" },
    );

    // Cross-boundary IR middleware (first max — outermost): transforms data to "transformed"
    const transform = Fn(
      ["effectId", "data"],
      Eval("dispatch", Arr(Ref("effectId"), Q("transformed"))),
    );
    yield* withCrossBoundaryMiddleware(transform);

    // Child max middleware (second max — inner)
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push(`child-max:${d}`);
        return yield* next(e, d);
      },
    });

    // Child min middleware (second min — outer min, runs before core)
    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push(`child-min:${d}`);
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    yield* dispatch("test.op", "original" as Val);

    expect(log).toEqual(["child-max:transformed", "child-min:transformed", "core:transformed"]);
  });
});
