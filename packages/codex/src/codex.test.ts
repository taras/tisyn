import { describe, it } from "@effectionx/vitest";
import { expect, vi } from "vitest";
import { scoped, spawn, sleep } from "effection";
import { resolve } from "node:path";
import { dispatch } from "@tisyn/effects";
import { installRemoteAgent } from "@tisyn/transport";
import { ProgressContext, CoroutineContext } from "@tisyn/transport";
import type { ProgressEvent } from "@tisyn/transport";
import { CodeAgent } from "@tisyn/code-agent";
import { createSdkBinding } from "./sdk-adapter.js";
import { createExecBinding } from "./exec-adapter.js";

const mockCodexExec = resolve(import.meta.dirname, "test-assets/mock-codex-exec.ts");

// ── SDK mock ──
// Per-test factory that test bodies configure before dispatching.
// The mock itself must be async because that's the SDK's interface shape.
let mockRunStreamed: (
  input: string,
) => Promise<{ events: AsyncGenerator<Record<string, unknown>> }>;
let startThreadCallCount = 0;

vi.mock("@openai/codex-sdk", () => {
  class MockThread {
    id = "thread-1";
    runStreamed(input: string) {
      return mockRunStreamed(input);
    }
  }
  class MockCodex {
    startThread() {
      startThreadCallCount++;
      return new MockThread();
    }
  }
  return { Codex: MockCodex };
});

// ── SDK adapter tests ──

