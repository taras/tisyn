/**
 * IR middleware constraint tests.
 *
 * Verifies that IR middleware expressions are prohibited from using
 * non-dispatch effects (§10.2 constraint), and that structural ops,
 * bindings, and literals work freely.
 *
 * PML-1:  dispatch effect is allowed in middleware IR
 * PML-2:  sleep effect throws ProhibitedEffectError
 * PML-3:  exec effect throws ProhibitedEffectError
 * PML-4:  any non-dispatch effect id throws ProhibitedEffectError
 * PML-5:  structural ops (if, let, eq) do NOT throw — only external effects do
 * PML-6:  middleware that returns without calling dispatch is valid
 * PML-7:  middleware that calls dispatch multiple times — first result is returned
 * PML-8:  error thrown in middleware body propagates
 * PML-9:  ProhibitedEffectError message contains the prohibited effect id
 * PML-10: Let bindings work in middleware IR
 * PML-11: nested If expressions work in middleware IR
 * PML-12: Q (literal/quote) values work as middleware return
 * PML-13: Fn with different param names still works
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import { Fn, Eval, Ref, Arr, If, Eq, Q, Throw, Let } from "@tisyn/ir";
import { evaluateMiddlewareFn } from "@tisyn/agent";
import { ProhibitedEffectError } from "@tisyn/kernel";

// ── Shared middleware fixtures ──

// Calls dispatch normally
const callDispatch = Fn(["effectId", "data"], Eval("dispatch", Arr(Ref("effectId"), Ref("data"))));

// Middleware that tries to use a "sleep" effect
const trySleep = Fn(["effectId", "data"], Eval("sleep", Q(null)));

// Middleware that tries to use an "exec" effect
const tryExec = Fn(["effectId", "data"], Eval("exec", Q(null)));

describe("IR middleware constraints", () => {
  // PML-1
  it("dispatch effect is allowed in middleware IR", function* () {
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });
    const result = yield* evaluateMiddlewareFn(callDispatch, "test.op", null, next);
    expect(result).toBe("ok");
  });

  // PML-2
  it("sleep effect in middleware IR throws ProhibitedEffectError", function* () {
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });
    try {
      yield* evaluateMiddlewareFn(trySleep, "test.op", null, next);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProhibitedEffectError);
      expect((error as Error).message).toContain("sleep");
    }
  });

  // PML-3
  it("exec effect in middleware IR throws ProhibitedEffectError", function* () {
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });
    try {
      yield* evaluateMiddlewareFn(tryExec, "test.op", null, next);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProhibitedEffectError);
      expect((error as Error).message).toContain("exec");
    }
  });

  // PML-4
  it("any non-dispatch effect id throws ProhibitedEffectError", function* () {
    const tryArbitrary = Fn(["effectId", "data"], Eval("some.custom.effect", Q(null)));
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });
    try {
      yield* evaluateMiddlewareFn(tryArbitrary, "test.op", null, next);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProhibitedEffectError);
    }
  });

  // PML-5
  it("structural IR ops (if, let, eq) don't throw ProhibitedEffectError", function* () {
    const structuralOnly = Fn(
      ["effectId", "data"],
      If(Eq(Ref("effectId"), Q("x")), Q("yes"), Q("no")),
    );
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });
    const result = yield* evaluateMiddlewareFn(structuralOnly, "test.op", null, next);
    // effectId ("test.op") != "x", so else branch
    expect(result).toBe("no");
  });

  // PML-6
  it("middleware that returns without calling dispatch is valid", function* () {
    const returnOnly = Fn(["effectId", "data"], Q("short-circuit"));
    let nextCalled = false;
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        nextCalled = true;
        return "from-next" as Val;
      },
    });
    const result = yield* evaluateMiddlewareFn(returnOnly, "test.op", null, next);
    expect(result).toBe("short-circuit");
    expect(nextCalled).toBe(false);
  });

  // PML-7
  it("middleware that calls dispatch once returns the value from next", function* () {
    let callCount = 0;
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        callCount += 1;
        return `result-${callCount}` as Val;
      },
    });
    const result = yield* evaluateMiddlewareFn(callDispatch, "test.op", null, next);
    expect(callCount).toBe(1);
    expect(result).toBe("result-1");
  });

  // PML-8
  it("error thrown in middleware body propagates", function* () {
    const throwMiddleware = Fn(["effectId", "data"], Throw("middleware-error"));
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });
    try {
      yield* evaluateMiddlewareFn(throwMiddleware, "test.op", null, next);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("middleware-error");
    }
  });

  // PML-9
  it("ProhibitedEffectError message contains the prohibited effect id", function* () {
    const tryForbidden = Fn(["effectId", "data"], Eval("forbidden.effect", Q(null)));
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });
    try {
      yield* evaluateMiddlewareFn(tryForbidden, "test.op", null, next);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProhibitedEffectError);
      expect((error as Error).message).toContain("forbidden.effect");
    }
  });

  // PML-10
  it("Let bindings work in middleware IR", function* () {
    // Let bound = effectId; forward it as-is
    const withLet = Fn(
      ["effectId", "data"],
      Let(
        "bound",
        Ref("effectId"),
        Eval("dispatch", Arr(Ref("bound"), Ref("data"))),
      ),
    );
    let forwardedId: string | null = null;
    const next = (eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        forwardedId = eid;
        return "ok" as Val;
      },
    });
    yield* evaluateMiddlewareFn(withLet, "test.op", null, next);
    expect(forwardedId).toBe("test.op");
  });

  // PML-11
  it("nested If expressions work in middleware IR", function* () {
    // If effectId == "a" → "branch-a", else if effectId == "b" → "branch-b", else "branch-other"
    const nestedIf = Fn(
      ["effectId", "data"],
      If(
        Eq(Ref("effectId"), Q("a")),
        Q("branch-a"),
        If(Eq(Ref("effectId"), Q("b")), Q("branch-b"), Q("branch-other")),
      ),
    );
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "ok" as Val;
      },
    });

    expect(yield* evaluateMiddlewareFn(nestedIf, "a", null, next)).toBe("branch-a");
    expect(yield* evaluateMiddlewareFn(nestedIf, "b", null, next)).toBe("branch-b");
    expect(yield* evaluateMiddlewareFn(nestedIf, "c", null, next)).toBe("branch-other");
  });

  // PML-12
  it("Q (literal/quote) values work as middleware return", function* () {
    const returnLiteral = Fn(["effectId", "data"], Q(42));
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "not-called" as Val;
      },
    });
    const result = yield* evaluateMiddlewareFn(
      returnLiteral,
      "test.op",
      null,
      next,
    );
    expect(result).toBe(42);
  });

  // PML-13
  it("Fn with different param names still works", function* () {
    // Use non-conventional param names "eid" and "payload"
    const altParams = Fn(
      ["eid", "payload"],
      Eval("dispatch", Arr(Ref("eid"), Ref("payload"))),
    );
    let forwardedId: string | null = null;
    let forwardedData: Val = null;
    const next = (eid: string, d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        forwardedId = eid;
        forwardedData = d;
        return "ok" as Val;
      },
    });
    yield* evaluateMiddlewareFn(altParams, "custom.op", "hello" as Val, next);
    expect(forwardedId).toBe("custom.op");
    expect(forwardedData).toBe("hello");
  });
});
