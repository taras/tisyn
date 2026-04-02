/**
 * Runtime tests for browser contract scope orchestration and replay.
 *
 * Validates that:
 * - Scope with browser binding executes body via transport
 * - Browser effects dispatch through bound transport
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
import type { YieldEvent, CloseEvent, DurableEvent } from "@tisyn/kernel";

// ── Agent + IR helpers ──

const browserAgent = agent("browser", {
  navigate: operation<{ url: string }, { page: string; status: number; url: string }>(),
  click: operation<{ selector: string }, { ok: true }>(),
  content: operation<{ format?: string }, { text: string; url: string; title: string }>(),
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

function closeOk(value: unknown, coroutineId: string): CloseEvent {
  return {
    type: "close",
    coroutineId,
    result: { status: "ok", value: value as never },
  };
}

// ── Fresh execution tests ──

describe("Browser scope — fresh execution", () => {
  it("scope with browser binding executes body", function* () {
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *navigate() {
        return { page: "page:0", status: 200, url: "https://example.com" };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        return { text: "hello", url: "https://example.com", title: "Example" };
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

  it("browser effect dispatches through bound transport", function* () {
    let navigateCalled = false;
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *navigate(params: { url: string }) {
        navigateCalled = true;
        return { page: "page:0", status: 200, url: params.url };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        return { text: "", url: "", title: "" };
      },
    });

    const body = effectIR("browser", "navigate", { url: "https://example.com" });
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });
    const { result } = yield* execute({
      ir,
      // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
      env: { envObj: { transport: factory } as any },
    });
    expect(navigateCalled).toBe(true);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toMatchObject({ page: "page:0", status: 200, url: "https://example.com" });
    }
  });

  it("multiple browser effects dispatch sequentially", function* () {
    const calls: string[] = [];
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *navigate() {
        calls.push("navigate");
        return { page: "page:0", status: 200, url: "https://example.com" };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        calls.push("click");
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        calls.push("content");
        return { text: "hello", url: "https://example.com", title: "Example" };
      },
    });

    // Chain: navigate → click → content (using Let bindings)
    const body = Let(
      "_nav",
      effectIR("browser", "navigate", { url: "https://example.com" }),
      Let(
        "_click",
        effectIR("browser", "click", { selector: "#btn" }),
        effectIR("browser", "content", { format: "text" }),
      ),
    );
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });
    const { result, journal } = yield* execute({
      ir,
      // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
      env: { envObj: { transport: factory } as any },
    });

    expect(calls).toEqual(["navigate", "click", "content"]);
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
      *navigate() {
        return { page: "page:0", status: 200, url: "https://example.com" };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        return { text: "hello", url: "https://example.com", title: "Example" };
      },
    });

    const body = effectIR("browser", "navigate", { url: "https://example.com" });
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
      *navigate() {
        spyCalled = true;
        return { page: "page:0", status: 999, url: "spy" };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        spyCalled = true;
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        spyCalled = true;
        return { text: "spy", url: "spy", title: "spy" };
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
      *navigate(params: { url: string }) {
        return { page: "page:0", status: 200, url: params.url };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        return { text: "hello", url: "https://example.com", title: "Example" };
      },
    });

    // Use Let to bind navigate result and return it
    const body = Let(
      "navResult",
      effectIR("browser", "navigate", { url: "https://example.com" }),
      Ref("navResult"),
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
      expect(run1.result.value).toMatchObject({ page: "page:0", status: 200 });
    }

    // Run 2: replay — should produce identical result
    const spyFactory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *navigate() {
        return { page: "page:0", status: 999, url: "spy" };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        return { text: "spy", url: "spy", title: "spy" };
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
    // The scope itself is "root.0", so child effects have coroutineId "root.0"
    const stored: DurableEvent[] = [
      yieldEvent("browser", "navigate", { page: "page:0", status: 200, url: "https://example.com" }, "root.0"),
      // No closeOk for root.0 — scope is incomplete
    ];

    let liveCalled = false;
    const factory = inprocessTransport(browserAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *navigate() {
        return { page: "page:0", status: 200, url: "https://example.com" };
      },
      // biome-ignore lint/correctness/useYield: mock
      *click() {
        liveCalled = true;
        return { ok: true as const };
      },
      // biome-ignore lint/correctness/useYield: mock
      *content() {
        return { text: "", url: "", title: "" };
      },
    });

    // Body: navigate (replayed) → click (should go live)
    const body = Let(
      "_nav",
      effectIR("browser", "navigate", { url: "https://example.com" }),
      effectIR("browser", "click", { selector: "#btn" }),
    );
    const ir = scope(body, null, { browser: Get(Ref("envObj"), "transport") });

    const stream = new InMemoryStream(stored);
    const { result } = yield* execute({
      ir,
      // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable
      env: { envObj: { transport: factory } as any },
      stream,
    });

    // The click effect should have dispatched live at the frontier
    expect(liveCalled).toBe(true);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual({ ok: true });
    }
  });
});
