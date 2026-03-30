/**
 * Adversarial / edge-case tests.
 *
 * NEG-1:  useAgent throws descriptive error when agent not bound
 * NEG-3:  dispatch with no handler throws "No agent registered"
 * NEG-4:  enforcement denial propagates as error (not swallowed)
 * NEG-6:  enforcement receives the correct effectId and data
 * NEG-7:  enforcement can modify effectId before forwarding to inner
 * NEG-8:  multiple dispatches with enforcement — each dispatch goes through enforcement
 * NEG-9:  BoundAgentsContext is null by default (no bound agents without useTransport)
 * NEG-10: useAgent with agent not in BoundAgentsContext still throws
 * NEG-11: useAgent returns typed handle when agent is bound
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { useScope } from "effection";
import type { Val } from "@tisyn/ir";
import { Dispatch, dispatch, installEnforcement, useAgent, BoundAgentsContext } from "@tisyn/agent";
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

  // NEG-4
  it("enforcement denial error propagates — not swallowed", function* () {
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([_e, _d]: [string, Val]) {
        return "core" as Val;
      },
    });

    yield* installEnforcement(function* (_effectId, _data, _inner) {
      throw new Error("enforcement-denied");
    });

    try {
      yield* dispatch("test.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("enforcement-denied");
    }
  });

  // NEG-6
  it("enforcement receives correct effectId and data", function* () {
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([_e, _d]: [string, Val]) {
        return "core" as Val;
      },
    });

    let capturedId: string | null = null;
    let capturedData: Val = null;

    yield* installEnforcement(function* (effectId, data, inner) {
      capturedId = effectId;
      capturedData = data;
      return yield* inner(effectId, data);
    });

    yield* dispatch("agent.op", { key: "val" } as unknown as Val);
    expect(capturedId).toBe("agent.op");
    expect(capturedData).toEqual({ key: "val" });
  });

  // NEG-7
  it("enforcement can modify effectId before forwarding to inner chain", function* () {
    let seenInCore: string | null = null;
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([e, _d]: [string, Val]) {
        seenInCore = e;
        return "ok" as Val;
      },
    });

    yield* installEnforcement(function* (_effectId, data, inner) {
      return yield* inner("replaced.op", data);
    });

    yield* dispatch("original.op", null);
    expect(seenInCore).toBe("replaced.op");
  });

  // NEG-8
  it("each dispatch call goes through enforcement", function* () {
    let enforcementCallCount = 0;
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([_e, _d]: [string, Val]) {
        return "ok" as Val;
      },
    });

    yield* installEnforcement(function* (effectId, data, inner) {
      enforcementCallCount++;
      return yield* inner(effectId, data);
    });

    yield* dispatch("op1", null);
    yield* dispatch("op2", null);
    yield* dispatch("op3", null);

    expect(enforcementCallCount).toBe(3);
  });

  // NEG-9
  it("BoundAgentsContext is null by default", function* () {
    const scope = yield* useScope();
    const bound = scope.hasOwn(BoundAgentsContext) ? scope.expect(BoundAgentsContext) : null;
    expect(bound).toBeNull();
  });

  // NEG-10
  it("useAgent throws for agent not in BoundAgentsContext", function* () {
    const scope = yield* useScope();
    const boundSet = new Set(["other-agent"]);
    scope.set(BoundAgentsContext, boundSet);

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

  // NEG-11
  it("useAgent returns typed handle when agent is bound in BoundAgentsContext", function* () {
    const scope = yield* useScope();
    scope.set(BoundAgentsContext, new Set(["echo-agent"]));

    // Install a handler that echoes data back
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([_e, d]: [string, Val]) {
        return d;
      },
    });

    const EchoAgent: AgentDeclaration<{ echo: OperationSpec<string, string> }> = {
      id: "echo-agent",
      operations: { echo: {} },
    };

    const handle = yield* useAgent(EchoAgent);
    expect(handle).toBeDefined();
    expect(typeof handle.echo).toBe("function");

    const result = yield* handle.echo("hello");
    expect(result).toBe("hello");
  });
});
