import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import {
  agent,
  operation,
  implementAgent,
  invoke,
  Effects,
  InvalidInvokeCallSiteError,
} from "./index.js";
import { Fn, Q } from "@tisyn/ir";
import type { FnNode, Val } from "@tisyn/ir";
import { execute } from "@tisyn/runtime";

const asFn = (f: unknown): FnNode => f as FnNode;

describe("@tisyn/agent", () => {
  it("host-side method constructs invocation data", function* () {
    const math = agent("math", {
      double: operation<{ value: number }, number>(),
    });

    expect(math.double({ value: 2 })).toEqual({
      effectId: "math.double",
      data: { value: 2 },
    });
  });

  it("declares, installs, and dispatches an implemented agent", function* () {
    const math = agent("math", {
      double: operation<{ value: number }, number>(),
    });

    const impl = implementAgent(math, {
      *double({ value }) {
        return value * 2;
      },
    });

    yield* impl.install();

    const { result } = yield* execute({
      ir: {
        tisyn: "eval",
        id: "math.double",
        data: { value: 21 },
      } as never,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(42);
    }
  });

  it("calls a bound operation directly via call()", function* () {
    const math = agent("math", {
      double: operation<{ value: number }, number>(),
    });

    const impl = implementAgent(math, {
      *double({ value }) {
        return value * 2;
      },
    });

    const result = yield* impl.call("double", { value: 21 });
    expect(result).toBe(42);
  });

  it("impl.call() handler isolation: invoke from handler under a live DispatchContext throws", function* () {
    const helper = agent("helper-impl-call-isolation", {
      run: operation<null, Val>(),
    });
    const bodyFn = Fn<[], Val>([], Q(null));

    let caughtErr: Error | null = null;

    const impl = implementAgent(helper, {
      *run() {
        try {
          yield* invoke<Val>(asFn(bodyFn), []);
        } catch (err) {
          caughtErr = err as Error;
        }
        return null as Val;
      },
    });

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* impl.call("run", null);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    yield* execute({
      ir: { tisyn: "eval", id: "parent.trigger", data: [] } as never,
    });

    expect(caughtErr).toBeInstanceOf(InvalidInvokeCallSiteError);
  });

  it("fails cleanly for unknown operation", function* () {
    const math = agent("math", {
      double: operation<{ value: number }, number>(),
    });

    const impl = implementAgent(math, {
      *double({ value }) {
        return value * 2;
      },
    });

    yield* impl.install();

    const { result } = yield* execute({
      ir: {
        tisyn: "eval",
        id: "math.missing",
        data: { value: 21 },
      } as never,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("no handler");
    }
  });
});
