/**
 * Timebox runtime orchestration tests.
 *
 * See Timebox Specification §8 (Runtime Orchestration) and Test Plan §7.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import type { IrInput, Val } from "@tisyn/ir";
import type { DurableEvent, YieldEvent, CloseEvent } from "@tisyn/kernel";

// ── IR helpers ──

function timeboxIR(duration: unknown, body: unknown): IrInput {
  return {
    tisyn: "eval",
    id: "timebox",
    data: { tisyn: "quote", expr: { duration, body } },
  } as unknown as IrInput;
}

function letIR(name: string, value: unknown, body: unknown): IrInput {
  return {
    tisyn: "eval",
    id: "let",
    data: { tisyn: "quote", expr: { name, value, body } },
  } as unknown as IrInput;
}

function refIR(name: string) {
  return { tisyn: "ref", name };
}

function sleepIR(ms: number) {
  return { tisyn: "eval", id: "sleep", data: [ms] };
}

function spawnIR(body: unknown): IrInput {
  return {
    tisyn: "eval",
    id: "spawn",
    data: { tisyn: "quote", expr: { body } },
  } as unknown as IrInput;
}

function joinIR(refName: string): IrInput {
  return {
    tisyn: "eval",
    id: "join",
    data: { tisyn: "ref", name: refName },
  } as unknown as IrInput;
}

function tryIR(body: unknown, catchParam?: string, catchBody?: unknown): IrInput {
  const fields: Record<string, unknown> = { body };
  if (catchParam !== undefined) fields["catchParam"] = catchParam;
  if (catchBody !== undefined) fields["catchBody"] = catchBody;
  return {
    tisyn: "eval",
    id: "try",
    data: { tisyn: "quote", expr: fields },
  } as unknown as IrInput;
}

function throwIR(message: string): IrInput {
  return {
    tisyn: "eval",
    id: "throw",
    data: { tisyn: "quote", expr: { message } },
  } as unknown as IrInput;
}

// ── Helpers ──

function closeEvents(journal: DurableEvent[]): CloseEvent[] {
  return journal.filter((e) => e.type === "close") as CloseEvent[];
}

function yieldEvents(journal: DurableEvent[]): YieldEvent[] {
  return journal.filter((e) => e.type === "yield") as YieldEvent[];
}

// ── Tests ──

describe("timebox — happy path", () => {
  it("TRT-01: body completes before deadline → completed result", function* () {
    // Body is a literal — completes immediately. Duration is large.
    const ir = timeboxIR(5000, 42);
    const { result } = yield* execute({ ir });
    expect(result).toEqual({
      status: "ok",
      value: { status: "completed", value: 42 },
    });
  });

  it("TRT-03: body returns null → completed with null value", function* () {
    const ir = timeboxIR(5000, null);
    const { result } = yield* execute({ ir });
    expect(result).toEqual({
      status: "ok",
      value: { status: "completed", value: null },
    });
  });

  it("TRT-04: deadline fires before body → timeout result", function* () {
    // Body sleeps for 500ms but timebox duration is 0ms.
    // The body has a pending sleep effect when the timeout fires.
    const ir = timeboxIR(0, sleepIR(500));
    const { result } = yield* execute({ ir });
    expect(result).toEqual({
      status: "ok",
      value: { status: "timeout" },
    });
  });

  it("TRT-05b: zero-duration timeout with pure body → body wins (TB-R6)", function* () {
    // Body is a pure literal (no effects), completes immediately.
    // Both children reach terminal state → body takes precedence.
    const ir = timeboxIR(0, 99);
    const { result } = yield* execute({ ir });
    expect(result).toEqual({
      status: "ok",
      value: { status: "completed", value: 99 },
    });
  });
});

describe("timebox — error propagation", () => {
  it("TRT-10: body throws before deadline → error propagates", function* () {
    const ir = timeboxIR(5000, throwIR("body error"));
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("err");
    if (result.status === "err") {
      expect(result.error.message).toContain("body error");
    }
  });

  it("TRT-11: try/catch around timebox catches inner error", function* () {
    const ir = tryIR(timeboxIR(5000, throwIR("caught")), "e", "recovered");
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: "recovered" });
  });

  it("TRT-12: timeout result does NOT trigger catch", function* () {
    // Timeout is a normal value, not an error.
    const ir = tryIR(timeboxIR(0, sleepIR(500)), "e", "should-not-catch");
    const { result } = yield* execute({ ir });
    expect(result).toEqual({
      status: "ok",
      value: { status: "timeout" },
    });
  });
});

describe("timebox — deterministic child allocation", () => {
  it("TRT-50: single timebox → body is root.0, timeout is root.1", function* () {
    const ir = timeboxIR(5000, 42);
    const { journal } = yield* execute({ ir });

    const closes = closeEvents(journal);
    const childCloses = closes.filter((e) => e.coroutineId !== "root");
    const childIds = childCloses.map((e) => e.coroutineId).sort();

    expect(childIds).toContain("root.0");
    expect(childIds).toContain("root.1");
  });

  it("TRT-51: spawn → timebox → spawn uses sequential IDs", function* () {
    // spawn = root.0, timebox body = root.1, timebox timeout = root.2, spawn = root.3
    // Join both spawns so all children produce CloseEvents.
    const ir = letIR(
      "t1",
      spawnIR(10),
      letIR(
        "tb",
        timeboxIR(5000, 42),
        letIR("t2", spawnIR(20), letIR("_j1", joinIR("t1"), joinIR("t2"))),
      ),
    );
    const { journal } = yield* execute({ ir });

    const closes = closeEvents(journal);
    const childIds = closes
      .filter((e) => e.coroutineId !== "root")
      .map((e) => e.coroutineId)
      .sort();

    // Should have root.0 (spawn), root.1 (timebox body), root.2 (timebox timeout), root.3 (spawn)
    expect(childIds).toContain("root.0");
    expect(childIds).toContain("root.1");
    expect(childIds).toContain("root.2");
    expect(childIds).toContain("root.3");
  });
});

describe("timebox — journal rules", () => {
  it("JRN-01: timebox does NOT produce parent YieldEvent", function* () {
    const ir = timeboxIR(5000, 42);
    const { journal } = yield* execute({ ir });

    const parentYields = yieldEvents(journal).filter((e) => e.coroutineId === "root");
    expect(parentYields).toHaveLength(0);
  });

  it("JRN-04: both children produce CloseEvents", function* () {
    const ir = timeboxIR(5000, 42);
    const { journal } = yield* execute({ ir });

    const childCloses = closeEvents(journal).filter((e) => e.coroutineId !== "root");
    expect(childCloses.length).toBeGreaterThanOrEqual(2);
  });

  it("JRN-03: timeout child sleep produces YieldEvent under timeout coroutineId", function* () {
    // Force timeout to win: body has a pending effect
    const ir = timeboxIR(0, sleepIR(999));
    const { journal } = yield* execute({ ir });

    // Timeout child is root.1, should have a sleep YieldEvent
    const timeoutYields = yieldEvents(journal).filter((e) => e.coroutineId === "root.1");
    expect(timeoutYields.length).toBeGreaterThanOrEqual(1);
    expect(timeoutYields[0].description.name).toBe("sleep");
  });
});

describe("timebox — ref duration", () => {
  it("TRT-31: Ref duration resolves from env", function* () {
    const ir = timeboxIR(refIR("t"), 42);
    const { result } = yield* execute({ ir, env: { t: 5000 as unknown as Val } });
    expect(result).toEqual({
      status: "ok",
      value: { status: "completed", value: 42 },
    });
  });
});
