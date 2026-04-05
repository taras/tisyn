/**
 * Adversarial / edge-case tests.
 *
 * NEG-1:  useAgent throws descriptive error when agent not bound
 * NEG-3:  dispatch with no handler throws "No agent registered"
 * NEG-4:  outermost middleware denial propagates as error (not swallowed)
 * NEG-6:  outermost middleware receives the correct effectId and data
 * NEG-7:  outermost middleware can modify effectId before forwarding
 * NEG-8:  multiple dispatches with middleware — each dispatch goes through middleware
 * NEG-10: useAgent throws when a different agent is bound (not the requested one)
 * NEG-11: useAgent returns typed handle when agent is bound via Agents.use()
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import type { Val } from "@tisyn/ir";
import {
  Effects,
  dispatch,
  useAgent,
  Agents,
  agent,
  operation,
  implementAgent,
} from "@tisyn/agent";
import type { AgentDeclaration, OperationSpec } from "@tisyn/agent";

describe("Adversarial / edge cases", () => {
  // NEG-1
  it("useAgent throws descriptive error when agent is not bound", function* () {
    const TestAgent: AgentDeclaration<{ op: OperationSpec<null, string> }> = {
      id: "test-agent",
      operations: { op: {} },
    };

    try {
      yield* useAgent(TestAgent);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("test-agent");
      expect((error as Error).message).toContain("not bound");
    }
  });

  // NEG-3
  it("dispatch with no handler throws descriptive error", function* () {
    try {
      yield* dispatch("unregistered.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("unregistered.op");
    }
  });

  // NEG-4: outermost middleware denial propagates as error
  it("outermost middleware denial error propagates — not swallowed", function* () {
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([_e, _d]: [string, Val], _next) {
        throw new Error("middleware-denied");
      },
    });

    try {
      yield* dispatch("test.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("middleware-denied");
    }
  });

  // NEG-6: outermost middleware receives correct effectId and data
  it("outermost middleware receives correct effectId and data", function* () {
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    let capturedId: string | null = null;
    let capturedData: Val = null;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        capturedId = effectId;
        capturedData = data;
        return yield* next(effectId, data);
      },
    });

    yield* dispatch("agent.op", { key: "val" } as unknown as Val);
    expect(capturedId).toBe("agent.op");
    expect(capturedData).toEqual({ key: "val" });
  });

  // NEG-7: outermost middleware can modify effectId before forwarding
  it("outermost middleware can modify effectId before forwarding", function* () {
    let seenInCore: string | null = null;
    yield* Effects.around(
      {
        *dispatch([e, _d]: [string, Val]) {
          seenInCore = e;
          return "ok" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([_e, d]: [string, Val], next) {
        return yield* next("replaced.op", d);
      },
    });

    yield* dispatch("original.op", null);
    expect(seenInCore).toBe("replaced.op");
  });

  // NEG-8: each dispatch goes through middleware
  it("each dispatch call goes through middleware", function* () {
    let mwCallCount = 0;
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return "ok" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        mwCallCount++;
        return yield* next(e, d);
      },
    });

    yield* dispatch("op1", null);
    yield* dispatch("op2", null);
    yield* dispatch("op3", null);

    expect(mwCallCount).toBe(3);
  });

  // NEG-10: useAgent throws when a different agent is bound
  it("useAgent throws for agent not bound even when another agent is", function* () {
    const OtherAgent = agent("other-agent", {
      run: operation<null, string>(),
    });

    const otherImpl = implementAgent(OtherAgent, {
      *run() {
        return "ok";
      },
    });

    yield* Agents.use(OtherAgent, otherImpl);

    const MyAgent: AgentDeclaration<{ go: OperationSpec<null, string> }> = {
      id: "my-agent",
      operations: { go: {} },
    };

    try {
      yield* useAgent(MyAgent);
      expect.unreachable("should throw");
    } catch (error) {
      expect((error as Error).message).toContain("my-agent");
    }
  });

  // NEG-11: useAgent returns typed handle when agent is bound
  it("useAgent returns typed handle when agent is bound via Agents.use()", function* () {
    const EchoAgent = agent("echo-agent", {
      echo: operation<string, string>(),
    });

    const impl = implementAgent(EchoAgent, {
      *echo(data: string) {
        return data;
      },
    });

    yield* Agents.use(EchoAgent, impl);

    const handle = yield* useAgent(EchoAgent);
    expect(handle).toBeDefined();
    expect(typeof handle.echo).toBe("function");

    const result = yield* handle.echo("hello");
    expect(result).toBe("hello");
  });
});