describe("Codex SDK Adapter", () => {
  describe("config validation", () => {
    it("rejects approval 'untrusted'", function* () {
      expect(() => createSdkBinding({ approval: "untrusted" as any })).toThrow(
        /not compatible with headless/,
      );
    });

    it("rejects approval 'on-failure'", function* () {
      expect(() => createSdkBinding({ approval: "on-failure" as any })).toThrow(
        /not compatible with headless/,
      );
    });

    it("rejects invalid sandbox mode", function* () {
      expect(() => createSdkBinding({ sandbox: "permissive" as any })).toThrow(
        /Invalid sandbox mode/,
      );
    });

    it("rejects empty model string", function* () {
      expect(() => createSdkBinding({ model: "" })).toThrow(/non-empty string/);
    });

    it("accepts approval 'on-request'", function* () {
      expect(() => createSdkBinding({ approval: "on-request" })).not.toThrow();
    });

    it("accepts approval 'never'", function* () {
      expect(() => createSdkBinding({ approval: "never" })).not.toThrow();
    });

    it("accepts default config", function* () {
      expect(() => createSdkBinding()).not.toThrow();
    });
  });

  describe("verified operations", () => {
    it("closeSession returns null on unknown handle (stale-handle tolerance)", function* () {
      const binding = createSdkBinding();

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const result = yield* dispatch(CodeAgent.closeSession( {
          sessionId: "nonexistent-handle",
        }));

        expect(result).toBeNull();
      });
    });

    it("fork throws NotSupported", function* () {
      const binding = createSdkBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(CodeAgent.fork( {
            sessionId: "s-1",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("not supported");
    });

    it("openFork throws NotSupported", function* () {
      const binding = createSdkBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(CodeAgent.openFork( {
            parentSessionId: "s-1",
            forkId: "f-1",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("not supported");
    });
  });

  describe("session lifecycle", () => {
    it("newSession returns handle", function* () {
      startThreadCallCount = 0;
      mockRunStreamed = async () => ({ events: (async function* () {})() });
      const binding = createSdkBinding();

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));

        expect((handle as any).sessionId).toMatch(/^cx-\d+$/);
        expect(startThreadCallCount).toBe(1);
      });
    });

    it("prompt returns response from streamed events", function* () {
      mockRunStreamed = async (input: string) => ({
        events: (async function* () {
          yield { type: "item.started", item: { id: "msg-1", type: "agent_message", text: "" } };
          yield {
            type: "item.completed",
            item: { id: "msg-1", type: "agent_message", text: `mock: ${input}` },
          };
          yield { type: "turn.completed", usage: null };
        })(),
      });
      const binding = createSdkBinding();

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));
        const result = yield* dispatch(CodeAgent.prompt( {
          session: handle, prompt: "hello",
        }));

        expect((result as any).response).toBe("mock: hello");
      });
    });

    it("prompt streams progress events", function* () {
      mockRunStreamed = async (input: string) => ({
        events: (async function* () {
          yield { type: "item.started", item: { id: "msg-1", type: "agent_message", text: "" } };
          yield {
            type: "item.completed",
            item: { id: "msg-1", type: "agent_message", text: `mock: ${input}` },
          };
          yield { type: "turn.completed", usage: null };
        })(),
      });

      const progressEvents: ProgressEvent[] = [];
      yield* ProgressContext.set((event) => {
        progressEvents.push(event);
      });
      yield* CoroutineContext.set("root");

      const binding = createSdkBinding();

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));
        yield* dispatch(CodeAgent.prompt( {
          session: handle, prompt: "hello",
        }));
      });

      // All 3 events forwarded as progress: item.started, item.completed, turn.completed
      expect(progressEvents.length).toBe(3);
    });

    it("repeated prompts on same handle reuse thread", function* () {
      startThreadCallCount = 0;
      mockRunStreamed = async (input: string) => ({
        events: (async function* () {
          yield {
            type: "item.completed",
            item: { id: "msg-1", type: "agent_message", text: `mock: ${input}` },
          };
          yield { type: "turn.completed", usage: null };
        })(),
      });
      const binding = createSdkBinding();

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));
        yield* dispatch(CodeAgent.prompt( {
          session: handle, prompt: "first",
        }));
        yield* dispatch(CodeAgent.prompt( {
          session: handle, prompt: "second",
        }));

        // startThread called once at newSession, not per-prompt
        expect(startThreadCallCount).toBe(1);
      });
    });

    it("prompt rejects unknown handle", function* () {
      mockRunStreamed = async () => ({ events: (async function* () {})() });
      const binding = createSdkBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(CodeAgent.prompt( {
            session: { sessionId: "stale-handle" }, prompt: "hello",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("Unknown session handle");
    });

    it("newSession rejects wrapped payload with InvalidPayload", function* () {
      startThreadCallCount = 0;
      const binding = createSdkBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(
            CodeAgent.newSession({ config: { model: "test" } } as unknown as { model?: string }),
          );
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.name).toBe("InvalidPayload");
      expect(caughtError!.message).toContain("unexpected payload key 'config'");
      expect(caughtError!.message).toContain("Expected payload shape: { model?: string }");
      expect(startThreadCallCount).toBe(0);
    });
  });

  describe("cancellation", () => {
    it("canceling an in-flight prompt stops the operation", function* () {
      mockRunStreamed = async () => ({
        events: (async function* () {
          yield { type: "item.started", item: { id: "msg-1", type: "agent_message", text: "" } };
          // Block forever — adapter must be halted externally
          await new Promise(() => {});
        })(),
      });
      const binding = createSdkBinding();

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));

        let resultReceived = false;
        const task = yield* spawn(function* () {
          yield* dispatch(CodeAgent.prompt( {
            session: handle, prompt: "hang",
          }));
          resultReceived = true;
        });

        yield* sleep(200);
        yield* task.halt();
        expect(resultReceived).toBe(false);
      });
    });
  });
});

// ── Exec adapter tests ──

