/**
 * Scope-local dispatch semantics tests.
 *
 * SLD-1: allow-all middleware forwards effectId and data to next
 * SLD-2: deny-all middleware throws without calling next
 * SLD-3: conditional middleware allows non-blocked effects
 * SLD-4: conditional middleware blocks specific effect
 * SLD-5: short-circuit middleware returns value without calling next
 * SLD-6: middleware transforms data before forwarding to next
 * SLD-9: return value from next flows back as result of evaluateMiddlewareFn
 * SLD-10: error thrown by next propagates through evaluateMiddlewareFn
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import { Fn, Eval, Ref, Arr, If, Eq, Q, Throw } from "@tisyn/ir";
import { evaluateMiddlewareFn } from "@tisyn/agent";

// ── Shared middleware fixtures ──

// Allow-all: forward every dispatch
const allowAll = Fn(["effectId", "data"], Eval("dispatch", Arr(Ref("effectId"), Ref("data"))));

// Block all: throw for any effect
const denyAll = Fn(["effectId", "data"], Throw("denied"));

// Deny specific effect
function denyEffect(id: string) {
  return Fn(
    ["effectId", "data"],
    If(Eq(Ref("effectId"), Q(id)), Throw(id), Eval("dispatch", Arr(Ref("effectId"), Ref("data")))),
  );
}

// Transform data: always pass specific data to next
function transformData(newData: unknown) {
  return Fn(["effectId", "data"], Eval("dispatch", Arr(Ref("effectId"), Q(newData))));
}

// Short-circuit: return a value without calling next
const shortCircuit = Fn(["effectId", "data"], Q("intercepted"));

describe("Scope-local dispatch semantics", () => {
  // SLD-1
  it("allow-all middleware forwards effectId and data to next", function* () {
    let forwardedId: string | null = null;
    let forwardedData: Val = null;
    const next = (eid: string, d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        forwardedId = eid;
        forwardedData = d;
        return "ok" as Val;
      },
    });

    const result = yield* evaluateMiddlewareFn(
      allowAll,
      "test.op",
      { input: 1 } as unknown as Val,
      next,
    );
    expect(forwardedId).toBe("test.op");
    expect(forwardedData).toEqual({ input: 1 });
    expect(result).toBe("ok");
  });

  // SLD-2
  it("deny-all middleware throws without calling next", function* () {
    let nextCalled = false;
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        nextCalled = true;
        return "ok" as Val;
      },
    });

    try {
      yield* evaluateMiddlewareFn(denyAll, "test.op", null, next);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("denied");
      expect(nextCalled).toBe(false);
    }
  });

  // SLD-3
  it("conditional middleware allows non-blocked effects", function* () {
    const deny = denyEffect("blocked.op");
    let called = false;
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        called = true;
        return "allowed" as Val;
      },
    });

    const result = yield* evaluateMiddlewareFn(deny, "allowed.op", null, next);
    expect(called).toBe(true);
    expect(result).toBe("allowed");
  });

  // SLD-4
  it("conditional middleware blocks specific effect", function* () {
    const deny = denyEffect("blocked.op");
    let called = false;
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        called = true;
        return "ok" as Val;
      },
    });

    try {
      yield* evaluateMiddlewareFn(deny, "blocked.op", null, next);
      expect.unreachable("should have thrown");
    } catch {
      expect(called).toBe(false);
    }
  });

  // SLD-5
  it("short-circuit middleware returns value without calling next", function* () {
    let called = false;
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        called = true;
        return "from-next" as Val;
      },
    });

    const result = yield* evaluateMiddlewareFn(shortCircuit, "test.op", null, next);
    expect(result).toBe("intercepted");
    expect(called).toBe(false);
  });

  // SLD-6
  it("middleware transforms data before forwarding to next", function* () {
    const transform = transformData({ transformed: true });
    let receivedData: Val = null;
    const next = (_eid: string, d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        receivedData = d;
        return "ok" as Val;
      },
    });

    yield* evaluateMiddlewareFn(transform, "test.op", { original: true } as unknown as Val, next);
    expect(receivedData).toEqual({ transformed: true });
  });

  // SLD-9
  it("return value from next flows back as result of evaluateMiddlewareFn", function* () {
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        return "from-agent" as Val;
      },
    });

    const result = yield* evaluateMiddlewareFn(allowAll, "test.op", null, next);
    expect(result).toBe("from-agent");
  });

  // SLD-10
  it("error thrown by next propagates through evaluateMiddlewareFn", function* () {
    const next = (_eid: string, _d: Val): Operation<Val> => ({
      *[Symbol.iterator]() {
        throw new Error("agent-error");
      },
    });

    try {
      yield* evaluateMiddlewareFn(allowAll, "test.op", null, next);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("agent-error");
    }
  });
});
