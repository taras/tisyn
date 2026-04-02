/**
 * Runtime tests for browser contract scope orchestration and replay.
 *
 * Validates that:
 * - Scope with browser binding executes body via transport
 * - Browser.execute effects dispatch through bound transport
 * - Completed browser scope replays from journal without live dispatch
 * - Incomplete browser scope transitions to live dispatch at frontier
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Ref, Get, Let } from "@tisyn/ir";
import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { YieldEvent, DurableEvent } from "@tisyn/kernel";

// ── Agent + IR helpers ──

const browserAgent = agent("browser", {
  execute: operation<{ workflow: unknown }, unknown>(),
});

const scope = (body: unknown, handler: unknown = null, bindings: unknown = {}) =>
  ({
    tisyn: "eval",
    id: "scope",
    data: { tisyn: "quote", expr: { handler, bindings, body } },
  }) as unknown as import("@tisyn/ir").IrInput;

function effectIR(agentType: string, opName: string, data: unknown = {}) {
  return { tisyn: "eval", id: `${agentType}.${opName}`, data };
}

function yieldEvent(type: string, name: string, value: unknown, coroutineId: string): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type, name },
    result: { status: "ok", value: value as never },
  };
}

// ── Fresh execution tests ──

describe("Browser scope — fresh execution", () => {
  it("scope with browser binding executes body", function* () {
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute() {
        return { result: "executed" };
      },
    });

    // Scope with browser binding, literal body
    const ir = scope(42, null, { browser: Get(Ref("envObj"), "transport") });
    const { result } = yield* execute({
      ir,
      // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
      env: { envObj: { transport: factory } as any },
    });
    expect(result).toEqual({ status: "ok", value: 42 });
  });

  it("browser.execute effect dispatches through bound transport", function* () {
    let executeCalled = false;
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute(params: { workflow: unknown }) {
        executeCalled = true;
        return { workflow: params.workflow, status: "done" };
      },
    });

    const body = effectIR("browser", "execute", { workflow: { test: true } });
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });
    const { result } = yield* execute({
      ir,
      // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
      env: { envObj: { transport: factory } as any },
    });
    expect(executeCalled).toBe(true);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toMatchObject({
        workflow: { test: true },
        status: "done",
      });
    }
  });

  it("multiple browser.execute effects dispatch sequentially", function* () {
    const calls: number[] = [];
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute(params: { workflow: unknown }) {
        const n = (params.workflow as any).n;
        calls.push(n);
        return { n, ok: true };
      },
    });

    // Chain: execute(1) → execute(2) → execute(3) using Let bindings
    const body = Let(
      "_e1",
      effectIR("browser", "execute", { workflow: { n: 1 } }),
      Let(
        "_e2",
        effectIR("browser", "execute", { workflow: { n: 2 } }),
        effectIR("browser", "execute", { workflow: { n: 3 } }),
      ),
    );
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });
    const { result, journal } = yield* execute({
      ir,
      // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
      env: { envObj: { transport: factory } as any },
    });

    expect(calls).toEqual([1, 2, 3]);
    expect(result.status).toBe("ok");

    // Journal should contain YieldEvents for all three browser effects
    const yieldEvents = journal.filter(
      (e) => e.type === "yield" && (e as YieldEvent).description.type === "browser",
    );
    expect(yieldEvents).toHaveLength(3);
  });
});

// ── Replay tests ──

describe("Browser scope — replay", () => {
  it("completed browser scope replays from journal without live dispatch (RP3/RP4/RP6/RP7)", function* () {
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute(params: { workflow: unknown }) {
        return { result: params.workflow };
      },
    });

    const body = effectIR("browser", "execute", { workflow: "hello" });
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });
    // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
    const env = { envObj: { transport: factory } as any };

    // Run 1: fresh execution — capture journal
    const run1 = yield* scoped(function* () {
      return yield* execute({ ir, env });
    });

    expect(run1.result.status).toBe("ok");

    // Run 2: replay from stored journal with a spy transport
    let spyCalled = false;
    const spyFactory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute() {
        spyCalled = true;
        return { result: "spy" };
      },
    });

    const stream = new InMemoryStream(run1.journal);
    const run2 = yield* scoped(function* () {
      return yield* execute({
        ir,
        // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
        env: { envObj: { transport: spyFactory } as any },
        stream,
      });
    });

    expect(spyCalled).toBe(false);
    expect(run2.result).toEqual(run1.result);
  });

  it("completed browser scope replay produces same result value (RP7)", function* () {
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute(params: { workflow: unknown }) {
        return { computed: "value", input: params.workflow };
      },
    });

    // Use Let to bind execute result and return it
    const body = Let(
      "execResult",
      effectIR("browser", "execute", { workflow: { data: 42 } }),
      Ref("execResult"),
    );
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });
    // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
    const env = { envObj: { transport: factory } as any };

    // Run 1: fresh
    const run1 = yield* scoped(function* () {
      return yield* execute({ ir, env });
    });

    expect(run1.result.status).toBe("ok");
    if (run1.result.status === "ok") {
      expect(run1.result.value).toMatchObject({ computed: "value" });
    }

    // Run 2: replay — should produce identical result
    const spyFactory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute() {
        return { computed: "spy", input: "spy" };
      },
    });

    const stream = new InMemoryStream(run1.journal);
    const run2 = yield* scoped(function* () {
      return yield* execute({
        ir,
        // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
        env: { envObj: { transport: spyFactory } as any },
        stream,
      });
    });

    expect(run2.result).toEqual(run1.result);
  });

  it("incomplete browser scope transitions to live dispatch at frontier (v0.1.0)", function* () {
    // Construct a partial journal: scope child has a YieldEvent but no CloseEvent
    const stored: DurableEvent[] = [
      yieldEvent("browser", "execute", { result: "first" }, "root.0"),
      // No closeOk for root.0 — scope is incomplete
    ];

    let liveCalled = false;
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *execute() {
        liveCalled = true;
        return { result: "live" };
      },
    });

    // Body: execute (replayed) → execute (should go live)
    const body = Let(
      "_first",
      effectIR("browser", "execute", { workflow: "first" }),
      effectIR("browser", "execute", { workflow: "second" }),
    );
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });

    const stream = new InMemoryStream(stored);
    const { result } = yield* execute({
      ir,
      // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
      env: { envObj: { transport: factory } as any },
      stream,
    });

    // The second execute effect should have dispatched live at the frontier
    expect(liveCalled).toBe(true);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual({ result: "live" });
    }
  });
});
