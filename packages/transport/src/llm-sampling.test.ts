import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped, sleep, spawn } from "effection";
import type { Val } from "@tisyn/ir";
import { agent, operation, dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "./install-remote.js";
import { ProgressContext, CoroutineContext } from "./progress.js";
import type { ProgressEvent } from "./progress.js";
import { createMockLlmTransport } from "./test-helpers/mock-llm-adapter.js";
import type { HostMessage } from "./transport.js";

const llmDeclaration = agent("llm", {
  sample: operation<Val, Val>(),
});

describe("LLM Sampling — Progress Forwarding", () => {
  // LS-010: Progress emitted during execution is observable
  it("LS-010: progress emitted during execution is observable", function* () {
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root");

    const factory = createMockLlmTransport({
      progress: [{ text: "thinking..." }, { text: "done" }],
      result: { answer: 42 },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);
      const result = yield* dispatch("llm.sample", { prompt: "hello" });
      expect(result).toEqual({ answer: 42 });
    });

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].value).toEqual({ text: "thinking..." });
    expect(progressEvents[1].value).toEqual({ text: "done" });
  });

  // LS-013: Progress after result is discarded
  it("LS-013: post-result progress is silently discarded", function* () {
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root");

    // Mock sends one progress before the result, then one AFTER the result
    const factory = createMockLlmTransport({
      progress: [{ text: "before" }],
      result: { answer: 42 },
      lateProgress: [{ text: "late — should be dropped" }],
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);
      const result = yield* dispatch("llm.sample", { prompt: "hello" });
      expect(result).toEqual({ answer: 42 });
    });

    // Only pre-result progress should be received; late progress is dropped
    // by the session signal (signal.close() fires on result, subsequent
    // signal.send() from onProgress is a no-op on a closed signal).
    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0].value).toEqual({ text: "before" });
  });
});

describe("LLM Sampling — Progress Identity and Correlation", () => {
  // LS-020: Observer-facing progress carries effect type context and instance identity
  it("LS-020: progress carries token, effectId, coroutineId, and value", function* () {
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root.0");

    const factory = createMockLlmTransport({
      progress: [{ text: "chunk" }],
      result: { answer: 42 },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);
      yield* dispatch("llm.sample", { prompt: "hello" });
    });

    expect(progressEvents).toHaveLength(1);
    const event = progressEvents[0];
    expect(event.token).toEqual(expect.any(String));
    expect(event.token.length).toBeGreaterThan(0);
    expect(event.effectId).toBe("llm.sample");
    expect(event.coroutineId).toBe("root.0");
    expect(event.value).toEqual({ text: "chunk" });
  });

  // LS-021: Two concurrent llm.sample calls produce distinguishable progress
  it("LS-021: concurrent calls produce progress with distinct tokens", function* () {
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root");

    // Use a delay so both requests are in-flight simultaneously
    const factory = createMockLlmTransport({
      progress: [{ text: "chunk" }],
      result: { answer: 42 },
      delay: 20,
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);

      // Launch both dispatches concurrently so both are in-flight at the same time
      let result1: Val = null;
      let result2: Val = null;
      const t1 = yield* spawn(function* () {
        result1 = yield* dispatch("llm.sample", { prompt: "first" });
      });
      const t2 = yield* spawn(function* () {
        result2 = yield* dispatch("llm.sample", { prompt: "second" });
      });

      // Wait for both to complete
      yield* t1;
      yield* t2;

      expect(result1).toEqual({ answer: 42 });
      expect(result2).toEqual({ answer: 42 });
    });

    // Both calls emitted progress — should have 2 events with distinct tokens
    expect(progressEvents).toHaveLength(2);
    const tokens = progressEvents.map((e) => e.token);
    expect(tokens[0]).not.toBe(tokens[1]);

    // Grouping by token cleanly separates progress from each call
    const grouped = new Map<string, ProgressEvent[]>();
    for (const ev of progressEvents) {
      const group = grouped.get(ev.token) ?? [];
      group.push(ev);
      grouped.set(ev.token, group);
    }
    expect(grouped.size).toBe(2);
  });
});

describe("LLM Sampling — Cancellation and Failure", () => {
  // LS-030: Scope cancellation halts in-flight LLM call via protocol cancel
  it("LS-030: cancellation sends cancel notification and halts in-flight call", function* () {
    const messages: HostMessage[] = [];
    let dispatched = false;
    let completed = false;

    const innerFactory = createMockLlmTransport({ neverComplete: true });
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
      yield* installRemoteAgent(llmDeclaration, recordingFactory as any);

      // Spawn a dispatch that will never complete
      const task = yield* spawn(function* () {
        dispatched = true;
        yield* dispatch("llm.sample", { prompt: "hello" });
        completed = true;
      });

      // Give the dispatch a chance to start and the execute request to arrive
      yield* sleep(10);

      // Halt just the dispatch task — this triggers the session's finally block
      // which sends cancelNotification for the in-flight request
      yield* task.halt();
    });

    expect(dispatched).toBe(true);
    expect(completed).toBe(false);

    // Verify the protocol cancel path was exercised
    const cancelMsg = messages.find((m) => m.method === "cancel");
    expect(cancelMsg).toBeDefined();
    expect((cancelMsg as any).params.id).toEqual(expect.any(String));
  });

  // LS-032: Backend error becomes journaled application error
  it("LS-032: backend error is propagated", function* () {
    const factory = createMockLlmTransport({
      error: { message: "model overloaded", name: "BackendError" },
    });

    let caughtError: Error | null = null;
    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);
      try {
        yield* dispatch("llm.sample", { prompt: "hello" });
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("model overloaded");
  });

  // LS-034: Progress emitted before failure remains observational
  it("LS-034: progress before failure is captured, error propagates", function* () {
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root");

    const factory = createMockLlmTransport({
      progress: [{ text: "thinking..." }, { text: "almost done" }],
      error: { message: "model overloaded", name: "BackendError" },
    });

    let caughtError: Error | null = null;
    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);
      try {
        yield* dispatch("llm.sample", { prompt: "hello" });
      } catch (e) {
        caughtError = e as Error;
      }
    });

    // Progress was captured
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].value).toEqual({ text: "thinking..." });
    expect(progressEvents[1].value).toEqual({ text: "almost done" });

    // Error was propagated
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("model overloaded");
  });
});
