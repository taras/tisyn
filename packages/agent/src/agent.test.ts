import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { agent, operation, implementAgent } from "./index.js";
import { execute } from "@tisyn/runtime";

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
