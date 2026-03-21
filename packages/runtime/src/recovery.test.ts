/**
 * Recovery tests — replay for compound effects.
 *
 * See Compound Concurrency Spec §10.6, Test Plan §6.1.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { AgentRegistry } from "@tisyn/agent";
import type { YieldEvent, CloseEvent, DurableEvent } from "@tisyn/kernel";

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

// ── Journal event helpers ──

function yieldEvent(type: string, name: string, value: unknown, coroutineId: string): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type, name },
    result: { status: "ok", value: value as never },
  };
}

function closeOk(value: unknown, coroutineId: string): CloseEvent {
  return {
    type: "close",
    coroutineId,
    result: { status: "ok", value: value as never },
  };
}

function closeErr(message: string, coroutineId: string): CloseEvent {
  return {
    type: "close",
    coroutineId,
    result: { status: "err", error: { message } },
  };
}

function closeCancelled(coroutineId: string): CloseEvent {
  return {
    type: "close",
    coroutineId,
    result: { status: "cancelled" as const },
  };
}

// ── Tests ──

describe("Recovery", () => {
  it("full replay of all — no agent calls", function* () {
    // Pre-populate journal: all(a.op1, a.op2) with both children completed
    const stored: DurableEvent[] = [
      yieldEvent("a", "op1", 10, "root.0"),
      closeOk(10, "root.0"),
      yieldEvent("a", "op2", 20, "root.1"),
      closeOk(20, "root.1"),
    ];

    const stream = new InMemoryStream(stored);

    let agentCalled = false;
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      agentCalled = true;
      return 999;
    });

    const ir = allIR(effectIR("a", "op1"), effectIR("a", "op2"));

    const { result } = yield* execute({
      ir: ir as never,
      stream,
      agents,
    });

    expect(agentCalled).toBe(false);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual([10, 20]);
    }
  });

  it("partial replay mid-all — child 0 replays, child 1 goes live", function* () {
    // Journal has only child 0's events
    const stored: DurableEvent[] = [yieldEvent("a", "op1", 10, "root.0"), closeOk(10, "root.0")];

    const stream = new InMemoryStream(stored);

    let liveCallCount = 0;
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      liveCallCount++;
      return 20;
    });

    const ir = allIR(effectIR("a", "op1"), effectIR("a", "op2"));

    const { result } = yield* execute({
      ir: ir as never,
      stream,
      agents,
    });

    // Only child 1 should dispatch live
    expect(liveCallCount).toBe(1);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual([10, 20]);
    }
  });

  it("crash recovery: no child journal — all children dispatch live", function* () {
    // Empty journal
    const stream = new InMemoryStream();

    let liveCallCount = 0;
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      liveCallCount++;
      return liveCallCount * 10;
    });

    const ir = allIR(effectIR("a", "op1"), effectIR("a", "op2"));

    const { result } = yield* execute({
      ir: ir as never,
      stream,
      agents,
    });

    // Both children should dispatch live
    expect(liveCallCount).toBe(2);
    expect(result.status).toBe("ok");
  });

  it("deterministic child IDs across replay", function* () {
    // Run 1: fresh execution
    const agents1 = new AgentRegistry();
    let callCount1 = 0;
    // biome-ignore lint/correctness/useYield: mock
    agents1.register("a", function* () {
      return ++callCount1 * 10;
    });

    const ir = allIR(effectIR("a", "op1"), effectIR("a", "op2"));
    const { journal: journal1 } = yield* execute({
      ir: ir as never,
      agents: agents1,
    });

    // Run 2: fresh execution with same IR
    const agents2 = new AgentRegistry();
    let callCount2 = 0;
    // biome-ignore lint/correctness/useYield: mock
    agents2.register("a", function* () {
      return ++callCount2 * 10;
    });

    const { journal: journal2 } = yield* execute({
      ir: ir as never,
      agents: agents2,
    });

    // Extract coroutineIds from both runs
    const ids1 = new Set(journal1.map((e) => e.coroutineId));
    const ids2 = new Set(journal2.map((e) => e.coroutineId));

    expect(ids1).toEqual(ids2);
    // Should contain root, root.0, root.1
    expect(ids1.has("root.0")).toBe(true);
    expect(ids1.has("root.1")).toBe(true);
  });

  it("full replay of race — no agent calls", function* () {
    // Pre-populate: race(a.op1, a.op2) where child 0 won
    const stored: DurableEvent[] = [
      yieldEvent("a", "op1", 10, "root.0"),
      closeOk(10, "root.0"),
      closeCancelled("root.1"), // loser was cancelled, never dispatched
    ];

    const stream = new InMemoryStream(stored);

    let agentCalled = false;
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      agentCalled = true;
      return 999;
    });

    const ir = raceIR(effectIR("a", "op1"), effectIR("a", "op2"));

    const { result } = yield* execute({
      ir: ir as never,
      stream,
      agents,
    });

    expect(agentCalled).toBe(false);
    expect(result.status).toBe("ok");
  });
});
