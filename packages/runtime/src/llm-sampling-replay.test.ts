import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Effects } from "@tisyn/agent";
import { ProgressContext } from "@tisyn/transport";
import type { YieldEvent, DurableEvent } from "@tisyn/kernel";
import { Ref, Get } from "@tisyn/ir";
import { createMockLlmTransport } from "@tisyn/transport/test-helpers/mock-llm-adapter";
import type { ProgressEvent } from "@tisyn/transport";

// Convenience constructor for scope IR — raw plain objects (no @tisyn/compiler dependency).
const scope = (body: unknown, handler: unknown = null, bindings: unknown = {}) =>
  ({
    tisyn: "eval",
    id: "scope",
    data: { tisyn: "quote", expr: { handler, bindings, body } },
  }) as unknown as import("@tisyn/ir").IrInput;

// IR that yields a single external effect
function singleEffectIR(agentType: string, opName: string, data: unknown = null) {
  return {
    tisyn: "eval",
    id: `${agentType}.${opName}`,
    data,
  };
}

function yieldEvent(
  type: string,
  name: string,
  value: unknown,
  coroutineId = "root",
): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type, name },
    result: { status: "ok", value: value as never },
  };
}

function yieldErrorEvent(
  type: string,
  name: string,
  error: { message: string; name?: string },
  coroutineId = "root",
): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type, name },
    result: { status: "err", error },
  };
}

