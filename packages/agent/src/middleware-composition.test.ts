import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import type { Val } from "@tisyn/ir";
import { Effects, dispatch } from "@tisyn/effects";

// Shared helper: install a catch-all core handler at min priority.
// Using { at: "min" } ensures it runs AFTER any interceptors installed
// at the default max priority, making it the innermost "base case" layer.
function* installCoreHandler(label = "core") {
  yield* Effects.around(
    {
      *dispatch([_e, _d]: [string, Val]) {
        return label as Val;
      },
    },
    { at: "min" },
  );
}

describe("middleware composition", () => {
  // MW-1: single middleware intercepts dispatch
  it("single middleware intercepts dispatch", function* () {
    yield* installCoreHandler();

    let intercepted = false;
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        intercepted = true;
        return yield* next(e, d);
      },
    });

    const result = yield* dispatch("test.op", null);
    expect(intercepted).toBe(true);
    expect(result).toBe("core");
  });

  // MW-2: middleware can deny by throwing
  it("middleware can deny by throwing", function* () {
    yield* installCoreHandler();

    yield* Effects.around({
      *dispatch([_e, _d]: [string, Val], _next) {
        throw new Error("denied");
      },
    });

    try {
      yield* dispatch("test.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("denied");
    }
  });

  // MW-3: middleware can transform request data
  it("middleware can transform request data", function* () {
    let receivedData: Val = null;
    yield* Effects.around(
      {
        *dispatch([_e, d]: [string, Val]) {
          receivedData = d;
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, _d]: [string, Val], next) {
        return yield* next(e, { transformed: true } as unknown as Val);
      },
    });

    yield* dispatch("test.op", { original: true } as unknown as Val);
    expect(receivedData).toEqual({ transformed: true });
  });

  // MW-5: max middleware: first installed (M1) runs before second (M2)
  it("max middleware: first installed runs first (M1 before M2)", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M1");
        return yield* next(e, d);
      },
    });

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M2");
        return yield* next(e, d);
      },
    });

    yield* dispatch("test.op", null);
    expect(log).toEqual(["M1", "M2", "core"]);
  });

  // MW-6: min middleware: most recently installed (m2) runs before earlier (m1)
  it("min middleware: most recently installed runs first (m2 before m1)", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m1");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m2");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    yield* dispatch("test.op", null);
    expect(log).toEqual(["m2", "m1", "core"]);
  });

  // MW-7: max M1 then min m1 → order M1, m1, core
  it("max M1 then min m1 → order M1, m1, core", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M1");
        return yield* next(e, d);
      },
    });

    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m1");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    yield* dispatch("test.op", null);
    expect(log).toEqual(["M1", "m1", "core"]);
  });

  // MW-8: max M1, min m1, max M2, min m2 → order M1, M2, m2, m1, core
  it("max M1, min m1, max M2, min m2 → order M1, M2, m2, m1, core", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M1");
        return yield* next(e, d);
      },
    });

    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m1");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M2");
        return yield* next(e, d);
      },
    });

    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m2");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    yield* dispatch("test.op", null);
    expect(log).toEqual(["M1", "M2", "m2", "m1", "core"]);
  });

  // MW-9: parent max M1; child installs max M2 via scoped; dispatch in child → order M1, M2, core
  it("parent max M1 + child max M2 → order M1, M2, core inside child", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M1");
        return yield* next(e, d);
      },
    });

    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("M2");
          return yield* next(e, d);
        },
      });

      yield* dispatch("test.op", null);
    });

    expect(log).toEqual(["M1", "M2", "core"]);
  });

  // MW-10: parent min m1; child installs min m2 via scoped; dispatch in child → order m2, m1, core
  it("parent min m1 + child min m2 → order m2, m1, core inside child", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m1");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    yield* scoped(function* () {
      yield* Effects.around(
        {
          *dispatch([e, d]: [string, Val], next) {
            log.push("m2");
            return yield* next(e, d);
          },
        },
        { at: "min" },
      );

      yield* dispatch("test.op", null);
    });

    expect(log).toEqual(["m2", "m1", "core"]);
  });

  // MW-11: parent installs M1; child installs M2 in scoped; after child exits, dispatch in parent → only M1 intercepts
  it("after child scope exits, parent dispatch sees only parent middleware", function* () {
    const log: string[] = [];

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M1");
        return yield* next(e, d);
      },
    });

    yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([e, d]: [string, Val], next) {
          log.push("M2");
          return yield* next(e, d);
        },
      });

      yield* dispatch("test.op", null);
    });

    // After child exits, dispatch in parent should only see M1
    log.length = 0;
    yield* dispatch("test.op", null);
    expect(log).toEqual(["M1", "core"]);
  });

  // MW-13: reserved-namespace effect "tisyn.sleep" passes through middleware — middleware intercepts it
  it('reserved-namespace effect "tisyn.sleep" is intercepted by middleware', function* () {
    let interceptedId: string | null = null;

    yield* installCoreHandler();

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        interceptedId = e;
        return yield* next(e, d);
      },
    });

    yield* dispatch("tisyn.sleep", null);
    expect(interceptedId).toBe("tisyn.sleep");
  });

  // MW-14: user-defined "app.custom" passes through middleware
  it('user-defined "app.custom" effect passes through middleware', function* () {
    let interceptedId: string | null = null;

    yield* installCoreHandler();

    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        interceptedId = e;
        return yield* next(e, d);
      },
    });

    yield* dispatch("app.custom", null);
    expect(interceptedId).toBe("app.custom");
  });

  // MW-15: middleware that denies "tisyn.exec" actually blocks it — no bypass
  it('middleware that denies "tisyn.exec" blocks the effect', function* () {
    let coreReached = false;

    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          coreReached = true;
          return "core" as Val;
        },
      },
      { at: "min" },
    );

    yield* Effects.around({
      *dispatch([e, _d]: [string, Val], _next) {
        if (e === "tisyn.exec") {
          throw new Error("tisyn.exec blocked by middleware");
        }
        throw new Error("unexpected effect");
      },
    });

    try {
      yield* dispatch("tisyn.exec", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("tisyn.exec blocked by middleware");
    }

    expect(coreReached).toBe(false);
  });
});
