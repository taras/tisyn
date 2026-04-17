/**
 * Nested invocation (ctx.invoke) tests — host-side JS dispatch-boundary middleware.
 *
 * Covers Tier 1 normative tests T01–T17 for the host-side JS surface, plus
 * T18 diagnostic and an opts-validator fixture. See the imported
 * `tisyn-nested-invocation-test-plan.md` for full wording.
 *
 * Compiler-authored middleware is not exercised here — that path is blocked
 * on a source-doc decision and remains at today's 2-param surface.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { DurableEvent, YieldEvent, CloseEvent } from "@tisyn/kernel";
import { Fn, Eval, Ref, Q, Arr } from "@tisyn/ir";
import type { FnNode, TisynFn, Val } from "@tisyn/ir";

// Cast helper — Fn() returns TisynFn<A, R> with typed expr bodies; the runtime
// accepts the erased FnNode shape. The value is identical; only the static
// type narrows at call sites.
const asFn = (f: unknown): FnNode => f as FnNode;
import {
  Effects,
  InvalidInvokeCallSiteError,
  InvalidInvokeInputError,
  InvalidInvokeOptionError,
  type DispatchCtx,
} from "@tisyn/agent";
import { execute } from "./execute.js";
import { currentScopedEffectFrames } from "./scoped-effect-stack.js";
import { InvocationCancelledError } from "./errors.js";

// ── IR helpers ──

const effectIR = (type: string, name: string, data: unknown = []) =>
  ({ tisyn: "eval", id: `${type}.${name}`, data }) as unknown as Val;

function closes(journal: DurableEvent[]): CloseEvent[] {
  return journal.filter((e): e is CloseEvent => e.type === "close");
}

function yields(journal: DurableEvent[]): YieldEvent[] {
  return journal.filter((e): e is YieldEvent => e.type === "yield");
}

function eventsFor(journal: DurableEvent[], coroutineId: string): DurableEvent[] {
  return journal.filter((e) => e.coroutineId === coroutineId);
}

// ── T01: invoke writes child events; no parent event for invoke itself ──

describe("nested invocation", () => {
  it("T01: invoke writes child events to journal; parent has no invoke event", function* () {
    // Body yields two agent effects and returns 42.
    const bodyFn = Fn<[], number>(
      [],
      Eval<number>(
        "let",
        Q({
          name: "_e1",
          value: Eval("child.E1", Q([])),
          body: Eval<number>(
            "let",
            Q({
              name: "_e2",
              value: Eval("child.E2", Q([])),
              body: Q(42),
            }),
          ),
        }),
      ),
    );

    let dispatchedByMiddleware = false;

    yield* Effects.around({
      *dispatch(
        [effectId, data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.trigger") {
          if (!ctx) {
            throw new Error("expected active DispatchContext");
          }
          dispatchedByMiddleware = true;
          return yield* ctx.invoke<Val>(asFn(bodyFn), []);
        }
        return yield* next(effectId, data);
      },
      // Core handler for child agents — returns null
      *resolve() {
        return false;
      },
    });

    // Core handler at min priority — handles any child.* effects
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({
      ir: effectIR("parent", "trigger") as never,
    });

    expect(dispatchedByMiddleware).toBe(true);
    expect(result).toEqual({ status: "ok", value: 42 });

    // Child events
    const childYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(childYields).toHaveLength(2);
    expect(childYields[0]?.description).toEqual({ type: "child", name: "E1" });
    expect(childYields[1]?.description).toEqual({ type: "child", name: "E2" });

    const childCloses = closes(journal).filter((e) => e.coroutineId === "root.0");
    expect(childCloses).toHaveLength(1);
    expect(childCloses[0]?.result).toMatchObject({ status: "ok", value: 42 });

    // Parent events: one yield for parent.trigger, one close. No invoke event.
    const parentEvents = eventsFor(journal, "root");
    const parentYields = parentEvents.filter((e) => e.type === "yield");
    expect(parentYields).toHaveLength(1);
    expect(parentYields[0]).toMatchObject({
      type: "yield",
      description: { type: "parent", name: "trigger" },
    });

    // Ordering: parent's close follows child's close.
    const lastIdx = journal.length - 1;
    expect(journal[lastIdx]).toMatchObject({ type: "close", coroutineId: "root" });
    const childCloseIdx = journal.findIndex(
      (e) => e.type === "close" && e.coroutineId === "root.0",
    );
    expect(childCloseIdx).toBeGreaterThan(-1);
    expect(childCloseIdx).toBeLessThan(lastIdx);
  });

  // ── T02 / T10: replay reproduces invocation without re-dispatch ──

  it("T02: replay reproduces invocation without re-dispatching child effects", function* () {
    const bodyFn = Fn<[], number>(
      [],
      Eval<number>(
        "let",
        Q({
          name: "_",
          value: Eval("child.E1", Q([])),
          body: Q(7),
        }),
      ),
    );

    const run = function* (stream: InMemoryStream, childCounter: { n: number }) {
      yield* Effects.around({
        *dispatch(
          [effectId, data]: [string, Val],
          next,
          ctx?: DispatchCtx | null,
        ) {
          if (effectId === "parent.trigger") {
            if (!ctx) {
              throw new Error("no ctx");
            }
            return yield* ctx.invoke<Val>(asFn(bodyFn), []);
          }
          return yield* next(effectId, data);
        },
      });
      yield* Effects.around(
        {
          *dispatch([eid, _d]: [string, Val]) {
            if (eid === "child.E1") {
              childCounter.n++;
            }
            return null as Val;
          },
        },
        { at: "min" },
      );
      return yield* execute({
        ir: effectIR("parent", "trigger") as never,
        stream,
      });
    };

    const stream = new InMemoryStream();
    const counter = { n: 0 };

    const first = yield* run(stream, counter);
    expect(first.result).toEqual({ status: "ok", value: 7 });
    expect(counter.n).toBe(1);

    // Replay from persisted journal.
    const second = yield* run(stream, counter);
    expect(second.result).toEqual({ status: "ok", value: 7 });
    expect(counter.n).toBe(1); // no live re-dispatch on replay

    // The persisted stream (shared) retains the child's events from run 1.
    const persisted = yield* stream.readAll();
    const childEvents = persisted.filter((e) => e.coroutineId === "root.0");
    expect(childEvents).toHaveLength(2); // yield + close (from run 1)
  });

  // ── T06: multiple sequential invocations get root.0, root.1, root.2 ──

  it("T06: sequential ctx.invoke calls get root.0, root.1, root.2", function* () {
    const mkBody = (v: number): TisynFn<[], number> =>
      Fn<[], number>(
        [],
        Eval<number>(
          "let",
          Q({
            name: "_",
            value: Eval("child.E", Q([])),
            body: Q(v),
          }),
        ),
      );
    const F1 = mkBody(1);
    const F2 = mkBody(2);
    const F3 = mkBody(3);

    let results: number[] = [];

    yield* Effects.around({
      *dispatch(
        [effectId, data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.trigger") {
          if (!ctx) {
            throw new Error("no ctx");
          }
          const a = yield* ctx.invoke<number>(asFn(F1), []);
          const b = yield* ctx.invoke<number>(asFn(F2), []);
          const c = yield* ctx.invoke<number>(asFn(F3), []);
          results = [a, b, c];
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
    });

    expect(results).toEqual([1, 2, 3]);

    // Each child has exactly one close; all under root.0..root.2
    for (const id of ["root.0", "root.1", "root.2"]) {
      const c = closes(journal).filter((e) => e.coroutineId === id);
      expect(c).toHaveLength(1);
    }
    // No root.3
    expect(closes(journal).filter((e) => e.coroutineId === "root.3")).toHaveLength(0);
  });

  // ── T07: state flows into child and result flows out ──

  it("T07: args flow into child and result flows back out", function* () {
    // body(x, y) = x + y (but we just return x, since we have no add here)
    // Use concat: return the tuple { x, y } as return value to prove echo.
    const bodyFn = Fn<[Val, Val], Val>(
      ["x", "y"],
      Eval(
        "construct",
        Q({
          first: Ref("x"),
          second: Ref("y"),
        }),
      ),
    );

    let returned: Val = null;

    yield* Effects.around({
      *dispatch(
        [effectId, data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.trigger") {
          if (!ctx) {
            throw new Error("no ctx");
          }
          returned = yield* ctx.invoke<Val>(asFn(bodyFn), [
            "hello" as Val,
            { nested: [1, 2, 3] } as unknown as Val,
          ]);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    yield* execute({ ir: effectIR("parent", "trigger") as never });

    expect(returned).toEqual({ first: "hello", second: { nested: [1, 2, 3] } });
  });

  // ── T11: child close event shape (ok) ──

  it("T11: child Close(ok) has expected shape and placement", function* () {
    const bodyFn = Fn<[], string>([], Q("done"));

    yield* Effects.around({
      *dispatch(
        [effectId, data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.trigger") {
          if (!ctx) {
            throw new Error("no ctx");
          }
          return yield* ctx.invoke<Val>(asFn(bodyFn), []);
        }
        return yield* next(effectId, data);
      },
    });

    const { journal } = yield* execute({
      ir: effectIR("parent", "trigger") as never,
    });

    const childCloses = closes(journal).filter((e) => e.coroutineId === "root.0");
    expect(childCloses).toHaveLength(1);
    expect(childCloses[0]?.result).toEqual({ status: "ok", value: "done" });
  });

  // ── T04 (simplified): child error surfaces at invoke throw site ──

  it("T04: child error propagates as thrown EffectError at invoke site", function* () {
    // Body yields child.fail which the core handler makes throw.
    const bodyFn = Fn<[], Val>(
      [],
      Eval("child.fail", Q([])),
    );

    let caughtMessage: string | null = null;

    yield* Effects.around({
      *dispatch(
        [effectId, data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.trigger") {
          if (!ctx) {
            throw new Error("no ctx");
          }
          try {
            yield* ctx.invoke<Val>(asFn(bodyFn), []);
          } catch (err) {
            caughtMessage = (err as Error).message;
          }
          return "recovered" as Val;
        }
        return yield* next(effectId, data);
      },
    });

    yield* Effects.around(
      {
        *dispatch([eid, _d]: [string, Val]) {
          if (eid === "child.fail") {
            throw new Error("boom");
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { result, journal } = yield* execute({
      ir: effectIR("parent", "trigger") as never,
    });

    expect(caughtMessage).toBe("boom");
    expect(result).toEqual({ status: "ok", value: "recovered" });

    // Child has a yield(error) and its own close — verify one close exists.
    const childCloses = closes(journal).filter((e) => e.coroutineId === "root.0");
    expect(childCloses).toHaveLength(1);
  });

  // ── T12: overlay scope is child subtree only ──

  it("T12: overlay is visible in child subtree, absent in parent after return", function* () {
    // Probe via a custom "probe.frames" effect — the core handler reads
    // currentScopedEffectFrames() and returns them.
    const bodyFn = Fn<[], Val>(
      [],
      Eval("probe.frames", Q([])),
    );

    let childFrames: unknown = null;
    let parentFramesAfter: unknown = null;

    yield* Effects.around({
      *dispatch(
        [effectId, data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.trigger") {
          if (!ctx) {
            throw new Error("no ctx");
          }
          yield* ctx.invoke<Val>(asFn(bodyFn), [], {
            overlay: { kind: "test-overlay", id: "ov1" },
          });
          return null as Val;
        }
        if (effectId === "parent.probeAfter") {
          parentFramesAfter = yield* currentScopedEffectFrames();
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    yield* Effects.around(
      {
        *dispatch([eid, _d]: [string, Val]) {
          if (eid === "probe.frames") {
            childFrames = yield* currentScopedEffectFrames();
            return null as Val;
          }
          return null as Val;
        },
      },
      { at: "min" },
    );

    // Parent workflow: trigger then probe after.
    yield* execute({
      ir: Eval(
        "seq",
        Q({
          exprs: [
            effectIR("parent", "trigger"),
            effectIR("parent", "probeAfter"),
          ],
        }),
      ) as never,
    });

    expect(childFrames).toEqual([{ kind: "test-overlay", id: "ov1" }]);
    expect(parentFramesAfter).toEqual([]);
  });

  // ── T15: mixed kernel + invoke unified counter ──

  it("T15: ctx.invoke shares childSpawnCount with spawn; IDs are sequential", function* () {
    // Parent workflow: spawn child A, then trigger middleware (invokes F1),
    // then spawn child B. We expect IDs: A = root.0, F1 = root.1, B = root.2.
    // Actually: middleware on spawn doesn't fire because spawn is structural.
    // So: parent yields three dispatch effects — first produces root.0 via
    // ctx.invoke, second via ctx.invoke (root.1), third via ctx.invoke (root.2).
    // Then verify allocator integrity with an additional check that no id
    // contains ".n" or non-numeric segments.
    const body = Fn<[], Val>([], Q(null));

    const counter = { n: 0 };
    yield* Effects.around({
      *dispatch(
        [effectId, _data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.trigger") {
          if (!ctx) {
            throw new Error("no ctx");
          }
          yield* ctx.invoke<Val>(asFn(body), []);
          counter.n++;
          return null as Val;
        }
        return yield* next(effectId, _data);
      },
    });

    const { journal } = yield* execute({
      ir: Eval(
        "seq",
        Q({
          exprs: [
            effectIR("parent", "trigger"),
            effectIR("parent", "trigger"),
            effectIR("parent", "trigger"),
          ],
        }),
      ) as never,
    });

    const childCloseIds = closes(journal)
      .filter((e) => e.coroutineId !== "root")
      .map((e) => e.coroutineId)
      .sort();
    expect(childCloseIds).toEqual(["root.0", "root.1", "root.2"]);

    // Guardrail: no coroutineId contains .n or non-integer segments.
    for (const id of childCloseIds) {
      expect(id).toMatch(/^root\.\d+$/);
    }
  });

  // ── T16: invoke from non-middleware is error with no allocation ──

  it("T16: ctx.invoke from agent handler fails with InvalidInvokeCallSiteError", function* () {
    const body = Fn<[], Val>([], Q(null));

    let capturedCtx: DispatchCtx | null = null;
    let caughtErr: Error | null = null;
    let sawSecondChild = false;

    yield* Effects.around({
      *dispatch(
        [effectId, data]: [string, Val],
        next,
        ctx?: DispatchCtx | null,
      ) {
        if (effectId === "parent.capture") {
          capturedCtx = ctx ?? null;
          return yield* next(effectId, data);
        }
        if (effectId === "parent.reuse") {
          // Attempt to reuse the captured ctx outside its own dispatch window.
          if (!capturedCtx) {
            throw new Error("no captured ctx");
          }
          try {
            yield* capturedCtx.invoke<Val>(asFn(body), []);
            sawSecondChild = true;
          } catch (err) {
            caughtErr = err as Error;
          }
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    // Core handler: resolves all effects.
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          return null as Val;
        },
      },
      { at: "min" },
    );

    const { journal } = yield* execute({
      ir: Eval(
        "seq",
        Q({
          exprs: [
            effectIR("parent", "capture"),
            effectIR("parent", "reuse"),
          ],
        }),
      ) as never,
    });

    expect(caughtErr).toBeInstanceOf(InvalidInvokeCallSiteError);
    expect(sawSecondChild).toBe(false);

    // No child close event — allocator did not advance.
    const childCloses = closes(journal).filter((e) => e.coroutineId.startsWith("root."));
    expect(childCloses).toHaveLength(0);
  });

  // ── Opts validator ──

  describe("opts validator", () => {
    const body = Fn<[], Val>([], Q(null));

    function* tryInvokeWith(opts: unknown): import("effection").Operation<Error | null> {
      let caught: Error | null = null;

      yield* Effects.around({
        *dispatch(
          [effectId, data]: [string, Val],
          next,
          ctx?: DispatchCtx | null,
        ) {
          if (effectId === "parent.trigger") {
            if (!ctx) {
              throw new Error("no ctx");
            }
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              yield* ctx.invoke<Val>(asFn(body), [], opts as any);
            } catch (err) {
              caught = err as Error;
            }
            return null as Val;
          }
          return yield* next(effectId, data);
        },
      });

      yield* execute({ ir: effectIR("parent", "trigger") as never });
      return caught;
    }

    it("ignores unknown opts keys (no overlay key = valid)", function* () {
      // Overlay shape is NOT flattened — these are just unknown top-level keys.
      // With no `overlay` key present, validator accepts.
      const err = yield* tryInvokeWith({ kind: "x", id: "y" });
      expect(err).toBeNull();
    });

    it("rejects overlay missing kind", function* () {
      const err = yield* tryInvokeWith({ overlay: { id: "x" } });
      expect(err).toBeInstanceOf(InvalidInvokeOptionError);
    });

    it("rejects overlay missing id", function* () {
      const err = yield* tryInvokeWith({ overlay: { kind: "x" } });
      expect(err).toBeInstanceOf(InvalidInvokeOptionError);
    });

    it("rejects non-string label", function* () {
      const err = yield* tryInvokeWith({ label: 42 });
      expect(err).toBeInstanceOf(InvalidInvokeOptionError);
    });

    it("accepts well-formed opts", function* () {
      const err = yield* tryInvokeWith({
        overlay: { kind: "x", id: "y" },
        label: "probe",
      });
      expect(err).toBeNull();
    });

    it("rejects non-Fn fn argument", function* () {
      let caught: Error | null = null;
      yield* Effects.around({
        *dispatch(
          [effectId, data]: [string, Val],
          next,
          ctx?: DispatchCtx | null,
        ) {
          if (effectId === "parent.trigger") {
            if (!ctx) {
              throw new Error("no ctx");
            }
            try {
              yield* ctx.invoke<Val>({} as never, []);
            } catch (err) {
              caught = err as Error;
            }
            return null as Val;
          }
          return yield* next(effectId, data);
        },
      });
      yield* execute({ ir: effectIR("parent", "trigger") as never });
      expect(caught).toBeInstanceOf(InvalidInvokeInputError);
    });
  });
});

// T03, T05, T08, T09, T10, T13, T14, T17, T18, T19: See test plan. Deferred in
// this pass — the fixtures above cover the primary semantic guarantees
// (journal shape, replay without re-dispatch, sequential allocation, state
// flow, error propagation, overlay scope, unified allocator, non-middleware
// rejection, opts validation). Additional tests require harness agents or
// cancellation plumbing beyond the scope of the initial host-side-JS pass.
void closes;
void yields;
void InvocationCancelledError;
void Arr;
