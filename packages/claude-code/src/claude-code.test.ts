import { describe, it } from "@effectionx/vitest";
import { expect, vi } from "vitest";
import { scoped, sleep, spawn } from "effection";
import { resolve } from "node:path";
import type { Val } from "@tisyn/ir";
import { agent, operation } from "@tisyn/agent";
import { dispatch } from "@tisyn/effects";
import { installRemoteAgent } from "@tisyn/transport";
import { ProgressContext, CoroutineContext } from "@tisyn/transport";
import type { ProgressEvent, AgentTransportFactory, HostMessage } from "@tisyn/transport";
import { createMockClaudeCodeTransport } from "./mock.js";
import { createBinding } from "./index.js";
import { createSdkBinding } from "./sdk-adapter.js";
// Anchor the public type re-export so a missing `PromptResult` passthrough
// breaks the package's typecheck at a well-known boundary.
import type { PromptResult } from "@tisyn/claude-code";
type _PromptResultAnchor = PromptResult;

const claudeCodeDeclaration = agent("claude-code", {
  newSession: operation<Val, Val>(),
  closeSession: operation<Val, Val>(),
  plan: operation<Val, Val>(),
  prompt: operation<Val, Val>(),
  fork: operation<Val, Val>(),
  openFork: operation<Val, Val>(),
});

describe("Claude Code ACP Integration", () => {
  // 1. Session open/close lifecycle
  it("newSession returns handle and closeSession dispatches on scope exit", function* () {
    const { factory, calls } = createMockClaudeCodeTransport({
      newSession: { result: { sessionId: "s-123" } },
      closeSession: { result: null },
    });

    let sessionHandle: Val = null;

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      // Simulate resource pattern: open, use, close
      sessionHandle = yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));
      expect(sessionHandle).toEqual({ sessionId: "s-123" });

      // Close session
      yield* dispatch(claudeCodeDeclaration.closeSession( sessionHandle));
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].operation).toBe("newSession");
    expect(calls[1].operation).toBe("closeSession");
  });

  // 2. Durable plan result
  it("plan call returns final result", function* () {
    const { factory } = createMockClaudeCodeTransport({
      newSession: { result: { sessionId: "s-123" } },
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

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      const result = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: "s-123" }, prompt: "Implement the auth module",
      }));

      expect(result).toEqual({
        response: "Here is the implementation plan...",
        toolResults: [{ tool: "read_file", output: "contents" }],
      });
    });
  });

  // 2b. Portable prompt alias resolves identically to plan
  it("prompt resolves identically to plan via mock transport", function* () {
    const { factory } = createMockClaudeCodeTransport({
      newSession: { result: { sessionId: "s-123" } },
      prompt: {
        result: { response: "prompt result" },
      },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      const result = yield* dispatch(claudeCodeDeclaration.prompt( {
        session: { sessionId: "s-123" }, prompt: "Analyze code",
      }));

      expect(result).toEqual({ response: "prompt result" });
    });
  });

  // 3. Sequential plan calls
  it("two sequential plan calls on same session both return results", function* () {
    const { factory } = createMockClaudeCodeTransport({
      newSession: { result: { sessionId: "s-123" } },
      plan: {
        result: { response: "plan result" },
      },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      const result1 = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: "s-123" }, prompt: "First task",
      }));
      expect(result1).toEqual({ response: "plan result" });

      const result2 = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: "s-123" }, prompt: "Second task",
      }));
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
      newSession: { result: { sessionId: "s-123" } },
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

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));
      yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: "s-123" }, prompt: "Analyze",
      }));
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
      newSession: { result: { sessionId: "s-parent" } },
      fork: { result: { parentSessionId: "s-parent", forkId: "f-1" } },
      openFork: { result: { sessionId: "s-child" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      const forkData = yield* dispatch(claudeCodeDeclaration.fork( {
        sessionId: "s-parent",
      }));
      expect(forkData).toEqual({ parentSessionId: "s-parent", forkId: "f-1" });

      const childHandle = yield* dispatch(claudeCodeDeclaration.openFork( forkData));
      expect(childHandle).toEqual({ sessionId: "s-child" });
    });

    expect(calls.find((c) => c.operation === "fork")).toBeDefined();
    expect(calls.find((c) => c.operation === "openFork")).toBeDefined();
  });

  // 6. Error propagation from plan call
  it("plan error propagates to caller", function* () {
    const { factory } = createMockClaudeCodeTransport({
      newSession: { result: { sessionId: "s-123" } },
      plan: { error: { message: "session expired", name: "SessionError" } },
      closeSession: { result: null },
    });

    let caughtError: Error | null = null;

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      try {
        yield* dispatch(claudeCodeDeclaration.plan( {
          session: { sessionId: "s-123" }, prompt: "Do something",
        }));
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
      newSession: { result: { sessionId: "s-123" } },
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

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      // Spawn a plan call that will never complete
      const task = yield* spawn(function* () {
        yield* dispatch(claudeCodeDeclaration.plan( {
          session: { sessionId: "s-123" }, prompt: "Long running task",
        }));
      });

      // Give the dispatch a chance to start
      yield* sleep(10);

      // Halt the task — triggers cancel notification
      yield* task.halt();
    });

    const cancelMsg = messages.find((m) => m.method === "cancel");
    expect(cancelMsg).toBeDefined();
  });

  // 8. Transport survival: second newSession after first closes
  it("transport survives session close — second newSession works", function* () {
    const { factory, calls } = createMockClaudeCodeTransport({
      newSession: { result: { sessionId: "s-new" } },
      closeSession: { result: null },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, factory);

      // First session lifecycle
      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));
      yield* dispatch(claudeCodeDeclaration.closeSession( {
        sessionId: "s-new",
      }));

      // Second session through the same transport
      const handle2 = yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));
      expect(handle2).toEqual({ sessionId: "s-new" });
    });

    // Three calls: open, close, open
    const openCalls = calls.filter((c) => c.operation === "newSession");
    const closeCalls = calls.filter((c) => c.operation === "closeSession");
    expect(openCalls).toHaveLength(2);
    expect(closeCalls).toHaveLength(1);
  });
});

