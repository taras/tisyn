/**
 * Runtime integration tests for try/catch/finally.
 *
 * Verifies that EffectError (thrown when an effect fails) is catchable
 * by a surrounding try/catch at the IR level.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { EffectError } from "./errors.js";
import { Dispatch } from "@tisyn/agent";
import { Try, Ref } from "@tisyn/ir";

// ── IR helpers ──

function effectIR(agentType: string, opName: string, data: unknown = []) {
  return { tisyn: "eval", id: `${agentType}.${opName}`, data };
}

// ── Tests ──

describe("try/catch runtime integration", () => {
  it("catches EffectError from a failing effect", function* () {
    // Effect always fails with an error
    yield* Dispatch.around({
      *dispatch([_effectId, _data]: [string, unknown]) {
        throw new Error("service unavailable");
      },
    });

    // try { effect("svc.op") } catch (e) { e }
    const ir = Try(effectIR("svc", "op") as never, "e", Ref("e") as never);

    const { result } = yield* execute({ ir: ir as never });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // The catch body returns the error message string via errorToValue
      expect(result.value).toBe("service unavailable");
    }
  });

  it("does not catch when body succeeds — result is body value", function* () {
    // Effect always succeeds
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([_effectId, _data]: [string, unknown]) {
        return 42;
      },
    });

    // try { effect("svc.op") } catch (e) { Ref("e") } — body succeeds, so result = 42
    const ir = Try(effectIR("svc", "op") as never, "e", Ref("e") as never);

    const { result } = yield* execute({ ir: ir as never });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(42);
    }
  });

  it("runs finally when body succeeds — finally result discarded", function* () {
    let finallyCalled = false;

    // Effect always succeeds; use a second effect as side-channel for "finally ran"
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([effectId, _data]: [string, unknown]) {
        if ((effectId as string).includes("finally")) {
          finallyCalled = true;
          return null;
        }
        return 99;
      },
    });

    // try { effect("svc.op") } finally { effect("svc.finally") }
    const ir = Try(
      effectIR("svc", "op") as never,
      undefined,
      undefined,
      effectIR("svc", "finally") as never,
    );

    const { result } = yield* execute({ ir: ir as never });

    expect(finallyCalled).toBe(true);
    // Body result is 99; finally result discarded
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(99);
    }
  });

  it("EffectError is re-exported from @tisyn/runtime", function* () {
    // Verifies that EffectError (moved to @tisyn/kernel) is still accessible
    // via @tisyn/runtime's errors module.
    const err = new EffectError("test message", "TestError");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("test message");
  });

  it("finallyPayload: finally env receives body outcome value when body succeeds", function* () {
    let capturedValue: unknown = "NOT_CAPTURED";

    yield* Dispatch.around({
      *dispatch([effectId, data]: [string, unknown]) {
        if (effectId === "cap.capture") {
          capturedValue = data;
          return null;
        }
        return 77; // body effect
      },
    });

    // Try body: effect returns 77
    // Finally: capture Ref("fp_0") — should receive 77 (the body outcome value)
    const ir = Try(
      effectIR("svc", "op") as never,
      undefined,
      undefined,
      { tisyn: "eval", id: "cap.capture", data: { tisyn: "ref", name: "fp_0" } } as never,
      "fp_0",
    );

    yield* execute({ ir: ir as never });
    expect(capturedValue).toBe(77);
  });

  it("finallyPayload: finally env receives catch outcome value when body throws", function* () {
    let capturedValue: unknown = "NOT_CAPTURED";

    yield* Dispatch.around({
      *dispatch([effectId, data]: [string, unknown]) {
        if (effectId === "cap.capture") {
          capturedValue = data;
          return null;
        }
        // body effect throws
        throw new Error("body failure");
      },
    });

    // Try body: effect throws; catch returns 88; finally captures Ref("fp_0") = 88
    const ir = Try(
      effectIR("svc", "op") as never,
      "e",
      88 as never, // catch body: literal 88
      { tisyn: "eval", id: "cap.capture", data: { tisyn: "ref", name: "fp_0" } } as never,
      "fp_0",
    );

    yield* execute({ ir: ir as never });
    expect(capturedValue).toBe(88);
  });

  it("finallyDefault: finally runs with pre-trial value on uncaught-error path (no catch)", function* () {
    // Regression test for: UnboundVariable(fp) when body throws with no catch clause.
    // When outcome.ok = false and finallyDefault is present, the kernel must bind
    // finallyPayload to the finallyDefault value so the Let-unpack in finally does not fail.
    let capturedValue: unknown = "NOT_CAPTURED";

    yield* Dispatch.around({
      *dispatch([effectId, data]: [string, unknown]) {
        if (effectId === "cap.capture") {
          capturedValue = data;
          return null;
        }
        // body effect throws — no catch clause
        throw new Error("body failure");
      },
    });

    // IR equivalent of: try { effect() } finally { capture(fp_0) }
    // with finallyPayload = "fp_0" and finallyDefault = literal 0.
    // On error path, kernel must bind fp_0 = 0 (from finallyDefault) and run finally.
    const ir = Try(
      effectIR("svc", "op") as never,
      undefined,
      undefined,
      { tisyn: "eval", id: "cap.capture", data: { tisyn: "ref", name: "fp_0" } } as never,
      "fp_0",
      0 as never, // finallyDefault = literal 0 (pre-trial snapshot)
    );

    yield* execute({ ir: ir as never });
    expect(capturedValue).toBe(0);
  });

  it("regression: no finallyPayload — finally still runs in pre-try env", function* () {
    let finallyCalled = false;

    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([effectId]: [string, unknown]) {
        if (effectId === "cap.finally") {
          finallyCalled = true;
          return null;
        }
        return 55;
      },
    });

    // No finallyPayload — plain finally, classic behavior
    const ir = Try(
      effectIR("svc", "op") as never,
      undefined,
      undefined,
      effectIR("cap", "finally") as never,
    );

    const { result } = yield* execute({ ir: ir as never });
    expect(finallyCalled).toBe(true);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(55);
    }
  });
});
