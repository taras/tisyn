import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import { resolve } from "node:path";
import type { Val } from "@tisyn/ir";
import { dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import { ProgressContext, CoroutineContext } from "@tisyn/transport";
import type { ProgressEvent } from "@tisyn/transport";
import { CodeAgent } from "@tisyn/code-agent";
import { createSdkBinding } from "./sdk-adapter.js";
import { createExecBinding } from "./exec-adapter.js";

const mockCodexExec = resolve(import.meta.dirname, "test-assets/mock-codex-exec.ts");

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
      expect(() => createSdkBinding({ model: "" })).toThrow(
        /non-empty string/,
      );
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

        const result = yield* dispatch("code-agent.closeSession", {
          handle: { sessionId: "nonexistent-handle" },
        } as unknown as Val);

        expect(result).toBeNull();
      });
    });

    it("fork throws NotSupported", function* () {
      const binding = createSdkBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch("code-agent.fork", {
            session: { sessionId: "s-1" },
          } as unknown as Val);
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
          yield* dispatch("code-agent.openFork", {
            data: { parentSessionId: "s-1", forkId: "f-1" },
          } as unknown as Val);
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("not supported");
    });
  });

  describe("blocked operations", () => {
    it("newSession throws pending-verification error", function* () {
      const binding = createSdkBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch("code-agent.newSession", {
            config: { model: "test" },
          } as unknown as Val);
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("not yet implemented");
      expect(caughtError!.message).toContain("OQ-CX-1");
    });

    it("prompt throws pending-verification error", function* () {
      const binding = createSdkBinding();
      let caughtError: Error | null = null;

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        try {
          yield* dispatch("code-agent.prompt", {
            args: { session: { sessionId: "s-1" }, prompt: "hello" },
          } as unknown as Val);
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("not yet implemented");
      expect(caughtError!.message).toContain("OQ-CX-1");
    });
  });
});

// ── Exec adapter tests ──

describe("Codex Exec Adapter", () => {
  describe("config validation", () => {
    it("rejects approval 'untrusted'", function* () {
      expect(() => createExecBinding({ approval: "untrusted" as any })).toThrow(
        /not compatible with headless/,
      );
    });

    it("rejects approval 'on-failure'", function* () {
      expect(() => createExecBinding({ approval: "on-failure" as any })).toThrow(
        /not compatible with headless/,
      );
    });

    it("rejects invalid sandbox mode", function* () {
      expect(() => createExecBinding({ sandbox: "none" as any })).toThrow(
        /Invalid sandbox mode/,
      );
    });

    it("rejects empty model string", function* () {
      expect(() => createExecBinding({ model: "" })).toThrow(/non-empty string/);
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

        const handle = yield* dispatch("code-agent.newSession", {
          config: { model: "test" },
        } as unknown as Val);

        expect((handle as any).sessionId).toMatch(/^cx-\d+$/);

        const result = yield* dispatch("code-agent.prompt", {
          args: {
            session: handle,
            prompt: "Analyze the code",
          },
        } as unknown as Val);

        expect((result as any).response).toContain("mock result for: Analyze the code");
      });
    });

    it("closeSession returns null for live handle", function* () {
      const binding = createExecBinding({
        command: "npx",
        arguments: ["tsx", mockCodexExec],
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(CodeAgent, binding.transport);

        const handle = yield* dispatch("code-agent.newSession", {
          config: {},
        } as unknown as Val);

        const result = yield* dispatch("code-agent.closeSession", {
          handle,
        } as unknown as Val);

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

        const result = yield* dispatch("code-agent.closeSession", {
          handle: { sessionId: "nonexistent" },
        } as unknown as Val);

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
          yield* dispatch("code-agent.prompt", {
            args: {
              session: { sessionId: "stale-handle" },
              prompt: "hello",
            },
          } as unknown as Val);
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
          yield* dispatch("code-agent.fork", {
            session: { sessionId: "s-1" },
          } as unknown as Val);
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
          yield* dispatch("code-agent.openFork", {
            data: { parentSessionId: "s-1", forkId: "f-1" },
          } as unknown as Val);
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

        const handle = yield* dispatch("code-agent.newSession", {
          config: {},
        } as unknown as Val);

        yield* dispatch("code-agent.prompt", {
          args: {
            session: handle,
            prompt: "MULTI_PROGRESS",
          },
        } as unknown as Val);
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

        const handle = yield* dispatch("code-agent.newSession", {
          config: {},
        } as unknown as Val);

        try {
          yield* dispatch("code-agent.prompt", {
            args: {
              session: handle,
              prompt: "EXIT_ERROR",
            },
          } as unknown as Val);
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain("exited with code 1");
      expect(caughtError!.message).toContain("model not found");
    });
  });
});
