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
    const ir = Try(
      effectIR("svc", "op") as never,
      "e",
      Ref("e") as never,
    );

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
    const ir = Try(
      effectIR("svc", "op") as never,
      "e",
      Ref("e") as never,
    );

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
});
