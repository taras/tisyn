/**
 * Cancellation tests — Close(cancelled) journaling and ordering.
 *
 * See Compound Concurrency Spec §10.5, Test Plan §6.3.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { AgentRegistry } from "@tisyn/agent";
import type { CloseEvent, DurableEvent } from "@tisyn/kernel";

// ── IR helpers ──

function effectIR(agentType: string, opName: string, data: unknown = []) {
  return { tisyn: "eval", id: `${agentType}.${opName}`, data };
}

function allIR(...exprs: unknown[]) {
  return {
    tisyn: "eval",
    id: "all",
    data: { tisyn: "quote", expr: { exprs } },
  };
}

function raceIR(...exprs: unknown[]) {
  return {
    tisyn: "eval",
    id: "race",
    data: { tisyn: "quote", expr: { exprs } },
  };
}

// ── Tests ──

describe("Cancellation", () => {
  it("normal completion writes Close(ok), not Close(cancelled)", function* () {
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      return 42;
    });

    const ir = effectIR("a", "op1");
    const { result, journal } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("ok");

    // Root should have Close(ok)
    const rootCloses = journal.filter(
      (e): e is CloseEvent => e.type === "close" && e.coroutineId === "root",
    );
    expect(rootCloses.length).toBe(1);
    expect(rootCloses[0]!.result.status).toBe("ok");
  });

  it("error completion writes Close(err), not Close(cancelled)", function* () {
    const agents = new AgentRegistry();
    agents.register("a", function* () {
      throw new Error("boom");
    });

    const ir = effectIR("a", "op1");
    const { result, journal } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("err");

    const rootCloses = journal.filter(
      (e): e is CloseEvent => e.type === "close" && e.coroutineId === "root",
    );
    expect(rootCloses.length).toBe(1);
    expect(rootCloses[0]!.result.status).toBe("err");
  });

  it("all children have close events in journal", function* () {
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      return 42;
    });

    const ir = allIR(
      effectIR("a", "op1"),
      effectIR("a", "op2"),
      effectIR("a", "op3"),
    );

    const { result, journal } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("ok");

    // All 3 children should have close events
    const childCloses = journal.filter(
      (e): e is CloseEvent =>
        e.type === "close" && e.coroutineId.startsWith("root."),
    );
    expect(childCloses.length).toBe(3);
  });

  it("race losers have close events in journal", function* () {
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      return 42;
    });

    const ir = raceIR(effectIR("a", "op1"), effectIR("a", "op2"));

    const { result, journal } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("ok");

    // Both children should have close events
    const childCloses = journal.filter(
      (e): e is CloseEvent =>
        e.type === "close" && e.coroutineId.startsWith("root."),
    );
    expect(childCloses.length).toBe(2);
  });

  it("child close events precede root close in journal", function* () {
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      return 42;
    });

    const ir = allIR(effectIR("a", "op1"), effectIR("a", "op2"));

    const { result, journal } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("ok");

    // Find positions
    const rootCloseIdx = journal.findIndex(
      (e) => e.type === "close" && e.coroutineId === "root",
    );
    const childCloseIndices = journal
      .map((e, i) =>
        e.type === "close" && e.coroutineId.startsWith("root.") ? i : -1,
      )
      .filter((i) => i >= 0);

    expect(rootCloseIdx).toBeGreaterThan(-1);
    expect(childCloseIndices.length).toBe(2);

    // All child closes should come before root close
    for (const childIdx of childCloseIndices) {
      expect(childIdx).toBeLessThan(rootCloseIdx);
    }
  });
});
