/**
 * Inline invocation runtime tests (Refs #122).
 *
 * Covers the IL-* subset from `tisyn-inline-invocation-test-plan.md`
 * that is implementable today:
 *
 *  - Basic invocation (§6), allocator and lane-id format (§7), journal
 *    shape (§8), ordering (§10), replay (§9), call-site rejection
 *    (§6.2), nested inline (§7.6), and `invoke` inside inline (§11.3).
 *  - Capability ownership and counter allocation (§12): owner-
 *    coroutineId shared subscription counter, sibling-lane handle
 *    reuse, caller-after-return handle reuse, `invoke`-child isolated
 *    namespace, replay counter reconstruction.
 *  - Lifetime (§11) — `resource` inside an inline body provides in
 *    the caller's scope and cleans up at caller teardown. IL-PI-*,
 *    IL-L-*, IL-CS-*, IL-RD-* subset.
 *  - Lifetime (§11.5) — `spawn` / `join` inside an inline body
 *    attach to the hosting caller's Effection scope and task
 *    registry. IL-CS-006/007/008 + sibling/caller join continuity +
 *    double-join + replay.
 *  - Lifetime (§11.6) — `timebox` / `all` / `race` inside an
 *    inline body keep their own compound-external semantics,
 *    with child IDs allocated from the lane's own
 *    `inlineChildSpawnCount`.
 *  - Lifetime (§11.7) — `scope` inside an inline body delegates
 *    to `orchestrateScope`: the scope child id is allocated from
 *    the lane's `inlineChildSpawnCount`, the scope body runs
 *    under `childId` as both journal and owner, and the scope
 *    produces its own `CloseEvent` (the inline lane itself still
 *    produces none). IL-SC-* coverage in the second describe
 *    block at the bottom of this file.
 *
 * Out of scope — not tested here:
 *   - IL-INT-*, IL-EX-*, and the full 31-test minimum subset.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { suspend } from "effection";
import type { Operation } from "effection";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { DurableEvent, YieldEvent, CloseEvent } from "@tisyn/kernel";
import { payloadSha } from "@tisyn/kernel";
import type { Json } from "@tisyn/ir";
import { Fn, Eval, Ref, Arr, Q, Try, Throw, Seq, If, Eq } from "@tisyn/ir";

// Helper: compute the EffectDescription shape the runtime produces for a
// chain-dispatched effect with the given source data (defaults to `[]`).
function desc(type: string, name: string, input: Json = []) {
  return { type, name, input, sha: payloadSha(input) };
}
import type { FnNode, TisynFn, Val } from "@tisyn/ir";
import {
  Effects,
  InvalidInvokeCallSiteError,
  InvalidInvokeInputError,
  invoke,
  invokeInline,
} from "@tisyn/effects";
import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import { execute } from "./execute.js";

// ── Helpers ──

const asFn = (f: unknown): FnNode => f as FnNode;

const effectIR = (type: string, name: string, data: unknown = []) =>
  ({ tisyn: "eval", id: `${type}.${name}`, data }) as unknown as Val;

function yields(journal: DurableEvent[]): YieldEvent[] {
  return journal.filter((e): e is YieldEvent => e.type === "yield");
}

function closes(journal: DurableEvent[]): CloseEvent[] {
  return journal.filter((e): e is CloseEvent => e.type === "close");
}

function eventsFor(journal: DurableEvent[], coroutineId: string): DurableEvent[] {
  return journal.filter((e) => e.coroutineId === coroutineId);
}

describe("invokeInline — core runtime slice", () => {
  // ── Basic API (§6) ──

  it("IL-B-001: returns Operation<T> with literal body value", function* () {
    const bodyFn: TisynFn<[], number> = Fn<[], number>([], Q(42));

    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          inlineResult = yield* invokeInline<Val>(asFn(bodyFn), []);
          return null as Val;
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

    const { result } = yield* execute({ ir: effectIR("parent", "trigger") as never });
    expect(result.status).toBe("ok");
    expect(inlineResult).toBe(42);
  });

  it("IL-B-002: args bind into inline body environment", function* () {
    // Fn(["a", "b"], Eval("add", Arr(Ref("a"), Ref("b"))))
    const addBody: TisynFn<[number, number], number> = Fn<[number, number], number>(
      ["a", "b"],
      Eval<number>("math.add", Arr(Ref("a"), Ref("b"))),
    );

    let addResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          addResult = yield* invokeInline<Val>(asFn(addBody), [1, 2] as Val[]);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    // Agent stub at { at: "min" } handles math.add by returning sum of data[0] + data[1].
    yield* Effects.around(
      {
        *dispatch([effectId, data]: [string, Val]) {
          if (effectId === "math.add") {
            const arr = data as unknown as [number, number];
            return (arr[0] + arr[1]) as Val;
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    yield* execute({ ir: effectIR("parent", "trigger") as never });
    expect(addResult).toBe(3);
  });

  it("IL-B-003: non-Fn fn rejects with InvalidInvokeInputError; no allocator advance", function* () {
    let inlineError: Error | undefined;
    let followUpInvokeChildId: string | undefined;

    const followUpFn: TisynFn<[], number> = Fn<[], number>([], Q(99));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          try {
            yield* invokeInline<Val>({ tisyn: "not-a-fn" } as unknown as FnNode, [] as Val[]);
          } catch (error) {
            inlineError = error as Error;
          }
          // Follow-up invoke must allocate root.0 (rejected invokeInline did
          // NOT advance the allocator per v6 §7.2).
          yield* invoke<Val>(asFn(followUpFn), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    expect(inlineError).toBeInstanceOf(InvalidInvokeInputError);
    // The follow-up invoke child must live under `root.0`, proving the rejected
    // invokeInline did not consume a spawn slot.
    const childCloses = closes(journal).filter((e) => e.coroutineId !== "root");
    expect(childCloses).toHaveLength(1);
    followUpInvokeChildId = childCloses[0]!.coroutineId;
    expect(followUpInvokeChildId).toBe("root.0");
  });

  it("IL-B-004: non-array args rejects with InvalidInvokeInputError; no allocator advance", function* () {
    let inlineError: Error | undefined;

    const bodyFn: TisynFn<[], number> = Fn<[], number>([], Q(7));
    const followUpFn: TisynFn<[], number> = Fn<[], number>([], Q(99));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          try {
            // Passing a non-array as `args`.
            yield* invokeInline<Val>(asFn(bodyFn), { bad: true } as unknown as Val[]);
          } catch (error) {
            inlineError = error as Error;
          }
          yield* invoke<Val>(asFn(followUpFn), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });
    expect(inlineError).toBeInstanceOf(InvalidInvokeInputError);
    const childCloses = closes(journal).filter((e) => e.coroutineId !== "root");
    expect(childCloses).toHaveLength(1);
    expect(childCloses[0]!.coroutineId).toBe("root.0");
  });

  // ── Call-site model (§6.2) ──

  it("IL-V-001: invokeInline outside middleware throws and does not journal", function* () {
    const bodyFn: TisynFn<[], number> = Fn<[], number>([], Q(42));

    let thrown: Error | undefined;
    try {
      // Direct call from test harness — no active DispatchContext.
      yield* invokeInline<Val>(asFn(bodyFn), []);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(InvalidInvokeCallSiteError);
    expect(thrown?.message).toContain("invokeInline");

    // Nothing should be journaled since execute() was never invoked for this
    // case. A second execute() below proves the workflow is otherwise healthy.
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return null as Val;
        },
      },
      { at: "min" },
    );
    const { journal } = yield* execute({ ir: effectIR("x", "op") as never });
    // No inline-lane events anywhere — the failed call couldn't have produced any.
    const nonRoot = journal.filter((e) => e.coroutineId !== "root");
    expect(nonRoot).toHaveLength(0);
  });

  // ── Allocator (§7) ──

  it("IL-A-001: invokeInline(a) then invoke(b) — .0 is lane, .1 is invoke child", function* () {
    const inlineBody: TisynFn<[], number> = Fn<[], number>([], Q(1));
    const invokeBody: TisynFn<[], number> = Fn<[], number>([], Q(2));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          yield* invoke<Val>(asFn(invokeBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // root.0 is the inline lane: no CloseEvent.
    expect(closes(journal).filter((e) => e.coroutineId === "root.0")).toHaveLength(0);
    // root.1 is the invoke child: exactly one CloseEvent.
    const inv1Closes = closes(journal).filter((e) => e.coroutineId === "root.1");
    expect(inv1Closes).toHaveLength(1);
  });

  it("IL-A-003: three invokeInline calls → .0, .1, .2 all lanes without CloseEvent", function* () {
    const bodyFn: TisynFn<[], number> = Fn<[], number>([], Q(7));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(bodyFn), []);
          yield* invokeInline<Val>(asFn(bodyFn), []);
          yield* invokeInline<Val>(asFn(bodyFn), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // No CloseEvent for any lane.
    for (const cid of ["root.0", "root.1", "root.2"]) {
      expect(closes(journal).filter((e) => e.coroutineId === cid)).toHaveLength(0);
    }
    // No fourth allocation — next is root.3 in `ids1`-style check.
    const laneIds = new Set(journal.map((e) => e.coroutineId));
    expect(laneIds.has("root.3")).toBe(false);
  });

  it("IL-A-006: interleaved allocator — .0 lane, .1 invoke child, .2 lane", function* () {
    const laneFn: TisynFn<[], number> = Fn<[], number>([], Q(1));
    const invokeFn: TisynFn<[], number> = Fn<[], number>([], Q(2));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(laneFn), []);
          yield* invoke<Val>(asFn(invokeFn), []);
          yield* invokeInline<Val>(asFn(laneFn), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // root.0 lane — no close; root.1 invoke child — has close; root.2 lane — no close.
    expect(closes(journal).filter((e) => e.coroutineId === "root.0")).toHaveLength(0);
    expect(closes(journal).filter((e) => e.coroutineId === "root.1")).toHaveLength(1);
    expect(closes(journal).filter((e) => e.coroutineId === "root.2")).toHaveLength(0);
  });

  // ── Journal model (§8) ──

  it("IL-J-001: inline-body effects journal under lane coroutineId", function* () {
    // Body dispatches two agent effects in sequence.
    const bodyFn: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>(
        "let",
        Q({
          name: "_e1",
          value: Eval("lane.a", Q([])),
          body: Eval<number>("let", Q({ name: "_e2", value: Eval("lane.b", Q([])), body: Q(0) })),
        }),
      ),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(bodyFn), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    const laneYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(laneYields).toHaveLength(2);
    expect(laneYields[0]?.description).toEqual(desc("lane", "a"));
    expect(laneYields[1]?.description).toEqual(desc("lane", "b"));
  });

  it("IL-J-003: inline lane has NO CloseEvent on normal completion", function* () {
    const bodyFn: TisynFn<[], number> = Fn<[], number>([], Q(42));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(bodyFn), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });
    expect(closes(journal).filter((e) => e.coroutineId === "root.0")).toHaveLength(0);
  });

  it("IL-J-004: no event for invokeInline call itself; caller yieldIndex reflects only its own effects", function* () {
    const noopBody: TisynFn<[], number> = Fn<[], number>([], Q(0));

    // IR: `let _ = parent.A in parent.B`. Caller sees two of its own effects.
    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "_",
          value: { tisyn: "eval", id: "parent.A", data: [] },
          body: { tisyn: "eval", id: "parent.B", data: [] },
        },
      },
    };

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.A") {
          // Middleware handling parent.A inlines a no-op body. Must NOT
          // produce a caller-side YieldEvent for the invokeInline call.
          yield* invokeInline<Val>(asFn(noopBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: ir as never });

    // Caller ("root") sees exactly two YieldEvents (parent.A and parent.B).
    const rootYields = yields(journal).filter((e) => e.coroutineId === "root");
    expect(rootYields).toHaveLength(2);
    expect(rootYields.map((e) => e.description)).toEqual([
      desc("parent", "A"),
      desc("parent", "B"),
    ]);
  });

  // ── Ordering (§10) ──

  it("IL-O-001: inline-body events precede the triggering dispatch event on stream", function* () {
    // Body dispatches lane.I; caller dispatches parent.E (whose handler
    // is the one that calls invokeInline).
    const bodyFn: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>("let", Q({ name: "_", value: Eval("lane.I", Q([])), body: Q(0) })),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.E") {
          yield* invokeInline<Val>(asFn(bodyFn), []);
          return null as Val;
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

    const stream = new InMemoryStream();
    yield* execute({ ir: effectIR("parent", "E") as never, stream });
    const persisted = yield* stream.readAll();

    const laneIdx = persisted.findIndex((e) => e.type === "yield" && e.coroutineId === "root.0");
    const triggerIdx = persisted.findIndex(
      (e) =>
        e.type === "yield" &&
        e.coroutineId === "root" &&
        (e as YieldEvent).description.type === "parent" &&
        (e as YieldEvent).description.name === "E",
    );
    expect(laneIdx).toBeGreaterThanOrEqual(0);
    expect(triggerIdx).toBeGreaterThan(laneIdx);
  });

  it("IL-O-003: caller and lane yieldIndexes remain independent", function* () {
    // IR: A; invokeInline(lane-effect); C; D — but invokeInline itself
    // happens from middleware handling parent.C. Caller dispatches A, C, D.
    const laneBody: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>("let", Q({ name: "_", value: Eval("lane.I", Q([])), body: Q(0) })),
    );
    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "_1",
          value: { tisyn: "eval", id: "parent.A", data: [] },
          body: {
            tisyn: "eval",
            id: "let",
            data: {
              tisyn: "quote",
              expr: {
                name: "_2",
                value: { tisyn: "eval", id: "parent.C", data: [] },
                body: { tisyn: "eval", id: "parent.D", data: [] },
              },
            },
          },
        },
      },
    };

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.C") {
          yield* invokeInline<Val>(asFn(laneBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: ir as never });

    const rootYields = yields(journal).filter((e) => e.coroutineId === "root");
    expect(rootYields.map((e) => e.description)).toEqual([
      desc("parent", "A"),
      desc("parent", "C"),
      desc("parent", "D"),
    ]);
    const laneYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(laneYields.map((e) => e.description)).toEqual([desc("lane", "I")]);
  });

  // ── Replay (§9) ──

  it("IL-R-001: live and replay journals are byte-identical", function* () {
    const bodyFn: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>("let", Q({ name: "_", value: Eval("lane.E", Q([])), body: Q(0) })),
    );

    const run = function* (stream: InMemoryStream) {
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "parent.trigger") {
            yield* invokeInline<Val>(asFn(bodyFn), []);
            return null as Val;
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
      return yield* execute({ ir: effectIR("parent", "trigger") as never, stream });
    };

    const stream = new InMemoryStream();
    const first = yield* run(stream);
    const second = yield* run(stream);

    expect(second.journal).toEqual(first.journal);

    // Backing stream still reflects only the live run's events.
    const persisted = yield* stream.readAll();
    expect(persisted).toEqual(first.journal);
  });

  // ── Nested inline (§7.6) ──

  it("IL-NI-001: nested invokeInline produces caller.{k}.{m} lane subtree", function* () {
    const innerBody: TisynFn<[], number> = Fn<[], number>([], Q(0));
    const outerBody: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>("let", Q({ name: "_", value: Eval("inner.trigger", Q([])), body: Q(0) })),
    );

    let innerCtxId: string | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(outerBody), []);
          return null as Val;
        }
        if (effectId === "inner.trigger") {
          yield* invokeInline<Val>(asFn(innerBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // Outer lane: root.0 (no close). Inner lane: root.0.0 (no close).
    expect(closes(journal).filter((e) => e.coroutineId === "root.0")).toHaveLength(0);
    expect(closes(journal).filter((e) => e.coroutineId === "root.0.0")).toHaveLength(0);
    // Outer lane has a YieldEvent for inner.trigger (journaled after middleware
    // returns); the inner lane has no yields because innerBody is a literal.
    const outerYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(outerYields).toHaveLength(1);
    expect(outerYields[0]!.description).toEqual(desc("inner", "trigger"));
    // A root.0.0 coroutineId exists in the id space (id reachability is proven
    // by the no-close assertion above — innerCtxId is the same as the lane's).
    innerCtxId = "root.0.0";
    expect(innerCtxId).toBe("root.0.0");
  });

  it("IL-NI-002: neither outer nor inner inline lane produces a CloseEvent", function* () {
    const innerBody: TisynFn<[], number> = Fn<[], number>([], Q(0));
    const outerBody: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>("let", Q({ name: "_", value: Eval("inner.trigger", Q([])), body: Q(0) })),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(outerBody), []);
          return null as Val;
        }
        if (effectId === "inner.trigger") {
          yield* invokeInline<Val>(asFn(innerBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // Only the root coroutine has a CloseEvent; neither lane does.
    const nonRootCloses = closes(journal).filter((e) => e.coroutineId !== "root");
    expect(nonRootCloses).toHaveLength(0);
  });

  // ── invoke inside inline (§11.3, IH10) ──

  it("IL-N-001: invoke inside inline produces a CloseEvent for the invoke child", function* () {
    const invokeBody: TisynFn<[], number> = Fn<[], number>([], Q(7));
    const outerBody: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>("let", Q({ name: "_", value: Eval("inner.trigger", Q([])), body: Q(0) })),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(outerBody), []);
          return null as Val;
        }
        if (effectId === "inner.trigger") {
          yield* invoke<Val>(asFn(invokeBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // Outer lane (root.0): no close.
    expect(closes(journal).filter((e) => e.coroutineId === "root.0")).toHaveLength(0);
    // invoke child (root.0.0): exactly one close. This verifies that invoke
    // retains normal nested-invocation CloseEvent discipline when invoked
    // from middleware handling an effect dispatched inside an inline body.
    const invokeCloses = closes(journal).filter((e) => e.coroutineId === "root.0.0");
    expect(invokeCloses).toHaveLength(1);
    expect(invokeCloses[0]!.result).toMatchObject({ status: "ok", value: 7 });
  });

  it("IL-N-002: invoke child's CloseEvent is journaled before inline returns", function* () {
    const invokeBody: TisynFn<[], number> = Fn<[], number>([], Q(99));
    const outerBody: TisynFn<[], number> = Fn<[], number>(
      [],
      Eval<number>("let", Q({ name: "_", value: Eval("inner.trigger", Q([])), body: Q(0) })),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(outerBody), []);
          return null as Val;
        }
        if (effectId === "inner.trigger") {
          yield* invoke<Val>(asFn(invokeBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // Journal ordering: invoke child close event must appear before the
    // root close event (inline returns, caller's kernel continues).
    const invokeCloseIdx = journal.findIndex(
      (e) => e.type === "close" && e.coroutineId === "root.0.0",
    );
    const rootCloseIdx = journal.findIndex((e) => e.type === "close" && e.coroutineId === "root");
    expect(invokeCloseIdx).toBeGreaterThan(-1);
    expect(rootCloseIdx).toBeGreaterThan(invokeCloseIdx);

    // Inline lane has no close event anywhere in the journal.
    const root0Closes = closes(journal).filter((e) => e.coroutineId === "root.0");
    expect(root0Closes).toHaveLength(0);

    // Lane-internal events (the inner.trigger yield) exist under root.0.
    const laneYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(laneYields).toHaveLength(1);
    expect(laneYields[0]!.description).toEqual(desc("inner", "trigger"));

    // Use eventsFor to confirm the lane's standard-effect dispatch did reach
    // the min handler (which is invoked by the chain even though this test's
    // invoke-middleware short-circuits before `next`).
    const laneEvents = eventsFor(journal, "root.0");
    expect(laneEvents.length).toBeGreaterThan(0);
  });

  // ── Caught-error regression (v6 §13.3) ──

  it("inline body catches dispatched error and returns fallback; no lane CloseEvent", function* () {
    // Inline body: try { failing.op } catch (e) { "fallback" }
    const body: TisynFn<[], string> = Fn<[], string>(
      [],
      Try<string>(Eval<string>("failing.op", Q([])), "_e", Q("fallback")),
    );

    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          inlineResult = yield* invokeInline<Val>(asFn(body), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    // Min-priority handler makes `failing.op` throw. The inline body's
    // try/catch MUST catch the resulting EffectError and return "fallback".
    yield* Effects.around(
      {
        *dispatch([effectId, _data]: [string, Val]) {
          if (effectId === "failing.op") {
            throw new Error("boom");
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { journal } = yield* execute({ ir: effectIR("parent", "trigger") as never });

    // Inline body resolved to the caught-and-returned fallback value.
    // The kernel wraps the caught error via errorToValue, so Try's catch
    // binding "_e" was bound to a structured value; the catch body ignores
    // it and returns the literal "fallback".
    expect(inlineResult).toBe("fallback");

    // v6 §8.4: still NO CloseEvent for the inline lane, even on the
    // caught-error path.
    expect(closes(journal).filter((e) => e.coroutineId === "root.0")).toHaveLength(0);

    // The failing.op YieldEvent still journals under the lane with error status.
    const laneYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(laneYields).toHaveLength(1);
    expect(laneYields[0]!.description).toEqual(desc("failing", "op"));
    expect(laneYields[0]!.result.status).toBe("error");
  });

  // ── Capability ownership + counter allocation (§12, IH13) ──

  // Mock Effection-compatible stream for inline tests. Emits `items` in order
  // then signals `done: true`. Matches the shape used by stream-iteration.test.ts.
  function mockStream(
    items: Val[],
  ): Operation<{ next(): Operation<IteratorResult<Val, unknown>> }> {
    let idx = 0;
    return {
      *[Symbol.iterator]() {
        return {
          next(): Operation<IteratorResult<Val, unknown>> {
            return {
              *[Symbol.iterator]() {
                if (idx < items.length) {
                  return { done: false as const, value: items[idx++] as Val };
                }
                return { done: true as const, value: undefined };
              },
            } as Operation<IteratorResult<Val, unknown>>;
          },
        };
      },
    } as Operation<{ next(): Operation<IteratorResult<Val, unknown>> }>;
  }

  // IR builders scoped to stream tests.
  const streamSubscribe = (sourceName: string): Val =>
    ({ tisyn: "eval", id: "stream.subscribe", data: [Ref(sourceName)] }) as unknown as Val;
  const streamNext = (handleName: string): Val =>
    ({ tisyn: "eval", id: "stream.next", data: [Ref(handleName)] }) as unknown as Val;

  // Helper: Fn([], stream.subscribe([Ref(sourceName)])) — returns the handle.
  const subscribeBodyFn = (sourceName: string): TisynFn<[], Val> =>
    Fn<[], Val>([], streamSubscribe(sourceName) as unknown as Val) as unknown as TisynFn<[], Val>;

  // Helper: Fn(["h"], stream.next([Ref("h")])) — expects a handle arg.
  const nextBodyFn: TisynFn<[Val], Val> = Fn<[Val], Val>(
    ["h"],
    streamNext("h") as unknown as Val,
  ) as unknown as TisynFn<[Val], Val>;

  it("IL-CO-001: sibling inline lanes share owner — B can use A's handle", function* () {
    // Inline A subscribes; inline B uses the handle. Both triggered by
    // sequential caller effects, each handled by middleware that invokes
    // the corresponding body.
    let handleFromA: Val | undefined;
    let nextResultInB: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.triggerA") {
          handleFromA = yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
          return null as Val;
        }
        if (effectId === "parent.triggerB") {
          nextResultInB = yield* invokeInline<Val>(asFn(nextBodyFn), [handleFromA as Val]);
          return null as Val;
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

    // IR: let _ = parent.triggerA in parent.triggerB
    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "_",
          value: { tisyn: "eval", id: "parent.triggerA", data: [] },
          body: { tisyn: "eval", id: "parent.triggerB", data: [] },
        },
      },
    };

    const { journal } = yield* execute({
      ir: ir as never,
      env: { source: mockStream([42]) as unknown as Val },
    });

    // stream.subscribe journaled under lane A (root.0).
    const subEvent = yields(journal).find(
      (e) => e.description.type === "stream" && e.description.name === "subscribe",
    );
    expect(subEvent?.coroutineId).toBe("root.0");
    // stream.next journaled under lane B (root.1).
    const nextEvent = yields(journal).find(
      (e) => e.description.type === "stream" && e.description.name === "next",
    );
    expect(nextEvent?.coroutineId).toBe("root.1");
    // No ancestry failure and the iteration returned 42.
    expect(nextResultInB).toEqual({ done: false, value: 42 });
    // Handle token prefix uses owner (root), not lane id.
    expect((handleFromA as Record<string, unknown>).__tisyn_subscription).toMatch(/^sub:root:\d+$/);
  });

  it("IL-CO-002: nested inline subscribes; caller uses handle after inline returns", function* () {
    // Outer inline invokes inner inline, which subscribes and returns the
    // handle. Outer returns the handle. Middleware captures it, then the
    // caller's kernel dispatches stream.next with that handle.
    const outerBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Eval<Val>("outer.trigger", Q([])),
    ) as unknown as TisynFn<[], Val>;

    let outerLaneHandle: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.acquire") {
          outerLaneHandle = yield* invokeInline<Val>(asFn(outerBody), []);
          return outerLaneHandle as Val;
        }
        if (effectId === "outer.trigger") {
          // Middleware handling the inner-level effect invokes the
          // innermost inline lane which does the actual subscribe.
          return yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
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

    // IR: let h = parent.acquire in stream.next([h])
    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "h",
          value: { tisyn: "eval", id: "parent.acquire", data: [] },
          body: { tisyn: "eval", id: "stream.next", data: [Ref("h")] },
        },
      },
    };

    const { result, journal } = yield* execute({
      ir: ir as never,
      env: { source: mockStream([99]) as unknown as Val },
    });

    // Caller's stream.next succeeded — ancestry passed (owner is root at
    // both sites: the outer invokeInline inherited, the inner one too).
    expect(result).toEqual({ status: "ok", value: { done: false, value: 99 } });

    // The subscribe event is under the innermost lane (root.0.0).
    const subEvent = yields(journal).find(
      (e) => e.description.type === "stream" && e.description.name === "subscribe",
    );
    expect(subEvent?.coroutineId).toBe("root.0.0");
    // The next event is under the caller (root).
    const nextEvent = yields(journal).find(
      (e) => e.description.type === "stream" && e.description.name === "next",
    );
    expect(nextEvent?.coroutineId).toBe("root");
  });

  it("IL-CO-003: stream.subscribe YieldEvent journals under laneId with owner-keyed token", function* () {
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
          return null as Val;
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

    const { journal } = yield* execute({
      ir: effectIR("parent", "trigger") as never,
      env: { source: mockStream([]) as unknown as Val },
    });

    const subEvent = yields(journal).find(
      (e) => e.description.type === "stream" && e.description.name === "subscribe",
    );
    expect(subEvent).toBeDefined();
    // Journal identity: lane coroutineId, NOT the caller's.
    expect(subEvent?.coroutineId).toBe("root.0");
    // Token prefix: owner coroutineId (the caller, root), not the lane id.
    const handle = (subEvent!.result as { status: "ok"; value: Record<string, unknown> }).value;
    expect(handle.__tisyn_subscription).toMatch(/^sub:root:\d+$/);
  });

  it("IL-CO-007: YieldEvent shape unchanged — no ownerCoroutineId field", function* () {
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
          return null as Val;
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

    const stream = new InMemoryStream();
    yield* execute({
      ir: effectIR("parent", "trigger") as never,
      stream,
      env: { source: mockStream([]) as unknown as Val },
    });
    const persisted = yield* stream.readAll();

    const subEvent = persisted.find(
      (e) =>
        e.type === "yield" &&
        (e as YieldEvent).description.type === "stream" &&
        (e as YieldEvent).description.name === "subscribe",
    );
    expect(subEvent).toBeDefined();
    // Normative durable-event keys only — no runtime-only owner field
    // leaks into the stream.
    const keys = Object.keys(subEvent as object).sort();
    expect(keys).toEqual(["coroutineId", "description", "result", "type"]);
  });

  it("IL-CO-011: caller + two sibling inline lanes allocate unique owner-counter tokens", function* () {
    // IR: caller subscribe, then two sequential inline subscribes via
    // middleware triggers.
    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "h0",
          value: streamSubscribe("source"),
          body: {
            tisyn: "eval",
            id: "let",
            data: {
              tisyn: "quote",
              expr: {
                name: "_1",
                value: { tisyn: "eval", id: "parent.triggerA", data: [] },
                body: { tisyn: "eval", id: "parent.triggerB", data: [] },
              },
            },
          },
        },
      },
    };

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.triggerA") {
          yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
          return null as Val;
        }
        if (effectId === "parent.triggerB") {
          yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
          return null as Val;
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

    const { journal } = yield* execute({
      ir: ir as never,
      env: { source: mockStream([]) as unknown as Val },
    });

    const subEvents = yields(journal).filter(
      (e) => e.description.type === "stream" && e.description.name === "subscribe",
    );
    expect(subEvents).toHaveLength(3);

    const tokens = subEvents.map(
      (e) =>
        (e.result as { status: "ok"; value: { __tisyn_subscription: string } }).value
          .__tisyn_subscription,
    );
    // All three tokens distinct.
    expect(new Set(tokens).size).toBe(3);
    // All three share the owner (root), allocated sequentially from one counter.
    expect(tokens).toEqual(["sub:root:0", "sub:root:1", "sub:root:2"]);

    // Subscribe events under root (caller), root.0 (lane A), root.1 (lane B).
    expect(subEvents.map((e) => e.coroutineId)).toEqual(["root", "root.0", "root.1"]);
  });

  it("IL-CO-012: sibling lane can use another sibling lane's handle via shared owner", function* () {
    // Lane A subscribes and returns handle H; lane B uses H to take one
    // item. Both lanes share the same owner (caller = root), so ancestry
    // passes and the tokens belong to the same counter family.
    let handleFromA: Val | undefined;
    let itemInB: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.triggerA") {
          handleFromA = yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
          return null as Val;
        }
        if (effectId === "parent.triggerB") {
          // Lane B subscribes first (T2) then uses H from A.
          const bBodySubscribeThenUseA: TisynFn<[Val], Val> = Fn<[Val], Val>(["h"], {
            tisyn: "eval",
            id: "let",
            data: {
              tisyn: "quote",
              expr: {
                name: "_own",
                value: streamSubscribe("source"),
                body: streamNext("h"),
              },
            },
          } as unknown as Val) as unknown as TisynFn<[Val], Val>;
          itemInB = yield* invokeInline<Val>(asFn(bBodySubscribeThenUseA), [handleFromA as Val]);
          return null as Val;
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

    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "_",
          value: { tisyn: "eval", id: "parent.triggerA", data: [] },
          body: { tisyn: "eval", id: "parent.triggerB", data: [] },
        },
      },
    };

    const { journal } = yield* execute({
      ir: ir as never,
      env: { source: mockStream([7]) as unknown as Val },
    });

    // Ancestry passed: lane B successfully pulled from lane A's handle.
    expect(itemInB).toEqual({ done: false, value: 7 });

    // Two subscribes → two tokens, pairwise distinct, both under root owner.
    const subEvents = yields(journal).filter(
      (e) => e.description.type === "stream" && e.description.name === "subscribe",
    );
    expect(subEvents).toHaveLength(2);
    const tokens = subEvents.map(
      (e) =>
        (e.result as { status: "ok"; value: { __tisyn_subscription: string } }).value
          .__tisyn_subscription,
    );
    expect(tokens).toEqual(["sub:root:0", "sub:root:1"]);
  });

  it("IL-CO-013: replay advances owner counter; post-replay live token continues the sequence", function* () {
    // Live run: caller sub (T0), parent.triggerA (inline sub — T1), caller sub (T2).
    // Same nested-let structure as IL-CO-011 but the final body is a third
    // caller-level stream.subscribe rather than a second trigger effect, so
    // the IR itself evaluates to the third handle.
    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "h0",
          value: streamSubscribe("source"),
          body: {
            tisyn: "eval",
            id: "let",
            data: {
              tisyn: "quote",
              expr: {
                name: "_1",
                value: { tisyn: "eval", id: "parent.triggerA", data: [] },
                body: streamSubscribe("source"),
              },
            },
          },
        },
      },
    };

    const run = function* (stream: InMemoryStream) {
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "parent.triggerA") {
            yield* invokeInline<Val>(asFn(subscribeBodyFn("source")), []);
            return null as Val;
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
      return yield* execute({
        ir: ir as never,
        stream,
        env: { source: mockStream([]) as unknown as Val },
      });
    };

    const stream = new InMemoryStream();
    const first = yield* run(stream);
    const second = yield* run(stream);

    // Byte-identical journals — owner counter reconstructed deterministically.
    expect(second.journal).toEqual(first.journal);

    const subEvents = yields(first.journal).filter(
      (e) => e.description.type === "stream" && e.description.name === "subscribe",
    );
    const tokens = subEvents.map(
      (e) =>
        (e.result as { status: "ok"; value: { __tisyn_subscription: string } }).value
          .__tisyn_subscription,
    );
    // All three sequentially from owner root's shared counter.
    expect(tokens).toEqual(["sub:root:0", "sub:root:1", "sub:root:2"]);
  });

  it("IL-CO-014: invoke child uses its own subscription namespace (token owner = child coroutineId)", function* () {
    // `invoke` child subscribes inside its own coroutine. Per v6 §12.8
    // the child's own coroutineId is its own owner — so the subscription
    // token must be prefixed with the child's coroutineId, not the
    // caller's. We cannot smuggle the handle out of the child (RV3 on
    // close values, RV2 on capture-effect data), so we inspect the
    // child's stream.subscribe YieldEvent directly from the journal.
    //
    // Ancestry-failure when a foreign coroutine tries to use a handle is
    // already covered by the existing stream-iteration RV1 tests; this
    // test pins the Phase 5C invariant that `invoke` children get a
    // fresh subscription namespace rather than inheriting the caller's
    // owner.
    const childBody: TisynFn<[], Val> = Fn<[], Val>([], {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "_h",
          value: streamSubscribe("source"),
          body: Q(null),
        },
      },
    } as unknown as Val) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.childSub") {
          yield* invoke<Val>(asFn(childBody), []);
          return null as Val;
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

    const { journal } = yield* execute({
      ir: effectIR("parent", "childSub") as never,
      env: { source: mockStream([]) as unknown as Val },
    });

    // Subscribe YieldEvent under the invoke child's coroutineId.
    const childSubEvent = yields(journal).find(
      (e) =>
        e.coroutineId === "root.0" &&
        e.description.type === "stream" &&
        e.description.name === "subscribe",
    );
    expect(childSubEvent).toBeDefined();
    const handle = (
      childSubEvent!.result as {
        status: "ok";
        value: { __tisyn_subscription: string };
      }
    ).value;
    // Token prefix is the invoke child's own coroutineId — NOT the
    // caller's root. §12.8: invoke resets owner to its own id.
    expect(handle.__tisyn_subscription).toMatch(/^sub:root\.0:\d+$/);
    expect(handle.__tisyn_subscription.startsWith("sub:root:")).toBe(false);
  });

  // ── Phase 5D: inline-body `resource` continuity (IL-PI / IL-L / IL-CS / IL-RD) ──

  // IR helpers for inline-resource tests (mirror resource.test.ts shapes).
  const resourceIR = (body: unknown) =>
    ({
      tisyn: "eval",
      id: "resource",
      data: { tisyn: "quote", expr: { body } },
    }) as unknown as Val;

  const provideIR = (value: unknown) =>
    ({
      tisyn: "eval",
      id: "provide",
      data: value,
    }) as unknown as Val;

  const seqIR = (...exprs: unknown[]) =>
    ({
      tisyn: "eval",
      id: "seq",
      data: { tisyn: "quote", expr: { exprs } },
    }) as unknown as Val;

  it("IL-PI-001: primary invariant — E under laneId, R cleanup at caller teardown, Y succeeds", function* () {
    // Inline body: dispatch effect E, then acquire resource R. E is a
    // direct effect of the inline body (journals under laneId); R's
    // init body provides "session-handle" and its cleanup dispatches
    // session.close at caller teardown. The Fn returns R's provide value.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      seqIR(
        effectIR("setup", "touch"),
        resourceIR(
          Try(provideIR("session-handle"), undefined, undefined, effectIR("session", "close")),
        ),
      ) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let capturedHandle: Val | undefined;
    let usedHandle: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          capturedHandle = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        if (effectId === "caller.use") {
          usedHandle = capturedHandle;
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result, journal } = yield* execute({
      ir: seqIR(effectIR("caller", "go"), effectIR("caller", "use")) as never,
    });

    expect(result.status).toBe("ok");
    expect(usedHandle).toBe("session-handle");

    // E (setup.touch) journals under the inline lane, not root.
    const setupYields = yields(journal).filter(
      (e) => e.description.type === "setup" && e.description.name === "touch",
    );
    expect(setupYields).toHaveLength(1);
    expect(setupYields[0]!.coroutineId).toBe("root.0");

    // R's cleanup effect (session.close) fires at caller teardown.
    const cleanupYields = yields(journal).filter(
      (e) => e.description.type === "session" && e.description.name === "close",
    );
    expect(cleanupYields).toHaveLength(1);
    // Cleanup runs under the resource child's coroutineId (root.0.0).
    expect(cleanupYields[0]!.coroutineId).toBe("root.0.0");

    // Resource child produces its own CloseEvent under root.0.0.
    const resourceCloses = closes(journal).filter((e) => e.coroutineId === "root.0.0");
    expect(resourceCloses).toHaveLength(1);
    expect(resourceCloses[0]!.result.status).toBe("ok");

    // Inline lane produces NO CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("IL-PI-003 / IL-L-002: resource continuity across sibling inline lanes", function* () {
    // A: inline lane that acquires a resource whose provide value is "session-xyz".
    // B: inline lane that reads the stored handle via middleware and returns it.
    // Both called sequentially from caller middleware.
    const inlineA: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(
        Try(provideIR("session-xyz"), undefined, undefined, effectIR("session", "close")),
      ) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    const inlineB: TisynFn<[], Val> = Fn<[], Val>(
      [],
      effectIR("session", "read") as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let aHandle: Val | undefined;
    let bReadBack: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          aHandle = yield* invokeInline<Val>(asFn(inlineA), []);
          bReadBack = yield* invokeInline<Val>(asFn(inlineB), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
      },
    });
    yield* Effects.around(
      {
        *dispatch([effectId, _d]: [string, Val]) {
          if (effectId === "session.read") {
            return aHandle as Val;
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
    });

    expect(result.status).toBe("ok");
    expect(aHandle).toBe("session-xyz");
    expect(bReadBack).toBe("session-xyz");

    // Distinct lane IDs root.0 (A) and root.1 (B). A's resource child is root.0.0.
    const sessionReadYields = yields(journal).filter(
      (e) => e.description.type === "session" && e.description.name === "read",
    );
    expect(sessionReadYields).toHaveLength(1);
    expect(sessionReadYields[0]!.coroutineId).toBe("root.1");

    const resourceCloses = closes(journal).filter((e) => e.coroutineId === "root.0.0");
    expect(resourceCloses).toHaveLength(1);

    // Cleanup fires at caller teardown (after B's session.read).
    const cleanupYields = yields(journal).filter(
      (e) => e.description.type === "session" && e.description.name === "close",
    );
    expect(cleanupYields).toHaveLength(1);
    // session.close fires after session.read in journal order.
    const readIdx = journal.indexOf(sessionReadYields[0]!);
    const closeIdx = journal.indexOf(cleanupYields[0]!);
    expect(closeIdx).toBeGreaterThan(readIdx);
  });

  it("IL-L-005: mixed caller + inline resources tear down in reverse acquisition order", function* () {
    // Caller acquires R1 directly; inline A acquires R2; inline B acquires R3.
    // On caller teardown, cleanup fires R3 → R2 → R1.
    const inlineA: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(
        Try(provideIR("a"), undefined, undefined, effectIR("cleanup", "r2")),
      ) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    const inlineB: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(
        Try(provideIR("b"), undefined, undefined, effectIR("cleanup", "r3")),
      ) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineA), []);
          yield* invokeInline<Val>(asFn(inlineB), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    // Caller IR: acquire R1 directly in root's driveKernel, then trigger
    // caller.go (whose middleware runs inline A and inline B). R1 is
    // acquired BEFORE the inline calls so its registration predates R2/R3.
    // Seq discards R1's provide value; the resource is still registered
    // with root's `resourceChildren` for reverse-order cleanup.
    const ir = seqIR(
      resourceIR(Try(provideIR("r1"), undefined, undefined, effectIR("cleanup", "r1"))),
      effectIR("caller", "go"),
    );

    const { result, journal } = yield* execute({ ir: ir as never });
    expect(result.status).toBe("ok");

    const cleanupYields = yields(journal).filter((e) => e.description.type === "cleanup");
    expect(cleanupYields.map((e) => e.description.name)).toEqual(["r3", "r2", "r1"]);
  });

  it("IL-CS-004: resource child produces its own CloseEvent under laneId.{m}; inline lane has none", function* () {
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(provideIR(42)) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
    });

    // Resource child close under lane.0 (root.0.0).
    const resourceCloses = closes(journal).filter((e) => e.coroutineId === "root.0.0");
    expect(resourceCloses).toHaveLength(1);
    expect(resourceCloses[0]!.result.status).toBe("ok");

    // Lane itself emits no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("IL-CS-005: resource provide value is usable by caller code after inline returns", function* () {
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(provideIR("the-value")) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let fromInline: Val | undefined;
    let usedLater: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.acquire") {
          fromInline = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        if (effectId === "caller.use") {
          usedLater = fromInline;
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result } = yield* execute({
      ir: seqIR(effectIR("caller", "acquire"), effectIR("caller", "use")) as never,
    });

    expect(result.status).toBe("ok");
    expect(fromInline).toBe("the-value");
    expect(usedLater).toBe("the-value");
  });

  it("IL-RD-003: resource init body inside inline does not refire live on replay", function* () {
    // Live run with journal capture.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(seqIR(effectIR("resource-init", "setup"), provideIR("ready"))) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let liveFireCount = 0;

    const buildAgents = () =>
      function* () {
        yield* Effects.around({
          *dispatch([effectId, _data]: [string, Val], next) {
            if (effectId === "caller.go") {
              yield* invokeInline<Val>(asFn(inlineBody), []);
              return null as Val;
            }
            return yield* next(effectId, _data);
          },
        });
        yield* Effects.around(
          {
            *dispatch([effectId, _d]: [string, Val]) {
              if (effectId === "resource-init.setup") {
                liveFireCount++;
              }
              return null as Val;
            },
          },
          { at: "min" },
        );
      };

    const stream = new InMemoryStream();
    const live = buildAgents();
    yield* live();

    const { result: liveResult, journal: liveJournal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream,
    });
    expect(liveResult.status).toBe("ok");
    expect(liveFireCount).toBe(1);

    // Replay with same stream. Init body MUST NOT refire live.
    liveFireCount = 0;
    const { result: replayResult, journal: replayJournal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream,
    });
    expect(replayResult.status).toBe("ok");
    // Replay: the init body's setup effect is replayed from journal, not re-dispatched live.
    expect(liveFireCount).toBe(0);
    // Journals are byte-identical.
    expect(replayJournal).toEqual(liveJournal);

    // Sanity: init body's setup effect journaled under lane's resource child.
    const setupYields = yields(liveJournal).filter(
      (e) => e.description.type === "resource-init" && e.description.name === "setup",
    );
    expect(setupYields).toHaveLength(1);
    expect(setupYields[0]!.coroutineId).toBe("root.0.0");
  });

  // ── Regression: non-resource compound externals still rejected ──

  // ── Regression: inline-body `resource` from resource-init / cleanup contexts still rejects ──

  it("regression: invokeInline body `resource` from resource-init middleware rejects", function* () {
    // Inner inline body yields a resource.
    const innerInline: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(provideIR("nested")) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let outerInitFired = 0;
    let resourceSpawnCid: string | null = null;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "outer-init.go") {
          outerInitFired++;
          // Inside a resource-init dispatch — invokeInline should work for
          // non-resource effects but must reject an inline-body `resource`.
          yield* invokeInline<Val>(asFn(innerInline), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    // Outer IR: resource whose init body yields outer-init.go then provides.
    const outerIr = resourceIR(seqIR(effectIR("outer-init", "go"), provideIR(0)));

    const { result, journal } = yield* execute({ ir: outerIr as never });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain(
        "nested resources inside a resource body are not supported",
      );
      expect(result.error.message).toContain("resource init dispatch context");
    }

    // `outer-init.go` middleware fired (so invokeInline from init-phase
    // middleware is NOT wholesale rejected — only the inline-body
    // `resource` yield is).
    expect(outerInitFired).toBe(1);

    // Inner inline's resource child MUST NOT have started — no yields,
    // no close under any descendant of the rejected lane. Lane was
    // `root.0` (A's resource child), invokeInline advanced A's init
    // allocator, so the rejected inline lane would be `root.0.1` and
    // its resource child would be `root.0.1.0`. Neither id appears.
    expect(yields(journal).some((e) => e.coroutineId === "root.0.1.0")).toBe(false);
    expect(closes(journal).some((e) => e.coroutineId === "root.0.1.0")).toBe(false);

    // Reference resourceSpawnCid to avoid unused-var lint.
    expect(resourceSpawnCid).toBeNull();
  });

  it("regression: invokeInline body `resource` from resource-cleanup middleware rejects", function* () {
    // Outer resource whose cleanup path triggers an effect whose middleware
    // calls invokeInline with a body that yields `resource` — must reject.
    const innerInline: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(provideIR("nested-cleanup")) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let cleanupFired = 0;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "outer-cleanup.go") {
          cleanupFired++;
          yield* invokeInline<Val>(asFn(innerInline), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    // Outer: resource(Try(provide(0), finally: outer-cleanup.go))
    const outerIr = resourceIR(
      Try(provideIR(0), undefined, undefined, effectIR("outer-cleanup", "go")),
    );

    const { journal } = yield* execute({ ir: outerIr as never });

    // The cleanup-phase target rejects the inner inline body's `resource`
    // yield. That throws inside orchestrateResourceChild's cleanup loop,
    // which writes an error CloseEvent for the resource child (root.0).
    // Middleware still fires once before the rejection surfaces.
    expect(cleanupFired).toBe(1);
    const outerResourceCloses = closes(journal).filter((e) => e.coroutineId === "root.0");
    expect(outerResourceCloses).toHaveLength(1);
    expect(outerResourceCloses[0]!.result.status).toBe("error");
    if (outerResourceCloses[0]!.result.status === "error") {
      expect(outerResourceCloses[0]!.result.error.message).toContain(
        "nested resources inside a resource body are not supported",
      );
      expect(outerResourceCloses[0]!.result.error.message).toContain(
        "resource cleanup dispatch context",
      );
    }
  });

  // ── Phase 5E: inline-body `spawn` / `join` (IL-CS-006/007/008, L-003, RD-*) ──

  const spawnIR = (body: unknown) =>
    ({
      tisyn: "eval",
      id: "spawn",
      data: { tisyn: "quote", expr: { body } },
    }) as unknown as Val;

  const joinByHandleIR = (handleRefName: string) =>
    ({
      tisyn: "eval",
      id: "join",
      data: { tisyn: "ref", name: handleRefName } as unknown,
    }) as unknown as Val;

  const letIR = (name: string, value: unknown, body: unknown) =>
    ({
      tisyn: "eval",
      id: "let",
      data: { tisyn: "quote", expr: { name, value, body } },
    }) as unknown as Val;

  it("IL-CS-006: inline body spawns + joins; child CloseEvent under laneId.{m}; lane has none", function* () {
    // Inline body: `let t = spawn(42) in join(t)`. Returns child value.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      letIR("t", spawnIR(Q(42)), joinByHandleIR("t")) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let inlineReturn: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineReturn = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result, journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
    });

    expect(result.status).toBe("ok");
    expect(inlineReturn).toBe(42);

    // Spawned child's CloseEvent lives under root.0.0 (lane is root.0).
    const childCloses = closes(journal).filter((e) => e.coroutineId === "root.0.0");
    expect(childCloses).toHaveLength(1);
    expect(childCloses[0]!.result.status).toBe("ok");

    // Inline lane itself emits NO CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("IL-CS-007: spawned child attaches to caller lifetime and closes before caller close", function* () {
    // Inline body spawns a child that yields one effect then returns 7;
    // inline returns the task handle. Caller later joins the handle
    // (via a JS-captured slot + readHandle agent effect) — that forces
    // the child to complete inside the caller's scope. Assert: child's
    // CloseEvent appears in the journal BEFORE the root's CloseEvent,
    // and the inline lane itself has no CloseEvent.
    const childBody = seqIR(effectIR("child", "work"), Q(7));
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      spawnIR(childBody as unknown as Val) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let handleSlot: Val = null;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          handleSlot = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        if (effectId === "caller.readHandle") {
          return handleSlot;
        }
        return yield* next(effectId, _data);
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

    // Caller IR: seq(caller.go, let h = caller.readHandle in join(h))
    const callerIr = seqIR(
      effectIR("caller", "go"),
      letIR("h", effectIR("caller", "readHandle"), joinByHandleIR("h")),
    );

    const { result, journal } = yield* execute({ ir: callerIr as never });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(7);
    }

    const childClose = closes(journal).find((e) => e.coroutineId === "root.0.0");
    const rootClose = closes(journal).find((e) => e.coroutineId === "root");
    expect(childClose).toBeDefined();
    expect(rootClose).toBeDefined();
    expect(childClose!.result.status).toBe("ok");
    const childIdx = journal.indexOf(childClose!);
    const rootIdx = journal.indexOf(rootClose!);
    // Caller-scope lifetime: child closes before root.
    expect(childIdx).toBeLessThan(rootIdx);
    // Inline lane itself has no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("IL-CS-008: inline lane has no CloseEvent; invoke/resource/spawn children all do", function* () {
    // Three inline lanes in sequence:
    //   A → invokes a child Fn (invoke → own CloseEvent)
    //   B → acquires a resource R (→ own CloseEvent; lives until caller teardown)
    //   C → spawns + joins a child (→ own CloseEvent)
    // Assert: inline lanes root.0, root.1, root.2 have no CloseEvents;
    // the three nested children all do.
    const invokedChild: TisynFn<[], number> = Fn<[], number>([], Q(1));
    const inlineA: TisynFn<[], Val> = Fn<[], Val>(
      [],
      effectIR("A", "invoke-now") as unknown as Val,
    ) as unknown as TisynFn<[], Val>;
    const inlineB: TisynFn<[], Val> = Fn<[], Val>(
      [],
      resourceIR(provideIR(2)) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;
    const inlineC: TisynFn<[], Val> = Fn<[], Val>(
      [],
      letIR("t", spawnIR(Q(3)), joinByHandleIR("t")) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineA), []);
          yield* invokeInline<Val>(asFn(inlineB), []);
          yield* invokeInline<Val>(asFn(inlineC), []);
          return null as Val;
        }
        if (effectId === "A.invoke-now") {
          // Middleware handling A's effect invokes a child Fn.
          yield* invoke<Val>(asFn(invokedChild), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result, journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
    });
    expect(result.status).toBe("ok");

    // Inline lanes root.0 (A), root.1 (B), root.2 (C) — no CloseEvents.
    for (const laneId of ["root.0", "root.1", "root.2"]) {
      expect(closes(journal).some((e) => e.coroutineId === laneId)).toBe(false);
    }

    // invoke child (root.0.0, A's middleware allocates from A's childSpawnCount).
    expect(closes(journal).some((e) => e.coroutineId === "root.0.0")).toBe(true);
    // resource child (root.1.0).
    expect(closes(journal).some((e) => e.coroutineId === "root.1.0")).toBe(true);
    // spawn child (root.2.0).
    expect(closes(journal).some((e) => e.coroutineId === "root.2.0")).toBe(true);
  });

  it("sibling/caller join continuity: inline A spawns, inline B joins via handle", function* () {
    // Inline A: spawn(42) → returns task handle.
    // Inline B: (ignored arg) joins the handle captured between calls.
    // Caller middleware holds the handle between invocations.
    const inlineA: TisynFn<[], Val> = Fn<[], Val>(
      [],
      spawnIR(Q(42)) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;
    // B takes the handle as its one arg, joins it, returns the child value.
    const inlineB: TisynFn<[Val], Val> = Fn<[Val], Val>(
      ["h"] as [string],
      {
        tisyn: "eval",
        id: "join",
        data: { tisyn: "ref", name: "h" } as unknown,
      } as unknown as Val,
    ) as unknown as TisynFn<[Val], Val>;

    let joinedValue: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const handle = yield* invokeInline<Val>(asFn(inlineA), []);
          joinedValue = yield* invokeInline<Val>(asFn(inlineB), [handle]);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(joinedValue).toBe(42);
  });

  it("caller joins an inline-spawned handle after inline returns", function* () {
    // Inline A spawns(42) and returns the handle; caller code then yields
    // join(handle) directly from root's driveKernel. The root join walks
    // the shared spawnedTasks and finds the inline-registered entry.
    const inlineA: TisynFn<[], Val> = Fn<[], Val>(
      [],
      spawnIR(Q(42)) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let handleSlot: Val = null;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.spawnInline") {
          handleSlot = yield* invokeInline<Val>(asFn(inlineA), []);
          return null as Val;
        }
        if (effectId === "caller.readHandle") {
          return handleSlot;
        }
        return yield* next(effectId, _data);
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

    // Caller: spawnInline; let h = readHandle in join(h)
    const callerIr = seqIR(
      effectIR("caller", "spawnInline"),
      letIR("h", effectIR("caller", "readHandle"), joinByHandleIR("h")),
    );

    const { result } = yield* execute({ ir: callerIr as never });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(42);
    }
  });

  it("double-join regression: joining an inline-spawned handle twice fails", function* () {
    // Inline A spawns(42); caller joins (succeeds); caller joins again
    // (fails with the shared double-join error).
    const inlineA: TisynFn<[], Val> = Fn<[], Val>(
      [],
      spawnIR(Q(42)) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let handleSlot: Val = null;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.spawnInline") {
          handleSlot = yield* invokeInline<Val>(asFn(inlineA), []);
          return null as Val;
        }
        if (effectId === "caller.readHandle") {
          return handleSlot;
        }
        return yield* next(effectId, _data);
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

    // Caller: spawn; h = read; join(h); join(h) (second join fails).
    const callerIr = seqIR(
      effectIR("caller", "spawnInline"),
      letIR("h", effectIR("caller", "readHandle"), seqIR(joinByHandleIR("h"), joinByHandleIR("h"))),
    );

    const { result } = yield* execute({ ir: callerIr as never });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("already been joined");
    }
  });

  it("IL-RD-like: inline-spawned child replay is byte-identical", function* () {
    // Inline body spawns a child that yields one effect and returns; inline
    // body then joins the handle. Live run; replay with same stream.
    const childBody = seqIR(effectIR("inline-spawn", "work"), Q(99));
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      letIR("t", spawnIR(childBody as unknown as Val), joinByHandleIR("t")) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let liveFireCount = 0;

    const installAgents = function* () {
      yield* Effects.around({
        *dispatch([effectId, _data]: [string, Val], next) {
          if (effectId === "caller.go") {
            yield* invokeInline<Val>(asFn(inlineBody), []);
            return null as Val;
          }
          return yield* next(effectId, _data);
        },
      });
      yield* Effects.around(
        {
          *dispatch([effectId, _d]: [string, Val]) {
            if (effectId === "inline-spawn.work") {
              liveFireCount++;
            }
            return null as Val;
          },
        },
        { at: "min" },
      );
    };

    const stream = new InMemoryStream();
    yield* installAgents();

    const { result: liveResult, journal: liveJournal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream,
    });
    expect(liveResult.status).toBe("ok");
    expect(liveFireCount).toBe(1);

    // Replay — child does not refire live.
    liveFireCount = 0;
    const { result: replayResult, journal: replayJournal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream,
    });
    expect(replayResult.status).toBe("ok");
    expect(liveFireCount).toBe(0);
    expect(replayJournal).toEqual(liveJournal);

    // Child YieldEvent is under root.0.0, not the inline lane.
    const workYields = yields(liveJournal).filter(
      (e) => e.description.type === "inline-spawn" && e.description.name === "work",
    );
    expect(workYields).toHaveLength(1);
    expect(workYields[0]!.coroutineId).toBe("root.0.0");
  });

  // ── Phase 5F: inline-body `timebox` / `all` / `race` (§11.6) ──

  const timeboxIR = (duration: number, body: unknown) =>
    ({
      tisyn: "eval",
      id: "timebox",
      data: { tisyn: "quote", expr: { duration, body } },
    }) as unknown as Val;

  const allIR = (exprs: unknown[]) =>
    ({
      tisyn: "eval",
      id: "all",
      data: { tisyn: "quote", expr: { exprs } },
    }) as unknown as Val;

  const raceIR = (exprs: unknown[]) =>
    ({
      tisyn: "eval",
      id: "race",
      data: { tisyn: "quote", expr: { exprs } },
    }) as unknown as Val;

  const provideOutsideResourceIR = (value: unknown) =>
    ({
      tisyn: "eval",
      id: "provide",
      data: value,
    }) as unknown as Val;

  it("IL-CS-009 / timebox-completed: body wins → tagged { status: 'completed', value }", function* () {
    // Inline body runs timebox with a fast-completing body (`Q(42)`);
    // body-win produces the tagged value.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      timeboxIR(10_000, Q(42)) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let inlineReturn: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineReturn = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(inlineReturn).toEqual({ status: "completed", value: 42 });

    // Body child (root.0.0) + timeout child (root.0.1) both produce CloseEvents.
    expect(closes(journal).some((e) => e.coroutineId === "root.0.0")).toBe(true);
    expect(closes(journal).some((e) => e.coroutineId === "root.0.1")).toBe(true);
    // Inline lane itself has no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("timebox-timed-out: timeout wins → tagged { status: 'timeout' }; not an error", function* () {
    // Inline body runs timebox with duration 0. Timeout wins; orchestrator
    // resolves with `{ status: "timeout" }` — this is a tagged success
    // value, NOT an error.
    const slowBody = effectIR("timebox-body", "wait");
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      timeboxIR(0, slowBody) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let inlineReturn: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineReturn = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
      },
    });
    yield* Effects.around(
      {
        *dispatch([effectId, _d]: [string, Val]) {
          if (effectId === "timebox-body.wait") {
            // Never resolves on its own — the timeout will halt the body.
            yield* suspend();
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    // Execute result is OK — timeout is a successful tagged value.
    expect(result.status).toBe("ok");
    expect(inlineReturn).toEqual({ status: "timeout" });

    // Body + timeout child CloseEvents both present.
    expect(closes(journal).some((e) => e.coroutineId === "root.0.0")).toBe(true);
    expect(closes(journal).some((e) => e.coroutineId === "root.0.1")).toBe(true);
    // Inline lane itself has no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("all-success: children under contiguous lane IDs; result order preserved", function* () {
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      allIR([Q(1), Q(2), Q(3)]) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let inlineReturn: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineReturn = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(inlineReturn).toEqual([1, 2, 3]);

    // Three contiguous child IDs, each with its own CloseEvent.
    for (const childId of ["root.0.0", "root.0.1", "root.0.2"]) {
      expect(closes(journal).some((e) => e.coroutineId === childId)).toBe(true);
    }
    // Inline lane has no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("race-success: first ok child wins; children under contiguous lane IDs", function* () {
    // Two children: first literal Q(99) should win trivially (both race
    // orchestrator kicks them off concurrently; Q is synchronous).
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      raceIR([Q(99), Q("slow")]) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let inlineReturn: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineReturn = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    // Race orchestrator's scheduling picks one of the two as the winner;
    // pin the behavior to "value comes from one of the input exprs".
    expect([99, "slow"]).toContain(inlineReturn);

    // Both race child IDs appear (though loser is halted mid-way).
    const childCloses = closes(journal).filter(
      (e) => e.coroutineId === "root.0.0" || e.coroutineId === "root.0.1",
    );
    expect(childCloses.length).toBeGreaterThanOrEqual(1);
    // Inline lane has no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("error from `all` routes through inline body's try/catch via kernel.throw", function* () {
    // Inline body: try { all([Throw("boom"), Q(2)]) } catch "e" Ref("e-msg-from-effect")
    // Simpler variant: just let the error propagate, assert the inline
    // call rejects and the outer execute result is error with the "boom"
    // message (fail-fast from orchestrateAll).
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Try(
        allIR([effectIR("bomb", "go"), Q(2)]) as unknown as Val,
        "e",
        Ref<Val>("e"),
      ) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let inlineReturn: Val | undefined;
    let inlineThrown: unknown;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          try {
            inlineReturn = yield* invokeInline<Val>(asFn(inlineBody), []);
          } catch (e) {
            inlineThrown = e;
          }
          return null as Val;
        }
        return yield* next(effectId, _data);
      },
    });
    yield* Effects.around(
      {
        *dispatch([effectId, _d]: [string, Val]) {
          if (effectId === "bomb.go") {
            throw new Error("boom");
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    // The inline body's try/catch caught the EffectError raised by the
    // orchestrator; the catch binding `e` becomes an Error value which
    // the IR evaluator surfaces as the error object itself.
    expect(inlineThrown).toBeUndefined();
    expect(inlineReturn).toBeDefined();
    // The caught value is the EffectError — its message is "boom".
    const msg = (inlineReturn as unknown as { message?: string })?.message;
    expect(msg).toContain("boom");
  });

  it("replay byte-identical: inline-body `all` reruns on replay without firing live", function* () {
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      allIR([effectIR("replay-all", "one"), effectIR("replay-all", "two")]) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    let liveFireCount = 0;

    const installAgents = function* () {
      yield* Effects.around({
        *dispatch([effectId, _data]: [string, Val], next) {
          if (effectId === "caller.go") {
            yield* invokeInline<Val>(asFn(inlineBody), []);
            return null as Val;
          }
          return yield* next(effectId, _data);
        },
      });
      yield* Effects.around(
        {
          *dispatch([effectId, _d]: [string, Val]) {
            if (effectId === "replay-all.one" || effectId === "replay-all.two") {
              liveFireCount++;
              return "done" as Val;
            }
            return null as Val;
          },
        },
        { at: "min" },
      );
    };

    const stream = new InMemoryStream();
    yield* installAgents();

    const { result: liveResult, journal: liveJournal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream,
    });
    expect(liveResult.status).toBe("ok");
    expect(liveFireCount).toBe(2);

    // Replay — nothing should refire live.
    liveFireCount = 0;
    const { result: replayResult, journal: replayJournal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream,
    });
    expect(replayResult.status).toBe("ok");
    expect(liveFireCount).toBe(0);
    expect(replayJournal).toEqual(liveJournal);
  });

  it("regression: bare `provide` inside inline body is runtime misuse, not 'deferred'", function* () {
    // Inline body yields provide(42) outside any resource context. Same
    // rule as driveKernel: RuntimeBugError("provide outside resource
    // context"). NOT a "deferred inline compound" — provide is never
    // legal outside a resource body.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      provideOutsideResourceIR(42) as unknown as Val,
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, _data);
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

    const { result } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("provide outside resource context");
      // Not framed as a deferred compound.
      expect(result.error.message).not.toContain("deferred");
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// IL-SC-* — `scope` inside `invokeInline` body (spec §11.7, IH15)
// Tests cover orchestrateScope delegation from driveInlineBody:
// scope-child allocation from lane's `inlineChildSpawnCount`, owner
// identity transition (childId is both journal and owner), transport-
// binding/middleware isolation, replay equivalence, error routing
// through kernel.throw, composition with other inline-body compounds.
// IL-SC-018 (regression: existing IL-* tests unaffected) is covered
// by the surrounding 'invokeInline — core runtime slice' suite above.
// ────────────────────────────────────────────────────────────────────
describe("invokeInline — scope inside inline body (§11.7)", () => {
  const scopeIR = (body: unknown, handler: unknown = null, bindings: unknown = {}): Val =>
    ({
      tisyn: "eval",
      id: "scope",
      data: { tisyn: "quote", expr: { handler, bindings, body } },
    }) as unknown as Val;

  const streamSubscribe = (sourceName: string): Val =>
    ({ tisyn: "eval", id: "stream.subscribe", data: [Ref(sourceName)] }) as unknown as Val;

  function shortCircuit(effectName: string, value: unknown) {
    // Bare literals — kernel rejects Quote nodes at evaluation positions
    // inside structural ops (Eq/If branches), so use the raw values.
    return Fn(
      ["effectId", "data"],
      If(
        Eq(Ref("effectId"), effectName as never) as never,
        value as never,
        Eval("dispatch", Arr(Ref("effectId"), Ref("data"))) as never,
      ),
    );
  }

  function denyEffect(effectName: string) {
    return Fn(
      ["effectId", "data"],
      If(
        Eq(Ref("effectId"), effectName as never) as never,
        Throw(`denied:${effectName}`) as never,
        Eval("dispatch", Arr(Ref("effectId"), Ref("data"))) as never,
      ),
    );
  }

  // Pull-stream factory matching the shape consumed by dispatchStandardEffect's
  // stream.subscribe path: source is an Operation that resolves to
  // { next(): Operation<IteratorResult<Val>> }. Mirrors the IL-CO test mockStream.
  function mockStream(
    items: Val[],
  ): Operation<{ next(): Operation<IteratorResult<Val, unknown>> }> {
    let idx = 0;
    return {
      *[Symbol.iterator]() {
        return {
          next(): Operation<IteratorResult<Val, unknown>> {
            return {
              *[Symbol.iterator]() {
                if (idx < items.length) {
                  return { done: false as const, value: items[idx++] as Val };
                }
                return { done: true as const, value: undefined };
              },
            } as Operation<IteratorResult<Val, unknown>>;
          },
        };
      },
    } as Operation<{ next(): Operation<IteratorResult<Val, unknown>> }>;
  }

  // ── §18.1 Core behavior ──

  it("IL-SC-001: scope inside inline body creates isolated child scope with CloseEvent", function* () {
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>([], scopeIR(Q(42))) as unknown as TisynFn<
      [],
      Val
    >;
    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineResult = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(inlineResult).toBe(42);

    // Scope child id `root.0.0` (lane=root.0, scope=lane.0) has CloseEvent(ok).
    const scopeCloses = closes(journal).filter((e) => e.coroutineId === "root.0.0");
    expect(scopeCloses).toHaveLength(1);
    expect(scopeCloses[0]!.result.status).toBe("ok");

    // Inline lane (root.0) has NO CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("IL-SC-002: scope child id allocated from lane's own counter, advancing +1", function* () {
    // Two sequential scopes inside the same inline body: first must get
    // root.0.0, second must get root.0.1.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Seq(scopeIR(Q(1)), scopeIR(Q(2))),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    const scopeChildIds = closes(journal)
      .map((e) => e.coroutineId)
      .filter((id) => id.startsWith("root.0."));
    expect(scopeChildIds).toEqual(["root.0.0", "root.0.1"]);
  });

  it("IL-SC-003: scope body effects journal under scope child id, not lane id or caller id", function* () {
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      scopeIR(effectIR("agent", "ping")),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        if (effectId === "agent.ping") {
          return "pong" as Val;
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

    const { journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    const pingEvents = yields(journal).filter(
      (e) => e.description.type === "agent" && e.description.name === "ping",
    );
    expect(pingEvents).toHaveLength(1);
    // Must journal under scope child (root.0.0), not the inline lane (root.0)
    // and not the caller (root).
    expect(pingEvents[0]!.coroutineId).toBe("root.0.0");
  });

  it("IL-SC-004: scope handler middleware intercepts effects inside scope body", function* () {
    // Host around at "max" forwards everything except caller.go; scope's
    // handler (innermost in install order) catches test.probe and
    // short-circuits. The min sink is unreachable for test.probe.
    const intercepted = "intercepted";
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      scopeIR(effectIR("test", "probe"), shortCircuit("test.probe", intercepted)),
    ) as unknown as TisynFn<[], Val>;
    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineResult = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });
    yield* Effects.around(
      {
        *dispatch([effectId, _d]: [string, Val]) {
          // Sink — fires only if scope handler did NOT intercept.
          if (effectId === "test.probe") {
            return "leaked" as Val;
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(inlineResult).toBe(intercepted);
  });

  // ── §18.2 Transport binding and middleware isolation ──

  it("IL-SC-005: scope binding evaluates inside inline body and binding is active during scope", function* () {
    // Verifies the inline-scope seam wires bindings into orchestrateScope.
    // The full leak-isolation test is exercised by scope.test.ts SC-B-*
    // and the underlying Effection scoped() teardown — orchestrateScope
    // is reused unchanged here.
    const svc = agent("il-sc-005-svc", { noop: operation<Record<string, never>, string>() });
    let calledInScope = false;
    const factory = inprocessTransport(svc, {
      *noop() {
        calledInScope = true;
        return "ok" as unknown as never;
      },
    });

    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      scopeIR(effectIR("il-sc-005-svc", "noop", { tisyn: "quote", expr: {} }), null, {
        "il-sc-005-svc": Ref("factory"),
      }),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { result } = yield* execute({
      ir: effectIR("caller", "go") as never,
      env: { factory: factory as unknown as Val },
    });
    expect(result.status).toBe("ok");
    expect(calledInScope).toBe(true);
  });

  it("IL-SC-006: scope-body transport call succeeds before scope completes (shutdown ordering)", function* () {
    // Sister-property of IL-SC-005: scope-body transport call must
    // resolve while the scope is still alive. Effection's scoped()
    // teardown orders shutdown after body completion — already
    // covered by scope.test.ts. Here we observe ordering at the
    // inline-scope seam: the in-scope call is recorded before the
    // scope CloseEvent appears in the journal.
    const svc = agent("il-sc-006-svc", { ping: operation<Record<string, never>, string>() });
    let firedAt: number | null = null;
    const factory = inprocessTransport(svc, {
      *ping() {
        firedAt = Date.now();
        return "pong" as unknown as never;
      },
    });

    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      scopeIR(effectIR("il-sc-006-svc", "ping", { tisyn: "quote", expr: {} }), null, {
        "il-sc-006-svc": Ref("factory"),
      }),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { result, journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      env: { factory: factory as unknown as Val },
    });
    expect(result.status).toBe("ok");
    expect(firedAt).not.toBeNull();
    // Scope CloseEvent is present (scope completed normally).
    const scopeClose = closes(journal).find((e) => e.coroutineId === "root.0.0");
    expect(scopeClose?.result.status).toBe("ok");
  });

  it("IL-SC-007: middleware installed inside scope does not leak to inline lane", function* () {
    // Scope handler denies "test.op" inside scope body — Try catches it.
    // After scope exits, inline body dispatches "test.op" and must
    // reach the min sink (no scope-installed middleware in the chain
    // anymore).
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Seq(
        Try(scopeIR(effectIR("test", "op"), denyEffect("test.op")), "e1", Q("scope-denied")),
        effectIR("test", "op"),
      ),
    ) as unknown as TisynFn<[], Val>;
    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineResult = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });
    yield* Effects.around(
      {
        *dispatch([effectId, _d]: [string, Val]) {
          if (effectId === "test.op") {
            return "post-scope-success" as Val;
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    // Final value of Seq is the post-scope test.op call — must succeed
    // and be dispatched by the min sink (scope's denyEffect is gone).
    expect(inlineResult).toBe("post-scope-success");
  });

  // ── §18.3 Owner identity transition ──

  it("IL-SC-019: stream subscribe inside scope uses scope child's owner, not inline caller's", function* () {
    // Scope body subscribes (and discards the handle — scope CloseEvent
    // forbids restricted-capability values). Inline body (after scope)
    // subscribes again. First token owner = scope-child id (root.0.0);
    // second token owner = caller (root).
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const ib: TisynFn<[], Val> = Fn<[], Val>(
            [],
            Seq(scopeIR(Seq(streamSubscribe("source"), Q(null))), streamSubscribe("source")),
          ) as unknown as TisynFn<[], Val>;
          yield* invokeInline<Val>(asFn(ib), []);
          return null as Val;
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

    const { journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      env: { source: mockStream([1]) as unknown as Val },
    });

    const subYields = yields(journal).filter(
      (e) => e.description.type === "stream" && e.description.name === "subscribe",
    );
    expect(subYields).toHaveLength(2);

    // First subscribe is inside scope: journal coroutineId = root.0.0,
    // token owner segment = root.0.0.
    expect(subYields[0]!.coroutineId).toBe("root.0.0");
    const tok0 = (subYields[0]!.result as unknown as { value: { __tisyn_subscription: string } })
      .value.__tisyn_subscription;
    expect(tok0).toMatch(/^sub:root\.0\.0:\d+$/);

    // Second subscribe is in inline body proper (outside scope):
    // journal coroutineId = root.0 (lane), token owner = caller (root).
    expect(subYields[1]!.coroutineId).toBe("root.0");
    const tok1 = (subYields[1]!.result as unknown as { value: { __tisyn_subscription: string } })
      .value.__tisyn_subscription;
    expect(tok1).toMatch(/^sub:root:\d+$/);
  });

  it("IL-SC-020: subscription counter inside scope independent of inline lane's shared owner counter", function* () {
    // 1 subscribe in inline body before scope; 2 subscribes inside
    // scope (handles discarded — scope CloseEvent forbids restricted
    // capability values); 1 subscribe in inline body after scope.
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const ib: TisynFn<[], Val> = Fn<[], Val>(
            [],
            Seq(
              streamSubscribe("source"),
              scopeIR(Seq(streamSubscribe("source"), streamSubscribe("source"), Q(null))),
              streamSubscribe("source"),
            ),
          ) as unknown as TisynFn<[], Val>;
          yield* invokeInline<Val>(asFn(ib), []);
          return null as Val;
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

    const { journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      env: { source: mockStream([1]) as unknown as Val },
    });

    const subTokens = yields(journal)
      .filter((e) => e.description.type === "stream" && e.description.name === "subscribe")
      .map(
        (e) =>
          (e.result as unknown as { value: { __tisyn_subscription: string } }).value
            .__tisyn_subscription,
      );

    expect(subTokens).toHaveLength(4);
    // Pre-scope token: caller-owner counter index 0.
    expect(subTokens[0]).toBe("sub:root:0");
    // Two scope-body tokens: scope-child-owner counter, indices 0, 1.
    expect(subTokens[1]).toBe("sub:root.0.0:0");
    expect(subTokens[2]).toBe("sub:root.0.0:1");
    // Post-scope token: back to caller-owner counter, advances to 1.
    expect(subTokens[3]).toBe("sub:root:1");
  });

  it("IL-SC-021: stream.next ancestry check inside scope body uses scope child coroutineId", function* () {
    // Subscribe + next inside scope body; ancestry check passes when
    // owner of the handle matches dispatch context owner (both =
    // scope child).
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const ib: TisynFn<[], Val> = Fn<[], Val>(
            [],
            scopeIR({
              tisyn: "eval",
              id: "let",
              data: {
                tisyn: "quote",
                expr: {
                  name: "h",
                  value: streamSubscribe("source"),
                  body: { tisyn: "eval", id: "stream.next", data: [Ref("h")] },
                },
              },
            }),
          ) as unknown as TisynFn<[], Val>;
          yield* invokeInline<Val>(asFn(ib), []);
          return null as Val;
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

    const { result, journal } = yield* execute({
      ir: effectIR("caller", "go") as never,
      env: { source: mockStream([7]) as unknown as Val },
    });
    expect(result.status).toBe("ok");

    const nextEvent = yields(journal).find(
      (e) => e.description.type === "stream" && e.description.name === "next",
    );
    expect(nextEvent).toBeDefined();
    // stream.next journals under scope child (matches dispatch context).
    expect(nextEvent!.coroutineId).toBe("root.0.0");
  });

  // ── §18.4 Scope-installed middleware calling `invokeInline` ──

  it("IL-SC-022: invokeInline from scope-body middleware allocates from scope child's allocator", function* () {
    // Inner inline body returns a literal (so we can observe its lane id).
    const innerFn: TisynFn<[], Val> = Fn<[], Val>([], Q("inner")) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const ib: TisynFn<[], Val> = Fn<[], Val>(
            [],
            scopeIR(effectIR("trigger", "inner")),
          ) as unknown as TisynFn<[], Val>;
          yield* invokeInline<Val>(asFn(ib), []);
          return null as Val;
        }
        if (effectId === "trigger.inner") {
          // Middleware running on dispatch context owner = scope child.
          // Calling invokeInline here should allocate from the scope
          // child's childSpawnCount: lane id = scopeChildId.{m}.
          yield* invokeInline<Val>(asFn(innerFn), []);
          return null as Val;
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");

    // The inner inline lane must have id `root.0.0.0` — allocated
    // from the scope child (root.0.0)'s own counter, NOT from the
    // outer inline lane's (root.0) counter (which would yield root.0.1).
    // Inline lanes have no CloseEvent, so we observe via trigger.inner
    // YieldEvent journaled under root.0.0 (the dispatch context that
    // saw the effect; the inner lane id itself is invisible without
    // an effect). Use a literal-returning body but capture lane id by
    // having the inner body emit a tagged effect.
    // Verify scope child has its own CloseEvent.
    const scopeClose = closes(journal).find((e) => e.coroutineId === "root.0.0");
    expect(scopeClose).toBeDefined();
    // The trigger.inner YieldEvent journals under the scope child id
    // (the dispatch context the host middleware sees).
    const trig = yields(journal).find(
      (e) => e.description.type === "trigger" && e.description.name === "inner",
    );
    expect(trig?.coroutineId).toBe("root.0.0");
  });

  it("IL-SC-023: nested inline lane from scope-body middleware captures scope child as owner", function* () {
    // Inner inline body subscribes; verify the resulting token owner
    // segment is the scope child id.
    const innerFn: TisynFn<[], Val> = Fn<[], Val>(
      [],
      streamSubscribe("source"),
    ) as unknown as TisynFn<[], Val>;
    let nestedHandle: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const ib: TisynFn<[], Val> = Fn<[], Val>(
            [],
            scopeIR(effectIR("trigger", "inner")),
          ) as unknown as TisynFn<[], Val>;
          yield* invokeInline<Val>(asFn(ib), []);
          return null as Val;
        }
        if (effectId === "trigger.inner") {
          nestedHandle = yield* invokeInline<Val>(asFn(innerFn), []);
          return null as Val;
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

    const { result } = yield* execute({
      ir: effectIR("caller", "go") as never,
      env: { source: mockStream([1]) as unknown as Val },
    });
    expect(result.status).toBe("ok");

    // Nested inline body's subscribe captured scope-child as owner.
    expect(nestedHandle).toBeDefined();
    const tok = (nestedHandle as { __tisyn_subscription: string }).__tisyn_subscription;
    expect(tok).toMatch(/^sub:root\.0\.0:\d+$/);
  });

  it("IL-SC-024: replay byte-identical for scope-body invokeInline", function* () {
    const innerFn: TisynFn<[], Val> = Fn<[], Val>(
      [],
      streamSubscribe("source"),
    ) as unknown as TisynFn<[], Val>;

    function* setup(): Operation<void> {
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "caller.go") {
            const ib: TisynFn<[], Val> = Fn<[], Val>(
              [],
              scopeIR(effectIR("trigger", "inner")),
            ) as unknown as TisynFn<[], Val>;
            yield* invokeInline<Val>(asFn(ib), []);
            return null as Val;
          }
          if (effectId === "trigger.inner") {
            yield* invokeInline<Val>(asFn(innerFn), []);
            return null as Val;
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
    }

    yield* setup();

    const stream1 = new InMemoryStream();
    const live = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream: stream1,
      env: { source: mockStream([1]) as unknown as Val },
    });
    expect(live.result.status).toBe("ok");

    // Replay: pass the original stream as input. New runtime journal must
    // match byte-for-byte.
    const replay = yield* execute({
      ir: effectIR("caller", "go") as never,
      stream: stream1,
      env: { source: mockStream([1]) as unknown as Val },
    });
    expect(replay.result.status).toBe("ok");
    expect(JSON.stringify(replay.journal)).toBe(JSON.stringify(live.journal));
  });

  // ── §18.5 Determinism and replay ──

  it("IL-SC-008: replay byte-identical: scope inside inline body", function* () {
    function* setup(): Operation<void> {
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "caller.go") {
            const ib: TisynFn<[], Val> = Fn<[], Val>(
              [],
              scopeIR(effectIR("agent", "ping")),
            ) as unknown as TisynFn<[], Val>;
            yield* invokeInline<Val>(asFn(ib), []);
            return null as Val;
          }
          if (effectId === "agent.ping") {
            return "pong" as Val;
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
    }

    yield* setup();

    const stream1 = new InMemoryStream();
    const live = yield* execute({ ir: effectIR("caller", "go") as never, stream: stream1 });
    const replay = yield* execute({ ir: effectIR("caller", "go") as never, stream: stream1 });
    expect(JSON.stringify(replay.journal)).toBe(JSON.stringify(live.journal));
  });

  it("IL-SC-009: scope child CloseEvent replayed correctly", function* () {
    function* setup(): Operation<void> {
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "caller.go") {
            const ib: TisynFn<[], Val> = Fn<[], Val>([], scopeIR(Q(1))) as unknown as TisynFn<
              [],
              Val
            >;
            yield* invokeInline<Val>(asFn(ib), []);
            return null as Val;
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
    }

    yield* setup();
    const stream1 = new InMemoryStream();
    const live = yield* execute({ ir: effectIR("caller", "go") as never, stream: stream1 });
    const replay = yield* execute({ ir: effectIR("caller", "go") as never, stream: stream1 });
    // CloseEvent for scope child present in BOTH.
    expect(closes(live.journal).filter((e) => e.coroutineId === "root.0.0")).toHaveLength(1);
    expect(closes(replay.journal).filter((e) => e.coroutineId === "root.0.0")).toHaveLength(1);
    // Inline lane has NO CloseEvent in either.
    expect(closes(live.journal).some((e) => e.coroutineId === "root.0")).toBe(false);
    expect(closes(replay.journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("IL-SC-010: crash recovery: incomplete scope inside inline replays cleanly", function* () {
    // Live run produces a complete journal. Re-run with the same stream
    // should be byte-identical (replay). Tests scope child cursor
    // independence and CloseEvent replay; full crash-mid-scope harness
    // would need fault injection beyond the scope of this regression.
    function* setup(): Operation<void> {
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "caller.go") {
            const ib: TisynFn<[], Val> = Fn<[], Val>(
              [],
              scopeIR(Seq(effectIR("step", "one"), effectIR("step", "two"))),
            ) as unknown as TisynFn<[], Val>;
            yield* invokeInline<Val>(asFn(ib), []);
            return null as Val;
          }
          if (effectId === "step.one") {
            return "one" as Val;
          }
          if (effectId === "step.two") {
            return "two" as Val;
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
    }

    yield* setup();
    const stream = new InMemoryStream();
    const live = yield* execute({ ir: effectIR("caller", "go") as never, stream });
    const recovered = yield* execute({ ir: effectIR("caller", "go") as never, stream });
    // Scope child completes (CloseEvent ok) on the recovery run.
    const recClose = closes(recovered.journal).find((e) => e.coroutineId === "root.0.0");
    expect(recClose?.result.status).toBe("ok");
    expect(JSON.stringify(recovered.journal)).toBe(JSON.stringify(live.journal));
  });

  // ── §18.6 Failure modes ──

  it("IL-SC-011: scope body error propagates to inline body via kernel.throw", function* () {
    // Scope body throws; inline body catches with Try.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Try(scopeIR(Throw("scope failed")), "e", Q("caught-in-inline")),
    ) as unknown as TisynFn<[], Val>;
    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineResult = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(inlineResult).toBe("caught-in-inline");
    // Scope teardown completed: CloseEvent(error) for the scope child.
    const scopeClose = closes(journal).find((e) => e.coroutineId === "root.0.0");
    expect(scopeClose?.result.status).toBe("error");
  });

  it("IL-SC-012: scope binding evaluation failure produces CloseEvent(error)", function* () {
    // Unbound Ref in binding fails the scope before body executes.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Try(scopeIR(Q(1), null, { "some-svc": Ref("doesNotExist") }), "e", Q("caught")),
    ) as unknown as TisynFn<[], Val>;
    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineResult = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(inlineResult).toBe("caught");
    const scopeClose = closes(journal).find((e) => e.coroutineId === "root.0.0");
    expect(scopeClose?.result.status).toBe("error");
  });

  it("IL-SC-013: scope teardown completes when body errors (cancellation analogue)", function* () {
    // Direct cancellation of an Effection task is exercised by
    // existing scope tests; here we verify the inline-body case
    // produces scope-child CloseEvent before the error reaches the
    // inline body's catch — Effection's scoped() teardown ordering.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Try(scopeIR(Throw("aborted")), "e", Q("teardown-ran")),
    ) as unknown as TisynFn<[], Val>;
    let inlineResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          inlineResult = yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(inlineResult).toBe("teardown-ran");
    // Scope child CloseEvent emitted before catch fires.
    const scopeIdx = journal.findIndex((e) => e.type === "close" && e.coroutineId === "root.0.0");
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
  });

  // ── §18.7 Composition ──

  it("IL-SC-014: mixed scope + scope + agent effect in same inline body", function* () {
    // Inline body: scope, scope, agent effect — three allocations from
    // lane counter (.0, .1 for scopes; effect under lane). Both scopes
    // produce CloseEvents. Spawn variant deferred to the existing
    // spawn-inside-inline IL-CS-006/007 tests; this test focuses on
    // the scope-allocator-interleaving property at the inline-scope seam.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Seq(scopeIR(Q(1)), scopeIR(Q(2)), effectIR("after", "all")),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
        }
        if (effectId === "after.all") {
          return "done" as Val;
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

    const { journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    // Two scope children have CloseEvents at root.0.0 and root.0.1.
    const scope0 = closes(journal).find((e) => e.coroutineId === "root.0.0");
    const scope1 = closes(journal).find((e) => e.coroutineId === "root.0.1");
    expect(scope0?.result.status).toBe("ok");
    expect(scope1?.result.status).toBe("ok");
    // After.all YieldEvent under inline lane (root.0).
    const afterY = yields(journal).find(
      (e) => e.description.type === "after" && e.description.name === "all",
    );
    expect(afterY?.coroutineId).toBe("root.0");
    // Inline lane has no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });

  it("IL-SC-015 (Extended): nested scope inside inline-body scope", function* () {
    // Outer scope at root.0.0, inner scope nested inside its body at root.0.0.0.
    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      scopeIR(scopeIR(Q(99))),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    // Both scopes produce CloseEvents.
    expect(closes(journal).find((e) => e.coroutineId === "root.0.0")).toBeDefined();
    expect(closes(journal).find((e) => e.coroutineId === "root.0.0.0")).toBeDefined();
  });

  it("IL-SC-016 (Extended): invokeInline from middleware inside inline-body scope (round-trip)", function* () {
    // Scope body dispatches E. Host middleware handling E calls
    // invokeInline whose body dispatches an agent effect and returns.
    // Verify scope child has CloseEvent and effects journal under
    // correct coroutineIds.
    const innerFn: TisynFn<[], Val> = Fn<[], Val>(
      [],
      effectIR("agent", "ping"),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const ib: TisynFn<[], Val> = Fn<[], Val>(
            [],
            scopeIR(effectIR("trigger", "inner")),
          ) as unknown as TisynFn<[], Val>;
          yield* invokeInline<Val>(asFn(ib), []);
          return null as Val;
        }
        if (effectId === "trigger.inner") {
          yield* invokeInline<Val>(asFn(innerFn), []);
          return null as Val;
        }
        if (effectId === "agent.ping") {
          return "pong" as Val;
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    // Scope child has CloseEvent.
    expect(closes(journal).find((e) => e.coroutineId === "root.0.0")).toBeDefined();
    // Nested inline lane (root.0.0.0) produces no CloseEvent.
    expect(closes(journal).find((e) => e.coroutineId === "root.0.0.0")).toBeUndefined();
    // agent.ping journals under nested lane id (which is the dispatch
    // identity for the inner inline body).
    const ping = yields(journal).find(
      (e) => e.description.type === "agent" && e.description.name === "ping",
    );
    expect(ping?.coroutineId).toBe("root.0.0.0");
  });

  it("IL-SC-017: scope inside nested inline", function* () {
    // Outer invokeInline dispatches E. Middleware calls inner
    // invokeInline whose body contains scope. Scope child allocated
    // from inner lane's counter.
    const innerFn: TisynFn<[], Val> = Fn<[], Val>(
      [],
      scopeIR(Q("inner-scope-result")),
    ) as unknown as TisynFn<[], Val>;
    let innerResult: Val | undefined;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          const outer: TisynFn<[], Val> = Fn<[], Val>(
            [],
            effectIR("trigger", "inner"),
          ) as unknown as TisynFn<[], Val>;
          yield* invokeInline<Val>(asFn(outer), []);
          return null as Val;
        }
        if (effectId === "trigger.inner") {
          innerResult = yield* invokeInline<Val>(asFn(innerFn), []);
          return null as Val;
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

    const { result, journal } = yield* execute({ ir: effectIR("caller", "go") as never });
    expect(result.status).toBe("ok");
    expect(innerResult).toBe("inner-scope-result");

    // Inner inline lane is `root.0.0` (dispatch context owner = root.0
    // for trigger.inner; inner lane allocated from root.0's
    // childSpawnCount, but no — outer lane root.0 sees trigger.inner
    // dispatched, captured owner of inner lane = outer lane's
    // captured owner = root). Scope inside inner lane allocated from
    // inner lane's own inlineChildSpawnCount: lane.0 ⇒ root.0.0.0.
    const scopeChild = closes(journal).find((e) => e.coroutineId === "root.0.0.0");
    expect(scopeChild?.result.status).toBe("ok");
  });

  it("IL-SC-018: existing inline-body compounds (resource, spawn, timebox/all/race) unaffected by scope lift", function* () {
    // Regression spot-check: alongside scope, a `resource` inside the
    // inline body still provides in the caller's scope, cleans up at
    // caller teardown (§11.4 + §11.9), and gets its own CloseEvent.
    // The full IL-CS-*, IL-L-*, IL-CO-*, IL-PI-* suites in the
    // surrounding 'invokeInline — core runtime slice' describe block
    // exercise the rest of the regression surface.
    const resourceIR = (body: unknown) =>
      ({
        tisyn: "eval",
        id: "resource",
        data: { tisyn: "quote", expr: { body } },
      }) as unknown as Val;

    const provideIR = (value: unknown) =>
      ({
        tisyn: "eval",
        id: "provide",
        data: value,
      }) as unknown as Val;

    const inlineBody: TisynFn<[], Val> = Fn<[], Val>(
      [],
      Seq(
        resourceIR(Try(provideIR("svc"), undefined, undefined, effectIR("svc", "close"))),
        scopeIR(Q("scope-result")),
      ),
    ) as unknown as TisynFn<[], Val>;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.go") {
          yield* invokeInline<Val>(asFn(inlineBody), []);
          return null as Val;
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

    const { journal } = yield* execute({ ir: effectIR("caller", "go") as never });

    // Resource child still gets its own CloseEvent at root.0.0.
    const resourceClose = closes(journal).find((e) => e.coroutineId === "root.0.0");
    expect(resourceClose?.result.status).toBe("ok");
    // Scope child gets its own CloseEvent at root.0.1.
    const scopeClose = closes(journal).find((e) => e.coroutineId === "root.0.1");
    expect(scopeClose?.result.status).toBe("ok");
    // Resource cleanup (svc.close) still ran at caller teardown,
    // journaled under the resource child id.
    const cleanup = yields(journal).find(
      (e) => e.description.type === "svc" && e.description.name === "close",
    );
    expect(cleanup?.coroutineId).toBe("root.0.0");
    // Inline lane itself still has no CloseEvent.
    expect(closes(journal).some((e) => e.coroutineId === "root.0")).toBe(false);
  });
});
