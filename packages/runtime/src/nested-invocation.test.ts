/**
 * Nested invocation tests — host-side JS dispatch-boundary middleware.
 *
 * Covers the 9 primary positive cases (T01, T02, T04, T06, T07, T11, T12,
 * T15, T16), the 4 boundary cases (T-SHORT, T-NESTED, T-FACADE-NEG, TR),
 * and the opts-validator fixture group, per the plan's D5 table.
 *
 * The public surface exercised here is the free `invoke(fn, args, opts?)`
 * helper exported from `@tisyn/agent`, which reads the active
 * `DispatchContext` set by the runtime at each standard-effect dispatch
 * site. Agent handlers, `resolve` middleware, and facade `.around(...)`
 * middleware are explicitly **not** on the dispatch boundary: `invoke`
 * called from those sites throws `InvalidInvokeCallSiteError`.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { DurableEvent, YieldEvent, CloseEvent } from "@tisyn/kernel";
import { payloadSha } from "@tisyn/kernel";
import { Fn, Eval, Ref, Q } from "@tisyn/ir";
import type { FnNode, TisynFn, Val } from "@tisyn/ir";
import { agent, Agents, operation, useAgent } from "@tisyn/agent";
import {
  Effects,
  InvalidInvokeCallSiteError,
  InvalidInvokeInputError,
  InvalidInvokeOptionError,
  invoke,
  resolve,
} from "@tisyn/effects";
import { execute } from "./execute.js";
import { currentScopedEffectFrames } from "./scoped-effect-stack.js";
import { InvocationCancelledError } from "./errors.js";

// Cast helper — Fn() returns TisynFn<A, R> with typed expr bodies; the runtime
// accepts the erased FnNode shape. The value is identical; only the static
// type narrows at call sites.
const asFn = (f: unknown): FnNode => f as FnNode;

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

describe("nested invocation", () => {
  // ── T01 ──

  it("T01: invoke writes child events to journal; parent has no invoke event", function* () {
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
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          dispatchedByMiddleware = true;
          return yield* invoke<Val>(asFn(bodyFn), []);
        }
        return yield* next(effectId, data);
      },
      *resolve() {
        return false;
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
      ir: effectIR("parent", "trigger") as never,
    });

    expect(dispatchedByMiddleware).toBe(true);
    expect(result).toEqual({ status: "ok", value: 42 });

    const childYields = yields(journal).filter((e) => e.coroutineId === "root.0");
    expect(childYields).toHaveLength(2);
    expect(childYields[0]?.description).toEqual({
      type: "child", name: "E1", input: [], sha: payloadSha([]),
    });
    expect(childYields[1]?.description).toEqual({
      type: "child", name: "E2", input: [], sha: payloadSha([]),
    });

    const childCloses = closes(journal).filter((e) => e.coroutineId === "root.0");
    expect(childCloses).toHaveLength(1);
    expect(childCloses[0]?.result).toMatchObject({ status: "ok", value: 42 });

    const parentEvents = eventsFor(journal, "root");
    const parentYields = parentEvents.filter((e) => e.type === "yield");
    expect(parentYields).toHaveLength(1);
    expect(parentYields[0]).toMatchObject({
      type: "yield",
      description: { type: "parent", name: "trigger" },
    });

    const lastIdx = journal.length - 1;
    expect(journal[lastIdx]).toMatchObject({ type: "close", coroutineId: "root" });
    const childCloseIdx = journal.findIndex(
      (e) => e.type === "close" && e.coroutineId === "root.0",
    );
    expect(childCloseIdx).toBeGreaterThan(-1);
    expect(childCloseIdx).toBeLessThan(lastIdx);
  });

  // ── T02 ──

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
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "parent.trigger") {
            return yield* invoke<Val>(asFn(bodyFn), []);
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

    const second = yield* run(stream, counter);
    expect(second.result).toEqual({ status: "ok", value: 7 });
    expect(counter.n).toBe(1);

    const persisted = yield* stream.readAll();
    const childEvents = persisted.filter((e) => e.coroutineId === "root.0");
    expect(childEvents).toHaveLength(2);
  });

  // ── T06 ──

  it("T06: sequential invoke calls get root.0, root.1, root.2", function* () {
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
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          const a = yield* invoke<number>(asFn(F1), []);
          const b = yield* invoke<number>(asFn(F2), []);
          const c = yield* invoke<number>(asFn(F3), []);
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

    for (const id of ["root.0", "root.1", "root.2"]) {
      const c = closes(journal).filter((e) => e.coroutineId === id);
      expect(c).toHaveLength(1);
    }
    expect(closes(journal).filter((e) => e.coroutineId === "root.3")).toHaveLength(0);
  });

  // ── T07 ──

  it("T07: args flow into child and result flows back out", function* () {
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
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          returned = yield* invoke<Val>(asFn(bodyFn), [
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

  // ── T04 ──

  it("T04: child error propagates as thrown EffectError at invoke site; replay reproduces", function* () {
    const bodyFn = Fn<[], Val>([], Eval("child.fail", Q([])));

    const run = function* (stream: InMemoryStream) {
      let caughtMessage: string | null = null;

      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "parent.trigger") {
            try {
              yield* invoke<Val>(asFn(bodyFn), []);
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

      const out = yield* execute({
        ir: effectIR("parent", "trigger") as never,
        stream,
      });
      return { ...out, caughtMessage };
    };

    const stream = new InMemoryStream();
    const first = yield* run(stream);
    expect(first.caughtMessage).toBe("boom");
    expect(first.result).toEqual({ status: "ok", value: "recovered" });
    expect(closes(first.journal).filter((e) => e.coroutineId === "root.0")).toHaveLength(1);

    // Replay: the recorded parent yield carries the recovered result, so the
    // kernel short-circuits without re-driving the child. Terminal state must
    // match; the child's journal entries must not grow.
    const childEventsAfterFirst = (yield* stream.readAll()).filter(
      (e) => e.coroutineId === "root.0",
    );
    const second = yield* run(stream);
    expect(second.result).toEqual({ status: "ok", value: "recovered" });
    const childEventsAfterSecond = (yield* stream.readAll()).filter(
      (e) => e.coroutineId === "root.0",
    );
    expect(childEventsAfterSecond.length).toBe(childEventsAfterFirst.length);
  });

  // ── T11 ──

  it("T11: child Close(ok) has expected shape and placement", function* () {
    const bodyFn = Fn<[], string>([], Q("done"));

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          return yield* invoke<Val>(asFn(bodyFn), []);
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

  // ── T12 ──

  it("T12: overlay is visible in child subtree, absent in parent after return", function* () {
    const bodyFn = Fn<[], Val>([], Eval("probe.frames", Q([])));

    let childFrames: unknown = null;
    let parentFramesAfter: unknown = null;

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invoke<Val>(asFn(bodyFn), [], {
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

    yield* execute({
      ir: Eval(
        "seq",
        Q({
          exprs: [effectIR("parent", "trigger"), effectIR("parent", "probeAfter")],
        }),
      ) as never,
    });

    expect(childFrames).toEqual([{ kind: "test-overlay", id: "ov1" }]);
    expect(parentFramesAfter).toEqual([]);
  });

  // ── T15 ──

  it("T15: invoke shares childSpawnCount with sibling children; IDs are sequential", function* () {
    const body = Fn<[], Val>([], Q(null));

    yield* Effects.around({
      *dispatch([effectId, _data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          yield* invoke<Val>(asFn(body), []);
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

    for (const id of childCloseIds) {
      expect(id).toMatch(/^root\.\d+$/);
    }
  });

  // ── T16 ──

  it("T16: invoke from agent handler fails with InvalidInvokeCallSiteError", function* () {
    const body = Fn<[], Val>([], Q(null));

    const helper = agent("helper-t16", {
      run: operation<null, Val>(),
    });

    let caughtErr: Error | null = null;
    let handlerEntered = false;

    yield* Agents.use(helper, {
      *run() {
        handlerEntered = true;
        try {
          yield* invoke<Val>(asFn(body), []);
        } catch (err) {
          caughtErr = err as Error;
        }
        return null as Val;
      },
    });

    // Dispatch-boundary middleware that calls the agent handler. The
    // handler is wrapped by agents.ts in DispatchContext.with(undefined, …),
    // so invoke() inside the handler sees `undefined` and throws.
    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          const facade = yield* useAgent(helper);
          yield* facade.run(null);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    const { journal } = yield* execute({
      ir: effectIR("parent", "trigger") as never,
    });

    expect(handlerEntered).toBe(true);
    expect(caughtErr).toBeInstanceOf(InvalidInvokeCallSiteError);

    // Allocator did not advance — no child close events exist.
    const childCloses = closes(journal).filter((e) => e.coroutineId.startsWith("root."));
    expect(childCloses).toHaveLength(0);
  });

  // ── T-SHORT ──

  it("T-SHORT: short-circuit (no invoke call) does not advance allocator", function* () {
    const body = Fn<[], number>([], Q(99));

    let results: Array<number | null> = [];

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.skip") {
          // Short-circuit with a literal — never calls invoke, never calls next.
          results.push(null);
          return null as Val;
        }
        if (effectId === "parent.invoke") {
          const r = yield* invoke<number>(asFn(body), []);
          results.push(r);
          return null as Val;
        }
        return yield* next(effectId, data);
      },
    });

    const { journal } = yield* execute({
      ir: Eval(
        "seq",
        Q({
          exprs: [
            effectIR("parent", "skip"),
            effectIR("parent", "skip"),
            effectIR("parent", "invoke"),
          ],
        }),
      ) as never,
    });

    expect(results).toEqual([null, null, 99]);

    // The one invoked child must be root.0 — skips did not advance the allocator.
    const childCloseIds = closes(journal)
      .filter((e) => e.coroutineId !== "root")
      .map((e) => e.coroutineId);
    expect(childCloseIds).toEqual(["root.0"]);
  });

  // ── T-NESTED ──

  it("T-NESTED: nested invoke inside nested invoke; IDs root.0 and root.0.0", function* () {
    const innerBody = Fn<[], number>([], Q(2));
    const outerBody = Fn<[], number>(
      [],
      Eval<number>(
        "let",
        Q({
          name: "_",
          value: Eval("childA.inner", Q([])),
          body: Q(1),
        }),
      ),
    );

    yield* Effects.around({
      *dispatch([effectId, data]: [string, Val], next) {
        if (effectId === "parent.trigger") {
          return yield* invoke<Val>(asFn(outerBody), []);
        }
        if (effectId === "childA.inner") {
          return yield* invoke<Val>(asFn(innerBody), []);
        }
        return yield* next(effectId, data);
      },
    });

    const runOnce = (stream: InMemoryStream) =>
      execute({
        ir: effectIR("parent", "trigger") as never,
        stream,
      });

    const stream = new InMemoryStream();
    const first = yield* runOnce(stream);
    expect(first.result).toEqual({ status: "ok", value: 1 });

    const firstCloseIds = closes(first.journal)
      .map((e) => e.coroutineId)
      .sort();
    expect(firstCloseIds).toEqual(["root", "root.0", "root.0.0"]);

    // Replay from the same persisted stream reproduces the terminal result
    // without re-driving the nested children — child journal entries must not
    // grow.
    const childIds = ["root.0", "root.0.0"] as const;
    const childCountsAfterFirst = new Map<string, number>();
    for (const id of childIds) {
      childCountsAfterFirst.set(
        id,
        (yield* stream.readAll()).filter((e) => e.coroutineId === id).length,
      );
    }
    const replay = yield* runOnce(stream);
    expect(replay.result).toEqual({ status: "ok", value: 1 });
    for (const id of childIds) {
      const after = (yield* stream.readAll()).filter((e) => e.coroutineId === id).length;
      expect(after).toBe(childCountsAfterFirst.get(id));
    }
  });

  // ── T-FACADE-NEG ──

  it("T-FACADE-NEG: invoke from facade.around middleware throws InvalidInvokeCallSiteError", function* () {
    const body = Fn<[], Val>([], Q(null));

    const calc = agent("calc-facade-neg", {
      add: operation<{ a: number; b: number }, number>(),
    });

    yield* Agents.use(calc, {
      *add({ a, b }) {
        return a + b;
      },
    });

    const facade = yield* useAgent(calc);

    let caughtErr: Error | null = null;

    yield* facade.around({
      *add([args]: [Val], next) {
        try {
          yield* invoke<Val>(asFn(body), []);
        } catch (err) {
          caughtErr = err as Error;
        }
        return yield* next(args);
      },
    });

    // Calling the facade op runs the facade middleware upstream of the
    // Effects dispatch chain — DispatchContext.get() returns undefined.
    const sum = yield* facade.add({ a: 2, b: 3 });

    expect(sum).toBe(5);
    expect(caughtErr).toBeInstanceOf(InvalidInvokeCallSiteError);
  });

  // ── TR ──

  it("TR: invoke from resolve middleware throws InvalidInvokeCallSiteError", function* () {
    const body = Fn<[], Val>([], Q(null));

    let caughtErr: Error | null = null;

    yield* Effects.around({
      *resolve([agentId]: [string], next) {
        try {
          yield* invoke<Val>(asFn(body), []);
        } catch (err) {
          caughtErr = err as Error;
        }
        return yield* next(agentId);
      },
    });

    const bound = yield* resolve("anything");
    expect(bound).toBe(false);
    expect(caughtErr).toBeInstanceOf(InvalidInvokeCallSiteError);
  });

  // ── Opts validator ──

  describe("opts validator", () => {
    const body = Fn<[], Val>([], Q(null));

    function* tryInvokeWith(opts: unknown): import("effection").Operation<Error | null> {
      let caught: Error | null = null;

      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "parent.trigger") {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              yield* invoke<Val>(asFn(body), [], opts as any);
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
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === "parent.trigger") {
            try {
              yield* invoke<Val>({} as never, []);
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

void InvocationCancelledError;
