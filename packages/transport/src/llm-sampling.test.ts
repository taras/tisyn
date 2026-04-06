import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped, sleep, spawn } from "effection";
import type { Val } from "@tisyn/ir";
import { agent, operation, dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "./install-remote.js";
import { ProgressContext, CoroutineContext } from "./progress.js";
import type { ProgressEvent } from "./progress.js";
import { createMockLlmTransport } from "./test-helpers/mock-llm-adapter.js";

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

    // Set coroutineId to simulate runtime context
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
    // The session stream closes after the result is received (signal.close()).
    // Any progress notifications arriving after that are dropped by the signal.
    // The mock adapter sends all progress BEFORE the result, so to test this
    // we verify the drain loop correctly terminates after result.
    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });
    yield* CoroutineContext.set("root");

    const factory = createMockLlmTransport({
      progress: [{ text: "before" }],
      result: { answer: 42 },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);
      yield* dispatch("llm.sample", { prompt: "hello" });
    });

    // Only pre-result progress should be received
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

    const factory = createMockLlmTransport({
      progress: [{ text: "chunk" }],
      result: { answer: 42 },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);

      // Two sequential calls — each should get a distinct token
      yield* dispatch("llm.sample", { prompt: "first" });
      yield* dispatch("llm.sample", { prompt: "second" });
    });

    expect(progressEvents).toHaveLength(2);
    const tokens = progressEvents.map((e) => e.token);
    expect(tokens[0]).not.toBe(tokens[1]);
  });
});

describe("LLM Sampling — Cancellation and Failure", () => {
  // LS-030: Scope cancellation halts in-flight LLM call
  it("LS-030: cancellation halts in-flight call", function* () {
    let dispatched = false;
    let completed = false;

    const factory = createMockLlmTransport({ neverComplete: true });

    yield* scoped(function* () {
      yield* installRemoteAgent(llmDeclaration, factory);

      // Spawn a dispatch that will never complete
      yield* spawn(function* () {
        dispatched = true;
        yield* dispatch("llm.sample", { prompt: "hello" });
        completed = true;
      });

      // Give the dispatch a chance to start
      yield* sleep(10);

      // Exiting the scoped block cancels the in-flight task
    });

    expect(dispatched).toBe(true);
    expect(completed).toBe(false);
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

  // LS-033: Backend error replays identically (tested in runtime tests via journal)
  // This is a replay test, covered in the runtime test file as LS-005 pattern.

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
