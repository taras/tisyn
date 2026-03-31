/**
 * Spawn/join orchestration tests.
 *
 * See Spawn Specification §R1–R18 and Test Plan.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { Effects } from "@tisyn/agent";
import { Seq, Ref, Try, Throw } from "@tisyn/ir";
import type { IrInput } from "@tisyn/ir";

// ── IR helpers ──

const spawnIR = (body: unknown) =>
  ({
    tisyn: "eval",
    id: "spawn",
    data: { tisyn: "quote", expr: { body } },
  }) as unknown as IrInput;

const joinIR = (refName: string) =>
  ({
    tisyn: "eval",
    id: "join",
    data: { tisyn: "ref", name: refName },
  }) as unknown as IrInput;

const effectIR = (agentType: string, opName: string, data: unknown = []) =>
  ({ tisyn: "eval", id: `${agentType}.${opName}`, data }) as unknown as IrInput;

const letIR = (name: string, value: unknown, body: unknown) =>
  ({
    tisyn: "eval",
    id: "let",
    data: { tisyn: "quote", expr: { name, value, body } },
  }) as unknown as IrInput;

// ── Tests ──

describe("spawn orchestration", () => {
  // R1: deterministic child ID
  it("spawned child gets deterministic ID root.0", function* () {
    const ir = letIR("task", spawnIR(42), joinIR("task"));
    const { journal } = yield* execute({ ir });
    const childClose = journal.filter(
      (e) => e.type === "close" && (e as any).coroutineId !== "root",
    );
    expect(childClose).toHaveLength(1);
    expect((childClose[0] as any).coroutineId).toBe("root.0");
  });

  // R4: spawn returns immediately, R7: join returns child value
  it("spawn returns task handle, join returns child value", function* () {
    const ir = letIR("task", spawnIR(42), joinIR("task"));
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: 42 });
  });

  // R7: join returns child success value (complex expression)
  it("join returns child's computed value", function* () {
    const childBody = {
      tisyn: "eval",
      id: "add",
      data: { tisyn: "quote", expr: { a: 10, b: 32 } },
    };
    const ir = letIR("task", spawnIR(childBody), joinIR("task"));
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: 42 });
  });

  // Unjoined child is torn down when parent exits (structured concurrency).
  // Spawned tasks live as long as the parent scope but not longer.
  it("unjoined child does not outlive parent scope", function* () {
    // Parent spawns a child but doesn't join — just returns immediately
    const ir = Seq(spawnIR(42), "parent-done");
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: "parent-done" });
  });

  // No YieldEvents for spawn/join
  it("spawn/join produce no YieldEvents", function* () {
    const ir = letIR("task", spawnIR(42), joinIR("task"));
    const { journal } = yield* execute({ ir });
    const yieldEvents = journal.filter((e) => e.type === "yield");
    expect(yieldEvents).toHaveLength(0);
  });

  // Runtime invariant: join on non-task value
  it("join on non-task value throws RuntimeBugError", function* () {
    // Hand-built IR: let x = 42, then join(x)
    const ir = letIR("x", 42, joinIR("x"));
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("err");
    expect((result as any).error.message).toContain("not a valid task handle");
  });

  // R8: duplicate join
  it("duplicate join throws RuntimeBugError", function* () {
    const ir = letIR(
      "task",
      spawnIR(42),
      Seq(joinIR("task"), joinIR("task")),
    );
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("err");
    expect((result as any).error.message).toContain("already been joined");
  });

  // R12: child failure tears down parent
  it("child failure tears down parent scope", function* () {
    const ir = letIR(
      "task",
      spawnIR(Throw("child failed")),
      joinIR("task"),
    );
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("err");
    expect((result as any).error.message).toContain("child failed");
  });

  // R13a: outer catch catches child failure
  it("outer try/catch catches spawned child failure", function* () {
    const scope = (body: unknown) =>
      ({
        tisyn: "eval",
        id: "scope",
        data: { tisyn: "quote", expr: { handler: null, bindings: {}, body } },
      });

    const innerIR = letIR(
      "task",
      spawnIR(Throw("child boom")),
      joinIR("task"),
    );

    const ir = Try(scope(innerIR), "e", Ref("e"));
    const { result } = yield* execute({ ir });
    expect(result.status).toBe("ok");
    // The caught error value contains the message
    expect(String((result as any).value)).toContain("child boom");
  });

  // Multiple spawns get sequential IDs
  it("multiple spawns get sequential child IDs", function* () {
    const ir = Seq(
      letIR("t1", spawnIR(1), letIR("t2", spawnIR(2), Seq(joinIR("t1"), joinIR("t2")))),
    );
    const { journal } = yield* execute({ ir });
    const childCloses = journal
      .filter((e) => e.type === "close" && (e as any).coroutineId !== "root")
      .map((e) => (e as any).coroutineId)
      .sort();
    expect(childCloses).toContain("root.0");
    expect(childCloses).toContain("root.1");
  });

  // Spawned child inherits parent transport/middleware
  it("spawned child inherits parent transport", function* () {
    let childDispatched = false;
    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([effectId, _data]: [string, any]) {
        if (effectId === "test.op") {
          childDispatched = true;
          return "result";
        }
        return null;
      },
    });

    const ir = letIR(
      "task",
      spawnIR(effectIR("test", "op")),
      joinIR("task"),
    );
    const { result } = yield* execute({ ir });
    expect(result).toEqual({ status: "ok", value: "result" });
    expect(childDispatched).toBe(true);
  });
});
