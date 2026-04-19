import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped, sleep, spawn } from "effection";
import type { Val } from "@tisyn/ir";
import { dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import { ProgressContext, CoroutineContext } from "@tisyn/transport";
import type { ProgressEvent, HostMessage, AgentTransportFactory } from "@tisyn/transport";
import { CodeAgent } from "./code-agent.js";
import { createMockCodeAgentTransport } from "./mock.js";

describe("CodeAgent contract (mock harness)", () => {
  it("newSession returns SessionHandle shape", function* () {
    const { factory } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      const handle = yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);

      expect(handle).toEqual({ sessionId: "s-1" });
    });
  });

  it("closeSession returns null", function* () {
    const { factory } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);

      const result = yield* dispatch("code-agent.closeSession", {
        handle: { sessionId: "s-1" },
      } as unknown as Val);

      expect(result).toBeNull();
    });
  });

  it("prompt returns PromptResult shape", function* () {
    const { factory } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      prompt: { result: { response: "Analysis complete." } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);

      const result = yield* dispatch("code-agent.prompt", {
        args: { session: { sessionId: "s-1" }, prompt: "Analyze the code" },
      } as unknown as Val);

      expect(result).toEqual({ response: "Analysis complete." });
    });
  });

  it("progress events forwarded before result", function* () {
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root");

    const { factory } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      prompt: {
        progress: [
          { type: "text", content: "Thinking..." },
          { type: "text", content: "Almost done..." },
        ],
        result: { response: "Done" },
      },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);
      yield* dispatch("code-agent.prompt", {
        args: { session: { sessionId: "s-1" }, prompt: "Analyze" },
      } as unknown as Val);
    });

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].value).toEqual({
      type: "text",
      content: "Thinking...",
    });
    expect(progressEvents[1].value).toEqual({
      type: "text",
      content: "Almost done...",
    });
  });

  it("error propagation from prompt", function* () {
    const { factory } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      prompt: { error: { message: "session expired", name: "SessionError" } },
      closeSession: { result: null },
    });

    let caughtError: Error | null = null;

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);

      try {
        yield* dispatch("code-agent.prompt", {
          args: { session: { sessionId: "s-1" }, prompt: "Do something" },
        } as unknown as Val);
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("session expired");
  });

  it("cancellation halts in-flight prompt", function* () {
    const messages: HostMessage[] = [];

    const { factory: innerFactory } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      prompt: { neverComplete: true },
      closeSession: { result: null },
    });

    const recordingFactory = function* () {
      const transport = yield* innerFactory();
      return {
        *send(msg: HostMessage) {
          messages.push(msg);
          yield* transport.send(msg);
        },
        receive: transport.receive,
      };
    };

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, recordingFactory as AgentTransportFactory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);

      const task = yield* spawn(function* () {
        yield* dispatch("code-agent.prompt", {
          args: { session: { sessionId: "s-1" }, prompt: "Long task" },
        } as unknown as Val);
      });

      yield* sleep(10);
      yield* task.halt();
    });

    const cancelMsg = messages.find((m) => m.method === "cancel");
    expect(cancelMsg).toBeDefined();
  });

  it("fork returns ForkData and openFork returns SessionHandle", function* () {
    const { factory, calls } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-parent" } },
      fork: { result: { parentSessionId: "s-parent", forkId: "f-1" } },
      openFork: { result: { sessionId: "s-child" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);

      const forkData = yield* dispatch("code-agent.fork", {
        session: { sessionId: "s-parent" },
      } as unknown as Val);
      expect(forkData).toEqual({ parentSessionId: "s-parent", forkId: "f-1" });

      const childHandle = yield* dispatch("code-agent.openFork", {
        data: forkData,
      } as unknown as Val);
      expect(childHandle).toEqual({ sessionId: "s-child" });
    });

    expect(calls.find((c) => c.operation === "fork")).toBeDefined();
    expect(calls.find((c) => c.operation === "openFork")).toBeDefined();
  });

  it("fork/openFork can return NotSupported error", function* () {
    const { factory } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      fork: { error: { message: "fork is not supported", name: "NotSupported" } },
      closeSession: { result: null },
    });

    let caughtError: Error | null = null;

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);

      try {
        yield* dispatch("code-agent.fork", {
          session: { sessionId: "s-1" },
        } as unknown as Val);
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("fork is not supported");
  });

  it("call recording tracks dispatched operations", function* () {
    const { factory, calls } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      prompt: { result: { response: "done" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch("code-agent.newSession", {
        config: { model: "test" },
      } as unknown as Val);
      yield* dispatch("code-agent.prompt", {
        args: { session: { sessionId: "s-1" }, prompt: "task" },
      } as unknown as Val);
      yield* dispatch("code-agent.closeSession", {
        handle: { sessionId: "s-1" },
      } as unknown as Val);
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].operation).toBe("newSession");
    expect(calls[1].operation).toBe("prompt");
    expect(calls[2].operation).toBe("closeSession");
  });
});
