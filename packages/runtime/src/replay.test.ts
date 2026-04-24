import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Effects } from "@tisyn/effects";
import type { YieldEvent, CloseEvent, DurableEvent } from "@tisyn/kernel";

// IR that yields a single external effect: agent.op(data)
function singleEffectIR(agentType: string, opName: string, data: unknown = []) {
  return {
    tisyn: "eval",
    id: `${agentType}.${opName}`,
    data,
  };
}

// IR that yields two sequential effects via let bindings
function twoEffectIR(type1: string, name1: string, type2: string, name2: string) {
  return {
    tisyn: "eval",
    id: "let",
    data: {
      tisyn: "quote",
      expr: {
        name: "a",
        value: { tisyn: "eval", id: `${type1}.${name1}`, data: [] },
        body: { tisyn: "eval", id: `${type2}.${name2}`, data: [] },
      },
    },
  };
}

function yieldEvent(type: string, name: string, value: unknown, coroutineId = "root"): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type, name },
    result: { status: "ok", value: value as never },
  };
}

function closeEvent(value: unknown, coroutineId = "root"): CloseEvent {
  return {
    type: "close",
    coroutineId,
    result: { status: "ok", value: value as never },
  };
}

describe("Replay", () => {
  it("replay hit returns stored result", function* () {
    const stored: DurableEvent[] = [yieldEvent("a", "op", 42)];
    const stream = new InMemoryStream(stored);

    let agentCalled = false;
    yield* Effects.around(
      {
        *dispatch([_effectId, _data]: [string, any]) {
          agentCalled = true;
          return 999;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({
      ir: singleEffectIR("a", "op") as never,
      stream,
    });

    expect(agentCalled).toBe(false);
    expect(result).toEqual({ status: "ok", value: 42 });
    expect(journal[0]).toMatchObject({
      type: "yield",
      description: { type: "a", name: "op" },
      result: { status: "ok", value: 42 },
    });
  });

  it("replay miss transitions to live", function* () {
    // Store only the first effect
    const stored: DurableEvent[] = [yieldEvent("a", "step1", 10)];
    const stream = new InMemoryStream(stored);

    let liveCallCount = 0;
    yield* Effects.around(
      {
        *dispatch([_effectId, _data]: [string, any]) {
          liveCallCount++;
          return 20;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({
      ir: twoEffectIR("a", "step1", "a", "step2") as never,
      stream,
    });

    // Only the second effect should trigger live dispatch
    expect(liveCallCount).toBe(1);
    expect(result).toEqual({ status: "ok", value: 20 });

    // Journal: yield(replayed) + yield(live) + close
    expect(journal.length).toBe(3);
    expect((journal[0] as YieldEvent).description.name).toBe("step1");
    expect((journal[1] as YieldEvent).description.name).toBe("step2");
    expect(journal[2]!.type).toBe("close");
  });

  it("replay divergence: wrong type", function* () {
    // Stored says type "a", but kernel will yield type "b"
    const stored: DurableEvent[] = [yieldEvent("a", "op", 10)];
    const stream = new InMemoryStream(stored);

    const { result } = yield* execute({
      ir: singleEffectIR("b", "op") as never,
      stream,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.name).toBe("DivergenceError");
      expect(result.error.message).toContain("expected a.op");
      expect(result.error.message).toContain("got b.op");
    }
  });

  it("replay divergence: wrong name", function* () {
    // Stored says name "foo", but kernel will yield name "bar"
    const stored: DurableEvent[] = [yieldEvent("a", "foo", 10)];
    const stream = new InMemoryStream(stored);

    const { result } = yield* execute({
      ir: singleEffectIR("a", "bar") as never,
      stream,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.name).toBe("DivergenceError");
      expect(result.error.message).toContain("expected a.foo");
      expect(result.error.message).toContain("got a.bar");
    }
  });

  it("replay divergence: continue past close", function* () {
    // Journal has a close event — kernel shouldn't yield more effects
    const stored: DurableEvent[] = [closeEvent(42)];
    const stream = new InMemoryStream(stored);

    const { result } = yield* execute({
      ir: singleEffectIR("a", "op") as never,
      stream,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.name).toBe("DivergenceError");
      expect(result.error.message).toContain("closed");
    }
  });

  it("replay ignores data differences", function* () {
    // Stored yield has data that differs from current IR args,
    // but type/name match — should replay successfully
    const stored: DurableEvent[] = [yieldEvent("a", "op", 99)];
    const stream = new InMemoryStream(stored);

    let agentCalled = false;
    yield* Effects.around(
      {
        *dispatch([_effectId, _data]: [string, any]) {
          agentCalled = true;
          return 1;
        },
      },
      { at: "min" },
    );

    // IR sends different data than what was stored — shouldn't matter
    const { result } = yield* execute({
      ir: singleEffectIR("a", "op", ["different", "data"]) as never,
      stream,
    });

    expect(agentCalled).toBe(false);
    expect(result).toEqual({ status: "ok", value: 99 });
  });
});
