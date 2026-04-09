import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped, sleep, spawn } from "effection";
import { resolve } from "node:path";
import type { Val } from "@tisyn/ir";
import { agent, operation, dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import { ProgressContext, CoroutineContext } from "@tisyn/transport";
import type { ProgressEvent, AgentTransportFactory, HostMessage } from "@tisyn/transport";
import { createMockClaudeCodeTransport } from "./mock.js";
import { createBinding } from "./index.js";

const claudeCodeDeclaration = agent("claude-code", {
  openSession: operation<Val, Val>(),
  closeSession: operation<Val, Val>(),
  plan: operation<Val, Val>(),
  fork: operation<Val, Val>(),
  openFork: operation<Val, Val>(),
});

describe("Claude Code ACP Integration", () => {
  // 1. Session open/close lifecycle
  it("openSession returns handle and closeSession dispatches on scope exit", function* () {
    const { factory, calls } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-123" } },
      closeSession: { result: null },
    });

    let sessionHandle: Val = null;

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      // Simulate resource pattern: open, use, close
      sessionHandle = yield* dispatch("claude-code.openSession", {
        model: "opus-4",
      } as unknown as Val);
      expect(sessionHandle).toEqual({ sessionId: "s-123" });

      // Close session
      yield* dispatch("claude-code.closeSession", sessionHandle);
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].operation).toBe("openSession");
    expect(calls[1].operation).toBe("closeSession");
  });

  // 2. Durable plan result
  it("plan call returns final result", function* () {
    const { factory } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-123" } },
      plan: {
        result: {
          response: "Here is the implementation plan...",
          toolResults: [{ tool: "read_file", output: "contents" }],
        },
      },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);

      const result = yield* dispatch("claude-code.plan", {
        session: { sessionId: "s-123" },
        prompt: "Implement the auth module",
      } as unknown as Val);

      expect(result).toEqual({
        response: "Here is the implementation plan...",
        toolResults: [{ tool: "read_file", output: "contents" }],
      });
    });
  });

  // 3. Sequential plan calls
  it("two sequential plan calls on same session both return results", function* () {
    const { factory } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-123" } },
      plan: {
        result: { response: "plan result" },
      },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);

      const result1 = yield* dispatch("claude-code.plan", {
        session: { sessionId: "s-123" },
        prompt: "First task",
      } as unknown as Val);
      expect(result1).toEqual({ response: "plan result" });

      const result2 = yield* dispatch("claude-code.plan", {
        session: { sessionId: "s-123" },
        prompt: "Second task",
      } as unknown as Val);
      expect(result2).toEqual({ response: "plan result" });
    });
  });

  // 4. Progress is observable via ProgressContext
  it("plan emits progress observable via ProgressContext", function* () {
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root");

    const { factory } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-123" } },
      plan: {
        progress: [
          { type: "text", content: "Analyzing codebase..." },
          { type: "tool_use", tool: "read_file", input: { path: "src/main.ts" } },
        ],
        result: { response: "Done" },
      },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);
      yield* dispatch("claude-code.plan", {
        session: { sessionId: "s-123" },
        prompt: "Analyze",
      } as unknown as Val);
    });

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].value).toEqual({
      type: "text",
      content: "Analyzing codebase...",
    });
    expect(progressEvents[1].effectId).toBe("claude-code.plan");
  });

  // 5. Fork metadata round-trip
  it("fork returns ForkData and openFork returns child handle", function* () {
    const { factory, calls } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-parent" } },
      fork: { result: { parentSessionId: "s-parent", forkId: "f-1" } },
      openFork: { result: { sessionId: "s-child" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);

      const forkData = yield* dispatch("claude-code.fork", {
        sessionId: "s-parent",
      } as unknown as Val);
      expect(forkData).toEqual({ parentSessionId: "s-parent", forkId: "f-1" });

      const childHandle = yield* dispatch("claude-code.openFork", forkData);
      expect(childHandle).toEqual({ sessionId: "s-child" });
    });

    expect(calls.find((c) => c.operation === "fork")).toBeDefined();
    expect(calls.find((c) => c.operation === "openFork")).toBeDefined();
  });

  // 6. Error propagation from plan call
  it("plan error propagates to caller", function* () {
    const { factory } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-123" } },
      plan: { error: { message: "session expired", name: "SessionError" } },
      closeSession: { result: null },
    });

    let caughtError: Error | null = null;

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);

      try {
        yield* dispatch("claude-code.plan", {
          session: { sessionId: "s-123" },
          prompt: "Do something",
        } as unknown as Val);
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("session expired");
  });

  // 7. Cancellation sends cancel notification
  it("cancellation sends cancel notification to agent", function* () {
    const messages: HostMessage[] = [];

    const { factory: innerFactory } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-123" } },
      plan: { neverComplete: true },
      closeSession: { result: null },
    });

    // Wrap factory to record all host→agent messages
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
      yield* installRemoteAgent(claudeCodeDeclaration, recordingFactory as AgentTransportFactory);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);

      // Spawn a plan call that will never complete
      const task = yield* spawn(function* () {
        yield* dispatch("claude-code.plan", {
          session: { sessionId: "s-123" },
          prompt: "Long running task",
        } as unknown as Val);
      });

      // Give the dispatch a chance to start
      yield* sleep(10);

      // Halt the task — triggers cancel notification
      yield* task.halt();
    });

    const cancelMsg = messages.find((m) => m.method === "cancel");
    expect(cancelMsg).toBeDefined();
  });

  // 8. Transport survival: second openSession after first closes
  it("transport survives session close — second openSession works", function* () {
    const { factory, calls } = createMockClaudeCodeTransport({
      openSession: { result: { sessionId: "s-new" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      // First session lifecycle
      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);
      yield* dispatch("claude-code.closeSession", { sessionId: "s-new" } as unknown as Val);

      // Second session through the same transport
      const handle2 = yield* dispatch("claude-code.openSession", {
        model: "opus-4",
      } as unknown as Val);
      expect(handle2).toEqual({ sessionId: "s-new" });
    });

    // Three calls: open, close, open
    const openCalls = calls.filter((c) => c.operation === "openSession");
    const closeCalls = calls.filter((c) => c.operation === "closeSession");
    expect(openCalls).toHaveLength(2);
    expect(closeCalls).toHaveLength(1);
  });
});

