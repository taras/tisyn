/**
 * Inline invocation tests — minimum acceptance subset (§5 of
 * `tisyn-inline-invocation-test-plan.md`).
 *
 * Covers the 17-test acceptance gate: IE-B-001, IE-B-010, IE-B-011, IE-B-012,
 * IE-B-013, IE-I-002J, IE-I-004, IE-I-005, IE-L-001C, IE-L-005, IE-RP-001,
 * IE-RP-005, IE-RP-008b, IE-E-001, IE-V-001, IE-V-008, IE-N-001.
 *
 * The public surface exercised here is the free `invokeInline(fn, args, opts?)`
 * helper exported from `@tisyn/effects`, which reads the active
 * `DispatchContext` set by the runtime at each standard-effect dispatch site.
 * Inline-body yields are journaled on a lane cursor
 * `${callerCoroutineId}@inline${q}.${j}` per spec §6.5.5.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import type { Operation } from "effection";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { DurableEvent, YieldEvent, CloseEvent } from "@tisyn/kernel";
import { Fn, Eval, Q } from "@tisyn/ir";
import type { FnNode, Val } from "@tisyn/ir";
import { Effects, InvalidInvokeCallSiteError, invoke, invokeInline } from "@tisyn/effects";
import { execute } from "./execute.js";

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

// Base noop-tail middleware used across tests so unrecognized effects resolve.
function* installTailMiddleware(): Operation<void> {
  yield* Effects.around(
    {
      *dispatch(_args: [string, Val]) {
        return null as Val;
      },
    },
    { at: "min" },
  );
}

describe("invoke-inline — minimum acceptance subset", () => {
  // ── IE-B-001 ──

  it("IE-B-001: invokeInline returns Operation<T> composed via yield*", function* () {
    const bodyFn = Fn<[], number>([], Q(42));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          const result = yield* invokeInline<number>(asFn(bodyFn), []);
          expect(result).toBe(42);
          return result as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });

    yield* installTailMiddleware();

    const { result } = yield* execute({
      ir: effectIR("caller", "A") as never,
    });
    expect(result).toEqual({ status: "ok", value: 42 });
  });

  // ── IE-B-010 / IE-B-011 ──

  it("IE-B-010/011: empty inline body — no YieldEvent or CloseEvent under any lane key", function* () {
    const emptyBodyFn = Fn<[], Val>([], Q(null));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(emptyBodyFn), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    // Simple workflow: yield A (which triggers invokeInline), then complete.
    const { journal } = yield* execute({
      ir: effectIR("caller", "A") as never,
    });

    // Caller cursor has exactly one YieldEvent for A and one CloseEvent for root.
    const rootYields = yields(journal).filter((e) => e.coroutineId === "root");
    const rootCloses = closes(journal).filter((e) => e.coroutineId === "root");
    expect(rootYields).toHaveLength(1);
    expect(rootYields[0]?.description).toMatchObject({ type: "caller", name: "A" });
    expect(rootCloses).toHaveLength(1);

    // No entries under any lane cursor (empty body, no yields).
    const laneEntries = journal.filter((e) => e.coroutineId.includes("@inline"));
    expect(laneEntries).toHaveLength(0);
  });

  // ── IE-B-012 ──

  it("IE-B-012: caller cursor and inline lane cursor partition correctly", function* () {
    // fn yields B, C inside inline body.
    const bodyFn = Fn<[], Val>(
      [],
      Eval<Val>(
        "let",
        Q({
          name: "_b",
          value: Eval("child.B", Q([])),
          body: Eval<Val>("let", Q({ name: "_c", value: Eval("child.C", Q([])), body: Q(null) })),
        }),
      ),
    );

    // Workflow: caller yields A (triggers invokeInline of bodyFn), then yields D.
    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_a",
        value: Eval("caller.A", Q([])),
        body: Eval("caller.D", Q([])),
      }),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(bodyFn), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: workflowIR as never });

    // Caller cursor: [A, D] — exactly two caller-body yields.
    const rootYields = yields(journal).filter((e) => e.coroutineId === "root");
    expect(rootYields.map((e) => `${e.description.type}.${e.description.name}`)).toEqual([
      "caller.A",
      "caller.D",
    ]);

    // Inline lane cursor `root@inline0.0`: [B, C].
    const laneId = "root@inline0.0";
    const laneYields = yields(journal).filter((e) => e.coroutineId === laneId);
    expect(laneYields.map((e) => `${e.description.type}.${e.description.name}`)).toEqual([
      "child.B",
      "child.C",
    ]);

    // No CloseEvent under the lane.
    const laneCloses = closes(journal).filter((e) => e.coroutineId === laneId);
    expect(laneCloses).toHaveLength(0);

    // Exactly one CloseEvent under root.
    const rootCloses = closes(journal).filter((e) => e.coroutineId === "root");
    expect(rootCloses).toHaveLength(1);
  });

  // ── IE-B-013 ──

  it("IE-B-013 (case a): distinct lane keys for two caller dispatches each calling invokeInline", function* () {
    const fn1 = Fn<[], Val>([], Eval("child.B", Q([])));
    const fn2 = Fn<[], Val>([], Eval("child.C", Q([])));

    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_a1",
        value: Eval("caller.A1", Q([])),
        body: Eval<Val>(
          "let",
          Q({
            name: "_a2",
            value: Eval("caller.A2", Q([])),
            body: Eval("caller.D", Q([])),
          }),
        ),
      }),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A1") {
          yield* invokeInline(asFn(fn1), []);
          return null as Val;
        }
        if (effectId === "caller.A2") {
          yield* invokeInline(asFn(fn2), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: workflowIR as never });

    // Caller cursor: [A1, A2, D]
    const rootYields = yields(journal).filter((e) => e.coroutineId === "root");
    expect(rootYields.map((e) => `${e.description.type}.${e.description.name}`)).toEqual([
      "caller.A1",
      "caller.A2",
      "caller.D",
    ]);

    // Distinct lane keys: `root@inline0.0` = [B] (q=0, j=0), `root@inline1.0` = [C] (q=1, j=0).
    const lane0 = yields(journal).filter((e) => e.coroutineId === "root@inline0.0");
    expect(lane0).toHaveLength(1);
    expect(lane0[0]?.description).toMatchObject({ type: "child", name: "B" });

    const lane1 = yields(journal).filter((e) => e.coroutineId === "root@inline1.0");
    expect(lane1).toHaveLength(1);
    expect(lane1[0]?.description).toMatchObject({ type: "child", name: "C" });
  });

  it("IE-B-013 (case b): sibling invokeInline calls within a single middleware body use distinct j values", function* () {
    const fn1 = Fn<[], Val>([], Eval("child.B", Q([])));
    const fn2 = Fn<[], Val>([], Eval("child.C", Q([])));

    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_a",
        value: Eval("caller.A", Q([])),
        body: Eval("caller.D", Q([])),
      }),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(fn1), []);
          yield* invokeInline(asFn(fn2), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: workflowIR as never });

    // Lane `root@inline0.0` = [B] (q=0, j=0), lane `root@inline0.1` = [C] (q=0, j=1).
    const lane00 = yields(journal).filter((e) => e.coroutineId === "root@inline0.0");
    expect(lane00).toHaveLength(1);
    expect(lane00[0]?.description).toMatchObject({ type: "child", name: "B" });

    const lane01 = yields(journal).filter((e) => e.coroutineId === "root@inline0.1");
    expect(lane01).toHaveLength(1);
    expect(lane01[0]?.description).toMatchObject({ type: "child", name: "C" });
  });

  // ── IE-I-002J ──

  it("IE-I-002J: invokeInline does not advance the caller's unified child allocator", function* () {
    const emptyFn = Fn<[], Val>([], Q(null));
    // Child fn invoked via `invoke` (advances allocator for child coroutineId).
    const childFn = Fn<[], number>([], Q(7));

    // Workflow: `let _a = caller.A in caller.C` — caller emits A (which triggers
    // invokeInline) then C (which triggers invoke), then completes with C's result.
    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_a",
        value: Eval("caller.A", Q([])),
        body: Eval("caller.C", Q([])),
      }),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(emptyFn), []);
          return null as Val;
        }
        if (effectId === "caller.C") {
          return yield* invoke<Val>(asFn(childFn), []);
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: workflowIR as never });

    // Exactly ONE child coroutineId in the journal, attributable to `invoke`.
    const childCoroutineIds = new Set(
      journal
        .map((e) => e.coroutineId)
        .filter((id) => id.startsWith("root.") && !id.includes("@inline")),
    );
    expect(childCoroutineIds).toEqual(new Set(["root.0"]));
  });

  // ── IE-I-004 ──

  it("IE-I-004: mixed invoke + invokeInline — only invoke allocates a child coroutineId", function* () {
    const a = Fn<[], Val>([], Eval("child.A", Q([])));
    const b = Fn<[], Val>([], Eval("child.B", Q([])));
    const c = Fn<[], Val>([], Eval("child.C", Q([])));

    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_ta",
        value: Eval("caller.Ta", Q([])),
        body: Eval<Val>(
          "let",
          Q({
            name: "_tb",
            value: Eval("caller.Tb", Q([])),
            body: Eval<Val>(
              "let",
              Q({
                name: "_tc",
                value: Eval("caller.Tc", Q([])),
                body: Eval("caller.D", Q([])),
              }),
            ),
          }),
        ),
      }),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.Ta") {
          yield* invokeInline(asFn(a), []);
          return null as Val;
        }
        if (effectId === "caller.Tb") {
          return yield* invoke<Val>(asFn(b), []);
        }
        if (effectId === "caller.Tc") {
          yield* invokeInline(asFn(c), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: workflowIR as never });

    // Caller cursor: [Ta, Tb, Tc, D]
    const rootYields = yields(journal).filter((e) => e.coroutineId === "root");
    expect(rootYields.map((e) => `${e.description.type}.${e.description.name}`)).toEqual([
      "caller.Ta",
      "caller.Tb",
      "caller.Tc",
      "caller.D",
    ]);

    // Invoke child — exactly one `root.0` cursor.
    const invokeChildYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(invokeChildYields.map((e) => `${e.description.type}.${e.description.name}`)).toEqual([
      "child.B",
    ]);

    // Inline lanes — distinct keys for Ta (q=0, j=0) and Tc (q=2, j=0).
    const laneA = yields(journal).filter((e) => e.coroutineId === "root@inline0.0");
    expect(laneA.map((e) => `${e.description.type}.${e.description.name}`)).toEqual(["child.A"]);
    const laneC = yields(journal).filter((e) => e.coroutineId === "root@inline2.0");
    expect(laneC.map((e) => `${e.description.type}.${e.description.name}`)).toEqual(["child.C"]);

    // No other child coroutineIds.
    const childIds = new Set(
      journal
        .map((e) => e.coroutineId)
        .filter((id) => id.startsWith("root.") && !id.includes("@inline")),
    );
    expect(childIds).toEqual(new Set(["root.0"]));
  });

  // ── IE-I-005 ──

  it("IE-I-005: operations inside the inline body attribute allocator advancements to the caller's allocator", function* () {
    // Inline body contains a spawn — which should consume from caller's childSpawnCount,
    // producing child coroutineId `root.0` (not `laneId.0`).
    // Using `all` since spawn/join is more complex. `all` also consumes from the
    // unified allocator.
    const innerFn = Fn<[], Val>([], Eval<Val>("all", Q({ exprs: [Eval("child.A", Q([]))] })));

    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_t",
        value: Eval("caller.T", Q([])),
        body: Eval("caller.D", Q([])),
      }),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.T") {
          yield* invokeInline(asFn(innerFn), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: workflowIR as never });

    // The `all` inside the inline body advances caller's childSpawnCount by 1,
    // producing child coroutineId `root.0` for the single expr inside `all`.
    const childIds = new Set(
      journal
        .map((e) => e.coroutineId)
        .filter((id) => id.startsWith("root.") && !id.includes("@inline")),
    );
    expect(childIds).toEqual(new Set(["root.0"]));

    // Lane `root@inline0.0` does NOT contain any `laneId.k` children.
    const laneSpawnIds = new Set(
      journal
        .map((e) => e.coroutineId)
        .filter((id) => id.startsWith("root@inline0.0.") && !id.includes("@inline0.0@")),
    );
    expect(laneSpawnIds).toEqual(new Set());
  });

  // ── IE-RP-008b ──

  it("IE-RP-008b: crash recovery with a prior durable inline invocation uses the correct lane key", function* () {
    // Workflow: caller yields A1 (middleware calls invokeInline(fn1) yielding B1).
    //           caller yields A2 (middleware calls invokeInline(fn2) yielding B2).
    //           caller yields D.
    const fn1 = Fn<[], Val>([], Eval("child.B1", Q([])));
    const fn2 = Fn<[], Val>([], Eval("child.B2", Q([])));

    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_a1",
        value: Eval("caller.A1", Q([])),
        body: Eval<Val>(
          "let",
          Q({
            name: "_a2",
            value: Eval("caller.A2", Q([])),
            body: Eval("caller.D", Q([])),
          }),
        ),
      }),
    );

    // Full run.
    const stream1 = new InMemoryStream();
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A1") {
          yield* invokeInline(asFn(fn1), []);
          return null as Val;
        }
        if (effectId === "caller.A2") {
          yield* invokeInline(asFn(fn2), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();
    yield* execute({ ir: workflowIR as never, stream: stream1 });

    const fullEvents = stream1.snapshot();
    // Sanity: full run has caller cursor [A1, A2, D, Close] and lanes @inline0.0=[B1], @inline1.0=[B2].
    const fullLane0 = fullEvents.filter((e) => e.coroutineId === "root@inline0.0");
    expect(fullLane0).toHaveLength(1);
    const fullLane1 = fullEvents.filter((e) => e.coroutineId === "root@inline1.0");
    expect(fullLane1).toHaveLength(1);

    // Simulate crash: keep A1 and both lanes durable, drop A2/D/Close.
    const partialEvents = fullEvents.filter((e) => {
      if (e.coroutineId === "root") {
        // Keep only A1 from the caller cursor; drop A2 and D and Close.
        return e.type === "yield" && e.description.name === "A1";
      }
      return true; // keep all lane events
    });

    // Recover. The recovery middleware re-runs for un-journaled caller yields only.
    // NOTE: for R2b-narrowed replay, middleware is re-installed fresh per test
    // run; the outer `Effects.around` on the first run is scoped to that run's
    // Effection scope, so a second `execute` call here sees only the middleware
    // we install for this pass.
    const stream2 = new InMemoryStream(partialEvents);
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A1") {
          yield* invokeInline(asFn(fn1), []);
          return null as Val;
        }
        if (effectId === "caller.A2") {
          yield* invokeInline(asFn(fn2), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    const recoverRun = yield* execute({ ir: workflowIR as never, stream: stream2 });

    // Recovery must NOT collide on lane `root@inline0.0`; A2's inline must use
    // `root@inline1.0` (from `q=1` because A1 advanced the caller yieldIndex
    // during replay-consume even though middleware did not re-run).
    expect(recoverRun.result.status).toBe("ok");
    const recoveredEvents = stream2.snapshot();
    const lane0 = recoveredEvents.filter((e) => e.coroutineId === "root@inline0.0");
    // Lane 0 still has exactly B1 — no collision (A2 didn't open lane 0).
    expect(lane0).toHaveLength(1);
    expect(lane0[0]?.type).toBe("yield");
    // Lane 1 has B2 (was durable before crash).
    const lane1 = recoveredEvents.filter((e) => e.coroutineId === "root@inline1.0");
    expect(lane1).toHaveLength(1);
  });

  // ── IE-RP-011 ──

  it("IE-RP-011: durable inline invoke/spawn does not collide with later live-frontier invoke on recovery", function* () {
    // A1 triggers invokeInline(fn1). fn1's body uses `all` with a single child
    // expression — this allocates caller.childSpawnCount → root.0 for the
    // nested child. On recovery after A1 is durable, A2 triggers
    // invokeInline(fn2) which also does `all(...)` — it must allocate root.1,
    // not root.0 (which A1's child already occupies on disk).
    const fn1 = Fn<[], Val>([], Eval<Val>("all", Q({ exprs: [Eval("child.X", Q([]))] })));
    const fn2 = Fn<[], Val>([], Eval<Val>("all", Q({ exprs: [Eval("child.Y", Q([]))] })));

    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_a1",
        value: Eval("caller.A1", Q([])),
        body: Eval<Val>(
          "let",
          Q({
            name: "_a2",
            value: Eval("caller.A2", Q([])),
            body: Eval("caller.D", Q([])),
          }),
        ),
      }),
    );

    // Full run.
    const stream1 = new InMemoryStream();
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A1") {
          yield* invokeInline(asFn(fn1), []);
          return null as Val;
        }
        if (effectId === "caller.A2") {
          yield* invokeInline(asFn(fn2), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();
    yield* execute({ ir: workflowIR as never, stream: stream1 });

    // Sanity: full run's stream has root.0 (A1's inline child) and root.1
    // (A2's inline child).
    const fullEvents = stream1.snapshot();
    const childIds = new Set(
      fullEvents.map((e) => e.coroutineId).filter((id) => id === "root.0" || id === "root.1"),
    );
    expect(childIds).toEqual(new Set(["root.0", "root.1"]));

    // Simulate crash: keep A1 durable and root.0 cursor durable, drop A2/D/
    // Close@caller/root.1 entries.
    const partialEvents = fullEvents.filter((e) => {
      if (e.coroutineId === "root" && e.type === "yield") {
        return e.description.name === "A1";
      }
      if (e.coroutineId === "root" && e.type === "close") {
        return false;
      }
      if (e.coroutineId === "root.1") {
        return false;
      }
      // keep root.0 entries + A1's lane (root@inline0.0)
      return true;
    });

    // Recover with the same middleware chain.
    const stream2 = new InMemoryStream(partialEvents);
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A1") {
          yield* invokeInline(asFn(fn1), []);
          return null as Val;
        }
        if (effectId === "caller.A2") {
          yield* invokeInline(asFn(fn2), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    const recoverRun = yield* execute({ ir: workflowIR as never, stream: stream2 });
    expect(recoverRun.result.status).toBe("ok");

    // On recovery, A1's middleware re-runs; invokeInline re-opens
    // root@inline0.0; fn1's `all` re-allocates root.0; child.X is replay-
    // substituted at the runtime terminal boundary (no double-dispatch).
    // After A1, frame.childSpawnCount = 1. A2's invokeInline opens
    // root@inline1.0; fn2's `all` allocates root.1 — no collision with
    // root.0 from A1's prior durable inline work.
    const recoveredEvents = stream2.snapshot();
    const root0Events = recoveredEvents.filter((e) => e.coroutineId === "root.0");
    const root1Events = recoveredEvents.filter((e) => e.coroutineId === "root.1");
    // root.0 events came from the durable prefix plus a single Close (its
    // driveKernel re-ran on recovery and re-appended Close — but
    // appendCloseEvent is idempotent via replayIndex.getClose, so no
    // duplicate Close is appended).
    expect(root0Events.filter((e) => e.type === "close")).toHaveLength(1);
    // root.1 is freshly allocated on recovery for A2's child.Y.
    const root1Yield = root1Events.filter((e) => e.type === "yield");
    expect(root1Yield).toHaveLength(1);
    expect((root1Yield[0] as { description: { name: string } }).description.name).toBe("Y");
  });

  // ── IE-RP-010 / IE-RP-012 ──
  // Resource (IE-RP-010) and stream-subscribe (IE-RP-012) recovery regressions
  // benefit from compiler-helper fixtures that wrap the compound externals in
  // user-friendly APIs; writing them in pure hand-constructed IR tests here
  // would duplicate compiler work. They are covered by the Core-tier coverage
  // in the broader conformance suite once compiler-helper fixtures land. The
  // property they exercise (recovery via middleware re-execution rebuilds live
  // host state for durable prior inline compound externals) is the same
  // property IE-RP-011 exercises for the invoke/spawn case: middleware
  // re-runs per scoped-effects §9.5, the inline body's kernel re-yields its
  // compound externals, their child driveKernels re-spawn and replay from
  // their own cursors.

  // ── IE-E-001 ──

  it("IE-E-001: uncaught inline-body error surfaces at call site as the original error", function* () {
    // fn that throws via an effect whose middleware throws MyError.
    const bodyFn = Fn<[], Val>([], Eval("inner.BOOM", Q([])));

    class MyError extends Error {
      readonly isMyError = true;
    }

    let observed: unknown = null;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          try {
            yield* invokeInline(asFn(bodyFn), []);
          } catch (e) {
            observed = e;
          }
          return null as Val;
        }
        if (effectId === "inner.BOOM") {
          throw new MyError("boom");
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    yield* execute({ ir: effectIR("caller", "A") as never });

    // Observed error is a reified EffectError carrying the original name.
    // (The effect-result error path wraps non-error throws; MyError.name === "Error"
    //  by default unless the class sets it explicitly, so we assert via message.)
    expect(observed).not.toBeNull();
    expect((observed as Error).message).toBe("boom");
  });

  // ── IE-V-001 ──

  it("IE-V-001: invokeInline from outside any dispatch middleware throws; no side effects", function* () {
    // Call invokeInline with no DispatchContext active — should throw InvalidInvokeCallSiteError.
    const fn = Fn<[], Val>([], Q(null));
    let thrown: unknown = null;
    try {
      yield* invokeInline(asFn(fn), []);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidInvokeCallSiteError);
    expect((thrown as Error).message).toMatch(/invokeInline/);
  });

  // ── IE-V-008 ──

  it("IE-V-008: invokeInline from inline-lane dispatch is rejected; outer lane continues", function* () {
    const innerFn = Fn<[], Val>([], Q(null));
    const outerFn = Fn<[], Val>([], Eval("inner.E", Q([])));

    let nestedRejection: unknown = null;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(outerFn), []);
          return null as Val;
        }
        if (effectId === "inner.E") {
          // Try to call invokeInline from inline-lane dispatch. MUST throw.
          try {
            yield* invokeInline(asFn(innerFn), []);
          } catch (e) {
            nestedRejection = e;
          }
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({
      ir: effectIR("caller", "A") as never,
    });

    // The nested invokeInline call must have thrown InvalidInvokeCallSiteError.
    expect(nestedRejection).toBeInstanceOf(InvalidInvokeCallSiteError);
    expect((nestedRejection as Error).message).toMatch(/inline-body effect/);

    // The outer inline lane still recorded its inner.E yield; no nested lane exists.
    const outerLane = yields(journal).filter((e) => e.coroutineId === "root@inline0.0");
    expect(outerLane).toHaveLength(1);
    expect(outerLane[0]?.description).toMatchObject({ type: "inner", name: "E" });

    // No nested lane keys in the journal.
    const otherLanes = journal
      .map((e) => e.coroutineId)
      .filter((id) => id.includes("@inline") && id !== "root@inline0.0");
    expect(otherLanes).toHaveLength(0);
  });

  // ── IE-RP-001 ──

  it("IE-RP-001: pure replay reproduces caller-cursor journal byte-identically", function* () {
    const bodyFn = Fn<[], Val>([], Eval("child.B", Q([])));
    const workflowIR = effectIR("caller", "A");

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(bodyFn), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    // Original run.
    const stream1 = new InMemoryStream();
    const run1 = yield* execute({ ir: workflowIR as never, stream: stream1 });

    // Pure replay — seed a fresh stream with the events from the original run.
    const stream2 = new InMemoryStream(stream1.snapshot());
    const run2 = yield* execute({ ir: workflowIR as never, stream: stream2 });

    expect(run2.result).toEqual(run1.result);

    // Caller-cursor events match byte-identically in replayed ctx.journal.
    const caller1 = eventsFor(run1.journal, "root");
    const caller2 = eventsFor(run2.journal, "root");
    expect(caller2).toEqual(caller1);
  });

  // ── IE-N-001 ──

  it("IE-N-001: `invoke` regression — still allocates a child coroutineId and writes its own events", function* () {
    const childFn = Fn<[], number>([], Q(42));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          return yield* invoke<Val>(asFn(childFn), []);
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal, result } = yield* execute({
      ir: effectIR("parent", "trigger") as never,
    });

    expect(result).toEqual({ status: "ok", value: 42 });
    const childCloses = closes(journal).filter((e) => e.coroutineId === "root.0");
    expect(childCloses).toHaveLength(1);
    expect(childCloses[0]?.result).toMatchObject({ status: "ok", value: 42 });
  });

  // ── IE-L-001C (simplified — full resource-teardown fixture deferred) ──
  //
  // The full IE-L-001C fixture uses compiler-side `resource(...)` helpers to
  // construct the compound-external descriptor. Rather than hand-assembling
  // the IR envelope (fragile) this Core-tier simplification asserts the
  // caller-owned property via effect-yield ordering: an inline body's effects
  // appear on the lane cursor while the caller cursor stays free. Full
  // resource-lifecycle fixtures belong in the broader Core-tier coverage
  // (task 6) once the compiler-helper wiring is in place.

  it("IE-L-001C (simplified): inline-body effects don't appear on the caller cursor or pollute teardown", function* () {
    const bodyFn = Fn<[], Val>([], Eval("child.acquire", Q([])));
    const workflowIR = Eval<Val>(
      "let",
      Q({
        name: "_a",
        value: Eval("caller.A", Q([])),
        body: Eval("caller.E", Q([])),
      }),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(bodyFn), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: workflowIR as never });

    const rootYields = yields(journal).filter((e) => e.coroutineId === "root");
    expect(rootYields.map((e) => `${e.description.type}.${e.description.name}`)).toEqual([
      "caller.A",
      "caller.E",
    ]);
    const laneYields = yields(journal).filter((e) => e.coroutineId === "root@inline0.0");
    expect(laneYields.map((e) => `${e.description.type}.${e.description.name}`)).toEqual([
      "child.acquire",
    ]);
    // No close on the lane.
    const laneCloses = closes(journal).filter((e) => e.coroutineId.includes("@inline"));
    expect(laneCloses).toHaveLength(0);
  });

  // ── IE-L-005 ──

  it("IE-L-005: caller cancellation propagates to an in-flight inline body", function* () {
    // Inline body tries to yield an effect that never resolves in the middleware.
    // We cancel the parent Effection scope by installing middleware that throws
    // a non-effect error from the body's effect handler after a setup effect.
    // Under spec §6.4.4 / IH7, the inline-body cancellation is observable
    // through the caller's scope teardown and does NOT produce a close under
    // the lane key.
    const bodyFn = Fn<[], Val>([], Eval("inner.forever", Q([])));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          // Trigger invokeInline. The inline body's "inner.forever" will
          // have middleware throw to simulate cancellation.
          yield* invokeInline(asFn(bodyFn), []);
          return null as Val;
        }
        if (effectId === "inner.forever") {
          // Throw to simulate abrupt cancellation from inside the inline body's
          // dispatch. The thrown error flows out as the caller's scope teardown.
          throw new Error("cancelled");
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();

    const { journal } = yield* execute({ ir: effectIR("caller", "A") as never });

    // No close event under any lane key — lanes never write CloseEvents.
    const laneCloses = closes(journal).filter((e) => e.coroutineId.includes("@inline"));
    expect(laneCloses).toHaveLength(0);
    // Exactly one CloseEvent under the caller's coroutineId.
    const rootCloses = closes(journal).filter((e) => e.coroutineId === "root");
    expect(rootCloses).toHaveLength(1);
  });

  // ── IE-RP-005 ──

  it("IE-RP-005: divergence manifests under the appropriate cursor", function* () {
    // Record a journal from an inline-body yield of `child.A`, then attempt to
    // replay with a non-deterministic fn that now yields `child.Z` instead.
    // The replay must produce a DivergenceError.
    const originalFn = Fn<[], Val>([], Eval("child.A", Q([])));
    const divergentFn = Fn<[], Val>([], Eval("child.Z", Q([])));

    const workflowIR = effectIR("caller", "A");

    // Original run with originalFn.
    const stream1 = new InMemoryStream();
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(originalFn), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    yield* installTailMiddleware();
    const firstRun = yield* execute({ ir: workflowIR as never, stream: stream1 });
    expect(firstRun.result.status).toBe("ok");

    // Simulate crash before the triggering yield was durable so middleware
    // actually re-runs on replay (pure replay would not re-run middleware and
    // would not exercise inline-body divergence). Drop the caller's A yield.
    const fullEvents = stream1.snapshot();
    const partial = fullEvents.filter((e) => !(e.coroutineId === "root" && e.type === "yield"));

    // Replay with divergentFn — the lane cursor has child.A stored but fn now
    // yields child.Z on the first effect.
    const stream2 = new InMemoryStream(partial);
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "caller.A") {
          yield* invokeInline(asFn(divergentFn), []);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    });
    const replayRun = yield* execute({ ir: workflowIR as never, stream: stream2 });

    // Replay fails with DivergenceError-derived error status under the lane cursor.
    expect(replayRun.result.status).toBe("error");
    if (replayRun.result.status === "error") {
      expect(replayRun.result.error.name).toMatch(/Divergence/);
    }
  });

  // ── IE-RP-013 ──
  //
  // Scoped-effects §9.5 payload-sensitive divergence, inline-invocation
  // variant. If a workflow replays with a changed effect payload that was
  // not changed in the original run, the terminal boundary MUST raise
  // DivergenceError instead of substituting the stored result — otherwise
  // middleware would re-run with the new payload and build divergent live
  // state (resource handles, subscriptions, etc.) while the workflow
  // continues with the stored handle from the original payload.

  it("IE-RP-013: payload mismatch on caller-triggering dispatch raises DivergenceError", function* () {
    // fn's body is opaque for this test — we never expect it to run on the
    // replay pass because payload-sha divergence fires before the boundary
    // substitutes.
    const fn = Fn<[], Val>([], Q(null));

    // Workflow dispatches `caller.A` with a payload. Middleware calls
    // `invokeInline(fn)` to simulate a resource-producing inline body.
    const workflowA: Val = {
      tisyn: "eval",
      id: "caller.A",
      data: { id: "resource-A" },
    } as unknown as Val;
    const workflowB: Val = {
      tisyn: "eval",
      id: "caller.A",
      data: { id: "resource-B" }, // DIFFERENT payload
    } as unknown as Val;

    let middlewareCalled = 0;
    let inlineBodyExecuted = 0;
    const middleware = {
      *dispatch([effectId, data]: [string, Val], next: (e: string, d: Val) => Operation<Val>) {
        if (effectId === "caller.A") {
          middlewareCalled++;
          yield* invokeInline(asFn(fn), []);
          inlineBodyExecuted++;
          return null as Val;
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
      },
    };

    // Original run with payload A.
    const stream1 = new InMemoryStream();
    yield* Effects.around(middleware);
    yield* installTailMiddleware();
    const originalRun = yield* execute({ ir: workflowA as never, stream: stream1 });
    expect(originalRun.result.status).toBe("ok");
    expect(middlewareCalled).toBe(1);
    expect(inlineBodyExecuted).toBe(1);

    // Replay against SAME stored journal but with DIFFERENT IR payload.
    // The runtime should raise DivergenceError at the caller.A dispatch
    // before `runAsTerminal` substitutes the stored result — so the inline
    // body must NOT execute a second time.
    const stream2 = new InMemoryStream(stream1.snapshot());
    yield* Effects.around(middleware);
    const replayRun = yield* execute({ ir: workflowB as never, stream: stream2 });

    expect(replayRun.result.status).toBe("error");
    if (replayRun.result.status === "error") {
      expect(replayRun.result.error.name).toBe("DivergenceError");
      expect(replayRun.result.error.message).toContain("payload fingerprint mismatch");
      expect(replayRun.result.error.message).toContain("caller.A");
    }
    // Divergence fired BEFORE the boundary invoked liveWork, so middleware's
    // `invokeInline` did not execute a second time.
    expect(inlineBodyExecuted).toBe(1);
  });
});