// ── Binding-path tests (real adapter + mock ACP subprocess) ──

const mockAcpServer = resolve(import.meta.dirname, "test-assets/mock-acp-server.ts");

describe("Claude Code ACP Binding Path", () => {
  it("createBinding completes initialize handshake and dispatches newSession", function* () {
    const binding = createBinding({
      command: "npx",
      arguments: ["tsx", mockAcpServer],
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);

      const handle = yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));
      expect(handle).toEqual({ sessionId: "test-session-1" });
    });
  });

  it("adapter forwards plan payload to ACP subprocess as top-level params", function* () {
    const binding = createBinding({
      command: "npx",
      arguments: ["tsx", mockAcpServer],
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      // The compiler now emits the unwrapped payload directly. The adapter
      // forwards { session, prompt } as ACP params so the mock server reads
      // prompt at top level.
      const result = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: "test-session-1" }, prompt: "Implement auth",
      }));

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

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      const r1 = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: "test-session-1" }, prompt: "Task 1",
      }));
      expect(r1).toEqual({ response: "mock plan result for: Task 1" });

      const r2 = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: "test-session-1" }, prompt: "Task 2",
      }));
      expect(r2).toEqual({ response: "mock plan result for: Task 2" });

      // closeSession receives the SessionHandle directly as the payload.
      // The mock server returns null for session/close.
      const closeResult = yield* dispatch(claudeCodeDeclaration.closeSession( {
        sessionId: "test-session-1",
      }));
      expect(closeResult).toBeNull();
    });
  });

  it("prompt works through real ACP binding path", function* () {
    const binding = createBinding({
      command: "npx",
      arguments: ["tsx", mockAcpServer],
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);

      yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "opus-4",
      }));

      const result = yield* dispatch(claudeCodeDeclaration.prompt( {
        session: { sessionId: "test-session-1" }, prompt: "Refactor auth",
      }));

      expect(result).toEqual({
        response: "mock plan result for: Refactor auth",
      });
    });
  });

  it("surfaces subprocess diagnostic when ACP process exits immediately", function* () {
    const binding = createBinding({
      command: "node",
      arguments: ["-e", "process.stderr.write('mock failure\\n'); process.exit(1)"],
    });

    let caughtError: Error | null = null;
    try {
      yield* scoped(function* () {
        yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);
        yield* dispatch(claudeCodeDeclaration.newSession( {
          model: "opus-4",
        }));
      });
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("exited with code 1");
    expect(caughtError!.message).toContain("mock failure");
    expect(caughtError!.message).not.toContain("Transport closed with in-flight request");
  });
});

// ── SDK adapter tests (mock SDK, no real subprocess) ──

function createMockSdkSession(initSessionId?: string) {
  const sentMessages: string[] = [];
  const messageQueue: Array<Record<string, unknown>> = [];
  let closed = false;
  let _sessionId: string | null = initSessionId ?? null;

  const session = {
    get sessionId(): string {
      if (!_sessionId) {
        throw new Error("Session ID not available");
      }
      return _sessionId;
    },
    async send(msg: string) {
      if (closed) {
        throw new Error("Cannot send to closed session");
      }
      sentMessages.push(msg);
    },
    async *stream() {
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift()!;
        if (msg.type === "system" && msg.subtype === "init") {
          _sessionId = msg.session_id as string;
        }
        yield msg;
        if (msg.type === "result") {
          return;
        }
      }
    },
    close() {
      closed = true;
    },
  };

  return {
    session,
    sentMessages,
    enqueue: (msgs: Array<Record<string, unknown>>) => messageQueue.push(...msgs),
    get closed() {
      return closed;
    },
  };
}

