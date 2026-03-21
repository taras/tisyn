/**
 * Task tree tests — all/race compound orchestration.
 *
 * See Compound Concurrency Spec §7, Test Plan §6.4.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { AgentRegistry } from "@tisyn/agent";
import type { CloseEvent, DurableEvent, YieldEvent } from "@tisyn/kernel";

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

describe("all", () => {
  it("results in exprs order", function* () {
    const agents = new AgentRegistry();
    const values = [10, 20, 30];
    let callIndex = 0;
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* (operation) {
      const val = values[callIndex++];
      return val;
    });

    const ir = allIR(effectIR("a", "op1"), effectIR("a", "op2"), effectIR("a", "op3"));

    const { result } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual([10, 20, 30]);
    }
  });

  it("empty exprs returns []", function* () {
    const ir = allIR();
    const { result } = yield* execute({ ir: ir as never });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual([]);
    }
  });

  it("child failure propagates error", function* () {
    const agents = new AgentRegistry();
    let callCount = 0;
    agents.register("a", function* (operation) {
      callCount++;
      if (operation === "fail") {
        throw new Error("child failed");
      }
      return 42;
    });

    const ir = allIR(effectIR("a", "ok"), effectIR("a", "fail"), effectIR("a", "ok"));

    const { result } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("err");
    if (result.status === "err") {
      expect(result.error.message).toBe("child failed");
    }
  });

  it("lowest-index error wins when multiple children fail", function* () {
    const agents = new AgentRegistry();
    agents.register("a", function* (operation) {
      if (operation === "fail1") throw new Error("error from child 0");
      if (operation === "fail2") throw new Error("error from child 1");
      return 42;
    });

    const ir = allIR(effectIR("a", "fail1"), effectIR("a", "fail2"));

    const { result } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("err");
    if (result.status === "err") {
      expect(result.error.message).toBe("error from child 0");
    }
  });

  it("child close events appear in journal", function* () {
    const agents = new AgentRegistry();
    agents.register("a", function* (operation) {
      if (operation === "fail") throw new Error("boom");
      return 42;
    });

    const ir = allIR(effectIR("a", "ok"), effectIR("a", "fail"));

    const { result, journal } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("err");

    // All children should have close events (ok or err)
    const childCloses = journal.filter(
      (e): e is CloseEvent => e.type === "close" && e.coroutineId.startsWith("root."),
    );
    expect(childCloses.length).toBe(2);
  });
});

describe("race", () => {
  it("first complete wins", function* () {
    const agents = new AgentRegistry();
    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* (operation) {
      if (operation === "fast") return "winner";
      return "loser";
    });

    const ir = raceIR(effectIR("a", "fast"), effectIR("a", "slow"));

    const { result } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // One of the values should win
      expect(["winner", "loser"]).toContain(result.value);
    }
  });

  it("all children have close events in journal", function* () {
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
      (e): e is CloseEvent => e.type === "close" && e.coroutineId.startsWith("root."),
    );
    expect(childCloses.length).toBe(2);
  });

  it("failure does not win", function* () {
    const agents = new AgentRegistry();
    agents.register("a", function* (operation) {
      if (operation === "fail") throw new Error("nope");
      return "success";
    });

    const ir = raceIR(effectIR("a", "fail"), effectIR("a", "ok"));

    const { result } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe("success");
    }
  });

  it("all fail -> lowest-index error", function* () {
    const agents = new AgentRegistry();
    agents.register("a", function* (operation) {
      if (operation === "fail1") throw new Error("error 0");
      if (operation === "fail2") throw new Error("error 1");
      throw new Error("unknown");
    });

    const ir = raceIR(effectIR("a", "fail1"), effectIR("a", "fail2"));

    const { result } = yield* execute({ ir: ir as never, agents });

    expect(result.status).toBe("err");
    if (result.status === "err") {
      expect(result.error.message).toBe("error 0");
    }
  });

  it("empty exprs is RuntimeBugError", function* () {
    const ir = raceIR();

    const { result } = yield* execute({ ir: ir as never });

    expect(result.status).toBe("err");
    if (result.status === "err") {
      expect(result.error.name).toBe("RuntimeBugError");
      expect(result.error.message).toContain("empty");
    }
  });
});
