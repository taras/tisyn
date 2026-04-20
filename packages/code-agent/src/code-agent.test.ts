import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped, sleep, spawn } from "effection";
import { dispatch } from "@tisyn/effects";
import { installRemoteAgent } from "@tisyn/transport";
import { ProgressContext, CoroutineContext } from "@tisyn/transport";
import type { ProgressEvent, HostMessage, AgentTransportFactory } from "@tisyn/transport";
import { CodeAgent } from "./code-agent.js";
import { createMockCodeAgentTransport } from "./mock.js";

describe("CodeAgent contract (mock harness)", () => {
  it("newSession forwards the direct config payload and returns SessionHandle", function* () {
    const { factory, calls } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      const handle = yield* dispatch(CodeAgent.newSession({ model: "test" }));

      expect(handle).toEqual({ sessionId: "s-1" });
    });

    expect(calls[0]).toEqual({ operation: "newSession", args: { model: "test" } });
  });

  it("closeSession forwards the direct session-handle payload and returns null", function* () {
    const { factory, calls } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch(CodeAgent.newSession({ model: "test" }));

      const result = yield* dispatch(CodeAgent.closeSession({ sessionId: "s-1" }));

      expect(result).toBeNull();
    });

    expect(calls[1]).toEqual({ operation: "closeSession", args: { sessionId: "s-1" } });
  });

  it("prompt forwards the direct { session, prompt } payload and returns PromptResult", function* () {
    const { factory, calls } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      prompt: { result: { response: "Analysis complete." } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch(CodeAgent.newSession({ model: "test" }));

      const result = yield* dispatch(
        CodeAgent.prompt({
          session: { sessionId: "s-1" },
          prompt: "Analyze the code",
        }),
      );

      expect(result).toEqual({ response: "Analysis complete." });
    });

    expect(calls[1]).toEqual({
      operation: "prompt",
      args: { session: { sessionId: "s-1" }, prompt: "Analyze the code" },
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

      yield* dispatch(CodeAgent.newSession({ model: "test" }));
      yield* dispatch(
        CodeAgent.prompt({
          session: { sessionId: "s-1" },
          prompt: "Analyze",
        }),
      );
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

      yield* dispatch(CodeAgent.newSession({ model: "test" }));

      try {
        yield* dispatch(
          CodeAgent.prompt({
            session: { sessionId: "s-1" },
            prompt: "Do something",
          }),
        );
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

      yield* dispatch(CodeAgent.newSession({ model: "test" }));

      const task = yield* spawn(function* () {
        yield* dispatch(
          CodeAgent.prompt({
            session: { sessionId: "s-1" },
            prompt: "Long task",
          }),
        );
      });

      yield* sleep(10);
      yield* task.halt();
    });

    const cancelMsg = messages.find((m) => m.method === "cancel");
    expect(cancelMsg).toBeDefined();
  });

  it("fork forwards the direct session payload and openFork forwards the fork data directly", function* () {
    const { factory, calls } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-parent" } },
      fork: { result: { parentSessionId: "s-parent", forkId: "f-1" } },
      openFork: { result: { sessionId: "s-child" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch(CodeAgent.newSession({ model: "test" }));

      const forkData = yield* dispatch(CodeAgent.fork({ sessionId: "s-parent" }));
      expect(forkData).toEqual({ parentSessionId: "s-parent", forkId: "f-1" });

      const childHandle = yield* dispatch(CodeAgent.openFork(forkData));
      expect(childHandle).toEqual({ sessionId: "s-child" });
    });

    const forkCall = calls.find((c) => c.operation === "fork");
    expect(forkCall?.args).toEqual({ sessionId: "s-parent" });

    const openForkCall = calls.find((c) => c.operation === "openFork");
    expect(openForkCall?.args).toEqual({ parentSessionId: "s-parent", forkId: "f-1" });
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

      yield* dispatch(CodeAgent.newSession({ model: "test" }));

      try {
        yield* dispatch(CodeAgent.fork({ sessionId: "s-1" }));
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("fork is not supported");
  });

  it("call recording captures direct payloads for every dispatched operation", function* () {
    const { factory, calls } = createMockCodeAgentTransport({
      newSession: { result: { sessionId: "s-1" } },
      prompt: { result: { response: "done" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(CodeAgent, factory);

      yield* dispatch(CodeAgent.newSession({ model: "test" }));
      yield* dispatch(
        CodeAgent.prompt({
          session: { sessionId: "s-1" },
          prompt: "task",
        }),
      );
      yield* dispatch(CodeAgent.closeSession({ sessionId: "s-1" }));
    });

    expect(calls).toEqual([
      { operation: "newSession", args: { model: "test" } },
      {
        operation: "prompt",
        args: { session: { sessionId: "s-1" }, prompt: "task" },
      },
      { operation: "closeSession", args: { sessionId: "s-1" } },
    ]);
  });
});