describe("Codex Exec Adapter", () => {
  describe("config validation", () => {
    it("rejects model config (unverified CLI flag)", function* () {
      expect(() => createExecBinding({ model: "" })).toThrow(/cannot honor 'model'/);
    });

    it("rejects valid model config (unverified CLI flag)", function* () {
      expect(() => createExecBinding({ model: "o3-mini" })).toThrow(/cannot honor 'model'/);
    });

    it("rejects sandbox config (unverified CLI flag)", function* () {
      expect(() => createExecBinding({ sandbox: "none" as any })).toThrow(/cannot honor 'sandbox'/);
    });

    it("rejects valid sandbox config (unverified CLI flag)", function* () {
      expect(() => createExecBinding({ sandbox: "read-only" })).toThrow(/cannot honor 'sandbox'/);
    });

    it("rejects approval config (unverified CLI flag)", function* () {
      expect(() => createExecBinding({ approval: "untrusted" as any })).toThrow(
        /cannot honor 'approval'/,
      );
    });

    it("rejects valid approval config (unverified CLI flag)", function* () {
      expect(() => createExecBinding({ approval: "never" })).toThrow(/cannot honor 'approval'/);
    });

    it("rejects empty command string", function* () {
      expect(() => createExecBinding({ command: "" })).toThrow(/non-empty string/);
    });

    it("accepts default config", function* () {
      expect(() => createExecBinding()).not.toThrow();
    });
  });

  describe("session lifecycle", () => {
    it("newSession returns handle and prompt returns result", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));

        expect((handle as any).sessionId).toMatch(/^cx-\d+$/);

        const result = yield* dispatch(CodeAgent.prompt( {
          session: handle,
          prompt: "Analyze the code",
        }));

        expect((result as any).response).toContain("mock result for: Analyze the code");
      });
    });

    it("newSession rejects explicit model (unverified CLI flag)", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(CodeAgent.newSession( {
            model: "o3-mini",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("cannot honor 'model'");
    });

    it("newSession rejects wrapped payload with InvalidPayload", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(
            CodeAgent.newSession({ config: { model: "test" } } as unknown as { model?: string }),
          );
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.name).toBe("InvalidPayload");
      expect(caughtError!.message).toContain("unexpected payload key 'config'");
      expect(caughtError!.message).toContain("Expected payload shape: { model?: string }");
    });

    it("closeSession returns null for live handle", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));

        const result = yield* dispatch(CodeAgent.closeSession( handle));

        expect(result).toBeNull();
      });
    });

    it("closeSession returns null for unknown handle (stale-handle tolerance)", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const result = yield* dispatch(CodeAgent.closeSession( {
          sessionId: "nonexistent",
        }));

        expect(result).toBeNull();
      });
    });
  });

  describe("stale-handle behavior", () => {
    it("prompt rejects unknown handle", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(CodeAgent.prompt( {
            session: { sessionId: "stale-handle" },
            prompt: "hello",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("Unknown session handle");
    });
  });

  describe("fork/openFork", () => {
    it("fork throws NotSupported", function* () {
      const binding = createExecBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(CodeAgent.fork( {
            sessionId: "s-1",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("not supported");
    });

    it("openFork throws NotSupported", function* () {
      const binding = createExecBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch(CodeAgent.openFork( {
            parentSessionId: "s-1",
            forkId: "f-1",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("not supported");
    });
  });

  describe("subprocess behavior", () => {
    it("progress events forwarded from subprocess NDJSON", function* () {
      const progressEvents: ProgressEvent[] = [];
      yield* ProgressContext.set((event) => {
        progressEvents.push(event);
      });
      yield* CoroutineContext.set("root");

      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));

        yield* dispatch(CodeAgent.prompt( {
          session: handle,
          prompt: "MULTI_PROGRESS",
        }));
      });

      // Mock subprocess emits 3 progress events before the final result.
      // The final event is the result, not progress. So 3 progress events.
      expect(progressEvents.length).toBe(3);
    });

    it("surfaces subprocess diagnostics on exit error", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));

        try {
          yield* dispatch(CodeAgent.prompt( {
            session: handle,
            prompt: "EXIT_ERROR",
          }));
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("exited with code 1");
      expect(caughtError!.message).toContain("model not found");
    });
  });

  describe("cancellation", () => {
    it("canceling an in-flight prompt stops the operation", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch(CodeAgent.newSession( {}));

        let resultReceived = false;
        const task = yield* spawn(function* () {
          yield* dispatch(CodeAgent.prompt( {
            session: handle,
            prompt: "NEVER_COMPLETE",
          }));
          resultReceived = true;
        });

        yield* sleep(500);
        yield* task.halt();
        expect(resultReceived).toBe(false);
      });
    });
  });
});
