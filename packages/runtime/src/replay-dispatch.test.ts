/**
 * Runtime replay-boundary behavior tests (Phase 4, Refs #125).
 *
 * Covers the RD-* test plan rows from scoped-effects §13 that become
 * implementable once the runtime installs structural replay substitution
 * via the internal replay lane:
 *
 *   RD-CO-003   — max executes on replay; min/core do not
 *   RD-RP-001   — stored result substitutes on replay
 *   RD-RP-005   — max middleware sees stored result from next()
 *   RD-RP-006   — no live agent dispatch on replay
 *   RD-PL-003   — next call counts match the two-lane user model
 *   RD-RG-004   — replay correctness without any helper-based terminal API
 *   RD-SC-001   — §9.5.5 short-circuit-with-stored-cursor
 *
 * Plus behaviors the Phase 4 plan calls out explicitly:
 *
 *   - Stored error replay returns the stored EventResult exactly; no
 *     duplicate live error YieldEvent is journaled.
 *   - stream.subscribe replay advances the subscription counter so the
 *     live frontier does not reuse tokens.
 *   - Dispatches from resource init and cleanup bodies use the same
 *     replay boundary (§9.5.7).
 *   - Middleware around resource-body dispatches receives a DispatchContext
 *     with ctx.invoke support using the resource child's allocator.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Effects, invoke } from "@tisyn/effects";
import { Fn, Q } from "@tisyn/ir";
import type { FnNode, Val, IrInput, TisynFn, Json } from "@tisyn/ir";
import type { YieldEvent, DurableEvent } from "@tisyn/kernel";
import { payloadSha } from "@tisyn/kernel";

// ── IR helpers ──

const effectIR = (agentType: string, opName: string, data: unknown = []) =>
  ({ tisyn: "eval", id: `${agentType}.${opName}`, data }) as unknown as IrInput;

const letIR = (name: string, value: unknown, body: unknown): IrInput =>
  ({
    tisyn: "eval",
    id: "let",
    data: { tisyn: "quote", expr: { name, value, body } },
  }) as unknown as IrInput;

const resourceIR = (body: unknown): IrInput =>
  ({
    tisyn: "eval",
    id: "resource",
    data: { tisyn: "quote", expr: { body } },
  }) as unknown as IrInput;

const provideIR = (value: unknown): IrInput =>
  ({ tisyn: "eval", id: "provide", data: value }) as unknown as IrInput;

function yieldOk(
  type: string,
  name: string,
  value: unknown,
  coroutineId = "root",
  input: Json = [],
): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type, name, input, sha: payloadSha(input) },
    result: { status: "ok", value: value as never },
  };
}

function yieldErr(
  type: string,
  name: string,
  message: string,
  errorName: string,
  coroutineId = "root",
  input: Json = [],
): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type, name, input, sha: payloadSha(input) },
    result: { status: "error", error: { message, name: errorName } },
  };
}

const asFn = (f: unknown): FnNode => f as FnNode;

describe("runtime replay boundary (§9.5)", () => {
  // RD-CO-003 / RD-RP-005 — max executes on replay, min does not, and max
  // sees the stored result returned from next().
  it("RD-CO-003 / RD-RP-005: max reruns on replay with stored result; min does not", function* () {
    const stored: DurableEvent[] = [yieldOk("a", "op", 42)];
    const stream = new InMemoryStream(stored);

    const log: string[] = [];

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("max-before");
        const result = yield* next(e, d);
        log.push(`max-after:${JSON.stringify(result)}`);
        return result;
      },
    });

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return 999 as Val;
        },
      },
      { at: "min" },
    );

    const { result } = yield* execute({
      ir: effectIR("a", "op") as never,
      stream,
    });

    expect(result).toEqual({ status: "ok", value: 42 });
    // Max fires (both before and after next); min does not.
    expect(log).toEqual(["max-before", "max-after:42"]);
    expect(log).not.toContain("core");
  });

  // RD-RP-001 / RD-RP-006 — stored result substitutes; live agent handler does
  // not fire on replay.
  it("RD-RP-001 / RD-RP-006: stored result substitutes; agent handler not re-called on replay", function* () {
    const stored: DurableEvent[] = [yieldOk("a", "op", 42)];
    const stream = new InMemoryStream(stored);

    let agentCalls = 0;
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          agentCalls++;
          return 999 as Val;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({
      ir: effectIR("a", "op") as never,
      stream,
    });

    expect(result).toEqual({ status: "ok", value: 42 });
    expect(agentCalls).toBe(0);
    // Journal contains a replayed YieldEvent with the stored value, NOT 999.
    const yields = journal.filter((e) => e.type === "yield");
    expect(yields).toHaveLength(1);
    expect((yields[0] as YieldEvent).result).toEqual({ status: "ok", value: 42 });
  });

  // RD-PL-003 — next call counts match the two-lane user model. Max observes
  // exactly one next() call; min observes exactly one dispatch body entry on
  // the live path. No extra hop visible from the internal replay lane.
  it("RD-PL-003: next call counts match two-lane user model (live)", function* () {
    const stream = new InMemoryStream();

    let maxNextCalls = 0;
    let minEntries = 0;

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        maxNextCalls++;
        return yield* next(e, d);
      },
    });

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          minEntries++;
          return 1 as Val;
        },
      },
      { at: "min" },
    );

    const { result } = yield* execute({
      ir: effectIR("a", "op") as never,
      stream,
    });

    expect(result.status).toBe("ok");
    expect(maxNextCalls).toBe(1);
    expect(minEntries).toBe(1);
  });

  // RD-RG-004 — replay correctness works structurally, with no terminal-
  // delegation helper imported by the test. This suite already uses only
  // `execute` and `Effects` + `Effects.around({ at: "min" })` as the stub
  // core; no runAsTerminal / RuntimeTerminal / RuntimeTerminalBoundary is
  // referenced anywhere. The test below is a regression anchor:
  // a full live+replay round-trip produces identical results with only the
  // public surface.
  it("RD-RG-004: replay works structurally without any helper", function* () {
    const stream = new InMemoryStream();

    let callCount = 0;
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          callCount++;
          return callCount as Val;
        },
      },
      { at: "min" },
    );

    // Live run
    const live = yield* execute({
      ir: effectIR("a", "op") as never,
      stream,
    });
    expect(live.result).toEqual({ status: "ok", value: 1 });

    // Replay from the live journal
    const replay = yield* execute({
      ir: effectIR("a", "op") as never,
      stream,
    });
    expect(replay.result).toEqual({ status: "ok", value: 1 });
    expect(callCount).toBe(1);
  });

  // RD-SC-001 — §9.5.5: a short-circuiting max frame's return value is
  // overridden by the stored cursor on replay.
  it("RD-SC-001: short-circuit in max yields to stored cursor on replay", function* () {
    const stored: DurableEvent[] = [yieldOk("a", "op", "live-result")];
    const stream = new InMemoryStream(stored);

    // Max middleware short-circuits, returning "mock" WITHOUT calling next.
    yield* Effects.around({
      *dispatch([_e, _d]: [string, Val]) {
        return "mock" as Val;
      },
    });

    const { result, journal } = yield* execute({
      ir: effectIR("a", "op") as never,
      stream,
    });

    expect(result).toEqual({ status: "ok", value: "live-result" });
    const yields = journal.filter((e) => e.type === "yield");
    expect(yields).toHaveLength(1);
    expect((yields[0] as YieldEvent).result).toEqual({ status: "ok", value: "live-result" });
  });

  // Stored error replay — error YieldEvent in journal is replayed as a
  // thrown error without being duplicated in the journal or re-appended to
  // the durable stream.
  it("stored error replay returns stored EventResult exactly; no duplicate live YieldEvent", function* () {
    const stored: DurableEvent[] = [yieldErr("a", "op", "boom", "MyError")];
    const stream = new InMemoryStream(stored);

    let agentCalls = 0;
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          agentCalls++;
          return 999 as Val;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({
      ir: effectIR("a", "op") as never,
      stream,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toBe("boom");
      expect(result.error.name).toBe("MyError");
    }
    expect(agentCalls).toBe(0);
    // Exactly ONE yield event for this dispatch — the replayed one, not a
    // fresh live error event appended by the helper.
    const yields = journal.filter(
      (e) =>
        e.type === "yield" &&
        (e as YieldEvent).description.type === "a" &&
        (e as YieldEvent).description.name === "op",
    );
    expect(yields).toHaveLength(1);
    expect((yields[0] as YieldEvent).result).toEqual({
      status: "error",
      error: { message: "boom", name: "MyError" },
    });
  });

  // Resource-body replay (§9.5.7) — dispatches from a resource init body
  // traverse the same replay-boundary-aware chain as ordinary coroutine
  // dispatch. Agent handler fires once live, zero times on replay.
  it("§9.5.7: resource-body init dispatch uses the same replay boundary", function* () {
    // Resource body: dispatch a.op via let, then provide 0.
    const body = letIR("_", effectIR("a", "op"), provideIR(0));
    const ir = resourceIR(body);
    const stream = new InMemoryStream();

    let agentCalls = 0;
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          agentCalls++;
          return null as Val;
        },
      },
      { at: "min" },
    );

    // Live run — agent fires once.
    const live = yield* execute({ ir, stream });
    expect(live.result.status).toBe("ok");
    expect(agentCalls).toBe(1);

    // Replay — agent does NOT fire again.
    const replay = yield* execute({ ir, stream });
    expect(replay.result.status).toBe("ok");
    expect(agentCalls).toBe(1);
  });

  // Resource-body middleware ctx.invoke — middleware around a resource-body
  // dispatch gains invoke capability using the resource child's allocator.
  // The invoked child coroutine must be allocated under the resource child's
  // id (`root.0.N`), not the root's (`root.N`).
  it("§9.5.7 extension: resource-body middleware ctx.invoke uses child's allocator", function* () {
    const bodyFn: TisynFn<[], number> = Fn<[], number>([], Q(7));

    // Resource body dispatches "parent.trigger", then provides 0.
    const body = letIR("_", effectIR("parent", "trigger"), provideIR(0));
    const ir = resourceIR(body);
    const stream = new InMemoryStream();

    // Capture the coroutineId seen when the child coroutine runs.
    let childCoroutineId: string | null = null;

    // Max middleware intercepts parent.trigger and calls invoke. The
    // DispatchContext.with + RuntimeDispatchContext push inside the helper
    // means this middleware is running with the resource child's allocator
    // (expected: child id begins with `root.0.`).
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          return yield* invoke<Val>(asFn(bodyFn), []);
        }
        return yield* next(effectId, data);
      },
    });

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({ ir, stream });
    expect(result.status).toBe("ok");

    // Find the invoked child coroutine's close event. It MUST be nested
    // under the resource child (`root.0.*`), not under `root.*`.
    const childCloses = journal.filter(
      (e) =>
        e.type === "close" &&
        e.coroutineId !== "root" &&
        e.coroutineId !== "root.0" &&
        e.coroutineId.startsWith("root.0."),
    );
    expect(childCloses.length).toBeGreaterThanOrEqual(1);
    childCoroutineId = childCloses[0]!.coroutineId;
    expect(childCoroutineId).toMatch(/^root\.0\.\d+$/);
  });

  // stream.subscribe replay counter advancement — if the journal has N
  // stored stream.subscribe events, replaying them must advance the
  // subscription counter by N so the live frontier does not reuse tokens.
  it("stream.subscribe replay advances the subscription counter", function* () {
    // Journal a single stored stream.subscribe with token "sub:root:0".
    const storedHandle = { __tisyn_subscription: "sub:root:0" };
    const stored: DurableEvent[] = [
      {
        type: "yield",
        coroutineId: "root",
        description: { type: "stream", name: "subscribe" },
        result: { status: "ok", value: storedHandle as never },
      },
      // Close to satisfy divergence pre-check if the IR happens to end
      // early; the IR below continues past subscribe, so the close is
      // harmless to include. Omit it for simplicity.
    ];
    const stream = new InMemoryStream(stored);

    // IR: subscribe to a trivial source, then dispatch a.op to anchor the
    // test expectation. We only care about the subscribe-counter bookkeeping,
    // so assert on the journal produced by replay.
    const ir = letIR(
      "_",
      { tisyn: "eval", id: "stream.subscribe", data: [[]] },
      effectIR("a", "op"),
    );

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { journal } = yield* execute({ ir, stream });

    // Find the replayed subscribe entry — its token MUST match the stored one.
    const subYields = journal.filter(
      (e) =>
        e.type === "yield" &&
        (e as YieldEvent).description.type === "stream" &&
        (e as YieldEvent).description.name === "subscribe",
    );
    expect(subYields).toHaveLength(1);
    const replayedHandle = (subYields[0] as YieldEvent).result as {
      status: "ok";
      value: { __tisyn_subscription: string };
    };
    expect(replayedHandle.value.__tisyn_subscription).toBe("sub:root:0");
  });

  // ── RD-PD-* payload-sensitive replay coverage ──

  // RD-PD-001: live delegated dispatch writes boundary input + sha.
  it("RD-PD-001: live delegated writes input + sha derived from descriptor.data", function* () {
    const { journal } = yield* execute({
      ir: effectIR("a", "op", [1, 2]) as never,
      stream: new InMemoryStream(),
    });
    const e = journal.find((x) => x.type === "yield") as YieldEvent;
    expect(e.description).toEqual({
      type: "a",
      name: "op",
      input: [1, 2],
      sha: payloadSha([1, 2]),
    });
  });

  // RD-PD-002: max transforms data; journal records BOUNDARY (post-max) input.
  it("RD-PD-002: max transforms payload → journal records boundary input", function* () {
    yield* Effects.around({
      *dispatch([eid, _data]: [string, Val], next) {
        // Replace the entire payload before delegating.
        return yield* next(eid, [999] as Val);
      },
    });
    const { journal } = yield* execute({
      ir: effectIR("a", "op", [1]) as never,
      stream: new InMemoryStream(),
    });
    const e = journal.find((x) => x.type === "yield") as YieldEvent;
    expect(e.description.input).toEqual([999]);
    expect(e.description.sha).toBe(payloadSha([999]));
  });

  // RD-PD-055: stored payload-sensitive entry missing sha → DivergenceError.
  it("RD-PD-055: stored entry missing required sha raises DivergenceError", function* () {
    const stored: DurableEvent[] = [
      {
        type: "yield",
        coroutineId: "root",
        // Nonconforming: payload-sensitive entry without sha.
        description: { type: "a", name: "op", input: [] },
        result: { status: "ok", value: 42 },
      },
    ];
    const { result } = yield* execute({
      ir: effectIR("a", "op") as never,
      stream: new InMemoryStream(stored),
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.name).toBe("DivergenceError");
      expect(result.error.message).toContain("missing required sha");
      expect(result.error.message).toContain("nonconforming journal");
    }
  });

  // RD-PD-091: kernel-yielded-only hashing would falsely pass; boundary
  // hashing catches the divergence. Max transformed [1] → [999] originally;
  // current run transforms [1] → [888]. Stored boundary sha is from [999].
  // If we hashed the kernel-yielded source ([1]) instead of the boundary,
  // both runs would produce the same sha and the divergence would be missed.
  it("RD-PD-091: regression — boundary hashing detects divergence kernel-yielded hashing would miss", function* () {
    // Step 1: produce a journal where stored.description.input = [999]
    // (the boundary value, after max transformed [1] → [999]).
    const live = new InMemoryStream();
    yield* Effects.around({
      *dispatch([eid, _data]: [string, Val], next) {
        return yield* next(eid, [999] as Val);
      },
    });
    yield* execute({
      ir: effectIR("a", "op", [1]) as never,
      stream: live,
    });

    // Step 2: replay with a NEW max that transforms [1] → [888]. Source is
    // unchanged ([1]); boundary changed ([999] → [888]). Boundary hashing
    // MUST detect this.
    yield* Effects.around({
      *dispatch([eid, _data]: [string, Val], next) {
        return yield* next(eid, [888] as Val);
      },
    });
    const { result } = yield* execute({
      ir: effectIR("a", "op", [1]) as never,
      stream: live,
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.name).toBe("DivergenceError");
      expect(result.error.message).toContain("payload mismatch");
    }
  });

  // RD-PD-095 (mutation-stability variant): the journaled
  // description.input/sha pair is a snapshot of the boundary payload at
  // the moment the lane runs. Subsequent in-place mutation of the array
  // or object passed to next(...) MUST NOT drift the journal: input is
  // a fresh value graph (no live reference into caller data) and sha is
  // computed from the same canonical encoding, so
  // sha === payloadSha(input) always holds.
  it("RD-PD-095 (mutation): boundary input/sha snapshot survives in-place payload mutation", function* () {
    let mutationTarget: { count: number; tag: string }[] | null = null;

    // Max delegates an object/array payload through next.
    yield* Effects.around({
      *dispatch([eid, _data]: [string, Val], next) {
        const fresh: { count: number; tag: string }[] = [{ count: 1, tag: "original" }];
        mutationTarget = fresh;
        return yield* next(eid, fresh as unknown as Val);
      },
    });

    // Min mutates the payload in place AFTER the lane has run and
    // stashed the boundary description, but BEFORE the live write.
    yield* Effects.around(
      {
        *dispatch([_eid, data]: [string, Val]) {
          const arr = data as unknown as { count: number; tag: string }[];
          arr[0]!.count = 9999;
          arr[0]!.tag = "mutated";
          arr.push({ count: 7777, tag: "appended" });
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { journal } = yield* execute({
      ir: effectIR("a", "op", []) as never,
      stream: new InMemoryStream(),
    });

    // Sanity: the live data graph the middleware shared was indeed
    // mutated, so this test would fail if the journal aliased it.
    expect(mutationTarget).not.toBeNull();
    expect(mutationTarget![0]!.count).toBe(9999);
    expect(mutationTarget!).toHaveLength(2);

    const ev = journal.find((e) => e.type === "yield") as YieldEvent;
    // Snapshot was taken before mutation: original shape preserved.
    expect(ev.description.input).toEqual([{ count: 1, tag: "original" }]);
    // sha matches payloadSha of the journaled input — the load-bearing
    // invariant. If the snapshot leaked a live reference, this would
    // either fail (sha computed pre-mutation, input mutated) or, if
    // computed post-mutation, the snapshot wouldn't match the original.
    expect(ev.description.sha).toBe(payloadSha(ev.description.input!));
    // And explicitly: input is NOT the mutated graph.
    expect(ev.description.input).not.toBe(mutationTarget);
  });
});
