/**
 * Resource/provide orchestration tests.
 *
 * See Resource Specification §R1–R23 and Test Plan.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { Effects } from "@tisyn/agent";
import { Seq, Try, Throw, Ref } from "@tisyn/ir";
import type { IrInput } from "@tisyn/ir";
import { InMemoryStream } from "@tisyn/durable-streams";

// ── IR helpers ──

const resourceIR = (body: unknown) =>
  ({
    tisyn: "eval",
    id: "resource",
    data: { tisyn: "quote", expr: { body } },
  }) as unknown as IrInput;

const provideIR = (value: unknown) =>
  ({
    tisyn: "eval",
    id: "provide",
    data: value,
  }) as unknown as IrInput;

const letIR = (name: string, value: unknown, body: unknown) =>
  ({
    tisyn: "eval",
    id: "let",
    data: { tisyn: "quote", expr: { name, value, body } },
  }) as unknown as IrInput;

const effectIR = (agentType: string, opName: string, data: unknown = []) =>
  ({ tisyn: "eval", id: `${agentType}.${opName}`, data }) as unknown as IrInput;

// ── Tests ──

describe("resource orchestration", () => {
  // Parent blocks until provide, receives correct value
  it("parent receives provided value", function* () {
    const ir = resourceIR(provideIR(42));
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: 42 });
  });

  // Provide with a computed value
  it("provide with computed expression", function* () {
    const addExpr = {
      tisyn: "eval",
      id: "add",
      data: { tisyn: "quote", expr: { a: 10, b: 32 } },
    };
    const ir = resourceIR(provideIR(addExpr));
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: 42 });
  });

  // Resource child gets deterministic ID
  it("resource child gets deterministic ID root.0", function* () {
    const ir = resourceIR(provideIR(1));
    const { journal } = yield* execute({ ir });
    const childClose = journal.filter(
      (e) => e.type === "close" && (e as any).coroutineId !== "root",
    );
    expect(childClose).toHaveLength(1);
    expect((childClose[0] as any).coroutineId).toBe("root.0");
  });

  // Resource child cleanup runs on normal parent exit
  it("cleanup runs on normal parent exit", function* () {
    const cleanupEffects: string[] = [];
    yield* Effects.around({
      *dispatch([effectId, _data]: [string, unknown]) {
        cleanupEffects.push(effectId);
        return null;
      },
    });

    // Resource body: try { provide(42) } finally { cleanupEffect() }
    const body = Try(provideIR(42), undefined, undefined, effectIR("cleanup", "run"));
    const ir = resourceIR(body);
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: 42 });
    expect(cleanupEffects).toContain("cleanup.run");
  });

  // No YieldEvent for provide (compound externals don't generate YieldEvents)
  it("provide produces no YieldEvent", function* () {
    const ir = resourceIR(provideIR(42));
    const { journal } = yield* execute({ ir });
    const yieldEvents = journal.filter((e) => e.type === "yield");
    expect(yieldEvents).toHaveLength(0);
  });

  // Child Close before parent Close (R23)
  it("child Close comes before parent Close", function* () {
    const ir = resourceIR(provideIR(42));
    const { journal } = yield* execute({ ir });
    const closeEvents = journal.filter((e) => e.type === "close");
    expect(closeEvents).toHaveLength(2);
    const childIdx = closeEvents.findIndex((e) => (e as any).coroutineId === "root.0");
    const parentIdx = closeEvents.findIndex((e) => (e as any).coroutineId === "root");
    expect(childIdx).toBeLessThan(parentIdx);
  });

  // Init effects are journaled under child coroutineId
  it("init effects journaled under child coroutineId", function* () {
    yield* Effects.around({
      *dispatch([effectId, _data]: [string, unknown]) {
        if (effectId === "db.connect") return "conn-handle";
        return null;
      },
    });

    const body = Seq(
      letIR("conn", effectIR("db", "connect"), provideIR(Ref("conn"))),
    );
    const ir = resourceIR(body);
    const { result, journal } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: "conn-handle" });

    const childYields = journal.filter(
      (e) => e.type === "yield" && (e as any).coroutineId === "root.0",
    );
    expect(childYields).toHaveLength(1);
    expect((childYields[0] as any).description.name).toBe("connect");
  });

  // Init failure propagates to parent (catchable)
  it("init failure propagates to parent", function* () {
    const body = Seq(Throw("init failed"), provideIR(42));
    const ir = resourceIR(body);
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("err");
    expect((result as any).error.message).toContain("init failed");
  });

  // Init failure caught by parent try/catch
  it("init failure caught by parent try/catch", function* () {
    const body = Seq(Throw("init boom"), provideIR(42));
    const ir = Try(resourceIR(body), "e", Ref("e"));
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("ok");
    expect(String((result as any).value)).toContain("init boom");
  });

  // Init failure writes child Close(err) before parent error
  it("init failure writes child Close(err)", function* () {
    const body = Seq(Throw("init failed"), provideIR(42));
    const ir = resourceIR(body);
    const { journal } = yield* execute({ ir });
    const childClose = journal.find(
      (e) => e.type === "close" && (e as any).coroutineId === "root.0",
    );
    expect(childClose).toBeDefined();
    expect((childClose as any).result.status).toBe("err");
  });

  // Multiple resources tear down in reverse creation order
  it("multiple resources tear down in reverse order", function* () {
    const teardownOrder: string[] = [];
    yield* Effects.around({
      *dispatch([effectId, _data]: [string, unknown]) {
        teardownOrder.push(effectId);
        return null;
      },
    });

    // Two sequential resources with cleanup effects
    const body1 = Try(provideIR("first"), undefined, undefined, effectIR("cleanup", "first"));
    const body2 = Try(provideIR("second"), undefined, undefined, effectIR("cleanup", "second"));
    const ir = Seq(
      letIR("a", resourceIR(body1), letIR("b", resourceIR(body2), "done")),
    );
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: "done" });
    // Reverse order: second created = first torn down
    expect(teardownOrder).toEqual(["cleanup.second", "cleanup.first"]);
  });

  // Malformed hand-built provide outside resource context
  it("provide outside resource context fails", function* () {
    const ir = provideIR(42);
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("err");
    expect((result as any).error.message).toContain("provide outside resource context");
  });

  // Resource with init effects and cleanup effects
  it("cleanup yieldIndex continues from init sequence", function* () {
    const effects: string[] = [];
    yield* Effects.around({
      *dispatch([effectId, _data]: [string, unknown]) {
        effects.push(effectId);
        return effectId === "db.connect" ? "handle" : null;
      },
    });

    const body = Seq(
      letIR(
        "conn",
        effectIR("db", "connect"),
        Try(provideIR(Ref("conn")), undefined, undefined, effectIR("db", "disconnect")),
      ),
    );
    const ir = resourceIR(body);
    const { result, journal } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: "handle" });
    expect(effects).toEqual(["db.connect", "db.disconnect"]);

    // Both effects journaled under child
    const childYields = journal.filter(
      (e) => e.type === "yield" && (e as any).coroutineId === "root.0",
    );
    expect(childYields).toHaveLength(2);
  });

  // Replay produces identical results
  it("replay produces identical results", function* () {
    yield* Effects.around({
      *dispatch([effectId, _data]: [string, unknown]) {
        if (effectId === "db.connect") return "handle";
        return null;
      },
    });

    const body = Seq(
      letIR(
        "conn",
        effectIR("db", "connect"),
        Try(provideIR(Ref("conn")), undefined, undefined, effectIR("db", "disconnect")),
      ),
    );
    const ir = resourceIR(body);

    // First run
    const { result: result1, journal: journal1 } = yield* execute({ ir });
    expect(result1).toEqual({ status: "ok", value: "handle" });

    // Replay from the same journal
    const replayStream = new InMemoryStream(journal1);
    const { result: result2 } = yield* execute({ ir, stream: replayStream });
    expect(result2).toEqual({ status: "ok", value: "handle" });
  });
});