describe("Claude Code SDK Adapter", () => {
  it("newSession returns adapter handle with cc- prefix", function* () {
    const mock = createMockSdkSession();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      unstable_v2_createSession: () => mock.session,
    }));

    const binding = createSdkBinding({ model: "test" });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);
      const handle = yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "test",
      }));
      expect((handle as any).sessionId).toMatch(/^cc-\d+$/);
    });

    vi.doUnmock("@anthropic-ai/claude-agent-sdk");
  });

  it("two sequential plan calls reuse one SDK session", function* () {
    const mock = createMockSdkSession();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      unstable_v2_createSession: () => mock.session,
    }));

    const binding = createSdkBinding({ model: "test" });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);
      const handle = yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "test",
      }));
      const h = (handle as any).sessionId;

      mock.enqueue([
        {
          type: "system",
          subtype: "init",
          session_id: "sdk-uuid-1",
          uuid: "u1",
        },
        {
          type: "result",
          subtype: "success",
          result: "result 1",
          session_id: "sdk-uuid-1",
          uuid: "u2",
          is_error: false,
          num_turns: 1,
          duration_ms: 0,
          duration_api_ms: 0,
          total_cost_usd: 0,
          stop_reason: null,
          usage: {},
          modelUsage: {},
          permission_denials: [],
        },
      ]);
      const r1 = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: h }, prompt: "First",
      }));
      expect(r1).toEqual({ response: "result 1" });

      mock.enqueue([
        {
          type: "result",
          subtype: "success",
          result: "result 2",
          session_id: "sdk-uuid-1",
          uuid: "u3",
          is_error: false,
          num_turns: 1,
          duration_ms: 0,
          duration_api_ms: 0,
          total_cost_usd: 0,
          stop_reason: null,
          usage: {},
          modelUsage: {},
          permission_denials: [],
        },
      ]);
      const r2 = yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: h }, prompt: "Second",
      }));
      expect(r2).toEqual({ response: "result 2" });

      expect(mock.sentMessages).toEqual(["First", "Second"]);
    });

    vi.doUnmock("@anthropic-ai/claude-agent-sdk");
  });

  it("closeSession calls close() and invalidates handle", function* () {
    const mock = createMockSdkSession();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      unstable_v2_createSession: () => mock.session,
    }));

    const binding = createSdkBinding({ model: "test" });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);
      const handle = yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "test",
      }));
      yield* dispatch(claudeCodeDeclaration.closeSession( handle));
      expect(mock.closed).toBe(true);
    });

    vi.doUnmock("@anthropic-ai/claude-agent-sdk");
  });

  it("newSession -> plan -> fork -> openFork lifecycle", function* () {
    const parentMock = createMockSdkSession();
    const childMock = createMockSdkSession("forked-uuid");
    const forkFn = vi.fn().mockResolvedValue({ sessionId: "forked-uuid" });
    const resumeFn = vi.fn().mockReturnValue(childMock.session);

    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      unstable_v2_createSession: () => parentMock.session,
      forkSession: forkFn,
      unstable_v2_resumeSession: resumeFn,
    }));

    const binding = createSdkBinding({ model: "test" });

    yield* scoped(function* () {
      yield* installRemoteAgent(claudeCodeDeclaration, binding.transport);

      // newSession
      const handle = yield* dispatch(claudeCodeDeclaration.newSession( {
        model: "test",
      }));
      const h = (handle as any).sessionId;

      // plan — initializes SDK sessionId
      parentMock.enqueue([
        {
          type: "system",
          subtype: "init",
          session_id: "sdk-parent-uuid",
          uuid: "u1",
        },
        {
          type: "result",
          subtype: "success",
          result: "done",
          session_id: "sdk-parent-uuid",
          uuid: "u2",
          is_error: false,
          num_turns: 1,
          duration_ms: 0,
          duration_api_ms: 0,
          total_cost_usd: 0,
          stop_reason: null,
          usage: {},
          modelUsage: {},
          permission_denials: [],
        },
      ]);
      yield* dispatch(claudeCodeDeclaration.plan( {
        session: { sessionId: h }, prompt: "init",
      }));

      // fork — uses real SDK sessionId, returns adapter handle as parentSessionId
      const forkData = yield* dispatch(claudeCodeDeclaration.fork( {
        sessionId: h,
      }));
      expect(forkData).toEqual({
        parentSessionId: h,
        forkId: "forked-uuid",
      });
      expect(forkFn).toHaveBeenCalledWith("sdk-parent-uuid");

      // openFork — creates new session, returns new adapter handle
      const childHandle = yield* dispatch(claudeCodeDeclaration.openFork( forkData));
      expect((childHandle as any).sessionId).toMatch(/^cc-\d+$/);
      expect((childHandle as any).sessionId).not.toBe(h);
      expect(resumeFn).toHaveBeenCalledWith("forked-uuid", expect.any(Object));
    });

    vi.doUnmock("@anthropic-ai/claude-agent-sdk");
  });
});
