import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { Effects } from "@tisyn/effects";
import type { Val } from "@tisyn/ir";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { YieldEvent, DurableEvent } from "@tisyn/kernel";

function sleepIR(ms: number) {
  return { tisyn: "eval", id: "sleep", data: [ms] };
}

function yieldEvent(value: unknown, coroutineId = "root"): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type: "sleep", name: "sleep" },
    result: { status: "ok", value: value as never },
  };
}

describe("Built-in sleep effect", () => {
  it("compiled sleep succeeds without manual handler", function* () {
    const { result } = yield* execute({ ir: sleepIR(1) as never });
    expect(result).toEqual({ status: "ok", value: null });
  });

  it("sleep replays from journal", function* () {
    const stored: DurableEvent[] = [yieldEvent(null)];
    const stream = new InMemoryStream(stored);

    const { result, journal } = yield* execute({
      ir: sleepIR(1) as never,
      stream,
    });

    expect(result).toEqual({ status: "ok", value: null });
    expect(journal[0]).toMatchObject({
      type: "yield",
      description: { type: "sleep", name: "sleep" },
      result: { status: "ok", value: null },
    });
  });

  it("Effects.around({ *dispatch }) intercepts sleep before built-in", function* () {
    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], _next) {
        if (effectId === "sleep") {
          return 42;
        }
        return yield* _next(effectId, _data);
      },
    });

    const { result } = yield* execute({ ir: sleepIR(100) as never });
    expect(result).toEqual({ status: "ok", value: 42 });
  });

  it("unknown effect still fails with 'No agent registered'", function* () {
    const ir = { tisyn: "eval", id: "unknown.effect", data: null };
    const { result } = yield* execute({ ir: ir as never });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("No agent registered for effect");
    }
  });

  it("Effects.sleep(ms) works directly", function* () {
    yield* Effects.sleep(1);
  });

  it("Effects.around({ *dispatch }) intercepts direct Effects.sleep()", function* () {
    let intercepted = false;
    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], _next) {
        if (effectId === "sleep") {
          intercepted = true;
          return null;
        }
        return yield* _next(effectId, _data);
      },
    });

    yield* Effects.sleep(100);
    expect(intercepted).toBe(true);
  });
});