// ── Binding-path tests (real adapter + mock ACP subprocess) ──

const mockAcpServer = resolve(import.meta.dirname, "test-assets/mock-acp-server.ts");

describe("Claude Code ACP Binding Path", () => {
  it("createBinding completes initialize handshake and dispatches openSession", function* () {
    const binding = createBinding({
      command: "npx",
      arguments: ["tsx", mockAcpServer],
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);

      const handle = yield* dispatch("claude-code.openSession", {
        model: "opus-4",
      } as unknown as Val);
      expect(handle).toEqual({ sessionId: "test-session-1" });
    });
  });

  it("createBinding routes plan calls through ACP subprocess", function* () {
    const binding = createBinding({
      command: "npx",
      arguments: ["tsx", mockAcpServer],
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);

      const result = yield* dispatch("claude-code.plan", {
        session: { sessionId: "test-session-1" },
        prompt: "Implement auth",
      } as unknown as Val);

      expect(result).toEqual({
        response: "mock plan result for: Implement auth",
      });
    });
  });

  it("createBinding supports sequential operations through same subprocess", function* () {
    const binding = createBinding({
      command: "npx",
      arguments: ["tsx", mockAcpServer],
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);

      yield* dispatch("claude-code.openSession", { model: "opus-4" } as unknown as Val);

      const r1 = yield* dispatch("claude-code.plan", {
        session: { sessionId: "test-session-1" },
        prompt: "Task 1",
      } as unknown as Val);
      expect(r1).toEqual({ response: "mock plan result for: Task 1" });

      const r2 = yield* dispatch("claude-code.plan", {
        session: { sessionId: "test-session-1" },
        prompt: "Task 2",
      } as unknown as Val);
      expect(r2).toEqual({ response: "mock plan result for: Task 2" });

      yield* dispatch("claude-code.closeSession", {
        sessionId: "test-session-1",
      } as unknown as Val);
    });
  });
});