describe("LLM Sampling — Standard External Effect", () => {
  // LS-001: llm.sample dispatches through installed adapter and returns result
  it("LS-001: dispatches through installed adapter and returns result", function* () {
    const factory = createMockLlmTransport({ result: { answer: 42 } });
    const ir = scope(
      singleEffectIR("llm", "sample", { prompt: "hello" }),
      null,
      { llm: Get(Ref("envObj"), "transport") },
    );
    const { result } = yield* execute({
      ir: ir as never,
      env: { envObj: { transport: factory } as any },
    });
    expect(result).toEqual({ status: "ok", value: { answer: 42 } });
  });

  // LS-002: YieldEvent description matches parseEffectId("llm.sample")
  it("LS-002: YieldEvent description matches parsed effect ID", function* () {
    const factory = createMockLlmTransport({ result: { answer: 42 } });
    const ir = scope(
      singleEffectIR("llm", "sample", { prompt: "hello" }),
      null,
      { llm: Get(Ref("envObj"), "transport") },
    );
    const { journal } = yield* execute({
      ir: ir as never,
      env: { envObj: { transport: factory } as any },
    });
    const yieldEvents = journal.filter((e) => e.type === "yield") as YieldEvent[];
    expect(yieldEvents.length).toBeGreaterThanOrEqual(1);
    const llmYield = yieldEvents.find(
      (e) => e.description.type === "llm" && e.description.name === "sample",
    );
    expect(llmYield).toBeDefined();
    expect(llmYield!.description).toEqual({ type: "llm", name: "sample" });
  });

  // LS-003: Persist-before-resume — YieldEvent appears in journal before kernel resumes
  it("LS-003: YieldEvent is journaled before close", function* () {
    const stream = new InMemoryStream();
    const factory = createMockLlmTransport({ result: { answer: 42 } });
    const ir = scope(
      singleEffectIR("llm", "sample", { prompt: "hello" }),
      null,
      { llm: Get(Ref("envObj"), "transport") },
    );
    const { journal } = yield* execute({
      ir: ir as never,
      env: { envObj: { transport: factory } as any },
      stream,
    });
    // Journal should have yield events before close events
    const yieldIdx = journal.findIndex(
      (e) =>
        e.type === "yield" &&
        (e as YieldEvent).description.type === "llm" &&
        (e as YieldEvent).description.name === "sample",
    );
    const closeIdx = journal.findIndex(
      (e) => e.type === "close" && (e as any).coroutineId === "root",
    );
    expect(yieldIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(yieldIdx);
    // appendCount confirms events were actually persisted
    expect(stream.appendCount).toBeGreaterThanOrEqual(2);
  });
});

describe("LLM Sampling — Replay", () => {
  // LS-004: Replay returns stored result without contacting adapter
  it("LS-004: replay returns stored result without contacting adapter", function* () {
    const stored: DurableEvent[] = [yieldEvent("llm", "sample", { answer: 42 })];
    const stream = new InMemoryStream(stored);

    let agentCalled = false;
    yield* Effects.around({
      *dispatch([_effectId, _data]: [string, any]) {
        agentCalled = true;
        return 999;
      },
    });

    const { result } = yield* execute({
      ir: singleEffectIR("llm", "sample") as never,
      stream,
    });

    expect(agentCalled).toBe(false);
    expect(result).toEqual({ status: "ok", value: { answer: 42 } });
  });

  // LS-005: Divergence detected on effect ID mismatch
  it("LS-005: divergence on effect ID mismatch", function* () {
    const stored: DurableEvent[] = [yieldEvent("foo", "bar", 10)];
    const stream = new InMemoryStream(stored);

    const { result } = yield* execute({
      ir: singleEffectIR("llm", "sample") as never,
      stream,
    });

    expect(result.status).toBe("err");
    if (result.status === "err") {
      expect(result.error.name).toBe("DivergenceError");
      expect(result.error.message).toContain("expected foo.bar");
      expect(result.error.message).toContain("got llm.sample");
    }
  });

  // LS-006: Replay ignores data differences (type/name match only)
  it("LS-006: replay ignores data differences", function* () {
    const stored: DurableEvent[] = [yieldEvent("llm", "sample", { cached: true })];
    const stream = new InMemoryStream(stored);

    let agentCalled = false;
    yield* Effects.around({
      *dispatch([_effectId, _data]: [string, any]) {
        agentCalled = true;
        return 1;
      },
    });

    const { result } = yield* execute({
      ir: singleEffectIR("llm", "sample", { prompt: "different data" }) as never,
      stream,
    });

    expect(agentCalled).toBe(false);
    expect(result).toEqual({ status: "ok", value: { cached: true } });
  });
});

describe("LLM Sampling — Progress Non-Durability", () => {
  // LS-011: Progress is NOT in the journal
  it("LS-011: progress events are not written to journal", function* () {
    const factory = createMockLlmTransport({
      progress: [{ text: "thinking..." }, { text: "done" }],
      result: { answer: 42 },
    });
    const ir = scope(
      singleEffectIR("llm", "sample", { prompt: "hello" }),
      null,
      { llm: Get(Ref("envObj"), "transport") },
    );
    const { journal } = yield* execute({
      ir: ir as never,
      env: { envObj: { transport: factory } as any },
    });
    // Journal should contain only yield and close events, no progress
    for (const event of journal) {
      expect(event.type).toMatch(/^(yield|close)$/);
    }
    // Specifically: one llm.sample yield + scope close(s) + root close
    const yieldEvents = journal.filter((e) => e.type === "yield") as YieldEvent[];
    const llmYields = yieldEvents.filter(
      (e) => e.description.type === "llm" && e.description.name === "sample",
    );
    expect(llmYields).toHaveLength(1);
  });

  // LS-012: Progress is NOT produced during replay
  it("LS-012: no progress events during replay", function* () {
    const stored: DurableEvent[] = [yieldEvent("llm", "sample", { answer: 42 })];
    const stream = new InMemoryStream(stored);

    const progressEvents: ProgressEvent[] = [];
    yield* ProgressContext.set((event) => {
      progressEvents.push(event);
    });

    yield* Effects.around({
      *dispatch([_effectId, _data]: [string, any]) {
        return 999;
      },
    });

    const { result } = yield* execute({
      ir: singleEffectIR("llm", "sample") as never,
      stream,
    });

    expect(result).toEqual({ status: "ok", value: { answer: 42 } });
    expect(progressEvents).toHaveLength(0);
  });
});

describe("LLM Sampling — Scope Integration", () => {
  // LS-040: llm.sample works inside scoped() with useTransport() binding
  it("LS-040: works inside scope with transport binding", function* () {
    const factory = createMockLlmTransport({ result: { answer: 42 } });
    const ir = scope(
      singleEffectIR("llm", "sample", { prompt: "hello" }),
      null,
      { llm: Get(Ref("envObj"), "transport") },
    );
    const { result, journal } = yield* execute({
      ir: ir as never,
      env: { envObj: { transport: factory } as any },
    });
    expect(result).toEqual({ status: "ok", value: { answer: 42 } });
    // YieldEvent should be under child coroutineId (root.0)
    const yieldEvents = journal.filter((e) => e.type === "yield") as YieldEvent[];
    const llmYield = yieldEvents.find(
      (e) => e.description.type === "llm" && e.description.name === "sample",
    );
    expect(llmYield).toBeDefined();
    expect(llmYield!.coroutineId).toBe("root.0");
  });

  // LS-041: Adapter shuts down when scope exits
  it("LS-041: adapter transport is torn down on scope exit", function* () {
    // Use a recording wrapper to verify shutdown notification
    const messages: any[] = [];
    const innerFactory = createMockLlmTransport({ result: { answer: 42 } });
    const recordingFactory = function* () {
      const transport = yield* innerFactory();
      return {
        *send(msg: any) {
          messages.push(msg);
          yield* transport.send(msg);
        },
        receive: transport.receive,
      };
    };

    const ir = scope(
      singleEffectIR("llm", "sample", { prompt: "hello" }),
      null,
      { llm: Get(Ref("envObj"), "transport") },
    );
    yield* execute({
      ir: ir as never,
      env: { envObj: { transport: recordingFactory } as any },
    });

    const shutdownMsg = messages.find((m) => m.method === "shutdown");
    expect(shutdownMsg).toBeDefined();
  });
});
