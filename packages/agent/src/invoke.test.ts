import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { agent, operation, implementAgent, invoke } from "./index.js";

describe("invoke", () => {
  it("dispatches through installed middleware", function* () {
    const math = agent("math", {
      double: operation<{ value: number }, number>(),
    });

    const impl = implementAgent(math, {
      *double({ value }) {
        return value * 2;
      },
    });

    yield* impl.install();

    const result = yield* invoke(math.double({ value: 21 }));
    expect(result).toBe(42);
  });

  it("propagates errors from dispatch", function* () {
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
      yield* invoke(failing.boom());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("kaboom");
    }
  });
});
