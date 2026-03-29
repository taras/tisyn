/**
 * Durable StartEvent recording and replay validation tests.
 *
 * DR-1: StartEvent is written to journal when middleware is provided (live)
 * DR-2: StartEvent is NOT written when middleware is null/absent
 * DR-4: replay with same middleware validates successfully
 * DR-5: replay with different middleware returns DivergenceError
 * DR-6: StartEvent appears before first YieldEvent in journal
 * DR-7: StartEvent is persisted to the stream (not just journal)
 * DR-8: execute without middleware field never writes StartEvent even on replay
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import type { Val } from "@tisyn/ir";
import { Eval, Q } from "@tisyn/ir";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Dispatch } from "@tisyn/agent";

describe("Durability replay — StartEvent", () => {
  // DR-1
  it("StartEvent is written to journal when middleware is provided on live execution", function* () {
    const stream = new InMemoryStream();
    const middlewareFn = { type: "fn", params: ["e", "d"], body: { type: "q", value: null } };

    const ir = Q(42);

    const { journal } = yield* execute({ ir, stream, middleware: middlewareFn as Val });

    const startEvent = journal.find((e) => e.type === "start");
    expect(startEvent).toBeDefined();
    expect(startEvent?.type).toBe("start");
    expect((startEvent as any)?.inputs?.middleware).toEqual(middlewareFn);
  });

  // DR-2
  it("StartEvent is NOT written when middleware is null", function* () {
    const stream = new InMemoryStream();
    const ir = Q(42);

    const { journal } = yield* execute({ ir, stream, middleware: null });

    const startEvent = journal.find((e) => e.type === "start");
    expect(startEvent).toBeUndefined();
  });

  // DR-4
  it("replay with same middleware validates successfully", function* () {
    const stream = new InMemoryStream();
    const middlewareFn = { type: "fn", params: ["e", "d"], body: { type: "q", value: null } };
    const ir = Q("result");

    // First run: live
    const first = yield* execute({ ir, stream, middleware: middlewareFn as Val });
    expect(first.result.status).toBe("ok");

    // Second run: replay with same middleware
    const second = yield* execute({ ir, stream, middleware: middlewareFn as Val });
    expect(second.result.status).toBe("ok");
    expect((second.result as any).value).toBe("result");
  });

  // DR-5
  it("replay with different middleware returns DivergenceError", function* () {
    const stream = new InMemoryStream();
    const middlewareFn1 = { type: "fn", params: ["e", "d"], body: { type: "q", value: "v1" } };
    const middlewareFn2 = { type: "fn", params: ["e", "d"], body: { type: "q", value: "v2" } };
    const ir = Q("result");

    // First run: live with middlewareFn1
    const first = yield* execute({ ir, stream, middleware: middlewareFn1 as Val });
    expect(first.result.status).toBe("ok");

    // Second run: replay with different middleware
    const second = yield* execute({ ir, stream, middleware: middlewareFn2 as Val });
    expect(second.result.status).toBe("err");
    expect((second.result as any).error.name).toBe("DivergenceError");
  });

  // DR-6
  it("StartEvent appears before first YieldEvent in journal", function* () {
    const stream = new InMemoryStream();
    const middlewareFn = { type: "fn", params: ["e", "d"], body: { type: "q", value: null } };

    const ir = Eval("test.op", Q(null));

    // Install a handler so the effect doesn't fail
    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([_e, _d]: [string, Val]) {
        return "ok" as Val;
      },
    });

    const { journal } = yield* execute({ ir, stream, middleware: middlewareFn as Val });

    const startIdx = journal.findIndex((e) => e.type === "start");
    const yieldIdx = journal.findIndex((e) => e.type === "yield");

    if (yieldIdx >= 0) {
      expect(startIdx).toBeLessThan(yieldIdx);
    } else {
      // If no yield events, start event should be present
      expect(startIdx).toBeGreaterThanOrEqual(0);
    }
  });

  // DR-7
  it("StartEvent is persisted to the stream", function* () {
    const stream = new InMemoryStream();
    const middlewareFn = { type: "fn", params: ["e", "d"], body: { type: "q", value: null } };
    const ir = Q("result");

    yield* execute({ ir, stream, middleware: middlewareFn as Val });

    const storedEvents = yield* stream.readAll();
    const startEvent = storedEvents.find((e) => e.type === "start");
    expect(startEvent).toBeDefined();
  });

  // DR-8
  it("execute without middleware never writes StartEvent on any run", function* () {
    const stream = new InMemoryStream();
    const ir = Q("result");

    // First run
    const first = yield* execute({ ir, stream });
    expect(first.result.status).toBe("ok");

    // Replay
    const second = yield* execute({ ir, stream });
    expect(second.result.status).toBe("ok");

    const allEvents = yield* stream.readAll();
    const startEvents = allEvents.filter((e) => e.type === "start");
    expect(startEvents).toHaveLength(0);
  });
});
