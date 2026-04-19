import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { agent, operation, implementAgent } from "./index.js";
import { dispatch } from "@tisyn/effects";

describe("dispatch", () => {
  it("routes a call descriptor through installed middleware", function* () {
    const math = agent("math", {
      double: operation<{ value: number }, number>(),
    });

    const impl = implementAgent(math, {
      *double({ value }) {
        return value * 2;
      },
    });

    yield* impl.install();

    const result = yield* dispatch(math.double({ value: 21 }));
    expect(result).toBe(42);
  });

  it("propagates errors from the handler", function* () {
    const failing = agent("failing", {
      boom: operation<void, never>(),
    });

    const impl = implementAgent(failing, {
      *boom() {
        throw new Error("kaboom");
      },
    });

    yield* impl.install();

    try {
      yield* dispatch(failing.boom());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("kaboom");
    }
  });
});
